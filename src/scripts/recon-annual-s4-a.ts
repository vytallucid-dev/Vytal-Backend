// Stage 4 recon A — shape of the five *_fundamentals tables.
import { prisma } from "../db/prisma.js";

async function main() {
  const tables = [
    ["non_financial", "fundamentals"],
    ["banking", "banking_fundamentals"],
    ["nbfc", "nbfc_fundamentals"],
    ["life_insurance", "life_insurance_fundamentals"],
    ["general_insurance", "general_insurance_fundamentals"],
  ] as const;

  for (const [family, t] of tables) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select fiscal_year, result_type, count(*)::int as n from ${t} group by 1,2 order by 1,2`,
    );
    console.log(`\n=== ${family} (${t}) ===`);
    console.log(rows.map((r) => `${r.fiscal_year} ${r.result_type}: ${r.n}`).join(" | "));
    const tot = await prisma.$queryRawUnsafe<any[]>(`select count(*)::int as n, count(distinct stock_id)::int as s from ${t}`);
    console.log(`total rows ${tot[0].n}, distinct stocks ${tot[0].s}`);
  }

  // Q4 quarterly row counts, for the 2058 figure
  const q4 = await prisma.$queryRawUnsafe<any[]>(`
    select 'non_financial' f, count(*)::int n from quarterly_results where quarter='Q4'
    union all select 'banking', count(*)::int from banking_quarterly_results where quarter='Q4'
    union all select 'nbfc', count(*)::int from nbfc_quarterly_results where quarter='Q4'
    union all select 'life_insurance', count(*)::int from life_insurance_quarterly_results where quarter='Q4'
    union all select 'general_insurance', count(*)::int from general_insurance_quarterly_results where quarter='Q4'
  `);
  console.log("\n=== Q4 quarterly rows ===");
  console.log(q4.map((r) => `${r.f}: ${r.n}`).join(" | "));

  // Existing briefs
  const briefs = await prisma.$queryRawUnsafe<any[]>(
    `select fiscal_year, quarter, status, count(*)::int n from quarter_briefs group by 1,2,3 order by 1,2,3`,
  );
  console.log("\n=== quarter_briefs ===");
  console.log(briefs.map((r) => `${r.fiscal_year}${r.quarter} ${r.status}: ${r.n}`).join(" | ") || "(none)");
}

main().then(() => prisma.$disconnect());
