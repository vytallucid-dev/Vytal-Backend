// Read-only: what produced a beta of -13? A number that absurd is either a real signal or a bug.
import { prisma } from "../db/prisma.js";
const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const J = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x));

console.log("── the 10 most EXTREME betas, and what they are ──\n");
const ext = await q(`
  SELECT i.category, i.scheme_name, a.benchmark_index, a.benchmark_via,
         a.beta_1y::text b, a.vol_1y::text vol, a.tracking_error_1y::text te, a.nav_points
    FROM mf_analytics a JOIN instruments i ON i.amfi_scheme_code = a.scheme_code
   WHERE a.beta_1y IS NOT NULL
   ORDER BY abs(a.beta_1y) DESC LIMIT 10`);
for (const e of ext) {
  console.log(`  β=${Number(e.b).toFixed(4).padStart(9)}  vol=${Number(e.vol).toFixed(4)}  TE=${Number(e.te).toFixed(4)}`);
  console.log(`     ${String(e.scheme_name).slice(0, 74)}`);
  console.log(`     vs ${e.benchmark_index}  (via ${e.benchmark_via})   cat: ${String(e.category).slice(0, 52)}\n`);
}

console.log("\n── beta distribution BY the benchmark used ──\n");
const byIdx = await q(`
  SELECT benchmark_index, count(*)::int n,
         round(avg(beta_1y),3)::text avg,
         round(min(beta_1y),3)::text min,
         round(max(beta_1y),3)::text max,
         round(avg(vol_1y),4)::text avg_vol
    FROM mf_analytics WHERE beta_1y IS NOT NULL
   GROUP BY 1 HAVING count(*) > 20 ORDER BY abs(avg(beta_1y)) ASC LIMIT 12`);
console.log(`  ${"benchmark".padEnd(34)} ${"n".padStart(5)} ${"avg β".padStart(8)} ${"min".padStart(9)} ${"max".padStart(8)} ${"avg vol".padStart(9)}`);
for (const r of byIdx) {
  console.log(`  ${String(r.benchmark_index).padEnd(34)} ${String(r.n).padStart(5)} ${String(r.avg).padStart(8)} ${String(r.min).padStart(9)} ${String(r.max).padStart(8)} ${String(r.avg_vol).padStart(9)}`);
}

console.log("\n── how volatile are the BENCHMARKS themselves? (a near-flat index makes beta explode) ──\n");
const bv = await q(`
  WITH r AS (
    SELECT index_name, date,
           ln(close::float8 / lag(close::float8) OVER (PARTITION BY index_name ORDER BY date)) lr
      FROM index_prices
     WHERE index_name IN ('Nifty 1D Rate Index','Nifty 50 Arbitrage','Nifty Composite G-sec Index',
                          'Nifty 10 yr Benchmark G-Sec','Nifty 8-13 yr G-Sec','Nifty 15 yr and above G-Sec Index','Nifty 50')
       AND date > current_date - 400)
  SELECT index_name, count(*)::int n,
         round((stddev_samp(lr) * sqrt(252))::numeric, 6)::text ann_vol
    FROM r WHERE lr IS NOT NULL GROUP BY 1 ORDER BY 3`);
for (const r of bv) console.log(`  ${String(r.index_name).padEnd(36)} ann.vol = ${String(r.ann_vol).padStart(10)}  (${r.n} pts)`);

console.log(`
  READ THIS AS: beta = cov(fund, bench) / var(bench). When var(bench) is TINY — an overnight-rate
  index or an arbitrage index barely moves — the denominator approaches zero and beta explodes on
  noise. The number is arithmetically correct and financially meaningless.`);

await prisma.$disconnect();
