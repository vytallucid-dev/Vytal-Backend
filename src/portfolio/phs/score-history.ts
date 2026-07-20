// ─────────────────────────────────────────────────────────────────────────────
// PART A — DAILY SCORE HISTORY (the "PHS over time" graph).
//
// A best-effort daily upsert into portfolio_score_history, riding the PHS write point
// (the …Tracked wrapper in refresh.ts) AFTER the snapshot is already written/confirmed.
// It READS the authoritative snapshot row — never recomputes — and upserts one row per
// (user, day): same day overwrites (latest wins), a new day inserts.
//
// ⚠ DECOUPLED FROM SCORING BY CONSTRUCTION — the graph rides along; it can NEVER take
//   down the score:
//     · runs OUTSIDE the snapshot write, wrapped here in its own try/catch — NEVER throws.
//     · a failure emits ONE quiet log line and returns. It does NOT open an error-tab row
//       (a missing chart dot is not a fault needing a human) and does NOT touch the score.
//     · written ONLY for an EVALUABLE book (phs non-null). A no-scored-holdings book has
//       no PHS to chart, so it records nothing — a correct absence, not an error.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../../db/prisma.js";
import type { PersistOutcome } from "./persist.js";

/** Today's calendar date in IST (Asia/Kolkata, UTC+5:30) as a `@db.Date`-ready Date at UTC
 *  midnight. The series is an India-market graph, so the "day" a value belongs to is the IST
 *  trading day — using the raw UTC date would misfile a compute that lands between 00:00 UTC
 *  and 05:30 IST onto the previous day. Deterministic fixed offset (India observes no DST). */
export function istDateOnly(now: Date = new Date()): Date {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/**
 * Best-effort daily score-history upsert. `outcome` is the return of the just-run
 * computeAndPersistPhs (its `snapshotId` points at the authoritative row — the new one on a
 * write, the unchanged latest on a skip). Never throws; failures are logged only.
 */
export async function recordScoreHistory(userId: string, outcome: PersistOutcome): Promise<void> {
  try {
    // Correct-null / not-evaluable book — nothing to chart (NOT an error).
    if (outcome.phs == null) return;

    // Read the sub-scores off the authoritative snapshot (the single source of truth), never
    // recompute. On a skip this is the current latest row; on a write it's the fresh one.
    // `structure` is the SAME column getPortfolioSnapshot's constructionRead.value reads
    // (portfolio-snapshot-controller.ts: `structure: num(s.structure)`) — reading it from
    // here, and nowhere else, is what keeps the series value and the snapshot value from
    // ever being able to disagree.
    const snap = await prisma.portfolioHealthSnapshot.findUnique({
      where: { id: outcome.snapshotId },
      select: { phs: true, quality: true, signals: true, structure: true, coverage: true },
    });
    if (!snap || snap.phs == null) return;

    const date = istDateOnly();
    const quality = snap.quality == null ? null : Math.round(Number(snap.quality));
    const signals = snap.signals == null ? null : Math.round(Number(snap.signals));
    // Rounded to match phs/quality/signals — the series stores integer scores; the precise
    // decimal (cData.net) stays in the append-log (portfolio_health_snapshot.structure).
    const structure = snap.structure == null ? null : Math.round(Number(snap.structure));
    const coverage = snap.coverage == null ? null : Number(snap.coverage);

    await prisma.portfolioScoreHistory.upsert({
      where: { user_id_date: { userId, date } },
      create: { userId, date, phs: snap.phs, quality, signals, structure, coverage },
      update: { phs: snap.phs, quality, signals, structure, coverage }, // same day → the day's latest value wins
    });
  } catch (e) {
    // The graph is a nice-to-have; the score is load-bearing. A history-write failure is a
    // quiet log line, NEVER a score failure and NEVER an error-tab row.
    console.warn(
      `[score-history] upsert failed for user ${userId} (the score is unaffected):`,
      (e as Error).message,
    );
  }
}
