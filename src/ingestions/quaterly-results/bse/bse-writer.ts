// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// INSERT-ONLY WRITER — the T3 guarantee, structural rather than conventional.
//
// ★ THE RULE: NSE wins wherever it has a row. BSE writes ONLY where NSE has none. A BSE row never
//   updates an existing row, on any basis, ever.
//
// ⚠ WHY THIS FILE EXISTS INSTEAD OF CALLING THE SHARED INGESTERS. Every v3 ingester ends in
//       prisma.<table>.upsert({ where: key, create: data, update: data })
//   on [stockId, quarter, fiscalYear, resultType] — a key that DOES NOT INCLUDE `source`. Calling one
//   of them from a BSE run overwrites the NSE row silently, and `decision` ("ingest" | "refresh")
//   only changes the returned status LABEL, not whether the write lands. That is the T3 shape in a
//   new costume, so the shared ingesters are not touched and not called.
//
// ★ THREE ENFORCEMENT LAYERS, all required. A guarantee without proof is what we had before T3.
//     (1) GUARANTEE — INSERT … ON CONFLICT DO NOTHING. Atomic, no read-then-write race, and
//         structurally incapable of updating a row it did not create. Implemented here.
//     (2) PROOF — an id + updated_at baseline of every NSE row, diffed after the run.
//     (3) PROOF — count of rows WHERE source LIKE 'nse\_%' AND updated_at > run_start; must be 0.
//   (2) and (3) live in bse-fence.ts.
//
// ⚠ WHAT THIS WRITER DELIBERATELY DOES NOT DO: derived columns. It writes RAW CELLS ONLY —
//   margins, QoQ/YoY, roce, debt_to_equity and the rest are computed by the
//   derive layer from the raw cells.
//
//   ⚠ operating_profit USED TO BE LISTED ABOVE AS DERIVED. IT IS NOT, AND THAT COST US THE NUMBER.
//   `deriveIndAsQuarterly` takes operatingProfit as a RAW INPUT and returns operatingMargin from it;
//   nothing anywhere computes operating_profit itself — the NSE parsers read it off the filing. So
//   omitting it here left it null forever on every BSE row, and operating margin null with it.
//   MEASURED 2026-08-28: 5,180 of 5,222 BSE quarterly rows had no operating profit, which is why a
//   stock's Margin Trend chart began part-way along and its OPM% column was blank before that.
//   It is written below as the raw cell it always was. That is the established convention (see the manual-entry
//   manifest: "Key the inputs; run src/fill/re-derive.ts"), and it keeps this lane's write surface
//   small enough to audit line by line.
//
// ⚠ RATIO COLUMNS ARE NULLED WHEN THE GATE REFUSES THEM. Never scaled, never guessed — the SBILIFE
//   ruling (fundamentals-view.service.ts:1417). See bse-ratio-gate.ts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../../generated/prisma/client.js";
import { checkPlContentless, checkScale, checkRevenueNonPositive } from "../fundamentals-guards.js";

export const BSE_SOURCE = "bse_xbrl";
/** ⚠ The only rows in the database for which this column is a FACT rather than a Prisma default —
 *  all 21,791 legacy NSE rows read `in_capmkt` while being in-bse-fin documents. Recorded, not fixed. */
export const BSE_TAXONOMY = "in_bse_fin";

export type WriteOutcome =
  | { written: true; rowId: string }
  | { written: false; reason: "nse_or_existing_row_present" }
  | { written: false; reason: "rejected_by_guard"; detail: string };

/** Anything with $executeRaw — the live client or an interactive transaction handle. */
export type SqlRunner = Pick<PrismaClient, "$executeRaw"> | Prisma.TransactionClient;

function num(v: number | null | undefined): number | null {
  return v === undefined || v === null || !Number.isFinite(v) ? null : v;
}

/** Money guards, applied per row before any statement is issued. Ratios are handled by the gate. */
function guardMoney(values: Array<number | null>, revenue: number | null, netProfit: number | null): string | null {
  if (checkPlContentless(revenue, netProfit)) {
    return "both revenue and net_profit are null — the tags did not resolve; refusing to store a contentless row";
  }
  for (const v of values) {
    if (checkScale(v)) return `value ${v} exceeds the scale ceiling — a unit break, refusing the row`;
  }
  if (checkRevenueNonPositive(revenue)) {
    return `revenue ${revenue} is present but non-positive — refusing the row`;
  }
  return null;
}

export interface QuarterlyCells {
  revenue: number | null;
  otherIncome: number | null;
  expenses: number | null;
  depreciation: number | null;
  interest: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;
}

/**
 * Operating profit for a BSE row: **revenue − expenses**, and only when the row proves that is the
 * right subtraction.
 *
 * ⚠ THE GUARD IS THE POINT. "expenses" means different things in different filings; here it must be
 *   the ALL-IN figure (depreciation and finance costs inside it) for revenue − expenses to be
 *   operating profit. The row states whether it is: if `pbt = revenue + other_income − expenses`
 *   holds, expenses is all-in and the subtraction is sound. MEASURED across the BSE lane, that
 *   identity holds on 4,959 of 5,222 rows — so it is checked per row, not assumed, and the ~5% where
 *   it fails get NULL instead of a number computed on a definition the filing does not support.
 *
 * Why not `pbt + interest − other_income` (what parser-indas.ts uses)? Because the universe already
 * disagrees with itself — 16,330 legacy NSE rows are EBITDA-style, current NSE rows are mostly
 * revenue − expenses — and revenue − expenses is what the CURRENT lane, the hand-keyed workbook and
 * every existing BSE row with this column already use. Matching the going-forward standard beats
 * introducing a third convention.
 */
export function bseOperatingProfit(c: QuarterlyCells): number | null {
  const { revenue: r, expenses: e, otherIncome: oi, profitBeforeTax: pbt } = c;
  if (r == null || e == null) return null;
  if (pbt == null) return null;
  const implied = r + (oi ?? 0) - e;
  const tol = Math.max(1, Math.abs(pbt) * 0.01);
  if (Math.abs(implied - pbt) > tol) return null;   // expenses is not the all-in figure here
  return Number((r - e).toFixed(4));
}

export interface RowIdentity {
  stockId: string;
  quarter: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: "standalone" | "consolidated";
  xbrlUrl: string;
}

/**
 * quarterly_results — insert only where no row exists for (stock, quarter, FY, basis).
 *
 * ⚠ ON CONFLICT DO NOTHING is the whole guarantee. Do not "improve" this into an upsert, a
 *   DO UPDATE, or a findFirst-then-insert. The first two overwrite NSE; the third races.
 */
export async function insertQuarterlyIfAbsent(
  db: SqlRunner,
  id: RowIdentity,
  c: QuarterlyCells,
): Promise<WriteOutcome> {
  const bad = guardMoney(
    [c.revenue, c.otherIncome, c.expenses, c.depreciation, c.interest, c.profitBeforeTax, c.tax, c.netProfit],
    num(c.revenue),
    num(c.netProfit),
  );
  if (bad) return { written: false, reason: "rejected_by_guard", detail: bad };

  const rowId = randomUUID();
  const operatingProfit = bseOperatingProfit(c);
  const affected = await db.$executeRaw`
    INSERT INTO quarterly_results (
      id, stock_id, quarter, fiscal_year, report_date, filing_date,
      result_type, xbrl_url, source, xbrl_taxonomy,
      revenue, other_income, expenses, depreciation, interest, operating_profit,
      profit_before_tax, tax, net_profit,
      created_at, updated_at
    ) VALUES (
      ${rowId}, ${id.stockId}, ${id.quarter}, ${id.fiscalYear}, ${id.reportDate}, ${id.filingDate},
      ${id.resultType}, ${id.xbrlUrl}, ${BSE_SOURCE}, ${BSE_TAXONOMY},
      ${num(c.revenue)}, ${num(c.otherIncome)}, ${num(c.expenses)}, ${num(c.depreciation)}, ${num(c.interest)}, ${num(operatingProfit)},
      ${num(c.profitBeforeTax)}, ${num(c.tax)}, ${num(c.netProfit)},
      NOW(), NOW()
    )
    ON CONFLICT (stock_id, quarter, fiscal_year, result_type) DO NOTHING`;

  return affected === 1 ? { written: true, rowId } : { written: false, reason: "nse_or_existing_row_present" };
}

export interface BankingQuarterlyCells {
  interestEarned: number | null;
  interestExpended: number | null;
  otherIncome: number | null;
  operatingExpenses: number | null;
  ppop: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;
  gnpaAbsolute: number | null;
  nnpaAbsolute: number | null;
  /** ⚠ Every field below is NULL unless the ratio gate accepted it. */
  gnpaPct: number | null;
  nnpaPct: number | null;
  cet1Ratio: number | null;
  additionalTier1Ratio: number | null;
  roaQuarterly: number | null;
}

export async function insertBankingQuarterlyIfAbsent(
  db: SqlRunner,
  id: RowIdentity,
  c: BankingQuarterlyCells,
): Promise<WriteOutcome> {
  // A bank has no `revenue`; interest_earned is the contentless-check stand-in.
  const bad = guardMoney(
    [c.interestEarned, c.interestExpended, c.otherIncome, c.operatingExpenses, c.ppop, c.profitBeforeTax, c.tax, c.netProfit, c.gnpaAbsolute, c.nnpaAbsolute],
    num(c.interestEarned),
    num(c.netProfit),
  );
  if (bad) return { written: false, reason: "rejected_by_guard", detail: bad };

  const rowId = randomUUID();
  const affected = await db.$executeRaw`
    INSERT INTO banking_quarterly_results (
      id, stock_id, quarter, fiscal_year, report_date, filing_date,
      result_type, xbrl_url, source, xbrl_taxonomy,
      interest_earned, interest_expended, other_income, operating_expenses, ppop,
      profit_before_tax, tax, net_profit, gnpa_absolute, nnpa_absolute,
      gnpa_pct, nnpa_pct, cet1_ratio, additional_tier1_ratio, roa_quarterly,
      audit_pending, created_at, updated_at
    ) VALUES (
      ${rowId}, ${id.stockId}, ${id.quarter}, ${id.fiscalYear}, ${id.reportDate}, ${id.filingDate},
      ${id.resultType}, ${id.xbrlUrl}, ${BSE_SOURCE}, ${BSE_TAXONOMY},
      ${num(c.interestEarned)}, ${num(c.interestExpended)}, ${num(c.otherIncome)}, ${num(c.operatingExpenses)}, ${num(c.ppop)},
      ${num(c.profitBeforeTax)}, ${num(c.tax)}, ${num(c.netProfit)}, ${num(c.gnpaAbsolute)}, ${num(c.nnpaAbsolute)},
      ${num(c.gnpaPct)}, ${num(c.nnpaPct)}, ${num(c.cet1Ratio)}, ${num(c.additionalTier1Ratio)}, ${num(c.roaQuarterly)},
      false, NOW(), NOW()
    )
    ON CONFLICT (stock_id, quarter, fiscal_year, result_type) DO NOTHING`;

  return affected === 1 ? { written: true, rowId } : { written: false, reason: "nse_or_existing_row_present" };
}

export interface AnnualIdentity {
  stockId: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  resultType: "standalone" | "consolidated";
  xbrlUrl: string;
}

export interface FundamentalCells {
  revenue: number | null;
  otherIncome: number | null;
  expenses: number | null;
  employeeBenefitExpense: number | null;
  financeCosts: number | null;
  depreciation: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;
  faceValueShare: number | null;
  totalAssets: number | null;
  propertyPlantAndEquipment: number | null;
  capitalWorkInProgress: number | null;
  tradeReceivablesCurrent: number | null;
  tradeReceivablesNoncurrent: number | null;
  borrowingsCurrent: number | null;
  borrowingsNoncurrent: number | null;
  currentLiabilities: number | null;
  equityShareCapital: number | null;
  otherEquity: number | null;
  totalEquity: number | null;
  cashFromOperating: number | null;
  cashFromFinancing: number | null;
  capex: number | null;
  // -- THE BALANCE SHEET AND CASH-FLOW STATEMENT, ADDED 2026-08-28 -----------------------------
  // The BSE annual instance carries all of this and the lane read none of it: 24 cells out of a
  // ~270-element document. MEASURED - 310 stocks have BSE-only annual data and 727 of the 742 BSE
  // annual rows are the sole source for their stock-year, so those pages showed dashes across the
  // whole balance sheet with no NSE row to fall back on.
  // Tag names are copied from parser-indas.ts, which reads the SAME taxonomy for the NSE lane, so
  // the two lanes cannot drift on what a field is called.
  equityAttributableToOwners: number | null;
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
  noncurrentLiabilities: number | null;
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
  inventories: number | null;
  currentInvestments: number | null;
  cashAndCashEquivalents: number | null;
  bankBalanceOther: number | null;
  loansCurrent: number | null;
  otherCurrentFinancialAssets: number | null;
  otherCurrentAssets: number | null;
  currentTaxAssets: number | null;
  noncurrentAssetsHeldForSale: number | null;
  currentAssets: number | null;
  cashFromInvesting: number | null;
  netCashFlow: number | null;
  proceedsFromBorrowings: number | null;
  repaymentsOfBorrowings: number | null;
  dividendsPaid: number | null;
  basicEps: number | null;
  dilutedEps: number | null;
  paidUpEquityCapital: number | null;
  // ⚠ ADDED SEPARATELY: interest_paid needs a TWO-TAG fallback (financing OR operating
  //   activities), so it did not fit the single-tag list the other 41 were generated from
  //   and was silently dropped by that generation. Caught by re-running the gap audit
  //   after the backfill rather than by reading the diff.
  interestPaid: number | null;
}

export async function insertFundamentalIfAbsent(
  db: SqlRunner,
  id: AnnualIdentity,
  c: FundamentalCells,
): Promise<WriteOutcome> {
  const bad = guardMoney(
    [c.revenue, c.otherIncome, c.expenses, c.financeCosts, c.depreciation, c.profitBeforeTax, c.tax, c.netProfit, c.totalAssets, c.totalEquity],
    num(c.revenue),
    num(c.netProfit),
  );
  if (bad) return { written: false, reason: "rejected_by_guard", detail: bad };

  const rowId = randomUUID();
  const affected = await db.$executeRaw`
    INSERT INTO fundamentals (
      id, stock_id, fiscal_year, report_date, filing_date,
      result_type, xbrl_url, source, xbrl_taxonomy,
      revenue, other_income, expenses, employee_benefit_expense, finance_costs, depreciation,
      profit_before_tax, tax, net_profit, face_value_share,
      total_assets, property_plant_and_equipment, capital_work_in_progress,
      trade_receivables_current, trade_receivables_noncurrent,
      borrowings_current, borrowings_noncurrent, current_liabilities,
      equity_share_capital, other_equity, total_equity,
      cash_from_operating, cash_from_financing, capex,
      equity_attributable_to_owners, trade_payables_current, trade_payables_noncurrent, other_current_liabilities, other_noncurrent_liabilities, other_current_financial_liabilities, other_noncurrent_financial_liabilities, provisions_current, provisions_noncurrent, current_tax_liabilities, deferred_tax_liabilities_net, noncurrent_liabilities, goodwill, other_intangible_assets, intangible_assets_under_development, noncurrent_investments, loans_noncurrent, other_noncurrent_financial_assets, other_noncurrent_assets, deferred_tax_assets_net, investment_property, investments_equity_method, noncurrent_assets, inventories, current_investments, cash_and_cash_equivalents, bank_balance_other, loans_current, other_current_financial_assets, other_current_assets, current_tax_assets, noncurrent_assets_held_for_sale, current_assets, cash_from_investing, net_cash_flow, proceeds_from_borrowings, repayments_of_borrowings, dividends_paid, basic_eps, diluted_eps, paid_up_equity_capital, interest_paid,
      created_at, updated_at
    ) VALUES (
      ${rowId}, ${id.stockId}, ${id.fiscalYear}, ${id.reportDate}, ${id.filingDate},
      ${id.resultType}, ${id.xbrlUrl}, ${BSE_SOURCE}, ${BSE_TAXONOMY},
      ${num(c.revenue)}, ${num(c.otherIncome)}, ${num(c.expenses)}, ${num(c.employeeBenefitExpense)}, ${num(c.financeCosts)}, ${num(c.depreciation)},
      ${num(c.profitBeforeTax)}, ${num(c.tax)}, ${num(c.netProfit)}, ${num(c.faceValueShare)},
      ${num(c.totalAssets)}, ${num(c.propertyPlantAndEquipment)}, ${num(c.capitalWorkInProgress)},
      ${num(c.tradeReceivablesCurrent)}, ${num(c.tradeReceivablesNoncurrent)},
      ${num(c.borrowingsCurrent)}, ${num(c.borrowingsNoncurrent)}, ${num(c.currentLiabilities)},
      ${num(c.equityShareCapital)}, ${num(c.otherEquity)}, ${num(c.totalEquity)},
      ${num(c.cashFromOperating)}, ${num(c.cashFromFinancing)}, ${num(c.capex)},
      ${num(c.equityAttributableToOwners)}, ${num(c.tradePayablesCurrent)}, ${num(c.tradePayablesNoncurrent)}, ${num(c.otherCurrentLiabilities)}, ${num(c.otherNoncurrentLiabilities)}, ${num(c.otherCurrentFinancialLiabilities)}, ${num(c.otherNoncurrentFinancialLiabilities)}, ${num(c.provisionsCurrent)}, ${num(c.provisionsNoncurrent)}, ${num(c.currentTaxLiabilities)}, ${num(c.deferredTaxLiabilitiesNet)}, ${num(c.noncurrentLiabilities)}, ${num(c.goodwill)}, ${num(c.otherIntangibleAssets)}, ${num(c.intangibleAssetsUnderDevelopment)}, ${num(c.noncurrentInvestments)}, ${num(c.loansNoncurrent)}, ${num(c.otherNoncurrentFinancialAssets)}, ${num(c.otherNoncurrentAssets)}, ${num(c.deferredTaxAssetsNet)}, ${num(c.investmentProperty)}, ${num(c.investmentsEquityMethod)}, ${num(c.noncurrentAssets)}, ${num(c.inventories)}, ${num(c.currentInvestments)}, ${num(c.cashAndCashEquivalents)}, ${num(c.bankBalanceOther)}, ${num(c.loansCurrent)}, ${num(c.otherCurrentFinancialAssets)}, ${num(c.otherCurrentAssets)}, ${num(c.currentTaxAssets)}, ${num(c.noncurrentAssetsHeldForSale)}, ${num(c.currentAssets)}, ${num(c.cashFromInvesting)}, ${num(c.netCashFlow)}, ${num(c.proceedsFromBorrowings)}, ${num(c.repaymentsOfBorrowings)}, ${num(c.dividendsPaid)}, ${num(c.basicEps)}, ${num(c.dilutedEps)}, ${num(c.paidUpEquityCapital)}, ${num(c.interestPaid)},
      NOW(), NOW()
    )
    ON CONFLICT (stock_id, fiscal_year, result_type) DO NOTHING`;

  return affected === 1 ? { written: true, rowId } : { written: false, reason: "nse_or_existing_row_present" };
}

export interface BankingFundamentalCells {
  interestEarned: number | null;
  interestExpended: number | null;
  otherIncome: number | null;
  operatingExpenses: number | null;
  ppop: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;
  advances: number | null;
  deposits: number | null;
  investments: number | null;
  cashAndBalancesWithRbi: number | null;
  balancesWithBanks: number | null;
  totalAssets: number | null;
  gnpaAbsolute: number | null;
  nnpaAbsolute: number | null;
  /** ⚠ NULL unless the ratio gate accepted it. tier1_ratio has no tag at all — always null here. */
  gnpaPct: number | null;
  nnpaPct: number | null;
  cet1Ratio: number | null;
  additionalTier1Ratio: number | null;
  tier1Ratio: number | null;
  roaDisclosed: number | null;
}

export async function insertBankingFundamentalIfAbsent(
  db: SqlRunner,
  id: AnnualIdentity,
  c: BankingFundamentalCells,
): Promise<WriteOutcome> {
  const bad = guardMoney(
    [c.interestEarned, c.interestExpended, c.otherIncome, c.operatingExpenses, c.ppop, c.profitBeforeTax, c.tax, c.netProfit, c.advances, c.deposits, c.investments, c.totalAssets],
    num(c.interestEarned),
    num(c.netProfit),
  );
  if (bad) return { written: false, reason: "rejected_by_guard", detail: bad };

  const rowId = randomUUID();
  const affected = await db.$executeRaw`
    INSERT INTO banking_fundamentals (
      id, stock_id, fiscal_year, report_date, filing_date,
      result_type, xbrl_url, source, xbrl_taxonomy,
      interest_earned, interest_expended, other_income, operating_expenses, ppop,
      profit_before_tax, tax, net_profit,
      advances, deposits, investments, cash_and_balances_with_rbi, balances_with_banks, total_assets,
      gnpa_absolute, nnpa_absolute,
      gnpa_pct, nnpa_pct, cet1_ratio, additional_tier1_ratio, tier1_ratio, roa_disclosed,
      created_at, updated_at
    ) VALUES (
      ${rowId}, ${id.stockId}, ${id.fiscalYear}, ${id.reportDate}, ${id.filingDate},
      ${id.resultType}, ${id.xbrlUrl}, ${BSE_SOURCE}, ${BSE_TAXONOMY},
      ${num(c.interestEarned)}, ${num(c.interestExpended)}, ${num(c.otherIncome)}, ${num(c.operatingExpenses)}, ${num(c.ppop)},
      ${num(c.profitBeforeTax)}, ${num(c.tax)}, ${num(c.netProfit)},
      ${num(c.advances)}, ${num(c.deposits)}, ${num(c.investments)}, ${num(c.cashAndBalancesWithRbi)}, ${num(c.balancesWithBanks)}, ${num(c.totalAssets)},
      ${num(c.gnpaAbsolute)}, ${num(c.nnpaAbsolute)},
      ${num(c.gnpaPct)}, ${num(c.nnpaPct)}, ${num(c.cet1Ratio)}, ${num(c.additionalTier1Ratio)}, ${num(c.tier1Ratio)}, ${num(c.roaDisclosed)},
      NOW(), NOW()
    )
    ON CONFLICT (stock_id, fiscal_year, result_type) DO NOTHING`;

  return affected === 1 ? { written: true, rowId } : { written: false, reason: "nse_or_existing_row_present" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// NBFC — added 2026-08-24.
//
// BSE serves NBFC results under the SAME in-bse-fin namespace and the same
// OneD/FourD/OneI contexts as a non-financial filing. CANFINHOME FY2019 is a
// Main_Ind_As document; its later filings sit under NBFCUploadDocument; both carry
// the identical tag vocabulary (RevenueFromOperations, Expenses, FinanceCosts,
// ProfitBeforeTax, ProfitLossForPeriod, Assets, Equity, Borrowings*). So this is
// the Ind-AS cell set ROUTED to the NBFC tables — not a new taxonomy.
//
// ⚠ The genuinely NBFC-shaped columns — interest_income, fee_and_commission_income,
//   impairment_on_financial_instruments, loans, debt_securities,
//   subordinated_liabilities — are NOT in these documents and are deliberately not
//   written. Leaving them untouched keeps "BSE never carried this" distinguishable
//   from "BSE carried it and it was zero".
// ═══════════════════════════════════════════════════════════════════════════════

export interface NbfcQuarterlyCells {
  revenue: number | null;
  otherIncome: number | null;
  totalIncome: number | null;
  financeCosts: number | null;
  employeeBenefitExpense: number | null;
  depreciation: number | null;
  totalExpenses: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;
}

export async function insertNbfcQuarterlyIfAbsent(
  db: SqlRunner,
  id: RowIdentity,
  c: NbfcQuarterlyCells,
): Promise<WriteOutcome> {
  const bad = guardMoney(
    [c.revenue, c.otherIncome, c.totalIncome, c.financeCosts, c.employeeBenefitExpense,
     c.depreciation, c.totalExpenses, c.profitBeforeTax, c.tax, c.netProfit],
    num(c.revenue),
    num(c.netProfit),
  );
  if (bad) return { written: false, reason: "rejected_by_guard", detail: bad };

  const rowId = randomUUID();
  const affected = await db.$executeRaw`
    INSERT INTO nbfc_quarterly_results (
      id, stock_id, quarter, fiscal_year, report_date, filing_date,
      result_type, xbrl_url, source, xbrl_taxonomy,
      revenue, other_income, total_income, finance_costs, employee_benefit_expense,
      depreciation, total_expenses, profit_before_tax, tax, net_profit,
      created_at, updated_at
    ) VALUES (
      ${rowId}, ${id.stockId}, ${id.quarter}, ${id.fiscalYear}, ${id.reportDate}, ${id.filingDate},
      ${id.resultType}, ${id.xbrlUrl}, ${BSE_SOURCE}, ${BSE_TAXONOMY},
      ${num(c.revenue)}, ${num(c.otherIncome)}, ${num(c.totalIncome)}, ${num(c.financeCosts)}, ${num(c.employeeBenefitExpense)},
      ${num(c.depreciation)}, ${num(c.totalExpenses)}, ${num(c.profitBeforeTax)}, ${num(c.tax)}, ${num(c.netProfit)},
      NOW(), NOW()
    )
    ON CONFLICT (stock_id, quarter, fiscal_year, result_type) DO NOTHING`;

  return affected === 1 ? { written: true, rowId } : { written: false, reason: "nse_or_existing_row_present" };
}

export interface NbfcFundamentalCells extends NbfcQuarterlyCells {
  equityShareCapital: number | null;
  otherEquity: number | null;
  totalEquity: number | null;
  cashAndCashEquivalents: number | null;
  bankBalanceOther: number | null;
  investments: number | null;
  propertyPlantAndEquipment: number | null;
  capitalWorkInProgress: number | null;
  goodwill: number | null;
  intangibleAssetsUnderDevelopment: number | null;
  totalAssets: number | null;
  borrowings: number | null;
  totalLiabilities: number | null;
  currentTaxAssetsNet: number | null;
  deferredTaxAssetsNet: number | null;
  currentTaxLiabilitiesNet: number | null;
  deferredTaxLiabilitiesNet: number | null;
}

export async function insertNbfcFundamentalIfAbsent(
  db: SqlRunner,
  id: AnnualIdentity,
  c: NbfcFundamentalCells,
): Promise<WriteOutcome> {
  const bad = guardMoney(
    [c.revenue, c.otherIncome, c.totalIncome, c.financeCosts, c.depreciation, c.totalExpenses,
     c.profitBeforeTax, c.tax, c.netProfit, c.totalAssets, c.totalEquity, c.borrowings, c.totalLiabilities],
    num(c.revenue),
    num(c.netProfit),
  );
  if (bad) return { written: false, reason: "rejected_by_guard", detail: bad };

  const rowId = randomUUID();
  const affected = await db.$executeRaw`
    INSERT INTO nbfc_fundamentals (
      id, stock_id, fiscal_year, report_date, filing_date,
      result_type, xbrl_url, source, xbrl_taxonomy,
      revenue, other_income, total_income, finance_costs, employee_benefit_expense,
      depreciation, total_expenses, profit_before_tax, tax, net_profit,
      equity_share_capital, other_equity, total_equity,
      cash_and_cash_equivalents, bank_balance_other, investments,
      property_plant_and_equipment, capital_work_in_progress, goodwill,
      intangible_assets_under_development, total_assets, borrowings, total_liabilities,
      current_tax_assets_net, deferred_tax_assets_net,
      current_tax_liabilities_net, deferred_tax_liabilities_net,
      created_at, updated_at
    ) VALUES (
      ${rowId}, ${id.stockId}, ${id.fiscalYear}, ${id.reportDate}, ${id.filingDate},
      ${id.resultType}, ${id.xbrlUrl}, ${BSE_SOURCE}, ${BSE_TAXONOMY},
      ${num(c.revenue)}, ${num(c.otherIncome)}, ${num(c.totalIncome)}, ${num(c.financeCosts)}, ${num(c.employeeBenefitExpense)},
      ${num(c.depreciation)}, ${num(c.totalExpenses)}, ${num(c.profitBeforeTax)}, ${num(c.tax)}, ${num(c.netProfit)},
      ${num(c.equityShareCapital)}, ${num(c.otherEquity)}, ${num(c.totalEquity)},
      ${num(c.cashAndCashEquivalents)}, ${num(c.bankBalanceOther)}, ${num(c.investments)},
      ${num(c.propertyPlantAndEquipment)}, ${num(c.capitalWorkInProgress)}, ${num(c.goodwill)},
      ${num(c.intangibleAssetsUnderDevelopment)}, ${num(c.totalAssets)}, ${num(c.borrowings)}, ${num(c.totalLiabilities)},
      ${num(c.currentTaxAssetsNet)}, ${num(c.deferredTaxAssetsNet)},
      ${num(c.currentTaxLiabilitiesNet)}, ${num(c.deferredTaxLiabilitiesNet)},
      NOW(), NOW()
    )
    ON CONFLICT (stock_id, fiscal_year, result_type) DO NOTHING`;

  return affected === 1 ? { written: true, rowId } : { written: false, reason: "nse_or_existing_row_present" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSURANCE — life and general. Added 2026-08-25 (Stage 7a).
//
// These filings declare the `in-capmkt` prefix rather than `in-bse-fin`, but carry
// the SAME context names (OneD / OneI / FourD / FourI). factNs() in
// parser-legacy-common.ts detects the prefix, so what is genuinely different here
// is only the TAG VOCABULARY — premiums, claims, commissions, benefits.
//
// ⚠️ RATIO COLUMNS ARE NOT WRITTEN. combined_ratio / incurred_claim_ratio /
//   expenses_of_management_ratio / solvency_ratio / persistency_* are omitted on
//   purpose: the documents carry them mis-scaled (ICICIGI FY19 files
//   CombinedRatio = 0.0098 for a ratio that should read ~0.98) and this lane has a
//   dedicated ratio gate for that. Writing them straight through would bypass it.
// ═══════════════════════════════════════════════════════════════════════════════

/** Insurance filings are in-capmkt, not in-bse-fin — recorded so a row's taxonomy is honest. */
const INSURANCE_TAXONOMY = "in_capmkt";

export interface LifeInsuranceQuarterlyCells {
  grossPremiumIncome: number | null;
  netPremiumIncome: number | null;
  incomeFirstYearPremium: number | null;
  incomeRenewalPremium: number | null;
  incomeSinglePremium: number | null;
  reinsuranceCeded: number | null;
  incomeFromInvestments: number | null;
  totalRevenuePolicyholders: number | null;
  totalCommission: number | null;
  totalOperatingExpenses: number | null;
  benefitsPaidNet: number | null;
  changeInValuationOfLiabilities: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;
}

export async function insertLifeInsuranceQuarterlyIfAbsent(
  db: SqlRunner,
  id: RowIdentity,
  c: LifeInsuranceQuarterlyCells,
): Promise<WriteOutcome> {
  const bad = guardMoney([c.grossPremiumIncome, c.netPremiumIncome, c.incomeFirstYearPremium, c.incomeRenewalPremium, c.incomeSinglePremium, c.reinsuranceCeded, c.incomeFromInvestments, c.totalRevenuePolicyholders, c.totalCommission, c.totalOperatingExpenses, c.benefitsPaidNet, c.changeInValuationOfLiabilities], num(c.grossPremiumIncome), num(c.netProfit ?? null));
  if (bad) return { written: false, reason: "rejected_by_guard", detail: bad };

  const rowId = randomUUID();
  const affected = await db.$executeRaw`
    INSERT INTO life_insurance_quarterly_results (
      id, stock_id, quarter, fiscal_year, report_date, filing_date,
      result_type, xbrl_url, source, xbrl_taxonomy,
      gross_premium_income, net_premium_income, income_first_year_premium, income_renewal_premium, income_single_premium, reinsurance_ceded, income_from_investments, total_revenue_policyholders, total_commission, total_operating_expenses, benefits_paid_net, change_in_valuation_of_liabilities, profit_before_tax, tax, net_profit,
      created_at, updated_at
    ) VALUES (
      ${rowId}, ${id.stockId}, ${id.quarter}, ${id.fiscalYear}, ${id.reportDate}, ${id.filingDate},
      ${id.resultType}, ${id.xbrlUrl}, ${BSE_SOURCE}, ${INSURANCE_TAXONOMY},
      ${num(c.grossPremiumIncome)}, ${num(c.netPremiumIncome)}, ${num(c.incomeFirstYearPremium)}, ${num(c.incomeRenewalPremium)}, ${num(c.incomeSinglePremium)}, ${num(c.reinsuranceCeded)}, ${num(c.incomeFromInvestments)}, ${num(c.totalRevenuePolicyholders)}, ${num(c.totalCommission)}, ${num(c.totalOperatingExpenses)}, ${num(c.benefitsPaidNet)}, ${num(c.changeInValuationOfLiabilities)}, ${num(c.profitBeforeTax)}, ${num(c.tax)}, ${num(c.netProfit)},
      NOW(), NOW()
    )
    ON CONFLICT (stock_id, quarter, fiscal_year, result_type) DO NOTHING`;

  return affected === 1 ? { written: true, rowId } : { written: false, reason: "nse_or_existing_row_present" };
}

export interface LifeInsuranceFundamentalCells {
  grossPremiumIncome: number | null;
  netPremiumIncome: number | null;
  incomeFirstYearPremium: number | null;
  incomeRenewalPremium: number | null;
  incomeSinglePremium: number | null;
  reinsuranceCeded: number | null;
  incomeFromInvestments: number | null;
  otherIncomePolicyholders: number | null;
  totalRevenuePolicyholders: number | null;
  commissionFirstYearPremium: number | null;
  commissionRenewalPremium: number | null;
  commissionSinglePremium: number | null;
  totalCommission: number | null;
  employeesRemuneration: number | null;
  administrationExpenses: number | null;
  advertisementAndPublicity: number | null;
  totalOperatingExpenses: number | null;
  benefitsPaidNet: number | null;
  changeInValuationOfLiabilities: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;
}

export async function insertLifeInsuranceFundamentalIfAbsent(
  db: SqlRunner,
  id: AnnualIdentity,
  c: LifeInsuranceFundamentalCells,
): Promise<WriteOutcome> {
  const bad = guardMoney([c.grossPremiumIncome, c.netPremiumIncome, c.incomeFirstYearPremium, c.incomeRenewalPremium, c.incomeSinglePremium, c.reinsuranceCeded, c.incomeFromInvestments, c.otherIncomePolicyholders, c.totalRevenuePolicyholders, c.commissionFirstYearPremium, c.commissionRenewalPremium, c.commissionSinglePremium], num(c.grossPremiumIncome), num(c.netProfit ?? null));
  if (bad) return { written: false, reason: "rejected_by_guard", detail: bad };

  const rowId = randomUUID();
  const affected = await db.$executeRaw`
    INSERT INTO life_insurance_fundamentals (
      id, stock_id, fiscal_year, report_date, filing_date,
      result_type, xbrl_url, source, xbrl_taxonomy,
      gross_premium_income, net_premium_income, income_first_year_premium, income_renewal_premium, income_single_premium, reinsurance_ceded, income_from_investments, other_income_policyholders, total_revenue_policyholders, commission_first_year_premium, commission_renewal_premium, commission_single_premium, total_commission, employees_remuneration, administration_expenses, advertisement_and_publicity, total_operating_expenses, benefits_paid_net, change_in_valuation_of_liabilities, profit_before_tax, tax, net_profit,
      created_at, updated_at
    ) VALUES (
      ${rowId}, ${id.stockId}, ${id.fiscalYear}, ${id.reportDate}, ${id.filingDate},
      ${id.resultType}, ${id.xbrlUrl}, ${BSE_SOURCE}, ${INSURANCE_TAXONOMY},
      ${num(c.grossPremiumIncome)}, ${num(c.netPremiumIncome)}, ${num(c.incomeFirstYearPremium)}, ${num(c.incomeRenewalPremium)}, ${num(c.incomeSinglePremium)}, ${num(c.reinsuranceCeded)}, ${num(c.incomeFromInvestments)}, ${num(c.otherIncomePolicyholders)}, ${num(c.totalRevenuePolicyholders)}, ${num(c.commissionFirstYearPremium)}, ${num(c.commissionRenewalPremium)}, ${num(c.commissionSinglePremium)}, ${num(c.totalCommission)}, ${num(c.employeesRemuneration)}, ${num(c.administrationExpenses)}, ${num(c.advertisementAndPublicity)}, ${num(c.totalOperatingExpenses)}, ${num(c.benefitsPaidNet)}, ${num(c.changeInValuationOfLiabilities)}, ${num(c.profitBeforeTax)}, ${num(c.tax)}, ${num(c.netProfit)},
      NOW(), NOW()
    )
    ON CONFLICT (stock_id, fiscal_year, result_type) DO NOTHING`;

  return affected === 1 ? { written: true, rowId } : { written: false, reason: "nse_or_existing_row_present" };
}

export interface GeneralInsuranceQuarterlyCells {
  grossPremiumsWritten: number | null;
  netPremiumWritten: number | null;
  netPremium: number | null;
  premiumEarned: number | null;
  incomeFromInvestments: number | null;
  otherIncome: number | null;
  totalRevenue: number | null;
  claimsPaid: number | null;
  incurredClaims: number | null;
  netCommission: number | null;
  totalOperatingExpensesRelatedToInsurance: number | null;
  underwritingProfitOrLoss: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;
}

export async function insertGeneralInsuranceQuarterlyIfAbsent(
  db: SqlRunner,
  id: RowIdentity,
  c: GeneralInsuranceQuarterlyCells,
): Promise<WriteOutcome> {
  const bad = guardMoney([c.grossPremiumsWritten, c.netPremiumWritten, c.netPremium, c.premiumEarned, c.incomeFromInvestments, c.otherIncome, c.totalRevenue, c.claimsPaid, c.incurredClaims, c.netCommission, c.totalOperatingExpensesRelatedToInsurance, c.underwritingProfitOrLoss], num(c.grossPremiumsWritten), num(c.netProfit ?? null));
  if (bad) return { written: false, reason: "rejected_by_guard", detail: bad };

  const rowId = randomUUID();
  const affected = await db.$executeRaw`
    INSERT INTO general_insurance_quarterly_results (
      id, stock_id, quarter, fiscal_year, report_date, filing_date,
      result_type, xbrl_url, source, xbrl_taxonomy,
      gross_premiums_written, net_premium_written, net_premium, premium_earned, income_from_investments, other_income, total_revenue, claims_paid, incurred_claims, net_commission, total_operating_expenses_related_to_insurance, underwriting_profit_or_loss, profit_before_tax, tax, net_profit,
      created_at, updated_at
    ) VALUES (
      ${rowId}, ${id.stockId}, ${id.quarter}, ${id.fiscalYear}, ${id.reportDate}, ${id.filingDate},
      ${id.resultType}, ${id.xbrlUrl}, ${BSE_SOURCE}, ${INSURANCE_TAXONOMY},
      ${num(c.grossPremiumsWritten)}, ${num(c.netPremiumWritten)}, ${num(c.netPremium)}, ${num(c.premiumEarned)}, ${num(c.incomeFromInvestments)}, ${num(c.otherIncome)}, ${num(c.totalRevenue)}, ${num(c.claimsPaid)}, ${num(c.incurredClaims)}, ${num(c.netCommission)}, ${num(c.totalOperatingExpensesRelatedToInsurance)}, ${num(c.underwritingProfitOrLoss)}, ${num(c.profitBeforeTax)}, ${num(c.tax)}, ${num(c.netProfit)},
      NOW(), NOW()
    )
    ON CONFLICT (stock_id, quarter, fiscal_year, result_type) DO NOTHING`;

  return affected === 1 ? { written: true, rowId } : { written: false, reason: "nse_or_existing_row_present" };
}

export interface GeneralInsuranceFundamentalCells {
  grossPremiumsWritten: number | null;
  netPremiumWritten: number | null;
  netPremium: number | null;
  premiumEarned: number | null;
  reinsuranceCeded: number | null;
  changeInUnexpiredRiskReserve: number | null;
  incomeFromInvestments: number | null;
  otherIncome: number | null;
  totalRevenue: number | null;
  claimsPaid: number | null;
  changeInOutstandingClaims: number | null;
  incurredClaims: number | null;
  netCommission: number | null;
  employeesRemuneration: number | null;
  advertisementAndPublicity: number | null;
  totalOperatingExpensesRelatedToInsurance: number | null;
  premiumDeficiency: number | null;
  underwritingProfitOrLoss: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;
}

export async function insertGeneralInsuranceFundamentalIfAbsent(
  db: SqlRunner,
  id: AnnualIdentity,
  c: GeneralInsuranceFundamentalCells,
): Promise<WriteOutcome> {
  const bad = guardMoney([c.grossPremiumsWritten, c.netPremiumWritten, c.netPremium, c.premiumEarned, c.reinsuranceCeded, c.changeInUnexpiredRiskReserve, c.incomeFromInvestments, c.otherIncome, c.totalRevenue, c.claimsPaid, c.changeInOutstandingClaims, c.incurredClaims], num(c.grossPremiumsWritten), num(c.netProfit ?? null));
  if (bad) return { written: false, reason: "rejected_by_guard", detail: bad };

  const rowId = randomUUID();
  const affected = await db.$executeRaw`
    INSERT INTO general_insurance_fundamentals (
      id, stock_id, fiscal_year, report_date, filing_date,
      result_type, xbrl_url, source, xbrl_taxonomy,
      gross_premiums_written, net_premium_written, net_premium, premium_earned, reinsurance_ceded, change_in_unexpired_risk_reserve, income_from_investments, other_income, total_revenue, claims_paid, change_in_outstanding_claims, incurred_claims, net_commission, employees_remuneration, advertisement_and_publicity, total_operating_expenses_related_to_insurance, premium_deficiency, underwriting_profit_or_loss, profit_before_tax, tax, net_profit,
      created_at, updated_at
    ) VALUES (
      ${rowId}, ${id.stockId}, ${id.fiscalYear}, ${id.reportDate}, ${id.filingDate},
      ${id.resultType}, ${id.xbrlUrl}, ${BSE_SOURCE}, ${INSURANCE_TAXONOMY},
      ${num(c.grossPremiumsWritten)}, ${num(c.netPremiumWritten)}, ${num(c.netPremium)}, ${num(c.premiumEarned)}, ${num(c.reinsuranceCeded)}, ${num(c.changeInUnexpiredRiskReserve)}, ${num(c.incomeFromInvestments)}, ${num(c.otherIncome)}, ${num(c.totalRevenue)}, ${num(c.claimsPaid)}, ${num(c.changeInOutstandingClaims)}, ${num(c.incurredClaims)}, ${num(c.netCommission)}, ${num(c.employeesRemuneration)}, ${num(c.advertisementAndPublicity)}, ${num(c.totalOperatingExpensesRelatedToInsurance)}, ${num(c.premiumDeficiency)}, ${num(c.underwritingProfitOrLoss)}, ${num(c.profitBeforeTax)}, ${num(c.tax)}, ${num(c.netProfit)},
      NOW(), NOW()
    )
    ON CONFLICT (stock_id, fiscal_year, result_type) DO NOTHING`;

  return affected === 1 ? { written: true, rowId } : { written: false, reason: "nse_or_existing_row_present" };
}
