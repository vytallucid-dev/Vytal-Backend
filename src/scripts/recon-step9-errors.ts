// STEP 9 GATE 0 — READ-ONLY: the LIVE IngestionError contract.
// npx tsx src/scripts/recon-step9-errors.ts
import { prisma } from "../db/prisma.js";

for (const t of ["GuardType", "IngestionSeverity", "ResolutionPath", "IngestionErrorStatus"]) {
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='${t}' ORDER BY e.enumsortorder`,
  );
  console.log(`  ${t.padEnd(21)}: [${r.map((x) => x.enumlabel).join(", ")}]`);
}

const n = await prisma.ingestionError.count();
const open = await prisma.ingestionError.count({ where: { status: "open" } });
console.log(`\n  ingestion_errors: ${n} rows (${open} open)`);

const bySource = await prisma.ingestionError.groupBy({ by: ["source", "cron"], _count: true });
console.log(`  existing (source, cron) pairs — AMFI just adds a new pair, no registry:`);
for (const s of bySource) console.log(`    source=${String(s.source).padEnd(16)} cron=${s.cron}  (${s._count})`);

await prisma.$disconnect();
