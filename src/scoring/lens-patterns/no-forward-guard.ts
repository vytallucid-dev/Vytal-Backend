// File: src/scoring/lens-patterns/no-forward-guard.ts
//
// THE NO-FORWARD-LANGUAGE GUARD (companion in spirit to definition-guard.ts).
//
// §0.3 / §6 are the load-bearing constraint of the whole library: a lens pattern
// describes what the disagreement IS; it NEVER states what happens NEXT. The instant
// a string says "…and therefore it will revert," "…a buying opportunity," "…momentum
// will return," it has smuggled in a forward claim and ceased to be definitional.
//
// This guard asserts that every ASSERTIVE emitted face — label + Read + field-verdict
// — contains NO predictive/advisory language. Because the catalog strings are verbatim-
// from-databank, it passes trivially today; the guard is the RECURRENCE protection for
// any FUTURE string (a new pattern, an edited Read). It FAILS LOUD if violated.
//
// SCOPE (deliberate): the "Doesn't-mean" face is the disclaimer that NEGATES forward
// language by construction ("not a forecast that it continues", "not a buy") and so
// legitimately contains words like "will"/"buy"/"recovers". It is OUT OF SCOPE — the
// guard protects the faces that ASSERT (label/read/verdict), per the briefing
// ("every generated/emitted label + verdict + Read string").
//
// PURE. No DB, no I/O.

import { LM_CATALOG, LP_CATALOG, type CatalogFace } from "./catalog.js";

/**
 * Deny-list of predictive / advisory tokens. Each entry is a word-boundary,
 * case-insensitive regex so it matches the WORD, not substrings inside benign words
 * (e.g. \bhold\b does NOT fire on "peak-and-hold" being intended — but note we keep
 * advice-only words tight). The list is curated so the verbatim ASSERTIVE faces pass.
 */
export const FORWARD_DENY_LIST: { term: string; re: RegExp; why: string }[] = [
  { term: "will", re: /\bwill\b/i, why: "forecast ('will revert', 'momentum will return')" },
  { term: "won't", re: /\bwon['’]?t\b/i, why: "negative forecast" },
  { term: "going to", re: /\bgoing to\b/i, why: "forecast" },
  { term: "likely", re: /\blikely\b/i, why: "probabilistic forecast" },
  { term: "unlikely", re: /\bunlikely\b/i, why: "probabilistic forecast" },
  { term: "expect", re: /\bexpect(s|ed|ing)?\b/i, why: "forecast" },
  { term: "anticipate", re: /\banticipat(e|es|ed|ing)\b/i, why: "forecast" },
  { term: "forecast", re: /\bforecast(s|ed|ing)?\b/i, why: "explicit prediction" },
  { term: "predict", re: /\bpredict(s|ed|ing|ion|ions)?\b/i, why: "explicit prediction" },
  { term: "soon", re: /\bsoon\b/i, why: "temporal forecast" },
  { term: "opportunity", re: /\bopportunit(y|ies)\b/i, why: "advice ('buying opportunity')" },
  { term: "buy", re: /\bbuy(s|ing)?\b/i, why: "advice" },
  { term: "sell", re: /\bsell(s|ing)?\b/i, why: "advice" },
  { term: "avoid", re: /\bavoid(s|ed|ing)?\b/i, why: "advice" },
  { term: "revert", re: /\brevert(s|ed|ing)?\b/i, why: "mean-reversion forecast" },
  { term: "rebound", re: /\brebound(s|ed|ing)?\b/i, why: "forecast" },
  { term: "re-rate", re: /\bre-?rat(e|es|ed|ing)\b/i, why: "forecast ('re-rate as the cycle turns')" },
  { term: "recover-forecast", re: /\b(will|going to)\s+recover/i, why: "recovery as forecast" },
  { term: "momentum-will", re: /\bmomentum\s+will\b/i, why: "'momentum will return' forecast" },
  // NB: bare "recover/recovery", "improving", "momentum", "hold" are NOT denied —
  // they are descriptive (Family-D's name, present-tense trend, "peak-and-hold").
];

/**
 * (Construction v2 Stage 9) THE PORTFOLIO ADVICE VOCABULARY — the verbs §1 forbids in a PF finding's
 * Read, on top of FORWARD_DENY_LIST above.
 *
 * ONE HOME FOR THE RULE, TWO HOMES FOR THE VOCABULARY — and the split is deliberate, not a compromise.
 * The RULE (scan the assertive faces, deny-list of word-boundary regexes, fail loud) lives once, here,
 * and the portfolio reuses it via `scanStringsForForwardLanguage`. A second portfolio-side grep would be
 * two homes for one rule. But the VOCABULARIES genuinely differ: `"reduced margins"` is DESCRIPTIVE in a
 * stock Read and would false-positive on a shared `\breduce\b`, so judging LM/LP strings by portfolio
 * verbs would manufacture reds that train people to ignore the guard.
 *
 * SCOPE, NOT AN ALLOWLIST — the same reasoning as the header's: a `doesntMean` NEGATES advice by
 * construction ("≠ trim it", "≠ it will fall"), so it legitimately contains every forbidden verb. It is
 * OUT OF SCOPE. Scoping is exact where an allowlist is a guess that needs maintaining forever, and a
 * missed entry is a false red. Scan what ASSERTS (`read`, `storyClause`); never the negation.
 */
export const PORTFOLIO_ADVICE_DENY_LIST: { term: string; re: RegExp; why: string }[] = [
  { term: "trim", re: /\btrim(s|med|ming)?\b/i, why: "advice ('consider trimming')" },
  { term: "reduce", re: /\breduc(e|es|ed|ing)\b/i, why: "advice ('reduce the position')" },
  { term: "switch", re: /\bswitch(es|ed|ing)?\b/i, why: "advice ('switch to Direct')" },
  { term: "consider", re: /\bconsider(s|ed|ing)?\b/i, why: "advice — the politest instruction is still one" },
  { term: "rebalance", re: /\brebalanc(e|es|ed|ing)\b/i, why: "advice" },
  { term: "should", re: /\bshould(n['’]?t)?\b/i, why: "instruction" },
  { term: "increase", re: /\bincreas(e|es|ed|ing)\b/i, why: "advice ('increase your debt allocation')" },
  { term: "exit", re: /\bexit(s|ed|ing)?\b/i, why: "advice" },
  { term: "diversify", re: /\bdiversif(y|ies|ied|ying)\b/i, why: "advice — the verb form; 'diversification' the noun is descriptive" },
  { term: "add", re: /\badd\s+(more|to\s+your|a\s+few)\b/i, why: "advice ('add more names')" },
  { term: "need to", re: /\bneed(s)?\s+to\b/i, why: "instruction" },
  { term: "ought", re: /\bought\b/i, why: "instruction" },
  { term: "recommend", re: /\brecommend(s|ed|ation|ations|ing)?\b/i, why: "advice, by name" },
  { term: "too-adjective", re: /\btoo\s+(concentrated|risky|heavy|narrow|many|few|much|little)\b/i, why: "judgment ('38% is too concentrated')" },
];

export interface ForwardViolation {
  id: string;
  face: "label" | "read" | "fieldVerdict";
  term: string;
  why: string;
  text: string;
}

/** Scan one face object's assertive strings. */
function scanFace(f: CatalogFace): ForwardViolation[] {
  const out: ForwardViolation[] = [];
  const targets: { face: "label" | "read" | "fieldVerdict"; text: string }[] = [
    { face: "label", text: f.label },
    { face: "read", text: f.read },
    { face: "fieldVerdict", text: f.fieldVerdict ?? "" },
  ];
  for (const t of targets) {
    for (const d of FORWARD_DENY_LIST) {
      if (d.re.test(t.text)) out.push({ id: f.id, face: t.face, term: d.term, why: d.why, text: t.text });
    }
  }
  return out;
}

/** Scan the WHOLE catalog (LM + LP). Returns every violation (empty = clean). */
export function scanCatalogForForwardLanguage(): ForwardViolation[] {
  const out: ForwardViolation[] = [];
  for (const f of Object.values(LM_CATALOG)) out.push(...scanFace(f));
  for (const f of Object.values(LP_CATALOG)) out.push(...scanFace(f));
  return out;
}

/** Scan arbitrary assertive strings (for runtime-emitted text, future surfaces).
 *  `extraTerms` appends a caller-specific vocabulary to the shared forward list — the portfolio passes
 *  PORTFOLIO_ADVICE_DENY_LIST. Pass ONLY strings that ASSERT: a `doesntMean` negates by construction and
 *  must never be handed to this function. */
export function scanStringsForForwardLanguage(
  id: string,
  strings: string[],
  extraTerms: { term: string; re: RegExp; why: string }[] = [],
): ForwardViolation[] {
  const out: ForwardViolation[] = [];
  const list = [...FORWARD_DENY_LIST, ...extraTerms];
  for (const s of strings) {
    for (const d of list) {
      if (d.re.test(s)) out.push({ id, face: "read", term: d.term, why: d.why, text: s });
    }
  }
  return out;
}

/** FAIL-LOUD assertion. Throws if any assertive face carries forward/advisory language. */
export function assertNoForwardLanguage(): void {
  const v = scanCatalogForForwardLanguage();
  if (v.length > 0) {
    const lines = v.map((x) => `  ✗ ${x.id}.${x.face}: forbidden "${x.term}" (${x.why}) in: "${x.text}"`);
    throw new Error(
      `NO-FORWARD-LANGUAGE GUARD FAILED — ${v.length} violation(s):\n${lines.join("\n")}\n` +
        `Lens patterns are DEFINITIONAL (§0.3): they describe what the disagreement IS, never what happens NEXT.`,
    );
  }
}
