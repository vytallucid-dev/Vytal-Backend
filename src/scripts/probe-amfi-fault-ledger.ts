// Read-only. verify-step9 asserts "15 OPEN amfi faults". Live reads 0 open.
// The question that decides whether that is a REGRESSION or a LIFECYCLE EVENT:
// were the 15 faults RESOLVED (audit trail intact) or DELETED (audit trail destroyed)?
import { prisma } from "../db/prisma.js";
import { AMFI_CRON } from "../ingestions/amfi/amfi-parse.js";

const q = (s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<any[]>(s, ...p);

console.log(`AMFI_CRON = ${AMFI_CRON}\n`);
const all = await q(
  `SELECT guard_type::text gt, status::text st, severity::text sev, resolution_path::text rp,
          count(*)::int n, min(created_at) first_seen, max(resolved_at) last_resolved,
          string_agg(DISTINCT COALESCE(resolved_by,'—'), ', ') AS resolved_by
     FROM ingestion_errors WHERE cron = $1
     GROUP BY 1,2,3,4 ORDER BY 1,2`,
  AMFI_CRON,
);
console.log("EVERY amfi_nav_daily ingestion_error, by (guard, status):");
for (const r of all) {
  console.log(
    `  ${String(r.gt).padEnd(12)} ${String(r.st).padEnd(9)} ${String(r.sev).padEnd(9)} ${String(r.rp).padEnd(12)}` +
      ` n=${String(r.n).padStart(3)}  first=${new Date(r.first_seen).toISOString().slice(0, 19)}` +
      `  resolved=${r.last_resolved ? new Date(r.last_resolved).toISOString().slice(0, 19) : "—"}  by=${r.resolved_by}`,
  );
}
const tot = all.reduce((a, r) => a + r.n, 0);
console.log(`\n  TOTAL amfi rows still in the table: ${tot}`);
console.log(`  → If 10 validity + 5 uniqueness are PRESENT (any status), the audit trail is INTACT`);
console.log(`    and "0 open" is a RESOLUTION, not a deletion. If they are GONE, that is a real loss.`);

const notes = await q(
  `SELECT guard_type::text gt, status::text st, observed, resolution_note, resolved_by
     FROM ingestion_errors WHERE cron = $1 AND guard_type IN ('validity','uniqueness')
     ORDER BY guard_type, observed LIMIT 20`,
  AMFI_CRON,
);
console.log(`\nThe individual ISIN faults (the 10 junk + 5 duplicate):`);
for (const n of notes) {
  console.log(`  ${String(n.gt).padEnd(11)} ${String(n.st).padEnd(9)} observed=${JSON.stringify(n.observed)} by=${n.resolved_by ?? "—"} note=${JSON.stringify(n.resolution_note ?? null)}`);
}

await prisma.$disconnect();
