// File: src/scoring/findings/rules/r4-debt-explosion.ts
//
// R4 — Debt Explosion (File 1 §5A · severity Critical · red flag · non-financials only).
// Trigger (File 1): D/E exceeds 3× for the FIRST time in 5 years.
//
// D/E ratio computed from the balance sheet = (borrowingsCurrent + borrowingsNoncurrent) /
// netWorth — the authoritative source. (The stored `debtToEquity` column is PERCENT (×100):
// TATASTEEL 49.89 == ratio 0.50 — so a stored value is NOT the ratio; we compute the ratio.)
// "First time in 5yr": the LATEST annual D/E > 3.0 AND no year in the prior 5-year window
// breached 3.0 — fire ONCE on the first breach, not every subsequent quarter/year.
//
// NON-FINANCIALS ONLY: banking PGs are gated out (D/E is not a banking solvency metric).
// The findings hook passes empty annualFundamentals for banks, so this returns null there;
// the explicit industry guard documents the intent.

import type { FireRule } from "../types.js";
import type { FoundationAnnual } from "../../metrics/types.js";

export const R4_DE_THRESHOLD = 3.0; // 3× (ratio, not percent)
const R4_WINDOW_YEARS = 5;

/** D/E ratio from the balance sheet, or null when debt or net worth is unavailable. */
function deRatio(r: FoundationAnnual): number | null {
  const debt = (r.borrowingsCurrent ?? 0) + (r.borrowingsNoncurrent ?? 0);
  const nw = r.totalEquity ?? ((r.equityShareCapital ?? null) !== null && (r.otherEquity ?? null) !== null ? (r.equityShareCapital as number) + (r.otherEquity as number) : null);
  if (nw === null || nw <= 0) return null;
  return debt / nw;
}

export const ruleR4: FireRule = (ctx) => {
  if (ctx.industry === "banking") return null; // non-financials only (File 1)
  const f = ctx.annualFundamentals;
  if (f.length < 2) return null; // need history to assert "first time"

  // 5-year window ending at the latest annual row.
  const window = f.slice(-R4_WINDOW_YEARS);
  const latest = window[window.length - 1];
  const priors = window.slice(0, -1);

  const latestDe = deRatio(latest);
  if (latestDe === null || latestDe <= R4_DE_THRESHOLD) return null; // no current breach

  // FIRST time: no prior year in the window breached. A prior year with unknown D/E is
  // skipped (can't assert it breached); requires ≥1 known prior to claim "first time".
  const priorDes = priors.map((r) => ({ fy: r.fiscalYear, de: deRatio(r) }));
  const knownPriors = priorDes.filter((p) => p.de !== null);
  if (knownPriors.length === 0) return null; // no comparable history
  const anyPriorBreach = knownPriors.some((p) => (p.de as number) > R4_DE_THRESHOLD);
  if (anyPriorBreach) return null; // not the FIRST time — already breached before

  return {
    kind: "red_flag",
    key: "foundation_R4_debt_explosion", // canonical key (lib/finding-names.ts)
    severity: "critical", // File 1 §5A
    evidence: {
      rule: "R4",
      name: "Debt Explosion",
      latestPeriod: latest.fiscalYear,
      deRatioLatest: Math.round(latestDe * 100) / 100,
      threshold: R4_DE_THRESHOLD,
      deHistory: window.map((r) => ({ fy: r.fiscalYear, de: deRatio(r) === null ? null : Math.round((deRatio(r) as number) * 100) / 100 })),
      firstBreach: true,
      verdict:
        `Debt explosion — debt-to-equity reached ${latestDe.toFixed(2)}× in ${latest.fiscalYear}, ` +
        `crossing 3× for the first time in 5 years (prior peak ${Math.max(...knownPriors.map((p) => p.de as number)).toFixed(2)}×).`,
    },
    metricRefs: ["debtToEquity"],
  };
};
