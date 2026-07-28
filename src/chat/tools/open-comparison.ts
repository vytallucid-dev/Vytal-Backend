// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: openComparison — the fleet's ONE `klass:"action"` tool. It does not act on anything.
//
// ★ THE REFRAME THAT MADE THIS WORTH BUILDING. The obvious version of this tool "opens the comparison
// page", and that version is worthless: a reader can click "Comparison" in the sidebar without asking
// anyone. Navigation was never the value.
//
// The value is the VERDICT. Whether two companies can honestly be read side by side is a question the
// model cannot answer on its own — it depends on their industry FAMILY (a bank's NIM against a
// manufacturer's ROCE is not a comparison, it is a category error) and on whether they share a peer
// group (ranks are relative to different member sets otherwise). `buildComparisonView` already decides
// all of that and authors the warnings. So this tool is a FACT LOOKUP THAT ENDS IN A LINK: it validates
// the pair against the universe, hands back the comparability verdict, and offers the page.
//
// ── THE LINK IS BUILT BY THE SERVER, FROM UNIVERSE ROWS ───────────────────────────────────────────
// The lesson is inherited from getStockNews, where the live model invented a URL that appeared in no
// tool result. An in-app path looks like a softer case — it is deterministic from two symbols, and the
// route degrades gracefully on a bad slug — but the realistic failure is worse than a broken link:
// the model writes company names where tickers belong, `/comparison/TCS-vs-INFOSYS` parses as a
// perfectly well-formed slug, sails past the route's malformed-slug branch, and dies at the API with
// "one or both may not be in the universe". A dead end AFTER a click, on a page that looked right.
//
// So the path is assembled from `view.a.symbol` / `view.b.symbol` — the canonical symbols on the rows
// the universe returned, not the strings the model sent — and handed to the controller through
// `ctx.appLinks` (the same structural seam as `ctx.webCitations`). The model is told, in the result,
// not to write the path at all. See chat/voice.ts for the rendering and the ordering rule.
//
// ⚠ STOCK-vs-STOCK ONLY. The peer-group comparison route (/comparison/pg/{idA}-vs-{idB}) takes UUIDs,
// which a conversation has no honest way to produce, and the description says so explicitly.
//   ↳ NOTE, since chat/links.ts: "the model cannot produce a UUID" is still true, but it no longer means
//     a pond is unreachable. The `{{link:peer-group:TICKER}}` placeholder names a TICKER and the SERVER
//     walks stock → membership → peerGroup.id, so the single-pond page IS linkable now. The pair route
//     stays out: it would need TWO ponds and there is no honest way for a reader to have named both.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { comparisonPath } from "../links.js";
import { buildComparisonView } from "../../scoring/read/compare-view.service.js";
import type { ComparisonView } from "../../scoring/read/compare-view.types.js";
import { notInUniverse } from "./boundary.js";
import { BARE_TICKER_DIRECT } from "./shared.js";
import type { ChatTool, ToolContext, ToolResult } from "./types.js";

interface Args {
  symbolA?: unknown;
  symbolB?: unknown;
}

/** The in-app comparison path. ★ MOVED to chat/links.ts — there is now ONE home for building a Vytal
 *  path, shared with the `{{link:…}}` placeholder resolver, and it percent-encodes each symbol segment
 *  (M&M → M%26M) so no markdown parser can reinterpret an "&" run as a character reference. Re-exported
 *  here because this tool is where the rule was first written down and callers already import it from
 *  this module. Symbols still come from universe rows, never from the model's arguments. */
export { comparisonPath };

const DESCRIPTION =
  "Check whether two covered stocks can honestly be compared side by side, and offer the reader Vytal's " +
  "comparison page for them. Call this when the reader asks to compare two companies, asks how one stacks " +
  "up against another, or asks which of two is healthier or stronger. " +
  "★ WHAT IT ACTUALLY GIVES YOU IS THE COMPARABILITY VERDICT, and that is the substance of your answer — " +
  "not the link. It tells you whether the two sit in the SAME industry family (so their family-specific " +
  "metrics line up directly) or in DIFFERENT families (where only the universal measures — health score, " +
  "pillars, returns, ownership — line up, and family-specific metrics must not be read against each " +
  "other), whether their peer-group ranks can be read against one another, and any comparability " +
  "warnings. Say that verdict BEFORE offering the link: a reader about to compare a bank with a " +
  "manufacturer needs to know which half of the page is directly comparable. " +
  "⚠ THIS DOES NOT NAVIGATE ANYWHERE AND OPENS NOTHING. You are OFFERING a link; the reader clicks it or " +
  "does not. Never say you have opened, loaded, pulled up, or shown the comparison, and never describe " +
  "what is on the page as though you had read it. The link is placed beneath your answer automatically — " +
  "do NOT write the path or any URL yourself. " +
  "STOCK vs STOCK ONLY: it cannot compare peer groups, sectors, mutual funds, or a stock against an " +
  "index. It needs two DIFFERENT exact NSE tickers; the same ticker twice is refused." +
  BARE_TICKER_DIRECT;

const PARAMETERS = {
  type: "object",
  properties: {
    symbolA: { type: "string", description: 'NSE ticker of the first stock, e.g. "TCS".' },
    symbolB: { type: "string", description: 'NSE ticker of the second stock, e.g. "INFY". Must differ from symbolA.' },
  },
  required: ["symbolA", "symbolB"],
  additionalProperties: false,
} as const;

/** The peer-standing line — three genuinely different states, none of them collapsed into "no". */
function peerStandingLine(v: ComparisonView): string {
  const { a, b } = v;
  if (v.peerStandingComparable) {
    const pg = a.peerStanding?.peerGroupName ?? a.peerStanding?.peerGroupId ?? "the same peer group";
    return (
      `Peer-group standing: COMPARABLE — both sit in the same peer group (${pg}), so their within-group ` +
      `ranks are measured against the same member set and can be read against each other.`
    );
  }
  if (a.peerStanding && b.peerStanding) {
    const pgA = a.peerStanding.peerGroupName ?? a.peerStanding.peerGroupId;
    const pgB = b.peerStanding.peerGroupName ?? b.peerStanding.peerGroupId;
    return (
      `Peer-group standing: NOT COMPARABLE — different peer groups (${a.symbol}: ${pgA} · ${b.symbol}: ${pgB}). ` +
      `Each rank is relative to its own group, so the two ranks do not line up.`
    );
  }
  const missing = [!a.peerStanding ? a.symbol : null, !b.peerStanding ? b.symbol : null].filter(Boolean).join(" and ");
  return `Peer-group standing: NOT COMPARABLE — no within-peer-group standing is on file for ${missing}.`;
}

function render(v: ComparisonView, path: string): string {
  const L: string[] = [`=== VYTAL COMPARISON CHECK: ${v.a.symbol} vs ${v.b.symbol} ===`];
  L.push(`Both symbols are in Vytal's covered universe, so this pair can be put side by side.`);
  L.push(`A: ${v.a.symbol} — ${v.a.name} · family ${v.a.familyLabel}`);
  L.push(`B: ${v.b.symbol} — ${v.b.name} · family ${v.b.familyLabel}`);

  L.push(
    v.comparability === "same_family"
      ? `Comparability: SAME FAMILY — both are ${v.a.familyLabel} companies, so the family-specific metrics line up directly alongside the universal ones.`
      : `Comparability: CROSS FAMILY — ${v.a.familyLabel} vs ${v.b.familyLabel}. ONLY the universal measures line up directly. Family-specific metrics are shown separately on the page and must NOT be read against each other.`,
  );
  L.push(peerStandingLine(v));

  if (v.warnings.length) {
    L.push(`Comparability warnings (${v.warnings.length}) — state these to the reader before they open the page:`);
    for (const w of v.warnings) L.push(`  · ${w}`);
  } else {
    L.push("Comparability warnings: none — nothing about this pair limits the side-by-side.");
  }

  if (v.classContext) L.push(`Sector-class context: ${v.classContext.note}`);

  // Free from the view, and genuinely worth knowing before a click: an unscored side means the health
  // axis of that page renders honest-empty.
  const unscored = [!v.a.scored ? v.a.symbol : null, !v.b.scored ? v.b.symbol : null].filter(Boolean);
  if (unscored.length) {
    L.push(
      `⚠ Not yet scored: ${unscored.join(" and ")} — covered by Vytal but with no computed health score, so ` +
        `the health part of the comparison will be empty for that side. Say so before offering the page.`,
    );
  }

  L.push(
    `THE LINK: a link to this comparison is placed beneath your answer AUTOMATICALLY, already built and ` +
      `checked (${path}). Do NOT write that path, or any other link, yourself. OFFER it in words — the ` +
      `reader will see the link and can click it. You have NOT opened anything and you have NOT seen the ` +
      `page, so do not describe what is on it beyond the verdict above.`,
  );
  return L.join("\n");
}

export const openComparisonTool: ChatTool<Args> = {
  name: "openComparison",
  klass: "action",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx: ToolContext): Promise<ToolResult> {
    const a = typeof args.symbolA === "string" ? args.symbolA.trim().toUpperCase() : "";
    const b = typeof args.symbolB === "string" ? args.symbolB.trim().toUpperCase() : "";
    if (!a || !b) {
      return { ok: false, error: "openComparison requires two non-empty 'symbolA' and 'symbolB' strings (NSE tickers such as TCS and INFY)." };
    }
    // ★ REFUSED, NOT SILENTLY FIXED. The route's malformed-slug branch would catch a self-pair, but a
    //   tool that quietly builds a link it knows is broken is worse than one that says so. `ok:false`
    //   because the model must take corrective action — ask which second company — exactly as with
    //   resolveDate's refusals.
    if (a === b) {
      return {
        ok: false,
        error:
          `openComparison needs TWO DIFFERENT stocks and was given ${a} twice — a company cannot be compared ` +
          `with itself. Ask the reader which second company they want it set against, and do not offer any ` +
          `comparison until they name one.`,
      };
    }

    try {
      // ── The universe boundary FIRST, per symbol. buildComparisonView returns null for either side
      //    missing, which cannot say WHICH — and it costs 8 reads to find out. Two indexed lookups name
      //    the right symbol and skip the heavy read entirely when the answer is "not covered".
      const [rowA, rowB] = await Promise.all([
        ctx.once(`stock:${a}`, () => prisma.stock.findUnique({ where: { symbol: a }, select: { symbol: true } })),
        ctx.once(`stock:${b}`, () => prisma.stock.findUnique({ where: { symbol: b }, select: { symbol: true } })),
      ]);
      if (!rowA) return { ok: true, content: notInUniverse(a) };
      if (!rowB) return { ok: true, content: notInUniverse(b) };

      const view = await ctx.once(`compare:${a}:${b}`, () => buildComparisonView(a, b));
      if (!view) {
        // Both are in the universe, but the comparison service found no fundamentals for one of them —
        // a real, honest state that is NOT the coverage boundary.
        return {
          ok: true,
          content:
            `COMPARISON NOT AVAILABLE: ${a} and ${b} are both covered by Vytal, but there is no financial ` +
            `statement data on file for at least one of them, so a side-by-side cannot be built. Say that ` +
            `plainly, do not offer a comparison link, and do not guess which of the two is missing.`,
        };
      }

      // ★ THE PATH IS BUILT FROM THE UNIVERSE'S OWN SYMBOLS, not the model's arguments.
      const path = comparisonPath(view.a.symbol, view.b.symbol);
      ctx.appLinks.push({ label: `Compare ${view.a.symbol} and ${view.b.symbol} side by side`, path });

      return { ok: true, content: render(view, path) };
    } catch (e) {
      return { ok: false, error: `Could not check the comparison for ${a} vs ${b}: ${(e as Error).message}` };
    }
  },
};
