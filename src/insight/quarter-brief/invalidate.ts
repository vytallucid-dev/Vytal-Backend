// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — INVALIDATION ON CORRECTION. Called from applyRawFieldEdit's cascade dispatch.
//
// ── ★ SCOPE IS NARROWER THAN THE CASCADE, AND DELIBERATELY SO ──────────────────────────────────────
// applyRawFieldEdit can correct 10 tables. A brief reads TWO families of them: the five QUARTERLY
// result tables, and — since Stage 4 — the five ANNUAL `*_fundamentals` tables.
//
// ── ⚠⚠ THE ANNUAL HALF IS THE SECOND INSTANCE OF THIS FILE'S OWN COUPLING WARNING (4e) ────────────
// This header used to say: "It carries NO balance-sheet fact and does NO annual read (fact-block.ts
// rule 1), so an edit to `Fundamental` — an annual row — cannot change a single sentence in any brief."
//
// THAT PREMISE DIED THE MOMENT THE ANNUAL SECTION SHIPPED. A Q4 brief now reads debt, equity, assets,
// cash flow, per-share figures and a lender's margin straight off those tables, so a correction to any
// of them can falsify prose a reader is looking at. The two decisions lived in different files —
// fact-block.ts's rule 1 and this Set — and they moved together, in one change, because a widened
// section with an un-widened invalidator is not untidy but WRONG: it leaves corrected data behind
// uncorrected prose, silently, with the fingerprint showing no reason to regenerate.
//
// The warning below was written for the health-pinning case and is now on its second instance. Treat
// it as the general rule it evidently is: WHEN A BRIEF LEARNS TO READ A NEW TABLE, THIS SET WIDENS IN
// THE SAME COMMIT.
//
// ── WHY THE PERIOD KEY IS DIFFERENT FOR AN ANNUAL EDIT, AND WHY IT IS Q4 ─────────────────────────
// The cascade hands this function a periodKey. For a quarterly edit that is "FY26Q2". For an ANNUAL
// edit it is the fiscal year — there is no quarter to name — and the brief it can falsify is that
// year's Q4, because Q4 is the only quarter that carries the section. So an annual edit is normalised
// to `<fiscalYear>Q4` and rippled forward from there, exactly as a Q4 quarterly edit would be.
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
//
// ⚠ AN ANNUAL EDIT OVER-MARKS FURTHER THAN A QUARTERLY ONE, AND THAT IS ACCEPTED, NOT OVERLOOKED.
// Correcting FY26's balance sheet anchors at FY26Q4 and marks every later brief too — but only FY26Q4
// can actually have read it, because Q1 to Q3 carry no annual section and FY27Q4 reads FY27's own
// annual row. So an annual edit is one true row plus up to four free restores. The narrower rule
// ("an annual edit marks exactly one brief") was deliberately NOT written: it would be a SECOND
// forward-ripple rule living beside the first, and the first already reaches the right rows at a price
// the fingerprint refunds. One rule that over-marks beats two that can disagree.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";
import { markBriefsStale } from "./write.js";

/** The five QUARTERLY result tables. `periodKey` arrives as "FY26Q2". */
const BRIEF_QUARTERLY_TABLES = new Set([
  "QuarterlyResult",
  "BankingQuarterlyResult",
  "NbfcQuarterlyResult",
  "LifeInsuranceQuarterlyResult",
  "GeneralInsuranceQuarterlyResult",
]);

/** ★ THE FIVE ANNUAL TABLES — added in the SAME change as the annual section (4e). `periodKey` arrives
 *  as a bare fiscal year ("FY26"), because an annual row has no quarter; re-derive.ts sets it that way
 *  for all five. It is normalised to that year's Q4 below, which is the only quarter whose brief can
 *  have read it. */
const BRIEF_ANNUAL_TABLES = new Set([
  "Fundamental",
  "BankingFundamental",
  "NbfcFundamental",
  "LifeInsuranceFundamental",
  "GeneralInsuranceFundamental",
]);

export interface BriefInvalidation {
  applicable: boolean;
  marked: number;
  enqueued: number;
}

/**
 * The (fiscalYear, quarter) a correction to `table` at `periodKey` starts rippling from, or null when
 * this table is not a brief input at all.
 *
 * ⚠ THE ANNUAL BRANCH IS NOT A CONVENIENCE. An annual edit names a YEAR, and the brief that read it is
 * that year's Q4 — the only quarter that carries the annual section (annual-section.ts, gate 1). Anchor
 * it anywhere else and the forward ripple starts from the wrong place: at Q1 it would needlessly
 * withdraw three correct briefs, and past Q4 it would withdraw none of the ones that are actually wrong.
 */
function resolvePeriod(table: string, periodKey: string): { fiscalYear: string; quarter: string } | null {
  if (BRIEF_QUARTERLY_TABLES.has(table)) {
    const m = /^(FY\d{2,4})(Q[1-4])$/.exec(periodKey);
    return m ? { fiscalYear: m[1], quarter: m[2] } : null;
  }
  if (BRIEF_ANNUAL_TABLES.has(table)) {
    const m = /^(FY\d{2,4})$/.exec(periodKey);
    return m ? { fiscalYear: m[1], quarter: "Q4" } : null;
  }
  return null;
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
  const resolved = resolvePeriod(table, periodKey);
  if (!resolved) return { applicable: false, marked: 0, enqueued: 0 };
  const { fiscalYear, quarter } = resolved;

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
