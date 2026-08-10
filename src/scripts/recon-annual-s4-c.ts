// Stage 4 recon C — scale + distribution of every candidate ratio/derived column.
import { prisma } from "../db/prisma.js";

const SETS: [string, string, string, string[]][] = [
  ["non_financial", "fundamentals", "consolidated",
   ["net_margin","operating_margin","roe","roce","debt_to_equity","interest_coverage","receivables_days","inventory_turnover","asset_turnover","basic_eps","diluted_eps","book_value_per_share","face_value_share","net_worth","total_debt","fcf","capex","ebitda"]],
  ["banking", "banking_fundamentals", "standalone",
   ["net_interest_margin","cost_to_income_ratio","credit_cost_pct","roe","credit_deposit_ratio","gnpa_pct","nnpa_pct","pcr","cet1_ratio","tier1_ratio","additional_tier1_ratio","roa_disclosed","basic_eps","book_value_per_share","net_worth","deposits","advances","total_assets"]],
  ["nbfc", "nbfc_fundamentals", "consolidated",
   ["nim","cost_to_income_ratio","credit_cost_pct","spread","capital_to_assets_ratio","borrowings_to_equity","roe","basic_eps","book_value_per_share","net_worth","loans","total_assets","total_liabilities","total_equity"]],
  ["life_insurance", "life_insurance_fundamentals", "standalone",
   ["solvency_ratio","persistency_ratio_13_month","persistency_ratio_61_month","new_business_premium_pct","expense_ratio_policyholders","roe","basic_eps","book_value_per_share","net_worth","total_assets","policyholders_funds","surplus_from_revenue_account","transfer_from_policyholders"]],
  ["general_insurance", "general_insurance_fundamentals", "standalone",
   ["combined_ratio","incurred_claim_ratio","expenses_of_management_ratio","net_retention_ratio","solvency_ratio","roe","net_underwriting_margin","basic_eps","book_value_per_share","net_worth","total_assets","investments","underwriting_profit_or_loss"]],
];

async function main() {
  for (const [family, table, basis, cols] of SETS) {
    console.log(`\n=== ${family} · ${basis} · FY25+FY26 ===`);
    for (const c of cols) {
      const r = await prisma.$queryRawUnsafe<any[]>(
        `select count("${c}")::int n, min("${c}")::float lo, max("${c}")::float hi,
                percentile_cont(0.5) within group (order by "${c}")::float med,
                sum(case when "${c}" < 0 then 1 else 0 end)::int neg
         from ${table} where result_type=$1 and fiscal_year in ('FY25','FY26')`, basis);
      const x = r[0];
      if (!x.n) { console.log(`  ${c.padEnd(34)} — no values`); continue; }
      console.log(`  ${c.padEnd(34)} n=${String(x.n).padStart(4)} min=${fmt(x.lo)} p50=${fmt(x.med)} max=${fmt(x.hi)} neg=${x.neg}`);
    }
  }
}
const fmt = (v: number | null) => v === null ? "null" : (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(6)).padStart(12);
main().then(() => prisma.$disconnect());
