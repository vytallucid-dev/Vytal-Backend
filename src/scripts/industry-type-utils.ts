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
 *    in NSE actually file as NBFCs (e.g., JIOFIN).
 *  - Holdings that look like NBFCs but file Ind-AS (BAJAJHLDNG).
 */
const SYMBOL_OVERRIDES: Record<string, IndustryType> = {
  // ── Life Insurance ──────────────────────────────────────────
  SBILIFE: "life_insurance",
  HDFCLIFE: "life_insurance",
  LICI: "life_insurance",
  ICICIPRULI: "life_insurance",
  MAXFIN: "non_financial", // Holding co; Max Life subsidiary doesn't list separately

  // ── General Insurance ───────────────────────────────────────
  ICICIGI: "general_insurance",
  STARHEALTH: "general_insurance",
  GICRE: "general_insurance", // Reinsurer; files as GI
  NIACL: "general_insurance",

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

  // ── Banking edge cases ──────────────────────────────────────
  RBLBANK: "banking",
  IDFCFIRSTB: "banking",
  AUBANK: "banking",
  BANDHANBNK: "banking",
  FEDERALBNK: "banking",
  CSBBANK: "banking",
  DCBBANK: "banking",
  EQUITASBNK: "banking",

  // ── Holding companies that file Ind-AS (NOT NBFC) ───────────
  BAJAJHLDNG: "non_financial", // Pure holding; files Ind-AS not NBFC
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
