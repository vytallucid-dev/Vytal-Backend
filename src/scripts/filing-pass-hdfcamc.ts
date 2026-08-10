// Re-run the filing pass (all 22 rules) for HDFCAMC now that scanSymbol has
// (re-)ingested its financials into the correct (nbfc) industry-specific tables.
// Mirrors filing-pass-industry-mismatch-13.ts's treatment of the original 13.
import { prisma } from "../db/prisma.js";
import { runFilingBackfill } from "../filing/pass.js";

async function main() {
  const r = await runFilingBackfill({
    symbols: ["HDFCAMC"],
    onProgress: (done, total, symbol) => console.log(`  [${done}/${total}] ${symbol}`),
  });
  console.log("\nBackfill result:", { stocks: r.stocks, written: r.written, failed: r.failed, skippedNoPeriod: r.skippedNoPeriod });

  const stock = await prisma.stock.findUnique({ where: { symbol: "HDFCAMC" }, select: { id: true, industryType: true } });
  if (!stock) return;
  const findings = await prisma.stockFinding.findMany({
    where: { stockId: stock.id },
    select: { ruleKey: true, evaluationState: true, standingState: true, notEvaluableReason: true, periodKey: true },
    orderBy: { ruleKey: "asc" },
  });
  const fired = findings.filter((f) => f.evaluationState === "fired");
  const notFired = findings.filter((f) => f.evaluationState === "not_fired");
  const notEval = findings.filter((f) => f.evaluationState === "not_evaluable");
  console.log(`\nHDFCAMC (industryType=${stock.industryType}) — ${findings.length} rule rows: fired=${fired.length} not_fired=${notFired.length} not_evaluable=${notEval.length}`);
  if (fired.length) console.log(`  FIRED: ${fired.map((f) => `${f.ruleKey}[${f.periodKey}]`).join(", ")}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
