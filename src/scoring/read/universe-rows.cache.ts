// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNIVERSE ROWS CACHE — one in-process, stale-while-revalidate slot in front of the two-query
// read that every stock LIST and every stock SCAN shares.
//
// ── WHY: ONE READ, FIVE ENDPOINTS, EVERY REQUEST ───────────────────────────────────────────────────
// buildScoredStocksList, buildUniverseStocksList and the three scans (trajectory / divergence /
// ownership) all begin by loading the same thing: every stock, plus every in-force quarterly snapshot.
// Nothing about that read is per-request or per-reader — it changes ON RESCORE. Measured deployed,
// uncached: /api/stocks 49.9 ms · /api/stocks/universe 49.2 ms · /api/stocks/scan 56.9 ms of server
// time, all of it this one read, on every single call.
//
// ── ★ IT HOLDS PUBLIC PRODUCT DATA AND CANNOT BECOME USER-SCOPED ───────────────────────────────────
// Asserted by SHAPE, not by discipline, exactly as universe-view.cache.ts asserts it: `getUniverseRows()`
// TAKES NO ARGUMENTS. There is no key, no map, and nowhere for a userId to enter — a per-user variant
// would have to change the signature, which is a review-visible act rather than a quiet one. What it
// caches is the raw material behind endpoints served unauthenticated to anyone. ⚠ Do not add a
// parameter to this function.
//
// ── ⚠ THE SLOT IS SHARED AND MUST STAY READ-ONLY ───────────────────────────────────────────────────
// Every caller receives THE SAME `stocks` array and THE SAME `byStock` Map — not copies. That is the
// point (copying 559 rows per request would give back what the cache just saved), and it is the one
// way this can go wrong. It is safe today because no consumer mutates: each reduces with
// inForceNewestFirst(), which builds its own Map and returns a NEW sorted array, and every `.sort()`
// in the service runs on the result of a `.map()`/`.flatMap()`, never on the shared arrays. A consumer
// that sorted `stocks` in place would silently reorder every other endpoint's output.
//
// ── TTL: 5 MINUTES, STALE-WHILE-REVALIDATE ─────────────────────────────────────────────────────────
// Same policy, same numbers and the same code as universe-view.cache.ts, deliberately — one cache
// pattern in this codebase means one failure mode to reason about, and that one is already proven in
// production (/api/universe/health went 108.9 ms → ~0 ms of server time on this exact shape).
//   · The data changes ON RESCORE, not per request — event-driven (an ingestion completing enqueues
//     PG_RESCORE) plus the EOD price pass, a handful of times a day, clustered after market close.
//   · STALE-WHILE-REVALIDATE means only the first request after a cold start ever waits. A stale hit
//     is served instantly while the rebuild runs behind it; a rebuild that FAILS keeps serving the
//     last good rows rather than turning a transient DB blip into an error in front of a reader.
// It evaporates on process restart and is persisted nowhere.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import type { LabelBand } from "./health-view.types.js";

const num = (d: unknown): number =>
  d == null
    ? 0
    : typeof (d as { toNumber?: () => number }).toNumber === "function"
      ? (d as { toNumber: () => number }).toNumber()
      : Number(d);

/** One quarterly snapshot, flattened to the numbers the lists and scans read. */
export interface LeanSnap {
  id: string;
  stockId: string;
  periodKey: string;
  version: number;
  asOfDate: Date;
  composite: number;
  labelBand: LabelBand;
  foundation: number;
  momentum: number;
  market: number;
  ownership: number;
  wFoundation: number;
  wMomentum: number;
  wMarket: number;
  wOwnership: number;
}

export interface UniverseRows {
  stocks: {
    id: string;
    symbol: string;
    name: string;
    sector: { name: string; displayName: string } | null;
  }[];
  byStock: Map<string, LeanSnap[]>;
}

/**
 * Fetch all stocks + the in-force quarterly snapshots, bucketed by stock.
 *
 * ── ⚠ `distinct` IS THE FIX, AND IT IS PUSHED TO SQL ──────────────────────────────────────────────
 * This read used to fetch EVERY row of score_snapshots — 3,669 rows for 559 distinct (stock, period)
 * pairs, i.e. 3,110 rows (84.8% of the fetch) were superseded versions shipped across the wire and
 * then discarded by the in-memory reduction. `where: { snapshotType: "quarterly" }` matched 3,669 of
 * 3,669 and excluded nothing; the version dimension was the whole of the waste.
 *
 * Prisma's `distinct` compiles to Postgres DISTINCT ON, so the deduplication happens IN THE DATABASE:
 * verified 3,669 → 559 rows on the wire, and the ORDER BY below mirrors the JS tie-break exactly
 * (version DESC, then asOfDate DESC), so the row SET is identical — checked row-for-row against the
 * full in-memory reduction over live data, 559/559 identical, with ZERO pairs where (version,
 * asOfDate) both tie and the choice could have been arbitrary.
 *
 * ★ THE PERIOD DIMENSION IS NOT WASTE AND MUST NOT BE FILTERED. It looks like it should be — three of
 * the five consumers read only `[0]` — but buildDivergenceScan reads the WHOLE series: it filters to
 * periods where both pillars of its high/low pair were scored, then takes SPARK_MAX (8) of whatever
 * survives. How many raw periods that needs is per-stock and unbounded (stocks carry 1–13 in-force
 * periods, median 6), so no static period filter is safe. The reduction below stays in JS for the
 * same reason: it is the authority, and this query now simply stops shipping rows it would discard.
 */
async function loadUniverseRows(): Promise<UniverseRows> {
  const [stocks, snaps] = await Promise.all([
    prisma.stock.findMany({
      select: {
        id: true,
        symbol: true,
        name: true,
        sector: { select: { name: true, displayName: true } },
      },
    }),
    prisma.scoreSnapshot.findMany({
      where: { snapshotType: "quarterly" },
      // ⚠ These two belong together — `distinct` keeps the FIRST row per (stockId, periodKey) in
      // ORDER BY order, so the ordering IS the supersede rule. Change one and you change which
      // snapshot is in force. See the note above.
      distinct: ["stockId", "periodKey"],
      orderBy: [
        { stockId: "asc" },
        { periodKey: "asc" },
        { version: "desc" },
        { asOfDate: "desc" },
      ],
      select: {
        id: true,
        stockId: true,
        periodKey: true,
        version: true,
        asOfDate: true,
        composite: true,
        labelBand: true,
        foundationSubtotal: true,
        momentumSubtotal: true,
        marketSubtotal: true,
        ownershipSubtotal: true,
        wFoundation: true,
        wMomentum: true,
        wMarket: true,
        wOwnership: true,
      },
    }),
  ]);

  const byStock = new Map<string, LeanSnap[]>();
  for (const s of snaps) {
    const arr = byStock.get(s.stockId) ?? [];
    arr.push({
      id: s.id,
      stockId: s.stockId,
      periodKey: s.periodKey,
      version: s.version,
      asOfDate: s.asOfDate,
      composite: num(s.composite),
      labelBand: s.labelBand as LabelBand,
      foundation: num(s.foundationSubtotal),
      momentum: num(s.momentumSubtotal),
      market: num(s.marketSubtotal),
      ownership: num(s.ownershipSubtotal),
      wFoundation: num(s.wFoundation),
      wMomentum: num(s.wMomentum),
      wMarket: num(s.wMarket),
      wOwnership: num(s.wOwnership),
    });
    byStock.set(s.stockId, arr);
  }

  return { stocks, byStock };
}

/** Serve-stale-and-revalidate boundary. See the header for why five minutes. */
export const UNIVERSE_ROWS_TTL_MS = 5 * 60 * 1000;

let cache: { rows: UniverseRows; builtAt: number } | null = null;
let rebuildInFlight: Promise<UniverseRows> | null = null;

/** Start (or join) a rebuild. One in flight at a time — a burst of cold callers shares one read. */
function rebuild(): Promise<UniverseRows> {
  if (rebuildInFlight) return rebuildInFlight;
  rebuildInFlight = loadUniverseRows()
    .then((rows) => {
      cache = { rows, builtAt: Date.now() };
      return rows;
    })
    .finally(() => {
      rebuildInFlight = null;
    });
  return rebuildInFlight;
}

/**
 * The universe rows, cached. ★ NO PARAMETERS — see the header.
 *
 * Cold  → reads and waits (joining any read already running).
 * Warm  → returns the cached rows.
 * Stale → returns the cached rows NOW and re-reads behind it.
 */
export async function getUniverseRows(): Promise<UniverseRows> {
  if (!cache) return rebuild();
  if (Date.now() - cache.builtAt > UNIVERSE_ROWS_TTL_MS) {
    // A failed background rebuild must not reject an already-answered request.
    rebuild().catch(() => {
      /* the last good rows keep serving; the next caller retries */
    });
  }
  return cache.rows;
}

/** Observability for the verification harness and for a future admin read. Carries no row data. */
export function universeRowsCacheStats(): {
  warm: boolean;
  ageMs: number | null;
  rebuilding: boolean;
  stocks: number | null;
  snapshots: number | null;
} {
  return {
    warm: cache !== null,
    ageMs: cache ? Date.now() - cache.builtAt : null,
    rebuilding: rebuildInFlight !== null,
    stocks: cache ? cache.rows.stocks.length : null,
    snapshots: cache ? [...cache.rows.byStock.values()].reduce((n, a) => n + a.length, 0) : null,
  };
}

/** Test-only: drop the slot so a harness can measure a genuine cold path. Never called in product code. */
export function _clearUniverseRowsCacheForVerification(): void {
  cache = null;
}

/**
 * Test-only: backdate the slot so a harness can cross the TTL boundary without waiting five minutes.
 *
 * ★ IT EXISTS BECAUSE THE STALE PATH IS THE ONLY BEHAVIOUR THAT DISTINGUISHES THIS FROM A PLAIN TTL
 * CACHE, and it is the one a plain TTL cache gets wrong: a stale read must return the old rows
 * IMMEDIATELY and re-read behind it, never block the caller. Never called in product code.
 */
export function _ageUniverseRowsCacheForVerification(byMs: number): void {
  if (cache) cache = { ...cache, builtAt: cache.builtAt - byMs };
}
