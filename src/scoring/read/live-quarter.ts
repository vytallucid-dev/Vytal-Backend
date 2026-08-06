// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE LIVE FISCAL QUARTER — the ONE quarter the whole platform is currently on.
//
// ── ★ WHY THIS EXISTS: A PER-STOCK WINDOW IS NOT A WINDOW ─────────────────────────────────────────
// The recently-ended card used to be bounded by `endedPeriodsAgo <= 4`, and `endedPeriodsAgo` counts
// positions in THE STOCK'S OWN scored sequence. Two stocks therefore had two different windows: one
// whose head sits at FY26Q4 measured "recent" from FY26Q4, while its neighbour at FY27Q1 measured it
// from FY27Q1. Nothing on screen said so. Bounding to "the current fiscal quarter" only means anything
// if "current" is one value for everybody, so it is resolved here, once, universe-wide.
//
// ── ★ WHY THE DATA AND NOT THE CALENDAR ──────────────────────────────────────────────────────────
// The live quarter is the NEWEST periodKey any scored snapshot carries — not `new Date()` mapped onto
// the Indian fiscal year. A calendar derivation would roll to FY27Q2 the moment July began and then
// hide every closed card for the weeks before that quarter's results are ingested, because no stock
// would have closed anything "this quarter" yet. The scored corpus is what the reader is looking at,
// so the corpus decides which quarter is current.
//
// ── ★ WHY MEMOISED, AND WHY THAT IS SAFE ─────────────────────────────────────────────────────────
// A new fiscal quarter arrives roughly four times a year; this answer is stable for months at a time.
// The alternative — a universe-wide DISTINCT scan on every per-stock lifecycle resolve — would put an
// O(universe) query behind an O(1) fact. The TTL below bounds staleness to minutes, which is orders of
// magnitude tighter than the quantity it is tracking.
//
// ⚠ RETURNS null ON FAILURE, AND null IS NOT A QUARTER. The caller must fall back explicitly rather
// than treat null as "no quarter matches" — silently hiding every closed card on a transient query
// error would look exactly like "nothing has closed recently", which is a claim we would not be
// entitled to make. See the fallback in finding-lifecycle.service.ts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { periodOrdinal } from "../findings/trajectory/load-series.js";

/** How long a resolved live quarter is served before it is re-read. Minutes, against a quantity that
 *  moves quarterly — see the header. */
const LIVE_QUARTER_TTL_MS = 10 * 60 * 1000;

let cached: { periodKey: string; at: number } | null = null;
let inFlight: Promise<string | null> | null = null;

async function resolve(): Promise<string | null> {
  try {
    // DISTINCT over the period column — a handful of rows, not a scan of the snapshot table's width.
    const rows = await prisma.scoreSnapshot.findMany({
      where: { snapshotType: "quarterly" },
      select: { periodKey: true },
      distinct: ["periodKey"],
    });
    if (!rows.length) return null;
    // ⚠ ORDERED BY ORDINAL, NOT LEXICOGRAPHICALLY. "FY9Q4" vs "FY10Q1" would sort wrong as strings;
    //   periodOrdinal is the codebase's one answer to "which fiscal period is later".
    return rows
      .map((r) => r.periodKey)
      .sort((a, b) => periodOrdinal(b) - periodOrdinal(a))[0];
  } catch (err) {
    console.warn(`[read/live-quarter] could not resolve the live quarter: ${(err as Error).message}`);
    return null;
  }
}

/**
 * The newest fiscal period any scored snapshot carries — e.g. "FY27Q1". `null` when it could not be
 * resolved (empty corpus, or a failed query); callers must handle that as "unknown", never as "none".
 */
export async function getLiveQuarter(): Promise<string | null> {
  const now = Date.now();
  if (cached && now - cached.at < LIVE_QUARTER_TTL_MS) return cached.periodKey;
  if (inFlight) return inFlight;
  inFlight = resolve().then((pk) => {
    if (pk) cached = { periodKey: pk, at: Date.now() };
    inFlight = null;
    return pk;
  });
  return inFlight;
}

/** Drop the memo — for tests and for a rescore job that has just written a new period. */
export function resetLiveQuarterCache(): void {
  cached = null;
  inFlight = null;
}
