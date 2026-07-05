// ─────────────────────────────────────────────────────────────
// /api/v1/me — alerts routes (per-user alert rules + fired-events log).
// Mounted behind requireAuth in app.ts alongside the onboarding / portfolio / watchlist
// meRouters (a FOURTH router on the same base path — all existing routers untouched).
// Every handler derives the owner from req.authUser (never the payload). This layer
// manages the RULES and serves the fired log; evaluation/firing is the daily pass
// (src/alerts/eval-pass.ts) and NOTHING here sends email.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import {
  createAlert,
  listAlerts,
  updateAlert,
  deleteAlert,
  listAlertEvents,
} from "../controllers/me/alerts-controller.js";

export const meAlertsRouter = Router();

// The fired-events log. Registered BEFORE the parametric routes so "/alerts/events" is
// never captured as an ":id" (defensive — the verbs differ anyway).
meAlertsRouter.get("/alerts/events", listAlertEvents);

// The user's alert rules. GET lists (?includeEvents=true embeds recent fires); POST creates
// (validates type↔operator↔target coherence + universe-gates the stock).
meAlertsRouter.get("/alerts", listAlerts);
meAlertsRouter.post("/alerts", createAlert);

// Edit / remove a rule. Owner-scoped (where { id, userId }); a non-owner or unknown id
// touches nothing → 404.
meAlertsRouter.patch("/alerts/:id", updateAlert);
meAlertsRouter.delete("/alerts/:id", deleteAlert);
