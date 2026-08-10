// File: src/scoring/read/peer-group-view.types.ts
//
// THE CANONICAL peer-group aggregate read-models. Two shapes:
//   • PeerGroupListItem[]   ← GET /api/peer-groups            (the index page)
//   • PeerGroupHealthView   ← GET /api/peer-groups/:id/health (the Health tab)
//
// Mirror these verbatim into the frontend types. SAME conventions as
// HealthSnapshotView: every number is a JS number; a field with no backing data is
// `null` with the key PRESENT — never omitted, never fabricated. The descriptor is
// templated from real numbers (see scope-aggregate.describeScope).

import type { DivergenceHeadline } from "./health-view.types.js";
import type {
  LabelBand,
  PillarKey,
  MetricBand,
  BarDirection,
  SectorClass,
  TrajectoryMarker,
  DivergenceFlag,
  FlowCategoryState,
  LensRead,
} from "./health-view.types.js";
import type { ScopeDispersion } from "./scope-aggregate.js";
// ★ RUNTIME-FREE BY DESIGN — the filing view shapes live in their own module precisely so a wire
//   contract can import them without acquiring the Prisma client. See filing/read.types.ts.
import type { FilingFindingsSection } from "../../filing/read.types.js";

export type BandDistribution = Record<LabelBand, number>;

export interface SectorRef {
  key: string;
  displayName: string;
}

// ── LIST ─────────────────────────────────────────────────────────────────────

/** One lightweight card on the index page. When `scored` is false the pond has no
 *  in-force snapshots — every aggregate field is null (10 of 23 ponds today). */
export interface PeerGroupListItem {
  id: string;
  name: string;
  displayName: string;
  /** Parent sector (PeerGroup.sectorId) — for grouping cards under sector headers
   *  (banks: Private + PSU both under "Banks"). null only if the link is missing. */
  sector: SectorRef | null;
  /** Roster size (PeerGroup.stockCount). */
  memberCount: number;
  scored: boolean;
  periodKey: string | null;
  asOfDate: string | null; // YYYY-MM-DD
  /** Members folded into the aggregate (scored at the period; may be < memberCount). */
  scoredCount: number;
  medianComposite: number | null;
  meanComposite: number | null;
  bandDistribution: BandDistribution | null;
  dispersion: { stdDev: number; iqr: number } | null;
  range: { min: number; max: number } | null;
  /** Templated from median band + dispersion (e.g. "healthy, tight"). null when unscored. */
  descriptor: string | null;
  /** Members currently firing ≥1 red flag — the attention indicator. */
  redFlagMemberCount: number;
}

// ── DETAIL ───────────────────────────────────────────────────────────────────

export interface PeerGroupIdentity {
  id: string;
  name: string;
  displayName: string;
  sector: SectorRef | null;
  /** Sector archetype (Sector.sectorClass) — null when unset. */
  sectorClass: SectorClass;
  /** "banking" | "non_financial" from members' snapshots; "mixed" if a pond spans both. */
  industryPath: "banking" | "non_financial" | "mixed" | null;
  memberCount: number; // roster
  periodKey: string | null;
  asOfDate: string | null;
}

/** One metric's FIELD-VERDICT rollup across the pond (Piece 2). L1-share based: the
 *  fraction of usable members (scored + bar present) clearing their own L1 acceptable
 *  bar. HONEST-EMPTY: a verdict requires ≥5 usable members (DEFAULT_PEER_MIN_N) — under
 *  that, verdict/shareClearingBar/magnitude are all null but the row is still emitted
 *  (with usableMembers) so the UI can say "field not assessable, only N members". The
 *  ≥0.70 PG_STRONG / <0.40 PG_WEAK cuts reuse PILLAR_STRONG_SHARE / PILLAR_WEAK_SHARE
 *  from the lens-pattern catalog (NOT new literals). DESCRIPTIVE only — strong/weak/mixed
 *  is a statement about the field as it IS, never a prediction. */
export interface PeerGroupFieldLensVerdict {
  metricKey: string;
  pillar: "foundation" | "momentum";
  /** Display label. Carries the metricKey (the same identifier the distributions expose);
   *  the frontend resolves the human label via getMetricLabel(metricKey), exactly as it
   *  already does for metricDistributions — the read layer has no display-label catalog. */
  label: string;
  verdict: "PG_STRONG" | "PG_WEAK" | "mixed" | null;
  /** 0..1 share of usable members above their L1 bar. null when verdict is null. */
  shareClearingBar: number | null;
  /** Count of scored-AND-bar-present members on this metric (the verdict denominator). */
  usableMembers: number;
  /** 0..1 decisiveness = |shareClearingBar − 0.5| * 2, clamped. null when verdict null. */
  magnitude: number | null;
}

export interface PeerGroupAggregate {
  scoredCount: number;
  medianComposite: number;
  meanComposite: number;
  /** Median composite of the SAME members one period back. null when no prior
   *  period exists (pond at its earliest scored quarter). */
  priorMedianComposite: number | null;
  /** medianComposite − priorMedianComposite. null when prior is null. */
  medianDrift: number | null;
  /** The immediate-prior periodKey the drift is measured against. null when absent. */
  priorPeriodKey: string | null;
  dispersion: ScopeDispersion;
  range: {
    min: { symbol: string; composite: number };
    max: { symbol: string; composite: number };
  } | null;
  /** Raw composites ASCENDING — the distribution strip substrate. */
  composites: number[];
  bandDistribution: BandDistribution;
  pillarMedians: Record<PillarKey, number>;
  redFlagMemberCount: number;
  descriptor: string;
  /** Piece 2 — per-metric field-verdict rollup (foundation+momentum metrics the pond
   *  scores), L1-share based with the ≥5-usable honest-empty rule. Additive; absent
   *  (undefined) on legacy payloads. One row per scored foundation/momentum metric. */
  fieldLensVerdicts?: PeerGroupFieldLensVerdict[];
}

export interface FiredFlag {
  flagKey: string;
  severity: string | null;
  tier: "auto" | "review";
}
export interface FiredPattern {
  patternKey: string;
  direction: string | null;
  severity: string | null;
  /** File 1 §5E display state; defaults "active". */
  displayState?: "active" | "pending_data_integration" | "dampened";
}

export interface PeerGroupMemberView {
  symbol: string;
  name: string;
  /**
   * ★ WHICH QUARTER THIS ROW IS OF — the member's OWN in-force snapshot period ("FY27Q1").
   *
   * ── WHY A PER-MEMBER FIELD WHEN THE CROSS-SECTION IS SINGLE-PERIOD ─────────────────────────────
   * `resolveCrossSection` filters `members` to ONE periodKey, so every row here carries the same
   * value today and the table can say it once instead of on every row. That is the whole reason the
   * field exists as DATA rather than as a caption: the collapse is then a MEASUREMENT the renderer
   * makes ("are these all equal?"), not an assumption it inherits. A reader looking at a peer
   * comparison is entitled to know the two rows are of the same quarter, and nothing on this page
   * said so before — `identity.periodKey` was on the payload and rendered nowhere.
   */
  periodKey: string;
  /** The day that snapshot was written, YYYY-MM-DD. "Scored 7 August 2026" — the as-of, per member,
   *  so a rescore that lands mid-season is dateable at the row rather than only for the pond. */
  asOfDate: string;
  composite: number;
  labelBand: LabelBand;
  /** Four pillar subtotals. */
  pillars: Record<PillarKey, number>;
  /** From the member's own in-force series (last two composites); null when <2 periods. */
  trajectoryMarker: TrajectoryMarker | null;
  trajectoryDelta: number | null;
  /** Spread across the member's SCORED pillars (same rule as the stock view). */
  /** ★ Ruling 3's state + S1's spread. Was `{flag, gap}` off the widest scored pair. */
  divergence: { headline: DivergenceHeadline; spread: number | null };
  firedFlags: FiredFlag[];
  firedPatterns: FiredPattern[];
  /** C/D ownership flow-category state — read-projection of score_ownership_flows.category_state.
   *  undefined when the stock has no shareholding data (own=null in the scoring pass). */
  flowCategoryStates?: { C_insider: FlowCategoryState; D_block: FlowCategoryState };
}

/** How widely a flag/pattern is shared across the pond — the clustering read. */
export type PathologyReach = "isolated" | "cluster" | "widespread";

export interface PathologyCensusItem {
  kind: "red_flag" | "pattern";
  key: string;
  /** Worst severity seen across firing members. */
  severity: string | null;
  memberCount: number; // N firing
  outOf: number; // M scored at period
  members: string[]; // symbols firing, worst-first then alpha
  /** isolated (N=1) | widespread (N/M ≥ 0.5) | cluster (between). */
  reach: PathologyReach;
  /** Dominant display state across firing members (File 1 §5E). A pattern dampened PG-wide
   *  (>80%) surfaces as "dampened" so the board can show the sector-wide chip. Defaults "active". */
  displayState?: "active" | "pending_data_integration" | "dampened";
}

// ── THREE-LENS SEPARATION (the lens findings, grouped by METRIC) ─────────────
//
// ★ THE SAME FINDINGS THE CENSUS USED TO CARRY, RE-CUT ALONG THE OTHER AXIS. The metric-level lens
// rows (`lens_lm*_<metricKey>`) are PARTITIONED OUT of `pathology` into this structure — they are not
// in both places, because a block says everything its row said and more, and printing one fact twice
// on one page is how two renderings of it start disagreeing. The PILLAR-level lens rows
// (`lens_lp*_<pillar>`) STAY in `pathology`: they name no metric, so no block can head them, and
// dropping them to keep the family tidy would lose findings the page currently shows.
//
// Composition is server-side (sentence, direction, order); the frontend renders and never re-words.

/** Which side of the peer field a pole reports. Derived from the face's own L2 cell — see
 *  scoring/lens-patterns/field-side.ts for why the peer lens is the axis and not the bar. */
export type LensSeparationSide = "above" | "below";

export interface PeerGroupLensSeparationPole {
  /** The face that fired — "LM3" (above) or "LM7" (below). Carried for the audit trail; the section
   *  renders the composed sentence, never the face label. */
  face: string;
  side: LensSeparationSide;
  memberCount: number;
  /** Symbols on this side, worst-first then alpha (the census's own order). */
  members: string[];
  /** The composed line — how many members, and in which direction. Peer-relative, no valence. */
  sentence: string;
}

export interface PeerGroupLensSeparationBlock {
  /** The identifier. The DISPLAY NAME is the frontend's catalogue lookup, exactly as
   *  `metricDistributions` and `fieldLensVerdicts` already do — the read layer has no label map, and
   *  humanising the key is the bug that renders `lens_lm7_CASA` as "Lens lm7 CASA". */
  metricKey: string;
  pillar: "foundation" | "momentum";
  /** Members caught on this metric ACROSS BOTH POLES — the ordering key, descending. */
  memberCount: number;
  /** The cross-section size, the same M the census counts against. */
  outOf: number;
  /** One pole, or two when the metric caught members at both ends. Heavier first. */
  poles: PeerGroupLensSeparationPole[];
}

export interface PeerGroupLensSeparation {
  /** Ordered by `memberCount` descending. Empty when no metric-level lens finding fired. */
  blocks: PeerGroupLensSeparationBlock[];
  /** Composed only when `blocks` is empty — a group that separates on nothing is a real reading about
   *  the group, not an absence, so the empty state is a sentence rather than a shrug. */
  emptySentence: string | null;
  /** The section's one interpretive boundary. Always present. */
  doesntMean: string;
}

/** The named metric-level lens pattern (LM1–LM8) as carried PER MEMBER on the PG
 *  payload. Same {id,label,tone,fieldVerdict} face the stock read's MetricLensPattern
 *  exposes, MINUS the stock-detail-only standing reconciliation (role/standingContext/
 *  verdict) — the PG cross-section has no per-stock rank context to reconcile against.
 *  Verbatim from LM_CATALOG (no-forward-language already guarded). null for a degenerate
 *  / no-tension cell or when a required lens is not_evaluable (honest-empty). */
export interface PgMetricLensPattern {
  id: string; // "LM1".."LM8"
  label: string;
  tone: string;
  fieldVerdict: "PG_WEAK" | "PG_STRONG" | null;
}

export interface PeerMetricMemberPoint {
  symbol: string;
  rawValue: number;
  l1Band: MetricBand | null;
  scoreState: string;
  // ── S2 three-lens projection (additive; absent on legacy/non-scored cells) ──────
  /** The three lens reads for this member's metric — {state, evaluable, referenceValue,
   *  reason}, derived from the lens columns already on the score row via the SAME
   *  deriveLensTriplet primitive the stock read calls. The PG read carries no per-metric
   *  history series, so l3 is a plain LensRead (no sparkline `series`). Present only on
   *  scored metrics; undefined otherwise (honest-empty, not a fabricated read). */
  lens?: { l1: LensRead; l2: LensRead; l3: LensRead };
  /** The fired LM pattern (via the shared lensPattern primitive + LM_CATALOG), or null
   *  when no pattern fires / a required lens is not_evaluable. undefined on non-scored. */
  lensPattern?: PgMetricLensPattern | null;
}

/** One metric's cross-section: per-member raw values + the persisted peer μ/σ/N
 *  (usable-guarded) + the data-derived bar thresholds. The metric-explorer substrate. */
export interface PeerMetricDistribution {
  metricKey: string;
  pillar: "foundation" | "momentum";
  direction: BarDirection | null;
  bars: {
    excellent: number;
    good: number;
    acceptable: number;
    concerning: number;
    distress: number;
  } | null;
  /** From score_peer_stats (period-keyed). `usable` = sampleN≥5 && stdDev>0 — when
   *  false the values surface for transparency but the UI must NOT draw a curve. */
  peer: { mean: number; stdDev: number; sampleN: number; usable: boolean } | null;
  /** Only members with a SCORED row for this metric (row-absence convention). */
  members: PeerMetricMemberPoint[];
}

export interface PeerGroupMover {
  symbol: string;
  composite: number;
  priorComposite: number;
  delta: number;
  fromPeriod: string;
  toPeriod: string;
}

/** One unscored roster member, with the filing channel's read of it. */
export interface UnscoredPondMember {
  symbol: string;
  name: string;
  /**
   * What this company FILED — fired findings, the checks that declined in the reader's words, and a
   * coverage block whose `quietNote` is what stops an empty `fired` from reading as a clean bill of
   * health. Never an empty array standing in for "nothing wrong".
   *
   * `null` only when the stock has no filing rows at all, which is a different statement again and is
   * left distinguishable rather than collapsed into an empty section.
   */
  filing: FilingFindingsSection | null;
}

/**
 * The unscored half of a pond, with its own denominator on every number it states.
 * See the field note on `PeerGroupHealthView.unscoredMembers` for why this is not merged upward.
 */
export interface UnscoredPondMembers {
  /** Roster members with no reading at all — the denominator for `unscoredPathology.outOf`. */
  count: number;
  /** Of those, how many we hold at least one filing for. `count - covered` have filed nothing we
   *  have ingested, and that is a coverage fact about US, stated rather than hidden in an empty list. */
  covered: number;
  members: UnscoredPondMember[];
  /**
   * A census over THESE members only. Same shape as `pathology` so a surface can render it with the
   * same component — and `outOf` is `count`, never the scored cross-section, which is what keeps the
   * two readable side by side without either borrowing the other's denominator.
   */
  unscoredPathology: PathologyCensusItem[];
}

export interface PeerGroupHealthView {
  scored: boolean;
  identity: PeerGroupIdentity;
  /** null only when the pond has no in-force snapshots. */
  aggregate: PeerGroupAggregate | null;
  /** Full roster of members scored at the current period. */
  members: PeerGroupMemberView[];
  /**
   * ★ ON AN OLDER READING — roster members whose latest in-force snapshot is at an EARLIER period
   * (NESTLEIND@FY26Q2 in Large-Cap FMCG, the one live case across the 13 scored ponds today). Listed,
   * never silently folded into the cross-section: a composite computed across two quarters would be
   * comparing two different things, so these are excluded from `members`, from the aggregate, from
   * the band mix, from the pathology census and from every metric distribution.
   *
   * ⚠ THIS IS NOT "UNSCORED" — see `rosterNotScored`. A member here HAS a reading; it is of an older
   * quarter and has not taken in the latest results. The two states used to be indistinguishable on
   * the page, because both showed up only as the gap between `scoredCount` and `memberCount`.
   */
  notAtCurrentPeriod: {
    symbol: string;
    /** The company's catalogue name — so the disclosure can name a company, not only a ticker. */
    name: string;
    /** The period that older reading IS of ("FY26Q2"). */
    latestPeriod: string;
    /** The day it was written, YYYY-MM-DD — how old "older" actually is. */
    asOfDate: string;
  }[];
  /**
   * ★ NO READING AT ALL — roster members with no snapshot in any period.
   *
   * A DIFFERENT STATE from `notAtCurrentPeriod`, and the honest-empty rule is that the two must not
   * render the same. Empty across all 13 scored ponds today (every peer-group member carries a
   * snapshot), which is exactly why it has to be a field rather than an inference: the moment the
   * Nifty-500 firewall lets an unscored member into a pond, "N of M scored" would otherwise start
   * silently counting it alongside a member that is merely a quarter behind.
   */
  rosterNotScored: { symbol: string; name: string }[];
  /**
   * ★ THE UNSCORED MEMBERS, WITH WHAT WE ACTUALLY KNOW ABOUT THEM (step 5).
   *
   * 54 stocks sit in a peer group and have no score. `rosterNotScored` above has always NAMED them —
   * that was the honest minimum — but the page had nothing else to say, so a pond whose members are
   * all unscored rendered as a shell with a list of tickers. Ten of the 23 ponds are in exactly that
   * state, and in every one of them EVERY member is unscored: Large-Cap NBFCs 8/8, Specialty
   * Chemicals 7/7, Auto Ancillaries 7/7, AMCs & Exchanges 6/6, Retail & Apparel 5/5, Real Estate 5/5,
   * Hospitals 5/5, Telecom 4/4, Housing Finance 4/4, Paints 3/3.
   *
   * The filing channel has plenty to say about them: what each one filed, what fired, and what we
   * could not check. That is served here.
   *
   * ⚠ SEPARATELY DENOMINATED, AND NEVER MERGED INTO THE AGGREGATES ABOVE. `aggregate`, `members`,
   * `pathology`, `metricDistributions` and `movers` are all scored-member aggregates BY CONSTRUCTION —
   * every one of them is a statement about a cross-section of composites. Folding filing findings into
   * `pathology` would put a numerator drawn from the whole roster over a denominator of the scored
   * members, which is the same arithmetic error the base rates carried until step 5. So this block
   * carries its OWN count and its own census, and `unscoredPathology.outOf` states it on every row.
   *
   * Empty on the 13 scored ponds — none of them has an unscored member.
   */
  unscoredMembers: UnscoredPondMembers;
  /**
   * The flag + pattern census.
   *
   * ⚠ THE METRIC-LEVEL LENS ROWS ARE NO LONGER HERE — they are `lensSeparation` below. The universe
   * read made the same partition for the same reason (`UniverseHealthView.lensPathology`); this one
   * goes further and re-cuts them by metric, because a pond is small enough for "which side of this
   * field" to be a comparison a reader can actually hold. Pillar-level lens rows are still here.
   */
  pathology: PathologyCensusItem[];
  /** The metric-level lens findings, grouped by metric. Always present; `blocks` may be empty, in
   *  which case `emptySentence` carries the reading. */
  lensSeparation: PeerGroupLensSeparation;
  metricDistributions: PeerMetricDistribution[];
  movers: { risers: PeerGroupMover[]; slippers: PeerGroupMover[] };
}
