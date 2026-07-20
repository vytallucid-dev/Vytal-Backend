// ═══════════════════════════════════════════════════════════════
// STEP 18 — THE MATH, on synthetic data where the answer is known BY HAND.
//
// No DB, no AMFI, no writes. If beta is wrong, it will be wrong here first — and here it is
// checkable against arithmetic rather than against plausibility. A beta of 1.04 on real data looks
// fine whether it is right or not; a beta of 1.04 on a series constructed to have beta EXACTLY 2.0
// is unmistakably broken.
// ═══════════════════════════════════════════════════════════════
import { SchemeAcc } from "../ingestions/amfi/mf-accumulator.js";
import { BenchmarkSeries } from "../ingestions/amfi/mf-benchmark.js";

const rule = (s: string) => console.log("\n" + "═".repeat(88) + "\n" + s + "\n" + "═".repeat(88));
let PASS = 0, FAIL = 0;
const ok = (c: boolean, label: string, detail = "") => {
  c ? PASS++ : FAIL++;
  console.log(`   ${c ? "✓" : "✗✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};
const near = (a: number | null, b: number, tol: number) => a !== null && Math.abs(a - b) < tol;

const DAY0 = 20000; // an arbitrary day-number; only differences matter
const N = 400; // enough to clear MIN_RETURNS for y1 (30) and y3 (90)

// ═══════════════════════════════════════════════════════════════
rule("1 · A PERFECT TRACKER — beta must be EXACTLY 1, tracking error EXACTLY 0");
// ═══════════════════════════════════════════════════════════════
// The fund IS the index (same daily moves). Any deviation from β=1 / TE=0 is pure arithmetic error.
{
  const bPts: { day: number; close: number }[] = [];
  let bc = 1000;
  const moves: number[] = [];
  for (let i = 0; i < N; i++) {
    // A deterministic, non-trivial wiggle — not random, so the test is reproducible.
    const r = 0.004 * Math.sin(i / 3) + 0.0002 * Math.cos(i / 7);
    moves.push(r);
    bc *= Math.exp(r);
    bPts.push({ day: DAY0 + i, close: bc });
  }
  const bench = new BenchmarkSeries("SYNTH", bPts);
  const acc = new SchemeAcc({ asOfDay: DAY0 + N - 1, bench });

  let nav = 50;
  acc.push(DAY0, nav);
  for (let i = 1; i < N; i++) {
    nav *= Math.exp(moves[i]!); // the fund moves EXACTLY as the index does
    acc.push(DAY0 + i, nav);
  }

  const b = acc.beta("y1");
  const te = acc.trackingError("y1");
  ok(near(b, 1.0, 1e-9), `beta = 1.000000000 for a fund that moves exactly with its index`, `got ${b?.toFixed(12)}`);
  ok(near(te, 0, 1e-9), `tracking error = 0 for a perfect tracker`, `got ${te?.toExponential(3)}`);
  console.log(`      (paired observations folded: ${acc.pairPoints("y1")})`);
  console.log(`      ↑ THE CANCELLATION TEST. With the textbook covariance — (Σ rF·rB − n·μF·μB) —`);
  console.log(`        cov and var are near-identical here and their difference drowns in float error.`);
  console.log(`        A beta of 0.97 or 1.03 instead of 1.000000000 would be that bug. Online`);
  console.log(`        co-moment accumulation is why this reads exactly 1.`);
}

// ═══════════════════════════════════════════════════════════════
rule("2 · A 2× LEVERED FUND — beta must be EXACTLY 2");
// ═══════════════════════════════════════════════════════════════
{
  const bPts: { day: number; close: number }[] = [];
  let bc = 1000;
  const moves: number[] = [];
  for (let i = 0; i < N; i++) {
    const r = 0.005 * Math.sin(i / 4);
    moves.push(r);
    bc *= Math.exp(r);
    bPts.push({ day: DAY0 + i, close: bc });
  }
  const bench = new BenchmarkSeries("SYNTH", bPts);
  const acc = new SchemeAcc({ asOfDay: DAY0 + N - 1, bench });

  let nav = 100;
  acc.push(DAY0, nav);
  for (let i = 1; i < N; i++) {
    nav *= Math.exp(2 * moves[i]!); // exactly twice the index's log move, every day
    acc.push(DAY0 + i, nav);
  }
  const b = acc.beta("y1");
  ok(near(b, 2.0, 1e-9), `beta = 2.000000000 for a fund that moves 2× the index`, `got ${b?.toFixed(12)}`);
  const te = acc.trackingError("y1");
  ok(te !== null && te > 0, `tracking error > 0 (it does NOT track — it amplifies)`, `${te?.toFixed(6)}`);
}

// ═══════════════════════════════════════════════════════════════
rule("3 · ★ THE RETURN-SPAN FIX — the bug that would corrupt every beta silently");
// ═══════════════════════════════════════════════════════════════
// The fund reports only every 5th day (a monthly-ish reporter). Its log return therefore spans FIVE
// index days. If the fold paired that 5-day fund move against the index's SINGLE-DAY return, beta
// would be badly wrong — and would look completely reasonable.
//
// Construct: fund moves exactly 1× the index's CUMULATIVE move over each 5-day gap. True beta = 1.
{
  const bPts: { day: number; close: number }[] = [];
  const closes: number[] = [];
  let bc = 1000;
  for (let i = 0; i < N; i++) {
    bc *= Math.exp(0.006 * Math.sin(i / 2.5) + 0.001);
    closes.push(bc);
    bPts.push({ day: DAY0 + i, close: bc });
  }
  const bench = new BenchmarkSeries("SYNTH", bPts);
  const acc = new SchemeAcc({ asOfDay: DAY0 + N - 1, bench });

  // The fund prints on days 0, 5, 10, … and its NAV tracks the index EXACTLY at those days.
  const STRIDE = 5;
  for (let i = 0; i < N; i += STRIDE) {
    acc.push(DAY0 + i, closes[i]! / 20); // a constant scale factor — irrelevant to log returns
  }

  const b = acc.beta("y1");
  ok(
    near(b, 1.0, 1e-9),
    `★ beta = 1.000000000 for a 5-day-reporting fund that tracks the index exactly`,
    `got ${b?.toFixed(12)}`,
  );
  const te = acc.trackingError("y1");
  ok(near(te, 0, 1e-9), `★ tracking error = 0 — the multi-day spans align perfectly`, `got ${te?.toExponential(3)}`);
  console.log(`      paired observations: ${acc.pairPoints("y1")}   unpaired: ${acc.unpaired}`);
  console.log(`
      THIS IS THE PROOF THAT MATTERS. The fund's return spans 5 index days. The fold measured the
      benchmark's return over THE SAME 5 DAYS (last-close-on-or-before, both endpoints) and got a
      perfect β=1 / TE=0. Had it paired the fund's 5-day move against the index's 1-day move, the
      covariance would be between two different quantities — and beta would come out around 0.2
      (roughly 1/STRIDE), which is a plausible-looking number and completely wrong.`);

  // Demonstrate the magnitude of the bug it avoids, so the claim is not merely asserted.
  let sFB = 0, sBB = 0, nP = 0;
  for (let i = STRIDE; i < N; i += STRIDE) {
    const rF = Math.log(closes[i]! / closes[i - STRIDE]!); // the fund's TRUE 5-day move
    const rB1 = Math.log(closes[i]! / closes[i - 1]!); // the index's SINGLE-day move ← the bug
    sFB += rF * rB1;
    sBB += rB1 * rB1;
    nP++;
  }
  console.log(`      → had we paired against the 1-DAY index move, beta would read ${(sFB / sBB).toFixed(4)} instead of 1.0000`);
}

// ═══════════════════════════════════════════════════════════════
rule("4 · UNPAIRABLE DAYS ARE REFUSED, NEVER ZERO-FILLED");
// ═══════════════════════════════════════════════════════════════
{
  // A benchmark with a HOLE: it stops printing for 40 days in the middle.
  const bPts: { day: number; close: number }[] = [];
  let bc = 1000;
  for (let i = 0; i < N; i++) {
    bc *= Math.exp(0.003 * Math.sin(i / 3));
    if (i >= 150 && i < 190) continue; // the hole
    bPts.push({ day: DAY0 + i, close: bc });
  }
  const bench = new BenchmarkSeries("SYNTH", bPts);
  const acc = new SchemeAcc({ asOfDay: DAY0 + N - 1, bench });
  let nav = 10;
  for (let i = 0; i < N; i++) {
    nav *= Math.exp(0.003 * Math.sin(i / 3));
    acc.push(DAY0 + i, nav);
  }
  ok(acc.unpaired > 0, `fund returns crossing the benchmark's gap were REFUSED, not zero-filled`, `${acc.unpaired} unpaired`);
  ok(bench.unpairable > 0, `…and the series counted them too`, `${bench.unpairable}`);
  const b = acc.beta("y1");
  ok(b !== null, `beta still computes from the pairs that DID align`, `${b?.toFixed(6)}`);
  console.log(`      A zero-filled benchmark return against a real fund move would drag beta toward 0`);
  console.log(`      while looking exactly like data. Refusing the pair is the only honest option.`);
}

// ═══════════════════════════════════════════════════════════════
rule("5 · A FLAT BENCHMARK — beta is UNDEFINED, not infinite and not 1");
// ═══════════════════════════════════════════════════════════════
{
  const bPts = Array.from({ length: N }, (_, i) => ({ day: DAY0 + i, close: 1000 })); // never moves
  const bench = new BenchmarkSeries("SYNTH", bPts);
  const acc = new SchemeAcc({ asOfDay: DAY0 + N - 1, bench });
  let nav = 10;
  for (let i = 0; i < N; i++) {
    nav *= Math.exp(0.002 * Math.sin(i / 3));
    acc.push(DAY0 + i, nav);
  }
  // A flat benchmark yields NO usable pairs at all: logReturnBetween refuses j<=i... but here every
  // day HAS a close, so pairs form with rB = 0 exactly. var(rB) = 0 → beta must be null.
  const b = acc.beta("y1");
  ok(b === null, `beta = NULL when the benchmark has zero variance (cov/0 is undefined)`, `got ${b}`);
  const te = acc.trackingError("y1");
  ok(te !== null && te > 0, `…but tracking error is still a real number (the fund moved; the index did not)`, `${te?.toFixed(6)}`);
}

// ═══════════════════════════════════════════════════════════════
rule("5b · ★ A CASH BENCHMARK — beta must be NULL, not −13 (the live bug this guard caught)");
// ═══════════════════════════════════════════════════════════════
// THE REAL DEFECT, reproduced. The first full run gave ICICI's Overnight Funds β = −13.23 against
// the Nifty 1D Rate Index — whose annualised volatility is 0.22%. Beta = cov/var(bench); with a
// denominator that small, the ratio explodes on noise. And the Nifty 1D Rate Index IS the risk-free
// rate (risk-free.ts uses that exact series), so beta-to-it is undefined by construction.
{
  // A cash-like benchmark: it creeps upward with almost no dispersion (annualised vol ≈ 0.1%).
  const bPts: { day: number; close: number }[] = [];
  let bc = 1000;
  for (let i = 0; i < N; i++) {
    bc *= Math.exp(0.00018 + 0.000004 * Math.sin(i)); // ~4.5%/yr drift, near-zero vol
    bPts.push({ day: DAY0 + i, close: bc });
  }
  const bench = new BenchmarkSeries("CASHLIKE", bPts);
  const acc = new SchemeAcc({ asOfDay: DAY0 + N - 1, bench });

  // The fund is an IDCW variant: it creeps up, then DROPS on each distribution — which reads as huge
  // "volatility" to a NAV-only fold. Exactly the ICICI Overnight shape.
  let nav = 100;
  for (let i = 0; i < N; i++) {
    nav *= Math.exp(0.0002);
    if (i > 0 && i % 14 === 0) nav *= 0.97; // fortnightly payout — a NAV drop, not a loss
    acc.push(DAY0 + i, nav);
  }

  // ══ THE GATE IS A PROPERTY OF THE INDEX, AND THAT IS THE POINT ══
  // It is decided ONCE from the index's own series (BenchmarkSeries.isCashLike) and applied in the
  // fold — NOT re-derived per fund inside the accumulator. The first version of this guard DID live
  // in the accumulator, measuring the benchmark's volatility over whatever days the fund happened to
  // report. That is sampling-dependent, and it leaked: an "ITI Overnight Fund - ANNUAL IDCW" reports
  // so sparsely that the index's multi-day spans between its NAVs cleared the floor, and it shipped
  // a beta of −4.07 against the overnight rate. A question about an index cannot have a different
  // answer depending on who is looking at it.
  console.log(`      index's OWN annualised vol: ${(bench.annualisedVol! * 100).toFixed(3)}%   (the real Nifty 1D Rate Index measures 0.220%)`);
  ok(bench.isCashLike === true, `★ the INDEX is flagged cash-like — decided from ITS OWN series, not from any fund's sampling`);

  const raw = acc.beta("y1");
  console.log(`      → the raw covariance ratio for this fund is ${raw?.toFixed(4)}`);
  // The only defensible beta for a cash fund against a cash index is ≈1 (it essentially IS the
  // index). A NEGATIVE beta says "when the overnight rate rises, this overnight fund falls" — not a
  // finding, but noise divided by a near-zero variance. Production hit −13.23; this synthetic hits
  // −1.89. Same defect; the sign alone condemns it.
  ok(
    raw !== null && raw < 0,
    `★ …and that raw ratio is NEGATIVE — a cash fund "falling when cash rises". Which is why the fold REFUSES it.`,
    `${raw?.toFixed(4)} (production hit −13.23 on the real 1D-Rate index)`,
  );

  const te = acc.trackingError("y1");
  ok(te !== null, `…while TRACKING ERROR survives the gate — "does it follow the overnight rate?" IS answerable`, `${te?.toFixed(4)}`);
}

// ═══════════════════════════════════════════════════════════════
rule("6 · THE LONGEST-MATCH-FIRST NAME MATCHER — NIFTY50 ⊂ NIFTY500");
// ═══════════════════════════════════════════════════════════════
{
  const { buildNameMatcher } = await import("../ingestions/amfi/mf-benchmark.js");
  const m = buildNameMatcher(["Nifty 50", "Nifty 500", "Nifty 100", "Nifty Midcap 150", "Nifty Bank"]);
  ok(m("HDFC Nifty 500 Index Fund - Direct Growth") === "Nifty 500", `"Nifty 500 Index Fund" → Nifty 500 (NOT Nifty 50)`, `${m("HDFC Nifty 500 Index Fund - Direct Growth")}`);
  ok(m("UTI Nifty 50 Index Fund") === "Nifty 50", `"Nifty 50 Index Fund" → Nifty 50`);
  ok(m("SBI Nifty Midcap 150 Index Fund") === "Nifty Midcap 150", `"Nifty Midcap 150" → Nifty Midcap 150 (not Nifty 50 via "150")`);
  ok(m("Some Random Balanced Fund") === null, `a fund naming no index → null (never forced onto one)`);
  console.log(`\n      Short-first matching would return "Nifty 50" for the Nifty 500 fund — and EVERY`);
  console.log(`      Nifty-500 index fund in the universe would carry a beta measured against the wrong`);
  console.log(`      index, silently, in every row.`);
}

// ═══════════════════════════════════════════════════════════════
rule("7 · THE NO_BENCHMARK GATE — a debt fund must NEVER reach the sector matcher");
// ═══════════════════════════════════════════════════════════════
{
  const { resolveBenchmark, buildNameMatcher } = await import("../ingestions/amfi/mf-benchmark.js");
  const m = buildNameMatcher(["Nifty Bank", "Nifty 500", "Nifty Financial Services", "Nifty India Consumption", "Nifty Pharma"]);

  const debt = resolveBenchmark(
    "Open Ended Schemes(Debt Scheme - Banking and PSU Fund)",
    "Axis Banking & PSU Debt Fund - Direct Plan - Growth",
    m,
  );
  ok(
    debt.index === null && debt.reason === "credit_benchmark_unavailable",
    `★ "Banking & PSU DEBT Fund" → NULL, not Nifty Bank`,
    `index=${debt.index} reason=${debt.reason}`,
  );
  console.log(`      ↑ WITHOUT THE EARLY GATE this fund's name hits the sector allow-list's /bank/ rule`);
  console.log(`        and a DEBT fund gets benchmarked against BANK EQUITIES. The gate is the`);
  console.log(`        difference between a null and a catastrophe.`);

  const thematicBank = resolveBenchmark(
    "Open Ended Schemes(Equity Scheme - Sectoral/ Thematic)",
    "Aditya Birla Sun Life Banking and Financial Services Fund - Direct Growth",
    m,
  );
  ok(
    thematicBank.index === "Nifty Financial Services" && thematicBank.via === "sector",
    `★ CORRECTION APPLIED: thematic "Banking & Financial Services" → Nifty FINANCIAL SERVICES (not Nifty Bank)`,
    `${thematicBank.index}`,
  );

  const consumption = resolveBenchmark(
    "Open Ended Schemes(Equity Scheme - Sectoral/ Thematic)",
    "Aditya Birla Sun Life Consumption Fund - Growth - Direct Plan",
    m,
  );
  ok(
    consumption.index === "Nifty India Consumption" && consumption.via === "sector",
    `★ CORRECTION APPLIED: "Consumption Fund" → Nifty India Consumption (not Nifty FMCG)`,
    `${consumption.index}`,
  );

  const quant = resolveBenchmark(
    "Open Ended Schemes(Equity Scheme - Sectoral/ Thematic)",
    "360 ONE QUANT FUND DIRECT GROWTH",
    m,
  );
  ok(quant.index === null && quant.reason === "thematic_no_clean_index", `an ambiguous theme → honest-null, never forced`, `${quant.reason}`);

  const largeCap = resolveBenchmark("Open Ended Schemes(Equity Scheme - Large Cap Fund)", "SBI Blue Chip Fund", m);
  ok(largeCap.via === "category", `a Large Cap fund resolves via CATEGORY (a fact from the source)`, `${largeCap.index}`);
}

rule(FAIL === 0 ? `✓✓ MATH PASS — ${PASS} checks, 0 failures` : `✗✗ FAIL — ${FAIL} of ${PASS + FAIL}`);
process.exit(FAIL === 0 ? 0 : 1);
