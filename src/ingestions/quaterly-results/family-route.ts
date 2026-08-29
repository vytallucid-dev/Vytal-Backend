// ═══════════════════════════════════════════════════════════════════════════
// S8.4b — WHICH FAMILY DOES THIS ROW BELONG TO?
//
// ⚠ THE BUG THIS REPLACES. bse-writer routed on isBankingDocument(xml):
//
//     const hasInterestEarned = /<in-bse-fin:InterestEarned[\s>]/.test(xml);
//     const hasRevenue        = /<in-bse-fin:RevenueFromOperations[\s>]/.test(xml);
//     return hasInterestEarned && !hasRevenue;
//
// That is a TWO-WAY test — bank or not-bank — used to choose between five
// families. Measured on the corpus: all 400 NBFC legacy documents classify as
// NOT-banking (334 carry both InterestEarned and RevenueFromOperations, 66 only
// the latter), so every one of them routes to the `else` branch and is written
// into quarterly_results / fundamentals — the NON-FINANCIAL tables — with
// nothing objecting. The row lands, the run reports success, and an NBFC's
// financials sit in a table no NBFC reader ever looks at.
//
// The document cannot answer this question: an NBFC and a manufacturer both
// carry RevenueFromOperations. The STOCK answers it. Stock.industryType is the
// same key the legacy adapter already routes on, it is non-null for all 504, and
// every stored row already agrees with it (verified: 0 disagreements).
// ═══════════════════════════════════════════════════════════════════════════

/** The five families, one per pair of result tables. */
export type Family = "non_financial" | "banking" | "nbfc" | "life_insurance" | "general_insurance";

/** `Stock.industryType` values, verbatim from the enum. */
export type IndustryType = Family;

export interface FamilyTables {
  quarterly: string;
  annual: string;
}

const TABLES: Record<Family, FamilyTables> = {
  non_financial: { quarterly: "quarterly_results", annual: "fundamentals" },
  banking: { quarterly: "banking_quarterly_results", annual: "banking_fundamentals" },
  nbfc: { quarterly: "nbfc_quarterly_results", annual: "nbfc_fundamentals" },
  life_insurance: { quarterly: "life_insurance_quarterly_results", annual: "life_insurance_fundamentals" },
  general_insurance: { quarterly: "general_insurance_quarterly_results", annual: "general_insurance_fundamentals" },
};

/**
 * The family for a stock. Throws rather than guessing — a null industryType must
 * stop the row, not route it somewhere plausible.
 */
export function familyForStock(industryType: string | null | undefined, symbol: string): Family {
  if (!industryType) {
    throw new Error(
      `Cannot route ${symbol}: Stock.industryType is null. Refusing to guess a family from the document — ` +
        `that is exactly how NBFC rows reached the non-financial tables.`,
    );
  }
  if (!(industryType in TABLES)) {
    throw new Error(`Cannot route ${symbol}: unknown industryType "${industryType}".`);
  }
  return industryType as Family;
}

/** The pair of tables a family writes to. */
export function tablesForFamily(f: Family): FamilyTables {
  return TABLES[f];
}

/** The single table a family+grain writes to. */
export function tableFor(f: Family, grain: "quarterly" | "annual"): string {
  return TABLES[f][grain];
}

/** Every table that is NOT this family's — what a negative test asserts stays empty. */
export function foreignTables(f: Family): string[] {
  return (Object.keys(TABLES) as Family[])
    .filter((k) => k !== f)
    .flatMap((k) => [TABLES[k].quarterly, TABLES[k].annual]);
}

/**
 * Which families can the BSE lane actually write today?
 *
 * ⚠ bse-extract.ts and bse-writer.ts now cover THREE families — non_financial,
 *   banking and nbfc — quarterly and annual each. There is still NO li/gi writer,
 *   so a life- or general-insurance document reaching the BSE lane must be
 *   REFUSED, not written. Falling through to the non-financial branch is the bug
 *   above, and "we have no writer" is not a licence to use the wrong one.
 *
 *   nbfc was added 2026-08-24 after measuring that 111 of 128 NBFC units were
 *   blocked here rather than by missing data: BSE serves every FY2019-FY2021
 *   quarter for CANFINHOME, under the SAME in-bse-fin namespace and the same
 *   OneD/FourD/OneI contexts the non-financial extractor already reads.
 */
export const BSE_SUPPORTED_FAMILIES: readonly Family[] = [
  "non_financial", "banking", "nbfc", "life_insurance", "general_insurance",
] as const;

export function bseCanWrite(f: Family): boolean {
  return BSE_SUPPORTED_FAMILIES.includes(f);
}
