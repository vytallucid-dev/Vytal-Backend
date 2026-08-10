// Re-run the filing pass (all 22 rules) for the 13 reclassified stocks, now
// that scanSymbol has (re-)ingested their financials into the correct
// industry-specific tables.

import { prisma } from "../db/prisma.js";
import { runFilingBackfill } from "../filing/pass.js";

const SYMBOLS = [
  "360ONE", "ANGELONE", "BAJAJHLDNG", "CANHLIFE", "ABSLAMC", "GODIGIT",
  "ICICIAMC", "JMFINANCIL", "NAM-INDIA", "NIVABUPA", "NUVAMA", "TATAINVEST",
  "UTIAMC",
];

async function main() {
  const r = await runFilingBackfill({
    symbols: SYMBOLS,
    onProgress: (done, total, symbol) => console.log(`  [${done}/${total}] ${symbol}`),
  });
  console.log("\nBackfill result:", {
    stocks: r.stocks,
    written: r.written,
    failed: r.failed,
    skippedNoPeriod: r.skippedNoPeriod,
  });

  console.log("\n── Per-stock stockFindings state after filing pass ──");
  for (const symbol of SYMBOLS) {
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true, industryType: true } });
    if (!stock) continue;
    const findings = await prisma.stockFinding.findMany({
      where: { stockId: stock.id },
      select: { ruleKey: true, evaluationState: true, standingState: true, notEvaluableReason: true, periodKey: true },
      orderBy: { ruleKey: "asc" },
    });
    const fired = findings.filter((f) => f.evaluationState === "fired");
    const notFired = findings.filter((f) => f.evaluationState === "not_fired");
    const notEval = findings.filter((f) => f.evaluationState === "not_evaluable");
    console.log(
      `\n  ${symbol} (industryType=${stock.industryType}) — ${findings.length} rule rows: fired=${fired.length} not_fired=${notFired.length} not_evaluable=${notEval.length}`,
    );
    if (fired.length) console.log(`    FIRED: ${fired.map((f) => `${f.ruleKey}[${f.periodKey}]`).join(", ")}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
