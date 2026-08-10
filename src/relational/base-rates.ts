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
// ★ THE CHANNEL PREDICATE — projected from FILING_REGISTRY, the same table the filing pass writes its
//   rows from, so "which population does this key belong to" cannot drift from "who wrote it".
import { isFilingChannelKey } from "../filing/channel.js";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ TWO POPULATIONS, AND A KEY BELONGS TO EXACTLY ONE (step 5).
//
// Until the filing pass there was one population and one denominator: the stocks we score. Every
// pattern was written against a snapshot, so "fired on N of 95" was arithmetically closed — numerator
// and denominator drawn from the same set.
//
// The 22 filing rules broke that. They run on all 504 active stocks and write to stock_findings, so a
// filing pattern's NUMERATOR is drawn from up to 504 while the denominator stayed at 95. That is not
// an understatement, it is a different fraction: P8 fires on 86 stocks and the old arithmetic would
// have divided that by 95 and reported a rate of 90%.
//
// ── ★ WHY THE FILING DENOMINATOR IS PER RULE, NOT PER GRAIN AND NOT 504 ──────────────────────────
// The obvious candidates both count stocks as clean observations that we never observed:
//
//   504 (every active stock)  — 24 stocks file no annual accounts at all and 16 file no quarterly
//                               results. A rule that never ran on them cannot claim they came back
//                               clean, and dividing by 504 asserts exactly that.
//   the GRAIN population      — better (480 annual / 488 quarterly / 504 shareholding) but still
//                               wrong, because the ten industry guards decline 74 stocks that DO file
//                               annual accounts. R3 declines on every bank; counting those banks in
//                               R3's denominator says "we checked their earnings quality and it was
//                               fine", which is the precise thing we refused to say.
//
// So the denominator is the population in which THAT RULE ACTUALLY EVALUATED: the stocks whose current
// row is `fired` or `not_fired`. `not_evaluable` rows are the declines and are excluded by name; an
// absent row is "no filing at that grain" and is excluded by absence. Both are already recorded per
// rule per stock by the filing pass, so this is a read of a fact rather than a reconstruction of one.
//
// The grain still shows through the numbers — the shareholding rules evaluate on 504, the annual ones
// on 380 or fewer, the quarterly ones on 291–414 — but it shows through as a CONSEQUENCE of
// evaluability rather than as a second rule that has to agree with the first.
//
// ⚠ THE DENOMINATORS ARE HONESTLY SMALL IN PLACES AND ARE NOT FLOORED. R3 evaluated on 10 stocks
// (four years of accounts is rare in our data), N1/N2 on 16, N3 on 10. A minimum-n rule would be a
// threshold invented here, and this layer's founding constraint is that no rate is authored. The
// count renders beside the share in every claim (§3.5.3), so a reader sees `2 of the 10 we could
// check` and can weigh it themselves — which is what the self-describing rule is for.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Which population a key's rate is drawn from. A key resolves to exactly one. */
export type BaseRatePopulation = "scored" | "filing";

/** One key's incidence across ITS OWN population. */
export interface BaseRate {
  patternKey: string;
  /** ★ WHICH SET THE TWO NUMBERS BELOW ARE DRAWN FROM. Projected from the filing registry, never a
   *  literal list — see filing/channel.ts and the note above `compute`. */
  population: BaseRatePopulation;
  /** scored: distinct stocks whose IN-FORCE head snapshot carries this key.
   *  filing: distinct stocks whose CURRENT row for this rule is `fired`. */
  firedInUniverse: number;
  /** The expectedShare denominator, PER KEY.
   *  scored: distinct stocks with any in-force snapshot (the same number for every scored key).
   *  filing: distinct stocks in which THIS RULE evaluated — fired + not_fired. Varies by rule. */
  universeCount: number;
  /** firedInUniverse / universeCount, 0–1. */
  expectedShare: number;
  /** The as-of this rate is true at, PER KEY. scored: the newest snapshot asOfDate. filing: the
   *  newest filing period_end among the rows that evaluated — a filing rate is as-of a FILING, not
   *  as-of a rescore. ⚠ Not yet rendered: the echo claim still prints the snapshot-level date for
   *  both. Named in the copy report; copy is its own pass. */
  asOfDate: Date | null;
}

export interface BaseRateSnapshot {
  /** Keyed by patternKey. A key absent from the map fired on ZERO stocks — see `rateFor`. */
  rates: Map<string, BaseRate>;
  /** Distinct stocks with an in-force snapshot — the SCORED population's denominator. Still carried
   *  at snapshot level because it is the same for every scored key; a filing key's denominator is on
   *  its own `BaseRate` and must be read from there. */
  universeCount: number;
  /** The newest asOfDate in the in-force set — the scored population's as-of. */
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
 *
 * ★ NO Prisma.raw ON THE SUPPRESSION PREDICATES, DELIBERATELY. AGGREGATE_SQL is a PLAIN template
 * literal assembled at module load and handed to $queryRawUnsafe as a finished string, so its
 * interpolations splice SQL TEXT — which is what a predicate needs. The sibling boundary
 * (relational/reader-context.ts) uses a TAGGED $queryRaw template, where the identical expression is
 * instead BOUND AS A PARAMETER and the statement dies with 22P02; it wraps both predicates in
 * Prisma.raw for exactly that reason. Same two helpers, two different splice mechanics, and nothing
 * in the type system distinguishes them — scripts/verify-sql-predicates.ts holds both sites to it.
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
  --   No Prisma.raw here, deliberately — see the note above AGGREGATE_SQL.
  WHERE ${retiredKeysSqlPredicate("p.pattern_key")} AND ${notCoveredKeysSqlPredicate("p.pattern_key")}
  GROUP BY p.pattern_key
)
SELECT f.pattern_key AS "patternKey",
       f.n           AS "firedInUniverse",
       u.n           AS "universeCount",
       u.as_of       AS "asOfDate"
FROM fired f CROSS JOIN universe u
`;

/**
 * ★ THE FILING POPULATION — one row per filing rule, with ITS OWN denominator.
 *
 * `cur` is the current row per (stock, rule): the table accumulates periods, and "what is standing
 * now" is the greatest period_end, which is the same reduction filing/read.ts performs in memory.
 *
 * The two counts are deliberately asymmetric and that asymmetry IS the fix:
 *   firedInUniverse  — current row is `fired`
 *   universeCount    — current row is `fired` OR `not_fired`, i.e. the rule RAN and produced a verdict
 *
 * A `not_evaluable` row is a decline and is excluded from BOTH: we did not observe the pattern and we
 * did not observe its absence either. A stock with no row at all never reaches this query, which is
 * the same exclusion arriving by a different route.
 *
 * ⚠ NO SUPPRESSION PREDICATE HERE, AND THAT IS NOT AN OVERSIGHT. stock_findings is written only from
 * FILING_REGISTRY (filing/pass.ts), whose module-load assertions refuse a key that is not one of the
 * 22 — so a retired or `notcovered_*` key cannot be in this table to be filtered. The two score-side
 * predicates exist because score_patterns accumulated keys from rules that have since been retired;
 * this table has no such history to carry.
 */
const FILING_AGGREGATE_SQL = `
WITH cur AS (
  SELECT DISTINCT ON (f.stock_id, f.rule_key)
         f.stock_id, f.rule_key, f.evaluation_state, f.period_end
  FROM stock_findings f
  ORDER BY f.stock_id, f.rule_key, f.period_end DESC
)
SELECT rule_key AS "patternKey",
       count(*) FILTER (WHERE evaluation_state = 'fired')::int AS "firedInUniverse",
       count(*) FILTER (WHERE evaluation_state IN ('fired', 'not_fired'))::int AS "universeCount",
       max(period_end) FILTER (WHERE evaluation_state IN ('fired', 'not_fired')) AS "asOfDate"
FROM cur
GROUP BY rule_key
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
    // Two queries, two populations, ONE map. They cannot collide: a key is a filing key or it is not,
    // and `isFilingChannelKey` is projected from the registry the filing pass itself writes from.
    const [scoredRows, filingRows] = await Promise.all([
      prisma.$queryRawUnsafe<AggregateRow[]>(AGGREGATE_SQL),
      prisma.$queryRawUnsafe<AggregateRow[]>(FILING_AGGREGATE_SQL),
    ]);

    const universeCount = scoredRows.length
      ? Number(scoredRows[0].universeCount) || 0
      : (await prisma.scoreSnapshot.findMany({ distinct: ["stockId"], select: { stockId: true } })).length;

    const rates = new Map<string, BaseRate>();

    // ── the SCORED population ──
    for (const r of scoredRows) {
      // ⚠ A FILING KEY REACHING THE SCORED QUERY IS A FROZEN ROW, NOT A RATE. score_patterns still
      //   holds the rows the 21 rules wrote before step 2 deregistered them; step 4 stopped SERVING
      //   them but could not un-write them. Counting them here would put the same key in the map
      //   twice, and the losing write would be whichever query happened to run second.
      if (isFilingChannelKey(r.patternKey)) continue;
      const fired = Number(r.firedInUniverse) || 0;
      rates.set(r.patternKey, {
        patternKey: r.patternKey,
        population: "scored",
        firedInUniverse: fired,
        universeCount,
        expectedShare: universeCount > 0 ? fired / universeCount : 0,
        asOfDate: r.asOfDate ?? null,
      });
    }

    // ── the FILING population, each key with its own evaluated denominator ──
    for (const r of filingRows) {
      const fired = Number(r.firedInUniverse) || 0;
      const evaluated = Number(r.universeCount) || 0;
      rates.set(r.patternKey, {
        patternKey: r.patternKey,
        population: "filing",
        firedInUniverse: fired,
        universeCount: evaluated,
        expectedShare: evaluated > 0 ? fired / evaluated : 0,
        asOfDate: r.asOfDate ?? null,
      });
    }

    return { rates, universeCount, asOfDate: scoredRows[0]?.asOfDate ?? null, computedAt: new Date() };
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
  const hit = snap.rates.get(patternKey);
  if (hit) return hit;
  // ⚠ THE FALLBACK MUST NOT BORROW THE SCORED DENOMINATOR FOR A FILING KEY. A filing key absent from
  //   the map means the filing pass has written no evaluated row for it anywhere — the rule has never
  //   produced a verdict on any stock — so its population is EMPTY, not 95. universeCount 0 gives
  //   expectedShare 0 and a null lift, which renders no lift clause rather than a fabricated multiple.
  const isFiling = isFilingChannelKey(patternKey);
  return {
    patternKey,
    population: isFiling ? "filing" : "scored",
    firedInUniverse: 0,
    universeCount: isFiling ? 0 : snap.universeCount,
    expectedShare: 0,
    asOfDate: isFiling ? null : snap.asOfDate,
  };
}

/** Test/diagnostic seam — clears the cache so a fixture can control the snapshot. */
export function __resetBaseRateCache(): void {
  cached = null;
  inFlight = null;
}
