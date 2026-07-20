// ─────────────────────────────────────────────────────────────
// THE TRUST VIEW over the NSE udiff BhavCopy (Step 14; re-based on the shared reader in 14.5).
//
// WHY THE udiff AND NOT THE FILE THE PRICE PIPELINE ALREADY READS:
// The equity pipeline reads `sec_bhavdata_full_DDMMYYYY.csv`. Gate-0 recon measured it live: it
// carries SERIES (so it CAN see RR/IV) but it has NO ISIN COLUMN. Our catalogue's spine is the
// ISIN. Resolving a trust's ISIN from that file would mean joining on something else — and the
// obvious candidates all fail:
//   · EQUITY_L.csv (the master security list) has ISINs but contains ZERO RR/IV rows (EQ/BE/BZ
//     only). 0 of 17 resolve. It is not a REIT source at all.
//   · The BSE bhavcopy has ISINs, and a name-match against it "resolves ~13 of 17" — which is how
//     the pre-build recon concluded ANZEN/NHIT/VERTIS were no-ISIN honest gaps. They are NOT. They
//     are simply not BSE-listed. Worse, that join is ACTIVELY DANGEROUS: BSE lists NHIT only as
//     BONDS (79NHIT35 → INE0H7R07017), so a name-match would have silently attached a BOND's ISIN
//     to an InvIT — a wrong instrument, which is the one outcome the ISIN spine exists to prevent.
//
// The udiff carries ISIN + SctySrs + ClsPric + FinInstrmNm IN ONE FILE. All trusts resolve, all
// INE-prefixed, no join, no guessing, no gaps.
//
// 14.5 moved the FETCH/PARSE into shared/udiff-bhavcopy.ts — the same file is now also read by the
// ETF price lane. This module keeps exactly one job: the TRUST-shaped view of it (series RR/IV).
// Behaviour is unchanged; nothing here decides policy, it only reshapes.
// ─────────────────────────────────────────────────────────────
import {
  parseUdiff as parseUdiffRaw,
  type UdiffRow,
} from "../shared/udiff-bhavcopy.js";
import { SERIES_TO_CLASS, TRUST_SERIES, type TrustSeries, type TrustClass } from "./reit-guards.js";

// Re-exported so Step 14's callers (ingest-reits, the recon/verify scripts) keep working unchanged.
export { fetchUdiff, udiffUrl, weekdaysBack } from "../shared/udiff-bhavcopy.js";

/** One RR/IV row: identity (isin/symbol/name/class) AND the day's OHLCV, from the same line. */
export interface TrustRow {
  isin: string;
  symbol: string;
  name: string;
  series: TrustSeries;
  assetClass: TrustClass;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number | null;
  volume: bigint;
  /** ₹ Cr. */
  tradedValue: number | null;
}

/** A row that IS an RR/IV security but whose values we refuse to trust. Becomes an IngestionError. */
export interface MalformedRow {
  symbol: string;
  isin: string;
  series: string;
  why: string;
  observed: string;
}

export type UdiffParse =
  | { ok: true; header: string[]; rows: TrustRow[]; totalRows: number; malformed: MalformedRow[] }
  | { ok: false; reason: "unzip" | "empty"; observed: string };

const toTrustRow = (r: UdiffRow): TrustRow => ({
  isin: r.isin,
  symbol: r.symbol,
  name: r.name,
  series: r.series as TrustSeries,
  assetClass: SERIES_TO_CLASS[r.series as TrustSeries],
  open: r.open,
  high: r.high,
  low: r.low,
  close: r.close,
  prevClose: r.prevClose,
  volume: r.volume,
  tradedValue: r.tradedValue,
});

/**
 * Parse the udiff body down to the RR/IV rows.
 *
 * Returns the header separately so the CALLER runs the shape guard (guards decide, sources report).
 * A row that is an RR/IV security but carries an unusable ISIN or close is NOT silently dropped: it
 * comes back in `malformed` so the ingest can raise a validity fault against it.
 */
export function parseUdiff(buffer: Buffer): UdiffParse {
  const raw = parseUdiffRaw(buffer);
  if (!raw.ok) return raw;

  const rows: TrustRow[] = [];
  const malformed: MalformedRow[] = [];

  for (const r of raw.rows) {
    if (!TRUST_SERIES.includes(r.series as TrustSeries)) continue; // not a trust — not our business
    if (!r.usable) {
      malformed.push({
        symbol: r.symbol,
        isin: r.isin,
        series: r.series,
        why: `${r.why} on an RR/IV row`,
        observed: r.observed ?? "(unknown)",
      });
      continue;
    }
    rows.push(toTrustRow(r));
  }

  return { ok: true, header: raw.header, rows, totalRows: raw.totalRows, malformed };
}
