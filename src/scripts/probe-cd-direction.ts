// Supplementary DRY probe — demonstrate the C (insider) DOWN-direction and the D
// (block) net-band fire correctly on REAL data, evaluated at a trade-aligned as-of
// (so the 30-day window actually captures the real trades — the FY26Q4 shareholding
// window is fixed at Mar-2026 and is thin). Writes nothing.
//
//   npx tsx src/scripts/probe-cd-direction.ts

import { prisma } from "../db/prisma.js";
import { computeCategoryC, computeCategoryD, type FlowFeeds } from "../scoring/ownership/flow.js";
import { loadFlowFeeds } from "../scoring/ownership/flow-feeds-load.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const f2 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));

async function main() {
  // ── C DOWN-DIRECTION: evaluate C at each stock's latest eligible-trade date ──
  // so the 30-day window captures real promoter/director sells.
  console.log("═".repeat(78));
  console.log("C INSIDER — strongest NET-SELL and NET-BUY signals on real data");
  console.log("(C evaluated at asOf = each stock's latest insider trade date)");
  console.log("═".repeat(78));

  const stockIds = (await prisma.insiderTrade.groupBy({ by: ["stockId"], _count: { _all: true } })).map((r) => r.stockId);
  type Hit = { symbol: string; asOf: Date; rule: string | null; score: number; net: number | null; buyers: number; sellers: number; state: string };
  const hits: Hit[] = [];
  for (const stockId of stockIds) {
    const stock = await prisma.stock.findUnique({ where: { id: stockId }, select: { symbol: true } });
    if (!stock) continue;
    const latest = await prisma.insiderTrade.findFirst({ where: { stockId, tradeDate: { not: null } }, orderBy: { tradeDate: "desc" }, select: { tradeDate: true } });
    const asOf = latest?.tradeDate;
    if (!asOf) continue;
    // feed = ALL eligible insider txns (no cutoff); C windows internally to 30d around asOf
    const loaded = await loadFlowFeeds({ stockId, asOf, daily: [], totalShares: null });
    const c = computeCategoryC(loaded.feeds, asOf);
    if (c.state === "scored" && c.cappedSubScore !== 0) {
      const ev = c.evidence as { buyers?: number; sellers?: number };
      hits.push({ symbol: stock.symbol, asOf, rule: c.firedRule, score: c.cappedSubScore, net: c.netFlowValue, buyers: ev.buyers ?? 0, sellers: ev.sellers ?? 0, state: c.state });
    }
  }
  const sells = hits.filter((h) => h.score < 0).sort((a, b) => a.score - b.score).slice(0, 8);
  const buys = hits.filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  console.log(`\nNET-SELL (Ownership DOWN) — ${hits.filter((h) => h.score < 0).length} stocks fire negative:`);
  for (const h of sells) console.log(`   ${h.symbol.padEnd(13)} @${iso(h.asOf)}  ${h.rule}  score ${h.score}  net ₹${f2(h.net)}cr  (buyers ${h.buyers}, sellers ${h.sellers})`);
  console.log(`\nNET-BUY (Ownership UP) — ${hits.filter((h) => h.score > 0).length} stocks fire positive:`);
  for (const h of buys) console.log(`   ${h.symbol.padEnd(13)} @${iso(h.asOf)}  ${h.rule}  score +${h.score}  net ₹${f2(h.net)}cr  (buyers ${h.buyers}, sellers ${h.sellers})`);

  // ── D BLOCK net-band on the stocks that actually have block deals ──
  console.log("\n" + "═".repeat(78));
  console.log("D BLOCK — net-band on stocks with block/bulk deals (asOf = latest deal date)");
  console.log("═".repeat(78));
  const blkStockIds = (await prisma.blockDeal.groupBy({ by: ["stockId"], _count: { _all: true } })).map((r) => r.stockId);
  for (const stockId of blkStockIds) {
    const stock = await prisma.stock.findUnique({ where: { id: stockId }, select: { symbol: true } });
    if (!stock) continue;
    const latest = await prisma.blockDeal.findFirst({ where: { stockId }, orderBy: { dealDate: "desc" }, select: { dealDate: true } });
    const asOf = latest!.dealDate;
    // need totalShares + a price for the m-cap → pull latest shareholding + a daily close
    const sh = await prisma.shareholdingPattern.findFirst({ where: { stockId }, orderBy: { asOnDate: "desc" }, select: { totalShares: true } });
    const px = await prisma.dailyPrice.findFirst({ where: { stockId, date: { lte: asOf } }, orderBy: { date: "desc" }, select: { close: true, date: true } });
    const daily = px ? [{ date: px.date, close: Number(px.close) }] : [];
    const loaded = await loadFlowFeeds({ stockId, asOf, daily, totalShares: sh?.totalShares ?? null });
    const d = computeCategoryD(loaded.feeds, asOf);
    const blkWin = loaded.feeds.blockTxns!.filter((t) => t.date.getTime() > asOf.getTime() - 30 * 86400000 && t.date.getTime() <= asOf.getTime());
    const net = blkWin.reduce((s, t) => s + (t.side === "buy" ? t.valueInrCr : -t.valueInrCr), 0);
    console.log(`   ${stock.symbol.padEnd(13)} @${iso(asOf)}  ${d.state}  ${d.firedRule ?? ""}  band=${d.bandLanded ?? "—"} score ${d.cappedSubScore}  net ₹${f2(net)}cr = ${f2(d.netFlowValue)}% mcap  (mcap ${loaded.diag.marketCapInrCr ? "₹" + Math.round(loaded.diag.marketCapInrCr).toLocaleString("en-IN") + "cr" : "NULL"})`);
  }

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
