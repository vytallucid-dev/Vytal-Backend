// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ROW SLICING — a row is the text BETWEEN TWO ANCHORS, never a line.
//
// ⚠ MEASURED on NIACL NL-1-B-RA, quarter ended 30-06-2023. The text layer emits:
//        "1 Premiums Earned (Net) NL-4-Premium"
//        "Schedule 70052 70052 64228 64228 11831 11831 9099 9099 710017 ..."
//   The label and its schedule reference are on one line; the sixteen numbers are on the next.
//   A line-based reader finds the label line, tokenises ZERO cells, and — if it defaulted a missing
//   value to null rather than raising — would write nulls over a period that is fully present.
//   That is precisely the quiet failure B1d exists to forbid, and it appears on the very first
//   non-life document in the corpus.
//
// ⚠ AND THE OPPOSITE HAZARD. Reading "to the end of the paragraph" swallows the NEXT row's numbers,
//   which produces a row of 32 cells that then fails the width check — loud, but only by luck.
//   The slice is therefore bounded by the NEXT anchor in the form's own row order.
//
// ★ THE RULE: give every extraction an ordered list of the form's row anchors. A field's cells are
//   the tokens between its anchor and the next anchor that actually appears after it. If the anchor
//   is absent, raise TagNotFoundError — never return null (B1d).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { TagNotFoundError, stripRefs, tokeniseCells, type Cell } from "./irdai-numbers.js";

/** Collapse the page's line breaks so a wrapped row reads as one run of text. */
export function flattenPage(pageText: string): string {
  return pageText.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ");
}

/**
 * ⚠ LABEL DECORATION. The same row is written differently by different producers:
 *      most insurers   "Profit/ Loss on sale/redemption of Investments"
 *      ICICIGI FY2019  "Profit/ (Loss) on sale/redemption of Investments"   <- parenthesised
 *   MEASURED: the parenthesis broke the TERMINATING anchor, the slice ran past the row end to 85
 *   cells, 85 was not a multiple of the 4-column cycle, and every ICICIGI unit refused with
 *   geometry_mismatch — 6 of 6, on one of the two deepest archives in the corpus.
 *
 * ★ THE TRANSFORM IS DELIBERATELY NARROW: it deletes the PARENTHESIS CHARACTERS and nothing else.
 *   The letters inside are kept, so "Total (A)" -> "Total A" and "Total (B)" -> "Total B" remain
 *   DISTINCT. A collision is therefore impossible by construction, which is why no decorated-label
 *   fallback is needed — dropping the content, not the brackets, is what would collide.
 *
 * ⚠⚠ AND IT IS USED FOR ANCHOR MATCHING ONLY, NEVER FOR TOKENISING. The forms bracket NEGATIVES:
 *   "(7,987)" is -7987. Stripping parentheses before tokenising would silently flip the sign of
 *   every negative cell on the page. The index map exists so a match found on the normalised text
 *   is sliced out of the ORIGINAL, with its brackets intact.
 */
export interface NormalisedText {
  text: string;
  /** map[i] = index in the original flat string of normalised character i */
  map: number[];
}

export function normaliseForMatch(flat: string): NormalisedText {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < flat.length; i++) {
    const c = flat[i];
    if (c === "(" || c === ")") continue;
    text += c;
    map.push(i);
  }
  return { text, map };
}

/** Strip the same characters from an anchor's source so it matches normalised text. */
function normaliseAnchor(re: RegExp): RegExp {
  return new RegExp(re.source.replace(/\\\(/g, "").replace(/\\\)/g, ""), re.flags.replace("g", ""));
}

/**
 * ⚠ THE GRAIN OF THE FIELD ITSELF — D1b. Declared, then cross-checked against observation.
 *
 *   "flow"           accumulates over the period: premium, claims, commission, profit.
 *                    A quarterly row REQUIRES a genuine quarter column. If the form offers only
 *                    year-to-date, the cell is REFUSED — never obtained by subtracting a prior YTD.
 *   "point_in_time"  a balance at an instant: share capital, reserves, total assets, and the
 *                    carried-forward P&L balance. It does not accumulate, so subtraction is not
 *                    merely fragile, it is ARITHMETICALLY MEANINGLESS.
 *
 * ⚠ FORM-LEVEL GRAIN IS NOT SUFFICIENT, AND THAT IS MEASURED, NOT ASSUMED. HDFCLIFE L-2-A-PL,
 *   FY2026 — a P&L form, unambiguously a flow form, whose columns are [quarter, ytd, ...]:
 *       transfer_from_policyholders             quarter    47,065   ytd  1,19,311   flow
 *       profit_before_tax                       quarter    48,621   ytd  1,95,504   flow
 *       Profit carried forward to Balance Sheet quarter 11,08,798   ytd 11,08,798   <-- IDENTICAL
 *   The last row is point-in-time sitting inside a flow form. A form-level rule would have taken
 *   the quarter column for it and been right only by accident.
 *
 * ⚠ AND THE OBSERVATIONAL TEST IS ONE-SIDED. "quarter == ytd" PROVES point-in-time (in a non-Q1
 *   period). "quarter != ytd" proves nothing: an OPENING BALANCE is a stock measured at two
 *   different dates and differs across the columns while still not being a flow — measured on the
 *   same form, APPROPRIATIONS "Balance at the beginning" reads 10,59,233 vs 9,63,048. So the grain
 *   is DECLARED here and the observation is used only to contradict a wrong declaration.
 */
export type FieldGrain = "flow" | "point_in_time";

export interface RowAnchor {
  /** Stable field name in our schema. */
  field: string;
  /** ⚠ Defaults to "flow". Declare "point_in_time" for anything that is a balance. */
  grain?: FieldGrain;
  /** ⚠ Matched against the form's LABEL TEXT, never a row number.
   *  MEASURED: NIVABUPA omits "Premium Deficiency" as a health-only insurer, so every row number
   *  below it shifts by one against ICICIGI and GODIGIT. Labels, order and the schedule
   *  cross-reference are identical across all three; the NUMBERING is not. */
  match: RegExp;
}

export interface SlicedRow {
  field: string;
  /** The label text as the document wrote it. Audit trail. */
  label: string;
  cells: Cell[];
  /** Character span in the flattened page, for debugging a bad slice. */
  span: [number, number];
}

/**
 * Slice one row's cells out of a flattened page.
 *
 * @param anchors ordered as the form orders them; used to bound each slice.
 */
export function sliceRow(
  formId: string,
  flat: string,
  anchors: RowAnchor[],
  field: string,
): SlicedRow {
  const i = anchors.findIndex((a) => a.field === field);
  if (i < 0) throw new Error(`sliceRow: field ${field} is not in the anchor list for ${formId}`);
  const me = anchors[i];

  // Match on the decoration-normalised text, then map the position back into the ORIGINAL so the
  // cells are tokenised with their brackets (and therefore their signs) intact.
  const N = normaliseForMatch(flat);
  const meN = normaliseAnchor(me.match);
  const m = meN.exec(N.text);
  if (!m) throw new TagNotFoundError(field, String(me.match), formId);

  const start = N.map[Math.min(m.index + m[0].length, N.map.length - 1)];
  // The end is the earliest subsequent anchor that appears after `start`.
  //
  // ⚠ THE ROW-NUMBER BLEED. IRDAI rows are numbered, and the number belongs to the row it precedes:
  //      "... 7,91,900 7,18,161 7,18,161 2 Profit/ Loss on Sale/Redemption ..."
  //   Ending the slice at the anchor "Profit/ Loss on Sale" leaves that trailing "2" inside the
  //   PREVIOUS row, which then tokenises to 17 cells instead of 16. MEASURED on NIACL Jun-2023:
  //   the width assertion caught it (17 is not a multiple of 4) — loud, but only by luck. Had the
  //   form carried 15 real columns the bleed would have produced a clean 16 and a silent mis-pick.
  //   So the boundary consumes the next row's leading number.
  let end = flat.length;
  // ⚠ The terminating anchor is matched on the SAME normalised text, or a decorated next-row label
  //   fails to terminate the slice and the row runs to the end of the page. That is exactly how
  //   ICICIGI produced 85-cell rows.
  const startN = Math.max(0, N.map.findIndex((x) => x >= start));
  for (let j = i + 1; j < anchors.length; j++) {
    const src = normaliseAnchor(anchors[j].match).source;
    const re = new RegExp(`(?:(?<=\\s)\\d{1,2}[.]?\\s+)?(?:${src})`, anchors[j].match.flags.replace("g", ""));
    const mm = re.exec(N.text.slice(startN));
    if (mm) {
      end = N.map[Math.min(startN + mm.index, N.map.length - 1)];
      break;
    }
  }
  const body = flat.slice(start, end);
  return {
    field,
    label: m[0].trim(),
    cells: tokeniseCells(stripRefs(body)),
    span: [start, end],
  };
}

/** Slice every anchor in one pass. Fields whose anchor is absent are reported, not defaulted. */
export function sliceAll(
  formId: string,
  flat: string,
  anchors: RowAnchor[],
): { rows: Map<string, SlicedRow>; missing: string[] } {
  const rows = new Map<string, SlicedRow>();
  const missing: string[] = [];
  for (const a of anchors) {
    try {
      rows.set(a.field, sliceRow(formId, flat, anchors, a.field));
    } catch (e) {
      if (e instanceof TagNotFoundError) missing.push(a.field);
      else throw e;
    }
  }
  return { rows, missing };
}
