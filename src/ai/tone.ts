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
// FIVE INVARIANT CLAUSES are baked into EVERY directive via shared constants, so none can be
// dropped or varied per user:
//   • EXPLANATORY DEPTH — a question about Vytal's own product earns a real explanation, shaped
//     by the question and sized by the reader's own depth setting (it never overrides that setting).
//   • THE COMPANY-ANSWER SHAPE — a question about a company's own numbers is answered with those
//     numbers: lead with a figure, group them, say what differs most from its own context. Same
//     sovereignty rule as its sibling above — the reader's length setting outranks it.
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

// ── The explanatory-depth clause — the SHAPE of an answer about Vytal's own product ──────────
//
// A named constant for the same reason as the three invariants below it: it must not vary by user,
// so it does not belong in a level-keyed table where one branch can quietly lose it. It sits AFTER
// DEPTH_CLAUSE (it is a depth rule, and must be read in the light of the length it just set) and
// BEFORE the invariant trio, whose documented order ends in the spine and is not disturbed.
//
// ★★★ SHAPE FOLLOWS THE QUESTION, LENGTH FOLLOWS THE READER — the ruling this clause is built around.
// The obvious reading of "answer product questions in structured depth" is that it overrides a concise
// setting. It must NOT: aiLevel is sovereign (see the header), and a `plain` + `casual` reader resolves
// to DEPTH_CLAUSE.concise — "keep it short". If this clause overrode that, the depth axis would be
// silently dead for the one population that most needs it short.
//
// ⚠ THE FIRST DRAFT GOT THIS WRONG AND THE LIVE A/B CAUGHT IT. It said "a SHORT structured answer — the
// same parts, each a line or two", which pins the part COUNT and varies only their length. That leaves a
// `plain` reader with upward pressure and no downward pressure: LEVEL_INTRO.plain asks for "concrete
// examples" and this clause asked for four parts plus an example, both fighting "omit secondary detail".
// Measured: the concise reader's answer came back LONGER than the default reader's (268 vs 231 words) on
// the same question. So the clause now scales the COUNT too — fewer parts and shorter parts, drop the
// example rather than stretch to fit it — and says outright that the length instruction outranks it.
// Pinned by verify-depth-ab.ts, which runs both arms repeatedly because a single pair proves nothing:
// the first pass happened to read 284 vs 218 and looked like a pass on pure noise.
//
// ★★ THE SECOND HALF IS THE IMPORTANT HALF, AND IT IS COUNTER-INTUITIVE. Handing a model a section
// shape creates pressure to FILL every section, and the only way to fill an ungrounded one is to
// invent it. So the clause spends more words forbidding completion than describing the shape:
// a part you cannot ground is dropped silently. Structure is permission to organise what is known.
// This is what stops a page-inventory (context-layer §THE PAGES) from becoming a confabulation
// engine — the two changes ship together and the second is the safety catch on the first.
//
// ⚠ THE LAST CLAUSE IS AIMED AT ONE MEASURED FAILURE. Asked "which stocks show this right now",
// with no way to query the universe, the model previously converted its own inability into a fact
// about the product ("Vytal doesn't run broad market scans"). "I cannot pull that here" and "Vytal
// cannot do that" are different sentences and only the first is true; the clause says so explicitly.
export const EXPLANATORY_DEPTH =
  "EXPLAINING VYTAL ITSELF. When the reader asks what one of Vytal's pages, tools or ideas IS, how it " +
  "WORKS, or asks you to explain one, give a real explanation rather than a sentence: what it is, how it " +
  "actually works, why it is worth looking at, and a short invented example that makes it concrete. Use " +
  "plain headed prose or a few short labelled parts. Never print section numbers, never emit the same " +
  "skeleton twice, and never announce the shape before using it. " +
  "★ DEPTH FOLLOWS THE QUESTION. \"What is X\", \"how does X work\" and \"explain X\" earn the full shape. " +
  "\"Does Vytal have X\" earns a short, direct answer — yes or no, a line on what it is — and then an offer " +
  "to go deeper: a many-part essay in reply to a yes-or-no question is a WORSE answer, not a fuller one. " +
  "Something mentioned in passing while you are discussing another thing earns a clause, not a detour. " +
  "★ YOUR LENGTH INSTRUCTION ABOVE STILL GOVERNS, AND IT OUTRANKS THIS ONE. A structured answer is not a " +
  "long answer. If you were told to keep answers short, keep this short: FEWER parts AND shorter parts — " +
  "two or three, a line or two each, and drop the example rather than stretch to fit it. If you were told " +
  "to be thorough, spend the room. The shape scales with the reader; it never argues with them. An answer " +
  "that is longer than the reader asked for has disobeyed the instruction that matters more than this one. " +
  "★★ A PART YOU CANNOT GROUND IS LEFT OUT, NEVER FILLED. This matters more than covering the shape. Being " +
  "handed a shape creates a pull to produce every part of it, and the only way an empty part gets filled is " +
  "by inventing what would plausibly belong there. If what you were given does not support a part, drop it " +
  "without comment, or say plainly that you cannot pull that. A structure is permission to organise what you " +
  "know; it is never licence to complete a pattern. Four grounded parts beat six with two invented. " +
  "★ WHEN YOU CANNOT LOOK SOMETHING UP, SAY THAT — and never turn it into a fact about Vytal. Asked which " +
  "specific stocks are in some state right now, with no way to fetch it, the honest answer is that you " +
  "cannot pull that list here and the page itself shows it. It is NOT that the data does not exist, NOT " +
  "that Vytal has no such feature, and NOT a list you assemble from memory. Never explain a limit of your " +
  "own as a limitation of the product. " +
  "A verdict on a specific stock is Vytal's, never yours: where a reading has been given to you, use its " +
  "words; where none has, explain the tool and stop short of judging the stock.";

// ── The company-answer clause — the SHAPE of an answer about a COMPANY'S OWN NUMBERS ──────────────
//
// Sibling to EXPLANATORY_DEPTH and deliberately placed IMMEDIATELY AFTER it: that one shapes an answer
// about VYTAL, this one shapes an answer about a COMPANY, and the two are read in the light of the same
// DEPTH_CLAUSE sitting above both. The invariant trio below is untouched and the spine is still last.
//
// ★★★ WHY IT IS HERE AND NOT IN THE TOOL RESULT — THE PLACEMENT WAS THE REAL DECISION.
// The construction-point lesson (searchStocks' bare ticker, screenStocks' invented thresholds,
// getStockFundamentals' zero reach, the per-turn language directive) says a rule loses to whatever is
// adjacent to the words it governs, and a tool result is the LAST thing in the context window before the
// model writes. Three things outweighed that here, and the third is the one that decides it:
//   1. THE PRECEDENT THAT ACTUALLY APPLIES IS EXPLANATORY_DEPTH. Every construction-point instance is
//      about which TOOL to reach for, or about a fact of THIS message. This is an answer-SHAPE rule, and
//      the one answer-shape rule already shipped lives here, was A/B'd here (verify-depth-ab.ts), and
//      works here. Its measured failure was about CONTENT, never about position.
//   2. COST SHAPE, not cost. A system-prompt clause is one copy per generation — linear. A tool-result
//      clause is one copy per tool CALL, and every copy is persisted into history and resent by every
//      later generation of the session, so it compounds. Measured in measure-depth-placement.ts.
//   3. ★ THE SOVEREIGNTY CLAUSE WOULD BE ORPHANED. Ruling 2a is that aiLevel stays sovereign and the
//      reader's length instruction OUTRANKS this rule — the same ruling EXPLANATORY_DEPTH's live A/B
//      had to be rebuilt around. That clause can only be written where there IS an "above" to point at.
//      In a tool result the length instruction is ~21,000 tokens away and unnameable, so the one clause
//      that stops a concise reader being handed a long structured answer would be the clause that could
//      not be stated. Placement follows the rule that must survive, not the rule that must be noticed.
//
// ⚠ IT DOES NOT OVERRIDE RULE 2 OF THE CONTEXT LAYER, AND IT DOES NOT NEED TO — they govern different
// things, which is the whole reconciliation. Rule 2 ("TEACH, don't define… never a one-line gloss") is a
// rule about the QUALITY of an explanation once one is warranted; it says nothing about where the
// explanation sits or what triggers it, and it says so itself: "(Depth is set elsewhere; the stance —
// always illuminate — is fixed here.)" What produced the unprompted dividend definition was not Rule 2
// being too strong, it was Rule 2 being the ONLY instruction in the room about a finance idea, with
// nothing saying when it fires or where it goes. So this clause adds POSITION and leaves depth alone:
// teach as fully as before, beside the figure the idea explains, never in front of it. Nothing in Rule 2
// is weakened, contradicted or restated.
//
// ★★ "WHAT STANDS OUT" IS DEFINED AS ARITHMETIC, ON PURPOSE. "Say what is notable" and "say what is
// impressive" are one word apart and a whole product apart: the first is a comparison the reader can
// check, the second is a verdict Vytal alone gets to pass. The clause therefore defines standing-out as
// the figure that differs most from its OWN context — its history, its neighbours, a given norm — which
// is subtraction, and shows three worked examples of it beside three of the offence. screenStocks
// measured that worked examples in the instruction beat an abstract rule; EXPLANATORY_DEPTH measured
// that the anti-completion half needs more words than the shape half. Both findings are used here.
//
// ⚠ THE ❌ EXAMPLES ARE QUOTED, AND THE QUOTES ARE LOAD-BEARING. They are literal evaluative verdicts,
// so the evaluative tier (ai/guardrail.ts) fires on them as shipped copy unless it can tell a MENTION
// from a USE. That was fixed in the tier, never in this copy — see MENTION_SPAN there, and §4 of
// verify-evaluative-tier.ts, which scans this constant among every other shipped string. If a future
// edit unquotes an ❌ example, the tier will correctly light up on our own prompt.
export const COMPANY_ANSWER_SHAPE =
  "ANSWERING ABOUT A COMPANY — THE FIGURES ARE THE ANSWER. When the reader asks about a particular " +
  "company — its dividends, earnings, results, ownership, price, balance sheet, any of its numbers — the " +
  "figures you were given ARE the answer. Give them. " +
  "★ THE FIRST SENTENCE CARRIES A FIGURE. Never open by repeating the question back, and never open by " +
  'defining a term. "TCS has paid a dividend every year since FY21, rising from Rs 38 to Rs 57" opens an ' +
  'answer; "A dividend is a share of profit paid out to shareholders" does not, and neither does "Let\'s ' +
  'take a look at TCS\'s dividend history". ' +
  "★ TEACHING DOES NOT GO — IT MOVES. Where an idea genuinely needs explaining, explain it as fully as " +
  "you would anywhere else, but in the place the reader meets it: beside the figure it makes sense of, " +
  "after that figure and never in front of it. An explanation is what stops a number being opaque; " +
  "standing alone before any number, it is only a delay. " +
  "★ GROUP THE FIGURES so they can be read — the history together, the latest period together, ownership " +
  "together — as short headed prose, under the same shape rules as above: no section numbers, no reused " +
  "skeleton, no announcing the shape before you use it. " +
  "★★ SAY WHAT STANDS OUT — AND STANDING OUT IS ARITHMETIC, NOT AN OPINION. It is whichever figure " +
  "differs most from its OWN context: its own history, the figures beside it, or a norm you were given. " +
  "Name the difference and let the reader draw the conclusion. " +
  '✅ "Rs 46 of that Rs 57 was a special dividend — a one-off." ' +
  '✅ "The payout ratio fell from 92% in FY25 to 80% in FY26." ' +
  '✅ "Promoter holding has not moved in eight quarters; institutions added three points last quarter." ' +
  '❌ "That is a generous payout." ❌ "The margins look impressive." ❌ "This is a strong record." ' +
  "The first three say what is DIFFERENT and leave the judging to the reader. The last three grade the " +
  "company, and that verdict is Vytal's to pass, never yours. " +
  "★★ A PART YOU CANNOT GROUND IS LEFT OUT, NEVER FILLED — the same rule as above, and figures pull " +
  "hardest against it, because a half-finished row, series or comparison begs to be completed and the " +
  "only way to complete it is to invent. Four years of dividends is four years, not five. No payout ratio " +
  "given means no payout ratio in your answer. Never estimate one, never carry a number across from " +
  "another period or another company, and never open a section in order to say it is unavailable. " +
  "★ YOUR LENGTH INSTRUCTION ABOVE STILL GOVERNS AND OUTRANKS THIS ONE. Leading with figures is not " +
  "licence to recite every figure you hold. Told to keep it short: the lead figure and the one thing that " +
  "stands out — a few sentences, not a few sections. Told to be thorough: spend the room. And depth " +
  "follows the question as well as the reader — one figure asked for is one figure answered, and a " +
  "company mentioned in passing earns a clause, not a page.";

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
  parts.push(EXPLANATORY_DEPTH); // ALWAYS present — reads in the light of the DEPTH_CLAUSE above it
  parts.push(COMPANY_ANSWER_SHAPE); // ALWAYS present — its sibling; "as above" points at the two clauses above it
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
