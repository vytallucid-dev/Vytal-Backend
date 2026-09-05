// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FIVE NON-SINGLE-STOCK BLOCKS' RESOLVERS — instrument · fund · comparison · universe · screen.
// Stage 7.
//
// ── ★ THESE ARE THE BLOCKS WHOSE COVERAGE IS A QUERY, NOT A SUBJECT ───────────────────────────────
// `screen` and `universe` have NO subject: nobody named a company. Their honest coverage half is
// `QueryCoverage` — what was searched, what the floor was, and what got dropped — and `subject: null`
// says there is no tier to read. That half of `Coverage` was split off at stage 2 for exactly this
// case and had no consumer until now.
//
// `comparison` has TWO subjects and so has neither shape cleanly: it carries the query half (both
// were searched) and leaves `subject` null, because a single subject envelope would describe one of
// the two and read as though it described the answer.
//
// ── ★ THE COMPARABILITY VERDICT IS THE VALUE, NOT THE TABLE ───────────────────────────────────────
// `openComparison`'s own header said it: the verdict is what the model could not derive alone. Two
// companies in different peer groups CAN be put side by side and the numbers will render; what the
// reader cannot see is that the comparison is meaningless. So `comparable` is resolved and stated,
// and a false verdict suppresses the bars rather than captioning them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { buildComparisonView } from "../scoring/read/compare-view.service.js";
import { prisma } from "../db/prisma.js";
import { buildFundAnalyticsView } from "../scoring/read/fund-analytics.service.js";
import { getUniverseHealthView } from "../scoring/read/universe-view.cache.js";
import { getUniverseMetricValues } from "../scoring/read/metric-values.cache.js";
import { screenUniverse } from "../scoring/read/screen.service.js";
import { BAND_LABEL } from "../scoring/read/universe-projection.types.js";
import { STOCK_FINDINGS } from "../catalogue/stock-findings.js";
import { SET_TABLE_TRANSPORT } from "../section/kinds/set-table.js";
import { GRAIN_LABEL } from "../filing/read.js";
import { parsePeriodKey } from "../filing/period.js";
import { getPeerGroupForStock } from "../scoring/read/peer-group-lookup.js";
import { resolveStockCoverage } from "./stock-coverage.js";
import {
  absent, resolved,
  type Coverage, type InstrumentCoverage, type QueryCoverage, type Resolved, type Source,
} from "./contract.js";
import type { ScreenCondition, ScreenFieldId } from "../scoring/read/screen.types.js";

const PROV: Source[] = ["stocks"];
const PROV_SCORED: Source[] = ["stocks", "score_snapshots"];

// ═══ 11 · INSTRUMENT ═══════════════════════════════════════════════════════════════════════════════
export interface InstrumentRead {
  readonly identifier: string; readonly isin: string; readonly name: string;
  readonly assetClass: string;
  readonly schemeCode: string | null;
  readonly nav: number | null; readonly navDate: string | null;
  /** ★ THE NON-EQUITY ATTRIBUTES — distribution yield, coupon, maturity. An allow-listed, UNIT-CORRECT
   *  projection of `Instrument.attributes`, never the raw JSON blob: the old tool's own gate pins that
   *  a stored fraction (0.0636) must reach a reader as a PERCENT (6.36%), and that no `{"` ever does. */
  readonly attributes: readonly { readonly label: string; readonly value: string }[];
  /** ⚠ 44.8% of schemes carry a stale NAV (matured funds still listed) — never render one without
   *  this. Straight from the schema's own warning. */
  readonly navStale: boolean;
}

export async function resolveInstrumentDetail(identifier: string): Promise<Resolved<InstrumentRead>> {
  const norm = identifier.trim().toUpperCase();
  const row = await prisma.instrument.findFirst({
    where: { assetClass: { not: "stock" }, OR: [{ isin: norm }, { symbol: norm }, { amfiSchemeCode: norm }] },
    select: { isin: true, symbol: true, amfiSchemeCode: true, name: true, assetClass: true, currentNav: true, navDate: true, attributes: true },
  });
  const empty: Coverage = { subject: null, query: null };
  if (!row) return absent<InstrumentRead>("not_in_universe", empty);

  // ⚠ AN ALLOW-LIST, NOT A SPREAD. `attributes` is an open jsonb column; rendering whatever it holds
  //   would put raw keys and 17-digit floats in front of a reader the first time an ingest changed.
  const A = (row.attributes ?? {}) as Record<string, unknown>;
  const num = (k: string): number | null => (typeof A[k] === "number" && Number.isFinite(A[k]) ? (A[k] as number) : null);
  const attributes: { label: string; value: string }[] = [];
  const dy = num("distributionYield");
  // ★ ×100. It is STORED as a fraction and READ as a percent; shipping 0.0636 would understate a
  //   6.36% yield by two orders of magnitude, which is the unit defect this projection exists to stop.
  if (dy !== null) attributes.push({ label: "Distribution yield", value: `${(dy * 100).toFixed(2)}%` });
  const cp = num("couponRate");
  if (cp !== null) attributes.push({ label: "Coupon", value: `${(cp * 100).toFixed(2)}%` });
  if (typeof A.maturityDate === "string") attributes.push({ label: "Matures", value: A.maturityDate.slice(0, 10) });
  if (typeof A.creditRating === "string") attributes.push({ label: "Rating", value: A.creditRating });

  const navDate = row.navDate ? new Date(row.navDate).toISOString().slice(0, 10) : null;
  const stale = navDate ? Date.now() - new Date(navDate).getTime() > 30 * 86_400_000 : false;

  const cov: InstrumentCoverage = {
    kind: "instrument", instrumentType: row.assetClass, asOf: navDate, analytics: false,
  };
  return resolved<InstrumentRead>({
    identifier: row.amfiSchemeCode ?? row.symbol ?? row.isin,
    isin: row.isin, name: row.name, assetClass: row.assetClass,
    schemeCode: row.amfiSchemeCode,
    nav: row.currentNav === null || row.currentNav === undefined ? null : Number(row.currentNav),
    navDate, navStale: stale, attributes,
  }, { subject: cov, query: null }, PROV);
}

// ═══ 12 · FUND ANALYTICS ═══════════════════════════════════════════════════════════════════════════
export interface FundRead {
  readonly schemeCode: string; readonly name: string;
  readonly returns: readonly { readonly label: string; readonly value: number | null }[];
  readonly risk: readonly { readonly label: string; readonly value: number | null }[];
  readonly asOf: string | null;
  readonly category: string | null;
}

export async function resolveFund(schemeCode: string): Promise<Resolved<FundRead>> {
  // ⚠ C-1. `not_in_universe` was saying two things at once here. buildFundAnalyticsView returns
  //   `FundAnalyticsView | null` — null when there is no such scheme, which IS "not in our universe";
  //   but a THROW was landing on the same sentence, telling the reader we do not cover a fund we may
  //   cover perfectly well. Both arms are reachable, so both are written.
  let read = true;
  const v = await buildFundAnalyticsView(schemeCode)
    .catch(() => { read = false; return null; }) as Record<string, unknown> | null;
  const emptyCov: Coverage = { subject: null, query: null };
  if (!read) return absent<FundRead>("read_failed", emptyCov);
  if (!v) return absent<FundRead>("not_in_universe", emptyCov);

  const num = (o: unknown, ...ks: string[]): number | null => {
    const r = o as Record<string, unknown> | null | undefined;
    for (const k of ks) { const x = r?.[k]; if (typeof x === "number" && Number.isFinite(x)) return x; }
    return null;
  };
  const rets = (v.returns ?? v.trailing) as Record<string, unknown> | undefined;
  const risk = (v.risk ?? v) as Record<string, unknown> | undefined;
  const asOf = v.asOfDate ? new Date(v.asOfDate as string).toISOString().slice(0, 10) : null;

  const cov: InstrumentCoverage = {
    kind: "instrument",
    instrumentType: String(v.assetClass ?? "mutual_fund"),
    asOf,
    // ★ TRUE HERE AND ONLY HERE. `analytics` is what separates an instrument we can speak about from
    //   one we merely have on file, and this resolver is the thing that computes them.
    analytics: true,
  };

  return resolved<FundRead>({
    schemeCode,
    name: String(v.name ?? v.schemeName ?? schemeCode),
    returns: [
      { label: "1 month", value: num(rets, "r1m", "return1m") },
      { label: "1 year", value: num(rets, "r1y", "return1y") },
      { label: "3 years", value: num(rets, "r3y", "return3y") },
      { label: "5 years", value: num(rets, "r5y", "return5y") },
    ],
    risk: [
      { label: "Volatility", value: num(risk, "volatility", "stdDev") },
      { label: "Sharpe", value: num(risk, "sharpe", "sharpeRatio") },
      { label: "Sortino", value: num(risk, "sortino", "sortinoRatio") },
      { label: "Max drawdown", value: num(risk, "maxDrawdown") },
    ],
    asOf,
    category: v.category ? String(v.category) : null,
  }, { subject: cov, query: null }, PROV);
}

// ═══ 13 · COMPARISON ═══════════════════════════════════════════════════════════════════════════════
export interface CompareSide {
  readonly symbol: string; readonly name: string;
  readonly score: number | null; readonly band: string | null;
  readonly rows: readonly { readonly label: string; readonly value: number | null; readonly unit: "cr" | "pct" | "x" }[];
  /** Which of the four pillars we hold for this side. `null` where a pillar is not scored. */
  readonly pillars: Readonly<Record<"foundation" | "momentum" | "market" | "ownership", number | null>>;
  /** Rank inside its own peer group, when it has standing there. */
  readonly rank: { readonly rank: number; readonly outOf: number } | null;
}
/**
 * ★ WHY THE TWO DO NOT LINE UP — three different facts that were one sentence until Batch 2.
 *
 * ⚠ THE DANGEROUS ONE IS `one_unscored`, AND IT WAS BEING REPORTED AS `different_groups`. "Compare
 *   TCS and BAJFINANCE" produced "these two are judged against different peer sets" — true, and not
 *   the reason. The reason is that we do not score BAJFINANCE at all, along with every other NBFC,
 *   insurer and 2,196 more; the peer-group difference is a consequence of that, not the cause. A
 *   reader told the first thing goes looking for a comparison in a different peer set. A reader told
 *   the second knows no such comparison exists anywhere in the product.
 */
export type IncomparableReason = "different_groups" | "one_unscored" | "neither_scored";

export interface ComparisonRead {
  readonly left: CompareSide; readonly right: CompareSide;
  /** ★ THE VERDICT. False ⇒ the figures render as absent rather than as bars. */
  readonly comparable: boolean;
  /** `null` exactly when `comparable` is true. Never guessed — see `IncomparableReason`. */
  readonly reason: IncomparableReason | null;
  readonly basis: string;
  readonly peerGroup: string | null;
  /**
   * ★ THE PAIRED METRICS — the axis that lines up whatever the two companies are.
   *
   * ⚠ THIS IS WHY "compare TCS and Infosys" RENDERED AS TWO BARS. `CompareSide.rows` existed, was
   *   typed, and was populated with `[]` at the only place that builds it, so the comparison had
   *   exactly one figure per company: the composite. Two numbers is not a comparison; it is a
   *   scoreboard, and it cannot answer the question a reader is actually asking, which is WHERE the
   *   two differ.
   *
   * ★ TAKEN FROM `buildComparisonView`, NOT REBUILT. That service is what the comparison tool page
   *   renders — it already knows family-awareness (a bank and a manufacturer do not share a margin),
   *   which metrics are universal, and when two sides must NOT be placed side by side. Re-deriving
   *   any of that here would be a second opinion on comparability (N-3), and the second opinion is
   *   the one that would be wrong.
   */
  readonly metrics: readonly {
    readonly label: string;
    readonly unit: string;
    readonly a: number | string | null;
    readonly b: number | string | null;
  }[];
  /** Honest comparability boundaries from the same service — empty when fully comparable. */
  readonly warnings: readonly string[];
  readonly familyLabel: { readonly a: string; readonly b: string };
}

export async function resolveComparison(a: string, b: string): Promise<Resolved<ComparisonRead>> {
  const q: QueryCoverage = {
    universeSearched: 2, depthFloor: null, excludedForDepth: 0, dropped: [],
  };
  // ⚠ `subject: null` — TWO SUBJECTS, SO NEITHER IS "THE" SUBJECT. See the header.
  const coverage: Coverage = { subject: null, query: q };

  // ⚠ THE COVERAGE READ IS GUARDED TOO, AND THE PAIR TEST IS WHY. With the database unreachable this
  //   function THREW here — before ever reaching the guarded query below — so the honest absence the
  //   fix installed was unreachable and a reader got a 500 instead of a sentence. Not the
  //   swallowed-absence defect (no false claim is made by throwing), but the same principle: a
  //   failure on our side is part of the contract, and `Resolved<T>` is where it belongs.
  const covs = await Promise.all([resolveStockCoverage(a), resolveStockCoverage(b)]).catch(() => null);
  if (!covs) return absent<ComparisonRead>("read_failed", coverage);
  const [covA, covB] = covs;

  let read = true;
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT s.symbol, s.name, s.sector_id,
            ss.composite, ss.label_band
       FROM stocks s
       LEFT JOIN LATERAL (
         SELECT composite, label_band FROM score_snapshots
          WHERE stock_id = s.id ORDER BY as_of_date DESC LIMIT 1
       ) ss ON true
      WHERE s.symbol = ANY($1)`,
    [a.toUpperCase(), b.toUpperCase()],
  ).catch(() => { read = false; return [] as Array<Record<string, unknown>>; });
  // ⚠ C-1. A query that FAILED and a query that found fewer than two covered symbols are different
  //   statements, and `not_in_universe` was making the second on behalf of both — telling a reader we
  //   do not cover a company when in fact we could not run the comparison.
  if (!read) return absent<ComparisonRead>("read_failed", coverage);
  if (rows.length < 2) return absent<ComparisonRead>("not_in_universe", coverage);

  const byS = new Map(rows.map((r) => [String(r.symbol), r]));
  const ra = byS.get(a.toUpperCase());
  const rb = byS.get(b.toUpperCase());
  if (!ra || !rb) return absent<ComparisonRead>("not_in_universe", coverage);

  const [idA, idB] = await Promise.all([
    prisma.stock.findUnique({ where: { symbol: a.toUpperCase() }, select: { id: true } }),
    prisma.stock.findUnique({ where: { symbol: b.toUpperCase() }, select: { id: true } }),
  ]);
  const [pgA, pgB] = await Promise.all([
    idA ? getPeerGroupForStock(idA.id).catch(() => null) : null,
    idB ? getPeerGroupForStock(idB.id).catch(() => null) : null,
  ]);
  const samePeerGroup = Boolean(pgA && pgB && (pgA as { id?: string }).id === (pgB as { id?: string }).id);

  const side = (r: Record<string, unknown>): CompareSide => ({
    symbol: String(r.symbol), name: String(r.name),
    score: r.composite === null || r.composite === undefined ? null : Number(r.composite),
    band: r.label_band === null || r.label_band === undefined ? null : String(r.label_band),
    rows: [],
    pillars: { foundation: null, momentum: null, market: null, ownership: null },
    rank: null,
  });

  // ★ THE TOOL PAGE'S OWN VIEW, CONSUMED WHOLE (§8.2). Its failure is not fatal: a comparison that
  //   cannot get the paired metrics still has two scores and a comparability verdict, which is what
  //   this answer was before — so the degradation is to the old shape rather than to nothing.
  const view = await buildComparisonView(a.toUpperCase(), b.toUpperCase()).catch((e: unknown) => {
    console.warn("[compare] comparison view failed (falling back to scores only):", (e as Error).message);
    return null;
  });
  const metrics = (view?.universalMetrics ?? [])
    // A metric neither side holds says nothing about either of them.
    .filter((m) => m.aValue !== null || m.bValue !== null)
    .map((m) => ({ label: m.label, unit: String(m.unit), a: m.aValue, b: m.bValue }));
  const pillarsOf = (c: { universal: { foundation: number | null; momentum: number | null; market: number | null; ownership: number | null } } | undefined) => ({
    foundation: c?.universal.foundation ?? null,
    momentum: c?.universal.momentum ?? null,
    market: c?.universal.market ?? null,
    ownership: c?.universal.ownership ?? null,
  });
  const rankOf = (c: { peerStanding?: { rank: number; memberCount: number } | null } | undefined) =>
    c?.peerStanding ? { rank: c.peerStanding.rank, outOf: c.peerStanding.memberCount } : null;

  const leftSide = { ...side(ra), pillars: pillarsOf(view?.a), rank: rankOf(view?.a) };
  const rightSide = { ...side(rb), pillars: pillarsOf(view?.b), rank: rankOf(view?.b) };

  // ★★ THE REASON IS RESOLVED, NOT INFERRED DOWNSTREAM. Scoring is checked BEFORE peer groups
  //    because it is the stronger fact: an unscored company has no composite, no pillars and no rank,
  //    so there is nothing to line up regardless of which pond it sits in. Measured, this is the
  //    common case rather than an edge — 2,196 of 2,291 catalogued stocks are unscored, including
  //    every NBFC and every insurer.
  const scoredA = leftSide.score !== null;
  const scoredB = rightSide.score !== null;
  const comparable = scoredA && scoredB && samePeerGroup;
  const reason: IncomparableReason | null =
    comparable ? null
    : !scoredA && !scoredB ? "neither_scored"
    : !scoredA || !scoredB ? "one_unscored"
    : "different_groups";

  const BASIS: Record<IncomparableReason, string> = {
    // Each names WHOSE limitation it is, which is the same rule block-copy.ts holds every absent
    // sentence to: ours, or the world's, and never the two collapsed.
    one_unscored: `we score ${scoredA ? rightSide.symbol : leftSide.symbol} on nothing — there is no composite, no pillar breakdown and no rank for it, so there is no score comparison to draw`,
    neither_scored: "we score neither of these two, so there is no health comparison to draw for either side",
    different_groups: "different peer groups — each score is judged against its own set, so they do not line up",
  };

  return resolved<ComparisonRead>({
    left: leftSide,
    right: rightSide,
    metrics,
    warnings: view?.warnings ?? [],
    familyLabel: { a: view?.a.familyLabel ?? "", b: view?.b.familyLabel ?? "" },
    comparable,
    reason,
    basis: comparable
      ? "the same peer group, so the scores are judged against the same reference set"
      : BASIS[reason!],
    peerGroup: comparable ? String((pgA as { displayName?: string; name?: string } | null)?.displayName ?? (pgA as { name?: string } | null)?.name ?? "") || null : null,
  }, coverage, PROV_SCORED);
}

// ═══ 14 · UNIVERSE SCAN ════════════════════════════════════════════════════════════════════════════
export interface UniverseRead {
  readonly scoredCount: number;
  readonly periodKey: string | null;
  readonly asOf: string | null;
  readonly bands: readonly { readonly label: string; readonly count: number }[];
  readonly median: number | null;
  readonly medianDrift: number | null;
  /** Members at an older period than the cross-section — NAMED, never folded in silently. */
  readonly notAtCurrentPeriod: number;
}

export async function resolveUniverse(): Promise<Resolved<UniverseRead>> {
  // ★★ FOUND BY THE DEAD-DATABASE RUN, NOT BY THE PATTERN GATE — and that is the whole argument for
  //    the mode. `verify-swallowed-absence` scans a NINE-LINE window between a swallowing catch and
  //    the `absent` its empty value reaches; this site's `absent` is eleven lines down, so the gate
  //    was green over it while the allowlist stood at zero. Behaviour found what shape could not.
  //
  // ⚠ BOTH ARMS ARE REAL HERE, UNLIKE resolveScreen'S. `getUniverseHealthView` is typed
  //   `Promise<UniverseHealthView>` and cannot resolve to null, so `!v` is the catch alone — but
  //   `!v.scored || !v.aggregate` is a genuine record state: a universe that has not been scored yet.
  //   The single condition was answering both with `not_ingested`, which reads "a first set of
  //   quarterly results, which this company has not filed with us yet" about a market-wide view.
  //
  // ⚠ AND THE FAILURE RETURNS `query: null` RATHER THAN A ZEROED COVERAGE. `universeSearched` is
  //   `number`, so the `?? 0` below would have stated "we searched 0 companies" on a read that never
  //   ran. `query: null` is the contract's way of not making the claim at all — the same choice the
  //   promoter census documents, reached the same way.
  let read = true;
  const v = await getUniverseHealthView().catch(() => { read = false; return null; });
  if (!read) return absent<UniverseRead>("read_failed", { subject: null, query: null });
  const q: QueryCoverage = {
    universeSearched: v?.scoredUniverseSize ?? 0, depthFloor: null, excludedForDepth: 0,
    // ★ THE MIXED-PERIOD FACT AS A NAMED FILTER. The universe keeps every stock at its own latest
    //   in-force snapshot, so a third of it sits at an older quarter than the plurality label. Saying
    //   "as of FY27Q1, N stocks are X" is false about those, and this is where that is stated.
    dropped: v && v.notAtCurrentPeriod.length
      ? [{ filter: "period", dropped: v.notAtCurrentPeriod.length, why: "at an earlier quarter than the cross-section label" }]
      : [],
  };
  const coverage: Coverage = { subject: null, query: q };
  if (!v || !v.scored || !v.aggregate) return absent<UniverseRead>("not_ingested", coverage);

  const bd = v.aggregate.bandDistribution as unknown as Record<string, unknown>;
  const bands = Object.entries(bd)
    .filter(([, n]) => typeof n === "number")
    .map(([label, n]) => ({ label, count: n as number }));

  return resolved<UniverseRead>({
    scoredCount: v.aggregate.scoredCount,
    periodKey: v.periodKey,
    asOf: v.asOfDate,
    bands,
    median: v.aggregate.medianComposite,
    medianDrift: v.aggregate.medianDrift,
    notAtCurrentPeriod: v.notAtCurrentPeriod.length,
  }, coverage, PROV_SCORED);
}

// ═══ 15 · SCREEN ═══════════════════════════════════════════════════════════════════════════════════
export interface ScreenMatch {
  readonly symbol: string; readonly name: string;
  readonly score: number | null; readonly band: string | null;
  readonly values: readonly { readonly label: string; readonly display: string }[];
}
export interface ScreenRead {
  readonly matches: readonly ScreenMatch[];
  readonly matched: number;
  readonly considered: number;
  readonly conditions: readonly { readonly label: string; readonly bound: string; readonly evaluable: number }[];
  readonly sortedBy: string;
  /**
   * ★ THE STRUCTURAL FILTER, ECHOED — added with the band condition.
   *
   * ⚠ WITHOUT IT A BAND SCREEN REPORTS ITS OWN DENOMINATOR AND HIDES THE REAL ONE. `screenUniverse`
   *   narrows on the band BEFORE the conditions, so `considered` becomes 15 for the Pristine band and
   *   the table would read "Matched 15 · Out of 15" — arithmetically true and the whole line
   *   misleading, exactly the defect `mode: "ranking"` was added for one filter along. The band is
   *   named and `scoredUniverse` carries the 95 the 15 came out of.
   */
  readonly band: string | null;
  /** The scored universe BEFORE any structural narrowing. The honest denominator for a band screen. */
  readonly scoredUniverse: number;
  /** ★ Every matching symbol, uncapped — for intersecting with the filed-line-item universe. */
  readonly matchedSymbols: readonly string[];
}

/**
 * ★ THE DEPTH FLOOR THIS SCREEN DOES NOT DECLARE, AND THE DAY IT MUST — recorded at T-1b for whoever
 *   widens the universe, because that is the change that makes it mandatory.
 *
 * `baseQ.depthFloor` is null and no candidate is dropped for depth. That is CORRECT TODAY and only
 * today: a screen reads `getUniverseHealthView()`, which is the SCORED universe — 95 stocks whose
 * depth runs 14 to 34 quarters, mean 32, with exactly ONE member below 24. There is no shallow member
 * for a floor to exclude, so declaring one would report a filter that never fires.
 *
 * ⚠ THE "EVERY ONE HOLDS ≥24 QUARTERS" IN THE ORIGINAL OF THIS NOTE IS NO LONGER TRUE — re-measured
 *   at Phase 1 · Batch 2, the minimum is 14. It does not change the ruling (one member at 14 against a
 *   universe whose second mass sits at 30–34 is still not a set a floor would bite on) and it is
 *   corrected here because a load-bearing note that has quietly gone stale is how a floor gets skipped
 *   on the day it starts mattering.
 *
 * ⚠ THE MOMENT A SCREEN SEES AN UNSCORED STOCK, A FLOOR BECOMES MANDATORY (§3.3). The universe is
 *   2,291 stocks and its depth is BIMODAL: 1,391 sit at exactly 8 quarters and 411 below 8, against a
 *   second mass of 369 at 30–34. A screen that ranks a 34-quarter company against a 1-quarter company
 *   on the same metric is the quiet lie §3.3 names, and `excludedForDepth` exists to make the
 *   exclusion visible rather than silent.
 *
 * ⚠ AND ANY MARKET-CAP-TIER CONDITION MUST STATE ITS STALENESS. No screen field maps to market-cap
 *   tier today. `market_cap_tier_snapshot` holds ONE frozen month — 504 rows, 504 stocks, a single
 *   as_of_date of 2026-07-04 — so a condition on it would be filtering 22% of the universe on a
 *   two-month-old reading, and the answer would have to say so.
 */
export async function resolveScreen(
  conditions: readonly ScreenCondition[],
  /**
   * ★ THE BAND, AS A FIRST-CLASS CONDITION — added this batch. `ScreenRequest.band` already existed
   *   and was unreachable from chat: "all the stocks in the pristine band" is a filter on the LABEL,
   *   not on a metric, and no `ScreenFieldId` can express it. `parseBand` (the projection service's
   *   own) is what resolves the word, so a band nobody publishes resolves to nothing rather than to
   *   the nearest one.
   */
  band: string | null = null,
): Promise<Resolved<ScreenRead>> {
  // ⚠ C-1, AND HERE THERE IS ONLY ONE ARM — DELIBERATELY. `getUniverseHealthView` and
  //   `getUniverseMetricValues` are typed `Promise<UniverseHealthView>` / `Promise<UniverseMetricValues>`:
  //   NEITHER can resolve to null. The only way `view` or `metrics` was ever falsy is the catch, so
  //   `not_ingested` here was never anything but a swallowed failure wearing a filing-shaped sentence
  //   ("a first set of quarterly results, which this company has not filed with us yet" — said of a
  //   market-wide screen, which has no company at all).
  //
  // ⚠ SO NO SECOND ARM IS WRITTEN. Adding an `if (!view) return absent("not_ingested")` beneath this
  //   would be unreachable code dressed as thoroughness — the vacuous-guard shape, which reads strict
  //   and asserts nothing. One reachable state, one sentence.
  let read = true;
  const fail = () => { read = false; return null; };
  const [view, metrics] = await Promise.all([
    getUniverseHealthView().catch(fail),
    getUniverseMetricValues().catch(fail),
  ]);
  const baseQ: QueryCoverage = {
    universeSearched: view?.scoredUniverseSize ?? 0, depthFloor: null, excludedForDepth: 0, dropped: [],
  };
  if (!read || !view || !metrics) return absent<ScreenRead>("read_failed", { subject: null, query: baseQ });

  // The projection is the opposite case: `screenUniverse` returns `Promise<ScreenProjection>` and
  // answers `{ kind: "empty" }` for an unscored universe or an empty scope, so BOTH arms are real —
  // a screen that could not run, and a screen that ran and matched nothing.
  let ran = true;
  const proj = await screenUniverse(view, metrics, null, { conditions: [...conditions], band: band ?? undefined })
    .catch(() => { ran = false; return null; }) as Record<string, unknown> | null;
  if (!ran) return absent<ScreenRead>("read_failed", { subject: null, query: baseQ });
  if (!proj || proj.kind !== "matches") {
    return absent<ScreenRead>("missing_line_item", { subject: null, query: baseQ });
  }

  const applied = (proj.conditions ?? []) as Array<Record<string, unknown>>;
  const evaluable = proj.evaluable as Record<string, unknown> | undefined;
  const capped = proj.matches as Record<string, unknown> | undefined;
  // ★ THE KEY IS `shown`. THIS LINE READ `items ?? rows` — NEITHER OF WHICH EXISTS ON `Capped<T>`,
  //   WHICH IS `{ total, shown }` (universe-projection.types.ts:59). So `total` was right and the
  //   list was ALWAYS EMPTY, and every screen rendered `screen_no_match` — "no company in our
  //   coverage meets those conditions" — directly above its own "Matched 93". Two statements in one
  //   card, one of them false, hiding 93 real results.
  //
  //   ⚠ AND IT MADE WORKING FUNCTIONALITY LOOK MISSING. Measured at T-1: health<80 → 93 matches,
  //   ROE>20 → 33, operating margin>95 → 1. Every one of those screens was working; the reader saw
  //   an empty card each time, which reads as "screens only do health, badly".
  const items = ((capped?.shown ?? []) as Array<Record<string, unknown>>);
  const total = Number(capped?.total ?? items.length);

  // ★ EVERY CONDITION IS ECHOED WITH ITS OWN EVALUABLE COUNT. A screen narrowed by a field only 40
  //   of 2,290 stocks carry has answered a much smaller question than it looks, and `AppliedCondition`
  //   carries exactly that number for exactly this reason.
  const structuralBand = (() => {
    const st = proj.structural as Record<string, unknown> | undefined;
    return typeof st?.band === "string" ? st.band : null;
  })();
  const considered = Number(evaluable?.considered ?? 0);
  const q: QueryCoverage = {
    ...baseQ,
    // ⚠ THE BAND IS A NARROWING, NOT A SMALLER UNIVERSE. `screenUniverse` filters on it before the
    //   conditions, so `considered` is already the post-band figure — and writing that into
    //   `universeSearched` would report "we searched 15 companies" for a screen that searched 95 and
    //   kept 15. A silent filter makes a shortened set read as a complete one; this is the field
    //   whose whole job is to stop that.
    universeSearched: structuralBand ? baseQ.universeSearched : considered,
    dropped: [
      ...(structuralBand
        ? [{
            filter: "band",
            dropped: Math.max(0, baseQ.universeSearched - considered),
            why: `not in the ${structuralBand} band`,
          }]
        : []),
      ...applied.map((c) => ({
        filter: String(c.field),
        dropped: Math.max(0, considered - Number(c.evaluable ?? 0)),
        why: `no comparable value held for ${String(c.label)}`,
      })).filter((d) => d.dropped > 0),
    ],
  };

  // ⚠ THIS READ `.slice(0, 20)` AND WAS A SECOND, LOWER CAP UNDER THE PROJECTION'S OWN. Two caps on
  //   one list is how a stated bound comes to be wrong: the projection says "showing 60 of 422", this
  //   quietly kept 20, and the card would have paged through a third of what it claimed to hold.
  const matches: ScreenMatch[] = items.slice(0, SET_TABLE_TRANSPORT).map((r) => ({
    symbol: String(r.symbol ?? ""), name: String(r.name ?? ""),
    score: typeof r.score === "number" ? r.score : null,
    band: typeof r.band === "string" ? r.band : null,
    values: ((r.values ?? []) as Array<Record<string, unknown>>).map((v) => ({
      label: String(v.label ?? v.field ?? ""),
      display: v.display != null ? String(v.display) : v.value != null ? String(v.value) : "not held",
    })),
  })).filter((m) => m.symbol);

  return resolved<ScreenRead>({
    matches,
    matched: total,
    considered: Number(evaluable?.considered ?? 0),
    conditions: applied.map((c) => ({
      label: String(c.label),
      bound: [c.min != null ? `≥ ${c.min}` : null, c.max != null ? `≤ ${c.max}` : null].filter(Boolean).join(" and "),
      evaluable: Number(c.evaluable ?? 0),
    })),
    sortedBy: String(proj.sortedBy ?? "health score, highest first"),
    band: (() => {
      const st = proj.structural as Record<string, unknown> | undefined;
      return typeof st?.band === "string" ? st.band : null;
    })(),
    scoredUniverse: baseQ.universeSearched,
    matchedSymbols: Array.isArray(proj.matchedSymbols) ? (proj.matchedSymbols as string[]) : [],
  }, { subject: null, query: q }, PROV_SCORED);
}

// ═══ 16 · THE FINDING SCREEN — the evaluative layer with tier-0-inclusive reach ════════════════════
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THIS IS A WIDER SCREEN THAN THE METRIC ONE, AND THE DIFFERENCE IS THE WHOLE REASON IT EXISTS.
//
//   the metric screen   reads `getUniverseHealthView()` — the 95 SCORED companies
//   this                reads `stock_findings` — 48,907 rows over ALL 2,291 stocks we hold
//
// "How many stocks show a pledging red flag" is a count over findings, and answering it from the
// scored universe would report 95 companies' worth of an answer that is really 2,291's.
//
// ── ★★ THE THREE STATES SURVIVE THE FILTER. THAT IS THIS RESOLVER'S ONE NON-NEGOTIABLE ────────────
// `FindingEvaluationState` is `fired | not_fired | not_evaluable`, and the schema's own note says the
// third exists because "inferring that from a missing row conflates 'it was clean' with 'we never
// ran'". A screen is exactly where that distinction gets destroyed: filter to `fired`, count the rest
// as the denominator, and every company we COULD NOT CHECK has been silently reported as clean.
//
// Measured on live rows, this is not hypothetical — per rule, at each stock's latest period:
//   R1  pledge             59 fired · 1,999 not_fired ·     0 not_evaluable
//   R3  earnings quality   42 fired ·   317 not_fired · 1,889 not_evaluable
//   N1  cash-backed       108 fired ·   280 not_fired · 1,860 not_evaluable
// On R3 the could-not-run set is FIVE TIMES the ran-and-was-clean set. Folding it into "did not
// match" would turn "we checked 359 companies" into "we checked 2,248", and the 1,889 difference is
// companies with too little annual history for the rule to have an opinion about.
//
// ── ⚠ AND THERE IS A FOURTH STATE, WHICH IS NOT A FOURTH KIND OF ANSWER ───────────────────────────
// R1 holds rows for 2,058 of 2,291 stocks. The other 233 have NO ROW AT ALL — the rule never ran
// against them, because it is a shareholding-grain rule and they have filed no shareholding. That is
// recorded by ABSENCE rather than by a `not_evaluable` row, so it cannot be counted by the same query
// arm. It is counted separately and reported separately, and it is NEVER described as clean.
//
// The same choice the witness census made (`resolve/patterns.ts` counts four states and describes
// three), for the same reason: the arithmetic on screen has to close, and claiming "we tried and
// could not" about a rule that never ran would be inventing an attempt.
//
// ── ★ NO DEPTH FLOOR IS DECLARED, AND THAT IS A DECISION RATHER THAN AN OMISSION ──────────────────
// §3.3 makes a floor mandatory the moment a screen sees an unscored stock, and this one sees 2,196 of
// them. The universe is bimodal — 1,391 stocks at exactly 8 quarters, 411 below, against 369 at 30-34
// — so a METRIC screen over that set would need a floor and would need to say what it excluded.
//
// ⚠ THIS SCREEN EXCLUDES NOBODY FOR DEPTH, ON PURPOSE, BECAUSE THE FINDINGS LAYER ALREADY DID IT
//   BETTER AND PER RULE. A rule needing more history than a stock has returns `not_evaluable` with
//   `insufficient_annual_history` / `insufficient_quarters` — the exclusion is already recorded, on
//   the row, with its reason, by the rule that knows how much history IT needs. A global floor laid
//   over that would drop stocks a shallow-history rule can evaluate perfectly well, and would report
//   one number where the rows carry a reason each. So `depthFloor` stays null and `excludedForDepth`
//   stays 0 — a floor that never fires must not be declared, which is the ruling `resolveScreen`
//   already records — and the not-evaluable REASONS are carried instead, in words.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** One company that fired, with what fired at it and when. */
export interface FindingMatch {
  readonly symbol: string;
  readonly name: string;
  /** The finding names that fired, already in the catalogue's words. Never a key, never a ref. */
  readonly fired: readonly string[];
  /** The filing period the finding is as of. Stocks sit at their own, so it is per row. */
  readonly period: string;
  /** For ordering the period column — the row's `period_end`, never rendered. */
  readonly periodSort: number;
  /** `null` for the 2,196 we do not score, which is most of this set. */
  readonly score: number | null;
  readonly band: string | null;
}

/** ★ THE THREE STATES, PLUS THE ONE THE ROWS RECORD BY ABSENCE. Total over `considered`. */
export interface FindingCensus {
  /** Every stock the screen ran over. */
  readonly considered: number;
  readonly fired: number;
  /** Ran, and did not match. A RESULT — the checks completed and raised nothing. */
  readonly notFired: number;
  /** Could not run. NEVER folded into the line above. */
  readonly notEvaluable: number;
  /** No row at all — the rule has never been evaluated against this company. Never called clean. */
  readonly notEvaluated: number;
  /** Why the check could not run, in the reader's words, commonest first. Never a token. */
  readonly reasons: readonly { readonly why: string; readonly count: number }[];
}

export interface FindingScreenRead {
  /** What was filtered on, in words — one rule's name, or a kind. */
  readonly what: string;
  readonly matches: readonly FindingMatch[];
  readonly census: FindingCensus;
  /** Set when a band narrowed the result — see below for why that costs reach. */
  readonly band: string | null;
  readonly bandDropped: number;
  readonly sortedBy: string;
}

/**
 * ⚠ THE READER-FACING SENTENCE FOR EACH `NotEvaluableReason`, AND IT IS AUTHORED RATHER THAN
 *   PROJECTED. The tokens are engine vocabulary ("insufficient_annual_history") and `I-RAW-TOKEN`
 *   exists precisely to stop one reaching prose. The fallback says we could not run the check rather
 *   than inventing a reason for it, so a token a new rule introduces degrades to the truth.
 */
const NOT_EVALUABLE_PHRASE: Readonly<Record<string, string>> = {
  insufficient_annual_history: "too few filed annual accounts for the check to have an opinion",
  insufficient_quarters: "too few filed quarters for the check to have an opinion",
  insufficient_shareholding_history: "too few shareholding filings to compare against",
  negative_equity: "net worth is at or below zero, so the ratio the check reads is meaningless",
  no_debt: "no interest cost to measure coverage against",
  class_not_disclosed: "the shareholding filing did not break out that class of holder",
  share_count_unavailable: "the absolute promoter share count is missing from the filing",
  pledging_not_disclosed: "pledging is not disclosed for this company's peer group",
  no_prior_snapshots: "no earlier reading to compare this one against",
  opm_unavailable: "no operating-margin series held",
  pillar_unavailable: "one of the parts the check reads is unscored",
  band_typical_unavailable: "the band-typical profiles this check compares against were not computed",
  feed_not_wired: "the insider and block-deal feeds do not cover this company",
  missing_line_item: "a figure the check needs is absent from the latest filing",
  industry_not_applicable: "the check's arithmetic is not defined for this industry",
};
const notEvaluablePhrase = (token: string | null): string =>
  (token && NOT_EVALUABLE_PHRASE[token]) || "the check could not be run on what this company has filed";

interface FindingStateRow {
  symbol: string;
  name: string | null;
  fired_names: string[] | null;
  state: string;
  reason: string | null;
  period_key: string | null;
  period_end: Date | null;
}

/**
 * ★ ONE QUERY, AND THE PER-STOCK STATE IS DECIDED IN SQL RATHER THAN OVER 2,291 ROUND TRIPS.
 *
 * ⚠ THE PRECEDENCE IS THE THREE-STATE CONTRACT, NOT A CONVENIENCE. With several rules in scope (a
 *   KIND filter names up to eleven), a company can be `fired` on one and `not_evaluable` on another.
 *   The ladder is fired then not_evaluable then not_fired, so a company is only ever reported as
 *   "ran and did not match" when EVERY selected rule that has a row ran and did not match. Putting
 *   not_fired above not_evaluable is the exact silent fold this resolver exists to prevent.
 *
 * ⚠ `DISTINCT ON (stock_id, rule_key) ... ORDER BY period_end DESC` IS THE LATEST-PER-RULE HEAD. Rows
 *   stack one per (stock, rule, filing period) by the table's own unique key, and a screen must read
 *   the current state rather than every period a rule ever fired in.
 */
const FINDING_SCREEN_SQL = `
WITH latest AS (
  SELECT DISTINCT ON (f.stock_id, f.rule_key)
         f.stock_id, f.symbol, f.rule_key, f.evaluation_state, f.not_evaluable_reason,
         f.period_key, f.period_end
  FROM stock_findings f
  WHERE f.rule_key = ANY($1::text[])
  ORDER BY f.stock_id, f.rule_key, f.period_end DESC
),
rolled AS (
  SELECT l.stock_id,
         l.symbol,
         CASE
           WHEN bool_or(l.evaluation_state = 'fired')         THEN 'fired'
           WHEN bool_or(l.evaluation_state = 'not_evaluable') THEN 'not_evaluable'
           ELSE 'not_fired'
         END AS state,
         (array_agg(l.not_evaluable_reason) FILTER (WHERE l.evaluation_state = 'not_evaluable'))[1] AS reason,
         (array_agg(l.rule_key ORDER BY l.period_end DESC) FILTER (WHERE l.evaluation_state = 'fired')) AS fired_keys,
         max(l.period_end) FILTER (WHERE l.evaluation_state = 'fired') AS fired_end
  FROM latest l GROUP BY l.stock_id, l.symbol
)
SELECT r.symbol,
       s.name,
       r.state,
       r.reason,
       r.fired_keys AS fired_names,
       (SELECT l2.period_key FROM latest l2
         WHERE l2.stock_id = r.stock_id AND l2.evaluation_state = 'fired'
         ORDER BY l2.period_end DESC LIMIT 1) AS period_key,
       r.fired_end AS period_end
FROM rolled r JOIN stocks s ON s.id = r.stock_id`;

/** How many stocks exist at all — the denominator the "never evaluated" count is taken against. */
const STOCK_COUNT_SQL = `SELECT COUNT(*)::int AS n FROM stocks`;

export async function resolveFindingScreen(
  /** The catalogue keys in scope. One for a named rule; the whole kind otherwise. */
  ruleKeys: readonly string[],
  /** What the reader filtered on, in words. Rendered; never derived from a key here. */
  what: string,
  /** ★ A BAND NARROWS THIS TO THE SCORED 95, AND THAT COST IS STATED — see below. */
  bandLabel: string | null = null,
): Promise<Resolved<FindingScreenRead>> {
  if (ruleKeys.length === 0) {
    return absent<FindingScreenRead>("missing_line_item", { subject: null, query: null });
  }

  // ⚠ `query: null` ON A FAILED READ, NEVER A ZEROED COVERAGE. `universeSearched` is a `number`, so a
  //   `?? 0` here would state "we searched 0 companies" about a read that never ran — the same choice
  //   `resolveUniverse` documents, reached the same way.
  let read = true;
  const fail = () => { read = false; return null; };
  const [rows, totals] = await Promise.all([
    prisma.$queryRawUnsafe<FindingStateRow[]>(FINDING_SCREEN_SQL, [...ruleKeys]).catch(fail),
    prisma.$queryRawUnsafe<{ n: number }[]>(STOCK_COUNT_SQL).catch(fail),
  ]);
  if (!read || !rows || !totals) {
    return absent<FindingScreenRead>("read_failed", { subject: null, query: null });
  }

  const universe = Number(totals[0]?.n ?? 0);
  const evaluated = rows.length;
  // ★ THE FOURTH STATE. Every stock we hold, minus every stock this rule set has a row for.
  const notEvaluated = Math.max(0, universe - evaluated);

  // ★ THE BAND, WHERE ONE WAS ASKED FOR — and it is a genuine narrowing of REACH, not just of rows.
  //   A band is a reading, so only the 95 scored companies have one; filtering this 2,291-wide screen
  //   by band restricts it to those, and `bandDropped` is what the answer says out loud.
  let bandMembers: Map<string, { score: number | null; band: string }> | null = null;
  const view = await getUniverseHealthView().catch(() => null);
  if (view?.members) {
    bandMembers = new Map(
      view.members.map((m) => [
        m.symbol,
        { score: typeof m.composite === "number" ? m.composite : null, band: BAND_LABEL[m.labelBand] },
      ]),
    );
  }

  const nameOf = (key: string): string =>
    (STOCK_FINDINGS as Record<string, { name?: string }>)[key]?.name ?? key;

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠⚠ THE PERIOD KEY IS AN ENGINE TOKEN AND WAS GOING STRAIGHT ONTO THE CARD — caught composing the
  //    first live findings screen, which printed `A:FY26`, `S:FY27Q2` and `W:FY27Q2` in a column a
  //    reader reads. `I-RAW-TOKEN` exists for exactly this and the grain prefix is the definition of
  //    one: "<grain>:<period>" is identity, documented on the column as "Identity, never the sort".
  //
  // ★ AND NEITHER HALF IS RE-DERIVED HERE. `parsePeriodKey` splits it and `GRAIN_LABEL` says what
  //   each grain MEANS — its own comment is "never a raw 'A:FY26' on a surface". Two existing homes,
  //   no third (N-3).
  //
  // ⚠ `W` TAKES THE LABEL ALONE, AND THAT IS NOT A SPECIAL CASE FOR ITS OWN SAKE. P6 and H read dated
  //   event streams over a window ending at the evaluation date, so `GRAIN_LABEL.W` is already a SPAN
  //   ("trailing 90 days") rather than a filing name. "FY27Q2 trailing 90 days" would pair a quarter
  //   with a window that is not that quarter — the grain's own note says the reader is told what the
  //   span IS rather than shown a filing label it does not have.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const periodPhrase = (key: string | null): string => {
    if (!key) return "an unlabelled period";
    const parsed = parsePeriodKey(key);
    if (!parsed) return key;
    return parsed.grain === "W"
      ? GRAIN_LABEL.W
      : `${parsed.label} ${GRAIN_LABEL[parsed.grain]}`;
  };

  const firedAll = rows.filter((r) => r.state === "fired");
  const inBand = (symbol: string): boolean =>
    bandLabel === null || (bandMembers?.get(symbol)?.band ?? null) === bandLabel;
  const firedKept = firedAll.filter((r) => inBand(r.symbol));

  const matches: FindingMatch[] = firedKept
    .map((r) => {
      const meta = bandMembers?.get(r.symbol) ?? null;
      return {
        symbol: r.symbol,
        name: r.name ?? r.symbol,
        fired: (r.fired_names ?? []).map(nameOf),
        period: periodPhrase(r.period_key),
        periodSort: r.period_end ? new Date(r.period_end).getTime() : 0,
        score: meta?.score ?? null,
        band: meta?.band ?? null,
      };
    })
    // ⚠ MOST RECENT FILING FIRST, AND NOT BY SCORE. Most of this set carries no score at all, so a
    //   health sort would put the entire unscored majority in one undifferentiated block at the end.
    .sort((a, b) => b.periodSort - a.periodSort || a.symbol.localeCompare(b.symbol));

  const notEvaluableRows = rows.filter((r) => r.state === "not_evaluable");
  const byReason = new Map<string, number>();
  for (const r of notEvaluableRows) {
    const why = notEvaluablePhrase(r.reason);
    byReason.set(why, (byReason.get(why) ?? 0) + 1);
  }

  const census: FindingCensus = {
    considered: universe,
    fired: firedAll.length,
    notFired: rows.filter((r) => r.state === "not_fired").length,
    notEvaluable: notEvaluableRows.length,
    notEvaluated,
    reasons: [...byReason].map(([why, count]) => ({ why, count })).sort((a, b) => b.count - a.count),
  };

  // ⚠ EVERY NON-FIRING STATE IS A NAMED `dropped` ROW. That is what `DroppedFilter` is for: "a set
  //   that quietly lost members reads as a complete set", and three of these four are the ways this
  //   set loses members without the reader being able to see it.
  const q: QueryCoverage = {
    universeSearched: universe,
    depthFloor: null,
    excludedForDepth: 0,
    // ⚠ EACH `why` IS A NOUN PHRASE, BECAUSE THE HEADER PUTS IT AFTER THE WORD "excluded".
    //   `coverage-header.tsx` renders `· excluded {why} ({n}); …`, so a clause reads as a fragment:
    //   "excluded the check ran and Pledging Crisis did not fire (1,999)". Seen on the rendered page.
    //
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ⚠⚠ AND "DID NOT FIRE" IS NO LONGER LISTED, BECAUSE IT WAS NEVER AN EXCLUSION.
    //
    //    `DroppedFilter` is for members removed from consideration for want of data — its own note is
    //    "a set that quietly lost members reads as a complete set". A company the check RAN on and
    //    cleared was not lost; it is the result. Listing 1,999 of them under "excluded" put the
    //    largest and least informative number on the coverage line and made a working screen read
    //    like a heavily-filtered one.
    //
    // ★ WHAT STAYS IS THE GENUINE GAP: companies the check could not run on, and companies it has
    //   never been run against. Those two ARE missing data, they are what the reader cannot see, and
    //   together they are the difference between the book and the denominator the answer states.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    dropped: [
      { filter: "could not be checked", dropped: census.notEvaluable, why: `companies the check could not be run on` },
      { filter: "never checked", dropped: census.notEvaluated, why: `companies with no filing for the check to read` },
      ...(bandLabel
        ? [{ filter: "band", dropped: firedAll.length - firedKept.length, why: `companies firing it outside the ${bandLabel} band` }]
        : []),
    ].filter((d) => d.dropped > 0),
  };

  return resolved<FindingScreenRead>({
    what,
    matches,
    census,
    band: bandLabel,
    bandDropped: firedAll.length - firedKept.length,
    sortedBy: "most recent filing first",
  }, { subject: null, query: q }, ["stocks", "score_snapshots"]);
}

export type { ScreenCondition, ScreenFieldId };
