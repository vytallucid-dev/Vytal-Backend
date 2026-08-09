// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 3 — THE STORY SHAPE. The facts, GROUPED AND ORDERED so the chain is given, not invented.
// PURE: no database, no I/O, no prisma.
//
// ── ★★ THE POINT, AND THE TRAP ───────────────────────────────────────────────────────────────────
// What makes a good answer read as a story is CAUSAL CHAINING, not prose style. The fact block hands
// the model a LIST — driver here, contrasts there, peers below, health at the bottom — so it writes a
// list. And telling a model to "write a story" over a list is asking it to invent the connections,
// which is exactly where fabricated causation comes from. It is also the one failure this feature has
// never had, and it is not going to be introduced by an instruction.
//
// So the chaining happens HERE, in the backend. The groups below are facts that were ALREADY computed;
// nothing in this file does arithmetic. All it does is put them in an order in which the connection is
// carried by the sequence, so the model narrates a chain it was handed.
//
// The driver bullet is the precedent and the proof that this works: computing share-of-move turned
// "depreciation is the driver" from an inference into a STATED RELATIONSHIP. This is that idea applied
// to the whole block instead of to one line.
//
// ── THE SIX GROUPS ───────────────────────────────────────────────────────────────────────────────
//   1 · WHAT MOVED                    the headline lines, the metrics that moved materially, and how
//                                     that move sat against the peer group
//   2 · WHY IT MOVED                  the driver (a computed attribution) and the contrasts that name
//                                     a mechanism
//   3 · WHAT THAT DID TO THE READING  margin trend, the profit-source finding, and every place two of
//                                     the quarter's own figures disagree
//   4 · WHAT VYTAL'S SCORE SAYS       the health movement, the band change, findings fired and cleared,
//                                     and the headline-versus-health divergence
//   5 · WHAT THE FULL YEAR SHOWS      the seven named annual rules. Q4 only, presence-gated
//   6 · WHAT IT DID NOT CHANGE        the family's defining figures that HELD
//
// ⚠ GROUP 6 IS NOT A FOOTNOTE, IT IS THE HALF THE OLD BLOCK COULD NOT SAY. "Bad loans steady at 1.17%,
// capital steady at 17.1%" is what a reader needs after four paragraphs about a margin, and it is pure
// arithmetic — the `steady` flag quarter-section.ts already computes against each metric's own band.
//
// ── ★★ WHY THERE ARE SIX AND NOT FOUR — BOTH SPLITS WERE BOUGHT BY MEASUREMENT ───────────────────
//
// GROUP 4 CAME OUT OF GROUP 3, BECAUSE GROUP 3 WAS DOING TWO JOBS. Measured across 493 cards, group 3
// held a mean of 2.72 facts and FOUR OR MORE on 125 of them — two margin series, the score move, the
// band change and a three-sentence MUST SAY divergence, all under one heading. Two of those are the
// quarter's own arithmetic disagreeing with itself; the rest are Vytal's longer-run score, which is on
// a different clock and answers a different question. One heading over both is what let a card's whole
// health movement be compressed into a subordinate clause. The divergence travels with the score,
// because that is the fact it is about.
//
// GROUP 5 IS THE FULL YEAR, AND ITS ABSENCE WAS AN OVERSIGHT WITH A MEASUREMENT ATTACHED. This file was
// written at Stage 3, against a block whose only sections were quarterly; the annual section arrived at
// Stage 4 and nothing re-opened the grouping. The consequence, measured: ZERO annual facts in the chain
// across 106 annual cards. On TCS's FY26Q4 that is nil debt, ₹48,424 crore of free cash flow and a 49%
// return on shareholders' money, all rendered on the card and none of it reaching the takeaway.
//
// ⚠ AND IT IS A GROUP OF ITS OWN RATHER THAN A PLACE IN GROUPS 1–4, WHICH IS THE WHOLE REASON THE
// OVERSIGHT WAS NOT SIMPLY UNDONE. Groups 1 to 4 are a CAUSAL CHAIN ABOUT A THREE-MONTH PERIOD. An
// annual fact is as-of a different question and cannot be a link in that chain: "revenue grew 14%, and
// free cash flow was ₹48,424 crore" is two periods joined by a comma, which reads as a consequence and
// is not one. annual-contrasts.ts makes that structural — its facts carry no group field to put them
// anywhere else, and it cannot see a quarterly figure to build such a sentence from in the first place.
//
// ── ⚠ WHAT THIS FILE DELIBERATELY DOES NOT DO (3c) ───────────────────────────────────────────────
// It does not hand the model Section 1's twelve to twenty-four metric lines to narrate. Those are
// backend-rendered with canonical display strings and are already on the card; re-narrating them would
// triple the output cost to restate strings the model was handed and give every restatement a fresh
// chance to mistype a figure. The groups below name at most a handful of metrics, and they name them
// because a chain runs through them — not to list the section again in sentences.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { metricGloss, type MetricKey } from "../../catalogue/quarter-metrics.js";
import { ANCHOR_ALWAYS, movementWithAnchor } from "./anchors.js";
import { peerMetricsFor } from "./peer-shape.js";
import { TOP_LINE_KEY, type Family } from "./manifest.js";
import type { MetricLine } from "./quarter-section.js";
import type { LineComparison, QuarterBriefFactBlock } from "./types.js";

/** One fact in the chain. `mustSay` marks the facts a brief is not allowed to leave out. */
export interface StoryFact {
  display: string;
  mustSay?: boolean;
}

export interface StoryGroup {
  key: "moved" | "why" | "reading" | "score" | "fullYear" | "held";
  /** The heading the model is shown. It names the LINK, which is what makes the order a chain. */
  heading: string;
  facts: StoryFact[];
}

/**
 * ★ A COMPLETE SENTENCE FOR A REPORTED LINE — 3d-E, AND THE STRUCTURAL HALF OF THAT FIX.
 *
 * ⚠ THE DEFECT: TTML's card carried "a net profit of a loss of ₹72 crore". Nothing rendered that. The
 * fact block handed the model `Net profit: a loss of ₹72 crore` — a LABEL and a PHRASE — and the model
 * composed them the way a label and a value are normally composed. The phrase already names what the
 * figure is, so gluing the label in front of it produces a sentence in which the noun appears twice.
 *
 * The fix is to stop handing the model a label and a value for the lines it actually narrates, and
 * hand it the finished sentence instead. `display` is already the canonical rendering; all that is
 * needed is the right verb in front of it, and the verb depends on the ChangeFact's KIND — which the
 * block already carries and which nothing downstream had been reading.
 *
 *   percent            "Revenue was ₹15,548 crore this quarter, up 14% against the same quarter last year."
 *   turnaround/to_loss "Net profit moved from a loss of ₹5 crore to ₹12 crore, against …"   (already a predicate)
 *   nil/both_loss/     "Net profit was a loss of ₹72 crore, against a loss of ₹68 crore in the same
 *   large_move          quarter last year."                                     (already carries the value)
 *   no comparison      "Revenue was ₹15,548 crore this quarter."
 */
/**
 * ⚠⚠ "STOOD AT", NOT "WAS" — AND IT IS NOT A STYLE CHOICE.
 *
 * The labels in this product are PLAIN LANGUAGE, and several of them are clauses rather than noun
 * phrases: "Policies still being paid after 1 year", "Premiums kept", "Times profit covers the
 * interest bill". Dropped into a `was` frame those produce "Policies still being paid after 3 years
 * was 76.1%" and "Premiums kept was ₹16,548 crore" — found on the first grouped render, on HDFCLIFE,
 * and the same class of defect as the annual gaps copy's quoted-heading note and 3d-C's hardcoded
 * "Sales".
 *
 * `stood at` is number-agnostic: it reads correctly after a singular subject, a plural one and a
 * clause, so one frame serves all sixty-seven labels and nothing has to classify them.
 */
// ★ EXPORTED because fact-block.ts's `disagreement()` now composes a sentence in the SAME frame —
// its display replaces `lineSentence` for that line (see group 1), so the two must open identically
// or a reader meets two different sentence shapes for the same kind of statement. One phrase, one
// home; a second literal "stood at" elsewhere would be a second authority on the frame.
export const STOOD = "stood at";

function lineSentence(line: LineComparison): string {
  const change = line.yoy ?? line.qoq;
  if (!change) return `${line.line} ${STOOD} ${line.current.display} this quarter.`;
  // These two kinds open with a verb and read as a predicate on their own.
  if (change.kind === "turnaround" || change.kind === "to_loss") return `${line.line} ${change.display}.`;
  // These three already contain the current figure; repeating it would print it twice in one sentence.
  if (change.kind === "nil" || change.kind === "both_loss" || change.kind === "large_move") {
    return `${line.line} ${STOOD} ${change.display}.`;
  }
  return `${line.line} ${STOOD} ${line.current.display} this quarter, ${change.display}.`;
}

/** A metric line as a sentence. `movement` already carries the Stage-1 anchor, folded in by
 *  anchors.ts, so an anchored metric arrives here with its position attached and this function does
 *  not need to know anchors exist. */
function metricSentence(line: MetricLine): string {
  // The chain wants one sentence, so the bare movement and its anchor are composed back together here.
  const l = { ...line, movement: movementWithAnchor(line) };
  if (!l.movement) return `${l.label} ${STOOD} ${l.display} this quarter.`;
  // ⚠ "steady at " IS quarter-section.ts's OWN WORDING, in one place (ratioMovement), and it is the
  // only movement string that opens with an adjective rather than a direction. `held` is the frame
  // that reads after it, and it is number-agnostic for the same reason `stood at` is.
  if (l.movement.startsWith("steady at ")) return `${l.label} held ${l.movement}.`;
  // "nil, as in …" and "₹A, against ₹B in …" already carry the figure; repeating it would print it twice.
  return l.movement.includes(l.display)
    ? `${l.label} ${STOOD} ${l.movement}.`
    : `${l.label} ${STOOD} ${l.display}, ${l.movement}.`;
}

/**
 * ★ THE FIGURES WHOSE HOLDING STILL IS WORTH SAYING (group 4).
 *
 * ⚠ NOT "EVERY METRIC THAT DID NOT MOVE". On a bank that is fourteen lines of nothing happening, and a
 * group that long stops being "what still holds" and becomes the metric section again in sentences.
 * These are the two or three figures whose STEADINESS is itself the news — capital and asset quality
 * for a lender, what the business keeps for a manufacturer, whether customers stay for a life insurer.
 *
 * ⚠ AND IT IS NOT THE PEER SET, THOUGH IT OVERLAPS IT. The peer set answers "what do two companies of
 * this kind get compared on" and is deliberately kept to three; this answers "what would a reader be
 * relieved to hear had not moved", which is a different question with a different answer. Core capital
 * is the case that separates them: it is not a peer comparison (every large bank clears the floor by a
 * wide margin, so the cross-section says little) and it is exactly what a reader wants to hear held.
 */
const STILL_HOLDS = {
  non_financial: ["operatingMargin", "netMargin"],
  banking: ["grossNpaRatio", "cet1Ratio", "costToIncomeRatio"],
  nbfc: ["netMargin"],
  life_insurance: ["persistencyRatio13Month", "solvencyRatio"],
  general_insurance: ["combinedRatio", "solvencyRatio"],
} as const satisfies Record<Family, readonly MetricKey[]>;

/** The still-holds set, plus the family's always-anchored figure, which belongs by definition. */
export function definingMetrics(family: Family): Set<MetricKey> {
  const out = new Set<MetricKey>([ANCHOR_ALWAYS[family] as MetricKey]);
  for (const k of STILL_HOLDS[family] as readonly MetricKey[]) out.add(k);
  return out;
}

/**
 * The fact block, as an ordered chain.
 *
 * Empty groups are dropped whole — a heading with nothing under it is the present-but-empty section
 * that schema.ts's guard exists to refuse, and it would read to the model as a slot to fill.
 */
export function buildStory(block: QuarterBriefFactBlock): StoryGroup[] {
  const family = block.identity.family;
  const lines = new Map<MetricKey, MetricLine>(block.quarter.lines.map((l) => [l.key, l]));
  const anchored = block.quarter.lines.filter((l) => l.anchor);
  const topLineKey = TOP_LINE_KEY[family] as MetricKey;

  // ⚠⚠ ONE PEER STATEMENT PER METRIC — FOUND BY RENDERING HDFCBANK'S CARD. The Stage-1 anchor and the
  // Stage-2 comparison are computed from the SAME counts, so a metric carrying both produced two
  // adjacent sentences saying one thing twice:
  //
  //   "Bad-loan share was steady at 1.2%…; lower than all 5 companies in its peer group…"
  //   "Of the 5 companies in its peer group that have filed this quarter, 5 reported a higher
  //    bad-loan share and none a lower one."
  //
  // The ANCHOR wins, because it rides the metric's own row directly under the figure it is about,
  // where a reader meets it at the moment they need it. The comparison sentence survives for every
  // metric the anchor budget did not reach — which is what the budget is for.
  const peerAnchored = new Set<string>(
    block.quarter.lines.filter((l) => l.anchor && l.anchorSource === "peer").map((l) => l.key),
  );

  // ── 1 · WHAT MOVED ───────────────────────────────────────────────────────────────────────────
  //
  // ★★ THE DISAGREEMENT RIDES ITS OWN LINE, AND THAT IS WHAT STOPS THE RESTATEMENT.
  //
  // ── THE DEFECT, FROM COCHINSHIP'S SHIPPED CARD ────────────────────────────────────────────────
  //   1 "Cochin Shipyard reported revenue of ₹1,484 crore this quarter, down 16% against the same
  //      quarter last year."
  //   4 "Cochin Shipyard had revenue up 10% against the previous quarter but down 16% against the
  //      same quarter last year."
  // …and the same pair again for net profit. Seven bullets carrying about four facts.
  //
  // ⚠⚠ AND THE REDUNDANCY RULE DID NOT FAIL — IT WAS OUTRANKED. "NEVER TWO SENTENCES ABOUT THE SAME
  // FIGURE" is in the prompt and HINDUNILVR's three tax bullets are its precedent. But that case was
  // three facts inside ONE group, where the rule reads unambiguously. Here the two sentences came
  // from DIFFERENT groups, and two stronger, more specific instructions pointed the other way:
  //
  //   · the disagreement is `mustSay`, and the omission check treats a dropped MUST SAY as a defect;
  //   · "WRITE TO THE GROUPS — roughly one sentence per group" turns two groups into two sentences.
  //
  // A general rule lost to two specific ones. Adding a third rule to arbitrate would be the same
  // instruction-stacking that produced failure 2 in this file's own history, so the FACT MOVED
  // instead: a disagreement about the top line or net profit is no longer a separate fact in group 3,
  // it REPLACES that line's sentence in group 1. One line, one fact, one bullet, both comparisons —
  // and the restatement is not forbidden, it is unconstructible.
  //
  // ── ★ WHAT SEPARATES "WORTH SAYING" FROM "A SECOND COMPARISON" — AND IT ALREADY EXISTED ───────
  // Nothing about WHEN a disagreement fires has changed, because that test was already the right one.
  // fact-block.ts's `disagreement()` returns null unless the two comparisons carry OPPOSITE SIGNS and
  // BOTH clear DISAGREEMENT_FLOOR_PCT. So:
  //   · directions genuinely conflict (up 10% QoQ, down 16% YoY) → the fact exists, and it survives
  //     here in full, folded into the line it is about. Nothing is lost.
  //   · a second comparison that merely agrees, or is immaterial → the fact was never built, so there
  //     was never a bullet to write.
  // The conflict test was never the problem. WHERE THE FACT LIVED was.
  const disagreeing = new Map(block.headline.disagreements.map((d) => [d.line, d]));
  const headlineFact = (line: LineComparison): StoryFact => {
    const d = disagreeing.get(line.line);
    // `mustSay` travels with the disagreement exactly as it did in group 3 — the fact has changed
    // position, not standing.
    return d ? { display: d.display, mustSay: true } : { display: lineSentence(line) };
  };
  const moved: StoryFact[] = [
    headlineFact(block.headline.revenue),
    headlineFact(block.headline.profit),
  ];
  // Anchored metrics that MOVED, minus the two the headline sentences already carry — the headline is
  // rendered from `block.headline`, which is the same figure by a different route, and printing both
  // would state one line twice in one group.
  for (const l of anchored) {
    if (l.key === topLineKey || l.key === "netProfit") continue;
    if (l.steady === true) continue;
    moved.push({ display: metricSentence(l) });
  }
  // Peer GROWTH comparisons sit here: "revenue grew 14%, and 4 of 6 co-members grew more slowly" is
  // one thought about one move, and splitting it across two groups would break the very chaining this
  // file exists for.
  for (const c of block.peers?.comparisons ?? []) {
    const spec = peerMetricsFor(family).find((s) => s.key === c.key);
    if (spec?.kind === "growth" && !peerAnchored.has(c.key)) moved.push({ display: c.display });
  }

  // ── 2 · WHY IT MOVED ─────────────────────────────────────────────────────────────────────────
  const why: StoryFact[] = [];
  if (block.driver) why.push({ display: block.driver.display });
  // ⚠ `mustSay` TRAVELS WITH THE RULE, like `group` does. A list of rule ids here would silently drop
  // every rule written after it into whichever default it happened to have — the same argument
  // ContrastFact's `group` field carries, and the same reason it lives on the rule.
  for (const c of block.contrasts) {
    if (c.group === "why") why.push({ display: c.display, ...(c.mustSay ? { mustSay: true } : {}) });
  }

  // ── 3 · WHAT THAT DID TO THE READING ─────────────────────────────────────────────────────────
  const reading: StoryFact[] = [];
  for (const c of block.contrasts) {
    if (c.group === "reading") reading.push({ display: c.display, ...(c.mustSay ? { mustSay: true } : {}) });
  }
  // ★★ THE DISAGREEMENTS ARE NO LONGER HERE — see group 1. This is the SECOND move for these facts
  // and the two moves are the same argument taken one step further:
  //
  //   3d-B  they were loose MUST SAY lines at the foot of the fact text, and became standalone
  //         bullets with no antecedent ("The two comparisons point opposite ways" opening a bullet,
  //         about nothing the reader had been told). Fix: put them in a GROUP, after the moves.
  //   now   a group of their own still bought them a bullet of their own, and that bullet restated
  //         the headline it followed. Fix: put them ON the line, replacing its sentence.
  //
  // Both times the fault was that the fact was positioned away from its subject. It now sits on it.
  // The HEADLINE-vs-HEALTH DIVERGENCE stays where it is — it belongs to the score group, is about two
  // different clocks rather than two comparisons of one figure, and restates nothing.
  for (const s of block.margins?.series ?? []) {
    reading.push({ display: s.plainDisplay ? `${s.directionDisplay} ${s.plainDisplay}` : s.directionDisplay });
  }
  if (block.profitSource) {
    reading.push({
      display:
        `Vytal detected this in the results: ${block.profitSource.name}. ${block.profitSource.description} ` +
        `What it does not mean: ${block.profitSource.doesntMean}`,
      mustSay: true,
    });
  }

  // ── 4 · WHAT VYTAL'S SCORE SAYS ──────────────────────────────────────────────────────────────
  // ★ SPLIT OUT OF GROUP 3. See the header: these are on a different clock from the quarter's own
  // arithmetic, and under one heading with it they were the facts that got compressed away.
  //
  // ⚠ THE DIVERGENCE COMES WITH THEM, AND IT IS THE REASON THE SPLIT IS A SPLIT RATHER THAN A MOVE.
  // "Net profit was higher, but the Vytal health score fell" is a sentence about the score's
  // relationship to the quarter, so it belongs where the score is — and it is the fact that gives this
  // group its point. Landing it in group 3 with the margin series left it as one more line in a list
  // that was already too long to survive a single bullet.
  const score: StoryFact[] = [];
  if (block.healthMovement) {
    const h = block.healthMovement;
    if (h.compositeChange) score.push({ display: h.compositeChange.display });
    if (h.bandChange) score.push({ display: h.bandChange.display });
    for (const f of h.findingsFired) score.push({ display: `Newly flagged — ${f.display}` });
    for (const f of h.findingsCleared) score.push({ display: `No longer flagged — ${f.display}` });
  }
  if (block.headlineHealthDivergence) {
    score.push({ display: block.headlineHealthDivergence.display, mustSay: true });
  }

  // ── 5 · WHAT THE FULL YEAR SHOWS ─────────────────────────────────────────────────────────────
  // Q4 only, and empty by construction on every other quarter: fact-block.ts gates `annualContrasts` on
  // the annual SECTION being present, so a full-year fact can never appear on a card that shows no
  // full-year figures for the reader to check it against.
  //
  // ⚠ THIS GROUP IS THE RULES AND NOTHING ELSE. It does not carry the annual section's nineteen lines,
  // for the same reason group 1 does not carry the quarter's twenty-four: they are backend-rendered and
  // already on the card, and re-narrating them would be listing a section back in sentences. What
  // reaches the reader here is what a NAMED RULE selected — no free-form annual field, ever.
  const fullYear: StoryFact[] = (block.annualContrasts ?? []).map((c) => ({ display: c.display }));

  // ── 6 · WHAT IT DID NOT CHANGE ───────────────────────────────────────────────────────────────
  // ⚠⚠ ONE FIGURE PER CARD, AND THIS ONE WAS FOUND BY RENDERING TCS AFTER THE GROUPS WENT TO SIX.
  //
  //   group 3  "Operating margin was 25.3% this quarter, while net margin was 19.5% this quarter."
  //   group 6  "Operating margin held steady at 25.3% against the same quarter last year, and net
  //             margin held steady at 19.5% against the same quarter last year."
  //
  // Two bullets, two headings, the same two figures. The overlap is structural, not incidental: a
  // non-financial's STILL_HOLDS set is `operatingMargin` and `netMargin`, and those are exactly the two
  // series margins.ts puts in group 3. It was survivable at four groups, where one bullet had to carry
  // several facts; at six the model has a slot for each and fills both. Same shape as the peer/anchor
  // duplication above, and the same resolution — the earlier statement wins, because it is the one the
  // chain runs through.
  //
  // ⚠ AND IT KEYS OFF THE SERIES THAT ACTUALLY RENDERED, NOT A FAMILY LIST. A hardcoded exclusion would
  // be a second copy of margins.ts's per-family decision, and would go wrong the moment a family's
  // margin is suppressed — where there IS no group-3 statement and the still-holds line is the only
  // place the figure gets said at all.
  const marginLabels = new Set((block.margins?.series ?? []).map((s) => s.label.toLowerCase()));
  const defining = definingMetrics(family);
  const held: StoryFact[] = [];
  for (const key of defining) {
    const l = lines.get(key);
    if (!l || l.steady !== true) continue;
    if (marginLabels.has(l.label.toLowerCase())) continue;
    held.push({ display: metricSentence(l) });
  }
  // Peer LEVEL comparisons follow their own metric: a defining figure that HELD, set against the group
  // it held relative to, is the "what still holds" half of the reading and belongs with it.
  for (const c of block.peers?.comparisons ?? []) {
    const spec = peerMetricsFor(family).find((s) => s.key === c.key);
    if (spec?.kind !== "level" || peerAnchored.has(c.key)) continue;
    const l = lines.get(c.key as MetricKey);
    (l?.steady === true ? held : moved).push({ display: c.display });
  }

  // ⚠ THE NUMBERS ARE POSITIONAL AND THEY RENUMBER. An empty group is dropped whole and the survivors
  // are numbered 1..n, so a card with no cause and no full year shows "1 · WHAT MOVED, 2 · WHAT THAT
  // DID TO THE READING" and not "1, 3". A heading numbered 3 on a card with two groups tells a model
  // there is a group 2 it was not shown, which is the checklist reading the prompt spends a paragraph
  // undoing. The KEY is the stable identity; the number is a position in what this card actually has.
  const groups: { key: StoryGroup["key"]; title: string; facts: StoryFact[] }[] = [
    { key: "moved", title: "WHAT MOVED", facts: moved },
    { key: "why", title: "WHY IT MOVED", facts: why },
    { key: "reading", title: "WHAT THAT DID TO THE READING", facts: reading },
    { key: "score", title: "WHAT VYTAL'S SCORE SAYS", facts: score },
    { key: "fullYear", title: "WHAT THE FULL YEAR SHOWS", facts: fullYear },
    { key: "held", title: "WHAT IT DID NOT CHANGE", facts: held },
  ];
  return groups
    .filter((g) => g.facts.length > 0)
    .map((g, i) => ({ key: g.key, heading: `${i + 1} · ${g.title}`, facts: g.facts }));
}

/** Every metric key the chain names, for a gate that needs to assert the chain stays small. */
export const storyMetricCount = (block: QuarterBriefFactBlock): number =>
  new Set(block.quarter.lines.filter((l) => l.anchor).map((l) => l.key)).size;

/** The label of the family's top line — used by the gate and by nothing else in this file. */
export const topLineLabelOf = (family: Family): string => metricGloss(TOP_LINE_KEY[family] as MetricKey).label;
