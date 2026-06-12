// File: src/ingestions/quaterly-results/xbrl/contexts.ts (NEW)

/**
 * The new SEBI taxonomy preserves the same context model as the legacy BSE one:
 *   OneD  = current period (single quarter for quarterlies; single Q4 for annuals)
 *   FourD = year-to-date (= full year in annual filings, = YTD in quarterlies)
 *   OneI  = end-of-period instant (balance sheet, current period)
 *   PY_I  = end-of-period instant for prior year (year-end BS comparison)
 *
 * For QUARTERLY filings:
 *   - P&L items go in OneD (just this quarter)
 *   - Balance sheet items (when present) go in OneI
 *   - YTD figures live in FourD (used only for sanity checks)
 *
 * For ANNUAL filings:
 *   - Annual P&L goes in FourD (full year)
 *   - Q4-only P&L goes in OneD (rarely needed; we have it as Q4 quarterly anyway)
 *   - Year-end BS goes in OneI; prior year-end BS in PY_I
 */
export const QUARTERLY_PNL_CONTEXT = "OneD";
export const ANNUAL_PNL_CONTEXT = "FourD";
export const BALANCE_SHEET_CONTEXT = "OneI";
export const PRIOR_YEAR_BS_CONTEXT = "PY_I";
