// Verification harness for the SNAPSHOT-LEVEL COMPOSITE — the convergence point.
// For ONE peer group (Large-Cap Pharma) it computes all FOUR real pillars at a
// recent snapshot (Foundation/Momentum on illustrative bars, Market on the UNIVERSAL
// mechanism, Ownership full Primary+Flow+clamp), blends them into the Health Score,
// labels it, and assembles the complete ScoreSnapshot. DRY-RUN: commits NOTHING.
//
//   npx tsx src/scripts/composite-check.ts
//
// ⚠ Foundation/Momentum numbers are on ILLUSTRATIVE bars → not final.
// Market uses the real universal mechanism (orchestrate → universal-subcomponents →
// market-universal → §14.4 cascade). The CHAIN is what is proven:
// four pillars → blend → §14.4 redistribution → label → snapshot.

import { prisma } from "../db/prisma.js";
// Foundation / Momentum
import { loadFoundationStandalone, loadMomentumStandalone } from "../scoring/metrics/load.js";
import { computeFoundation } from "../scoring/metrics/foundation.js";
import { computeMomentum } from "../scoring/metrics/momentum.js";
import type { MetricValue } from "../scoring/metrics/types.js";
import { scoreMetricCrossSection, type CrossSectionInput, type CrossSectionMember } from "../scoring/metric-scoring/wire.js";
import { ILLUSTRATIVE_BARS } from "../scoring/metric-scoring/illustrative-bars.js";
import { NO_SUPPRESSION, type WiringConfig, type ScoredMetric } from "../scoring/metric-scoring/types.js";
import { assemblePillar } from "../scoring/pillars/assemble.js";
import type { PillarScoreResult } from "../scoring/pillars/types.js";
// Market — UNIVERSAL mechanism
import { scoreMarketForPg } from "../scoring/market/orchestrate.js";
// Ownership
import { computeOwnership, type OwnershipContext } from "../scoring/ownership/ownership.js";
import type { OwnershipQuarter } from "../scoring/ownership/types.js";
import type { A1PriceEval, FlowFeeds, PriceProbe } from "../scoring/ownership/flow.js";
import { rangePositionAsOf, MIN_TRAILING_DAYS, type DailyClose } from "../scoring/price/range.js";
// Composite
import { assembleComposite } from "../scoring/composite/composite.js";
import { writeComposite } from "../scoring/composite/persist.js";
import { labelFor } from "../scoring/composite/label.js";
import type { CompositeResult, Pillar, PillarInput } from "../scoring/composite/types.js";

const PG_NAME = "Large-Cap Pharma";
const FOUNDATION_KEYS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10"];
const MOMENTUM_KEYS = ["M1", "M2", "M3", "M4", "M5"];
const FOUNDATION_CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const MOMENTUM_CFG: WiringConfig = { peerMinN: 5, l3MinN: 6, l3Window: 12 };
const DORMANT_FEEDS: FlowFeeds = { insiderTxns: null, blockTxns: null, marketCapInrCr: null };

const f2 = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));
const modal = (xs: string[]): string => {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
};

// ── Foundation/Momentum helpers ───────────────────────────────────────────────
interface MemberData { stockId: string; symbol: string; fSnap: ReturnType<typeof computeFoundation>; fSeries: Map<string, number[]>; mSnap: ReturnType<typeof computeMomentum>; mSeries: Map<string, number[]>; }
function foundationSeries(rows: Awaited<ReturnType<typeof loadFoundationStandalone>>): Map<string, number[]> {
  const sorted = [...rows].sort((a, b) => a.fyOrdinal - b.fyOrdinal); const series = new Map<string, number[]>();
  for (let i = 0; i < sorted.length; i++) { const res = computeFoundation(sorted.slice(0, i + 1)); if (!res) continue; for (const m of res.metrics) { if (!series.has(m.key)) series.set(m.key, []); if (m.available && m.value !== null) series.get(m.key)!.push(m.value); } }
  return series;
}
function momentumSeries(rows: Awaited<ReturnType<typeof loadMomentumStandalone>>): Map<string, number[]> {
  const sorted = [...rows].sort((a, b) => a.qOrdinal - b.qOrdinal); const series = new Map<string, number[]>();
  for (let i = 0; i < sorted.length; i++) { const res = computeMomentum(sorted.slice(0, i + 1)); if (!res) continue; for (const m of res.metrics) { if (!series.has(m.key)) series.set(m.key, []); if (m.available && m.value !== null) series.get(m.key)!.push(m.value); } }
  return series;
}
function buildMembers(data: MemberData[], key: string, snap: (d: MemberData) => MetricValue | null, series: (d: MemberData) => number[], snapMatches: (d: MemberData) => boolean): CrossSectionMember[] {
  return data.map((d) => { const mv = snap(d); const aligned = snapMatches(d); const available = aligned && !!mv && mv.available; return { stockId: d.stockId, symbol: d.symbol, rawValue: available ? mv!.value : null, available, unavailableReason: available ? null : !aligned ? "snapshot misaligned" : (mv?.reason ?? "no row"), ownHistoryValues: series(d) }; });
}
function scorePillarMetrics(data: MemberData[], keys: string[], pillar: "foundation" | "momentum", snap: (d: MemberData, k: string) => MetricValue | null, series: (d: MemberData, k: string) => number[], snapMatches: (d: MemberData) => boolean, snapshot: string, cfg: WiringConfig, labelOf: (k: string) => string): Map<string, ScoredMetric[]> {
  const byStock = new Map<string, ScoredMetric[]>(); for (const d of data) byStock.set(d.stockId, []);
  for (const key of keys) { const bars = ILLUSTRATIVE_BARS[key]; const members = buildMembers(data, key, (d) => snap(d, key), (d) => series(d, key), snapMatches); const input: CrossSectionInput = { pillar, metricKey: key, label: labelOf(key), snapshot, direction: bars.direction, bars: bars.bars, barNote: bars.note, members, suppression: NO_SUPPRESSION, config: cfg }; const xs = scoreMetricCrossSection(input); for (const s of xs.scored) byStock.get(s.stockId)!.push(s); }
  return byStock;
}

// ── Ownership helpers ─────────────────────────────────────────────────────────
const num = (d: unknown): number | null => d === null || d === undefined ? null : typeof d === "number" ? d : typeof (d as { toNumber?: () => number }).toNumber === "function" ? (d as { toNumber: () => number }).toNumber() : Number(d);
function rowToQuarter(r: any): OwnershipQuarter { return { asOnDate: r.asOnDate, quarter: r.quarter, fiscalYear: r.fiscalYear, promoterShares: r.promoterShares, totalShares: r.totalShares, pledgedShares: r.pledgedShares, promoterPct: num(r.promoterPct), fiiPct: num(r.fiiPct), diiPct: num(r.diiPct), retailPct: num(r.retailPct) }; }
function makePriceProbe(series: DailyClose[]): PriceProbe {
  return (priorExcl: Date, currentIncl: Date): A1PriceEval => {
    const windowDays = series.filter((s) => s.date > priorExcl && s.date <= currentIncl); let assessedAny = false;
    for (const d of windowDays) { const rp = rangePositionAsOf(series, d.date); if (rp.trailingDays < MIN_TRAILING_DAYS) continue; assessedAny = true; if (rp.position === null) continue; if (rp.position <= 0.25) return { available: true, dipTouched: true, touchedOn: d.date.toISOString().slice(0, 10), positionAtTouch: rp.position, windowStartExclusive: priorExcl.toISOString().slice(0, 10), windowEndInclusive: currentIncl.toISOString().slice(0, 10) }; }
    return { available: assessedAny, dipTouched: false, touchedOn: null, positionAtTouch: null, windowStartExclusive: priorExcl.toISOString().slice(0, 10), windowEndInclusive: currentIncl.toISOString().slice(0, 10) };
  };
}
async function loadDailySeries(stockId: string): Promise<DailyClose[]> {
  const daily = await prisma.dailyPrice.findMany({ where: { stockId }, orderBy: { date: "asc" }, select: { date: true, close: true } });
  return daily.map((d) => ({ date: d.date, close: Number(d.close) }));
}

const pillarInput = (pillar: Pillar, subtotal: number | null, state: "scored" | "unavailable_redistributed", sourcePeriod: string): PillarInput => ({ pillar, subtotal, state, sourcePeriod });

function printComposite(r: CompositeResult): void {
  const w = r.appliedWeights;
  const ps = (p: Pillar) => { const pi = r.pillars.find((x) => x.pillar === p)!; return pi.state === "scored" && pi.subtotal !== null ? pi.subtotal.toFixed(1) : "n/a"; };
  const head = r.state === "scored" ? `${r.compositeRounded} (${r.composite!.toFixed(2)}) ${r.labelText}` : `UNAVAILABLE (${r.unavailableReason})`;
  console.log(`  ${r.symbol.padEnd(12)} F=${ps("foundation").padStart(5)} M=${ps("momentum").padStart(5)} Mkt=${ps("market").padStart(5)} Own=${ps("ownership").padStart(5)}  |  w[${(w.foundation * 100).toFixed(1)}/${(w.momentum * 100).toFixed(1)}/${(w.market * 100).toFixed(1)}/${(w.ownership * 100).toFixed(1)}]  →  ${head}`);
}

async function main() {
  const pg = await prisma.peerGroup.findFirst({ where: { name: PG_NAME }, include: { stocks: { include: { stock: true } } } });
  if (!pg) { console.log(`PG "${PG_NAME}" not found`); await prisma.$disconnect(); return; }
  console.log(`${"═".repeat(124)}\nSNAPSHOT COMPOSITE — PG: ${PG_NAME} (${pg.stocks.length} members)`);
  console.log(`⚠ DRY-RUN; illustrative Foundation/Momentum bars; universal Market (real). Weights F .35 / M .25 / Mkt .20 / Own .20.`);

  // ── Foundation + Momentum ──
  const data: MemberData[] = [];
  for (const sp of pg.stocks) {
    const fRows = await loadFoundationStandalone(sp.stock.id); const qRows = await loadMomentumStandalone(sp.stock.id);
    data.push({ stockId: sp.stock.id, symbol: sp.stock.symbol, fSnap: computeFoundation(fRows), fSeries: foundationSeries(fRows), mSnap: computeMomentum(qRows), mSeries: momentumSeries(qRows) });
  }
  const fSnapFy = modal(data.map((d) => d.fSnap?.snapshotFy ?? "").filter(Boolean));
  const mSnapQ = modal(data.map((d) => d.mSnap?.snapshotQuarter ?? "").filter(Boolean));
  const fLabel = (k: string) => data[0].fSnap?.metrics.find((m) => m.key === k)?.label ?? k;
  const mLabel = (k: string) => data[0].mSnap?.metrics.find((m) => m.key === k)?.label ?? k;
  const fByStock = scorePillarMetrics(data, FOUNDATION_KEYS, "foundation", (d, k) => d.fSnap?.metrics.find((m) => m.key === k) ?? null, (d, k) => d.fSeries.get(k) ?? [], (d) => d.fSnap?.snapshotFy === fSnapFy, fSnapFy, FOUNDATION_CFG, fLabel);
  const mByStock = scorePillarMetrics(data, MOMENTUM_KEYS, "momentum", (d, k) => d.mSnap?.metrics.find((m) => m.key === k) ?? null, (d, k) => d.mSeries.get(k) ?? [], (d) => d.mSnap?.snapshotQuarter === mSnapQ, mSnapQ, MOMENTUM_CFG, mLabel);
  const fPillar = new Map<string, PillarScoreResult>(); const mPillar = new Map<string, PillarScoreResult>();
  for (const d of data) {
    fPillar.set(d.stockId, assemblePillar({ pillar: "foundation", stockId: d.stockId, symbol: d.symbol, snapshot: fSnapFy, metrics: fByStock.get(d.stockId)! }));
    mPillar.set(d.stockId, assemblePillar({ pillar: "momentum", stockId: d.stockId, symbol: d.symbol, snapshot: mSnapQ, metrics: mByStock.get(d.stockId)! }));
  }

  // ── Market — UNIVERSAL mechanism ──
  const pgMkt = await scoreMarketForPg(PG_NAME);
  const mktBySym = new Map((pgMkt?.members ?? []).map((m) => [m.symbol, m.result]));
  const asOf = pgMkt?.asOf ?? new Date(0);
  console.log(`  Market: universal mechanism asOf=${asOf.toISOString().slice(0, 10)}, sector1yr median=${pgMkt?.sectorMedian1yr?.toFixed(1) ?? "—"}%, baselineVol=${pgMkt?.sectorBaselineVol != null ? (pgMkt.sectorBaselineVol * 100).toFixed(1) + "%" : "—"} (pool n=${pgMkt?.poolN ?? 0})`);

  // ── Ownership ──
  const ownPillar = new Map<string, ReturnType<typeof computeOwnership>>();
  for (const d of data) {
    const rows = (await prisma.shareholdingPattern.findMany({ where: { stockId: d.stockId }, orderBy: { asOnDate: "asc" }, select: { asOnDate: true, quarter: true, fiscalYear: true, promoterShares: true, totalShares: true, pledgedShares: true, promoterPct: true, fiiPct: true, diiPct: true, retailPct: true } })).map(rowToQuarter);
    if (rows.length === 0) { ownPillar.set(d.stockId, null); continue; }
    const priceSeries = await loadDailySeries(d.stockId);
    const probe = makePriceProbe(priceSeries);
    const ctx: OwnershipContext = { priceProbe: probe, feeds: DORMANT_FEEDS };
    ownPillar.set(d.stockId, computeOwnership(d.symbol, rows, ctx));
  }

  // ── Build composites ──
  const periodKey = mSnapQ || fSnapFy || "FY26Q4";
  const composites: CompositeResult[] = data.map((d) => {
    const f = fPillar.get(d.stockId)!; const m = mPillar.get(d.stockId)!;
    const mr = mktBySym.get(d.symbol);
    const mktSub = mr && mr.state === "scored" ? mr.subtotal : null;
    const ow = ownPillar.get(d.stockId);
    const pillars: PillarInput[] = [
      pillarInput("foundation", f.subtotal, f.pillarState, f.snapshot),
      pillarInput("momentum", m.subtotal, m.pillarState, m.snapshot),
      pillarInput("market", mktSub, mktSub != null ? "scored" : "unavailable_redistributed", mktSub != null ? "PRICE" : "MARKET_EXCLUDED"),
      pillarInput("ownership", ow ? ow.finalOwnership : null, ow ? "scored" : "unavailable_redistributed", ow?.snapshot.periodKey ?? "—"),
    ];
    return assembleComposite(d.stockId, d.symbol, pillars, { snapshotType: "quarterly", periodKey, asOfDate: asOf });
  });

  // ── HEALTH SCORE TABLE ──
  console.log(`\n${"─".repeat(124)}\nHEALTH SCORE — snapshot ${periodKey} @ ${asOf.toISOString().slice(0, 10)} (F=${fSnapFy} M=${mSnapQ} Mkt-price Own-quarterly)\n`);
  for (const r of [...composites].sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1))) printComposite(r);

  // ── HAND-VERIFY ──
  console.log(`\n${"═".repeat(124)}\nHAND-VERIFIED BLEND — top stock\n`);
  {
    const r = [...composites].filter((c) => c.state === "scored").sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0))[0];
    const g = (p: Pillar) => r.pillars.find((x) => x.pillar === p)!.subtotal as number;
    const w = r.appliedWeights;
    const terms = (["foundation", "momentum", "market", "ownership"] as Pillar[]).map((p) => `${w[p].toFixed(4)}·${g(p).toFixed(2)}`);
    const hand = (["foundation", "momentum", "market", "ownership"] as Pillar[]).reduce((a, p) => a + w[p] * g(p), 0);
    console.log(`  ${r.symbol}: ${terms.join(" + ")}`);
    console.log(`           = ${hand.toFixed(4)}  vs assembled ${r.composite!.toFixed(4)}  →  ${Math.abs(hand - r.composite!) < 1e-9 ? "✓ MATCH" : "✗ MISMATCH"}`);
    console.log(`  label: composite ${r.composite!.toFixed(2)} → ${r.labelText} (band cut: ${r.composite! < 55 ? "<55" : r.composite! < 62 ? "[55,62)" : r.composite! < 68 ? "[62,68)" : r.composite! < 74 ? "[68,74)" : "≥74"})`);
    console.log(`  divergence (Market − non-market blend): ${f2(r.divergence)}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(124)}\nTARGETED VERIFICATIONS\n`);
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const subject = composites.find((c) => c.state === "scored")!;
  const basePillars = subject.pillars.map((p) => ({ ...p }));
  const reassemble = (pillars: PillarInput[]) => assembleComposite(subject.stockId, subject.symbol, pillars, { snapshotType: "quarterly", periodKey, asOfDate: asOf });

  // (a) §14.4 Market-unavailable → F .4375 / M .3125 / Own .25, reason market_unavailable
  {
    const pillars = basePillars.map((p) => p.pillar === "market" ? { ...p, subtotal: null, state: "unavailable_redistributed" as const } : p);
    const r = reassemble(pillars); const w = r.appliedWeights;
    const ok = Math.abs(w.foundation - 0.4375) < 1e-9 && Math.abs(w.momentum - 0.3125) < 1e-9 && Math.abs(w.ownership - 0.25) < 1e-9 && w.market === 0 && r.redistributionReason === "market_unavailable";
    const g = (p: Pillar) => basePillars.find((x) => x.pillar === p)!.subtotal as number;
    const expected = 0.4375 * g("foundation") + 0.3125 * g("momentum") + 0.25 * g("ownership");
    checks.push({ name: "(a) §14.4 Market unavailable → F .4375 / M .3125 / Own .25 (FY21/FY22 case)", ok: ok && Math.abs((r.composite ?? NaN) - expected) < 1e-9, detail: `w=[${w.foundation.toFixed(4)},${w.momentum.toFixed(4)},${w.market},${w.ownership.toFixed(4)}] reason=${r.redistributionReason} composite=${r.composite?.toFixed(4)} (=${expected.toFixed(4)})` });
  }

  // (b) general redistribution — Momentum unavailable → reason missing_pillar, proportions preserved
  {
    const pillars = basePillars.map((p) => p.pillar === "momentum" ? { ...p, subtotal: null, state: "unavailable_redistributed" as const } : p);
    const r = reassemble(pillars); const w = r.appliedWeights;
    const ok = Math.abs(w.foundation - 0.35 / 0.75) < 1e-9 && Math.abs(w.market - 0.2 / 0.75) < 1e-9 && Math.abs(w.ownership - 0.2 / 0.75) < 1e-9 && w.momentum === 0 && r.redistributionReason === "missing_pillar";
    const ratioPreserved = Math.abs((w.foundation / w.market) - (0.35 / 0.2)) < 1e-9;
    checks.push({ name: "(b) general redistribution: Momentum unavailable → missing_pillar, relative proportions preserved", ok: ok && ratioPreserved, detail: `w=[${w.foundation.toFixed(4)},0,${w.market.toFixed(4)},${w.ownership.toFixed(4)}] reason=${r.redistributionReason}; F/Mkt ratio ${(w.foundation / w.market).toFixed(4)}==1.75` });
  }

  // (c) minimum-pillars: Foundation (anchor) unavailable → composite UNAVAILABLE
  {
    const pillars = basePillars.map((p) => p.pillar === "foundation" ? { ...p, subtotal: null, state: "unavailable_redistributed" as const } : p);
    const r = reassemble(pillars);
    checks.push({ name: "(c) min-pillars: Foundation (anchor) unavailable → composite UNAVAILABLE (not fabricated)", ok: r.state === "unavailable" && r.composite === null, detail: `state=${r.state} composite=${r.composite}; reason: ${r.unavailableReason}` });
  }

  // (c2) minimum-pillars: only Foundation survives (<2) → composite UNAVAILABLE
  {
    const pillars = basePillars.map((p) => p.pillar === "foundation" ? p : { ...p, subtotal: null, state: "unavailable_redistributed" as const });
    const r = reassemble(pillars);
    checks.push({ name: "(c2) min-pillars: only Foundation survives (<2) → composite UNAVAILABLE", ok: r.state === "unavailable" && r.composite === null, detail: `surviving=[${r.survivingPillars.join(",")}] state=${r.state}; reason: ${r.unavailableReason}` });
  }

  // (d) label boundary handling (lower-bound-inclusive, on full precision)
  {
    const cases: [number, string][] = [[54.99, "fragile"], [54.7, "fragile"], [55, "below_par"], [61.7, "below_par"], [61.99, "below_par"], [62, "steady"], [68, "healthy"], [73.99, "healthy"], [74, "pristine"], [90, "pristine"]];
    const ok = cases.every(([v, b]) => labelFor(v).band === b);
    checks.push({ name: "(d) label boundary: <55 fragile, [55,62) below_par, [62,68) steady, [68,74) healthy, ≥74 pristine", ok, detail: cases.map(([v, b]) => `${v}→${labelFor(v).band}${labelFor(v).band === b ? "" : "✗"}`).join(" ") });
  }

  // (e) DRY-RUN: snapshot write plan produced, references 4 pillar FKs, commits NOTHING
  {
    const before = { snap: await prisma.scoreSnapshot.count(), run: await prisma.scoringRun.count(), pillar: await prisma.pillarScore.count(), flag: await prisma.redFlag.count() };
    const ow = ownPillar.get(subject.stockId);
    const r1Fired = !!ow?.primary.redFlags.find((f) => f.flagKey === "ownership_R1_pledge");
    const plan = await writeComposite(subject, { peerGroupId: pg.id, barPath: pg.id, industryPath: "non_financial", asOfDate: asOf, dryRun: true, pillarScoreIds: { foundation: null, momentum: null, market: null, ownership: null }, r1: { fired: r1Fired, triggeringValues: null } });
    const after = { snap: await prisma.scoreSnapshot.count(), run: await prisma.scoringRun.count(), pillar: await prisma.pillarScore.count(), flag: await prisma.redFlag.count() };
    const unchanged = before.snap === after.snap && before.run === after.run && before.pillar === after.pillar && before.flag === after.flag;
    const hasAllFks = !!plan.snapshotRow && !!plan.snapshotRow.foundationPillarId && !!plan.snapshotRow.momentumPillarId && !!plan.snapshotRow.marketPillarId && !!plan.snapshotRow.ownershipPillarId;
    checks.push({ name: "(e) DRY-RUN: snapshot planned with 4 pillar FKs; tables UNCHANGED (commits nothing)", ok: unchanged && hasAllFks && plan.action.startsWith("would"), detail: `action=${plan.action}; rows snap ${before.snap}→${after.snap} run ${before.run}→${after.run} pillar ${before.pillar}→${after.pillar}; 4 FKs present=${hasAllFks}` });
    console.log(`  [snapshot write plan — ${subject.symbol}]:`);
    console.log(`    composite=${plan.snapshotRow?.composite} band=${plan.snapshotRow?.labelBand} w=[${plan.snapshotRow?.wFoundation}/${plan.snapshotRow?.wMomentum}/${plan.snapshotRow?.wMarket}/${plan.snapshotRow?.wOwnership}] reason=${plan.snapshotRow?.weightRedistributionReason} fp=${plan.inputsFingerprint?.slice(0, 12)}…`);
    for (const n of plan.notes) console.log(`    • ${n}`);
  }

  for (const c of checks) console.log(`  ${c.ok ? "✓ PASS" : "✗ FAIL"}  ${c.name}\n           ${c.detail}`);
  const allPass = checks.every((c) => c.ok);
  console.log(`\n  ${allPass ? "✓ ALL TARGETED CHECKS PASS" : "✗ A CHECK FAILED"}\n`);

  // ── distribution of labels + redistribution reasons on the live PG ──
  console.log(`${"═".repeat(124)}\nLIVE PG DISTRIBUTION\n`);
  const tally = (xs: string[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return [...m.entries()].map(([k, v]) => `${k}:${v}`).join("  "); };
  console.log(`  labels:        ${tally(composites.filter((c) => c.state === "scored").map((c) => c.labelBand!))}`);
  console.log(`  redistribution:${tally(composites.map((c) => c.redistributionReason))}`);
  console.log(`  unavailable composites: ${composites.filter((c) => c.state === "unavailable").length}`);

  await prisma.$disconnect();
  if (!allPass) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
