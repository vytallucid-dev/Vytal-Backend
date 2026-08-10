// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — THE PROMPT.
//
// This is the ONLY place the model's behaviour is specified, and it is the product's first generator
// that runs unattended and stores what it writes. Chat has a human reading every reply within seconds;
// this does not. So the instruction is narrow on purpose and the guards behind it (generate.ts) assume
// it will sometimes be ignored.
//
// ── ★★ STAGE 2 · THE MODEL'S JOB SHRANK, AND THAT IS THE POINT ───────────────────────────────────
// It used to write five prose sections, including the figures. It now writes ONE thing: the takeaway,
// as 1–5 bullets.
//
// Everything else on the card is BACKEND-RENDERED and ships as structured data — Section 1's twelve to
// twenty-four metrics each arrive with a label, a canonical display string, a movement and an authored
// gloss, all computed. Asking a model to re-narrate them would triple the output cost to restate
// strings it was handed, and every restatement is a fresh chance to mistype a figure. The card got
// four to eight times richer while the model's surface got smaller. Those are the same change.
//
// ── ★ THE VERDICT IS NOW AN INPUT FACT (Stage 2 ruling), AND THE ENFORCEMENT MOVED ───────────────
// It used to be WITHHELD — the model could not restate what it never saw, and the badge was rendered
// beside the prose from the computed value. The ruling is that the model now writes the takeaway from
// the computed facts, so it must be handed the verdict to place it.
//
// ⚠ THAT IS A REAL DOWNGRADE IN GUARANTEE AND IT IS WORTH NAMING. "Structurally impossible to
// contradict" became "instructed not to, and checked". What replaces the withholding is narrower: the
// verdict arrives as a LABEL and a MEANING, both pre-written, both in the grounding haystack, and the
// model is told to use that wording rather than characterise the quarter itself. It never receives the
// ruleset, so it still cannot re-derive a direction — it can only place the one it was given.
// ⚠ AND THE FEED NO LONGER CARRIES A CHIP. A model-placed label on a grid, inches from a coloured
// health band, would read as a second computed rating. See results-feed.cache.ts.
//
// ── ★★ STAGE 5 · THE MODEL NO LONGER WRITES A DOCUMENT, IT ANSWERS A QUESTION ───────────────────
// It now returns a three-field JSON object: `bullets` (authored), `verdictLabel` and `verdictMeaning`
// (copied, and checked by equality — see schema.ts). It emits no headings, no markdown and no
// document structure of any kind, because the structure is now the schema's key set.
//
// TWO THINGS WERE DELETED RATHER THAN ADAPTED, AND THE DISTINCTION MATTERS:
//   · ALLOWED_HEADINGS and generate.ts's `unknownHeadings` guard. Under a schema the model CANNOT
//     invent a heading, so that guard could never fire again — and a guard that cannot fire is worse
//     than no guard, because it reads as evidence the case is covered. Its replacement is the schema
//     plus the empty-section check.
//   · The FORM instruction about headings, titles and where to begin and end. Two authorities on one
//     decision is how they drift; the schema is now the only one.
//
// ── ★ STAGE 4 · THE ANNUAL BLOCK, AND WHY ITS LABEL IS LOAD-BEARING ─────────────────────────────
// On Q4 the fact text now carries a SECOND set of figures covering twelve months, in the same units,
// eight lines below the quarter's. Nothing about that is ambiguous to the backend and everything about
// it is ambiguous to a model reading two ₹-crore lists in one prompt. So the heading names the period,
// the FORM section forbids calling one the other, and where the company's year-end is NOT the
// quarter's own last day the block opens with the as-at date and an instruction to carry it. That last
// case is 0.2% of rows, which is exactly why it needs saying: on 99.8% of cards the two dates are the
// same, and a model — like a reader — learns from the common case.
//
// ── ⚠ THE FACT TEXT IS ALSO THE GROUNDING HAYSTACK ──────────────────────────────────────────────────
// `renderFactText` emits DISPLAY STRINGS ONLY — never the raw numeric behind them. Two consequences,
// both wanted:
//   · The model can only reproduce forms it was given ("₹15,548 crore"), so the tightest possible
//     rendering is also the only one it can write.
//   · generate.ts passes THIS EXACT STRING (plus the system prompt) as the number-grounding haystack,
//     so the haystack cannot drift from what the model actually saw. See number-grounding.ts's header:
//     a caller that narrows the haystack has rebuilt the blind version of the scan.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { movementWithAnchor } from "./anchors.js";
import { CLOSED_WORLD_HEADER } from "../../ai/grounding.js";
// ★ REUSED, NOT REIMPLEMENTED — the shared corporate-suffix strip. See briefProseName below for what
// it does and does not cover, and why this file adds two steps on top rather than forking it.
import { shortenCompanyName } from "../../chat/web/news-filter.js";
import { prettyDate } from "./format.js";
import { MAX_TAKEAWAY_BULLETS } from "./schema.js";
import { buildStory } from "./story.js";
import type { QuarterBriefFactBlock } from "./types.js";

export const QUARTER_BRIEF_SYSTEM = [
  "You are writing the \"takeaway\" for Vytal's Quarter in Brief: a few plain-language sentences about",
  "one company's quarterly results, for a reader who has never read a financial statement and does not",
  "know what a margin or a balance sheet is.",
  "",
  CLOSED_WORLD_HEADER,
  "",
  "WHAT YOU RETURN",
  "A JSON object with these keys and no others:",
  `  bullets         — between 1 and ${MAX_TAKEAWAY_BULLETS} sentences. This is the only thing you write.`,
  "  verdictLabel    — the label from the OVERALL line below, copied exactly. Omit the key entirely if",
  "                    there is no OVERALL line.",
  "  verdictMeaning  — the sentence after that label, copied exactly. Omit it if there is no OVERALL line.",
  "The two copied fields are checked character for character against what you were given. Do not",
  "reword, re-punctuate, shorten or improve them. Copying is the whole task for those two.",
  "",
  "Every other part of this card — the figures, what each one means, the full-year figures, the health",
  "score, the gaps — is already written and shown to the reader, and is added around your answer. You",
  "are not repeating any of it. You are saying what the quarter adds up to, using only the facts below.",
  "",
  "HOW MANY BULLETS",
  "As many as the facts support and NO MORE. A quarter where nothing much happened gets one.",
  "Do not pad to reach a number. A bullet that restates another bullet is worse than no bullet.",
  "- If there is no OVERALL line and only one numbered group below, then the facts support ONE bullet",
  "  and it says so. Listing the figures back is not a bullet: they are already on the card, directly",
  "  under yours, and repeating them in a sentence tells the reader nothing new.",
  "",
  "WHAT EACH BULLET IS",
  "- One sentence. Two at most, and only if the second says something the first could not.",
  "- Start with the overall reading, using the OVERALL wording you were given rather than your own.",
  "- Plain text. No markdown, no bullet characters, no headings — each sentence is one array item.",
  "",
  // ── ★★ STAGE 3 · THE CHAIN. THE ORDER IS GIVEN; THE CONNECTIONS ARE NOT YOURS TO MAKE ─────────
  // The facts arrive in numbered groups whose headings name the link between them. A model told to
  // "write a story" over a flat list invents the connections, which is precisely where fabricated
  // causation comes from. It is told instead to FOLLOW an order it was handed.
  //
  // ⚠ THE GROUP NAMES ARE NOT LISTED HERE ANY MORE, AND THAT IS DELIBERATE. There are now six possible
  // groups, they renumber to their positions on this card, and a card carries between one and six of
  // them. A fixed list in the instruction would be a second, drifting authority on what the headings
  // say — the same two-authorities failure the ALLOWED_HEADINGS deletion fixed. The headings ARE the
  // list; this section says what to do with them.
  "THE ORDER TO WRITE IN",
  "The facts arrive in numbered groups. The numbers are the order of the story, and each group's",
  "heading says how it follows from the one before it.",
  // ── ⚠⚠ THE BULLET RULE, WRITTEN AGAINST BOTH OF ITS OWN FAILURES ────────────────────────────
  //
  // FAILURE 1 — NINE BULLETS. The first run of the grouped fact text produced roughly one bullet per
  // FACT on HDFCBANK and ITC, and both were refused. The groups had read as a checklist.
  //
  // FAILURE 2 — THE FIX CAUSED THE NEXT DEFECT. What stopped failure 1 was "a group with five facts
  // does not get five bullets; it gets at most one". That is a PER-GROUP ration, and the real limit
  // was never per group. TCS then wrote THREE bullets of an allowed five, because its group 3 held
  // five facts and the rule permitted one sentence for all of them; the health movement went out in
  // a subordinate clause.
  //
  // ── ★★ AND NOW THE CAP HAS BEEN RAISED 5 → 8, WHICH CHANGES WHAT HOLDS FAILURE 1 ─────────────
  // At 5, the ceiling itself caught failure 1: nine bullets is more than five, so the answer was
  // refused and the defect was visible in a log. AT 8 IT IS NOT CAUGHT. A card carrying twenty facts
  // that writes eight bullets is INSIDE the cap and stores silently — the exact failure, now invisible.
  //
  // ★ SO THE COUNT IS RE-ANCHORED TO THE GROUPS, NOT TO THE FACTS. There are at most SIX groups and
  // up to TWENTY facts. "Roughly one sentence per group, two where a group holds two things the
  // reader needs" lands at six or seven — which fits inside eight and is arithmetically unreachable
  // from one-per-fact. Failure 1 is now excluded by a POSITIVE rule about what to write to, rather
  // than by a ceiling that has stopped being able to see it; failure 2 is excluded by forbidding the
  // per-group ration in the same breath. Both are named below, in that order, so neither fix can be
  // read as licence for the other.
  `- ⚠ THE GROUPS ARE AN ORDER, NOT A CHECKLIST. You write between 1 and ${MAX_TAKEAWAY_BULLETS}`,
  "  sentences IN TOTAL. That is a ceiling and not a target; most cards are nowhere near it.",
  "- ★ WRITE TO THE GROUPS, NOT TO THE FACTS. Roughly one sentence per group is the right shape. A",
  "  group may take a second sentence where it holds two things the reader genuinely needs, and a",
  "  group with one small fact can be left out entirely.",
  "- ⚠ NEVER one bullet per fact. A card can carry twenty facts across six groups. The groups are what",
  "  you write to; the facts are what you choose from inside each one.",
  "- ⚠ AND NEVER SQUEEZE A WHOLE GROUP INTO ONE CLAUSE JUST BECAUSE IT IS ONE GROUP. There is no",
  "  ration of one per group either. If a group holds two things the reader needs, use two sentences.",
  "  If it holds five and one of them matters, use one and leave the other four out.",
  // ── ⚠⚠ FOUND ON THE FIRST RUN AT THE RAISED CAP, ON HINDUNILVR, AND IT IS FAILURE 1 IN A NEW
  // PLACE. Eight bullets, of which THREE were about tax: the driver line, the effective-rate
  // contrast, and the "steepest rise in 16 comparisons" anchor. Every one was true and grounded, and
  // together they are one fact stated three ways — which is what one-bullet-per-fact looks like once
  // the count is anchored to the groups instead of the card. The rule is about the SUBJECT, not about
  // a budget, so it cannot become the per-group ration that caused failure 2.
  "- ⚠ NEVER TWO SENTENCES ABOUT THE SAME FIGURE. If the tax charge is the subject of one bullet it is",
  "  not the subject of another — take the single strongest statement about it and leave the rest out.",
  "  Three bullets naming the same line is one fact said three times, however different the wording.",
  "- Before you add a sentence, ask what a reader who has read the ones above it does not yet know. If",
  "  the answer is 'nothing they need', stop. Everything you leave out is already on the card.",
  "- Write your bullets in that order. A bullet from a later group never comes before one from an",
  "  earlier group.",
  "- You may join two groups in one sentence where the facts already connect them — 'profit fell 8%",
  "  because depreciation rose ₹412 crore' is allowed ONLY because a group about why it moved says",
  "  exactly that.",
  "- ⚠ Do not add a connection that is not in a group. If no group states a cause, the quarter has no",
  "  stated cause and you must not supply one. 'Driven by', 'as a result of', 'reflecting' and",
  "  'on the back of' are all claims about cause; use them only for a cause you were given.",
  "- Not every group needs a bullet. A group with one small fact can be left out.",
  "",
  // ── ⚠ 3d-B · THE FRAGMENT RULE. Found by rendering: four of twelve cards carried a bullet like
  // "The two comparisons point opposite ways, so the revenue trend depends on which one is read." as
  // an OPENING sentence, about nothing the reader had yet been told.
  "EVERY SENTENCE MUST HAVE A SUBJECT",
  "Each bullet has to make sense on its own to a reader who reads only that bullet. Name the figure,",
  "the line or the period it is about. Never open with 'The two comparisons…', 'The move came mostly",
  "from…' or any sentence whose subject is a fact in a different bullet.",
  // ── ⚠⚠ 3d-C · THE COMPANY IS A SUBJECT ONCE, AND THIS RULE EXISTS BECAUSE THE LINE ABOVE IT
  // CAUSED THE DEFECT. It read "Name the company, the figure or the period" — the company offered
  // FIRST, of three — and the model did exactly that, in every bullet: Cochin Shipyard opened 5 of 7
  // bullets with "Cochin Shipyard", HDFC Life 5 of 5. It was obedience, not drift.
  //
  // ⚠ AND A STRUCTURAL FIX WAS TRIED FIRST AND WAS NOT ENOUGH — WHICH IS WHY THIS IS A PROMPT RULE
  // AT ALL. The fact block used to hand over the REGISTERED name and no other form, so every bullet
  // opened "HDFC Life Insurance Co Ltd reported…". Giving it the short form fixed the FORM
  // completely — registered-name openings went 39.3% → 2.5% — and moved the REPETITION barely at
  // all: 39.3% → 32.1% of bullets still opened with the company, now more fluently. Structure fixed
  // what structure could; the remaining defect was caused by an instruction and needs one.
  //
  // ★ THE TARGET IS NOT ZERO, AND THE RULE SAYS SO IN ITS FIRST CLAUSE. A card naming the company
  // once is correct. Writing "never name the company" would trade this defect for the fragment
  // defect the rule above exists to prevent — bullets opening on a subject the reader has not met.
  //
  // ⚠ KEPT NARROW ON PURPOSE. Two of this file's recorded failures came from prompt rules that did
  // more than they were asked to: the per-group ration that compressed TCS, and the plain-language
  // block whose style directive bled onto `verdictMeaning` and produced five echo_mismatch refusals.
  // This rule names ONE position (the opening word), gives two examples of the shape wanted, and asks
  // for no rewriting of anything — `verdictMeaning` is a copied field and nothing here touches it.
  // Refusals are measured on every pass for exactly that reason.
  "- ⚠ THE COMPANY IS A SUBJECT ONLY ONCE. The reader is already on that company's page, under its",
  "  name. At most ONE bullet opens with the company; after that they know whose quarter this is, so",
  "  every later bullet opens with what the sentence is actually about — the line that moved, the",
  "  figure, or the period. Write 'Revenue fell 16% against the same quarter last year.' and 'Tax rose",
  "  ₹29 crore, taking ₹29 crore off net profit.', not the company's name again. A name at the start",
  "  of every bullet reads as a filing header rather than as sentences.",
  "",
  // ── ★★ SENTENCE LENGTH — ONE LINE, AND THE HISTORY BEHIND WHY IT IS ONLY ONE ─────────────────
  //
  // MEASURED over the stored corpus BEFORE any rule was added: of 66 bullet sentences, ONE opened on
  // a subordinate clause (1.5%) and NONE was passive. The model was already writing subject-first
  // and active — and that single front-loaded sentence turned out to be a BACKEND string
  // (annual-contrasts.ts's A-4) that it had reproduced faithfully. It has been fixed at the source.
  //
  // What WAS wrong is length: 14 of 66 sentences ran past thirty words, mean 22.5.
  //
  // ⚠⚠ AND A FULL PLAIN-LANGUAGE BLOCK WAS TRIED FIRST AND REVERTED, BECAUSE IT MADE THINGS WORSE.
  // Six rules — one idea per sentence, subject first, active voice, no stacked qualifiers — produced
  // THREE REFUSALS on seventeen cards, then FIVE after a scoping line was added to fix it. Every one
  // was `echo_mismatch` on `verdictMeaning`, plus an `overlong_takeaway`. The cause: `verdictMeaning`
  // is a long pre-written sentence the model must COPY CHARACTER FOR CHARACTER, and a strong style
  // directive anywhere in the prompt bleeds onto it — the model obediently improved the one field it
  // is forbidden to touch. An explicit "this does not apply to verdictMeaning" made it WORSE, not
  // better, which is the signal that more instruction was not the fix.
  //
  // ★ SO THE RULE IS THE NARROWEST ONE THAT ADDRESSES THE MEASURED DEFECT, and it carries its own
  // anti-inflation clause inline because splitting is exactly what produced the 9-bullet overrun.
  // Nothing here asks the model to REWRITE anything, which is what a copied field could fail.
  "- Keep each sentence under about twenty-five words. If one runs longer, split it into two",
  "  sentences INSIDE THAT SAME BULLET — never into an extra bullet, and never by dropping a figure.",
  "",
  "FIGURES",
  "- Reproduce every figure EXACTLY as written in the facts, including the rupee sign, the commas, the",
  "  decimal, and the word 'crore' or the '%' sign. Do not re-round it, rescale it, or reformat it.",
  "- Some cards carry a block of FULL-YEAR figures below the quarter's. Those cover twelve months and,",
  "  where they describe what the company owns and owes, a single day. If you use one, say it is a",
  "  full-year figure. Never call a full-year figure a quarterly one, or the reverse.",
  // ⚠⚠ THE BACKEND CANNOT BUILD THIS SENTENCE — annual-contrasts.ts is structurally unable to see a
  // quarterly figure — but the MODEL is handed both blocks and can. "Free cash flow was three times
  // the quarter's profit" divides correctly, uses two filed figures, and is a fabricated ratio: the
  // numerator covers twelve months and the denominator three. It is also the exact sentence a writer
  // reaches for when one card carries both, which is why it is named rather than left to the general
  // "never work out a number of your own".
  "- ⚠ NEVER set a full-year figure against a quarterly one. Do not divide, multiply, subtract or",
  "  compare across the two blocks — not as a ratio, not as a share, not as 'X times the quarter's Y'.",
  "  They cover different lengths of time, so any figure built from both describes nothing.",
  "- Do not introduce any number that is not in the facts. That includes counts: do not say how many",
  "  things happened unless the facts say so.",
  "- Short sentences. Ordinary words. Explain a term the first time you use it, in the same sentence.",
  // ── ⚠ 3d-E · A PHRASE IS NOT A VALUE. TTML's card read "a net profit of a loss of ₹72 crore",
  // because the facts said `Net profit: a loss of ₹72 crore` and the model composed label + value the
  // way a label and a value are normally composed. The structural half of this fix is that the groups
  // now hand over finished sentences; this is the half that covers the figures in Section 1.
  "- Some figures are written as a PHRASE, not as a bare amount: 'a ₹72 crore loss', 'nil'. The phrase",
  "  already says what the figure is. Reproduce it exactly as it stands — do not turn it back into",
  "  'a loss of ₹72 crore', and do not put a second label in front of it.",
  "",
  "TWO KINDS OF LINE YOU MUST NOT DROP",
  // ⚠⚠ "IN YOUR OWN SENTENCE", SINGULAR, AND IT STAYS SINGULAR — TRIED, MEASURED AND REVERTED.
  //
  // The diagnosis looked right: handed a three-sentence divergence the model welded it into one
  // 51-word bullet with five clause breaks, doing what this line told it. So the line was changed to
  // "in your own words" plus an explicit permission to use several short sentences. The result, over
  // the same 17 cards:
  //
  //     bullets over 30 words   9.3% → 11.7%   (WORSE)
  //     stacked sentences      25.3% → 23.4%   (flat)
  //     IDEA 4 → 8 bullets · HDFCBANK 6 → 8 · TMPV REFUSED, overlong_takeaway at 9
  //
  // Permission to write more sentences reads to the model as permission to write more BULLETS, which
  // is failure mode 2 from the bullet-cap stage arriving by a new route — and it cost a card. The
  // model's own prose is not the lever item 2 is about; the hand-written strings are, and those are
  // now 4.1% → 0.2% stacked. Left exactly as it was.
  "- A line marked MUST SAY carries a point the brief has to make. Say it in your own sentence, in the",
  "  group where it appears, and give that sentence its own subject. Never print the words 'MUST SAY'",
  "  — that is a label for you, not text for the reader.",
  // ⚠⚠ ADDED AFTER IDEA'S FIRST RE-RENDER, AND SCOPED AS NARROWLY AS THE DEFECT. Handed the size of
  // the profit that came from outside the trading lines, the model wrote "a large part of the
  // reported profit" and dropped every figure — obeying MUST SAY, and losing the fact. The vague
  // quantifier is exactly what a computed amount exists to replace. This is one clause about MUST
  // SAY lines only, NOT a style rule: the plain-language BLOCK tried at the last stage bled onto the
  // copy-verbatim verdict fields and produced five refusals in seventeen renders.
  "- If a MUST SAY line gives an amount in rupees, keep that amount in your sentence. A phrase like",
  "  'a large part' in place of a figure the line already states is a fact removed, not a fact shortened.",
  "- Anything a group states that Vytal detected in these results is Vytal's own finding, not your",
  "  opinion, so it is safe to state and it must not be left out. Where a finding carries a 'What it",
  "  does not mean' clause, that clause travels with it.",
  "",
  "NEVER",
  "- Never work out a number of your own. Every figure you write must already appear below. If you find",
  "  yourself adding, subtracting or taking a percentage, stop: the answer is not yours to compute.",
  "- Never say what caused what unless a DRIVER or CONTRAST line below says it. The arithmetic behind",
  "  those has been done and checked; anything else you might attribute has not.",
  "- Never predict or forecast. Nothing about what happens next, what is expected, or what is likely.",
  "- Never write 'what to watch', 'keep an eye on', 'going forward', or any variant of them.",
  "- Never mention segments, products, customers, management, strategy or an earnings call. None of",
  "  that is in the facts, so anything you write about it would be invented.",
  "- Never quote or paraphrase anyone.",
  "- Never judge. Do not call anything strong, weak, poor, good, bad, healthy, impressive,",
  "  disappointing, attractive, worrying, reassuring or remarkable. Say what a figure did — rose, fell,",
  "  held — and stop there. Whether that is good news depends on things you have not been told.",
  "- Never rank this company against others. A peer fact is a COUNT and stays a count: say how many",
  "  did more and how many did less, never that this one beat, led, lagged or outperformed them.",
  // ── ⚠⚠ 3d-A · THE HEALTH-SCORE DEFINITION IS NOW WITHHELD ENTIRELY, NOT SUPPLIED.
  // It used to be supplied — a model left to define the score invented a new definition every run, so
  // one authored line was handed over to stop that. The result was worse: on 2 of 12 cards the model
  // glued the definition into a bullet, producing a run-on that duplicated the health SECTION the card
  // renders three inches below it. Supplying it made restating it likely; withholding it makes
  // restating it impossible. The model can still say the score MOVED, which is a fact about this
  // quarter; what it is, and what it is built from, is the card's job and the card already does it.
  "- Never say what the Vytal health score is, what it is out of, or what it is built from. The card",
  "  explains it in its own section. You may say only that it moved, and by how much.",
  "- Never mention the share price, the valuation, or whether anyone should buy, sell or hold.",
  "- Never write a title, an introduction or a conclusion. The array holds sentences and nothing else.",
].join("\n");

const line = (s: string): string => s.replace(/\s+/g, " ").trim();

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE NAME THE MODEL IS GIVEN — STRUCTURE INSTEAD OF A PROMPT RULE.
//
// ── THE DEFECT, MEASURED BEFORE THE CHANGE ─────────────────────────────────────────────────────────
// Bullets opened with the REGISTERED name — "HDFC Life Insurance Co Ltd collected premiums kept of
// ₹16,548 crore…", five times on one card. Across a twenty-stock set: 33 of 84 bullets (39.3%) opened
// with it, and on 3 of 20 cards EVERY bullet did (MMTC 2/2, HDFCLIFE 5/5, COCHINSHIP 7/7).
//
// ⚠ THE MODEL WAS NOT DISOBEYING. The registered form was THE ONLY FORM IT HAD — this line was the
// one place a name appeared in the whole fact text — and the sentence-subject rule below explicitly
// offers "the company" as a subject. Given one name and an instruction to use a subject, it used the
// name it was given. Nothing here was a prompt-compliance problem, so no prompt rule was reached for
// first: the fact block was changed to hand over a name that reads like a sentence.
//
// ── ⚠ WHY shortenCompanyName IS THE SOURCE BUT NOT THE WHOLE ANSWER ───────────────────────────────
// `shortenCompanyName` (chat/web/news-filter.ts) is REUSED rather than reimplemented — it is the
// shared, tested corporate-suffix strip, and a second copy of that logic is exactly the drift this
// codebase avoids elsewhere. But it is tuned for MATCHING a headline, not for prose, in two ways its
// own header states outright:
//
//   · IT DELIBERATELY DOES NOT STRIP A BARE "Co". Correct there — the strip runs repeatedly, and a
//     repeated strip that eats "Co" turns "Some Co Pvt. Ltd." into "Some", a more ambiguous QUERY
//     than intended. Here it leaves "HDFC Life Insurance Co" and "ICICI Lombard General Insurance
//     Co", which read worse in a sentence than the registered form did.
//   · IT KEEPS EVERY REMAINING WORD, on purpose, because a news query must stay unambiguous across
//     the whole universe. MEASURED across 504 names: 116 still carry a generic corporate word after
//     shortening ("Amber Enterprises India", "Aptus Value Housing Finance India").
//
// ★ AND THE AMBIGUITY THOSE TWO RULES PROTECT AGAINST DOES NOT EXIST HERE. The news filter is
// deciding whether a headline from the open internet is about this company; this card is already ON
// that company's page, under its name, beside its symbol. Nothing can be confused with anything. So
// the prose form takes the shared strip and then closes the two documented gaps — a TRAILING bare
// "Co"/"Company", once and only at the end, and a leading "The".
//
// ⚠ IT STOPS THERE, AND THE LINE IS DELIBERATE. Dropping a trailing SECTOR word ("Insurance",
// "Pharmaceuticals") would give "HDFC Life" — but that is `prefixAliasesFor`'s job in the news
// filter, and it only admits such a cut after testing it against every other covered company's name.
// Reimplementing that test badly here, on a surface that does not need it, would be a worse trade
// than a name that is one word longer than ideal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** A trailing bare "Co"/"Company" — ONCE, anchored, and only after the shared strip has run. */
const TRAILING_CO_RE = /[,\s]+(co|company)\.?$/i;
/** A leading article. "The New India Assurance Company" → "New India Assurance". */
const LEADING_THE_RE = /^the\s+/i;

/**
 * The company's name as a SENTENCE uses it. "HDFC Life Insurance Co Ltd" → "HDFC Life Insurance";
 * "MMTC Ltd." → "MMTC"; "Cochin Shipyard Ltd" → "Cochin Shipyard".
 *
 * ⚠ NEVER RETURNS EMPTY. Every step falls back to the input, so a name that is nothing but a suffix
 * still yields something to print — a nameless card is a worse failure than a long name.
 */
export function briefProseName(registered: string): string {
  const base = shortenCompanyName(registered) || registered.trim();
  const noCo = base.replace(TRAILING_CO_RE, "").trim() || base;
  return noCo.replace(LEADING_THE_RE, "").trim() || noCo;
}

/** The facts, as the model receives them. DISPLAY STRINGS ONLY — see the header. */
export function renderFactText(block: QuarterBriefFactBlock): string {
  const out: string[] = [];
  const push = (s: string) => out.push(s);

  const { identity: id } = block;
  // ★ THE SHORT FORM, AND IT IS THE ONLY FORM. The registered name is not supplied alongside it —
  // handing over both would leave the choice open, and the measurement says the model takes whatever
  // name it is given. See briefProseName's note above.
  push(`COMPANY: ${briefProseName(id.name)} (${id.symbol})`);
  // ★ PROSE DATES, NOT ISO. These two strings land inside the model's SENTENCES — "the quarter ended
  // 2025-06-30" was shipping on MMTC's card — and the prompt orders every figure copied exactly, so
  // the only place to fix it is the form we hand over. See format.ts's prettyDate.
  push(`PERIOD: ${id.quarter} of ${id.fiscalYear}, the three months ended ${prettyDate(id.reportDate)}`);
  push(`REPORTED ON: ${prettyDate(id.filingDate)}`);
  push("");

  // ── The verdict, as an INPUT fact (Stage 2). Label + meaning, both pre-written. ────────────────
  // ⚠ The RULESET is still withheld. The model receives the conclusion, never the thresholds that
  // produced it, so it cannot re-derive a direction — only place the one it was handed.
  if (block.verdict) {
    // ⚠⚠ THE TWO HALVES ARE LABELLED SEPARATELY, AND THE SCHEMA IS WHY. This block used to render as
    // one line — "Grew, margins thinner — Sales and profit were both higher, but…" — which was exactly
    // right when the model's job was to USE that wording in a sentence. Under the schema it must
    // return the two halves in two fields, and one line with an em-dash in it does not say where the
    // label ends: measured, the model copied the WHOLE line into `verdictLabel` on 4 of 5 families
    // and the equality check refused every one. The model was not wrong; the fact text was ambiguous
    // for the question now being asked of it. Naming the fields here is what makes the copy possible.
    push(`OVERALL — copy these two lines into verdictLabel and verdictMeaning, exactly as written:`);
    push(`  verdictLabel: ${block.verdict.label}`);
    push(`  verdictMeaning: ${line(block.verdict.meaning)}`);
    push(`  The limit of that claim, which must travel with it: ${line(block.verdict.doesntMean)}`);
    push("");
  }

  // ── Section 1 — every metric the family files. CONTEXT for the model; already shown to the reader. ─
  // Rendered flat and dense: the model is not narrating these, it is drawing on them, and the fact
  // text is also the grounding haystack so every display string a bullet may legally use must be here.
  push("THE QUARTER'S FIGURES (already shown to the reader — draw on these, do not list them back):");
  for (const l of block.quarter.lines) {
    // ⚠ THE ANCHOR IS COMPOSED IN, NOT STORED IN. `movement` is the bare movement now; the fact text
    // and the grounding haystack still see one string per line, so what the model may legally
    // reproduce is unchanged by the split. See anchors.ts's note on why the fold was undone.
    const m = movementWithAnchor(l);
    push(`  ${l.label}: ${l.display}${m ? ` — ${m}` : ""}`);
  }
  push("");

  // ── The annual section (Q4 only). Same treatment as Section 1: CONTEXT, already rendered. ────────
  // ★ THE HEADING NAMES THE PERIOD, EVERY TIME. These figures cover twelve months and describe a
  // single day's balance sheet, and they sit two lines below three-month figures in the same units.
  // The model is drawing on both, so the only thing stopping "revenue was ₹X and debt was ₹Y this
  // quarter" is that the label on the second set says which period it is.
  if (block.annual) {
    const a = block.annual;
    push(`THE FULL YEAR'S FIGURES for ${a.fiscalYear} (already shown to the reader — draw on these, do not list them back):`);
    // ⚠ 4d — THE SECOND CLOCK. Stated only when the two dates genuinely differ. Printing an as-at date
    // on all 99.8% of cards where it is the quarter's own date would train the reader past the 0.2%
    // where it is not, which is the same failure as never printing it.
    push(
      a.datesAgree
        ? "  These cover the twelve months ending on the same day as the quarter above."
        // No glyph: every other marker in this fact text is a word, and a "⚠" sitting in the model's
        // input is one echo away from a warning symbol in a reader's prose.
        // ★ PROSE FORM HERE TOO, and this one matters more than the period line: the instruction
        // beneath it asks the model to SAY the date in a sentence, so an ISO string here is an ISO
        // string in a reader's prose by design rather than by accident.
        : `  AS AT ${prettyDate(a.asOfDate)} — this company's financial year does NOT end on the last day of the ` +
          `quarter above. If you mention any figure below, say it is as at ${prettyDate(a.asOfDate)}.`,
    );
    if (a.priorFiscalYear) push(`  Movements below are against ${a.priorFiscalYear}, the previous full year.`);
    for (const l of a.lines) {
      push(`  ${l.label}: ${l.display}${l.movement ? ` — ${l.movement}` : ""}`);
      if (l.plain) push(`    in plain terms: ${line(l.plain)}`);
    }
    push("");
  }

  // ══ ★★ STAGE 3 · THE CHAIN ══════════════════════════════════════════════════════════════════════
  //
  // Every fact that used to be emitted here as its own labelled line — DRIVER, CONTRAST, MUST SAY,
  // PEERS, FINDING, MARGIN TREND, the health movement — now arrives inside one of four ordered groups
  // built by story.ts. Nothing new is computed; the SAME strings are grouped and sequenced so the
  // connection between them is carried by the order rather than left for the model to infer.
  //
  // ⚠ THE OLD SHAPE WAS THE PROBLEM, AND IT IS WORTH NAMING WHY. Eight independent labels, each
  // introduced by a noun ("DRIVER:", "PEERS:"), is a list; a model handed a list writes a list, one
  // bullet per label, in the order the labels happened to appear. That is how "MUST SAY" lines became
  // standalone fragments with no antecedent — they were last in the file, so they were last in the
  // answer, with nothing before them to be about.
  //
  // ⚠⚠ AND THE HEALTH DEFINITION IS GONE FROM THIS FILE (3d-A). It is not rendered here in any form.
  // See the NEVER rule in the system prompt: supplying it made restating it likely; withholding it
  // makes restating it impossible, and the card renders the health section itself.
  const story = buildStory(block);
  if (story.length > 0) {
    push("THE QUARTER, IN ORDER — write your bullets following these groups, in this order:");
    push("");
    for (const g of story) {
      push(g.heading);
      for (const f of g.facts) push(`  ${f.mustSay ? "MUST SAY — " : ""}${line(f.display)}`);
      push("");
    }
  }

  // ── The health section's DATE, which is not a story fact and must not be lost with one. ─────────
  // ★ PINNED AND DATED. Deliberately a THIRD, distinctly-labelled date: the quarter is "the three
  // months ended", the filing is "REPORTED ON", and this is "AS SCORED ON". One date per label, no
  // shared verb, so a reader is never left working out which clock a number is on. The score's
  // MOVEMENT lives in group 3; this is the clock that movement is on.
  if (block.healthMovement) {
    const h = block.healthMovement;
    push(
      // ★ PROSE FORM, AND THIS IS THE ONE THAT ACTUALLY REACHED READERS. The period and filing dates
      // were fixed first and the health date was missed; the very next run put "The health score
      // moved down 1 point to 67, from FY26Q4, as scored on 2026-08-07." on four of twenty cards.
      // The instruction on the next line ASKS the model to state the date, so this string is not a
      // date that might leak into prose — it is one the prompt requests in prose. It had to be the
      // last of the four, not the first three.
      //
      // ⚠ THE CARD'S OWN `as scored on 2026-08-07` STAYS ISO. That is chrome in a mono column, where
      // an unambiguous sortable date is right; this is a sentence. Same date, two renderings, and
      // the split is deliberate — see format.ts's prettyDate.
      `THE SCORE ABOVE WAS AS SCORED ON ${prettyDate(h.scoredAsOf)} — ${h.composite.display} out of 100, band ` +
        `"${h.band.label}". If you mention it, state it as the figure on that date, not as today's.`,
    );
    push("");
  }

  // ── The profit-source finding's supporting figures. The finding itself is a group-3 fact. ───────
  if (block.profitSource) {
    push("FIGURES BEHIND THAT FINDING (filed lines the reader can check against the statement):");
    for (const f of block.profitSource.supporting) push(`  ${f.label}: ${f.display}`);
    push("");
  }

  // ── Gaps. Shown to the reader in full; here so a bullet can never claim what they rule out. ─────
  push("WHAT THIS READING DOES NOT COVER (already shown to the reader — do not repeat, do not contradict):");
  for (const g of block.gaps) push(`  - ${line(g)}`);

  return out.join("\n");
}
