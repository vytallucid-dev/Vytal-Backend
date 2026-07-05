// ─────────────────────────────────────────────────────────────
// REMINDERS_DELIVER_DAILY HANDLER
//
// The daily reminder-email drain, wrapped as a tracked BackgroundJob. Delegates to
// runRemindersDeliverPass — reads undelivered event_reminder_events, sends each via the SAME
// Resend mailer the alerts drain uses (not a new mailer), flips delivered=true on success.
// Idempotent (delivered guard); a failed send is counted and retried on the next run.
//
// Scheduled just AFTER the REMINDERS_EVAL_DAILY cron so events fired tonight go out tonight,
// and runs EVERY DAY (the eval + delivery cadence must cover weekends for date-based
// reminders). Drains the WHOLE undelivered backlog, so it also retries prior failures.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { RemindersDeliverDailyPayload } from "../types.js";
import { runRemindersDeliverPass } from "../../reminders/deliver.js";

export async function handleRemindersDeliverDaily(
  ctx: JobContext<RemindersDeliverDailyPayload>,
) {
  await ctx.reportProgress(2, "Draining undelivered reminder emails");
  // Production path: no mailer injected → runRemindersDeliverPass builds the (alerts) Resend mailer.
  const result = await runRemindersDeliverPass();
  await ctx.reportProgress(
    100,
    `Reminders deliver complete — ${result.scanned} scanned · ${result.sent} sent · ` +
      `${result.failed} failed (left for retry)`,
  );
  return result;
}
