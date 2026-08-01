// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getUniverseScan — the FIRST tool that answers about MANY companies at once.
//
// Every other read tool in the fleet takes a ticker and answers about one company. This one takes a
// QUESTION and answers about the whole scored set: how many, how they are spread, what is firing,
// who moved. It is the Health Hub, reachable in conversation.
//
// ── 3a · ONE TOOL WITH A SLICE ENUM, NOT SEVEN TOOLS ───────────────────────────────────────────────
// Measured: the enum form costs ~380–450 tokens of definition; seven separate tools cost ~1,400–1,750,
// on EVERY message, forever. Seven tools would also give the model seven chances to pick the wrong one
// — and the seven questions share a period contract, a cap discipline and a boundary, all of which
// would have to be repeated seven times or (worse) drift apart.
//
// ── 3b · THE DESCRIPTION OPENS ON TRIGGERS, NOT ON WHAT THE TOOL IS ────────────────────────────────
// Flash-Lite keys hard on how a description STARTS. The registry's own header records the cost of
// getting this wrong twice: searchStocks fired on bare tickers for a whole build because its
// instruction was a plainly-worded negative buried mid-paragraph. So the phrasings a reader actually
// uses come first, the mechanics after, the boundary last.
//
// ── 3c · THE PERIOD FRAMING IS IN THE DESCRIPTION, NOT ONLY IN THE RESULT ──────────────────────────
// The result carries it too (chat/universe-brief.ts). It is in BOTH because they act at different
// moments: the description shapes the sentence the model is already planning as it decides to call;
// the result corrects one already planned. §THE PAGES made the model confident about Vytal, which
// makes a confident FALSE scope claim — "as of FY27Q1, 21 companies are Pristine", false for 30 of
// them — more likely, not less.
//
// ── THE BOUNDARY IS THE POINT OF THE LAST PARAGRAPH ────────────────────────────────────────────────
// This tool covers seven questions. The failure it must not have is the ORIGINAL one §THE PAGES was
// built against: inventing a product limitation to explain its own reach ("Vytal doesn't do numeric
// screens because…"). So the description says what it cannot do AND forbids explaining why.
//
// ═══ 4b · ★ SECURITY — THE USER IS NEVER A PARAMETER, AND `scope` DOES NOT MAKE IT ONE ═════════════
// The schema has NO userId, no owner, no account field, and never will. `scope` is a THREE-VALUE ENUM
// — "universe" | "portfolio" | "watchlist" — and the two personal values are resolved against
// ctx.userId (from req.authUser, set by requireAuth on /api/v1/me), exactly as getPortfolioFacts and
// getWatchlist do with zero parameters. A model cannot name a user, so it cannot reach another user's
// book: IDOR is structurally impossible, and adding `scope` must not weaken that.
//
// It does not, because `scope` never carries identity — only WHICH of the caller's OWN lists to
// intersect with. Anything that is not exactly one of the three literals is refused before any read
// happens (`SCOPE_SET`), so a crafted value cannot smuggle a second meaning: "portfolio:other-user",
// "universe' OR 1=1", an object, an array — none of them reach a query, they reach an error message.
// The public universe route stays unauthenticated and stays UNSCOPED; the scoped path exists only
// here, behind requireAuth. Asserted adversarially in verify-universe-scan-tool.ts §4.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { getUniverseHealthView } from "../../scoring/read/universe-view.cache.js";
import { projectUniverse } from "../../scoring/read/universe-projection.service.js";
import {
  UNIVERSE_SCOPES,
  UNIVERSE_SLICES,
  type UniverseScopeId,
  type UniverseSliceId,
} from "../../scoring/read/universe-projection.types.js";
import { renderUniverseSlice } from "../universe-brief.js";
import type { ChatTool, ToolContext, ToolResult } from "./types.js";

interface GetUniverseScanArgs {
  slice?: unknown;
  band?: unknown;
  finding?: unknown;
  scope?: unknown;
}

const DESCRIPTION =
  "Answer a question about MANY companies at once — how many stocks Vytal scores, how many sit in each " +
  "health band, which companies are firing a named red flag or pattern, everything firing across the " +
  "market right now, which improved or slipped most, and what changed in the last seven days. Call it " +
  "for \"how many stocks…\", \"which stocks…\", \"across the market\", \"what's firing\", \"who improved\" " +
  "— any question whose answer is a COUNT or a LIST of companies rather than one company's numbers. " +
  "For one company call getStockFacts instead; this never returns a single company's pillars or metrics. " +
  "★ It gives counts and company NAMES, never a per-company verdict — for what Vytal actually SAYS about " +
  "companies you can already name, call getFindingsForSymbols with their tickers. " +
  "★ HOW TO SAY THE DATE: each company is read at ITS OWN most recent reported quarter, and those " +
  "quarters differ across companies — say \"each at its most recent reported quarter\" and NEVER name a " +
  "single quarter as though it covered them all. " +
  "It answers exactly the questions in `slice` and nothing else. It cannot filter by a number the reader " +
  "chooses — for \"return on equity above 20%\", \"debt to equity under 1\", a sector cutoff or any " +
  "combination of thresholds, call screenStocks instead. Neither tool has a price, market-cap or " +
  "valuation screen: asked for one, say plainly that Vytal has no such screen; do NOT answer it from your " +
  "own knowledge, do NOT invent a list, and do NOT explain why it is missing.";

const PARAMETERS = {
  type: "object",
  properties: {
    slice: {
      type: "string",
      enum: UNIVERSE_SLICES as unknown as string[],
      description:
        "overview = how many companies Vytal scores and how health is spread. " +
        "band = counts per band, or the companies in one band (pass `band`). " +
        "census = every red flag and pattern firing now, and how many companies each reaches — COUNTS, not company names. " +
        'finding = WHICH COMPANIES fire one named finding, or all red flags (pass `finding`). For "which stocks are firing red flags" use THIS with finding="red flags", not census. ' +
        "movers = biggest improvers and slippers vs each company's own previous quarter. " +
        "divergence = companies whose pillar reads disagree. " +
        "week = band changes and score moves in the last seven days.",
    },
    band: {
      type: "string",
      description: "Only with slice=band. One of: Pristine, Healthy, Steady, Below Par, Fragile.",
    },
    finding: {
      type: "string",
      description:
        'Only with slice=finding. Either "red flags" — for WHICH COMPANIES are firing any red flag, the ' +
        'question census does not answer — or one finding NAME as Vytal writes it, e.g. "Pledging Crisis", ' +
        '"Divergence". Use a spelling a census result gave you; never a code.',
    },
    scope: {
      type: "string",
      enum: UNIVERSE_SCOPES as unknown as string[],
      description:
        "Default universe = every company Vytal scores. Use portfolio or watchlist to run the SAME question over " +
        "only what the signed-in reader holds or watches — for \"in my portfolio\", \"of the ones I own/watch\". " +
        "It always means the signed-in reader; it can never name anyone else.",
    },
  },
  required: ["slice"],
  additionalProperties: false,
} as const;

const SLICE_SET = new Set<string>(UNIVERSE_SLICES);
const SCOPE_SET = new Set<string>(UNIVERSE_SCOPES);

/**
 * ★ 4a · THE SERVER-SIDE INTERSECTION. The Hub does this in the BROWSER (scopeUniverseView), over a
 * payload it already has; there was no server-side scoped path to reuse, so this is it.
 *
 * ★ ctx.userId — never an argument. `scope` selects WHICH of the caller's own lists; it carries no
 * identity. Both reads are the ones the product already uses for "what the reader holds/watches":
 * watchlist rows owner-scoped like GET /me/watchlist, and holdings as manual FIFO ∪ broker mirror —
 * the same union `ai/insight/relationship.ts` calls "directly holds", so the chat's idea of the
 * reader's book cannot drift from the rest of the platform's.
 *
 * Memoised per turn: a turn asking two scoped slices resolves the symbol set once.
 */
async function symbolsForScope(scope: Exclude<UniverseScopeId, "universe">, ctx: ToolContext): Promise<Set<string>> {
  return ctx.once(`scopeSymbols:${scope}`, async () => {
    if (scope === "watchlist") {
      const rows = await prisma.watchlist.findMany({
        where: { userId: ctx.userId },
        select: { stock: { select: { symbol: true } } },
      });
      return new Set(rows.map((r) => r.stock.symbol));
    }
    const [manual, broker] = await Promise.all([
      prisma.holding.findMany({
        where: { userId: ctx.userId, stockId: { not: null } },
        distinct: ["stockId"],
        select: { stock: { select: { symbol: true } } },
      }),
      prisma.brokerHolding.findMany({
        where: { userId: ctx.userId, stockId: { not: null } },
        distinct: ["stockId"],
        select: { stock: { select: { symbol: true } } },
      }),
    ]);
    const out = new Set<string>();
    for (const r of [...manual, ...broker]) if (r.stock?.symbol) out.add(r.stock.symbol);
    return out;
  });
}

export const getUniverseScanTool: ChatTool<GetUniverseScanArgs> = {
  name: "getUniverseScan",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const slice = typeof args.slice === "string" ? args.slice.trim().toLowerCase() : "";
    if (!SLICE_SET.has(slice)) {
      // A bad enum value is the MODEL's error, not the reader's — fail-soft so it can retry with a
      // valid one rather than the turn dying (registry.ts hands this straight back to the model).
      return { ok: false, error: `getUniverseScan needs a valid 'slice': one of ${UNIVERSE_SLICES.join(", ")}.` };
    }
    const band = typeof args.band === "string" ? args.band : undefined;
    const finding = typeof args.finding === "string" ? args.finding : undefined;

    // ★ FAIL CLOSED ON scope. Absent ⇒ the PUBLIC universe. Present-but-not-one-of-the-three literals
    //   ⇒ refused here, before any query runs: a crafted value never reaches a `where` clause. The
    //   only values that can select an owner-scoped read are the two literals, and both bind to
    //   ctx.userId, which the model cannot write.
    let scope: UniverseScopeId = "universe";
    if (args.scope !== undefined && args.scope !== null) {
      const raw = typeof args.scope === "string" ? args.scope.trim().toLowerCase() : "";
      if (!SCOPE_SET.has(raw)) {
        return { ok: false, error: `getUniverseScan 'scope' must be one of ${UNIVERSE_SCOPES.join(", ")}.` };
      }
      scope = raw as UniverseScopeId;
    }

    try {
      // Two layers of collapsing, both already proved: the per-TURN memo (one read however many slices
      // this turn asks for) in front of the 5-minute process cache (one build however many turns).
      const view = await ctx.once("universeView", () => getUniverseHealthView());
      // null = the whole scored universe. A Set = the caller's OWN symbols, resolved from ctx.userId.
      const symbols = scope === "universe" ? null : await symbolsForScope(scope, ctx);
      const projection = projectUniverse(view, symbols, { slice: slice as UniverseSliceId, scope, band, finding });
      return { ok: true, content: renderUniverseSlice(projection) };
    } catch (e) {
      return { ok: false, error: `Could not read across the scored universe: ${(e as Error).message}` };
    }
  },
};
