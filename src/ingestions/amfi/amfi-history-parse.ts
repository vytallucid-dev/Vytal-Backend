// ─────────────────────────────────────────────────────────────
// AMFI NAV-HISTORY parser (pure; no I/O, no DB).
//
// ⚠️  THIS IS **NOT** THE NAVAll.txt PARSER. The history endpoint ships a DIFFERENT,
//     INCOMPATIBLE column layout, and reusing the Step-9 column indices here would write a
//     SCHEME NAME into a NAV column. Recon caught this; the two headers are:
//
//   NAVAll.txt (Step 9, 6 cols):
//     Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
//                  ^idx1                        ^idx2                 ^idx3       ^idx4          ^idx5
//
//   HISTORY endpoint (this file, 8 cols):
//     Scheme Code;Scheme Name;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Repurchase Price;Sale Price;Date
//                  ^idx1       ^idx2                       ^idx3                 ^idx4           ^idx5            ^idx6      ^idx7
//
//     Scheme Name moves 3 → 1. NAV stays at 4 BY COINCIDENCE. Date moves 5 → 7. Two extra
//     price columns appear. The header below is the shape guard's anchor: if AMFI renames a
//     column, the run is REJECTED rather than folded into garbage analytics.
//
// The file interleaves the same bare section/AMC header lines as NAVAll.txt, so the same
// "is it a data row?" discriminator applies: has ';' AND field-0 is all digits.
// ─────────────────────────────────────────────────────────────

/** Provenance tags for the IngestionError rows this source writes. */
export const AMFI_HISTORY_SOURCE = "amfi_navhistory";
export const AMFI_HISTORY_CRON = "mf_analytics_daily";

/** The EXACT history column header. A rename means our indices are wrong → shape guard. */
export const AMFI_HISTORY_HEADER =
  "Scheme Code;Scheme Name;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Repurchase Price;Sale Price;Date";

/** Column indices — named, so nobody has to count semicolons at a call site. */
export const HCOL = {
  schemeCode: 0,
  schemeName: 1,
  isinGrowth: 2,
  isinReinvest: 3,
  nav: 4,
  repurchase: 5,
  sale: 6,
  date: 7,
} as const;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * "10-Jul-2026" → a DAY NUMBER (days since epoch), not a Date object.
 *
 * WHY an integer and not a Date: the fold touches ~10.7 M rows on a 5-year run. A Date
 * object per row would allocate 10.7 M objects and defeat the whole streaming design. An
 * int32 day-number compares, subtracts and sorts identically, and costs nothing.
 *
 * Returns NaN if the shape is wrong (the caller treats that as a fault, not a zero).
 */
export function parseHistDate(raw: string): number {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (!m) return NaN;
  const mon = MONTHS[m[2]!.toLowerCase()];
  if (mon === undefined) return NaN;
  return Date.UTC(Number(m[3]), mon, Number(m[1])) / 86_400_000;
}

/** Day-number → "YYYY-MM-DD" (for logs / error evidence). */
export function dayToIso(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** Day-number → a UTC-midnight Date (for @db.Date columns). */
export function dayToDate(day: number): Date {
  return new Date(day * 86_400_000);
}

export type HistNav =
  | { kind: "value"; nav: number }
  | { kind: "absent" }              // blank / "-" / "N.A." → NOT a data point. Never 0.
  | { kind: "malformed"; raw: string }; // present but not a number → a real fault

/**
 * The SAME three-way NAV ruling as Step 9, kept deliberately identical:
 *   ""/"-"/"N.A." → absent    (a fund that did not price that day did not price it.
 *                              Folding a 0 here would invent a -100% day and destroy the
 *                              fund's volatility. 2016's window carried 4,431 of these.)
 *   "0.0000"      → value 0   (AMFI genuinely publishes 0 for written-off segregated
 *                              portfolios — that IS the NAV)
 *   "10."         → value 10  (trailing-dot formatting; unambiguous, not a fault)
 *   "abc"         → malformed (a fault)
 */
export function parseHistNav(raw: string): HistNav {
  const t = raw.trim();
  if (t === "" || t === "-" || /^n\.?a\.?$/i.test(t)) return { kind: "absent" };
  if (!/^\d+(\.\d*)?$/.test(t)) return { kind: "malformed", raw: t };
  return { kind: "value", nav: Number(t.endsWith(".") ? t.slice(0, -1) : t) };
}

/** True when the line is a scheme data row (vs a bare section/AMC header). */
export function isHistDataRow(parts: string[]): boolean {
  return parts.length >= 8 && /^\d+$/.test((parts[0] ?? "").trim());
}
