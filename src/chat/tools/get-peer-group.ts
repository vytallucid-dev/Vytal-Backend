// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOLS: getPeerGroup · getPeerGroupMembers — the comparison set behind every peer-relative reading.
//
// Both read the named helpers in scoring/read/peer-group-lookup.ts (the LEAN projection — identity only,
// not the metrics-enriched controller variant a member list never needs).
//
// ★ WHY THE PEER GROUP MATTERS ENOUGH TO BE A TOOL. Vytal's whole three-lens model judges a metric against
// PEERS as well as a fixed bar, so "who are the peers?" is a question the reader can reasonably ask about
// any reading they are given. A stock with NO peer-group row is the display-only firewall — covered, but
// never scored — and that is stated honestly rather than rendered as an error.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { getPeerGroupForStock, getPeerGroupMembers } from "../../scoring/read/peer-group-lookup.js";
import { notInUniverse } from "./boundary.js";
import { kvLine } from "./shared.js";
import type { ChatTool, ToolResult } from "./types.js";

interface Args {
  symbol?: unknown;
}

const SYMBOL_PARAM = {
  type: "object",
  properties: { symbol: { type: "string", description: 'NSE ticker, e.g. "TCS".' } },
  required: ["symbol"],
  additionalProperties: false,
} as const;

const symbolOf = (args: Args): string => (typeof args.symbol === "string" ? args.symbol.trim().toUpperCase() : "");

/** Resolve symbol → stock id. null ⇔ outside the covered universe (the live boundary check). */
async function resolveStock(symbol: string): Promise<{ id: string; symbol: string; name: string } | null> {
  return prisma.stock.findUnique({ where: { symbol }, select: { id: true, symbol: true, name: true } });
}

// ── 1. THE GROUP ──────────────────────────────────────────────────────────────────────────────────
const GROUP_DESCRIPTION =
  "Find WHICH peer group a covered stock is judged against, and how many companies are in it. Vytal scores " +
  "every metric partly against a stock's peer group rather than the whole market, so this is what a " +
  "'better than peers' or 'rank 3 of 7' statement is measured against — call it when the reader asks who a " +
  "company is being compared to, or why a comparison set looks the way it does. Returns the group's name and " +
  "size only; call getPeerGroupMembers for the actual companies. A covered stock with no peer group is not " +
  "scored at all — report that plainly. Requires the exact NSE ticker.";

export const getPeerGroupTool: ChatTool<Args> = {
  name: "getPeerGroup",
  klass: "read",
  description: GROUP_DESCRIPTION,
  parameters: SYMBOL_PARAM as unknown as Record<string, unknown>,
  async handler(args): Promise<ToolResult> {
    const symbol = symbolOf(args);
    if (!symbol) return { ok: false, error: "getPeerGroup requires a non-empty 'symbol' string (an NSE ticker)." };
    try {
      const stock = await resolveStock(symbol);
      if (!stock) return { ok: true, content: notInUniverse(symbol) };
      const pg = await getPeerGroupForStock(stock.id);
      const L: string[] = [`=== VYTAL PEER GROUP: ${stock.symbol} (${stock.name}) ===`];
      if (!pg) {
        L.push(
          `${stock.symbol} has no peer group assigned, which means Vytal does not score it — there is no health ` +
            `score, no pillars and no peer-relative reading for it. Say so honestly; this is a coverage state, not an error.`,
        );
        return { ok: true, content: L.join("\n") };
      }
      L.push(kvLine("Peer group", pg.displayName));
      L.push(kvLine("Internal group name", pg.name));
      L.push(kvLine("Members in the group", pg.stockCount));
      L.push("(Call getPeerGroupMembers with the same ticker for the member companies.)");
      return { ok: true, content: L.join("\n") };
    } catch (e) {
      return { ok: false, error: `Could not read the peer group for ${symbol}: ${(e as Error).message}` };
    }
  },
};

// ── 2. THE MEMBERS ────────────────────────────────────────────────────────────────────────────────
const MEMBERS_DESCRIPTION =
  "List the companies in a covered stock's peer group — the actual comparison set behind its peer-relative " +
  "readings and its rank. Call this when the reader asks who a company's peers are, or wants candidates to " +
  "compare against. Returns each member's ticker and name (identity only — call getStockFacts on a member " +
  "for its health, or getStockPrice for its price). A covered stock with no peer group is not scored; report " +
  "that plainly rather than inventing a comparison set. Requires the exact NSE ticker.";

export const getPeerGroupMembersTool: ChatTool<Args> = {
  name: "getPeerGroupMembers",
  klass: "read",
  description: MEMBERS_DESCRIPTION,
  parameters: SYMBOL_PARAM as unknown as Record<string, unknown>,
  async handler(args): Promise<ToolResult> {
    const symbol = symbolOf(args);
    if (!symbol) return { ok: false, error: "getPeerGroupMembers requires a non-empty 'symbol' string (an NSE ticker)." };
    try {
      const stock = await resolveStock(symbol);
      if (!stock) return { ok: true, content: notInUniverse(symbol) };
      const pg = await getPeerGroupForStock(stock.id);
      if (!pg) {
        return {
          ok: true,
          content:
            `=== VYTAL PEER GROUP MEMBERS: ${stock.symbol} (${stock.name}) ===\n` +
            `${stock.symbol} has no peer group assigned, so Vytal has no comparison set for it and does not score it. ` +
            `Say so honestly; do not assemble a peer list of your own.`,
        };
      }
      const members = await getPeerGroupMembers(pg.id);
      const L: string[] = [`=== VYTAL PEER GROUP MEMBERS: ${stock.symbol} (${stock.name}) ===`];
      L.push(kvLine("Peer group", pg.displayName));
      L.push(kvLine("Members listed", `${members.length} (group roster count: ${pg.stockCount})`));
      for (const m of members) L.push(`  - ${m.symbol} — ${m.name}${m.symbol === stock.symbol ? " (this stock)" : ""}`);
      return { ok: true, content: L.join("\n") };
    } catch (e) {
      return { ok: false, error: `Could not read peer group members for ${symbol}: ${(e as Error).message}` };
    }
  },
};
