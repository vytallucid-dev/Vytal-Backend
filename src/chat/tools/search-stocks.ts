// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: searchStocks — resolve a company NAME to a covered ticker. The fleet's entry point: every other
// stock tool takes a symbol, and readers say "Reliance", not "RELIANCE".
//
// ⚠ NET-NEW FILTERING, REUSED READ. There is no server-side equity search — the app's own picker fetches
// the whole universe once and filters CLIENT-side (name-switcher.tsx). So the filtering lives HERE, over
// `buildUniverseStocksList()` (the same read the picker uses, 2 queries, ~505 rows). No new DB query.
//
// ★ THE BOUNDARY IS THE HONEST PART. This searches Vytal's COVERED UNIVERSE ONLY, and a miss cannot
// distinguish "no such company" from "real company we don't cover" — so an empty result says exactly
// that and nothing more. It never asserts the company doesn't exist.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { buildUniverseStocksList } from "../../scoring/read/stocks-list.service.js";
import type { UniverseStockListItem } from "../../scoring/read/stocks-list.types.js";
import { kvLine, scoreStr, isNum, NA } from "./shared.js";
import type { ChatTool, ToolResult } from "./types.js";

interface SearchStocksArgs {
  query?: unknown;
  limit?: unknown;
}

const MAX_RESULTS = 10;

const DESCRIPTION =
  "Find which Indian stocks Vytal covers by company name or partial ticker, and get their exact NSE ticker " +
  "symbols. Call this FIRST whenever the reader names a company in words rather than a ticker (\"Reliance\", " +
  "\"HDFC Bank\", \"the big cement one\") — every other stock tool needs the exact symbol, and guessing a " +
  "ticker is how you end up reading the wrong company. If the reader already gave an exact ticker (all-caps, " +
  "no spaces, e.g. ACC or HDFCBANK), skip this and call the stock tool directly. Returns up to 10 matches, " +
  "each with its symbol, name, sector, and whether Vytal has scored it. Searches ONLY Vytal's covered " +
  "universe: an empty result means the name is not in our coverage, which is NOT the same as the company not " +
  "existing — say so honestly and do not guess a ticker.";

const PARAMETERS = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: 'Company name, part of a name, or a partial ticker. e.g. "reliance", "hdfc", "cement".',
    },
    limit: {
      type: "integer",
      description: `Optional. Maximum matches to return (1-${MAX_RESULTS}, default ${MAX_RESULTS}).`,
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

/** Rank: exact symbol > symbol prefix > name prefix > substring. Stable, cheap, no index needed. */
function rank(item: UniverseStockListItem, needle: string): number {
  const sym = item.symbol.toLowerCase();
  const name = item.name.toLowerCase();
  if (sym === needle) return 0;
  if (sym.startsWith(needle)) return 1;
  if (name.startsWith(needle)) return 2;
  if (sym.includes(needle)) return 3;
  if (name.includes(needle)) return 4;
  return 99;
}

export const searchStocksTool: ChatTool<SearchStocksArgs> = {
  name: "searchStocks",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args): Promise<ToolResult> {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { ok: false, error: "searchStocks requires a non-empty 'query' string (a company name or partial ticker)." };
    const limit = Math.max(1, Math.min(typeof args.limit === "number" ? args.limit : MAX_RESULTS, MAX_RESULTS));

    let universe: UniverseStockListItem[];
    try {
      universe = await buildUniverseStocksList();
    } catch (e) {
      return { ok: false, error: `Could not search Vytal's universe: ${(e as Error).message}` };
    }

    const needle = query.toLowerCase();
    const hits = universe
      .map((s) => ({ s, r: rank(s, needle) }))
      .filter((x) => x.r < 99)
      .sort((a, b) => a.r - b.r || a.s.symbol.localeCompare(b.s.symbol))
      .slice(0, limit);

    if (!hits.length) {
      return {
        ok: true,
        content:
          `NO MATCH: nothing in Vytal's covered universe matches "${query}". Vytal covers a defined set of ` +
          `Indian stocks; a name that is absent may simply be outside that coverage rather than nonexistent. ` +
          `Tell the reader plainly that we do not cover it, and do NOT guess a ticker or state any figure for it.`,
      };
    }

    const L: string[] = [`=== VYTAL COVERAGE SEARCH: "${query}" — ${hits.length} match${hits.length === 1 ? "" : "es"} (searched Vytal's covered universe only) ===`];
    for (const { s } of hits) {
      L.push(
        `- ${s.symbol} — ${s.name} · sector ${s.sector?.displayName ?? NA} · ` +
          `${s.scored ? `scored (health ${isNum(s.composite) ? scoreStr(s.composite) : NA}, band ${s.band ?? NA})` : "covered but not scored yet"}`,
      );
    }
    L.push(kvLine("Total matches shown", hits.length));
    return { ok: true, content: L.join("\n") };
  },
};
