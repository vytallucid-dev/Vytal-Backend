// READ-ONLY recon for the scheduler-hazard ruling (ODL cv2-scheduler-hazard). Shows, per test user, the
// last few snapshot rows (createdAt · constantVersion · structure · whether construction_data is present)
// so we can SEE the stale cv-1.2 writer's footprint before/after stopping the zombie, and confirm no NEW
// cv-1.2 row appears once it is gone. Also a 24h roll-up of rows by constantVersion.
//   node_modules/.bin/tsx src/scripts/recon-scheduler-hazard.ts
import { prisma } from "../db/prisma.js";

const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);

async function main() {
  const users = (await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM transactions`)).map((u) => u.user_id);
  console.log("Per-user latest 3 snapshots (newest first) — createdAt · cv · structure · construction_data:\n");
  for (const uid of users.sort()) {
    const rows = await prisma.portfolioHealthSnapshot.findMany({
      where: { userId: uid }, orderBy: { createdAt: "desc" }, take: 3,
      select: { createdAt: true, constantVersion: true, structure: true, phs: true, constructionData: true },
    });
    console.log(`  ${uid.slice(0, 8)}`);
    for (const r of rows) {
      const cd = r.constructionData == null ? "cd=NULL" : "cd=present";
      console.log(`    ${r.createdAt.toISOString()} · cv=${r.constantVersion} · struct=${r.structure == null ? "null" : Number(r.structure).toFixed(2)} · phs=${r.phs} · ${cd}`);
    }
  }
  console.log("\nRows created in the last 24h, grouped by constantVersion:");
  const roll = await q<{ cv: string; n: number; newest: Date }>(
    `SELECT constant_version AS cv, COUNT(*)::int AS n, MAX(created_at) AS newest
     FROM portfolio_health_snapshot WHERE created_at > NOW() - INTERVAL '24 hours'
     GROUP BY constant_version ORDER BY MAX(created_at) DESC`);
  for (const r of roll) console.log(`  cv=${r.cv} · ${r.n} row(s) · newest ${new Date(r.newest).toISOString()}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("RECON ERROR:", e?.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
