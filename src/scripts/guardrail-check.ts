// Verification harness for the GUARDRAIL LAYER (Layer 1) — proves the framework
// SPINE + the ONE wired signature (A-2 Missing Critical Fields) + the load-bearing
// DUAL-EXCLUSION seam end-to-end on REAL scoring. DRY-RUN: computes + plans, commits
// nothing (the standing gate holds until Phase-6 real bars).
//
//   npx tsx src/scripts/guardrail-check.ts
//
// PG = Large-Cap Pharma (10 members, real standalone FY26 → a genuine N=10 F1 ROCE
// cross-section that exercises Lens 2). Two demonstrations:
//
//   PART 1 — A-2 (the chosen Category-A AUTO signature), real detection. Fired on a
//     SYNTHETIC null-field fixture (loudly marked): O2 when a few metrics drop, O5
//     Hold when too many do. Shows gate → outcome → directive + audit, dry-run plan.
//
//   PART 2 — THE DUAL-EXCLUSION SEAM, on a PRESENT value (the whole point). A-2's
//     own O2 suppresses a MISSING value, so it cannot move a peer mean (a null was
//     never in it). The peer-μ half of the seam is what Category-B distortion
//     signatures will drive on PRESENT, distorted values — identical row, identical
//     consumer. So we drive ONE O2 directive (via the REAL resolveOutcome + adapter
//     + UNCHANGED wire.ts) on LUPIN's present F1 ROCE and show BOTH halves move on
//     real scoring, hand-verifying the peer-μ change.

import { prisma } from "../db/prisma.js";
import { loadFoundationStandalone } from "../scoring/metrics/load.js";
import { computeFoundation } from "../scoring/metrics/foundation.js";
import { netWorthFrom } from "../scoring/metrics/types.js";
import type { MetricValue } from "../scoring/metrics/types.js";
import { scoreMetricCrossSection, type CrossSectionInput, type CrossSectionMember } from "../scoring/metric-scoring/wire.js";
import { ILLUSTRATIVE_BARS } from "../scoring/metric-scoring/illustrative-bars.js";
import { NO_SUPPRESSION, type WiringConfig, type ScoredMetric } from "../scoring/metric-scoring/types.js";
import { computeLens2 } from "../scoring/lenses/lens-zscore.js";
import { assemblePillar } from "../scoring/pillars/assemble.js";
// ── the guardrail layer under test ──
import { runGuardrailGate } from "../scoring/guardrail/gate.js";
import { resolveOutcome } from "../scoring/guardrail/outcomes.js";
import { toSuppressionPredicate, suppressedPairs } from "../scoring/guardrail/suppression-adapter.js";
import { writeGuardrailEval } from "../scoring/guardrail/persist.js";
import { registryCoverage } from "../scoring/guardrail/signatures/registry.js";
import type { GuardrailStockInput, SignatureResult, GuardrailEvalResult } from "../scoring/guardrail/types.js";

const PG_NAME = "Large-Cap Pharma";
const FOUNDATION_KEYS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10"];
const FOUNDATION_CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const SNAPSHOT_KEY = "FY26Q4"; // the run's periodKey (the score_suppressions snapshot_key)

const f2 = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));
const modal = (xs: string[]): string => { const c = new Map<string, number>(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""; };

interface MemberData { stockId: string; symbol: string; fSnap: ReturnType<typeof computeFoundation>; fSeries: Map<string, number[]>; }
function foundationSeries(rows: Awaited<ReturnType<typeof loadFoundationStandalone>>): Map<string, number[]> {
  const sorted = [...rows].sort((a, b) => a.fyOrdinal - b.fyOrdinal); const series = new Map<string, number[]>();
  for (let i = 0; i < sorted.length; i++) { const res = computeFoundation(sorted.slice(0, i + 1)); if (!res) continue; for (const m of res.metrics) { if (!series.has(m.key)) series.set(m.key, []); if (m.available && m.value !== null) series.get(m.key)!.push(m.value); } }
  return series;
}
function buildMembers(data: MemberData[], key: string, fSnapFy: string): CrossSectionMember[] {
  return data.map((d) => {
    const mv: MetricValue | null = d.fSnap?.metrics.find((m) => m.key === key) ?? null;
    const aligned = d.fSnap?.snapshotFy === fSnapFy;
    const available = aligned && !!mv && mv.available;
    return { stockId: d.stockId, symbol: d.symbol, rawValue: available ? mv!.value : null, available, unavailableReason: available ? null : !aligned ? "snapshot misaligned" : (mv?.reason ?? "no row"), ownHistoryValues: d.fSeries.get(key) ?? [] };
  });
}
/** Score the whole Foundation pillar for the PG under a given suppression predicate,
 *  returning each stock's 10 ScoredMetrics. The predicate is the ONLY thing that
 *  changes between baseline and suppressed runs — proving the seam. */
function scoreFoundation(data: MemberData[], fSnapFy: string, suppression: typeof NO_SUPPRESSION): Map<string, ScoredMetric[]> {
  const byStock = new Map<string, ScoredMetric[]>(); for (const d of data) byStock.set(d.stockId, []);
  for (const key of FOUNDATION_KEYS) {
    const bars = ILLUSTRATIVE_BARS[key];
    const members = buildMembers(data, key, fSnapFy);
    const input: CrossSectionInput = { pillar: "foundation", metricKey: key, label: key, snapshot: fSnapFy, direction: bars.direction, bars: bars.bars, barNote: bars.note, members, suppression, config: FOUNDATION_CFG };
    for (const s of scoreMetricCrossSection(input).scored) byStock.get(s.stockId)!.push(s);
  }
  return byStock;
}

async function main() {
  const pg = await prisma.peerGroup.findFirst({ where: { name: PG_NAME }, include: { stocks: { include: { stock: true } } } });
  if (!pg) { console.log(`PG "${PG_NAME}" not found`); await prisma.$disconnect(); return; }

  console.log(`${"═".repeat(118)}\nGUARDRAIL LAYER (Layer 1) — PG: ${PG_NAME} (${pg.stocks.length} members)`);
  console.log(`⚠ DRY-RUN; Foundation on ILLUSTRATIVE bars (numbers throwaway — the SEAM is what's proven). snapshot_key=${SNAPSHOT_KEY}`);
  const cov = registryCoverage();
  console.log(`Signature registry: BUILT [${cov.built.join(", ")}] · declared-not-built [${cov.declared.join(", ")}]`);

  // Load real Foundation data for the PG.
  const data: MemberData[] = [];
  for (const sp of pg.stocks) {
    const fRows = await loadFoundationStandalone(sp.stock.id);
    data.push({ stockId: sp.stock.id, symbol: sp.stock.symbol, fSnap: computeFoundation(fRows), fSeries: foundationSeries(fRows) });
  }
  const fSnapFy = modal(data.map((d) => d.fSnap?.snapshotFy ?? "").filter(Boolean));
  const bySym = (s: string) => data.find((d) => d.symbol === s)!;

  const checks: { name: string; ok: boolean; detail: string }[] = [];

  // ════════════════════════════════════════════════════════════════════════════
  // PART 1 — A-2 (the chosen Category-A AUTO signature) end-to-end
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(118)}\nPART 1 — SIGNATURE A-2 (Missing Critical Fields · Category A · AUTO · O2/O5)\n`);

  // 1a. O2 case — netWorth null on ONE stock (SYNTHETIC fixture, loudly marked).
  const o2Stock = bySym("AUROPHARMA");
  const o2Input: GuardrailStockInput = {
    stockId: o2Stock.stockId, symbol: o2Stock.symbol, industryPath: "non_financial", snapshotKey: SNAPSHOT_KEY,
    latestFundamental: { fiscalYear: fSnapFy, revenue: 30000, netProfit: 3000, netWorth: null /* ◀ SYNTHETIC null */, totalAssets: 40000 },
  };
  console.log(`  [SYNTHETIC] ${o2Stock.symbol}: latest Fundamental has netWorth=null (revenue/netProfit/totalAssets present)`);
  const o2Eval = runGuardrailGate(o2Input);
  const o2Evt = o2Eval.events[0];
  console.log(`  gate → A-2 ${o2Evt ? `FIRED outcome=${o2Evt.outcome} tier=${o2Evt.tier}` : "did not fire"}`);
  console.log(`  affected metrics (fixed map): ${suppressedPairs(o2Eval.directives, SNAPSHOT_KEY).map((p) => `${p.metricKey}[own=${p.own},peer=${p.peer}]`).join("  ")}`);
  console.log(`  audit triggeringValues: ${JSON.stringify(o2Evt?.triggeringValues)}`);
  {
    const pairs = suppressedPairs(o2Eval.directives, SNAPSHOT_KEY);
    const metricSet = new Set(pairs.map((p) => p.metricKey));
    const ok = o2Evt?.outcome === "O2" && metricSet.has("F1") && metricSet.has("F2") && metricSet.has("F4") && pairs.length === 3 && pairs.every((p) => p.own && p.peer);
    checks.push({ name: "(1a) A-2 netWorth-null → O2, suppresses {F1,F2,F4}, each row own+peer=true (dual-exclusion default)", ok, detail: `outcome=${o2Evt?.outcome} metrics={${[...metricSet].join(",")}} count=${pairs.length}` });
  }

  // 1b. O5 case — all four critical fields null → Foundation floor breaks → Hold.
  const o5Stock = bySym("DRREDDY");
  const o5Input: GuardrailStockInput = {
    stockId: o5Stock.stockId, symbol: o5Stock.symbol, industryPath: "non_financial", snapshotKey: SNAPSHOT_KEY,
    latestFundamental: { fiscalYear: fSnapFy, revenue: null, netProfit: null, netWorth: null, totalAssets: null },
  };
  console.log(`\n  [SYNTHETIC] ${o5Stock.symbol}: latest Fundamental has ALL FOUR critical fields null`);
  const o5Eval = runGuardrailGate(o5Input);
  const o5Evt = o5Eval.events[0];
  console.log(`  gate → A-2 ${o5Evt ? `FIRED outcome=${o5Evt.outcome} tier=${o5Evt.tier}` : "did not fire"}  · stockActions=[${o5Eval.stockActions.map((a) => a.kind).join(",")}]  · suppressions=${o5Eval.directives.length}`);
  console.log(`  hold reason: "${o5Eval.stockActions[0]?.reason ?? "—"}"`);
  {
    const fv = o5Evt?.triggeringValues as { foundationPresentAfter?: number } | undefined;
    const ok = o5Evt?.outcome === "O5" && o5Eval.directives.length === 0 && o5Eval.stockActions[0]?.kind === "hold" && (fv?.foundationPresentAfter ?? 99) < 5;
    checks.push({ name: "(1b) A-2 all-4-null → O5 Hold (Foundation <50% present), 0 suppressions, whole-stock hold action", ok, detail: `outcome=${o5Evt?.outcome} foundationPresentAfter=${fv?.foundationPresentAfter} suppressions=${o5Eval.directives.length}` });
  }

  // 1c. cleared case — all fields present → O1, does not fire.
  const cleared = runGuardrailGate({ stockId: o2Stock.stockId, symbol: o2Stock.symbol, industryPath: "non_financial", snapshotKey: SNAPSHOT_KEY, latestFundamental: { fiscalYear: fSnapFy, revenue: 30000, netProfit: 3000, netWorth: 18000, totalAssets: 40000 } });
  checks.push({ name: "(1c) A-2 all fields present → does not fire (O1), no events/directives", ok: cleared.events.length === 0 && cleared.directives.length === 0, detail: `events=${cleared.events.length} directives=${cleared.directives.length} · note: ${cleared.notes[0]}` });

  // 1d. DRY-RUN persist plan for the A-2 O2 firing — rows shaped, tables UNCHANGED.
  console.log(`\n  ── DRY-RUN persist plan (A-2 O2 firing) ──`);
  {
    const before = { evt: await prisma.guardrailEvent.count(), sup: await prisma.suppressionDirective.count() };
    const plan = await writeGuardrailEval([o2Eval], { snapshotIdByStock: null, dryRun: true });
    const after = { evt: await prisma.guardrailEvent.count(), sup: await prisma.suppressionDirective.count() };
    console.log(`    planned event rows: ${plan.eventRows.length}  ·  planned suppression rows: ${plan.suppressionRows.length}  ·  action=${plan.action}`);
    for (const e of plan.eventRows) console.log(`      EVENT  sig=${e.signatureKey} outcome=${e.outcome} tier=${e.tier} snapshotId=${e.snapshotId}`);
    for (const s of plan.suppressionRows) console.log(`      SUPPR  ${s.metricKey} key=${s.snapshotKey} own=${s.excludeFromOwnScore} peer=${s.excludeFromPeerMean} src=${s.sourceGuardrailEventId}`);
    for (const n of plan.notes) console.log(`      • ${n}`);
    const unchanged = before.evt === after.evt && before.sup === after.sup;
    checks.push({ name: "(1d) DRY-RUN: A-2 plan shapes 1 event + 3 suppression rows; tables UNCHANGED (commits nothing)", ok: unchanged && plan.eventRows.length === 1 && plan.suppressionRows.length === 3 && plan.action === "would_write_dry_run", detail: `rows evt ${before.evt}→${after.evt} sup ${before.sup}→${after.sup}; planned 1 evt / 3 supp` });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PART 2 — THE DUAL-EXCLUSION SEAM on a PRESENT value (LUPIN F1 ROCE)
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(118)}\nPART 2 — DUAL-EXCLUSION SEAM PROOF · subject LUPIN · metric F1 ROCE (present value)\n`);
  console.log(`  ⚠ SYNTHETIC O2 firing: A-2's own O2 suppresses a MISSING value (can't move a peer mean). To prove the`);
  console.log(`    peer-μ half — the half Category-B distortion signatures drive on PRESENT values — we route ONE O2`);
  console.log(`    directive through the REAL resolveOutcome → adapter → UNCHANGED wire.ts on LUPIN's present F1.`);

  const subject = bySym("LUPIN");
  // (a) Build the O2 directive via the REAL outcome-resolution code (stand-in for a B-1 firing).
  const synthResult: SignatureResult = {
    signatureKey: "B-1", category: "B", tier: "auto", fired: true, outcome: "O2",
    affectedMetrics: [{ metricKey: "F1", pillar: "foundation", reason: "SYNTHETIC distortion (stands in for exceptional-gain ROCE)" }],
    triggeringValues: { SYNTHETIC: true, note: "present-value O2 to prove the peer-μ seam", rawF1: bySym("LUPIN").fSnap?.metrics.find((m) => m.key === "F1")?.value },
    explanation: "SYNTHETIC: F1 ROCE excluded to demonstrate the dual-exclusion seam on a present value.",
  };
  const resolved = resolveOutcome(synthResult, { stockId: subject.stockId, snapshotKey: SNAPSHOT_KEY });
  const seamDirectives = resolved.directives;
  console.log(`\n  (a) directive written by resolveOutcome (the SINGLE score_suppressions row):`);
  for (const p of suppressedPairs(seamDirectives, SNAPSHOT_KEY)) console.log(`      stock=LUPIN metric=${p.metricKey} outcome=${p.outcome} excludeFromOwnScore=${p.own} excludeFromPeerMean=${p.peer}`);
  console.log(`      audit event: sig=${resolved.event.signatureKey} outcome=${resolved.event.outcome} tier=${resolved.event.tier}`);

  // Build the consumer predicate FROM THE ROW (proves the engine reads the row, not a hardcode).
  const predicate = toSuppressionPredicate(seamDirectives, SNAPSHOT_KEY);
  checks.push({ name: "(a) seam: predicate built from the directive row marks (LUPIN,F1) suppressed; (LUPIN,F2) & (SUNPHARMA,F1) not", ok: predicate(subject.stockId, "F1") === true && predicate(subject.stockId, "F2") === false && predicate(bySym("SUNPHARMA").stockId, "F1") === false, detail: `pred(LUPIN,F1)=${predicate(subject.stockId, "F1")} pred(LUPIN,F2)=${predicate(subject.stockId, "F2")} pred(SUNPHARMA,F1)=${predicate(bySym("SUNPHARMA").stockId, "F1")}` });

  // Score Foundation BOTH ways: baseline (NO_SUPPRESSION) and suppressed (row-derived predicate).
  const baseByStock = scoreFoundation(data, fSnapFy, NO_SUPPRESSION);
  const suppByStock = scoreFoundation(data, fSnapFy, predicate);

  // ── (b) LUPIN's OWN-SCORE exclusion: pillar recomputes WITHOUT F1, renormalized ──
  const lupinBasePillar = assemblePillar({ pillar: "foundation", stockId: subject.stockId, symbol: subject.symbol, snapshot: fSnapFy, metrics: baseByStock.get(subject.stockId)! });
  const lupinSuppPillar = assemblePillar({ pillar: "foundation", stockId: subject.stockId, symbol: subject.symbol, snapshot: fSnapFy, metrics: suppByStock.get(subject.stockId)! });
  const lupinBaseF1 = baseByStock.get(subject.stockId)!.find((m) => m.metricKey === "F1")!;
  const lupinSuppF1 = suppByStock.get(subject.stockId)!.find((m) => m.metricKey === "F1")!;
  const baseF1Contrib = lupinBasePillar.contributions.find((c) => c.metricKey === "F1")!;
  const suppF1Contrib = lupinSuppPillar.contributions.find((c) => c.metricKey === "F1")!;
  const survivorBase = lupinBasePillar.contributions.find((c) => c.metricKey === "F5")!;
  const survivorSupp = lupinSuppPillar.contributions.find((c) => c.metricKey === "F5")!;
  console.log(`\n  (b) OWN-SCORE exclusion — LUPIN Foundation pillar before → after:`);
  console.log(`      subtotal:        ${f2(lupinBasePillar.subtotal)}  →  ${f2(lupinSuppPillar.subtotal)}   (Δ=${f2((lupinSuppPillar.subtotal ?? 0) - (lupinBasePillar.subtotal ?? 0))})`);
  console.log(`      F1 disposition:  ${baseF1Contrib.disposition} (effW ${f2(baseF1Contrib.effectiveWeight)}%, contrib ${f2(baseF1Contrib.contribution)})  →  ${suppF1Contrib.disposition} (effW ${f2(suppF1Contrib.effectiveWeight)}%, contrib ${f2(suppF1Contrib.contribution)})`);
  console.log(`      survivor F5 effW: ${f2(survivorBase.effectiveWeight)}%  →  ${f2(survivorSupp.effectiveWeight)}%   (renormalized: present pool ${lupinBasePillar.presentCount}→${lupinSuppPillar.presentCount}, ${f2(100 / lupinBasePillar.presentCount)}%→${f2(100 / lupinSuppPillar.presentCount)}%)`);
  console.log(`      present count:   ${lupinBasePillar.presentCount}/10  →  ${lupinSuppPillar.presentCount}/10   (baseline already drops F10 as missing — pharma has no begin-year revenue; the guardrail O2 drop STACKS on it via the same renormalization)`);
  {
    // Renormalization invariant: each scored survivor sits at 100/presentCount (no cap
    // fires — F10, the only capped metric, is the missing one). The expected weight is
    // taken from the ACTUAL present counts, not a hardcode.
    const ok =
      baseF1Contrib.disposition === "scored" &&
      suppF1Contrib.disposition === "dropped" && suppF1Contrib.effectiveWeight === 0 &&
      lupinSuppPillar.presentCount === lupinBasePillar.presentCount - 1 &&
      Math.abs(survivorBase.effectiveWeight - 100 / lupinBasePillar.presentCount) < 1e-6 &&
      Math.abs(survivorSupp.effectiveWeight - 100 / lupinSuppPillar.presentCount) < 1e-6 &&
      lupinSuppPillar.subtotal !== lupinBasePillar.subtotal;
    checks.push({ name: "(b) OWN-SCORE: LUPIN F1 dropped (effW→0), survivors renormalize to 100/present (pool −1), pillar subtotal moves", ok, detail: `present ${lupinBasePillar.presentCount}→${lupinSuppPillar.presentCount}; subtotal ${f2(lupinBasePillar.subtotal)}→${f2(lupinSuppPillar.subtotal)}; F5 effW ${f2(survivorBase.effectiveWeight)}(=100/${lupinBasePillar.presentCount})→${f2(survivorSupp.effectiveWeight)}(=100/${lupinSuppPillar.presentCount})` });
  }

  // ── (c) PEER-SET exclusion: every OTHER peer's F1 μ/σ drops LUPIN; a peer's L2 moves ──
  // pull the F1 cross-section results (any non-LUPIN stock carries the peerStats).
  const peerProbe = bySym("SUNPHARMA");
  const probeBaseF1 = baseByStock.get(peerProbe.stockId)!.find((m) => m.metricKey === "F1")!;
  const probeSuppF1 = suppByStock.get(peerProbe.stockId)!.find((m) => m.metricKey === "F1")!;
  const psBase = probeBaseF1.peerStats!;
  const psSupp = probeSuppF1.peerStats!;
  console.log(`\n  (c) PEER-SET exclusion — F1 ROCE peer cross-section before → after (LUPIN dropped):`);
  console.log(`      peer N:   ${psBase.sampleN}  →  ${psSupp.sampleN}   (drops by one)`);
  console.log(`      peer μ:   ${f2(psBase.mean, 4)}  →  ${f2(psSupp.mean, 4)}`);
  console.log(`      peer σ:   ${f2(psBase.stdDev, 4)}  →  ${f2(psSupp.stdDev, 4)}`);
  console.log(`      ${peerProbe.symbol} (a peer) F1 L2: ${f2(probeBaseF1.l2Score, 4)} [Z=${f2(probeBaseF1.l2Z, 4)}]  →  ${f2(probeSuppF1.l2Score, 4)} [Z=${f2(probeSuppF1.l2Z, 4)}]`);
  console.log(`      LUPIN included in F1 peer-stats: ${lupinBaseF1.includedInPeerStats}  →  ${lupinSuppF1.includedInPeerStats}`);
  {
    const ok = psSupp.sampleN === psBase.sampleN - 1 && Math.abs(psSupp.mean - psBase.mean) > 1e-6 && probeBaseF1.l2Score !== probeSuppF1.l2Score && lupinSuppF1.includedInPeerStats === false;
    checks.push({ name: "(c) PEER-SET: F1 peer N 10→9, μ shifts, SUNPHARMA's L2/Z moves, LUPIN excluded from peer-stats", ok, detail: `N ${psBase.sampleN}→${psSupp.sampleN}; μ ${f2(psBase.mean, 4)}→${f2(psSupp.mean, 4)}; ${peerProbe.symbol} L2 ${f2(probeBaseF1.l2Score, 3)}→${f2(probeSuppF1.l2Score, 3)}` });
  }

  // ── (d) raw value STILL PRESENT, marked excluded — never hidden ──
  console.log(`\n  (d) TRANSPARENCY — LUPIN F1 score_metrics row after suppression:`);
  console.log(`      rawValue=${f2(lupinSuppF1.rawValue)} (PRESENT)  scoreState=${lupinSuppF1.scoreState}  includedInPeerStats=${lupinSuppF1.includedInPeerStats}  metricScore=${f2(lupinSuppF1.metricScore)}`);
  checks.push({ name: "(d) TRANSPARENCY: LUPIN F1 raw value still PRESENT (25.45), scoreState=suppressed, excluded from math not hidden", ok: lupinSuppF1.rawValue !== null && lupinSuppF1.scoreState === "suppressed" && lupinSuppF1.metricScore === null, detail: `raw=${f2(lupinSuppF1.rawValue)} state=${lupinSuppF1.scoreState} score=${f2(lupinSuppF1.metricScore)}` });

  // ── HAND-VERIFY the peer-μ change (the dual-exclusion proof, by arithmetic) ──
  console.log(`\n${"═".repeat(118)}\nHAND-VERIFIED PEER-μ CHANGE — F1 ROCE\n`);
  {
    const allF1 = data.map((d) => ({ sym: d.symbol, v: d.fSnap?.metrics.find((m) => m.key === "F1")?.value ?? null })).filter((x) => x.v !== null) as { sym: string; v: number }[];
    const all = allF1.map((x) => x.v);
    const lupinV = allF1.find((x) => x.sym === "LUPIN")!.v;
    const withLupin = all;
    const withoutLupin = all.filter((_, i) => allF1[i].sym !== "LUPIN");
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const muAll = mean(withLupin), muEx = mean(withoutLupin);
    console.log(`  all F1 ROCE (N=${withLupin.length}): [${withLupin.map((v) => v.toFixed(2)).join(", ")}]`);
    console.log(`  μ(all)            = Σ/${withLupin.length} = ${muAll.toFixed(4)}`);
    console.log(`  μ(excl LUPIN ${lupinV.toFixed(2)}) = Σ/${withoutLupin.length} = ${muEx.toFixed(4)}   ← peer mean the OTHER 9 are now scored against`);
    console.log(`  Δμ from dropping LUPIN's outlier = ${(muEx - muAll).toFixed(4)}`);
    // SUNPHARMA Z by hand against the EXCLUDED mean/σ, vs the wired L2.
    const sun = bySym("SUNPHARMA").fSnap!.metrics.find((m) => m.key === "F1")!.value!;
    const sigmaEx = Math.sqrt(withoutLupin.reduce((a, b) => a + (b - muEx) ** 2, 0) / withoutLupin.length);
    const zEx = (sun - muEx) / sigmaEx;
    const l2Ex = computeLens2({ value: sun, peerMean: muEx, peerStdDev: sigmaEx, direction: ILLUSTRATIVE_BARS.F1.direction, anchorLifted: probeSuppF1.l2AnchorFired });
    console.log(`  SUNPHARMA F1=${sun.toFixed(2)}: hand Z(excl) = (${sun.toFixed(2)}−${muEx.toFixed(2)})/${sigmaEx.toFixed(2)} = ${zEx.toFixed(4)}; hand L2 = ${l2Ex.score!.toFixed(4)}`);
    const muMatch = Math.abs(muEx - psSupp.mean) < 1e-9 && Math.abs(muAll - psBase.mean) < 1e-9;
    const l2Match = Math.abs(l2Ex.score! - (probeSuppF1.l2Score ?? NaN)) < 1e-9 && Math.abs(zEx - (probeSuppF1.l2Z ?? NaN)) < 1e-9;
    console.log(`  hand μ(excl) ${muEx.toFixed(4)} vs wired ${psSupp.mean.toFixed(4)} → ${muMatch ? "✓" : "✗"}   |   hand SUNPHARMA L2 ${l2Ex.score!.toFixed(4)} vs wired ${f2(probeSuppF1.l2Score, 4)} → ${l2Match ? "✓" : "✗"}`);
    checks.push({ name: "(hand) peer μ(excl LUPIN) == wired suppressed μ AND SUNPHARMA's hand L2/Z == wired L2/Z", ok: muMatch && l2Match, detail: `μ hand ${muEx.toFixed(4)}==wired ${psSupp.mean.toFixed(4)}; SUNPHARMA L2 hand ${l2Ex.score!.toFixed(4)}==wired ${f2(probeSuppF1.l2Score, 4)}` });
  }

  // ── CONFIRM: ONE row drives BOTH exclusions (not two mechanisms) ──
  console.log(`\n${"═".repeat(118)}\nSINGLE-SOURCE CONFIRMATION\n`);
  {
    // The SAME predicate object drove (b) own-score state AND (c) peer-stats exclusion inside ONE wire call.
    const ownExcluded = lupinSuppF1.scoreState === "suppressed";
    const peerExcluded = !lupinSuppF1.includedInPeerStats && psSupp.sampleN === psBase.sampleN - 1;
    console.log(`  one score_suppressions row (LUPIN,F1, own=true, peer=true) → predicate → wire.ts:`);
    console.log(`    • own-score exclusion (scoreState=suppressed):  ${ownExcluded ? "YES" : "NO"}`);
    console.log(`    • peer-set exclusion (dropped from μ/σ, N−1):   ${peerExcluded ? "YES" : "NO"}`);
    console.log(`  both halves from the SAME predicate built from the SAME row — CN-1 single source (no JSONB mirror).`);
    checks.push({ name: "(single-source) ONE row → BOTH exclusions via one predicate in one wire call (CN-1)", ok: ownExcluded && peerExcluded, detail: `own=${ownExcluded} peer=${peerExcluded}` });
  }

  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(118)}\nRESULTS\n`);
  for (const c of checks) console.log(`  ${c.ok ? "✓ PASS" : "✗ FAIL"}  ${c.name}\n           ${c.detail}`);
  const allPass = checks.every((c) => c.ok);
  console.log(`\n  ${allPass ? "✓ ALL CHECKS PASS" : "✗ A CHECK FAILED"}\n`);

  // ── FLAGS ──
  console.log(`${"═".repeat(118)}\nFLAGS\n`);
  for (const fl of FLAGS) console.log("  • " + fl + "\n");

  await prisma.$disconnect();
  if (!allPass) process.exitCode = 1;
}

const FLAGS: string[] = [
  "CHOSEN SIGNATURE = A-2 Missing Critical Fields (Category A, AUTO). Why: it is the ONLY Category-A signature whose rulebook Solution is O2 (the §0.8 dual-exclusion outcome the build must prove) AND it carries an O5-Hold fallback, so ONE signature exercises both O2 and O5; its detection is the simplest possible (binary null check); and the rulebook frames it as 'existing spec behavior (§14.4/§5.8) surfaced as a guardrail' — the consumer already handles it, so this build is purely the PRODUCER.",
  "CONFLICT (prompt vs rulebook semantics) — A-2's O2 suppresses metrics whose underlying FIELD is null, so the suppressed metric's value is itself MISSING. A missing value was never in the peer μ/σ, so A-2's OWN firing cannot produce a visible peer-μ shift (verification step c) or a 'present-but-excluded raw value' (step d). Those require a PRESENT value being excluded — the Category-B (distortion) semantic. The SEAM is identical regardless of which signature writes the row, so Part 2 drives the same O2 directive (via the real resolveOutcome+adapter+wire) on LUPIN's PRESENT F1 to prove the peer-μ half. This is the path B-1…B-4 / B-Bank-1 will exercise for real. Flagged because the prompt asked for a Category-A signature AND a present-value peer-μ proof — only achievable together by separating 'the wired signature' (A-2) from 'the present-value seam demonstration' (synthetic O2).",
  "CONSUMER IS SINGLE-BOOLEAN — metric-scoring/wire.ts takes ONE predicate `(stockId,metricKey)=>boolean` and uses it for BOTH the suppressed STATE and the peer-stats exclusion. This is exactly right for O2 (both booleans true → one predicate drives both). It CANNOT faithfully represent O4 (peer-mean-only, own-score kept): a single `true` would also suppress own-score. The producer writes both booleans per the schema; toPeerMeanExclusionPredicate() is provided as the forward seam, but honoring O4 needs wire.ts extended to read TWO predicates (own-score from excludeFromOwnScore, peer-stats from excludeFromPeerMean). One-line additive change, flagged — NOT done here (prompt: do not rebuild the consumer). A-2 uses O2 only, so this build is unaffected.",
  "FK ORDERING — the gate runs BEFORE scoring, but score_guardrail_events.snapshot_id is a NOT-NULL FK to ScoreSnapshot and score_suppressions.source_guardrail_event_id FKs the event. Resolution: the gate emits directives keyed by snapshot_key (a STRING, no FK) IN MEMORY → Layer-2 consumes those → the snapshot is produced → THEN events + suppressions persist (FKs resolvable), in one transaction. Consumption never depends on the persisted rows; persistence is provenance. This matches the schema's design (snapshot_key is the PG-agnostic consumption key; the FKs are teardown/audit).",
  "O5/O6/O3 ARE NOT SUPPRESSION ROWS — only O2/O4 write score_suppressions. O5 (hold) and O6 (remove) are whole-stock RUN-ORCHESTRATOR actions (freeze last clean / exit peer set); the audit event records them but there is no per-metric directive. O3 (annotate) is the event + a flag, no math change. The run orchestrator that consumes hold/remove is NOT built here (out of scope); the gate surfaces StockLevelAction so it plugs in.",
  "A-2 METRICS-AFFECTED MAP is FOUNDATION-ONLY because A-2 keys off the annual `Fundamental` row; Momentum reads the separate quarterly_results table, so an annual-field null does not touch M1–M5 (a quarterly A-2 variant is a later add). F8 (FCF/PAT 4y avg) is intentionally EXCLUDED from netProfit's map: it averages over a 4-year window and survives a single missing year (foundation.ts skips that year), so suppressing it would be over-exclusion. Map: revenue→{F6,F7,F10}, netProfit→{F2,F3}, netWorth→{F1,F2,F4}, totalAssets→{F7}. Verified against foundation.ts unavailability conditions.",
  "O2→O5 ESCALATION THRESHOLD is INTERPRETED (CN-8: not fitted; flagged). Rulebook A-2 says 'too many fields missing to compute any pillar → O5 Hold'. Implemented as: if the affected Foundation metrics push Foundation (the composite's REQUIRED anchor, §composite min-pillars) below its §14.4 floor (<5 of 10 present), the composite is unavailable regardless → O5 Hold rather than emit suppressions that yield no score. Single-pillar-below-floor for a NON-anchor pillar is left to the existing §14.4 redistribution downstream (not a guardrail hold). If the team wants a stricter/looser rule, it is one constant in a2-missing-fields.ts.",
  "BARS ARE ILLUSTRATIVE/THROWAWAY (metric-scoring/illustrative-bars.ts) — the Part-2 L1/L2/composite NUMBERS are not final; the SEAM (peer N−1, μ shift, renormalization, raw-present) is structural and bar-independent. The hand-verification confirms the peer-μ arithmetic and the wired L2 match exactly, which is the bar-independent proof.",
  "DRY-RUN — writeGuardrailEval builds the exact prisma row shapes for score_guardrail_events + score_suppressions and, with dryRun=false, commits them (events first, then suppressions with resolved FKs, one transaction). In dry-run it plans only; verification (1d) confirms the tables are unchanged. loadSuppressionRows() reads them back into the adapter so a LATER run re-derives the identical predicate from the DB (the @@index([snapshotKey,metricKey]) is the peer-stats builder's exclusion query).",
  "SYNTHETIC FIXTURES are loudly marked: Part-1 null-field fundamentals are synthetic on real stockIds (no real pharma stock has a null critical field this period); Part-2's O2 on LUPIN's present F1 is a synthetic stand-in for a Category-B distortion firing (labeled B-1) to exercise the present-value peer-μ seam. No real distortion signature is built here — only A-2.",
];

main().catch((e) => { console.error(e); process.exit(1); });
