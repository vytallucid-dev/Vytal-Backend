// ═══════════════════════════════════════════════════════════════════════
// AI QUOTA GUARD — the shared "are we allowed to spend right now?" gate every AI caller
// consults BEFORE spending a Gemini call. Cost-safety infrastructure, SEPARATE from the
// dumb-transport adapter: this file imports prisma; the adapter (types/registry/adapters)
// never does.
//
// FAIL-SOFT: checkAndConsumeAiCall NEVER throws on over-budget — it returns allowed:false so
// the caller can 429 (interactive) or defer (job) instead of crashing. It also fails CLOSED
// on an unexpected DB error (deny, never overspend). recordAiTokens is best-effort and never
// throws at all.
//
// The daily window resets at Google's midnight-Pacific quota reset. That boundary lives
// entirely inside currentWindow() (the windowKey IS the Pacific calendar date) — the way the
// scheduler encodes IST offsets inside UTC crons — so the free→paid move (rolling-window,
// spend-based) touches ONLY that one function.
//
// ── ★ TWO CEILINGS, AND WHAT THE SECOND ONE IS ACTUALLY FOR ───────────────────────────────
//
// A call must satisfy BOTH the GLOBAL per-model cap (the free-tier RPD, shared by everyone) and
// a PER-USER daily sub-cap. The second exists because not every AI surface amortises: a stock
// explanation is cached on (stockId, factsKey, toneKey), so one user's generation warms a row
// every other user reads — their spend is a public good. A PORTFOLIO explanation is keyed on a
// per-user book and can only ever be hit by the user who paid for it, 1:1. On that surface one
// active user — or, far more likely, one frontend bug POSTing in a render loop — can drain the
// shared 480/day and dark the AI features for everybody.
//
// ⚠ STATE THE INTENT PRECISELY, BECAUSE THE CAP IS ROUTINELY MISREAD AS SOMETHING STRONGER.
//   ✔ IT PREVENTS A SINGLE MONOPOLIST. At 20/day against a 480/day model budget, no one actor
//     can take more than ~4% of the day.
//   ✘ IT DOES NOT PREVENT COLLECTIVE EXHAUSTION. Twenty-four users each spending their full
//     twenty still reach 480 — and that is not abuse, it is DEMAND. The honest answer to demand
//     is more budget (the paid tier) or a better cache, never a lower per-user cap. A cap sized
//     to guarantee no collective exhaustion would be `480 / expected_DAU`: a rationing scheme
//     wearing a fairness guard's clothing.
//
// ── ★ WHY THE GATE IS ONE TRANSACTION AND THE SINGLE-LIMIT GATE WAS NOT ───────────────────
//
// The old gate needed no transaction because ONE guarded UPDATE is atomic by itself — see the
// self-referential-WHERE note on the gate below. TWO coupled limits are not, and every
// non-transactional composition is wrong in a specific way:
//
//   · global-then-user, no rollback  — a user over their personal cap BURNS A GLOBAL UNIT on
//     every attempt. The precise inverse of what the cap is for. Disqualifying.
//   · user-then-global, no rollback  — leaks a USER unit when GLOBAL is exhausted. Benign (the
//     window in which it leaks is one where nothing is allowed anyway), but still wrong.
//   · a compensating decrement       — a crash between the two makes the leak PERMANENT, with
//     no reconciliation job, and concurrent callers see the inflated count and are FALSELY
//     DENIED. It trades a bounded, benign leak for an unbounded, invisible one.
//   · one statement whose predicate reads the OTHER row — RACES. `(SELECT call_count FROM …
//     WHERE scope=$other) < $limit` is an UNLOCKED snapshot read: two callers at 479 both read
//     479, both pass, both increment → 481. The guarded-WHERE trick works ONLY when the
//     predicate is about the row being updated.
//
// So: one transaction, two guarded updates, USER FIRST. The ordering is deliberate twice over —
// it fixes the lock order (deadlock-free: every caller takes the user row then the global row,
// so no cycle is constructible), and it means that if the transaction is ever dropped by a
// future refactor, the gate degrades to the BENIGN leak rather than the harmful one.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

// ── Config (named defaults + env override; matches the SCORING_TRIGGERS_ENABLED idiom) ──
const DEFAULT_QUOTA_TIMEZONE = "America/Los_Angeles";

// PER-MODEL daily CALL budgets. Each Gemini model has its OWN free-tier RPD, so the ceiling is
// looked up by model id — never a single global number. An unlisted model is gated at the
// CONSERVATIVE fallback (never a high default — fail toward caution).
const UNKNOWN_MODEL_BUDGET = 18;
const MODEL_BUDGETS: Record<string, () => number> = {
  "gemini-3.5-flash-lite": () => envInt("AI_BUDGET_FLASH_LITE", 480), // free-tier RPD 500
  "gemini-3.5-flash": () => envInt("AI_BUDGET_FLASH", 18), //            free-tier RPD only 20
};

/** Positive integer from env `name`, floored; `fallback` when unset/blank/invalid. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Daily CALL budget for `model`. Unlisted models are gated conservatively + warned — NEVER
 *  given a high default. */
function budgetForModel(model: string): number {
  const resolve = MODEL_BUDGETS[model];
  if (resolve) return resolve();
  console.warn(
    `[ai/quota] no budget configured for model "${model}" — gating conservatively at ${UNKNOWN_MODEL_BUDGET}/day`,
  );
  return UNKNOWN_MODEL_BUDGET;
}

// PER-USER daily sub-caps. Same shape as MODEL_BUDGETS above and for the same reason: each model
// has its OWN free-tier RPD, so one user's fair SHARE has to scale with the model it is spending
// against — a single cross-model number would be either absurdly generous on flash-lite (480/day)
// or an outage on flash (18/day).
//
// ★ SIZING, SHOWN RATHER THAN ASSERTED. An explanation costs UP TO TWO units — generateGuarded
// spends per ATTEMPT and the hardened retry is a second attempt — so 20 units is 10–20 explanations
// a day. A user who trades a few times, re-reads their book and explores some cold-cache stocks
// lands well under it; a render-loop bug hits it in seconds and stops there, at 4% of the day.
const UNKNOWN_USER_BUDGET = 5;
const USER_MODEL_BUDGETS: Record<string, () => number> = {
  "gemini-3.5-flash-lite": () => envInt("AI_USER_BUDGET_FLASH_LITE", 20), // global 480 ⇒ ~4%/user
  "gemini-3.5-flash": () => envInt("AI_USER_BUDGET_FLASH", 5), //            global  18 ⇒ ~28%/user
};

/** Per-user daily budget for `model`. Same fail-toward-caution posture as budgetForModel. */
function userBudgetForModel(model: string): number {
  const resolve = USER_MODEL_BUDGETS[model];
  if (resolve) return resolve();
  console.warn(
    `[ai/quota] no per-user budget configured for model "${model}" — gating conservatively at ${UNKNOWN_USER_BUDGET}/day`,
  );
  return UNKNOWN_USER_BUDGET;
}

/**
 * ★ THE ONE HOME FOR THE PER-USER SCOPE CONVENTION. `AiUsageCounter.scope` is free text whose
 * schema comment reserved this exact slot ("v1 global; room for user:<id> later"), so per-user
 * counters need NO new table and NO migration — they are more rows in the table that already
 * owns the window key and the guarded-increment idiom.
 *
 * ⚠ PER (USER, MODEL), NOT BARE PER-USER. Budgets are per-model (above), and scoping the counter
 * the same way keeps a leak — should one ever exist — confined to the model that leaked it,
 * instead of eroding a user's allowance on a model they never called.
 *
 * Collision-free by construction: no model id contains ":" (`gemini-3.5-flash-lite`,
 * `gemini-3.5-flash`), so a user scope can never be mistaken for a bare model scope.
 */
export const userScopeOf = (userId: string, model: string): string => `user:${userId}:${model}`;

/**
 * ★ WHO IS SPENDING — A DECLARATION, NOT AN OPTIONAL ARGUMENT.
 *
 * An optional `userId?` would make "no user" something a caller can reach by FORGETTING, and the
 * thing they'd get by forgetting is UNCAPPED ACCESS — the one failure mode this module exists to
 * prevent. A future offline judge or cache-warmer legitimately has no user and legitimately spends
 * against the global cap alone; it must SAY so. Same ruling as FINDING_HOME's throw-on-unknown: a
 * default that is wrong is indistinguishable from a default that is right, until something forces
 * the question.
 */
export type Actor =
  | { kind: "user"; userId: string }
  | { kind: "system"; job: string };

/** Reset zone. "America/Los_Angeles" on free tier; irrelevant once paid (rolling window). */
function quotaTimezone(): string {
  const raw = process.env.AI_QUOTA_TIMEZONE;
  return raw && raw.trim() !== "" ? raw : DEFAULT_QUOTA_TIMEZONE;
}

/** Kill switch — off ONLY when explicitly "false" (same posture as SCORING_TRIGGERS_ENABLED). */
function quotaEnabled(): boolean {
  return process.env.AI_QUOTA_ENABLED !== "false";
}

// ── Window derivation — THE ONE PLACE the reset boundary is defined ──────────────────────
const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** The calendar Y/M/D of `date` as seen in `tz` (via Intl parts — locale-format-proof). */
function zonedYmd(date: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const p: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = part.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

/** (local wall-clock − UTC) in ms for `date` in `tz` — the standard Intl offset trick. */
function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const p: Record<string, number> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** UTC instant of local midnight (00:00) for calendar date y-m-d in `tz`. DST-correct: the
 *  offset is measured at that date's own midnight, and US DST never flips AT midnight. */
function zonedMidnightUtc(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0); // wall-clock midnight treated as if UTC
  const offset = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - offset);
}

interface QuotaWindow {
  /** Pacific calendar date, "YYYY-MM-DD" — the DB row key AND the reset boundary. */
  windowKey: string;
  /** UTC instant of the Pacific midnight that opened this window. */
  windowStart: Date;
  /** UTC instant of the NEXT Pacific midnight — when this window resets. */
  resetAt: Date;
}

/** THE FREE→PAID SEAM. Free tier: one window per Pacific calendar day. Moving to paid
 *  (rolling-window, spend-based) changes only this function — nothing else in the file. */
function currentWindow(now: Date = new Date()): QuotaWindow {
  const tz = quotaTimezone();
  const { y, m, d } = zonedYmd(now, tz);
  const windowKey = `${y}-${pad2(m)}-${pad2(d)}`;
  const windowStart = zonedMidnightUtc(y, m, d, tz);
  // Next Pacific day — Date.UTC normalises day overflow across month/year ends.
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const resetAt = zonedMidnightUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    tz,
  );
  return { windowKey, windowStart, resetAt };
}

// ── Public API ───────────────────────────────────────────────────────────────────────────
export interface QuotaDecision {
  allowed: boolean;
  /** Headroom on the BINDING ceiling — on a denial that is the one that denied; on an allow it is
   *  whichever of the two has less left. One rule, so the number always means "how many more". */
  remaining: number;
  limit: number;
  resetAt: Date; // next Pacific-midnight
  /**
   * ★ WHICH CEILING DENIED — a FIELD, not something the caller string-matches out of `reason`.
   * The distinction is user-visible and load-bearing: "you have used your explanations for today"
   * is a personal limit that resets FOR THEM, where "the service is at its daily limit" is a
   * system-wide outage they cannot influence. Rendering the second when the first is true tells a
   * user the product is broken when in fact they are simply done for the day.
   * null ⇔ allowed, or the gate never ran (disabled / DB error).
   */
  scopeDenied: "user" | "global" | null;
  /** "user_daily_limit_reached" | "daily_call_budget_exhausted" | "quota_disabled" | "quota_check_failed" */
  reason?: string;
}

/** Internal control-flow signal: thrown INSIDE the gate transaction so the rollback undoes every
 *  increment made so far. Never escapes this module — the catch below converts it to a decision. */
class QuotaDenied extends Error {
  constructor(readonly deniedScope: "user" | "global") {
    super(`quota_denied:${deniedScope}`);
    this.name = "QuotaDenied";
  }
}

/**
 * Atomically consume ONE call against BOTH `model`'s daily budget (the model id IS the global
 * counter scope, so each model is gated against its own free-tier RPD) AND — for a user actor —
 * that user's daily sub-cap on the same model. Every caller awaits this BEFORE spending a Gemini
 * call. Never throws on over-budget — returns allowed:false. On an unexpected DB error it fails
 * CLOSED (allowed:false) so a database blip can never cause uncontrolled spend.
 *
 * ★ ALL-OR-NOTHING. Either both counters moved or neither did. A denial on the second ceiling
 * rolls the first one back — there is no state in which a denied call has consumed budget.
 *
 * `{ kind: "system" }` runs the GLOBAL update only, BY DECLARATION (see `Actor`): our own jobs are
 * metered against the shared RPD, but they are not rate-limited against a person who isn't there.
 *
 * Pessimistic by design: one unit per attempt, no refund if the call then fails — the
 * cost-safe default given the transient 503s we saw on gemini-3.5-flash.
 * TODO: refund-on-failure if transient failures prove to waste meaningful budget.
 */
export async function checkAndConsumeAiCall(model: string, actor: Actor): Promise<QuotaDecision> {
  const globalScope = model; // the model id IS the counter scope — each model gets its own budget/window
  const { windowKey, windowStart, resetAt } = currentWindow();
  const globalLimit = budgetForModel(model);
  const userScope = actor.kind === "user" ? userScopeOf(actor.userId, model) : null;
  const userLimit = userScope === null ? null : userBudgetForModel(model);

  // Kill switch — allow WITHOUT touching the DB (same posture as SCORING_TRIGGERS_ENABLED).
  // ⚠ IT DISABLES BOTH CEILINGS, and that is correct rather than an oversight: this is ONE switch
  // for ONE subsystem. "Quota off" means no metering at all — a per-user cap still enforced while
  // the global cap is off would be a fairness rule with no budget left to be fair about.
  if (!quotaEnabled()) {
    return { allowed: true, remaining: globalLimit, limit: globalLimit, resetAt, scopeDenied: null, reason: "quota_disabled" };
  }

  const scopes = userScope === null ? [globalScope] : [userScope, globalScope];

  try {
    // Ensure this window's rows exist. OUTSIDE the transaction on purpose: creating a counter is
    // not part of the gate, it is a precondition of it, and holding a transaction open across it
    // would lengthen the lock window for no benefit. Idempotent; concurrent creates race safely on
    // the PK (ON CONFLICT DO NOTHING), so N callers on a fresh window all proceed.
    await prisma.aiUsageCounter.createMany({
      data: scopes.map((scope) => ({ scope, windowKey, windowStart })),
      skipDuplicates: true,
    });

    // ── THE GATE ────────────────────────────────────────────────────────────────────────────────
    // Each UPDATE is the SAME atomic guarded increment the single-limit gate used, verbatim: bump
    // callCount ONLY while it is under budget, with the budget check in the WHERE.
    //
    // ★ THE PREDICATE IS SELF-REFERENTIAL — `callCount` is a column OF THE ROW BEING UPDATED — and
    // that is the entire reason this is race-safe. Under READ COMMITTED a concurrent UPDATE blocks
    // on the row lock, then RE-EVALUATES the WHERE against the committed new version; a row that no
    // longer satisfies `callCount < limit` is skipped and excluded from the affected count. No
    // read-then-write gap, so exactly `limit` callers win, across jobs AND a future worker process.
    // A predicate reading a DIFFERENT row would be an unlocked snapshot read and would race — see
    // the header. Do not "simplify" these two statements into one that compares across rows.
    //
    // USER FIRST (see header): fixes the lock order, and puts the cheap-to-lose counter first.
    let denied: "user" | "global" | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        if (userScope !== null && userLimit !== null) {
          const u = await tx.aiUsageCounter.updateMany({
            where: { scope: userScope, windowKey, callCount: { lt: userLimit } },
            data: { callCount: { increment: 1 } },
          });
          // Throw, don't return — the throw is what rolls back. Nothing global has been touched
          // yet either way, so a user-cap denial costs the shared budget exactly nothing.
          if (u.count !== 1) throw new QuotaDenied("user");
        }
        const g = await tx.aiUsageCounter.updateMany({
          where: { scope: globalScope, windowKey, callCount: { lt: globalLimit } },
          data: { callCount: { increment: 1 } },
        });
        // The rollback here is the load-bearing one: it undoes the user increment above, so a
        // globally-exhausted window never quietly eats the user's personal allowance.
        if (g.count !== 1) throw new QuotaDenied("global");
      });
    } catch (err) {
      if (!(err instanceof QuotaDenied)) throw err; // a real DB fault → the fail-closed catch below
      denied = err.deniedScope;
    }

    // Accurate remaining for the response (reporting only — NOT part of the gate, and deliberately
    // read OUTSIDE the transaction: a slightly stale report cannot overspend anything).
    const rows = await prisma.aiUsageCounter.findMany({
      where: { windowKey, scope: { in: scopes } },
      select: { scope: true, callCount: true },
    });
    const headroom = (scope: string, limit: number): number =>
      Math.max(0, limit - (rows.find((r) => r.scope === scope)?.callCount ?? limit));

    const globalLeft = headroom(globalScope, globalLimit);
    const userLeft = userScope === null || userLimit === null ? null : headroom(userScope, userLimit);

    if (denied === "user") {
      return {
        allowed: false, remaining: 0, limit: userLimit!, resetAt,
        scopeDenied: "user", reason: "user_daily_limit_reached",
      };
    }
    if (denied === "global") {
      return {
        allowed: false, remaining: 0, limit: globalLimit, resetAt,
        scopeDenied: "global", reason: "daily_call_budget_exhausted",
      };
    }

    // Allowed → report the BINDING ceiling: whichever has less headroom left. One rule, so
    // `remaining` always answers the same question ("how many more can I have?").
    const userBinds = userLeft !== null && userLeft < globalLeft;
    return {
      allowed: true,
      remaining: userBinds ? userLeft : globalLeft,
      limit: userBinds ? userLimit! : globalLimit,
      resetAt,
      scopeDenied: null,
    };
  } catch (err) {
    // Fail CLOSED — a DB error must never open the spend gate. `scopeDenied` stays null: nothing
    // was denied on its merits, so naming a ceiling here would be a claim we cannot support.
    console.warn(`[ai/quota] check failed, denying (fail-closed): ${(err as Error).message}`);
    return { allowed: false, remaining: 0, limit: globalLimit, resetAt, scopeDenied: null, reason: "quota_check_failed" };
  }
}

/**
 * Record token usage AFTER a call returns, against `model`'s current window. Best-effort — never throws;
 * a failure to record tokens must not break the caller. v1's GATE is call-count, but the token
 * sum is captured now so the free→paid flip to spend-based limits is a config change.
 * No-op when the quota subsystem is disabled (keeps "disabled ⇒ don't touch the DB" consistent).
 */
export async function recordAiTokens(model: string, totalTokens: number): Promise<void> {
  if (!quotaEnabled()) return;
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return;
  // GLOBAL scope only, deliberately: v1's gate is call-count, and the per-user CEILING is a call
  // ceiling. Per-user token accounting needs no new shape when the paid tier wants it — the same
  // `user:<id>:<model>` row already carries a tokenCount — so this stays one write until then.
  const scope = model; // same per-model scope as the gate
  const inc = BigInt(Math.floor(totalTokens));
  const { windowKey, windowStart } = currentWindow();
  try {
    await prisma.aiUsageCounter.upsert({
      where: { scope_windowKey: { scope, windowKey } },
      create: { scope, windowKey, windowStart, callCount: 0, tokenCount: inc },
      update: { tokenCount: { increment: inc } },
    });
  } catch (err) {
    console.warn(`[ai/quota] failed to record ${totalTokens} tokens (non-fatal): ${(err as Error).message}`);
  }
}
