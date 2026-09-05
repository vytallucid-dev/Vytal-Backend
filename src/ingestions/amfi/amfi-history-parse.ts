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
//   HISTORY endpoint (this file), as shipped since 2026-07-28:
//     Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date
//
//   …and as it shipped BEFORE that date:
//     Scheme Code;Scheme Name;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Repurchase Price;Sale Price;Date
//
//     BOTH ARE 8 COLUMNS WIDE AND NEITHER AGREES WITH THE OTHER ANYWHERE THAT MATTERS: the name
//     column is renamed, Plan/Option are inserted, Repurchase/Sale are dropped, and NAV moves
//     from index 4 to index 6. That is why positions are RESOLVED FROM THE HEADER (below) and
//     never written down here — a hard-coded index is an untested claim about a file we do not
//     control, and the column COUNT staying 8 is exactly what let this one go unnoticed.
//
// The file interleaves the same bare section/AMC header lines as NAVAll.txt, so the same
// "is it a data row?" discriminator applies: has ';' AND field-0 is all digits.
// ─────────────────────────────────────────────────────────────

/** Provenance tags for the IngestionError rows this source writes. */
export const AMFI_HISTORY_SOURCE = "amfi_navhistory";
export const AMFI_HISTORY_CRON = "mf_analytics_daily";

/**
 * THE COLUMNS THIS FOLD READS — asserted BY NAME, resolved BY NAME, never by position.
 *
 * ⚠ THIS REPLACES A FROZEN INDEX TABLE AND A FROZEN HEADER STRING, AND THEY COST US A MONTH
 *   OF FUND ANALYTICS. MEASURED: on 2026-07-28 AMFI reshaped the history feed —
 *       Scheme Code;NAV Name;Plan;Option;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Net Asset Value;Date
 *   — against the layout below it. "Scheme Name" became "NAV Name"; Plan and Option were
 *   inserted at 2–3; Repurchase Price and Sale Price were dropped; and NET ASSET VALUE MOVED
 *   FROM COLUMN 4 TO COLUMN 6. The column count stayed 8, so the row-shape test still passed
 *   and only the header string caught it. Every nightly run from 2026-07-28 to 2026-08-28
 *   aborted — 32 days, occurrences=24 on one fault row, and not one fund's analytics refreshed.
 *
 * ★ THE INDEX TABLE WAS THE REAL HAZARD. A fixed `nav: 4` is a claim about a file we do not
 *   control, restated silently on every run. Resolving from the header the response actually
 *   shipped makes the claim TESTABLE once per window, and turns a reshuffle into a no-op
 *   instead of a NAV column read out of an ISIN column.
 *
 * ASSERT ONLY WHAT WE READ. The fold consumes exactly three fields; asserting the other five
 * would fail this run on the Repurchase/Sale columns AMFI has already stopped shipping and
 * which nothing here has ever looked at. That is the prices-guards.ts ruling
 * (REQUIRED_BHAV_COLUMNS) applied to a second feed.
 */
export const REQUIRED_HISTORY_COLUMNS = ["Scheme Code", "Net Asset Value", "Date"] as const;

/**
 * The scheme-name column, which AMFI renamed "Scheme Name" → "NAV Name" in the same reshape.
 * OPTIONAL and accepted under either spelling: nothing in the fold reads it, and refusing a
 * window over a column we never touch would be the exact over-assertion described above.
 */
const HISTORY_NAME_ALIASES = ["Scheme Name", "NAV Name"] as const;

/** Whitespace-collapsed, case-insensitive — AMFI's two feeds disagree on the spacing inside
 *  "ISIN Div Payout/ ISIN Growth", so the space itself must never be load-bearing. */
function norm(c: string): string {
  return c.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Resolved column positions for ONE response. `-1` means the column is not in this file. */
export interface HistColumnMap {
  schemeCode: number;
  nav: number;
  date: number;
  schemeName: number;
  /** Required columns the header does NOT carry — non-empty ⇒ the shape guard must reject. */
  missing: string[];
  /** Highest index the fold will index into — the row-shape test's floor. */
  maxIndex: number;
}

/** Resolve column positions from the header line the response actually shipped. */
export function resolveHistoryColumns(headerLine: string | null): HistColumnMap {
  const cells = (headerLine ?? "").split(";").map(norm);
  const at = (name: string) => cells.indexOf(norm(name));
  const schemeCode = at("Scheme Code");
  const nav = at("Net Asset Value");
  const date = at("Date");
  const schemeName = HISTORY_NAME_ALIASES.map(at).find((i) => i >= 0) ?? -1;
  const missing: string[] = [];
  for (const [name, i] of [
    ["Scheme Code", schemeCode],
    ["Net Asset Value", nav],
    ["Date", date],
  ] as const) {
    if (i < 0) missing.push(name);
  }
  return { schemeCode, nav, date, schemeName, missing, maxIndex: Math.max(schemeCode, nav, date) };
}

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

/**
 * True when the line is a scheme data row (vs a bare section/AMC header).
 *
 * The width floor is the RESOLVED layout's own highest index, not the literal 8 this shipped
 * with. A hard 8 was a second frozen claim about the file: it passed unchanged through the
 * 2026-07-28 reshape (which kept 8 columns while moving NAV from 4 to 6) and so proved nothing.
 */
export function isHistDataRow(parts: string[], cols: HistColumnMap): boolean {
  return parts.length > cols.maxIndex && /^\d+$/.test((parts[0] ?? "").trim());
}
