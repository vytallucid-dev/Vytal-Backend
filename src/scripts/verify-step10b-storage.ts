// GATE 3 — THE STORAGE PROOF (the whole premise of Option B) + the honest-empty audit.
// npx tsx src/scripts/verify-step10b-storage.ts
import { prisma } from "../db/prisma.js";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);
let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`  ${ok ? "✅" : "❌"} ${msg}`); };

// ── 1. NO RAW NAV PERSISTED, ANYWHERE ──────────────────────────
hdr("1. NO RAW NAV TABLE EXISTS — the premise of Option B");
const tabs = await prisma.$queryRawUnsafe<any[]>(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND (table_name ILIKE '%nav_history%' OR table_name ILIKE '%nav_hist%'
     OR table_name ILIKE '%scheme_nav%' OR table_name ILIKE '%mf_nav%')`);
check(tabs.length === 0, `no NAV-history table exists (found: ${tabs.map((t) => t.table_name).join(", ") || "none"})`);

// The only MF tables should be the two this step added.
const mfTabs = await prisma.$queryRawUnsafe<any[]>(`
  SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) total,
         pg_total_relation_size(c.oid) bytes, c.reltuples::bigint rows
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'mf_%'
  ORDER BY pg_total_relation_size(c.oid) DESC`);
console.log(`\n  MF tables:`);
for (const t of mfTabs) console.log(`    ${String(t.relname).padEnd(16)} ${String(t.total).padStart(9)}  ~${t.rows} rows`);

const analyticsBytes = Number(mfTabs.find((t) => t.relname === "mf_analytics")?.bytes ?? 0);
check(analyticsBytes < 10e6, `★ mf_analytics is ${(analyticsBytes / 1e6).toFixed(1)} MB — SINGLE-DIGIT MB as designed`);

// ── 2. THE 500 MB CEILING ──────────────────────────────────────
hdr("2. THE FREE-TIER CEILING");
const db = await prisma.$queryRawUnsafe<any[]>(
  `SELECT pg_database_size(current_database()) b, pg_size_pretty(pg_database_size(current_database())) s`,
);
const mb = Number(db[0].b) / 1e6;
console.log(`  database size: ${db[0].s}  (was 386 MB before Step 10)`);
check(mb < 500, `★ still under the 500 MB ceiling — ${(500 - mb).toFixed(0)} MB of headroom left`);
console.log(`  a persistent NAV-history table would have added ~2,500 MB. That is why it does not exist.`);

// ── 3. COVERAGE + HONEST-EMPTY AUDIT ───────────────────────────
hdr("3. HONEST-EMPTY — every NULL must carry a REASON");
const cov = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) total,
         count(ret_1y) r1y, count(ret_3y_cagr) r3y, count(ret_5y_cagr) r5y,
         count(vol_1y) v1y, count(sharpe_1y) s1y, count(sharpe_3y) s3y,
         count(max_drawdown_1y) dd1, count(roll_1y_n) roll,
         count(rank_bucket) ranked,
         count(*) FILTER (WHERE nav_points = 0) no_data
  FROM mf_analytics`);
const c = cov[0];
console.log(`  rows: ${c.total}`);
console.log(`    ret_1y      ${String(c.r1y).padStart(6)}   ret_3y ${String(c.r3y).padStart(6)}   ret_5y ${String(c.r5y).padStart(6)}`);
console.log(`    vol_1y      ${String(c.v1y).padStart(6)}   sharpe_1y ${String(c.s1y).padStart(6)}   sharpe_3y ${String(c.s3y).padStart(6)}`);
console.log(`    maxDD_1y    ${String(c.dd1).padStart(6)}   rolling_1y ${String(c.roll).padStart(6)}`);
console.log(`    ranked      ${String(c.ranked).padStart(6)}`);
console.log(`    no NAV in the 5y window: ${c.no_data}  (dead long before it — honest-empty, not an error)`);

// THE KEY INVARIANT: a NULL metric must have an entry in `omissions` explaining it.
// A NULL with no reason is an unexplained gap, which is exactly what this whole design forbids.
const unexplained = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n FROM mf_analytics
  WHERE ret_5y_cagr IS NULL
    AND NOT (omissions ? 'ret_5y_cagr')
    AND NOT (omissions ? '_all')`);
check(Number(unexplained[0].n) === 0, `★ every NULL ret_5y_cagr has a REASON in the ledger (${unexplained[0].n} unexplained)`);

const unexplainedSharpe = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n FROM mf_analytics
  WHERE sharpe_3y IS NULL AND NOT (omissions ? 'sharpe_3y') AND NOT (omissions ? '_all')`);
check(Number(unexplainedSharpe[0].n) === 0, `★ every NULL sharpe_3y has a REASON (${unexplainedSharpe[0].n} unexplained)`);

// Nothing is ever a fabricated ZERO.
const zeros = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n FROM mf_analytics WHERE ret_5y_cagr = 0 AND nav_points < 100`);
check(Number(zeros[0].n) === 0, `no young fund carries a fabricated 0 for its 5Y return (${zeros[0].n})`);

hdr("4. THE OMISSION LEDGER — what it actually says");
const reasons = await prisma.$queryRawUnsafe<any[]>(`
  SELECT split_part(v, ':', 1) AS reason, count(*) n
  FROM mf_analytics, LATERAL jsonb_each_text(omissions) AS kv(k, v)
  GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
for (const r of reasons) console.log(`    ${String(r.n).padStart(7)}  ${String(r.reason).slice(0, 72)}`);

hdr("5. RANK SANITY — percentile 100 = best, and ranks live inside their bucket");
const bad = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n FROM mf_analytics
  WHERE rank_1y IS NOT NULL AND (rank_1y < 1 OR rank_1y > rank_bucket_size
     OR pct_1y < 0 OR pct_1y > 100)`);
check(Number(bad[0].n) === 0, `no rank falls outside its bucket, no percentile outside 0–100 (${bad[0].n} bad)`);

const topBuckets = await prisma.$queryRawUnsafe<any[]>(`
  SELECT rank_bucket, count(*) n, min(rank_1y) best, max(rank_1y) worst
  FROM mf_analytics WHERE rank_bucket IS NOT NULL AND rank_1y IS NOT NULL
  GROUP BY 1 ORDER BY 2 DESC LIMIT 5`);
for (const b of topBuckets) {
  console.log(`    ${String(b.n).padStart(4)} funds  rank 1..${b.worst}  ${b.rank_bucket}`);
}
const tiny = await prisma.$queryRawUnsafe<any[]>(
  `SELECT count(*) n FROM mf_analytics WHERE rank_bucket IS NOT NULL AND rank_bucket_size < 5`,
);
check(Number(tiny[0].n) === 0, `no fund is ranked in a bucket of fewer than 5 (${tiny[0].n})`);

console.log(`\n${fails === 0 ? "✅ ALL STORAGE + HONEST-EMPTY PROOFS PASS" : `❌ ${fails} FAILED`}`);
await prisma.$disconnect();
process.exit(fails === 0 ? 0 : 1);
