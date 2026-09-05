// ─────────────────────────────────────────────────────────────
// MISS-LOG ADMIN ROUTE (T-0)
//
// Mount under /api/v1/admin/miss-log behind requireAdmin. ONE endpoint, GET only:
// "what are readers asking that has no family?" — the question §6.4 says decides
// what gets built next, and T-22 says re-orders the plan before each phase.
//
// No write route by design. Rows are evidence; an admin who could edit them is an
// admin who could edit the reason a family was built.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { getMissLog } from "../../controllers/admin/miss-log-controller.js";

export const missLogAdminRouter = Router();

missLogAdminRouter.get("/", getMissLog);
