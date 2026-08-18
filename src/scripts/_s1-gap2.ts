import "dotenv/config";
import { prisma } from "../db/prisma.js";
const raw = async <T=Record<string,unknown>>(s:string,...p:unknown[]):Promise<T[]> => (await prisma.$queryRawUnsafe(s,...p)) as T[];
const pad=(s:unknown,n:number)=>String(s).padEnd(n); const lpad=(s:unknown,n:number)=>String(s).padStart(n);

console.log("── A) PEER GROUP COVERAGE ──");
const [pg] = await raw(`SELECT (SELECT count(*)::int FROM peer_groups) pgs,
  (SELECT count(*)::int FROM stock_peer_groups) memberships,
  (SELECT count(DISTINCT "stock_id")::int FROM stock_peer_groups) stocks_in_pg,
  (SELECT count(*)::int FROM stocks) total_stocks`);
console.log(`  peer_groups=${pg.pgs} · memberships=${pg.memberships} · distinct stocks in a PG=${pg.stocks_in_pg} / ${pg.total_stocks}`);
console.log(`  → ${Number(pg.total_stocks)-Number(pg.stocks_in_pg)} stocks belong to NO peer group`);

console.log("\n── B) NSE INDEX ROSTER GROWTH (indices present per archive date) ──");
const roster = await raw(`SELECT EXTRACT(year FROM "date")::int y, count(DISTINCT "index_name")::int idx,
  count(DISTINCT "date")::int days, min("date")::text first FROM index_prices GROUP BY 1 ORDER BY 1`);
for (const r of roster) console.log(`    ${r.y}: ${lpad(r.idx,4)} distinct indices across ${lpad(r.days,4)} dates (first ${r.first})`);
const probe = await raw(`SELECT "date"::text d, count(*)::int n FROM index_prices
  WHERE "date" IN (DATE '2021-08-02', DATE '2021-12-15', DATE '2022-01-31', DATE '2023-04-12', DATE '2026-08-14')
  GROUP BY 1 ORDER BY 1`);
console.log("  indices present on specific archive dates:");
for (const r of probe) console.log(`    ${r.d}: ${r.n} indices`);

console.log("\n── C) THE 11 FAILING SECTOR INDICES — first bar vs the deep-run floor (2021-07-14) ──");
const ELEVEN = ["Nifty Capital Goods","Nifty Capital Markets","Nifty Cement","Nifty Chemicals",
  "Nifty Consumer Services","Nifty Insurance","Nifty India Infrastructure & Logistics",
  "Nifty Financial Services Ex-Bank","Nifty India Digital","Nifty Power","Nifty Telecommunications"];
for (const i of ELEVEN) {
  const [r] = await raw(`SELECT min("date")::text first, count(*)::int n,
    count(DISTINCT "provider")::int provs, string_agg(DISTINCT "provider", ',') p FROM index_prices WHERE "index_name"=$1`, i);
  console.log(`    ${pad(i,42)} first=${pad(r.first,12)} rows=${lpad(r.n,5)} provider=${r.p}`);
}
console.log(`  A deep NSE run reached 2021-07-14 and wrote 163 indices. Any index whose first bar is LATER than that`);
console.log(`  was absent from the archive on those dates → SOURCE gap, not a backfill-depth gap.`);

console.log("\n── D) daily_prices per-stock reach (can Yahoo even help?) ──");
const [d] = await raw(`WITH k AS (SELECT "stock_id", min("date")::date o, count(*)::int c FROM daily_prices GROUP BY 1)
  SELECT count(*) FILTER (WHERE o <= DATE '2022-06-01')::int deep,
         count(*) FILTER (WHERE o >  DATE '2022-06-01' AND o <= DATE '2024-01-01')::int mid,
         count(*) FILTER (WHERE o >  DATE '2024-01-01')::int recent, count(*)::int total FROM k`);
console.log(`  stocks whose first bar is ≤2022-06-01: ${d.deep} · 2022-06→2024-01: ${d.mid} · after 2024-01: ${d.recent} (of ${d.total})`);
console.log(`  → the ${d.recent} recent ones are likely genuine new listings; Yahoo cannot invent pre-listing bars.`);
await prisma.$disconnect();
