// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SLOT OBLIGATIONS — what a router slot OBLIGES the answer to contain.
//
// ── ★ THE STAGE-9 ROOT CAUSE, MADE ASSERTABLE ─────────────────────────────────────────────────────
// Four of seven routing defects had CORRECT slots and lost them downstream. `history` + `{years,10}`
// and `explain` + `price` both reached the composer intact and came back as the answer to "how is TCS
// doing". The router's log said the right thing the whole time, which is exactly why it read as a
// routing bug and was not one — and why no assertion on the ROUTER could have caught it.
//
// So the router's output and the reader's answer are asserted separately, and this table is the join
// between them: given these slots, this must be in the answer.
//
// ── ★ EVERY OBLIGATION IS "OR SAY WHY NOT", NEVER A BARE REQUIREMENT ─────────────────────────────
// A subject with no price history must not be forced to render a price block — it must render the
// block OR state the absence. Without that escape this becomes a gate that punishes honest
// degradation, and honest degradation is the thing the whole architecture is built to protect.
//
// ── ★ AND AN OBLIGATION NOTHING TRIGGERS IS A FAILURE, NOT A PASS ────────────────────────────────
// If no answer in the matrix carries `lens: price`, this rule is not satisfied — it is unexercised,
// and it has quietly stopped being a test. The gate reports that as a failure (§9.3's population rule
// applied to rules rather than to data).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { MatrixAnswer } from "./matrix.js";

/**
 * ★ §5's TABLE — what a slot OBLIGES the answer to contain.
 *
 * ⚠ THIS IS THE STAGE-9 ROOT CAUSE MADE ASSERTABLE. Four of seven routing defects had CORRECT slots
 *   and lost them downstream: `history` + `{years,10}` and `explain`+`price` both arrived at the
 *   composer intact and came back as the answer to "how is TCS doing". The router's log said the
 *   right thing the whole time, which is exactly why it read as a routing bug and was not one.
 *
 * ★ THE OBLIGATION IS "OR SAY WHY NOT", NEVER A BARE REQUIREMENT. A subject with no price history
 *   must not be forced to render a price block — it must render the block OR state the absence. The
 *   `absent` escape is what keeps this from becoming a gate that punishes honest degradation.
 */
/**
 * ⚠ A WORD SET, NOT A `\b` REGEX, AND THAT IS A SCAR THIS REPO HAS EARNED THREE TIMES. A word
 *   boundary written into a regex THROUGH A SCRIPT becomes a literal 0x08 backspace — invisible in
 *   every listing, matching nothing, and silently turning the rule into one that never fires. It
 *   happened again while writing this very obligation, and the self-test caught it: the control
 *   reported "THE HARNESS DID NOT CATCH IT", which is exactly what a negative control is for.
 *   families/reader.ts carries the same note over the same fix.
 */
const wordsOf = (q: string) => new Set(q.toLowerCase().replace(/[^a-z ]+/g, " ").split(/ +/).filter(Boolean));
const NOTIFY_WORDS = ["alert", "alerts", "reminder", "reminders", "notification", "notifications"];

export const SLOT_OBLIGATIONS: readonly {
  id: string;
  when: (a: MatrixAnswer) => boolean;
  requires: (a: MatrixAnswer) => boolean;
  why: string;
}[] = [
  {
    id: "lens=price ⇒ a price surface",
    when: (a) => a.slots.lens === "price" && a.kind === "composed",
    requires: (a) =>
      a.sections.some((s) => s.renderer === "composite-spine" || s.renderer === "peer-marker" || s.renderer === "news-list")
      || /price|priced|market/i.test(a.prose.opening.join(" ")),
    why: "a question narrowed to price answered without a price surface or a word about price",
  },
  {
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // ★★ EITHER A RUN, OR A SENTENCE SAYING WHY THERE IS NO RUN. The second arm was added at Phase 1 ·
    //    Batch 1 and it is a narrowing, not a relaxation — read the reasoning before widening it again.
    //
    // ⚠ THE OBLIGATION AS WRITTEN DEMANDED A PROMISE THE DATA CANNOT ALWAYS KEEP. It fired on "how has
    //   the promoter holding in MANIPALHOS moved" — a company that has filed exactly ONE shareholding
    //   pattern with us (measured). There is no multi-period surface to draw, and the composition
    //   correctly degrades to the register plus a sentence saying there is one filing and therefore no
    //   movement to read. Under the original rule the only ways to pass were to draw a chart of one
    //   point or to decline the turn, and both are worse answers than the one being flagged.
    //
    // ★ THE SECOND ARM IS NOT AN ESCAPE HATCH, BECAUSE IT REQUIRES THE ANSWER TO SAY SOMETHING
    //   SPECIFIC. An answer that simply omits the series still fails: it has to state, in prose, that
    //   the run could not be drawn — the words are what a reader actually needs, and they are the
    //   thing a lazy implementation would not bother to write. This is N-4 as an obligation: absence
    //   is STATED, never silent, and "we hold one filing" is a real answer to "how has this moved".
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    id: "operation=history ⇒ a run of periods, or the sentence saying why there is not one",
    when: (a) => a.slots.operation === "history" && a.kind === "composed",
    requires: (a) => {
      const drew = a.sections.some(
        (s) => s.renderer === "stepped-filing-line" || s.renderer === "composite-spine"
          || s.renderer === "own-history-band" || s.renderer === "statement-table",
      );
      if (drew) return true;
      // ⚠ THE PROSE MUST NAME THE SHORTFALL, not merely be non-empty. A count of what we hold, or an
      //   explicit statement that there is no movement / no trend / not enough history to read.
      const said = [...a.prose.opening, a.prose.close, ...Object.values(a.prose.leads)].join(" ");
      return /\b(?:one|1|a single|only one)\s+filing\b/i.test(said)
        || /no (?:movement|trend|history|series|run)\b/i.test(said)
        || /too few\b/i.test(said)
        || /\bwe hold (?:no|only)\b/i.test(said);
    },
    why:
      "a question about a RUN of periods answered with the latest period only, AND with nothing in the "
      + "prose saying why there is no run — a series that vanishes silently reads as one we did not bother to draw",
  },
  {
    id: "operation=compare + 2 subjects ⇒ a relative surface",
    when: (a) => a.slots.operation === "compare" && a.slots.subjects.length >= 2 && a.kind === "composed",
    requires: (a) => a.sections.some((s) => s.kind === "RELATIVE"),
    why: "two subjects resolved and the answer put nothing side by side",
  },
  {
    // ★ THE NOTIFICATION QUESTION IS ONE QUESTION, AND IT HAS TWO TABLES BEHIND IT.
    //
    // ⚠ A READER WITH NO ALERTS AND FOUR EVENT REMINDERS WAS TOLD THEY HAD NOTHING SET. `alerts`
    //   fire on a condition, `event_reminders` fire on a date; that separation is ours, not the
    //   reader's, and answering from one table while the other sat populated is N-4 broken in the
    //   most expensive direction — a confident "nothing".
    //
    //   The obligation is on the ANSWER carrying both surfaces, not on either being non-empty: a
    //   reader who genuinely has neither must still see both stated.
    id: "a notification question ⇒ both alerts AND reminders",
    when: (a) =>
      a.slots.perspective === "reader" && a.kind === "composed" && a.slots.action === null
      && NOTIFY_WORDS.some((w) => wordsOf(a.question).has(w)),
    requires: (a) => {
      const text = (a.prose.opening.join(" ") + " " + a.prose.close + " "
        + a.sections.map((s) => JSON.stringify(s.payload)).join(" ")).toLowerCase();
      return text.includes("alert") && text.includes("reminder");
    },
    why: "a question about being notified answered from one of the two mechanisms, with the other unmentioned",
  },
  {
    id: "action ⇒ an ACTION control",
    when: (a) => a.slots.action !== null && a.kind === "composed",
    requires: (a) => a.sections.some((s) => s.kind === "ACTION"),
    why: "the reader asked for a change and got no control to make it with",
  },
  {
    id: "lens=ownership ⇒ an ownership surface",
    when: (a) => a.slots.lens === "ownership" && a.kind === "composed",
    requires: (a) =>
      a.sections.some((s) => s.renderer === "ownership-split" || s.renderer === "own-history-band" || s.renderer === "filing-rail" || s.renderer === "pillar-bars")
      || /hold|owner|promoter|register/i.test(a.prose.opening.join(" ") + a.prose.close),
    why: "a question narrowed to ownership answered without the register or a word about who holds it",
  },
  {
    id: "perspective=reader ⇒ the reader's own book",
    when: (a) => a.slots.perspective === "reader" && a.kind === "composed" && a.slots.action === null,
    requires: (a) => a.compositionId.startsWith("reader.") || a.sections.some((s) => s.renderer === "hero-set" || s.renderer === "hero-dual"),
    why: "a question about the reader's own book answered about something else",
  },
  {
    id: "a resolved subject is never told it is uncovered",
    when: (a) => a.slots.subjects.length > 0,
    requires: (a) => a.kind !== "subject_not_covered",
    why: "a subject resolved and the answer said we do not cover it",
  },
];

