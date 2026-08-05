// File: src/scoring/findings/divergence/resolution.ts
//
// ★ EXTRACTED FROM rules/g-convergence.ts, WHICH IS RETIRED. PURE.
//
// ── WHY THE RULE DIED AND THE MECHANISM DID NOT ────────────────────────────────────────────────────
// trajectory_G_convergence fired on a NARROWING max−min spread across all four pillars. The
// Divergence spec's EXCLUDED list kills that trigger outright: "Narrowing spread — +0.2%, 51%
// positive (n=239). Indistinguishable from nothing." So G is retired as a finding.
//
// But G's TYPING — deciding whether a gap closed because the laggard ROSE or because the leader FELL
// — is exactly what §1.4 requires for resolution tracking, and §1.4 is emphatic that this is the real
// content:
//
//     CONVERGED  the lagging pillar rose to meet the leading one. The business grew into it.
//                Glenmark: price ran far ahead of a falling Foundation (55→48), then Momentum climbed
//                32→20→63→75 and the tension dissolved with no crash.
//     COLLAPSED  the leading pillar fell back to the lagging one.
//                BHEL: Market 78 against Foundation 53 / Momentum 48; the fundamentals never caught
//                up and the price fell −32%.
//
// "Logging which outcome occurred builds a per-stock resolution history, and it is the most honest way
// to teach users what a divergence means — it demonstrates both outcomes rather than implying
// divergence always ends badly."
//
// So the discriminant is preserved here, unregistered and un-fired, ready for the resolution-tracking
// build. Deleting it with the rule would have thrown away the one piece of G worth keeping.
//
// ── TWO DIFFERENCES FROM G, BOTH DELIBERATE ────────────────────────────────────────────────────────
//   1. G ran on max−min across ALL FOUR pillars. Resolution runs on THE DIVERGED PAIR — the two
//      pillars the finding named. A four-pillar spread cannot say which divergence resolved.
//   2. G closed at "< wide" (25). §1.4 closes at ≤ 7 — the ALIGNED band. A gap that fell from 30 to
//      24 has not resolved; it is still material. Closure means the tension is gone, not smaller.
//
// ── ★ NOW WIRED — read/finding-lifecycle.service.ts is the tracker. ───────────────────────────────
// This module stays the DISCRIMINANT and nothing else: it types a closure given four numbers, and has
// no idea where they came from. The tracker supplies them — `*Then` off the fired row's own evidence
// at the start of the run, `*Now` off the current snapshot's pillars — and owns every question about
// runs, versions and periods. Keeping the split means the discriminant is testable on four literals
// and the tracker can change its query without touching the rule that decides what a closure MEANS.
//
// ⚠ THE TRACKER READS ROWS, AND ROWS CARRY A CATALOGUE ERA. A pattern that stops appearing because
// its RULE was retired has not resolved — see RETIRED_FINDING_KEYS's exclusion in the tracker. This
// module cannot see that distinction and must not be asked to.

import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";

/**
 * How a divergence ended. §1.4 — the outcomes are real and they mean different things.
 *
 * ── ★ WHY `mutual` EXISTS, AND WHY ITS ABSENCE WAS A DEFECT ──────────────────────────────────────
 * The discriminant was a two-way branch on `laggardRose >= leaderFell`, with ties resolving to
 * CONVERGED. So a gap that closed because BOTH readings moved half-way — the laggard up 4, the leader
 * down 4 — was reported as "the business grew into it", which credits one pillar for a closure the
 * other did half of. At exact parity it is not a tie to be broken in the constructive direction; it is
 * a third outcome, and naming it is the only honest reading.
 */
export type ResolutionType = "converged" | "collapsed" | "mutual";

/**
 * ★ THE MUTUAL BAND. Within this many points of each other, the two pillars moved the same amount and
 * neither one closed the gap.
 *
 * ⚠ IT IS A DESCRIPTIVE DEADBAND, NOT A SCORING BAR — it decides one word on a card about a condition
 * that has already ended, gates no firing and suppresses nothing. 1.0 is this codebase's established
 * answer to "is a difference of this size worth calling a difference" (the movement floors, and the
 * lifecycle direction deadband), reused rather than re-chosen.
 */
export const MUTUAL_MOVE_BAND = 1.0;

export interface ResolutionInput {
  /** The lagging pillar's value when the divergence was at its widest. */
  laggardThen: number;
  /** The leading pillar's value when the divergence was at its widest. */
  leaderThen: number;
  /** The lagging pillar's value now. */
  laggardNow: number;
  /** The leading pillar's value now. */
  leaderNow: number;
}

export interface Resolution {
  type: ResolutionType;
  /** How far the laggard rose (+) or fell (−). */
  laggardMovePp: number;
  /** How far the leader fell (+) or rose (−). */
  leaderMovePp: number;
  /** The gap at its widest. */
  gapThen: number;
  /** The gap now. */
  gapNow: number;
  /** How much of the closure the laggard's rise accounts for, 0–1. Null when nothing closed. */
  laggardShare: number | null;
}

/**
 * Type a closure. THE ATTRIBUTION IS BY ABSOLUTE MOVEMENT: whichever pillar travelled further between
 * the two readings names the story, and near-parity is its own answer.
 *
 *   |laggard move| − |leader move| >  +1.0  →  CONVERGED  (the business grew into it)
 *   |laggard move| − |leader move| <  −1.0  →  COLLAPSED  (the leader came back to the laggard)
 *   within 1.0                              →  MUTUAL     (they met in the middle)
 *
 * ⚠ ABSOLUTE, NOT SIGNED — and the difference is not cosmetic. G's signed test read `laggardRose >=
 * leaderFell`, so a laggard that FELL 2 while the leader fell 6 scored −2 against +6 and typed as
 * COLLAPSED, which happens to be right; but a laggard that ROSE 6 while the leader ROSE 2 scored +6
 * against −2 and typed as CONVERGED while the gap was WIDENING. Attribution has to be about which
 * reading moved, and by how much, independent of which way.
 */
export function typeResolution(i: ResolutionInput): Resolution {
  const laggardMovePp = i.laggardNow - i.laggardThen; // + = the laggard rose
  const leaderMovePp = i.leaderThen - i.leaderNow;    // + = the leader fell
  const gapThen = i.leaderThen - i.laggardThen;
  const gapNow = i.leaderNow - i.laggardNow;
  const closed = gapThen - gapNow;

  const laggardTravel = Math.abs(i.laggardNow - i.laggardThen);
  const leaderTravel = Math.abs(i.leaderNow - i.leaderThen);
  const type: ResolutionType =
    Math.abs(laggardTravel - leaderTravel) <= MUTUAL_MOVE_BAND
      ? "mutual"
      : laggardTravel > leaderTravel
        ? "converged"
        : "collapsed";

  return {
    type,
    laggardMovePp,
    leaderMovePp,
    gapThen,
    gapNow,
    laggardShare: closed > 0 ? Math.max(0, Math.min(1, laggardMovePp / closed)) : null,
  };
}

/**
 * §1.4 — a divergence stands until the gap closes back into the ALIGNED band.
 *
 * ★ THE CEILING IS S1's, READ FROM S1's OWN RECORD — not a second copy of the number. "Resolved" and
 * "aligned" are the SAME claim about the same quantity (a pillar pair that has stopped disagreeing),
 * so they must move together: if S1's ceiling is ever recalibrated, a divergence's closure test
 * follows it in the same edit. A literal `7` here would have been the third home for one number
 * (S1's record, aligned.ts, and this) and the first one to go stale.
 *
 * ⚠ On S1's record `gapFloor` bounds from ABOVE — see the note there and in aligned.ts.
 */
const RESOLVED_GAP_CEILING = STOCK_FINDINGS.divergence_S1_aligned.facts.gapFloor;

export const isResolved = (gapNow: number): boolean => Math.abs(gapNow) <= RESOLVED_GAP_CEILING;
