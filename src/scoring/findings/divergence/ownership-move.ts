// File: src/scoring/findings/divergence/ownership-move.ts
//
// THE OWNERSHIP-MOVEMENT PRIMITIVE for D3 / D4. PURE.
//
// ── ★ WHY THIS EXISTS: "GO LOOK AT WHY" HAD NO ANSWER ─────────────────────────────────────────────
// D3 and D4 fire on Ownership MOVEMENT (§1.1: "Ownership patterns use movement, not a standing
// gap"). A card that says "ownership moved — go look at why" and cannot say WHAT moved sends the
// reader hunting. Worse, the recon established that the honest answer is not always the obvious one:
//
//   ~93% of non-zero moves  the underlying SHAREHOLDING changed → promoter / FII / DII / pledge deltas
//   ~ 7% of non-zero moves  the filing is BYTE-IDENTICAL on both snapshots and the pillar still moved,
//                           via the flow adjustment — clamp(A+B+C+D, −12, +12) — which is fed by
//                           insider trades and block deals that refresh DAILY on top of a QUARTERLY
//                           shareholding baseline. Live case: INFY 80→63 (−17) with the same filing
//                           on both sides.
//
// A reader shown "Ownership fell 17 points" who then opens the shareholding table and finds every
// number unchanged has been misled by omission. So the rule DETECTS which cause applies and stamps
// the matching evidence, and the verdict names a real driver.
//
// ── THE Δ ITSELF ───────────────────────────────────────────────────────────────────────────────────
// Read from the trajectory series (prior snapshot's ownership subtotal vs current), NOT recomputed
// from shareholding — the pillar's move is the pillar's move, including the flow component that no
// shareholding delta explains. Inert-0 guarded at both ends: an `unavailable_redistributed` pillar
// persists a 0 that is not a score, and differencing against it would fabricate a ±60 swing.

import type { FiringContext } from "../types.js";
import { TRAJECTORY_DELTA_EPSILON } from "../trajectory/prev-now.js";

/** What actually moved the pillar. */
export type OwnershipMoveCause =
  /** The filing changed — promoter / FII / DII / pledge deltas are real and are carried. */
  | "shareholding_changed"
  /** The filing is identical on both snapshots; the move came through the flow adjustment
   *  (insider trades / block deals, which refresh daily on a quarterly baseline). */
  | "flow_activity"
  /** The filing is identical AND no insider/block feed is wired for this stock, so we can see THAT
   *  the pillar moved but not name the driver. Stated, never guessed at. */
  | "undetermined";

export interface ShareholdingDeltas {
  promoterPp: number | null;
  fiiPp: number | null;
  diiPp: number | null;
  /** Pledged shares as a % OF PROMOTER HOLDING (the R1-aligned headline), delta in pp. */
  pledgePp: number | null;
}

export interface FlowActivity {
  insiderBuys: number;
  insiderSells: number;
  blockDeals: number;
  /** Net insider value, ₹Cr (buys − sells). */
  insiderNetCr: number;
  /** Net block value, ₹Cr (buys − sells). */
  blockNetCr: number;
}

export interface OwnershipMove {
  /** Signed pillar move in points. */
  deltaPp: number;
  priorSubtotal: number;
  currentSubtotal: number;
  /** ★ THE TIER THAT SELECTS THE REGISTER, NOT WHETHER IT FIRES. See the D3/D4 rules. */
  strong: boolean;
  cause: OwnershipMoveCause;
  /** Present when cause is `shareholding_changed`. */
  shareholding: ShareholdingDeltas | null;
  /** Present when cause is `flow_activity`. */
  flow: FlowActivity | null;
}

/**
 * ★ THE ±8 TIER — LANGUAGE, NOT A GATE (owner ruling).
 *
 * The spec's D3/D4 triggers were ΔOwnership ≥ +8 / ≤ −8. That threshold is REMOVED as a firing
 * condition: any movement at the stated Foundation level fires the pattern. What ±8 still does is
 * select the REGISTER:
 *
 *   |Δ| ≥ 8   the study's evidenced population — D3's +1.9% sector-excess / 58% positive / 88%
 *             absolute / 100% in STRESSED, and D4's −3.4% / 36% positive, may be spoken.
 *   |Δ| < 8   the SAME condition with NO measured outcome. State the movement plainly and point at
 *             what drove it. Borrowing the evidenced claim for a 2-point move would attach a
 *             measured figure to a population it was never measured on.
 */
export const OWNERSHIP_STRONG_MOVE_PP = 8;

const r2 = (x: number) => Math.round(x * 100) / 100;
const pctOf = (part: bigint | null, whole: bigint | null): number | null =>
  part === null || whole === null || whole === 0n ? null : (Number(part) / Number(whole)) * 100;

/** Did any of the four shareholding inputs actually change between the two latest filings? */
function shareholdingDeltas(ctx: FiringContext): ShareholdingDeltas | null {
  const rows = ctx.shareholding;
  if (rows.length < 2) return null;
  const cur = rows[rows.length - 1];
  const prior = rows[rows.length - 2];
  const d = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : r2(a - b);
  const curPledge = pctOf(cur.pledgedShares, cur.promoterShares);
  const priorPledge = pctOf(prior.pledgedShares, prior.promoterShares);
  return {
    promoterPp: d(cur.promoterPct, prior.promoterPct),
    fiiPp: d(cur.fiiPct, prior.fiiPct),
    diiPp: d(cur.diiPct, prior.diiPct),
    pledgePp: d(curPledge, priorPledge),
  };
}

const anyChanged = (s: ShareholdingDeltas | null): boolean =>
  s !== null && [s.promoterPp, s.fiiPp, s.diiPp, s.pledgePp].some((v) => v !== null && v !== 0);

/** Insider/block activity in view. Null feeds mean NOT WIRED — distinct from "wired and empty". */
function flowActivity(ctx: FiringContext): FlowActivity | null {
  const ins = ctx.feeds.insiderTxns;
  const blk = ctx.feeds.blockTxns;
  if (ins === null && blk === null) return null; // neither feed wired — cannot name a driver
  const insiderBuys = (ins ?? []).filter((t) => t.side === "buy").length;
  const insiderSells = (ins ?? []).filter((t) => t.side === "sell").length;
  const insiderNetCr = (ins ?? []).reduce((s, t) => s + (t.side === "buy" ? t.valueInrCr : -t.valueInrCr), 0);
  const blockNetCr = (blk ?? []).reduce((s, t) => s + (t.side === "buy" ? t.valueInrCr : -t.valueInrCr), 0);
  const activity: FlowActivity = {
    insiderBuys,
    insiderSells,
    blockDeals: (blk ?? []).length,
    insiderNetCr: r2(insiderNetCr),
    blockNetCr: r2(blockNetCr),
  };
  const nothing = activity.insiderBuys === 0 && activity.insiderSells === 0 && activity.blockDeals === 0;
  return nothing ? null : activity;
}

/**
 * The Ownership pillar's move since the previous snapshot, with its cause. Returns null when there is
 * no prior snapshot, or when either end is not genuinely scored (the inert-0 guard).
 */
export function ownershipMove(ctx: FiringContext): OwnershipMove | null {
  const cur = ctx.current.pillars.ownership;
  if (cur.state !== "scored" || cur.subtotal === null) return null;
  if (ctx.priorSnapshots.length === 0) return null;

  const prior = ctx.priorSnapshots[ctx.priorSnapshots.length - 1];
  if (!prior.ownershipScored || prior.ownership === null) return null;

  const deltaPp = r2(cur.subtotal - prior.ownership);
  // ★ Same epsilon as the T-family's delta-sign gates (trajectory/prev-now.ts), applied here for
  // consistency — the code SHAPE is identical (an unrounded live "now" vs a persisted-and-reloaded
  // "prior"), so the same fresh-vs-stored noise could in principle appear. In practice it is a
  // no-op: `deltaPp` is already r2-rounded (2dp), so it is either exactly 0 or at least 0.01 in
  // magnitude — never inside (0, TRAJECTORY_DELTA_EPSILON]. That r2 rounding is WHY the live diagnostic
  // found zero spurious D3/D4 fires (10/10 checked carried real, multi-point deltas) where T7/T8/T9's
  // UNROUNDED comparison found 18. Kept as one shared constant rather than a second literal so the two
  // gates can never drift apart if either rounding step is ever changed.
  if (Math.abs(deltaPp) <= TRAJECTORY_DELTA_EPSILON) return null; // no movement — D3/D4 are movement patterns

  const sh = shareholdingDeltas(ctx);
  const changed = anyChanged(sh);
  const flow = changed ? null : flowActivity(ctx);

  return {
    deltaPp,
    priorSubtotal: r2(prior.ownership),
    currentSubtotal: r2(cur.subtotal),
    strong: Math.abs(deltaPp) >= OWNERSHIP_STRONG_MOVE_PP,
    cause: changed ? "shareholding_changed" : flow ? "flow_activity" : "undetermined",
    shareholding: changed ? sh : null,
    flow,
  };
}

/** The reader-facing driver clause the verdict appends. Names a real driver or says plainly that the
 *  filing did not move — never "go and look". */
export function driverClause(m: OwnershipMove): string {
  if (m.cause === "shareholding_changed" && m.shareholding) {
    const parts: string[] = [];
    const add = (label: string, v: number | null) => {
      if (v !== null && v !== 0) parts.push(`${label} ${v > 0 ? "+" : ""}${v.toFixed(2)}pp`);
    };
    add("promoter", m.shareholding.promoterPp);
    add("FII", m.shareholding.fiiPp);
    add("DII", m.shareholding.diiPp);
    add("pledge", m.shareholding.pledgePp);
    return parts.length ? `Behind it: ${parts.join(", ")}.` : "";
  }
  if (m.cause === "flow_activity" && m.flow) {
    const bits: string[] = [];
    if (m.flow.insiderBuys || m.flow.insiderSells) {
      bits.push(`${m.flow.insiderBuys} insider buy${m.flow.insiderBuys === 1 ? "" : "s"} / ${m.flow.insiderSells} sell${m.flow.insiderSells === 1 ? "" : "s"}`);
    }
    if (m.flow.blockDeals) bits.push(`${m.flow.blockDeals} block deal${m.flow.blockDeals === 1 ? "" : "s"}`);
    return `The shareholding filing is unchanged — this moved on ${bits.join(" and ")}.`;
  }
  return "The shareholding filing is unchanged since the last reading; no insider or block activity is recorded to account for it.";
}
