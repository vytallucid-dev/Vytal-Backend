// File: src/scoring/findings/types.ts
//
// §2/§5 FINDINGS ENGINE — the shared write contract every fire-rule speaks. Built
// against Vytal_StockPage_Sections_2_and_5_Rules_Spec_v1.md (File 1). A fire-rule is
// a PURE function of a FiringContext and returns at most one FiredFinding. The hook
// (score-pass.ts) assembles the context AFTER composite assembly; the persist layer
// writes the fired set linked to the snapshot (append-only — versions WITH the snapshot).
//
// SCOPE NOTE: this is the contract + Stage-A rule shapes. The catalog (~24 rules)
// pours through this same context/finding/persist path in later stages.

import type { LabelBand, Pillar, PillarState } from "../composite/types.js";
import type { OwnershipQuarter } from "../ownership/types.js";
import type { FlowFeeds } from "../ownership/flow.js";
import type { DailyClose } from "../price/range.js";
import type { IndustryType } from "../bars-loader/label-map.js";
import type { FoundationAnnual, MomentumQuarter } from "../metrics/types.js";

/** Mirrors the Prisma `SectorClass` enum. File 1 §2 groups these A=Quality/Defensive,
 *  B=Commodity/Cyclical/PSU, C=Growth. NULL until the sector→class map is populated. */
export type SectorClass = "Quality" | "Defensive" | "Commodity" | "Cyclical" | "Growth" | "PSU";

/** One pillar's value + availability on the current snapshot. STATE is load-bearing:
 *  an unavailable_redistributed pillar persists an INERT-0 subtotal — rules MUST read
 *  `state`, never treat a 0 as a real score (the C1 inert-0 guard). */
export interface PillarSnapshot {
  subtotal: number | null;
  state: PillarState; // "scored" | "unavailable_redistributed"
}

/** One prior snapshot in the ordered per-stock trajectory series (≤ cutoff, oldest→
 *  newest, EXCLUDING current). Carries composite + band + 4 pillar subtotals + each
 *  pillar's availability (derived from the applied weight: 0 ⇒ that pillar was
 *  unavailable that snapshot). Consumed by trajectory rules (B/D/G/I/C-over-time/F2). */
export interface TrajectoryPoint {
  periodKey: string;
  asOfDate: Date;
  composite: number;
  labelBand: LabelBand;
  foundation: number | null;
  momentum: number | null;
  market: number | null;
  ownership: number | null;
  foundationScored: boolean;
  momentumScored: boolean;
  marketScored: boolean;
  ownershipScored: boolean;
}

/** One quarter of operating margin (P11/P12). OPM = operatingProfit / revenue × 100. */
export interface QuarterlyOpmPoint {
  periodKey: string; // "FY26Q3"
  opm: number;
}

/**
 * THE single input bundle a fire-rule reads. Assembled once per member per snapshot.
 * Everything a rule could need: the assembled current snapshot, the ordered prior
 * series (trajectory), the underlying raw series, the price series, the live feeds,
 * the sector class, and the point-in-time cutoff (so trajectory rules never read past
 * the period they fire for). Rules are pure functions of this — no DB, no Date.now.
 */
export interface FiringContext {
  stockId: string;
  symbol: string;
  periodKey: string;
  asOfDate: Date;
  industry: IndustryType; // "non_financial" | "banking"

  /** Point-in-time cutoff threaded from ComputeOpts.pointInTime; null in a live pass.
   *  Trajectory rules must read snapshots/series ≤ this only. */
  cutoff: Date | null;

  /** The assembled CURRENT snapshot — composite + band + the 4 pillar subtotals/states. */
  current: {
    composite: number;
    labelBand: LabelBand;
    pillars: Record<Pillar, PillarSnapshot>;
  };

  /** Ordered prior snapshots (≤ cutoff, oldest→newest, EXCLUDING current). EMPTY for
   *  Stage-A single-snapshot rules; populated by the stage that adds trajectory rules. */
  priorSnapshots: TrajectoryPoint[];

  /** Raw shareholding series, asOnDate ASC (R2/R6/P1–P4/P6…). */
  shareholding: OwnershipQuarter[];
  /** Standalone ANNUAL fundamentals, fiscalYear ASC (R4 D/E history, P8 receivables,
   *  R3/P7 accruals later). Empty for banks — these are non-financial annual rules. */
  annualFundamentals: FoundationAnnual[];
  /** Quarterly OPM series ASC; null for banks / when unavailable (P11/P12). */
  quarterlyOpm: QuarterlyOpmPoint[] | null;
  /** Raw standalone quarterly rows, qOrdinal ASC (R5 TTM interest-coverage, P13 TTM
   *  revenue). Empty for banks. Carries PBT/interest/revenue the OPM series doesn't. */
  quarterlyResults: MomentumQuarter[];
  /** Raw daily closes ASC (§2 realised-vol/drawdown — later stage). */
  daily: DailyClose[];
  /** Insider/block feeds (P5/P6/P10 + card H — later stage; live since the C/D feed). */
  feeds: FlowFeeds;
  /** Sector class-group input (§2 Line 2). Seeded from the ratified map; null only for an
   *  unmapped sector (none today). */
  sectorClass: SectorClass | null;
  /** Band-typical 4-pillar medians (F1 atypical-for-band). Computed once per pass over the
   *  universe's head snapshots ≤ cutoff; null when not computed (legacy callers). */
  bandTypicalProfiles?: import("./composition/band-typical.js").BandTypicalProfiles | null;
}

export type FindingKind = "red_flag" | "pattern";
/** File 1 §5E — the three mandatory pattern display states. */
export type FindingDisplayState = "active" | "pending_data_integration" | "dampened";

/** A RULE's inherent good/bad classification, published as a rule property (Family N
 *  Amendment §1). Distinct from a fired instance's {@link FiredFinding.direction}: a
 *  rule has a polarity even when it does not fire, and a rule may FIRE with a null
 *  direction yet still be `neutral` polarity (e.g. F2's mix-shift). Family N is
 *  `positive`. */
export type Polarity = "positive" | "negative" | "neutral";

/** Amendment §2.4 temporal class. `CONDITION` = a standing fact about the COMPANY that
 *  does not age out on a clock (all of Family N). `EVENT` = a dated occurrence. This is
 *  a semantic marker only — it does NOT imply any dependency on `standing_since` (§4);
 *  a CONDITION rule still counts its own run length from the underlying data at fire time. */
export type TemporalClass = "CONDITION" | "EVENT";

/**
 * The emit shape every rule returns. ONE finding = one card. `evidence` is the JSON the
 * UI reads to build the verdict sentence (it MUST carry the real breaching stat). The
 * persist layer maps `evidence` → RedFlag.triggeringValues (red_flag) or
 * ScorePattern.evidence (pattern), and `metricRefs` → ScorePattern.metricRefs.
 */
export interface FiredFinding {
  kind: FindingKind;
  /** RedFlag.flagKey (red flags) or ScorePattern.patternKey (patterns). */
  key: string;
  /** Red flags: "critical" (File 1 §5A). Patterns: the family-native severity token —
   *  E-patterns use red/amber/green (§5E), structural cards use high/medium/low/recovery
   *  (§5B–I). The read layer maps token → accent colour. FLAG: File 1 doesn't explicitly
   *  reconcile the two palettes — a read-layer concern to confirm. */
  severity: string;
  /** Pattern polarity (positive/negative); null/absent for red flags. */
  direction?: "positive" | "negative" | null;
  /** Pattern effective score impact (§5E: +5/−3/−8/±5). Null for red flags AND for the
   *  structural cards (B/C/D/F/G/H/I) which carry no §5E magnitude. A dampened pattern
   *  stores the HALVED value. */
  magnitude?: number | null;
  displayState?: FindingDisplayState; // patterns; defaults "active"
  /** RULE polarity (positive/negative/neutral) — a rule property published on the fired
   *  instance (Amendment §1). Set explicitly on Family N (`positive`). Distinct from
   *  `direction` (the fired instance's good/bad, which can be null). Optional so existing
   *  rules are untouched; back-filling them is deferred to the evaluability migration. */
  polarity?: Polarity;
  /** Amendment §2.4 temporal class. Family N sets `CONDITION` explicitly. Optional →
   *  existing rules unaffected. Not persisted (no column; reconstructable from the key,
   *  like the base catalog magnitude) — an in-code legibility marker for this build. */
  temporalClass?: TemporalClass;
  /** UI-facing evidence JSON — the breaching stat(s) for the verdict sentence. */
  evidence: Record<string, unknown>;
  /** metricKeys / pillars the finding concerns (ScorePattern.metricRefs). */
  metricRefs?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE EVALUABILITY CONTRACT (Family N Amendment §1) — three outcomes, not two.
// ═══════════════════════════════════════════════════════════════════════════════
// A fire-rule now speaks THREE distinct facts, not two:
//   • a FiredFinding  → it FIRED (we checked and the pattern is TRUE)
//   • `null`          → NOT_FIRED (we checked and the pattern is FALSE)
//   • a NotEvaluable  → NOT_EVALUABLE (we COULD NOT check — missing history / disclosure)
// not_fired and not_evaluable are DIFFERENT facts. A rule must never return a bare `null`
// where the honest answer is "we could not evaluate this" — that collapses "false" into
// "unknown" and downstream surfaces (and the honest-empty law) need them apart.
//
// ADDITIVE, NOT A MIGRATION. Existing rules keep returning `FiredFinding | null` (their
// `null` = not_fired, unchanged) and stay assignable to FireRule below. Family N ships the
// third arm from day one; the ~20 depth-gated existing rules migrate onto it SEPARATELY,
// later — this build does not touch them.
//
// WHY `null` STAYS not_fired (contract shape, blast radius beyond this build): not_fired
// carries no payload, so a bare `null` expresses it losslessly and forever — only the
// not_evaluable arm needed a richer shape (a reason). The eventual engine-wide migration
// therefore reshapes NOTHING here; it only (a) points more rules' unevaluable branches at
// `notEvaluable(reason)` and (b) extends the reason union. That is why the union is the one
// decision with a blast radius beyond this build, and why it is stated at the top of the report.

/** WHY a rule could not be evaluated. STABLE MACHINE TOKENS (never free strings) — a closed
 *  union so downstream can switch exhaustively. Family N uses the eight below. The later
 *  engine-wide migration EXTENDS this union (the survey found existing depth-gated rules would
 *  additionally need e.g. `feed_not_wired` [P5/P6/P10/H insider·block feeds], `no_prior_
 *  snapshots` [trajectory B/D/G/I/C-over-time/C2/C3/F2], `opm_unavailable` [P11/P12],
 *  `pillar_unavailable` [C1 inert-0], `band_typical_unavailable` [F1], `missing_line_item`).
 *  The SHAPE (a single reason token) expresses every one of those — extension is union-only,
 *  never a reshape. */
export type NotEvaluableReason =
  | "insufficient_annual_history"        // fewer annual rows than the rule needs (N1/N2/N3)
  | "insufficient_quarters"              // fewer quarterly-result windows than the rule needs (N4)
  | "insufficient_shareholding_history"  // fewer shareholding filings than the rule needs (N5/N6/N7)
  | "negative_equity"                    // net worth ≤ 0 → the ratio is meaningless, never a pass (N3)
  | "no_debt"                            // Σinterest ≤ 0 → no coverage to strengthen, never a pass (N4)
  | "class_not_disclosed"                // an FII/DII bucket is null this quarter, never a pass (N5)
  | "share_count_unavailable"            // promoter ABSOLUTE share count missing — the buyback firewall (N6)
  | "pledging_not_disclosed";            // pledge column absent for the peer group (N7)

/** The third rule outcome: "we could not check, and here is the machine-readable why."
 *  Discriminated from a FiredFinding (which has `kind`, never `status`) and from not_fired
 *  (`null`) by the `status` literal. */
export interface NotEvaluable {
  status: "not_evaluable";
  reason: NotEvaluableReason;
}

/** Everything a fire-rule may return: a finding · not_fired (`null`) · not_evaluable. */
export type RuleResult = FiredFinding | NotEvaluable | null;

/** Constructor for the not_evaluable arm — keeps rule bodies legible and makes the reason
 *  set the single source of truth (a typo becomes a compile error, not a silent free string). */
export const notEvaluable = (reason: NotEvaluableReason): NotEvaluable => ({ status: "not_evaluable", reason });

/** Type guard: a not_evaluable return vs a fired finding / not_fired. Used by the runner to
 *  keep not_evaluable OUT of the fired set (it is not a finding), and by tests to assert it. */
export function isNotEvaluable(r: RuleResult): r is NotEvaluable {
  return r !== null && (r as NotEvaluable).status === "not_evaluable";
}

/** A fire-rule: pure function of the context. Returns a finding, `null` (not_fired), or a
 *  NotEvaluable (could-not-check). Existing rules that return only `FiredFinding | null`
 *  remain valid — that shape is a subtype of RuleResult (additive, not a migration). */
export type FireRule = (ctx: FiringContext) => RuleResult;
