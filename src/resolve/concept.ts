// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVER — A DEFINED TERM, ACROSS ALL FIVE VOCABULARIES.
//
// ── ★ WHY ONE RESOLVER AND NOT ONE PER VOCABULARY ─────────────────────────────────────────────────
// §7.1 keeps five vocabularies separate with zero key overlap, and it is right to: they describe
// different KINDS of thing and merging them would be the second home N-5 forbids. But a reader does
// not know which one their word lives in, and should never have to. "What does divergence mean" could
// be the product concept or the `divergence_S2_sticky_divergence` finding; "what does ROCE mean" is a
// metric gloss; "what is Foundation" is a concept. One question, five possible homes, one answer.
//
// So the REGISTRIES stay separate and the LOOKUP spans them. That is the opposite of duplication: it
// is the single place that knows the search order, instead of five compositions each guessing.
//
// ── ★ THE ORDER IS SPECIFIC-BEFORE-GENERAL, AND IT IS LOAD-BEARING ────────────────────────────────
// Measured on the first draft: "what is Sticky Divergence" matched the `divergence` CONCEPT, because
// the concept's alias list contains the word. The reader had named a specific finding with its own
// authored copy and got the general idea instead — a worse answer that looks like a good one.
//
//   1. findings catalogue    a NAMED thing the engine detected     ("Sticky Divergence")
//   2. lens faces            a named reading of one metric          ("Below bar — leads a weak field")
//   3. guardrail signatures  a named screening outcome
//   4. metric glosses        a filed line item                      ("Return on Assets", "ROCE")
//   5. concept registry      product mechanism                      ("Foundation", "the bands")
//
// ⚠ AND MATCHING IS ON THE ENTRY'S **NAME**, NOT ITS KEY, FOR THE FIRST FOUR. A reader types "Pledging
//   Crisis", never `ownership_R1_pledge`. Keys are matched too, because a reader who has seen one on a
//   card may paste it, but the name is what the ordering is built around.
//
// ── ⚠ WHAT THIS RESOLVER DELIBERATELY DOES NOT DO: DECIDE WHETHER A DEFINITION WAS ASKED FOR ───────
// `lookupConcept` finds the word "market" in "how is the market doing" — correctly, that sentence
// contains the term. It is not a request for a definition, and answering it with one would hijack an
// authored family. Whether the reader asked *what something means* is a property of the SENTENCE and
// lives in `router/question-shape.ts#definitionAsked`. This resolver answers "which term", never
// "was a term asked for".
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import {
  CONCEPTS, lookupConcept, type ConceptEntry, type ConceptPart,
} from "../catalogue/concepts.js";
import { STOCK_FINDINGS, LENS_FACES, GUARDRAIL_SIGNATURES } from "../catalogue/index.js";
import { QUARTER_METRIC_GLOSSES } from "../catalogue/quarter-metrics.js";
import { ANNUAL_METRIC_GLOSSES } from "../catalogue/annual-metrics.js";
import { CANONICAL_METRICS } from "../scoring/bars-loader/label-map.js";
import { resolvePillarDecomposition } from "./pillar-decomposition.js";
import { resolveStockCoverage } from "./stock-coverage.js";
import { absent, coverageReadFailed, resolved, stockCoverage, NO_COVERAGE, type Coverage, type Resolved } from "./contract.js";
import { LABEL_BAND_MAP } from "../scoring/composite/label.js";

/** Which of the five answered. Travels to the reader as a sentence, never as this token. */
export type Vocabulary = "finding" | "lens" | "guardrail" | "metric" | "concept";

/** A worked example, resolved against a real company. Never stored in a registry — see concepts.ts. */
export interface WorkedExample {
  readonly symbol: string;
  readonly lead: string;
  readonly rows: readonly { readonly label: string; readonly value: string; readonly note: string | null }[];
  readonly close: string | null;
}

export interface DefinedTerm {
  readonly key: string;
  readonly vocabulary: Vocabulary;
  readonly name: string;
  readonly description: string;
  /** ★ THE LOAD-BEARING HALF. Never empty in any of the five — it is `EntryBase`'s one universal rule. */
  readonly doesntMean: string;
  readonly parts: readonly ConceptPart[];
  readonly partOf: string | null;
  /** One sentence naming which vocabulary answered, in the reader's terms rather than the token's. */
  readonly sourceSentence: string;
  readonly example: WorkedExample | null;
  /** Other terms a reader is likely to want next. Keys, resolved to names by the section. */
  readonly seeAlso: readonly { readonly key: string; readonly name: string }[];
  /** ★ How VYTAL computes it — authored, code-supplied, never the model's to write. Null when the
   *  basis is the conventional one and needs no correction. See `CanonicalMetric.vytalBasis`. */
  readonly vytalBasis: string | null;
  /** The pillar an engine metric sits in; null for concepts, findings and glosses. */
  readonly pillar: string | null;
  /** ★★ True when NOBODY has authored a meaning and the general half is the model's to supply. */
  readonly needsGeneralHalf: boolean;
}

const SOURCE_SENTENCE: Record<Vocabulary, string> = {
  finding: "This is one of the checks we run against a company's filings — a named configuration, not a forecast.",
  lens: "This is one of the readings we take of a single measure, against its bar, its peers and its own history.",
  guardrail: "This is one of the screening outcomes that can hold a reading back before it is published.",
  metric: "This is a line item companies file, defined as we read it.",
  concept: "This is part of how the product itself works, rather than something a company filed.",
};

const words = (raw: string): string =>
  raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/ +/g, " ").trim();

/** Whole-phrase or whole-word-run containment. ⚠ NEVER substring — see `lookupConcept`'s note. */
function mentions(hay: string, needle: string): boolean {
  const n = words(needle);
  if (n.length < 3) return false;
  return hay === n || ` ${hay} `.includes(` ${n} `);
}

interface Candidate {
  key: string; vocabulary: Vocabulary; name: string; description: string; doesntMean: string;
  parts: readonly ConceptPart[]; partOf: string | null;
  /** ★ HOW VYTAL COMPUTES IT, authored on the engine registry — see `CanonicalMetric.vytalBasis`. */
  vytalBasis?: string | null;
  /** Which pillar the measure sits in, when it is an engine metric. */
  pillar?: string | null;
  /**
   * ★★ TRUE WHEN NOBODY HAS AUTHORED A DEFINITION and the general half is the MODEL's to write.
   *
   * ⚠ THE OLD BEHAVIOUR NARRATED OUR BACKLOG TO THE READER — "we hold no written definition for it
   *   yet … take this as a description of how it is USED". That is a note to whoever maintains the
   *   catalogue, said out loud to somebody who asked what a ratio means. The flag replaces the
   *   narration: the composer either gets the model to explain it or says plainly that we cannot.
   */
  needsGeneralHalf?: boolean;
}

/**
 * Search the five, specific first. Returns the LONGEST name matched within each tier, so
 * "Sticky Divergence" beats "Divergence" where both are registered.
 */
function searchVocabularies(raw: string): Candidate | null {
  const q = words(raw);
  if (q.length === 0) return null;

  const tiers: { vocab: Vocabulary; entries: Record<string, unknown> }[] = [
    { vocab: "finding", entries: STOCK_FINDINGS as Record<string, unknown> },
    { vocab: "lens", entries: LENS_FACES as Record<string, unknown> },
    { vocab: "guardrail", entries: GUARDRAIL_SIGNATURES as Record<string, unknown> },
  ];

  for (const { vocab, entries } of tiers) {
    let best: Candidate | null = null;
    let bestLen = 0;
    for (const [key, raw2] of Object.entries(entries)) {
      const e = raw2 as { name?: string; description?: string; doesntMean?: string };
      const name = typeof e.name === "string" ? e.name : "";
      if (!name) continue; // ⚠ the 58 PHS entries carry no name — see the report
      const hit = mentions(q, name) || mentions(q, key);
      if (!hit || name.length <= bestLen) continue;
      bestLen = name.length;
      best = {
        key, vocabulary: vocab, name,
        description: typeof e.description === "string" ? e.description : "",
        doesntMean: typeof e.doesntMean === "string" ? e.doesntMean : "",
        parts: [], partOf: null,
      };
    }
    if (best && best.description) return best;
  }

  // ── 4 · METRIC GLOSSES. Matched on the reader label AND on the canonical engine key, because a card
  //      shows "Return on Assets" and the engine calls it `ROA`.
  const glosses: Record<string, { label: string; meaning: string; doesntMean: string }> = {
    ...(QUARTER_METRIC_GLOSSES as Record<string, { label: string; meaning: string; doesntMean: string }>),
    ...(ANNUAL_METRIC_GLOSSES as Record<string, { label: string; meaning: string; doesntMean: string }>),
  };
  // ⚠ THE CANONICAL ENGINE NAMES ARE A SEPARATE INDEX, AND THE FIRST DRAFT LOOKED THEM UP THE WRONG
  //   WAY ROUND. It called `canonicalMetric(glossKey)` — but gloss keys are payload fields (`revenue`,
  //   `otherIncome`) while canonical keys are engine codes (`F1`, `Tier1`), so the lookup never hit and
  //   "what is ROCE" found nothing at all. ROCE is `F1`'s LABEL; the gloss for it is keyed elsewhere.
  //   Matching the canonical label directly is a fifth name for a metric, and a reader who read it off
  //   a health card is entitled to look it up.
  const canonicalNames = new Map<string, string>();
  for (const m of CANONICAL_METRICS) canonicalNames.set(m.label.toLowerCase(), m.label);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ ALIASES ARE MATCHED HERE, AND AN AMBIGUOUS ONE REFUSES.
  //
  // ⚠ `label` AND `key` WERE THE ONLY NAMES MATCHED, AND READERS TYPE ACRONYMS. "What is ROE" fell
  //   past this loop to the canonical-metric arm below and returned "we hold no written definition
  //   for it yet" — while `returnOnEquity` sat right here, fully authored. See `MetricGloss.aliases`.
  //
  // ★ AND AN ALIAS TWO ENTRIES CLAIM RETURNS NOTHING. `returnOnAssetsQuarterly` and
  //   `returnOnAssetsAnnual` are both "ROA"; picking one would answer a question about the full year
  //   with a quarter, or the reverse, and every figure in it would be real. The same refuse-rather-
  //   than-guess rule `matchPondName` states for peer groups.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  let gBest: Candidate | null = null;
  let gLen = 0;
  let ambiguous = false;
  const asCandidate = (key: string, g: { label: string; meaning: string; doesntMean: string }): Candidate => ({
    key, vocabulary: "metric", name: g.label, description: g.meaning, doesntMean: g.doesntMean,
    parts: [], partOf: null,
  });
  for (const [key, g] of Object.entries(glosses)) {
    const names = [g.label, key, ...((g as { aliases?: readonly string[] }).aliases ?? [])];
    const hit = names.find((n) => mentions(q, n));
    if (!hit) continue;
    if (hit.length === gLen && gBest && gBest.key !== key) { ambiguous = true; continue; }
    if (hit.length <= gLen) continue;
    gLen = hit.length;
    ambiguous = false;
    gBest = asCandidate(key, g);
  }
  // ⚠ A TIE IS A REFUSAL, NOT THE FIRST ENTRY. Falling through to the canonical arm below is the
  //   honest outcome: it names the measure and says we hold no definition, which is true of neither
  //   entry individually but IS true of the reader's question as asked.
  if (gBest && !ambiguous) return gBest;

  // ── 4b · THE ENGINE'S OWN METRIC NAMES, when no gloss claimed the phrase. These are the labels that
  //      appear on an attribution walk ("Cost-to-Income", "Tier-1 Capital", "ROCE"), so they are the
  //      words a reader has actually just seen. There is no authored gloss for most of them, which is
  //      a real gap and is stated as one rather than filled with an invented sentence.
  for (const [lower, label] of canonicalNames) {
    if (!mentions(q, lower)) continue;
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★ NO AUTHORED DEFINITION — SO THE CODE HALF ONLY, AND A FLAG SAYING WHO OWNS THE REST.
    //
    // ⚠ THIS ARM USED TO WRITE THE READER A NOTE ABOUT OUR CATALOGUE. Both strings are gone; the
    //   description is now what we ACTUALLY know — the pillar it sits in and, where authored, how
    //   Vytal computes it — and `needsGeneralHalf` tells the composer the meaning is missing.
    //
    // ★ THE BASIS IS THE HALF THE MODEL MUST NOT WRITE. A general explanation of ROCE would most
    //   likely describe a pre-depreciation version; Vytal's is EBIT-based. Handing that string to
    //   the model as a fact to include is what keeps the explanation matched to the number.
    const cm = CANONICAL_METRICS.find((m) => m.label.toLowerCase() === lower) ?? null;
    return {
      key: `metric_${label}`, vocabulary: "metric", name: label,
      // ⚠ NOT A DEFINITION, and it must not read like one. The composer supplies the meaning from
      //   the model or says it cannot; this is only what code can stand behind.
      description: "",
      // ═══════════════════════════════════════════════════════════════════════════════════════
      // ★★ THE BOUNDARY IS CODE'S, AND IT IS NOT OPTIONAL — `I-BOUNDARY` caught its absence.
      //
      // ⚠ THE FIRST VERSION LEFT THIS EMPTY, and the harness failed on both arms within the hour.
      //   Its rule is that "a `defined-term` payload MUST have one: every vocabulary it reads
      //   guarantees the field" — and this arm was a new path that did not. An empty limit reads
      //   as no limit, which on a definition a MODEL wrote is the worst place to have one.
      //
      // ★ AND THE RIGHT BOUNDARY HERE IS THE WHOLE POINT OF THE BOUNDARY RULING. The explanation
      //   above is the measure as the world defines it; what the score uses is OUR computation of
      //   it. Where the two differ — ROCE is EBIT-based where most texts are not — that gap is
      //   exactly what a reader needs warning about, and it is never the model's to state.
      // ═══════════════════════════════════════════════════════════════════════════════════════
      doesntMean: cm?.vytalBasis
        ? "This is the measure as it is generally defined. Vytal computes it in its own way, stated "
          + "separately above, and where the two differ the figure you see follows ours rather than "
          + "the textbook one."
        : "This is the measure as it is generally defined. What the health score uses is Vytal's own "
          + "computation of it, which can differ from other published versions of the same name.",
      vytalBasis: cm?.vytalBasis ?? null,
      pillar: cm?.pillar ?? null,
      needsGeneralHalf: true,
      parts: [], partOf: null,
    };
  }

  // ── 5 · THE CONCEPT REGISTRY, LAST. The most general vocabulary answers only what the others could
  //      not, which is what stops "what is Sticky Divergence" resolving to "Divergence".
  const c = lookupConcept(raw);
  if (c) {
    return {
      key: c.key, vocabulary: "concept", name: c.name, description: c.description,
      doesntMean: c.doesntMean, parts: c.parts, partOf: c.partOf,
    };
  }
  return null;
}

const num = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/**
 * ★ THE WORKED EXAMPLE, ON A REAL COMPANY. What turns a definition into an answer.
 *
 * ⚠ IT IS RESOLVED, NOT STORED. A registry holding "Foundation is seven metrics" would be wrong for
 *   every non-financial and stale the day a bank files differently. What is stored is what is true
 *   always; this is what is true of one company today, and it says which company.
 */
async function workedExample(concept: ConceptEntry, symbol: string): Promise<WorkedExample | null> {
  if (concept.example === "none") return null;

  if (concept.example === "band") {
    return {
      symbol,
      lead: `The five labels, and where the cuts fall.`,
      rows: LABEL_BAND_MAP.map((b) => ({
        label: b.label,
        value: b.max === null ? `${b.min} and above` : Number.isFinite(b.min) ? `${b.min}–${b.max}` : `under ${b.max}`,
        note: null,
      })),
      close: null,
    };
  }

  if (concept.example === "coverage") {
    const cov = await resolveStockCoverage(symbol);
    // No example rather than a wrong one: a failed coverage read cannot tell us what this stock
    // supports, and the definition itself does not depend on the stock.
    if (coverageReadFailed(cov)) return null;
    const sc = stockCoverage(cov.coverage);
    if (!sc) return null;
    return {
      symbol,
      lead: `What we actually hold on ${symbol}, as an example of the three states.`,
      rows: [
        { label: "Quarters filed to us", value: String(sc.depth.quarters), note: sc.depth.quarters === 0 ? "nothing yet" : null },
        { label: "Quarters we have scored", value: sc.depth.snapshots === null ? "none — we do not score this company" : String(sc.depth.snapshots), note: null },
        { label: "As of", value: sc.asOf ?? "no dated figure held", note: null },
      ],
      close: sc.tier === 2
        ? `${symbol} sits in the third state: filings and a reading over them.`
        : sc.tier === 1
        ? `${symbol} sits in the middle state — real filings, and no reading laid over them.`
        : `${symbol} sits in the first state: we hold the ticker and no filed quarter.`,
    };
  }

  const dec = await resolvePillarDecomposition(symbol);
  if (!dec.ok) return null;
  const d = dec.data;

  if (concept.example === "composite") {
    return {
      symbol,
      lead: `${symbol} for ${d.periodKey}, as a worked example — the four parts, at the weights actually applied.`,
      rows: d.parts.map((p) => ({
        label: p.pillar.charAt(0).toUpperCase() + p.pillar.slice(1),
        value: p.contribution === null ? "not measured" : `${num(p.contribution)} of ${num(d.composite)}`,
        note: p.contribution === null
          ? "its share of the weight went to the parts that could be scored"
          : `${Math.round(p.weightApplied * 100)}% weight × ${num(p.subtotal ?? 0)} out of 100`,
      })),
      close: `Those add to ${num(d.composite)}, which reads as ${d.bandLabel}.`,
    };
  }

  if (concept.example === "redistribution") {
    const missing = d.parts.filter((p) => p.state !== "scored");
    return {
      symbol,
      lead: missing.length
        ? `${symbol} at ${d.periodKey} is a live example — one part could not be scored.`
        : `${symbol} at ${d.periodKey} has all four parts scored, so the weights below are the standard set.`,
      rows: d.parts.map((p) => ({
        label: p.pillar.charAt(0).toUpperCase() + p.pillar.slice(1),
        value: `${Math.round(p.weightApplied * 100)}%`,
        note: p.state === "scored" ? null : "could not be scored — its weight moved to the others",
      })),
      close: missing.length
        ? `The three that could be scored are each carrying more than their usual share.`
        : null,
    };
  }

  // `pillar`
  const p = d.parts.find((x) => x.pillar === concept.pillar);
  if (!p) return null;
  return {
    symbol,
    lead: `${symbol} at ${d.periodKey}, as a worked example.`,
    rows: [
      { label: `${concept.name} reading`, value: p.subtotal === null ? "not measured this period" : `${num(p.subtotal)} out of 100`, note: null },
      { label: "Weight applied", value: `${Math.round(p.weightApplied * 100)}%`, note: p.state === "scored" ? null : "this part could not be scored, so its weight went elsewhere" },
      { label: "What it put into the score", value: p.contribution === null ? "nothing — it was not measured" : `${num(p.contribution)} points of ${num(d.composite)}`, note: null },
    ],
    close: p.contribution === null
      ? null
      : `So ${concept.name} accounts for ${num(p.contribution)} of ${symbol}'s ${num(d.composite)}.`,
  };
}

/** Terms a reader is likely to want next, per vocabulary. Keys only — names resolved here. */
function seeAlsoFor(c: Candidate): { key: string; name: string }[] {
  const pick = (...keys: string[]) =>
    keys.map((k) => ({ key: k, name: CONCEPTS[k]?.name ?? k })).filter((x) => x.name !== x.key);
  if (c.vocabulary === "finding" || c.vocabulary === "lens" || c.vocabulary === "guardrail") {
    return pick("concept_finding", "concept_health_score");
  }
  if (c.vocabulary === "metric") return pick("concept_pillar_foundation", "concept_health_score");
  if (c.key.startsWith("concept_pillar_")) return pick("concept_health_score", "concept_weights", "concept_bands");
  return pick("concept_health_score", "concept_bands");
}

/**
 * Resolve a definition. `symbol` is optional and only decides whether a worked example is possible.
 *
 * ⚠ NO DATABASE READ AT ALL WHEN THERE IS NO SUBJECT — see the zero-token note in `concepts.ts`. The
 *   registries are frozen objects loaded with the module; a subjectless definition costs one map
 *   lookup and no query, which is what makes this family reduce load rather than add to it.
 */
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ WHICH TERM A PHRASE NAMES, IF ANY — pure, synchronous, no query. Exported for ONE caller.
 *
 * ⚠ IT EXISTS BECAUSE THE ROUTER HANDS THE DEFINED TERM TO RESOLVER #1 AS A COMPANY, AND SOMETIMES IT
 *   RESOLVES. Measured on the lexical path:
 *
 *     "what does Foundation mean"        → subject mention "Foundation" → resolved to **ARIHANT**
 *     "what does Sticky Divergence mean" → mention "Sticky Divergence" → subject_not_covered
 *     "what is ROCE"                     → mention "ROCE"              → subject_not_covered
 *
 *   The first is the dangerous one: a reader asking what a pillar means was answered about a company
 *   whose name contains the word. The other two told them we have never heard of a company they never
 *   asked about. All three are §6.2's confident-wrong-artifact, arriving through subject extraction.
 *
 * ★ THE TEST THAT SEPARATES A DEFINITION FROM A DATA QUESTION IS **WHETHER THE MENTION IS THE TERM**.
 *
 *     "what does Foundation mean"  mention "Foundation" → the term itself   → the definition wins
 *     "what is TCS's revenue"      mention "TCS"        → NOT the term      → the data question wins
 *
 *   Both are definition-SHAPED and only one is a definition. Asking whether the mention resolves to
 *   the same vocabulary entry the whole question did is exact, needs no word lists, and cannot be
 *   fooled by a company whose name happens to contain a metric.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
export function definitionKeyFor(text: string): string | null {
  return searchVocabularies(text)?.key ?? null;
}

export async function resolveDefinition(
  raw: string,
  symbol: string | null,
): Promise<Resolved<DefinedTerm>> {
  const found = searchVocabularies(raw);
  if (!found) return absent<DefinedTerm>("not_in_universe", NO_COVERAGE);

  let coverage: Coverage = NO_COVERAGE;
  let example: WorkedExample | null = null;
  if (symbol) {
    // ⚠ NO GUARD HERE, AND THAT IS A RULING RATHER THAN AN OVERSIGHT. A DEFINITION IS NOT ABOUT THE
    //   STOCK. On a failed coverage read `cov.coverage` is already the empty envelope, the worked
    //   example declines on its own (see workedExample), and the term is still defined correctly —
    //   so the answer degrades to exactly what it would be had no symbol been named.
    const cov = await resolveStockCoverage(symbol);
    coverage = cov.coverage;
    const concept = CONCEPTS[found.key];
    if (concept) example = await workedExample(concept, symbol).catch(() => null);
  }

  return resolved<DefinedTerm>({
    key: found.key,
    vocabulary: found.vocabulary,
    name: found.name,
    description: found.description,
    doesntMean: found.doesntMean,
    parts: found.parts,
    partOf: found.partOf,
    sourceSentence: SOURCE_SENTENCE[found.vocabulary],
    example,
    seeAlso: seeAlsoFor(found),
    vytalBasis: found.vytalBasis ?? null,
    pillar: found.pillar ?? null,
    needsGeneralHalf: found.needsGeneralHalf === true,
  }, coverage, symbol ? ["score_snapshots"] : []);
}
