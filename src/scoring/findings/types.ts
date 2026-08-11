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

import type { RetiredFindingKey } from "../../catalogue/retired-findings.js";
import type { StockFindingKey } from "../../catalogue/stock-findings.js";
import type { LabelBand, Pillar, PillarState } from "../composite/types.js";
import type { OwnershipQuarter } from "../ownership/types.js";
import type { FlowFeeds } from "../ownership/flow.js";
import type { DailyClose } from "../price/range.js";
import type { IndustryType } from "../../generated/prisma/client.js";
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
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★ THE FILED-DATA SLICE — everything a FILING rule may read, and nothing else.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * GOVERNING PRINCIPLE: a finding about a FILING belongs to the stock; a finding about a SCORE belongs
 * to the snapshot. The 22 filing rules assert the first kind — "promoters sold 4.1% this quarter" is
 * true of the company and its filing, and stays true whether or not anyone ever computed a Health
 * Score. They run on all 504 stocks, 409 of which have no snapshot and 355 of which never will.
 *
 * ── WHY THIS IS A TYPE AND NOT A CONVENTION ──────────────────────────────────────────────────────
 * The filing pass has no composite, no band, no pillars and no prior snapshots to give a rule, because
 * for most of the universe none exist. "Filing rules must not read the score" could have been a
 * comment. Instead it is the parameter type: a rule typed {@link FilingRule} that reaches for
 * `ctx.current` or `ctx.priorSnapshots` DOES NOT COMPILE.
 *
 * ── AND IT COSTS THE SCORING PASS NOTHING ────────────────────────────────────────────────────────
 * {@link FiringContext} extends this, so by parameter contravariance every `FilingRule` is also a
 * valid `FireRule`. A filing rule can still be handed a full FiringContext (the Family-N fixtures
 * do exactly that) — the narrowing is one-way and additive.
 *
 * ⚠ FIELDS DELIBERATELY ABSENT, each verified against all 22 rules before removal: `current` /
 * `priorSnapshots` / `bandTypicalProfiles` (score state — the whole point), `sectorClass` (read only
 * by F1, which stays in the scoring pass), `daily` (read by no rule at all — the price series reaches
 * the engine through the ownership price probe, not through a rule), `periodKey` and `cutoff` (the
 * SCORING period and the point-in-time boundary; a filing rule keys on the period of the filing it
 * read, which it takes from that filing's own rows).
 */
export interface FilingContext {
  stockId: string;
  symbol: string;
  asOfDate: Date;
  /** The STOCK's own `Stock.industryType` — see {@link isFinancialIndustry}. */
  industry: IndustryType;
  /** Raw shareholding series, asOnDate ASC (R1/R2/R6/P1/P4/P6/H/N5–N7). */
  shareholding: OwnershipQuarter[];
  /** Filed ANNUAL fundamentals, fiscalYear ASC, from the stock's own industry tables. */
  annualFundamentals: FoundationAnnual[];
  /** Quarterly OPM series ASC; null for every financial industry (P11/P12). */
  quarterlyOpm: QuarterlyOpmPoint[] | null;
  /** Filed QUARTERLY results, qOrdinal ASC, from the stock's own industry tables (R5/N4/P13). */
  quarterlyResults: MomentumQuarter[];
  /** Insider/block feeds (P6/H — and P5/P10, which stay in the scoring pass). */
  feeds: FlowFeeds;
}

export interface FiringContext extends FilingContext {
  stockId: string;
  symbol: string;
  periodKey: string;
  asOfDate: Date;
  /** ★ THE STOCK'S OWN `Stock.industryType` — all five values, NOT the peer group's two-valued
   *  industry PATH (bars-loader/label-map's IndustryType, which only distinguishes the two bar sets
   *  that exist). Widened on 2026-08-09 so a rule can name `nbfc` / `life_insurance` /
   *  `general_insurance` explicitly. Before that, those 48 stocks were excluded from the annual and
   *  quarterly rules only BY ACCIDENT — the guards named `banking`, and the other three fell through
   *  to an empty `annualFundamentals` because their accounts live in tables the loader never read.
   *  An accident that produces the right answer is still an accident, and it stops working the
   *  moment metrics/filed-load.ts serves those stocks real data. See {@link isFinancialIndustry}. */
  industry: IndustryType;

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

/**
 * ★ THE INDUSTRY GUARD, IN ONE PLACE.
 *
 * True for the four industries that file under a dedicated XBRL taxonomy into their own tables:
 * banking, nbfc, life_insurance, general_insurance. False only for non_financial.
 *
 * ── WHY A PREDICATE AND NOT TEN COPIES OF `ctx.industry === "banking"` ───────────────────────────
 * Ten rules (R3, R4, R5, P7, P8, P13, N1, N2, N3, N4) carried that literal. Every one of them is
 * CORRECT — OCF-vs-NP, debt-to-equity, interest coverage, receivables-vs-revenue and revenue
 * inflection are meaningless for a lender or an insurer, whose interest expense IS its cost of goods
 * and whose "receivables" are a loan book. What was wrong is that the literal named ONE of the four
 * industries it needed to exclude, and got away with it because the other three arrived carrying an
 * empty array from a table they do not file into. This predicate makes the exclusion say what it
 * means, for all four, and keeps the list in one place rather than in ten rule bodies.
 *
 * ⚠ THIS IS NOT "financials are unscoreable". Banks ARE scored, on their own metric set and their own
 * bars. It is narrower and only that: these particular rules' arithmetic does not transfer. A later
 * step that builds a genuine financial-industry equivalent of one of them will name that industry
 * explicitly at the rule, rather than widening this.
 */
export const isFinancialIndustry = (industry: IndustryType): boolean => industry !== "non_financial";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE FIRED-FINDING SHAPE IS DEFINED IN A LEAF MODULE AND RE-EXPORTED HERE.
//
// It moved to `fired-finding.types.ts` so that modules a BUILD GATE imports (coalesce.ts, reached by
// verify-coalescing.ts and verify-copy-register.ts) can name it WITHOUT pulling in this file — which
// carries a type-only import of the generated Prisma client. verify-build-gate-hygiene.ts walks the
// import graph without distinguishing type-only edges, deliberately, so "erased at runtime" is not an
// argument it accepts.
//
// ⚠ RE-EXPORT, NOT A COPY. There is exactly one declaration of each of these, in the leaf module.
// Every existing `from "./types.js"` import site is unchanged.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export type {
  FindingKind,
  FindingDisplayState,
  Polarity,
  TemporalClass,
  LensComposedKey,
  FiredFindingKey,
  FiredFinding,
} from "./fired-finding.types.js";
import type { FiredFinding } from "./fired-finding.types.js";

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
  | "insufficient_annual_history"        // fewer annual rows than the rule needs (N1/N2/N3, R3, P7, P8)
  | "insufficient_quarters"              // fewer quarterly-result windows than the rule needs (N4, R5, P11/P12/P13)
  | "insufficient_shareholding_history"  // fewer shareholding filings than the rule needs (N5/N6/N7)
  | "negative_equity"                    // net worth ≤ 0 → the ratio is meaningless, never a pass (N3)
  | "no_debt"                            // Σinterest ≤ 0 → no coverage to strengthen, never a pass (N4)
  | "class_not_disclosed"                // an FII/DII bucket is null this quarter, never a pass (N5)
  | "share_count_unavailable"            // promoter ABSOLUTE share count missing — the buyback firewall (N6)
  | "pledging_not_disclosed"             // pledge column absent for the peer group (N7)
  // ── EXTENSION (Phase 2, the engine-wide migration this build performs) ──────────────────────────
  // The Family N amendment anticipated exactly these tokens for the pre-existing depth-gated rules.
  // The SHAPE is unchanged (one reason token) — this is a union extension, never a reshape.
  | "no_prior_snapshots"                 // trajectory rules (B/D/G/I/C-over-time/C2/C3/F2) need history
  | "opm_unavailable"                    // operating-margin series absent (P11/P12)
  | "pillar_unavailable"                 // a required pillar is unscored/inert (C1)
  | "band_typical_unavailable"           // band-typical profiles not computed for this pass (F1)
  | "feed_not_wired"                     // insider/block feed absent for this stock (P5/P6/P10/H)
  | "missing_line_item"                  // a required financial line item is null in the latest period
  // ── EXTENSION (the filing pass) ─────────────────────────────────────────────────────────────────
  // ★ THE INDUSTRY EXCLUSION IS A DECLINE, NOT A CLEAN BILL. The ten industry-guarded rules (R3, R4,
  // R5, P7, P8, P13, N1–N4) returned a bare `null` for a bank or an NBFC, which the three-state
  // contract reads as not_fired — "we checked HDFCBANK's earnings quality and it is clean". We did
  // not check it. OCF-vs-NP, D/E and interest coverage are not defined for a lender, so the honest
  // answer is that the check does not apply, and a reader is entitled to see that rather than a
  // silent pass. Score-neutral by construction: every rule carrying this arm left the scoring pass in
  // the same change.
  | "industry_not_applicable";           // the rule's arithmetic is undefined for this industry

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

/**
 * ★ A FILING RULE — a fire-rule that reads ONLY filed data (see {@link FilingContext}).
 *
 * Every FilingRule IS a FireRule (parameter contravariance: FiringContext extends FilingContext), so
 * the two registries in engine.ts can share the runner, `RULE_REFS`, and every existing tool. The
 * narrowing runs one way only, and that direction is the enforcement: assigning a rule that reads
 * `ctx.current` to `FilingRule` is a compile error, which is how "the filing pass never reads a
 * score" stops being a promise and becomes a fact.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ BEFORE YOU CHANGE ONE OF THESE, READ `rules/BACKFILL-LAW.md`. ★★
 *
 * Any change to a filing rule's LOGIC or its CONSTANTS requires a full backfill of all 504 stocks:
 *
 *     npx tsx src/scripts/filing-backfill.ts --reason "what you changed"
 *
 * The pass is filing-keyed (step 6): a stock's row is recomputed when the feed that rule depends on
 * lands, and not otherwise. So a row computes once and FREEZES — up to eleven months for an annual
 * rule. Move a threshold and the universe silently splits into rows computed under the old constant
 * and rows computed under the new one, with nothing on either row recording which. `stock_findings`
 * stores the verdict, not the constant that produced it.
 *
 * The law also covers the case where your change is a FIX: see `--reset-rule` there before shipping
 * one, or 39 stocks get told a finding is "newly standing" when what changed was our arithmetic.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
export type FilingRule = (ctx: FilingContext) => RuleResult;

// ═══════════════════════════════════════════════════════════════════════════════
// RETIRED RULES — "files kept, not registered" is now a TYPE, not a convention.
// ═══════════════════════════════════════════════════════════════════════════════
// Ten rule files survive on disk as a record of what was tried (P2/P3, the C/G
// divergence rebuild, the B/D/I trajectory rebuild). Their keys are ABSENT from
// STOCK_FINDING_KEYS by design — "carrying copy for a key that cannot fire would
// be carrying a lie" — so with FiredFinding.key narrowed to the catalogue's
// vocabulary they can no longer be typed as FireRule, and that is correct.
//
// ★ THE PROTECTION THIS BUYS. Until now, "not in ALL_RULES" was the ONLY thing
// keeping a retired rule from firing — one import away from being undone, silently,
// by someone tidying the registry. A RetiredRule is not assignable to FireRule, so
// adding one to ALL_RULES does not compile. The P2/P3 lesson ("an unregistered rule
// never fires") is now enforced from the other side too.
export type RetiredFiredFinding = Omit<FiredFinding, "key"> & { key: RetiredFindingKey };

/** A rule that has been retired: same shape, a key the catalogue deliberately does not carry. */
export type RetiredRule = (ctx: FiringContext) => RetiredFiredFinding | NotEvaluable | null;
