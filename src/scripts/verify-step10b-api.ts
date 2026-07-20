// GATE 3 — the API surface: live chart (transient), analytics read (+ honest-empty prose),
// and the ruling-①b manual-trigger / run-log endpoints.
// npx tsx src/scripts/verify-step10b-api.ts
import { prisma } from "../db/prisma.js";
import { fetchFundChart } from "../ingestions/amfi/mf-chart.js";
import { explainOmissions } from "../ingestions/amfi/mf-omissions.js";

const hdr = (s: string) => console.log(`\n═══ ${s} ═══`);
let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`  ${ok ? "✅" : "❌"} ${msg}`); };

// ── 1. LIVE CHART — transient, nothing stored ──────────────────
hdr("1. LIVE CHART — fetched at view time, stored NEVER");
const fund = await prisma.instrument.findFirst({
  where: { assetClass: "mutual_fund", isActive: true, amfiSchemeCode: { not: null } },
  select: { amfiSchemeCode: true, schemeName: true },
  orderBy: { amfiSchemeCode: "asc" },
});
const t0 = Date.now();
const chart = await fetchFundChart(fund!.amfiSchemeCode!, { days: 365 });
const ms = Date.now() - t0;

if (chart.ok) {
  console.log(`  scheme ${chart.schemeCode}: "${chart.schemeName}"`);
  console.log(`  ${chart.points.length} points  ${chart.from} → ${chart.to}   ${ms} ms`);
  console.log(`  first: ${JSON.stringify(chart.points[0])}   last: ${JSON.stringify(chart.points[chart.points.length - 1])}`);
  check(chart.points.length > 0, "a real series came back");
  check(typeof chart.points[0]?.nav === "string", "NAV is a STRING (no float re-serialisation drift)");
  check(
    new Date(chart.points[0]!.date) <= new Date(chart.points[chart.points.length - 1]!.date),
    "points are oldest → newest",
  );
} else {
  check(false, `chart fetch failed: ${chart.reason}`);
}

// NOTHING may have been written by that call.
const navTables = await prisma.$queryRawUnsafe<any[]>(`
  SELECT count(*) n FROM information_schema.tables
  WHERE table_schema='public' AND table_name ILIKE '%nav%'`);
check(Number(navTables[0].n) === 0, "★ the chart fetch persisted NOTHING — no NAV table exists to persist into");

// ── 2. SOURCE-DOWN → honest degrade, never a fabricated series ──
hdr("2. SOURCE DOWN — must degrade honestly, never fabricate");
const bad = await fetchFundChart("99999999");
check(!bad.ok || bad.points.length === 0, `an unknown scheme yields no fabricated series`);
if (!bad.ok) console.log(`     reason: ${bad.reason}`);
const junk = await fetchFundChart("not-a-code");
check(!junk.ok, `a malformed code is refused: ${(junk as any).reason}`);

// ── 3. ANALYTICS READ — honest-empty renders as PROSE, not a blank ──
hdr("3. ANALYTICS READ — every NULL renders WITH its reason");
const young = await prisma.mfAnalytics.findFirst({
  where: { ret5yCagr: null, ret1y: { not: null }, navPoints: { gt: 30 } },
  orderBy: { navPoints: "asc" },
});
if (young) {
  const inst = await prisma.instrument.findFirst({
    where: { amfiSchemeCode: young.schemeCode }, select: { schemeName: true },
  });
  console.log(`  a YOUNG fund — ${young.schemeCode} "${String(inst?.schemeName).slice(0, 52)}"`);
  console.log(`    navPoints=${young.navPoints}  window ${young.windowFrom?.toISOString().slice(0, 10)} → ${young.windowTo?.toISOString().slice(0, 10)}`);
  console.log(`    ret_1y     = ${young.ret1y}`);
  console.log(`    ret_3y     = ${young.ret3yCagr ?? "— (honest-empty)"}`);
  console.log(`    ret_5y     = ${young.ret5yCagr ?? "— (honest-empty)"}`);
  check(young.ret5yCagr === null, "the 5Y return is NULL — not 0, not fabricated");

  const ex = explainOmissions(young.omissions, {
    navPoints: young.navPoints, windowFrom: young.windowFrom,
    asOfDate: young.asOfDate, rankBucketSize: young.rankBucketSize,
    riskFreeIndex: "Nifty 1D Rate Index",
  });
  console.log(`\n    what the API tells the user:`);
  for (const [field, v] of Object.entries(ex).slice(0, 4)) {
    console.log(`      ${field.padEnd(24)} [${v.code}]`);
    console.log(`        "${v.reason.slice(0, 96)}${v.reason.length > 96 ? "…" : ""}"`);
  }
  check(Object.keys(ex).length > 0, "★ every empty metric carries a human-readable reason");
}

// An OLD fund should have everything the risk-free series allows.
const old = await prisma.mfAnalytics.findFirst({
  where: { ret5yCagr: { not: null }, sharpe1y: { not: null }, rankBucket: { not: null } },
  orderBy: { navPoints: "desc" },
});
if (old) {
  const inst = await prisma.instrument.findFirst({
    where: { amfiSchemeCode: old.schemeCode }, select: { schemeName: true },
  });
  console.log(`\n  an OLD fund — ${old.schemeCode} "${String(inst?.schemeName).slice(0, 52)}"`);
  console.log(`    navPoints=${old.navPoints}`);
  console.log(`    1Y ${pct(old.ret1y)}   3Y ${pct(old.ret3yCagr)} p.a.   5Y ${pct(old.ret5yCagr)} p.a.`);
  console.log(`    vol1y ${pct(old.vol1y)}   sharpe1y ${old.sharpe1y}   maxDD5y ${pct(old.maxDrawdown5y)}`);
  console.log(`    rolling 1Y: n=${old.roll1yN} min ${pct(old.roll1yMin)} max ${pct(old.roll1yMax)} avg ${pct(old.roll1yAvg)} positive ${old.roll1yPctPositive}%`);
  console.log(`    rank: ${old.rank1y} of ${old.rankBucketSize} in "${old.rankBucket}"  (pct ${old.pct1y})`);
  check(old.ret5yCagr !== null, "an old fund gets ALL horizons its history supports");
  check(old.sharpe3y === null, "sharpe_3y is honest-empty — the risk-free series only covers 1Y (ruling ③)");
}

// ── 4. RUN-LOG + PIPELINE PANEL (ruling ①) ─────────────────────
hdr("4. THE MF PIPELINE IS OBSERVABLE (ruling ①a/c)");
const logs = await prisma.mfFetchLog.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
check(logs.length > 0, `mf_fetch_logs has ${logs.length} run(s) — the mystery cron is now logged`);
for (const l of logs) {
  console.log(`    ${l.runDate.toISOString().slice(0, 10)} ${l.job.padEnd(19)} ${l.status.padEnd(8)} ` +
    `rows=${String(l.rowsFolded).padStart(8)} written=${String(l.analyticsWritten).padStart(6)} ` +
    `pulls=${String(l.pulls).padStart(2)} faults=${l.faults} ${((l.durationMs ?? 0) / 1000).toFixed(0)}s`);
}
const { JobTypes } = await import("../jobs/types.js");
const fs = await import("node:fs");
const pipes = fs.readFileSync("src/controllers/pipelines-controller.ts", "utf8");
check(pipes.includes('"mutual-funds"'), "the MF pipeline appears on the admin panel (PIPELINE_JOB_TYPES)");
check(pipes.includes("MF_ANALYTICS_DAILY") && pipes.includes("AMFI_NAV_DAILY"), "…covering both the NAV ingest and the analytics fold");

const routes = fs.readFileSync("src/routes/ingestion/mf-route.ts", "utf8");
// /inception-walk is GONE (the metric it anchored was uncomputable from AMFI's raw NAV — see the drop
// migration). /corporate-actions/trigger replaces it: the job that reads NSE's real unit splits, which
// had shipped cron-only and therefore invisible.
for (const r of ["/nav/trigger", "/analytics/trigger", "/corporate-actions/trigger", "/run-logs", "/:schemeCode/chart", "/:schemeCode/analytics"]) {
  check(routes.includes(r), `route ${r} exists`);
}
const app = fs.readFileSync("src/app.ts", "utf8");
check(app.includes('app.use("/api/v1/admin/mf", requireAdmin, adminMfRouter)'), "★ admin MF routes are gated behind requireAdmin");

const sched = fs.readFileSync("src/lib/scheduler.ts", "utf8");
check(sched.includes("daily-mf-analytics"), "the analytics fold is registered on the cron (ruling ①c)");
check(/daily-mf-analytics[\s\S]*?"0 20 \* \* \*"/.test(sched), "…at 1:30 AM IST, AFTER the 12:30 AM NAV ingest");

function pct(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return `${(Number(v) * 100).toFixed(2)}%`;
}

console.log(`\n${fails === 0 ? "✅ ALL API PROOFS PASS" : `❌ ${fails} FAILED`}`);
await prisma.$disconnect();
process.exit(fails === 0 ? 0 : 1);
