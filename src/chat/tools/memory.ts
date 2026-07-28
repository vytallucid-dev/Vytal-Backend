// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// USER-DIRECTED MEMORY — the three tools. Rules live in chat/memory.ts; these translate conversation.
//
//   rememberThis  klass:"write"  → PROPOSES, never writes. Executed from the stored proposal on "yes".
//   listMemories  klass:"read"   → direct execution. Reading what is stored changes nothing.
//   forgetMemory  klass:"action" → direct execution, BY DESIGN (see below).
//
// ★ WHY FORGET DOES NOT CONFIRM, WHEN EVERY OTHER MUTATION DOES. The propose→confirm ritual exists
// because a write commits a NUMBER the reader has to trust — a price, a quantity, a date — and "yes" has
// to be scoped to values they have seen restated. Forgetting has no values: the reader has just named the
// thing they want gone, in the same breath. A confirm step there is pure friction, and worse, it trains
// the reader to click through confirmations, which devalues the ones that matter.
//
// ⚠ THE RISK IS MOVED, NOT REMOVED: deleting the WRONG memory is unrecoverable and the reader might never
// notice. So the care goes into RESOLUTION instead of confirmation — an ambiguous reference asks which
// one rather than guessing (chat/memory.ts §"HOW A REFERENCE RESOLVES").
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import {
  listMemories, resolveMemoryReference, forgetMemoryById, classifyMemoryText, detectNameRequest,
  MEMORY_MAX, MEMORY_TEXT_MAX,
} from "../memory.js";
import { propose, str, serviceMessage } from "./write-shared.js";
import type { ChatTool, ToolContext, ToolResult } from "./types.js";

// ── rememberThis ──────────────────────────────────────────────────────────────────────────────────
// ⚠ THE FIRST SENTENCE IS THE TRIGGER, IN THE READER'S OWN WORDS — and that ordering is load-bearing.
// This description originally opened by explaining WHAT a memory is, with the trigger condition forty
// words in. Measured across three live attempts: the model never called the tool once, and instead
// replied "Since you prefer detailed explanations, we can dive deep…" — acknowledging the request
// conversationally while storing nothing, which is the exact failure CHAT_WRITE_DISCIPLINE exists to
// prevent. Front-loading the literal phrasings a reader uses fixed it. Tool selection on this model
// keys hard on how a description OPENS; put the trigger first and the explanation after.
//
// ── ★ THE SECOND MISS, AND WHY THE OPENING CHANGED AGAIN: INSTRUCTION-SHAPED vs FACT-SHAPED ────────
// The front-loaded triggers were all FACT-shaped ("remember that I prefer…"), so INSTRUCTION-shaped
// phrasings still missed entirely. Measured over a 6-cell matrix, identical whether the list was full or
// empty — so it was tool selection, not the cap:
//
//     "Remember that I like short answers"          → NO tool. "Got it — I'll keep my answers short."
//     "Remember that I prefer detailed explanations" → rememberThis
//     "Remember that I already understand options"   → rememberThis
//
// The failing sentence is the one the model can SATISFY IN THE SAME BREATH. Handed an instruction it can
// obey immediately, it obeys and considers the turn done; handed a fact about the reader, it has nothing
// to do but record it. That is a reasonable reading — it just silently drops the standing half, so the
// reader has to say it again every session and eventually stops believing memory works.
//
// ★ SO THE FIX IS NOT "OBEY LESS". Both readings are correct and the reader wants both: do it now AND
// keep doing it. The description now OPENS on the instruction-shaped forms (the ones that missed), and
// says in as many words that obeying and storing are both required, in the same reply.
//
// ⚠ AND THE OPPOSITE ERROR IS REAL. "Explain that simply" is about the answer in front of them, not a
// standing preference, and storing it would quietly reshape every future conversation off one throwaway
// sentence. STANDING-vs-MOMENTARY is the line, and it is stated with its own examples for that reason.
const REMEMBER_DESCRIPTION =
  "CALL THIS when the reader tells you HOW THEY WANT THINGS EXPLAINED FROM NOW ON, IN ANY OF THREE " +
  "SHAPES — all three are the same request and all three require this tool:\n" +
  "· AN INSTRUCTION (the most common, and the easiest to miss): \"I like short answers\", \"always keep " +
  "it brief\", \"keep it simple from now on\", \"be more detailed with me\", \"skip the intro every time\".\n" +
  "· A NEGATIVE INSTRUCTION — a \"don't\" is still a standing preference, not just a rule for this reply: " +
  "\"don't use jargon with me\", \"stop explaining the basics\", \"no more acronyms\", \"never open with a " +
  "summary\", \"skip the disclaimers\". CALL THIS FOR THESE TOO. Agreeing to stop doing something and " +
  "storing nothing means you start doing it again next conversation.\n" +
  "· ★ A BARE STATEMENT OF PREFERENCE, with no request and no verb like \"remember\" attached: \"I prefer " +
  "detailed explanations\", \"I already understand options\", \"I'm new to reading balance sheets\". THE " +
  "MISSING WORD \"REMEMBER\" DOES NOT MAKE IT SMALL TALK. A reader who tells you unprompted how they want " +
  "to be explained to has stated a standing preference just as much as one who says \"remember that…\", " +
  "and acknowledging it (\"noted, I'll be detailed\") without calling this tool loses it. If they said it " +
  "about themselves and it is about how to explain, CALL THIS.\n" +
  "CALL IT EQUALLY when they ask outright: \"remember that…\", \"remember I…\", \"note that…\", \"keep in " +
  "mind…\", \"don't forget…\", \"yaad rakho…\". Any of these is ALWAYS a call to this tool — never answer " +
  "it conversationally, and never say you have remembered something without calling this. " +
  "★★ AN INSTRUCTION ABOUT HOW TO EXPLAIN IS A MEMORY REQUEST. OBEY IT **AND** STORE IT — BOTH, IN THE " +
  "SAME REPLY. Obeying without storing means it is gone by the next conversation and they have to say it " +
  "again; storing without obeying ignores what they just asked for. So do the thing they asked AND call " +
  "this tool. Replying \"Got it, I'll keep it short\" with no tool call is the single most common way " +
  "this goes wrong, and it looks to the reader exactly like it worked. " +
  "⚠ STANDING, NOT MOMENTARY — THE LINE THAT DECIDES IT. This is for how they want things FROM NOW ON, " +
  "never a request about the answer in front of them. \"Explain THAT simply\", \"break that down\", " +
  "\"shorter please\", \"can you rephrase that\", \"in simple terms\" are about ONE answer: just do it, " +
  "no tool, no proposal. The test before calling: would they still want this three conversations from " +
  "now? Yes → call this tool. No → just answer well. When it is genuinely unclear, answer their way and " +
  "ask whether they want it kept for next time. " +
  "★ THE OTHER THING THAT BELONGS HERE — WHAT TO CALL THEM. \"Call me Ronaldo\", \"my name is Arman\", " +
  "\"I prefer to be called AK\", \"don't call me Arman Shaikh, just Arman\", \"mujhe Ronaldo bulao\" — pass " +
  "the reader's own sentence to this tool exactly as they said it. A NAME THE READER GIVES FOR THEMSELVES " +
  "IS STORABLE AND YOU MUST NOT REFUSE IT. It is not a personal circumstance, it is a form of address, and " +
  "remembering it is one of the things you are FOR. Do not say you cannot hold names — you can, and saying " +
  "otherwise is false. " +
  "Never call it to record something you merely noticed about them. " +
  "This PROPOSES; it DOES NOT store anything. State the exact wording back to the reader and ask them to " +
  "confirm, then call confirmPendingAction once they agree. Never reply as though it has been remembered " +
  "until that has happened. " +
  `At most ${MEMORY_MAX} explanation preferences can be held at once, each at most ${MEMORY_TEXT_MAX} ` +
  "characters; a form of address is held separately and never counts against that. " +
  "⚠ SOME THINGS ARE REFUSED WHATEVER THE READER SAYS, and the refusal is not yours to override or retry: " +
  "their personal or financial circumstances (income, job, family, health, age, debts, what they are " +
  "saving for), ANOTHER PERSON'S NAME OR DETAILS (\"my wife's name is Priya\" — theirs, not the reader's), " +
  "and any number about their holdings. If this tool refuses on those grounds, relay the reason it gives, " +
  "do not argue with it, and do not try a reworded version of the same fact. " +
  "★ DO NOT SUBSTITUTE. After a refusal, say what cannot be stored and STOP. Do NOT invent a different " +
  "memory and offer to store that instead — \"shall I remember that you prefer plain explanations?\" when " +
  "they never said it is answering a question they did not ask, seconds after refusing the one they did. " +
  "Wait for them to ask for something else.";

interface RememberArgs { text?: unknown }

export const rememberThisTool: ChatTool<RememberArgs> = {
  name: "rememberThis",
  klass: "write",
  description: REMEMBER_DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description:
          "What to remember, as one short sentence in the reader's own terms — e.g. \"prefers detailed " +
          "explanations\", \"already understands options\", \"skip the basics on banking\".",
      },
    },
    required: ["text"],
  },
  async handler(args, ctx: ToolContext): Promise<ToolResult> {
    const text = str(args.text);
    if (!text) return { ok: false, error: "Tell me what you'd like me to remember." };
    if (text.length > MEMORY_TEXT_MAX) {
      return {
        ok: false,
        error:
          `That's ${text.length} characters and the limit is ${MEMORY_TEXT_MAX}. Ask the reader for the ` +
          `shorter version — a memory works best as one sentence.`,
      };
    }
    // ★ THE NAME BRANCH IS DECIDED HERE TOO, BY THE SAME FUNCTION THE SERVICE USES — never by a second
    // copy of the rule and never by the model. It runs BEFORE the decline gate for the reason given in
    // chat/memory.ts §"THE SELF-NAMING CARVE-OUT", and it skips the cap because a form of address lives in
    // its own column and cannot crowd out an explanation preference.
    const requestedName = detectNameRequest(text);
    if (requestedName) {
      return propose(ctx, {
        kind: "rememberThis",
        summary: "Use the form of address the reader asked for",
        fields: [{ label: "Would call them", value: requestedName }],
        args: { text },
      });
    }

    // ★ THE DECLINE IS CHECKED AT PROPOSE TIME, not just at execute. Proposing something that will be
    // refused would put the reader through a confirmation for a change that cannot happen — and would
    // restate the sensitive sentence back at them on the way.
    const verdict = classifyMemoryText(text);
    if (verdict.declined) return { ok: false, error: verdict.message! };

    // Cap checked here too, so the reader is told BEFORE confirming rather than after.
    const existing = (await listMemories(ctx.userId)).filter((m) => m.source === "stated" && !m.id.startsWith("inferred:"));
    if (existing.length >= MEMORY_MAX) {
      return {
        ok: false,
        error:
          `You're already holding the maximum of ${MEMORY_MAX} remembered things for this reader. Tell them ` +
          `the list is full, offer to show it, and ask which one to forget before adding this.`,
      };
    }

    return propose(ctx, {
      kind: "rememberThis",
      summary: "Remember something about how the reader likes things explained",
      fields: [{ label: "Would remember", value: text }],
      args: { text },
    });
  },
};

// ── listMemories ──────────────────────────────────────────────────────────────────────────────────
const LIST_DESCRIPTION =
  "CALL THIS whenever the reader asks what you remember or know about them: \"what do you remember about " +
  "me?\", \"what do you know about me?\", \"kya yaad hai tumhe?\". Answer from THIS tool, never from the " +
  "conversation. " +
  "It lists everything currently remembered about this reader — both the things they explicitly asked you to " +
  "remember and the things that were worked out from how they write. Call this when the reader asks what " +
  "you remember or know about them, or before forgetting something so you can name the options. " +
  "★ EACH ENTRY SAYS WHETHER IT WAS STATED OR INFERRED, and you must preserve that distinction when you " +
  "relay it: a reader seeing something they never said has a right to know it was worked out rather than " +
  "told. Do not present an inference as something they told you. Reads only — changes nothing.";

export const listMemoriesTool: ChatTool<Record<string, never>> = {
  name: "listMemories",
  klass: "read",
  description: LIST_DESCRIPTION,
  parameters: { type: "object", properties: {} },
  async handler(_args, ctx: ToolContext): Promise<ToolResult> {
    const entries = await listMemories(ctx.userId);
    if (!entries.length) {
      return {
        ok: true,
        content:
          "Nothing is remembered about this reader yet — neither anything they asked you to keep in mind, " +
          "nor anything worked out from how they write. Tell them they can ask you to remember something.",
      };
    }
    const stated = entries.filter((e) => e.source === "stated");
    const inferred = entries.filter((e) => e.source === "inferred");
    const lines = [
      `${entries.length} thing(s) remembered about this reader.`,
      "",
      stated.length ? "THINGS THEY ASKED YOU TO REMEMBER (they said these):" : "They have not asked you to remember anything yet.",
      ...stated.map((e) => `- [${e.id}] ${e.text}`),
    ];
    if (inferred.length) {
      lines.push("", "THINGS WORKED OUT FROM HOW THEY WRITE (they did NOT say these — say so if you relay them):");
      lines.push(...inferred.map((e) => `- [${e.id}] ${e.text}`));
    }
    lines.push("", `Cap: ${MEMORY_MAX} stated memories; ${stated.length} used.`);
    return { ok: true, content: lines.join("\n") };
  },
};

// ── forgetMemory ──────────────────────────────────────────────────────────────────────────────────
const FORGET_DESCRIPTION =
  "CALL THIS whenever the reader asks you to forget something: \"forget that…\", \"forget the one about…\", " +
  "\"stop remembering…\", \"delete that memory\", \"bhool jao…\". " +
  "It forgets ONE thing currently remembered about the reader. Pass their own words for it — \"the one about " +
  "explanations\", \"that I prefer Hinglish\" — or an id from listMemories. Executes immediately: the reader " +
  "has just named it, so no confirmation is needed. " +
  "⚠ IF THIS COMES BACK ASKING WHICH ONE, ASK THE READER — do not pick for them. Deleting the wrong " +
  "memory cannot be undone and they may not notice. Works on both stated and inferred entries.";

interface ForgetArgs { reference?: unknown }

export const forgetMemoryTool: ChatTool<ForgetArgs> = {
  name: "forgetMemory",
  klass: "action",
  description: FORGET_DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      reference: {
        type: "string",
        description: "The reader's own description of the memory to remove, or an id from listMemories.",
      },
    },
    required: ["reference"],
  },
  async handler(args, ctx: ToolContext): Promise<ToolResult> {
    const reference = str(args.reference);
    if (!reference) return { ok: false, error: "Which one should be forgotten? Ask the reader to name it." };

    const entries = await listMemories(ctx.userId);
    if (!entries.length) return { ok: true, content: "There is nothing remembered about this reader, so there is nothing to forget." };

    const res = resolveMemoryReference(reference, entries);
    if (res.status === "none") {
      return {
        ok: true,
        content:
          `Nothing remembered matches "${reference}". Here is everything currently held — ask the reader ` +
          `which one they mean:\n${(res.all ?? []).map((e) => `- [${e.id}] ${e.text} (${e.source})`).join("\n")}`,
      };
    }
    if (res.status === "ambiguous") {
      // ★ THE POINT OF THE WHOLE RESOLUTION DESIGN. Two equally good matches is not a coin flip.
      return {
        ok: true,
        content:
          `"${reference}" matches more than one thing, so nothing has been forgotten. ASK THE READER WHICH ` +
          `ONE THEY MEAN — do not choose:\n${(res.candidates ?? []).map((e) => `- [${e.id}] ${e.text} (${e.source})`).join("\n")}`,
      };
    }

    try {
      const out = await forgetMemoryById(res.match!.id, ctx.userId);
      ctx.effects.add("profile");
      return {
        ok: true,
        content:
          `Forgotten: "${out.forgotten.text}" (${out.forgotten.source}). ${out.remaining} thing(s) still ` +
          `remembered. Tell the reader plainly what was forgotten.`,
      };
    } catch (e) {
      return { ok: false, error: serviceMessage(e) };
    }
  },
};
