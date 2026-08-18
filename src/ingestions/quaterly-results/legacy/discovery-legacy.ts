// ─────────────────────────────────────────────────────────────
// LEGACY V2 NSE DISCOVERY + XBRL FETCHER
//
// Moved from: src/ingestions/quaterly-results/results/results-fetcher.ts
//
// fetchFilingsList → hits the OLD corporates-financial-results endpoint
//   (returns quarterly P&L JSON; no annual; no governance entries).
//
// fetchXbrlFile → generic HTTPS fetcher reused by both v2 and v3.
//   It is also re-exported from results/results-fetcher.ts (stub) so
//   v3 scan.ts keeps working without modification.
//
// DO NOT use fetchFilingsList for new code. v3 uses discovery.ts which
// calls the integrated-filing-results endpoint.
//
// Used ONLY by: legacy/backfill-legacy.ts, legacy/scan-legacy.ts, etc.
// ─────────────────────────────────────────────────────────────

import https from "https";
import { nseClient } from "../../../lib/client.js";

const XBRL_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/xml,text/xml,*/*;q=0.9",
  Referer: "https://www.nseindia.com/",
};

// Legacy v2 discovery — uses old corporates-financial-results endpoint.
// Only returns quarterly results (no annual). Historical backfill use only.
/**
 * Fetch v2 filings from the deprecated corporates-financial-results endpoint.
 *
 * @param symbol Stock symbol
 * @param period "Quarterly" or "Annual" — passed as URL query param
 */
export async function fetchFilingsList(
  symbol: string,
  period: "Quarterly" | "Annual" = "Quarterly",
  opts?: { fromDate?: string; toDate?: string },
): Promise<any[]> {
  const path =
    `/api/corporates-financial-results` +
    `?index=equities&symbol=${encodeURIComponent(symbol)}&period=${period}` +
    (opts?.fromDate ? `&fromDate=${encodeURIComponent(opts.fromDate)}` : "") +
    (opts?.toDate ? `&toDate=${encodeURIComponent(opts.toDate)}` : "");

  const raw = await nseClient.get<any[]>(path);

  if (!Array.isArray(raw)) {
    throw new Error(
      `Expected array from filings API for ${symbol}, got ${typeof raw}`,
    );
  }

  return raw
    .map((r) => ({
      symbol: r.symbol,
      companyName: r.companyName,
      relatingTo: r.relatingTo,
      financialYear: r.financialYear,
      fromDate: r.fromDate,
      toDate: r.toDate,
      filingDate: r.filingDate,
      xbrl: r.xbrl,
      consolidated: r.consolidated,
      bank: r.bank,
      audited: r.audited,
      indAs: r.indAs,
      isin: r.isin,
      seqNumber: r.seqNumber,
      _raw: r,
    }))
    .filter((entry) => {
      // NSE sometimes returns placeholder rows with xbrl="-".
      // Skip them at the source.
      if (!entry.xbrl || entry.xbrl === "-" || entry.xbrl.endsWith("/-")) {
        return false;
      }
      return true;
    });
}

export async function fetchXbrlFile(xbrlUrl: string): Promise<string> {
  if (!xbrlUrl || xbrlUrl === "-" || !xbrlUrl.startsWith("http")) {
    throw new Error(`Invalid XBRL URL: ${xbrlUrl}`);
  }

  try {
    return await httpsGetString(xbrlUrl);
  } catch (err) {
    await sleep(2000);
    return httpsGetString(xbrlUrl);
  }
}

function httpsGetString(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: XBRL_HEADERS,
        agent: new https.Agent({
          keepAlive: false,
          maxSockets: 1,
        }),
      },
      (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          req.destroy();
          return reject(new Error(`XBRL fetch ${res.statusCode} on ${url}`));
        }

        const chunks: Buffer[] = [];

        res.on("data", (c: Buffer) => chunks.push(c));

        res.on("end", () => {
          req.destroy();
          resolve(Buffer.concat(chunks).toString("utf-8"));
        });

        res.on("error", (err) => {
          req.destroy();
          reject(err);
        });
      },
    );

    req.on("error", reject);

    req.setTimeout(30_000, () => {
      req.destroy(new Error(`XBRL fetch timed out: ${url}`));
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Helpers (v2 discovery shape)
// ─────────────────────────────────────────────────────────────

export function pickBestFilingForQuarter(
  filings: any[],
  fromDate: string,
  toDate: string,
): any | null {
  const candidates = filings.filter(
    (f) => f.fromDate === fromDate && f.toDate === toDate,
  );
  if (candidates.length === 0) return null;

  const consolidated = candidates.filter(
    (f) => f.consolidated === "Consolidated",
  );
  const pool = consolidated.length > 0 ? consolidated : candidates;

  return pool.reduce((best: any, cur: any) =>
    parseNseFilingDate(cur.filingDate) > parseNseFilingDate(best.filingDate)
      ? cur
      : best,
  );
}

// ─────────────────────────────────────────────────────────────
// DUAL-BASIS pick, v2-shaped. The sibling of picker.ts's
// `pickFilingsPerBasis` (v3 / NseFilingEntry) for the v2 listing shape this
// module returns.
//
// ★ WHY THIS EXISTS. `pickBestFilingForQuarter` above returns ONE filing per
//   period and prefers Consolidated when both bases are filed. Foundation reads
//   STANDALONE ONLY (scoring/metrics/types.ts:7-11) and never falls back — so on
//   every period where a company filed both, the legacy backfill fetched the
//   consolidated document and the standalone one was never retrieved. MEASURED
//   2026-08-16: the legacy path wrote 7% standalone (44 of 646 annual rows)
//   against the v3 path's 52% (781 of 1515) over the same universe and source.
//
// ⚠ `pickBestFilingForQuarter` is DELIBERATELY LEFT IN PLACE and unchanged — it
//   is still exported and is the reference for the pre-fix behaviour.
//
// Basis mapping mirrors the parser exactly (parser-legacy-common.ts:185,420):
//   `consolidated === "Consolidated"` → consolidated; everything else, including
//   a null, → standalone.
//
// Within a basis the winner is the LATEST filingDate — identical to the reduce in
// `pickBestFilingForQuarter`, so a period that has only one basis is picked exactly
// as before (COLPAL files standalone only; SUNPHARMA FY21 had no consolidated).
// The v2 listing carries no `typeSub`, so there is no Revision > New > Original
// rank to apply here as the v3 picker does.
//
// Returns [] when nothing matches the period; otherwise 1 entry (one basis filed)
// or 2 (both filed). Order is standalone-first for reproducible logs.
export interface BasisPickV2 {
  filing: any;
  basis: "standalone" | "consolidated";
}

export function pickFilingsPerBasisV2(
  filings: any[],
  fromDate: string,
  toDate: string,
): BasisPickV2[] {
  const candidates = filings.filter(
    (f) => f.fromDate === fromDate && f.toDate === toDate,
  );
  if (candidates.length === 0) return [];

  const byBasis = new Map<"standalone" | "consolidated", any[]>();
  for (const c of candidates) {
    const basis: "standalone" | "consolidated" =
      c.consolidated === "Consolidated" ? "consolidated" : "standalone";
    const arr = byBasis.get(basis);
    if (arr) arr.push(c);
    else byBasis.set(basis, [c]);
  }

  const picks: BasisPickV2[] = [];
  for (const [basis, pool] of byBasis) {
    const winner = pool.reduce((best: any, cur: any) =>
      parseNseFilingDate(cur.filingDate) > parseNseFilingDate(best.filingDate)
        ? cur
        : best,
    );
    picks.push({ filing: winner, basis });
  }

  return picks.sort((a, b) => (a.basis === "standalone" ? -1 : 1));
}

export function groupFilingsByQuarter(filings: any[]): Map<string, any[]> {
  const byQuarter = new Map<string, any[]>();
  for (const f of filings) {
    const key = `${f.fromDate}|${f.toDate}`;
    const arr = byQuarter.get(key);
    if (arr) arr.push(f);
    else byQuarter.set(key, [f]);
  }
  return byQuarter;
}

export function filingsSince(filings: any[], hoursBack: number): any[] {
  const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
  return filings.filter(
    (f) => parseNseFilingDate(f.filingDate).getTime() >= cutoff,
  );
}

export function parseNseFilingDate(s: string): Date {
  const MONTHS: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  const m = s
    .trim()
    .match(/^(\d{1,2})-(\w{3})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (!m) return new Date(NaN);

  const [, d, mon, y, h, mi, sec] = m;

  return new Date(
    Date.UTC(
      parseInt(y),
      MONTHS[mon] ?? 0,
      parseInt(d),
      parseInt(h),
      parseInt(mi),
      sec ? parseInt(sec) : 0,
    ),
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
