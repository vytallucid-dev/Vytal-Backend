// ─────────────────────────────────────────────────────────────
// BANK SUPPLEMENTARY — ADMIN ROUTES
//
// Mount under /api/v1/admin/bank-supplementary (see app.ts).
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { uploadBankSupplementary } from "../../controllers/ingestion/bank-supplementary-controller.js";
import { injectCasa } from "../../controllers/ingestion/casa-injection-controller.js";
import { casaStatus } from "../../controllers/ingestion/casa-status-controller.js";

export const adminBankSupplementaryRouter = Router();

// POST /api/v1/admin/bank-supplementary
// Upload a single JSON payload of manual banking figures (CASA / Tier-1).
adminBankSupplementaryRouter.post("/", uploadBankSupplementary);

// POST /api/v1/admin/bank-supplementary/casa
// Inject ONE quarterly CASA value (CASA-only; CN-4 citation + unit-band + quarter enforced;
// append-only supersede per FY/quarter). Flows into the bank's F7 as the newest quarter.
adminBankSupplementaryRouter.post("/casa", injectCasa);

// GET /api/v1/admin/bank-supplementary/casa/status
// The 12-bank CASA staleness checklist for the current calendar quarter (admin table).
adminBankSupplementaryRouter.get("/casa/status", casaStatus);
