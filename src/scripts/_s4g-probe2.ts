import "dotenv/config";
import { prisma } from "../db/prisma.js";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

const QC = ["interest_earned","interest_expended","other_income","operating_expenses","ppop","net_profit",
  "gnpa_absolute","nnpa_absolute","gnpa_pct","nnpa_pct","cet1_ratio","additional_tier1_ratio","roa_quarterly"];
const AC = ["interest_earned","interest_expended","other_income","operating_expenses","ppop","profit_before_tax","net_profit",
  "advances","investments","cash_and_balances_with_rbi","balances_with_banks","total_assets","deposits",
  "gnpa_absolute","nnpa_absolute","gnpa_pct","nnpa_pct","cet1_ratio","additional_tier1_ratio","tier1_ratio","roa_disclosed"];

// The legacy/v3 seam: legacy ceiling 2024-12-31, v3 floor 2025-03-31 (_r1-cohort-def.ts).
async function profile(table: string, cols: string[], label: string) {
  const sel = cols.map((c) => `count(*) FILTER (WHERE t."${c}" IS NULL AND t."report_date" <= DATE '2024-12-31')::int "${c}_leg",
    count(*) FILTER (WHERE t."${c}" IS NULL AND t."report_date" >= DATE '2025-03-31')::int "${c}_v3"`).join(",");
  const [r] = await raw(`
    SELECT count(*) FILTER (WHERE t."report_date" <= DATE '2024-12-31')::int n_leg,
           count(*) FILTER (WHERE t."report_date" >= DATE '2025-03-31')::int n_v3, ${sel}
      FROM ${table} t JOIN stocks s ON s."id"=t."stock_id"
     WHERE t."result_type"='standalone' AND s."is_active"=true`);
  console.log(`\n── ${label} · standalone · NULLs: LEGACY era (≤2024-12-31) vs V3 era (≥2025-03-31) ──`);
  console.log(`  rows: legacy ${r.n_leg} · v3 ${r.n_v3}`);
  console.log(`  ${"field".padEnd(30)}${"null legacy".padStart(13)}${"null v3".padStart(10)}   reading`);
  for (const c of cols) {
    const l = r[`${c}_leg`], v = r[`${c}_v3`];
    const reading = l === r.n_leg && v === 0 ? "★ ERA GAP — legacy never carried it, v3 always does"
      : l === r.n_leg && v === r.n_v3 ? "STANDING gap — null in BOTH eras"
      : l === 0 && v === 0 ? "clean" : "partial";
    console.log(`  ${c.padEnd(30)}${String(l).padStart(13)}${String(v).padStart(10)}   ${reading}`);
  }
}

async function main() {
  await profile("banking_quarterly_results", QC, "banking_quarterly_results");
  await profile("banking_fundamentals", AC, "banking_fundamentals");

  // Where does the legacy→v3 flip actually happen, quarter by quarter?
  console.log(`\n── banking_quarterly_results · gnpa_pct + interest_expended fill rate by report_date ──`);
  const t = await raw(`
    SELECT t."report_date"::text rd, count(*)::int n,
      count(t."interest_expended")::int ie, count(t."gnpa_pct")::int gp, count(t."operating_expenses")::int oe
      FROM banking_quarterly_results t JOIN stocks s ON s."id"=t."stock_id"
     WHERE t."result_type"='standalone' AND s."is_active"=true
     GROUP BY 1 ORDER BY 1`);
  console.log(`  ${"report_date".padEnd(14)}${"rows".padStart(6)}${"int_exp".padStart(9)}${"gnpa_pct".padStart(10)}${"op_exp".padStart(8)}`);
  for (const r of t) console.log(`  ${String(r.rd).slice(0,10).padEnd(14)}${String(r.n).padStart(6)}${String(r.ie).padStart(9)}${String(r.gp).padStart(10)}${String(r.oe).padStart(8)}`);

  console.log(`\n── banking_fundamentals · advances fill rate by fiscal_year ──`);
  const a = await raw(`
    SELECT t."fiscal_year" fy, count(*)::int n, count(t."advances")::int adv, count(t."investments")::int inv,
      count(t."cash_and_balances_with_rbi")::int cash, count(t."balances_with_banks")::int bal, count(t."gnpa_pct")::int gp
      FROM banking_fundamentals t JOIN stocks s ON s."id"=t."stock_id"
     WHERE t."result_type"='standalone' AND s."is_active"=true GROUP BY 1 ORDER BY 1`);
  console.log(`  ${"FY".padEnd(8)}${"rows".padStart(6)}${"advances".padStart(10)}${"invest".padStart(8)}${"cashRBI".padStart(9)}${"balBanks".padStart(10)}${"gnpa_pct".padStart(10)}`);
  for (const r of a) console.log(`  ${String(r.fy).padEnd(8)}${String(r.n).padStart(6)}${String(r.adv).padStart(10)}${String(r.inv).padStart(8)}${String(r.cash).padStart(9)}${String(r.bal).padStart(10)}${String(r.gp).padStart(10)}`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
