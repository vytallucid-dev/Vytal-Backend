// File: src/scoring/findings/rules/r2-promoter-exit.ts
//
// R2 — Promoter Exit (File 1 §5A · severity Critical · red flag).
// Trigger (File 1): promoter holding drops >5pp in one quarter, EX-QIP/rights/fresh-issue.
//
// EX-DILUTION (the one subtlety) — reuse the engine's count-based detector, NOT
// CorporateEvent. computeR2 (ownership/disturbances.ts) gates on classifyDilution, which
// identifies a QIP / rights / preferential / fresh-issue STRUCTURALLY: promoter share
// COUNT stable + total shares ROSE ⇒ mechanical issuance, not a sell-down ⇒ R2 does NOT
// fire. This is strictly more robust than CorporateEvent.eventType matching, because
// CorporateEvent enumerates only "rights" (no QIP / preferential / fresh-issue) — so it
// would MISS most dilution events. R2 fires only on verdict genuine_reduction (promoter
// count actually fell) or indeterminate (unexplained >5pp drop — fail-safe). Same reuse
// pattern as R6 ← computeR6.

import { computeR2, R2_DROP_PP } from "../../ownership/disturbances.js";
import type { FireRule } from "../types.js";

export const ruleR2: FireRule = (ctx) => {
  const sh = ctx.shareholding;
  if (sh.length < 2) return null;
  const current = sh[sh.length - 1];
  const prior = sh[sh.length - 2];
  const r2 = computeR2(current, prior);
  if (!r2.fired) return null; // includes the dilution-suppressed case (ex-QIP/rights)

  const curPk = `${current.fiscalYear}${current.quarter}`;
  const priorPk = `${prior.fiscalYear}${prior.quarter}`;
  return {
    kind: "red_flag",
    key: "ownership_R2_promoter_exit", // canonical key (lib/finding-names.ts)
    severity: "critical", // File 1 §5A
    evidence: {
      rule: "R2",
      name: "Promoter Exit",
      currentPeriod: curPk,
      priorPeriod: priorPk,
      promoterPctDropPp: r2.pctDrop === null ? null : Math.round(r2.pctDrop * 100) / 100,
      thresholdPp: R2_DROP_PP,
      dilutionVerdict: r2.gatingVerdict, // genuine_reduction | indeterminate (NOT dilution — ex-QIP/rights)
      spansQuarterGap: r2.spansGap,
      verdict:
        `Promoter exit — promoter holding fell ${r2.pctDrop?.toFixed(2)}pp into ${curPk} ` +
        `(> ${R2_DROP_PP}pp), a genuine sell-down (not a QIP/rights dilution: ${r2.gatingVerdict}).`,
    },
    metricRefs: ["promoterShares", "promoterPct"],
  };
};
