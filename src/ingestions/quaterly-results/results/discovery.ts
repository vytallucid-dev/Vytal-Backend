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

// ★ THE ENVELOPE IS PAGINATED, AND IT ALWAYS WAS. This interface used to declare `data` alone, so
//   `totalCount` was never read and every caller silently took the FIRST PAGE as the whole answer.
//   MEASURED 2026-08-14 (single probes, see the recon): ITI returns totalCount=31 with a 20-row
//   default page — 11 rows, 5 of them Financials (Q1 FY26 and the FY25 annual + Q4), had never been
//   seen by this pipeline. The page is filled by BOTH Financials and Governance rows, so the usable
//   Financials budget is 20 minus however many Governance entries the symbol filed.
interface IntegratedFilingsResponse {
  data: RawIntegratedFilingEntry[];
  /** Page size the server actually applied. Echoes `size` when we send one. */
  size?: number;
  /** Server-side page index. 0-BASED, so it echoes `page-1`; `-1` when we send no `page`. */
  page?: number;
  /** Rows matching the query across ALL pages — Financials AND Governance. */
  totalCount?: number;
}

/**
 * Page size we ask for. MEASURED-good: a `size=100` probe on ITI returned all 31 rows in one call
 * and echoed `size: 100`. Deliberately NOT set higher — 100 is the largest value observed working,
 * and the loop below never trusts it anyway (it drives off the rows actually returned).
 */
const PAGE_SIZE = 100;

/**
 * Hard cap on the page walk. 200 × 100 = 20,000 rows, ~20× the busiest window measured
 * (totalCount 969 for the 13–14 Aug 2026 deadline days). Hitting this throws — see below.
 */
const MAX_PAGES = 200;

export type IntegratedFilingPageFetcher = (
  path: string,
  signal?: AbortSignal,
) => Promise<IntegratedFilingsResponse>;

const nsePageFetcher: IntegratedFilingPageFetcher = (path, signal) =>
  nseClient.get<IntegratedFilingsResponse>(path, signal);

/**
 * Walk every page of an integrated-filing-results query and return the raw rows.
 *
 * The request param is `page`, 1-BASED (MEASURED: `&page=2` on ITI returned rows 21–31 and echoed
 * `page: 1`); `size` is honoured up to at least 100 (MEASURED on the same symbol).
 *
 * ⚠ THIS FAILS LOUDLY IN BOTH DIRECTIONS, ON PURPOSE. Silent truncation is the bug this function
 *    exists to end, so "stop early and return what we have" is never an outcome:
 *      · a page that returns rows we already hold (server ignoring `page`) throws, because the
 *        cursor is not advancing and continuing would loop forever or truncate;
 *      · exhausting MAX_PAGES before reaching totalCount throws.
 *    Dedup is on seq_Id, which also makes the walk safe against a row shifting pages mid-walk.
 *
 * ⚠ `pageSize` / `fetchPage` EXIST ONLY SO THE WALK CAN BE PROVEN OFFLINE. At the production
 *    PAGE_SIZE of 100 no symbol on the books exceeds one page (largest totalCount observed: 31),
 *    so a live multi-page walk is not reproducible on demand — the gate at
 *    src/scripts/verify-integrated-filing-pagination.ts drives this with a stub instead.
 *    Neither production caller passes them.
 */
export async function fetchIntegratedFilingPages(
  baseQuery: string,
  label: string,
  signal?: AbortSignal,
  opts?: { pageSize?: number; fetchPage?: IntegratedFilingPageFetcher },
): Promise<{ rows: RawIntegratedFilingEntry[]; pages: number; totalCount: number | null }> {
  const pageSize = opts?.pageSize ?? PAGE_SIZE;
  const fetchPage = opts?.fetchPage ?? nsePageFetcher;
  const rows: RawIntegratedFilingEntry[] = [];
  const seen = new Set<string>();
  let totalCount: number | null = null;
  let pages = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const path =
      `/api/integrated-filing-results?${baseQuery}` +
      `&size=${pageSize}&page=${page}`;
    const response = await fetchPage(path, signal);
    pages++;

    if (!response || !Array.isArray(response.data)) {
      throw new Error(
        `Expected { data: [...] } from integrated-filing-results for ${label} ` +
          `(page ${page}), got: ${typeof response}`,
      );
    }

    if (typeof response.totalCount === "number") {
      // Keep the LARGEST totalCount seen. A shrinking denominator mid-walk (a row deleted under us)
      // must not be able to satisfy the exhaustion test below with rows still unfetched.
      totalCount = totalCount === null ? response.totalCount : Math.max(totalCount, response.totalCount);
    }

    const before = seen.size;
    for (const raw of response.data) {
      const key = raw.seq_Id ? String(raw.seq_Id) : "";
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      rows.push(raw);
    }
    const fresh = seen.size - before;

    if (response.data.length === 0) break;

    if (fresh === 0) {
      throw new Error(
        `integrated-filing-results pagination made no progress for ${label} at page ${page} ` +
          `(${response.data.length} rows returned, 0 new seq_Ids). The server is not honouring ` +
          `\`page\`. Refusing to truncate silently.`,
      );
    }

    if (totalCount !== null && rows.length >= totalCount) break;
    if (totalCount === null && response.data.length < pageSize) break;
  }

  if (totalCount !== null && rows.length < totalCount) {
    throw new Error(
      `integrated-filing-results: retrieved ${rows.length} of ${totalCount} rows for ${label} ` +
        `after ${pages} page(s) (cap ${MAX_PAGES}). Refusing to return a truncated filing list.`,
    );
  }

  return { rows, pages, totalCount };
}

/**
 * Keep the Financials rows, drop the malformed ones, and normalize what survives.
 * Shared by the per-symbol and the ranged discovery paths so both produce byte-identical
 * NseFilingEntry values from the same raw row.
 */
function normalizeFinancials(
  raws: RawIntegratedFilingEntry[],
  label: string,
  fiscalYearEndFor: (symbol: string) => "march" | "december",
): NseFilingEntry[] {
  const normalized: NseFilingEntry[] = [];
  for (const raw of raws) {
    if (raw.type !== "Integrated Filing- Financials") continue;

    // For Original filings, broadcast_Date is the timestamp.
    // For Revisions, broadcast_Date is null and revised_Date carries the timestamp.
    // creation_Date is always populated and serves as a final fallback.
    const effectiveFilingDate =
      raw.broadcast_Date ?? raw.revised_Date ?? raw.creation_Date;

    if (!raw.qe_Date || !effectiveFilingDate || !raw.xbrl) {
      console.warn(
        `[discovery] ${label}: skipping malformed entry seq_Id=${raw.seq_Id} ` +
          `(qe_Date=${raw.qe_Date ?? "null"}, broadcast_Date=${raw.broadcast_Date ?? "null"}, ` +
          `revised_Date=${raw.revised_Date ?? "null"}, creation_Date=${raw.creation_Date ?? "null"}, ` +
          `xbrl=${raw.xbrl ? "present" : "null"})`,
      );
      continue;
    }

    try {
      normalized.push(normalizeRawEntry(raw, fiscalYearEndFor(raw.symbol)));
    } catch (err) {
      console.warn(
        `[discovery] ${label}: failed to normalize entry seq_Id=${raw.seq_Id}: ${err}`,
      );
      continue;
    }
  }
  return normalized;
}

/**
 * Hit the Integrated Filing endpoint for ONE symbol and return only the Financials entries,
 * normalized to NseFilingEntry shape. Governance entries are filtered out.
 *
 * Returns every filing the symbol has ever made under the integrated regime — quarterly + annual
 * together, ACROSS ALL PAGES. The caller then groups by (qeDate, consolidated) and discriminates
 * by audit status.
 *
 * ⚠ THIS IS THE FALLBACK PATH, NOT THE CRON PATH. It costs one request per symbol per page and
 *    returns the whole history every time. `fetchFilingsInWindow` is what the recurring scan uses.
 *    This is kept for: mode="symbol" (re-scan one stock on demand), mode="backfill", and as the
 *    escape hatch if the ranged endpoint changes shape or starts returning empty.
 */
export async function fetchFilingsList(
  symbol: string,
  fiscalYearEnd: "march" | "december" = "march",
  signal?: AbortSignal,
): Promise<NseFilingEntry[]> {
  const { rows } = await fetchIntegratedFilingPages(
    `index=equities&symbol=${encodeURIComponent(symbol)}`,
    symbol,
    signal,
  );
  return normalizeFinancials(rows, symbol, () => fiscalYearEnd);
}

/** What a ranged discovery pass actually saw, so the caller can log it honestly. */
export interface RangedDiscoveryResult {
  /** In-universe Financials entries, normalized. */
  filings: NseFilingEntry[];
  /** Every row NSE returned for the window — all companies, Financials AND Governance. */
  totalRows: number;
  /** Rows whose `type` is "Integrated Filing- Financials". */
  financialsRows: number;
  /** Financials rows whose symbol is in the active universe. THE FILTER THAT SAVES THE FETCHES. */
  inUniverseRows: number;
  /** Distinct in-universe symbols that filed in the window. */
  symbols: number;
  /** HTTP requests spent. */
  pages: number;
  totalCount: number | null;
  /** The DD-MM-YYYY params actually sent, so callers can log/compare on NSE's own basis. */
  fromDateParam: string;
  toDateParam: string;
}

/**
 * ★ RANGED DISCOVERY — "who filed between X and Y", for the whole market, in a handful of calls.
 *
 * This is the same endpoint `fetchFilingsList` uses, with `symbol` dropped and a date window added.
 * MEASURED 2026-08-14 (single probe): the window is genuinely applied and it filters on the
 * BROADCAST/filing date, not on qe_Date — a 05–06 May 2026 window returned 20 rows all broadcast
 * inside those two days, every one of them for qe_Date 31-MAR-2026. That is exactly the question the
 * scan needs answered, and it is why a revision filed today for a year-old period is still caught.
 *
 * ⚠ ROWS COME BACK NEWEST-FIRST, so page 1 is the newest 100. Without the page walk a window would
 *   silently lose its OLDEST filings — the opposite end from the per-symbol truncation, same bug.
 *
 * ⚠ THE UNIVERSE FILTER RUNS BEFORE ANY XBRL FETCH. This is the insider-trades shape
 *   (ingestions/insider-trades/pit-source.ts:50): one cheap ranged index call, discard everything we
 *   do not track, and only then spend a document fetch. NSE lists far more companies than we score,
 *   so this filter is most of the saving.
 *
 * @param fiscalYearEndFor Returns the stock's fiscal-year end, or undefined if it is NOT in the
 *                         active universe. Doubles as the membership test.
 */
export async function fetchFilingsInWindow(
  from: Date,
  to: Date,
  fiscalYearEndFor: (symbol: string) => "march" | "december" | undefined,
  signal?: AbortSignal,
): Promise<RangedDiscoveryResult> {
  // ⚠ NSE'S WINDOW IS A CALENDAR DATE RANGE IN IST; OUR CLOCK IS UTC. After 18:30 UTC it is
  //   already TOMORROW in India, so a `to_date` built from the UTC date excludes filings NSE has
  //   stamped with tomorrow's date — and the busiest filing hours are exactly there (MEASURED: PWL
  //   broadcast at "14-Aug-2026 20:59" IST). The endpoint is inclusive and a `to_date` in the
  //   future simply returns nothing extra, so the right edge is padded by a day. A short window
  //   silently drops the NEWEST filings, which is the whole class of bug this change exists to end.
  const fromParam = toNseDateParam(from);
  const toParam = toNseDateParam(new Date(to.getTime() + 86_400_000));
  const label = `window ${fromParam}→${toParam}`;
  const { rows, pages, totalCount } = await fetchIntegratedFilingPages(
    `index=equities&from_date=${fromParam}&to_date=${toParam}`,
    label,
    signal,
  );

  const financials = rows.filter((r) => r.type === "Integrated Filing- Financials");
  const inUniverse = financials.filter(
    (r) => !!r.symbol && fiscalYearEndFor(r.symbol.trim().toUpperCase()) !== undefined,
  );

  const filings = normalizeFinancials(
    inUniverse,
    label,
    // Safe: `inUniverse` was already filtered on this returning a value.
    (symbol) => fiscalYearEndFor(symbol.trim().toUpperCase())!,
  );

  return {
    filings,
    totalRows: rows.length,
    financialsRows: financials.length,
    inUniverseRows: inUniverse.length,
    symbols: new Set(filings.map((f) => f.symbol.trim().toUpperCase())).size,
    pages,
    totalCount,
    fromDateParam: fromParam,
    toDateParam: toParam,
  };
}

/** NSE's date-window params take DD-MM-YYYY (same format as corporate-announcements / pit-gg). */
function toNseDateParam(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
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
