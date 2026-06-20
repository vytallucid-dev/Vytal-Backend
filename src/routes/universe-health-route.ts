// File: src/routes/universe-health-route.ts
//
// GET /api/universe/health — universe-level scoring aggregate.
// Mounted at /api/universe (no v1) to match the read-API convention
// used by /api/stocks and /api/peer-groups.

import { Router } from "express";
import { getUniverseHealth } from "../controllers/universe-health-controller.js";

export const universeHealthRouter = Router();

universeHealthRouter.get("/health", getUniverseHealth);
