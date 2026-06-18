// STAGE 1 — per-stock ingestion via the EXISTING pipeline (no new write path).
// Thin orchestrator: calls scanSymbol() (financials, dual-basis, live NSE XBRL)
// then ingestShareholdingForStock() (shareholding XBRL, 3-vintage parser). All
// writes are done by those existing functions; this file writes nothing itself.
// Mirrors test-reingest-one-2022-stock.ts (which already drives the shareholding
// pipeline from a one-off runner).
//
//   npx tsx src/scripts/stage1-ingest.ts PETRONET
//   npx tsx src/scripts/stage1-ingest.ts PETRONET --verify-only   # no fetch, just report DB coverage
//
// quartersBack = 12 to MATCH the universe (every already-ingested peer has
// exactly 12 shareholding rows — verified via peer-coverage-baseline.ts).

import { prisma } from "../db/prisma.js";
import { scanSymbol } from "../ingestions/quaterly-results/scan.js";
import { ingestShareholdingForStock } from "../ingestions/shareholdings/ingest-shareholding.js";

const SYMBOL = (process.argv[2] ?? "").toUpperCase();
const VERIFY_ONLY = process.argv.includes("--verify-only");
const QUARTERS_BACK = 12;

async function coverage(stockId: string) {
  const funds = await prisma.fundamental.findMany({
    where: { stockId }, select: { fiscalYear: true, resultType: true }, orderBy: { fiscalYear: "asc" },
  });
  const qr = await prisma.quarterlyResult.findMany({
    where: { stockId }, select: { fiscalYear: true, quarter: true, resultType: true },
  });
  const sh = await prisma.shareholdingPattern.findMany({
    where: { stockId },
    orderBy: { asOnDate: "desc" },
    select: {
      asOnDate: true, promoterPct: true, fiiPct: true, diiPct: true,
      totalShares: true, promoterShares: true, pledgedShares: true,
    },
  });
  const annualStd = funds.filter((f) => f.resultType === "standalone").map((f) => f.fiscalYear);
  const annualCons = funds.filter((f) => f.resultType === "consolidated").map((f) => f.fiscalYear);
  const qStd = qr.filter((q) => q.resultType === "standalone");
  const qCons = qr.filter((q) => q.resultType === "consolidated");
  const qStdLabels = qStd.map((q) => `${q.quarter}${q.fiscalYear}`).sort();
  return { annualStd, annualCons, qStd: qStd.length, qCons: qCons.length, qStdLabels, sh };
}

function printCoverage(c: Awaited<ReturnType<typeof coverage>>) {
  console.log(`     annual standalone   : ${c.annualStd.length}  [${c.annualStd.join(",")}]`);
  console.log(`     annual consolidated : ${c.annualCons.length}  [${c.annualCons.join(",")}]`);
  console.log(`     quarterly std/cons  : ${c.qStd}/${c.qCons}   std=[${c.qStdLabels.join(",")}]`);
  console.log(`     shareholding rows   : ${c.sh.length}  [${c.sh[c.sh.length-1]?.asOnDate?.toISOString().slice(0,10) ?? "?"} … ${c.sh[0]?.asOnDate?.toISOString().slice(0,10) ?? "?"}]`);
  // pledge BigInt presence (the counts, not the corrupt % fields)
  const withCounts = c.sh.filter((r) => r.totalShares != null && r.promoterShares != null).length;
  const withPledge = c.sh.filter((r) => r.pledgedShares != null).length;
  const latest = c.sh[0];
  const pledgeRatio = latest && latest.promoterShares && Number(latest.promoterShares) > 0 && latest.pledgedShares != null
    ? `${((Number(latest.pledgedShares) / Number(latest.promoterShares)) * 100).toFixed(2)}%` : "n/a";
  console.log(`     pledge BigInt cover : total+promoterShares=${withCounts}/${c.sh.length}, pledgedShares=${withPledge}/${c.sh.length}; latest pledge/promoter=${pledgeRatio}`);
  console.log(`     latest FII/DII/prom : ${latest?.fiiPct ?? "—"} / ${latest?.diiPct ?? "—"} / ${latest?.promoterPct ?? "—"}`);
}

async function main() {
  if (!SYMBOL) { console.error("usage: stage1-ingest.ts SYMBOL [--verify-only]"); process.exit(1); }
  console.log("=".repeat(76));
  console.log(`STAGE 1 INGEST — ${SYMBOL}  (quartersBack=${QUARTERS_BACK}${VERIFY_ONLY ? ", VERIFY-ONLY" : ""})`);
  console.log("=".repeat(76));

  const stock = await prisma.stock.findUnique({
    where: { symbol: SYMBOL },
    select: { id: true, symbol: true, name: true, isActive: true, industryType: true, sector: { select: { name: true } } },
  });
  if (!stock) { console.error(`  ✗ Stock ${SYMBOL} not in DB — run seed-extra-stocks.ts first.`); process.exit(1); }
  console.log(`\n  Stock row: id=${stock.id} name="${stock.name}" sector=${stock.sector?.name} industryType=${stock.industryType} active=${stock.isActive}`);

  if (!VERIFY_ONLY) {
    // ── Financials (existing scanSymbol pipeline; dual-basis, live NSE) ──
    console.log(`\n  → scanSymbol("${SYMBOL}") — financials (this fetches live NSE XBRL)…`);
    const scan = await scanSymbol(SYMBOL);
    console.log(`     filings=${scan.totalFilings} groups=${scan.totalGroups} ingested=${scan.ingested} refreshed=${scan.refreshed} skipped=${scan.skipped} failed=${scan.failed}`);
    if (scan.errors.length) scan.errors.slice(0, 6).forEach((e) => console.log(`       err ${e.qeDate}/${e.filingType}: ${e.error.slice(0,120)}`));

    // ── Shareholding (existing pipeline; 3-vintage XBRL parser) ──
    console.log(`\n  → ingestShareholdingForStock("${SYMBOL}", ${QUARTERS_BACK}) — live NSE XBRL…`);
    const sh = await ingestShareholdingForStock(SYMBOL, QUARTERS_BACK);
    console.log(`     success=${sh.success} processed=${sh.quartersProcessed} inserted=${sh.quartersInserted} skipped=${sh.quartersSkipped}`);
    if (sh.errors.length) sh.errors.slice(0, 6).forEach((e) => console.log(`       err: ${e.slice(0,120)}`));
  }

  // ── Verify coverage ──
  console.log(`\n  COVERAGE (post-ingest):`);
  printCoverage(await coverage(stock.id));

  console.log("\n" + "─".repeat(76));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
