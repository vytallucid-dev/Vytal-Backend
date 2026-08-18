// ═══════════════════════════════════════════════════════════════
// F5 — CAN A MOMENTUM SCORE BE PRODUCED AT 2022-01-31? READ-ONLY.
//   npx tsx src/scripts/_f5-momentum.ts
//
// ⚠ NO SCORING. Nothing is written, nothing is enqueued, no ScoreSnapshot is
//   touched. This calls the SAME loaders and the SAME metric functions the engine
//   calls, with the SAME point-in-time cutoff the backfill would use, purely as
//   measurement. Every number below is the engine's own arithmetic.
//
// THE QUESTION. "How many stocks are complete" has been the programme's headline and
// it is the wrong number: completeness is measured to today, and a gap in 2023 is
// irrelevant to a score struck at 2022-01-31. What decides Stage 7 is how many stocks
// can produce a Momentum pillar AT THAT DATE, counting BACK.
//
// THE REQUIREMENTS, READ OFF THE CODE RATHER THAN ASSUMED:
//   NON-FINANCIAL (metrics/momentum.ts)
//     M1 OPM · M2 NPM · M5 interest cover : 4 consecutive quarters (one TTM window)
//     M3 revenue YoY · M4 profit YoY      : 8 consecutive (two back-to-back TTMs)
//     L3 own-history                      : M_CFG.l3MinN = 6 usable history points
//                                           ⇒ 9 consecutive for the 4-quarter metrics,
//                                             13 consecutive for M3/M4.
//   BANKING (metrics/banking.ts) — DIFFERENT SHAPE, and this is the part a single
//     "8 consecutive quarters" headline would get wrong:
//     M1 NIM      : 4 consecutive QUARTERS (+ 2 annual rows for earning assets)
//     M2/M3/M4    : 2 consecutive ANNUAL FYs — no quarterly run at all
//     M5 GNPA TTM : the latest quarter alone
//
// "Consecutive" is consecutiveTail's own definition: the maximal run ending at the
// LATEST quarter, stepping back one ordinal at a time. A hole anywhere truncates it.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";
import { loadMomentumStandalone, loadFoundationStandalone } from "../scoring/metrics/load.js";
import { loadBankingCtx } from "../scoring/metrics/banking-load.js";
import {
  consecutiveTail, m1TtmOpm, m2TtmNpm, m3RevenueYoyTtm, m4NetProfitYoyTtm, m5TtmInterestCoverage,
} from "../scoring/metrics/momentum.js";
import { BANKING_MOMENTUM_FNS, bankingSeriesForKey } from "../scoring/metrics/banking.js";
import { dispatchLiveValues } from "../scoring/metric-scoring/live-dispatch.js";
import type { MomentumQuarter } from "../scoring/metrics/types.js";

const DIR = process.env.R1_DIR ?? ".";
const AS_OF = new Date(Date.UTC(2022, 0, 31)); // 2022-01-31
const L3_MIN_N = 6; // M_CFG.l3MinN in composite/score-pass.ts
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;

/** L3 depth for a non-financial momentum key: how many prefixes yield a value.
 *
 * ⚠ THE KEYS ARE "M1".."M5". A first cut passed "OPM"/"RevYoY" — names that appear in
 *   the metric LABELS but not in MOMENTUM_DISPATCH — so every lookup fell through to
 *   `noFn` and the depth read 0 for all 416 stocks. A metric that is unavailable for
 *   every single stock is the tell for a wrong key, not a data fact.
 *
 * Mirrors score-pass.ts `seriesForKey`: prefix by prefix, dispatch, keep the available
 * ones. The dispatch's own first step is `consecutiveTail(momentumQuarters)`, so calling
 * the metric fn on the tail of each prefix is the identical computation, without paying
 * for the dispatch object 40 times per stock. */
const NF_MOMENTUM_FN: Record<string, (r: MomentumQuarter[]) => { available: boolean; value: number | null }> = {
  M1: m1TtmOpm, M2: m2TtmNpm, M3: m3RevenueYoyTtm, M4: m4NetProfitYoyTtm, M5: m5TtmInterestCoverage,
};
function l3Depth(qRows: MomentumQuarter[], key: string): number {
  const fn = NF_MOMENTUM_FN[key];
  if (!fn) throw new Error(`unknown momentum key ${key} — MOMENTUM_DISPATCH keys are M1..M5`);
  const rows = [...qRows].sort((a, b) => a.qOrdinal - b.qOrdinal);
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const v = fn(consecutiveTail(rows.slice(0, i + 1)));
    if (v.available && v.value !== null) n++;
  }
  return n;
}

interface Row {
  sym: string; ind: string;
  loaded: number; tail: number;
  span: string | null;
  metrics: Record<string, boolean>;
  reasons: Record<string, string | null>;
  l3: Record<string, number>;
}

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F5 — MOMENTUM AT ${AS_OF.toISOString().slice(0, 10)} · counting BACK · READ-ONLY, NO SCORING     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  const cohort = await loadCohort();
  const nf = cohort.filter((c) => c.industryType === "non_financial");
  const bk = cohort.filter((c) => c.industryType === "banking");
  console.log(`  cohort ${cohort.length}   ·   non-financial ${nf.length}   ·   banking ${bk.length}\n`);

  const rows: Row[] = [];
  const bkNow: Array<{ sym: string; now: Record<string, boolean> }> = [];

  // ── NON-FINANCIAL ───────────────────────────────────────────────────────
  let i = 0;
  for (const c of nf) {
    process.stdout.write(`\r  non-financial ${++i}/${nf.length}   `);
    const q = await loadMomentumStandalone(c.id, AS_OF);
    const run = consecutiveTail(q);
    const m1 = m1TtmOpm(run), m2 = m2TtmNpm(run), m3 = m3RevenueYoyTtm(run), m4 = m4NetProfitYoyTtm(run), m5 = m5TtmInterestCoverage(run);
    rows.push({
      sym: c.symbol, ind: c.industryType, loaded: q.length, tail: run.length,
      span: run.length ? `${run[0].fiscalYear}${run[0].quarter}..${run[run.length - 1].fiscalYear}${run[run.length - 1].quarter}` : null,
      metrics: { M1: !!m1.available, M2: !!m2.available, M3: !!m3.available, M4: !!m4.available, M5: !!m5.available },
      reasons: { M1: m1.reason ?? null, M2: m2.reason ?? null, M3: m3.reason ?? null, M4: m4.reason ?? null, M5: m5.reason ?? null },
      l3: { M1: l3Depth(q, "M1"), M3: l3Depth(q, "M3") },
    });
  }
  console.log(``);

  // ── BANKING ─────────────────────────────────────────────────────────────
  i = 0;
  for (const c of bk) {
    process.stdout.write(`\r  banking ${++i}/${bk.length}   `);
    const ctx = await loadBankingCtx(c.symbol, c.id, AS_OF);
    const out: Record<string, boolean> = {};
    const reasons: Record<string, string | null> = {};
    for (const [k, fn] of Object.entries(BANKING_MOMENTUM_FNS)) {
      const v = fn(ctx);
      out[k] = !!v.available;
      reasons[k] = v.reason ?? null;
    }
    // banking's quarterly run, on the same consecutiveTail definition
    const qs = [...ctx.quarterly].sort((a, b) => a.qOrdinal - b.qOrdinal);
    let tail = qs.length ? 1 : 0;
    for (let j = qs.length - 2; j >= 0; j--) { if (qs[j].qOrdinal === qs[j + 1].qOrdinal - 1) tail++; else break; }
    // CONTROL — the same metrics with NO cutoff. A metric that fails at 2022-01-31 but
    // succeeds today is a HISTORICAL data gap; one that fails at both is a standing gap
    // in the banking pipeline and has nothing to do with the as-of date.
    const ctxNow = await loadBankingCtx(c.symbol, c.id);
    const now: Record<string, boolean> = {};
    for (const [k, fn] of Object.entries(BANKING_MOMENTUM_FNS)) now[k] = !!fn(ctxNow).available;
    bkNow.push({ sym: c.symbol, now });
    rows.push({
      sym: c.symbol, ind: c.industryType, loaded: ctx.quarterly.length, tail,
      span: qs.length ? `${qs[qs.length - tail].fiscalYear}${qs[qs.length - tail].quarter}..${qs[qs.length - 1].fiscalYear}${qs[qs.length - 1].quarter}` : null,
      metrics: out, reasons,
      l3: { NIM: bankingSeriesForKey(ctx, "NIM").length, NII: bankingSeriesForKey(ctx, "NII").length },
    });
  }
  console.log(`\n`);

  // ── THE ANSWER ──────────────────────────────────────────────────────────
  const nfR = rows.filter((r) => r.ind === "non_financial");
  const bkR = rows.filter((r) => r.ind === "banking");

  const band = (rs: Row[], k: number) => rs.filter((r) => r.tail >= k).length;
  console.log(`╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ CONSECUTIVE-QUARTER RUN ENDING AT OR BEFORE ${AS_OF.toISOString().slice(0, 10)}                     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("consecutive quarters", 30)}${lp("non-financial", 16)}${lp("banking", 12)}${lp("all", 8)}`);
  for (const k of [1, 4, 8, 9, 13]) {
    const a = band(nfR, k), b = band(bkR, k);
    const note = k === 4 ? "  ← M1/M2/M5 (nf) · M1 NIM (bk)" : k === 8 ? "  ← M3/M4 (nf)" : k === 9 ? "  ← L3 on the 4-quarter metrics" : k === 13 ? "  ← L3 on M3/M4" : "";
    console.log(`  ${pad(`≥ ${k}`, 30)}${lp(`${a} (${pct(a, nfR.length)})`, 16)}${lp(`${b} (${pct(b, bkR.length)})`, 12)}${lp(a + b, 8)}${note}`);
  }
  const zero = rows.filter((r) => r.tail === 0);
  console.log(`  ${pad("zero rows at the cutoff", 30)}${lp(nfR.filter((r) => r.tail === 0).length, 16)}${lp(bkR.filter((r) => r.tail === 0).length, 12)}${lp(zero.length, 8)}`);

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ WHICH METRICS ACTUALLY COMPUTE (run length AND the line items present)     ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ── NON-FINANCIAL (${nfR.length}) ──`);
  console.log(`  ${pad("metric", 34)}${lp("computes", 10)}${lp("share", 9)}   top blocking reason`);
  for (const [k, label] of [["M1", "M1 TTM operating margin %"], ["M2", "M2 TTM net margin %"], ["M3", "M3 revenue YoY (TTM v TTM) %"], ["M4", "M4 net profit YoY (TTM) %"], ["M5", "M5 TTM interest coverage"]] as const) {
    const ok = nfR.filter((r) => r.metrics[k]).length;
    const why = new Map<string, number>();
    for (const r of nfR) if (!r.metrics[k]) why.set(r.reasons[k] ?? "?", (why.get(r.reasons[k] ?? "?") ?? 0) + 1);
    const top = [...why].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w, n]) => `${w}×${n}`).join("  ");
    console.log(`  ${pad(label, 34)}${lp(ok, 10)}${lp(pct(ok, nfR.length), 9)}   ${top}`);
  }
  const nfL3M3 = nfR.filter((r) => r.l3.M3 >= L3_MIN_N).length;
  const nfL3M1 = nfR.filter((r) => r.l3.M1 >= L3_MIN_N).length;
  console.log(`  ${pad(`L3 available on M1 (depth ≥ ${L3_MIN_N})`, 34)}${lp(nfL3M1, 10)}${lp(pct(nfL3M1, nfR.length), 9)}`);
  console.log(`  ${pad(`L3 available on M3 (depth ≥ ${L3_MIN_N})`, 34)}${lp(nfL3M3, 10)}${lp(pct(nfL3M3, nfR.length), 9)}`);

  console.log(`\n  ── BANKING (${bkR.length}) ──`);
  console.log(`  ${pad("metric", 34)}${lp("computes", 10)}${lp("share", 9)}   top blocking reason`);
  for (const [k, label] of [["NIM", "M1 NIM (TTM) %"], ["PPOP", "M2 PPOP YoY % (annual)"], ["NII", "M3 NII YoY % (annual)"], ["NPyoy", "M4 net profit YoY % (annual)"], ["GNPAttm", "M5 gross NPA (TTM) %"]] as const) {
    const ok = bkR.filter((r) => r.metrics[k]).length;
    const why = new Map<string, number>();
    for (const r of bkR) if (!r.metrics[k]) why.set(r.reasons[k] ?? "?", (why.get(r.reasons[k] ?? "?") ?? 0) + 1);
    const top = [...why].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w, n]) => `${w}×${n}`).join("  ");
    console.log(`  ${pad(label, 34)}${lp(ok, 10)}${lp(pct(ok, bkR.length), 9)}   ${top}`);
  }
  const bkL3 = bkR.filter((r) => r.l3.NIM >= L3_MIN_N).length;
  console.log(`  ${pad(`L3 available on NIM (depth ≥ ${L3_MIN_N})`, 34)}${lp(bkL3, 10)}${lp(pct(bkL3, bkR.length), 9)}`);
  console.log(`
  ── BANKING CONTROL: the same metrics with NO cutoff (today) ──`);
  console.log(`  ${pad("metric", 34)}${lp("at 2022-01-31", 15)}${lp("today", 9)}   reading`);
  for (const k of ["NIM", "PPOP", "NII", "NPyoy", "GNPAttm"]) {
    const then = bkR.filter((r) => r.metrics[k]).length;
    const nw = bkNow.filter((r) => r.now[k]).length;
    const reading = nw > then ? "historical gap — the data arrives later" : nw === then && nw === 0 ? "STANDING gap — fails at both dates" : "unchanged";
    console.log(`  ${pad(k, 34)}${lp(then, 15)}${lp(nw, 9)}   ${reading}`);
  }

  // ── the pillar-level answer ──────────────────────────────────────────────
  const nfFull = nfR.filter((r) => r.metrics.M1 && r.metrics.M2 && r.metrics.M3 && r.metrics.M4 && r.metrics.M5).length;
  const nfAny = nfR.filter((r) => Object.values(r.metrics).some(Boolean)).length;
  const bkFull = bkR.filter((r) => Object.values(r.metrics).every(Boolean)).length;
  const bkAny = bkR.filter((r) => Object.values(r.metrics).some(Boolean)).length;
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ THE PILLAR-LEVEL ANSWER                                                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("", 34)}${lp("non-financial", 16)}${lp("banking", 12)}${lp("all", 8)}`);
  console.log(`  ${pad("ALL 5 momentum metrics compute", 34)}${lp(`${nfFull} (${pct(nfFull, nfR.length)})`, 16)}${lp(`${bkFull} (${pct(bkFull, bkR.length)})`, 12)}${lp(nfFull + bkFull, 8)}`);
  console.log(`  ${pad("at least one computes", 34)}${lp(`${nfAny} (${pct(nfAny, nfR.length)})`, 16)}${lp(`${bkAny} (${pct(bkAny, bkR.length)})`, 12)}${lp(nfAny + bkAny, 8)}`);
  console.log(`  ${pad("NONE compute", 34)}${lp(nfR.length - nfAny, 16)}${lp(bkR.length - bkAny, 12)}${lp(cohort.length - nfAny - bkAny, 8)}`);

  // who is short, and by how much
  const short = nfR.filter((r) => r.tail < 8).sort((a, b) => a.tail - b.tail);
  console.log(`\n  ── non-financial stocks with a run < 8 at the cutoff (${short.length}) ──`);
  console.log(`  ${pad("symbol", 14)}${lp("loaded", 8)}${lp("tail", 6)}   span`);
  for (const r of short.slice(0, 45)) console.log(`  ${pad(r.sym, 14)}${lp(r.loaded, 8)}${lp(r.tail, 6)}   ${r.span ?? "(none)"}`);
  if (short.length > 45) console.log(`  … ${short.length - 45} more (full list in the JSON)`);

  writeFileSync(`${DIR}/_f5-momentum.json`, JSON.stringify({ asOf: AS_OF.toISOString().slice(0, 10), rows, bkNow }, null, 1));
  console.log(`\n  → ${DIR}/_f5-momentum.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
