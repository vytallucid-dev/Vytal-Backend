// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// UNIVERSE BASE RATES (§3.5.1 / §5.3) — how often each patternKey fires across the scored universe.
//
// ★ COMPUTED, NEVER AUTHORED (§3.5.3). A pattern added later that fires on 60% of the universe is
// absorbed automatically and routes to UE6 framing rather than being silently dropped. There is no
// hardcoded rate anywhere in this layer, and there must never be one — a hardcoded rate corrupts on
// every extension.
//
// ── WHY AN IN-MEMORY CACHE AND NOT A TABLE ──────────────────────────────────────────────────────────
// Every number here is DERIVED, recoverable at any moment by one indexed aggregate over score_patterns
// (37 distinct keys, ~7.4k rows, `@@index([asOfDate, patternKey])` already in place). Nothing is lost
// if the cache is cold — it costs a single query to rebuild. That makes durable storage a PERFORMANCE
// optimisation rather than a correctness requirement, and the no-new-table rule exists precisely to
// stop optimisations from becoming schema. If this later proves hot enough to matter, promoting the
// cache to a table is a small isolated change behind this same interface.
//
// Deterministic across instances: same query, same answer, no coordination needed. A nightly job warms
// it; a cold start computes on first demand and serves thereafter.
//
// ── BOUNDED STALENESS IS ACCEPTABLE HERE ────────────────────────────────────────────────────────────
// Base rates move only when a rescore runs, and a day-old denominator on "17 of 95" does not change
// what the reader takes from the sentence. This tolerance would NOT be acceptable for a score; it is
// acceptable for a denominator that is rendered beside its own as-of date.
//
// ★ SELF-DESCRIBING (§6.3). The snapshot carries its own universe count and as-of date, and BOTH ship
// in every echo entry's `arithmetic`, so each claim states its own basis rather than relying on a
// number the reader cannot see.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { retiredKeysSqlPredicate } from "../catalogue/retired-findings.js";
// ★ NOT-COVERED SUPPRESSION (companion to boundary 7 of 9 below) — a persisted `notcovered_*` row
//   would otherwise corrupt "fires on N of 95" with a configuration we explicitly refused to rank.
import { notCoveredKeysSqlPredicate } from "../catalogue/not-covered.js";

/** One key's incidence across the scored universe. */
export interface BaseRate {
  patternKey: string;
  /** Distinct stocks whose IN-FORCE head snapshot carries this key. */
  firedInUniverse: number;
  /** observedShare denominator — distinct stocks with any in-force snapshot. */
  universeCount: number;
  /** firedInUniverse / universeCount, 0–1. */
  expectedShare: number;
}

export interface BaseRateSnapshot {
  /** Keyed by patternKey. A key absent from the map fired on ZERO stocks — see `rateFor`. */
  rates: Map<string, BaseRate>;
  /** Distinct stocks with an in-force snapshot — the denominator every claim renders. */
  universeCount: number;
  /** The newest asOfDate in the in-force set — the "as of" every claim renders. */
  asOfDate: Date | null;
  computedAt: Date;
}

/**
 * The in-force head set: for each stock, the newest periodKey, and within it MAX(version). Mirrors the
 * read layer's own supersede-aware resolution (`inForceByPeriod` + newest-period), expressed once in
 * SQL so the whole universe is one round trip rather than 95.
 *
 * Counts DISTINCT STOCKS per key, never rows — a stock firing a key twice on one snapshot must not
 * count twice, or the share exceeds 1.
 */
const AGGREGATE_SQL = `
WITH head AS (
  SELECT DISTINCT ON (s.stock_id)
         s.id, s.stock_id, s.as_of_date
  FROM score_snapshots s
  ORDER BY s.stock_id, s.period_key DESC, s.version DESC
),
universe AS (
  SELECT count(*)::int AS n, max(as_of_date) AS as_of FROM head
),
fired AS (
  SELECT p.pattern_key, count(DISTINCT h.stock_id)::int AS n
  FROM score_patterns p
  JOIN head h ON h.id = p.snapshot_id
  -- ★ RETIREMENT SUPPRESSION (boundary 7 of 9 — the relational base rates). RAW SQL, which is
  --   precisely why suppression is not a Prisma client extension: an extension would silently miss
  --   this query and the base rate would keep quoting "fires on N of 95" for a retired pattern.
  --   The predicate is BUILT FROM the same catalogue array, never a copy of it.
  WHERE ${retiredKeysSqlPredicate("p.pattern_key")} AND ${notCoveredKeysSqlPredicate("p.pattern_key")}
  GROUP BY p.pattern_key
)
SELECT f.pattern_key AS "patternKey",
       f.n           AS "firedInUniverse",
       u.n           AS "universeCount",
       u.as_of       AS "asOfDate"
FROM fired f CROSS JOIN universe u
`;

type AggregateRow = {
  patternKey: string;
  firedInUniverse: number;
  universeCount: number;
  asOfDate: Date | null;
};

let cached: BaseRateSnapshot | null = null;
let inFlight: Promise<BaseRateSnapshot | null> | null = null;

/** Compute the aggregate. Returns null on failure — the caller drops the UE family and records the
 *  degradation rather than rendering a partial echo (§5.7). */
async function compute(): Promise<BaseRateSnapshot | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<AggregateRow[]>(AGGREGATE_SQL);
    if (rows.length === 0) {
      // No patterns fired anywhere. A legitimate state, not an error: the universe count is still
      // meaningful, so an echo could correctly resolve to "nothing repeats" (UE5).
      const uni = await prisma.scoreSnapshot.findMany({ distinct: ["stockId"], select: { stockId: true } });
      return { rates: new Map(), universeCount: uni.length, asOfDate: null, computedAt: new Date() };
    }
    const universeCount = Number(rows[0].universeCount) || 0;
    const rates = new Map<string, BaseRate>();
    for (const r of rows) {
      const fired = Number(r.firedInUniverse) || 0;
      rates.set(r.patternKey, {
        patternKey: r.patternKey,
        firedInUniverse: fired,
        universeCount,
        expectedShare: universeCount > 0 ? fired / universeCount : 0,
      });
    }
    return { rates, universeCount, asOfDate: rows[0].asOfDate ?? null, computedAt: new Date() };
  } catch (err) {
    console.warn(`[relational/base-rates] aggregate failed — UE family will be dropped: ${(err as Error).message}`);
    return null;
  }
}

/**
 * The current base-rate snapshot. Serves the cache when warm; computes on cold start and serves
 * thereafter. Concurrent cold callers share one in-flight computation rather than stampeding.
 *
 * Returns null ONLY when the aggregate could not be computed — the caller must then drop UE entirely
 * and record the degradation. It must never render an echo with a missing number (§3.5.3).
 */
export async function getBaseRates(): Promise<BaseRateSnapshot | null> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = compute().then((snap) => {
    if (snap) cached = snap;
    inFlight = null;
    return snap;
  });
  return inFlight;
}

/** Force a recompute — the nightly warm path. Replaces the cache only on success, so a failed warm
 *  leaves the previous (bounded-stale) snapshot serving rather than emptying the cache. */
export async function warmBaseRates(): Promise<BaseRateSnapshot | null> {
  const snap = await compute();
  if (snap) cached = snap;
  return snap;
}

/**
 * The rate for one key. A key ABSENT from the map fired on zero stocks, which is a real rate (0), not
 * missing data — so this returns a zero-rate rather than null. `universeCount` is still carried, so a
 * claim built on it renders both of its numbers.
 */
export function rateFor(snap: BaseRateSnapshot, patternKey: string): BaseRate {
  return (
    snap.rates.get(patternKey) ?? {
      patternKey,
      firedInUniverse: 0,
      universeCount: snap.universeCount,
      expectedShare: 0,
    }
  );
}

/** Test/diagnostic seam — clears the cache so a fixture can control the snapshot. */
export function __resetBaseRateCache(): void {
  cached = null;
  inFlight = null;
}
