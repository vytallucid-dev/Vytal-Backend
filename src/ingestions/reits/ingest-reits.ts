// ─────────────────────────────────────────────────────────────
// REIT / InvIT INGEST (Step 14) — identity + price + distribution yield. The THIN tier.
//
// THREE THINGS LAND, IN THIS ORDER, AND THE LATER ONES CANNOT BREAK THE EARLIER ONES:
//   1. IDENTITY  — one catalogue row per valid ISIN (stock_id NULL → HELD-NOT-SCORED).
//   2. PRICE     — the day's OHLCV into `instrument_prices` + the close onto the snapshot columns.
//   3. YIELD     — the trailing-12m distribution yield into `attributes`.
//
// (1) and (2) come from ONE udiff BhavCopy row, so a trust cannot exist without a price or carry
// a price that belongs to a different instrument. (3) is a SECONDARY, per-symbol NSE API call:
// it is allowed to fail, and when it does, identity and price still land and the yield goes
// honestly NULL with a machine-readable reason. NSE's corporate-actions endpoint being down must
// never mean the catalogue loses its REITs.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO:
//   · No analytics fold. No returns, no vol, no Sharpe, no drawdown, no ranking. A REIT is not
//     an MF: there is no NAV history to fold, the universe is 17, and a "rank_bucket" over 6
//     REITs would be numerology. The thin tier is price + yield. That is the whole tier.
//   · No `stocks` row, ever. A trust with a stocks row would enter the scoring universe
//     (PeerGroup → StockPeerGroup → Stock) and be handed a Vytal Health Score built on
//     fundamentals it does not have. stock_id STAYS NULL. That is the held-not-scored contract.
//   · No dormancy flip. A trust absent from one day's file is far more likely halted than
//     delisted, and the count guard already rejects the file-is-empty case. Marking a halted
//     trust inactive on a quiet day is a worse error than carrying a listed one. Deferred, on
//     purpose, until there is a delisting signal worth trusting.
// ─────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import { reportIngestionError } from "../shared/ingestion-error.js";
import { fetchUdiff, parseUdiff, udiffUrl, type TrustRow } from "./reit-source.js";
import {
  fetchCorporateActions,
  foldTtm,
  type TtmDistribution,
} from "./reit-distributions.js";
import {
  REITS_CRON,
  REITS_SOURCE,
  REIT_DISTRIB_SOURCE,
  TARGET_TABLE,
  TRUST_ISIN,
  checkShape,
  checkCloseRange,
  checkYieldRange,
  classifyCount,
  runRef as mkRunRef,
  CLOSE_MIN,
  CLOSE_MAX,
  YIELD_MAX,
  UDIFF_REQUIRED_COLUMNS,
} from "./reit-guards.js";

export interface ReitIngestResult {
  ok: boolean;
  abortReason?: string;
  /** The NEWEST session read (the snapshot's high-water mark), not necessarily every trust's date. */
  priceDate: string | null;
  /** Every session this run read, oldest→newest. Identity is the UNION over these. */
  sessions: string[];
  /** DISTINCT trusts across the whole look-back — the universe, not one day's sample. */
  trustRows: number;
  reits: number;
  invits: number;
  /** Catalogue rows created / updated (xmax proves which). */
  created: number;
  updated: number;
  /** instrument_prices rows genuinely new this run (a re-run of the same day → 0). */
  pricesInserted: number;
  /** Yields written vs honestly NULLed, and why. */
  yieldsWritten: number;
  yieldsNull: number;
  yieldNullReasons: Record<string, number>;
  /** Rows the source gave us that we REFUSED to load (each one raised a fault). */
  skipped: { isin: string; symbol: string; why: string }[];
  errors: { shape: number; count: number; validity: number; uniqueness: number };
  bytes: number;
  durationMs: number;
}

// ══ WHY THIS INGEST READS SEVERAL DAYS, NOT ONE ══
// The udiff BhavCopy lists the securities that TRADED that session — NOT the listed universe.
// Measured live across four consecutive sessions:
//     2026-07-13 → 16 RR/IV rows (no NHIT)
//     2026-07-10 → 17
//     2026-07-09 → 18            ← a trust that appears on NO other day in the window
//     2026-07-08 → 15 (no ANZEN, NHIT, VERTIS)
// These trusts are THINLY TRADED: several go whole sessions without a print. So a single day's
// file is not the universe, it is a SAMPLE of it, and building the catalogue from one day would
// silently omit whichever trusts happened not to trade — a holder of NHIT would find their
// instrument simply missing.
//
// So identity is the UNION over the last few sessions (most recent row per ISIN wins), while the
// PRICE stays honestly dated to the session it actually came from. That is precisely what
// `last_price_date` is for: a trust that last printed on Thursday shows Thursday's close, dated
// Thursday — never today's date on a stale price.
//
// Reading N days also seeds N days of `instrument_prices` for free, which is what the thin tier's
// price chart draws.
const LOOKBACK_SESSIONS = 5; // trading days of identity+price to union
const MAX_WALK_BACK = 12; // weekdays to walk to FIND those sessions (holidays 404 → step back)

function weekdaysBack(from: Date, n: number): Date[] {
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

/**
 * THE STEP-14 INGEST.
 *
 * `asOf` exists so the verifier can pin a deterministic day; production passes nothing.
 * `withYield=false` skips the 17 NSE API calls (used by the fast path of the verifier — the
 * yield fold is separately unit-proven).
 */
export async function runReitIngest(
  opts: { asOf?: Date; withYield?: boolean } = {},
): Promise<ReitIngestResult> {
  const t0 = Date.now();
  const asOf = opts.asOf ?? new Date();
  const withYield = opts.withYield ?? true;

  const res: ReitIngestResult = {
    ok: false,
    priceDate: null,
    sessions: [],
    trustRows: 0,
    reits: 0,
    invits: 0,
    created: 0,
    updated: 0,
    pricesInserted: 0,
    yieldsWritten: 0,
    yieldsNull: 0,
    yieldNullReasons: {},
    skipped: [],
    errors: { shape: 0, count: 0, validity: 0, uniqueness: 0 },
    bytes: 0,
    durationMs: 0,
  };

  const runRef = mkRunRef(asOf, REITS_SOURCE);

  // ── 1. FETCH + PARSE — the last LOOKBACK_SESSIONS published sessions. ──────
  // A 404 is a HOLIDAY, not a fault: step back. A SHAPE failure on any session we DID get is a
  // format change and aborts the whole run — we never ingest half a rename.
  const sessions: { date: Date; rows: TrustRow[] }[] = [];
  let lastStatus = 0;

  for (const d of weekdaysBack(asOf, MAX_WALK_BACK)) {
    if (sessions.length >= LOOKBACK_SESSIONS) break;

    const f = await fetchUdiff(d);
    lastStatus = f.status;
    if (f.status !== 200 || f.bytes === 0) continue; // holiday / not yet published
    res.bytes += f.bytes;

    const parsed = parseUdiff(f.buffer);
    if (!parsed.ok) {
      res.errors.shape++;
      await reportIngestionError({
        source: REITS_SOURCE,
        cron: REITS_CRON,
        guardType: "shape",
        targetTable: TARGET_TABLE,
        severity: "critical",
        resolutionPath: "source_code",
        expected: "a zip containing one parseable CSV with data rows",
        observed: `${d.toISOString().slice(0, 10)} — ${parsed.reason}: ${parsed.observed}`,
        detail:
          "NSE udiff BhavCopy could not be read — REJECTED the run rather than write nothing-shaped-as-something.",
        runRef,
      });
      res.abortReason = `parse: ${parsed.reason}`;
      res.durationMs = Date.now() - t0;
      return res;
    }

    const missing = checkShape(parsed.header);
    if (missing.length > 0) {
      res.errors.shape++;
      await reportIngestionError({
        source: REITS_SOURCE,
        cron: REITS_CRON,
        guardType: "shape",
        targetTable: TARGET_TABLE,
        severity: "critical",
        resolutionPath: "source_code",
        expected: `udiff header to contain [${UDIFF_REQUIRED_COLUMNS.join(", ")}]`,
        observed: `missing [${missing.join(", ")}] — header was [${parsed.header.join(", ")}]`,
        detail:
          "NSE udiff column rename/removal. Our field indices would point at the wrong data (an ISIN read out of a price column is a wrong instrument) → REJECTED.",
        runRef,
      });
      res.abortReason = "shape guard";
      res.durationMs = Date.now() - t0;
      return res;
    }

    sessions.push({ date: d, rows: parsed.rows });

    // Malformed rows are faults on the day they appear. reportIngestionError dedups on
    // (cron, guardType, targetField, targetEntity), so the same bad row across days is one row.
    for (const m of parsed.malformed) {
      res.errors.validity++;
      res.skipped.push({ isin: m.isin, symbol: m.symbol, why: m.why });
      await reportIngestionError({
        source: REITS_SOURCE,
        cron: REITS_CRON,
        guardType: "validity",
        targetTable: TARGET_TABLE,
        targetField: m.isin ? "close" : "isin",
        targetEntity: m.symbol || m.isin || "(unknown)",
        severity: "high",
        resolutionPath: "source_code",
        expected: m.isin ? "a readable OHLC on an RR/IV row" : "an ISIN on every RR/IV row",
        observed: `${d.toISOString().slice(0, 10)}: ${m.observed}`,
        detail: `${m.why} — row REFUSED (no fabricated ISIN, no fabricated price).`,
        runRef,
      });
    }
  }

  if (sessions.length === 0) {
    res.errors.shape++;
    await reportIngestionError({
      source: REITS_SOURCE,
      cron: REITS_CRON,
      guardType: "shape",
      targetTable: TARGET_TABLE,
      severity: "critical",
      resolutionPath: "source_code",
      expected: `HTTP 200 with a non-empty body from ${udiffUrl(asOf)} (or one of the ${MAX_WALK_BACK} preceding weekdays)`,
      observed: `no udiff BhavCopy fetched in ${MAX_WALK_BACK} weekdays (last status ${lastStatus})`,
      detail:
        "NSE udiff BhavCopy unreachable across the whole look-back window — nothing ingested (no partial write, no stale price re-dated as fresh).",
      runRef,
    });
    res.abortReason = "fetch failed";
    res.durationMs = Date.now() - t0;
    return res;
  }

  // Oldest → newest, so the identity union below lets the MOST RECENT session win per ISIN.
  sessions.sort((a, b) => a.date.getTime() - b.date.getTime());
  const newest = sessions[sessions.length - 1]!;
  res.priceDate = newest.date.toISOString().slice(0, 10);
  res.sessions = sessions.map((s) => s.date.toISOString().slice(0, 10));

  // ── 2. THE IDENTITY UNION — the universe is every trust that traded in ANY session. ──
  // Most recent row per ISIN wins: the freshest name, ticker, class AND close. A trust that last
  // printed on Thursday keeps Thursday's close, dated Thursday — honestly stale, never re-dated.
  const latestByIsin = new Map<string, { row: TrustRow; date: Date }>();
  for (const s of sessions) {
    const seenToday = new Set<string>();
    for (const row of s.rows) {
      // In-file uniqueness: one ISIN cannot appear twice in ONE session's file.
      if (seenToday.has(row.isin)) {
        res.errors.uniqueness++;
        await reportIngestionError({
          source: REITS_SOURCE,
          cron: REITS_CRON,
          guardType: "uniqueness",
          targetTable: TARGET_TABLE,
          targetField: "isin",
          targetEntity: row.isin,
          severity: "critical",
          resolutionPath: "source_code",
          expected: "one RR/IV row per ISIN in a session's BhavCopy",
          observed: `${row.isin} appears twice on ${s.date.toISOString().slice(0, 10)}`,
          detail: "ISIN is the catalogue's unique spine — first row wins; the collision is recorded, not silently merged.",
          runRef,
          recurring: true,
        });
        continue;
      }
      seenToday.add(row.isin);
      latestByIsin.set(row.isin, { row, date: s.date }); // ascending order → newest wins
    }
  }

  res.trustRows = latestByIsin.size;

  // ── 3. COUNT GUARD — on the UNIONED universe, not on one session's sample. ─
  const verdict = classifyCount(latestByIsin.size);
  if (verdict) {
    res.errors.count++;
    await reportIngestionError({
      source: REITS_SOURCE,
      cron: REITS_CRON,
      guardType: "count",
      targetTable: TARGET_TABLE,
      severity: verdict.severity,
      resolutionPath: "source_code",
      expected: "a plausible RR/IV row count for the listed trust universe",
      observed: `${latestByIsin.size} distinct trusts across ${sessions.length} session(s)`,
      detail: verdict.note,
      runRef,
    });
    // ZERO is the only count verdict that ABORTS: it is indistinguishable from a renamed series
    // code, and acting on it would mean treating a live universe as delisted.
    if (verdict.severity === "critical") {
      res.abortReason = "count guard (zero trust rows)";
      res.durationMs = Date.now() - t0;
      return res;
    }
  }

  // ── 4. VALIDITY (ISIN shape) ───────────────────────────────────────────────
  const byIsin = new Map<string, TrustRow>();
  // The SESSION each surviving row's price belongs to. `byIsin` deliberately holds only the row (it
  // is what the upsert wants), but a price is meaningless without its date — and the range guard
  // below needs it to emit a targetEntity the FILL BRIDGE can actually resolve ("ISIN@DATE").
  // The run date will not do: this lane unions a look-back, so a trust that last printed on Thursday
  // carries THURSDAY's close, not today's.
  const dateByIsin = new Map<string, Date>();
  for (const [isin, { row, date }] of latestByIsin) {
    if (!TRUST_ISIN.test(isin)) {
      res.errors.validity++;
      res.skipped.push({ isin, symbol: row.symbol, why: "ISIN failed /^INE[A-Z0-9]{9}$/" });
      await reportIngestionError({
        source: REITS_SOURCE,
        cron: REITS_CRON,
        guardType: "validity",
        targetTable: TARGET_TABLE,
        targetField: "isin",
        targetEntity: row.symbol,
        severity: "high",
        resolutionPath: "source_code",
        expected: "an ISIN matching /^INE[A-Z0-9]{9}$/ (trusts live in the INE equity namespace)",
        observed: isin,
        detail:
          "RR/IV row with a non-INE ISIN. REFUSED: an INF-prefixed row here would also trip the AMFI trespass guard nightly.",
        runRef,
      });
      continue;
    }
    byIsin.set(isin, row);
    dateByIsin.set(isin, date);
  }

  // ── 5. OVERLAP — never re-class a row that is already something else ───────
  // The ISIN spine means an ISIN can exist EXACTLY once. If one of these ISINs is already in the
  // catalogue as a stock/MF/ETF, or is sitting in `stocks`, that is a real collision and we skip
  // it: we do not convert an existing instrument into a REIT behind the operator's back.
  const isins = [...byIsin.keys()];
  const [preexisting, asStock] = await Promise.all([
    prisma.instrument.findMany({
      where: { isin: { in: isins }, assetClass: { notIn: ["reit", "invit"] } },
      select: { isin: true, assetClass: true, symbol: true },
    }),
    prisma.stock.findMany({ where: { isin: { in: isins } }, select: { isin: true, symbol: true } }),
  ]);

  for (const p of preexisting) {
    res.errors.uniqueness++;
    const row = byIsin.get(p.isin)!;
    res.skipped.push({ isin: p.isin, symbol: row.symbol, why: `already in catalogue as ${p.assetClass}` });
    byIsin.delete(p.isin);
    await reportIngestionError({
      source: REITS_SOURCE,
      cron: REITS_CRON,
      guardType: "uniqueness",
      targetTable: TARGET_TABLE,
      targetField: "isin",
      targetEntity: p.isin,
      severity: "critical",
      resolutionPath: "source_code",
      expected: `${p.isin} to be absent, or already a reit/invit`,
      observed: `already in the catalogue as asset_class=${p.assetClass} (symbol=${p.symbol ?? "—"})`,
      detail:
        "NSE calls this a trust; our catalogue already calls it something else. SKIPPED — an ISIN is one instrument, and we do not re-class one silently.",
      runRef,
      recurring: true,
    });
  }
  for (const s of asStock) {
    // A trust sitting in `stocks` would be SCORED. That is the one thing held-not-scored forbids.
    res.errors.uniqueness++;
    await reportIngestionError({
      source: REITS_SOURCE,
      cron: REITS_CRON,
      guardType: "uniqueness",
      targetTable: "Stock",
      targetField: "isin",
      targetEntity: s.symbol,
      severity: "critical",
      resolutionPath: "source_code",
      expected: `a REIT/InvIT ISIN to NEVER exist as a row in \`stocks\``,
      observed: `${s.isin} is stock ${s.symbol}`,
      detail:
        "A trust in `stocks` enters the scoring universe and would be handed an equity health score built on fundamentals it does not have.",
      runRef,
      recurring: true,
    });
  }

  const rows = [...byIsin.values()];
  res.reits = rows.filter((r) => r.assetClass === "reit").length;
  res.invits = rows.filter((r) => r.assetClass === "invit").length;

  if (rows.length === 0) {
    res.abortReason = "no loadable rows after guards";
    res.durationMs = Date.now() - t0;
    return res;
  }

  // ── 7. RANGE (close) — lands + flags, per the equity path's convention ─────
  // targetEntity is "ISIN@SESSION-DATE", NOT the symbol — that is what makes the row RESOLVABLE by
  // the fill bridge (fill/error-resolution.ts). `instruments.symbol` is not a unique key, and the
  // session a price belongs to is not the day the cron ran. Without both parts, the "Fill" button
  // has nothing to open.
  for (const r of rows) {
    if (checkCloseRange(r.close)) {
      const sessionDate = dateByIsin.get(r.isin);
      await reportIngestionError({
        source: REITS_SOURCE,
        cron: REITS_CRON,
        guardType: "range",
        targetTable: "InstrumentPrice",
        targetField: "close",
        targetEntity: sessionDate ? `${r.isin}@${sessionDate.toISOString().slice(0, 10)}` : r.isin,
        severity: "medium",
        resolutionPath: "admin_fill",
        expected: `close in [${CLOSE_MIN}, ${CLOSE_MAX}]`,
        observed: `${r.symbol}: close=${r.close}${sessionDate ? ` on ${sessionDate.toISOString().slice(0, 10)}` : ""}`,
        detail: "Trust close outside plausible bounds — verify against source.",
        runRef,
      });
    }
  }

  // ── 6. IDENTITY UPSERT (idempotent, dedup on ISIN, class-fenced) ───────────
  // Each trust carries the date of the LAST SESSION IT ACTUALLY TRADED — not "today". A trust
  // whose last print was Thursday gets Thursday's close, dated Thursday.
  const idByIsin = await upsertIdentity(rows, latestByIsin, res);

  // ── 7. PRICE — every (trust, session) observed. Append-only; a re-run inserts 0. ──
  res.pricesInserted = await insertPrices(sessions, idByIsin);

  // ── 8. YIELD (SECONDARY — may fail without touching identity or price) ─────
  if (withYield) {
    await writeYields(rows, idByIsin, asOf, runRef, res);
  }

  res.ok = true;
  res.durationMs = Date.now() - t0;
  return res;
}

// ═══════════════════════════════════════════════════════════════
// IDENTITY
// ═══════════════════════════════════════════════════════════════
async function upsertIdentity(
  rows: TrustRow[],
  latestByIsin: Map<string, { row: TrustRow; date: Date }>,
  res: ReitIngestResult,
): Promise<Map<string, string>> {
  const values: unknown[] = [];
  const tuples: string[] = [];

  // 6 bound params per row — the stride MUST match `values.push` below exactly, or the tuples
  // reference a $n nobody bound ("could not determine data type of parameter $7").
  const STRIDE = 6;

  rows.forEach((r, n) => {
    const b = n * STRIDE;
    // asset_class is a BOUND parameter with a cast — never string-interpolated. There is no
    // injection surface here at all, and the class comes from the SctySrs the source stamped.
    tuples.push(
      `(gen_random_uuid()::text, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}::"AssetClass", NULL, NULL, true, ` +
        `$${b + 5}::decimal, $${b + 6}::date, now(), now())`,
    );
    values.push(
      r.isin, //      1
      r.symbol, //    2  a trust HAS a ticker (unlike an MF) — it trades on the exchange
      r.name, //      3
      r.assetClass, // 4  'reit' | 'invit', from SctySrs
      r.close, //     5  → last_price  (the close of its last traded session)
      latestByIsin.get(r.isin)!.date, // 6 → last_price_date (THAT session's date, not today's)
    );
  });

  const sql = `
    INSERT INTO instruments (
      id, isin, symbol, name, asset_class, stock_id, attributes, is_active,
      last_price, last_price_date, created_at, updated_at
    ) VALUES ${tuples.join(",")}
    ON CONFLICT (isin) DO UPDATE SET
      symbol = EXCLUDED.symbol,
      name   = EXCLUDED.name,

      -- The SOURCE owns the class: if NSE re-series a trust (RR↔IV), we follow it. The WHERE
      -- fence below means this can only ever move a row BETWEEN reit and invit — a stock, an MF
      -- or an ETF row can never be re-classed by this ingest.
      asset_class = EXCLUDED.asset_class,

      -- ══ THE SNAPSHOT MOVES FORWARD ONLY. ══
      -- A backfill of an older day must not overwrite today's close with a staler one. The two
      -- columns move TOGETHER or not at all — updating the date while keeping an old price would
      -- re-date a stale price as fresh, which is the exact lie nav_date exists to prevent for funds.
      last_price = CASE
        WHEN instruments.last_price_date IS NULL
          OR EXCLUDED.last_price_date >= instruments.last_price_date
        THEN EXCLUDED.last_price ELSE instruments.last_price END,
      last_price_date = CASE
        WHEN instruments.last_price_date IS NULL
          OR EXCLUDED.last_price_date >= instruments.last_price_date
        THEN EXCLUDED.last_price_date ELSE instruments.last_price_date END,

      updated_at = now()
    -- THE CLASS FENCE. An overlapping ISIN was already skipped upstream (step 6), so this is the
    -- belt to that braces: even if one slipped through, this ingest physically cannot rewrite a
    -- stock / mutual_fund / etf row.
    WHERE instruments.asset_class IN ('reit'::"AssetClass", 'invit'::"AssetClass")
    RETURNING id, isin, (xmax = 0) AS inserted`;

  const out = await prisma.$queryRawUnsafe<{ id: string; isin: string; inserted: boolean }[]>(
    sql,
    ...values,
  );

  const idByIsin = new Map<string, string>();
  for (const r of out) {
    idByIsin.set(r.isin, r.id);
    r.inserted ? res.created++ : res.updated++;
  }
  return idByIsin;
}

// ═══════════════════════════════════════════════════════════════
// PRICE
// ═══════════════════════════════════════════════════════════════
async function insertPrices(
  sessions: { date: Date; rows: TrustRow[] }[],
  idByIsin: Map<string, string>,
): Promise<number> {
  const values: unknown[] = [];
  const tuples: string[] = [];
  const STRIDE = 11;
  let n = 0;

  // EVERY (trust, session) pair we observed — so the look-back seeds several days of history in
  // one run, which is what the thin tier's price chart draws. Trusts fenced out by the guards
  // have no id and get no price row: we never orphan a price against an instrument that does not
  // exist, and never write a price for a row we refused to admit.
  for (const s of sessions) {
    for (const r of s.rows) {
      const id = idByIsin.get(r.isin);
      if (!id) continue;
      const b = n * STRIDE;
      tuples.push(
        `(gen_random_uuid()::text, $${b + 1}, $${b + 2}, $${b + 3}::date, $${b + 4}::decimal, $${b + 5}::decimal, ` +
          `$${b + 6}::decimal, $${b + 7}::decimal, $${b + 8}::decimal, $${b + 9}::bigint, $${b + 10}::decimal, $${b + 11}, now())`,
      );
      values.push(
        id, //            1
        r.isin, //        2
        s.date, //        3  the session this close BELONGS to
        r.open, //        4
        r.high, //        5
        r.low, //         6
        r.close, //       7
        r.prevClose, //   8  (null on a listing day — never coerced to 0)
        r.volume.toString(), // 9
        r.tradedValue, // 10
        "nse-udiff-bhavcopy", // 11
      );
      n++;
    }
  }

  if (n === 0) return 0;

  // APPEND-ONLY. The (instrument_id, date) unique makes DO NOTHING the whole idempotency story:
  // a re-run of an already-ingested day inserts 0 and changes nothing. A close, once written for
  // a day, is never rewritten — the historical record does not get edited under us.
  const sql = `
    INSERT INTO instrument_prices (
      id, instrument_id, isin, date, open, high, low, close, prev_close, volume, traded_value, provider, created_at
    ) VALUES ${tuples.join(",")}
    ON CONFLICT (instrument_id, date) DO NOTHING
    RETURNING id`;

  const out = await prisma.$queryRawUnsafe<{ id: string }[]>(sql, ...values);
  return out.length;
}

// ═══════════════════════════════════════════════════════════════
// DISTRIBUTION YIELD  (secondary — degrades to an honest NULL, never a guess)
// ═══════════════════════════════════════════════════════════════
async function writeYields(
  rows: TrustRow[],
  idByIsin: Map<string, string>,
  asOf: Date,
  runRef: string,
  res: ReitIngestResult,
): Promise<void> {
  const windowFrom = new Date(asOf);
  windowFrom.setUTCFullYear(windowFrom.getUTCFullYear() - 1);

  const bump = (reason: string) => {
    res.yieldsNull++;
    res.yieldNullReasons[reason] = (res.yieldNullReasons[reason] ?? 0) + 1;
  };

  for (const r of rows) {
    const id = idByIsin.get(r.isin);
    if (!id) continue;

    let ttm: TtmDistribution;
    try {
      const raw = await fetchCorporateActions(r.symbol);
      ttm = foldTtm(raw, asOf);
    } catch (err) {
      // NSE down / rate-limited. Identity and price already landed; the yield is simply unknown.
      bump("fetch_failed");
      await writeAttributes(id, r, null, null, 0, windowFrom, asOf, "fetch_failed");
      await reportIngestionError({
        source: REIT_DISTRIB_SOURCE,
        cron: REITS_CRON,
        guardType: "shape",
        targetTable: TARGET_TABLE,
        targetField: "attributes.distributionYield",
        targetEntity: r.symbol,
        severity: "medium",
        resolutionPath: "source_code",
        expected: "a corporate-actions response from NSE",
        observed: (err as Error).message,
        detail: "Distribution history unreachable — yield is honestly NULL. Identity and price are unaffected.",
        runRef,
        recurring: true,
      });
      continue;
    }

    if (!ttm.ok) {
      bump(ttm.reason);
      await writeAttributes(id, r, null, null, 0, windowFrom, asOf, ttm.reason);

      if (ttm.reason === "unparseable_record") {
        // THE POISONED-SUM CASE. At least one in-window record does not declare a total, so any
        // sum we computed would be WRONG-AND-LOW — an understated yield a user might act on.
        // We refuse to publish it. This is a real fault: NSE changed a subject-line shape.
        res.errors.validity++;
        await reportIngestionError({
          source: REIT_DISTRIB_SOURCE,
          cron: REITS_CRON,
          guardType: "validity",
          targetTable: TARGET_TABLE,
          targetField: "attributes.distributionYield",
          targetEntity: r.symbol,
          severity: "medium",
          resolutionPath: "source_code",
          expected:
            'every in-window distribution to declare a per-unit TOTAL ("Distribution - Rs <X> Per Unit …") that AGREES with its own itemised components',
          observed: ttm.offending
            .map((o) => `${o.exDate} [${o.why}]: "${o.subject}"`)
            .join(" | ")
            .slice(0, 500),
          detail:
            "A trailing-12m record either declares no per-unit total (components-only) or declares one that contradicts its components. Summing only the readable records would UNDERSTATE the yield, so the whole yield is honestly NULL rather than quietly wrong.",
          runRef,
          recurring: true,
        });
      }
      // `no_distributions_in_window` is NOT a fault: a newly-listed trust genuinely has none yet.
      continue;
    }

    const yieldPct = ttm.perUnitTtm / r.close;

    if (checkYieldRange(yieldPct)) {
      // Range-implausible → a parse/price bug, not a spectacular trust. Refuse to store it.
      bump("out_of_range");
      await writeAttributes(id, r, null, ttm.perUnitTtm, ttm.records.length, windowFrom, asOf, "out_of_range");
      res.errors.validity++;
      await reportIngestionError({
        source: REIT_DISTRIB_SOURCE,
        cron: REITS_CRON,
        guardType: "range",
        targetTable: TARGET_TABLE,
        targetField: "attributes.distributionYield",
        targetEntity: r.symbol,
        severity: "medium",
        resolutionPath: "source_code",
        expected: `a trailing-12m distribution yield in (0, ${YIELD_MAX * 100}%]`,
        observed: `${(yieldPct * 100).toFixed(2)}% (₹${ttm.perUnitTtm} over ${ttm.records.length} distribution(s) / close ₹${r.close})`,
        detail: "Implausible yield — stored as NULL. A wrong yield is worse than no yield.",
        runRef,
        recurring: true,
      });
      continue;
    }

    res.yieldsWritten++;
    await writeAttributes(id, r, yieldPct, ttm.perUnitTtm, ttm.records.length, windowFrom, asOf, null);
  }
}

/**
 * Merge the distribution payload into `attributes` (JSONB `||`, so nothing else in there is
 * clobbered). A NULL yield is WRITTEN, with the reason it is null — the page can then say
 * "no distributions in the last 12 months" instead of rendering an ambiguous blank.
 */
async function writeAttributes(
  instrumentId: string,
  row: TrustRow,
  distributionYield: number | null,
  perUnitTtm: number | null,
  records: number,
  windowFrom: Date,
  windowTo: Date,
  nullReason: string | null,
): Promise<void> {
  const payload = {
    series: row.series, // RR | IV — the source's own classification, kept verbatim
    distributionYield, //            null ⇒ honest-empty (never 0, never guessed)
    distributionPerUnitTtm: perUnitTtm,
    distributionRecords: records,
    distributionWindowFrom: windowFrom.toISOString().slice(0, 10),
    distributionWindowTo: windowTo.toISOString().slice(0, 10),
    distributionYieldNullReason: nullReason, // WHY it is empty — honest-empty with a reason
  };

  await prisma.$executeRawUnsafe(
    `UPDATE instruments
        SET attributes = COALESCE(attributes, '{}'::jsonb) || $1::jsonb,
            updated_at = now()
      WHERE id = $2
        AND asset_class IN ('reit'::"AssetClass", 'invit'::"AssetClass")`,
    JSON.stringify(payload),
    instrumentId,
  );
}
