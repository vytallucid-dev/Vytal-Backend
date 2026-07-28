// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getStockRelationship — how the READER stands to ONE stock (held? watched? how big? since when?).
//
// ★ ctx.userId, never an argument (see get-portfolio-facts.ts). The schema names a SYMBOL, never a user.
//
// TWO PATHS, AND THE CHEAP ONE IS THE COMMON ONE:
//   · probeStockRelationship — three indexed lookups, answers held/watched on its own. When the reader has
//     NO relationship, that is the whole answer and we stop there (no portfolio view, no health view).
//   · groundStockRelationship — the rich block (position weight, sector exposure, peers held, health since
//     added). It requires a built HealthSnapshotView, so it is only reached when the reader IS related and
//     the stock IS scored. Its own contract says orienting readers never reach it.
//
// ⚠ THE OUTPUT IS INPUT TO THE MODEL, NOT A SENTENCE TO SPEAK. The system prompt's personalization rule
// (CHAT_USE_DONT_NARRATE) governs how it is used: shape the emphasis, never narrate the reader's behaviour
// back at them — and never announce the ABSENCE of a position. The no-relationship result says so
// explicitly, because a model handed a bare "held: false" will otherwise volunteer it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { groundStockHealth } from "../../ai/grounding.js";
import { probeStockRelationship, groundStockRelationship } from "../../ai/insight/relationship.js";
import { notInUniverse } from "./boundary.js";
import type { ChatTool, ToolResult } from "./types.js";

interface Args {
  symbol?: unknown;
}

const DESCRIPTION =
  "Find how the READER personally stands to one covered stock: whether they hold it, how large the position " +
  "is as a share of their book, their total exposure to that stock's sector, how many of its peers they also " +
  "hold, whether it is on their watchlist, and how its health has moved since they added it. Call this when " +
  "the reader asks 'do I own this?', 'how much of this do I have?', or when a reading would land differently " +
  "for a holder than for someone just looking. Takes only a ticker — it always reads the signed-in reader " +
  "and can never read anyone else. Use the result to choose EMPHASIS; do not read it back to them as a " +
  "report on their behaviour, and if they hold nothing here, simply frame the answer around the company.";

const PARAMETERS = {
  type: "object",
  properties: { symbol: { type: "string", description: 'NSE ticker, e.g. "INFY".' } },
  required: ["symbol"],
  additionalProperties: false,
} as const;

export const getStockRelationshipTool: ChatTool<Args> = {
  name: "getStockRelationship",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const symbol = typeof args.symbol === "string" ? args.symbol.trim().toUpperCase() : "";
    if (!symbol) return { ok: false, error: "getStockRelationship requires a non-empty 'symbol' string (an NSE ticker)." };

    try {
      const stock = await prisma.stock.findUnique({
        where: { symbol },
        select: { id: true, symbol: true, sector: { select: { name: true } } },
      });
      if (!stock) return { ok: true, content: notInUniverse(symbol) };

      const probe = await probeStockRelationship(ctx.userId, stock.id);
      if (!probe.held && !probe.watchlist) {
        return {
          ok: true,
          content:
            `=== READER RELATIONSHIP: ${symbol} ===\n` +
            `The reader does not hold ${symbol} and does not have it on their watchlist. Use this only to decide ` +
            `FRAMING — explain the company on its own terms. Do NOT tell them they don't hold it: announcing the ` +
            `absence of a position is still narrating the reader.`,
        };
      }

      // Related → the rich block needs the health view (scored stocks only). Same memo key as
      // getStockFacts, so a turn that asks for both pays for one groundStockHealth.
      const grounding = await ctx.once(`stockHealth:${symbol}`, () => groundStockHealth(symbol));
      if (!grounding || !grounding.data.scored) {
        const parts = [probe.held ? "holds this stock" : null, probe.watchlist ? "has it on their watchlist" : null].filter(Boolean);
        return {
          ok: true,
          content:
            `=== READER RELATIONSHIP: ${symbol} ===\n` +
            `The reader ${parts.join(" and ")}. Vytal does not score this stock, so position weight, sector ` +
            `exposure, peers held and health-since-added are not available. Use this for emphasis only.`,
        };
      }

      const rel = await groundStockRelationship(
        ctx.userId,
        { id: stock.id, symbol: stock.symbol, sectorName: stock.sector?.name ?? null },
        grounding.data,
        probe,
      );
      if (rel.degraded || !rel.block) {
        const parts = [probe.held ? "holds this stock" : null, probe.watchlist ? "has it on their watchlist" : null].filter(Boolean);
        return {
          ok: true,
          content:
            `=== READER RELATIONSHIP: ${symbol} ===\n` +
            `The reader ${parts.join(" and ")}. The detailed position figures could not be assembled this time, so ` +
            `weight, sector exposure and peers-held are not available. Use the fact of the relationship for emphasis only.`,
        };
      }
      return { ok: true, content: rel.block };
    } catch (e) {
      return { ok: false, error: `Could not read the reader's relationship to ${symbol}: ${(e as Error).message}` };
    }
  },
};
