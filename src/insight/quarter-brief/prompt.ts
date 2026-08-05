// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — THE PROMPT.
//
// This is the ONLY place the model's behaviour is specified, and this is the product's first generator
// that runs unattended and stores what it writes. Chat has a human reading every reply within seconds;
// this does not. So the instruction is narrow on purpose and the guards behind it (generate.ts) assume
// it will sometimes be ignored.
//
// ── ★ THE VERDICT IS NOT IN THIS PROMPT, AND THAT IS THE ENFORCEMENT ────────────────────────────────
// The verdict is computed and RENDERED beside the prose, never written by the model. The brief says the
// model "must not restate, soften, or elaborate" it — and the way to guarantee that is not to ask, but
// to withhold: a model that never sees the verdict cannot restate it. `renderFactText` therefore omits
// `block.verdict` entirely. The prose explains the figures; the badge says what they add up to; neither
// can contradict the other because both derive from the same computed facts.
//
// ── ⚠ THE FACT TEXT IS ALSO THE GROUNDING HAYSTACK ──────────────────────────────────────────────────
// `renderFactText` emits DISPLAY STRINGS ONLY — never the raw numeric behind them. Two consequences,
// both wanted:
//   · The model can only reproduce forms it was given ("₹15,548 crore"), so the tightest possible
//     rendering is also the only one it can write.
//   · generate.ts passes THIS EXACT STRING (plus the system prompt) as the number-grounding haystack,
//     so the haystack cannot drift from what the model actually saw. See number-grounding.ts's header:
//     a caller that narrows the haystack has rebuilt the blind version of the scan.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { CLOSED_WORLD_HEADER } from "../../ai/grounding.js";
import type { QuarterBriefFactBlock } from "./types.js";

/** The section headings the model may use. Anything else is a violation — see generate.ts. */
export const ALLOWED_HEADINGS = [
  "What happened",
  "Where the profit came from",
  "Margins",
  "What it did to the Vytal health score",
  "What this reading does not cover",
] as const;

export const QUARTER_BRIEF_SYSTEM = [
  "You are writing the \"Quarter in Brief\" for Vytal: a short, plain-language account of one company's",
  "quarterly results, for a reader who has never read a financial statement and does not know what a",
  "margin or a balance sheet is.",
  "",
  CLOSED_WORLD_HEADER,
  "",
  "WHAT YOU DO",
  "Turn the facts you are given into short prose under the headings below. That is the whole task.",
  "You are not analysing, not concluding, and not advising — you are saying what the figures say, in",
  "words the reader can follow.",
  "",
  "HEADINGS — use only these, in this order:",
  ...ALLOWED_HEADINGS.map((h) => `  ${h}`),
  "Use a heading ONLY if the facts contain that section. A section whose facts are absent is left out",
  "entirely. Never write a heading with nothing underneath it, and never pad a thin section to fill it.",
  "",
  "FORM",
  "- One or two sentences per section. Use bullets ('- ') only where a section carries several separate",
  "  facts that do not read as a sentence.",
  "- Reproduce every figure EXACTLY as written in the facts, including the rupee sign, the commas, the",
  "  decimal, and the word 'crore' or the '%' sign. Do not re-round it, rescale it, or reformat it.",
  "- Do not introduce any number that is not in the facts. That includes counts: do not say how many",
  "  things happened unless the facts say so.",
  "- Short sentences. Ordinary words. Explain a term the first time you use it, in the same sentence.",
  "",
  "TWO KINDS OF LINE YOU MUST NOT DROP",
  "- A line beginning FINDING names something Vytal detected in these results. Say what it is, in plain",
  "  words, using the wording under WHAT IT MEANS. That wording is Vytal's own finding, not your",
  "  opinion, so it is safe to state and it must not be left out. Give the figures under it as support,",
  "  never instead of it. A section that lists two numbers and never says what they show is the one",
  "  failure this section cannot have.",
  "- A line beginning MUST SAY carries a point the brief has to make. Say it in your own sentence,",
  "  in the flow of the section it belongs to. Never print the words 'MUST SAY' — that is a label for",
  "  you, not text for the reader. Each one is there because the figures alone would leave the reader",
  "  with the wrong impression.",
  "",
  "NEVER",
  "- Never predict or forecast. Nothing about what happens next, what is expected, or what is likely.",
  "- Never write 'what to watch', 'keep an eye on', 'going forward', or any variant of them.",
  "- Never mention segments, products, customers, management, strategy or an earnings call. None of",
  "  that is in the facts, so anything you write about it would be invented.",
  "- Never quote or paraphrase anyone.",
  "- Never judge. Do not call anything strong, weak, poor, good, bad, healthy, impressive,",
  "  disappointing, attractive, worrying, reassuring or remarkable. Say what a figure did — rose, fell,",
  "  held — and stop there. Whether that is good news depends on things you have not been told.",
  "- Never mention the share price, the valuation, or whether anyone should buy, sell or hold.",
  "- Never write a title, an introduction, a summary line, or a conclusion. Begin at the first heading",
  "  and end at the last.",
].join("\n");

const line = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The facts, as the model receives them. DISPLAY STRINGS ONLY — see the header. */
export function renderFactText(block: QuarterBriefFactBlock): string {
  const out: string[] = [];
  const push = (s: string) => out.push(s);

  const { identity: id } = block;
  push(`COMPANY: ${id.name} (${id.symbol})`);
  push(`PERIOD: ${id.quarter} of ${id.fiscalYear}, the three months ended ${id.reportDate}`);
  push(`REPORTED ON: ${id.filingDate}`);
  push("");

  // ── What happened ──
  push("[SECTION: What happened]");
  for (const l of [block.headline.revenue, block.headline.profit]) {
    push(`${l.line} this quarter: ${l.current.display}`);
    if (l.previousQuarter) push(`  previous quarter: ${l.previousQuarter.display}`);
    if (l.yearAgoQuarter) push(`  same quarter last year: ${l.yearAgoQuarter.display}`);
    if (l.qoq) push(`  ${l.line} ${l.qoq.display}`);
    if (l.yoy) push(`  ${l.line} ${l.yoy.display}`);
  }
  for (const d of block.headline.disagreements) push(`MUST SAY: ${line(d.display)}`);
  push("");

  // ── Where the profit came from ──
  if (block.profitSource) {
    push("[SECTION: Where the profit came from]");
    push(`FINDING: ${block.profitSource.name}`);
    push(`WHAT IT MEANS: ${line(block.profitSource.description)}`);
    push(`WHAT IT DOES NOT MEAN: ${line(block.profitSource.doesntMean)}`);
    for (const f of block.profitSource.supporting) push(`${f.label}: ${f.display}`);
    push("");
  }

  // ── Margins ──
  if (block.margins) {
    push("[SECTION: Margins]");
    for (const s of block.margins.series) {
      push(line(s.directionDisplay));
      if (s.plainDisplay) push(`  in plain terms: ${line(s.plainDisplay)}`);
    }
    push("");
  }

  // ── Health score ──
  if (block.healthMovement) {
    const h = block.healthMovement;
    push("[SECTION: What it did to the Vytal health score]");
    // ★ C11 — THE GLOSS IS OURS, NOT THE MODEL'S. Left to itself the model invented a fresh definition
    // of the health score on every run ("an overall summary figure", then "a single number summing up
    // multiple checks of company health"). That is the product letting a model define its own
    // vocabulary, differently each time. One supplied line ends it.
    push(
      "WHAT THE VYTAL HEALTH SCORE IS (use this wording, do not write your own): " +
        "Vytal's own 0–100 rating of a company's financial standing, built from four parts — " +
        "Foundation, Momentum, Market and Ownership.",
    );
    // ★ PINNED AND DATED (4d-i). Deliberately a THIRD, distinctly-labelled date: the quarter is "the
    // three months ended", the filing is "REPORTED ON", and this is "AS SCORED ON". One date per label,
    // no shared verb, so a reader is never left working out which clock a number is on.
    push(`AS SCORED ON: ${h.scoredAsOf}`);
    push(
      "This score is recalculated as market data changes, so state it as the figure on that date — " +
        "not as today's figure.",
    );
    push(`Vytal health score as scored on ${h.scoredAsOf}: ${h.composite.display} out of 100, band "${h.band.label}"`);
    if (h.compositeChange) push(line(h.compositeChange.display));
    if (h.bandChange) push(line(h.bandChange.display));
    for (const p of h.pillars) push(line(p.display));
    for (const f of h.findingsFired) push(`NEWLY FLAGGED: ${line(f.display)}`);
    for (const f of h.findingsCleared) push(`NO LONGER FLAGGED: ${line(f.display)}`);
    push("");
  }

  if (block.headlineHealthDivergence) {
    push(`MUST SAY: ${line(block.headlineHealthDivergence.display)}`);
    push("");
  }

  // ── Gaps ──
  push("[SECTION: What this reading does not cover]");
  for (const g of block.gaps) push(`- ${line(g)}`);

  return out.join("\n");
}
