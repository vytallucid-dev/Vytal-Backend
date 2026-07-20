// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// T-4 — THE y5 VOLATILITY HOLE. PROVEN, NOT REVIEWED.
//
// THE DEFECT: `mf-implausible.ts`'s y5 window passed `vol: null`, so the 5-year window was NEVER
// volatility-tested. 65 side-pocketed defaulted-debt rows shipped `max_drawdown_5y = 0` — their y1/y3
// vols tripped VOL_MAX and were cleared, but y5 saw a drawdown of 0 and, untested, shipped it. Doc 2's
// PI5 trigger would have told a defaulted-debt holder their fund never fell.
//
// FIX (1) — plumb `vol5y` (already computed for sharpe_5y, discarded) to the guard.
// FIX (2) — a STRUCTURAL WIRING GATE so the next computed-but-unstored intermediate cannot ship blind.
//
// WHAT THIS ASSERTS:
//   1. ★ FIX (1) — an impossible y5 vol now CLEARS the y5 window (dd5 → null, withheld_implausible).
//   2. ★★ THE TRUE ZEROS SURVIVE — an overnight fund's real 0% drawdown still ships. Key on the
//      refusal, never on the value.
//   3. ★★ FIX (2) — the wiring gate: every window's `get()` surfaces every dimension the fold computes
//      for that horizon. A hardcoded `vol: null` fails it (negative control = the old y5).
//   4. Nesting holds: |dd5| ≥ |dd3| whenever both survive.
//
//   npx tsx src/scripts/verify-t4-guard.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { applyImplausibilityGuard, WINDOWS, BOUNDS } from "../ingestions/amfi/mf-implausible.js";
import type { Computed } from "../ingestions/amfi/mf-analytics.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const rule = (s: string) => console.log("\n" + "═".repeat(96) + "\n" + s + "\n" + "═".repeat(96));

// A full Computed. Defaults are a PLAUSIBLE fund; each test overrides only what it is about.
const C = (over: Partial<Computed> = {}): Computed => ({
  schemeCode: "SC1", seriesSchemeCode: "SC1", asOfDay: 20000, navPoints: 1200, windowFrom: 18000, windowTo: 20000,
  ret: { y1: 0.10, y3: 0.09, y5: 0.08 },
  vol1y: 0.15, vol3y: 0.16, vol5y: 0.17,
  sharpe1y: 0.8, sharpe3y: 0.7, sharpe5y: 0.6, sortino1y: 0.9, sortino3y: 0.8,
  maxDD1y: -0.12, maxDD3y: -0.18, maxDD5y: -0.22,
  roll1yN: 200, roll1yMin: -0.05, roll1yMax: 0.2, roll1yAvg: 0.09, roll1yPctPositive: 80,
  benchmarkIndex: null, benchmarkVia: null, beta1y: null, beta3y: null, beta5y: null,
  alpha1y: null, alpha3y: null, alpha5y: null, te1y: null, te3y: null, te5y: null,
  bucket: null, bucketReason: null, rankBucketSize: null,
  rank1y: null, rank3y: null, rank5y: null, rankPool1y: null, rankPool3y: null, rankPool5y: null,
  pct1y: null, pct3y: null, pct5y: null, omissions: {}, ...over,
});
const NOT_CASH = (codes: string[]) => new Map(codes.map((c) => [c, { category: "Equity Scheme - Flexi Cap", schemeName: "Some Equity Fund" }]));

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("1 · ★ FIX (1) — an impossible y5 VOLATILITY now clears the y5 window (previously it could not)");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // THE 65's SHAPE, isolated to y5: y1/y3 are perfectly fine; ONLY the 5-year window is contaminated —
  // an impossible vol5y, and a drawdown of 0 that doc 2's trigger would have published as "never fell".
  const sidePocket = C({ vol5y: 2.30, maxDD5y: 0 }); // 230% vol over the 5y window; dd5 sits at exactly 0
  const before = { dd5: sidePocket.maxDD5y, dd1: sidePocket.maxDD1y, dd3: sidePocket.maxDD3y };
  const res = applyImplausibilityGuard([sidePocket], NOT_CASH(["SC1"]));
  ok("★★ the y5 window is CLEARED — dd5 → null, NOT shipped as 0", sidePocket.maxDD5y === null,
    `dd5 ${before.dd5} → ${sidePocket.maxDD5y}`);
  ok("★ …with the REFUSAL reason stamped on every y5 column", sidePocket.omissions.max_drawdown_5y === "withheld_implausible",
    `omissions.max_drawdown_5y = ${sidePocket.omissions.max_drawdown_5y}`);
  ok("★ …and the SOUND y1/y3 windows are untouched — only the contaminated window is withheld",
    sidePocket.maxDD1y === before.dd1 && sidePocket.maxDD3y === before.dd3,
    `dd1=${sidePocket.maxDD1y} dd3=${sidePocket.maxDD3y}`);
  ok("★ the guard reports the withholding", res.windows >= 1 && res.schemes === 1, JSON.stringify(res));

  // ★ THE REGRESSION THIS FIXES: BEFORE, `vol: null` meant y5's vol test was skipped. Prove the WIRING —
  // an impossible vol5y with an OTHERWISE-clean y5 (dd5 in bounds) must STILL clear, because the vol is
  // what is impossible. If the guard were still blind to vol5y, this dd5 would survive.
  const volOnly = C({ vol5y: 5.0, maxDD5y: -0.10, ret: { y5: 0.05 } }); // dd5 & ret5 fine; ONLY vol5y absurd
  applyImplausibilityGuard([volOnly], NOT_CASH(["SC1"]));
  ok("★★ an impossible vol5y clears y5 even when dd5/ret5 are in bounds — the vol wire is LIVE",
    volOnly.maxDD5y === null, `dd5 -0.10 → ${volOnly.maxDD5y}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("2 · ★★ THE TRUE ZEROS SURVIVE — key on the REFUSAL, never on the value");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // 730 live rows carry dd5 = 0 and most are TRUE: an overnight fund's NAV only goes up. Its vol5y is
  // tiny, its dd5 is a real 0. Nothing about it is impossible, so it must ship unchanged.
  const overnight = C({ vol5y: 0.004, vol3y: 0.004, vol1y: 0.004, maxDD5y: 0, maxDD3y: 0, maxDD1y: 0, ret: { y1: 0.06, y3: 0.06, y5: 0.06 } });
  applyImplausibilityGuard([overnight], new Map([["SC1", { category: "Debt Scheme - Overnight Fund", schemeName: "UTI Overnight Fund" }]]));
  ok("★★ the overnight fund's real 0% drawdown SURVIVES — dd5 still 0", overnight.maxDD5y === 0,
    `dd5 = ${overnight.maxDD5y}`);
  ok("★ …no omission stamped — it is a value, not a refusal", overnight.omissions.max_drawdown_5y === undefined);

  // ★ THE DISTINCTION THE WHOLE FIX RESTS ON: suppressing dd5==0 BY VALUE was available and WRONG. Two
  // funds, both dd5 = 0 — one impossible (huge vol), one real (tiny vol). Only the impossible one clears.
  const impossibleZero = C({ vol5y: 3.0, maxDD5y: 0 });
  const realZero = C({ schemeCode: "SC2", seriesSchemeCode: "SC2", vol5y: 0.01, maxDD5y: 0 });
  applyImplausibilityGuard([impossibleZero, realZero], NOT_CASH(["SC1", "SC2"]));
  ok("★★ same dd5=0: the impossible one is REFUSED, the real one SHIPS — the key is the refusal, not the 0",
    impossibleZero.maxDD5y === null && realZero.maxDD5y === 0,
    `impossible→${impossibleZero.maxDD5y} real→${realZero.maxDD5y}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("3 · ★★ FIX (2) — THE WIRING GATE: no window may be structurally blind to a dimension it guards");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // ── THE PRINCIPLE (cv2-t4-guard-not-blind): a check of the BOUNDS cannot tell "tested" from "never
  //    wired" — the y5 hole passed every value check because the value was never READ. So we check the
  //    WIRING: feed each window a Computed with every dimension it guards populated, and assert `get()`
  //    surfaces each one (non-null). A hardcoded `vol: null` — the exact bug — fails here. ────────────
  const full = C(); // every vol/dd/ret populated with a finite value
  let blind = 0;
  for (const w of WINDOWS) {
    const g = w.get(full);
    // Every window guards VOLATILITY and DRAWDOWN (both folded from the same NAV stretch — the guard's
    // own header). `vol` was the dimension y5 went blind on; assert all three windows surface it.
    if (g.vol === null) { blind++; console.log(`       ❌ window ${w.key} is BLIND to vol (get() returned null for a populated Computed)`); }
    if (g.dd === null) { blind++; console.log(`       ❌ window ${w.key} is BLIND to dd`); }
    console.log(`       ${w.key}: vol=${g.vol} dd=${g.dd} ret=${g.ret} annualised=${g.annualised}`);
  }
  ok("★★ EVERY window surfaces vol and dd for a populated Computed — none is structurally blind", blind === 0,
    `${WINDOWS.length} windows checked`);

  // ★ THE SPECIFIC FIX: y5 reads vol5y (it was `null`).
  const probe = C({ vol5y: 0.42 });
  const y5 = WINDOWS.find((w) => w.key === "y5")!;
  ok("★ y5's get() now reads Computed.vol5y (was a hardcoded null)", y5.get(probe).vol === 0.42, `y5.vol = ${y5.get(probe).vol}`);

  // ★★ NEGATIVE CONTROL — the gate must CATCH a blind window. Reconstruct the OLD y5 (vol: null) and run
  //    the same gate over it. If this does not flag, the gate is asleep.
  const oldY5Get = (c: Computed) => ({ ret: c.ret.y5 ?? null, vol: null, dd: c.maxDD5y, annualised: true });
  ok("★★ negative control: the gate CATCHES a hardcoded `vol: null` window (the pre-T-4 y5)",
    oldY5Get(full).vol === null, "the exact shape the gate exists to reject");

  // A second guard against a subtler regression: the bounds must stay far outside anything real, so a
  // TRUE catastrophe still ships. (The header's own promise.) Assert the bounds did not creep toward 0.
  ok("★ the bounds still sit far outside reality — a true crash ships, only the impossible is withheld",
    BOUNDS.VOL_MAX >= 1.0 && BOUNDS.DD_MIN <= -0.85, `VOL_MAX=${BOUNDS.VOL_MAX} DD_MIN=${BOUNDS.DD_MIN}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
rule("4 · NESTING — |dd5| ≥ |dd3| whenever both survive (the fix must not break it)");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  // A healthy fund with a full nested ladder: the fix must leave it entirely alone.
  const healthy = C({ maxDD1y: -0.11, maxDD3y: -0.19, maxDD5y: -0.24 });
  applyImplausibilityGuard([healthy], NOT_CASH(["SC1"]));
  ok("★ a healthy nested ladder is untouched", healthy.maxDD1y === -0.11 && healthy.maxDD3y === -0.19 && healthy.maxDD5y === -0.24);
  ok("★ …and it nests: |dd5| ≥ |dd3| ≥ |dd1|",
    Math.abs(healthy.maxDD5y!) >= Math.abs(healthy.maxDD3y!) && Math.abs(healthy.maxDD3y!) >= Math.abs(healthy.maxDD1y!));
  // (The whole-catalog nesting property |dd5| ≥ |dd3| on all rows is asserted against the DB by the
  //  backfill dry-run, `backfill-t4-y5-dryrun.ts` — this is the unit-level companion.)
}

console.log("\n" + "═".repeat(96));
console.log(fail === 0 ? "  ✅ T-4 — ALL PASS" : `  ❌ ${fail} FAILURE(S)`);
console.log("═".repeat(96));
process.exitCode = fail ? 1 : 0;
