// ═══════════════════════════════════════════════════════════════════════
// WATCHLIST — the authenticated user's own pinned research surface (req.authUser).
//
//   POST   /api/v1/me/watchlist            { stockId }  → add (idempotent on user+stock)
//   DELETE /api/v1/me/watchlist/:stockId                → remove (owner-scoped)
//   GET    /api/v1/me/watchlist                         → the RICH read-join list
//
// SECURITY: owner = req.authUser.userId (public.users.id), NEVER the payload — there is
// no userId input, so IDOR is structurally impossible. DELETE is scoped where
// { userId, stockId }: a non-owner deletes 0 rows → 404.
//
// The pinned_* baseline (health/band/price the moment it was pinned) is captured ONCE on
// add from the stock's CURRENT latest snapshot + price, and NEVER updated — a re-add is a
// no-op that returns the existing row (baseline preserved). Signals/change-detection are a
// later fast-follow; this phase only serves the baseline + the live read-join.
//
// ★ THE WRITES LIVE IN src/watchlist/service.ts (Stage 3, Phase A). This file is TRANSPORT
// for them: read the owner off req.authUser, hand the raw body down, turn the result into a
// response and a ServiceError into its status. The chat write tools call the same service
// functions directly, so the rules have exactly one home.
//
// Envelope: { success, data } / { success:false, error, … } — matches /me/portfolio.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { enrichWatchlist } from "./watchlist-enrich.js";
import {
  addToWatchlist as addToWatchlistSvc,
  removeFromWatchlist as removeFromWatchlistSvc,
} from "../../watchlist/service.js";
import { ServiceError, sendServiceError } from "../../lib/service-error.js";

const FavoriteBody = z.object({
  favorite: z.boolean(),
});

// ── POST /watchlist — add (idempotent) ─────────────────────────────────
export const addToWatchlist = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  try {
    const data = await addToWatchlistSvc(req.body, userId);
    // 201 on a true create, 200 on the idempotent re-add — the status the route has always used.
    return res.status(data.created ? 201 : 200).json({ success: true, data });
  } catch (e) {
    if (e instanceof ServiceError) return sendServiceError(res, e);
    console.error("[POST /me/watchlist]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to add to watchlist" });
  }
};

// ── DELETE /watchlist/:stockId — remove (owner-scoped) ──────────────────
export const removeFromWatchlist = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  try {
    const data = await removeFromWatchlistSvc({ stockId: String(req.params.stockId ?? "") }, userId);
    return res.json({ success: true, data });
  } catch (e) {
    if (e instanceof ServiceError) return sendServiceError(res, e);
    console.error("[DELETE /me/watchlist/:stockId]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to remove from watchlist" });
  }
};

// ── PATCH /watchlist/:stockId — toggle the favorite star (owner-scoped) ──
// The two-tier promotion: a MUTABLE flag (unlike the immutable pinned_* baseline).
// Scoped to { userId, stockId } so a non-owner (or an unpinned stock) updates 0 rows
// → 404. Returns the new flag; the frontend re-reads the enriched list on settle.
export const updateWatchlistFavorite = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const stockId = String(req.params.stockId ?? "");
  const parsed = FavoriteBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });
  }

  try {
    const result = await prisma.watchlist.updateMany({
      where: { userId, stockId },
      data: { favorite: parsed.data.favorite },
    });
    if (result.count === 0) {
      return res.status(404).json({ success: false, error: "not_found", message: "Not in your watchlist" });
    }
    return res.json({ success: true, data: { stockId, favorite: parsed.data.favorite } });
  } catch (e) {
    console.error("[PATCH /me/watchlist/:stockId]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to update watchlist" });
  }
};

// ── GET /watchlist — the rich read-join list ────────────────────────────
export const listWatchlist = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;

  try {
    const rows = await prisma.watchlist.findMany({
      where: { userId },
      orderBy: { addedAt: "desc" },
      select: {
        stockId: true,
        addedAt: true,
        favorite: true,
        pinnedHealth: true,
        pinnedBand: true,
        pinnedPrice: true,
        stock: {
          select: { symbol: true, name: true, industryType: true, sector: { select: { name: true } } },
        },
      },
    });

    const enriched = await enrichWatchlist(
      rows.map((r) => ({
        stockId: r.stockId,
        symbol: r.stock.symbol,
        name: r.stock.name,
        sector: r.stock.sector?.name ?? null,
        industryType: r.stock.industryType,
        addedAt: r.addedAt,
        favorite: r.favorite,
        pinnedHealth: r.pinnedHealth,
        pinnedBand: r.pinnedBand,
        pinnedPrice: r.pinnedPrice,
      })),
    );

    return res.json({ success: true, data: { watchlist: enriched, count: enriched.length } });
  } catch (e) {
    console.error("[GET /me/watchlist]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to load watchlist" });
  }
};
