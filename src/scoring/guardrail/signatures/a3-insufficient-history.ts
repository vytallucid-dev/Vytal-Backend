// File: src/scoring/guardrail/signatures/a3-insufficient-history.ts
//
// SIGNATURE A-3 — INSUFFICIENT HISTORY (Category A, data integrity, AUTO).
//
// RULEBOOK §1 A-3 (exact):
//   Condition: count of Fundamental rows < minimum needed for Lens 3 (own-history)
//     per §5.4; OR count of ShareholdingPattern rows < 8 for Ownership baseline
//     per §11.10.
//   Threshold: per existing spec minimums (§5.4 Lens-3 window; §11.10 8 quarters).
//   Metrics affected: Lens 3 across affected metrics; Ownership baseline.
//   Solution: O2 via existing §5.8 (L1+L2)/2 fallback; Ownership baseline 60 until 8
//     quarters per §11.10.
//   Auto/Review: AUTO. Existing spec behavior surfaced.
//
// ⚠ CONFLICT (flagged) — "O2" here is NOT a metric-level dual-exclusion. In this
// system O2 = drop the WHOLE metric from own-score AND from the peer μ/σ. A-3's real
// action is a LENS-level fallback (drop ONLY Lens 3 for a metric; keep L1+L2 → score
// = (L1+L2)/2) and the §11.10 Ownership baseline-60 — BOTH already performed
// automatically by the existing engine (metric-scoring/wire.ts gates L3 on l3MinN
// and falls back; ownership/baseline.ts applies the 60 baseline). A metric-level
// score_suppressions O2 would OVER-suppress (kill the whole metric, removing its
// valid L1+L2 too). So A-3 is implemented as DETECT + SURFACE: it writes the audit
// event + a transparency annotation (O3) recording that the L3 fallback / baseline
// is in effect, and lets the existing §5.8 / §11.10 machinery perform the actual
// (lens-level) exclusion. Faithful to the rulebook's INTENT ("existing spec behavior
// surfaced") and to the schema (which has no lens-scope on score_suppressions).
// Honoring a literal A-3 directive would need a lens-scoped suppression column.

import type { Signature, SignatureResult, GuardrailStockInput } from "../types.js";

/** §5.4 Lens-3 own-history minimum (the metric-scoring build's Foundation l3MinN). */
export const LENS3_MIN_HISTORY = 5;
/** §11.10 Ownership baseline needs 8 ShareholdingPattern quarters. */
export const OWNERSHIP_MIN_QUARTERS = 8;

export const a3InsufficientHistory: Signature = {
  key: "A-3",
  category: "A",
  tier: "auto",

  applies(input: GuardrailStockInput): boolean {
    return input.history != null;
  },

  evaluate(input: GuardrailStockInput): SignatureResult | null {
    const h = input.history;
    if (!h) return null;

    const lens3Short = h.fundamentalRows < LENS3_MIN_HISTORY;
    const ownershipShort = h.shareholdingRows < OWNERSHIP_MIN_QUARTERS;
    const base = { signatureKey: "A-3" as const, category: "A" as const, tier: "auto" as const, affectedMetrics: [] };

    if (!lens3Short && !ownershipShort) {
      return { ...base, fired: false, outcome: "O1", triggeringValues: { fundamentalRows: h.fundamentalRows, shareholdingRows: h.shareholdingRows }, explanation: "Sufficient history for Lens 3 and the Ownership baseline; scored normally." };
    }

    const which: string[] = [];
    if (lens3Short) which.push(`Lens-3 own-history (${h.fundamentalRows} < ${LENS3_MIN_HISTORY} → §5.8 (L1+L2)/2 fallback)`);
    if (ownershipShort) which.push(`Ownership baseline (${h.shareholdingRows} < ${OWNERSHIP_MIN_QUARTERS} quarters → §11.10 baseline 60)`);

    // O3 surface/annotate — the lens-level fallback / baseline is ALREADY applied by
    // the engine; this records it for the user. (See file header: NOT a metric O2.)
    return {
      ...base,
      fired: true,
      outcome: "O3",
      triggeringValues: { fundamentalRows: h.fundamentalRows, shareholdingRows: h.shareholdingRows, lens3Min: LENS3_MIN_HISTORY, ownershipMin: OWNERSHIP_MIN_QUARTERS, fallbacks: which },
      explanation: `Limited history: ${which.join("; ")}. Trend-based components use available data; the score reflects this. (Lens-level fallback performed by the scoring engine; values are not removed.)`,
    };
  },
};
