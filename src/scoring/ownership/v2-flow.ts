// File: src/scoring/ownership/v2-flow.ts
//
// The inputs the rebuilt Ownership pillar (change 2.5) needs, and the one thing about them
// that does not fit production's existing shape.
//
// ★ THE POOL IS UNIVERSE-WIDE, NOT PEER-GROUP-WIDE. §2.5 grades each flow "against the
//   universe's own cross-sectional distribution of that change in that quarter", and the
//   calibration builds that pool over every scored stock (u6-own.cjs: `syms =
//   L.UNIV.map(...)`, all 95, banks included). Production scores one peer group at a time,
//   so the pool is a genuine CROSS-PG read and cannot be assembled from the members at hand.
//
//   It is not a per-PG distribution and must not be quietly turned into one. A promoter
//   selling 2pp means the same thing in cement as in pharma; grading it against six cement
//   peers would make the score depend on which peer group a company happens to sit in,
//   which is the one thing an ownership reading should be free of.
//
// ★ ONE QUERY, CACHED PER PROCESS AND PER CUTOFF. A sweep scores 13 PGs x 12 periods and the
//   pool depends only on the cutoff, so it is built at most once per period rather than 13
//   times. The cache is process-local and keyed by the cutoff, so a point-in-time backfill
//   and a live pass never share one.

import { prisma } from "../../db/prisma.js";
import { SCORED_PGS } from "../composite/pg-registry.js";
import { collapseToOneRowPerQuarter } from "./collapse-quarters.js";
import { pledgeRatio } from "./pledging.js";
import type { OwnershipQuarter } from "./types.js";

/** How far back "a year" is, in filings. Shareholding is quarterly, so four. */
export const YEAR_BACK = 4;

export interface OwnershipV2Readings {
  pledgePctNow: number | null;
  pledgePctYearAgo: number | null;
  promoterChange: number | null;
  institutionalChange: number | null;
}

/**
 * The four readings, from one stock's collapsed quarterly rows at `idx`. PURE.
 *
 * Both the MEMBER's own values and every value in the POOL come through here, so a member's
 * z-score is always computed against a distribution of the identically-derived quantity.
 * Deriving the two separately is the classic way to get a subtly wrong z.
 */
export function readingsAt(rows: OwnershipQuarter[], idx: number = rows.length - 1): OwnershipV2Readings {
  const cur = rows[idx];
  const prior = rows[idx - YEAR_BACK];
  if (!cur) return { pledgePctNow: null, pledgePctYearAgo: null, promoterChange: null, institutionalChange: null };
  const instOf = (q: OwnershipQuarter): number | null =>
    q.fiiPct === null && q.diiPct === null ? null : (q.fiiPct ?? 0) + (q.diiPct ?? 0);
  const dProm = prior && cur.promoterPct !== null && prior.promoterPct !== null ? cur.promoterPct - prior.promoterPct : null;
  const iNow = instOf(cur), iThen = prior ? instOf(prior) : null;
  return {
    pledgePctNow: pledgeRatio(cur),
    pledgePctYearAgo: prior ? pledgeRatio(prior) : null,
    promoterChange: dProm,
    institutionalChange: iNow !== null && iThen !== null ? iNow - iThen : null,
  };
}

export interface UniverseFlowPools {
  promoter: number[];
  institutional: number[];
  /** How many scored stocks contributed, for the recorded reason string. */
  stocks: number;
}

const cache = new Map<string, Promise<UniverseFlowPools>>();

/**
 * The universe's cross-sectional distribution of the two year-on-year flows, as at `cutoff`.
 * `cutoff` undefined = live (every filing). Cached per process, per cutoff.
 */
export function loadUniverseFlowPools(cutoff?: Date): Promise<UniverseFlowPools> {
  const key = cutoff ? cutoff.toISOString().slice(0, 10) : "live";
  const hit = cache.get(key);
  if (hit) return hit;
  const p = build(cutoff);
  cache.set(key, p);
  return p;
}

async function build(cutoff?: Date): Promise<UniverseFlowPools> {
  const members = await prisma.stockPeerGroup.findMany({
    where: { peerGroup: { name: { in: SCORED_PGS.map((g) => g.pgName) } } },
    select: { stockId: true },
  });
  const ids = [...new Set(members.map((m) => m.stockId))];
  if (!ids.length) return { promoter: [], institutional: [], stocks: 0 };

  const rows = await prisma.shareholdingPattern.findMany({
    where: { stockId: { in: ids }, ...(cutoff ? { asOnDate: { lte: cutoff } } : {}) },
    orderBy: { asOnDate: "asc" },
    select: {
      stockId: true, asOnDate: true, quarter: true, fiscalYear: true,
      promoterShares: true, promoterTotalShares: true, totalShares: true, pledgedShares: true,
      promoterPct: true, fiiPct: true, diiPct: true, retailPct: true,
    },
  });

  const byStock = new Map<string, typeof rows>();
  for (const r of rows) {
    const a = byStock.get(r.stockId);
    if (a) a.push(r); else byStock.set(r.stockId, [r]);
  }
  const n = (d: unknown): number | null =>
    d === null || d === undefined ? null : typeof (d as { toNumber?: () => number }).toNumber === "function" ? (d as { toNumber: () => number }).toNumber() : Number(d);

  const promoter: number[] = [], institutional: number[] = [];
  let stocks = 0;
  for (const [, raw] of byStock) {
    // ⚠ COLLAPSE FIRST. shareholding_patterns legitimately holds several filings per quarter
    //   (SEBI capital-change disclosures), and this code reads rows FOUR APART as "a year
    //   ago". Without collapsing, an intra-quarter filing silently makes that nine months.
    const q: OwnershipQuarter[] = collapseToOneRowPerQuarter(raw).map((r) => ({
      asOnDate: r.asOnDate, quarter: r.quarter, fiscalYear: r.fiscalYear,
      promoterShares: r.promoterShares, promoterTotalShares: r.promoterTotalShares,
      totalShares: r.totalShares, pledgedShares: r.pledgedShares,
      promoterPct: n(r.promoterPct), fiiPct: n(r.fiiPct), diiPct: n(r.diiPct), retailPct: n(r.retailPct),
    }));
    if (!q.length) continue;
    stocks++;
    const rd = readingsAt(q);
    if (rd.promoterChange !== null && Number.isFinite(rd.promoterChange)) promoter.push(rd.promoterChange);
    if (rd.institutionalChange !== null && Number.isFinite(rd.institutionalChange)) institutional.push(rd.institutionalChange);
  }
  return { promoter, institutional, stocks };
}

/** Test seam — drop the per-process cache. */
export function __clearFlowPoolCache(): void {
  cache.clear();
}
