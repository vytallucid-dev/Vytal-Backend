// File: src/scoring/findings/rules/p2-distribution-retail.ts
//
// P2 — Distribution to Retail (File 1 §5E · pattern · Red −8).
//
// ⚠️ FLAG — File 1 gives NO exact trigger for P2 (it names it + severity/data only). The
// ownership engine's firewall (flow.ts) further says "P2 → R6 (distribution, Primary)":
// the engine CONSOLIDATED P2's scoring into R6, so there is no separate engine definition
// to reuse. This is a PROVISIONAL trigger pending File-1 confirmation.
//
// Provisional definition (the "to retail" emphasis = retail absorbing institutional
// selling): combined institutional (FII+DII) ↓ ≥0.5pp AND retail ↑ ≥0.5pp in the same
// quarter. This deliberately does NOT require promoter↓ — that is what distinguishes it
// from R6 (the strict promoter↓ AND FII↓ AND retail↑ critical triple). NOTE: P2 and R6 can
// co-fire; whether to show both is a READ-LAYER dedup/ordering decision (File 1 ordering),
// NOT suppressed here.

import { B_MIN_MOVE_PP } from "../../ownership/flow.js";
import type { FireRule } from "../types.js";

export const P2_INST_DROP_PP = 0.5;   // combined FII+DII fell ≥ 0.5pp — FLAG: provisional
export const P2_RETAIL_RISE_PP = 0.5; // retail rose ≥ 0.5pp — FLAG: provisional

export const ruleP2: FireRule = (ctx) => {
  const sh = ctx.shareholding;
  if (sh.length < 2) return null;
  const cur = sh[sh.length - 1], prior = sh[sh.length - 2];
  const f = cur.fiiPct, f1 = prior.fiiPct, d = cur.diiPct, d1 = prior.diiPct, r = cur.retailPct, r1 = prior.retailPct;
  if ([f, f1, d, d1, r, r1].some((x) => x === null)) return null;

  const instDelta = (f! - f1!) + (d! - d1!); // combined institutional move
  const retailDelta = r! - r1!;
  if (instDelta > -P2_INST_DROP_PP) return null;       // institutions must distribute
  if (retailDelta < P2_RETAIL_RISE_PP) return null;    // retail must absorb
  if (Math.abs(instDelta) < B_MIN_MOVE_PP || Math.abs(retailDelta) < B_MIN_MOVE_PP) return null;

  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    kind: "pattern",
    key: "ownership_P2_distribution_retail", // canonical key
    severity: "red", // §5E Red
    direction: "negative",
    magnitude: -8, // §5E −8
    displayState: "active",
    evidence: {
      pattern: "P2",
      name: "Distribution to Retail",
      period: `${cur.fiscalYear}${cur.quarter}`,
      institutionalDeltaPp: r2(instDelta),
      fiiDeltaPp: r2(f! - f1!),
      diiDeltaPp: r2(d! - d1!),
      retailDeltaPp: r2(retailDelta),
      provisional: true, // FLAG: trigger not locked by File 1
      verdict:
        `Distribution to retail — institutions cut ${r2(-instDelta).toFixed(2)}pp while retail absorbed ` +
        `+${r2(retailDelta).toFixed(2)}pp into ${cur.fiscalYear}${cur.quarter}.`,
    },
    metricRefs: ["fiiPct", "diiPct", "retailPct"],
  };
};
