// ─────────────────────────────────────────────────────────────
// BANK SUPPLEMENTARY — ADMIN ROUTES
//
// Mount under /api/v1/admin/bank-supplementary (see app.ts).
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { uploadBankSupplementary } from "../../controllers/ingestion/bank-supplementary-controller.js";
import { injectCasa } from "../../controllers/ingestion/casa-injection-controller.js";

export const adminBankSupplementaryRouter = Router();

// POST /api/v1/admin/bank-supplementary
// Upload a single JSON payload of manual banking figures (CASA / Tier-1).
adminBankSupplementaryRouter.post("/", uploadBankSupplementary);

// POST /api/v1/admin/bank-supplementary/casa
// Inject ONE live CASA value (CASA-only; CN-4 citation + unit-band enforced; append-only
// supersede). The new CASA flows into the bank's F7 on the next live banking score.
adminBankSupplementaryRouter.post("/casa", injectCasa);
