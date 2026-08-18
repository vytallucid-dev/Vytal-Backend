import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
const pad=(s:any,n:number)=>String(s).padEnd(n); const lp=(s:any,n:number)=>String(s).padStart(n);
const cols = await raw(`SELECT column_name c FROM information_schema.columns WHERE table_name='banking_quarterly_results' ORDER BY ordinal_position`);
console.log("banking_quarterly_results cols:", cols.map((x:any)=>x.c).join(", "));
const r = await raw(`
 SELECT CASE WHEN "report_date" <= DATE '2022-01-31' THEN 'pre 2022-01-31' ELSE 'after' END era,
        count(*)::int n,
        count(*) FILTER (WHERE "interest_earned" IS NULL)::int ie_null,
        count(*) FILTER (WHERE "interest_expended" IS NULL)::int ix_null,
        count(*) FILTER (WHERE "gnpa_pct" IS NULL)::int gnpa_null,
        count(*) FILTER (WHERE "net_profit" IS NULL)::int np_null
   FROM banking_quarterly_results WHERE "result_type"='standalone' GROUP BY 1 ORDER BY 1`);
console.log(`\n${pad("era",18)}${lp("rows",7)}${lp("interest_earned NULL",22)}${lp("interest_expended NULL",24)}${lp("gnpa_pct NULL",15)}${lp("netProfit NULL",16)}`);
for (const x of r) console.log(`${pad(x.era,18)}${lp(x.n,7)}${lp(`${x.ie_null} (${(x.ie_null/x.n*100).toFixed(0)}%)`,22)}${lp(`${x.ix_null} (${(x.ix_null/x.n*100).toFixed(0)}%)`,24)}${lp(`${x.gnpa_null} (${(x.gnpa_null/x.n*100).toFixed(0)}%)`,15)}${lp(`${x.np_null}`,16)}`);
const bf = await raw(`
 SELECT CASE WHEN f."fiscal_year" <= 'FY22' THEN 'FY<=22' ELSE 'FY>22' END era, count(*)::int n,
   count(*) FILTER (WHERE f."advances" IS NULL)::int adv, count(*) FILTER (WHERE f."investments" IS NULL)::int inv
  FROM banking_fundamentals f WHERE f."result_type"='standalone' GROUP BY 1 ORDER BY 1`);
console.log(`\nbanking_fundamentals (standalone): ${bf.map((x:any)=>`${x.era}: n=${x.n} advances_null=${x.adv} investments_null=${x.inv}`).join("  |  ")}`);
await prisma.$disconnect();
