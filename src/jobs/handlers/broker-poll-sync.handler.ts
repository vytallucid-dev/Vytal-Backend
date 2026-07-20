// ─────────────────────────────────────────────────────────────
// BROKER_POLL_SYNC HANDLER (Step 7) — the auto-poll sweep.
//
// ONE job per firing, not one per connection. It selects every connection that is worth syncing
// right now and syncs each in turn. The 2-hour cadence lives in the SELECT, not in a timer:
//
//     enabled = true                     ← not severed (a severed feed is frozen on purpose)
//     AND session_state = 'live'         ← the token works; a dead one cannot fetch anything
//     AND (lastSyncedAt IS NULL OR lastSyncedAt < now − 2h)
//
// Because the worklist is DERIVED rather than remembered, the sweep is:
//   • self-deduping   — a connection synced 10 minutes ago simply is not selected. Two overlapping
//                       sweeps cannot double-sync it (and the scheduler's enqueueIfNotActive
//                       already prevents two sweeps from queueing at once).
//   • self-healing    — if the worker was down for six hours, the next firing picks up everything
//                       that fell behind. No backlog to replay, no missed-tick bookkeeping.
//   • stateless       — no per-connection scheduling rows to keep in sync with reality.
//
// A DEAD SESSION IS NOT AN ERROR HERE (§2.5). Kite tokens die every morning; that is routine, not
// a fault. Such a connection is simply not in the worklist. The sweep NEVER severs it, never marks
// the account linked_stale, never drops a holding — the user reconnects when they next open the
// app, and the poll resumes on its own. Conflating "token expired" with "user disconnected" is the
// §2.5 trap, and this handler is the most tempting place in the codebase to fall into it.
//
// ONE CONNECTION'S FAILURE MUST NOT SINK THE SWEEP. Each sync is caught individually: a broker
// that 500s, a session that died between the SELECT and the fetch, an adapter that throws — each
// is recorded and the sweep moves on. A sweep that aborted halfway would silently stop refreshing
// every connection after the failing one.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { BrokerPollSyncPayload } from "../types.js";
import { prisma } from "../../db/prisma.js";
import { syncHoldings, BrokerLifecycleError } from "../../brokers/lifecycle.js";

/** The cadence. Lives here (not in the cron expression) so the sweep can fire often and cheaply
 *  while each CONNECTION is still only hit every 2 hours. */
const DEFAULT_STALE_AFTER_MINUTES = 120;

export interface BrokerPollResult {
  eligible: number;
  synced: number;
  failed: number;
  /** Symbols admitted to the universe across the whole sweep (Step 7) — growing the universe is
   *  never silent, even when it happens on a background job nobody is watching. */
  admitted: string[];
  details: { connectionId: string; broker: string; outcome: string }[];
}

export async function handleBrokerPollSync(
  ctx: JobContext<BrokerPollSyncPayload>,
): Promise<BrokerPollResult> {
  const staleAfterMinutes = ctx.payload?.staleAfterMinutes ?? DEFAULT_STALE_AFTER_MINUTES;
  const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000);

  await ctx.reportProgress(2, `Selecting connections not synced since ${cutoff.toISOString()}`);

  // THE WORKLIST — the whole cadence, expressed as a query.
  const due = await prisma.brokerConnection.findMany({
    where: {
      enabled: true, // a severed connection is frozen ON PURPOSE — never resurrect it by polling
      sessionState: "live", // a dead token cannot fetch; it is skipped, NOT severed (§2.5)
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }],
      // A connection with no bound account cannot sync (§2.3 — syncHoldings refuses it). Excluding
      // it here keeps the sweep's failure count honest: an unlinked connection is not a failure,
      // it is simply not ready.
      accounts: { some: {} },
    },
    select: { id: true, userId: true, broker: true, lastSyncedAt: true },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } }, // longest-stale first
  });

  const result: BrokerPollResult = { eligible: due.length, synced: 0, failed: 0, admitted: [], details: [] };
  if (due.length === 0) {
    await ctx.reportProgress(100, "Broker poll: no connections due");
    return result;
  }

  for (const [i, conn] of due.entries()) {
    await ctx.reportProgress(
      Math.min(95, 5 + Math.round((i / due.length) * 90)),
      `Syncing ${conn.broker} connection ${i + 1}/${due.length}`,
    );
    try {
      // userId comes from the CONNECTION ROW, never from a payload — the sweep cannot be pointed
      // at another user's connection, because it never accepts a user id at all.
      const out = await syncHoldings(conn.userId, conn.id);
      result.synced++;
      result.admitted.push(...out.admitted.map((a) => a.symbol));
      result.details.push({
        connectionId: conn.id,
        broker: conn.broker,
        // `heldNotScored` is reported SEPARATELY from `unidentifiable`, and the wording is the
        // point: an ETF is a holding we understand completely and simply do not score, while an
        // unidentifiable row is one we could not name at all. Logging them under one label would
        // make a healthy ETF read as a data fault in the sweep's outcome line.
        outcome:
          `synced ${out.synced} (mapped ${out.mapped}` +
          (out.admitted.length ? `, admitted ${out.admitted.map((a) => a.symbol).join("/")}` : "") +
          (out.heldNotScored.length ? `, held-not-scored ${out.heldNotScored.map((h) => `${h.symbol}:${h.assetClass}`).join("/")}` : "") +
          (out.unmapped.length ? `, unidentifiable ${out.unmapped.join("/")}` : "") +
          ")",
      });
    } catch (e) {
      result.failed++;
      // A session that died between the SELECT and the fetch is the COMMON case, not an anomaly:
      // syncHoldings has already marked it dead. Nothing else to do — the next sweep will not
      // select it, and the user will reconnect. It is recorded, not escalated.
      const outcome =
        e instanceof BrokerLifecycleError
          ? `${e.code}: ${e.message}`
          : `error: ${(e as Error).message}`;
      result.details.push({ connectionId: conn.id, broker: conn.broker, outcome });
      console.error(`[broker-poll] ${conn.broker} connection ${conn.id} — ${outcome}`);
    }
  }

  await ctx.reportProgress(
    100,
    `Broker poll: ${result.synced}/${result.eligible} synced · ${result.failed} failed` +
      (result.admitted.length ? ` · admitted ${result.admitted.join(", ")}` : ""),
  );
  return result;
}
