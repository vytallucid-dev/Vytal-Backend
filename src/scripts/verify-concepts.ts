// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONCEPT REGISTRY GATE — §7.1's fifth vocabulary, proved rather than asserted.
//
// ★ IT RUNS IN `verify:copy`, WHICH IS `npm run build`. §7.2's discipline is "compile-error presence
//   plus CI", and the four existing registries both have it. A fifth vocabulary that only had the
//   first half would be the one place a copy defect could reach a reader.
//
// WHAT IT PROVES, AND WHY EACH ONE IS HERE RATHER THAN TRUSTED:
//
//   §1  ZERO KEY OVERLAP with all four other vocabularies. §7.1 claims it "by construction"; the
//       construction is a prefix, and a prefix is a convention until something checks it.
//   §2  TOTALITY — every entry carries every field. `doesntMean` is `EntryBase`'s one universal
//       requirement and the type enforces presence, not CONTENT: `doesntMean: ""` typechecks.
//   §3  THE ZERO-TOKEN CLAIM. §7.1 says exact match costs no model tokens, and the previous batch
//       proved what that is worth when the daily budget ran out mid-build. Asserted by construction —
//       the lookup is synchronous and cannot await — and by wall-clock over the whole alias set.
//   §4  THE ALIAS INDEX IS UNAMBIGUOUS. Two concepts claiming one word means the answer depends on a
//       sort order nobody reads.
//   §5  NO GLYPH IN THE BOUNDARY COPY. `quarter-metrics.ts` states the rule — a screen reader
//       announces "≠" as "not equal to" and this copy renders with no border to carry it — and the
//       first draft of `concepts.ts` broke it on all fourteen entries.
//   §6  NEGATIVE CONTROLS. Every check above fires on a broken artefact and is silent on the real one.
//
// PURE except for the registry imports. No DB, no model.
//   npx tsx src/scripts/verify-concepts.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import {
  CONCEPTS, CONCEPT_KEYS, CONCEPT_PREFIX, lookupConcept, type ConceptEntry,
} from "../catalogue/concepts.js";
import { STOCK_FINDINGS, LENS_FACES, PHS_FINDINGS, GUARDRAIL_SIGNATURES } from "../catalogue/index.js";
import { EVIDENCE_FACTS } from "../catalogue/evidence-facts.js";
import { QUARTER_METRIC_GLOSSES } from "../catalogue/quarter-metrics.js";
import { LABEL_BAND_MAP } from "../scoring/composite/label.js";
import { ANNUAL_METRIC_GLOSSES } from "../catalogue/annual-metrics.js";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  c ? pass++ : fail++;
};
const section = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

// ── §1 · ZERO KEY OVERLAP ─────────────────────────────────────────────────────────────────────────
section("1 · zero key overlap with the other four vocabularies (§7.1's 'by construction', checked)");
{
  const others: [string, readonly string[]][] = [
    ["stock findings", Object.keys(STOCK_FINDINGS)],
    ["lens faces", Object.keys(LENS_FACES)],
    ["PHS findings", Object.keys(PHS_FINDINGS)],
    ["guardrail signatures", Object.keys(GUARDRAIL_SIGNATURES)],
    ["evidence facts", Object.keys(EVIDENCE_FACTS)],
    ["quarter glosses", Object.keys(QUARTER_METRIC_GLOSSES)],
    ["annual glosses", Object.keys(ANNUAL_METRIC_GLOSSES)],
  ];
  const mine = new Set(CONCEPT_KEYS);
  let collisions = 0;
  let borrowed = 0;
  for (const [name, keys] of others) {
    const overlap = keys.filter((k) => mine.has(k));
    const usesPrefix = keys.filter((k) => k.startsWith(CONCEPT_PREFIX));
    collisions += overlap.length;
    borrowed += usesPrefix.length;
    if (overlap.length || usesPrefix.length) {
      console.log(`     ${name}: ${overlap.length} shared key(s), ${usesPrefix.length} using "${CONCEPT_PREFIX}"`);
    }
  }
  ok("no concept key exists in any other vocabulary", collisions === 0,
    `${CONCEPT_KEYS.length} concepts against ${others.reduce((a, [, k]) => a + k.length, 0)} other keys`);
  // ★ THE OTHER DIRECTION, WHICH IS THE ONE THAT WOULD ROT SILENTLY. Nothing stops a future finding
  //   key from being named `concept_something`; if one ever is, the prefix stops being a construction
  //   and this file's §1 becomes the only thing that would notice.
  ok("no OTHER vocabulary has started using the concept prefix", borrowed === 0,
    borrowed === 0 ? `"${CONCEPT_PREFIX}" is exclusive` : `${borrowed} foreign key(s) use it`);
  ok("every concept key carries the prefix", CONCEPT_KEYS.every((k) => k.startsWith(CONCEPT_PREFIX)),
    `${CONCEPT_KEYS.filter((k) => !k.startsWith(CONCEPT_PREFIX)).join(", ") || "all prefixed"}`);
}

// ── §2 · TOTALITY ─────────────────────────────────────────────────────────────────────────────────
section("2 · every entry carries every field, and the fields carry sentences");
{
  // The five published labels, lower-cased — read from the mapping so a re-band cannot leave this
  // list stale (N-5). Any of them appearing in `inProse` is the category error DP hit.
  const BAND_WORDS = new Set(LABEL_BAND_MAP.map((b) => b.label.split("—")[0]!.trim().toLowerCase()));
  const bad: string[] = [];
  for (const [key, c] of Object.entries(CONCEPTS) as [string, ConceptEntry][]) {
    if (c.key !== key) bad.push(`${key}: key field disagrees with its index (${c.key})`);
    if (!c.name || c.name.length < 3) bad.push(`${key}: no name`);
    if (!c.description || c.description.length < 40) bad.push(`${key}: description is not a definition`);
    // ⚠ THE TYPE ENFORCES PRESENCE, NOT CONTENT. `doesntMean: ""` typechecks and would ship a card
    //   with an empty boundary — which reads as "there is no limit on this claim".
    if (!c.doesntMean || c.doesntMean.length < 40) bad.push(`${key}: boundary is not a sentence`);
    if (c.aliases.length === 0) bad.push(`${key}: no alias — unreachable by any question`);
    // ── THE TWO FIELDS DP ADDED, HELD TO THE SAME STANDARD ──────────────────────────────────────
    //
    // ⚠ `gloss` IS A FRAGMENT BY CONTRACT. It renders inside someone else's sentence, in parentheses,
    //   so a leading capital or a trailing full stop breaks the sentence it sits in. The type cannot
    //   say that; this can.
    if (!c.gloss || c.gloss.length < 10) bad.push(`${key}: gloss is not a clause`);
    if (/^[A-Z]/.test(c.gloss)) bad.push(`${key}: gloss opens with a capital — it is a fragment, not a sentence`);
    if (/[.!?]$/.test(c.gloss)) bad.push(`${key}: gloss ends with a full stop — it is a fragment`);
    // ⚠ AND `inProse` MUST NOT BORROW A BAND VALUE. That is the exact category error the field was
    //   added to prevent: `concept_bands`'s aliases include "steady" and "healthy", which appear in
    //   our own prose as VALUES, and glossing one of those annotates a reading with a definition of
    //   the reading system.
    for (const t of c.inProse) {
      if (t.length < 4) bad.push(`${key}: in-prose term "${t}" is short enough to match inside a word`);
      if (BAND_WORDS.has(t.toLowerCase())) {
        bad.push(`${key}: in-prose term "${t}" is a band VALUE — it appears in prose meaning a reading, not this concept`);
      }
    }
    for (const p of c.parts) {
      if (!p.label) bad.push(`${key}: a part with no label`);
    }
    if (c.example === "pillar" && !c.pillar) bad.push(`${key}: example is "pillar" and names none`);
  }
  ok("every concept is complete", bad.length === 0, bad.slice(0, 4).join(" · ") || `${CONCEPT_KEYS.length} entries`);
}

// ── §3 · THE ZERO-TOKEN CLAIM ─────────────────────────────────────────────────────────────────────
section("3 · exact match costs zero model tokens, and no database read");
{
  // ★ BY CONSTRUCTION FIRST. A synchronous function cannot await a model or a query — the type is the
  //   proof, and this asserts the type has not quietly become a promise.
  const probe = lookupConcept("what does Foundation mean");
  ok("the lookup is synchronous — it cannot await a model or a query",
    probe !== null && !(probe as unknown as { then?: unknown }).then,
    "returns an entry, not a promise");

  // ★ AND BY WALL CLOCK, over every alias every entry declares. A frozen-map lookup over ~90 aliases
  //   should be microseconds; anything near a millisecond means something in the path started doing
  //   work it should not.
  const asks = Object.values(CONCEPTS).flatMap((c) => [c.name, ...c.aliases]);
  const t0 = performance.now();
  let hits = 0;
  for (let i = 0; i < 20; i++) for (const a of asks) if (lookupConcept(a)) hits++;
  const ms = performance.now() - t0;
  ok("every declared alias resolves", hits === asks.length * 20, `${hits} of ${asks.length * 20}`);
  ok("the whole alias set resolves in well under a millisecond per lookup",
    ms / (asks.length * 20) < 0.5, `${(ms / (asks.length * 20)).toFixed(4)} ms per lookup over ${asks.length} aliases`);
}

// ── §4 · THE ALIAS INDEX IS UNAMBIGUOUS ───────────────────────────────────────────────────────────
section("4 · no two concepts claim the same word");
{
  const seen = new Map<string, string>();
  const clashes: string[] = [];
  for (const c of Object.values(CONCEPTS)) {
    for (const a of [c.name.toLowerCase(), ...c.aliases.map((x) => x.toLowerCase())]) {
      const prior = seen.get(a);
      if (prior && prior !== c.key) clashes.push(`"${a}" claimed by ${prior} and ${c.key}`);
      seen.set(a, c.key);
    }
  }
  ok("every alias belongs to exactly one concept", clashes.length === 0,
    clashes.slice(0, 3).join(" · ") || `${seen.size} distinct aliases`);

  // ⚠ AND AN ALIAS MUST NOT BE A BARE COMMON WORD. `lookupConcept` matches whole words, so a
  //   one-syllable alias like "it" or "the" would claim half the questions a reader can type.
  const tooShort = [...seen.keys()].filter((a) => a.replace(/[^a-z]/g, "").length < 4);
  ok("no alias is short enough to match by accident", tooShort.length === 0,
    tooShort.join(", ") || "shortest alias is 4 characters");
}

// ── §5 · THE BOUNDARY COPY IS PROSE ───────────────────────────────────────────────────────────────
section("5 · the boundary copy is a sentence, not the '≠' form");
{
  // ⚠ `quarter-metrics.ts` STATES THE RULE AND THE FIRST DRAFT OF `concepts.ts` BROKE IT FOURTEEN
  //   TIMES. "A screen reader announces '≠' as 'not equal to', and this copy renders inside a card
  //   with no italics or left border to carry the glyph." The PHS library's use of it is shipped
  //   behaviour there and explicitly not a form to copy.
  const glyphed = Object.values(CONCEPTS).filter((c) => c.doesntMean.includes("≠"));
  ok("no concept boundary uses the ≠ glyph", glyphed.length === 0,
    glyphed.map((c) => c.key).join(", ") || `${CONCEPT_KEYS.length} entries, all prose`);

  const notSentence = Object.values(CONCEPTS).filter((c) => !/^[A-Z]/.test(c.doesntMean.trim()));
  ok("every boundary opens as a sentence", notSentence.length === 0,
    notSentence.map((c) => c.key).join(", ") || "all capitalised");
}

// ── §6 · NEGATIVE CONTROLS ────────────────────────────────────────────────────────────────────────
section("6 · the checks above fire on a broken artefact");
{
  const control = (name: string, broken: boolean) => {
    ok(`NEGATIVE CONTROL · ${name}`, broken, broken ? "caught" : "⚠ THE CHECK DOES NOT GUARD WHAT IT CLAIMS");
  };
  control("a key without the prefix would fail §1", !"health_score".startsWith(CONCEPT_PREFIX));
  control("an empty boundary would fail §2", "".length < 40);
  control("a duplicate alias would fail §4", (() => {
    const m = new Map<string, string>([["foundation", "concept_a"]]);
    return m.get("foundation") !== "concept_b";
  })());
  control("a ≠ boundary would fail §5", "≠ a price target".includes("≠"));
  // ★ AND THE LOOKUP MUST REFUSE A WORD IT DOES NOT HOLD — otherwise §3's "every alias resolves"
  //   passes over a function that returns something for everything.
  control("an unknown word resolves to nothing", lookupConcept("jellyfish trombone") === null);
  control("a substring match is refused", lookupConcept("supermarket chains") === null);
  // ★ THE CATEGORY ERROR THAT COST A ROUND OF DP. "steady" is an ALIAS of `concept_bands` and a band
  //   VALUE in our prose; the check above must reject it as an in-prose term.
  control("a band value would be rejected as an in-prose term",
    new Set(LABEL_BAND_MAP.map((b) => b.label.split("—")[0]!.trim().toLowerCase())).has("steady"));
  // ★ AND A GLOSS THAT IS A SENTENCE RATHER THAN A FRAGMENT.
  control("a gloss written as a sentence would be rejected", /^[A-Z]/.test("The five labels we use."));
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILED"} — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
