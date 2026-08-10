// File: src/scoring/read/peer-group-view.service.ts
//
// THE peer-group aggregate ASSEMBLERS. Two entry points over ONE primitive
// (scope-aggregate.computeScopeAggregate):
//   • buildPeerGroupList()            → lightweight card per pond (index page)
//   • buildPeerGroupHealthView(pgId)  → the full pond (Health tab)
//
// Reuse, not reinvention: the in-force cross-section is resolved with the SAME
// supersede-aware MAX(version) rule the shared resolver enforces; the trajectory
// marker + movers reuse getSnapshotSeries; the peer μ/σ/N comes from the persisted
// PeerStatsSnapshot with the SAME usable-guard as the stock view. No scoring math is
// recomputed here — this is a pure read over already-committed rows.

import type { DivergenceHeadline } from "./health-view.types.js";
import { prisma } from "../../db/prisma.js";
import { firingDivergenceKeys, headlineOf, pillarSpreadOf } from "./divergence-headline.js";
import { COMPOSITE_MOVE_DEADBAND } from "./display-constants.js";
// The ONE severity ordering (File 1 §5, total over all eight tokens) — see `worseSeverity` below.
import { severityWeight as severityRank } from "../../catalogue/divergence.js";
import { dropRetiredPatterns } from "../../catalogue/retired-findings.js";
// ★ NOT-COVERED SUPPRESSION — same reasoning as universe-view.service.ts (this page reads
//   score_patterns INDEPENDENTLY of it, per the file's own note, so it needs its own guard too).
import { dropNotCoveredPatterns } from "../../catalogue/not-covered.js";
import { GAP_MATERIAL, GAP_STRETCHED } from "../findings/divergence/bands.js";
import { getSnapshotSeries } from "./scoring-read.service.js";
import { getPeerGroupMembers } from "./peer-group-lookup.js";
import {
  computeScopeAggregate,
  describeScope,
  type ScopeMember,
} from "./scope-aggregate.js";
import type {
  PillarKey,
  LabelBand,
  DivergenceFlag,
  TrajectoryMarker,
  MetricBand,
  FlowCategoryState,
} from "./health-view.types.js";
import type {
  PeerGroupListItem,
  PeerGroupHealthView,
  PeerGroupMemberView,
  PathologyCensusItem,
  PathologyReach,
  PeerMetricDistribution,
  PeerMetricMemberPoint,
  PeerGroupFieldLensVerdict,
  PeerGroupMover,
  BandDistribution,
  UnscoredPondMembers,
  UnscoredPondMember,
} from "./peer-group-view.types.js";
// ★ THE FILING CHANNEL — keyed on STOCK, which is what lets a pond say something about the members
//   that have no snapshot. See buildUnscoredMembers.
import { readFilingFindings, readStandingRedFlags } from "../../filing/read.js";
import type { LensRead } from "./health-view.types.js";
// The three-lens separation section — the metric-level lens findings, re-cut by metric.
import { buildLensSeparation, SEPARATION_DOESNT_MEAN, type LensSeparationRow } from "./lens-separation.js";
// ★ THE COMPOSED KEY → FACE TRANSFORM, IMPORTED, NEVER RE-DERIVED. `lens_lm7_CASA` → "LM7" lives in
//   exactly one place (catalogue/lens-faces.ts §1e) and a second regex here is how the partition and
//   the census start disagreeing about what a lens key is.
import { faceIdOfLensKey } from "../../catalogue/lens-faces.js";
// THE shared lens primitive (used verbatim by the stock read — NOT reimplemented here).
import { deriveLensTriplet } from "../lens-patterns/lens-states.js";
import { lensPattern as computeLensPattern } from "../lens-patterns/lens-pattern.js";
import {
  type MetricLensAtom,
  DEFAULT_PEER_MIN_N,
} from "../lens-patterns/types.js";

// ── helpers (mirrors health-view conventions) ───────────────────────────────────
const num = (d: unknown): number =>
  d == null ? 0 : typeof (d as { toNumber?: () => number }).toNumber === "function"
    ? (d as { toNumber: () => number }).toNumber()
    : Number(d);
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const round2 = (x: number): number => Math.round(x * 100) / 100;
/** Nullable Decimal→number coercion (mirrors the stock read's numN): null/undefined
 *  stays null, a Prisma Decimal or number becomes a JS number. */
const numN = (d: unknown): number | null =>
  d == null
    ? null
    : typeof (d as { toNumber?: () => number }).toNumber === "function"
      ? (d as { toNumber: () => number }).toNumber()
      : Number(d);

// ★ PHASE 4 — canonical bands, not a local copy. See health-view.service.ts for the full note.
const DIVERGENCE_NOTABLE = GAP_MATERIAL;
const DIVERGENCE_WIDE = GAP_STRETCHED;
const MOVER_CAP = 10; // top-N each side; honestly capped (ponds are ≤10 today)

// ── SEVERITY ORDERING — imported, not redeclared. See the long note in
//    universe-view.service.ts: the local 4-token map that used to live here omitted the four §5E
//    pattern tones (red · amber · green · recovery), which made `worseSeverity` return whichever
//    argument came first and sorted red patterns below "low" structural cards. The catalogue's
//    `severityWeight` is total over all eight tokens.
const worseSeverity = (a: string | null, b: string | null): string | null =>
  severityRank(a) <= severityRank(b) ? a : b;

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
  if (m > 0 && n / m >= 0.5) return "widespread";
  return "cluster";
}

// Dominant display state across a pattern's firing members: dampened wins (a PG-wide dampening marks
// every member), else pending only when ALL are pending, else active.
// ★ HOISTED TO MODULE SCOPE (step 5) so the unscored-member census uses the SAME reduction as the
//   scored one — two copies of this would be two ways for a pond page to describe the same state.
function dominantState(states: string[]): "active" | "pending_data_integration" | "dampened" {
  return states.some((s) => s === "dampened")
    ? "dampened"
    : states.length > 0 && states.every((s) => s === "pending_data_integration")
      ? "pending_data_integration"
      : "active";
}

// A lean snapshot row used for the in-force reduction.
interface LeanSnap {
  id: string;
  stockId: string;
  symbol: string;
  periodKey: string;
  version: number;
  asOfDate: Date;
}

/** Reduce a pond's raw snapshot rows to the current cross-section:
 *  per (stock, period) keep MAX(version); per stock keep the latest period; then
 *  the pond's current period = the latest asOfDate seen. Members whose latest period
 *  is older are returned separately (lagging) — never folded into the cross-section.
 *
 *  ★ THE EXCLUSION IS THE CORRECTNESS GUARANTEE, and it is what lets the Health tab state its period
 *  once for the whole table. `current` is filtered on an EXACT periodKey match, so the composite, the
 *  ranking, the band mix, the dispersion, the pathology census and every metric distribution are
 *  computed over one quarter — a peer comparison that mixed FY27Q1 with FY26Q4 rows would be
 *  comparing two different things. `lagging` carries the members that fall out, with their own period
 *  and as-of date, so the drop is DISCLOSED rather than silent. */
function resolveCrossSection(rows: LeanSnap[]): {
  periodKey: string;
  asOfDate: Date;
  current: LeanSnap[]; // in-force snapshot per member AT the current period
  lagging: { stockId: string; symbol: string; latestPeriod: string; asOfDate: Date }[];
} | null {
  if (rows.length === 0) return null;

  const inForce = new Map<string, LeanSnap>(); // key stockId|period
  for (const r of rows) {
    const k = `${r.stockId}|${r.periodKey}`;
    const cur = inForce.get(k);
    if (!cur || r.version > cur.version || (r.version === cur.version && r.asOfDate > cur.asOfDate)) {
      inForce.set(k, r);
    }
  }
  const latestPerStock = new Map<string, LeanSnap>();
  for (const r of inForce.values()) {
    const cur = latestPerStock.get(r.stockId);
    if (
      !cur ||
      r.asOfDate > cur.asOfDate ||
      (r.asOfDate.getTime() === cur.asOfDate.getTime() && r.periodKey > cur.periodKey)
    ) {
      latestPerStock.set(r.stockId, r);
    }
  }
  const all = [...latestPerStock.values()];
  const maxAsOf = all.reduce((a, b) => (b.asOfDate > a.asOfDate ? b : a)).asOfDate;
  const periodKey = all.filter((r) => r.asOfDate.getTime() === maxAsOf.getTime())[0].periodKey;
  const current = all.filter((r) => r.periodKey === periodKey);
  const lagging = all
    .filter((r) => r.periodKey !== periodKey)
    .map((r) => ({ stockId: r.stockId, symbol: r.symbol, latestPeriod: r.periodKey, asOfDate: r.asOfDate }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { periodKey, asOfDate: maxAsOf, current, lagging };
}

const toBandDistribution = (b: Record<LabelBand, number>): BandDistribution => b;

// ── LIST ────────────────────────────────────────────────────────────────────────

/**
 * One lightweight aggregate card per peer group. 3 queries total regardless of pond
 * count: peer-groups+sector, all quarterly snapshots (lean), red-flag presence for
 * the resolved cross-section. Unscored ponds return `scored:false` with null stats.
 */
export async function buildPeerGroupList(): Promise<PeerGroupListItem[]> {
  const [pgs, snaps] = await Promise.all([
    prisma.peerGroup.findMany({
      orderBy: [{ sector: { displayName: "asc" } }, { displayName: "asc" }],
      select: {
        id: true,
        name: true,
        displayName: true,
        stockCount: true,
        sector: { select: { name: true, displayName: true } },
      },
    }),
    prisma.scoreSnapshot.findMany({
      where: { snapshotType: "quarterly" },
      select: {
        id: true,
        peerGroupId: true,
        stockId: true,
        symbol: true,
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
    }),
  ]);

  // Bucket snapshots by pond.
  const byPg = new Map<string, typeof snaps>();
  for (const s of snaps) {
    const arr = byPg.get(s.peerGroupId) ?? [];
    arr.push(s);
    byPg.set(s.peerGroupId, arr);
  }

  // Resolve every pond's cross-section, collecting the in-force members so we can ask for red-flag
  // presence in ONE read.
  const resolvedByPg = new Map<
    string,
    { periodKey: string; asOfDate: Date; rows: (typeof snaps) }
  >();
  const crossStockIds: string[] = [];
  for (const pg of pgs) {
    const rows = byPg.get(pg.id) ?? [];
    const xs = resolveCrossSection(rows as LeanSnap[]);
    if (!xs) continue;
    const currentIds = new Set(xs.current.map((r) => r.id));
    const currentRows = rows.filter((r) => currentIds.has(r.id));
    resolvedByPg.set(pg.id, { periodKey: xs.periodKey, asOfDate: xs.asOfDate, rows: currentRows });
    crossStockIds.push(...currentRows.map((r) => r.stockId));
  }

  // ★ REPOINTED 2026-08-11 — was a `redFlag.groupBy` over the cross-section's SNAPSHOT ids. Nothing
  //   has written that table since the filing cutover and none of its surviving rows sit on a
  //   current-period snapshot, so the marker read false for every member of all 23 ponds. The live
  //   channel is keyed on STOCK, so the join key changes from snapshotId to stockId — which is the
  //   only thing that changes. The population is still exactly the resolved cross-section: a pond
  //   member with no snapshot at this period was not in `currentRows` before and is not here now.
  const standingFlags = await readStandingRedFlags(crossStockIds);
  const firesFlag = new Set(
    [...standingFlags.entries()].filter(([, flags]) => flags.length > 0).map(([stockId]) => stockId),
  );

  return pgs.map((pg): PeerGroupListItem => {
    const sector = pg.sector ? { key: pg.sector.name, displayName: pg.sector.displayName } : null;
    const resolved = resolvedByPg.get(pg.id);
    if (!resolved) {
      return {
        id: pg.id,
        name: pg.name,
        displayName: pg.displayName,
        sector,
        memberCount: pg.stockCount,
        scored: false,
        periodKey: null,
        asOfDate: null,
        scoredCount: 0,
        medianComposite: null,
        meanComposite: null,
        bandDistribution: null,
        dispersion: null,
        range: null,
        descriptor: null,
        redFlagMemberCount: 0,
      };
    }
    const members: ScopeMember[] = resolved.rows.map((r) => ({
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
      firesAnyRedFlag: firesFlag.has(r.stockId),
      weight: 1,
    }));
    const agg = computeScopeAggregate(members);
    return {
      id: pg.id,
      name: pg.name,
      displayName: pg.displayName,
      sector,
      memberCount: pg.stockCount,
      scored: true,
      periodKey: resolved.periodKey,
      asOfDate: ymd(resolved.asOfDate),
      scoredCount: agg.scoredCount,
      medianComposite: agg.medianComposite,
      meanComposite: agg.meanComposite,
      bandDistribution: toBandDistribution(agg.bandDistribution),
      dispersion: { stdDev: agg.dispersion.stdDev, iqr: agg.dispersion.iqr },
      range: agg.min && agg.max ? { min: agg.min.composite, max: agg.max.composite } : null,
      descriptor: describeScope(members, agg),
      redFlagMemberCount: agg.redFlagMemberCount,
    };
  });
}

// ── DETAIL ──────────────────────────────────────────────────────────────────────

type FullSnap = Awaited<ReturnType<typeof loadFullCrossSection>>[number];

function loadFullCrossSection(ids: string[]) {
  return prisma.scoreSnapshot.findMany({
    where: { id: { in: ids } },
    include: {
      foundationPillar: { include: { metricScores: { include: { metricBarSet: true } } } },
      momentumPillar: { include: { metricScores: { include: { metricBarSet: true } } } },
      marketPillar: { select: { pillarState: true } },
      ownershipPillar: {
        select: {
          pillarState: true,
          ownershipScore: {
            select: { flowCategories: { select: { category: true, categoryState: true } } },
          },
        },
      },
      // `redFlags` dropped 2026-08-11 with the table — see readStandingRedFlags at the call sites.
      patterns: true,
    },
  });
}

/**
 * ★ THE UNSCORED MEMBERS' OWN SECTION (step 5) — separately denominated, never merged upward.
 *
 * The pond's other aggregates are cross-sections of composites: a member without one cannot enter
 * them without changing what they mean. This block answers the different question those aggregates
 * cannot — "what do we know about the members that have no reading?" — from the filing channel, which
 * is keyed on the stock and therefore resolves for exactly those members.
 *
 * The census here is built from the same `PathologyCensusItem` shape as `pathology`, and carries
 * `outOf = count` (the unscored roster) on every row. The reach thresholds are the pond's own, which
 * is right: reach is a share of a stated denominator, and the denominator is stated.
 */
async function buildUnscoredMembers(
  notScored: { stockId: string; symbol: string; name: string }[],
): Promise<UnscoredPondMembers> {
  if (notScored.length === 0) {
    return { count: 0, covered: 0, members: [], unscoredPathology: [] };
  }
  const filingBy = await readFilingFindings(notScored.map((m) => m.stockId));

  const members: UnscoredPondMember[] = notScored.map((m) => {
    const filing = filingBy.get(m.stockId) ?? null;
    // A section with nothing evaluated is not a section — the stock has filed nothing we hold, and
    // `evaluated: 0` with its own quiet line already says so on the stock page. Here the honest shape
    // is null, so `covered` below can count what we actually have rather than what we returned.
    return { symbol: m.symbol, name: m.name, filing: filing && filing.coverage.evaluated > 0 ? filing : null };
  });

  const acc = new Map<string, { kind: "red_flag" | "pattern"; severity: string | null; members: { symbol: string; sev: string | null }[]; states: string[] }>();
  for (const m of members) {
    for (const f of m.filing?.fired ?? []) {
      // ★ `f.kind` GOES STRAIGHT ONTO THE CENSUS ROW NOW. It used to be translated here —
      //   `f.kind === "red flag" ? "red_flag" : "pattern"` — because the filing channel served a
      //   spelling that existed nowhere behind its own serialisation. Both sides say `red_flag`.
      const e = acc.get(f.key) ?? { kind: f.kind, severity: f.severity, members: [], states: [] };
      e.members.push({ symbol: m.symbol, sev: f.severity });
      e.states.push(f.displayState ?? "active");
      if (severityRank(f.severity) < severityRank(e.severity)) e.severity = f.severity;
      acc.set(f.key, e);
    }
  }
  const M = notScored.length;
  const unscoredPathology: PathologyCensusItem[] = [...acc.entries()]
    .map(([key, v]): PathologyCensusItem => ({
      kind: v.kind,
      key,
      severity: v.severity,
      memberCount: v.members.length,
      outOf: M,
      members: v.members
        .sort((a, b) => severityRank(a.sev) - severityRank(b.sev) || a.symbol.localeCompare(b.symbol))
        .map((x) => x.symbol),
      reach: reachOf(v.members.length, M),
      displayState: dominantState(v.states),
    }))
    .sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === "red_flag" ? -1 : 1) ||
        severityRank(a.severity) - severityRank(b.severity) ||
        b.memberCount - a.memberCount ||
        a.key.localeCompare(b.key),
    );

  return { count: M, covered: members.filter((m) => m.filing !== null).length, members, unscoredPathology };
}

/**
 * The full aggregate for one pond. Returns null only when the peer group id is
 * unknown (controller → 404). An existing-but-unscored pond returns a `scored:false`
 * shell (identity populated, every snapshot section null/empty).
 */
export async function buildPeerGroupHealthView(
  pgId: string,
): Promise<PeerGroupHealthView | null> {
  const pg = await prisma.peerGroup.findUnique({
    where: { id: pgId },
    select: {
      id: true,
      name: true,
      displayName: true,
      stockCount: true,
      sector: { select: { name: true, displayName: true, sectorClass: true } },
    },
  });
  if (!pg) return null;

  const sector = pg.sector ? { key: pg.sector.name, displayName: pg.sector.displayName } : null;
  const baseIdentity = {
    id: pg.id,
    name: pg.name,
    displayName: pg.displayName,
    sector,
    sectorClass: pg.sector?.sectorClass ?? null,
    memberCount: pg.stockCount,
  };

  // ★ THE ROSTER IS READ ALONGSIDE THE SNAPSHOTS, so "has no reading at all" can be a state rather
  //   than an inference from `scoredCount < memberCount` — which conflates it with "has an older
  //   reading". `getPeerGroupMembers` is the existing named read; nothing new is queried twice.
  const [leanRows, roster] = await Promise.all([
    prisma.scoreSnapshot.findMany({
      where: { peerGroupId: pgId, snapshotType: "quarterly" },
      select: { id: true, stockId: true, symbol: true, periodKey: true, version: true, asOfDate: true },
    }),
    getPeerGroupMembers(pgId),
  ]);
  const xs = resolveCrossSection(leanRows);

  const snapshottedIds = new Set(leanRows.map((r) => r.stockId));
  const notScoredRoster = roster
    .filter((m) => !snapshottedIds.has(m.stockId))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const rosterNotScored = notScoredRoster.map((m) => ({ symbol: m.symbol, name: m.name }));

  // ★ THE UNSCORED HALF OF THE POND (step 5). One indexed read over stock_findings for the members
  //   that have no snapshot — rooted at STOCK, which is the whole reason it can resolve for them at
  //   all. Skipped entirely when the roster is fully scored, which is the case on 13 of the 23 ponds.
  const unscoredMembers = await buildUnscoredMembers(notScoredRoster);

  // ── unscored pond shell ──
  if (!xs) {
    return {
      scored: false,
      identity: { ...baseIdentity, industryPath: null, periodKey: null, asOfDate: null },
      aggregate: null,
      members: [],
      notAtCurrentPeriod: [],
      // Every roster member is unscored here by construction — the pond has no snapshots at all.
      rosterNotScored,
      // ★ AND THIS IS THE BRANCH WHERE IT MATTERS MOST. All ten unscored ponds land here, and until
      //   now this shell was the entire page for them: a name, a member count, and a list of tickers.
      unscoredMembers,
      pathology: [],
      // ⚠ NOT the empty-state sentence. An unscored pond has no readings at all, so "no metric
      //   separates this group" would be a finding we have not earned; `buildLensSeparation([], 0)`
      //   would compose exactly that. The shape is present with no blocks and no sentence, and the
      //   detail page never renders this branch's tab body anyway.
      lensSeparation: { blocks: [], emptySentence: null, doesntMean: SEPARATION_DOESNT_MEAN },
      metricDistributions: [],
      movers: { risers: [], slippers: [] },
    };
  }

  const crossIds = xs.current.map((r) => r.id);
  const stockIds = xs.current.map((r) => r.stockId);

  const [fullSnaps, stocks, peerStatsRows, memberStandingFlags] = await Promise.all([
    loadFullCrossSection(crossIds),
    prisma.stock.findMany({
      // The lagging members' ids ride along so the older-reading disclosure can name a COMPANY and
      // not only a ticker — one read, not a second one for four rows.
      where: { id: { in: [...stockIds, ...xs.lagging.map((l) => l.stockId)] } },
      select: { id: true, name: true, industryType: true },
    }),
    prisma.peerStatsSnapshot.findMany({
      where: { peerGroupId: pgId, asOfDate: xs.asOfDate },
      select: { metricKey: true, mean: true, stdDev: true, sampleN: true },
    }),
    // ★ The live red-flag channel for the SCORED cross-section only — `stockIds` is `xs.current`,
    //   the same members whose rows this view builds. The pond's unscored members are served
    //   separately by `buildUnscoredMembers` (which has always read the filing channel directly),
    //   so this does not reach them and the two populations stay exactly as they were.
    readStandingRedFlags(stockIds),
  ]);

  const nameById = new Map(stocks.map((s) => [s.id, s.name]));
  const peerByMetric = new Map(
    peerStatsRows.map((r) => [r.metricKey, { mean: num(r.mean), stdDev: num(r.stdDev), sampleN: r.sampleN }]),
  );

  // industryPath — uniform across a pond normally; "mixed" if it spans both.
  const industrySet = new Set(fullSnaps.map((s) => (s.industryPath === "banking" ? "banking" : "non_financial")));
  const industryPath: PeerGroupHealthView["identity"]["industryPath"] =
    industrySet.size === 1 ? ([...industrySet][0] as "banking" | "non_financial") : "mixed";

  // ── member views + ScopeMembers + pathology accumulation ──
  const scopeMembers: ScopeMember[] = [];
  const memberViews: PeerGroupMemberView[] = [];

  // pathology census accumulators
  type Acc = { severity: string | null; members: { symbol: string; sev: string | null }[]; states: string[] };
  const flagAcc = new Map<string, Acc>();
  const patternAcc = new Map<string, Acc>();

  // trajectory series per member (also powers movers) — reuse the shared resolver.
  const series2 = await Promise.all(
    fullSnaps.map((s) => getSnapshotSeries(s.stockId, 2).then((pts) => [s.stockId, pts] as const)),
  );
  const seriesByStock = new Map(series2);

  for (const s of fullSnaps) {
    const pillars: Record<PillarKey, number> = {
      foundation: num(s.foundationSubtotal),
      momentum: num(s.momentumSubtotal),
      market: num(s.marketSubtotal),
      ownership: num(s.ownershipSubtotal),
    };
    const scoredSubs: { pillar: PillarKey; subtotal: number }[] = [];
    if (s.foundationPillar.pillarState === "scored") scoredSubs.push({ pillar: "foundation", subtotal: pillars.foundation });
    if (s.momentumPillar.pillarState === "scored") scoredSubs.push({ pillar: "momentum", subtotal: pillars.momentum });
    if (s.marketPillar.pillarState === "scored") scoredSubs.push({ pillar: "market", subtotal: pillars.market });
    if (s.ownershipPillar.pillarState === "scored") scoredSubs.push({ pillar: "ownership", subtotal: pillars.ownership });

    // ★ RETIREMENT SUPPRESSION (boundary 9 of 9 — the peer-group pathology census). This service
    //   reads score_patterns INDEPENDENTLY of universe-view, so it needs its own filter: without it
    //   a retired key would be counted as a live pathology across the PG's members ("fires on 4 of
    //   8 peers") while the same key was suppressed everywhere else.
    //   ★ The FLAG half is repointed (2026-08-11) to the live channel and needs no such filter — a
    //     retired rule is unregistered, so it cannot write a stock_findings row at all.
    const firedFlags = (memberStandingFlags.get(s.stockId) ?? [])
      .map((rf) => ({ flagKey: rf.ruleKey, severity: rf.severity, tier: "auto" as const }))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    const firedPatterns = dropNotCoveredPatterns(dropRetiredPatterns(s.patterns))
      .map((p) => ({ patternKey: p.patternKey, direction: p.direction, severity: p.severity, displayState: (p.displayState ?? "active") as "active" | "pending_data_integration" | "dampened" }))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

    // trajectory marker from the member's last-2 in-force composites
    const pts = seriesByStock.get(s.stockId) ?? [];
    let trajectoryMarker: TrajectoryMarker | null = null;
    let trajectoryDelta: number | null = null;
    if (pts.length >= 2) {
      const d = round2(pts[pts.length - 1].composite - pts[pts.length - 2].composite);
      trajectoryDelta = d;
      trajectoryMarker = d > COMPOSITE_MOVE_DEADBAND ? "improving" : d < -COMPOSITE_MOVE_DEADBAND ? "deteriorating" : "stable";
    }

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
      // ★ THE ROW'S OWN QUARTER AND AS-OF. Equal across the cross-section by construction (see
      //   `resolveCrossSection`), which is what lets the table state it once — but stated per row so
      //   the renderer measures the uniformity instead of assuming it.
      periodKey: s.periodKey,
      asOfDate: ymd(s.asOfDate),
      composite: round2(num(s.composite)),
      labelBand: s.labelBand as LabelBand,
      pillars,
      trajectoryMarker,
      trajectoryDelta,
      divergence: divergenceOf(scoredSubs, firedPatterns),
      firedFlags,
      firedPatterns,
      flowCategoryStates,
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

    // accumulate pathology. ★ Same live set as `firedFlags` above (2026-08-11) — the pond's census,
    //   its member marker and the member's own fired list are three views of one array.
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
  }

  memberViews.sort((a, b) => b.composite - a.composite);

  const agg = computeScopeAggregate(scopeMembers);
  const M = scopeMembers.length;

  // ── pathology census ──
  const buildCensus = (acc: Map<string, Acc>, kind: "red_flag" | "pattern"): PathologyCensusItem[] =>
    [...acc.entries()]
      .map(([key, v]): PathologyCensusItem => {
        const members = v.members
          .sort((a, b) => severityRank(a.sev) - severityRank(b.sev) || a.symbol.localeCompare(b.symbol))
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
  const fullCensus = [...buildCensus(flagAcc, "red_flag"), ...buildCensus(patternAcc, "pattern")];

  // ── metric distributions + per-member lens projection + field-verdict rollup ──
  const { distributions: metricDistributions, fieldLensVerdicts } =
    buildMetricDistributions(fullSnaps, peerByMetric);

  // ── ★ THE LENS PARTITION ────────────────────────────────────────────────────
  //
  // METRIC-level lens rows (`lens_lm*_<metricKey>`) leave the census for `lensSeparation`, where the
  // same members are grouped by the metric instead of by the finding. They are not in both places:
  // the block says everything the row said and more, so keeping both printed one fact twice.
  //
  // PILLAR-level lens rows (`lens_lp*_<pillar>`) STAY. They name no metric, so no block can head
  // them, and removing them to make the family tidy would delete findings the page shows today
  // (three LP2 and one LP5 across the scored ponds) with nothing taking their place.
  //
  // ⚠ THE PILLAR COMES FROM THE DISTRIBUTIONS, NOT FROM THE CENSUS ROW. `score_patterns` carries no
  //   pillar column, and the composed key's suffix is the metric code alone — so the join is
  //   metricKey → the bucket the distribution builder already keyed by pillar. Total by construction:
  //   a lens finding can only fire on a metric that HAS a scored row, which is exactly the set
  //   `buildMetricDistributions` buckets. A key that somehow missed it is dropped from the section
  //   rather than served under a guessed pillar, and stays visible in the census.
  const pillarOfMetric = new Map(metricDistributions.map((d) => [d.metricKey, d.pillar]));
  const lensRows: LensSeparationRow[] = [];
  const pathology: PathologyCensusItem[] = [];
  for (const item of fullCensus) {
    const face = faceIdOfLensKey(item.key);
    if (!face || !face.startsWith("LM")) {
      pathology.push(item);
      continue;
    }
    const metricKey = item.key.slice(`lens_${face.toLowerCase()}_`.length);
    const pillar = pillarOfMetric.get(metricKey);
    if (!pillar) {
      pathology.push(item);
      continue;
    }
    lensRows.push({ face, metricKey, pillar, members: item.members });
  }
  const lensSeparation = buildLensSeparation(lensRows, M);

  // ── movers (risers/slippers) where ≥2 periods exist ──
  const moverRows: PeerGroupMover[] = [];
  for (const s of fullSnaps) {
    const pts = seriesByStock.get(s.stockId) ?? [];
    if (pts.length < 2) continue;
    const prior = pts[pts.length - 2];
    const last = pts[pts.length - 1];
    const delta = round2(last.composite - prior.composite);
    if (delta === 0) continue;
    moverRows.push({
      symbol: s.symbol,
      composite: round2(last.composite),
      priorComposite: round2(prior.composite),
      delta,
      fromPeriod: prior.periodKey,
      toPeriod: last.periodKey,
    });
  }
  const risers = moverRows.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, MOVER_CAP);
  const slippers = moverRows.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, MOVER_CAP);

  // ── pond drift: the SAME aggregate one period back ──────────────────────────
  // Reuse each current member's prior in-force snapshot (series[len-2], supersede-
  // aware, point-in-time). The pond's prior period = the immediate-prior period
  // (latest periodKey among those prior points); members whose prior in-force
  // snapshot is older than that (a filing gap) are excluded — never carried forward.
  let priorMedianComposite: number | null = null;
  let medianDrift: number | null = null;
  let priorPeriodKey: string | null = null;
  const priorPoints = fullSnaps
    .map((s) => {
      const pts = seriesByStock.get(s.stockId) ?? [];
      return pts.length >= 2 ? { stockId: s.stockId, symbol: s.symbol, p: pts[pts.length - 2] } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (priorPoints.length > 0) {
    priorPeriodKey = priorPoints.map((x) => x.p.periodKey).reduce((a, b) => (b > a ? b : a));
    const priorMembers: ScopeMember[] = priorPoints
      .filter((x) => x.p.periodKey === priorPeriodKey)
      .map((x) => ({
        stockId: x.stockId,
        symbol: x.symbol,
        composite: x.p.composite,
        labelBand: x.p.labelBand as LabelBand,
        pillars: {
          foundation: x.p.foundationSubtotal,
          momentum: x.p.momentumSubtotal,
          market: x.p.marketSubtotal,
          ownership: x.p.ownershipSubtotal,
        },
        firesAnyRedFlag: false, // not used for the median; drift only needs composites
        weight: 1,
      }));
    const priorAgg = computeScopeAggregate(priorMembers);
    priorMedianComposite = priorAgg.medianComposite;
    medianDrift = round2(agg.medianComposite - priorAgg.medianComposite);
  }

  return {
    scored: true,
    identity: { ...baseIdentity, industryPath, periodKey: xs.periodKey, asOfDate: ymd(xs.asOfDate) },
    aggregate: {
      scoredCount: agg.scoredCount,
      medianComposite: agg.medianComposite,
      meanComposite: agg.meanComposite,
      priorMedianComposite,
      medianDrift,
      priorPeriodKey,
      dispersion: agg.dispersion,
      range: agg.min && agg.max ? { min: agg.min, max: agg.max } : null,
      composites: agg.composites,
      bandDistribution: toBandDistribution(agg.bandDistribution),
      pillarMedians: agg.pillarMedians,
      redFlagMemberCount: agg.redFlagMemberCount,
      descriptor: describeScope(scopeMembers, agg) ?? "",
      fieldLensVerdicts,
    },
    members: memberViews,
    notAtCurrentPeriod: xs.lagging.map((l) => ({
      symbol: l.symbol,
      name: nameById.get(l.stockId) ?? l.symbol,
      latestPeriod: l.latestPeriod,
      asOfDate: ymd(l.asOfDate),
    })),
    rosterNotScored,
    unscoredMembers,
    pathology,
    lensSeparation,
    metricDistributions,
    movers: { risers, slippers },
  };
}

// ── Three-lens projection helpers (PG variant — reuse the stock read's pattern) ────

/** One loaded metricScore row off the PG full cross-section. */
type LoadedPgMetricScore = FullSnap["foundationPillar"]["metricScores"][number];

/** Build the MetricLensAtom from a PG-loaded row + the metric's field μ/σ/N. IDENTICAL
 *  field-for-field to the stock read's toAtom — same persisted columns, same peer source
 *  shape (the PG's score_peer_stats μ/σ/N is exactly the cross-section L2 compares to). */
function pgToAtom(
  ms: LoadedPgMetricScore,
  pillar: "foundation" | "momentum",
  peer: { mean: number; stdDev: number; sampleN: number } | null,
): MetricLensAtom {
  return {
    metricKey: ms.metricKey,
    pillar,
    scored: ms.scoreState === "scored",
    rawValue: num(ms.rawValue),
    l1Available: ms.l1Available,
    l1Band: (ms.l1Band as MetricLensAtom["l1Band"]) ?? null,
    l2Available: ms.l2Available,
    l2Score: numN(ms.l2Score),
    l2AnchorApplied: numN(ms.l2AnchorApplied),
    peerMean: peer ? peer.mean : null,
    peerStdDev: peer ? peer.stdDev : null,
    peerSampleN: peer ? peer.sampleN : null,
    l3Available: ms.l3Available,
    l3Score: numN(ms.l3Score),
    l3AnchorApplied: numN(ms.l3AnchorApplied),
    l3Mean: numN(ms.l3Mean),
    l3StdDev: numN(ms.l3StdDev),
    l3WindowN: ms.l3WindowN ?? null,
  };
}

/** Three LensRead views from a derived triplet + atom — mirrors the stock read's
 *  toLensReads, minus the L3 sparkline series (the PG read carries no per-metric history). */
function pgToLensReads(
  atom: MetricLensAtom,
  acceptableBar: number | null,
): { l1: LensRead; l2: LensRead; l3: LensRead } {
  const triplet = deriveLensTriplet(atom);
  const l1: LensRead = {
    state: triplet.l1,
    evaluable: triplet.l1 !== "not_evaluable",
    referenceValue: acceptableBar,
    reason: triplet.l1 === "not_evaluable" ? (atom.l1Available ? "no_bar" : "l1_unavailable") : null,
  };
  const l2Reason = (): string | null => {
    if (triplet.l2 !== "not_evaluable") return null;
    if (!atom.l2Available) return "l2_unavailable";
    if (atom.peerSampleN === null || atom.peerMean === null) return "no_peer_stats";
    if (atom.peerSampleN < DEFAULT_PEER_MIN_N) return "insufficient_peers";
    if (atom.peerStdDev === 0) return "std_dev_zero";
    return "l2_unavailable";
  };
  const l2: LensRead = {
    state: triplet.l2,
    evaluable: triplet.l2 !== "not_evaluable",
    referenceValue: atom.peerMean,
    reason: l2Reason(),
  };
  const l3Reason = (): string | null => {
    if (triplet.l3 !== "not_evaluable") return null;
    if (!atom.l3Available) return "building_history";
    if (atom.l3Mean === null || atom.l3StdDev === null) return "no_history_stats";
    return "l3_unavailable";
  };
  const l3: LensRead = {
    state: triplet.l3,
    evaluable: triplet.l3 !== "not_evaluable",
    referenceValue: atom.l3Mean,
    reason: l3Reason(),
  };
  return { l1, l2, l3 };
}

/** Field-verdict from WHERE THE FIELD'S L1 BANDS CLUSTER (not from clearing the passing
 *  bar). highShare = share of usable members in excellent|good; lowShare = share in
 *  concerning|distress; acceptable is neutral. A plain MAJORITY (>0.50) of either side
 *  decides; everything else (mostly-acceptable OR polarized/split) is mixed. 0.50 is a
 *  bare majority, not a tunable constant. */
function bandClusterVerdict(highShare: number, lowShare: number): "PG_STRONG" | "PG_WEAK" | "mixed" {
  if (highShare > 0.5) return "PG_STRONG";
  if (lowShare > 0.5) return "PG_WEAK";
  return "mixed";
}

/** Group the foundation+momentum metric scores across all members by metricKey,
 *  attaching the data-derived bars (from any member's MetricBarSet) and the persisted
 *  peer μ/σ/N with the usable-guard. ALSO projects the per-member three-lens reads +
 *  named LM pattern (Piece 1) and the per-metric field-verdict rollup (Piece 2), both
 *  via the SAME shared lens primitive the stock read calls — nothing recomputed. */
function buildMetricDistributions(
  fullSnaps: FullSnap[],
  peerByMetric: Map<string, { mean: number; stdDev: number; sampleN: number }>,
): { distributions: PeerMetricDistribution[]; fieldLensVerdicts: PeerGroupFieldLensVerdict[] } {
  type Bucket = {
    pillar: "foundation" | "momentum";
    direction: string | null;
    bars: PeerMetricDistribution["bars"];
    /** Acceptable L1 cut (referenceValue for the per-member L1 read). */
    acceptableBar: number | null;
    members: PeerMetricMemberPoint[];
    /** Rollup accumulators: usable = scored + L1 evaluable (bar present). clearing = above
     *  the passing bar (supporting evidence only). bandHigh / bandLow = where the field's
     *  L1 bands CLUSTER (excellent|good / concerning|distress) — the verdict driver;
     *  acceptable is neutral (counts toward neither). */
    usable: number;
    clearing: number;
    bandHigh: number;
    bandLow: number;
  };
  const buckets = new Map<string, Bucket>();

  const ingest = (
    symbol: string,
    pillar: "foundation" | "momentum",
    scores: FullSnap["foundationPillar"]["metricScores"],
  ) => {
    for (const ms of scores) {
      const b: Bucket = buckets.get(ms.metricKey) ?? {
        pillar,
        direction: ms.metricBarSet?.direction ?? null,
        bars: ms.metricBarSet
          ? {
              excellent: num(ms.metricBarSet.excellent),
              good: num(ms.metricBarSet.good),
              acceptable: num(ms.metricBarSet.acceptable),
              concerning: num(ms.metricBarSet.concerning),
              distress: num(ms.metricBarSet.distress),
            }
          : null,
        acceptableBar: ms.metricBarSet ? num(ms.metricBarSet.acceptable) : null,
        members: [],
        usable: 0,
        clearing: 0,
        bandHigh: 0,
        bandLow: 0,
      };
      // fill bars/direction/acceptableBar if a later member carries a bar set the first lacked
      if (!b.bars && ms.metricBarSet) {
        b.direction = ms.metricBarSet.direction;
        b.bars = {
          excellent: num(ms.metricBarSet.excellent),
          good: num(ms.metricBarSet.good),
          acceptable: num(ms.metricBarSet.acceptable),
          concerning: num(ms.metricBarSet.concerning),
          distress: num(ms.metricBarSet.distress),
        };
        b.acceptableBar = num(ms.metricBarSet.acceptable);
      }

      // Per-member three-lens projection (Piece 1) — scored metrics only; non-scored
      // cells stay raw+band+state (lens/lensPattern undefined = honest-empty).
      const point: PeerMetricMemberPoint = {
        symbol,
        rawValue: num(ms.rawValue),
        l1Band: (ms.l1Band as MetricBand | null) ?? null,
        scoreState: ms.scoreState,
      };
      if (ms.scoreState === "scored") {
        const peer = peerByMetric.get(ms.metricKey) ?? null;
        const atom = pgToAtom(ms, pillar, peer);
        const triplet = deriveLensTriplet(atom);
        const acceptableBar = ms.metricBarSet ? num(ms.metricBarSet.acceptable) : null;
        point.lens = pgToLensReads(atom, acceptableBar);
        // LM pattern via the shared primitive. LM8's anti-mask opt is omitted (no
        // pillar-subtotal context here) → the below·below·flat cell honest-empties to
        // null rather than fabricating LM8, exactly as the primitive specifies.
        const fired = computeLensPattern(triplet.l1, triplet.l2, triplet.l3);
        point.lensPattern = fired
          ? { id: fired.id, label: fired.label, tone: fired.tone, fieldVerdict: fired.fieldVerdict }
          : null;
        // Field-verdict rollup accumulation (Piece 2): a member is USABLE when its L1 is
        // evaluable (scored + bar present). The verdict is driven by WHERE THE BANDS
        // CLUSTER (bandHigh = excellent|good, bandLow = concerning|distress; acceptable is
        // neutral). clearing (above the passing bar) is kept as supporting evidence only.
        if (triplet.l1 !== "not_evaluable") {
          b.usable += 1;
          if (triplet.l1 === "above_bar") b.clearing += 1;
          const band = atom.l1Band;
          if (band === "excellent" || band === "good") b.bandHigh += 1;
          else if (band === "concerning" || band === "distress") b.bandLow += 1;
        }
      }
      b.members.push(point);
      buckets.set(ms.metricKey, b);
    }
  };

  for (const s of fullSnaps) {
    ingest(s.symbol, "foundation", s.foundationPillar.metricScores);
    ingest(s.symbol, "momentum", s.momentumPillar.metricScores);
  }

  const distributions = [...buckets.entries()]
    .map(([metricKey, b]): PeerMetricDistribution => {
      const ps = peerByMetric.get(metricKey) ?? null;
      return {
        metricKey,
        pillar: b.pillar,
        direction: b.direction as PeerMetricDistribution["direction"],
        bars: b.bars,
        peer: ps
          ? { mean: ps.mean, stdDev: ps.stdDev, sampleN: ps.sampleN, usable: ps.sampleN >= 5 && ps.stdDev > 0 }
          : null,
        members: b.members.sort((a, b2) => a.symbol.localeCompare(b2.symbol)),
      };
    })
    .sort((a, b) => a.pillar.localeCompare(b.pillar) || a.metricKey.localeCompare(b.metricKey));

  // Piece 2 — one field-verdict row per scored foundation/momentum metric. HONEST-EMPTY:
  // <5 usable members → verdict/share/magnitude null (row still emitted with usableMembers).
  const fieldLensVerdicts = [...buckets.entries()]
    .map(([metricKey, b]): PeerGroupFieldLensVerdict => {
      if (b.usable < DEFAULT_PEER_MIN_N) {
        return {
          metricKey,
          pillar: b.pillar,
          label: metricKey,
          verdict: null,
          shareClearingBar: null,
          usableMembers: b.usable,
          magnitude: null,
        };
      }
      // Verdict driver: where the bands cluster. magnitude = net lean |highShare−lowShare|.
      const highShare = b.bandHigh / b.usable;
      const lowShare = b.bandLow / b.usable;
      const magnitude = Math.min(1, Math.max(0, Math.abs(highShare - lowShare)));
      // shareClearingBar stays as SUPPORTING EVIDENCE (the "7 of 8 clear the bar" figure) —
      // it no longer decides the verdict.
      const shareClearingBar = b.clearing / b.usable;
      return {
        metricKey,
        pillar: b.pillar,
        label: metricKey,
        verdict: bandClusterVerdict(highShare, lowShare),
        shareClearingBar,
        usableMembers: b.usable,
        magnitude,
      };
    })
    .sort((a, b) => a.pillar.localeCompare(b.pillar) || a.metricKey.localeCompare(b.metricKey));

  return { distributions, fieldLensVerdicts };
}
