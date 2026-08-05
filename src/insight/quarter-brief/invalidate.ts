// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — INVALIDATION ON CORRECTION. Called from applyRawFieldEdit's cascade dispatch.
//
// ── ★ SCOPE IS NARROWER THAN THE CASCADE, AND DELIBERATELY SO ──────────────────────────────────────
// applyRawFieldEdit can correct 10 tables. A brief reads exactly ONE family of them: the five
// QUARTERLY result tables. It carries NO balance-sheet fact and does NO annual read (fact-block.ts
// rule 1), so an edit to `Fundamental` — an annual row — cannot change a single sentence in any brief.
// Marking briefs stale for it would withdraw correct prose from readers for a correction that does not
// touch it, and then pay to regenerate identical text.
//
// The health section is likewise immune: it is PINNED to the snapshot in force at generation time and
// dated, so a price correction that moves the live score does not falsify a brief that says
// "as scored on 2026-08-03".
//
// ⚠⚠ THE NARROW SCOPE IS SAFE *BECAUSE* OF PINNING, AND THAT IS A COUPLING, NOT A COINCIDENCE.
// If the health section is ever UNPINNED — made to show the current score rather than the one in force
// when the brief was written — then every input that can move a score starts being able to falsify a
// brief, and this scope must widen in the SAME change: price tables, shareholding, and anything else
// the scorer reads. Unpin without widening here and every brief silently keeps a stale score behind a
// date that no longer means anything. The two decisions live in different files and must move together.
//
// ── THE FORWARD RIPPLE, AND WHY ~5 ROWS ────────────────────────────────────────────────────────────
// markBriefsStale marks the edited period AND every later one, because a brief's facts are comparative.
// But only ~5 of those can actually have moved: a fact block reads its own row, the previous quarter,
// the year-ago quarter, and a 4-quarter margin window, so an edit to P reaches P through P+4. Measured
// on DIXON across all 20 edit positions: 210 marked, 59 actually affected — 71.9% restore FREE on a
// matching fingerprint. The over-marking is intentional (hide first, ask later); writeQuarterBrief
// checks the hash before spending anything, so the excess costs a DB read, not an AI call.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";
import { markBriefsStale } from "./write.js";

/** The five QUARTERLY result tables — the only inputs a brief actually reads. */
const BRIEF_INPUT_TABLES = new Set([
  "QuarterlyResult",
  "BankingQuarterlyResult",
  "NbfcQuarterlyResult",
  "LifeInsuranceQuarterlyResult",
  "GeneralInsuranceQuarterlyResult",
]);

export interface BriefInvalidation {
  applicable: boolean;
  marked: number;
  enqueued: number;
}

/**
 * Withdraw every brief a correction could have falsified, and queue each one to come back.
 *
 * ⚠ BOTH HALVES, ALWAYS. Marking stale without enqueueing regeneration is a silent feature deletion —
 * the row is hidden on both surfaces and nothing brings it back. They belong in one call for that
 * reason.
 */
export async function invalidateBriefsForEdit(
  table: string,
  symbol: string,
  periodKey: string,
  reason: string,
  triggeredBy: string,
): Promise<BriefInvalidation> {
  if (!BRIEF_INPUT_TABLES.has(table)) return { applicable: false, marked: 0, enqueued: 0 };

  const m = /^(FY\d{2,4})(Q[1-4])$/.exec(periodKey);
  if (!m) return { applicable: false, marked: 0, enqueued: 0 };
  const [, fiscalYear, quarter] = m;

  const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true } });
  if (!stock) return { applicable: false, marked: 0, enqueued: 0 };

  const marked = await markBriefsStale(stock.id, fiscalYear, quarter, reason);
  if (marked === 0) return { applicable: true, marked: 0, enqueued: 0 };

  // Queue every stale row. writeQuarterBrief already orders restore-before-generate, so a row whose
  // facts did not move flips back to live for the price of a hash comparison — no special logic here.
  const stale = await prisma.quarterBrief.findMany({
    where: { stockId: stock.id, status: "stale" },
    select: { quarter: true, fiscalYear: true },
  });
  for (const s of stale) {
    await enqueueJob({
      type: JobTypes.QUARTER_BRIEF,
      payload: { symbol, periodKey: `${s.fiscalYear}${s.quarter}` },
      triggeredBy,
    });
  }
  return { applicable: true, marked, enqueued: stale.length };
}
