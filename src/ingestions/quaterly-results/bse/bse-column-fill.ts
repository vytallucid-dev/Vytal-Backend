// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE NULL-ONLY COLUMN FILL — the SECOND verb, deliberately in its own file.
//
// ── WHY THIS IS NOT IN bse-writer.ts ──────────────────────────────────────────────────────────────
// bse-writer.ts is INSERT-only and every statement in it ends in ON CONFLICT DO NOTHING. That is the
// T3 guarantee, and it is a guarantee precisely because the file contains no statement that can
// modify an existing row. Adding an UPDATE to it would end that — the ruling from the workbook
// import applies unchanged: TWO VERBS IN ONE WRITER IS HOW A GUARANTEE STOPS BEING ONE.
//
// ── WHAT THIS FILLS, AND WHY AN INSERT CANNOT ─────────────────────────────────────────────────────
// "Type A" cells: the row is held (NSE ingested it) but specific columns are null. ON CONFLICT DO
// NOTHING sees the row and does nothing, so the null stays null forever. MEASURED 2026-08-22 after
// the workbook import: 861 type-A cells remain, of which 443 sit on a period BSE serves — dominated
// by 408 cells that are 26 banks × FY18–FY23 × four balance-sheet lines.
//
//   ★ THE CORRECTION THAT PRODUCED THIS FILE. Those four lines are ABSENT from the NSE document whose
//     URL the row already stores (AUBANK FY20, BANKING_54983_…_WEB.xml — 73 elements, no balance
//     sheet). They are PRESENT in the BSE annual filing for the same bank-year (AUBANK FY19,
//     in-bse-fin, 99 elements): Advances[OneI]=228187308000, Deposits[OneI]=194224356000,
//     CashAndBalancesWithReserveBankOfIndia[OneI]=8111424000,
//     BalancesWithBanksAndMoneyAtCallAndShortNotice[OneI]=9290510000. Two different documents of the
//     same taxonomy; only one carries the balance sheet. Do not conclude "the source class lacks it"
//     from the NSE copy — that was the wrong call for an hour and this comment is why.
//
// ── THE GUARANTEE THIS FILE MAKES INSTEAD ─────────────────────────────────────────────────────────
//   IT MAY WRITE ONLY INTO A NULL. It may never change a value that is already there, on any source,
//   in any table, in any column.
//
//   (1) STRUCTURAL — the UPDATE carries `AND <col> IS NULL` for every column it sets, and the row is
//       taken FOR UPDATE first so nothing can slip in between the read and the write.
//   (2) DECLARED   — column names come from FILLABLE below, never from a caller or a document.
//   (3) PROVEN     — one raw_field_edits row per landed cell, and EVERY ONE of them must carry
//       old_value = NULL. A non-null old_value is a breach of (1) that (3) makes visible afterwards.
//
// ── ★ AND IT BREAKS THE OLD FENCE INVARIANT, DELIBERATELY ─────────────────────────────────────────
// The T3 fence asserts "no NSE row's updated_at may move". This path moves it — that is its job. The
// invariant therefore has to become the one the workbook import already used:
//     no UNTARGETED NSE row may move · and no targeted row may have a NON-NULL cell change.
// Callers must pass the targeted row ids to the fence. A fence that still asserts the old form will
// fail on a correct run, which is worse than no fence at all.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { FencedTable } from "./bse-fence.js";

/** The minimum surface this needs, so it runs inside a $transaction client. */
export interface TxClient {
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
}

/**
 * ⚠ THE DECLARED SET — cell key → physical column, and it is DELIBERATELY the same list the INSERT
 *   writer builds its INSERT from (bse-writer.ts). One rule, stated once:
 *
 *     IF BSE MAY CREATE A COLUMN'S VALUE IN A NEW ROW, IT MAY FILL THAT COLUMN'S NULL IN AN
 *     EXISTING ROW — AND NOTHING ELSE.
 *
 *   Deriving the fill set from the insert set is what stops the two writers drifting apart. A column
 *   the insert stopped writing but the filler still knew about would be a channel for BSE data to
 *   reach a place the insert path had already been ruled out of.
 *
 *   Derived/computed columns are absent from BOTH — they belong to src/fill/re-derive.ts, and filling
 *   one by hand makes it disagree with its own inputs. `audit_pending` is absent too: it is state, not
 *   data. verify-bse-writer-parity.ts asserts this list against the real INSERT statements.
 */
export const BSE_COLUMNS: Record<FencedTable, ReadonlyArray<readonly [string, string]>> = {
  quarterly_results: [
    ["revenue", "revenue"], ["otherIncome", "other_income"], ["expenses", "expenses"],
    ["depreciation", "depreciation"], ["interest", "interest"],
    // Kept in step with the INSERT above it — the parity gate asserts these two lists match, which
    // is exactly what caught operating_profit being addable to one and not the other.
    ["operatingProfit", "operating_profit"],
    ["profitBeforeTax", "profit_before_tax"], ["tax", "tax"], ["netProfit", "net_profit"],
  ],
  banking_quarterly_results: [
    ["interestEarned", "interest_earned"], ["interestExpended", "interest_expended"],
    ["otherIncome", "other_income"], ["operatingExpenses", "operating_expenses"], ["ppop", "ppop"],
    ["profitBeforeTax", "profit_before_tax"], ["tax", "tax"], ["netProfit", "net_profit"],
    ["gnpaAbsolute", "gnpa_absolute"], ["nnpaAbsolute", "nnpa_absolute"],
    ["gnpaPct", "gnpa_pct"], ["nnpaPct", "nnpa_pct"], ["cet1Ratio", "cet1_ratio"],
    ["additionalTier1Ratio", "additional_tier1_ratio"], ["roaQuarterly", "roa_quarterly"],
  ],
  fundamentals: [
    ["revenue", "revenue"], ["otherIncome", "other_income"], ["expenses", "expenses"],
    ["employeeBenefitExpense", "employee_benefit_expense"], ["financeCosts", "finance_costs"],
    ["depreciation", "depreciation"], ["profitBeforeTax", "profit_before_tax"], ["tax", "tax"],
    ["netProfit", "net_profit"], ["faceValueShare", "face_value_share"],
    ["totalAssets", "total_assets"], ["propertyPlantAndEquipment", "property_plant_and_equipment"],
    ["capitalWorkInProgress", "capital_work_in_progress"],
    ["tradeReceivablesCurrent", "trade_receivables_current"],
    ["tradeReceivablesNoncurrent", "trade_receivables_noncurrent"],
    ["borrowingsCurrent", "borrowings_current"], ["borrowingsNoncurrent", "borrowings_noncurrent"],
    ["currentLiabilities", "current_liabilities"], ["equityShareCapital", "equity_share_capital"],
    ["otherEquity", "other_equity"], ["totalEquity", "total_equity"],
    ["cashFromOperating", "cash_from_operating"], ["cashFromFinancing", "cash_from_financing"],
    ["capex", "capex"],
    // Balance sheet + cash flow, 2026-08-28. Must stay in step with the INSERT in bse-writer.ts;
    // verify-bse-writer-parity.ts asserts the two lists are identical on every build.
    ["equityAttributableToOwners", "equity_attributable_to_owners"], ["tradePayablesCurrent", "trade_payables_current"],
    ["tradePayablesNoncurrent", "trade_payables_noncurrent"], ["otherCurrentLiabilities", "other_current_liabilities"],
    ["otherNoncurrentLiabilities", "other_noncurrent_liabilities"], ["otherCurrentFinancialLiabilities", "other_current_financial_liabilities"],
    ["otherNoncurrentFinancialLiabilities", "other_noncurrent_financial_liabilities"], ["provisionsCurrent", "provisions_current"],
    ["provisionsNoncurrent", "provisions_noncurrent"], ["currentTaxLiabilities", "current_tax_liabilities"],
    ["deferredTaxLiabilitiesNet", "deferred_tax_liabilities_net"], ["noncurrentLiabilities", "noncurrent_liabilities"],
    ["goodwill", "goodwill"], ["otherIntangibleAssets", "other_intangible_assets"],
    ["intangibleAssetsUnderDevelopment", "intangible_assets_under_development"], ["noncurrentInvestments", "noncurrent_investments"],
    ["loansNoncurrent", "loans_noncurrent"], ["otherNoncurrentFinancialAssets", "other_noncurrent_financial_assets"],
    ["otherNoncurrentAssets", "other_noncurrent_assets"], ["deferredTaxAssetsNet", "deferred_tax_assets_net"],
    ["investmentProperty", "investment_property"], ["investmentsEquityMethod", "investments_equity_method"],
    ["noncurrentAssets", "noncurrent_assets"], ["inventories", "inventories"],
    ["currentInvestments", "current_investments"], ["cashAndCashEquivalents", "cash_and_cash_equivalents"],
    ["bankBalanceOther", "bank_balance_other"], ["loansCurrent", "loans_current"],
    ["otherCurrentFinancialAssets", "other_current_financial_assets"], ["otherCurrentAssets", "other_current_assets"],
    ["currentTaxAssets", "current_tax_assets"], ["noncurrentAssetsHeldForSale", "noncurrent_assets_held_for_sale"],
    ["currentAssets", "current_assets"], ["cashFromInvesting", "cash_from_investing"],
    ["netCashFlow", "net_cash_flow"], ["proceedsFromBorrowings", "proceeds_from_borrowings"],
    ["repaymentsOfBorrowings", "repayments_of_borrowings"], ["dividendsPaid", "dividends_paid"],
    ["basicEps", "basic_eps"], ["dilutedEps", "diluted_eps"],
    ["paidUpEquityCapital", "paid_up_equity_capital"], ["interestPaid", "interest_paid"],
  ],
  banking_fundamentals: [
    ["interestEarned", "interest_earned"], ["interestExpended", "interest_expended"],
    ["otherIncome", "other_income"], ["operatingExpenses", "operating_expenses"], ["ppop", "ppop"],
    ["profitBeforeTax", "profit_before_tax"], ["tax", "tax"], ["netProfit", "net_profit"],
    ["advances", "advances"], ["deposits", "deposits"], ["investments", "investments"],
    ["cashAndBalancesWithRbi", "cash_and_balances_with_rbi"],
    ["balancesWithBanks", "balances_with_banks"], ["totalAssets", "total_assets"],
    ["gnpaAbsolute", "gnpa_absolute"], ["nnpaAbsolute", "nnpa_absolute"],
    ["gnpaPct", "gnpa_pct"], ["nnpaPct", "nnpa_pct"], ["cet1Ratio", "cet1_ratio"],
    ["additionalTier1Ratio", "additional_tier1_ratio"], ["tier1Ratio", "tier1_ratio"],
    ["roaDisclosed", "roa_disclosed"],
  ],
  // ── NBFC ──
  // BSE serves NBFC results under the SAME in-bse-fin namespace and the same
  // OneD/FourD/OneI contexts as a non-financial filing — CANFINHOME FY2019 is a
  // Main_Ind_As document, later ones sit in NBFCUploadDocument, and both carry the
  // identical tag vocabulary. So these are the Ind-AS cells routed to the NBFC
  // tables, not a new parser.
  //
  // ⚠ The genuinely NBFC-shaped columns (interest_income, fee_and_commission_income,
  //   impairment_on_financial_instruments, loans, debt_securities, subordinated_
  //   liabilities) are ABSENT from these documents and are deliberately NOT listed:
  //   a column this path cannot serve must not be fillable by it, or a null would
  //   read as "BSE checked and found nothing" rather than "BSE never carried it".
  nbfc_quarterly_results: [
    ["revenue", "revenue"], ["otherIncome", "other_income"], ["totalIncome", "total_income"],
    ["financeCosts", "finance_costs"], ["employeeBenefitExpense", "employee_benefit_expense"],
    ["depreciation", "depreciation"], ["totalExpenses", "total_expenses"],
    ["profitBeforeTax", "profit_before_tax"], ["tax", "tax"], ["netProfit", "net_profit"],
  ],
  nbfc_fundamentals: [
    ["revenue", "revenue"], ["otherIncome", "other_income"], ["totalIncome", "total_income"],
    ["financeCosts", "finance_costs"], ["employeeBenefitExpense", "employee_benefit_expense"],
    ["depreciation", "depreciation"], ["totalExpenses", "total_expenses"],
    ["profitBeforeTax", "profit_before_tax"], ["tax", "tax"], ["netProfit", "net_profit"],
    ["equityShareCapital", "equity_share_capital"], ["otherEquity", "other_equity"],
    ["totalEquity", "total_equity"], ["cashAndCashEquivalents", "cash_and_cash_equivalents"],
    ["bankBalanceOther", "bank_balance_other"], ["investments", "investments"],
    ["propertyPlantAndEquipment", "property_plant_and_equipment"],
    ["capitalWorkInProgress", "capital_work_in_progress"], ["goodwill", "goodwill"],
    ["intangibleAssetsUnderDevelopment", "intangible_assets_under_development"],
    ["totalAssets", "total_assets"], ["borrowings", "borrowings"],
    ["totalLiabilities", "total_liabilities"],
    ["currentTaxAssetsNet", "current_tax_assets_net"],
    ["deferredTaxAssetsNet", "deferred_tax_assets_net"],
    ["currentTaxLiabilitiesNet", "current_tax_liabilities_net"],
    ["deferredTaxLiabilitiesNet", "deferred_tax_liabilities_net"],
  ],
  // ── INSURANCE (Stage 7a) ──
  // These filings use the `in-capmkt` prefix (bseindia.com/…/GeneralInsurance or
  // sebi.gov.in/…/IntegratedFinance_LI) with the SAME OneD/FourD/OneI contexts.
  // factNs() in parser-legacy-common.ts detects the prefix, so the extractors
  // differ only in their TAG VOCABULARY, which is genuinely insurance-specific.
  //
  // ⚠️ RATIO COLUMNS ARE DELIBERATELY EXCLUDED — combined_ratio, incurred_claim_ratio,
  //   expenses_of_management_ratio, solvency_ratio, persistency_*. Two reasons:
  //   the values these documents carry are mis-scaled at source (ICICIGI FY19 files
  //   CombinedRatio = 0.0098 for a ratio that should be ~0.98, and its
  //   IncurredClaimRatio / ExpensesOfManagement / NetRetention ratios are all
  //   similarly out by 100x), and this lane already has a dedicated ratio gate for
  //   exactly that class of problem. Writing them here would bypass it. Money
  //   columns are what the scorer reads; the ratios can be added deliberately once
  //   they go through the gate.
  life_insurance_quarterly_results: [
    ["grossPremiumIncome", "gross_premium_income"], ["netPremiumIncome", "net_premium_income"],
    ["incomeFirstYearPremium", "income_first_year_premium"],
    ["incomeRenewalPremium", "income_renewal_premium"],
    ["incomeSinglePremium", "income_single_premium"],
    ["reinsuranceCeded", "reinsurance_ceded"],
    ["incomeFromInvestments", "income_from_investments"],
    ["totalRevenuePolicyholders", "total_revenue_policyholders"],
    ["totalCommission", "total_commission"], ["totalOperatingExpenses", "total_operating_expenses"],
    ["benefitsPaidNet", "benefits_paid_net"],
    ["changeInValuationOfLiabilities", "change_in_valuation_of_liabilities"],
    ["profitBeforeTax", "profit_before_tax"], ["tax", "tax"], ["netProfit", "net_profit"],
  ],
  life_insurance_fundamentals: [
    ["grossPremiumIncome", "gross_premium_income"], ["netPremiumIncome", "net_premium_income"],
    ["incomeFirstYearPremium", "income_first_year_premium"],
    ["incomeRenewalPremium", "income_renewal_premium"],
    ["incomeSinglePremium", "income_single_premium"],
    ["reinsuranceCeded", "reinsurance_ceded"],
    ["incomeFromInvestments", "income_from_investments"],
    ["otherIncomePolicyholders", "other_income_policyholders"],
    ["totalRevenuePolicyholders", "total_revenue_policyholders"],
    ["commissionFirstYearPremium", "commission_first_year_premium"],
    ["commissionRenewalPremium", "commission_renewal_premium"],
    ["commissionSinglePremium", "commission_single_premium"],
    ["totalCommission", "total_commission"],
    ["employeesRemuneration", "employees_remuneration"],
    ["administrationExpenses", "administration_expenses"],
    ["advertisementAndPublicity", "advertisement_and_publicity"],
    ["totalOperatingExpenses", "total_operating_expenses"],
    ["benefitsPaidNet", "benefits_paid_net"],
    ["changeInValuationOfLiabilities", "change_in_valuation_of_liabilities"],
    ["profitBeforeTax", "profit_before_tax"], ["tax", "tax"], ["netProfit", "net_profit"],
  ],
  general_insurance_quarterly_results: [
    ["grossPremiumsWritten", "gross_premiums_written"], ["netPremiumWritten", "net_premium_written"],
    ["netPremium", "net_premium"], ["premiumEarned", "premium_earned"],
    ["incomeFromInvestments", "income_from_investments"], ["otherIncome", "other_income"],
    ["totalRevenue", "total_revenue"], ["claimsPaid", "claims_paid"],
    ["incurredClaims", "incurred_claims"], ["netCommission", "net_commission"],
    ["totalOperatingExpensesRelatedToInsurance", "total_operating_expenses_related_to_insurance"],
    ["underwritingProfitOrLoss", "underwriting_profit_or_loss"],
    ["profitBeforeTax", "profit_before_tax"], ["tax", "tax"], ["netProfit", "net_profit"],
  ],
  general_insurance_fundamentals: [
    ["grossPremiumsWritten", "gross_premiums_written"], ["netPremiumWritten", "net_premium_written"],
    ["netPremium", "net_premium"], ["premiumEarned", "premium_earned"],
    ["reinsuranceCeded", "reinsurance_ceded"],
    ["changeInUnexpiredRiskReserve", "change_in_unexpired_risk_reserve"],
    ["incomeFromInvestments", "income_from_investments"], ["otherIncome", "other_income"],
    ["totalRevenue", "total_revenue"], ["claimsPaid", "claims_paid"],
    ["changeInOutstandingClaims", "change_in_outstanding_claims"],
    ["incurredClaims", "incurred_claims"], ["netCommission", "net_commission"],
    ["employeesRemuneration", "employees_remuneration"],
    ["advertisementAndPublicity", "advertisement_and_publicity"],
    ["totalOperatingExpensesRelatedToInsurance", "total_operating_expenses_related_to_insurance"],
    ["premiumDeficiency", "premium_deficiency"],
    ["underwritingProfitOrLoss", "underwriting_profit_or_loss"],
    ["profitBeforeTax", "profit_before_tax"], ["tax", "tax"], ["netProfit", "net_profit"],
  ],
};

/** The physical columns this path may write, per table. Derived — never edited independently. */
export const FILLABLE: Record<FencedTable, readonly string[]> = Object.fromEntries(
  Object.entries(BSE_COLUMNS).map(([t, pairs]) => [t, pairs.map(([, col]) => col)]),
) as unknown as Record<FencedTable, readonly string[]>;

/**
 * Translate an extractor's camelCase cell object into the physical columns for one table.
 * A cell the mapping does not name is DROPPED here rather than passed on to be refused later —
 * the mapping is the boundary, so nothing unnamed reaches the writer at all.
 */
export function cellsToColumns(
  table: FencedTable,
  cells: Record<string, number | null | undefined>,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [key, col] of BSE_COLUMNS[table]) {
    const v = cells[key];
    out[col] = v === undefined || v === null || !Number.isFinite(v) ? null : (v as number);
  }
  return out;
}

/** Prisma model name per physical table — raw_field_edits.target_table follows the workbook import. */
const MODEL_NAME: Record<FencedTable, string> = {
  banking_fundamentals: "BankingFundamental",
  banking_quarterly_results: "BankingQuarterlyResult",
  fundamentals: "Fundamental",
  quarterly_results: "QuarterlyResult",
  nbfc_fundamentals: "NbfcFundamental",
  nbfc_quarterly_results: "NbfcQuarterlyResult",
  life_insurance_fundamentals: "LifeInsuranceFundamental",
  life_insurance_quarterly_results: "LifeInsuranceQuarterlyResult",
  general_insurance_fundamentals: "GeneralInsuranceFundamental",
  general_insurance_quarterly_results: "GeneralInsuranceQuarterlyResult",
};

const IDENT = /^[a-z_][a-z0-9_]*$/;

export interface ColumnFillResult {
  table: string;
  rowId: string;
  /** columns the caller offered a non-null value for */ offered: string[];
  /** columns that were null and took the value */ landed: string[];
  /** columns already carrying a value — left exactly as they were */ heldNotNull: string[];
  /** columns the caller offered null for (extractor found nothing / gate refused) */ noValue: string[];
  /** columns named but not in FILLABLE — refused outright */ notFillable: string[];
}

export class ColumnFillRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColumnFillRefused";
  }
}

/**
 * Fill ONLY the null columns of one existing row. Runs inside the caller's transaction.
 *
 * @param citation CN-4: mandatory source attribution. The BSE document URL. Refused if empty.
 */
export async function fillNullColumns(
  tx: TxClient,
  table: FencedTable,
  rowId: string,
  cells: Record<string, number | null | undefined>,
  citation: string,
  editedBy: string,
  note?: string,
): Promise<ColumnFillResult> {
  if (!citation || citation.trim().length < 8) {
    throw new ColumnFillRefused(`CN-4: a citation is mandatory on every filled cell (got ${JSON.stringify(citation)})`);
  }
  const allowed = new Set(FILLABLE[table]);

  const notFillable: string[] = [];
  const noValue: string[] = [];
  const offered: string[] = [];
  for (const [col, val] of Object.entries(cells)) {
    if (!IDENT.test(col)) throw new ColumnFillRefused(`unsafe column identifier: ${JSON.stringify(col)}`);
    if (!allowed.has(col)) { notFillable.push(col); continue; }
    if (val === null || val === undefined || !Number.isFinite(val)) { noValue.push(col); continue; }
    offered.push(col);
  }
  const base: ColumnFillResult = { table, rowId, offered, landed: [], heldNotNull: [], noValue, notFillable };
  if (offered.length === 0) return base;

  // ── (1) structural, part one: lock the row and read the current state ──────
  const sel = offered.map((c) => `"${c}"`).join(", ");
  const cur = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT ${sel} FROM "${table}" WHERE "id" = $1 FOR UPDATE`,
    rowId,
  );
  if (cur.length !== 1) throw new ColumnFillRefused(`row ${table}/${rowId} does not exist — this path never creates rows`);

  const toFill = offered.filter((c) => cur[0][c] === null || cur[0][c] === undefined);
  base.heldNotNull = offered.filter((c) => !toFill.includes(c));
  if (toFill.length === 0) return base;

  // ── (1) structural, part two: every column guarded IS NULL in the statement itself ──
  const setSql = toFill.map((c, i) => `"${c}" = $${i + 1}`).join(", ");
  const nullGuard = toFill.map((c) => `"${c}" IS NULL`).join(" AND ");
  const params: unknown[] = toFill.map((c) => cells[c] as number);
  params.push(rowId);
  const n = await tx.$executeRawUnsafe(
    `UPDATE "${table}" SET ${setSql}, "updated_at" = now() WHERE "id" = $${params.length} AND ${nullGuard}`,
    ...params,
  );
  if (n !== 1) {
    throw new ColumnFillRefused(
      `null-only UPDATE on ${table}/${rowId} matched ${n} rows, expected 1 — a guarded column stopped being null between the FOR UPDATE read and the write`,
    );
  }
  base.landed = toFill;

  // ── (3) proof: one audit row per landed cell, old_value NULL on every one ──
  for (const c of toFill) {
    await tx.$executeRawUnsafe(
      `INSERT INTO raw_field_edits (id, target_table, target_row_id, field, old_value, new_value, citation, edited_by, note, created_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, NULL, $4, $5, $6, $7, now())`,
      MODEL_NAME[table], rowId, c, String(cells[c]), citation, editedBy, note ?? null,
    );
  }
  return base;
}

/**
 * Layer (3) for this path, independent of the writer: EVERY audit row this run wrote must
 * carry old_value = NULL. One that does not is a cell that was overwritten — the exact breach
 * the IS NULL guard exists to prevent, made visible from the database rather than from the code.
 */
export async function verifyNoOverwrites(
  db: TxClient,
  editedBy: string,
  since: Date,
): Promise<{ ok: boolean; total: number; withOldValue: number; offenders: Array<{ table: string; rowId: string; field: string; old: string }> }> {
  const rows = await db.$queryRawUnsafe<Array<{ target_table: string; target_row_id: string; field: string; old_value: string | null }>>(
    `SELECT target_table, target_row_id, field, old_value FROM raw_field_edits
      WHERE edited_by = $1 AND created_at >= $2`,
    editedBy, since,
  );
  const offenders = rows
    .filter((r) => r.old_value !== null)
    .map((r) => ({ table: r.target_table, rowId: r.target_row_id, field: r.field, old: r.old_value as string }));
  return { ok: offenders.length === 0, total: rows.length, withOldValue: offenders.length, offenders };
}
