import { nseClient } from "../../../lib/client.js";
import type { NseFilingEntry, FilingType } from "../xbrl/types.js";

interface RawIntegratedFilingEntry {
  seq_Id: string;
  symbol: string;
  smName?: string;
  cmName?: string;
  type: string; // "Integrated Filing- Financials" | "Integrated Filing- Governance"
  qe_Date: string; // "31-MAR-2026"
  ixbrl?: string | null;
  type_Sub: "Original" | "New" | "Revision";
  pdf_attach?: string | null;
  xbrl: string;
  broadcast_Date: string; // "29-Apr-2026 11:39:55"
  revised_Date?: string | null;
  revision_Remark?: string | null;
  creation_Date: string;
  audited?: "Audited" | "Un-Audited" | null;
  consolidated?: "Standalone" | "Consolidated" | null;
}

interface IntegratedFilingsResponse {
  data: RawIntegratedFilingEntry[];
}

/**
 * Hit the new Integrated Filing endpoint and return only the Financials entries,
 * normalized to NseFilingEntry shape. Governance entries are filtered out.
 *
 * One call returns all filings for the symbol — quarterly + annual together.
 * The caller then groups by (qeDate, consolidated) and discriminates by audit
 * status.
 */
export async function fetchFilingsList(
  symbol: string,
  fiscalYearEnd: "march" | "december" = "march",
): Promise<NseFilingEntry[]> {
  const path = `/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(symbol)}`;
  const response = await nseClient.get<IntegratedFilingsResponse>(path);

  if (!response || !Array.isArray(response.data)) {
    throw new Error(
      `Expected { data: [...] } from integrated-filing-results for ${symbol}, got: ${typeof response}`,
    );
  }

  const financialsOnly = response.data.filter(
    (r) => r.type === "Integrated Filing- Financials",
  );

  const normalized: NseFilingEntry[] = [];
  for (const raw of financialsOnly) {
    // For Original filings, broadcast_Date is the timestamp.
    // For Revisions, broadcast_Date is null and revised_Date carries the timestamp.
    // creation_Date is always populated and serves as a final fallback.
    const effectiveFilingDate =
      raw.broadcast_Date ?? raw.revised_Date ?? raw.creation_Date;

    if (!raw.qe_Date || !effectiveFilingDate || !raw.xbrl) {
      console.warn(
        `[discovery] ${symbol}: skipping malformed entry seq_Id=${raw.seq_Id} ` +
          `(qe_Date=${raw.qe_Date ?? "null"}, broadcast_Date=${raw.broadcast_Date ?? "null"}, ` +
          `revised_Date=${raw.revised_Date ?? "null"}, creation_Date=${raw.creation_Date ?? "null"}, ` +
          `xbrl=${raw.xbrl ? "present" : "null"})`,
      );
      continue;
    }

    try {
      normalized.push(normalizeRawEntry(raw, fiscalYearEnd));
    } catch (err) {
      console.warn(
        `[discovery] ${symbol}: failed to normalize entry seq_Id=${raw.seq_Id}: ${err}`,
      );
      continue;
    }
  }

  return normalized;
}

/**
 * Convert a raw API entry to our canonical NseFilingEntry.
 * Synthesizes fromDate, toDate, filingType, filingDateParsed.
 */
function normalizeRawEntry(
  raw: RawIntegratedFilingEntry,
  fiscalYearEnd: "march" | "december",
): NseFilingEntry {
  const filingType = inferFilingType(raw, fiscalYearEnd);
  const { fromDate, toDate } = synthesizeDates(raw.qe_Date, filingType);
  const filingDateRaw =
    raw.broadcast_Date ?? raw.revised_Date ?? raw.creation_Date!;
  const filingDateParsed = parseFilingDate(filingDateRaw);

  return {
    seqId: raw.seq_Id,
    symbol: raw.symbol,
    companyName: raw.smName ?? raw.cmName ?? raw.symbol,
    qeDate: raw.qe_Date,
    xbrl: raw.xbrl,
    ixbrl: raw.ixbrl ?? null,
    pdfAttach: raw.pdf_attach ?? null,
    audited: raw.audited ?? null,
    consolidated: raw.consolidated ?? null,
    typeSub: raw.type_Sub,
    broadcastDate: filingDateRaw,
    revisedDate: raw.revised_Date ?? null,
    revisionRemark: raw.revision_Remark ?? null,
    creationDate: raw.creation_Date,

    filingType,
    fromDate,
    toDate,
    filingDateParsed,

    raw: raw as unknown as Record<string, unknown>,
  };
}

/**
 * Derive whether a filing is quarterly or annual.
 *
 * Annual iff qe_Date month matches the stock's fiscal-year-end month.
 *   March-year filer: qe_Date ends in -MAR- → annual
 *   December-year filer: qe_Date ends in -DEC- → annual
 *
 * All other qe_Date months → quarterly. This intentionally promotes both
 * audited and unaudited fiscal-year-end filings to annual (NBFCs, LI, GI
 * file only unaudited Mar-31; this ensures *_fundamentals tables get filled).
 *
 * Audit status is NOT used here. The picker handles audit-pending detection
 * downstream for banking quarterlies via the auditPending flag.
 */
function inferFilingType(
  raw: RawIntegratedFilingEntry,
  fiscalYearEnd: "march" | "december",
): FilingType {
  if (!raw.qe_Date) return "quarterly";
  const qeUpper = raw.qe_Date.toUpperCase();
  const fyEndToken = fiscalYearEnd === "december" ? "-DEC-" : "-MAR-";
  return qeUpper.includes(fyEndToken) ? "annual" : "quarterly";
}

/**
 * Synthesize fromDate and toDate in "DD-MMM-YYYY" format.
 * toDate is always qe_Date. fromDate is computed:
 *   - quarterly: qe_Date - 3 months (start of quarter)
 *   - annual:    qe_Date - 12 months + 1 day (start of fiscal year)
 *
 * Format kept human-readable (matches the legacy endpoint's date strings)
 * for compatibility with existing logging and admin UIs.
 */
function synthesizeDates(
  qeDate: string,
  filingType: FilingType,
): { fromDate: string; toDate: string } {
  const qe = parseDdMmmYyyy(qeDate);

  let fromDate: Date;
  if (filingType === "annual") {
    fromDate = new Date(
      Date.UTC(qe.getUTCFullYear() - 1, qe.getUTCMonth(), qe.getUTCDate() + 1),
    );
  } else {
    // Quarterly: previous quarter-end + 1 day
    fromDate = new Date(Date.UTC(qe.getUTCFullYear(), qe.getUTCMonth() - 2, 1));
  }

  return {
    fromDate: formatDdMmmYyyy(fromDate),
    toDate: qeDate,
  };
}

const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function parseDdMmmYyyy(s: string): Date {
  const m = s.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/i);
  if (!m) throw new Error(`Invalid qe_Date format: ${s}`);
  const day = parseInt(m[1], 10);
  const month = MONTH_NAMES.indexOf(m[2].toUpperCase());
  const year = parseInt(m[3], 10);
  if (month < 0) throw new Error(`Invalid month in qe_Date: ${s}`);
  return new Date(Date.UTC(year, month, day));
}

function formatDdMmmYyyy(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = MONTH_NAMES[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Parse "29-Apr-2026 11:39:55" into a Date.
 */
export function parseFilingDate(s: string): Date {
  const m = s.match(
    /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/,
  );
  if (!m) {
    // Fallback to standard date parsing
    const d = new Date(s);
    if (Number.isNaN(d.getTime()))
      throw new Error(`Cannot parse filing date: ${s}`);
    return d;
  }
  const [, day, monthStr, year, hour, min, sec] = m;
  const month = MONTH_NAMES.indexOf(monthStr.toUpperCase());
  if (month < 0) throw new Error(`Invalid month in filing date: ${s}`);
  return new Date(Date.UTC(+year, month, +day, +hour, +min, +sec));
}

/**
 * Group filings by (qeDate, filingType) so the picker can choose between
 * multiple variants (Standalone vs Consolidated, Original vs Revision).
 *
 * Returns Map<key, NseFilingEntry[]> where key is `${qeDate}|${filingType}`.
 */
export function groupFilingsByPeriod(
  filings: NseFilingEntry[],
): Map<string, NseFilingEntry[]> {
  const groups = new Map<string, NseFilingEntry[]>();
  for (const f of filings) {
    const key = `${f.qeDate}|${f.filingType}`;
    const existing = groups.get(key) ?? [];
    existing.push(f);
    groups.set(key, existing);
  }
  return groups;
}

/**
 * Filter to filings whose `broadcastDate` is within the last `hoursBack` hours
 * from `now`. Used by the scanner to look at recent filings only.
 */
export function filingsSince(
  filings: NseFilingEntry[],
  hoursBack: number,
  now: Date = new Date(),
): NseFilingEntry[] {
  const cutoff = now.getTime() - hoursBack * 3600 * 1000;
  return filings.filter((f) => f.filingDateParsed.getTime() >= cutoff);
}
