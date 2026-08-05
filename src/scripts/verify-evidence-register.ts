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
// ── ⚠ COVERAGE, TAUGHT TO READ verdicts.ts ────────────────────────────────────────────────────────
// §1's coverage check used to assume every registered rule's sentence lived IN THE RULE FILE — true
// when this gate was built, false since Stage 3 centralised the D/S/T families' sentences into
// scoring/findings/verdicts.ts, keyed by the finding key each rule now reads from the catalogue
// (`key: ENTRY.key`). A D/S/T rule that composes no `verdict:`/`verbatim:` of its own is not a
// coverage gap; its sentence moved one file over. §1 now checks THERE before failing.
//
// ⚠ DELIBERATELY NOT MERGED INTO THE SHARED `sentences` ARRAY. §2/§3/§4's register scans keep running
// over rule-file sentences only, exactly as before — verdicts.ts is a DIFFERENT, ALREADY-VERIFIED
// render layer (verify-verdicts.ts is its gate), and folding its text into this scan would silently
// widen what §2–§4 assert without anyone deciding they should. §1's coverage question ("does a
// sentence exist for this rule") and §2–§4's register question ("is a rule-authored sentence clean")
// are answered from two different sources on purpose.
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

/** A rule's own finding key, read the same way it reads it at runtime: `STOCK_FINDINGS.<key>` member
 *  access (the compile-time catalogue binding every D/S/T rule now uses). null for a rule with no
 *  such access — the pre-binding shape, where `sentencesIn` already finds its sentence directly. */
function keyOfRuleFile(path: string): string | null {
  const src = readFileSync(path, "utf8");
  const m = /\bSTOCK_FINDINGS\.([A-Za-z_$][\w$]*)/.exec(src);
  return m ? m[1] : null;
}

/**
 * Does this finding key resolve a sentence in verdicts.ts? Reads the file as TEXT — same discipline as
 * sentencesIn() — rather than importing verdicts.ts as a module, so this gate stays a pure text scan
 * with no runtime coupling to the render layer's shape.
 *
 * ── ⚠ THE SPAN IS BRACE-BALANCED, NOT KEY-TO-NEXT-KEY, AND THAT CHANGED FOR A REASON ─────────────
 * The original heuristic ran from the key to the next `identifier:` line. That was correct while every
 * entry was a flat one-liner. The D/S/T sentences now live in `PATTERN_CLAUSES`, whose entries are
 * NESTED objects (`key: (ev) => ({ observation: \`…\`, size: \`…\` })`) — so the "next identifier:"
 * was `observation:`, the span collapsed to `(ev) => ({`, and all sixteen D/S/T rules reported as
 * having no sentence anywhere. The gate was right that something had moved and wrong about where to.
 *
 * Balancing brackets finds the entry's true extent regardless of how deeply the sentence is nested,
 * which is a property of the language rather than of the current formatting — so the next reshuffle
 * of this table does not fail the gate again.
 */
function hasVerdictsSentence(key: string): boolean {
  const src = readFileSync("src/scoring/findings/verdicts.ts", "utf8");
  // A key may appear in more than one table (the clause table AND the projection map). ANY occurrence
  // that resolves a template literal counts — the question is "does a sentence exist for this key".
  const re = new RegExp(`^[ \\t]*${key}\\s*:`, "gm");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    let depth = 0;
    let span = "";
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") {
        if (depth === 0) break; // closed the enclosing object — entry ends here
        depth--;
      } else if (c === "," && depth === 0) break; // end of this entry
      span += c;
    }
    // ⚠ A PLAIN STRING COUNTS, NOT ONLY A TEMPLATE LITERAL. This used to test `span.includes("\`")`,
    //   which was right only while every verdict interpolated a number. Once the figures were stripped
    //   from the D/T copy most of those sentences became ordinary double-quoted strings, and eleven
    //   registered rules were reported as yielding NO sentence when each had simply stopped needing an
    //   interpolation. The question this function asks is "does a sentence exist for this key" — the
    //   quote style is not part of that question.
    if (span.includes("`") || span.includes('"')) return true;
  }
  return false;
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
  // ★ CENTRALISED SENTENCES — see the header. A rule that composes nothing of its own is a real miss
  // ONLY if its key ALSO resolves nothing in verdicts.ts; otherwise the sentence moved, not vanished.
  const stillMissed = missed.filter((f) => {
    const key = keyOfRuleFile(`${RULES_DIR}/${f}.ts`);
    return !key || !hasVerdictsSentence(key);
  });
  const centralised = missed.filter((f) => !stillMissed.includes(f));
  if (centralised.length) {
    console.log(`  sentence lives in verdicts.ts, not the rule file (Stage 3 centralisation): ${centralised.join(", ")}`);
  }
  ok(
    "every registered rule yielded at least one sentence, in its own file OR in verdicts.ts (the extractor is not silently skipping files)",
    stillMissed.length === 0,
    stillMissed.join(",") || `${registered.length}/${registered.length}`,
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
