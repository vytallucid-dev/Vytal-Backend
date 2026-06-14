// Unit-test harness for the THREE-LENS scoring machinery (Foundation + Momentum
// pure math core). HAND-COMPUTED expectations — not data-driven. Pure functions,
// no DB. Run:
//
//   npx tsx src/scripts/lens-machinery-test.ts
//
// Every expected value below is derived by hand in the adjacent comment. Each
// assertion prints  input → expected → actual → PASS/FAIL. The process exits
// non-zero if ANY assertion fails. FLAGS (spec ambiguities / interpretations)
// are printed up front.

import { computeLens1, type AbsoluteBars } from "../scoring/lenses/lens-bars.js";
import {
  computeLens2,
  computeLens3,
  zToScore,
} from "../scoring/lenses/lens-zscore.js";
import { combineLenses } from "../scoring/lenses/composite.js";

// ── tiny assertion framework ───────────────────────────────────────────────────
interface Row {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
  spec_conflict?: boolean;
}
const rows: Row[] = [];
const TOL = 1e-9;

function num(name: string, expected: number, actual: number): void {
  const pass = Math.abs(expected - actual) <= TOL;
  rows.push({ name, expected: expected.toFixed(4), actual: actual.toFixed(4), pass });
}
function eq(name: string, expected: string | number | boolean, actual: string | number | boolean): void {
  const pass = expected === actual;
  rows.push({ name, expected: String(expected), actual: String(actual), pass });
}
/** A deliberately-recorded SPEC CONFLICT: the spec's own verification line
 *  disagrees with its stated rule. We assert the RULE-consistent value (so it
 *  passes) and separately surface the conflicting spec expectation. */
function specConflict(name: string, ruleExpected: number, actual: number, specSaid: number): void {
  const pass = Math.abs(ruleExpected - actual) <= TOL;
  rows.push({
    name: `${name}  [spec line said ${specSaid}; rule⇒${ruleExpected}]`,
    expected: ruleExpected.toFixed(4),
    actual: actual.toFixed(4),
    pass,
    spec_conflict: true,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// FLAGS — interpretations made where the spec was ambiguous or self-conflicting
// ════════════════════════════════════════════════════════════════════════════
const FLAGS = [
  `[1] BOTTOM-SATURATION ASYMMETRY (spec-internal CONFLICT). The mechanics say ` +
    `"-10 points per band-width below Distress, floored at 0". Distress anchor=20, ` +
    `so one band-width below ⇒ 10, and the floor (0) is reached at TWO band-widths. ` +
    `But the spec's VERIFICATION line says "below Distress by one band-width → 0". ` +
    `These disagree. The TOP is consistent (+10/bw, Excellent=90 ⇒ one bw ⇒ 100), ` +
    `because 100-90=10 but 20-0=20 — an asymmetry baked into the anchor choices. ` +
    `IMPLEMENTED THE STATED RULE (-10/bw): 1bw-below⇒10, 2bw-below⇒0. The two ` +
    `[spec line said 0] rows below show the conflict explicitly. NEEDS A RULING if ` +
    `the intent was a steeper -20/bw (or anchoring the floor at one band-width).`,
  `[2] LensFallback enum is COARSE (3 states) but the precise available-set is ` +
    `carried by the 3 booleans (l1/l2/l3 Available → MetricScore.l*Available). ` +
    `"l2_to_l1" labels BOTH "only L2 missing (L1+L3 present)" and "down to L1 only". ` +
    `The composite SCORE is the faithful equal-weight mean of present lenses in ` +
    `every case; the enum is just the summary. No score information is lost.`,
  `[3] L3 minimum effective N is a CALLER-SUPPLIED policy (minEffectiveN param). ` +
    `The function bakes in no guessed threshold (CN-8) — it only compares and ` +
    `guards: N<min ⇒ L3 UNAVAILABLE (composite falls back); σ=0 with enough N ⇒ ` +
    `returns the anchor, still available.`,
  `[4] BAND-LANDING convention: the band = the highest bar the value CLEARED. The ` +
    `whole region below the Concerning bar is the "distress" band (open-ended ` +
    `downward); the Distress BAR is only the score=20 reference point, not the ` +
    `band's lower edge. So a value scoring 30 (between the Distress and Concerning ` +
    `bars) lands in "distress" — it cleared neither Concerning nor better.`,
  `[5] COLLAPSED interior interval (e.g. Acceptable=Good): a "step", not a divide. ` +
    `At the collapsed value the HIGHER tier wins (step up); just below it the lower ` +
    `tier interpolates. The zero-width branch is never entered (its guards ` +
    `coincide), so no divide-by-zero. Verified: no NaN.`,
  `[6] COLLAPSED SATURATION scale: if the adjacent band-width (Excellent→Good for ` +
    `the top, Concerning→Distress for the bottom) is 0, the nearest non-zero ` +
    `interior band-width is used as the scale; if ALL bars are equal there is no ` +
    `scale ⇒ the anchor score is returned and flagged (no divide-by-zero).`,
];

// ════════════════════════════════════════════════════════════════════════════
// LENS 1 — ABSOLUTE BARS
// ════════════════════════════════════════════════════════════════════════════

// higher_better bars (ROCE-like). All four band-widths = 6.
const HB: AbsoluteBars = { excellent: 30, good: 24, acceptable: 18, concerning: 12, distress: 6 };

// On-bar → exact anchors.
{
  let r = computeLens1(30, HB, "higher_better"); num("L1 HB value@Excellent(30)→90", 90, r.score); eq("L1 HB band@30=excellent", "excellent", r.band);
  r = computeLens1(24, HB, "higher_better"); num("L1 HB value@Good(24)→75", 75, r.score); eq("L1 HB band@24=good", "good", r.band);
  r = computeLens1(18, HB, "higher_better"); num("L1 HB value@Acceptable(18)→60", 60, r.score); eq("L1 HB band@18=acceptable", "acceptable", r.band);
  r = computeLens1(12, HB, "higher_better"); num("L1 HB value@Concerning(12)→40", 40, r.score); eq("L1 HB band@12=concerning", "concerning", r.band);
  r = computeLens1(6, HB, "higher_better"); num("L1 HB value@Distress(6)→20", 20, r.score); eq("L1 HB band@6=distress", "distress", r.band);
}
// Midpoints (halfway in VALUE → halfway in SCORE).
num("L1 HB 27 (mid Good↔Exc)→82.5", 82.5, computeLens1(27, HB, "higher_better").score); // 75+15*0.5
num("L1 HB 21 (mid Acc↔Good)→67.5", 67.5, computeLens1(21, HB, "higher_better").score); // 60+15*0.5
num("L1 HB 15 (mid Con↔Acc)→50", 50, computeLens1(15, HB, "higher_better").score);       // 40+20*0.5
num("L1 HB 9 (mid Dis↔Con)→30", 30, computeLens1(9, HB, "higher_better").score);         // 20+20*0.5
eq("L1 HB band@15=concerning", "concerning", computeLens1(15, HB, "higher_better").band);
eq("L1 HB band@9=distress", "distress", computeLens1(9, HB, "higher_better").band);
// Saturation TOP: +10/bandwidth, cap 100.
num("L1 HB 36 (+1bw)→100 (cap)", 100, computeLens1(36, HB, "higher_better").score);       // 90+10*1
num("L1 HB 33 (+0.5bw)→95", 95, computeLens1(33, HB, "higher_better").score);             // 90+10*0.5
num("L1 HB 42 (+2bw)→100 (clamped)", 100, computeLens1(42, HB, "higher_better").score);   // 90+20→100
eq("L1 HB 36 saturated flag", true, computeLens1(36, HB, "higher_better").saturated);
// Saturation BOTTOM: -10/bandwidth, floor 0. (See FLAG[1].)
specConflict("L1 HB 0 (-1bw below Distress)", 10, computeLens1(0, HB, "higher_better").score, 0); // 20-10*1
num("L1 HB -6 (-2bw below)→0", 0, computeLens1(-6, HB, "higher_better").score);           // 20-20→0
num("L1 HB 3 (-0.5bw)→15", 15, computeLens1(3, HB, "higher_better").score);               // 20-10*0.5
num("L1 HB -12 (-3bw)→0 (clamped)", 0, computeLens1(-12, HB, "higher_better").score);     // 20-30→0

// lower_better bars (D/E-like, ascending). All band-widths = 0.3.
const LB: AbsoluteBars = { excellent: 0.2, good: 0.5, acceptable: 0.8, concerning: 1.1, distress: 1.4 };
{
  let r = computeLens1(0.2, LB, "lower_better"); num("L1 LB value@Excellent(0.2)→90", 90, r.score); eq("L1 LB band@0.2=excellent", "excellent", r.band);
  r = computeLens1(0.5, LB, "lower_better"); num("L1 LB value@Good(0.5)→75", 75, r.score); eq("L1 LB band@0.5=good", "good", r.band);
  r = computeLens1(0.8, LB, "lower_better"); num("L1 LB value@Acceptable(0.8)→60", 60, r.score);
  r = computeLens1(1.1, LB, "lower_better"); num("L1 LB value@Concerning(1.1)→40", 40, r.score);
  r = computeLens1(1.4, LB, "lower_better"); num("L1 LB value@Distress(1.4)→20", 20, r.score); eq("L1 LB band@1.4=distress", "distress", r.band);
}
num("L1 LB 0.35 (mid Exc↔Good)→82.5", 82.5, computeLens1(0.35, LB, "lower_better").score); // 75+15*0.5
num("L1 LB 0.65 (mid Good↔Acc)→67.5", 67.5, computeLens1(0.65, LB, "lower_better").score); // 60+15*0.5
// Saturation: BETTER than excellent (lower value) = top; WORSE than distress (higher value) = bottom.
num("L1 LB -0.1 (better than Exc, +1bw)→100", 100, computeLens1(-0.1, LB, "lower_better").score); // 90+10*1
specConflict("L1 LB 1.7 (worse than Dis, -1bw)", 10, computeLens1(1.7, LB, "lower_better").score, 0); // 20-10*1
num("L1 LB 2.0 (worse than Dis, -2bw)→0", 0, computeLens1(2.0, LB, "lower_better").score);           // 20-20→0

// Collapsed interior interval: Acceptable=Good=24 (higher_better). Step, no NaN.
const COLLAPSED: AbsoluteBars = { excellent: 30, good: 24, acceptable: 24, concerning: 12, distress: 6 };
{
  const r = computeLens1(24, COLLAPSED, "higher_better");
  num("L1 collapsed @24 → 75 (higher tier wins, no NaN)", 75, r.score);
  eq("L1 collapsed @24 band=good", "good", r.band);
  eq("L1 collapsed @24 finite (not NaN)", true, Number.isFinite(r.score));
}
{
  // Just below the collapsed point steps down into the concerning interval.
  const r = computeLens1(18, COLLAPSED, "higher_better"); // [12,24): 40+20*((18-12)/12)=50
  num("L1 collapsed @18 → 50 (concerning interp, no NaN)", 50, r.score);
  eq("L1 collapsed @18 band=concerning", "concerning", r.band);
}

// ════════════════════════════════════════════════════════════════════════════
// LENS 2 — PEER CROSS-SECTION Z   (mean=50, std=10 ⇒ value 50/60/70/40/30/80 = Z 0/1/2/-1/-2/3)
// ════════════════════════════════════════════════════════════════════════════
const P = { peerMean: 50, peerStdDev: 10 };
const L2 = (value: number, lifted = false, dir: "higher_better" | "lower_better" = "higher_better") =>
  computeLens2({ value, ...P, direction: dir, anchorLifted: lifted });

num("L2 Z=0 → 60", 60, L2(50).score!);
num("L2 Z=+1 → 75", 75, L2(60).score!);
num("L2 Z=+2 → 90", 90, L2(70).score!);
num("L2 Z=-1 → 45", 45, L2(40).score!);
num("L2 Z=-2 → 30", 30, L2(30).score!);
num("L2 Z=+3 → 95 (saturation 5/Z)", 95, L2(80).score!);   // 90+5*1
num("L2 Z=+4 → 100 (cap)", 100, L2(90).score!);            // 90+5*2
num("L2 Z=+6 → 100 (clamped)", 100, L2(110).score!);       // 90+20→100
num("L2 raw Z stored (value 80) = 3.0", 3, L2(80).z!);
// Direction: lower_better flips orientation — a LOW value scores HIGH.
num("L2 lower_better value=30 (rawZ=-2→oriented+2) → 90", 90, L2(30, false, "lower_better").score!);
num("L2 lower_better value=70 (rawZ=+2→oriented-2) → 30", 30, L2(70, false, "lower_better").score!);
// §5.3.1 anchor lift (60→75).
num("L2 LIFT Z=0 → 75", 75, L2(50, true).score!);
num("L2 LIFT Z=+1 → 82.5", 82.5, L2(60, true).score!);
num("L2 LIFT Z=-1 → 52.5", 52.5, L2(40, true).score!);
num("L2 LIFT Z=+2 → 90 (endpoint unchanged)", 90, L2(70, true).score!);
num("L2 LIFT Z=-2 → 30 (endpoint unchanged)", 30, L2(30, true).score!);
eq("L2 LIFT anchorApplied=75", 75, L2(50, true).anchorApplied);
eq("L2 LIFT anchorLiftFired=true", true, L2(50, true).anchorLiftFired);
eq("L2 no-lift anchorApplied=60", 60, L2(50).anchorApplied);
// σ=0 guard → anchor, no NaN, still available.
{
  const r = computeLens2({ value: 55, peerMean: 50, peerStdDev: 0, direction: "higher_better", anchorLifted: false });
  num("L2 σ=0 → anchor 60", 60, r.score!); eq("L2 σ=0 guard", "std_dev_zero", r.guard!); eq("L2 σ=0 z=null", true, r.z === null); eq("L2 σ=0 still available", true, r.available);
  const rl = computeLens2({ value: 55, peerMean: 50, peerStdDev: 0, direction: "higher_better", anchorLifted: true });
  num("L2 σ=0 LIFT → anchor 75", 75, rl.score!);
}

// ════════════════════════════════════════════════════════════════════════════
// LENS 3 — OWN-HISTORY Z   (mean=100, std=20, minEffectiveN=4)
// ════════════════════════════════════════════════════════════════════════════
const H = { ownHistMean: 100, ownHistStdDev: 20, minEffectiveN: 4 };
const L3 = (value: number, windowN = 8, lifted = false, dir: "higher_better" | "lower_better" = "higher_better") =>
  computeLens3({ value, ...H, windowN, direction: dir, anchorLifted: lifted });

num("L3 Z=0 → 60", 60, L3(100).score!);
num("L3 Z=+2 → 90", 90, L3(140).score!);
num("L3 Z=+3 → 95 (saturation)", 95, L3(160).score!);
num("L3 Z=-2 → 30", 30, L3(60).score!);
// §5.4.1 lift (mirror of §5.3.1).
num("L3 LIFT Z=0 → 75", 75, L3(100, 8, true).score!);
num("L3 LIFT Z=+1 → 82.5", 82.5, L3(120, 8, true).score!);
num("L3 LIFT Z=-1 → 52.5", 52.5, L3(80, 8, true).score!);
// Direction.
num("L3 lower_better value=60 (rawZ=-2→oriented+2) → 90", 90, L3(60, 8, false, "lower_better").score!);
// small-N guard → UNAVAILABLE.
{
  const r = L3(140, 2);
  eq("L3 N=2<4 unavailable", false, r.available);
  eq("L3 N=2 score null", true, r.score === null);
  eq("L3 N=2 guard insufficient_n", "insufficient_n", r.guard!);
}
// σ=0 guard (enough N) → anchor, available.
{
  const r = computeLens3({ value: 110, ownHistMean: 100, ownHistStdDev: 0, windowN: 8, minEffectiveN: 4, direction: "higher_better", anchorLifted: false });
  num("L3 σ=0 → anchor 60", 60, r.score!); eq("L3 σ=0 guard", "std_dev_zero", r.guard!); eq("L3 σ=0 available", true, r.available);
}

// ════════════════════════════════════════════════════════════════════════════
// METRIC COMPOSITE — (L1+L2+L3)/3 equal weight, §5.8 fallback
// ════════════════════════════════════════════════════════════════════════════
// Three present → mean. L1=90, L2=60, L3=60 → 70.
{
  const c = combineLenses(computeLens1(30, HB, "higher_better"), L2(50), L3(100));
  num("Composite all-3 (90,60,60)→70", 70, c.metricScore); // (90+60+60)/3
  eq("Composite all-3 fallback=none", "none", c.lensFallbackApplied);
  eq("Composite all-3 lensesUsed=3", 3, c.lensesUsed);
}
// L3 unavailable → (L1+L2)/2, fallback l3_insufficient_history.
{
  const c = combineLenses(computeLens1(24, HB, "higher_better"), L2(60), L3(140, 2)); // L1=75, L2=75, L3 unavail
  num("Composite L3-missing (75,75)→75", 75, c.metricScore);
  eq("Composite L3-missing fallback", "l3_insufficient_history", c.lensFallbackApplied);
  eq("Composite L3-missing lensesUsed=2", 2, c.lensesUsed);
  eq("Composite L3-missing l3Available=false", false, c.l3Available);
}
// L2 unavailable but L3 present → mean(L1,L3), fallback l2_to_l1, booleans precise.
{
  const c = combineLenses(computeLens1(24, HB, "higher_better"), null, L3(140)); // L1=75, L3=90
  num("Composite L2-missing (75,90)→82.5", 82.5, c.metricScore);
  eq("Composite L2-missing fallback=l2_to_l1", "l2_to_l1", c.lensFallbackApplied);
  eq("Composite L2-missing l2Available=false", false, c.l2Available);
  eq("Composite L2-missing l3Available=true", true, c.l3Available);
}
// Only L1 → mean = L1, fallback l2_to_l1.
{
  const c = combineLenses(computeLens1(18, HB, "higher_better"), null, null); // L1=60
  num("Composite L1-only → 60", 60, c.metricScore);
  eq("Composite L1-only fallback=l2_to_l1", "l2_to_l1", c.lensFallbackApplied);
  eq("Composite L1-only lensesUsed=1", 1, c.lensesUsed);
}
// Direction applied END-TO-END (lower_better): value below mean ⇒ ABOVE anchor everywhere.
{
  const l1 = computeLens1(0.5, LB, "lower_better"); // = Good → 75
  const l2 = computeLens2({ value: 0.5, peerMean: 0.8, peerStdDev: 0.3, direction: "lower_better", anchorLifted: false }); // rawZ=-1→+1→75
  const l3 = computeLens3({ value: 0.5, ownHistMean: 0.8, ownHistStdDev: 0.3, windowN: 8, minEffectiveN: 4, direction: "lower_better", anchorLifted: false }); // 75
  num("E2E lower_better L1=75", 75, l1.score);
  num("E2E lower_better L2=75 (below-mean is GOOD)", 75, l2.score!);
  num("E2E lower_better L3=75", 75, l3.score!);
  const c = combineLenses(l1, l2, l3);
  num("E2E lower_better composite=75", 75, c.metricScore);
}

// ── zToScore direct unit checks (the shared core) ──────────────────────────────
num("core zToScore(0,60)=60", 60, zToScore(0, 60));
num("core zToScore(2,60)=90", 90, zToScore(2, 60));
num("core zToScore(-2,60)=30", 30, zToScore(-2, 60));
num("core zToScore(1,75)=82.5", 82.5, zToScore(1, 75));
num("core zToScore(-1,75)=52.5", 52.5, zToScore(-1, 75));
num("core zToScore(3,60)=95", 95, zToScore(3, 60));
num("core zToScore(-8,60)=0 (floor)", 0, zToScore(-8, 60)); // 30-5*6=0

// ════════════════════════════════════════════════════════════════════════════
// REPORT
// ════════════════════════════════════════════════════════════════════════════
console.log("\n══════════════════════ LENS MACHINERY — FLAGS (interpretations) ══════════════════════\n");
for (const f of FLAGS) console.log("  • " + f + "\n");

console.log("══════════════════════ HAND-COMPUTED ASSERTIONS ══════════════════════\n");
const nameW = Math.max(...rows.map((r) => r.name.length));
const expW = Math.max(6, ...rows.map((r) => r.expected.length));
const actW = Math.max(6, ...rows.map((r) => r.actual.length));
let pass = 0;
let fail = 0;
for (const r of rows) {
  if (r.pass) pass++;
  else fail++;
  const status = r.pass ? "PASS" : "FAIL";
  console.log(
    `  ${status}  ${r.name.padEnd(nameW)}  expected=${r.expected.padStart(expW)}  actual=${r.actual.padStart(actW)}` +
      (r.spec_conflict ? "   ⚑ SPEC-CONFLICT (see FLAG[1])" : ""),
  );
}
console.log(
  `\n──────────────────────────────────────────────────────────────────────\n` +
    `  TOTAL: ${rows.length}   PASS: ${pass}   FAIL: ${fail}\n`,
);
if (fail > 0) {
  console.log("  ✗ SOME ASSERTIONS FAILED — a hand-computed expectation disagrees with the implementation. STOP and review.\n");
  process.exitCode = 1;
} else {
  console.log("  ✓ ALL ASSERTIONS PASS. (Two rows are marked SPEC-CONFLICT: they assert the\n" +
    "    stated -10/band-width rule and pass; the spec's verification line said 0 — see FLAG[1].)\n");
}
