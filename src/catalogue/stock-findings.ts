// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// REGISTRY 1 of 4 — STOCK FINDINGS. The static, rule-level copy for every flag/pattern the scoring
// engine emits for a COMPANY.
//
// ── ★ THIS IS A MOVE, NOT A REWRITE ────────────────────────────────────────────────────────────────
// Every string below came from Vytal-Frontend/lib/findings/descriptions.ts and lib/n-family-copy.ts,
// character for character. scripts/verify-catalogue.ts loads BOTH and asserts byte-identity; a single
// changed character fails it. Wording changes are a separate decision from relocation and must not
// ride in on this one.
//
// ── THE TWO LAYERS — do not conflate ───────────────────────────────────────────────────────────────
//   description (HERE)     static, rule-level.  "What this pattern means."         Any surface.
//   VERDICT (Stage 3)      dynamic, per-stock.  "What happened at this company."   Per-stock only.
// They compose. A verdict never substitutes for a description and vice versa. Verdicts are
// (evidence) => string FUNCTIONS and cannot be served as JSON, which is why they are a separate stage
// and a separate transport (rendered into finding ROWS, not served from the catalogue endpoint).
//
// ── COPY DISCIPLINE (non-negotiable — these definitions are load-bearing) ──────────────────────────
// Derived from the locked specs (Master Spec Parts XII–XIII, StockPage Rules Spec §5, Family N
// Amendment) and transcribed VERBATIM. They describe **what happens at the company**, never what the
// finding does to our score. "Overrides the composite until it clears" is engine-speak and is exactly
// what this catalogue replaces.
//
// Rules for any future edit:
//   - Describe the company, never the scoring mechanism.
//   - No advice, no prediction, no buy/sell framing. A red flag is "go look hard", not "it will fall".
//   - ⚠ THE OLD "if a description is missing, render TITLE ONLY" ESCAPE IS GONE. The registry is TOTAL
//     over StockFindingKey (below): a key with no copy is a COMPILE ERROR. There is no missing case
//     left to degrade for.
//
// NOT HERE (a different layer, deliberately):
//   - Three-lens faces  → lens-faces.ts (referenced in place from scoring/lens-patterns/catalog.ts).
//   - Portfolio findings → phs-findings.ts (the book, not a company — a different system entirely).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { N_FAMILY_COPY, N_FAMILY_DOESNT_MEAN, type NFamilyKey } from "./n-family-copy.js";
import { PATTERN_FACTS, PATTERN_KEYS, type PatternKey } from "./pattern-facts.js";
// ★ EVERY finding's facts, all 53 — the 18 studied records plus the 35 unmeasured ones. See that
//   file for why this is an extension of PATTERN_FACTS rather than a replacement of it.
import { FINDING_FACTS, type FactsFor } from "./finding-facts.js";
import type {
  FindingConcern,
  FindingFamily,
  KeyStatus,
  StockFindingEntry,
} from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CLOSED KEY VOCABULARY. Every key the scoring engine can put on a wire for a stock, plus the ONE
// read-layer synthesis (divergence_consolidated).
//
// ★ THIS ARRAY IS WHAT MAKES COPY UNREPRESENTABLE-IF-MISSING. `StockFindingKey` is derived from it and
// STOCK_FINDINGS is TOTAL over that union, so adding a key here without adding its entry below does not
// compile. The Stage-6 CI check closes the other direction (an emitter with no key here).
//
// ⚠ RETIRED KEYS ARE ABSENT BY DESIGN, not forgotten:
//     ownership_P2_distribution_retail  → consolidated into R6
//     ownership_P3_promoter_stress      → consolidated into R1
//   Their rule files survive but are NOT in ALL_RULES ("files kept, not registered", findings/
//   engine.ts), so they cannot fire again. alerts/finding-catalog.ts recognises them ONLY to refuse
//   them. Copy for a key that can never arrive is copy that can never be checked.
//   P9 (capex) is UNBUILT — it has no rule at all.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const STOCK_FINDING_KEYS = [
  // A · critical red flags (R-series)
  "ownership_R1_pledge",
  "ownership_R2_promoter_exit",
  "foundation_R3_earnings_quality",
  "foundation_R4_debt_explosion",
  "foundation_R5_interest_coverage",
  "ownership_R6_distribution",
  // E · patterns (P-series)
  "ownership_P1_clean_rotation",
  "ownership_P4_dual_exit",
  "ownership_P5_insider_distress",
  "ownership_P6_insider_conviction",
  "foundation_P7_accruals",
  "foundation_P8_receivables",
  "ownership_P10_promoter_defense",
  "momentum_P11_margin_compression",
  "momentum_P12_margin_recovery",
  "momentum_P13_revenue_inflection",
  // F/H · structural cards
  //   ⚠ RETIRED and therefore ABSENT (no copy for a key that cannot fire) — see retired-findings.ts:
  //     C1 · C2 · C3 · C_over_time · G  (wave 2, → the D-family divergence rebuild)
  //     trajectory_B_deterioration · trajectory_D_recovery · trajectory_I_band_transition
  //       (wave 3, → the T-family trajectory rebuild)
  "divergence_consolidated",
  "composition_F1_atypical",
  "trajectory_F2_composition_shift",
  "ownership_H_block_events",
  // C · the divergence family (Vytal_Divergence_Tool_Spec Parts 2–3). Seven patterns + two states.
  //   ★ S1 (Aligned) IS HERE (Ruling 3 — S1 is a measured state driving the divergence headline, not
  //   a fact with no home). It carries status "never_emitted": a real entry with real copy and real
  //   facts that no rule and no read-layer composition ever produces as a fired finding — the tool
  //   reads it directly (findings/divergence/aligned.ts). See types.ts's KeyStatus for the full note.
  "divergence_S1_aligned",
  "divergence_D1_price_ahead_quality",
  "divergence_D2_price_ahead_trajectory",
  "divergence_D3_ownership_building_weak_foundation",
  "divergence_D4_ownership_exiting_healthy",
  "divergence_D5_laggard_catching_up",
  "divergence_D6_quality_rolling_over",
  "divergence_D7_trajectory_breaking_base_holds",
  "divergence_S2_sticky_divergence",
  // T · the trajectory family (Vytal_Trajectory_Tool_Spec Parts 2–3). One score's own path.
  //   ★ The key PREFIX carries the family: trajectory_B_* = deterioration, trajectory_D_* = recovery.
  //     familyOf's existing `startsWith("trajectory_B_"/"trajectory_D_")` branches classify all nine
  //     with no new branch — and therefore no frontend familyOf change to keep in step.
  "trajectory_D_T1_recovery_low_zone",
  "trajectory_B_T2_deterioration_high_base",
  "trajectory_B_T3_falling_out_of_pristine",
  "trajectory_D_T4_recovering_out_of_below_par",
  "trajectory_D_T5_foundation_out_of_weak",
  "trajectory_B_T6_momentum_breaking_into_weak",
  "trajectory_D_T7_momentum_improving_while_weak",
  "trajectory_D_T8_foundation_strong_improving",
  "trajectory_B_T9_foundation_weak_declining",
  // N · Notable (constructive twins)
  "foundation_N1_cash_backed_earnings",
  "foundation_N2_working_capital",
  "foundation_N3_deleveraging",
  "foundation_N4_coverage_strengthening",
  "ownership_N5_dual_institutional_build",
  "ownership_N6_promoter_accumulation",
  "ownership_N7_pledge_release",
] as const;

export type StockFindingKey = (typeof STOCK_FINDING_KEYS)[number];

/**
 * ★ PatternKey ⊂ StockFindingKey, PROVED. A facts record for a key the vocabulary does not carry is a
 * compile error here — the two modules cannot drift into declaring facts for a pattern that can never
 * arrive on a payload. (The other direction is intentionally open: a finding without pattern facts is
 * the normal case for families A, E, F, H and N.)
 */
const _PATTERN_KEYS_ARE_CATALOGUED: readonly StockFindingKey[] = PATTERN_KEYS;
void _PATTERN_KEYS_ARE_CATALOGUED;

/**
 * ★ THE REGISTRY TYPE, NARROWED PER KEY — this is where §3's compile-time binding actually lands.
 *
 * `key` carries its own LITERAL type, so a rule writing `key: ENTRY.key` emits a key that is provably
 * in the vocabulary and provably the one it looked up. And `facts` resolves through PATTERN_FACTS'
 * own inferred shape, so:
 *
 *   STOCK_FINDINGS.divergence_S2_sticky_divergence.facts.gapFloor   →  number   (no null-check)
 *   STOCK_FINDINGS.divergence_D6_quality_rolling_over.facts.gapFloor →  null    (unusable as a number)
 *   STOCK_FINDINGS.ownership_R1_pledge.facts                        →  null    (not dereferenceable)
 *
 * A generic consumer that only knows `StockFindingEntry` still sees the widened union; the narrowing
 * is for the rules, which are the only callers that need a threshold rather than a fact.
 *
 * ── ★ `facts` IS NO LONGER `null` FOR ANYTHING ────────────────────────────────────────────────────
 * It used to be, for the 35 findings outside the studied D/S/T set, and the third line above read
 * `STOCK_FINDINGS.ownership_R1_pledge.facts → null (not dereferenceable)`. That was the type telling
 * the truth about a real hole: R1's two bars sat as bare `export const`s in pledging.ts, it had no
 * declared display precision, and it was the one rule of 53 that stamped an unrounded number.
 *
 * `FactsFor<K>` closes it — see catalogue/finding-facts.ts for why the 18 studied records were
 * EXTENDED rather than flattened, and why a red flag gets `thresholds` instead of a fabricated
 * `regimeMap`. The line above now reads:
 *
 *   STOCK_FINDINGS.ownership_R1_pledge.facts.thresholds.pledgeRatioPct  →  50
 *   STOCK_FINDINGS.ownership_R1_pledge.facts.gapFloor                   →  compile error, correctly
 */
export type StockFindingRegistry = {
  readonly [K in StockFindingKey]: Omit<StockFindingEntry, "key" | "facts"> & {
    readonly key: K;
    readonly facts: FactsFor<K>;
  };
};

// ── per-family "doesn't mean" interpretive boundary (File 1 §5, verbatim) ──────────────────────────
// TOTAL BY CONSTRUCTION (amendment §2): every family MUST carry a boundary line, so this is a total
// Record<FindingFamily, …> — a missing family is a COMPILE error, not a runtime blank. Family N's line
// is spec copy, imported from n-family-copy.ts, never authored here.
export const FAMILY_DOESNT_MEAN: Readonly<Record<FindingFamily, string>> = {
  A: "a hard risk/quality warning to investigate — not a prediction the stock will fall.",
  B: "review your thesis, not sell — an early risk read, not a price call.",
  C: "you read the state, you can't time the resolution — divergences are sticky; the bill is due, never that it's due today.",
  // ⚠ "worth investigating" REMOVED (the advisory ban). It is an instruction in descriptive clothing —
  //   a reader told a condition is worth investigating has been told to act, whether or not a verb was
  //   used. The line now states what the reading IS and what it is not, which is the whole job of a
  //   boundary. Caught by verify-copy-register.ts, not by review.
  D: "a coincident health inflection — not a buy, not a guaranteed continuation; strongest read against a calm pond.",
  E: "a condition to look at — not a trade signal.",
  F: "a place to investigate, not a re-rate signal.",
  G: "the move isn't over, and which way it resolved depends on which pillar moved — not buy/sell.",
  H: "risk/flow context, not a verdict.",
  I: "a band change to note — not a buy/sell call.",
  N: N_FAMILY_DOESNT_MEAN, // Family N (Notable) — verbatim spec copy (amendment §4.1)
};

// Three-Lens escalations (lens_lm3/lm7/lp2/lp5) carry their own no-prediction boundary —
// field-verdicts are CONTEXT (about the field), never a stock call. Keyed by LOWERCASE face id,
// exactly as it appears inside the composed `lens_<id>_<suffix>` key.
export const LENS_DOESNT_MEAN: Readonly<Record<string, string>> = {
  lm3: "where the weakness lives — in the field, not uniquely this name; not a forecast the field recovers.",
  lm7: "a hard quality read on this metric to investigate — not a prediction the stock falls.",
  lp2: "the pillar leads a weak pond — its relative strength is a field artifact, not a forecast.",
  lp5: "broad self-deterioration to investigate — an early breadth read, not a price call.",
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FAMILY RESOLUTION FROM KEY SHAPE. Ported from the frontend read layer unchanged, because the
// doesntMean resolver must reproduce its behaviour EXACTLY for keys the registry does not carry
// (composed `lens_*` keys, and any future key that reaches a payload before its copy lands).
// Order of tests matters.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export function familyOf(key: string): FindingFamily {
  if (/_R\d+_/.test(key)) return "A"; // ownership_R1_pledge … foundation_R5_interest_coverage
  if (key.startsWith("divergence_")) return "C"; // C1 / C2 / C3 / C-over-time
  if (key.startsWith("trajectory_B_")) return "B";
  if (key.startsWith("trajectory_D_")) return "D";
  if (key.startsWith("trajectory_G_")) return "G";
  if (key.startsWith("trajectory_I_")) return "I";
  if (key.startsWith("trajectory_F2_") || key.startsWith("composition_F1_")) return "F";
  if (key.startsWith("ownership_H_")) return "H";
  // Notable (N) constructive mirrors — e.g. foundation_N1_cash_backed. `_N\d+_` needs a digit
  // after N, so it cannot match `_NG…` any more than `_P\d+_` matches `_PG3_`; placed before the
  // `_P\d+_` / fallthrough tests so an N key can never be shadowed into E.
  if (/_N\d+_/.test(key)) return "N";
  if (/_P\d+_/.test(key)) return "E"; // ownership/foundation/momentum P-patterns
  return "E"; // unknown pattern → safest bucket (still rendered, never dropped)
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE COPY. `description` + `family` + `concern` are the frontend's FINDING_DESCRIPTIONS; `name` is
// its FINDING_NAMES; `doesntMean` is RESOLVED here (per-entry line where the catalogue has one — Family
// N — else the family's mandatory line), so the served entry is complete and the consumer never has to
// run the resolution itself. Both inputs are preserved verbatim; only the JOIN is new.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

interface StockFindingCopy {
  name: string;
  description: string;
  family: FindingFamily;
  concern: FindingConcern;
  status: KeyStatus;
  /** Per-entry interpretive boundary (amendment §2 — a finding's OWN line, which wins over its
   *  family's). Absent → the family line is used. Only Family N carries per-entry lines today. */
  doesntMean?: string;
}

// Family N (Notable) — DERIVED from the supplied spec copy (n-family-copy.ts), never re-typed here, so
// the strings stay verbatim spec text and single-sourced. Concern follows the key prefix:
// foundation_N1–N4 → fundamentals, ownership_N5–N7 → ownership (never orphaned).
// N_FAMILY_COPY is total over NFamilyKey, and NFamilyKey ⊂ StockFindingKey — so this derived map
// contributes its seven LITERAL keys to the spread below, and the totality check that follows covers
// all 35 keys rather than only the 28 authored inline.
const N_COPY = Object.fromEntries(
  (Object.entries(N_FAMILY_COPY) as [NFamilyKey, (typeof N_FAMILY_COPY)[NFamilyKey]][]).map(([key, c]) => [
    key,
    {
      name: c.name,
      description: c.description,
      family: "N" as FindingFamily,
      concern: (key.startsWith("ownership") ? "ownership" : "fundamentals") as FindingConcern,
      status: "live" as KeyStatus,
      doesntMean: c.doesntMean,
    },
  ]),
) as Record<NFamilyKey, StockFindingCopy>;

const COPY: Readonly<Record<StockFindingKey, StockFindingCopy>> = {
  // ── Family N (Notable) — constructive mirrors; descriptions render on evidence-free surfaces
  //    (the Hub census board) so N patterns are never title-only there. Derived from spec copy above.
  ...N_COPY,

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // Family A · Critical red flags (R1–R6) — Master Spec §13.2, locked triggers
  // Hard failure indicators. Fire regardless of composite.
  //
  // ⚠ THESE DESCRIPTIONS NAME THEIR TRIGGER BARS ("more than half", "5 percentage points", "3×",
  // "1.5 times") AND THAT STAYS. Those bars read filed, public, regulator-mandated disclosures. A
  // company cannot restructure a shareholding pattern to duck a pledge ratio the exchange publishes.
  // Contrast the guardrail registry, whose thresholds ARE gameable and are therefore written
  // qualitatively — the two rules are opposite because the data is opposite. Do not harmonise them.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════

  // R1 · Pledging Crisis — ★ NOT a FireRule: written by the ownership persist path
  //      (scoring/ownership/primary.ts → composite/persist.ts), which is why it is absent from
  //      engine.ts's ALL_RULES and present in alerts/finding-catalog.ts's static list.
  ownership_R1_pledge: {
    name: "Pledging Crisis",
    description:
      "Promoters have pledged more than half their stake as loan collateral, or sharply increased what's pledged in a single quarter. Pledged shares can be sold by the lender if the loan sours, so heavy pledging is a financing-stress signal about the promoters.",
    family: "A",
    concern: "ownership",
    status: "live",
  },

  // R2 · Promoter Exit
  ownership_R2_promoter_exit: {
    name: "Promoter Exit",
    description:
      "Promoter holding fell by more than 5 percentage points between one shareholding filing and the next — and not because of a fundraise that diluted everyone. The people who run the company reduced their own ownership materially and quickly.",
    family: "A",
    concern: "ownership",
    status: "live",
  },

  // R3 · Earnings Quality Breakdown
  foundation_R3_earnings_quality: {
    name: "Earnings Quality Breakdown",
    description:
      "Reported net profit has exceeded operating cash flow for four or more consecutive years. Profit is being booked that the business isn't converting into cash, and the gap has persisted long enough to be structural rather than timing.",
    family: "A",
    concern: "fundamentals",
    status: "live",
  },

  // R4 · Debt Explosion
  foundation_R4_debt_explosion: {
    name: "Debt Explosion",
    description:
      "Debt-to-equity has crossed 3× for the first time in the company's recent annual accounts — no earlier year on file breached it. The balance sheet has taken on leverage well beyond anything in that history.",
    family: "A",
    concern: "fundamentals",
    status: "live",
  },

  // R5 · Interest Coverage Collapse
  foundation_R5_interest_coverage: {
    name: "Interest Coverage Collapse",
    description:
      "Earnings before interest and tax have covered interest costs less than 1.5 times, measured over the trailing twelve months, for two consecutive quarters. The company is earning barely more than it owes its lenders.",
    family: "A",
    concern: "fundamentals",
    status: "live",
  },

  // R6 · Distribution Pattern
  ownership_R6_distribution: {
    name: "Distribution Pattern",
    description:
      "In the same quarter, promoters reduced, foreign institutions reduced, and retail holding rose. The better-informed owners sold and smaller shareholders absorbed the shares.",
    family: "A",
    concern: "ownership",
    status: "live",
  },

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // Family E · Patterns (P1–P13) — Master Spec §12.3, closed catalog
  // Conditional cross-metric / cross-pillar relationships. Modest score effect by design.
  // (P2, P3 retired from ALL_RULES; P9 unbuilt — no entries, they cannot fire.)
  // ═════════════════════════════════════════════════════════════════════════════════════════════════

  // P1 · Clean Institutional Rotation
  ownership_P1_clean_rotation: {
    name: "Clean Institutional Rotation",
    description:
      "Domestic institutions bought meaningfully while foreign institutions trimmed only slightly, with promoter holding essentially unchanged. Ownership changed hands between professional investors rather than being distributed outward.",
    family: "E",
    concern: "ownership",
    status: "dormant",
  },

  // P4 · Dual Institutional Exit
  ownership_P4_dual_exit: {
    name: "Dual Institutional Exit",
    description:
      "Both foreign and domestic institutions reduced their holdings in the same period. Two independent sets of professional investors stepped back at the same time.",
    family: "E",
    concern: "ownership",
    status: "dormant",
  },

  // P5 · Insider-Confirmed Distress
  ownership_P5_insider_distress: {
    name: "Insider-Confirmed Distress",
    description:
      "The people closest to the company have been selling their own holdings, at a company whose overall health already reads weak. Insider selling into existing weakness reads differently from a routine trim on a sound business.",
    family: "E",
    concern: "ownership",
    status: "dormant",
  },

  // P6 · Insider Conviction
  ownership_P6_insider_conviction: {
    name: "Insider Conviction",
    description:
      "Directors and key management have been buying their own stock. The people running the business day to day added to their own positions.",
    family: "E",
    concern: "ownership",
    status: "live",
  },

  // P7 · Accruals Divergence
  foundation_P7_accruals: {
    name: "Accruals Divergence",
    description:
      "Operating cash flow covered less than half of reported profit in the latest financial year. Earnings are being recognised well ahead of the cash behind them actually arriving.",
    family: "E",
    concern: "fundamentals",
    status: "live",
  },

  // P8 · Capital Tied in Receivables
  foundation_P8_receivables: {
    name: "Capital Tied in Receivables",
    description:
      "Money owed by customers grew far faster than revenue over the latest financial year. A growing share of the company's capital is sitting in receivables rather than working in the business.",
    family: "E",
    concern: "fundamentals",
    status: "live",
  },

  // P10 · Promoter Defense Buying
  ownership_P10_promoter_defense: {
    name: "Promoter Defense Buying",
    description:
      "Promoters bought their own stock at a time when its share price was not reading strongly. The people who control the company added to their stake while the market was unenthusiastic about it.",
    family: "E",
    concern: "ownership",
    status: "live",
  },

  // P11 · Quarterly Margin Compression
  momentum_P11_margin_compression: {
    name: "Quarterly Margin Compression",
    description:
      "Operating margin has fallen for two or more consecutive quarters. Profitability is eroding across successive quarters rather than dipping in a single soft one.",
    family: "E",
    concern: "momentum",
    status: "live",
  },

  // P12 · Quarterly Margin Recovery
  momentum_P12_margin_recovery: {
    name: "Quarterly Margin Recovery",
    description:
      "Operating margin has risen for two or more consecutive quarters from a recent trough. Profitability has turned up off a low.",
    family: "E",
    concern: "momentum",
    status: "live",
  },

  // P13 · TTM Revenue Inflection
  momentum_P13_revenue_inflection: {
    name: "TTM Revenue Inflection",
    description:
      "The trailing-twelve-month revenue growth rate changed by at least 5 percentage points against the prior quarter's — a clear acceleration or deceleration in the pace of growth.",
    family: "E",
    concern: "momentum",
    status: "live",
  },

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // Structural families B / C / D / F / G / H / I — StockPage Rules Spec §5
  // These fire and persist today. They are among the most decision-relevant findings in the system,
  // and the `trajectory` concern is what carries them onto the Hub board instead of orphaning them.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // Family B / D · THE TRAJECTORY FAMILY — Vytal_Trajectory_Tool_Spec Parts 2–3.
  // One score moving along its own path. Nine patterns, split across the two existing trajectory
  // families by DIRECTION: B = deterioration (T2/T3/T6/T9), D = recovery (T1/T4/T5/T7/T8). The
  // families' existing boundary lines already fit, so no new FAMILY_DOESNT_MEAN entry is needed.
  //
  // ⚠ NO DESCRIPTION HERE MAY IMPLY (Part 4):
  //   R1 · that a bigger move is a bigger signal — measured, the reverse holds
  //   R2 · that Momentum leads the composite — median lead 0 days across 39 matched pairs
  //   R3 · that the reader is early on a large positive Momentum move — they are late by construction
  // Enforced by the copy lint in trajectory/regime-tier.ts, gated in scripts/verify-trajectory.ts.
  // ═════════════════════════════════════════════════════════════════════════════════════════════════

  // T1 · Recovery from the Low Zone
  trajectory_D_T1_recovery_low_zone: {
    name: "Recovery from the Low Zone",
    description:
      "A struggling business is genuinely turning — the overall score has risen materially from a weak starting point. This is a real improvement in the underlying fundamentals rather than a price move: on shifts of this size the non-price pillars contribute most of the change. The market has typically already begun repricing it by the time this shows.",
    family: "D",
    concern: "trajectory",
    status: "live",
  },

  // T2 · Deterioration from a High Base
  trajectory_B_T2_deterioration_high_base: {
    name: "Deterioration from a High Base",
    description:
      "A business that was in good shape is measurably weakening — the overall score has fallen materially from a strong starting point. This is the kind of change worth reviewing your reasons for holding it. How much weight it carries depends on the market phase, which is why this reading always shows the phase it fired in.",
    family: "B",
    concern: "trajectory",
    status: "live",
  },

  // T3 · Falling Out of Pristine
  trajectory_B_T3_falling_out_of_pristine: {
    name: "Falling Out of Pristine",
    description:
      "This business has slipped out of the top health band. That band is defined as fully priced — a company already recognised as excellent — so falling out of it means the one thing supporting a premium rating has started to slip. Whether this carries a directional read depends entirely on the market phase.",
    family: "B",
    concern: "trajectory",
    status: "live",
  },

  // T4 · Recovering Out of Below Par
  trajectory_D_T4_recovering_out_of_below_par: {
    name: "Recovering Out of Below Par",
    description:
      "This business has moved out of below-par territory into steady — a recovery that has held long enough to cross a band. Directional only: the sample behind this reading was not preserved, so it has not been established with the confidence of the other trajectory patterns.",
    family: "D",
    concern: "trajectory",
    status: "live",
  },

  // T5 · Foundation Growing Out of the Weak Zone
  trajectory_D_T5_foundation_out_of_weak: {
    name: "Foundation Growing Out of the Weak Zone",
    description:
      "The latest results moved the balance-sheet reading out of weak territory — a real improvement from a low base, and the most consistent of the single-pillar improvements observed. Notably it is the small gains that carried this: large jumps in the same reading did not.",
    family: "D",
    concern: "trajectory",
    status: "live",
  },

  // T6 · Momentum Breaking Into Weak
  trajectory_B_T6_momentum_breaking_into_weak: {
    name: "Momentum Breaking Into Weak",
    description:
      "The operating trajectory has broken into weak territory. The balance sheet may still be intact, but the direction of the business has changed. This reading is located at the trajectory pillar's own weak mark rather than a borrowed one — measured at the wrong threshold, the same condition reads the opposite way.",
    family: "B",
    concern: "trajectory",
    status: "live",
  },

  // T7 · Momentum Improving While Still Weak
  trajectory_D_T7_momentum_improving_while_weak: {
    name: "Momentum Improving While Still Weak",
    description:
      "Still weak, but improving — the trajectory has turned up from a low base, the earliest point at which a recovery becomes visible in the numbers. On the larger improvements the price has usually already moved by the time the reading catches up.",
    family: "D",
    concern: "trajectory",
    status: "live",
  },

  // T8 · Foundation Strong and Still Improving
  trajectory_D_T8_foundation_strong_improving: {
    name: "Foundation Strong and Still Improving",
    description:
      "An already-strong business that is still strengthening — the balance-sheet reading sits above its strong mark and has risen again. Uncommon, and one of the more consistent positive readings on the strong side of the range.",
    family: "D",
    concern: "trajectory",
    status: "live",
  },

  // T9 · Foundation Weak and Still Declining
  trajectory_B_T9_foundation_weak_declining: {
    name: "Foundation Weak and Still Declining",
    description:
      "A business that was already weak is continuing to deteriorate. Not a dramatic break — steady erosion from a low base. Of all the trajectory readings tested, this one had the poorest odds of the price holding up: roughly two-thirds of cases fell.",
    family: "B",
    concern: "trajectory",
    status: "live",
  },

  // ═════════════════════════════════════════════════════════════════════════════════════════════════
  // Family C · THE DIVERGENCE FAMILY — Vytal_Divergence_Tool_Spec Parts 2–3.
  // Two pillars disagreeing. Seven patterns (D1–D7) + one state (S2). Display-only; nothing rescores.
  // Descriptions describe THE COMPANY, never the scoring mechanism, and carry no return claim — the
  // measured figures live in each rule's evidence and are spoken by the verdict, gated where the
  // spec gates them (D1/D2's shared n=79 inheritance, D3/D4's ±8 register, D5's n=5 caveat).
  // ═════════════════════════════════════════════════════════════════════════════════════════════════

  // S1 · Aligned — No Tension — ★ NEVER EMITTED. The study's neutral CONTROL (−0.1%, 49% positive,
  //     n=226), read directly by the divergence tool (findings/divergence/aligned.ts) and never
  //     persisted as a fired finding. No custom doesntMean: inherits family C's mandatory line like
  //     every other divergence entry — S1 is a divergence-tool reading like the rest, and authoring a
  //     bespoke boundary line was not asked for and is not needed to give it a real catalogue home.
  divergence_S1_aligned: {
    name: "Aligned — No Tension",
    description:
      "The market's view and the business's condition agree. Nothing is unresolved. This is a genuinely useful reading, not an empty one — most of a screening tool's value is telling you where you do not need to look.",
    family: "C",
    concern: "trajectory",
    status: "never_emitted",
  },

  // D1 · Price Ahead of Quality — Market vs Foundation, the re-rating story
  divergence_D1_price_ahead_quality: {
    name: "Price Ahead of Quality",
    description:
      "The market is paying far more than the underlying quality of the business justifies. Foundation is a slow-moving read on how fundamentally sound a company is, so when price runs away from it the market is changing what it is willing to pay for a given level of quality. A re-rating story — structural and slower-moving.",
    family: "C",
    concern: "trajectory",
    status: "live",
  },

  // D2 · Price Ahead of Trajectory — Market vs Momentum, the expectations story
  divergence_D2_price_ahead_trajectory: {
    name: "Price Ahead of Trajectory",
    description:
      "The market is pricing a turn the results have not delivered. Momentum reads how the business is trending right now, so a gap here is about earnings expectations rather than quality. Faster-moving and noisier than the quality version, and more likely to resolve quickly in either direction, because a single set of results can close it.",
    family: "C",
    concern: "trajectory",
    status: "live",
  },

  // D3 · Ownership Building Against a Weak Foundation
  divergence_D3_ownership_building_weak_foundation: {
    name: "Ownership Building Against a Weak Foundation",
    description:
      "Institutions are increasing their stake in a business whose published fundamentals look weak. That is a deliberate, costly decision taken against the visible evidence, which is what makes it informative — someone with a better view is putting real money behind a thesis the numbers do not yet reflect.",
    family: "C",
    concern: "ownership",
    status: "live",
  },

  // D4 · Ownership Exiting a Healthy Business
  divergence_D4_ownership_exiting_healthy: {
    name: "Ownership Exiting a Healthy Business",
    description:
      "Institutions have cut their position while the business still reads as healthy on the published numbers. The exit tends to precede the deterioration showing up in the financials.",
    family: "C",
    concern: "ownership",
    status: "live",
  },

  // D5 · Laggard Catching Up
  divergence_D5_laggard_catching_up: {
    name: "Laggard Catching Up",
    description:
      "A fundamentally sound business whose trajectory had fallen behind is now turning up. The weaker pillar is converging toward the stronger one — and the direction of convergence is the whole point, because the same improvement moving away from a weak base reads very differently.",
    family: "C",
    concern: "trajectory",
    status: "live",
  },

  // D6 · Quality Rolling Over
  divergence_D6_quality_rolling_over: {
    name: "Quality Rolling Over",
    description:
      "A high-quality business the market has already priced as high-quality, whose only fresh input — the trajectory — has turned down. When quality is fully priced in, there is no upside surprise left to deliver, and a cooling trajectory is the thing that tends to matter.",
    family: "C",
    concern: "trajectory",
    status: "live",
  },

  // D7 · Trajectory Breaking While the Base Holds
  divergence_D7_trajectory_breaking_base_holds: {
    name: "Trajectory Breaking While the Base Holds",
    description:
      "The balance sheet is still intact but the operating trajectory has broken into weakness. This is early — the base has not deteriorated yet, but the direction has changed. The intact balance sheet does not cushion it.",
    family: "C",
    concern: "trajectory",
    status: "live",
  },

  // S2 · Sticky Divergence — a STATE, no return claim attached
  divergence_S2_sticky_divergence: {
    name: "Sticky Divergence",
    description:
      "Foundation and Momentum have disagreed materially for more than one reading and are not converging. At this distance neither pillar reliably closes the gap at the next reading. The tension is real and unresolved — the state is readable, the timing is not.",
    family: "C",
    concern: "trajectory",
    status: "live",
  },

  // C · Divergence (consolidated) — ★ SYNTHESISED, never emitted. See divergence.ts for the §5C rule
  //     that produces it from the price-ahead sub-types (D1/D2), which co-fire on the same stock.
  divergence_consolidated: {
    name: "Divergence",
    description:
      "Two or more pillar reads of this company disagree materially. The parts of the score are telling different stories about the same business.",
    family: "C",
    concern: "trajectory",
    status: "synthesised",
  },

  // D · Recovery from Weakness — ⚠ RETIRED. Its pillar loop broke on first match, so a multi-pillar
  //     recovery persisted ONE finding naming ONE pillar. Replaced by T1/T4/T5/T7/T8 as independent
  //     per-pattern rules, which makes that defect unrepresentable.

  // F1 · Atypical Composition
  composition_F1_atypical: {
    name: "Atypical Composition",
    description:
      "The four pillars are distributed unusually for a company at this score. The same composite can be built from very different mixes, and this one isn't the typical shape for its band.",
    family: "F",
    concern: "trajectory",
    status: "live",
  },

  // F2 · Composition Shift
  trajectory_F2_composition_shift: {
    name: "Composition Shift",
    description:
      "The overall score held steady since the last snapshot, but the mix beneath it moved — either one pillar shifted markedly, or a different pillar is now the strongest of the four. What's driving the number has changed, even though the number hasn't.",
    family: "F",
    concern: "trajectory",
    status: "live",
  },

  // G · Convergence — ⚠ RETIRED (narrowing spread is EXCLUDED: +0.2%, 51% positive, n=239).
  //     Absent by design. Its resolution TYPING survives as findings/divergence/resolution.ts.

  // H · Ownership Events
  ownership_H_block_events: {
    name: "Ownership Events",
    description:
      "A significant block or bulk deal was recorded in the last quarter. An ownership event worth noting as flow and risk context.",
    family: "H",
    concern: "ownership",
    status: "live",
  },

  // I · Band Transition — ⚠ RETIRED. It fired the composite ↓62 crossing, which is on the spec's
  //     EXCLUDED list (+5.4%, bull-masked), and composite ↑68, which is untested. The one composite
  //     down-cross that survived the phase split is at 74, and that is T3.
};

/**
 * THE REGISTRY. Total over StockFindingKey — a key in the vocabulary with no copy above does not
 * compile. `doesntMean` is resolved at build time (§2 order: the finding's OWN line → its family's
 * mandatory line), so every served entry carries a non-empty boundary with no resolution left to the
 * consumer.
 */
// ⚠ TOTAL NOW, so the `?? null` at the assignment below is unreachable — kept only because the
//   index signature is `string` and TypeScript cannot see that. Every key resolves to a record.
const FACTS_BY_KEY: Readonly<Record<string, FactsFor<StockFindingKey> | undefined>> = FINDING_FACTS;

export const STOCK_FINDINGS: StockFindingRegistry = Object.freeze(
  Object.fromEntries(
    STOCK_FINDING_KEYS.map((key) => {
      const c = COPY[key];
      const entry: StockFindingEntry = {
        registry: "stock_finding",
        key,
        name: c.name,
        description: c.description,
        family: c.family,
        concern: c.concern,
        status: c.status,
        doesntMean: c.doesntMean ?? FAMILY_DOESNT_MEAN[c.family],
        // ⚠ LAST, deliberately. serialise.ts strips this field to build the wire document, and the
        // document's hash (the ETag, and the version the frontend fallback is pinned to) is taken
        // over JSON with insertion order intact — so a field appended and then removed leaves the
        // served bytes byte-identical to before this build.
        facts: FACTS_BY_KEY[key]!,
      };
      return [key, entry];
    }),
  ) as StockFindingRegistry,
);

// ── resolvers · the contract the frontend's four functions are repointed at (Stage 5) ──────────────

const isKnown = (key: string): key is StockFindingKey => key in STOCK_FINDINGS;

/**
 * The spec display name for a flag/pattern key. Falls back to a humanized form of the raw key for
 * unknown/future keys — byte-identical to the frontend's `findingName`, including the prefix strip.
 */
export function findingName(key: string): string {
  if (isKnown(key)) return STOCK_FINDINGS[key].name;
  return key
    .replace(/^(?:ownership|momentum|foundation|fundamentals|trajectory|divergence|composition)_/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Static description, or null for a key the catalogue does not carry (a composed `lens_*` key
 *  resolves through lens-faces.ts instead — never through here). */
export function findingDescription(key: string): string | null {
  return isKnown(key) ? STOCK_FINDINGS[key].description : null;
}

/** Concern bucket for Hub grouping. Null when unknown — the caller decides placement, never invents. */
export function findingConcern(key: string): FindingConcern | null {
  return isKnown(key) ? STOCK_FINDINGS[key].concern : null;
}

export function findingFamily(key: string): FindingFamily | null {
  return isKnown(key) ? STOCK_FINDINGS[key].family : null;
}

/**
 * The interpretive boundary for ANY key — registry member, composed lens key, or unknown.
 * Resolution order is the frontend's, unchanged:
 *   composed lens key → its lens boundary
 *   registry member   → its own line (Family N) → its family's mandatory line
 *   anything else     → the family the KEY SHAPE resolves to (FAMILY_DOESNT_MEAN is total, so this
 *                       is never empty)
 */
export function doesntMean(key: string): string {
  const lens = /^lens_(lm3|lm7|lp2|lp5)_/.exec(key);
  if (lens) return LENS_DOESNT_MEAN[lens[1]] ?? FAMILY_DOESNT_MEAN.E;
  if (isKnown(key)) return STOCK_FINDINGS[key].doesntMean;
  return FAMILY_DOESNT_MEAN[familyOf(key)];
}
