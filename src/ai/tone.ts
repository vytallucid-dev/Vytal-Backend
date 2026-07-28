// ═══════════════════════════════════════════════════════════════════════
// ONBOARDING TONE RESOLVER — turns a user's stored onboarding signals into a tone/depth
// directive that AI callers inject as the system instruction (AiGenerateRequest.system).
//
// DETERMINISTIC + PURE: no AI call here. Phrasing RULES are computed; only downstream prose is
// AI-generated. Live-computed, never stored — a pure function of current state (aiLevel + the
// two ledger facts), so there is no cache to invalidate when the user changes a setting.
//
// aiLevel (UserRegister) is SOVEREIGN: the user's explicit stated preference sets the baseline
// AND the bounds; the ledger facts (finance depth / term comfort) can only refine WITHIN what
// the chosen level permits — they can never flip the tone to something the user didn't ask for.
//
// THREE INVARIANT CLAUSES are baked into EVERY directive via shared constants, so none can be
// dropped or varied per user:
//   • THE NON-ADVISORY SPINE — Vytal describes what IS; it never advises what to do next.
//   • CONVERSATIONAL PRECISION — figures are spoken the way a person says them, at every level.
//   • THE LANGUAGE MIRROR — the reply comes back in the language and script the reader wrote in.
// They are independent: the precision clause never softens the spine, the spine never governs
// phrasing of numbers, and the language mirror governs neither — it only says which language every
// OTHER rule is obeyed in. All three are appended after the level/jargon/depth axes have had their say.
//
// ⚠ THE LANGUAGE MIRROR IS AN AXIS-FREE INVARIANT ON PURPOSE. It is NOT keyed to aiLevel, and there is
// no per-user "preferred language" column: the signal is the reader's own most recent message, which the
// model already has in the transcript. A stored preference would be a second, staler home for a fact the
// conversation states afresh every turn — and it would be wrong the first time a bilingual reader
// switched mid-session, which is exactly what bilingual readers do.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import type { UserLedger, UserRegister } from "../generated/prisma/client.js";

export type ToneLevel = "plain" | "balanced" | "technical";
export type ToneDepth = "concise" | "standard" | "deep";
export type ToneJargon = "avoid" | "gloss" | "assume";

export interface ToneDirective {
  level: ToneLevel; // resolved primary axis (from aiLevel — always authoritative)
  depth: ToneDepth; // detail budget
  jargon: ToneJargon; // term handling
  systemDirective: string; // the deterministic NL instruction injected as AiGenerateRequest.system
}

// ── The non-advisory spine — IDENTICAL in every directive, never varies, never omitted ──────
// One named constant, concatenated into EVERY systemDirective, so the descriptive-not-advisory
// guarantee is structural: no axis, no level, no ledger value can drop or weaken it.
export const NON_ADVISORY_SPINE =
  'Your role is strictly descriptive: explain and contextualize the information so the reader ' +
  'can understand what is happening and why. Do not give financial advice. Never recommend or ' +
  'suggest buying, selling, or holding; never tell the reader what they "should" do; never ' +
  "predict prices, returns, or future performance. Describe what is — the facts, the context, " +
  "and the mechanics — never what to do next. If asked for a recommendation or a prediction, " +
  "lay out the relevant considerations instead and make clear the decision is the reader's own.";

// ── The conversational-precision clause — ALSO in every directive, alongside the spine ──────
// A second named constant for the same reason as the first: a phrasing rule that must never vary
// by user does not belong in a level-keyed table where one branch can quietly lose it.
//
// ★ IT APPLIES AT EVERY LEVEL, INCLUDING technical — and that is the whole point of stating it.
// The intuition it overrides is that a sophisticated reader wants more decimals. They do not: they
// want the number a person would say. Decimals in PROSE are not precision, they are false
// precision — "7.7614%" reads as a measurement when it is a derived share of a book that moves
// every day. Precision lives in the DATA (the fact block carries the raw beside every rounded
// figure); the spoken number is for understanding.
//
// ⚠ THIS DOES NOT LICENSE THE MODEL TO ROUND ANYTHING ITSELF. Grounding pre-computes both forms
// and the closed-world header forbids computing a number — so this clause tells it WHICH of the two
// already-present figures to speak, never to derive a third. The two rules are built to interlock.
export const CONVERSATIONAL_PRECISION =
  "Use approximate, conversational precision for every figure: state numbers the way a person would " +
  'say them aloud. Say "about 80", not "80.09"; "roughly 8%", not "7.76%". Health and construction ' +
  "scores are whole numbers — never quote a decimal place on one. Percentages and shares are whole " +
  'numbers too, and read naturally as approximations ("around a quarter of the book", "just over ' +
  'half"). Where a figure is given to you in both a rounded and a raw form, always speak the rounded ' +
  "one; the raw value is provenance, not something to recite. Never add precision that was not given " +
  "to you, and never compute a new number of your own.";

// ── The language mirror — the THIRD invariant, in every directive, never varied ──────────────
//
// ★ WHY THIS IS A CLAUSE AND NOT A FEATURE. The model can already do this: asked in Hinglish it
// produces fluent Hinglish with the numbers intact and glosses finance terms natively ("share girvi
// (pledging)"). It simply was never told to. Measured in the live corpus: 3 Hinglish questions, 3
// English answers. So the fix is an instruction to MIRROR, not machinery to translate.
//
// ⚠ THE RISK THIS CLAUSE EXISTS TO CLOSE, stated because it is the whole reason the wording is this
// emphatic: a model can treat a language switch as a CONTEXT switch and quietly drop the rules it was
// obeying in English — inventing a number because the fact block is in English, or sliding into advice
// because the descriptive framing felt like an English-language convention. It is not. Every rule holds
// identically in every language, and the clause says so in as many words.
//
// ★★★ MEASURED FAILURE — WHY THIS CLAUSE LEADS WITH "ENGLISH IS THE DEFAULT". ★★★
// The first draft opened with the Hinglish/Devanagari examples and contained the sentence "Do not
// translate the reader into English." Live result: "What does HDFC Bank's Market pillar tell me?" — asked
// in plain English — came back in DEVANAGARI. On a weak instruction-follower a clause is read partly as
// salience, not only as logic: a rule that names Hindi three times and says "do not … English" reads as
// "prefer Hindi". The clause now states the mirror rule first, names English as the default AND the
// fallback BEFORE any other language, and carries no "do not use English" phrasing anywhere. Pinned by
// LIVE 2 in verify-hinglish-live-chat.ts, which is the check that caught it.
// ⚠ Do not reorder these sentences to put the Hindi cases first — that is the exact edit that regressed.
//
// ⚠ VYTAL'S OWN VOCABULARY IS NOT TRANSLATED. "Pristine", "Foundation", "Provisional" are product
// terms — the words on the reader's screen. Translating them would leave the reader unable to match the
// answer to the UI. The EXPLANATION around them adapts; the term stays. This mirrors the vocabulary lock
// in context-layer.ts ("use Vytal's exact words") rather than restating it.
export const LANGUAGE_MIRROR =
  "LANGUAGE — MIRROR THE READER. Write in the same language and script the reader's own most recent " +
  "message used, and never switch them into a language they have not used themselves. " +
  "ENGLISH IS THE DEFAULT AND THE FALLBACK: if the reader writes in English, answer in English. If a " +
  "message mixes languages, follow whichever one dominates it; if it is genuinely ambiguous, answer in " +
  "English. If the reader writes Hindi in Latin letters, answer the same way; if they write in " +
  "Devanagari, answer in Devanagari. Judge this ONLY from what the reader actually wrote — never from " +
  "the language these instructions happen to be written in, and never from a preference of your own. " +
  "Do not announce, explain, or apologise for the language you are using; simply use it, as naturally " +
  "as a person would. " +
  "VYTAL'S OWN VOCABULARY STAYS EXACTLY AS IT IS, in every language: the pillar names (Foundation, " +
  "Momentum, Market, Ownership), the band names (Fragile, Below Par, Steady, Healthy, Pristine), the " +
  "finding tones, and the words Health read, Construction, Coverage and Provisional. Those are the words " +
  "printed on the reader's screen; a translated band name would leave them unable to match your answer " +
  "to what they are looking at. Keep the term, adapt the explanation around it. When a finance concept " +
  "needs explaining, explain it in the reader's own language and give the English term alongside it where " +
  "that helps them read the rest of the app. " +
  "★ EVERY OTHER RULE IN THIS INSTRUCTION APPLIES IDENTICALLY IN WHATEVER LANGUAGE YOU ANSWER IN, " +
  "WITHOUT EXCEPTION — how figures are spoken, using only the numbers you were given, and above all " +
  "being descriptive and never advisory. A change of language is NOT a change of what you are allowed to " +
  "say. Advice is advice in every language, and a number you were not given is invented in every language.";

// Plain-level reinforcement: a beginner most easily misreads explanation as advice, so the
// plain directive doubles down on the descriptive framing (appended before the spine).
const PLAIN_REINFORCE =
  "Because someone new to investing can easily mistake an explanation for a recommendation, be " +
  "especially careful to keep everything framed as description, not guidance.";

// ── Level-keyed phrasing fragments ──────────────────────────────────────────────────────────
const LEVEL_INTRO: Record<ToneLevel, string> = {
  plain: "Speak to someone new to investing. Use simple, everyday language and concrete examples.",
  balanced: "Speak to an informed non-specialist. Use clear language and only common financial terms.",
  technical: "Speak to a financially literate reader. Be precise and rigorous.",
};

const JARGON_CLAUSE: Record<ToneJargon, string> = {
  avoid: "Avoid financial jargon; if a technical term is truly unavoidable, define it in one short phrase.",
  gloss: "You may use common financial terms; briefly gloss the less common ones.",
  assume: "You may use standard financial terminology without defining it.",
};

const DEPTH_CLAUSE: Record<ToneDepth, string> = {
  concise: "Keep it short: lead with the main point and omit secondary detail.",
  standard: "Give a balanced amount of detail: the main point plus its key supporting context.",
  deep: "Be thorough: include supporting detail, the underlying mechanics, and relevant caveats.",
};

// ── Sovereignty model ───────────────────────────────────────────────────────────────────────
// Each axis is an ordinal. aiLevel fixes the BASELINE and the [min,max] the ledger may move
// within — so a "plain" user is never pushed to "assume" jargon, and a "technical" user is
// never pushed to "avoid", no matter what their ledger says. Null/absent ledger ⇒ 0 nudge ⇒
// the level's baseline stands.
const JARGON_ORDER: readonly ToneJargon[] = ["avoid", "gloss", "assume"];
const DEPTH_ORDER: readonly ToneDepth[] = ["concise", "standard", "deep"];

interface AxisSpec {
  base: number;
  min: number;
  max: number;
}
const LEVEL_SPEC: Record<ToneLevel, { jargon: AxisSpec; depth: AxisSpec }> = {
  // plain: never assume jargon (max gloss); light depth (max standard).
  plain: { jargon: { base: 0, min: 0, max: 1 }, depth: { base: 0, min: 0, max: 1 } },
  // balanced: free to flex the full range either way.
  balanced: { jargon: { base: 1, min: 0, max: 2 }, depth: { base: 1, min: 0, max: 2 } },
  // technical: never fully avoid jargon (min gloss); never below standard depth.
  technical: { jargon: { base: 2, min: 1, max: 2 }, depth: { base: 2, min: 1, max: 2 } },
};

// termComfort refines JARGON; financeDepth refines DEPTH. Unknown/null ⇒ 0 (no nudge).
const TERM_COMFORT_JARGON_NUDGE: Record<string, number> = { explain: -1, follow: 0, assume: 1 };
const FINANCE_DEPTH_DEPTH_NUDGE: Record<string, number> = { casual: -1, formal: 0, professional: 1 };

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

function buildDirective(level: ToneLevel, depth: ToneDepth, jargon: ToneJargon): string {
  const parts = [LEVEL_INTRO[level], JARGON_CLAUSE[jargon], DEPTH_CLAUSE[depth]];
  if (level === "plain") parts.push(PLAIN_REINFORCE);
  parts.push(CONVERSATIONAL_PRECISION); // ALWAYS present — a phrasing rule, invariant across levels
  parts.push(LANGUAGE_MIRROR); // ALWAYS present — and it re-asserts, not weakens, the two around it
  parts.push(NON_ADVISORY_SPINE); // ALWAYS last, ALWAYS present — and never weakened by the above
  return parts.join(" ");
}

/**
 * Pure, no I/O. Resolve the tone directive from the two already-loaded onboarding rows (or
 * nulls). aiLevel is authoritative; the ledger only refines within the level's bounds. Every
 * path returns a valid directive — null ledger degrades to the level's baseline, a missing
 * register defaults to "balanced" (the schema's own default). Never throws.
 */
export function resolveTone(register: UserRegister | null, ledger: UserLedger | null): ToneDirective {
  // SOVEREIGNTY: the explicit stated preference wins. Missing register ⇒ "balanced".
  const level: ToneLevel = register?.aiLevel ?? "balanced";
  const spec = LEVEL_SPEC[level];

  const jargonNudge = TERM_COMFORT_JARGON_NUDGE[ledger?.termComfort ?? ""] ?? 0;
  const depthNudge = FINANCE_DEPTH_DEPTH_NUDGE[ledger?.financeDepth ?? ""] ?? 0;

  const jargon = JARGON_ORDER[clamp(spec.jargon.base + jargonNudge, spec.jargon.min, spec.jargon.max)];
  const depth = DEPTH_ORDER[clamp(spec.depth.base + depthNudge, spec.depth.min, spec.depth.max)];

  return { level, depth, jargon, systemDirective: buildDirective(level, depth, jargon) };
}

/**
 * Fetch the two onboarding rows (matching the `me` read pattern) then delegate to resolveTone.
 * Fail-soft: a DB error or missing rows fall back to the balanced default directive — never throws.
 */
export async function resolveToneForUser(userId: string): Promise<ToneDirective> {
  try {
    const [register, ledger] = await Promise.all([
      prisma.userRegister.findUnique({ where: { userId } }),
      prisma.userLedger.findUnique({ where: { userId } }),
    ]);
    return resolveTone(register, ledger);
  } catch (err) {
    console.warn(`[ai/tone] resolve failed, falling back to balanced: ${(err as Error).message}`);
    return resolveTone(null, null);
  }
}
