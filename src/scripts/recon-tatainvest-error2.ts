import { prisma } from "../db/prisma.js";

async function main() {
  const stock = await prisma.stock.findUnique({ where: { symbol: "TATAINVEST" }, select: { id: true } });
  if (!stock) { console.log("not found"); return; }
  const logs = await prisma.resultFetchLog.findMany({
    where: { stockId: stock.id, fiscalYear: "FY25" },
    orderBy: { fetchedAt: "desc" },
  });
  for (const l of logs) console.log(l.fetchedAt.toISOString(), l.quarter, l.resultType, l.status, (l.error ?? "").slice(0, 200));
  console.log("server now:", (await prisma.$queryRaw`select now()`));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
