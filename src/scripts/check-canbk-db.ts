import { prisma } from "../db/prisma.js";

async function main() {
  const rows = await prisma.shareholdingPattern.findMany({
    where: { symbol: "CANBK" },
    orderBy: { asOnDate: "desc" },
    take: 12,
    select: { asOnDate: true, sourceDate: true, fiiPct: true, diiPct: true, createdAt: true, xbrlUrl: true },
  });
  console.log(`CANBK rows: ${rows.length}`);
  for (const r of rows) {
    console.log(
      r.asOnDate?.toISOString().slice(0, 10),
      "fii=" + r.fiiPct,
      "dii=" + r.diiPct,
      "src=" + r.sourceDate?.toISOString().slice(0, 10),
      "cre=" + r.createdAt?.toISOString().slice(0, 19),
      r.xbrlUrl ? "url=yes" : "url=null",
    );
  }
  await prisma.$disconnect();
}
main().catch(console.error);
