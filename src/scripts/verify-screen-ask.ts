// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SET-REQUEST GATE — a request for a set is never a definition question.
//
// ★★ PURE. No DB, no filesystem, no sibling repo — it reads registries that are frozen objects loaded
//    with their modules, so it stays inside the rule verify-build-gate-hygiene.ts enforces.
//
// ── ★ WHY THIS GATE EXISTS AND THE PREVIOUS THREE FIXES DID NOT HAVE ONE ──────────────────────────
// Definition routing has now over-fired on a set request four times, and each fix was correct and had
// no property behind it, so the next occurrence arrived through the next door:
//
//   1. `definitionAsked` was the gate — a phrasing list, with false negatives.
//   2. Inverting it to the registry made `mentionsAreTheTerm` vacuously true with no company in the
//      sentence, and a screen was answered with a metric gloss. Patched with `extractConditions`.
//   3. `declinedFrame`'s word-list gaps refused three phrasings of a frame decline outright.
//   4. And then two live questions with NO NUMBER in them — "give me a list of all the stocks which
//      are in pristine health band" and "how many stocks are showing pledging red flag" — were
//      answered with definition cards, because `extractConditions` cannot see a band or a rule.
//
// Four occurrences, three fixes, no assertion. This is the assertion. It is cheap, it is offline, and
// it fails on the author's machine the moment either half of the boundary moves.
//
// ── ★ WHAT IS ASSERTED, AND WHY IT IS BOTH DIRECTIONS ─────────────────────────────────────────────
//   §1  SET REQUESTS ROUTE AS SCREENS. The corpus is phrasings, not one sentence — the FIX-1 sweep's
//       finding was "3 of 6 phrasings missed", which one example would never have shown.
//   §2  DEFINITION QUESTIONS STILL REACH THE DEFINITION PATH. This is the half a fix to §1 breaks,
//       and it is the door the third occurrence came through. A gate that only checked §1 would pass
//       against a detector that called everything a screen.
//   §3  THE TWO PATHS CANNOT DISAGREE. `definitionAnswer` stands down on exactly `screenAsk(raw)`,
//       and step 3g composes on exactly `screenAsk(raw)`. Asserted by SOURCE, because the property is
//       "one function, two callers" and no output test can see a second copy being introduced.
//   §4  THE FILTER VOCABULARIES REFUSE RATHER THAN GUESS. A word that is not one of the five
//       published band labels resolves to no band; a phrase that is not one of the 22 registered
//       filing rules resolves to no rule.
//   §5  THE SHAPE IS READ FROM THE SENTENCE. "How many" is a count; a bare list is a list.
//
//   npx tsx src/scripts/verify-screen-ask.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screenAsk, extractBand, matchFindingRule, countAsked } from "../composition/screen-ask.js";
import { definitionKeyFor } from "../resolve/concept.js";
import { FILING_REGISTRY } from "../filing/registry.js";
import { DERIVED_SCREEN_FIELDS } from "../scoring/read/screen-fields.generated.js";
import { SCREEN_FIELDS_IDS } from "../scoring/read/screen.types.js";

let fail = 0;
const bad = (why: string) => { console.error(`  ❌ ${why}`); fail++; };
const section = (s: string) => console.log(`\n══ ${s} ══`);

// ═══ §1 · A REQUEST FOR A SET IS A SCREEN ══════════════════════════════════════════════════════════
//
// ⚠ EVERY ONE OF THESE NAMES A TERM ONE OF OUR VOCABULARIES DEFINES, which is the whole difficulty:
//   `definitionKeyFor` resolves on all of them, and that is CORRECT — the term is there. What makes
//   them screens is that the sentence asks for a SET, and the defined term is the filter.
const SET_REQUESTS: readonly string[] = [
  // the two observed live
  "give me a list of all the stocks which are in pristine health band",
  "how many stocks are showing pledging red flag",
  // band, across phrasings — the FIX-1 lesson: one example proves nothing about a phrasing class
  "which stocks are in the healthy band",
  "show me the companies in the fragile band",
  "list every company in the steady band",
  "how many stocks are in the below par band",
  "count the names in the pristine band",
  // findings, across phrasings and across rules
  "which stocks have an earnings quality red flag",
  "show me all stocks with a promoter exit flag",
  "how many companies have a debt explosion flag",
  "count the stocks with a margin compression pattern",
  "which companies are showing accruals divergence",
  "find every business with an interest coverage collapse flag",
  // a kind, with no rule named at all
  "which companies have red flags",
  "how many stocks have red flags",
  // and the numeric screens that already worked and must not regress
  "companies with return on equity above 900",
  "which stocks have return on equity above 20%",
  "find stocks whose health score is less than 80",
  // ═══ ★★ FILED LINE ITEMS — the third universe, and the observed failure ══════════════════════
  //
  // ⚠ "Revenue" IS THE ONE THAT SHOWS THE SCOPE. It is the most basic screen anybody will ask for,
  //   it is not a scored metric, and it was answered with a definition card because the filterable
  //   list was thirteen hand-kept fields. These exercise the DERIVED vocabulary — a gloss over a real
  //   column — across grains, industries and units.
  "give me a list of stocks whose revenue in its latest quarter is greater than 100cr",
  "stocks with net profit above 500 crore",
  "companies with annual revenue above 5000 crore",
  "list companies whose interest cost is under 20cr",
  "which stocks have basic eps above 50",
  "stocks with premiums collected above 1000cr",
  "companies with core capital above 15%",
  // a combined filter across two universes — the intersection §2 requires
  "stocks with health score above 70 and revenue above 500cr",
];

section("§1 · set requests route as screens");
for (const q of SET_REQUESTS) {
  if (screenAsk(q) === null) bad(`a set request did not route as a screen: "${q}"`);
}
console.log(`  ✅ ${SET_REQUESTS.length} set requests, every one a screen`);

// ⚠ AND THE NEGATIVE CONTROL FOR THIS SECTION IS THAT THE TERMS REALLY ARE THERE. If
//   `definitionKeyFor` stopped resolving them, §1 would pass for the wrong reason — the collision the
//   gate exists to referee would simply have gone away, and it would come back the day the registry
//   grew. Measured rather than assumed.
const COLLIDING = SET_REQUESTS.filter((q) => definitionKeyFor(q) !== null);
if (COLLIDING.length === 0) {
  bad("no set request in the corpus names a defined term any more — this gate is no longer testing "
    + "the collision it was written for, and the corpus needs terms that collide");
} else {
  console.log(`  ✅ ${COLLIDING.length} of them still name a term the registry defines — the collision is real`);
}

// ═══ §2 · A DEFINITION QUESTION IS STILL A DEFINITION QUESTION ═════════════════════════════════════
//
// ⚠ THIS IS THE DOOR THE THIRD OCCURRENCE CAME THROUGH. Every fix to §1 is a chance to close it.
const DEFINITIONS: readonly string[] = [
  "what does pristine mean",
  "what do the five labels mean",
  "explain the bands",
  "what is a red flag",
  "what counts as a pattern",
  "what does Pledging Crisis mean",
  "what does Sticky Divergence mean",
  "what is ROCE",
  "can you explain ROCE by an example?",
  "what does the health score mean",
  "what does Foundation mean",
  // ⚠ THE ONE THAT MAKES THE SINGLE-WORD RULE HANDLE NECESSARY. R6's handle is the bare word
  //   "distribution", and this sentence is about the BAND SPREAD. It must not reach a findings screen.
  "what is the distribution of stocks across the bands",
  // ⚠ AND THE LINE-ITEM VOCABULARY MUST NOT SWALLOW ITS OWN DEFINITIONS. "Revenue" is now a
  //   filterable field on 2,178 companies; "what is revenue" is still a question about the word.
  "what is revenue",
  "what does net profit mean",
  "explain operating margin",
];

section("§2 · definition questions still reach the definition path");
for (const q of DEFINITIONS) {
  const ask = screenAsk(q);
  if (ask !== null) {
    bad(`a definition question was captured as a screen: "${q}" `
      + `(band=${ask.bandLabel ?? "-"}, finding=${ask.finding?.name ?? ask.finding?.kind ?? "-"}, conds=${ask.conditions.length})`);
  }
  if (definitionKeyFor(q) === null) {
    bad(`a definition question resolves no term at all — it would be REFUSED, not answered: "${q}"`);
  }
}
console.log(`  ✅ ${DEFINITIONS.length} definition questions, none captured, every one resolving a term`);

// ═══ §3 · ONE DETECTOR, TWO CALLERS — ASSERTED BY SOURCE ═══════════════════════════════════════════
//
// ★ NO OUTPUT TEST CAN SEE THIS. The defect being prevented is a SECOND opinion about what a screen
//   is — the exact shape of occurrence 2, where `definitionAnswer` and step 3g each decided it — and
//   two copies that happen to agree today pass every behavioural assertion.
section("§3 · the definition guard and the screen composer read the SAME detector");
const composeSrc = readFileSync(resolve(process.cwd(), "src/composition/compose.ts"), "utf8");

if (!/if\s*\(screenAsk\(turn\.raw\)\)\s*return null;/.test(composeSrc)) {
  bad("compose.ts#definitionAnswer no longer stands down on `screenAsk(turn.raw)` — the definition "
    + "path and the screen path can now disagree about what a screen is");
} else {
  console.log("  ✅ definitionAnswer stands down on screenAsk");
}

// ⚠ AND THE COMPOSER MUST NOT HAVE ITS OWN. `extractConditions` is `screenAsk`'s own input and is
//   legitimate INSIDE screen-ask.ts; a second import of it into the composer is the split reappearing.
if (/from "\.\/screen-conditions\.js"/.test(composeSrc)) {
  bad("compose.ts imports `extractConditions` directly again — that is the second opinion about what "
    + "a screen is that occurrence 2 was caused by. It belongs behind `screenAsk`.");
} else {
  console.log("  ✅ the composer holds no second screen detector");
}

const screenAnswerCalls = (composeSrc.match(/await screenAnswer\(turn\)/g) ?? []).length;
if (screenAnswerCalls < 3) {
  bad(`the screen dispatch is reached from ${screenAnswerCalls} of the 3 branches that can return `
    + "before it (out-of-scope, unresolved-operation, and the subjectless path). A screen request "
    + "arriving on one of the others is refused or clarified instead of answered.");
} else {
  console.log(`  ✅ the screen dispatch is reached from all ${screenAnswerCalls} branches that precede it`);
}

// ═══ §4 · THE FILTER VOCABULARIES REFUSE RATHER THAN GUESS ═════════════════════════════════════════
section("§4 · every filter is registry-resolved");
for (const notABand of ["excellent", "great", "premium", "top", "par", "gold"]) {
  if (extractBand(`which stocks are in the ${notABand} band`) !== null) {
    bad(`"${notABand}" resolved to a band — a word we do not publish must resolve to nothing`);
  }
}
console.log("  ✅ six non-band words resolve to no band");

for (const notARule of ["a moon flag", "a vibes red flag", "a synergy pattern"]) {
  if (matchFindingRule(`which stocks have ${notARule}`) !== null) {
    bad(`"${notARule}" resolved to a rule — only the ${FILING_REGISTRY.length} registered filing rules may`);
  }
}
console.log(`  ✅ three invented findings resolve to no rule (${FILING_REGISTRY.length} are registered)`);

// ⚠ AND EVERY REGISTERED RULE MUST BE REACHABLE BY ITS OWN NAME, or a reader can name a check we run
//   and be told nothing about it. This is the completeness half — §4's other direction.
const unreachable = FILING_REGISTRY.filter((e) => {
  const words = e.ruleKey.split("_").slice(1).filter((p) => !/^[A-Z]+[0-9]*$/.test(p)).join(" ");
  return matchFindingRule(`which stocks have a ${words} flag`)?.ruleKey !== e.ruleKey;
});
if (unreachable.length > 0) {
  bad(`${unreachable.length} registered rule(s) cannot be named by a reader: ${unreachable.map((e) => e.ruleKey).join(", ")}`);
} else {
  console.log(`  ✅ all ${FILING_REGISTRY.length} registered rules are reachable by name`);
}

// ═══ §4b · THE VOCABULARY IS DERIVED, NOT MAINTAINED ══════════════════════════════════════════════
//
// ⚠ THE POINT OF THE WHOLE BUILD, AND THE ONLY THING THAT STOPS IT BECOMING A LONGER LIST. These
//   assert the SHAPE of the derivation rather than any one field, so adding a column and its gloss
//   widens the screen and passes, while quietly hand-editing the registry fails `--check`.
section("§4b · the filterable vocabulary is derived from the data model");
{
  const scored = SCREEN_FIELDS_IDS.length;
  if (DERIVED_SCREEN_FIELDS.length <= scored) {
    bad(`the derived vocabulary is ${DERIVED_SCREEN_FIELDS.length} fields against ${scored} hand-listed `
      + "scored fields — the derivation has stopped finding anything the list did not already have");
  } else {
    console.log(`  ✅ ${DERIVED_SCREEN_FIELDS.length} filterable filed fields, against ${scored} hand-listed scored ones`);
  }

  // Every derived field must name a real table and column, or the screen would build SQL against
  // nothing and return an empty set that reads like a result.
  const badSource = DERIVED_SCREEN_FIELDS.filter((f) =>
    f.sources.length === 0 || f.sources.some((s) => !/^[a-z0-9_]+$/.test(s.table) || !/^[a-z0-9_]+$/.test(s.column)));
  if (badSource.length) {
    bad(`${badSource.length} derived field(s) name no usable table/column: ${badSource.map((f) => f.key).join(", ")}`);
  } else {
    console.log(`  ✅ every derived field names a real table and column`);
  }

  // ⚠ AND A DIGIT IN A COLUMN NAME IS LEGAL. `cet1_ratio` was silently dropped by a `^[a-z_]+$`
  //   guard, so the screen ran, read nothing, and reported "no company clears it". Asserted because
  //   it already happened.
  const numbered = DERIVED_SCREEN_FIELDS.filter((f) => f.sources.some((s) => /\d/.test(s.column)));
  if (numbered.length === 0) {
    bad("no derived column carries a digit — this control has gone dead and cannot catch the "
      + "`^[a-z_]+$` guard that dropped cet1_ratio");
  } else {
    console.log(`  ✅ ${numbered.length} field(s) have digits in their column names, and reach the screen`);
  }

  // Units: a fraction column filtered with a reader's percent is the silent-empty defect.
  const units = new Set(DERIVED_SCREEN_FIELDS.map((f) => f.unit));
  if (!units.has("fraction") || !units.has("currency")) {
    bad(`the derived units are ${[...units].join(", ")} — a screen with no fraction or no currency `
      + "field is not reading the schema's own UNIT annotations");
  } else {
    console.log(`  ✅ units derived from the schema: ${[...units].sort().join(", ")}`);
  }
}

// ═══ §5 · THE ANSWER SHAPE IS READ FROM THE SENTENCE ═══════════════════════════════════════════════
section("§5 · a count is asked for in words and is not a different query");
for (const q of ["how many stocks are showing pledging red flag", "count the stocks in the fragile band",
  "what is the number of companies in the healthy band"]) {
  if (!countAsked(q)) bad(`a count question was not read as one: "${q}"`);
  if (screenAsk(q)?.shape !== "count") bad(`a count question did not carry shape "count": "${q}"`);
}
for (const q of ["which stocks are in the healthy band", "show me all stocks with a promoter exit flag"]) {
  if (screenAsk(q)?.shape !== "list") bad(`a list question did not carry shape "list": "${q}"`);
}
console.log("  ✅ three counts and two lists carry the shape the sentence states");

// ⚠ AND THE COUNT AND THE LIST MUST BE THE SAME SCREEN. A count that filtered differently from its
//   own list is two answers to one question, and the reader would have no way to see it.
const asList = screenAsk("which stocks are showing pledging red flag");
const asCount = screenAsk("how many stocks are showing pledging red flag");
if (asList?.finding?.ruleKey !== asCount?.finding?.ruleKey || asList?.layer !== asCount?.layer) {
  bad("the count and the list of the same screen resolve different filters");
} else {
  console.log("  ✅ the count and the list of one question resolve the identical filter");
}

console.log(fail === 0 ? "\n✅ verify-screen-ask: all sections green" : `\n❌ verify-screen-ask: ${fail} failure(s)`);
process.exit(fail === 0 ? 0 : 1);
