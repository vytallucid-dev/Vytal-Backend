// File: src/scoring/findings/rules/n4-coverage-strengthening.ts
//
// N4 — Coverage Strengthening (Family N · CONSTRUCTIVE MIRROR of R5 Interest-Coverage
// Collapse). Amendment §5. Where R5 flags TTM interest coverage COLLAPSING below 1.5× for
// consecutive quarters (a critical red flag), N4 recognises the opposite standing condition:
// TTM coverage RISING from a thin base — a stretched balance sheet visibly healing.
//
// TTM IC = (ΣPBT + Σinterest) / Σinterest over the trailing 4 CONTIGUOUS quarters — the SAME
// metric R5 (and F5) compute. `quarters` counts the run from the quarterly data at fire time (§4).
//
// Trigger (Amendment §5): TTM coverage rising for ≥2 consecutive TTM windows, FROM A THIN BASE
// — trough TTM coverage < 3.0×.
//
// GATES: banking excluded (mirror of R5) · ≥6 contiguous quarters (3 TTM points) else
// not_evaluable{insufficient_quarters} · Σinterest > 0 in the assessed windows — a DEBT-FREE
// company has no coverage to strengthen → not_evaluable{no_debt}, NEVER a pass (a debt-free
// firm passing this would be nonsense, not a finding).
//
// THE LOW-BASE GATE (Amendment §5, load-bearing): without `trough < 3.0×`, a comfortable 40×
// drifting to 45× fires the pattern — arithmetic noise on an already-strong balance sheet, not
// a healing story. The gate isolates the genuine "thin coverage recovering" case.
//
// DISPLAY-ONLY: green · positive · magnitude null (explicit) · CONDITION.

import { isFinancialIndustry, notEvaluable, type FilingRule } from "../types.js";
import type { MomentumQuarter } from "../../metrics/types.js";
import { STOCK_FINDINGS } from "../../../catalogue/stock-findings.js";

// ★ THE BAR THIS RULE FIRES AT, READ FROM THE CATALOGUE — never a literal here. Same binding the
//   D/S/T rules already use (`const FACTS = ENTRY.facts`); see catalogue/finding-facts.ts for why the
//   35 unstudied findings now carry a record too. Relocation only: every value is what this file
//   declared before, and the evidence-parity gate re-derives all 504 stocks to prove it.
const FACTS = STOCK_FINDINGS.foundation_N4_coverage_strengthening.facts;

export const N4_MIN_RISES = FACTS.thresholds.minRises;      // ≥2 consecutive TTM rises
export const N4_LOW_BASE_MAX = FACTS.thresholds.lowBaseMax; // trough TTM coverage must be < 3.0× (thin base)

type TtmResult = { ok: true; ic: number } | { ok: false; reason: "insufficient" | "no_debt" };

/** TTM interest coverage ending at row index `i` (rows qOrdinal ASC). Distinguishes the two
 *  unevaluable causes N4 must tell apart: "insufficient" (fewer than 4 contiguous quarters, a
 *  gap, or a missing PBT/interest) vs "no_debt" (Σinterest ≤ 0 — no coverage to read). Pure. */
function ttmICat(rows: MomentumQuarter[], i: number): TtmResult {
  if (i < 3) return { ok: false, reason: "insufficient" };
  const win = rows.slice(i - 3, i + 1);
  if (win[3].qOrdinal - win[0].qOrdinal !== 3) return { ok: false, reason: "insufficient" }; // a quarter is missing
  let sumPbt = 0, sumInt = 0;
  for (const q of win) {
    if (q.profitBeforeTax === null || q.interest === null) return { ok: false, reason: "insufficient" };
    sumPbt += q.profitBeforeTax;
    sumInt += q.interest;
  }
  if (sumInt <= 0) return { ok: false, reason: "no_debt" }; // debt-free → coverage undefined
  return { ok: true, ic: (sumPbt + sumInt) / sumInt };
}

export const ruleN4: FilingRule = (ctx) => {
  if (isFinancialIndustry(ctx.industry)) return notEvaluable("industry_not_applicable"); // inherited exclusion (mirror of R5)
  const rows = [...ctx.quarterlyResults].sort((a, b) => a.qOrdinal - b.qOrdinal);
  const last = rows.length - 1;

  // GATE the minimum assessable window (the last MIN_RISES+1 TTM points). Insufficient/gap →
  // insufficient_quarters (checked first); debt-free → no_debt. Both are not_evaluable, never a pass.
  for (let k = 0; k <= N4_MIN_RISES; k++) {
    const res = ttmICat(rows, last - k);
    if (!res.ok && res.reason === "insufficient") return notEvaluable("insufficient_quarters");
    if (!res.ok && res.reason === "no_debt") return notEvaluable("no_debt");
  }

  // Build the full trailing strictly-rising TTM run (newest → oldest). A gap / debt-free window
  // beyond the min window caps the run; a non-rise ends it.
  const run: { period: string; ic: number }[] = [];
  for (let k = 0; ; k++) {
    if (last - k < 3) break;
    const res = ttmICat(rows, last - k);
    if (!res.ok) break;
    if (run.length > 0 && !(res.ic < run[run.length - 1].ic)) break; // older must be lower (strictly rising)
    const q = rows[last - k];
    run.push({ period: `${q.fiscalYear}${q.quarter}`, ic: res.ic });
  }

  const rises = run.length - 1;
  if (rises < N4_MIN_RISES) return null; // checked, false → not_fired

  const trough = run[run.length - 1].ic; // oldest = lowest in a strictly-rising run
  if (trough >= N4_LOW_BASE_MAX) return null; // already comfortable — not a healing finding → not_fired

  const r2 = (x: number) => Math.round(x * 100) / 100;
  const chron = [...run].reverse(); // oldest→newest
  return {
    kind: "pattern",
    key: "foundation_N4_coverage_strengthening",
    severity: "green",
    direction: "positive",
    polarity: "positive",
    temporalClass: "CONDITION",
    magnitude: null, // EXPLICIT
    displayState: "active",
    evidence: {
      family: "N",
      pattern: "N4",
      name: "Coverage Strengthening",
      quarters: rises,                     // REQUIRED KEY (§3) — consecutive TTM rises
      troughCoverage: r2(trough),          // REQUIRED KEY (§3) — the thin base it rose from
      latestCoverage: r2(chron[chron.length - 1].ic),
      fromPeriod: chron[0].period,
      toPeriod: chron[chron.length - 1].period,
      lowBaseMax: N4_LOW_BASE_MAX,
      minRises: N4_MIN_RISES,
      // decomposability (CN-6): the full TTM coverage ladder over the rising run
      series: chron.map((p) => ({ period: p.period, ttmIC: r2(p.ic) })),
      verdict:
        `Coverage strengthening — TTM interest coverage has risen for ${rises} straight quarters, ` +
        `up from a thin ${r2(trough)}× (${chron[0].period}) to ${r2(chron[chron.length - 1].ic)}× (${chron[chron.length - 1].period}).`,
    },
  };
};
