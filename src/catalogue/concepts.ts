// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// VOCABULARY 5 of 5 — THE CONCEPT REGISTRY. §7.1's fifth vocabulary, built at Phase 2 · Batch 2.
//
// ── ★ WHAT IT KEYS OFF, AND WHY THAT IS GENUINELY NOT ONE OF THE OTHER FOUR ───────────────────────
// The four existing vocabularies all describe something the ENGINE found or something a COMPANY filed:
//
//   findings catalogue   132   configurations the engine detected      ("Pledging Crisis")
//   metric glosses       109   filed line items                       ("Return on Assets")
//   facts sidecars       22/49 declared facts ON a catalogue key       (not a registry — §7.1)
//   EVIDENCE_FACTS       314   evidence-bag FIELD NAMES                ("gapPts", "priceMovePct")
//
// This one describes **product mechanism**: what a pillar IS, why there are four, what a band means,
// why the weights move, what "we do not score this" means. Nothing in the other four answers "what
// does Foundation mean" — `LP2` is a lens FACE about foundation, `F1` is a metric INSIDE it, and
// neither defines the pillar. GATE 0 tested "one object under three names" and refuted it; this is the
// fifth name for objects the other four never had.
//
// ── ★ ZERO KEY OVERLAP, BY CONSTRUCTION AND BY GATE ───────────────────────────────────────────────
// Every key here is prefixed `concept_`. No key in any of the four registries uses that prefix — stock
// findings are `ownership_*` / `divergence_* `/ `trajectory_*` / `composition_*` / `lens_*` /
// `notcovered_*`, lens faces are `LM1`–`LP6`, PHS findings are `P*`, guardrail signatures are their own
// short codes, glosses are metric keys, evidence facts are camelCase bag fields. The prefix is the
// construction; `verify-concepts.ts` is the proof, and it fails loudly rather than warning.
//
// ⚠ IT IS **NOT** IN `REGISTRY_IDS`, AND THAT IS DELIBERATE RATHER THAN AN OVERSIGHT. `REGISTRY_IDS`
//   indexes the four registries `catalogueEntry()` spans, and `verify-catalogue.ts` §4 reconciles each
//   of them against an EMITTER — the rule/persist path that can produce the key. **Nothing fires a
//   concept.** Adding this to that list would make a gate demand an emitter that cannot exist, and the
//   only ways out would be a wildcard exemption or a fake status. `EVIDENCE_FACTS` sits in exactly the
//   same position and §7.1 records the same reasoning: *"REGISTRY 5 of 5 is accurate as vocabulary
//   while `REGISTRY_IDS` correctly stays at four."*
//
// ── ★ WHAT IS STORED HERE AND WHAT IS NOT ─────────────────────────────────────────────────────────
// Stored: what is true of the concept ALWAYS. A pillar's nominal weight, what it is made of in kind,
// what it does not mean.
// NOT stored: anything true only of one company. Foundation is seven metrics for a bank and eleven for
// a non-financial, and which seven depends on what that bank filed — so the WORKED EXAMPLE is resolved
// at read time against the reader's own stock (`resolve/concept.ts`) and never transcribed here. A
// registry holding per-company facts is a cache with no invalidation.
//
// ⚠ AND NO THRESHOLDS. D-2 is declined: `PILLAR_WEIGHTS` is a published mechanism (it is on the
//   methodology page and it is the same for every company), while a metric's scoring BAR is per
//   industry and per size and stays withheld. The distinction is "is this a fact about the product or a
//   fact about how one company was judged".
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { PILLAR_WEIGHTS } from "../scoring/composite/weights.js";
import { LABEL_BAND_MAP } from "../scoring/composite/label.js";

/** The prefix that makes overlap impossible. Exported so the gate reads it rather than repeating it. */
export const CONCEPT_PREFIX = "concept_";

/** One constituent of a concept. `share` is a published proportion; `null` when there is not one. */
export interface ConceptPart {
  readonly label: string;
  /** Pre-formatted (N-1). `null` where the parts are not weighted against each other. */
  readonly share: string | null;
  readonly note: string | null;
}

/**
 * How the answer should illustrate this concept with the reader's own subject.
 *
 * ★ A DEFINITION WITHOUT A WORKED EXAMPLE IS A GLOSSARY ENTRY, AND A GLOSSARY IS NOT AN ANSWER. This
 *   names WHICH live figure makes the example; `resolve/concept.ts` fetches it. `none` is honest for a
 *   concept no single company illustrates.
 */
export type ConceptExample = "composite" | "pillar" | "band" | "coverage" | "redistribution" | "none";

export interface ConceptEntry {
  readonly registry: "concept";
  readonly key: string;
  /** Canonical display title. */
  readonly name: string;
  /**
   * The words a reader actually types. Lower-cased, matched EXACTLY as a whole phrase or as a word
   * set — never as a substring, which would make "market" match "market cap tier".
   */
  readonly aliases: readonly string[];
  /** What it is. One or two sentences a reader could repeat back. */
  readonly description: string;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ ONE CLAUSE, FOR USE INSIDE PARENTHESES MID-SENTENCE — added Phase 3 for DP's plain register.
   *
   * ⚠ IT IS AUTHORED, NOT DERIVED, AND THE FIRST DRAFT DERIVED IT. Building the gloss from the name
   *   and `partOf` produced "the score (the health score, as we define it)" — circular, and worse
   *   than no gloss at all. A definition that restates the word is the thing a reader complains
   *   about when they ask for plainer English.
   *
   * ⚠ AND IT IS NOT THE `description`. That is one or two sentences and ends the thought; this has to
   *   sit inside someone else's sentence without breaking it. Different job, different length, so a
   *   different field rather than a truncation of the other one.
   *
   * No leading capital and no full stop — it is a fragment by contract, and `verify-concepts.ts`
   * checks that so a future entry cannot quietly ship a sentence here.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  readonly gloss: string;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★ THE TERMS THAT MEAN THIS CONCEPT WHEN THEY APPEAR IN **OUR OWN PROSE** — Phase 3, for DP.
   *
   * ⚠ `aliases` IS THE WRONG LIST FOR THIS AND USING IT PRODUCED A CATEGORY ERROR. Aliases are what a
   *   READER TYPES to ask about a concept — so `concept_bands` claims "fragile", "steady", "healthy",
   *   "pristine". Those same words appear in our sentences as ordinary VALUES, and the first draft
   *   duly rendered *"which reads as steady (the five words we attach to a score, cut at fixed
   *   points)"* — a band value annotated with a definition of the band system.
   *
   * ★ SO THIS IS A SEPARATE, DELIBERATELY CONSERVATIVE LIST. A term earns a place only if it means
   *   this concept EVERY time it appears in our writing. "Foundation" does; "market" does not, because
   *   we also write about the market. An empty list is the right answer for a concept whose words are
   *   values (`concept_bands`) or whose name never appears mid-sentence (`concept_confidence`).
   *
   * ⚠ WHEN IN DOUBT, LEAVE IT OUT. A missing gloss costs a reader one lookup; a wrong one teaches them
   *   something false and reads as the system not understanding its own words.
   * ═══════════════════════════════════════════════════════════════════════════════════════════════
   */
  readonly inProse: readonly string[];
  /**
   * ★ THE UNIVERSAL REQUIREMENT (EntryBase's rule, honoured without extending it — see the header).
   *
   * ⚠ A SENTENCE, NEVER THE "≠" FORM. The first draft of this file opened every one with "≠", copying
   *   the PHS library — and `quarter-metrics.ts` already states why that is wrong: a screen reader
   *   announces the glyph as "not equal to", and this copy renders inside a card with no italics or
   *   left border to carry it. That header calls the PHS form "shipped behaviour there and not ours to
   *   change, but not a form to copy". Copied it anyway; corrected here.
   */
  readonly doesntMean: string;
  /** What it is made of. Empty for an atomic concept. */
  readonly parts: readonly ConceptPart[];
  /** The bigger whole it sits inside, in words. `null` at the top. */
  readonly partOf: string | null;
  readonly example: ConceptExample;
  /** Which pillar the example is about, when `example` is `pillar`. */
  readonly pillar?: "foundation" | "momentum" | "market" | "ownership";
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The four pillars as parts of the composite — read from the locked set, never transcribed (N-5). */
const PILLAR_PARTS: readonly ConceptPart[] = [
  { label: "Foundation", share: pct(PILLAR_WEIGHTS.foundation), note: "what the balance sheet and the returns look like" },
  { label: "Momentum", share: pct(PILLAR_WEIGHTS.momentum), note: "which direction the recent quarters are moving" },
  { label: "Market", share: pct(PILLAR_WEIGHTS.market), note: "how the price has behaved, against its own history and its peers" },
  { label: "Ownership", share: pct(PILLAR_WEIGHTS.ownership), note: "who holds it, and what they have been doing" },
];

/** The five published bands as parts of the scale — read from the mapping (N-5). */
const BAND_PARTS: readonly ConceptPart[] = LABEL_BAND_MAP.map((b) => ({
  label: b.label,
  share: b.max === null
    ? `${b.min} and above`
    : Number.isFinite(b.min) ? `${b.min} to under ${b.max}` : `under ${b.max}`,
  note: null,
}));

const C = (e: Omit<ConceptEntry, "registry">): ConceptEntry => ({ registry: "concept", ...e });

/**
 * ★ THE REGISTRY. Frozen, and every entry carries every field — a missing `doesntMean` is a compile
 *   error, not a blank card, which is the discipline §7.2 describes and the four others already hold.
 */
export const CONCEPTS: Readonly<Record<string, ConceptEntry>> = Object.freeze({
  concept_health_score: C({
    key: "concept_health_score",
    inProse: ["the health score", "the composite"],
    gloss: "our 0-100 reading of what a company's filings say",
    name: "The health score",
    aliases: ["health score", "the score", "vytal score", "composite", "score", "health", "overall score", "how do you score"],
    description:
      "A single reading from 0 to 100 of what a company's own filings say about it. It is a weighted "
      + "blend of four parts, each scored separately, and it describes what has already been reported "
      + "rather than what is expected next.",
    doesntMean:
      "It is not a price target, a rating, or a view on whether the shares are cheap. A company can "
      + "score well and be expensive, or score badly and already be priced for it — the score reads the "
      + "business, not the share price.",
    parts: PILLAR_PARTS,
    partOf: null,
    example: "composite",
  }),

  concept_pillar_foundation: C({
    key: "concept_pillar_foundation",
    inProse: ["foundation"],
    gloss: "the balance sheet and returns half of the score",
    name: "Foundation",
    aliases: ["foundation", "foundation pillar", "the foundation"],
    description:
      "The bedrock: what the balance sheet and the returns look like when you stop and take a "
      + "photograph. Returns on capital, debt, cash conversion, and how consistently the business turns "
      + "profit into cash. It is the heaviest of the four parts and the one a company cannot fix quickly.",
    doesntMean:
      "A strong Foundation does not make a company a good investment. It says the business is solidly "
      + "built on what it has filed; it says nothing about what you would pay for it.",
    parts: [
      { label: "Returns on capital and equity", share: null, note: "what the business earns on what it uses" },
      { label: "Balance-sheet strength", share: null, note: "debt against equity, and whether profit covers the interest" },
      { label: "Cash conversion", share: null, note: "whether reported profit actually arrives as cash" },
      { label: "Consistency", share: null, note: "how steadily those hold across years rather than in one good one" },
    ],
    partOf: "the health score",
    example: "pillar",
    pillar: "foundation",
  }),

  concept_pillar_momentum: C({
    key: "concept_pillar_momentum",
    inProse: ["momentum"],
    gloss: "the direction the recent quarters are moving",
    name: "Momentum",
    aliases: ["momentum", "momentum pillar"],
    description:
      "Direction rather than level: what the most recent quarters have been doing to margins, revenue "
      + "and profit, measured against the company's own trailing year. A strong Foundation with weak "
      + "Momentum is a good business having a bad run, and the two are kept apart on purpose.",
    doesntMean:
      "This is not price momentum and it is not a signal to act on. It is the FILINGS moving, not the "
      + "share price, and a larger move is not a stronger signal — measured, the biggest moves carried "
      + "the least drift afterwards.",
    parts: [
      { label: "Margin direction", share: null, note: "trailing-twelve-month margins against the year before" },
      { label: "Revenue and profit growth", share: null, note: "year on year, on a trailing basis rather than one quarter" },
      { label: "Interest cover, trailing", share: null, note: "whether earnings are keeping ahead of the debt" },
    ],
    partOf: "the health score",
    example: "pillar",
    pillar: "momentum",
  }),

  concept_pillar_market: C({
    key: "concept_pillar_market",
    inProse: [],
    gloss: "how the share price has behaved, not whether it is fair",
    name: "Market",
    aliases: ["market", "market pillar"],
    description:
      "How the share price has behaved — against its own history, against its peers, and how roughly it "
      + "got there. It is the only one of the four that reads the market rather than the filings, and it "
      + "is deliberately the lightest alongside Ownership.",
    doesntMean:
      "This is not a view on valuation. It measures how the price has MOVED, not whether the price is "
      + "right. We hold no valuation multiple a screen can filter on, and this pillar is not a "
      + "substitute for one.",
    parts: [
      { label: "Trend and drawdown", share: null, note: "where the price sits against its own range" },
      { label: "Relative strength", share: null, note: "the same move set against the peer group" },
      { label: "Volatility", share: null, note: "how rough the path was" },
    ],
    partOf: "the health score",
    example: "pillar",
    pillar: "market",
  }),

  concept_pillar_ownership: C({
    key: "concept_pillar_ownership",
    inProse: [],
    gloss: "who holds the company and what they have been doing",
    name: "Ownership",
    aliases: ["ownership", "ownership pillar", "shareholding pillar"],
    description:
      "Who holds the company and what they have been doing. Unlike the other three it starts from a "
      + "settled position rather than from zero, and moves from there: pledging and a few specific "
      + "warning conditions take points off, and sustained institutional buying or selling adjusts it.",
    doesntMean:
      "Institutions buying is not a recommendation, and promoters selling is not a warning on its own. "
      + "This records what was filed with the exchanges; it does not know why anyone did it.",
    parts: [
      { label: "A settled starting position", share: null, note: "where a company with a normal register begins" },
      { label: "Pledging", share: null, note: "promoter shares posted as loan collateral — subtracts" },
      { label: "Flow", share: null, note: "sustained institutional buying or selling across quarters — adjusts either way" },
    ],
    partOf: "the health score",
    example: "pillar",
    pillar: "ownership",
  }),

  concept_bands: C({
    key: "concept_bands",
    inProse: [],
    gloss: "the five words we attach to a score, cut at fixed points",
    name: "The five labels",
    aliases: ["band", "bands", "label", "labels", "fragile", "below par", "steady", "healthy", "pristine", "what do the labels mean", "rating"],
    description:
      "Every score carries one of five words, and the words are cut at fixed points on the 0–100 scale. "
      + "The cut points are the same for every company and every industry, so two companies with the same "
      + "label were measured against the same line.",
    doesntMean:
      "These are not a buy, hold or sell scale. The top band is called Pristine — fully priced for a "
      + "reason: a company can be the healthiest thing we read and still be the worst thing to buy "
      + "today.",
    parts: BAND_PARTS,
    partOf: "the health score",
    example: "band",
  }),

  concept_weights: C({
    key: "concept_weights",
    inProse: ["weighted"],
    gloss: "how much each of the four parts counts",
    name: "How the four parts are weighted",
    aliases: ["weight", "weights", "weighting", "how is it weighted", "why is foundation heaviest"],
    description:
      "The four parts do not count equally. Foundation is the anchor at the heaviest weight, Momentum "
      + "next, and Market and Ownership lightest. The set is the same for every company in every "
      + "industry — it is never fitted to a sector and never tuned per company.",
    doesntMean:
      "The lighter parts are not unimportant. They are lighter because they move faster and say less "
      + "about the business itself, not because they are noise.",
    parts: PILLAR_PARTS,
    partOf: "the health score",
    example: "composite",
  }),

  concept_redistribution: C({
    key: "concept_redistribution",
    inProse: ["redistributed", "redistribution"],
    gloss: "what happens when one part cannot be scored at all",
    name: "When a part cannot be scored",
    aliases: ["redistribution", "redistributed", "missing pillar", "why did the weights change", "unavailable pillar", "weight redistribution"],
    description:
      "Sometimes one of the four parts cannot be scored at all — a company too newly listed for a price "
      + "history, or a quarter with too few filed figures to read. When that happens the part is removed "
      + "rather than scored as zero, and its share of the weight is spread across the ones that remain, "
      + "keeping their proportions to each other. The total is still out of 100.",
    doesntMean:
      "It does not mean the company did badly on that part. It was not measured. A zero would say the "
      + "opposite, which is why nothing is ever scored zero for being absent.",
    parts: [
      { label: "The part is removed", share: null, note: "not scored zero — there is a difference" },
      { label: "The others are re-weighted", share: null, note: "their proportions to each other are preserved" },
      { label: "Foundation is required", share: null, note: "if the anchor cannot be scored, there is no score at all" },
      { label: "At least two parts must survive", share: null, note: "one part renormalised to 100% is that part relabelled" },
    ],
    partOf: "the health score",
    example: "redistribution",
  }),

  concept_peer_relativity: C({
    key: "concept_peer_relativity",
    inProse: ["peer group"],
    gloss: "the size-and-sector group a company is read against",
    name: "What a company is compared against",
    aliases: ["peer group", "peers", "peer relativity", "compared to whom", "relative to peers", "what are peers"],
    description:
      "Several measures are read twice — once against a fixed bar, and once against the companies most "
      + "like it. The peer group is a size band crossed with a sector, frozen at a point in time so that "
      + "a later reshuffle never rewrites an old reading.",
    doesntMean:
      "A peer group is not every competitor a company has. It is the set we hold comparable filed "
      + "figures for, which is smaller — and where we hold too few, the comparison is dropped rather "
      + "than made against two companies.",
    parts: [
      { label: "A size band", share: null, note: "frozen at one date, not recomputed per question" },
      { label: "A sector", share: null, note: "the company's own classification" },
      { label: "A minimum number of members", share: null, note: "below it the comparison is declined rather than drawn" },
    ],
    partOf: "how metrics are scored",
    example: "none",
  }),

  concept_coverage: C({
    key: "concept_coverage",
    inProse: [],
    gloss: "how much we hold on a company, from nothing to a full score",
    name: "What it means when we do not score something",
    // ⚠ WRITTEN IN NORMALISED FORM. `lookupConcept` strips punctuation to spaces, so "don't" arrives
    //   as "don t" — an alias containing an apostrophe can never match. Measured: "what does it mean
    //   when you don't score a company" resolved to THE HEALTH SCORE, because "score" was the only
    //   alias that matched anything.
    aliases: [
      "coverage", "not covered", "unscored", "tier", "do you cover", "don t score", "do not score",
      "you don t score", "why don t you score", "not scored", "why is there no score",
    ],
    description:
      "There are three states, and they are different answers. We may hold nothing about a company; we "
      + "may hold its filed quarters without scoring it; or we may score it. Most of what we hold sits in "
      + "the middle state — real filings, no score — and an answer about one of those says so rather than "
      + "going quiet.",
    doesntMean:
      "A company we do not score is not a company to avoid. It is a gap on our side. Whole industries "
      + "sit there because the scoring machinery for their kind of accounts is not built yet.",
    parts: [
      { label: "We hold nothing", share: null, note: "the ticker exists and no quarter has been filed to us" },
      { label: "We hold filings, no score", share: null, note: "every figure is real; the reading over them is missing" },
      { label: "We score it", share: null, note: "the full four-part read" },
    ],
    partOf: null,
    example: "coverage",
  }),

  concept_finding: C({
    key: "concept_finding",
    inProse: [],
    gloss: "a rule that ran against the filings and matched",
    name: "What a flag is",
    aliases: ["finding", "findings", "flag", "flags", "pattern", "patterns", "what is a flag", "what gets flagged"],
    description:
      "A rule that ran against a company's filings and matched. Each one has a name, describes a "
      + "configuration rather than a prediction, and carries its own statement of what it does not mean. "
      + "A quarter where nothing matched is a result — the rules ran and found nothing — not a gap.",
    doesntMean:
      "A flag is not automatically bad news, and no flags is not a clean bill of health. Some flags are "
      + "constructive, and a quarter with none may simply be one we could not evaluate.",
    parts: [
      { label: "The rule matched", share: null, note: "a configuration the engine detected in filed figures" },
      { label: "The rule ran and did not match", share: null, note: "an honest empty — stated, not left blank" },
      { label: "The rule could not run", share: null, note: "a third state, and the one most easily mistaken for the second" },
    ],
    partOf: null,
    example: "none",
  }),

  concept_divergence: C({
    key: "concept_divergence",
    inProse: ["divergence"],
    gloss: "a gap between two of the four parts",
    name: "Divergence",
    aliases: ["divergence", "diverging", "what is divergence", "price ahead"],
    description:
      "A gap between two of the four parts — most often the price having moved a long way from what the "
      + "filings support, in either direction. It is a description of tension between two readings, and "
      + "the interesting cases are the ones where the two have been apart for a while.",
    doesntMean:
      "It does not say the gap will close, and it does not say which side is right. A price ahead of the "
      + "fundamentals may be the market seeing something the filings have not reported yet.",
    parts: [
      { label: "Two readings that disagree", share: null, note: "which two is part of the finding's own name" },
      { label: "How wide the gap is", share: null, note: "measured in score points, not in percent" },
      { label: "How long it has held", share: null, note: "a persistent gap is a different observation from a new one" },
    ],
    partOf: "what a flag is",
    example: "none",
  }),

  concept_trajectory: C({
    key: "concept_trajectory",
    inProse: ["phase", "phases"],
    gloss: "the score's own history, and the runs where it held one level",
    name: "Trajectory and phases",
    aliases: ["trajectory", "phase", "phases", "level change", "what is a phase", "score history"],
    description:
      "The score's own history, quarter by quarter, and the runs where it held one level. A phase is a "
      + "run of at least three quarters whose average sits at least a full band's width from the run "
      + "beside it — so a change of phase is a company that would have changed label, not one that "
      + "wobbled.",
    doesntMean:
      "A phase change does not predict the next one, and a company with one phase has not necessarily "
      + "been uneventful. A score can move a long way inside a single quarter and come back, which is a "
      + "real event and not a change of level.",
    parts: [
      { label: "At least three quarters", share: null, note: "two points define a trend; three can be contradicted" },
      { label: "A full band's width apart", share: null, note: "smaller than that and no label would have changed" },
      { label: "Our own history, not the company's", share: null, note: "we began scoring in January 2023" },
    ],
    partOf: "the health score",
    example: "none",
  }),

  concept_confidence: C({
    key: "concept_confidence",
    inProse: [],
    gloss: "what an answer was actually built on",
    name: "How sure we are",
    aliases: ["confidence", "how sure", "how confident", "certainty", "reliability", "provisional"],
    description:
      "Every answer states what it is built on before it states what it found. A reading over two "
      + "filed quarters and a reading over thirty are both real and they are not the same claim, so the "
      + "depth behind an answer travels with it rather than being available on request.",
    doesntMean:
      "This is not a percentage or a probability. We do not publish one, because a confidence number "
      + "invites arithmetic nobody can check. What travels is what was actually read.",
    parts: [
      { label: "How many periods", share: null, note: "stated, and resolved rather than as-requested" },
      { label: "Which basis", share: null, note: "standalone or consolidated — most companies file both" },
      { label: "What was left out", share: null, note: "a set that lost members says so" },
    ],
    partOf: null,
    example: "coverage",
  }),
});

export type ConceptKey = keyof typeof CONCEPTS;
export const CONCEPT_KEYS: readonly string[] = Object.freeze(Object.keys(CONCEPTS));

/**
 * ★ THE ALIAS INDEX — built once, at module load, from the entries themselves.
 *
 * ⚠ A SECOND HAND-KEPT MAP FROM WORDS TO KEYS WOULD BE THE SECOND HOME THIS FILE EXISTS TO AVOID. It
 *   is derived, so an alias can only ever be added beside the entry it belongs to.
 */
const ALIAS_INDEX: ReadonlyMap<string, string> = new Map(
  Object.values(CONCEPTS).flatMap((c) => [
    [c.name.toLowerCase(), c.key] as const,
    ...c.aliases.map((a) => [a.toLowerCase(), c.key] as const),
  ]),
);

/** Every alias, longest first — so "market cap tier" cannot be claimed by "market". */
const ALIASES_BY_LENGTH: readonly string[] = Object.freeze(
  [...ALIAS_INDEX.keys()].sort((a, b) => b.length - a.length),
);

export const conceptByKey = (key: string): ConceptEntry | null => CONCEPTS[key] ?? null;

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ THE ZERO-TOKEN LOOKUP. Pure, synchronous, no model, no database.
 *
 * §7.1's claim is that "exact match costs zero model tokens", and the brief is right that this is not a
 * footnote: the daily budget was exhausted mid-development in the previous batch and a whole gate could
 * not run. A family that answers a common question without a model call reduces the load rather than
 * adding to it.
 *
 * ⚠ WHOLE-PHRASE OR WHOLE-WORD, NEVER SUBSTRING. `raw.includes("market")` matches "market cap tier",
 *   "how is the market doing" and "supermarket" — and would hand a reader a definition of the Market
 *   pillar for a question about the index. Matching is:
 *     1. the WHOLE question, normalised, equals an alias        ("foundation")
 *     2. an alias appears as a contiguous run of WHOLE WORDS    ("what does foundation mean")
 *   Longest alias first, so a specific phrase beats a general word inside it.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export function lookupConcept(raw: string): ConceptEntry | null {
  const norm = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/ +/g, " ").trim();
  if (norm.length === 0) return null;

  const exact = ALIAS_INDEX.get(norm);
  if (exact) return CONCEPTS[exact]!;

  const padded = ` ${norm} `;
  for (const alias of ALIASES_BY_LENGTH) {
    if (padded.includes(` ${alias} `)) return CONCEPTS[ALIAS_INDEX.get(alias)!]!;
  }
  return null;
}
