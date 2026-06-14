// File: src/scoring/pillars/weights.ts
//
// PURE intra-pillar weight resolution: renormalization of the PRESENT set to 100%
// + the §7.2 weight-cap redistribution. No DB, no ScoredMetric — just weights in,
// weights out, so the arithmetic is unit-testable in isolation.
//
// THE TWO MECHANICS, AND HOW THEY COMPOSE:
//  1. RENORMALIZE: dropped metrics have already left the pool; the PRESENT set's
//     nominal weights are rescaled so they sum to exactly 100%. (Present = scored
//     + neutral-hold — neutral-hold rescales up ALONGSIDE scored metrics when a
//     DIFFERENT metric drops, because it is "present"; only DROPPED metrics leave
//     the pool. See the neutral-hold FLAG in assemble.ts.)
//  2. CAP (§7.2): a capped metric's EFFECTIVE (post-renorm) weight is clamped to
//     its max, and the EXCESS is redistributed across the still-uncapped present
//     members in proportion to their current effective weight. Enforcing the cap
//     on the post-renorm weight means it catches BOTH a nominal override that
//     exceeds the cap (with no drops, post-renorm = nominal) AND a renormalization
//     that pushes the metric over the cap because OTHER metrics dropped while it
//     stayed present. Single source of truth: the effective weight.
//
// The redistribution loop iterates because, in general, capping one metric and
// pushing weight onto others could push a SECOND capped metric over its cap. The
// only cap in the current spec is F10 (Foundation), and capping it only lifts
// UNcapped metrics — so it converges in one pass — but the loop keeps the function
// correct if a PG ever caps more than one metric. Sum is invariant at 100% every
// iteration: weight removed from cappers == weight added to the rest.

const EPS = 1e-9;

export interface WeightInput {
  metricKey: string;
  nominalWeight: number; // PERCENT
  maxWeight?: number; // PERCENT hard cap; undefined = uncapped
}

export interface WeightOutput {
  metricKey: string;
  effectiveWeight: number; // PERCENT, post-renorm + post-cap; the present set sums to 100
  capApplied: boolean;
}

/**
 * Resolve effective weights for the PRESENT set (scored + neutral-hold). Returns
 * one output per input, with effectiveWeight summing to ~100 across the set
 * (empty set → empty result). Dropped metrics are NOT passed here — the caller
 * gives them effectiveWeight 0 directly.
 */
export function resolveEffectiveWeights(present: WeightInput[]): WeightOutput[] {
  if (present.length === 0) return [];

  // 1. RENORMALIZE present nominal weights to sum to 100. If the nominal weights
  //    sum to 0 (degenerate spec), fall back to equal split so we never divide by
  //    zero or silently zero the pillar.
  const nominalTotal = present.reduce((a, w) => a + w.nominalWeight, 0);
  const eff = new Map<string, number>();
  for (const w of present) {
    eff.set(w.metricKey, nominalTotal > EPS ? (w.nominalWeight / nominalTotal) * 100 : 100 / present.length);
  }

  // 2. CAP + redistribute. Iterate to a fixpoint (bounded by #members).
  const capped = new Set<string>();
  for (let iter = 0; iter < present.length; iter++) {
    const over = present.filter(
      (w) => w.maxWeight !== undefined && !capped.has(w.metricKey) && eff.get(w.metricKey)! > w.maxWeight + EPS,
    );
    if (over.length === 0) break;

    let excess = 0;
    for (const w of over) {
      excess += eff.get(w.metricKey)! - w.maxWeight!;
      eff.set(w.metricKey, w.maxWeight!);
      capped.add(w.metricKey);
    }

    const uncapped = present.filter((w) => !capped.has(w.metricKey));
    const uncappedTotal = uncapped.reduce((a, w) => a + eff.get(w.metricKey)!, 0);
    if (uncappedTotal <= EPS) break; // everything capped — cannot redistribute (degenerate)
    for (const w of uncapped) {
      const cur = eff.get(w.metricKey)!;
      eff.set(w.metricKey, cur + excess * (cur / uncappedTotal));
    }
  }

  return present.map((w) => ({
    metricKey: w.metricKey,
    effectiveWeight: eff.get(w.metricKey)!,
    capApplied: capped.has(w.metricKey),
  }));
}
