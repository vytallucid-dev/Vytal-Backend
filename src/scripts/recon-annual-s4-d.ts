// Stage 4 recon D — the edge cases: dates, negatives, degenerates.
import { prisma } from "../db/prisma.js";

const q = <T = any>(sql: string, ...a: any[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a);

async function main() {
  console.log("── 1. NEGATIVE NET WORTH (all families, all years, all bases) ──");
  for (const [f, t] of [["non_financial","fundamentals"],["banking","banking_fundamentals"],["nbfc","nbfc_fundamentals"],["life_insurance","life_insurance_fundamentals"],["general_insurance","general_insurance_fundamentals"]] as const) {
    const r = await q(`select s.symbol, f.fiscal_year, f.result_type, f.net_worth::float nw, f.total_assets::float ta
                       from ${t} f join stocks s on s.id=f.stock_id where f.net_worth < 0 order by f.net_worth`);
    if (r.length) console.log(`  ${f}: ` + r.map((x)=>`${x.symbol} ${x.fiscal_year}/${x.result_type} nw=${x.nw} ta=${x.ta}`).join(" | "));
  }

  console.log("\n── 2. ANNUAL report_date vs Q4 quarterly report_date (same stock/fy/basis) ──");
  for (const [f, ft, qt] of [["non_financial","fundamentals","quarterly_results"],["banking","banking_fundamentals","banking_quarterly_results"],["nbfc","nbfc_fundamentals","nbfc_quarterly_results"],["life_insurance","life_insurance_fundamentals","life_insurance_quarterly_results"],["general_insurance","general_insurance_fundamentals","general_insurance_quarterly_results"]] as const) {
    const r = await q(`select count(*)::int n, sum(case when a.report_date = b.report_date then 1 else 0 end)::int same
                       from ${ft} a join ${qt} b on b.stock_id=a.stock_id and b.fiscal_year=a.fiscal_year and b.result_type=a.result_type and b.quarter='Q4'`);
    const d = await q(`select s.symbol, a.fiscal_year, a.result_type, a.report_date, b.report_date q4date
                       from ${ft} a join ${qt} b on b.stock_id=a.stock_id and b.fiscal_year=a.fiscal_year and b.result_type=a.result_type and b.quarter='Q4'
                       join stocks s on s.id=a.stock_id where a.report_date <> b.report_date order by s.symbol limit 20`);
    console.log(`  ${f}: paired=${r[0].n} same=${r[0].same} differ=${r[0].n-r[0].same}`);
    for (const x of d) console.log(`      ${x.symbol} ${x.fiscal_year}/${x.result_type} annual=${String(x.report_date).slice(0,15)} q4=${String(x.q4date).slice(0,15)}`);
  }

  console.log("\n── 3. NON-MARCH YEAR ENDS ──");
  for (const [f, t] of [["non_financial","fundamentals"],["banking","banking_fundamentals"],["nbfc","nbfc_fundamentals"],["life_insurance","life_insurance_fundamentals"],["general_insurance","general_insurance_fundamentals"]] as const) {
    const r = await q(`select extract(month from report_date)::int m, count(*)::int n from ${t} group by 1 order by 1`);
    console.log(`  ${f}: ` + r.map((x)=>`m${x.m}=${x.n}`).join(" "));
    const s = await q(`select distinct s.symbol, extract(month from f.report_date)::int m, f.fiscal_year from ${t} f join stocks s on s.id=f.stock_id where extract(month from f.report_date) <> 3 order by 1 limit 25`);
    for (const x of s) console.log(`      ${x.symbol} ${x.fiscal_year} month=${x.m}`);
  }

  console.log("\n── 4. LATE ANNUAL: annual.filing_date − Q4quarterly.filing_date (days) ──");
  for (const [f, ft, qt] of [["non_financial","fundamentals","quarterly_results"],["banking","banking_fundamentals","banking_quarterly_results"],["nbfc","nbfc_fundamentals","nbfc_quarterly_results"],["life_insurance","life_insurance_fundamentals","life_insurance_quarterly_results"],["general_insurance","general_insurance_fundamentals","general_insurance_quarterly_results"]] as const) {
    const r = await q(`select count(*)::int n,
        percentile_cont(0.5) within group (order by extract(epoch from (a.filing_date - b.filing_date))/86400)::float med,
        max(extract(epoch from (a.filing_date - b.filing_date))/86400)::float mx,
        sum(case when a.filing_date > b.filing_date then 1 else 0 end)::int later
      from ${ft} a join ${qt} b on b.stock_id=a.stock_id and b.fiscal_year=a.fiscal_year and b.result_type=a.result_type and b.quarter='Q4'`);
    console.log(`  ${f}: paired=${r[0].n} median_gap=${r[0].med} max_gap=${r[0].mx} annual_later=${r[0].later}`);
  }
  const late = await q(`select s.symbol, a.fiscal_year, (extract(epoch from (a.filing_date - b.filing_date))/86400)::int gap
     from nbfc_fundamentals a join nbfc_quarterly_results b on b.stock_id=a.stock_id and b.fiscal_year=a.fiscal_year and b.result_type=a.result_type and b.quarter='Q4'
     join stocks s on s.id=a.stock_id where a.filing_date > b.filing_date order by gap desc limit 30`);
  console.log("  NBFC late-annual stocks: " + late.map((x)=>`${x.symbol} ${x.fiscal_year} +${x.gap}d`).join(" | "));

  console.log("\n── 5. PRIOR-YEAR AVAILABILITY for a YoY on the annual (FY26 rows with an FY25 row) ──");
  for (const [f, t, basis] of [["non_financial","fundamentals","consolidated"],["banking","banking_fundamentals","standalone"],["nbfc","nbfc_fundamentals","consolidated"],["life_insurance","life_insurance_fundamentals","standalone"],["general_insurance","general_insurance_fundamentals","standalone"]] as const) {
    const r = await q(`select count(*)::int n, sum(case when p.id is not null then 1 else 0 end)::int withprior
      from ${t} c left join ${t} p on p.stock_id=c.stock_id and p.result_type=c.result_type and p.fiscal_year='FY25'
      where c.fiscal_year='FY26' and c.result_type=$1`, basis);
    console.log(`  ${f}: FY26 rows=${r[0].n} with FY25 prior=${r[0].withprior}`);
  }
}
main().then(() => prisma.$disconnect());
