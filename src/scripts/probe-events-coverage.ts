// STEP 0 — Coverage probe. READ ONLY.
//   npx tsx src/scripts/probe-events-coverage.ts
import { prisma } from "../db/prisma.js";

async function main() {
  // ── Insider trades ──────────────────────────────────────────────────────────
  const itCount = await prisma.insiderTrade.count();
  const itSymbols = await prisma.insiderTrade.groupBy({ by: ["symbol"], _count: { _all: true } });
  const itDates = await prisma.insiderTrade.aggregate({ _min: { tradeDate: true }, _max: { tradeDate: true } });
  console.log("── INSIDER TRADES ───────────────────────────────────────────────────");
  console.log(`  Total rows:     ${itCount}`);
  console.log(`  Distinct syms:  ${itSymbols.length}`);
  console.log(`  Date range:     ${itDates._min.tradeDate?.toISOString().slice(0,10)} → ${itDates._max.tradeDate?.toISOString().slice(0,10)}`);
  console.log(`  Sample symbols: ${itSymbols.slice(0,10).map(r=>r.symbol).join(", ")}`);

  // ── Block deals (no symbol column — must join via stockId→Stock) ────────────
  const bdCount = await prisma.blockDeal.count();
  const bdStockIds = await prisma.blockDeal.groupBy({ by: ["stockId"], _count: { _all: true } });
  const bdDates = await prisma.blockDeal.aggregate({ _min: { dealDate: true }, _max: { dealDate: true } });
  // Resolve stockIds to symbols
  const bdStockRows = await prisma.stock.findMany({
    where: { id: { in: bdStockIds.map(r => r.stockId) } },
    select: { id: true, symbol: true },
  });
  const stockIdToSym = new Map(bdStockRows.map(s => [s.id, s.symbol]));
  const bdSymbols = bdStockIds.map(r => ({ symbol: stockIdToSym.get(r.stockId) ?? `(unknown:${r.stockId.slice(0,8)})`, count: r._count._all }));
  console.log("\n── BLOCK/BULK DEALS ─────────────────────────────────────────────────");
  console.log(`  Total rows:     ${bdCount}`);
  console.log(`  Distinct stocks: ${bdStockIds.length}`);
  console.log(`  Date range:     ${bdDates._min.dealDate?.toISOString().slice(0,10)} → ${bdDates._max.dealDate?.toISOString().slice(0,10)}`);
  console.log(`  Symbols (with count): ${bdSymbols.map(r=>`${r.symbol}(${r.count})`).join(", ")}`);

  // ── Universe symbols ────────────────────────────────────────────────────────
  const universe = await prisma.stock.findMany({
    where: { scoreSnapshots: { some: { snapshotType: "quarterly", periodKey: "FY26Q4" } } },
    select: { symbol: true },
    orderBy: { symbol: "asc" },
  });
  const univSet = new Set(universe.map(s => s.symbol));
  console.log("\n── UNIVERSE SYMBOLS (93 scored) ─────────────────────────────────────");
  console.log(`  Count: ${universe.length}`);
  console.log(`  Sample: ${universe.slice(0,10).map(s=>s.symbol).join(", ")}`);

  // ── JOIN coverage: how many universe stocks match raw tables ───────────────
  const itUnivMatch = itSymbols.filter(r => univSet.has(r.symbol));
  const bdUnivMatch = bdSymbols.filter(r => univSet.has(r.symbol ?? ""));
  console.log("\n── JOIN COVERAGE: universe ∩ raw tables ─────────────────────────────");
  console.log(`  InsiderTrade symbols in universe:  ${itUnivMatch.length}/${universe.length}  (${itUnivMatch.map(r=>r.symbol).join(", ")})`);
  console.log(`  BlockDeal symbols in universe:     ${bdUnivMatch.length}/${universe.length}  (${bdUnivMatch.map(r=>r.symbol).join(", ")})`);

  // ── Symbol format mismatch check ──────────────────────────────────────────
  // Check what the raw tables have vs universe
  const itNotInUniv = itSymbols.filter(r => !univSet.has(r.symbol));
  const bdNotInUniv = bdSymbols.filter(r => !univSet.has(r.symbol ?? ""));
  console.log("\n── SYMBOL FORMAT MISMATCH CHECK ─────────────────────────────────────");
  console.log(`  InsiderTrade syms NOT in universe (${itNotInUniv.length}): ${itNotInUniv.slice(0,10).map(r=>r.symbol).join(", ")}`);
  console.log(`  BlockDeal syms NOT in universe    (${bdNotInUniv.length}): ${bdNotInUniv.slice(0,10).map(r=>r.symbol).join(", ")}`);

  // Try case-insensitive / suffix strip
  const univUpper = new Set(universe.map(s => s.symbol.toUpperCase()));
  const itMismatch = itNotInUniv.filter(r => !univUpper.has(r.symbol.toUpperCase().replace(/\.NS$|\.BSE$/i, "")));
  console.log(`  After strip .NS/.BSE: still unmatched in InsiderTrade: ${itMismatch.length}`);

  // ── Sample raw rows for column shape ──────────────────────────────────────
  console.log("\n── SAMPLE InsiderTrade row ──────────────────────────────────────────");
  const itSample = await prisma.insiderTrade.findFirst({ orderBy: { tradeDate: "desc" } });
  if (itSample) console.log(JSON.stringify(itSample, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));

  console.log("\n── SAMPLE BlockDeal row ─────────────────────────────────────────────");
  const bdSample = await prisma.blockDeal.findFirst({ orderBy: { dealDate: "desc" } });
  if (bdSample) console.log(JSON.stringify(bdSample, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));

  // ── Per-universe-stock count ───────────────────────────────────────────────
  console.log("\n── PER-UNIVERSE-STOCK INSIDER COUNT (top 15) ───────────────────────");
  const itByUnivSym = itSymbols.filter(r => univSet.has(r.symbol)).sort((a,b) => b._count._all - a._count._all);
  for (const r of itByUnivSym.slice(0,15)) console.log(`  ${r.symbol.padEnd(16)} ${r._count._all}`);

  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
