// READ-ONLY recon: index_prices coverage range check.
import { prisma } from "../db/prisma.js";

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT index_name, MIN(date)::date as min_date, MAX(date)::date as max_date, COUNT(*)::int as n
    FROM index_prices GROUP BY index_name ORDER BY index_name
  `);
  console.log(JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
