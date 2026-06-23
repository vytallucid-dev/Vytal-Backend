// File: src/scoring/read/fundamentals-normalize.ts
//
// THE single unit-canonicalization layer for the Fundamentals read endpoint
// (GET /api/stocks/:symbol/fundamentals). Written ONCE here, reused by every
// industry family and — later — by the Overview tab. The contract the UI relies on:
//
//   • percentages  → PERCENT          (roe 67.85, never 0.6785, never 6785)
//   • monetary     → ₹ CRORE          (already Cr in every source table — pass through)
//   • ratios/x     → AS-IS            (D/E 0.47, interest coverage 30.1x, turnover 1.76x)
//
// Why a layer and not inline math: the five families DISAGREE on how they store
// ratio-like percentages. non_financial stores roe/roce/margins ALREADY as percent;
// banking / nbfc / insurance store them as FRACTIONS (0.6785). Routing every family
// through `makeNormalizer(family).pct()` means the ×100 lives in exactly one place —
// flip a family's `percentStoredAsFraction` flag and the whole read path follows.
//
// The UI must receive only canonical units. There is NO unit conversion in the tab.

export type FamilyKey =
  | "non_financial"
  | "banking"
  | "nbfc"
  | "life_insurance"
  | "general_insurance";

/** How a family stores its figures in the SOURCE tables, relative to the canonical
 *  read-layer contract above. Only the percentage convention differs today; the flag
 *  is the seam where banking/nbfc/insurance will diverge when those families build. */
interface UnitConvention {
  /** true → ratio-like %s are stored as FRACTIONS (0.6785) and `pct()` multiplies by
   *  100 to canonicalize. non_financial already stores percent → false (pass through). */
  percentStoredAsFraction: boolean;
}

const CONVENTIONS: Record<FamilyKey, UnitConvention> = {
  // non_financial (Fundamental / QuarterlyResult): roe/roce/margins already percent.
  non_financial: { percentStoredAsFraction: false },
  // The financial families store ratio %s as fractions — wired live when each builds.
  banking: { percentStoredAsFraction: true },
  nbfc: { percentStoredAsFraction: true },
  life_insurance: { percentStoredAsFraction: true },
  general_insurance: { percentStoredAsFraction: true },
};

/** Prisma Decimal | number | null | undefined → number | null. The ONLY place a
 *  Decimal becomes a JS number on the read path; everything downstream is numbers. */
export function toNum(d: unknown): number | null {
  if (d == null) return null;
  if (typeof d === "number") return Number.isFinite(d) ? d : null;
  const v =
    typeof (d as { toNumber?: () => number }).toNumber === "function"
      ? (d as { toNumber: () => number }).toNumber()
      : Number(d);
  return Number.isFinite(v) ? v : null;
}

/** Round to `dp` decimals, preserving null. Keeps the wire payload tidy (read-layer
 *  display rounding — never used inside a derivation chain before the final value). */
export function round(x: number | null, dp = 2): number | null {
  if (x == null) return null;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/** Guarded divide: null on any null operand or a zero denominator. The honest
 *  -empty primitive every derivation builds on — NEVER returns 0 or NaN for missing data. */
export function divOrNull(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  const v = a / b;
  return Number.isFinite(v) ? v : null;
}

/** An exact 0 in a quarterly income-statement LEVEL field (revenue / net profit /
 *  operating profit / a margin) is a non-filing artifact — a real operating quarter is
 *  never exactly ₹0 Cr or 0.00% — so it is surfaced as honest-null, not a fabricated
 *  zero that would crash a trend line. Use ONLY for P&L level fields; NOT for balance
 *  -sheet / debt / cash / growth fields, where 0 is a real, meaningful value. */
export const zeroToNull = (x: number | null): number | null => (x === 0 ? null : x);

/** a/b × 100, guarded. The canonical way to MAKE a percentage in the read layer
 *  (roa, payout, yields …). Result is already in percent units. */
export function pctOf(a: number | null, b: number | null, dp = 2): number | null {
  const r = divOrNull(a, b);
  return r == null ? null : round(r * 100, dp);
}

/** The family-bound canonicalizers the service calls. Same surface for every family;
 *  only `pct` behaves differently per the family's storage convention. */
export interface FundamentalsNormalizer {
  /** Canonical PERCENT (e.g. 67.85). Identity for non_financial; ×100 for fraction
   *  families. Pass roe/roce/margins/growth through here even when already percent. */
  pct(raw: unknown, dp?: number): number | null;
  /** Canonical ₹ CRORE — every source table is already Cr, so a guarded pass-through.
   *  Centralized so a future family stored in ₹ (or ₹ mn) gets its scale factor here. */
  money(raw: unknown, dp?: number): number | null;
  /** Ratios / multiples (D/E, interest coverage, turnover) — unit-agnostic pass-through. */
  ratio(raw: unknown, dp?: number): number | null;
}

export function makeNormalizer(family: FamilyKey): FundamentalsNormalizer {
  const conv = CONVENTIONS[family];
  return {
    pct(raw, dp = 2) {
      const n = toNum(raw);
      if (n == null) return null;
      return round(conv.percentStoredAsFraction ? n * 100 : n, dp);
    },
    money(raw, dp = 2) {
      return round(toNum(raw), dp);
    },
    ratio(raw, dp = 4) {
      return round(toNum(raw), dp);
    },
  };
}
