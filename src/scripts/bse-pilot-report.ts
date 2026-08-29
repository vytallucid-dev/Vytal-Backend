// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// S6.3a POST-RUN ANALYSIS — items 1–6, in the order the brief asks for them.
//
//   npx tsx src/scripts/bse-pilot-report.ts
//
// READ-ONLY. Reads the ledger, the run report and the database. Writes nothing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import type { RatioVerdict } from "../ingestions/quaterly-results/bse/bse-ratio-gate.js";
import type { LedgerEntry } from "../ingestions/quaterly-results/bse/bse-ledger.js";

const SCRATCH =
  "C:/Users/Punctuations/AppData/Local/Temp/claude/c--Users-Punctuations-Desktop-Vytal/5f2365f2-6a2f-42f6-a2ed-4feee93f9306/scratchpad";
const LEDGER = path.join(SCRATCH, "bse-pilot-ledger.live.jsonl");
const REPORT = path.join(SCRATCH, "bse-pilot-report.live.json");

const ledger: LedgerEntry[] = fs.existsSync(LEDGER)
  ? fs.readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.trim()).flatMap((l) => {
      try { return [JSON.parse(l) as LedgerEntry]; } catch { return []; }
    })
  : [];
const report = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, "utf8")) : null;

console.log("═".repeat(100));
console.log("S6.3a PILOT — POST-RUN ANALYSIS");
console.log("═".repeat(100));

// ── 1. THE FENCE ────────────────────────────────────────────────────────────
console.log("\n【1】 THE FENCE — zero NSE rows touched");
if (!report) {
  console.log("  no run report found");
} else {
  const f = report.fence;
  console.log(`  ok=${f.ok}   violations=${f.violations.length}`);
  console.log(`  NSE rows with updated_at > run_start : ${JSON.stringify(f.touchedSinceStart)}`);
  console.log(`  NSE row counts before               : ${JSON.stringify(f.baselineTotals)}`);
  console.log(`  NSE row counts after                : ${JSON.stringify(f.afterTotals)}`);
  const beforeSum = Object.values(f.baselineTotals as Record<string, number>).reduce((a, b) => a + b, 0);
  const afterSum = Object.values(f.afterTotals as Record<string, number>).reduce((a, b) => a + b, 0);
  console.log(`  NSE totals: ${beforeSum} → ${afterSum} (delta ${afterSum - beforeSum})`);
  for (const v of f.violations.slice(0, 20)) console.log(`   ❌ ${v.table} ${v.kind} ${v.rowId} ${v.detail}`);
}

// independent re-check, straight from the database, not from the run's own report
const TABLES = ["quarterly_results", "fundamentals", "banking_quarterly_results", "banking_fundamentals"] as const;
console.log("\n  independent re-check (fresh query, not the run's own numbers):");
let bseTotal = 0;
for (const t of TABLES) {
  const r: Array<{ source: string; n: bigint }> = await prisma.$queryRawUnsafe(
    `SELECT source, count(*)::bigint AS n FROM ${t} GROUP BY source ORDER BY source`,
  );
  const line = r.map((x) => `${x.source}=${Number(x.n)}`).join("  ");
  bseTotal += r.filter((x) => x.source === "bse_xbrl").reduce((a, b) => a + Number(b.n), 0);
  console.log(`    ${t.padEnd(28)}${line}`);
}

// ── 2. PER STOCK: rows written, cells filled ────────────────────────────────
console.log("\n【2】 PER STOCK — rows written and cells filled");
const written = ledger.filter((l) => l.outcome === "written");
const bySymbol = new Map<string, LedgerEntry[]>();
for (const l of ledger) {
  const a = bySymbol.get(l.symbol);
  if (a) a.push(l); else bySymbol.set(l.symbol, [l]);
}

const CELL_COLS: Record<string, string[]> = {
  quarterly_results: ["revenue", "other_income", "expenses", "depreciation", "interest", "profit_before_tax", "tax", "net_profit"],
  fundamentals: ["revenue", "other_income", "expenses", "employee_benefit_expense", "finance_costs", "depreciation", "profit_before_tax", "tax", "net_profit", "face_value_share", "total_assets", "property_plant_and_equipment", "capital_work_in_progress", "trade_receivables_current", "trade_receivables_noncurrent", "borrowings_current", "borrowings_noncurrent", "current_liabilities", "equity_share_capital", "other_equity", "total_equity", "cash_from_operating", "cash_from_financing", "capex"],
  banking_quarterly_results: ["interest_earned", "interest_expended", "other_income", "operating_expenses", "ppop", "profit_before_tax", "tax", "net_profit", "gnpa_absolute", "nnpa_absolute", "gnpa_pct", "nnpa_pct", "cet1_ratio", "additional_tier1_ratio", "roa_quarterly"],
  banking_fundamentals: ["interest_earned", "interest_expended", "other_income", "operating_expenses", "ppop", "profit_before_tax", "tax", "net_profit", "advances", "deposits", "investments", "cash_and_balances_with_rbi", "balances_with_banks", "total_assets", "gnpa_absolute", "nnpa_absolute", "gnpa_pct", "nnpa_pct", "cet1_ratio", "additional_tier1_ratio", "tier1_ratio", "roa_disclosed"],
};

let grandRows = 0;
let grandCells = 0;
const perTable: Record<string, { rows: number; cells: number }> = {};
console.log(`  ${"symbol".padEnd(12)}${"table".padEnd(28)}${"basis".padEnd(12)}rows  cells`);
for (const t of TABLES) {
  const cols = CELL_COLS[t];
  const filled = cols.map((c) => `count(${c})::int AS "${c}"`).join(", ");
  const rows: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(
    `SELECT s.symbol, x.result_type, count(*)::int AS rows, ${filled}
     FROM ${t} x JOIN stocks s ON s.id = x.stock_id
     WHERE x.source = 'bse_xbrl' GROUP BY s.symbol, x.result_type ORDER BY s.symbol`,
  );
  for (const r of rows) {
    const cells = cols.reduce((a, c) => a + Number(r[c] ?? 0), 0);
    grandRows += Number(r.rows);
    grandCells += cells;
    perTable[t] = perTable[t] ?? { rows: 0, cells: 0 };
    perTable[t].rows += Number(r.rows);
    perTable[t].cells += cells;
    console.log(`  ${String(r.symbol).padEnd(12)}${t.padEnd(28)}${String(r.result_type).padEnd(12)}${String(r.rows).padStart(4)}  ${String(cells).padStart(5)}`);
  }
}
console.log(`  ${"—".repeat(70)}`);
for (const [t, v] of Object.entries(perTable)) console.log(`  TOTAL ${t.padEnd(34)}${String(v.rows).padStart(4)} rows  ${String(v.cells).padStart(5)} cells`);
console.log(`  GRAND TOTAL: ${grandRows} rows · ${grandCells} cells · ledger says written=${written.length} · db bse_xbrl rows=${bseTotal}`);
if (grandRows !== bseTotal) console.log(`  ⚠ MISMATCH between per-symbol sum and total bse_xbrl count`);

// ── 3. RATIO VERDICTS ───────────────────────────────────────────────────────
console.log("\n【3】 RATIO GATE — every verdict, accepted and refused");
const verdicts: Array<{ symbol: string; period: string; verdicts: RatioVerdict[] }> = report?.ratioLog ?? [];
const flat = verdicts.flatMap((v) => v.verdicts.map((x) => ({ symbol: v.symbol, period: v.period, ...x })));
const accepted = flat.filter((v) => v.accepted);
const refused = flat.filter((v) => !v.accepted);
console.log(`  ${flat.length} verdicts · ${accepted.length} ACCEPTED · ${refused.length} REFUSED`);

const byReason: Record<string, number> = {};
for (const r of refused) byReason[r.reason ?? "?"] = (byReason[r.reason ?? "?"] ?? 0) + 1;
console.log(`  refusal reasons: ${JSON.stringify(byReason)}`);
const byField: Record<string, { acc: number; ref: number }> = {};
for (const v of flat) {
  byField[v.field] = byField[v.field] ?? { acc: 0, ref: 0 };
  if (v.accepted) byField[v.field].acc++; else byField[v.field].ref++;
}
console.log(`  ${"field".padEnd(24)}accepted  refused`);
for (const [f, v] of Object.entries(byField).sort()) console.log(`  ${f.padEnd(24)}${String(v.acc).padStart(8)}${String(v.ref).padStart(9)}`);

console.log("\n  ── ACCEPTED (the gate is not refusing everything) ──");
for (const v of accepted.slice(0, 25)) {
  console.log(`   ✓ ${v.symbol.padEnd(11)}${v.period}  ${v.field.padEnd(22)}doc=${v.documentValue}  derived=${v.derivedValue?.toFixed(6)}  factor=${v.factor?.toFixed(2)}x`);
}
if (accepted.length > 25) console.log(`   … and ${accepted.length - 25} more`);

console.log("\n  ── REFUSED (tag · document value · recomputed · factor) ──");
const failed = refused.filter((r) => r.reason === "failed_cross_check");
for (const v of failed) {
  console.log(`   ✗ ${v.symbol.padEnd(11)}${v.period}  ${v.field.padEnd(22)}doc=${v.documentValue}  derived=${v.derivedValue?.toFixed(6)}  factor=${v.factor === null ? "∞ (doc says 0)" : v.factor.toFixed(1) + "x"}`);
}
console.log(`   (${failed.length} failed a cross-check; ${refused.length - failed.length} refused as structurally uncheckable or tag-absent)`);

// ── 4. PERIOD-GRAIN ASSERTION ───────────────────────────────────────────────
console.log("\n【4】 PERIOD GRAIN — where OneD/FourD had to be disambiguated");
const annualUnits = ledger.filter((l) => l.grain === "annual" && l.outcome === "written");
const marchAnnual = annualUnits.filter((l) => l.period.endsWith("-03-31"));
console.log(`  annual rows written: ${annualUnits.length}, of which March period-ends: ${marchAnnual.length}`);
console.log(`  ⚠ every one of those March documents carries BOTH OneD (Q4) and FourD (full year) with the`);
console.log(`    SAME DateOfEndOfReportingPeriod. The annual row was taken from FourD, asserted at 358–372 days.`);
for (const l of marchAnnual.slice(0, 15)) console.log(`   · ${l.symbol.padEnd(12)}${l.period}  ${l.note ?? ""}`);
const assertFailed = ledger.filter((l) => l.outcome === "period_assert_failed");
console.log(`  period assertion FAILURES: ${assertFailed.length}`);
for (const l of assertFailed) console.log(`   ✗ ${l.symbol.padEnd(12)}${l.grain} ${l.period} — ${l.note}`);

// ── 6. RESOLVED BUT NO USABLE FILING ────────────────────────────────────────
console.log("\n【6】 RESOLVED TO A SCRIP BUT NO USABLE FILING — named");
for (const outcome of ["not_listed", "listed_without_xbrl", "fetch_failed", "parse_failed"] as const) {
  const rows = ledger.filter((l) => l.outcome === outcome);
  if (!rows.length) continue;
  console.log(`  ${outcome} — ${rows.length}:`);
  const bySym: Record<string, string[]> = {};
  for (const r of rows) (bySym[r.symbol] = bySym[r.symbol] ?? []).push(`${r.grain[0]}:${r.period}`);
  for (const [s, ps] of Object.entries(bySym)) console.log(`   · ${s.padEnd(12)}${ps.length.toString().padStart(3)} — ${ps.slice(0, 8).join(" ")}${ps.length > 8 ? " …" : ""}`);
}

// ── run shape ───────────────────────────────────────────────────────────────
console.log("\n【RUN SHAPE】 outcomes across the whole ledger");
const outc: Record<string, number> = {};
for (const l of ledger) outc[l.outcome] = (outc[l.outcome] ?? 0) + 1;
console.log(`  ${JSON.stringify(outc)}   (ledger units: ${ledger.length})`);
if (report?.summary?.stopped) console.log(`  ⚠ run stopped: ${report.summary.stopped.reason} after ${report.summary.stopped.afterUnits} units`);

await prisma.$disconnect();
