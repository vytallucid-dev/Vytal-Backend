// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// AUDIT — WHAT ELSE DOES THE BSE LANE NOT WRITE? Read-only. Writes nothing, changes nothing.
//
//   npx tsx src/scripts/audit-bse-column-gaps.ts
//
// `operating_profit` was found from a screenshot: one blank column on one stock's page. That is a bad
// way to find missing data, because it only ever finds what someone happened to look at. This asks
// the question the screenshot asked, but of EVERY column of EVERY table the BSE lane writes.
//
// ── THE METHOD ───────────────────────────────────────────────────────────────────────────────────
// The NSE lanes are the control. For the same table and the same column, compare how often the
// column is filled on BSE-sourced rows against how often it is filled on NSE-sourced rows. A column
// the NSE lanes populate routinely and the BSE lane essentially never populates is a GAP — the BSE
// path cannot produce a value the data evidently contains.
//
// ⚠ A LOW FILL RATE IS NOT BY ITSELF A DEFECT. Plenty of columns are legitimately sparse — a field
//   only some filers report, a ratio needing an input that is often absent. What indicts the lane is
//   the DIFFERENCE: NSE has it, BSE does not, on the same column of the same table. So both numbers
//   are printed side by side and the gap is never asserted from the BSE number alone.
//
// ⚠ AND A GAP IS NOT AUTOMATICALLY A BUG. Some are real asymmetries in the source documents. The
//   audit's job is to produce the candidate list and the evidence; each one still has to be read.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

const TABLES = [
  "quarterly_results", "fundamentals",
  "banking_quarterly_results", "banking_fundamentals",
  "nbfc_quarterly_results", "nbfc_fundamentals",
  "life_insurance_quarterly_results", "life_insurance_fundamentals",
  "general_insurance_quarterly_results", "general_insurance_fundamentals",
];

/** Identity, provenance and state — not data cells, so not evidence of anything. */
const NOT_A_DATA_CELL = new Set([
  "id", "stock_id", "symbol", "quarter", "fiscal_year", "report_date", "filing_date",
  "result_type", "xbrl_url", "source", "xbrl_taxonomy", "audit_pending",
  "created_at", "updated_at",
]);

/** NSE has it this often …*/ const NSE_HAS = 40;
/** … and BSE this rarely. */ const BSE_LACKS = 5;

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(104)}`);
  console.log(`AUDIT — every column the BSE lane writes, against the NSE lanes as the control`);
  console.log("=".repeat(104));

  const gaps: Array<{ table: string; col: string; bse: number; nse: number; nBse: number }> = [];
  const partial: Array<{ table: string; col: string; bse: number; nse: number }> = [];

  for (const t of TABLES) {
    const cols = (await raw<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`, t))
      .filter((c) => !NOT_A_DATA_CELL.has(c.column_name))
      .map((c) => c.column_name);
    if (!cols.length) continue;

    const counts = await raw<Record<string, string>>(`
      SELECT count(*) FILTER (WHERE source = 'bse_xbrl')::text AS __nbse,
             count(*) FILTER (WHERE source <> 'bse_xbrl' OR source IS NULL)::text AS __nnse,
             ${cols.map((c) => `count("${c}") FILTER (WHERE source = 'bse_xbrl')::text AS "b_${c}",
                                count("${c}") FILTER (WHERE source <> 'bse_xbrl' OR source IS NULL)::text AS "n_${c}"`).join(",\n             ")}
        FROM "${t}"`);
    const r = counts[0];
    const nBse = Number(r.__nbse), nNse = Number(r.__nnse);
    console.log(`\n  ${t}   bse rows ${nBse} · non-bse rows ${nNse}`);
    if (!nBse) { console.log(`     no BSE rows — nothing to compare`); continue; }

    const rows: Array<[string, number, number]> = cols.map((c) => [
      c,
      nBse ? (Number(r[`b_${c}`]) / nBse) * 100 : 0,
      nNse ? (Number(r[`n_${c}`]) / nNse) * 100 : 0,
    ]);
    const bad = rows.filter(([, b, n]) => n >= NSE_HAS && b < BSE_LACKS);
    const mid = rows.filter(([, b, n]) => n >= NSE_HAS && b >= BSE_LACKS && n - b >= 30);
    for (const [c, b, n] of bad) { gaps.push({ table: t, col: c, bse: b, nse: n, nBse }); console.log(`     ❌ ${c.padEnd(34)} bse ${b.toFixed(1).padStart(6)}%   nse ${n.toFixed(1).padStart(6)}%`); }
    for (const [c, b, n] of mid) { partial.push({ table: t, col: c, bse: b, nse: n }); console.log(`     ⚠  ${c.padEnd(34)} bse ${b.toFixed(1).padStart(6)}%   nse ${n.toFixed(1).padStart(6)}%   (partial)`); }
    if (!bad.length && !mid.length) console.log(`     ✅ no column the NSE lanes fill that this one does not`);
  }

  console.log(`\n${"=".repeat(104)}`);
  console.log(`  HARD GAPS (nse ≥ ${NSE_HAS}%, bse < ${BSE_LACKS}%): ${gaps.length}`);
  for (const g of gaps) console.log(`     ${g.table}.${g.col}  —  bse ${g.bse.toFixed(1)}% vs nse ${g.nse.toFixed(1)}%`);
  console.log(`  PARTIAL (bse ≥ ${BSE_LACKS}% but ≥30pp behind): ${partial.length}`);
  for (const p of partial) console.log(`     ${p.table}.${p.col}  —  bse ${p.bse.toFixed(1)}% vs nse ${p.nse.toFixed(1)}%`);
  console.log("");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
