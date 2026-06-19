// File: src/scoring/metrics/banking-types.ts
//
// BANKING metric raw-value layer — shared types + unit discipline. The banking
// analogue of metrics/types.ts. Computes each of the 12 banking metrics' RAW
// numeric value from STANDALONE banking data (BankingFundamental annual +
// BankingQuarterlyResult quarterly + BankSupplementary CASA/Tier-1). Does NOT
// score. PURE. Monetary inputs are ₹ CRORE; every metric OUTPUTS PERCENT.
//
// THE FRACTION-VS-PERCENT TRAP (the #1 banking silent-corruption risk):
// the XBRL ratio fields are stored as FRACTIONS in [0,1] (gnpaPct 0.0116 = 1.16%,
// cet1Ratio 0.1971 = 19.71%, roaDisclosed 0.019 = 1.9%). The committed bars are in
// PERCENT. So every fraction field is ×100-normalized, then SANITY-BOUNDED per
// metric (a ×100 result outside the metric's plausible band signals a mis-scaled or
// corrupt source → the function falls back / flags, never emits a 0.012 or a 116).
// Absolute ₹Cr line items (advances, totalAssets, ppop, interestEarned…) pass as-is.

import type { MetricValue } from "./types.js";

export type { MetricValue };

// ── Normalized STANDALONE banking ANNUAL row (Decimals → number|null) ────────────
export interface BankingAnnual {
  fiscalYear: string; // "FY26"
  fyOrdinal: number; // FY26 → 26
  // P&L
  interestEarned: number | null;
  interestExpended: number | null;
  otherIncome: number | null;
  operatingExpenses: number | null;
  ppop: number | null; // pre-provision operating profit
  profitBeforeTax: number | null;
  netProfit: number | null;
  // Balance sheet (earning-assets inputs for NIM; only on annual rows)
  advances: number | null;
  investments: number | null;
  cashAndBalancesWithRbi: number | null;
  balancesWithBanks: number | null;
  totalAssets: number | null;
  deposits: number | null;
  // Asset quality
  gnpaAbsolute: number | null;
  nnpaAbsolute: number | null;
  gnpaPct: number | null; // FRACTION (×100 → %)
  nnpaPct: number | null; // FRACTION
  // Capital adequacy (FRACTIONS)
  cet1Ratio: number | null;
  additionalTier1Ratio: number | null;
  tier1Ratio: number | null;
  // Profitability
  roaDisclosed: number | null; // FRACTION
  // Pre-computed stored ratios — CROSS-CHECK ONLY (we derive, then compare).
  stored: {
    pcr: number | null; // headline PCR (may include technical write-offs)
    costToIncomeRatio: number | null;
    netInterestMargin: number | null;
    nii: number | null;
  };
}

// ── Normalized STANDALONE banking QUARTERLY row ─────────────────────────────────
export interface BankingQuarter {
  fiscalYear: string; // "FY26"
  quarter: string; // "Q1".."Q4"
  qOrdinal: number; // chronological index = fyOrdinal*4 + (Qn-1)
  interestEarned: number | null;
  interestExpended: number | null;
  otherIncome: number | null;
  operatingExpenses: number | null;
  ppop: number | null;
  netProfit: number | null;
  gnpaAbsolute: number | null;
  nnpaAbsolute: number | null;
  gnpaPct: number | null; // FRACTION
  nnpaPct: number | null; // FRACTION
  cet1Ratio: number | null;
  additionalTier1Ratio: number | null;
  roaQuarterly: number | null; // FRACTION
}

// ── BankSupplementary point (CASA / Tier-1, already PERCENT) ─────────────────────
export interface SupplementaryPoint {
  fiscalYear: string; // "FY17".."FY26" | "LIVE"
  value: number | null; // PERCENT (null = explicit gap, status="missing")
  status: string; // "found" | "missing"
  confidence: string | null; // "A"|"B"|"C"|null
}

// ── The banking compute context (everything the 12 fns need) ────────────────────
export interface BankingCtx {
  symbol: string;
  annual: BankingAnnual[]; // sorted asc by fyOrdinal
  quarterly: BankingQuarter[]; // sorted asc by qOrdinal
  // BankSupplementary, keyed by fiscalYear; "LIVE" is the current manual figure.
  casa: Map<string, SupplementaryPoint>;
  tier1: Map<string, SupplementaryPoint>;
}

// ── Unit helpers (the fraction-vs-percent discipline) ───────────────────────────
const r2 = (x: number) => Math.round(x * 10000) / 10000;
export { r2 };

/** ×100 a stored FRACTION field to a percent. null-safe. */
export const pctFromFraction = (frac: number | null): number | null =>
  frac === null ? null : frac * 100;

/** Plausibility bands per metric kind (post-×100, in PERCENT). A computed value
 *  outside its band is treated as mis-scaled / corrupt → fallback or flag. */
export const BOUNDS = {
  gnpa: { lo: 0.02, hi: 40 }, // GNPA % (C.10 sanity bound)
  nnpa: { lo: 0.0, hi: 40 }, // NNPA can be genuinely ~0
  tier1: { lo: 5, hi: 25 }, // Tier-1 % realistic band
  roa: { lo: -5, hi: 5 }, // ROA % (banks ~0.1–2.5; allow loss)
  pcr: { lo: 0, hi: 100 }, // PCR ratio %
  ci: { lo: 20, hi: 100 }, // cost-to-income %
  casa: { lo: 5, hi: 80 }, // CASA %
  nim: { lo: 0.5, hi: 10 }, // NIM %
} as const;

export const inBand = (v: number, b: { lo: number; hi: number }): boolean =>
  v >= b.lo && v <= b.hi;

/** The "LIVE" supplementary point (the current manual figure), or null if there is
 *  no LIVE row at all. A LIVE row present-but-missing (status="missing", value=null)
 *  is returned AS a missing point — the caller decides (F7: missing LIVE → §5.8). */
export function liveSupplementary(m: Map<string, SupplementaryPoint>): SupplementaryPoint | null {
  return m.get("LIVE") ?? null;
}

/** Latest "live" supplementary value: prefer "LIVE" (found), else the most recent
 *  found fiscalYear (FY26 → FY17). Returns the point or null if none found. Used
 *  for the F1 Tier-1 fallback (pre-FY23 / XBRL-absent path). */
export function latestSupplementary(m: Map<string, SupplementaryPoint>): SupplementaryPoint | null {
  const live = m.get("LIVE");
  if (live && live.status === "found" && live.value !== null) return live;
  const fys = [...m.keys()].filter((k) => k !== "LIVE").sort((a, b) => Number(b.replace(/\D/g, "")) - Number(a.replace(/\D/g, "")));
  for (const fy of fys) {
    const p = m.get(fy)!;
    if (p.status === "found" && p.value !== null) return p;
  }
  return null;
}

// ── Standard unavailable result ─────────────────────────────────────────────────
export const bUnavailable = (
  key: string, label: string,
  reason: MetricValue["reason"], detail: string,
  inputs: MetricValue["inputs"] = {}, flags: string[] = [],
): MetricValue => ({
  key, label, available: false, value: null, unit: "%", source: "none", formula: detail, inputs, reason, flags,
});
