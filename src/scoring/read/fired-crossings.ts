// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE CROSSING OVERLAY, SOURCED FROM FIRED ROWS. Ruling 0 — no surface derives a pattern fact.
//
// A "crossing" on the trajectory chart used to be computed by the read layer: band each pillar
// against NATIVE_ZONES at every period, emit an event whenever the label changed. That produced
// crossings at boundaries the study EXCLUDED (Foundation ↓60 — "+8.2%, the cross arrives late"; the
// cross INTO strong — "a single +59% outlier drove it") drawn identically beside the four that
// survived. The tool was competing with the very patterns it exists to render.
//
// This reads what T3–T6 actually fired. The mark comes from the rule's own `crossedBelow` /
// `crossedAbove`; the subject comes from the record's `pillarPair`. Nothing is banded here.
//
// ★ EXPECT IT TO BE NEAR-EMPTY FOR NOW. The live T-family is one quarter old, so there is almost no
// history of it firing. That is the honest state of what we recorded, and it fills in as quarters
// accumulate — the alternative was keeping a derivation that drew excluded conditions as facts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../../db/prisma.js";
import { headOfChainByPeriod } from "../findings/trajectory/load-series.js";
import { isRetiredFinding } from "../../catalogue/retired-findings.js";
import { isPatternKey, PATTERN_FACTS } from "../../catalogue/pattern-facts.js";
import type { CrossingEvent, PillarKey } from "./health-view.types.js";

/** The four crossing patterns whose subject is a real pillar. T3/T4 cross the COMPOSITE, which the
 *  chart already draws as a band crossing — including them would double-draw the same event. */
const PILLAR_CROSSINGS = new Set<string>([
  "trajectory_D_T5_foundation_out_of_weak",
  "trajectory_B_T6_momentum_breaking_into_weak",
  "divergence_D6_quality_rolling_over",
  "divergence_D7_trajectory_breaking_base_holds",
]);

const numOf = (ev: unknown, k: string): number | null => {
  if (!ev || typeof ev !== "object") return null;
  const v = (ev as Record<string, unknown>)[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/**
 * Crossing events for a stock across the periods the chart is drawing, from fired rows only.
 *
 * `periodKeys` bounds the read to what is on screen. Head-of-chain per period, so version churn
 * cannot draw the same crossing eight times.
 */
export async function firedCrossingEvents(
  stockId: string,
  periodKeys: readonly string[],
): Promise<CrossingEvent[]> {
  if (periodKeys.length === 0) return [];
  const snaps = await prisma.scoreSnapshot.findMany({
    where: { stockId, snapshotType: "quarterly", periodKey: { in: [...periodKeys] } },
    select: { id: true, periodKey: true, version: true },
  });
  if (snaps.length === 0) return [];
  const heads = headOfChainByPeriod(snaps);
  const headIds = new Set([...heads.values()].map((s) => s.id));
  const periodOf = new Map([...heads.values()].map((s) => [s.id, s.periodKey]));

  const rows = await prisma.scorePattern.findMany({
    where: { snapshotId: { in: [...headIds] } },
    select: { snapshotId: true, patternKey: true, evidence: true },
  });

  const out: CrossingEvent[] = [];
  for (const r of rows) {
    if (isRetiredFinding(r.patternKey)) continue;
    if (!PILLAR_CROSSINGS.has(r.patternKey)) continue;
    if (!isPatternKey(r.patternKey)) continue;
    const toPeriod = periodOf.get(r.snapshotId);
    if (!toPeriod) continue;

    // The pattern's own subject pillar — declared, never inferred from the evidence's field names.
    const subject = PATTERN_FACTS[r.patternKey].pillarPair.find((p) => p !== "composite");
    if (!subject) continue;

    const below = numOf(r.evidence, "crossedBelow");
    const above = numOf(r.evidence, "crossedAbove");
    const mark = below ?? above;
    if (mark === null) continue;

    // The rule stamps the prior period it crossed FROM; fall back to the same period rather than
    // inventing an adjacency the row does not carry.
    const priorPeriod = typeof (r.evidence as { priorPeriod?: unknown })?.priorPeriod === "string"
      ? ((r.evidence as { priorPeriod: string }).priorPeriod)
      : toPeriod;

    out.push({
      type: "pillar_zone",
      fromPeriod: priorPeriod,
      toPeriod,
      pillar: subject as PillarKey,
      from: below !== null ? "above_native" : "below_native",
      to: below !== null ? "below_native" : "above_native",
    });
  }
  return out;
}
