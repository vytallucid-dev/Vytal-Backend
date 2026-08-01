// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// 1f · THE §5C DIVERGENCE CONSOLIDATION RULE — ported from the frontend read layer.
//
// ── ★ WHY THIS IS A SPEC RULE AND NOT A UI CHOICE ─────────────────────────────────────────────────
// The engine can fire FOUR divergence findings on one stock (C1 price-ahead, C2 ownership-vs-
// fundamentals, C3 floor-trajectory split, C-over-time widening). File 1 §5C says the reader sees ONE
// divergence card carrying at most TWO sub-type sentences — because four cards all saying "two reads
// of this company disagree" is the same fact told four times, and a page that shouts it four times has
// mis-stated how much is wrong.
//
// The frontend implemented that (lib/findings/index.ts). The backend census did not. So today:
//
//     the Flags board says   "Divergence — 1 finding"
//     the backend census has  4 rows
//     the chat reads the census and says                        "four divergence findings"
//
// Two of our own surfaces contradicting each other in front of the same reader, about the same stock,
// in the same session. That is the bug this port closes. §5C is a rule about WHAT IS TRUE OF THE
// FINDING SET, not about how to lay out a card, so it belongs where the finding set is assembled.
//
// ── PURE, PRESENTATION-FREE ────────────────────────────────────────────────────────────────────────
// This module knows nothing about accents, order ranks as CSS, evidence rendering or React. It answers
// three questions and nothing else:
//     which keys are divergence sub-types?
//     given a fired set, do they consolidate — and into what?
//     where does the consolidated row sort?
// The frontend's `consolidateDivergence` / `consolidateCensusDivergence` keep their own presentation
// assembly; they are repointed at THIS predicate + THIS ordering at Stage 5, so the two can no longer
// drift apart even in principle.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { StockFindingKey } from "./stock-findings.js";

/** The four sub-types the engine can fire. Consolidation is defined over exactly these. */
export const DIVERGENCE_SUB_TYPE_KEYS = [
  "divergence_C1_price_ahead",
  "divergence_C2_ownership_vs_fundamentals",
  "divergence_C3_floor_trajectory_split",
  "divergence_C_over_time_widening",
] as const;

export type DivergenceSubTypeKey = (typeof DIVERGENCE_SUB_TYPE_KEYS)[number];

/** The synthesised key the consolidated row carries. Never emitted by a rule — see types.ts
 *  KeyStatus "synthesised", and the Stage-6 CI exemption that names it explicitly. */
export const CONSOLIDATED_DIVERGENCE_KEY: StockFindingKey = "divergence_consolidated";

const SUB_TYPES: ReadonlySet<string> = new Set(DIVERGENCE_SUB_TYPE_KEYS);

export const isDivergenceSubType = (key: string): key is DivergenceSubTypeKey => SUB_TYPES.has(key);

// ── severity ordering (File 1 §5 — more-severe first; mirrors the read layer's weights) ───────────
const SEVERITY_WEIGHT: Readonly<Record<string, number>> = {
  critical: 0, red: 1, high: 2, amber: 3, recovery: 4, green: 5, medium: 6, low: 7,
};

export function severityWeight(severity: string | null | undefined): number {
  return SEVERITY_WEIGHT[(severity ?? "").toLowerCase()] ?? 9;
}

/** §5C: a divergence reads High when WIDE, Medium when merely notable. Drives the order split. */
export function isWideTier(severity: string | null | undefined): boolean {
  const s = (severity ?? "").toLowerCase();
  return s === "high" || s === "critical" || s === "red";
}

/** File 1 §5 slot for the consolidated row: WIDE → slot 3 (ahead of recovery), notable → slot 5. */
export const DIVERGENCE_ORDER_RANK_WIDE = 3;
export const DIVERGENCE_ORDER_RANK_NOTABLE = 5;

/** How many sub-type sentences the consolidated card may show (§5C). The rest are counted, not shown. */
export const MAX_SHOWN_SUB_TYPES = 2;

/** One fired divergence sub-type, reduced to what the rule actually reads. */
export interface DivergenceInput {
  key: string;
  severity: string | null;
}

export interface DivergenceConsolidation<T extends DivergenceInput> {
  /** Always CONSOLIDATED_DIVERGENCE_KEY. */
  key: StockFindingKey;
  /** Sub-types sorted dominant-first (widest, then by severity weight). */
  ordered: T[];
  /** The ≤2 the card displays. */
  shown: T[];
  /** The dominant sub-type — its severity/accent/evidence lead the consolidated row. */
  lead: T;
  /** Total fired, so the card can say "+N more" beyond the shown two. */
  count: number;
  /** true when ANY sub-type is wide-tier — decides the order slot. */
  anyWide: boolean;
  orderRank: number;
  /** §5C title rule: two-or-more shown reads as "two gaps at once". */
  name: string;
}

/**
 * Apply §5C to a fired set. Returns null when no divergence fired (nothing to consolidate) — the
 * caller then leaves the set untouched.
 *
 * Generic over the caller's own row type so this can run over a per-stock finding, a census row, or a
 * bare {key, severity} pair without any of them having to adopt a shared shape.
 */
export function consolidateDivergence<T extends DivergenceInput>(
  subTypes: readonly T[],
): DivergenceConsolidation<T> | null {
  const members = subTypes.filter((s) => isDivergenceSubType(s.key));
  if (members.length === 0) return null;

  // Dominant first: wide (high) before notable (medium), then by severity weight.
  const ordered = [...members].sort((a, b) => severityWeight(a.severity) - severityWeight(b.severity));
  const shown = ordered.slice(0, MAX_SHOWN_SUB_TYPES);
  const anyWide = ordered.some((c) => isWideTier(c.severity));

  return {
    key: CONSOLIDATED_DIVERGENCE_KEY,
    ordered,
    shown,
    lead: ordered[0],
    count: ordered.length,
    anyWide,
    orderRank: anyWide ? DIVERGENCE_ORDER_RANK_WIDE : DIVERGENCE_ORDER_RANK_NOTABLE,
    name: shown.length > 1 ? "Divergence — two gaps at once" : "Divergence",
  };
}

/**
 * The census form of the same rule: given a set of keys, how many rows should a reader see?
 * Four C sub-types collapse to one. Used to answer "the board shows one, the census has four" with a
 * number both sides compute the same way.
 */
export function consolidatedKeyCount(keys: Iterable<string>): number {
  let cSeen = 0;
  let other = 0;
  for (const k of keys) {
    if (isDivergenceSubType(k)) cSeen++;
    else other++;
  }
  return other + (cSeen > 0 ? 1 : 0);
}
