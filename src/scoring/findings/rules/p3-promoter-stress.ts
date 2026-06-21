// File: src/scoring/findings/rules/p3-promoter-stress.ts
//
// P3 — Promoter Stress Signal (File 1 §5E · pattern · Red −8 · pledging leg conditional).
//
// ⚠️ FLAG — File 1 gives NO exact P3 trigger (names + severity/data only). The ownership
// firewall (flow.ts) says "P3 → pledging (Primary)" — P3's scoring was consolidated into
// the pledging ladder, so there is no separate engine definition to reuse. PROVISIONAL
// trigger pending File-1 confirmation; it OVERLAPS R1 (Pledging Crisis) — R1 is the acute
// crisis (>50% pledged OR +10pp QoQ); P3 is the sub-crisis "stress" tier.
//
// Provisional definition: promoter pledging is materially elevated (≥ P3_PLEDGE_MATERIAL of
// promoter holding) OR rising (≥ P3_PLEDGE_RISE_PP QoQ), but BELOW R1's crisis thresholds.
//
// PLEDGING CONDITIONAL (§11.5.1, same as R1): the pledged-share count is suppressed where
// the column is absent — if pledgedShares is null, the pledging leg cannot be read → P3
// does not fire (never a false "no stress" from missing data; it simply can't evaluate).

import type { FireRule } from "../types.js";

export const P3_PLEDGE_MATERIAL = 0.20; // ≥20% of promoter holding pledged — FLAG: provisional
export const P3_PLEDGE_RISE_PP = 3;     // OR pledge ratio rose ≥3pp QoQ — FLAG: provisional
// R1 crisis thresholds (do NOT double-fire as P3 when R1's crisis is met).
const R1_PLEDGE_CRISIS = 0.50; // >50% pledged
const R1_QOQ_RISE_PP = 10;     // OR +10pp QoQ

/** Pledge ratio = pledgedShares / promoterShares, or null when either is missing/zero. */
function pledgeRatio(pledged: bigint | null, promoter: bigint | null): number | null {
  if (pledged === null || promoter === null || promoter <= 0n) return null;
  return Number(pledged) / Number(promoter);
}

export const ruleP3: FireRule = (ctx) => {
  const sh = ctx.shareholding;
  if (sh.length < 2) return null;
  const cur = sh[sh.length - 1], prior = sh[sh.length - 2];

  const ratioQ = pledgeRatio(cur.pledgedShares, cur.promoterShares);
  if (ratioQ === null) return null; // pledging column absent → conditional suppression (§11.5.1)
  const ratioQ1 = pledgeRatio(prior.pledgedShares, prior.promoterShares);
  const risePp = ratioQ1 === null ? null : (ratioQ - ratioQ1) * 100;

  // R1 crisis already owns the acute case — P3 is the sub-crisis stress tier.
  const r1Crisis = ratioQ > R1_PLEDGE_CRISIS || (risePp !== null && risePp > R1_QOQ_RISE_PP);
  if (r1Crisis) return null;

  const material = ratioQ >= P3_PLEDGE_MATERIAL;
  const rising = risePp !== null && risePp >= P3_PLEDGE_RISE_PP;
  if (!material && !rising) return null;

  const pct = (x: number) => Math.round(x * 10000) / 100; // ratio → % (2dp)
  return {
    kind: "pattern",
    key: "ownership_P3_promoter_stress", // canonical key
    severity: "red", // §5E Red
    direction: "negative",
    magnitude: -8, // §5E −8
    displayState: "active",
    evidence: {
      pattern: "P3",
      name: "Promoter Stress Signal",
      period: `${cur.fiscalYear}${cur.quarter}`,
      pledgePctOfPromoter: pct(ratioQ),
      pledgePctPrior: ratioQ1 === null ? null : pct(ratioQ1),
      pledgeRisePp: risePp === null ? null : Math.round(risePp * 100) / 100,
      trigger: material && rising ? "material+rising" : material ? "material" : "rising",
      provisional: true, // FLAG: trigger not locked by File 1; overlaps R1
      verdict:
        `Promoter stress — ${pct(ratioQ).toFixed(1)}% of promoter holding pledged` +
        (rising ? ` (up ${risePp!.toFixed(1)}pp QoQ)` : ``) +
        ` into ${cur.fiscalYear}${cur.quarter}, short of the R1 crisis line.`,
    },
    metricRefs: ["pledgedShares", "promoterShares"],
  };
};
