// ─────────────────────────────────────────────────────────────
// /api/v1/me/ask — the composition path, mounted behind requireAuth beside the other `me` routers.
//
// ★ ONE ENDPOINT, NO SESSION STATE. A turn is a pure function of the question and the reader: route,
//   resolve, compose. Transcript persistence is a separate concern with its own routes, and keeping
//   them apart is why the answer path can be re-run, replayed and diffed without touching a session.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { ask } from "../controllers/me/ask-controller.js";

export const meAskRouter = Router();

meAskRouter.post("/ask", ask);
