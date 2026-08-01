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
import type {
  FindingConcern,
  FindingFamily,
  KeyStatus,
  Registry,
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
  // B/C/D/F/G/H/I · structural cards
  "trajectory_B_deterioration",
  "divergence_C1_price_ahead",
  "divergence_C2_ownership_vs_fundamentals",
  "divergence_C3_floor_trajectory_split",
  "divergence_C_over_time_widening",
  "divergence_consolidated",
  "trajectory_D_recovery",
  "composition_F1_atypical",
  "trajectory_F2_composition_shift",
  "trajectory_G_convergence",
  "ownership_H_block_events",
  "trajectory_I_band_transition",
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

// ── per-family "doesn't mean" interpretive boundary (File 1 §5, verbatim) ──────────────────────────
// TOTAL BY CONSTRUCTION (amendment §2): every family MUST carry a boundary line, so this is a total
// Record<FindingFamily, …> — a missing family is a COMPILE error, not a runtime blank. Family N's line
// is spec copy, imported from n-family-copy.ts, never authored here.
export const FAMILY_DOESNT_MEAN: Readonly<Record<FindingFamily, string>> = {
  A: "a hard risk/quality warning to investigate — not a prediction the stock will fall.",
  B: "review your thesis, not sell — an early risk read, not a price call.",
  C: "you read the state, you can't time the resolution — divergences are sticky; the bill is due, never that it's due today.",
  D: "a coincident health inflection worth investigating — not a buy, not a guaranteed continuation; strongest read against a calm pond.",
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

  // B · Deterioration from a High Base
  trajectory_B_deterioration: {
    name: "Deterioration from a High Base",
    description:
      "The composite, or one pillar, has crossed down out of strong territory and stayed there across at least two snapshots. A company that was solid is sliding — a change in risk profile that usually shows up before price reacts.",
    family: "B",
    concern: "trajectory",
    status: "live",
  },

  // C1 · Price Ahead of Fundamentals
  divergence_C1_price_ahead: {
    name: "Price Ahead of Fundamentals",
    description:
      "The Market read sits well above what Foundation and Momentum support. Price has run ahead of the business underneath it.",
    family: "C",
    concern: "trajectory",
    status: "live",
  },

  // C2 · Ownership Against Fundamentals
  divergence_C2_ownership_vs_fundamentals: {
    name: "Ownership Against Fundamentals",
    description:
      "Ownership behaviour contradicts the fundamentals — either owners are stepping back from a business that looks sound, or building into one that looks weak. Both are worth understanding; the second is the classic smart-money tell.",
    family: "C",
    concern: "trajectory",
    status: "live",
  },

  // C3 · Floor–Trajectory Split
  divergence_C3_floor_trajectory_split: {
    name: "Floor–Trajectory Split",
    description:
      "Foundation and Momentum are far apart — a sound balance sheet with deteriorating trends, or improving trends built on a weak base. What the company is and where it's heading disagree.",
    family: "C",
    concern: "trajectory",
    status: "live",
  },

  // C · Divergence Widening (over time)
  divergence_C_over_time_widening: {
    name: "Divergence Widening",
    description:
      "The gap between how this company's share price reads and what the business underneath supports was already notable, and has widened further over recent snapshots. Price and fundamentals are drifting further apart rather than converging.",
    family: "C",
    concern: "trajectory",
    status: "live",
  },

  // C · Divergence (consolidated) — ★ SYNTHESISED, never emitted. See divergence.ts for the §5C rule
  //     that produces it from the four C sub-types above.
  divergence_consolidated: {
    name: "Divergence",
    description:
      "Two or more pillar reads of this company disagree materially. The parts of the score are telling different stories about the same business.",
    family: "C",
    concern: "trajectory",
    status: "synthesised",
  },

  // D · Recovery from Weakness
  trajectory_D_recovery: {
    name: "Recovery from Weakness",
    description:
      "The composite, or one pillar, has turned up out of weak territory and held the improvement. In this program's testing, recovery from weakness has been the most durable signal observed — stated descriptively, not as a forecast.",
    family: "D",
    concern: "trajectory",
    status: "live",
  },

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

  // G · Convergence
  trajectory_G_convergence: {
    name: "Convergence",
    description:
      "A pillar gap that was previously notable has narrowed. Which way it closed matters: the laggard rising is a different story from the leader falling.",
    family: "G",
    concern: "trajectory",
    status: "live",
  },

  // H · Ownership Events
  ownership_H_block_events: {
    name: "Ownership Events",
    description:
      "A significant block or bulk deal was recorded in the last quarter. An ownership event worth noting as flow and risk context.",
    family: "H",
    concern: "ownership",
    status: "live",
  },

  // I · Band Transition
  trajectory_I_band_transition: {
    name: "Band Transition",
    description:
      "The composite crossed into Healthy on the way up, or into Below-par on the way down — the two boundaries either side of the middle of the scale.",
    family: "I",
    concern: "trajectory",
    status: "live",
  },
};

/**
 * THE REGISTRY. Total over StockFindingKey — a key in the vocabulary with no copy above does not
 * compile. `doesntMean` is resolved at build time (§2 order: the finding's OWN line → its family's
 * mandatory line), so every served entry carries a non-empty boundary with no resolution left to the
 * consumer.
 */
export const STOCK_FINDINGS: Registry<StockFindingKey, StockFindingEntry> = Object.freeze(
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
      };
      return [key, entry];
    }),
  ) as Record<StockFindingKey, StockFindingEntry>,
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
