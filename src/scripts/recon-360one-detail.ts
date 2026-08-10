import { prisma } from "../db/prisma.js";

async function main() {
  const stock = await prisma.stock.findUnique({ where: { symbol: "360ONE" }, select: { id: true } });
  if (!stock) return;
  const findings = await prisma.stockFinding.findMany({
    where: { stockId: stock.id },
    select: { ruleKey: true, evaluationState: true, notEvaluableReason: true, periodKey: true, kind: true },
    orderBy: { ruleKey: "asc" },
  });
  for (const f of findings) {
    console.log(`  ${f.ruleKey.padEnd(38)} ${f.evaluationState.padEnd(14)} period=${f.periodKey.padEnd(10)} ${f.notEvaluableReason ?? ""}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
