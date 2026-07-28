// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WRITE TOOLS: addToWatchlist / removeFromWatchlist — the simplest pair, and the ones that prove the loop.
//
// Neither handler writes anything. Each resolves the ticker, parses through the watchlist service's OWN
// input schema, and returns a proposal. The write happens only in confirmPendingAction, from the stored
// values. See proposals.ts for why that separation exists at all.
//
// ★ ctx.userId, never an argument. The schema names a SYMBOL and nothing else, so there is no field a
// model could put a user in.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { AddToWatchlistInput, RemoveFromWatchlistInput } from "../../watchlist/service.js";
import { resolveStock, str, propose, serviceMessage } from "./write-shared.js";
import type { ProposalField } from "./write-shared.js";
import { BARE_TICKER_DIRECT } from "./shared.js";
import type { ChatTool, ToolResult } from "./types.js";

interface Args {
  symbol?: unknown;
}

const PARAMETERS = {
  type: "object",
  properties: { symbol: { type: "string", description: 'NSE ticker of a Vytal-covered stock, e.g. "HDFCBANK".' } },
  required: ["symbol"],
  additionalProperties: false,
} as const;

// ── ADD ─────────────────────────────────────────────────────────────────────────────────────────────
const ADD_DESCRIPTION =
  "Propose adding one stock to the reader's own watchlist. Call this when the reader asks to watch, " +
  "track, follow, or keep an eye on a covered stock. " +
  "THIS DOES NOT ADD ANYTHING YET — it returns a proposal describing exactly what would be added. You MUST " +
  "then state that back to the reader and ask them to confirm; never reply as though it is already on their " +
  "watchlist. Only after they say yes do you call confirmPendingAction, which performs the actual write. " +
  "Takes a ticker only — it always writes to the signed-in reader's own watchlist and can never touch " +
  "anyone else's. If the reader named a company in words rather than a ticker, call searchStocks first: " +
  "adding the wrong company is worse than asking." +
  BARE_TICKER_DIRECT;

export const addToWatchlistWriteTool: ChatTool<Args> = {
  name: "addToWatchlist",
  klass: "write",
  description: ADD_DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const resolved = await resolveStock(str(args.symbol));
    if ("boundary" in resolved) return resolved.boundary;

    // Parse through the SERVICE's schema — the same one POST /me/watchlist uses.
    const parsed = AddToWatchlistInput.safeParse({ stockId: resolved.id });
    if (!parsed.success) return { ok: false, error: `Could not prepare that watchlist add: ${parsed.error.issues[0]?.message ?? "invalid input"}` };

    // Already there? Say so instead of proposing a no-op — the add is idempotent, so "confirm" would
    // produce a confusing "added" for something that was never not-added.
    const existing = await prisma.watchlist.findUnique({
      where: { userId_stockId: { userId: ctx.userId, stockId: resolved.id } },
      select: { addedAt: true },
    });
    if (existing) {
      return {
        ok: true,
        content:
          `ALREADY WATCHED: ${resolved.symbol} (${resolved.name}) is already on the reader's watchlist, so there ` +
          `is nothing to add and no confirmation is needed. Say so plainly; do not claim to have added it.`,
      };
    }

    // The pin-time baseline the write will capture — shown so the reader consents to a real, current thing.
    const snap = await prisma.scoreSnapshot.findFirst({
      where: { stockId: resolved.id },
      orderBy: [{ asOfDate: "desc" }, { version: "desc" }],
      select: { composite: true, labelBand: true },
    });

    const fields: ProposalField[] = [
      { label: "Stock", value: `${resolved.symbol} — ${resolved.name}` },
      { label: "Health recorded at the moment of adding", value: snap ? `${Math.round(Number(snap.composite))} (${snap.labelBand})` : "not scored by Vytal yet" },
    ];
    return propose(ctx, {
      kind: "addToWatchlist",
      summary: `Add ${resolved.symbol} to the reader's watchlist`,
      fields,
      args: parsed.data,
    });
  },
};

// ── REMOVE ──────────────────────────────────────────────────────────────────────────────────────────
const REMOVE_DESCRIPTION =
  "Propose removing one stock from the reader's own watchlist. Call this when the reader asks to stop " +
  "watching, untrack, unfollow, or drop a stock from their watchlist. " +
  "THIS DOES NOT REMOVE ANYTHING YET — it returns a proposal describing exactly what would be removed. You " +
  "MUST state that back to the reader and ask them to confirm; never reply as though it is already gone. " +
  "Only after they say yes do you call confirmPendingAction. Takes a ticker only — it always writes to the " +
  "signed-in reader's own watchlist and can never touch anyone else's." +
  BARE_TICKER_DIRECT;

export const removeFromWatchlistWriteTool: ChatTool<Args> = {
  name: "removeFromWatchlist",
  klass: "write",
  description: REMOVE_DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const resolved = await resolveStock(str(args.symbol));
    if ("boundary" in resolved) return resolved.boundary;

    // Not on the list → there is nothing to confirm. An honest state, not an error.
    const existing = await prisma.watchlist.findUnique({
      where: { userId_stockId: { userId: ctx.userId, stockId: resolved.id } },
      select: { addedAt: true, favorite: true },
    });
    if (!existing) {
      return {
        ok: true,
        content:
          `NOT WATCHED: ${resolved.symbol} (${resolved.name}) is not on the reader's watchlist, so there is ` +
          `nothing to remove and no confirmation is needed. Say so plainly.`,
      };
    }

    const parsed = RemoveFromWatchlistInput.safeParse({ stockId: resolved.id });
    if (!parsed.success) return { ok: false, error: `Could not prepare that watchlist removal: ${serviceMessage(parsed.error)}` };

    const fields: ProposalField[] = [
      { label: "Stock", value: `${resolved.symbol} — ${resolved.name}` },
      { label: "On the watchlist since", value: existing.addedAt.toISOString().slice(0, 10) },
      { label: "Starred as a favourite", value: existing.favorite ? "yes" : "no" },
    ];
    return propose(ctx, {
      kind: "removeFromWatchlist",
      summary: `Remove ${resolved.symbol} from the reader's watchlist`,
      fields,
      args: parsed.data,
    });
  },
};
