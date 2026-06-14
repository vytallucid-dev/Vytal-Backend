// PART 1 PROOF — the wire.ts two-predicate extension that enables O4 (peer-only
// exclusion). Proves, on REAL pharma scoring, that own-score and peer-mean are now
// INDEPENDENTLY controllable from the ONE score_suppressions row's two booleans:
//
//   O4 (own=false, peer=true): the suppressed stock's OWN pillar is UNCHANGED, but
//     every OTHER peer's Lens-2 for that metric shifts (the value left the μ/σ).
//   O2 (own=true,  peer=true): changes BOTH the own pillar AND the peers.
//
// This GATES the Category-C build (C-1 needs O4). DRY-RUN.
//
//   npx tsx src/scripts/guardrail-o4-proof.ts
//
// Subject = LUPIN F1 ROCE (present outlier 25.45, N=10) — the same metric the
// framework O2 proof used, so the O2-vs-O4 contrast is apples-to-apples.

import { prisma } from "../db/prisma.js";
import { loadFoundationStandalone } from "../scoring/metrics/load.js";
import { computeFoundation } from "../scoring/metrics/foundation.js";
import type { MetricValue } from "../scoring/metrics/types.js";
import { scoreMetricCrossSection, type CrossSectionInput, type CrossSectionMember } from "../scoring/metric-scoring/wire.js";
import { ILLUSTRATIVE_BARS } from "../scoring/metric-scoring/illustrative-bars.js";
import { NO_SUPPRESSION, type WiringConfig, type ScoredMetric, type SuppressionPredicates } from "../scoring/metric-scoring/types.js";
import { computeLens2 } from "../scoring/lenses/lens-zscore.js";
import { assemblePillar } from "../scoring/pillars/assemble.js";
import { resolveOutcome } from "../scoring/guardrail/outcomes.js";
import { toSuppressionPredicates, suppressedPairs } from "../scoring/guardrail/suppression-adapter.js";
import type { SignatureResult } from "../scoring/guardrail/types.js";

const PG_NAME = "Large-Cap Pharma";
const FOUNDATION_KEYS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10"];
const CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const SK = "FY26Q4";
const f2 = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));
const modal = (xs: string[]): string => { const c = new Map<string, number>(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""; };

interface MD { stockId: string; symbol: string; fSnap: ReturnType<typeof computeFoundation>; fSeries: Map<string, number[]>; }
function fSeries(rows: Awaited<ReturnType<typeof loadFoundationStandalone>>): Map<string, number[]> {
  const s = [...rows].sort((a, b) => a.fyOrdinal - b.fyOrdinal); const out = new Map<string, number[]>();
  for (let i = 0; i < s.length; i++) { const r = computeFoundation(s.slice(0, i + 1)); if (!r) continue; for (const m of r.metrics) { if (!out.has(m.key)) out.set(m.key, []); if (m.available && m.value !== null) out.get(m.key)!.push(m.value); } }
  return out;
}
function members(data: MD[], key: string, fy: string): CrossSectionMember[] {
  return data.map((d) => { const mv: MetricValue | null = d.fSnap?.metrics.find((m) => m.key === key) ?? null; const aligned = d.fSnap?.snapshotFy === fy; const av = aligned && !!mv && mv.available; return { stockId: d.stockId, symbol: d.symbol, rawValue: av ? mv!.value : null, available: av, unavailableReason: av ? null : "n/a", ownHistoryValues: d.fSeries.get(key) ?? [] }; });
}
function scoreFoundation(data: MD[], fy: string, suppression: CrossSectionInput["suppression"]): Map<string, ScoredMetric[]> {
  const by = new Map<string, ScoredMetric[]>(); for (const d of data) by.set(d.stockId, []);
  for (const key of FOUNDATION_KEYS) { const b = ILLUSTRATIVE_BARS[key]; const inp: CrossSectionInput = { pillar: "foundation", metricKey: key, label: key, snapshot: fy, direction: b.direction, bars: b.bars, barNote: b.note, members: members(data, key, fy), suppression, config: CFG }; for (const s of scoreMetricCrossSection(inp).scored) by.get(s.stockId)!.push(s); }
  return by;
}

async function main() {
  const pg = await prisma.peerGroup.findFirst({ where: { name: PG_NAME }, include: { stocks: { include: { stock: true } } } });
  if (!pg) { console.log(`PG "${PG_NAME}" not found`); await prisma.$disconnect(); return; }
  const data: MD[] = [];
  for (const sp of pg.stocks) { const rows = await loadFoundationStandalone(sp.stock.id); data.push({ stockId: sp.stock.id, symbol: sp.stock.symbol, fSnap: computeFoundation(rows), fSeries: fSeries(rows) }); }
  const fy = modal(data.map((d) => d.fSnap?.snapshotFy ?? "").filter(Boolean));
  const bySym = (s: string) => data.find((d) => d.symbol === s)!;
  const subject = bySym("LUPIN");
  const probe = bySym("SUNPHARMA");

  console.log(`${"═".repeat(116)}\nPART 1 — O4 CONSUMER PROOF (wire.ts two-predicate extension) · subject LUPIN F1 ROCE\n`);
  console.log(`⚠ DRY-RUN. One score_suppressions row, two booleans, ONE source — read independently by the scorer.`);

  const checks: { name: string; ok: boolean; detail: string }[] = [];

  // Build O2 and O4 directives for (LUPIN, F1) via the REAL resolveOutcome.
  const mkResult = (outcome: "O2" | "O4"): SignatureResult => ({ signatureKey: "C-1", category: "C", tier: "auto", fired: true, outcome, affectedMetrics: [{ metricKey: "F1", pillar: "foundation", reason: `proof: ${outcome}` }], triggeringValues: { proof: outcome }, explanation: `proof ${outcome}` });
  const o2 = resolveOutcome(mkResult("O2"), { stockId: subject.stockId, snapshotKey: SK });
  const o4 = resolveOutcome(mkResult("O4"), { stockId: subject.stockId, snapshotKey: SK });
  console.log(`  O2 directive: ${JSON.stringify(suppressedPairs(o2.directives, SK)[0])}`);
  console.log(`  O4 directive: ${JSON.stringify(suppressedPairs(o4.directives, SK)[0])}`);
  checks.push({ name: "directives: O2 row = own+peer both true; O4 row = peer true / own FALSE (one row, two booleans)", ok: o2.directives[0].excludeFromOwnScore && o2.directives[0].excludeFromPeerMean && !o4.directives[0].excludeFromOwnScore && o4.directives[0].excludeFromPeerMean, detail: `O2[own=${o2.directives[0].excludeFromOwnScore},peer=${o2.directives[0].excludeFromPeerMean}] O4[own=${o4.directives[0].excludeFromOwnScore},peer=${o4.directives[0].excludeFromPeerMean}]` });

  const o2Pred: SuppressionPredicates = toSuppressionPredicates(o2.directives, SK);
  const o4Pred: SuppressionPredicates = toSuppressionPredicates(o4.directives, SK);

  // Score F1 three ways: baseline, O2, O4.
  const base = scoreFoundation(data, fy, NO_SUPPRESSION);
  const undO2 = scoreFoundation(data, fy, o2Pred);
  const undO4 = scoreFoundation(data, fy, o4Pred);

  const f1 = (map: Map<string, ScoredMetric[]>, stockId: string) => map.get(stockId)!.find((m) => m.metricKey === "F1")!;
  const pill = (map: Map<string, ScoredMetric[]>, d: MD) => assemblePillar({ pillar: "foundation", stockId: d.stockId, symbol: d.symbol, snapshot: fy, metrics: map.get(d.stockId)! });

  // ── (a) O4: the subject's OWN pillar is UNCHANGED ──
  const subBase = pill(base, subject), subO4 = pill(undO4, subject), subO2 = pill(undO2, subject);
  const subF1Base = f1(base, subject.stockId), subF1O4 = f1(undO4, subject.stockId), subF1O2 = f1(undO2, subject.stockId);
  console.log(`\n  (a) O4 — LUPIN's OWN pillar UNCHANGED:`);
  console.log(`      Foundation subtotal: baseline ${f2(subBase.subtotal)} → O4 ${f2(subO4.subtotal)}  (Δ=${f2((subO4.subtotal ?? 0) - (subBase.subtotal ?? 0), 6)})`);
  console.log(`      LUPIN F1: baseline score ${f2(subF1Base.metricScore)} state=${subF1Base.scoreState} → O4 score ${f2(subF1O4.metricScore)} state=${subF1O4.scoreState} inPeerStats=${subF1O4.includedInPeerStats}`);
  checks.push({ name: "(a) O4 → LUPIN OWN pillar UNCHANGED (subtotal identical; F1 still scored, own-score not excluded)", ok: subF1O4.scoreState === "scored" && Math.abs((subO4.subtotal ?? 0) - (subBase.subtotal ?? 0)) < 1e-9 && Math.abs((subF1O4.metricScore ?? 0) - (subF1Base.metricScore ?? 0)) < 1e-9, detail: `subtotal ${f2(subBase.subtotal, 6)}==${f2(subO4.subtotal, 6)}; F1 score ${f2(subF1Base.metricScore, 6)}==${f2(subF1O4.metricScore, 6)}` });

  // ── (b) O4: every OTHER peer's Lens-2 shifts (value left the cross-section) ──
  const prBase = f1(base, probe.stockId), prO4 = f1(undO4, probe.stockId);
  console.log(`\n  (b) O4 — OTHER peers' cross-section shifts (LUPIN's value left the μ/σ):`);
  console.log(`      F1 peer N ${prBase.peerStats!.sampleN}→${prO4.peerStats!.sampleN} · μ ${f2(prBase.peerStats!.mean, 4)}→${f2(prO4.peerStats!.mean, 4)} · ${probe.symbol} L2 ${f2(prBase.l2Score, 3)}[Z=${f2(prBase.l2Z, 3)}]→${f2(prO4.l2Score, 3)}[Z=${f2(prO4.l2Z, 3)}]`);
  checks.push({ name: "(b) O4 → SUNPHARMA (a peer) F1 peer N−1, μ shifts, L2 moves", ok: prO4.peerStats!.sampleN === prBase.peerStats!.sampleN - 1 && prO4.peerStats!.mean !== prBase.peerStats!.mean && prO4.l2Score !== prBase.l2Score, detail: `N ${prBase.peerStats!.sampleN}→${prO4.peerStats!.sampleN}; μ ${f2(prBase.peerStats!.mean, 3)}→${f2(prO4.peerStats!.mean, 3)}; L2 ${f2(prBase.l2Score, 3)}→${f2(prO4.l2Score, 3)}` });

  // ── (c) contrast O2 vs O4 on the SAME value ──
  const prO2 = f1(undO2, probe.stockId);
  console.log(`\n  (c) CONTRAST O2 vs O4 (same LUPIN F1 value):`);
  console.log(`      LUPIN own pillar:  baseline ${f2(subBase.subtotal)} | O2 ${f2(subO2.subtotal)} (CHANGED — metric dropped, state=${subF1O2.scoreState}) | O4 ${f2(subO4.subtotal)} (UNCHANGED)`);
  console.log(`      SUNPHARMA F1 L2:   baseline ${f2(prBase.l2Score, 3)} | O2 ${f2(prO2.l2Score, 3)} (shifted) | O4 ${f2(prO4.l2Score, 3)} (shifted — same μ as O2)`);
  const o2ChangesOwn = subF1O2.scoreState === "suppressed" && subO2.subtotal !== subBase.subtotal;
  const o2ChangesPeers = prO2.peerStats!.sampleN === prBase.peerStats!.sampleN - 1;
  const o4OnlyPeers = Math.abs((subO4.subtotal ?? 0) - (subBase.subtotal ?? 0)) < 1e-9 && prO4.peerStats!.sampleN === prBase.peerStats!.sampleN - 1;
  const o2o4SamePeerMean = Math.abs(prO2.peerStats!.mean - prO4.peerStats!.mean) < 1e-9;
  checks.push({ name: "(c) O2 changes BOTH own+peers; O4 changes ONLY peers; both drop the value from the SAME peer μ", ok: o2ChangesOwn && o2ChangesPeers && o4OnlyPeers && o2o4SamePeerMean, detail: `O2 own ${f2(subBase.subtotal)}→${f2(subO2.subtotal)} + peers N−1; O4 own unchanged + peers N−1; peer μ O2==O4 (${f2(prO2.peerStats!.mean, 4)})` });

  // ── HAND-VERIFY the O4 peer-μ ──
  console.log(`\n${"═".repeat(116)}\nHAND-VERIFIED O4 PEER-μ — F1 ROCE\n`);
  {
    const allF1 = data.map((d) => ({ sym: d.symbol, v: d.fSnap?.metrics.find((m) => m.key === "F1")?.value ?? null })).filter((x) => x.v !== null) as { sym: string; v: number }[];
    const excl = allF1.filter((x) => x.sym !== "LUPIN").map((x) => x.v);
    const muEx = excl.reduce((a, b) => a + b, 0) / excl.length;
    const sigmaEx = Math.sqrt(excl.reduce((a, b) => a + (b - muEx) ** 2, 0) / excl.length);
    const sun = bySym("SUNPHARMA").fSnap!.metrics.find((m) => m.key === "F1")!.value!;
    const l2Ex = computeLens2({ value: sun, peerMean: muEx, peerStdDev: sigmaEx, direction: ILLUSTRATIVE_BARS.F1.direction, anchorLifted: prO4.l2AnchorFired });
    console.log(`  μ(excl LUPIN) hand=${muEx.toFixed(4)} vs wired O4=${f2(prO4.peerStats!.mean, 4)} → ${Math.abs(muEx - prO4.peerStats!.mean) < 1e-9 ? "✓" : "✗"}`);
    console.log(`  SUNPHARMA L2 hand=${l2Ex.score!.toFixed(4)} vs wired O4=${f2(prO4.l2Score, 4)} → ${Math.abs(l2Ex.score! - (prO4.l2Score ?? NaN)) < 1e-9 ? "✓" : "✗"}`);
    console.log(`  LUPIN's OWN F1 was scored against the FULL cross-section incl. itself (peerStats N=${subF1O4.peerStats!.sampleN}) → own unchanged.`);
    checks.push({ name: "(hand) O4 peer μ(excl LUPIN) == wired; SUNPHARMA L2 hand == wired; LUPIN own scored vs full N", ok: Math.abs(muEx - prO4.peerStats!.mean) < 1e-9 && Math.abs(l2Ex.score! - (prO4.l2Score ?? NaN)) < 1e-9 && subF1O4.peerStats!.sampleN === prBase.peerStats!.sampleN, detail: `μ ${muEx.toFixed(4)}; LUPIN own peerN=${subF1O4.peerStats!.sampleN} (full), peers see N=${prO4.peerStats!.sampleN}` });
  }

  console.log(`\n${"═".repeat(116)}\nRESULTS\n`);
  for (const c of checks) console.log(`  ${c.ok ? "✓ PASS" : "✗ FAIL"}  ${c.name}\n           ${c.detail}`);
  const allPass = checks.every((c) => c.ok);
  console.log(`\n  ${allPass ? "✓ O4 PROVEN — Part 2 (Category C) may proceed" : "✗ O4 NOT PROVEN — do NOT build Category C"}\n`);
  await prisma.$disconnect();
  if (!allPass) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
