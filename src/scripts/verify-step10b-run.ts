// GATE 3 — run the pipeline for real and prove the invariants.
//   npx tsx src/scripts/verify-step10b-run.ts nav        → run amfi_nav_daily (Step-9 fixes)
//   npx tsx src/scripts/verify-step10b-run.ts analytics  → run mf_analytics_daily (THE memory proof)
//   npx tsx src/scripts/verify-step10b-run.ts baseline   → the byte-identical check
import { prisma } from "../db/prisma.js";
import v8 from "v8";
import { runAmfiNavIngest } from "../ingestions/amfi/ingest-amfi.js";
import { runMfAnalytics } from "../ingestions/amfi/mf-analytics.js";

const MB = (b: number) => (b / 1048576).toFixed(1);
const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);
const mode = process.argv[2] ?? "baseline";

async function baseline(tag: string) {
  hdr(`BASELINE — ${tag}`);
  const st = await prisma.instrument.count({ where: { assetClass: "stock" } });
  const mf = await prisma.instrument.count({ where: { assetClass: "mutual_fund" } });
  const fp = await prisma.$queryRawUnsafe<any[]>(`
    SELECT md5(string_agg(id||':'||isin||':'||COALESCE(stock_id,'-'),'|' ORDER BY isin)) AS fp
    FROM instruments WHERE asset_class='stock'`);
  console.log(`  stocks=${st}  (want 504)   ${st === 504 ? "✅" : "❌"}`);
  console.log(`  MF rows=${mf}  (want 17567) ${mf === 17567 ? "✅" : "❌"}`);
  console.log(`  stock fingerprint: ${fp[0].fp}`);
  console.log(`  ${fp[0].fp === "da04f158478175140addfa3b6db045ed" ? "✅" : "❌"} matches the pre-Step-10 fingerprint`);
  for (const e of [
    { email: "arman.shaikh01082003@gmail.com", fp: "056bc16b8552a88e9dda6f6878f0493d20032a79b370667f5b88bffd4a0e619b", phs: 66 },
    { email: "amankamaljain@gmail.com", fp: "424d5af22e0ea3d5d272b8788f8acce33e7ee07b73039aff6f0e9121ed60f846", phs: 51 },
  ]) {
    const u = await prisma.user.findFirst({ where: { email: e.email }, select: { id: true } });
    const p = await prisma.portfolioHealthSnapshot.findFirst({
      where: { userId: u!.id }, orderBy: { createdAt: "desc" },
      select: { phs: true, band: true, fingerprint: true },
    });
    const ok = p?.fingerprint === e.fp && p?.phs === e.phs;
    console.log(`  ${ok ? "✅" : "❌"} ${e.email.padEnd(34)} phs=${p?.phs} ${p?.band}`);
  }
}

if (mode === "baseline") {
  await baseline("current");
}

if (mode === "nav") {
  await baseline("BEFORE amfi_nav_daily");

  hdr("RUN — amfi_nav_daily (blank-NAV fix + dormancy 30d + recurring faults)");
  const t0 = Date.now();
  const r = await runAmfiNavIngest();
  console.log(`  ok=${r.ok}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  MF rows in file : ${r.classRows}`);
  console.log(`  created=${r.created}  updated=${r.updated}  (created MUST be 0 on a re-run)`);
  console.log(`  active=${r.activeRows}  dormant=${r.staleRows}   newest NAV ${r.maxNavDate}`);
  console.log(`  dormancy flips  : ${r.dormancyFlips}   (7d → 30d threshold change)`);
  console.log(`  honest-empty skips: ${r.honestEmptySkips}  (absent plans — NOT faults)`);
  console.log(`  faults: validity=${r.errors.validity} uniqueness=${r.errors.uniqueness} shape=${r.errors.shape} count=${r.errors.count}`);

  await baseline("AFTER amfi_nav_daily");

  hdr("DORMANCY — the 30-day ruling, applied");
  const d = await prisma.$queryRawUnsafe<any[]>(`
    WITH m AS (SELECT max(nav_date) mx FROM instruments WHERE asset_class='mutual_fund')
    SELECT count(DISTINCT amfi_scheme_code) FILTER (WHERE is_active) AS active,
           count(DISTINCT amfi_scheme_code) FILTER (WHERE NOT is_active) AS dormant,
           count(DISTINCT amfi_scheme_code) FILTER (WHERE is_active AND (SELECT mx FROM m) - nav_date > 30) AS wrong_active,
           count(DISTINCT amfi_scheme_code) FILTER (WHERE NOT is_active AND (SELECT mx FROM m) - nav_date <= 30) AS wrong_dormant
    FROM instruments WHERE asset_class='mutual_fund' AND nav_date IS NOT NULL`);
  console.log(`  active=${d[0].active}  dormant=${d[0].dormant}`);
  console.log(`  ${Number(d[0].wrong_active) === 0 ? "✅" : "❌"} zero active schemes older than 30d (${d[0].wrong_active})`);
  console.log(`  ${Number(d[0].wrong_dormant) === 0 ? "✅" : "❌"} zero dormant schemes fresher than 30d (${d[0].wrong_dormant})`);

  hdr("RECURRING FAULTS — did the known quirks reopen?");
  const errs = await prisma.$queryRawUnsafe<any[]>(`
    SELECT status, count(*) n, sum(occurrences) occ FROM ingestion_errors
    WHERE source='amfi_navall' GROUP BY 1 ORDER BY 1`);
  for (const e of errs) console.log(`  status=${String(e.status).padEnd(9)} rows=${e.n}  occurrences=${e.occ}`);
  const open = errs.find((e) => e.status === "open");
  console.log(`  ${!open ? "✅ ZERO new open rows — the 15 known quirks bumped their counts and stayed triaged" : `⚠️ ${open.n} open row(s)`}`);

  hdr("RUN-LOG (the mystery cron is now observable)");
  const logs = await prisma.mfFetchLog.findMany({ orderBy: { createdAt: "desc" }, take: 3 });
  for (const l of logs) {
    console.log(`  ${l.runDate.toISOString().slice(0, 10)} ${l.job.padEnd(19)} ${l.status.padEnd(8)} ` +
      `schemes=${l.schemesProcessed} rows=${l.rowsFolded} written=${l.analyticsWritten} faults=${l.faults} ${l.durationMs}ms`);
  }
}

if (mode === "analytics") {
  let peakHeap = 0, peakRss = 0;
  const sampler = setInterval(() => {
    const m = process.memoryUsage();
    peakHeap = Math.max(peakHeap, m.heapUsed);
    peakRss = Math.max(peakRss, m.rss);
  }, 100);

  hdr("MEMORY CEILING");
  console.log(`  node ${process.version}   heap_size_limit = ${MB(v8.getHeapStatistics().heap_size_limit)} MB`);
  console.log(`  Railway Hobby = 8 GB/service. The job must stay far below that IN-PROCESS with the API.`);

  hdr("RUN — mf_analytics_daily (THE MAKE-OR-BREAK PROOF)");
  const r = await runMfAnalytics();
  clearInterval(sampler);

  console.log(`  ok=${r.ok}  ${r.abortReason ? `abort=${r.abortReason}` : ""}`);
  console.log(`  as-of            : ${r.asOfDate}`);
  console.log(`  windows streamed : ${r.windows}   ${(r.bytes / 1e6).toFixed(0)} MB   ${(r.durationMs / 1000).toFixed(0)}s`);
  console.log(`  NAV rows FOLDED  : ${r.rowsFolded.toLocaleString()}   ← never stored`);
  console.log(`  schemes folded   : ${r.schemesFolded.toLocaleString()}`);
  console.log(`  analytics written: ${r.analyticsWritten.toLocaleString()}`);
  console.log(`  category ranks   : ${r.ranked.toLocaleString()}`);
  console.log(`  risk-free        : ${r.riskFreeIndex} covers [${r.riskFreeCovers.join(", ") || "NOTHING"}]`);
  console.log(`  out-of-order rows: ${r.outOfOrderRows}   malformed NAVs: ${r.malformedNavs}   faults: ${r.faults}`);

  hdr("★ MEMORY — O(schemes), not O(rows)");
  console.log(`  peak heapUsed : ${MB(peakHeap)} MB`);
  console.log(`  peak RSS      : ${MB(peakRss)} MB`);
  console.log(`  rows folded   : ${r.rowsFolded.toLocaleString()}`);
  console.log(`  ⇒ ${(r.rowsFolded / (peakHeap / 1048576)).toFixed(0)} NAV rows folded per MB of heap.`);
  console.log(`    Holding them as JS objects would have cost ~${((r.rowsFolded * 60) / 1e9).toFixed(1)} GB.`);
}

await prisma.$disconnect();
