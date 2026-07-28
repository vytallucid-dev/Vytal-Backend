// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BEHAVIOUR TRACKING — the core write layer (Phase 1).
//
// Two entry points, two very different write profiles:
//   · emitRelationshipEvent — SERVER-SIDE, from the existing mutations (watchlist/alert/position).
//     Rare. Best-effort: it runs AFTER the mutation has committed, and a failure is SWALLOWED —
//     tracking can never break a page (the exact posture refreshPhsForUser keeps).
//   · foldAttentionBatch — the ingest endpoint's fold. High-volume, batched: bulk-insert the raw
//     events, then fold the batch into ONE behavior_rollup upsert PER DISTINCT STOCK (never per event).
//
// The rollup is the durable read model (the only thing the AI will read). Scalar counters/stamps are
// written here on-write; the distributional JSON (tab/section) is left to the nightly reconcile.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import { getLatestSnapshotRef } from "../scoring/read/scoring-read.service.js";

// ── Event vocabularies (mirror the SQL CHECK constraints) ──────────────────────────────────────────
export const RELATIONSHIP_EVENT_TYPES = [
  "watchlist_added",
  "watchlist_removed",
  "position_opened",
  "position_closed",
  "alert_set",
  "alert_removed",
] as const;
export type RelationshipEventType = (typeof RELATIONSHIP_EVENT_TYPES)[number];

export const ATTENTION_EVENT_TYPES = ["view", "tab", "section_expand", "comparison", "tool"] as const;
export type AttentionEventType = (typeof ATTENTION_EVENT_TYPES)[number];

export interface AttentionEventInput {
  stockId: string;
  eventType: AttentionEventType;
  detail?: string | null;
  dwellMs?: number | null;
}

// ── The rollup mutation for one relationship event. Raw ON-CONFLICT so it is ONE atomic statement
//    with the right semantics per event: a stamp (set now()), or an alert counter (increment / clamped
//    decrement). eventType is validated by the caller and every SQL fragment below is a constant — no
//    user input is interpolated. ──
const ROLLUP_BUMP: Record<RelationshipEventType, { col: string; val: string; set: string }> = {
  watchlist_added: { col: `"watchlist_added_at"`, val: `now()`, set: `"watchlist_added_at" = now()` },
  watchlist_removed: { col: `"watchlist_removed_at"`, val: `now()`, set: `"watchlist_removed_at" = now()` },
  position_opened: { col: `"position_opened_at"`, val: `now()`, set: `"position_opened_at" = now()` },
  position_closed: { col: `"position_closed_at"`, val: `now()`, set: `"position_closed_at" = now()` },
  alert_set: { col: `"alert_count"`, val: `1`, set: `"alert_count" = "behavior_rollup"."alert_count" + 1` },
  // clamped: a stray removal must never drive the count below zero.
  alert_removed: { col: `"alert_count"`, val: `0`, set: `"alert_count" = GREATEST(0, "behavior_rollup"."alert_count" - 1)` },
};

async function bumpRollupForRelationship(
  tx: Prisma.TransactionClient,
  userId: string,
  stockId: string,
  eventType: RelationshipEventType,
): Promise<void> {
  const m = ROLLUP_BUMP[eventType];
  await tx.$executeRawUnsafe(
    `INSERT INTO "behavior_rollup" ("id","user_id","stock_id",${m.col},"updated_at")
     VALUES ($1,$2,$3,${m.val},now())
     ON CONFLICT ("user_id","stock_id") DO UPDATE SET ${m.set}, "updated_at" = now()`,
    randomUUID(),
    userId,
    stockId,
  );
}

/**
 * Record ONE relationship event + fold it into the rollup, best-effort.
 *
 * ★ NEVER THROWS. Call it AFTER the mutation has committed; a tracking failure is logged and
 * swallowed, so it can never turn a successful watchlist add / trade into a 500. The nightly reconcile
 * is the backstop for anything a dropped write here misses.
 */
export async function emitRelationshipEvent(
  userId: string,
  stockId: string,
  eventType: RelationshipEventType,
  detail: string | null = null,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.relationshipEvent.create({ data: { userId, stockId, eventType, detail } });
      await bumpRollupForRelationship(tx, userId, stockId, eventType);
    });
  } catch (err) {
    console.warn(
      `[tracking] relationship emit ${eventType} (user ${userId.slice(0, 8)} stock ${stockId.slice(0, 8)}) failed — swallowed: ${(err as Error).message}`,
    );
  }
}

/** Does the user hold an OPEN position (qty > 0) in this stock, across any account? The open/close
 *  signal is stock-level (a user can hold one stock in several accounts), computed before vs after a
 *  trade so a partial position change in one account never mis-fires an open/close. */
export async function userHoldsStock(userId: string, stockId: string): Promise<boolean> {
  const n = await prisma.holding.count({ where: { userId, stockId, quantity: { gt: 0 } } });
  return n > 0;
}

/**
 * Fold a batch of attention events: bulk-insert the raw rows, then upsert the rollup ONCE PER DISTINCT
 * STOCK (never per event). Scalar-only here (viewCount + first/last stamps) — the distributional JSON
 * is the nightly reconcile's job. `firstViewedAt` is set on CREATE only; the reconcile back-fills it for
 * a rollup first created by a relationship event.
 *
 * Not best-effort-swallowing: the ingest controller owns error handling (it returns a fast beacon
 * response and logs). This function does the work and reports the counts.
 */
export async function foldAttentionBatch(
  userId: string,
  events: AttentionEventInput[],
): Promise<{ inserted: number; stocksFolded: number }> {
  if (events.length === 0) return { inserted: 0, stocksFolded: 0 };

  await prisma.attentionEvent.createMany({
    data: events.map((e) => ({
      userId,
      stockId: e.stockId,
      eventType: e.eventType,
      detail: e.detail ?? null,
      dwellMs: e.dwellMs ?? null,
    })),
  });

  // Aggregate the batch → one rollup write per distinct stock. Any attention bumps lastViewedAt;
  // only a "view" event increments viewCount.
  const now = new Date();
  const viewsByStock = new Map<string, number>();
  for (const e of events) {
    viewsByStock.set(e.stockId, (viewsByStock.get(e.stockId) ?? 0) + (e.eventType === "view" ? 1 : 0));
  }

  // ── The snapshot generation in force NOW, per distinct stock — stamped alongside lastViewedAt so the
  //    delta family (Relational UD9) can later say "new snapshot since you last looked". ONE ref lookup
  //    per distinct stock (not per event); best-effort: a stock with no in-force snapshot resolves null
  //    (unscored at view time — honest), and a failed lookup degrades to null rather than losing the
  //    whole fold. This is off the read-critical path (a beacon), so the extra lookups are not part of
  //    the relational read budget. ──
  const generationByStock = new Map<string, string | null>();
  await Promise.all(
    [...viewsByStock.keys()].map(async (stockId) => {
      try {
        const ref = await getLatestSnapshotRef(stockId);
        generationByStock.set(stockId, ref?.id ?? null);
      } catch {
        generationByStock.set(stockId, null); // never let generation resolution break view tracking
      }
    }),
  );

  for (const [stockId, views] of viewsByStock) {
    const generation = generationByStock.get(stockId) ?? null;
    await prisma.behaviorRollup.upsert({
      where: { userId_stockId: { userId, stockId } },
      create: {
        userId,
        stockId,
        viewCount: views,
        firstViewedAt: now,
        lastViewedAt: now,
        lastViewedSnapshotGeneration: generation,
      },
      // Only overwrite the stamped generation when we actually resolved one — a transient null (lookup
      // failure / unscored moment) must not erase a good generation from a prior view.
      update: {
        viewCount: { increment: views },
        lastViewedAt: now,
        ...(generation !== null ? { lastViewedSnapshotGeneration: generation } : {}),
      },
    });
  }

  return { inserted: events.length, stocksFolded: viewsByStock.size };
}
