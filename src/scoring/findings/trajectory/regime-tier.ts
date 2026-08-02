// File: src/scoring/findings/trajectory/regime-tier.ts
//
// THE TRAJECTORY FAMILY'S REGIME CONTRACT + THE THREE CROSS-CUTTING CONSTRAINTS. PURE.
// Vytal_Trajectory_Tool_Spec §1.4 (regime) and Part 4 (R1/R2/R3).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// §1.4 · THREE TIERS, PER PATTERN — AND WHY ONE FIELD WOULD NOT DO
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// "No global rule covers both — the regime mapping is a required field per pattern."
//
// The two Tier-1 patterns point in OPPOSITE directions, which is what makes a single undifferentiated
// "regime" field unsafe. With one field, T3 gets implemented as "show a HOT note" — when what it
// actually means is "in NORMAL there is no directional read at all, and the card must say so."
//
//                                   HOT                          NORMAL
//   T3 falling out of Pristine      −5.2%, 29% positive ✓ reads  +2.2% — NO directional read
//   T6 momentum breaking into weak  +9.6% — masked               −1.9%, 40% positive ✓ reads
//
// So the tier is declared per pattern and travels in evidence:
//
//   decides_read       the phase decides whether a directional read EXISTS (T3, T6). Ships a phase
//                      table; a phase ABSENT from it means "no directional read in this phase" —
//                      meaningful omission, never an oversight.
//   always_display     the phase must always be shown (T2). It fires in every phase, but the reader
//                      must see which phase, because T2 showed a FALSE +15% in the 2021–26 bank bull.
//   magnitude_caveat   reads across phases; magnitudes are flattered in HOT (T1/T4/T5/T7/T8/T9).
//
// ⚠ §1.4 line 87 is binding for Tier 1: "show the crossing regardless — it is a fact about the user's
// stock. But where the evidence shows no directional signal in the current phase, say so plainly
// rather than asserting a direction the data cannot support." The crossing is NEVER hidden. Only the
// directional claim is withheld.

import type { Regime } from "../../regime/regime.js";

export type RegimeTier = "decides_read" | "always_display" | "magnitude_caveat";

/** The phases in which a Tier-1 pattern has a measured directional read. A phase absent from this
 *  list is "no directional read in this phase" — a first-class output. Null for Tiers 2 and 3, which
 *  read across phases. */
export type RegimeReadPhases = readonly Regime[] | null;

/** What a rule stamps so the read layer can resolve its copy without re-deriving the contract. */
export interface RegimeContract {
  regimeTier: RegimeTier;
  /** Tier 1 only. e.g. T3 → ["HOT"], T6 → ["NORMAL"]. */
  regimeReadPhases: RegimeReadPhases;
}

export const TIER_DECIDES_READ = (phases: readonly Regime[]): RegimeContract => ({
  regimeTier: "decides_read",
  regimeReadPhases: phases,
});
export const TIER_ALWAYS_DISPLAY: RegimeContract = { regimeTier: "always_display", regimeReadPhases: null };
export const TIER_MAGNITUDE_CAVEAT: RegimeContract = { regimeTier: "magnitude_caveat", regimeReadPhases: null };

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PART 4 · R1 — REACTION DOES NOT SCALE WITH THE SIZE OF THE MOVE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// Measured, and it is the OPPOSITE of the intuitive expectation:
//   Foundation gain  1–3 pts → +1.9% sector-excess, 64% positive
//                    4–10    → −0.2%, 50%
//                    15+     → −0.5%, 50% (n=4)
//   Momentum gain    4–10    → +0.1%, 52%
//                    15+     → −1.1% same-day, 31% positive
// "The SMALLEST Foundation gains carried the cleanest positive drift; the largest carried none. The
// largest Momentum gains reacted NEGATIVELY. Big fundamental moves are the anticipated ones — they
// are already in the price."
//
// ── ★ HOW R1 IS ENFORCED, NOT MERELY ACKNOWLEDGED ─────────────────────────────────────────────────
// STRUCTURALLY: `trajectorySeverity()` takes the pattern KEY and nothing else. There is no parameter
// through which a delta could reach it, so "scale the badge by the move" is not an edit someone can
// make by accident — it requires changing this function's signature, which is review-visible.
// A rule that wanted magnitude-scaled severity would have to stop calling this and hand-roll a token,
// which scripts/verify-trajectory.ts §R1 fails on.
//
// ── ⚠ THE DELIBERATE INCONSISTENCY WITH DIVERGENCE — DO NOT "FIX" IT ──────────────────────────────
// findings/divergence/bands.ts does the exact opposite: there, severity IS the gap size (§1.2,
// 12–15 material · 16–24 stretched · 25+ extreme), because a wider divergence genuinely is a stronger
// signal. Here a bigger move is NOT a stronger signal — if anything the reverse. Two families, two
// opposite readings of magnitude, both measured. Anyone who notices the asymmetry and "harmonises"
// it will invert one of them in front of a reader. That is why each side names the other.

/** Per-pattern severity tokens. Derived from each pattern's OWN evidence strength and direction —
 *  never from how far anything moved. The read layer maps token → accent
 *  (critical|red → crit · high|amber → high · recovery|green → rec · medium|low → ctx). */
const TRAJECTORY_SEVERITY: Readonly<Record<string, string>> = {
  // ── recoveries (family D) ──
  trajectory_D_T1_recovery_low_zone: "recovery",            // 81% rose (n=26) — the strongest read
  trajectory_D_T4_recovering_out_of_below_par: "recovery",  // n NOT PRESERVED — see the T4 caveat
  trajectory_D_T5_foundation_out_of_weak: "recovery",       // 71% positive (n=31) — strongest pillar story
  trajectory_D_T7_momentum_improving_while_weak: "recovery",// 63% positive (n=19)
  trajectory_D_T8_foundation_strong_improving: "recovery",  // 69% positive (n=17)
  // ── deteriorations (family B) ──
  trajectory_B_T2_deterioration_high_base: "high",          // 79% fell (n=28) — the risk read
  trajectory_B_T3_falling_out_of_pristine: "high",          // −5.2%, 29% positive in HOT (n=7)
  trajectory_B_T6_momentum_breaking_into_weak: "medium",    // −1.9%, 40% positive in NORMAL (n=15)
  trajectory_B_T9_foundation_weak_declining: "medium",      // 36% positive (n=22) — worst ODDS, small mean
};

/**
 * The severity token for a trajectory pattern.
 *
 * ★ R1 IS ENFORCED BY THIS SIGNATURE. It accepts the key and nothing else — no delta, no magnitude,
 * no prev/now pair. There is no way to make severity depend on the size of the move without changing
 * the signature.
 */
export function trajectorySeverity(key: string): string {
  const s = TRAJECTORY_SEVERITY[key];
  if (!s) throw new Error(`trajectorySeverity: no severity declared for ${key}`);
  return s;
}

/** Every trajectory key that declares a severity — the verification script's checklist. */
export const TRAJECTORY_KEYS = Object.keys(TRAJECTORY_SEVERITY);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PART 4 · R2 — MOMENTUM DOES NOT LEAD THE COMPOSITE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// Across 39 matched pairs, a Momentum down-cross preceded the composite down-cross with a MEDIAN LEAD
// OF 0 DAYS. Momentum crossed first only 31% of the time; 49% were the same snapshot. (A ~49-day lead
// appeared only at the 70-boundary.)
// Constraint: Momentum cannot be presented as an early warning ahead of the headline score.
//
// PART 4 · R3 — PRICE FRONT-RUNS LARGE MOMENTUM IMPROVEMENTS
// Before results producing a 15+ point Momentum gain (n=30), price had ALREADY run +3.0%
// sector-excess, 70% positive — and then did nothing afterwards (−0.1%, 48%). PNB +12% before / −11%
// after; Canara +11% / +7%; Shree Cement +8% / −3%. Glenmark (flat before, +12% after) is the honest
// exception; Divi's is the counter-case.
// Constraint: for large positive Momentum moves the copy must not imply the reader is early. They are
// LATE BY CONSTRUCTION. T7 (Momentum improving while still weak) is the most exposed pattern.
//
// ── ★ HOW R2/R3 ARE ENFORCED ──────────────────────────────────────────────────────────────────────
// These are COPY constraints, so they are enforced by a copy lint rather than a type. The banned
// phrasings below are checked by scripts/verify-trajectory.ts against every trajectory description
// AND every rendered verdict, over fixture evidence — so a violation fails a gate rather than
// depending on someone remembering Part 4 during review.

/** Phrasings that would violate R2 (Momentum as early warning) or R3 (the reader is early). */
export const FORWARD_LANGUAGE_BANS: readonly { re: RegExp; rule: "R2" | "R3"; why: string }[] = [
  { re: /\bearly warning\b/i, rule: "R2", why: "Momentum does not lead the composite — median lead 0 days" },
  { re: /\bleads? the (?:composite|headline|score)\b/i, rule: "R2", why: "Momentum crossed first only 31% of the time" },
  { re: /\bahead of the (?:composite|headline|score)\b/i, rule: "R2", why: "49% of crossings are the same snapshot" },
  { re: /\bbefore the (?:composite|headline|score) (?:moves|reacts|catches)/i, rule: "R2", why: "no measured lead" },
  { re: /\bget(?:ting)? in early\b/i, rule: "R3", why: "price has already run — the reader is late by construction" },
  { re: /\byou(?:'re| are) early\b/i, rule: "R3", why: "price front-runs large Momentum improvements" },
  { re: /\bahead of the (?:market|crowd)\b/i, rule: "R3", why: "+3.0% sector-excess already run before the print" },
  { re: /\bbefore the market (?:notices|reacts|catches)/i, rule: "R3", why: "70% positive run-up precedes the pillar move" },
];

/** Scan one string for R2/R3 violations. Returns the violated rules (empty = clean). */
export function scanForwardLanguage(text: string): { rule: "R2" | "R3"; why: string; matched: string }[] {
  const out: { rule: "R2" | "R3"; why: string; matched: string }[] = [];
  for (const b of FORWARD_LANGUAGE_BANS) {
    const m = b.re.exec(text);
    if (m) out.push({ rule: b.rule, why: b.why, matched: m[0] });
  }
  return out;
}
