// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROUTER — user text to slots, then subjects resolved by CODE.
//
// ── ★ TWO STAGES, AND THE ORDER IS THE POINT ──────────────────────────────────────────────────────
//   1. CLASSIFY   scope + operation + lens + timeframe + subject MENTIONS (strings the user typed)
//   2. RESOLVE    those mentions through resolver #1 — the model never names a ticker we then trust
//
// A model that outputs "HDFCBANK" has made a decision the system cannot audit. A model that outputs
// the phrase "hdfc" hands that decision to a resolver which returns three candidates and
// `verdict: "ambiguous"`, and the turn stops for a choice. Same input, one of them auditable.
//
// ── ★ THE CLASSIFIER IS INJECTED, DELIBERATELY ────────────────────────────────────────────────────
// `route()` takes its classifier as an argument. That is not test scaffolding — it is what lets the
// adversarial suite drive exact slot combinations (including ones a model rarely emits, like a
// confident wrong operation) without a model in the loop. The model-backed classifier is one
// implementation; a lexical one ships beside it and is what runs when no provider is configured.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { resolveSubject, resolveReaderSubject, type Subject } from "../resolve/subject.js";
import { getClassification, putClassification } from "./classification-cache.js";
import { isBareSubject, isSelfContained } from "./question-shape.js";
import {
  ACTIONS, LENSES, OPERATIONS, PERSPECTIVES,
  type ActionSlot, type LensSlot, type OperationSlot, type Perspective,
  type RoutedTurn, type RouterOutput, type TimeframeSlot, type TurnContext,
} from "./contract.js";

export type Classifier = (text: string) => Promise<RouterOutput>;

// ── ★ THE PROMPT. Fixed, small, and it is the ENTIRE model cost of a routed turn (§6.1). ──────────
// No tool definitions. No data. No stock list. No history. Compare with the old path, which shipped
// 33 tool schemas plus a context layer on every turn before the user's question was even read.
// ★ THE OPERATION AND LENS UNIONS ARE GENERATED FROM THE CONTRACT, NOT RETYPED (stage 5b).
//   `lookup` was added to OperationSlot and OPERATIONS at stage 4 and never added here, so for a
//   whole stage the model could not be asked for an operation the vocabulary had gained. It emitted
//   `lookup` once anyway — guessing a value it was never shown — and `parseRouterOutput` accepted it
//   because the clamp validates against OPERATIONS. Correct behaviour by accident is not a design.
//   Two hand-maintained copies of one closed set is N-5; there is now one.
const union = (xs: readonly string[]) => xs.map((x) => JSON.stringify(x)).join("|");

export const ROUTER_PROMPT = `You classify one finance question. Reply with JSON only.

{"scope":"in_scope"|"out_of_scope"|"unresolved",
 "perspective":"market"|"reader",
 "action":${union(ACTIONS)}|null,
 "subjects":[{"text":"<company or ticker AS THE USER TYPED IT>"}],
 "operation":${union(OPERATIONS)}|"unresolved",
 "lens":${union(LENSES)}|null,
 "timeframe":{"kind":"latest"|"quarters"|"years","n":<number|null>}|null,
 "confidence":"high"|"low"}

scope: in_scope = Indian listed companies (financials, ownership, filings, prices); mutual funds,
       ETFs, bonds and other instruments we cover; AND THE READER'S OWN portfolio, holdings,
       watchlist, alerts and transactions.
       out_of_scope = anything else (celebrities, politics, other markets, general chat).
       unresolved = you cannot tell.

perspective: "reader" when the question is about THE ASKER'S OWN book — "how is my portfolio doing",
             "do I own TCS", "what is on my watchlist", "add this to my watchlist".
             "market" otherwise. ⚠ A question can be BOTH reader-perspective and about a company:
             "how much TCS do I own" is perspective "reader" with subject "TCS".

action: the CHANGE the reader is asking you to make, or null if they only want to be told something.
        "watchlist_add"      — "add TCS to my watchlist", "track this one", "watch HDFCBANK"
        "watchlist_remove"   — "remove TCS from my watchlist", "stop tracking this"
        "transaction_record" — "I bought 10 TCS at 3200 last Tuesday", "log a sale of 5 INFY"
        "alert_create"       — "tell me if TCS rises 5%", "alert me when INFY drops below 1400"
        "reminder_create"    — "remind me 2 days before TCS earnings"
        "memory_add"         — "remember that I like short answers", "call me Arman", "yaad rakho ..."
        "memory_forget"      — "forget that I prefer Hinglish", "stop remembering the one about ..."
        "alert_delete"       — "delete my TCS alert", "remove the alert on INFY"
        null                 — everything else, including a question that merely mentions owning
                               something ("how much TCS do I own" is a QUESTION, action null).

operation: what the reader wants DONE. If two operations fit equally, or none clearly fits,
           answer "unresolved". NEVER guess an operation to be helpful — a guessed operation
           produces a confident answer to a question nobody asked.
           "lookup" is a plain value question — "how much does X spend on Y", "what is X's debt".

lens: WHAT THE READER NARROWED TO, and null when they narrowed nothing.
      "how is TCS doing" narrows nothing -> null.  "how is TCS's ownership" -> "ownership".
      A GENERAL QUESTION ABOUT A COMPANY IS NOT THE HEALTH LENS. "health" is only for a question
      about the SCORE ITSELF - "why is it scored that way", "how healthy is it", "what is driving
      its score". Marking a general question "health" answers the whole company with one facet of
      it, which is the single most common way this classification goes wrong.

subjects: the company AS TYPED. Do not expand to a ticker. Do not correct spelling. Do not pick
          between similar companies — that is resolved downstream and ambiguity is handled there.`;

const clamp = <T,>(v: unknown, allowed: readonly T[]): T | null =>
  allowed.includes(v as T) ? (v as T) : null;

/** Coerce whatever the model returned into the contract. Anything unrecognised becomes `unresolved`
 *  or `null` — never a default that happens to be a valid operation. */
export function parseRouterOutput(raw: unknown): RouterOutput {
  const o = (raw ?? {}) as Record<string, unknown>;
  const scope = clamp(o.scope, ["in_scope", "out_of_scope", "unresolved"] as const) ?? "unresolved";
  const operation = clamp(o.operation, OPERATIONS) ?? "unresolved";
  const lens = clamp(o.lens, LENSES);
  const subjectsRaw = Array.isArray(o.subjects) ? o.subjects : [];
  const subjects = subjectsRaw
    .map((s) => (s && typeof s === "object" ? String((s as { text?: unknown }).text ?? "") : String(s)))
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((text) => ({ text }));
  let timeframe: TimeframeSlot | null = null;
  const tf = o.timeframe as Record<string, unknown> | null | undefined;
  const tfKind = clamp(tf?.kind, ["latest", "quarters", "years"] as const);
  if (tfKind) timeframe = { kind: tfKind, n: typeof tf?.n === "number" ? tf.n : null };
  return {
    scope, subjects, operation, lens, timeframe,
    confidence: o.confidence === "high" ? "high" : "low",
    // Unrecognised perspective falls to "market" — the safe reading. Mistaking a reader question for
    // a market one loses personalisation; the reverse would answer a market question with the
    // reader's own book, which is a privacy-shaped mistake rather than a quality one.
    perspective: clamp(o.perspective, PERSPECTIVES) ?? "market",
    // ⚠ Unrecognised action → null. An action never writes (see ActionSlot), but an action nobody
    //   asked for renders a control nobody wants, and a control is a stronger claim than a chip.
    action: clamp(o.action, ACTIONS),
    source: "model", degradedReason: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE LEXICAL CLASSIFIER — no model. Ships beside the model-backed one and runs when no provider is
// configured, so the stack is provable end to end without a network call or a key.
//
// ⚠ IT IS DELIBERATELY UNDER-CONFIDENT. Every branch that does not clearly match answers
// `unresolved`. That is the correct bias for a router: a lexical guess at an OPERATION is exactly the
// confident-wrong-artifact failure §6.2 names, and "I am not sure what you are asking" is a better
// product than a beautiful answer to the wrong question.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const OUT_OF_SCOPE = /\b(bieber|celebrity|actor|politic|election|weather|recipe|football|cricket score|bitcoin|dogecoin)\b/i;
/** First person about one's own book. Hinglish included because readers write it (see tone.ts). */
const READER_PERSPECTIVE = /\b(my|mine|i own|i hold|i bought|i sold|do i|am i|mera|meri|mujhe)\b/i;
export const OP_PATTERNS: readonly (readonly [OperationSlot, RegExp])[] = [
  ["compare", /\b(vs|versus|compare[ds]?|against)\b/i],
  ["screen", /\b(which stocks?|screen|find (me )?(stocks?|companies)|list (of )?(stocks?|companies))\b/i],
  ["decompose", /\b(why|what('s| is) driving|break ?down|breakdown|what makes up|contribut)/i],
  ["history", /\b(over the last|history|trend|since|past \d+|hcubed)\b/i],
  ["list_findings", /\b(red flags?|findings?|flagged|concerns?|what should i (know|worry))\b/i],
  ["explain", /\b(what does .* mean|what is a |define |explain the term)\b/i],
  ["lookup", /(how much|how many|what is the|what\'?s the|what was the|spend on|who owns|who holds)/i],
  ["orient", /\b(how is|how'?s|how has|doing|health|overview|tell me about|look at)\b/i],
];
const LENS_PATTERNS: readonly (readonly [LensSlot, RegExp])[] = [
  ["ownership", /(ownership|promoter|pledge|fii|dii|shareholding|stake|who owns|who holds)/i],
  ["fundamentals", /\b(revenue|profit|margin|debt|cash flow|earnings|r&d|research and development|expense|cost)\b/i],
  ["valuation", /\b(valuation|p\/e|pe ratio|multiple|expensive|cheap)\b/i],
  ["price", /\b(price|stock price|share price|returns?)\b/i],
  ["filings", /\b(filing|annual report|disclosure)\b/i],
  ["events", /\b(dividend|split|bonus|corporate action|result date)\b/i],
  // ⚠ "how is" IS NOT A LENS. It was in this pattern and that was the defect behind "why does a
  //    general question only show the health score": `orient` + lens=health matched the health-only
  //    composition, so a reader asking about the whole company got one facet of it. The lens is what
  //    the reader NARROWED to; a question that narrows nothing has lens `null`, and null routes to
  //    the whole-company answer.
  // ⚠ "its score" NARROWS TO HEALTH AS SURELY AS "health score" DOES, AND THE LIST DID NOT SAY SO.
  //    Measured at Phase 2 · Batch 2: "why did INDUSINDBK's score fall" matched `decompose` with lens
  //    null and fell to the planner, while "why is TCS scored the way it is" matched health and
  //    reached A · Attribution. Same family, same reader intent, two different answers — decided by
  //    whether the reader wrote "scored" or "score". The model gets both right; this classifier is
  //    the degraded path, and a degraded path that answers half a family is worse than one that
  //    answers none of it, because the failure is invisible.
  // ⚠⚠ AND THIS LINE HAS NO WORD-BOUNDARY ESCAPE IN IT ON PURPOSE — THE FIFTH TIME THIS BUILD HAS BEEN
  //    BITTEN. Written through a script, a backslash-b in a regex literal becomes a LITERAL 0x08
  //    BACKSPACE: invisible in every listing, and the pattern then matches nothing at all.
  //    `question-shape.ts`'s header records four earlier occurrences and answers them with
  //    word-membership sets. This one was caught by the classifier still returning `lens: null`
  //    after an edit that had "obviously" fixed it. The alternation below needs no boundary: every
  //    branch is multi-word or starts with a character no other word ends in.
  ["health", /(health score|scored|how healthy|its score|'s score|the score)/i],
];

/** Company mentions: quoted spans, ALL-CAPS tokens, or a capitalised run. Crude on purpose — the
 *  resolver is what turns a rough mention into candidates, and it is good at it. */
function mentionsIn(text: string): { text: string }[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9&.\-]{1,15})\b/g)) out.push(m[1]!);
  if (out.length === 0) {
    for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g)) out.push(m[1]!);
  }
  const stop = new Set(["I", "The", "What", "How", "Why", "Which", "Is", "Does", "Do", "Show", "Tell", "A", "An"]);
  return [...new Set(out.filter((t) => !stop.has(t)))].slice(0, 3).map((text) => ({ text }));
}

export const lexicalClassifier: Classifier = async (text) => {
  const t = text.trim();
  if (OUT_OF_SCOPE.test(t)) {
    return {
      scope: "out_of_scope", subjects: [], operation: "unresolved", lens: null, timeframe: null,
      confidence: "high", perspective: "market", action: null, source: "lexical", degradedReason: null,
    };
  }
  const ops = OP_PATTERNS.filter(([, re]) => re.test(t)).map(([op]) => op);
  const lenses = LENS_PATTERNS.filter(([, re]) => re.test(t)).map(([l]) => l);
  // ★ TWO OPERATIONS MATCHED IS AMBIGUITY, NOT A RANKING PROBLEM. Taking the first would be the
  //   guessed handler §6.2 forbids, and `compare` beating `orient` by list order is not a decision.
  //   One exception: `decompose` and `orient` co-occur constantly ("why is X healthy") and decompose
  //   is strictly the more specific reading, so it wins over orient ALONE — never over a third.
  let operation: OperationSlot | "unresolved" = "unresolved";
  if (ops.length === 1) operation = ops[0]!;
  else if (ops.length === 2 && ops.includes("decompose") && ops.includes("orient")) operation = "decompose";
  // `lookup` beating `orient` alone, same shape and same reason: "how much is X's debt" contains
  // "how" but is a value question, and lookup is strictly the more specific reading.
  else if (ops.length === 2 && ops.includes("lookup") && ops.includes("orient")) operation = "lookup";
  const subjects = mentionsIn(t);
  const qm = /\b(\d+)\s*(quarters?|years?)\b/i.exec(t);
  const timeframe: TimeframeSlot | null = qm
    ? { kind: /year/i.test(qm[2]!) ? "years" : "quarters", n: Number(qm[1]) }
    : null;
  return {
    scope: "in_scope",
    subjects,
    operation,
    lens: lenses[0] ?? null,
    timeframe,
    confidence: operation === "unresolved" ? "low" : "high",
    // ★ THE LEXICAL READ OF THE TWO STAGE-6 SLOTS, AND IT IS DELIBERATELY LOPSIDED.
    //   `perspective` is cheap to get right — first-person possessives are unambiguous — so it is
    //   read here. `action` is NOT: the gap between "add TCS to my watchlist" and "should I add TCS
    //   to my watchlist" is a whole intent, and a lexical guess would arm a control off a regex. A
    //   control is a stronger claim than a chip, so the under-confident bias that governs `operation`
    //   applies to it doubly. No model, no action.
    perspective: READER_PERSPECTIVE.test(t) ? "reader" : "market",
    action: null,
    source: "lexical",
    degradedReason: null,
  };
};

/** The lexical classifier's output, stamped with WHY the model path was not taken. Every fallback in
 *  `modelClassifier` goes through here, so a degraded turn can never be mistaken for a chosen one. */
const degradedTo = async (text: string, why: string): Promise<RouterOutput> =>
  ({ ...(await lexicalClassifier(text)), degradedReason: why });

/**
 * Route one turn. Classify, then RESOLVE subject mentions through resolver #1.
 *
 * ★ AMBIGUITY STOPS THE TURN. `verdict: "ambiguous"` or `"weak"` sets `needsSubjectChoice` and leaves
 * `resolvedSymbols` empty — a composition never receives a subject the resolver would not commit to.
 */
export async function route(
  text: string,
  classify: Classifier = lexicalClassifier,
  /** ★ THE AUTHENTICATED READER, FROM THE REQUEST — NEVER FROM THE MODEL AND NEVER FROM THE TEXT.
   *  A turn with no reader simply cannot produce a reader subject; that is the whole guard. */
  reader: { userId: string } | null = null,
  /** The previous turn, when there was one (stage 9). `null` on the first question. */
  prior: TurnContext | null = null,
): Promise<RoutedTurn> {
  let router = await classify(text);
  const corrections: string[] = [];
  const subjects: Subject[] = [];
  const subjectChoices: { symbol: string; name: string }[] = [];
  let needsSubjectChoice = false;

  for (const m of router.subjects) {
    const r = await resolveSubject(m.text);
    if (r.subject) subjects.push(r.subject);
    else if (r.ambiguous) {
      needsSubjectChoice = true;
      subjectChoices.push(...r.candidates);
    }
  }

  // ═══ 1 · SCOPE IS OURS TO DECIDE, NOT THE MODEL'S ══════════════════════════════════════════════
  //
  // ★ "how is SHIPROCKET doing" CAME BACK `out_of_scope` FROM A LIVE ROUTER. Shiprocket is in our
  //   universe. The classifier was being asked "is this an Indian listed company?" — a WORLD-KNOWLEDGE
  //   question about a recent listing it may never have seen — when the resolver two lines above has
  //   already answered it definitively from our own tables.
  //
  //   Asking a model what we hold is the whole mistake: its answer is a guess about reality, ours is
  //   a fact about our database. A resolved subject therefore overrules the verdict, always.
  //
  // ⚠ IT CANNOT RESCUE A GENUINELY OUT-OF-SCOPE QUESTION, BECAUSE IT NEEDS A RESOLVED SUBJECT.
  //   "What is Justin Bieber's income" returns no mentions at all, so there is nothing to resolve and
  //   nothing to override — §6.3's "a question about a celebrity that happens to name a ticker is
  //   still not our question" survives, because such a question is out of scope on its own text.
  if (router.scope !== "in_scope" && subjects.length > 0) {
    const named = subjects.map((x) => (x.kind === "stock" ? x.symbol : x.kind)).join(", ");
    corrections.push(`scope ${router.scope} -> in_scope: ${named} resolved in our universe`);
    router = { ...router, scope: "in_scope" };
  }
  // The reader's own book is in scope by definition, and a reader subject can only come from the
  // session — never from the question text, so there is nothing here for a model to be wrong about.
  if (router.scope !== "in_scope" && router.perspective === "reader" && reader) {
    corrections.push(`scope ${router.scope} -> in_scope: a question about the reader's own book`);
    router = { ...router, scope: "in_scope" };
  }

  // ═══ 2 · A BARE SUBJECT IS NOT A QUESTION ══════════════════════════════════════════════════════
  //
  // ★ TYPING "TCS" AND NOTHING ELSE RETURNED A FULL SEVEN-SECTION ORIENTATION. The classifier reads a
  //   lone ticker as `orient` with high confidence, which is a guess dressed as a reading: the reader
  //   named a subject and no operation. §6.2 — a guessed operation produces a confident answer to a
  //   question nobody asked, and this is that with the question left blank entirely.
  //
  //   Deliberately narrow: the ENTIRE question must be the mention. "TCS results" keeps its operation.
  const bareSubject = isBareSubject(text, router.subjects);
  // ★ A question complete on its own keeps its own unresolved operation — see isSelfContained.
  const selfContained = isSelfContained(text, router.subjects);
  if (router.operation !== "unresolved" && bareSubject) {
    corrections.push(`operation ${router.operation} -> unresolved: the question is a bare subject`);
    router = { ...router, operation: "unresolved", confidence: "low" };
  }

  // ═══ 3 · FOLLOW-UPS INHERIT WHAT THE PREVIOUS TURN RESOLVED ════════════════════════════════════
  //
  // ★ "and HAL?" · "compare them" · "why?" ALL DIED HERE. Each classified `unresolved` and each was
  //   answered with clarifying chips, because the classifier sees one sentence and these sentences are
  //   not self-contained. A conversation in which no question may refer to the last one is not a
  //   conversation; it is a series of unrelated searches.
  //     ⚠ AND IT RUNS AFTER THE BARE-SUBJECT RULE, WHICH IT MUST NOT UNDO. `bareSubject` is passed
  //     in for exactly that: a lone ticker fills the "operation unresolved" hole this step is looking
  //     for, so without the flag the previous turn's operation flowed straight back in and rule 2
  //     was silently reverted one line later. Caught over HTTP, not in the unit probe — the probe
  //     passed no prior turn, so the two rules never met.
  if (prior) router = applyContext(text, router, prior, subjects, corrections, selfContained);

  // ★ THE READER SUBJECT IS APPENDED, NEVER MATCHED. It is not in the question — "my portfolio" is
  //   a phrase, not a mention we look up — so it can only come from the request's identity. It goes
  //   LAST so a reader-relative question about a company ("how much TCS do I own") keeps the company
  //   at subjects[0], where every single-stock composition already looks.
  if (router.perspective === "reader" && reader) {
    subjects.push(await resolveReaderSubject(reader.userId));
  }

  const resolvedSymbols = subjects.filter((s) => s.kind === "stock").map((s) => s.symbol);
  return {
    raw: text, router, subjects, resolvedSymbols, subjectChoices, needsSubjectChoice, corrections,
    // What the NEXT turn may inherit. Only ever resolved subjects and settled slots.
    //
    // ★ SUBJECTS ACCUMULATE ACROSS THE CONVERSATION, THEY DO NOT REPLACE. "how is TCS doing" then
    //   "and HAL?" then "compare them" — the third turn needs BOTH companies, and carrying only the
    //   previous turn's list gave it HAL alone, so a comparison of two companies ran as a one-sided
    //   read of the second. This turn's subjects lead (they are the most recent thing named) and the
    //   ones before them follow, deduplicated, capped at four so a long conversation cannot drag an
    //   hour-old company into an unrelated question.
    context: {
      subjects: mergeSubjects(subjects, prior?.subjects ?? []),
      operation: router.operation, lens: router.lens, perspective: router.perspective,
      // ⚠ THE ROUTER GENUINELY DOES NOT KNOW WHICH FAMILY WILL ANSWER — that is decided one layer
      //   later, by the composer. Declaring `null` here rather than guessing is the point: the
      //   transport stamps it after composing, at the one place that holds both the context and the
      //   composition id. See `TurnContext.lastFamily`.
      lastFamily: null,
    },
  };
}

// ── the three deterministic corrections above, in detail ──────────────────────────────────────────

/** Recent subjects, newest first, deduplicated by identity. See the note at the call site. */
function mergeSubjects(current: readonly Subject[], prior: readonly Subject[]): Subject[] {
  const key = (x: Subject) => (x.kind === "stock" ? `s:${x.symbol}` : x.kind === "instrument" ? `i:${x.identifier}` : "reader");
  const out: Subject[] = [];
  const seen = new Set<string>();
  for (const x of [...current, ...prior]) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Fill slots a follow-up left blank from the turn before it.
 *
 * ★ IT ONLY EVER FILLS `unresolved` AND EMPTY. A follow-up that states its own operation keeps it, and
 * one that names its own subject keeps that — "and HAL?" inherits the OPERATION and brings its own
 * subject, which is exactly its shape. Nothing here overwrites a settled slot, so a stale context can
 * leave a question under-answered but can never redirect it to another company.
 */
function applyContext(
  text: string,
  router: RouterOutput,
  prior: TurnContext,
  subjects: Subject[],
  corrections: string[],
  /** The question stands on its own. See `isSelfContained` — this step must not fill its operation. */
  selfContained: boolean,
): RouterOutput {
  // Word membership, not regex literals — see the scar note in composition/families/reader.ts.
  const words = new Set(text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/ +/).filter(Boolean));
  const any = (...xs: string[]) => xs.some((x) => words.has(x));
  let out = router;

  // ═══ ★ WHEN A FOLLOW-UP MAY INHERIT A SUBJECT — REWRITTEN AT T-1 ON THREE LIVE FAILURES ════════
  //
  // THE INVARIANT: **a message that names a subject never inherits one, and a screen never inherits
  // a subject at all.** Inheritance is for REFERENTIAL messages — "compare them", "why?" — and
  // nothing else.
  //
  // ⚠ THE OLD TEST WAS `subjects.length === 0 && (words.size <= 4 || pronoun)`, AND BOTH HALVES WERE
  //   WRONG. Measured over live HTTP with the real classifier:
  //
  //   1. `subjects` IS THE RESOLVED LIST, NOT WHAT THE READER SAID. It is empty in three different
  //      situations and only ONE of them is referential:
  //        · the reader named nothing                    → referential, may inherit
  //        · the reader named something OUT OF UNIVERSE  → the honest answer is a STOP (§6.3)
  //        · the reader named something AMBIGUOUS        → the honest answer is "which one?"
  //      "how is Tesla doing" after SHIPROCKET answered about SHIPROCKET: Tesla was heard and could
  //      not resolve, so an emptiness that meant "not our universe" was read as "no subject named".
  //      Inheritance turned a correct refusal into a confident answer about a different company —
  //      strictly worse than the wrong-subject case, because the refusal was already right.
  //      "how is HDFC doing" after LTIM answered about LTM the same way, through the AMBIGUOUS door:
  //      `needsSubjectChoice` was set AND a subject was inherited, so the composer read
  //      `resolvedSymbols[0]` and never asked which HDFC.
  //
  //   2. `words.size <= 4` IS NOT A TEST FOR REFERENCE, IT IS A TEST FOR BREVITY. "find undervalued
  //      stocks" is three words, names no company, needs none — and inherited RELIANCE, then
  //      inherited `perspective: "reader"` on the line below and reported the reader's position in
  //      it. A short question is not a continuing one.
  //
  // So the gate reads what the reader SAID (`router.subjects`, the mentions) and what they asked for,
  // and the brevity proxy is replaced by an explicit referential test.
  const namedOwnSubject = router.subjects.length > 0;
  // A screen is universe-scoped by construction; "which stocks …" is never about the last company.
  const isScreen = out.operation === "screen" || router.operation === "screen";
  // ★ A PRONOUN IS AN EXPLICIT BACK-REFERENCE AND OUTRANKS THE NAMED-SUBJECT GATE — deliberately,
  //   and this cost a regression to learn. Gating pronouns behind `!namedOwnSubject` broke
  //   "compare them with INFY": INFY is named, so inheritance was refused, and the comparison ran
  //   one-sided on INFY alone — the precise stage-6 defect the `resolvedSymbols` comment describes.
  //   The invariant it must not violate is that a NAMED subject is never OVERWRITTEN, and it is not:
  //   inheritance APPENDS (`subjects.push`), so INFY keeps subjects[0] and TCS joins it.
  //   All three T-1 failures are pronoun-free, so none of them is readmitted by this.
  const pronoun = any("them", "it", "they", "those", "that", "this", "both", "these");
  // "why?" · "and?" · "more" — a continuation with no content of its own. Deliberately ≤2 words:
  // three was enough to swallow "find undervalued stocks".
  const bareContinuation = words.size <= 2;
  const refersBack = !isScreen && (pronoun || (!namedOwnSubject && bareContinuation));
  if (refersBack && prior.subjects.length > 0) {
    subjects.push(...prior.subjects);
    corrections.push(
      `subjects inherited: ${prior.subjects.map((x) => (x.kind === "stock" ? x.symbol : x.kind)).join(", ")}`,
    );
    // A question whose subject came from US is in scope by construction — the classifier called
    // "compare them" unresolved for want of anything to resolve, not because it doubted us.
    if (out.scope !== "in_scope") out = { ...out, scope: "in_scope" };
    if (prior.perspective === "reader") out = { ...out, perspective: "reader" };
  }

  if (out.operation === "unresolved" && !selfContained) {
    // Shapes that state their own operation in a word or two. Read HERE rather than by the model
    // because they are unambiguous only in the presence of a prior turn, which the model is not shown.
    const stated: "compare" | "decompose" | null =
      any("compare", "vs", "versus", "against") ? "compare"
      : any("why", "kyun") ? "decompose"
      : null;

    // ═════════════════════════════════════════════════════════════════════════════════════════════
    // ★★ "WHY" ROUTES BY WHAT IS ON SCREEN, NOT BY A FIXED WORD MAP — Phase 3 · MT.
    //
    // ⚠ `stated` ABOVE TURNS EVERY "why" INTO `decompose`, WHICH IS RIGHT ONLY WHERE A LENS SURVIVES
    //   TO NARROW IT. Measured across the three cases the brief names:
    //
    //     after a composite      decompose + health        → A · Attribution        ✓
    //     after a margin fall    decompose + fundamentals  → F · Fundamentals       ✓
    //     after a pattern card   decompose + null          → NOTHING claimed it     ✗ planner
    //
    //   A findings census narrows no lens, so the third "why" inherited nothing to route on and the
    //   reader asking why a flag fired got a whole-company page.
    //
    // ★ WHERE THE LENS CANNOT DECIDE, THE PREVIOUS ANSWER CAN. This maps the family that answered to
    //   the operation its own predicate claims — so "why" after a patterns answer stays in patterns
    //   rather than becoming an unclaimable `decompose`.
    //
    // ⚠ IT ONLY FIRES WHEN THE LENS IS NULL. With a lens present the slot pair is already specific
    //   and the family that owns that lens should answer; overriding then would let a stale family
    //   outrank a live narrowing.
    // ═════════════════════════════════════════════════════════════════════════════════════════════
    const BY_FAMILY: Record<string, OperationSlot> = {
      patterns: "list_findings",
      ownership: "lookup",
      fundamentals: "lookup",
      trajectory: "history",
      attribution: "decompose",
      peer_group: "compare",
      meta: "explain",
    };
    const fromScreen =
      stated !== null && out.lens === null && prior.lens === null && prior.lastFamily
        ? BY_FAMILY[prior.lastFamily] ?? null
        : null;
    if (fromScreen) {
      corrections.push(`operation "${stated}" -> ${fromScreen}: the previous answer was ${prior.lastFamily}`);
    }

    const inherited = fromScreen ?? stated ?? (prior.operation === "unresolved" ? null : prior.operation);
    if (inherited) {
      corrections.push(
        `operation unresolved -> ${inherited}: ${stated ? "stated by the follow-up" : "carried from the previous turn"}`,
      );
      out = { ...out, operation: inherited, confidence: "low" };
    }
  }

  // A lens narrows a question; a follow-up that narrows nothing of its own stays inside the last one.
  if (out.lens === null && prior.lens && (refersBack || out.operation === prior.operation)) {
    out = { ...out, lens: prior.lens };
    corrections.push(`lens null -> ${prior.lens}: carried from the previous turn`);
  }
  return out;
}


/**
 * ★ THE MODEL-BACKED CLASSIFIER — the real path. `lexicalClassifier` is the stand-in that keeps the
 * stack provable with no key; this is what ships.
 *
 * It is still slots and a verdict, and still no tools and no data. On any failure — provider down,
 * unparseable output — it falls to the lexical one rather than to nothing, because a router that
 * cannot classify should degrade to an under-confident answer, never to an error page.
 */
export const modelClassifier: Classifier = async (text) => {
  // ★ CACHE FIRST, AND IT IS THE DETERMINISM GUARANTEE — NOT A COST OPTIMISATION. `temperature: 0`
  //   below took run-to-run reproducibility from 59% to 88% and no further; a served model is not
  //   bit-reproducible on near-ties, which is exactly what an ambiguous question produces. One
  //   question must have one answer, so the roll happens once. See classification-cache.ts.
  //   ⚠ Set ROUTER_CACHE=off to measure the model itself — the probes in tmp/stage5b do.
  const cacheOn = process.env.ROUTER_CACHE !== "off";
  if (cacheOn) {
    const hit = getClassification(text);
    if (hit) return hit;
  }
  if ((process.env.AI_PROVIDER ?? "mock") === "mock") return degradedTo(text, "no model provider configured");
  const model = process.env.AI_MODEL ?? "gemini-3.5-flash";
  try {
    // ★ THE SAME QUOTA GATE AS THE PLANNER, AND FOR THE SAME REASON. The router is the SECOND model
    //   call in a turn, so an ungated router doubles the burn of an ungated planner — which is exactly
    //   what emptied an 18/day budget while this was being built. A denial degrades to the lexical
    //   classifier, which is under-confident rather than absent: the turn still routes, and an
    //   unresolved operation goes to clarifying chips rather than to a guess.
    const { checkAndConsumeAiCall, recordAiTokens } = await import("../ai/core/quota.js");
    const decision = await checkAndConsumeAiCall(model, { kind: "system", job: "router" });
    if (!decision.allowed) {
      return degradedTo(text, `quota: ${decision.scopeDenied ?? "budget"} exhausted for ${model}`);
    }

    const { createAiProvider } = await import("../ai/core/registry.js");
    const res = await createAiProvider().generateStructured<unknown>({
      system: "You output JSON only. No prose outside the JSON.",
      messages: [{ role: "user", content: `${ROUTER_PROMPT}

QUESTION: "${text}"` }],
      // ★ TEMPERATURE 0, AND THIS IS A CORRECTNESS FIX RATHER THAN A TUNING ONE. Left unset, the
      //   adapter omits the field and the provider samples at its default: the stage-5a audit ran
      //   the same 41 questions twice and got DIFFERENT verdicts on 17 of them — the same reader
      //   asking the same question twice received a composed artifact once and a flat refusal the
      //   next. Classification is not a creative task; there is exactly one right answer per
      //   question and sampling from a distribution over slots is a defect, not variety.
      temperature: 0,
    } as never);
    const spent = (res.usage?.promptTokens ?? 0) + (res.usage?.outputTokens ?? 0);
    if (spent > 0) await recordAiTokens(model, spent);

    if (!res.ok) return degradedTo(text, `model output unparseable (${res.finishReason ?? "no reason"})`);
    const parsed = parseRouterOutput(res.data);
    // Stores only because `parsed.source === "model"`; the cache refuses anything else, so a quota
    // denial or a 429 can never pin this question to the under-confident lexical reading.
    if (cacheOn) putClassification(text, parsed);
    return parsed;
  } catch (e) {
    return degradedTo(text, `provider error: ${(e as Error).message.slice(0, 80)}`);
  }
};
