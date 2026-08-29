// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 13 — GIVE THE 2026-08-26 WORKBOOK CELLS A PROVENANCE MARKER.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage13-mark-workbook-provenance.ts            # dry
//   npx tsx src/scripts/stage13-mark-workbook-provenance.ts --commit
//
// ── WHY THIS RUNS BEFORE THE FENCE, NOT AFTER ────────────────────────────────────────────────────
// The overwrite fence protects a cell when `source='manual_workbook'` OR a raw_field_edits row
// exists for it. MEASURED before building it: that predicate is FALSE for every cell it most needs
// to protect.
//
//   · stage8-workbook-load.ts wrote NO audit rows at all — 202 inserted rows are findable only by
//     the `source` convention, and the 74 shareholding rows not even by that (the table has no
//     source column).
//   · Worse, the 48 FILL cells went into pre-existing rows, which keep their pipeline `source`
//     (nse_xbrl_*, bse_xbrl). They are hand data wearing a pipeline badge. Today they can still be
//     recovered from `updated_at`; after the next run touches those rows for any other reason they
//     are unrecoverable as hand-entered — and a fence keyed on provenance would sail straight past
//     them.
//
// A fence whose predicate is false is decoration. This makes it true first.
//
// ── THE ONE JUDGEMENT CALL, AND WHICH WAY IT LEANS ───────────────────────────────────────────────
// For a FILL cell we cannot prove from the database alone that the loader wrote it: the loader only
// wrote where the column was NULL, so "current value == workbook value" is a SUPERSET of what it
// wrote (a column that already held the same figure looks identical). We mark the superset.
//
// ⚠ Deliberate over-marking. Marking a cell the pipeline agrees with costs nothing — the pipeline
//   would have written the same number. FAILING to mark a real hand-entered cell loses it forever.
//   The asymmetry is total, so the bias is total.
//
// target_table carries the PRISMA MODEL NAME ("Fundamental"), not the physical table. That is what
// every existing row in raw_field_edits uses, and a fence joining on physical names would silently
// protect nothing — it is how the first measurement of this table came back a misleading zero.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../db/prisma.js";

const COMMIT = process.argv.includes("--commit");
const DIR = "WorkbookCompleted";
const EDITOR = "human:workbook_2026_08_26";
const CITATION = "Manual workbook WorkbookCompleted/, loaded 2026-08-26 by stage8-workbook-load.ts";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

/** physical table → Prisma model name, as raw_field_edits.target_table records it. */
const MODEL: Record<string, string> = {
  quarterly_results: "QuarterlyResult",
  fundamentals: "Fundamental",
  banking_quarterly_results: "BankingQuarterlyResult",
  banking_fundamentals: "BankingFundamental",
  nbfc_quarterly_results: "NbfcQuarterlyResult",
  nbfc_fundamentals: "NbfcFundamental",
  life_insurance_quarterly_results: "LifeInsuranceQuarterlyResult",
  life_insurance_fundamentals: "LifeInsuranceFundamental",
  general_insurance_quarterly_results: "GeneralInsuranceQuarterlyResult",
  general_insurance_fundamentals: "GeneralInsuranceFundamental",
  shareholding_patterns: "ShareholdingPattern",
};
const IDENTITY = new Set(["symbol", "isin", "company", "industry", "report_date", "as_on_date", "fiscal_year", "quarter", "result_type", "unit", "source_url", "notes"]);

function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}
function num(s: string): number | null {
  const t = (s ?? "").trim();
  if (t === "" || t === "-" || /^(na|n\/a|nil|null)$/i.test(t)) return null;
  const neg = /^\(.*\)$/.test(t);
  const cleaned = t.replace(/^\(|\)$/g, "").replace(/[,\s₹]/g, "");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  return neg ? -Number(cleaned) : Number(cleaned);
}

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 13 — mark workbook provenance  ${COMMIT ? "*** COMMIT ***" : "(dry)"}`);
  console.log("=".repeat(100));

  const already = await raw<{ n: number }>(`SELECT count(*)::int n FROM raw_field_edits WHERE edited_by=$1`, EDITOR);
  if (already[0].n) {
    console.log(`\n  ${already[0].n} row(s) already carry edited_by='${EDITOR}' — this script has run. Nothing to do.\n`);
    await prisma.$disconnect();
    return;
  }

  const stocks = new Map((await raw<{ id: string; symbol: string }>(`SELECT id, symbol FROM stocks`)).map((s) => [s.symbol.toUpperCase(), s.id]));
  const pending: Array<{ table: string; model: string; rowId: string; field: string; value: number; kind: "insert" | "fill" }> = [];
  let unmatched = 0;

  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".csv") && !f.startsWith("_")).sort()) {
    const table = file.replace(/\.csv$/, "");
    const model = MODEL[table];
    if (!model) { console.log(`  ${file}: no model mapping — skipped`); continue; }
    const isSh = table === "shareholding_patterns";
    const dateCol = isSh ? "as_on_date" : "report_date";
    const rows = parseCsv(fs.readFileSync(path.join(DIR, file), "utf8"));
    const head = rows[0].map((h) => h.trim().replace(/^★/, ""));
    const col = (n: string): number => head.indexOf(n);
    const known = new Set((await raw<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name=$1`, table)).map((c) => c.column_name));
    const dataCols = head.map((h, i) => ({ h, i })).filter((x) => x.h && !IDENTITY.has(x.h) && known.has(x.h));

    let ins = 0, fill = 0;
    for (const r of rows.slice(1)) {
      const sym = (r[col("symbol")] ?? "").trim().toUpperCase();
      const stockId = stocks.get(sym);
      const dateVal = (r[col(dateCol)] ?? "").trim();
      if (!stockId || !dateVal) continue;
      const rt = isSh ? null : ((r[col("result_type")] ?? "standalone").trim().toLowerCase() || "standalone");

      // Same lookup the corrected loader uses: BY DATE, never by label.
      const hit = await raw<{ id: string; source: string | null }>(
        isSh ? `SELECT id, NULL::text AS source FROM "${table}" WHERE stock_id=$1 AND as_on_date=$2 LIMIT 1`
             : `SELECT id, source FROM "${table}" WHERE stock_id=$1 AND report_date=$2 AND result_type=$3 LIMIT 1`,
        ...(isSh ? [stockId, new Date(`${dateVal}T00:00:00.000Z`)] : [stockId, new Date(`${dateVal}T00:00:00.000Z`), rt]));
      if (!hit.length) { unmatched++; continue; }   // a refused row — nothing was written, nothing to mark

      const wbVals: Record<string, number> = {};
      for (const c of dataCols) { const v = num(r[c.i] ?? ""); if (v !== null) wbVals[c.h] = v; }
      if (!Object.keys(wbVals).length) continue;

      // An INSERT is provable from `source`; shareholding has no source column, but every row this
      // workbook matched by as_on_date was either inserted today or already held the same figures.
      const isInsert = hit[0].source === "manual_workbook" || isSh;
      if (isInsert) {
        for (const [f, v] of Object.entries(wbVals)) pending.push({ table, model, rowId: hit[0].id, field: f, value: v, kind: "insert" });
        ins++;
      } else {
        // FILL row: mark the superset (current value equals the workbook's). See the header.
        const cur = await raw<Record<string, unknown>>(
          `SELECT ${Object.keys(wbVals).map((c) => `"${c}"`).join(",")} FROM "${table}" WHERE id=$1`, hit[0].id);
        let n = 0;
        for (const [f, v] of Object.entries(wbVals)) {
          const dbv = cur[0][f];
          if (dbv !== null && Math.abs(Number(dbv) - v) < 1e-9) { pending.push({ table, model, rowId: hit[0].id, field: f, value: v, kind: "fill" }); n++; }
        }
        if (n) fill++;
      }
    }
    console.log(`  ${file.padEnd(42)} inserted-row matches ${String(ins).padStart(3)} · pre-existing-row matches ${String(fill).padStart(3)}`);
  }

  const byKind = (k: string): number => pending.filter((p) => p.kind === k).length;
  console.log(`\n  cells to mark: ${pending.length}  (on inserted rows ${byKind("insert")} · on pre-existing rows ${byKind("fill")})`);
  console.log(`  workbook rows with no row in the database (refused at load): ${unmatched} — correctly unmarked`);

  if (!COMMIT) { console.log(`\n  dry run — re-run with --commit.\n`); await prisma.$disconnect(); return; }

  // old_value is NULL on every row BY CONSTRUCTION: the loader wrote only where the column was
  // null, and the fill-side superset is restricted to cells that already agree. That is exactly the
  // invariant verifyNoOverwrites() asserts, so this backfill is checkable by the same tool.
  let written = 0;
  for (let i = 0; i < pending.length; i += 500) {
    const chunk = pending.slice(i, i + 500);
    const vals = chunk.map((_, k) => `($${k * 8 + 1},$${k * 8 + 2},$${k * 8 + 3},$${k * 8 + 4},$${k * 8 + 5},$${k * 8 + 6},$${k * 8 + 7},$${k * 8 + 8},NULL)`).join(",");
    const args = chunk.flatMap((p) => [crypto.randomUUID(), p.model, p.rowId, p.field, String(p.value), CITATION, EDITOR,
      p.kind === "insert" ? "row inserted by the workbook load" : "null column filled by the workbook load (superset — see stage13 header)"]);
    written += await prisma.$executeRawUnsafe(
      `INSERT INTO raw_field_edits (id, target_table, target_row_id, field, new_value, citation, edited_by, note, old_value)
       VALUES ${vals}`, ...args);
  }
  console.log(`\n  wrote ${written} raw_field_edits row(s).\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
