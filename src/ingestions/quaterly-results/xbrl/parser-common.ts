// File: src/ingestions/quaterly-results/xbrl/parser-common.ts (NEW)

import { extractDate, extractNumber } from "./extract.js";
import {
  BALANCE_SHEET_CONTEXT,
  ANNUAL_PNL_CONTEXT,
  QUARTERLY_PNL_CONTEXT,
} from "./contexts.js";

export interface CommonParsedMetadata {
  fyStart: Date | null;
  fyEnd: Date | null;
  reportPeriodStart: Date | null;
  reportPeriodEnd: Date | null;
  filingDate: Date | null; // DateOfBoardMeetingWhenFinancialResultsWereApproved
}

/**
 * Extract dates that are present in every taxonomy and every filing.
 * Used both for fiscal period derivation and as filing metadata.
 */
export function extractCommonMetadata(
  xml: string,
  filingType: "quarterly" | "annual",
): CommonParsedMetadata {
  // Reporting-period dates: OneD for quarterly, FourD for annual
  const reportContext =
    filingType === "quarterly"
      ? QUARTERLY_PNL_CONTEXT // "OneD"
      : ANNUAL_PNL_CONTEXT; // "FourD"

  // ── S3.3a · FILING-DATE FALLBACK ──────────────────────────────────────────
  // The board-meeting date is absent from the older filings (218 of the 246
  // FY18–FY22 NBFC documents), and a null filingDate makes every family parser
  // THROW — the whole document is lost over one metadata field.
  //
  // The legacy parser has carried a three-step fallback for this all along
  // (parser-legacy-common.ts:630 for annual, :391 for quarterly): try OneD, then
  // the reporting context, then fall back to the period-end date. Copied here.
  //
  // ⚠ WHAT THE SUBSTITUTE DOES TO decideIngest (picker.ts:154). That compares the
  //   NSE filings API's own filingDateParsed against the STORED filingDate:
  //       filing.filingDateParsed > existing.filingDate  ->  "refresh"
  //   A period-end substitute is always EARLIER than the real board-meeting date
  //   (a company files weeks after the period closes), so the comparison tips
  //   toward "refresh", never toward "skip". The bias is one-directional and
  //   safe: at worst a row is re-ingested redundantly. It cannot cause a missed
  //   ingest, and it cannot duplicate — fetchExistingRow keys on
  //   (stock, period, basis), so a refresh overwrites the same row in place.
  const filingDate =
    extractDate(xml, "DateOfBoardMeetingWhenFinancialResultsWereApproved", "OneD") ??
    extractDate(xml, "DateOfBoardMeetingWhenFinancialResultsWereApproved", reportContext) ??
    extractDate(xml, "DateOfEndOfReportingPeriod", reportContext);

  return {
    // FY dates and filing date are ALWAYS in OneD, regardless of filingType
    fyStart: extractDate(xml, "DateOfStartOfFinancialYear", "OneD"),
    fyEnd: extractDate(xml, "DateOfEndOfFinancialYear", "OneD"),
    filingDate,

    // Reporting-period dates vary by filing type
    reportPeriodStart: extractDate(
      xml,
      "DateOfStartOfReportingPeriod",
      reportContext,
    ),
    reportPeriodEnd: extractDate(
      xml,
      "DateOfEndOfReportingPeriod",
      reportContext,
    ),
  };
}

/**
 * Derive (quarter, fiscalYear) labels from period dates.
 *
 * Standard Indian fiscal year (March):
 *   Apr–Jun = Q1, Jul–Sep = Q2, Oct–Dec = Q3, Jan–Mar = Q4
 *   FY label = year in which the fiscal year ENDS (period ending Sep 2025 → Q2 FY26)
 *
 * Calendar fiscal year (December):
 *   Jan–Mar = Q1, Apr–Jun = Q2, Jul–Sep = Q3, Oct–Dec = Q4
 *   FY label = the calendar year (period ending Mar 2025 → Q1 FY25)
 *
 * Auto-detected from fyEnd month — no need to thread fiscalYearEnd through parsers.
 */
export function deriveFiscalPeriod(
  reportPeriodEnd: Date,
  fyStart: Date,
  fyEnd: Date,
  filingType: "quarterly" | "annual",
): { quarter: string; fiscalYear: string } {
  // ⚠ F2 — THE DECLARED-WINDOW GUARD. Runs BEFORE anything is derived, because a
  //   window this fails means `fyEnd` cannot be trusted, and `fyEnd` sole-sources
  //   BOTH the FY label and (via the reconstruction below) the quarter index.
  assertDeclaredWindowIsPossible(fyStart, fyEnd);

  const fyEndMonth = fyEnd.getUTCMonth() + 1; // 1-12
  const isCalendarYear = fyEndMonth === 12;

  const fyEndYear = fyEnd.getUTCFullYear();
  const fiscalYear = `FY${String(fyEndYear).slice(-2)}`;

  if (filingType === "annual") {
    return { quarter: "Y", fiscalYear };
  }

  const reportMonth = reportPeriodEnd.getUTCMonth() + 1;

  // ⚠ S4.3 — GENERALISED FROM THE DECLARED FISCAL-YEAR END.
  //
  //   The previous form was a hardcoded two-branch switch: December, else "March".
  //   Every OTHER year-end fell into the March branch, so a September filer got the
  //   right FY label (taken from fyEnd) and a quarter index rotated by two.
  //   Measured on SIEMENS, which files October–September: 33 quarters stored with
  //   rotated labels, and because loadMomentumStandalone orders by
  //   (fiscalYear, quarter) the engine's consecutiveTail saw 4 of them.
  //
  //   The fiscal year is reconstructed BACKWARDS FROM fyEnd rather than read from
  //   fyStart, deliberately: fyStart is corrupt in real filings (CANBK declares
  //   2022-04-01 .. 2022-03-31 — an end before its start; DELHIVERY declares a
  //   six-month "year"). fyEnd already sole-sources the FY label, so using it for
  //   the quarter too keeps ONE source of truth and cannot disagree with itself.
  //   `fyStart` is intentionally not consulted; see the validity-guard note in the
  //   Stage-4 report for what SHOULD reject an impossible window.
  //
  //   Reproduces both previously-supported calendars EXACTLY:
  //     Dec (M=12): start Jan of the same year → 3→Q1 6→Q2 9→Q3 12→Q4
  //     Mar (M=3) : start Apr of the prior year → 6→Q1 9→Q2 12→Q3 3→Q4
  //   and additionally handles September, June and any other quarter-aligned end.
  const fyStartMonth = (fyEndMonth % 12) + 1;
  const fyStartYear = fyEndMonth === 12 ? fyEndYear : fyEndYear - 1;
  const monthsFromStart =
    (reportPeriodEnd.getUTCFullYear() - fyStartYear) * 12 +
    (reportMonth - fyStartMonth);

  if (monthsFromStart < 0 || monthsFromStart > 11 || (monthsFromStart + 1) % 3 !== 0) {
    throw new Error(
      `Unable to derive quarter: reportPeriodEnd month ${reportMonth} of ` +
        `${reportPeriodEnd.getUTCFullYear()} is ${monthsFromStart} month(s) into the ` +
        `fiscal year ending ${fyEndMonth}/${fyEndYear} — not a quarter boundary of it ` +
        `(expected 2, 5, 8 or 11 months in)`,
    );
  }
  const quarter = `Q${Math.floor(monthsFromStart / 3) + 1}`;
  void isCalendarYear; // retained for readability of the doc comment above

  return { quarter, fiscalYear };
}

/**
 * ★★ F2 — IS THE DECLARED FISCAL YEAR A POSSIBLE ONE? Throws if not.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────────────
 * S4.3 made `fyEnd` the SOLE source of truth — the FY label and the quarter index are
 * both reconstructed backwards from it, and `fyStart` is deliberately never consulted,
 * because `fyStart` is corrupt in real filings. That was the right call for DERIVING.
 * It left one exposure: nothing then checks whether `fyEnd` is credible at all. When a
 * filer puts a REPORTING-period end into the fiscal-year-end tag, the resulting year is
 * a fiction — and if the reported period happens to land on a quarter boundary of that
 * fiction, the boundary test below passes and a confidently wrong label is written.
 *
 * `fyStart` is worthless for deriving and valuable for CORROBORATING. That asymmetry is
 * the whole design: this function reads `fyStart` only to ask whether `fyEnd` can be
 * believed, and nothing downstream of it reads `fyStart` at all.
 *
 * ─── THE RULE, AND WHY IT IS NOT A LENGTH BAND ──────────────────────────────────────
 * MEASURED over EVERY filing we hold — 23,640 documents, 100% fetched, 100% carrying a
 * declared window, backing 29,535 stored rows. The distribution is not a spread around
 * twelve; it is a spike with a legal sidelobe and a little junk:
 *
 *      0 months     2 filings   CANBK, IOB — fyEnd BEFORE fyStart (2022-04-01..2022-03-31)
 *      6 months     2 filings   DELHIVERY  — 2022-04-01..2022-09-30
 *      9 months     3 rows      GILLETTE   — 2024-07-01..2025-03-31   ← LEGAL
 *     12 months   29,504 rows   the normal year
 *     15 months      20 rows    ACC · AMBUJACEM · CEMPRO · IGIL · NESTLEIND · POWERINDIA  ← LEGAL
 *     18 months       4 rows    SIEMENS    — 2024-10-01..2026-03-31   ← LEGAL
 *
 * There is NO 11-month, 13-month or 14-month window anywhere in the corpus. So a band
 * has nothing to sit on, and every band tested destroys real data:
 *
 *   · "outside 11–13 months"                    → BREAKS 24 correct labels
 *   · "shorter than a year OR longer than 15m"  → BREAKS  7 correct labels
 *        (SIEMENS ×4, an 18-month Sep→Mar transition whose labels are RIGHT;
 *         GILLETTE ×3, a 9-month Jun→Mar transition whose labels are RIGHT)
 *
 * The discriminator is not LENGTH, it is WHERE THE WINDOW LANDS. Companies Act 2013
 * s.2(41) requires a financial year ending 31 March and permits a transitional period
 * to reach it. So every legal irregular window in the corpus — 9, 15 and 18 months
 * alike — ends on 31 March, and the one illegal one (DELHIVERY's six months) ends on
 * 30 September. That is the rule:
 *
 *      REJECT iff  fyEnd is not after fyStart
 *              OR  (the window is not 12 months AND fyEnd is not 31 March)
 *
 * ⚠ NO UPPER LENGTH CEILING, DELIBERATELY. An 18-month ceiling was measured and is
 *   EXACTLY as safe on this corpus (same 2 rescues, same 0 breaks) — it is unexercised.
 *   It is left out because an over-long window with a SOUND fyEnd still yields a correct
 *   label (the label comes from fyEnd; fyStart contributes nothing), so a ceiling can
 *   only ever produce a false rejection, never catch a real fault. Add it as one clause
 *   here if a tripwire is wanted; do not expect it to fire.
 *
 * ⚠ A NON-MARCH YEAR-END IS NOT WHAT THIS REJECTS. A stable September filer (SIEMENS,
 *   pre-transition, 53 filings) or a December filer (7 stocks, 502 rows) declares a
 *   12-month window and passes on the first clause. The 31-March test applies ONLY to
 *   windows that are not a year — i.e. only to periods claiming to be transitions.
 *
 * ─── WHAT IT CHANGES, EXHAUSTIVELY ──────────────────────────────────────────────────
 * 29,533 of 29,535 stored rows re-derive BYTE-IDENTICALLY. Two change, and both are the
 * intended rescue: DELHIVERY's Jul–Sep 2022 pair, which the shipped deriver labels
 * FY22Q4 (the truth is FY23Q2) off a fabricated September year-end. By declared
 * fiscal-year-end month: March 28,924/28,924 · December 502/502 · June 31/31 · September
 * 78/80 (the two are DELHIVERY's fiction; the 76 real September rows are untouched).
 *
 * ─── WHAT HAPPENS ON REJECTION, AND WHY IT IS A REFUSAL RATHER THAN A FALLBACK ──────
 * It throws, exactly as the quarter-boundary check below already does, so the existing
 * machinery applies unchanged: the parse fails, `scan.ts` logs status "failed" with the
 * reason, and NO ROW IS WRITTEN. Nothing is overwritten and nothing is guessed.
 *
 * Falling back to `stocks.fiscalYearEnd` was considered and REFUSED. That column is an
 * enum of exactly two values (march=497, december=7) and it is a property of the STOCK,
 * not of the FILING. MEASURED: 9 stocks declare more than one fiscal-year-end month
 * across their history, and for FOUR the column cannot express the truth at all —
 * SIEMENS declares September on 53 filings, GILLETTE June on 25, ENRIN September on 6,
 * LINDEINDIA December on 31, and the column reads "march" for every one of them. Those
 * four are precisely the population S4.3 exists to serve, so the fallback's failure
 * mode is concentrated exactly where the guard matters most — and it is silent.
 *
 * It would, as it happens, get DELHIVERY right (that filer really is a March filer). That
 * is luck, not construction: at parse time nothing distinguishes "the column agrees with
 * this filing" from "the column is stale". A refusal costs one quarter of one stock and
 * says so in the log; a guessed label enters `quarterly_results` as the (fiscalYear,
 * quarter) ORDERING KEY, where being wrong does not read as missing data — it silently
 * truncates `consecutiveTail` and removes the stock from Momentum without a trace. That
 * asymmetry is why this refuses.
 */
function assertDeclaredWindowIsPossible(fyStart: Date, fyEnd: Date): void {
  if (fyEnd.getTime() <= fyStart.getTime()) {
    throw new Error(
      `Impossible declared fiscal year: end ${iso(fyEnd)} is not after start ${iso(fyStart)}. ` +
        `Refusing to derive a period label from a fiscal-year end this filing contradicts.`,
    );
  }

  const months =
    (fyEnd.getUTCFullYear() - fyStart.getUTCFullYear()) * 12 +
    (fyEnd.getUTCMonth() - fyStart.getUTCMonth()) +
    1;
  if (months === 12) return;

  // Not a year ⇒ it can only be a transition, and a transition must land on 31 March.
  const landsOnMarch31 = fyEnd.getUTCMonth() === 2 && fyEnd.getUTCDate() === 31;
  if (landsOnMarch31) return;

  throw new Error(
    `Impossible declared fiscal year: ${iso(fyStart)}..${iso(fyEnd)} spans ${months} month(s), ` +
      `which is neither a 12-month year nor a transitional period ending 31 March ` +
      `(Companies Act 2013 s.2(41)). The declared fiscal-year END is therefore not credible, ` +
      `and it is the sole source of both the FY label and the quarter index. Refusing to write a label.`,
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Common per-share metrics that exist in all taxonomies.
 */
export function extractCommonPerShare(
  xml: string,
  pnlContext: string,
  bsContext: string,
): {
  basicEps: number | null;
  dilutedEps: number | null;
  faceValueShare: number | null;
  paidUpEquityCapital: number | null;
} {
  return {
    basicEps:
      extractNumber(
        xml,
        "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
        pnlContext,
      ) ??
      extractNumber(
        xml,
        "BasicEarningsPerShareAfterExtraordinaryItems",
        pnlContext,
      ) ??
      extractNumber(xml, "BasicEarningsLossPerShare", pnlContext),
    dilutedEps:
      extractNumber(
        xml,
        "DilutedEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
        pnlContext,
      ) ??
      extractNumber(
        xml,
        "DilutedEarningsPerShareAfterExtraordinaryItems",
        pnlContext,
      ) ??
      extractNumber(xml, "DilutedEarningsLossPerShare", pnlContext),
    faceValueShare:
      extractNumber(xml, "FaceValueOfEquityShareCapital", bsContext) ??
      extractNumber(xml, "FaceValueOfEquityShareCapital", pnlContext),
    paidUpEquityCapital:
      extractNumber(xml, "PaidUpValueOfEquityShareCapital", bsContext) ??
      extractNumber(xml, "PaidUpValueOfEquityShareCapital", pnlContext),
  };
}

/**
 * Sum the values of multiple tags in the same context. If ALL are null,
 * returns null. Used for fields that XBRL splits across multiple tags
 * (e.g. NBFC payables = MSME + Others).
 */
export function sumNullableTags(
  xml: string,
  tagNames: string[],
  contextRef: string,
  prefix: string = "in-capmkt",
): number | null {
  let total = 0;
  let sawAny = false;
  for (const tag of tagNames) {
    const v = extractNumber(xml, tag, contextRef, prefix);
    if (v !== null) {
      sawAny = true;
      total += v;
    }
  }
  return sawAny ? total : null;
}
