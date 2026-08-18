import "dotenv/config"; import { prisma } from "../db/prisma.js";
const raw = async <T=any>(s:string,...p:unknown[]):Promise<T[]>=>(await prisma.$queryRawUnsafe(s,...p)) as T[];
for (const sym of ["SIEMENS","GILLETTE"]) {
  const [st]:any = await raw(`SELECT "id","fiscalYearEnd"::text fye FROM stocks WHERE "symbol"=$1`, sym);
  console.log(`\n── ${sym}  stocks.fiscalYearEnd = ${st.fye}`);
  const r = await raw(`SELECT "report_date"::text rd,"fiscal_year"||"quarter" lbl,"source" src
    FROM quarterly_results WHERE "stock_id"=$1 AND "result_type"='standalone' AND "report_date">=DATE '2023-06-30' ORDER BY "report_date"`, st.id);
  for (const x of r) console.log(`   ${String(x.rd).slice(0,10)}  ${String(x.lbl).padEnd(8)} ${x.src}`);
}
await prisma.$disconnect();
