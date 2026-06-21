// File: src/scoring/findings/rules/p4-dual-exit.ts
//
// P4 — Dual Institutional Exit (File 1 §5E · pattern · Red −8).
// Exact trigger NOT in File 1's text — the engine defines it as the Ownership Flow B4 rule
// (flow.ts computeCategoryB): FII ↓ ≥0.5pp AND DII ↓ ≥0.5pp in the SAME quarter. Reuse it.
// (firewall comment in flow.ts: "P4 → B4 (dual exit, Flow)".)
//
// MAGNITUDE: the §5 pattern magnitude is File 1's Red −8. The Flow layer caps B4's
// pillar-score contribution to −6 (CAP_B) — that cap is a pillar-scoring concern, NOT the
// card's display magnitude. The card carries −8.

import { computeCategoryB } from "../../ownership/flow.js";
import type { FireRule } from "../types.js";

export const ruleP4: FireRule = (ctx) => {
  const rows = ctx.shareholding;
  if (rows.length < 2) return null;
  const b = computeCategoryB(rows, rows.length - 1);
  if (b.firedRule !== "B4") return null;

  const cur = rows[rows.length - 1];
  const ev = b.evidence as { fiiDelta?: number; diiDelta?: number };
  const r2 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 100) / 100);
  return {
    kind: "pattern",
    key: "ownership_P4_dual_exit", // canonical key
    severity: "red", // §5E Red
    direction: "negative",
    magnitude: -8, // §5E −8 (File 1 card magnitude; Flow caps the pillar contribution at −6)
    displayState: "active",
    evidence: {
      pattern: "P4",
      name: "Dual Institutional Exit",
      period: `${cur.fiscalYear}${cur.quarter}`,
      fiiDeltaPp: r2(ev.fiiDelta),
      diiDeltaPp: r2(ev.diiDelta),
      verdict:
        `Dual institutional exit — FII (${r2(ev.fiiDelta)?.toFixed(2)}pp) and DII (${r2(ev.diiDelta)?.toFixed(2)}pp) ` +
        `both cut in the same quarter (${cur.fiscalYear}${cur.quarter}).`,
    },
    metricRefs: ["fiiPct", "diiPct"],
  };
};
