// Stage 4 recon G — presence-gate hit rate, sample selection, ABB/Dec-year-end pairing.
import { prisma } from "../db/prisma.js";
const q = <T = any>(sql: string, ...a: any[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a);
const pc = (a: number, b: number) => `${a}/${b} (${b ? ((a / b) * 100).toFixed(1) : "0"}%)`;

const PAIRS = [
  ["non_financial", "fundamentals", "quarterly_results", "consolidated"],
  ["banking", "banking_fundamentals", "banking_quarterly_results", "standalone"],
  ["nbfc", "nbfc_fundamentals", "nbfc_quarterly_results", "consolidated"],
  ["life_insurance", "life_insurance_fundamentals", "life_insurance_quarterly_results", "standalone"],
  ["general_insurance", "general_insurance_fundamentals", "general_insurance_quarterly_results", "standalone"],
] as const;

async function main() {
  console.log("-- 1. PRESENCE GATE: Q4 quarterly rows (preferred basis) that HAVE an annual row --");
  for (const [f, ft, qt, basis] of PAIRS) {
    const r = await q(`select count(*)::int n, sum(case when a.id is not null then 1 else 0 end)::int has
      from ${qt} b left join ${ft} a on a.stock_id=b.stock_id and a.fiscal_year=b.fiscal_year and a.result_type=b.result_type
      where b.quarter='Q4' and b.result_type=$1`, basis);
    console.log(`   ${f}: Q4 rows=${r[0].n}, with annual=${pc(r[0].has, r[0].n)}`);
    const r2 = await q(`select count(*)::int n, sum(case when a.id is not null then 1 else 0 end)::int has
      from ${qt} b left join ${ft} a on a.stock_id=b.stock_id and a.fiscal_year=b.fiscal_year and a.result_type=b.result_type
      where b.quarter='Q4' and b.result_type=$1 and b.fiscal_year in ('FY25','FY26')`, basis);
    console.log(`      FY25+FY26 only: ${pc(r2[0].has, r2[0].n)}`);
  }

  console.log("\n-- 2. FY26Q4 briefs on file --");
  const briefs = await q(`select s.symbol, b.fiscal_year, b.quarter, b.result_type
    from quarter_briefs b join stocks s on s.id=b.stock_id where b.fiscal_year='FY26' and b.quarter='Q4'`);
  for (const b of briefs) console.log(`   ${b.symbol} ${b.fiscal_year}${b.quarter} ${b.result_type}`);

  console.log("\n-- 3. DEC/SEP YEAR-END companies: do they have Q4 rows, and do dates match? --");
  const dec = await q(`select s.symbol, f.fiscal_year, f.result_type, f.report_date adate, b.report_date qdate, b.quarter
    from fundamentals f join stocks s on s.id=f.stock_id
    left join quarterly_results b on b.stock_id=f.stock_id and b.fiscal_year=f.fiscal_year and b.result_type=f.result_type and b.quarter='Q4'
    where extract(month from f.report_date) <> 3 and f.fiscal_year in ('FY24','FY25','FY26') order by s.symbol, f.fiscal_year`);
  for (const x of dec) console.log(`   ${x.symbol} ${x.fiscal_year}/${x.result_type} annual=${String(x.adate).slice(4, 15)} q4=${x.qdate ? String(x.qdate).slice(4, 15) : "(none)"}`);

  console.log("\n-- 4. SAMPLE CANDIDATES --");
  console.log("  a) negative net worth, FY26 preferred basis:");
  let r = await q(`select s.symbol, f.fiscal_year, f.net_worth::float nw from fundamentals f join stocks s on s.id=f.stock_id
    where f.net_worth<0 and f.result_type='consolidated' and f.fiscal_year='FY26'`);
  for (const x of r) console.log(`     ${x.symbol} ${x.fiscal_year} nw=${x.nw}`);

  console.log("  b) weak-column absences on FY26 consolidated (noncurrent_assets_held_for_sale + other_noncurrent_liabilities both null):");
  r = await q(`select s.symbol from fundamentals f join stocks s on s.id=f.stock_id
    where f.result_type='consolidated' and f.fiscal_year='FY26' and f.noncurrent_assets_held_for_sale is null and f.other_noncurrent_liabilities is null limit 12`);
  console.log("     " + r.map((x) => x.symbol).join(", "));

  console.log("  c) NBFC stocks with FY26 annual + FY26Q4 quarterly:");
  r = await q(`select s.symbol from nbfc_fundamentals f join stocks s on s.id=f.stock_id
    join nbfc_quarterly_results b on b.stock_id=f.stock_id and b.fiscal_year=f.fiscal_year and b.result_type=f.result_type and b.quarter='Q4'
    where f.result_type='consolidated' and f.fiscal_year='FY26' order by s.symbol`);
  console.log("     " + r.map((x) => x.symbol).join(", "));

  console.log("  d) banking / life / gi stocks with FY26 annual + Q4:");
  for (const [f, ft, qt, basis] of PAIRS.slice(1)) {
    r = await q(`select s.symbol from ${ft} a join stocks s on s.id=a.stock_id
      join ${qt} b on b.stock_id=a.stock_id and b.fiscal_year=a.fiscal_year and b.result_type=a.result_type and b.quarter='Q4'
      where a.result_type=$1 and a.fiscal_year='FY26' order by s.symbol`, basis);
    console.log(`     ${f}: ` + r.map((x) => x.symbol).join(", "));
  }
}
main().then(() => prisma.$disconnect());
