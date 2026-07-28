// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WATCHLIST WRITE SERVICE — add / remove, extracted from watchlist-controller.ts UNCHANGED.
//
// THE SEAM: `service(input, userId)`. The controller parses nothing and decides nothing; it hands the
// raw body down and turns the result (or a thrown ServiceError) into a response. A chat tool calls the
// SAME function with `ctx.userId`, so the universe gate, the idempotency rule and the pin-time baseline
// capture cannot drift between the two callers — there is only one copy.
//
// ★ userId IS A PARAMETER, NEVER PART OF `input`. The caller supplies it from an authenticated source
// (req.authUser.userId / ToolContext.userId). Nothing a client — or a model — can put in the body can
// name a different user, so IDOR stays structurally impossible exactly as it was in the controller.
//
// UNCHANGED FROM THE CONTROLLER: the universe gate, the idempotent re-add returning the EXISTING row
// (the pinned_* baseline is captured once and never overwritten), the P2002 add-race fallback, and the
// best-effort relationship event fired only on a TRUE create.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { z } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { emitRelationshipEvent } from "../tracking/tracking.js";
import { ServiceError, failure, validationError } from "../lib/service-error.js";

// ── input schemas (moved verbatim from the controller) ──────────────────────────────────────────────
// Exported so the chat write tool validates its proposal through the SAME schema the HTTP route uses,
// rather than a second copy that would be free to drift.
export const AddToWatchlistInput = z.object({
  stockId: z.string().trim().min(1),
});

// Remove takes no shape beyond the id: an unknown/blank id simply deletes 0 rows → not_found, which is
// what the route has always done with `String(req.params.stockId ?? "")`. Deliberately NOT tightened to
// `.min(1)` — that would turn an existing 404 into a 400.
export const RemoveFromWatchlistInput = z.object({
  stockId: z.string(),
});

const PIN_SELECT = {
  stockId: true,
  addedAt: true,
  pinnedHealth: true,
  pinnedBand: true,
  pinnedPrice: true,
} satisfies Prisma.WatchlistSelect;

export interface SerializedPin {
  stockId: string;
  addedAt: string;
  pinnedHealth: number | null;
  pinnedBand: string | null;
  pinnedPrice: string | null;
}

/** The minimal add-response shape (the pinned baseline just written / already present). */
export function serializePin(w: {
  stockId: string;
  addedAt: Date;
  pinnedHealth: number | null;
  pinnedBand: string | null;
  pinnedPrice: Prisma.Decimal | null;
}): SerializedPin {
  return {
    stockId: w.stockId,
    addedAt: w.addedAt.toISOString(),
    pinnedHealth: w.pinnedHealth,
    pinnedBand: w.pinnedBand,
    pinnedPrice: w.pinnedPrice != null ? w.pinnedPrice.toString() : null,
  };
}

// ── ADD ─────────────────────────────────────────────────────────────────────────────────────────────
export interface AddToWatchlistResult {
  watchlist: SerializedPin;
  /** false ⇒ it was already pinned; the caller returns 200 rather than 201 and the baseline is intact. */
  created: boolean;
}

export async function addToWatchlist(input: unknown, userId: string): Promise<AddToWatchlistResult> {
  const parsed = AddToWatchlistInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, parsed.error.flatten().fieldErrors);
  const { stockId } = parsed.data;

  // Universe gate: the stockId must resolve to a real stock (the 505-stock universe).
  const stock = await prisma.stock.findUnique({ where: { id: stockId }, select: { id: true } });
  if (!stock) throw failure(400, "stock_not_found", "Not a stock in the universe");

  // Idempotent: an existing pin is returned as-is — the baseline is NEVER overwritten.
  const existing = await prisma.watchlist.findUnique({
    where: { userId_stockId: { userId, stockId } },
    select: PIN_SELECT,
  });
  if (existing) return { watchlist: serializePin(existing), created: false };

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
    const created = await prisma.watchlist.create({ data, select: PIN_SELECT });
    // Behaviour tracking: a TRUE create only (never the idempotent re-add path above). Best-effort
    // after the write commits — a tracking failure never fails the add.
    await emitRelationshipEvent(userId, stockId, "watchlist_added");
    return { watchlist: serializePin(created), created: true };
  } catch (e) {
    // Lost an add race for the same (user, stock) → the other insert won; honor idempotency.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await prisma.watchlist.findUnique({
        where: { userId_stockId: { userId, stockId } },
        select: PIN_SELECT,
      });
      if (row) return { watchlist: serializePin(row), created: false };
    }
    throw e;
  }
}

// ── REMOVE ──────────────────────────────────────────────────────────────────────────────────────────
export interface RemoveFromWatchlistResult {
  removed: true;
  stockId: string;
}

export async function removeFromWatchlist(input: unknown, userId: string): Promise<RemoveFromWatchlistResult> {
  const parsed = RemoveFromWatchlistInput.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error, parsed.error.flatten().fieldErrors);
  const { stockId } = parsed.data;

  // Scoped to the owner: a non-owner (or an unpinned stock) deletes 0 rows → not_found.
  const result = await prisma.watchlist.deleteMany({ where: { userId, stockId } });
  if (result.count === 0) throw failure(404, "not_found", "Not in your watchlist");

  // Behaviour tracking: only when a row was actually removed. Best-effort.
  await emitRelationshipEvent(userId, stockId, "watchlist_removed");
  return { removed: true, stockId };
}

export { ServiceError };
