import "dotenv/config";
import { prisma } from "../db/prisma.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
const CUT = "2026-08-16 09:30:03";
const pad=(s:unknown,n:number)=>String(s).padEnd(n); const lp=(s:unknown,n:number)=>String(s).padStart(n);
console.log("── cash-flow fill on PILOT-WRITTEN annual rows, split by fiscal-year-end ──");
const r = await raw(`SELECT st."fiscalYearEnd" fye, f."fiscal_year",
   count(*)::int n,
   count(f."cash_from_operating")::int cfo,
   count(f."total_assets")::int ta
  FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
  WHERE f."updated_at" > TIMESTAMP '${CUT}'
  GROUP BY 1,2 ORDER BY 1,2`);
console.log(`  ${pad("FYE",12)}${pad("FY",7)}${lp("rows",6)}${lp("CFO",6)}${lp("CFO%",7)}${lp("assets",8)}${lp("BS%",6)}`);
for (const x of r) {
  const n=Number(x.n);
  console.log(`  ${pad(x.fye,12)}${pad(x.fiscal_year,7)}${lp(n,6)}${lp(x.cfo,6)}${lp(Math.round(100*Number(x.cfo)/n)+"%",7)}${lp(x.ta,8)}${lp(Math.round(100*Number(x.ta)/n)+"%",6)}`);
}
console.log("\n── post-CF-boundary rows (filing_date > 2021-11-24) with NULL cash flow, by FYE ──");
const g = await raw(`SELECT st."fiscalYearEnd" fye, count(*)::int n,
   count(*) FILTER (WHERE f."cash_from_operating" IS NULL)::int null_cfo,
   string_agg(DISTINCT st."symbol", ' ') syms
  FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
  WHERE f."updated_at" > TIMESTAMP '${CUT}' AND f."filing_date" > TIMESTAMP '2021-11-24'
  GROUP BY 1 ORDER BY 1`);
for (const x of g) console.log(`  ${pad(x.fye,12)} rows=${lp(x.n,4)} null CFO=${lp(x.null_cfo,4)} (${Math.round(100*Number(x.null_cfo)/Number(x.n))}%)  ${x.syms}`);
await prisma.$disconnect();
