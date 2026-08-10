// File: src/scoring/read/ownership-tell.ts
//
// THE OWNERSHIP TELL — one classifier, one home.
//
// ★ THE TELL IS NOT A FINDING, AND THAT IS DELIBERATE. Ownership fires no findings on the tool
//   surface (family H reaches neither tool — see catalogue/tool-families.ts), so the tell is the
//   ownership tool's categorical dimension: what its landing ranks by, what its `patterns=` filter
//   narrows on, and what the single view labels the reading with. Of its six values exactly ONE has
//   a backing fired finding — `pledge_r1` ⇔ ownership_R1_pledge. The other five are an engine-
//   external reading of the OBSERVED holding split, which is why they live in the read layer and
//   never in scoring/findings.
//
// ★ WHY THIS FILE EXISTS. The classifier used to live inside stocks-list.service.ts, serving the
//   LANDING SCAN only, while the single view ran a second, weaker copy client-side (a whole-window
//   variant with a different epsilon and — the real defect — NO pledge branch at all, so it could
//   never return `pledge_r1` or `pledge_high`). Two classifiers meant the landing card and the stock
//   page could label the same stock differently. Moving the function here, unchanged, lets BOTH
//   reads call it: the scan (stocks-list.service.ts) and the per-stock series
//   (ownership-series.service.ts). The client copy is deleted.
//
// ⚠ THE SCAN'S BEHAVIOUR IS UNCHANGED. `ownershipTell` is the same function with the same
//   thresholds and the same tier order; only its address moved.

import type { OwnershipTell } from "./stocks-list.types.js";

export type { OwnershipTell };

export const PLEDGE_HIGH = 20; // % of promoter holding pledged → "high pledging" tell
export const INST_EPS = 1.5; // pp change in FII+DII over a period that counts as a real move

/**
 * The tell ranks by what's worth a look: R1 pledge breach > high pledging >
 * institutions distributing > accumulating > rotating > flat. Pledge is derived from
 * share counts (% of promoter holding); institutional flow from FII+DII deltas.
 */
export function ownershipTell(
  r1Fired: boolean,
  pledgePct: number | null,
  instDelta: number | null,
  fiiDelta: number | null,
  diiDelta: number | null,
): OwnershipTell {
  if (r1Fired) return "pledge_r1";
  if (pledgePct != null && pledgePct >= PLEDGE_HIGH) return "pledge_high";
  if (instDelta != null) {
    if (instDelta <= -INST_EPS) return "distribution";
    if (instDelta >= INST_EPS) return "accumulation";
    // net-flat institutional share but FII/DII moved opposite → a rotation
    if (
      fiiDelta != null &&
      diiDelta != null &&
      Math.abs(fiiDelta) >= INST_EPS &&
      Math.sign(fiiDelta) !== Math.sign(diiDelta)
    )
      return "rotation";
  }
  return "flat";
}

/** Landing-scan ranking order. Lives with the classifier so a new tell cannot be added
 *  without landing in the tier table. */
export const OWNERSHIP_TELL_TIER: Record<OwnershipTell, number> = {
  pledge_r1: 5,
  pledge_high: 4,
  distribution: 3,
  accumulation: 2,
  rotation: 1,
  flat: 0,
};

/**
 * The tell WHERE IT IS READABLE — the per-stock read's entry point.
 *
 * ★ THE ONE DIFFERENCE FROM `ownershipTell`, AND WHY. The scan only ever ranks stocks that have a
 *   scored snapshot and (in practice) a filing history, so "flat" there means "two filings, nothing
 *   moved". The single view is reachable for a stock with exactly ONE filing on record, and "flat"
 *   → "Steady" would then be a claim about a move nobody can see: there is no prior register to
 *   compare against. `null` is the honest answer, and the surface renders no tell chip rather than
 *   a fabricated calm one.
 *
 *   The pledge tiers are exempt because they ARE readable from a single filing — a pledge ratio is a
 *   level, not a delta. The tier order is not restated here; it is whatever `ownershipTell` says.
 */
export function ownershipTellOrNull(
  r1Fired: boolean,
  pledgePct: number | null,
  hasPriorFiling: boolean,
  instDelta: number | null,
  fiiDelta: number | null,
  diiDelta: number | null,
): OwnershipTell | null {
  const tell = ownershipTell(r1Fired, pledgePct, instDelta, fiiDelta, diiDelta);
  if (tell === "flat" && !hasPriorFiling) return null;
  return tell;
}
