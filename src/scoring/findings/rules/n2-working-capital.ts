// File: src/scoring/findings/rules/n2-working-capital.ts
//
// N2 — Working-Capital Discipline (Family N · CONSTRUCTIVE MIRROR of P8 Capital Tied in
// Receivables). Amendment §5. Where P8 flags receivables growth OUTPACING revenue (working
// capital quietly absorbing cash), N2 recognises the opposite standing condition: revenue
// growth running AHEAD of receivables growth, sustained — the business is scaling without
// tying up proportionally more capital in receivables.
//
// Trigger (Amendment §5): revenue growth exceeds receivables growth by ≥15pp (SYMMETRIC with
// P8's 15pp — §2: do not loosen), sustained ≥2 CONSECUTIVE annual periods. `years` counts the
// run from the annual data at fire time (§4), never from the snapshot chain.
//
// GATES: banking excluded (mirror of P8) · ≥3 annual rows (two growth periods need three
// points) else not_evaluable{insufficient_annual_history} · receivables/revenue ≥ 0.05 in the
// BASE period — below that the receivables base is immaterial and its growth % is noise, so a
// tiny-base blip can't fire (mirrors P8's own MIN_RECV_TO_REV floor). Below the floor →
// not_fired: the data is present, the reading is just not material enough to assert.
//
// DISPLAY-ONLY: green · positive · magnitude null (explicit) · CONDITION.

import { notEvaluable, type FireRule } from "../types.js";
import type { FoundationAnnual } from "../../metrics/types.js";

export const N2_UNDERPACE_PP = 15;       // revenue growth − receivables growth ≥ 15pp (P8-symmetric)
export const N2_MIN_YEARS = 2;           // ≥2 consecutive annual (growth) periods
export const N2_MIN_RECV_TO_REV = 0.05;  // receivables ≥ 5% of revenue in the base period to be material

/** Trade receivables = current + non-current (null-safe). null only if BOTH are null. */
const recv = (r: FoundationAnnual): number | null => {
  const c = r.tradeReceivablesCurrent, nc = r.tradeReceivablesNoncurrent;
  if (c === null && nc === null) return null;
  return (c ?? 0) + (nc ?? 0);
};

/** Trailing run of consecutive annual growth periods (newest-anchored) in which revenue growth
 *  outpaces receivables growth by ≥ N2_UNDERPACE_PP. A gap, a non-positive base, or a missing
 *  input ends the run. Each entry is one YoY period (year i vs i−1). Pure. */
function trailingDisciplineRun(sortedAsc: FoundationAnnual[]) {
  const detail: { fy: string; baseFy: string; revGrowthPct: number; recvGrowthPct: number; gapPp: number; recvBase: number; revBase: number }[] = [];
  for (let i = sortedAsc.length - 1; i >= 1; i--) {
    const cur = sortedAsc[i], pri = sortedAsc[i - 1];
    if (cur.fyOrdinal - pri.fyOrdinal !== 1) break; // annual gap → run ends
    const revCur = cur.revenue, revPri = pri.revenue;
    const recvCur = recv(cur), recvPri = recv(pri);
    if (revCur === null || revPri === null || recvCur === null || recvPri === null) break;
    if (revPri <= 0 || recvPri <= 0) break; // need positive bases to read growth %
    const revGrowthPct = ((revCur - revPri) / revPri) * 100;
    const recvGrowthPct = ((recvCur - recvPri) / recvPri) * 100;
    const gapPp = revGrowthPct - recvGrowthPct;
    if (gapPp < N2_UNDERPACE_PP) break; // revenue not outpacing receivables by the bar → run ends
    detail.push({ fy: cur.fiscalYear, baseFy: pri.fiscalYear, revGrowthPct, recvGrowthPct, gapPp, recvBase: recvPri, revBase: revPri });
  }
  detail.reverse(); // oldest→newest
  return { years: detail.length, detail };
}

export const ruleN2: FireRule = (ctx) => {
  if (ctx.industry === "banking") return null; // inherited exclusion (mirror of P8)
  const f = ctx.annualFundamentals;
  if (f.length < N2_MIN_YEARS + 1) return notEvaluable("insufficient_annual_history"); // 2 periods need 3 rows

  const sorted = [...f].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
  const run = trailingDisciplineRun(sorted);
  if (run.years < N2_MIN_YEARS) return null; // checked, false → not_fired

  // BASE-period materiality: the oldest year in the run is the run's base. If receivables there
  // are immaterial (< 5% of revenue), the receivables-growth % is noise → do not assert.
  const base = run.detail[0];
  if (base.recvBase / base.revBase < N2_MIN_RECV_TO_REV) return null;

  const r1 = (x: number) => Math.round(x * 10) / 10;
  const last = run.detail[run.detail.length - 1];
  return {
    kind: "pattern",
    key: "foundation_N2_working_capital",
    severity: "green",
    direction: "positive",
    polarity: "positive",
    temporalClass: "CONDITION",
    magnitude: null, // EXPLICIT
    displayState: "active",
    evidence: {
      family: "N",
      pattern: "N2",
      name: "Working-Capital Discipline",
      years: run.years,               // REQUIRED KEY (§3)
      fromPeriod: base.fy,
      toPeriod: last.fy,
      basePeriod: base.baseFy,
      thresholdPp: N2_UNDERPACE_PP,
      minYears: N2_MIN_YEARS,
      baseReceivablesToRevenue: r1((base.recvBase / base.revBase) * 100),
      // decomposability (CN-6): the per-period revenue-vs-receivables gap that constitutes the run
      series: run.detail.map((d) => ({ fy: d.fy, revenueGrowthPct: r1(d.revGrowthPct), receivablesGrowthPct: r1(d.recvGrowthPct), outpacePp: r1(d.gapPp) })),
      verdict:
        `Working-capital discipline — revenue has grown at least ${N2_UNDERPACE_PP}pp faster than ` +
        `receivables for ${run.years} straight years (${base.fy}–${last.fy}); scaling without tying up more capital.`,
    },
    metricRefs: ["revenue", "tradeReceivablesCurrent"],
  };
};
