// ─────────────────────────────────────────────────────────────
// ALERTS_DELIVER_DAILY HANDLER
//
// The daily email drain, wrapped as a tracked BackgroundJob. Delegates to
// runAlertsDeliverPass — reads undelivered alert_events, sends each via Resend, flips
// delivered=true on success. Idempotent (delivered guard); a failed send is counted and
// retried on the next run without crashing the drain.
//
// Scheduled AFTER the ALERTS_EVAL_DAILY cron (see scheduler.ts) so events fired tonight go
// out tonight. Because the drain empties the WHOLE undelivered backlog, this same job also
// retries any events that failed to send on a prior run.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { AlertsDeliverDailyPayload } from "../types.js";
import { runAlertsDeliverPass } from "../../alerts/deliver.js";

export async function handleAlertsDeliverDaily(
  ctx: JobContext<AlertsDeliverDailyPayload>,
) {
  await ctx.reportProgress(2, "Draining undelivered alert emails");
  // Production path: no mailer injected → runAlertsDeliverPass builds the Resend mailer.
  const result = await runAlertsDeliverPass();
  await ctx.reportProgress(
    100,
    `Alerts deliver complete — ${result.scanned} scanned · ${result.sent} sent · ` +
      `${result.failed} failed (left for retry)`,
  );
  return result;
}
