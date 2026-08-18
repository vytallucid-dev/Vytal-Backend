import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { COHORT } from "./_t4-cohort-def.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
const P = COHORT.map(c=>c.symbol); const pad=(s:unknown,n:number)=>String(s).padEnd(n); const lp=(s:unknown,n:number)=>String(s).padStart(n);
console.log("── PILOT 27 ONLY: per-quarter standalone census (the population that got the fix) ──");
const r = await raw<any>(`
  WITH t AS (SELECT "stock_id","fiscal_year" fy,"quarter" q,"result_type" rt FROM quarterly_results
             UNION ALL SELECT "stock_id","fiscal_year","quarter","result_type" FROM banking_quarterly_results)
  SELECT fy, q,
    count(DISTINCT t."stock_id") FILTER (WHERE rt='standalone')::int sa,
    count(DISTINCT t."stock_id") FILTER (WHERE rt='consolidated')::int co,
    count(DISTINCT t."stock_id")::int anyb
  FROM t WHERE t."stock_id" IN (SELECT id FROM stocks WHERE symbol=ANY($1::text[]))
  GROUP BY 1,2 ORDER BY 1,2`, P);
console.log(`  ${pad("period",9)}${lp("SA",5)}${lp("CO",5)}${lp("any",5)}   of 27`);
for (const x of r) {
  const flag = Number(x.sa) <= 20 ? "  ⚠ low" : "";
  console.log(`  ${pad(String(x.fy)+String(x.q),9)}${lp(x.sa,5)}${lp(x.co,5)}${lp(x.anyb,5)}${flag}`);
}
console.log("\n── the 8 pilot stocks lacking FY23Q1 standalone: what IS in result_fetch_logs? ──");
const l = await raw<any>(`SELECT st."symbol" s, rl."quarter" q, rl."fiscal_year" fy, rl."status", rl."result_type" rt,
    rl."xbrl_url" u, rl."error", rl."fetched_at"::text fa
  FROM result_fetch_logs rl JOIN stocks st ON st."id"=rl."stock_id"
  WHERE st."symbol" IN ('ASIANPAINT','BEL','ICICIBANK','SUNPHARMA','HAVELLS','NESTLEIND','SBIN','ULTRACEMCO')
    AND rl."fiscal_year"='FY23' AND rl."quarter"='Q1' ORDER BY 1`);
if (!l.length) console.log("  (no result_fetch_logs row for FY23Q1 for ANY of the eight → never attempted/logged)");
for (const x of l) console.log(`  ${pad(x.s,12)} ${x.status} rt=${x.rt ?? "-"} ${String(x.fa).slice(0,10)} ${x.error ?? ""} ${String(x.u ?? "").slice(0,70)}`);
console.log("\n── do those 8 hold the SURROUNDING quarters? (severance test) ──");
const s = await raw<any>(`
  WITH t AS (SELECT "stock_id","fiscal_year" fy,"quarter" q,"result_type" rt FROM quarterly_results
             UNION ALL SELECT "stock_id","fiscal_year","quarter","result_type" FROM banking_quarterly_results)
  SELECT st."symbol" sym,
    bool_or(fy='FY22' AND q='Q3' AND rt='standalone') q223,
    bool_or(fy='FY22' AND q='Q4' AND rt='standalone') q224,
    bool_or(fy='FY23' AND q='Q1' AND rt='standalone') q231,
    bool_or(fy='FY23' AND q='Q2' AND rt='standalone') q232
  FROM stocks st LEFT JOIN t ON t."stock_id"=st."id"
  WHERE st."symbol" IN ('ASIANPAINT','BEL','ICICIBANK','SUNPHARMA','HAVELLS','NESTLEIND','SBIN','ULTRACEMCO')
  GROUP BY 1 ORDER BY 1`);
console.log(`  ${pad("symbol",13)}FY22Q3 FY22Q4 FY23Q1 FY23Q2`);
for (const x of s) console.log(`  ${pad(x.sym,13)}${lp(x.q223?"yes":"NO",6)}${lp(x.q224?"yes":"NO",7)}${lp(x.q231?"yes":"NO",7)}${lp(x.q232?"yes":"NO",7)}`);
await prisma.$disconnect();
