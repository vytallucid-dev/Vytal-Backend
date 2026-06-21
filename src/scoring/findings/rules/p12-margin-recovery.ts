// File: src/scoring/findings/rules/p12-margin-recovery.ts
//
// P12 — Quarterly Margin Recovery (File 1 §5E · pattern · Green +5 · Momentum). The MIRROR
// of P11. Locked verbatim copy (File 1):
//   "Operating margin recovering from trough: [OPM trough] → [OPM next] → [OPM latest]."
//
// Trigger: a trailing strictly-INCREASING OPM run ending at the latest quarter, ≥2 rises
// (mirror of P11's ≥2 declines). The run's first point is the trough.
//
// ── THE POSITIVE-EXCEPTIONAL PROBLEM (the hard part of this stage) ──────────────────────
// P11's guard catches a one-off CHARGE faking compression (a negative sign-flip — a clear
// fingerprint). The inverse — a one-off GAIN faking a recovery — has NO clean quarterly
// fingerprint: a gain inflates an already-positive OPM, crossing no boundary. Two guards
// are applied, each doing something REAL (no fabricated threshold, per §12):
//   GUARD 1 (reuse Stage-B exceptional-opm): the trough must not be a one-off-CHARGE quarter
//     — a "recovery" that is just a prior charge washing out is not an operating recovery.
//     Require the trough OPM ≥ 0 (a negative trough is the charge fingerprint / ambiguous).
//   GUARD 2 (reuse the engine's annual b1): suppress if the latest annual fires
//     b1-exceptional-GAIN — a one-off gain large enough to show in the year is inflating the
//     quarter. This is the genuine positive guard, at the grain where b1 fits.
// ⚠️ RESIDUAL GAP (FLAGGED, honestly): a one-off gain too small to flag the ANNUAL (b1
// needs >100% annual profit jump) but big enough to lift one quarter is NOT caught — no
// quarterly exceptional-item line exists to detect it. Acceptable for a Green +5 lean-in
// pattern (far lower-stakes than a red flag), but P12 may false-fire on such a quarter.

import { isDistortedOpm } from "../guards/exceptional-opm.js";
import { annualExceptionalLatest } from "../guards/annual-exceptional.js";
import type { FireRule, QuarterlyOpmPoint } from "../types.js";

export const P12_MIN_RISES = 2;

export const ruleP12: FireRule = (ctx) => {
  const series = ctx.quarterlyOpm;
  if (!series || series.length < P12_MIN_RISES + 1) return null;

  // Trailing strictly-INCREASING run ending at the latest quarter.
  const run: QuarterlyOpmPoint[] = [series[series.length - 1]];
  let startIdx = series.length - 1;
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i].opm > series[i - 1].opm) { run.unshift(series[i - 1]); startIdx = i - 1; }
    else break;
  }
  const rises = run.length - 1;
  if (rises < P12_MIN_RISES) return null;

  // GUARD 1: the trough must be a genuine (non-charge) low. A negative trough is the
  // exceptional-charge fingerprint (reuse the Stage-B guard) → recovery is the charge
  // washing out, not an operating recovery.
  if (run[0].opm < 0 || isDistortedOpm(series, startIdx)) return null;

  // GUARD 2: a latest-quarter one-off GAIN faking the recovery — caught at the annual grain.
  const guard = annualExceptionalLatest(ctx.annualFundamentals);
  if (guard.gain) return null;

  const opmStr = run.map((p) => p.opm.toFixed(1)).join(" → ");
  return {
    kind: "pattern",
    key: "momentum_P12_margin_recovery", // canonical key
    severity: "green", // §5E Green
    direction: "positive",
    magnitude: 5, // §5E +5
    displayState: "active",
    evidence: {
      pattern: "P12",
      name: "Quarterly Margin Recovery",
      quartersOfRecovery: rises,
      opmSeries: run.map((p) => ({ periodKey: p.periodKey, opm: Math.round(p.opm * 100) / 100 })),
      // File 1's locked copy, realized with the real series.
      verbatim: `Operating margin recovering from trough: ${opmStr}.`,
    },
    metricRefs: ["operatingMargin"],
  };
};
