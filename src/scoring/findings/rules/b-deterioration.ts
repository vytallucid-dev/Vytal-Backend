// File: src/scoring/findings/rules/b-deterioration.ts
//
// B — Deterioration from a high base (File 1 §5B · severity High). TRAJECTORY rule.
// Fire: composite crosses DOWN out of Healthy/Pristine, OR any pillar crosses DOWN below its
// strong mark, SUSTAINED ≥2 snapshots. SPECIAL COPY when composite crosses below 74 (out of
// Pristine) even while still in Healthy — the tests flagged "falling from the top".
//
// Sustained-≥2 is the structural guard (a one-snapshot dip can't fire — persistence filters
// noise; no exceptional-item guard needed, these read the computed composite/bands). Mask
// caveat (hot pond) is a READ-LAYER annotation, not applied here.

import { detectRecentSustainedCross, MIN_SUSTAIN, RECENT_MAX_RUN, type RecentCross } from "../trajectory/cross.js";
import { seriesWithCurrent, CALIBRATION_NOTE, type SeriesPoint } from "../trajectory/view.js";
import { NATIVE_ZONES } from "../thresholds.js";
import type { FireRule } from "../types.js";

const OPTS = { minRun: MIN_SUSTAIN, recentMax: RECENT_MAX_RUN };
const PILLARS = [
  { key: "foundation" as const, label: "Foundation", strong: NATIVE_ZONES.foundation.strong },
  { key: "momentum" as const, label: "Momentum", strong: NATIVE_ZONES.momentum.strong },
  { key: "market" as const, label: "Market", strong: NATIVE_ZONES.market.strong },
  { key: "ownership" as const, label: "Ownership", strong: NATIVE_ZONES.ownership.strong },
];
const bandStr = (series: SeriesPoint[]) => series.map((s) => `${s.periodKey}:${s.composite.toFixed(0)}/${s.labelBand}`);

export const ruleB: FireRule = (ctx) => {
  const series = seriesWithCurrent(ctx);
  if (series.length < MIN_SUSTAIN + 1) return null;
  const comps = series.map((s) => s.composite);
  const cur = comps[comps.length - 1];

  let variant: "out_of_healthy" | "out_of_pristine" | "pillar" | null = null;
  let fromVal = 0, special = false, leg = "composite", legLabel = "composite", c: RecentCross | null = null;

  const outHealthy = detectRecentSustainedCross(comps, 68, "down", OPTS); // below Healthy
  const outPristine = detectRecentSustainedCross(comps, 74, "down", OPTS); // below Pristine (special)
  if (outHealthy.fired) {
    variant = "out_of_healthy"; fromVal = outHealthy.crossFromValue!; special = fromVal >= 74; c = outHealthy;
  } else if (cur >= 68 && cur < 74 && outPristine.fired) {
    variant = "out_of_pristine"; fromVal = outPristine.crossFromValue!; special = true; c = outPristine;
  } else {
    for (const pl of PILLARS) {
      const vals = series.map((s) => s[pl.key]);
      const pc = detectRecentSustainedCross(vals, pl.strong, "down", OPTS);
      if (pc.fired) { variant = "pillar"; fromVal = pc.crossFromValue!; leg = pl.key; legLabel = pl.label; c = pc; break; }
    }
  }
  if (!variant || !c) return null;

  const verdict =
    variant === "pillar"
      ? `Sliding from a high base — ${legLabel} crossed below its strong mark (${fromVal.toFixed(0)} → ${(series[series.length - 1] as any)[leg]?.toFixed?.(0) ?? "—"}), sustained ${c.runLen} snapshots: an early risk-regime change.`
      : `Sliding from a high base — composite crossed down ${variant === "out_of_pristine" ? "below 74 (out of Pristine)" : "out of Healthy"} (from ${fromVal.toFixed(1)} to ${cur.toFixed(1)}), sustained ${c.runLen} snapshots — typically before price reacts.`;

  return {
    kind: "pattern",
    key: "trajectory_B_deterioration",
    severity: "high", // §5B
    direction: "negative",
    magnitude: null, // structural trajectory card (no §5E magnitude)
    displayState: "active",
    evidence: {
      card: "B", name: "Deterioration from a high base",
      variant, leg, special, crossFromComposite: variant === "pillar" ? null : Math.round(fromVal * 10) / 10,
      sustainedSnapshots: c.runLen,
      trajectory: bandStr(series),
      calibration: CALIBRATION_NOTE,
      verdict,
    },
    metricRefs: variant === "pillar" ? [leg] : ["composite"],
  };
};
