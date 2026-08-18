import "dotenv/config";
import { prisma } from "../db/prisma.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
const pad=(s:unknown,n:number)=>String(s).padEnd(n); const lp=(s:unknown,n:number)=>String(s).padStart(n);

console.log("── odd fiscal-year-ends (non-march) ──");
const fye = await raw(`SELECT "fiscalYearEnd" f, count(*)::int n, string_agg("symbol", ' ' ORDER BY "symbol") syms
  FROM stocks WHERE "fiscalYearEnd" <> 'march' GROUP BY 1`);
for (const r of fye) console.log(`  ${pad(r.f,12)} ${lp(r.n,3)}  ${String(r.syms).slice(0,150)}`);

console.log("\n── zero-standalone stocks (annual) with consolidated present ──");
const z = await raw(`WITH k AS (SELECT st."symbol", st."industryType" ind,
    count(f."id") FILTER (WHERE f."result_type"='standalone')::int sa,
    count(f."id") FILTER (WHERE f."result_type"='consolidated')::int co FROM stocks st
    LEFT JOIN fundamentals f ON f."stock_id"=st."id" GROUP BY 1,2)
  SELECT * FROM k WHERE sa=0 AND co>0 ORDER BY co DESC LIMIT 12`);
for (const r of z) console.log(`  ${pad(r.symbol,14)} ${pad(r.ind,16)} sa=${r.sa} co=${r.co}`);

console.log("\n── stocks with NO rows at all in either table ──");
const none = await raw(`SELECT st."symbol", st."industryType" ind FROM stocks st
  WHERE NOT EXISTS (SELECT 1 FROM fundamentals f WHERE f."stock_id"=st."id")
    AND NOT EXISTS (SELECT 1 FROM quarterly_results q WHERE q."stock_id"=st."id") LIMIT 10`);
for (const r of none) console.log(`  ${pad(r.symbol,14)} ${r.ind}`);

console.log("\n── banking stocks, by rows held ──");
const bk = await raw(`SELECT st."symbol",
    (SELECT count(*)::int FROM banking_fundamentals b WHERE b."stock_id"=st."id") bf,
    (SELECT count(*)::int FROM banking_quarterly_results bq WHERE bq."stock_id"=st."id") bq,
    (SELECT count(*)::int FROM banking_fundamentals b WHERE b."stock_id"=st."id" AND b."result_type"='standalone') bfsa
  FROM stocks st WHERE st."industryType"='banking' ORDER BY 2 DESC, 1`);
for (const r of bk) console.log(`  ${pad(r.symbol,14)} bank_fund=${lp(r.bf,3)} (sa ${r.bfsa})  bank_qtr=${lp(r.bq,3)}`);
await prisma.$disconnect();
