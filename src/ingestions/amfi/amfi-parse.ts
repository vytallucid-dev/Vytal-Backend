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

/**
 * THE COLUMNS THIS PARSER READS — asserted BY NAME, never by position.
 *
 * ⚠ THIS REPLACES AN EXACT-STRING HEADER MATCH, AND THAT MATCH COST US ELEVEN DAYS OF NAVs.
 *   MEASURED: on 2026-08-19 AMFI inserted two columns into NAVAll.txt —
 *       …;Scheme Name;Plan;Option;Net Asset Value;Date          (was …;Scheme Name;Net Asset Value;Date)
 *   — and moved the plan/option words OUT of the scheme name and INTO their own columns. The
 *   old guard compared the header to one frozen string, so an ADDITIVE change it could have
 *   absorbed read as a total break: every nightly run from 2026-08-19 to 2026-08-28 aborted,
 *   and 18,040 funds sat frozen at their 2026-08-17 NAV while the fault row counted to 22.
 *
 * ★ THE DISTINCTION THE OLD GUARD COULD NOT MAKE. A column being ADDED cannot corrupt a
 *   name-resolved read; a column being RENAMED OR REMOVED can, because then we do not know
 *   where the field went. So the assertion is MEMBERSHIP, not equality — exactly the ruling
 *   prices-guards.ts already made for the NSE bhavcopy (REQUIRED_BHAV_COLUMNS / checkShape).
 *   The run still fails CLOSED on a rename; it no longer fails on a column we never read.
 */
export const REQUIRED_AMFI_COLUMNS = [
  "Scheme Code",
  "ISIN Div Payout/ ISIN Growth",
  "ISIN Div Reinvestment",
  "Scheme Name",
  "Net Asset Value",
  "Date",
] as const;

/** OPTIONAL columns — read when present, absent without complaint. AMFI added these on
 *  2026-08-19; before that the same facts lived inside the scheme name. */
export const OPTIONAL_AMFI_COLUMNS = ["Plan", "Option"] as const;

/**
 * Header cells are compared with whitespace COLLAPSED and case ignored, because AMFI's own two
 * feeds disagree with each other on exactly that: NAVAll ships "ISIN Div Payout/ ISIN Growth"
 * and the history endpoint ships "ISIN Div Payout/ISIN Growth". Keying on the space would make
 * one feed's spelling a break in the other.
 */
export function normaliseHeaderCell(c: string): string {
  return c.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface AmfiColumnMap {
  /** Resolved index per required/optional column name. Missing optionals are -1. */
  index: Record<string, number>;
  /** Required columns the header does NOT carry — non-empty ⇒ the shape guard must reject. */
  missing: string[];
}

/** Resolve column POSITIONS from the header line the file actually shipped. */
export function resolveAmfiColumns(headerLine: string | null): AmfiColumnMap {
  const cells = (headerLine ?? "").split(";").map(normaliseHeaderCell);
  const index: Record<string, number> = {};
  const missing: string[] = [];
  for (const name of REQUIRED_AMFI_COLUMNS) {
    const i = cells.indexOf(normaliseHeaderCell(name));
    index[name] = i;
    if (i < 0) missing.push(name);
  }
  for (const name of OPTIONAL_AMFI_COLUMNS) {
    index[name] = cells.indexOf(normaliseHeaderCell(name));
  }
  return { index, missing };
}

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
  /** "Plan" column — "Direct Plan" / "Regular Plan". NULL before AMFI split it out
   *  (2026-08-19), and NULL on the rows where AMFI still ships it empty. Never inferred. */
  planRaw: string | null;
  /** "Option" column — "Growth Option" / "IDCW Option" / …. Same nullability rule as planRaw. */
  optionRaw: string | null;
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
  /** Which physical column each field was read from. The shape guard reads `.missing`. */
  columns: AmfiColumnMap;
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
  let columns: AmfiColumnMap = resolveAmfiColumns(null);
  let orphanRows = 0;
  const amcs = new Set<string>();
  const cats = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (!t) continue;

    if (t.startsWith("Scheme Code;")) {
      if (headerLine === null) {
        headerLine = t; // the column header — captured once, for the shape guard
        columns = resolveAmfiColumns(t); // …and it is what tells every field where it lives
      }
      continue;
    }

    const parts = t.split(";");
    const isDataRow = parts.length >= 6 && /^\d+$/.test((parts[0] ?? "").trim());

    if (isDataRow) {
      // A data row BEFORE the header cannot be read at all — nothing has told us what any
      // column means. Count it as an orphan and skip it rather than assume last year's layout.
      if (headerLine === null) {
        orphanRows++;
        continue;
      }
      if (!category || !fundHouse) orphanRows++;
      const c = parts.map((p) => p.trim());
      const at = (name: string): string | undefined => {
        const idx = columns.index[name];
        return idx === undefined || idx < 0 ? undefined : c[idx];
      };
      cats.add(category ?? "");
      amcs.add(fundHouse ?? "");
      rows.push({
        schemeCode: at("Scheme Code") ?? "",
        isinGrowth: cell(at("ISIN Div Payout/ ISIN Growth")),
        isinReinvest: cell(at("ISIN Div Reinvestment")),
        schemeName: at("Scheme Name") ?? "",
        planRaw: cell(at("Plan")),
        optionRaw: cell(at("Option")),
        navRaw: at("Net Asset Value") ?? "",
        dateRaw: at("Date") ?? "",
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
    columns,
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

/**
 * THE DISPLAY IDENTITY OF ONE SCHEME — "<Scheme Name> - <Plan> - <Option>".
 *
 * ⚠ WITHOUT THIS, FIXING THE HEADER WOULD TRADE ONE SILENT FAILURE FOR ANOTHER. AMFI did not
 *   merely ADD Plan and Option on 2026-08-19 — it MOVED them OUT OF THE SCHEME NAME. What
 *   shipped as four distinguishable funds:
 *       Axis Children's Fund - Lock in - Direct Growth
 *       Axis Children's Fund - Lock in - Direct Plan - IDCW
 *       Axis Children's Fund - Lock in - Regular Growth
 *       Axis Children's Fund - Lock in - Regular Plan - IDCW
 *   now ships as the SAME STRING four times ("Axis Children's Fund"), with the difference
 *   relocated into two new columns. Writing that bare name straight through would collapse four
 *   catalogue rows to one indistinguishable label — a display regression landing the very moment
 *   the ingest was unblocked, and invisible because every row would still look plausible.
 *
 * ★ NOTHING HERE IS INVENTED. Every token comes from AMFI's own cells; this only puts back the
 *   join AMFI used to do itself. When the columns are absent (the pre-2026-08-19 files, and the
 *   rows where AMFI still ships them empty) the name is returned UNTOUCHED, so historical
 *   behaviour is unchanged byte-for-byte.
 *
 * ★ AND IT KEEPS THE FAMILY NORMALIZER WHOLE. mf-family.ts derives "same fund" by tail-stripping
 *   plan/option phrases, and "direct plan" / "regular plan" / "growth option" / "idcw option" are
 *   all already in its vocabulary — so a composed name reduces to exactly the family key the bare
 *   name would have. The grouping does not move; only the label a reader sees does.
 */
export function composeSchemeName(
  schemeName: string,
  planRaw: string | null,
  optionRaw: string | null,
): string {
  const base = schemeName.trim();
  const haystack = base.toLowerCase();
  const parts = [planRaw, optionRaw]
    .map((x) => (x ?? "").trim())
    .filter((x) => x.length > 0)
    // A cell AMFI has ALREADY folded into the name adds nothing, and repeating it would defeat
    // the family tail-strip — that walk halts at the first token it does not recognise, and a
    // doubled "Growth Option ... Growth Option" leaves an unrecognised remainder mid-tail.
    .filter((x) => !haystack.includes(x.toLowerCase()));
  return parts.length ? `${base} - ${parts.join(" - ")}` : base;
}

/**
 * direct | regular — from AMFI's OWN "Plan" column when it ships one, else from the scheme
 * name. NULL when neither says. Never guessed.
 *
 * ⚠ THE COLUMN HAS TO WIN, AND THAT IS NOT A PREFERENCE. Until 2026-08-19 the plan lived
 *   INSIDE the scheme name ("Axis Children's Fund - Direct Plan - Growth Option") and reading
 *   the name was the only way there was. On 2026-08-19 AMFI moved it into its own column and
 *   STRIPPED IT FROM THE NAME ("Axis Children's Fund"). A name-only read would therefore have
 *   gone on working, gone on returning a value, and quietly turned 14,068 classified plans
 *   into NULLs — the exact silent-degradation shape this guard programme exists to catch.
 *   The name stays as the FALLBACK because every row we already hold was classified from it,
 *   and AMFI's history feed still ships the old style.
 */
export function parsePlanType(
  schemeName: string,
  planRaw?: string | null,
): "direct" | "regular" | null {
  const col = planRaw ?? "";
  if (/\bdirect\b/i.test(col)) return "direct";
  if (/\bregular\b/i.test(col)) return "regular";
  if (/\bdirect\b/i.test(schemeName)) return "direct";
  if (/\bregular\b/i.test(schemeName)) return "regular";
  return null;
}
