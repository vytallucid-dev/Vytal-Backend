// File: src/routes/catalogue-route.ts
// ─────────────────────────────────────────────────────────────
// GET /api/v1/catalogue — the product's static copy catalogue.
// Read API for every surface that renders a finding's name, description or interpretive boundary.
// Public, no auth. Mirrors results-route.ts: a router, static paths before the param path.
//
// ⚠ NO AUTH GUARD, DELIBERATELY. The body is static product vocabulary — the words already printed on
// every public stock page. There is nothing per-user, per-stock or calibrated in it, so there is
// nothing for a guard to protect; adding one would only mean the anonymous stock page could not
// render its own copy.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import {
  getCatalogue,
  getCatalogueNames,
  getCatalogueRegistry,
} from "../controllers/catalogue-controller.js";

export const catalogueRouter = Router();

// Static "/" (the full document) and "/names" (the alert-picker projection) BEFORE the "/:registry"
// param route — otherwise "names" resolves as a registry id and 404s.
catalogueRouter.get("/", getCatalogue);
catalogueRouter.get("/names", getCatalogueNames);
catalogueRouter.get("/:registry", getCatalogueRegistry);
