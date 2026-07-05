// ─────────────────────────────────────────────────────────────
// REMINDERS_EVAL_DAILY HANDLER
//
// The daily event-reminder evaluation pass, wrapped as a tracked BackgroundJob. Delegates to
// runRemindersEvalPass — resolves each active reminder's nearest upcoming event of its type,
// fires (records an event_reminder_event) when today is in the lead window, dedupes per
// occurrence. SENDS NOTHING; the reminder email drain is a separate job that reuses the
// alerts mailer.
//
// Runs EVERY DAY (unlike the alerts eval, which is weekdays-only). Reminders are date-based:
// an event on a Monday with a 1-day lead must fire on the (weekend) Sunday, so weekend eval
// is required.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { RemindersEvalDailyPayload } from "../types.js";
import { runRemindersEvalPass } from "../../reminders/eval-pass.js";

export async function handleRemindersEvalDaily(
  ctx: JobContext<RemindersEvalDailyPayload>,
) {
  await ctx.reportProgress(2, "Evaluating active event reminders");
  const result = await runRemindersEvalPass({ now: new Date() });
  await ctx.reportProgress(
    100,
    `Reminders eval complete — ${result.scanned} scanned · ${result.fired} fired · ` +
      `${result.deduped} deduped · ${result.skipped} skipped`,
  );
  return result;
}
