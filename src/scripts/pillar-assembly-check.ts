// Verification harness for PILLAR ASSEMBLY — the last piece of the three-lens core.
// Reads REAL 2b scored metrics for ONE peer group (Large-Cap Pharma, 10 members,
// FY26), then rolls each stock's per-metric composites into a Foundation pillar
// score and a Momentum pillar score: the three dispositions, renormalization of
// the present set to 100%, the §7.2 F10 cap, and the §14.4 floor. DRY-RUN.
//
//   npx tsx src/scripts/pillar-assembly-check.ts
//
// Bars are the CLEARLY-MARKED ILLUSTRATIVE/THROWAWAY set (inherited from 2b) — the
// pillar arithmetic is what is under test here, not the metric values.

import { prisma } from "../db/prisma.js";
import { loadFoundationStandalone, loadMomentumStandalone } from "../scoring/metrics/load.js";
import { computeFoundation } from "../scoring/metrics/foundation.js";
import { computeMomentum } from "../scoring/metrics/momentum.js";
import type { MetricValue } from "../scoring/metrics/types.js";
import { scoreMetricCrossSection, type CrossSectionInput, type CrossSectionMember } from "../scoring/metric-scoring/wire.js";
import { ILLUSTRATIVE_BARS } from "../scoring/metric-scoring/illustrative-bars.js";
import { NO_SUPPRESSION, type WiringConfig, type ScoredMetric } from "../scoring/metric-scoring/types.js";
import { assemblePillar } from "../scoring/pillars/assemble.js";
import { resolveEffectiveWeights } from "../scoring/pillars/weights.js";
import { NEUTRAL_HOLD_SCORE, type PillarScoreResult, type MetricContribution } from "../scoring/pillars/types.js";

const PG_NAME = "Large-Cap Pharma";
const FOUNDATION_KEYS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10"];
const MOMENTUM_KEYS = ["M1", "M2", "M3", "M4", "M5"];

const FOUNDATION_CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const MOMENTUM_CFG: WiringConfig = { peerMinN: 5, l3MinN: 6, l3Window: 12 };

const f2 = (x: number | null, d = 2) => (x === null ? "—" : x.toFixed(d));
const modal = (xs: string[]): string => {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
};

interface MemberData {
  stockId: string;
  symbol: string;
  fSnap: ReturnType<typeof computeFoundation>;
  fSeries: Map<string, number[]>;
  mSnap: ReturnType<typeof computeMomentum>;
  mSeries: Map<string, number[]>;
}

function foundationSeries(rows: Awaited<ReturnType<typeof loadFoundationStandalone>>): Map<string, number[]> {
  const sorted = [...rows].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
  const series = new Map<string, number[]>();
  for (let i = 0; i < sorted.length; i++) {
    const res = computeFoundation(sorted.slice(0, i + 1));
    if (!res) continue;
    for (const m of res.metrics) {
      if (!series.has(m.key)) series.set(m.key, []);
      if (m.available && m.value !== null) series.get(m.key)!.push(m.value);
    }
  }
  return series;
}
function momentumSeries(rows: Awaited<ReturnType<typeof loadMomentumStandalone>>): Map<string, number[]> {
  const sorted = [...rows].sort((a, b) => a.qOrdinal - b.qOrdinal);
  const series = new Map<string, number[]>();
  for (let i = 0; i < sorted.length; i++) {
    const res = computeMomentum(sorted.slice(0, i + 1));
    if (!res) continue;
    for (const m of res.metrics) {
      if (!series.has(m.key)) series.set(m.key, []);
      if (m.available && m.value !== null) series.get(m.key)!.push(m.value);
    }
  }
  return series;
}

function buildMembers(
  data: MemberData[],
  key: string,
  snap: (d: MemberData) => MetricValue | null,
  series: (d: MemberData) => number[],
  snapMatches: (d: MemberData) => boolean,
): CrossSectionMember[] {
  return data.map((d) => {
    const mv = snap(d);
    const aligned = snapMatches(d);
    const available = aligned && !!mv && mv.available;
    return {
      stockId: d.stockId,
      symbol: d.symbol,
      rawValue: available ? mv!.value : null,
      available,
      unavailableReason: available ? null : !aligned ? "snapshot misaligned" : (mv?.reason ?? "no row"),
      ownHistoryValues: series(d),
    };
  });
}

/** Run 2b for every metric key of a pillar, then INVERT to per-stock lists:
 *  stockId → [ScoredMetric in key order]. */
function scorePillarMetrics(
  data: MemberData[],
  keys: string[],
  pillar: "foundation" | "momentum",
  snap: (d: MemberData, key: string) => MetricValue | null,
  series: (d: MemberData, key: string) => number[],
  snapMatches: (d: MemberData) => boolean,
  snapshot: string,
  cfg: WiringConfig,
  labelOf: (key: string) => string,
): Map<string, ScoredMetric[]> {
  const byStock = new Map<string, ScoredMetric[]>();
  for (const d of data) byStock.set(d.stockId, []);
  for (const key of keys) {
    const bars = ILLUSTRATIVE_BARS[key];
    const members = buildMembers(data, key, (d) => snap(d, key), (d) => series(d, key), snapMatches);
    const input: CrossSectionInput = {
      pillar, metricKey: key, label: labelOf(key), snapshot,
      direction: bars.direction, bars: bars.bars, barNote: bars.note,
      members, suppression: NO_SUPPRESSION, config: cfg,
    };
    const xs = scoreMetricCrossSection(input);
    for (const s of xs.scored) byStock.get(s.stockId)!.push(s);
  }
  return byStock;
}

function printPillarTable(title: string, results: PillarScoreResult[]): void {
  console.log(`\n${"─".repeat(118)}\n${title}\n`);
  console.log(
    `  ${"SYMBOL".padEnd(12)} ${"STATE".padEnd(26)} ${"SUBTOTAL".padStart(9)}   present/dropped/neutral`,
  );
  for (const r of [...results].sort((a, b) => (b.subtotal ?? -1) - (a.subtotal ?? -1))) {
    const counts = `${r.scoredCount}+${r.neutralHeldCount}=${r.presentCount} present / ${r.droppedCount} dropped`;
    console.log(
      `  ${r.symbol.padEnd(12)} ${r.pillarState.padEnd(26)} ${(r.subtotal === null ? "—" : r.subtotal.toFixed(2)).padStart(9)}   ${counts}`,
    );
  }
}

/** One stock's full per-metric breakdown (effective weights + contributions). */
function printBreakdown(r: PillarScoreResult): void {
  console.log(`\n  ${r.symbol} — ${r.pillar} = ${r.subtotal === null ? "EXCLUDED" : r.subtotal.toFixed(4)}  [${r.pillarState}]`);
  console.log(`    ${"metric".padEnd(7)} ${"disposition".padEnd(13)} ${"state".padEnd(15)} ${"score".padStart(7)} ${"nomW%".padStart(7)} ${"effW%".padStart(8)} ${"contrib".padStart(8)}`);
  let sumEff = 0, sumContrib = 0;
  for (const c of r.contributions) {
    sumEff += c.effectiveWeight;
    sumContrib += c.contribution;
    const cap = c.capApplied ? " (CAP)" : "";
    console.log(
      `    ${c.metricKey.padEnd(7)} ${c.disposition.padEnd(13)} ${c.scoreState.padEnd(15)} ${f2(c.metricScore).padStart(7)} ${c.nominalWeight.toFixed(2).padStart(7)} ${c.effectiveWeight.toFixed(2).padStart(8)} ${c.contribution.toFixed(3).padStart(8)}${cap}`,
    );
  }
  console.log(`    ${"".padEnd(7)} ${"".padEnd(13)} ${"".padEnd(15)} ${"Σ".padStart(7)} ${"".padStart(7)} ${sumEff.toFixed(2).padStart(8)} ${sumContrib.toFixed(3).padStart(8)}`);
}

const clone = (s: ScoredMetric, patch: Partial<ScoredMetric>): ScoredMetric => ({ ...s, ...patch });

/** Force a metric list to a KNOWN all-scored base (real pharma data already drops
 *  M3/M4/F10, so floor demos must start from a clean slate). Each gets a real-ish
 *  composite (existing metricScore, else 60) so present counts are deterministic. */
const forceAllScored = (ms: ScoredMetric[]): ScoredMetric[] =>
  ms.map((s) => clone(s, { scoreState: "scored", includedInPeerStats: true, metricScore: s.metricScore ?? 60 }));

async function main() {
  const pg = await prisma.peerGroup.findFirst({ where: { name: PG_NAME }, include: { stocks: { include: { stock: true } } } });
  if (!pg) { console.log(`PG "${PG_NAME}" not found`); await prisma.$disconnect(); return; }

  console.log(`${"═".repeat(118)}\nPILLAR ASSEMBLY — PG: ${PG_NAME} (${pg.stocks.length} members)`);
  console.log(`⚠ BARS ILLUSTRATIVE/THROWAWAY (inherited from 2b). DRY-RUN: nothing committed.`);

  const data: MemberData[] = [];
  for (const sp of pg.stocks) {
    const stockId = sp.stock.id, symbol = sp.stock.symbol;
    const fRows = await loadFoundationStandalone(stockId);
    const qRows = await loadMomentumStandalone(stockId);
    data.push({
      stockId, symbol,
      fSnap: computeFoundation(fRows), fSeries: foundationSeries(fRows),
      mSnap: computeMomentum(qRows), mSeries: momentumSeries(qRows),
    });
  }

  const fSnapFy = modal(data.map((d) => d.fSnap?.snapshotFy ?? "").filter(Boolean));
  const mSnapQ = modal(data.map((d) => d.mSnap?.snapshotQuarter ?? "").filter(Boolean));
  const fLabel = (k: string) => data[0].fSnap?.metrics.find((m) => m.key === k)?.label ?? k;
  const mLabel = (k: string) => data[0].mSnap?.metrics.find((m) => m.key === k)?.label ?? k;

  // ── score every metric (2b) and invert to per-stock lists ──
  const fByStock = scorePillarMetrics(
    data, FOUNDATION_KEYS, "foundation",
    (d, k) => d.fSnap?.metrics.find((m) => m.key === k) ?? null,
    (d, k) => d.fSeries.get(k) ?? [],
    (d) => d.fSnap?.snapshotFy === fSnapFy, fSnapFy, FOUNDATION_CFG, fLabel,
  );
  const mByStock = scorePillarMetrics(
    data, MOMENTUM_KEYS, "momentum",
    (d, k) => d.mSnap?.metrics.find((m) => m.key === k) ?? null,
    (d, k) => d.mSeries.get(k) ?? [],
    (d) => d.mSnap?.snapshotQuarter === mSnapQ, mSnapQ, MOMENTUM_CFG, mLabel,
  );

  // ── assemble pillars ──
  const fResults: PillarScoreResult[] = data.map((d) =>
    assemblePillar({ pillar: "foundation", stockId: d.stockId, symbol: d.symbol, snapshot: fSnapFy, metrics: fByStock.get(d.stockId)! }),
  );
  const mResults: PillarScoreResult[] = data.map((d) =>
    assemblePillar({ pillar: "momentum", stockId: d.stockId, symbol: d.symbol, snapshot: mSnapQ, metrics: mByStock.get(d.stockId)! }),
  );

  printPillarTable(`FOUNDATION pillar (snapshot ${fSnapFy})`, fResults);
  printPillarTable(`MOMENTUM pillar (snapshot ${mSnapQ})`, mResults);

  // a representative full breakdown for each pillar
  console.log(`\n${"═".repeat(118)}\nPER-METRIC BREAKDOWN (one stock each pillar)`);
  printBreakdown(fResults[0]);
  printBreakdown(mResults[0]);

  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(118)}\nHAND-VERIFIED PILLAR — ${fResults[0].symbol} Foundation, full arithmetic\n`);
  {
    const r = fResults[0];
    const present = r.contributions.filter((c) => c.disposition !== "dropped");
    const dropped = r.contributions.filter((c) => c.disposition === "dropped");
    console.log(`  total metrics = ${r.totalMetrics}; dropped = [${dropped.map((c) => c.metricKey).join(", ") || "none"}] → present = ${present.length}`);
    console.log(`  each present metric's NOMINAL weight = ${present[0]?.nominalWeight.toFixed(4)}%; renormalize over ${present.length}: nominal/Σnominal × 100`);
    const nomTotal = present.reduce((a, c) => a + c.nominalWeight, 0);
    console.log(`  Σ nominal(present) = ${nomTotal.toFixed(4)}%  →  rescale factor = 100 / ${nomTotal.toFixed(4)} = ${(100 / nomTotal).toFixed(6)}`);
    let hand = 0;
    for (const c of present) {
      const expectedEff = (c.nominalWeight / nomTotal) * 100; // pre-cap; cap noted separately
      hand += (c.effectiveWeight / 100) * (c.metricScore ?? 0);
      console.log(
        `    ${c.metricKey.padEnd(4)} score ${f2(c.metricScore).padStart(7)}  effW ${c.effectiveWeight.toFixed(4).padStart(9)}%${c.capApplied ? " (CAPPED)" : ` (=${expectedEff.toFixed(4)})`}  → contrib ${((c.effectiveWeight / 100) * (c.metricScore ?? 0)).toFixed(4)}`,
      );
    }
    const effSum = present.reduce((a, c) => a + c.effectiveWeight, 0);
    console.log(`  Σ effW(present) = ${effSum.toFixed(6)}%   (must = 100)`);
    console.log(`  pillar = Σ contrib = ${hand.toFixed(4)}   vs assembled subtotal = ${r.subtotal?.toFixed(4)}  →  ${Math.abs(hand - (r.subtotal ?? NaN)) < 1e-3 ? "✓ MATCH" : "✗ MISMATCH"}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(118)}\nTARGETED VERIFICATIONS\n`);
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const allResults = [...fResults, ...mResults];

  // (a) renormalization weights sum to exactly 100% over the present set (scored pillars)
  {
    const scoredPillars = allResults.filter((r) => r.pillarState === "scored");
    const worst = Math.max(...scoredPillars.map((r) => Math.abs(r.contributions.filter((c) => c.disposition !== "dropped").reduce((a, c) => a + c.effectiveWeight, 0) - 100)));
    checks.push({ name: "(a) effective weights sum to 100% over present set (all scored pillars)", ok: worst < 1e-6, detail: `max |Σ effW − 100| = ${worst.toExponential(2)} across ${scoredPillars.length} scored pillars` });
  }

  // (b) a dropped metric contributes NOTHING and is not zero-filled (vs the wrong zero-fill answer)
  {
    const r = fResults.find((x) => x.droppedCount > 0 && x.pillarState === "scored") ?? fResults[0];
    const drop = r.contributions.find((c) => c.disposition === "dropped");
    const dropOk = !!drop && drop.effectiveWeight === 0 && drop.contribution === 0;
    // What a (wrong) zero-fill at full nominal weight would have produced:
    const equalNom = 100 / r.totalMetrics;
    const zeroFill = r.contributions.reduce((a, c) => a + (c.disposition === "dropped" ? 0 : (equalNom / 100) * (c.metricScore ?? 0)), 0);
    const renorm = r.subtotal ?? NaN;
    checks.push({
      name: "(b) dropped metric contributes 0, NOT zero-filled (renorm ≠ zero-fill)",
      ok: dropOk && Math.abs(renorm - zeroFill) > 1e-6,
      detail: `${r.symbol}: dropped ${drop?.metricKey} effW=0 contrib=0; renorm subtotal=${renorm.toFixed(3)} vs wrong zero-fill=${zeroFill.toFixed(3)} (differ → not zero-filled)`,
    });
  }

  // (c) §14.4 floor excludes a pillar when <50% present — FORCE a Momentum case (drop 3 of 5)
  {
    const d0 = data[0];
    const base = forceAllScored(mByStock.get(d0.stockId)!); // clean 5-of-5 scored base
    const drop = (s: ScoredMetric) => clone(s, { scoreState: "missing_renorm", metricScore: null, includedInPeerStats: false });

    // drop 3 of 5 → present 2/5 = 40% < 50% → EXCLUDE
    const twoPresent = base.map((s, i) => (i < 3 ? drop(s) : s));
    const r = assemblePillar({ pillar: "momentum", stockId: d0.stockId, symbol: d0.symbol, snapshot: mSnapQ, metrics: twoPresent });
    checks.push({
      name: "(c) §14.4 floor: 2/5 present (40% < 50%) → whole pillar excluded",
      ok: r.pillarState === "unavailable_redistributed" && r.subtotal === null && r.presentCount === 2,
      detail: `present ${r.presentCount}/${r.totalMetrics} (${(r.presentRatio * 100).toFixed(0)}%) → ${r.pillarState}, subtotal=${r.subtotal}; reason: ${r.unavailableReason}`,
    });

    // drop 2 of 5 → present 3/5 = 60% ≥ 50% → SCORE
    const threePresent = base.map((s, i) => (i < 2 ? drop(s) : s));
    const rb = assemblePillar({ pillar: "momentum", stockId: d0.stockId, symbol: d0.symbol, snapshot: mSnapQ, metrics: threePresent });
    checks.push({
      name: "(c2) §14.4 boundary: 3/5 present (60% ≥ 50%) → pillar SCORES",
      ok: rb.pillarState === "scored" && rb.subtotal !== null && rb.presentCount === 3,
      detail: `present ${rb.presentCount}/${rb.totalMetrics} → ${rb.pillarState}, subtotal=${rb.subtotal?.toFixed(2)} (3 present @ 33.33% each)`,
    });

    // EXACT boundary: Foundation 5 of 10 = exactly 50% → MUST SCORE (≥50% inclusive)
    const fbase = forceAllScored(fByStock.get(d0.stockId)!);
    const fiveOf10 = fbase.map((s, i) => (i < 5 ? drop(s) : s));
    const rc = assemblePillar({ pillar: "foundation", stockId: d0.stockId, symbol: d0.symbol, snapshot: fSnapFy, metrics: fiveOf10 });
    const fourOf10 = fbase.map((s, i) => (i < 6 ? drop(s) : s));
    const rd = assemblePillar({ pillar: "foundation", stockId: d0.stockId, symbol: d0.symbol, snapshot: fSnapFy, metrics: fourOf10 });
    checks.push({
      name: "(c3) §14.4 EXACT boundary: Foundation 5/10 = 50% SCORES; 4/10 = 40% excludes",
      ok: rc.pillarState === "scored" && rc.presentCount === 5 && rd.pillarState === "unavailable_redistributed" && rd.presentCount === 4,
      detail: `5/10 (50%) → ${rc.pillarState} subtotal=${rc.subtotal?.toFixed(2)} (5 present @ 20% each); 4/10 (40%) → ${rd.pillarState}`,
    });
  }

  // (d) SYNTHETIC neutral-hold: sits at 60, full weight, and RESCALES with the present
  //     set when ANOTHER metric drops (does NOT get renormalized away).
  {
    const d0 = data[0];
    const fs = fByStock.get(d0.stockId)!.map((s) => s); // copy
    // F2 → neutral_hold (banking-style); F3 → dropped. Others stay as-is.
    const synth = fs.map((s) => {
      if (s.metricKey === "F2") return clone(s, { scoreState: "neutral_hold", includedInPeerStats: true, metricScore: null });
      if (s.metricKey === "F3") return clone(s, { scoreState: "missing_renorm", metricScore: null, includedInPeerStats: false });
      return s;
    });
    const r = assemblePillar({ pillar: "foundation", stockId: d0.stockId, symbol: d0.symbol, snapshot: fSnapFy, metrics: synth });
    const nh = r.contributions.find((c) => c.metricKey === "F2")!;
    const anyScored = r.contributions.find((c) => c.disposition === "scored")!;
    // present set excludes only F3 (dropped). Every present metric (incl neutral-hold)
    // shares the SAME rescaled weight here (equal nominal) — so nh.effW == scored.effW > 10.
    const rescaledTogether = Math.abs(nh.effectiveWeight - anyScored.effectiveWeight) < 1e-6 && nh.effectiveWeight > 10 + 1e-6;
    checks.push({
      name: "(d) neutral-hold: score=60, full weight, RESCALES UP with present set when another drops",
      ok: nh.disposition === "neutral_hold" && nh.metricScore === NEUTRAL_HOLD_SCORE && rescaledTogether && nh.contribution > 0,
      detail: `F2 neutral_hold score=${nh.metricScore} effW=${nh.effectiveWeight.toFixed(4)}% (== scored ${anyScored.effectiveWeight.toFixed(4)}%, both >10 after F3 dropped); contrib=${nh.contribution.toFixed(3)}; present=${r.presentCount}/${r.totalMetrics}`,
    });
    console.log(`  [synthetic neutral-hold pillar ${d0.symbol}]:`);
    printBreakdown(r);
  }

  // (F10 cap × renorm) demonstration — FORCE F10 present while another metric drops
  console.log(`\n${"═".repeat(118)}\n§7.2 F10-CAP × RENORMALIZATION — forced demonstration\n`);
  {
    const d0 = data[0];
    const fs = fByStock.get(d0.stockId)!;
    // Force F10 scored (real pharma data drops it); drop F1 so 9 present incl F10.
    const synth = fs.map((s) => {
      if (s.metricKey === "F10") return clone(s, { scoreState: "scored", metricScore: 70, rawValue: 12, includedInPeerStats: true });
      if (s.metricKey === "F1") return clone(s, { scoreState: "missing_renorm", metricScore: null, includedInPeerStats: false });
      return s;
    });
    const r = assemblePillar({ pillar: "foundation", stockId: d0.stockId, symbol: d0.symbol, snapshot: fSnapFy, metrics: synth });
    const f10 = r.contributions.find((c) => c.metricKey === "F10")!;
    const others = r.contributions.filter((c) => c.disposition === "scored" && c.metricKey !== "F10");
    console.log(`  9 present (F1 dropped). Naive renorm would give every present metric 100/9 = ${(100 / 9).toFixed(4)}%.`);
    console.log(`  §7.2 caps F10 at ${10}%: F10 effW = ${f10.effectiveWeight.toFixed(4)}% capApplied=${f10.capApplied}; excess 1.1111% spread over the other 8.`);
    console.log(`  other present metrics effW = ${others[0]?.effectiveWeight.toFixed(4)}% each (= 11.25 expected: 100/9 + 1.1111/8).`);
    const sumEff = r.contributions.filter((c) => c.disposition !== "dropped").reduce((a, c) => a + c.effectiveWeight, 0);
    const capOk = Math.abs(f10.effectiveWeight - 10) < 1e-6 && f10.capApplied && Math.abs((others[0]?.effectiveWeight ?? 0) - 11.25) < 1e-6 && Math.abs(sumEff - 100) < 1e-6;
    console.log(`  Σ effW(present) = ${sumEff.toFixed(6)}% (=100)  →  ${capOk ? "✓ CAP+RENORM CORRECT" : "✗ WRONG"}`);
    checks.push({ name: "(e) §7.2 F10 cap clamps to 10% under renorm; excess redistributed; Σ=100", ok: capOk, detail: `F10=${f10.effectiveWeight.toFixed(4)}% others=${others[0]?.effectiveWeight.toFixed(4)}% Σ=${sumEff.toFixed(4)}` });
  }

  // independent re-check of resolveEffectiveWeights on a hand example
  {
    const present = [
      { metricKey: "F10", nominalWeight: 10, maxWeight: 10 },
      ...["F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9"].map((k) => ({ metricKey: k, nominalWeight: 10 })),
    ];
    const out = resolveEffectiveWeights(present);
    const f10 = out.find((o) => o.metricKey === "F10")!;
    const other = out.find((o) => o.metricKey === "F2")!;
    const sum = out.reduce((a, o) => a + o.effectiveWeight, 0);
    checks.push({ name: "(f) resolveEffectiveWeights unit: 9 present, F10 capped → F10=10, others=11.25, Σ=100", ok: Math.abs(f10.effectiveWeight - 10) < 1e-9 && Math.abs(other.effectiveWeight - 11.25) < 1e-9 && Math.abs(sum - 100) < 1e-9, detail: `F10=${f10.effectiveWeight} other=${other.effectiveWeight} Σ=${sum}` });
  }

  for (const c of checks) console.log(`  ${c.ok ? "✓ PASS" : "✗ FAIL"}  ${c.name}\n           ${c.detail}`);
  const allPass = checks.every((c) => c.ok);
  console.log(`\n  ${allPass ? "✓ ALL TARGETED CHECKS PASS" : "✗ A CHECK FAILED"}\n`);

  // ── FLAGS ──
  console.log(`${"═".repeat(118)}\nFLAGS\n`);
  for (const fl of [
    "NEUTRAL-HOLD RESCALING (decision): a neutral-hold metric is PRESENT, so when a DIFFERENT metric drops it rescales UP alongside the scored metrics — only DROPPED metrics leave the weight pool. Implemented that way (verification d). The schema comment 'effectiveWeight = FULL (kept, NOT renormalised)' describes the BASE case (no other drops), where present=all and the rescale factor is 1 so neutral-hold = nominal; it does not legislate the cross-drop case. If the team instead wants neutral-hold FROZEN at nominal while scored metrics renormalize around it, that is a one-branch change in assemble.ts (exclude neutral-hold keys from resolveEffectiveWeights and reserve their nominal). Flagged for confirmation.",
    "F10 CAP × RENORMALIZATION: the §7.2 cap is enforced on the EFFECTIVE (post-renorm) weight, in resolveEffectiveWeights. With no drops, post-renorm = nominal, so it also catches a per-PG override that sets F10 > 10%. When F10 is DROPPED (the common real-data case — Revenue-3y-CAGR needs a begin-year FY that is absent) it leaves the pool and the cap is moot. The cap only bites when F10 is PRESENT and OTHER metrics drop (forced demo e/f): F10 clamps to 10%, the excess redistributes proportionally to the other present metrics. Cap value 10% is structural (§7.2), not fitted (CN-8).",
    "§14.4 FLOOR BOUNDARY (decision): ≥50% present = SCORE, <50% = EXCLUDE. Exactly 50% (Foundation 5/10) SCORES; Momentum 3/5=60% scores, 2/5=40% excludes (verification c/c2). Implemented as presentRatio + 1e-9 ≥ floorRatio so the exact boundary is inclusive.",
    "WHOLE-PILLAR EXCLUSION is a RECORDED state (pillarState=unavailable_redistributed, reason stored), never a silent zero/null. The non-nullable score_pillars.subtotal column gets an INERT 0 placeholder at the DB boundary (persist.ts); pillarState is the truth and the snapshot-level reweight zeroes this pillar's weight, so the 0 is never read into a composite.",
    "THREE DISPOSITIONS stay distinguishable in output: scoreState (the exact 2b state: scored / suppressed / missing_renorm / neutral_hold) is carried onto every MetricContribution alongside the coarser disposition (scored / dropped / neutral_hold). A pillar scored with 2 renormalized-away vs one holding a neutral at 60 are different, recoverable facts.",
    "WEIGHT UNITS: nominalWeight / effectiveWeight are PERCENT (0–100); contribution is in SCORE-POINTS (effectiveWeight/100 × score), so Σ contributions = subtotal and the pillar decomposes additively. CN-3 untouched: this weights metric COMPOSITES, never the three lenses within a metric.",
    "F10 / M3 / M4 are MISSING for all pharma in real data (begin-year FY / 8-quarter history absent) — so the live runs show F10 dropped (9 metrics → 11.11% each) and Momentum frequently at 3/5. The cap and neutral-hold paths therefore needed SYNTHETIC forcing to exercise (demos e/f and d) — clearly marked synthetic, not real values.",
  ]) console.log("  • " + fl + "\n");

  await prisma.$disconnect();
  if (!allPass) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
