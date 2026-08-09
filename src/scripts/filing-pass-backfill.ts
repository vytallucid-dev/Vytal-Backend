// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FILING PASS · FULL-UNIVERSE BACKFILL + CENSUS.
//
// Runs the filing pass across every ACTIVE stock and reports what came back. This is the first look
// at real data across the whole universe and the point at which a wrong threshold shows itself.
//
// ⚠ NOTHING IS TUNED HERE. Thresholds are Phase 2 and research-only. The numbers are reported as
// found, including the ones that look wrong — a rule firing on 60% of the universe is a finding about
// the rule, and hiding it behind a quick threshold edit would destroy the only evidence that says so.
//
//   npx tsx src/scripts/filing-pass-backfill.ts [--dry]
//
// --dry computes and reports without writing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { computeFilingPass, persistFilingPass, filingUniverse, type FilingPassResult } from "../filing/pass.js";
import { FILING_REGISTRY } from "../filing/registry.js";

const DRY = process.argv.includes("--dry");
const asOf = new Date();

type Cohort = "scored" | "covered_unscored" | "display_only";

interface RuleTally {
  evaluated: number;
  fired: number;
  notFired: number;
  notEvaluable: number;
  reasons: Map<string, number>;
  noPeriod: number;
  firedByIndustry: Map<string, number>;
  firedByCohort: Map<Cohort, number>;
  evaluatedByCohort: Map<Cohort, number>;
}

const tally = (): RuleTally => ({
  evaluated: 0, fired: 0, notFired: 0, notEvaluable: 0,
  reasons: new Map(), noPeriod: 0,
  firedByIndustry: new Map(), firedByCohort: new Map(), evaluatedByCohort: new Map(),
});

const inc = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
const pad = (s: string, n: number) => s.padEnd(n);
const rpad = (n: number | string, w: number) => String(n).padStart(w);

async function main() {
  const universe = await filingUniverse();

  // ── COHORTS ────────────────────────────────────────────────────────────────────────────────────
  // scored           = has at least one ScoreSnapshot
  // covered_unscored = in a peer group, never scored
  // display_only     = no peer group (the display-only firewall — never scored by design)
  const scoredIds = new Set((await prisma.scoreSnapshot.findMany({ select: { stockId: true }, distinct: ["stockId"] })).map((r) => r.stockId));
  const pgIds = new Set((await prisma.stockPeerGroup.findMany({ select: { stockId: true }, distinct: ["stockId"] })).map((r) => r.stockId));
  const cohortOf = (stockId: string): Cohort =>
    scoredIds.has(stockId) ? "scored" : pgIds.has(stockId) ? "covered_unscored" : "display_only";

  const cohortSize: Record<Cohort, number> = { scored: 0, covered_unscored: 0, display_only: 0 };
  for (const s of universe) cohortSize[cohortOf(s.stockId)]++;

  console.log(`════ FILING-PASS BACKFILL${DRY ? " (DRY — no writes)" : ""} ════`);
  console.log(`  universe: ${universe.length} active stocks`);
  console.log(`  cohorts : scored ${cohortSize.scored} · covered-unscored ${cohortSize.covered_unscored} · display-only ${cohortSize.display_only}`);
  console.log(`  as-of   : ${asOf.toISOString().slice(0, 10)}\n`);

  const byRule = new Map<string, RuleTally>();
  for (const e of FILING_REGISTRY) byRule.set(e.ruleRef, tally());

  const industryTotals = new Map<string, number>();
  const periodsSeen = { A: new Map<string, number>(), Q: new Map<string, number>(), S: new Map<string, number>() };
  let stocksDone = 0, rowsWritten = 0, failed = 0;
  const failures: string[] = [];
  const results: FilingPassResult[] = [];
  const t0 = Date.now();

  for (const s of universe) {
    inc(industryTotals, s.industry);
    const cohort = cohortOf(s.stockId);
    let res: FilingPassResult;
    try {
      res = await computeFilingPass(s, asOf);
      if (!DRY) res.written = await persistFilingPass(res);
    } catch (err) {
      failed++;
      failures.push(`${s.symbol}: ${(err as Error).message.slice(0, 120)}`);
      continue;
    }
    results.push(res);
    rowsWritten += res.written;
    stocksDone++;

    for (const g of ["A", "Q", "S"] as const) {
      const p = res.periods[g];
      if (p) inc(periodsSeen[g], p.periodKey);
    }
    for (const r of res.rows) {
      const t = byRule.get(r.ruleRef)!;
      t.evaluated++;
      inc(t.evaluatedByCohort, cohort);
      if (r.evaluationState === "fired") {
        t.fired++;
        inc(t.firedByIndustry, s.industry);
        inc(t.firedByCohort, cohort);
      } else if (r.evaluationState === "not_fired") t.notFired++;
      else { t.notEvaluable++; inc(t.reasons, r.notEvaluableReason ?? "(null)"); }
    }
    for (const sk of res.skippedNoPeriod) byRule.get(sk.ruleRef)!.noPeriod++;
    if (stocksDone % 100 === 0) console.log(`  … ${stocksDone}/${universe.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }

  console.log(`\n  processed ${stocksDone}/${universe.length} stocks in ${Math.round((Date.now() - t0) / 1000)}s · rows ${DRY ? "computed" : "written"}: ${DRY ? results.reduce((n, r) => n + r.rows.length, 0) : rowsWritten} · failures: ${failed}`);
  failures.slice(0, 10).forEach((f) => console.log(`     FAIL ${f}`));

  // ── PER-RULE CENSUS ────────────────────────────────────────────────────────────────────────────
  console.log(`\n──────── PER-RULE CENSUS (across ${stocksDone} stocks) ────────`);
  console.log(`${pad("RULE", 6)}${pad("KEY", 40)}${rpad("EVAL", 6)}${rpad("FIRED", 7)}${rpad("NOT_FIRED", 11)}${rpad("NOT_EVAL", 10)}${rpad("NO_PERIOD", 11)}`);
  for (const e of FILING_REGISTRY) {
    const t = byRule.get(e.ruleRef)!;
    console.log(`${pad(e.ruleRef, 6)}${pad(e.ruleKey, 40)}${rpad(t.evaluated, 6)}${rpad(t.fired, 7)}${rpad(t.notFired, 11)}${rpad(t.notEvaluable, 10)}${rpad(t.noPeriod, 11)}`);
  }

  console.log(`\n──────── NOT-EVALUABLE, BY REASON ────────`);
  for (const e of FILING_REGISTRY) {
    const t = byRule.get(e.ruleRef)!;
    if (!t.notEvaluable) continue;
    const parts = [...t.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, c]) => `${r} ×${c}`);
    console.log(`  ${pad(e.ruleRef, 5)} ${t.notEvaluable.toString().padStart(4)}   ${parts.join(" · ")}`);
  }

  // ── FIRED BY INDUSTRY ──────────────────────────────────────────────────────────────────────────
  const industries = [...industryTotals.keys()].sort();
  console.log(`\n──────── FIRED, BY INDUSTRY TYPE ────────`);
  console.log(`  universe: ${industries.map((i) => `${i} ${industryTotals.get(i)}`).join(" · ")}`);
  console.log(`${pad("RULE", 6)}${industries.map((i) => rpad(i.slice(0, 12), 14)).join("")}`);
  for (const e of FILING_REGISTRY) {
    const t = byRule.get(e.ruleRef)!;
    if (!t.fired) continue;
    console.log(`${pad(e.ruleRef, 6)}${industries.map((i) => rpad(t.firedByIndustry.get(i) ?? 0, 14)).join("")}`);
  }

  // ── FIRED BY COHORT ────────────────────────────────────────────────────────────────────────────
  // ⚠ NOT because the cohorts SHOULD differ — the filing pass does not know a stock's coverage state
  // and nothing in it branches on one. Reported because if they DO differ, something is gated that
  // should not be, and this is the table that would show it.
  const cohorts: Cohort[] = ["scored", "covered_unscored", "display_only"];
  console.log(`\n──────── FIRED, BY COVERAGE COHORT (rate per 100 evaluated) ────────`);
  console.log(`${pad("RULE", 6)}${cohorts.map((c) => rpad(`${c}(${cohortSize[c]})`, 24)).join("")}`);
  for (const e of FILING_REGISTRY) {
    const t = byRule.get(e.ruleRef)!;
    if (!t.fired) continue;
    const cells = cohorts.map((c) => {
      const f = t.firedByCohort.get(c) ?? 0;
      const ev = t.evaluatedByCohort.get(c) ?? 0;
      return rpad(ev ? `${f}/${ev} (${((f / ev) * 100).toFixed(1)}%)` : "—", 24);
    });
    console.log(`${pad(e.ruleRef, 6)}${cells.join("")}`);
  }

  // ── PERIODS THE ROWS LANDED ON ─────────────────────────────────────────────────────────────────
  console.log(`\n──────── PERIODS WRITTEN ────────`);
  for (const g of ["A", "Q", "S"] as const) {
    const top = [...periodsSeen[g].entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`  ${g}: ${top.map(([k, c]) => `${k} ×${c}`).join(" · ") || "(none)"}`);
  }

  // ── STOCKS WITH NO FILING AT A GRAIN ───────────────────────────────────────────────────────────
  const noGrain = { A: 0, Q: 0, S: 0 };
  for (const r of results) {
    if (!r.periods.A) noGrain.A++;
    if (!r.periods.Q) noGrain.Q++;
    if (!r.periods.S) noGrain.S++;
  }
  console.log(`\n──────── STOCKS WITH NO FILING AT A GRAIN (their rules write no row — see period.ts) ────────`);
  console.log(`  no annual accounts   : ${noGrain.A}`);
  console.log(`  no quarterly results : ${noGrain.Q}`);
  console.log(`  no shareholding      : ${noGrain.S}`);

  if (!DRY) {
    const total = await prisma.stockFinding.count();
    const byState = await prisma.stockFinding.groupBy({ by: ["evaluationState"], _count: { _all: true } });
    const byStanding = await prisma.stockFinding.groupBy({ by: ["standingState"], _count: { _all: true } });
    console.log(`\n──────── stock_findings TABLE ────────`);
    console.log(`  rows: ${total}`);
    console.log(`  evaluation_state: ${byState.map((r) => `${r.evaluationState} ${r._count._all}`).join(" · ")}`);
    console.log(`  standing_state  : ${byStanding.map((r) => `${r.standingState ?? "null"} ${r._count._all}`).join(" · ")}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
