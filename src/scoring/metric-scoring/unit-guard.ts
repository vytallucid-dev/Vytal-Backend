// File: src/scoring/metric-scoring/unit-guard.ts
//
// THE UNIT-MATCH ASSERTION (handoff §8 — "the single most dangerous
// silent-corruption path").
//
// At the point where a LIVE computed metric value is scored against its bar-set,
// the live value's unit MUST match the unit the bars are expressed in. A ratio-
// scale live value (e.g. Cash Conversion = 1.14) scored against percent-scale
// bars — or the reverse — produces a plausible-but-wrong L1 with NO error. This
// guard makes that impossible: on a mismatch it THROWS, naming the metric, the
// live unit, and the bar unit. It NEVER scores on a mismatch.
//
// The BAR-SET unit is taken from the engine canonical registry (label-map.ts):
// the loader has already HARD-VALIDATED at ingest time that the JSON's declared
// unit equals the registry unit for each metric (see load-vytal-bars.ts §3), so
// the registry is the single, proven authority for "what scale are this metric's
// bars in". (Concretely: F3 Cash Conversion / F8 FCF-PAT bars are RATIO, so the
// engine's live computation of those must produce ratio values — asserted here.)

import { expectedUnit, type EngineUnit } from "../bars-loader/label-map.js";

/** The engine's live metric units (mirror of MetricUnit in scoring/metrics). */
export type LiveUnit = "%" | "ratio" | "x" | "days" | "years" | "n/a";

export class UnitMismatchError extends Error {
  readonly metricKey: string;
  readonly liveUnit: string;
  readonly barUnit: string;
  constructor(metricKey: string, liveUnit: string, barUnit: string) {
    super(
      `UNIT MISMATCH for metric "${metricKey}": live value is in "${liveUnit}" but the bar-set is in "${barUnit}". ` +
        `Refusing to score (handoff §8 — scoring across a unit mismatch silently corrupts L1).`,
    );
    this.name = "UnitMismatchError";
    this.metricKey = metricKey;
    this.liveUnit = liveUnit;
    this.barUnit = barUnit;
  }
}

/**
 * Assert the live value's unit matches the bar-set unit. THROWS UnitMismatchError
 * on a mismatch (does NOT score). `barUnit` defaults to the registry-authoritative
 * unit for the metric key. Returns the resolved bar unit on success.
 */
export function assertUnitMatch(
  metricKey: string,
  liveUnit: LiveUnit,
  barUnit?: EngineUnit,
): EngineUnit {
  const expected = barUnit ?? expectedUnit(metricKey);
  if ((liveUnit as string) !== (expected as string)) {
    throw new UnitMismatchError(metricKey, liveUnit, expected);
  }
  return expected;
}

/** Non-throwing form (for diagnostics / reporting): true iff units align. */
export function unitsMatch(metricKey: string, liveUnit: LiveUnit, barUnit?: EngineUnit): boolean {
  try {
    assertUnitMatch(metricKey, liveUnit, barUnit);
    return true;
  } catch {
    return false;
  }
}
