// File: src/scoring/metrics/filed-load.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE INDUSTRY-AWARE FILED-FUNDAMENTALS RESOLVER — one call, five industries, one output shape.
//
// ── THE DEFECT THIS EXISTS TO FIX ─────────────────────────────────────────────────────────────────
// `loadFoundationStandalone` / `loadMomentumStandalone` read `fundamentals` and `quarterly_results`,
// which schema.prisma documents as NON-FINANCIAL ONLY ("Annual fundamentals for non-financial
// companies", "Source: NSE Reg 33 Annual XBRL (Ind-AS taxonomy)"). A bank, an NBFC or an insurer has
// zero rows there — not because its accounts are missing, but because they live in eight dedicated
// tables under four different XBRL taxonomies.
//
// So every rule reading `ctx.annualFundamentals` or `ctx.quarterlyResults` received an EMPTY ARRAY
// for 74 of 504 stocks and declined. For the 26 banks that was correct and INTENTIONAL (an explicit
// `industry === "banking"` guard fires first). For the 48 NBFC / life-insurance / general-insurance
// stocks it was correct BY ACCIDENT — the guard did not name them, the array was simply empty. An
// accident that produces the right answer is still an accident, and it stops working the moment this
// resolver starts serving those stocks real data. Hence `isFinancialIndustry` in findings/types.ts,
// which turns all four into explicit guards.
//
// ── THE CONTRACT ──────────────────────────────────────────────────────────────────────────────────
// Dispatch on `Stock.industryType` — the STOCK's own classification, not the peer group's industry
// path. The two agree today for every scored stock, but they are different facts: the PG path is
// derived from which bar set a peer group calibrated, and a peer group is the score's plumbing.
//
// Output is always `FoundationAnnual[]` / `MomentumQuarter[]` — the shapes the rules already read —
// so RULES STAY INDUSTRY-AGNOSTIC WHERE THEIR LOGIC PERMITS. Normalisation happens here, once, not
// in thirty rule bodies.
//
// ★ NO INVENTED EQUIVALENCES. A field is mapped only when the same fact exists under another name
//   AND in the same unit. Where it genuinely does not exist — trade receivables for a bank,
//   operating profit for a lender — this returns NULL and the rule's existing not-evaluable path
//   handles it. Every null below is deliberate and annotated; none is a TODO. Two traps in
//   particular are NOT mapped, and the reason is the unit, not the name:
//     · `stored.roe` — Fundamental.roe is a PERCENT; every financial table's `roe` is
//       Decimal(8,6), the ratio convention those tables use throughout (cf. `gnpa_pct // ratio`).
//       Mapping them would silently divide every financial ROE by 100.
//     · `stored.debtToEquity` — Fundamental.debtToEquity is documented "percent (ratio ×100)";
//       NbfcFundamental.borrowingsToEquity is Decimal(8,4) plain leverage. Same trap.
//   Both stay null. A later step that wants them must convert deliberately, at a named seam.
//
// ── STANDALONE ONLY, EXACTLY AS THE NON-FINANCIAL LOADER ──────────────────────────────────────────
// Every one of the eight tables is dual-basis (@@unique on (stockId, period, resultType)). This
// reads `resultType = "standalone"` and NEVER falls back to consolidated — the same rule metrics/
// load.ts states: a standalone-absent period yields fewer rows, never a silently mixed basis. All
// 74 financial stocks have standalone rows (verified 2026-08-09: 26/26 banking, 40/40 nbfc, 4/4 LI,
// 4/4 GI), so nothing degrades to consolidated in practice either.
//
// Monetary units are ₹ CRORE across all nine tables, matching FoundationAnnual/MomentumQuarter.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { IndustryType } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import { loadFoundationStandalone, loadMomentumStandalone } from "./load.js";
import {
  fyOrdinal,
  calendarQuarterOrdinal,
  sumNonNull,
  type FoundationAnnual,
  type MomentumQuarter,
} from "./types.js";

const n = (d: { toNumber: () => number } | null): number | null => (d === null ? null : d.toNumber());

/** period label -> report_date, from rows already in hand. Last write wins, and the rows are period-
 *  ASC, so a duplicated label resolves to its latest filed date. */
const annualEnds = (rows: { fiscalYear: string; reportDate: Date }[]): Map<string, Date> =>
  new Map(rows.map((r) => [r.fiscalYear, r.reportDate]));
const quarterlyEnds = (rows: { fiscalYear: string; quarter: string; reportDate: Date }[]): Map<string, Date> =>
  new Map(rows.map((r) => [`${r.fiscalYear}${r.quarter}`, r.reportDate]));

/** Which table pair served a stock's filed accounts. Provenance — a caller can state WHERE the
 *  numbers came from instead of asserting they exist. */
export type FiledSource =
  | "fundamentals"
  | "banking_fundamentals"
  | "nbfc_fundamentals"
  | "life_insurance_fundamentals"
  | "general_insurance_fundamentals";

export interface FiledFinancials {
  /** The Stock.industryType this was resolved for. */
  industry: IndustryType;
  /** The annual table this came from (the quarterly sibling is the same prefix). */
  source: FiledSource;
  /** Annual rows, fiscalYear ASC. */
  annual: FoundationAnnual[];
  /** Quarterly rows, (fiscalYear, quarter) ASC. */
  quarterly: MomentumQuarter[];
  // ── ★ THE FILING'S OWN PERIOD END, PER PERIOD ─────────────────────────────────────────────────
  // "FY26" -> 2026-03-31, "FY26Q3" -> 2025-12-31, taken VERBATIM from the filing's `report_date`
  // (documented as the period end: "qe_Date (year-end)").
  //
  // The filing pass needs a real date for `stock_findings.period_end`, which is the only key that
  // sorts across the three grains. Deriving it from the label plus Stock.fiscalYearEnd would be a
  // SECOND convention that can disagree with the data — a December-fiscal-year filer, a restated
  // period, a 15-month transition year — so the filed date is used instead of a computed one.
  //
  // Kept OFF FoundationAnnual / MomentumQuarter deliberately: those are shared scoring types with
  // ~13 fixture construction sites, and widening them to carry a date only the filing pass reads
  // would have been churn in the scoring layer for a filing-layer need.
  /** fiscalYear ("FY26") -> report_date. */
  annualPeriodEnd: Map<string, Date>;
  /** fiscalYear+quarter ("FY26Q3") -> report_date. */
  quarterlyPeriodEnd: Map<string, Date>;
}

const SOURCE_BY_INDUSTRY: Record<IndustryType, FiledSource> = {
  non_financial: "fundamentals",
  banking: "banking_fundamentals",
  nbfc: "nbfc_fundamentals",
  life_insurance: "life_insurance_fundamentals",
  general_insurance: "general_insurance_fundamentals",
};

/** The four industries whose accounts live in dedicated tables under their own XBRL taxonomy. */
export const isFinancialSource = (i: IndustryType): boolean => i !== "non_financial";

/** Empty `stored` block — the pre-computed ratio columns of `fundamentals`, none of which the
 *  financial tables reproduce in the same unit. See the unit-trap note in the header. */
const NO_STORED: FoundationAnnual["stored"] = {
  roce: null,             // not disclosed for financials (capital employed is not comparable)
  roe: null,              // ⚠ unit trap — see header
  debtToEquity: null,     // ⚠ unit trap — see header
  interestCoverage: null, // interest is a lender's cost of goods; coverage is not defined
  receivablesDays: null,  // no trade receivables
  assetTurnover: null,    // not disclosed
  netWorth: null,         // filled per industry below where the table carries it (₹Cr, same unit)
  operatingMargin: null,  // no operating-profit line — see `operatingProfitStored` below
  ebitda: null,           // not defined for financials
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BANKING — banking_fundamentals / banking_quarterly_results (Reg-33 Banking taxonomy).
//
// `revenue` ← `total_income` (interest earned + other income). That is the bank's disclosed top
// line, not a construction: the column exists and is what every published "revenue" for a bank
// means. `financeCosts` ← `interest_expended` is exact — for a bank that IS the finance cost.
//
// NULL, and why: no borrowings split (banks disclose one `borrowings` line), no current-liability
// subtotal (the balance sheet is Capital & Liabilities / Assets, not current/non-current), no trade
// receivables at all (a bank's asset is `advances` — a loan book, not a receivable from a customer
// for goods sold; equating them would make R3/P8-style receivables arithmetic meaningless), no CWIP,
// no separable capex line, no depreciation line in this taxonomy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
async function loadBankingFiled(stockId: string, cutoff?: Date): Promise<Omit<FiledFinancials, "industry" | "source">> {
  const [aRows, qRows] = await Promise.all([
    prisma.bankingFundamental.findMany({
      where: { stockId, resultType: "standalone", ...(cutoff ? { reportDate: { lte: cutoff } } : {}) },
      orderBy: { fiscalYear: "asc" },
    }),
    prisma.bankingQuarterlyResult.findMany({
      where: { stockId, resultType: "standalone", ...(cutoff ? { reportDate: { lte: cutoff } } : {}) },
      orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }],
    }),
  ]);
  return {
    annualPeriodEnd: annualEnds(aRows),
    quarterlyPeriodEnd: quarterlyEnds(qRows),
    annual: aRows.map((r): FoundationAnnual => ({
      fiscalYear: r.fiscalYear,
      fyOrdinal: fyOrdinal(r.fiscalYear),
      revenue: n(r.totalIncome),
      otherIncome: n(r.otherIncome),
      financeCosts: n(r.interestExpended),
      depreciation: null,
      profitBeforeTax: n(r.profitBeforeTax),
      netProfit: n(r.netProfit),
      equityShareCapital: n(r.capital),
      otherEquity: n(r.reservesAndSurplus),
      totalEquity: n(r.netWorth),
      borrowingsCurrent: null,
      borrowingsNoncurrent: null,
      totalDebtStored: n(r.borrowings),
      totalAssets: n(r.totalAssets),
      currentLiabilities: null,
      tradeReceivablesCurrent: null,
      tradeReceivablesNoncurrent: null,
      propertyPlantAndEquipment: n(r.fixedAssets),
      capitalWorkInProgress: null,
      cashFromOperating: n(r.cashFromOperating),
      capex: null,
      cashFromFinancing: n(r.cashFromFinancing),
      faceValueShare: n(r.faceValueShare),
      stored: { ...NO_STORED, netWorth: n(r.netWorth) },
    })),
    quarterly: qRows.map((r): MomentumQuarter => ({
      fiscalYear: r.fiscalYear,
      quarter: r.quarter,
      qOrdinal: calendarQuarterOrdinal(r.reportDate),
      revenue: n(r.totalIncome),
      otherIncome: n(r.otherIncome),
      interest: n(r.interestExpended),
      depreciation: null,
      profitBeforeTax: n(r.profitBeforeTax),
      netProfit: n(r.netProfit),
      // ★ NULL BY DEFINITION, NOT BY ABSENCE. `operatingProfitStored` is PBT + interest − other
      //   income: an EX-INTEREST operating line. Adding a bank's interest expense back is adding
      //   back its cost of goods; the result is not an operating profit and no OPM computed from it
      //   would mean anything. `ppop` is the bank's analogue but is a DIFFERENT quantity (it is
      //   pre-PROVISION, and provisions are the lender's real cost line), so it is not mapped here.
      operatingProfitStored: null,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// NBFC — nbfc_fundamentals / nbfc_quarterly_results (Ind-AS Division III / NBFC taxonomy).
//
// The closest of the four to the non-financial shape: `revenue`, `finance_costs`, `depreciation`,
// equity/other-equity/total-equity, PP&E, CWIP and the full cash-flow triplet all exist under their
// own names, in the same unit.
//
// `totalDebtStored` = borrowings + debt_securities + subordinated_liabilities. An NBFC's Division-III
// balance sheet splits its borrowing across three lines by INSTRUMENT; summed, they are total debt —
// the same quantity `fundamentals.total_debt` holds. `sumNonNull` keeps a partial disclosure usable
// and returns null only when all three are absent.
//
// `receivablesTrade` IS trade receivables (Division III names it `Receivables — Trade Receivables`),
// so it maps directly. NOTE it is a small line for a lender — the loan book is `loans` and is NOT
// mapped here — which is exactly why P8/N2 stay guarded off: the mapping is honest, but the RULE's
// premise (working capital tied up in customer credit) is not an NBFC's business model.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
async function loadNbfcFiled(stockId: string, cutoff?: Date): Promise<Omit<FiledFinancials, "industry" | "source">> {
  const [aRows, qRows] = await Promise.all([
    prisma.nbfcFundamental.findMany({
      where: { stockId, resultType: "standalone", ...(cutoff ? { reportDate: { lte: cutoff } } : {}) },
      orderBy: { fiscalYear: "asc" },
    }),
    prisma.nbfcQuarterlyResult.findMany({
      where: { stockId, resultType: "standalone", ...(cutoff ? { reportDate: { lte: cutoff } } : {}) },
      orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }],
    }),
  ]);
  return {
    annualPeriodEnd: annualEnds(aRows),
    quarterlyPeriodEnd: quarterlyEnds(qRows),
    annual: aRows.map((r): FoundationAnnual => ({
      fiscalYear: r.fiscalYear,
      fyOrdinal: fyOrdinal(r.fiscalYear),
      revenue: n(r.revenue),
      otherIncome: n(r.otherIncome),
      financeCosts: n(r.financeCosts),
      depreciation: n(r.depreciation),
      profitBeforeTax: n(r.profitBeforeTax),
      netProfit: n(r.netProfit),
      equityShareCapital: n(r.equityShareCapital),
      otherEquity: n(r.otherEquity),
      totalEquity: n(r.totalEquity),
      // Division III does not split borrowings current/non-current — it splits by instrument, and
      // the three instrument lines are summed into totalDebtStored below.
      borrowingsCurrent: null,
      borrowingsNoncurrent: null,
      totalDebtStored: sumNonNull(n(r.borrowings), n(r.debtSecurities), n(r.subordinatedLiabilities)),
      totalAssets: n(r.totalAssets),
      currentLiabilities: null, // Division III is financial/non-financial, not current/non-current
      tradeReceivablesCurrent: n(r.receivablesTrade),
      tradeReceivablesNoncurrent: null, // not split by tenor in this taxonomy
      propertyPlantAndEquipment: n(r.propertyPlantAndEquipment),
      capitalWorkInProgress: n(r.capitalWorkInProgress),
      cashFromOperating: n(r.cashFromOperating),
      capex: null, // no separable PP&E-purchase line in the NBFC cash-flow disclosure
      cashFromFinancing: n(r.cashFromFinancing),
      faceValueShare: n(r.faceValueShare),
      stored: { ...NO_STORED, netWorth: n(r.netWorth) },
    })),
    quarterly: qRows.map((r): MomentumQuarter => ({
      fiscalYear: r.fiscalYear,
      quarter: r.quarter,
      qOrdinal: calendarQuarterOrdinal(r.reportDate),
      revenue: n(r.revenue),
      otherIncome: n(r.otherIncome),
      interest: n(r.financeCosts),
      depreciation: n(r.depreciation),
      profitBeforeTax: n(r.profitBeforeTax),
      netProfit: n(r.netProfit),
      operatingProfitStored: null, // same reason as banking — interest is a lender's cost of goods
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// LIFE INSURANCE — life_insurance_fundamentals / life_insurance_quarterly_results (IRDAI two-account
// format: a POLICYHOLDERS' Revenue Account and a SHAREHOLDERS' Profit & Loss Account).
//
// ⚠ THE TWO-ACCOUNT CAVEAT, STATED ONCE HERE SO NO LATER RULE HAS TO REDISCOVER IT. `revenue` below
// is the POLICYHOLDERS' top line (premium + investment income) and `netProfit` is the SHAREHOLDERS'
// bottom line. They are the company's revenue and the company's profit, and each is correct — but
// they are not a numerator and denominator of one account. A margin computed as netProfit/revenue
// would be arithmetic across two ledgers. That is a rule-design constraint, not a mapping error, and
// it is one more reason the margin rules stay guarded off for insurers.
//
// NULL, and why: no finance-cost line (borrowings exist; their cost is not separately disclosed), no
// depreciation line, no cash-flow statement columns at all in this schema, no trade receivables
// (`advances_and_other_assets` is a mixed bucket, not a receivable from customers for goods sold).
// `currentLiabilities` DOES exist in the IRDAI Application-of-Funds block and maps directly.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
async function loadLifeInsuranceFiled(stockId: string, cutoff?: Date): Promise<Omit<FiledFinancials, "industry" | "source">> {
  const [aRows, qRows] = await Promise.all([
    prisma.lifeInsuranceFundamental.findMany({
      where: { stockId, resultType: "standalone", ...(cutoff ? { reportDate: { lte: cutoff } } : {}) },
      orderBy: { fiscalYear: "asc" },
    }),
    prisma.lifeInsuranceQuarterlyResult.findMany({
      where: { stockId, resultType: "standalone", ...(cutoff ? { reportDate: { lte: cutoff } } : {}) },
      orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }],
    }),
  ]);
  return {
    annualPeriodEnd: annualEnds(aRows),
    quarterlyPeriodEnd: quarterlyEnds(qRows),
    annual: aRows.map((r): FoundationAnnual => ({
      fiscalYear: r.fiscalYear,
      fyOrdinal: fyOrdinal(r.fiscalYear),
      revenue: n(r.totalRevenuePolicyholders), // ⚠ policyholders' account — see the caveat above
      otherIncome: n(r.otherIncomeShareholders),
      financeCosts: null,
      depreciation: null,
      profitBeforeTax: n(r.profitBeforeTax),
      netProfit: n(r.netProfit), // shareholders' account
      equityShareCapital: n(r.shareCapital),
      otherEquity: n(r.reservesAndSurplus),
      totalEquity: n(r.netWorth),
      borrowingsCurrent: null,
      borrowingsNoncurrent: null,
      totalDebtStored: n(r.borrowings),
      totalAssets: n(r.totalAssets),
      currentLiabilities: n(r.currentLiabilities),
      tradeReceivablesCurrent: null,
      tradeReceivablesNoncurrent: null,
      propertyPlantAndEquipment: n(r.fixedAssets),
      capitalWorkInProgress: null,
      cashFromOperating: null, // no cash-flow columns in the IRDAI life schema
      capex: null,
      cashFromFinancing: null,
      faceValueShare: n(r.faceValueShare),
      stored: { ...NO_STORED, netWorth: n(r.netWorth) },
    })),
    quarterly: qRows.map((r): MomentumQuarter => ({
      fiscalYear: r.fiscalYear,
      quarter: r.quarter,
      qOrdinal: calendarQuarterOrdinal(r.reportDate),
      revenue: n(r.totalRevenuePolicyholders), // ⚠ policyholders' account
      otherIncome: null, // the quarterly LI filing carries no shareholders' other-income line
      interest: null,
      depreciation: null,
      profitBeforeTax: n(r.profitBeforeTax),
      netProfit: n(r.netProfit),
      operatingProfitStored: null, // no operating-profit line exists in the two-account format
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GENERAL INSURANCE — general_insurance_fundamentals / general_insurance_quarterly_results (IRDAI
// two-account format; same caveat as life). `total_revenue` is the Revenue-Account top line
// (premium earned + investment income); `netProfit` is the shareholders' bottom line.
//
// NULL, and why: as life, plus no separate net-worth-bearing equity split beyond share capital and
// reserves. `underwriting_profit_or_loss` is a real operating analogue but is NOT mapped to
// `operatingProfitStored` — that field has a fixed definition (PBT + interest − other income) and a
// silently different quantity under the same name is the exact defect this file refuses to create.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
async function loadGeneralInsuranceFiled(stockId: string, cutoff?: Date): Promise<Omit<FiledFinancials, "industry" | "source">> {
  const [aRows, qRows] = await Promise.all([
    prisma.generalInsuranceFundamental.findMany({
      where: { stockId, resultType: "standalone", ...(cutoff ? { reportDate: { lte: cutoff } } : {}) },
      orderBy: { fiscalYear: "asc" },
    }),
    prisma.generalInsuranceQuarterlyResult.findMany({
      where: { stockId, resultType: "standalone", ...(cutoff ? { reportDate: { lte: cutoff } } : {}) },
      orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }],
    }),
  ]);
  return {
    annualPeriodEnd: annualEnds(aRows),
    quarterlyPeriodEnd: quarterlyEnds(qRows),
    annual: aRows.map((r): FoundationAnnual => ({
      fiscalYear: r.fiscalYear,
      fyOrdinal: fyOrdinal(r.fiscalYear),
      revenue: n(r.totalRevenue), // ⚠ revenue account — see the life-insurance caveat
      otherIncome: n(r.otherIncome),
      financeCosts: null,
      depreciation: null,
      profitBeforeTax: n(r.profitBeforeTax),
      netProfit: n(r.netProfit), // shareholders' account
      equityShareCapital: n(r.shareCapital),
      otherEquity: n(r.reservesAndSurplus),
      totalEquity: n(r.netWorth),
      borrowingsCurrent: null,
      borrowingsNoncurrent: null,
      totalDebtStored: n(r.borrowings),
      totalAssets: n(r.totalAssets),
      currentLiabilities: n(r.currentLiabilities),
      tradeReceivablesCurrent: null,
      tradeReceivablesNoncurrent: null,
      propertyPlantAndEquipment: n(r.fixedAssets),
      capitalWorkInProgress: null,
      cashFromOperating: null, // no cash-flow columns in the IRDAI general schema
      capex: null,
      cashFromFinancing: null,
      faceValueShare: n(r.faceValueShare),
      stored: { ...NO_STORED, netWorth: n(r.netWorth) },
    })),
    quarterly: qRows.map((r): MomentumQuarter => ({
      fiscalYear: r.fiscalYear,
      quarter: r.quarter,
      qOrdinal: calendarQuarterOrdinal(r.reportDate),
      revenue: n(r.totalRevenue),
      otherIncome: n(r.otherIncome),
      interest: null,
      depreciation: null,
      profitBeforeTax: n(r.profitBeforeTax),
      netProfit: n(r.netProfit),
      operatingProfitStored: null, // see the header — underwriting profit is a different quantity
    })),
  };
}

/**
 * ★ THE ENTRY POINT. Resolve a stock's FILED annual + quarterly accounts from the table set its
 * industry actually files into.
 *
 * `cutoff` is the point-in-time backfill boundary, applied to `reportDate` exactly as the
 * non-financial loaders apply it — no future period leaks backward on any path.
 *
 * The non_financial arm DELEGATES to loadFoundationStandalone / loadMomentumStandalone rather than
 * re-implementing them, so a non-financial stock's rows are byte-identical to what every existing
 * caller already gets. That is not tidiness; it is what makes this change provably score-neutral.
 */
export async function loadFiledFinancials(
  stockId: string,
  industry: IndustryType,
  cutoff?: Date,
): Promise<FiledFinancials> {
  const source = SOURCE_BY_INDUSTRY[industry];
  switch (industry) {
    case "banking":
      return { industry, source, ...(await loadBankingFiled(stockId, cutoff)) };
    case "nbfc":
      return { industry, source, ...(await loadNbfcFiled(stockId, cutoff)) };
    case "life_insurance":
      return { industry, source, ...(await loadLifeInsuranceFiled(stockId, cutoff)) };
    case "general_insurance":
      return { industry, source, ...(await loadGeneralInsuranceFiled(stockId, cutoff)) };
    case "non_financial": {
      // ⚠ THE DELEGATION IS LOAD-BEARING and is not inlined: loadFoundationStandalone /
      // loadMomentumStandalone are the SAME functions the scoring pass uses, so a non-financial
      // stock's rows are byte-identical to what every existing caller gets. They map to
      // FoundationAnnual / MomentumQuarter, which carry no report_date, so the period ends come from
      // two select-only queries alongside. Two extra indexed reads, on the filing path only.
      const [annual, quarterly, aEnds, qEnds] = await Promise.all([
        loadFoundationStandalone(stockId, cutoff),
        loadMomentumStandalone(stockId, cutoff),
        prisma.fundamental.findMany({
          where: { stockId, resultType: "standalone", ...(cutoff ? { reportDate: { lte: cutoff } } : {}) },
          orderBy: { fiscalYear: "asc" },
          select: { fiscalYear: true, reportDate: true },
        }),
        prisma.quarterlyResult.findMany({
          where: { stockId, resultType: "standalone", ...(cutoff ? { reportDate: { lte: cutoff } } : {}) },
          orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }],
          select: { fiscalYear: true, quarter: true, reportDate: true },
        }),
      ]);
      return { industry, source, annual, quarterly, annualPeriodEnd: annualEnds(aEnds), quarterlyPeriodEnd: quarterlyEnds(qEnds) };
    }
  }
}
