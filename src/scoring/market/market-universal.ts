// File: src/scoring/market/market-universal.ts
//
// UNIVERSAL MARKET PILLAR — scoring (§3 cuts + §4 saturation) and assembly (§5) with
// the §14.4 three-level renormalization cascade. PURE: no DB/IO. Takes the 7 raw
// sub-values (universal-subcomponents.ts, computed on CLEANED prices) and produces the
// pillar score, fully decomposable (CN-6).
//
// SCORING: A1/A2/B1/B3/C1/D1 reuse computeLens1 (Lens-1 anchor interpolation +
// ±10/band-width saturation) — the spec says "identical mechanic to Lens 1." Each
// sub-component's §3 cuts become a 5-bar Lens-1 set; the Distress ANCHOR (the §3 table
// only gives 4 explicit cuts + the open distress region) is one band-width below
// Concerning, which makes the set well-formed and the below-Distress saturation work.
// B2 is CATEGORICAL: the HH/HL count maps directly to the anchor scale, CAPPED at 90
// (no interpolation/saturation above — §4 documented exception).
//
// CUTS ARE UNIVERSAL (CN-1): one table, every PG, no per-PG lookup.

import { computeLens1, type AbsoluteBars } from "../lenses/lens-bars.js";
import type { BarDirection } from "../lenses/types.js";
import type { SubValue } from "./universal-subcomponents.js";

export type SubKey = "A1" | "A2" | "B1" | "B2" | "B3" | "C1" | "D1";
export type Category = "A" | "B" | "C" | "D";

// ── §3 universal cuts as Lens-1 bar sets (Distress anchor = one band-width below Concerning) ──
interface ContinuousCut { kind: "continuous"; bars: AbsoluteBars; dir: BarDirection }
interface CategoricalCut { kind: "categorical" }
export const CUTS: Record<SubKey, ContinuousCut | CategoricalCut> = {
  A1: { kind: "continuous", dir: "higher_better", bars: { excellent: 0.80, good: 0.60, acceptable: 0.40, concerning: 0.20, distress: 0.00 } },
  A2: { kind: "continuous", dir: "higher_better", bars: { excellent: 0.80, good: 0.60, acceptable: 0.40, concerning: 0.20, distress: 0.00 } },
  B1: { kind: "continuous", dir: "higher_better", bars: { excellent: 15, good: 3, acceptable: -3, concerning: -15, distress: -27 } },
  B2: { kind: "categorical" },
  B3: { kind: "continuous", dir: "higher_better", bars: { excellent: 1.0, good: 0.3, acceptable: -0.3, concerning: -1.0, distress: -1.7 } },
  C1: { kind: "continuous", dir: "higher_better", bars: { excellent: 20, good: 5, acceptable: -5, concerning: -20, distress: -35 } },
  D1: { kind: "continuous", dir: "lower_better", bars: { excellent: 0.70, good: 0.85, acceptable: 1.15, concerning: 1.30, distress: 1.45 } },
};

export const CATEGORIES: Record<Category, SubKey[]> = { A: ["A1", "A2"], B: ["B1", "B2", "B3"], C: ["C1"], D: ["D1"] };
const CAT_OF: Record<SubKey, Category> = { A1: "A", A2: "A", B1: "B", B2: "B", B3: "B", C1: "C", D1: "D" };

const bandFromScore = (s: number): string =>
  s >= 90 ? "excellent" : s >= 75 ? "good" : s >= 60 ? "acceptable" : s >= 40 ? "concerning" : "distress";

export interface ScoredSub {
  key: SubKey; category: Category;
  available: boolean;
  rawValue: number | null;
  score: number | null;
  band: string | null;
  saturated: boolean;
  capped: boolean;       // B2 hit the 90 cap
  reason: string | null; // exclusion reason (CN-6)
  detail: string | null;
}

/** Score one sub-component from its raw SubValue. B2 categorical; rest via Lens-1. */
export function scoreSubComponent(key: SubKey, v: SubValue): ScoredSub {
  const category = CAT_OF[key];
  if (!v.available || v.value === null) {
    return { key, category, available: false, rawValue: v.value, score: null, band: null, saturated: false, capped: false, reason: v.reason ?? "unavailable", detail: v.detail };
  }
  const cut = CUTS[key];
  if (cut.kind === "categorical") {
    // B2 HH/HL count → anchor scale, CAPPED at 90 (§4).
    const c = v.value;
    const score = c <= 1 ? 20 : c === 2 ? 40 : c === 3 ? 60 : c === 4 ? 75 : 90;
    return { key, category, available: true, rawValue: c, score, band: bandFromScore(score), saturated: false, capped: c >= 5, reason: null, detail: v.detail };
  }
  const l1 = computeLens1(v.value, cut.bars, cut.dir);
  return { key, category, available: true, rawValue: v.value, score: l1.score, band: l1.band, saturated: l1.saturated, capped: false, reason: null, detail: v.detail };
}

export interface CategoryRollup {
  category: Category;
  members: SubKey[];        // all sub-components in the category
  present: SubKey[];        // the scoreable ones
  available: boolean;
  score: number | null;
  withinWeights: Record<string, number>; // present sub → weight within the category (renormalized)
  renormalized: boolean;    // a sub-component was excluded → within-category renorm (cascade a)
}

export interface MarketUniversalResult {
  state: "scored" | "unavailable_redistributed";
  subtotal: number | null;
  subs: ScoredSub[];
  categories: CategoryRollup[];
  survivingCategories: Category[];
  categoryWeight: number | null;                 // effective per-surviving-category weight
  effectiveSubWeights: Partial<Record<SubKey, number>>; // % of the pillar each present sub carries
  reason: string | null;
  flags: string[];
}

/**
 * Assemble the Market pillar (§5) with the §14.4 cascade:
 *   (a) excluded sub-component → its CATEGORY renormalizes across survivors;
 *   (b) whole category empty → the PILLAR renormalizes across surviving categories;
 *   (c) < 2 of 4 categories scoreable → Market pillar EXCLUDED (composite renorm — caller).
 */
export function assembleMarketUniversal(subs: ScoredSub[]): MarketUniversalResult {
  const byKey = new Map(subs.map((s) => [s.key, s]));
  const flags: string[] = [];
  const categories: CategoryRollup[] = [];

  for (const cat of ["A", "B", "C", "D"] as Category[]) {
    const members = CATEGORIES[cat];
    const present = members.filter((k) => byKey.get(k)?.available);
    if (present.length === 0) {
      categories.push({ category: cat, members, present: [], available: false, score: null, withinWeights: {}, renormalized: false });
      flags.push(`category ${cat} empty (all of ${members.join("/")} excluded) → pillar renormalizes across surviving categories (§14.4b)`);
      continue;
    }
    const w = 1 / present.length; // equal within category, renormalized to present
    const withinWeights: Record<string, number> = {};
    let score = 0;
    for (const k of present) { withinWeights[k] = w; score += w * byKey.get(k)!.score!; }
    const renormalized = present.length < members.length;
    if (renormalized) flags.push(`category ${cat}: ${members.filter((k) => !present.includes(k)).join("/")} excluded → ${present.join("/")} renormalized to ${(w * 100).toFixed(1)}% within-category (§14.4a)`);
    categories.push({ category: cat, members, present, available: true, score, withinWeights, renormalized });
  }

  const surviving = categories.filter((c) => c.available).map((c) => c.category);

  // (c) MIN-PILLAR rule: need ≥2 of 4 categories.
  if (surviving.length < 2) {
    return {
      state: "unavailable_redistributed", subtotal: null, subs, categories, survivingCategories: surviving,
      categoryWeight: null, effectiveSubWeights: {},
      reason: `only ${surviving.length} of 4 categories scoreable (<2) → Market pillar EXCLUDED; composite renormalizes Foundation/Momentum/Ownership (§14.4c)`,
      flags,
    };
  }

  const catWeight = 1 / surviving.length; // equal across surviving categories (renorm — §14.4b)
  let subtotal = 0;
  const effectiveSubWeights: Partial<Record<SubKey, number>> = {};
  for (const c of categories) {
    if (!c.available) continue;
    subtotal += catWeight * c.score!;
    for (const k of c.present) effectiveSubWeights[k] = catWeight * c.withinWeights[k];
  }
  if (surviving.length < 4) flags.push(`pillar: surviving categories ${surviving.join("/")} renormalized to ${(catWeight * 100).toFixed(1)}% each (§14.4b)`);

  return { state: "scored", subtotal, subs, categories, survivingCategories: surviving, categoryWeight: catWeight, effectiveSubWeights, reason: null, flags };
}
