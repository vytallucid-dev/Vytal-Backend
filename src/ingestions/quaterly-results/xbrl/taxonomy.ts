import type { IndustryType } from "../../../generated/prisma/client.js";

/**
 * Detect the industry-specific taxonomy from XBRL header.
 *
 * Primary signal: `xmlns:in-capmkt-ent` URL contains `/IntegratedFinance_X/`
 * where X ∈ {Banking, NBFC, LI, GI, IndAS}.
 *
 * Secondary signal (fallback): XBRL filename pattern, e.g. INTEGRATED_FILING_LI_*.
 */
export type Taxonomy = "banking" | "nbfc" | "li" | "gi" | "indas";

const NAMESPACE_RE =
  /xmlns:in-capmkt-ent\s*=\s*"[^"]*\/IntegratedFinance_([A-Za-z]+)\//i;
const FILENAME_RE = /INTEGRATED_FILING_(BANKING|NBFC|LI|GI|INDAS)_/i;

export function detectTaxonomy(xml: string, xbrlUrl?: string): Taxonomy {
  // Primary: namespace URL
  const nsMatch = NAMESPACE_RE.exec(xml);
  if (nsMatch) {
    return mapTaxonomyToken(nsMatch[1]);
  }

  // Secondary: filename pattern
  if (xbrlUrl) {
    const fnMatch = FILENAME_RE.exec(xbrlUrl);
    if (fnMatch) {
      return mapTaxonomyToken(fnMatch[1]);
    }
  }

  throw new Error(
    `Unable to detect taxonomy from XBRL. ` +
      `Namespace pattern not found and filename hint absent. ` +
      `URL: ${xbrlUrl ?? "(not provided)"}`,
  );
}

function mapTaxonomyToken(token: string): Taxonomy {
  switch (token.toUpperCase()) {
    case "BANKING":
      return "banking";
    case "NBFC":
      return "nbfc";
    case "LI":
      return "li";
    case "GI":
      return "gi";
    case "INDAS":
      return "indas";
    default:
      throw new Error(`Unknown IntegratedFinance taxonomy token: ${token}`);
  }
}

/**
 * Map an IndustryType (from Stock.industryType in DB) to the expected Taxonomy.
 * Used to validate that the filing matches the stock's industry classification.
 */
export function expectedTaxonomyForIndustry(industry: IndustryType): Taxonomy {
  switch (industry) {
    case "non_financial":
      return "indas";
    case "banking":
      return "banking";
    case "nbfc":
      return "nbfc";
    case "life_insurance":
      return "li";
    case "general_insurance":
      return "gi";
  }
}

/**
 * Map detected Taxonomy back to an IndustryType for routing.
 */
export function industryForTaxonomy(t: Taxonomy): IndustryType {
  switch (t) {
    case "indas":
      return "non_financial";
    case "banking":
      return "banking";
    case "nbfc":
      return "nbfc";
    case "li":
      return "life_insurance";
    case "gi":
      return "general_insurance";
  }
}
