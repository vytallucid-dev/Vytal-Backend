import { prisma } from "../db/prisma.js";

async function main() {
  const stock = await prisma.stock.findUnique({ where: { symbol: "BAJFINANCE" }, select: { id: true, industryType: true } });
  if (!stock) { console.log("not found"); return; }
  const findings = await prisma.stockFinding.findMany({
    where: { stockId: stock.id },
    select: { ruleKey: true, evaluationState: true, notEvaluableReason: true },
    orderBy: { ruleKey: "asc" },
  });
  console.log("BAJFINANCE industryType=", stock.industryType, "rows=", findings.length);
  for (const f of findings) console.log(`  ${f.ruleKey.padEnd(38)} ${f.evaluationState.padEnd(14)} ${f.notEvaluableReason ?? ""}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
