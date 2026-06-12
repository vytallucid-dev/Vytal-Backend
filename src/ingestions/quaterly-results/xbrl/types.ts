// ─────────────────────────────────────────────────────────────
// Types for parsed quarterly result data.
// These are the OUTPUT of the XBRL parser — clean, typed,
// and ready to be upserted into the DB.
// ─────────────────────────────────────────────────────────────

/** Which XBRL taxonomy the filing follows. */
export type FilingTaxonomy = "ind_as" | "banking";

/** Consolidated vs Standalone — from the NSE discovery API, not the XBRL. */
export type ResultType = "consolidated" | "standalone";

export type FilingType = "quarterly" | "annual";
export type ConsolidationVariant = "standalone" | "consolidated";

/** Raw quarterly filing entry from NSE discovery endpoint. */
export interface NseFilingEntry {
  // ── From the API ──
  seqId: string; // was seqNumber
  symbol: string;
  companyName: string; // smName / cmName
  qeDate: string; // "31-MAR-2026" (quarter-end / year-end)
  xbrl: string; // URL to .xml
  ixbrl: string | null; // URL to .html (ignored; for reference only)
  pdfAttach: string | null; // URL to PDF (ignored; mostly null)
  audited: "Audited" | "Un-Audited" | null;
  consolidated: "Standalone" | "Consolidated" | null;
  typeSub: "Original" | "New" | "Revision";
  broadcastDate: string; // raw "29-Apr-2026 11:39:55"
  revisedDate: string | null;
  revisionRemark: string | null;
  creationDate: string;

  // ── Derived during normalization ──
  filingType: FilingType; // "quarterly" | "annual"
  fromDate: string; // "DD-MMM-YYYY" — synthesized
  toDate: string; // "DD-MMM-YYYY" — synthesized (= qeDate)
  filingDateParsed: Date; // parsed from broadcastDate

  // ── Original raw entry, for fetch logging / debugging ──
  raw: Record<string, unknown>;
}

/** Parsed quarterly result ready for DB upsert. All money values in ₹ Crore. */
export interface ParsedQuarterlyResult {
  // ── Identity ──
  symbol: string;
  quarter: string; // "Q1" | "Q2" | "Q3" | "Q4"
  fiscalYear: string; // "FY25"
  reportDate: Date; // period end (e.g., 2024-12-31)
  filingDate: Date; // board meeting / announcement date

  // ── Classification ──
  resultType: ResultType;
  taxonomy: FilingTaxonomy;
  xbrlUrl: string;

  // ── P&L (₹ Crore) ──
  revenue: number | null;
  otherIncome: number | null;
  expenses: number | null;
  operatingProfit: number | null;
  depreciation: number | null;
  interest: number | null;
  profitBeforeTax: number | null;
  tax: number | null;
  netProfit: number | null;
}
