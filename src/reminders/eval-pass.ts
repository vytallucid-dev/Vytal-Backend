// ═══════════════════════════════════════════════════════════════════════
// EVENT-REMINDER EVALUATION PASS — the date-based daily run (the sibling of the alerts
// crossing pass, src/alerts/eval-pass.ts).
//
// One pass over every ACTIVE reminder: re-resolve the stock's NEAREST upcoming event of the
// reminder's type (resolve.ts — this is what FOLLOWS RESCHEDULES), then fire when today is
// inside the lead window [eventDate − daysBefore, eventDate). On a fire it RECORDS an
// event_reminder_event (delivered=false) and stamps last_fired_at in one transaction. It
// SENDS NOTHING — email is the drain (deliver.ts), which reuses the alerts mailer.
//
// FIRE ONCE PER OCCURRENCE: dedupe on the resolved eventDate. A re-eval on the same day, or
// a reschedule back to the same date, never double-sends; a genuinely new date is a new
// occurrence that may fire again. Belt-and-braces: a bulk pre-check skips already-fired
// occurrences, and the DB unique (reminder_id, resolved_event_date) catches any race.
//
// TEST SEAM (never used in production): `eventOverrides` substitutes the resolved next event
// per (stockId, eventType) so the fire / dedupe / reschedule SEQUENCE can be driven
// deterministically through the real write path. `onlyUserIds` scopes the scan.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import {
  resolveNextEvents,
  reminderFireDecision,
  startOfUtcDay,
  nextEventKey,
  type NextEvent,
} from "./resolve.js";

export interface RunRemindersEvalOptions {
  /** Fire timestamp + the "today" the window is measured against. Defaults to now. */
  now?: Date;
  /** TEST SEAM: scope the scan to these owners only. Omit in production (scan all). */
  onlyUserIds?: string[];
  /** TEST SEAM: override the resolved next event per "stockId::eventType" (drives the
   *  fire / dedupe / reschedule sequence without fabricating real corporate_events rows). */
  eventOverrides?: Map<string, NextEvent>;
}

export type ReminderEvalStatus =
  | "fired"
  | "deduped" // already fired for this occurrence (dedupe on resolvedEventDate)
  | "no_upcoming" // no upcoming event of that type to resolve
  | "before_window" // upcoming, but the lead window hasn't opened yet
  | "past_lead"; // on or after the event day (never fire ON the day)

export interface ReminderEvalOutcome {
  reminderId: string;
  stockId: string;
  symbol: string;
  eventType: string;
  status: ReminderEvalStatus;
  /** the resolved occurrence date (ISO yyyy-mm-dd), when there is one. */
  eventDate: string | null;
}

export interface RemindersEvalResult {
  scanned: number;
  fired: number;
  deduped: number;
  skipped: number; // no_upcoming + before_window + past_lead
  outcomes: ReminderEvalOutcome[];
}

const isoDate = (d: Date) => startOfUtcDay(d).toISOString().slice(0, 10);

/**
 * Run ONE reminder evaluation pass over the active reminders. Records fires into
 * event_reminder_events and stamps last_fired_at — nothing else. Idempotent within a day
 * (the dedupe on resolvedEventDate makes a re-run a no-op).
 */
export async function runRemindersEvalPass(
  opts: RunRemindersEvalOptions = {},
): Promise<RemindersEvalResult> {
  const now = opts.now ?? new Date();
  const today = startOfUtcDay(now);

  const reminders = await prisma.eventReminder.findMany({
    where: { active: true, ...(opts.onlyUserIds ? { userId: { in: opts.onlyUserIds } } : {}) },
    select: {
      id: true,
      userId: true,
      stockId: true,
      eventType: true,
      daysBefore: true,
      stock: { select: { symbol: true } },
    },
  });

  // Resolve the nearest upcoming event for every distinct pair (one bulk read), then let a
  // test override win where provided.
  const pairs = reminders.map((r) => ({ stockId: r.stockId, eventType: r.eventType }));
  const resolved = await resolveNextEvents(pairs, today);
  if (opts.eventOverrides) {
    for (const [k, v] of opts.eventOverrides) resolved.set(k, v);
  }

  // Bulk pre-check of already-fired occurrences for the scanned reminders (dedupe without
  // an N+1). The DB unique constraint is the hard backstop against races.
  const reminderIds = reminders.map((r) => r.id);
  const priorEvents = reminderIds.length
    ? await prisma.eventReminderEvent.findMany({
        where: { reminderId: { in: reminderIds } },
        select: { reminderId: true, resolvedEventDate: true },
      })
    : [];
  const firedKeys = new Set(priorEvents.map((e) => `${e.reminderId}::${isoDate(e.resolvedEventDate)}`));

  const outcomes: ReminderEvalOutcome[] = [];
  let fired = 0,
    deduped = 0,
    skipped = 0;

  for (const r of reminders) {
    const base = { reminderId: r.id, stockId: r.stockId, symbol: r.stock.symbol, eventType: r.eventType };
    const next = resolved.get(nextEventKey(r.stockId, r.eventType));
    const decision = reminderFireDecision({ today, next, daysBefore: r.daysBefore });

    if (!decision.fire) {
      skipped++;
      outcomes.push({ ...base, status: decision.reason, eventDate: next ? isoDate(next.eventDate) : null });
      continue;
    }

    const occ = decision.resolvedEventDate;
    const dedupeKey = `${r.id}::${isoDate(occ)}`;
    if (firedKeys.has(dedupeKey)) {
      deduped++;
      outcomes.push({ ...base, status: "deduped", eventDate: isoDate(occ) });
      continue;
    }

    try {
      // Event write + last_fired_at stamp are atomic. The unique (reminder_id,
      // resolved_event_date) makes the insert the dedupe point under a race.
      await prisma.$transaction([
        prisma.eventReminderEvent.create({
          data: {
            reminderId: r.id,
            userId: r.userId,
            stockId: r.stockId,
            eventType: r.eventType,
            resolvedEventDate: occ,
            firedAt: now,
          },
        }),
        prisma.eventReminder.update({ where: { id: r.id }, data: { lastFiredAt: now } }),
      ]);
      firedKeys.add(dedupeKey);
      fired++;
      outcomes.push({ ...base, status: "fired", eventDate: isoDate(occ) });
    } catch (e) {
      // A concurrent pass already recorded this occurrence → treat as deduped, not an error.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        deduped++;
        outcomes.push({ ...base, status: "deduped", eventDate: isoDate(occ) });
        continue;
      }
      throw e;
    }
  }

  return { scanned: reminders.length, fired, deduped, skipped, outcomes };
}
