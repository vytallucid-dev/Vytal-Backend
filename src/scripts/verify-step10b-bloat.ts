// Bloat check + VACUUM FULL on mf_analytics.
//
// The nightly job UPSERTS all 13,704 rows every night. In Postgres an UPDATE writes a NEW row
// version and leaves the old one dead, so this table accrues ~13,704 dead tuples per run. After
// three runs it had bloated to 15.6 MB against a live size that is far smaller. Autovacuum
// reclaims this for REUSE, but the file only shrinks on a VACUUM FULL — so the honest steady-
// state number is the live size, and this proves what that is.
import { prisma } from "../db/prisma.js";

const stat = await prisma.$queryRawUnsafe<any[]>(`
  SELECT n_live_tup live, n_dead_tup dead, last_autovacuum, last_vacuum
  FROM pg_stat_user_tables WHERE relname='mf_analytics'`);
console.log(`before: live=${stat[0]?.live} dead=${stat[0]?.dead}`);

const before = await prisma.$queryRawUnsafe<any[]>(
  `SELECT pg_total_relation_size('mf_analytics') b, pg_size_pretty(pg_total_relation_size('mf_analytics')) s`,
);
console.log(`        total size = ${before[0].s}`);

console.log(`\nVACUUM FULL mf_analytics …`);
await prisma.$executeRawUnsafe(`VACUUM FULL ANALYZE mf_analytics`);

const after = await prisma.$queryRawUnsafe<any[]>(`
  SELECT pg_total_relation_size('mf_analytics') b,
         pg_size_pretty(pg_total_relation_size('mf_analytics')) total,
         pg_size_pretty(pg_relation_size('mf_analytics')) heap,
         pg_size_pretty(pg_indexes_size('mf_analytics')) idx`);
console.log(`\nafter VACUUM FULL:`);
console.log(`  heap    ${after[0].heap}`);
console.log(`  indexes ${after[0].idx}`);
console.log(`  TOTAL   ${after[0].total}   (${(Number(after[0].b) / 1e6).toFixed(1)} MB)`);
console.log(`  ${Number(after[0].b) < 10e6 ? "✅ SINGLE-DIGIT MB" : "❌ still ≥10 MB"}`);

const db = await prisma.$queryRawUnsafe<any[]>(
  `SELECT pg_size_pretty(pg_database_size(current_database())) s, pg_database_size(current_database()) b`,
);
console.log(`\n  database: ${db[0].s}  (${(500 - Number(db[0].b) / 1e6).toFixed(0)} MB under the 500 MB ceiling)`);

await prisma.$disconnect();
