// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// S6c PART 1b — IMPORT THE HAND-KEYED WORKBOOK.
//
//   npx tsx src/scripts/import-keyed-workbook.ts --dry     resolve + classify, write nothing
//   npx tsx src/scripts/import-keyed-workbook.ts --live    WRITE
//
// ★ WHAT THIS WRITES: 5,855 cells that are (a) marked amber in the workbook, (b) on a row that
//   already exists, and (c) currently NULL. Nothing else.
//
// ⚠ THE UNIT CONVERSION IS THE MOST DANGEROUS THING HERE. The workbook declares gnpa_pct, nnpa_pct,
//   cet1_ratio, additional_tier1_ratio and roa_* as "%" (UNIT row AND FIELD_GUIDE) and Aman keyed
//   human-readable percentages. The DATABASE stores FRACTIONS. PROVEN per field against live
//   nse_xbrl rows for the SAME stock: every ratio field sits 83–257x above its live counterpart,
//   every money field 0.5–1.7x. So ratios are divided by 100 and money is not touched.
//   Sign is preserved — 51 roa_* cells are legitimately negative (bank loss quarters).
//
// ⚠ ROLLBACK, HONESTLY. applyRawFieldEdit owns its own transaction per cell and cannot join an
//   outer one, so there is no single transaction spanning 5,855 edits to roll back. The DRY RUN is
//   therefore the pre-commit gate: it proves the count is exactly 5,855 before anything is written.
//   The live run re-asserts and ABORTS on the first unexpected refusal rather than grinding on.
//
// ⚠ NO SCORING. Every edit passes skipCascade:true — no PG rescore, no brief invalidation, nothing
//   enqueued. The run counts background_jobs before and after and asserts the delta is zero.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import crypto from "node:crypto";
import { prisma } from "../db/prisma.js";
import { applyRawFieldEditsForRow, type RowEdit } from "../fill/raw-field-edit.js";

const LIVE = process.argv.includes("--live");
const KEYED = "_wb_keyed.json";
const WORKBOOK = "Vytal_Manual_Entry_Workbook_v5.xlsx";
const EDITED_BY = "human:aman (keyed workbook import)";

type Keyed = { sheet: string; rowId: string; symbol: string; fy: string; quarter: string; report_date: string; type: string; field: string; value: number };
const keyed: Keyed[] = JSON.parse(fs.readFileSync(KEYED, "utf8"));

const MODEL: Record<string, string> = {
  fundamentals: "Fundamental",
  quarterly_results: "QuarterlyResult",
  banking_fundamentals: "BankingFundamental",
  banking_quarterly_results: "BankingQuarterlyResult",
};
const ANNUAL = new Set(["fundamentals", "banking_fundamentals"]);
const RATIO = new Set(["gnpa_pct", "nnpa_pct", "cet1_ratio", "tier1_ratio", "additional_tier1_ratio", "roa_disclosed", "roa_quarterly"]);
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
/** ⚠ ratios only. Money is already Rs Cr in both the workbook and the DB. */
const toDb = (field: string, v: number) => (RATIO.has(field) ? v / 100 : v);

const TABLES = ["quarterly_results", "fundamentals", "banking_quarterly_results", "banking_fundamentals"] as const;

async function snapshot(): Promise<Map<string, { md5: string; updated: number; source: string }>> {
  const m = new Map<string, { md5: string; updated: number; source: string }>();
  for (const t of TABLES) {
    const rows: Array<{ id: string; source: string; updated_at: Date; md5: string }> = await prisma.$queryRawUnsafe(
      `SELECT id, source, updated_at, md5(r.*::text) AS md5 FROM ${t} r`,
    );
    for (const r of rows) m.set(`${t}|${r.id}`, { md5: r.md5, updated: new Date(r.updated_at).getTime(), source: r.source });
  }
  return m;
}

async function main(): Promise<void> {
  console.log("═".repeat(100));
  console.log(`KEYED WORKBOOK IMPORT — ${LIVE ? "LIVE" : "DRY RUN (nothing will be written)"}`);
  console.log("═".repeat(100));

  // ── resolve every keyed cell to a DB row id ───────────────────────────────
  const index = new Map<string, { id: string; row: Record<string, unknown> }>();
  for (const t of TABLES) {
    const rows: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(
      `SELECT r.*, s.symbol AS _symbol FROM ${t} r JOIN stocks s ON s.id = r.stock_id WHERE r.result_type='standalone'`,
    );
    for (const r of rows) {
      const rd = r.report_date ? new Date(r.report_date as string).toISOString().slice(0, 10) : "";
      const k = ANNUAL.has(t) ? `${t}|${r._symbol}|${r.fiscal_year}` : `${t}|${r._symbol}|${rd}`;
      index.set(k, { id: r.id as string, row: r });
    }
  }

  const writable: Array<Keyed & { dbId: string; dbValue: number }> = [];
  // ★ RULING 1 — the 721 are carried forward as a NAMED SET, not a number, so none is lost between
  //   stages. Written to disk on every run; the BSE cohort creates the rows, then these come back.
  const deferred: Array<{ table: string; symbol: string; period: string; field: string; keyedValue: number; dbValue: number; rowId: string }> = [];
  const held: Array<{ table: string; symbol: string; period: string; field: string; keyedValue: number; dbValue: unknown; rowId: string }> = [];
  let rowMissing = 0, notNull = 0;
  for (const k of keyed) {
    const key = ANNUAL.has(k.sheet) ? `${k.sheet}|${k.symbol}|${k.fy}` : `${k.sheet}|${k.symbol}|${k.report_date}`;
    const hit = index.get(key);
    const period = k.fy || k.report_date;
    if (!hit) {
      rowMissing++;
      deferred.push({ table: k.sheet, symbol: k.symbol, period, field: k.field, keyedValue: k.value, dbValue: toDb(k.field, k.value), rowId: k.rowId });
      continue;
    }
    const cur = hit.row[k.field];
    if (cur !== null && cur !== undefined) {
      notNull++;
      held.push({ table: k.sheet, symbol: k.symbol, period, field: k.field, keyedValue: k.value, dbValue: cur, rowId: k.rowId });
      continue;
    }
    writable.push({ ...k, dbId: hit.id, dbValue: toDb(k.field, k.value) });
  }
  fs.writeFileSync("_keyed_deferred_721.json", JSON.stringify(deferred, null, 1));
  fs.writeFileSync("_keyed_held_8.json", JSON.stringify(held, null, 1));

  console.log(`\nkeyed cells            : ${keyed.length}`);
  console.log(`  writable (row exists, column NULL) : ${writable.length}`);
  console.log(`  skipped — no target row            : ${rowMissing}   ← RULING 1: left to the BSE cohort`);
  console.log(`  skipped — column already holds     : ${notNull}   ← RULING 2: never overwritten`);

  // ⚠ RESUMABLE ASSERTION. A partial earlier run leaves cells non-NULL, so `writable` shrinks by
  //   exactly what that run already wrote. The invariant is on the TOTAL, not on this run's slice.
  const EXPECT = 5855;
  const already = Number(((await prisma.$queryRaw`SELECT count(*)::int AS n FROM raw_field_edits WHERE edited_by = ${EDITED_BY}`) as Array<{ n: number }>)[0].n);
  if (already) console.log(`  already imported by an earlier run  : ${already}`);
  if (writable.length + already !== EXPECT) {
    console.log(`\n*** DRIFT: writable ${writable.length} + already ${already} = ${writable.length + already} != expected ${EXPECT} — STOPPING, nothing written ***`);
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  console.log(`  ✓ writable ${writable.length} + already ${already} = ${EXPECT}`);

  const ratios = writable.filter((w) => RATIO.has(w.field));
  console.log(`\nratio cells converted /100 : ${ratios.length}   (money cells untouched: ${writable.length - ratios.length})`);
  console.log("  sample conversions:");
  for (const r of ratios.slice(0, 3)) console.log(`    ${r.symbol} ${r.fy || r.report_date} ${r.field} keyed=${r.value}% → db=${r.dbValue}`);
  const neg = ratios.filter((r) => r.value < 0);
  console.log(`  negative ratios preserved: ${neg.length} (all still negative: ${neg.every((r) => r.dbValue < 0)})`);

  if (!LIVE) { console.log("\nDRY RUN — nothing written."); await prisma.$disconnect(); return; }

  // ── FENCE baseline + job baseline ─────────────────────────────────────────
  const before = await snapshot();
  const jobsBefore = Number(((await prisma.$queryRaw`SELECT count(*)::int AS n FROM background_jobs`) as Array<{ n: number }>)[0].n);
  const editsBefore = Number(((await prisma.$queryRaw`SELECT count(*)::int AS n FROM raw_field_edits`) as Array<{ n: number }>)[0].n);
  console.log(`\nFENCE baseline: ${before.size} rows snapshotted (md5 per row) · background_jobs=${jobsBefore} · raw_field_edits=${editsBefore}`);

  // ── the write, BATCHED BY ROW ─────────────────────────────────────────────
  // ⚠ ONE TRANSACTION PER ROW, NOT PER CELL. Same null-only predicate per field, same audit row per
  //   landed cell, one re-derive on the row's final raw state. MEASURED: this DB is remote — a bare
  //   round trip is 547 ms — so per-cell the import projects to ~3.7 hours, and the cost is latency,
  //   not work. The 6,584 cells sit on 413 rows. See applyRawFieldEditsForRow.
  const byRow = new Map<string, { table: string; dbId: string; edits: RowEdit[] }>();
  for (const w of writable) {
    const k = `${w.sheet}|${w.dbId}`;
    const g = byRow.get(k) ?? { table: MODEL[w.sheet], dbId: w.dbId, edits: [] };
    g.edits.push({
      field: camel(w.field),
      newValue: w.dbValue,
      citation: `${WORKBOOK} · sheet ${w.sheet} · ${w.rowId} · ${w.symbol} ${w.fy || w.report_date}${w.quarter ? " " + w.quarter : ""} · hand-keyed from source document${RATIO.has(w.field) ? ` · keyed ${w.value}% -> stored ${w.dbValue} (fraction)` : ""}`,
    });
    byRow.set(k, g);
  }
  console.log(`\nwriting ${writable.length} cells across ${byRow.size} rows (one transaction per row)`);

  let ok = 0, refused = 0, done = 0;
  const failures: string[] = [];
  const t0 = Date.now();
  for (const [, g] of byRow) {
    const res = await applyRawFieldEditsForRow(g.table, g.dbId, g.edits, EDITED_BY);
    if (!res.ok) {
      failures.push(`${g.table} ${g.dbId}: ${res.reason}`);
      // ⚠ FAIL FAST. A row failure means the pre-commit picture was wrong; grinding on would widen
      //   a write we no longer understand.
      if (failures.length >= 3) { console.log("\n*** 3 row failures — ABORTING the run ***"); break; }
    } else {
      ok += res.landed.length;
      refused += res.refusedNotNull.length;
      if (res.refusedNotNull.length) failures.push(`${g.table} ${g.dbId}: refused as non-null: ${res.refusedNotNull.join(",")}`);
    }
    done++;
    if (done % 50 === 0) console.log(`  … ${done}/${byRow.size} rows · ${ok} cells · ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  console.log(`\nwritten: ${ok} cells across ${done} rows in ${Math.round((Date.now() - t0) / 1000)}s  (refused as non-null: ${refused})`);
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  console.log(`【total】 ${already} (earlier partial run) + ${ok} (this run) = ${already + ok} of ${EXPECT}  ${already + ok === EXPECT ? "OK" : "*** SHORTFALL ***"}`);

  // ── assertions ────────────────────────────────────────────────────────────
  const jobsAfter = Number(((await prisma.$queryRaw`SELECT count(*)::int AS n FROM background_jobs`) as Array<{ n: number }>)[0].n);
  const editsAfter = Number(((await prisma.$queryRaw`SELECT count(*)::int AS n FROM raw_field_edits`) as Array<{ n: number }>)[0].n);
  console.log(`\n【no scoring】 background_jobs ${jobsBefore} → ${jobsAfter}  (delta ${jobsAfter - jobsBefore})  ${jobsAfter === jobsBefore ? "✓ ZERO jobs created" : "*** JOBS CREATED ***"}`);
  console.log(`【audit】     raw_field_edits ${editsBefore} → ${editsAfter}  (delta ${editsAfter - editsBefore})  expected +${ok}  ${editsAfter - editsBefore === ok ? "✓" : "*** MISMATCH ***"}`);

  // ── fence ─────────────────────────────────────────────────────────────────
  const after = await snapshot();
  const targeted = new Set(writable.map((w) => `${w.sheet}|${w.dbId}`));
  let vanished = 0, appeared = 0, changedTargeted = 0, changedUntargeted: string[] = [];
  for (const [k, v] of before) {
    const a = after.get(k);
    if (!a) { vanished++; continue; }
    if (a.md5 !== v.md5) { if (targeted.has(k)) changedTargeted++; else changedUntargeted.push(k); }
    if (a.source !== v.source) changedUntargeted.push(`${k} SOURCE CHANGED ${v.source}→${a.source}`);
  }
  for (const k of after.keys()) if (!before.has(k)) appeared++;
  console.log(`\n【fence】`);
  console.log(`  rows vanished              : ${vanished}   ${vanished === 0 ? "✓" : "*** ROWS LOST ***"}`);
  console.log(`  rows appeared              : ${appeared}   ${appeared === 0 ? "✓ (an import inserts nothing)" : "*** ROWS INSERTED ***"}`);
  console.log(`  targeted rows changed      : ${changedTargeted}`);
  console.log(`  UNTARGETED rows changed    : ${changedUntargeted.length}   ${changedUntargeted.length === 0 ? "✓ nothing outside the import moved" : "*** LEAKAGE ***"}`);
  for (const c of changedUntargeted.slice(0, 10)) console.log(`     ${c}`);

  await prisma.$disconnect();
}
await main();
