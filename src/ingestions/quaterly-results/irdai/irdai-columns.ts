// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE COLUMN RULE — B1b. Which of the numbers on the row is the one we want.
//
// ⚠ WHY THIS IS THE MOST DANGEROUS FILE IN THE LANE. Every column on an IRDAI row is a real,
//   internally consistent, correctly cross-footing figure. Picking the wrong one does not produce
//   nonsense; it produces a different TRUE number about a different thing. Cross-footing cannot
//   catch it, bounds cannot catch it, and the ratio gate cannot catch it.
//
// ★ MEASURED — NIACL NL-1-B-RA has THREE DIFFERENT GEOMETRIES across vintages, same insurer, same
//   form number. This is the "4 -> 2 -> 2 -> 4" shift, and it is a shift of LAYOUT, not just width:
//
//     Mar-2016   ONE SEGMENT PER PAGE (p2 Fire, p5 Total)     4 cells  = periods only  unit (Rs.'000)
//     Sep-2020   ONE SEGMENT PER PAGE (p2 Fire, p3 Marine,
//                                      p4 Misc, p7 Total)     4 cells  = periods only  unit ₹ ('000)
//     Jun-2023   ALL SEGMENTS ON ONE PAGE                    16 cells  = 4 blocks x 4  unit Rs. Lakhs
//
//   ⚠ The Jun-2023 page still carries the stale title "Fire Revenue Account" while holding all four
//     blocks, so the PAGE TITLE IS NOT A RELIABLE SEGMENT INDICATOR. The geometry must be read from
//     the column header, and the row width must be asserted against it.
//
//   ⚠ Taking the Fire block for the consolidated figure on the 2023 layout: 70,052 against a TOTAL
//     of 7,91,900 — an 11.3x error on a number that looks entirely plausible.
//
// ★ THE RULE, in four parts, all mandatory:
//   (1) READ THE HEADER, NOT THE POSITION. The ordered (role, date) list comes from the column
//       labels. Geometry is derived from that list, never assumed.
//   (2) ASSERT THE ROW WIDTH against the header's column count. A mismatch is a REFUSAL — the
//       block split cannot be trusted, so the row is not sliced on a guess.
//   (3) THE CONSOLIDATED FIGURE IS THE LAST BLOCK. Chosen by arithmetic on the header count, and
//       cross-checked against the segment sum where the segments are present.
//   (4) ⚠ Q1 AMBIGUITY IS REPORTED, NEVER USED AS PERMISSION. In Q1 the "for the quarter" and
//       "up to the year" columns are BYTE-IDENTICAL — measured on NIACL Q1 FY24:
//           Premiums Earned (Net) ... 70052 70052 64228 64228 ...
//       A mis-pick is invisible in Q1 and wrong from Q2. The label assertion runs EVEN WHEN THE
//       VALUES AGREE; equality is never taken as licence to skip the check.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { TagNotFoundError } from "./irdai-numbers.js";

export type PeriodRole = "quarter_current" | "ytd_current" | "quarter_prior" | "ytd_prior";

export interface ColumnLabel {
  /** "for the quarter" vs "up to / upto" — the only thing that separates the two current columns. */
  kind: "quarter" | "ytd";
  /** ISO date of the period end. */
  endDate: string;
  label: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Dates as this corpus writes them:
 *   "MARCH 31, 2026" · "December 31, 2025" · "30th September 2020" · "31.03.2016" · "30-06-2023"
 * ⚠ The ordinal form ("30th September 2020") appears on NIACL Sep-2020 and is missed by a
 *   month-first parser.
 */
export function parseFormDate(s: string): string | null {
  let m = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})\b/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return iso(Number(m[3]), mo, Number(m[2]));
  }
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s*,?\s*(\d{4})\b/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return iso(Number(m[3]), mo, Number(m[1]));
  }
  m = s.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  // ⚠ DOTTED MONTH ABBREVIATION WITH A TWO-DIGIT YEAR — "31.Dec.15", "31-Dec-15".
  //   MEASURED on STARHEALTH's Dec-2015 disclosure, whose entire column header is written this way.
  //   Two-digit years are resolved into 2000-2099: these are IRDAI disclosures, which began in 2002.
  m = s.match(/\b(\d{1,2})[.\-/]([A-Za-z]{3,9})[.\-/](\d{2})(?!\d)/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return iso(2000 + Number(m[3]), mo, Number(m[1]));
  }
  // ⚠ MONTH AND YEAR ONLY, NO DAY. GODIGIT writes its column labels as "For the Quarter
  //   December 2024" — sixteen of them, none carrying a day. An earlier version required a day and
  //   dropped all sixteen, leaving ONE label (the page statement) for a 16-column table, which the
  //   width assertion then refused. A period label without a day means the period ENDS at the end
  //   of that month, which for a quarter-end month is unambiguous.
  // ⚠ LOOSEST FORM, AND DELIBERATELY LAST: a month name with a year and no day.
  //   Required for GODIGIT, whose sixteen column labels read "For the Quarter December 2024".
  //   ⚠ It must MATCH AT THE START of the window, not anywhere in it. MEASURED on STARHEALTH's
  //     Dec-2015 form, where an unanchored search wandered into unrelated body text and produced
  //     a confident but fictitious ytd@2006-03-16. A date that is wrong but well-formed is worse
  //     than no date, because it can satisfy a period assertion by coincidence.
  m = s.match(/^[\s.\-,]*([A-Za-z]{3,9})\s+(\d{4})\b/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return iso(Number(m[2]), mo, lastDayOf(Number(m[2]), mo));
  }
  // ⚠ MONTH WITH AN APOSTROPHISED TWO-DIGIT YEAR — "Jun'23", "Dec-24", "Jun 23".
  //   MEASURED on GODIGIT FY24 Q1, whose sixteen labels read "For the Quarter Jun'23". The SAME
  //   insurer writes "For the Quarter December 2024" in FY25 Q3. One insurer, one form number,
  //   two vintages, two date dialects — which is why every dialect is added to the parser rather
  //   than to a per-insurer profile.
  m = s.match(/^[\s.\-,]*([A-Za-z]{3,9})\s*['’‘`\-]?\s*(\d{2})(?!\d)/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return iso(2000 + Number(m[2]), mo, lastDayOf(2000 + Number(m[2]), mo));
  }
  return null;
}

function lastDayOf(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function iso(y: number, mo: number, d: number): string {
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Last day of an Indian fiscal quarter. Q1 ends 30-Jun, Q2 30-Sep, Q3 31-Dec, Q4 31-Mar (next yr). */
export function fyQuarterEnd(fyEndYear: number, q: 1 | 2 | 3 | 4): string {
  if (q === 1) return iso(fyEndYear - 1, 6, 30);
  if (q === 2) return iso(fyEndYear - 1, 9, 30);
  if (q === 3) return iso(fyEndYear - 1, 12, 31);
  return iso(fyEndYear, 3, 31);
}

/**
 * ⚠ Part (1). Read the ordered column labels out of the page header.
 *
 * Handles every header dialect measured in the corpus:
 *   NIACL 2023   "FOR QUARTER ENDED 30.06.2023" / "UPTO THE YEAR ENDED 30.06.2023"
 *   NIACL 2020   "FOR THE PERIOD ENDED 30.09.2020" / "UPTO THE PERIOD ENDED 30.09.2020"
 *   NIACL 2016   "FOR THE QTR ENDED 31.03.2016" / "UPTO THE QTR ENDED 31.03.2016"
 *   NIVABUPA     "For the quarter ended December 31, 2025" / "Up to the quarter ended ..."
 *   GODIGIT      "For the Quarter December 2024" / "Up to the Quarter December 2024"
 *   ICICIGI      "For Q4 2025-26" / "Upto FY 2025-26"     (fiscal label, no explicit date)
 *
 * ⚠ "FOR" vs "UPTO/UP TO" is the ONLY discriminator between the quarter and the year-to-date
 *   column in the NIACL dialects, because both say "PERIOD". Do not key on "quarter"/"year".
 */
export function readColumnLabels(pageText: string, fyEndYearHint?: number, stopAt?: number): ColumnLabel[] {
  let flat = pageText.replace(/\s*\n\s*/g, " ");
  // ⚠ THE HEADER IS WHAT PRECEDES THE FIRST DATA ROW. Without this bound, NIACL Jun-2023 yields 30
  //   labels for a 16-column table, because the page repeats a header block further down for the
  //   notes sub-table. The caller passes the offset of the first anchored row.
  if (typeof stopAt === "number" && stopAt > 0) flat = flat.slice(0, stopAt);

  // ⚠ AND THE HEADER TABLE STARTS AT THE ROW-LABEL COLUMN HEADING. Above it sits a DOCUMENT title
  //   in the same grammar as a column label:
  //      NIACL Jun-2023  "For the Period ended 30-06-2023"      then PARTICULARS ... 16 column labels
  //      NIACL Sep-2020  "For the Period ended 30th September 2020" then PARTICULARS ... 4 labels
  //   Counting the title as a column gives 17 and 5 — neither a multiple of its cycle — and the
  //   width assertion then refuses a page that is perfectly readable. Anchor on PARTICULARS.
  const partIdx = flat.search(/\bPARTICULARS?\b/i);
  if (partIdx >= 0) flat = flat.slice(partIdx);

  // ⚠⚠ THE PAGE STATEMENT IS NOT A COLUMN, AND IT USES A DIFFERENT GRAMMAR.
  //   A column label discriminates grain by FOR vs UPTO. A page statement discriminates it by
  //   QUARTER vs YEAR — "Revenue Account for the year ended March 31, 2026" is YEAR-TO-DATE even
  //   though it begins with "for". Feeding it to the column reader mis-kinds it as a quarter.
  //
  //   MEASURED, and it broke three insurers three different ways:
  //     ICICIPRULI L-1 p4  "Revenue Account for the year ended March 31, 2026"
  //                        -> read as ONE quarter column; the annual page was then refused as a
  //                           period_mismatch, losing the whole form.
  //     NIVABUPA   NL-1    "REVENUE ACCOUNT FOR THE PERIOD ENDED ON DECEMBER 31, 2025"
  //                        -> counted as a 9th label on an 8-column table; width assertion refused.
  //     GODIGIT    NL-1    "Revenue Account For The Period Ended On December 31, 2024"
  //                        -> the only surviving label on a 16-column table.
  //   NIVABUPA and GODIGIT have no "PARTICULARS" token, so the heading anchor above cannot catch
  //   them. Excise the statement span explicitly.
  const stmtSpans: Array<[number, number]> = [];
  for (const re of [
    /(?:REVENUE ACCOUNT|PROFIT AND LOSS ACCOUNT|PROFIT & LOSS ACCOUNT|BALANCE SHEET)[^|]{0,80}?(?:ENDED|AS AT|AS ON)[^|]{0,30}?\d{4}/gi,
  ]) {
    for (const m of flat.matchAll(re)) stmtSpans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  const inStatement = (i: number) => stmtSpans.some(([a, b]) => i >= a && i < b);

  const out: ColumnLabel[] = [];
  // ⚠ Match only the label PREFIX, then look forward for the date.
  //   An earlier version terminated the label with a lookahead for the NEXT label, and silently
  //   dropped the final column of every header because the last label is followed by the unit row
  //   ("₹ ('000)") rather than another label. MEASURED: NIACL Sep-2020 reported 3 columns for a
  //   4-column table, and the width assertion then refused a perfectly good page.
  const PREFIX = /\b(FOR|UP\s?TO|UPTO)\s+(?:THE\s+)?(QUARTER|QTR|PERIOD|YEAR|FY|Q[1-4])\b/gi;
  for (const m of flat.matchAll(PREFIX)) {
    const start = m.index ?? 0;
    if (inStatement(start)) continue; // ⚠ the page statement is not a column
    const kind: ColumnLabel["kind"] = /^FOR$/i.test(m[1].replace(/\s+/g, "")) ? "quarter" : "ytd";
    // The date belongs to this label if it appears before the NEXT label prefix.
    const after = flat.slice(start + m[0].length);
    const nextPrefix = after.search(/\b(?:FOR|UP\s?TO|UPTO)\s+(?:THE\s+)?(?:QUARTER|QTR|PERIOD|YEAR|FY|Q[1-4])\b/i);
    const window = after.slice(0, nextPrefix >= 0 ? nextPrefix : Math.min(after.length, 48));

    let endDate = parseFormDate(window);
    if (!endDate) {
      const whole = m[0] + window;
      const fq = whole.match(/Q([1-4])\s*(\d{4})\s*[-/]\s*(\d{2,4})/i);
      const fy = whole.match(/FY\s*(\d{4})\s*[-/]\s*(\d{2,4})/i);
      if (fq) endDate = fyQuarterEnd(Number(fq[2]) + 1, Number(fq[1]) as 1 | 2 | 3 | 4);
      else if (fy) endDate = iso(Number(fy[1]) + 1, 3, 31);
      else {
        const bare = whole.match(/\bQ([1-4])\b/i);
        if (bare && fyEndYearHint) endDate = fyQuarterEnd(fyEndYearHint, Number(bare[1]) as 1 | 2 | 3 | 4);
      }
    }
    if (endDate) {
      out.push({ kind, endDate, label: (m[0] + " " + window).replace(/\s+/g, " ").trim().slice(0, 44) });
    }
  }
  return out;
}

/** The header repeats once per segment block. The distinct cycle is the first repetition. */
export function headerCycle(labels: ColumnLabel[]): ColumnLabel[] {
  if (labels.length === 0) return [];
  const key = (l: ColumnLabel) => `${l.kind}@${l.endDate}`;
  const first = key(labels[0]);
  for (let n = 1; n < labels.length; n++) {
    if (key(labels[n]) === first) {
      const cand = labels.slice(0, n);
      // confirm it really repeats
      let ok = true;
      for (let i = 0; i < labels.length; i++) {
        if (key(labels[i]) !== key(cand[i % n])) { ok = false; break; }
      }
      if (ok) return cand;
    }
  }
  return labels;
}

/**
 * ⚠ THE LIFE REVENUE ACCOUNT DOES NOT HAVE PERIOD COLUMNS. L-1-A-RA carries ONE PERIOD PER PAGE and
 *   its columns are business segments, so the period must come from the PAGE STATEMENT:
 *      "REVENUE ACCOUNT FOR THE YEAR ENDED MARCH 31, 2026"      (HDFCLIFE FY2026 bundle, page 4)
 *      "REVENUE ACCOUNT FOR THE QUARTER ENDED MARCH 31, 2026"   (same bundle, page 3)
 *   and pages 5 and 6 of that bundle carry NO statement at all — they are the prior year, and they
 *   return null here so the caller refuses them instead of accepting them positionally.
 */
export function readPageStatement(pageText: string): { kind: ColumnLabel["kind"]; endDate: string; statement: string } | null {
  const flat = pageText.replace(/\s+/g, " ");
  const pats: Array<{ re: RegExp; kind: ColumnLabel["kind"] }> = [
    { re: /(?:REVENUE|PROFIT AND LOSS|PROFIT & LOSS)[^.]{0,50}?FOR THE QUARTER ENDED[^,]{0,24},?\s*\d{4}/i, kind: "quarter" },
    { re: /(?:REVENUE|PROFIT AND LOSS|PROFIT & LOSS)[^.]{0,50}?FOR THE (?:YEAR|PERIOD) ENDED[^,]{0,24},?\s*\d{4}/i, kind: "ytd" },
    { re: /FOR THE QUARTER ENDED[^,]{0,24},?\s*\d{4}/i, kind: "quarter" },
    { re: /FOR THE (?:YEAR|PERIOD) ENDED[^,]{0,24},?\s*\d{4}/i, kind: "ytd" },
    { re: /BALANCE SHEET AS (?:AT|ON)[^,]{0,24},?\s*\d{4}/i, kind: "ytd" },
    { re: /AS (?:AT|ON)\s+\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}/i, kind: "ytd" },
  ];
  for (const p of pats) {
    const m = flat.match(p.re);
    if (!m) continue;
    const d = parseFormDate(m[0]);
    if (d) return { kind: p.kind, endDate: d, statement: m[0].replace(/\s+/g, " ").trim() };
  }
  return null;
}

export class PeriodUnreadableError extends Error {
  constructor(readonly formId: string, detail: string) {
    super(`COLUMN RULE: ${formId} — ${detail}`);
    this.name = "PeriodUnreadableError";
  }
}
export class PeriodMismatchError extends Error {
  constructor(readonly formId: string, readonly want: string, readonly got: string) {
    super(`COLUMN RULE: ${formId} — header offers ${got}, target is ${want}. REFUSING.`);
    this.name = "PeriodMismatchError";
  }
}
export class ColumnGeometryError extends Error {
  constructor(readonly formId: string, detail: string) {
    super(`COLUMN RULE: ${formId} — ${detail}`);
    this.name = "ColumnGeometryError";
  }
}

export interface Geometry {
  /** distinct period columns inside one block */
  cycle: ColumnLabel[];
  /** how many segment blocks the row carries */
  blocks: number;
  /** total columns = cycle.length * blocks */
  width: number;
  /** index of the block holding the consolidated figure — always the LAST. */
  totalBlock: number;
}

/**
 * ⚠ Parts (1)+(2). Derive the geometry from the header and ASSERT it against the row width.
 *   Refuses rather than slicing when they disagree.
 */
export function resolveGeometry(
  formId: string,
  pageText: string,
  rowWidth: number,
  opts: { fyEndYearHint?: number; headerEndsAt?: number; perPagePeriod?: boolean } = {},
): Geometry {
  const labels = readColumnLabels(pageText, opts.fyEndYearHint, opts.headerEndsAt);
  if (labels.length === 0 && opts.perPagePeriod) {
    // ⚠ Life L-1-A-RA: the columns are SEGMENTS, so there are no period labels. One period per page,
    //   read from the page statement. A page with no statement still refuses below.
    const st = readPageStatement(pageText);
    if (st) {
      return {
        cycle: [{ kind: st.kind, endDate: st.endDate, label: st.statement }],
        blocks: rowWidth,
        width: rowWidth,
        totalBlock: rowWidth - 1,
      };
    }
  }
  if (labels.length === 0) {
    throw new PeriodUnreadableError(
      formId,
      `no column period labels in the text layer — this page cannot be identified and is REFUSED. ` +
        `(Measured: HDFCLIFE FY2026 bundle pages 5-6 carry no period statement at all; positional ` +
        `inference would have accepted them as the current year.)`,
    );
  }
  const cycle = headerCycle(labels);
  if (rowWidth % cycle.length !== 0) {
    throw new ColumnGeometryError(
      formId,
      `row has ${rowWidth} cells but the header cycle is ${cycle.length} ` +
        `(${cycle.map((c) => `${c.kind}@${c.endDate}`).join(", ")}). ` +
        `Not a whole multiple, so the block split cannot be trusted — REFUSING rather than guessing.`,
    );
  }
  const blocks = rowWidth / cycle.length;
  return { cycle, blocks, width: rowWidth, totalBlock: blocks - 1 };
}

export interface ColumnPick {
  index: number;
  width: number;
  block: number;
  blocks: number;
  role: PeriodRole;
  label: ColumnLabel;
  /** ⚠ true when the chosen column holds the same number as its quarter/ytd sibling. Q1. */
  ambiguousWithSibling: boolean;
  note: string;
}

/**
 * ⚠ Parts (3)+(4). Choose the column, asserting the label's DATE against the target.
 *   `role` says which of the four we want; the header says which index that is.
 */
export function pickColumn(
  formId: string,
  geo: Geometry,
  cellValues: number[],
  role: PeriodRole,
  targetEndDate: string,
  opts: { q1Equivalent?: boolean } = {},
): ColumnPick {
  const wantKind: ColumnLabel["kind"] = role.startsWith("quarter") ? "quarter" : "ytd";
  const wantCurrent = role.endsWith("current");

  // Current = the target date. Prior = anything else.
  let idxInCycle = geo.cycle.findIndex(
    (c) => c.kind === wantKind && (wantCurrent ? c.endDate === targetEndDate : c.endDate !== targetEndDate),
  );

  // Q1 GRAIN EQUIVALENCE. In Q1 the year-to-date period IS the quarter — that is arithmetic, not an
  // assumption, so a Q1 quarterly target may be satisfied by the ytd column of the same date.
  // ⚠ NARROW ON PURPOSE. It applies only when opts.q1Equivalent is set by the caller, which happens
  //   only for a Q1 target. It is NOT a general "close enough" fallback, and it never applies in
  //   Q2-Q4 where the two grains genuinely differ (measured 2.54x-3.84x apart).
  //   It exists because LIC publishes the two grains as SEPARATE FILES with near-identical names
  //   ("...for the Quarter ended 30.06.2026" vs "...for the period ended 30.06.2026"), so a Q1
  //   fetch may legitimately land on the ytd file.
  let viaQ1Equivalence = false;
  if (idxInCycle < 0 && opts.q1Equivalent && wantCurrent) {
    const alt: ColumnLabel["kind"] = wantKind === "quarter" ? "ytd" : "quarter";
    const j = geo.cycle.findIndex((c) => c.kind === alt && c.endDate === targetEndDate);
    if (j >= 0) { idxInCycle = j; viaQ1Equivalence = true; }
  }
  if (idxInCycle < 0) {
    throw new PeriodMismatchError(
      formId,
      `${role} @ ${targetEndDate}`,
      geo.cycle.map((c) => `${c.kind}@${c.endDate}`).join(" | "),
    );
  }

  const index = geo.totalBlock * geo.cycle.length + idxInCycle;
  if (index >= cellValues.length) {
    throw new ColumnGeometryError(formId, `computed index ${index} beyond ${cellValues.length} cells`);
  }

  // sibling = the other current column in the same block
  const sibKind: ColumnLabel["kind"] = wantKind === "quarter" ? "ytd" : "quarter";
  const sibInCycle = geo.cycle.findIndex((c) => c.kind === sibKind && c.endDate === geo.cycle[idxInCycle].endDate);
  const sibIndex = sibInCycle >= 0 ? geo.totalBlock * geo.cycle.length + sibInCycle : -1;

  return {
    index,
    width: cellValues.length,
    block: geo.totalBlock,
    blocks: geo.blocks,
    role,
    label: geo.cycle[idxInCycle],
    ambiguousWithSibling: sibIndex >= 0 && cellValues[sibIndex] === cellValues[index],
    note:
      `${geo.blocks} block(s) x ${geo.cycle.length} period columns; consolidated = block ${geo.totalBlock} (last); ` +
      `role ${role} matched header label ${JSON.stringify(geo.cycle[idxInCycle].label)}`,
  };
}

/** Convenience for callers holding Cell[]. NA keeps its column slot as NaN so indices stay aligned. */
export function requireCellValues(
  formId: string,
  field: string,
  cells: Array<{ kind: string; value?: number }>,
): number[] {
  const out: number[] = [];
  for (const c of cells) {
    if (c.kind === "number") out.push(c.value as number);
    else if (c.kind === "structural_zero") out.push(0);
    else if (c.kind === "not_applicable") out.push(Number.NaN);
  }
  if (out.length === 0) throw new TagNotFoundError(field, "(numeric cells)", formId);
  return out;
}
