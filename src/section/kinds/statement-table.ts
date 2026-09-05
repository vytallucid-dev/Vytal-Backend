// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SERIES · statement-table — LINE ITEMS down, PERIODS across. A filed statement, as filed.
//
// ★ THE SHAPE `set-table` WAS NAMED AGAINST, ARRIVING. Its header reserved this name and stated the
//   split: there, rows are ENTITIES and columns are MEASURES, every row navigates, and any column can
//   sort. Here, rows are LINE ITEMS and columns are PERIODS, nothing navigates, and the column order
//   is chronological and NOT sortable — sorting a balance sheet by year destroys the only reading it
//   has. See `section/contract.ts` for the full ruling, including why this is not a parameter on
//   `statement-trend`.
//
// ── ★ WHAT THIS RENDERER KNOWS THAT NO OTHER ONE DOES: A STATEMENT HAS STRUCTURE ──────────────────
// A filed statement is not a grid of numbers. Revenue and Other income are LINES; Total income is a
// SUBTOTAL of them; Net profit is the TOTAL. A reader who cannot see which rows sum into which has
// been handed the numbers and not the statement. `role` carries that, and it is the field no existing
// SERIES payload has anywhere to put.
//
// ⚠ AND THE SUBTOTALS ARE THE FILING'S OWN, NEVER RECONSTRUCTED. `role: "subtotal"` describes what a
//   row IS; it is not an instruction to add the rows above it. Reconstructing a total from the parts
//   we happen to hold is what made all 48 balance-sheet faults (see `Fundamental.totalLiabilities`'s
//   own schema comment: a disposal group tags a third bucket, so current + non-current is not the
//   total). A subtotal we do not hold renders as an absent cell with words, exactly like any other.
//
// ── ★★ THE BASIS IS A REQUIRED FIELD ON THE PAYLOAD, AND THAT IS THE F CONSTRAINT MADE STRUCTURAL ──
// 1,492 of 2,175 non-financial stocks file BOTH standalone and consolidated, for 15,932 stock-periods
// (re-measured at this batch). Consolidated-only is zero, so EVERY figure in this table is one of two
// answers and the reader cannot tell which from the number. Worse, the choice is not uniform across
// the product: measured live, TCS reads consolidated and HDFCBANK reads standalone, because the
// preferred default is per industry family. An answer that does not name the basis is therefore not
// merely incomplete — it is a figure whose meaning the reader has no way to recover.
//
// So `basis` is not optional and it carries a `sentence`, not just a token: the sentence is authored
// once here, goes into the payload for the browser AND into the digest for the model, so the two
// cannot phrase it differently. `Coverage` was the other candidate home and is the wrong one — it is
// Contract 1, shared by funds and by the reader's own book, and a `basis` field there would be a
// statement about accounting consolidation attached to a mutual fund (the §3.7 mistake).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Coverage } from "../../resolve/contract.js";
import { digest, line, unchanged, withheld, type DigestGroup, type DigestLine, type Section } from "../contract.js";

/** How a row's figures are formatted. `cr` money in crore · `pct` a percentage · `x` a multiple. */
export type StatementUnit = "cr" | "pct" | "x" | "inr";

/**
 * One cell. `display` is what the reader reads — already formatted (N-1) — or the authored absent
 * phrase when `filed` is false.
 *
 * ⚠ `value` RIDES BESIDE `display` ON PURPOSE, and it is what makes the table auditable: `I-FALSE-ZERO`
 *   can only catch "the source is 4.2 and the reader sees ₹0 Cr" where both halves are present. Every
 *   payload in this system that keeps the source next to the rendering can be checked against itself.
 */
export interface StatementCell {
  readonly display: string;
  readonly value: number | null;
  /** `false` ⇒ the company did not report this line in this period, and `display` says so. */
  readonly filed: boolean;
}

export interface StatementLine {
  readonly key: string;
  readonly label: string;
  readonly unit: StatementUnit;
  /**
   * ★ WHAT THE ROW IS IN THE STATEMENT — see the header. `subtotal` and `total` are the FILING's own
   * subtotals, read from their own columns; this field never authorises adding the rows above.
   */
  readonly role: "line" | "subtotal" | "total";
  /** Parallel to `periods`, one cell per column, oldest → newest. */
  readonly cells: readonly StatementCell[];
}

export interface StatementGroup {
  /** How a person would introduce this block — "Profit and loss", not "pnl". */
  readonly label: string;
  readonly lines: readonly StatementLine[];
  /**
   * ★ WHY THIS GROUP IS SHORTER THAN A READER MIGHT EXPECT. `null` when there is nothing to say.
   *
   * ⚠ THIS IS WHERE A MISSING STATEMENT LINE GETS ITS WORDS. A reader who knows a balance sheet
   *   expects a liabilities total and will read its absence as our having dropped it. Naming the
   *   omission is the difference between a short statement and a broken one.
   */
  readonly note: string | null;
}

export interface StatementBasis {
  readonly read: "consolidated" | "standalone";
  readonly available: readonly ("consolidated" | "standalone")[];
  /** Authored once, here. The browser shows this and the digest carries the same words. */
  readonly sentence: string;
}

export interface StatementTablePayload {
  /**
   * The columns, CHRONOLOGICAL, oldest → newest.
   *
   * ⚠ NOT SORTABLE, AND THAT IS THE HALF OF THE `set-table` SPLIT A RENDERER COULD GET WRONG. Every
   *   column of a `set-table` sorts; no column here does, because the order IS the information.
   */
  readonly periods: readonly string[];
  readonly cadence: "quarterly" | "annual";
  readonly groups: readonly StatementGroup[];
  readonly basis: StatementBasis;
  /** Which industry statement this is — a bank's P&L is not a manufacturer's, and the labels differ. */
  readonly familyLabel: string;
  /** ⚠ AN EMPTY STATEMENT IS A SENTENCE WITH ITS OWN WORDS (N-4), never a blank grid. */
  readonly emptyPhrase: string;
}

const CADENCE_WORD: Record<StatementTablePayload["cadence"], string> = {
  quarterly: "quarter", annual: "financial year",
};

/**
 * ★ THE BASIS SENTENCE. One home (N-5) — the family, the renderer and the digest all get this string
 *   rather than three near-identical phrasings of the same fact.
 *
 * ⚠ IT SAYS WHAT WE READ *AND* WHAT ELSE EXISTS. "Read on a consolidated basis" alone leaves the
 *   reader to assume that is the only set of books; where both are filed, the other one is a
 *   different and equally real set of figures for the same quarter, and a reader comparing our number
 *   against one they found elsewhere needs to know that.
 */
export function basisSentence(
  read: StatementBasis["read"],
  available: StatementBasis["available"],
): string {
  const both = available.includes("consolidated") && available.includes("standalone");
  if (both) {
    const other = read === "consolidated" ? "standalone" : "consolidated";
    return `Read on a ${read} basis. This company also files ${other} results for the same periods, and those are different figures.`;
  }
  return `Read on a ${read} basis, which is the only basis this company files.`;
}

export function statementTableSection(
  input: {
    heading: string;
    periods: readonly string[];
    cadence: StatementTablePayload["cadence"];
    groups: readonly StatementGroup[];
    basis: StatementBasis;
    familyLabel: string;
    emptyPhrase: string;
  },
  coverage: Coverage,
): Section<"SERIES", StatementTablePayload> {
  const payload: StatementTablePayload = {
    periods: input.periods,
    cadence: input.cadence,
    groups: input.groups,
    basis: input.basis,
    familyLabel: input.familyLabel,
    emptyPhrase: input.emptyPhrase,
  };

  const groups: DigestGroup[] = [];

  // ═══ THE BASIS GOES FIRST, BECAUSE IT BOUNDS EVERY LINE UNDER IT ═════════════════════════════════
  //
  // ⚠ NARRATIVE ORDER, NOT SCHEMA ORDER (§4.3 rule 1). A basis stated after the figures has already
  //   let the model write a sentence about a number whose basis it did not know it needed to name.
  groups.push({
    label: "What these figures are, before any of them are read",
    lines: [
      line("Basis", input.basis.sentence),
      line("Statement family", `${input.familyLabel} — the line items are this industry's, not a generic set`),
      input.periods.length === 0
        ? withheld("Periods", input.emptyPhrase)
        : line(
            "Periods",
            `${input.periods.length} ${CADENCE_WORD[input.cadence]}${input.periods.length === 1 ? "" : "s"}, ` +
            `${input.periods[0]} to ${input.periods[input.periods.length - 1]}`,
          ),
    ],
  });

  // ═══ ONE DIGEST GROUP PER STATEMENT GROUP, LATEST PERIOD FIRST, THEN THE MOVE ════════════════════
  //
  // ⚠ THE DIGEST DOES NOT CARRY THE MATRIX, AND THIS IS THE SAME RULE THE SPINE FOLLOWS. A model
  //   handed nine years × twelve lines will compute a growth rate, average two columns, or name "the
  //   trend" from an ordering it did not verify — every one of which is a figure it produced (N-1).
  //   It gets, per line: the latest filed value, and the move against the earliest period IN THE
  //   TABLE, both already computed and formatted here.
  const last = input.periods.length - 1;
  for (const g of input.groups) {
    const lines: DigestLine[] = [];
    for (const l of g.lines) {
      const latest = l.cells[last];
      const first = l.cells[0];
      if (!latest || !latest.filed) {
        // ★ RULE 3 + RULE 4 TOGETHER: the line APPEARS and is marked absent with its own words. A row
        //   omitted because it is empty reads to the model as a line the company does not have.
        lines.push(withheld(l.label, latest?.display ?? "not reported in this period"));
        continue;
      }
      const roleWord = l.role === "total" ? " (the bottom line)" : l.role === "subtotal" ? " (a filed subtotal)" : "";
      // The move is stated in the unit the line actually moves in — points for a percentage or a
      // multiple, relative percent for money. Same rule as `MetricRow.changeUnit`; getting it wrong
      // reports a 3.7-point fall in return on equity as a 7% one.
      const move = moveText(l, first, latest, input.periods);
      lines.push(
        move === null
          ? line(l.label, `${latest.display}${roleWord}, in ${input.periods[last]}`)
          : move === "flat"
            ? unchanged(l.label, `${latest.display}${roleWord} in ${input.periods[last]} — unchanged across the window`)
            : line(l.label, `${latest.display}${roleWord} in ${input.periods[last]}, ${move}`),
      );
    }
    if (g.note) {
      // ⚠ THE GROUP'S OWN GAP, IN THE DIGEST AS WELL AS ON SCREEN. Without this the model sees a
      //   statement with a line missing and no reason, and it will supply one.
      lines.push(withheld(`${g.label} — what is not here`, g.note));
    }
    groups.push({ label: g.label, lines: lines.length ? lines : [withheld(g.label, input.emptyPhrase)] });
  }

  if (input.groups.length === 0) {
    groups.push({ label: "Statement", lines: [withheld("Lines", input.emptyPhrase)] });
  }

  return {
    kind: "SERIES",
    renderer: "statement-table",
    payload,
    digest: digest(input.heading, groups),
    coverage,
    // ⚠ NO SORT INTERACTION, AND THE OMISSION IS THE CONTRACT. A `set-table` sorts by any column; a
    //   statement sorted by year is no longer a statement. The basis toggle is offered only where a
    //   second basis actually exists to toggle to.
    interactions: input.basis.available.length > 1
      ? [{ id: "toggle-basis", kind: "toggle", label: "Consolidated / standalone" }]
      : [],
  };
}

/** The move across the window, in the unit the line moves in. `null` when it cannot be read. */
function moveText(
  l: StatementLine,
  first: StatementCell | undefined,
  latest: StatementCell,
  periods: readonly string[],
): string | null {
  if (periods.length < 2 || !first || !first.filed || first.value === null || latest.value === null) return null;
  const span = `across ${periods[0]} to ${periods[periods.length - 1]}`;
  if (l.unit === "pct" || l.unit === "x") {
    const d = Math.round((latest.value - first.value) * 100) / 100;
    if (Math.abs(d) < 0.005) return "flat";
    // Points for a percentage, times for a multiple — never "%" for either, see MetricRow.changeUnit.
    const suffix = l.unit === "pct" ? "pp" : "×";
    return `${d > 0 ? "+" : ""}${d.toFixed(2)}${suffix} ${span}`;
  }
  if (first.value === 0) return null; // a relative move off zero is not a percentage
  const pct = Math.round(((latest.value - first.value) / Math.abs(first.value)) * 1000) / 10;
  if (Math.abs(pct) < 0.05) return "flat";
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1)}% ${span}`;
}
