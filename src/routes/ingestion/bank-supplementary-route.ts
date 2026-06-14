// ─────────────────────────────────────────────────────────────
// BANK SUPPLEMENTARY — ADMIN ROUTES
//
// Mount under /api/v1/admin/bank-supplementary (see app.ts).
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { uploadBankSupplementary } from "../../controllers/ingestion/bank-supplementary-controller.js";

export const adminBankSupplementaryRouter = Router();

// POST /api/v1/admin/bank-supplementary
// Upload a single JSON payload of manual banking figures (CASA / Tier-1).
adminBankSupplementaryRouter.post("/", uploadBankSupplementary);
