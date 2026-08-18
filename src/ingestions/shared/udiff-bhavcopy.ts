// ─────────────────────────────────────────────────────────────
// THE NSE udiff BhavCopy — a SHARED source (Step 14.5).
//
// Extracted from reit-source.ts, unchanged in behaviour, because it now has TWO readers:
//   · the TRUST lane  (series RR/IV) — identity + price + distribution yield  [Step 14]
//   · the ETF PRICE lane (series EQ, INF ISINs) — the traded close of a listed fund  [Step 14.5]
//
// It is the only NSE file that carries ISIN + series + close TOGETHER, which is what lets a
// non-stock instrument join the catalogue on the ISIN spine with no symbol-matching and no
// guessing. (The equity pipeline's sec_bhavdata_full has NO ISIN column at all — see reit-source.)
//
// This module is a READER, not a policy: it fetches, unzips, parses and reports SHAPE. What counts
// as a valid row, which series matter, and what to do about a bad one are the CALLER's business.
// ─────────────────────────────────────────────────────────────
import https from "https";
import AdmZip from "adm-zip";
import {
  checkSessionDate,
  parseIsoDay,
  type SessionDateMismatch,
} from "./session-date.js";

/** NSE publishes the modern full CM bhavcopy under this name, one file per trading day. */
export function udiffUrl(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${y}${m}${d}_F_0000.csv.zip`;
}

/** Provenance tag written onto every price row this file produces. */
export const UDIFF_PROVIDER = "nse-udiff-bhavcopy";
export const UDIFF_SOURCE = "nse_udiff_bhavcopy";

// ── GUARD 1: SHAPE ──
// The EXACT columns any reader of this file depends on. A rename means our fields point at the
// wrong data — an ISIN read out of a price column is a WRONG INSTRUMENT — so a caller REJECTS
// rather than parse through it.
//
// ★ TradDt IS ASSERTED for the same reason the equity lane asserts DATE1: it is the
//   file's own statement of which session it holds, and `checkUdiffTradeDate` rejects
//   the file when it disagrees with the date we requested. If the column vanished,
//   that check would have nothing to compare and would degrade to "accept" — so its
//   absence must fail here as a shape break. Format is MEASURED: "2026-08-13" (ISO),
//   which is a THIRD format, different from both sibling archives.
export const UDIFF_REQUIRED_COLUMNS = [
  "ISIN",
  "TckrSymb",
  "SctySrs",
  "FinInstrmNm",
  "TradDt",
  "OpnPric",
  "HghPric",
  "LwPric",
  "ClsPric",
  "PrvsClsgPric",
  "TtlTradgVol",
] as const;

/** Returns the required columns MISSING from the header ([] = ok). */
export function checkUdiffShape(headerCols: string[]): string[] {
  return UDIFF_REQUIRED_COLUMNS.filter((c) => !headerCols.includes(c));
}

export interface UdiffFetch {
  status: number;
  buffer: Buffer;
  bytes: number;
  url: string;
}

export function fetchUdiff(date: Date, hop = 0, url = udiffUrl(date)): Promise<UdiffFetch> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/zip,text/csv,application/octet-stream,*/*",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const loc = res.headers.location;
        if (status >= 300 && status < 400 && loc) {
          res.resume(); // drain, or the socket leaks
          if (hop >= 3) {
            reject(new Error("NSE udiff bhavcopy: too many redirects"));
            return;
          }
          fetchUdiff(date, hop + 1, new URL(loc, url).toString()).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({ status, buffer, bytes: buffer.length, url });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("NSE udiff bhavcopy: timed out")));
  });
}

/** One raw security row, series-agnostic. The caller decides which series it cares about. */
export interface UdiffRow {
  isin: string;
  symbol: string;
  name: string;
  series: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number | null;
  volume: bigint;
  /** ₹ Cr. NSE publishes TtlTrfVal in RUPEES (the equity path's TURNOVER_LACS is in lakhs — a
   *  different file and a different unit; getting this wrong by 1e5 is a silent, plausible error). */
  tradedValue: number | null;
  /** false ⇒ the row IS a security but its ISIN or OHLC is unusable. The caller raises a fault;
   *  we do NOT silently drop it, because a silent drop is how a universe quietly shrinks. */
  usable: boolean;
  why?: string;
  observed?: string;
}

export type UdiffParse =
  | {
      ok: true;
      header: string[];
      rows: UdiffRow[];
      totalRows: number;
      /** Raw TradDt of every data row. Input to `checkUdiffTradeDate`. */
      tradDates: string[];
    }
  | { ok: false; reason: "unzip" | "empty"; observed: string };

const num = (s: string | undefined): number => Number.parseFloat((s ?? "").replace(/,/g, ""));

/** Unzip + parse EVERY row. No series filter, no validity policy — that is the caller's job. */
export function parseUdiff(buffer: Buffer): UdiffParse {
  let text: string;
  try {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntries().find((e) => /\.csv$/i.test(e.name));
    if (!entry) return { ok: false, reason: "unzip", observed: "no .csv inside the zip" };
    text = entry.getData().toString("utf8");
  } catch (err) {
    return { ok: false, reason: "unzip", observed: (err as Error).message };
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = (lines[0] ?? "").split(",").map((s) => s.trim());
  if (lines.length <= 1) return { ok: false, reason: "empty", observed: "0 data rows" };

  const idx = new Map(header.map((h, i) => [h, i]));
  const cell = (c: string[], k: string) => (c[idx.get(k) ?? -1] ?? "").trim();

  const rows: UdiffRow[] = [];
  const tradDates: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i]!.split(",").map((s) => s.trim());

    // Session-date input, collected before any usability filter — a mixed-date file
    // must be detectable even if the disagreeing rows are ones we would discard.
    const td = cell(c, "TradDt");
    if (td) tradDates.push(td);

    const isin = cell(c, "ISIN");
    const symbol = cell(c, "TckrSymb");
    const name = cell(c, "FinInstrmNm");
    const series = cell(c, "SctySrs");
    const close = num(cell(c, "ClsPric"));
    const open = num(cell(c, "OpnPric"));
    const high = num(cell(c, "HghPric"));
    const low = num(cell(c, "LwPric"));
    const prevClose = num(cell(c, "PrvsClsgPric"));
    const vol = num(cell(c, "TtlTradgVol"));
    const trfVal = num(cell(c, "TtlTrfVal"));

    const base = {
      isin,
      symbol,
      name,
      series,
      open,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
      prevClose: Number.isFinite(prevClose) && prevClose > 0 ? prevClose : null,
      volume: BigInt(Number.isFinite(vol) ? Math.max(0, Math.trunc(vol)) : 0),
      tradedValue: Number.isFinite(trfVal) ? Math.round((trfVal / 1e7) * 10_000) / 10_000 : null,
    };

    if (!isin) {
      rows.push({ ...base, usable: false, why: "no ISIN on the row", observed: "(blank)" });
      continue;
    }
    if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(open)) {
      rows.push({
        ...base,
        usable: false,
        why: "unreadable OHLC",
        observed: `open=${cell(c, "OpnPric")} close=${cell(c, "ClsPric")}`,
      });
      continue;
    }
    rows.push({ ...base, usable: true });
  }

  return { ok: true, header, rows, totalRows: rows.length, tradDates };
}

/**
 * Is this udiff file actually the session we asked for?
 *
 * ⚠ A MISMATCH IS "NOT A SESSION", NOT "BAD FILE". The four consumer lanes treat a
 *   `parseUdiff` failure as a CRITICAL shape fault that aborts the entire run. A
 *   stale or wrong-dated file must NOT do that — it means exactly what a 404 means
 *   ("no session on this date, step back a day"), and aborting the run on the first
 *   holiday would be a far worse regression than the bug being fixed. That is why
 *   this is a SEPARATE predicate returning a verdict, rather than an `ok: false`
 *   variant of UdiffParse: the two outcomes are not interchangeable.
 *
 * MEASURED 2026-08-15: this archive returns 404 on a non-session date, so today the
 * check should never fire in production. It exists so the lanes stop DEPENDING on
 * that — see session-date.ts.
 */
export function checkUdiffTradeDate(
  tradDates: string[],
  requested: Date,
): SessionDateMismatch | null {
  return checkSessionDate(tradDates, requested, parseIsoDay);
}

/**
 * Candidate session dates walking back from `from`, newest first.
 *
 * ★ WEEKENDS ARE INCLUDED, DELIBERATELY. This used to skip Saturday and Sunday, which
 *   made a genuine weekend session UNREACHABLE — NSE does hold them (the Budget
 *   Saturday of 01-02-2025 is a real session sitting in daily_prices right now, and
 *   muhurat sessions can land on a weekend). The skip was a cheap proxy for "no file
 *   exists on a non-trading day"; the session-date check is the real test, so the
 *   proxy is no longer needed and its false negatives are no longer worth paying for.
 *
 * ⚠ COST: a weekend day costs one 404, measured at ~120-300ms and rejected before any
 *   parse. Callers that previously passed a WEEKDAY count must scale it — see each
 *   lane's MAX_WALK_BACK, all raised by 7/5 to preserve the same trading-day reach.
 */
export function calendarDaysBack(from: Date, n: number): Date[] {
  const out: Date[] = [];
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    out.push(new Date(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

/**
 * @deprecated WEEKDAY-ONLY walk. **Do not use in any ingest path** — it cannot see a
 * genuine weekend session (see `calendarDaysBack`, which replaced it everywhere in
 * ingestions/ and portfolio/).
 *
 * Kept, unchanged, for the archived `scripts/recon-step15*` / `recon-step17*` /
 * `probe-step17*` one-offs ONLY. Those scripts' recorded outputs are cited in the
 * recon write-ups; repointing them at a calendar walk would change which days they
 * sample and quietly make those recorded runs irreproducible. Preserving the old
 * behaviour behind a deprecated name is the honest option — the rename is what
 * surfaces the distinction rather than hiding it.
 */
export function weekdaysBack(from: Date, n: number): Date[] {
  const out: Date[] = [];
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}
