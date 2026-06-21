// File: src/scoring/findings/section2/risk-shape.ts
//
// §2 RISK-SHAPE — "How it rides". Two stacked lines (File 1 §2):
//   Line 1 = a FACT (the stock's own realised behaviour) — the K1 ride deviation + drawdown.
//   Line 2 = INTERPRETATION (what its Foundation means given its class-group).
//
// ── PERSISTENCE (the answer to "table-write vs read-computation") ──────────────────────
// §2 is NOT a §5 finding — it writes to NEITHER score_red_flags NOR score_patterns. It is a
// deterministic READ-LAYER render off (cleaned price series + foundation subtotal +
// sectorClass), computed at stock-page read time. This module is that pure computation; the
// read layer (health-view) calls it. Nothing here persists.
//
// K1 (File 1 §2): ride_ratio = realized_vol_recent (~63d) / realized_vol_baseline (~2–3yr).
// Vol = annualised stdev of daily log returns. Worst drawdown = deepest peak-to-trough in the
// cleaned view. PRICE comes CLEANED (getCleanedCloses / cleanPriceSeries) — never raw rows.

import { classGroupOf, type ClassGroup } from "./class-group.js";
import type { SectorClass } from "../types.js";

export const RECENT_DAYS = 63;        // ~3 months
export const BASELINE_DAYS = 756;     // ~3 years (cap; uses min(available, this))
export const MIN_BASELINE_DAYS = 252; // <1yr of history ⇒ ride "not yet established" (File 1 edge case)
const TRADING_DAYS = 252;

export type FoundationZone = "Strong" | "Mid" | "Weak";

export interface RiskShapeLine1 {
  available: boolean;
  rideRatio: number | null;
  label: string | null;
  realizedVolRecent: number | null;   // annualised
  realizedVolBaseline: number | null; // annualised
  worstDrawdownPct: number | null;    // negative (e.g. −34.2)
  template: string | null;            // File 1's Line-1 sentence
  note: string;
}

export interface RiskShapeLine2 {
  classGroup: ClassGroup | null;
  foundationZone: FoundationZone | null;
  interpretation: string | null;
}

export interface RiskShape { line1: RiskShapeLine1; line2: RiskShapeLine2 }

/** Annualised realised vol over the trailing `n` returns (or null if too few). */
function annualisedVol(logReturns: number[], n: number): number | null {
  const w = logReturns.slice(-n);
  if (w.length < Math.min(20, n)) return null;
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  const variance = w.reduce((a, b) => a + (b - mean) ** 2, 0) / (w.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS) * 100; // %
}

/** Deepest peak-to-trough drawdown over the series, as a negative %. */
function worstDrawdown(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0], worst = 0;
  for (const c of closes) { if (c > peak) peak = c; const dd = (c - peak) / peak; if (dd < worst) worst = dd; }
  return worst * 100;
}

/** File 1 §2 K1 band cuts → label. */
function rideLabel(ratio: number): string {
  if (ratio < 0.85) return "Calmer than usual";
  if (ratio <= 1.25) return "Its normal ride";
  if (ratio <= 1.75) return "Wilder than usual";
  return "Sharply more volatile than its history";
}

function foundationZone(f: number | null): FoundationZone | null {
  if (f === null) return null;
  if (f >= 72) return "Strong";        // native Foundation strong mark
  if (f >= 60) return "Mid";           // mid band 60–72
  return "Weak";
}

// ── File 1 §2 Line-2 interpretation table (VERBATIM), [classGroup][zone] ───────────────
const LINE2: Record<ClassGroup, Record<FoundationZone, string>> = {
  A: {
    Strong: "Strong floor in a quality name — the structure that has historically meant a calmer ride and a shallower worst case. The floor supports the steadiness.",
    Mid: "Decent floor in a quality name — some structural support for a contained ride, but not the full cushion a top-tier balance sheet gives.",
    Weak: "Weak floor in a name whose class usually offers calm — the support isn't there right now; don't assume the quality-sector steadiness applies.",
  },
  B: {
    Strong: "Strong floor — but in a cyclical name, read that as solvent through the cycle, not calm. The cycle owns the swings; the floor protects survival, not smoothness.",
    Mid: "Adequate floor for a cyclical — enough to weather the cycle, but expect the cycle, not the balance sheet, to drive how violently it moves.",
    Weak: "Weak floor in a cyclical — the most exposed combination: cyclical swings on thin structural protection. Survival itself is the question in a downturn.",
  },
  C: {
    Strong: "Strong floor for a growth name — unusual and reassuring, but growth rides on expectations; the floor limits structural risk, not the volatility the story brings.",
    Mid: "Moderate floor in a growth name — workable structure, but expect expectation-driven swings to dominate the ride regardless.",
    Weak: "Weak floor in a growth name — swings driven by the story and sentiment, with little cushion if the story breaks.",
  },
};

export function computeRiskShape(input: {
  cleaned: { date: Date; close: number }[];
  foundationSubtotal: number | null;
  sectorClass: SectorClass | null;
  /** From the clean report (getCleanedCloses().report.clean). false ⇒ a structural break
   *  (demerger/data) is in the series and the relative-vol read is unreliable — gate Line 1,
   *  same discipline as the Market sub-components. Default true. */
  clean?: boolean;
}): RiskShape {
  const closes = input.cleaned.map((d) => d.close).filter((c) => c > 0);

  // ── Line 1 — K1 ride deviation ──
  let line1: RiskShapeLine1;
  if (input.clean === false) {
    line1 = { available: false, rideRatio: null, label: null, realizedVolRecent: null, realizedVolBaseline: null, worstDrawdownPct: null, template: null, note: "Structural break in view (demerger/split-uncorrected) — ride not establishable" };
  } else if (closes.length < MIN_BASELINE_DAYS) {
    line1 = { available: false, rideRatio: null, label: null, realizedVolRecent: null, realizedVolBaseline: null, worstDrawdownPct: null, template: null, note: "Limited history — ride not yet established" };
  } else {
    const logRet: number[] = [];
    for (let i = 1; i < closes.length; i++) logRet.push(Math.log(closes[i] / closes[i - 1]));
    const recent = annualisedVol(logRet, RECENT_DAYS);
    const baseline = annualisedVol(logRet, BASELINE_DAYS);
    const dd = worstDrawdown(closes.slice(-BASELINE_DAYS));
    if (recent === null || baseline === null || baseline <= 0) {
      line1 = { available: false, rideRatio: null, label: null, realizedVolRecent: recent, realizedVolBaseline: baseline, worstDrawdownPct: dd, template: null, note: "vol unavailable" };
    } else {
      const ratio = recent / baseline;
      const label = rideLabel(ratio);
      line1 = {
        available: true, rideRatio: Math.round(ratio * 100) / 100, label,
        realizedVolRecent: Math.round(recent * 10) / 10, realizedVolBaseline: Math.round(baseline * 10) / 10,
        worstDrawdownPct: dd === null ? null : Math.round(dd * 10) / 10,
        template: `${label} (${(Math.round(ratio * 100) / 100).toFixed(2)}× its baseline)${dd === null ? "" : ` — worst drawdown in view ${(Math.round(dd * 10) / 10).toFixed(1)}%`}.`,
        note: "computed",
      };
    }
  }

  // ── Line 2 — Foundation interpretation by class-group ──
  const cg = classGroupOf(input.sectorClass);
  const zone = foundationZone(input.foundationSubtotal);
  const line2: RiskShapeLine2 = {
    classGroup: cg, foundationZone: zone,
    interpretation: cg && zone ? LINE2[cg][zone] : null, // null when sector unmapped or foundation unavailable
  };

  return { line1, line2 };
}
