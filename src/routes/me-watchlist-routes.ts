// ─────────────────────────────────────────────────────────────
// /api/v1/me — watchlist routes (per-user pinned research surface).
// Mounted behind requireAuth in app.ts alongside the onboarding meRouter and the
// portfolio mePortfolioRouter (a THIRD router on the same base path — both existing
// routers untouched). Every handler derives the owner from req.authUser (never the
// payload). Read-only over computed data; signals/change-detection are a later phase.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import {
  addToWatchlist,
  removeFromWatchlist,
  updateWatchlistFavorite,
  listWatchlist,
} from "../controllers/me/watchlist-controller.js";

export const meWatchlistRouter = Router();

// The rich read-join list — per pinned stock: current health/band/tier/price/day-change,
// fired findings, three-lens verdicts, and the immutable pin-time baseline. Bulk, no N+1.
meWatchlistRouter.get("/watchlist", listWatchlist);

// Add a stock to the watchlist. Idempotent on (user, stock) — a re-add is a no-op that
// returns the existing pin (the pinned_* baseline is captured once, never overwritten).
meWatchlistRouter.post("/watchlist", addToWatchlist);

// Toggle the two-tier favorite star on a pinned stock. Owner-scoped; a non-owner or an
// unpinned stock updates nothing → 404. The pinned_* baseline is untouched (favorite is
// the one mutable field on the row).
meWatchlistRouter.patch("/watchlist/:stockId", updateWatchlistFavorite);

// Remove a stock from the watchlist. Owner-scoped (where { userId, stockId }); a non-owner
// or an unpinned stock deletes nothing → 404.
meWatchlistRouter.delete("/watchlist/:stockId", removeFromWatchlist);
