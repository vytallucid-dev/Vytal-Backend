// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — THE FACT BLOCK (types).
//
// The contract the whole feature rests on: the BACKEND computes every number, every comparison and
// (Stage 2) the verdict. The model receives this structure and turns it into prose. It calculates
// nothing, selects nothing, characterises nothing.
//
// ── WHY EVERY FIGURE CARRIES BOTH `value` AND `display` ──────────────────────────────────────────
// `display` is the ONLY string the model is permitted to reproduce for that figure. `value` is the
// raw number behind it. Number-grounding (Stage 3) builds its allowlist from these Facts, so a figure
// that is not in the block cannot legally appear in the prose. One canonical rendering per figure —
// if the block says "18.2%", the model writes "18.2%", never "about 18%".
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { Verdict } from "./verdict.js";

export type Family = "non_financial" | "banking" | "nbfc" | "life_insurance" | "general_insurance";
export type Basis = "consolidated" | "standalone";

/** ONE atomic figure. `value` is null when the fact is qualitative (a turnaround, an absence). */
export interface Fact {
  key: string;
  label: string;
  value: number | null;
  display: string;
}

/** A period-over-period movement.
 *  · percent     — both sides positive; a percentage is meaningful.
 *  · turnaround  — prior ≤ 0, current > 0 (loss → profit). NEVER expressed as a percentage.
 *  · to_loss     — prior > 0, current ≤ 0.
 *  · both_loss   — both sides ≤ 0; stated as two absolutes.
 *  A percentage computed off a zero or negative base is the classic invented number; it is
 *  structurally impossible here because `kind` decides the rendering, not the caller. */
export interface ChangeFact {
  key: string;
  kind: "percent" | "turnaround" | "to_loss" | "both_loss";
  /** Signed percent — populated ONLY when kind === "percent". */
  value: number | null;
  /** "against the previous quarter" | "against the same quarter last year" */
  reference: string;
  display: string;
}

/** One reported line (top line or profit) across the three periods we hold. */
export interface LineComparison {
  line: string;
  current: Fact;
  previousQuarter: Fact | null;
  yearAgoQuarter: Fact | null;
  qoq: ChangeFact | null;
  yoy: ChangeFact | null;
}

/** QoQ and YoY pointing opposite ways. Computed here and stated as a fact — never left for the
 *  model to notice. A quarter that fell 8% sequentially but rose 14% on the year is the single most
 *  useful sentence on the card, and seasonality makes it common. */
export interface DisagreementFact {
  key: string;
  line: string;
  display: string;
}

export interface HeadlineSection {
  revenue: LineComparison;
  profit: LineComparison;
  disagreements: DisagreementFact[];
}

/** Present ONLY when a B-1/B-4 guardrail event exists for this stock and period.
 *
 *  ⚠ `triggeringValues` is deliberately NOT carried. The guardrail catalogue is enforced digit-free
 *  (verify-catalogue.ts §7) because the bar IS the detector — publishing it hands a company the shape
 *  to structure under. So the CHARACTERISATION comes from the catalogue's own reader-facing copy, and
 *  the NUMBERS come from raw filed lines the reader could verify against the statement. The guardrail
 *  event is used as a presence signal, nothing more. */
export interface ProfitSourceSection {
  signatureKey: string;
  name: string;
  description: string;
  doesntMean: string;
  supporting: Fact[];
}

export interface MarginSeries {
  label: string;
  /** Oldest → newest, up to four quarters. */
  points: { periodKey: string; value: number; display: string }[];
  current: Fact;
  direction: "rising" | "falling" | "little changed";
  directionDisplay: string;
  /** True for ratios where a FALL is the favourable direction (general insurance's combined ratio).
   *
   *  ⚠ THIS FLAG IS LOAD-BEARING, NOT DECORATION. A flag nothing reads is worse than no flag, because
   *  it looks like the case is handled. It is enforced two ways: `directionDisplay` for a
   *  lowerIsBetter series ALWAYS carries an explicit consequence clause spelling out what the
   *  direction means in rupees, so there is no room for a downstream renderer to supply its own
   *  (wrong) reading; and verify-quarter-brief-vocabulary.ts asserts that clause is present. */
  lowerIsBetter: boolean;
  /** The same figure said in words a reader who has never seen this ratio can follow. Present only
   *  where the bare percentage is meaningless on its own (the combined ratio). */
  plainDisplay?: string;
}

export interface MarginsSection {
  series: MarginSeries[];
  /** Series withheld because the ratio was not meaningful, with the reason in the reader's words.
   *  Surfaced in `gaps` — a suppressed margin is stated, never silently missing. */
  suppressed: { label: string; reason: string }[];
}

export interface PillarDelta {
  pillar: "foundation" | "momentum" | "market" | "ownership";
  label: string;
  current: number;
  prior: number | null;
  delta: number | null;
  display: string;
}

export interface FindingChange {
  flagKey: string;
  name: string;
  display: string;
}

/** A health-score movement. Deliberately NOT a ChangeFact: the composite moves in POINTS on a 0–100
 *  scale, and expressing that as a percentage ("the score rose 4%") would be a different, wrong claim. */
export interface ScoreChange {
  key: string;
  delta: number;
  priorPeriodKey: string;
  display: string;
}

/** Present ONLY when a ScoreSnapshot exists for this stock AND this period — a PRESENCE check, never
 *  a family list and never a hardcoded universe. Score a previously-unscored stock and its next brief
 *  carries the section with no code change. */
export interface HealthMovementSection {
  periodKey: string;
  /** ★ PINNED. The as-of date of the snapshot in force WHEN THIS BRIEF WAS WRITTEN.
   *
   *  The health score is recomputed on ordinary trading days, not only when results land — DIXON's
   *  FY27Q1 composite moved 65.1 → 65.0 between two runs a few hours apart, with no new filing. A
   *  brief that had to stay current would therefore need regenerating daily, for every scored stock,
   *  forever, to keep one section fresh that is not the point of the feature.
   *
   *  So the section is pinned and dated instead: "as scored on 2026-08-02, the score stood at 65.0"
   *  is true permanently. The quarter's own figures are NOT pinned and need no such date — they are
   *  filed figures and do not move. See the note in fact-block.ts. */
  scoredAsOf: string;
  composite: Fact;
  band: { band: string; label: string };
  priorPeriodKey: string | null;
  compositeChange: ScoreChange | null;
  bandChange: { from: string; fromLabel: string; to: string; toLabel: string; display: string } | null;
  pillars: PillarDelta[];
  findingsFired: FindingChange[];
  findingsCleared: FindingChange[];
}

/** The headline and the health score pointing opposite ways — profit up on the year while the score
 *  fell, or the reverse. Computed, never left for the model to notice: HDFC Bank's profit was up 5%
 *  on the year in the same quarter its band fell Healthy → Steady on Market alone, and a reader told
 *  only "profit up 5%" has been misled. Same treatment as the QoQ/YoY disagreement. */
export interface HeadlineHealthDivergence {
  key: string;
  display: string;
}

export interface BriefIdentity {
  symbol: string;
  name: string;
  family: Family;
  basis: Basis;
  periodKey: string;
  quarter: string;
  fiscalYear: string;
  reportDate: string;
  filingDate: string;
}

export interface QuarterBriefFactBlock {
  identity: BriefIdentity;
  /** Computed by the backend from the written-down ruleset in verdict.ts. Null ONLY when there is no
   *  comparison period on file at all — a genuine absence, rendered as nothing. */
  verdict: Verdict | null;
  headline: HeadlineSection;
  profitSource: ProfitSourceSection | null;
  margins: MarginsSection | null;
  healthMovement: HealthMovementSection | null;
  /** Spans headline and health, so it sits at the top level rather than inside either. Null when
   *  there is no score, or when neither side moved enough to be worth contrasting. */
  headlineHealthDivergence: HeadlineHealthDivergence | null;
  /** What this reading does not cover, stated plainly. Always populated — there is always something
   *  a quarterly P&L read cannot see. */
  gaps: string[];
}
