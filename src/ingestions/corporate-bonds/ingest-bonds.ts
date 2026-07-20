// ─────────────────────────────────────────────────────────────
// CORPORATE BONDS / NCDs INGEST (Step 17, Part A) — the fifth lane over the NSE udiff BhavCopy.
//
// IDENTITY-ONLY, BUT NOT VALUE-LESS. There is no detail page and no analytics fold: a bond's story
// is issuer + coupon + maturity + rating, which lives in `attributes` for a holdings row or a picker
// and warrants no page of its own. But a held bond is still owed an honest ₹ figure, and it gets one
// — all 356 of these TRADE, carrying a real close in the same file the trust/ETF/govt lanes read. So
// they flow through the SAME `instrument_prices` table and value correctly under the SAME resolver
// (Step 14.5) with ZERO read-path change.
//
// WHAT THIS LANE DOES NOT DO:
//   · No detail page, no yield curve, no analytics. Nothing here computes a derived number.
//   · No SCORE, ever. stock_id stays NULL → held-not-scored BY CONSTRUCTION (the scoring universe is
//     PeerGroup → StockPeerGroup → Stock and cannot see a stock_id-NULL row). CORPORATE_BONDS_DAILY
//     is deliberately not a switch arm in scoring-triggers.ts. A Vytal Health Score is an EQUITY
//     judgement built on margins/ROCE/leverage/pledge; handing one to an NCD is a category error.
//   · No GOVERNMENT paper. The two fences are COMPLEMENTARY AND DISJOINT, structurally: government
//     paper is the IN0-IN9 ISIN namespace, corporate debt is INE. They cannot overlap even in
//     principle, and Gate 3 proves it (0 shared ISINs).
//   · No fabricated rating. See bond-guards. It is the one number that would do real harm.
//   · No fabricated maturity DAY. Year yes (33% of names); day only where the name spells it out (~1%).
//
// WHY IT READS SEVERAL SESSIONS, AND WHY THE COUNT IS A FLOOR. The BhavCopy lists what TRADED, not
// what is LISTED. Corporate debt is thin — recon measured ~150 rows on one day and 356 across ten,
// and the union was STILL CLIMBING at ~9/session when it stopped. So identity is the UNION over the
// look-back (most recent row per ISIN wins) while each PRICE stays honestly dated to the session it
// actually came from. Because the load is idempotent and NEVER DELETES, the catalogue ACCUMULATES:
// each daily run adds whatever new paper it sees, and the traded universe converges over time
// without anyone having to guess at its true size.
//
// THE NAME UPGRADE (Part B's other half). A bond a BROKER seeded before we ever saw it in a bhavcopy
// carries `name = its tradingsymbol` — genuinely all anyone told us. When that ISIN later PRINTS,
// this ingest's ON CONFLICT … DO UPDATE rewrites `name` to the real FinInstrmNm. The honest
// placeholder is replaced by the honest truth, for free, with no backfill and no special case.
// ─────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import { reportIngestionError } from "../shared/ingestion-error.js";
import { classifyIsin } from "../shared/isin-class.js";
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
  BOND_CRON,
  TARGET_TABLE,
  CLAIMED_BOARDS,
  isCorporateDebt,
  classifyCount,
  checkCloseRange,
  parseBondName,
  MIN_COUPON_PARSE_RATE,
  CLOSE_MIN,
  CLOSE_MAX,
} from "./bond-guards.js";

// Corporate debt is THINNER than government paper (recon: the 10-session union was still growing).
const LOOKBACK_SESSIONS = 10;
const MAX_WALK_BACK = 22;

export interface BondIngestResult {
  ok: boolean;
  abortReason?: string;
  sessions: string[];
  priceDate: string | null;
  /** DISTINCT bonds across the whole look-back — the traded universe, not one day's sample. */
  instruments: number;
  bySecurityType: Record<string, number>;
  created: number;
  updated: number;
  pricesInserted: number;
  /** Attribute coverage. Honest-empty is fine; a COLLAPSE is a fault. */
  couponParsed: number;
  couponExpected: number;
  zeroCoupon: number;
  maturityYearParsed: number;
  maturityDateParsed: number;
  issuerResolved: number;
  /** Rows on an UNCLAIMED board that we deliberately did NOT load, and exactly why. Not faults —
   *  we know precisely what each one is. Counted so a silent exclusion is impossible. */
  excluded: Record<string, number>;
  /** Rows we could NOT classify — an UNKNOWN ISIN security-type. These ARE faults: an unrecognised
   *  code is how the municipal green bonds ("24") nearly got silently dropped. Never again. */
  unrecognised: { isin: string; symbol: string; securityType: string | null; name: string }[];
  skipped: { isin: string; symbol: string; why: string }[];
  errors: { shape: number; count: number; validity: number; uniqueness: number; null_rate: number };
  bytes: number;
  durationMs: number;
}

export async function runBondIngest(opts: { asOf?: Date } = {}): Promise<BondIngestResult> {
  const t0 = Date.now();
  const asOf = opts.asOf ?? new Date();
  const runRef = `${asOf.toISOString().slice(0, 10)}:${UDIFF_SOURCE}:bonds`;

  const res: BondIngestResult = {
    ok: false,
    sessions: [],
    priceDate: null,
    instruments: 0,
    bySecurityType: {},
    created: 0,
    updated: 0,
    pricesInserted: 0,
    couponParsed: 0,
    couponExpected: 0,
    zeroCoupon: 0,
    maturityYearParsed: 0,
    maturityDateParsed: 0,
    issuerResolved: 0,
    excluded: {},
    unrecognised: [],
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
        source: UDIFF_SOURCE, cron: BOND_CRON, guardType: "shape", targetTable: TARGET_TABLE,
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
        source: UDIFF_SOURCE, cron: BOND_CRON, guardType: "shape", targetTable: TARGET_TABLE,
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

    // ── THE TWO-KEY FENCE, applied row by row ──────────────────────────────
    const mine: UdiffRow[] = [];
    for (const r of parsed.rows) {
      // KEY 1 — another lane's board. Not our business, not a fault, not counted.
      if (CLAIMED_BOARDS.has(r.series)) continue;

      // An unclaimed board with NO ISIN: we cannot classify it and cannot key it. An honest gap —
      // but a LOUD one, because a debt row we cannot identify is a hole in the universe.
      if (!r.isin) {
        res.errors.validity++;
        res.skipped.push({ isin: "", symbol: r.symbol, why: "no ISIN on an unclaimed-board row" });
        await reportIngestionError({
          source: UDIFF_SOURCE, cron: BOND_CRON, guardType: "validity", targetTable: TARGET_TABLE,
          targetField: "isin", targetEntity: r.symbol || "(unknown)",
          severity: "high", resolutionPath: "source_code",
          expected: "an ISIN on every row of an unclaimed (non-equity/trust/fund/govt) board",
          observed: `${d.toISOString().slice(0, 10)}: series ${r.series}, symbol "${r.symbol}", no ISIN`,
          detail: "Cannot classify or key a row with no ISIN — REFUSED (no fabricated ISIN). Honest gap.",
          runRef, recurring: true,
        });
        continue;
      }

      // KEY 2 — the ISIN decides. This is the ONLY thing that can admit a row.
      const cls = classifyIsin(r.isin);
      if (cls.kind === "debt") {
        if (!r.usable) {
          // A bond we can identify but cannot read is a FAULT, never a silent drop.
          res.errors.validity++;
          res.skipped.push({ isin: r.isin, symbol: r.symbol, why: r.why ?? "unusable row" });
          await reportIngestionError({
            source: UDIFF_SOURCE, cron: BOND_CRON, guardType: "validity", targetTable: TARGET_TABLE,
            targetField: "close", targetEntity: r.symbol || r.isin,
            severity: "high", resolutionPath: "source_code",
            expected: "a readable OHLC on a corporate-debt row",
            observed: `${d.toISOString().slice(0, 10)}: ${r.observed ?? r.why}`,
            detail: `${r.why} — row REFUSED (no fabricated price).`,
            runRef,
          });
          continue;
        }
        mine.push(r);
        continue;
      }

      // ── NOT DEBT. Two very different reasons, and they get very different treatment. ──
      //
      // (a) We KNOW what it is — an equity on a block-deal board, a preference share, a fund unit,
      //     government paper. It belongs to another lane or to none. COUNTED (so the exclusion is
      //     visible in every run's output) but NOT a fault: nothing is wrong.
      const known =
        cls.kind === "equity" ? "equity (another lane's instrument on an unclaimed board)"
        : cls.namespace === "fund" ? "fund unit (INF namespace)"
        : cls.namespace === "government" ? "government paper (IN0-9 namespace)"
        : cls.securityType && ["04"].includes(cls.securityType) ? "preference share"
        : null;
      if (known) {
        res.excluded[known] = (res.excluded[known] ?? 0) + 1;
        continue;
      }

      // (b) We DO NOT KNOW what it is — an UNRECOGNISED ISIN security-type on an unclaimed board.
      //     THIS IS THE ONE THAT MATTERS. It is exactly how the Indore/Nagpur/Surat municipal green
      //     bonds ("24") behaved before they were classified — and an allow-list would have dropped
      //     them, silently, forever. So it FAULTS: visible, named, with the instrument's own name
      //     attached so an operator can tell in five seconds whether it is debt.
      if (!res.unrecognised.some((u) => u.isin === r.isin)) {
        res.unrecognised.push({ isin: r.isin, symbol: r.symbol, securityType: cls.securityType, name: r.name });
      }
      res.errors.validity++;
      await reportIngestionError({
        source: UDIFF_SOURCE, cron: BOND_CRON, guardType: "validity", targetTable: TARGET_TABLE,
        targetField: "asset_class", targetEntity: r.isin,
        severity: "medium", resolutionPath: "source_code",
        expected: "an ISIN security-type the taxonomy recognises (shared/isin-class.ts)",
        observed: `type "${cls.securityType}" on ${r.isin} — series ${r.series}, "${r.name}"`,
        detail:
          `UNRECOGNISED ISIN security-type — NOT loaded, and NOT guessed in either direction. If this ` +
          `instrument's name describes debt, add "${cls.securityType}" to DEBT_TYPES in shared/isin-class.ts. ` +
          `This is precisely how the municipal green bonds ("24") were caught rather than silently dropped.`,
        runRef, recurring: true,
      });
    }
    sessions.push({ date: d, rows: mine });
  }

  if (sessions.length === 0) {
    res.errors.shape++;
    await reportIngestionError({
      source: UDIFF_SOURCE, cron: BOND_CRON, guardType: "shape", targetTable: TARGET_TABLE,
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
          source: UDIFF_SOURCE, cron: BOND_CRON, guardType: "uniqueness", targetTable: TARGET_TABLE,
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

  const rows = [...latest.values()];
  res.instruments = rows.length;
  for (const { row } of rows) {
    const t = classifyIsin(row.isin).securityType ?? "?";
    res.bySecurityType[t] = (res.bySecurityType[t] ?? 0) + 1;
  }

  // ── 3. COUNT GUARD — on the UNIONED universe, not one session's sample ────
  const verdict = classifyCount(rows.length);
  if (verdict) {
    res.errors.count++;
    await reportIngestionError({
      source: UDIFF_SOURCE, cron: BOND_CRON, guardType: "count", targetTable: TARGET_TABLE,
      severity: verdict.severity, resolutionPath: "source_code",
      expected: "a plausible NSE-traded corporate-debt universe",
      observed: `${rows.length} distinct bonds across ${sessions.length} session(s)`,
      detail: verdict.note,
      runRef,
    });
    if (verdict.severity === "critical") {
      res.abortReason = "count guard (zero corporate-debt rows)";
      res.durationMs = Date.now() - t0;
      return res;
    }
  }

  // ── 4. OVERLAP — never re-class a row that is already something else ──────
  // THE EQUITY-COLLISION BACKSTOP. The fence makes this structurally unreachable (an INE|01 ISIN is
  // classified `equity` and never gets here) — but the ETF INF-collision of Step 13 was also
  // "structurally unreachable" right up until it happened. So we check, and we check against BOTH
  // tables, and a hit is CRITICAL.
  const isins = rows.map(({ row }) => row.isin);
  const [preexisting, asStock] = await Promise.all([
    prisma.instrument.findMany({
      where: { isin: { in: isins }, assetClass: { not: "bond" } },
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
      source: UDIFF_SOURCE, cron: BOND_CRON, guardType: "uniqueness", targetTable: TARGET_TABLE,
      targetField: "isin", targetEntity: p.isin, severity: "critical", resolutionPath: "source_code",
      expected: `${p.isin} to be absent, or already a bond`,
      observed: `already in the catalogue as asset_class=${p.assetClass}`,
      detail: "The ISIN says corporate debt; our catalogue already calls it something else. SKIPPED — an ISIN is ONE instrument, and we do not re-class one silently.",
      runRef, recurring: true,
    });
  }
  for (const s of asStock) {
    blocked.add(s.isin);
    res.errors.uniqueness++;
    await reportIngestionError({
      source: UDIFF_SOURCE, cron: BOND_CRON, guardType: "uniqueness", targetTable: "Stock",
      targetField: "isin", targetEntity: s.symbol, severity: "critical", resolutionPath: "source_code",
      expected: "a corporate-debt ISIN to NEVER exist as a row in `stocks`",
      observed: `${s.isin} is stock ${s.symbol}`,
      detail:
        "A bond in `stocks` enters the scoring universe and would be handed an equity health score built " +
        "on fundamentals a bond does not have. This is the BAYERCROP failure the series-fence would have " +
        "caused — if it fires, the ISIN taxonomy has regressed.",
      runRef, recurring: true,
    });
  }

  const loadable = rows.filter(({ row }) => !blocked.has(row.isin));
  if (loadable.length === 0) {
    res.abortReason = "no loadable rows after guards";
    res.durationMs = Date.now() - t0;
    return res;
  }

  // ── 5. THE ISSUER JOIN — a name we can PROVE, or null ─────────────────────
  // A bond's name ("SEC RE NCD 10% SR 4") is a DESCRIPTION, not a company. The issuer is not parsed
  // out of it — it is RESOLVED, on the ISIN's 7-char issuer stem, against companies we already hold.
  // 191 of the 356 are issued by a company we score (HUDCO, REC, NTPC, PFC, NHPC…). The other 165
  // get a null issuer with the honest reason `not_in_our_universe` — not a guess at a name.
  const stems = [...new Set(loadable.map(({ row }) => row.isin.slice(0, 7)))];
  const issuerRows = await prisma.$queryRawUnsafe<{ stem: string; name: string }[]>(
    `SELECT DISTINCT substring(isin from 1 for 7) AS stem, name FROM stocks WHERE substring(isin from 1 for 7) = ANY($1::text[])`,
    stems,
  );
  const issuerByStem = new Map(issuerRows.map((r) => [r.stem, r.name]));

  // ── 6. RANGE (close) — lands + flags, per the equity path's convention ────
  // targetEntity is "ISIN@SESSION-DATE", NOT the symbol. Two reasons, both load-bearing for the
  // FILL BRIDGE (fill/error-resolution.ts): `instruments.symbol` is not a unique key, and this lane
  // unions a 10-session look-back — so the session a price belongs to is NOT the day the cron ran,
  // and the run date cannot be used to find the row. Without both parts the fill resolves nothing.
  for (const { row, date } of loadable) {
    if (checkCloseRange(row.close)) {
      await reportIngestionError({
        source: UDIFF_SOURCE, cron: BOND_CRON, guardType: "range", targetTable: "InstrumentPrice",
        targetField: "close",
        targetEntity: `${row.isin}@${date.toISOString().slice(0, 10)}`,
        severity: "medium", resolutionPath: "admin_fill",
        expected: `close in [${CLOSE_MIN}, ${CLOSE_MAX}]`,
        observed: `${row.symbol}: close=${row.close} on ${date.toISOString().slice(0, 10)}`,
        detail: "Corporate bond close outside plausible bounds — verify against source. (A bond quotes near FACE: ₹100 / ₹1,000 / ₹100,000.)",
        runRef,
      });
    }
  }

  // ── 7. IDENTITY + ATTRIBUTES upsert ──────────────────────────────────────
  const idByIsin = await upsertIdentity(loadable, issuerByStem, res);

  // ── 8. NULL-RATE GUARD on the COUPON parse ───────────────────────────────
  if (res.couponExpected > 0) {
    const rate = res.couponParsed / res.couponExpected;
    if (rate < MIN_COUPON_PARSE_RATE) {
      res.errors.null_rate++;
      await reportIngestionError({
        source: UDIFF_SOURCE, cron: BOND_CRON, guardType: "null_rate", targetTable: TARGET_TABLE,
        targetField: "attributes.coupon", severity: "medium", resolutionPath: "source_code",
        expected: `≥${(MIN_COUPON_PARSE_RATE * 100).toFixed(0)}% of names to yield a coupon (92.7% at recon)`,
        observed: `${(rate * 100).toFixed(1)}% (${res.couponParsed}/${res.couponExpected})`,
        detail:
          "The coupon is parsed out of FinInstrmNm (there is no coupon COLUMN). A collapse means NSE changed " +
          "its naming — identity and price are unaffected; the attributes went honestly null.",
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
  issuerByStem: Map<string, string>,
  res: BondIngestResult,
): Promise<Map<string, string>> {
  const values: unknown[] = [];
  const tuples: string[] = [];
  const STRIDE = 6;

  rows.forEach(({ row, date }, n) => {
    const b = n * STRIDE;
    const issuer = issuerByStem.get(row.isin.slice(0, 7)) ?? null;
    const attrs = parseBondName(row.series, row.name, row.isin, issuer);

    // Attribute coverage, measured — so the null-rate guard judges something real.
    res.couponExpected++;
    if (attrs.coupon != null) res.couponParsed++;
    if (attrs.coupon === 0) res.zeroCoupon++; // a REAL zero-coupon bond. Not a null. The distinction is the point.
    if (attrs.maturityYear != null) res.maturityYearParsed++;
    if (attrs.maturityDate != null) res.maturityDateParsed++;
    if (attrs.issuer != null) res.issuerResolved++;

    // asset_class is a LITERAL 'bond' here, never a bound parameter and never interpolated from the
    // row: this lane loads exactly one class, and the SQL should be unable to express any other.
    tuples.push(
      `(gen_random_uuid()::text, $${b + 1}, $${b + 2}, $${b + 3}, 'bond'::"AssetClass", NULL, $${b + 4}::jsonb, true, ` +
        `$${b + 5}::decimal, $${b + 6}::date, now(), now())`,
    );
    values.push(
      row.isin, //             1
      row.symbol, //           2  a bond HAS an exchange ticker (740IIFCL33, 1025SCL34)
      row.name, //             3  FinInstrmNm — and THE NAME UPGRADE for a broker-seeded row (see header)
      JSON.stringify(attrs), //4  → attributes (display-only; every null carries a REASON)
      row.close, //            5  → last_price
      date, //                 6  → last_price_date (the session it TRADED, not today)
    );
  });

  const sql = `
    INSERT INTO instruments (
      id, isin, symbol, name, asset_class, stock_id, attributes, is_active,
      last_price, last_price_date, created_at, updated_at
    ) VALUES ${tuples.join(",")}
    ON CONFLICT (isin) DO UPDATE SET
      symbol      = EXCLUDED.symbol,
      -- THE NAME UPGRADE. A broker-seeded bond carries its TRADINGSYMBOL as a name (all anyone told
      -- us). The first time it prints in a bhavcopy, this replaces it with the real FinInstrmNm.
      name        = EXCLUDED.name,
      attributes  = EXCLUDED.attributes,

      -- THE SNAPSHOT MOVES FORWARD ONLY. A backfill of an older session must not overwrite a newer
      -- close with a staler one, and the two columns move TOGETHER — re-dating a stale price as
      -- fresh is the one lie last_price_date exists to prevent.
      last_price = CASE
        WHEN instruments.last_price_date IS NULL OR EXCLUDED.last_price_date >= instruments.last_price_date
        THEN EXCLUDED.last_price ELSE instruments.last_price END,
      last_price_date = CASE
        WHEN instruments.last_price_date IS NULL OR EXCLUDED.last_price_date >= instruments.last_price_date
        THEN EXCLUDED.last_price_date ELSE instruments.last_price_date END,

      updated_at = now()
    -- THE CLASS FENCE. An overlapping ISIN was already skipped upstream; this is the belt to that
    -- braces. Even if one slipped through, this ingest physically CANNOT rewrite a stock, a fund, an
    -- ETF, a trust or a government row. asset_class is deliberately NOT in the SET list either — a
    -- bond ingest may never re-class an existing instrument, only ever fill in a bond.
    WHERE instruments.asset_class = 'bond'::"AssetClass"
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

  // APPEND-ONLY, keyed (instrument_id, date) — the same spine the trust/ETF/govt lanes write to.
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
