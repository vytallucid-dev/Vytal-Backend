// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FORM REGISTRY — two parsers' worth of anchors. L-forms (life) and NL-forms (non-life).
//
// ★ THE STANDARDISATION IS REAL, AND IT IS REAL AT THE LEVEL OF THE LABEL, NOT THE ROW NUMBER.
//   MEASURED across ICICIGI, GODIGIT and NIVABUPA on the same form (NL-1-B-RA): row LABELS, row
//   ORDER and the schedule cross-reference (NL-4 / NL-5 / NL-6) are identical. The row NUMBER is
//   not — NIVABUPA omits "Premium Deficiency" as a health-only insurer, so every row beneath it
//   shifts by one. Anchoring on the number would silently mis-assign four fields on one insurer.
//   Everything here anchors on the LABEL.
//
// ⚠ AND THE FORM NUMBER IS NOT STABLE OUTSIDE THE CORE. Analytical Ratios is NL-20 at NIVABUPA and
//   NL-21 at NIACL, and GODIGIT's FY2023-24 set omits it altogether. The eleven CORE forms
//   (NL-1..NL-7 / L-1..L-7 plus the balance sheet) are identically numbered everywhere, and those
//   are the only ones this lane reads for money. A "find form N" strategy would fail; "find the
//   form whose title matches" works.
//
// ⚠ CONTENT TEST STEPS 3-4 LIVE HERE. A buffer that passed the %PDF- magic check is still not a
//   disclosure until (3) a page carries a non-empty text layer and (4) that text matches a known
//   IRDAI form title. NIACL's 4 MB SPA shell fails (3); a random insurer brochure fails (4).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { RowAnchor } from "./irdai-rows.js";

export type Family = "life" | "general";

export interface FormSpec {
  /** Canonical id, e.g. "L-1-A-RA". */
  id: string;
  family: Family;
  /** How the form announces itself on the page. Used for content-test step (4) and page location. */
  title: RegExp;
  /** Ordered row anchors. Order matters: it bounds each row's slice. */
  anchors: RowAnchor[];
  /** Column geometry for this form. */
  geometry: "segment_blocks" | "period_columns" | "grand_total_last";
}

// ── LIFE ──────────────────────────────────────────────────────────────────────────────────────────
// ⚠ L-1-A-RA carries ONE PERIOD PER PAGE; the columns are business segments and the last is the
//   GRAND TOTAL. HDFCLIFE's FY2026 bundle spans it over 4 pages (quarter, year, prior quarter,
//   prior year) and TWO OF THE FOUR carry no period statement at all in the text layer.
export const L1: FormSpec = {
  id: "L-1-A-RA",
  family: "life",
  title: /FORM\s+L-?\s?1(-A)?(-RA)?\b|REVENUE ACCOUNT/i,
  geometry: "grand_total_last",
  anchors: [
    // ⚠ VINTAGE DRIFT. Recent filings letter this row "(a) Premium"; FY2019-FY2021 filings letter
    //   the three PREMIUM COMPONENTS (a)(b)(c) instead and leave the total unlettered — HDFCLIFE
    //   FY2020 Q1 reads "Premium  L-4  92,92,639 …". The second alternative anchors on the SCHEDULE
    //   REFERENCE rather than the letter, which is the stronger identifier: L-4 is the premium
    //   schedule in every vintage, and no component row carries it.
    { field: "gross_premium_income", match: /\(a\)\s*Premium\b|\bPremium\s+L-?\s?4\b/i },
    // ⚠ THE SAME LETTER DRIFT, AND HERE IT CORRUPTS RATHER THAN OMITS. Because the older vintage
    //   letters these (d)/(e) instead of (b)/(c), a hardcoded "(b)" simply does not match — and the
    //   PREMIUM row above then has no next anchor to stop at, so its slice ran on through three more
    //   rows to 48 cells. "grand_total_last" duly took the last of those 48, and gross_premium_income
    //   came out 0 instead of 6,53,57,676. A missing anchor does not just lose its own field; it
    //   silently changes the value of the field before it. The letter is now the variable it always
    //   was — "Reinsurance ceded" is distinctive enough on its own.
    { field: "reinsurance_ceded", match: /\([a-z]\)\s*Reinsurance ceded/i },
    { field: "reinsurance_accepted", match: /\([a-z]\)\s*Reinsurance accepted/i },
    { field: "sub_total_premium", match: /Sub\s*Total/i },
    { field: "income_from_investments", match: /Income from investments/i },
    { field: "total_revenue_policyholders", match: /TOTAL\s*\(A\)/i },
    // ⚠ MEASURED WRONG, THEN FIXED. FY2019-FY2021 L-1 has NO single commission total: it prints a
    //   bare "Commission" header carrying no numbers, then First year / Renewal / Single commission
    //   rows beneath it. The old bare-word anchor matched that empty header, and the slice returned
    //   HDFCLIFE FY2020 Q1 commission as 25,84,501 — the FIRST-YEAR row — when the true total is
    //   32,22,273 (L-5 "Net Commission Total"; the filing's own 4.93% commission ratio confirms it,
    //   and 25,84,501 would imply 3.95%).
    //   Anchoring on the L-5 schedule reference matches the real total row wherever one exists
    //   ("Commission  L-5  9,763 …") and matches NOTHING in the split vintage, so that vintage now
    //   REFUSES the field. A refused field is a null the ledger explains; a wrong one is invisible.
    { field: "total_commission", match: /Commission\s+L-?\s?5\b/i },
    { field: "total_operating_expenses", match: /Operating expenses related to insurance business/i },
    { field: "benefits_paid_net", match: /Benefits Paid\s*\(Net\)/i },
    { field: "total_b", match: /TOTAL\s*\(B\)/i },
  ],
};

export const L2: FormSpec = {
  id: "L-2-A-PL",
  family: "life",
  title: /FORM\s+L-?\s?2(-A)?(-PL)?\b|PROFIT AND LOSS ACCOUNT|Shareholders.{0,3} Account/i,
  geometry: "period_columns",
  anchors: [
    { field: "transfer_from_policyholders", match: /Amounts? transferred from the Policyholders/i },
    { field: "income_from_investments_shareholders", match: /Income from investments/i },
    { field: "total_a_sh", match: /TOTAL\s*\(A\)/i },
    { field: "total_b_sh", match: /TOTAL\s*\(B\)/i },
    // ⚠ VINTAGE DRIFT, same family as L-1's premium row. The old pattern made "Loss" MANDATORY,
    //   so it read "Profit/(Loss) before tax" but not the plain "Profit before tax" that every
    //   FY2019-FY2021 filing uses. That single missing option is why 22 of these units surfaced
    //   no profit at all. The clause is now optional; the rest of the anchor is unchanged.
    { field: "profit_before_tax", match: /Profit\s*(?:\/\s*\(?Loss\)?)?\s*before\s*tax/i },
    { field: "tax", match: /Provision for taxation/i },
    { field: "net_profit", match: /Profit\s*(?:\/\s*\(?Loss\)?)?\s*after\s*tax/i },
    // ⚠ THE MIXED-GRAIN ROW. D1b, measured on HDFCLIFE FY2026: this row reads 11,08,798 in BOTH the
    //   quarter and the ytd column, because a carried-forward balance is a STOCK, not a flow. It sits
    //   inside L-2-A-PL, which is otherwise entirely flows. Anchored here so the guard sees it and
    //   refuses it for a quarterly row rather than taking the quarter column and being right by luck.
    { field: "appropriations_carried_forward", grain: "point_in_time", match: /Profit\s*(?:\/\s*\(?Loss\)?)?\s*carried\s*forward to the Balance Sheet/i },
  ],
};

export const L3: FormSpec = {
  id: "L-3-A-BS",
  family: "life",
  title: /FORM\s+L-?\s?3(-A)?(-BS)?\b|BALANCE SHEET/i,
  geometry: "period_columns",
  // ⚠ EVERY ROW ON A BALANCE SHEET IS POINT-IN-TIME. This form has no quarter/ytd columns at all —
  //   its two columns are "as at <this date>" and "as at <the prior date>" — so there is nothing to
  //   select and, per the ruling, nothing to derive. A QUARTERLY row takes NOTHING from this form.
  anchors: [
    { field: "share_capital", grain: "point_in_time", match: /Share capital\b/i },
    { field: "reserves_and_surplus", grain: "point_in_time", match: /Reserves and surplus/i },
    { field: "fair_value_change_account", grain: "point_in_time", match: /fair value change account/i },
    { field: "borrowings", grain: "point_in_time", match: /BORROWINGS\b/i },
    { field: "policyholders_funds", grain: "point_in_time", match: /POLICYHOLDERS.{0,3} FUNDS/i },
    { field: "total_sources_of_funds", grain: "point_in_time", match: /TOTAL\b/i },
  ],
};

// ── NON-LIFE ──────────────────────────────────────────────────────────────────────────────────────
export const NL1: FormSpec = {
  id: "NL-1-B-RA",
  family: "general",
  title: /FORM\s+NL-?\s?1(-B)?(-RA)?\b|REVENUE ACCOUNT/i,
  geometry: "segment_blocks",
  anchors: [
    { field: "premium_earned", match: /Premiums?\s+[Ee]arned\s*\(Net\)/i },
    { field: "profit_on_sale", match: /Profit\s*\/?\s*Loss on\s+[Ss]ale/i },
    { field: "income_from_investments", match: /Interest,\s*Dividend\s*&\s*Rent/i },
    { field: "total_revenue", match: /Total\s*\(A\)/i },
    { field: "incurred_claims", match: /Claims\s+Incurred\s*\(Net\)/i },
    { field: "net_commission", match: /Commission\b(?!\s*Ratio)/i },
    { field: "total_operating_expenses_related_to_insurance", match: /Operating\s+Expenses\s+related\s+to\s+Insurance/i },
    { field: "premium_deficiency", match: /Premium\s+Deficiency/i },
    { field: "total_b", match: /Total\s*\(B\)/i },
    { field: "underwriting_profit_or_loss", match: /Operating\s+Profit\s*\/?\s*\(?Loss\)?/i },
  ],
};

export const NL2: FormSpec = {
  id: "NL-2-B-PL",
  family: "general",
  title: /FORM\s+NL-?\s?2(-B)?(-PL)?\b|PROFIT AND LOSS ACCOUNT/i,
  geometry: "period_columns",
  anchors: [
    { field: "operating_profit", match: /OPERATING PROFIT\s*\/?\s*\(?LOSS\)?/i },
    { field: "income_from_investments", match: /Interest,\s*Dividend\s*&\s*Rent/i },
    { field: "total_a", match: /Total\s*\(A\)/i },
    { field: "total_b", match: /TOTAL\s*\(B\)/i },
    // ⚠ VINTAGE DRIFT, same family as L-1's premium row. The old pattern made "Loss" MANDATORY,
    //   so it read "Profit/(Loss) before tax" but not the plain "Profit before tax" that every
    //   FY2019-FY2021 filing uses. That single missing option is why 22 of these units surfaced
    //   no profit at all. The clause is now optional; the rest of the anchor is unchanged.
    { field: "profit_before_tax", match: /Profit\s*\/?\s*\(?Loss\)?\s*Before Tax/i },
    { field: "tax", match: /Provision for Tax(?:ation)?/i },
    { field: "net_profit", match: /Profit\s*(?:\/\s*\(?Loss\)?)?\s*after\s*tax/i },
  ],
};

export const NL3: FormSpec = {
  id: "NL-3-B-BS",
  family: "general",
  title: /FORM\s+NL-?\s?3(-B)?(-BS)?\b|BALANCE SHEET/i,
  geometry: "period_columns",
  // ⚠ Same ruling as L-3-A-BS: every row is point-in-time.
  anchors: [
    { field: "share_capital", grain: "point_in_time", match: /SHARE\s*CAPITAL/i },
    { field: "reserves_and_surplus", grain: "point_in_time", match: /RESERVES AND SURPLUS/i },
    { field: "fair_value_change_account", grain: "point_in_time", match: /FAIR VALUE CHANGE ACCOUNT/i },
    { field: "borrowings", grain: "point_in_time", match: /BORROWINGS/i },
    { field: "total_sources_of_funds", grain: "point_in_time", match: /TOTAL\b/i },
  ],
};

export const FORMS: FormSpec[] = [L1, L2, L3, NL1, NL2, NL3];

/** Any known IRDAI form title — content-test step (4). */
const ANY_FORM_TITLE =
  /FORM\s+N?L-?\s?\d{1,2}[A-Z]?\b|IRDAI\s+PUBLIC\s+DISCLOSURE|REVENUE ACCOUNT|BALANCE SHEET|Disclosures\s*-\s*NON-\s*LIFE/i;

export type DocVerdict =
  | { ok: true; formTitlePages: number[] }
  | { ok: false; reason: "no_text_layer" | "not_an_irdai_document"; detail: string };

/**
 * ⚠ CONTENT TEST steps (3) and (4). Run AFTER the %PDF- magic check in irdai-http.
 *   Step (3) catches a PDF that is real but has no text layer (a pure scan we cannot read).
 *   Step (4) catches a real, readable PDF that is simply not a disclosure — a brochure, an annual
 *   report cover, a press release. Without it the lane would happily parse a marketing deck and
 *   report "0 fields found" instead of "wrong document".
 */
export function documentContentTest(pageTexts: string[]): DocVerdict {
  const withText = pageTexts.filter((p) => p.replace(/\s/g, "").length > 0);
  if (withText.length === 0) {
    return {
      ok: false,
      reason: "no_text_layer",
      detail: `${pageTexts.length} page(s), none with any extractable text — this is an image-only PDF and this lane does not OCR`,
    };
  }
  const hits: number[] = [];
  pageTexts.forEach((p, i) => {
    if (ANY_FORM_TITLE.test(p)) hits.push(i + 1);
  });
  if (hits.length === 0) {
    return {
      ok: false,
      reason: "not_an_irdai_document",
      detail: `${pageTexts.length} page(s) with text but no IRDAI form title on any of them — wrong document`,
    };
  }
  return { ok: true, formTitlePages: hits };
}

/**
 * ⚠⚠ WHICH LINE OF BUSINESS IS THIS PAGE? The segment guard depends on it.
 *
 *   MEASURED, NIACL — the old one-segment-per-page layout is a live silent-error risk:
 *     FY21 Q2  p2 "Fire Revenue Account"          1 block, premium 76,62,828  (= Rs   766 cr)
 *              p3 "Marine Revenue Account"        1 block, premium 10,39,661
 *              p4 "Miscellaneous Revenue Account" 1 block, premium 5,69,91,617
 *     The true consolidated figure is the SUM, about Rs 6,569 cr. A parser that reads page 2,
 *     sees one block, and takes "the last block" writes FIRE as the company total — 8.6x low, and
 *     a completely plausible number that cross-foots perfectly because it is a real total of a
 *     real thing.
 *
 *   ⚠ THE PAGE TITLE ALONE IS NOT ENOUGH IN EITHER DIRECTION:
 *     - NIACL FY24 Q1 p2 is titled "Fire Revenue Account" but carries ALL FOUR blocks — a stale
 *       title left on a redesigned form. Refusing on the title would lose a good page.
 *     - A monoline insurer (Niva Bupa, Star Health: health only) legitimately has one block and
 *       that block IS the company total. Refusing every single-block page would lose them entirely.
 *   So the guard is: ONE BLOCK + a named line of business + the document carries OTHER revenue
 *   pages => this is a per-segment page, not the consolidated one. REFUSED.
 */
export function segmentOfPage(pageText: string): string | null {
  const m = pageText.match(/\b(Fire|Marine|Miscellaneous|Motor|Health|Total)\b\s+Revenue\s+Account/i);
  return m ? m[1].toLowerCase() : null;
}

/** Locate the page(s) that carry a given form. Returns page indices (0-based). */
export function findFormPages(pageTexts: string[], spec: FormSpec): number[] {
  const out: number[] = [];
  pageTexts.forEach((p, i) => {
    if (!spec.title.test(p)) return;
    // Require at least two of the form's anchors to actually appear — a title alone is often just
    // the index page listing every form name.
    const n = spec.anchors.filter((a) => new RegExp(a.match.source, a.match.flags.replace("g", "")).test(p)).length;
    if (n >= 2) out.push(i);
  });
  return out;
}
