// ═══════════════════════════════════════════════════════════════════════
// EVENT REMINDERS — the authenticated user's own reminder rules (req.authUser).
//
//   POST   /api/v1/me/reminders          { stockId, eventType, daysBefore? } → create/affirm
//   GET    /api/v1/me/reminders                                              → list the rules
//   PATCH  /api/v1/me/reminders/:id      { active }                          → pause / resume
//   DELETE /api/v1/me/reminders/:id                                          → remove
//
// The date-triggered SIBLING of alerts (alerts-controller.ts) — same security shape, SIMPLER
// lifecycle. SECURITY: owner = req.authUser.userId (NEVER the payload) → IDOR is structurally
// impossible; mutations are owner-scoped (where { id, userId }); a non-owner touches 0 rows
// → 404. Universe-gated on create. A reminder binds SEMANTICALLY by (stockId, eventType), so
// there is exactly one per pair per user (unique) — a repeat POST re-affirms it (idempotent),
// it does not pile up duplicates.
//
// PATCH is pause/resume ONLY (active) — there is no threshold to edit. Firing (the date
// match) is the daily eval pass (src/reminders/eval-pass.ts); nothing here sends email.
// Envelope: { success, data } / { success:false, error, … } — matches the other /me/*.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import {
  REMINDER_EVENT_TYPES,
  resolveNextEvents,
  startOfUtcDay,
  nextEventKey,
  addUtcDays,
} from "../../reminders/resolve.js";

// ── create body — the only fields at create time (no operator/threshold; it's date-based) ──
const CreateBody = z.object({
  stockId: z.string().trim().min(1),
  eventType: z.enum(REMINDER_EVENT_TYPES),
  // Lead time; >= 1 (never on the event day). Default 1. Capped at a sane 30.
  daysBefore: z.coerce.number().int().min(1).max(30).default(1),
});

// ── PATCH body — pause/resume ONLY (the whole edit surface). ──
const PatchBody = z
  .object({ active: z.boolean() })
  .strict();

const REMINDER_SELECT = {
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

type ReminderRow = Prisma.EventReminderGetPayload<{ select: typeof REMINDER_SELECT }>;

/** Serialize a reminder, optionally with its resolved nearest-upcoming event (so the UI can
 *  show "reminds 1 day before · earnings on 5 Aug"). nextEventDate is null when the stock has
 *  no upcoming event of that type. */
function serializeReminder(
  r: ReminderRow,
  next?: { eventDate: Date } | null,
  today?: Date,
) {
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

// ── POST /reminders — create or re-affirm a reminder ────────────────────
export const createReminder = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten() });
  }
  const v = parsed.data;

  try {
    // Universe gate: the stockId must resolve to a real stock (the tracked universe).
    const stock = await prisma.stock.findUnique({ where: { id: v.stockId }, select: { id: true } });
    if (!stock) {
      return res.status(400).json({ success: false, error: "stock_not_found", message: "Not a stock in the universe" });
    }

    // Semantic bind is unique per (user, stock, eventType). A repeat POST re-affirms the
    // reminder (updates daysBefore + re-activates) rather than creating a duplicate.
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

    return res.status(existing ? 200 : 201).json({
      success: true,
      data: { reminder: serializeReminder(reminder, next, today), created: !existing },
    });
  } catch (e) {
    console.error("[POST /me/reminders]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to create reminder" });
  }
};

// ── GET /reminders — list the user's reminders (+ resolved next event) ──
export const listReminders = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  try {
    const reminders = await prisma.eventReminder.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: REMINDER_SELECT,
    });

    const today = startOfUtcDay(new Date());
    const nextMap = await resolveNextEvents(
      reminders.map((r) => ({ stockId: r.stockId, eventType: r.eventType })),
      today,
    );

    const out = reminders.map((r) =>
      serializeReminder(r, nextMap.get(nextEventKey(r.stockId, r.eventType)) ?? null, today),
    );
    return res.json({ success: true, data: { reminders: out, count: out.length } });
  } catch (e) {
    console.error("[GET /me/reminders]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to load reminders" });
  }
};

// ── PATCH /reminders/:id — pause / resume (owner-scoped) ────────────────
export const updateReminder = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id ?? "");
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten() });
  }

  try {
    // Owner-scoped: a non-owner (or unknown id) updates 0 rows → 404.
    const result = await prisma.eventReminder.updateMany({
      where: { id, userId },
      data: { active: parsed.data.active },
    });
    if (result.count === 0) {
      return res.status(404).json({ success: false, error: "not_found", message: "Not your reminder" });
    }

    const reminder = await prisma.eventReminder.findUnique({ where: { id }, select: REMINDER_SELECT });
    const today = startOfUtcDay(new Date());
    const nextMap = reminder
      ? await resolveNextEvents([{ stockId: reminder.stockId, eventType: reminder.eventType }], today)
      : new Map();
    const next = reminder ? nextMap.get(nextEventKey(reminder.stockId, reminder.eventType)) ?? null : null;

    return res.json({ success: true, data: { reminder: reminder ? serializeReminder(reminder, next, today) : null } });
  } catch (e) {
    console.error("[PATCH /me/reminders/:id]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to update reminder" });
  }
};

// ── DELETE /reminders/:id — remove (owner-scoped) ───────────────────────
export const deleteReminder = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const id = String(req.params.id ?? "");
  try {
    // Scoped to the owner: a non-owner (or unknown id) deletes 0 rows → 404. The reminder's
    // fired events cascade with it (event_reminder_events.reminder_id FK ON DELETE CASCADE).
    const result = await prisma.eventReminder.deleteMany({ where: { id, userId } });
    if (result.count === 0) {
      return res.status(404).json({ success: false, error: "not_found", message: "Not your reminder" });
    }
    return res.json({ success: true, data: { removed: true, id } });
  } catch (e) {
    console.error("[DELETE /me/reminders/:id]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to delete reminder" });
  }
};
