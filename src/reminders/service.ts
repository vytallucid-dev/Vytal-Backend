// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// REMINDERS WRITE SERVICE — create/re-affirm, extracted from reminders-controller.ts UNCHANGED.
//
// THE SEAM: `service(input, userId)`. ★ userId is a PARAMETER, never part of `input` — supplied by the
// caller from an authenticated source (req.authUser.userId / ToolContext.userId), so IDOR stays
// structurally impossible.
//
// THE ONE RULE WORTH RESTATING: a reminder binds SEMANTICALLY by (userId, stockId, eventType) and that
// triple is UNIQUE. So "create" is really create-or-re-affirm — a repeat call updates daysBefore and
// re-activates rather than piling up duplicates, and it reports which happened via `created`. A chat
// tool asking twice therefore cannot spam the user's reminder list, and it gets told the difference
// instead of having to guess.
//
// Firing (the date match) is the daily eval pass (src/reminders/eval-pass.ts); nothing here sends email.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { z } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { failure, validationError } from "../lib/service-error.js";
import { REMINDER_EVENT_TYPES, resolveNextEvents, startOfUtcDay, nextEventKey, addUtcDays } from "./resolve.js";

// ── create input — the only fields at create time (no operator/threshold; it's date-based) ──────────
/**
 * ★ THE LEAD-TIME OPTIONS — the product offers exactly four, and this is where that lives.
 *
 * The frontend picker has always rendered `DAYS_BEFORE_PRESETS = [1, 2, 3, 7]` with no free-number
 * input (lib/reminders.ts). The service, meanwhile, accepted any integer 1–30, and the DB CHECK only
 * says `>= 1` — three layers, three different answers. That gap was harmless while the picker was the
 * only caller; it stopped being harmless the moment a chat tool could POST, because a 17-day reminder
 * is representable in the API, renders fine in a list, and then SNAPS to a valid preset the instant
 * the reader opens the edit popover. A value the UI cannot reproduce is a value we should not store.
 *
 * So the constraint moves here — one home, every caller (chat, the picker, any future surface) bound
 * by the same rule. Deliberately NOT enforced in SQL as well: the set is a product decision that will
 * change, and a CHECK constraint would need a migration each time.
 */
export const DAYS_BEFORE_OPTIONS = [1, 2, 3, 7] as const;

export const CreateReminderInput = z.object({
  stockId: z.string().trim().min(1),
  eventType: z.enum(REMINDER_EVENT_TYPES),
  // Lead time — one of the four the product offers. Never 0: a reminder never fires on the event day.
  daysBefore: z.coerce
    .number()
    .int()
    .refine((n) => (DAYS_BEFORE_OPTIONS as readonly number[]).includes(n), {
      message: `daysBefore must be one of ${DAYS_BEFORE_OPTIONS.join(", ")}`,
    })
    .default(1),
});

export const REMINDER_SELECT = {
  id: true,
  stockId: true,
  eventType: true,
  daysBefore: true,
  active: true,
  lastFiredAt: true,
  createdAt: true,
  updatedAt: true,
  stock: { select: { symbol: true, name: true } },
} satisfies Prisma.EventReminderSelect;

export type ReminderRow = Prisma.EventReminderGetPayload<{ select: typeof REMINDER_SELECT }>;

/** Serialize a reminder, optionally with its resolved nearest-upcoming event (so the UI can
 *  show "reminds 1 day before · earnings on 5 Aug"). nextEventDate is null when the stock has
 *  no upcoming event of that type. */
export function serializeReminder(r: ReminderRow, next?: { eventDate: Date } | null, today?: Date) {
  const nextEventDate = next ? next.eventDate.toISOString().slice(0, 10) : null;
  const nextEventDaysAway =
    next && today
      ? Math.round((startOfUtcDay(next.eventDate).getTime() - startOfUtcDay(today).getTime()) / 86_400_000)
      : null;
  return {
    id: r.id,
    stockId: r.stockId,
    symbol: r.stock?.symbol ?? null,
    name: r.stock?.name ?? null,
    eventType: r.eventType,
    daysBefore: r.daysBefore,
    active: r.active,
    lastFiredAt: r.lastFiredAt ? r.lastFiredAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    // resolved context (present on create + list)
    nextEventDate,
    nextEventDaysAway,
    // the concrete date we'd remind on, for this occurrence (null when no upcoming event)
    remindDate:
      next != null
        ? addUtcDays(startOfUtcDay(next.eventDate), -r.daysBefore).toISOString().slice(0, 10)
        : null,
  };
}

// ── CREATE (or re-affirm) ───────────────────────────────────────────────────────────────────────────
export interface CreateReminderResult {
  reminder: ReturnType<typeof serializeReminder>;
  /** false ⇒ the (stock, eventType) reminder already existed and was re-affirmed; caller returns 200. */
  created: boolean;
}

export async function createReminder(input: unknown, userId: string): Promise<CreateReminderResult> {
  const parsed = CreateReminderInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, parsed.error.flatten());
  const v = parsed.data;

  // Universe gate: the stockId must resolve to a real stock (the tracked universe).
  const stock = await prisma.stock.findUnique({ where: { id: v.stockId }, select: { id: true } });
  if (!stock) throw failure(400, "stock_not_found", "Not a stock in the universe");

  // Semantic bind is unique per (user, stock, eventType). A repeat call re-affirms the reminder
  // (updates daysBefore + re-activates) rather than creating a duplicate.
  const existing = await prisma.eventReminder.findUnique({
    where: { event_reminder_unique: { userId, stockId: v.stockId, eventType: v.eventType } },
    select: { id: true },
  });

  const reminder = existing
    ? await prisma.eventReminder.update({
        where: { id: existing.id },
        data: { daysBefore: v.daysBefore, active: true },
        select: REMINDER_SELECT,
      })
    : await prisma.eventReminder.create({
        data: { userId, stockId: v.stockId, eventType: v.eventType, daysBefore: v.daysBefore },
        select: REMINDER_SELECT,
      });

  // Resolve the nearest upcoming occurrence for the response.
  const today = startOfUtcDay(new Date());
  const nextMap = await resolveNextEvents([{ stockId: v.stockId, eventType: v.eventType }], today);
  const next = nextMap.get(nextEventKey(v.stockId, v.eventType)) ?? null;

  return { reminder: serializeReminder(reminder, next, today), created: !existing };
}
