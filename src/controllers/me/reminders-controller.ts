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
//
// ★ CREATE LIVES IN src/reminders/service.ts (Stage 3, Phase A), with the shared
// REMINDER_SELECT/serializeReminder shape. This file is TRANSPORT for it and still owns
// list/patch/delete. The chat setEventReminder tool calls the same service function.
//
// Envelope: { success, data } / { success:false, error, … } — matches the other /me/*.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { resolveNextEvents, startOfUtcDay, nextEventKey } from "../../reminders/resolve.js";
import {
  REMINDER_SELECT,
  serializeReminder,
  createReminder as createReminderSvc,
} from "../../reminders/service.js";
import { ServiceError, sendServiceError } from "../../lib/service-error.js";

// ── PATCH body — pause/resume ONLY (the whole edit surface). ──
const PatchBody = z
  .object({ active: z.boolean() })
  .strict();

// ── POST /reminders — create or re-affirm a reminder ────────────────────
export const createReminder = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  try {
    const data = await createReminderSvc(req.body, userId);
    // 201 on a true create, 200 on the re-affirm — the status the route has always used.
    return res.status(data.created ? 201 : 200).json({ success: true, data });
  } catch (e) {
    if (e instanceof ServiceError) return sendServiceError(res, e);
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
