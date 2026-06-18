// Validate-only / DRY run of the Phase-6 per-PG bar loader (handoff Half 1).
// Reads docs/vytal_pg_bars.json, does the FULL parse + label→key mapping +
// validation, and reports what it WOULD write — committing NOTHING.
//
//   npx tsx src/scripts/bars-loader-validate.ts [path-to-json]
//
// Prints: the per-PG label→key mapping (for review), the per-PG validation
// summary (metrics / collapses / pass-fail), the PG5=PG6 byte-identical check,
// and the would-write row counts per PG. Exits non-zero if ANY label is unmapped
// or any monotonicity (or other) check fails — failing loudly and naming the
// offending metric.

import { readFileSync } from "node:fs";
import { loadVytalBars } from "../scoring/bars-loader/load-vytal-bars.js";
import { VYTAL_BARS_PATH } from "../scoring/bars-loader/source.js";
import type { SourceDocument } from "../scoring/bars-loader/types.js";

const argPath = process.argv[2];
const sourcePath = argPath ?? VYTAL_BARS_PATH;

const doc = JSON.parse(readFileSync(sourcePath, "utf8")) as SourceDocument;
const report = loadVytalBars(doc, { mode: "validate_only", sourcePath });

const H = (s: string) => console.log("\n" + "═".repeat(92) + "\n  " + s + "\n" + "═".repeat(92));

console.log(`\nVYTAL PER-PG BAR LOADER — VALIDATE-ONLY (DRY) RUN`);
console.log(`  source           : ${sourcePath}`);
console.log(`  specVersionFramework: ${report.specVersionFramework}   extractionDate: ${report.extractionDate}`);
console.log(`  mode             : ${report.mode} (commits nothing)`);

// ── 1. LABEL → KEY MAPPING per PG (the review artifact, handoff §2) ──────────────
H("1. LABEL → ENGINE KEY MAPPING  (per PG — review every row)");
for (const pg of report.perPg) {
  console.log(`\n  ── ${pg.pgId}  ${pg.pgName}  [${pg.industry}]${pg.inheritsBarsFrom ? `  inherits←${pg.inheritsBarsFrom}` : ""} ──`);
  const w = Math.max(...pg.mapping.map((m) => m.rawLabel.length), 8);
  for (const m of pg.mapping) {
    const flag = m.key ? "" : "   ⟵ UNMAPPED (FAILS LOAD)";
    console.log(`     [${m.pillar === "foundation" ? "F" : "M"}] ${m.rawLabel.padEnd(w)} → ${String(m.key ?? "???").padEnd(11)} (norm="${m.normalized}", ${m.direction}, ${m.unit})${flag}`);
  }
}

// ── 2. PER-PG VALIDATION SUMMARY (handoff §4) ────────────────────────────────────
H("2. PER-PG VALIDATION SUMMARY");
console.log(`  ${"PG".padEnd(5)} ${"name".padEnd(20)} ${"ind".padEnd(13)} seen mapped collapse degen sscu  wouldWrite  pass`);
for (const pg of report.perPg) {
  console.log(
    `  ${pg.pgId.padEnd(5)} ${pg.pgName.slice(0, 20).padEnd(20)} ${pg.industry.padEnd(13)} ` +
      `${String(pg.metricsSeen).padStart(4)} ${String(pg.metricsMapped).padStart(6)} ${String(pg.collapsesDetected).padStart(8)} ` +
      `${String(pg.degenerateAllEqual).padStart(5)} ${String(pg.sscuMetrics).padStart(4)} ${String(pg.wouldWriteRowCount).padStart(11)}  ${pg.pass ? "PASS" : "FAIL"}`,
  );
  for (const iss of pg.issues) {
    console.log(`        !! ${iss.kind}: ${iss.detail}`);
  }
}

// ── 3. PG5 = PG6 BYTE-IDENTICAL CHECK (handoff §3) ───────────────────────────────
H("3. BANKING INHERITANCE — PG5 = PG6 BYTE-IDENTICAL CHECK");
console.log(`  applicable : ${report.pg5pg6.applicable}`);
console.log(`  ${report.pg5pg6.childPgId} inherits ${report.pg5pg6.parentPgId} → byteIdentical = ${report.pg5pg6.byteIdentical}`);
console.log(`  ${report.pg5pg6.detail}`);

// ── 4. WHAT IT WOULD WRITE ───────────────────────────────────────────────────────
H("4. WOULD-WRITE (committing nothing) — score_metric_bar_sets row counts");
for (const pg of report.perPg) {
  const note = pg.inheritsBarsFrom ? `(inherits ${pg.inheritsBarsFrom} — 0 own rows by design)` : "";
  console.log(`  ${pg.pgId.padEnd(5)} ${String(pg.wouldWriteRowCount).padStart(3)} rows  ${note}`);
}
console.log(`  ${"".padEnd(5)} ${"─".repeat(10)}`);
console.log(`  TOTAL would-write rows: ${report.totalWouldWriteRows}  (from ${report.totalMetrics} source metrics, ${report.totalMapped} mapped)`);
console.log(`  + 1 BarProvenance row (source=${sourcePath.split(/[\\/]/).pop()}, extractionDate=${report.extractionDate})`);
console.log(`  version stamp (dry): v1 per (barPath,metricKey) — commit resolves real next version (append-only)`);

// ── 5. RESULT ────────────────────────────────────────────────────────────────────
H("5. RESULT");
if (report.pass) {
  console.log(`  ✓ VALIDATION PASSED. All ${report.totalMapped}/${report.totalMetrics} metrics mapped to a known engine key; no monotonicity / unit / direction / weight violations.`);
  console.log(`    Nothing was committed. Next deliberate step: commitLoad(report, { confirm:true }).`);
} else {
  console.log(`  ✗ VALIDATION FAILED — ${report.failureSummary.length} PG(s) with issues:`);
  for (const f of report.failureSummary) console.log(`      • ${f}`);
  process.exitCode = 1;
}
