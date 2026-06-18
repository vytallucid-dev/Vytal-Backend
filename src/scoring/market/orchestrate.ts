// File: src/scoring/market/orchestrate.ts
//
// MARKET PILLAR ORCHESTRATOR — per-PG, reads the RECONCILED DB ROSTER (stockPeerGroup)
// for the C1/D1 peer pool (spec §7.1: "the peer pool comes from the database roster").
// Loads each member's CLEANED closes (gated via getCleanedCloses → §7.2 clean), computes
// the universal peer-pool references (sector 1yr-return median, sector baseline vol),
// scores all 7 sub-components per member, and assembles the §14.4 pillar.
//
// QUARANTINE: if a member's series carries a structural-break quarantine (clean.ts),
// it is TRUNCATED to post-break closes — so the min-history gates correctly exclude its
// sub-components, AND it drops out of the peer-pool medians (a quarantined stock never
// poisons the sector reference). This is the spec's labeled-exclusion path.

import { prisma } from "../../db/prisma.js";
import { getCleanedCloses } from "../price/load.js";
import type { DailyClose } from "../price/range.js";
import * as SC from "./universal-subcomponents.js";
import { scoreSubComponent, assembleMarketUniversal, type MarketUniversalResult } from "./market-universal.js";

export interface MemberMarket { symbol: string; stockId: string; result: MarketUniversalResult; quarantined: boolean; nDays: number }
export interface PgMarket {
  pgName: string; asOf: Date;
  sectorMedian1yr: number | null; sectorBaselineVol: number | null; poolN: number; d1Reason: string | null;
  members: MemberMarket[];
}

/** Score the universal Market pillar for every member of a PG, peer pool = DB roster. */
export async function scoreMarketForPg(pgName: string, asOfOverride?: Date): Promise<PgMarket | null> {
  const pg = await prisma.peerGroup.findFirst({
    where: { name: pgName },
    include: { stocks: { include: { stock: { select: { id: true, symbol: true } } } } },
  });
  if (!pg) return null;

  const raw: { symbol: string; stockId: string; series: DailyClose[]; quarantined: boolean }[] = [];
  const lastDates: number[] = [];
  for (const sp of pg.stocks) {
    const { id, symbol } = sp.stock;
    const cs = await getCleanedCloses(id, symbol);
    let series = cs.closes;
    let quarantined = false;
    if (cs.report.quarantined && cs.report.quarantineFrom) {
      const qf = new Date(cs.report.quarantineFrom);
      series = series.filter((d) => d.date >= qf); // post-break only
      quarantined = true;
    }
    raw.push({ symbol, stockId: id, series, quarantined });
    if (series.length) lastDates.push(series[series.length - 1].date.getTime());
  }

  // Common as-of = earliest member last-date (every non-quarantined member has a close ≤ asOf).
  const asOf = asOfOverride ?? new Date(Math.max(...lastDates.length ? [Math.min(...lastDates)] : [0]));

  const peers: SC.PeerSeries[] = raw.map((r) => ({ symbol: r.symbol, series: r.series }));
  const secRet = SC.sectorOneYearReturnMedian(peers, asOf);
  const secVol = SC.sectorBaselineVol(peers, asOf);

  const members: MemberMarket[] = raw.map((r) => {
    const subs = [
      scoreSubComponent("A1", SC.a1RangePosition52w(r.series, asOf)),
      scoreSubComponent("A2", SC.a2RangePosition3y(r.series, asOf)),
      scoreSubComponent("B1", SC.b1Vs200Dma(r.series, asOf)),
      scoreSubComponent("B2", SC.b2QuarterTrend(r.series, asOf)),
      scoreSubComponent("B3", SC.b3RecentMove(r.series, asOf)),
      scoreSubComponent("C1", SC.c1RelativeStrength(r.series, asOf, secRet.median)),
      scoreSubComponent("D1", SC.d1VolRatio(r.series, asOf, secVol.baseline)),
    ];
    return { symbol: r.symbol, stockId: r.stockId, result: assembleMarketUniversal(subs), quarantined: r.quarantined, nDays: r.series.length };
  });

  return { pgName: pg.name, asOf, sectorMedian1yr: secRet.median, sectorBaselineVol: secVol.baseline, poolN: secRet.n, d1Reason: secVol.reason, members };
}
