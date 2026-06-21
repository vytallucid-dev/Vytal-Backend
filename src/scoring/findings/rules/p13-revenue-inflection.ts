// File: src/scoring/findings/rules/p13-revenue-inflection.ts
//
// P13 — TTM Revenue Inflection (File 1 §5E · pattern · Red/Green ±5 · Momentum). Locked
// verbatim copy (File 1):
//   "Revenue growth [accelerated / decelerated] from [prior TTM growth]% to [latest TTM growth]%."
//
// TTM revenue = rolling 4-quarter sum. TTM-YoY growth at quarter q = TTM(q) / TTM(q−4) − 1.
// "Inflection" compares the LATEST TTM-YoY growth to the PRIOR quarter's TTM-YoY growth →
// requires TTM(q), TTM(q−4), TTM(q−1), TTM(q−5) = NINE contiguous quarters of revenue.
//
// GUARD READ: revenue is far less one-off-prone than margin (a one-time sale is rarer than a
// one-time charge), and TTM is a rolling SUM that smooths a single-quarter spike — so P13 is
// largely self-guarding on the smoothing alone (no exceptional-item guard added). FLAG: a
// genuinely large one-time revenue event spanning the window could still distort; no
// quarterly exceptional-revenue line exists to detect it (acceptable, flagged).
//
// ⚠️ DATA-DEPTH FLAG: 9 contiguous standalone quarters are required; the ingested quarterly
// history is currently ~5–6 quarters, so P13 will be QUIET until deeper history lands. It is
// implemented faithfully and returns null on insufficient depth (a needs-data outcome, not
// a silent gap).

import type { FireRule, FiringContext } from "../types.js";
import type { MomentumQuarter } from "../../metrics/types.js";

export const P13_INFLECTION_PP = 5; // |Δ TTM growth| ≥ 5pp to be a material inflection — FLAG: provisional

/** TTM revenue (sum of 4 contiguous quarters) ending at row index i; null if a quarter is
 *  missing or revenue absent. */
function ttmRevenue(rows: MomentumQuarter[], i: number): number | null {
  if (i < 3) return null;
  const win = rows.slice(i - 3, i + 1);
  if (win[3].qOrdinal - win[0].qOrdinal !== 3) return null;
  let sum = 0;
  for (const q of win) { if (q.revenue === null) return null; sum += q.revenue; }
  return sum;
}

/** TTM-YoY growth at index i = TTM(i)/TTM(i−4) − 1 (×100); needs 8 contiguous quarters. */
function ttmYoyGrowth(rows: MomentumQuarter[], i: number): number | null {
  const cur = ttmRevenue(rows, i), base = ttmRevenue(rows, i - 4);
  if (cur === null || base === null || base <= 0) return null;
  if (i < 4 || rows[i].qOrdinal - rows[i - 4].qOrdinal !== 4) return null; // contiguous YoY
  return (cur / base - 1) * 100;
}

export const ruleP13: FireRule = (ctx: FiringContext) => {
  if (ctx.industry === "banking") return null;
  const rows = [...ctx.quarterlyResults].sort((a, b) => a.qOrdinal - b.qOrdinal);
  const last = rows.length - 1;
  const latestG = ttmYoyGrowth(rows, last);
  const priorG = ttmYoyGrowth(rows, last - 1);
  if (latestG === null || priorG === null) return null; // insufficient depth (needs ~9 quarters)

  const delta = latestG - priorG;
  if (Math.abs(delta) < P13_INFLECTION_PP) return null; // no material inflection
  const accelerated = delta > 0;

  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    kind: "pattern",
    key: "momentum_P13_revenue_inflection", // canonical key
    severity: accelerated ? "green" : "red", // §5E Red/Green
    direction: accelerated ? "positive" : "negative",
    magnitude: accelerated ? 5 : -5, // §5E ±5
    displayState: "active",
    evidence: {
      pattern: "P13",
      name: "TTM Revenue Inflection",
      latestPeriod: `${rows[last].fiscalYear}${rows[last].quarter}`,
      priorTtmGrowthPct: r1(priorG),
      latestTtmGrowthPct: r1(latestG),
      deltaPp: r1(delta),
      // File 1's locked copy, realized.
      verbatim: `Revenue growth ${accelerated ? "accelerated" : "decelerated"} from ${r1(priorG)}% to ${r1(latestG)}%.`,
    },
    metricRefs: ["revenue"],
  };
};
