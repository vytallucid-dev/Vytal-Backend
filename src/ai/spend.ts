// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE MOCK / SPEND SEAM — the safety primitives every metered AI call shares.
//
// Extracted from explain/shared.ts when the AI CARD-GENERATION surfaces were removed. These are NOT
// card machinery — they are the rules that must hold for ANY real provider call, and the CHAT build
// (the next surface) needs them unchanged:
//
//   · mockByConfig / servedByMock — a stub answer must never reach a cache, and a stub call must never
//     be metered.
//   · spendFor — the per-request spend gate: a real call meters against the per-user sub-cap AND the
//     shared per-model budget; a mock call is unmetered, so `ai_usage_counters` keeps meaning "real
//     Gemini calls today" and nothing else.
//   · composePrompt — header (the closed-world rule) + facts (the world) + ask (the task). Chat reuses
//     it with the user's own message as the ask.
//
// Deliberately provider-neutral and card-free: no zod, no result envelope, no cache keys. Those were
// the card surfaces' business and left with them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { checkAndConsumeAiCall, type QuotaDecision, type Actor } from "./quota.js";
import { CLOSED_WORLD_HEADER } from "./grounding.js";
import type { TokenUsage } from "./types.js";

/** The single user message. Header first (the rule), facts second (the world), ask last (the task).
 *  ★ THE ASK IS A PARAMETER: on the removed explanation surfaces it varied per state; for chat it is
 *  the reader's own message. */
export const composePrompt = (factBlock: string, ask: string): string =>
  `${CLOSED_WORLD_HEADER}\n\n${factBlock}\n\n${ask}`;

// ── ⚠ MOCK DETECTION — the guard that keeps the SAFE default from being a SILENT-WRONG default ────
//
// The registry falls back to the mock adapter when AI_PROVIDER is unset, which is the right boot
// posture: no key, no network, no bill. But it is only safe for the CALL. Without this guard a stub
// answer ("[mock] The following are the ONLY facts…") could be persisted as an APPROVED answer and
// served forever, at zero cost, with a success state, long after the real provider is configured.
//
// TWO SIGNALS, AND — THE POINT — TWO DIFFERENT DECISION POINTS. They are not redundant copies; each is
// the ONLY signal available where it is used, because they exist at different times relative to a call:
//
//   1. CONFIG (pre-call, `mockByConfig`) — the same env the registry reads. Known BEFORE anything is
//      generated, which is what makes it the only usable signal for THE SPEND DECISION: by the time a
//      response exists you have already spent.
//   2. RESPONSE (post-call, `servedByMock`) — `usage.modelVersion`, "the model that actually served the
//      call". Guards a CACHE-WRITE decision, and catches what config cannot see: a registry mapping bug
//      where AI_PROVIDER=gemini resolves to a stub. Matched by PREFIX.
const MOCK_PROVIDER_ID = "mock";

/** PRE-CALL signal — the only one that exists in time to decide whether to spend. */
export const mockByConfig = (): boolean => (process.env.AI_PROVIDER ?? MOCK_PROVIDER_ID) === MOCK_PROVIDER_ID;

/** POST-CALL signal — guards a cache write. Conservative: either signal is enough to refuse. */
export function servedByMock(usage: TokenUsage): boolean {
  return mockByConfig() || usage.modelVersion.toLowerCase().startsWith(MOCK_PROVIDER_ID);
}

/** Consume one unit of budget. Injected so callers stay testable without a live counter. */
export type Spend = () => Promise<QuotaDecision>;

/**
 * The spend gate for THIS request. Mock calls never leave the process, so metering them would make the
 * counter mean something other than what it claims.
 *
 * ★ THE COUNTER'S MEANING IS THE WHOLE POINT. `ai_usage_counters` is the record of REAL GEMINI CALLS
 * MADE TODAY — what the free-tier RPD is checked against. Counting stub calls in it corrupts that
 * meaning twice over: the number stops matching Google's own, AND a developer exercising the flow on
 * mock silently eats the SAME shared daily budget the live feature draws from.
 *
 * `actor` is threaded through to the per-user sub-cap (see quota.ts `Actor`): a real call is metered
 * against BOTH this user's daily allowance and the shared per-model budget.
 */
export function spendFor(model: string, actor: Actor): Spend {
  if (!mockByConfig()) return () => checkAndConsumeAiCall(model, actor);
  // Unmetered: `limit: 0` with `allowed: true` is deliberately self-describing — anything reading this
  // decision sees at once that no budget applies, rather than a plausible-looking fake one.
  return async () => ({ allowed: true, remaining: 0, limit: 0, resetAt: new Date(0), scopeDenied: null, reason: "mock_provider_unmetered" });
}
