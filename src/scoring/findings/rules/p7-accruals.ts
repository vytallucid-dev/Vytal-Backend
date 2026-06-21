// File: src/scoring/findings/rules/p7-accruals.ts
//
// P7 — Accruals Divergence (File 1 §5E · pattern · Red −8 · Foundation × Momentum).
// Concept: earnings not backed by operating cash — a single-period accruals gap.
//
// ⚠️ EXACT THRESHOLD NOT in File 1 — FLAG (provisional). Distinct-signal vs R3 (the
// single-signal/single-finding rule): R3 measures PERSISTENCE (≥4 consecutive years of
// NP>OCF, regardless of size); P7 measures MAGNITUDE (a large accruals gap in the LATEST
// year, regardless of persistence). A stock can fire one without the other — one big-gap
// year with no 4-year streak fires P7 not R3; four small-gap years fire R3 not P7. So P7 is
// NOT "R3 but softer" (it is not retired like P2/P3). Provisional trigger: latest year,
// NP>0 and OCF < P7_CASH_BACK_MAX × NP (operating cash backs < 70% of profit).
//
// GUARD-REUSE (the genuine kind): a single-year accruals gap is exactly where a one-off
// distorts — a non-cash exceptional GAIN inflates NP (b1), an exceptional LOSS deflates it
// (b2), a tax swing moves it (b3). P7 reads the GUARDED metric: it runs the engine's ACTUAL
// b1/b2/b3 on the latest annual period (annualExceptionalLatest) and SUPPRESSES when the NP
// is exceptional-driven. (This is the guard P11 couldn't have — P7 is annual, the grain fits.)

import { annualExceptionalLatest } from "../guards/annual-exceptional.js";
import type { FireRule } from "../types.js";

export const P7_CASH_BACK_MAX = 0.50; // OCF < 50% of NP — a SEVERE divergence (half of profit
// unbacked by operating cash) worthy of a Red −8. 0.70 fired on routine working-capital timing
// (15 names); 0.50 isolates the severe cases incl. negative-OCF. FLAG: provisional, not in File 1.

export const ruleP7: FireRule = (ctx) => {
  if (ctx.industry === "banking") return null;
  const f = ctx.annualFundamentals;
  if (f.length < 2) return null;
  const sorted = [...f].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
  const latest = sorted[sorted.length - 1];
  const np = latest.netProfit, ocf = latest.cashFromOperating;
  if (np === null || ocf === null || np <= 0) return null; // accruals divergence is a positive-earnings read

  const cashBack = ocf / np; // share of profit backed by operating cash
  if (cashBack >= P7_CASH_BACK_MAX) return null; // cash adequately backs profit → no divergence

  // GUARD: if the latest year's NP is distorted by a one-off, the accruals gap is an
  // artifact of that one-off, not genuine accruals quality → suppress.
  const guard = annualExceptionalLatest(sorted);
  if (guard.distorted) return null;

  const r0 = (x: number) => Math.round(x);
  return {
    kind: "pattern",
    key: "foundation_P7_accruals", // canonical key
    severity: "red", // §5E Red
    direction: "negative",
    magnitude: -8, // §5E −8
    displayState: "active",
    evidence: {
      pattern: "P7",
      name: "Accruals Divergence",
      latestPeriod: latest.fiscalYear,
      netProfit: r0(np),
      ocf: r0(ocf),
      cashBackPct: Math.round(cashBack * 100),
      accrualsGap: r0(np - ocf),
      guardClean: guard.fired.length ? `no NP-distorting exceptional (gate: ${guard.fired.join(",")})` : "no exceptional",
      provisional: true, // FLAG: threshold not locked by File 1
      verdict:
        ocf < 0
          ? `Accruals divergence — operating cash flow was NEGATIVE (−₹${r0(-ocf)} Cr) against ₹${r0(np)} Cr ` +
            `net profit in ${latest.fiscalYear}: earnings entirely unbacked by operating cash.`
          : `Accruals divergence — operating cash backed only ${Math.round(cashBack * 100)}% of ${latest.fiscalYear} ` +
            `net profit (₹${r0(np - ocf)} Cr of profit not converted to cash).`,
    },
    metricRefs: ["netProfit", "cashFromOperating"],
  };
};
