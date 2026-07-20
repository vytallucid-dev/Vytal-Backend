// CONSTRUCTION v2 — STAGE 5 — BACKFILL DRY-RUN (read-only, ruling ②). Mirrors backfillAllPhs's
// population (every user with open holdings) and, for each, computes what the mass run WOULD write —
// WRITE (fingerprint changed → a fresh Net row lands) vs SKIP (fingerprint already matches) — plus the
// exact structure move (stored displayed value → C1–C6 Net). It PERSISTS NOTHING. Run this, read the
// preview, THEN run backfill-phs-snapshots.ts for the real mass write.
//   npx tsx src/scripts/backfill-phs-snapshots-dryrun.ts
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";
import { fingerprintOf } from "../portfolio/phs/persist.js";
import { CONSTANT_VERSION } from "../portfolio/phs/constants.js";

async function main() {
  const holders = await prisma.holding.findMany({ where: { quantity: { gt: 0 } }, select: { userId: true }, distinct: ["userId"] });
  console.log(`[dry-run] CONSTANT_VERSION now = "${CONSTANT_VERSION}". Population (open holdings) = ${holders.length} user(s). Persisting NOTHING.\n`);

  let willWrite = 0, willSkip = 0, failed = 0;
  const rows: string[] = [];
  for (const { userId } of holders) {
    try {
      const { holdings, prov } = await assemblePortfolio(userId);
      const r = computePhs(holdings);
      const fresh = fingerprintOf(holdings, prov);
      const stored = await prisma.portfolioHealthSnapshot.findFirst({
        where: { userId }, orderBy: { createdAt: "desc" },
        select: { fingerprint: true, constantVersion: true, structure: true, phs: true },
      });
      const write = !stored || stored.fingerprint !== fresh;
      if (write) willWrite++; else willSkip++;
      const storedStruct = stored ? Number(stored.structure).toFixed(2) : "—";
      rows.push(`${write ? "WRITE" : "skip "} · ${userId.slice(0, 8)} · Health ${r.health} (unchanged) · Construction ${storedStruct} → ${r.construction.net.toFixed(2)} · cv ${stored?.constantVersion ?? "—"} → ${CONSTANT_VERSION}`);
    } catch (e) {
      failed++;
      rows.push(`ERROR · ${userId.slice(0, 8)} · ${(e as Error).message}`);
    }
  }
  for (const line of rows) console.log("  " + line);
  console.log(`\n[dry-run] WOULD write ${willWrite} · WOULD skip ${willSkip} · failed ${failed}. No rows written.`);
  console.log(`[dry-run] Health is unchanged for every user (the cutover moves only the Construction number).`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("DRY-RUN ERROR:", e?.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
