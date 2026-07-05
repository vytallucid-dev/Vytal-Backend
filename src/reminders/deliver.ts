// ═══════════════════════════════════════════════════════════════════════
// REMINDER DELIVERY DRAIN — send the fired reminder log, per event.
//
// This is the reminder half of the alerts DELIVERY PIPELINE, not a rebuild of it. It reuses
// the SAME mailer seam (createResendMailer / AlertMailer from src/alerts/email/mailer.ts —
// there is NO second mailer) and the SAME send-then-flip + per-event idempotencyKey pattern
// as the alert drain (src/alerts/deliver.ts). Only the fired-log table and the email
// template differ (a reminder describes a date, not a crossing).
//
// ── delivered=true is the SINGLE SOURCE OF TRUTH for "sent" ──
//   • Idempotent: the WHERE delivered=false guard means a re-run over an already-drained
//     log sends zero. delivered is never un-flipped.
//   • send-then-flip: we flip ONLY after a successful send. A failed send stays
//     delivered=false → retried next drain. A crash in the tiny window between send and flip
//     is covered by the per-event idempotencyKey (Resend dedups it).
//   • Per-event try/catch: one bad send never crashes the drain or blocks the rest.
//
// event_reminder_events.reminder is a CASCADE FK, so every event read here still has a live
// parent reminder — no "was it deleted?" check needed.
//
// Hung on its own daily cron just after the reminder eval (see scheduler.ts), draining the
// WHOLE undelivered backlog so it also retries prior failures.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { renderReminderEmail, type ReminderEmailProps } from "./email/reminder-email.js";
// Reuse the ALERTS mailer seam — the same sender alerts use (not a new mailer).
import { createResendMailer, type AlertMailer } from "../alerts/email/mailer.js";

export interface RunRemindersDeliverOptions {
  /** The sender. Defaults to the Resend-backed alerts mailer (built lazily). Tests inject a mock. */
  mailer?: AlertMailer;
  /** TEST SEAM: scope the drain to these owners only. Omit in production (drain all). */
  onlyUserIds?: string[];
}

export interface ReminderDeliverOutcome {
  eventId: string;
  status: "sent" | "failed";
  to?: string;
  messageId?: string;
  error?: string;
}

export interface RemindersDeliverResult {
  scanned: number;
  sent: number;
  failed: number;
  outcomes: ReminderDeliverOutcome[];
}

/** Absolute links into the app (mirrors the alert drain's buildUrls). Reminders are managed
 *  from the calendar, so "manage" points there. */
function buildUrls(symbol: string): { stockUrl: string; manageUrl: string } {
  const base = (process.env.APP_BASE_URL ?? "https://app.vytal.in").replace(/\/+$/, "");
  return {
    stockUrl: `${base}/stocks/${encodeURIComponent(symbol)}`,
    manageUrl: `${base}/calendar`,
  };
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Drain the undelivered event_reminder_events log: render + send each via the alerts mailer,
 * flip delivered on success. Never throws on an individual send failure (counted + retried
 * next run); only a hard misconfiguration (no mailer + no RESEND_API_KEY) throws.
 */
export async function runRemindersDeliverPass(
  opts: RunRemindersDeliverOptions = {},
): Promise<RemindersDeliverResult> {
  // Lazy default: only build the Resend mailer when one wasn't injected (mock-driven drain
  // needs no RESEND_API_KEY). Same mailer the alert drain uses.
  const mailer = opts.mailer ?? createResendMailer();

  const events = await prisma.eventReminderEvent.findMany({
    where: {
      delivered: false,
      ...(opts.onlyUserIds ? { userId: { in: opts.onlyUserIds } } : {}),
    },
    orderBy: { firedAt: "asc" },
    select: {
      id: true,
      eventType: true,
      resolvedEventDate: true,
      user: { select: { email: true } },
      stock: { select: { symbol: true, name: true } },
      // Required (CASCADE) relation — always present for a surviving event.
      reminder: { select: { daysBefore: true } },
    },
  });

  const outcomes: ReminderDeliverOutcome[] = [];
  let sent = 0;
  let failed = 0;

  for (const ev of events) {
    const { stockUrl, manageUrl } = buildUrls(ev.stock.symbol);
    const props: ReminderEmailProps = {
      stockSymbol: ev.stock.symbol,
      stockName: ev.stock.name,
      eventType: ev.eventType,
      eventDate: isoDate(ev.resolvedEventDate),
      daysBefore: ev.reminder.daysBefore,
      stockUrl,
      manageUrl,
    };

    try {
      const { subject, html } = await renderReminderEmail(props);
      const { id } = await mailer.send({
        to: ev.user.email,
        subject,
        html,
        idempotencyKey: `reminder-event:${ev.id}`,
      });
      // Flip ONLY after a confirmed send — the idempotency guard.
      await prisma.eventReminderEvent.update({ where: { id: ev.id }, data: { delivered: true } });
      sent++;
      outcomes.push({ eventId: ev.id, status: "sent", to: ev.user.email, messageId: id });
    } catch (err) {
      failed++;
      const error = err instanceof Error ? err.message : String(err);
      console.error(
        `[reminders-deliver] event ${ev.id} (${ev.stock.symbol}) send failed — left undelivered for retry:`,
        error,
      );
      outcomes.push({ eventId: ev.id, status: "failed", to: ev.user.email, error });
    }
  }

  return { scanned: events.length, sent, failed, outcomes };
}
