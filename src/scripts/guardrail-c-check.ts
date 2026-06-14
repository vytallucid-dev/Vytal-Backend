// PART 2 — CATEGORY-C signatures (built against the proven O4 consumer). Per-signature
// firing: C-1 (revenue/asset step → O4+O3, REVIEW) and C-2 (bonus/split → O1 data-
// adjustment, AUTO; rights → O3, REVIEW). Includes the C-1 O4 EFFECT on real scoring
// and the C-1/C-2 review→ruling→apply state machine. DRY-RUN.
//
//   npx tsx src/scripts/guardrail-c-check.ts
//
// NOTE on the C-1 O4 effect: C-1's own growth metrics {M3,M4,F10} are ABSENT in the
// pharma PG (M3/M4 need 8 consecutive quarters — 0/10 present; F10 needs begin-year
// revenue — 0/10). So C-1's real directives can't move a live peer mean here. The O4
// EFFECT (own kept, peers shift) is shown on M2 (TTM NPM, 10/10 present) as a clearly-
// marked STAND-IN — the mechanic is metric-agnostic and was proven in Part 1.

import { prisma } from "../db/prisma.js";
import { loadMomentumStandalone } from "../scoring/metrics/load.js";
import { computeMomentum } from "../scoring/metrics/momentum.js";
import type { MetricValue } from "../scoring/metrics/types.js";
import { scoreMetricCrossSection, type CrossSectionInput, type CrossSectionMember } from "../scoring/metric-scoring/wire.js";
import { ILLUSTRATIVE_BARS } from "../scoring/metric-scoring/illustrative-bars.js";
import { NO_SUPPRESSION, type WiringConfig, type ScoredMetric } from "../scoring/metric-scoring/types.js";
import { computeLens2 } from "../scoring/lenses/lens-zscore.js";
import { runGuardrailGate } from "../scoring/guardrail/gate.js";
import { resolveOutcome } from "../scoring/guardrail/outcomes.js";
import { recordRuling, applyRuling } from "../scoring/guardrail/review.js";
import { toSuppressionPredicates, suppressedPairs } from "../scoring/guardrail/suppression-adapter.js";
import { writeGuardrailReview } from "../scoring/guardrail/persist.js";
import { registryCoverage, SIGNATURE_REGISTRY } from "../scoring/guardrail/signatures/registry.js";
import type { GuardrailStockInput, SignatureResult, LatestFundamentalInput } from "../scoring/guardrail/types.js";

const PG_NAME = "Large-Cap Pharma";
const MOM_CFG: WiringConfig = { peerMinN: 5, l3MinN: 6, l3Window: 12 };
const SK = "FY26Q4";
const NF = "non_financial" as const;
const RULED_AT = new Date("2026-06-14");
const f2 = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));
const modal = (xs: string[]): string => { const c = new Map<string, number>(); for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""; };

interface MD { stockId: string; symbol: string; mSnap: ReturnType<typeof computeMomentum>; mSeries: Map<string, number[]>; }
function momSeries(rows: Awaited<ReturnType<typeof loadMomentumStandalone>>): Map<string, number[]> {
  const s = [...rows].sort((a, b) => a.qOrdinal - b.qOrdinal); const out = new Map<string, number[]>();
  for (let i = 0; i < s.length; i++) { const r = computeMomentum(s.slice(0, i + 1)); if (!r) continue; for (const m of r.metrics) { if (!out.has(m.key)) out.set(m.key, []); if (m.available && m.value !== null) out.get(m.key)!.push(m.value); } }
  return out;
}
function momMembers(data: MD[], key: string, q: string): CrossSectionMember[] {
  return data.map((d) => { const mv: MetricValue | null = d.mSnap?.metrics.find((m) => m.key === key) ?? null; const aligned = d.mSnap?.snapshotQuarter === q; const av = aligned && !!mv && mv.available; return { stockId: d.stockId, symbol: d.symbol, rawValue: av ? mv!.value : null, available: av, unavailableReason: av ? null : "n/a", ownHistoryValues: d.mSeries.get(key) ?? [] }; });
}
function scoreM2(data: MD[], q: string, suppression: CrossSectionInput["suppression"]): Map<string, ScoredMetric> {
  const b = ILLUSTRATIVE_BARS.M2;
  const xs = scoreMetricCrossSection({ pillar: "momentum", metricKey: "M2", label: "TTM NPM %", snapshot: q, direction: b.direction, bars: b.bars, barNote: b.note, members: momMembers(data, "M2", q), suppression, config: MOM_CFG });
  return new Map(xs.scored.map((s) => [s.stockId, s]));
}

const checks: { name: string; ok: boolean; detail: string }[] = [];
const fy = (over: Partial<LatestFundamentalInput>): LatestFundamentalInput => ({ fiscalYear: "FY26", revenue: 10000, netProfit: 1000, netWorth: 18000, totalAssets: 40000, ...over });
const sigInput = (over: Partial<GuardrailStockInput>): GuardrailStockInput => ({ stockId: "synthetic", symbol: "SYNTH", industryPath: NF, snapshotKey: SK, latestFundamental: null, ...over });

async function main() {
  const pg = await prisma.peerGroup.findFirst({ where: { name: PG_NAME }, include: { stocks: { include: { stock: true } } } });
  if (!pg) { console.log(`PG "${PG_NAME}" not found`); await prisma.$disconnect(); return; }
  const data: MD[] = [];
  for (const sp of pg.stocks) { const rows = await loadMomentumStandalone(sp.stock.id); data.push({ stockId: sp.stock.id, symbol: sp.stock.symbol, mSnap: computeMomentum(rows), mSeries: momSeries(rows) }); }
  const q = modal(data.map((d) => d.mSnap?.snapshotQuarter ?? "").filter(Boolean));
  const bySym = (s: string) => data.find((d) => d.symbol === s)!;
  const cov = registryCoverage();

  console.log(`${"═".repeat(116)}\nPART 2 — CATEGORY-C SIGNATURES (C-1 structural step · C-2 share-count)`);
  console.log(`Registry: BUILT [${cov.built.join(", ")}] · declared-not-built [${cov.declared.length ? cov.declared.join(", ") : "(none)"}]`);
  console.log(`⚠ DRY-RUN. C fixtures SYNTHETIC; C-1 O4 effect shown on M2 (10/10 present) as a marked stand-in.`);
  checks.push({ name: "REGISTRY: all 10 signatures built:true (A-1..A-4, B-1..B-5, C-1, C-2); none declared-not-built", ok: cov.built.length === 11 && cov.declared.length === 0 && SIGNATURE_REGISTRY.every((d) => d.built), detail: `built=${cov.built.length} (${cov.built.join(",")}); not-built=${cov.declared.length}` });

  // ════════════════════════════════════════════════════════════════════════════
  // PART 2A — C-1 (revenue/asset step → O4 + O3, REVIEW)
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(116)}\nPART 2A — C-1 STRUCTURAL STEP (merger/demerger) · O4 + O3 · REVIEW\n`);

  const subject = bySym("LUPIN");
  // SYNTHETIC merger: revenue +80% YoY, assets flat, no operating/tax lines (so only C-1 evaluates).
  const c1Input = sigInput({
    stockId: subject.stockId, symbol: subject.symbol,
    latestFundamental: fy({ revenue: 18000, netProfit: 1800, netWorth: 18000, totalAssets: 42000 }),
    priorFundamental: fy({ revenue: 10000, netProfit: 1000, netWorth: 17000, totalAssets: 40000 }),
    corporateAction: { hasNearbyEvent: true },
  });
  const c1Gate = runGuardrailGate(c1Input);
  const pending = c1Gate.pendingReviews[0];
  console.log(`  detect [SYNTHETIC merger: revenue 10000→18000 (+80%), corporate event nearby]:`);
  console.log(`    → events=${c1Gate.events.length} (tier=${c1Gate.events[0]?.tier}, proposed ${c1Gate.events[0]?.outcome}) · directives=${c1Gate.directives.length} · PENDING=${c1Gate.pendingReviews.length}`);
  console.log(`    proposed O4 map (growth metrics): [${pending?.result.affectedMetrics.map((m) => m.metricKey).join(", ")}]  ⇒ nothing applied yet (REVIEW)`);
  checks.push({ name: "C-1 detect → REVIEW: O4 proposed on {M3,M4,F10}, audit event tier=review, 0 directives, 1 pending", ok: c1Gate.events[0]?.tier === "review" && c1Gate.events[0]?.outcome === "O4" && c1Gate.directives.length === 0 && c1Gate.pendingReviews.length === 1 && ["M3", "M4", "F10"].every((k) => pending.result.affectedMetrics.some((m) => m.metricKey === k)), detail: `outcome=${c1Gate.events[0]?.outcome} tier=${c1Gate.events[0]?.tier} map=[${pending?.result.affectedMetrics.map((m) => m.metricKey).join(",")}]` });

  // ruling UPHELD → O4 directives for {M3,M4,F10}, each own=FALSE / peer=TRUE
  const review = recordRuling(pending, { operatorId: "op-aman", ruling: "upheld", reason: "Confirmed merger; pause peer growth comparison.", ruledAt: RULED_AT });
  const applied = applyRuling(pending, "upheld", { stockId: subject.stockId, snapshotKey: SK });
  const plan = await writeGuardrailReview(review, applied, { dryRun: true });
  console.log(`\n  ruling UPHELD → ${applied.note}`);
  for (const p of suppressedPairs(applied.directives, SK)) console.log(`    directive: ${p.metricKey} own=${p.own} peer=${p.peer} (O4 = peer-only)`);
  for (const n of plan.notes) console.log(`    • ${n}`);
  checks.push({ name: "C-1 UPHELD → O4 directives for {M3,M4,F10}, each excludeFromOwnScore=FALSE, excludeFromPeerMean=TRUE", ok: applied.applied && applied.directives.length === 3 && applied.directives.every((d) => d.excludeFromOwnScore === false && d.excludeFromPeerMean === true), detail: `${applied.directives.length} O4 directives, all own=false/peer=true` });

  // ── C-1 O4 EFFECT on real scoring (M2 stand-in — C-1's M3/M4/F10 are absent here) ──
  console.log(`\n  ── C-1 O4 effect on REAL scoring (M2 TTM NPM stand-in: M3/M4/F10 are 0/10 present in pharma) ──`);
  const m2v = subject.mSnap?.metrics.find((m) => m.key === "M2")?.value;
  console.log(`    [STAND-IN] applying C-1's O4 shape to LUPIN's present M2=${f2(m2v)} (the growth metric it WOULD hit post-merger):`);
  const o4StandIn = resolveOutcome({ signatureKey: "C-1", category: "C", tier: "review", fired: true, outcome: "O4", affectedMetrics: [{ metricKey: "M2", pillar: "momentum", reason: "STAND-IN for C-1 growth metric" }], triggeringValues: { STANDIN: true }, explanation: "stand-in" }, { stockId: subject.stockId, snapshotKey: SK });
  const o4Pred = toSuppressionPredicates(o4StandIn.directives, SK);
  const baseM2 = scoreM2(data, q, NO_SUPPRESSION);
  const o4M2 = scoreM2(data, q, o4Pred);
  const probe = bySym("SUNPHARMA");
  const subBase = baseM2.get(subject.stockId)!, subO4 = o4M2.get(subject.stockId)!;
  const prBase = baseM2.get(probe.stockId)!, prO4 = o4M2.get(probe.stockId)!;
  console.log(`    LUPIN own M2 score: ${f2(subBase.metricScore)} → ${f2(subO4.metricScore)} (UNCHANGED; state=${subO4.scoreState}, inPeerStats ${subBase.includedInPeerStats}→${subO4.includedInPeerStats})`);
  console.log(`    peers' M2 cross-section: N ${prBase.peerStats!.sampleN}→${prO4.peerStats!.sampleN}, μ ${f2(prBase.peerStats!.mean, 3)}→${f2(prO4.peerStats!.mean, 3)}, ${probe.symbol} L2 ${f2(prBase.l2Score, 3)}→${f2(prO4.l2Score, 3)}`);
  {
    // hand-verify peer μ excl LUPIN
    const allM2 = data.map((d) => ({ sym: d.symbol, v: d.mSnap?.metrics.find((m) => m.key === "M2")?.value ?? null })).filter((x) => x.v !== null) as { sym: string; v: number }[];
    const excl = allM2.filter((x) => x.sym !== "LUPIN").map((x) => x.v);
    const muEx = excl.reduce((a, b) => a + b, 0) / excl.length;
    const ownUnchanged = Math.abs((subO4.metricScore ?? 0) - (subBase.metricScore ?? 0)) < 1e-9 && subO4.scoreState === "scored";
    const peersShift = prO4.peerStats!.sampleN === prBase.peerStats!.sampleN - 1 && Math.abs(prO4.peerStats!.mean - muEx) < 1e-9 && prO4.l2Score !== prBase.l2Score;
    console.log(`    HAND: μ(excl LUPIN)=${muEx.toFixed(4)} vs wired ${f2(prO4.peerStats!.mean, 4)} → ${Math.abs(prO4.peerStats!.mean - muEx) < 1e-9 ? "✓" : "✗"}`);
    checks.push({ name: "C-1 O4 EFFECT (M2 stand-in): merger stock keeps OWN score, value leaves the PEER mean (N−1, μ shifts, hand==wired)", ok: ownUnchanged && peersShift, detail: `LUPIN own ${f2(subBase.metricScore)}==${f2(subO4.metricScore)}; peers N ${prBase.peerStats!.sampleN}→${prO4.peerStats!.sampleN} μ→${f2(prO4.peerStats!.mean, 3)}(hand ${muEx.toFixed(3)})` });
  }

  // ── C-1 OVERRIDDEN (second case) → nothing applied ──
  const c1Override = applyRuling(pending, "overridden", { stockId: subject.stockId, snapshotKey: SK });
  console.log(`\n  ruling OVERRIDDEN (alt case) → ${c1Override.note}`);
  checks.push({ name: "C-1 OVERRIDDEN → nothing applied (0 directives), decision logged", ok: !c1Override.applied && c1Override.directives.length === 0, detail: `applied=${c1Override.applied} directives=${c1Override.directives.length}` });

  // ════════════════════════════════════════════════════════════════════════════
  // PART 2B — C-2 (share-count: bonus/split → O1 data-adjust; rights → O3 review)
  // ════════════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(116)}\nPART 2B — C-2 SHARE-COUNT (bonus/split = data-adjustment; rights = dilution)\n`);

  // bonus/split → O1 (AUTO, logged, NO suppression — price already split-adjusted)
  const c2Bonus = runGuardrailGate(sigInput({ symbol: "C2-SPLIT", corporateAction: { eventTypes: ["split"], shareCountChangePct: 100 } }));
  console.log(`  C-2 [SYNTHETIC split, shares +100%] → ${c2Bonus.events[0]?.outcome} (${c2Bonus.events[0]?.tier}) · directives=${c2Bonus.directives.length} · pending=${c2Bonus.pendingReviews.length} · annotations=${c2Bonus.annotations.length}`);
  console.log(`    ⇒ DATA-ADJUSTMENT: price already split-adjusted in DailyPrice → score normally, logged, NO suppression`);
  checks.push({ name: "C-2 bonus/split → O1 AUTO, logged, 0 directives, 0 review (data-adjustment, not a distortion)", ok: c2Bonus.events[0]?.outcome === "O1" && c2Bonus.events[0]?.tier === "auto" && c2Bonus.directives.length === 0 && c2Bonus.pendingReviews.length === 0, detail: `outcome=${c2Bonus.events[0]?.outcome} tier=${c2Bonus.events[0]?.tier} directives=${c2Bonus.directives.length}` });

  // rights → O3 (REVIEW) → upheld → annotation (NO suppression: per-share metrics not in F/M set)
  const c2Rights = runGuardrailGate(sigInput({ symbol: "C2-RIGHTS", corporateAction: { eventTypes: ["rights"], shareCountChangePct: 35 } }));
  const rightsPending = c2Rights.pendingReviews[0];
  console.log(`\n  C-2 [SYNTHETIC rights issue, shares +35%] → ${c2Rights.events[0]?.outcome} (${c2Rights.events[0]?.tier}) · directives=${c2Rights.directives.length} · PENDING=${c2Rights.pendingReviews.length}`);
  const rightsReview = recordRuling(rightsPending, { operatorId: "op-aman", ruling: "upheld", reason: "Real dilution; flag per-share.", ruledAt: RULED_AT });
  const rightsApplied = applyRuling(rightsPending, "upheld", { stockId: "C2-RIGHTS", snapshotKey: SK });
  console.log(`    ruling UPHELD → ${rightsApplied.note}`);
  console.log(`    (per-share metrics EPS/BVPS are NOT in the F/M set → annotation only, 0 suppressions)`);
  checks.push({ name: "C-2 rights → O3 REVIEW → upheld → annotation, 0 suppressions (per-share metrics not in F/M set)", ok: c2Rights.events[0]?.outcome === "O3" && c2Rights.events[0]?.tier === "review" && rightsApplied.applied && rightsApplied.annotations.length === 1 && rightsApplied.directives.length === 0, detail: `outcome=${c2Rights.events[0]?.outcome} tier=${c2Rights.events[0]?.tier}; upheld annotations=${rightsApplied.annotations.length} suppressions=${rightsApplied.directives.length}` });

  // ── CONFIRMATIONS ──
  console.log(`\n${"═".repeat(116)}\nCONFIRMATIONS\n`);
  console.log(`  • All 10 signatures live in the registry: ${cov.built.join(", ")}`);
  console.log(`  • Gate runs all applicable: C-1 (review/O4), C-2 (auto/O1 or review/O3) routed correctly by result.tier.`);
  console.log(`  • O4 works end-to-end: C-1 upheld → peer-only directives → merger stock keeps own, leaves peer mean.`);
  console.log(`  • Review-tier reuses the proven B-5 machine (proposeReview→recordRuling→applyRuling).`);
  console.log(`  • Single suppression source intact: one score_suppressions row, two booleans (C-1 O4 sets peer-only).`);

  console.log(`\n${"═".repeat(116)}\nRESULTS\n`);
  for (const c of checks) console.log(`  ${c.ok ? "✓ PASS" : "✗ FAIL"}  ${c.name}\n           ${c.detail}`);
  const allPass = checks.every((c) => c.ok);
  console.log(`\n  ${allPass ? "✓ ALL CHECKS PASS" : "✗ A CHECK FAILED"}\n`);

  console.log(`${"═".repeat(116)}\nFLAGS\n`);
  for (const fl of FLAGS) console.log("  • " + fl + "\n");
  await prisma.$disconnect();
  if (!allPass) process.exitCode = 1;
}

const FLAGS: string[] = [
  "C-2 bonus/split is a DATA-ADJUSTMENT, NOT a distortion (confirmed per the prompt) → O1, no suppression. Bonus/split are cosmetic and ALREADY reflected in split-adjusted DailyPrice; suppressing them would be wrong. We score normally and log the event. Rights/major issuance is real dilution → O3 annotate (REVIEW). C-2 NEVER writes a suppression directive.",
  "C-2's target 'per-share metrics' (EPS, book-value-per-share) are NOT in the current metric set (Foundation F1–F10 / Momentum M1–M5 contain no per-share metric). So even the rights O3 case has no metric to suppress — it is annotation-only (flags the dilution). If per-share metrics are added later, C-2 rights could attach them to the annotation; no suppression is implied by the doc regardless.",
  "C-1 IS THE O4 CASE — proven before build (Part 1). A merger makes the growth metric jump; that is real for the stock (kept in own-score) but inorganic (removed from the peer mean others see). O4 = excludeFromOwnScore=false, excludeFromPeerMean=true, from the ONE score_suppressions row. Map (actual keys): {M3 Revenue YoY, M4 NP YoY, F10 Revenue 3y CAGR}.",
  "C-1's own growth metrics are ABSENT in the pharma PG: M3/M4 need 8 consecutive quarters (0/10 present) and F10 needs begin-year revenue (0/10). So C-1's real directives cannot move a live peer mean HERE. The O4 EFFECT (own kept, peers shift) is demonstrated on M2 (TTM NPM, 10/10 present) as a clearly-marked STAND-IN; the mechanic is metric-agnostic and was hand-verified in Part 1 on F1. In a PG with ≥8 quarters of history, C-1's own M3/M4 directives would move the peer mean directly.",
  "C-1 '> 30% step' is the MECHANICAL trigger; 'no organic driver / discontinuous' and the PG-membership question are OPERATOR judgments (the §3 merger/demerger rulebook) — which is why C-1 is REVIEW (routes through review.ts; nothing applies until ruled). The CorporateEvent corroboration is optional ('ideally corroborated') and recorded in triggeringValues.",
  "'O4 + O3 annotate' (C-1) is modeled as O4 with its transparency note (the explanation IS the flag), consistent with B-1's 'O2 + O3'. No separate O3 outcome is emitted (it would double-count). The 'growth metrics held until clean post-event periods' is a temporal/operational note — the peer-comparison resumes when post-event periods accumulate (a future re-evaluation), not a separate gate action.",
  "C-2 has a DYNAMIC tier: result.tier=auto for the O1 bonus/split firing, review for the O3 rights firing. The gate routes on result.tier (not the static descriptor tier), so one signature handles both. The registry descriptor lists C-2 as auto (its common case).",
  "C-1 BANKING VARIANT (PG5/6/7) reads the asset base (advances/deposits/total assets), not revenue (§3). Not built here — banking PGs need the banking input wiring. The non-financial C-1 covers revenue OR totalAssets steps; the banking advances/deposits step is the same O4 mechanic on bank-specific fields.",
  "ALL 10 SIGNATURES NOW LIVE: A-1, A-2, A-3, A-4, B-1, B-2, B-3, B-4, B-5, C-1, C-2 (11 registry entries — the doc's '10 signatures' counts the C-2 bonus/split + rights as one signature with two outcomes). The gate runs all; O2/O3/O4/O5/O6 all exercised; auto applies immediately, review (B-5, C-1, C-2-rights) waits for ruling; one score_suppressions row with two independent booleans is the single source.",
];

main().catch((e) => { console.error(e); process.exit(1); });
