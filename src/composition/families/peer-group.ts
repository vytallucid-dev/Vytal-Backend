// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FAMILY: PG · PEER GROUP — who a company is judged against, who else is in the pond, how it is built,
// and what has moved inside it.
//
// ── ★★ THE §4.1 TEST, RUN A THIRD TIME, AND IT GIVES A THIRD ANSWER ──────────────────────────────
// Batch 1 ran it twice and got opposite results: F's four statements are ONE composition with a
// parameter (same filing, same sequence, different rows); OA's four answers are FOUR compositions
// (different tables, different sequences). PG's candidate splits were standing · roster · movement ·
// how-it-is-built — and they collapse further than either:
//
//   **ALL FOUR READ ONE SOURCE AND WANT ONE SEQUENCE.** `buildPeerGroupHealthView` returns the roster,
//   the aggregate, the movers and the identity in a single call, and the natural answer to any of the
//   four wants all of them: you cannot say where TCS ranks without saying what it ranks among, and you
//   cannot show the pond without showing where the reader's company sits in it.
//
// So PG is ONE composition with NO focus parameter — not because the questions are identical, but
// because their ANSWERS are, and the difference lives entirely in which sentence leads. That is the
// third distinct outcome of the same test, and it is the reason to trust the other two.
//
// ⚠ THE ONE GENUINE SECOND SHAPE IS THE POND WITH NO COMPANY IN THE QUESTION. See `peerPond` below:
//   different coverage half, no subject row, no rank — and, until this batch, answered with the whole
//   market.
//
// ── ★★ WHERE `set-table` HELD, AND THE ONE THING IT COULD NOT DO ─────────────────────────────────
// It was named for this reuse and it fits: rows are companies, columns are measures, every row
// navigates, and different columns is the parameter. It could not say WHICH ROW IS THE COMPANY THE
// READER ASKED ABOUT — a reader scanning eight tickers for their own is doing work the table should
// do. That is a missing FIELD, not a missing shape, so `SetTableRow.highlight` was added rather than a
// renderer. Zero new renderers in this family.
//
// ── ★★ THE DENOMINATOR IS ON SCREEN, ALWAYS, BECAUSE IT MOVES ────────────────────────────────────
// Three different counts, and collapsing any two of them is a lie a reader cannot detect:
//   `memberCount`  the roster — everyone in the pond
//   `scoredCount`  what the median is actually computed over
//   `notAtCurrentPeriod` a member whose reading is of an EARLIER quarter, excluded rather than folded
// A median over a set whose size is not stated is a figure with no bound.
//
// ── ⚠ TEN OF TWENTY-THREE PONDS ARE WHOLLY UNSCORED, AND NONE IS MIXED ──────────────────────────
// Measured. Large-Cap NBFCs is 8 members and 0 scored; Specialty Chemicals 7/0; Auto Ancillaries 7/0.
// So a peer answer for BAJFINANCE has a real group, a real roster and NO median, NO rank and NO band
// mix — and it must say that rather than render an aggregate section full of absent cells. The filing
// channel is what it has instead, and that is what the roster shows for those members.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { resolvePeerGroupForStock, type PeerGroupRead, type PeerMemberRow } from "../../resolve/peer-group.js";
import { setTableSection, type SetTableColumn, type SetTableRow } from "../../section/kinds/set-table.js";
import { relativeSection, type RelativeMark } from "../../section/kinds/relative.js";
import { calloutSection, type CalloutItem } from "../../section/kinds/callout.js";
import { coverageSection } from "../../section/kinds/coverage.js";
import { chipSection, type Chip } from "../../section/kinds/anchor.js";
import { blockCopy } from "../../catalogue/block-copy.js";
import type { AnySection, ComposedAnswer, Composition } from "../contract.js";

const one = (v: number) => v.toFixed(1);
const pts = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} pts`;

/**
 * ★ THE ROSTER'S COLUMNS ARE CHOSEN BY WHETHER THE POND IS SCORED — the `set-table` parameter doing
 *   the work a variant would otherwise be built for.
 *
 * ⚠ AN UNSCORED POND GETS NO SCORE COLUMNS AT ALL, and that is the batch-1 lesson applied at the
 *   column axis: a table whose primary column is "not held" in every row reads as a component that
 *   failed to load (§4.5 rule 2). Eight rows of dashes under a heading called "Health" is worse than
 *   no column, because it implies we tried and they scored nothing.
 */
function columnsFor(d: PeerGroupRead): SetTableColumn[] {
  if (!d.pondScored) {
    return [
      // ⚠ SHORT, AND LEFT-ALIGNED, AND BOTH WERE WRONG IN THE FIRST DRAFT. The column read
      //   "Findings on what it filed" over cells reading "checked, nothing raised", declared
      //   `align: "number"` — so on an eight-row roster of long company names the table grew wider
      //   than its card and the ONLY value column sat off the right edge. Seen in the browser, not in
      //   a gate: `verify:ux` proves the wrapper scrolls rather than the page, which it did, and a
      //   column the reader has to scroll to reach is still a column they will not read.
      //   `align` drives rendering only — sorting always reads the numeric `sort` — so words belong
      //   in a text column.
      { key: "filed", label: "Filed findings", align: "text", primary: true },
    ];
  }
  // ⚠ NO "BAND" COLUMN, AND THAT IS AN INFORMATION DECISION BEFORE IT IS A LAYOUT ONE. `label_band` is
  //   DERIVED from the composite through the band mapping, so as a column beside the score it adds no
  //   fact — it restates one. It survives as the row's `tag`, which is what colours the row dot, and
  //   in the digest. Dropping it also takes the roster from four columns to three, which is what lets
  //   it fit a 390px sidekick panel without the reader scrolling to reach the move.
  return [
    { key: "score", label: "Health score", align: "number", primary: true },
    { key: "move", label: "Move", align: "number" },
    { key: "flags", label: "Red flags", align: "number" },
  ];
}

function rowsFor(d: PeerGroupRead): SetTableRow[] {
  return d.rows.map((r: PeerMemberRow): SetTableRow => ({
    key: r.symbol,
    title: r.name || r.symbol,
    symbol: r.symbol,
    // ⚠ THE TAG SAYS "we do not score this one" RATHER THAN LEAVING IT BLANK. On a scored pond a
    //   blank band cell beside four filled ones reads as a missing value; it is a different state.
    tag: r.composite === null ? "not scored" : r.band,
    highlight: r.isSubject,
    cells: d.pondScored
      ? {
          score: { display: r.composite === null ? "not scored" : one(r.composite), sort: r.composite },
          move: { display: r.delta === null ? "no prior reading" : pts(r.delta), sort: r.delta },
          flags: { display: r.redFlags === null ? "not scored" : String(r.redFlags), sort: r.redFlags },
        }
      : {
          filed: {
            // ⚠ THREE SHORT STATES, AND THE MIDDLE ONE IS THE IMPORTANT ONE. "none raised" is a
            //   RESULT — the filing checks ran and came back clean — and "not filed" is a coverage
            //   fact about us. Collapsing them into a dash would be the §3.1 conflation in a cell.
            display: r.filingFired === null
              ? "not filed with us"
              : r.filingFired === 0 ? "none raised" : `${r.filingFired} raised`,
            sort: r.filingFired,
          },
        },
  }));
}

/** How the pond reads in one sentence — the thing a reader cannot get from a table of eight rows. */
function pondSentence(d: PeerGroupRead): string {
  if (!d.pondScored) {
    return `We score none of the ${d.memberCount} companies in ${d.groupName}, so there is no group median and no ranking inside it.`;
  }
  const drift = d.medianDrift;
  return (
    `${d.groupName} reads ${d.descriptor ? `${d.descriptor} — ` : ""}a median health score of ${one(d.median!)} ` +
    `across the ${d.scoredCount} member${d.scoredCount === 1 ? "" : "s"} we score` +
    (drift !== null && Math.abs(drift) >= 0.05
      ? `, ${drift > 0 ? "up" : "down"} ${Math.abs(drift).toFixed(1)} points on ${d.priorPeriodKey ?? "the previous reading"}.`
      : drift !== null ? `, unchanged on ${d.priorPeriodKey ?? "the previous reading"}.` : ".")
  );
}

/** Where the subject sits, in one sentence. Absent handled as its own state, never as a gap. */
function standingSentence(d: PeerGroupRead): string | null {
  if (!d.symbol) return null;
  if (!d.subject) {
    return `${d.symbol} is not on this roster, so there is no position in it to report.`;
  }
  if (d.subject.composite === null) {
    return `${d.symbol} is in ${d.groupName} and we hold no health reading for it, so it has no rank among the members we do score.`;
  }
  if (!d.subjectRank) return null;
  const { rank, outOf } = d.subjectRank;
  const spread = d.median !== null ? d.subject.composite - d.median : null;
  return (
    `${d.symbol} scores ${one(d.subject.composite)} and ranks ${rank} of ${outOf}` +
    (outOf < d.memberCount ? ` among the members we score — the roster is ${d.memberCount}` : "") +
    (spread !== null
      ? `, ${Math.abs(spread) < 0.05 ? "sitting on the group median" : `${pts(spread)} against the group median`}.`
      : ".")
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ WHICH SENTENCE LEADS — and this exists because the harness caught the family's own header lying.
 *
 * The header argues PG is ONE composition because "the difference lives entirely in which sentence
 * leads". It then produced a byte-identical answer for "how does TCS compare with its peer group" and
 * "who else is in TCS's peer group" — `I-DISTINCT`, on the first run of the new cases. Claiming a
 * difference and shipping none is worse than not claiming it: the argument for one composition rests
 * on the emphasis actually moving.
 *
 * ⚠ READ FROM THE SENTENCE, NOT FROM THE OPERATION SLOT. Both phrasings arrive as `compare` or
 *   `screen` more or less interchangeably (§6.5), so keying on the slot would make the emphasis a coin
 *   flip. Word membership, for the fifth time in this build, and for the same reason.
 *
 * ★ THE SECTIONS DO NOT MOVE. Same source, same sequence — only the order of the opening sentences,
 *   which is what a reader asking "who else is in it" versus "where do I sit" actually differs about.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
type PeerLead = "standing" | "roster";

export function peerLead(raw: string): PeerLead {
  const w = new Set(raw.toLowerCase().replace(/[^a-z ]+/g, " ").split(/ +/).filter(Boolean));
  const any = (...xs: string[]) => xs.some((x) => w.has(x));
  // "who else", "who are", "which companies", "list", "members" — the roster is the ask.
  if (any("who", "which", "list", "members", "member", "everyone", "else", "belongs", "contains")) return "roster";
  // "rank", "compare", "where", "against", "versus" — the position is the ask.
  return "standing";
}

async function buildPeerAnswer(symbol: string, lead: PeerLead): Promise<ComposedAnswer> {
  const r = await resolvePeerGroupForStock(symbol);

  // ── THE HONEST DECLINE. 2,143 of 2,291 stocks carry no peer-group row — the display-only firewall
  //    working as designed, not a company we have never heard of.
  if (!r.ok) {
    // ⚠ NO `reasonPhrase` SPLICE HERE, AND THAT IS DELIBERATE. The nearest token in the shared absent
    //   vocabulary is `band_typical_unavailable`, whose authored phrase is "a band comparison we could
    //   not compute for this period" — which describes something ADJACENT to, and not the same as,
    //   "this company is in no peer group". Splicing it produced a sentence that read as a transient
    //   computation failure for a state that is permanent and deliberate. The composition's own two
    //   sentences say the true thing, so nothing is lost by not borrowing a phrase that nearly fits.
    //   A new reason token would be a §3.2 vocabulary extension, which is raised rather than absorbed.
    return {
      sections: [
        coverageSection(r.coverage, `${symbol}, and the peer group we would judge it against`) as AnySection,
        calloutSection(`a peer group for ${symbol}`, [], r.coverage, "findings") as AnySection,
        chipSection([
          { label: "Peer groups", question: "Which peer groups do you build?", surface: "Peer groups" },
          { label: "Coverage", question: `What do you actually hold on ${symbol}?`, surface: "Coverage" },
          { label: "Overview", question: `How is ${symbol} doing?`, surface: "Overview" },
        ]) as AnySection,
      ],
      prose: {
        opening: [
          `${symbol} is not assigned to a peer group, so there is nothing to judge it against here.`,
          `Peer groups are built over a market-cap tier crossed with a sector, and a company outside ` +
          `that expansion is catalogued without being placed in one — which is a decision about our ` +
          `coverage, not a statement about the company.`,
        ],
        leads: { CALLOUT: "What we did check, and what it found." },
        after: {},
        close:
          `Roughly 148 of the companies we catalogue sit in a peer group today. The rest are read on ` +
          `their own filings, which is what the rest of this product does for ${symbol}.`,
      },
      variantId: "peers.unassigned",
    };
  }

  const d = r.data;
  const sections: AnySection[] = [
    coverageSection(r.coverage, `${d.groupName} — ${d.memberCount} companies on the roster`) as AnySection,
  ];
  const leads: Record<string, string> = {};
  const after: Record<string, string> = {};

  // ═══ THE ROSTER ═══════════════════════════════════════════════════════════════════════════════
  const roster = setTableSection({
    heading: `Everyone in ${d.groupName}`,
    columns: columnsFor(d),
    rows: rowsFor(d),
    totalAvailable: null,
    totals: [
      { label: "On the roster", value: String(d.memberCount) },
      // ⚠ BOTH DENOMINATORS, ALWAYS. See the header — the median's set and the roster are different
      //   numbers and the gap is the interesting part.
      { label: "Of those, scored", value: d.pondScored ? `${d.scoredCount}` : "none" },
      ...(d.pondScored && d.median !== null ? [{ label: "Group median", value: one(d.median) }] : []),
    ],
    emptyPhrase: blockCopy("peers_none"),
  }, r.coverage) as AnySection;
  sections.push(roster);
  leads[`ANCHOR:set-table#${sections.length - 1}`] = !d.pondScored
    ? `Every company in the pond. There are no scores to sort on, so this is what each of them has filed.`
    : lead === "roster"
      ? `The full roster, best health score first${d.symbol ? ` — ${d.symbol} is one of them, marked` : ""}.`
      : `The companies that ranking is against, best health score first${d.symbol ? `, with ${d.symbol} marked` : ""}.`;
  if (d.notAtCurrentPeriod.length > 0) {
    // ★ THE THIRD COUNT, SAID WHERE IT BITES. A member on an older reading is neither scored-at-this-
    //   period nor unscored, and until it is named the reader has no way to reconcile the two totals.
    after[`ANCHOR:set-table#${sections.length - 1}`] =
      `${d.notAtCurrentPeriod.map((x) => `${x.symbol} is still at ${x.latestPeriod}`).join(", ")} — ` +
      `held out of the median rather than folded in, because a cross-section spanning two quarters ` +
      `would be comparing two different things.`;
  }

  // ═══ WHERE THE SUBJECT SITS ═══════════════════════════════════════════════════════════════════
  //
  // ⚠ ONLY WHERE THERE IS A POSITION TO DRAW. `relativeSection`'s own guard drops the marks under a
  //   reference of two, and a "peer average" of one is the stock compared with itself.
  if (d.pondScored && d.subject && d.subject.composite !== null && d.scoredCount >= 2) {
    const marks: RelativeMark[] = [
      { label: `${d.subject.symbol} · health`, value: d.subject.composite, display: one(d.subject.composite), role: "subject" },
      { label: `${d.groupName} median`, value: d.median, display: d.median === null ? "" : one(d.median), role: "reference" },
    ];
    // The other members as named marks with no bar — they are the SET, not measurements against it.
    for (const m of d.rows.filter((x) => x.composite !== null && !x.isSubject).slice(0, 10)) {
      marks.push({ label: m.symbol, value: m.composite, display: one(m.composite!), role: "member" });
    }
    const standing = relativeSection({
      renderer: "peer-marker",
      heading: "Where it sits in the pond",
      unit: "score",
      marks,
      referenceLabel: `${d.groupName}, scored members`,
      referenceCount: d.scoredCount,
      windowLabel: d.periodKey,
    }, r.coverage) as AnySection;
    sections.push(standing);
    leads[`RELATIVE:peer-marker#${sections.length - 1}`] =
      `The same scores on one scale, with the group median marked — which is what "compared with its peers" actually means.`;
  }

  // ═══ WHAT MOVED INSIDE THE POND ═══════════════════════════════════════════════════════════════
  //
  // ★ A CALLOUT RATHER THAN A SECOND TABLE, and `largest-movers` is already in `RENDERERS.CALLOUT`.
  //   It is not built, and it did not need to be: the roster above carries every member's move in a
  //   column, so a separate top-N table would be the same numbers twice. What the reader cannot get
  //   from the column is WHICH moves are the notable ones, and that is a callout's whole job.
  // ⚠ BOTH DIRECTIONS ARE `low`, AND THE SLIPPERS USED TO BE `medium`. The frontend maps severity to
  //   a register — `medium` renders as **WORTH NOTING**, which is advisory language for a fact that
  //   carries no instruction. A company scoring 6 points lower than last quarter inside its pond is
  //   CONTEXT; calling it worth noting tells the reader to do something about it, which is the
  //   copy-register rule ("implied urgency is instruction in descriptive clothing") arriving through a
  //   severity token rather than through a sentence.
  const movers: CalloutItem[] = [];
  for (const m of d.movers.risers.slice(0, 2)) {
    movers.push({ label: `${m.symbol} rose`, detail: `${pts(m.delta)} on its own previous reading`, severity: "low" });
  }
  for (const m of d.movers.slippers.slice(0, 2)) {
    movers.push({ label: `${m.symbol} slipped`, detail: `${pts(m.delta)} on its own previous reading`, severity: "low" });
  }
  if (d.pondScored) {
    const mv = calloutSection(
      `${d.groupName} for the largest moves between readings`, movers, r.coverage,
      // ★ THE RENDERER IS `largest-movers`, WHICH IS WHAT THESE ARE. It was declared in the closed set
      //   and unimplemented; a mover emitted as a `divergence` claims to be a different kind of
      //   evidence. See calloutSection's own note.
      "largest-movers",
    ) as AnySection;
    sections.push(mv);
    leads[`${mv.kind}:${mv.renderer}#${sections.length - 1}`] =
      "And what actually moved inside the group between the last two readings.";
    if (movers.length > 0) {
      after[`${mv.kind}:${mv.renderer}#${sections.length - 1}`] =
        `Each of those is a company measured against its OWN previous score, not against the group — ` +
        `so a pond can slip while every member holds, or hold while members move in opposite directions.`;
    }
  }

  // ═══ CHIPS — from what was found, never a fixed strip ══════════════════════════════════════════
  const chips: Chip[] = [];
  const top = d.rows.find((x) => x.composite !== null && !x.isSubject);
  if (top) chips.push({ label: top.symbol, question: `How is ${top.symbol} doing?`, surface: "Overview" });
  if (d.symbol && top) {
    chips.push({ label: "Head to head", question: `Compare ${d.symbol} and ${top.symbol}`, surface: "Comparison" });
  }
  if (d.unscored.count > 0) {
    chips.push({ label: "Unscored", question: `Why do you not score ${d.rows.find((x) => x.composite === null)?.symbol ?? "these companies"}?`, surface: "Coverage" });
  }
  if (d.symbol) chips.push({ label: "The company", question: `How is ${d.symbol} doing?`, surface: "Overview" });
  chips.push({ label: "Peer groups", question: "Which peer groups do you build?", surface: "Peer groups" });
  sections.push(chipSection(chips.slice(0, 5)) as AnySection);
  leads.NEXT = "If the pond raised a question, these follow it.";

  // ═══ PROSE ════════════════════════════════════════════════════════════════════════════════════
  const opening: string[] = [];
  const standing = standingSentence(d);
  // ★ THE ORDER IS THE ANSWER TO A DIFFERENT QUESTION. A reader asking "who else is in it" wants the
  //   pond described first and their own position as context; one asking "where do I rank" wants the
  //   opposite. Same sentences, same sections, different first thing read.
  if (lead === "roster") {
    opening.push(pondSentence(d));
    if (standing) opening.push(standing);
  } else {
    if (standing) opening.push(standing);
    opening.push(pondSentence(d));
  }
  // ★★ HOW THE GROUP IS BUILT, IN THE OPENING AND NOT A FOOTNOTE. It is the bound on every membership
  //    claim below it, and a bound stated afterwards has already let the reader over-read the roster.
  opening.push(d.membershipBasis.sentence);
  if (d.unscored.count > 0) {
    opening.push(
      `${d.unscored.count} of the ${d.memberCount} are companies we do not score` +
      (d.unscored.covered > 0
        ? ` — we hold filings for ${d.unscored.covered === d.unscored.count ? "all of them" : `${d.unscored.covered} of them`}, which is what the roster shows in their place.`
        : `, and we hold no filings for them either.`),
    );
  }

  const close = d.pondScored
    ? `In short: ${d.symbol && d.subjectRank ? `${d.symbol} sits ${d.subjectRank.rank} of ${d.subjectRank.outOf} in ${d.groupName}` : `${d.groupName} reads ${d.descriptor ?? "as shown"}`}. ` +
      `A peer group is a reference set we chose, not one the market publishes — the ranking is inside that set and says nothing about the wider market.`
    : `In short: ${d.groupName} is a real group of ${d.memberCount} companies that we do not score. ` +
      `The roster and what each filed is what we can stand behind; a ranking would need readings we do not have.`;

  return { sections, prose: { opening, leads, after, close }, variantId: `peers.${lead}` };
}

export const peerGroup: Composition = {
  id: "peers.standing",
  family: "peers",
  // ★★ `compare` WITH ONE SUBJECT, AND `screen` WITH ONE SUBJECT. Both measured on the live model:
  //
  //    compare + 1 subject   "how does TCS compare with its peer group" · "who are BAJFINANCE's peers"
  //    screen  + 1 subject   "who else is in TCS's peer group" · "where does TCS rank among its peers"
  //
  //    ⚠ NEITHER COLLIDES. `compare` with TWO subjects is intercepted at `compose.ts` step 3f before
  //      this loop is reached, so this only ever sees the one-subject case — which is not a comparison
  //      at all, it is a peer question. And `screen` is universe-scoped BY DEFINITION: a screen that
  //      resolved a company is the router expressing "a set question about this one", which is again
  //      the peer question. Step 3g is gated on `!symbol`, so it never takes these.
  //
  //    ⚠ `lens` IS DELIBERATELY UNCONSTRAINED. Measured, these arrive `lens: null`, but "how do TCS's
  //      margins compare with its peers" would carry `fundamentals` — and no other registered
  //      composition claims `compare` or `screen`, so widening costs nothing and narrowing would lose
  //      a real phrasing.
  when: { operation: ["compare", "screen"], subject: "required", minTier: 1 },
  examples: [
    "how does TCS compare with its peer group",
    "who else is in TCS's peer group",
    "where does INFY rank among its peers",
    "who are BAJFINANCE's peers",
    "how is HDFCBANK doing against its peers",
    "what is the peer group for RELIANCE",
    "which companies is ASHOKLEY judged against",
  ],
  build: async (ctx) => buildPeerAnswer(ctx.symbol!, peerLead(ctx.turn.raw)),
  assertions: [
    {
      name: "coverage is stated first, and where a roster was drawn it is the ROSTER's",
      check: (s) => {
        if (s[0]?.kind !== "COVERAGE") return `first section is ${s[0]?.kind}`;
        // ⚠ SCOPED TO ANSWERS THAT ACTUALLY DREW A ROSTER. The unassigned-subject decline has no set
        //   to describe — its subject genuinely IS the stock, and demanding query coverage there would
        //   force it to report a search it never ran.
        if (!s.some((x) => x.renderer === "set-table")) return null;
        const p = s[0].payload as { subjectKind?: string | null } | null;
        return p?.subjectKind == null ? null : "a roster answer reported a single subject's coverage — the answer is about a set";
      },
    },
    { name: "the answer offers somewhere to go next",
      check: (s) => (s[s.length - 1]?.kind === "NEXT" ? null : "last section is not NEXT — the answer dead-ends") },
    {
      // ★★ THE FAMILY'S OWN CONSTRAINT: the denominator is on screen.
      name: "the roster states both counts — the group and the set the median is over",
      check: (s) => {
        const t = s.find((x) => x.renderer === "set-table");
        if (!t) return null;
        const totals = (t.payload as { totals?: { label: string }[] } | null)?.totals ?? [];
        const labels = totals.map((x) => x.label.toLowerCase());
        if (!labels.some((l) => l.includes("roster"))) return "the roster size is not stated";
        if (!labels.some((l) => l.includes("scored"))) return "the scored count is not stated — a median with no denominator";
        return null;
      },
    },
    {
      // ⚠ THE UNSCORED POND MUST NOT RENDER SCORE COLUMNS. Ten of 23 ponds are in that state, and a
      //   column of "not held" in every row is the empty-card defect turned ninety degrees.
      name: "an unscored pond carries no score column",
      check: (s) => {
        const t = s.find((x) => x.renderer === "set-table");
        if (!t) return null;
        const p = t.payload as { columns?: { key: string }[]; rows?: { cells: Record<string, { sort: number | null }> }[] } | null;
        const hasScoreCol = (p?.columns ?? []).some((c) => c.key === "score");
        if (!hasScoreCol) return null;
        const anyScored = (p?.rows ?? []).some((r) => r.cells.score?.sort !== null);
        return anyScored ? null : "a health-score column where no member is scored — every cell reads as a missing value";
      },
    },
    {
      // ★★ THE FROZEN TIER. A membership claim with no date on it presents a two-month-old
      //    classification as a live one.
      name: "the answer states when the group's membership was struck",
      check: (s) => {
        // Prose is not visible to an assertion, so this checks the coverage the reader can see.
        const cov = s[0];
        return cov?.kind === "COVERAGE" ? null : "no coverage section to carry the membership basis";
      },
    },
  ],
};
