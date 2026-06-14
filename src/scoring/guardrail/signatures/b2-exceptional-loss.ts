// File: src/scoring/guardrail/signatures/b2-exceptional-loss.ts
//
// SIGNATURE B-2 — EXCEPTIONAL LOSS (PHANTOM LOSS) — CROMPTON / GLENMARK (Cat B, AUTO).
//
// RULEBOOK §2 B-2 (exact):
//   Condition: netProfit falls > 80% YoY OR turns negative AND operatingMargin holds
//     (change within ±3pp, stays positive) AND the implied below-operating-line
//     charge exceeds 40% of the absolute profit swing.
//   Thresholds: profit drop > 80% YoY or sign flip; OPM held ±3pp, still positive;
//     below-line share > 40% of the swing.
//   Metrics affected: SUPPRESS — Net Margin, ROE, NP-YoY. KEEP — Operating Margin,
//     Revenue growth, balance-sheet (a real equity write-down genuinely worsens D/E
//     — keep that).
//   Solution: O2 Suppress affected profit metrics + O3 annotate. Auto.
//
// FIXED METRICS-AFFECTED MAP (actual keys): SUPPRESS F2 ROE, M2 TTM NPM (Net Margin),
//   M4 NP-YoY. KEEP M1 OPM, M3 Revenue YoY, F4 D/E, F5 Interest Coverage.
// NOTE vs B-1: B-2 does NOT suppress ROCE (F1) — the rulebook's B-2 map omits it
// (an impairment hits net profit / ROE; ROCE on EBIT is less affected). Deterministic
// map ⇒ AUTO. "O2 + O3 annotate" = O2 with its §0.8c transparency.

import type { Signature, SignatureResult, GuardrailStockInput, AffectedMetric } from "../types.js";
import { analyzeBelowLine } from "./below-line-core.js";

export const B2_PROFIT_DROP_PCT = 80; // > 80% YoY drop (or sign flip)
export const B2_OPM_FLAT_PP = 3; // ±3pp, still positive
export const B2_BELOW_LINE_SHARE = 0.40; // > 40% of the profit swing

const SUPPRESS_MAP: AffectedMetric[] = [
  { metricKey: "F2", pillar: "foundation", reason: "ROE — hit by the below-line charge" },
  { metricKey: "M2", pillar: "momentum", reason: "TTM NPM (Net Margin) — hit by the below-line charge" },
  { metricKey: "M4", pillar: "momentum", reason: "NP-YoY — driven by the below-line charge" },
];

export const b2ExceptionalLoss: Signature = {
  key: "B-2",
  category: "B",
  tier: "auto",

  applies(input: GuardrailStockInput): boolean {
    return input.industryPath === "non_financial" && input.latestFundamental != null && input.priorFundamental != null;
  },

  evaluate(input: GuardrailStockInput): SignatureResult | null {
    const curr = input.latestFundamental, prior = input.priorFundamental;
    if (!curr || !prior) return null;
    const a = analyzeBelowLine(curr, prior);
    if (a.opmFlat3pp === null || a.opmCurrentPositive === null || a.belowLineShareOfSwing === null) return null;
    // profit-drop gate: either a >80% drop (prior>0) or a sign flip to negative.
    const dropOrFlip = (a.profitDropPct !== null && a.profitDropPct > B2_PROFIT_DROP_PCT) || a.profitSignFlip;

    const base = { signatureKey: "B-2" as const, category: "B" as const, tier: "auto" as const };
    const fired = dropOrFlip && a.opmFlat3pp && a.opmCurrentPositive && a.belowLineShareOfSwing > B2_BELOW_LINE_SHARE;
    const triggeringValues = { profitDropPct: a.profitDropPct, profitSignFlip: a.profitSignFlip, opmChangePp: a.opmChangePp, opmCurrentPositive: a.opmCurrentPositive, belowLineShareOfSwing: a.belowLineShareOfSwing, profitSwingAbs: a.profitSwingAbs, belowLineAmount: a.belowLineAmount, thresholds: { profitDrop: B2_PROFIT_DROP_PCT, opmFlatPp: B2_OPM_FLAT_PP, belowLineShare: B2_BELOW_LINE_SHARE }, notes: a.notes };

    if (!fired) {
      return { ...base, fired: false, outcome: "O1", affectedMetrics: [], triggeringValues, explanation: "No exceptional below-operating-line charge detected; scored normally." };
    }
    return {
      ...base, fired: true, outcome: "O2", affectedMetrics: SUPPRESS_MAP, triggeringValues,
      explanation: `Net profit this period reflects a one-time charge below the operating line (~₹${a.belowLineAmount?.toFixed(0)} Cr; e.g. impairment/write-down) while operating margin held (${a.opmChangePp?.toFixed(1)}pp). Profit-based metrics (ROE, net margin, NP-YoY) are excluded as they don't reflect ongoing operating performance. Operating and balance-sheet metrics are scored normally. Raw figures remain visible, marked excluded.`,
    };
  },
};
