// ─────────────────────────────────────────────────────────────
// /api/v1/me — AI surfaces. Mounted behind requireAuth in app.ts alongside the other me-routers
// (a SEVENTH router on the same base path; the existing six are untouched).
//
//   POST /api/v1/me/stocks/:symbol/explanation   — grounded, non-advisory explanation of a
//                                                  stock's health, in the reader's own tone
//
// Every AI surface belongs here rather than on the public /api/stocks router: generation is
// tone-personalised (needs an identity) and metered (needs an owner to attribute spend to).
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { postStockExplanation } from "../controllers/me/ai-explanation-controller.js";

export const meAiRouter = Router();

meAiRouter.post("/stocks/:symbol/explanation", postStockExplanation);
