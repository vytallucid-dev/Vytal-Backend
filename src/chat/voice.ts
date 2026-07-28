// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CHAT VOICE — the named prompt constants + builders that are the chat layer's OWN, sibling to
// tone.ts's spine, context-layer.ts's model-of-health, and grounding.ts's closed-world header.
//
// Everything here is authored English that ships in a prompt. It is kept in ONE reviewable place — a
// diff to the chat's voice is a diff to this file — and it never duplicates what the siblings own
// (advice/prediction bans, how to speak numbers, the health model). It adds only what is NEW to a
// CONVERSATION over a reader's own book:
//   · CHAT_USE_DONT_NARRATE — the personalization rule (use the reader's context, never narrate it back).
//   · buildOrientationHeader — the ~40-token "who you're talking to" block on every session.
//   · ANTI_ADVICE_REMINDER — the sharpened reminder injected on the ONE guardrail regeneration.
//   · buildLayer3Redirect — the fixed, in-voice redirect served when regeneration still trips the gate.
//   · buildSystemPrompt — assembles the system instruction (tone + context-layer + the personalization rule).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { VYTAL_CONTEXT_LAYER } from "../ai/context-layer.js";
import type { ToneLevel } from "../ai/tone.js";

// ── THE PERSONALIZATION RULE — USE the reader's context, NEVER narrate it (the ruling ★). ───────────
// This is NOT owned by any sibling: the spine bans advice, precision governs numbers, the context layer
// teaches the health model — none of them says "you know who the reader is; shape the answer, don't
// report their behaviour". A chat that reads someone's own book needs exactly that rule, so it lives here.
// The reader's language/script, used by both the fair-use warning and the Layer-3 redirect. Declared
// here because both consumers sit above the detector that produces it.
export type ReaderRegister = "en" | "hi" | "dv";

export const CHAT_USE_DONT_NARRATE =
  "ABOUT PERSONALIZATION — you are given context about the reader: whether they hold this, their position " +
  "size, their sector exposure, their peers held, their watch history. USE it to decide what to EMPHASIZE and " +
  "how to frame the explanation — it is what separates a reading of THEIR book from a generic one. But the " +
  "context is INPUT TO YOU, never OUTPUT TO THEM: never narrate it back, never report their behaviour, and " +
  "never make the reader the subject of a sentence about what they hold, watch, or did. " +
  "✅ GOOD: \"your roughly 9% position sits in the very name most exposed to this peer group's margin " +
  "compression\" — the position is doing work INSIDE a sentence about the stock. " +
  "❌ NOT ALLOWED: \"you've viewed this six times\", \"you added this in March\", \"you seem interested in " +
  "banks\", and — the subtle one — \"the facts show no personal holding or watchlist connection for you here\": " +
  "announcing the ABSENCE of a position is STILL narrating the reader. " +
  "THE ABSENCE CASE, EXPLICITLY: when the reader holds nothing here, do not assume exposure they don't have, " +
  "AND do not point the absence out. It simply means you frame the read around the COMPANY itself rather than " +
  "around their position — say nothing about their holdings at all. Weave a real position into the explanation " +
  "of the facts; when there is none, be silent about it.";

// ── THE REGENERATION REMINDER — Layer 2. Injected into the system prompt on the ONE retry after a HARD hit. ──
// Sharp, specific, and about the ONE failure that occurred (advice), so the second attempt is a genuine
// correction rather than a coin-flip. Names the hedged forms the guardrail catches, because those are how
// the spine is most often defeated.
// ★ IT MUST NAME THE HINGLISH CONSTRUCTIONS TOO, AND IT MUST PIN THE LANGUAGE. Two failures this
// closes, both created by the language mirror (tone.ts LANGUAGE_MIRROR):
//   · A reminder that lists only English banned moves reads, to a model that just answered in Hinglish,
//     as a rule about a language it is not currently speaking. The constructions the guardrail actually
//     caught (`…lena chahiye`, `meri salah hai`, `…lene layak hai`) have to appear in the reminder in
//     the form they were written in, or the correction is a coin-flip.
//   · ⚠ THE RETRY MUST NOT SILENTLY SWITCH TO ENGLISH. "Try again, but descriptive" is easiest to obey
//     by reverting to the language the rules were learned in — which would turn the ONE guardrail hit
//     into a language drift on exactly the turn the reader is most invested in. So the reminder says to
//     keep the language and change only the stance.
export const ANTI_ADVICE_REMINDER =
  "⚠ CORRECTION — your previous reply crossed into ADVICE: it told the reader what to do, or implied it. " +
  "Produce the answer again, describing ONLY what the facts show and what the concepts mean. State no " +
  "recommendation, suggestion, or action — not even a hedged or implied one. Banned moves include " +
  "\"might be worth\", \"keep an eye on\", \"the next step\", \"consider trimming/adding\", \"worth watching\", " +
  "\"you may want to\", and telling the reader what they \"should\" do. Describe what IS — the facts, the " +
  "context, the mechanics — never what to do next. " +
  "THE SAME BAN IN HINGLISH AND HINDI, in the exact forms it gets broken: do not write \"aapko … lena / " +
  "bechna / rakhna chahiye\", \"meri salah hai\", \"main salah dunga\", \"… lene layak hai\", \"… kharidne " +
  "ka sahi samay hai\", or an imperative like \"becho\" / \"kharido\" — nor their Devanagari equivalents " +
  "(\"आपको … लेना चाहिए\", \"मेरी सलाह है\", \"… लेने लायक है\"). Advice is advice in every language. " +
  "Instead say plainly that the decision is the reader's own — \"ye faisla poori tarah aapka hai\" / " +
  "\"यह फैसला पूरी तरह आपका है\" — and then lay out what the numbers describe, with no action attached. " +
  "★ ANSWER IN THE SAME LANGUAGE AND SCRIPT AS YOUR PREVIOUS REPLY. Only the stance changes; the " +
  "language does not. Do not fall back to English because the correction is written in it. " +
  "Keep everything else about the answer the same.";

// ── THE LAYER-3 FIXED REDIRECT — served verbatim when the regeneration ALSO trips the gate. ─────────
// Not an error, not a fabricated answer: an honest, in-voice statement of the boundary plus a real
// invitation back to what the assistant CAN do. The lead sentence is fixed (the spec's words); the tail
// names what is describable about THIS subject so the redirect is a door, not a wall.
export const LAYER3_REDIRECT_LEAD =
  "I can explain what these numbers mean, but I can't tell you what to do with them.";

// ── ★ THE REDIRECT IS SERVED IN THE READER'S OWN LANGUAGE. ──────────────────────────────────────────
//
// ⚠ WHY THIS EXISTS, AND WHY IT SHIPPED WITH THE HINGLISH GUARDRAIL RATHER THAN AFTER IT. Before the
// Hinglish vocabulary existed, a Hinglish advice reply scanned CLEAN and was simply delivered — this
// path was unreachable in any language but English. Extending the gate makes it reachable, so shipping
// the gate WITHOUT this would have introduced a new failure: the reader asks in Hinglish, the model
// advises twice, and the honest refusal arrives as a wall of English — on the single highest-stakes turn
// in the product. Measured live: two consecutive runs of the same Hinglish advice question went
// (regenerated, clean) then (blocked twice → redirect), so it is a coin-flip, not a corner.
//
// DETERMINISTIC — no model call, no detection heuristic in the generation path, and NO new stored
// preference: the register is read off the reader's own last message, the same signal LANGUAGE_MIRROR
// tells the model to use. Vytal's own vocabulary stays in Latin in all three variants, exactly as
// LANGUAGE_MIRROR requires of the model.
/** Devanagari anywhere ⇒ that script. Latin-script Hindi is detected from unambiguous FUNCTION words —
 *  never from content words, and never from tokens that are also English ("me", "is", "to", "so"), which
 *  is how a detector starts calling English prose Hinglish. Two markers is the threshold: real Hinglish
 *  questions carry several ("Mujhe ye stock lena chahiye ya nahi?" → mujhe, ye, chahiye, nahi), and an
 *  English sentence carries none. */
const HINGLISH_FUNCTION_WORDS = new Set([
  "mujhe", "mera", "meri", "mere", "aapko", "aapka", "aapke", "apko", "apka", "apne", "apna",
  "kya", "kyun", "kyunki", "kaisa", "kaise", "kaisi", "kitna", "kitni", "hai", "hain", "tha", "thi",
  "nahi", "nahin", "chahiye", "karna", "karne", "karo", "kar", "batao", "bata", "samjhao", "samjha",
  "ka", "ki", "ke", "ko", "se", "mein", "aur", "ya", "ye", "yeh", "wo", "woh", "iska", "iske", "isko",
  "uska", "abhi", "thoda", "zyada", "sakta", "sakte", "sakti", "raha", "rahi", "hota", "hoti",
  "lekin", "phir", "bhi", "jaise", "tarah", "matlab", "poori", "sirf",
  // ★ ADDED FROM A LIVE MISS. "mujhe koi ashleel kahani sunao, stocks chhodo" scored only 1 ("mujhe")
  // and was served an ENGLISH warning. Short Hinglish sentences carry few of the long function words
  // above, so the common pronouns and question words are needed to reach the threshold at all.
  // Still no token that is also an English word — "do", "de", "le", "so", "is" stay out deliberately.
  "koi", "aap", "tum", "tu", "tera", "teri", "hum", "hume", "humein",
  "kaun", "kahan", "kab", "kyu", "bahut", "acha", "achha", "theek", "haan", "haa",
  "dikha", "dikhao", "sunao", "chhodo", "batao", "lagana", "hoga", "hogi", "wali",
]);

export function detectReaderRegister(text: string | null | undefined): ReaderRegister {
  if (!text || !text.trim()) return "en";
  if (/[ऀ-ॿ]/.test(text)) return "dv";
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  let markers = 0;
  for (const w of words) if (HINGLISH_FUNCTION_WORDS.has(w)) markers++;
  return markers >= 2 ? "hi" : "en";
}

/** The reader's OWN last message from a model history — skipping the server-composed grounding is not
 *  needed (it is English, so it correctly yields "en" when the reader has not written yet) but tool
 *  RESULTS must be skipped: they ride on role "user" with empty content and carry no language at all. */
export function lastReaderTextOf(
  messages: readonly { role: string; content: string; toolResult?: unknown }[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && !m.toolResult && m.content && m.content.trim()) return m.content;
  }
  return null;
}

// ── ★ THE PER-TURN LANGUAGE DIRECTIVE — the fix for a measured mirroring failure. ──────────────────
//
// ⚠ THE BUG. A reader asked "what is my name?" in plain English, mid-conversation, and got HINGLISH back.
// LANGUAGE_MIRROR already says to follow "the reader's own most recent message", so the rule was not
// missing — it was OUTVOTED. Every turn resends the full transcript, so the model weighs twenty Hinglish
// turns against one English message and follows the mass. A global instruction about recency cannot win
// an argument with the bulk of the context window.
//
// THE FIX IS TO STOP ASKING. The register of the CURRENT message is computed deterministically here (the
// same detector the fair-use warning and Layer-3 redirect use, already pinned against the live corpus)
// and stated as a fact in the system prompt, which `resolveTurnSystem` rebuilds every turn. The model no
// longer has to infer recency from history; it is told what this message is.
//
// COST: ~20 tokens on every message, because the system prompt is per-turn. That is a real ongoing cost
// and it is worth it — the alternative is a reader being answered in a language they did not write in,
// which is the most visible possible failure of the mirror.
//
// ⚠ LIMIT, STATED: the detector can under-fire on a very short Hinglish message ("haa", "theek") and call
// it English. The consequence is a reply in English to a two-word Hinglish message — the same behaviour as
// before the mirror existed, so the failure degrades to the old default rather than to something worse.
// It never mislabels English as Hinglish, which is the direction that would be actively wrong.
const REGISTER_LABEL: Record<ReaderRegister, string> = {
  en: "English",
  hi: "Hinglish (Hindi written in Latin letters)",
  dv: "Hindi in Devanagari script",
};

export function buildCurrentTurnLanguageDirective(register: ReaderRegister): string {
  return (
    `⚠ THE READER'S CURRENT MESSAGE — the one you are answering right now — IS IN ${REGISTER_LABEL[register]}. ` +
    `Answer THIS message in ${REGISTER_LABEL[register]}, whatever language the earlier turns of this ` +
    `conversation used. A reader who switches language expects you to switch with them, immediately.`
  );
}

/** Build the fixed redirect for a given subject, in the reader's register. `subjectLabel` is a human
 *  phrase ("HDFCBANK", "your portfolio", "share pledging"). Deterministic — no model call, no invented
 *  facts. Each variant says the same three things: the boundary, what CAN be described, and a real door. */
export function buildLayer3Redirect(subjectLabel: string, register: ReaderRegister = "en"): string {
  const subject = subjectLabel && subjectLabel.trim() ? subjectLabel.trim() : "this";
  if (register === "dv") {
    return (
      `मैं यह समझा सकता हूँ कि इन नंबरों का मतलब क्या है, लेकिन यह नहीं बता सकता कि आपको इनके साथ क्या करना है। ` +
      `${subject} के बारे में मैं यह बता सकता हूँ: health read का हर हिस्सा असल में क्या मापता है और उसे क्या चला रहा है, ` +
      `कोई metric अपने bar, अपने peers और अपनी ही history के मुकाबले कहाँ खड़ा है, और कोई finding क्या कहती है और क्या ` +
      `नहीं कहती। इनमें से किसी के बारे में पूछिए, मैं विस्तार से समझा दूँगा।`
    );
  }
  if (register === "hi") {
    return (
      `Main ye samjha sakta hoon ki in numbers ka matlab kya hai, lekin ye nahi bata sakta ki aapko inke ` +
      `saath kya karna hai. ${subject} ke baare mein main ye bata sakta hoon: health read ka har hissa asal ` +
      `mein kya measure karta hai aur use kya chala raha hai, koi metric apne bar, apne peers aur apni hi ` +
      `history ke muqable kahan khada hai, aur koi finding kya kehti hai aur kya nahi kehti. Inmein se kisi ` +
      `ke baare mein poochiye, main detail mein samjha dunga.`
    );
  }
  return (
    `${LAYER3_REDIRECT_LEAD} Here's what I can describe about ${subject}: what each part of the health ` +
    `read actually measures and what's driving it, how a metric compares against the bar, its peers and ` +
    `its own history, and what any finding does and doesn't imply. Ask me about any of those and I'll walk ` +
    `you through it.`
  );
}

// ── THE FAIR-USE WARNING — served when the moderation gate fires, on either side. ─────────────────
//
// ONE constant, the SAME every time. No escalation, no counters, no session ending (ruled): a reader who
// wanders somewhere they shouldn't gets told once, plainly, and is pointed back at what this is for. A
// gate that escalates needs state, and state here means keeping a record of someone's worst moment —
// which is a worse thing to build than the gap it closes.
//
// It states three things and nothing else: this is outside what Vytal is for, that kind of use is against
// the fair-use terms, and here is what I can actually do. No lecture, no diagnosis of the reader, no
// speculation about why they asked.
//
// Served in the reader's own register for the same reason the Layer-3 redirect is (see below): the
// moderation gate is reachable in every language the mirror invites, so a wall of English would land on
// exactly the reader who was writing in something else.
const FAIR_USE_EN =
  "That's outside what I'm here for, and that kind of request falls foul of Vytal's fair-use terms. " +
  "I'm the assistant for Vytal's stock and portfolio health — I can explain what a company's numbers " +
  "say, what any part of a health read measures, how a metric compares against its bar, its peers and " +
  "its own history, or walk you through your own holdings and watchlist. Ask me any of that and I'll " +
  "pick it up from there.";

const FAIR_USE_HI =
  "Ye us daayre se bahar hai jiske liye main hoon, aur is tarah ki request Vytal ke fair-use terms ke " +
  "khilaaf hai. Main Vytal ke stock aur portfolio health ka assistant hoon — main ye samjha sakta hoon " +
  "ki kisi company ke numbers kya keh rahe hain, health read ka koi hissa kya measure karta hai, koi " +
  "metric apne bar, apne peers aur apni hi history ke muqable kahan khada hai, ya aapke apne holdings " +
  "aur watchlist ke baare mein baat kar sakta hoon. Inmein se kuch bhi poochiye.";

const FAIR_USE_DV =
  "यह उस दायरे से बाहर है जिसके लिए मैं हूँ, और इस तरह का अनुरोध Vytal की fair-use शर्तों के विरुद्ध है। " +
  "मैं Vytal के stock और portfolio health का assistant हूँ — मैं यह समझा सकता हूँ कि किसी कंपनी के नंबर क्या कह रहे हैं, " +
  "health read का कोई हिस्सा क्या मापता है, कोई metric अपने bar, अपने peers और अपनी ही history के मुकाबले कहाँ खड़ा है, " +
  "या आपके अपने holdings और watchlist के बारे में बात कर सकता हूँ। इनमें से कुछ भी पूछिए।";

/** The fair-use warning in the reader's register. Deterministic — no model call, no invented content. */
export function buildFairUseWarning(register: ReaderRegister = "en"): string {
  return register === "dv" ? FAIR_USE_DV : register === "hi" ? FAIR_USE_HI : FAIR_USE_EN;
}

// ── THE EMPTY-GENERATION FALLBACKS — what the reader sees when the model delivers nothing. ─────────
//
// ★ A BLANK MESSAGE BUBBLE IS NEVER AN ACCEPTABLE ANSWER. It reads as the product being broken, and it
// gives the reader nothing to do next. It happens: a terminal generation can come back with empty text
// after a tool round, or when the round cap forces a final no-tools answer the model has nothing left
// to write. Observed twice in one live pass, so this is not hypothetical.
//
// Same discipline as the Layer-3 redirect: honest about the limit, in voice, no apology spiral, and it
// ends with a real door rather than a wall. Two of them, because the two causes deserve different
// invitations — "say it again" is useless advice when the actual problem was that the question needed
// more lookups than one turn allows.
export const EMPTY_REPLY_FALLBACK =
  "Something went wrong on my side and I didn't manage to put an answer together. Nothing has been " +
  "changed. Ask me again — rephrasing it slightly usually helps — and I'll pick it up from there.";

export const TOOL_CAP_FALLBACK =
  "That needed more looking up than I can do in one go, so I've stopped rather than give you half an " +
  "answer. Nothing has been changed. Narrow it down for me — one company, or one thing you want to " +
  "know about it — and I'll take it from there.";

/** Is a terminal generation actually empty? Whitespace-only counts: it renders as blank. */
export const isBlankReply = (text: string | null | undefined): boolean => !text || text.trim() === "";

// ── THE ORIENTATION HEADER — ~40 tokens on EVERY session, so the model never speaks as if the reader ──
// has no book (or assumes one they don't have). Facts about the reader, explicitly framed as USE-not-narrate.
export interface OrientationInput {
  hasHoldings: boolean;
  /** Coverage fraction 0–1 (scored value share) — only meaningful when hasHoldings. null ⇒ omit the clause. */
  coverage: number | null;
  toneLevel: ToneLevel;
  /**
   * The reader's own preferred short name — `user_ledger.display_name`, set during onboarding ("Arman",
   * "AKJ"). null ⇒ the name clause is omitted entirely and the model simply never uses one.
   *
   * ⚠ NOT `public.users.name`, WHICH DOES NOT EXIST. The name lives in two places: the OAuth metadata on
   * `auth.users.raw_user_meta_data` (the full legal-ish name, "Arman Shaikh") and `user_ledger.display_name`
   * (the SHORT form the reader chose, "Arman"). The ledger one is right for three reasons: it is what the
   * reader picked for themselves, it is already in Prisma's model graph so no cross-schema raw query is
   * needed, and `resolveToneForUser` ALREADY loads that row — so the name costs zero extra reads.
   */
  displayName: string | null;
  /**
   * A form of address the reader ASKED FOR in conversation and confirmed — `chat_reader_profile.stated_name`
   * ("call me Ronaldo"). null ⇒ they never asked, and `displayName` stands alone.
   *
   * ★ IT OUTRANKS `displayName` WHENEVER BOTH EXIST, without exception. The account name was typed once
   * during onboarding; this was typed to the assistant's face, about the assistant. A product that stores
   * "call me Ronaldo", confirms it, and then keeps saying "Arman" has done something worse than not
   * offering memory at all.
   *
   * ⚠ NOT GATED BY `AI_PROFILE_INJECT`. That flag holds back INFERENCES; this is an instruction. See
   * chat/memory.ts §statedNameFor.
   */
  statedName?: string | null;
  /**
   * Things the reader EXPLICITLY ASKED to be remembered (chat/memory.ts). Empty array ⇒ no clause at all.
   *
   * ⚠ GATED BY THE SAME SWITCH AS THE DISTILLED PROFILE (`AI_PROFILE_INJECT`). Stated memories accumulate
   * from the moment the tools ship, but reach a reply only when injection is switched on — ONE switch for
   * everything the assistant remembers, so there is never a state where half of it is live.
   *
   * ★ UNLIKE the rest of this block, these are the reader's OWN WORDS about how they want to be spoken to.
   * They are still not to be narrated back ("you told me you prefer detail") — they are to be OBEYED.
   */
  statedMemories?: string[];
}

export function buildOrientationHeader(o: OrientationInput): string {
  const L: string[] = [];
  L.push(
    "[ABOUT THE READER] (context to pitch this explanation — USE it to choose emphasis and examples; " +
      "NEVER narrate it back or report their behaviour)",
  );
  // ★ THE NAME IS THE ONE PIECE OF READER CONTEXT THAT IS MEANT TO BE SPOKEN ALOUD — and it is therefore
  // the one exception to CHAT_USE_DONT_NARRATE, stated inline so the two rules cannot be read as
  // contradicting each other. Everything else in this block shapes the answer silently; a name is for
  // addressing someone.
  //
  // ⚠ THE FAILURE MODE IS OVERUSE, NOT UNDERUSE. A model handed a name will open every single reply with
  // it ("Arman, the Foundation pillar…"), which reads like a call-centre script and gets grating by the
  // third message. So the instruction is specific about WHERE it fits: greetings and direct address,
  // occasionally, the way a person would.
  //
  // ★ AND THE REQUESTED FORM OF ADDRESS WINS OVER THE ACCOUNT NAME. Both are rendered when they differ,
  // because "what's my name?" then has a truthful, complete answer available — the name they asked for,
  // and the one on the account — rather than a model choosing which half to admit to.
  const address = o.statedName?.trim() || null;
  const account = o.displayName?.trim() || null;
  if (address && account && address.toLowerCase() !== account.toLowerCase()) {
    L.push(
      `Name: ${address} — the reader ASKED to be called this, so use it; their account name is ${account}, ` +
        `and the name they asked for wins. Use it the way a person would: in a greeting or a direct ` +
        `address, sparingly. Do NOT open every reply with it.`,
    );
  } else if (address || account) {
    L.push(
      `Name: ${address ?? account} — use it the way a person would: in a greeting or a direct address, ` +
        `sparingly. Do NOT open every reply with it.`,
    );
  }
  // ★ These are the reader's OWN INSTRUCTIONS about how to be spoken to — the one part of this block
  // that is not an inference. They are still not narrated back; they are simply obeyed. `L` is
  // newline-joined at the end, so each memory is its own pushed line rather than an embedded escape.
  if (o.statedMemories && o.statedMemories.length) {
    L.push("Things this reader asked you to remember — follow them; do not read them back or mention that they asked:");
    for (const m of o.statedMemories) L.push(`· ${m}`);
  }
  if (o.hasHoldings) {
    const cov =
      o.coverage != null && Number.isFinite(o.coverage)
        ? ` — Vytal scores about ${Math.round(o.coverage * 100)}% of it by value`
        : "";
    L.push(`Has a portfolio tracked in Vytal: yes${cov}`);
  } else {
    L.push("Has a portfolio tracked in Vytal: no — the reader is orienting, not holding a book here");
  }
  L.push(`Explanation level: ${o.toneLevel} (of plain / balanced / technical)`);
  return L.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE CHAT-PAGE OPENING TERMINATOR — the one thing a blank session's message[0] was missing. ★★★
//
// ⚠ THE DEFECT IT FIXES, PRECISELY. A blank chat-page session's message[0] is the orientation header and
// NOTHING ELSE — a `role: "user"` row carrying server-written notes ABOUT the reader, with nothing asked
// and no assistant turn after it. So the reader's first message arrives as a SECOND CONSECUTIVE user turn,
// pressed directly against a block whose own first line says "USE it … NEVER narrate it back".
//
// Measured, same sentence, position varied: "I prefer detailed explanations" called rememberThis 2/2 as a
// FOLLOW-UP turn and 0/2 as the FIRST turn — sometimes answered with a bare "Hello Arman. How can I help
// you explore Vytal today?" that engaged with none of it, sometimes with "I've noted that" and no tool
// call. Both are the same root cause: with no boundary and no role change, a reader sentence that reads
// like reader-context gets absorbed INTO the context — and the context's own instruction is not to act on
// it. A question ("what's TCS's ROCE?") survives because it cannot be mistaken for a note about a person;
// a bare statement of preference is exactly what the orientation is made of, so it dissolves into it.
//
// ★ WHY THE PANEL NEVER HAD THIS. A discuss opening is a COMPLETE turn — fact block, orientation,
// relationship, and a real ask — and it is answered by a persisted assistant opening. Roles alternate, and
// the reader's first message is an ordinary follow-up. chat_page's message[0] is the only dangling
// half-turn in the product, which is why this terminator is scoped to it and nothing else.
//
// ⚠ AND WHY IT IS NOT A TOOL-DESCRIPTION FIX. Two rewrites of rememberThis's description moved this zero
// percent, which is the evidence that the tool layer was never where it lived.
export const CHAT_PAGE_OPENING_BOUNDARY =
  "— END OF SYSTEM CONTEXT —\n" +
  "Everything above was written by the system about the reader. The reader did not say any of it and has " +
  "not asked you anything yet. THE NEXT MESSAGE IS THEIR FIRST WORDS TO YOU. Read it as a message that " +
  "opens the conversation and respond to it on its own terms: answer a question, act on an instruction, " +
  "call whatever tool it calls for. Do NOT read it as more of the context above, and do NOT reply with a " +
  "generic greeting that leaves what they actually said unanswered.";

// ── THE WRITE DISCIPLINE (Stage 3) — the rule behind every propose→confirm→execute tool. ───────────
// Each write tool's own description says this too, and so does every proposal result. That triplication
// is deliberate: the failure it prevents — saying "done" when nothing has been written — is the single
// most expensive thing this assistant can do, because the reader stops checking. Repetition is cheap.
//
// It also states the ONE thing no individual tool description can: that "yes" is scoped to the message
// it answers. The model must not hold a proposal open across a digression, because the server will not.
export const CHAT_WRITE_DISCIPLINE =
  "ABOUT MAKING CHANGES — some tools can change the reader's data: their watchlist, their alerts, their " +
  "event reminders, their portfolio ledger, and what you remember about them. NONE of them writes anything when you call it. Each one " +
  "PROPOSES: it validates what you sent, and hands back the exact values that would be written. " +
  "WHAT YOU MUST DO WITH A PROPOSAL: state every value it lists back to the reader in plain words, and ask " +
  "them to confirm. Never say a change is done, saved, added, set, or recorded on the strength of a " +
  "proposal — at that moment nothing has happened, and telling the reader otherwise is the worst error you " +
  "can make here, because they will stop checking. Only `confirmPendingAction` writes anything, and only " +
  "call it when the reader has clearly agreed to what you just described. If you are unsure whether they " +
  "agreed, ask — do not assume. " +
  "A proposal lasts for ONE exchange: if the reader asks something else instead, it is discarded and you " +
  "must propose again from scratch rather than referring back to it. Only one change can be pending at a " +
  "time, so proposing a second replaces the first. " +
  "Describing a change is not recommending it: say what it would do, never whether they should do it. " +
  "★ MEMORY IS A CHANGE LIKE ANY OTHER, AND THIS IS THE ONE MOST EASILY FAKED. If the reader asks you to " +
  "remember, note or keep something in mind, you MUST call `rememberThis` — and it proposes, so you then " +
  "ask them to confirm. Simply replying \"I'll remember that\" or \"noted\" without calling the tool " +
  "stores NOTHING: the next conversation will have no idea, and the reader will believe otherwise. That is " +
  "the same lie as saying an alert was set when it was not. Likewise, to say what you remember you must " +
  "call `listMemories` rather than recalling from this conversation, and to forget something you must call " +
  "`forgetMemory`. Never claim any of these three happened on your own word alone. " +
  "★★ THE SUBTLE FORM — OBEYING INSTEAD OF STORING. When the reader states a standing preference as an " +
  "INSTRUCTION — \"I like short answers\", \"always keep it brief\", \"don't use jargon with me\", \"stop " +
  "explaining the basics\" — the easy move is to simply comply: \"Got it, I'll keep it short.\" That is " +
  "the SAME FAILURE as \"noted\", and it hides better, because you did visibly do something. You obeyed " +
  "for one reply and stored nothing, so it is gone by the next conversation and the reader has to say it " +
  "again — while your answer implied it was handled for good. DO BOTH: comply in this reply AND call " +
  "`rememberThis`. Complying is not remembering. " +
  "This applies only to STANDING preferences. \"Explain that simply\" or \"shorter please\" about the " +
  "answer in front of them is a request for THAT answer — just do it, and store nothing.";

// ── THE EXTERNAL-SOURCE FOOTER — DISCLAIMER + CITATIONS, both STRUCTURAL. ─────────────────────────
//
// ★ THE RULING, AND WHY. getStockNews's own header instructs the model to attribute every external claim
// to the publication that made it, and that instruction is worth having. But it is an instruction, and
// this assistant runs on the weaker instruction-follower BY DESIGN — the same premise that makes
// guardrail.ts a gate rather than a request. Two things are therefore taken away from the model:
//
//   · THE DISCLAIMER. The line that tells a reader "these headlines are not Vytal's and Vytal has not
//     verified them" must not go missing on the turn the model gets terse.
//   · ★ THE LINKS. Measured live: asked to write the article URL itself, the model produced
//     `https://www.google.com/goto?url=CAESswEB7keqTecMraDygoOruV_7WA31…` — a redirect that was in no
//     tool result — having produced the correct URL on the previous run. An intermittently fabricated
//     citation is worse than none, because it is the one thing a reader would use to check us. So the
//     server renders the real URLs from the tool's own payload, and the tool's header tells the model
//     not to write a URL at all.
//
// Appended ONLY when external items were actually delivered — an honest-empty news result has nothing to
// disclaim or cite — and never onto a guardrail redirect, which carries no news.
export const EXTERNAL_SOURCE_DISCLAIMER =
  "_The headlines below came from the public web, not from Vytal. Vytal has not verified them, and they " +
  "are not part of its health data._";

/** Markdown link text is not a safe place for brackets — they break the link. */
const linkText = (s: string): string => s.replace(/\[/g, "(").replace(/\]/g, ")").trim();

/** The footer: the disclaimer, then every external item as a real, checkable link. */
export function buildExternalSourcesBlock(citations: { title: string; source: string; date: string; url: string }[]): string {
  const lines = citations
    .filter((c) => c.url)
    .map((c) => {
      const tail = [c.source || null, c.date || null].filter(Boolean).join(" · ");
      return `- [${linkText(c.title) || c.url}](${c.url})${tail ? ` — ${tail}` : ""}`;
    });
  return [EXTERNAL_SOURCE_DISCLAIMER, "", ...lines].join("\n");
}

/** Append the disclaimer + citations to a delivered reply. Idempotent; a blank reply is left alone. */
export function withExternalSources(text: string, citations: { title: string; source: string; date: string; url: string }[]): string {
  if (isBlankReply(text) || !citations.length) return text;
  if (text.includes(EXTERNAL_SOURCE_DISCLAIMER)) return text;
  return `${text.trimEnd()}\n\n${buildExternalSourcesBlock(citations)}`;
}

// ── THE IN-APP LINK FOOTER — same discipline, opposite claim. ─────────────────────────────────────
//
// A `klass:"action"` tool validates a destination and offers it; the server renders the link. The
// reasoning is the news tool's, transplanted: the model demonstrably writes links that do not exist,
// and a path it derives from a company NAME rather than a ticker ("/comparison/TCS-vs-INFOSYS") is
// well-formed enough to survive the route's own slug check and fail only after the reader clicks.
//
// ⚠ NO DISCLAIMER HERE, DELIBERATELY. This is Vytal's own page, validated against Vytal's universe —
// the external-source line would be an outright false statement about it. Separate field, separate
// footer, and the app link is rendered ABOVE the external block so that when a turn carries both, the
// "not verified by Vytal" sentence still sits last, attached to the thing it is about.
export function buildAppLinksBlock(links: { label: string; path: string }[]): string {
  return links.filter((l) => l.path.startsWith("/")).map((l) => `→ [${l.label}](${l.path})`).join("\n");
}

/** Append validated in-app links to a delivered reply. Idempotent per path; blank replies left alone. */
export function withAppLinks(text: string, links: { label: string; path: string }[]): string {
  if (isBlankReply(text) || !links.length) return text;
  const fresh = links.filter((l) => l.path.startsWith("/") && !text.includes(`(${l.path})`));
  if (!fresh.length) return text;
  return `${text.trimEnd()}\n\n${buildAppLinksBlock(fresh)}`;
}

/** Assemble the system instruction: how to speak (tone + the non-advisory spine) + the model of health
 *  (context layer) + the personalization rule + the write discipline. The fact block is NOT here — it
 *  rides in the opening user message (message[0]) and is carried through history, so the system prompt is
 *  stable across turns. */
export function buildSystemPrompt(toneSystemDirective: string): string {
  return [toneSystemDirective, VYTAL_CONTEXT_LAYER, CHAT_USE_DONT_NARRATE, CHAT_WRITE_DISCIPLINE].join("\n\n");
}
