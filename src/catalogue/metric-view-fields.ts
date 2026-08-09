// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SEAM — a manifest metric ↔ the field it arrives on in the FUNDAMENTALS VIEW.
//
// ── ★ WHY THIS MAP HAS TO EXIST SOMEWHERE, AND WHY IT IS HERE ────────────────────────────────────
// The manifests name a metric by its CATALOGUE KEY (`grossNpaRatio`) and document the column it is
// read from (`banking_quarterly_results.gnpa_pct`). The fundamentals read endpoint names the same
// figure by its VIEW FIELD (`gnpaPct`), and the two do not derive from one another: the view calls
// `cet1Ratio` → `cet1`, `costToIncomeRatio` → `costToIncome`, `persistencyRatio13Month` →
// `persistency13M`. A generator that guessed would be wrong on a third of the set.
//
// It lives in `catalogue/` because that is where the product's cross-surface NAMING already lives —
// the gloss catalogues next to it are the same kind of object: the one place a figure's identity is
// declared so two surfaces cannot word it differently.
//
// ── ★★ `satisfies` IS THE ENFORCEMENT, IN BOTH DIRECTIONS ───────────────────────────────────────
// Each family's map is `satisfies Partial<Record<MetricKey, keyof ThatFamilysViewType>>`. So:
//   · a key that is not a real catalogue metric is a compile error;
//   · a field that is not on that family's view type is a compile error;
//   · renaming a view field breaks the build HERE, in the file whose job is to know about it, rather
//     than silently emitting a frontend catalogue that reads `undefined`.
//
// ── ⚠⚠ MONEY LINES ARE DELIBERATELY ABSENT FROM THIS MAP ────────────────────────────────────────
// It carries the RATIOS, MULTIPLES, DAY-COUNTS and PER-SHARE figures — and nothing denominated in
// ₹ crore. The statements table already renders 11–19 P&L lines and 16–26 balance-sheet lines per
// family, which is MORE money detail than either manifest declares; adding those again under a second
// heading is the "one figure, two places" defect the brief card has now fixed twice. What the
// statements table has never had is the measures.
//
// ── ⚠ AND THE SCALE CONVERSION DOES NOT TRAVEL WITH THEM ────────────────────────────────────────
// `manifest.scale` describes the STORED column (banking's gnpa_pct is a fraction: 0.0183 = 1.83%).
// The fundamentals view is ALREADY CANONICAL — `fundamentals-normalize.ts` is "THE single
// unit-canonicalization layer", percentages arrive as percent, money as ₹ crore, multiples as
// numbers, and its own header states "There is NO unit conversion in the tab."
//
// So a consumer of this map must NOT re-apply `scale`. Multiplying an already-converted fraction by
// 100 a second time is the exact two-orders-of-magnitude error the manifest exists to prevent, with
// the sign of the mistake reversed. What travels to the frontend is a DISPLAY UNIT (%, ×, days,
// ₹/share) derived from `scale` once, here, and never the multiplier. See `displayUnitFor`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { AnnualMetricKey } from "./annual-metrics.js";
import type { MetricKey } from "./quarter-metrics.js";
import type {
  AnnualSnapshot,
  BankingAnnual,
  BankingQuarter,
  GeneralInsuranceAnnual,
  GeneralInsuranceQuarter,
  LifeInsuranceAnnual,
  LifeInsuranceQuarter,
  NbfcAnnual,
  NbfcQuarter,
  QuarterPoint,
} from "../scoring/read/fundamentals-view.types.js";

/** What a reader sees after the unit, once. Derived from the manifest's `scale` — NEVER a multiplier.
 *  `fraction` and `percent` collapse to the same unit here because the view has already converted. */
export type DisplayUnit = "%" | "×" | "days" | "₹/share";

export function displayUnitFor(scale: string): DisplayUnit | null {
  switch (scale) {
    case "fraction":
    case "percent":
      return "%";
    case "multiple":
      return "×";
    case "days":
      return "days";
    case "perShare":
      return "₹/share";
    default:
      return null; // money — not carried; see the header
  }
}

// ── QUARTERLY ──────────────────────────────────────────────────────────────────────────────────────

export const QUARTER_VIEW_FIELD = {
  non_financial: {
    operatingMargin: "operatingMargin",
    netMargin: "netMargin",
  } satisfies Partial<Record<MetricKey, keyof QuarterPoint>>,

  banking: {
    grossNpaRatio: "gnpaPct",
    netNpaRatio: "nnpaPct",
    provisionCoverageRatio: "pcr",
    cet1Ratio: "cet1",
    returnOnAssetsQuarterly: "roaQuarterly",
    costToIncomeRatio: "costToIncome",
    netMargin: "netMargin",
  } satisfies Partial<Record<MetricKey, keyof BankingQuarter>>,

  nbfc: {
    netMargin: "netMargin",
  } satisfies Partial<Record<MetricKey, keyof NbfcQuarter>>,

  // ⚠ FOUR OF THE FIVE PERSISTENCY RATIOS ARE ABSENT, AND SO ARE TWO OTHER RATIOS. The manifest
  // declares persistency at 13, 25, 37, 49 and 61 months plus `newBusinessPremiumPct` and
  // `expenseRatioPolicyholders`; `LifeInsuranceQuarter` carries only `persistency13M`. The other
  // four legs exist on the ANNUAL view as a `PersistencyLadder`, and the two ratios exist on the
  // annual type only. They are NOT mapped here rather than mapped to something near them — a
  // 61-month persistency rendered from a 13-month field would be a wrong number under a right label,
  // which is worse than an absent row. Widening the view type is the fix, and it is not this change.
  life_insurance: {
    solvencyRatio: "solvencyRatio",
    persistencyRatio13Month: "persistency13M",
    netMargin: "netMargin",
  } satisfies Partial<Record<MetricKey, keyof LifeInsuranceQuarter>>,

  // ⚠ `netUnderwritingMargin` IS ON THE VIEW AND IS DELIBERATELY NOT MAPPED. The manifest's own note:
  // measured, it equals 1 − combinedRatio EXACTLY on 31/31 quarterly and 8/8 annual rows, so it is
  // the same fact in a second unit. Two rows saying one thing is what the gloss catalogue exists to
  // stop, and a row present on the view is not a reason to render it.
  general_insurance: {
    combinedRatio: "combinedRatio",
    incurredClaimRatio: "incurredClaimRatio",
    expensesOfManagementRatio: "expensesOfManagementRatio",
    netRetentionRatio: "netRetentionRatio",
    solvencyRatio: "solvencyRatio",
    netMargin: "netMargin",
  } satisfies Partial<Record<MetricKey, keyof GeneralInsuranceQuarter>>,
} as const;

// ── ANNUAL ─────────────────────────────────────────────────────────────────────────────────────────

export const ANNUAL_VIEW_FIELD = {
  // ⚠ `receivablesDays` IS DECLARED IN THE ANNUAL MANIFEST AND IS NOT ON `AnnualSnapshot`. It is the
  // only metric in either manifest on a DAYS scale, it is 89.5% covered in the source table, and the
  // fundamentals view simply never carried it — `receivablesTrade` (an NBFC ₹ line) is the nearest
  // field and is a different thing. It is left UNMAPPED rather than approximated: widening the view
  // type is the fix and it belongs with the read layer, not here. Named so it is not lost.
  non_financial: {
    returnOnEquity: "roe",
    debtToEquity: "debtToEquity",
    interestCoverage: "interestCoverage",
    basicEps: "basicEps",
  } satisfies Partial<Record<AnnualMetricKey, keyof AnnualSnapshot>>,

  banking: {
    netInterestMargin: "nim",
    creditCost: "creditCostPct",
    creditDepositRatio: "creditDepositRatio",
    returnOnEquity: "roe",
    returnOnAssetsAnnual: "roaDisclosed",
    basicEps: "basicEps",
  } satisfies Partial<Record<AnnualMetricKey, keyof BankingAnnual>>,

  nbfc: {
    netInterestMargin: "nim",
    creditCost: "creditCostPct",
    costToIncomeAnnual: "costToIncomeRatio",
    returnOnEquity: "roe",
    basicEps: "basicEps",
  } satisfies Partial<Record<AnnualMetricKey, keyof NbfcAnnual>>,

  life_insurance: {
    returnOnEquity: "roe",
    basicEps: "basicEps",
  } satisfies Partial<Record<AnnualMetricKey, keyof LifeInsuranceAnnual>>,

  general_insurance: {
    returnOnEquity: "roe",
    basicEps: "basicEps",
  } satisfies Partial<Record<AnnualMetricKey, keyof GeneralInsuranceAnnual>>,
} as const;
