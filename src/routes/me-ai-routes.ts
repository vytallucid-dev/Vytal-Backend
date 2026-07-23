// ─────────────────────────────────────────────────────────────
// /api/v1/me — AI surfaces. Mounted behind requireAuth in app.ts alongside the other me-routers
// (a SEVENTH router on the same base path; the existing six are untouched).
//
//   POST /api/v1/me/stocks/:symbol/explanation   — grounded, non-advisory PROSE explanation of a
//                                                  stock's health, in the reader's own tone
//   POST /api/v1/me/stocks/:symbol/insight        — the STRUCTURED-JSON sibling of the above: the same
//                                                  grounding, returned as a fixed insight shape
//                                                  (headline/drivers/tension + verbatim citations)
//   POST /api/v1/me/portfolio/explanation        — the prose explanation for the caller's OWN book. No
//                                                  path param: the subject is req.authUser.userId.
//
// Every AI surface belongs here rather than on the public /api/stocks router: generation is
// tone-personalised (needs an identity) and metered (needs an owner to attribute spend to).
//
// ⚠ NO COLLISION WITH mePortfolioRouter, which is mounted on the SAME /api/v1/me base path. Its
// portfolio routes are all GET (/portfolio, /portfolio/nav, /portfolio/twr, /portfolio/xirr,
// /portfolio/benchmark); this is a POST, so Express never has to choose between them.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { postStockExplanation, postPortfolioExplanation, postStockInsight } from "../controllers/me/ai-explanation-controller.js";

export const meAiRouter = Router();

meAiRouter.post("/stocks/:symbol/explanation", postStockExplanation);
meAiRouter.post("/portfolio/explanation", postPortfolioExplanation);
// The STRUCTURED-JSON sibling of the stock explanation — same subject, same auth, a POST for the same
// spend reason. No collision: distinct path segment (/insight vs /explanation) on the same me-router.
meAiRouter.post("/stocks/:symbol/insight", postStockInsight);
