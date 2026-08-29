// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// S6.3a — THE BSE PILOT. 24 stocks, chosen deliberately; see PILOT below for why each.
//
//   npx tsx src/scripts/bse-pilot.ts --plan          list the units, fetch nothing
//   npx tsx src/scripts/bse-pilot.ts --dry           run the lane, write nothing
//   npx tsx src/scripts/bse-pilot.ts --live          WRITE, scoped to these stocks only
//
// ⚠ The fence is captured BEFORE anything runs and verified AFTER, on every run mode. Layer (1) is
//   in the writer (INSERT … ON CONFLICT DO NOTHING); this script supplies layers (2) and (3).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import { BsePacer } from "../ingestions/quaterly-results/bse/bse-http.js";
import { fetchScripMaster, resolveAgainstMaster } from "../ingestions/quaterly-results/bse/bse-resolver.js";
import { captureBaseline, verifyFence } from "../ingestions/quaterly-results/bse/bse-fence.js";
import { runBseBackfill, type BseTarget } from "../ingestions/quaterly-results/bse/backfill-bse.js";
import type { RatioVerdict } from "../ingestions/quaterly-results/bse/bse-ratio-gate.js";

/** Every pilot stock, with the reason it is in the pilot. A pilot without stated intent is a sample. */
const PILOT: Record<string, string> = {
  // ── the 2022-06-30 block, the 84-stock question, across sectors ────────────────
  ASIANPAINT: "2022-06-30 · Consumer Discretionary · type B · Stage-5 reference (known-good extraction)",
  BPCL: "2022-06-30 · Oil Gas & Energy · type C · Stage-5 reference",
  SUNPHARMA: "2022-06-30 · Pharma · type B",
  JINDALSTEL: "2022-06-30 · Metals & Mining · type C",
  IDEA: "2022-06-30 · Telecom · type C · loss-making, negative P&L path",
  TATAPOWER: "2022-06-30 · Power · a 6th sector at the key period",
  // ── banks: the ratio gate's live test ─────────────────────────────────────────
  AUBANK: "bank · the gate's reference case (CET1 0.0019, ROA exactly 0 in FY19 annual)",
  ICICIBANK: "bank · large private · type B at 2022-06-30 — bank AND the key period",
  FEDERALBNK: "bank · most outstanding quarters (28) — widest banking exposure",
  CUB: "bank · small private, different disclosure profile from the majors",
  // ── the older clusters ────────────────────────────────────────────────────────
  EMAMILTD: "AMBIGUOUS ISIN · spans 2018-06-30, 2019-03-31, 2022-06-30 and FY19 annual",
  APARINDS: "AMBIGUOUS ISIN · spans 2018-06-30, 2019-03-31, 2019-06-30 and FY19 annual",
  HCLTECH: "2018-06-30 cluster · IT · Stage-5 reference",
  NTPC: "2019-06-30 cluster · Power · Stage-5 reference",
  AMBUJACEM: "2019-03-31 · ⚠ JAN–DEC FISCAL YEAR — the S4.3 case, its March filing is Q1 not Q4",
  // ── March-FY March filings: the period trap, live ─────────────────────────────
  JBCHEPHARM: "★ THE RESOLVER RECOVERY, END TO END — flagged Suspended by BSE, recovered by dropping the status filter",
  ACC: "March-FY March filing · Stage-5 cross-source reference (19/19 exact)",
  ATUL: "AMBIGUOUS ISIN · March-FY annual + quarterlies",
  UPL: "AMBIGUOUS ISIN · March-FY annual",
  // ── the annual-availability risk band (63% measured) ──────────────────────────
  ASHOKLEY: "★ the known listed_without_xbrl case — FY19 annual filed, no XBRL. Proves the outcome is recorded DISTINCTLY from not_listed",
  AEGISLOG: "2018-03-31 annual, type B — the thin end of the annual availability band",
  GALLANTT: "2018-03-31 + 2021-03-31 annual, type B — small cap, older annuals",
  // ── controls ──────────────────────────────────────────────────────────────────
  "M&M": "2021-12-31 · the recent control — if this fails the problem is access, not vintage",
  BOSCHLTD: "2022-06-30 + older quarters · Automobile · a second Stage-5-probed sector",
};

const SCRATCH =
  "C:/Users/Punctuations/AppData/Local/Temp/claude/c--Users-Punctuations-Desktop-Vytal/5f2365f2-6a2f-42f6-a2ed-4feee93f9306/scratchpad";
type Mode = "plan" | "dry" | "live";
const mode: Mode = process.argv.includes("--live") ? "live" : process.argv.includes("--dry") ? "dry" : "plan";

// ⚠ THE LEDGER IS PER MODE, AND IT HAS TO BE. A dry run records every unit as `dry_run`; if a live
//   run then shared that file it would see every unit already decided and SKIP THE ENTIRE PILOT,
//   reporting a clean zero-write run that never fetched anything. Same file, opposite meaning.
const LEDGER = path.join(SCRATCH, `bse-pilot-ledger.${mode}.jsonl`);
const REPORT = path.join(SCRATCH, `bse-pilot-report.${mode}.json`);

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

/** FY19 → 2019-03-31. Annual manifest rows carry only a fiscal-year label. */
function annualPeriodEnd(reportDate: string, fy: string): Date {
  if (reportDate) return new Date(reportDate + "T00:00:00.000Z");
  const y = 2000 + Number(String(fy).replace("FY", ""));
  return new Date(Date.UTC(y, 2, 31));
}

async function main(): Promise<void> {
  const raw = parseCsv(fs.readFileSync("../outputs/vytal-manual-entry-manifest.csv", "utf8"));
  const hdr = raw[0];
  const man = raw.slice(1).filter((r) => r[0]).map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i]])) as Record<string, string>);

  const symbols = Object.keys(PILOT);
  const stocks = await prisma.stock.findMany({
    where: { symbol: { in: symbols } },
    select: { id: true, symbol: true, isin: true, industryType: true, sector: { select: { displayName: true, name: true } } },
  });
  const missing = symbols.filter((s) => !stocks.some((x) => x.symbol === s));
  if (missing.length) throw new Error(`pilot symbols not in the universe: ${missing.join(", ")}`);

  const pacer = new BsePacer({ minSpacingMs: 4000, throttleStopMs: 90_000, slowMs: 8_000, maxSpacingMs: 20_000 });
  // throttleStopMs is deliberately far above the observed 28s plateau: at that latency BSE is
  // DEGRADED, not broken, and still returns complete payloads. Only a genuine failure stops the run.

  // ⚠ CACHE THE SCRIP MASTER. It is a 1.7 MB response and it is the FIRST call of every run,
  //   including every resume after a throttle stop. MEASURED: two consecutive resumes were throttled
  //   on the very next request after fetching it, while a lone probe seconds earlier ran at 1.3 s —
  //   so the throttle responds to volume, not just request count, and re-pulling 1.7 MB to learn
  //   nothing new is the most expensive thing this run does. The master changes on listing/delisting
  //   timescales; a run-local cache is correct, and it is also simply politer.
  const MASTER_CACHE = path.join(SCRATCH, "bse-scrip-master.json");
  let master;
  if (fs.existsSync(MASTER_CACHE)) {
    master = JSON.parse(fs.readFileSync(MASTER_CACHE, "utf8"));
    console.log(`scrip master: ${master.length} rows (cached — ${MASTER_CACHE})`);
  } else {
    master = await fetchScripMaster(pacer);
    fs.writeFileSync(MASTER_CACHE, JSON.stringify(master));
    console.log(`scrip master: ${master.length} rows (fetched, cached for resumes)`);
  }
  const res = resolveAgainstMaster(stocks.map((s) => ({ symbol: s.symbol, isin: s.isin })), master);
  if (res.unresolved.length) {
    console.log(`⚠ unresolved pilot stocks (NAMED): ${res.unresolved.map((u) => u.symbol).join(", ")}`);
  }
  const scrip = new Map(res.resolved.map((r) => [r.symbol, r]));

  // Build one target per distinct (symbol, table, period). Standalone only — every scoring loader
  // filters resultType:"standalone", so consolidated would be written and never read.
  const seen = new Set<string>();
  const targets: BseTarget[] = [];
  for (const m of man) {
    if (!PILOT[m.symbol]) continue;
    const st = stocks.find((s) => s.symbol === m.symbol);
    const sc = scrip.get(m.symbol);
    if (!st || !sc) continue;
    const annual = m.table === "fundamentals" || m.table === "banking_fundamentals";
    const periodEnd = annual ? annualPeriodEnd(m.report_date, m.fiscal_year) : new Date(m.report_date + "T00:00:00.000Z");
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
  // ── PER-STOCK UNIT CAP ─────────────────────────────────────────────────────
  // ⚠ A SCOPING DECISION, STATED RATHER THAN HIDDEN. The 24 stocks carry 202 outstanding units,
  //   and BSE's throttle budget — heavily depleted by this session's earlier probing — yields only
  //   ~5 units per 4-minute resume cycle, so 202 units is hours of wall-clock for no extra evidence.
  //   The cap keeps EVERY stock and EVERY required test case; it only trims the long tail of extra
  //   bank quarters, which repeat a test the first few already make.
  //   Priority below is by what each period PROVES, not by date.
  const CAP = Number(process.env.BSE_PILOT_CAP ?? 6);
  const BANKS = new Set(["AUBANK", "ICICIBANK", "FEDERALBNK", "CUB"]);
  function priority(t: BseTarget): number {
    const p = t.periodEnd.toISOString().slice(0, 10);
    // ⚠ BANK QUARTERLIES FIRST — corrected mid-pilot. The first ordering spent AUBANK's whole cap on
    //   ANNUAL units, every one of which is a type-A row we already hold, so they all came back
    //   `skipped_nse_holds` and the ratio gate produced ZERO live verdicts. The gate only fires on a
    //   bank quarterly the lane actually writes, so that is what the cap must buy.
    if (BANKS.has(t.symbol) && t.grain === "quarterly") return 0;
    if (p === "2022-06-30") return 1;              // the 84-stock block — the headline question
    if (t.grain === "annual") return 2;            // the period trap + the annual coverage band
    if (p === "2018-06-30" || p === "2019-06-30" || p === "2019-03-31") return 3; // vintage clusters
    if (p === "2021-12-31") return 4;              // the recent control
    return 5;
  }
  const capped: BseTarget[] = [];
  const perSym = new Map<string, number>();
  for (const t of [...targets].sort((a, b) => priority(a) - priority(b) || a.periodEnd.getTime() - b.periodEnd.getTime())) {
    const n = perSym.get(t.symbol) ?? 0;
    if (n >= CAP) continue;
    perSym.set(t.symbol, n + 1);
    capped.push(t);
  }
  const dropped = targets.length - capped.length;
  targets.length = 0;
  targets.push(...capped);
  // ⚠ RUN ORDER IS BY VALUE, NOT ALPHABET. A throttled run may not finish; if it stops early the
  //   units that ran must be the ones that PROVE something. Alphabetical order got 9 A–B stocks
  //   and left every bank and JBCHEPHARM untouched.
  const FIRST = new Set(["JBCHEPHARM"]);
  targets.sort((a, b) =>
    (FIRST.has(b.symbol) ? 1 : 0) - (FIRST.has(a.symbol) ? 1 : 0) ||
    priority(a) - priority(b) ||
    a.symbol.localeCompare(b.symbol) ||
    a.periodEnd.getTime() - b.periodEnd.getTime());
  if (dropped) console.log(`⚠ per-stock cap ${CAP}: ${targets.length} units kept, ${dropped} deferred to the cohort run (not failures — never attempted)`);

  console.log(`PILOT — ${symbols.length} stocks · ${targets.length} units · mode=${mode}`);
  const perStock: Record<string, number> = {};
  for (const t of targets) perStock[t.symbol] = (perStock[t.symbol] ?? 0) + 1;
  for (const s of symbols) {
    const r = scrip.get(s);
    console.log(
      `  ${s.padEnd(12)}${String(r?.scripCode ?? "UNRESOLVED").padEnd(8)}${String(perStock[s] ?? 0).padStart(3)} units${r?.ambiguous ? "  [AMBIGUOUS ISIN]" : ""}${r && r.bseStatus !== "Active" ? `  [BSE says ${r.bseStatus}]` : ""}`,
    );
    console.log(`                ↳ ${PILOT[s]}`);
  }
  if (mode === "plan") {
    await prisma.$disconnect();
    return;
  }

  // ── THE FENCE, BEFORE ──────────────────────────────────────────────────────
  const runStart = new Date();
  const baseline = await captureBaseline(prisma);
  console.log(`\nFENCE baseline: ${JSON.stringify(baseline.totals)} NSE rows captured at ${baseline.capturedAt.toISOString()}`);

  // ── AUTO-RESUME ────────────────────────────────────────────────────────────
  // ⚠ A throttle stop is EXPECTED, not exceptional, and the ledger is what makes it cheap: every
  //   decided unit is durable, so a resume re-fetches nothing it has already answered. MEASURED
  //   across three attempts, the budget has a longer memory than the ~2-minute recovery implies —
  //   an early run got ~50 calls before stopping, a later one got ~5. So the loop backs off for a
  //   fixed cooldown and resumes, rather than trying to guess a safe rate up front.
  const ratioLog: Array<{ symbol: string; period: string; verdicts: RatioVerdict[] }> = [];
  const COOLDOWN_MS = 180_000;
  const MAX_CYCLES = 40;
  let summary = await runBseBackfill(prisma, targets, {
    dryRun: mode !== "live",
    ledgerFile: LEDGER,
    chunkSize: 20,
    pacer,
    onRatioVerdicts: (symbol, period, verdicts) => ratioLog.push({ symbol, period, verdicts }),
  });
  const totals: Record<string, number> = { ...summary.outcomes };
  let cycles = 1;
  while (summary.stopped && cycles < MAX_CYCLES) {
    cycles++;
    console.log(`  ↻ cooldown ${COOLDOWN_MS / 1000}s, then resuming from the ledger (cycle ${cycles})`);
    await new Promise((r) => setTimeout(r, COOLDOWN_MS));
    summary = await runBseBackfill(prisma, targets, {
      dryRun: mode !== "live",
      ledgerFile: LEDGER,
      chunkSize: 20,
      pacer: new BsePacer({ minSpacingMs: 4000, throttleStopMs: 90_000, slowMs: 8_000, maxSpacingMs: 20_000 }),
      onRatioVerdicts: (symbol, period, verdicts) => ratioLog.push({ symbol, period, verdicts }),
    });
    for (const [k, v] of Object.entries(summary.outcomes)) totals[k] = (totals[k] ?? 0) + v;
    if (summary.attempted === 0 && !summary.stopped) break;
  }
  summary.outcomes = totals;
  console.log(`  resume cycles used: ${cycles}`);

  // ── THE FENCE, AFTER ───────────────────────────────────────────────────────
  const fence = await verifyFence(prisma, baseline, runStart);
  console.log(`\nFENCE verify → ok=${fence.ok}`);
  console.log(`  violations: ${fence.violations.length}`);
  console.log(`  NSE rows with updated_at > run_start: ${JSON.stringify(fence.touchedSinceStart)}`);
  console.log(`  NSE row totals before/after: ${JSON.stringify(fence.baselineTotals)} / ${JSON.stringify(fence.afterTotals)}`);
  if (!fence.ok) {
    console.log("\n❌ FENCE BREACH — stopping. Violations:");
    for (const v of fence.violations.slice(0, 20)) console.log(`   ${v.table} ${v.kind} ${v.rowId} ${v.detail}`);
  }

  console.log(`\nRUN: attempted=${summary.attempted} outcomes=${JSON.stringify(summary.outcomes)}`);
  if (summary.stopped) console.log(`  ⚠ ${summary.stopped.reason} after ${summary.stopped.afterUnits} units`);
  const lat = summary.latencies;
  if (lat.length) {
    const s = [...lat].sort((a, b) => a - b);
    console.log(`  latency: n=${s.length} median=${Math.round(s[Math.floor(s.length / 2)])}ms p90=${Math.round(s[Math.floor(s.length * 0.9)])}ms max=${Math.round(s[s.length - 1])}ms`);
  }

  fs.writeFileSync(REPORT, JSON.stringify({ mode, runStart, summary, fence, ratioLog, targets: targets.length }, null, 1));
  console.log(`\nreport → ${REPORT}`);
  await prisma.$disconnect();
}

await main();
