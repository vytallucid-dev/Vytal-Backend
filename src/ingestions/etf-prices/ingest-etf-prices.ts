// ─────────────────────────────────────────────────────────────
// ETF MARKET PRICES (Step 14.5) — the TRADED close of a listed fund.
//
// WHY THIS EXISTS. Step 13 gave every ETF an AMFI **NAV**. A NAV is what a unit is WORTH; it is
// not what you would GET for it. A listed ETF trades at a premium or a discount to its NAV — that
// spread is real, is sometimes several percent on an illiquid one, and is occasionally enormous.
// Valuing a user's ETF holding at NAV therefore states a number they cannot transact at. The
// honest current value of an exchange-traded fund is its EXCHANGE CLOSE.
//
// THE SOURCE IS ALREADY IN THE HOUSE. The NSE udiff BhavCopy that Step 14 reads for trusts also
// carries the ETFs: 326 INF-prefixed ISINs under series **EQ** (an ETF is a FUND — INF namespace —
// that TRADES like equity — EQ series). One file, no new fetch target, no new provider.
//
// A SEPARATE JOB, NOT A FLAG ON THE TRUST LANE — the same reasoning Step 13 used to split
// ETF_NAV_DAILY out of AMFI_NAV_DAILY. The two passes fail, retry and get triaged independently:
// a problem pricing ETFs must never be able to take down REIT/InvIT identity, which is the load-
// bearing thing. They read the same file; that costs one extra 190 KB fetch a day, and buys
// blast-radius isolation. Cheap trade.
//
// WHAT THIS LANE DOES NOT DO:
//   · It does NOT create instruments. ETF identity is AMFI's (Step 13) and stays AMFI's. This lane
//     only ever UPDATES the price of an ETF that already exists — it joins on the ISIN spine and
//     writes nothing for an ISIN it does not already know. A price can never conjure an instrument.
//   · It does NOT touch current_nav / nav_date. Both stay exactly as AMFI wrote them. The two
//     numbers coexist deliberately: NAV is what it is worth, last_price is what it trades at, and
//     a later surface may well want to show the premium/discount BETWEEN them.
//   · It does NOT price the ETFs NSE does not list (BSE-listed / matured). They keep an honest
//     NULL last_price and fall back to their NAV in the read. Never a fabricated price.
// ─────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import { reportIngestionError } from "../shared/ingestion-error.js";
import {
  fetchUdiff,
  parseUdiff,
  udiffUrl,
  weekdaysBack,
  checkUdiffShape,
  UDIFF_REQUIRED_COLUMNS,
  UDIFF_PROVIDER,
  UDIFF_SOURCE,
  type UdiffRow,
} from "../shared/udiff-bhavcopy.js";
import { CLOSE_MIN, CLOSE_MAX, checkCloseRange } from "../prices/prices-guards.js";

export const ETF_PRICES_CRON = "etf_prices_daily";
const TARGET_TABLE = "InstrumentPrice";

/** An ETF is a fund that trades like equity: INF namespace, EQ series. */
const ETF_SERIES = "EQ";

/** Sanity band on the ETF price universe. Recon: 326 INF/EQ rows resolve against 337 catalogued
 *  ETFs. A count far outside this is not "a quiet day" — it is a broken filter or a broken file. */
const MIN_ETFS = 150;
const MAX_ETFS = 600;

const LOOKBACK_SESSIONS = 5;
const MAX_WALK_BACK = 12;

export interface EtfPriceIngestResult {
  ok: boolean;
  abortReason?: string;
  sessions: string[];
  priceDate: string | null;
  /** ETFs in the catalogue (the join's right-hand side). */
  catalogued: number;
  /** Distinct ETFs matched in the feed across the look-back. */
  matched: number;
  /** Catalogued ETFs that NSE never listed in the window → honest NULL price, NOT a fault. */
  unlisted: number;
  pricesInserted: number;
  snapshotsUpdated: number;
  errors: { shape: number; count: number; validity: number };
  bytes: number;
  durationMs: number;
}

export async function runEtfPriceIngest(
  opts: { asOf?: Date } = {},
): Promise<EtfPriceIngestResult> {
  const t0 = Date.now();
  const asOf = opts.asOf ?? new Date();
  const runRef = `${asOf.toISOString().slice(0, 10)}:${UDIFF_SOURCE}:etf`;

  const res: EtfPriceIngestResult = {
    ok: false,
    sessions: [],
    priceDate: null,
    catalogued: 0,
    matched: 0,
    unlisted: 0,
    pricesInserted: 0,
    snapshotsUpdated: 0,
    errors: { shape: 0, count: 0, validity: 0 },
    bytes: 0,
    durationMs: 0,
  };

  // ── 1. THE JOIN'S RIGHT-HAND SIDE — the ETFs we already know. ──────────────
  // Loaded FIRST and used as the filter. This is what makes a price unable to invent an
  // instrument: an ISIN absent from here is simply not ours, and is skipped without comment.
  const etfs = await prisma.instrument.findMany({
    where: { assetClass: "etf" },
    select: { id: true, isin: true, symbol: true },
  });
  const idByIsin = new Map(etfs.map((e) => [e.isin, e.id]));
  res.catalogued = etfs.length;

  if (etfs.length === 0) {
    res.abortReason = "no ETFs in the catalogue — nothing to price";
    res.durationMs = Date.now() - t0;
    return res;
  }

  // ── 2. FETCH + PARSE the last N sessions ───────────────────────────────────
  const sessions: { date: Date; rows: UdiffRow[] }[] = [];
  let lastStatus = 0;

  for (const d of weekdaysBack(asOf, MAX_WALK_BACK)) {
    if (sessions.length >= LOOKBACK_SESSIONS) break;

    const f = await fetchUdiff(d);
    lastStatus = f.status;
    if (f.status !== 200 || f.bytes === 0) continue; // holiday / not yet published — not a fault
    res.bytes += f.bytes;

    const parsed = parseUdiff(f.buffer);
    if (!parsed.ok) {
      res.errors.shape++;
      await reportIngestionError({
        source: UDIFF_SOURCE,
        cron: ETF_PRICES_CRON,
        guardType: "shape",
        targetTable: TARGET_TABLE,
        severity: "critical",
        resolutionPath: "source_code",
        expected: "a zip containing one parseable CSV with data rows",
        observed: `${d.toISOString().slice(0, 10)} — ${parsed.reason}: ${parsed.observed}`,
        detail: "NSE udiff BhavCopy could not be read — REJECTED (no partial write).",
        runRef,
      });
      res.abortReason = `parse: ${parsed.reason}`;
      res.durationMs = Date.now() - t0;
      return res;
    }

    const missing = checkUdiffShape(parsed.header);
    if (missing.length > 0) {
      res.errors.shape++;
      await reportIngestionError({
        source: UDIFF_SOURCE,
        cron: ETF_PRICES_CRON,
        guardType: "shape",
        targetTable: TARGET_TABLE,
        severity: "critical",
        resolutionPath: "source_code",
        expected: `udiff header to contain [${UDIFF_REQUIRED_COLUMNS.join(", ")}]`,
        observed: `missing [${missing.join(", ")}]`,
        detail:
          "NSE udiff column rename/removal — our fields would point at the wrong data (a close read out of the wrong column is a wrong price). REJECTED.",
        runRef,
      });
      res.abortReason = "shape guard";
      res.durationMs = Date.now() - t0;
      return res;
    }

    // ONLY EQ-series rows whose ISIN is an ETF WE ALREADY HAVE. Both conditions matter: the series
    // keeps us out of the trust lane's rows, and the ISIN join keeps a price from ever creating an
    // instrument. An unusable row that IS one of our ETFs is a fault; an unusable row that is not
    // ours is none of our business.
    const mine: UdiffRow[] = [];
    for (const r of parsed.rows) {
      if (r.series !== ETF_SERIES) continue;
      if (!idByIsin.has(r.isin)) continue;
      if (!r.usable) {
        res.errors.validity++;
        await reportIngestionError({
          source: UDIFF_SOURCE,
          cron: ETF_PRICES_CRON,
          guardType: "validity",
          targetTable: TARGET_TABLE,
          targetField: "close",
          targetEntity: r.symbol || r.isin,
          severity: "high",
          resolutionPath: "source_code",
          expected: "a readable OHLC on a catalogued ETF's row",
          observed: `${d.toISOString().slice(0, 10)}: ${r.observed ?? r.why}`,
          detail: `${r.why} — price REFUSED for this ETF (no fabricated close).`,
          runRef,
        });
        continue;
      }
      mine.push(r);
    }

    sessions.push({ date: d, rows: mine });
  }

  if (sessions.length === 0) {
    res.errors.shape++;
    await reportIngestionError({
      source: UDIFF_SOURCE,
      cron: ETF_PRICES_CRON,
      guardType: "shape",
      targetTable: TARGET_TABLE,
      severity: "critical",
      resolutionPath: "source_code",
      expected: `HTTP 200 from ${udiffUrl(asOf)} (or one of the ${MAX_WALK_BACK} preceding weekdays)`,
      observed: `no udiff BhavCopy fetched (last status ${lastStatus})`,
      detail: "NSE udiff unreachable across the whole look-back — nothing ingested.",
      runRef,
    });
    res.abortReason = "fetch failed";
    res.durationMs = Date.now() - t0;
    return res;
  }

  sessions.sort((a, b) => a.date.getTime() - b.date.getTime()); // oldest → newest
  res.sessions = sessions.map((s) => s.date.toISOString().slice(0, 10));
  res.priceDate = res.sessions[res.sessions.length - 1]!;

  // ── 3. THE UNION — an ETF's LATEST traded session wins the snapshot. ───────
  // Same reason the trust lane unions: the BhavCopy lists what TRADED, and a thinly-traded ETF
  // skips sessions. Its price is then honestly dated to the day it last printed, never to today.
  const latest = new Map<string, { row: UdiffRow; date: Date }>();
  for (const s of sessions) for (const r of s.rows) latest.set(r.isin, { row: r, date: s.date });
  res.matched = latest.size;
  res.unlisted = res.catalogued - res.matched;

  // ── 4. COUNT GUARD — on the unioned universe. ─────────────────────────────
  if (latest.size < MIN_ETFS || latest.size > MAX_ETFS) {
    res.errors.count++;
    await reportIngestionError({
      source: UDIFF_SOURCE,
      cron: ETF_PRICES_CRON,
      guardType: "count",
      targetTable: TARGET_TABLE,
      severity: latest.size === 0 ? "critical" : "high",
      resolutionPath: "source_code",
      expected: `${MIN_ETFS}–${MAX_ETFS} catalogued ETFs matched in the feed`,
      observed: `${latest.size} matched (of ${res.catalogued} catalogued) across ${sessions.length} session(s)`,
      detail:
        latest.size === 0
          ? "ZERO ETFs matched — a renamed series code or a broken ISIN join looks exactly like this. Rejecting rather than treating a live universe as unpriced."
          : "ETF match count outside the sane band — the series filter or the ISIN join may be broken.",
      runRef,
    });
    if (latest.size === 0) {
      res.abortReason = "count guard (zero ETFs matched)";
      res.durationMs = Date.now() - t0;
      return res;
    }
  }

  // ── 5. RANGE — lands + flags (the equity path's convention). ──────────────
  for (const { row } of latest.values()) {
    if (checkCloseRange(row.close)) {
      await reportIngestionError({
        source: UDIFF_SOURCE,
        cron: ETF_PRICES_CRON,
        guardType: "range",
        targetTable: TARGET_TABLE,
        targetField: "close",
        targetEntity: row.symbol,
        severity: "medium",
        resolutionPath: "admin_fill",
        expected: `close in [${CLOSE_MIN}, ${CLOSE_MAX}]`,
        observed: `close=${row.close}`,
        detail: "ETF close outside plausible bounds — verify against source.",
        runRef,
      });
    }
  }

  // ── 6. PRICE HISTORY (append-only; a re-run of the same day inserts 0) ────
  res.pricesInserted = await insertEtfPrices(sessions, idByIsin);

  // ── 7. THE SNAPSHOT — last_price / last_price_date, forward-only. ─────────
  res.snapshotsUpdated = await updateEtfSnapshots(latest, idByIsin);

  res.ok = true;
  res.durationMs = Date.now() - t0;
  return res;
}

// ═══════════════════════════════════════════════════════════════
async function insertEtfPrices(
  sessions: { date: Date; rows: UdiffRow[] }[],
  idByIsin: Map<string, string>,
): Promise<number> {
  const values: unknown[] = [];
  const tuples: string[] = [];
  const STRIDE = 11;
  let n = 0;

  for (const s of sessions) {
    for (const r of s.rows) {
      const id = idByIsin.get(r.isin);
      if (!id) continue; // never orphan a price against an instrument that does not exist
      const b = n * STRIDE;
      tuples.push(
        `(gen_random_uuid()::text, $${b + 1}, $${b + 2}, $${b + 3}::date, $${b + 4}::decimal, $${b + 5}::decimal, ` +
          `$${b + 6}::decimal, $${b + 7}::decimal, $${b + 8}::decimal, $${b + 9}::bigint, $${b + 10}::decimal, $${b + 11}, now())`,
      );
      values.push(
        id,
        r.isin,
        s.date,
        r.open,
        r.high,
        r.low,
        r.close,
        r.prevClose, // null on a listing day — never coerced to 0
        r.volume.toString(),
        r.tradedValue,
        UDIFF_PROVIDER,
      );
      n++;
    }
  }

  if (n === 0) return 0;

  // APPEND-ONLY, keyed (instrument_id, date). A close, once written for a day, is never rewritten:
  // the historical record does not get edited under us, and a re-run is a no-op.
  const out = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO instrument_prices (
       id, instrument_id, isin, date, open, high, low, close, prev_close, volume, traded_value, provider, created_at
     ) VALUES ${tuples.join(",")}
     ON CONFLICT (instrument_id, date) DO NOTHING
     RETURNING id`,
    ...values,
  );
  return out.length;
}

// ═══════════════════════════════════════════════════════════════
async function updateEtfSnapshots(
  latest: Map<string, { row: UdiffRow; date: Date }>,
  idByIsin: Map<string, string>,
): Promise<number> {
  const values: unknown[] = [];
  const tuples: string[] = [];
  const STRIDE = 3;
  let n = 0;

  for (const [isin, { row, date }] of latest) {
    const id = idByIsin.get(isin);
    if (!id) continue;
    const b = n * STRIDE;
    tuples.push(`($${b + 1}, $${b + 2}::decimal, $${b + 3}::date)`);
    values.push(id, row.close, date);
    n++;
  }
  if (n === 0) return 0;

  // FORWARD-ONLY, and the two columns move TOGETHER or not at all. Re-dating a stale price as fresh
  // is the one lie `last_price_date` exists to prevent — the same rule `nav_date` enforces for NAV.
  //
  // The WHERE fence means this statement can only ever touch an ETF row: it physically cannot
  // rewrite a stock's, a trust's, or a fund's price, even if the join were somehow wrong.
  const out = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE instruments i
        SET last_price = v.close,
            last_price_date = v.d,
            updated_at = now()
       FROM (VALUES ${tuples.join(",")}) AS v(id, close, d)
      WHERE i.id = v.id
        AND i.asset_class = 'etf'::"AssetClass"
        AND (i.last_price_date IS NULL OR v.d >= i.last_price_date)
      RETURNING i.id`,
    ...values,
  );
  return out.length;
}
