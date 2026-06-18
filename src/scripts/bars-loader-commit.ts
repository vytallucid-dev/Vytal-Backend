// THE FIRST REAL BAR WRITE — commitLoad against REDERIVE_FINAL (append-only, versioned).
//
//   npx tsx src/scripts/bars-loader-commit.ts            # SAFETY DRY (no write; shows plan + pre-state)
//   npx tsx src/scripts/bars-loader-commit.ts --commit   # the real write (authorized)
//
// Writes the score_metric_bar_sets rows + ONE score_bar_provenance row for ALL 13 PGs'
// bars (bars load for everyone; SCORING stays scoped to the ready 7 / gated elsewhere).
// After the write it VERIFIES: per-PG row counts, the provenance row, version stamps (all
// v1 on a first commit), append-only safety (a re-run → v2, never an overwrite), and spot-
// checks 3 committed bars (PG3 F1, PG9 F8, PG8 F1_OPM sscu) against BOTH the parsed report
// AND the raw JSON.

import { readFileSync } from "node:fs";
import { loadVytalBars } from "../scoring/bars-loader/load-vytal-bars.js";
import { commitLoad } from "../scoring/bars-loader/commit.js";
import { VYTAL_BARS_PATH, VYTAL_BARS_FILENAME } from "../scoring/bars-loader/source.js";
import type { SourceDocument } from "../scoring/bars-loader/types.js";
import { prisma } from "../db/prisma.js";

const commit = process.argv.includes("--commit");
const H = (s: string) => console.log("\n" + "═".repeat(92) + "\n  " + s + "\n" + "═".repeat(92));
const N = (d: unknown) => Number(d as number); // Prisma Decimal → number

async function main() {
  const doc = JSON.parse(readFileSync(VYTAL_BARS_PATH, "utf8")) as SourceDocument;
  const report = loadVytalBars(doc, { mode: "validate_only", sourcePath: VYTAL_BARS_PATH });

  console.log(`BARS-LOADER COMMIT  (mode=${commit ? "COMMIT" : "SAFETY-DRY"})`);
  console.log(`  source: ${VYTAL_BARS_FILENAME}  framework ${report.specVersionFramework}  extractionDate ${report.extractionDate}`);
  console.log(`  validate: pass=${report.pass}  mapped=${report.totalMapped}/${report.totalMetrics}  wouldWrite=${report.totalWouldWriteRows}`);
  if (!report.pass) { console.error("  ✗ report did not pass — aborting (commitLoad would refuse)."); await prisma.$disconnect(); process.exit(1); }

  // ── pre-state: existing rows (a first commit expects 0) ──
  const preCount = await prisma.metricBarSet.count();
  const preProv = await prisma.barProvenance.count();
  console.log(`\n  PRE-STATE: score_metric_bar_sets rows=${preCount}, score_bar_provenance rows=${preProv}  ${preCount === 0 ? "(clean — first commit)" : "(NON-EMPTY — this commit will append a NEW version)"}`);

  // ── plan: per-PG would-write ──
  H("PLAN — would-write rows per PG (bars for ALL 13 PGs; PG6 inherits PG5 = 0 own rows)");
  for (const pg of report.perPg) {
    const note = pg.inheritsBarsFrom ? `(inherits ${pg.inheritsBarsFrom} — 0 own rows by design)` : "";
    console.log(`  ${pg.pgId.padEnd(5)} ${String(pg.wouldWriteRowCount).padStart(3)} rows  ${pg.industry.padEnd(13)} ${note}`);
  }
  console.log(`  ${"─".repeat(20)}\n  TOTAL: ${report.totalWouldWriteRows} bar rows + 1 provenance row`);

  if (!commit) { console.log(`\n  SAFETY-DRY — nothing written. Re-run with --commit to perform the real write.`); await prisma.$disconnect(); return; }

  // ════════════════════════════════ THE REAL WRITE ════════════════════════════════
  H("COMMIT — writing bar rows + provenance (append-only, versioned)");
  const result = await commitLoad(report, { confirm: true, sourceFile: VYTAL_BARS_FILENAME });
  console.log(`  ✓ commitLoad returned: rowsWritten=${result.rowsWritten}  provenanceId=${result.provenanceId}`);

  // ── per-PG committed counts (by this provenance) ──
  H("VERIFY — committed rows per PG (grouped from the DB, this provenance)");
  const grouped = await prisma.metricBarSet.groupBy({ by: ["barPath"], where: { provenanceId: result.provenanceId }, _count: { _all: true } });
  const byPath = new Map(grouped.map((g) => [g.barPath, g._count._all]));
  let total = 0;
  for (const pg of report.perPg) { const c = byPath.get(pg.pgId) ?? 0; total += c; console.log(`  ${pg.pgId.padEnd(5)} DB rows=${String(c).padStart(3)}  (plan=${pg.wouldWriteRowCount})  ${c === pg.wouldWriteRowCount ? "✓" : "✗ MISMATCH"}`); }
  console.log(`  ${"─".repeat(20)}\n  DB TOTAL for this provenance: ${total}  (expected ${report.totalWouldWriteRows})  ${total === report.totalWouldWriteRows ? "✓" : "✗"}`);

  // ── version stamps ──
  const versions = await prisma.metricBarSet.groupBy({ by: ["version"], where: { provenanceId: result.provenanceId }, _count: { _all: true } });
  console.log(`\n  VERSION STAMPS: ${versions.map((v) => `v${v.version}×${v._count._all}`).join(", ")}  ${versions.length === 1 && versions[0].version === 1 ? "(all v1 — first append) ✓" : "(mixed — appended onto existing)"}`);

  // ── provenance + spec version ──
  H("VERIFY — provenance row + spec version");
  const prov = await prisma.barProvenance.findUnique({ where: { id: result.provenanceId } });
  const ev = (prov?.evidence ?? {}) as Record<string, unknown>;
  console.log(`  provenance.id           : ${prov?.id}`);
  console.log(`  provenance.method       : ${prov?.method}`);
  console.log(`  provenance.derivedAt    : ${prov?.derivedAt?.toISOString?.() ?? prov?.derivedAt}`);
  console.log(`  evidence.sourceFile     : ${ev.sourceFile}`);
  console.log(`  evidence.extractionDate : ${ev.extractionDate}`);
  console.log(`  evidence.framework      : ${ev.specVersionFramework}`);
  console.log(`  evidence.perMetric keys : ${Object.keys((ev.perMetric ?? {}) as object).length} (one per written row)`);
  const sv = await prisma.scoringSpecVersion.findFirst({ where: { version: report.specVersionFramework } });
  console.log(`  specVersion             : "${sv?.version}"  id=${sv?.id}`);

  // ── append-only proof (NO write): what a re-run WOULD assign ──
  H("VERIFY — append-only discipline (no write performed here)");
  const top = await prisma.metricBarSet.findFirst({ where: { barPath: "PG3", metricKey: "F1" }, orderBy: { version: "desc" }, select: { version: true } });
  console.log(`  (PG3,F1) current max version in DB = ${top?.version}`);
  console.log(`  a re-run's nextVersion(PG3,F1) = max+1 = ${(top?.version ?? 0) + 1}  → writes a NEW row, never overwrites`);
  console.log(`  guaranteed by @@unique([barPath, metricKey, version]) on score_metric_bar_sets (a same-version re-insert would throw, not clobber).`);

  // ── spot-checks: DB == parsed report == raw JSON ──
  H("VERIFY — spot-check 3 committed bars vs parsed report AND raw JSON");
  const jsonIndex = new Map<string, { bars: Record<string, number>; sscuBars?: Record<string, number | null> }>();
  for (const pg of doc.peerGroups) for (const m of [...pg.foundationMetrics, ...pg.momentumMetrics]) jsonIndex.set(`${pg.pgId}|${m.metricLabel}`, { bars: m.bars as unknown as Record<string, number>, sscuBars: m.sscuBars as unknown as Record<string, number | null> | undefined });

  const spots: { pg: string; key: string; sscu?: boolean }[] = [{ pg: "PG3", key: "F1" }, { pg: "PG9", key: "F8" }, { pg: "PG8", key: "F1_OPM", sscu: true }];
  let allOk = true;
  for (const s of spots) {
    const ww = report.wouldWrite.find((r) => r.barPath === s.pg && r.metricKey === s.key)!;
    const db = await prisma.metricBarSet.findFirst({ where: { barPath: s.pg, metricKey: s.key }, orderBy: { version: "desc" } });
    const rawJ = jsonIndex.get(`${s.pg}|${ww.rawLabel}`);
    const tiers = ["excellent", "good", "acceptable", "concerning", "distress"] as const;
    const dbV = db ? tiers.map((t) => N(db[t])) : [];
    const rpV = tiers.map((t) => ww.bars[t]);
    const jsV = tiers.map((t) => rawJ!.bars[t]);
    const eq = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
    const okDbRp = eq(dbV, rpV), okRpJs = eq(rpV, jsV);
    if (!okDbRp || !okRpJs) allOk = false;
    console.log(`\n  ${s.pg} ${s.key}  (label="${ww.rawLabel}", dir=${db?.direction})  v${db?.version}`);
    console.log(`     raw JSON : [${jsV.join(", ")}]`);
    console.log(`     report   : [${rpV.join(", ")}]`);
    console.log(`     DB       : [${dbV.join(", ")}]`);
    console.log(`     DB==report: ${okDbRp ? "✓" : "✗"}   report==rawJSON: ${okRpJs ? "✓" : "✗"}`);
    if (s.sscu) {
      const evSscu = ((ev.perMetric as Record<string, { sscu?: { bars: Record<string, number>; scope: string[] } | null }>)[`${s.pg}|${s.key}`])?.sscu;
      const jsSscu = rawJ?.sscuBars;
      const okSscu = !!evSscu && !!jsSscu && Math.abs(evSscu.bars.distress - (jsSscu.distress as number)) < 1e-9 && Math.abs(evSscu.bars.good - (jsSscu.good as number)) < 1e-9 && Math.abs(evSscu.bars.excellent - (jsSscu.excellent as number)) < 1e-9;
      if (!okSscu) allOk = false;
      console.log(`     SSCU override (cold, in provenance.evidence): scope=${JSON.stringify(evSscu?.scope)} bars D/G/E=${evSscu?.bars.distress}/${evSscu?.bars.good}/${evSscu?.bars.excellent}`);
      console.log(`     raw JSON sscuBars D/G/E = ${jsSscu?.distress}/${jsSscu?.good}/${jsSscu?.excellent}   provenance==rawJSON: ${okSscu ? "✓" : "✗"}`);
    }
  }
  console.log(`\n  ${allOk ? "✓ ALL SPOT-CHECKS PASS — committed bars are byte-faithful to the JSON." : "✗ A SPOT-CHECK FAILED"}`);

  await prisma.$disconnect();
  if (!allOk) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
