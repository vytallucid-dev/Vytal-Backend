// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO HOLDINGS — the authenticated user's materialized positions, enriched
// with the live read layer (price · health · tier) every portfolio surface needs.
//
//   GET /api/v1/me/holdings            current holdings (qty>0) + per-holding
//                                      currentPrice / marketValue / dayChange /
//                                      health+band / tier / weight, + book totals
//   GET /api/v1/me/holdings?includeExited=true   also rows fully exited (qty=0),
//                                                 whose realized_pnl still matters
//
// Read-only projection of the FIFO replay joined to the SAME sources the PHS engine
// assembles (stock_prices · score_snapshots · market_cap_tier_snapshot) — bulk-
// fetched (no N+1). Nothing is scored here; the composite/band/tier are READ, never
// recomputed. Owner = req.authUser.userId (IDOR-proof — no id/userId input).
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export const listHoldings = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const includeExited = String(req.query.includeExited ?? "") === "true";

  const rows = await prisma.holding.findMany({
    where: { userId, ...(includeExited ? {} : { quantity: { gt: 0 } }) },
    orderBy: { investedValue: "desc" },
    include: {
      stock: { select: { id: true, symbol: true, name: true, sector: { select: { name: true, displayName: true } } } },
      lots: { orderBy: { buyDate: "asc" }, select: { quantity: true, costPerShare: true, buyDate: true, sourceTxnId: true } },
    },
  });

  const stockIds = rows.map((h) => h.stock.id);

  // ── Bulk read layer: current price, latest health snapshot, latest tier freeze ──
  // (three queries total; latest-per-stock resolved in JS from the ordered rows,
  //  mirroring assemblePortfolio's per-stock findFirst ordering exactly.)
  const [prices, scores, tiers] = await Promise.all([
    prisma.stockPrice.findMany({
      where: { stockId: { in: stockIds } },
      select: { stockId: true, price: true, prevClose: true, dayChangePct: true, marketCap: true },
    }),
    prisma.scoreSnapshot.findMany({
      where: { stockId: { in: stockIds } },
      orderBy: [{ asOfDate: "desc" }, { version: "desc" }],
      select: { stockId: true, composite: true, labelBand: true, asOfDate: true, periodKey: true },
    }),
    prisma.marketCapTierSnapshot.findMany({
      where: { stockId: { in: stockIds } },
      orderBy: { asOfDate: "desc" },
      select: { stockId: true, tier: true },
    }),
  ]);

  const priceBy = new Map(prices.map((p) => [p.stockId, p]));
  const scoreBy = new Map<string, (typeof scores)[number]>();
  for (const s of scores) if (!scoreBy.has(s.stockId)) scoreBy.set(s.stockId, s); // first = latest
  const tierBy = new Map<string, string>();
  for (const t of tiers) if (!tierBy.has(t.stockId)) tierBy.set(t.stockId, t.tier); // first = latest

  const enriched = rows.map((h) => {
    const qty = Number(h.quantity);
    const invested = Number(h.investedValue);
    const price = priceBy.get(h.stock.id);
    const score = scoreBy.get(h.stock.id);

    const currentPrice = numOrNull(price?.price);
    const prevClose = numOrNull(price?.prevClose);
    const dayChangePct = numOrNull(price?.dayChangePct);
    const marketValue = currentPrice != null ? qty * currentPrice : null;
    // Today's ₹ move for the position — exact when yesterday's close is known.
    const dayChangeValue = currentPrice != null && prevClose != null ? qty * (currentPrice - prevClose) : null;
    const unrealizedPnl = marketValue != null ? marketValue - invested : null;

    return {
      symbol: h.stock.symbol,
      name: h.stock.name,
      sector: h.stock.sector?.displayName ?? h.stock.sector?.name ?? null,
      quantity: h.quantity.toString(),
      avgCost: h.avgCost.toString(),
      investedValue: h.investedValue.toString(),
      realizedPnl: h.realizedPnl.toString(),
      lastComputedAt: h.lastComputedAt.toISOString(),
      // ── live read layer (null = honestly not available, never faked) ──
      currentPrice, // ₹/share (last close)
      marketValue, // qty × currentPrice
      dayChangePct, // stock's % move at last close
      dayChangeValue, // position ₹ move at last close
      unrealizedPnl, // marketValue − invested
      health: score ? Number(score.composite) : null, // stock composite 0..100 (null ⇒ unscored)
      band: score ? score.labelBand : null, // fragile|below_par|steady|healthy|pristine
      healthAsOf: score ? score.asOfDate.toISOString().slice(0, 10) : null,
      tier: tierBy.get(h.stock.id) ?? "unknown", // large|mid|small|unknown
      weight: 0, // book weight by value — filled below once totalMarketValue is known
      lots: h.lots.map((l) => ({
        quantity: l.quantity.toString(),
        costPerShare: l.costPerShare.toString(),
        buyDate: l.buyDate.toISOString().slice(0, 10),
        sourceTxnId: l.sourceTxnId,
      })),
    };
  });

  // ── Book totals + display weights (value share; a tracker figure, not a PHS weight) ──
  const totalMarketValue = enriched.reduce((s, h) => s + (h.marketValue ?? 0), 0);
  for (const h of enriched) {
    h.weight = totalMarketValue > 0 && h.marketValue != null ? h.marketValue / totalMarketValue : 0;
  }
  const investedOfPriced = enriched.reduce((s, h) => s + (h.marketValue != null ? Number(h.investedValue) : 0), 0);
  const dayChangeValueTotal = enriched.reduce((s, h) => s + (h.dayChangeValue ?? 0), 0);
  const pricedPositions = enriched.filter((h) => h.marketValue != null).length;

  // Portfolio-level realized total (across all positions incl. exited).
  const realizedTotal = await prisma.holding.aggregate({ where: { userId }, _sum: { realizedPnl: true } });

  const prevValue = totalMarketValue - dayChangeValueTotal; // book value at yesterday's close (priced names)

  return res.json({
    success: true,
    data: {
      holdings: enriched,
      totals: {
        positions: enriched.length,
        pricedPositions, // how many carry a live price (coverage honesty for value figures)
        investedValue: enriched.reduce((s, h) => s + Number(h.investedValue), 0).toFixed(2),
        realizedPnlAll: (realizedTotal._sum.realizedPnl ?? 0).toString(),
        currentValue: totalMarketValue.toFixed(2),
        unrealizedPnl: (totalMarketValue - investedOfPriced).toFixed(2), // vs invested of PRICED names only
        dayChangeValue: dayChangeValueTotal.toFixed(2),
        dayChangePct: prevValue > 0 ? ((dayChangeValueTotal / prevValue) * 100).toFixed(4) : null,
      },
    },
  });
};
