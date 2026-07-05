// ═══════════════════════════════════════════════════════════════════════
// ALERT DELIVERY DRAIN — send the fired-events log, per event.
//
// The eval pass (eval-pass.ts) RECORDS fires into alert_events with delivered=false and
// sends nothing. This drain is the other half: read every undelivered event, render its
// email, send via the injected mailer (Resend in prod), and flip delivered=true on success.
//
// ── delivered=true is the SINGLE SOURCE OF TRUTH for "sent" ──
//   • Idempotent: the WHERE delivered=false guard means a re-run over an already-drained
//     log sends zero. delivered is never un-flipped.
//   • send-then-flip ordering: we flip ONLY after a successful send. A send that FAILS
//     leaves delivered=false → it is retried on the next drain. A crash in the tiny window
//     between a successful send and the flip is covered by the per-event idempotencyKey
//     (the event id) — Resend dedups it, so the retry can't double-send.
//   • Per-event try/catch: one failed send never crashes the drain or blocks the rest of
//     the batch.
//
// ── deleted alerts ──
//   alert_events.alert is a CASCADE FK. Deleting an alert removes its events with it, so
//   every event we read here still has a live parent alert — `ev.alert` is always present.
//   No "was the alert since deleted?" check is needed; the cascade already enforced it.
//
// Hung on the daily cycle as its own job (ALERTS_DELIVER_DAILY), scheduled just AFTER the
// alerts-eval cron so events fired tonight go out tonight. Because it drains the WHOLE
// undelivered backlog (not just tonight's), the same job also retries any prior failures.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { renderAlertEmail, type AlertEmailProps, type BandKey } from "./email/alert-email.js";
import { createResendMailer, type AlertMailer } from "./email/mailer.js";

export interface RunAlertsDeliverOptions {
  /** The sender. Defaults to the Resend-backed mailer (built lazily). Tests inject a mock. */
  mailer?: AlertMailer;
  /** TEST SEAM: scope the drain to these owners only. Omit in production (drain all). */
  onlyUserIds?: string[];
}

export interface AlertDeliverOutcome {
  eventId: string;
  status: "sent" | "failed";
  to?: string;
  messageId?: string;
  error?: string;
}

export interface AlertsDeliverResult {
  scanned: number;
  sent: number;
  failed: number;
  outcomes: AlertDeliverOutcome[];
}

/** Absolute links into the app. APP_BASE_URL is set by the operator; the placeholder keeps
 *  local/dev renders from producing empty hrefs. */
function buildUrls(symbol: string): { stockUrl: string; manageUrl: string } {
  const base = (process.env.APP_BASE_URL ?? "https://app.vytal.in").replace(/\/+$/, "");
  return {
    stockUrl: `${base}/stocks/${encodeURIComponent(symbol)}`,
    manageUrl: `${base}/alerts`,
  };
}

/**
 * Drain the undelivered alert_events log: render + send each, flip delivered on success.
 * Returns a per-event summary. Never throws on an individual send failure (those are
 * counted and retried next run); only a hard misconfiguration (e.g. no Resend mailer and
 * no RESEND_API_KEY) throws — surfacing as a failed job, which is correct.
 */
export async function runAlertsDeliverPass(
  opts: RunAlertsDeliverOptions = {},
): Promise<AlertsDeliverResult> {
  // Lazy default: only build the Resend mailer when one wasn't injected (so a mock-driven
  // drain needs no RESEND_API_KEY).
  const mailer = opts.mailer ?? createResendMailer();

  const events = await prisma.alertEvent.findMany({
    where: {
      delivered: false,
      ...(opts.onlyUserIds ? { userId: { in: opts.onlyUserIds } } : {}),
    },
    orderBy: { firedAt: "asc" },
    select: {
      id: true,
      snapshot: true,
      firedAt: true,
      user: { select: { email: true } },
      stock: { select: { symbol: true, name: true } },
      // Required (CASCADE) relation — always present for a surviving event.
      alert: {
        select: {
          type: true,
          operator: true,
          thresholdPrice: true,
          thresholdBand: true,
          findingKey: true,
        },
      },
    },
  });

  const outcomes: AlertDeliverOutcome[] = [];
  let sent = 0;
  let failed = 0;

  for (const ev of events) {
    const { stockUrl, manageUrl } = buildUrls(ev.stock.symbol);
    const props: AlertEmailProps = {
      stockSymbol: ev.stock.symbol,
      stockName: ev.stock.name,
      type: ev.alert.type,
      operator: ev.alert.operator,
      snapshot: ev.snapshot,
      thresholdPrice: ev.alert.thresholdPrice != null ? ev.alert.thresholdPrice.toString() : null,
      thresholdBand: (ev.alert.thresholdBand as BandKey | null) ?? null,
      findingKey: ev.alert.findingKey,
      firedAt: ev.firedAt,
      stockUrl,
      manageUrl,
    };

    try {
      const { subject, html } = await renderAlertEmail(props);
      const { id } = await mailer.send({
        to: ev.user.email,
        subject,
        html,
        idempotencyKey: `alert-event:${ev.id}`,
      });
      // Flip ONLY after a confirmed send — this is the idempotency guard.
      await prisma.alertEvent.update({ where: { id: ev.id }, data: { delivered: true } });
      sent++;
      outcomes.push({ eventId: ev.id, status: "sent", to: ev.user.email, messageId: id });
    } catch (err) {
      // Leave delivered=false → retried next drain. Do not let one bad send sink the batch.
      failed++;
      const error = err instanceof Error ? err.message : String(err);
      console.error(
        `[alerts-deliver] event ${ev.id} (${ev.stock.symbol}) send failed — left undelivered for retry:`,
        error,
      );
      outcomes.push({ eventId: ev.id, status: "failed", to: ev.user.email, error });
    }
  }

  return { scanned: events.length, sent, failed, outcomes };
}
