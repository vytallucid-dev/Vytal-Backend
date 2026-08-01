// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNIVERSE VIEW CACHE — one in-process, stale-while-revalidate slot in front of
// buildUniverseHealthView.
//
// ── WHY: LATENCY IS THE BINDING CONSTRAINT, NOT TOKENS ─────────────────────────────────────────────
// The projection already solved tokens (22,149 → ~590). What it cannot solve is that the builder costs
// 1.5s cold / ~0.6s warm-connection, on three DB round trips, EVERY call. A chat turn that fetches the
// census and then drills into one finding pays it twice — and a tool round is a whole extra generation
// on top, so the reader sits through ~5s of nothing before the first word appears. That is the thing a
// reader actually notices.
//
// ── ★ IT HOLDS PUBLIC PRODUCT DATA AND CANNOT BECOME USER-SCOPED ───────────────────────────────────
// This is asserted by SHAPE, not by discipline: `getUniverseHealthView()` TAKES NO ARGUMENTS. There is
// no key, no map, and nowhere for a userId to enter — a per-user variant would have to change the
// signature, which is a review-visible act rather than a quiet one. What it caches is exactly what
// GET /api/universe/health serves unauthenticated to anyone. The reader's own scope (their holdings,
// their watchlist) is applied AFTER this, in the pure projection, from symbols resolved out of
// ctx.userId — so no scoped result is ever what got stored. ⚠ Do not add a parameter to this function.
//
// ── TTL: 5 MINUTES, STALE-WHILE-REVALIDATE ─────────────────────────────────────────────────────────
// Same policy and same numbers as discovery/fund-discovery.ts, deliberately — one cache pattern in the
// codebase means one failure mode to reason about.
//   · The underlying data changes ON RESCORE, not per request. Rescores are event-driven (an ingestion
//     completing enqueues PG_RESCORE) plus the EOD price pass — a handful of times a day, clustered
//     after market close. Five minutes is an order of magnitude below that cadence, so the window in
//     which a caller can see a superseded universe is small and, in practice, off-hours.
//   · It is well ABOVE a conversation. A turn, and any burst of turns around it, collapses onto one
//     build. That is the whole win.
//   · STALE-WHILE-REVALIDATE means only the very first request after a cold start ever waits. A stale
//     hit is served instantly while the rebuild runs behind it; a rebuild that FAILS keeps serving the
//     last good view rather than turning a transient DB blip into an error in front of a reader.
// It evaporates on process restart and is persisted nowhere.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { buildUniverseHealthView } from "./universe-view.service.js";
import type { UniverseHealthView } from "./universe-view.types.js";

/** Serve-stale-and-revalidate boundary. See the header for why five minutes. */
export const UNIVERSE_CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { view: UniverseHealthView; builtAt: number } | null = null;
let rebuildInFlight: Promise<UniverseHealthView> | null = null;

/** Start (or join) a rebuild. One in flight at a time — a burst of cold callers shares one build. */
function rebuild(): Promise<UniverseHealthView> {
  if (rebuildInFlight) return rebuildInFlight;
  rebuildInFlight = buildUniverseHealthView()
    .then((view) => {
      cache = { view, builtAt: Date.now() };
      return view;
    })
    .finally(() => {
      rebuildInFlight = null;
    });
  return rebuildInFlight;
}

/**
 * The universe health view, cached. ★ NO PARAMETERS — see the header.
 *
 * Cold  → builds and waits (joining any build already running).
 * Warm  → returns the cached view.
 * Stale → returns the cached view NOW and rebuilds behind it.
 */
export async function getUniverseHealthView(): Promise<UniverseHealthView> {
  if (!cache) return rebuild();
  if (Date.now() - cache.builtAt > UNIVERSE_CACHE_TTL_MS) {
    // A failed background rebuild must not reject an already-answered request.
    rebuild().catch(() => {
      /* the last good view keeps serving; the next caller retries */
    });
  }
  return cache.view;
}

/** Observability for the verification harness and for a future admin read. Carries no view data. */
export function universeCacheStats(): { warm: boolean; ageMs: number | null; rebuilding: boolean } {
  return {
    warm: cache !== null,
    ageMs: cache ? Date.now() - cache.builtAt : null,
    rebuilding: rebuildInFlight !== null,
  };
}

/** Test-only: drop the slot so a harness can measure a genuine cold path. Never called in product code. */
export function _clearUniverseCacheForVerification(): void {
  cache = null;
}

/**
 * Test-only: backdate the slot so a harness can cross the TTL boundary without waiting five minutes.
 *
 * ★ IT EXISTS BECAUSE THE STALE PATH IS THE ONLY BEHAVIOUR THAT DISTINGUISHES THIS FROM A PLAIN TTL
 * CACHE, and it is the one a plain TTL cache gets wrong: a stale read must return the old view
 * IMMEDIATELY and rebuild behind it, never block the caller on the rebuild. Asserting that by
 * inspection is asserting nothing. Never called in product code.
 */
export function _ageUniverseCacheForVerification(byMs: number): void {
  if (cache) cache = { ...cache, builtAt: cache.builtAt - byMs };
}
