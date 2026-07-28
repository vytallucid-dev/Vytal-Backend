// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CONTENT-MODERATION GATE — both directions, deterministic, free.
//
// Sibling to guardrail.ts, and built to the same doctrine, because it exists for the same reason: an
// instruction is a request, a gate is a gate. Measured: asked "do you know about porn?" the live chat
// produced a textbook definition. Every guard shipped until now is about ADVICE, so nothing looked at
// this at all — the scope clause in context-layer.ts handles the polite majority, and this handles the
// cases where a complying model is precisely the failure.
//
// ── TWO SIDES, AND WHY THE INPUT SIDE COMES FIRST ─────────────────────────────────────────────────
//   · INPUT  (scanUserInput)  — runs BEFORE the spend gate. A hit means we never generate: no quota
//     unit, no provider call, no tokens. Cheaper AND stops it earlier, which is the whole point.
//   · OUTPUT (scanOutputText) — runs on the delivered text, catching the model complying with something
//     the input side missed (an oblique request, an unusual phrasing, a language we under-cover).
// One vocabulary serves both, because "sexual content" is the same word list whoever wrote it. What
// differs is the TIER: see INPUT_ONLY below.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE FALSE-POSITIVE DIRECTION IS THE HARD ONE, AND IT IS WORSE THAN THE GAP. ★★★
//
// Financial English is full of words a naive filter treats as obscene or violent. All of these are
// ordinary, correct usage on this surface and MUST pass:
//
//     naked options / naked short          dead cat bounce           bloodbath, massacre, slaughtered
//     market penetration                   hard money, tight money   aggressive positions
//     exposure to a sector                 stripped bonds            killing it, killed the quarter
//     climax top, blow-off top             shorting, short squeeze   liquidation, forced liquidation
//     Nifty stripped of gains              suck out liquidity        toxic assets
//
// A moderation filter that blocks "should I write naked calls on TCS?" has destroyed a legitimate stock
// question to prevent nothing. So the vocabulary is NOT a bare word list: every pattern requires a
// construction that finance does not use, and the innocent set is pinned in the proof harness.
//
// ── AND `\b` IS STILL DEAD ON DEVANAGARI ──────────────────────────────────────────────────────────
// Same finding as guardrail-hinglish.ts FINDING #1/#1b, same fix: Devanagari entries use script-range
// lookarounds over the block MINUS its punctuation (the danda U+0964 lives inside the block), and every
// entry carries a `probe` asserted at module load so a pattern cannot silently fire on nothing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface ModTerm {
  term: string;
  re: RegExp;
  why: string;
  /** A string this entry MUST match — asserted at load. The anti-dead-pattern gate. */
  probe: string;
  /** A string this entry must NOT match. Pins a finance carve-out. */
  antiProbe?: string;
}

// ── SCRIPT BOUNDARIES (see guardrail-hinglish.ts for the measurements behind these) ────────────────
const DEV_WORD = "\\u0900-\\u0963\\u0966-\\u096F\\u0972-\\u097F";
const dv = (body: string): RegExp => new RegExp(`(?<![${DEV_WORD}])(?:${body})(?![${DEV_WORD}])`, "i");
const lt = (body: string): RegExp => new RegExp(`\\b(?:${body})\\b`, "i");

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE VOCABULARY. Grouped by what it is, not by language — the tier is a property of the term.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const MODERATION_LIST: ModTerm[] = [
  // ── SEXUAL CONTENT ──────────────────────────────────────────────────────────────────────────────
  // Anchored on words with no financial reading at all. Deliberately NOT included: "naked", "hard",
  // "penetration", "exposure", "climax", "stripped" — every one of them is ordinary market vocabulary
  // (see the header). This is the difference between a filter and a word list.
  {
    term: "sexual-explicit",
    re: lt("porn|pornhub|pornographic|pornography|xxx|nsfw|hentai|erotica|erotic|nudes?|sexting|masturbat(?:e|ion|ing)|orgasm|blowjob|handjob|threesome|fetish|bdsm|escorts?\\s+service|camgirl|onlyfans"),
    why: "sexual content — outside a stock-health assistant's purpose",
    probe: "do you know about porn?",
    antiProbe: "Should I write naked calls on TCS, and what is my exposure?", // ← the finance carve-out
  },
  {
    term: "sexual-explicit-dv",
    re: dv("अश्लील|पोर्न|सेक्स|नग्न|कामुक"),
    why: "sexual content (Devanagari)",
    probe: "मुझे अश्लील सामग्री दिखाओ।",
  },
  {
    // ★ ADDED FROM A LIVE MISS. "mujhe koi ashleel kahani sunao" got through the gate entirely — the
    // scope clause caught it, which is the safety net working, but the gate should not need the net.
    // Devanagari coverage does not imply Latin coverage: readers transliterate, and `अश्लील` and
    // `ashleel` are different strings. Every Devanagari entry needs its Latin twin considered.
    //
    // ⚠ DELIBERATELY ABSENT: "sexy" (traders say "a sexy valuation"), "garam"/"hot" (a hot stock, and
    // pond heat is literally a Vytal term), "item" (an income statement line). Each is ordinary here.
    term: "sexual-explicit-hi",
    re: lt("ash?leel|ashlil|ashleelta|nanga|nangi|chudai|chodna|gandi\\s+(?:kahani|baat|video|photo)|sex\\s+(?:kahani|story|chat)|blue\\s+film"),
    why: "sexual content (Hinglish, Latin script)",
    probe: "mujhe koi ashleel kahani sunao, stocks chhodo",
    antiProbe: "Is stock ka pond heat garam hai aur valuation bhi high hai.",
  },
  {
    term: "sexual-request",
    re: lt("(?:sex|sexual|nude|naked)\\s+(?:chat|talk|story|stories|roleplay|role\\s*play|pic|pics|picture|photo|video)"),
    why: "a request for sexual material",
    probe: "let's have a sexual roleplay",
    antiProbe: "What is my naked exposure to the banking sector?",
  },
  {
    term: "sexual-actors",
    re: lt("(?:porn|adult\\s+film|adult\\s+movie)\\s*(?:stars?|actors?|actress(?:es)?)|pornstars?"),
    why: "a request about sexual performers",
    probe: "tell me some name of famous pornstars",
  },

  // ── ABUSE / HARASSMENT ──────────────────────────────────────────────────────────────────────────
  // Slurs and direct abuse. NOT included: "idiot", "stupid", "useless", "rubbish", "garbage" — a
  // frustrated reader calling a SCORE rubbish is a legitimate (and useful) complaint, not abuse.
  {
    term: "abuse-english",
    re: lt("fuck(?:ing|er|ers|ed)?|motherfucker|cunt|bitch|bastard|asshole|dickhead|retard(?:ed)?|shut\\s+the\\s+fuck\\s+up"),
    why: "abusive language",
    probe: "shut the fuck up you useless bot",
    antiProbe: "This score looks like garbage — the momentum reading makes no sense.",
  },
  {
    term: "abuse-hinglish",
    re: lt("chutiya|chutiye|bhosdi(?:ke|wala)?|bhosda|madarchod|behenchod|bhenchod|gandu|gaandu|randi|lauda|lodu|harami|kutta\\s+kamina|teri\\s+maa"),
    why: "abusive language (Hinglish)",
    probe: "chutiya hai kya tu?",
    antiProbe: "Ye score kharab hai, mujhe samajh nahi aaya.",
  },
  {
    term: "abuse-devanagari",
    re: dv("चूतिया|मादरचोद|भोसड़ी|गांडू|रंडी|हरामी|कुत्ते"),
    why: "abusive language (Devanagari)",
    probe: "तू चूतिया है क्या?",
  },

  // ── MALICIOUS INTENT ────────────────────────────────────────────────────────────────────────────
  // ⚠ THE MOST CARE IS NEEDED HERE, because finance discusses wrongdoing constantly and legitimately:
  // "was this insider trading?", "explain the Satyam fraud", "what counts as market manipulation?",
  // "SEBI's rules on front-running" are all IN SCOPE and must pass. So these patterns require a
  // FIRST-PERSON REQUEST FOR HELP DOING it — the asking, not the topic.
  {
    term: "malicious-help-me",
    re: lt("(?:how\\s+(?:can|do)\\s+i|help\\s+me|teach\\s+me\\s+to|show\\s+me\\s+how\\s+to|steps\\s+to)\\s+(?:\\w+\\s+){0,4}?(?:hack|steal|launder|forge|counterfeit|evade\\s+tax(?:es)?|dodge\\s+tax(?:es)?|bribe|blackmail|poison|kill|murder|make\\s+a\\s+bomb|build\\s+a\\s+bomb)"),
    why: "asking for help committing something harmful or illegal",
    probe: "how can i launder money through a demat account",
    antiProbe: "Explain how money laundering works and what SEBI does about it.",
  },
  {
    term: "malicious-help-me-hi",
    re: lt("(?:kaise|kaise\\s+karu|kar\\s+sakta\\s+hoon)\\s+(?:\\w+\\s+){0,3}?(?:hack|chori|ghotala|hawala)|(?:mujhe|muje)\\s+(?:\\w+\\s+){0,3}?(?:hack|chori|ghotala)\\s+karna"),
    why: "asking for help committing something harmful (Hinglish)",
    probe: "mujhe account hack karna hai",
  },
  {
    term: "self-harm-request",
    re: lt("(?:how\\s+to|help\\s+me)\\s+(?:kill\\s+myself|end\\s+my\\s+life|commit\\s+suicide)|best\\s+way\\s+to\\s+(?:kill\\s+myself|die)"),
    why: "self-harm — must not be engaged with by a stock assistant",
    probe: "help me kill myself",
    antiProbe: "This stock has killed my returns this year.",
  },
];

/**
 * Terms that are checked on INPUT ONLY.
 *
 * ★ WHY THE SIDES ARE NOT SYMMETRIC. A reader's abuse is a fair-use matter and is caught on the way in.
 * But the same word list run over OUTPUT would fire on the assistant's own honest refusal if it ever
 * quoted the reader back, and on `abuse-*` in particular there is no legitimate reason for the model to
 * emit those words at all — so a hit there is far more likely to be a quotation than a violation. The
 * output side therefore scans only the categories where a COMPLYING model is the failure: sexual content
 * and malicious instruction.
 */
const INPUT_ONLY = new Set(["abuse-english", "abuse-hinglish", "abuse-devanagari"]);

export interface ModerationHit { term: string; match: string; why: string }
export interface ModerationVerdict {
  /** true ⇔ nothing fired. false ⇔ serve the fair-use warning instead. */
  clean: boolean;
  hits: ModerationHit[];
  /** Coarse category of the first hit, for logging. */
  category: "sexual" | "abuse" | "malicious" | null;
}

const CLEAN: ModerationVerdict = { clean: true, hits: [], category: null };

const categoryOf = (term: string): "sexual" | "abuse" | "malicious" =>
  term.startsWith("sexual") ? "sexual" : term.startsWith("abuse") ? "abuse" : "malicious";

function scan(text: string, terms: ModTerm[]): ModerationVerdict {
  if (!text || !text.trim()) return CLEAN;
  const hits: ModerationHit[] = [];
  for (const t of terms) {
    const m = t.re.exec(text);
    if (m) hits.push({ term: t.term, match: m[0], why: t.why });
  }
  if (!hits.length) return CLEAN;
  return { clean: false, hits, category: categoryOf(hits[0].term) };
}

/**
 * INPUT side — run on the reader's own message BEFORE the spend gate. A hit means: do not generate, spend
 * nothing, and serve the fair-use warning. Pure, deterministic, free.
 */
export function scanUserInput(text: string | null | undefined): ModerationVerdict {
  return scan(text ?? "", MODERATION_LIST);
}

/**
 * OUTPUT side — run on the generated reply before it is delivered. Catches the model COMPLYING with
 * something the input side did not recognise. Scans everything except the input-only tiers (above).
 */
export function scanOutputText(text: string | null | undefined): ModerationVerdict {
  return scan(text ?? "", MODERATION_LIST.filter((t) => !INPUT_ONLY.has(t.term)));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ THE ANTI-DEAD-PATTERN GATE — at module load, exactly as guardrail-hinglish.ts does it.
// A pattern that matches nothing reports CLEAN forever, which is the one failure nobody notices.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
for (const t of MODERATION_LIST) {
  if (!t.re.test(t.probe)) {
    throw new Error(
      `ai/moderation: DEAD PATTERN — "${t.term}" does not match its own probe.\n  probe: "${t.probe}"\n  regex: ${t.re}\n` +
        `If this is a Devanagari entry, the cause is almost certainly \\b — it does not work on that script.`,
    );
  }
  if (t.antiProbe !== undefined && t.re.test(t.antiProbe)) {
    throw new Error(
      `ai/moderation: FINANCE CARVE-OUT BROKEN — "${t.term}" matches its antiProbe, which is legitimate ` +
        `market language and must pass.\n  antiProbe: "${t.antiProbe}"\n  regex: ${t.re}`,
    );
  }
}
