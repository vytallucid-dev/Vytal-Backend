// File: src/scoring/read/peer-comparison.service.ts
//
// THE per-stock "vs index" / "vs peer average" assembler for the Technical tab's Price
// Metrics cards. A companion read to price-view.service.ts (§1/§2 of Overview), not a
// modification of it.
//
// TWO INDEPENDENT QUESTIONS, not one: "what index tracks this stock" and "how does it
// compare to its peer group" are different facts with different prerequisites. The index
// question only needs A SECTOR — peer group membership is one path to a sector, not the
// only one. So `index` resolves via the peer group's sectorId wherever a peer group is
// assigned (authoritative — verified 2026-08-09 that 2 of 149 peer-grouped stocks have a
// Stock.sectorId that disagrees with their peer group's sectorId, so it is NEVER
// overridden), and falls back to the stock's own Stock.sectorId only when there's no peer
// group to defer to. Verified sound (2026-08-09 census): all 355 ungrouped stocks carry a
// Stock.sectorId, and every sector in this universe maps to an index with enough history
// for a 1-month return — 504/504 stocks land "ok". `peers` has no such fallback: an
// average genuinely requires peer-group membership, so it stays gated on hasPeerGroup.
//
// Cost: one membership lookup + one batched StockPrice read (`stockId IN (...)`) over the
// peer roster (max observed peer-group size = 10) — never a per-peer fetch loop.

import { prisma } from "../../db/prisma.js";
import { getPeerGroupForStock, getPeerGroupMembers } from "./peer-group-lookup.js";
import { SECTOR_INDEX_MAP, loadIndexLine, pctReturn, num, ymd, round2, WINDOW_DAYS } from "./price-view.service.js";
import type { PriceSeriesPoint } from "./price-view.types.js";
import type { PeerComparisonView, PeerComparisonIndex, IndexUnavailableReason } from "./peer-comparison.types.js";

/** The stock's own trailing return, computed identically to price-view's stock.returns.r1m
 *  (same pctReturn, same window) so the two never disagree — but scoped to a lean ~45-day
 *  read instead of price-view's full 820-day chart series, since this card needs nothing else. */
async function stockOwnReturn1m(stockId: string): Promise<number | null> {
  const rows = await prisma.dailyPrice.findMany({
    where: { stockId },
    orderBy: { date: "desc" },
    take: 45,
    select: { date: true, close: true },
  });
  if (rows.length === 0) return null;
  const series: PriceSeriesPoint[] = rows.map((r) => ({ date: ymd(r.date), close: num(r.close) ?? 0 })).reverse();
  return pctReturn(series, WINDOW_DAYS.r1m);
}

export async function buildPeerComparisonView(symbol: string): Promise<PeerComparisonView | null> {
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true, symbol: true, sectorId: true },
  });
  if (!stock) return null;

  const [peerGroup, stockReturn1mPct] = await Promise.all([
    getPeerGroupForStock(stock.id),
    stockOwnReturn1m(stock.id),
  ]);

  // The sector that decides the benchmark index — peer group's sector is authoritative
  // wherever assigned; the stock's own sectorId is ONLY consulted when there's no peer
  // group to defer to (see file header for why this direction, not the reverse).
  const sectorId = peerGroup?.sectorId ?? stock.sectorId;

  const [sector, members] = await Promise.all([
    sectorId ? prisma.sector.findUnique({ where: { id: sectorId }, select: { name: true } }) : Promise.resolve(null),
    peerGroup ? getPeerGroupMembers(peerGroup.id) : Promise.resolve([]),
  ]);

  let index: PeerComparisonIndex | null = null;
  let indexUnavailableReason: IndexUnavailableReason = null;
  if (!sectorId) {
    indexUnavailableReason = "no_sector";
  } else {
    const indexName = sector?.name ? (SECTOR_INDEX_MAP[sector.name] ?? null) : null;
    const indexLine = indexName ? await loadIndexLine(indexName, indexName) : null;
    if (indexLine) {
      index = { indexName: indexLine.indexName, label: indexLine.label, return1mPct: indexLine.returns.r1m };
    } else {
      indexUnavailableReason = "sector_has_no_index";
    }
  }

  if (!peerGroup) {
    return {
      symbol: stock.symbol,
      hasPeerGroup: false,
      peerGroup: null,
      windowDays: WINDOW_DAYS.r1m,
      stockReturn1mPct,
      index,
      indexUnavailableReason,
      peers: null,
    };
  }

  const peerIds = members.map((m) => m.stockId).filter((id) => id !== stock.id);
  // A peer with no StockPrice row simply isn't in this result set (Prisma never pads in a
  // placeholder), and one with return1m:null is dropped by the filter below — either way
  // it's EXCLUDED from the average, never counted as a 0% move. peerCount below is the
  // actual post-filter length, so the UI states exactly how many peers were averaged.
  const peerPrices = peerIds.length
    ? await prisma.stockPrice.findMany({ where: { stockId: { in: peerIds } }, select: { return1m: true } })
    : [];
  // ★ StockPrice.return1m is stored as a FRACTION (0.038 = +3.8%), same convention as
  // dayChangePct elsewhere in this file — ×100 to reach percent. Missed originally: an
  // IDEA peer-average request in review returned -0.01% when the true figure was -1.27%,
  // a 100x understatement, not a rounding artifact.
  const peerReturns = peerPrices
    .map((p) => num(p.return1m))
    .filter((v): v is number => v != null)
    .map((v) => v * 100);
  const averageReturn1mPct = peerReturns.length
    ? round2(peerReturns.reduce((a, b) => a + b, 0) / peerReturns.length)
    : null;

  return {
    symbol: stock.symbol,
    hasPeerGroup: true,
    peerGroup: { name: peerGroup.name, displayName: peerGroup.displayName, memberCount: members.length },
    windowDays: WINDOW_DAYS.r1m,
    stockReturn1mPct,
    index,
    indexUnavailableReason,
    peers: { averageReturn1mPct, peerCount: peerReturns.length },
  };
}
