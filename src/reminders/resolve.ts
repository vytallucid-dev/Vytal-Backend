// ═══════════════════════════════════════════════════════════════════════
// EVENT-REMINDER RESOLUTION — the semantic (stockId, eventType) → "next upcoming event"
// lookup + the pure date-based fire decision. No I/O in the decision (unit-testable);
// resolveNextEvents is the one bulk DB read (no N+1).
//
// A reminder does NOT store an event id. It binds by (stockId, eventType) and every eval
// re-resolves the NEAREST upcoming corporate_events row of that type (eventDate >= today,
// soonest first). This is what makes a reminder FOLLOW A RESCHEDULE: a date shift lands as
// a new corporate_events row (upsert key = stockId+eventType+eventDate), and the resolver
// simply picks the new nearest row — the reminder never pins to a stale one.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";

/** The corporate-event types a reminder may watch (mirrors corporate_events.event_type). */
export const REMINDER_EVENT_TYPES = [
  "earnings",
  "dividend",
  "agm",
  "board_meeting",
  "bonus",
  "split",
  "rights",
  "buyback",
  "record_date",
] as const;
export type ReminderEventType = (typeof REMINDER_EVENT_TYPES)[number];

export function isReminderEventType(t: string): t is ReminderEventType {
  return (REMINDER_EVENT_TYPES as readonly string[]).includes(t);
}

/** The resolved nearest-upcoming event for a (stockId, eventType) pair. */
export interface NextEvent {
  /** eventDate at UTC midnight (corporate_events.event_date is a pure DATE). */
  eventDate: Date;
  impactLevel: string;
  description: string | null;
}

const pairKey = (stockId: string, eventType: string) => `${stockId}::${eventType}`;

/** UTC-midnight of a moment — the app-wide "day" convention (corporate_events.event_date is
 *  a DATE, and the events controller treats today as UTC midnight; we match that). */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Add whole days to a UTC-midnight date. */
export function addUtcDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

/**
 * Bulk-resolve the nearest UPCOMING event (eventDate >= today) for each (stockId, eventType)
 * pair. Returns a map keyed "stockId::eventType" → the soonest matching event (or absent
 * when the stock has no upcoming event of that type). One query regardless of pair count.
 */
export async function resolveNextEvents(
  pairs: { stockId: string; eventType: string }[],
  today: Date,
): Promise<Map<string, NextEvent>> {
  const out = new Map<string, NextEvent>();
  if (pairs.length === 0) return out;

  const stockIds = [...new Set(pairs.map((p) => p.stockId))];
  const eventTypes = [...new Set(pairs.map((p) => p.eventType))];

  // Ascending by date: the FIRST row seen per (stock, type) is the nearest upcoming one.
  const rows = await prisma.corporateEvent.findMany({
    where: {
      stockId: { in: stockIds },
      eventType: { in: eventTypes },
      eventDate: { gte: today },
    },
    orderBy: { eventDate: "asc" },
    select: { stockId: true, eventType: true, eventDate: true, impactLevel: true, description: true },
  });

  // Only keep pairs we were actually asked about (the query over-selects across the cross
  // product of stockIds × eventTypes; a pair we didn't request is ignored).
  const wanted = new Set(pairs.map((p) => pairKey(p.stockId, p.eventType)));
  for (const r of rows) {
    const k = pairKey(r.stockId, r.eventType);
    if (!wanted.has(k) || out.has(k)) continue; // first (nearest) wins
    out.set(k, {
      eventDate: startOfUtcDay(r.eventDate),
      impactLevel: r.impactLevel,
      description: r.description,
    });
  }
  return out;
}

export const nextEventKey = pairKey;

// ── the pure fire decision ─────────────────────────────────────────────────────────────
export type ReminderFireDecision =
  | { fire: false; reason: "no_upcoming" | "before_window" | "past_lead" }
  | { fire: true; resolvedEventDate: Date };

/**
 * Decide whether a reminder should fire TODAY, given its resolved next event.
 *
 * Fire window = [eventDate − daysBefore, eventDate) — on or after the lead date, but STRICTLY
 * before the event day (the point of a reminder is lead time; we never fire on the day). For
 * the default daysBefore=1 this is exactly "the day before". Using a window rather than an
 * exact-day equality means a missed eval day still fires (as long as we're inside the lead
 * window and haven't fired for this occurrence yet — the caller dedupes on resolvedEventDate).
 *
 * All dates are UTC-midnight (startOfUtcDay). Returns the resolvedEventDate on a fire so the
 * caller can record + dedupe against it.
 */
export function reminderFireDecision(opts: {
  today: Date;
  next: NextEvent | undefined;
  daysBefore: number;
}): ReminderFireDecision {
  const { today, next, daysBefore } = opts;
  if (!next) return { fire: false, reason: "no_upcoming" };

  const eventDate = startOfUtcDay(next.eventDate);
  const t = startOfUtcDay(today);

  // Never on or after the event day.
  if (t.getTime() >= eventDate.getTime()) return { fire: false, reason: "past_lead" };

  const fireDate = addUtcDays(eventDate, -Math.max(1, daysBefore));
  if (t.getTime() < fireDate.getTime()) return { fire: false, reason: "before_window" };

  return { fire: true, resolvedEventDate: eventDate };
}
