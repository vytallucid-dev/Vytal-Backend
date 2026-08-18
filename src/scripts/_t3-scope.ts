import "dotenv/config";
import { prisma } from "../db/prisma.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
const pad=(s:unknown,n:number)=>String(s).padEnd(n); const lpad=(s:unknown,n:number)=>String(s).padStart(n);

console.log("── T3d: the v3 boundary (earliest period each source wrote) ──");
for (const t of ["fundamentals","quarterly_results"]) {
  const r = await raw(`SELECT "source", min("report_date")::text a, max("report_date")::text b, count(*)::int n
    FROM "${t}" GROUP BY 1 ORDER BY 2`);
  console.log(`  ${t}:`);
  for (const x of r) console.log(`    ${pad(x.source,32)} ${x.a} .. ${x.b}   ${lpad(x.n,5)} rows`);
}

console.log("\n── T3a: (stock, period) pairs currently held, by era ──");
const [f] = await raw(`SELECT
  count(DISTINCT ("stock_id","fiscal_year"))::int all_p,
  count(DISTINCT ("stock_id","fiscal_year")) FILTER (WHERE "report_date" < DATE '2024-06-01')::int pre_v3
  FROM fundamentals`);
const [q] = await raw(`SELECT
  count(DISTINCT ("stock_id","quarter","fiscal_year"))::int all_p,
  count(DISTINCT ("stock_id","quarter","fiscal_year")) FILTER (WHERE "report_date" < DATE '2024-06-01')::int pre_v3
  FROM quarterly_results`);
console.log(`  fundamentals      (stock,FY) periods held: ${f.all_p}   of which report_date < 2024-06-01: ${f.pre_v3}`);
console.log(`  quarterly_results (stock,Q,FY) periods held: ${q.all_p}   of which report_date < 2024-06-01: ${q.pre_v3}`);

console.log("\n── periods MISSING a standalone row (the recoverable set) ──");
const [fm] = await raw(`WITH k AS (SELECT "stock_id","fiscal_year",
    bool_or("result_type"='standalone') sa, min("report_date") rd FROM fundamentals GROUP BY 1,2)
  SELECT count(*) FILTER (WHERE NOT sa)::int miss, count(*) FILTER (WHERE NOT sa AND rd < DATE '2024-06-01')::int miss_pre FROM k`);
const [qm] = await raw(`WITH k AS (SELECT "stock_id","quarter","fiscal_year",
    bool_or("result_type"='standalone') sa, min("report_date") rd FROM quarterly_results GROUP BY 1,2,3)
  SELECT count(*) FILTER (WHERE NOT sa)::int miss, count(*) FILTER (WHERE NOT sa AND rd < DATE '2024-06-01')::int miss_pre FROM k`);
console.log(`  fundamentals:      ${fm.miss} periods lack standalone (${fm.miss_pre} pre-v3)`);
console.log(`  quarterly_results: ${qm.miss} periods lack standalone (${qm.miss_pre} pre-v3)`);

console.log("\n── stocks in scope ──");
const [s] = await raw(`SELECT count(*)::int all_s,
  count(*) FILTER (WHERE "industryType"='non_financial')::int nonfin,
  count(*) FILTER (WHERE "is_active")::int active FROM stocks`);
console.log(`  stocks: ${s.all_s} total · ${s.nonfin} non-financial · ${s.active} isActive (the backfill's own filter)`);
await prisma.$disconnect();
