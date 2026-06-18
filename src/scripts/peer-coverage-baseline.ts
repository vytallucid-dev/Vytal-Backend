// READ-ONLY: baseline the financials + shareholding coverage of a few already-
// ingested peers, so the 4 newly-ingested stocks can be judged "same coverage as
// peers" against real numbers (not an assumption). Writes nothing.
//   npx tsx src/scripts/peer-coverage-baseline.ts [SYM1 SYM2 ...]

import { prisma } from "../db/prisma.js";

const SYMS = process.argv.slice(2).length ? process.argv.slice(2) : ["OIL", "BHEL", "GRASIM", "COCHINSHIP"];

async function main() {
  console.log("PEER COVERAGE BASELINE (read-only)\n");
  for (const symbol of SYMS) {
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true, symbol: true } });
    if (!stock) { console.log(`  ${symbol}: NOT IN DB`); continue; }

    const funds = await prisma.fundamental.findMany({
      where: { stockId: stock.id },
      select: { fiscalYear: true, resultType: true },
      orderBy: { fiscalYear: "asc" },
    });
    const qr = await prisma.quarterlyResult.findMany({
      where: { stockId: stock.id },
      select: { fiscalYear: true, quarter: true, resultType: true },
    });
    const sh = await prisma.shareholdingPattern.count({ where: { stockId: stock.id } });
    const shRange = await prisma.shareholdingPattern.findMany({
      where: { stockId: stock.id }, select: { asOnDate: true }, orderBy: { asOnDate: "asc" },
    });

    const annualStd = funds.filter((f) => f.resultType === "standalone").map((f) => f.fiscalYear);
    const annualCons = funds.filter((f) => f.resultType === "consolidated").map((f) => f.fiscalYear);
    const qStd = qr.filter((q) => q.resultType === "standalone").length;
    const qCons = qr.filter((q) => q.resultType === "consolidated").length;

    console.log(`  ${symbol}`);
    console.log(`     annual standalone   : ${annualStd.length}  [${annualStd.join(",")}]`);
    console.log(`     annual consolidated : ${annualCons.length}  [${annualCons.join(",")}]`);
    console.log(`     quarterly std/cons  : ${qStd}/${qCons}`);
    console.log(`     shareholding rows   : ${sh}  [${shRange[0]?.asOnDate?.toISOString().slice(0,10) ?? "?"} … ${shRange[shRange.length-1]?.asOnDate?.toISOString().slice(0,10) ?? "?"}]`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
