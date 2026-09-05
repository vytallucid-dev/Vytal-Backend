// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// COVERAGE · coverage-header — N-6: coverage is STATED, never discovered by collision.
//
// One renderer, and §4.1 gives the kind no others, because there is one question: what was searched,
// over what window, as of when, with what dropped. A composition that answers it in a footnote has
// answered it; a composition that leaves the reader to infer it from a short list has not.
//
// ⚠ THIS SECTION RENDERS EVEN WHEN EVERYTHING IS FINE. "2,290 searched, nothing dropped" is a
// statement a reader is entitled to. A coverage header that appears only when something went wrong
// teaches readers that its absence means completeness, which is the collision N-6 names.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { Coverage } from "../../resolve/contract.js";
import { digest, line, unchanged, withheld, type DigestLine, type Section } from "../contract.js";

export interface CoveragePayload {
  /** ★ WHAT KIND OF SUBJECT THIS DESCRIBES (stage 6). `null` when none resolved. A renderer that
   *  prints "Scored" against a mutual fund is stating something about a ladder the fund is not on. */
  readonly subjectKind: "stock" | "instrument" | "reader" | null;
  /** Stock only. `null` for every other kind — never 0, which is a real tier. */
  readonly tier: 0 | 1 | 2 | null;
  readonly tierLabel: string;
  readonly asOf: string | null;
  readonly windowLabel: string | null;
  readonly quarters: number | null;
  readonly snapshots: number | null;
  readonly universeSearched: number | null;
  readonly dropped: readonly { filter: string; dropped: number; why: string }[];
}

const TIER_LABEL: Record<0 | 1 | 2, string> = {
  0: "In our universe, no results filed with us yet",
  1: "Quarterly results held, not scored",
  2: "Scored",
};

export function coverageSection(
  coverage: Coverage,
  /**
   * ★ WHAT TO CALL THE BASIS WHEN NO SINGLE SUBJECT RESOLVED. Optional, and only consulted when
   * `coverage.subject` is null.
   *
   * ⚠ THE DEFAULT — "No single subject resolved" — IS ENGINEER-SPEAK AND IT REACHED A READER. On a
   * comparison, `subject` is null because there are TWO subjects, not because resolution failed, and
   * a reader who just asked to compare TCS and Infosys was told nothing resolved. It is a true
   * statement about a field name and a false one about their question. A caller that knows why the
   * subject is null says so in words; nothing else changes.
   */
  subjectlessLabel?: string,
): Section<"COVERAGE", CoveragePayload> {
  const s = coverage.subject;
  const q = coverage.query;

  // ★ ONE BRANCH PER SUBJECT KIND (stage 6). The old body read `s.tier`, `s.window` and `s.depth`
  //   unconditionally, which was correct while every subject was a stock and became a false statement
  //   the moment one was not: a fund is not tier 0, and the reader's portfolio has no period range.
  const stock = s?.kind === "stock" ? s : null;
  const instrument = s?.kind === "instrument" ? s : null;
  const reader = s?.kind === "reader" ? s : null;

  const payload: CoveragePayload = {
    subjectKind: s?.kind ?? null,
    tier: stock?.tier ?? null,
    tierLabel:
      stock ? TIER_LABEL[stock.tier]
      : instrument ? `${instrument.instrumentType.replace(/_/g, " ")}${instrument.analytics ? ", analytics held" : ", no computed analytics"}`
      : reader ? `Your holdings — ${reader.holdingsScored} of ${reader.holdings} scored`
      : subjectlessLabel ?? "No single subject resolved",
    asOf: s?.asOf ?? null,
    windowLabel: stock?.window ? `${stock.window.fromPeriod}–${stock.window.toPeriod}` : null,
    quarters: stock?.depth.quarters ?? null,
    snapshots: stock?.depth.snapshots ?? null,
    universeSearched: q?.universeSearched ?? null,
    dropped: q?.dropped.map((d) => ({ filter: d.filter, dropped: d.dropped, why: d.why })) ?? [],
  };

  const lines: DigestLine[] = [];

  // ★ WHEN THERE IS NO SUBJECT, SAY THAT AND STOP. The per-subject absent phrases all presuppose a
  //   company — "nothing has been filed with us for this company yet" is a statement ABOUT a company,
  //   and on an ambiguous search there is no company to make it about. Emitting them anyway describes
  //   the coverage of a stock nobody picked, which is the same defect `subject: null` was introduced
  //   to make unrepresentable. Caught on a live ambiguous resolve, not in review.
  if (!s) {
    // Same correction as `tierLabel`: a caller that knows WHY there is no single subject says so, and
    // the ambiguous-search wording is the fallback rather than the assumption.
    lines.push(
      subjectlessLabel
        ? line("Coverage", subjectlessLabel)
        : withheld("Coverage", "no single company was resolved — the search matched more than one"),
    );
  } else if (stock) {
    lines.push(line("Coverage", payload.tierLabel));
    lines.push(
      stock.asOf ? line("As of", stock.asOf)
        : withheld("As of", "no in-force reading — nothing has been filed with us for this company yet"),
    );
    lines.push(
      payload.windowLabel && stock.window
        ? line("Period range", `${payload.windowLabel} (${stock.window.periods} quarters)`)
        : withheld("Period range", "no quarterly results held"),
    );
    lines.push(
      payload.snapshots === null
        ? withheld("Scoring history", "we do not score this stock")
        : line("Scoring history", `${payload.snapshots} scored periods`),
    );
  } else if (instrument) {
    // ⚠ NO TIER LINE AND NO PERIOD RANGE. Both are stock concepts; printing "not scored" against a
    //   G-sec would answer a question nobody can ask of it.
    lines.push(line("Coverage", payload.tierLabel));
    lines.push(
      instrument.asOf ? line("As of", instrument.asOf)
        : withheld("As of", "no dated reading held for this instrument"),
    );
  } else if (reader) {
    lines.push(line("Coverage", payload.tierLabel));
    lines.push(
      reader.asOf ? line("As of", reader.asOf)
        : withheld("As of", "no portfolio snapshot has been computed yet"),
    );
    // ★ THE BOUND ON EVERY CLAIM THAT FOLLOWS. A book of 20 where 6 are scored supports a much
    //   narrower statement than one where 20 are, and the reader is entitled to that number BEFORE
    //   they read the answer rather than as a caveat under it.
    lines.push(
      reader.holdings === 0
        ? withheld("Holdings", "your book is empty — nothing to read")
        : line("Holdings", `${reader.holdings} held, ${reader.holdingsScored} of them scored`),
    );
  }

  if (q) {
    lines.push(line("Searched", `${q.universeSearched} companies`));
    // Rule 3 — "nothing was dropped" is a fact, and it appears.
    lines.push(
      q.dropped.length === 0
        ? unchanged("Filters applied", "none — nothing was excluded")
        : line("Filters applied", q.dropped.map((d) => `${d.why} (${d.dropped} excluded)`).join("; ")),
    );
  }

  return {
    kind: "COVERAGE",
    renderer: "coverage-header",
    payload,
    digest: digest("What this is based on", [{ label: "Coverage", lines }]),
    coverage,
    interactions: [],
  };
}
