-- ═══════════════════════════════════════════════════════════════
-- RETENTION — chat_sessions floor 1 → 7, and the floor_reason rewritten to record WHY.
-- DATA-ONLY: one UPDATE of two columns on one `retention_policy` row. No DDL, no
-- schema.prisma change, no data table touched. `days` and `armed` are NOT changed here.
--
-- ── WHY THE OLD FLOOR WAS WRONG ───────────────────────────────────────────────────────────────
-- The floor was 1, justified solely by the sidebar's 24h resumability window. That is a fact about
-- the PRODUCT. It is not the binding constraint, and the binding constraint is not in this table:
-- `chat_sessions` rows are an INPUT to the nightly reader-profile distill, and the prune can destroy
-- them before the distill has read them. floor 1 permits a configuration in which that race is live,
-- and `floor` is the ONE field the audited admin route cannot edit
-- (controllers/admin/retention-controller.ts:20-24) — so an under-set floor can only ever be repaired
-- by another migration, which is what this is.
--
-- ⚠ THE FLOOR IS THE FENCE, NOT THE SETTING. `days` stays at 1 in this migration and is raised
--   separately through the AUDITED route. This migration only makes the dangerous value unreachable.
--
-- ── WHY 7 ─────────────────────────────────────────────────────────────────────────────────────
-- Seven days structurally excludes every known race: the ~26h quota-resume gap, the LIMIT-200
-- remainder (which is re-attempted the following night), and any plausible multi-night retry backlog.
-- It is not derived from a read depth — no consumer reads chat_sessions "N days back" — it is derived
-- from the longest interval over which a session can still be OWED a distill.
--
-- Drift-safe apply: BEGIN/COMMIT over DIRECT_URL (apply-migration-direct.ts), then
-- `prisma migrate resolve --applied 20260814130000_chat_sessions_floor_distill_dependency`, then
-- `prisma migrate status` clean. NEVER `migrate dev`.
-- ═══════════════════════════════════════════════════════════════

UPDATE "retention_policy"
   SET "floor" = 7,
       "floor_reason" =
         'FLOOR IS SET BY THE DISTILL DEPENDENCY, NOT BY THE SIDEBAR WINDOW. '
         'The prune predicate is "last_message_at < now() - N days AND promoted = false" — the '
         'unpromoted_only exemption (retention/policy.ts:93-96) is one column, promoted, and knows '
         'NOTHING about distill state, even though chat_sessions.distilled_up_to_message_at is exactly '
         'the marker that would answer "has this been read yet?" (chat/profile.ts:436-447 selects on it; '
         'the prune does not). '
         'AND THE LOSS IS UNRECOVERABLE: chat_messages.session_id is ON DELETE CASCADE, so pruning a '
         'session destroys its transcript in the same statement — no session, no messages, no watermark, '
         'and nothing logs that an undistilled session was taken. '
         'THREE UNGUARDED RACES, all reachable at a 1-day window: (1) on quota_denied the distill BREAKS '
         'the loop and deliberately preserves watermarks "so tomorrow''s run resumes exactly here" '
         '(jobs/handlers/chat-profile-distill.handler.ts:55-61) — tomorrow is ~26h away, the prune is '
         '~2h20m away; (2) the LIMIT-200 remainder (handler:40-45) is ordered last_message_at ASC, so the '
         'deferred set and the prune''s target set are THE SAME ROWS, oldest-first; (3) per-session '
         'failures are fail-soft and leave the watermark unadvanced (handler:64-67). '
         'THE 19:10-DISTILL-BEFORE-21:30-PRUNE ORDERING IS AN ACCIDENT of two independently chosen cron '
         'times (lib/scheduler.ts:745-746 and :794-795): no completion check, no ordering primitive, no '
         'reference between the jobs, and both merely ENQUEUE onto the same background-job queue, so even '
         'the enqueue order does not guarantee completion order under load. '
         'WHY 7: it structurally excludes the ~26h quota-resume window, the LIMIT-200 remainder, and any '
         'plausible retry backlog. Raise days above this through the audited admin route; the floor '
         'exists so the dangerous value cannot be set at all.'
 WHERE "table_name" = 'chat_sessions';
