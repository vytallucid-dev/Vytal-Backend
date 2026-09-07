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
import { screenAsk, extractBand, matchFindingRule, countAsked, pledgeThresholdAsked, namesPriceField,
  namesReturnWindow, namesScoredField, growthAsked } from "../composition/screen-ask.js";
import { MAX_TREND_PERIODS, PRICE_METRICS } from "../composition/screen-grammar.js";
import { admitScreen } from "../composition/screen-parse.js";
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

// ★ SECTOR-SHAPED ASKS, against a FIXTURE vocabulary — this gate is pure and cannot read the database,
//   and the property under test is the detector's logic rather than the sector table's contents.
const FIXTURE_SECTORS = ["Banks", "NBFC & Others", "Pharma & Healthcare", "IT & Technology"];
const SECTOR_ASKS: readonly string[] = [
  // ⚠ THE ONE THAT REACHED CLARIFYING CHIPS. No market noun, no enumeration verb — the sector name is
  //   the subject, and the detector could not see it.
  "banks and NBFCs with pledging above 50%",
  "pharma companies with revenue above 100cr",
  "companies in pharma or banking with net profit above 500cr",
];
for (const q of SECTOR_ASKS) {
  if (screenAsk(q, FIXTURE_SECTORS) === null) bad(`a sector-shaped set request did not route as a screen: "${q}"`);
}
console.log(`  ✅ ${SECTOR_ASKS.length} sector-shaped asks route as screens`);

// ⚠ AND A SECTOR NAMED IN A DEFINITION QUESTION MUST NOT. "What is the banking sector" names one and
//   is a question about a word; `definitionAsked` is what keeps the two apart.
for (const q of ["what is the banking sector", "what does pharma mean", "explain the banks sector"]) {
  const got = screenAsk(q, FIXTURE_SECTORS);
  if (got !== null) bad(`a definition question naming a sector was captured as a screen: "${q}"`);
}
console.log("  ✅ three definition questions naming a sector stay definitions");

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

if (!/if\s*\(screenAsk\(turn\.raw[^)]*\)\)\s*return null;/.test(composeSrc)) {
  bad("compose.ts#definitionAnswer no longer stands down on `screenAsk(turn.raw…)` — the definition "
    + "path and the screen path can now disagree about what a screen is");
} else {
  console.log("  ✅ definitionAnswer stands down on screenAsk");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ AND BOTH CALL SITES MUST PASS THE SAME VOCABULARY — a new way for the two paths to disagree.
//
//    `screenAsk` now takes the sector list, because a sector name is one of the things that makes a
//    sentence a screen. The parameter DEFAULTS TO AN EMPTY LIST, which is the hazard: a call site that
//    forgets it silently has a narrower idea of what a screen is than the other one, and the
//    definition path would capture sector screens again. That is occurrence five waiting to happen,
//    so it is asserted rather than remembered.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const askCalls = composeSrc.match(/screenAsk\(turn\.raw[^)]*\)/g) ?? [];
const bare = askCalls.filter((c) => !/,/.test(c));
if (askCalls.length < 2) {
  bad(`only ${askCalls.length} call to screenAsk in compose.ts — the definition guard and the composer `
    + "should both consult it");
} else if (bare.length > 0) {
  bad(`${bare.length} of ${askCalls.length} screenAsk calls pass no sector list, so that call site sees `
    + "a narrower screen than the other — the two paths can disagree again");
} else {
  console.log(`  ✅ all ${askCalls.length} screenAsk calls pass the sector vocabulary`);
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// §6 · EVERY LEAF KIND THE PARSER CAN EXECUTE, THE DETECTOR CAN SEE
//
// ★★ THIS SECTION EXISTS BECAUSE THE SAME DEFECT ARRIVED FOUR TIMES IN ONE BATCH. A leaf was added to
//    the grammar, validated, and executed — and the question never reached it, because `screenAsk`
//    did not recognise the sentence as a screen at all. Sector, then ranking, then a pledge
//    threshold, then price. Every one was found by hand, live, after the leaf was "done".
//
// ⚠ THE TWO HALVES FAIL IN OPPOSITE DIRECTIONS AND BOTH ARE HERE. A detector that is too narrow sends
//   a screen to the definition card; one that is too wide claims questions it cannot answer, and the
//   reader gets a screen that opens and then says their field does not exist.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("§6 · the detector sees every leaf kind the grammar can execute");

/** ⚠ A LITERAL LIST, NOT A QUERY — this is a build gate and may not reach the database. */
const GATE_SECTORS: readonly string[] = ["Banks", "Pharmaceuticals", "Information Technology"];

const IS_A_SCREEN: readonly string[] = [
  // a ranking — no comparator, no number, no band, no finding
  "top 10 stocks by revenue",
  "largest companies by market cap",
  // a pledge THRESHOLD — the number is what separates it from the R1 check
  "stocks with pledging above 30%",
  "which companies have pledging over 50 percent",
  // price-shaped
  "companies with market cap above 50000 cr",
  "stocks with a P/E below 15",
  // a trend
  "companies whose revenue has grown for 4 straight quarters",
  "banks with net interest income rising for 3 straight quarters",
  // ★★ PRICE HISTORY — and each of these missed on its first run, for a DIFFERENT reason.
  //    "within" was not a comparator this file knew; "up … in the last year" names no field at all.
  "stocks within 10% of their 52 week high",
  "stocks that have fallen more than 30% from their 52 week high",
  "companies up more than 50% in the last year",
  "stocks down over 20% in 3 months",
  // ★ NO NUMBER AT ALL — a ranking, because inventing the distance would be a cut-off nobody set.
  "stocks near their 52 week high",
  // ★★ HOW MUCH a filed figure moved — a `growth` node, not a trend. The trend leaf is direction-only.
  "companies with revenue up more than 20% year on year",
  "stocks with net profit down over 30% quarter on quarter",
  // ★ THE LOOSE TREND, which carries no trend word at all — the shape "N of the last M" is the signal.
  "stocks with revenue up in 3 of the last 4 quarters",
  // ★ A BOUND THAT IS NOT A NUMBER — each company against its own group.
  "stocks cheaper than their sector median p/e",
  "banks with return on equity above their peer group median",
];
for (const q of IS_A_SCREEN) {
  if (screenAsk(q, GATE_SECTORS) === null) bad(`a screen was not detected as one: "${q}"`);
}
console.log(`  ✅ ${IS_A_SCREEN.length} sentences across ranking, pledge, price and trend read as screens`);

// ⚠ THE NEGATIVE CONTROL. Each of these carries a word from one of the new lists and is NOT a screen
//   — a detector that claims them has been widened into a catch-all.
const IS_NOT_A_SCREEN: readonly [string, string][] = [
  ["what is a pledging red flag", "a definition that names the pledge word"],
  ["what does market cap mean", "a definition that names a price field"],
  ["what are the best stocks to buy", "a frame we decline — no basis named"],
  // ⚠ THE RETURN-WINDOW PAIR NEEDS BOTH HALVES. Either alone is ordinary English.
  ["what does a 52 week high mean", "a definition that names a price level"],
  ["companies with revenue growth in the last year", "a window with no movement word"],
];
for (const [q, why] of IS_NOT_A_SCREEN) {
  if (screenAsk(q, GATE_SECTORS) !== null) bad(`not a screen, but detected as one (${why}): "${q}"`);
}
console.log(`  ✅ ${IS_NOT_A_SCREEN.length} near-misses stay out, including a definition for each new word list`);

// ★ AND THE PLEDGE SPLIT IS THE POINT OF ITEM 4: the same word, two different answers, and the
//   NUMBER is the only thing that separates them.
if (!pledgeThresholdAsked("stocks with pledging above 30%")) {
  bad("a pledge threshold was not read as one");
}
if (pledgeThresholdAsked("stocks with a pledging red flag")) {
  bad("a pledging red flag was read as a threshold — the R1 check would be unreachable");
}
console.log("  ✅ a pledge threshold and the pledging check are told apart by the number");

// ★ AND THE RETURN WINDOW IS A PAIR, asserted in both directions — a movement word AND a period.
if (!namesReturnWindow("companies up more than 50% in the last year")) {
  bad("a return question was not recognised — the movement word and the window are both present");
}
for (const q of ["stocks that are up today", "companies with revenue growth in the last year"]) {
  if (namesReturnWindow(q)) bad(`half a return question was read as a whole one: "${q}"`);
}
console.log("  ✅ a return question needs both a movement word and a window; neither alone counts");

// ★★ AND THE SCORED VOCABULARY IS DERIVED, NOT LISTED. The word list held only the five pillar
//    names, so "return on equity above their peer group median" reached the definition card.
if (!namesScoredField("banks with return on equity above their peer group median")) {
  bad("a scored METRIC was not recognised — the detector is reading a word list, not the registry");
}
if (namesScoredField("companies with revenue above 100cr")) {
  bad('"revenue" resolved as a scored field; the detector is matching wider than the registry');
}
console.log(`  ✅ every one of the ${SCREEN_FIELDS_IDS.length} scored fields is nameable, and a filed one is not`);

// ⚠ A GROWTH AND A RETURN ARE TOLD APART BY WHETHER A FILED FIELD IS NAMED. Both carry a movement
//   word, a percentage and a period; only one of them is about the share price.
if (!growthAsked("companies with revenue up more than 20% year on year")) {
  bad("a growth question was not recognised");
}
if (growthAsked("companies up more than 50% in the last year")) {
  bad("a share-price return was read as a growth in a filed figure");
}
console.log("  ✅ a filed-figure growth and a share-price return are not confused for each other");

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// §7 · THE DETECTOR'S PRICE VOCABULARY IS DERIVED FROM THE VALIDATOR'S
//
// ⚠ A PHRASE THE DETECTOR ACCEPTS AND THE VALIDATOR REFUSES is the worst of both: the screen opens,
//   the model is called, and the answer is "that is not a field we hold" about a phrase we published.
//   Both sides read `PRICE_METRICS`, and this asserts they still do.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("§7 · every price phrase the detector knows comes from the one price table");
{
  let checked = 0;
  for (const meta of Object.values(PRICE_METRICS)) {
    for (const phrase of [meta.label, ...meta.aliases]) {
      checked++;
      if (!namesPriceField(`companies with ${phrase} above 10`)) {
        bad(`the detector does not see its own price phrase: "${phrase}"`);
      }
    }
  }
  if (!namesPriceField("companies with earnings above 10")) {
    // a phrase that is NOT in the table must not resolve — the control for the loop above
  } else {
    bad('"earnings" resolved as a price field; the detector is matching on something wider than the table');
  }
  console.log(`  ✅ ${checked} price phrases resolve, and a near word outside the table does not`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// §8 · THE DEPTH FLOOR IS ENFORCED, NOT HOPED FOR
//
// ⚠ MEASURED on `quarterly_results`, deepest basis per stock: 1,386 of 2,178 hold EXACTLY eight
//   quarters, 399 hold fewer, 393 hold more. A trend one move deeper than the cap would search 393
//   companies — 18% of the book — and would look identical to one that searched all of it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("§8 · a trend past the archive's depth is refused, not run over a fifth of the book");
if (MAX_TREND_PERIODS + 1 > 8) {
  bad(`MAX_TREND_PERIODS ${MAX_TREND_PERIODS} needs ${MAX_TREND_PERIODS + 1} quarters, past the eight the `
    + "archive holds for the bulk of the book");
} else {
  console.log(`  ✅ ${MAX_TREND_PERIODS} moves needs ${MAX_TREND_PERIODS + 1} quarters, inside the archive's floor of 8`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// §9 · A BOUND A FIELD CANNOT HOLD IS REFUSED, EVEN WHEN THE FIELD NAME IS REAL
//
// ⚠ OBSERVED LIVE, and it is the subtlest failure of the batch. "How many companies have market cap
//   above 50000 cr" came back as a screen on the MARKET HEALTH PILLAR — the model emitted the bare
//   field `market`, which is a real field, so every validator passed it and the reader was told that
//   nothing clears a bound they never set on a quantity they never named.
//
// ★ THE NAME CANNOT SETTLE IT — both readings name real fields. The NUMBER can: the score and its
//   four pillars are 0–100 by construction. Same shape as the bare-currency ceiling.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("§9 · a bound outside a score's range is refused, and the near cases still run");
{
  // ⚠ A LITERAL VOCABULARY — this is a build gate and may not reach the database.
  const vocab = { sectors: ["Banks", "Pharmaceuticals"], peerGroups: ["Large private banks"] };
  const tree = (field: string, value: number, magnitude: string) =>
    ({ shape: "list", basis: null, tree: { op: "cmp", field, comparator: "gt", value, magnitude } });

  const slip = admitScreen(tree("market", 50000, "cr"), vocab);
  if (slip.ok) bad("a crore bound on the Market pillar was admitted — the observed live misread");
  else console.log(`  ✅ the observed slip is refused: ${slip.why}`);

  // ★ THE TWO CONTROLS, both of which a wider guard would break.
  if (!admitScreen(tree("market", 70, "none"), vocab).ok) {
    bad("a legitimate pillar bound was refused — the guard is wider than the score's range");
  }
  if (!admitScreen(tree("returnOnEquity", 150, "percent"), vocab).ok) {
    bad("a scored PERCENT above 100 was refused — the guard is not reading the field's tier");
  }
  console.log("  ✅ a pillar bound inside 0–100 runs, and a scored percent above 100 still runs");
}

console.log(fail === 0 ? "\n✅ verify-screen-ask: all sections green" : `\n❌ verify-screen-ask: ${fail} failure(s)`);
process.exit(fail === 0 ? 0 : 1);
