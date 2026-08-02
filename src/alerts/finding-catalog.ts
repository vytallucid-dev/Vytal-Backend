// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FINDING-KEY VOCABULARY — which `findingKey` values can actually make an alert fire.
//
// ── ★ WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// A `finding` alert with a key nothing ever emits is written successfully, passes every CHECK, and is
// then evaluated — correctly — as "no match" every day for the rest of time. The reader believes they
// are armed. The UI cannot produce that state (it picks from a closed list); a chat tool taking a free
// string can, and a model asked for "the pledge one" will happily invent `pledge_rising`.
//
// ── THE VOCABULARY IS THE UNION OF TWO SOURCES, AND IT HAS TO BE ───────────────────────────────────
//   STATIC  — keys the rule engine emits as literals (src/scoring/findings/rules/**). Complete for the
//             rule families, and available with no DB read. Includes ownership_R1_pledge, which is NOT
//             a FireRule at all — it is written by the ownership persist path.
//   LIVE    — DISTINCT keys present in score_patterns / score_red_flags right now. This is what adds
//             the THREE-LENS family: those keys are COMPOSED at runtime (`lens_${lens}_${metricKey}`,
//             see lens-patterns/lens-findings.ts), so no static list can enumerate them — there are as
//             many as there are lens × metric combinations that have ever fired.
//
// Neither source alone is right. Static-only would reject every lens finding a reader can plainly see
// on the stock page. Live-only would reject a legitimate rule key that simply has not fired anywhere
// yet — which is exactly the alert most worth setting.
//
// ⚠ RETIRED KEYS ARE DELIBERATELY EXCLUDED. ruleP2/ruleP3 still have source files but are NOT in
// ALL_RULES ("RETIRED (consolidated into R6 / R1) — files kept, not registered", engine.ts). Their keys
// linger in old rows, so LIVE may surface them; STATIC must not add them, and the honest answer to
// "alert me on P2" is that it cannot fire any more.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { RETIRED_FINDING_KEYS as CATALOGUE_RETIRED_KEYS } from "../catalogue/retired-findings.js";

/**
 * Keys the engine emits, transcribed from the rule sources. ⚠ RETIRED (P2/P3) and UNBUILT (P9) are
 * absent BY DESIGN — an alert on them could never fire.
 */
export const STATIC_FINDING_KEYS: readonly string[] = [
  // A · red flags (R-series)
  "ownership_R1_pledge", // written by the ownership persist path, not a FireRule
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
  "composition_F1_atypical",
  "trajectory_F2_composition_shift",
  "ownership_H_block_events",
  // T · trajectory family (Vytal_Trajectory_Tool_Spec Parts 2–3)
  "trajectory_D_T1_recovery_low_zone",
  "trajectory_B_T2_deterioration_high_base",
  "trajectory_B_T3_falling_out_of_pristine",
  "trajectory_D_T4_recovering_out_of_below_par",
  "trajectory_D_T5_foundation_out_of_weak",
  "trajectory_B_T6_momentum_breaking_into_weak",
  "trajectory_D_T7_momentum_improving_while_weak",
  "trajectory_D_T8_foundation_strong_improving",
  "trajectory_B_T9_foundation_weak_declining",
  // C · divergence family (Vytal_Divergence_Tool_Spec Parts 2–3)
  "divergence_D1_price_ahead_quality",
  "divergence_D2_price_ahead_trajectory",
  "divergence_D3_ownership_building_weak_foundation",
  "divergence_D4_ownership_exiting_healthy",
  "divergence_D5_laggard_catching_up",
  "divergence_D6_quality_rolling_over",
  "divergence_D7_trajectory_breaking_base_holds",
  "divergence_S2_sticky_divergence",
  // N · Notable (constructive twins)
  "foundation_N1_cash_backed_earnings",
  "foundation_N2_working_capital",
  "foundation_N3_deleveraging",
  "foundation_N4_coverage_strengthening",
  "ownership_N5_dual_institutional_build",
  "ownership_N6_promoter_accumulation",
  "ownership_N7_pledge_release",
];

/**
 * Retired rules — recognised so the refusal can SAY they are retired rather than "unknown".
 *
 * ★ SINGLE-SOURCED from catalogue/retired-findings.ts. This file previously kept its own copy of the
 * list; two lists meant a key could be retired in one and live in the other, and the failure mode was
 * an alert accepted on a finding that can never fire again — permanently silent, and indistinguishable
 * from "it just hasn't triggered yet". The catalogue list is the one that also drives read-layer
 * suppression, so they cannot drift.
 *
 * ⚠ This is the one caller that must still SEE retired keys in live data (to refuse them by name),
 * which is why suppression is applied at each read boundary rather than globally on the Prisma client.
 */
// Widened to readonly string[] deliberately: callers test membership with an arbitrary user-supplied
// key (chat/tools/alerts-write.ts), which a literal-tuple type would reject at the call site.
export const RETIRED_FINDING_KEYS: readonly string[] = CATALOGUE_RETIRED_KEYS;

/** STATIC ∪ LIVE, resolved once per turn by the caller's memo (it is two cheap DISTINCT scans). */
export async function loadFindingKeys(): Promise<Set<string>> {
  const keys = new Set<string>(STATIC_FINDING_KEYS);
  try {
    const [patterns, flags] = await Promise.all([
      prisma.scorePattern.findMany({ distinct: ["patternKey"], select: { patternKey: true } }),
      prisma.redFlag.findMany({ distinct: ["flagKey"], select: { flagKey: true } }),
    ]);
    for (const p of patterns) keys.add(p.patternKey);
    for (const f of flags) keys.add(f.flagKey);
  } catch {
    // A failed live read degrades to the static list — narrower, never wider. Refusing a valid lens
    // key is a conversation; accepting an invented one is a permanently dead alert.
  }
  // Retired keys can appear in LIVE (old rows) — remove them, they cannot fire again.
  for (const k of RETIRED_FINDING_KEYS) keys.delete(k);
  return keys;
}

/** The closest known keys to what the model asked for — so a refusal can offer the real ones. */
export function suggestFindingKeys(query: string, known: Set<string>, limit = 8): string[] {
  const needle = query.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!needle) return [...known].slice(0, limit);
  const scored = [...known]
    .map((k) => {
      const flat = k.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (flat === needle) return { k, r: 0 };
      if (flat.includes(needle) || needle.includes(flat)) return { k, r: 1 };
      // any shared word ("pledge", "promoter", "margin")
      const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
      return { k, r: words.some((w) => flat.includes(w)) ? 2 : 99 };
    })
    .filter((x) => x.r < 99)
    .sort((a, b) => a.r - b.r || a.k.localeCompare(b.k));
  return scored.slice(0, limit).map((x) => x.k);
}
