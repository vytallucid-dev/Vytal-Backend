// ─────────────────────────────────────────────────────────────
// FISCAL PERIOD DERIVATION
//
// Derives (quarter, fiscalYear) from the XBRL filing's declared
// fiscal-year start/end. Works for non-April-March fiscal years —
// a handful of companies in the Nifty 200 use Jan-Dec or Jul-Jun.
//
// We never assume calendar year. The filing tells us its own
// fiscal year boundaries; we compute the quarter from them.
// ─────────────────────────────────────────────────────────────

export interface FiscalPeriod {
  /** "Q1" | "Q2" | "Q3" | "Q4" */
  quarter: string
  /** "FY25" — 2-digit year of the fiscal year END */
  fiscalYear: string
}

/**
 * Compute quarter and fiscal year label from period dates.
 *
 * Examples (Apr-Mar FY):
 *   periodEnd = 2024-12-31, fyStart = 2024-04-01, fyEnd = 2025-03-31
 *   → { quarter: "Q3", fiscalYear: "FY25" }
 *
 *   periodEnd = 2024-06-30, fyStart = 2024-04-01, fyEnd = 2025-03-31
 *   → { quarter: "Q1", fiscalYear: "FY25" }
 *
 * Examples (Jan-Dec FY, rare):
 *   periodEnd = 2024-06-30, fyStart = 2024-01-01, fyEnd = 2024-12-31
 *   → { quarter: "Q2", fiscalYear: "FY24" }
 */
export function deriveFiscalPeriod(
  periodEnd: Date,
  fyStart: Date,
  fyEnd: Date,
): FiscalPeriod {
  // Months elapsed from fiscal year start to period end
  const monthsFromStart =
    (periodEnd.getUTCFullYear() - fyStart.getUTCFullYear()) * 12 +
    (periodEnd.getUTCMonth() - fyStart.getUTCMonth())

  if (monthsFromStart < 0 || monthsFromStart > 11) {
    throw new Error(
      `Invalid period: periodEnd ${periodEnd.toISOString()} falls outside fiscal year ` +
      `${fyStart.toISOString()}..${fyEnd.toISOString()}`,
    )
  }

  const quarter = `Q${Math.floor(monthsFromStart / 3) + 1}`
  const fiscalYear = `FY${String(fyEnd.getUTCFullYear()).slice(-2)}`

  return { quarter, fiscalYear }
}

/**
 * Parses a date string in "YYYY-MM-DD" format into a UTC Date.
 * XBRL dates are always unambiguous ISO format; avoid timezone drift.
 */
export function parseXbrlDate(s: string): Date {
  const [y, m, d] = s.trim().split('-').map(Number)
  if (!y || !m || !d) {
    throw new Error(`Invalid XBRL date: ${s}`)
  }
  return new Date(Date.UTC(y, m - 1, d))
}
