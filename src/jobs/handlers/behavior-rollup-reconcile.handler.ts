// ─────────────────────────────────────────────────────────────
// BEHAVIOR_ROLLUP_RECONCILE HANDLER
//
// Nightly recompute of behavior_rollup's DISTRIBUTIONAL fields from raw attention_events, plus a
// safe self-heal of the stamps. ONE idempotent statement (INSERT…SELECT…ON CONFLICT):
//
//   · tab_counts / section_expand_counts  ← recomputed from the window (a rolling reflection of recent
//                                            tab/section behaviour; this is the reconcile's real job).
//   · last_viewed_at  ← GREATEST(existing, max event)  (only ever advances)
//   · first_viewed_at ← LEAST(existing, min event)     (only ever retreats; back-fills a NULL from a
//                                                        rollup first created by a relationship event)
//   · view_count      ← set on INSERT (new rows) ONLY. It is NOT in the DO UPDATE SET, so existing rows
//     keep their ON-WRITE cumulative value. ★ Recompute-from-scratch would UNDERCOUNT once the 60-day
//     attention prune arms (older view events are gone), so on-write stays authoritative.
//
// Bounded by the number of (user, stock) pairs with attention, not by traffic. Safe to re-run.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { BehaviorRollupReconcilePayload } from "../types.js";
import { prisma } from "../../db/prisma.js";

const RECONCILE_SQL = `
WITH per_detail AS (
  SELECT user_id, stock_id, event_type, detail, count(*)::int AS n
  FROM attention_events
  GROUP BY user_id, stock_id, event_type, detail
),
agg AS (
  SELECT user_id, stock_id,
    COALESCE(sum(n) FILTER (WHERE event_type = 'view'), 0)::int AS view_count,
    jsonb_object_agg(detail, n) FILTER (WHERE event_type = 'tab' AND detail IS NOT NULL) AS tab_counts,
    jsonb_object_agg(detail, n) FILTER (WHERE event_type = 'section_expand' AND detail IS NOT NULL) AS section_expand_counts
  FROM per_detail
  GROUP BY user_id, stock_id
),
times AS (
  SELECT user_id, stock_id, min(created_at) AS first_at, max(created_at) AS last_at
  FROM attention_events
  GROUP BY user_id, stock_id
)
INSERT INTO behavior_rollup
  (id, user_id, stock_id, view_count, first_viewed_at, last_viewed_at, tab_counts, section_expand_counts, updated_at)
SELECT gen_random_uuid()::text, a.user_id, a.stock_id, a.view_count, t.first_at, t.last_at, a.tab_counts, a.section_expand_counts, now()
FROM agg a JOIN times t USING (user_id, stock_id)
ON CONFLICT (user_id, stock_id) DO UPDATE SET
  tab_counts            = EXCLUDED.tab_counts,
  section_expand_counts = EXCLUDED.section_expand_counts,
  last_viewed_at        = GREATEST(behavior_rollup.last_viewed_at, EXCLUDED.last_viewed_at),
  first_viewed_at       = LEAST(behavior_rollup.first_viewed_at, EXCLUDED.first_viewed_at),
  updated_at            = now()
`;

export async function handleBehaviorRollupReconcile(ctx: JobContext<BehaviorRollupReconcilePayload>) {
  await ctx.reportProgress(5, "Reconciling behaviour rollup from attention events");
  const rowsAffected = await prisma.$executeRawUnsafe(RECONCILE_SQL);
  await ctx.reportProgress(100, `Rollup reconcile complete — ${rowsAffected} (user, stock) rows recomputed`);
  return { rowsAffected };
}
