// File: src/ingestions/quaterly-results/ingesters/dispatch.ts (NEW)

import type { ParsedQuarterly, ParsedAnnual } from "../xbrl/parser.js";
import { FILL_NULL_ONLY, fullUpsert, type WriteDirective } from "./guarded-write.js";
export type { WriteMode, WriteDirective } from "./guarded-write.js";
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

export type IngestStatus = "success" | "refreshed" | "rejected";

/**
 * What every ingester returns.
 *
 * `status` still means WHAT WE DID TO THE ROW ("refreshed" = we rewrote it) — deliberately
 * unchanged, so run logs and result_fetch_logs keep saying the same thing they always did.
 *
 * `scoreRelevantChanged` is the SEPARATE, NEW fact: did a column the SCORER ACTUALLY READS move?
 * These two are not the same question, and conflating them is the bug this field exists to fix —
 * the ingest rewrites a row whenever the filing date advances, which was firing a full 13-PG
 * rescore fan-out for re-filings whose numbers were identical (measured: 94% of them).
 *
 * ⚠️  CONSERVATIVE FOR UNSCORED TAXONOMIES. nbfc / li / gi report `true` unconditionally: no
 *     scored peer group reads those tables (PG7 NBFC is gated out of SCORED_PGS, and there is no
 *     insurance PG), so their symbols are dropped by pgRefsForSymbols anyway and a `true` costs
 *     nothing. If one of them is ever scored, it gets a real diff — never a stale `false`.
 */
export interface IngestOutcome {
  status: IngestStatus;
  rowId: string;
  /** True ⇒ a rescore MUST be triggered. See score-relevant-diff.ts. */
  scoreRelevantChanged: boolean;
  /** Which score-relevant columns moved (empty on a first-seen row) — for the run log. */
  changedColumns?: string[];
}


/**
 * ⚠ THE ONLY TWO PLACES IN THE CODEBASE THAT CAN PRODUCE A FULL-ROW REWRITE.
 *
 * The safe default is fill_null_only, but applying it unconditionally would be a REGRESSION, not a
 * fix: under the call graph as it stands, `refresh` is the only decision that ever reaches a row
 * that already exists ("ingest" means there was none, "skip" never calls an ingester). So a blanket
 * fill_null_only would silently stop applying RESTATEMENTS — a filer correcting its own numbers
 * would be ignored, which is a quieter and worse failure than the one being fixed.
 *
 * So `refresh` — and only `refresh`, which by definition means a genuinely NEWER filing for a period
 * we already hold — opts into the full rewrite. What makes that safe is that the fence in
 * guarded-write.ts sits BELOW the mode switch: full_upsert still cannot move a cell carrying
 * `source='manual_workbook'` or a raw_field_edits row. The restatement lands on pipeline-owned
 * columns and stops at hand-entered ones.
 */
function directiveFor(decision: "ingest" | "refresh", override?: WriteDirective): WriteDirective {
  if (override) return override;
  return decision === "refresh"
    ? fullUpsert("decideIngest saw a strictly newer filingDate for a period already held — a filer restatement. The provenance fence still protects hand-entered cells.")
    : FILL_NULL_ONLY;
}

export async function dispatchQuarterlyIngest(
  stockId: string,
  parsed: ParsedQuarterly,
  source: string,
  decision: "ingest" | "refresh",
  // Omit to let the decision choose (see directiveFor). An explicit directive overrides it.
  directiveOverride?: WriteDirective,
): Promise<IngestOutcome & { taxonomy: string }> {
  switch (parsed.taxonomy) {
    case "indas":
      return {
        ...(await ingestIndAsQuarterly(
          { stockId, parsed: parsed.data, source },
          decision,
          directiveFor(decision, directiveOverride),
        )),
        taxonomy: "indas",
      };
    case "banking":
      return {
        ...(await ingestBankingQuarterly(
          { stockId, parsed: parsed.data, source },
          decision,
          directiveFor(decision, directiveOverride),
        )),
        taxonomy: "banking",
      };
    case "nbfc":
      return {
        ...(await ingestNbfcQuarterly(
          { stockId, parsed: parsed.data, source },
          decision,
          directiveFor(decision, directiveOverride),
        )),
        taxonomy: "nbfc",
      };
    case "li":
      return {
        ...(await ingestLifeInsuranceQuarterly(
          { stockId, parsed: parsed.data, source },
          decision,
          directiveFor(decision, directiveOverride),
        )),
        taxonomy: "li",
      };
    case "gi":
      return {
        ...(await ingestGeneralInsuranceQuarterly(
          { stockId, parsed: parsed.data, source },
          decision,
          directiveFor(decision, directiveOverride),
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
  // Omit to let the decision choose (see directiveFor). An explicit directive overrides it.
  directiveOverride?: WriteDirective,
): Promise<IngestOutcome & { taxonomy: string }> {
  switch (parsed.taxonomy) {
    case "indas":
      return {
        ...(await ingestIndAsAnnual(
          { stockId, parsed: parsed.data, source },
          decision,
          directiveFor(decision, directiveOverride),
        )),
        taxonomy: "indas",
      };
    case "banking":
      return {
        ...(await ingestBankingAnnual(
          { stockId, parsed: parsed.data, source },
          decision,
          directiveFor(decision, directiveOverride),
        )),
        taxonomy: "banking",
      };
    case "nbfc":
      return {
        ...(await ingestNbfcAnnual(
          { stockId, parsed: parsed.data, source },
          decision,
          directiveFor(decision, directiveOverride),
        )),
        taxonomy: "nbfc",
      };
    case "li":
      return {
        ...(await ingestLifeInsuranceAnnual(
          { stockId, parsed: parsed.data, source },
          decision,
          directiveFor(decision, directiveOverride),
        )),
        taxonomy: "li",
      };
    case "gi":
      return {
        ...(await ingestGeneralInsuranceAnnual(
          { stockId, parsed: parsed.data, source },
          decision,
          directiveFor(decision, directiveOverride),
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
