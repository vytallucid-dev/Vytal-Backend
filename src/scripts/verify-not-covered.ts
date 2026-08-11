// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE NOT-COVERED GATE — the absolute rule, enforced.
//
// ── ★ NEVER QUOTE THE EXCLUDED MEASUREMENT ───────────────────────────────────────────────────────
// Every one of these ten configurations has a measured figure in its spec, and every one is dangerous
// in a reader's hands. "Foundation crossing down through 72" measured **+16.9%** (HOT +24.9%). Put
// that on screen beside a bearish-looking event and you have handed the user a bullish number for it
// — which is the precise harm the exclusion exists to prevent. The figure is WHY it is excluded; it
// is not a fact to share.
//
// So: no n, no hit-rate, no effect size, anywhere in this copy. This gate asserts it rather than
// trusting review to catch it, because the failure is silent — a correct-looking sentence with one
// number in it.
//
// ── ★ AND NEITHER IS THE SIGN, IN WORDS (this turn's addition) ──────────────────────────────────
// The number ban alone left the DIRECTION expressible without a digit — "this tested bullish" carries
// the same harm as "+16.9%" with no figure in it at all. Banned word-for-word, same reasoning as the
// figure ban: the failure is a correct-looking sentence, and review alone will not reliably catch it.
//
// It also asserts the SEPARATION: not-covered ids must not collide with finding keys, and the
// registry must not have leaked into STOCK_FINDINGS or PATTERN_KEYS — and, new this turn, that the
// persisted `notcovered_*` namespace is excluded at every read boundary that touches score_patterns.
//
// PURE. No DB.
//   npx tsx src/scripts/verify-not-covered.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import {
  NOT_COVERED,
  NOT_COVERED_IDS,
  NOT_COVERED_RECORDS,

  NOT_COVERED_AUTHORITATIVE_TABLE,
  NOT_COVERED_SILENT_LINE,
  isNotCoveredKey,
  dropNotCoveredPatterns,
  notCoveredKeysSqlPredicate,
  notCoveredPatternKey,
} from "../catalogue/not-covered.js";
import { STOCK_FINDING_KEYS } from "../catalogue/index.js";
import { PATTERN_KEYS } from "../catalogue/pattern-facts.js";
import { notCoveredFor, type SubjectReadings } from "../scoring/read/not-covered.service.js";
import { notCoveredFirings } from "../scoring/findings/not-covered-eval.js";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

/**
 * ★ THE BANS. Narrow and specific — each targets a SHAPE a return figure takes, not "digits", because
 * the copy legitimately contains none today and a blanket digit ban would be untestable against the
 * thing it exists to stop.
 */
const RETURN_FIGURE_BANS: readonly { re: RegExp; what: string }[] = [
  { re: /[-+−]?\d+(?:\.\d+)?\s*%/, what: "a percentage — an effect size or hit rate" },
  { re: /\bn\s*=\s*\d+/i, what: "a sample size" },
  { re: /\b\d+\s*\/\s*10\b/, what: "a hit rate as x-in-ten" },
  { re: /\b\d+(?:\.\d+)?\s*(?:bps|basis points)\b/i, what: "an effect size in basis points" },
  { re: /\b(?:returned|measured|read|tested)\s+[-+−]?\d/i, what: "a measured figure stated numerically" },
  { re: /\b\d+(?:\.\d+)?\s*(?:percent|pct)\b/i, what: "a percentage, spelled" },
];

/**
 * ★ THE WORD-LEVEL BANS (this turn). A direction word carries the same harm as a figure with none of
 * the digits — "this tested bullish" is exactly the backwards-reading signal the exclusion exists to
 * prevent, stated in English instead of arithmetic. Word-boundary matched, case-insensitive.
 */
const DIRECTION_WORD_BANS: readonly string[] = [
  "bullish", "bearish", "positive", "negative", "outperform", "underperform",
  "gained", "fell", "rose", "dropped", "upside", "downside",
];
const DIRECTION_WORD_RE = new RegExp(`\\b(${DIRECTION_WORD_BANS.join("|")})\\b`, "i");

function scanReturnFigures(text: string): { what: string; matched: string }[] {
  const out: { what: string; matched: string }[] = [];
  for (const b of RETURN_FIGURE_BANS) {
    const m = b.re.exec(text);
    if (m) out.push({ what: b.what, matched: m[0] });
  }
  return out;
}

function scanDirectionWords(text: string): string | null {
  const m = DIRECTION_WORD_RE.exec(text);
  return m ? m[0] : null;
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("0 · ★ THE TRIGGER↔REASON MAPPING, AGAINST THE AUTHORITATIVE TABLE — mechanically, not by eyeball");
  const mappingLeaks: string[] = [];
  ok("the authoritative table has exactly 10 rows, one per id", NOT_COVERED_AUTHORITATIVE_TABLE.length === 10, `${NOT_COVERED_AUTHORITATIVE_TABLE.length}`);
  for (const row of NOT_COVERED_AUTHORITATIVE_TABLE) {
    const r = NOT_COVERED[row.id];
    if (!r) { mappingLeaks.push(`${row.id}: no record in the registry`); continue; }
    if (r.reason !== row.reason) mappingLeaks.push(`${row.id}: registry reason "${r.reason}" ≠ authoritative "${row.reason}"`);
  }
  ok("every record's reason matches the authoritative table's row for its id", mappingLeaks.length === 0, mappingLeaks.join(" · ") || "10/10 match");

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("1 · ★ THE ABSOLUTE RULE — no measured figure, no direction word, in any not-covered copy");
  const leaks: string[] = [];
  const wordLeaks: string[] = [];
  for (const r of NOT_COVERED_RECORDS) {
    for (const v of scanReturnFigures(r.copy)) leaks.push(`${r.id}: ${v.what} — "${v.matched}"`);
    const w = scanDirectionWords(r.copy);
    if (w) wordLeaks.push(`${r.id}: direction word "${w}"`);
  }
  ok(
    "no percentage, sample size, hit rate or effect size in any record's copy",
    leaks.length === 0,
    leaks.join(" · ") || `${NOT_COVERED_RECORDS.length} records, clean`,
  );
  ok(
    "no direction word (bullish/bearish/positive/negative/…) in any record's copy",
    wordLeaks.length === 0,
    wordLeaks.join(" · ") || `${NOT_COVERED_RECORDS.length} records, clean`,
  );

  // …and the same over what actually reaches the wire, which is copy + closing joined.
  const wireLeaks: string[] = [];
  const wireWordLeaks: string[] = [];
  const probe: SubjectReadings = { composite: 60, foundation: 80, momentum: 40, market: 30, ownership: 55 };
  const prior: SubjectReadings = { composite: 70, foundation: 80, momentum: 50, market: 30, ownership: 55 };
  for (const note of notCoveredFor(probe, prior)) {
    for (const v of scanReturnFigures(note.text)) wireLeaks.push(`${note.id}: ${v.what} — "${v.matched}"`);
    const w = scanDirectionWords(note.text);
    if (w) wireWordLeaks.push(`${note.id}: direction word "${w}"`);
  }
  ok("…and none in the assembled wire text either (copy + closing, as a reader receives it)", wireLeaks.length === 0, wireLeaks.join(" · ") || "assembled text clean");
  ok("…and no direction word in the assembled wire text either", wireWordLeaks.length === 0, wireWordLeaks.join(" · ") || "assembled text clean");

  // NEGATIVE CONTROLS — each ban bites the figure/word it exists to stop. Figures are the REAL
  // excluded measurements from the two specs; the direction words are planted separately.
  ok("NEGATIVE CONTROL — '+16.9% (HOT +24.9%)' IS caught", scanReturnFigures("this measured +16.9% (HOT +24.9%)").length > 0, "caught");
  ok("NEGATIVE CONTROL — 'n=365' IS caught", scanReturnFigures("across n=365 cases").length > 0, "caught");
  ok("NEGATIVE CONTROL — '7/10 fell' IS caught", scanReturnFigures("7/10 fell").length > 0, "caught");
  ok(
    "…and the real copy is NOT caught (the figure bans discriminate)",
    scanReturnFigures(NOT_COVERED.NC6.copy).length === 0,
    "NC6 clean",
  );
  // ★ THE PLANTED WORD — the exact scenario the report asks to see: a direction word inserted into
  //   copy that otherwise reads clean, and the gate catching it.
  const plantedBullish = `${NOT_COVERED.NC6.copy} This configuration tested bullish overall.`;
  ok(
    "NEGATIVE CONTROL — a planted direction word ('tested bullish overall') IS caught",
    scanDirectionWords(plantedBullish) === "bullish",
    scanDirectionWords(plantedBullish) ?? "NOT CAUGHT",
  );
  ok("…and NC6's real copy alone is NOT caught (the word bans discriminate)", scanDirectionWords(NOT_COVERED.NC6.copy) === null, "NC6 clean");

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("2 · ★ SEPARATION — this registry is not the finding catalogue, and its persisted namespace is excluded everywhere");
  const asFindingKeys = NOT_COVERED_IDS.filter((id) => (STOCK_FINDING_KEYS as readonly string[]).includes(id));
  ok("no not-covered id is a stock-finding key", asFindingKeys.length === 0, asFindingKeys.join(",") || "disjoint");
  const asPatternKeys = NOT_COVERED_IDS.filter((id) => (PATTERN_KEYS as readonly string[]).includes(id));
  ok("no not-covered id is a pattern key (so none can carry PatternFacts)", asPatternKeys.length === 0, asPatternKeys.join(",") || "disjoint");
  ok(
    "every record carries the tested_not_shipped basis, and only that",
    NOT_COVERED_RECORDS.every((r) => r.evidenceBasis === "tested_not_shipped"),
    `${NOT_COVERED_RECORDS.length}/${NOT_COVERED_IDS.length}`,
  );
  // ⚠ COUNTED FROM THE REGISTRY, NOT AGAINST A LITERAL. This asserted `=== 10` on both sides, so adding
  //   NC11 (the coalesced two-band slip) failed a gate that was checking arithmetic rather than the
  //   invariant. The invariant is TOTALITY — every declared id has a record and nothing else does — and
  //   that is what is checked now, so the next id costs no gate edit.
  ok(
    "every declared id has a record, and the registry holds no others",
    NOT_COVERED_RECORDS.length === NOT_COVERED_IDS.length &&
      NOT_COVERED_IDS.every((id) => NOT_COVERED[id]?.id === id),
    `${NOT_COVERED_RECORDS.length} ids, all resolved`,
  );

  // ★ THE PERSISTED-KEY NAMESPACE — notCoveredPatternKey / isNotCoveredKey / dropNotCoveredPatterns /
  //   notCoveredKeysSqlPredicate, the helpers every read boundary must use.
  ok(
    "notCoveredPatternKey round-trips through isNotCoveredKey for every id",
    NOT_COVERED_IDS.every((id) => isNotCoveredKey(notCoveredPatternKey(id))),
    `${NOT_COVERED_IDS.length}/${NOT_COVERED_IDS.length}`,
  );
  ok(
    "a real finding key is NOT caught by isNotCoveredKey (the prefix test discriminates)",
    !isNotCoveredKey("divergence_S2_sticky_divergence") && !isNotCoveredKey("trajectory_D_T7_momentum_improving_while_weak"),
    "discriminates",
  );
  const synthetic = [
    { patternKey: "divergence_S2_sticky_divergence" },
    { patternKey: notCoveredPatternKey("NC1") },
    { patternKey: "trajectory_D_T7_momentum_improving_while_weak" },
    { patternKey: notCoveredPatternKey("NC7") },
  ];
  const dropped = dropNotCoveredPatterns(synthetic);
  ok(
    "dropNotCoveredPatterns removes exactly the notcovered_ rows from a mixed set",
    dropped.length === 2 && dropped.every((r) => !isNotCoveredKey(r.patternKey)),
    `${dropped.length}/4 survive: ${dropped.map((r) => r.patternKey).join(", ")}`,
  );
  const sqlPred = notCoveredKeysSqlPredicate("p.pattern_key");
  ok(
    "notCoveredKeysSqlPredicate produces a NOT LIKE fragment on the declared prefix",
    sqlPred === "p.pattern_key NOT LIKE 'notcovered_%'",
    sqlPred,
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("3 · ★ NO SEVERITY FIELD, EVER — NO SIZE OR ORDERING IN COPY. THE 41-POINT TRAP.");
  //
  // ⚠ REVISED THIS TURN. `pair`/`lifecycle` are now DELIBERATELY present (chart-parity data — Part 3
  // of the task) and are not banned; `severity` remains banned STRUCTURALLY — it must not exist as a
  // key on the object at all, not even as null. The 41-point trap is now enforced at the COPY layer
  // (§1 above) and by this severity-field check, not by banning every numeric-shaped field.
  const notes = notCoveredFor(probe, prior);
  const severityLeaks: string[] = [];
  for (const n of notes) {
    if ("severity" in (n as unknown as Record<string, unknown>)) severityLeaks.push(`${n.id} carries a "severity" key`);
  }
  ok(
    "no note carries a severity field — not present, not null",
    severityLeaks.length === 0,
    severityLeaks.join(" · ") || `${notes.length} notes: no severity key at all`,
  );
  ok(
    "readings carry a subject and a value, and nothing derived from the pair",
    notes.every((n) => n.readings.every((r) => Object.keys(r).length === 2 && "subject" in r && "value" in r)),
    "subject+value only",
  );
  // The chart-parity fields ARE present where the record has two real pillars (NC1/NC2), and the
  // COPY still never states the gap that `pair.gap` carries as data.
  const withPair = notes.filter((n) => n.pair !== null);
  ok(
    "NC1 (two real pillars) carries a pair for chart parity",
    notes.find((n) => n.id === "NC1")?.pair !== null,
    JSON.stringify(notes.find((n) => n.id === "NC1")?.pair ?? null),
  );
  const gapInCopy: string[] = [];
  for (const n of withPair) {
    const gapStr = String(n.pair!.gap);
    if (n.text.includes(`${gapStr} apart`) || n.text.includes(`${gapStr}-point`)) {
      gapInCopy.push(`${n.id}: gap "${gapStr}" appears to be stated in copy`);
    }
  }
  ok("the gap carried in `pair` is never stated in `text` (data, not prose)", gapInCopy.length === 0, gapInCopy.join(" · ") || `${withPair.length} two-pillar notes clean`);
  ok(
    "single-subject records (NC3–NC10) carry pair: null — no pillar pair to draw",
    notes.filter((n) => ["NC3", "NC4", "NC5", "NC6", "NC7", "NC8", "NC9", "NC10"].includes(n.id)).every((n) => n.pair === null),
    "null for all single-subject matches",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("4 · TRIGGERS — a reading that merely SITS past a mark has not crossed it");
  //
  // The crossing convention is the specs' own. Getting it wrong would fire these on most of the
  // universe, which is the catch-all failure the generic-spread exclusion is about.
  const sits: SubjectReadings = { composite: 50, foundation: 50, momentum: 50, market: 50, ownership: 50 };
  const sitsPrior: SubjectReadings = { composite: 50, foundation: 50, momentum: 50, market: 50, ownership: 50 };
  const stationary = notCoveredFor(sits, sitsPrior).filter((n) => n.id !== "NC1");
  ok(
    "a stock whose readings did not move matches NO crossing record",
    stationary.length === 0,
    stationary.map((n) => n.id).join(",") || "none — sitting past a mark is not crossing it",
  );
  const noPrior = notCoveredFor(sits, null).filter((n) => n.id !== "NC1");
  ok(
    "…and neither does a stock with no prior reading (nothing has crossed anything)",
    noPrior.length === 0,
    noPrior.map((n) => n.id).join(",") || "none",
  );
  // A real crossing DOES match — otherwise the two assertions above pass vacuously.
  const crossed = notCoveredFor({ ...sits, foundation: 59 }, { ...sitsPrior, foundation: 61 });
  ok(
    "POSITIVE CONTROL — Foundation 61 → 59 DOES match NC5 (crosses down through 60)",
    crossed.some((n) => n.id === "NC5"),
    crossed.map((n) => n.id).join(",") || "NOTHING MATCHED",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("5 · ★ THE MATCH ENGINE — notCoveredFor (read) and notCoveredFirings (persist) never disagree");
  //
  // The two entry points share one match function (findings/not-covered-eval.ts). This asserts they
  // report the SAME ids for the SAME readings — if they ever drift, a stock could show a note the
  // persisted row disagrees with, or vice versa.
  const readIds = notCoveredFor(probe, prior).map((n) => n.id).sort();
  const writeIds = notCoveredFirings(probe, prior).map((f) => f.id).sort();
  ok(
    "notCoveredFor and notCoveredFirings report identical id sets for the same readings",
    JSON.stringify(readIds) === JSON.stringify(writeIds),
    `read=${readIds.join(",")} write=${writeIds.join(",")}`,
  );
  ok(
    "notCoveredFirings carries the raw triggering numbers not-covered.service.ts's wire shape omits",
    notCoveredFirings(probe, prior).every((f) => f.triggerDetail !== undefined),
    "triggerDetail present on every firing",
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  rule("6 · THE NOTE DESCRIBES THE STOCK, NOT US — no first-person account of our own testing");
  //
  // ★ THE CLOSING LINES ARE GONE, AND SO IS `closeVariant`. Both closings ("Tested and not shipped.
  //   We'd rather tell you we have nothing…" / "Tested, and replaced by a sharper version…") were
  //   statements about our process, and each record's copy opened with more of the same. A note exists
  //   to describe a company; narrating our testing puts the model in the frame in the one place where
  //   we have least to say. This asserts the removal rather than trusting it.
  const SELF_NARRATION = /\b(?:we tested|we don't ship|we can't stand behind|this tested|in testing|our sample|we report the one|tested and not shipped|we'd rather|we have measured|we cannot reproduce)\b/i;
  const selfLeaks = NOT_COVERED_RECORDS.filter((r) => SELF_NARRATION.test(r.copy)).map((r) => r.id);
  ok(
    "no record's copy narrates our own testing",
    selfLeaks.length === 0,
    selfLeaks.join(",") || `${NOT_COVERED_RECORDS.length} records describe the stock only`,
  );
  ok(
    "NEGATIVE CONTROL — a planted 'We tested this configuration twice' IS caught",
    SELF_NARRATION.test("We tested this configuration twice and the runs disagreed."),
    "caught",
  );
  ok(
    "no record's text carries an appended closing line (the two shared closings are deleted)",
    notCoveredFor(probe, prior).every((n) => n.text === NOT_COVERED[n.id].copy),
    "text === copy, verbatim",
  );
  ok(
    "the registry exposes no closeVariant field on any record",
    NOT_COVERED_RECORDS.every((r) => !("closeVariant" in (r as unknown as Record<string, unknown>))),
    "field removed",
  );
  ok("NOT_COVERED_SILENT_LINE is non-empty and carries no measured figure or direction word", NOT_COVERED_SILENT_LINE.length > 0 && scanReturnFigures(NOT_COVERED_SILENT_LINE).length === 0 && scanDirectionWords(NOT_COVERED_SILENT_LINE) === null, NOT_COVERED_SILENT_LINE);

  console.log(`\n${fail === 0 ? "✅ NOT-COVERED GATES PASS — no measured figure, no direction word, no severity field, registry separate, persisted namespace excluded everywhere" : `❌ ${fail} FAILURE(S)`}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
