// File: src/ingestions/quaterly-results/ingesters/dispatch.ts (NEW)

import type { ParsedQuarterly, ParsedAnnual } from "../xbrl/parser.js";
import { ingestIndAsQuarterly } from "./ingest-indas-quarterly.js";
import { ingestIndAsAnnual } from "./ingest-indas-annual.js";
import { ingestBankingQuarterly } from "./ingest-banking-quarterly.js";
import { ingestBankingAnnual } from "./ingest-banking-annual.js";
import { ingestNbfcQuarterly } from "./ingest-nbfc-quarterly.js";
import { ingestNbfcAnnual } from "./ingest-nbfc-annual.js";
import { ingestLifeInsuranceQuarterly } from "./ingest-li-quarterly.js";
import { ingestLifeInsuranceAnnual } from "./ingest-li-annual.js";
import { ingestGeneralInsuranceQuarterly } from "./ingest-gi-quarterly.js";
import { ingestGeneralInsuranceAnnual } from "./ingest-gi-annual.js";

export type IngestStatus = "success" | "refreshed";

export async function dispatchQuarterlyIngest(
  stockId: string,
  parsed: ParsedQuarterly,
  source: string,
  decision: "ingest" | "refresh",
): Promise<{ status: IngestStatus; rowId: string; taxonomy: string }> {
  switch (parsed.taxonomy) {
    case "indas":
      return {
        ...(await ingestIndAsQuarterly(
          { stockId, parsed: parsed.data, source },
          decision,
        )),
        taxonomy: "indas",
      };
    case "banking":
      return {
        ...(await ingestBankingQuarterly(
          { stockId, parsed: parsed.data, source },
          decision,
        )),
        taxonomy: "banking",
      };
    case "nbfc":
      return {
        ...(await ingestNbfcQuarterly(
          { stockId, parsed: parsed.data, source },
          decision,
        )),
        taxonomy: "nbfc",
      };
    case "li":
      return {
        ...(await ingestLifeInsuranceQuarterly(
          { stockId, parsed: parsed.data, source },
          decision,
        )),
        taxonomy: "li",
      };
    case "gi":
      return {
        ...(await ingestGeneralInsuranceQuarterly(
          { stockId, parsed: parsed.data, source },
          decision,
        )),
        taxonomy: "gi",
      };
  }
}

export async function dispatchAnnualIngest(
  stockId: string,
  parsed: ParsedAnnual,
  source: string,
  decision: "ingest" | "refresh",
): Promise<{ status: IngestStatus; rowId: string; taxonomy: string }> {
  switch (parsed.taxonomy) {
    case "indas":
      return {
        ...(await ingestIndAsAnnual(
          { stockId, parsed: parsed.data, source },
          decision,
        )),
        taxonomy: "indas",
      };
    case "banking":
      return {
        ...(await ingestBankingAnnual(
          { stockId, parsed: parsed.data, source },
          decision,
        )),
        taxonomy: "banking",
      };
    case "nbfc":
      return {
        ...(await ingestNbfcAnnual(
          { stockId, parsed: parsed.data, source },
          decision,
        )),
        taxonomy: "nbfc",
      };
    case "li":
      return {
        ...(await ingestLifeInsuranceAnnual(
          { stockId, parsed: parsed.data, source },
          decision,
        )),
        taxonomy: "li",
      };
    case "gi":
      return {
        ...(await ingestGeneralInsuranceAnnual(
          { stockId, parsed: parsed.data, source },
          decision,
        )),
        taxonomy: "gi",
      };
  }
}

/**
 * Map taxonomy + filingType to the picker table name. Used by decideIngest().
 */
export function pickerTableFor(
  taxonomy: "indas" | "banking" | "nbfc" | "li" | "gi",
  filingType: "quarterly" | "annual",
):
  | "fundamental"
  | "quarterly_result"
  | "banking_fundamental"
  | "banking_quarterly_result"
  | "nbfc_fundamental"
  | "nbfc_quarterly_result"
  | "li_fundamental"
  | "li_quarterly_result"
  | "gi_fundamental"
  | "gi_quarterly_result" {
  if (filingType === "annual") {
    switch (taxonomy) {
      case "indas":
        return "fundamental";
      case "banking":
        return "banking_fundamental";
      case "nbfc":
        return "nbfc_fundamental";
      case "li":
        return "li_fundamental";
      case "gi":
        return "gi_fundamental";
    }
  }
  switch (taxonomy) {
    case "indas":
      return "quarterly_result";
    case "banking":
      return "banking_quarterly_result";
    case "nbfc":
      return "nbfc_quarterly_result";
    case "li":
      return "li_quarterly_result";
    case "gi":
      return "gi_quarterly_result";
  }
}
