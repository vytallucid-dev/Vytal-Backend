// File: src/scoring/findings/rules/d-recovery.ts
//
// D — Recovery from weakness (File 1 §5D · severity "Recovery" — the one lean-in card).
// TRAJECTORY rule. Fire: composite crosses UP out of Below-par/Fragile (≥62), OR any pillar
// crosses UP out of its weak zone, SUSTAINED ≥2 snapshots. Strongest case: Momentum rising
// toward a stronger Foundation (the laggard catching up). Sustained-≥2 is the structural
// guard. Mask caveat (hot pond) matters most here — but it is a READ-LAYER annotation.

import { detectRecentSustainedCross, MIN_SUSTAIN, RECENT_MAX_RUN, type RecentCross } from "../trajectory/cross.js";
import { seriesWithCurrent, CALIBRATION_NOTE, type SeriesPoint } from "../trajectory/view.js";
import { NATIVE_ZONES } from "../thresholds.js";
import type { FireRule } from "../types.js";

const OPTS = { minRun: MIN_SUSTAIN, recentMax: RECENT_MAX_RUN };
const PILLARS = [
  { key: "foundation" as const, label: "Foundation", weak: NATIVE_ZONES.foundation.weak },
  { key: "momentum" as const, label: "Momentum", weak: NATIVE_ZONES.momentum.weak },
  { key: "market" as const, label: "Market", weak: NATIVE_ZONES.market.weak },
  { key: "ownership" as const, label: "Ownership", weak: NATIVE_ZONES.ownership.weak },
];
const bandStr = (series: SeriesPoint[]) => series.map((s) => `${s.periodKey}:${s.composite.toFixed(0)}/${s.labelBand}`);

export const ruleD: FireRule = (ctx) => {
  const series = seriesWithCurrent(ctx);
  if (series.length < MIN_SUSTAIN + 1) return null;
  const comps = series.map((s) => s.composite);
  const cur = comps[comps.length - 1];

  let leg = "composite", legLabel = "composite", fromVal = 0, isPillar = false, c: RecentCross | null = null;
  const outBelowPar = detectRecentSustainedCross(comps, 62, "up", OPTS); // up out of Below-par/Fragile
  if (outBelowPar.fired) {
    fromVal = outBelowPar.crossFromValue!; c = outBelowPar;
  } else {
    for (const pl of PILLARS) {
      const vals = series.map((s) => s[pl.key]);
      const pc = detectRecentSustainedCross(vals, pl.weak, "up", OPTS);
      if (pc.fired) { isPillar = true; leg = pl.key; legLabel = pl.label; fromVal = pc.crossFromValue!; c = pc; break; }
    }
  }
  if (!c) return null;

  const curLeg = isPillar ? ((series[series.length - 1] as any)[leg] as number | null) : cur;
  const verdict = isPillar
    ? `Turning up out of weakness — ${legLabel} rose out of its weak zone (${fromVal.toFixed(0)} → ${curLeg?.toFixed(0) ?? "—"}), sustained ${c.runLen} snapshots.`
    : `Turning up out of weakness — composite crossed up out of Below-par (from ${fromVal.toFixed(1)} to ${cur.toFixed(1)}), sustained ${c.runLen} snapshots.`;

  return {
    kind: "pattern",
    key: "trajectory_D_recovery",
    severity: "recovery", // §5D (labelled "recovering," never green-as-buy)
    direction: "positive",
    magnitude: null,
    displayState: "active",
    evidence: {
      card: "D", name: "Recovery from weakness",
      leg, isPillar, crossFromComposite: isPillar ? null : Math.round(fromVal * 10) / 10,
      sustainedSnapshots: c.runLen,
      trajectory: bandStr(series),
      calibration: CALIBRATION_NOTE,
      verdict,
    },
    metricRefs: isPillar ? [leg] : ["composite"],
  };
};
