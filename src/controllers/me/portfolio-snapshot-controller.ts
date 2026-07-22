// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO HEALTH SNAPSHOT — the authenticated user's pre-computed PHS read.
//
//   GET /api/v1/me/portfolio     the latest Portfolio Health Score snapshot
//
// Thin HTTP shell: derive the owner from req.authUser (IDOR-proof — never the payload), call
// the read-assembly seam, and wrap the result in the { success, data } envelope. All read logic
// — the latest-snapshot read, the two-read regroup, the read-time findings, the disclosure — now
// lives in src/portfolio/phs/portfolio-health-view.ts so a future AI grounding layer can read
// EXACTLY what this endpoint serves. PURE READ: a GET never computes or persists (A.12).
//
// The reshape/types/FINDING_HOME that used to live here moved with the logic; they are RE-EXPORTED
// below so existing importers (verify scripts) keep resolving them from this path unchanged.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { buildPortfolioHealthView } from "../../portfolio/phs/portfolio-health-view.js";

// ── Backward-compat re-exports (the read model moved to portfolio-health-view.ts) ──
export { reshapeSnapshot, constructionBandOf, buildPortfolioHealthView } from "../../portfolio/phs/portfolio-health-view.js";
export type {
  SnapshotReadInput,
  HeadlineSlot,
  CoverageState,
  ConstructionRead,
  HealthRead,
  PortfolioReads,
  ReshapeCounts,
  ConstructionBand,
  PortfolioHealthView,
} from "../../portfolio/phs/portfolio-health-view.js";

export const getPortfolioSnapshot = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;

  try {
    const data = await buildPortfolioHealthView(userId);
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[GET /me/portfolio]", e);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to load portfolio health" });
  }
};
