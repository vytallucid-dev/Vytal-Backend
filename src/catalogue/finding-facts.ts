// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FINDING FACTS — every finding's declared facts, total over all 53 keys. The other half of
// pattern-facts.ts, and under the same authority.
//
// ── ★ WHY THIS FILE, AND WHY IT IS AN EXTENSION RATHER THAN A REPLACEMENT ─────────────────────────
// `PATTERN_FACTS` covers 18 keys — the divergence D/S family and the trajectory T family. That was
// never an oversight: those eighteen are the STUDIED patterns, and the record's fields are the shape
// of a study (`gapFloor`, `evidencedTier`, `regimeMap`, `evidenceStats`, `confidence`). A red flag has
// none of that. R1 has no regime map because nobody has measured whether promoter pledging reads
// differently in a bull market, and no `evidenceStats` because it was never back-tested. Forcing R1 to
// declare `regimeMap: { HOT: "reads_true", … }` would MANUFACTURE a measured claim — the precise thing
// this catalogue exists to prevent.
//
// But the other 35 findings do have facts, and they had nowhere to live:
//   · every rule's THRESHOLD sat as a bare `export const` in its own file — R1_PLEDGE_RATIO_PCT = 50,
//     R4_DE_THRESHOLD = 3.0, N7_RATIO_PCT = 50 — one home each, and no way to ask the catalogue what a
//     finding fires at.
//   · no DISPLAY PRECISION at all, which is why r1-pledging.ts was the one rule of 53 that stamped an
//     unrounded number and the page printed 51.367518980187285 beside a tidy 59.1.
//
// ── ★ WHAT WAS DONE: EXTENDED, NOT RESTRUCTURED ──────────────────────────────────────────────────
// The 18 measured records are UNTOUCHED and are re-exported through here as-is. `FINDING_FACTS` is
// their union with 35 new `UnmeasuredFacts` records, so:
//
//   FINDING_FACTS.divergence_S2_sticky_divergence.gapFloor   →  number   (unchanged, still narrowed)
//   FINDING_FACTS.ownership_R1_pledge.thresholds.pledgeRatioPct → number (new)
//   FINDING_FACTS.ownership_R1_pledge.gapFloor               →  compile error, correctly
//
// The alternative — one flat shape with every field nullable — was rejected: it would make
// `FACTS.gapFloor` a `number | null` at all 16 rule sites that currently read it as a `number`, which
// is exactly the compile-time binding pattern-facts.ts's header defends at length. Extension keeps
// that and costs the rules nothing: not one of the 16 changed.
//
// ── ★ WHY `thresholds` IS A NAMED BAG AND NOT TYPED FIELDS ───────────────────────────────────────
// The 18 measured records have typed fields because their bars are the SAME KIND of bar across the
// family — every divergence pattern has a gap floor, every trajectory pattern an evidenced tier. The
// 35 do not: R4 fires on a debt/equity multiple, N6 on a count of quarters, P8 on a growth spread in
// percentage points, H on a rupee value. Inventing a union wide enough to type all of them would
// produce a shape where nearly every field is null on nearly every record — the same all-nullable
// flattening rejected above, one level down.
//
// ⚠ THE 18 CARRY NO `thresholds` BAG AT ALL, AND THAT IS NOT AN OMISSION. Their bars are declared as
// typed fields on PatternFacts — `gapFloor`, `legs`, `evidencedTier` — and that is the home. A second
// generic bag holding the same numbers is precisely the duplicate this module exists to end, so the
// field is ABSENT rather than empty: `FINDING_FACTS.divergence_S2_sticky_divergence.thresholds` does
// not compile, which sends the reader to `.gapFloor` instead of to an empty object.
//
// ⚠ EVERY NUMBER BELOW IS A RELOCATION, NOT A RECALIBRATION. Each was transcribed from the rule's own
// constant at its current value, and scripts/verify-evidence-facts.ts re-derives every finding on
// every stock and fails on any changed fired state or evidence value. Moving a number and changing it
// are different commits.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { PATTERN_FACTS, type PatternKey } from "./pattern-facts.js";
// ★ TYPE-ONLY, AND THAT IS LOAD-BEARING. stock-findings.ts imports FINDING_FACTS from here at RUNTIME
//   to build each entry's `facts`, so a runtime import back the other way would close a module cycle —
//   and the totality assertion at the foot of this file would then run against a half-initialised
//   STOCK_FINDING_KEYS. `import type` is erased, so the cycle exists only for the type checker, which
//   handles it. Totality is proved by the `satisfies` clauses below, which is the stronger check.
import type { StockFindingKey } from "./stock-findings.js";
import type { UnmeasuredFacts } from "./types.js";

/**
 * The facts a finding has whether or not it was ever studied — re-exported from types.ts, where it is
 * declared beside the `StockFindingEntry` that references it (that placement is what keeps the
 * catalogue's type graph acyclic; the VALUES are here).
 */
export type { UnmeasuredFacts } from "./types.js";

/** What `FINDING_FACTS[K]` resolves to: the measured record for the 18, the unmeasured one otherwise. */
export type FactsFor<K extends StockFindingKey> = K extends PatternKey
  ? (typeof PATTERN_FACTS)[K]
  : UnmeasuredFacts;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE 35 UNMEASURED RECORDS.
//
// `satisfies`, not `:`, for the same reason pattern-facts.ts uses it — an annotation would widen every
// threshold to `number` on a `Record<string, number>` index and lose the named-key narrowing, so
// `FACTS.thresholds.pledgeRatioPct` would compile even after the key is renamed. With `satisfies` a
// typo is a compile error at the rule that reads it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const UNMEASURED = {
  // ── A · RED FLAGS ───────────────────────────────────────────────────────────────────────────────
  // R1 · pledging. Both bars from scoring/ownership/pledging.ts, which N7 reads too — one home now
  // serves both, which is what made the R1/N7 symmetry a structural property instead of a comment.
  ownership_R1_pledge: {
    displayPrecision: 1,
    thresholds: { pledgeRatioPct: 50, qoqRisePp: 10 },
  },
  ownership_R2_promoter_exit: {
    displayPrecision: 2,
    thresholds: { dropPp: 5 },
  },
  foundation_R3_earnings_quality: {
    displayPrecision: 1,
    thresholds: { minConsecutiveYears: 4 },
  },
  foundation_R4_debt_explosion: {
    displayPrecision: 2,
    thresholds: { deRatio: 3.0, windowYears: 5 },
  },
  foundation_R5_interest_coverage: {
    displayPrecision: 2,
    thresholds: { interestCoverage: 1.5, minConsecutiveQuarters: 2 },
  },
  ownership_R6_distribution: {
    displayPrecision: 2,
    thresholds: {},
  },

  // ── E · PATTERNS (P-series) ─────────────────────────────────────────────────────────────────────
  // P1 and P4 declare no bars of their own: both read the shared ownership flow helpers, which own
  // their own materiality floors. An empty bag is the honest record — not "we forgot".
  ownership_P1_clean_rotation: { displayPrecision: 2, thresholds: {} },
  ownership_P4_dual_exit: { displayPrecision: 2, thresholds: {} },
  ownership_P5_insider_distress: {
    displayPrecision: 1,
    thresholds: { minNetSellCr: 2, minSellers: 1, distressComposite: 62 },
  },
  ownership_P6_insider_conviction: {
    displayPrecision: 1,
    thresholds: { windowDays: 90, eligibleTxnCr: 1, minNetCr: 2, minBuyers: 1 },
  },
  foundation_P7_accruals: {
    displayPrecision: 1,
    thresholds: { cashBackMax: 0.5 },
  },
  foundation_P8_receivables: {
    displayPrecision: 1,
    thresholds: { outpacePp: 15, minRecvGrowthPct: 10, minRecvToRev: 0.05 },
  },
  ownership_P10_promoter_defense: {
    displayPrecision: 1,
    thresholds: { minNetCr: 2 },
  },
  momentum_P11_margin_compression: {
    displayPrecision: 1,
    thresholds: { minDeclines: 2 },
  },
  momentum_P12_margin_recovery: {
    displayPrecision: 1,
    thresholds: { minRises: 2 },
  },
  momentum_P13_revenue_inflection: {
    displayPrecision: 1,
    thresholds: { inflectionPp: 5 },
  },

  // ── F / H · STRUCTURAL CARDS ────────────────────────────────────────────────────────────────────
  composition_F1_atypical: {
    displayPrecision: 0,
    thresholds: { deviationPp: 25 },
  },
  trajectory_F2_composition_shift: {
    displayPrecision: 0,
    thresholds: { compositeHold: 3, shiftPp: 8 },
  },
  ownership_H_block_events: {
    displayPrecision: 0,
    thresholds: { windowDays: 90, minDealCr: 1 },
  },
  // The read layer's own consolidation of a fired C-family set. It has no rule and therefore no bars;
  // its numbers are the sub-types' own, at their own precision.
  divergence_consolidated: { displayPrecision: 1, thresholds: {} },

  // ── N · NOTABLE (the constructive twins) ────────────────────────────────────────────────────────
  // Each mirrors its negative sibling's bar, which is why the numbers repeat: N2 mirrors P8's 15pp,
  // N7 mirrors R1's 10pp/50%. They are declared per-record rather than cross-referenced because the
  // symmetry is a design decision that could be revisited per pattern, not an identity.
  foundation_N1_cash_backed_earnings: {
    displayPrecision: 1,
    thresholds: { minYears: 3, ocfToNetProfitMin: 1.0 },
  },
  foundation_N2_working_capital: {
    displayPrecision: 1,
    thresholds: { underpacePp: 15, minYears: 2, minRecvToRev: 0.05 },
  },
  foundation_N3_deleveraging: {
    displayPrecision: 2,
    thresholds: { minYears: 3, minAbsoluteDecline: 0.5, minRelativeDecline: 0.25 },
  },
  foundation_N4_coverage_strengthening: {
    displayPrecision: 2,
    thresholds: { minRises: 2, lowBaseMax: 3.0 },
  },
  ownership_N5_dual_institutional_build: {
    displayPrecision: 2,
    thresholds: { minMovePp: 0.5 },
  },
  ownership_N6_promoter_accumulation: {
    displayPrecision: 2,
    thresholds: { minQuarters: 2, minCumulativePp: 1.0 },
  },
  ownership_N7_pledge_release: {
    displayPrecision: 1,
    thresholds: { qoqFallPp: 10, ratioPct: 50 },
  },
} as const satisfies Record<Exclude<StockFindingKey, PatternKey>, UnmeasuredFacts>;

/**
 * ★ EVERY FINDING'S FACTS, ONE LOOKUP, TOTAL OVER ALL 53.
 *
 * The 18 measured entries ARE `PATTERN_FACTS`' own objects — the same references, not copies — so
 * there is nothing here that can drift from them.
 */
export const FINDING_FACTS = { ...PATTERN_FACTS, ...UNMEASURED } as const satisfies Record<
  StockFindingKey,
  { readonly displayPrecision: number }
>;

/** Does this key carry a measured study record (the 18), rather than only universal facts? */
export const isMeasuredPattern = (key: string): key is PatternKey => key in PATTERN_FACTS;

/**
 * ★ THE PRECISION A FINDING'S NUMBERS ARE PRINTED AT, resolved for any key.
 *
 * Falls back to 1 for a key outside the vocabulary — the composed `lens_*` keys, which are unbounded
 * by construction (catalogue/lens-faces.ts) and carry no record. That is a real default, not a silent
 * one: a lens card's evidence is a self-contained sentence and renders no numeric pips at all, so the
 * value is never actually reached for them.
 */
export const findingPrecision = (key: string): number =>
  (FINDING_FACTS as Record<string, { displayPrecision: number } | undefined>)[key]?.displayPrecision ?? 1;

// ── ★ TOTALITY IS PROVED AT COMPILE TIME, BY THE TWO `satisfies` CLAUSES ABOVE ────────────────────
// `UNMEASURED satisfies Record<Exclude<StockFindingKey, PatternKey>, UnmeasuredFacts>` fails to compile
// if any of the 35 is missing; `FINDING_FACTS satisfies Record<StockFindingKey, …>` closes the union.
// There is deliberately NO runtime assertion here — it would need STOCK_FINDING_KEYS as a value, and
// that import is the module cycle the header note above refuses. scripts/verify-evidence-facts.ts
// re-checks totality against the live vocabulary anyway, which is the check that can actually drift.
