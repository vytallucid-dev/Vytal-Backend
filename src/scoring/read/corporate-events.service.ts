// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CORPORATE EVENTS — the per-stock events read, EXTRACTED VERBATIM from the controller.
//
// ★ THIS IS A MOVE, NOT A REWRITE. The query, the date-window arithmetic, the 730-day clamp, the sort
// direction and the row→DTO mapping are lifted unchanged from `getEventsBySymbol`
// (controllers/ingestion/events-controllers.ts), which now calls this and only shapes the HTTP envelope.
// One read, two callers (the endpoint + the chat tool) — the pattern the read services already follow
// (buildPriceView, buildOwnershipView, …), so the tool and the page can never diverge.
//
// CONVENTION MATCH: returns null when the symbol is not in the universe — the same signal every other
// read service gives (buildHealthSnapshotView, buildPriceView), so callers map it to their own 404 /
// coverage message rather than each inventing a miss state.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";

/** One corporate event, exactly as the endpoint has always shaped it. */
export interface CorporateEventItem {
  id: string;
  eventType: string;
  eventDate: string; // YYYY-MM-DD
  exDate: string | null;
  recordDate: string | null;
  impactLevel: string | null;
  isConfirmed: boolean;
  dividendAmount: number | null;
  dividendType: string | null;
  bonusRatio: string | null;
  splitRatio: string | null;
  description: string | null;
}

export interface CorporateEventsView {
  symbol: string;
  name: string;
  events: CorporateEventItem[];
}

export interface CorporateEventsOpts {
  /** true (default) → the next `days`; false → the last `days`. */
  upcoming?: boolean;
  /** Window size in days. Defaults to 365, clamped to 730 (the controller's own ceiling). */
  days?: number;
}

/** Per-stock corporate events in a forward or backward window. null ⇔ symbol not in the universe. */
export async function buildCorporateEventsView(
  symbolRaw: string,
  opts: CorporateEventsOpts = {},
): Promise<CorporateEventsView | null> {
  const symbol = symbolRaw.toUpperCase();
  const isUpcoming = opts.upcoming !== false;
  const windowDays = Math.min(opts.days && Number.isFinite(opts.days) ? opts.days : 365, 730);

  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true, symbol: true, name: true },
  });
  if (!stock) return null;

  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  const dateFilter = isUpcoming
    ? { gte: now, lte: new Date(now.getTime() + windowDays * 86400_000) }
    : { lte: now, gte: new Date(now.getTime() - windowDays * 86400_000) };

  const events = await prisma.corporateEvent.findMany({
    where: { stockId: stock.id, eventDate: dateFilter },
    orderBy: { eventDate: isUpcoming ? "asc" : "desc" },
  });

  return {
    symbol: stock.symbol,
    name: stock.name,
    events: events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      eventDate: e.eventDate.toISOString().split("T")[0],
      exDate: e.exDate?.toISOString().split("T")[0] ?? null,
      recordDate: e.recordDate?.toISOString().split("T")[0] ?? null,
      impactLevel: e.impactLevel,
      isConfirmed: e.isConfirmed,
      dividendAmount: e.dividendAmount ? parseFloat(e.dividendAmount.toString()) : null,
      dividendType: e.dividendType,
      bonusRatio: e.bonusRatio,
      splitRatio: e.splitRatio,
      description: e.description,
    })),
  };
}
