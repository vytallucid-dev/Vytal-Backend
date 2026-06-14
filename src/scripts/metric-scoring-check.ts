// Verification harness for PIECE 2b — the lens-WIRING layer. Reads REAL standalone
// raw values (2a) for ONE peer group, applies the CLEARLY-MARKED ILLUSTRATIVE
// bar-set, computes peer-stats, runs all three lenses + both anchor-lift decisions
// + the composite, and prints the scored table. DRY-RUN: computes everything,
// commits nothing.
//
//   npx tsx src/scripts/metric-scoring-check.ts
//
// PG = Large-Cap Pharma (10 members, all with standalone FY26 → a real N=10
// cross-section that actually exercises Lens 2 and the §5.3.1 lift counting).
// READ THIS FOR THIN-DATA CORRECTNESS (graceful degradation), not full coverage:
// expect L3 to fall back almost everywhere (own-history N << min) and the
// 8-quarter / begin-year metrics (M3/M4/F10) to be MISSING for everyone.

import { prisma } from "../db/prisma.js";
import { loadFoundationStandalone, loadMomentumStandalone } from "../scoring/metrics/load.js";
import { computeFoundation } from "../scoring/metrics/foundation.js";
import { computeMomentum } from "../scoring/metrics/momentum.js";
import type { MetricValue } from "../scoring/metrics/types.js";
import { scoreMetricCrossSection, type CrossSectionInput, type CrossSectionMember } from "../scoring/metric-scoring/wire.js";
import { computePeerStats, decideLift531, GOOD_L1 } from "../scoring/metric-scoring/peer-stats.js";
import { ILLUSTRATIVE_BARS } from "../scoring/metric-scoring/illustrative-bars.js";
import { NO_SUPPRESSION, type WiringConfig, type ScoredMetric } from "../scoring/metric-scoring/types.js";
import { computeLens1 } from "../scoring/lenses/lens-bars.js";
import { computeLens2 } from "../scoring/lenses/lens-zscore.js";

const PG_NAME = "Large-Cap Pharma";
const FOUNDATION_KEYS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10"];
const MOMENTUM_KEYS = ["M1", "M2", "M3", "M4", "M5"];

// SPEC values / interpretations (CN-8: not fitted) — FLAGGED in the summary.
const FOUNDATION_CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 }; // L3 floor 5 = bottom of 5–10y window
const MOMENTUM_CFG: WiringConfig = { peerMinN: 5, l3MinN: 6, l3Window: 12 }; // L3 floor 6 = bottom of 6–12 TTM window

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

/** Own-history series per metric, built by TRUNCATED RECOMPUTE: run the 2a metric
 *  function on data up to each snapshot; collect the VALID values oldest→newest
 *  (current is the last element). */
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

function printCrossSection(xs: ReturnType<typeof scoreMetricCrossSection>, bars: { note: string }): void {
  const ps = xs.peerStats;
  const lift = xs.lift531;
  console.log(
    `\n  ${xs.metricKey} ${xs.label}  [snap ${xs.snapshot}]  peer μ=${f2(ps.mean, 3)} σ=${f2(ps.stdDev, 3)} N=${ps.sampleN}` +
      `  | L2 ${xs.l2Available ? "ON" : "OFF (N<min)"}  | §5.3.1 lift: ${lift.clearedCount}/${lift.n} cleared L1≥75 → ${lift.fired ? "FIRED (anchor 75)" : "no (anchor 60)"}`,
  );
  for (const s of xs.scored) {
    if (s.scoreState !== "scored") {
      console.log(`    ${s.symbol.padEnd(11)} ${s.scoreState.toUpperCase().padEnd(14)} raw=${f2(s.rawValue)}  (${s.unavailableReason})  inPeerStats=${s.includedInPeerStats}`);
      continue;
    }
    console.log(
      `    ${s.symbol.padEnd(11)} raw=${f2(s.rawValue).padStart(8)}  ` +
        `L1=${f2(s.l1Score).padStart(6)}/${(s.l1Band ?? "").padEnd(10)}${s.l1Saturated ? "(sat)" : "     "}  ` +
        `L2=${f2(s.l2Score).padStart(6)}${s.l2Available ? `[Z=${f2(s.l2Z, 2)} a${s.l2AnchorApplied}${s.l2AnchorFired ? "↑" : ""}]` : "[OFF]"}  ` +
        `L3=${(s.l3Available ? f2(s.l3Score) : "—").padStart(5)}[N=${s.l3WindowN}${s.l3Available ? ` Z=${f2(s.l3Z, 2)}` : " <min"}]  ` +
        `→ ${f2(s.metricScore).padStart(6)}  fb=${s.lensFallbackApplied}`,
    );
  }
}

async function main() {
  const pg = await prisma.peerGroup.findFirst({
    where: { name: PG_NAME },
    include: { stocks: { include: { stock: true } } },
  });
  if (!pg) { console.log(`PG "${PG_NAME}" not found`); await prisma.$disconnect(); return; }

  console.log(`${"═".repeat(110)}\nPIECE 2b WIRING — PG: ${PG_NAME} (${pg.stocks.length} members)`);
  console.log(`⚠ BARS ARE ILLUSTRATIVE/THROWAWAY — ${ILLUSTRATIVE_BARS.F1.note}`);
  console.log(`config: Foundation ${JSON.stringify(FOUNDATION_CFG)}  Momentum ${JSON.stringify(MOMENTUM_CFG)}`);

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
  const labelOf = (snapMetrics: MetricValue[] | undefined, key: string) => snapMetrics?.find((m) => m.key === key)?.label ?? key;

  // ── FOUNDATION ──
  console.log(`\n${"─".repeat(110)}\nFOUNDATION (snapshot ${fSnapFy})`);
  const allScored: ScoredMetric[] = [];
  for (const key of FOUNDATION_KEYS) {
    const bars = ILLUSTRATIVE_BARS[key];
    const members = buildMembers(
      data, key,
      (d) => d.fSnap?.metrics.find((m) => m.key === key) ?? null,
      (d) => d.fSeries.get(key) ?? [],
      (d) => d.fSnap?.snapshotFy === fSnapFy,
    );
    const input: CrossSectionInput = {
      pillar: "foundation", metricKey: key, label: labelOf(data[0].fSnap?.metrics, key),
      snapshot: fSnapFy, direction: bars.direction, bars: bars.bars, barNote: bars.note,
      members, suppression: NO_SUPPRESSION, config: FOUNDATION_CFG,
    };
    const xs = scoreMetricCrossSection(input);
    printCrossSection(xs, bars);
    allScored.push(...xs.scored);
  }

  // ── MOMENTUM ──
  console.log(`\n${"─".repeat(110)}\nMOMENTUM (snapshot ${mSnapQ})`);
  for (const key of MOMENTUM_KEYS) {
    const bars = ILLUSTRATIVE_BARS[key];
    const members = buildMembers(
      data, key,
      (d) => d.mSnap?.metrics.find((m) => m.key === key) ?? null,
      (d) => d.mSeries.get(key) ?? [],
      (d) => d.mSnap?.snapshotQuarter === mSnapQ,
    );
    const input: CrossSectionInput = {
      pillar: "momentum", metricKey: key, label: labelOf(data[0].mSnap?.metrics, key),
      snapshot: mSnapQ, direction: bars.direction, bars: bars.bars, barNote: bars.note,
      members, suppression: NO_SUPPRESSION, config: MOMENTUM_CFG,
    };
    const xs = scoreMetricCrossSection(input);
    printCrossSection(xs, bars);
    allScored.push(...xs.scored);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TARGETED VERIFICATIONS
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(110)}\nTARGETED VERIFICATIONS\n`);
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  // (a) peer μ/σ over VALID values only — sampleN equals count of available members.
  for (const key of ["F1", "F5"]) {
    const members = buildMembers(data, key, (d) => d.fSnap?.metrics.find((m) => m.key === key) ?? null, (d) => d.fSeries.get(key) ?? [], (d) => d.fSnap?.snapshotFy === fSnapFy);
    const xs = scoreMetricCrossSection({ pillar: "foundation", metricKey: key, label: key, snapshot: fSnapFy, direction: ILLUSTRATIVE_BARS[key].direction, bars: ILLUSTRATIVE_BARS[key].bars, barNote: "", members, suppression: NO_SUPPRESSION, config: FOUNDATION_CFG });
    const availCount = members.filter((m) => m.available).length;
    checks.push({ name: `(a) ${key} peer N == #available (valid-only μ/σ)`, ok: xs.peerStats.sampleN === availCount, detail: `sampleN=${xs.peerStats.sampleN}, available=${availCount}, missing excluded` });
  }

  // (b) §5.3.1 lift fires/doesn't based on the ≥75%-cleared count — recompute the count independently.
  {
    const key = "F5"; // interest coverage: pharma are low-debt → high coverage → likely many clear L1≥75
    const members = buildMembers(data, key, (d) => d.fSnap?.metrics.find((m) => m.key === key) ?? null, (d) => d.fSeries.get(key) ?? [], (d) => d.fSnap?.snapshotFy === fSnapFy);
    const valid = members.filter((m) => m.available);
    const l1s = valid.map((m) => computeLens1(m.rawValue!, ILLUSTRATIVE_BARS[key].bars, ILLUSTRATIVE_BARS[key].direction).score);
    const indep = decideLift531(l1s);
    const xs = scoreMetricCrossSection({ pillar: "foundation", metricKey: key, label: key, snapshot: fSnapFy, direction: ILLUSTRATIVE_BARS[key].direction, bars: ILLUSTRATIVE_BARS[key].bars, barNote: "", members, suppression: NO_SUPPRESSION, config: FOUNDATION_CFG });
    checks.push({ name: `(b) ${key} §5.3.1 lift decision matches independent count`, ok: xs.lift531.fired === indep.fired && xs.lift531.clearedCount === indep.clearedCount, detail: `cleared ${indep.clearedCount}/${indep.n} (${(indep.fraction * 100).toFixed(0)}%) → fired=${indep.fired}; ≥75% rule` });
  }

  // (c) L3 min-N gating → §5.8 fallback recorded (not silent zero).
  {
    const f1Scored = allScored.filter((s) => s.metricKey === "F1" && s.scoreState === "scored");
    const allFellBack = f1Scored.every((s) => !s.l3Available && s.lensFallbackApplied === "l3_insufficient_history" && s.metricScore !== null && s.metricScore !== 0);
    checks.push({ name: "(c) F1 L3 min-N gate → fallback l3_insufficient_history (non-zero composite)", ok: f1Scored.length > 0 && allFellBack, detail: `${f1Scored.length} scored; all L3 N<${FOUNDATION_CFG.l3MinN} → (L1+L2)/2, fb recorded` });
  }

  // (d) a MISSING metric is excluded from peer-stats (counted as nothing, not 0).
  {
    const key = "F10"; // begin-year FY absent for all → all missing
    const members = buildMembers(data, key, (d) => d.fSnap?.metrics.find((m) => m.key === key) ?? null, (d) => d.fSeries.get(key) ?? [], (d) => d.fSnap?.snapshotFy === fSnapFy);
    const xs = scoreMetricCrossSection({ pillar: "foundation", metricKey: key, label: key, snapshot: fSnapFy, direction: ILLUSTRATIVE_BARS[key].direction, bars: ILLUSTRATIVE_BARS[key].bars, barNote: "", members, suppression: NO_SUPPRESSION, config: FOUNDATION_CFG });
    const noneInPeer = xs.scored.every((s) => !s.includedInPeerStats);
    checks.push({ name: "(d) F10 all-missing → peer N=0, none included in peer-stats", ok: xs.peerStats.sampleN === 0 && noneInPeer, detail: `sampleN=${xs.peerStats.sampleN}; missing excluded, not counted as 0` });
  }

  for (const c of checks) console.log(`  ${c.ok ? "✓ PASS" : "✗ FAIL"}  ${c.name}\n           ${c.detail}`);

  // ── HAND-VERIFIED CHAIN: F1 (ROCE) on the first valid pharma stock ──
  console.log(`\n${"═".repeat(110)}\nHAND-VERIFIED CHAIN — F1 ROCE, full wiring arithmetic\n`);
  {
    const key = "F1";
    const bars = ILLUSTRATIVE_BARS[key];
    const members = buildMembers(data, key, (d) => d.fSnap?.metrics.find((m) => m.key === key) ?? null, (d) => d.fSeries.get(key) ?? [], (d) => d.fSnap?.snapshotFy === fSnapFy);
    const valid = members.filter((m) => m.available);
    const subject = valid[0];
    const roceValues = valid.map((m) => m.rawValue!);

    // peer μ/σ by hand (population)
    const N = roceValues.length;
    const mean = roceValues.reduce((a, b) => a + b, 0) / N;
    const variance = roceValues.reduce((a, b) => a + (b - mean) ** 2, 0) / N;
    const sigma = Math.sqrt(variance);
    console.log(`  Peer ROCE values (N=${N}): [${roceValues.map((v) => v.toFixed(2)).join(", ")}]`);
    console.log(`  μ = Σ/${N} = ${mean.toFixed(4)}   σ(pop) = √(Σ(x−μ)²/${N}) = ${sigma.toFixed(4)}`);

    // L1 by hand against illustrative F1 bars (exc25/good18/acc12/con8/dis4, higher_better)
    const l1 = computeLens1(subject.rawValue!, bars.bars, bars.direction);
    console.log(`\n  Subject = ${subject.symbol}, raw ROCE = ${subject.rawValue!.toFixed(4)}%`);
    console.log(`  L1: bars exc25/good18/acc12/con8/dis4 (higher_better) → ${l1.score.toFixed(4)} band=${l1.band}`);

    // §5.3.1 lift count by hand
    const l1s = valid.map((m) => computeLens1(m.rawValue!, bars.bars, bars.direction).score);
    const cleared = l1s.filter((s) => s >= GOOD_L1).length;
    const fired = cleared / N >= 0.75;
    console.log(`  §5.3.1: ${cleared}/${N} cleared L1≥75 (${((cleared / N) * 100).toFixed(0)}%) → lift ${fired ? "FIRED → anchor 75" : "no → anchor 60"}`);

    // Z and L2 by hand
    const z = (subject.rawValue! - mean) / sigma;
    const l2 = computeLens2({ value: subject.rawValue!, peerMean: mean, peerStdDev: sigma, direction: bars.direction, anchorLifted: fired });
    console.log(`  Z = (${subject.rawValue!.toFixed(2)} − ${mean.toFixed(2)}) / ${sigma.toFixed(2)} = ${z.toFixed(4)}`);
    console.log(`  L2 = zToScore(${z.toFixed(3)}, anchor ${fired ? 75 : 60}) = ${l2.score!.toFixed(4)}`);

    // composite by hand (L3 unavailable → (L1+L2)/2)
    const composite = (l1.score + l2.score!) / 2;
    console.log(`  L3: own-history N small (<${FOUNDATION_CFG.l3MinN}) → UNAVAILABLE → §5.8 fallback`);
    console.log(`  composite = (L1 ${l1.score.toFixed(2)} + L2 ${l2.score!.toFixed(2)}) / 2 = ${composite.toFixed(4)}  [fb=l3_insufficient_history]`);

    // assert against the wired result
    const wired = scoreMetricCrossSection({ pillar: "foundation", metricKey: key, label: key, snapshot: fSnapFy, direction: bars.direction, bars: bars.bars, barNote: bars.note, members, suppression: NO_SUPPRESSION, config: FOUNDATION_CFG }).scored.find((s) => s.stockId === subject.stockId)!;
    const match = Math.abs(wired.metricScore! - composite) < 1e-9 && wired.lensFallbackApplied === "l3_insufficient_history";
    console.log(`\n  WIRED result: composite=${wired.metricScore!.toFixed(4)} fb=${wired.lensFallbackApplied}  →  ${match ? "✓ HAND == WIRED" : "✗ MISMATCH"}`);
    checks.push({ name: "(hand) F1 chain raw→L1→peerμσ→Z→L2→composite == wired", ok: match, detail: `hand ${composite.toFixed(4)} vs wired ${wired.metricScore!.toFixed(4)}` });
  }

  // ── FALLBACK DISTRIBUTION ──
  console.log(`\n${"═".repeat(110)}\nFALLBACK / STATE DISTRIBUTION (all ${allScored.length} stock×metric results)\n`);
  const tally = (pred: (s: ScoredMetric) => boolean) => allScored.filter(pred).length;
  console.log(`  scored:        ${tally((s) => s.scoreState === "scored")}`);
  console.log(`  missing_renorm:${tally((s) => s.scoreState === "missing_renorm")}`);
  console.log(`  suppressed:    ${tally((s) => s.scoreState === "suppressed")}  (hook inert — no guardrail yet)`);
  console.log(`  ── of the scored, lens fallback: ──`);
  console.log(`  none (full 3-lens):        ${tally((s) => s.scoreState === "scored" && s.lensFallbackApplied === "none")}`);
  console.log(`  l3_insufficient_history:   ${tally((s) => s.scoreState === "scored" && s.lensFallbackApplied === "l3_insufficient_history")}`);
  console.log(`  l2_to_l1:                  ${tally((s) => s.scoreState === "scored" && s.lensFallbackApplied === "l2_to_l1")}`);

  const allPass = checks.every((c) => c.ok);
  console.log(`\n  ${allPass ? "✓ ALL TARGETED CHECKS PASS" : "✗ A CHECK FAILED"}\n`);

  // ── FLAGS ──
  console.log(`${"═".repeat(110)}\nFLAGS\n`);
  for (const fl of [
    "BARS ARE ILLUSTRATIVE/THROWAWAY (illustrative-bars.ts) — hand-set, NOT CN-4. The anchor-lift counts are computed against THESE; they recompute against real bars in Phase 6. Production path (bars.ts:loadBarSet) reads score_metric_bar_sets and returns null today (no rows).",
    `MIN-N values (spec gave RANGES, not exact minimums — INTERPRETED as the window floor): peer-N min = 5 (L2); Foundation L3 min = 5 (bottom of 5–10y); Momentum L3 min = 6 (bottom of 6–12 TTM). L3 window cap = 10y / 12 TTM. If the spec intends different floors, change WiringConfig.`,
    "Peer σ and own-history σ are POPULATION (÷N) — the peer set is a complete population, not a sample. Own-history including the current snapshot in its own μ/σ window (consistent with the §5.4.1 'in-window observations' set). With tiny own-history N this is moot (L3 falls back).",
    "Own-history series built by TRUNCATED RECOMPUTE (run the 2a metric on data up to each past snapshot). Correct & general, but each historical point inherits 2a's own standalone gaps — so effective N is small and L3 fallback dominates (exactly the expected thin-data behaviour).",
    "Snapshot ALIGNMENT guard: the PG cross-section is taken at the modal snapshot (FY26 / FY26Q4); any member whose latest standalone snapshot differs is marked missing (not silently scored at a different period). All 10 pharma aligned this run.",
    "NEUTRAL-HOLD is built (buildNeutralHold) but NEVER fired here — it is banking-only (CASA/Tier-1). Non-financial metrics only ever go scored / missing_renorm / (future) suppressed.",
  ]) console.log("  • " + fl + "\n");

  await prisma.$disconnect();
  if (!allPass) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
