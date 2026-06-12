// File: src/ingestions/quaterly-results/xbrl/parser.ts (NEW — replaces v2's monolithic parser)

import {
  detectTaxonomy,
  industryForTaxonomy,
  type Taxonomy,
} from "./taxonomy.js";
import {
  parseIndAsQuarterly,
  parseIndAsAnnual,
  type ParseContext,
  type ParsedIndAsQuarterly,
  type ParsedIndAsAnnual,
} from "./parser-indas.js";
import {
  parseBankingQuarterly,
  parseBankingAnnual,
  type ParsedBankingQuarterly,
  type ParsedBankingAnnual,
} from "./parser-banking.js";
import {
  parseNbfcQuarterly,
  parseNbfcAnnual,
  type ParsedNbfcQuarterly,
  type ParsedNbfcAnnual,
} from "./parser-nbfc.js";
import {
  parseLifeInsuranceQuarterly,
  parseLifeInsuranceAnnual,
  type ParsedLifeInsuranceQuarterly,
  type ParsedLifeInsuranceAnnual,
} from "./parser-li.js";
import {
  parseGeneralInsuranceQuarterly,
  parseGeneralInsuranceAnnual,
  type ParsedGeneralInsuranceQuarterly,
  type ParsedGeneralInsuranceAnnual,
} from "./parser-gi.js";
import type { IndustryType } from "../../../generated/prisma/client.js";

export type ParsedQuarterly =
  | { taxonomy: "indas"; data: ParsedIndAsQuarterly }
  | { taxonomy: "banking"; data: ParsedBankingQuarterly }
  | { taxonomy: "nbfc"; data: ParsedNbfcQuarterly }
  | { taxonomy: "li"; data: ParsedLifeInsuranceQuarterly }
  | { taxonomy: "gi"; data: ParsedGeneralInsuranceQuarterly };

export type ParsedAnnual =
  | { taxonomy: "indas"; data: ParsedIndAsAnnual }
  | { taxonomy: "banking"; data: ParsedBankingAnnual }
  | { taxonomy: "nbfc"; data: ParsedNbfcAnnual }
  | { taxonomy: "li"; data: ParsedLifeInsuranceAnnual }
  | { taxonomy: "gi"; data: ParsedGeneralInsuranceAnnual };

/**
 * Dispatch a quarterly XBRL file to the right parser based on taxonomy.
 * Optionally validates against expected industry — if expectedIndustry is
 * provided and doesn't match, throws.
 */
export function parseQuarterly(
  xml: string,
  ctx: ParseContext,
  expectedIndustry?: IndustryType,
): ParsedQuarterly {
  const taxonomy = detectTaxonomy(xml, ctx.xbrl);

  if (expectedIndustry !== undefined) {
    const detectedIndustry = industryForTaxonomy(taxonomy);
    if (detectedIndustry !== expectedIndustry) {
      throw new Error(
        `Industry mismatch for ${ctx.symbol}: ` +
          `Stock.industryType=${expectedIndustry}, but XBRL taxonomy=${taxonomy} (=${detectedIndustry}). ` +
          `Either the seed has wrong industry, or this filing is in the wrong slot.`,
      );
    }
  }

  switch (taxonomy) {
    case "indas":
      return { taxonomy, data: parseIndAsQuarterly(xml, ctx) };
    case "banking":
      return { taxonomy, data: parseBankingQuarterly(xml, ctx) };
    case "nbfc":
      return { taxonomy, data: parseNbfcQuarterly(xml, ctx) };
    case "li":
      return { taxonomy, data: parseLifeInsuranceQuarterly(xml, ctx) };
    case "gi":
      return { taxonomy, data: parseGeneralInsuranceQuarterly(xml, ctx) };
  }
}

export function parseAnnual(
  xml: string,
  ctx: ParseContext,
  expectedIndustry?: IndustryType,
): ParsedAnnual {
  const taxonomy = detectTaxonomy(xml, ctx.xbrl);

  if (expectedIndustry !== undefined) {
    const detectedIndustry = industryForTaxonomy(taxonomy);
    if (detectedIndustry !== expectedIndustry) {
      throw new Error(
        `Industry mismatch for ${ctx.symbol}: ` +
          `Stock.industryType=${expectedIndustry}, but XBRL taxonomy=${taxonomy} (=${detectedIndustry}).`,
      );
    }
  }

  switch (taxonomy) {
    case "indas":
      return { taxonomy, data: parseIndAsAnnual(xml, ctx) };
    case "banking":
      return { taxonomy, data: parseBankingAnnual(xml, ctx) };
    case "nbfc":
      return { taxonomy, data: parseNbfcAnnual(xml, ctx) };
    case "li":
      return { taxonomy, data: parseLifeInsuranceAnnual(xml, ctx) };
    case "gi":
      return { taxonomy, data: parseGeneralInsuranceAnnual(xml, ctx) };
  }
}
