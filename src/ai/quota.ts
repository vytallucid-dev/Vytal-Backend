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
  remaining: number;
  limit: number;
  resetAt: Date; // next Pacific-midnight
  /** "daily_call_budget_exhausted" | "quota_disabled" | "quota_check_failed" */
  reason?: string;
}

/**
 * Atomically consume ONE call against `model`'s daily budget (the model id IS the counter
 * scope, so each model is gated against its own free-tier RPD). Every caller awaits this BEFORE
 * spending a Gemini call. Never throws on over-budget — returns allowed:false. On an unexpected
 * DB error it fails CLOSED (allowed:false) so a database blip can never cause uncontrolled spend.
 *
 * Pessimistic by design: one unit per attempt, no refund if the call then fails — the
 * cost-safe default given the transient 503s we saw on gemini-3.5-flash.
 * TODO: refund-on-failure if transient failures prove to waste meaningful budget.
 */
export async function checkAndConsumeAiCall(model: string): Promise<QuotaDecision> {
  const scope = model; // the model id IS the counter scope — each model gets its own budget/window
  const { windowKey, windowStart, resetAt } = currentWindow();
  const limit = budgetForModel(model);

  // Kill switch — allow WITHOUT touching the DB (same posture as SCORING_TRIGGERS_ENABLED).
  if (!quotaEnabled()) {
    return { allowed: true, remaining: limit, limit, resetAt, reason: "quota_disabled" };
  }

  try {
    // Ensure this window's row exists. Idempotent; concurrent creates race safely on the PK.
    await prisma.aiUsageCounter.upsert({
      where: { scope_windowKey: { scope, windowKey } },
      create: { scope, windowKey, windowStart, callCount: 0, tokenCount: 0n },
      update: {},
    });

    // THE GATE — atomic guarded increment: bump callCount ONLY while it is under budget. The
    // budget check lives in the WHERE, so Postgres row-locking serialises concurrent callers
    // and exactly `limit` of them win. No read-then-write gap ⇒ race-safe across jobs AND a
    // future separate worker process.
    const res = await prisma.aiUsageCounter.updateMany({
      where: { scope, windowKey, callCount: { lt: limit } },
      data: { callCount: { increment: 1 } },
    });
    const allowed = res.count === 1;

    // Accurate remaining for the response (reporting only — NOT part of the gate).
    const row = await prisma.aiUsageCounter.findUnique({
      where: { scope_windowKey: { scope, windowKey } },
      select: { callCount: true },
    });
    const used = row?.callCount ?? limit;
    const remaining = Math.max(0, limit - used);

    return allowed
      ? { allowed: true, remaining, limit, resetAt }
      : { allowed: false, remaining: 0, limit, resetAt, reason: "daily_call_budget_exhausted" };
  } catch (err) {
    // Fail CLOSED — a DB error must never open the spend gate.
    console.warn(`[ai/quota] check failed, denying (fail-closed): ${(err as Error).message}`);
    return { allowed: false, remaining: 0, limit, resetAt, reason: "quota_check_failed" };
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
