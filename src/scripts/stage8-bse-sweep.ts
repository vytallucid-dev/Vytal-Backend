// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 8 — THE FINAL BSE SWEEP. Every remaining gap in the universe, all industries.
//
//   npx tsx src/scripts/stage8-bse-sweep.ts          # plan — writes nothing
//   npx tsx src/scripts/stage8-bse-sweep.ts --live   # the run
//
// ── WHY THIS RUNS BEFORE THE WORKBOOK IS WRITTEN ─────────────────────────────────────────────────
// The workbook is a promise: fill it and the universe is complete. That promise is only honest if
// every row in it is something no lane can reach. So the automated lane gets its last pass FIRST,
// over EVERY remaining gap, and the workbook is generated from what survives.
//
// The trigger was ABBOTINDIA, BAYERCROP and MCX: three large listed companies holding prices and
// shareholding but ZERO financial rows — 105 units, which would have been 105 hand-typed rows. BSE
// lists 138 / 141 / 85 filings for them. They were never ingested, not unavailable.
//
// Safety is inherited: INSERT … ON CONFLICT DO NOTHING (NSE always wins), null-only fill for rows
// that already exist, per-chunk fence by name against a baseline captured immediately before the
// run, per-chunk retention-depth check, ledgered and resumable.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { BsePacer } from "../ingestions/quaterly-results/bse/bse-http.js";
import { fetchScripMaster, resolveAgainstMaster } from "../ingestions/quaterly-results/bse/bse-resolver.js";
import { HaltRun, runBseBackfill, type BseTarget } from "../ingestions/quaterly-results/bse/backfill-bse.js";
import { loadBaseline, persistBaseline, verifyAgainstPersisted } from "../ingestions/quaterly-results/bse/bse-fence-persist.js";
import { FENCED_TABLES } from "../ingestions/quaterly-results/bse/bse-fence.js";
import { analyse } from "./stage8-completeness.js";

const SCRATCH = "C:/Users/PUNCTU~1/AppData/Local/Temp/claude/c--Vytal/2ed9ba24-9e1a-498b-822d-b4e96613b3ce/scratchpad/s8";
fs.mkdirSync(SCRATCH, { recursive: true });
const MODE = process.argv.includes("--live") ? "live" : "plan";
const ONLY = process.argv.includes("--only")
  ? new Set(process.argv[process.argv.indexOf("--only") + 1].split(",").map((x) => x.trim().toUpperCase()))
  : null;
/** A fresh ledger retries units a previous run recorded as failed. */
const LEDGER_TAG = process.argv.includes("--tag") ? process.argv[process.argv.indexOf("--tag") + 1] : "";
const LEDGER = path.join(SCRATCH, `s8-sweep.${MODE}${LEDGER_TAG ? "." + LEDGER_TAG : ""}.jsonl`);
const BASELINE = path.join(SCRATCH, "s8-fence-baseline.jsonl");
const REPORT = path.join(SCRATCH, `s8-sweep.${MODE}.json`);
const LOCK = path.join(SCRATCH, ".s8.lock");
const raw = async <T = any>(s: string): Promise<T[]> => (await prisma.$queryRawUnsafe(s)) as T[];

async function depths(): Promise<{ line: string; over: boolean }> {
  const parts: string[] = [];
  let over = false;
  for (const t of FENCED_TABLES) {
    const r = await raw<{ mx: number; cap: number | null; n_over: number }>(
      `WITH d AS (SELECT stock_id, result_type, count(*)::int n FROM "${t}" GROUP BY 1,2)
       SELECT coalesce(max(n),0)::int mx,
              (SELECT keep FROM retention_policy WHERE table_name='${t}')::int cap,
              count(*) FILTER (WHERE n > coalesce((SELECT keep FROM retention_policy WHERE table_name='${t}'), 999999))::int n_over
         FROM d`);
    if (r[0].n_over > 0) over = true;
    parts.push(`${t.replace("_results", "").replace("_quarterly", "Q").replace("insurance", "ins")} ${r[0].mx}/${r[0].cap ?? "-"}${r[0].n_over ? "⚠" : ""}`);
  }
  return { line: parts.join(" · "), over };
}

async function main(): Promise<void> {
  if (fs.existsSync(LOCK)) { console.log(`ABORT — lock held: ${fs.readFileSync(LOCK, "utf8")}`); return; }
  fs.writeFileSync(LOCK, `pid ${process.pid} ${new Date().toISOString()}`);
  try {
    console.log(`\n══ STAGE 8 — FINAL BSE SWEEP — ${MODE.toUpperCase()} ══\n`);
    const clock = await raw<{ now: Date }>(`SELECT now() AS now`);
    const jobs = await raw<{ status: string; n: number }>(
      `SELECT status, count(*)::int n FROM background_jobs WHERE status IN ('running','pending') GROUP BY 1`);
    const nowUtc = new Date(clock[0].now);
    console.log(`  DB clock         ${nowUtc.toISOString()}`);
    console.log(`  background_jobs  ${jobs.length ? JSON.stringify(jobs) : "0 running, 0 pending ✓"}`);
    const d0 = await depths();
    console.log(`  depth            ${d0.line}`);
    if (d0.over) throw new Error("a partition is ALREADY over cap — refusing to add rows");

    const { stocks: gaps } = await analyse();
    const withGaps = gaps.filter((g) => (g.missQ.length || g.missA.length) && (!ONLY || ONLY.has(g.symbol)));
    console.log(`\n  stocks with result gaps  ${withGaps.length}`);
    console.log(`  gap units                ${withGaps.reduce((n, g) => n + g.missQ.length + g.missA.length, 0)}`);

    const meta = await raw<{ id: string; symbol: string; isin: string; ind: string }>(
      `SELECT id, symbol, isin, "industryType"::text ind FROM stocks`);
    const bySym = new Map(meta.map((m) => [m.symbol, m]));

    const pacer = new BsePacer({ minSpacingMs: 4000, throttleStopMs: 90_000, slowMs: 8_000, maxSpacingMs: 20_000 });
    const MASTER = path.join(SCRATCH, "bse-scrip-master.json");
    let master: Awaited<ReturnType<typeof fetchScripMaster>>;
    if (fs.existsSync(MASTER)) { master = JSON.parse(fs.readFileSync(MASTER, "utf8")); console.log(`  scrip master     ${master.length} rows (cached)`); }
    else { master = await fetchScripMaster(pacer); fs.writeFileSync(MASTER, JSON.stringify(master)); console.log(`  scrip master     ${master.length} rows (fetched)`); }

    const res = resolveAgainstMaster(
      withGaps.map((g) => ({ symbol: g.symbol, isin: bySym.get(g.symbol)?.isin ?? "" })), master);
    const scrip = new Map(res.resolved.map((r) => [r.symbol, r]));
    console.log(`  resolved         ${res.resolved.length}/${withGaps.length}` +
      (res.unresolved.length ? `   UNRESOLVED (NAMED): ${res.unresolved.map((u) => u.symbol).join(", ")}` : ""));

    const targets: BseTarget[] = [];
    for (const g of withGaps) {
      const st = bySym.get(g.symbol);
      const sc = scrip.get(g.symbol);
      if (!st || !sc) continue;
      for (const p of g.missQ)
        targets.push({ symbol: g.symbol, stockId: st.id, scripCode: sc.scripCode, grain: "quarterly",
          periodEnd: new Date(`${p}T00:00:00.000Z`), basis: "standalone", industryType: st.ind });
      for (const p of g.missA)
        targets.push({ symbol: g.symbol, stockId: st.id, scripCode: sc.scripCode, grain: "annual",
          periodEnd: new Date(`${p}T00:00:00.000Z`), basis: "standalone", industryType: st.ind });
    }
    // ⚠ RUN ORDER IS BY VALUE. The three zero-data stocks are the largest single recovery available
    //   and the clearest test that the lane still works, so they go first.
    const ZERO = new Set(["ABBOTINDIA", "BAYERCROP", "MCX"]);
    targets.sort((a, b) =>
      (ZERO.has(b.symbol) ? 1 : 0) - (ZERO.has(a.symbol) ? 1 : 0) ||
      a.symbol.localeCompare(b.symbol) || a.periodEnd.getTime() - b.periodEnd.getTime());

    const perInd = targets.reduce<Record<string, number>>((acc, t) => { acc[t.industryType] = (acc[t.industryType] ?? 0) + 1; return acc; }, {});
    console.log(`\n  TARGETS          ${targets.length}  (quarterly ${targets.filter((t) => t.grain === "quarterly").length} · annual ${targets.filter((t) => t.grain === "annual").length})`);
    for (const [k, v] of Object.entries(perInd).sort((a, b) => b[1] - a[1])) console.log(`     ${k.padEnd(20)} ${v}`);

    if (MODE === "plan") {
      fs.writeFileSync(REPORT, JSON.stringify({ targets: targets.length, perInd, unresolved: res.unresolved }, null, 1));
      console.log(`\n  plan → ${REPORT}\n`);
      return;
    }

    console.log(`\n  fence baseline → ${BASELINE}`);
    const h = await persistBaseline(prisma, BASELINE);
    const base = loadBaseline(BASELINE);
    console.log(`    ${Object.values(h.totals).reduce((a: number, b: any) => a + Number(b), 0)} rows ` +
      `(${Object.values(h.nseTotals).reduce((a: number, b: any) => a + Number(b), 0)} NSE)`);
    const runStart = new Date(nowUtc);

    const summary = await runBseBackfill(prisma, targets, {
      dryRun: false, ledgerFile: LEDGER, chunkSize: 25, pacer,
      onChunk: async (info) => {
        console.log(`   chunk ${info.index} · ${info.attempted}/${targets.length} · median ${info.medianLatencyMs}ms · ${JSON.stringify(info.outcomes)}`);
        const v = await verifyAgainstPersisted(prisma, base, runStart, new Set(info.targetedRowIds));
        if (!v.ok) {
          for (const m of v.movements.filter((x) => x.severity === "violation").slice(0, 10))
            console.log(`      ⚠ ${JSON.stringify(m).slice(0, 190)}`);
          throw new HaltRun(`fence moved: ${v.violations} violation(s)`);
        }
        const d = await depths();
        if (d.over) { console.log(`      ⚠⚠ retention depth exceeded: ${d.line}`); throw new HaltRun("retention depth exceeded"); }
      },
    });

    console.log(`\n  ── SUMMARY ──`);
    console.log(`  attempted ${summary.attempted}`);
    for (const [k, v] of Object.entries(summary.outcomes).sort((a, b) => b[1] - a[1])) console.log(`     ${k.padEnd(32)} ${v}`);
    if (summary.stopped) console.log(`  STOPPED: ${summary.stopped.reason} after ${summary.stopped.afterUnits} — ${summary.stopped.message}`);
    console.log(`  cells filled into existing rows: ${JSON.stringify(summary.cellsFilled)}`);
    console.log(`  cells offered but already non-null: ${summary.cellsHeldNotNull}`);
    fs.writeFileSync(REPORT, JSON.stringify({ summary, perInd }, null, 1));
    console.log(`\n  report → ${REPORT}\n`);
  } finally {
    fs.rmSync(LOCK, { force: true });
    await prisma.$disconnect();
  }
}
main().catch(async (e) => { fs.rmSync(LOCK, { force: true }); console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
