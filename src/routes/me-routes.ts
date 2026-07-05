// File: src/routes/me-routes.ts
// ─────────────────────────────────────────────────────────────
// /api/v1/me — the authenticated user's own onboarding.
// Mounted behind requireAuth in app.ts, so every handler can rely on
// req.authUser (the owner is derived from the token, never the payload).
//
// Each write route touches exactly ONE store — the separation is enforced
// by having distinct endpoints, not by a mode flag on one endpoint.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import {
  getMyOnboarding,
  patchMyLedger,
  patchMyRegister,
  patchMyOnboardingProgress,
  completeMyOnboarding,
} from "../controllers/me/onboarding-controller.js";
import { getMyProfile } from "../controllers/me/profile-controller.js";

export const meRouter = Router();

// Identity + role — the client reads this to gate admin-only UI. The backend
// still enforces admin on every /admin/* route independently (requireAdmin).
meRouter.get("/profile", getMyProfile);

// Status + resume read (all three stores).
meRouter.get("/onboarding", getMyOnboarding);

// Focused, single-store writes.
meRouter.patch("/ledger", patchMyLedger); // → user_ledger
meRouter.patch("/register", patchMyRegister); // → user_register
meRouter.patch("/onboarding/progress", patchMyOnboardingProgress); // → user_onboarding_meta (progress)
meRouter.post("/onboarding/complete", completeMyOnboarding); // → user_onboarding_meta (completion)
