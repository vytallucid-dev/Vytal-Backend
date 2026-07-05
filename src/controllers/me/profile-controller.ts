// File: src/controllers/me/profile-controller.ts
// ═══════════════════════════════════════════════════════════════════════
// GET /api/v1/me/profile — the authenticated user's own identity + role.
//
// The single source of truth the FRONTEND uses to decide whether to show
// admin-only surfaces (the Admin Panel / Data hub). Role is NOT carried in
// the Supabase JWT — it lives in public.users.role and is resolved by the
// auth middleware into req.authUser. This endpoint simply hands that back so
// the client can gate UI without duplicating the DB lookup.
//
// SECURITY: the owner is always req.authUser (derived from the verified
// token), never the payload — no IDOR surface. Mounted behind requireAuth,
// so req.authUser is guaranteed present. This endpoint is advisory for the
// UI only; the backend still enforces admin on every /admin/* route via
// requireAdmin, so a tampered client can never actually reach admin data.
//
// Envelope: { success: true, data } — matching the other me/* read controllers.
// ═══════════════════════════════════════════════════════════════════════

import type { Request, Response } from "express";

export const getMyProfile = async (req: Request, res: Response) => {
  try {
    const { userId, email, role } = req.authUser!;
    return res.json({
      success: true,
      data: { userId, email, role, isAdmin: role === "admin" },
    });
  } catch (err) {
    console.error("[me/profile] read error:", err);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to read profile" });
  }
};
