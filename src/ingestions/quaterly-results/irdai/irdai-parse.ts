// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PARSER — assembles the rules. Two parsers' worth of behaviour, one code path, switched by the
// FormSpec's geometry. Every refusal is typed and named; nothing is defaulted to null.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { requireUnit, UnitUndeclaredError, type MoneyUnit } from "./irdai-units.js";
import { flattenPage, sliceRow } from "./irdai-rows.js";
import {
  pickColumn,
  resolveGeometry,
  requireCellValues,
  type PeriodRole,
  PeriodUnreadableError,
  PeriodMismatchError,
  ColumnGeometryError,
} from "./irdai-columns.js";
import { boundMoney, TagNotFoundError, BoundsError } from "./irdai-numbers.js";
import { findFormPages, segmentOfPage, type FormSpec } from "./irdai-forms.js";

export interface ExtractedField {
  field: string;
  /** value in the table's unit (Rs crore) */
  value: number;
  /** value exactly as the form prints it, before the unit conversion */
  rawValue: number;
  unit: MoneyUnit;
  columnIndex: number;
  columnLabel: string;
  ambiguousWithSibling: boolean;
  page: number;
}

export interface ExtractRefusal {
  field: string | null;
  page: number | null;
  reason:
    | "unit_undeclared"
    | "unit_conflicting"
    | "period_unreadable"
    | "period_mismatch"
    | "geometry_mismatch"
    | "tag_not_found"
    | "point_in_time_no_quarterly_value"
    | "segment_page_not_consolidated"
    | "out_of_bounds"
    | "form_not_found";
  detail: string;
}

export interface ExtractResult {
  formId: string;
  page: number | null;
  fields: Map<string, ExtractedField>;
  refusals: ExtractRefusal[];
  /** ⚠ true when ANY chosen column equalled its quarter/ytd sibling. Q1. Recorded per run. */
  anyAmbiguous: boolean;
}

/** A quarterly target is one that asks for the three months, not the year to date. */
function isQuarterlyTarget(role: PeriodRole): boolean {
  return role === "quarter_current" || role === "quarter_prior";
}

function classify(e: unknown): ExtractRefusal["reason"] {
  if (e instanceof UnitUndeclaredError) return e.resolution.reason === "undeclared" ? "unit_undeclared" : "unit_conflicting";
  if (e instanceof PeriodUnreadableError) return "period_unreadable";
  if (e instanceof PeriodMismatchError) return "period_mismatch";
  if (e instanceof ColumnGeometryError) return "geometry_mismatch";
  if (e instanceof TagNotFoundError) return "tag_not_found";
  if (e instanceof BoundsError) return "out_of_bounds";
  return "geometry_mismatch";
}

/**
 * Extract one form for one period.
 *
 * @param role which column to take: quarter_current for a quarterly row, ytd_current for annual.
 * @param targetEndDate ISO date the period ends. ⚠ Asserted against the column label; a page whose
 *        period cannot be READ is refused, never inferred from its position in the bundle.
 */
export function extractForm(
  pageTexts: string[],
  spec: FormSpec,
  role: PeriodRole,
  targetEndDate: string,
  opts: { q1Equivalent?: boolean } = {},
): ExtractResult {
  const res: ExtractResult = { formId: spec.id, page: null, fields: new Map(), refusals: [], anyAmbiguous: false };

  const candidates = findFormPages(pageTexts, spec);
  if (candidates.length === 0) {
    res.refusals.push({
      field: null,
      page: null,
      reason: "form_not_found",
      detail: `${spec.id} not found on any of ${pageTexts.length} pages (title + >=2 anchors required)`,
    });
    return res;
  }

  // ⚠ Try every candidate page. The RIGHT page is the one whose column header matches the target
  //   period — not the first, and not a positional guess. HDFCLIFE's L-1 spans four pages of which
  //   two carry no period label at all; those refuse here and the loop moves on.
  const pageRefusals: ExtractRefusal[] = [];
  for (const pageIdx of candidates) {
    const pageText = pageTexts[pageIdx];
    const flat = flattenPage(pageText);
    try {
      const unit = requireUnit(`${spec.id} p${pageIdx + 1}`, pageText);

      // The first anchor bounds the header.
      const firstRow = sliceRow(spec.id, flat, spec.anchors, spec.anchors[0].field);
      const firstVals = requireCellValues(spec.id, spec.anchors[0].field, firstRow.cells);

      // ⚠ Life L-1-A-RA has SEGMENT columns and no period columns, so its period comes from the
      //   page statement. Everything else reads period columns.
      const perPagePeriod = spec.geometry === "grand_total_last";
      const geo = resolveGeometry(`${spec.id} p${pageIdx + 1}`, pageText, firstVals.length, {
        headerEndsAt: firstRow.span[0],
        perPagePeriod,
      });

      // ⚠⚠ THE SEGMENT GUARD. One block + a named line of business + other revenue pages in the
      //   same document => this is a PER-SEGMENT page and its "last block" is that segment, not the
      //   company. Writing it would put Fire's premium in the company's premium column.
      //   MEASURED on NIACL FY21 Q2: Fire 76,62,828 taken as the total against a true ~6,569 cr.
      // ⚠ "health" is NOT in this set on purpose. Star Health and Niva Bupa are MONOLINE health
      //   insurers, so a single-block page titled "Health Revenue Account" IS their company total
      //   and refusing it would lose them entirely. No insurer in this universe writes only fire,
      //   only marine or only motor, so a single-block page under those titles is always a
      //   sub-segment of a multiline book.
      //   ⚠ And the candidate count is NOT part of the test: NIACL FY16 Q4 exposes only ONE
      //     revenue page to findFormPages (the others fail the two-anchor threshold), so a
      //     "more than one page" condition would let Fire through as the company total.
      const SUBSEGMENT_ONLY = new Set(["fire", "marine", "motor", "miscellaneous"]);
      const seg = segmentOfPage(pageText);
      if (geo.blocks === 1 && seg !== null && SUBSEGMENT_ONLY.has(seg)) {
        pageRefusals.push({
          field: null,
          page: pageIdx + 1,
          reason: "segment_page_not_consolidated",
          detail:
            `page is the ${seg.toUpperCase()} revenue account and carries ONE segment block, so its ` +
            `"last block" is ${seg}, not the company. The consolidated figure is on another page. ` +
            `REFUSED rather than writing one line of business as the company total.`,
        });
        continue;
      }

      // Assert the target period is actually offered by this page before extracting anything.
      pickColumn(`${spec.id} p${pageIdx + 1}`, geo, firstVals, role, targetEndDate, opts);

      // ── this page is the right one; extract every anchor ──────────────────────────────────────
      // ⚠ THE TABLE IS RECTANGULAR. Every row on this form has the SAME width as the first one.
      //   Without this cap the slice runs to the end of the page whenever a row's terminating
      //   anchor is absent, and MEASURED that produced rows of 21, 55, 102, 257 and 265 cells on
      //   real forms — each of which would have indexed into a neighbouring row's numbers. The cap
      //   turns "my anchor list is incomplete" from a silent mis-read into a clean truncation.
      const WIDTH = firstVals.length;
      res.page = pageIdx + 1;
      for (const a of spec.anchors) {
        try {
          // ⚠⚠ D1c — THE GRAIN GUARD. A QUARTERLY row may take a value ONLY from a genuine quarter
          //   column, and only for a FLOW field. A point-in-time field has no quarterly value at
          //   all: it is a balance at an instant, so there is nothing to select, and subtracting a
          //   prior year-to-date is not fragile but ARITHMETICALLY MEANINGLESS. REFUSED, never
          //   computed, and the refusal is reported rather than becoming a silent null.
          //
          //   ⚠ This fires BEFORE the slice, so a point-in-time field cannot reach boundMoney() and
          //     cannot reach the writer even by accident.
          const fieldGrain = a.grain ?? "flow";
          if (isQuarterlyTarget(role) && fieldGrain === "point_in_time") {
            res.refusals.push({
              field: a.field,
              page: pageIdx + 1,
              reason: "point_in_time_no_quarterly_value",
              detail:
                `${a.field} is a balance at an instant, not a flow. A quarterly row has no value to ` +
                `take from it and this lane does not derive one by subtraction. REFUSED.`,
            });
            continue;
          }
          const row = sliceRow(spec.id, flat, spec.anchors, a.field);
          const all = requireCellValues(spec.id, a.field, row.cells);
          const vals = all.slice(0, WIDTH);
          if (all.length < WIDTH) {
            // Short row: the anchor matched something that is not a full data row.
            res.refusals.push({
              field: a.field, page: pageIdx + 1, reason: "geometry_mismatch",
              detail: `row yielded ${all.length} cells, form width is ${WIDTH} — REFUSED rather than padded`,
            });
            continue;
          }
          const g2 = resolveGeometry(`${spec.id} p${pageIdx + 1}`, pageText, vals.length, {
            headerEndsAt: firstRow.span[0],
            perPagePeriod,
          });
          const pick = pickColumn(`${spec.id} p${pageIdx + 1}`, g2, vals, role, targetEndDate, opts);
          const rawValue = vals[pick.index];
          if (!Number.isFinite(rawValue)) {
            res.refusals.push({ field: a.field, page: pageIdx + 1, reason: "tag_not_found", detail: "cell is NA/NIL" });
            continue;
          }
          const value = boundMoney(a.field, rawValue * unit.toCrore);
          // ⚠ A ZERO ROW IS EQUAL IN BOTH COLUMNS AND THAT IS NOT AN AMBIGUITY. MEASURED: on every
          //   non-Q1 document in the corpus exactly one field flagged — premium_deficiency(0),
          //   income_from_investments_shareholders(0) — because the insurer reports nothing there.
          //   Letting a zero set the run-level banner would raise it on every document and the flag
          //   would stop meaning anything. NIACL Q1 flags 7 of 9 fields with REAL values
          //   (791900, 927444, 761713 ...) — that is the genuine Q1 identity, and it must stand out.
          //   The per-field flag is still recorded verbatim either way.
          if (pick.ambiguousWithSibling && rawValue !== 0) res.anyAmbiguous = true;
          res.fields.set(a.field, {
            field: a.field,
            value,
            rawValue,
            unit: unit.unit,
            columnIndex: pick.index,
            columnLabel: pick.label.label,
            ambiguousWithSibling: pick.ambiguousWithSibling,
            page: pageIdx + 1,
          });
        } catch (e) {
          res.refusals.push({
            field: a.field,
            page: pageIdx + 1,
            reason: classify(e),
            detail: (e as Error).message.slice(0, 200),
          });
        }
      }
      return res;
    } catch (e) {
      pageRefusals.push({
        field: null,
        page: pageIdx + 1,
        reason: classify(e),
        detail: (e as Error).message.slice(0, 200),
      });
    }
  }

  res.refusals.push(...pageRefusals);
  return res;
}
