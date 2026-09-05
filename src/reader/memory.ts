// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// READER MEMORY — what the reader asked us to remember, and the rules about what we will.
//
// ★ MOVED HERE WHOLESALE FROM `src/chat/memory.ts` AT STAGE 8 (§8.2 extraction). The chat tree dies
//   in this change; the capability does not. `chat/memory.ts` is now a re-export shim so every gate
//   naming the old path keeps compiling until the file itself goes.
//
// ★ THE WRITES HERE ARE CALLED BY AN ENDPOINT, NOT BY A TOOL (§5.4). `addStatedMemory` and
//   `forgetMemoryById` were reached by a model calling a write tool and a stored proposal; they are
//   now reached by `POST /api/v1/me/memories` and `DELETE /api/v1/me/memories/:id`, which the
//   reader's own tap calls. Same functions, same validation, and no model output anywhere near them.
//
// ⚠ `classifyMemoryText` IS THE REFUSAL GATE AND IT STAYS IN FRONT OF THE WRITE. It is what stops us
//   storing a medical fact, a password or someone else's private detail because a reader typed it —
//   moving the caller from a tool to an endpoint must not move the gate.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { ServiceError } from "../lib/service-error.js";
import { VYTAL_VOCAB_KEYS } from "./vocab.js";

/** ★ 200 chars. A memory is a SENTENCE ABOUT HOW TO EXPLAIN THINGS — "I prefer detailed explanations",
 *  "I already understand options", "skip the basics on banking". 200 is roughly two such sentences: long
 *  enough that no legitimate preference has to be truncated, short enough that it cannot become a
 *  paragraph of life story. It is also the second line of defence on the decline rule below — a narrative
 *  about personal circumstances does not fit in 200 chars even if the pattern gate misses it. */
export const MEMORY_TEXT_MAX = 200;

/** ★ 30 items. At the cap, adding REQUIRES removing — never a silent eviction of the oldest. A memory the
 *  reader explicitly asked for vanishing on its own is a worse failure than being told the list is full,
 *  because the reader would never know it happened.
 *
 *  ⚠⚠ THIS NUMBER EXISTS TWICE. The other copy is the SQL CHECK on `chat_reader_profile.stated_memories`
 *  (prisma/migrations/20260727180000_widen_stated_memories_cap/migration.sql). CHANGE BOTH OR NEITHER —
 *  and if you only came here to change this one, that migration is the file you also need.
 *
 *  WHY EQUAL AND NOT MERELY COMPATIBLE. Only the LOWER of the two ever fires. This one produces a
 *  sentence to a person ("I'm already holding the maximum of 30 … tell me which to forget"); the SQL one
 *  produces a 23514 constraint violation, i.e. a 500. So a DB cap BELOW this is a user-facing bug (it was:
 *  20 vs 30 turned every 21st memory into a database error, and broke verify-memory-live-chat LIVE 7), and
 *  a DB cap ABOVE this is a backstop that silently stopped backstopping. `verifyMemoryCapMatchesDatabase`
 *  below reads the live constraint and asserts the equality, so neither drift can survive a test run. */
export const MEMORY_MAX = 30;

/** The SQL CHECK that mirrors `MEMORY_MAX`. Looked up BY NAME, so the migration deliberately recreates it
 *  under the same name — a rename would turn the guard into a "constraint missing" error. */
export const STATED_MEMORIES_CHECK = "chat_reader_profile_stated_memories_bounded_check";

/**
 * ★ THE DRIFT GUARD — reads the live CHECK predicate and asserts it equals `MEMORY_MAX`.
 *
 * ⚠ A TEST-TIME ASSERTION, NOT A STARTUP ONE, AND THAT IS THE CHOICE NOT AN OVERSIGHT. At startup this
 * would convert a benign disagreement about a memory cap into a REFUSAL TO BOOT — the whole product down
 * over a number that affects one feature's error message — and it would add a DB round-trip to every boot
 * on a connection layer that already flakes. The failure mode of the guard must not outrank the failure
 * mode of the bug. Here it fails a suite, loudly, with both numbers named, which is where a shape check
 * belongs (same posture as the tool-registry and quota-transaction structural checks).
 *
 * Returns the parsed DB cap so a caller can print both sides rather than just "they disagree".
 */
export async function verifyMemoryCapMatchesDatabase(): Promise<
  { ok: true; dbCap: number; codeCap: number } | { ok: false; reason: string; dbCap: number | null; codeCap: number }
> {
  const rows = await prisma.$queryRaw<{ def: string }[]>`
    SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid = 'chat_reader_profile'::regclass AND conname = ${STATED_MEMORIES_CHECK}
  `;
  if (!rows.length) {
    return { ok: false, dbCap: null, codeCap: MEMORY_MAX, reason: `the CHECK "${STATED_MEMORIES_CHECK}" does not exist — the cap is unenforced in SQL` };
  }
  // Read the bound out of the predicate text rather than trusting a stored copy of it: pg_get_constraintdef
  // is the database's own rendering, so this cannot go stale the way a duplicated constant can.
  const m = /jsonb_array_length\([^)]*\)\s*<=\s*(\d+)/.exec(rows[0].def);
  if (!m) return { ok: false, dbCap: null, codeCap: MEMORY_MAX, reason: `could not read a length bound out of the predicate: ${rows[0].def}` };
  const dbCap = Number(m[1]);
  if (dbCap !== MEMORY_MAX) {
    return {
      ok: false,
      dbCap,
      codeCap: MEMORY_MAX,
      reason:
        `MEMORY_MAX is ${MEMORY_MAX} but the SQL CHECK allows ${dbCap}. ` +
        (dbCap < MEMORY_MAX
          ? `The DATABASE would refuse first, so memory ${dbCap + 1} returns a 23514 constraint violation instead of the friendly "list is full" message.`
          : `The code cap fires first, so the SQL backstop is dead weight and no longer enforces anything.`) +
        ` Fix by changing BOTH src/chat/memory.ts MEMORY_MAX and the CHECK in prisma/migrations.`,
    };
  }
  return { ok: true, dbCap, codeCap: MEMORY_MAX };
}

export interface StatedMemory { id: string; text: string; source: "stated"; createdAt: string }
export type MemorySource = "stated" | "inferred";
export interface MemoryEntry {
  /** Stated items carry their stored id. Inferred entries carry a SYNTHETIC, STABLE id ("inferred:register")
   *  so forgetMemory can target them through the same resolution path. */
  id: string;
  text: string;
  source: MemorySource;
  createdAt: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE DECLINE GATE — A RULE IN THE TOOL, NOT A JUDGEMENT THE MODEL MAKES EACH TIME. ★★★
//
// "Remember I'm saving for my daughter's wedding" must be declined even though the reader volunteered it,
// and even though they would be happy for it to be stored. Consent is not the issue: a stock-analytics
// product holding suitability-shaped data about a person is a different risk class from one holding "this
// reader likes plain explanations", and the reader is not in a position to price that difference. So the
// refusal is deterministic and lives here — a model asked to decide this every time will decide it
// differently every time, and the times it gets wrong are exactly the sensitive ones.
//
// ── ⚠ THE LIMITS, STATED PLAINLY, BECAUSE THIS IS A PATTERN GATE AND NOT COMPREHENSION ─────────────
//  1. It matches SURFACE FORMS in English and common Hinglish. It cannot follow implication: "remember
//     what I told you about next October" could encode a wedding and will pass. Nothing here understands
//     anything.
//  2. It OVER-declines in a real grey zone. "Remember I work in pharma so I know the sector" is a
//     legitimate explanation-preference, and it is refused because of the employment framing. That is the
//     deliberate direction to err: the reader can say the same useful thing without it ("remember I
//     already understand the pharma sector"), and the refusal message says so.
//  3. It is not a privacy boundary on its own. `MEMORY_TEXT_MAX` bounds how much can slip through, the
//     distiller's own instruction refuses the same categories independently, and the schema has no
//     free-text field anywhere else. This is one layer of three.
//  4. It says nothing about whether the reader SHOULD share such things — only that this record is the
//     wrong place for them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
interface DeclineRule { category: string; re: RegExp; why: string; probe: string; antiProbe?: string }

const DECLINE_RULES: DeclineRule[] = [
  {
    category: "life-goal",
    // A financial PURPOSE — the definition of suitability data. The verb matters: "saving for", "planning
    // for", "investing for" plus a life event, or a life event plus a money word.
    re: /\b(?:sav(?:e|ing|ings)|invest(?:ing)?|plan(?:ning)?|budget(?:ing)?|corpus|fund)\b[^.!?]{0,40}?\b(?:for|towards?)\b[^.!?]{0,40}?\b(?:wedding|marriage|shaadi|education|college|school|fees|retirement|retire|house|home|flat|car|medical|surgery|treatment|emergency|child|children|kid|kids|daughter|son)\b|\b(?:wedding|marriage|shaadi|retirement|down\s*payment|home\s*loan)\b[^.!?]{0,30}?\b(?:sav|invest|corpus|fund|plan)/i,
    why: "a financial goal or life plan",
    probe: "remember I'm saving for my daughter's wedding",
    antiProbe: "remember I prefer detailed explanations of the Foundation pillar",
  },
  {
    category: "income-employment",
    re: /\b(?:my\s+)?(?:salary|income|ctc|take[-\s]?home|net\s*worth|savings\s+(?:are|is|of)|earnings\s+are)\b|\bi\s+(?:earn|make)\s+(?:about\s+|around\s+|roughly\s+)?[\d₹]|\b(?:i\s+(?:work|am\s+employed)\s+(?:at|for|in|with)|my\s+(?:job|employer|boss|company|firm)|i'?m\s+(?:a|an)\s+\w+\s+(?:at|for)|self[-\s]employed|unemployed|laid\s+off)\b/i,
    why: "income, employment or net worth",
    probe: "remember my salary is 18 lakh a year",
    antiProbe: "remember I already understand the pharma sector well",
  },
  {
    category: "family-and-third-parties",
    // Family AND other named people, together: both are "someone who is not the reader", and a stock
    // product recording either is the same mistake.
    re: /\bmy\s+(?:wife|husband|spouse|partner|daughter|son|child|children|kids?|mother|father|mom|dad|parents|sister|brother|in[-\s]laws?|family|friend|colleague|boss|neighbou?r|uncle|aunt|cousin|beta|beti|patni|biwi)\b/i,
    why: "another person — family, a friend or a colleague",
    probe: "remember my wife handles our taxes",
    antiProbe: "remember my portfolio review happens on Sundays",
  },
  {
    category: "health",
    re: /\bi\s+(?:have|had|was\s+diagnosed\s+with|suffer\s+from)\s+(?:\w+\s+){0,3}?(?:cancer|diabetes|surgery|illness|disease|disability|depression|anxiety)\b|\bmy\s+(?:health|medical|illness|surgery|treatment|diagnosis)\b/i,
    why: "health or medical information",
    probe: "remember I have diabetes so I need low-stress investments",
  },
  {
    category: "age",
    re: /\bi(?:'m|\s+am)\s+(?:\d{1,2})\s*(?:years?\s*old|yo\b)|\bmy\s+age\s+is\b|\bi\s+turn\s+\d{2}\b/i,
    why: "the reader's age",
    probe: "remember I am 34 years old",
    antiProbe: "remember I am new to reading balance sheets",
  },
  {
    category: "debt-obligations",
    re: /\bmy\s+(?:emi|emis|loan|loans|mortgage|debt|debts|credit\s*card\s*(?:debt|bill))\b|\bi\s+(?:owe|have\s+a\s+loan)\b/i,
    why: "personal debts or obligations",
    probe: "remember my EMI is 40000 a month",
  },
  {
    category: "portfolio-numbers",
    // ⚠ A NUMBER ABOUT THEIR BOOK IS A STALE COPY OF A LIVE FIGURE. Holdings, weights and values are
    // computed fresh every session and injected; a remembered copy can only ever go wrong.
    re: /\bi\s+(?:hold|own|bought|have)\s+(?:\d[\d,]*|\w+\s+)?(?:\d[\d,]*\s*)?(?:shares?|units?|lots?)\b|\bmy\s+portfolio\s+is\s+(?:worth|about|around)\b|\bmy\s+(?:holding|position|stake)\s+(?:in\s+\w+\s+)?is\s+[\d₹]|\b\d+\s*%\s+of\s+my\s+(?:portfolio|book|holdings)\b/i,
    why: "a number about the reader's holdings — Vytal computes those live every session",
    antiProbe: "remember I like seeing my portfolio's construction read first",
    probe: "remember I hold 500 shares of TCS",
  },
];

// Load-time probes — the same anti-dead-pattern discipline as guardrail-hinglish.ts and moderation.ts.
for (const r of DECLINE_RULES) {
  if (!r.re.test(r.probe)) {
    throw new Error(`chat/memory: DEAD DECLINE RULE "${r.category}" does not match its probe: "${r.probe}"`);
  }
  if (r.antiProbe !== undefined && r.re.test(r.antiProbe)) {
    throw new Error(`chat/memory: DECLINE RULE "${r.category}" matches its antiProbe, which must be storable: "${r.antiProbe}"`);
  }
}

export interface DeclineVerdict { declined: boolean; category?: string; why?: string; message?: string }

/** The refusal the reader sees. Names WHAT was declined and where the line is, and STOPS.
 *
 *  ⚠ IT DOES NOT PROPOSE A REPLACEMENT. Naming the category that IS storable is orientation; inventing a
 *  specific memory the reader never asked for ("would you like me to remember that you prefer plain
 *  explanations?") is answering a question they did not ask, immediately after refusing the one they did.
 *  That reads as a bargain rather than a boundary. The tool description carries the same ban for the model
 *  (chat/tools/memory.ts §"DO NOT SUBSTITUTE"). */
function declineMessage(why: string): string {
  return (
    `I can't keep that — ${why} isn't something Vytal stores about you, even when you offer it. I'm a ` +
    `stock-health assistant, not a place for your personal or financial circumstances. The only thing I ` +
    `keep is how you like things explained: how much detail you want, which ideas you already know, what ` +
    `to skip.`
  );
}

/** Deterministic category check. Pure — exported so the proof harness can drive it directly.
 *
 *  ⚠ THIS IS NOT THE FIRST GATE ANY MORE. `detectNameRequest` runs BEFORE it on the write paths — see
 *  §"THE SELF-NAMING CARVE-OUT" below for why a reader naming THEMSELVES never reaches these rules. */
export function classifyMemoryText(text: string): DeclineVerdict {
  for (const r of DECLINE_RULES) {
    if (r.re.test(text)) return { declined: true, category: r.category, why: r.why, message: declineMessage(r.why) };
  }
  return { declined: false };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE SELF-NAMING CARVE-OUT — A FORM OF ADDRESS IS NOT PERSONAL CIRCUMSTANCE. ★★★
//
// "My name is Arman but I want you to call me Ronaldo" is the single most natural memory request this
// product will ever receive, and it is exactly what `statedName` was narrowed to hold: a form of address
// requested IN CONVERSATION that differs from the account name. It was being refused — not by the decline
// rules above (measured: not one of them matches any self-naming phrasing) but by the MODEL, generalising
// the words "personal circumstances" in its tool description into "personal details like names". The fix
// is therefore two-sided: the prompts stop implying names are unstorable, and this code makes the route
// explicit so the model has somewhere obvious to put it.
//
// ── ★ WHY THIS RUNS BEFORE THE DECLINE GATE, NOT AFTER ─────────────────────────────────────────────
// Order was the whole decision. Gate-first over-declines a legitimate case — "my family calls me Ronaldo,
// use that" trips `family-and-third-parties` on the word "family" while asking for nothing but a
// nickname. Name-first cannot leak anything in exchange, because the name path persists ONE extracted
// token of ≤40 chars into a ≤40-char CHECK-constrained column and DISCARDS THE REST OF THE SENTENCE.
// "Remember my wife's name is Priya and call me Ronaldo" stores "Ronaldo" and nothing else — Priya never
// touches the database. There is no channel here for circumstance to ride along in.
//
// ── ⚠ THE ONE PROPERTY EVERY PATTERN MUST HAVE: A FIRST-PERSON OBJECT ──────────────────────────────
// Every form below anchors on "me", "my name", or "I" — which is what makes them structurally incapable
// of matching a third party. "call my son Rohan" has no "call me"; "my wife's name is Priya" has a word
// between "my" and "name". A reader naming THEMSELVES is carved out; a reader naming ANYONE ELSE still
// falls through to `family-and-third-parties`, which is where it belongs. That is the whole distinction,
// and the load-time probes below hold both halves of it.
//
// ── AND THE DISTILLER'S "NEVER INFER A NAME" STAYS TRUE ────────────────────────────────────────────
// chat/profile.ts forbids DERIVING a name from an email, a signature or a greeting. This path derives
// nothing: the reader typed the words "call me Ronaldo" and confirmed a proposal that restated it. The
// two rules do not overlap — one bans guessing, this one records an instruction.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** A name token. Deliberately narrow: letters plus the punctuation real names carry (O'Neil, J.R., Al-Amin). */
const NAME_WORD = String.raw`[A-Za-z][A-Za-z'’.\-]*`;
/** Up to three words — "Ronaldo", "Arman Shaikh", "Dr Arman Shaikh". Trimmed further by `cleanName`. */
const NAME_RUN = String.raw`(${NAME_WORD}(?:\s+${NAME_WORD}){0,2})`;

const NAME_REQUEST_PATTERNS: RegExp[] = [
  // ⚠ PRESENT TENSE ONLY — "call me X" and "everyone calls me X" are standing preferences; "they called
  // me yesterday" is an EVENT, and admitting the past tense would let it be stored as a name. Deliberately
  // narrower than English allows, in the direction where a miss costs a re-ask and a hit costs a wrong name.
  new RegExp(String.raw`\bcalls?\s+me\s+${NAME_RUN}`, "gi"),
  new RegExp(String.raw`\bmy\s+name(?:'s|’s|\s+is)\s+${NAME_RUN}`, "gi"),
  new RegExp(String.raw`\bi(?:'m|’m|\s+am)\s+called\s+${NAME_RUN}`, "gi"),
  new RegExp(String.raw`\bi\s+go\s+by\s+${NAME_RUN}`, "gi"),
  new RegExp(String.raw`\b(?:address|refer\s+to)\s+me\s+as\s+${NAME_RUN}`, "gi"),
  new RegExp(String.raw`\bto\s+(?:call|address)\s+me\s+(?:as\s+)?${NAME_RUN}`, "gi"),
  new RegExp(String.raw`\bprefer(?:\s+it)?\s+to\s+be\s+called\s+${NAME_RUN}`, "gi"),
  // Hinglish: the name comes BEFORE the verb ("mujhe Ronaldo bulao").
  new RegExp(String.raw`\bmujhe\s+${NAME_RUN}\s+(?:bulao|bulaao|bulana|bulaya|kaho|kehna|bolo)\b`, "gi"),
];

/** ★ THE CORRECTION TAIL. "don't call me Arman Shaikh, just Arman" — the primary pattern captures the name
 *  being REJECTED. Only meaningful when a primary already matched, so it is scanned separately. */
const NAME_TAIL_PATTERN = new RegExp(String.raw`\b(?:just|simply|only)\s+${NAME_RUN}\s*[.!?]?\s*$`, "i");

/** A capture stops at the first of these AFTER the first word — "Ronaldo from now" is a name plus framing,
 *  "Arman but I" is a name plus a pivot. Never applied to word one, so a reader called Will or May keeps it. */
const NAME_STOP_AFTER = new Set([
  "and", "but", "or", "from", "now", "on", "onward", "onwards", "going", "forward", "henceforth", "instead",
  "please", "ok", "okay", "thanks", "thank", "always", "only", "just", "in", "at", "for", "when", "if", "so",
  "then", "because", "since", "while", "i", "you", "it", "that", "this", "my", "me", "is", "was", "will",
  "would", "can", "do", "don", "not", "no", "the", "a", "an", "ab", "se", "karo", "bhi", "sirf", "yaar", "hi",
]);

/** ⚠ A capture whose FIRST word is one of these is not a name at all — "call me by my first name",
 *  "my name is not important". Rejecting outright is right: half a match is worse than none. */
const NAME_BLOCKED_LEAD = new Set([
  "me", "my", "mine", "i", "you", "your", "yours", "it", "its", "that", "this", "they", "them", "him", "her",
  "us", "we", "he", "she", "by", "as", "to", "at", "in", "of", "for", "not", "no", "never", "nothing",
  "anything", "something", "whatever", "what", "who", "the", "a", "an", "is", "was", "be", "been", "being",
  "please", "and", "but", "or", "from", "now", "then", "when", "if", "so", "just", "simply", "only", "with",
  "back", "about", "again", "later", "yesterday", "today", "tomorrow", "tonight", "here", "there", "up",
]);

/** One raw capture → a storable name, or null. Forward-scan-and-stop, never a greedy trim. */
function cleanName(raw: string): string | null {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const bare = words[i].replace(/[^A-Za-z'’.\-]/g, "");
    if (!bare) break;
    const key = bare.toLowerCase().replace(/[.'’\-]+$/, "");
    if (i === 0) {
      if (!key || NAME_BLOCKED_LEAD.has(key)) return null;
    } else if (!key || NAME_STOP_AFTER.has(key)) {
      break;
    }
    out.push(bare);
  }
  const name = out.join(" ").replace(/[.,;:]+$/, "").trim();
  // 40 is the column's CHECK constraint. Longer is prose wearing a name's clothes — fall through to the
  // ordinary memory path (and its own 200-char bound and decline gate) rather than truncating a person's name.
  return name && name.length <= 40 ? name : null;
}

/**
 * The form of address this text asks for, or null. THE LAST match wins: "my name is Arman but I want you
 * to call me Ronaldo" states the account name first and the request second, and the request is the point.
 */
export function detectNameRequest(text: string): string | null {
  let best: { idx: number; name: string } | null = null;
  for (const re of NAME_REQUEST_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = cleanName(m[1] ?? "");
      if (name && (!best || m.index >= best.idx)) best = { idx: m.index, name };
      if (m.index === re.lastIndex) re.lastIndex++; // zero-length guard
    }
  }
  if (!best) return null;
  const tail = NAME_TAIL_PATTERN.exec(text);
  if (tail) {
    const corrected = cleanName(tail[1] ?? "");
    if (corrected && tail.index >= best.idx) return corrected;
  }
  return best.name;
}

// ── LOAD-TIME PROBES FOR THE CARVE-OUT — the same discipline as the decline rules' own probes. ─────
// ★ THE SECOND LOOP IS THE ONE THAT MATTERS. No decline rule matches a self-naming form TODAY; the
// failure this guards is a future broadening — adding `\bmy\s+name\b` to `family-and-third-parties`, or a
// general name pattern — which would silently re-break the exact bug this file was edited to fix. Pinning
// it here means that edit fails at import rather than in a reader's conversation.
const NAME_PROBES: [text: string, expected: string | null][] = [
  ["call me Ronaldo", "Ronaldo"],
  ["my name is Arman but I want you to call me Ronaldo from now", "Ronaldo"],
  ["Call me Ronaldo from now on", "Ronaldo"],
  ["my name is Ronaldo", "Ronaldo"],
  ["I prefer to be called Ronaldo", "Ronaldo"],
  ["I'd prefer you to call me AK", "AK"],
  ["don't call me Arman Shaikh, just Arman", "Arman"],
  ["I go by Ronaldo", "Ronaldo"],
  ["address me as Dr Sharma", "Dr Sharma"],
  ["mujhe Ronaldo bulao", "Ronaldo"],
  // ★ THE GREY-ZONE CASE THAT MOTIVATED RUNNING AHEAD OF THE DECLINE GATE. Gate-first, "family" would
  // refuse a request for nothing but a nickname. Name-first stores "Ronaldo" and discards the rest.
  ["my family calls me Ronaldo, use that", "Ronaldo"],
  ["everyone calls me AK", "AK"],
  // …but the PAST tense is an event, not a standing preference, and must not become a name.
  ["they called me yesterday", null],
  ["call me back later", null],
  // ⚠ THIRD PARTIES MUST NOT REACH THE NAME PATH — they belong to the decline gate.
  ["remember my wife's name is Priya", null],
  ["remember my daughter is called Anaya", null],
  ["call my broker Rajesh", null],
  ["her name is Priya", null],
  // Not a naming request at all.
  ["what is my name?", null],
  ["call me by my first name", null],
  ["my name is not important", null],
  ["remember I prefer detailed explanations", null],
];
for (const [text, expected] of NAME_PROBES) {
  const got = detectNameRequest(text);
  if (got !== expected) {
    throw new Error(`chat/memory: NAME DETECTOR probe failed on "${text}" — expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  }
}
/** ★ SELF-NAMING SENTENCES THAT MENTION NOBODY ELSE. These must be clean of every decline rule as well as
 *  routing to the name path — belt AND braces, because the ordering above is the belt and a future reorder
 *  would silently drop it. (The grey-zone probes above are deliberately NOT in this list: "my family calls
 *  me Ronaldo" DOES trip `family-and-third-parties`, and is saved only by the ordering. That is the design,
 *  not an oversight — see §"WHY THIS RUNS BEFORE THE DECLINE GATE".) */
const PURE_NAME_PROBES = [
  "call me Ronaldo",
  "my name is Arman but I want you to call me Ronaldo from now",
  "I prefer to be called Ronaldo",
  "don't call me Arman Shaikh, just Arman",
  "I go by Ronaldo",
  "mujhe Ronaldo bulao",
];
for (const r of DECLINE_RULES) {
  for (const text of PURE_NAME_PROBES) {
    if (r.re.test(text)) {
      throw new Error(
        `chat/memory: DECLINE RULE "${r.category}" now matches a SELF-NAMING request: "${text}". A reader ` +
          `naming THEMSELVES is not personal circumstance — scope the rule to third-party names.`,
      );
    }
  }
}
for (const text of PURE_NAME_PROBES) {
  if (detectNameRequest(text) === null) throw new Error(`chat/memory: PURE_NAME_PROBES entry no longer routes to the name path: "${text}"`);
}

// ── THE INFERRED SIDE, RENDERED AS PLAIN SENTENCES ────────────────────────────────────────────────
// The distilled fields are enums and ints; a reader asking what is remembered needs sentences. These are
// authored here rather than by a model so the rendering cannot drift or embellish.
const REGISTER_SENTENCE: Record<string, string> = {
  en: "You write in English, so I answer in English.",
  "hi-latin": "You write in Hinglish, so I answer in Hinglish.",
  devanagari: "You write in Hindi (Devanagari), so I answer the same way.",
  mixed: "You mix languages, so I follow whichever one you use.",
};
const VOCAB_SENTENCE: Record<string, string> = {
  band: "the health bands", pillar: "the four pillars", foundation: "the Foundation pillar",
  momentum: "the Momentum pillar", market: "the Market pillar", ownership: "the Ownership pillar",
  health_score: "the health score", coverage: "coverage", provisional: "what Provisional means",
  lens: "the three lenses", field_verdict: "field verdicts", finding: "findings",
  red_flag: "red flags", pattern: "patterns", trajectory: "trajectory", divergence: "divergence",
  peer_group: "peer groups", construction: "the Construction read", health_read: "the Health read",
  pledging: "share pledging",
};

/**
 * The unified list: what the reader stated, then what was inferred. Newest stated first.
 * Inferred entries get stable synthetic ids so `forgetMemory` can target them identically.
 */
export async function listMemories(userId: string): Promise<MemoryEntry[]> {
  const p = await prisma.chatReaderProfile.findUnique({ where: { userId } });
  if (!p) return [];
  const out: MemoryEntry[] = [];

  for (const m of readStated(p.statedMemories)) {
    out.push({ id: m.id, text: m.text, source: "stated", createdAt: m.createdAt });
  }
  if (p.preferredRegister && REGISTER_SENTENCE[p.preferredRegister]) {
    out.push({ id: "inferred:register", text: REGISTER_SENTENCE[p.preferredRegister], source: "inferred", createdAt: p.registerFirstSeenAt?.toISOString() ?? null });
  }
  if (p.depthNudge !== 0) {
    out.push({
      id: "inferred:depth",
      text: p.depthNudge < 0 ? "You prefer explanations kept simpler than the default." : "You prefer more detail than the default.",
      source: "inferred",
      createdAt: p.depthFirstSeenAt?.toISOString() ?? null,
    });
  }
  for (const g of p.glossaryGaps) {
    if (!(VYTAL_VOCAB_KEYS as readonly string[]).includes(g)) continue;
    out.push({ id: `inferred:gap:${g}`, text: `You've asked about ${VOCAB_SENTENCE[g] ?? g}, so I explain it rather than assume it.`, source: "inferred", createdAt: null });
  }
  if (p.statedName) {
    out.push({ id: "inferred:name", text: `You asked to be called ${p.statedName}.`, source: "stated", createdAt: p.nameStatedAt?.toISOString() ?? null });
  }
  return out;
}

/** Parse the JSONB column defensively — it is the only untyped thing in the row. */
function readStated(raw: unknown): StatedMemory[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is StatedMemory =>
      !!x && typeof x === "object" && typeof (x as StatedMemory).id === "string" && typeof (x as StatedMemory).text === "string",
  );
}

// ── ADD ───────────────────────────────────────────────────────────────────────────────────────────
/** `kind` says WHICH store was written: "name" lands on the `stated_name` COLUMN, "memory" on the list.
 *  Both return a rendered `memory` entry so every consumer has one uniform receipt to read back. */
export interface AddMemoryResult { kind: "memory" | "name"; memory: StatedMemory; total: number; name?: string }

/**
 * Store one stated memory. Throws ServiceError with a human message on every refusal path — the tool
 * layer surfaces `.message` verbatim, so each one has to read as a sentence to a person.
 *
 * ★ TWO DESTINATIONS. A form of address goes to the `statedName` column; everything else appends to the
 * list. Same entry point deliberately: the reader says "remember X" for both, and a second tool would
 * mean the model choosing between them — a choice it demonstrably gets wrong (it refused outright).
 */
export async function addStatedMemory(input: { text?: unknown }, userId: string): Promise<AddMemoryResult> {
  const text = typeof input.text === "string" ? input.text.trim().replace(/\s+/g, " ") : "";
  if (!text) throw new ServiceError(400, "validation_error", "There was nothing to remember — tell me what you'd like me to keep in mind.");
  if (text.length > MEMORY_TEXT_MAX) {
    throw new ServiceError(
      400,
      "memory_too_long",
      `That's too long to keep (${text.length} characters; the limit is ${MEMORY_TEXT_MAX}). A memory works ` +
        `best as one short sentence about how you like things explained.`,
    );
  }

  // ★ THE NAME PATH RUNS FIRST — see §"THE SELF-NAMING CARVE-OUT". Only the extracted token is persisted;
  // the rest of the sentence is discarded, which is what makes running ahead of the decline gate safe.
  const requested = detectNameRequest(text);
  if (requested) return await setStatedName(requested, userId);

  const verdict = classifyMemoryText(text);
  if (verdict.declined) throw new ServiceError(422, "memory_declined", verdict.message!);

  const existing = await prisma.chatReaderProfile.findUnique({ where: { userId }, select: { statedMemories: true } });
  const current = readStated(existing?.statedMemories);

  // ★ AT THE CAP, ADDING REQUIRES REMOVING. Never a silent eviction.
  if (current.length >= MEMORY_MAX) {
    throw new ServiceError(
      409,
      "memory_limit_reached",
      `I'm already holding the maximum of ${MEMORY_MAX} things you've asked me to remember, so I can't add ` +
        `another until one goes. Ask me what I remember and tell me which to forget, then we can add this.`,
    );
  }
  // An exact duplicate is a no-op rather than a second identical row.
  const dupe = current.find((m) => m.text.toLowerCase() === text.toLowerCase());
  if (dupe) return { kind: "memory", memory: dupe, total: current.length };

  const memory: StatedMemory = { id: crypto.randomUUID(), text, source: "stated", createdAt: new Date().toISOString() };
  const next = [memory, ...current];
  await prisma.chatReaderProfile.upsert({
    where: { userId },
    create: { userId, statedMemories: next as unknown as object[] },
    update: { statedMemories: next as unknown as object[] },
  });
  return { kind: "memory", memory, total: next.length };
}

/**
 * Record a requested form of address on the `stated_name` COLUMN.
 *
 * ★ A COLUMN, NOT A LIST ITEM — three consequences, all of them wanted. It does not consume one of the
 * MEMORY_MAX slots (a name is not a preference about explanations and should not crowd one out); a second
 * "call me X" REPLACES the first rather than accumulating contradictory names; and `forgetMemory` already
 * knows how to clear it through the synthetic `inferred:name` id, so "forget my name" needs no new code.
 *
 * ⚠ THE SAME COLUMN THE NIGHTLY DISTILLER WRITES, and that is deliberate: one place to read from at
 * injection time. The distiller may only ever put an EXPLICITLY REQUESTED name here (chat/profile.ts
 * forbids inference), so both writers carry the same meaning and last-write-wins is coherent.
 */
async function setStatedName(name: string, userId: string): Promise<AddMemoryResult> {
  const now = new Date();
  await prisma.chatReaderProfile.upsert({
    where: { userId },
    create: { userId, statedName: name, nameStatedAt: now },
    update: { statedName: name, nameStatedAt: now },
  });
  const total = readStated(
    (await prisma.chatReaderProfile.findUnique({ where: { userId }, select: { statedMemories: true } }))?.statedMemories,
  ).length;
  return {
    kind: "name",
    name,
    total,
    memory: { id: "inferred:name", text: `You asked to be called ${name}.`, source: "stated", createdAt: now.toISOString() },
  };
}

// ── FORGET ────────────────────────────────────────────────────────────────────────────────────────
/**
 * ★ HOW A REFERENCE RESOLVES. The reader says "forget the one about explanations", never an id — so the
 * tool takes free text and this resolves it against the unified list:
 *
 *   1. An EXACT id match short-circuits (the model may pass one back from a previous listMemories).
 *   2. Otherwise the reference is reduced to content words (stopwords and the framing verbs "forget",
 *      "remember", "memory", "the", "one", "about" removed) and each memory is scored by how many of
 *      those words it contains.
 *   3. A UNIQUE top score wins.
 *   4. ⚠ A TIE DOES NOT GUESS. Two memories scoring equally comes back as `ambiguous` with the
 *      candidates, and the tool asks which — deleting the wrong memory is unrecoverable and the reader
 *      would not necessarily notice.
 *   5. No match at all comes back as `none`, with the full list, so the reader can point at one.
 */
const STOPWORDS = new Set([
  "forget", "remember", "remembered", "memory", "memories", "the", "a", "an", "one", "about", "that", "this",
  "please", "my", "me", "i", "it", "of", "on", "and", "to", "for", "delete", "remove", "drop", "stop", "you",
  "your", "thing", "bit", "part", "note", "regarding",
]);

export interface ForgetResolution {
  status: "resolved" | "ambiguous" | "none";
  match?: MemoryEntry;
  candidates?: MemoryEntry[];
  all?: MemoryEntry[];
}

export function resolveMemoryReference(reference: string, entries: MemoryEntry[]): ForgetResolution {
  const ref = reference.trim();
  if (!ref) return { status: "none", all: entries };

  const byId = entries.find((e) => e.id === ref || e.id.toLowerCase() === ref.toLowerCase());
  if (byId) return { status: "resolved", match: byId };

  const words = (ref.toLowerCase().match(/[a-z']{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
  if (!words.length) return { status: "none", all: entries };

  // ★ SCORED BY MATCHED CHARACTERS, NOT MATCHED WORD COUNT. Measured: "that I prefer Hinglish" tied
  // between "prefers detailed explanations" and the inferred Hinglish entry, because counting words made
  // the weak, ubiquitous "prefer" worth exactly as much as the distinctive "hinglish". Longer words are
  // more discriminating, and summing their lengths is the cheapest honest way to say so. True
  // near-duplicates still score EXACTLY equal, so the ambiguity path below is unaffected.
  const scored = entries
    .map((e) => {
      const hay = e.text.toLowerCase();
      return { e, score: words.filter((w) => hay.includes(w)).reduce((n, w) => n + w.length, 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { status: "none", all: entries };
  if (scored.length > 1 && scored[1].score === scored[0].score) {
    return { status: "ambiguous", candidates: scored.filter((x) => x.score === scored[0].score).map((x) => x.e) };
  }
  return { status: "resolved", match: scored[0].e };
}

export interface ForgetResult { forgotten: MemoryEntry; remaining: number }

/** Delete one entry — stated item or inferred field — by its id from the unified list. */
export async function forgetMemoryById(id: string, userId: string): Promise<ForgetResult> {
  const entries = await listMemories(userId);
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new ServiceError(404, "memory_not_found", "I couldn't find that among the things I remember.");

  const p = await prisma.chatReaderProfile.findUnique({ where: { userId } });
  if (!p) throw new ServiceError(404, "memory_not_found", "There's nothing stored for you yet.");

  if (id === "inferred:register") {
    await prisma.chatReaderProfile.update({ where: { userId }, data: { preferredRegister: null, registerSessionCount: 0, registerFirstSeenAt: null, registerLastSeenAt: null } });
  } else if (id === "inferred:depth") {
    await prisma.chatReaderProfile.update({ where: { userId }, data: { depthNudge: 0, depthSessionCount: 0, depthFirstSeenAt: null, depthLastSeenAt: null } });
  } else if (id.startsWith("inferred:gap:")) {
    const key = id.slice("inferred:gap:".length);
    await prisma.chatReaderProfile.update({ where: { userId }, data: { glossaryGaps: p.glossaryGaps.filter((g) => g !== key) } });
  } else if (id === "inferred:name") {
    await prisma.chatReaderProfile.update({ where: { userId }, data: { statedName: null, nameStatedAt: null } });
  } else {
    const next = readStated(p.statedMemories).filter((m) => m.id !== id);
    await prisma.chatReaderProfile.update({ where: { userId }, data: { statedMemories: next as unknown as object[] } });
  }
  return { forgotten: entry, remaining: (await listMemories(userId)).length };
}

/** The stated memories only, for injection into the orientation header. */
// ★ MOVED TO `src/reader/profile.ts` AT STAGE 6 (§8.2 extraction), AND RE-EXPORTED HERE RATHER THAN
//   COPIED. The composer needs these reads and this tree is DELETE; a second implementation would be
//   the parallel path N-3 forbids. One implementation, two importers, and when this file dies the
//   import goes with it.
export { statedMemoriesFor, statedNameFor } from "./profile.js";
