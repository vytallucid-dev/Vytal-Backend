// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WHICH SIDE OF THE FIELD A FACE PUTS A MEMBER ON — the DIRECTION a lens finding carries.
//
// ── ★ WHY THIS EXISTS AT ALL: DIRECTION WAS NOT SERVED ────────────────────────────────────────────
// Every escalated lens finding is written with `direction: "negative"` (lens-findings.ts) — all four
// of them, LM3 included. That column says "this is not a constructive card"; it does not say which
// END of the peer field the member sits at, and the peer-group census (PathologyCensusItem) does not
// carry it at all. So a surface that wants to group lens findings by metric and state which way each
// member leans has nothing on the payload to read.
//
// It does not need a new computation, because the answer is already fixed by the face. The LM catalog
// is a CLOSED 3×4×4 cell table (lens-pattern.ts §4) and every cell names an explicit L2 state:
//
//     LM1 above·above·improving     LM5 below·below·improving
//     LM2 above·above·(flat|decl)   LM6 above·near·declining
//     LM3 below·above·any           LM7 below·below·declining
//     LM4 above·below·any           LM8 below·below·flat (anti-mask)
//
// So the side is a PROPERTY OF THE FACE, and the map below states it once.
//
// ── ⚠ THIS IS A SECOND STATEMENT OF THE PRIMITIVE, AND THAT IS WHY IT HAS A PROOF ─────────────────
// A hand-written table that echoes a hand-written `if` ladder is exactly the shape that drifts: the
// ladder gains a cell, the table does not, and nothing errors — the new face just quietly reads as
// "neither side". So verify-lens-separation.ts ENUMERATES all 48 (l1, l2, l3) triples against both
// values of the LM8 anti-mask opt, fires the real `lensPattern` primitive on each, and asserts that
// whatever face comes back has the side its own L2 state implies. The map is not trusted; it is
// checked against the thing it describes, on every build.
//
// ── WHY THE PEER AXIS AND NOT THE BAR ─────────────────────────────────────────────────────────────
// L1 (the absolute bar) is a universal judgement — "sub-par in universal terms". L2 is the only lens
// that is about THIS GROUP, and a peer-group page's whole subject is this group. A section that said
// "below the bar" would be making the same claim on every pond in the product; "below the field" is
// the claim only a peer comparison can make, and it is the one that stays true when the group as a
// whole is excellent (an excellent group still has a lower side).
//
// `near_peer` is DELIBERATELY null, not a third side. LM6's member sits AT the field average — that
// is the absence of a side, and calling it one would put a member with no separation into a section
// about separation.
//
// PURE. No DB, no I/O.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { L2State } from "./types.js";

/** Which side of the peer field a face puts its member on. `null` ⇒ no side (at the field, or the
 *  peer lens is not part of the cell). */
export type LensFieldSide = "above" | "below";

/**
 * The L2 state each LM face requires, verbatim from the §4 cell table. `near_peer` for LM6, which is
 * why LM6's side is null: it is the one cell whose peer read is "no separation".
 */
export const LM_L2_CELL: Readonly<Record<string, L2State>> = Object.freeze({
  LM1: "above_peer",
  LM2: "above_peer",
  LM3: "above_peer",
  LM4: "below_peer",
  LM5: "below_peer",
  LM6: "near_peer",
  LM7: "below_peer",
  LM8: "below_peer",
});

/** The side an L2 state stands for. `near_peer` and `not_evaluable` are not sides. */
export function sideOfL2(l2: L2State): LensFieldSide | null {
  if (l2 === "above_peer") return "above";
  if (l2 === "below_peer") return "below";
  return null;
}

/**
 * The side a metric-level face puts its member on. `null` for LM6 (at the field), for the pillar-level
 * LP faces (a pillar roll-up has no single peer position to report), and for any unknown id.
 */
export function lensFieldSide(faceId: string): LensFieldSide | null {
  const cell = LM_L2_CELL[faceId];
  return cell ? sideOfL2(cell) : null;
}
