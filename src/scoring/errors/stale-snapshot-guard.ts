// ─────────────────────────────────────────────────────────────
// STALE-SNAPSHOT GUARD — Stage 3 of scoring-error detection.
//
// Catches "the underlying SCORE INPUT moved but the score didn't recompute" → the
// live score is complete-but-stale (an invisible failure: it LOOKS fine but reflects
// old data). Subtler than a failed job (which has NO fresh score); here a fresh-
// looking score is silently behind its inputs.
//
// ── THE FALSE-FLAG TRAP (central design constraint) ──
// A naive "input.updatedAt > snapshot.createdAt" guard is WRONG: display-only writes
// bump updatedAt without changing any score input. The finding-#5 deriveFromRow sweep
// (sweep-rederive.ts) re-derived DISPLAY ratios on the financial tables and bumped
// ~610 Fundamental + ~3,700 QuarterlyResult `updatedAt`s on a single day — a naive
// updatedAt guard would false-flag ~84% of the universe (measured: 79/94). It changed
// NO score input (it refuses to write the one score-input column, operatingMargin).
//
// ── THE RELIABLE SIGNALS (build ONLY on these) ──
// All signals are IMMUTABLE-APPEND `createdAt` (insert time) — never `updatedAt`
// (which `update` bumps) — so a display-only patch can NEVER trip this guard:
//   • SIGNAL A (primary, cleanest): a ShareholdingPattern row with createdAt >
//     snapshot.createdAt → a new ownership filing arrived → Ownership pillar is stale.
//     ShareholdingPattern has NO updatedAt at all (immutable-append) AND is a different
//     table than the finding-#5 sweep touched → structurally false-flag-proof.
//   • SIGNAL B: a Fundamental / QuarterlyResult row with createdAt > snapshot.createdAt
//     → a new fundamental period/filing arrived → Foundation/Momentum is stale. We use
//     `createdAt` (NOT `updatedAt`): the sweep's `update`s bump updatedAt but never
//     createdAt (verified: createdAt has no sweep-day spike), so this is clean too.
//
// ── EXCLUDED (with reason) ──
//   • Fundamental/QuarterlyResult.updatedAt — finding-#5-contaminated (the trap above).
//   • DailyPrice — arrives every trading day; the Market pillar reads a price WINDOW
//     (not the latest tick), and the daily price→rescore trigger already refreshes the
//     score (a failed one is caught by the Stage-1 failed-job guard). Flagging every
//     stock daily would be pure noise.
//   • Precise Ownership-fingerprint recompute (the "Signal 2" idea) — DEFERRED: the
//     stored Ownership PillarScore.inputsFingerprint is `fullInputsFingerprint` (folds
//     spec + flow + final, persist.ts:313-326), NOT the raw shareholding hash, so it is
//     NOT a cheap "1 query + hash" comparison — it needs a full ownership recompute.
//     Signal A already catches the genuine "new filing" case, and an in-place
//     shareholding edit already auto-cascades a rescore (the fill bridge). See FLAG.
//
// ── LIFECYCLE ──
// PERIODIC sweep (staleness is drift, not a job event). Self-healing: it OPENS a
// scoring_stale row for a stale stock and RESOLVES (auto:stale-heal) an open one whose
// stock is no longer stale (a later rescore caught up — its snapshot.createdAt now
// post-dates the data). Resolve action = the Stage-2 "Re-score" button (resolutionPath
// =rescore); the next sweep closes the row once the rescore supersedes the snapshot.
//
// CN-8 clean: reads timestamps + writes error rows only — no scoring logic changed.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";
import { reportScoringError } from "../../ingestions/shared/ingestion-error.js";

/** stale = the score is complete, just not current (lower than a failed job, which
 *  has NO fresh score at all). */
const STALE_SEVERITY = "medium" as const;
const STALE_CRON = "scoring:stale";

export interface StaleSweepResult {
  scanned: number;
  stale: number;
  healed: number;
  bySignal: { new_shareholding: number; new_fundamental: number };
}

interface SnapMin { id: string; stockId: string; symbol: string; createdAt: Date }

/**
 * Periodic stale-snapshot sweep. Returns counts. Best-effort — never throws (a
 * detection sweep must not break the scheduler).
 */
export async function sweepStaleSnapshots(): Promise<StaleSweepResult> {
  const result: StaleSweepResult = { scanned: 0, stale: 0, healed: 0, bySignal: { new_shareholding: 0, new_fundamental: 0 } };
  try {
    // 1. IN-FORCE snapshot per stock = the freshest by createdAt (the currently-served
    //    score). Minimal projection; reduce to one per stock.
    const snaps = await prisma.scoreSnapshot.findMany({
      orderBy: [{ stockId: "asc" }, { createdAt: "desc" }],
      select: { id: true, stockId: true, symbol: true, createdAt: true },
    });
    const inForce = new Map<string, SnapMin>();
    for (const s of snaps) if (!inForce.has(s.stockId)) inForce.set(s.stockId, s);
    result.scanned = inForce.size;
    if (inForce.size === 0) return result;

    // 2. Per-stock latest IMMUTABLE-APPEND createdAt of each score input (NEVER updatedAt).
    const [shAgg, fuAgg, qrAgg] = await Promise.all([
      prisma.shareholdingPattern.groupBy({ by: ["stockId"], _max: { createdAt: true, asOnDate: true } }),
      prisma.fundamental.groupBy({ by: ["stockId"], _max: { createdAt: true } }),
      prisma.quarterlyResult.groupBy({ by: ["stockId"], _max: { createdAt: true } }),
    ]);
    const SH = new Map(shAgg.map((r) => [r.stockId, r._max]));
    const FU = new Map(fuAgg.map((r) => [r.stockId, r._max.createdAt]));
    const QR = new Map(qrAgg.map((r) => [r.stockId, r._max.createdAt]));

    // 3. Open scoring_stale rows, keyed by symbol (targetEntity) — to self-heal.
    const openStale = await prisma.ingestionError.findMany({
      where: { source: "scoring", guardType: "scoring_stale", status: "open" },
      select: { id: true, targetEntity: true },
    });
    const openByEntity = new Map(openStale.map((r) => [r.targetEntity ?? "", r.id]));

    for (const s of inForce.values()) {
      const sh = SH.get(s.stockId);
      const shNewer = sh?.createdAt != null && sh.createdAt > s.createdAt;
      const fuNewer = (FU.get(s.stockId) ?? null) !== null && FU.get(s.stockId)! > s.createdAt;
      const qrNewer = (QR.get(s.stockId) ?? null) !== null && QR.get(s.stockId)! > s.createdAt;

      const signals: string[] = [];
      if (shNewer) signals.push("new_shareholding");
      if (fuNewer || qrNewer) signals.push("new_fundamental");

      if (signals.length > 0) {
        if (shNewer) result.bySignal.new_shareholding++;
        if (fuNewer || qrNewer) result.bySignal.new_fundamental++;
        const newestSh = sh?.asOnDate ? sh.asOnDate.toISOString().slice(0, 10) : null;
        const id = await reportScoringError({
          failureType: "stale",
          cron: STALE_CRON,
          symbol: s.symbol, // dedup per stock (no period folded in → one stale row per stock)
          periodKey: null,
          severity: STALE_SEVERITY,
          recomputeAction: "rescore",
          resolutionPath: "rescore",
          snapshotId: s.id,
          expected: `${s.symbol} score reflects current data`,
          observed: `score computed ${s.createdAt.toISOString().slice(0, 16)}; newer input since: ${signals.join(", ")}${newestSh ? ` (latest shareholding ${newestSh})` : ""}`,
          detail: `A score INPUT was inserted after this score was computed (immutable-append createdAt) → the live score is stale. Signals: ${signals.join(", ")}. Re-score to refresh.`,
          degradationDetail: {
            signals,
            snapshotCreatedAt: s.createdAt.toISOString(),
            latestShareholdingCreatedAt: sh?.createdAt?.toISOString() ?? null,
            latestShareholdingAsOnDate: newestSh,
            latestFundamentalCreatedAt: FU.get(s.stockId)?.toISOString() ?? null,
            latestQuarterlyCreatedAt: QR.get(s.stockId)?.toISOString() ?? null,
          },
        });
        if (id) result.stale++;
      } else if (openByEntity.has(s.symbol)) {
        // No longer stale (a rescore caught up) → self-heal the open row.
        await prisma.ingestionError.update({
          where: { id: openByEntity.get(s.symbol)! },
          data: { status: "resolved", resolvedBy: "auto:stale-heal", resolvedAt: new Date(), resolutionNote: `score refreshed (snapshot ${s.id.slice(0, 8)} now post-dates its inputs)` },
        });
        result.healed++;
      }
    }
    return result;
  } catch (err) {
    console.error("[stale-snapshot-guard] sweepStaleSnapshots error:", err);
    return result;
  }
}
