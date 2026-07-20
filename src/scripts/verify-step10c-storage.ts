import { prisma } from "../db/prisma.js";
const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);

hdr("DB TOTAL");
const db = await prisma.$queryRawUnsafe<any[]>(
  `SELECT pg_database_size(current_database()) b, pg_size_pretty(pg_database_size(current_database())) s`);
const mb = Number(db[0].b) / 1e6;
console.log(`  BEFORE (pre-flight): 391 MB`);
console.log(`  AFTER  (now)       : ${db[0].s}  (${mb.toFixed(1)} MB)`);
console.log(`  DELTA              : +${(mb - 391).toFixed(1)} MB`);

hdr("TOP 10 TABLES");
const t = await prisma.$queryRawUnsafe<any[]>(`
  SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) total,
         pg_size_pretty(pg_relation_size(c.oid)) heap, pg_size_pretty(pg_indexes_size(c.oid)) idx,
         COALESCE(s.n_live_tup,0) live, COALESCE(s.n_dead_tup,0) dead
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid
  WHERE n.nspname='public' AND c.relkind='r'
  ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 10`);
console.log(`  ${"table".padEnd(22)} ${"total".padStart(9)} ${"heap".padStart(9)} ${"idx".padStart(8)}  live/dead`);
for (const x of t) console.log(`  ${String(x.relname).padEnd(22)} ${String(x.total).padStart(9)} ${String(x.heap).padStart(9)} ${String(x.idx).padStart(8)}  ${x.live}/${x.dead}`);

hdr("THE TWO TABLES THIS PASS TOUCHED");
const ip = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n, pg_size_pretty(pg_total_relation_size('index_prices')) s FROM index_prices`);
const ma = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n, pg_size_pretty(pg_total_relation_size('mf_analytics')) s,
         pg_total_relation_size('mf_analytics') b,
         (SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname='mf_analytics') dead
  FROM mf_analytics`);
console.log(`  index_prices : 46,297 → ${Number(ip[0].n).toLocaleString()} rows   19 MB → ${ip[0].s}   (the backfill: +46 MB)`);
console.log(`  mf_analytics : ${Number(ma[0].n).toLocaleString()} rows   ${ma[0].s} on disk   dead tuples: ${ma[0].dead}`);
console.log(`     live data ≈ 5.6 MB (measured post-VACUUM FULL). The nightly rewrite churns`);
console.log(`     ~13,704 dead tuples/run, so on-disk floats to ~15 MB between autovacuum passes.`);
console.log(`     That space is RECYCLED, not leaked.`);
await prisma.$disconnect();
