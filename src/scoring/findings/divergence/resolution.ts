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
// ── ⚠ NOT WIRED. See the §5 scope note in the build report. ────────────────────────────────────────
// Nothing records a finding LIFECYCLE today: findings FK the snapshot and the read layer sees only
// the head, so "this divergence opened in FY25Q2 and closed in FY26Q1" has nowhere to live. This
// module is the discriminant, not the tracker.

/** How a divergence ended. §1.4 — both outcomes are real and they mean opposite things. */
export type ResolutionType = "converged" | "collapsed";

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
 * Type a closure. THE DISCRIMINANT IS G's, UNCHANGED: the dominant move names the story, and a tie
 * resolves to the constructive reading (`>=`, exactly as ruleG had it).
 *
 *   laggardRose >= leaderFell  →  CONVERGED  (the business grew into it)
 *   otherwise                  →  COLLAPSED  (the leader came back to the laggard)
 */
export function typeResolution(i: ResolutionInput): Resolution {
  const laggardMovePp = i.laggardNow - i.laggardThen; // + = the laggard rose
  const leaderMovePp = i.leaderThen - i.leaderNow;    // + = the leader fell
  const gapThen = i.leaderThen - i.laggardThen;
  const gapNow = i.leaderNow - i.laggardNow;
  const closed = gapThen - gapNow;
  return {
    type: laggardMovePp >= leaderMovePp ? "converged" : "collapsed",
    laggardMovePp,
    leaderMovePp,
    gapThen,
    gapNow,
    laggardShare: closed > 0 ? Math.max(0, Math.min(1, laggardMovePp / closed)) : null,
  };
}

/** §1.4 — a divergence stands until the gap closes back to ≤ 7 (the ALIGNED band). */
export const isResolved = (gapNow: number): boolean => Math.abs(gapNow) <= 7;
