// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WRITE TOOL: setEventReminder — the date-triggered sibling of an alert.
//
// Parses through `CreateReminderInput` (the alerts/reminders services' own schemas are the single home
// for their rules), so the event-type list and the 1–30 day lead-time bound reach the model as the same
// sentences the HTTP route produces.
//
// ★ THE RE-AFFIRM CASE IS SHOWN IN THE PROPOSAL, NOT HIDDEN. A reminder binds semantically by
// (stock, eventType) and that pair is unique per reader, so asking twice UPDATES rather than duplicates.
// The reader deserves to know which of the two they are consenting to — "you already have this, set to 3
// days; this changes it to 7" is a materially different act from creating one. So the tool looks the
// existing row up and says so in the enumerated fields.
//
// The resolved next occurrence is enumerated too, because "remind me before the results" means nothing
// until you know there is a date on file and what it is. When there is none, that is stated as a real
// state — the reminder still binds and will fire when a date appears.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { CreateReminderInput } from "../../reminders/service.js";
import { REMINDER_EVENT_TYPES, resolveNextEvents, nextEventKey, startOfUtcDay, addUtcDays } from "../../reminders/resolve.js";
import { resolveStock, str, propose } from "./write-shared.js";
import type { ProposalField } from "./write-shared.js";
import { zodMessage } from "../../lib/service-error.js";
import { BARE_TICKER_DIRECT } from "./shared.js";
import type { ChatTool, ToolResult } from "./types.js";

interface Args {
  symbol?: unknown;
  eventType?: unknown;
  daysBefore?: unknown;
}

const DESCRIPTION =
  "Propose setting a reminder for an upcoming corporate event on one covered stock — earnings, dividend, " +
  "AGM, board meeting, bonus, split, rights, buyback, or record date. daysBefore is the lead time and must be " +
  "one of exactly FOUR values — 1, 2, 3 or 7 (default 1). Those are the only options the app offers, so do not " +
  "propose 5 or 14: pick the nearest of the four and say which you picked, or ask the reader. Reminders never " +
  "fire on the event day itself. A reader can have only ONE reminder per " +
  "stock per event type, so setting one where a reminder already exists CHANGES the existing lead time " +
  "rather than adding a second — the proposal says which of the two is happening. " +
  "THIS DOES NOT SET THE REMINDER — it returns a proposal describing exactly what would be set. You MUST " +
  "state every value back to the reader and ask them to confirm; never reply as though the reminder is " +
  "already in place. Only after they say yes do you call confirmPendingAction. Owner-scoped to the " +
  "signed-in reader." +
  BARE_TICKER_DIRECT;

const PARAMETERS = {
  type: "object",
  properties: {
    symbol: { type: "string", description: 'NSE ticker of a Vytal-covered stock, e.g. "HDFCBANK".' },
    eventType: { type: "string", enum: [...REMINDER_EVENT_TYPES], description: "Which kind of corporate event to be reminded about." },
    daysBefore: { type: "integer", enum: [1, 2, 3, 7], description: "Lead time in days — one of 1, 2, 3 or 7 ONLY. Defaults to 1. Never 0 — a reminder never fires on the event day." },
  },
  required: ["symbol", "eventType"],
  additionalProperties: false,
} as const;

export const setEventReminderTool: ChatTool<Args> = {
  name: "setEventReminder",
  klass: "write",
  description: DESCRIPTION,
  parameters: PARAMETERS as unknown as Record<string, unknown>,
  async handler(args, ctx): Promise<ToolResult> {
    const resolved = await resolveStock(str(args.symbol));
    if ("boundary" in resolved) return resolved.boundary;

    // ★ THE SERVICE'S OWN SCHEMA — event-type enum and the 1–30 bound, not re-declared here.
    const parsed = CreateReminderInput.safeParse({
      stockId: resolved.id,
      eventType: args.eventType,
      ...(args.daysBefore !== undefined ? { daysBefore: args.daysBefore } : {}),
    });
    if (!parsed.success) {
      return {
        ok: false,
        error:
          `That reminder is not valid: ${zodMessage(parsed.error)}. Tell the reader what is wrong and ask ` +
          `them for it — do not guess, and do not claim the reminder was set.`,
      };
    }
    const v = parsed.data;

    // Re-affirm or create? The reader is consenting to a different act in each case.
    const existing = await prisma.eventReminder.findUnique({
      where: { event_reminder_unique: { userId: ctx.userId, stockId: v.stockId, eventType: v.eventType } },
      select: { daysBefore: true, active: true },
    });

    // The nearest upcoming occurrence — the same resolver the route uses for its response.
    const today = startOfUtcDay(new Date());
    const nextMap = await resolveNextEvents([{ stockId: v.stockId, eventType: v.eventType }], today);
    const next = nextMap.get(nextEventKey(v.stockId, v.eventType)) ?? null;

    const fields: ProposalField[] = [
      { label: "Stock", value: `${resolved.symbol} — ${resolved.name}` },
      { label: "Event", value: v.eventType },
      { label: "Reminds", value: `${v.daysBefore} day${v.daysBefore === 1 ? "" : "s"} before the event` },
      {
        label: "Next such event on file",
        value: next ? next.eventDate.toISOString().slice(0, 10) : "none on file yet — the reminder still binds and will fire when a date is published",
      },
      {
        label: "Would remind on",
        value: next ? addUtcDays(startOfUtcDay(next.eventDate), -v.daysBefore).toISOString().slice(0, 10) : "not yet determinable",
      },
      {
        label: "This is",
        value: existing
          ? `a CHANGE to an existing reminder (currently ${existing.daysBefore} day${existing.daysBefore === 1 ? "" : "s"} before${existing.active ? "" : ", paused"})`
          : "a new reminder",
      },
    ];

    return propose(ctx, {
      kind: "setEventReminder",
      summary: `${existing ? "Change" : "Set"} the ${v.eventType} reminder on ${resolved.symbol}`,
      fields,
      args: v as unknown as Record<string, unknown>,
    });
  },
};
