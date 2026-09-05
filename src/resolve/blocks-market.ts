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
export async function resolveScreen(conditions: readonly ScreenCondition[]): Promise<Resolved<ScreenRead>> {
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
  const proj = await screenUniverse(view, metrics, null, { conditions: [...conditions] })
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
  const q: QueryCoverage = {
    ...baseQ,
    universeSearched: Number(evaluable?.considered ?? baseQ.universeSearched),
    dropped: applied.map((c) => ({
      filter: String(c.field),
      dropped: Math.max(0, Number(evaluable?.considered ?? 0) - Number(c.evaluable ?? 0)),
      why: `no comparable value held for ${String(c.label)}`,
    })).filter((d) => d.dropped > 0),
  };

  const matches: ScreenMatch[] = items.slice(0, 20).map((r) => ({
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
  }, { subject: null, query: q }, PROV_SCORED);
}

export type { ScreenCondition, ScreenFieldId };
