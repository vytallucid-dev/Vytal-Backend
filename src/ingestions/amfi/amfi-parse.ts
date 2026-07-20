// ─────────────────────────────────────────────────────────────
// AMFI NAVAll.txt — STATEFUL PARSER (pure; no I/O, no DB).
//
// The file is NOT a flat CSV. Scheme rows are INTERSPERSED with two kinds of
// bare header line, and a row's fund-house + category are carried by whichever
// headers most recently preceded it:
//
//     Scheme Code;ISIN Div Payout/ ISIN Growth;...   ← column header (ONCE, at top)
//                                                    ← blank
//     Open Ended Schemes(Debt Scheme - Banking...)   ← SCHEME-TYPE section header
//                                                    ← blank
//     Aditya Birla Sun Life Mutual Fund              ← AMC (fund-house) header
//                                                    ← blank
//     119551;INF209KA12Z1;INF209KA13Z9;…;106.6946;10-Jul-2026   ← data row
//
// So the parser is a state machine. The discriminator (verified against the live
// file: it resolves 14,216/14,216 rows with zero orphans):
//     has ';' AND field-0 is all digits  → DATA ROW
//     contains the word "Scheme"         → SCHEME-TYPE section header
//     otherwise                          → AMC name
//
// THE ETF/MF SIGNAL IS THE SECTION HEADER — NOT THE NAME. Recon proved the name is a
// trap: 50.5% precision. "Aditya Birla Sun Life Silver ETF FOF" is a Fund-of-Funds that
// INVESTS in ETFs (an MF), and 13 genuine NSE-listed ETFs have no "ETF" in their AMFI
// name at all. Only the section header classifies correctly.
// ─────────────────────────────────────────────────────────────

/** Provenance tags for the IngestionError rows this source writes. */
export const AMFI_SOURCE = "amfi_navall";
export const AMFI_CRON = "daily_amfi_nav";
/** Step 13: the ETF pass reads the SAME file under its own cron tag, so the two runs' error
 *  rows (and their `recurring` dedup) never bleed into one another. */
export const ETF_CRON = "daily_etf_nav";

/**
 * A real AMFI fund ISIN: INF + 9 alphanumerics (12 chars). Every one of the 17,904
 * genuine fund ISINs matches. It exists to REJECT what AMFI actually ships in the ISIN
 * column: the literal strings "Redeemed" (×9) and "HDFCNIVODG" (×1). Those are not
 * out-of-range ISINs — they are not ISINs, and a spine keyed on them would be poisoned.
 */
export const AMFI_ISIN = /^INF[A-Z0-9]{9}$/;

/** The exact column header. A rename means our column indices are wrong → shape guard. */
export const AMFI_HEADER =
  "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date";

/**
 * ETF section headers. Step 9 loads the COMPLEMENT of this (MF-only); Step 13 loads exactly this.
 * The two passes therefore partition the file: every row belongs to exactly one of them, and no
 * row belongs to both. Measured against the live file: 13,879 MF rows + 337 ETF rows = 14,216.
 *
 * The 4 sections it matches, verbatim:
 *   Open Ended Schemes(Other Scheme - Other  ETFs)                  298   ← note the double space
 *   Open Ended Schemes(Other Scheme - Gold ETF)                      25
 *   Open Ended Schemes(Exchange Traded Funds (ETFs) - Equity ETF)    13
 *   Open Ended Schemes(Exchange Traded Funds (ETFs) - Debt ETF)       1
 */
export const ETF_SECTION = /ETF|Exchange Traded/i;

/** A single AMFI scheme row, with its inherited section state. ISINs are RAW (may be junk). */
export interface AmfiRow {
  schemeCode: string;
  isinGrowth: string | null; // "ISIN Div Payout/ ISIN Growth" — raw, unvalidated
  isinReinvest: string | null; // "ISIN Div Reinvestment"      — raw, unvalidated
  schemeName: string;
  navRaw: string;
  dateRaw: string;
  fundHouse: string | null; // from the AMC header line
  category: string | null; // from the scheme-type section header
  isEtfSection: boolean; // classified by the SECTION, never by the name
  lineNo: number; // provenance for the error rows
}

export interface AmfiParseResult {
  rows: AmfiRow[];
  headerLine: string | null;
  /** Rows that appeared before any section/AMC header — a structure break, not a value fault. */
  orphanRows: number;
  amcCount: number;
  categoryCount: number;
}

/** "-" / "" / whitespace ⇒ absent. AMFI's own "this plan does not exist" marker. */
function cell(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" || t === "-" ? null : t;
}

export function parseNavAll(text: string): AmfiParseResult {
  const lines = text.split(/\r?\n/); // CRLF file — \r must not survive into an ISIN
  const rows: AmfiRow[] = [];
  let category: string | null = null;
  let fundHouse: string | null = null;
  let headerLine: string | null = null;
  let orphanRows = 0;
  const amcs = new Set<string>();
  const cats = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t) continue;

    if (t.startsWith("Scheme Code;")) {
      headerLine ??= t; // the column header — captured once, for the shape guard
      continue;
    }

    const parts = t.split(";");
    const isDataRow = parts.length >= 6 && /^\d+$/.test((parts[0] ?? "").trim());

    if (isDataRow) {
      if (!category || !fundHouse) orphanRows++;
      const c = parts.map((p) => p.trim());
      cats.add(category ?? "");
      amcs.add(fundHouse ?? "");
      rows.push({
        schemeCode: c[0]!,
        isinGrowth: cell(c[1]),
        isinReinvest: cell(c[2]),
        schemeName: c[3] ?? "",
        navRaw: c[4] ?? "",
        dateRaw: c[5] ?? "",
        fundHouse,
        category,
        isEtfSection: ETF_SECTION.test(category ?? ""),
        lineNo: i + 1,
      });
      continue;
    }

    // A bare line: the scheme-type section header names a "Scheme"; anything else is the AMC.
    if (/Scheme/i.test(t)) category = t;
    else fundHouse = t;
  }

  return {
    rows,
    headerLine,
    orphanRows,
    amcCount: amcs.size,
    categoryCount: cats.size,
  };
}

// ── Field derivation ─────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** "10-Jul-2026" → Date (UTC midnight). Returns null if it isn't that shape. */
export function parseAmfiDate(raw: string): Date | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const mon = MONTHS[m[2]!.toLowerCase()];
  if (mon === undefined) return null;
  return new Date(Date.UTC(Number(m[3]), mon, Number(m[1])));
}

export type NavParse =
  | { kind: "value"; nav: string } // decimal string — never a float (no binary drift)
  | { kind: "absent" } // blank / "N.A." → honest-NULL. NOT a fault, NEVER 0.
  | { kind: "malformed"; raw: string }; // present but not a number → a fault

/**
 * AMFI NAV. Three outcomes, deliberately distinct:
 *   "" / "-" / "N.A."  → absent  (store NULL — a missing NAV is NEVER coerced to 0)
 *   "0.0000"           → value 0 (AMFI genuinely publishes 0 for defunct/written-off
 *                        segregated portfolios — that IS the NAV; NULLing it would discard
 *                        a real published value)
 *   "10."              → value 10 (trailing-dot formatting; 17 rows. Unambiguous, not a fault)
 *   "abc"              → malformed (a fault)
 */
export function parseNav(raw: string): NavParse {
  const t = raw.trim();
  if (t === "" || t === "-" || /^n\.?a\.?$/i.test(t)) return { kind: "absent" };
  if (!/^\d+(\.\d*)?$/.test(t)) return { kind: "malformed", raw: t };
  // Normalise a trailing dot ("10." → "10") so Postgres' decimal parser never sees it.
  return { kind: "value", nav: t.endsWith(".") ? t.slice(0, -1) : t };
}

/** direct | regular from the scheme name; NULL when the name doesn't say (24.8% of rows). Never guessed. */
export function parsePlanType(schemeName: string): "direct" | "regular" | null {
  if (/\bdirect\b/i.test(schemeName)) return "direct";
  if (/\bregular\b/i.test(schemeName)) return "regular";
  return null;
}
