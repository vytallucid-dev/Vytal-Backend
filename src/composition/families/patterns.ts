// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FAMILY: PT · PATTERNS — "what has been flagged on TCS", "why was it flagged", "is anything wrong".
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE §4.1 TEST, SIXTH RUN — ONE COMPOSITION, AND THE INTERESTING PART IS WHAT IT DOES **NOT** CLAIM.
//
// "What does Sticky Divergence mean" looks like this family's question and is not. It names a term and
// no company, so it is M · Meta's — one lookup across five vocabularies, zero model tokens, no
// database read. This family answers the other shape: **what fired on THIS company**, which needs the
// company's own evidence and cannot be answered from a registry.
//
// The split is `Predicate.subject`, structurally: `required` here, `none` there. Two families, one
// verb, and neither can swallow the other's question by being registered first.
//
// ⚠ AND A CENSUS IS NOT A GLOSSARY. Each row carries its own rendered verdict — what happened at this
//   company — beside the rule's static description and its boundary. `readFindingsForSymbols` already
//   composes the verdict from the evidence bag, so nothing here re-derives it (N-3).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ── SECTION ORDER, AND WHY ────────────────────────────────────────────────────────────────────────
//   COVERAGE : coverage-header       what we hold (N-6)
//   CALLOUT  : findings              the SCORE channel — what fired, each with its boundary
//   CALLOUT  : findings              the FILING channel — a separate set, present even when unscored
//   NEXT     : chips
//
// ⚠ TWO CALLOUTS AND THEY ARE NOT A DUPLICATE. The two channels answer different questions and are
//   available on different companies: SCORE findings exist only where we score, FILING findings exist
//   for every symbol we hold anything about. `symbol-findings.service.ts` keeps them apart for exactly
//   this reason and its own header says so; merging them here would produce one list whose members
//   mean two different things, and on an unscored company the merged list would look like a score
//   census that happened to be short.
//
// ── ★ D-2 IS DECLINED, AND THIS FAMILY IS WHERE THAT BITES HARDEST ────────────────────────────────
// Every row here fired because a value crossed a bar, and 27 of the 49 stock findings carry
// `facts.thresholds` — the number is RIGHT THERE in the registry this family reads. It is not
// rendered. What the reader gets is what the finding means, what happened at their company, and what
// it explicitly does not mean; what they do not get is the cut. PT-02 is corrected under the plan's
// three-case rule rather than recorded as unbuilt, and the reason is written down in the plan because
// a bare "not built" against a cheap change invites the change.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { composeOneFinding } from "./finding-one.js";
import { resolvePatterns, type PatternRow } from "../../resolve/patterns.js";
import { resolveStockCoverage } from "../../resolve/stock-coverage.js";
import { calloutSection, type CalloutItem } from "../../section/kinds/callout.js";
import { stockCoverage } from "../../resolve/contract.js";
import { buildAnswer, SHAPE_ASSERTIONS, type Block } from "../answer.js";
import { findingsAsked } from "../../router/question-shape.js";
import type { AnySection, Composition } from "../contract.js";

const SEVERITY: CalloutItem["severity"] = "medium";

function toItem(r: PatternRow): CalloutItem {
  return {
    label: r.name,
    detail: r.verdict || r.description,
    // ⚠ `medium` RENDERS AS "WORTH NOTING", AND THAT IS THE RIGHT REGISTER HERE AND WAS WRONG FOR PG's
    //   ROUTINE MOVERS (Phase 1 · Batch 2 changed those to `low`). A rule that fired IS worth noting;
    //   a company scoring six points lower than last quarter inside its pond is context.
    severity: SEVERITY,
    doesntMean: r.doesntMean || undefined,
    subForms: r.subForms.length ? r.subForms : undefined,
  };
}

export const patterns: Composition = {
  id: "patterns.stock",
  family: "patterns",
  /**
   * ⚠ `minTier: 1`, NOT 2. The FILING channel exists for every symbol we hold anything about, scored
   *   or not — measured, BAJFINANCE and MANIPALHOS are unscored and both carry a populated filing set
   *   with a `quietNote`. A `minTier: 2` predicate would send those to the planner, which answered
   *   "what has been flagged on TCS" with a P&L table and an ownership split before this batch.
   */
  when: {
    operation: ["list_findings", "explain", "lookup"],
    /**
     * ⚠ THE LENS IS CONSTRAINED, AND IT WAS NOT ON THE FIRST REGISTRATION. Unconstrained, this family
     *   answered `explain · price` ("why did TCS fall today?"), `lookup · events` and `lookup ·
     *   valuation` with a findings census — three questions, one answer, caught by the price-surface
     *   obligation and by `I-DISTINCT` reporting three identical pairs.
     *
     * ★ `filings` IS CLAIMED BECAUSE THE FILING CHANNEL IS HALF THIS ANSWER. `null` is the un-narrowed
     *   "what has been flagged"; `health` is deliberately NOT claimed — a health question is
     *   T · Trajectory's or A · Attribution's, and both already partition it between themselves.
     */
    lens: [null, "filings"],
    subject: "required",
    minTier: 1,
    /**
     * ★ AND THE SENTENCE GUARD, FOR THE AMBIGUOUS OPERATIONS ONLY.
     *
     * `explain` and `lookup` with no lens on a resolved company are an enormous class and only some
     * of it is "what did the checks find" — that is what `findingsAsked` is for.
     *
     * ⚠ `list_findings` NEEDS NO GUARD AND WAS BEING BLOCKED BY ONE. Nothing else in `COMPOSITIONS`
     *   claims it and the slot MEANS "what has code flagged", so the sentence adds nothing. Measured:
     *   a bare "why" after a findings answer routes to `list_findings` (MT's referent map) and then
     *   failed this guard, because the sentence is the single word "why" and carries no signal by
     *   design. The family that owns the operation refused the follow-up its own answer had set up.
     */
    question: (raw, router) => router.operation === "list_findings" || findingsAsked(raw),
  },
  examples: [
    "what has been flagged on TCS",
    "why was INDUSINDBK flagged",
    "is anything wrong with HDFCBANK",
    "what did the checks find on BAJFINANCE",
  ],
  build: async (ctx) => {
    const symbol = ctx.symbol!;

    // ★★ ONE NAMED FINDING FIRST — `patterns.finding`, N-3. The census below answers the PLURAL
    //    question; when the reader has named a single finding, answering with the whole list is
    //    answering a question they did not ask. `composeOneFinding` returns null unless
    //    `searchVocabularies` matches a FINDING by name, so this can only ever take a sentence that
    //    named one, and the census keeps everything else.
    const one = await composeOneFinding(ctx.turn.raw, symbol);
    if (one) {
      return { sections: one.sections, prose: one.prose };
    }

    const [cov, res] = await Promise.all([resolveStockCoverage(symbol), resolvePatterns(symbol)]);
    const coverage = cov.coverage;
    const d = res.ok ? res.data : null;

    if (!d) {
      return buildAnswer({
        coverage,
        opening: [
          `We hold nothing on ${symbol} — not a filed quarter, not a scored reading — so there is `
          + `nothing for the checks to have run against.`,
        ],
        blocks: [],
        conclusion: `That is a coverage gap on our side, not a statement about the company.`,
        symbol,
        signals: { scored: false, findings: [], pledged: false, instSold: false, thin: true, marginFell: false },
      });
    }

    const scored = d.status === "scored";
    const scoreItems = d.rows.map(toItem);
    const filingItems = d.filingRows.map(toItem);

    // ── THE OPENING. §4.3's test: the sentences alone must be complete and true. That means saying
    //    which channel found what, and — where the set is empty — WHICH empty it is.
    const opening: string[] = [];
    if (scored) {
      opening.push(
        d.rows.length === 0
          ? `Nothing is flagged on ${symbol} for ${d.quarter}. The score checks ran against this `
            + `quarter and raised nothing — that is a result, not a blank.`
          : `${d.rows.length === 1 ? "One thing is" : `${d.rows.length} things are`} flagged on ${symbol} `
            + `for ${d.quarter}${d.total > d.rows.length ? ` (of ${d.total} in total)` : ""}: `
            + d.rows.map((r) => r.name).join(", ") + ".",
      );
    } else {
      // ⚠ THE UNSCORED ARM SAYS WHICH CHANNEL IT IS SPEAKING FROM, FIRST. A list of real filing
      //   findings on an unscored company reads as a score census unless the first sentence says
      //   otherwise, and the reader would then take "two findings" as our full reading of it.
      opening.push(
        `We do not score ${symbol}, so there are no score checks to report. What we do run against it `
        + `are the checks on its FILINGS, which do not need a score — and those are below.`,
      );
    }
    if (d.witness.sentence) opening.push(d.witness.sentence);
    if (d.notRescored) {
      opening.push(
        `One caution: ${symbol} has stopped being rescored, so what is below is real and is not current.`,
      );
    }

    const blocks: Block[] = [];
    if (scored) {
      blocks.push({
        lead: d.rows.length
          // ⚠ "and what it does not mean" WAS THE FIRST DRAFT AND IT MISDESCRIBES HALF THE CORPUS. The
          //   stock register states a scope and then negates ("a warning to investigate — not a
          //   prediction"), so introducing it as a negation says the opposite. "How far each one goes"
          //   is true of both registers.
          ? `What the score checks matched — and, beside each one, how far it goes.`
          : `Every score check we run, and what came back.`,
        section: calloutSection(
          `${symbol}'s scored quarter against every rule we run on it`,
          scoreItems,
          coverage,
          "findings",
          { setNote: d.witness.sentence, totalAvailable: d.total > d.rows.length ? d.total : null },
        ) as AnySection,
        after: d.rows.length
          // ★ D-2 NAMED, RATHER THAN THE READER DERIVING A CUT FROM THE WORDING.
          ? `Each of these fired because a filed value crossed a line we hold for companies of this `
            + `kind and size. What is shown is what the rule found; the line itself is not published.`
          : undefined,
      });
    }

    blocks.push({
      lead: scored
        ? `Separately, the checks that read the filings themselves rather than the score.`
        : `The filing checks, and what they found.`,
      section: calloutSection(
        `${symbol}'s filings against every rule that does not need a score`,
        filingItems,
        coverage,
        "findings",
        { setNote: d.quietNote },
      ) as AnySection,
      // ⚠ THE QUIET NOTE IS WHAT STOPS AN EMPTY SET READING AS A CLEAN BILL OF HEALTH. It names the
      //   capabilities that could not be checked, in words rather than as rule refs.
      after: d.quietNote ?? undefined,
    });

    const conclusion = scored
      ? d.rows.length === 0 && filingItems.length === 0
        ? `In short: nothing flagged on either channel for ${d.quarter}. Both sets of checks ran; `
          + `neither raised anything. This describes what has been filed, not what happens next.`
        : `In short: ${d.rows.length + filingItems.length} thing`
          + `${d.rows.length + filingItems.length === 1 ? "" : "s"} raised across the two channels. `
          + `Each is a configuration we detected, not a forecast — and the line beside each one, saying `
          + `how far it goes, is the part worth reading twice.`
      : `In short: no score checks, because we do not score ${symbol}; `
        + `${filingItems.length === 0 ? "and its filing checks raised nothing" : `${filingItems.length} raised on its filings`}. `
        + `The absence of a score is a coverage gap on our side, not a judgement about the company.`;

    return buildAnswer({
      coverage,
      opening,
      blocks,
      conclusion,
      symbol,
      signals: {
        scored,
        findings: d.rows.slice(0, 2).map((r) => r.name),
        pledged: false,
        instSold: false,
        thin: (stockCoverage(coverage)?.depth.quarters ?? 0) < 8,
        marginFell: false,
      },
    });
  },
  assertions: [
    ...SHAPE_ASSERTIONS,
    {
      name: "every flagged item carries its boundary, or the registry genuinely holds none",
      check: (s) => {
        for (const sec of s) {
          if (sec.kind !== "CALLOUT") continue;
          const p = sec.payload as { items?: { label: string; doesntMean?: string }[] } | null;
          for (const i of p?.items ?? []) {
            // ⚠ EMPTY IS ALLOWED AND `null`/whitespace IS NOT. A defaulted boundary is the failure this
            //   guards: absent means the registry holds none, which is visible; a plausible sentence
            //   nobody wrote is not.
            if (i.doesntMean !== undefined && i.doesntMean.trim().length < 10) {
              return `${i.label} carries a boundary that is not a sentence`;
            }
          }
        }
        return null;
      },
    },
    {
      name: "an empty findings set says WHICH empty it is",
      check: (s) => {
        for (const sec of s) {
          if (sec.renderer !== "nothing-found") continue;
          const p = sec.payload as { lookedFor?: string } | null;
          if (!p?.lookedFor || p.lookedFor.length < 10) {
            return "an empty callout does not say what was looked for";
          }
        }
        return null;
      },
    },
    {
      name: "no threshold reaches the reader (D-2)",
      check: (s) => {
        for (const sec of s) {
          if (sec.kind !== "CALLOUT") continue;
          const p = sec.payload as { items?: { label: string; detail: string }[] } | null;
          for (const i of p?.items ?? []) {
            // A rendered verdict may legitimately quote the company's OWN value. What must not appear
            // is the bar it was measured against, which is always phrased as a limit.
            if (/\b(threshold|cut-?off|the bar is|must exceed|below the limit of)\b/i.test(i.detail)) {
              return `${i.label}'s verdict names the bar it was measured against`;
            }
          }
        }
        return null;
      },
    },
  ],
};
