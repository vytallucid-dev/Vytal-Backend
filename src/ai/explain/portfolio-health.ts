// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// EXPLAIN THIS PORTFOLIO'S HEALTH — the seam behind POST /api/v1/me/portfolio/explanation.
//
// The portfolio sibling of stock-health.ts, and deliberately PARALLEL to it rather than merged with
// it: the shared machinery (the guarded loop, the quota seam, the mock guard) lives in ./shared.js,
// and what remains here is this surface's own orchestration, which genuinely differs — a stock 404s
// on an unknown symbol, a portfolio never 404s and instead declines in two distinct ways.
//
// ── ★ THE FOUR-STATE GATE — the structural difference from the stock flow ────────────────────────
//
// A stock is scored or it is not; unknown ⇒ null ⇒ 404. A portfolio has FOUR states, and two of them
// must be answered WITHOUT SPENDING ANYTHING:
//
//   EMPTY BOOK        no snapshot, no holdings   → decline. FREE — before cache, before quota.
//   NO SNAPSHOT YET   holdings, no snapshot      → decline. FREE — the first compute hasn't landed.
//   CONSTRUCTION-ONLY snapshot, healthRead null  → EXPLAIN, headlineSlot "construction".
//   HEALTH            snapshot, healthRead set   → EXPLAIN, headlineSlot "health".
//
// ⚠ THE TWO DECLINES SIT BEFORE THE CACHE READ, NOT AFTER. Their fact block contains nothing but
// "not available" — there is no explanation to generate and none to cache, so touching either would
// spend a DB round trip (and, on the quota path, a unit of a 480/day shared budget) to produce a
// sentence we already know. Declining early is not an optimisation; it is the difference between a
// budget that funds explanations and one that funds saying "there is nothing here".
//
// ★ AND `headlineSlot` IS NOT DECORATION — IT IS A SAFETY FLAG. A construction-only book has no
// verdict, and CLOSED_WORLD_HEADER forbids the model to invent a NUMBER but says nothing about
// inventing a CHARACTERISATION. Handed a fact block reading "[HEALTH READ] not available" together
// with an ask that says "lead with the overall verdict", Flash-Lite will supply one. The slot is what
// selects a different ask for that state (Phase 2), and it is stored on the cache row so a book that
// later becomes scored can never be served prose written for the other question.
//
// ★ THE FALLBACK IS BUILT BEFORE THE GENERATOR BECAUSE IT IS THE SAFETY FLOOR, NOT A CONSOLATION.
// It fires at exactly the moment the model has ALREADY produced advice — so "safe because I wrote it
// carefully" is the weakest possible guarantee at the moment the strongest is needed. Everything here
// is therefore either (a) prose that some OTHER module already had proven clean, or (b) one of four
// short sentences this file authors, every one of which is enumerated in AUTHORED_FALLBACK_STRINGS
// and scanned by verify-ai-portfolio-fallback.ts against BOTH advice vocabularies.
//
// ── ★ THE LAYERS, AND WHY THERE ARE THREE RATHER THAN ONE ────────────────────────────────────────
//
//   LAYER 1 · snapshot.story.text — the composed storyboard (portfolio/phs/story.ts). Deterministic
//             by ruling, byte-for-byte stable, and advice-scanned end-to-end by verify-phs-story.ts
//             (every storyClause, the live composed story, AND the composer's own connectives).
//             This is the good case and it reads like something a person wrote.
//
//   LAYER 2 · constructionRead.findings[].read — joined. Every emitted `read` is advice-scanned by
//             verify-phs-copy.ts (fired AND raw templates), verify-phs-pd-readtime.ts and
//             verify-phs-pi-readtime.ts. ★ IT COVERS EXACTLY WHERE LAYER 1 IS NULL: composeStory
//             requires `s.phs != null`, so a CONSTRUCTION-ONLY book (nothing scored) has no story at
//             all — and on precisely that book reshapeSnapshot gives constructionRead THE WHOLE FIRED
//             SET rather than its usual PC/PB/PA/PE slice. The layer that survives is the layer that
//             gets handed everything. That is not a coincidence; it is why this shape works.
//
//   LAYER 3 · a fixed sentence, for the books that have no snapshot to say anything about.
//
// ⚠ THIS MODULE AUTHORS NO ANALYSIS. It selects and joins prose that already exists and is already
// proven. The four sentences below are scaffolding — they say which state the book is in, never what
// the book is like. The moment someone adds a sentence here that CHARACTERISES a portfolio, this
// module has quietly become a second, unproven copy of the storyboard.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import type { PortfolioHealthView } from "../../portfolio/phs/portfolio-health-view.js";
import { groundPortfolioHealth, type GroundingSources } from "../grounding.js";
import { resolveToneForUser } from "../tone.js";
import { createAiProvider } from "../registry.js";
import {
  asJson, composePrompt, generateGuarded, onQuotaDenied, servedByMock, spendFor, toneKeyOf,
  EXPLANATION_MODEL, type ExplanationState,
} from "./shared.js";

// ── THE AUTHORED SET ─────────────────────────────────────────────────────────────────────────────
// Every sentence this module writes itself. Four, deliberately: each names a STATE, none describes a
// book. They are the only strings in the whole fallback that no other module's gate covers, which is
// why they are consts with one home rather than inline literals — an inline literal is a string the
// proof set can silently fail to include.

/** No snapshot, no holdings — there is nothing to explain and nothing was lost. */
const EMPTY_BOOK = "This portfolio holds nothing right now, so there is no health reading to explain.";

/** Holdings exist, but no snapshot has landed yet (first compute pending / mid-backfill). ★ THE
 *  DISTINCTION FROM EMPTY_BOOK IS LOAD-BEARING: telling someone who owns twelve positions that they
 *  "hold nothing" is a false statement about their money, not a rounding of one. */
const NO_SNAPSHOT = "This portfolio has not been scored yet, so no health reading exists for it.";

/** A snapshot exists but composed to nothing (a pre-Stage-9 / pre-10b row with no findings carrying a
 *  `read`). Defensive: reachable only on stale rows, whose cure is their next recompute. */
const NO_READING = "No health reading is available for this portfolio yet.";

/** Construction-only header. The one place a sentence is genuinely owed: without it, Layer 2 opens on
 *  a bare list of construction facts and a reader is left to wonder where the health number went. */
const CONSTRUCTION_ONLY_HEADER =
  "Nothing in this book is scored yet, so it has no health reading — only a construction read.";

/**
 * ★ THE PROOF SET, EXPORTED — and exhaustive BY CONSTRUCTION, not by diligence.
 *
 * verify-ai-portfolio-fallback.ts scans every member against the portfolio advice vocabulary AND the
 * runtime AI guardrail, and separately re-reads THIS FILE to assert that every authored const above
 * appears in this array. A new sentence that skips the array fails the build rather than shipping
 * unscanned — the same ruling as COPY_IDS and STORY_CLAUSE_REQUIRED_FAMILIES.
 */
export const AUTHORED_FALLBACK_STRINGS: readonly string[] = Object.freeze([
  EMPTY_BOOK,
  NO_SNAPSHOT,
  NO_READING,
  CONSTRUCTION_ONLY_HEADER,
]);

/** Which layer answered. Returned alongside the prose so a caller (and the proof) can tell a rich
 *  story from a bare decline without parsing the text — the same reasoning as the explanation
 *  result's `state`: a surface that hides which path served it cannot be debugged or trusted. */
export type PortfolioFallbackLayer = "story" | "construction_findings" | "decline";

export interface PortfolioFallback {
  text: string;
  layer: PortfolioFallbackLayer;
}

/**
 * Compose the deterministic portfolio fallback. Pure: no DB, no AI, no clock — everything is read off
 * the view the caller already grounded with. Never throws and never returns empty; the decline
 * sentences are real answers to real states, not error strings.
 */
export function composeDeterministicPortfolioFallbackDetailed(view: PortfolioHealthView): PortfolioFallback {
  const snap = view.snapshot;

  // ── LAYER 3 · no snapshot ──
  // ⚠ `hasHoldings` is answered over the UNION (manual ∪ broker), so a broker-only book is not
  // mistaken for an empty one. Getting this branch backwards is the one failure here that would be a
  // false statement rather than a thin one.
  if (!snap) {
    return { text: view.hasHoldings ? NO_SNAPSHOT : EMPTY_BOOK, layer: "decline" };
  }

  // ── LAYER 1 · the storyboard ──
  // Present ⇔ scored holdings exist AND the row is fresh enough to carry a full ledger. Preferred
  // whenever it exists: it is the only layer that STITCHES, and it is proven as composed output, not
  // merely as ingredients.
  const story = snap.story?.text?.trim();
  if (story) return { text: story, layer: "story" };

  // ── LAYER 2 · the construction findings, joined ──
  // Reached on a construction-only book (no health read ⇒ no story) and on stale rows the composer
  // refuses to narrate. On the former, `findings` is the WHOLE fired set — nothing is dropped.
  // Skipping clause-less findings is not a filter we invented: `read` is optional in PfFinding, and a
  // finding without one has no standalone sentence to contribute.
  const reads = snap.constructionRead.findings
    .map((f) => f.read?.trim())
    .filter((r): r is string => !!r);

  if (reads.length) {
    // The header is added ONLY when the health read is genuinely absent. On a stale-row fallback the
    // book may well be scored, and announcing "nothing here is scored" would be false.
    const parts = snap.healthRead === null ? [CONSTRUCTION_ONLY_HEADER, ...reads] : reads;
    return { text: parts.join(" "), layer: "construction_findings" };
  }

  return { text: NO_READING, layer: "decline" };
}

/** Text-only convenience — the shape a caller serving `explanation` wants. */
export function composeDeterministicPortfolioFallback(view: PortfolioHealthView): string {
  return composeDeterministicPortfolioFallbackDetailed(view).text;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SERVICE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Which question this surface answered. "health" ⇔ scored holdings exist and there IS a reading;
 *  "construction" ⇔ nothing is scored and only the book's shape can be described. */
export type HeadlineSlot = "health" | "construction";

/** What the user's client gets back. Mirrors StockExplanationResult's shape minus `symbol` (the
 *  subject is the caller's own book) plus `headlineSlot` (which question was answered). */
export interface PortfolioExplanationResult {
  explanation: string | null;
  headline: string | null;
  state: ExplanationState;
  reason: string | null;
  resetAt: string | null;
  cached: boolean;
  toneKey: string;
  /** null ⇔ we declined — there was no question to answer. */
  headlineSlot: HeadlineSlot | null;
  sources: GroundingSources;
}

// ── THE ASKS ─────────────────────────────────────────────────────────────────────────────────────
//
// ★★ THE ASK IS STATE-DEPENDENT, AND THIS IS THE SAFETY DELTA OF THE WHOLE SURFACE.
//
// `CLOSED_WORLD_HEADER` forbids the model to compute, estimate or introduce a NUMBER that is not in
// the block. It says NOTHING about introducing a CHARACTERISATION. Hand a construction-only book —
// whose block reads "[HEALTH READ] not available — no scored holdings (coverage = 0)" — an ask that
// opens "lead with the overall reading", and a weak instruction-follower will supply a reading,
// invented whole, in a sentence containing no forbidden number and tripping no guardrail term. The
// closed world would hold and the answer would still be a lie.
//
// So the construction-only book gets a DIFFERENT ask that never mentions a verdict except to forbid
// one. Two asks, selected by `headlineSlot`, is the only shape that closes this.

/** HEALTH — the book has scored holdings and a real reading. Deliberately three sentences, for the
 *  same reason the stock ask is: tone governs register, the closed-world header governs the facts. */
export const PORTFOLIO_HEALTH_ASK =
  "Using only the facts above, explain in plain prose why this portfolio's health reads the way it does. " +
  "Lead with the overall reading, then the two or three facts that most account for it. " +
  "Do not list every number — explain what they mean together.";

/**
 * Appended to the health ask when coverage < 100%.
 *
 * ★ THE PHRASING MODEL IS story.ts's MOVEMENT 2 — "We can read the health of about 37% of it. That
 * slice scores 71 — steady." A health number over a partially-scored book is a statement about A
 * SLICE, and an explanation that presents it as a statement about the whole book is wrong in the way
 * users actually get hurt: they read one number as covering money it never touched.
 */
export const PORTFOLIO_COVERAGE_CLAUSE =
  " The health reading covers only the scored part of this book, not all of it. State what share of the " +
  "book it covers before you give the reading, and never present it as a reading of the whole portfolio.";

/**
 * CONSTRUCTION-ONLY — nothing in the book is scored.
 *
 * ⚠ NOTE WHAT IT DOES AND DOES NOT ASK FOR. It asks for SHAPE (what is held, where the weight sits)
 * and for the REASON there is no reading. It never says "verdict", "reading", "lead with", or "how
 * healthy" — and then it forbids the invented ones explicitly, by name, because a negative
 * instruction the model can pattern-match ("do not give a rating, a score, a band") is far more
 * reliable on Flash-Lite than the absence of a positive one.
 */
export const PORTFOLIO_CONSTRUCTION_ASK =
  "Using only the facts above, explain in plain prose what this portfolio is made of — its shape, what it " +
  "holds, and where its weight is concentrated. Then say plainly that its health cannot be read yet, " +
  "because none of its holdings is scored. " +
  "This book has NO health reading and NO overall verdict: do not give it a rating, a score, a band, a grade, " +
  "or a one-word summary of how good or bad it is, and do not describe it as strong, weak, healthy or risky. " +
  "Describe only the structure the facts above state. " +
  "Do not list every number — explain what they mean together.";

/** The ask for this book's state. Coverage is read off the view, never recomputed. */
export function askFor(slot: HeadlineSlot, view: PortfolioHealthView): string {
  if (slot === "construction") return PORTFOLIO_CONSTRUCTION_ASK;
  const coverage = view.snapshot?.coverageState.scoredWeight ?? 0;
  // 0.999 is the same "effectively all of it" cut movement 2 uses — one convention, not a new one.
  return coverage >= 0.999 ? PORTFOLIO_HEALTH_ASK : PORTFOLIO_HEALTH_ASK + PORTFOLIO_COVERAGE_CLAUSE;
}

/**
 * ★ THE INVALIDATION KEY — hash the SPEECH, not the floats.
 *
 * Two normalisations, and each answers a churn source the stock key never had to:
 *
 *   1. STRIP `(raw …)` — inherited verbatim from `factsKeyOf`. Grounding wraps every provenance
 *      figure in one, so this removes full-float precision the model was never permitted to speak.
 *   2. ROUND EVERY REMAINING NUMERIC TO 3 SIGNIFICANT FIGURES. ★ THE PORTFOLIO BLOCK LEAKS UNROUNDED
 *      VALUES OUTSIDE THAT CONVENTION and the stock block does not: raw rupee totals, per-instrument
 *      ₹ market values in the entity ledger, and full-precision fractions inside every finding's
 *      `bind` JSON. Without this, a price tick that moves a weight from 0.113402 to 0.113404 mints a
 *      brand-new key and throws away prose that remains true to the letter — it was only ever allowed
 *      to say "11%". Three significant figures is the granularity at which these numbers are actually
 *      spoken ("₹9.47 lakh", "11.3%"), which is the same rule the raw-strip encodes, applied to the
 *      values that escaped the convention.
 *
 * ⚠ AND THE THIRD SOURCE IS HANDLED UPSTREAM, NOT HERE. PD7's `oldestSyncAgeDays` is f(now) and would
 * rotate this key at midnight on an unchanged book — but normalising it away in the hash would leave
 * it in the PROMPT, where a cached explanation could still re-serve "synced 3 days ago" a week later.
 * Filtering the key while the prose keeps lying is not a fix. So the whole [REFERENCE FINDINGS]
 * section is dropped from the EXPLAIN fact block itself (grounding.ts, `PortfolioFactMode`) — it
 * cannot churn the key because it is not in the block, and it cannot lie because the model never saw
 * it. This function only ever receives the explain-mode block.
 *
 * Bounded residual, stated plainly: a cached explanation may quote a rupee figure that has since
 * drifted by less than 0.5%. That is the cost of a cache that survives a price tick, and it is
 * smaller than the rounding the sentence already carries.
 */
const SIG_FIGS = 3;
/** Standalone numerics only — the guards keep it off ISINs (INE001A01036), scheme codes glued to
 *  letters, and any digit that is part of a symbol like 728NTPC30B. */
const NUMERIC = /(?<![A-Za-z0-9_.])(-?\d+(?:\.\d+)?)(?![A-Za-z0-9_])/g;
const to3sf = (n: number): string => (n === 0 ? "0" : String(Number(n.toPrecision(SIG_FIGS))));

export const portfolioFactsKeyOf = (explainFactBlock: string): string => {
  const speech = explainFactBlock
    .replace(/\s*\(raw[^)]*\)/g, "")
    .replace(NUMERIC, (_m, num: string) => to3sf(Number(num)));
  return createHash("sha256").update(speech).digest("hex");
};

/**
 * Explain the authenticated user's portfolio health.
 *
 * NEVER returns null and never throws for quota/provider/guardrail reasons — unlike the stock seam
 * there is no "not found": the caller's portfolio always exists, it is merely sometimes empty. Every
 * outcome is a 200 with a `state`, which is why the controller has no 404 branch to write.
 *
 *   ┌─ FREE ───────────────────────────────────────────────────────────────────────────────────┐
 *   │ 1. grounding   groundPortfolioHealth(userId, "explain")                                   │
 *   │ 2. the GATE    two states decline here, before anything else runs                         │
 *   │ 3. tone        resolveToneForUser(userId)        fail-soft → balanced                     │
 *   │ 4. cache read  (userId, factsKey, toneKey)       ★ HIT ⇒ RETURN. Zero quota consumed.     │
 *   └──────────────────────────────────────────────────────────────────────────────────────────┘
 *   ┌─ MISS ONLY — from here on it can cost money ─────────────────────────────────────────────┐
 *   │ 5. quota       per ATTEMPT, against this user's sub-cap AND the shared per-model budget   │
 *   │ 6. generate    system = tone directive · user = header + explain facts + THE STATE'S ASK  │
 *   │ 7. guardrail   HARD hit ⇒ ONE hardened retry ⇒ else the proven deterministic fallback     │
 *   │ 8. cache write ONLY guard-clean text, approved: true, never the mock                      │
 *   └──────────────────────────────────────────────────────────────────────────────────────────┘
 */
export async function explainPortfolioHealth(userId: string): Promise<PortfolioExplanationResult> {
  // ── 1. GROUNDING (free) — FIRST, and that order is the design: it costs nothing, it is what tells
  //    us which of the four states this book is in, and it produces the cache key. Nothing billable
  //    can happen before we know whether there is even a question to answer.
  //
  // ★ "explain" MODE. The PD reference findings never reach this block — not the prompt, and so not
  //    the key either. See grounding.ts `PortfolioFactMode` for why both halves of that matter.
  const grounding = await groundPortfolioHealth(userId, "explain");
  const view = grounding.data;
  const snap = view.snapshot;

  const decline = (reason: string): PortfolioExplanationResult => ({
    explanation: null, headline: null, state: "unavailable", reason,
    resetAt: null, cached: false, toneKey: "", headlineSlot: null, sources: grounding.sources,
  });

  // ── 2. THE FOUR-STATE GATE ────────────────────────────────────────────────────────────────────
  // ★ BEFORE TONE, BEFORE THE CACHE, BEFORE QUOTA. The two declining states cost exactly one DB read
  // (the grounding that already happened) and nothing else.
  if (!snap) {
    // ⚠ TWO DISTINCT DECLINES, NOT ONE. `hasHoldings` is answered over the UNION (manual ∪ broker),
    // and telling someone who owns twelve positions that their book is empty is a false statement
    // about their money — not a rounding of one. The client renders different copy for each.
    return decline(view.hasHoldings ? "no_snapshot" : "empty_book");
  }

  // Both remaining states EXPLAIN. The slot records which question, and is carried into the ask
  // (Phase 2), the result, and the cache row.
  const headlineSlot: HeadlineSlot = snap.healthRead ? "health" : "construction";

  // ── 3. TONE (free, fail-soft → balanced) ──
  const tone = await resolveToneForUser(userId);
  const toneKey = toneKeyOf(tone);
  const factsKey = portfolioFactsKeyOf(grounding.factBlock);
  const base = { toneKey, headlineSlot, sources: grounding.sources };

  // ── 4. CACHE READ (free) — BEFORE any quota consumption, exactly as the stock seam orders it.
  //    `approved` gates it: a row the guardrail never cleared (or that a future offline judge
  //    revoked) is invisible here rather than merely flagged.
  const hit = await prisma.aiPortfolioExplanation.findUnique({
    where: { userId_factsKey_toneKey: { userId, factsKey, toneKey } },
    select: { content: true, headline: true, approved: true, headlineSlot: true },
  });
  if (hit?.approved) {
    return {
      ...base, explanation: hit.content, headline: hit.headline, state: "ok",
      reason: null, resetAt: null, cached: true,
      // The STORED slot wins: it says which question the cached prose actually answered.
      headlineSlot: (hit.headlineSlot as HeadlineSlot | null) ?? headlineSlot,
    };
  }

  // ── 5–7. QUOTA → GENERATE → GUARDRAIL (the only billable stretch) ──
  const outcome = await generateGuarded(
    createAiProvider(), // registry-resolved: AI_PROVIDER env → "mock" by default (safe, unbilled)
    tone.systemDirective,
    // ★ THE STATE'S OWN ASK. A construction-only book is never asked to lead with a reading it does
    //   not have — see askFor / PORTFOLIO_CONSTRUCTION_ASK.
    composePrompt(grounding.factBlock, askFor(headlineSlot, view)),
    spendFor(EXPLANATION_MODEL, { kind: "user", userId }),
  );

  // The fallback is proven non-advisory against BOTH the portfolio vocabulary and the runtime
  // guardrail (verify-ai-portfolio-fallback.ts) — which matters precisely because the path that
  // reaches it is the path where the model just FAILED that guardrail.
  const fallback = () => composeDeterministicPortfolioFallback(view);

  // `attempts >= 1` ⇒ we already generated once this request ⇒ serve the fallback rather than
  // nothing. The per-user sub-cap is what made a mid-request denial reachable; see onQuotaDenied.
  if (outcome.kind === "quota_denied") return onQuotaDenied(base, outcome, fallback);

  if (outcome.kind === "provider_error") {
    console.error(`[ai/explain] portfolio provider failed for ${userId}: ${outcome.message}`);
    return { ...base, explanation: fallback(), headline: null, state: "fallback", reason: "provider_error", resetAt: null, cached: false };
  }

  if (outcome.kind === "blocked") {
    // ⚠ DELIBERATELY NOT CACHED. Persisting advice-shaped text "for observability" would put it in
    // the table the read path serves from, one `approved` flag away from being served. The hard hits
    // are logged inside generateGuarded — logs are the right home for something we refuse to keep.
    return { ...base, explanation: fallback(), headline: null, state: "fallback", reason: "guardrail_blocked", resetAt: null, cached: false };
  }

  // ── 8. CACHE WRITE — clean text only, approved: true ──
  const { text, usage, attempts, verdict, priorHardHits } = outcome;

  // ⚠ MOCK NEVER REACHES THE CACHE. Placed HERE, after generation and after the guardrail, so the
  // whole flow still runs end-to-end under the stub; only the two things that would OUTLIVE the
  // request are withheld — the row, and the claim that this is a real answer.
  if (servedByMock(usage)) {
    console.warn(
      `[ai/explain] MOCK provider answered for portfolio ${userId} — not cached, not served as real. ` +
        `Set AI_PROVIDER=gemini for real explanations.`,
    );
    return { ...base, explanation: text, headline: null, state: "mock", reason: "mock_provider", resetAt: null, cached: false };
  }

  try {
    await prisma.aiPortfolioExplanation.upsert({
      where: { userId_factsKey_toneKey: { userId, factsKey, toneKey } },
      create: {
        userId, factsKey, toneKey,
        content: text, headlineSlot, approved: true, attempts,
        // On a recovered retry, keep attempt 1's HARD hits: the row that had to be re-asked is the
        // most useful evidence there is about where the spine leaks.
        hardHits: asJson(priorHardHits),
        softHits: asJson(verdict.softHits),
        model: EXPLANATION_MODEL, modelVersion: usage.modelVersion,
        promptTokens: usage.promptTokens, outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens, cacheHit: usage.cacheHit,
        snapshotId: snap.id, asOf: snap.asOf, constantVersion: snap.constantVersion,
      },
      update: { content: text, headlineSlot, approved: true, attempts, generatedAt: new Date() },
    });
  } catch (err) {
    // A cache-write failure must not deny the user an answer they already paid for.
    console.warn(`[ai/explain] portfolio cache write failed for ${userId}: ${(err as Error).message}`);
  }

  // TODO(layer-4): the OFFLINE judge sweeps `ai_portfolio_explanations` newest-first (the
  // generated_at DESC index exists for it) alongside `ai_explanations`, clearing `approved` on advice
  // the deterministic scan could not catch. It spends as a SYSTEM actor —
  // `checkAndConsumeAiCall(model, { kind: "system", job: "offline_judge" })` — metered against the
  // shared budget but taking no per-user sub-cap, since there is no user behind it. Clearing
  // `approved` is sufficient to retire a row: the read path above requires it.
  return { ...base, explanation: text, headline: null, state: "ok", reason: attempts > 1 ? "regenerated" : null, resetAt: null, cached: false };
}
