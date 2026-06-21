// File: src/scoring/findings/rules/p1-clean-rotation.ts
//
// P1 — Clean Institutional Rotation (File 1 §5E · pattern · Green +5).
// Exact trigger NOT in File 1's text — but the engine ALREADY defines it as the Ownership
// Flow B1 rule (flow.ts computeCategoryB): DII ↑ ≥1.0pp AND FII ↓ (within [0.05, 0.5]pp)
// AND |promoterΔ| ≤ 0.5pp → +5. Reuse it (same pattern as R2←computeR2 / R6←computeR6) so
// the §5 card and the ownership-pillar Flow score never disagree on whether B1 fired.

import { computeCategoryB } from "../../ownership/flow.js";
import type { FireRule } from "../types.js";

export const ruleP1: FireRule = (ctx) => {
  const rows = ctx.shareholding;
  if (rows.length < 2) return null;
  const b = computeCategoryB(rows, rows.length - 1);
  if (!b.firedRule || !b.firedRule.includes("B1")) return null;

  const cur = rows[rows.length - 1];
  const ev = b.evidence as { fiiDelta?: number; diiDelta?: number; promoterDelta?: number | null };
  const r2 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 100) / 100);
  return {
    kind: "pattern",
    key: "ownership_P1_clean_rotation", // canonical key
    severity: "green", // §5E Green
    direction: "positive",
    magnitude: 5, // §5E +5
    displayState: "active",
    evidence: {
      pattern: "P1",
      name: "Clean Institutional Rotation",
      period: `${cur.fiscalYear}${cur.quarter}`,
      fiiDeltaPp: r2(ev.fiiDelta),
      diiDeltaPp: r2(ev.diiDelta),
      promoterDeltaPp: r2(ev.promoterDelta),
      firedRule: b.firedRule,
      verdict:
        `Clean institutional rotation — DII added (+${r2(ev.diiDelta)?.toFixed(2)}pp) as FII trimmed ` +
        `(${r2(ev.fiiDelta)?.toFixed(2)}pp) with the promoter steady, into ${cur.fiscalYear}${cur.quarter}.`,
    },
    metricRefs: ["fiiPct", "diiPct"],
  };
};
