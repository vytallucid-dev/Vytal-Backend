// ─────────────────────────────────────────────────────────────
// CASA STALENESS STATUS — ADMIN CONTROLLER
//
// GET /api/v1/admin/bank-supplementary/casa/status
//   The 12-bank CASA checklist for the current calendar quarter (Indian FY). Drives the
//   admin staleness table: which banks are on a real current quarter, which are still on
//   the legacy LIVE fallback (need a quarter injected), which are on neutral-60. Read-only,
//   INFORMATIONAL (report-timing varies by bank — not a violation).
// ─────────────────────────────────────────────────────────────

import type { Request, Response } from "express";
import { computeCasaStatus } from "../../ingestions/bank-supplementary/casa-status.js";

export const casaStatus = async (_req: Request, res: Response) => {
  try {
    const result = await computeCasaStatus();
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error("[bank-supplementary/casa/status] error:", err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
};
