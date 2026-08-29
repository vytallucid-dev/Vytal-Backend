// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 7d — RUN THE BSE XBRL LANE OVER THE INSURERS.
//
//   npx tsx src/scripts/stage7d-bse-insurance.ts          # plan: preflight + targets, writes nothing
//   npx tsx src/scripts/stage7d-bse-insurance.ts --live   # the run
//
// ── WHY THIS EXISTS, AND WHY IT WAS NOT DONE EARLIER ──────────────────────────────────────────────
// Stage 4/5 deliberately excluded insurance ("for insurance wait for step 7, we will get it from
// IRDAI"). That was right at the time — but it left a whole lane unused: the BSE runner has ROUTED
// life_insurance and general_insurance for both grains since S8.4b, and across the entire corpus it
// has written exactly ONE life-insurance quarterly row. Every insurer in the universe is a LISTED
// company, so the same XBRL that serves banks and NBFCs serves them too.
//
// This matters because the insurer WEBSITES turned out to be the hard route, not the easy one:
// SBILIFE's and LICI's document APIs are 403 to anything without a session, NIACL's archive is
// Angular over opaque uuids, and GICRE publishes HTML rather than PDF. The exchange, by contrast,
// is a route this codebase already owns, already fences, and already paces.
//
// ⚠ IT CANNOT REACH EVERYTHING. XBRL results begin ~FY2021 at BSE, and a company cannot file before
//   it lists — LICI listed 2022-05, STARHEALTH 2021-12. Whatever this leaves behind stays in the
//   manual workbook, which is regenerated from the REMAINING gaps after the run, not before it.
//
// Safety is inherited, not reinvented: INSERT … ON CONFLICT DO NOTHING (NSE always wins), null-only
// fill for existing rows, per-chunk fence against a baseline captured immediately before the run,
// per-chunk retention-depth check, ledgered and resumable. dryRun defaults TRUE in the runner.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { BsePacer } from "../ingestions/quaterly-results/bse/bse-http.js";
import { fetchScripMaster, resolveAgainstMaster } from "../ingestions/quaterly-results/bse/bse-resolver.js";
import { HaltRun, runBseBackfill, type BseTarget } from "../ingestions/quaterly-results/bse/backfill-bse.js";
import { loadBaseline, persistBaseline, verifyAgainstPersisted } from "../ingestions/quaterly-results/bse/bse-fence-persist.js";

const SCRATCH = "C:/Users/PUNCTU~1/AppData/Local/Temp/claude/c--Vytal/2ed9ba24-9e1a-498b-822d-b4e96613b3ce/scratchpad/s7d";
fs.mkdirSync(SCRATCH, { recursive: true });
const MODE = process.argv.includes("--live") ? "live" : "plan";
const LEDGER = path.join(SCRATCH, `s7d-ledger.${MODE}.jsonl`);
const BASELINE = path.join(SCRATCH, "s7d-fence-baseline.jsonl");
const REPORT = path.join(SCRATCH, `s7d-report.${MODE}.json`);
const LOCK = path.join(SCRATCH, ".s7d.lock");

const TARGET = "2019-03-31";
const HORIZON = "2026-06-30";
/** armed depth_per_key caps, read live below — these are the expected values, asserted not assumed. */
const INS_TABLES = [
  "life_insurance_quarterly_results", "life_insurance_fundamentals",
  "general_insurance_quarterly_results", "general_insurance_fundamentals",
] as const;

const raw = async <T = any>(s: string): Promise<T[]> => (await prisma.$queryRawUnsafe(s)) as T[];

function quarterEnds(from: string, to: string): string[] {
  const out: string[] = [];
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)) + 1; y++)
    for (const e of ["-03-31", "-06-30", "-09-30", "-12-31"]) {
      const d = `${y}${e}`;
      if (d >= from && d <= to) out.push(d);
    }
  return out.sort();
}

async function depths(): Promise<string> {
  const parts: string[] = [];
  for (const t of INS_TABLES) {
    const r = await raw<{ mx: number; cap: number; n_over: number }>(
      `WITH d AS (SELECT stock_id, result_type, count(*)::int n FROM "${t}" GROUP BY 1,2)
       SELECT coalesce(max(n),0)::int mx,
              (SELECT keep FROM retention_policy WHERE table_name='${t}')::int cap,
              count(*) FILTER (WHERE n > (SELECT keep FROM retention_policy WHERE table_name='${t}'))::int n_over
         FROM d`);
    parts.push(`${t.replace("_insurance", "").replace("_results", "").replace("quarterly", "Q").replace("fundamentals", "F")} ${r[0].mx}/${r[0].cap}${r[0].n_over ? ` ⚠${r[0].n_over}OVER` : ""}`);
  }
  return parts.join(" · ");
}

async function main(): Promise<void> {
  if (fs.existsSync(LOCK)) { console.log(`ABORT — lock held: ${fs.readFileSync(LOCK, "utf8")}`); return; }
  fs.writeFileSync(LOCK, `pid ${process.pid} ${new Date().toISOString()}`);
  try {
    console.log(`\n══ STAGE 7d — BSE XBRL over the insurers — ${MODE.toUpperCase()} ══\n`);

    // ── preflight ────────────────────────────────────────────────────────────
    const clock = await raw<{ now: Date; tz: string }>(`SELECT now() AS now, current_setting('TimeZone') AS tz`);
    const jobs = await raw<{ status: string; n: number }>(
      `SELECT status, count(*)::int n FROM background_jobs WHERE status IN ('running','pending') GROUP BY 1`);
    const nowUtc = new Date(clock[0].now);
    const nextPrune = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 21, 30, 0));
    if (nextPrune <= nowUtc) nextPrune.setUTCDate(nextPrune.getUTCDate() + 1);
    const mins = Math.round((nextPrune.getTime() - nowUtc.getTime()) / 60000);
    console.log(`  DB clock         ${nowUtc.toISOString()} (${clock[0].tz})`);
    console.log(`  background_jobs  ${jobs.length ? JSON.stringify(jobs) : "0 running, 0 pending ✓"}`);
    console.log(`  NEXT prune       ${nextPrune.toISOString()} → window ${Math.floor(mins / 60)}h ${mins % 60}m`);
    console.log(`  depth            ${await depths()}`);
    if (jobs.length) console.log(`  ⚠ jobs in flight — a concurrent ingestion could move rows this run does not own`);

    // ── demand ───────────────────────────────────────────────────────────────
    const stocks = await raw<{ id: string; symbol: string; isin: string; industryType: string; firstpx: string | null }>(`
      SELECT s.id, s.symbol, s.isin, s."industryType"::text "industryType",
             (SELECT min(date)::date::text FROM daily_prices p WHERE p.stock_id=s.id) firstpx
        FROM stocks s WHERE s."industryType"::text IN ('life_insurance','general_insurance')
        ORDER BY s.symbol`);

    const held = new Set<string>();
    for (const [tbl, grain] of [
      ["life_insurance_quarterly_results", "quarterly"], ["life_insurance_fundamentals", "annual"],
      ["general_insurance_quarterly_results", "quarterly"], ["general_insurance_fundamentals", "annual"],
    ] as const)
      for (const r of await raw<{ symbol: string; d: string }>(
        // ⚠ standalone only: BseTarget.basis is "standalone" by type. A consolidated gap is not
        //   something this lane can close, so counting it as demand would overstate the run.
        `SELECT s.symbol, t.report_date::date::text d FROM "${tbl}" t JOIN stocks s ON s.id=t.stock_id
          WHERE t.result_type::text='standalone'`))
        held.add(`${r.symbol}|${grain}|${r.d}`);

    const want: Array<{ st: typeof stocks[number]; grain: "quarterly" | "annual"; periodEnd: string }> = [];
    for (const st of stocks) {
      const floor = st.firstpx && st.firstpx > TARGET ? quarterEnds(st.firstpx, HORIZON)[0] : TARGET;
      if (!floor) continue;
      for (const p of quarterEnds(floor, HORIZON)) {
        if (!held.has(`${st.symbol}|quarterly|${p}`)) want.push({ st, grain: "quarterly", periodEnd: p });
        if (p.endsWith("-03-31") && !held.has(`${st.symbol}|annual|${p}`)) want.push({ st, grain: "annual", periodEnd: p });
      }
    }
    console.log(`\n  insurers         ${stocks.length}`);
    console.log(`  unserved units   ${want.length}  (standalone, ${TARGET}..${HORIZON}, bounded by listing)`);

    // ── resolve scrips ───────────────────────────────────────────────────────
    const pacer = new BsePacer({ minSpacingMs: 4000, throttleStopMs: 90_000, slowMs: 8_000, maxSpacingMs: 20_000 });
    const MASTER = path.join(SCRATCH, "bse-scrip-master.json");
    let master: Awaited<ReturnType<typeof fetchScripMaster>>;
    if (fs.existsSync(MASTER)) { master = JSON.parse(fs.readFileSync(MASTER, "utf8")); console.log(`  scrip master     ${master.length} rows (cached)`); }
    else { master = await fetchScripMaster(pacer); fs.writeFileSync(MASTER, JSON.stringify(master)); console.log(`  scrip master     ${master.length} rows (fetched)`); }

    const res = resolveAgainstMaster(stocks.map((s) => ({ symbol: s.symbol, isin: s.isin })), master);
    const scrip = new Map(res.resolved.map((r) => [r.symbol, r]));
    console.log(`  resolved         ${res.resolved.length}/${stocks.length}` +
      (res.unresolved.length ? `  UNRESOLVED (NAMED): ${res.unresolved.map((u) => u.symbol).join(", ")}` : ""));

    const targets: BseTarget[] = [];
    const droppedNoScrip = new Set<string>();
    for (const w of want) {
      const sc = scrip.get(w.st.symbol);
      if (!sc) { droppedNoScrip.add(w.st.symbol); continue; }
      targets.push({
        symbol: w.st.symbol, stockId: w.st.id, scripCode: sc.scripCode, grain: w.grain,
        periodEnd: new Date(`${w.periodEnd}T00:00:00.000Z`), basis: "standalone",
        industryType: w.st.industryType,
      });
    }
    // annuals first: one annual closes a whole fiscal year and is the cheaper proof that the
    // life/general writers work at all.
    targets.sort((a, b) =>
      (a.grain === b.grain ? 0 : a.grain === "annual" ? -1 : 1) ||
      a.symbol.localeCompare(b.symbol) || a.periodEnd.getTime() - b.periodEnd.getTime());

    const perSym = targets.reduce<Record<string, number>>((acc, t) => { acc[t.symbol] = (acc[t.symbol] ?? 0) + 1; return acc; }, {});
    console.log(`\n  TARGETS          ${targets.length} units  (annual ${targets.filter((t) => t.grain === "annual").length} · quarterly ${targets.filter((t) => t.grain === "quarterly").length})`);
    for (const [s, n] of Object.entries(perSym).sort((a, b) => b[1] - a[1])) console.log(`     ${s.padEnd(13)} ${n}`);
    if (droppedNoScrip.size) console.log(`  ⚠ no scrip code, dropped: ${[...droppedNoScrip].join(", ")}`);

    if (MODE === "plan") {
      fs.writeFileSync(REPORT, JSON.stringify({ mode: MODE, targets: targets.length, perSym, unresolved: res.unresolved }, null, 1));
      console.log(`\n  plan → ${REPORT}\n`);
      return;
    }

    // ── baseline, immediately before the run ─────────────────────────────────
    console.log(`\n  fence baseline → ${BASELINE}`);
    const h = await persistBaseline(prisma, BASELINE);
    const base = loadBaseline(BASELINE);
    const runStart = new Date(nowUtc);
    console.log(`    ${Object.values(h.totals).reduce((a: number, b: any) => a + Number(b), 0)} rows ` +
      `(${Object.values(h.nseTotals).reduce((a: number, b: any) => a + Number(b), 0)} NSE) at ${h.capturedAt}`);

    const summary = await runBseBackfill(prisma, targets, {
      dryRun: false,
      ledgerFile: LEDGER,
      chunkSize: 25,
      pacer,
      onChunk: async (info) => {
        console.log(`   chunk ${info.index} · attempted ${info.attempted} · median ${info.medianLatencyMs}ms · ${JSON.stringify(info.outcomes)}`);
        // ⚠ targetedRowIds MUST be passed, or step 6b's null-only fills read as foreign movement
        //   and a correct run halts on its own work. runStart bounds layer (3).
        const v = await verifyAgainstPersisted(prisma, base, runStart, new Set(info.targetedRowIds));
        if (!v.ok) {
          for (const m of v.movements.filter((x) => x.severity === "violation").slice(0, 12))
            console.log(`      ⚠ ${m.severity} ${JSON.stringify(m).slice(0, 190)}`);
          if (Object.values(v.touchedSinceStart).some((n) => n > 0))
            console.log(`      ⚠ NSE rows touched since run start: ${JSON.stringify(v.touchedSinceStart)}`);
          throw new HaltRun(`fence moved: ${v.violations} violation(s), ${v.notices} notice(s)`);
        }
        const d = await depths();
        console.log(`      fence 0 violations · depth ${d}`);
        if (d.includes("OVER")) throw new HaltRun(`retention depth exceeded: ${d}`);
      },
    });

    console.log(`\n  ── SUMMARY ──`);
    console.log(`  attempted ${summary.attempted}`);
    for (const [k, v] of Object.entries(summary.outcomes).sort((a, b) => b[1] - a[1])) console.log(`     ${k.padEnd(30)} ${v}`);
    if (summary.stopped) console.log(`  STOPPED: ${summary.stopped.reason} after ${summary.stopped.afterUnits} — ${summary.stopped.message}`);
    console.log(`  ratio refusals ${summary.ratioRefusals} · cells filled into existing rows ${JSON.stringify(summary.cellsFilled)}`);
    console.log(`  cells offered but already non-null: ${summary.cellsHeldNotNull}`);
    fs.writeFileSync(REPORT, JSON.stringify({ mode: MODE, summary, perSym }, null, 1));
    console.log(`\n  report → ${REPORT}\n`);
  } finally {
    fs.rmSync(LOCK, { force: true });
    await prisma.$disconnect();
  }
}
main().catch(async (e) => {
  fs.rmSync(LOCK, { force: true });
  console.error(String(e).slice(0, 3000));
  await prisma.$disconnect();
  process.exit(1);
});
