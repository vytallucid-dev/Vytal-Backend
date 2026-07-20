// ═══════════════════════════════════════════════════════════════════════
// RATE LIMIT — per-user throttle on the broker auth-initiate + callback endpoints, so a
// stolen/guessed flow can't be hammered (brute/replay). In-memory fixed-window counter,
// keyed by (action, userId). PER-INSTANCE by design; a multi-instance deploy would move this
// to a shared store (Redis) — noted, not built (out of Phase-2a scope).
//
// Exposed as BOTH a pure function (deterministic, unit-testable) and an Express middleware
// (runs AFTER requireAuth, so req.authUser.userId is the key). A blocked request → 429 with
// Retry-After; it never touches the broker/DB.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response, NextFunction } from "express";

interface Window {
  count: number;
  resetAt: number; // epoch ms when the window rolls over
}

const buckets = new Map<string, Window>();

export interface RateResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** Consume one unit against `key`'s fixed window. Pure + deterministic (keyed on Date.now). */
export function consumeRateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  let w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    w = { count: 0, resetAt: now + windowMs };
    buckets.set(key, w);
  }
  if (w.count >= limit) return { allowed: false, remaining: 0, resetAt: w.resetAt };
  w.count += 1;
  return { allowed: true, remaining: limit - w.count, resetAt: w.resetAt };
}

/** Test hook — clear all windows so a harness starts from a known state. */
export function __resetRateLimitsForTests(): void {
  buckets.clear();
}

/** Express middleware factory: throttle `action` per authenticated user. Mount AFTER
 *  requireAuth. Anonymous callers (no authUser) share an "anon" bucket as a backstop. */
export function rateLimit(action: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.authUser?.userId ?? "anon";
    const r = consumeRateLimit(`${action}:${userId}`, limit, windowMs);
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(r.remaining));
    if (!r.allowed) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000))));
      res.status(429).json({
        success: false,
        error: "rate_limited",
        message: "Too many broker auth attempts. Please wait and try again.",
      });
      return;
    }
    next();
  };
}
