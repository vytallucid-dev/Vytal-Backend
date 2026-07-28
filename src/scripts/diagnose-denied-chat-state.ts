// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC — the quota-denied chat state, before the fix.
//
// Answers three questions with the live corpus, and asserts NOTHING (read-only):
//   1. How many chat sessions have NO real exchange at all (only the hidden opening scaffolding)?
//      Those are the "empty New conversation" rows the reader sees in the list.
//   2. How are they split by origin / promoted — i.e. which of them the 24h prune can currently reach?
//   3. What does the live retention_policy row for chat_sessions actually say?
//
//   npx tsx src/scripts/diagnose-denied-chat-state.ts      (from Vytal-Backend — needs .env)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const rows = async <T>(sql: string): Promise<T[]> => prisma.$queryRawUnsafe<T[]>(sql);

async function main() {
  const totals = await rows<{ sessions: number; messages: number }>(
    `SELECT (SELECT count(*)::int FROM chat_sessions) AS sessions,
            (SELECT count(*)::int FROM chat_messages) AS messages`,
  );
  console.log(`\ncorpus: ${totals[0].sessions} chat_sessions · ${totals[0].messages} chat_messages`);

  // "Empty" = no non-opening message of any kind. The chat_page opening row is hidden scaffolding, so a
  // session with only that row renders as a blank "New conversation".
  const empty = await rows<{ origin: string; promoted: boolean; n: number; oldest: Date; newest: Date }>(
    `SELECT s.origin, s.promoted, count(*)::int AS n, min(s.created_at) AS oldest, max(s.created_at) AS newest
       FROM chat_sessions s
      WHERE NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id AND m.is_opening = false)
      GROUP BY s.origin, s.promoted
      ORDER BY s.origin, s.promoted`,
  );
  console.log("\nsessions with NO real exchange (only the hidden opening row):");
  if (empty.length === 0) console.log("  (none)");
  for (const r of empty) {
    console.log(
      `  origin=${r.origin.padEnd(9)} promoted=${String(r.promoted).padEnd(5)} → ${String(r.n).padStart(4)}` +
        `   oldest ${new Date(r.oldest).toISOString().slice(0, 10)} · newest ${new Date(r.newest).toISOString().slice(0, 10)}`,
    );
  }

  // Of those, which does the CURRENT prune (time / last_message_at / 1d / unpromoted_only) reach?
  const reach = await rows<{ prunable_now: number; spared_by_promoted: number }>(
    `SELECT
       count(*) FILTER (WHERE s.promoted = false AND s.last_message_at < now() - interval '1 day')::int AS prunable_now,
       count(*) FILTER (WHERE s.promoted = true)::int AS spared_by_promoted
     FROM chat_sessions s
     WHERE NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id AND m.is_opening = false)`,
  );
  console.log(
    `\n  of those: ${reach[0].prunable_now} already reachable by the 1d unpromoted prune · ` +
      `${reach[0].spared_by_promoted} spared forever by promoted=true (chat_page is born promoted)`,
  );

  // Sessions that DO have messages but never a delivered assistant reply — must NOT be swept.
  const noReply = await rows<{ n: number }>(
    `SELECT count(*)::int AS n FROM chat_sessions s
      WHERE EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id AND m.is_opening = false)
        AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id AND m.is_opening = false AND m.role = 'assistant')`,
  );
  console.log(`  sessions WITH a message but no assistant reply (must survive any cleanup): ${noReply[0].n}`);

  const policy = await rows<Record<string, unknown>>(
    `SELECT mode, days, floor, ts_column, except_where, enabled, armed FROM retention_policy WHERE table_name = 'chat_sessions'`,
  );
  console.log("\nretention_policy[chat_sessions]:", policy[0] ?? "(no row)");

  const cols = await rows<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'chat_messages' ORDER BY ordinal_position`,
  );
  console.log("\nchat_messages columns:", cols.map((c) => c.column_name).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
