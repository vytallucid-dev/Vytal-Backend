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
import { groundStockHealth, CLOSED_WORLD_HEADER, type GroundingSources } from "../grounding.js";
import { resolveToneForUser, type ToneDirective } from "../tone.js";
import { checkAndConsumeAiCall, recordAiTokens, type QuotaDecision } from "../quota.js";
import { createAiProvider } from "../registry.js";
import { scanExplanationText, type GuardrailVerdict } from "../guardrail.js";
import type { AiProvider, TokenUsage } from "../types.js";
import type { HealthSnapshotView } from "../../scoring/read/health-view.types.js";
import type { Prisma } from "../../generated/prisma/client.js";

/** Prisma's `InputJsonValue` requires an index signature that a DECLARED interface (HardHit/SoftHit)
 *  does not carry, though the runtime values are plain JSON records. The cast is a type-system
 *  formality, not a claim about the data. Empty ⇒ undefined, so an empty array is never persisted as
 *  a meaningless `[]` where "nothing fired" is better said with NULL. */
const asJson = <T>(v: readonly T[] | null | undefined): Prisma.InputJsonValue | undefined =>
  v && v.length ? (v as unknown as Prisma.InputJsonValue) : undefined;

/** The model this surface runs on. Flash-Lite, deliberately: its 500 RPD (budgeted 480) is the only
 *  free-tier allowance large enough to serve a real universe. It is the weaker instruction-follower,
 *  which is precisely why the output guardrail exists rather than trusting the spine alone. */
export const EXPLANATION_MODEL = "gemini-3.5-flash-lite";

/** Generous on purpose. Gemini 3.x models THINK before answering and thinking tokens are drawn from
 *  the same output budget — a small cap yields an empty `text` with outputTokens 0, which looks like
 *  an adapter bug and is not one. */
const MAX_TOKENS = 2048;
/** Low but not zero: this is exposition over a fixed fact set, not creative writing. */
const TEMPERATURE = 0.3;

/** ── THE ASK ── deliberately three sentences. The tone directive already governs register, jargon,
 *  depth, precision and the non-advisory spine; the closed-world header already governs the facts.
 *  Anything more here would be a fourth home for rules that already have one. */
export const EXPLANATION_ASK =
  "Using only the facts above, explain in plain prose why this stock's health reads the way it does. " +
  "Lead with the overall verdict, then the two or three facts that most account for it. " +
  "Do not list every number — explain what they mean together.";

/** Appended to the system instruction for the ONE retry after a HARD guardrail hit. It names the
 *  failure explicitly, because a repeat of the same instruction that already failed is not a retry. */
export const HARDENED_REINFORCEMENT =
  " CRITICAL — YOUR PREVIOUS ANSWER WAS REJECTED FOR CONTAINING ADVICE. Do not tell the reader what " +
  "to do, what to watch, what to consider, what to keep an eye on, or what might be worth doing. Do " +
  "not address the reader with instructions or suggestions, however gently phrased. Every sentence " +
  "must be a statement of fact about this company's measured health — never a suggestion about the " +
  "reader's actions.";

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
  state: "ok" | "fallback" | "unavailable" | "mock";
  reason: string | null;
  /** Pacific-midnight rollover, present only when the budget is what stopped us. */
  resetAt: string | null;
  cached: boolean;
  toneKey: string;
  sources: GroundingSources;
}

/** The resolved directive's identity — the cache dimension. NOT the user: aiLevel × ledger collapses
 *  to 7 distinct triples, so keying on this shares one generation across everyone who reads alike,
 *  where keying on userId would mint a row per person and destroy the cache's whole economy. */
export const toneKeyOf = (t: ToneDirective): string => `${t.level}:${t.depth}:${t.jargon}`;

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

/** The single user message. Header first (the rule), facts second (the world), ask last (the task). */
export const buildPrompt = (factBlock: string): string =>
  `${CLOSED_WORLD_HEADER}\n\n${factBlock}\n\n${EXPLANATION_ASK}`;

// ── ⚠ MOCK DETECTION — the guard that keeps the SAFE default from being a SILENT-WRONG default ────
//
// The registry falls back to the mock adapter when AI_PROVIDER is unset, which is the right boot
// posture: no key, no network, no bill. But it is only safe for the CALL. Without this guard the
// cache would happily persist "[mock] The following are the ONLY facts…" as an APPROVED explanation
// — and from that moment the cache serves it forever, at zero cost, with `state: "ok"`, long after
// the real provider is configured. A misconfiguration that lasts one minute would poison rows that
// outlive it, and nothing anywhere would report an error. That is the worst failure shape available:
// not a crash, not an outage, but a confident wrong answer with a plausible provenance row behind it.
//
// TWO SIGNALS, AND — THE POINT — TWO DIFFERENT DECISION POINTS. They are not redundant copies of
// one check; each is the ONLY signal available where it is used, because they exist at different
// times relative to the call:
//
//   1. CONFIG (pre-call, `mockByConfig`) — the same env the registry reads. Known BEFORE anything is
//      generated, which is what makes it the only usable signal for THE SPEND DECISION: by the time a
//      response exists you have already spent. Cost: the duplicated `?? "mock"` default, a second home
//      for one rule. Accepted deliberately, because the disagreement is one-directional — if the
//      registry's default ever changed to something real while this stayed "mock", this skips the gate
//      for a real call (undercounting one unit) and declines to cache something cacheable. Both are
//      errors in the direction of doing less, never in the direction of poisoning the cache.
//   2. RESPONSE (post-call, `servedByMock`) — `usage.modelVersion`, documented as "the model that
//      actually served the call". Guards THE CACHE-WRITE DECISION only, and catches what config cannot
//      see: a registry mapping bug where AI_PROVIDER=gemini resolves to a stub. Matched by PREFIX
//      rather than pinned to the adapter's exact `MOCK_MODEL_VERSION` constant, so it is not coupled
//      to that literal and any future stub named mock-ish is caught too.
//
// ⚠ NOT SOLVED BY ASKING THE PROVIDER, and that is on purpose: `AiProvider` exposes no identity
// because it is dumb transport (types.ts: "ZERO Vytal business logic"). Adding an id to the shared
// interface so that ONE caller can sniff it would push a caller's concern into the contract every
// other caller has to carry. The env is already the source of truth for the choice; read that.
const MOCK_PROVIDER_ID = "mock";

/** PRE-CALL signal — the only one that exists in time to decide whether to spend. */
const mockByConfig = (): boolean => (process.env.AI_PROVIDER ?? MOCK_PROVIDER_ID) === MOCK_PROVIDER_ID;

/** POST-CALL signal — guards the cache write. Conservative: either signal is enough to refuse. */
function servedByMock(usage: TokenUsage): boolean {
  return mockByConfig() || usage.modelVersion.toLowerCase().startsWith(MOCK_PROVIDER_ID);
}

/**
 * The spend gate for THIS request. Mock calls never leave the process, so metering them would make
 * the counter mean something other than what it claims.
 *
 * ★ THE COUNTER'S MEANING IS THE WHOLE POINT. `ai_usage_counters` is the record of REAL GEMINI CALLS
 * MADE TODAY — it is what the free-tier RPD is checked against, and what a future spend-based limit
 * will be built on. Counting stub calls in it corrupts that meaning twice over: the number stops
 * matching Google's own, AND a developer exercising the flow on mock silently eats the SAME shared
 * 480/day the live feature draws from. A dev-loop that can dark the production feature is not a
 * safe default, however cheap the calls themselves are.
 */
function spendFor(model: string): Spend {
  if (!mockByConfig()) return () => checkAndConsumeAiCall(model);
  // Unmetered: `limit: 0` with `allowed: true` is deliberately self-describing — anything reading
  // this decision sees at once that no budget applies, rather than a plausible-looking fake one.
  // `resetAt` is unreachable in practice (the caller reads it only on the denied branch, and this
  // never denies); the epoch makes it obviously a sentinel if it ever surfaces.
  return async () => ({ allowed: true, remaining: 0, limit: 0, resetAt: new Date(0), reason: "mock_provider_unmetered" });
}

// ── THE DETERMINISTIC FALLBACK ────────────────────────────────────────────────────────────────────
/**
 * ★ WHY THIS IS THE RIGHT FALLBACK, AND WHY IT IS NOT A PORT OF THE FRONTEND'S buildDiagnosis.
 *
 * The fallback fires exactly when the AI output FAILED the advice guardrail. So the fallback itself
 * must be safe, and "safe because I wrote it carefully" is the weakest possible guarantee at exactly
 * the moment the strongest is needed. These lens `verdict` sentences are composed server-side from
 * LM_CATALOG/LP_CATALOG, and that catalog is asserted advice-free at BUILD TIME by the existing
 * `assertNoForwardLanguage()` gate. The safe path is safe by a proof that already exists and already
 * runs in CI — defence in depth, not a second author's judgment.
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

// ── THE GUARDED GENERATION LOOP ───────────────────────────────────────────────────────────────────
export type GuardedOutcome =
  | { kind: "clean"; text: string; usage: TokenUsage; attempts: number; verdict: GuardrailVerdict; priorHardHits: GuardrailVerdict["hardHits"] | null }
  | { kind: "blocked"; attempts: number; hardHits: GuardrailVerdict["hardHits"] }
  | { kind: "quota_denied"; decision: QuotaDecision; attempts: number }
  | { kind: "provider_error"; attempts: number; message: string };

/** Consume one unit of budget. Injected so the loop below is testable without a live counter. */
export type Spend = () => Promise<QuotaDecision>;

/**
 * Generate → guard → (on a HARD hit) ONE hardened retry → guard again. Every attempt spends a unit
 * FIRST, so a retry is honestly billed rather than smuggled in free.
 *
 * ⚠ EXPORTED, and `provider`/`spend` are injected, SO THE FAILURE PATH IS TESTABLE. A guardrail whose
 * blocked branch has never been executed is a branch nobody knows works — and it cannot be exercised
 * through the public seam, because that would mean coaxing a live model into misbehaving on demand.
 * This is the same reasoning as the mailer's injectable seam in alerts/email/mailer.ts.
 */
export async function generateGuarded(
  provider: AiProvider,
  systemDirective: string,
  factBlock: string,
  spend: Spend,
): Promise<GuardedOutcome> {
  const prompt = buildPrompt(factBlock);
  let priorHardHits: GuardrailVerdict["hardHits"] | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const decision = await spend();
    if (!decision.allowed) return { kind: "quota_denied", decision, attempts: attempt - 1 };

    // The retry names the failure; repeating an instruction that already failed is not a retry.
    const system = attempt === 1 ? systemDirective : systemDirective + HARDENED_REINFORCEMENT;

    let text: string;
    let usage: TokenUsage;
    try {
      const res = await provider.generate({
        system,
        messages: [{ role: "user", content: prompt }],
        model: EXPLANATION_MODEL,
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
      });
      text = res.text;
      usage = res.usage;
    } catch (err) {
      return { kind: "provider_error", attempts: attempt, message: (err as Error).message };
    }

    // Best-effort, never throws — a token-accounting failure must not break a working answer.
    await recordAiTokens(EXPLANATION_MODEL, usage.promptTokens + usage.outputTokens);

    const verdict = scanExplanationText(text);
    if (verdict.clean) return { kind: "clean", text, usage, attempts: attempt, verdict, priorHardHits };

    // SOFT hits never reach here — only a HARD hit is a block. Logged either way (below).
    console.warn(
      `[ai/explain] guardrail HARD hit (attempt ${attempt}): ` +
        verdict.hardHits.map((h) => `${h.term}→"${h.match}"`).join(", "),
    );
    priorHardHits = verdict.hardHits;
    if (attempt === 2) return { kind: "blocked", attempts: 2, hardHits: verdict.hardHits };
  }
  /* c8 ignore next */
  return { kind: "blocked", attempts: 2, hardHits: priorHardHits ?? [] };
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
    grounding.factBlock,
    spendFor(EXPLANATION_MODEL), // real provider ⇒ the quota gate; mock ⇒ unmetered, see spendFor
  );

  const fallback = () => composeDeterministicFallback(grounding.data);

  if (outcome.kind === "quota_denied") {
    // Honest-empty, never a 500. The client keeps its deterministic diagnosis and learns when to retry.
    return {
      ...base, explanation: null, headline: null, state: "unavailable",
      reason: outcome.decision.reason ?? "quota_denied",
      resetAt: outcome.decision.resetAt.toISOString(), cached: false,
    };
  }

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
  return { ...base, explanation: text, headline: null, state: "ok", reason: attempts > 1 ? "regenerated" : null, resetAt: null, cached: false };
}
