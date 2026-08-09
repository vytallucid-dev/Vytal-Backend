// File: src/scoring/findings/rules/n6-promoter-accumulation.ts
//
// N6 — Promoter Accumulation (Family N · CONSTRUCTIVE MIRROR of R2 Promoter Exit). Amendment
// §5. Where R2 fires on a >5pp promoter sell-down (a critical red flag, ex-dilution), N6
// recognises the opposite standing condition: the promoter STEADILY BUYING — absolute share
// count rising over consecutive quarters with a meaningful cumulative stake increase.
//
// Trigger (Amendment §5): promoter ABSOLUTE share count rising for ≥2 consecutive quarters,
// with cumulative promoter-percentage rise ≥1.0pp. `quarters` counts the run from the
// shareholding data at fire time (§4).
//
// ┌──────────────────────────────────────────────────────────────────────────────────────┐
// │ ⚠️ THE BUYBACK FIREWALL — the one place a naive mirror produces a FALSE finding, not a  │
// │ missing one (Amendment §5, MANDATORY). Promoter PERCENTAGE can rise purely because the │
// │ company shrank its total share count (a buyback) while promoters bought NOTHING. So    │
// │ N6's trigger reads ABSOLUTE SHARE COUNT, never percentage. If the share count is       │
// │ unavailable, we return not_evaluable{share_count_unavailable} — it must NOT fall back   │
// │ to percentage. A percentage-based N6 would report buybacks as insider buying. This is   │
// │ the mirror of R2's dilution firewall (count-based, ex-issuance). The cumulative-% gate  │
// │ below is only a MATERIALITY filter on top of the count rise — it never DETECTS the rise.│
// └──────────────────────────────────────────────────────────────────────────────────────┘
//
// GATES: ≥3 shareholding rows (two consecutive rises need three points) else
// not_evaluable{insufficient_shareholding_history} · share count present in the assessed window
// else not_evaluable{share_count_unavailable}.
//
// DISPLAY-ONLY: green · positive · magnitude null (explicit) · CONDITION.

import { isPriorQuarterGap } from "../../ownership/dilution.js";
import { notEvaluable, type FilingRule } from "../types.js";

export const N6_MIN_QUARTERS = 2;      // ≥2 consecutive quarters of rising count
export const N6_MIN_CUMULATIVE_PP = 1.0; // cumulative promoter-% rise ≥ 1.0pp (materiality)

export const ruleN6: FilingRule = (ctx) => {
  const rows = ctx.shareholding;
  if (rows.length < N6_MIN_QUARTERS + 1) return notEvaluable("insufficient_shareholding_history");

  // BUYBACK FIREWALL: the count must be present across the minimum assessable window. A null
  // count → not_evaluable{share_count_unavailable}; we NEVER substitute promoter %.
  const minWin = rows.slice(-(N6_MIN_QUARTERS + 1));
  if (minWin.some((r) => r.promoterShares === null)) return notEvaluable("share_count_unavailable");

  // Trailing run of consecutive quarters with STRICTLY rising absolute promoter share COUNT
  // (newest → oldest). A calendar gap, a null count, or a non-rise ends the run.
  const run = [rows[rows.length - 1]];
  for (let i = rows.length - 2; i >= 0; i--) {
    const newer = run[run.length - 1], older = rows[i];
    if (isPriorQuarterGap(newer.asOnDate, older.asOnDate)) break; // not consecutive
    if (older.promoterShares === null) break;                     // count gone → cap the run
    if (!(newer.promoterShares! > older.promoterShares)) break;   // count did not rise → run ends
    run.push(older);
  }

  const quarters = run.length - 1; // number of consecutive rises
  if (quarters < N6_MIN_QUARTERS) return null; // checked, false (incl. the buyback case: % rose, count flat)

  const latest = run[0], oldest = run[run.length - 1];
  // Cumulative %-rise MATERIALITY gate (count already proved the rise; % must be present to CONFIRM).
  if (latest.promoterPct === null || oldest.promoterPct === null) return null; // can't confirm the magnitude
  const cumulativePp = latest.promoterPct - oldest.promoterPct;
  if (cumulativePp < N6_MIN_CUMULATIVE_PP) return null; // rise not material enough → not_fired

  const r2 = (x: number) => Math.round(x * 100) / 100;
  const chron = [...run].reverse(); // oldest→newest
  return {
    kind: "pattern",
    key: "ownership_N6_promoter_accumulation",
    severity: "green",
    direction: "positive",
    polarity: "positive",
    temporalClass: "CONDITION",
    magnitude: null, // EXPLICIT
    displayState: "active",
    evidence: {
      family: "N",
      pattern: "N6",
      name: "Promoter Accumulation",
      quarters,                        // REQUIRED KEY (§3) — consecutive quarters of rising count
      cumulativePp: r2(cumulativePp),  // REQUIRED KEY (§3) — total promoter-% rise across the run
      fromPeriod: `${oldest.fiscalYear}${oldest.quarter}`,
      toPeriod: `${latest.fiscalYear}${latest.quarter}`,
      promoterPctFrom: r2(oldest.promoterPct),
      promoterPctTo: r2(latest.promoterPct),
      minCumulativePp: N6_MIN_CUMULATIVE_PP,
      basedOn: "absolute_share_count", // firewall: the rise is count-derived, never %-derived
      // decomposability (CN-6): the promoter share-count ladder (count-based, per the firewall)
      series: chron.map((q) => ({
        period: `${q.fiscalYear}${q.quarter}`,
        promoterShares: Number(q.promoterShares),
        promoterPct: q.promoterPct === null ? null : r2(q.promoterPct),
      })),
      verdict:
        `Promoter accumulation — the promoter's absolute shareholding rose for ${quarters} straight ` +
        `quarters, lifting the stake ${r2(cumulativePp).toFixed(2)}pp (${r2(oldest.promoterPct)}% → ${r2(latest.promoterPct)}%).`,
    },
    metricRefs: ["promoterShares", "promoterPct"],
  };
};
