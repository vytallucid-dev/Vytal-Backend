// ─────────────────────────────────────────────────────────────
// /api/v1/me — event-reminder routes (per-user date-triggered reminders).
// Mounted behind requireAuth in app.ts alongside the onboarding / portfolio / watchlist /
// alerts meRouters (a FIFTH router on the same base path — all existing routers untouched).
// Every handler derives the owner from req.authUser (never the payload). This layer manages
// the reminder RULES; firing (the date match) is the daily eval pass
// (src/reminders/eval-pass.ts) and delivery reuses the alerts email pipeline.
// Lifecycle is deliberately simpler than alerts: create · list · pause/resume · delete.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import {
  createReminder,
  listReminders,
  updateReminder,
  deleteReminder,
} from "../controllers/me/reminders-controller.js";

export const meRemindersRouter = Router();

// The user's reminders. GET lists (with each reminder's resolved next event); POST creates
// or re-affirms (universe-gates the stock; one per stock+eventType).
meRemindersRouter.get("/reminders", listReminders);
meRemindersRouter.post("/reminders", createReminder);

// Pause/resume (PATCH { active }) / remove. Owner-scoped (where { id, userId }); a non-owner
// or unknown id touches nothing → 404.
meRemindersRouter.patch("/reminders/:id", updateReminder);
meRemindersRouter.delete("/reminders/:id", deleteReminder);
