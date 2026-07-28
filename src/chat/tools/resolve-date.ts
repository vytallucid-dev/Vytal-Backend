// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: resolveDate — the ONLY way a phrase becomes a date.
//
// ★ WHY A TOOL AND NOT AN INSTRUCTION. `recordTransaction`'s description already said "do not turn a
// vague phrase into a date". The live model did it anyway, twice, producing 2025-02-26 and then
// 2025-02-25 for the same sentence — both about seventeen months off. The reason is not disobedience:
// a model does not reliably know today's date, so every relative phrase is arithmetic it cannot do.
// Asking it more firmly does not give it a calendar. This does.
//
// The whole computation is server-side and deterministic (date-resolve.ts), anchored on the reader's
// LOCAL day in India. The model's only job is to hand over the words the reader used.
//
// ── THE REFUSAL IS A FEATURE, AND IT IS BOUNDED ────────────────────────────────────────────────────
// "last week" names seven days. There is no correct answer, so there is no answer — but the refusal
// carries the span, because "last week was Mon 13 – Sun 19 July; which day?" is a question a reader
// answers from memory, while "what date?" is one they have to go and work out. A guard people can
// answer is a guard they don't route around.
//
// A refusal is `ok:false` rather than an honest-empty `ok:true`. That is deliberate and it is the one
// place this tool departs from the boundary convention in types.ts: the model must take corrective
// action (ask the reader), and the live run showed it reliably does exactly that when handed an error.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { resolvePhrase, istToday, pretty, boundsPhrase } from "../date-resolve.js";
import type { ChatTool, ToolResult } from "./types.js";

interface Args {
  phrase?: unknown;
}

const DESCRIPTION =
  "Turn what the reader SAID about a date into an exact calendar date. ★ THIS IS THE ONLY WAY TO GET A " +
  "DATE. You do not reliably know today's date, so any date you work out yourself is a guess — and a " +
  "guessed trade date silently corrupts the reader's cost basis. Never convert a phrase into a date " +
  "yourself: pass the reader's own words here and use what comes back. " +
  "Handles exact dates in any common form (2026-07-20, 20/07/2026 — read day-first, Indian convention — " +
  "20 July 2026, July 20 2026), a day and month with no year (resolved to the most recent one that has " +
  "already passed, and it tells you which year it assumed), and unambiguous relative phrases: today, " +
  "yesterday, day before yesterday, 3 days ago, a week ago, a fortnight ago, 2 months ago, last Tuesday, " +
  "this Friday, Tuesday, last to last Monday, last month on the 12th, the 12th. " +
  "It REFUSES phrases that cover a span of days — \"last week\", \"a few days back\", \"recently\", " +
  "\"earlier this month\", \"sometime in March\" — because no single day follows from them. A refusal " +
  "usually names the span it covers: relay that to the reader and ask which day they mean, e.g. \"last " +
  "week was Monday the 13th to Sunday the 19th — which day was it?\". That is far easier for them to " +
  "answer than a bare \"what date?\". Also refuses future dates. " +
  "Call this BEFORE recordTransaction whenever the reader described a date in words rather than giving " +
  "an exact one.";

const PARAMETERS = {
  type: "object",
  properties: {
    phrase: {
      type: "string",
      description:
        'The reader\'s own words for the date, copied as they said them — "last Tuesday", "20 July", ' +
        '"3 days ago", "12/03/2025". Do not pre-process or reinterpret it.',
    },
  },
  required: ["phrase"],
  additionalProperties: false,
} as const;

export const resolveDateTool: ChatTool<Args> = {
  name: "resolveDate",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const phrase = typeof args.phrase === "string" ? args.phrase.trim() : "";
    if (!phrase) return { ok: false, error: "resolveDate requires a non-empty 'phrase' — the reader's own words for the date." };

    const today = istToday();
    const r = resolvePhrase(phrase);

    if (!r.ok) {
      const bounded = r.bounds
        ? ` It covers ${boundsPhrase(r.bounds)}. Tell the reader that span and ask which day they mean — a bounded question is much easier for them to answer than "what date?".`
        : " Ask the reader for the exact day.";
      return {
        ok: false,
        error:
          `NO SINGLE DATE: ${r.reason}${bounded} Today is ${pretty(today)} (India). ` +
          `Do NOT pick a day yourself and do NOT proceed to record anything until they give you one.`,
      };
    }

    // ★ REMEMBER IT FOR THIS TURN. recordTransaction will only accept a tradeDate that either appears in
    //   the reader's own message or came out of this call — see write-shared.ts attestTradeDate().
    ctx.resolvedDates.add(r.date);

    const L = [
      "=== DATE RESOLVED ===",
      `Phrase: "${phrase}"`,
      `Resolved date: ${r.date}   (${pretty(r.date)})`,
      `How long ago: ${r.ago}`,
      `Today in India: ${pretty(today)}`,
    ];
    if (r.assumption) {
      L.push(
        `⚠ ASSUMPTION MADE: ${r.assumption}`,
        "Say this assumption out loud to the reader when you use this date, so they can correct it if it is wrong.",
      );
    }
    L.push(`Use exactly "${r.date}" as the date. Do not adjust it.`);
    return { ok: true, content: L.join("\n") };
  },
};
