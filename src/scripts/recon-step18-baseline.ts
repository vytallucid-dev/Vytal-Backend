// STEP 18 — GATE 0 baselines. Read-only.
import { prisma } from "../db/prisma.js";
const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);

const a = (await q(`SELECT count(*)::int n,
  md5(string_agg(scheme_code||'|'||coalesce(ret_1y::text,'~')||'|'||coalesce(ret_3y_cagr::text,'~')||'|'||
      coalesce(vol_1y::text,'~')||'|'||coalesce(sharpe_1y::text,'~')||'|'||coalesce(rank_1y::text,'~'),
      ',' ORDER BY scheme_code)) fp FROM mf_analytics`))[0];
const i = (await q(`SELECT count(*)::int n, count(DISTINCT index_name)::int idx FROM index_prices`))[0];
const d = (await q(`SELECT pg_size_pretty(pg_database_size(current_database())) s`))[0];
const c = (await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`));

console.log(`mf_analytics : ${a.n} rows`);
console.log(`  md5 (returns/vol/sharpe/rank) : ${a.fp}`);
console.log(`  ↑ THE A/B FINGERPRINT — Gate 3 re-measures this. Adding beta/alpha CANNOT move it.`);
console.log(`index_prices : ${i.n.toLocaleString()} rows · ${i.idx} indices  (Gate 0 wrote NOTHING — this must not move)`);
console.log(`instruments  : ${JSON.stringify(c)}`);
console.log(`DB           : ${d.s}`);
await prisma.$disconnect();
