// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE EXPLANATION MACHINERY — everything the stock and portfolio surfaces genuinely SHARE.
//
// ── WHAT BELONGS HERE, AND WHAT DELIBERATELY DOES NOT ───────────────────────────────────────────
//
// This file holds the parts whose correctness is about SPENDING AND SAFETY — the guarded generation
// loop, the quota seam, the mock guard, the model parameters. Those are not per-surface opinions;
// they are one rule that must hold everywhere.
//
// It does NOT hold the orchestration. Each surface keeps its own ~120-line service that reads
// top-to-bottom, because the two flows genuinely differ (a stock 404s on an unknown symbol; a
// portfolio declines four ways and never 404s) and a single parameterised `explain()` would spend
// its life re-deriving which surface it is. Two readable services beat one clever one.
//
// ── ★ THE MOCK GUARD IS THE REASON THIS FILE EXISTS AT ALL ──────────────────────────────────────
//
// `mockByConfig` / `servedByMock` / `spendFor` encode ONE rule: a stub answer must never reach a
// cache, and a stub call must never be metered. A second, hand-rolled copy of that rule in the
// portfolio service is not duplication of code — it is a SECOND HOME FOR A SAFETY INVARIANT, and the
// failure mode when the copies drift is the worst shape available: a confident wrong answer with a
// plausible provenance row behind it, served forever at zero cost with `state: "ok"`. So it moved
// here the moment a second caller existed, and it is imported, never re-derived.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { checkAndConsumeAiCall, type QuotaDecision, type Actor } from "../quota.js";
import { recordAiTokens } from "../quota.js";
import { scanExplanationText, type GuardrailVerdict } from "../guardrail.js";
import { CLOSED_WORLD_HEADER } from "../grounding.js";
import type { AiProvider, TokenUsage } from "../types.js";
import type { Prisma } from "../../generated/prisma/client.js";

/** Prisma's `InputJsonValue` requires an index signature that a DECLARED interface (HardHit/SoftHit)
 *  does not carry, though the runtime values are plain JSON records. The cast is a type-system
 *  formality, not a claim about the data. Empty ⇒ undefined, so an empty array is never persisted as
 *  a meaningless `[]` where "nothing fired" is better said with NULL. */
export const asJson = <T>(v: readonly T[] | null | undefined): Prisma.InputJsonValue | undefined =>
  v && v.length ? (v as unknown as Prisma.InputJsonValue) : undefined;

/** The model both surfaces run on. Flash-Lite, deliberately: its 500 RPD (budgeted 480) is the only
 *  free-tier allowance large enough to serve a real universe. It is the weaker instruction-follower,
 *  which is precisely why the output guardrail exists rather than trusting the spine alone. */
export const EXPLANATION_MODEL = "gemini-3.5-flash-lite";

/** Generous on purpose. Gemini 3.x models THINK before answering and thinking tokens are drawn from
 *  the same output budget — a small cap yields an empty `text` with outputTokens 0, which looks like
 *  an adapter bug and is not one. */
export const MAX_TOKENS = 2048;
/** Low but not zero: this is exposition over a fixed fact set, not creative writing. */
export const TEMPERATURE = 0.3;

/** Appended to the system instruction for the ONE retry after a HARD guardrail hit. It names the
 *  failure explicitly, because a repeat of the same instruction that already failed is not a retry.
 *  Surface-agnostic by construction — it forbids ADVICE, and says nothing about stocks or books. */
export const HARDENED_REINFORCEMENT =
  " CRITICAL — YOUR PREVIOUS ANSWER WAS REJECTED FOR CONTAINING ADVICE. Do not tell the reader what " +
  "to do, what to watch, what to consider, what to keep an eye on, or what might be worth doing. Do " +
  "not address the reader with instructions or suggestions, however gently phrased. Every sentence " +
  "must be a statement of fact about this company's measured health — never a suggestion about the " +
  "reader's actions.";

/** The resolved directive's identity — the cache dimension. NOT the user: aiLevel × ledger collapses
 *  to 7 distinct triples, so keying on this shares one generation across everyone who reads alike,
 *  where keying on userId would mint a row per person and destroy the cache's whole economy.
 *  (On the PORTFOLIO surface the row is per-user regardless; the tone key stays in the key there so a
 *  register change cannot serve prose written in the reader's old voice.) */
export const toneKeyOf = (t: { level: string; depth: string; jargon: string }): string =>
  `${t.level}:${t.depth}:${t.jargon}`;

/** The single user message. Header first (the rule), facts second (the world), ask last (the task).
 *  ★ THE ASK IS A PARAMETER because it is the one genuinely per-surface piece of the prompt — and in
 *  the portfolio's case it varies per STATE (a construction-only book must never be asked to lead
 *  with a verdict it does not have). */
export const composePrompt = (factBlock: string, ask: string): string =>
  `${CLOSED_WORLD_HEADER}\n\n${factBlock}\n\n${ask}`;

/** The result states every explanation surface reports. `explanation: null` and the deterministic
 *  fallback are FIRST-CLASS states, not errors — and `state` always says which path served the text,
 *  because a surface that hides having fallen back is a surface nobody can debug or trust. */
export type ExplanationState = "ok" | "fallback" | "unavailable" | "mock";

/** The outcome half of every explanation result — the fields that do NOT depend on the subject. */
export interface ExplanationOutcomeFields {
  explanation: string | null;
  headline: string | null;
  state: ExplanationState;
  reason: string | null;
  /** Pacific-midnight rollover, present only when the budget is what stopped us. */
  resetAt: string | null;
  cached: boolean;
}

// ── ⚠ MOCK DETECTION — the guard that keeps the SAFE default from being a SILENT-WRONG default ────
//
// The registry falls back to the mock adapter when AI_PROVIDER is unset, which is the right boot
// posture: no key, no network, no bill. But it is only safe for the CALL. Without this guard the
// cache would happily persist "[mock] The following are the ONLY facts…" as an APPROVED explanation
// — and from that moment the cache serves it forever, at zero cost, with `state: "ok"`, long after
// the real provider is configured. A misconfiguration that lasts one minute would poison rows that
// outlive it, and nothing anywhere would report an error.
//
// TWO SIGNALS, AND — THE POINT — TWO DIFFERENT DECISION POINTS. They are not redundant copies of
// one check; each is the ONLY signal available where it is used, because they exist at different
// times relative to the call:
//
//   1. CONFIG (pre-call, `mockByConfig`) — the same env the registry reads. Known BEFORE anything is
//      generated, which is what makes it the only usable signal for THE SPEND DECISION: by the time a
//      response exists you have already spent.
//   2. RESPONSE (post-call, `servedByMock`) — `usage.modelVersion`, documented as "the model that
//      actually served the call". Guards THE CACHE-WRITE DECISION only, and catches what config cannot
//      see: a registry mapping bug where AI_PROVIDER=gemini resolves to a stub. Matched by PREFIX
//      rather than pinned to the adapter's exact `MOCK_MODEL_VERSION` constant.
//
// ⚠ NOT SOLVED BY ASKING THE PROVIDER, and that is on purpose: `AiProvider` exposes no identity
// because it is dumb transport (types.ts: "ZERO Vytal business logic").
const MOCK_PROVIDER_ID = "mock";

/** PRE-CALL signal — the only one that exists in time to decide whether to spend. */
export const mockByConfig = (): boolean => (process.env.AI_PROVIDER ?? MOCK_PROVIDER_ID) === MOCK_PROVIDER_ID;

/** POST-CALL signal — guards the cache write. Conservative: either signal is enough to refuse. */
export function servedByMock(usage: TokenUsage): boolean {
  return mockByConfig() || usage.modelVersion.toLowerCase().startsWith(MOCK_PROVIDER_ID);
}

/** Consume one unit of budget. Injected so the loop below is testable without a live counter. */
export type Spend = () => Promise<QuotaDecision>;

/**
 * The spend gate for THIS request. Mock calls never leave the process, so metering them would make
 * the counter mean something other than what it claims.
 *
 * ★ THE COUNTER'S MEANING IS THE WHOLE POINT. `ai_usage_counters` is the record of REAL GEMINI CALLS
 * MADE TODAY — it is what the free-tier RPD is checked against. Counting stub calls in it corrupts
 * that meaning twice over: the number stops matching Google's own, AND a developer exercising the
 * flow on mock silently eats the SAME shared 480/day the live feature draws from.
 *
 * `actor` is threaded through to the per-user sub-cap (see quota.ts `Actor`): a real call is metered
 * against BOTH this user's daily allowance and the shared per-model budget.
 */
export function spendFor(model: string, actor: Actor): Spend {
  if (!mockByConfig()) return () => checkAndConsumeAiCall(model, actor);
  // Unmetered: `limit: 0` with `allowed: true` is deliberately self-describing — anything reading
  // this decision sees at once that no budget applies, rather than a plausible-looking fake one.
  return async () => ({ allowed: true, remaining: 0, limit: 0, resetAt: new Date(0), scopeDenied: null, reason: "mock_provider_unmetered" });
}

// ── THE GUARDED GENERATION LOOP ───────────────────────────────────────────────────────────────────
export type GuardedOutcome =
  | { kind: "clean"; text: string; usage: TokenUsage; attempts: number; verdict: GuardrailVerdict; priorHardHits: GuardrailVerdict["hardHits"] | null }
  | { kind: "blocked"; attempts: number; hardHits: GuardrailVerdict["hardHits"] }
  | { kind: "quota_denied"; decision: QuotaDecision; attempts: number }
  | { kind: "provider_error"; attempts: number; message: string };

/**
 * Generate → guard → (on a HARD hit) ONE hardened retry → guard again. Every attempt spends a unit
 * FIRST, so a retry is honestly billed rather than smuggled in free.
 *
 * ★ TAKES THE ASSEMBLED PROMPT, NOT THE FACT BLOCK. Prompt assembly is the surface's own business —
 * the portfolio's ask varies by STATE — and a shared loop that reached for one surface's ASK constant
 * would have made this file surface-specific in its most load-bearing function.
 *
 * ⚠ EXPORTED, and `provider`/`spend` are injected, SO THE FAILURE PATH IS TESTABLE. A guardrail whose
 * blocked branch has never been executed is a branch nobody knows works — and it cannot be exercised
 * through the public seam, because that would mean coaxing a live model into misbehaving on demand.
 */
export async function generateGuarded(
  provider: AiProvider,
  systemDirective: string,
  prompt: string,
  spend: Spend,
): Promise<GuardedOutcome> {
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
 * ★★ QUOTA DENIED — AND WHETHER ANYTHING WAS ALREADY GENERATED DECIDES WHAT THE USER GETS.
 *
 * ⚠ THE PER-USER SUB-CAP CREATED THIS BRANCH. Before it, a denial could only happen on ATTEMPT 1 —
 * the global budget is drained by everyone together, so if it was gone at the start of the request it
 * was gone, and `generateGuarded` never got to run. A per-user ceiling is spent BY THIS USER, one
 * unit per attempt, so it can now run out BETWEEN a request's two attempts: attempt 1 generates,
 * trips the guardrail on a HARD hit, and attempt 2 — the hardened retry — is refused because that
 * first attempt was the user's last unit.
 *
 * ★ AND ON THAT PATH, RETURNING NOTHING IS STRICTLY WORSE THAN WHAT THE SAME REQUEST DID YESTERDAY.
 * Had the retry merely FAILED the guardrail instead of being refused, the outcome would be `blocked`
 * → the deterministic fallback → real, proven prose. Letting a budget decision downgrade that to
 * `explanation: null` would mean the cap made the product worse for the user it was protecting
 * everyone ELSE from. The fallback costs nothing, so there is no budget argument for withholding it.
 *
 *   · attempts ≥ 1 — we generated at least once this request → the deterministic fallback.
 *   · attempts = 0 — the very first spend was refused; nothing was read or generated →
 *                    "unavailable", which is the truth. There is nothing to fall back FROM.
 *
 * Generic over the surface's own identity fields (`base`), because the DECISION is identical for a
 * stock and a portfolio — only the subject differs.
 */
export function onQuotaDenied<B extends object>(
  base: B,
  outcome: Extract<GuardedOutcome, { kind: "quota_denied" }>,
  fallback: () => string,
): B & ExplanationOutcomeFields {
  const reason = outcome.decision.reason ?? "quota_denied";
  const resetAt = outcome.decision.resetAt.toISOString();
  return outcome.attempts >= 1
    ? { ...base, explanation: fallback(), headline: null, state: "fallback", reason, resetAt, cached: false }
    : { ...base, explanation: null, headline: null, state: "unavailable", reason, resetAt, cached: false };
}
