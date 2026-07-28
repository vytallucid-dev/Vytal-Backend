// File: src/scoring/findings/rules/n5-dual-institutional-build.ts
//
// N5 — Dual Institutional Build (Family N · CONSTRUCTIVE MIRROR of P4 Dual Institutional
// Exit). Amendment §5. Where P4 fires when FII AND DII both CUT in the same quarter (Flow B4),
// N5 recognises the opposite: FII AND DII both ADDING in the same quarter — two-sided
// institutional accumulation.
//
// NOT COVERED BY P1: P1 (Flow B1 clean rotation) requires DII↑ AND FII slightly DOWN — plain
// two-sided accumulation (both up) has never had a rule. N5 fills exactly that gap.
//
// Trigger (Amendment §5): same quarter, FIIΔ ≥ +0.5pp AND DIIΔ ≥ +0.5pp.
//
// GATES: ≥2 shareholding rows else not_evaluable{insufficient_shareholding_history} · a null
// FII or DII bucket → not_evaluable{class_not_disclosed}, NEVER a pass (an undisclosed class is
// unknown, not "did not build").
//
// ANTI-DOUBLE-COUNT (Amendment §5, precedence implemented EXPLICITLY): if P1 (the more specific
// rotation read) fires on the SAME quarter, P1 leads and N5 defers (does not fire → read layer
// treats it as overflow). NOTE: with the current thresholds these are mutually exclusive — P1's
// B1 requires FIIΔ ∈ [−0.5, −0.05] (FII down) while N5 requires FIIΔ ≥ +0.5 (FII up) — so the
// deferral never actually triggers today. It is implemented anyway, per the amendment, so the
// precedence is correct if either threshold ever changes; it reuses the engine's B1 verdict
// (computeCategoryB) rather than re-deriving it, exactly as P1 itself does.
//
// DISPLAY-ONLY: green · positive · magnitude null (explicit) · CONDITION.

import { computeCategoryB } from "../../ownership/flow.js";
import { notEvaluable, type FireRule } from "../types.js";

export const N5_MIN_MOVE_PP = 0.5; // each of FII / DII must rise ≥ 0.5pp (P4-symmetric)

export const ruleN5: FireRule = (ctx) => {
  const rows = ctx.shareholding;
  if (rows.length < 2) return notEvaluable("insufficient_shareholding_history");

  const cur = rows[rows.length - 1];
  const prior = rows[rows.length - 2];
  const f = cur.fiiPct, f1 = prior.fiiPct;
  const d = cur.diiPct, d1 = prior.diiPct;
  if (f === null || f1 === null || d === null || d1 === null) return notEvaluable("class_not_disclosed");

  const fiiDelta = f - f1;
  const diiDelta = d - d1;
  if (fiiDelta < N5_MIN_MOVE_PP || diiDelta < N5_MIN_MOVE_PP) return null; // not both building → not_fired

  // PRECEDENCE: P1 (B1 clean rotation) leads on this quarter → N5 defers (not_fired / overflow).
  const b = computeCategoryB(rows, rows.length - 1);
  if (b.firedRule && b.firedRule.includes("B1")) return null;

  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    kind: "pattern",
    key: "ownership_N5_dual_institutional_build",
    severity: "green",
    direction: "positive",
    polarity: "positive",
    temporalClass: "CONDITION",
    magnitude: null, // EXPLICIT
    displayState: "active",
    evidence: {
      family: "N",
      pattern: "N5",
      name: "Dual Institutional Build",
      period: `${cur.fiscalYear}${cur.quarter}`,
      fiiDeltaPp: r2(fiiDelta),  // REQUIRED KEY (§3)
      diiDeltaPp: r2(diiDelta),  // REQUIRED KEY (§3)
      minMovePp: N5_MIN_MOVE_PP,
      fiiFrom: r2(f1), fiiTo: r2(f),
      diiFrom: r2(d1), diiTo: r2(d),
      verdict:
        `Dual institutional build — FII (+${r2(fiiDelta).toFixed(2)}pp) and DII (+${r2(diiDelta).toFixed(2)}pp) ` +
        `both added in the same quarter (${cur.fiscalYear}${cur.quarter}).`,
    },
    metricRefs: ["fiiPct", "diiPct"],
  };
};
