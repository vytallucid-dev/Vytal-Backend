// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BSE AS THE FALLBACK LANE.  When NSE does not have it, ask the other exchange.
//
// ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
// `results_scan` reads NSE and only NSE. MEASURED with TCS as the control: NSE's integrated-filing
// API returns 12 filings for TCS and ZERO for ABBOTINDIA, BAYERCROP and MCX — on both the v2 and v3
// endpoints, and its shareholding API returns 20 quarters for TCS and 0 for them. Three large,
// actively traded companies were therefore silently empty for months. GUARD 6 in scan.ts now names
// that condition honestly; this module is what does something about it.
//
// BSE has the same filings: 138 / 141 / 85 respectively. One exchange missing a company is not the
// same as the company not filing, and the second exchange is a lane this codebase already owns,
// already fences and already paces.
//
// ── WHEN IT RUNS ─────────────────────────────────────────────────────────────────────────────────
// AFTER the NSE pass, and only for periods still missing inside a recent window. That ordering is
// deliberate:
//   · NSE always wins. The BSE writer is INSERT … ON CONFLICT DO NOTHING plus a NULL-ONLY fill, so
//     it can add a period NSE lacks and fill a column NSE left null, but it can never overwrite an
//     NSE value. Running it second makes that guarantee structural rather than a matter of timing.
//   · Gaps, not history. A daily job must not re-attempt seven years of filings for 500 stocks. The
//     window bounds the work to what could plausibly have just been filed, so the cost is
//     proportional to actual gaps — nearly always zero requests.
//
// ⚠ THIS IS NOT A BACKFILL. Deep history is the job of stage8-bse-sweep.ts, which is chunked,
//   ledgered, resumable and fence-checked per chunk. This runs inside a daily scan, so it stays
//   small on purpose.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { BsePacer, ThrottleStopError } from "./bse/bse-http.js";
import { fetchScripMaster, resolveAgainstMaster } from "./bse/bse-resolver.js";
import { runBseBackfill, type BseTarget } from "./bse/backfill-bse.js";

/** How far back a daily fallback will reach. Eight quarters covers a late or revised filing. */
const DEFAULT_WINDOW_QUARTERS = 8;

const QT: Record<string, string> = {
  non_financial: "quarterly_results", banking: "banking_quarterly_results", nbfc: "nbfc_quarterly_results",
  life_insurance: "life_insurance_quarterly_results", general_insurance: "general_insurance_quarterly_results",
};
const AT: Record<string, string> = {
  non_financial: "fundamentals", banking: "banking_fundamentals", nbfc: "nbfc_fundamentals",
  life_insurance: "life_insurance_fundamentals", general_insurance: "general_insurance_fundamentals",
};

export interface BseFallbackResult {
  symbol: string;
  attempted: number;
  written: number;
  outcomes: Record<string, number>;
  /** Set when the stock is not on BSE at all (CDSL, for instance, is NSE-only). */
  unresolved: boolean;
  skippedReason?: string;
}

/** Quarter ends, ascending, within [from, to]. */
function quarterEnds(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const y0 = from.getUTCFullYear() - 1;
  const y1 = to.getUTCFullYear() + 1;
  for (let y = y0; y <= y1; y++)
    for (const [m, d] of [[3, 31], [6, 30], [9, 30], [12, 31]] as [number, number][]) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt >= from && dt <= to) out.push(dt);
    }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** A shared master is fetched at most once per process — it is ~10,800 rows and does not move. */
let masterCache: Awaited<ReturnType<typeof fetchScripMaster>> | null = null;

/**
 * Fill periods NSE did not serve, for ONE stock, from BSE.
 *
 * Safe to call unconditionally after an NSE scan: with no gaps it issues no BSE requests at all.
 */
export async function runBseFallbackForStock(
  stock: { id: string; symbol: string; industryType: string },
  opts: { windowQuarters?: number; asOf?: Date; pacer?: BsePacer; log?: (s: string) => void } = {},
): Promise<BseFallbackResult> {
  const log = opts.log ?? (() => {});
  const asOf = opts.asOf ?? new Date();
  const windowQ = opts.windowQuarters ?? DEFAULT_WINDOW_QUARTERS;
  const empty: BseFallbackResult = { symbol: stock.symbol, attempted: 0, written: 0, outcomes: {}, unresolved: false };

  const qTable = QT[stock.industryType] ?? QT.non_financial;
  const aTable = AT[stock.industryType] ?? AT.non_financial;

  // ── which recent periods are missing? ────────────────────────────────────────────────────────
  // ⚠ The horizon is the newest period the UNIVERSE holds, not today. Demanding the current quarter
  //   from a company that has not filed yet would send a BSE request for every stock, every day,
  //   for a filing that does not exist.
  const horizonRow = await prisma.$queryRawUnsafe<Array<{ d: Date | null }>>(
    `SELECT max(report_date) d FROM "${qTable}"`);
  const horizon = horizonRow[0]?.d ?? null;
  if (!horizon) return { ...empty, skippedReason: "no rows in the table at all — nothing to bound a window with" };

  const from = new Date(horizon);
  from.setUTCMonth(from.getUTCMonth() - 3 * (windowQ - 1));
  const want = quarterEnds(from, horizon);
  if (want.length === 0) return empty;

  const heldQ = new Set(
    (await prisma.$queryRawUnsafe<Array<{ d: string }>>(
      `SELECT DISTINCT report_date::date::text d FROM "${qTable}" WHERE stock_id = $1`, stock.id)).map((r) => r.d));
  const heldA = new Set(
    (await prisma.$queryRawUnsafe<Array<{ d: string }>>(
      `SELECT DISTINCT report_date::date::text d FROM "${aTable}" WHERE stock_id = $1`, stock.id)).map((r) => r.d));

  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const missQ = want.filter((d) => !heldQ.has(iso(d)));
  const missA = want.filter((d) => iso(d).endsWith("-03-31") && !heldA.has(iso(d)));
  if (missQ.length === 0 && missA.length === 0) return empty;   // ← the common case: no BSE request

  // ── resolve the scrip only once we know there is work ────────────────────────────────────────
  const pacer = opts.pacer ?? new BsePacer({ minSpacingMs: 4000, throttleStopMs: 90_000, slowMs: 8_000, maxSpacingMs: 20_000 });
  if (!masterCache) masterCache = await fetchScripMaster(pacer);
  const meta = await prisma.stock.findUnique({ where: { id: stock.id }, select: { isin: true } });
  const res = resolveAgainstMaster([{ symbol: stock.symbol, isin: meta?.isin ?? "" }], masterCache);
  const scrip = res.resolved[0];
  if (!scrip) {
    log(`[BSE fallback] ${stock.symbol}: not on BSE (NSE-only listing) — nothing to fall back to`);
    return { ...empty, unresolved: true };
  }

  const targets: BseTarget[] = [
    ...missQ.map((periodEnd) => ({ symbol: stock.symbol, stockId: stock.id, scripCode: scrip.scripCode,
      grain: "quarterly" as const, periodEnd, basis: "standalone" as const, industryType: stock.industryType })),
    ...missA.map((periodEnd) => ({ symbol: stock.symbol, stockId: stock.id, scripCode: scrip.scripCode,
      grain: "annual" as const, periodEnd, basis: "standalone" as const, industryType: stock.industryType })),
  ];

  log(`[BSE fallback] ${stock.symbol}: NSE left ${targets.length} period(s) unserved in the last ${windowQ} quarters — asking BSE`);
  try {
    const summary = await runBseBackfill(prisma, targets, {
      dryRun: false,
      ledgerFile: `bse-fallback-${stock.symbol}.jsonl`,
      chunkSize: targets.length,
      pacer,
      log: () => {},   // the daily scan has its own logging; the summary below is what matters
    });
    const written = summary.outcomes.written ?? 0;
    log(`[BSE fallback] ${stock.symbol}: ${JSON.stringify(summary.outcomes)}`);
    return { symbol: stock.symbol, attempted: targets.length, written, outcomes: summary.outcomes, unresolved: false };
  } catch (e) {
    // ⚠ A throttle stop ends the FALLBACK, never the NSE scan that called it. The fallback is an
    //   improvement on the primary lane's result; it must not be able to fail the primary lane.
    if (e instanceof ThrottleStopError) {
      log(`[BSE fallback] ${stock.symbol}: BSE throttled — leaving the gap for the next run`);
      return { ...empty, attempted: targets.length, skippedReason: "throttled" };
    }
    log(`[BSE fallback] ${stock.symbol}: ${e instanceof Error ? e.message : String(e)}`);
    return { ...empty, attempted: targets.length, skippedReason: e instanceof Error ? e.message : String(e) };
  }
}
