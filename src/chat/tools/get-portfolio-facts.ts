// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// TOOL: getPortfolioFacts — the reader's OWN book: coverage, construction, health read, held companies.
//
// ★ THE USER IS NEVER A PARAMETER. The schema has NO userId field and the handler reads ctx.userId (from
// req.authUser). The model cannot name a user, so it cannot reach another user's book — IDOR is
// structurally impossible, exactly as in the /me/* controllers.
//
// "explain" MODE, DELIBERATELY. groundPortfolioHealth's explain scope drops [REFERENCE FINDINGS] — the PD
// family, which describes VYTAL's data coverage rather than the user's money — and with it the only
// clock-derived fields in the block (PD7's sync-age days). An explanation of someone's portfolio is not
// the place for our own gaps, and a stale "synced 3 days ago" is exactly the bug that scope exists to
// avoid. It is a strict prefix of the full block, so nothing about the book itself is lost.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { groundPortfolioHealth } from "../../ai/grounding.js";
import type { ChatTool, ToolResult } from "./types.js";

const DESCRIPTION =
  "Get the reader's OWN portfolio as Vytal computes it: the health read of the holdings Vytal scores, the " +
  "construction read (how concentrated or spread the book is), what share of it by value Vytal covers, the " +
  "list of companies held with their weights, and any portfolio findings. Call this whenever the reader asks " +
  "about 'my portfolio', 'my holdings', how their book looks, or how a stock they are discussing sits inside " +
  "it. Takes no arguments — it always reads the signed-in reader's own book and can never read anyone " +
  "else's. A reader with no holdings gets an honest empty state, which is a real answer, not an error. " +
  "For one stock's place in the book specifically, getStockRelationship is narrower and cheaper.";

const PARAMETERS = { type: "object", properties: {}, additionalProperties: false } as const;

export const getPortfolioFactsTool: ChatTool<Record<string, never>> = {
  name: "getPortfolioFacts",
  klass: "read",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(_args, ctx): Promise<ToolResult> {
    try {
      // ★ ctx.userId — never an argument. Always returns a grounding (an empty book yields an honest
      //   "no snapshot / no scored holdings" block rather than null).
      const grounding = await groundPortfolioHealth(ctx.userId, "explain");
      return { ok: true, content: grounding.factBlock };
    } catch (e) {
      return { ok: false, error: `Could not read the portfolio: ${(e as Error).message}` };
    }
  },
};
