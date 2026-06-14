// File: src/scoring/metrics/types.ts
//
// METRIC RAW-VALUE layer — shared types. Piece 2a of the three-lens core: it
// computes each Foundation/Momentum metric's RAW numeric value from STANDALONE
// financial data. It does NOT score (no lenses, bars, peer-stats, anchor-lifts).
//
// CRITICAL DATA RULE: Foundation reads standalone annual `fundamentals`; Momentum
// reads standalone quarterly `quarterly_results`. NEVER fall back to consolidated
// — a standalone-absent period yields an UNAVAILABLE metric with a recorded
// reason, never a silent consolidated value (that would mix bases and break
// comparability). All monetary line items are ₹ CRORE (confirmed: paid-up-capital
// ₹Cr ÷ face-value ₹/share = Cr-shares, ingest-indas-annual.ts). Ratios are
// unit-free; %-metrics are returned ×100.
//
// CN-8: pure definitional computation — nothing tuned to anything.

/** Where a metric's value came from. */
export type MetricSource =
  | "derived" // computed here from raw standalone line items
  | "stored_column" // taken from a pre-computed column (only when confirmed standalone+correct)
  | "none"; // unavailable

/** Why a metric is unavailable (feeds the L3-insufficient / missing-data handling
 *  in the scoring layer later — here we only record it). */
export type MetricUnavailableReason =
  | "standalone_absent" // no standalone row for the required period
  | "missing_line_item" // a required input field was null on the standalone row
  | "insufficient_history" // fewer periods than the metric needs (e.g. <4 consecutive quarters)
  | "divide_by_zero" // denominator zero/undefined (e.g. zero finance costs, zero PAT)
  | "non_positive_base"; // growth/CAGR base ≤ 0 → undefined

/** F3 buyback inference path (§7.5.2), recorded as a surfaceable fact. */
export type BuybackPath =
  | "financing_line" // (i) separable buyback line in financing CF — NOT in current schema
  | "equity_capital_change" // (ii) inferred from ΔEquity-Share-Capital × period price
  | "confirmed_zero" // (iii) ESC flat/up AND no separable line → zero
  | "indeterminate"; // no prior-year ESC to compare → cannot confirm; treated 0 (flagged)

/** One metric's raw-value result. Carries everything needed to STORE and to
 *  VERIFY by hand: the value (or unavailable+reason), the formula WITH the actual
 *  numbers, the source, the inputs used, and any flags (e.g. a stored-column
 *  disagreement that hints the ingestion pre-compute used the wrong basis). */
export interface MetricValue {
  key: string; // "F1".."F10", "M1".."M5"
  label: string; // human label, e.g. "ROCE %"
  available: boolean;
  value: number | null;
  unit: MetricUnit;
  source: MetricSource;
  formula: string; // self-documenting, includes the actual numbers
  inputs: Record<string, number | string | null>;
  reason: MetricUnavailableReason | null;
  flags: string[]; // notes / interpretations / cross-check disagreements
}

export type MetricUnit = "%" | "ratio" | "x" | "days" | "years" | "n/a";

// ── Normalized STANDALONE annual row (Decimals already → number|null) ───────────
export interface FoundationAnnual {
  fiscalYear: string; // "FY26"
  fyOrdinal: number; // numeric for window/gap math (FY26 → 26)
  // P&L
  revenue: number | null;
  otherIncome: number | null;
  financeCosts: number | null;
  depreciation: number | null;
  profitBeforeTax: number | null;
  netProfit: number | null;
  // Equity / debt
  equityShareCapital: number | null;
  otherEquity: number | null;
  totalEquity: number | null;
  borrowingsCurrent: number | null;
  borrowingsNoncurrent: number | null;
  totalDebtStored: number | null;
  // BS
  totalAssets: number | null;
  currentLiabilities: number | null;
  tradeReceivablesCurrent: number | null;
  tradeReceivablesNoncurrent: number | null;
  // Cash flow
  cashFromOperating: number | null;
  capex: number | null;
  cashFromFinancing: number | null;
  faceValueShare: number | null;
  // Pre-computed columns — used ONLY for cross-check (we derive, then compare).
  stored: {
    roce: number | null; // percent
    roe: number | null; // percent (NOTE: ingestion uses 2y-AVG equity)
    debtToEquity: number | null; // percent (ratio ×100)
    interestCoverage: number | null; // x
    receivablesDays: number | null; // days
    assetTurnover: number | null; // x
    netWorth: number | null; // ₹Cr
    operatingMargin: number | null; // percent (EBITDA-based)
    ebitda: number | null; // ₹Cr
  };
}

// ── Normalized STANDALONE quarterly row ─────────────────────────────────────────
export interface MomentumQuarter {
  fiscalYear: string; // "FY26"
  quarter: string; // "Q1".."Q4"
  qOrdinal: number; // chronological index = fyOrdinal*4 + (Qn-1)
  revenue: number | null;
  otherIncome: number | null;
  interest: number | null; // = finance costs
  depreciation: number | null;
  profitBeforeTax: number | null;
  netProfit: number | null;
  operatingProfitStored: number | null; // = PBT + interest − otherIncome (excl OI)
}

// ── Parsing / numeric helpers (pure) ────────────────────────────────────────────
/** "FY26" → 26 (used only for relative ordering / gap detection). */
export const fyOrdinal = (fy: string): number => Number(fy.replace(/\D/g, ""));

/** "Q1".."Q4" → 0..3. */
export const qIndex = (q: string): number => Number(q.replace(/\D/g, "")) - 1;

/** Chronological quarter index: FY26Q1 → 26*4+0 = 104. */
export const quarterOrdinal = (fy: string, q: string): number => fyOrdinal(fy) * 4 + qIndex(q);

/** Sum of the non-null parts; null only if ALL parts are null. */
export const sumNonNull = (...xs: (number | null)[]): number | null => {
  const present = xs.filter((x): x is number => x !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
};

/** EBIT = PBT + finance costs (INCLUDES other income — the convention for ROCE &
 *  interest coverage; all earnings, operating or not, service debt). Distinct from
 *  "operating profit" which EXCLUDES other income. */
export const ebitFrom = (pbt: number | null, financeCosts: number | null): number | null =>
  pbt !== null && financeCosts !== null ? pbt + financeCosts : null;

/** Standalone net worth: totalEquity, else equityShareCapital+otherEquity. We do
 *  NOT use equityAttributableToOwners (a consolidated concept; on standalone rows
 *  it equals totalEquity where present — verified RELIANCE FY25/FY26). */
export const netWorthFrom = (r: FoundationAnnual): number | null => {
  if (r.totalEquity !== null) return r.totalEquity;
  if (r.equityShareCapital !== null && r.otherEquity !== null)
    return r.equityShareCapital + r.otherEquity;
  return null;
};

/** Total debt = current + non-current borrowings (sum of non-null). */
export const totalDebtFrom = (r: FoundationAnnual): number | null =>
  sumNonNull(r.borrowingsCurrent, r.borrowingsNoncurrent);
