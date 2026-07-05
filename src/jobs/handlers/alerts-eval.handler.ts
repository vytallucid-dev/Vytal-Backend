// ─────────────────────────────────────────────────────────────
// ALERTS_EVAL_DAILY HANDLER
//
// The daily user-alert evaluation pass, wrapped as a tracked BackgroundJob (like the
// other daily-operational handlers). Delegates to runAlertsEvalPass — read-only over
// computed data, RECORDS fires into alert_events, flips (active, armed). SENDS NOTHING;
// email is a separate later stage that drains alert_events.
//
// Scheduled AFTER the EOD-price → PG-rescore cascade (see scheduler.ts) so the band /
// findings each alert reads reflect the day's rescore.
// ─────────────────────────────────────────────────────────────

import type { JobContext } from "../context.js";
import type { AlertsEvalDailyPayload } from "../types.js";
import { runAlertsEvalPass } from "../../alerts/eval-pass.js";

export async function handleAlertsEvalDaily(
  ctx: JobContext<AlertsEvalDailyPayload>,
) {
  await ctx.reportProgress(2, "Evaluating active user alerts");
  const result = await runAlertsEvalPass({ now: new Date() });
  await ctx.reportProgress(
    100,
    `Alerts eval complete — ${result.scanned} scanned · ${result.fired} fired · ` +
      `${result.rearmed} re-armed · ${result.held} held · ${result.skipped} skipped`,
  );
  return result;
}
