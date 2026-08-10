// ─────────────────────────────────────────────────────────────
// INDUSTRY TYPE DERIVATION UTILITY
//
// Shared by seed-nifty200.ts, seed-extra-stocks.ts, and
// refresh-industry-types.ts.
//
// Priority order:
//   1. Symbol-level overrides (SYMBOL_OVERRIDES)  — highest priority
//   2. Sector-key heuristic (SECTOR_INDUSTRY_MAP)
//   3. Fallback → "non_financial"
//
// Add to SYMBOL_OVERRIDES whenever the heuristic mismaps a stock.
// ─────────────────────────────────────────────────────────────

export type IndustryType =
  | "non_financial"
  | "banking"
  | "nbfc"
  | "life_insurance"
  | "general_insurance";

/**
 * Symbol-level overrides — wins over sector-key heuristic.
 *
 * KEY CASES:
 *  - Insurance sector is split into life vs general — sector key alone
 *    can't tell them apart, so every insurance stock needs an override.
 *  - Some stocks labelled under "capital_markets" or other sectors
 *    in NSE actually file as NBFCs (e.g., JIOFIN, and the broking/wealth/AMC
 *    block added 2026-08-10 — 360ONE, ANGELONE, ABSLAMC, ICICIAMC,
 *    JMFINANCIL, NAM-INDIA, NUVAMA, TATAINVEST, UTIAMC, and HDFCAMC — added
 *    2026-08-10 in a second pass, once the taxonomy-validation check (see
 *    findIndustryTaxonomyDisagreements in src/seed/industry-types.ts) caught
 *    it as a 14th case the first pass missed despite sitting in the same
 *    "Large-Cap AMCs & Exchanges" peer group as three of the nine above).
 *  - BAJAJHLDNG was believed to file Ind-AS as a pure holding co; its own
 *    filed XBRL says otherwise (corrected 2026-08-10 — see note below).
 *
 * ★ THIS TABLE IS HAND-MAINTAINED AND CAN DRIFT FROM WHAT A COMPANY ACTUALLY
 *   FILES. Nothing here is validated against the XBRL taxonomy a stock's own
 *   filings declare (src/ingestions/quaterly-results/xbrl/taxonomy.ts) — that
 *   check only runs at scan time, AFTER this table has already produced a
 *   value, and a mismatch there fails closed (the filing is skipped, not the
 *   classification corrected). A sector reclassification, an NSE taxonomy
 *   migration, or simply a stock never added here will reproduce the same
 *   silent-refusal failure this 2026-08-10 fix addressed. See
 *   result_fetch_logs.error LIKE 'Industry mismatch%' to detect it.
 */
const SYMBOL_OVERRIDES: Record<string, IndustryType> = {
  // ── Life Insurance ──────────────────────────────────────────
  SBILIFE: "life_insurance",
  HDFCLIFE: "life_insurance",
  LICI: "life_insurance",
  ICICIPRULI: "life_insurance",
  CANHLIFE: "life_insurance",
  MAXFIN: "non_financial", // Holding co; Max Life subsidiary doesn't list separately

  // ── General Insurance ───────────────────────────────────────
  ICICIGI: "general_insurance",
  STARHEALTH: "general_insurance",
  GICRE: "general_insurance", // Reinsurer; files as GI
  NIACL: "general_insurance",
  GODIGIT: "general_insurance",
  NIVABUPA: "general_insurance",

  // ── NBFCs that may be labelled differently ──────────────────
  BAJFINANCE: "nbfc",
  BAJAJFINSV: "nbfc",
  CHOLAFIN: "nbfc",
  MUTHOOTFIN: "nbfc",
  MMFIN: "nbfc",
  MANAPPURAM: "nbfc",
  SHRIRAMFIN: "nbfc",
  PFC: "nbfc",
  RECLTD: "nbfc",
  IRFC: "nbfc",
  POONAWALLA: "nbfc",
  LICHSGFIN: "nbfc",
  PNBHOUSING: "nbfc",
  HUDCO: "nbfc",
  ABCAPITAL: "nbfc",
  LTF: "nbfc",
  JIOFIN: "nbfc",

  // ── Capital-markets stocks (broking / wealth / AMC) that file under the
  //    NBFC integrated-filing taxonomy — confirmed against each stock's own
  //    filed XBRL namespace (result_fetch_logs "Industry mismatch" rows,
  //    2026-08-10), not assumed from the "capital_markets" sector label.
  //    Sector alone can't carry this: SECTOR_INDUSTRY_MAP deliberately has no
  //    "capital_markets" entry, so without an override these fell through to
  //    the non_financial default and every filing was rejected at ingest.
  "360ONE": "nbfc",
  ANGELONE: "nbfc",
  ABSLAMC: "nbfc",
  ICICIAMC: "nbfc",
  JMFINANCIL: "nbfc",
  "NAM-INDIA": "nbfc",
  NUVAMA: "nbfc",
  TATAINVEST: "nbfc",
  UTIAMC: "nbfc",
  // HDFCAMC — missed by the first pass despite being the largest AMC in the group.
  // Confirmed against its own filed XBRL (result_fetch_logs "Industry mismatch" rows,
  // most recently 2026-07-15: stock=non_financial, xbrl=nbfc) by
  // findIndustryTaxonomyDisagreements, 2026-08-10.
  HDFCAMC: "nbfc",

  // ── Banking edge cases ──────────────────────────────────────
  RBLBANK: "banking",
  IDFCFIRSTB: "banking",
  AUBANK: "banking",
  BANDHANBNK: "banking",
  FEDERALBNK: "banking",
  CSBBANK: "banking",
  DCBBANK: "banking",
  EQUITASBNK: "banking",

  // ── Holding companies ────────────────────────────────────────
  // BAJAJHLDNG was previously overridden to non_financial on the assumption
  // it files Ind-AS. Its own filed XBRL (result_fetch_logs, 2026-08-10) is
  // namespaced NBFC, not IndAS — corrected here; see the note above.
  BAJAJHLDNG: "nbfc",
};

/**
 * Sector-key → industry-type heuristic.
 * Only handles unambiguous cases; insurance is intentionally omitted
 * because the sector mixes life and general — use SYMBOL_OVERRIDES for those.
 */
const SECTOR_INDUSTRY_MAP: Partial<Record<string, IndustryType>> = {
  banks: "banking",
  nbfc: "nbfc",
};

/**
 * Derive IndustryType from a stock's symbol and sectorKey.
 *
 * @param symbol   NSE symbol (case-insensitive)
 * @param sectorKey  The Sector.name value (e.g. "banks", "nbfc", "insurance")
 */
export function deriveIndustryType(
  symbol: string,
  sectorKey: string | null | undefined,
): IndustryType {
  // 1) Symbol-level override — highest priority
  const override = SYMBOL_OVERRIDES[symbol.toUpperCase()];
  if (override) return override;

  // 2) Sector heuristic
  if (sectorKey) {
    const mapped = SECTOR_INDUSTRY_MAP[sectorKey];
    if (mapped) return mapped;
  }

  // 3) Fallback
  return "non_financial";
}
