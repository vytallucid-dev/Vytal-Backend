// ═══════════════════════════════════════════════════════════════════════
// PART A READ — the authenticated user's daily PHS series ("PHS over time" graph).
//
//   GET /api/v1/me/score-history   date-ASCENDING stored rows for the chart
//
// PURE READ over portfolio_score_history. A GET NEVER computes or persists — it serves
// exactly the rows the write path (the …Tracked wrapper, on each EOD/transaction compute)
// has stored. There is no cron and no recompute here; a day with no dot simply had no
// compute that day.
//
// Owner = req.authUser.userId (never the payload) — IDOR-proof, no id input.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";

export const getScoreHistory = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  try {
    const rows = await prisma.portfolioScoreHistory.findMany({
      where: { userId },
      orderBy: { date: "asc" }, // date-ascending for the graph
      select: { date: true, phs: true, quality: true, signals: true, structure: true, coverage: true },
    });
    return res.json({
      success: true,
      data: {
        series: rows.map((r) => ({
          date: r.date.toISOString().slice(0, 10), // YYYY-MM-DD (the @db.Date, date-only)
          phs: r.phs,
          quality: r.quality,
          signals: r.signals,
          // Construction Net — null on every row written before this column existed
          // (forward-only; never backfilled). See schema.prisma / score-history.ts.
          structure: r.structure,
          coverage: r.coverage == null ? null : Number(r.coverage),
        })),
      },
    });
  } catch (e) {
    console.error("[GET /me/score-history]", e);
    return res
      .status(500)
      .json({ success: false, error: "server_error", message: "Failed to load score history" });
  }
};
