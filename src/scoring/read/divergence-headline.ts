// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RULING 3's HEADLINE STATE, AND THE FIRED FINDING'S OWN PAIR. ONE HOME. PURE.
//
// ── ★ WHAT THIS REPLACES, AND WHY IT WAS WRONG IN FOUR PLACES ─────────────────────────────────────
// health-view.service.ts, universe-view.service.ts, peer-group-view.service.ts and the frontend's
// `pickScoredPair` each did the same thing independently: sort the scored pillar subtotals, take the
// extremes, call that "the divergence", and band the distance at 15/25.
//
// Two defects, both structural:
//
//   ① THE PAIR IS CHOSEN WITHOUT REFERENCE TO THE FINDING. IOC fires S2 — Foundation ↔ Momentum,
//      30.6 apart — while its WIDEST pair is Foundation ↔ Market. The chart drew Market, the verdict
//      said Momentum, on one card. A reader comparing the two is looking at two different facts and
//      has no way to know it.
//
//   ② IT BANDS THE RESULT. notable ≥15 / wide ≥25 is a THIRD severity scale, competing with §1.2's
//      12/16/25 tiers (which the rules actually fire on) and with S1's ≤7 ceiling. A stock could read
//      "none" here while carrying a fired S2.
//
// ── ★ RULING 3 — THREE STATES, IN ORDER, AND THE MIDDLE ONE DID NOT EXIST ─────────────────────────
//   1. aligned          spread ≤ S1's ceiling (7)              — the measured CONTROL
//   2. no_pattern       spread past the ceiling, nothing fired — the 8–11 minor band, or a ≥12 spread
//                                                                on a pair no rule names
//   3. patterns_firing  one or more divergence findings stand
//
// Every surface ran `lead ? patterns : Aligned` — a two-way branch over a three-way fact — so state 2
// rendered as state 1. GLENMARK carries a 49-point Market↔Foundation spread and no LIVE divergence
// finding (its rows are the retired C-family), and read "Aligned — no tension".
//
// ⚠ ORDER MATTERS AND IS NOT COMMUTATIVE. `aligned` is tested FIRST and is a statement about the
// spread alone. A stock cannot be both aligned and diverged — that is a theorem, not a rule
// (aligned.ts proves it: spread ≤ 7 makes any pair ≥ 12 impossible) — but testing firing first would
// silently rely on the theorem instead of asserting it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { STOCK_FINDINGS } from "../../catalogue/stock-findings.js";
import { isPatternKey, PATTERN_FACTS } from "../../catalogue/pattern-facts.js";
import { isRetiredFinding } from "../../catalogue/retired-findings.js";
import { severityWeight } from "../../catalogue/divergence.js";
import { roundToPrecision } from "../findings/format.js";
import type { Pillar } from "../composite/types.js";
import type { DivergenceHeadline, DivergencePair, PillarKey } from "./health-view.types.js";

/** S1's ceiling, from S1's own record. ⚠ `gapFloor` bounds from ABOVE on that one record. */
export const ALIGNED_MAX: number = STOCK_FINDINGS.divergence_S1_aligned.facts.gapFloor;

/** The divergence family — the findings whose headline Ruling 3 is about. */
const isDivergenceKey = (key: string): boolean =>
  !isRetiredFinding(key) && STOCK_FINDINGS[key as keyof typeof STOCK_FINDINGS]?.family === "C";

export interface ScoredPillar {
  pillar: PillarKey;
  subtotal: number;
}

/** max − min across scored pillars — S1's own input. Null with fewer than two scored pillars. */
export function pillarSpreadOf(scored: readonly ScoredPillar[]): number | null {
  if (scored.length < 2) return null;
  const vals = scored.map((p) => p.subtotal);
  return roundToPrecision(Math.max(...vals) - Math.min(...vals), 4);
}

/**
 * ★ RULING 3, EVALUATED IN ORDER. `firingDivergenceKeys` must already have retired keys dropped —
 * a retired row is not a firing finding, and letting one in would report `patterns_firing` for a rule
 * that cannot fire again.
 */
export function headlineOf(spread: number | null, firingDivergenceKeys: readonly string[]): DivergenceHeadline {
  if (spread !== null && spread <= ALIGNED_MAX) return "aligned";
  return firingDivergenceKeys.length > 0 ? "patterns_firing" : "no_pattern";
}

/**
 * The pair ONE finding names, high/low resolved against the current pillars.
 *
 * Returns null when the record's `pillarPair` is not exactly two REAL pillars — the composite
 * patterns (T1–T4) and the single-pillar ones (T5–T9) genuinely have no pair, and S1 names all four.
 * Null is the honest answer; a surface must not substitute the widest pair for it.
 */
export function pairOf(
  patternKey: string,
  scored: readonly ScoredPillar[],
): DivergencePair | null {
  if (!isPatternKey(patternKey)) return null;
  const facts = PATTERN_FACTS[patternKey];
  const names = facts.pillarPair;
  if (names.length !== 2) return null;
  if (names.some((n) => n === "composite")) return null;

  const byPillar = new Map(scored.map((p) => [p.pillar, p.subtotal]));
  const a = byPillar.get(names[0] as Pillar as PillarKey);
  const b = byPillar.get(names[1] as Pillar as PillarKey);
  if (a === undefined || b === undefined) return null; // a pillar the pattern needs is not scored now

  const [hiName, hiVal, loName, loVal] =
    a >= b
      ? [names[0], a, names[1], b]
      : [names[1], b, names[0], a];

  return {
    patternKey,
    high: { pillar: hiName as PillarKey, subtotal: roundToPrecision(hiVal, facts.displayPrecision) },
    low: { pillar: loName as PillarKey, subtotal: roundToPrecision(loVal, facts.displayPrecision) },
    // ⚠ the DIFFERENCE is rounded at the difference precision, not the reading precision — the same
    //   split format.ts declares. A gap in prose is a whole number.
    gap: roundToPrecision(hiVal - loVal, 0),
  };
}

/**
 * ★ THE LEAD FIRING DIVERGENCE — tier first, then severity, then key for a total order.
 *
 * ⚠ IT RANKS ON THE PATTERN'S OWN TIER, NOT ON A SCRAPED `evidence.gapPp`. Only gap-basis patterns
 * carry that field, so a gapPp scrape silently sorted every crossing and movement pattern to zero.
 * The tier word is stamped by the rule from §1.2 and is null exactly where no severity gradient
 * applies — which is a fact to order by, not a hole to fill with 0.
 */
const TIER_RANK: Readonly<Record<string, number>> = { extreme: 0, stretched: 1, material: 2 };

export function leadDivergence(
  rows: readonly { patternKey: string; severity: string | null; evidence: unknown }[],
): { patternKey: string; severity: string | null; evidence: unknown } | null {
  const live = rows.filter((r) => isDivergenceKey(r.patternKey));
  if (live.length === 0) return null;
  const tierOf = (r: { evidence: unknown }): number => {
    const ev = r.evidence as { tierWord?: unknown } | null;
    const w = ev && typeof ev.tierWord === "string" ? ev.tierWord : "";
    return TIER_RANK[w] ?? 8; // no tier (crossing/movement) ranks after every tiered gap
  };
  return [...live].sort(
    (a, b) =>
      tierOf(a) - tierOf(b) ||
      severityWeight(a.severity) - severityWeight(b.severity) ||
      a.patternKey.localeCompare(b.patternKey),
  )[0];
}

/** Every firing divergence key on a row set, retired dropped. The headline's own input. */
export const firingDivergenceKeys = (rows: readonly { patternKey: string }[]): string[] =>
  rows.filter((r) => isDivergenceKey(r.patternKey)).map((r) => r.patternKey);
