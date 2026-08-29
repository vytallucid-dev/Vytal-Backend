// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 12 — DATA QUALITY ACROSS THE UNIVERSE. Read-only; writes nothing.
//
//   npx tsx src/scripts/stage12-data-quality.ts
//
// ── WHY THIS EXISTS BESIDE stage8-completeness ───────────────────────────────────────────────────
// Completeness answers "is the row there?". It cannot answer "is the row any good?". A period can be
// present and still be useless: every ★ column null, revenue zero, a fiscal-year label that points at
// a different year, a shareholding split that does not add to 100. Those defects read as SERVED to
// every coverage report ever written, which is exactly why they survive.
//
// Everything here is measured INSIDE each stock's demand window — max(2019-03-31, listing date)
// through the derived horizon — because a defect in a period nobody asks for is not a defect worth
// acting on, and counting it would drown the ones that matter.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { analyse } from "./stage8-completeness.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pct = (n: number, d: number): string => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

/** The columns that make a period usable. Absent these, the row is a placeholder. */
const CORE: Record<string, string[]> = {
  quarterly_results: ["revenue", "expenses", "operating_profit", "profit_before_tax", "tax", "net_profit"],
  fundamentals: ["revenue", "expenses", "profit_before_tax", "tax", "net_profit", "total_assets", "total_equity"],
  banking_quarterly_results: ["interest_earned", "interest_expended", "other_income", "total_income", "profit_before_tax", "tax", "net_profit"],
  banking_fundamentals: ["interest_earned", "interest_expended", "total_income", "profit_before_tax", "tax", "net_profit", "total_assets", "deposits", "advances"],
  nbfc_quarterly_results: ["revenue", "total_income", "finance_costs", "total_expenses", "profit_before_tax", "tax", "net_profit"],
  nbfc_fundamentals: ["revenue", "total_income", "total_expenses", "profit_before_tax", "tax", "net_profit", "total_assets", "total_equity"],
  life_insurance_quarterly_results: ["gross_premium_income", "total_commission", "total_operating_expenses", "profit_before_tax", "net_profit"],
  life_insurance_fundamentals: ["gross_premium_income", "total_commission", "total_operating_expenses", "profit_before_tax", "tax", "net_profit", "total_assets"],
  general_insurance_quarterly_results: ["gross_premiums_written", "premium_earned", "incurred_claims", "net_commission", "profit_before_tax", "tax", "net_profit"],
  general_insurance_fundamentals: ["gross_premiums_written", "premium_earned", "incurred_claims", "net_commission", "profit_before_tax", "tax", "net_profit", "total_assets"],
};
const ANNUAL = new Set(["fundamentals", "banking_fundamentals", "nbfc_fundamentals", "life_insurance_fundamentals", "general_insurance_fundamentals"]);

interface Row { table: string; rows: number; anyCore: number; allCore: number; noCore: number; zeroRev: number }

async function main(): Promise<void> {
  console.log(`\n${"═".repeat(104)}`);
  console.log(`  STAGE 12 — DATA QUALITY ACROSS THE UNIVERSE`);
  console.log("═".repeat(104));

  const { horizonQ, horizonA, horizonS, stocks } = await analyse();
  console.log(`  window   quarterly ≤ ${horizonQ} · annual ≤ ${horizonA} · shareholding ≤ ${horizonS}`);
  console.log(`  floor    max(2019-03-31, listing date), per stock\n`);

  // window as SQL: one (stock_id, floor) list, joined against each table
  const floors = stocks.map((s) => `('${s.symbol}','${s.floor}')`).join(",");
  const winQ = `JOIN stocks s ON s.id = t.stock_id JOIN (VALUES ${floors}) f(sym,flr) ON f.sym = s.symbol`;

  // ── 1. are the present rows usable? ──────────────────────────────────────────────────────────
  console.log(`  ── 1. ARE THE ROWS THAT EXIST ACTUALLY USABLE? (periods inside the window) ──`);
  console.log(`  ${"table".padEnd(38)}${"rows".padStart(8)}${"all core".padStart(9)}${"".padStart(8)}${"partial".padStart(9)}${"EMPTY".padStart(7)}${"rev=0".padStart(7)}`);
  console.log(`  ${"-".repeat(38)}${"-".repeat(8)}${"-".repeat(17)}${"-".repeat(9)}${"-".repeat(7)}${"-".repeat(7)}`);
  const out: Row[] = [];
  for (const [table, cols] of Object.entries(CORE)) {
    const horizon = ANNUAL.has(table) ? horizonA : horizonQ;
    const all = cols.map((c) => `t."${c}" IS NOT NULL`).join(" AND ");
    const any = cols.map((c) => `t."${c}" IS NOT NULL`).join(" OR ");
    const revCol = cols.includes("revenue") ? "revenue" : cols.includes("total_income") ? "total_income" : cols[0];
    const q = await raw<{ n: number; a: number; y: number; z: number }>(
      `SELECT count(*)::int n,
              count(*) FILTER (WHERE ${all})::int a,
              count(*) FILTER (WHERE ${any})::int y,
              count(*) FILTER (WHERE t."${revCol}" = 0)::int z
         FROM "${table}" t ${winQ}
        WHERE t.report_date::date >= f.flr::date AND t.report_date::date <= '${horizon}'::date`);
    const r = { table, rows: q[0].n, anyCore: q[0].y, allCore: q[0].a, noCore: q[0].n - q[0].y, zeroRev: q[0].z };
    out.push(r);
    console.log(`  ${table.padEnd(38)}${String(r.rows).padStart(8)}${String(r.allCore).padStart(9)}${pct(r.allCore, r.rows).padStart(8)}${String(r.anyCore - r.allCore).padStart(9)}${String(r.noCore).padStart(7)}${String(r.zeroRev).padStart(7)}`);
  }
  const T = out.reduce((a, b) => ({ table: "TOTAL", rows: a.rows + b.rows, anyCore: a.anyCore + b.anyCore, allCore: a.allCore + b.allCore, noCore: a.noCore + b.noCore, zeroRev: a.zeroRev + b.zeroRev }));
  console.log(`  ${"-".repeat(86)}`);
  console.log(`  ${T.table.padEnd(38)}${String(T.rows).padStart(8)}${String(T.allCore).padStart(9)}${pct(T.allCore, T.rows).padStart(8)}${String(T.anyCore - T.allCore).padStart(9)}${String(T.noCore).padStart(7)}${String(T.zeroRev).padStart(7)}`);
  console.log(`\n     "all core" = every field the scoring engine reads is present. "EMPTY" rows are the`);
  console.log(`     dangerous class: present, so every coverage report calls them served, but carrying nothing.`);

  // ── 2. structural integrity ──────────────────────────────────────────────────────────────────
  console.log(`\n  ── 2. STRUCTURAL INTEGRITY (whole table, not just the window) ──`);
  const checks: Array<[string, number, string]> = [];
  let dup = 0, lbl = 0, badFy = 0;
  for (const table of Object.keys(CORE)) {
    const key = ANNUAL.has(table) ? `stock_id, fiscal_year, result_type` : `stock_id, fiscal_year, quarter, result_type`;
    dup += (await raw<{ n: number }>(`SELECT count(*)::int n FROM (SELECT ${key} FROM "${table}" GROUP BY ${key} HAVING count(*)>1) x`))[0].n;
    badFy += (await raw<{ n: number }>(`SELECT count(*)::int n FROM "${table}" WHERE fiscal_year !~ '^FY[0-9]{2}$'`))[0].n;
    // a March-dated row whose label is not its own calendar year: for a March year-end that is simply wrong
    if (ANNUAL.has(table))
      lbl += (await raw<{ n: number }>(
        `SELECT count(*)::int n FROM "${table}" WHERE extract(month from report_date)=3
           AND fiscal_year <> 'FY'||to_char(extract(year from report_date)::int % 100,'FM00')`))[0].n;
  }
  dup += (await raw<{ n: number }>(`SELECT count(*)::int n FROM (SELECT stock_id, as_on_date FROM shareholding_patterns GROUP BY 1,2 HAVING count(*)>1) x`))[0].n;
  checks.push(["duplicate natural keys", dup, "two rows claiming one period — one of them wins arbitrarily downstream"]);
  checks.push(["fiscal_year not FYnn", badFy, "decrementFY() throws on anything else, far from where it was written"]);
  checks.push(["March-dated annual row labelled another year", lbl, "reading that FY returns a different year's figures"]);

  const shBad = await raw<{ sum100: number; shares: number; pledge: number; n: number }>(`
    SELECT count(*)::int n,
      count(*) FILTER (WHERE promoter_pct + public_pct + coalesce(employee_trust_pct,0) NOT BETWEEN 98.5 AND 101.5)::int sum100,
      count(*) FILTER (WHERE total_shares > 0 AND promoter_shares IS NOT NULL
                         AND abs(promoter_shares::numeric / total_shares * 100 - promoter_pct) > 1.0)::int shares,
      count(*) FILTER (WHERE pledged_shares > promoter_shares)::int pledge
      FROM shareholding_patterns t ${winQ.replace("report_date", "as_on_date")}
     WHERE t.as_on_date >= f.flr::date AND t.as_on_date <= '${horizonS}'::date`);
  checks.push(["shareholding not summing to ~100", shBad[0].sum100, `of ${shBad[0].n} rows in window`]);
  checks.push(["promoter_shares disagrees with promoter_pct", shBad[0].shares, "by more than 1 percentage point"]);
  checks.push(["pledged_shares exceeds promoter_shares", shBad[0].pledge, "impossible by definition"]);

  console.log(`  ${"check".padEnd(52)}${"count".padStart(8)}  note`);
  console.log(`  ${"-".repeat(52)}${"-".repeat(8)}  ${"-".repeat(40)}`);
  for (const [name, n, note] of checks)
    console.log(`  ${name.padEnd(52)}${String(n).padStart(8)}  ${n === 0 ? "clean" : note}`);

  // ── 3. provenance ────────────────────────────────────────────────────────────────────────────
  console.log(`\n  ── 3. WHERE THE DATA CAME FROM ──`);
  const src = await raw<{ source: string; n: number }>(
    `SELECT source, sum(n)::int n FROM (${Object.keys(CORE).map((t) => `SELECT source, count(*)::int n FROM "${t}" GROUP BY 1`).join(" UNION ALL ")}) x GROUP BY 1 ORDER BY 2 DESC`);
  const srcTot = src.reduce((a, b) => a + b.n, 0);
  for (const s of src) console.log(`  ${(s.source ?? "(null)").padEnd(38)}${String(s.n).padStart(7)}${pct(s.n, srcTot).padStart(8)}`);

  fs.writeFileSync("_s12-data-quality.json", JSON.stringify({ at: new Date().toISOString(), horizonQ, horizonA, horizonS, tables: out, checks, sources: src }, null, 1));
  console.log(`\n  detail -> _s12-data-quality.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
