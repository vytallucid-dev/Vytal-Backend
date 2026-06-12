// ─────────────────────────────────────────────────────────────
// Fetches bulk + block deals from NSE.
//
// Two NSE endpoints in use:
//   1. /api/snapshot-capital-market-largedeal
//        — today's deals only, no params, used by the daily cron
//   2. /api/historicalOR/bulk-block-short-deals
//        — historical, accepts ?optionType=&from=&to= params
//        — max 365 days per request, replaces the old
//          /api/historical/cm/equity/largedeal endpoint (which 404s)
//
// Note: the capital "OR" in "historicalOR" is intentional — it's NSE's
// actual path, do not normalise to "historical".
// ─────────────────────────────────────────────────────────────

import { nseClient } from "../../lib/client.js";

// ── NSE response types ────────────────────────────────────────

/** Today's snapshot endpoint — old shape, kept as-is. */
interface NseDealRaw {
  date: string; // "27-Mar-2026"
  symbol: string;
  name: string;
  clientName: string | null;
  buySell: "BUY" | "SELL" | null;
  qty: string;
  watp: string | null;
  remarks: string | null;
}

interface NseDealsResponse {
  as_on_date: string;
  BULK_DEALS_DATA: NseDealRaw[];
  BLOCK_DEALS_DATA: NseDealRaw[];
  SHORT_DEALS_DATA: NseDealRaw[];
  BULK_DEALS: string;
  BLOCK_DEALS: string;
  SHORT_DEALS: string;
}

/**
 * Historical endpoint — new shape from /api/historicalOR/bulk-block-short-deals.
 * Same `BD_*` prefix for both bulk and block deal types.
 */
interface NseHistoricalDealRaw {
  BD_DT_DATE: string; // "24-APR-2026" (uppercase month)
  BD_DT_ORDER: string; // "2026-04-23T18:30:00.000+00:00" (ignored)
  BD_SYMBOL: string;
  BD_SCRIP_NAME: string;
  BD_CLIENT_NAME: string;
  BD_BUY_SELL: "BUY" | "SELL";
  BD_QTY_TRD: number; // native number (not string anymore)
  BD_TP_WATP: number;
  BD_REMARKS: string | null;
}

interface NseHistoricalDealsResponse {
  data: NseHistoricalDealRaw[];
}

// ── Transformed deal (ready for DB) ───────────────────────────

export interface DealRecord {
  symbol: string;
  dealDate: Date;
  dealType: "bulk" | "block";
  clientName: string;
  transactionType: "buy" | "sell";
  quantity: bigint;
  price: number;
  valueCr: number;
  remarks: string | null;
}

// ── Helpers ───────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

/**
 * Parse NSE date strings. Tolerates both "27-Mar-2026" (today endpoint)
 * and "27-APR-2026" (historical endpoint) — case-insensitive month lookup.
 */
function parseNseDate(s: string): Date {
  const parts = s.split("-");
  if (parts.length !== 3) throw new Error(`Cannot parse NSE date: ${s}`);
  const [day, mon, year] = parts;
  const m = MONTH_MAP[mon.toUpperCase()];
  if (m === undefined) throw new Error(`Unknown month: ${mon}`);
  return new Date(Date.UTC(parseInt(year), m, parseInt(day)));
}

/** Format a JS Date as "DD-Mon-YYYY" — used by today's snapshot endpoint. */
export function toNseDate(d: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mon = months[d.getUTCMonth()];
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mon}-${yyyy}`;
}

/**
 * Format a JS Date as "DD-MM-YYYY" numeric — used by the historical endpoint.
 * Different from toNseDate(); historical endpoint does NOT accept Mon names.
 */
export function toNseHistoricalDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

const stripNulls = (s: string) => s.replace(/\0/g, "");

/** Transformer for today's snapshot endpoint (old shape). */
function transformDealLegacy(
  raw: NseDealRaw,
  dealType: "bulk" | "block",
): DealRecord | null {
  if (!raw.clientName || !raw.buySell || !raw.watp || !raw.qty) return null;
  if (!raw.symbol || !raw.date) return null;

  const qty = BigInt(raw.qty);
  const price = parseFloat(raw.watp);
  if (isNaN(price) || price <= 0) return null;

  const valueCr = (Number(qty) * price) / 1e7;

  return {
    symbol: stripNulls(raw.symbol.trim().toUpperCase()),
    dealDate: parseNseDate(raw.date),
    dealType,
    clientName: stripNulls(raw.clientName.trim()),
    transactionType: raw.buySell === "BUY" ? "buy" : "sell",
    quantity: qty,
    price,
    valueCr: Math.round(valueCr * 10000) / 10000,
    remarks:
      raw.remarks && raw.remarks !== "-" ? stripNulls(raw.remarks) : null,
  };
}

/** Transformer for the historical endpoint (BD_* shape). */
function transformDealHistorical(
  raw: NseHistoricalDealRaw,
  dealType: "bulk" | "block",
): DealRecord | null {
  // Validate critical fields
  if (!raw.BD_SYMBOL || !raw.BD_DT_DATE || !raw.BD_BUY_SELL) return null;
  if (!raw.BD_CLIENT_NAME || !raw.BD_QTY_TRD) return null;
  if (raw.BD_TP_WATP == null || raw.BD_TP_WATP <= 0) return null;

  // BD_QTY_TRD is a number — convert to BigInt safely
  // For very large quantities, prefer BigInt(string) over BigInt(number) to avoid
  // precision loss above Number.MAX_SAFE_INTEGER. NSE quantities are well within
  // safe range but defensive coding is cheap.
  const qty = BigInt(Math.round(raw.BD_QTY_TRD));
  const price = raw.BD_TP_WATP;
  const valueCr = (Number(qty) * price) / 1e7;

  return {
    symbol: stripNulls(raw.BD_SYMBOL.trim().toUpperCase()),
    dealDate: parseNseDate(raw.BD_DT_DATE),
    dealType,
    clientName: stripNulls(raw.BD_CLIENT_NAME.trim()),
    transactionType: raw.BD_BUY_SELL === "BUY" ? "buy" : "sell",
    quantity: qty,
    price,
    valueCr: Math.round(valueCr * 10000) / 10000,
    remarks:
      raw.BD_REMARKS && raw.BD_REMARKS !== "-"
        ? stripNulls(raw.BD_REMARKS)
        : null,
  };
}

// ── Fetchers ──────────────────────────────────────────────────

/**
 * Fetch today's bulk + block deals.
 * Uses /api/snapshot-capital-market-largedeal (unchanged endpoint).
 * NSE publishes after ~6 PM IST — run this cron at 7:30 PM.
 */
export async function fetchDailyDeals(): Promise<{
  deals: DealRecord[];
  rawBulk: number;
  rawBlock: number;
}> {
  const data = await nseClient.get<NseDealsResponse>(
    "/api/snapshot-capital-market-largedeal",
  );

  const deals: DealRecord[] = [];
  let rawBulk = 0;
  let rawBlock = 0;

  for (const raw of data.BULK_DEALS_DATA ?? []) {
    rawBulk++;
    const deal = transformDealLegacy(raw, "bulk");
    if (deal) deals.push(deal);
  }

  for (const raw of data.BLOCK_DEALS_DATA ?? []) {
    rawBlock++;
    const deal = transformDealLegacy(raw, "block");
    if (deal) deals.push(deal);
  }

  return { deals, rawBulk, rawBlock };
}

/**
 * Fetch historical deals for a date range.
 * Endpoint: /api/historicalOR/bulk-block-short-deals
 * Max range: 365 days per request. We don't chunk here — the caller
 * decides whether to call this once for a year or multiple times.
 */
export async function fetchHistoricalDeals(
  from: Date,
  to: Date,
  dealType: "bulk" | "block",
): Promise<DealRecord[]> {
  const optionType = dealType === "bulk" ? "bulk_deals" : "block_deals";
  const fromStr = toNseHistoricalDate(from);
  const toStr = toNseHistoricalDate(to);

  const path =
    `/api/historicalOR/bulk-block-short-deals` +
    `?optionType=${optionType}&from=${fromStr}&to=${toStr}`;

  const data = await nseClient.get<NseHistoricalDealsResponse>(path);

  const deals: DealRecord[] = [];
  for (const raw of data.data ?? []) {
    const deal = transformDealHistorical(raw, dealType);
    if (deal) deals.push(deal);
  }

  return deals;
}

/**
 * Backfill deals for the last N days.
 *
 * NSE's historical endpoint accepts up to 365 days per request, so we no
 * longer chunk by 7-day windows. One request per dealType, sequential.
 *
 * For ranges > 365 days, callers should call this multiple times with
 * different date windows themselves.
 */
export async function backfillDeals(daysBack = 365): Promise<DealRecord[]> {
  if (daysBack > 365) {
    throw new Error(
      `backfillDeals supports up to 365 days per call. ` +
        `For longer ranges, call repeatedly with different windows. Got ${daysBack}.`,
    );
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - daysBack);

  console.log(
    `[backfillDeals] Fetching ${daysBack} days: ${toNseHistoricalDate(from)} → ${toNseHistoricalDate(today)}`,
  );

  // Sequential — NSE rate-limits aggressive concurrent calls.
  // Two requests total (bulk + block), with the client's built-in delay.
  const allDeals: DealRecord[] = [];

  try {
    const bulk = await fetchHistoricalDeals(from, today, "bulk");
    console.log(`[backfillDeals] bulk: ${bulk.length} records`);
    allDeals.push(...bulk);
  } catch (e) {
    console.error(`[backfillDeals] bulk fetch failed:`, e);
  }

  try {
    const block = await fetchHistoricalDeals(from, today, "block");
    console.log(`[backfillDeals] block: ${block.length} records`);
    allDeals.push(...block);
  } catch (e) {
    console.error(`[backfillDeals] block fetch failed:`, e);
  }

  console.log(`[backfillDeals] Total deals fetched: ${allDeals.length}`);
  return allDeals;
}
