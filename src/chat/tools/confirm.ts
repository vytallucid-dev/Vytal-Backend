// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WRITE TOOLS: confirmPendingAction / cancelPendingAction — the only two places a chat write executes.
//
// ── ★ WHY confirmPendingAction TAKES NO ARGUMENTS ──────────────────────────────────────────────────
// This is the load-bearing property of the whole design, and it is worth being blunt about. If the
// confirm call carried the values — even "just to be safe", even as a checksum — then a second
// generation would be producing the numbers that get written, and a single token of drift between
// "shall I record 40 shares?" and the confirm call would file a trade the reader never agreed to. Worse,
// the transcript would look correct, because a transcript records what the model SAID.
//
// So the parameter schema is EMPTY. There is no field in this call that could drift, because there is no
// field. Execution reads `proposal.args` — captured once at parse time, stored server-side, untouched by
// anything the model has said since. Correctness here is structural, not disciplinary.
//
// ── SINGLE USE ────────────────────────────────────────────────────────────────────────────────────
// The proposal is CONSUMED (atomically nulled and returned) BEFORE the service runs. Two confirms in one
// round → exactly one gets a proposal; the other is told there is nothing pending. A service failure
// after the consume does NOT re-arm it: the reader is told what went wrong and the model re-proposes.
// At-most-once is the correct bias when the write is a trade.
//
// ── OWNER SCOPING, TWICE ──────────────────────────────────────────────────────────────────────────
// The consume is scoped by (sessionId, userId) — ctx.userId comes from the verified JWT, never from the
// model — so a proposal stored in another reader's session is unreachable. Then the stored
// `proposal.userId` is asserted against ctx.userId as a second, independent check, and the write itself
// takes ctx.userId (never the stored one). A proposal cannot execute against a different user even if
// the row were somehow reached.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { consumeProposal, CHANGE_DOMAIN_BY_KIND, type PendingProposal, type ProposalKind } from "../proposals.js";
import { addToWatchlist, removeFromWatchlist } from "../../watchlist/service.js";
import { createAlert, deleteAlert } from "../../alerts/service.js";
import { createReminder } from "../../reminders/service.js";
import { addTransaction } from "../../portfolio/transactions-service.js";
import { addStatedMemory } from "../memory.js";
import { rupees } from "./write-shared.js";
import { ServiceError } from "../../lib/service-error.js";
import type { ChatTool, ToolResult } from "./types.js";

/** An executor runs ONE proposal kind against the real service and returns the receipt lines. */
type Executor = (args: Record<string, unknown>, userId: string) => Promise<string[]>;

/**
 * ★ THE DISPATCH TABLE. Every entry calls the SAME `service(input, userId)` the HTTP route calls — the
 * universe gate, the coherence rules, the oversell check and the FIFO replay all run here exactly as
 * they do for a request from the app. A chat write is not a privileged path; it is the same path.
 */
const EXECUTORS: Record<ProposalKind, Executor> = {
  // ★ EXECUTES FROM THE STORED PROPOSAL'S OWN `args`, never from what the model echoed back — the same
  //   guarantee every other write here has. The decline gate runs AGAIN inside addStatedMemory, so a
  //   proposal that somehow slipped past the propose-time check still cannot be written.
  async rememberThis(args, userId) {
    const r = await addStatedMemory(args, userId);
    // Two destinations, two receipts. A name receipt must NOT report a list count as though the name went
    // into the list — the model reads these lines back to the reader, so a wrong noun becomes a wrong claim.
    if (r.kind === "name") {
      return [
        `Stored the reader's form of address: ${r.name}`,
        `Address them as ${r.name} from now on, in this conversation and every later one. Tell them plainly that you will.`,
      ];
    }
    return [`Remembered: "${r.memory.text}"`, `Now holding ${r.total} remembered thing(s) for this reader.`];
  },
  async addToWatchlist(args, userId) {
    const r = await addToWatchlist(args, userId);
    return [
      r.created ? "Added to the reader's watchlist." : "It was already on the watchlist — nothing changed.",
      `Stock id: ${r.watchlist.stockId}`,
      `Health recorded at the moment of adding: ${r.watchlist.pinnedHealth ?? "not scored"}${r.watchlist.pinnedBand ? ` (${r.watchlist.pinnedBand})` : ""}`,
    ];
  },
  async removeFromWatchlist(args, userId) {
    await removeFromWatchlist(args, userId);
    return ["Removed from the reader's watchlist."];
  },
  async createAlert(args, userId) {
    const r = await createAlert(args, userId);
    const a = r.alert;
    const cond =
      a.thresholdPrice != null
        ? `price ${a.operator} ${rupees(a.thresholdPrice)}`
        : a.thresholdBand
          ? `health band ${a.operator} ${a.thresholdBand}`
          : a.findingKey
            ? `the finding "${a.findingKey}" fires`
            : "any new finding fires";
    return [
      `Alert created on ${a.symbol ?? "the stock"}.`,
      `Fires when: ${cond}`,
      `Repeats: ${a.repeatMode === "repeating" ? "yes" : "no — fires once"}`,
      "Checked once a day on end-of-day data.",
    ];
  },
  async deleteAlert(args, userId) {
    await deleteAlert(args, userId);
    return ["The alert has been deleted."];
  },
  async setEventReminder(args, userId) {
    const r = await createReminder(args, userId);
    const m = r.reminder;
    return [
      r.created ? `Reminder set on ${m.symbol ?? "the stock"}.` : `Existing reminder on ${m.symbol ?? "the stock"} updated.`,
      `Event: ${m.eventType} · reminds ${m.daysBefore} day${m.daysBefore === 1 ? "" : "s"} before`,
      `Next such event on file: ${m.nextEventDate ?? "none yet"}`,
      `Would remind on: ${m.remindDate ?? "not yet determinable"}`,
    ];
  },
  async recordTransaction(args, userId) {
    const r = await addTransaction(args, userId);
    const t = r.transaction;
    const h = r.holding as unknown as Record<string, unknown> | null;
    const lines = [
      `Recorded: ${t.type.toUpperCase()} ${t.quantity ?? ""} ${t.symbol}${t.price ? ` at ${rupees(Number(t.price))}` : ""} on ${t.tradeDate}.`.replace(/\s+/g, " "),
      `Fees recorded: ${t.fees != null ? rupees(Number(t.fees)) : "₹0.00"}`,
    ];
    // The resulting position — the number the reader will want to hear back. Rendered only from fields
    // the holding actually has; never invented.
    if (h && h.quantity !== undefined) lines.push(`Position now: ${String(h.quantity)} units held`);
    if (h && h.avgCost !== undefined && h.avgCost !== null) lines.push(`Average cost now: ${rupees(Number(h.avgCost))}`);
    if (h && h.realizedPnl !== undefined && h.realizedPnl !== null) lines.push(`Realized P&L on this instrument: ${rupees(Number(h.realizedPnl))}`);
    lines.push("The reader's cost basis and portfolio health have been recomputed.");
    return lines;
  },
};

// ── CONFIRM ─────────────────────────────────────────────────────────────────────────────────────────
const CONFIRM_DESCRIPTION =
  "Execute the change the reader just confirmed. Call this ONLY after you proposed a specific change and " +
  "the reader clearly agreed to it — \"yes\", \"go ahead\", \"do it\". Do NOT call it if they are asking a " +
  "question, changing a value, or saying anything you are not sure is agreement; if unclear, ask them " +
  "instead. " +
  "It takes NO arguments on purpose: the exact values you proposed are already held server-side and those " +
  "are what get written, so nothing you say here can alter them. There is no way to adjust a value at this " +
  "point — if the reader wants something different, call the original tool again with the new values to " +
  "propose it afresh. After this succeeds, tell the reader plainly what was done, using the result below.";

export const confirmPendingActionTool: ChatTool<Record<string, never>> = {
  name: "confirmPendingAction",
  klass: "write",
  description: CONFIRM_DESCRIPTION,
  parameters: { type: "object", properties: {}, additionalProperties: false } as unknown as Record<string, unknown>,
  async handler(_args, ctx): Promise<ToolResult> {
    // ★ Atomic single-use consume, owner-scoped. Consent is spent here, before anything is written.
    let proposal: PendingProposal | null;
    try {
      proposal = await consumeProposal(ctx.sessionId, ctx.userId);
    } catch (e) {
      return { ok: false, error: `Could not read the pending change: ${(e as Error).message}` };
    }

    if (!proposal) {
      return {
        ok: true,
        content:
          "NOTHING PENDING: there is no change awaiting confirmation, so nothing was written. This happens " +
          "when no change was proposed, when it was already confirmed, or when the conversation moved on " +
          "since. Do NOT claim anything was done. If the reader wants something changed, propose it fresh " +
          "with the appropriate tool.",
      };
    }

    // Second, independent owner check. The consume is already scoped by userId; this catches a stored
    // record that somehow disagrees, and refuses rather than writing to the wrong book.
    if (proposal.userId !== ctx.userId) {
      return { ok: false, error: "That pending change does not belong to this reader and was not executed." };
    }

    const exec = EXECUTORS[proposal.kind];
    if (!exec) return { ok: false, error: `Unknown pending change type "${proposal.kind}" — nothing was written.` };

    try {
      // ★ From the STORED args, and ctx.userId — never from anything the model said.
      const receipt = await exec(proposal.args, ctx.userId);
      // ★ Record WHAT CHANGED, only after the service actually returned. A failed write records
      //   nothing, so the client is never told to refetch on the strength of something that didn't
      //   happen. The controller reads this off the context once the turn ends.
      ctx.effects.add(CHANGE_DOMAIN_BY_KIND[proposal.kind]);
      return {
        ok: true,
        content: [
          "=== DONE — THIS HAS NOW BEEN WRITTEN ===",
          `Action: ${proposal.summary}`,
          ...receipt.map((l) => `  ${l}`),
          "",
          "Tell the reader plainly that this is done, using only the values above. Do not add a view on whether it was a good idea.",
        ].join("\n"),
      };
    } catch (e) {
      const why = e instanceof ServiceError ? e.message : (e as Error).message;
      return {
        ok: false,
        error:
          `The change could NOT be completed and nothing was written: ${why}. The pending confirmation has ` +
          `been cleared. Tell the reader exactly why it failed; if they still want it, propose it again ` +
          `with the corrected values.`,
      };
    }
  },
};

// ── CANCEL ──────────────────────────────────────────────────────────────────────────────────────────
const CANCEL_DESCRIPTION =
  "Discard the change you proposed, without writing anything. Call this when the reader declines, changes " +
  "their mind, or asks for something different instead. Takes no arguments. It is safe to call when " +
  "nothing is pending. You do not need this to keep a proposal from firing later — an unconfirmed proposal " +
  "expires on its own at the end of the turn — but calling it lets you tell the reader plainly that it was " +
  "dropped.";

export const cancelPendingActionTool: ChatTool<Record<string, never>> = {
  name: "cancelPendingAction",
  klass: "write",
  description: CANCEL_DESCRIPTION,
  parameters: { type: "object", properties: {}, additionalProperties: false } as unknown as Record<string, unknown>,
  async handler(_args, ctx): Promise<ToolResult> {
    try {
      const dropped = await consumeProposal(ctx.sessionId, ctx.userId);
      return {
        ok: true,
        content: dropped
          ? `CANCELLED: "${dropped.summary}" was discarded. Nothing was written and the reader's data is unchanged. Confirm to them that it was dropped.`
          : "NOTHING PENDING: there was no change awaiting confirmation, so nothing was cancelled and nothing was written.",
      };
    } catch (e) {
      return { ok: false, error: `Could not clear the pending change: ${(e as Error).message}` };
    }
  },
};
