// File: src/scoring/findings/rules/n3-deleveraging.ts
//
// N3 — Deleveraging (Family N · CONSTRUCTIVE MIRROR of R4 Debt Explosion). Amendment §5.
// Where R4 fires the FIRST time D/E crosses 3× (a critical red flag), N3 recognises the
// opposite standing condition: debt-to-equity FALLING steadily over several years.
//
// Trigger (Amendment §5): D/E = (borrowingsCurrent + borrowingsNoncurrent) / netWorth falling
// in ≥3 CONSECUTIVE annual periods, AND total decline ≥0.5× ABSOLUTE OR ≥25% RELATIVE. D/E is
// the balance-sheet ratio (same source as R4 — the stored debtToEquity column is PERCENT and
// is NOT the ratio). `years` counts the run from the annual data at fire time (§4).
//
// GATES: banking excluded (mirror of R4 — D/E is not a banking solvency metric) · ≥4 annual
// rows (three declines need four points) else not_evaluable{insufficient_annual_history} · net
// worth > 0 in EVERY period of the assessed window — NEGATIVE EQUITY makes the ratio
// meaningless → not_evaluable{negative_equity}, NEVER a pass. The negative-equity check is
// not_evaluable (we could not compute a meaningful ratio), distinct from not_fired.
//
// R4 CO-EXISTENCE (Amendment §5 note): R4 is fire-once on the first breach and never clears, so
// a stock can carry a standing R4 (breached years ago) AND fire N3 (deleveraging since). That
// is NOT a contradiction — the two rules read different periods and neither suppresses the other.
//
// DISPLAY-ONLY: green · positive · magnitude null (explicit) · CONDITION.

import { isFinancialIndustry, notEvaluable, type FilingRule } from "../types.js";
import { netWorthFrom, type FoundationAnnual } from "../../metrics/types.js";

export const N3_MIN_YEARS = 3;        // ≥3 consecutive annual declines
export const N3_MIN_ABS_DECLINE = 0.5;  // total D/E fall ≥ 0.5× absolute …
export const N3_MIN_REL_DECLINE = 0.25; // … OR ≥ 25% relative

const debtOf = (r: FoundationAnnual): number => (r.borrowingsCurrent ?? 0) + (r.borrowingsNoncurrent ?? 0);

export const ruleN3: FilingRule = (ctx) => {
  if (isFinancialIndustry(ctx.industry)) return notEvaluable("industry_not_applicable"); // inherited exclusion (mirror of R4)
  const f = ctx.annualFundamentals;
  if (f.length < N3_MIN_YEARS + 1) return notEvaluable("insufficient_annual_history"); // 3 declines need 4 rows

  const sorted = [...f].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
  // Trailing contiguous-by-fiscal-year window (a gap breaks "consecutive").
  const win: FoundationAnnual[] = [sorted[sorted.length - 1]];
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (sorted[i + 1].fyOrdinal - sorted[i].fyOrdinal !== 1) break;
    win.unshift(sorted[i]);
  }
  if (win.length < N3_MIN_YEARS + 1) return null; // not enough contiguous points → not_fired

  // NEGATIVE-EQUITY GATE over the minimum assessable window (the last four contiguous periods).
  // A meaningless ratio anywhere in the window we must read → not_evaluable, never a pass.
  const minWin = win.slice(-(N3_MIN_YEARS + 1));
  for (const r of minWin) {
    const nw = netWorthFrom(r);
    if (nw !== null && nw <= 0) return notEvaluable("negative_equity");
  }

  // Build the trailing strictly-falling D/E run (newest → oldest). A missing/≤0 net worth or a
  // non-fall ends the run; the min-window gate above already owns the negative-equity outcome.
  const run: { fy: string; de: number }[] = [];
  for (let i = win.length - 1; i >= 0; i--) {
    const nw = netWorthFrom(win[i]);
    if (nw === null || nw <= 0) break;
    const de = debtOf(win[i]) / nw;
    if (run.length > 0 && !(de > run[run.length - 1].de)) break; // older must exceed newer (strictly falling)
    run.push({ fy: win[i].fiscalYear, de });
  }

  const declines = run.length - 1;
  if (declines < N3_MIN_YEARS) return null; // checked, false → not_fired

  const deTo = run[0].de;                    // latest (newest)
  const deFrom = run[run.length - 1].de;     // oldest in the run
  const absDecline = deFrom - deTo;
  const relDecline = deFrom > 0 ? absDecline / deFrom : 0;
  if (absDecline < N3_MIN_ABS_DECLINE && relDecline < N3_MIN_REL_DECLINE) return null; // fall too small → not_fired

  const r2 = (x: number) => Math.round(x * 100) / 100;
  const chron = [...run].reverse(); // oldest→newest
  return {
    kind: "pattern",
    key: "foundation_N3_deleveraging",
    severity: "green",
    direction: "positive",
    polarity: "positive",
    temporalClass: "CONDITION",
    magnitude: null, // EXPLICIT
    displayState: "active",
    evidence: {
      family: "N",
      pattern: "N3",
      name: "Deleveraging",
      years: declines,               // REQUIRED KEY (§3) — number of consecutive annual declines
      deFrom: r2(deFrom),            // REQUIRED KEY (§3) — D/E at the start of the run
      deTo: r2(deTo),                // REQUIRED KEY (§3) — D/E at the latest period
      fromPeriod: chron[0].fy,
      toPeriod: chron[chron.length - 1].fy,
      absDecline: r2(absDecline),
      relDeclinePct: Math.round(relDecline * 100),
      minAbsDecline: N3_MIN_ABS_DECLINE,
      minRelDecline: N3_MIN_REL_DECLINE,
      // decomposability (CN-6): the full D/E ladder over the falling run
      series: chron.map((p) => ({ fy: p.fy, de: r2(p.de) })),
      verdict:
        `Deleveraging — debt-to-equity has fallen for ${declines} straight years, from ${r2(deFrom)}× ` +
        `(${chron[0].fy}) to ${r2(deTo)}× (${chron[chron.length - 1].fy}).`,
    },
    metricRefs: ["debtToEquity"],
  };
};
