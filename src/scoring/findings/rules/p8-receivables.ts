// File: src/scoring/findings/rules/p8-receivables.ts
//
// P8 — Capital Tied in Receivables (File 1 §5E · pattern · Amber −3).
// Concept (File 1 §5E): receivables growth running ahead of revenue — working capital
// quietly absorbing cash. Balance-sheet, robust (no NP/margin distortion risk).
//
// EXACT THRESHOLD NOT in File 1 — FLAG. Provisional trigger: latest-FY trade receivables
// grew ≥ RECV_OUTPACE_PP faster (YoY) than revenue, receivables actually grew, and the
// receivables base is material (≥ MIN_RECV_TO_REV of revenue, so a tiny-base % blip can't
// fire). Annual data; non-financials (banks carry empty annualFundamentals).

import type { FireRule } from "../types.js";
import type { FoundationAnnual } from "../../metrics/types.js";

export const RECV_OUTPACE_PP = 15; // receivables YoY growth − revenue YoY growth ≥ 15pp — FLAG: confirm with File 1
export const MIN_RECV_GROWTH_PCT = 10; // receivables must ACTUALLY build ≥10% YoY — rejects the
// "revenue crashed, receivables flat" false-positive (e.g. ZYDUSLIFE rec +4% / rev −24%): that is a
// revenue story, not capital tied in receivables. FLAG: provisional.
export const MIN_RECV_TO_REV = 0.05; // receivables ≥ 5% of revenue to be material

const recv = (r: FoundationAnnual): number | null => {
  const c = r.tradeReceivablesCurrent, nc = r.tradeReceivablesNoncurrent;
  if (c === null && nc === null) return null;
  return (c ?? 0) + (nc ?? 0);
};

export const ruleP8: FireRule = (ctx) => {
  if (ctx.industry === "banking") return null;
  const f = ctx.annualFundamentals;
  if (f.length < 2) return null;
  const latest = f[f.length - 1], prior = f[f.length - 2];

  const recCur = recv(latest), recPri = recv(prior);
  const revCur = latest.revenue, revPri = prior.revenue;
  if (recCur === null || recPri === null || revCur === null || revPri === null) return null;
  if (recPri <= 0 || revPri <= 0 || revCur <= 0) return null;

  const recGrowthPct = ((recCur - recPri) / recPri) * 100;
  const revGrowthPct = ((revCur - revPri) / revPri) * 100;
  const gapPp = recGrowthPct - revGrowthPct;
  const recToRev = recCur / revCur;

  if (recGrowthPct < MIN_RECV_GROWTH_PCT) return null; // receivables must genuinely build (not a revenue crash)
  if (recToRev < MIN_RECV_TO_REV) return null;         // material base only
  if (gapPp < RECV_OUTPACE_PP) return null;             // receivables outpacing revenue by the bar

  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    kind: "pattern",
    key: "foundation_P8_receivables", // canonical key
    severity: "amber", // §5E Amber
    direction: "negative",
    magnitude: -3, // §5E −3
    displayState: "active",
    evidence: {
      pattern: "P8",
      name: "Capital Tied in Receivables",
      latestPeriod: latest.fiscalYear,
      receivablesGrowthPct: r1(recGrowthPct),
      revenueGrowthPct: r1(revGrowthPct),
      outpacePp: r1(gapPp),
      receivablesToRevenue: r1(recToRev * 100),
      thresholdPp: RECV_OUTPACE_PP,
      verdict:
        `Capital tied in receivables — receivables grew ${r1(recGrowthPct)}% in ${latest.fiscalYear} ` +
        `while revenue ${revGrowthPct >= 0 ? "grew" : "fell"} ${r1(Math.abs(revGrowthPct))}% (a ${r1(gapPp)}pp gap).`,
    },
    metricRefs: ["tradeReceivablesCurrent", "revenue"],
  };
};
