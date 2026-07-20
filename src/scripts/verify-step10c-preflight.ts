// STEP 10+11 POST-BUILD — STEP 1: PRE-FLIGHT SNAPSHOT (read-only).
// The BEFORE for the storage report and the Sharpe before→after.
// npx tsx src/scripts/verify-step10c-preflight.ts
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);

// ── A. STORAGE — the BEFORE ──
hdr("A. STORAGE — BEFORE");
const db = await prisma.$queryRawUnsafe<any[]>(
  `SELECT pg_database_size(current_database()) b, pg_size_pretty(pg_database_size(current_database())) s`,
);
console.log(`  DB TOTAL: ${db[0].s}  (${(Number(db[0].b) / 1e6).toFixed(1)} MB)`);

const tabs = await prisma.$queryRawUnsafe<any[]>(`
  SELECT c.relname,
         pg_total_relation_size(c.oid) bytes,
         pg_size_pretty(pg_total_relation_size(c.oid)) total,
         pg_size_pretty(pg_relation_size(c.oid)) heap,
         pg_size_pretty(pg_indexes_size(c.oid)) idx,
         COALESCE(s.n_live_tup, 0) live, COALESCE(s.n_dead_tup, 0) dead
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  WHERE n.nspname='public' AND c.relkind='r'
  ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 12`);
console.log(`  ${"table".padEnd(24)} ${"total".padStart(10)} ${"heap".padStart(9)} ${"idx".padStart(8)}  live/dead`);
for (const t of tabs) {
  console.log(
    `  ${String(t.relname).padEnd(24)} ${String(t.total).padStart(10)} ${String(t.heap).padStart(9)} ` +
      `${String(t.idx).padStart(8)}  ${t.live}/${t.dead}`,
  );
}

// ── B. RISK-FREE INDEX DEPTH — the BEFORE ──
hdr("B. RISK-FREE INDEX DEPTH — BEFORE (expect ~1 year)");
const rf = await prisma.$queryRawUnsafe<any[]>(`
  SELECT index_name, count(*) pts, min(date) mn, max(date) mx
  FROM index_prices
  WHERE index_name IN ('Nifty 1D Rate Index','Nifty 10 yr Benchmark G-Sec',
                       'Nifty 10 yr Benchmark G-Sec (Clean Price)','Nifty Composite G-sec Index')
  GROUP BY 1 ORDER BY 1`);
for (const r of rf) {
  const yrs = (new Date(r.mx).getTime() - new Date(r.mn).getTime()) / (365.25 * 86400000);
  console.log(
    `  ${String(r.index_name).padEnd(43)} ${String(r.pts).padStart(5)} pts  ` +
      `${String(r.mn).slice(0, 15)} → ${String(r.mx).slice(0, 15)}  (${yrs.toFixed(2)} y)`,
  );
}
const ip = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n, pg_size_pretty(pg_total_relation_size('index_prices')) sz,
         count(DISTINCT index_name) names, min(date) mn, max(date) mx FROM index_prices`);
console.log(`\n  index_prices overall: ${ip[0].n} rows, ${ip[0].names} indices, ${ip[0].sz}`);
console.log(`                        ${String(ip[0].mn).slice(0, 15)} → ${String(ip[0].mx).slice(0, 15)}`);

// ── C. mf_analytics SHARPE/SORTINO COVERAGE — the BEFORE ──
hdr("C. SHARPE / SORTINO COVERAGE — BEFORE (expect 3Y/5Y = 0)");
const cov = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) rows,
         count(sharpe_1y) s1, count(sharpe_3y) s3, count(sharpe_5y) s5,
         count(sortino_1y) so1, count(sortino_3y) so3,
         count(vol_1y) v1, count(vol_3y) v3,
         count(ret_1y) r1, count(ret_3y_cagr) r3, count(ret_5y_cagr) r5
  FROM mf_analytics`);
const c = cov[0];
console.log(`  rows=${c.rows}`);
console.log(`    sharpe_1y  ${String(c.s1).padStart(5)}   sharpe_3y ${String(c.s3).padStart(5)}   sharpe_5y ${String(c.s5).padStart(5)}`);
console.log(`    sortino_1y ${String(c.so1).padStart(5)}   sortino_3y ${String(c.so3).padStart(5)}`);
console.log(`    vol_1y     ${String(c.v1).padStart(5)}   vol_3y    ${String(c.v3).padStart(5)}`);
console.log(`    ret_1y     ${String(c.r1).padStart(5)}   ret_3y    ${String(c.r3).padStart(5)}   ret_5y    ${String(c.r5).padStart(5)}`);

// The ceiling: how many funds COULD get a 3Y/5Y Sharpe once the risk-free deepens?
// (they already have the fund-side leg: a 3Y/5Y return AND a 3Y/5Y volatility)
const potential = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) FILTER (WHERE ret_3y_cagr IS NOT NULL AND vol_3y IS NOT NULL) can3,
         count(*) FILTER (WHERE ret_5y_cagr IS NOT NULL) can5
  FROM mf_analytics`);
console.log(`\n  CEILING once the risk-free deepens (fund-side leg already present):`);
console.log(`    could get sharpe_3y: ${potential[0].can3}   (has ret_3y AND vol_3y)`);
console.log(`    could get sharpe_5y: ${potential[0].can5}   (has ret_5y; vol_5y is computed, not stored)`);
console.log(`    ⇒ minus the 213 zero-dispersion funds, which stay UNDEFINED by design.`);

hdr("D. OMISSION LEDGER — BEFORE");
const om = await prisma.$queryRawUnsafe<any[]>(`
  SELECT v AS code, count(*) n
  FROM mf_analytics, LATERAL jsonb_each_text(omissions) AS kv(k, v)
  GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
for (const o of om) console.log(`    ${String(o.n).padStart(7)}  ${o.code}`);

hdr("E. BASELINE (the backfill must not touch these)");
const st = await prisma.instrument.count({ where: { assetClass: "stock" } });
const mf = await prisma.instrument.count({ where: { assetClass: "mutual_fund" } });
const fp = await prisma.$queryRawUnsafe<any[]>(`
  SELECT md5(string_agg(id||':'||isin||':'||COALESCE(stock_id,'-'),'|' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class='stock'`);
console.log(`  stocks=${st} ${st === 504 ? "✅" : "❌"}   MF=${mf} ${mf === 17567 ? "✅" : "❌"}`);
console.log(`  stock fp: ${fp[0].fp} ${fp[0].fp === "da04f158478175140addfa3b6db045ed" ? "✅" : "❌"}`);
for (const e of [
  { email: "arman.shaikh01082003@gmail.com", phs: 66 },
  { email: "amankamaljain@gmail.com", phs: 51 },
]) {
  const u = await prisma.user.findFirst({ where: { email: e.email }, select: { id: true } });
  const p = await prisma.portfolioHealthSnapshot.findFirst({
    where: { userId: u!.id }, orderBy: { createdAt: "desc" }, select: { phs: true, band: true },
  });
  console.log(`  ${p?.phs === e.phs ? "✅" : "❌"} ${e.email.padEnd(34)} phs=${p?.phs} ${p?.band}`);
}

await prisma.$disconnect();
