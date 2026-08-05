// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// GATE — QUARTER IN BRIEF VOCABULARY + THE lowerIsBetter CONTRACT.
//
// Two things are asserted here, both of which are silent-failure risks:
//
//   1 · NO VERDICT WORD COLLIDES WITH A RESERVED BAND WORD. Nine vocabularies already occupy the
//       quality-adjective space, and Health↔Portfolio ALREADY collide on "Fragile"/"Steady" with
//       different numeric ranges — an unresolved bug this feature must not add a third case to.
//
//       ★ THE RESERVED LIST IS DERIVED, NOT TYPED. Where a vocabulary is a runtime value it is
//       imported; where it is a TypeScript type (which does not exist at runtime) its own classifier
//       function is CALLED at boundary values to enumerate it. Hand-copying the words would produce a
//       list that silently stops matching the product the first time someone renames a band — the
//       exact drift this gate exists to catch.
//
//   2 · EVERY lowerIsBetter MARGIN SERIES CARRIES ITS CONSEQUENCE IN WORDS. A flag nothing reads is
//       decoration, and worse than no flag because it looks handled. For a combined ratio "rising"
//       means things got WORSE; if `directionDisplay` shipped the bare direction word, a downstream
//       renderer (or the model) would supply the ordinary reading and be confidently wrong.
//
// Run: npx tsx src/scripts/verify-quarter-brief-vocabulary.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { LABEL_BAND_MAP } from "../scoring/composite/label.js";
import { bandOf, constructionBandOf, capitalTierOf } from "../portfolio/phs/constants.js";
import { MetricBand, IngestionSeverity } from "../generated/prisma/enums.js";
import { VERDICTS, VERDICT_KEYS, VERDICT_DOESNT_MEAN, BADGE_TREATMENT } from "../insight/quarter-brief/verdict.js";
import { buildMargins, type MarginRow } from "../insight/quarter-brief/margins.js";

let failures = 0;
const fail = (msg: string) => { failures++; console.error(`  ✗ ${msg}`); };
const pass = (msg: string) => console.log(`  ✓ ${msg}`);

// ── 1 · THE RESERVED LIST, DERIVED FROM THE PRODUCT ────────────────────────────────────────────────

function reservedWords(): Map<string, string> {
  const out = new Map<string, string>(); // word → which vocabulary claims it
  const claim = (source: string, phrase: string) => {
    for (const w of phrase.toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
      if (!out.has(w)) out.set(w, source);
    }
  };

  // Health — a runtime value.
  for (const b of LABEL_BAND_MAP) claim("Health band", b.label);

  // Portfolio / Construction / tiers — TYPES at compile time, so enumerate by CALLING the classifiers
  // at values inside each band. Renaming a band changes these outputs automatically.
  for (const v of [90, 70, 55, 40, 10]) claim("Portfolio band", bandOf(v));
  for (const v of [90, 75, 60, 45, 10]) claim("Construction band", constructionBandOf(v));
  for (const v of [1, 5_00_000, 5_00_00_000]) claim("Capital tier", capitalTierOf(v));

  // Prisma enums — generated as runtime const objects.
  for (const v of Object.values(MetricBand)) claim("MetricBand", v);
  for (const v of Object.values(IngestionSeverity)) claim("IngestionSeverity", v);

  // ── The only HAND-MAINTAINED entries. Each is a vocabulary with no runtime classifier left to call:
  // StructureTier's `structureTierOf()` was deleted with S1–S5 (constants.ts §15) though the type and
  // its words survive, and sector heat / finding severity are inline string unions. If any of these
  // gains an exported classifier, call it here instead of listing it.
  for (const v of ["Starter", "Building", "Established"]) claim("Structure tier", v);
  for (const v of ["hot", "warm", "calm"]) claim("Sector heat", v);
  for (const v of ["critical", "high", "recovery", "medium", "low"]) claim("Finding severity", v);

  return out;
}

function checkVocabulary(): void {
  console.log("\n1 · VERDICT VOCABULARY vs RESERVED WORDS");
  const reserved = reservedWords();
  console.log(`  reserved list derived: ${reserved.size} words from 9 vocabularies`);

  for (const key of VERDICT_KEYS) {
    const def = VERDICTS[key];
    const words = def.label.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    const hits = words.filter((w) => reserved.has(w));
    if (hits.length > 0) {
      fail(`verdict "${def.label}" collides on ${hits.map((h) => `"${h}" (${reserved.get(h)})`).join(", ")}`);
    }
  }
  if (failures === 0) pass(`all ${VERDICT_KEYS.length} verdict labels clear of every reserved word`);

  // Registry integrity — a key without a definition would render a blank badge.
  for (const key of VERDICT_KEYS) {
    if (!VERDICTS[key]) fail(`VERDICT_KEYS lists "${key}" with no entry in VERDICTS`);
    else if (!VERDICTS[key].meaning.trim()) fail(`"${key}" has no meaning sentence`);
  }
  if (Object.keys(VERDICTS).length !== VERDICT_KEYS.length) {
    fail(`VERDICTS has ${Object.keys(VERDICTS).length} entries but VERDICT_KEYS lists ${VERDICT_KEYS.length}`);
  } else pass("verdict registry is total — every key has a label and a meaning");

  // 2f — the limit ships WITH the badge.
  if (!VERDICT_DOESNT_MEAN.includes("not a view on the company") || !VERDICT_DOESNT_MEAN.includes("share price")) {
    fail("VERDICT_DOESNT_MEAN must disclaim both the company and the share price");
  } else pass("doesn't-mean line disclaims both the company and the share price");

  // 2e — no colour semantics on a descriptive badge.
  if (BADGE_TREATMENT.colourEncodesMeaning !== false) {
    fail("BADGE_TREATMENT.colourEncodesMeaning must be false — the verdict is descriptive, not evaluative");
  } else pass("badge treatment carries no colour semantics; direction rides the glyph");
}

// ── 2 · THE lowerIsBetter CONTRACT, CHECKED AGAINST REAL BLOCKS ────────────────────────────────────

/** A synthetic general-insurance window. combined_ratio is given as a FRACTION, exactly as the table
 *  stores it, so the conversion is genuinely exercised: 1.072 must surface as 107.2%, not 1.1%. */
function syntheticGiWindow(combinedFractions: number[]): MarginRow[] {
  return combinedFractions.map((combinedRatio, i) => ({
    periodKey: `FY26Q${i + 1}`,
    operatingMargin: null,
    netMargin: 5,
    combinedRatio,
  }));
}

/** PURE — no database. A build gate that reads production is neither deterministic nor deployable,
 *  and the contract under test is a property of the code, not of today's data. */
function checkLowerIsBetter(): void {
  console.log("\n2 · lowerIsBetter CONSEQUENCE CLAUSE (synthetic general-insurance windows)");

  const cases: { name: string; fractions: number[] }[] = [
    { name: "rising", fractions: [1.012, 1.024, 1.051, 1.072] },
    { name: "falling", fractions: [1.121, 1.098, 1.045, 1.007] },
    { name: "little changed", fractions: [1.041, 1.038, 1.044, 1.042] },
  ];

  let checked = 0;
  for (const c of cases) {
    const margins = buildMargins("general_insurance", syntheticGiWindow(c.fractions));
    const s = margins?.series.find((x: { lowerIsBetter: boolean }) => x.lowerIsBetter);
    if (!s) { fail(`${c.name}: no lowerIsBetter series produced — the flag is unreachable`); continue; }
    checked++;

    // THE failure mode: a bare direction word, which a downstream renderer reads the ordinary way.
    if (!/₹100 of premium/.test(s.directionDisplay)) {
      fail(`${c.name}: directionDisplay says "${s.direction}" with no consequence clause — ${s.directionDisplay}`);
    }
    if (!s.plainDisplay || !/₹100 of premium/.test(s.plainDisplay)) {
      fail(`${c.name}: no plain-words rendering`);
    }
    // An unconverted fraction would land near 1, not near 100.
    if (s.current.value === null || s.current.value < 5) {
      fail(`${c.name}: combined ratio surfaced as ${s.current.value} — looks like an unconverted fraction`);
    }
    if (s.direction !== c.name) fail(`${c.name}: direction computed as "${s.direction}"`);
  }

  // The whole point of the flag: RISING must never be described as an improvement.
  const rising = buildMargins("general_insurance", syntheticGiWindow([1.012, 1.024, 1.051, 1.072]))
    ?.series.find((x: { lowerIsBetter: boolean }) => x.lowerIsBetter);
  if (rising && !/more of each ₹100/.test(rising.directionDisplay)) {
    fail("a RISING combined ratio does not state that MORE money is going out — the flag is decoration");
  }

  if (checked === 3 && failures === 0) {
    pass("3 lowerIsBetter series carry a consequence clause, plain words, and percent-scale values");
    pass('a rising combined ratio explicitly states "more of each ₹100" — it cannot read as improvement');
  }
}

console.log("═".repeat(96));
console.log("QUARTER IN BRIEF — VOCABULARY + lowerIsBetter GATE");
console.log("═".repeat(96));

checkVocabulary();
checkLowerIsBetter();

console.log("\n" + "─".repeat(96));
if (failures > 0) {
  console.error(`FAILED — ${failures} assertion${failures === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("PASSED — vocabulary is clear and the lowerIsBetter flag is load-bearing.");
