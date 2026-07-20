// ─────────────────────────────────────────────────────────────
// GOVERNMENT SECURITIES INGEST (Step 15) — G-secs, T-bills, SDLs, Sovereign Gold Bonds.
//
// IDENTITY-ONLY TIER, BUT NOT VALUE-LESS. There is no detail page and no analytics fold: a G-sec's
// story is coupon + maturity, which lives in `attributes` for display in a picker or a holdings row
// and warrants no page of its own. But a held SGB is still owed an honest ₹ figure — and it gets
// one, because all 197 of these TRADE. They carry a real close in the same udiff BhavCopy the trust
// lane reads, so they flow through the SAME `instrument_prices` table (Step 14) and value correctly
// under the SAME resolver (Step 14.5) with ZERO read-path change. A priced non-stock instrument
// already resolves to its exchange close; these simply are some.
//
// WHAT THIS LANE DOES NOT DO:
//   · No detail page, no analytics, no yield curve. Explicitly out of scope, and nothing here
//     computes a derived number of any kind.
//   · No CORPORATE debt. The series allow-list (GS/TB/GB/SG) is an EXACT set — the same file
//     carries ~40 corporate debt series (N*, Y*, Z*, P1 …) and every one of them is excluded by
//     construction, not by a heuristic. The bond step stays a separate, later, deliberate decision.
//   · No fabricated maturity. The exact redemption date of a G-sec/SDL/SGB is NOT in this feed and
//     is NOT invented — see govt-guards.parseGovtName. Year yes; day, no.
//   · No stocks row, ever. stock_id stays NULL → held-not-scored by construction (the scoring
//     universe is PeerGroup → StockPeerGroup → Stock and cannot see these).
//
// WHY IT READS SEVERAL SESSIONS: the BhavCopy lists what TRADED, not what is LISTED. Government
// paper is thin — recon measured 115 instruments on one day and 197 across eight. A single-day load
// would silently omit whichever securities happened not to print. Identity is therefore the UNION
// over the look-back (most recent row per ISIN wins), while each PRICE stays honestly dated to the
// session it actually came from. Because the load is idempotent and never deletes, the catalogue
// also ACCUMULATES: each daily run adds whatever new paper it sees.
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
import {
  GOVT_CRON,
  GOVT_SERIES,
  GOVT_ISIN,
  TARGET_TABLE,
  MIN_COUPON_PARSE_RATE,
  CLOSE_MIN,
  CLOSE_MAX,
  checkCloseRange,
  classifyCount,
  isGovtSeries,
  parseGovtName,
  type GovtSeries,
} from "./govt-guards.js";

// Government paper is THINNER than trusts — a T-bill can go days without a print (recon saw the
// daily count swing 8 → 20). A longer look-back is how the universe is actually seen.
const LOOKBACK_SESSIONS = 10;
const MAX_WALK_BACK = 20;

export interface GovtIngestResult {
  ok: boolean;
  abortReason?: string;
  sessions: string[];
  priceDate: string | null;
  /** DISTINCT instruments across the whole look-back — the universe, not one day's sample. */
  instruments: number;
  bySeries: Record<string, number>;
  gsec: number;
  sgb: number;
  created: number;
  updated: number;
  pricesInserted: number;
  /** Attribute coverage — honest-empty is fine, a COLLAPSE in it is a fault. */
  couponParsed: number;
  couponExpected: number;
  maturityYearParsed: number;
  maturityDateParsed: number;
  skipped: { isin: string; symbol: string; why: string }[];
  errors: { shape: number; count: number; validity: number; uniqueness: number; null_rate: number };
  bytes: number;
  durationMs: number;
}

export async function runGovtIngest(opts: { asOf?: Date } = {}): Promise<GovtIngestResult> {
  const t0 = Date.now();
  const asOf = opts.asOf ?? new Date();
  const runRef = `${asOf.toISOString().slice(0, 10)}:${UDIFF_SOURCE}:govt`;

  const res: GovtIngestResult = {
    ok: false,
    sessions: [],
    priceDate: null,
    instruments: 0,
    bySeries: {},
    gsec: 0,
    sgb: 0,
    created: 0,
    updated: 0,
    pricesInserted: 0,
    couponParsed: 0,
    couponExpected: 0,
    maturityYearParsed: 0,
    maturityDateParsed: 0,
    skipped: [],
    errors: { shape: 0, count: 0, validity: 0, uniqueness: 0, null_rate: 0 },
    bytes: 0,
    durationMs: 0,
  };

  // ── 1. FETCH + PARSE the look-back window ─────────────────────────────────
  const sessions: { date: Date; rows: UdiffRow[] }[] = [];
  let lastStatus = 0;

  for (const d of weekdaysBack(asOf, MAX_WALK_BACK)) {
    if (sessions.length >= LOOKBACK_SESSIONS) break;

    const f = await fetchUdiff(d);
    lastStatus = f.status;
    if (f.status !== 200 || f.bytes === 0) continue; // holiday — not a fault, step back
    res.bytes += f.bytes;

    const parsed = parseUdiff(f.buffer);
    if (!parsed.ok) {
      res.errors.shape++;
      await reportIngestionError({
        source: UDIFF_SOURCE, cron: GOVT_CRON, guardType: "shape", targetTable: TARGET_TABLE,
        severity: "critical", resolutionPath: "source_code",
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
        source: UDIFF_SOURCE, cron: GOVT_CRON, guardType: "shape", targetTable: TARGET_TABLE,
        severity: "critical", resolutionPath: "source_code",
        expected: `udiff header to contain [${UDIFF_REQUIRED_COLUMNS.join(", ")}]`,
        observed: `missing [${missing.join(", ")}]`,
        detail: "NSE udiff column rename/removal — an ISIN read out of the wrong column is a WRONG INSTRUMENT. REJECTED.",
        runRef,
      });
      res.abortReason = "shape guard";
      res.durationMs = Date.now() - t0;
      return res;
    }

    // THE ALLOW-LIST. Only the four government series. Everything else in this file — equity,
    // trusts, funds, and ~40 CORPORATE debt series — is none of this lane's business.
    const mine: UdiffRow[] = [];
    for (const r of parsed.rows) {
      if (!isGovtSeries(r.series)) continue;
      if (!r.usable) {
        // A government row we cannot read is a FAULT, never a silent drop: a silent drop is how a
        // universe quietly shrinks, and this one is the sovereign's.
        res.errors.validity++;
        res.skipped.push({ isin: r.isin, symbol: r.symbol, why: r.why ?? "unusable row" });
        await reportIngestionError({
          source: UDIFF_SOURCE, cron: GOVT_CRON, guardType: "validity", targetTable: TARGET_TABLE,
          targetField: r.isin ? "close" : "isin", targetEntity: r.symbol || r.isin || "(unknown)",
          severity: "high", resolutionPath: "source_code",
          expected: r.isin ? "a readable OHLC on a government row" : "an ISIN on every government row",
          observed: `${d.toISOString().slice(0, 10)}: ${r.observed ?? r.why}`,
          detail: `${r.why} — row REFUSED (no fabricated ISIN, no fabricated price).`,
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
      source: UDIFF_SOURCE, cron: GOVT_CRON, guardType: "shape", targetTable: TARGET_TABLE,
      severity: "critical", resolutionPath: "source_code",
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

  // ── 2. THE IDENTITY UNION — most recent session per ISIN wins ─────────────
  const latest = new Map<string, { row: UdiffRow; date: Date }>();
  for (const s of sessions) {
    const seen = new Set<string>();
    for (const r of s.rows) {
      if (seen.has(r.isin)) {
        res.errors.uniqueness++;
        await reportIngestionError({
          source: UDIFF_SOURCE, cron: GOVT_CRON, guardType: "uniqueness", targetTable: TARGET_TABLE,
          targetField: "isin", targetEntity: r.isin, severity: "critical", resolutionPath: "source_code",
          expected: "one row per ISIN in a session's BhavCopy",
          observed: `${r.isin} appears twice on ${s.date.toISOString().slice(0, 10)}`,
          detail: "ISIN is the catalogue's unique spine — first row wins; the collision is recorded, not silently merged.",
          runRef, recurring: true,
        });
        continue;
      }
      seen.add(r.isin);
      latest.set(r.isin, { row: r, date: s.date });
    }
  }

  // ── 3. VALIDITY (ISIN shape) ──────────────────────────────────────────────
  const rows: { row: UdiffRow; date: Date }[] = [];
  for (const [isin, v] of latest) {
    if (!GOVT_ISIN.test(isin)) {
      res.errors.validity++;
      res.skipped.push({ isin, symbol: v.row.symbol, why: "ISIN failed /^IN[0-9][0-9A-Z]{9}$/" });
      await reportIngestionError({
        source: UDIFF_SOURCE, cron: GOVT_CRON, guardType: "validity", targetTable: TARGET_TABLE,
        targetField: "isin", targetEntity: v.row.symbol, severity: "high", resolutionPath: "source_code",
        expected: "a government ISIN matching /^IN[0-9][0-9A-Z]{9}$/ (the numeric namespace — IN0 central, IN1/IN2/IN4… state)",
        observed: isin,
        detail: "A government-series row carrying a NON-government ISIN. REFUSED — an INE/INF ISIN here would mean the series filter or the file is wrong.",
        runRef,
      });
      continue;
    }
    rows.push(v);
  }

  res.instruments = rows.length;
  for (const { row } of rows) res.bySeries[row.series] = (res.bySeries[row.series] ?? 0) + 1;
  res.gsec = rows.filter(({ row }) => GOVT_SERIES[row.series as GovtSeries].assetClass === "gsec").length;
  res.sgb = rows.filter(({ row }) => GOVT_SERIES[row.series as GovtSeries].assetClass === "sgb").length;

  // ── 4. COUNT GUARD — on the UNIONED universe, not one session's sample ────
  const verdict = classifyCount(rows.length);
  if (verdict) {
    res.errors.count++;
    await reportIngestionError({
      source: UDIFF_SOURCE, cron: GOVT_CRON, guardType: "count", targetTable: TARGET_TABLE,
      severity: verdict.severity, resolutionPath: "source_code",
      expected: "a plausible government-paper universe (GS + TB + GB + SG)",
      observed: `${rows.length} distinct instruments across ${sessions.length} session(s)`,
      detail: verdict.note,
      runRef,
    });
    if (verdict.severity === "critical") {
      res.abortReason = "count guard (zero government rows)";
      res.durationMs = Date.now() - t0;
      return res;
    }
  }

  // ── 5. OVERLAP — never re-class a row that is already something else ──────
  const isins = rows.map(({ row }) => row.isin);
  const [preexisting, asStock] = await Promise.all([
    prisma.instrument.findMany({
      where: { isin: { in: isins }, assetClass: { notIn: ["gsec", "sgb"] } },
      select: { isin: true, assetClass: true, symbol: true },
    }),
    prisma.stock.findMany({ where: { isin: { in: isins } }, select: { isin: true, symbol: true } }),
  ]);
  const blocked = new Set<string>();
  for (const p of preexisting) {
    blocked.add(p.isin);
    res.errors.uniqueness++;
    res.skipped.push({ isin: p.isin, symbol: p.symbol ?? "—", why: `already in catalogue as ${p.assetClass}` });
    await reportIngestionError({
      source: UDIFF_SOURCE, cron: GOVT_CRON, guardType: "uniqueness", targetTable: TARGET_TABLE,
      targetField: "isin", targetEntity: p.isin, severity: "critical", resolutionPath: "source_code",
      expected: `${p.isin} to be absent, or already a gsec/sgb`,
      observed: `already in the catalogue as asset_class=${p.assetClass}`,
      detail: "NSE calls this government paper; our catalogue already calls it something else. SKIPPED — an ISIN is ONE instrument, and we do not re-class one silently.",
      runRef, recurring: true,
    });
  }
  for (const s of asStock) {
    res.errors.uniqueness++;
    await reportIngestionError({
      source: UDIFF_SOURCE, cron: GOVT_CRON, guardType: "uniqueness", targetTable: "Stock",
      targetField: "isin", targetEntity: s.symbol, severity: "critical", resolutionPath: "source_code",
      expected: "a government ISIN to NEVER exist as a row in `stocks`",
      observed: `${s.isin} is stock ${s.symbol}`,
      detail: "Government paper in `stocks` enters the scoring universe and would be handed an equity health score built on fundamentals a bond does not have.",
      runRef, recurring: true,
    });
  }

  const loadable = rows.filter(({ row }) => !blocked.has(row.isin));
  if (loadable.length === 0) {
    res.abortReason = "no loadable rows after guards";
    res.durationMs = Date.now() - t0;
    return res;
  }

  // ── 6. RANGE (close) — lands + flags, per the equity path's convention ────
  // targetEntity is "ISIN@SESSION-DATE", NOT the symbol — that is what makes the row RESOLVABLE by
  // the fill bridge. `instruments.symbol` is not a unique key, and this lane unions a 10-session
  // look-back, so the session a price belongs to is NOT the day the cron ran.
  for (const { row, date } of loadable) {
    if (checkCloseRange(row.close)) {
      await reportIngestionError({
        source: UDIFF_SOURCE, cron: GOVT_CRON, guardType: "range", targetTable: "InstrumentPrice",
        targetField: "close",
        targetEntity: `${row.isin}@${date.toISOString().slice(0, 10)}`,
        severity: "medium", resolutionPath: "admin_fill",
        expected: `close in [${CLOSE_MIN}, ${CLOSE_MAX}]`,
        observed: `${row.symbol}: close=${row.close} on ${date.toISOString().slice(0, 10)}`,
        detail: "Government security close outside plausible bounds — verify against source.",
        runRef,
      });
    }
  }

  // ── 7. IDENTITY + ATTRIBUTES upsert ──────────────────────────────────────
  const idByIsin = await upsertIdentity(loadable, res, runRef);

  // ── 8. NULL-RATE GUARD on the NAME PARSE ─────────────────────────────────
  // An individual unreadable name is honest-empty. A COLLAPSE in the parse rate means NSE renamed
  // its instruments, and we want to hear about it the same night — not in six months, when someone
  // notices every G-sec has a blank coupon and nobody knows how long it has been that way.
  if (res.couponExpected > 0) {
    const rate = res.couponParsed / res.couponExpected;
    if (rate < MIN_COUPON_PARSE_RATE) {
      res.errors.null_rate++;
      await reportIngestionError({
        source: UDIFF_SOURCE, cron: GOVT_CRON, guardType: "null_rate", targetTable: TARGET_TABLE,
        targetField: "attributes.coupon", severity: "medium", resolutionPath: "source_code",
        expected: `≥${(MIN_COUPON_PARSE_RATE * 100).toFixed(0)}% of coupon-bearing names to yield a coupon (100% today)`,
        observed: `${(rate * 100).toFixed(1)}% (${res.couponParsed}/${res.couponExpected})`,
        detail: "The coupon is parsed out of FinInstrmNm (there is no coupon COLUMN). A collapse in the parse rate means NSE changed its naming — identity and price are unaffected; the attributes went honestly null.",
        runRef, recurring: true,
      });
    }
  }

  // ── 9. PRICE — every (instrument, session) observed. Append-only. ─────────
  res.pricesInserted = await insertPrices(sessions, idByIsin);

  res.ok = true;
  res.durationMs = Date.now() - t0;
  return res;
}

// ═══════════════════════════════════════════════════════════════
async function upsertIdentity(
  rows: { row: UdiffRow; date: Date }[],
  res: GovtIngestResult,
  runRef: string,
): Promise<Map<string, string>> {
  void runRef;
  const values: unknown[] = [];
  const tuples: string[] = [];
  const STRIDE = 7;

  rows.forEach(({ row, date }, n) => {
    const b = n * STRIDE;
    const attrs = parseGovtName(row.series as GovtSeries, row.name);

    // Attribute coverage, measured — so the null-rate guard has something real to judge.
    if (attrs.couponNullReason !== "discount_instrument") {
      res.couponExpected++;
      if (attrs.coupon != null) res.couponParsed++;
    }
    if (attrs.maturityYear != null) res.maturityYearParsed++;
    if (attrs.maturityDate != null) res.maturityDateParsed++;

    const cls = GOVT_SERIES[row.series as GovtSeries].assetClass;

    // asset_class is a BOUND parameter with a cast — never string-interpolated. No injection
    // surface, and the class comes from the SctySrs the source itself stamped on the row.
    tuples.push(
      `(gen_random_uuid()::text, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::"AssetClass", NULL, $${b + 5}::jsonb, true, ` +
        `$${b + 6}::decimal, $${b + 7}::date, now(), now())`,
    );
    values.push(
      row.isin, //          1
      row.symbol, //        2  government paper HAS an exchange ticker (664GS2027, SGBJUN28)
      row.name, //          3
      cls, //               4  'gsec' | 'sgb'
      JSON.stringify(attrs), // 5 → attributes (display-only; nulls carry a REASON)
      row.close, //         6  → last_price
      date, //              7  → last_price_date (the session it TRADED, not today)
    );
  });

  const sql = `
    INSERT INTO instruments (
      id, isin, symbol, name, asset_class, stock_id, attributes, is_active,
      last_price, last_price_date, created_at, updated_at
    ) VALUES ${tuples.join(",")}
    ON CONFLICT (isin) DO UPDATE SET
      symbol      = EXCLUDED.symbol,
      name        = EXCLUDED.name,
      asset_class = EXCLUDED.asset_class,
      attributes  = EXCLUDED.attributes,

      -- THE SNAPSHOT MOVES FORWARD ONLY. A backfill of an older session must not overwrite a newer
      -- close with a staler one, and the two columns move TOGETHER or not at all — re-dating a
      -- stale price as fresh is the one lie last_price_date exists to prevent.
      last_price = CASE
        WHEN instruments.last_price_date IS NULL OR EXCLUDED.last_price_date >= instruments.last_price_date
        THEN EXCLUDED.last_price ELSE instruments.last_price END,
      last_price_date = CASE
        WHEN instruments.last_price_date IS NULL OR EXCLUDED.last_price_date >= instruments.last_price_date
        THEN EXCLUDED.last_price_date ELSE instruments.last_price_date END,

      updated_at = now()
    -- THE CLASS FENCE. An overlapping ISIN was already skipped upstream; this is the belt to that
    -- braces. Even if one slipped through, this ingest physically CANNOT rewrite a stock, a fund,
    -- an ETF or a trust row.
    WHERE instruments.asset_class IN ('gsec'::"AssetClass", 'sgb'::"AssetClass")
    RETURNING id, isin, (xmax = 0) AS inserted`;

  const out = await prisma.$queryRawUnsafe<{ id: string; isin: string; inserted: boolean }[]>(sql, ...values);

  const idByIsin = new Map<string, string>();
  for (const r of out) {
    idByIsin.set(r.isin, r.id);
    r.inserted ? res.created++ : res.updated++;
  }
  return idByIsin;
}

// ═══════════════════════════════════════════════════════════════
async function insertPrices(
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
      if (!id) continue; // fenced out above — never orphan a price against a row we refused to admit
      const b = n * STRIDE;
      tuples.push(
        `(gen_random_uuid()::text, $${b + 1}, $${b + 2}, $${b + 3}::date, $${b + 4}::decimal, $${b + 5}::decimal, ` +
          `$${b + 6}::decimal, $${b + 7}::decimal, $${b + 8}::decimal, $${b + 9}::bigint, $${b + 10}::decimal, $${b + 11}, now())`,
      );
      values.push(
        id, r.isin, s.date, r.open, r.high, r.low, r.close,
        r.prevClose, r.volume.toString(), r.tradedValue, UDIFF_PROVIDER,
      );
      n++;
    }
  }
  if (n === 0) return 0;

  // APPEND-ONLY, keyed (instrument_id, date) — the same spine the trust and ETF lanes write to.
  // A close, once written for a day, is never rewritten; a re-run is a no-op.
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
