// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// EXPLAIN THIS STOCK'S HEALTH — the first Vytal surface that actually talks.
//
// The seam behind POST /api/v1/me/stocks/:symbol/explanation. It composes the five proven pieces and
// adds nothing of its own: grounding (what is true), tone (how to say it), quota (may we spend),
// the provider (say it), the guardrail (did it obey). None of them is modified here.
//
//   ┌─ FREE ───────────────────────────────────────────────────────────────────────────────────┐
//   │ 1. grounding   groundStockHealth(symbol)        null ⇒ 404. Runs FIRST, and that ORDER    │
//   │                                                  IS THE DESIGN: it costs nothing and it   │
//   │                                                  produces the cache key, so nothing       │
//   │                                                  billable can happen before we know       │
//   │                                                  whether we already have the answer.      │
//   │ 2. tone        resolveToneForUser(userId)        fail-soft → balanced                     │
//   │ 3. cache read  (stockId, factsKey, toneKey)      ★ HIT ⇒ RETURN. Zero quota consumed.     │
//   └──────────────────────────────────────────────────────────────────────────────────────────┘
//   ┌─ MISS ONLY — from here on it can cost money (generateGuarded) ───────────────────────────┐
//   │ 4. quota       checkAndConsumeAiCall  ── per ATTEMPT, so a retry is honestly billed.      │
//   │                                          SKIPPED on the mock provider: the counter means  │
//   │                                          "real Gemini calls today" and nothing else.      │
//   │ 5. generate    provider.generate(system = tone directive, user = facts + the ask)         │
//   │ 6. guardrail   scanExplanationText    ── HARD hit ⇒ ONE hardened retry ⇒ else BLOCKED     │
//   │ 7. cache write ONLY guard-clean text, approved: true                                      │
//   └──────────────────────────────────────────────────────────────────────────────────────────┘
//
// ⚠ THE CACHE READ SITS BEFORE ANY QUOTA CONSUMPTION ON PURPOSE. `checkAndConsumeAiCall` CONSUMES a
// unit as it checks — that is what makes it race-safe — so calling it before the cache would bill
// every cache hit. With 480 calls/day shared across every user, that inversion alone would take the
// feature from "affordable" to "dark by mid-morning".
//
// ⚠ AND GROUNDING SITS BEFORE THE CACHE, which is the less obvious half: the cache key is a hash OF
// the fact block, so there is no way to look up the cache without first building the facts. Grounding
// is free and DB-read-only, so this costs nothing but a read — and it is what makes the cache
// self-invalidating: when the facts change, the key changes, and the stale row is simply never found.
//
// ★ WHAT THE MODEL RECEIVES IS EXHAUSTIVELY TWO THINGS: `tone.systemDirective` (how to speak + the
// non-advisory spine + the conversational-precision clause) as the system instruction, and
// `CLOSED_WORLD_HEADER + factBlock + EXPLANATION_ASK` as the single user message. No user identity,
// no portfolio, no holdings, no free-text input, no conversation history. Hallucination is prevented
// by construction — there is nothing in the context to invent FROM except the enumerated facts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { groundStockHealth, type GroundingSources } from "../grounding.js";
import { resolveToneForUser } from "../tone.js";
import { createAiProvider } from "../registry.js";
import type { HealthSnapshotView } from "../../scoring/read/health-view.types.js";
import {
  asJson, composePrompt, generateGuarded, onQuotaDenied, servedByMock, spendFor, toneKeyOf,
  EXPLANATION_MODEL, type ExplanationState,
} from "./shared.js";

// ── RE-EXPORTED so every existing importer of this module keeps resolving unchanged. The pieces
//    moved to ./shared.js when the portfolio surface became a second caller; nothing about them
//    changed, and nothing that imports them from here has to know they travelled. ──
export {
  asJson, composePrompt, generateGuarded, onQuotaDenied, mockByConfig, servedByMock, spendFor,
  toneKeyOf, EXPLANATION_MODEL, MAX_TOKENS, TEMPERATURE, HARDENED_REINFORCEMENT,
} from "./shared.js";
export type { GuardedOutcome, Spend, ExplanationState, ExplanationOutcomeFields } from "./shared.js";

/** ── THE ASK ── deliberately three sentences. The tone directive already governs register, jargon,
 *  depth, precision and the non-advisory spine; the closed-world header already governs the facts.
 *  Anything more here would be a fourth home for rules that already have one. */
export const EXPLANATION_ASK =
  "Using only the facts above, explain in plain prose why this stock's health reads the way it does. " +
  "Lead with the overall verdict, then the two or three facts that most account for it. " +
  "Do not list every number — explain what they mean together.";

/** What the user's client gets back. `explanation: null` and the deterministic fallback are
 *  FIRST-CLASS states, not errors — and `state` always says which path served the text, because a
 *  surface that hides having fallen back is a surface nobody can debug or trust. */
export interface StockExplanationResult {
  symbol: string;
  explanation: string | null;
  headline: string | null;
  /** "ok" ⇒ model text, cached · "fallback" ⇒ deterministic text served (guardrail/provider) ·
   *  "unavailable" ⇒ budget spent, no text at all · "mock" ⇒ the stub provider answered; the text
   *  is a placeholder, it was NOT cached, and no client should present it as a real explanation. */
  state: ExplanationState;
  reason: string | null;
  /** Pacific-midnight rollover, present only when the budget is what stopped us. */
  resetAt: string | null;
  cached: boolean;
  toneKey: string;
  sources: GroundingSources;
}

/**
 * ★ THE INVALIDATION KEY. Hash the fact block with its `(raw …)` parentheticals REMOVED — i.e. hash
 * exactly what the model is PERMITTED TO SAY, which after grounding's rounding is the display-precision
 * numbers and nothing else.
 *
 * ⚠ Hashing the block verbatim would be wrong, and the reason is the whole argument for this key: the
 * raws carry full float precision, so a live rescore nudging a composite 73.5321 → 73.5340 would change
 * the hash and throw away a cached explanation that remains true to the letter — it was only ever
 * allowed to say "74". Strip the provenance, hash the speech. The cache then expires precisely when a
 * citable number moves at the precision it is cited, and not one moment sooner.
 */
export const factsKeyOf = (factBlock: string): string =>
  createHash("sha256").update(factBlock.replace(/\s*\(raw[^)]*\)/g, "")).digest("hex");

/** The single user message for THIS surface — the shared composer bound to the stock ask. Kept as a
 *  named export because it is the stock prompt, while the shared `composePrompt` is deliberately
 *  ask-agnostic (the portfolio's ask varies by state). Output is byte-identical to the string this
 *  file assembled inline before the extraction. */
export const buildPrompt = (factBlock: string): string => composePrompt(factBlock, EXPLANATION_ASK);

// ── THE DETERMINISTIC FALLBACK ────────────────────────────────────────────────────────────────────
/**
 * ★ WHY THIS IS THE RIGHT FALLBACK, AND WHY IT IS NOT A PORT OF THE FRONTEND'S buildDiagnosis.
 *
 * The fallback fires exactly when the AI output FAILED the advice guardrail. So the fallback itself
 * must be safe, and "safe because I wrote it carefully" is the weakest possible guarantee at exactly
 * the moment the strongest is needed.
 *
 * ⚠ CORRECTED — THIS COMMENT USED TO CLAIM A PROOF THAT DOES NOT COVER THESE STRINGS. It said the
 * lens `verdict` sentences "are composed server-side from LM_CATALOG/LP_CATALOG, and that catalog is
 * asserted advice-free at BUILD TIME by `assertNoForwardLanguage()`". The first half is false and the
 * second half is therefore irrelevant: `verdict` is NOT the catalog's `fieldVerdict`. It is composed
 * by `composeLmVerdict`/`composeLpVerdict` in scoring/lens-patterns/standing-context.ts — whose
 * `_fieldVerdict` parameter is UNUSED, underscore and all — from sentences authored in THAT file.
 * `assertNoForwardLanguage()` sweeps LM_CATALOG/LP_CATALOG faces only and has never seen them, and
 * nothing else scanned standing-context.ts either. The bulk of this function's output was unproven
 * prose behind a comment asserting it was proven, which is worse than prose known to be unproven.
 *
 * ★ THE PROOF NOW EXISTS AND IS THE REAL ONE: verify-ai-portfolio-fallback.ts §4 scans this function's
 * output across the live universe AND enumerates the standing-context verdict corpus exhaustively
 * (LP1–6 × band × shares, LM1–8 × band — every reachable branch, not a sample), against the shared
 * forward vocabulary AND `scanExplanationText` — the SAME runtime guardrail whose failure is what
 * summons this fallback in the first place. All 28 corpus sentences and all 95 composed fallbacks pass.
 * Cite that file here, not a gate that sweeps a different module.
 *
 * Everything here is read off `grounding.data`; nothing is recomputed and no number is derived. The
 * scores are rounded with the same Math.round the fact block and the UI use, so the fallback and the
 * page cannot disagree either.
 */
export function composeDeterministicFallback(view: HealthSnapshotView): string {
  const id = view.identity;
  const vd = view.verdict;
  if (!view.scored || !vd) {
    return `${id.name} (${id.symbol}) is not currently scored, so no health reading exists for it.`;
  }

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const parts: string[] = [`${id.name} (${id.symbol}) scores ${Math.round(vd.composite)} — ${vd.label.label}.`];

  if (vd.trajectoryMarker) parts.push(`The trajectory is ${vd.trajectoryMarker}.`);

  if (vd.divergence.high && vd.divergence.low) {
    const spread = vd.divergence.flag === "wide" ? ", a wide spread between the two" : "";
    parts.push(
      `Its strongest pillar is ${cap(vd.divergence.high.pillar)} at ${Math.round(vd.divergence.high.subtotal)} ` +
        `and its weakest is ${cap(vd.divergence.low.pillar)} at ${Math.round(vd.divergence.low.subtotal)}${spread}.`,
    );
  }

  // The fired lens sentences — verbatim, catalog-derived, already CI-proven non-advisory.
  for (const p of view.pillars) {
    for (const lp of p.lensPillarPatterns ?? []) if (lp.verdict) parts.push(lp.verdict);
    for (const m of p.metrics ?? []) if (m.lensPattern?.verdict) parts.push(m.lensPattern.verdict);
  }

  return parts.join(" ");
}

/**
 * Explain one stock's health for one user. Returns null ⇔ the symbol is not in the universe (the
 * caller maps that to 404, mirroring GET /api/stocks/:symbol/health). Never throws for quota,
 * provider or guardrail reasons — those are states, not failures.
 */
export async function explainStockHealth(userId: string, symbol: string): Promise<StockExplanationResult | null> {
  // ── 1. GROUNDING (free) — the facts, and therefore the cache key ──
  const grounding = await groundStockHealth(symbol);
  if (!grounding) return null; // not in the universe → 404

  // ── 2. TONE (free, fail-soft) ──
  const tone = await resolveToneForUser(userId);
  const toneKey = toneKeyOf(tone);
  const factsKey = factsKeyOf(grounding.factBlock);
  const base = { symbol: grounding.data.identity.symbol, toneKey, sources: grounding.sources };

  // The cache is keyed on the stock ROW, not the symbol — symbols drift, ids do not (the same
  // reasoning the schema gives for keying on isin elsewhere).
  const stock = await prisma.stock.findUnique({ where: { symbol: base.symbol }, select: { id: true } });
  if (!stock) return null;

  // ── 3. CACHE READ (free) — BEFORE any quota consumption. `approved` gates it: a row the guardrail
  //     never cleared (or that the offline judge later revoked) is invisible here, not merely flagged.
  const hit = await prisma.aiExplanation.findUnique({
    where: { stockId_factsKey_toneKey: { stockId: stock.id, factsKey, toneKey } },
    select: { content: true, headline: true, approved: true },
  });
  if (hit?.approved) {
    return { ...base, explanation: hit.content, headline: hit.headline, state: "ok", reason: null, resetAt: null, cached: true };
  }

  // ── 4–6. QUOTA → GENERATE → GUARDRAIL (the only billable stretch) ──
  const outcome = await generateGuarded(
    createAiProvider(), // registry-resolved: AI_PROVIDER env → "mock" by default (safe, unbilled)
    tone.systemDirective,
    // The ASSEMBLED prompt — this surface owns its own ask (see buildPrompt). Byte-identical to
    // what the loop used to build for itself before the ask became per-surface.
    buildPrompt(grounding.factBlock),
    // real provider ⇒ the quota gate, against BOTH this user's daily sub-cap and the shared
    // per-model budget; mock ⇒ unmetered, see spendFor. The actor is declared, never inferred.
    spendFor(EXPLANATION_MODEL, { kind: "user", userId }),
  );

  const fallback = () => composeDeterministicFallback(grounding.data);

  // Never a 500 — a spent budget is a state. `attempts` decides between the deterministic fallback
  // and honest-empty; see onQuotaDenied for why a mid-request denial must not cost the user prose.
  if (outcome.kind === "quota_denied") return onQuotaDenied(base, outcome, fallback);

  if (outcome.kind === "provider_error") {
    console.error(`[ai/explain] provider failed for ${base.symbol}: ${outcome.message}`);
    return { ...base, explanation: fallback(), headline: null, state: "fallback", reason: "provider_error", resetAt: null, cached: false };
  }

  if (outcome.kind === "blocked") {
    // ⚠ DELIBERATELY NOT CACHED. Persisting it "for observability" would put advice-shaped text in the
    // table the read path serves from, one `approved` flag away from being served. The hits are logged
    // (above, in generateGuarded) — logs are the right home for something we refuse to keep.
    return { ...base, explanation: fallback(), headline: null, state: "fallback", reason: "guardrail_blocked", resetAt: null, cached: false };
  }

  // ── 7. CACHE WRITE — clean text only, approved: true ──
  const { text, usage, attempts, verdict, priorHardHits } = outcome;

  // ⚠ MOCK NEVER REACHES THE CACHE. Placed HERE, after generation and after the guardrail, so the
  // whole flow still runs end-to-end under the stub (local dev exercises grounding → tone → quota →
  // generate → guard exactly as production does); only the two things that would OUTLIVE the request
  // are withheld — the row, and the claim that this is a real answer. `state: "mock"` is deliberately
  // its own value rather than "ok" with a flag: a client that forgets to read a flag renders a
  // placeholder as fact, whereas an unrecognised state cannot be mistaken for the success case.
  if (servedByMock(usage)) {
    console.warn(
      `[ai/explain] MOCK provider answered for ${base.symbol} — not cached, not served as real. ` +
        `Set AI_PROVIDER=gemini for real explanations.`,
    );
    return { ...base, explanation: text, headline: null, state: "mock", reason: "mock_provider", resetAt: null, cached: false };
  }

  try {
    await prisma.aiExplanation.upsert({
      where: { stockId_factsKey_toneKey: { stockId: stock.id, factsKey, toneKey } },
      create: {
        stockId: stock.id, factsKey, toneKey,
        content: text, approved: true, attempts,
        // On a recovered retry, keep attempt 1's HARD hits: the row that had to be re-asked is the
        // most useful evidence there is about where the spine leaks.
        hardHits: asJson(priorHardHits),
        softHits: asJson(verdict.softHits),
        model: EXPLANATION_MODEL, modelVersion: usage.modelVersion,
        promptTokens: usage.promptTokens, outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens, cacheHit: usage.cacheHit,
        asOfDate: grounding.sources.asOfDate, periodKey: grounding.sources.periodKey,
        snapshotType: grounding.sources.snapshotType,
      },
      update: { content: text, approved: true, attempts, generatedAt: new Date() },
    });
  } catch (err) {
    // A cache-write failure must not deny the user an answer they already paid for.
    console.warn(`[ai/explain] cache write failed for ${base.symbol}: ${(err as Error).message}`);
  }

  // TODO(layer-4): an OFFLINE judge sweeping `ai_explanations` newest-first (the generated_at DESC
  // index exists for it), clearing `approved` on advice the deterministic scan could not catch —
  // hedged constructions no regex covers. Deliberately NOT inline: an inline second model pass would
  // DOUBLE the per-request cost (480 → 240 explanations/day), whereas an async sweep over a cache of
  // a few hundred rows bounds the spend by CORPUS size rather than by traffic. Clearing `approved`
  // is sufficient to retire a row: the read path above requires it.
  //
  // ⚠ IT SPENDS AS A SYSTEM ACTOR: `checkAndConsumeAiCall(model, { kind: "system", job: "offline_judge" })`.
  // It is metered against the shared per-model budget like everything else, but it takes NO per-user
  // sub-cap — there is no user behind it, and `Actor` makes that something the sweep has to SAY rather
  // than something it gets by leaving an argument off (src/ai/quota.ts, `Actor`).
  return { ...base, explanation: text, headline: null, state: "ok", reason: attempts > 1 ? "regenerated" : null, resetAt: null, cached: false };
}
