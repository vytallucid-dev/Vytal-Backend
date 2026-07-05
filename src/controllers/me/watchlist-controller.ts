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
// Envelope: { success, data } / { success:false, error, … } — matches /me/portfolio.
// ═══════════════════════════════════════════════════════════════════════
import type { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import { enrichWatchlist } from "./watchlist-enrich.js";

const AddBody = z.object({
  stockId: z.string().trim().min(1),
});

const FavoriteBody = z.object({
  favorite: z.boolean(),
});

/** The minimal add-response shape (the pinned baseline just written / already present). */
function serializePin(w: {
  stockId: string;
  addedAt: Date;
  pinnedHealth: number | null;
  pinnedBand: string | null;
  pinnedPrice: Prisma.Decimal | null;
}) {
  return {
    stockId: w.stockId,
    addedAt: w.addedAt.toISOString(),
    pinnedHealth: w.pinnedHealth,
    pinnedBand: w.pinnedBand,
    pinnedPrice: w.pinnedPrice != null ? w.pinnedPrice.toString() : null,
  };
}

// ── POST /watchlist — add (idempotent) ─────────────────────────────────
export const addToWatchlist = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const parsed = AddBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "validation_error", details: parsed.error.flatten().fieldErrors });
  }
  const { stockId } = parsed.data;

  try {
    // Universe gate: the stockId must resolve to a real stock (the 505-stock universe).
    const stock = await prisma.stock.findUnique({ where: { id: stockId }, select: { id: true } });
    if (!stock) {
      return res.status(400).json({ success: false, error: "stock_not_found", message: "Not a stock in the universe" });
    }

    // Idempotent: an existing pin is returned as-is — the baseline is NEVER overwritten.
    const existing = await prisma.watchlist.findUnique({
      where: { userId_stockId: { userId, stockId } },
      select: { stockId: true, addedAt: true, pinnedHealth: true, pinnedBand: true, pinnedPrice: true },
    });
    if (existing) {
      return res.json({ success: true, data: { watchlist: serializePin(existing), created: false } });
    }

    // Capture the pin-time baseline from the CURRENT latest snapshot + latest price.
    const [snap, price] = await Promise.all([
      prisma.scoreSnapshot.findFirst({
        where: { stockId },
        orderBy: [{ asOfDate: "desc" }, { version: "desc" }],
        select: { composite: true, labelBand: true },
      }),
      prisma.stockPrice.findUnique({ where: { stockId }, select: { price: true } }),
    ]);

    const data = {
      userId,
      stockId,
      pinnedHealth: snap ? Math.round(Number(snap.composite)) : null,
      pinnedBand: snap ? snap.labelBand : null,
      pinnedPrice: price ? price.price : null,
    };

    try {
      const created = await prisma.watchlist.create({
        data,
        select: { stockId: true, addedAt: true, pinnedHealth: true, pinnedBand: true, pinnedPrice: true },
      });
      return res.status(201).json({ success: true, data: { watchlist: serializePin(created), created: true } });
    } catch (e) {
      // Lost an add race for the same (user, stock) → the other insert won; honor idempotency.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const row = await prisma.watchlist.findUnique({
          where: { userId_stockId: { userId, stockId } },
          select: { stockId: true, addedAt: true, pinnedHealth: true, pinnedBand: true, pinnedPrice: true },
        });
        if (row) return res.json({ success: true, data: { watchlist: serializePin(row), created: false } });
      }
      throw e;
    }
  } catch (e) {
    console.error("[POST /me/watchlist]", e);
    return res.status(500).json({ success: false, error: "server_error", message: "Failed to add to watchlist" });
  }
};

// ── DELETE /watchlist/:stockId — remove (owner-scoped) ──────────────────
export const removeFromWatchlist = async (req: Request, res: Response) => {
  const userId = req.authUser!.userId;
  const stockId = String(req.params.stockId ?? "");

  try {
    // Scoped to the owner: a non-owner (or an unpinned stock) deletes 0 rows → 404.
    const result = await prisma.watchlist.deleteMany({ where: { userId, stockId } });
    if (result.count === 0) {
      return res.status(404).json({ success: false, error: "not_found", message: "Not in your watchlist" });
    }
    return res.json({ success: true, data: { removed: true, stockId } });
  } catch (e) {
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
