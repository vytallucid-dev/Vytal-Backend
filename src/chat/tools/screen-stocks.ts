// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: screenStocks — the tool that answers a NUMBER the reader chose.
//
// getUniverseScan answers seven fixed questions about many companies. Its boundary paragraph said, in
// so many words, that Vytal has no numeric screen — and that was true until this file. This is the
// tool that makes it false, which is why that one clause is the single edit made to it.
//
// ── ★ WHY A SEPARATE TOOL AND NOT AN EIGHTH SLICE ──────────────────────────────────────────────────
// Measured: a filter slice is ~526 tokens against ~829 for the whole tool, so the slice is CHEAPER and
// was still rejected, for three reasons that outrank 303 tokens a message.
//   1. It would mean rewriting getUniverseScan's boundary paragraph. That file records THREE separate
//      live regressions in its own description, and the registry header is explicit that a description
//      is a behavioural claim testable only by a real call. Re-opening seven tuned behaviours to save
//      303 tokens is a bad trade.
//   2. `slice` is a mutually-exclusive enum and a screen is not one of seven questions. slice=band +
//      conditions, and slice=filter + band, are both reachable and both meaningless — a new
//      invalid-combination surface that did not exist before.
//   3. The trigger phrasings are DISJOINT. "how many / which / across the market / what's firing"
//      versus "stocks where / screen for / find me / above / under". Flash-Lite keys hard on how a
//      description STARTS (the searchStocks bare-ticker regression), and two openings in one
//      description is exactly that failure.
// The precedent is already in the fleet: getUniverseScan ↔ getFindingsForSymbols split for this
// reason, each stating the other's boundary. This makes it a triangle.
//
// ── ★ THE DESCRIPTION'S SHAPE IS LOAD-BEARING ──────────────────────────────────────────────────────
// Triggers first (the phrasings a reader actually uses), mechanics second, boundary last. The two ★
// paragraphs are the two failures this tool can have that nothing downstream can catch:
//   · inventing a threshold — which would make Vytal an adviser, in one sentence, silently.
//   · answering a valuation question — which it CANNOT do from any field, and must not approximate
//     from health. "Pristine" is published as "Pristine — fully priced", so proxying valuation from
//     the health score does not merely approximate, it INVERTS.
// And per §THE PAGES: it must not explain WHY something is missing. A model that has been taught to
// speak confidently about Vytal will confidently invent a product rationale for a gap.
//
// ═══ ★ SECURITY — THE USER IS NEVER A PARAMETER ════════════════════════════════════════════════════
// Carried over unchanged from getUniverseScan, including the reasoning. The schema has NO userId, no
// owner, no account field. `scope` is a THREE-VALUE ENUM and the two personal values resolve against
// ctx.userId. Anything that is not exactly one of the three literals is refused before any read runs,
// so a crafted value ("portfolio:other-user", an object, an array) reaches an error message, not a
// query. A model cannot name a user, so it cannot reach another user's book.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { getUniverseHealthView } from "../../scoring/read/universe-view.cache.js";
import { getUniverseMetricValues } from "../../scoring/read/metric-values.cache.js";
import { screenUniverse } from "../../scoring/read/screen.service.js";
import { SCREEN_FIELDS_IDS, type ScreenCondition, type ScreenFieldId } from "../../scoring/read/screen.types.js";
import { UNIVERSE_SCOPES, type UniverseScopeId } from "../../scoring/read/universe-projection.types.js";
import { renderScreen } from "../screen-brief.js";
import type { ChatTool, ToolContext, ToolResult } from "./types.js";

interface ScreenStocksArgs {
  conditions?: unknown;
  band?: unknown;
  sector?: unknown;
  redFlags?: unknown;
  scope?: unknown;
  sort?: unknown;
}

const DESCRIPTION =
  "Find the companies that MEET A NUMBER the reader chose — \"stocks with return on equity above 20%\", " +
  "\"debt to equity under 1\", \"Pristine pharma names with no red flags\", \"Ownership above 75 but " +
  "Foundation under 60\". Call it whenever the question carries a THRESHOLD or a combination of " +
  "conditions — \"show me stocks where…\", \"screen for…\", \"find me companies with…\", \"which stocks " +
  "have more/less than…\". Every condition is applied together, and the result lists each company WITH " +
  "its actual figures. Bounds INCLUDE the number given. " +
  "★ IT NEVER INVENTS A NUMBER, AND THIS IS THE EASIEST MISTAKE TO MAKE HERE. If the reader describes a " +
  "LEVEL IN WORDS — \"good\", \"strong\", \"high\", \"low\", \"solid\", \"healthy\", \"heavy\", \"light\" — " +
  "and names no figure, pass that field with NO min and NO max. You get the field's spread back to hand " +
  "over so the READER picks the number. Worked examples of the mistake: \"stocks with LOW DEBT\" is NOT " +
  "debtToEquity max 0.5, and \"STRONG Foundation\" is NOT foundation min 70 — both are unbounded " +
  "conditions, because the reader named no number and Vytal has none. You may know a figure that is " +
  "conventionally called low or strong; that convention is not Vytal's and must not be presented as its " +
  "screen. Never choose a threshold yourself, never take one from your own knowledge, never describe a " +
  "figure as what counts as good, and never call a company strong or weak because it cleared one. " +
  "★ VYTAL HOLDS NO VALUATION DATA AT ALL — no P/E, no price-to-book, no EV/EBITDA, no PEG, no dividend " +
  "yield, no fair value and no target price. So \"cheap\", \"undervalued\", \"expensive\", \"good value\" " +
  "and \"reasonably priced\" cannot be screened, and the health score is NOT a substitute for them — the " +
  "top band is published as \"Pristine — fully priced\", so reading health as cheapness reverses its " +
  "meaning. Say plainly that Vytal has no measure of value; do NOT approximate one, do NOT answer from " +
  "your own knowledge, and do NOT explain why it is missing. " +
  "It also cannot screen on growth, share price, market capitalisation, shareholding percentages, or " +
  "banking metrics such as gross NPA — asked for those, say plainly that this screen does not cover them. " +
  "For a COUNT, the band spread, what is firing, or who moved, call getUniverseScan. For ONE company " +
  "call getStockFacts. For what Vytal SAYS about companies you can already name, call getFindingsForSymbols.";

const PARAMETERS = {
  type: "object",
  properties: {
    conditions: {
      type: "array",
      description:
        "The numeric conditions, ALL applied together. " +
        "★ ONLY EVER PUT A NUMBER HERE THAT THE READER THEMSELVES NAMED. If they described a level in " +
        "words — low, high, good, strong, solid, healthy, heavy — send the field with NO min and NO max " +
        "and you get its spread back to offer them. Do not convert a word into a figure, however " +
        "standard that figure seems: \"low debt\" is {\"field\":\"debtToEquity\"} with no bounds, NOT " +
        "max 0.5. ★ A BAND NAME IS NOT A NUMBER EITHER — Pristine, Healthy, Steady, Below Par and " +
        "Fragile go in `band`, never here as a health condition.",
      items: {
        type: "object",
        properties: {
          field: {
            type: "string",
            enum: SCREEN_FIELDS_IDS as unknown as string[],
            description:
              "health = the 0-100 composite health score. foundation / momentum / market / ownership = the " +
              "0-100 pillar subtotals (ownership sits at 75 for most companies, so a cut there separates little). " +
              "returnOnEquity, returnOnCapital, operatingMargin, netMargin are PERCENT — pass 20 for 20%. " +
              "debtToEquity, cashConversion, assetTurnover are ratios; interestCoverage is times; receivableDays is days. " +
              "★ The nine company metrics are computed for the 82 NON-FINANCIAL companies only. The banks Vytal " +
              "scores are measured on banking metrics instead, and the result reports them as not-comparable " +
              "rather than dropping them — relay that, never a bare list.",
          },
          min: { type: "number", description: "Keep companies at or above this value. Omit unless the READER named this figure." },
          max: { type: "number", description: "Keep companies at or below this value. Omit unless the READER named this figure." },
        },
        required: ["field"],
        additionalProperties: false,
      },
    },
    band: {
      type: "string",
      description:
        "Optional, one band only: Pristine, Healthy, Steady, Below Par, Fragile. ★ EVERY band word the " +
        "reader uses belongs HERE — \"Pristine pharma with no red flags\" is band=Pristine plus " +
        "sector and redFlags, with NO condition on health. A band is a name, not a score to filter on.",
    },
    sector: {
      type: "string",
      description:
        "Optional, one sector as Vytal names it, e.g. \"Pharma & Healthcare\", \"Banks\", \"IT & Technology\", " +
        "\"Automobile\", \"Metals & Mining\". A name Vytal does not use comes back with the real list.",
    },
    redFlags: {
      type: "string",
      enum: ["none", "any"],
      description: "Optional. none = companies firing NO red flag; any = firing at least one.",
    },
    scope: {
      type: "string",
      enum: UNIVERSE_SCOPES as unknown as string[],
      description:
        "Default universe = every company Vytal scores. Use portfolio or watchlist to run the SAME screen over " +
        "only what the signed-in reader holds or watches. It always means the signed-in reader; it can never name anyone else.",
    },
    sort: {
      type: "string",
      enum: ["health", "field"],
      description: "Default health, highest first. field orders by the FIRST condition's field instead.",
    },
  },
  required: ["conditions"],
  additionalProperties: false,
} as const;

const FIELD_SET = new Set<string>(SCREEN_FIELDS_IDS);
const SCOPE_SET = new Set<string>(UNIVERSE_SCOPES);

/** ★ Same owner-scoped reads as getUniverseScan, memoised on the same per-turn key, so a turn that
 *  scans AND screens over the reader's book resolves their symbols once. Never takes a user argument. */
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

/**
 * Parse the model's `conditions`. FAIL-SOFT on the model's own mistakes (registry.ts hands the error
 * straight back so it can retry), but NEVER lenient about what a field means.
 *
 * ★ A NON-NUMERIC min/max IS DROPPED, NOT COERCED. `min: "twenty"` becoming 20 would be this tool
 * inventing a threshold through a parsing convenience — the one thing it must not do. Dropping it
 * makes the condition unbounded, which returns the SPREAD and asks the reader for a figure. The safe
 * failure is asking; the unsafe one is guessing.
 */
function parseConditions(raw: unknown): { conditions: ScreenCondition[] } | { error: string } {
  if (raw === undefined || raw === null) return { conditions: [] };
  if (!Array.isArray(raw)) return { error: "screenStocks 'conditions' must be an array of {field, min?, max?} objects." };
  const out: ScreenCondition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { error: "Each entry in 'conditions' must be an object like {\"field\":\"returnOnEquity\",\"min\":20}." };
    }
    const field = (item as { field?: unknown }).field;
    if (typeof field !== "string" || !FIELD_SET.has(field)) {
      return {
        error:
          `"${String(field)}" is not a field this screen can filter on. The fields are: ${SCREEN_FIELDS_IDS.join(", ")}. ` +
          "It has no valuation, growth, price, market-cap, shareholding or banking-metric field — if the reader asked for one of those, " +
          "say plainly that this screen does not cover it rather than substituting a different field.",
      };
    }
    const c: ScreenCondition = { field: field as ScreenFieldId };
    const min = (item as { min?: unknown }).min;
    const max = (item as { max?: unknown }).max;
    if (typeof min === "number" && Number.isFinite(min)) c.min = min;
    if (typeof max === "number" && Number.isFinite(max)) c.max = max;
    // min > max is unsatisfiable by construction; say so rather than returning a confusing empty list.
    if (c.min != null && c.max != null && c.min > c.max) {
      return { error: `A condition on ${field} asks for at least ${c.min} and at most ${c.max}, which nothing can satisfy. Check the bounds.` };
    }
    out.push(c);
  }
  return { conditions: out };
}

export const screenStocksTool: ChatTool<ScreenStocksArgs> = {
  name: "screenStocks",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const parsed = parseConditions(args.conditions);
    if ("error" in parsed) return { ok: false, error: parsed.error };

    const band = typeof args.band === "string" ? args.band : undefined;
    const sector = typeof args.sector === "string" ? args.sector : undefined;
    const redFlags = args.redFlags === "none" || args.redFlags === "any" ? args.redFlags : undefined;
    const sort = args.sort === "field" ? "field" : "health";

    // A call with nothing at all would return the whole universe as a "screen", which is slice=overview's
    // job and would let the model reach for this tool for questions getUniverseScan answers better.
    if (parsed.conditions.length === 0 && !band && !sector && !redFlags) {
      return {
        ok: false,
        error:
          "screenStocks needs at least one condition, band, sector or red-flag filter. For how many companies Vytal scores " +
          "or how health is spread across them, call getUniverseScan with slice=overview instead.",
      };
    }

    // ★ FAIL CLOSED ON scope — identical to getUniverseScan. Absent ⇒ the PUBLIC universe.
    let scope: UniverseScopeId = "universe";
    if (args.scope !== undefined && args.scope !== null) {
      const rawScope = typeof args.scope === "string" ? args.scope.trim().toLowerCase() : "";
      if (!SCOPE_SET.has(rawScope)) {
        return { ok: false, error: `screenStocks 'scope' must be one of ${UNIVERSE_SCOPES.join(", ")}.` };
      }
      scope = rawScope as UniverseScopeId;
    }

    try {
      // Both reads are per-turn memoised in front of their own 5-minute process caches. A turn that
      // scans and then screens pays for the universe view once; a screen with no metric condition
      // still loads metric values, because the cache makes that ~0ms warm and the branch is not worth
      // the divergence between "what a screen can answer" and "what it happened to load".
      const [view, metricValues] = await Promise.all([
        ctx.once("universeView", () => getUniverseHealthView()),
        ctx.once("universeMetricValues", () => getUniverseMetricValues()),
      ]);
      const symbols = scope === "universe" ? null : await symbolsForScope(scope, ctx);
      const projection = await screenUniverse(view, metricValues, symbols, {
        conditions: parsed.conditions,
        scope,
        band,
        sector,
        redFlags,
        sort,
      });
      return { ok: true, content: renderScreen(projection) };
    } catch (e) {
      return { ok: false, error: `Could not run that screen across the scored universe: ${(e as Error).message}` };
    }
  },
};
