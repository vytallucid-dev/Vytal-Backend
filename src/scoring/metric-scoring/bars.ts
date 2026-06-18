// File: src/scoring/metric-scoring/bars.ts
//
// PRODUCTION bar loader (handoff §5): reads the in-force MetricBarSet for a
// (barPath=PG, metric) from score_metric_bar_sets and returns it for the L1 lens.
// Phase 6 lands the real per-PG bars (loaded by bars-loader/), so this no longer
// returns null — it returns the real bars, resolving PG6→PG5 inheritance.
//
// INHERITANCE (handoff §3): an inheriting PG (PG6) has NO own bar-set rows; it
// references the parent's (PG5). So a lookup for an inheriting bar path is
// redirected to the parent before querying. (Peer-stats are NEVER inherited —
// that is handled elsewhere; this redirect is bar-set-scoped only.)
//
// UNIT (handoff §8): the bar-set's unit is the engine-authoritative unit for the
// metric key (the loader proved at ingest that the stored bars agree with it).
// We surface it so the unit-match guard can run at the scoring point.
//
// SSCU (handoff §7): the optional 3-anchor override is carried in the bar set's
// provenance evidence (the hot 5-threshold table is locked to 5 columns); we
// surface it when present.

import { prisma } from "../../db/prisma.js";
import type { BarDirection } from "../lenses/types.js";
import type { MetricBarSetInput } from "./types.js";
import { expectedUnit } from "../bars-loader/label-map.js";

/** Bar-path inheritance (handoff §3). Derived from vytal_pg_bars.json's
 *  `inheritsBarsFrom`: PG6 (PSU Banks) inherits PG5 (Private Banks). Bar-set
 *  scoped ONLY — never extends to peer-stats. */
export const BAR_PATH_INHERITANCE: Record<string, string> = { PG6: "PG5" };

/** Resolve an effective bar path, following a single inheritance hop. */
export const resolveBarPath = (barPath: string): string =>
  BAR_PATH_INHERITANCE[barPath] ?? barPath;

/** Resolve the bar set in force at `asOf` for (barPath, metricKey). null if none.
 *  Follows PG6→PG5 inheritance. Surfaces unit (registry) + sscu (provenance). */
export async function loadBarSet(
  barPath: string,
  metricKey: string,
  asOf: Date,
): Promise<MetricBarSetInput | null> {
  const effectivePath = resolveBarPath(barPath);
  const row = await prisma.metricBarSet.findFirst({
    where: { barPath: effectivePath, metricKey, inForceFrom: { lte: asOf } },
    orderBy: { inForceFrom: "desc" },
    include: { provenance: true },
  });
  if (!row) return null;

  // SSCU override (if any) rides in provenance.evidence.perMetric, keyed by
  // `${barPath}|${metricKey}` (the hot 5-threshold table is locked to 5 columns).
  let sscu: MetricBarSetInput["sscu"] = null;
  const evidence = row.provenance?.evidence as
    | { perMetric?: Record<string, { sscu?: MetricBarSetInput["sscu"] }> }
    | null
    | undefined;
  const pm = evidence?.perMetric?.[`${effectivePath}|${metricKey}`];
  if (pm && pm.sscu) sscu = pm.sscu;

  // The bar-set unit is the engine-authoritative unit for the key (loader-proven).
  let unit: MetricBarSetInput["unit"] | undefined;
  try { unit = expectedUnit(metricKey); } catch { unit = undefined; }

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
    note: `score_metric_bar_sets v${row.version} (real CN-4 bars${effectivePath !== barPath ? `, inherited ${barPath}→${effectivePath}` : ""})`,
    illustrative: false,
    barPath,
    resolvedFromBarPath: effectivePath,
    metricBarSetId: row.id,
    unit,
    sscu,
  };
}
