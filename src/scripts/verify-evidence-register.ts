// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE SEAM COPY ESCAPED THROUGH — rule-authored evidence sentences, now scanned like any other copy.
//
// ── HOW N1 GOT AWAY WITH "RELIABLY" FOR THIS LONG ─────────────────────────────────────────────────
// Family N's amendment §4.2 lists words prohibited in every field, plus the test: "if the sentence
// would read as a reason to buy when lifted out of context, rewrite it." That list was enforced on
// the authored copy modules and nowhere else.
//
// But every rule ALSO writes a sentence — `evidence.verdict` / `evidence.verbatim` — assembled inline
// next to arithmetic and reviewed as engine code rather than as copy. n1-cash-backed-earnings.ts said
// "earnings converting RELIABLY to cash", and it reached the model inside the evidence dump every
// time the finding fired. Not one copy gate could see it, because not one copy gate was pointed at
// rule files. This is that gate.
//
// ── ⚠ TWO DENY LISTS, BECAUSE §4.2 IS FAMILY N's RULE — NOT A UNIVERSAL ONE ───────────────────────
//
// The first version of this gate applied all of §4.2 to all 33 rules and immediately flagged
// r3-earnings-quality for the word "quality" — inside "Earnings quality breakdown", which is the
// finding's LOCKED SPEC NAME. Family A's own mandatory boundary line reads "a hard risk/quality
// warning to investigate". The gate was wrong, not the copy.
//
// That is the exact failure phs/verify-phs-copy.ts warns about: "a gate that mislabels a correct
// sentence trains people to edit copy until the gate shuts up — which is how §1 erodes." So:
//
//   UNIVERSAL   promotional adjectives that are a verdict wherever they appear. Wrong in any family.
//   FAMILY-N    the rest of §4.2 — words that are ordinary domain vocabulary in a risk finding
//               ("quality", "strong", "healthy") but forbidden in a CONSTRUCTIVE one, because a
//               constructive finding's failure mode is the reader reading it as a reason to buy.
//
// ── ⚠ AND THE FORWARD LIST IS NARROWED, FOR THE SAME REASON ───────────────────────────────────────
// no-forward-guard.ts's FORWARD_DENY_LIST was curated for LENS FACES — its own header says so — and
// bans the bare verbs `buy` / `sell` / `avoid`. Ownership findings describe exactly those actions as
// FACTS: "a genuine sell-down", "Promoter defense buying", "insiders sold". Scanning rule copy with
// the lens list manufactures reds on locked spec names. What is banned here is PREDICTION — the
// claim about what happens next — which is the thing §0.3 actually protects.
//
// ── SCOPE ─────────────────────────────────────────────────────────────────────────────────────────
//   IN     `verdict:` / `verbatim:` values in REGISTERED rules + the ownership persist path (R1).
//   OUT    guardrail `explanation:` — operator/audit text, not reader copy; it legitimately names
//          outcomes and thresholds. Scoping is exact where an allowlist needs upkeep forever.
//
//   npx tsx src/scripts/verify-evidence-register.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from "fs";

let fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) fail++;
};
const rule = (s: string) => console.log("\n" + "═".repeat(100) + "\n" + s + "\n" + "═".repeat(100));

/** Promotional adjectives. A verdict in ANY family, so banned everywhere. */
const UNIVERSAL_DENY: { term: string; re: RegExp; why: string }[] = [
  { term: "reliably", re: /\breliabl(y|e)\b/i, why: "a durability claim — THE N1 escape this gate exists for" },
  { term: "excellent", re: /\bexcellent\b/i, why: "promotional" },
  { term: "impressive", re: /\bimpressive\b/i, why: "promotional" },
  { term: "attractive", re: /\battractive\b/i, why: "promotional — reads as a buy case" },
  { term: "compelling", re: /\bcompelling\b/i, why: "promotional" },
  { term: "reassuring", re: /\breassuring\b/i, why: "promotional" },
  // ⚠ NOT the compound. "a robust balance sheet" is promotional; "the regime-robust tell" is a
  // property of the FINDING (it holds across market regimes), is locked File-1 copy, and appears in
  // the authored C2 verdict too. Same scoping call as "quality": ban the verdict, keep the term.
  { term: "robust", re: /(?<!regime-)\brobust\b/i, why: "promotional" },
  { term: "well-positioned", re: /\bwell[- ]positioned\b/i, why: "promotional" },
];

/** The rest of §4.2. Ordinary domain vocabulary in a RISK finding; forbidden in a CONSTRUCTIVE one. */
const N_ONLY_DENY: { term: string; re: RegExp; why: string }[] = [
  { term: "strong", re: /\bstrong(ly|er|est)?\b/i, why: "§4.2 as a verdict ('strengthened' as a described change is fine)" },
  { term: "quality", re: /\bquality\b/i, why: "§4.2 — but a legitimate domain term outside Family N" },
  { term: "healthy", re: /\bhealthy\b/i, why: "§4.2 — but a band name outside Family N" },
  { term: "solid", re: /\bsolid\b/i, why: "§4.2" },
];

/**
 * PREDICTION, not advice-vocabulary. `buy`/`sell`/`avoid` are deliberately ABSENT — see the header.
 * These are the terms that make a claim about what happens NEXT, which is what §0.3 protects.
 */
const FORWARD_DENY: { term: string; re: RegExp; why: string }[] = [
  { term: "will", re: /\bwill\b/i, why: "forecast" },
  { term: "won't", re: /\bwon['’]?t\b/i, why: "negative forecast" },
  { term: "going to", re: /\bgoing to\b/i, why: "forecast" },
  { term: "likely", re: /\blikel(y|ihood)\b/i, why: "probabilistic forecast" },
  { term: "unlikely", re: /\bunlikely\b/i, why: "probabilistic forecast" },
  { term: "expect", re: /\bexpect(s|ed|ing)?\b/i, why: "forecast" },
  { term: "anticipate", re: /\banticipat(e|es|ed|ing)\b/i, why: "forecast" },
  { term: "forecast", re: /\bforecast(s|ed|ing)?\b/i, why: "explicit prediction" },
  { term: "predict", re: /\bpredict(s|ed|ing|ion|ions)?\b/i, why: "explicit prediction" },
  { term: "soon", re: /\bsoon\b/i, why: "temporal forecast" },
  { term: "opportunity", re: /\bopportunit(y|ies)\b/i, why: "advice ('a buying opportunity')" },
  { term: "revert", re: /\brevert(s|ed|ing)?\b/i, why: "mean-reversion forecast" },
  { term: "rebound", re: /\brebound(s|ed|ing)?\b/i, why: "forecast" },
  { term: "re-rate", re: /\bre-?rat(e|es|ed|ing)\b/i, why: "forecast" },
  { term: "should", re: /\byou should\b/i, why: "instruction" },
];

const RULES_DIR = "src/scoring/findings/rules";

/** Only REGISTERED rules — a deregistered file cannot fire, so its copy cannot reach anyone. */
function registeredRuleFiles(): string[] {
  const engine = readFileSync("src/scoring/findings/engine.ts", "utf8");
  return [...engine.matchAll(/from "\.\/rules\/([a-z0-9-]+)\.js"/g)].map((m) => m[1]);
}

interface Sentence { file: string; base: string; field: string; text: string; isFamilyN: boolean }

/**
 * Pull every `verdict:` / `verbatim:` sentence out of a rule file.
 *
 * ⚠ THE VALUE IS NOT ALWAYS A STRING LITERAL. C2 and C3 pick between two sentences with a ternary;
 * B, D and G build theirs from a variable assembled above. A regex that only matched adjacent
 * template literals silently missed SIX registered rules — which the coverage assertion below caught,
 * and which is why that assertion exists. So: capture from the key to the NEXT object key or closing
 * brace, then take every template-literal body inside that span.
 */
function sentencesIn(path: string): Sentence[] {
  const src = readFileSync(path, "utf8");
  const base = path.split("/").pop() ?? path;
  const isFamilyN = /\/n\d-/.test(path);
  const out: Sentence[] = [];

  for (const field of ["verdict", "verbatim"]) {
    // Two shapes, because the rules use both: an inline `verdict:` value, and a `const verdict = …`
    // assembled above and passed by shorthand (B and D). Matching only the first silently skipped two
    // registered rules — caught by the coverage assertion, which is why that assertion runs first.
    const key = new RegExp(`^\\s*(?:const\\s+)?${field}\\s*[:=]`, "gm");
    for (const m of src.matchAll(key)) {
      const from = m.index ?? 0;
      // End at the next object key at the same-or-lower nesting, or the closing brace of the literal.
      const rest = src.slice(from + m[0].length);
      const stop = rest.search(/\n\s*(?:[a-zA-Z_$][\w$]*\s*:|\}\s*,?\s*\n)/);
      const span = stop === -1 ? rest : rest.slice(0, stop);
      const bodies = span.split("`").filter((_, i) => i % 2 === 1);
      const text = bodies.join(" ").replace(/\$\{[^}]*\}/g, " N ");
      if (text.trim()) out.push({ file: path, base, field, text, isFamilyN });
    }
  }
  // Family-N rules also carry their reader sentence through catalogue/n-family-copy.ts; the rule file
  // is the only place this gate can see, and it is the place the escape happened.
  return out;
}

async function main() {
  const registered = registeredRuleFiles();
  const files = [
    ...registered.map((f) => `${RULES_DIR}/${f}.ts`),
    "src/scoring/ownership/primary.ts", // R1 — written by the persist path, not a FireRule
  ];
  const sentences = files.flatMap(sentencesIn);

  rule("1 · COVERAGE — every registered rule's assertive sentences are in scope");
  const onDisk = readdirSync(RULES_DIR).filter((f) => f.endsWith(".ts")).length;
  console.log(`  rule files on disk: ${onDisk} · REGISTERED (scanned): ${registered.length}  + the ownership persist path (R1)`);
  console.log(`  assertive sentences extracted: ${sentences.length}  (Family N: ${sentences.filter((s) => s.isFamilyN).length})`);
  const missed = registered.filter((f) => !sentences.some((s) => s.base === `${f}.ts`));
  ok(
    "every registered rule yielded at least one sentence (the extractor is not silently skipping files)",
    missed.length === 0,
    missed.join(",") || `${registered.length}/${registered.length}`,
  );

  rule("2 · UNIVERSAL REGISTER — promotional adjectives, banned in every family");
  const uni = sentences.flatMap((s) =>
    UNIVERSAL_DENY.filter((t) => t.re.test(s.text)).map((t) => `${s.base} .${s.field}: "${s.text.match(t.re)![0]}" — ${t.why}`),
  );
  ok("ZERO promotional adjectives in any rule-authored sentence", uni.length === 0, uni.join("\n       ") || `${sentences.length} sentences · ${UNIVERSAL_DENY.length} terms`);
  const preFix = "Cash-backed earnings — operating cash flow has fully covered net profit for N straight years ( N – N ); earnings converting reliably to cash.";
  ok(
    'NEGATIVE CONTROL — the scan CATCHES N1\'s pre-fix "earnings converting reliably to cash"',
    UNIVERSAL_DENY.some((t) => t.re.test(preFix)),
    UNIVERSAL_DENY.filter((t) => t.re.test(preFix)).map((t) => t.term).join(",") || "DID NOT FIRE — the gate is dead",
  );

  rule("3 · FAMILY-N REGISTER — §4.2's remaining words, applied ONLY where they are a verdict");
  const nSentences = sentences.filter((s) => s.isFamilyN);
  const nHits = nSentences.flatMap((s) =>
    N_ONLY_DENY.filter((t) => t.re.test(s.text)).map((t) => `${s.base} .${s.field}: "${s.text.match(t.re)![0]}" — ${t.why}`),
  );
  ok("ZERO §4.2 words in any Family-N sentence", nHits.length === 0, nHits.join("\n       ") || `${nSentences.length} constructive sentences`);
  ok(
    'NEGATIVE CONTROL — it WOULD catch "a strong, healthy balance sheet" in an N rule',
    N_ONLY_DENY.filter((t) => t.re.test("a strong, healthy balance sheet")).length >= 2,
    N_ONLY_DENY.filter((t) => t.re.test("a strong, healthy balance sheet")).map((t) => t.term).join(","),
  );
  ok(
    '…and does NOT bite "Interest coverage has strengthened for N straight quarters" (§4.2 permits the change verb)',
    !N_ONLY_DENY.some((t) => t.re.test("Interest coverage has strengthened for N straight quarters, from a thin N ×.")),
    "described change, not a verdict",
  );
  // The scoping decision, asserted rather than described: "quality" is fine in a risk finding.
  ok(
    'SCOPE PROOF — "Earnings quality breakdown" passes (a locked A-family spec name, not promotion)',
    !UNIVERSAL_DENY.some((t) => t.re.test("Earnings quality breakdown — net profit has exceeded operating cash flow")),
    "risk-family domain vocabulary, deliberately not banned",
  );
  ok(
    'SCOPE PROOF — "the regime-robust tell" passes, but "a robust balance sheet" does NOT',
    !UNIVERSAL_DENY.some((t) => t.re.test("a N pt gap, the regime-robust tell")) &&
      UNIVERSAL_DENY.some((t) => t.re.test("a robust balance sheet")),
    "the compound is methodology; the bare adjective is a verdict",
  );

  rule("4 · NO PREDICTION — what happens NEXT is never claimed");
  const fwd = sentences.flatMap((s) =>
    FORWARD_DENY.filter((t) => t.re.test(s.text)).map((t) => `${s.base} .${s.field}: "${t.term}" (${t.why})`),
  );
  ok("ZERO predictive terms in any rule-authored sentence", fwd.length === 0, fwd.join("\n       ") || `${sentences.length} sentences · ${FORWARD_DENY.length} terms`);
  ok(
    'NEGATIVE CONTROL — the scan CATCHES "the gap will likely revert — a buying opportunity"',
    FORWARD_DENY.filter((t) => t.re.test("the gap will likely revert — a buying opportunity")).length >= 4,
    FORWARD_DENY.filter((t) => t.re.test("the gap will likely revert — a buying opportunity")).map((t) => t.term).join(","),
  );
  ok(
    '…and does NOT bite "a genuine sell-down" or "Promoter defense buying" (facts about what owners DID)',
    !FORWARD_DENY.some((t) => t.re.test("a genuine sell-down, not a QIP dilution")) &&
      !FORWARD_DENY.some((t) => t.re.test("Promoter defense buying — the promoter bought a net N Cr")),
    "descriptive, not predictive",
  );

  console.log(
    `\n${fail === 0 ? "✅ EVIDENCE-REGISTER GATES PASS — rule-authored copy is held to the same rules as authored copy" : `❌ ${fail} FAILURE(S)`}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
