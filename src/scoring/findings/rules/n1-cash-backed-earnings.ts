// File: src/scoring/findings/rules/n1-cash-backed-earnings.ts
//
// N1 — Cash-Backed Earnings (Family N · CONSTRUCTIVE MIRROR of P7 Accruals Divergence).
// Amendment §5. Where P7 flags a single-period accruals GAP (earnings not backed by cash),
// N1 recognises the opposite standing condition: operating cash has FULLY backed profit for
// several consecutive years — durable earnings quality.
//
// Trigger (Amendment §5): OCF / netProfit ≥ 1.0 for ≥3 CONSECUTIVE annual periods, netProfit
// > 0 in each. This is a run about the COMPANY (§4) — `years` counts the run length from the
// annual data at fire time, NOT from standing_since / the snapshot chain.
//
// GATES: banking excluded (inherited from P7's exclusion — annual non-financial read) · ≥3
// annual rows else not_evaluable{insufficient_annual_history} · annual-exceptional guard clear
// — the SAME guard P7 uses (annualExceptionalLatest): a one-off gain/loss/tax swing distorts
// the latest NP, making the cash-backing reading an artifact → SUPPRESS (not_fired, mirroring
// P7's null there). A distorted period is not "unevaluable" — the data is present and we CAN
// compute it; the guard rules the positive claim unsafe, which is a not_fired.
//
// DISPLAY-ONLY (Amendment §1/§2): severity green · direction/polarity positive · magnitude
// null (set EXPLICITLY) · temporalClass CONDITION. Fires after composite assembly like every
// finding; moves no score.

import { annualExceptionalLatest } from "../guards/annual-exceptional.js";
import { isFinancialIndustry, notEvaluable, type FilingRule } from "../types.js";
import type { FoundationAnnual } from "../../metrics/types.js";

export const N1_MIN_YEARS = 3;      // ≥3 consecutive annual periods
export const N1_OCF_NP_MIN = 1.0;   // operating cash ≥ 100% of profit each year

/** Length + detail of the trailing run of consecutive annual periods (newest-anchored) in
 *  which netProfit > 0 AND OCF/NP ≥ 1.0. A missing input, a non-positive NP, a sub-1.0 ratio,
 *  or a fiscal-year GAP ends the run. Pure. */
function trailingCashBackedRun(sortedAsc: FoundationAnnual[]) {
  const detail: { fy: string; ocf: number; np: number; ratio: number }[] = [];
  for (let i = sortedAsc.length - 1; i >= 0; i--) {
    const r = sortedAsc[i];
    const np = r.netProfit, ocf = r.cashFromOperating;
    if (np === null || ocf === null || np <= 0) break;       // cash-backing is a positive-earnings read
    if (ocf / np < N1_OCF_NP_MIN) break;                     // not cash-backed this year → run ends
    if (detail.length > 0 && sortedAsc[i + 1].fyOrdinal - r.fyOrdinal !== 1) break; // annual gap → run ends
    detail.push({ fy: r.fiscalYear, ocf, np, ratio: ocf / np });
  }
  detail.reverse(); // oldest→newest
  return { years: detail.length, detail };
}

export const ruleN1: FilingRule = (ctx) => {
  if (isFinancialIndustry(ctx.industry)) return notEvaluable("industry_not_applicable"); // inherited exclusion (mirror of P7)
  const f = ctx.annualFundamentals;
  if (f.length < N1_MIN_YEARS) return notEvaluable("insufficient_annual_history");

  const sorted = [...f].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
  const run = trailingCashBackedRun(sorted);
  if (run.years < N1_MIN_YEARS) return null; // checked, false → not_fired

  // GUARD (same as P7): a one-off distorting the latest NP makes the cash-backing reading an
  // artifact → suppress the positive claim (not_fired), never assert on distorted data.
  const guard = annualExceptionalLatest(sorted);
  if (guard.distorted) return null;

  const r2 = (x: number) => Math.round(x * 100) / 100;
  const first = run.detail[0], last = run.detail[run.detail.length - 1];
  return {
    kind: "pattern",
    key: "foundation_N1_cash_backed_earnings",
    severity: "green",
    direction: "positive",
    polarity: "positive",
    temporalClass: "CONDITION",
    magnitude: null, // EXPLICIT — Family N carries no §5E magnitude (display-only)
    displayState: "active",
    evidence: {
      family: "N",
      pattern: "N1",
      name: "Cash-Backed Earnings",
      years: run.years,                 // REQUIRED KEY (§3) — the run length {n} reads
      fromPeriod: first.fy,
      toPeriod: last.fy,
      minYears: N1_MIN_YEARS,
      ocfNpMin: N1_OCF_NP_MIN,
      // decomposability (CN-6): the per-year cash-backing ratios that constitute the run
      series: run.detail.map((d) => ({ fy: d.fy, ocf: Math.round(d.ocf), netProfit: Math.round(d.np), ocfToNp: r2(d.ratio) })),
      guardClean: guard.fired.length ? `no NP-distorting exceptional (gate: ${guard.fired.join(",")})` : "no exceptional",
      // ★ REGISTER (amendment §4.2). This sentence read "…earnings converting RELIABLY to cash" —
      // "reliably" is on the §4.2 prohibited list ("if it would read as a reason to buy when lifted
      // out of context, rewrite it") and it survived every copy review because it lived HERE, in an
      // evidence payload, rather than in an authored copy module where the rules were being applied.
      // The tail is now the authored description's own clause, so this states the same fact in the
      // register the spec requires. verify-evidence-register.ts scans every rule for the whole list.
      verdict:
        `Cash-backed earnings — operating cash flow has fully covered net profit for ${run.years} ` +
        `straight years (${first.fy}–${last.fy}); earnings converting to cash rather than accumulating as accruals.`,
    },
    metricRefs: ["cashFromOperating", "netProfit"],
  };
};
