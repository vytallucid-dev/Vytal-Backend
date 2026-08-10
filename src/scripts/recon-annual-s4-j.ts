import { prisma } from "../db/prisma.js";
const q = <T = any>(sql: string, ...a: any[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a);
const NF = ["total_assets","net_worth","total_debt","borrowings_current","cash_and_cash_equivalents","inventories","trade_receivables_current","property_plant_and_equipment","cash_from_operating","cash_from_investing","cash_from_financing","capex","fcf","dividends_paid","basic_eps","roe","debt_to_equity","interest_coverage","receivables_days"];
async function main() {
  const cond = NF.map((c) => `f."${c}" is null`).join(" or ");
  const r = await q(`select s.symbol, ${NF.map((c)=>`(case when f."${c}" is null then '${c} ' else '' end)`).join("||")} as missing
    from fundamentals f join stocks s on s.id=f.stock_id
    join quarterly_results b on b.stock_id=f.stock_id and b.fiscal_year=f.fiscal_year and b.result_type=f.result_type and b.quarter='Q4'
    where f.result_type='consolidated' and f.fiscal_year='FY26' and (${cond}) limit 15`);
  console.log("FY26 consolidated rows with a MANIFEST metric missing:");
  for (const x of r) console.log(`  ${x.symbol}: ${x.missing}`);
  console.log(`  (${r.length} shown)`);

  const sie = await q(`select s.symbol, f.fiscal_year, f.result_type, f.report_date, b.report_date q4
    from fundamentals f join stocks s on s.id=f.stock_id
    join quarterly_results b on b.stock_id=f.stock_id and b.fiscal_year=f.fiscal_year and b.result_type=f.result_type and b.quarter='Q4'
    where s.symbol in ('SIEMENS','NESTLEIND','ABB','VBL') and f.report_date <> b.report_date order by 1,2`);
  console.log("\nDivergent pairs on any basis:");
  for (const x of sie) console.log(`  ${x.symbol} ${x.fiscal_year}/${x.result_type} annual=${String(x.report_date).slice(4,15)} q4=${String(x.q4).slice(4,15)}`);
}
main().then(() => prisma.$disconnect());
