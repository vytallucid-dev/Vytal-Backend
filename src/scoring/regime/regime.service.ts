// File: src/scoring/regime/regime.service.ts
//
// THE regime resolver. Turns a peer group into a RegimeView, from the DB, with the owner's ruling:
// a clear sector index → use it; no clear index → pool the PG's own scored stocks and compute the
// index series from them. Pooling is the DEFINED method for the no-index case, not a fallback of
// last resort — there is no third branch. A cache and a batch path serve whole-universe scans.
// Pure computation lives in ./regime.ts; this file is the IO and the resolution policy.
//
// ── RESOLUTION: PG → SECTOR → INDEX ────────────────────────────────────────────────────────────────
// There is no PG→index column and this step does not add one. A peer group resolves through its
// sector via the EXISTING SECTOR_INDEX_MAP (read/price-view.service.ts) — one map, one place.
// 23 peer groups collapse onto 20 sectors, so some PGs share an index (both bank PGs → Nifty Bank;
// both auto PGs → Nifty Auto; the three consumer-discretionary PGs → Nifty Consumer Durables).
// That sharing is CORRECT for this instrument: regime is a property of the sector's phase, and the
// spec computes it on the sector. See the report note on whether a per-PG index would differ.
//
// ── ★ THE POOL METHOD IS RESOLVED AT RUNTIME. NO HARDCODED SECTOR LIST ─────────────────────────────
// The spec names PG8 Power / PG9 Metals / PG10 Oil & Gas as the no-benchmark carve-out. In THIS repo
// that list is wrong in both directions — Nifty Metal and Nifty Oil & Gas both have deep history,
// while Capital Goods, Consumer Services, Insurance, Telecom and Cement are the short ones. So the
// carve-out is implemented against the DB, never against a list.
// The test is PER CALL: does this sector have ≥ lookback+1 usable rows RIGHT NOW? Index history
// GROWS — a sector short today may qualify next quarter, and a hardcoded list would keep it on the
// pool method forever. Because the check is a row count on live data, the switch from pg_pool back
// to index happens the day the rows land, with NO code change.
//
// ── ★ POOLING IS ATTEMPTED WHENEVER THE INDEX CANNOT CARRY THE WINDOW ──────────────────────────────
// resolveOne never returns null merely because the index was short, stale, or missing a mapping —
// every one of those paths falls through to loadPgPoolView before anything is called unresolvable.
// A null is reached ONLY when pooling was tried and ALSO failed for a stated, specific reason (no
// scored members, too few surviving the window, or the pooled calendar itself failing the span/
// staleness guard) — never as a shortcut around trying the pool.
//
// ── ★ NEVER DEFAULT TO NORMAL ──────────────────────────────────────────────────────────────────────
// When neither instrument is computable the answer is regime: null with a reason. This is not
// defensive coding. T3 (falling out of Pristine) carries a directional read in HOT and NONE in
// NORMAL — so a silent NORMAL default would suppress a real reading and look exactly like the
// pattern correctly having nothing to say. A null is loud; a wrong NORMAL is silent.
//
// ── ★ FIRE-TIME vs READ-TIME — DECIDED: STAMP AT FIRE TIME, SERVE LIVE FOR LANDINGS ────────────────
// Regime is a price computation that moves daily; findings fire on quarterly snapshots. Both are
// needed, and they must never be conflated:
//   · ON A FIRED FINDING → the regime that prevailed WHEN IT FIRED, stamped into evidence under
//     REGIME_EVIDENCE_KEY ("regimeAtEvent"). Evidentially this is the only correct choice: the study
//     measured "T3 events that OCCURRED DURING HOT phases returned −5.2%". The evidence is
//     regime-at-event. Read-time would let a T3 that fired in HOT silently become NORMAL weeks later
//     and lose the directional read it was entitled to — or worse, gain one it never had.
//   · ON A TOOL LANDING → the CURRENT regime, live, as present-tense sector context.
// This service serves both: pass `asOf` for the point-in-time (fire-time) value, omit it for live.
// ⚠ CORRECTED 2026-08-14. This line used to read "Step 1 ships the primitive only. Nothing here is
// wired into score-pass or any rule" — true at Step 1, false since. THIS SERVICE IS NOW ON THE
// SCORE PATH: composite/score-pass.ts:69 imports getRegimeForPeerGroup and calls it once per peer
// group (score-pass.ts:689) to stamp REGIME_EVIDENCE_KEY onto fired findings that declare a regime
// dependency and onto every not-covered row. The call is best-effort — wrapped in try/catch at
// score-pass.ts:677-707, so a lookup failure costs the stamp, never the score row — but it is a
// live read of prisma.indexPrice (line ~152 below) from inside the scoring pass. Treat any change
// to this file's IO as touching scoring output, not as a standalone primitive.
//
// ── POINT-IN-TIME IS REAL, NOT COSMETIC ───────────────────────────────────────────────────────────
// `asOf` restricts rows to date ≤ cutoff BEFORE the window is measured, mirroring
// getCleanedCloses(asOfCutoff). Without it a rescore of a historical snapshot would stamp TODAY's
// regime onto a finding that fired two quarters ago.
//
// ── COST ──────────────────────────────────────────────────────────────────────────────────────────
// The index path is one indexed query for 127 rows. The pg_pool path is far heavier — it loads each
// scored member's FULL cleaned series through getCleanedCloses (the gating price chokepoint; raw
// closes would read a 1:5 split as −80% and manufacture a STRESSED). That cost is why the cache
// exists and why only the handful of short-history PGs ever pay it.

import { prisma } from "../../db/prisma.js";
import { SECTOR_INDEX_MAP } from "../read/price-view.service.js";
import { getCleanedCloses } from "../price/load.js";
import {
  REGIME_LOOKBACK_ROWS,
  REGIME_MAX_STALE_DAYS,
  REGIME_MAX_WINDOW_SPAN_DAYS,
  REGIME_POOL_MIN_MEMBERS,
  equalWeightMean,
  trailingReturnFromSeries,
  unknownRegime,
  viewFromWindow,
  windowIntegrity,
  type RegimeView,
} from "./regime.js";

export * from "./regime.js";

/** Cache lifetime. The day is also in the key, so an entry cannot outlive its trading day; the TTL
 *  bounds how long a stale value survives WITHIN a day, so the ~7pm IST EOD ingest is picked up
 *  within the hour rather than at UTC midnight. */
export const REGIME_CACHE_TTL_MS = 60 * 60 * 1000;

const DAY_MS = 86_400_000;
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

// ── CACHE ─────────────────────────────────────────────────────────────────────────────────────────
// Two levels, both keyed by resolution-day so they self-expire:
//   · INDEX level — keyed by index name. This is the "per (sector, trading-day)" slot the brief asks
//     for: every PG in a sector, and every stock in those PGs, collapses onto ONE index read. On a
//     95-stock scan that is the difference between 95 window computations and ~9.
//   · PG level — keyed by peer-group id, memoising the whole resolution INCLUDING the fallback, so a
//     short-history PG pays its expensive pool load once per day rather than per stock.
// In-process, evaporates on restart, persisted nowhere. Holds public product data only — no user
// scope enters (the functions take pgIds and an optional date, and nothing else).

/** An instrument either produced a view, or it produced a precise reason it could not. `detail` is
 *  a clause, not a sentence — resolveOne joins the two instruments' clauses into the final reason.
 *  ⚠ Never report a failure the code did not actually take: a window rejected for spanning 219 days
 *  must not be described as "insufficient rows". */
interface Attempt { view: RegimeView | null; detail: string | null }

interface Slot<T> { value: T; builtAt: number }
const indexWindowCache = new Map<string, Slot<Attempt>>();
const pgRegimeCache = new Map<string, Slot<RegimeView>>();
let cacheHits = 0;
let cacheMisses = 0;

function readSlot<T>(m: Map<string, Slot<T>>, key: string): T | undefined {
  const s = m.get(key);
  if (!s) { cacheMisses++; return undefined; }
  if (Date.now() - s.builtAt > REGIME_CACHE_TTL_MS) { m.delete(key); cacheMisses++; return undefined; }
  cacheHits++;
  return s.value;
}
function writeSlot<T>(m: Map<string, Slot<T>>, key: string, value: T): T {
  m.set(key, { value, builtAt: Date.now() });
  return value;
}

/** Observability for the cache. Used by the verification script to report hit-rate. */
export function getRegimeCacheStats(): { hits: number; misses: number; indexEntries: number; pgEntries: number } {
  return { hits: cacheHits, misses: cacheMisses, indexEntries: indexWindowCache.size, pgEntries: pgRegimeCache.size };
}
/** Drop everything. For scripts and tests; not called in the request path. */
export function resetRegimeCache(): void {
  indexWindowCache.clear();
  pgRegimeCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

const dayKey = (asOf?: Date): string => (asOf ? ymd(asOf) : ymd(new Date()));

// ── INDEX PATH ────────────────────────────────────────────────────────────────────────────────────

/**
 * Measure one index's window. Returns a computed view, or null when the index cannot support one
 * (too few rows / gapped / stale) — null here means "try the fallback", not "regime unknown".
 *
 * ⚠ close > 0 is filtered IN THE QUERY, not after `take`. Filtering after would let a single bad
 * row silently shorten the window to 126 and report "insufficient" on a series that has the rows.
 */
async function loadIndexView(indexName: string, asOf?: Date): Promise<Attempt> {
  const key = `${indexName}|${dayKey(asOf)}`;
  const hit = readSlot(indexWindowCache, key);
  if (hit !== undefined) return hit;

  const rows = await prisma.indexPrice.findMany({
    where: { indexName, close: { gt: 0 }, ...(asOf ? { date: { lte: asOf } } : {}) },
    orderBy: { date: "desc" },
    take: REGIME_LOOKBACK_ROWS + 1,
    select: { date: true, close: true },
  });
  // Query is DESC (newest first) so `take` grabs the most recent window; the pure helper wants ASC.
  const series = rows.map((r) => ({ date: r.date, close: Number(r.close) })).reverse();

  const w = trailingReturnFromSeries(series);
  // `take` capped at lookback+1, so a short result IS the true total — no second count query.
  if (!w) {
    return writeSlot(indexWindowCache, key, {
      view: null,
      detail: `sector index "${indexName}" has ${series.length} usable rows (needs ${REGIME_LOOKBACK_ROWS + 1})`,
    });
  }
  const bad = windowIntegrity(w, asOf ?? new Date());
  if (bad === "window_non_contiguous") {
    return writeSlot(indexWindowCache, key, {
      view: null,
      detail: `sector index "${indexName}" window spans ${w.spanDays} days for ${REGIME_LOOKBACK_ROWS} rows (max ${REGIME_MAX_WINDOW_SPAN_DAYS}) — the series has gaps, so this is not a 6-month return`,
    });
  }
  if (bad === "stale") {
    return writeSlot(indexWindowCache, key, {
      view: null,
      detail: `sector index "${indexName}" latest usable row is ${w.latestDate.toISOString().slice(0, 10)} (max ${REGIME_MAX_STALE_DAYS} days stale)`,
    });
  }
  return writeSlot(indexWindowCache, key, { view: viewFromWindow(w, "index", indexName), detail: null });
}

// ── PG POOL — THE DEFINED METHOD WHEN NO SECTOR INDEX HAS SUFFICIENT HISTORY ────────────────────────
//
// Not a fallback of last resort: whenever loadIndexView cannot carry the window (short, gapped,
// stale, or the sector has no index mapping at all), pooling is the spec's own answer, tried
// unconditionally — see the "★ POOLING IS ATTEMPTED WHENEVER…" note at the top of this file.

/** Most recent close at-or-before `d` in an ascending series, or null when the series starts after
 *  `d`. Forward-fill: a member that did not print on the anchor date carries its last known close,
 *  which is the standard treatment for a missing print (no print = no new information). A member
 *  whose data BEGINS after the anchor has no valid base and is excluded, not filled forward from
 *  nothing. */
function closeAtOrBefore(series: readonly { date: Date; close: number }[], d: Date): number | null {
  let out: number | null = null;
  for (const c of series) {
    if (c.date <= d) out = c.close;
    else break; // ascending
  }
  return out;
}

/**
 * Equal-weight pool of the PG's SCORED members, computed WHENEVER the index cannot support a
 * window — the defined method, not a degraded stand-in. The returned view carries source "pg_pool"
 * so a consumer can still tell the two bases apart (that distinction is right); the reason names
 * what was pooled and why no index was used, without characterising the result as weaker.
 *
 * ── ★ THE CALENDAR IS THE PEERS' UNION, NOT ANY ONE MEMBER'S SERIES ────────────────────────────────
 * "Pool the PG's own stocks and compute the index from them" means the 126 rows are counted on THAT
 * constructed series, and its trading calendar is the union of the members' dates — not any single
 * member's gappy one. Measured on live data, individual stocks' daily_prices can carry gaps (see the
 * 2026-05-11→06-12 ingest hole affecting some members): a single gappy member's 127th row back can
 * sit >210 calendar days ago, a 7-month window wearing a 6-month label. Pooling several members with
 * DIFFERENT gap patterns closes most gaps in the union; a gap survives the union only when it is
 * SYSTEMIC — every member missing the identical sessions, in which case union or not, no honest
 * 126-row window exists. See the report note on which PGs hit that residual case.
 *
 * Members are excluded when: not scored · their post-break data does not reach the anchor · they
 * have no close at-or-before the anchor. Quarantine is handled by TRUNCATING to post-break (the
 * orchestrate.ts treatment) rather than dropping the member outright — clean.ts's own semantic is
 * "windows spanning it are excluded", so a demerger three years before this window is irrelevant to
 * it, while a break INSIDE the window removes the member automatically by failing the anchor reach.
 *
 * Below REGIME_POOL_MIN_MEMBERS survivors the pool is refused rather than computed thin — see Rule 1
 * in ./regime.ts: a "pool" of one or two members reintroduces the circularity the sector-level
 * computation exists to avoid.
 */
async function loadPgPoolView(peerGroupId: string, asOf?: Date): Promise<Attempt> {
  const members = await prisma.stockPeerGroup.findMany({
    where: { peerGroupId },
    select: { stock: { select: { id: true, symbol: true } } },
  });
  if (members.length === 0) return { view: null, detail: "peer group has no members" };

  const ids = members.map((m) => m.stock.id);
  const scoredRows = await prisma.scoreSnapshot.findMany({
    where: { stockId: { in: ids }, ...(asOf ? { asOfDate: { lte: asOf } } : {}) },
    select: { stockId: true },
    distinct: ["stockId"],
  });
  const scored = new Set(scoredRows.map((r) => r.stockId));
  const scoredMembers = members.filter((m) => scored.has(m.stock.id));

  // 1 · Load each scored member's cleaned series, truncated to post-break where quarantined.
  //     ⚠ CLEANED closes. Raw daily_prices would read a 1:5 split as a −80% return and manufacture
  //     a STRESSED regime for the whole peer group.
  const series: { date: Date; close: number }[][] = [];
  for (const m of scoredMembers) {
    const { closes, report } = await getCleanedCloses(m.stock.id, m.stock.symbol, asOf);
    let s = closes.filter((c) => c.close > 0);
    if (report.quarantined && report.quarantineFrom) {
      const qf = new Date(report.quarantineFrom);
      s = s.filter((c) => c.date >= qf); // post-break only — windows spanning the break are excluded
    }
    if (s.length) series.push(s);
  }
  if (series.length === 0) {
    return { view: null, detail: `0 of ${scoredMembers.length} scored members have usable prices (${members.length} members total, ${scoredMembers.length} scored)` };
  }

  // 2 · The constructed index's calendar = union of member dates, ascending.
  const calendar = [...new Set(series.flatMap((s) => s.map((c) => c.date.getTime())))]
    .sort((a, b) => a - b)
    .map((t) => new Date(t));
  if (calendar.length < REGIME_LOOKBACK_ROWS + 1) {
    return { view: null, detail: `pooled calendar has ${calendar.length} distinct trading dates across ${series.length} members (needs ${REGIME_LOOKBACK_ROWS + 1})` };
  }
  const latest = calendar[calendar.length - 1];
  const anchor = calendar[calendar.length - 1 - REGIME_LOOKBACK_ROWS];

  // 3 · Each member's return across that common window; equal-weight the RETURNS (see equalWeightMean).
  const returns: number[] = [];
  for (const s of series) {
    if (s[0].date > anchor) continue; // listed (or broke) after the anchor — no valid base
    const base = closeAtOrBefore(s, anchor);
    const end = closeAtOrBefore(s, latest);
    if (base === null || end === null || base <= 0) continue;
    returns.push(end / base - 1);
  }

  if (returns.length < REGIME_POOL_MIN_MEMBERS) {
    return {
      view: null,
      detail: `only ${returns.length} of ${scoredMembers.length} scored members span the pooled window (quorum ${REGIME_POOL_MIN_MEMBERS})`,
    };
  }
  const mean = equalWeightMean(returns);
  if (mean === null) return { view: null, detail: "pool could not be computed" };

  const w = {
    trailing6mo: mean,
    anchorDate: anchor,
    latestDate: latest,
    spanDays: Math.round((latest.getTime() - anchor.getTime()) / DAY_MS),
    rowsAvailable: calendar.length,
  };
  // The pooled series faces the SAME integrity bar as a real index — a gappy or stale union
  // calendar is no more admissible than a gappy or stale index. Pooling several members with
  // DIFFERENT idiosyncratic gaps normally closes them in the union (that is the whole point of
  // pooling over a single member's series) — reaching this branch means the gap is SYSTEMIC: every
  // one of the ${series.length} contributing members is missing the same sessions, so no amount of
  // pooling recovers a genuine 6-month window. That is a daily_prices ingest gap, not a shortfall in
  // peer coverage — worth distinguishing in the reason from "not enough scored members" above.
  const bad = windowIntegrity(w, asOf ?? new Date());
  if (bad === "window_non_contiguous") {
    return {
      view: null,
      detail:
        `pooled calendar (${series.length} scored members, union of their dates) spans ${w.spanDays} days for ${REGIME_LOOKBACK_ROWS} rows ` +
        `(max ${REGIME_MAX_WINDOW_SPAN_DAYS}) — every contributing member is missing the same trading sessions in this window, ` +
        `a daily_prices ingest gap common to the whole group, not a shortfall in peer coverage`,
    };
  }
  if (bad === "stale") {
    return { view: null, detail: `pooled calendar's latest date is ${w.latestDate.toISOString().slice(0, 10)} (max ${REGIME_MAX_STALE_DAYS} days stale)` };
  }

  const view = viewFromWindow(
    w,
    "pg_pool",
    null,
    `Computed from an equal-weight pool of ${returns.length} scored members of this peer group — no sector index had ${REGIME_LOOKBACK_ROWS + 1} usable rows.`,
  );
  return { view, detail: null };
}

// ── RESOLUTION ────────────────────────────────────────────────────────────────────────────────────

async function resolveOne(
  pg: { id: string; name: string; sectorName: string },
  asOf?: Date,
): Promise<RegimeView> {
  const key = `${pg.id}|${dayKey(asOf)}`;
  const hit = readSlot(pgRegimeCache, key);
  if (hit !== undefined) return hit;

  const indexName = SECTOR_INDEX_MAP[pg.sectorName] ?? null;

  // 1 · The index, when it can carry the window.
  let idxDetail: string;
  if (indexName) {
    const idx = await loadIndexView(indexName, asOf);
    if (idx.view) return writeSlot(pgRegimeCache, key, idx.view);
    idxDetail = idx.detail ?? `sector index "${indexName}" unavailable`;
  } else {
    idxDetail = `sector "${pg.sectorName}" has no index mapping`;
  }

  // 2 · No clear index → pool. Tried UNCONDITIONALLY here — short history, staleness, non-
  //     contiguity and "no mapping" all fall through to this line identically. There is no branch
  //     that reaches step 3 without having tried the pool.
  const pool = await loadPgPoolView(pg.id, asOf);
  if (pool.view) return writeSlot(pgRegimeCache, key, pool.view);

  // 3 · Neither instrument produced a window. Null with a reason naming what EACH one actually
  //     failed on — never NORMAL. This is reached only when pooling was attempted and failed for a
  //     stated cause (see loadPgPoolView), not as a shortcut around it.
  return writeSlot(
    pgRegimeCache,
    key,
    unknownRegime(`index: ${idxDetail}; pool: ${pool.detail ?? "unavailable"}`),
  );
}

export interface RegimeOptions {
  /** Point-in-time cutoff. Omit for the live/current regime (tool landings); pass the snapshot's
   *  asOfDate for the fire-time stamp. */
  asOf?: Date;
}

/** Regime for one peer group. */
export async function getRegimeForPeerGroup(peerGroupId: string, opts: RegimeOptions = {}): Promise<RegimeView> {
  const m = await getRegimeForPeerGroups([peerGroupId], opts);
  return m.get(peerGroupId) ?? unknownRegime(`peer group ${peerGroupId} not found`);
}

/**
 * Regime for many peer groups — the whole-universe path for the tool landings.
 * One query resolves every PG's sector; PGs sharing an index then share one index read via the
 * index-level cache, so the DB cost is O(distinct indices), not O(peer groups).
 */
export async function getRegimeForPeerGroups(
  peerGroupIds: readonly string[],
  opts: RegimeOptions = {},
): Promise<Map<string, RegimeView>> {
  const out = new Map<string, RegimeView>();
  const unique = [...new Set(peerGroupIds)];
  if (unique.length === 0) return out;

  const pgs = await prisma.peerGroup.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, sector: { select: { name: true } } },
  });

  // Sequential on purpose: the cache is only useful if a shared index is resolved before the next
  // PG asks for it. Concurrency here would produce duplicate index reads for the sharing PGs.
  for (const pg of pgs) {
    out.set(pg.id, await resolveOne({ id: pg.id, name: pg.name, sectorName: pg.sector.name }, opts.asOf));
  }
  for (const id of unique) {
    if (!out.has(id)) out.set(id, unknownRegime(`peer group ${id} not found`));
  }
  return out;
}

/**
 * Regime for a set of stocks, resolved THROUGH each stock's peer group.
 *
 * ⚠ This is resolution BY stock, never computation ON a stock — the returned value is the stock's
 * SECTOR's phase, identical for every member of the peer group. See Rule 1 in ./regime.ts. A stock
 * in no peer group gets null + reason, never a regime computed from its own closes.
 */
export async function getRegimeByStock(
  stockIds: readonly string[],
  opts: RegimeOptions = {},
): Promise<Map<string, RegimeView>> {
  const out = new Map<string, RegimeView>();
  const unique = [...new Set(stockIds)];
  if (unique.length === 0) return out;

  const links = await prisma.stockPeerGroup.findMany({
    where: { stockId: { in: unique } },
    select: { stockId: true, peerGroupId: true },
  });
  const byStock = new Map<string, string>();
  for (const l of links) if (!byStock.has(l.stockId)) byStock.set(l.stockId, l.peerGroupId);

  const regimes = await getRegimeForPeerGroups([...new Set(byStock.values())], opts);
  for (const id of unique) {
    const pgId = byStock.get(id);
    out.set(id, (pgId ? regimes.get(pgId) : undefined) ?? unknownRegime(`stock ${id} is in no peer group`));
  }
  return out;
}
