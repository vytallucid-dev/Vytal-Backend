// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE AI OUTPUT GUARDRAIL — HINGLISH / DEVANAGARI VOCABULARY.
//
// Sibling to guardrail.ts, which owns the ENGLISH vocabulary, the tiering doctrine, and the scan.
// This file adds only vocabulary, in the same two tiers, on the same organizing principle:
//
//   ★ HARD = THE MODEL ADVISING IN ITS OWN VOICE.                    → block
//   ★ SOFT = WORDS DESCRIPTION LEGITIMATELY NEEDS.                   → log, NEVER block
//
// It exists because `AI_HARD_LIST` is English-only and the gate was therefore BLIND in the language
// readers are most likely to ask for advice in. Measured: "Mujhe ye stock lena chahiye ya nahi?" drew a
// correct refusal from the SPINE, while `scanExplanationText` returned clean. The instruction held; the
// gate saw nothing. Once tone.ts starts mirroring the reader's language, that blindness stops being
// theoretical — it becomes the normal path.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ FINDING #1 — `\b` IS DEAD ON DEVANAGARI. MEASURED, NOT ASSUMED. ★★★
//
// JavaScript's `\b` is defined on the ASCII word class `[A-Za-z0-9_]`. Every Devanagari codepoint is
// `\W` to that definition, so between two Devanagari characters there is NO boundary at all:
//
//     /\bचाहिए\b/.test("आपको यह लेना चाहिए")   →  false
//     /\bचाहिए\b/.test("चाहिए")                →  false   ← not even standalone
//     /चाहिए/.test("आपको यह लेना चाहिए")       →  true
//
// A Devanagari pattern written with `\b` does not misfire — it NEVER fires, silently, forever. That is
// the worst failure mode a guard has: it reports clean and nobody learns otherwise. So:
//
//   · Devanagari entries are built with `dv()`, which brackets the body in SCRIPT-RANGE lookarounds
//     (`(?<![ऀ-ॿ]) … (?![ऀ-ॿ])`) — the same "don't match inside a longer word"
//     guarantee `\b` gives Latin, expressed in a way that works for this script.
//   · Latin-script Hinglish uses `\b` normally, because it IS ASCII.
//   · ★ EVERY ENTRY CARRIES A `probe` IT MUST MATCH, ASSERTED AT MODULE LOAD (bottom of this file).
//     That is what makes the trap non-recurring: a future edit that "tidies" a `dv()` back to `\b`
//     fails at import instead of quietly disarming the gate. Same posture as guardrail.ts's
//     name-collision throw — fail loudly at load, never invisibly in production.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ FINDING #2 — THE SEPARATION IS THE VERB, NOT THE MODAL. ★★★
//
// English splits `addressed-should` (HARD: "you should") from `should-bare` (SOFT: "pledging should be
// read alongside…") on the ADDRESSEE. That does not transfer: Hindi drops the addressee constantly, so
// "is stock ko bech dena chahiye" is unmistakable advice with no addressee anywhere in it, while
// "pledging ko debt ke saath dekhna chahiye" is the innocent twin with the identical shape.
//
// What actually separates them is the VERB. So the HARD entry is TRADE-VERB + chahiye, and bare
// `chahiye` is SOFT. "dekhna / samajhna / pata hona / jaanna chahiye" pass because those verbs are not
// trade verbs; "lena / bechna / kharidna / hold karna chahiye" block because they are. This is the same
// move as the `many-investors-would` probation entry — separate on the one token that carries the
// intent, not on the surrounding shape.
//
// ⚠ AND BARE `chahiye` MUST STAY SOFT FOR A SECOND, LOAD-BEARING REASON: the honest REFUSAL contains
// it. "…main ye nahi bata sakta ki aapko kya karna chahiye" is the spine working correctly. Promoting
// bare `chahiye` to HARD would make every Hinglish refusal block itself, burn the regeneration unit,
// and replace a good in-voice answer with the canned Layer-3 redirect. The gate would fire hardest on
// exactly the replies that are right.
//
// ── WHAT IS DELIBERATELY NOT HERE (the asymmetry, inherited from guardrail.ts) ─────────────────────
// When in doubt, PASS. Omitted on purpose:
//   · `kam karna` / `badhana` (reduce / increase) — genuinely polysemous. "Company ko debt kam karna
//     chahiye" is prescriptive about a COMPANY, not investment advice to the reader, and English lets
//     the mirror-image "the company should reduce debt" through too (`addressed-should` needs
//     you/investors/one). Adding them would block description in one language only.
//   · `mera maanna hai` ("my view is") — opinion, not an instruction. One word from legitimate framing.
//   · Regional spellings beyond the common Latin variants below. Chasing every transliteration is how a
//     guard starts blocking prose; a known gap the offline judge covers beats a guard nobody trusts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** Same shape guardrail.ts's `Term` has, plus the load-time self-test fields. */
export interface HiTerm {
  term: string;
  re: RegExp;
  why: string;
  /** A string this entry MUST match. Asserted at module load — the anti-dead-pattern gate. */
  probe: string;
  /** Optional: a string this entry must NOT match (pins a carve-out). */
  antiProbe?: string;
}

// ── SCRIPT BOUNDARIES ───────────────────────────────────────────────────────────────────────────────
//
// ★★★ FINDING #1b — THE BOUNDARY CLASS IS THE DEVANAGARI BLOCK **MINUS ITS PUNCTUATION**. ★★★
//
// Caught by the load-time probe below on the first run, which is the entire reason it exists. The
// obvious class — the whole block `[ऀ-ॿ]` — is WRONG, because `।` (U+0964 DANDA, the
// Devanagari full stop) and `॥` (U+0965) live INSIDE that block. A "not a Devanagari character"
// lookahead therefore treats the sentence-ending period as a letter:
//
//     whole block:      /(?<![ऀ-ॿ])लेना\s+चाहिए(?![ऀ-ॿ])/
//                         .test("आपको यह लेना चाहिए।")   →  false   ← the danda blocks it
//     letters+digits:   .test("आपको यह लेना चाहिए।")     →  true
//
// Since a model's Devanagari sentence ends in a danda essentially every time, the whole-block version
// would have fired on almost nothing in production while passing any test string that happened to omit
// the punctuation. Excluded: U+0964–U+0965 (danda, double danda) and U+0970–U+0971 (abbreviation sign,
// high spacing dot). Digits U+0966–U+096F are KEPT inside the class — they are word characters, exactly
// as ASCII digits are to `\b`.
const DEV_WORD = "\\u0900-\\u0963\\u0966-\\u096F\\u0972-\\u097F";

/** Devanagari-safe boundary wrapper. See FINDING #1 — never use `\b` for this script. */
const dv = (body: string): RegExp => new RegExp(`(?<![${DEV_WORD}])(?:${body})(?![${DEV_WORD}])`, "i");

/** Latin-script Hinglish. ASCII `\b` works normally here. */
const lt = (body: string): RegExp => new RegExp(`\\b(?:${body})\\b`, "i");

// ── SHARED FRAGMENTS ────────────────────────────────────────────────────────────────────────────────
//
// TRADE VERBS — the tokens that turn a modal into investment advice. Ordered longest-first, because
// alternation is ordered and "bech dena" must win over "bechna".
//
// ⚠ `rakhna` (hold) carries a lookbehind carve-out. On its own it is the hold verb ("ise rakhna
// chahiye"), but "dhyan / yaad / khyal rakhna chahiye" is "should keep in mind / remember" — not a
// trade at all. The carve-out is pinned by `antiProbe` below.
const TRADE_LT =
  "le\\s*lena|lena|khar[ie]+dna|khar[ie]+d\\s*lena|buy\\s+karna|add\\s+karna|" +
  "bech\\s*dena|bechna|sell\\s+karna|exit\\s+karna|nikal\\s*(?:jana|dena)|nikalna|" +
  "hold\\s+karna|banaye\\s+rakhna|bane\\s+rehna|(?<!(?:dhyan|yaad|khyal|khayal)\\s)rakhna|" +
  "trim\\s+karna|book\\s+karna";

const TRADE_DV =
  "ले\\s*लेना|लेना|खरीद\\s*लेना|खरीदना|बेच\\s*देना|बेचना|" +
  "निकाल\\s*देना|निकल\\s*जाना|निकालना|होल्ड\\s+करना|एक्ज़िट\\s+करना|एक्जिट\\s+करना|" +
  "बनाये\\s+रखना|बनाए\\s+रखना|(?<!(?:ध्यान|याद|ख्याल)\\s)रखना";

/** The modal itself — "should / ought to". Common Latin transliterations + both Devanagari spellings. */
const CHAHIYE_LT = "chahiye|chaahiye|chahiyay|chahiyega|chaiye|chahie";
const CHAHIYE_DV = "चाहिए|चाहिये";

/** An optional intensifier between the verb and the modal: "lena HI chahiye", "bechna TO chahiye". */
const INTENSIFIER_LT = "(?:\\s+(?:hi|hee|to|toh))?";
const INTENSIFIER_DV = "(?:\\s+(?:ही|तो))?";

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// HARD — the model advising in its own voice. A match BLOCKS.
//
// ⚠ EVERY `term` NAME MUST BE DISTINCT FROM the English HARD/SOFT/TARGET names AND from
// FORWARD_DENY_LIST's — tier assignment in guardrail.ts is BY NAME, and a collision would silently
// promote a soft term to a blocker. The `hi-` prefix guarantees it; guardrail.ts asserts it at load.
// The `-dv` suffix marks the Devanagari twin, so a verdict says which SCRIPT fired — which is what you
// need to debug a script-specific dead pattern.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const AI_HARD_LIST_HI: HiTerm[] = [
  // ── Family 1: TRADE VERB + chahiye. The core construction, and the one measured passing clean. ──
  {
    term: "hi-trade-should",
    re: lt(`(?:${TRADE_LT})${INTENSIFIER_LT}\\s+(?:${CHAHIYE_LT})`),
    why: "advice — a trade verb under 'chahiye' ('aapko ye stock lena chahiye')",
    probe: "Aapko ye stock lena chahiye.",
    antiProbe: "Pledging ko debt ke saath dhyan rakhna chahiye.", // ← the hold-verb carve-out
  },
  {
    term: "hi-trade-should-dv",
    re: dv(`(?:${TRADE_DV})${INTENSIFIER_DV}\\s+(?:${CHAHIYE_DV})`),
    why: "advice — a trade verb under 'चाहिए' (Devanagari)",
    probe: "आपको यह स्टॉक लेना चाहिए।", // ← with the danda: what FINDING #1b was caught on
    antiProbe: "इस बात का ध्यान रखना चाहिए।", // ← the hold-verb carve-out, in Devanagari
  },

  // ── Family 2: the model's OWN advice, by name. The direct analogue of `my-recommendation`. ──
  {
    term: "hi-my-advice",
    re: lt("(?:meri|mera|mere)\\s+(?:salah|sallah|sujhav|sujhaav|suggestion|raay|advice|sifarish)"),
    why: "the model's own advice, by name ('meri salah hai ki…')",
    probe: "Meri salah hai ki aap ye position kam karein.",
    antiProbe: "Brokerage ki salah thi ki target ₹4,000 hai.",
  },
  {
    term: "hi-my-advice-dv",
    re: dv("(?:मेरी|मेरा|मेरे)\\s+(?:सलाह|सुझाव|राय|सिफ़ारिश|सिफारिश)"),
    why: "the model's own advice, by name (Devanagari)",
    probe: "मेरी सलाह है कि आप इसे बेच दें।",
    antiProbe: "ब्रोकरेज की सलाह थी कि टारगेट ₹4,000 है।",
  },
  {
    term: "hi-i-will-advise",
    re: lt("main\\s+(?:aapko\\s+|apko\\s+|tumhe\\s+)?(?:salah|sallah|sujhav|sujhaav|advice)\\s+(?:dunga|doonga|dungi|dena|deta|deti|dun|de\\s+raha)"),
    why: "the model recommending in its own voice ('main salah dunga…')",
    probe: "Main salah dunga ki aap thoda trim karein.",
  },
  {
    term: "hi-i-will-advise-dv",
    re: dv("मैं\\s+(?:आपको\\s+|तुम्हें\\s+)?(?:सलाह|सुझाव)\\s+(?:दूंगा|दूँगा|दूंगी|देता|देती|देना)"),
    why: "the model recommending in its own voice (Devanagari)",
    probe: "मैं आपको सलाह दूंगा कि इसे रखें।",
  },
  {
    term: "hi-i-recommend",
    re: lt("main\\s+(?:ye|yeh|is[ek]?)?\\s*recommend\\s+kar(?:ta|ti|unga|oonga)"),
    why: "the model recommending in its own voice, code-switched",
    probe: "Main recommend karta hoon ki aap ise rakhein.",
  },

  // ── Family 3: "worth buying" — the `worth-trading` idiom. ──
  {
    term: "hi-worth-trading",
    re: lt("(?:lene|le\\s+lene|khar[ie]+dne|bechne|nikalne)\\s+(?:ke\\s+)?(?:layak|laayak|yogya)"),
    why: "advice ('ye stock lene layak hai')",
    probe: "Ye stock lene layak hai.",
  },
  {
    term: "hi-worth-trading-dv",
    re: dv("(?:लेने|खरीदने|बेचने|निकलने)\\s+(?:के\\s+)?(?:लायक|योग्य)"),
    why: "advice — 'worth buying' idiom (Devanagari)",
    probe: "यह स्टॉक लेने लायक है।",
  },

  // ── Family 4: market timing — the `time-to-trade` analogue. ──
  {
    term: "hi-time-to-trade",
    re: lt("(?:lene|khar[ie]+dne|bechne|nikalne|exit\\s+karne|entry\\s+lene)\\s+ka\\s+(?:sahi\\s+|acha\\s+|achcha\\s+|behtar\\s+)?(?:samay|waqt|vakt|mauka|time)"),
    why: "market timing advice ('abhi kharidne ka sahi samay hai')",
    probe: "Abhi kharidne ka sahi samay hai.",
  },
  {
    term: "hi-time-to-trade-dv",
    re: dv("(?:लेने|खरीदने|बेचने|निकलने)\\s+का\\s+(?:सही\\s+|अच्छा\\s+|बेहतर\\s+)?(?:समय|वक्त|मौका)"),
    why: "market timing advice (Devanagari)",
    probe: "अभी खरीदने का सही समय है।",
  },

  // ── Family 5: the bare IMPERATIVE. High precision — description uses the PAST ("bech diya",
  //    "kharida"), never the command form, so these need no surrounding context to be decidable. ──
  {
    term: "hi-trade-imperative",
    re: lt("becho|bech\\s+(?:do|dijiye|de\\s+do)|khar[ie]+do|khar[ie]+d\\s+(?:lo|lijiye)|le\\s+(?:lo|lijiye)|nikal\\s+(?:do|jao|jaiye)|hold\\s+karo|exit\\s+karo|trim\\s+karo|book\\s+karo"),
    why: "a trade instruction in the imperative ('ise becho')",
    probe: "Is stock ko becho.",
    antiProbe: "Promoters ne apne shares bech diye.", // past tense — description
  },
  {
    term: "hi-trade-imperative-dv",
    re: dv("बेचो|बेच\\s+(?:दो|दीजिए)|खरीदो|खरीद\\s+(?:लो|लीजिए)|ले\\s+(?:लो|लीजिए)|निकाल\\s+दो|निकल\\s+जाओ"),
    why: "a trade instruction in the imperative (Devanagari)",
    probe: "इस स्टॉक को बेच दो।",
    antiProbe: "प्रोमोटर्स ने अपने शेयर बेच दिए।",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SOFT — legitimate in description. NEVER blocks; logged so the corpus can inform promotions.
//
// This tier is not decoration. Three of its entries are the reason the HARD tier above can stay tight:
//   · `hi-should-bare`  — the refusal contains it (see FINDING #2).
//   · `hi-advice-noun`  — reporting a brokerage's call is description, exactly as `recommend-bare` is.
//   · `hi-trade-past`   — "promoters ne shares bech diye" is a FACT about ownership flow, the single
//                         most common innocent Hinglish construction on this surface.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const AI_SOFT_EXTRA_HI: HiTerm[] = [
  {
    term: "hi-should-bare",
    re: lt(CHAHIYE_LT),
    why: "modal — innocent in description, and the honest refusal contains it",
    probe: "Aapko pata hona chahiye ki Vytal weights nahi batata.",
  },
  {
    term: "hi-should-bare-dv",
    re: dv(CHAHIYE_DV),
    why: "modal (Devanagari) — innocent in description",
    probe: "पहले यह समझना चाहिए कि बैंड क्या है।",
  },
  {
    term: "hi-advice-noun",
    re: lt("salah|sallah|sujhav|sujhaav|sifarish|raay"),
    why: "third-party advice being REPORTED is description, not advice",
    probe: "Analysts ki salah hai ki margin pressure jaari rahega.",
  },
  {
    term: "hi-advice-noun-dv",
    re: dv("सलाह|सुझाव|सिफारिश|सिफ़ारिश|राय"),
    why: "third-party advice being reported (Devanagari)",
    probe: "ब्रोकरेज की सलाह अलग है।",
  },
  {
    term: "hi-decision-noun",
    re: lt("faisla|faislaa|faisle|nirnay"),
    why: "'the decision is yours' is the REFUSAL — must never block",
    probe: "Ye faisla poori tarah aapka hai.",
  },
  {
    term: "hi-decision-noun-dv",
    re: dv("फैसला|फ़ैसला|निर्णय"),
    why: "'the decision is yours' (Devanagari) — the refusal",
    probe: "यह फैसला पूरी तरह आपका है।",
  },
  {
    term: "hi-trade-past",
    re: lt("bech\\s+(?:diya|diye|di)|beche|becha|khar[ie]+da|khar[ie]+de|le\\s+liya|nikal\\s+(?:gaya|gaye)"),
    why: "past-tense trade verbs describe REAL flows ('promoters ne shares bech diye')",
    probe: "FII ne is quarter mein shares beche.",
  },
  {
    term: "hi-trade-past-dv",
    re: dv("बेच\\s+(?:दिया|दिए|दी)|बेचे|बेचा|खरीदा|खरीदे|ले\\s+लिया"),
    why: "past-tense trade verbs describe real flows (Devanagari)",
    probe: "प्रोमोटर्स ने शेयर बेचे।",
  },
  {
    term: "hi-hedge-bare",
    re: lt("shayad|mumkin|sambhav|ho\\s+sakta|ho\\s+sakti|sakta\\s+hai"),
    why: "hedge — innocent in description",
    probe: "Ho sakta hai ki coverage kam ho.",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE ANTI-DEAD-PATTERN GATE — runs at MODULE LOAD, like guardrail.ts's collision check.
//
// FINDING #1's whole point: a Devanagari pattern written with `\b` fires on NOTHING and reports clean
// forever. A vocabulary that cannot be observed failing is a vocabulary nobody knows works. So every
// entry must match its own canonical example, and every carve-out must be pinned by its `antiProbe`.
// A "tidy-up" that breaks either one now fails at import.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
for (const t of [...AI_HARD_LIST_HI, ...AI_SOFT_EXTRA_HI]) {
  if (!t.re.test(t.probe)) {
    throw new Error(
      `ai/guardrail-hinglish: DEAD PATTERN — "${t.term}" does not match its own probe.\n` +
        `  probe: "${t.probe}"\n  regex: ${t.re}\n` +
        `If this is a Devanagari entry, the cause is almost certainly \\b — it does NOT work on this ` +
        `script (see FINDING #1). Build it with dv() instead.`,
    );
  }
  if (t.antiProbe !== undefined && t.re.test(t.antiProbe)) {
    throw new Error(
      `ai/guardrail-hinglish: CARVE-OUT BROKEN — "${t.term}" matches its antiProbe, which must pass.\n` +
        `  antiProbe: "${t.antiProbe}"\n  regex: ${t.re}`,
    );
  }
}
