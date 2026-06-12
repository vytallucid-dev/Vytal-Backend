// ─────────────────────────────────────────────────────────────
// Date parsing and quarter derivation for shareholding data.
// Shared between fetcher and ingestion service.
// ─────────────────────────────────────────────────────────────

// ── NSE date string → Date ────────────────────────────────────
// NSE uses "31-DEC-2025" format in the index API
// and "2025-12-31" in some XBRL files

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
}

export function parseAsOnDate(s: string): Date | null {
  if (!s || s.trim() === '') return null

  // Try "31-DEC-2025" format
  const dmy = s.trim().match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/i)
  if (dmy) {
    const m = MONTHS[dmy[2].toUpperCase()]
    if (m === undefined) return null
    return new Date(Date.UTC(parseInt(dmy[3]), m, parseInt(dmy[1])))
  }

  // Try ISO "2025-12-31" format
  const iso = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    return new Date(Date.UTC(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3])))
  }

  return null
}

/** Convert a Date to "Q1 FY26" labels */
export function dateToQuarterFY(d: Date): { quarter: string; fiscalYear: string } {
  const month = d.getUTCMonth() + 1 // 1-indexed
  const year = d.getUTCFullYear()

  // Indian FY: Apr 1 – Mar 31
  // Q1 = Apr-Jun (ends Jun 30)
  // Q2 = Jul-Sep (ends Sep 30)
  // Q3 = Oct-Dec (ends Dec 31)
  // Q4 = Jan-Mar (ends Mar 31)

  let quarter: string
  let fyYear: number

  if (month >= 4 && month <= 6) {
    quarter = 'Q1'
    fyYear = year + 1
  } else if (month >= 7 && month <= 9) {
    quarter = 'Q2'
    fyYear = year + 1
  } else if (month >= 10 && month <= 12) {
    quarter = 'Q3'
    fyYear = year + 1
  } else {
    // Jan - Mar
    quarter = 'Q4'
    fyYear = year
  }

  return { quarter, fiscalYear: `FY${String(fyYear).slice(-2)}` }
}

/** How many quarters back to fetch by default */
export const DEFAULT_QUARTERS_BACK = 8

/**
 * Generate the list of "as on" dates for the last N quarters.
 * Used to know which XBRL files to prioritise.
 */
export function recentQuarterDates(count: number = DEFAULT_QUARTERS_BACK): Date[] {
  const today = new Date()
  const quarterEndMonths = [3, 6, 9, 12] // Mar, Jun, Sep, Dec

  const dates: Date[] = []
  let year = today.getUTCFullYear()
  let monthIdx = quarterEndMonths.findIndex((m) => m > today.getUTCMonth() + 1)
  if (monthIdx === -1) monthIdx = 0

  // Go backwards from the most recent completed quarter
  let cursor = monthIdx === 0 ? 0 : monthIdx - 1
  let cursorYear = monthIdx === 0 ? year - 1 : year

  for (let i = 0; i < count; i++) {
    const endMonth = quarterEndMonths[cursor]
    // Last day of end month
    const lastDay = new Date(Date.UTC(cursorYear, endMonth, 0)).getUTCDate()
    dates.push(new Date(Date.UTC(cursorYear, endMonth - 1, lastDay)))

    cursor--
    if (cursor < 0) {
      cursor = 3
      cursorYear--
    }
  }

  return dates
}