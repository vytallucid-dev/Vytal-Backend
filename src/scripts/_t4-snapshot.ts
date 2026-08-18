// ═══════════════════════════════════════════════════════════════
// T4b / T4e — COHORT SNAPSHOT. READ-ONLY.
//   npx tsx src/scripts/_t4-snapshot.ts before|after
// Captures, per cohort stock:
//   · rows per (fiscal_year, basis) for annual and quarterly
//   · every v3-era row (period >= 2025-03-31) with source + updated_at  → T4d.1
//   · per-field NULL counts by fiscal year for every column the scorer reads
//   · full row VALUES for existing consolidated rows                    → T4d.3
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { COHORT } from "./_t4-cohort-def.js";

const label = process.argv[2];
if (label !== "before" && label !== "after") { console.error("usage: _t4-snapshot.ts before|after"); process.exit(1); }
const OUT = `${process.env.T4_DIR ?? "."}/_t4-${label}.json`;

// EXACTLY the columns metrics/load.ts reads (loadFoundationStandalone / loadMomentumStandalone).
const ANNUAL_COLS = [
  "revenue","other_income","finance_costs","depreciation","profit_before_tax","net_profit",
  "equity_share_capital","other_equity","total_equity","borrowings_current","borrowings_noncurrent",
  "total_debt","total_assets","current_liabilities","trade_receivables_current","trade_receivables_noncurrent",
  "property_plant_and_equipment","capital_work_in_progress","cash_from_operating","capex","cash_from_financing",
  "face_value_share","roce","roe","debt_to_equity","interest_coverage","receivables_days","asset_turnover",
  "net_worth","operating_margin","ebitda",
];
const QUARTERLY_COLS = [
  "revenue","other_income","interest","depreciation","profit_before_tax","net_profit","operating_profit",
];
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const q = (c: string) => `"${c}"`;

async function existingCols(table: string, wanted: string[]): Promise<string[]> {
  const have = new Set((await raw<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, table))
    .map((r) => r.column_name));
  const missing = wanted.filter((c) => !have.has(c));
  if (missing.length) console.log(`  ⚠ ${table}: these scorer columns do not exist → ${missing.join(", ")}`);
  return wanted.filter((c) => have.has(c));
}

async function main() {
  const symbols = COHORT.map((c) => c.symbol);
  const aCols = await existingCols("fundamentals", ANNUAL_COLS);
  const qCols = await existingCols("quarterly_results", QUARTERLY_COLS);

  const stocks = await raw<{ id: string; symbol: string; industryType: string }>(
    `SELECT "id","symbol","industryType" FROM stocks WHERE "symbol" = ANY($1::text[])`, symbols);
  const snap: Record<string, unknown> = { label, capturedAt: new Date().toISOString(), cohort: symbols, stocks: {} };

  for (const st of stocks) {
    const per: Record<string, unknown> = { industryType: st.industryType };

    for (const [table, cols, periodCols] of [
      ["fundamentals", aCols, [`"fiscal_year"`]],
      ["quarterly_results", qCols, [`"fiscal_year"`, `"quarter"`]],
      ["banking_fundamentals", [], [`"fiscal_year"`]],
      ["banking_quarterly_results", [], [`"fiscal_year"`, `"quarter"`]],
    ] as [string, string[], string[]][]) {
      // rows per (period, basis)
      const rows = await raw(
        `SELECT ${periodCols.join(", ")}, "result_type", "source", "report_date"::text AS report_date,
                "updated_at"::text AS updated_at, "id"
           FROM ${q(table)} WHERE "stock_id" = $1
          ORDER BY "report_date", "result_type"`, st.id);
      // per-field null counts by fiscal year (scorer columns only)
      let nulls: unknown[] = [];
      if (cols.length) {
        const sel = cols.map((c) => `count(*) FILTER (WHERE ${q(c)} IS NULL)::int AS ${q("n_" + c)}`).join(", ");
        nulls = await raw(
          `SELECT "fiscal_year", "result_type", count(*)::int AS rows, ${sel}
             FROM ${q(table)} WHERE "stock_id" = $1 GROUP BY 1,2 ORDER BY 1,2`, st.id);
      }
      // full VALUES of every row, so T4d.3 can prove consolidated values did not move
      let values: unknown[] = [];
      if (cols.length) {
        values = await raw(
          `SELECT ${periodCols.join(", ")}, "result_type", ${cols.map(q).join(", ")}
             FROM ${q(table)} WHERE "stock_id" = $1 ORDER BY "report_date", "result_type"`, st.id);
      }
      per[table] = { rows, nulls, values };
    }
    (snap.stocks as Record<string, unknown>)[st.symbol] = per;
  }

  writeFileSync(OUT, JSON.stringify(snap, (_k, v) => (typeof v === "bigint" ? String(v) : v), 2));

  // ── console summary ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4b — ${label.toUpperCase()} SNAPSHOT · ${stocks.length} stocks · ${new Date().toISOString()}      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  scorer columns tracked: annual ${aCols.length}, quarterly ${qCols.length}`);
  let annualRows = 0, qRows = 0, v3Rows = 0;
  const pad = (s: unknown, n: number) => String(s).padEnd(n);
  const lp = (s: unknown, n: number) => String(s).padStart(n);
  console.log(`  ${pad("symbol", 14)}${pad("ind", 15)}${lp("ann SA", 7)}${lp("ann CO", 7)}${lp("qtr SA", 7)}${lp("qtr CO", 7)}${lp("v3 rows", 9)}  oldest annual / oldest qtr`);
  for (const st of stocks) {
    const p = (snap.stocks as any)[st.symbol];
    const all = [...(p.fundamentals.rows as any[]), ...(p.quarterly_results.rows as any[]),
                 ...(p.banking_fundamentals.rows as any[]), ...(p.banking_quarterly_results.rows as any[])];
    const aSA = (p.fundamentals.rows as any[]).filter((r) => r.result_type === "standalone").length
              + (p.banking_fundamentals.rows as any[]).filter((r) => r.result_type === "standalone").length;
    const aCO = (p.fundamentals.rows as any[]).filter((r) => r.result_type === "consolidated").length
              + (p.banking_fundamentals.rows as any[]).filter((r) => r.result_type === "consolidated").length;
    const qSA = (p.quarterly_results.rows as any[]).filter((r) => r.result_type === "standalone").length
              + (p.banking_quarterly_results.rows as any[]).filter((r) => r.result_type === "standalone").length;
    const qCO = (p.quarterly_results.rows as any[]).filter((r) => r.result_type === "consolidated").length
              + (p.banking_quarterly_results.rows as any[]).filter((r) => r.result_type === "consolidated").length;
    const v3 = all.filter((r) => r.report_date >= "2025-03-31").length;
    annualRows += aSA + aCO; qRows += qSA + qCO; v3Rows += v3;
    const annuals = [...(p.fundamentals.rows as any[]), ...(p.banking_fundamentals.rows as any[])].map((r) => r.report_date).sort();
    const qtrs = [...(p.quarterly_results.rows as any[]), ...(p.banking_quarterly_results.rows as any[])].map((r) => r.report_date).sort();
    console.log(`  ${pad(st.symbol, 14)}${pad(st.industryType, 15)}${lp(aSA, 7)}${lp(aCO, 7)}${lp(qSA, 7)}${lp(qCO, 7)}${lp(v3, 9)}  ${(annuals[0] ?? "—").slice(0, 10)} / ${(qtrs[0] ?? "—").slice(0, 10)}`);
  }
  console.log(`  ── totals: annual ${annualRows} rows · quarterly ${qRows} rows · v3-era (period >= 2025-03-31) ${v3Rows} rows`);
  console.log(`\n  → ${OUT}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
