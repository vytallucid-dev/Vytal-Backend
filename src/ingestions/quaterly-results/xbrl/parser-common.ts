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

  return {
    // FY dates and filing date are ALWAYS in OneD, regardless of filingType
    fyStart: extractDate(xml, "DateOfStartOfFinancialYear", "OneD"),
    fyEnd: extractDate(xml, "DateOfEndOfFinancialYear", "OneD"),
    filingDate: extractDate(
      xml,
      "DateOfBoardMeetingWhenFinancialResultsWereApproved",
      "OneD",
    ),

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
  const fyEndMonth = fyEnd.getUTCMonth() + 1; // 1-12
  const isCalendarYear = fyEndMonth === 12;

  const fyEndYear = fyEnd.getUTCFullYear();
  const fiscalYear = `FY${String(fyEndYear).slice(-2)}`;

  if (filingType === "annual") {
    return { quarter: "Y", fiscalYear };
  }

  const reportMonth = reportPeriodEnd.getUTCMonth() + 1;

  let quarter: string;
  if (isCalendarYear) {
    switch (reportMonth) {
      case 3:
        quarter = "Q1";
        break;
      case 6:
        quarter = "Q2";
        break;
      case 9:
        quarter = "Q3";
        break;
      case 12:
        quarter = "Q4";
        break;
      default:
        throw new Error(
          `Unable to derive quarter from reportPeriodEnd month ${reportMonth} ` +
            `(calendar-year filer, expected 3/6/9/12)`,
        );
    }
  } else {
    switch (reportMonth) {
      case 6:
        quarter = "Q1";
        break;
      case 9:
        quarter = "Q2";
        break;
      case 12:
        quarter = "Q3";
        break;
      case 3:
        quarter = "Q4";
        break;
      default:
        throw new Error(
          `Unable to derive quarter from reportPeriodEnd month ${reportMonth} ` +
            `(March-year filer, expected 3/6/9/12)`,
        );
    }
  }

  return { quarter, fiscalYear };
}

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
