// ─────────────────────────────────────────────────────────────
// THE INSTRUMENT LANES' ROUTES — REIT/InvIT, government paper, corporate debt.
//
// Three admin routers, one per PIPELINE CARD, mounted behind requireAdmin in app.ts:
//   POST /api/v1/admin/reits/trigger
//   POST /api/v1/admin/govt-securities/trigger
//   POST /api/v1/admin/corporate-bonds/trigger
//
// Separate routers rather than one shared router with three paths, because each corresponds to a
// separate admin CARD (/admin/<key>) and a separate failure domain. The routing mirrors the way an
// operator actually thinks about them: three pipelines, not one pipeline with three buttons.
//
// No read routes here. These lanes write to `instruments` / `instrument_prices`, which the portfolio
// and catalogue surfaces already read through their own endpoints — a pipeline does not need a
// bespoke reader just to be triggerable. RUN HISTORY comes from GET /api/v1/admin/jobs?type=<type>,
// which is the honest source (the actual background_jobs rows) rather than a parallel log table
// that could disagree with them.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import {
  triggerReitIngest,
  triggerGovtSecuritiesIngest,
  triggerCorporateBondsIngest,
} from "../../controllers/ingestion/instrument-lanes-controllers.js";

export const adminReitsRouter = Router();
export const adminGovtSecuritiesRouter = Router();
export const adminCorporateBondsRouter = Router();

adminReitsRouter.post("/trigger", triggerReitIngest);
adminGovtSecuritiesRouter.post("/trigger", triggerGovtSecuritiesIngest);
adminCorporateBondsRouter.post("/trigger", triggerCorporateBondsIngest);
