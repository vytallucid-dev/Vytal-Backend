// ═══════════════════════════════════════════════════════════════
// AMFI FUND INGEST (Step 9 = MF · Step 13 = ETF) — Layers A (identity) + B (current NAV).
//
// Fetch NAVAll.txt → stateful parse → one catalogue row PER VALID ISIN.
//
// WHAT LANDS: an `instruments` row with stock_id=NULL, carrying the FULL AMFI payload —
// amfi_scheme_code (the Layer-C NAV-history join key), scheme_name (raw, the material for a
// LATER family derivation), fund_house, category, plan_type, current_nav, nav_date.
//
// ── STEP 13: ONE LOADER, TWO PASSES ───────────────────────────────────────────────────
// An ETF is an AMFI-registered fund that happens to trade on an exchange. Its identity, its
// scheme code and its NAV all come from THIS FILE, out of the 4 ETF sections Step 9 excluded.
// So Step 13 is not a new loader — it is THIS loader with the section filter INVERTED:
//
//     mutual_fund  →  keep !row.isEtfSection   (13,879 rows → 17,567 ISINs)
//     etf          →  keep  row.isEtfSection   (   337 rows →    337 ISINs)
//
// The two filters are exact complements, so the passes PARTITION the file — no row is loaded
// twice, no row is dropped. Parameterising (rather than forking) is what makes the MF path's
// behaviour structurally unchanged: it is the same code, running the same way, with the same
// literal it always had.
//
// THE ONLY CLASS-DEPENDENT BEHAVIOURS, all of them here and nowhere else:
//   · the section filter (above)
//   · the asset_class written, the upsert's fence, and the dormancy sweep's scope
//   · the cron tag on error rows (so the two passes' `recurring` dedup never bleeds together)
//   · SYMBOL. A mutual fund has no ticker and gets NULL, forever. An ETF HAS one — joined in
//     from NSE's eq_etfseclist by ISIN (327/337; the 10 misses are BSE-listed or matured and
//     get an honest NULL). See etf-seclist-source.ts.
//
// THE FAULT / HONEST-EMPTY LINE — the whole point of this module:
//   "-" or blank ISIN (170 rows) → NO row, NO error. AMFI is telling us that plan does not
//                                  exist. An absence is not a fault.
//   junk ISIN ("Redeemed", …)     → IngestionError(validity, source_code) + skip. Present,
//                                  but not the kind of thing it claims to be.
//   ISIN under 2 scheme codes (5) → IngestionError(uniqueness, source_code) + deterministic
//                                  tie-break (most recent nav_date wins; then lowest code).
//                                  instruments.isin is UNIQUE — the loser CANNOT land, so it
//                                  is reported, never silently lost.
//   malformed NAV                 → IngestionError(validity, admin_fill) + the row still lands,
//                                  KEEPING its last known NAV + old nav_date (carry-forward).
//                                  The identity is good; only tonight's value is bad, and a NAV
//                                  is the one thing an admin CAN honestly fill (an ISIN cannot).
//   blank / "N.A." NAV            → CARRY-FORWARD: the stored NAV + its old nav_date STAND.
//                                  NOT a fault. NEVER coerced to 0. NEVER nulled.
//   STALE NAV (5,551 dormant)     → NOT a fault. is_active=false + nav_date carry it. Emitting
//                                  5,551 errors would bury an 11-row triage queue.
//
// ── STEP-10 CHANGES TO THIS FILE ──────────────────────────────────────────────────
//   (1) THE BLANK-NAV-WIPE FIX. The upsert's current_nav/nav_date SET clauses were
//       UNCONDITIONAL, so a blank NAV from AMFI overwrote a real stored NAV with NULL —
//       destroying the value instead of carrying it forward. Now COALESCE-guarded. See the
//       upsert at the bottom of this file.
//   (2) DORMANCY 30d (was 7) + a sweep, so a scheme that vanishes from the file entirely
//       still goes dormant rather than staying "active" on a NAV that stopped moving.
//   (3) RECURRING-FAULT dedup on the known AMFI quirks, so the same 15 junk cells stop
//       opening 15 fresh error rows every night (~5,475/yr).
//   (4) A RUN-LOG (mf_fetch_logs) — this cron shipped with none.
//
// WHY ISIN FAULTS ARE source_code, NOT admin_fill: a hand-typed ISIN poisons the spine.
// universe-admit.ts states the discipline — "a fabricated ISIN would be accepted by the
// unique index and would look fine — until the real security arrived". An admin cannot type
// their way out of AMFI's data bug; only AMFI (or our source code) can fix it.
//
// LOG-AND-CONTINUE: one bad row records + skips; the ~17.5k good rows load; the batch succeeds.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { reportIngestionError } from "../shared/ingestion-error.js";
import { fetchNavAll, AMFI_NAVALL_URL } from "./amfi-source.js";
import {
  parseNavAll, parseAmfiDate, parseNav, parsePlanType,
  AMFI_ISIN, AMFI_HEADER, AMFI_SOURCE, AMFI_CRON, ETF_CRON,
  type AmfiRow,
} from "./amfi-parse.js";
import {
  fetchEtfSeclist, parseEtfSeclist,
  NSE_ETF_SOURCE, NSE_ETF_SECLIST_URL, NSE_ETF_HEADER,
} from "./etf-seclist-source.js";

/** The catalogue table the guards protect (and the fill bridge edits). */
const TARGET_TABLE = "Instrument";

/**
 * The two AMFI-sourced fund classes. Both are held-NOT-scored: stock_id is NULL, so no peer
 * group, no Vytal Health Score. A fund gets a native rating; it never gets an equity score.
 *
 * This union is also the injection fence: it is interpolated into SQL below (Postgres cannot
 * bind a parameter to an enum position cleanly), and being a closed set of two literals is what
 * makes that safe. `assertFundClass` re-checks it at runtime so a future `as any` cannot slip.
 */
export type FundClass = "mutual_fund" | "etf";

const FUND_CLASSES: readonly FundClass[] = ["mutual_fund", "etf"] as const;

function assertFundClass(cls: FundClass): FundClass {
  if (!FUND_CLASSES.includes(cls)) throw new Error(`ingest-amfi: refusing unknown fund class "${cls}"`);
  return cls;
}

/**
 * DORMANCY THRESHOLD (Step-10 ruling): a scheme is ACTIVE if its NAV is within this many days
 * of the file's newest NAV. Beyond it, the fund is DORMANT — its last real NAV stays, with its
 * real old date, is_active=false, and it is never carried forward as fresh.
 *
 * 30 days, not the 7 this shipped with. Recon measured the staleness distribution and found it
 * cleanly BIMODAL with an empty valley between the modes:
 *     ≤3 days      8,149 codes (59.5%)  — reporting
 *     4–30 days       31 codes ( 0.2%)  — the ENTIRE ambiguous zone
 *     31–365 days    191 codes ( 1.4%)
 *     >1 year      5,333 codes (38.9%)  — long dead
 * Any cut between ~8 and ~30 days classifies within ~30 schemes of any other, so the choice is
 * robust. 30 is the generous end: it survives a fund that only prices monthly, and the valley
 * means that generosity costs nothing in precision.
 */
const STALE_AFTER_DAYS = 30;

/** Sanity band for the row count. Outside it the file is probably not the file. */
const MIN_ROWS = 5_000;
const MAX_ROWS = 30_000;

export interface AmfiIngestResult {
  ok: boolean;
  assetClass: FundClass;
  bytes: number;
  totalRows: number;
  /** Rows belonging to the OTHER class's sections — excluded by this pass's filter. */
  otherClassRows: number;
  /** Rows in THIS pass's sections. */
  classRows: number;
  /** "-"/blank ISIN cells — skipped with NO error (honest-empty). */
  honestEmptySkips: number;
  candidates: number;
  created: number;
  updated: number;
  errors: { shape: number; count: number; validity: number; uniqueness: number };
  activeRows: number;
  staleRows: number;
  /** Rows whose is_active flipped in the 30-day dormancy sweep. */
  dormancyFlips: number;
  maxNavDate: string | null;
  /** ETF pass only: ISINs that resolved to an NSE ticker / that honestly have none. */
  tickersResolved: number;
  tickersMissing: number;
  abortReason?: string;
}

/** One row we intend to write. */
interface Candidate {
  isin: string;
  symbol: string | null; // NULL for a mutual fund (no ticker); the NSE ticker for an ETF
  schemeCode: string;
  schemeName: string;
  fundHouse: string | null;
  category: string | null;
  planType: string | null;
  nav: string | null; // decimal string, or null (absent/malformed)
  navDate: Date | null;
  isActive: boolean;
}

/** Step 9's entry point — the MF pass. Unchanged in behaviour; it is this loader at cls=mutual_fund. */
export function runAmfiNavIngest(): Promise<AmfiIngestResult> {
  return runFundIngest("mutual_fund");
}

/** Step 13's entry point — the ETF pass. The same loader, section filter inverted. */
export function runEtfNavIngest(): Promise<AmfiIngestResult> {
  return runFundIngest("etf");
}

export async function runFundIngest(cls: FundClass): Promise<AmfiIngestResult> {
  assertFundClass(cls);
  const isEtf = cls === "etf";
  const cron = isEtf ? ETF_CRON : AMFI_CRON;

  const res: AmfiIngestResult = {
    ok: false, assetClass: cls, bytes: 0, totalRows: 0, otherClassRows: 0, classRows: 0,
    honestEmptySkips: 0, candidates: 0, created: 0, updated: 0,
    errors: { shape: 0, count: 0, validity: 0, uniqueness: 0 },
    activeRows: 0, staleRows: 0, dormancyFlips: 0, maxNavDate: null,
    tickersResolved: 0, tickersMissing: 0,
  };
  const runRef = new Date().toISOString().slice(0, 10) + (isEtf ? ":etf" : ":amfi");

  // ── FETCH ──────────────────────────────────────────────────
  const fetched = await fetchNavAll();
  res.bytes = fetched.bytes;
  if (fetched.status !== 200 || fetched.bytes === 0) {
    res.errors.shape++;
    await reportIngestionError({
      source: AMFI_SOURCE, cron, guardType: "shape",
      targetTable: TARGET_TABLE, severity: "critical", resolutionPath: "source_code",
      expected: `HTTP 200 with a non-empty body from ${AMFI_NAVALL_URL}`,
      observed: `HTTP ${fetched.status}, ${fetched.bytes} bytes`,
      detail: "AMFI NAVAll.txt unreachable or empty — nothing ingested (no partial write).",
      runRef,
    });
    res.abortReason = "fetch failed";
    return res;
  }

  // ── PARSE ──────────────────────────────────────────────────
  const parsed = parseNavAll(fetched.body);
  res.totalRows = parsed.rows.length;

  // GUARD 1 — SHAPE. A column rename means our indices point at the wrong fields; we would
  // write a NAV into a name. Reject the whole run rather than ingest garbage.
  if (parsed.headerLine !== AMFI_HEADER) {
    res.errors.shape++;
    await reportIngestionError({
      source: AMFI_SOURCE, cron, guardType: "shape",
      targetTable: TARGET_TABLE, severity: "critical", resolutionPath: "source_code",
      expected: AMFI_HEADER,
      observed: parsed.headerLine ?? "(no column header found)",
      detail: "AMFI column header changed. Column indices would be wrong → REJECTED the run rather than write mis-mapped fields.",
      runRef,
    });
    res.abortReason = "shape guard";
    return res;
  }

  // GUARD 2 — COUNT. Zero/absurd row counts mean an error page or a truncated file.
  if (parsed.rows.length < MIN_ROWS || parsed.rows.length > MAX_ROWS) {
    res.errors.count++;
    await reportIngestionError({
      source: AMFI_SOURCE, cron, guardType: "count",
      targetTable: TARGET_TABLE, severity: "critical", resolutionPath: "source_code",
      expected: `${MIN_ROWS}–${MAX_ROWS} scheme rows`,
      observed: `${parsed.rows.length} rows`,
      detail: "AMFI row count outside the sane band — REJECTED (a truncated file must not wipe the catalogue's NAVs).",
      runRef,
    });
    res.abortReason = "count guard";
    return res;
  }

  // ── THE SECTION FILTER — the ONE line that separates Step 9 from Step 13. ──
  // Exact complements, so the two passes partition the file (13,879 + 337 = 14,216). The class
  // comes from the SECTION HEADER, never from the scheme name: recon measured the name at 50.5%
  // precision ("… Silver ETF FOF" is a fund-of-funds that INVESTS in ETFs — an MF — and 13
  // genuine NSE-listed ETFs have no "ETF" in their AMFI name at all).
  const rows = parsed.rows.filter((r) => (isEtf ? r.isEtfSection : !r.isEtfSection));
  res.otherClassRows = parsed.rows.length - rows.length;
  res.classRows = rows.length;

  // ── ETF ONLY: the NSE ticker join (SECONDARY — AMFI is the identity spine) ──
  // Resolved BEFORE the write so a ticker lands with the row it belongs to. A failed fetch is a
  // FAULT but NOT an abort: identity still lands, and every ETF keeps the ticker it already had
  // (the upsert COALESCEs symbol, so an empty map cannot wipe 327 tickers).
  const tickerByIsin = isEtf ? await loadEtfTickers(res, runRef) : new Map<string, string>();

  // ── EMIT one candidate per VALID ISIN cell (a scheme code yields up to 2) ──
  const byIsin = new Map<string, Candidate[]>();
  const navFaults: { isin: string; schemeCode: string; raw: string }[] = [];

  for (const row of rows) {
    const nav = parseNav(row.navRaw);
    const navDate = parseAmfiDate(row.dateRaw);
    const planType = parsePlanType(row.schemeName);

    for (const raw of [row.isinGrowth, row.isinReinvest]) {
      if (raw === null) {
        res.honestEmptySkips++; // "-" — this plan does not exist. Not a fault.
        continue;
      }
      if (!AMFI_ISIN.test(raw)) {
        res.errors.validity++;
        await reportValidityIsin(row, raw, runRef, cron);
        continue;
      }
      // A mutual fund HAS no ticker → NULL, always. An ETF has one → look it up; a miss is an
      // honest NULL (BSE-listed / matured), never a guess. A wrong ticker is a wrong instrument.
      const symbol = isEtf ? (tickerByIsin.get(raw) ?? null) : null;
      if (isEtf) {
        if (symbol) res.tickersResolved++;
        else res.tickersMissing++;
      }
      const c: Candidate = {
        isin: raw,
        symbol,
        schemeCode: row.schemeCode,
        schemeName: row.schemeName,
        fundHouse: row.fundHouse,
        category: row.category,
        planType,
        nav: nav.kind === "value" ? nav.nav : null,
        navDate,
        isActive: true, // recomputed below, once the file's newest NAV date is known
      };
      if (nav.kind === "malformed") navFaults.push({ isin: raw, schemeCode: row.schemeCode, raw: nav.raw });
      const list = byIsin.get(raw);
      if (list) list.push(c);
      else byIsin.set(raw, [c]);
    }
  }

  // ── UNIQUENESS: one ISIN under two scheme codes cannot land twice (isin is UNIQUE) ──
  const candidates: Candidate[] = [];
  for (const [isin, group] of byIsin) {
    if (group.length === 1) {
      candidates.push(group[0]!);
      continue;
    }
    const codes = [...new Set(group.map((g) => g.schemeCode))];
    if (codes.length === 1) {
      // Same scheme code listed the ISIN in both columns — not a collision, just a dup cell.
      candidates.push(group[0]!);
      continue;
    }
    // Deterministic tie-break: most recent nav_date wins; ties → lowest scheme code.
    const winner = [...group].sort((a, b) => {
      const ad = a.navDate?.getTime() ?? -Infinity;
      const bd = b.navDate?.getTime() ?? -Infinity;
      if (ad !== bd) return bd - ad;
      return a.schemeCode.localeCompare(b.schemeCode);
    })[0]!;
    candidates.push(winner);

    res.errors.uniqueness++;
    await reportIngestionError({
      source: AMFI_SOURCE, cron, guardType: "uniqueness",
      targetTable: TARGET_TABLE, targetField: "isin", targetEntity: isin,
      severity: "medium", resolutionPath: "source_code",
      expected: `ISIN ${isin} to belong to exactly ONE AMFI scheme code`,
      observed: `it appears under ${codes.length}: ${codes.join(", ")}`,
      detail:
        `AMFI data-entry error. instruments.isin is UNIQUE, so only one row can land. ` +
        `Kept scheme ${winner.schemeCode} (most recent NAV ${winner.navDate?.toISOString().slice(0, 10) ?? "none"}); ` +
        `dropped ${codes.filter((c) => c !== winner.schemeCode).join(", ")}. ` +
        `NOT admin-fillable: a hand-typed ISIN poisons the spine — only AMFI can fix this.`,
      runRef,
      recurring: true, // the same 5 collisions ship nightly; unchanged evidence stays triaged
    });
  }
  res.candidates = candidates.length;

  // ── STALENESS: is_active is derived from the file's own newest NAV date, not "today" ──
  const dates = candidates.map((c) => c.navDate?.getTime()).filter((t): t is number => t != null);
  const maxNav = dates.length ? Math.max(...dates) : null;
  res.maxNavDate = maxNav ? new Date(maxNav).toISOString().slice(0, 10) : null;
  const cutoff = maxNav != null ? maxNav - STALE_AFTER_DAYS * 86_400_000 : null;
  for (const c of candidates) {
    c.isActive = cutoff != null && c.navDate != null && c.navDate.getTime() >= cutoff;
    if (c.isActive) res.activeRows++;
    else res.staleRows++;
  }

  // ── OVERLAP GUARD: an INF ISIN may exist ONLY as a fund (mutual_fund | etf) ──
  // Equities are INE, funds are INF — so an INF ISIN wearing any OTHER asset class is a real
  // fault, and a silent collision would let this upsert rewrite a stock. Checked, not assumed.
  //
  // ⚠️  STEP-13 WIDENING, AND IT IS NOT COSMETIC. This guard used to read `asset_class <>
  //     'mutual_fund'`. The night Step 13 lands 337 etf rows — every one an INF ISIN, by
  //     construction — that predicate would have matched ALL of them and opened a CRITICAL
  //     IngestionError EVERY NIGHT, forever, for the catalogue working exactly as designed. The
  //     guard's INTENT was always "an INF ISIN must be a FUND"; 'mutual_fund' was merely the only
  //     fund class that existed when it was written. Widening it to the fund classes restores the
  //     intent — and it keeps its teeth: an ETF wrongly admitted as a bare `stock` by the broker
  //     sync (the Step-7 bug this step also fixes) is still caught, loudly.
  const trespass = await prisma.$queryRawUnsafe<{ isin: string; asset_class: string }[]>(
    `SELECT isin, asset_class::text FROM instruments
      WHERE asset_class NOT IN ('mutual_fund'::"AssetClass", 'etf'::"AssetClass")
        AND isin LIKE 'INF%'`,
  );
  if (trespass.length) {
    res.errors.uniqueness++;
    await reportIngestionError({
      source: AMFI_SOURCE, cron, guardType: "uniqueness",
      targetTable: TARGET_TABLE, targetField: "isin",
      severity: "critical", resolutionPath: "source_code",
      expected: "no INF-prefixed (fund) ISIN to exist under a non-fund asset class",
      observed: `${trespass.length}: ${trespass.slice(0, 5).map((t) => `${t.isin}=${t.asset_class}`).join(", ")}`,
      detail:
        `A fund ISIN is catalogued as something that is not a fund (most likely an ETF admitted ` +
        `as a bare stock by a broker sync). This upsert is fenced (WHERE asset_class='${cls}'), ` +
        `so nothing was overwritten — but the row must be reconciled: it is a fund wearing an ` +
        `equity's clothes, and the scoring engine has no business seeing it.`,
      runRef,
    });
  }

  // ── WRITE: bulk upsert on the ISIN spine, FENCED so a row of any OTHER class is untouchable ──
  const written = await upsertCandidates(candidates, cls);
  res.created = written.created;
  res.updated = written.updated;

  // ── NAV faults: the row landed (identity is fine); only the value is missing. ──
  // Reported AFTER the write so the fill bridge can resolve targetEntity=isin → a real row.
  for (const f of navFaults) {
    res.errors.validity++;
    await reportIngestionError({
      source: AMFI_SOURCE, cron, guardType: "validity",
      targetTable: TARGET_TABLE, targetField: "currentNav", targetEntity: f.isin,
      severity: "medium", resolutionPath: "admin_fill",
      expected: "a numeric NAV",
      observed: `"${f.raw}" (scheme ${f.schemeCode})`,
      detail: "NAV is present but unparseable. The instrument row LANDED keeping its LAST KNOWN current_nav + its OLD nav_date (carry-forward) — identity is good, only tonight's value is bad. Admin-fillable (a NAV can be honestly sourced + cited; an ISIN cannot).",
      runRef,
      recurring: true, // AMFI reships the same bad cell nightly — don't reopen a fresh row each time
    });
  }

  // ── DORMANCY SWEEP (Step-10 ruling: 30 days) ────────────────
  // The upsert above only touches schemes PRESENT in tonight's file. A scheme that vanishes
  // from the file entirely would otherwise keep is_active=true forever on a NAV that stopped
  // moving years ago. This sweep derives is_active for THIS CLASS's whole catalogue from nav_date
  // vs the file's own newest NAV date — so "present but stale" and "absent entirely" reach the
  // same, correct, dormant state.
  //
  // SCOPED TO THIS PASS'S CLASS (Step 13). The MF pass must not sweep ETFs and vice-versa: each
  // pass only knows its own sections' newest NAV date, and sweeping a class you did not read is
  // how you mark a live fund dormant on someone else's evidence. It also means a delisted ETF now
  // goes dormant at all — before this, the sweep was fenced to mutual_fund and an ETF that fell
  // out of the file would have stayed is_active=true forever on a frozen NAV.
  //
  // It reads the FILE's newest date, never `now()`: if AMFI publishes late, or we re-run an old
  // file, the whole catalogue must not flip dormant because the wall clock moved.
  if (maxNav != null) {
    res.dormancyFlips = await prisma.$executeRawUnsafe(
      `UPDATE instruments
          SET is_active = ($1::date - nav_date) <= $2, updated_at = now()
        WHERE asset_class = '${cls}'::"AssetClass"
          AND nav_date IS NOT NULL
          AND is_active <> (($1::date - nav_date) <= $2)`,
      new Date(maxNav),
      STALE_AFTER_DAYS,
    );
  }

  res.ok = true;
  return res;
}

/**
 * ETF TICKER JOIN (Step 13) — NSE eq_etfseclist, keyed on ISIN.
 *
 * DEGRADES, NEVER BLOCKS. NSE is the SECONDARY source here: it supplies the exchange symbol and
 * nothing else. If it is down, renamed, or truncated, that is a FAULT worth an operator's eye —
 * but ETF IDENTITY still lands, because identity comes from AMFI. We return an empty map, the
 * upsert's `symbol = COALESCE(EXCLUDED.symbol, instruments.symbol)` carries every existing ticker
 * forward untouched, and the catalogue is simply no worse off than it was this morning.
 *
 * The alternative — aborting the ETF ingest because a ticker file 404'd — would let a secondary
 * source hold the primary one hostage. That is exactly backwards.
 */
async function loadEtfTickers(res: AmfiIngestResult, runRef: string): Promise<Map<string, string>> {
  const fail = async (expected: string, observed: string, detail: string) => {
    res.errors.shape++;
    await reportIngestionError({
      source: NSE_ETF_SOURCE, cron: ETF_CRON, guardType: "shape",
      targetTable: TARGET_TABLE, targetField: "symbol",
      severity: "medium", resolutionPath: "source_code",
      expected, observed,
      detail:
        `${detail} ETF IDENTITY WAS NOT BLOCKED — AMFI is the spine and it landed. Every ETF ` +
        `kept the ticker it already had (the upsert COALESCEs symbol, so an empty join cannot ` +
        `wipe them). Only NEW ETFs from tonight are missing a ticker until this is fixed.`,
      runRef,
      recurring: true, // an NSE outage reships nightly; unchanged evidence stays triaged
    });
    return new Map<string, string>();
  };

  let fetched;
  try {
    fetched = await fetchEtfSeclist();
  } catch (err) {
    return fail(
      `a readable CSV from ${NSE_ETF_SECLIST_URL}`,
      `fetch threw: ${(err as Error).message}`,
      "NSE ETF security list unreachable.",
    );
  }

  if (fetched.status !== 200 || fetched.bytes === 0) {
    return fail(
      `HTTP 200 with a non-empty body from ${NSE_ETF_SECLIST_URL}`,
      `HTTP ${fetched.status}, ${fetched.bytes} bytes`,
      "NSE ETF security list unreachable or empty.",
    );
  }

  const parsed = parseEtfSeclist(fetched.body);
  if (!parsed.ok) {
    return fail(
      parsed.reason === "shape" ? NSE_ETF_HEADER : "100–2,000 ETF rows",
      parsed.observed,
      parsed.reason === "shape"
        ? "NSE ETF security-list column header changed — column indices would be wrong, so the ticker join was REFUSED rather than run against mis-mapped fields."
        : "NSE ETF security list came back truncated or absurd.",
    );
  }

  return parsed.byIsin;
}

/** Junk in the ISIN column: present, but not an ISIN. Dedups per (scheme code, column). */
async function reportValidityIsin(row: AmfiRow, raw: string, runRef: string, cron: string) {
  await reportIngestionError({
    source: AMFI_SOURCE, cron, guardType: "validity",
    targetTable: TARGET_TABLE, targetField: "isin", targetEntity: row.schemeCode,
    severity: "medium", resolutionPath: "source_code",
    expected: "an ISIN matching /^INF[A-Z0-9]{9}$/",
    observed: `"${raw}"`,
    detail:
      `AMFI shipped a non-ISIN in the ISIN column for scheme ${row.schemeCode} ` +
      `("${row.schemeName}", line ${row.lineNo}). NO catalogue row was created — a fabricated ` +
      `identity is worse than an honest gap. NOT admin-fillable: a hand-typed ISIN poisons the spine.`,
    runRef,
    // AMFI reships these same 10 junk cells ("Redeemed" ×9, "HDFCNIVODG" ×1) EVERY night. Once
    // triaged, an unchanged re-trip bumps the count and stays closed. If the junk CHANGES, a
    // fresh row opens — the suppression is scoped to the exact evidence, never to the guard.
    recurring: true,
  });
}

/**
 * Bulk INSERT … ON CONFLICT (isin) DO UPDATE, chunked.
 *
 * THE FENCE: `WHERE instruments.asset_class = '<cls>'`. If an AMFI ISIN ever collided with a row
 * of ANY other class, the UPDATE is simply NOT APPLIED — the 504 stocks cannot be rewritten by
 * this ingest, at the SQL level, no matter what AMFI ships. (The overlap guard above reports it.)
 *
 * STEP 13 makes the fence per-class, which also means the two passes cannot cross-write: the MF
 * pass physically cannot touch an `etf` row, and the ETF pass cannot touch a `mutual_fund` one.
 * Since the section filters are exact complements, neither pass ever even PRESENTS a candidate
 * for the other's rows — but the fence means it would be refused if it did.
 *
 * `RETURNING (xmax = 0)` distinguishes an INSERT from an UPDATE, so a re-run can prove it
 * created 0 new rows.
 */
async function upsertCandidates(
  rows: Candidate[],
  cls: FundClass,
): Promise<{ created: number; updated: number }> {
  assertFundClass(cls); // `cls` is interpolated below — re-check the closed set at the SQL seam
  let created = 0;
  let updated = 0;
  const CHUNK = 500; // 11 params/row → 5,500 params/statement, well under Postgres' 65,535

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples: string[] = [];

    chunk.forEach((c, n) => {
      const b = n * 11;
      tuples.push(
        `(gen_random_uuid()::text, $${b + 1}, $${b + 2}, $${b + 3}, '${cls}'::"AssetClass", NULL, NULL, ` +
          `$${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}::decimal, $${b + 11}::date, now(), now())`,
      );
      values.push(
        c.isin,          //  1
        c.symbol,        //  2  → symbol (NULL for an MF — no ticker; the NSE ticker for an ETF)
        c.schemeName,    //  3  → name (the catalogue's display identity IS the scheme name)
        c.isActive,      //  4
        c.schemeCode,    //  5  → amfi_scheme_code
        c.schemeName,    //  6  → scheme_name (raw, for LATER family derivation)
        c.fundHouse,     //  7
        c.category,      //  8
        c.planType,      //  9
        c.nav,           // 10  (null ⇒ honest-NULL, never 0)
        c.navDate,       // 11
      );
    });

    const sql = `
      INSERT INTO instruments (
        id, isin, symbol, name, asset_class, stock_id, attributes, is_active,
        amfi_scheme_code, scheme_name, fund_house, category, plan_type, current_nav, nav_date,
        created_at, updated_at
      ) VALUES ${tuples.join(",")}
      ON CONFLICT (isin) DO UPDATE SET
        name             = EXCLUDED.name,
        scheme_name      = EXCLUDED.scheme_name,
        fund_house       = EXCLUDED.fund_house,
        category         = EXCLUDED.category,
        plan_type        = EXCLUDED.plan_type,
        amfi_scheme_code = EXCLUDED.amfi_scheme_code,

        -- ══ SYMBOL (Step 13) — CARRY-FORWARD, for the same reason the NAV is. ══
        -- An MF's symbol is ALWAYS NULL (a fund has no ticker), so for the MF pass EXCLUDED.symbol
        -- is NULL on every row and this COALESCE resolves to instruments.symbol — i.e. it leaves
        -- the column exactly as it found it, which is precisely what the MF upsert did before
        -- Step 13 (symbol was absent from this SET list entirely). The MF path is unchanged.
        --
        -- For an ETF it is load-bearing: NSE's eq_etfseclist is a SECONDARY source, and if it is
        -- down the join returns an empty map. Assigning EXCLUDED.symbol unconditionally would
        -- then NULL all 327 resolved tickers in one night — the blank-NAV-wipe bug, reborn in a
        -- new column. COALESCE means a live ticker replaces the stored one and an absent join
        -- leaves it alone. The 10 ETFs that genuinely have no NSE ticker (BSE-listed / matured)
        -- stay honestly NULL: they never had one to carry forward.
        symbol = COALESCE(EXCLUDED.symbol, instruments.symbol),

        -- ══ CARRY-FORWARD (Step-10 ruling). THIS IS THE BLANK-NAV-WIPE FIX. ══
        -- These two SET clauses used to be UNCONDITIONAL. So the night AMFI shipped a scheme
        -- with a blank / "N.A." NAV, EXCLUDED.current_nav was NULL and the fund's last known
        -- NAV was OVERWRITTEN WITH NULL — the value destroyed, not carried forward. Recon
        -- measured the blast radius at 0 rows on that night's file (AMFI happened to price
        -- everything), but 2016's history window carried 4,431 blank-NAV rows: this WAS going
        -- to fire, and when it did it would have silently emptied real NAVs.
        --
        -- COALESCE makes the overwrite CONDITIONAL: a real incoming NAV replaces the stored
        -- one; an absent NAV LEAVES IT ALONE. The old value and its old nav_date both stand,
        -- honestly stale. That IS carry-forward — no new column, no new job, no synthetic row.
        --
        -- The two columns move TOGETHER, deliberately. Updating nav_date while keeping an old
        -- NAV would re-date a stale price as fresh, which is the one lie the whole ruling exists
        -- to prevent: nav_date must always tell the truth about the NAV sitting beside it.
        current_nav = COALESCE(EXCLUDED.current_nav, instruments.current_nav),
        nav_date    = CASE WHEN EXCLUDED.current_nav IS NOT NULL
                           THEN EXCLUDED.nav_date
                           ELSE instruments.nav_date END,

        -- Dormancy still tracks the FILE, not the stored NAV: a fund AMFI has stopped pricing
        -- goes is_active=false even though we carried its last value forward. Carried-forward
        -- ≠ fresh, and is_active + nav_date are what say so.
        is_active        = EXCLUDED.is_active,
        updated_at       = now()
      WHERE instruments.asset_class = '${cls}'::"AssetClass"
      RETURNING (xmax = 0) AS inserted`;

    const out = await prisma.$queryRawUnsafe<{ inserted: boolean }[]>(sql, ...values);
    for (const r of out) r.inserted ? created++ : updated++;
  }

  return { created, updated };
}
