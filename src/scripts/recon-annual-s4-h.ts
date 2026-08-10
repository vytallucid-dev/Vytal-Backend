// Stage 4 recon H — steady bands: p25 of |year-on-year delta| per annual ratio metric,
// measured on the PREFERRED basis, in DISPLAY units.
import { prisma } from "../db/prisma.js";
const q = <T = any>(sql: string, ...a: any[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a);

// [family, table, basis, column, displayMultiplier]
const M: [string, string, string, string, number][] = [
  ["non_financial", "fundamentals", "consolidated", "roe", 1],
  ["non_financial", "fundamentals", "consolidated", "debt_to_equity", 1],
  ["non_financial", "fundamentals", "consolidated", "interest_coverage", 1],
  ["non_financial", "fundamentals", "consolidated", "receivables_days", 1],
  ["non_financial", "fundamentals", "consolidated", "basic_eps", 1],
  ["banking", "banking_fundamentals", "standalone", "net_interest_margin", 100],
  ["banking", "banking_fundamentals", "standalone", "credit_cost_pct", 100],
  ["banking", "banking_fundamentals", "standalone", "credit_deposit_ratio", 100],
  ["banking", "banking_fundamentals", "standalone", "roe", 100],
  ["banking", "banking_fundamentals", "standalone", "roa_disclosed", 100],
  ["banking", "banking_fundamentals", "standalone", "basic_eps", 1],
  ["nbfc", "nbfc_fundamentals", "consolidated", "nim", 100],
  ["nbfc", "nbfc_fundamentals", "consolidated", "credit_cost_pct", 100],
  ["nbfc", "nbfc_fundamentals", "consolidated", "cost_to_income_ratio", 100],
  ["nbfc", "nbfc_fundamentals", "consolidated", "roe", 100],
  ["nbfc", "nbfc_fundamentals", "consolidated", "borrowings_to_equity", 1],
  ["nbfc", "nbfc_fundamentals", "consolidated", "basic_eps", 1],
  ["life_insurance", "life_insurance_fundamentals", "standalone", "roe", 100],
  ["life_insurance", "life_insurance_fundamentals", "standalone", "basic_eps", 1],
  ["general_insurance", "general_insurance_fundamentals", "standalone", "roe", 100],
  ["general_insurance", "general_insurance_fundamentals", "standalone", "basic_eps", 1],
];

const FY = ["FY21", "FY22", "FY23", "FY24", "FY25", "FY26"];
const priorOf = (fy: string) => `FY${String(Number(fy.slice(2)) - 1).padStart(2, "0")}`;

async function main() {
  for (const [family, table, basis, col, mult] of M) {
    const pairs: number[] = [];
    for (const fy of FY) {
      const rows = await q(`select (c."${col}"::float - p."${col}"::float) d
        from ${table} c join ${table} p on p.stock_id=c.stock_id and p.result_type=c.result_type and p.fiscal_year=$1
        where c.fiscal_year=$2 and c.result_type=$3 and c."${col}" is not null and p."${col}" is not null`,
        priorOf(fy), fy, basis);
      for (const r of rows) if (Number.isFinite(r.d)) pairs.push(Math.abs(r.d * mult));
    }
    pairs.sort((a, b) => a - b);
    if (pairs.length === 0) { console.log(`${family}.${col}: no pairs`); continue; }
    const at = (p: number) => pairs[Math.min(pairs.length - 1, Math.floor(p * (pairs.length - 1)))];
    console.log(
      `${family}.${col}: n=${pairs.length} p25=${at(0.25).toFixed(4)} p50=${at(0.5).toFixed(4)} p75=${at(0.75).toFixed(4)} max=${at(1).toFixed(2)}`,
    );
  }
}
main().then(() => prisma.$disconnect());
