// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE COPY REGISTER GATE — the four rules that govern every word a D/S/T card shows a reader.
//
// ── ★ 1 · SPEAK IN PILLARS, NEVER IN PRICE ───────────────────────────────────────────────────────
// The model measures four pillars. It has never measured a return, so it cannot make a claim about
// one. "The price fell" is a return claim; "the Market pillar came back toward Foundation" is the
// observation that was actually available. The distinction is not pedantry — a card that says the
// price fell is making a promise the model has no instrument for.
//
// ── ★ 2 · THE TYPICAL CASE, NEVER THE AVERAGE ────────────────────────────────────────────────────
// Permitted: "more often than not", "in most of these", "has tended to". Prohibited: "on average",
// "typically returned", "mean", and every other central-tendency phrasing.
//
// ⚠ T9 IS WHY THIS RULE EXISTS AND IS NOT A STYLE PREFERENCE. Its measured mean is +0.6% — mildly
// POSITIVE — while roughly two-thirds of cases fell. The mean is dragged by a few large winners, so a
// sentence written from it tells the reader the opposite of what the study found. Prose written from
// the hit-rate cannot express a mean, and must not try.
//
// ── ★ 3 · NO FIGURES ON A CARD ───────────────────────────────────────────────────────────────────
// No n, no hit-rate, no effect size in any D/S/T verdict. `evidenceStats` keeps all three on the
// record for the education layer; the card carries the pattern's declared `confidence` register
// instead ("consistently" vs "in the few cases of this we have"), which is the only honest way to
// convey the strength of a small sample.
//
// ── ★ 4 · NO ADVISORY LANGUAGE ANYWHERE ──────────────────────────────────────────────────────────
// "watch", "worth investigating", "keep an eye", "consider", "monitor". Implied urgency is
// instruction in descriptive clothing: a reader told a condition is "worth watching" has been told to
// act, whether or not a verb was used.
//
// ⚠ AND THIS IS NOT A EUPHEMISM EXERCISE. A sentence engineered to imply "go look" while dodging the
// banned words has breached the guard, not satisfied it. The word list is the floor of the rule, not
// its definition — it catches the careless case; the careful one is a review question.
//
// PURE. No DB.
//   npx tsx src/scripts/verify-copy-register.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { PATTERN_KEYS, PATTERN_FACTS, type PatternKey } from "../catalogue/pattern-facts.js";
import { NOT_COVERED_RECORDS, NOT_COVERED_SILENT_LINE } from "../catalogue/not-covered.js";
import { composeVerdict } from "../scoring/findings/verdicts.js";
import { doesntMean } from "../catalogue/index.js";
import { scanForwardLanguage } from "../scoring/findings/trajectory/regime-tier.js";
import { REGIME_EVIDENCE_KEY } from "../scoring/regime/regime.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

// ── the bans ───────────────────────────────────────────────────────────────────────────────────────

/** Rule 1 + rule 2 — a price OUTCOME, or a central tendency. */
const OUTCOME_BANS: readonly { re: RegExp; why: string }[] = [
  { re: /\bon average\b/i, why: "rule 2 — central tendency; the mean is outlier-dragged" },
  { re: /\baverage\b/i, why: "rule 2 — central tendency" },
  { re: /\bmean (?:return|of|was|is)\b/i, why: "rule 2 — central tendency" },
  { re: /\btypically returned\b/i, why: "rule 2 — central tendency, and a return claim" },
  { re: /\bexpect\b/i, why: "rule 1 — a forecast, not an observation" },
  { re: /\bwill (?:rise|fall)\b/i, why: "rule 1 — a forecast about a price" },
  { re: /\bprice (?:rose|fell)\b/i, why: "rule 1 — a return claim; the model measures pillars" },
  { re: /\breturned\s*[-+−]/i, why: "rule 1/3 — a quoted return figure" },
];

/** Rule 3 — a study figure of any shape. */
const FIGURE_BANS: readonly { re: RegExp; why: string }[] = [
  { re: /[-+−]?\d+(?:\.\d+)?\s*%/, why: "rule 3 — a percentage (effect size or hit rate)" },
  { re: /\bn\s*=\s*\d+/i, why: "rule 3 — a sample size" },
  { re: /\b\d+(?:\.\d+)?\s*(?:percent|pct)\b/i, why: "rule 3 — a percentage, spelled" },
];

/** Rule 4 — advisory / implied instruction. */
const ADVISORY_BANS: readonly { re: RegExp; why: string }[] = [
  // ⚠ THE INFLECTIONS MATTER. `\bwatch\b` alone does not match "worth watching" — the word boundary
  //   falls after "watch", not after "watching" — so the most natural way to write the banned thing
  //   sailed straight through. Caught by this gate's own negative control, which is why it has one.
  { re: /\bwatch(?:es|ing|ed)?\b/i, why: "rule 4 — an instruction (incl. 'worth watching')" },
  { re: /\bkeep an eye\b/i, why: "rule 4 — an instruction" },
  { re: /\bbe aware\b/i, why: "rule 4 — an instruction" },
  { re: /\bnote that\b/i, why: "rule 4 — an instruction" },
  { re: /\bworth investigating\b/i, why: "rule 4 — an instruction" },
  { re: /\bshould look\b/i, why: "rule 4 — an instruction" },
  { re: /\bconsider\b/i, why: "rule 4 — an instruction" },
  { re: /\bmonitor\b/i, why: "rule 4 — an instruction" },
];

const ALL_BANS = [...OUTCOME_BANS, ...FIGURE_BANS, ...ADVISORY_BANS];

function scan(text: string): { why: string; matched: string }[] {
  const out: { why: string; matched: string }[] = [];
  for (const b of ALL_BANS) {
    const m = b.re.exec(text);
    if (m) out.push({ why: b.why, matched: m[0] });
  }
  for (const f of scanForwardLanguage(text)) out.push({ why: `${f.rule} — ${f.why}`, matched: f.matched });
  return out;
}

/**
 * ★ EVERY STRING A D/S/T CARD CAN SHOW, for one pattern.
 *
 * ⚠ THE SWEEP MUST COVER THE BRANCHES, NOT JUST THE DEFAULT RENDER. Formed and Building are different
 * sentences, and T3's phase variants are three more. Composing once with one evidence blob would scan
 * whichever branch happened to be taken and pass while a sibling branch carried the violation.
 */
function everyRenderOf(key: PatternKey): { label: string; text: string }[] {
  const base: Record<string, unknown> = {
    foundation: 41.2, momentum: 27.4, market: 78.9, ownership: 63.1,
    gapPp: 37.7, tierWord: "extreme", strong: true,
    regimeTier: PATTERN_FACTS[key].regimeMap.HOT === "no_directional_read" ? "decides_read" : "always_display",
    regimeReadPhases: ["NORMAL", "STRESSED"],
  };
  const out: { label: string; text: string }[] = [];
  const variants: [string, Record<string, unknown>][] = [
    ["formed", { ...base, state: "formed" }],
    ["building/material", { ...base, state: "building", tierWord: "material" }],
    ["building/stretched", { ...base, state: "building", tierWord: "stretched" }],
    ["building/extreme", { ...base, state: "building", tierWord: "extreme" }],
    ["phase:HOT", { ...base, state: "formed", [REGIME_EVIDENCE_KEY]: { regime: "HOT" } }],
    ["phase:NORMAL", { ...base, state: "formed", [REGIME_EVIDENCE_KEY]: { regime: "NORMAL" } }],
    ["phase:STRESSED", { ...base, state: "formed", [REGIME_EVIDENCE_KEY]: { regime: "STRESSED" } }],
    ["phase:unknown", { ...base, state: "formed" }],
  ];
  for (const [label, ev] of variants) {
    for (const c of composeVerdict(key, ev, null).clauses) {
      out.push({ label: `${key} [${label}/${c.type}]`, text: c.text });
    }
  }
  const b = doesntMean(key);
  if (b) out.push({ label: `${key} [boundary]`, text: b });
  return out;
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · ★ NO PRICE OUTCOME, NO CENTRAL TENDENCY, NO FIGURE, NO ADVISORY — every D/S/T render");
  const leaks: string[] = [];
  let rendered = 0;
  for (const key of PATTERN_KEYS) {
    for (const r of everyRenderOf(key)) {
      rendered++;
      for (const v of scan(r.text)) leaks.push(`${r.label}: ${v.why} — "${v.matched}"`);
    }
  }
  ok(
    `every rendered D/S/T clause and boundary is clean (${rendered} strings across ${PATTERN_KEYS.length} patterns × 8 branches)`,
    leaks.length === 0,
    leaks.slice(0, 8).join(" · ") || "clean",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · ★ THE SAME RULES OVER THE NOT-COVERED REGISTRY AND THE SILENT LINE");
  const ncLeaks: string[] = [];
  for (const r of NOT_COVERED_RECORDS) {
    for (const v of scan(r.copy)) ncLeaks.push(`${r.id}: ${v.why} — "${v.matched}"`);
  }
  for (const v of scan(NOT_COVERED_SILENT_LINE)) ncLeaks.push(`SILENT_LINE: ${v.why} — "${v.matched}"`);
  ok("all ten not-covered records and the silent line are clean", ncLeaks.length === 0, ncLeaks.join(" · ") || "11 strings, clean");

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · ★ NEGATIVE CONTROLS — each ban bites the sentence it exists to stop");
  //
  // Without these the gate could pass by matching nothing at all, which is the failure mode a copy
  // lint is most prone to: a regex that is subtly wrong is indistinguishable from clean copy.
  const controls: [string, string][] = [
    ["a planted 'on average' (rule 2)", "On average this configuration recovered within two quarters."],
    ["a planted 'worth watching' (rule 4)", "A condition worth watching over the next few readings."],
    ["a planted 'worth investigating' (rule 4)", "An inflection worth investigating before the next print."],
    ["a planted 'the price fell' (rule 1)", "In most of these the price fell afterwards."],
    ["a planted 'typically returned' (rule 2)", "This configuration typically returned less than its peers."],
    ["a planted 'n=79' (rule 3)", "Direction inherited from the combined test (n=79)."],
    ["a planted '+5.8%' (rule 3)", "Measured at 15 days, this configuration read +5.8% positive."],
    ["a planted 'you're early' (existing R3 forward-language scan)", "Momentum is turning — you're early."],
  ];
  for (const [label, text] of controls) ok(`NEGATIVE CONTROL — ${label} IS caught`, scan(text).length > 0, "caught");
  ok(
    "…and the shipped copy is NOT caught (the bans discriminate)",
    scan("More often than not it has been the Market pillar that moved.").length === 0 &&
      scan("In the few cases of this we have, Foundation has tended to weaken in the readings that followed.").length === 0,
    "both registers clean",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // The reader can no longer see n, so the register carries it. This asserts the field exists and is
  // one of the three values — it does NOT assert which vocabulary each pattern's prose uses, because
  // the ruled copy does not map one-to-one onto the register table (see the build report).
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ THE REGISTER-VOCABULARY GATE — the copy must speak in the register its record declares. ★★
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠ THIS WAS DELIBERATELY SKIPPED ONCE AND THAT WAS THE ERROR. The reasoning was "the shipped copy
  // would fail it" — which is the argument FOR the gate, not against it. It failed on exactly two
  // patterns and both were real defects: D3 (`directional`) spoke in the robust register, overstating
  // a handful of cases; T6 (`robust`) spoke in the directional register, understating measured
  // evidence. Both are invisible to review precisely because the sentences read well.
  //
  // ★ WHY THE STAKES ARE HIGHER THAN THEY LOOK. Since the figures were stripped from cards, the
  // register is the reader's ONLY signal of how much evidence stands behind a claim. A mismatch is not
  // a tone slip — it is the one thing `confidence` exists to communicate, communicated wrongly, with
  // no n on screen to contradict it.
  //
  // ⚠ SILENCE IS PERMITTED, MIXING IS NOT. Several patterns' ruled copy carries no register phrase at
  // all (D6, T4, T7, S2, and T3's non-HOT variant). That is not a violation — a sentence that makes no
  // strength claim needs no strength vocabulary. What is forbidden is speaking in the WRONG one.
  rule("4 · ★ THE REGISTER-VOCABULARY GATE — robust copy speaks robust, directional speaks directional");

  const REGISTER_VOCAB: Readonly<Record<"robust" | "directional", readonly RegExp[]>> = {
    robust: [/\bconsistently\b/i, /\bin most of these\b/i, /\bin most cases of this\b/i, /\bmore often than not\b/i],
    directional: [/\bin the few cases of this we have\b/i, /\bha(?:s|ve) tended to\b/i, /\bonly a handful of cases\b/i],
  };
  const hits = (text: string, reg: "robust" | "directional"): string[] =>
    REGISTER_VOCAB[reg].map((re) => re.exec(text)?.[0]).filter((m): m is string => !!m);

  /** The FORMED claim-bearing copy for one pattern — observation + size, which is where a register
   *  phrase can legitimately appear. Building and boundary text are checked separately below. */
  const formedCopyOf = (key: PatternKey, phase: string | null): string => {
    const ev: Record<string, unknown> = {
      state: "formed", foundation: 41.2, momentum: 27.4, market: 78.9, ownership: 63.1,
      gapPp: 37.7, tierWord: "extreme", strong: true,
      regimeTier: "decides_read", regimeReadPhases: ["NORMAL", "STRESSED"],
      ...(phase ? { [REGIME_EVIDENCE_KEY]: { regime: phase } } : {}),
    };
    return composeVerdict(key, ev, null).clauses
      .filter((c) => c.type === "observation" || c.type === "size")
      .map((c) => c.text)
      .join(" ");
  };

  const mismatches: string[] = [];
  const silent: string[] = [];
  for (const key of PATTERN_KEYS) {
    const mine = PATTERN_FACTS[key].confidence as "robust" | "directional";
    const other = mine === "robust" ? "directional" : "robust";
    // Every phase branch — T3's HOT variant carries a register its calm variant does not.
    let sawOwn = false;
    for (const phase of [null, "HOT", "NORMAL", "STRESSED"]) {
      const text = formedCopyOf(key, phase);
      const wrong = hits(text, other);
      if (wrong.length) mismatches.push(`${key} declares ${mine} but says "${wrong[0]}" (${other} register)`);
      if (hits(text, mine).length) sawOwn = true;
    }
    if (!sawOwn) silent.push(key);
  }
  ok(
    "no pattern's copy speaks in a register other than the one its record declares",
    mismatches.length === 0,
    mismatches.join(" · ") || `${PATTERN_KEYS.length} patterns, every branch`,
  );
  console.log(`     carry no register phrase at all (permitted — the copy makes no strength claim): ${silent.join(", ") || "none"}`);

  // ── `described` — Building instances and the not-covered registry. NEITHER register may appear. ──
  //
  // ⚠ ONLY PATTERNS THAT CAN ACTUALLY BE BUILDING ARE PROBED. Just D1–D4 stamp a state; the crossings
  //   and movements never do (pattern-state.ts), so forcing `state: "building"` onto T6 renders a
  //   sentence no stock can ever see and then judges it. The first run of this gate did exactly that
  //   and reported T6's legitimate robust register as a `described` violation — a false positive
  //   invented by the probe. A pattern HAS a Building branch iff its observation actually differs
  //   between the two states, which is detected here rather than kept as a key list to drift.
  const hasBuildingBranch = (key: PatternKey): boolean => {
    const ev = { foundation: 41.2, momentum: 27.4, market: 78.9, gapPp: 37.7, tierWord: "extreme" };
    const obs = (state: string) =>
      composeVerdict(key, { ...ev, state }, null).clauses.find((c) => c.type === "observation")?.text ?? "";
    return obs("building") !== obs("formed");
  };
  const buildingKeys = PATTERN_KEYS.filter(hasBuildingBranch);
  const describedLeaks: string[] = [];
  for (const key of buildingKeys) {
    for (const tierWord of ["material", "stretched", "extreme"]) {
      const text = composeVerdict(key, { state: "building", tierWord, foundation: 41.2, momentum: 27.4, market: 78.9, gapPp: 37.7 }, null)
        .clauses.filter((c) => c.type !== "boundary").map((c) => c.text).join(" ");
      for (const reg of ["robust", "directional"] as const) {
        for (const m of hits(text, reg)) describedLeaks.push(`${key} BUILDING/${tierWord}: "${m}" (${reg})`);
      }
    }
  }
  for (const r of NOT_COVERED_RECORDS) {
    for (const reg of ["robust", "directional"] as const) {
      for (const m of hits(r.copy, reg)) describedLeaks.push(`${r.id}: "${m}" (${reg})`);
    }
  }
  ok(
    "`described` copy (every Building render + all ten not-covered records) carries NEITHER register",
    describedLeaks.length === 0,
    describedLeaks.slice(0, 5).join(" · ") || "no strength vocabulary where nothing was measured",
  );

  // ── NEGATIVE CONTROLS — a deliberately mismatched register in each direction. ──
  const d1 = "More often than not it has been the Market pillar that moved.";
  const d4 = "In the few cases of this we have, Foundation has tended to weaken in the readings that followed.";
  ok(
    "NEGATIVE CONTROL — robust copy carrying the DIRECTIONAL register IS caught",
    hits("This has tended to close within a quarter.", "directional").length > 0,
    'caught "has tended to" against a robust record',
  );
  ok(
    "NEGATIVE CONTROL — directional copy carrying the ROBUST register IS caught",
    hits("In most cases of this, the Market pillar strengthened.", "robust").length > 0,
    'caught "In most cases of this" against a directional record',
  );
  ok(
    "…and each shipped line matches its OWN record's register, not the other",
    hits(d1, "robust").length > 0 && hits(d1, "directional").length === 0 &&
      hits(d4, "directional").length > 0 && hits(d4, "robust").length === 0,
    "D1 robust-only · D4 directional-only",
  );

  rule("5 · ★ THE CONFIDENCE REGISTER IS DECLARED ON EVERY PATTERN");
  const VALID = ["robust", "directional", "described"];
  const missing = PATTERN_KEYS.filter((k) => !VALID.includes(PATTERN_FACTS[k].confidence));
  ok("every pattern declares a confidence in {robust, directional, described}", missing.length === 0, missing.join(",") || `${PATTERN_KEYS.length}/${PATTERN_KEYS.length}`);
  ok(
    "no STATIC record declares `described` — it is the register of a Building instance and of the not-covered registry, both runtime facts",
    PATTERN_KEYS.every((k) => (PATTERN_FACTS[k].confidence as string) !== "described"),
    "0 static `described`",
  );
  const robust = PATTERN_KEYS.filter((k) => PATTERN_FACTS[k].confidence === "robust");
  console.log(`     robust (${robust.length}) · directional (${PATTERN_KEYS.length - robust.length})`);

  console.log(`\n${fail === 0 ? "✅ COPY REGISTER GATES PASS — pillars not price, typical case not average, no figures, no advisory" : `❌ ${fail} FAILURE(S)`}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
