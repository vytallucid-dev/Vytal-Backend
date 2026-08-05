// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// READ-LAYER DISPLAY CONSTANTS — numbers that decide a WORD on a screen, and nothing else.
//
// ── ★ WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT "MORE THRESHOLDS" ────────────────────────────
// A scoring bar decides whether a finding FIRES. A display constant decides how an already-decided
// fact is WORDED. Keeping them apart is the whole of Ruling 0: a surface may not derive a pattern
// fact, but it must still be able to say "the score went up" without inventing a pattern to say it
// with. What it may NOT do is keep its own private copy of that decision — which is what three
// services were doing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★ THE COMPOSITE-MOVE DEADBAND — the `improving` / `deteriorating` / `stable` marker on a list row,
 * a compare column and a peer table.
 *
 * ── ⚠ THE DECISION THIS FILE WAS ASKED FOR: IT IS **NOT** THE TRAJECTORY READING. ────────────────
 * It was declared THREE TIMES, independently, as `TRAJECTORY_EPS = 1.0` (health-view, universe-view,
 * peer-group-view) and it drives a classifier named "trajectory". It is not the T-family and must
 * never be presented as it:
 *
 *     this marker   |Δcomposite| > 1.0, ANY level, ANY direction — an annotation on a row
 *     T1            Composite_prev ≤ 58 AND Δ ≥ +6   — a measured recovery, n=26, +12.8% median
 *     T2            Composite_prev ≥ 70 AND Δ ≤ −6   — a measured deterioration, n=28, 79% fell
 *
 * A stock whose composite moved +1.4 from 65 gets `improving` here and fires NO T pattern, correctly:
 * the study found nothing at that size from that level. If this constant were "the trajectory
 * reading", every such row would be asserting a measured claim the study does not support — which is
 * precisely the confusion three separate `TRAJECTORY_EPS` declarations invited by name.
 *
 * So it keeps its own name, its own home, and its own justification: it is the smallest composite
 * move worth drawing an arrow for. 1.0 is one composite point — the granularity the composite is
 * displayed at — chosen because a marker that flips on a rounding residue is noise, not information.
 * It is the same VALUE as the movement-floor ruling's 1.0pp and the lifecycle direction deadband, and
 * that is a coincidence of scale (all three ask "is this move visible?"), not a shared authority: none
 * of the three may be changed by editing another.
 *
 * ⚠ IT GATES NOTHING. No finding fires, is suppressed, or is ranked by this number.
 */
export const COMPOSITE_MOVE_DEADBAND = 1.0;
