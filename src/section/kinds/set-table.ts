// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ANCHOR · set-table — a set of ENTITIES with comparable columns. Ruled in at T-1b (§4.1 amendment).
//
// ★ THE SAME QUESTION AS `hero-set`, AT A RESOLUTION THE READER CAN WORK WITH. A screen result's
//   headline object IS the match set — `hero-set`'s own header already names "a screen result" as one
//   of its cases — so this is not a new question and not a new kind. What `hero-set` cannot do is
//   carry SEVERAL comparable figures per row and let the reader sort by any of them.
//
//   Both stay. A six-row watchlist with one health score each does not want a table; a 93-row screen
//   over four metrics does. The composition chooses.
//
// ⚠ ROWS ARE ENTITIES, COLUMNS ARE MEASURES — AND THAT IS THE NAME'S WHOLE POINT.
//   The other table shape coming is a STATEMENT: rows are line items, columns are periods, nothing
//   navigates, and the column order is chronological rather than sortable. That is a different
//   renderer (`statement-table`, reserved) and forcing it through this one is exactly the strained
//   parameter §4.1 warns about. PG's peer panel, by contrast, IS this shape with different columns —
//   a parameter, not a variant.
//
// ⚠ EVERY COLUMN CARRIES ITS OWN SORT VALUE, SEPARATELY FROM ITS DISPLAY STRING. "₹1,234 Cr" and
//   "not held" sort as text into nonsense. `display` is what the reader reads (already formatted,
//   N-1); `sort` is the number the column orders by, and `null` means genuinely unheld — which sorts
//   LAST in either direction rather than as zero.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Coverage } from "../../resolve/contract.js";
import { digest, line, withheld, type DigestLine, type Section } from "../contract.js";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ HOW MANY ROWS TRAVEL. Not how many are SHOWN — the renderer pages through these.
 *
 * ⚠ IT WAS 12, AND 12 WAS THE WHOLE SET THE READER COULD EVER SEE. `LIST_CAP` is the projection
 *   layer's slice cap and it is right there: a universe slice is a sentence ("the six that moved
 *   most"). A screen is not a slice — the reader asked for a SET and 12 of 422 is a sample of one.
 *   Worse, "give me a list of ALL the stocks in the pristine band" returned 12 of 15, so the word the
 *   reader actually typed was the one being ignored.
 *
 * ★ SIXTY, AND IT IS A BOUND RATHER THAN AN ANSWER. Five pages at the renderer's twelve. It is stated
 *   in the prose wherever it bites, so a truncated set never reads as a complete one — the same rule
 *   `Capped` exists for. Raising it is a payload decision: these answers are PERSISTED per turn, so
 *   the cost is storage per conversation, not just wire.
 *
 * ⚠ AND IT IS DECLARED HERE, BESIDE THE RENDERER, because it is a property of THIS renderer's payload
 *   budget rather than of any one caller. Three callers already page through it.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export const SET_TABLE_TRANSPORT = 60;

export interface SetTableColumn {
  readonly key: string;
  readonly label: string;
  /** `text` left-aligns and sorts alphabetically; `number` right-aligns and sorts numerically. */
  readonly align: "text" | "number";
  /** Column the table sorts by on first render. Exactly one column should set it. */
  readonly primary?: boolean;
}

export interface SetTableCell {
  /** What the reader sees. Already formatted — a renderer never divides or rounds (N-1). */
  readonly display: string;
  /**
   * What the column sorts by. `null` = not held, and it sorts LAST in both directions.
   * ⚠ NEVER 0 for an unheld figure — that ranks "we do not know" above a real low value.
   */
  readonly sort: number | null;
}

export interface SetTableRow {
  readonly key: string;
  /** The entity's name, shown in the first column. */
  readonly title: string;
  /**
   * ★ THE STOCK THIS ROW IS ABOUT, SO THE ROW IS A DESTINATION. A symbol, never a URL — routing is
   * the frontend's and a backend emitting paths is a second place the route lives. `null` for a row
   * that is not a stock, which stays plain text rather than a link to nowhere.
   */
  readonly symbol: string | null;
  /** A categorical chip — a health band, a sector. `null` renders none. */
  readonly tag: string | null;
  /**
   * ★ THIS ROW IS THE ONE THE READER ASKED ABOUT — added at Phase 1 · Batch 2 for PG.
   *
   * ⚠ IT IS A PARAMETER AND NOT A RENDERER, AND THE TEST WAS RUN BEFORE ADDING IT. A peer roster is
   *   entities down and measures across with every row navigable — `set-table`'s own shape, exactly
   *   what it was named for. The ONE thing it could not express is that one of those rows is the
   *   company in the question, and a reader scanning eight tickers for their own is doing work the
   *   table should have done. That is a missing field, not a missing shape: `hero-set` and a
   *   screen's match list have no subject to mark, so the field is optional and absent everywhere
   *   else.
   *
   * ⚠ AND IT IS NOT `tag`. `tag` already carries the health band on this table, and overloading it
   *   would put two categorical facts in one slot and force the renderer to guess which it was
   *   looking at.
   */
  readonly highlight?: boolean;
  /** Parallel to `columns`, keyed by `column.key`. A missing key renders the absent cell. */
  readonly cells: Record<string, SetTableCell>;
}

export interface SetTablePayload {
  /**
   * ★ WHAT THIS SET IS, IN THE CARD'S OWN TITLE — added Phase 1 · Batch 2.
   *
   * ⚠ THE FRONTEND HARDCODED "What matched", AND THE RENDERER NOW HAS FOUR CALLERS. A peer roster
   *   matched nothing — it is a group; a pond roster matched nothing; a frame-declined RANKING
   *   matched nothing by construction and says so in its own prose two lines above. Only the screen
   *   ever matched anything, and it was the only caller when the constant was written.
   *
   * ★ EXACTLY THE DEFECT `SteppedPayload.title` FIXED IN BATCH 1, at the same layer and for the same
   *   reason: a renderer with a caller-specific constant in it is a renderer with one caller. The
   *   `heading` was already being passed to `setTableSection` and was going only into the DIGEST — so
   *   the model was told what the set was and the reader was not.
   */
  readonly heading: string;
  readonly columns: readonly SetTableColumn[];
  readonly rows: readonly SetTableRow[];
  /** How many the set actually has, when more than are shown. `null` ⇒ these are all of them. */
  readonly totalAvailable: number | null;
  /** Aggregate lines about the whole — "93 matched", "of 95 with a comparable figure". */
  readonly totals: readonly { readonly label: string; readonly value: string | null }[];
  /**
   * ⚠ AN EMPTY SET IS A SENTENCE WITH ITS OWN WORDS (N-4). A screen matching nothing is a RESULT —
   * the filter ran and the universe genuinely holds no such company — and must not read as a failure
   * to load. The backend supplies the phrase because only it knows which empty this is.
   */
  readonly emptyPhrase: string;
}

export function setTableSection(
  input: {
    heading: string;
    columns: readonly SetTableColumn[];
    rows: readonly SetTableRow[];
    totalAvailable?: number | null;
    totals?: readonly { label: string; value: string | null }[];
    /**
     * ═════════════════════════════════════════════════════════════════════════════════════════════
     * ★★ FACTS THE MODEL MUST HAVE AND THE READER MUST NOT BE SHOWN AS A ROW OF FIGURES.
     *
     * This is N-2's payload/digest split used for what it is for. The findings screen carries four
     * evaluation-state counts — fired · ran-and-did-not-fire · could-not-be-checked · never-checked —
     * and every one is load-bearing: a could-not-check silently folded into a did-not-fire reports a
     * company we could not evaluate as one that passed. The MODEL must never lose them.
     *
     * ⚠ BUT AS RENDERED TOTALS THEY WERE FIVE FIGURES AND TWO LINES ABOVE A TWELVE-ROW TABLE, and
     *   the reader had already been told all four in the prose directly above the card. Operator's
     *   call, and it is the right one: the badge says "showing 12 of 59" and the sentences carry the
     *   states. A card restating its own paragraph is noise, and §4.3's rule that prose and component
     *   must agree is satisfied by saying it once.
     *
     * ★ SO THE COUNTS TRAVEL IN THE DIGEST AND NOT IN THE PAYLOAD. Nothing is deleted; one audience
     *   keeps them. A caller that wants a fact SHOWN uses `totals`.
     * ═════════════════════════════════════════════════════════════════════════════════════════════
     */
    digestTotals?: readonly { label: string; value: string | null }[];
    emptyPhrase: string;
  },
  coverage: Coverage,
): Section<"ANCHOR", SetTablePayload> {
  const payload: SetTablePayload = {
    heading: input.heading,
    columns: input.columns,
    rows: input.rows,
    totalAvailable: input.totalAvailable ?? null,
    totals: input.totals ?? [],
    emptyPhrase: input.emptyPhrase,
  };

  // ⚠ THE DIGEST GETS THE TOTALS AND A BOUNDED SAMPLE, NEVER EVERY ROW. A model handed 93 rows will
  //   count them, average a column, or name "the top three" from an order it did not verify.
  const lines: DigestLine[] = [];
  // ★ BOTH CHANNELS REACH THE MODEL. `totals` is shown AND told; `digestTotals` is told only.
  for (const t of [...(input.totals ?? []), ...(input.digestTotals ?? [])]) {
    lines.push(t.value === null ? withheld(t.label, "not held") : line(t.label, t.value));
  }
  if (input.rows.length === 0) {
    lines.push(withheld("Rows", input.emptyPhrase));
  } else {
    lines.push(line("Rows shown", String(input.rows.length)));
    // ★ THE HIGHLIGHTED ROW GOES INTO THE DIGEST FIRST AND BY NAME. The model is handed at most five
    //   of N rows, and on a peer roster the one that matters is the company the reader asked about —
    //   which is not reliably in the top five by score. Without this the model writes about a group
    //   the reader is in and never mentions where they sit in it.
    const marked = input.rows.find((r) => r.highlight);
    if (marked) {
      lines.push(line(
        `${marked.title} — the company asked about`,
        input.columns.map((c) => `${c.label} ${marked.cells[c.key]?.display ?? "not held"}`).join(" · "),
      ));
    }
    for (const r of input.rows.slice(0, 5)) {
      const cells = input.columns
        .map((c) => `${c.label} ${r.cells[c.key]?.display ?? "not held"}`)
        .join(" · ");
      lines.push(line(r.title, cells));
    }
    if (input.rows.length > 5) lines.push(line("…", `${input.rows.length - 5} further rows not listed here`));
  }

  return {
    kind: "ANCHOR",
    renderer: "set-table",
    payload,
    coverage,
    digest: digest(input.heading, [{ label: input.heading, lines }]),
    interactions: input.rows.length > 1 ? [{ id: "sort", kind: "toggle", label: "Sort by any column" }] : [],
  };
}
