// How many annual rows carry NO balance-sheet metric at all?
import { prisma } from "../db/prisma.js";
const q = <T = any>(sql: string, ...a: any[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a);
const BS: [string, string, string, string[]][] = [
  ["non_financial","fundamentals","consolidated",["total_assets","net_worth","total_debt","borrowings_current","cash_and_cash_equivalents","inventories","trade_receivables_current","property_plant_and_equipment"]],
  ["banking","banking_fundamentals","standalone",["deposits","advances","total_assets","net_worth","borrowings","investments"]],
  ["nbfc","nbfc_fundamentals","consolidated",["loans","total_assets","total_liabilities","net_worth","cash_and_cash_equivalents"]],
  ["life_insurance","life_insurance_fundamentals","standalone",["policyholders_funds","investments_policyholders","investments_shareholders","assets_held_to_cover_linked_liabilities","net_worth"]],
  ["general_insurance","general_insurance_fundamentals","standalone",["investments","net_worth","fair_value_change_account","cash_and_bank_balances"]],
];
async function main() {
  let tot = 0, bad = 0;
  for (const [family, table, basis, cols] of BS) {
    const none = cols.map((c) => `f."${c}" is null`).join(" and ");
    const r = await q(`select count(*)::int n, sum(case when ${none} then 1 else 0 end)::int empty
      from ${table} f join stocks s on s.id=f.stock_id
      join ${table === "fundamentals" ? "quarterly_results" : table.replace("_fundamentals","_quarterly_results")} b
        on b.stock_id=f.stock_id and b.fiscal_year=f.fiscal_year and b.result_type=f.result_type and b.quarter='Q4'
      where f.result_type=$1`, basis);
    tot += r[0].n; bad += r[0].empty;
    console.log(`${family}: ${r[0].empty}/${r[0].n} annual rows paired to a Q4 carry NO balance-sheet metric`);
    const ex = await q(`select s.symbol, f.fiscal_year from ${table} f join stocks s on s.id=f.stock_id
      where f.result_type=$1 and ${none} order by f.fiscal_year desc limit 6`, basis);
    if (ex.length) console.log("   e.g. " + ex.map((x)=>`${x.symbol} ${x.fiscal_year}`).join(", "));
  }
  console.log(`\nALL: ${bad}/${tot} (${((bad/tot)*100).toFixed(1)}%)`);
}
main().then(() => prisma.$disconnect());
