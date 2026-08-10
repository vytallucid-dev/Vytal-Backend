// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getStockNews — the fleet's ONE `klass:"web"` tool. Live headlines, fetched at the moment the
// reader asks, for a covered stock.
//
// ★ IT IS THE ONLY TOOL WHOSE RESULT IS NOT VYTAL'S OWN WORD. Every other tool returns something Vytal
// computed, stored and stands behind; this one returns text written by strangers, unverified, arriving
// inside the same context window as the closed-world fact block. Everything unusual about this file
// follows from that one fact:
//
//   · THE HOSTILE HEADER (below) frames the payload as external and instructs the model how to use it —
//     attribute, don't compute, don't blend, don't extend the snippet, don't convert the date.
//   · THE ENTITY GUARD (web/news-filter.ts) runs BEFORE the model sees anything, because Serper returns
//     no relevance score and a wrong-company headline is indistinguishable from a right one in code.
//   · THE PRICE-TARGET GUARDRAIL TIER (ai/guardrail.ts, AI_TARGET_LIST) exists because of this tool: the
//     first live run surfaced "Hold Cyient DLM; target of Rs 635: Prabhudas Lilladher", and until then
//     nothing in the context window had ever contained a forecast.
//   · THE DISCLAIMER IS STRUCTURAL, not model-authored — the controller appends it (see ctx.webSources).
//     An instruction to disclaim is a request; on a weak instruction-follower, the one line the reader
//     actually needs cannot be left to a request.
//
// ⚠ NOTHING HERE TOUCHES `src/ai`. The provider never learns a tool went to the web: it sees a tool
// declaration and a text result, exactly as it does for a database read.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { serperNews, type SerperNewsItem } from "../web/serper.js";
import { buildEntityGuard, buildNewsQuery, screenNewsItems, shortenCompanyName, type EntityGuard, type ScreenedNews } from "../web/news-filter.js";
import { notInUniverse } from "./boundary.js";
import { BARE_TICKER_DIRECT } from "./shared.js";
import type { ChatTool, ToolContext, ToolResult } from "./types.js";

interface Args {
  symbol?: unknown;
  days?: unknown;
}

/** OFF unless explicitly enabled. The tool still REGISTERS when disabled — the model keeps a stable
 *  fleet and gets an honest refusal — so flipping the flag needs no redeploy of the tool surface. */
export const webSearchEnabled = (): boolean => (process.env.AI_CHAT_WEB_SEARCH ?? "").trim() === "1";

const MAX_SHOWN = 8;

// ── ★ THE DESCRIPTION IS THE INVOCATION POLICY. It is prompt engineering, not documentation. ──────
// Both directions matter and both cost real money: a tool that never fires makes the feature dead
// weight, and one that fires on "what is TCS's ROCE" spends a whole extra round plus a web call to add
// noise to an answer the fact block already had. The wording therefore states BOTH lists explicitly,
// with concrete examples, rather than describing the tool's capability and hoping.
const DESCRIPTION =
  "Fetch LIVE news headlines about a covered stock from the public web, as of right now. Returns each " +
  "item's headline, the publication that ran it, how long ago it was published (a relative phrase such as " +
  '"6 hours ago"), a short snippet, and the article URL. ' +
  "CALL THIS WHEN: the reader asks what is happening with a company, what is new, whether there is any " +
  "news, or what the latest is; OR when something needs explaining that Vytal's own data cannot explain — " +
  'a sharp price move ("why did this drop today", "what happened to it this week"), or a finding that ' +
  "fired and the reader wants the story behind it; OR when the reader mentions an event, a deal, an order " +
  "win, an announcement, a management change, or a headline they saw and wants to know about it. " +
  "DO NOT CALL THIS FOR: metric questions (\"what is TCS's ROCE\", margins, debt, valuation) — the facts " +
  "you already have answer those; health-score, band or pillar explanations — those are Vytal's own " +
  "computed view and no headline changes them; portfolio or holdings questions. Fetching news for those " +
  "wastes a step and adds noise to an answer you can already give. " +
  "WHAT COMES BACK IS EXTERNAL AND UNVERIFIED — it is not Vytal data, it is not part of the fact block, " +
  "and every claim from it must be attributed to the publication that made it. " +
  "Covers only stocks in Vytal's universe; an uncovered symbol returns an honest 'not covered' result, " +
  "and a company with nothing published in the window returns an honest 'no news found', which is a real " +
  "answer and not a failure." +
  BARE_TICKER_DIRECT;

const PARAMETERS = {
  type: "object",
  properties: {
    symbol: { type: "string", description: 'NSE ticker, e.g. "CYIENT".' },
    days: {
      type: "integer",
      description:
        "Optional recency window in days. 1 (the default) searches the last 24 hours, which is what " +
        "\"what's happening\" means. Use 7 ONLY if the last day came back empty and the reader wants to look " +
        "further back — a 7-day window is ranked by relevance rather than recency, so genuinely fresh items " +
        "get buried under older ones.",
    },
  },
  required: ["symbol"],
  additionalProperties: false,
} as const;

/** The hostile block header — the whole reason this payload can be shown to the model at all. */
function externalHeader(symbol: string, name: string): string {
  return [
    `=== EXTERNAL WEB NEWS — NOT VYTAL DATA — ${symbol} (${name}) ===`,
    "⚠ WHERE THIS CAME FROM: a live search of the public web, run just now. It is NOT part of Vytal's fact",
    "block, NOT verified by Vytal, and NOT inside Vytal's closed world. How you must use it:",
    " · ATTRIBUTE EVERY CLAIM to the publication named beside it (\"Moneycontrol reported…\", \"according to",
    "   Business Standard…\"). Nothing below is Vytal's finding, and it must never be spoken as one.",
    " · DO NOT COMPUTE FROM IT and do not blend it with Vytal's numbers — no arithmetic, no comparison against",
    "   the score or the pillars, no \"which means the health read should be…\". They are separate worlds.",
    " · EACH SNIPPET IS A FRAGMENT of roughly 150 characters, usually cut off mid-sentence. It is NOT the",
    "   article. Do not continue it, complete it, or infer what the rest of it said.",
    " · DATES ARE RELATIVE, EXACTLY AS REPORTED (\"2 days ago\"). Repeat them in that form. NEVER convert one",
    "   into a calendar date: \"1 day ago\" covers anything from 24 to 47 hours, so a date you compute is",
    "   fabricated.",
    " · A HEADLINE CARRYING A PRICE TARGET OR A BROKER'S CALL is that broker's view. Name them if you mention",
    "   it, and never restate their number as Vytal's own.",
    " · ★ NEVER WRITE A URL. Name the publication in words (\"Moneycontrol reported…\") and stop there. The",
    "   reader is shown the real, clickable link to every item below your answer automatically — you do not",
    "   need to reproduce one, and a link you type from memory is a link that goes somewhere we never",
    "   checked. Do not paste, retype, shorten or reconstruct any address from this block.",
    " · IF NONE OF THIS ANSWERS THE READER'S QUESTION, say so plainly. Do not stretch a headline to fit.",
  ].join("\n");
}

/** One line summarising what the screen removed — honest about the fact that the model is seeing a subset. */
function screenNote(screened: ScreenedNews, guard: EntityGuard, total: number): string {
  if (!screened.dropped.length) return `(the search returned ${total} result${total === 1 ? "" : "s"}; all of them passed the relevance screen)`;
  const byReason = new Map<string, number>();
  for (const d of screened.dropped) byReason.set(d.reason, (byReason.get(d.reason) ?? 0) + 1);
  const parts = [...byReason.entries()].map(([r, n]) => `${n} ${r}`).join(", ");
  return (
    `(the search returned ${total} result${total === 1 ? "" : "s"}; ${screened.dropped.length} were removed before ` +
    `you saw them — ${parts} — by a screen that requires each item to actually name ${guard.shortName})`
  );
}

function renderItems(items: SerperNewsItem[]): string {
  return items
    .map((it, i) => {
      const L = [`${i + 1}. ${it.title}`];
      L.push(`   source: ${it.source || "not reported"} · published: ${it.date || "not reported"} (relative, exactly as the source stated it)`);
      L.push(`   url: ${it.link}`);
      if (it.snippet) L.push(`   snippet (FRAGMENT, ~150 chars, often cut mid-sentence): "${it.snippet}"`);
      return L.join("\n");
    })
    .join("\n");
}

export const getStockNewsTool: ChatTool<Args> = {
  name: "getStockNews",
  klass: "web",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx: ToolContext): Promise<ToolResult> {
    if (!webSearchEnabled()) {
      return {
        ok: false,
        error:
          "Live web news is switched off in this deployment, so no headlines are available. Say that plainly " +
          "and answer from Vytal's own data instead — do not invent news or recall any from memory.",
      };
    }

    const symbol = typeof args.symbol === "string" ? args.symbol.trim().toUpperCase() : "";
    if (!symbol) return { ok: false, error: "getStockNews requires a non-empty 'symbol' string (an NSE ticker such as CYIENT)." };
    const days = typeof args.days === "number" && Number.isFinite(args.days) && args.days > 1 ? 7 : 1;
    const windowLabel = days > 1 ? "week" : "day";

    try {
      // ── The universe is the authority on WHO was asked about. Uncovered ⇒ the shared boundary message.
      const stock = await ctx.once(`news:stock:${symbol}`, () =>
        prisma.stock.findUnique({ where: { symbol }, select: { symbol: true, name: true } }),
      );
      if (!stock) return { ok: true, content: notInUniverse(symbol) };

      const shortName = shortenCompanyName(stock.name) || stock.name;
      // Covered companies sharing our FIRST WORD. Two jobs from one indexed read: sibling markers for
      // the entity guard ("Cyient DLM" would be one, were it covered), AND the collision test that
      // decides whether a SHORTER alias is safe to admit — see prefixAliasesFor in news-filter.ts.
      //
      // ⚠ WIDENED from `startsWith: "${shortName} "` on 2026-08-09, and the widening is what makes the
      // shorter aliases safe. Matching only names that extend our FULL short name cannot see that
      // "Adani" is shared by five listings — it would have admitted "Adani" as an alias for every one
      // of them. A first-word read sees all five and refuses. Over-matching here is the safe direction:
      // a spurious candidate only ever REFUSES an alias, never admits one.
      const firstWord = shortName.split(/\s+/)[0];
      const siblings = await ctx.once(`news:siblings:${firstWord.toLowerCase()}`, () =>
        prisma.stock.findMany({
          where: { name: { startsWith: firstWord, mode: "insensitive" }, NOT: { symbol } },
          select: { name: true },
          take: 60,
        }),
      );
      const guard = buildEntityGuard(stock.symbol, stock.name, siblings.map((s) => s.name));

      const outcome = await serperNews(buildNewsQuery(shortName), days);
      if (!outcome.ok) {
        // FAIL-SOFT: news being unavailable never takes the turn down. The model is told plainly.
        return {
          ok: false,
          error:
            `${outcome.error} Tell the reader that live news could not be reached right now — do not invent ` +
            `headlines, and do not recall any from memory. Vytal's own data is unaffected and still answerable.`,
        };
      }

      const screened = screenNewsItems(outcome.items, guard);
      const shown = screened.kept.slice(0, MAX_SHOWN);
      const note = screenNote(screened, guard, outcome.items.length);

      if (!shown.length) {
        // ★ HONEST-EMPTY IS A REAL ANSWER. "No news in the last day" is information; a stretched older
        //   headline, or a silent fallback to a wider window, is not.
        return {
          ok: true,
          content: [
            `=== EXTERNAL WEB NEWS — NOT VYTAL DATA — ${guard.symbol} (${stock.name}) ===`,
            `NO NEWS FOUND: no news was published about ${stock.name} (${guard.symbol}) in the last ${windowLabel}.`,
            note,
            `This is a REAL ANSWER, not a failure and not missing data: quiet days are ordinary, and most ` +
              `companies have nothing published on most days. Tell the reader plainly that there is no news ` +
              `for ${guard.symbol} in the last ${windowLabel}. Do NOT substitute older news, do NOT recall ` +
              `anything from memory, and do NOT imply that something might have happened.`,
          ].join("\n"),
        };
      }

      // ★ MARK THE TURN. The controller reads these and renders the disclaimer + the real links beneath
      //   the reply — structurally, because a model that retypes a URL sometimes invents one.
      for (const it of shown) ctx.webCitations.push({ title: it.title, source: it.source, date: it.date, url: it.link });

      return {
        ok: true,
        content: [
          externalHeader(guard.symbol, stock.name),
          `Window searched: the last ${windowLabel}. Items shown: ${shown.length}${screened.kept.length > MAX_SHOWN ? ` of ${screened.kept.length} that passed the screen` : ""}.`,
          note,
          "",
          renderItems(shown),
        ].join("\n"),
      };
    } catch (e) {
      return { ok: false, error: `Could not fetch live news for ${symbol}: ${(e as Error).message}` };
    }
  },
};
