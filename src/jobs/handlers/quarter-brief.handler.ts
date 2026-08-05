// ─────────────────────────────────────────────────────────────
// QUARTER_BRIEF HANDLER — generate and store ONE (stock, quarter) brief.
//
// Thin by design: every decision (skip / restore / generate / refuse) lives in writeQuarterBrief, so
// this file only maps a WriteOutcome onto the EXISTING BackgroundJob lifecycle. No parallel lifecycle.
//
// ── ⚠ maxAttempts = 1, AND THAT IS DELIBERATE ────────────────────────────────────────────────────
// A refusal here is a DECISION, not a failure. Retrying `ungrounded_number` pays a second time for the
// same rejection and would very likely reach it again. The failures that ARE transient — a provider
// error, a blank response — already retry INSIDE generate.ts before it ever returns.
//
// ── 4b-5 · REFUSALS MUST STAY DISTINGUISHABLE ────────────────────────────────────────────────────
// `quota_exhausted` and `ungrounded_number` are different operational facts: one means "come back
// tomorrow", the other means "a model tried to make a number up". Both land in errorMessage with the
// reason as a machine-greppable prefix, so
//     SELECT * FROM background_jobs WHERE type='quarter_brief' AND error_message LIKE 'ungrounded_number%'
// answers the second question without touching the first. The job SUCCEEDS on a skip or a restore —
// those are correct outcomes, not problems — and FAILS on a refusal, so the failed-job view is
// exactly the set of briefs that did not get written.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { QuarterBriefPayload } from "../types.js";
import { writeQuarterBrief } from "../../insight/quarter-brief/write.js";

export async function handleQuarterBrief(ctx: JobContext<QuarterBriefPayload>) {
  const { symbol, periodKey } = ctx.payload;
  const out = await writeQuarterBrief(symbol, periodKey);

  switch (out.kind) {
    case "written":
      return { symbol, periodKey: out.periodKey, outcome: "written", verdict: out.verdictKey };
    case "skipped_unchanged":
      // The fingerprint matched: the model would have been handed identical words. Success, 0 AI calls.
      return { symbol, periodKey: out.periodKey, outcome: "skipped_unchanged" };
    case "restored_unchanged":
      // Marked stale by a correction that moved nothing this brief states. Restored free.
      return { symbol, periodKey: out.periodKey, outcome: "restored_unchanged" };
    case "no_facts":
      return { symbol, outcome: "no_facts" };
    case "refused":
      throw new Error(`${out.reason}: ${out.detail}`);
  }
}
