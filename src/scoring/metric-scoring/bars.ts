// File: src/scoring/metric-scoring/bars.ts
//
// PRODUCTION bar loader: reads the in-force MetricBarSet for a (barPath=PG, metric)
// from score_metric_bar_sets. Real per-PG bars do not exist yet (Phase 6 derives
// them, CN-4), so this returns null today — the verification harness falls back to
// the clearly-marked ILLUSTRATIVE fixture (illustrative-bars.ts). When Phase 6
// lands, the wiring switches to this loader with NO other change.

import { prisma } from "../../db/prisma.js";
import type { BarDirection } from "../lenses/types.js";
import type { MetricBarSetInput } from "./types.js";

/** Resolve the bar set in force at `asOf` for (barPath, metricKey). null if none. */
export async function loadBarSet(
  barPath: string,
  metricKey: string,
  asOf: Date,
): Promise<MetricBarSetInput | null> {
  const row = await prisma.metricBarSet.findFirst({
    where: { barPath, metricKey, inForceFrom: { lte: asOf } },
    orderBy: { inForceFrom: "desc" },
  });
  if (!row) return null;
  return {
    metricKey,
    direction: row.direction as BarDirection,
    bars: {
      excellent: row.excellent.toNumber(),
      good: row.good.toNumber(),
      acceptable: row.acceptable.toNumber(),
      concerning: row.concerning.toNumber(),
      distress: row.distress.toNumber(),
    },
    note: `score_metric_bar_sets v${row.version} (real CN-4 bars)`,
    illustrative: false,
    barPath,
    metricBarSetId: row.id,
  };
}
