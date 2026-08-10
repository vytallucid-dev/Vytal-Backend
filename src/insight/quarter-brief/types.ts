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
import type { QuarterSection } from "./quarter-section.js";
import type { AnnualSection } from "./annual-section.js";
import type { DriverFact } from "./driver.js";
import type { ContrastFact } from "./contrasts.js";
import type { AnnualContrastFact } from "./annual-contrasts.js";

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
 *  · percent     — both sides positive and the move is readable as a percentage.
 *  · large_move  — both sides positive but the move exceeds LARGE_MOVE_PCT; stated as two absolutes,
 *                  because "up 31346%" off a ₹1.68 crore base tells the reader nothing. `value` IS
 *                  carried so direction still reads — only the rendering changes.
 *  · nil         — both sides exactly zero. NOT a loss: a line reported as nothing is nothing.
 *  · turnaround  — prior ≤ 0, current > 0 (loss or nil → profit). NEVER expressed as a percentage.
 *  · to_loss     — prior > 0, current ≤ 0.
 *  · both_loss   — both sides ≤ 0 and not both nil; stated as two absolutes.
 *  A percentage computed off a zero or negative base is the classic invented number; it is
 *  structurally impossible here because `kind` decides the rendering, not the caller. */
export interface ChangeFact {
  key: string;
  kind: "percent" | "large_move" | "nil" | "turnaround" | "to_loss" | "both_loss";
  /** Signed percent — populated for `percent` and `large_move`, null for every other kind. */
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

// ★ STAGE 2 — PeerContextFact MOVED TO peer-shape.ts AND IS RE-EXPORTED HERE.
//
// It lived in this file for one reason: peers.ts imports the DB client, and this file must stay
// reachable from the PURE build gates. That reason still holds — and peer-shape.ts is now the pure
// module that satisfies it, carrying the METRIC SET, the COUNTING and the WORDS beside the type they
// describe, so a gate can assert all four together on synthetic rows. The re-export keeps every
// existing `import type { PeerContextFact } from "./types.js"` working.
export type { PeerComparison, PeerContextFact } from "./peer-shape.js";
import type { PeerContextFact } from "./peer-shape.js";

export interface QuarterBriefFactBlock {
  identity: BriefIdentity;
  /** Computed by the backend from the written-down ruleset in verdict.ts. Null ONLY when there is no
   *  comparison period on file at all — a genuine absence, rendered as nothing. */
  verdict: Verdict | null;
  /** ★ SECTION 1 — every metric this family files, including the ones that did not move. THE change
   *  the redesign exists for: 2–4 metrics became 12–24. */
  quarter: QuarterSection;
  /** ★ SECTION 2 — THE ANNUAL SECTION, AND THE ONLY ROUTE TO A BALANCE-SHEET FACT.
   *
   *  ⚠ NULL ON Q1, Q2 AND Q3 ALWAYS, AND ON ANY Q4 WITH NO ANNUAL ROW ON THIS BASIS. Both are
   *  presence, not assumption — see annual-section.ts's three gates. A reader on a Q1 card is told, in
   *  `gaps`, that the balance sheet is a once-a-year figure and is not shown; they are never shown one
   *  that is up to twelve months older than the quarter beside it. */
  annual: AnnualSection | null;
  /** Retained as a COMPUTATION INPUT, not as prose. Two things need both comparisons and neither is a
   *  sentence: the verdict's direction inputs, and the QoQ-vs-YoY disagreement rule. Section 1 already
   *  carries the top line and net profit with one comparison, so rendering this too would print them twice. */
  headline: HeadlineSection;
  /** The line that explains the profit move, pre-attributed with its share. Null is the common case —
   *  no bridge for the family, the identity did not close on both rows, or no nameable line reached
   *  half the move. The model phrases it; it never derives causation. */
  driver: DriverFact | null;
  /** Named contrast rules that fired. Empty is normal and renders as nothing — there is no free-form
   *  "insight" field, deliberately. */
  contrasts: ContrastFact[];
  /** ★ THE FULL YEAR'S NAMED RULES. Q4 only, and empty whenever `annual` is null.
   *
   *  ⚠ A SEPARATE FIELD FROM `contrasts`, NOT A FLAG ON IT. The two are computed by two modules that
   *  cannot see each other's figures — annual-contrasts.ts carries the reason — and one array holding
   *  both would be a place for a twelve-month fact and a three-month fact to be joined by whatever
   *  reads it. Empty is normal on every Q1, Q2 and Q3 card by construction. */
  annualContrasts: AnnualContrastFact[];
  /** How this quarter's growth sat against same-family peers that filed the same period. Null on
   *  roughly four cards in five; a comparison against one peer is not a comparison. */
  peers: PeerContextFact | null;
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
