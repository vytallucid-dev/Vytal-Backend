// ─────────────────────────────────────────────────────────────
// LEGACY V2 XBRL PARSER (in-bse-fin namespace)
//
// Handles the OLD pre-Integrated-Filing taxonomy used before April 2025.
//
// Used ONLY by: legacy/backfill-legacy.ts (historical backfill)
// ─────────────────────────────────────────────────────────────

import { deriveFiscalPeriod } from "../xbrl/parser-common.js";
import type {
  FilingTaxonomy,
  NseFilingEntry,
  ParsedQuarterlyResult,
  ResultType,
} from "../xbrl/types.js";
import { evaluateZeroBlock, type FactReader } from "../xbrl/zero-block-guard.js";

const RUPEES_PER_CRORE = 1e7;

// ───────────────────────────────────────────────────────────
// ★ DIMENSIONLESS CONCEPTS — A NAMED LIST, NOT A RULE.
//
// extractNumber divides by 1e7 whenever the declared unit is "INR", and it
// DEFAULTS to "INR" when no unitRef is present at all. Two in-bse-fin ratio
// concepts hit that path and are silently destroyed by it:
//
//   ReturnOnAssets   declares unitRef="INR" on a value that is a ratio
//   PercentageOfNpa  declares NO unitRef at all, so the default applies
//
// Both land in Decimal(8,6) columns, so ÷1e7 does not merely mis-scale them,
// it TRUNCATES THEM TO EXACTLY ZERO — a wrong number that reads as a real
// measurement rather than as a gap.
//
// MEASURED, tag audit inventory (_audit/inventory.json), every legacy banking
// document sampled — SBIN FY19, AXISBANK FY22, AUBANK FY24 (quarterly),
// UNIONBANK FY18, IDFCFIRSTB FY19 (annual):
//     in-bse-fin:ReturnOnAssets    unitRef="INR"   in 5 of 5
//     in-bse-fin:PercentageOfNpa   unitRef ABSENT  in 5 of 5
// MEASURED in the live table: banking_fundamentals.roa_disclosed stores
// exactly 0 on 241 of its 243 nse_xbrl_annual_legacy rows.
//
// ⚠ DO NOT WIDEN THIS TO "RATIOS ARE PURE". The list is named because the
//   taxonomy is wrong in BOTH directions: _audit/units.json records
//   ReserveExcludingRevaluationReserves — a genuine rupee amount — declaring
//   unitRef="pure" (SBIN 1,953,674,200,000). A blanket rule keyed on the
//   declared unit, or on the word "ratio", mis-scales real money.
//
// ⚠ NOR TO "NO unitRef MEANS DIMENSIONLESS". MEASURED in the SAME document
//   that motivates this list — AXISBANK FY24 annual,
//   BANKING_104697_1107859_25042024023559.xml — `Assets` in the OneI context
//   carries NO unitRef either, and it is 15,182,385,300,000: a rupee amount
//   that the ÷1e7 default renders correctly as ₹15,18,238.53 Cr. Exempting
//   every unit-less fact would destroy the balance sheet to rescue one ratio.
//
// ⚠ THE SIBLINGS ARE DELIBERATELY ABSENT FROM THIS LIST. PercentageOfGrossNpa,
//   CET1Ratio and AdditionalTier1Ratio all DO declare unitRef="pure" in the
//   same 5 documents, so they already take the correct path. Adding them would
//   be a no-op today and would blur what this list is for.
//
// SCOPE, MEASURED: across the full 36-document tag-audit sample, these two
// concepts appear in the 8 BANKING documents and in NONE of the other 28
// (non-financial, NBFC, life-insurance, general-insurance). The override
// therefore cannot reach a non-banking filing.
//
// ★ WHERE THE CORRUPTION COMES FROM — IT IS THE ARCHIVE, NOT THE FILER.
//   bse-extract.ts imports this same extractNumber and reads these same
//   concepts, so the two archives can be compared directly. MEASURED on SBIN
//   FY19 — the SAME filing, the SAME numbers, two archives:
//       NSE  nsearchives/BANKING_..._SBIN      ReturnOnAssets   unitRef="INR"   0.0009
//       BSE  bseindia/Banking_500112_...       ReturnOnAssets   unitRef="pure"  0.0009
//       NSE  (same pair)                       PercentageOfNpa  NO unitRef      0.0301
//       BSE  (same pair)                       PercentageOfNpa  unitRef="pure"  0.0301
//   The value is identical; only the unit declaration differs. Confirmed pure
//   on both concepts in 6 of 6 BSE banking documents sampled.
//
// ⚠ THE BSE LANE IS THEREFORE UNAFFECTED, AND THAT IS MEASURED, NOT ASSUMED.
//   _s7e-bse-noop.ts re-read all 104 BSE documents this repo has ever cited,
//   43 tags × 3 contexts each = 13,416 comparisons of extractNumber before and
//   after this change: 0 values moved. Since BSE declares both concepts pure,
//   the override returns exactly what the unit branch already returned.
const DIMENSIONLESS_CONCEPTS = new Set(["ReturnOnAssets", "PercentageOfNpa"]);

const QUARTERLY_PNL_CONTEXT = "OneD";
const ANNUAL_PNL_CONTEXT = "FourD";
const BALANCE_SHEET_CONTEXT = "OneI";

// ─────────────────────────────────────────────────────────────
// Generic extractors
// ─────────────────────────────────────────────────────────────

export function extractNumber(
  xml: string,
  tag: string,
  contextRef: string,
): number | null {
  const ns = factNs(xml);
  const re = new RegExp(
    `<${ns}:${tag}\\b[^>]*?contextRef="${contextRef}"[^>]*?>([\\-\\d.eE+]+)</${ns}:${tag}>`,
    "i",
  );
  const m = xml.match(re);
  if (!m) return null;

  const raw = parseFloat(m[1]);
  if (!Number.isFinite(raw)) return null;

  const unitRe = new RegExp(
    `<${ns}:${tag}\\b[^>]*?contextRef="${contextRef}"[^>]*?unitRef="([^"]+)"`,
    "i",
  );
  const unitFromCtx = xml.match(unitRe)?.[1];

  const unitRe2 = new RegExp(
    `<${ns}:${tag}\\b[^>]*?unitRef="([^"]+)"[^>]*?contextRef="${contextRef}"`,
    "i",
  );
  const unitFromCtx2 = xml.match(unitRe2)?.[1];

  const unit = unitFromCtx ?? unitFromCtx2 ?? "INR";

  // ★ The named override runs AFTER the unit is read, not instead of it, so
  //   the declared unit stays visible to anyone debugging this function.
  if (DIMENSIONLESS_CONCEPTS.has(tag)) return raw;

  if (unit === "INR") return raw / RUPEES_PER_CRORE;
  return raw;
}

// ─────────────────────────────────────────────────────────────
// ANNUAL CASH-FLOW EXTRACTION — FourD first, OneD only as a fallback.
//
// ⚠ THIS IS DELIBERATELY NOT A GENERAL FALLBACK. Read this before widening it.
//
// MEASURED 2026-08-16 across FY19–FY23 documents, the two duration contexts mean
// the same thing in EVERY vintage (they are dangling refs in FY19/FY21 — used but
// never defined by an <xbrli:context> — so the meaning was established from the
// values themselves):
//     OneD  = ONE quarter (Q4)          FourD = FOUR quarters (the full year)
//   ULTRACEMCO FY21 revenue  OneD 13,965.51 Cr vs FourD 43,188.34 Cr  (0.32)
//   ULTRACEMCO FY23 revenue  OneD 18,121.02 Cr vs FourD 61,326.50 Cr  (0.30)
//   ABB        FY20 revenue  OneD  1,700.76 Cr vs FourD  5,820.95 Cr  (0.29)
//   BHARTIARTL FY21 revenue  OneD 16,329.50 Cr vs FourD 64,325.90 Cr  (0.25)
// So reading OneD as an annual figure would import ONE QUARTER AS A YEAR. That is
// why P&L and balance-sheet fields keep their strict context and must keep it.
//
// The CASH-FLOW STATEMENT is the exception, and only because the FY21-vintage
// filers tagged a FULL-YEAR figure with the quarter context. The values prove it —
// each OneD-tagged cash flow is a year-sized number, not a quarter-sized one:
//   ULTRACEMCO  CF FY21 OneD 11,551.00 Cr  vs its own FourD CF FY22 8,669.66 / FY23 9,348.18
//   BHARTIARTL  CF FY21 OneD 34,392.30 Cr  vs its own FourD CF FY23 43,582.60
//   PIDILITIND  CF FY21 OneD  1,264.19 Cr  vs its own FourD CF FY23  1,432.36
// A quarter would be ~1/4 of those; ×4 would be wildly out of line with the same
// company's neighbouring annual figures.
//
// THREE PROPERTIES MAKE THIS SAFE:
//   1. SCOPE — applied ONLY to cash-flow-statement tags in the ANNUAL parser.
//      Revenue / PAT / PBT / expenses / every balance-sheet field are untouched,
//      so the "OneD is a quarter" hazard cannot reach them.
//   2. ORDER — FourD is always preferred. When a filer tags correctly (FY22+),
//      FourD wins and OneD is never consulted.
//   3. NO AMBIGUITY — MEASURED: in every document where a cash-flow tag appears
//      under OneD, it appears there ONLY. There is never a competing FourD value
//      for the same tag, so the fallback never has to choose between two.
function extractAnnualCashFlow(xml: string, tag: string): number | null {
  const primary = extractNumber(xml, tag, ANNUAL_PNL_CONTEXT);
  if (primary !== null) return primary;
  return extractNumber(xml, tag, QUARTERLY_PNL_CONTEXT);
}


// ═══════════════════════════════════════════════════════════════════════════════
// FACT-NAMESPACE DETECTION — added 2026-08-25 for Stage 7a.
//
// These extractors hardcoded the `in-bse-fin:` prefix. That is right for every
// non-financial, banking and NBFC filing, and WRONG for insurance: an insurer's
// results carry the SAME context names (OneD / OneI / FourD / FourI) and the SAME
// tag names (DateOfStartOfReportingPeriod, …) under a DIFFERENT prefix —
//   general insurance : bseindia.com/xbrl/2018-11-30/in-capmkt  (+ GeneralInsurance)
//   life insurance    : sebi.gov.in/xbrl/2025-01-31/in-capmkt   (+ IntegratedFinance_LI)
// so every lookup silently returned null and the period assertion could not prove
// a period it was actually looking straight at.
//
// The prefix is DETECTED from the instance rather than passed in, so no caller
// changes and no caller can pass the wrong one. `in-bse-fin` stays the default, so
// a document that declares neither behaves exactly as before.
// ═══════════════════════════════════════════════════════════════════════════════

/** The element prefix this instance uses for its facts. */
export function factNs(xml: string): string {
  // Match the DECLARATION, not the first element, so a stray namespaced attribute
  // cannot pick the prefix.
  if (/xmlns:in-bse-fin\s*=/.test(xml)) return "in-bse-fin";
  if (/xmlns:in-capmkt\s*=/.test(xml)) return "in-capmkt";
  return "in-bse-fin";
}

export function extractText(
  xml: string,
  tag: string,
  contextRef: string,
): string | null {
  const ns = factNs(xml);
  const re = new RegExp(
    `<${ns}:${tag}\\b[^>]*?contextRef="${contextRef}"[^>]*?>([^<]+)</${ns}:${tag}>`,
    "i",
  );
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

export function extractDate(
  xml: string,
  tag: string,
  contextRef: string,
): Date | null {
  const txt = extractText(xml, tag, contextRef);
  if (!txt) return null;
  const m = txt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
}

export function detectTaxonomy(xml: string, xbrlUrl?: string): FilingTaxonomy {
  const hasInterestEarned = /<in-bse-fin:InterestEarned[\s>]/.test(xml);
  const hasRevenueFromOperations =
    /<in-bse-fin:RevenueFromOperations[\s>]/.test(xml);

  if (hasInterestEarned && !hasRevenueFromOperations) return "banking";
  if (hasRevenueFromOperations && !hasInterestEarned) return "ind_as";

  if (xbrlUrl) {
    if (xbrlUrl.includes("/BANKING_")) return "banking";
    if (xbrlUrl.includes("/INDAS_")) return "ind_as";
  }
  return "ind_as";
}

// ─────────────────────────────────────────────────────────────
// QUARTERLY parsers — preserved from before, with context renamed for clarity
// ─────────────────────────────────────────────────────────────

function parseQuarterlyIndAsPnL(xml: string, resultType: ResultType) {
  const PNL = QUARTERLY_PNL_CONTEXT;
  const revenue = extractNumber(xml, "RevenueFromOperations", PNL);
  const otherIncome = extractNumber(xml, "OtherIncome", PNL);
  const expenses = extractNumber(xml, "Expenses", PNL);
  const depreciation = extractNumber(
    xml,
    "DepreciationDepletionAndAmortisationExpense",
    PNL,
  );
  const interest = extractNumber(xml, "FinanceCosts", PNL);
  const profitBeforeTax = extractNumber(xml, "ProfitBeforeTax", PNL);
  const tax = extractNumber(xml, "TaxExpense", PNL);
  const netProfit =
    (resultType === "consolidated"
      ? extractNumber(xml, "ProfitOrLossAttributableToOwnersOfParent", PNL)
      : null) ?? extractNumber(xml, "ProfitLossForPeriod", PNL);
  const operatingProfit =
    profitBeforeTax !== null && interest !== null && depreciation !== null
      ? round2(profitBeforeTax + interest + depreciation)
      : null;
  return {
    revenue,
    otherIncome,
    expenses,
    operatingProfit,
    depreciation,
    interest,
    profitBeforeTax,
    tax,
    netProfit,
  };
}


// ─────────────────────────────────────────────────────────────
// ★ THE ZEROED-BLOCK GUARD lives in xbrl/zero-block-guard.ts, shared with the v3
//   banking parser. The rules are facts about how banks tag a non-disclosure, not
//   about a namespace, so they take an EXTRACTOR: this module passes its
//   `in-bse-fin` reader, parser-banking.ts passes its `in-capmkt` one. Read that
//   file for the measured evidence behind each of the three rules.
// ─────────────────────────────────────────────────────────────

/** Bind the in-bse-fin extractor to one document. */
const legacyReader = (xml: string): FactReader => (tag, ctx) => extractNumber(xml, tag, ctx);

function parseQuarterlyBankingPnL(xml: string, resultType: ResultType) {
  const PNL = QUARTERLY_PNL_CONTEXT;
  // ★ Two independent verdicts, computed once, before any asset-quality read.
  const guard = evaluateZeroBlock(legacyReader(xml), PNL, BALANCE_SHEET_CONTEXT);
  const block = guard.block, roa = guard.roa, coh = guard.coherence;
  const revenue = extractNumber(xml, "InterestEarned", PNL);
  const otherIncome = extractNumber(xml, "OtherIncome", PNL);
  const expenses = extractNumber(
    xml,
    "ExpenditureExcludingProvisionsAndContingencies",
    PNL,
  );
  const operatingProfit = extractNumber(
    xml,
    "OperatingProfitBeforeProvisionAndContingencies",
    PNL,
  );
  const profitBeforeTax = extractNumber(
    xml,
    "ProfitLossFromOrdinaryActivitiesBeforeTax",
    PNL,
  );
  const tax = extractNumber(xml, "TaxExpense", PNL);
  const netProfit =
    (resultType === "consolidated"
      ? extractNumber(
          xml,
          "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates",
          PNL,
        )
      : null) ?? extractNumber(xml, "ProfitLossForThePeriod", PNL);
  return {
    revenue,
    otherIncome,
    expenses,
    operatingProfit,
    depreciation: null,
    interest: null,
    profitBeforeTax,
    tax,
    netProfit,

    // ── A2c: nine banking concepts the v2 quarterly parser never attempted.
    //    MEASURED present under the OneD quarter context in every legacy
    //    banking document in the tag audit (SBIN FY19, AXISBANK FY22,
    //    AUBANK FY24), and inferred to the full 2018–2024 span.
    //
    // ⚠ THE CONTEXT IS LOAD-BEARING AND IS *NOT* COSMETIC HERE. A March
    //    filing carries OneD (the quarter) and FourD (the full year) with the
    //    same end date. For the balances and the ratios the two contexts carry
    //    the SAME value, but ReturnOnAssets differs — MEASURED: SBIN FY19
    //    OneD 0.0009 vs FourD 0.0002, AXISBANK FY22 OneD 0.0146 vs FourD
    //    0.0121, AUBANK FY24 OneD 0.0035 vs FourD 0.0154. Reading FourD here
    //    would file a full year as a quarter.
    //
    // UNIT PATH, per field (see DIMENSIONLESS_CONCEPTS at the top):
    //    interestExpended      INR      → ÷1e7, money in ₹ Crore
    //    operatingExpenses     INR      → ÷1e7, money in ₹ Crore
    //    gnpaAbsolute          INR      → ÷1e7, money in ₹ Crore
    //    nnpaAbsolute          INR      → ÷1e7, money in ₹ Crore
    //    gnpaPct               pure     → raw ratio, no scaling
    //    cet1Ratio             pure     → raw ratio, no scaling
    //    additionalTier1Ratio  pure     → raw ratio, no scaling
    //    nnpaPct               ABSENT   → ⚠ OVERRIDDEN to raw, else 0
    //    roaQuarterly          "INR"    → ⚠ OVERRIDDEN to raw, else 0
    interestExpended: extractNumber(xml, "InterestExpended", PNL),
    operatingExpenses: extractNumber(xml, "OperatingExpenses", PNL),
    // ⚠ THE FOUR ASSET-QUALITY FIELDS PASS THROUGH THE ZEROED-BLOCK GUARD.
    //    `block.refused` means the filer zeroed the whole block on a live loan
    //    book; the honest value is NULL, never the 0 the document states.
    gnpaAbsolute: block.refused ? null : extractNumber(xml, "GrossNonPerformingAssets", PNL),
    nnpaAbsolute: block.refused ? null : extractNumber(xml, "NonPerformingAssets", PNL),
    gnpaPct: block.refused || coh.gnpaPct ? null : extractNumber(xml, "PercentageOfGrossNpa", PNL),
    nnpaPct: block.refused || coh.nnpaPct ? null : extractNumber(xml, "PercentageOfNpa", PNL),
    // ⚠ See the capital-ratio warning on the ANNUAL map below - it applies
    //   identically here; 108 of the 129 blank AT1 cells are quarterly ones.
    cet1Ratio: extractNumber(xml, "CET1Ratio", PNL),
    additionalTier1Ratio: extractNumber(xml, "AdditionalTier1Ratio", PNL),
    // ⚠ roa carries its OWN verdict — it is not a member of the block.
    roaQuarterly: roa.refused ? null : extractNumber(xml, "ReturnOnAssets", PNL),

    // The refusal notes travel with the parse so the ingester can log them.
    // A silent refusal is as bad as a silent write (bse-ratio-gate.ts).
    zeroBlockNotes: guard.notes,
  };
}

/**
 * ★ THE QUARTERLY FORK — mirrors the ANNUAL precedent (ParsedV2AnnualBanking),
 *   deliberately, rather than widening the shared ParsedQuarterlyResult.
 *
 *   ParsedQuarterlyResult lives in xbrl/types.ts and is the contract for the
 *   v3 pipeline too; it carries a nine-field P&L and has no room for banking
 *   asset quality or capital adequacy. The annual path already solved this by
 *   declaring its own shapes HERE, in the legacy module, and letting the
 *   adapter narrow them. This is the same move for the quarterly grain: the
 *   shared type is untouched, and the extra fields exist only on the banking
 *   variant, where the adapter is the only reader.
 *
 * ⚠ NO SCHEMA CHANGE ACCOMPANIES THIS. Every one of the nine columns already
 *   exists on banking_quarterly_results — they have simply been written null.
 */
export interface ParsedV2QuarterlyBanking extends ParsedQuarterlyResult {
  taxonomy: "banking";

  interestExpended: number | null;
  operatingExpenses: number | null;
  gnpaAbsolute: number | null;
  nnpaAbsolute: number | null;
  gnpaPct: number | null;
  nnpaPct: number | null;
  cet1Ratio: number | null;
  additionalTier1Ratio: number | null;
  roaQuarterly: number | null;

  /** Refusal notes from the zeroed-block guard. Empty when nothing was refused. */
  zeroBlockNotes?: string[];
}

/** Ind-AS keeps the shared shape exactly; only banking forks. */
export type ParsedV2Quarterly = ParsedQuarterlyResult | ParsedV2QuarterlyBanking;

export function parseQuarterlyResultXbrl(
  xml: string,
  filing: Pick<NseFilingEntry, "symbol" | "xbrl" | "consolidated">,
): ParsedV2Quarterly {
  const taxonomy = detectTaxonomy(xml, filing.xbrl);
  const resultType: ResultType =
    filing.consolidated === "Consolidated" ? "consolidated" : "standalone";
  const PNL = QUARTERLY_PNL_CONTEXT;

  const reportDate = extractDate(xml, "DateOfEndOfReportingPeriod", PNL);
  const filingDate =
    extractDate(
      xml,
      "DateOfBoardMeetingWhenFinancialResultsWereApproved",
      PNL,
    ) ??
    extractDate(xml, "DateOfStartOfReportingPeriod", PNL) ??
    reportDate!;
  const fyStart = extractDate(xml, "DateOfStartOfFinancialYear", PNL);
  const fyEnd = extractDate(xml, "DateOfEndOfFinancialYear", PNL);

  if (!reportDate || !fyStart || !fyEnd) {
    throw new Error(
      `Missing required date tags in v2 quarterly XBRL for ${filing.symbol}: ` +
        `reportDate=${reportDate} fyStart=${fyStart} fyEnd=${fyEnd}`,
    );
  }

  const { quarter, fiscalYear } = deriveFiscalPeriod(
    reportDate,
    fyStart,
    fyEnd,
    "quarterly",
  );

  const pnl =
    taxonomy === "banking"
      ? parseQuarterlyBankingPnL(xml, resultType)
      : parseQuarterlyIndAsPnL(xml, resultType);

  if (pnl.netProfit === null) {
    throw new Error(
      `Failed to extract netProfit for ${filing.symbol} ${quarter} ${fiscalYear} (v2 quarterly)`,
    );
  }

  return {
    symbol: filing.symbol,
    quarter,
    fiscalYear,
    reportDate,
    filingDate,
    resultType,
    taxonomy,
    xbrlUrl: filing.xbrl,
    ...pnl,
  };
}

// ─────────────────────────────────────────────────────────────
// ANNUAL parsers — NEW
// ─────────────────────────────────────────────────────────────

/**
 * Annual parsed result for Ind-AS — full P&L, BS, CFS, per-share.
 * Field names match ParsedIndAsAnnual in v3 so the adapter is a no-op rename pass.
 */
export interface ParsedV2AnnualIndAs {
  symbol: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: ResultType;
  xbrlUrl: string;
  taxonomy: "ind_as";

  // P&L
  revenue: number | null;
  otherIncome: number | null;
  expenses: number | null;
  employeeBenefitExpense: number | null;
  financeCosts: number | null;
  depreciation: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;

  // BS — Equity
  equityShareCapital: number | null;
  otherEquity: number | null;
  totalEquity: number | null;
  equityAttributableToOwners: number | null;

  // BS — Liabilities
  borrowingsCurrent: number | null;
  borrowingsNoncurrent: number | null;
  tradePayablesCurrent: number | null;
  tradePayablesNoncurrent: number | null;
  otherCurrentLiabilities: number | null;
  otherNoncurrentLiabilities: number | null;
  otherCurrentFinancialLiabilities: number | null;
  otherNoncurrentFinancialLiabilities: number | null;
  provisionsCurrent: number | null;
  provisionsNoncurrent: number | null;
  currentTaxLiabilities: number | null;
  deferredTaxLiabilitiesNet: number | null;
  currentLiabilities: number | null;
  noncurrentLiabilities: number | null;

  // BS — Non-current Assets
  propertyPlantAndEquipment: number | null;
  capitalWorkInProgress: number | null;
  goodwill: number | null;
  otherIntangibleAssets: number | null;
  intangibleAssetsUnderDevelopment: number | null;
  noncurrentInvestments: number | null;
  loansNoncurrent: number | null;
  otherNoncurrentFinancialAssets: number | null;
  otherNoncurrentAssets: number | null;
  deferredTaxAssetsNet: number | null;
  investmentProperty: number | null;
  investmentsEquityMethod: number | null;
  noncurrentAssets: number | null;

  // BS — Current Assets
  inventories: number | null;
  currentInvestments: number | null;
  tradeReceivablesCurrent: number | null;
  tradeReceivablesNoncurrent: number | null;
  cashAndCashEquivalents: number | null;
  bankBalanceOther: number | null;
  loansCurrent: number | null;
  otherCurrentFinancialAssets: number | null;
  otherCurrentAssets: number | null;
  currentTaxAssets: number | null;
  noncurrentAssetsHeldForSale: number | null;
  currentAssets: number | null;

  totalAssets: number | null;

  // CFS
  cashFromOperating: number | null;
  cashFromInvesting: number | null;
  cashFromFinancing: number | null;
  netCashFlow: number | null;
  capex: number | null;
  proceedsFromBorrowings: number | null;
  repaymentsOfBorrowings: number | null;
  dividendsPaid: number | null;
  interestPaid: number | null;

  // Per Share
  basicEps: number | null;
  dilutedEps: number | null;
  faceValueShare: number | null;
  paidUpEquityCapital: number | null;
}

export interface ParsedV2AnnualBanking {
  symbol: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: ResultType;
  xbrlUrl: string;
  taxonomy: "banking";

  // P&L
  interestEarned: number | null;
  interestExpended: number | null;
  interestOnAdvances: number | null;
  revenueOnInvestments: number | null;
  interestOnRbiBalances: number | null;
  otherInterest: number | null;
  otherIncome: number | null;
  employeesCost: number | null;
  operatingExpenses: number | null;
  otherOperatingExpenses: number | null;
  expenditureExclProvisions: number | null;
  ppop: number | null;
  provisions: number | null;
  exceptionalItems: number | null;
  extraordinaryItems: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  profitAfterTax: number | null;
  netProfit: number | null;

  // BS
  capital: number | null;
  reservesAndSurplus: number | null;
  reserveExclRevaluation: number | null;
  deposits: number | null;
  borrowings: number | null;
  otherLiabilities: number | null;
  capitalAndLiabilities: number | null;
  cashAndBalancesWithRbi: number | null;
  balancesWithBanks: number | null;
  investments: number | null;
  advances: number | null;
  fixedAssets: number | null;
  otherAssets: number | null;
  totalAssets: number | null;

  // CFS
  cashFromOperating: number | null;
  cashFromInvesting: number | null;
  cashFromFinancing: number | null;
  netCashFlow: number | null;

  // Asset Quality (absolute only in v2; ratios came later)
  gnpaAbsolute: number | null;
  nnpaAbsolute: number | null;
  gnpaPct: number | null;
  nnpaPct: number | null;

  // Capital Adequacy (not in v2)
  cet1Ratio: number | null;
  additionalTier1Ratio: number | null;

  // Profitability (ReturnOnAssets in v2 annual)
  roaDisclosed: number | null;

  /** Refusal notes from the zeroed-block guard. Empty when nothing was refused. */
  zeroBlockNotes?: string[];

  // Per Share
  basicEps: number | null;
  dilutedEps: number | null;
  faceValueShare: number | null;
  paidUpEquityCapital: number | null;
}

export type ParsedV2Annual = ParsedV2AnnualIndAs | ParsedV2AnnualBanking;

/**
 * Parse a v2 ANNUAL XBRL file (in-bse-fin namespace, FourD/OneI contexts).
 */
export function parseAnnualResultXbrl(
  xml: string,
  filing: Pick<NseFilingEntry, "symbol" | "xbrl" | "consolidated">,
): ParsedV2Annual {
  const taxonomy = detectTaxonomy(xml, filing.xbrl);
  const resultType: ResultType =
    filing.consolidated === "Consolidated" ? "consolidated" : "standalone";
  const PNL = ANNUAL_PNL_CONTEXT;
  const BS = BALANCE_SHEET_CONTEXT;

  const reportDate = extractDate(xml, "DateOfEndOfReportingPeriod", PNL);
  const filingDate =
    extractDate(
      xml,
      "DateOfBoardMeetingWhenFinancialResultsWereApproved",
      "OneD",
    ) ??
    extractDate(
      xml,
      "DateOfBoardMeetingWhenFinancialResultsWereApproved",
      PNL,
    ) ??
    reportDate!;
  const fyStart =
    extractDate(xml, "DateOfStartOfFinancialYear", "OneD") ??
    extractDate(xml, "DateOfStartOfFinancialYear", PNL);
  const fyEnd =
    extractDate(xml, "DateOfEndOfFinancialYear", "OneD") ??
    extractDate(xml, "DateOfEndOfFinancialYear", PNL);

  if (!reportDate || !fyStart || !fyEnd) {
    throw new Error(
      `Missing required date tags in v2 annual XBRL for ${filing.symbol}: ` +
        `reportDate=${reportDate} fyStart=${fyStart} fyEnd=${fyEnd}`,
    );
  }

  const { fiscalYear } = deriveFiscalPeriod(
    reportDate,
    fyStart,
    fyEnd,
    "annual",
  );

  const basePerShare = {
    basicEps:
      extractNumber(
        xml,
        "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
        PNL,
      ) ??
      extractNumber(xml, "BasicEarningsPerShareAfterExtraordinaryItems", PNL),
    dilutedEps:
      extractNumber(
        xml,
        "DilutedEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
        PNL,
      ) ??
      extractNumber(xml, "DilutedEarningsPerShareAfterExtraordinaryItems", PNL),
    faceValueShare:
      extractNumber(xml, "FaceValueOfEquityShareCapital", BS) ??
      extractNumber(xml, "FaceValueOfEquityShareCapital", PNL),
    paidUpEquityCapital:
      extractNumber(xml, "PaidUpValueOfEquityShareCapital", BS) ??
      extractNumber(xml, "PaidUpValueOfEquityShareCapital", PNL),
  };

  if (taxonomy === "banking") {
    // ★ The two verdicts, computed once before any asset-quality read.
    const aGuard = evaluateZeroBlock(legacyReader(xml), PNL, BS);
    const annualBlock = aGuard.block, annualRoa = aGuard.roa, annualCoh = aGuard.coherence;
    return {
      symbol: filing.symbol,
      fiscalYear,
      reportDate,
      filingDate,
      resultType,
      xbrlUrl: filing.xbrl,
      taxonomy: "banking",

      interestEarned: extractNumber(xml, "InterestEarned", PNL),
      interestExpended: extractNumber(xml, "InterestExpended", PNL),
      interestOnAdvances: extractNumber(
        xml,
        "InterestOrDiscountOnAdvancesOrBills",
        PNL,
      ),
      revenueOnInvestments: extractNumber(xml, "RevenueOnInvestments", PNL),
      interestOnRbiBalances: extractNumber(
        xml,
        "InterestOnBalancesWithReserveBankOfIndiaAndOtherInterBankFunds",
        PNL,
      ),
      otherInterest: extractNumber(xml, "OtherInterest", PNL),
      otherIncome: extractNumber(xml, "OtherIncome", PNL),
      employeesCost: extractNumber(xml, "EmployeesCost", PNL),
      operatingExpenses: extractNumber(xml, "OperatingExpenses", PNL),
      otherOperatingExpenses: extractNumber(xml, "OtherOperatingExpenses", PNL),
      expenditureExclProvisions: extractNumber(
        xml,
        "ExpenditureExcludingProvisionsAndContingencies",
        PNL,
      ),
      ppop: extractNumber(
        xml,
        "OperatingProfitBeforeProvisionAndContingencies",
        PNL,
      ),
      provisions: extractNumber(
        xml,
        "ProvisionsOtherThanTaxAndContingencies",
        PNL,
      ),
      exceptionalItems: extractNumber(xml, "ExceptionalItems", PNL),
      extraordinaryItems: extractNumber(xml, "ExtraordinaryItems", PNL),
      profitBeforeTax: extractNumber(
        xml,
        "ProfitLossFromOrdinaryActivitiesBeforeTax",
        PNL,
      ),
      tax: extractNumber(xml, "TaxExpense", PNL),
      profitAfterTax: extractNumber(
        xml,
        "ProfitLossFromOrdinaryActivitiesAfterTax",
        PNL,
      ),
      netProfit:
        (resultType === "consolidated"
          ? extractNumber(
              xml,
              "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates",
              PNL,
            )
          : null) ?? extractNumber(xml, "ProfitLossForThePeriod", PNL),

      capital: extractNumber(xml, "Capital", BS),
      reservesAndSurplus: extractNumber(xml, "ReservesAndSurplus", BS),
      reserveExclRevaluation: extractNumber(
        xml,
        "ReserveExcludingRevaluationReserves",
        BS,
      ),
      deposits: extractNumber(xml, "Deposits", BS),
      borrowings: extractNumber(xml, "Borrowings", BS),
      otherLiabilities: extractNumber(xml, "OtherLiabilitiesAndProvisions", BS),
      capitalAndLiabilities: extractNumber(xml, "CapitalAndLiabilities", BS),
      cashAndBalancesWithRbi: extractNumber(
        xml,
        "CashAndBalancesWithReserveBankOfIndia",
        BS,
      ),
      balancesWithBanks: extractNumber(
        xml,
        "BalancesWithBanksAndMoneyAtCallAndShortNotice",
        BS,
      ),
      investments: extractNumber(xml, "Investments", BS),
      advances: extractNumber(xml, "Advances", BS),
      fixedAssets: extractNumber(xml, "FixedAssets", BS),
      otherAssets: extractNumber(xml, "OtherAssets", BS),
      totalAssets: extractNumber(xml, "Assets", BS),

      cashFromOperating: extractAnnualCashFlow(xml, "CashFlowsFromUsedInOperatingActivities"),
      cashFromInvesting: extractAnnualCashFlow(xml, "CashFlowsFromUsedInInvestingActivities"),
      cashFromFinancing: extractAnnualCashFlow(xml, "CashFlowsFromUsedInFinancingActivities"),
      netCashFlow: extractAnnualCashFlow(xml, "IncreaseDecreaseInCashAndCashEquivalents"),

      // ⚠ SAME ZEROED-BLOCK GUARD AS THE QUARTERLY GRAIN. MEASURED: 70 of the
      //    780 structural zeros were annual consolidated gnpa_pct / nnpa_pct.
      gnpaAbsolute: annualBlock.refused ? null : extractNumber(xml, "GrossNonPerformingAssets", PNL),
      nnpaAbsolute: annualBlock.refused ? null : extractNumber(xml, "NonPerformingAssets", PNL),
      // ── A2b: the four "not in v2" nulls were never true. MEASURED, tag audit:
      //    all four concepts ARE present in the legacy annual instances, under the
      //    FourD annual context, 2018–2024. PercentageOfGrossNpa / CET1Ratio /
      //    AdditionalTier1Ratio declare unitRef="pure" and need no override;
      //    PercentageOfNpa declares NO unitRef and is carried by
      //    DIMENSIONLESS_CONCEPTS above — WITHOUT which it would land as 0.
      // ⚠ tier1_ratio is NOT parsed here and must not be. It has no tag in
      //    in-bse-fin at all (bse-ratio-gate.ts ABSENT_TAGS); it is DERIVED as
      //    cet1 + at1 by derive-banking-annual.ts:204, which starts producing a
      //    value the moment these two stop being null.
      //
      // ⚠⚠ THE TWO CAPITAL RATIOS ARE MAPPED BUT NOT YET SAFE TO BULK-FILL.
      //    MEASURED over all 1,042 legacy banking documents (S7 A3): of the 189
      //    standalone target cells the hand-key deliberately left BLANK, 139
      //    (73.5%) carry a value outside any plausible band, and they are
      //    concentrated in exactly these two columns:
      //        additional_tier1_ratio  blanks 129, implausible 114  (88-91%)
      //        cet1_ratio              blanks  26, implausible  25  (95-100%)
      //        gnpa_pct / nnpa_pct / roa_quarterly  blanks  34, implausible   0
      //    Of the cells the human DID key, 0 of 590 AT1 and 2 of 692 CET1 are
      //    implausible. The blanks were a JUDGEMENT, not an omission:
      //    ICICIBANK FY20 states AdditionalTier1Ratio=0.1614 — its TOTAL capital
      //    ratio sitting in the AT1 slot — and BANDHANBNK FY19 states 0.3281.
      //    This is the family bse-ratio-gate.ts calls UNCHECKABLE BY CONSTRUCTION
      //    (regulatory capital and RWA are not tagged in in-bse-fin, so nothing
      //    in the instance can recompute them) and which that lane therefore
      //    ALWAYS refuses. The legacy lane has no such gate.
      //    ⇒ A backfill that writes these two columns must either carry a gate
      //      of its own or be scoped to leave them alone. The PARSE is right;
      //      the DOCUMENT is not. Same family as derive-banking-annual.ts PB-2.
      gnpaPct: annualBlock.refused || annualCoh.gnpaPct ? null : extractNumber(xml, "PercentageOfGrossNpa", PNL),
      nnpaPct: annualBlock.refused || annualCoh.nnpaPct ? null : extractNumber(xml, "PercentageOfNpa", PNL),
      cet1Ratio: extractNumber(xml, "CET1Ratio", PNL),
      additionalTier1Ratio: extractNumber(xml, "AdditionalTier1Ratio", PNL),
      // ⚠ Unchanged field map, CHANGED VALUE. ReturnOnAssets declares
      //    unitRef="INR"; before DIMENSIONLESS_CONCEPTS this line produced
      //    exactly 0 on 241 of 243 stored legacy rows.
      // ⚠ roa carries its OWN verdict — not a member of the block. 200 of 200
      //    documents where ReturnOnAssets reads 0 have a NON-ZERO PAT.
      roaDisclosed: annualRoa.refused ? null : extractNumber(xml, "ReturnOnAssets", PNL),

      zeroBlockNotes: aGuard.notes,

      ...basePerShare,
    };
  }

  // Ind-AS
  return {
    symbol: filing.symbol,
    fiscalYear,
    reportDate,
    filingDate,
    resultType,
    xbrlUrl: filing.xbrl,
    taxonomy: "ind_as",

    revenue: extractNumber(xml, "RevenueFromOperations", PNL),
    otherIncome: extractNumber(xml, "OtherIncome", PNL),
    expenses: extractNumber(xml, "Expenses", PNL),
    employeeBenefitExpense: extractNumber(xml, "EmployeeBenefitExpense", PNL),
    financeCosts: extractNumber(xml, "FinanceCosts", PNL),
    depreciation: extractNumber(
      xml,
      "DepreciationDepletionAndAmortisationExpense",
      PNL,
    ),
    profitBeforeTax: extractNumber(xml, "ProfitBeforeTax", PNL),
    tax: extractNumber(xml, "TaxExpense", PNL),
    netProfit:
      (resultType === "consolidated"
        ? extractNumber(xml, "ProfitOrLossAttributableToOwnersOfParent", PNL)
        : null) ?? extractNumber(xml, "ProfitLossForPeriod", PNL),

    equityShareCapital: extractNumber(xml, "EquityShareCapital", BS),
    otherEquity: extractNumber(xml, "OtherEquity", BS),
    totalEquity: extractNumber(xml, "Equity", BS),
    equityAttributableToOwners: extractNumber(
      xml,
      "EquityAttributableToOwnersOfParent",
      BS,
    ),

    borrowingsCurrent: extractNumber(xml, "BorrowingsCurrent", BS),
    borrowingsNoncurrent: extractNumber(xml, "BorrowingsNoncurrent", BS),
    tradePayablesCurrent: extractNumber(xml, "TradePayablesCurrent", BS),
    tradePayablesNoncurrent: extractNumber(xml, "TradePayablesNoncurrent", BS),
    otherCurrentLiabilities: extractNumber(xml, "OtherCurrentLiabilities", BS),
    otherNoncurrentLiabilities: extractNumber(
      xml,
      "OtherNoncurrentLiabilities",
      BS,
    ),
    otherCurrentFinancialLiabilities: extractNumber(
      xml,
      "OtherCurrentFinancialLiabilities",
      BS,
    ),
    otherNoncurrentFinancialLiabilities: extractNumber(
      xml,
      "OtherNoncurrentFinancialLiabilities",
      BS,
    ),
    provisionsCurrent: null,
    provisionsNoncurrent: null,
    currentTaxLiabilities: extractNumber(xml, "CurrentTaxLiabilities", BS),
    deferredTaxLiabilitiesNet: extractNumber(
      xml,
      "DeferredTaxLiabilitiesNet",
      BS,
    ),
    currentLiabilities: extractNumber(xml, "CurrentLiabilities", BS),
    noncurrentLiabilities: extractNumber(xml, "NoncurrentLiabilities", BS),

    propertyPlantAndEquipment: extractNumber(
      xml,
      "PropertyPlantAndEquipment",
      BS,
    ),
    capitalWorkInProgress: extractNumber(xml, "CapitalWorkInProgress", BS),
    goodwill: extractNumber(xml, "Goodwill", BS),
    otherIntangibleAssets: extractNumber(xml, "OtherIntangibleAssets", BS),
    intangibleAssetsUnderDevelopment: extractNumber(
      xml,
      "IntangibleAssetsUnderDevelopment",
      BS,
    ),
    noncurrentInvestments: extractNumber(xml, "NoncurrentInvestments", BS),
    loansNoncurrent: null,
    otherNoncurrentFinancialAssets: extractNumber(
      xml,
      "OtherNoncurrentFinancialAssets",
      BS,
    ),
    otherNoncurrentAssets: extractNumber(xml, "OtherNoncurrentAssets", BS),
    deferredTaxAssetsNet: extractNumber(xml, "DeferredTaxAssetsNet", BS),
    investmentProperty: extractNumber(xml, "InvestmentProperty", BS),
    investmentsEquityMethod: extractNumber(
      xml,
      "InvestmentsAccountedForUsingEquityMethod",
      BS,
    ),
    noncurrentAssets: extractNumber(xml, "NoncurrentAssets", BS),

    inventories: extractNumber(xml, "Inventories", BS),
    currentInvestments: extractNumber(xml, "CurrentInvestments", BS),
    tradeReceivablesCurrent: extractNumber(xml, "TradeReceivablesCurrent", BS),
    tradeReceivablesNoncurrent: extractNumber(
      xml,
      "TradeReceivablesNoncurrent",
      BS,
    ),
    cashAndCashEquivalents: extractNumber(xml, "CashAndCashEquivalents", BS),
    bankBalanceOther: extractNumber(
      xml,
      "BankBalanceOtherThanCashAndCashEquivalents",
      BS,
    ),
    loansCurrent: null,
    otherCurrentFinancialAssets: extractNumber(
      xml,
      "OtherCurrentFinancialAssets",
      BS,
    ),
    otherCurrentAssets: extractNumber(xml, "OtherCurrentAssets", BS),
    currentTaxAssets: extractNumber(xml, "CurrentTaxAssets", BS),
    noncurrentAssetsHeldForSale: extractNumber(
      xml,
      "NoncurrentAssetsClassifiedAsHeldForSale",
      BS,
    ),
    currentAssets: extractNumber(xml, "CurrentAssets", BS),
    totalAssets: extractNumber(xml, "Assets", BS),

    cashFromOperating: extractAnnualCashFlow(xml, "CashFlowsFromUsedInOperatingActivities"),
    cashFromInvesting: extractAnnualCashFlow(xml, "CashFlowsFromUsedInInvestingActivities"),
    cashFromFinancing: extractAnnualCashFlow(xml, "CashFlowsFromUsedInFinancingActivities"),
    netCashFlow: extractAnnualCashFlow(xml, "IncreaseDecreaseInCashAndCashEquivalents"),
    capex: extractAnnualCashFlow(xml, "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"),
    proceedsFromBorrowings: extractAnnualCashFlow(xml, "ProceedsFromBorrowingsClassifiedAsFinancingActivities"),
    repaymentsOfBorrowings: extractAnnualCashFlow(xml, "RepaymentsOfBorrowingsClassifiedAsFinancingActivities"),
    dividendsPaid: extractAnnualCashFlow(xml, "DividendsPaidClassifiedAsFinancingActivities"),
    interestPaid:
      extractAnnualCashFlow(xml, "InterestPaidClassifiedAsFinancingActivities") ??
      extractAnnualCashFlow(xml, "InterestPaidClassifiedAsOperatingActivities"),

    ...basePerShare,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
