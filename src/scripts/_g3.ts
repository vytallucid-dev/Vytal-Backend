import "dotenv/config";
import { prisma } from "../db/prisma.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
const lp=(s:unknown,n:number)=>String(s).padStart(n);
console.log("── G3b: stocks with FY22Q4 AND FY23Q2 but NOT FY23Q1 (the true severance population) ──");
const [r] = await raw<any>(`
 WITH t AS (SELECT "stock_id" sid,"fiscal_year" fy,"quarter" q,"result_type" rt FROM quarterly_results
            UNION ALL SELECT "stock_id","fiscal_year","quarter","result_type" FROM banking_quarterly_results),
 p AS (SELECT st."id",
    bool_or(fy='FY22' AND q='Q4') h224, bool_or(fy='FY23' AND q='Q1') h231, bool_or(fy='FY23' AND q='Q2') h232,
    bool_or(fy='FY22' AND q='Q4' AND rt='standalone') s224,
    bool_or(fy='FY23' AND q='Q1' AND rt='standalone') s231,
    bool_or(fy='FY23' AND q='Q2' AND rt='standalone') s232
   FROM stocks st LEFT JOIN t ON t.sid=st."id" GROUP BY st."id")
 SELECT count(*)::int total,
   count(*) FILTER (WHERE h224 AND h232 AND NOT h231)::int sandwiched_any,
   count(*) FILTER (WHERE s224 AND s232 AND NOT s231)::int sandwiched_sa,
   count(*) FILTER (WHERE h231)::int has_any,
   count(*) FILTER (WHERE s231)::int has_sa FROM p`);
console.log(`  of ${r.total} stocks: hold FY23Q1 any-basis ${r.has_any} · standalone ${r.has_sa}`);
console.log(`  ⇒ SEVERANCE (has both neighbours but not FY23Q1): any-basis ${r.sandwiched_any} · standalone ${r.sandwiched_sa}`);
console.log("\n── G3c: is FY23Q1 inside the Jan-2022 snapshot window? ──");
const [w] = await raw<any>(`SELECT
  (SELECT max("report_date")::text FROM quarterly_results WHERE "report_date" <= DATE '2022-01-31') latest_loadable,
  (DATE '2022-06-30' > DATE '2022-01-31') fy23q1_after_cutoff`);
console.log(`  latest quarter loadable at the 2022-01-31 cutoff: ${String(w.latest_loadable).slice(0,10)}`);
console.log(`  FY23Q1 period-end 2022-06-30 is after the cutoff: ${w.fy23q1_after_cutoff}`);
console.log(`  ⇒ loadMomentumStandalone(reportDate <= 2022-01-31) never loads it; consecutiveTail runs back from ${String(w.latest_loadable).slice(0,10)}.`);
await prisma.$disconnect();
