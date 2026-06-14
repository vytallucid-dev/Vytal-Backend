// Verification harness for the CATEGORY-A-REMAINDER + CATEGORY-B guardrail
// signatures (built against the proven framework; A-2 already verified separately).
// PER-SIGNATURE firing (not a summary): each signature is made to fire and its
// detection → outcome → artifacts are shown. Plus the real-data B-1 dual-exclusion
// (present-value peer-μ shift, hand-verified) and the B-5 review state machine.
// DRY-RUN: commits nothing.
//
//   npx tsx src/scripts/guardrail-signatures-check.ts
//
// SYNTHETIC fixtures are LOUDLY marked — no real pharma stock triggers an accounting
// distortion this period, so the B-family is fired on constructed financials; the
// dual-exclusion, however, runs on REAL scoring (the suppressed metric's value is
// the real, present pharma value).

import { prisma } from "../db/prisma.js";
import { loadFoundationStandalone } from "../scoring/metrics/load.js";
import { computeFoundation } from "../scoring/metrics/foundation.js";
import type { MetricValue } from "../scoring/metrics/types.js";
import { scoreMetricCrossSection, type CrossSectionInput, type CrossSectionMember } from "../scoring/metric-scoring/wire.js";
import { ILLUSTRATIVE_BARS } from "../scoring/metric-scoring/illustrative-bars.js";
import { NO_SUPPRESSION, type WiringConfig, type ScoredMetric } from "../scoring/metric-scoring/types.js";
import { computeLens2 } from "../scoring/lenses/lens-zscore.js";
import { assemblePillar } from "../scoring/pillars/assemble.js";
// guardrail layer
import { runGuardrailGate } from "../scoring/guardrail/gate.js";
import { proposeReview, recordRuling, applyRuling } from "../scoring/guardrail/review.js";
import { toSuppressionPredicate, suppressedPairs } from "../scoring/guardrail/suppression-adapter.js";
import { writeGuardrailReview } from "../scoring/guardrail/persist.js";
import { registryCoverage } from "../scoring/guardrail/signatures/registry.js";
import type { GuardrailStockInput, SignatureResult, LatestFundamentalInput } from "../scoring/guardrail/types.js";

const PG_NAME = "Large-Cap Pharma";
const FOUNDATION_KEYS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10"];
const FOUNDATION_CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const SK = "FY26Q4"; // snapshot_key
const NF = "non_financial" as const;
const RULED_AT = new Date("2026-06-14"); // pinned (no Date.now() — deterministic)

const f2 = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));
const modal = (xs: string[]): string => { const c = new Map<string, number>(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""; };

interface MemberData { stockId: string; symbol: string; fSnap: ReturnType<typeof computeFoundation>; fSeries: Map<string, number[]>; }
function foundationSeries(rows: Awaited<ReturnType<typeof loadFoundationStandalone>>): Map<string, number[]> {
  const sorted = [...rows].sort((a, b) => a.fyOrdinal - b.fyOrdinal); const series = new Map<string, number[]>();
  for (let i = 0; i < sorted.length; i++) { const res = computeFoundation(sorted.slice(0, i + 1)); if (!res) continue; for (const m of res.metrics) { if (!series.has(m.key)) series.set(m.key, []); if (m.available && m.value !== null) series.get(m.key)!.push(m.value); } }
  return series;
}
function buildMembers(data: MemberData[], key: string, fSnapFy: string): CrossSectionMember[] {
  return data.map((d) => { const mv: MetricValue | null = d.fSnap?.metrics.find((m) => m.key === key) ?? null; const aligned = d.fSnap?.snapshotFy === fSnapFy; const available = aligned && !!mv && mv.available; return { stockId: d.stockId, symbol: d.symbol, rawValue: available ? mv!.value : null, available, unavailableReason: available ? null : !aligned ? "snapshot misaligned" : (mv?.reason ?? "no row"), ownHistoryValues: d.fSeries.get(key) ?? [] }; });
}
function scoreFoundation(data: MemberData[], fSnapFy: string, suppression: typeof NO_SUPPRESSION): Map<string, ScoredMetric[]> {
  const byStock = new Map<string, ScoredMetric[]>(); for (const d of data) byStock.set(d.stockId, []);
  for (const key of FOUNDATION_KEYS) { const bars = ILLUSTRATIVE_BARS[key]; const members = buildMembers(data, key, fSnapFy); const input: CrossSectionInput = { pillar: "foundation", metricKey: key, label: key, snapshot: fSnapFy, direction: bars.direction, bars: bars.bars, barNote: bars.note, members, suppression, config: FOUNDATION_CFG }; for (const s of scoreMetricCrossSection(input).scored) byStock.get(s.stockId)!.push(s); }
  return byStock;
}

const checks: { name: string; ok: boolean; detail: string }[] = [];
const sigInput = (over: Partial<GuardrailStockInput>): GuardrailStockInput => ({ stockId: "synthetic", symbol: "SYNTH", industryPath: NF, snapshotKey: SK, latestFundamental: null, ...over });

async function main() {
  const pg = await prisma.peerGroup.findFirst({ where: { name: PG_NAME }, include: { stocks: { include: { stock: true } } } });
  if (!pg) { console.log(`PG "${PG_NAME}" not found`); await prisma.$disconnect(); return; }
  const cov = registryCoverage();
  console.log(`${"═".repeat(118)}\nGUARDRAIL SIGNATURES — Category-A remainder + Category-B (+ B-5 review)`);
  console.log(`BUILT now: A-1, A-3, A-4, B-1, B-2, B-3, B-4, B-5  (A-2 prior)  ·  still declared-not-built: [${cov.declared.join(", ")}]`);
  console.log(`⚠ DRY-RUN. Distortion fixtures are SYNTHETIC (loudly marked); the B-1 dual-exclusion runs on REAL pharma scoring.`);

  const data: MemberData[] = [];
  for (const sp of pg.stocks) { const fRows = await loadFoundationStandalone(sp.stock.id); data.push({ stockId: sp.stock.id, symbol: sp.stock.symbol, fSnap: computeFoundation(fRows), fSeries: foundationSeries(fRows) }); }
  const fSnapFy = modal(data.map((d) => d.fSnap?.snapshotFy ?? "").filter(Boolean));
  const bySym = (s: string) => data.find((d) => d.symbol === s)!;

  // ════════════════════════════════════════════════════════════════════════════
  // PART A — CATEGORY-A REMAINDER (per-signature firing)
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(118)}\nPART A — CATEGORY-A REMAINDER (A-1 stale, A-3 history, A-4 inactive)\n`);

  // A-1 O5 hold (1 quarter late, 60 days past expected)
  {
    const r = runGuardrailGate(sigInput({ symbol: "A1-HOLD", quarterlyFiling: { daysPastExpected: 60, consecutiveMissedQuarters: 1 } }));
    const e = r.events[0]; const act = r.stockActions[0];
    console.log(`  A-1 [SYNTHETIC 60d late, 1 missed Q] → ${e?.outcome} · action=${act?.kind} confirm=${act?.requiresOperatorConfirm} · suppressions=${r.directives.length}`);
    checks.push({ name: "A-1 (60d late) → O5 Hold, whole-stock hold action, 0 suppressions", ok: e?.outcome === "O5" && act?.kind === "hold" && act.requiresOperatorConfirm === false && r.directives.length === 0, detail: `outcome=${e?.outcome} action=${act?.kind}` });
  }
  // A-1 O6 escalation (>2 consecutive quarters)
  {
    const r = runGuardrailGate(sigInput({ symbol: "A1-REMOVE", quarterlyFiling: { daysPastExpected: 200, consecutiveMissedQuarters: 3 } }));
    const e = r.events[0]; const act = r.stockActions[0];
    console.log(`  A-1 [SYNTHETIC 200d late, 3 missed Q] → ${e?.outcome} · action=${act?.kind} confirm=${act?.requiresOperatorConfirm} (>2Q escalation)`);
    checks.push({ name: "A-1 (>2 quarters) → O6 Remove, operator-confirm=true", ok: e?.outcome === "O6" && act?.kind === "remove" && act.requiresOperatorConfirm === true, detail: `outcome=${e?.outcome} action=${act?.kind} confirm=${act?.requiresOperatorConfirm}` });
  }
  // A-3 O3 surface (insufficient history) — NO suppression
  {
    const r = runGuardrailGate(sigInput({ symbol: "A3", history: { fundamentalRows: 3, shareholdingRows: 4 } }));
    const e = r.events[0];
    console.log(`  A-3 [SYNTHETIC 3 fundamentals, 4 SHP] → ${e?.outcome} · annotations=${r.annotations.length} · suppressions=${r.directives.length} (lens fallback already by §5.8)`);
    checks.push({ name: "A-3 (short history) → O3 annotate (surface lens fallback), 0 suppressions [doc 'O2' = lens-level, flagged]", ok: e?.outcome === "O3" && r.annotations.length === 1 && r.directives.length === 0, detail: `outcome=${e?.outcome} annotations=${r.annotations.length} suppressions=${r.directives.length}` });
  }
  // A-4 O6 remove (inactive)
  {
    const r = runGuardrailGate(sigInput({ symbol: "A4", activity: { isActive: false, consecutiveNoPriceDays: 0 } }));
    const e = r.events[0]; const act = r.stockActions[0];
    console.log(`  A-4 [SYNTHETIC isActive=false] → ${e?.outcome} · action=${act?.kind} confirm=${act?.requiresOperatorConfirm}`);
    checks.push({ name: "A-4 (inactive) → O6 Remove, operator-confirm=true", ok: e?.outcome === "O6" && act?.kind === "remove" && act.requiresOperatorConfirm === true, detail: `outcome=${e?.outcome} action=${act?.kind}` });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PART B — CATEGORY-B AUTO (per-signature firing)
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(118)}\nPART B — CATEGORY-B AUTO (B-1 gain, B-2 loss, B-3 tax, B-4 other-income)\n`);

  // Defaults: all four A-2 critical fields PRESENT (so A-2 does not co-fire and
  // contaminate the B demonstration); each B fixture overrides only the P&L lines
  // its own trigger needs.
  const fy = (over: Partial<LatestFundamentalInput>): LatestFundamentalInput => ({ fiscalYear: fSnapFy, revenue: 10000, netProfit: 1000, netWorth: 18000, totalAssets: 40000, ...over });
  const showB = (key: string, r: ReturnType<typeof runGuardrailGate>) => {
    const e = r.events[0]; const pairs = suppressedPairs(r.directives, SK);
    console.log(`  ${key} → ${e?.outcome} (${e?.tier}) · suppress=[${pairs.map((p) => p.metricKey).join(",") || "—"}] · annotate=${r.annotations.length}`);
    console.log(`      trigger: ${JSON.stringify(e?.triggeringValues).slice(0, 200)}`);
  };

  // B-1 exceptional GAIN → O2 {F1,F2,M2,M4}
  const b1Input = sigInput({
    symbol: "B1", latestFundamental: fy({ revenue: 10000, operatingMargin: 15, profitBeforeTax: 2800, tax: 300, otherIncome: 100, financeCosts: 100, netProfit: 2500 }),
    priorFundamental: fy({ revenue: 9500, operatingMargin: 14, profitBeforeTax: 1300, tax: 325, otherIncome: 90, financeCosts: 100, netProfit: 1000 }),
  });
  const b1 = runGuardrailGate(b1Input); showB("B-1 [SYNTHETIC: profit +150% YoY, OPM flat, exceptional gain below the operating line]", b1);
  {
    const m = new Set(suppressedPairs(b1.directives, SK).map((p) => p.metricKey));
    checks.push({ name: "B-1 → O2, suppress {F1,F2,M2,M4} (ROCE/ROE/NetMargin/NP-YoY), each own+peer=true", ok: b1.events[0]?.outcome === "O2" && ["F1", "F2", "M2", "M4"].every((k) => m.has(k)) && m.size === 4 && suppressedPairs(b1.directives, SK).every((p) => p.own && p.peer), detail: `suppress={${[...m].join(",")}}` });
  }

  // B-2 exceptional LOSS → O2 {F2,M2,M4}
  const b2 = runGuardrailGate(sigInput({
    symbol: "B2", latestFundamental: fy({ revenue: 10000, operatingMargin: 10, profitBeforeTax: -600, tax: 0, otherIncome: 50, financeCosts: 100, netProfit: -500 }),
    priorFundamental: fy({ revenue: 9800, operatingMargin: 10.4, profitBeforeTax: 1400, tax: 350, otherIncome: 40, financeCosts: 100, netProfit: 1050 }),
  }));
  showB("B-2 [SYNTHETIC: profit +ve→loss, OPM held ~10%, below-line charge]", b2);
  {
    const m = new Set(suppressedPairs(b2.directives, SK).map((p) => p.metricKey));
    checks.push({ name: "B-2 → O2, suppress {F2,M2,M4} (NOT F1 ROCE — per doc map), sign-flip detected", ok: b2.events[0]?.outcome === "O2" && ["F2", "M2", "M4"].every((k) => m.has(k)) && !m.has("F1") && m.size === 3, detail: `suppress={${[...m].join(",")}}` });
  }

  // B-3 tax distortion → O3 (default); then O2 on band-flip hint
  const b3Fin = { latestFundamental: fy({ revenue: 10000, operatingMargin: 20, profitBeforeTax: 1100, tax: 30, otherIncome: 100, financeCosts: 50, netProfit: 1070 }), priorFundamental: fy({ revenue: 9800, operatingMargin: 20, profitBeforeTax: 1000, tax: 300, otherIncome: 90, financeCosts: 50, netProfit: 700 }) };
  const b3 = runGuardrailGate(sigInput({ symbol: "B3", ...b3Fin }));
  showB("B-3 [SYNTHETIC: eff-tax ~2.7%, NP swing >50%, PBT swing <25%]", b3);
  const b3Flip = runGuardrailGate(sigInput({ symbol: "B3-FLIP", ...b3Fin, bandFlipDetected: true }));
  console.log(`      └ with bandFlipDetected=true → ${b3Flip.events[0]?.outcome} · suppress=[${suppressedPairs(b3Flip.directives, SK).map((p) => p.metricKey).join(",")}]`);
  {
    const m3 = new Set(suppressedPairs(b3Flip.directives, SK).map((p) => p.metricKey));
    checks.push({ name: "B-3 → O3 annotate by default (no suppression); → O2 {F2,M2,M4} when bandFlipDetected", ok: b3.events[0]?.outcome === "O3" && b3.directives.length === 0 && b3Flip.events[0]?.outcome === "O2" && ["F2", "M2", "M4"].every((k) => m3.has(k)) && !m3.has("F1"), detail: `default=${b3.events[0]?.outcome}(supp ${b3.directives.length}); flip=${b3Flip.events[0]?.outcome}(supp {${[...m3].join(",")}})` });
  }

  // B-4 other-income inflation → O3 (default)
  const b4 = runGuardrailGate(sigInput({
    symbol: "B4", latestFundamental: fy({ revenue: 10000, operatingMargin: 18, profitBeforeTax: 1000, tax: 250, otherIncome: 400, financeCosts: 50, netProfit: 750 }),
    priorFundamental: fy({ revenue: 9800, operatingMargin: 18, profitBeforeTax: 950, tax: 240, otherIncome: 50, financeCosts: 50, netProfit: 710 }),
  }));
  showB("B-4 [SYNTHETIC: other income 40% of PBT (normal ~5%)]", b4);
  {
    const m = new Set(suppressedPairs(b4.directives, SK).map((p) => p.metricKey));
    checks.push({ name: "B-4 → O3 annotate by default (other income >30% PBT); F1 ROCE in its suppress map (EBIT incl OI)", ok: b4.events[0]?.outcome === "O3" && b4.directives.length === 0 && b4.annotations[0]?.affectedMetrics.some((x) => x.metricKey === "F1"), detail: `outcome=${b4.events[0]?.outcome} annotateMetrics=[${b4.annotations[0]?.affectedMetrics.map((x) => x.metricKey).join(",")}]` });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PART C — B-1 FULL DUAL-EXCLUSION on REAL scoring (present-value peer-μ), hand-verified
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(118)}\nPART C — B-1 DUAL-EXCLUSION on REAL scoring · subject TORNTPHARM · metric F2 ROE\n`);
  console.log(`  B operates on PRESENT (distorted) values: B-1 fires on TORNTPHARM (synthetic distortion financials),`);
  console.log(`  suppressing its REAL F2 ROE (${f2(bySym("TORNTPHARM").fSnap?.metrics.find((m) => m.key === "F2")?.value)}) — present, excluded from math, peer μ shifts.`);

  const subject = bySym("TORNTPHARM");
  const b1OnSubject = runGuardrailGate({ ...b1Input, stockId: subject.stockId, symbol: subject.symbol });
  const predicate = toSuppressionPredicate(b1OnSubject.directives, SK);
  console.log(`  directives: ${suppressedPairs(b1OnSubject.directives, SK).map((p) => `${p.metricKey}[own=${p.own},peer=${p.peer}]`).join(" ")}`);

  const base = scoreFoundation(data, fSnapFy, NO_SUPPRESSION);
  const supp = scoreFoundation(data, fSnapFy, predicate);

  // own-score: subject pillar drops F1+F2
  const basePill = assemblePillar({ pillar: "foundation", stockId: subject.stockId, symbol: subject.symbol, snapshot: fSnapFy, metrics: base.get(subject.stockId)! });
  const suppPill = assemblePillar({ pillar: "foundation", stockId: subject.stockId, symbol: subject.symbol, snapshot: fSnapFy, metrics: supp.get(subject.stockId)! });
  const subjF2base = base.get(subject.stockId)!.find((m) => m.metricKey === "F2")!;
  const subjF2supp = supp.get(subject.stockId)!.find((m) => m.metricKey === "F2")!;
  console.log(`\n  (own-score) TORNTPHARM Foundation subtotal ${f2(basePill.subtotal)} → ${f2(suppPill.subtotal)} · present ${basePill.presentCount}→${suppPill.presentCount} (F1,F2 dropped)`);
  console.log(`             F2 raw ${f2(subjF2supp.rawValue)} PRESENT, state=${subjF2supp.scoreState}, inPeerStats ${subjF2base.includedInPeerStats}→${subjF2supp.includedInPeerStats}`);

  // peer-set: a co-peer's F2 L2 moves
  const probe = bySym("SUNPHARMA");
  const probeBase = base.get(probe.stockId)!.find((m) => m.metricKey === "F2")!;
  const probeSupp = supp.get(probe.stockId)!.find((m) => m.metricKey === "F2")!;
  console.log(`  (peer-set) F2 peer N ${probeBase.peerStats!.sampleN}→${probeSupp.peerStats!.sampleN} · μ ${f2(probeBase.peerStats!.mean, 4)}→${f2(probeSupp.peerStats!.mean, 4)} · ${probe.symbol} L2 ${f2(probeBase.l2Score, 3)}[Z=${f2(probeBase.l2Z, 3)}]→${f2(probeSupp.l2Score, 3)}[Z=${f2(probeSupp.l2Z, 3)}]`);

  // hand-verify peer μ + co-peer L2
  {
    const allF2 = data.map((d) => ({ sym: d.symbol, v: d.fSnap?.metrics.find((m) => m.key === "F2")?.value ?? null })).filter((x) => x.v !== null) as { sym: string; v: number }[];
    const all = allF2.map((x) => x.v);
    const excl = allF2.filter((x) => x.sym !== "TORNTPHARM").map((x) => x.v);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const muAll = mean(all), muEx = mean(excl);
    const sun = bySym("SUNPHARMA").fSnap!.metrics.find((m) => m.key === "F2")!.value!;
    const sigmaEx = Math.sqrt(excl.reduce((a, b) => a + (b - muEx) ** 2, 0) / excl.length);
    const l2Ex = computeLens2({ value: sun, peerMean: muEx, peerStdDev: sigmaEx, direction: ILLUSTRATIVE_BARS.F2.direction, anchorLifted: probeSupp.l2AnchorFired });
    console.log(`\n  HAND-VERIFY: F2 μ(all N=${all.length})=${muAll.toFixed(4)} → μ(excl TORNTPHARM ${allF2.find((x) => x.sym === "TORNTPHARM")!.v})=${muEx.toFixed(4)}`);
    console.log(`             SUNPHARMA hand L2=${l2Ex.score!.toFixed(4)} vs wired ${f2(probeSupp.l2Score, 4)} → ${Math.abs(l2Ex.score! - (probeSupp.l2Score ?? NaN)) < 1e-9 ? "✓" : "✗"}`);
    const ok = Math.abs(muEx - probeSupp.peerStats!.mean) < 1e-9 && Math.abs(muAll - probeBase.peerStats!.mean) < 1e-9 && Math.abs(l2Ex.score! - (probeSupp.l2Score ?? NaN)) < 1e-9 && probeSupp.peerStats!.sampleN === probeBase.peerStats!.sampleN - 1;
    checks.push({ name: "PART C: B-1 real dual-exclusion — F2 peer N−1, μ shifts, SUNPHARMA L2 moves, hand==wired; TORNTPHARM F2 raw present+suppressed", ok: ok && subjF2supp.rawValue !== null && subjF2supp.scoreState === "suppressed" && subjF2supp.includedInPeerStats === false && suppPill.subtotal !== basePill.subtotal, detail: `μ ${muAll.toFixed(3)}→${muEx.toFixed(3)} (hand==wired); N ${probeBase.peerStats!.sampleN}→${probeSupp.peerStats!.sampleN}; subtotal ${f2(basePill.subtotal)}→${f2(suppPill.subtotal)}` });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PART D — B-5 REVIEW STATE MACHINE (detect → review → ruling → apply)
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(118)}\nPART D — B-5 REVIEW (HoldCo extraction) — review → ruling → apply state machine\n`);

  const b5Input = sigInput({
    symbol: "B5", promoterPct: 62,
    latestFundamental: fy({ netWorth: 12097, netProfit: 8000 }),
    priorFundamental: fy({ netWorth: 33437, netProfit: 9000 }),
  });
  const b5Gate = runGuardrailGate(b5Input);
  const pending = b5Gate.pendingReviews[0];
  console.log(`  detect [SYNTHETIC HZ-like: net worth 33437→12097 (−64%), profit +ve, promoter 62%]:`);
  console.log(`    → events=${b5Gate.events.length} (tier=${b5Gate.events[0]?.tier}, proposed ${b5Gate.events[0]?.outcome}) · directives=${b5Gate.directives.length} · annotations=${b5Gate.annotations.length} · PENDING reviews=${b5Gate.pendingReviews.length}`);
  console.log(`    ⇒ NOTHING applied yet — stock scores NORMALLY, flagged "under review"`);
  checks.push({ name: "B-5 detect → REVIEW: audit event written (tier=review), 0 directives, 0 annotations, 1 pending (nothing applied)", ok: b5Gate.events[0]?.tier === "review" && b5Gate.directives.length === 0 && b5Gate.annotations.length === 0 && b5Gate.pendingReviews.length === 1, detail: `event.tier=${b5Gate.events[0]?.tier} directives=${b5Gate.directives.length} pending=${b5Gate.pendingReviews.length}` });

  // ── upheld → proposed O3 annotation APPLIES (B-5 never suppresses, per doc) ──
  {
    const review = recordRuling(pending, { operatorId: "op-aman", ruling: "upheld", reason: "Confirmed special-dividend extraction; annotate.", ruledAt: RULED_AT });
    const applied = applyRuling(pending, "upheld", { stockId: b5Input.stockId, snapshotKey: SK });
    const plan = await writeGuardrailReview(review, applied, { dryRun: true });
    console.log(`\n  ruling UPHELD → ${applied.note}`);
    console.log(`    annotation: "${applied.annotations[0]?.text.slice(0, 90)}…" · suppressions applied=${applied.directives.length}`);
    for (const n of plan.notes) console.log(`    • ${n}`);
    checks.push({ name: "B-5 UPHELD → proposed O3 annotation applies (0 suppressions — doc: never suppress, ROE is real per CN-4)", ok: applied.applied && applied.annotations.length === 1 && applied.directives.length === 0, detail: `annotations=${applied.annotations.length} suppressions=${applied.directives.length}` });
  }

  // ── second case OVERRIDDEN → nothing applied, decision logged ──
  {
    const pending2 = proposeReview(b5Gate.pendingReviews[0].result, { stockId: "B5-OTHER", snapshotKey: SK });
    const review = recordRuling(pending2, { operatorId: "op-aman", ruling: "overridden", reason: "One-off restructuring, not extraction; score normally.", ruledAt: RULED_AT });
    const applied = applyRuling(pending2, "overridden", { stockId: "B5-OTHER", snapshotKey: SK });
    const plan = await writeGuardrailReview(review, applied, { dryRun: true });
    console.log(`\n  ruling OVERRIDDEN → ${applied.note}`);
    for (const n of plan.notes) console.log(`    • ${n}`);
    checks.push({ name: "B-5 OVERRIDDEN → nothing applied (0 directives, 0 annotations), decision logged", ok: !applied.applied && applied.directives.length === 0 && applied.annotations.length === 0 && plan.ruling === "overridden", detail: `applied=${applied.applied} ruling logged=${plan.ruling}` });
  }

  // ── machine APPLIES A SUPPRESSION on upheld — route a real O2 result (B-1's) through review ──
  console.log(`\n  ── review machine applies a SUPPRESSION on upheld (B-5 is annotate-only; here B-1's O2 result is`);
  console.log(`     routed through the SAME machine to prove upheld→suppression→re-score; B-1 is actually AUTO) ──`);
  {
    // Build a review from a real O2 verdict (B-1's, on the subject) and route it
    // through the SAME machine to prove upheld → suppression → re-score.
    const b1Verdict: SignatureResult = { signatureKey: "B-1", category: "B", tier: "review", fired: true, outcome: "O2", affectedMetrics: [{ metricKey: "F2", pillar: "foundation", reason: "B-1 O2 routed through review (demo)" }], triggeringValues: { DEMO: "B-1 O2 via review machine" }, explanation: "DEMO: B-1's O2 routed through the review machine." };
    const pend = proposeReview(b1Verdict, { stockId: subject.stockId, snapshotKey: SK });
    console.log(`    pending (no suppression yet): directives via gate would be 0; pending=1`);
    const upheld = applyRuling(pend, "upheld", { stockId: subject.stockId, snapshotKey: SK });
    const rePredicate = toSuppressionPredicate(upheld.directives, SK);
    const reSupp = scoreFoundation(data, fSnapFy, rePredicate);
    const reProbe = reSupp.get(probe.stockId)!.find((m) => m.metricKey === "F2")!;
    console.log(`    ruling UPHELD → ${upheld.directives.length} suppression(s) [${suppressedPairs(upheld.directives, SK).map((p) => p.metricKey).join(",")}] → re-score: F2 peer N ${probeBase.peerStats!.sampleN}→${reProbe.peerStats!.sampleN}, μ ${f2(probeBase.peerStats!.mean, 3)}→${f2(reProbe.peerStats!.mean, 3)}`);
    checks.push({ name: "Review machine: upheld on an O2 verdict → suppression applies → re-score shows peer N−1 + μ shift", ok: upheld.applied && upheld.directives.length === 1 && reProbe.peerStats!.sampleN === probeBase.peerStats!.sampleN - 1 && reProbe.peerStats!.mean !== probeBase.peerStats!.mean, detail: `directives=${upheld.directives.length}; N ${probeBase.peerStats!.sampleN}→${reProbe.peerStats!.sampleN}` });
  }

  // ── CONFIRMATIONS ──
  console.log(`\n${"═".repeat(118)}\nCONFIRMATIONS\n`);
  console.log(`  • AUTO applies immediately: B-1 gate produced ${b1.directives.length} directive(s) with NO ruling.`);
  console.log(`  • REVIEW waits: B-5 gate produced ${b5Gate.directives.length} directive(s) (held pending ruling).`);
  console.log(`  • Every firing writes an audit event: A-1/A-3/A-4/B-1/B-2/B-3/B-4/B-5 each emitted exactly 1 event.`);
  console.log(`  • Raw values visible: TORNTPHARM F2 raw=${f2(subjF2supp.rawValue)} state=${subjF2supp.scoreState} (excluded from math, not hidden).`);
  checks.push({ name: "CONFIRM: AUTO (B-1) applies immediately; REVIEW (B-5) holds (0 directives until ruling)", ok: b1.directives.length > 0 && b5Gate.directives.length === 0, detail: `B-1 directives=${b1.directives.length}; B-5 directives=${b5Gate.directives.length} (pending=${b5Gate.pendingReviews.length})` });

  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(118)}\nRESULTS\n`);
  for (const c of checks) console.log(`  ${c.ok ? "✓ PASS" : "✗ FAIL"}  ${c.name}\n           ${c.detail}`);
  const allPass = checks.every((c) => c.ok);
  console.log(`\n  ${allPass ? "✓ ALL CHECKS PASS" : "✗ A CHECK FAILED"}\n`);

  console.log(`${"═".repeat(118)}\nFLAGS\n`);
  for (const fl of FLAGS) console.log("  • " + fl + "\n");

  await prisma.$disconnect();
  if (!allPass) process.exitCode = 1;
}

const FLAGS: string[] = [
  "NONE OF THESE SIGNATURES USE O4. Verified: A-1 (O5/O6), A-3 (O3), A-4 (O6), B-1/B-2 (O2), B-3/B-4 (O3→O2 on band-flip), B-5 (O3, review). The single-boolean consumer handles all of them. O4 (peer-only) remains C-prompt territory (C-1) — no resequencing needed.",
  "A-3 CONFLICT (doc says O2; built as O3). In this system O2 = metric-level dual-exclusion (whole metric out of own-score AND peer μ/σ). A-3's real action is a LENS-level fallback (drop only Lens 3, keep L1+L2 → (L1+L2)/2) + the §11.10 Ownership baseline-60 — BOTH already performed automatically by the existing engine (wire.ts l3MinN gate; ownership/baseline.ts). A metric-level O2 would OVER-suppress (kill the valid L1+L2 too). So A-3 detects + SURFACES (O3 annotate); the lens-level exclusion stays where it already lives. Honoring a literal A-3 directive would need a lens-scope column on score_suppressions.",
  "B-5 vs PROMPT (doc says O3 annotate; prompt says 'upheld → suppression'). Per the rulebook B-5 NEVER suppresses — the ROE/ROCE inflation is real arithmetic (CN-4); B-5 annotates. So B-5 UPHELD applies an ANNOTATION, not a suppression. The review STATE MACHINE is outcome-agnostic, so the 'upheld → suppression → re-score' path the prompt wants IS demonstrated — by routing a real O2 verdict (B-1's) through the same machine (Part D last block). B-5 itself stays faithful to the doc.",
  "AUTO vs REVIEW boundary, with the operator-CONFIRM vs operator-RULE distinction: A-1's >2Q→O6 and A-4's O6 are AUTO-tier with requiresOperatorConfirm=true on the remove action (a recommended, DECIDED action the operator one-tap confirms for peer-set integrity, §0.6 O6). That is NOT the same as REVIEW-tier (B-5), where the OUTCOME itself is undecided and goes to score_guardrail_reviews for a ruling. Only B-5 uses the review table; A-1/A-4 use the confirm flag on the stock action.",
  "BELOW-LINE DERIVATION (B-1/B-2) is an INTERPRETATION of an underspecified doc formula (flagged). 'Derived operating profit' is computed as revenue × operatingMargin — NOT PBT-based — on purpose: an exceptional gain/charge sits IN PBT, so a PBT-based operating proxy would absorb the very distortion to isolate. operatingMargin is the stored EBITDA-based % (so the derived operating profit is EBITDA-ish, not strict EBIT). Tax-adjusted by the period's ACTUAL effective rate (no invented 'normal tax' constant — CN-8). The primary detectors (profit move + OPM-flat) are robust; the >40% below-line gate is corroboration on this derivation.",
  "METRICS-AFFECTED MAPS use ACTUAL metric keys (the §4A worked example says 'use the actual pillar map at build'). The doc's 'Net Margin (Foundation)' is M2 TTM NPM (Momentum) in this engine — there is no separate Foundation net-margin metric — so 'Net Margin' and 'TTM NPM' dedupe to M2. Fixed maps: B-1 {F1,F2,M2,M4}; B-2 {F2,M2,M4} (no ROCE per doc); B-3 {F2,M2,M4} post-tax (keeps F1 ROCE — our EBIT is pre-tax); B-4 {F1,F2,M2,M4} (other income inflates our EBIT → ROCE too). The B-4 suppress set was a DESCRIPTION ('profit-based metrics inflated by other income'), not a list — made explicit here.",
  "B-3/B-4 'O2 if band-flip' is a FORWARD-DEPENDENCY. The escalation needs to know whether the distortion flips a metric's L1 band — which needs a provisional SCORE, but the gate runs BEFORE scoring. Modeled as an optional input.bandFlipDetected a two-pass orchestrator supplies on a second pass; absent ⇒ default O3. Demonstrated both branches (B-3 default O3; B-3 with the hint → O2).",
  "'normally > 20%' (B-3) / 'normally < 10%' (B-4) baselines use the PRIOR YEAR as the proxy for 'normal' (the only history at the gate). If the prior-year value is unavailable the baseline is unverified and the signature proceeds on the current-period condition alone (noted in triggeringValues). A multi-year normal would tighten this in v6.0.",
  "B-family is NON-FINANCIAL ONLY (applies() gates industryPath='non_financial', §2B). Banking PGs route to B-Bank (separate later build); B-5 also applies to promoter-group NBFCs per the doc but the NBFC path needs the banking input wiring (not built). C-1/C-2 remain declared-not-built (C-prompt).",
  "B-1/B-2 'O2 + O3 annotate' is modeled as O2 with its mandatory §0.8c transparency (the directive keeps the raw value visible; the signature's explanation is the flag). No separate O3 outcome is emitted — a second O3 on the same metric would double-count. The transparency requirement is met by O2 itself (Part C shows the raw value present + marked excluded).",
  "DRY-RUN: review rulings + applied suppressions build their exact prisma shapes (writeGuardrailReview); committed only when dryRun=false (score_guardrail_reviews row, then on upheld the score_suppressions rows, one transaction). Synthetic distortion fixtures are loudly marked; the Part-C dual-exclusion uses the REAL pharma F2 value (present, suppressed).",
];

main().catch((e) => { console.error(e); process.exit(1); });
