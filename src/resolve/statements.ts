// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVER — THE FILED STATEMENTS. What F · Fundamentals answers from.
//
// ── ★ A WRAPPER, NOT A REWRITE ────────────────────────────────────────────────────────────────────
// `buildFundamentalsView` already dispatches by industry family, already chooses a basis, and already
// reports which bases exist. What was missing is the `Resolved<T>` envelope and — the thing this file
// exists for — a shape a STATEMENT TABLE can render: line items with statement roles, across periods,
// with the basis attached to the figures rather than left in an envelope nobody reads.
//
// ── ★★ THE BASIS. THE ONE CONSTRAINT THAT MAKES AN UNSTATED F ANSWER UNSAFE ───────────────────────
// Re-measured this batch: 1,492 of 2,175 non-financial stocks file BOTH bases, across 15,932
// stock-periods; consolidated-only is **zero**, standalone-only is 683. So for two-thirds of the
// universe every figure below is one of two real answers for the same quarter.
//
// ⚠ AND THE CHOICE IS NOT UNIFORM ACROSS THE PRODUCT, WHICH IS WHAT MAKES IT DANGEROUS RATHER THAN
//   MERELY INCOMPLETE. `chooseBasis` prefers a per-family default, and measured live: TCS resolves
//   **consolidated**, HDFCBANK resolves **standalone**. Two answers side by side in the same session,
//   on two different sets of books, with nothing on screen distinguishing them.
//
// `basisRead` is therefore a required field here and travels all the way onto the payload and into
// the digest (`section/kinds/statement-table.ts`). It is deliberately NOT put on `Coverage`: that is
// Contract 1, shared with funds and with the reader's own book, and an accounting-consolidation field
// on a mutual fund is the §3.7 one-shape-for-three-kinds mistake.
//
// ── ★ THE DEPTH FLOOR APPLIES HERE, AND ANNUAL IS THE THIN AXIS ───────────────────────────────────
// Measured over all five annual tables: median 2 years; 1,644 stocks at exactly 2, 134 at 1, a second
// mass of 253 at 9, and **nothing above 9**. Eligibility at a 5-year floor is 425 stocks against
// 1,868 for the 8-quarter quarterly floor — a 4.4× difference in universe for the same-looking
// question. So `cadence` is not cosmetic: a balance-sheet answer and a revenue answer have different
// universes, and `yearsHeld` / `quartersHeld` are returned so a family can say which one it is on.
//
// ── ⚠ `total_liabilities` — THE FIELD THE PLAN WARNED ABOUT, AND IT IS NOT WHERE IT LOOKS ─────────
// `fundamentals.total_liabilities` is 113 of 11,144 rows (1.01%, 46 stocks). Re-measured, and it is
// exactly as reported. TWO things follow, and the second is the opposite of what the warning implies:
//
//   · The non-financial READ MODEL does not expose it at all — `AnnualSnapshot` has no
//     `totalLiabilities` and no `noncurrentLiabilities`. So this resolver CANNOT reach the near-empty
//     column even if it wanted to, and the balance sheet below carries current liabilities and
//     borrowings as separate filed lines with a group note saying why there is no total.
//   · ⚠ `nbfc_fundamentals.total_liabilities` IS A DIFFERENT COLUMN, is 504 of 874 rows (58%), and IS
//     exposed (`NbfcAnnual.totalLiabilities`). Measured live on BAJFINANCE: present. So someone who
//     reads "total_liabilities is 1% populated", then sees a working liabilities total on an NBFC,
//     will conclude the measurement was wrong. It is not — they are two tables with one column name.
//
// ⚠ AND THE TOTAL IS NEVER RECONSTRUCTED FROM THE PARTS. `Fundamental.totalLiabilities`'s own schema
//   comment records that current + non-current is NOT the total (a disposal group tags a third
//   bucket) and that reconstructing it "is what made all 48 balance-sheet faults". An absent subtotal
//   stays absent and gets words.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { buildFundamentalsView } from "../scoring/read/fundamentals-view.service.js";
import type { Basis, FundamentalsView, IndustryFamily } from "../scoring/read/fundamentals-view.types.js";
import { resolveStockCoverage } from "./stock-coverage.js";
import { absent, coverageReadFailed, resolved, type Coverage, type Resolved, type Source } from "./contract.js";
import type { StatementUnit } from "../section/kinds/statement-table.js";

/**
 * ★ WHICH STATEMENT THE READER ASKED FOR.
 *
 * ⚠ THIS IS A PARAMETER, NOT FOUR FAMILIES, AND THE DISTINCTION IS THE FINDING. OA's four answers
 *   (register / flow / dealing / pledging) read different TABLES and produce different SECTION
 *   SEQUENCES — they are four answers. F's four read the same filing and produce the same sequence
 *   with different rows in the table, so fragmenting them into four compositions would be building
 *   the variant §4.1 warns about at the composition layer instead of the renderer layer.
 *
 *   What it genuinely changes: which lines, WHICH CADENCE (the P&L is quarterly; the balance sheet
 *   and the cash flow are annual-only in every one of the five families), and therefore which depth
 *   story the answer has to tell.
 */
export type StatementFocus = "pnl" | "balance_sheet" | "cash_flow" | "returns";

export interface StatementCellRead {
  readonly value: number | null;
  /** `false` ⇒ this line was not reported in this period. Distinct from a filed zero. */
  readonly filed: boolean;
}

export interface StatementLineRead {
  readonly key: string;
  readonly label: string;
  readonly unit: StatementUnit;
  readonly role: "line" | "subtotal" | "total";
  /** Parallel to `periods`, oldest → newest. */
  readonly cells: readonly StatementCellRead[];
}

export interface StatementGroupRead {
  readonly label: string;
  readonly lines: readonly StatementLineRead[];
  readonly note: string | null;
}

export interface StatementRead {
  readonly symbol: string;
  readonly family: IndustryFamily;
  readonly familyLabel: string;
  /** ★ THE BASIS ACTUALLY READ. Required — see the header. */
  readonly basisRead: Basis;
  readonly basisAvailable: readonly Basis[];
  readonly focus: StatementFocus;
  readonly cadence: "quarterly" | "annual";
  /** Chronological, oldest → newest. */
  readonly periods: readonly string[];
  readonly groups: readonly StatementGroupRead[];
  readonly quartersHeld: number;
  readonly yearsHeld: number;
  /** How many periods the READER asked for, or `null`. §3.3 — resolved, never as-requested. */
  readonly asked: number | null;
  /** How many periods exist at this cadence, before the display cap. */
  readonly heldAtCadence: number;
  /** The read model's own honest data-state flags, forwarded rather than re-derived. */
  readonly notes: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE LINE DEFINITIONS — five families × four statements.
//
// ★ WRITTEN OUT PER FAMILY RATHER THAN ALIASED, AND THE ALIAS APPROACH IS THE ONE THAT WOULD BE
//   WRONG. `blocks-stock.ts#resolveQuarterSeries` aliases across families — "Revenue" reads
//   `revenue ?? totalIncome ?? netInterestIncome ?? grossPremium` — which is right for ONE headline
//   row where the reader's question ("show me the last eight quarters") is family-agnostic. A
//   STATEMENT is not family-agnostic: a bank's P&L runs Interest earned → Interest expended → NII →
//   PPOP → Provisions → PAT, and there is no row in it that "Revenue" is a synonym for. Aliasing a
//   statement produces a manufacturer's statement with a bank's numbers in it.
//
// ⚠ `role` MARKS THE FILING'S OWN SUBTOTALS. It is never an instruction to add the rows above — see
//   `statement-table.ts`'s header and the balance-sheet note below.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
interface LineDef {
  readonly key: string;
  readonly label: string;
  readonly unit: StatementUnit;
  readonly role: "line" | "subtotal" | "total";
}
const L = (key: string, label: string, unit: StatementUnit = "cr", role: LineDef["role"] = "line"): LineDef =>
  ({ key, label, unit, role });

/** A statement definition: the rows, the cadence it is filed at, and what is knowingly missing. */
interface StatementDef {
  readonly label: string;
  readonly cadence: "quarterly" | "annual";
  readonly lines: readonly LineDef[];
  readonly note: string | null;
}

/**
 * ⚠ THE BALANCE-SHEET NOTE IS NOT BOILERPLATE. It is the sentence that stops a reader who knows a
 *   balance sheet from concluding we dropped the liabilities total — see the header's measurement.
 */
// ⚠ THE POPULATION FIGURE CAME OUT OF THIS. It read "the filing's own total is held for 46 companies
//   out of 2,290" — a fact about our ingestion, not about this company, and §4.5 rule 3 keeps facts
//   about the machinery off the answer for the same reason it keeps weights and thresholds off it.
//   The measurement stays in this file's header, where it justifies the decision.
const NF_BS_NOTE =
  "There is no liabilities total on this statement: this company did not file its own, and adding " +
  "current and non-current liabilities together does not produce one — a disposal group is tagged " +
  "as a third bucket, so a reconstructed total would be wrong rather than approximate. The filed " +
  "components are shown instead.";

const DEFS: Record<IndustryFamily, Record<StatementFocus, StatementDef>> = {
  // ── NON-FINANCIAL. 2,175 stocks, and the only family with FCF and capex. ────────────────────────
  non_financial: {
    pnl: { label: "Profit and loss, as filed", cadence: "quarterly", note: null, lines: [
      L("revenue", "Revenue"),
      L("otherIncome", "Other income"),
      L("expenses", "Total expenses"),
      L("operatingProfit", "Operating profit", "cr", "subtotal"),
      L("depreciation", "Depreciation"),
      L("interest", "Finance costs"),
      L("profitBeforeTax", "Profit before tax", "cr", "subtotal"),
      L("tax", "Tax"),
      L("netProfit", "Net profit", "cr", "total"),
      L("operatingMargin", "Operating margin", "pct"),
      L("netMargin", "Net margin", "pct"),
    ]},
    balance_sheet: { label: "Balance sheet, as filed", cadence: "annual", note: NF_BS_NOTE, lines: [
      L("totalAssets", "Total assets", "cr", "subtotal"),
      L("propertyPlantAndEquipment", "Property, plant and equipment"),
      L("capitalWorkInProgress", "Capital work in progress"),
      L("noncurrentInvestments", "Non-current investments"),
      L("currentAssets", "Current assets", "cr", "subtotal"),
      L("inventories", "Inventories"),
      L("cashAndCashEquivalents", "Cash and equivalents"),
      L("currentLiabilities", "Current liabilities", "cr", "subtotal"),
      L("borrowingsCurrent", "Borrowings — current"),
      L("borrowingsNoncurrent", "Borrowings — non-current"),
      L("totalDebt", "Total debt", "cr", "subtotal"),
      L("equityShareCapital", "Share capital"),
      L("otherEquity", "Reserves and surplus"),
      L("totalEquity", "Total equity", "cr", "total"),
      L("debtToEquity", "Debt to equity", "x"),
      L("currentRatio", "Current ratio", "x"),
    ]},
    cash_flow: { label: "Cash flow, as filed", cadence: "annual", note: null, lines: [
      L("cashFromOperating", "Cash from operations"),
      L("capex", "Capital expenditure"),
      L("fcf", "Free cash flow", "cr", "subtotal"),
      L("cashFromInvesting", "Cash from investing"),
      L("cashFromFinancing", "Cash from financing"),
      L("netProfit", "Net profit, for comparison"),
      L("dividendPayout", "Dividend payout", "pct"),
    ]},
    returns: { label: "What it earns on what it uses", cadence: "annual", note: null, lines: [
      L("roe", "Return on equity", "pct"),
      L("roce", "Return on capital employed", "pct"),
      L("roa", "Return on assets", "pct"),
      L("operatingMargin", "Operating margin", "pct"),
      L("netMargin", "Net margin", "pct"),
      L("interestCoverage", "Interest coverage", "x"),
      L("basicEps", "Earnings per share", "inr"),
      L("bookValuePerShare", "Book value per share", "inr"),
    ]},
  },

  // ── BANKING. 40 stocks. A DIFFERENT P&L — NII not revenue, PPOP not EBITDA. No FCF. ─────────────
  banking: {
    pnl: { label: "Profit and loss, as filed", cadence: "quarterly", note: null, lines: [
      L("interestEarned", "Interest earned"),
      L("interestExpended", "Interest expended"),
      L("nii", "Net interest income", "cr", "subtotal"),
      L("otherIncome", "Other income"),
      L("totalIncome", "Total income", "cr", "subtotal"),
      L("employeesCost", "Employee cost"),
      L("operatingExpenses", "Operating expenses"),
      L("ppop", "Pre-provision operating profit", "cr", "subtotal"),
      L("provisions", "Provisions"),
      L("netProfit", "Net profit", "cr", "total"),
      L("costToIncome", "Cost to income", "pct"),
    ]},
    balance_sheet: { label: "Balance sheet, as filed", cadence: "annual", note:
      "A bank's balance sheet is a funding statement: deposits are the liability and advances are the " +
      "asset. The non-financial lines — inventories, capital work in progress, free cash flow — do not " +
      "exist here, and their absence is the statement's shape rather than a gap in it.", lines: [
      L("deposits", "Deposits"),
      L("borrowings", "Borrowings"),
      L("otherLiabilities", "Other liabilities"),
      L("capitalAndLiabilities", "Capital and liabilities", "cr", "subtotal"),
      L("advances", "Advances"),
      L("investments", "Investments"),
      L("cashAndBalancesWithRbi", "Cash and balances with the RBI"),
      L("totalAssets", "Total assets", "cr", "subtotal"),
      L("capital", "Capital"),
      L("reservesAndSurplus", "Reserves and surplus"),
      L("netWorth", "Net worth", "cr", "total"),
      L("creditDepositRatio", "Credit to deposit ratio", "pct"),
    ]},
    cash_flow: { label: "Cash flow, as filed", cadence: "annual", note:
      "There is no free-cash-flow line for a bank and there never will be: capital expenditure against " +
      "operating cash is not a meaningful measure of a lender.", lines: [
      L("cashFromOperating", "Cash from operations"),
      L("cashFromInvesting", "Cash from investing"),
      L("cashFromFinancing", "Cash from financing"),
      L("netCashFlow", "Net change in cash", "cr", "subtotal"),
      L("netProfit", "Net profit, for comparison"),
    ]},
    returns: { label: "What it earns, and what it is carrying", cadence: "annual", note: null, lines: [
      L("roe", "Return on equity", "pct"),
      L("roaDisclosed", "Return on assets", "pct"),
      L("nim", "Net interest margin", "pct"),
      L("costToIncome", "Cost to income", "pct"),
      L("creditCostPct", "Credit cost", "pct"),
      L("gnpaPct", "Gross non-performing assets", "pct"),
      L("nnpaPct", "Net non-performing assets", "pct"),
      L("pcr", "Provision coverage", "pct"),
      L("cet1", "CET1 capital", "pct"),
      L("tier1", "Tier 1 capital", "pct"),
      L("basicEps", "Earnings per share", "inr"),
      L("bookValuePerShare", "Book value per share", "inr"),
    ]},
  },

  // ── NBFC. 142 stocks, ALL TIER 1 — none is scored, and the answer must not imply otherwise. ─────
  nbfc: {
    pnl: { label: "Profit and loss, as filed", cadence: "quarterly", note: null, lines: [
      L("interestIncome", "Interest income"),
      L("feeAndCommissionIncome", "Fee and commission income"),
      L("otherIncome", "Other income"),
      L("totalIncome", "Total income", "cr", "subtotal"),
      L("financeCosts", "Finance costs"),
      L("nii", "Net interest income", "cr", "subtotal"),
      L("impairmentOnFinancialInstruments", "Impairment on financial instruments"),
      L("totalExpenses", "Total expenses", "cr", "subtotal"),
      L("profitBeforeTax", "Profit before tax", "cr", "subtotal"),
      L("tax", "Tax"),
      L("netProfit", "Net profit", "cr", "total"),
      L("netMargin", "Net margin", "pct"),
    ]},
    balance_sheet: { label: "Balance sheet, as filed", cadence: "annual", note:
      "An NBFC files an Ind-AS financial-statement layout, so financial and non-financial assets and " +
      "liabilities are separated and both totals are the filing's own.", lines: [
      L("loans", "Loans (the book)"),
      L("investments", "Investments"),
      L("cashAndCashEquivalents", "Cash and equivalents"),
      L("financialAssets", "Financial assets", "cr", "subtotal"),
      L("nonFinancialAssets", "Non-financial assets", "cr", "subtotal"),
      L("totalAssets", "Total assets", "cr", "subtotal"),
      L("borrowings", "Borrowings"),
      L("debtSecurities", "Debt securities"),
      L("depositsLiabilities", "Deposits"),
      L("financialLiabilities", "Financial liabilities", "cr", "subtotal"),
      L("totalLiabilities", "Total liabilities", "cr", "subtotal"),
      L("totalEquity", "Total equity", "cr", "total"),
      L("borrowingsToEquity", "Borrowings to equity", "x"),
    ]},
    cash_flow: { label: "Cash flow, as filed", cadence: "annual", note:
      "There is no free-cash-flow line for a lender: growth in the loan book consumes cash by design, " +
      "so operating cash flow reads as negative in a good year.", lines: [
      L("cashFromOperating", "Cash from operations"),
      L("cashFromInvesting", "Cash from investing"),
      L("cashFromFinancing", "Cash from financing"),
      L("netCashFlow", "Net change in cash", "cr", "subtotal"),
      L("netProfit", "Net profit, for comparison"),
    ]},
    returns: { label: "What it earns, and how it is funded", cadence: "annual", note: null, lines: [
      L("roe", "Return on equity", "pct"),
      L("nim", "Net interest margin", "pct"),
      L("spread", "Lending spread", "pct"),
      L("costToIncomeRatio", "Cost to income", "pct"),
      L("creditCostPct", "Credit cost", "pct"),
      // ⚠ A MULTIPLE, NEVER A PERCENT — 3.13×, not "313%". The read model's own type says so.
      L("borrowingsToEquity", "Borrowings to equity", "x"),
      L("capitalToAssetsRatio", "Capital to assets", "pct"),
      L("basicEps", "Earnings per share", "inr"),
      L("bookValuePerShare", "Book value per share", "inr"),
    ]},
  },

  // ── LIFE INSURANCE. 5 stocks, all tier 1. Policyholders'-fund accounting, not a revenue P&L. ────
  life_insurance: {
    pnl: { label: "Revenue account, as filed", cadence: "quarterly", note: null, lines: [
      L("grossPremiumIncome", "Gross premium income"),
      L("netPremiumIncome", "Net premium income", "cr", "subtotal"),
      L("incomeFirstYearPremium", "First-year premium"),
      L("incomeRenewalPremium", "Renewal premium"),
      L("incomeSinglePremium", "Single premium"),
      L("incomeFromInvestments", "Income from investments"),
      L("benefitsPaidNet", "Benefits paid, net"),
      L("changeInValuationOfLiabilities", "Change in valuation of liabilities"),
      L("netProfit", "Net profit", "cr", "total"),
      // A MULTIPLE against the IRDAI 150% floor — 1.90×, never "1.9%".
      L("solvencyRatio", "Solvency ratio", "x"),
    ]},
    balance_sheet: { label: "Sources and application of funds, as filed", cadence: "annual", note:
      "A life insurer files sources and application of funds rather than an assets-and-liabilities " +
      "balance sheet, and the policyholders' fund dominates both sides.", lines: [
      L("shareCapital", "Share capital"),
      L("reservesAndSurplus", "Reserves and surplus"),
      L("policyholdersFunds", "Policyholders' funds"),
      L("totalSourcesOfFunds", "Total sources of funds", "cr", "subtotal"),
      L("investmentsPolicyholders", "Investments — policyholders"),
      L("investmentsShareholders", "Investments — shareholders"),
      L("assetsHeldToCoverLinkedLiabilities", "Assets held to cover linked liabilities"),
      L("totalApplicationOfFunds", "Total application of funds", "cr", "subtotal"),
      L("netWorth", "Net worth", "cr", "total"),
    ]},
    cash_flow: { label: "Cash flow, as filed", cadence: "annual", note:
      "No free-cash-flow line exists for an insurer: premium received ahead of claims paid is float, " +
      "not cash generation.", lines: [
      L("netProfit", "Net profit"),
      L("surplusFromRevenueAccount", "Surplus from the revenue account", "cr", "subtotal"),
      L("totalOperatingExpenses", "Total operating expenses"),
      L("totalCommission", "Total commission"),
    ]},
    returns: { label: "What it earns, and whether the book sticks", cadence: "annual", note: null, lines: [
      L("roe", "Return on equity", "pct"),
      L("solvencyRatio", "Solvency ratio", "x"),
      L("newBusinessPremiumPct", "New-business premium share", "pct"),
      L("expenseRatioPolicyholders", "Expense ratio", "pct"),
      L("basicEps", "Earnings per share", "inr"),
      L("bookValuePerShare", "Book value per share", "inr"),
    ]},
  },

  // ── GENERAL INSURANCE. 6 stocks, all tier 1. Combined-ratio underwriting accounting. ────────────
  general_insurance: {
    pnl: { label: "Underwriting account, as filed", cadence: "quarterly", note: null, lines: [
      L("grossPremiumsWritten", "Gross premiums written"),
      L("netPremium", "Net premium", "cr", "subtotal"),
      L("premiumEarned", "Premium earned", "cr", "subtotal"),
      L("incurredClaims", "Incurred claims"),
      L("netCommission", "Net commission"),
      L("underwritingProfitOrLoss", "Underwriting profit or loss", "cr", "subtotal"),
      L("netProfit", "Net profit", "cr", "total"),
      // A PERCENT that can legitimately exceed 100 — above 100 is an underwriting loss, and it is a
      // fact rather than a verdict.
      L("combinedRatio", "Combined ratio", "pct"),
      L("incurredClaimRatio", "Incurred claim ratio", "pct"),
    ]},
    balance_sheet: { label: "Sources and application of funds, as filed", cadence: "annual", note:
      "The investments line is the filing's own and is not reconciled against total assets — that is " +
      "the general-insurance convention, not a missing figure.", lines: [
      L("shareCapital", "Share capital"),
      L("reservesAndSurplus", "Reserves and surplus"),
      L("borrowings", "Borrowings"),
      L("totalSourcesOfFunds", "Total sources of funds", "cr", "subtotal"),
      L("investments", "Investments"),
      L("cashAndBankBalances", "Cash and bank balances"),
      L("currentLiabilities", "Current liabilities"),
      L("totalApplicationOfFunds", "Total application of funds", "cr", "subtotal"),
      L("netWorth", "Net worth", "cr", "total"),
    ]},
    cash_flow: { label: "Cash flow, as filed", cadence: "annual", note:
      "No free-cash-flow line exists for an insurer — see the underwriting account above.", lines: [
      L("netProfit", "Net profit"),
      L("underwritingProfitOrLoss", "Underwriting profit or loss", "cr", "subtotal"),
      L("totalOperatingExpensesRelatedToInsurance", "Operating expenses"),
      L("premiumDeficiency", "Premium deficiency reserve"),
    ]},
    returns: { label: "What it earns on what it underwrites", cadence: "annual", note: null, lines: [
      L("roe", "Return on equity", "pct"),
      L("combinedRatio", "Combined ratio", "pct"),
      L("incurredClaimRatio", "Incurred claim ratio", "pct"),
      L("expensesOfManagementRatio", "Expenses of management", "pct"),
      L("netRetentionRatio", "Net retention ratio", "pct"),
      L("solvencyRatio", "Solvency ratio", "x"),
      L("basicEps", "Earnings per share", "inr"),
      L("bookValuePerShare", "Book value per share", "inr"),
    ]},
  },
};

const FAMILY_LABEL: Record<IndustryFamily, string> = {
  non_financial: "Non-financial", banking: "Banking", nbfc: "NBFC",
  life_insurance: "Life insurance", general_insurance: "General insurance",
};

/**
 * ★ HOW THE FAMILY READS INSIDE A SENTENCE, WHICH IS NOT THE SAME STRING AS THE COLUMN HEADING.
 *
 * ⚠ CAUGHT LIVE: the opening read "Bajaj Finance Ltd files as a nbfc company" — the wrong article and
 *   a lower-cased acronym, from `FAMILY_LABEL[family].toLowerCase()` being dropped into prose. A label
 *   is a label and a sentence is a sentence; using one as the other is how a correct answer reads as
 *   a generated one.
 */
export const FAMILY_PHRASE: Record<IndustryFamily, string> = {
  non_financial: "a non-financial company",
  banking: "a bank",
  nbfc: "an NBFC",
  life_insurance: "a life insurer",
  general_insurance: "a general insurer",
};

/** Which of the five payloads this view populated. Exactly one is non-null (or none, for `built:false`). */
function payloadFor(v: FundamentalsView): Record<string, unknown> | null {
  const anyV = v as unknown as Record<string, unknown>;
  for (const k of ["nonFinancial", "banking", "nbfc", "lifeInsurance", "generalInsurance"]) {
    const p = anyV[k];
    if (p && typeof p === "object") return p as Record<string, unknown>;
  }
  return null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * ★ HOW MANY PERIODS THE TABLE CARRIES, and it is a display bound rather than a data one.
 *
 * ⚠ THE FULL SERIES IS NOT THE RIGHT ANSWER EVEN THOUGH WE HOLD IT. TCS files 32 quarters; a 32-column
 *   table is a horizontal scroll nobody reads, and the reader who wants all 32 is being sent to the
 *   Fundamentals tab by the answer's own links. Eight quarters is two years — long enough for
 *   seasonality to show — and nine years is everything the annual axis ever has (measured max: 9).
 */
const COLUMN_CAP = { quarterly: 8, annual: 9 } as const;

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ THE WINDOW — WHICH CADENCE AND HOW MANY COLUMNS, READ OFF THE SLOTS THE ROUTER ALREADY EMITS.
 *
 * ⚠ THIS EXISTS BECAUSE THE HARNESS CAUGHT THE FAMILY IGNORING TWO SLOTS. `I-DISTINCT` fired on
 *   "what is TCS's revenue trend" (`history`) against "what is TCS revenue" (`lookup`): two different
 *   questions, the same six sections, the same prose, byte for byte. The composition claimed three
 *   operations and treated all three identically, so `operation` and `timeframe` were being routed
 *   correctly and then thrown away — which is worse than not claiming them, because the reader gets a
 *   confident answer to a question they did not ask.
 *
 * ★ THE RULE, AND IT IS ABOUT WHAT THE READER MEANT RATHER THAN ABOUT PASSING A GATE:
 *
 *   · A P&L QUESTION ASKING FOR YEARS GETS ANNUAL ROWS. "Ten years of revenue" is forty quarters, and
 *     nobody means forty quarters — they mean the annual line. Measured, we hold at most 9 annual
 *     years anywhere, so the answer will be shorter than asked and must say so.
 *   · A P&L QUESTION WITH `operation: "history"` AND NO EXPLICIT TIMEFRAME ALSO GETS ANNUAL ROWS. "What
 *     is its revenue trend" is a question about the shape over years, not about the last two.
 *   · THE OTHER THREE STATEMENTS ARE ANNUAL WHATEVER IS ASKED, because that is when they are filed.
 *     A reader who asks for eight quarters of balance sheet is asking for something that does not
 *     exist, and the answer says that rather than silently substituting years.
 *
 * ⚠ AND THE WINDOW IS RESOLVED, NEVER AS-REQUESTED (§3.3). `asked` rides back on the read so the
 *   family can say "you asked for ten and we hold eight" — a caller that quietly returns eight has
 *   answered a different question and left no trace of it.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export interface StatementWindow {
  readonly cadence: "quarterly" | "annual";
  /** How many columns the reader asked for. `null` ⇒ they did not say, so the cap applies. */
  readonly asked: number | null;
}

export function statementWindow(
  focus: StatementFocus,
  operation: string,
  timeframe: { kind: "latest" | "quarters" | "years"; n: number | null } | null,
): StatementWindow {
  // The three annual-filed statements. A `quarters` request here cannot be honoured by any filing.
  if (focus !== "pnl") return { cadence: "annual", asked: timeframe?.kind === "years" ? timeframe.n : null };

  if (timeframe?.kind === "years") return { cadence: "annual", asked: timeframe.n };
  if (timeframe?.kind === "quarters") return { cadence: "quarterly", asked: timeframe.n };
  // ★ A TREND QUESTION WITH NO STATED WINDOW IS AN ANNUAL QUESTION. "What is its revenue trend" and
  //   "what is its revenue" are different questions and were producing one answer.
  if (operation === "history") return { cadence: "annual", asked: null };
  return { cadence: "quarterly", asked: null };
}

export async function resolveStatements(
  symbol: string,
  focus: StatementFocus,
  /** Omitted ⇒ the statement's own filed cadence at the display cap. */
  window?: StatementWindow,
): Promise<Resolved<StatementRead>> {
  const sym = (symbol ?? "").trim().toUpperCase();
  const cov = await resolveStockCoverage(sym);
  if (coverageReadFailed(cov)) return absent<StatementRead>("read_failed", { subject: null, query: null });
  const coverage: Coverage = cov.coverage;
  if (!sym) return absent<StatementRead>("not_in_universe", coverage);
  if (!cov.ok && cov.absent.reason === "not_in_universe") {
    return absent<StatementRead>("not_in_universe", coverage);
  }

  // ⚠ THIS FILE ALREADY KNEW THE DISTINCTION AND STILL COLLAPSED IT — F-3. The comment below said "a
  //   view we could not build is OUR absence, and it is not the same as an empty one", and then
  //   returned `not_ingested`, whose contract is "no quarterly row in ANY of the five industry
  //   tables" — a statement about the record. Half-noticing a defect is how it survives a review.
  let viewRead = true;
  const v = await buildFundamentalsView(sym).catch(() => { viewRead = false; return null; });
  if (!viewRead) return absent<StatementRead>("read_failed", coverage);
  // A view that built and came back empty IS our absence, and `not_ingested` is the right word for it.
  if (!v) return absent<StatementRead>("not_ingested", coverage);
  // `built: false` is the read model's own honest state for a family whose payload is not implemented.
  // Reporting it as "no results filed" would blame the company for our gap.
  const payload = payloadFor(v);
  if (!v.built || !payload) return absent<StatementRead>("not_ingested", coverage);

  const family = v.industryType;
  const def = DEFS[family][focus];
  // ★ THE WINDOW WINS OVER THE DEFINITION'S DEFAULT, and only ever between quarterly and annual —
  //   both of which the read model holds for every family. A definition's `cadence` remains the
  //   answer when no window was passed.
  const cadence = window?.cadence ?? def.cadence;
  const askedColumns = window?.asked ?? null;

  // ── THE ROWS THE FILING GIVES US, AT THIS CADENCE ─────────────────────────────────────────────
  const rows = (cadence === "quarterly"
    ? (payload.quarters as Record<string, unknown>[] | undefined)
    : (payload.annualSeries as Record<string, unknown>[] | undefined)) ?? [];

  if (rows.length === 0) {
    // ★ THE ABSENT REASON IS CADENCE-SPECIFIC, AND THE TWO PHRASES ARE DIFFERENT ANSWERS. A company
    //   with one quarter and no annual accounts (MANIPALHOS, measured: 1q / 0y) can answer a revenue
    //   question and cannot answer a balance-sheet one — and "we hold no quarterly results" would be
    //   false about the first while "we hold no annual accounts" is true about the second.
    return absent<StatementRead>(
      cadence === "annual" ? "insufficient_annual_history" : "insufficient_quarters",
      coverage,
    );
  }

  // ⚠ THE ASKED-FOR COUNT IS A CEILING ON THE CAP, NOT A REPLACEMENT FOR IT. A reader asking for 40
  //   quarters gets the cap; one asking for 4 gets 4. And what they GET rides back as `periods.length`
  //   beside `asked`, so the family can state the shortfall rather than quietly serving less.
  const want = askedColumns !== null && askedColumns > 0
    ? Math.min(askedColumns, COLUMN_CAP[cadence])
    : COLUMN_CAP[cadence];
  const tail = rows.slice(Math.max(0, rows.length - want));

  const cellsFor = (r: Record<string, unknown>, key: string): StatementCellRead => {
    const val = num(r[key]);
    // ⚠ `filed: false` IS NOT `value === 0`. A filed zero is a real figure — a company that paid no
    //   tax paid no tax — and the read layer's `zeroToNull` guard already removed the zeros that
    //   were really absences. Conflating them here would put the zero-for-unknown defect back in at
    //   the display layer, one step after the resolvers removed it.
    return { value: val, filed: val !== null };
  };

  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ A PERIOD IN WHICH NOTHING ON THIS STATEMENT WAS FILED IS DROPPED AS A COLUMN.
   *
   * ⚠ FOUND BY LOOKING AT THE RENDERED TABLE, NOT BY A GATE, AND THAT IS THE POINT OF HAVING LOOKED.
   *   TCS's balance sheet came back with EIGHT columns of which the first four were the word "not
   *   reported" in every single row — the annual P&L reaches back to FY19 and the balance-sheet line
   *   items do not. Every assertion passed: the rows were real, the basis was stated, nothing
   *   overflowed. It simply read as a broken component, which is exactly what §4.5 rule 2 forbids
   *   ("a bordered box around a dash reads as a component that failed to load").
   *
   * ★ IT IS THE COLUMN ANALOGUE OF THE ROW FILTER BELOW, AND THE SAME ARGUMENT. A row unfiled in
   *   every period is dropped; a period unfiled on every row is the same emptiness turned ninety
   *   degrees, and it was only caught later because a table has two axes and the first draft
   *   defended one of them.
   *
   * ⚠ AND IT IS WHY `heldAtCadence` IS COUNTED AFTER THIS RATHER THAN BEFORE. The depth sentence
   *   says how many periods the reader is looking at, so counting periods the reader cannot see
   *   would make the sentence disagree with the table beside it.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  const usable = tail.filter((r) => def.lines.some((d) => cellsFor(r, d.key).filed));
  const kept = usable.length > 0 ? usable : tail;
  const periods = kept.map((r) =>
    String(cadence === "quarterly" ? (r.periodKey ?? "") : (r.fiscalYear ?? "")),
  );

  const lines: StatementLineRead[] = def.lines.map((d) => ({
    key: d.key,
    label: d.label,
    unit: d.unit,
    role: d.role,
    cells: kept.map((r) => cellsFor(r, d.key)),
  }))
    // ★ A ROW NOTHING WAS FILED FOR IN ANY PERIOD IS DROPPED, and this is §4.5 rule 2 at row level. A
    //   twelve-row balance sheet where four rows are dashes in every column reads as a component that
    //   failed to load; the GROUP NOTE carries what is missing and why, in words. A row absent in
    //   SOME periods stays, because that is a real and readable fact about the filings.
    .filter((l) => l.cells.some((c) => c.filed));

  const groups: StatementGroupRead[] = [{ label: def.label, lines, note: def.note }];

  /**
   * ★ HOW MANY PERIODS THIS STATEMENT ACTUALLY HAS, which is not how many periods the company filed.
   *   Counted over the WHOLE series rather than the display tail, so "you asked for ten and we hold
   *   three" is measured against what exists rather than against what fitted.
   */
  const heldForStatement = rows.filter((r) => def.lines.some((d) => cellsFor(r, d.key).filed)).length;

  return resolved<StatementRead>(
    {
      symbol: sym,
      family,
      familyLabel: FAMILY_LABEL[family],
      basisRead: v.basis,
      basisAvailable: v.basisAvailable,
      focus,
      cadence,
      periods,
      groups,
      quartersHeld: v.historyDepth.quarters,
      yearsHeld: v.historyDepth.years,
      asked: askedColumns,
      /** ★ PERIODS THAT CARRY AT LEAST ONE LINE OF *THIS* STATEMENT, before the display cap — not
       *  every period the company filed. §3.3: the resolved count is what the reader can see. */
      heldAtCadence: heldForStatement || rows.length,
      notes: v.notes,
    },
    coverage,
    ["stocks", "quarterly_results"] satisfies Source[],
  );
}

/**
 * ★ WHICH STATEMENT THE QUESTION IS ABOUT — code-extracted from the raw sentence.
 *
 * ⚠ THE SLOTS CANNOT SEPARATE THESE, AND THAT IS WHY THIS FUNCTION EXISTS RATHER THAN A PREDICATE.
 *   "what is TCS's revenue", "how much debt does TCS carry", "does TCS convert profit into cash" and
 *   "what does TCS earn on equity" all route `lookup` + `fundamentals`. This is the same shape as the
 *   T08 misroute in OA; the difference is that here the four share a section sequence, so they are a
 *   PARAMETER on one composition rather than four of them (see `StatementFocus`).
 *
 * ⚠ WORD LISTS, NOT REGEX LITERALS, AND THAT IS AN INHERITED SCAR. `families/reader.ts#readerShape`
 *   records it: three times in this build a `\b` written into a regex through a script became a
 *   literal 0x08 backspace — invisible in every listing, matching nothing. A membership test over
 *   lowercased words cannot be corrupted that way.
 *
 * The order is the ruling: the two narrow statements are tested before the two broad ones, because
 * "how much cash does its debt cost" contains both a debt word and a cash word and is a balance-sheet
 * question.
 */
export interface FocusRead {
  readonly focus: StatementFocus;
  /**
   * ★ WHETHER THE READER NAMED A STATEMENT, AND IT IS A SEPARATE FACT FROM WHICH ONE.
   *
   * ⚠ `pnl` IS BOTH A REAL ANSWER AND THE DEFAULT, so `focus === "pnl"` cannot tell "what is TCS
   *   revenue" from "show me TCS financials". Those are a narrow question and a broad one, and the
   *   harness caught them producing one byte-identical answer (`I-DISTINCT`, this batch). The broad
   *   question deserves more than one statement; the narrow one deserves exactly the one asked for.
   */
  readonly explicit: boolean;
}

export function statementFocus(raw: string): FocusRead {
  const lower = raw.toLowerCase();
  const words = new Set(lower.replace(/[^a-z ]+/g, " ").split(/ +/).filter(Boolean));
  const any = (...xs: string[]) => xs.some((x) => words.has(x));

  /**
   * ★★ A SHORT PHRASE LIST, TESTED BEFORE THE WORD SETS, AND IT IS NOT A HEDGE AGAINST THEM.
   *
   * ⚠ CAUGHT LIVE, ON THE REAL MODEL: "what does HDFCBANK earn on equity" routed to the BALANCE SHEET,
   *   because `equity` is a balance-sheet word and the balance-sheet set is tested first. The question
   *   is a return-on-equity question and the answer it got was a real, well-rendered balance sheet —
   *   §6.2's confident-wrong-artifact arriving through a word list rather than through a slot.
   *
   * ★ THE FIX IS A PHRASE, BECAUSE THE INFORMATION IS IN THE PAIRING. A membership test over a bag of
   *   words cannot tell "return on equity" from "equity", and no amount of reordering the sets fixes
   *   that — the ordering would just move the failure to a different pair. These four phrases are the
   *   ones where a single word points the wrong way, and each is unambiguous on its own.
   *
   * ⚠ SUBSTRING, NOT `\b`. A word boundary written into a regex through a script has become a literal
   *   0x08 backspace three times in this repo — see `readerShape`'s note. These strings have a leading
   *   space or start the phrase, which is the boundary they actually need.
   */
  const phrase = (...xs: string[]) => xs.some((x) => lower.includes(x));
  if (phrase("return on", "returns on", "earn on", "earns on", "earning on", "yield on")) {
    return { focus: "returns", explicit: true };
  }

  // ⚠ "owe" WAS MISSING AND THE HARNESS CAUGHT IT WITHIN ONE RUN. "What does BAJFINANCE owe" fell to
  //   the P&L default and produced a byte-identical answer to "show me BAJFINANCE financials" —
  //   `I-DISTINCT`, on the pair of cases added for the NBFC statement family. The plainest English
  //   for a balance-sheet question was not in the list that recognises balance-sheet questions.
  if (any("balance", "assets", "asset", "liabilities", "liability", "debt", "debts", "owe", "owes",
          "owed", "owing", "borrowings", "borrowing", "leverage", "equity", "networth", "solvency",
          "gearing", "inventory", "inventories", "receivables", "deposits", "advances", "reserves",
          "capital")) return { focus: "balance_sheet", explicit: true };
  if (any("cash", "cashflow", "capex", "fcf", "conversion", "dividend", "dividends", "payout",
          "spending", "spend", "investing", "financing")) return { focus: "cash_flow", explicit: true };
  if (any("roe", "roce", "roa", "returns", "efficiency", "eps", "nim", "casa", "gnpa", "npa",
          "coverage", "ratio", "ratios", "profitability", "combined", "persistency")) return { focus: "returns", explicit: true };
  // ★ THE DEFAULT IS THE P&L, AND IT IS THE RIGHT DEFAULT RATHER THAN A FALLBACK. Revenue, profit and
  //   margin are what "how are the financials" means to a reader, and they are the only statement
  //   filed quarterly — so the default is also the one with the widest universe (1,868 stocks at 8
  //   quarters against 425 at 5 annual years).
  //
  // ⚠ `explicit` DISTINGUISHES A NAMED P&L QUESTION FROM AN UNNAMED ONE. "What is TCS revenue" names
  //   a P&L line; "show me TCS financials" names nothing and is a broader question — see `FocusRead`.
  const namedPnl = any("revenue", "profit", "margin", "margins", "sales", "earnings", "income",
                       "topline", "bottomline", "pnl", "ebitda", "turnover", "expenses", "tax");
  return { focus: "pnl", explicit: namedPnl };
}
