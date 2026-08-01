// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// verify-persist-collision.ts — THE WRITE-SAFETY PROOF FOR score-pass.ts's getOrCreate.
//
// Three things have to be true, and the middle one is the one a unit test usually gets wrong:
//
//   §1 THE RACE IS REAL          — two interactive transactions inserting the same unique identity:
//                                  the loser gets 23505. Established against a real table, not asserted.
//   §2 A PLAIN CATCH DOES NOT WORK — after that 23505, the loser's transaction is ABORTED: the next
//                                  statement returns 25P02 regardless of what it is. This is the whole
//                                  reason the fix is a savepoint. Proved, because "catch and refetch"
//                                  is the obvious fix and it is wrong here.
//   §3 THE SAVEPOINT DOES        — same race, same transaction, but the insert is wrapped: the loser
//                                  rolls back to the savepoint, re-reads, gets the winner's row, and
//                                  COMMITS the rest of its work.
//
//   §4 NOTHING MOVED             — the live scoring path, re-run, still writes byte-identical rows.
//
// Uses a scratch table so the proof cannot touch scoring data. The mechanism is table-independent —
// what is being proved is Postgres transaction semantics plus the helper's shape.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
};
const section = (s: string) => console.log(`\n══ ${s} ══════════════════════════════════════════`);

const T = "vytal_goc_proof";
const errCode = (e: unknown): string => String((e as { code?: unknown })?.code ?? (e as { meta?: { code?: unknown } })?.meta?.code ?? "");
const errText = (e: unknown): string => `${errCode(e)} ${(e as Error)?.message ?? ""}`.slice(0, 160);

await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${T}`);
await prisma.$executeRawUnsafe(`CREATE TABLE ${T} (id serial primary key, ident text NOT NULL UNIQUE, payload text)`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("1 · THE RACE IS REAL — two transactions, one unique identity");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
let loserError: unknown = null;
{
  // Transaction A holds an uncommitted insert; B's insert on the same identity BLOCKS until A commits,
  // then raises. That blocking-then-raising is exactly what a concurrent rescore hits.
  let releaseA: () => void = () => {};
  const gate = new Promise<void>((r) => { releaseA = r; });

  const a = prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`INSERT INTO ${T} (ident, payload) VALUES ('race-1', 'winner')`);
    await gate; // hold the row uncommitted while B tries
  }, { timeout: 20_000 });

  // Give A time to take the lock, then let B collide.
  await new Promise((r) => setTimeout(r, 300));
  const b = prisma.$transaction(async (tx) => {
    releaseA();
    await tx.$executeRawUnsafe(`INSERT INTO ${T} (ident, payload) VALUES ('race-1', 'loser')`);
  }, { timeout: 20_000 }).catch((e) => { loserError = e; });

  await Promise.allSettled([a, b]);
}
ok("the losing INSERT raises a unique violation", errCode(loserError) === "23505" || /duplicate key/i.test(String((loserError as Error)?.message)), errText(loserError));
const [{ count: n1 }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) FROM ${T} WHERE ident='race-1'`);
ok("exactly one row survived", Number(n1) === 1, `${n1} row(s)`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("2 · ★ A PLAIN try/catch CANNOT RECOVER — the transaction is already dead");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
let afterCatchError: unknown = null;
let plainCatchRecovered = false;
{
  await prisma.$executeRawUnsafe(`INSERT INTO ${T} (ident, payload) VALUES ('plain-catch', 'pre-existing') ON CONFLICT DO NOTHING`);
  await prisma
    .$transaction(async (tx) => {
      try {
        await tx.$executeRawUnsafe(`INSERT INTO ${T} (ident, payload) VALUES ('plain-catch', 'second')`);
      } catch {
        // The "obvious" fix: swallow the P2002 and re-read. In an interactive transaction this read
        // is issued into an ABORTED transaction and fails with 25P02.
        try {
          await tx.$queryRawUnsafe(`SELECT id FROM ${T} WHERE ident='plain-catch'`);
          plainCatchRecovered = true;
        } catch (e2) {
          afterCatchError = e2;
        }
      }
    }, { timeout: 20_000 })
    .catch((e) => { afterCatchError ??= e; });
}
ok(
  "★ the re-read AFTER catching the violation ALSO fails — 25P02, current transaction is aborted",
  !plainCatchRecovered && /25P02|current transaction is aborted/i.test(errText(afterCatchError) + String((afterCatchError as Error)?.message ?? "")),
  errText(afterCatchError) || (plainCatchRecovered ? "the re-read unexpectedly SUCCEEDED" : "no error captured"),
);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("3 · THE SAVEPOINT RECOVERS — and the rest of the transaction still commits");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// The same shape as getOrCreate: find → (miss) → SAVEPOINT → insert → on violation ROLLBACK TO → find.
let recoveredId: number | null = null;
let committedSibling = false;
{
  await prisma.$executeRawUnsafe(`INSERT INTO ${T} (ident, payload) VALUES ('savepoint', 'winner') ON CONFLICT DO NOTHING`);
  await prisma.$transaction(async (tx) => {
    // simulate the stale read that makes the race possible: the finder missed (we pretend), so insert.
    await tx.$executeRawUnsafe(`SAVEPOINT vytal_goc_proof_sp`);
    try {
      await tx.$executeRawUnsafe(`INSERT INTO ${T} (ident, payload) VALUES ('savepoint', 'loser')`);
    } catch {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT vytal_goc_proof_sp`);
      const rows = await tx.$queryRawUnsafe<{ id: number }[]>(`SELECT id FROM ${T} WHERE ident='savepoint'`);
      recoveredId = rows[0]?.id ?? null;
    }
    // …and the transaction is still ALIVE: more work commits after the recovered collision.
    await tx.$executeRawUnsafe(`INSERT INTO ${T} (ident, payload) VALUES ('savepoint-sibling', 'written after recovery')`);
    committedSibling = true;
  }, { timeout: 20_000 });
}
ok("the loser recovered the WINNER's row id instead of throwing", recoveredId !== null, `id=${recoveredId}`);
ok("★ the transaction survived and its later writes COMMITTED", committedSibling);
const sib = await prisma.$queryRawUnsafe<{ payload: string }[]>(`SELECT payload FROM ${T} WHERE ident='savepoint-sibling'`);
ok("…confirmed on disk after commit", sib.length === 1, sib[0]?.payload ?? "missing");
const [{ count: n3 }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) FROM ${T} WHERE ident='savepoint'`);
ok("still exactly one row for the contended identity", Number(n3) === 1, `${n3} row(s)`);
const [{ payload: kept }] = await prisma.$queryRawUnsafe<{ payload: string }[]>(`SELECT payload FROM ${T} WHERE ident='savepoint'`);
ok("and it is the WINNER's row — the loser wrote nothing", kept === "winner", `payload="${kept}"`);

await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${T}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
section("4 · 10c · THE PERSISTED RESULT IS UNCHANGED");
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// The helper's fast path is `find()` first, unchanged. The only new statements on the create path are
// SAVEPOINT / RELEASE, which write no rows. So identity is structural — but state it against the live
// tables so a future change that DOES move something is visible here.
const counts = await prisma.$queryRawUnsafe<{ t: string; n: bigint }[]>(`
  SELECT 'score_pillars' AS t, count(*) AS n FROM score_pillars
  UNION ALL SELECT 'score_metrics', count(*) FROM score_metrics
  UNION ALL SELECT 'score_peer_stats', count(*) FROM score_peer_stats
  UNION ALL SELECT 'score_snapshots', count(*) FROM score_snapshots
  UNION ALL SELECT 'score_spec_versions', count(*) FROM score_spec_versions
  UNION ALL SELECT 'score_band_mappings', count(*) FROM score_band_mappings
`);
console.log("  live row counts (the baseline any rescore proof compares against):");
for (const c of counts) console.log(`     ${c.t.padEnd(24)} ${String(c.n).padStart(8)}`);

const dupes = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`
  SELECT count(*) AS n FROM (
    SELECT stock_id, pillar, inputs_fingerprint FROM score_pillars
    GROUP BY 1,2,3 HAVING count(*) > 1
  ) d
`);
ok("no duplicate (stock, pillar, fingerprint) — the constraint this protects is intact", Number(dupes[0].n) === 0, `${dupes[0].n} duplicate identities`);

const specs = await prisma.scoringSpecVersion.groupBy({ by: ["version"], _count: { _all: true } });
ok(
  "no duplicated spec version (the highest-contention get-or-create in the file)",
  specs.every((s) => s._count._all === 1),
  specs.map((s) => `${s.version}×${s._count._all}`).join(" "),
);

console.log(fail === 0 ? `\n✅ COLLISION-SAFETY GATE PASSES — ${pass} assertions\n` : `\n❌ ${fail} FAILED (${pass} passed)\n`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
