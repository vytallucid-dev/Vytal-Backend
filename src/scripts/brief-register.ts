// THE REGISTER CHECK — is the card's prose written for a reader who has never read a statement?
// Read-only: no AI call, no write. Measures, rather than asserting.
//
//   npx tsx src/scripts/brief-register.ts
//
// ── ★ WHAT IT COUNTS, AND WHY THESE THREE ──────────────────────────────────────────────────────
// The three rules this feature's prose is held to are: ACTIVE VOICE, SUBJECT FIRST, ONE IDEA PER
// SENTENCE. Each has a countable signature:
//
//   FRONT-LOADED   a sentence opening on a subordinate clause or a participle makes the reader hold
//                  a qualifier in their head before they know what it qualifies. "With other income
//                  down ₹8,569 crore, net profit fell 25%" is the shape; "Net profit fell 25%…" is
//                  the same fact without the wait.
//   PASSIVE        "more was set aside for bad loans" hides who did it, and on these cards the
//                  actor is always the company — which is the one thing a reader is trying to learn.
//   LONG           a sentence past ~30 words is carrying more than one idea whatever its grammar.
//
// ⚠ THESE ARE PROXIES, NOT A GRAMMAR CHECKER. A regex cannot parse English, and two of these will
// occasionally fire on a clean sentence ("As scored on 2026-08-07…" is a real front-load; "was
// little changed" is not a real passive). What they CAN do is answer "did this get better or worse
// between two runs", which is the question the prompt change has to answer and the only one a
// count is entitled to answer.
//
// ── ★★ AND A FOURTH COUNT, ADDED AFTER THE THREE ABOVE WERE ALREADY CLEAN ───────────────────────
// The three above measure whether a sentence is SHORT AND DIRECT. They said the backend's own prose
// was fine — 0% passive, 1.4% front-loaded, 5.4% over thirty words — while the card still opened
// with this:
//
//     "At the year-end the company owed ₹35,758 crore more than everything it owns is worth in its
//      books, so there is no shareholders' money left in the business."
//
// Twenty-six words, active, subject in the first four. It passes all three counts and a reader who
// cannot read a statement gets nothing from it, because BREVITY WAS THE THING OPTIMISED FOR AND
// COMPREHENSION WAS WHAT IT COST. The fix is not a shorter sentence, it is more of them.
//
//   CLAUSE LOAD    commas, dashes, colons, semicolons and subordinators in ONE sentence. Three or
//                  more means the reader is holding two facts while a third arrives. The glosses are
//                  the benchmark and they are LONG — "Out of every 100 rupees the bank has lent out,
//                  how much is owed by a borrower who has stopped keeping up repayments" is 22 words
//                  and carries a clause load of 2. Length is not the constraint; stacking is.
//
// ── AND IT MEASURES THE BACKEND'S OWN STRINGS, NOT ONLY THE STORED CARDS ────────────────────────
// The stored bullets are the MODEL's prose. `--facts` rebuilds each fact block and measures the
// strings THIS REPO WROTE — the contrast rules, the driver, the gaps, the margins, the movement
// lines. That is the population item 2 is about, and it was never being counted.
//
//   npx tsx src/scripts/brief-register.ts            # the stored cards (the model's prose)
//   npx tsx src/scripts/brief-register.ts --facts    # the backend's own hand-written strings

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import type { BriefPayload } from "../insight/quarter-brief/schema.js";

/** Openers that make a reader wait for the subject. Not exhaustive — the common ones, measured. */
const FRONT_LOADED =
  /^(with|following|after|before|while|whilst|although|though|despite|given|as|owing to|due to|because|when|since|amid|amidst|on the back of|driven by|reflecting|in (?:the )?(?:light|view) of|having|led by|helped by|hit by|boosted by|supported by|weighed|at \d|in \d|over the|during|for the (?:quarter|three|twelve)|on this quarter)\b/i;

/** A rough passive marker: "was/were/been/being" + a past participle. Deliberately crude. */
const PASSIVE = /\b(?:was|were|been|being)\s+(?:\w+ly\s+)?(\w+(?:ed|wn|en|ught|ld))\b/i;
/** ⚠ …minus the stative uses that are not passives and are correct on these cards. */
const NOT_PASSIVE = /\b(?:was|were)\s+(?:little changed|unchanged|higher|lower|up|down|steady|below|above)\b/i;

const LONG_WORDS = 30;

/** Subordinators that OPEN a further clause mid-sentence. Deliberately not `and` or `but`: two short
 *  main clauses joined by a coordinator are two sentences the reader can take in order, which is the
 *  shape this check exists to encourage. */
const SUBORDINATOR = /\b(?:while|whilst|although|though|because|since|so that|which|whose|whereas|after|before|unless|if|as)\b/gi;
/** A sentence carrying this many clause breaks is stacking rather than explaining. */
const CLAUSE_LOAD_MAX = 3;

function clauseLoad(sent: string): number {
  const punctuation = (sent.match(/[,;:—]|\s—\s/g) ?? []).length;
  const subordinators = (sent.match(SUBORDINATOR) ?? []).length;
  return punctuation + subordinators;
}

interface Stat { n: number; front: number; passive: number; long: number; stacked: number; words: number }
const blank = (): Stat => ({ n: 0, front: 0, passive: 0, long: 0, stacked: 0, words: 0 });

/** Split on sentence ends, keeping decimals and "₹1.05 lakh" intact — a full stop only ends a
 *  sentence when a space and a capital (or a digit) follow it. */
const sentences = (s: string): string[] =>
  s.split(/(?<=[.!?])\s+(?=[A-Z₹0-9])/).map((x) => x.trim()).filter(Boolean);

function measure(into: Stat, text: string, stacked?: string[]): void {
  for (const sent of sentences(text)) {
    into.n++;
    const words = sent.split(/\s+/).length;
    into.words += words;
    if (FRONT_LOADED.test(sent)) into.front++;
    if (PASSIVE.test(sent) && !NOT_PASSIVE.test(sent)) into.passive++;
    if (words > LONG_WORDS) into.long++;
    const load = clauseLoad(sent);
    if (load >= CLAUSE_LOAD_MAX) {
      into.stacked++;
      stacked?.push(`[${load}] ${sent}`);
    }
  }
}

const pct = (a: number, b: number) => (b === 0 ? "  —  " : `${((a / b) * 100).toFixed(1)}%`.padStart(6));

function report(name: string, s: Stat, examples: string[]): void {
  console.log(
    `  ${name.padEnd(14)} ${String(s.n).padStart(4)} sentences · ` +
      `front-loaded ${String(s.front).padStart(3)} ${pct(s.front, s.n)} · ` +
      `passive ${String(s.passive).padStart(3)} ${pct(s.passive, s.n)} · ` +
      `over ${LONG_WORDS} words ${String(s.long).padStart(3)} ${pct(s.long, s.n)} · ` +
      `stacked ${String(s.stacked).padStart(3)} ${pct(s.stacked, s.n)} · ` +
      `mean ${(s.words / Math.max(1, s.n)).toFixed(1)} words`,
  );
  for (const e of examples.slice(0, 8)) console.log(`      ⚠ ${e}`);
}

/** ── THE BACKEND'S OWN STRINGS, BY SOURCE. Every one of these is hand-written in this repo and is
 *  handed to the model to reproduce, so a stacked sentence here becomes a stacked sentence on the
 *  card whatever the prompt says. Grouped by the file that wrote it, because that is where a fix
 *  goes. ⚠ The metric MOVEMENT lines are included: they are the most-rendered strings in the whole
 *  feature, twelve to twenty-four per card. */
async function measureFacts(): Promise<void> {
  const stocks = await prisma.stock.findMany({ select: { symbol: true }, orderBy: { symbol: "asc" } });
  const bySource = new Map<string, Stat>();
  const stacked = new Map<string, string[]>();
  const take = (source: string, text: string | null | undefined) => {
    if (!text) return;
    const s = bySource.get(source) ?? bySource.set(source, blank()).get(source)!;
    const ex = stacked.get(source) ?? stacked.set(source, []).get(source)!;
    measure(s, text, ex);
  };

  let cards = 0;
  for (const st of stocks) {
    let block;
    try { block = await buildQuarterBriefFactBlock(st.symbol); } catch { continue; }
    if (!block) continue;
    cards++;
    for (const c of block.contrasts) take("contrasts", c.display);
    for (const c of block.annualContrasts) take("annual-contrasts", c.display);
    take("driver", block.driver?.display);
    for (const g of block.gaps) take("gaps", g);
    for (const d of block.headline.disagreements) take("disagreement", d.display);
    take("divergence", block.headlineHealthDivergence?.display);
    for (const s of block.margins?.series ?? []) {
      take("margins", s.directionDisplay);
      take("margins", s.plainDisplay);
    }
    for (const l of block.quarter.lines) take("movement", l.movement);
    for (const l of block.annual?.lines ?? []) take("annual-lines", l.movement);
    for (const p of block.healthMovement?.pillars ?? []) take("health", p.display);
    take("health", block.healthMovement?.compositeChange?.display);
    take("health", block.healthMovement?.bandChange?.display);
    for (const c of block.peers?.comparisons ?? []) take("peers", c.display);
    take("verdict", block.verdict?.meaning);
  }

  console.log("═".repeat(126));
  console.log(`REGISTER — THE BACKEND'S OWN HAND-WRITTEN STRINGS, over ${cards} rebuilt fact blocks`);
  console.log("═".repeat(126));
  const total = blank();
  for (const [source, s] of [...bySource.entries()].sort((a, b) => b[1].stacked - a[1].stacked)) {
    report(source, s, [...new Set(stacked.get(source) ?? [])]);
    total.n += s.n; total.front += s.front; total.passive += s.passive;
    total.long += s.long; total.stacked += s.stacked; total.words += s.words;
  }
  report("ALL", total, []);
}

async function measureStored(): Promise<void> {
  const rows = await prisma.quarterBrief.findMany({
    select: { content: true, stock: { select: { symbol: true } }, fiscalYear: true, quarter: true },
  });

  const bullets = blank();
  const gaps = blank();
  const offenders: string[] = [];
  let cards = 0;

  for (const r of rows) {
    let p: BriefPayload;
    try { p = JSON.parse(r.content) as BriefPayload; } catch { continue; }
    if (!p.takeaway?.bullets) continue;
    cards++;
    for (const b of p.takeaway.bullets) {
      const before = bullets.front;
      measure(bullets, b);
      if (bullets.front > before) offenders.push(`${r.stock.symbol} ${r.fiscalYear}${r.quarter}: ${b.slice(0, 120)}`);
    }
    for (const g of p.gaps ?? []) measure(gaps, g);
  }

  console.log("═".repeat(126));
  console.log(`REGISTER over ${cards} stored cards`);
  console.log("═".repeat(126));
  report("bullets", bullets, offenders);
  report("gaps", gaps, []);
}

async function main(): Promise<void> {
  if (process.argv.includes("--facts")) await measureFacts();
  else await measureStored();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
