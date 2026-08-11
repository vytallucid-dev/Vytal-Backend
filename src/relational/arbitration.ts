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
import { HONEST_NULL_SLOTS, type EntrySlot } from "./mode-contract.js";

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

/** The top of the ladder — the band that outranks a mode's own floor. Rungs 1–4 are critical severity
 *  and delta; nothing below them may jump the order arbitration produced. Named here rather than
 *  written as a bare `<= 4` at the one call site that needs it (service.ts's `leadEntryId`). */
export const URGENT_RUNG_CEILING: number = RUNG.DELTA_ANY;

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
 * Slot allocation (§4.2, AS AMENDED TWICE).
 *
 * ⚠ THE FLOOR IS A RANK STATEMENT, NOT AN INCLUSION MECHANIC.
 *
 * History, because both earlier readings were wrong and the reason matters:
 *   · v1 (library §4.2 step 2) — "reserved, not competed for": floor entries were placed FIRST,
 *     unconditionally. Live consequence: UO4, a null orientation statement, outranked a rung-7
 *     divergence finding. An orientation null above a real finding inverts the ladder.
 *   · v2 — floor guarantees INCLUSION, not position: a missing floor entry displaced the lowest-ranked
 *     non-floor entry. Live consequence (U1/ICICIBANK): UO1@14 and UO2@14 displaced ELEVATED@9 and
 *     UE1@11. Guaranteeing inclusion silently inverted the ladder in a different direction.
 *
 * ⚠ THE REAL DEFECT WAS THE PREMISE: rung was written as ONE GLOBAL ORDERING, but relevance is
 * READER-DEPENDENT. Orientation sits at rung 14 because, for a reader WITH context, identity is the
 * least useful thing on the card. For a STRANGER — which is exactly what M9 is — identity is the MOST
 * useful thing. Both statements are true; a single global ladder cannot express both.
 *
 * The resolution: a mode's floor entries take THAT MODE'S FLOOR RANK, not their global rung. On M9,
 * UO1 ranks first and UO2 second because for a reader with no context that IS their real relevance.
 * Everything else fills the remaining slots by global rung.
 *
 * Consequences, all of them good:
 *   · No displacement mechanic. Nothing is "guaranteed despite ranking last" — it ranks FIRST, and
 *     correctly so for this reader state.
 *   · §0.4 (guaranteed-resolve) is satisfied: the floor always ranks into the card.
 *   · The ladder is never inverted: within the non-floor set, global rung is strictly obeyed.
 *   · The card reads in the order a stranger needs: what it is → how sound → then what matters.
 *
 * Caps are HARD. Everything past the cap overflows, floor-first then global-rung order.
 *
 * `floorIds` are the entryIds this mode ranks first, IN THE ORDER GIVEN — the order is the mode's
 * statement of relevance for that reader state (M9: identity, then health). `candidates` is every
 * eligible entry, floor included. Stability (§2.3): with unchanged state the result is a pure function
 * of floor order + rung + relationalWeight + severity + standingSince.
 *
 * ── FILL-IF-ROOM (the honest-null tier). ──────────────────────────────────────────────────────────────
 * `UO4`/`UN8`/`UG5`/`UE5` say "nothing connects you to this" / "no lift" / "can't see inside funds" — a
 * reader-relative NULL, worth saying on a sparse card and noise on a crowded one (UN8 alone resolved on
 * 8 of 10 M1 cards in the live census, at rung 15, competing on equal footing with real content for the
 * same slot). `HONEST_NULL_SLOTS` (mode-contract.ts) names exactly these four — not the wider UG family,
 * whose members are a DIFFERENT kind of honesty statement ("we could not check this", coverage doctrine)
 * that does not yield to a crowded card and is never split out of the primary pool.
 *
 * Mechanism, reusing the existing rung/cap machinery rather than a parallel system: assemble floor +
 * every NON-null candidate exactly as before (the "primary" pass). Only if slots remain under `cap` after
 * that pass does a second pass fill them from the honest-null candidates, sorted by the same rung
 * comparator. An honest-null can therefore never DISPLACE a non-null candidate, even one that would have
 * lost a same-rung tiebreak to it under a single pass — it can only occupy room nothing else claimed.
 * Floor entries are never honest-nulls today (the historical M9-floor incident above removed the one case
 * that was); the assertion below is a defensive trip-wire, not a live path.
 */
/** The full slot-ordering comparator (§4.2 step 4): global rung, then relational weight, then severity,
 *  then older-standing-first. Exported so any post-assembly step that needs to re-rank or backfill entries
 *  (e.g. entries.ts's `attachEchoAnnotations`, which can shrink `slots` after a key's echo is absorbed
 *  into its host) uses the IDENTICAL rule `assemble` used — never a second, drifting copy of the ladder. */
export const byRung = (a: ResolvedEntry, b: ResolvedEntry): number =>
  (a.weight.ladderRung - b.weight.ladderRung) || withinRung(a, b);

export function assemble(floorIds: string[], candidates: ResolvedEntry[], cap: number): Assembled {
  const isHonestNull = (e: ResolvedEntry): boolean => HONEST_NULL_SLOTS.has(e.entryId as EntrySlot);

  // ⚠ A floored honest-null would bypass fill-if-room entirely — the same failure shape as the historical
  // UO4-in-M9-floor incident (a near-always-resolving floor entry starving everything below it), just
  // relocated to a different mechanism. No mode declares one today; this makes a future regression loud
  // instead of silent.
  for (const id of floorIds) {
    if (HONEST_NULL_SLOTS.has(id as EntrySlot)) {
      throw new Error(
        `[relational] arbitration: floorIds declares "${id}", an honest-null slot — floored honest-nulls ` +
          `bypass fill-if-room and reproduce the historical M9 floor-starvation shape. Fix the mode contract.`,
      );
    }
  }

  const primaryCandidates = candidates.filter((c) => !isHonestNull(c));
  const nullCandidates = candidates.filter(isHonestNull);

  const byId = new Map(primaryCandidates.map((c) => [c.entryId, c]));

  // The floor, in DECLARED order — that order is the mode's relevance statement, not a rung. A declared
  // id with no candidate is simply absent (§2.3); it is never a hole.
  //
  // ★ THE RANK IS STAMPED ON THE ENTRY (`floorRank`), not left to be counted back out of the array.
  // It is the one thing this function knows that its output cannot otherwise express: rung says how
  // relevant an entry is in general, floor rank says how relevant THIS MODE ranks it for THIS reader,
  // and the two disagree by design (see types.ts). Non-floor entries carry `null` — placed by the
  // global ladder, which their rung already states.
  const floor: ResolvedEntry[] = [];
  const floorSet = new Set<string>();
  for (const id of floorIds) {
    const e = byId.get(id);
    if (e && !floorSet.has(id)) {
      floor.push({ ...e, floorRank: floor.length });
      floorSet.add(id);
    }
  }

  // Everything else NON-NULL, by GLOBAL rung. The ladder governs here and is never overridden.
  const rest = primaryCandidates
    .filter((c) => !floorSet.has(c.entryId))
    .sort(byRung)
    .map((c) => ({ ...c, floorRank: null }));

  // ⚠ HOW MANY SLOTS THE PRIMARY (non-null) TAIL WOULD OCCUPY UNDER CAP, computed WITHOUT yet deciding
  // whether an honest-null gets to ride alongside it. This is the "room" fill-if-room fills — the slots
  // the primary pass leaves free — but it must be computed BEFORE merging, not by slicing a primary-only
  // array and appending nulls after: appending after produces exactly the bug this comment replaces
  // (an honest-null tacked on the END of `slots` regardless of its own rung, which can violate
  // non-decreasing rung order the moment a rung-15 non-null entry is ALSO within cap — e.g. floor(2) +
  // rest(UO1@14, ELEVATED@15) fills 3 of 4 slots; a naive "append UG5@13 after" puts 13 after 15).
  const room = Math.max(0, cap - floor.length - rest.length);
  const nullFill = room > 0
    ? [...nullCandidates].sort(byRung).slice(0, room).map((c) => ({ ...c, floorRank: null }))
    : [];
  const nullFillIds = new Set(nullFill.map((c) => c.entryId));
  const nullOverflow = nullCandidates
    .filter((c) => !nullFillIds.has(c.entryId))
    .map((c) => ({ ...c, floorRank: null }));

  // Merge the non-null tail and its null-fill into ONE rung-ordered sequence before slicing to cap — this
  // is what guarantees non-decreasing rung order across the whole non-floor run, not just within each
  // half separately. The floor still leads unconditionally (that ordering is the mode's own statement of
  // relevance, never a rung); only the TAIL (rest + nullFill) needs the merge.
  const tail = [...rest, ...nullFill].sort(byRung);
  const ordered = [...floor, ...tail];

  const slots = ordered.slice(0, cap);
  const overflow = [...ordered.slice(cap), ...nullOverflow].sort(byRung);

  return { slots, overflow };
}
