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
//   IN     `verdict:` / `verbatim:` values in REGISTERED rules + the ownership persist path (R1) —
//          PLUS, for a rule whose file carries no such value (the D/T/S families: the authored
//          sentence lives entirely in verdicts.ts, no rule-file fallback), the sentence verdicts.ts
//          renders for that key, over EVERY branch fixture verify-verdicts.ts already exercises.
//          PLUS, for Family N specifically — whose rule file DOES carry a `verdict:`, but it is DEAD
//          on the primary surface (n-family-copy.ts's authored sentence, via VERDICTS/N_VERDICTS,
//          always wins precedence when the finding fires) — that LIVE sentence too, rendered over
//          every branch fixture AND the §8.3 missing-evidence fallback. The dead rule-file text stays
//          in scope alongside it: it still reaches the model raw (ai/grounding.ts dumps
//          triggeringValues, the rule's full evidence object, verbatim), so it is labelled, not
//          dropped.
//   OUT    guardrail `explanation:` — operator/audit text, not reader copy; it legitimately names
//          outcomes and thresholds. Scoping is exact where an allowlist needs upkeep forever.
//
// ── EXEMPTIONS ────────────────────────────────────────────────────────────────────────────────────
//   A banned term used in the OPPOSITE sense the ban targets (negation, an explicit refusal to
//   forecast) is declared in EXEMPTIONS below — keyed to the exact phrase, not the bare key or term,
//   so it cannot silently widen. Never edit copy to satisfy the gate; declare why it's exempt instead.
//
//   npx tsx src/scripts/verify-evidence-register.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from "fs";
import { VERDICTS } from "../scoring/findings/verdicts.js";
import { VERDICT_FIXTURES, type VerdictFixture } from "./lib/verdict-fixtures.js";

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

/**
 * NARROW, DECLARED, VISIBLE exemptions — never a blanket per-key or per-term skip. Each entry
 * exempts one banned-TERM match inside one EXACT PHRASE, in one finding KEY. An affirmative use of
 * the same term in the same key is a different phrase, does not match, and is NOT covered — §2/§4's
 * negative controls prove that directly.
 *
 * Reserved for cases where the term is doing the OPPOSITE of what the ban targets (negation, an
 * explicit refusal to forecast) — never for "this reads fine to me." If a second case needing this
 * for the same term ever appears, that is the trigger to reconsider negation-aware matching instead
 * of a growing exemption list; noted here rather than built now.
 */
interface Exemption { key: string; term: string; phrase: string; reason: string }
const EXEMPTIONS: Exemption[] = [
  {
    key: "divergence_S2_sticky_divergence",
    term: "reliably",
    // ⚠ THE PHRASE TRACKS THE LIVE SENTENCE, AND THE LIVE SENTENCE MOVED. S2's copy now comes from
    //   the clause table (verdicts.ts `PATTERN_CLAUSES`), whose `size` reads "…neither pillar
    //   reliably closes TOWARD THE OTHER at the next reading" — the older flat renderer said "closes
    //   THE GAP". Same negation, different words, so the exact-phrase key had to follow it or this
    //   exemption would silently stop matching and S2 would report as a violation. Re-pointing the
    //   phrase is the correct move here; editing the copy to fit the gate is the one this file's
    //   header forbids.
    phrase: "neither pillar reliably closes toward the other",
    reason: 'NEGATED, not a durability claim — the sentence says the gap does NOT reliably close. The inverse of what the ban targets.',
  },
  {
    key: "divergence_S2_sticky_divergence",
    term: "will",
    phrase: "not when it will close",
    reason: 'sits inside an explicit REFUSAL to forecast ("the model can show you that it exists, but not when it will close") — the inverse of a forecast, not an instance of one.',
  },
];

/** A deny-list hit, classified against EXEMPTIONS. `exemptedReason` is set only when the sentence's
 *  TEXT contains the exemption's exact phrase — not merely matching key + term — so an affirmative
 *  use of the same term in the same key is a miss on this check and reported as a real violation. */
interface DenyHit { s: Sentence; term: string; matched: string; why: string; exemptedReason: string | null }
function scanDenyList(scanned: Sentence[], denyList: { term: string; re: RegExp; why: string }[]): DenyHit[] {
  return scanned.flatMap((s) =>
    denyList
      .filter((t) => t.re.test(s.text))
      .map((t) => {
        const matched = s.text.match(t.re)![0];
        const exemption = EXEMPTIONS.find(
          (e) => e.key === s.key && e.term.toLowerCase() === t.term.toLowerCase() && s.text.includes(e.phrase),
        );
        return { s, term: t.term, matched, why: t.why, exemptedReason: exemption?.reason ?? null };
      }),
  );
}

const RULES_DIR = "src/scoring/findings/rules";

/** Only REGISTERED rules — a deregistered file cannot fire, so its copy cannot reach anyone. */
function registeredRuleFiles(): string[] {
  const engine = readFileSync("src/scoring/findings/engine.ts", "utf8");
  return [...engine.matchAll(/from "\.\/rules\/([a-z0-9-]+)\.js"/g)].map((m) => m[1]);
}

interface Sentence { file: string; base: string; field: string; text: string; isFamilyN: boolean; source: "rule-file" | "rendered"; key: string | null }

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
  const key = keyOf(src);
  // ⚠ For Family N, this inline text is NOT what a reader sees — n-family-copy.ts's authored verdict
  // always wins precedence (§3 below adds THAT live copy separately). It still reaches the model raw
  // though: ai/grounding.ts dumps triggeringValues (the rule's full evidence object, this field
  // included) verbatim — so it stays in scope, labelled, rather than dropped.
  const deadNote = isFamilyN ? " [dead on the primary surface — superseded by verdicts.ts; still reaches the model raw via triggeringValues]" : "";
  const out: Sentence[] = [];

  for (const field of ["verdict", "verbatim"]) {
    // Two shapes, because the rules use both: an inline `verdict:` value, and a `const verdict = …`
    // assembled above and passed by shorthand (B and D). Matching only the first silently skipped two
    // registered rules — caught by the coverage assertion, which is why that assertion runs first.
    const fieldRe = new RegExp(`^\\s*(?:const\\s+)?${field}\\s*[:=]`, "gm");
    for (const m of src.matchAll(fieldRe)) {
      const from = m.index ?? 0;
      // End at the next object key at the same-or-lower nesting, or the closing brace of the literal.
      const rest = src.slice(from + m[0].length);
      const stop = rest.search(/\n\s*(?:[a-zA-Z_$][\w$]*\s*:|\}\s*,?\s*\n)/);
      const span = stop === -1 ? rest : rest.slice(0, stop);
      const bodies = span.split("`").filter((_, i) => i % 2 === 1);
      const text = bodies.join(" ").replace(/\$\{[^}]*\}/g, " N ");
      if (text.trim()) out.push({ file: path, base, field: `${field}${deadNote}`, text, isFamilyN, source: "rule-file", key });
    }
  }
  // Family-N rules also carry their reader sentence through catalogue/n-family-copy.ts; the rule file
  // is the only place this gate can see, and it is the place the escape happened.
  return out;
}

/**
 * The finding key a rule fires. THREE shapes, because the rules genuinely use three:
 *   1. an inline literal            `key: "foundation_N1_cash_backed_earnings"`   (Family N, A, E)
 *   2. the const shorthand          `const KEY = "…"; … key: KEY`
 *   3. the CATALOGUE BINDING        `const ENTRY = STOCK_FINDINGS.<key>; … key: ENTRY.key`
 *
 * ── ⚠ SHAPE 3 IS NOT OPTIONAL, AND ITS ABSENCE WOULD SILENTLY DISARM §1 ───────────────────────────
 * Every D/S/T rule now binds its catalogue entry at the top of the file and reads `key: ENTRY.key`
 * — it hand-writes no string literal at all. Shapes 1 and 2 both look for a quoted key, so on those
 * seventeen files they match NOTHING: `key:\s*([A-Za-z_]\w*)\s*,` cannot match `key: ENTRY.key,`
 * (the `.` defeats the trailing comma). `keyOf` would return null, `centrallyRenderedSentencesFrom`
 * would return `{miss: "no-key-resolved"}` for all seventeen, and §1 would report every D/S/T rule
 * as having no sentence anywhere — on the exact families this fallback was built to cover.
 *
 * Reading `STOCK_FINDINGS.<key>` is sound rather than a guess: StockFindingRegistry maps each entry
 * to `{readonly key: K}` over its own registry key (catalogue/stock-findings.ts), so the member name
 * IS the key the rule emits, with the literal type to prove it. Each rule binds exactly one entry.
 */
function keyOf(src: string): string | null {
  const inline = src.match(/\bkey:\s*"([A-Za-z0-9_]+)"/);
  if (inline) return inline[1];
  const named = src.match(/\bkey:\s*([A-Za-z_]\w*)\s*,/);
  if (named) {
    const constDecl = src.match(new RegExp(`\\bconst\\s+${named[1]}\\s*=\\s*"([A-Za-z0-9_]+)"`));
    if (constDecl) return constDecl[1];
  }
  const bound = src.match(/\bSTOCK_FINDINGS\.([A-Za-z_$][\w$]*)/);
  return bound ? bound[1] : null;
}

type MissReason =
  | { kind: "no-key-resolved" }
  | { kind: "no-renderer"; key: string }
  | { kind: "no-fixture"; key: string }
  | { kind: "renderer-empty"; key: string; fixtures: number };

/**
 * FALLBACK for a rule whose file carries no inline `verdict:`/`verbatim:` — the D/T/S families,
 * whose authored sentence lives entirely in verdicts.ts (§ SCOPE above). Renders that sentence
 * against EVERY branch fixture verify-verdicts.ts already exercises for the key, so a phase- or
 * tier-conditional sentence is scanned on every branch, not just one.
 *
 * `verdicts`/`fixtures` are injectable so the failure classification itself can be tested in
 * isolation (§1's negative controls) without depending on the real catalogue ever landing in one
 * of these states. Returns a reason a rule ends up with NO sentence anywhere, so that fails BY
 * NAME (§1's coverage assertion) rather than being silently absorbed.
 */
function centrallyRenderedSentencesFrom(
  src: string,
  path: string,
  base: string,
  verdicts: Record<string, (ev: Record<string, unknown>) => string> = VERDICTS,
  fixtures: readonly VerdictFixture[] = VERDICT_FIXTURES,
): { sentences: Sentence[] } | { miss: MissReason } {
  const key = keyOf(src);
  if (!key) return { miss: { kind: "no-key-resolved" } };
  const renderer = verdicts[key];
  if (!renderer) return { miss: { kind: "no-renderer", key } };
  const matched = fixtures.filter((fx) => fx.key === key);
  if (matched.length === 0) return { miss: { kind: "no-fixture", key } };
  // The renderer directly, NOT the exported renderVerdict() — these 17 keys have no rule-file
  // evidence.verdict/verbatim to race against, so there is no precedence fallback to resolve, and
  // renderVerdict()'s generic last resort (guaranteed non-empty) would mask a renderer that authors
  // nothing, exactly the gap this fallback exists to catch.
  const rendered = matched
    .map((fx) => {
      let text = "";
      try {
        text = renderer(fx.evidence) ?? "";
      } catch {
        /* a renderer that throws on this fixture authors nothing to scan */
      }
      return { fx, text };
    })
    .filter((r) => r.text.trim());
  if (rendered.length === 0) return { miss: { kind: "renderer-empty", key, fixtures: matched.length } };
  return {
    sentences: rendered.map((r) => ({
      file: path,
      base,
      field: `verdict (rendered · ${r.fx.label})`,
      text: r.text,
      isFamilyN: false,
      source: "rendered",
      key,
    })),
  };
}

/**
 * Family N's live-copy fallback, run in ADDITION to (not instead of) `sentencesIn`'s inline extraction
 * — unlike the D/T/S families, N's rule file already yields a sentence (§ SCOPE), so it never trips
 * the D/T/S fallback above. But that inline sentence is dead on the primary surface (see the note in
 * `sentencesIn`); the sentence a reader actually gets is n-family-copy.ts's, via `VERDICTS[key]`
 * (spread first as `N_VERDICTS`), and THAT has never been register-scanned until now.
 *
 * Renders every VERDICT_FIXTURES branch for the key, exactly like the D/T/S fallback, PLUS the §8.3
 * missing-evidence guard explicitly (`renderer({})`) for every key — not relying on a fixture
 * happening to cover it, because two of seven currently don't (N2/N4/N5/N6/N7 have no empty-evidence
 * fixture; §8.3 covers all seven regardless).
 */
function nFamilyLiveSentencesFrom(
  src: string,
  path: string,
  base: string,
  verdicts: Record<string, (ev: Record<string, unknown>) => string> = VERDICTS,
  fixtures: readonly VerdictFixture[] = VERDICT_FIXTURES,
): Sentence[] {
  const key = keyOf(src);
  const renderer = key ? verdicts[key] : undefined;
  if (!key || !renderer) return [];

  const out: Sentence[] = [];
  for (const fx of fixtures.filter((f) => f.key === key)) {
    let text = "";
    try {
      text = renderer(fx.evidence) ?? "";
    } catch {
      /* nothing to scan */
    }
    if (text.trim()) out.push({ file: path, base, field: `verdict (LIVE · rendered · ${fx.label})`, text, isFamilyN: true, source: "rendered", key });
  }
  // §8.3 GUARD, explicitly: evidence missing → renders the static description, never "undefined".
  let fallback = "";
  try {
    fallback = renderer({}) ?? "";
  } catch {
    /* nothing to scan */
  }
  if (fallback.trim()) {
    out.push({ file: path, base, field: "verdict (LIVE · rendered · §8.3 missing-evidence fallback)", text: fallback, isFamilyN: true, source: "rendered", key });
  }
  return out;
}

function describeMiss(base: string, m: MissReason): string {
  switch (m.kind) {
    case "no-key-resolved":
      return `${base}: NO SOURCE — no rule-file verdict/verbatim, and no readable \`key:\` to look up a renderer by`;
    case "no-renderer":
      return `${base}: NO SOURCE — "${m.key}" has no rule-file verdict/verbatim and no VERDICTS["${m.key}"] renderer in verdicts.ts`;
    case "no-fixture":
      return `${base}: SOURCE FOUND BUT PRODUCED NOTHING — VERDICTS["${m.key}"] exists but no VERDICT_FIXTURES entry is keyed to "${m.key}" to render it against`;
    case "renderer-empty":
      return `${base}: SOURCE FOUND BUT PRODUCED NOTHING — VERDICTS["${m.key}"] rendered empty for all ${m.fixtures} fixture(s) keyed to it`;
  }
}

async function main() {
  const registered = registeredRuleFiles();
  const files = [
    ...registered.map((f) => `${RULES_DIR}/${f}.ts`),
    "src/scoring/ownership/primary.ts", // R1 — written by the persist path, not a FireRule
  ];

  const sentences: Sentence[] = [];
  const misses: string[] = [];
  for (const path of files) {
    const base = path.split("/").pop() ?? path;
    const isFamilyN = /\/n\d-/.test(path);
    const inline = sentencesIn(path);
    sentences.push(...inline);

    if (isFamilyN) {
      // ADDITIVE, not a fallback — N always has inline text (dead, see above), so this is the
      // separate live-copy corpus §3 needs, not a substitute for the coverage check below.
      sentences.push(...nFamilyLiveSentencesFrom(readFileSync(path, "utf8"), path, base));
      continue;
    }
    if (inline.length > 0) continue;

    const result = centrallyRenderedSentencesFrom(readFileSync(path, "utf8"), path, base);
    if ("miss" in result) misses.push(describeMiss(base, result.miss));
    else sentences.push(...result.sentences);
  }

  rule("1 · COVERAGE — every registered rule's assertive sentences are in scope");
  const onDisk = readdirSync(RULES_DIR).filter((f) => f.endsWith(".ts")).length;
  const nDeadInline = sentences.filter((s) => s.isFamilyN && s.source === "rule-file").length;
  const otherInline = sentences.filter((s) => !s.isFamilyN && s.source === "rule-file").length;
  const nLive = sentences.filter((s) => s.isFamilyN && s.source === "rendered");
  const dtsRendered = sentences.filter((s) => !s.isFamilyN && s.source === "rendered");
  console.log(`  rule files on disk: ${onDisk} · REGISTERED (scanned): ${registered.length}  + the ownership persist path (R1)`);
  console.log(
    `  assertive sentences extracted: ${sentences.length}  (rule-file, other families: ${otherInline}` +
      ` · Family N inline [dead — see §3]: ${nDeadInline}` +
      ` · Family N LIVE, rendered from verdicts.ts: ${nLive.length}` +
      ` · D/T/S rendered from verdicts.ts: ${dtsRendered.length} across ${new Set(dtsRendered.map((s) => s.base)).size} rules)`,
  );
  ok(
    "every registered rule yielded at least one sentence — from its rule file, or (D/T/S) from verdicts.ts rendered against every branch fixture",
    misses.length === 0,
    misses.join("\n       ") || `${registered.length + 1}/${registered.length + 1}`,
  );
  const N_RULE_COUNT = 7;
  const nRulesWithLiveFallback = new Set(
    nLive.filter((s) => s.field.includes("§8.3 missing-evidence fallback")).map((s) => s.base),
  ).size;
  ok(
    "all seven Family N patterns' LIVE copy (verdicts.ts, not the dead rule-file text) is scanned, including the §8.3 missing-evidence fallback branch for each",
    new Set(nLive.map((s) => s.base)).size === N_RULE_COUNT && nRulesWithLiveFallback === N_RULE_COUNT,
    `${new Set(nLive.map((s) => s.base)).size}/${N_RULE_COUNT} rules · ${nLive.length} sentences (incl. ${nRulesWithLiveFallback}/${N_RULE_COUNT} fallback branches)`,
  );
  // NEGATIVE CONTROLS — constructed directly against the classifier (synthetic source text /
  // injected maps), not by breaking a real rule file, and covering both failure shapes §1 must
  // distinguish: NO source at all, vs. a source that was found but produced nothing.
  const noKey = centrallyRenderedSentencesFrom("export const rule = () => ({ evidence: {} });", "x.ts", "x.ts");
  ok(
    'NEGATIVE CONTROL — a rule file with no `key:` at all fails "NO SOURCE", not silently',
    "miss" in noKey && noKey.miss.kind === "no-key-resolved",
    "miss" in noKey ? describeMiss("x.ts", noKey.miss) : "DID NOT FIRE — the gate is dead",
  );
  const noRenderer = centrallyRenderedSentencesFrom('key: "__ghost_finding_key_never_registered__",', "x.ts", "x.ts");
  ok(
    'NEGATIVE CONTROL — a key with no rule-file sentence AND no VERDICTS renderer fails "NO SOURCE"',
    "miss" in noRenderer && noRenderer.miss.kind === "no-renderer",
    "miss" in noRenderer ? describeMiss("x.ts", noRenderer.miss) : "DID NOT FIRE — the gate is dead",
  );
  const producedNothing = centrallyRenderedSentencesFrom(
    'key: "fake_key",',
    "x.ts",
    "x.ts",
    { fake_key: () => "" },
    [{ label: "fake", key: "fake_key", evidence: {} }],
  );
  ok(
    'NEGATIVE CONTROL — a renderer that exists but renders empty on every fixture fails "PRODUCED NOTHING", not "NO SOURCE"',
    "miss" in producedNothing && producedNothing.miss.kind === "renderer-empty",
    "miss" in producedNothing ? describeMiss("x.ts", producedNothing.miss) : "DID NOT FIRE — the gate is dead",
  );

  rule("2 · UNIVERSAL REGISTER — promotional adjectives, banned in every family");
  const uniHits = scanDenyList(sentences, UNIVERSAL_DENY);
  const uniExempted = uniHits.filter((h) => h.exemptedReason);
  const uniViolations = uniHits.filter((h) => !h.exemptedReason);
  for (const h of uniExempted) console.log(`  ⚪ EXEMPTED — ${h.s.base} .${h.s.field}: "${h.matched}" — ${h.exemptedReason}`);
  ok(
    "ZERO promotional adjectives in any rule-authored sentence, beyond declared narrow exemptions",
    uniViolations.length === 0,
    uniViolations.map((h) => `${h.s.base} .${h.s.field}: "${h.matched}" — ${h.why}`).join("\n       ") ||
      `${sentences.length} sentences · ${UNIVERSAL_DENY.length} terms${uniExempted.length ? ` · ${uniExempted.length} exempted` : ""}`,
  );
  const preFix = "Cash-backed earnings — operating cash flow has fully covered net profit for N straight years ( N – N ); earnings converting reliably to cash.";
  ok(
    'NEGATIVE CONTROL — the scan CATCHES N1\'s pre-fix "earnings converting reliably to cash"',
    UNIVERSAL_DENY.some((t) => t.re.test(preFix)),
    UNIVERSAL_DENY.filter((t) => t.re.test(preFix)).map((t) => t.term).join(",") || "DID NOT FIRE — the gate is dead",
  );
  // NEGATIVE CONTROL — the S2 exemption is narrow: it keys off the exact PHRASE, not the bare
  // key+term, so an AFFIRMATIVE "reliably" in the SAME key does not match it and still fails.
  const s2Affirmative: Sentence = {
    file: "TEST", base: "TEST (synthetic)", field: "verdict (probe)", isFamilyN: false, source: "rendered",
    key: "divergence_S2_sticky_divergence",
    text: "In this configuration the gap reliably closes at the next reading.",
  };
  const affirmativeHits = scanDenyList([s2Affirmative], UNIVERSAL_DENY).filter((h) => h.term === "reliably");
  ok(
    'NEGATIVE CONTROL — the S2 exemption does NOT leak: an AFFIRMATIVE "reliably" in the same key still fails',
    affirmativeHits.length === 1 && affirmativeHits[0].exemptedReason === null,
    affirmativeHits.length === 0
      ? "DID NOT FIRE — the gate is dead"
      : affirmativeHits[0].exemptedReason
        ? `WRONGLY EXEMPTED: ${affirmativeHits[0].exemptedReason}`
        : "correctly flagged, not exempted",
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
  const fwdHits = scanDenyList(sentences, FORWARD_DENY);
  const fwdExempted = fwdHits.filter((h) => h.exemptedReason);
  const fwdViolations = fwdHits.filter((h) => !h.exemptedReason);
  for (const h of fwdExempted) console.log(`  ⚪ EXEMPTED — ${h.s.base} .${h.s.field}: "${h.matched}" (${h.why}) — ${h.exemptedReason}`);
  ok(
    "ZERO predictive terms in any rule-authored sentence, beyond declared narrow exemptions",
    fwdViolations.length === 0,
    fwdViolations.map((h) => `${h.s.base} .${h.s.field}: "${h.matched}" (${h.why})`).join("\n       ") ||
      `${sentences.length} sentences · ${FORWARD_DENY.length} terms${fwdExempted.length ? ` · ${fwdExempted.length} exempted` : ""}`,
  );
  ok(
    'NEGATIVE CONTROL — the scan CATCHES "the gap will likely revert — a buying opportunity"',
    FORWARD_DENY.filter((t) => t.re.test("the gap will likely revert — a buying opportunity")).length >= 4,
    FORWARD_DENY.filter((t) => t.re.test("the gap will likely revert — a buying opportunity")).map((t) => t.term).join(","),
  );
  // NEGATIVE CONTROL — same leak proof as §2's, for the "will" exemption: an AFFIRMATIVE forecast
  // use of "will" in the SAME S2 key does not match the exempted phrase and still fails.
  const s2Forecast: Sentence = {
    file: "TEST", base: "TEST (synthetic)", field: "verdict (probe)", isFamilyN: false, source: "rendered",
    key: "divergence_S2_sticky_divergence",
    text: "The gap will close at the next reading.",
  };
  const forecastHits = scanDenyList([s2Forecast], FORWARD_DENY).filter((h) => h.term === "will");
  ok(
    'NEGATIVE CONTROL — the S2 exemption does NOT leak: an AFFIRMATIVE "will" (forecast) in the same key still fails',
    forecastHits.length === 1 && forecastHits[0].exemptedReason === null,
    forecastHits.length === 0
      ? "DID NOT FIRE — the gate is dead"
      : forecastHits[0].exemptedReason
        ? `WRONGLY EXEMPTED: ${forecastHits[0].exemptedReason}`
        : "correctly flagged, not exempted",
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
