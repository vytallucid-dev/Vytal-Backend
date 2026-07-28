// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// CHAT_PROFILE_DISTILL HANDLER (Stage 5) — the nightly reader-profile pass.
//
// Claims every QUIET session with unseen turns and folds it into its owner's profile. One model call per
// session, one quota unit, metered as a SYSTEM actor (global budget only — our own job is not rate-limited
// against a person who isn't there). Same posture as the title job.
//
// ★ IDEMPOTENT BY WATERMARK. `chat_sessions.distilled_up_to_message_at` advances past the turns just
// read, so a re-run over unchanged sessions selects nothing, spends nothing and writes nothing. That is
// what makes it safe to schedule nightly and safe to re-run by hand.
//
// ⚠ SYNTHETIC USERS ARE EXCLUDED at the query (profile.ts findDistillableSessions). Test accounts have
// outnumbered real ones 15:2 in this database; an unfiltered sweep would have spent most of its budget
// distilling profiles for accounts that do not exist. Defence in depth, independent of the harness sweep.
//
// FAIL-SOFT PER SESSION: one session's failure never aborts the run. A quota denial stops the run
// entirely, because every remaining session would deny too and there is nothing to be gained by asking.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { ChatProfileDistillPayload } from "../types.js";
import { findDistillableSessions, distilSession } from "../../chat/profile.js";
import { PROFILE_MAX_SESSIONS_PER_RUN } from "../../chat/config.js";

export async function handleChatProfileDistill(ctx: JobContext<ChatProfileDistillPayload>) {
  const dryRun = ctx.payload?.dryRun === true;
  await ctx.reportProgress(2, `Selecting quiet sessions${dryRun ? " (dry run)" : ""}`);

  const sessions = ctx.payload?.sessionId
    ? [{ id: ctx.payload.sessionId }] // targeted re-run, for a proof harness or a manual retry
    : await findDistillableSessions();

  if (!sessions.length) {
    await ctx.reportProgress(100, "No quiet sessions with new turns — nothing to distil");
    return { selected: 0, distilled: 0, skipped: 0, failed: 0 };
  }

  // ★ NO SILENT CAPS. The query LIMITs, so a night with more than the cap leaves a remainder — and that
  // remainder is stated rather than looking like "we covered everything". The next run picks it up,
  // oldest-first, because the ordering is stable.
  if (sessions.length === PROFILE_MAX_SESSIONS_PER_RUN) {
    console.warn(
      `[chat_profile_distill] run CAPPED at ${PROFILE_MAX_SESSIONS_PER_RUN} sessions — there may be more ` +
        `pending; the next run continues oldest-first.`,
    );
  }

  let distilled = 0, skipped = 0, failed = 0, quotaStopped = false;
  const outcomes: string[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const { id } = sessions[i];
    try {
      const r = await distilSession(id, { dryRun });
      if (r.status === "distilled") { distilled++; outcomes.push(`${id.slice(0, 8)}=ok(${r.turns}t)`); }
      else if (r.status === "quota_denied") {
        // Every remaining session would deny identically — stop, report honestly, leave the watermarks
        // untouched so tomorrow's run resumes exactly here.
        console.warn(`[chat_profile_distill] quota denied (${r.reason}) after ${distilled} session(s) — stopping early`);
        quotaStopped = true;
        break;
      }
      else if (r.status === "unusable_reply") { failed++; outcomes.push(`${id.slice(0, 8)}=unparseable`); }
      else { skipped++; }
    } catch (err) {
      failed++;
      console.error(`[chat_profile_distill] session ${id} failed (non-fatal):`, (err as Error).message);
    }
    if (i % 10 === 0) await ctx.reportProgress(Math.min(95, 5 + Math.round((i / sessions.length) * 90)), `${i}/${sessions.length}`);
  }

  const summary =
    `${distilled} distilled, ${skipped} had no new turns, ${failed} unusable` +
    (quotaStopped ? ` — STOPPED EARLY on quota, ${sessions.length - distilled - skipped - failed} left for the next run` : "");
  await ctx.reportProgress(100, summary);
  console.info(`[chat_profile_distill] ${summary}${outcomes.length ? ` · ${outcomes.join(" ")}` : ""}`);
  return { selected: sessions.length, distilled, skipped, failed, quotaStopped, dryRun };
}
