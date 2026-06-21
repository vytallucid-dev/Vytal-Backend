// File: src/scoring/findings/rules/p11-margin-compression.ts
//
// P11 — Quarterly Margin Compression (File 1 §5E · pattern · Red −8).
// Trigger: operating margin compressing for N quarters, ending most recent.
// Locked display copy (File 1, VERBATIM):
//   "Operating margin has been compressing for [N] quarters: [OPM₁] → [OPM₂] → … → [OPM latest]."
//
// N is NOT locked by File 1. The ingested standalone quarterly OPM history is shallow
// (≈FY25Q4–FY26Q4 for most names) and the deepest clean trailing compression universe-
// wide is 2 consecutive QoQ declines (e.g. ITC 30.8→29.1→28.0). MIN_DECLINES=2 ⇒ ≥3 OPM
// points shown, which also matches the spec's printed minimum "[OPM₁] → [OPM₂] → …".
// FLAG: confirm N with File 1; raise to 3 once deeper OPM history is ingested.

import type { FireRule, QuarterlyOpmPoint } from "../types.js";
import { latestQuarterDistorted } from "../guards/exceptional-opm.js";

export const P11_MIN_DECLINES = 2;
export const P11_MAGNITUDE = -8; // §5E Red

export const ruleP11: FireRule = (ctx) => {
  const series = ctx.quarterlyOpm;
  if (!series || series.length < P11_MIN_DECLINES + 1) return null;

  // GUARD-REUSE (Stage B): if the LATEST quarter's OPM is an exceptional-item distortion
  // (sign-flipped negative from a positive baseline — the PBT-derived operating proxy
  // absorbed a one-off charge), the "currently compressing" claim is unsound → suppress.
  // This is OPTION (b): suppress when the trailing decline terminates in a guard-flagged
  // quarter — chosen over (a) exclude-and-continue, which would yield a stale "compressing
  // through <2 quarters ago>" claim that misrepresents the current (collapsed) quarter.
  // Verified: drops DRREDDY (−21.4) & HCLTECH (−23.5); keeps ITC/TECHM/TORNTPHARM.
  if (latestQuarterDistorted(series)) return null;

  // Maximal trailing strictly-decreasing run ending at the latest quarter.
  const run: QuarterlyOpmPoint[] = [series[series.length - 1]];
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i].opm < series[i - 1].opm) run.unshift(series[i - 1]);
    else break;
  }
  const declines = run.length - 1;
  if (declines < P11_MIN_DECLINES) return null;

  const opmStr = run.map((p) => p.opm.toFixed(1)).join(" → ");
  return {
    kind: "pattern",
    key: "momentum_P11_margin_compression", // canonical key (lib/finding-names.ts convention)
    severity: "red", // §5E
    direction: "negative",
    magnitude: P11_MAGNITUDE,
    displayState: "active",
    evidence: {
      pattern: "P11",
      name: "Quarterly Margin Compression",
      quartersOfDecline: declines,
      opmSeries: run.map((p) => ({ periodKey: p.periodKey, opm: Math.round(p.opm * 100) / 100 })),
      // File 1's locked copy, fully realized with the real series — the UI renders this verbatim.
      verbatim: `Operating margin has been compressing for ${declines} quarters: ${opmStr}.`,
    },
    metricRefs: ["operatingMargin"],
  };
};
