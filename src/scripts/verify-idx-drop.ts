// Index-drop verification. Run with `before` or `after`.
import { prisma } from "../db/prisma.js";
const mode = process.argv[2] ?? "before";
const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);

hdr(`STORAGE — ${mode.toUpperCase()}`);
const db = await prisma.$queryRawUnsafe<any[]>(
  `SELECT pg_database_size(current_database()) b, pg_size_pretty(pg_database_size(current_database())) s`);
console.log(`  DB total     : ${db[0].s}   (${Number(db[0].b).toLocaleString()} bytes)`);
for (const t of ["daily_prices", "index_prices"]) {
  const x = await prisma.$queryRawUnsafe<any[]>(
    `SELECT pg_size_pretty(pg_total_relation_size('${t}')) tot,
            pg_size_pretty(pg_relation_size('${t}')) heap,
            pg_size_pretty(pg_indexes_size('${t}')) idx`);
  console.log(`  ${t.padEnd(13)}: ${x[0].tot}  (heap ${x[0].heap} + idx ${x[0].idx})`);
}

hdr("INDEXES PRESENT");
const idx = await prisma.$queryRawUnsafe<any[]>(`
  SELECT relname tbl, indexrelname ix, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) sz
  FROM pg_stat_user_indexes WHERE relname IN ('daily_prices','index_prices')
  ORDER BY relname, pg_relation_size(indexrelid) DESC`);
for (const x of idx) {
  console.log(`  ${String(x.tbl).padEnd(13)} ${String(x.ix).padEnd(34)} ${String(x.sz).padStart(8)} ${String(x.idx_scan).padStart(8)} scans`);
}
console.log(`  → ${idx.length} indexes across the two tables`);

hdr("HOT PATH — EXPLAIN ANALYZE");
const one = await prisma.$queryRawUnsafe<any[]>(`SELECT stock_id FROM daily_prices LIMIT 1`);
const p = await prisma.$queryRawUnsafe<any[]>(
  `EXPLAIN (ANALYZE) SELECT * FROM daily_prices WHERE stock_id = $1 ORDER BY date DESC LIMIT 250`,
  one[0].stock_id);
for (const x of p) console.log(`  ${Object.values(x)[0]}`);

hdr("BASELINE");
const st = await prisma.instrument.count({ where: { assetClass: "stock" } });
const mf = await prisma.instrument.count({ where: { assetClass: "mutual_fund" } });
const dp = await prisma.dailyPrice.count();
const ip = await prisma.indexPrice.count();
const fp = await prisma.$queryRawUnsafe<any[]>(`
  SELECT md5(string_agg(id||':'||isin||':'||COALESCE(stock_id,'-'),'|' ORDER BY isin)) fp
  FROM instruments WHERE asset_class='stock'`);
console.log(`  stocks=${st} ${st===504?"✅":"❌"}  MF=${mf} ${mf===17567?"✅":"❌"}`);
console.log(`  daily_prices rows=${dp.toLocaleString()}   index_prices rows=${ip.toLocaleString()}`);
console.log(`  stock fp: ${fp[0].fp} ${fp[0].fp==="da04f158478175140addfa3b6db045ed"?"✅":"❌"}`);
for (const e of [
  { email: "arman.shaikh01082003@gmail.com", phs: 66 },
  { email: "amankamaljain@gmail.com", phs: 51 },
]) {
  const u = await prisma.user.findFirst({ where: { email: e.email }, select: { id: true } });
  const ps = await prisma.portfolioHealthSnapshot.findFirst({
    where: { userId: u!.id }, orderBy: { createdAt: "desc" }, select: { phs: true, band: true } });
  console.log(`  ${ps?.phs===e.phs?"✅":"❌"} ${e.email.padEnd(34)} phs=${ps?.phs} ${ps?.band}`);
}
await prisma.$disconnect();
