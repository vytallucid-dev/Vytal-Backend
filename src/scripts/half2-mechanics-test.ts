// HALF-2 SCORING MECHANICS — verification harness (handoff Half 2).
//
//   npx tsx src/scripts/half2-mechanics-test.ts
//
// This is the SIBLING of src/scripts/lens-machinery-test.ts. That file is the
// immutable 105-assertion REGRESSION GATE and is left byte-for-byte unchanged
// (run it separately — it must still print 105 PASS). The Half-2 additions
// (SSCU 3-anchor, multi-collapse robustness, unit-match guard) live here and
// import the IDENTICAL pure functions, so the gate stays pristine. Everything
// below runs against the REAL bars loaded from docs/vytal_pg_bars.json (no DB —
// dry-run mandate honoured via the in-memory resolver).

import { readFileSync } from "node:fs";
import {
  computeLens1,
  computeLens1ThreeAnchor,
  scoreL1,
  type AbsoluteBars,
} from "../scoring/lenses/lens-bars.js";
import { assertUnitMatch, UnitMismatchError, unitsMatch } from "../scoring/metric-scoring/unit-guard.js";
import { scoreMetricCrossSection, type CrossSectionInput } from "../scoring/metric-scoring/wire.js";
import { NO_SUPPRESSION } from "../scoring/metric-scoring/types.js";
import { loadVytalBars } from "../scoring/bars-loader/load-vytal-bars.js";
import { indexRows, resolveBars } from "../scoring/bars-loader/resolve.js";
import type { SourceDocument } from "../scoring/bars-loader/types.js";

// ── tiny assertion framework ─────────────────────────────────────────────────────
interface Row { name: string; expected: string; actual: string; pass: boolean }
const rows: Row[] = [];
const TOL = 1e-4;
const num = (name: string, expected: number, actual: number) =>
  rows.push({ name, expected: expected.toFixed(4), actual: actual.toFixed(4), pass: Math.abs(expected - actual) <= TOL });
const eq = (name: string, expected: unknown, actual: unknown) =>
  rows.push({ name, expected: String(expected), actual: String(actual), pass: expected === actual });
const ok = (name: string, pass: boolean, detail = "") =>
  rows.push({ name, expected: "true", actual: String(pass) + (detail ? ` (${detail})` : ""), pass });

// ── load the REAL bars ───────────────────────────────────────────────────────────
import { VYTAL_BARS_PATH } from "../scoring/bars-loader/source.js";
const sourcePath = VYTAL_BARS_PATH;
const doc = JSON.parse(readFileSync(sourcePath, "utf8")) as SourceDocument;
const report = loadVytalBars(doc, { mode: "validate_only", sourcePath });
const idx = indexRows(report.wouldWrite);
const log = (s: string) => console.log(s);

// ════════════════════════════════════════════════════════════════════════════
log("\n══════════ HALF-2 (b) MULTI-COLLAPSE ROBUSTNESS — on REAL degenerate bars ══════════\n");
// The existing computeLens1 already scans for the nearest non-zero band-width and
// its branch structure never enters a zero-width interval, so it handles ANY number
// of collapsed pairs with no divide-by-zero. We confirm on the real data:
//   • PG3 F9 OCF Consistency = {100,100,100,100,100}  (FULLY degenerate — 4 collapses)
//   • PG1 F9 OCF Consistency = {100,100,100, 80, 60}  (TOP triple-collapse E=G=A)
{
  const pg3 = resolveBars(idx, "PG3", "F9")!; // all-100
  log(`  PG3 F9 (${pg3.rawLabel}) real bars = E${pg3.bars.excellent} G${pg3.bars.good} A${pg3.bars.acceptable} C${pg3.bars.concerning} D${pg3.bars.distress}`);
  const at = computeLens1(100, pg3.bars, "higher_better");
  num("PG3 OCF degenerate @100 → 90 (on-bar excellent)", 90, at.score);
  ok("PG3 OCF degenerate @100 finite (no NaN)", Number.isFinite(at.score));
  const below = computeLens1(95, pg3.bars, "higher_better");
  ok("PG3 OCF degenerate @95 finite (no divide-by-zero)", Number.isFinite(below.score), `score=${below.score}`);
  eq("PG3 OCF degenerate @95 guard=degenerate_all_bars_equal", "degenerate_all_bars_equal", below.guard);
  num("PG3 OCF degenerate @95 → anchor 20 (no scale)", 20, below.score);
  const above = computeLens1(105, pg3.bars, "higher_better");
  ok("PG3 OCF degenerate @105 finite", Number.isFinite(above.score));
  num("PG3 OCF degenerate @105 → anchor 90", 90, above.score);

  const pg1 = resolveBars(idx, "PG1", "F9")!; // {100,100,100,80,60}
  log(`  PG1 F9 (${pg1.rawLabel}) real bars = E${pg1.bars.excellent} G${pg1.bars.good} A${pg1.bars.acceptable} C${pg1.bars.concerning} D${pg1.bars.distress}`);
  const a100 = computeLens1(100, pg1.bars, "higher_better");
  num("PG1 OCF E=G=A=100 @100 → 90 (higher tier wins)", 90, a100.score);
  eq("PG1 OCF @100 band=excellent", "excellent", a100.band);
  // @90 lands in [C=80, A=100): concerning interp 40 + 20*((90-80)/(100-80)) = 50
  const a90 = computeLens1(90, pg1.bars, "higher_better");
  num("PG1 OCF @90 → 50 (concerning interp, multi-collapse above)", 50, a90.score);
  ok("PG1 OCF @90 finite (no NaN despite 3 collapsed bars above)", Number.isFinite(a90.score));
  // @70 lands in [D=60, C=80): distress interp 20 + 20*((70-60)/(80-60)) = 30
  num("PG1 OCF @70 → 30 (distress interp)", 30, computeLens1(70, pg1.bars, "higher_better").score);
}

// ════════════════════════════════════════════════════════════════════════════
log("\n══════════ HALF-2 (c) SSCU CONDITIONAL (3-ANCHOR) BARS — real PG8 OPM ══════════\n");
{
  const f1opm = resolveBars(idx, "PG8", "F1_OPM")!;
  log(`  PG8 F1_OPM standard bars = E${f1opm.bars.excellent} G${f1opm.bars.good} A${f1opm.bars.acceptable} C${f1opm.bars.concerning} D${f1opm.bars.distress}`);
  log(`  PG8 F1_OPM sscu (3-anchor) = D${f1opm.sscu!.bars.distress} G${f1opm.sscu!.bars.good} E${f1opm.sscu!.bars.excellent}  scope=${JSON.stringify(f1opm.sscu!.scope)}`);
  const std: AbsoluteBars = f1opm.bars;
  const override = f1opm.sscu!;

  // TataPower IS in scope → uses sscu 3-anchor. NTPC is NOT → uses standard 5-bar.
  const tata = scoreL1(20, std, "higher_better", { stock: "TataPower", override });
  const tataSym = scoreL1(20, std, "higher_better", { stock: "TATAPOWER", override }); // NSE symbol form
  const ntpc = scoreL1(20, std, "higher_better", { stock: "NTPC", override });
  eq("PG8 F1_OPM TataPower@20 uses SSCU bar-set", "sscu", tata.barSetUsed);
  eq("PG8 F1_OPM 'TATAPOWER'@20 uses SSCU (symbol-form scope match)", "sscu", tataSym.barSetUsed);
  eq("PG8 F1_OPM NTPC@20 uses STANDARD bar-set", "standard", ntpc.barSetUsed);
  ok("SSCU vs standard give DIFFERENT scores at the same value", Math.abs(tata.score - ntpc.score) > 1, `sscu=${tata.score.toFixed(2)} std=${ntpc.score.toFixed(2)}`);

  // HAND-VERIFY one 3-anchor interpolation. value=20, sscu D=14.24 G=23.19 E=27, higher_better.
  // 20 ∈ [D, G): score = 20 + (75−20)·((20−14.24)/(23.19−14.24))
  //            = 20 + 55·(5.76/8.95) = 20 + 55·0.6435754 = 20 + 35.39665 = 55.39665
  const D = override.bars.distress, G = override.bars.good;
  const handSscu = 20 + 55 * ((20 - D) / (G - D));
  log(`  hand-calc: 20 + 55·((20−${D})/(${G}−${D})) = 20 + 55·${((20 - D) / (G - D)).toFixed(6)} = ${handSscu.toFixed(5)}`);
  num("PG8 F1_OPM TataPower@20 3-anchor interp = hand value", handSscu, tata.score);
  num("PG8 F1_OPM TataPower@20 ≈ 55.39665", 55.39665, tata.score);

  // direct 3-anchor function sanity: on-anchor values land on anchor scores.
  num("3-anchor on-Distress → 20", 20, computeLens1ThreeAnchor(override.bars.distress, override.bars, "higher_better").score);
  num("3-anchor on-Good → 75", 75, computeLens1ThreeAnchor(override.bars.good, override.bars, "higher_better").score);
  num("3-anchor on-Excellent → 90", 90, computeLens1ThreeAnchor(override.bars.excellent, override.bars, "higher_better").score);
  // saturation above E uses (excellent−good) width: E + 1bw → 100 cap via +10/bw
  const wTop = override.bars.excellent - override.bars.good;
  num("3-anchor +1 top-bandwidth above E → 100 (cap)", 100, computeLens1ThreeAnchor(override.bars.excellent + wTop, override.bars, "higher_better").score);
}

// ════════════════════════════════════════════════════════════════════════════
log("\n══════════ HALF-2 (d) UNIT-MATCH ASSERTION — ratio vs percent ══════════\n");
{
  // F3 (Cash Conversion) and F8 (FCF/PAT) bars are RATIO. A live value mislabeled
  // percent must THROW; an aligned ratio value must score.
  let threw = false, msg = "";
  try { assertUnitMatch("F3", "%"); } catch (e) { threw = true; msg = (e as Error).message; }
  ok("assertUnitMatch(F3, live='%') THROWS (bars are ratio)", threw, msg.slice(0, 70) + "…");
  ok("…and it is a UnitMismatchError naming the metric+units", (() => { try { assertUnitMatch("F8", "%"); return false; } catch (e) { return e instanceof UnitMismatchError && (e as UnitMismatchError).metricKey === "F8" && (e as UnitMismatchError).barUnit === "ratio"; } })());
  // aligned: F3 live ratio passes; returns the bar unit.
  eq("assertUnitMatch(F3, live='ratio') passes → 'ratio'", "ratio", assertUnitMatch("F3", "ratio"));
  ok("unitsMatch(F3,'ratio')=true, unitsMatch(F3,'%')=false", unitsMatch("F3", "ratio") && !unitsMatch("F3", "%"));
  // percent metric stays percent: F1 ROCE live '%' passes.
  eq("assertUnitMatch(F1, live='%') passes → '%'", "%", assertUnitMatch("F1", "%"));

  // WIRED into the metric-scoring path: scoreMetricCrossSection throws on mismatch
  // BEFORE scoring, and scores when aligned. Use real F3 (Cash Conversion) ratio bars.
  const f3 = resolveBars(idx, "PG9", "F3")!; // PG9 Metals Cash Conv (ratio)
  const baseInput = (liveUnit: "%" | "ratio"): CrossSectionInput => ({
    pillar: "foundation", metricKey: "F3", label: "Cash Conversion", snapshot: "FY26",
    direction: "higher_better", bars: f3.bars, barNote: f3.note, liveUnit,
    members: [{ stockId: "s1", symbol: "TATASTEEL", rawValue: 1.14, available: true, unavailableReason: null, ownHistoryValues: [1.0, 1.1, 1.2, 1.14] }],
    suppression: NO_SUPPRESSION, config: { peerMinN: 3, l3MinN: 4, l3Window: 12 },
  });
  let wiredThrew = false;
  try { scoreMetricCrossSection(baseInput("%")); } catch (e) { wiredThrew = e instanceof UnitMismatchError; }
  ok("wire.scoreMetricCrossSection THROWS on liveUnit='%' vs ratio bars (F3)", wiredThrew);
  const scored = scoreMetricCrossSection(baseInput("ratio"));
  ok("wire.scoreMetricCrossSection SCORES when liveUnit='ratio' aligns (F3)", scored.scored[0]?.l1Available === true, `L1=${scored.scored[0]?.l1Score?.toFixed(2)}`);
}

// ════════════════════════════════════════════════════════════════════════════
log("\n══════════ HAND-VERIFIED REAL CHAIN — real file → loaded bars → L1 arithmetic ══════════\n");
{
  // PG9 Metals/Mining, F1 ROCE, real loaded bars. Score a stock's ROCE = 18.0.
  const f1 = resolveBars(idx, "PG9", "F1")!;
  const b = f1.bars;
  log(`  stock=TATASTEEL  PG=PG9 (Metals/Mining)  metric=F1 (${f1.rawLabel})  unit=${f1.unit}  ${f1.note}`);
  log(`  real loaded bars: E${b.excellent} G${b.good} A${b.acceptable} C${b.concerning} D${b.distress}  (${f1.direction})`);
  const value = 18.0;
  // 18 ∈ [C=12.9, A=20.72) → concerning band: 40 + (60−40)·((18−12.9)/(20.72−12.9))
  const frac = (value - b.concerning) / (b.acceptable - b.concerning);
  const hand = 40 + 20 * frac;
  log(`  ROCE=18.0 ∈ [C ${b.concerning}, A ${b.acceptable}) → 40 + 20·((18−${b.concerning})/(${b.acceptable}−${b.concerning}))`);
  log(`             = 40 + 20·${frac.toFixed(6)} = ${hand.toFixed(5)}`);
  const r = scoreL1(value, b, f1.direction);
  num("real-chain PG9 F1 @18.0 L1 = hand arithmetic", hand, r.score);
  eq("real-chain PG9 F1 @18.0 band=concerning", "concerning", r.band);

  // And a banking INHERITED chain: PG6 Tier1 resolves to PG5's bars (PG6 has no own rows).
  const tier1 = resolveBars(idx, "PG6", "Tier1")!;
  eq("real-chain PG6 Tier1 resolves via inheritance → PG5", "PG5", tier1.resolvedFromBarPath);
  const tb = tier1.bars; // E18.8 G16.34 A16.04 C14.62 D13.2
  // Tier-1 = 17.0 ∈ [G 16.34, E 18.8) → good band: 75 + 15·((17−16.34)/(18.8−16.34))
  const tfrac = (17 - tb.good) / (tb.excellent - tb.good);
  const thand = 75 + 15 * tfrac;
  log(`  PG6→PG5 Tier1=17.0 ∈ [G ${tb.good}, E ${tb.excellent}) → 75 + 15·${tfrac.toFixed(6)} = ${thand.toFixed(5)}`);
  num("real-chain PG6(→PG5) Tier1 @17.0 L1 = hand arithmetic", thand, scoreL1(17, tb, tier1.direction).score);
}

// ════════════════════════════════════════════════════════════════════════════
log("\n══════════ FAIL-LOUD DEMOS — loader must reject transcription errors ══════════\n");
{
  // (i) UNMAPPED LABEL: a bogus label in a PG → load FAILS for that PG, naming it.
  const clone1 = JSON.parse(JSON.stringify(doc)) as SourceDocument;
  clone1.peerGroups[0].foundationMetrics[0].metricLabel = "Quantum Sharpe Coefficient";
  const r1 = loadVytalBars(clone1, { mode: "validate_only" });
  ok("unmapped label → report.pass=false", r1.pass === false);
  const unmapped = r1.perPg[0].issues.find((i) => i.kind === "unmapped_label");
  ok("…names the offending label", !!unmapped && unmapped.detail.includes("Quantum Sharpe Coefficient"), unmapped?.detail);

  // (ii) MONOTONICITY VIOLATION: break a bar ladder (higher_better, Good>Excellent).
  const clone2 = JSON.parse(JSON.stringify(doc)) as SourceDocument;
  clone2.peerGroups[1].foundationMetrics[0].bars.good = 999; // ROCE Good > Excellent
  const r2 = loadVytalBars(clone2, { mode: "validate_only" });
  ok("monotonicity violation → report.pass=false", r2.pass === false);
  const mono = r2.perPg[1].issues.find((i) => i.kind === "monotonicity");
  ok("…names the metric + out-of-order bars", !!mono && mono.metricKey === "F1", mono?.detail);

  // (iii) UNIT MISMATCH vs registry: ratio metric arriving as percent.
  const clone3 = JSON.parse(JSON.stringify(doc)) as SourceDocument;
  clone3.peerGroups[1].foundationMetrics[2].unit = "percent"; // F3 Cash Conversion is ratio
  const r3 = loadVytalBars(clone3, { mode: "validate_only" });
  ok("unit-vs-registry mismatch (F3 ratio→percent) → report.pass=false", r3.pass === false);
  ok("…flagged as the §8 silent-corruption catch at LOAD time",
    !!r3.perPg[1].issues.find((i) => i.kind === "unit_mismatch_vs_registry"));
}

// ── REPORT ────────────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(92) + "\n  HALF-2 ADDITIONS — ASSERTIONS\n" + "═".repeat(92) + "\n");
const nameW = Math.max(...rows.map((r) => r.name.length));
let pass = 0, fail = 0;
for (const r of rows) {
  r.pass ? pass++ : fail++;
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(nameW)}  expected=${r.expected}  actual=${r.actual}`);
}
console.log(`\n  TOTAL: ${rows.length}   PASS: ${pass}   FAIL: ${fail}\n`);
if (fail > 0) { console.log("  ✗ SOME HALF-2 ASSERTIONS FAILED.\n"); process.exitCode = 1; }
else console.log("  ✓ ALL HALF-2 ADDITIONS PASS (SSCU 3-anchor · multi-collapse · unit-guard · real chain · fail-loud).\n");
