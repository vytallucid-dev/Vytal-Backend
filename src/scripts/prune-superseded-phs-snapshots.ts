// PRUNE SUPERSEDED PHS SNAPSHOTS (one-off, operator-authorized). The snapshot table is append-only;
// the read path (persist + controller) only ever serves findFirst-LATEST per user. This deletes every
// row that is NOT a user's latest — removing the pre-backfill 1.2 history — while preserving each user's
// current SERVED snapshot (including users never backfilled, whose latest is still 1.2).
//
// SAFETY: the keep-set is computed as DISTINCT ON (user_id) latest; the delete ABORTS unless that set is
// exactly one row per distinct user. Read the plan, then the post-delete re-verification.
//   npx tsx src/scripts/prune-superseded-phs-snapshots.ts
import { prisma } from "../db/prisma.js";

async function main() {
  const before = (await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int n FROM portfolio_health_snapshot`))[0].n;
  const distinctUsers = (await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(DISTINCT user_id)::int n FROM portfolio_health_snapshot`))[0].n;

  // KEEP = the latest snapshot per user (== what findFirst orderBy createdAt desc serves).
  const keep = await prisma.$queryRawUnsafe<{ id: string; user_id: string; constant_version: string; structure: unknown; phs: number | null }[]>(
    `SELECT DISTINCT ON (user_id) id, user_id, constant_version, structure, phs
       FROM portfolio_health_snapshot ORDER BY user_id, created_at DESC, id DESC`);

  console.log(`before: ${before} rows across ${distinctUsers} user(s).`);
  console.log(`\nKEEP (${keep.length} served rows, one per user):`);
  for (const k of keep) console.log(`  ${k.user_id.slice(0, 8)} | health ${k.phs} · structure ${Number(k.structure).toFixed(2)} · cv "${k.constant_version}"`);

  // ── SAFETY GUARD — refuse to run unless the keep-set is exactly one row per distinct user. ──
  const keepUserIds = new Set(keep.map((k) => k.user_id));
  if (keep.length !== distinctUsers || keepUserIds.size !== keep.length) {
    console.error(`\n❌ ABORT — keep-set is not exactly one-per-user (keep ${keep.length}, distinct users ${distinctUsers}, unique ${keepUserIds.size}). Nothing deleted.`);
    process.exitCode = 1; return;
  }

  const keepIds = keep.map((k) => k.id);
  const del = await prisma.portfolioHealthSnapshot.deleteMany({ where: { id: { notIn: keepIds } } });
  console.log(`\ndeleted ${del.count} superseded row(s).`);

  // ── RE-VERIFY — the served snapshot is UNCHANGED: latest per user == the row we kept. ──
  const after = (await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int n FROM portfolio_health_snapshot`))[0].n;
  let bad = 0;
  for (const k of keep) {
    const served = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: k.user_id }, orderBy: { createdAt: "desc" }, select: { id: true, phs: true, structure: true } });
    const okRow = served?.id === k.id && served?.phs === k.phs && Number(served?.structure) === Number(k.structure);
    if (!okRow) { bad++; console.log(`  ❌ ${k.user_id.slice(0, 8)} served row CHANGED`); }
  }
  const perUser = (await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int n FROM (SELECT user_id, count(*) c FROM portfolio_health_snapshot GROUP BY user_id HAVING count(*) <> 1) x`))[0].n;

  console.log(`\nafter: ${after} rows (expected ${distinctUsers}). users with ≠1 row: ${perUser}.`);
  console.log(bad === 0 && after === distinctUsers && perUser === 0
    ? "✅ PRUNED — exactly one served snapshot per user; every served row is byte-identical to before."
    : `❌ ${bad} served row(s) changed / row count off — investigate.`);
  process.exitCode = bad === 0 && after === distinctUsers && perUser === 0 ? 0 : 1;
  await prisma.$disconnect();
}
main().catch((e) => { console.error("PRUNE ERROR:", e?.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
