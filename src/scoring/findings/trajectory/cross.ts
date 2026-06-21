// File: src/scoring/findings/trajectory/cross.ts
//
// Shared trajectory primitives for the band/zone-cross rules (B Deterioration, D Recovery)
// and the spread/composition rules. PURE (operates on number series).
//
// "RECENT SUSTAINED CROSS" — the structural shape File 1's B/D need: a band edge crossed,
// the new state SUSTAINED ≥ minRun snapshots (so a one-snapshot blip doesn't fire — the
// persistence IS the guard, no exceptional-item guard needed here since these read the
// already-computed composite/bands, not raw distortable metrics), AND the cross is RECENT
// (File 1 B/D are EARLY regime changes — once a state has held many snapshots it is the new
// normal, not "deteriorating/recovering"). "Recent" = the new-zone run length ≤ recentMax.
//
// CONSECUTIVE = consecutive AVAILABLE snapshots (a missing period isn't evidence of
// non-deterioration). The backfilled series currently have ZERO period gaps, so this is
// equivalent to consecutive periods today — but the run walks the available series, so a
// future gap won't silently break a sustain.

// Sustained-N + recent-window for B/D (File 1 doesn't lock a window — these are the
// "recent sustained regime change" interpretation; FLAG). minRun=2 = File 1's "sustained
// ≥2 snapshots"; recentMax=4 keeps it an EARLY change (excludes ancient crosses in the deep
// series; for the common 5-point series almost any visible cross qualifies).
export const MIN_SUSTAIN = 2;
export const RECENT_MAX_RUN = 4;

export type CrossDir = "down" | "up";

export interface RecentCross {
  fired: boolean;
  runLen: number;            // length of the trailing in-new-zone run (incl. current)
  crossFromValue: number | null; // the pre-cross value (the snapshot just before the run)
  crossFromIndex: number;    // index of that pre-cross snapshot (−1 if none)
}

/**
 * Detect a recent sustained cross of `boundary` in `dir`, over `values` (oldest→newest,
 * current = last). A null value breaks the run (unavailable pillar). For dir "down" the new
 * zone is value < boundary; for "up" it is value ≥ boundary.
 */
export function detectRecentSustainedCross(
  values: (number | null)[],
  boundary: number,
  dir: CrossDir,
  opts: { minRun: number; recentMax: number },
): RecentCross {
  const inZone = (v: number) => (dir === "down" ? v < boundary : v >= boundary);
  let i = values.length - 1;
  let run = 0;
  while (i >= 0 && values[i] !== null && inZone(values[i] as number)) { run++; i--; }
  // i now points at the first snapshot NOT in the new zone (the pre-cross), or −1/at a null.
  if (run < opts.minRun || run > opts.recentMax) return { fired: false, runLen: run, crossFromValue: null, crossFromIndex: -1 };
  if (i < 0 || values[i] === null) return { fired: false, runLen: run, crossFromValue: null, crossFromIndex: -1 }; // no genuine pre-cross snapshot
  const from = values[i] as number;
  // For "down": pre-cross must be ≥ boundary (it is, by loop exit). For "up": pre-cross < boundary.
  return { fired: true, runLen: run, crossFromValue: from, crossFromIndex: i };
}

/** Min and max of the SCORED pillar subtotals at a point (spread = max − min). null if <2 scored. */
export function pillarSpread(p: { foundation: number | null; momentum: number | null; market: number | null; ownership: number | null }): { spread: number; max: number; min: number; maxPillar: string; minPillar: string } | null {
  const entries: { pillar: string; v: number }[] = [];
  if (p.foundation !== null) entries.push({ pillar: "foundation", v: p.foundation });
  if (p.momentum !== null) entries.push({ pillar: "momentum", v: p.momentum });
  if (p.market !== null) entries.push({ pillar: "market", v: p.market });
  if (p.ownership !== null) entries.push({ pillar: "ownership", v: p.ownership });
  if (entries.length < 2) return null;
  let max = entries[0], min = entries[0];
  for (const e of entries) { if (e.v > max.v) max = e; if (e.v < min.v) min = e; }
  return { spread: max.v - min.v, max: max.v, min: min.v, maxPillar: max.pillar, minPillar: min.pillar };
}
