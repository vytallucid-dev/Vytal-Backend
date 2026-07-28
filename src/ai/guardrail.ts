// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE AI OUTPUT GUARDRAIL (Layer 1) — the structural backstop behind the non-advisory spine.
//
// tone.ts INSTRUCTS the model not to advise. This CATCHES it when the model does anyway — which is not
// a hypothetical: we run on Flash-Lite, the weaker instruction-follower, precisely because its RPD is
// what makes the feature affordable. An instruction is a request; this is a gate.
//
// PURE + DETERMINISTIC + FREE. No AI call, no DB, no I/O, no network. It costs nothing to run, which is
// the whole reason it can run on EVERY generated explanation. (The regeneration, the deterministic
// fallback and the offline AI judge are Layers 2–4 and live with the generation flow, not here.)
//
// ── ⚠ WHY THIS IS NOT A FLAT REUSE OF `no-forward-guard.ts`'s LISTS ───────────────────────────────
//
// That guard exists and works, and this file REUSES ITS SCANNING MECHANISM rather than reimplementing
// it (`scanStringsForForwardLanguage`). But its VOCABULARIES were calibrated against 31 hand-written
// catalog strings, where a human wrote each sentence once and the guard is recurrence protection — its
// own header says it "passes trivially today". Free-form model prose is a completely different
// distribution, and a flat reuse fails in BOTH directions:
//
//   · FALSE POSITIVES, at a rate that would kill the feature. `\bwill\b`, `\bshould\b`, `\bexpect\b`,
//     `\breduce\b`, `\bincrease\b` are unavoidable in ordinary descriptive finance prose — "results
//     WILL be reported in October", "margins REDUCED 200bps", "promoter pledging INCREASED to 12%".
//     Blocking those blocks the truth.
//   · FALSE NEGATIVES, on the constructions that matter most. Hedged advice uses none of the banned
//     verbs: "it might be worth…", "the obvious next step is to…", "many investors would…". The
//     existing lists catch not one of them.
//
// So the vocabulary is TIERED and AI-surface-specific, on ONE organizing principle:
//
//   ★ HARD = THE MODEL SPEAKING IN ITS OWN VOICE AS AN ADVISER.  → block
//   ★ SOFT = WORDS THAT LEGITIMATELY APPEAR WHILE DESCRIBING THE WORLD.  → log, NEVER block
//
// That principle is what makes the split decidable instead of a vibes-based word list, and it settles
// the genuinely hard cases by itself:
//   "the brokerage recommends a target of ₹4,000"  → describing someone else's advice   → SOFT
//   "my recommendation is to hold"                 → the model advising                 → HARD
//   "the company will buy back shares"             → description                        → SOFT
//   "worth buying at these levels"                 → advice                             → HARD
//
// ── THE ASYMMETRY THAT SETS THE TUNING (deliberate, ruled) ────────────────────────────────────────
// When in doubt, PASS. A false block hits every user who asks and replaces a true explanation with
// nothing; a miss is caught by the offline judge over a cache of a few hundred rows. The costs are not
// symmetric, so neither is the tuning. This list is deliberately NOT exhaustive — chasing every
// possible phrasing is how a guard starts blocking innocent description, and a guard that cries wolf
// is one people route around. A known gap that a later layer covers beats a guard nobody trusts.
//
// ── SCOPE, NOT AN ALLOWLIST (inherited doctrine — no-forward-guard.ts §"SCOPE, NOT AN ALLOWLIST") ──
// ⚠ Hand this ONLY text that ASSERTS. A negation ("this does NOT mean you should sell") contains every
// forbidden construction by design and would trip the gate — correctly, which is why it must never be
// scanned rather than allow-listed around. Today an explanation is a single assertive body, so the
// doctrine is satisfied trivially. THE DAY a "what this doesn't mean" section is added to the output,
// it must be excluded here, exactly as `doesntMean` is excluded from the portfolio copy scan.
//
// ── ⚠ THIS FILE IS ENGLISH-ONLY BY DESIGN; THE OTHER LANGUAGES LIVE NEXT DOOR ──────────────────────
// `AI_HARD_LIST` / `AI_SOFT_EXTRA` below are the ENGLISH vocabulary and are deliberately left exactly
// as they were. Hinglish + Devanagari vocabulary is guardrail-hinglish.ts, merged into the scan at
// `AI_HARD_ALL` / `AI_SOFT_ALL`. Two reasons for the split rather than more entries here: that file
// needs a script-boundary discipline this one does not (`\b` is DEAD on Devanagari — measured, see its
// FINDING #1), and keeping the English arrays untouched is what makes "the English tier is unaffected"
// provable by inspection rather than by re-reading a merged list.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import {
  FORWARD_DENY_LIST,
  scanStringsForForwardLanguage,
} from "../scoring/lens-patterns/no-forward-guard.js";
import { AI_HARD_LIST_HI, AI_SOFT_EXTRA_HI } from "./guardrail-hinglish.js";

/** A vocabulary entry — the same shape `scanStringsForForwardLanguage` takes as `extraTerms`. */
interface Term {
  term: string;
  re: RegExp;
  why: string;
}

// ── HARD — the model advising in its own voice. A match BLOCKS. ──────────────────────────────────
//
// Two families. The first is blatant; the second is the one that actually earns this file's existence,
// because the spine instruction is most often defeated by advice that never uses an advice verb.
//
// ⚠ EVERY `term` NAME HERE MUST BE DISTINCT FROM `FORWARD_DENY_LIST`'s NAMES — the scanner merges that
// list into every call unconditionally, and tier assignment is BY NAME (see scanExplanationText).
// A collision would silently promote a shared soft term to a blocker. Asserted at module load below.
export const AI_HARD_LIST: Term[] = [
  // ── Family 1: blatant — an instruction addressed to the reader, or the model's own recommendation ──
  {
    term: "addressed-should",
    re: /\b(you|investors?|shareholders?|one)\s+(should|must|ought\s+to|needs?\s+to)\b/i,
    why: "instruction addressed to the reader",
  },
  {
    term: "i-recommend",
    re: /\bi\s+(recommend|suggest|advise)\b/i,
    why: "the model recommending in its own voice",
  },
  {
    term: "we-recommend",
    re: /\bwe\s+(recommend|suggest|advise)\b/i,
    why: "Vytal recommending in its own voice",
  },
  {
    term: "my-recommendation",
    re: /\b(my|our)\s+(recommendation|advice|suggestion)\b/i,
    why: "the model's own advice, by name",
  },
  {
    term: "would-advise",
    re: /\bwould\s+(advise|recommend|suggest)\b/i,
    why: "advice in the conditional",
  },
  {
    term: "consider-action",
    re: /\bconsider(ing)?\s+(trimming|selling|buying|reducing|exiting|adding|switching|rebalancing|diversifying)\b/i,
    why: "advice — the politest instruction is still one",
  },
  {
    term: "trade-this",
    re: /\b(buy|sell|dump|offload)\s+(this|the|your)\s+(stock|share|position|holding)\b/i,
    why: "a trade instruction on a specific holding",
  },
  {
    term: "trade-now",
    re: /\b(buy|sell)\s+(it\s+)?now\b/i,
    why: "a timed trade instruction",
  },
  {
    term: "worth-trading",
    re: /\bworth\s+(buying|selling|adding|trimming)\b/i,
    why: "advice ('worth buying at these levels')",
  },
  {
    term: "time-to-trade",
    re: /\btime\s+to\s+(buy|sell|exit|enter)\b/i,
    why: "market timing advice",
  },
  {
    term: "recommended-action",
    re: /\brecommended\s+(action|move|step)\b/i,
    why: "advice, by name",
  },

  // ── Family 2: HEDGED — advice wearing none of the banned verbs. The reason this file exists. ──
  {
    term: "might-be-worth",
    re: /\bit\s+(might|may|could)\s+be\s+worth\b/i,
    why: "hedged advice ('it might be worth trimming')",
  },
  {
    term: "next-step-to",
    re: /\bnext\s+step\s+(is|would\s+be)\s+to\b/i,
    why: "hedged advice ('the obvious next step is to exit')",
  },
  {
    term: "you-may-want",
    re: /\byou\s+(may|might|could)\s+want\s+to\b/i,
    why: "hedged instruction",
  },
  {
    term: "youll-want",
    re: /\byou['’]ll\s+want\s+to\b/i,
    why: "instruction in the future tense",
  },
  {
    term: "would-be-prudent",
    re: /\bit\s+would\s+be\s+(prudent|wise|sensible|advisable)\b/i,
    why: "hedged advice",
  },
  {
    term: "worth-watching",
    re: /\bworth\s+(keeping|watching|monitoring)\b/i,
    why: "hedged advice ('worth keeping an eye on')",
  },
  { term: "keep-an-eye", re: /\bkeep\s+an\s+eye\s+on\b/i, why: "advice idiom" },
  {
    term: "something-to",
    re: /\bsomething\s+to\s+(watch|consider|think\s+about|keep\s+in\s+mind)\b/i,
    why: "hedged advice",
  },
  {
    term: "closer-look",
    re: /\b(takes?|taking|warrants?|deserves?)\s+a\s+closer\s+look\b/i,
    why: "hedged advice",
  },
  {
    term: "if-youre-looking",
    re: /\bif\s+you(['’]re|\s+are)\s+(looking|planning|thinking)\s+to\b/i,
    why: "conditional advice",
  },
  {
    term: "be-cautious",
    re: /\bbe\s+(cautious|careful|wary)\b/i,
    why: "instruction framed as caution",
  },
  {
    term: "makes-sense-to",
    re: /\bmakes?\s+sense\s+to\b/i,
    why: "hedged advice",
  },
  {
    term: "takeaway-is-to",
    re: /\btakeaway\s+(here\s+)?is\s+to\b/i,
    why: "advice as conclusion",
  },
  {
    term: "before-you-trade",
    re: /\bbefore\s+you\s+(buy|invest|add|sell)\b/i,
    why: "advice presuming a trade",
  },
  /**
   * ⚠ ON PROBATION (operator ruling) — social-proof framing is one of the most common ways advice gets
   * past a spine instruction ("many investors would trim here"), so it earns a HARD slot. But it sits
   * one word away from legitimate DESCRIPTION of shareholder behaviour ("many investors hold this for
   * the dividend"), which must pass.
   *
   * The separation is the modal: this fires on would/will/might/tend-to/often — the SPECULATIVE
   * framings — and NOT on a plain present-tense verb, which is what description uses. Both cases are
   * pinned in verify-ai-guardrail.ts; if the innocent one ever trips, this entry is demoted to SOFT.
   */
  {
    term: "many-investors-would",
    re: /\b(many|most|some)\s+(investors?|holders?|people)\s+(would|will|might|tend\s+to|often)\b/i,
    why: "advice via social proof ('many investors would trim here')",
  },
];

// ══ HARD-CONDITIONAL — PRICE TARGETS AND FORECAST NUMBERS. Blocks UNLESS the sentence attributes it. ══
//
// ★ WHY A THIRD TIER EXISTS AT ALL. The two tiers above split on "who is speaking": the model advising
// (HARD) vs a word that description legitimately needs (SOFT). A price target does not fit either, because
// the SAME NUMBER is fine or fatal depending on one thing — whether the sentence says whose number it is:
//
//   "the brokerage set a target of ₹635"   → description of someone else's call   → must PASS
//   "the target is ₹635"                   → Vytal relaying a forecast as fact    → must BLOCK
//
// The construction is identical; only the attributed subject differs. So the tier is CONDITIONAL: the
// pattern below fires on the CONSTRUCTION, and a second test on the sentence that contains it decides
// whether it blocks. A hit that IS attributed is demoted to a soft hit (logged, never blocking).
//
// ⚠ WHY THIS SHIPS NOW, WITH THE WEB-NEWS TOOL AND NOT AFTER IT. `AI_HARD_LIST` above catches the model
// ADVISING; it has no pattern for the model FORECASTING, because until now nothing in the context window
// contained a forecast. getStockNews changes that: the very first live Serper run surfaced the headline
// "Hold Cyient DLM; target of Rs 635: Prabhudas Lilladher." The moment external headlines reach the model,
// a price target is one paraphrase away from being stated in Vytal's own voice.
//
// ── LIMITS, STATED (regex cannot parse "who said it"; this approximates it) ────────────────────────────
//   · The attribution test is LEXICAL: a named source, an attributing verb/preposition, or a possessive.
//     A sentence that attributes by pronoun alone ("they see ₹700") reads as unattributed and BLOCKS —
//     deliberately, since a pronoun is exactly how an attribution gets lost in a paraphrase.
//   · Attribution is checked across the WHOLE sentence, not just before the number, so a trailing
//     headline-style attribution ("target of Rs 635: Prabhudas Lilladher") passes.
//   · A first-word proper noun cannot be distinguished from a capitalised sentence opener, so common
//     openers are stop-listed.
//   · ★ "has" IS NOT AN ATTRIBUTING VERB, and that ruling costs something. "Prabhudas Lilladher has a
//     target of Rs 635" reads as unattributed and BLOCKS, because "Cyient DLM has a target of Rs 635" —
//     the live headline with its source paraphrased away — is the same shape, and nothing in the sentence
//     distinguishes a brokerage from a company. The tier keeps the block and the model keeps every other
//     attributed construction ("X set a target", "according to X", "per X's note").
//   · The same ruling applies to the possessive: "X's call/note/estimate/view/rating" attributes, but
//     "X's target" does NOT — a company has targets too, so that shape stays blocked.
//   · A BUSINESS target is never fired on at all: a magnitude unit after the amount (crore/lakh/bn/mn)
//     means revenue or capex, not a share price. That carve-out is checked on the text AFTER the match
//     rather than as a lookahead, because a lookahead lets the engine backtrack the number to dodge it
//     (measured: /₹[\d,]+(?!\s*crore)/ happily matches "₹5,00" of "₹5,000 crore").
//   · Sentence splitting is on . ! ? and newlines; a semicolon deliberately does NOT split, because that
//     is where headline attributions live.
export const AI_TARGET_LIST: Term[] = [
  {
    term: "target-price-phrase",
    re: /\b(target\s+price|price\s+target)\b/i,
    why: "a price target — a forecast of what the share should be worth",
  },
  {
    // "target of ₹635" / "target at Rs 635" / "the target is ₹635"
    term: "target-of-amount",
    re: /\btargets?\s+(?:of|at|is|was|to|stands\s+at|sits\s+at|remains)\s*(?:₹|rs\.?|inr)\s*[\d,]+(?:\.\d+)?/i,
    why: "a rupee price target",
  },
  {
    term: "sees-amount",
    re: /\b(sees?|expects?|projects?|pegs?|values?)\s+(?:the\s+)?(?:stock|share|shares|it|this)?\s*(?:at\s+|reaching\s+|hitting\s+)?(?:₹|rs\.?|inr)\s*[\d,]+(?:\.\d+)?/i,
    why: "a forecast price for the share",
  },
  {
    term: "upside-downside-of",
    re: /\b(upside|downside)\s+(?:of|to)\s+(?:about\s+|around\s+|nearly\s+|over\s+)?(?:₹|rs\.?|inr)?\s*[\d,]+(?:\.\d+)?\s*%?/i,
    why: "a quantified move-from-here — a forecast, not a fact",
  },
  {
    term: "target-move",
    re: /\b(raised|cut|lowered|slashed|hiked|maintained|reiterated|retained)\s+(?:its|their|the)?\s*(?:price\s+)?target\b/i,
    why: "a change to a price target",
  },
  {
    term: "target-move-passive",
    re: /\btargets?\s+(?:price\s+)?(?:was|were|has\s+been|have\s+been|been)\s+(raised|cut|lowered|slashed|hiked|revised|upgraded|downgraded)\b/i,
    why: "a change to a price target, in the passive",
  },
];

/** Terms whose amount could be a BUSINESS figure. A magnitude unit right after the match means revenue or
 *  capex, not a share price — checked on the following text, never as a lookahead (see the header). */
const UNIT_SENSITIVE = new Set(["target-of-amount", "sees-amount", "upside-downside-of"]);
const MAGNITUDE_TAIL = /^\s*(?:crore|cr\b|lakh|lakhs|billion|bn\b|million|mn\b|trillion|tn\b)/i;

/**
 * The attribution vocabulary — what makes a forecast someone ELSE'S. Any one match in the sentence is
 * enough; the test is deliberately generous, because the asymmetry here runs the same way as the file's
 * (a false block replaces the truth with nothing, and the news tool's own header already orders the model
 * to attribute every external claim).
 */
const ATTRIBUTION_STOP_OPENERS =
  "The|This|That|These|Those|It|Its|A|An|And|But|Our|Their|They|We|I|You|Your|There|Here|Vytal|If|When|While|As|At|In|On|For";

const ATTRIBUTION_RES: RegExp[] = [
  // explicit attributing prepositions / reporting frames
  /\b(according to|as reported by|as per|per|via|citing|cited by|quoted (?:by|in)|in a (?:note|report|research note)|in its (?:note|report)|flagged by)\b/i,
  // an attributing noun — brokerage / analyst / house / a named desk
  /\b(brokerage|brokerages|broker|brokers|analyst|analysts|research (?:house|firm|note|report)|fund house|strategist|the note|the report)\b/i,
  // a named source + a REPORTING or VALUATION verb: "Motilal Oswal sees", "Jefferies has set".
  // ⚠ "has"/"have" are deliberately absent as verbs in their own right — see the header ruling.
  new RegExp(
    `\\b(?!(?:${ATTRIBUTION_STOP_OPENERS})\\b)[A-Z][A-Za-z&.'’-]+(?:\\s+(?:[A-Z][A-Za-z&.'’-]+|of|and|&)){0,3}\\s+` +
      `(?:has\\s+|have\\s+|had\\s+)?(?:set|sets|raised|cut|lowered|kept|keeps|maintained|maintains|reiterated|` +
      `reiterates|issued|assigned|placed|put|recommends?|recommended|rates?|rated|values?|valued|sees|expects|` +
      `projects|forecasts|estimates|pegs|said|says|noted|wrote|reported)\\b`,
  ),
  // a named source's possessive — "Jefferies' note", "Kotak's rating". ⚠ NOT "X's target": a company has
  // targets too, so that shape attributes nothing (header ruling).
  new RegExp(
    `\\b(?!(?:${ATTRIBUTION_STOP_OPENERS})\\b)[A-Z][A-Za-z&.'’-]+(?:\\s+[A-Z][A-Za-z&.'’-]+){0,3}['’]s?\\s+` +
      `(?:call|note|estimate|view|rating|report|coverage)\\b`,
  ),
  // headline-style trailing attribution: "…; target of Rs 635: Prabhudas Lilladher"
  new RegExp(
    `[:—–-]\\s*(?!(?:${ATTRIBUTION_STOP_OPENERS})\\b)[A-Z][A-Za-z&.'’-]+(?:\\s+[A-Z][A-Za-z&.'’-]+){0,3}\\s*$`,
  ),
];

/** Does this sentence say WHOSE forecast it is? Exported for the proof harness. */
export function isAttributed(sentence: string): boolean {
  return ATTRIBUTION_RES.some((re) => re.test(sentence));
}

/** Sentences, with their offsets. Splits on . ! ? । and newlines — NOT on ";" (headline attributions
 *  live across a semicolon, and splitting there would strip the attribution off its own claim).
 *
 *  ⚠ `।` (U+0964 DANDA) is the Devanagari full stop and is included for the same reason "." is: without
 *  it a Devanagari reply is ONE sentence, so the price-target tier would scope its attribution test
 *  across the whole answer and launder an unattributed forecast off an attribution three sentences
 *  away. English text contains no danda, so every English verdict is byte-identical. */
function sentencesOf(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^.!?।\n]+[.!?।]*\n*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!m[0].trim()) continue;
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out.length ? out : [{ text, start: 0, end: text.length }];
}

/**
 * The conditional tier. Every OCCURRENCE of a target construction is located, and the sentence containing
 * it decides: attributed ⇒ soft (logged), unattributed ⇒ hard (blocks). One unattributed occurrence is
 * enough to block the whole reply — an attributed target elsewhere does not launder it.
 */
function scanTargets(text: string): { hard: HardHit[]; soft: SoftHit[] } {
  const hard: HardHit[] = [];
  const soft: SoftHit[] = [];
  const sents = sentencesOf(text);
  for (const t of AI_TARGET_LIST) {
    const g = new RegExp(t.re.source, t.re.flags.includes("g") ? t.re.flags : `${t.re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      if (m[0] === "") { g.lastIndex++; continue; }
      // A business figure (₹5,000 crore of revenue) is not a price target — never fires at all.
      if (UNIT_SENSITIVE.has(t.term) && MAGNITUDE_TAIL.test(text.slice(m.index + m[0].length, m.index + m[0].length + 16))) continue;
      const s = sents.find((x) => m!.index >= x.start && m!.index < x.end) ?? { text, start: 0, end: text.length };
      if (isAttributed(s.text)) {
        soft.push({ term: t.term, match: m[0], context: s.text.trim() });
      } else {
        hard.push({ term: t.term, match: m[0], why: `${t.why} — stated with no attributed source` });
      }
    }
  }
  return { hard, soft };
}

// ── SOFT — legitimate in description. NEVER blocks; logged so the corpus can inform promotions. ──
//
// ★ `FORWARD_DENY_LIST` IS REUSED WHOLESALE AS THE SPINE OF THIS TIER, and that is the honest use of
// it: `will` / `likely` / `expect` / `forecast` / bare `buy` / bare `sell` are exactly the words that
// are innocent in one sentence and damning in the aggregate. They are the right thing to WATCH and the
// wrong thing to BLOCK. Derived from the import, not copied, so the tier tracks that list if it grows.
//
// Below are the AI-specific additions — bare modals a describing sentence needs, plus third-party
// `recommend` (reporting an analyst's call is description; making one is HARD's job).
const AI_SOFT_EXTRA: Term[] = [
  {
    term: "should-bare",
    re: /\bshould(n['’]?t)?\b/i,
    why: "modal — innocent in description ('pledging should be read alongside…')",
  },
  { term: "may-bare", re: /\bmay\b/i, why: "modal" },
  { term: "might-bare", re: /\bmight\b/i, why: "modal" },
  { term: "could-bare", re: /\bcould\b/i, why: "modal" },
  { term: "potentially", re: /\bpotential(ly)?\b/i, why: "hedge" },
  {
    term: "consider-bare",
    re: /\bconsider(s|ed|ing)?\b/i,
    why: "innocent alone ('the board will consider a dividend')",
  },
  {
    term: "recommend-bare",
    re: /\brecommend(s|ed|ation|ations|ing)?\b/i,
    why: "third-party recommendation is description, not advice",
  },
];

// ── THE SCANNED VOCABULARY = ENGLISH ∪ HINGLISH/DEVANAGARI ────────────────────────────────────────
// The per-language arrays stay separately authored and separately reviewable; the SCAN sees one list
// per tier. Everything downstream (tier sets, the collision checks, scanTier) reads these, so adding a
// language is one import and one spread — never a second scan path that can drift from this one.
const AI_HARD_ALL = [...AI_HARD_LIST, ...AI_HARD_LIST_HI];
const AI_SOFT_ALL = [...AI_SOFT_EXTRA, ...AI_SOFT_EXTRA_HI];

/** Tier membership is BY TERM NAME, because the scanner always merges FORWARD_DENY_LIST in. */
const HARD_TERMS = new Set(AI_HARD_ALL.map((t) => t.term));
const SOFT_TERMS = new Set(
  [...FORWARD_DENY_LIST, ...AI_SOFT_ALL].map((t) => t.term),
);

// FAIL AT MODULE LOAD, not in production: a HARD name colliding with a shared-list name would make a
// soft term block. Cheap, and the failure mode it prevents is invisible. Covers the Hinglish entries
// too — they are in the same by-name tier space, which is exactly why they carry the `hi-` prefix.
for (const t of AI_HARD_ALL) {
  if (SOFT_TERMS.has(t.term)) {
    throw new Error(
      `ai/guardrail: HARD term "${t.term}" collides with a SOFT/shared term name. Tier assignment is ` +
        `by name — rename the HARD entry, or a soft word will start blocking output.`,
    );
  }
}
// The conditional tier does NOT go through the shared scanner, but its names still surface in hardHits/
// softHits, so a duplicate name would make a verdict unreadable. Same failure, same load-time check.
const HARD_NAMES = new Set(AI_HARD_ALL.map((t) => t.term));
for (const t of AI_TARGET_LIST) {
  if (SOFT_TERMS.has(t.term) || HARD_NAMES.has(t.term)) {
    throw new Error(
      `ai/guardrail: TARGET term "${t.term}" collides with an existing HARD/SOFT term name. Rename it — ` +
        `a verdict must name exactly one rule.`,
    );
  }
}

export interface HardHit {
  term: string;
  match: string; // the matched substring — the scanner's ForwardViolation carries only the whole text
  why: string;
}
export interface SoftHit {
  term: string;
  match: string;
  context: string; // ± a window around the match — this is the corpus for future HARD promotions
}
export interface GuardrailVerdict {
  clean: boolean; // false ⇔ at least one HARD hit. SOFT hits NEVER make it false.
  hardHits: HardHit[];
  softHits: SoftHit[];
}

/** The matched substring. `ForwardViolation` carries the whole scanned string, not the match, so the
 *  hit regex is re-run to recover it. Safe: no entry carries /g, so exec is stateless. */
const matchOf = (re: RegExp, text: string): string => re.exec(text)?.[0] ?? "";

/** A readable window around the match, for the soft log. */
function contextOf(text: string, match: string, radius = 40): string {
  if (!match) return text.slice(0, radius * 2);
  const i = text.indexOf(match);
  if (i < 0) return text.slice(0, radius * 2);
  const from = Math.max(0, i - radius);
  const to = Math.min(text.length, i + match.length + radius);
  return `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
}

/** Scan `text` against one tier, keeping only that tier's own terms. The scanner merges
 *  FORWARD_DENY_LIST into EVERY call, so the name filter is what makes tiering possible at all:
 *  the HARD pass discards those shared hits, the SOFT pass keeps them (they ARE its vocabulary). */
function scanTier(
  text: string,
  extra: Term[],
  keep: Set<string>,
): { term: string; why: string; re: RegExp }[] {
  const byTerm = new Map<string, Term>(
    [...FORWARD_DENY_LIST, ...extra].map((t) => [t.term, t]),
  );
  return scanStringsForForwardLanguage("ai-explanation", [text], extra)
    .filter((v) => keep.has(v.term))
    .map((v) => {
      const t = byTerm.get(v.term)!;
      return { term: v.term, why: v.why, re: t.re };
    });
}

/**
 * LAYER 1 — scan one generated explanation body. Pure, deterministic, free.
 *
 * `clean: false` means a HARD hit: the caller must NOT serve this text (Layer 2 regenerates once,
 * Layer 3 falls back to the deterministic diagnosis). SOFT hits are informational ONLY and never
 * affect `clean` — they exist so the logs become the evidence for promoting a term later, rather
 * than the vocabulary growing on hunches.
 *
 * ⚠ Pass the ASSERTIVE body only — see the header's scope note. Empty/blank input is trivially clean.
 */
export function scanExplanationText(text: string): GuardrailVerdict {
  if (!text || !text.trim()) return { clean: true, hardHits: [], softHits: [] };

  const hardHits: HardHit[] = scanTier(text, AI_HARD_ALL, HARD_TERMS).map(
    (h) => ({
      term: h.term,
      match: matchOf(h.re, text),
      why: h.why,
    }),
  );

  const softHits: SoftHit[] = scanTier(text, AI_SOFT_ALL, SOFT_TERMS).map(
    (h) => {
      const match = matchOf(h.re, text);
      return { term: h.term, match, context: contextOf(text, match) };
    },
  );

  // The conditional tier — price targets and forecast numbers, each one tiered by whether its own
  // sentence attributes it. Merged in AFTER the two flat tiers so a verdict reads in one list.
  const targets = scanTargets(text);

  return {
    clean: hardHits.length === 0 && targets.hard.length === 0,
    hardHits: [...hardHits, ...targets.hard],
    softHits: [...softHits, ...targets.soft],
  };
}
