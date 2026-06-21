// File: src/scoring/findings/rules/r3-earnings-quality.ts
//
// R3 — Earnings Quality Breakdown (File 1 §5A · severity Critical · red flag).
// Trigger (File 1): ≥4 consecutive periods (annual or TTM) where Net Profit > OCF, ending
// most recent. There is NO quarterly OCF column (cash flow is annual-only), so "TTM" is
// not derivable — R3 reads the ANNUAL Net Profit vs Operating Cash Flow series.
//
// SELF-GUARDING (the guard read): R3 needs FOUR CONSECUTIVE years of NP>OCF. A one-off
// (a non-cash gain inflating NP, or a working-capital swing depressing OCF) distorts ONE
// year, not four consecutive — the consecutiveness IS the structural guard, so R3 does not
// need an exceptional-item guard (per the §12 "don't over-engineer where structure guards"
// discipline). Residual edge: a one-off could extend a streak from 3→4; the other 3 years
// must still be genuine NP>OCF, so the flag can't be created by a one-off alone. (FLAGGED.)
//
// ⚠️ DATA-DEPTH FLAG: needs ≥4 CONSECUTIVE annual years. The ingested standalone annual
// history is currently ~2–3 years (often gapped — e.g. FY21 then FY25/FY26), so R3 is QUIET
// universe-wide until deeper annual history lands. Implemented faithfully (returns null on
// insufficient depth) — a needs-data outcome, not a silent gap.

import type { FireRule } from "../types.js";

export const R3_MIN_CONSECUTIVE = 4;

export const ruleR3: FireRule = (ctx) => {
  if (ctx.industry === "banking") return null; // cash-flow earnings-quality is a non-financial read
  const f = ctx.annualFundamentals;
  if (f.length < R3_MIN_CONSECUTIVE) return null;
  const sorted = [...f].sort((a, b) => a.fyOrdinal - b.fyOrdinal);

  // Trailing run of consecutive years with NP > OCF, ending at the latest year.
  const run: { fy: string; np: number; ocf: number }[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const r = sorted[i];
    if (r.netProfit === null || r.cashFromOperating === null) break; // a missing year breaks "consecutive"
    if (r.netProfit > r.cashFromOperating) run.unshift({ fy: r.fiscalYear, np: r.netProfit, ocf: r.cashFromOperating });
    else break;
  }
  if (run.length < R3_MIN_CONSECUTIVE) return null;

  const r0 = (x: number) => Math.round(x);
  return {
    kind: "red_flag",
    key: "foundation_R3_earnings_quality", // canonical key
    severity: "critical", // File 1 §5A
    evidence: {
      rule: "R3",
      name: "Earnings Quality Breakdown",
      consecutiveYears: run.length,
      latestPeriod: run[run.length - 1].fy,
      series: run.map((y) => ({ fy: y.fy, netProfit: r0(y.np), ocf: r0(y.ocf), gap: r0(y.np - y.ocf) })),
      verdict:
        `Earnings quality breakdown — net profit has exceeded operating cash flow for ` +
        `${run.length} straight years (${run[0].fy}–${run[run.length - 1].fy}).`,
    },
    metricRefs: ["netProfit", "cashFromOperating"],
  };
};
