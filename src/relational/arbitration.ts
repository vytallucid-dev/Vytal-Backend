// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RELATIONAL L4 — ARBITRATION (§4).
//
// Relevance is a fixed fifteen-rung LADDER (§4.1), not a weighted score — auditable, and it cannot
// surprise in production. Relational weight is a TIEBREAK ONLY (§4.3): it orders within a rung, never
// across rungs. The reading of the ladder is: risk before opportunity · self before other · delta before
// state · fact before interpretation.
//
// ★ POLARITY NEVER SETS A RUNG; SEVERITY DOES (§4.1). Recovery and notable strength (UO6) sit at rung 8,
// between HIGH (7) and MEDIUM (9) severity — the Rules Spec's own §5 ordering reproduced exactly.
// ★ MAGNITUDE IS NEVER READ (§0.7.1) — it is not even carried into this layer. Nothing here can rank by it.
// ★ NOVELTY AND DURATION ARE DISPLAY AXES, NEVER ORDERINGS (§4.4) — the one permitted interaction is the
//   final tiebreak, where at equal relational weight an OLDER standing sorts first (§4.2 step 4).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { ResolvedEntry } from "./types.js";

/** The fifteen rungs (§4.1). Lower number = higher precedence. In-slice entries populate a subset; the
 *  out-of-slice rungs (2/4/6/10/11/12) are named so the ladder is complete and legible. */
export const RUNG = {
  CRITICAL_HELD: 1,
  DELTA_HELD: 2, // UD — out of slice
  CRITICAL_UNPOSITIONED: 3,
  DELTA_ANY: 4, // UD — out of slice
  POSITION_FACT: 5, // UH1, UH2, UH3, UH4, UH5, UH10
  POND_EXPOSURE: 6, // UN1, UN2 — out of slice
  HIGH_SEVERITY: 7,
  RECOVERY_STRENGTH: 8, // UO6, elevated recovery findings
  MEDIUM_SEVERITY: 9,
  ENVIRONMENTAL: 10, // UE6 — out of slice
  ECHO: 11, // UE1–UE4 — out of slice
  POND_CONDITION: 12, // UN4, UN6 — out of slice
  GAP: 13, // UG*
  ORIENTATION: 14, // UO1–UO5
  CONTEXT: 15, // low severity, UE5, UN8
} as const;

/** Severity → intra-rung tiebreak rank (higher = more severe). Used only AFTER relational weight, never
 *  to move a rung (§4.2 step 4). */
const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  recovery: 2,
  low: 1,
  green: 1,
};
const severityRank = (s: string | null): number => (s ? SEVERITY_RANK[s.toLowerCase()] ?? 0 : 0);

/** Intra-rung comparator (§4.2 step 4): relational weight desc → severity desc → older standing first. */
function withinRung(a: ResolvedEntry, b: ResolvedEntry): number {
  if (b.weight.relationalWeight !== a.weight.relationalWeight) {
    return b.weight.relationalWeight - a.weight.relationalWeight;
  }
  const sa = severityRank((a.arithmetic?.severity as string | null) ?? null);
  const sb = severityRank((b.arithmetic?.severity as string | null) ?? null);
  if (sb !== sa) return sb - sa;
  // Older standing first (duration is the more informative fact); nulls sort last.
  const ca = a.standingSince?.snapshotCount ?? -1;
  const cb = b.standingSince?.snapshotCount ?? -1;
  return cb - ca;
}

export interface Assembled {
  slots: ResolvedEntry[];
  overflow: ResolvedEntry[];
}

/**
 * Slot allocation (§4.2): the mode's FLOOR is reserved (always occupies slots, in declared order, never
 * competed for), then remaining candidates fill by ladder rung, highest first, tie-broken within a rung.
 * Caps are HARD. Everything unfilled goes to overflow, in the same order.
 *
 * `floorIds` are the entryIds reserved for this mode's floor, in display order. `candidates` is every
 * eligible entry (including the floor entries). Stability (§2.3): with unchanged state, the sort is a pure
 * function of rung + relationalWeight + severity + standingSince — identical inputs ⇒ identical order.
 */
export function assemble(floorIds: string[], candidates: ResolvedEntry[], cap: number): Assembled {
  const byId = new Map(candidates.map((c) => [c.entryId, c]));
  const floor: ResolvedEntry[] = [];
  const floorSet = new Set<string>();
  for (const id of floorIds) {
    const e = byId.get(id);
    if (e && !floorSet.has(id)) {
      floor.push(e);
      floorSet.add(id);
    }
  }

  const rest = candidates
    .filter((c) => !floorSet.has(c.entryId))
    .sort((a, b) => (a.weight.ladderRung - b.weight.ladderRung) || withinRung(a, b));

  const ordered = [...floor, ...rest];
  return { slots: ordered.slice(0, cap), overflow: ordered.slice(cap) };
}
