// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getWatchlist — the stocks the reader is watching, PROJECTED DOWN.
//
// ★ ctx.userId, never an argument (see get-portfolio-facts.ts). No parameters at all.
//
// ⚠ THE READ IS RICH; THE OUTPUT IS NOT. enrichWatchlist returns ~40 fields per row (price, prev close,
// day change, market-cap tier, pinned baselines, per-row findings, three-lens patterns) — a 20-name list
// would be well over a thousand tokens of mostly-unasked detail. We reuse that read UNCHANGED (it is the
// same join the watchlist page uses, so the tool and the page cannot disagree) and project to the five
// fields a conversation actually needs: symbol, name, health, band, favourite. Anything deeper is one
// getStockFacts call away, priced only when the reader actually asks.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { enrichWatchlist } from "../../controllers/me/watchlist-enrich.js";
import { kvLine, scoreStr, isNum, NA } from "./shared.js";
import type { ChatTool, ToolResult } from "./types.js";

const DESCRIPTION =
  "List the stocks on the reader's own watchlist, each with its current Vytal health score, band, and " +
  "whether they starred it as a favourite. Call this when the reader asks what they are watching or " +
  "tracking, or wants their watched names compared or ranked. Takes no arguments — it always reads the " +
  "signed-in reader's own watchlist and can never read anyone else's. An empty watchlist is an honest " +
  "answer, not an error. This is the SUMMARY view: for anything deeper about one of these names (pillars, " +
  "findings, peers) call getStockFacts with its ticker.";

const PARAMETERS = { type: "object", properties: {}, additionalProperties: false } as const;

export const getWatchlistTool: ChatTool<Record<string, never>> = {
  name: "getWatchlist",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(_args, ctx): Promise<ToolResult> {
    try {
      // ★ ctx.userId — the same owner-scoped read GET /me/watchlist performs.
      const rows = await prisma.watchlist.findMany({
        where: { userId: ctx.userId },
        orderBy: { addedAt: "desc" },
        select: {
          stockId: true,
          addedAt: true,
          favorite: true,
          pinnedHealth: true,
          pinnedBand: true,
          pinnedPrice: true,
          stock: { select: { symbol: true, name: true, industryType: true, sector: { select: { name: true } } } },
        },
      });

      if (!rows.length) {
        return { ok: true, content: "=== READER'S WATCHLIST ===\nThe reader's watchlist is empty — no stocks are being watched. This is a real state, not missing data." };
      }

      const enriched = await enrichWatchlist(
        rows.map((r) => ({
          stockId: r.stockId,
          symbol: r.stock.symbol,
          name: r.stock.name,
          sector: r.stock.sector?.name ?? null,
          industryType: r.stock.industryType,
          addedAt: r.addedAt,
          favorite: r.favorite,
          pinnedHealth: r.pinnedHealth,
          pinnedBand: r.pinnedBand,
          pinnedPrice: r.pinnedPrice,
        })),
      );

      const L: string[] = ["=== READER'S WATCHLIST ==="];
      L.push(kvLine("Stocks watched", enriched.length));
      for (const e of enriched) {
        L.push(
          `  - ${e.symbol} — ${e.name} · health ${isNum(e.health) ? scoreStr(e.health) : NA} · band ${e.band ?? NA}` +
            `${e.favorite ? " · favourite" : ""}${e.scored ? "" : " · not scored by Vytal"}`,
        );
      }
      L.push("(Summary only — call getStockFacts with a ticker for that stock's full read.)");
      return { ok: true, content: L.join("\n") };
    } catch (e) {
      return { ok: false, error: `Could not read the watchlist: ${(e as Error).message}` };
    }
  },
};
