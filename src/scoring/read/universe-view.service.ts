// File: src/scoring/read/universe-view.service.ts
//
// Universe-level aggregate: all ~93 scored stocks folded into ONE ScopeAggregate.
// Reuses computeScopeAggregate + the buildPeerGroupList query pattern without the
// per-pond bucketing. Two DB round-trips; no per-stock series calls.
//
// RT1 (parallel): lean quarterly snapshots + peer groups (for sector mapping)
// RT2 (parallel): full cross-section (no metricScores) + stock names + anchor flags
//
// The reach thresholds for pathology are rescaled:
//   Pond   → widespread = N/M ≥ 0.50 (half the pond, N≈4–10)
//   Universe → widespread = N/M ≥ 0.20 (one fifth of 93 stocks — systemic signal)

import type { DivergenceHeadline } from "./health-view.types.js";
import { prisma } from "../../db/prisma.js";
import { firingDivergenceKeys, headlineOf, pillarSpreadOf } from "./divergence-headline.js";
import { COMPOSITE_MOVE_DEADBAND } from "./display-constants.js";
// The ONE severity ordering (File 1 §5, total over all eight tokens). See `worseSeverity` below
// for why this is imported rather than redeclared locally — the local copy was silently wrong.
import { severityWeight as severityRank } from "../../catalogue/divergence.js";
import { dropRetiredPatterns } from "../../catalogue/retired-findings.js";
// ★ THE LIVE RED-FLAG CHANNEL — stock-grain, still written. Replaces the score_red_flags read.
import { readStandingRedFlags } from "../../filing/read.js";
// ★ NOT-COVERED SUPPRESSION (mirrors the retirement guards on this page) — a persisted `notcovered_*`
//   row must never enter the member-level fired list or the universe pathology census; the census in
//   particular would otherwise report "fires on N of the universe" about a configuration explicitly
//   excluded from ranking against anything.
import { dropNotCoveredPatterns } from "../../catalogue/not-covered.js";
import { GAP_MATERIAL, GAP_STRETCHED } from "../findings/divergence/bands.js";
import { computeScopeAggregate, describeScope, type ScopeMember } from "./scope-aggregate.js";
import { resolveHeadSnapshots, splitByStaleness, pluralityPeriod } from "./head-snapshot.js";
import type {
  PillarKey,
  LabelBand,
  TrajectoryMarker,
  DivergenceFlag,
  FlowCategoryState,
} from "./health-view.types.js";
import type {
  PathologyCensusItem,
  PathologyReach,
  PeerGroupMover,
  FiredFlag,
  FiredPattern,
  BandDistribution,
} from "./peer-group-view.types.js";
import type {
  UniverseHealthView,
  UniverseMemberView,
  UniverseAggregate,
  UniverseSinceLastWeek,
} from "./universe-view.types.js";

// ── helpers (mirrors peer-group-view conventions) ───────────────────────────
const num = (d: unknown): number =>
  d == null
    ? 0
    : typeof (d as { toNumber?: () => number }).toNumber === "function"
      ? (d as { toNumber: () => number }).toNumber()
      : Number(d);

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const round2 = (x: number): number => Math.round(x * 100) / 100;

// ★ PHASE 4 — canonical bands, not a local copy. See health-view.service.ts for the full note.
const DIVERGENCE_NOTABLE = GAP_MATERIAL;
const DIVERGENCE_WIDE = GAP_STRETCHED;
const MOVER_CAP = 10;
const DETERIORATION_THRESHOLD = -2.0;
const RECOVERY_THRESHOLD = 2.0;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Scaled from pond's 0.50: for a universe of 93, N/M ≥ 0.20 = ~19 stocks firing
// the same flag — systemic, not isolated.
const UNIVERSE_WIDESPREAD_RATIO = 0.2;

// ── SEVERITY ORDERING — ONE HOME (catalogue/divergence.ts `severityWeight`) ────────────────────
//
// ★ THIS USED TO BE A LOCAL 4-TOKEN MAP {critical, high, medium, low} AND IT WAS SILENTLY WRONG,
// because the engine emits EIGHT severity tokens. The §5E pattern tones — red · amber · green ·
// recovery — were absent from it, so `SEVERITY_ORDER[s] ?? 50` collapsed all four to the same
// rank. Two consequences, both live and both observed:
//
//   1. `worseSeverity` STOPPED BEING "WORSE". With a and b tied at 50 it returns `a` — whichever
//      member the query happened to reach first. momentum_P13_revenue_inflection fires green on
//      one company and red on another; its census row was reading GREEN, purely by row order.
//      A census row that claims to carry the worst severity was carrying an arbitrary one.
//   2. THE BOARD SORTED WRONG. Everything at rank 50 sorted after `low`, then fell back to member
//      count — so foundation_P7_accruals (RED, the heaviest §5E magnitude) rendered BELOW
//      composition_F1_atypical (LOW), and red/amber/green/recovery interleaved by popularity.
//
// The correct total ordering already existed one module away, in the catalogue, transcribed from
// File 1 §5 and covering all eight tokens. `severityRank` is now that import (see the top of the
// file) — one home, not a third copy. (catalogue/ imports nothing from scoring/read — no cycle.)
//
// ⚠ WHAT THIS FIX DOES NOT DO: it makes P13's row report the WORSE of its two severities, which is
// correct for a census and still incomplete as a reader experience — the row will now say "red"
// while POWERINDIA's own page shows the same pattern green. Stating the SPREAD is a separate,
// larger change (payload + board + chat tool) and is written up rather than smuggled in here.
const worseSeverity = (a: string | null, b: string | null): string | null =>
  severityRank(a) <= severityRank(b) ? a : b;

const BAND_RANK: Record<LabelBand, number> = {
  fragile: 0,
  below_par: 1,
  steady: 2,
  healthy: 3,
  pristine: 4,
};

/**
 * ★ RULING 3's HEADLINE STATE — read/divergence-headline.ts, the ONE home.
 *
 * ⚠ THIS REPLACED A LOCAL `divergenceOf` THAT SORTED THE SCORED SUBTOTALS, TOOK THE EXTREMES AND
 * BANDED THE DISTANCE AT 15/25. Three services carried that block independently (this one,
 * peer-group-view, health-view) plus the frontend's `pickScoredPair`. It chose a pair with no
 * reference to which pair any fired finding was about — the IOC bug — and its 15/25 banding was a
 * third severity scale beside §1.2's 12/16/25 and S1's ≤7.
 *
 * A list row shows the STATE, not a pair: it has no chart to put one on. The pair is served per
 * finding on the per-stock view, where a card can actually render it.
 */
function divergenceOf(
  scoredSubtotals: { pillar: PillarKey; subtotal: number }[],
  fired: { patternKey: string }[],
): { headline: DivergenceHeadline; spread: number | null } {
  const spread = pillarSpreadOf(scoredSubtotals);
  return { headline: headlineOf(spread, firingDivergenceKeys(fired)), spread };
}

function reachOf(n: number, m: number): PathologyReach {
  if (n <= 1) return "isolated";
  if (m > 0 && n / m >= UNIVERSE_WIDESPREAD_RATIO) return "widespread";
  return "cluster";
}

// ── lean snapshot shape (RT1) ───────────────────────────────────────────────
interface LeanSnap {
  id: string;
  stockId: string;
  symbol: string;
  peerGroupId: string;
  periodKey: string;
  version: number;
  asOfDate: Date;
  composite: unknown;
  labelBand: string;
  foundationSubtotal: unknown;
  momentumSubtotal: unknown;
  marketSubtotal: unknown;
  ownershipSubtotal: unknown;
}

/** Supersede-aware cross-section, now assembled from the SHARED head resolver (head-snapshot.ts)
 *  rather than re-implementing it here. `current` = every stock's head snapshot that is still fresh;
 *  genuinely dark names are `lagging`. `periodKey` is a display label (the plurality period) — members
 *  may span periods, which is the whole reason universe-projection.types.ts refuses to pass it on.
 *
 *  ★ THE THREE STEPS MOVED, THE BEHAVIOUR DID NOT. Same MAX-version-per-period, same latest-period,
 *  same 45-day staleness window, same tie-breaks. The extraction is a MOVE, and the Stage 1 gate
 *  (94 members, FY27Q1:64 / FY26Q4:30, NESTLEIND held out) is what proves it. */
function resolveCrossSection(rows: LeanSnap[]): {
  periodKey: string;
  asOfDate: Date;
  current: LeanSnap[];
  lagging: { symbol: string; latestPeriod: string }[];
} | null {
  if (rows.length === 0) return null;

  const head = resolveHeadSnapshots(rows);
  const { current, stale } = splitByStaleness(head.values());
  if (current.length === 0) return null;

  const lagging = stale
    .map((r) => ({ symbol: r.symbol, latestPeriod: r.periodKey }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const periodKey = pluralityPeriod(current) ?? rows[0].periodKey;
  // asOf shown = the freshest rescore date among the live members.
  const asOfDate = current.reduce((a, b) => (b.asOfDate > a.asOfDate ? b : a), current[0]).asOfDate;

  return { periodKey, asOfDate, current, lagging };
}


// ── lighter full cross-section load (RT2, no metricScores) ─────────────────
type FullUniverseSnap = Awaited<ReturnType<typeof loadUniverseCrossSection>>[number];

function loadUniverseCrossSection(ids: string[]) {
  return prisma.scoreSnapshot.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      stockId: true,
      symbol: true,
      composite: true,
      labelBand: true,
      foundationSubtotal: true,
      momentumSubtotal: true,
      marketSubtotal: true,
      ownershipSubtotal: true,
      foundationPillar: { select: { pillarState: true } },
      momentumPillar: { select: { pillarState: true } },
      marketPillar: { select: { pillarState: true } },
      ownershipPillar: {
        select: {
          pillarState: true,
          ownershipScore: {
            select: { flowCategories: { select: { category: true, categoryState: true } } },
          },
        },
      },
      // `redFlags` was selected here until 2026-08-11 — the relation is gone with score_red_flags;
      // the live channel is read by stock id (readStandingRedFlags), not off the snapshot graph.
      patterns: { select: { patternKey: true, direction: true, severity: true, displayState: true } },
    },
  });
}

// ── pathology census builder ────────────────────────────────────────────────
type Acc = { severity: string | null; members: { symbol: string; sev: string | null }[]; states: string[] };

// Dominant display state across a pattern's firing members: dampened wins (PG-wide dampening
// marks every member), else pending only when ALL are pending, else active.
const dominantState = (states: string[]): "active" | "pending_data_integration" | "dampened" =>
  states.some((s) => s === "dampened")
    ? "dampened"
    : states.length > 0 && states.every((s) => s === "pending_data_integration")
      ? "pending_data_integration"
      : "active";

function buildCensus(
  acc: Map<string, Acc>,
  kind: "red_flag" | "pattern",
  M: number,
): PathologyCensusItem[] {
  return [...acc.entries()]
    .map(([key, v]): PathologyCensusItem => {
      const members = v.members
        .sort(
          (a, b) =>
            severityRank(a.sev) - severityRank(b.sev) || a.symbol.localeCompare(b.symbol),
        )
        .map((m) => m.symbol);
      return {
        kind,
        key,
        severity: v.severity,
        memberCount: members.length,
        outOf: M,
        members,
        reach: reachOf(members.length, M),
        displayState: dominantState(v.states),
      };
    })
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        b.memberCount - a.memberCount ||
        a.key.localeCompare(b.key),
    );
}

// ── main export ─────────────────────────────────────────────────────────────

export async function buildUniverseHealthView(): Promise<UniverseHealthView> {
  const now = new Date();
  const anchor = new Date(now.getTime() - SEVEN_DAYS_MS);
  const anchorDate = ymd(anchor);

  const EMPTY_WEEK: UniverseSinceLastWeek = {
    anchorDate,
    newVersionCount: 0,
    bandCrossings: [],
    newFlags: [],
    newDeteriorations: [],
    newRecoveries: [],
    honestNote:
      "Snapshots are quarterly + EOD price-driven rescores. The 7-day window compares " +
      "the current in-force version vs the oldest available version within the window " +
      "(falling back from the pre-anchor baseline when the period itself started inside " +
      "the window). Band crossings are almost entirely market-pillar-led.",
  };

  // ── RT1 (parallel): lean quarterly snaps + peer groups ───────────────────
  const [leanRows, pgs] = await Promise.all([
    prisma.scoreSnapshot.findMany({
      where: { snapshotType: "quarterly" },
      select: {
        id: true,
        stockId: true,
        symbol: true,
        peerGroupId: true,
        periodKey: true,
        version: true,
        asOfDate: true,
        composite: true,
        labelBand: true,
        foundationSubtotal: true,
        momentumSubtotal: true,
        marketSubtotal: true,
        ownershipSubtotal: true,
      },
    }) as Promise<LeanSnap[]>,
    prisma.peerGroup.findMany({
      select: {
        id: true,
        sector: { select: { name: true, displayName: true } },
      },
    }),
  ]);

  const sectorByPg = new Map(
    pgs.map((pg) => [
      pg.id,
      pg.sector ? { key: pg.sector.name, displayName: pg.sector.displayName } : null,
    ]),
  );

  const xs = resolveCrossSection(leanRows);
  if (!xs) {
    return {
      scored: false,
      periodKey: null,
      asOfDate: null,
      scoredUniverseSize: 0,
      aggregate: null,
      members: [],
      notAtCurrentPeriod: [],
      pathology: [],
      lensPathology: [],
      movers: { risers: [], slippers: [] },
      sinceLastWeek: EMPTY_WEEK,
    };
  }

  const currentIds = xs.current.map((r) => r.id);
  const currentStockIds = new Set(xs.current.map((r) => r.stockId));

  // Quick-access maps from the lean batch (no extra DB queries needed for
  // trajectory + drift + movers + sinceLastWeek anchor detection).

  // Per-stock: in-force snap at each period (MAX version per stockId|periodKey)
  // → used to derive trajectory markers and prior-period data.
  const inForceByPeriodByStock = new Map<string, Map<string, LeanSnap>>();
  for (const r of leanRows) {
    if (!currentStockIds.has(r.stockId)) continue;
    const periods = inForceByPeriodByStock.get(r.stockId) ?? new Map<string, LeanSnap>();
    const cur = periods.get(r.periodKey);
    if (!cur || r.version > cur.version) periods.set(r.periodKey, r);
    inForceByPeriodByStock.set(r.stockId, periods);
  }

  // Per-stock: the in-force snap at the period BEFORE the current period
  // → drift aggregate + movers
  const priorByStock = new Map<string, LeanSnap>();
  for (const [stockId, periods] of inForceByPeriodByStock) {
    const sorted = [...periods.values()].sort(
      (a, b) =>
        b.asOfDate.getTime() - a.asOfDate.getTime() || b.periodKey.localeCompare(a.periodKey),
    );
    if (sorted.length >= 2) priorByStock.set(stockId, sorted[1]);
  }

  // Quick-access: current in-force lean snap per stock (for peerGroupId → sector
  // and sinceLastWeek version comparison)
  const currentLeanByStock = new Map<string, LeanSnap>(
    xs.current.map((r) => [r.stockId, r]),
  );

  // sinceLastWeek anchor: MAX version at current period where asOfDate ≤ anchor.
  // Fallback: when no pre-anchor version exists (e.g. FY26Q4 scoring started WITHIN
  // the 7-day window), use the OLDEST available version at the current period as the
  // comparison baseline — so v1@Jun-18 → v2@Jun-20 changes are still surfaced.
  const priorAnchorByStock = new Map<string, LeanSnap>();
  // Pass 1: pre-anchor versions (MAX version where asOfDate ≤ anchor). Compared within
  // each stock's OWN current period (members can span periods post-rollover), not one
  // universe-wide period — so a stock a quarter behind still gets its 7-day baseline.
  for (const r of leanRows) {
    if (!currentStockIds.has(r.stockId)) continue;
    if (r.periodKey !== currentLeanByStock.get(r.stockId)?.periodKey) continue;
    if (r.asOfDate > anchor) continue;
    const cur = priorAnchorByStock.get(r.stockId);
    if (!cur || r.version > cur.version) priorAnchorByStock.set(r.stockId, r);
  }
  // Pass 2: fallback — MINIMUM (oldest) in-window version for stocks with no pre-anchor state
  for (const r of leanRows) {
    if (!currentStockIds.has(r.stockId)) continue;
    if (r.periodKey !== currentLeanByStock.get(r.stockId)?.periodKey) continue;
    if (priorAnchorByStock.has(r.stockId)) continue; // already have pre-anchor baseline
    const currentLean = currentLeanByStock.get(r.stockId);
    if (!currentLean || r.version >= currentLean.version) continue; // skip current version itself
    const cur = priorAnchorByStock.get(r.stockId);
    if (!cur || r.version < cur.version) priorAnchorByStock.set(r.stockId, r); // keep minimum
  }


  // ── RT2 (parallel): full cross-section + stock names + the LIVE red-flag channel ───────
  //
  // ★ REPOINTED 2026-08-11. This used to read `score_red_flags` on the ANCHOR snapshots. That table
  //   has had no writer since the filing cutover (R1…R6 are all FILING_RULES; the scoring pass
  //   registers no red-flag rule at all), and every one of its 215 surviving rows sits on a
  //   superseded or older-period snapshot — so the read returned nothing and `firedFlags` was empty
  //   on all 94 members. The live channel is stock-grain, not snapshot-grain, which is why it is
  //   keyed on `currentStockIds` here.
  //
  // ⚠ SCOPED TO THE MEMBERS, DELIBERATELY. `readStandingRedFlags` is universe-wide and 51 stocks
  //   carry a standing red flag today — but 45 of them are unscored and this view describes the
  //   scored cross-section only (composite, band, pillars, percentile). Passing `currentStockIds`
  //   and nothing else keeps the population exactly what it was; reaching the other 45 needs a
  //   504-stock denominator and is a different piece of work.
  const [fullSnaps, stocks, standingFlags] = await Promise.all([
    loadUniverseCrossSection(currentIds),
    prisma.stock.findMany({
      where: { id: { in: [...currentStockIds] } },
      select: { id: true, name: true },
    }),
    readStandingRedFlags([...currentStockIds]),
  ]);

  const nameById = new Map(stocks.map((s) => [s.id, s.name]));

  // ── Build members + scope members + pathology accumulators ────────────────
  const scopeMembers: ScopeMember[] = [];
  const memberViews: UniverseMemberView[] = [];
  const flagAcc = new Map<string, Acc>();
  const patternAcc = new Map<string, Acc>();

  // sinceLastWeek accumulators
  const bandCrossings: UniverseSinceLastWeek["bandCrossings"] = [];
  const newFlags: UniverseSinceLastWeek["newFlags"] = [];
  const newDeteriorations: UniverseSinceLastWeek["newDeteriorations"] = [];
  const newRecoveries: UniverseSinceLastWeek["newRecoveries"] = [];
  let newVersionCount = 0;

  for (const s of fullSnaps) {
    const pillars: Record<PillarKey, number> = {
      foundation: num(s.foundationSubtotal),
      momentum: num(s.momentumSubtotal),
      market: num(s.marketSubtotal),
      ownership: num(s.ownershipSubtotal),
    };

    // Divergence — only scored pillars contribute
    const scoredSubs: { pillar: PillarKey; subtotal: number }[] = [];
    if (s.foundationPillar?.pillarState === "scored")
      scoredSubs.push({ pillar: "foundation", subtotal: pillars.foundation });
    if (s.momentumPillar?.pillarState === "scored")
      scoredSubs.push({ pillar: "momentum", subtotal: pillars.momentum });
    if (s.marketPillar?.pillarState === "scored")
      scoredSubs.push({ pillar: "market", subtotal: pillars.market });
    if (s.ownershipPillar?.pillarState === "scored")
      scoredSubs.push({ pillar: "ownership", subtotal: pillars.ownership });

    // ★ THE LIVE RED-FLAG CHANNEL, same shape as before. `readStandingRedFlags` returns the CURRENT
    //   row per (stock, rule) that fired — the same "is it standing now" question the frozen snapshot
    //   rows used to answer, asked of the table that is still being written.
    //
    //   `tier: "auto"` is not a guess: the scoring pass wrote that literal on every rule-fired red
    //   flag (findings/persist.ts), and `"review"` only ever meant a guardrail-raised one. Every
    //   filing red flag is a rule firing, so "auto" is exactly what it was.
    //
    //   RETIREMENT SUPPRESSION is gone with the source and is not needed: a retired key cannot reach
    //   `stock_findings` at all — the filing pass writes one row per REGISTERED rule, and the retired
    //   ones are unregistered by construction (verify-rule-thresholds.ts §3 asserts that set).
    const firedFlags: FiredFlag[] = (standingFlags.get(s.stockId) ?? [])
      .map((rf) => ({
        flagKey: rf.ruleKey,
        severity: rf.severity,
        tier: "auto" as const,
      }))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

    const firedPatterns: FiredPattern[] = dropNotCoveredPatterns(dropRetiredPatterns(s.patterns))
      .map((p) => ({
        patternKey: p.patternKey,
        direction: p.direction,
        severity: p.severity,
        displayState: (p.displayState ?? "active") as FiredPattern["displayState"],
      }))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

    // Trajectory from in-memory lean batch (prior period for this stock)
    const priorSnap = priorByStock.get(s.stockId);
    let trajectoryMarker: TrajectoryMarker | null = null;
    let trajectoryDelta: number | null = null;
    if (priorSnap) {
      const d = round2(num(s.composite) - num(priorSnap.composite));
      trajectoryDelta = d;
      trajectoryMarker =
        d > COMPOSITE_MOVE_DEADBAND ? "improving" : d < -COMPOSITE_MOVE_DEADBAND ? "deteriorating" : "stable";
    }

    const sector = sectorByPg.get(currentLeanByStock.get(s.stockId)?.peerGroupId ?? "") ?? null;

    const flowCats = s.ownershipPillar?.ownershipScore?.flowCategories ?? [];
    const cState = flowCats.find((f) => f.category === "C_insider")?.categoryState;
    const dState = flowCats.find((f) => f.category === "D_block")?.categoryState;
    const flowCategoryStates =
      cState != null && dState != null
        ? { C_insider: cState as FlowCategoryState, D_block: dState as FlowCategoryState }
        : undefined;

    memberViews.push({
      symbol: s.symbol,
      name: nameById.get(s.stockId) ?? s.symbol,
      composite: round2(num(s.composite)),
      labelBand: s.labelBand as LabelBand,
      pillars,
      trajectoryMarker,
      trajectoryDelta,
      divergence: divergenceOf(scoredSubs, firedPatterns),
      firedFlags,
      firedPatterns,
      sector,
      flowCategoryStates,
      // ★ THIS member's own period, not xs.periodKey (the plurality LABEL). See the field's
      //   comment in universe-view.types.ts — the mixed cross-section is the whole reason.
      periodKey: currentLeanByStock.get(s.stockId)?.periodKey ?? xs.periodKey,
      // …and the day that reading was written. Same reasoning, one step finer: on a surface that
      // genuinely mixes quarters, "which quarter" and "how old" are two different questions.
      asOfDate: ymd(currentLeanByStock.get(s.stockId)?.asOfDate ?? xs.asOfDate),
    });

    scopeMembers.push({
      stockId: s.stockId,
      symbol: s.symbol,
      composite: num(s.composite),
      labelBand: s.labelBand as LabelBand,
      pillars,
      firesAnyRedFlag: firedFlags.length > 0,
      weight: 1,
    });

    // Pathology accumulators. ★ The flag half reads the SAME live set `firedFlags` was built from
    //   (2026-08-11), so the census, the member marker and the member's own fired list can no longer
    //   disagree about whether a company is firing a red flag — they are three views of one array.
    for (const rf of firedFlags) {
      const acc = flagAcc.get(rf.flagKey) ?? { severity: null, members: [], states: [] };
      acc.severity = worseSeverity(acc.severity, rf.severity);
      acc.members.push({ symbol: s.symbol, sev: rf.severity });
      flagAcc.set(rf.flagKey, acc);
    }
    for (const p of dropNotCoveredPatterns(dropRetiredPatterns(s.patterns))) {
      const acc = patternAcc.get(p.patternKey) ?? { severity: null, members: [], states: [] };
      acc.severity = worseSeverity(acc.severity, p.severity);
      acc.members.push({ symbol: s.symbol, sev: p.severity });
      acc.states.push(p.displayState ?? "active");
      patternAcc.set(p.patternKey, acc);
    }

    // sinceLastWeek: compare current in-force vs anchor in-force
    const currentLean = currentLeanByStock.get(s.stockId)!;
    const priorAnchor = priorAnchorByStock.get(s.stockId);

    // A "new version in window" = a later version was committed after the anchor
    if (priorAnchor && priorAnchor.version < currentLean.version) {
      newVersionCount++;

      const currentBand = s.labelBand as LabelBand;
      const priorBand = priorAnchor.labelBand as LabelBand;
      const currentComp = round2(num(s.composite));
      const priorComp = round2(num(priorAnchor.composite));
      const delta = round2(currentComp - priorComp);

      if (currentBand !== priorBand) {
        bandCrossings.push({
          symbol: s.symbol,
          from: priorBand,
          to: currentBand,
          direction: BAND_RANK[currentBand] > BAND_RANK[priorBand] ? "up" : "down",
        });
      }

      // ⚠ `newFlags` STAYS EMPTY, AND THAT IS THE HONEST ANSWER — not an oversight left behind by
      //   the repoint above. This list is "red flags that APPEARED since the 7-day anchor VERSION",
      //   a rescore-cadence question: it diffed one snapshot version against an earlier one of the
      //   same period. The score channel fires no red flags at all now, so nothing can appear in it.
      //
      //   The filing channel HAS a newly-appeared notion (`readNewlyStandingFilingKeys`, fired +
      //   newly_standing + a strictly-older period on record) — but it is keyed to the FILING period,
      //   which moves quarterly, not to a 7-day rescore window. Substituting it here would change
      //   what the Hub's "N new flags fired" line means while leaving the words identical, which is
      //   worse than the empty list. It is left for whoever gives this line a filing-period cadence.

      if (delta <= DETERIORATION_THRESHOLD) {
        newDeteriorations.push({
          symbol: s.symbol,
          delta,
          fromComposite: priorComp,
          toComposite: currentComp,
          fromBand: priorBand,
          toBand: currentBand,
        });
      }
      if (delta >= RECOVERY_THRESHOLD) {
        newRecoveries.push({
          symbol: s.symbol,
          delta,
          fromComposite: priorComp,
          toComposite: currentComp,
          fromBand: priorBand,
          toBand: currentBand,
        });
      }
    }
  }

  memberViews.sort((a, b) => b.composite - a.composite);
  newDeteriorations.sort((a, b) => a.delta - b.delta);
  newRecoveries.sort((a, b) => b.delta - a.delta);

  // ── Aggregate + drift ─────────────────────────────────────────────────────
  const agg = computeScopeAggregate(scopeMembers);
  const M = scopeMembers.length;

  let priorPeriodKey: string | null = null;
  let priorMedianComposite: number | null = null;
  let medianDrift: number | null = null;

  if (priorByStock.size > 0) {
    const priorList = [...priorByStock.values()];

    // Representative prior-period LABEL = the plurality prior period among live members
    // (ties → newer). Members can span periods, so there is no single prior period.
    const priorCounts = new Map<string, number>();
    for (const r of priorList) priorCounts.set(r.periodKey, (priorCounts.get(r.periodKey) ?? 0) + 1);
    priorPeriodKey =
      [...priorCounts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0][0];

    // Drift = universe median now vs one period back, each stock at ITS OWN prior
    // (second-latest) snapshot — coherent even when members span periods.
    const priorMembers: ScopeMember[] = priorList.map((r) => ({
      stockId: r.stockId,
      symbol: r.symbol,
      composite: num(r.composite),
      labelBand: r.labelBand as LabelBand,
      pillars: {
        foundation: num(r.foundationSubtotal),
        momentum: num(r.momentumSubtotal),
        market: num(r.marketSubtotal),
        ownership: num(r.ownershipSubtotal),
      },
      firesAnyRedFlag: false,
      weight: 1,
    }));

    const priorAgg = computeScopeAggregate(priorMembers);
    priorMedianComposite = priorAgg.medianComposite;
    medianDrift = round2(agg.medianComposite - priorAgg.medianComposite);
  }

  // ── Pathology census ──────────────────────────────────────────────────────
  // The LOUD three-lens patterns (LM3/LM7/LP2/LP5) persist to score_patterns with
  // `lens_*` keys (see lens-findings.ts). Partition them OUT of the P-series/structural
  // pathology into their own lens census — same shape, a distinct family for the board.
  const patternCensus = buildCensus(patternAcc, "pattern", M);
  const lensPathology = patternCensus.filter((p) => p.key.startsWith("lens_"));
  const pathology: PathologyCensusItem[] = [
    ...buildCensus(flagAcc, "red_flag", M),
    ...patternCensus.filter((p) => !p.key.startsWith("lens_")),
  ];

  // ── Movers (from in-memory lean batch) ────────────────────────────────────
  const moverRows: PeerGroupMover[] = [];
  for (const s of fullSnaps) {
    const prior = priorByStock.get(s.stockId);
    if (!prior) continue;
    const currentComp = round2(num(s.composite));
    const priorComp = round2(num(prior.composite));
    const delta = round2(currentComp - priorComp);
    if (delta === 0) continue;
    moverRows.push({
      symbol: s.symbol,
      composite: currentComp,
      priorComposite: priorComp,
      delta,
      fromPeriod: prior.periodKey,
      toPeriod: currentLeanByStock.get(s.stockId)?.periodKey ?? xs.periodKey,
    });
  }
  const risers = moverRows
    .filter((m) => m.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, MOVER_CAP);
  const slippers = moverRows
    .filter((m) => m.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, MOVER_CAP);

  // ── Assemble ──────────────────────────────────────────────────────────────
  const aggregate: UniverseAggregate = {
    scoredCount: agg.scoredCount,
    medianComposite: agg.medianComposite,
    meanComposite: agg.meanComposite,
    priorMedianComposite,
    medianDrift,
    priorPeriodKey,
    dispersion: agg.dispersion,
    range:
      agg.min && agg.max
        ? { min: agg.min, max: agg.max }
        : null,
    composites: agg.composites,
    bandDistribution: agg.bandDistribution as BandDistribution,
    pillarMedians: agg.pillarMedians,
    redFlagMemberCount: agg.redFlagMemberCount,
    descriptor: describeScope(scopeMembers, agg) ?? "",
  };

  const sinceLastWeek: UniverseSinceLastWeek = {
    anchorDate,
    newVersionCount,
    bandCrossings,
    newFlags,
    newDeteriorations,
    newRecoveries,
    honestNote:
      "Snapshots are quarterly + EOD price-driven rescores. The 7-day window compares " +
      "the current in-force version vs the oldest available version within the window " +
      "(falling back from the pre-anchor baseline when the period itself started inside " +
      "the window). Band crossings are almost entirely market-pillar-led.",
  };

  return {
    scored: true,
    periodKey: xs.periodKey,
    asOfDate: ymd(xs.asOfDate),
    scoredUniverseSize: M,
    aggregate,
    members: memberViews,
    notAtCurrentPeriod: xs.lagging,
    pathology,
    lensPathology,
    movers: { risers, slippers },
    sinceLastWeek,
  };
}
