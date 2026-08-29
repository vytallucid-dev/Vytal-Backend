// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// P5.4b — REGENERATE THE MANUAL-ENTRY WORKBOOK against what is ACTUALLY missing.
// ⚠ NOT A BUILD GATE (reads the live database through the regenerated manifest).
//
//   npx tsx src/scripts/gen-manual-entry-workbook.ts
//
// Structure is copied from v5 so the keying workflow is unchanged:
//   R1 title · R2 subtitle+counts · R3 blank · R4 headers · R5 "UNIT ->" units · R6+ data
//   null = fill this (amber) · "-" = already in the database, leave alone
//
// ── ⚠ THE ASSERTION THAT MATTERS ──────────────────────────────────────────────────────────────────
// The 5,855 cells imported in Part 1b MUST NOT REAPPEAR AS BLANK. Asking someone to key the same
// cell twice is how a workbook loses its authority. Every keyed-and-landed cell is intersected with
// the new fill set and the overlap must be empty; any overlap is NAMED, not counted.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import XLSX from "xlsx";

const OUT_DIR = process.env.WB_OUT ?? "../outputs";
const CELLS = process.env.S4G_CELLS ?? `${OUT_DIR}/_s4g-cells.json`;
const VERSION = process.env.WB_VERSION ?? "v6";
const OUT = `${OUT_DIR}/Vytal_Manual_Entry_Workbook_${VERSION}.xlsx`;

interface Cell {
  symbol: string; industry: string; table: string; basis: string;
  fiscalYear: string; quarter: string; reportDate: string;
  type: "A" | "B" | "C"; field: string; why: string; sourceHint: string;
  xbrlUrl: string; momentumCritical: boolean;
}
interface Keyed { sheet: string; symbol: string; fy: string; report_date: string; field: string; value: number; }

const ANNUAL = new Set(["fundamentals", "banking_fundamentals"]);
const RATIO = new Set(["gnpa_pct", "nnpa_pct", "cet1_ratio", "tier1_ratio", "additional_tier1_ratio", "roa_disclosed", "roa_quarterly"]);

/** Column order per sheet, taken from v5 so a keyer's muscle memory still works. */
const FIELD_ORDER: Record<string, string[]> = {
  fundamentals: [
    "revenue", "other_income", "expenses", "employee_benefit_expense", "finance_costs", "depreciation",
    "profit_before_tax", "tax", "net_profit", "face_value_share", "total_assets",
    "property_plant_and_equipment", "capital_work_in_progress",
    "trade_receivables_current", "trade_receivables_noncurrent",
    "borrowings_current", "borrowings_noncurrent", "current_liabilities",
    "equity_share_capital", "other_equity", "total_equity",
    "cash_from_operating", "cash_from_financing", "capex",
  ],
  quarterly_results: ["revenue", "other_income", "expenses", "depreciation", "interest", "profit_before_tax", "tax", "net_profit"],
  banking_fundamentals: [
    "interest_earned", "interest_expended", "other_income", "operating_expenses", "ppop",
    "profit_before_tax", "net_profit", "deposits", "advances", "investments", "total_assets",
    "cash_and_balances_with_rbi", "balances_with_banks", "gnpa_absolute", "nnpa_absolute",
    "gnpa_pct", "nnpa_pct", "cet1_ratio", "tier1_ratio", "additional_tier1_ratio", "roa_disclosed",
  ],
  banking_quarterly_results: [
    "interest_earned", "interest_expended", "other_income", "operating_expenses", "ppop",
    "profit_before_tax", "net_profit", "gnpa_absolute", "nnpa_absolute",
    "gnpa_pct", "nnpa_pct", "cet1_ratio", "additional_tier1_ratio", "roa_quarterly",
  ],
};
const PREFIX: Record<string, string> = {
  fundamentals: "FA", quarterly_results: "QR", banking_fundamentals: "BA", banking_quarterly_results: "BQ",
};
const TITLE: Record<string, string> = {
  fundamentals: "ANNUAL — non-financial  —  fundamentals",
  quarterly_results: "QUARTERLY — non-financial  —  quarterly_results",
  banking_fundamentals: "ANNUAL — banking  —  banking_fundamentals",
  banking_quarterly_results: "QUARTERLY — banking  —  banking_quarterly_results",
};
const SHEETS = ["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"] as const;

function main(): void {
  const raw = (JSON.parse(readFileSync(CELLS, "utf8")) as { cells: Cell[] }).cells;
  console.log(`\nmanifest cells: ${raw.length}`);

  // ── ★ A CELL WE HAVE ALREADY COLLECTED IS NEVER ASKED FOR AGAIN ────────────
  // MEASURED 2026-08-22: the manifest indexes ANNUAL rows by report_date; the Part-1b import keyed
  // them by fiscal_year. 23 legacy rows carry fiscal_year='FY18' with report_date='2017-03-31' —
  // the label and the date disagree by a year — so the SAME row is "held" to one view and "missing"
  // to the other. GALLANTT FY18 is the only one that had keyed cells land on it, and the manifest
  // duly re-listed all 9 as type B. They are in the database. Asking for them again would be asking
  // a person to key what we already have, which is how a workbook loses its authority.
  //
  // ⚠ THIS DROPS THE CELL, IT DOES NOT FIX THE ROW. The fiscal_year/report_date disagreement is a
  //   pre-existing defect in nse_xbrl_annual_legacy and is reported separately, not silently papered
  //   over here.
  const keyedAll = JSON.parse(readFileSync("_wb_keyed.json", "utf8")) as Keyed[];
  const deferredKeys = new Set(
    (JSON.parse(readFileSync("_keyed_deferred_721.json", "utf8")) as Array<{ table: string; symbol: string; period: string; field: string }>)
      .map((d) => `${d.table}|${d.symbol}|${d.period}|${d.field}`),
  );
  const alreadyCollected = new Set(
    keyedAll
      .map((k) => `${k.sheet}|${k.symbol}|${ANNUAL.has(k.sheet) ? k.fy : k.report_date}|${k.field}`)
      .filter((k) => !deferredKeys.has(k)),
  );
  const cells = raw.filter(
    (c) => !alreadyCollected.has(`${c.table}|${c.symbol}|${ANNUAL.has(c.table) ? c.fiscalYear : c.reportDate}|${c.field}`),
  );
  const dropped = raw.length - cells.length;
  if (dropped) {
    console.log(`  dropped ${dropped} cell(s) the workbook already collected — see the note in this file`);
    for (const c of raw.filter((x) => alreadyCollected.has(`${x.table}|${x.symbol}|${ANNUAL.has(x.table) ? x.fiscalYear : x.reportDate}|${x.field}`)))
      console.log(`      ${c.table}|${c.symbol}|${ANNUAL.has(c.table) ? c.fiscalYear : c.reportDate}|${c.field}  (manifest called it type ${c.type})`);
  }
  console.log(`  cells to key: ${cells.length}`);

  const wb = XLSX.utils.book_new();
  const summary: Record<string, { rows: number; cells: number }> = {};
  const fillSet = new Set<string>();

  // README / FIELD_GUIDE carried as plain text so the workbook still explains itself.
  const readme = [
    ["VYTAL — MANUAL DATA ENTRY WORKBOOK"],
    [`Regenerated against the live database AFTER the BSE cohort run. Version ${VERSION}.`],
    ["basis: STANDALONE ONLY. Fill ONLY the blank cells. \"-\" = already in the database, leave it alone."],
    [""],
    ["UNITS — the row marked \"UNIT ->\" under the headers is authoritative."],
    ["  Rs Cr : money, exactly as the filing states it in crores."],
    ["  %     : a percentage, keyed as a PERCENT (2.04 for 2.04%). The importer divides by 100."],
    [""],
    ["Every cell the previous workbook collected has been removed. If a cell you already keyed"],
    ["appears blank here, STOP and report it — it means an import did not land."],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readme), "README");

  for (const sheet of SHEETS) {
    const mine = cells.filter((c) => c.table === sheet);
    const fields = FIELD_ORDER[sheet];

    // group by row identity
    const byRow = new Map<string, Cell[]>();
    for (const c of mine) {
      const per = ANNUAL.has(sheet) ? c.fiscalYear : c.reportDate;
      const k = `${c.symbol}|${per}`;
      if (!byRow.has(k)) byRow.set(k, []);
      byRow.get(k)!.push(c);
    }
    const keys = [...byRow.keys()].sort();

    const header = ["ROW_ID", "symbol", "industry_type", "fiscal_year", "quarter", "report_date", "type", "momentum", "cells", "source_hint", "xbrl_url", ...fields, "UNIT ->"];
    const unitRow: (string | null)[] = ["UNIT ->", null, null, null, null, null, null, null, null, null, null,
      ...fields.map((f) => (RATIO.has(f) ? "%" : "Rs Cr")), null];

    const data: (string | number | null)[][] = [];
    let cellCount = 0;
    keys.forEach((k, i) => {
      const group = byRow.get(k)!;
      const g0 = group[0];
      const need = new Set(group.map((c) => c.field));
      const rowId = `${PREFIX[sheet]}${String(i + 1).padStart(4, "0")}`;
      const line: (string | number | null)[] = [
        rowId, g0.symbol, g0.industry, g0.fiscalYear || null, g0.quarter || null, g0.reportDate || null,
        g0.type, group.some((c) => c.momentumCritical) ? "yes" : "no", need.size, g0.sourceHint, g0.xbrlUrl || null,
      ];
      for (const f of fields) {
        if (need.has(f)) { line.push(null); cellCount++; fillSet.add(`${sheet}|${g0.symbol}|${ANNUAL.has(sheet) ? g0.fiscalYear : g0.reportDate}|${f}`); }
        else line.push("-");
      }
      line.push(need.size);
      data.push(line);
    });

    const aoa: (string | number | null)[][] = [
      [TITLE[sheet]],
      [`${keys.length} rows · ${cellCount} cells to fill · grain: ${ANNUAL.has(sheet) ? "annual" : "quarterly"} · basis: STANDALONE only.  Fill ONLY the blank cells. "-" = already in the database, leave alone.`],
      [],
      header,
      unitRow,
      ...data,
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet);
    summary[sheet] = { rows: keys.length, cells: cellCount };
    console.log(`  ${sheet.padEnd(28)} ${String(keys.length).padStart(4)} rows · ${String(cellCount).padStart(5)} cells`);
  }

  const totalCells = Object.values(summary).reduce((a, b) => a + b.cells, 0);
  const totalRows = Object.values(summary).reduce((a, b) => a + b.rows, 0);
  console.log(`  ${"TOTAL".padEnd(28)} ${String(totalRows).padStart(4)} rows · ${String(totalCells).padStart(5)} cells`);

  // ── ⚠ THE ASSERTION ─────────────────────────────────────────────────────────
  const landed = [...alreadyCollected];
  const reappeared = landed.filter((k) => fillSet.has(k));

  console.log(`\n── the assertion: cells imported in Part 1b must NOT reappear blank ──`);
  console.log(`  keyed cells that LANDED     : ${landed.length}`);
  console.log(`  of those, blank again in ${VERSION} : ${reappeared.length} ${reappeared.length === 0 ? "✅" : "❌ NAMED BELOW"}`);
  for (const r of reappeared.slice(0, 40)) console.log(`      ${r}`);
  if (reappeared.length > 40) console.log(`      … and ${reappeared.length - 40} more`);

  const deferredBack = [...deferredKeys].filter((k) => fillSet.has(k));
  console.log(`  of the 721 deferred, still to key : ${deferredBack.length} of ${deferredKeys.size}  (these SHOULD reappear — no row existed)`);

  XLSX.writeFile(wb, OUT);
  writeFileSync(`${OUT_DIR}/_wb_${VERSION}_fillset.json`, JSON.stringify([...fillSet], null, 1));
  console.log(`\n  → ${OUT}`);
  console.log(`  → ${OUT_DIR}/_wb_${VERSION}_fillset.json\n`);
  if (reappeared.length > 0) process.exit(1);
}

main();
