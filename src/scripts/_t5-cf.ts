import "dotenv/config";
import { prisma } from "../db/prisma.js";
const r = await prisma.$queryRawUnsafe(`SELECT f."fiscal_year" fy, count(*)::int n,
   count(f."cash_from_operating")::int cfo, count(f."capex")::int capex, count(f."cash_from_financing")::int cff,
   count(*) FILTER (WHERE f."filing_date" > TIMESTAMP '2021-11-24')::int post_cf
  FROM fundamentals f WHERE f."stock_id" IN (SELECT id FROM stocks WHERE symbol = ANY($1::text[]))
  GROUP BY 1 ORDER BY 1`, (await import("./_t4-cohort-def.js")).COHORT.map(c=>c.symbol)) as any[];
console.log("T5.3b/c — annual cash-flow fill by fiscal year (cohort)");
console.log("  FY     rows   CFO   capex   CFF   CFO%   post-CF-boundary rows");
for (const x of r) console.log(`  ${String(x.fy).padEnd(6)}${String(x.n).padStart(5)}${String(x.cfo).padStart(6)}${String(x.capex).padStart(8)}${String(x.cff).padStart(6)}${(Math.round(100*x.cfo/x.n)+"%").padStart(7)}${String(x.post_cf).padStart(10)}`);
await prisma.$disconnect();
