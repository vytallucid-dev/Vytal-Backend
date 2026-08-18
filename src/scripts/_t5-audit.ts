// ═══════════════════════════════════════════════════════════════
// T5.4 — THE COMPLETENESS AUDIT. READ-ONLY.
//   npx tsx src/scripts/_t5-audit.ts
// a) per stock / period / basis presence grid
// b) per-column fill rate by period
// c) every remaining null classified: genuine (known boundary) or UNEXPLAINED
// d) continuity gaps that would break consecutiveTail or an L3 window
// e) per-stock verdict
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { COHORT } from "./_t4-cohort-def.js";

const CUT = process.env.T4_CUT ?? "2026-08-16 09:30:03";
const BS_BOUNDARY = "2022-11-25", CF_BOUNDARY = "2021-11-24";
// scorer-read columns (metrics/load.ts)
const A_PNL = ["revenue", "other_income", "finance_costs", "depreciation", "profit_before_tax", "net_profit", "face_value_share"];
const A_BS = ["equity_share_capital", "other_equity", "total_equity", "borrowings_current", "borrowings_noncurrent",
  "current_liabilities", "trade_receivables_current", "trade_receivables_noncurrent",
  "property_plant_and_equipment", "capital_work_in_progress", "total_assets"];
const A_CF = ["cash_from_operating", "capex", "cash_from_financing"];
const Q_COLS = ["revenue", "other_income", "interest", "depreciation", "profit_before_tax", "net_profit", "operating_profit"];

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const QORD = ["Q1", "Q2", "Q3", "Q4"];

async function main() {
  const syms = COHORT.map((c) => c.symbol);

  // ── T5.4a — presence grid ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T5.4a — PRESENCE GRID (S=standalone only · C=consolidated only · B=both)   ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const fyList = ["FY18", "FY19", "FY20", "FY21", "FY22", "FY23", "FY24"];
  const annual = await raw<any>(
    `SELECT st."symbol" s, t."fiscal_year" fy, t."result_type" rt FROM (
        SELECT "stock_id","fiscal_year","result_type" FROM fundamentals
        UNION ALL SELECT "stock_id","fiscal_year","result_type" FROM banking_fundamentals) t
      JOIN stocks st ON st."id"=t."stock_id" WHERE st."symbol" = ANY($1::text[])`, syms);
  const aMap = new Map<string, Set<string>>();
  for (const r of annual) {
    const k = `${r.s}|${r.fy}`; if (!aMap.has(k)) aMap.set(k, new Set()); aMap.get(k)!.add(r.rt);
  }
  const mark = (s?: Set<string>) => !s ? " ." : s.has("standalone") && s.has("consolidated") ? " B" : s.has("standalone") ? " S" : " C";
  console.log(`  ANNUAL — ${fyList.join("  ")}`);
  for (const c of COHORT) {
    console.log(`  ${pad(c.symbol, 13)}${fyList.map((fy) => pad(mark(aMap.get(`${c.symbol}|${fy}`)), 6)).join("")}`);
  }

  const quarterly = await raw<any>(
    `SELECT st."symbol" s, t."fiscal_year" fy, t."quarter" q, t."result_type" rt FROM (
        SELECT "stock_id","fiscal_year","quarter","result_type" FROM quarterly_results
        UNION ALL SELECT "stock_id","fiscal_year","quarter","result_type" FROM banking_quarterly_results) t
      JOIN stocks st ON st."id"=t."stock_id" WHERE st."symbol" = ANY($1::text[])`, syms);
  const qMap = new Map<string, Set<string>>();
  for (const r of quarterly) {
    const k = `${r.s}|${r.fy}${r.q}`; if (!qMap.has(k)) qMap.set(k, new Set()); qMap.get(k)!.add(r.rt);
  }
  const qCols: string[] = [];
  for (const fy of ["FY19", "FY20", "FY21", "FY22", "FY23", "FY24", "FY25"]) for (const q of QORD) qCols.push(`${fy}${q}`);
  console.log(`\n  QUARTERLY — ${qCols.map((c) => c.replace("FY", "")).join("")}  (each cell 1 char)`);
  console.log(`  ${pad("", 13)}${["FY19", "FY20", "FY21", "FY22", "FY23", "FY24", "FY25"].map((f) => pad(f, 4)).join("")}`);
  for (const c of COHORT) {
    const cells = qCols.map((k) => mark(qMap.get(`${c.symbol}|${k}`)).trim() || ".");
    console.log(`  ${pad(c.symbol, 13)}${cells.join("")}`);
  }

  // ── T5.4b/c — fill rate + null classification ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T5.4b/c — FILL RATE BY FISCAL YEAR + NULL CLASSIFICATION                   ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const allA = [...A_PNL, ...A_BS, ...A_CF];
  const sel = allA.map((c) => `count("${c}")::int AS "${c}"`).join(", ");
  const fill = await raw<any>(
    `SELECT "fiscal_year" fy, count(*)::int n,
            count(*) FILTER (WHERE "filing_date" > TIMESTAMP '${BS_BOUNDARY}')::int post_bs,
            count(*) FILTER (WHERE "filing_date" > TIMESTAMP '${CF_BOUNDARY}')::int post_cf, ${sel}
       FROM fundamentals WHERE "stock_id" IN (SELECT "id" FROM stocks WHERE "symbol" = ANY($1::text[]))
      GROUP BY 1 ORDER BY 1`, syms);
  console.log(`  ANNUAL fill % (rows / post-BS-boundary / post-CF-boundary shown first)`);
  console.log(`    ${pad("field", 32)}${fill.map((r: any) => lp(r.fy, 7)).join("")}`);
  console.log(`    ${pad("rows", 32)}${fill.map((r: any) => lp(r.n, 7)).join("")}`);
  console.log(`    ${pad("of which broadcast > BS bound", 32)}${fill.map((r: any) => lp(r.post_bs, 7)).join("")}`);
  console.log(`    ${pad("of which broadcast > CF bound", 32)}${fill.map((r: any) => lp(r.post_cf, 7)).join("")}`);
  const unexplained: string[] = [];
  for (const col of allA) {
    const grp = A_BS.includes(col) ? "BS" : A_CF.includes(col) ? "CF" : "PNL";
    const cells = fill.map((r: any) => {
      const pct = Math.round((100 * Number(r[col])) / Number(r.n));
      // eligible denominator: PNL always; BS/CF only rows past their boundary
      const elig = grp === "BS" ? Number(r.post_bs) : grp === "CF" ? Number(r.post_cf) : Number(r.n);
      const missed = elig - Number(r[col]);
      if (missed > 0) unexplained.push(`${col} ${r.fy}: ${missed} of ${elig} eligible rows null`);
      return lp(pct + "%", 7);
    });
    console.log(`    ${pad(col + " [" + grp + "]", 32)}${cells.join("")}`);
  }
  console.log(`\n  ⚠ UNEXPLAINED nulls (null on a row that IS past the relevant boundary):`);
  if (!unexplained.length) console.log(`    ✓ none — every remaining null is on a row before its boundary`);
  for (const u of unexplained.slice(0, 40)) console.log(`    · ${u}`);
  if (unexplained.length > 40) console.log(`    … ${unexplained.length - 40} more`);

  const qsel = Q_COLS.map((c) => `count("${c}")::int AS "${c}"`).join(", ");
  const qfill = await raw<any>(
    `SELECT "fiscal_year" fy, count(*)::int n, ${qsel} FROM quarterly_results
      WHERE "stock_id" IN (SELECT "id" FROM stocks WHERE "symbol" = ANY($1::text[])) GROUP BY 1 ORDER BY 1`, syms);
  console.log(`\n  QUARTERLY fill %`);
  console.log(`    ${pad("field", 32)}${qfill.map((r: any) => lp(r.fy, 7)).join("")}`);
  console.log(`    ${pad("rows", 32)}${qfill.map((r: any) => lp(r.n, 7)).join("")}`);
  for (const col of Q_COLS) {
    console.log(`    ${pad(col, 32)}${qfill.map((r: any) => lp(Math.round((100 * Number(r[col])) / Number(r.n)) + "%", 7)).join("")}`);
  }

  // ── T5.4d — continuity ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T5.4d — CONTINUITY GAPS in the STANDALONE series (what scoring reads)      ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const ord = (fy: string, q: string) => (parseInt(fy.slice(2)) * 4) + QORD.indexOf(q);
  const qsa = await raw<any>(
    `SELECT st."symbol" s, t."fiscal_year" fy, t."quarter" q FROM (
        SELECT "stock_id","fiscal_year","quarter" FROM quarterly_results WHERE "result_type"='standalone'
        UNION ALL SELECT "stock_id","fiscal_year","quarter" FROM banking_quarterly_results WHERE "result_type"='standalone') t
      JOIN stocks st ON st."id"=t."stock_id" WHERE st."symbol" = ANY($1::text[])`, syms);
  const bySym = new Map<string, number[]>();
  for (const r of qsa) { if (!bySym.has(r.s)) bySym.set(r.s, []); bySym.get(r.s)!.push(ord(r.fy, r.q)); }
  const gapReport: Record<string, string[]> = {};
  for (const [s, arr] of bySym) {
    const u = [...new Set(arr)].sort((a, b) => a - b);
    const gaps: string[] = [];
    for (let i = 1; i < u.length; i++) if (u[i] - u[i - 1] > 1) {
      const miss = [];
      for (let k = u[i - 1] + 1; k < u[i]; k++) miss.push(`FY${Math.floor(k / 4)}${QORD[k % 4]}`);
      gaps.push(miss.join(","));
    }
    gapReport[s] = gaps;
    const tail = u.length ? u[u.length - 1] - (gaps.length ? u.findIndex((x, i) => i > 0 && u[i] - u[i - 1] > 1) : 0) : 0;
    void tail;
  }
  for (const c of COHORT) {
    const g = gapReport[c.symbol] ?? [];
    const n = (bySym.get(c.symbol) ?? []).length;
    console.log(`  ${pad(c.symbol, 13)} standalone quarters=${lp(n, 3)}  ${g.length === 0 ? "✓ contiguous" : "⚠ gap(s): " + g.join(" | ")}`);
  }

  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
