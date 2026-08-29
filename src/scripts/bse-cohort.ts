// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 6c P5 — THE COHORT RUN.  ⚠ NOT A BUILD GATE (live database, live network, live writes).
//
//   npx tsx src/scripts/bse-cohort.ts --plan     # preflight + target count, writes nothing
//   npx tsx src/scripts/bse-cohort.ts --live     # the run
//
// Two writers, chosen by the insert's own answer (see backfill-bse.ts step 6b). Chunked, ledgered,
// resumable. Every chunk is followed by TWO checks that can halt the run:
//
//   FENCE      against the persisted baseline captured immediately before the run. A disappearance,
//              or any UNTARGETED NSE row moving, halts. Violations are NAMED.
//   RETENTION  ⚠ THE HAZARD THIS RUN ACTUALLY CARRIES. The ACC row was not lost to an overwrite — it
//              was lost because an insert pushed a partition past keep=32 while the nightly prune
//              ran. Caps are 44/18 now with measured headroom, but "measured before the run" is not
//              "true during it", so depth is re-checked every chunk and a prune firing mid-run is
//              detected and reported by what it deleted.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { BsePacer } from "../ingestions/quaterly-results/bse/bse-http.js";
import { fetchScripMaster, resolveAgainstMaster } from "../ingestions/quaterly-results/bse/bse-resolver.js";
import { HaltRun, runBseBackfill, type BseTarget } from "../ingestions/quaterly-results/bse/backfill-bse.js";
import {
  loadBaseline, persistBaseline, verifyAgainstPersisted,
} from "../ingestions/quaterly-results/bse/bse-fence-persist.js";

const SCRATCH =
  "C:/Users/Punctuations/AppData/Local/Temp/claude/c--Users-Punctuations-Desktop-Vytal/5f2365f2-6a2f-42f6-a2ed-4feee93f9306/scratchpad";
const MODE = process.argv.includes("--live") ? "live" : "plan";
const LEDGER = path.join(SCRATCH, `bse-cohort-ledger.${MODE}.jsonl`);
const BASELINE = path.join(SCRATCH, "bse-cohort-fence-baseline.jsonl");
const REPORT = path.join(SCRATCH, `bse-cohort-report.${MODE}.json`);
const MANIFEST = "../outputs/vytal-manual-entry-manifest.csv";

const CAPS = { quarterly_results: 44, banking_quarterly_results: 44, fundamentals: 18, banking_fundamentals: 18 } as const;

function parseCsv(t: string): string[][] {
  const rows: string[][] = [];
  let f = "", row: string[] = [], q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); f = ""; rows.push(row); row = []; }
    else if (c !== "\r") f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/** FY19 → 2019-03-31 when the manifest row carries only a fiscal-year label. */
function annualPeriodEnd(reportDate: string, fy: string): Date {
  if (reportDate) return new Date(reportDate + "T00:00:00.000Z");
  const y = 2000 + Number(String(fy).replace("FY", ""));
  return new Date(Date.UTC(y, 2, 31));
}

async function maxDepths(): Promise<Record<string, { max: number; over: number; worst: string }>> {
  const out: Record<string, { max: number; over: number; worst: string }> = {};
  for (const [t, cap] of Object.entries(CAPS)) {
    const r = await prisma.$queryRawUnsafe<Array<{ mx: number; n_over: number; sym: string | null }>>(
      `WITH d AS (SELECT x.stock_id, x.result_type, count(*)::int n FROM "${t}" x GROUP BY 1,2)
       SELECT coalesce(max(n),0)::int mx, count(*) FILTER (WHERE n > ${cap})::int n_over,
              (SELECT s.symbol FROM d JOIN stocks s ON s.id = d.stock_id ORDER BY d.n DESC LIMIT 1) sym
         FROM d`);
    out[t] = { max: r[0].mx, over: r[0].n_over, worst: r[0].sym ?? "-" };
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`\n══ BSE COHORT — ${MODE.toUpperCase()} ══\n`);

  // ── P5.0d PREFLIGHT ─────────────────────────────────────────────────────────
  const clock = await prisma.$queryRawUnsafe<Array<{ now: Date; tz: string }>>(
    `SELECT now() AS now, current_setting('TimeZone') AS tz`);
  const jobs = await prisma.$queryRawUnsafe<Array<{ status: string; n: number }>>(
    `SELECT status, count(*)::int n FROM background_jobs WHERE status IN ('running','pending') GROUP BY 1`);
  const lastPrune = await prisma.$queryRawUnsafe<Array<{ created_at: Date }>>(
    `SELECT created_at FROM background_jobs WHERE type='retention_prune' ORDER BY created_at DESC LIMIT 1`);
  const nowUtc = new Date(clock[0].now);
  const nextPrune = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 21, 30, 0));
  if (nextPrune <= nowUtc) nextPrune.setUTCDate(nextPrune.getUTCDate() + 1);
  const mins = Math.round((nextPrune.getTime() - nowUtc.getTime()) / 60000);

  console.log(`  DB clock            ${nowUtc.toISOString()}  (server TimeZone=${clock[0].tz})`);
  console.log(`  local IST           ${new Date(nowUtc.getTime() + 5.5 * 3600e3).toISOString().replace("T", " ").slice(0, 19)}`);
  console.log(`  background_jobs     ${jobs.length === 0 ? "0 running, 0 pending ✓" : JSON.stringify(jobs)}`);
  console.log(`  last retention_prune ${lastPrune[0] ? new Date(lastPrune[0].created_at).toISOString() : "none"}`);
  console.log(`  NEXT prune          ${nextPrune.toISOString()}  → the window is ${Math.floor(mins / 60)}h ${mins % 60}m wide`);
  const depth0 = await maxDepths();
  console.log(`  partition depth     ${Object.entries(depth0).map(([t, d]) => `${t.replace("_results", "").replace("quarterly", "Q").replace("fundamentals", "F")} ${d.max}/${CAPS[t as keyof typeof CAPS]}`).join(" · ")}`);
  const anyOver = Object.values(depth0).some((d) => d.over > 0);
  if (anyOver) throw new Error(`a partition is ALREADY over cap: ${JSON.stringify(depth0)}`);
  if (jobs.length) console.log(`  ⚠ jobs are in flight — a concurrent ingestion could move rows this run does not own`);

  // ── TARGETS ─────────────────────────────────────────────────────────────────
  const raw = parseCsv(fs.readFileSync(MANIFEST, "utf8"));
  const hdr = raw[0];
  const man = raw.slice(1).filter((r) => r[0]).map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i]])) as Record<string, string>);
  console.log(`\n  manifest            ${man.length} cells`);

  const stocks = await prisma.stock.findMany({ select: { id: true, symbol: true, isin: true, industryType: true } });
  const bySym = new Map(stocks.map((s) => [s.symbol, s]));

  const MASTER_CACHE = path.join(SCRATCH, "bse-scrip-master.json");
  const pacer = new BsePacer({ minSpacingMs: 4000, throttleStopMs: 90_000, slowMs: 8_000, maxSpacingMs: 20_000 });
  let master: Awaited<ReturnType<typeof fetchScripMaster>>;
  if (fs.existsSync(MASTER_CACHE)) {
    master = JSON.parse(fs.readFileSync(MASTER_CACHE, "utf8"));
    console.log(`  scrip master        ${master.length} rows (cached)`);
  } else {
    master = await fetchScripMaster(pacer);
    fs.writeFileSync(MASTER_CACHE, JSON.stringify(master));
    console.log(`  scrip master        ${master.length} rows (fetched)`);
  }

  const manSyms = [...new Set(man.map((m) => m.symbol))].filter((s) => bySym.has(s));
  const res = resolveAgainstMaster(manSyms.map((s) => ({ symbol: s, isin: bySym.get(s)!.isin })), master);
  const scrip = new Map(res.resolved.map((r) => [r.symbol, r]));
  console.log(`  cohort stocks       ${manSyms.length} in manifest ∩ universe · resolved ${res.resolved.length} · UNRESOLVED ${res.unresolved.length}`);
  if (res.unresolved.length) console.log(`    unresolved (NAMED): ${res.unresolved.map((u) => u.symbol).join(", ")}`);

  const seen = new Set<string>();
  const targets: BseTarget[] = [];
  for (const m of man) {
    const st = bySym.get(m.symbol);
    const sc = scrip.get(m.symbol);
    if (!st || !sc) continue;
    const annual = m.table === "fundamentals" || m.table === "banking_fundamentals";
    const periodEnd = annual ? annualPeriodEnd(m.report_date, m.fiscal_year) : new Date(m.report_date + "T00:00:00.000Z");
    if (Number.isNaN(periodEnd.getTime())) continue;
    const key = `${m.symbol}|${annual ? "annual" : "quarterly"}|${periodEnd.toISOString().slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      symbol: m.symbol, stockId: st.id, scripCode: sc.scripCode,
      grain: annual ? "annual" : "quarterly", periodEnd, basis: "standalone",
      // S8.4b — the routing key travels WITH the target
      industryType: st.industryType,
    });
  }

  // ⚠ RUN ORDER IS BY VALUE. A throttled run may not finish, so what runs first must be what proves
  //   most. The 408-cell balance-sheet block is the claim under test (P5.2d) — bank ANNUALS first.
  const BANK = new Set(stocks.filter((s) => s.industryType === "banking").map((s) => s.symbol));
  const priority = (t: BseTarget): number => {
    if (BANK.has(t.symbol) && t.grain === "annual") return 0;   // ← confirms the 408
    if (BANK.has(t.symbol)) return 1;
    if (t.periodEnd.toISOString().slice(0, 10) === "2022-06-30") return 2; // the 84-stock block
    if (t.grain === "annual") return 3;
    return 4;
  };
  targets.sort((a, b) => priority(a) - priority(b) || a.symbol.localeCompare(b.symbol) || a.periodEnd.getTime() - b.periodEnd.getTime());

  const perGrain = targets.reduce<Record<string, number>>((acc, t) => { acc[t.grain] = (acc[t.grain] ?? 0) + 1; return acc; }, {});
  console.log(`\n  TARGETS             ${targets.length} units  ${JSON.stringify(perGrain)}`);
  console.log(`    priority 0 (bank annual — the 408 test): ${targets.filter((t) => priority(t) === 0).length}`);
  console.log(`    priority 1 (bank quarterly)            : ${targets.filter((t) => priority(t) === 1).length}`);
  console.log(`    priority 2 (2022-06-30 block)          : ${targets.filter((t) => priority(t) === 2).length}`);
  console.log(`    priority 3 (other annual)              : ${targets.filter((t) => priority(t) === 3).length}`);
  console.log(`    priority 4 (other quarterly)           : ${targets.filter((t) => priority(t) === 4).length}`);

  if (MODE === "plan") {
    fs.writeFileSync(REPORT, JSON.stringify({ mode: MODE, targets: targets.length, perGrain, unresolved: res.unresolved }, null, 1));
    console.log(`\n  plan written → ${REPORT}\n`);
    await prisma.$disconnect();
    return;
  }

  // ── P5.0b — BASELINE, IMMEDIATELY BEFORE THE RUN ────────────────────────────
  console.log(`\n  capturing fence baseline → ${BASELINE}`);
  const h = await persistBaseline(prisma, BASELINE);
  const base = loadBaseline(BASELINE);
  console.log(`    ${Object.values(h.totals).reduce((a, b) => a + b, 0)} rows (${Object.values(h.nseTotals).reduce((a, b) => a + b, 0)} NSE) at ${h.capturedAt}`);

  const runStart = new Date(nowUtc);
  const chunkLog: Array<Record<string, unknown>> = [];
  let halted: string | null = null;

  const summary = await runBseBackfill(prisma, targets, {
    dryRun: false,
    ledgerFile: LEDGER,
    chunkSize: 25,
    pacer,
    onChunk: async (info) => {
      const fence = await verifyAgainstPersisted(prisma, base, runStart, new Set(info.targetedRowIds));
      const depth = await maxDepths();
      const over = Object.entries(depth).filter(([, d]) => d.over > 0);
      const gone = fence.movements.filter((m) => m.kind === "disappeared");
      chunkLog.push({
        chunk: info.index, outcomes: info.outcomes, medianLatencyMs: info.medianLatencyMs,
        attempted: info.attempted, filledRows: info.targetedRowIds.length,
        fence: { violations: fence.violations, notices: fence.notices },
        depth: Object.fromEntries(Object.entries(depth).map(([t, d]) => [t, d.max])),
      });
      if (fence.violations > 0 || gone.length > 0) {
        console.log(`\n  ‼ FENCE VIOLATION after chunk ${info.index} — HALTING`);
        for (const m of fence.movements.filter((x) => x.severity === "violation")) {
          console.log(`      ${m.table} ${m.kind} ${m.name} :: ${m.detail} [id ${m.rowId}]`);
        }
        halted = `fence: ${fence.violations} violation(s)`;
        throw new HaltRun(halted);
      }
      if (over.length) {
        console.log(`\n  ‼ PARTITION OVER CAP after chunk ${info.index} — HALTING: ${JSON.stringify(over)}`);
        halted = `retention: ${JSON.stringify(over)}`;
        throw new HaltRun(halted);
      }
    },
  });

  // ── AFTER ───────────────────────────────────────────────────────────────────
  const targeted = new Set(summary.targetedRowIds);
  const fence = await verifyAgainstPersisted(prisma, base, runStart, targeted);
  const depth = await maxDepths();

  // Did the nightly prune fire during the run?
  const prunes = await prisma.$queryRawUnsafe<Array<{ created_at: Date; result: unknown }>>(
    `SELECT created_at, result FROM background_jobs
      WHERE type='retention_prune' AND created_at >= $1 ORDER BY created_at`, runStart);

  console.log(`\n══ RESULT ══`);
  console.log(`  ${halted ? `⚠ HALTED — ${halted}` : summary.stopped ? `⚠ STOPPED — ${summary.stopped.reason}: ${summary.stopped.message}` : "completed"}`);
  console.log(`  attempted ${summary.attempted} · outcomes ${JSON.stringify(summary.outcomes)}`);
  console.log(`  ratio refusals ${summary.ratioRefusals} · rows column-filled ${targeted.size} · cells held not-null ${summary.cellsHeldNotNull}`);
  console.log(`  cells filled: ${JSON.stringify(summary.cellsFilled)}`);
  console.log(`\n  FENCE  violations ${fence.violations} · notices ${fence.notices}`);
  for (const m of fence.movements.filter((x) => x.severity === "violation").slice(0, 20)) {
    console.log(`    ‼ ${m.table} ${m.kind} ${m.name} :: ${m.detail}`);
  }
  console.log(`  DEPTH  ${Object.entries(depth).map(([t, d]) => `${t} ${d.max}/${CAPS[t as keyof typeof CAPS]}${d.over ? ` OVER=${d.over}` : ""}`).join(" · ")}`);
  console.log(`  PRUNES during the run: ${prunes.length}`);
  for (const p of prunes) {
    const r = (typeof p.result === "string" ? JSON.parse(p.result) : p.result) as { results?: Array<{ table: string; deleted: number }> };
    const del = (r.results ?? []).filter((x) => x.deleted > 0);
    console.log(`    ${new Date(p.created_at).toISOString()} — ${del.length ? del.map((x) => `${x.table}:${x.deleted}`).join(" ") : "deleted nothing"}`);
  }

  fs.writeFileSync(REPORT, JSON.stringify({
    mode: MODE, runStart, halted, summary, chunkLog,
    fence: { violations: fence.violations, notices: fence.notices, movements: fence.movements.slice(0, 500) },
    depth, prunes: prunes.map((p) => ({ at: p.created_at, result: p.result })),
  }, null, 1));
  console.log(`\n  report → ${REPORT}\n`);
  await prisma.$disconnect();
  process.exit(fence.violations === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
