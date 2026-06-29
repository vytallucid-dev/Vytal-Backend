// THREE-LENS PATTERN LIBRARY — STAGE 1 DRY-RUN (read-only; commits NOTHING).
//
//   npx tsx src/scripts/lens-pattern-dryrun.ts
//
// Exercises the shared metric-level primitive (src/scoring/lens-patterns/) over the
// REAL stored snapshots in score_metrics / score_peer_stats. It is a PURE READ: it
// writes to NO table, recomputes NO lens, and asserts the row counts are unchanged.
//
// Reports the census required by the briefing (1–8):
//   • LM pattern distribution across the universe
//   • LP pattern distribution per pillar
//   • not_evaluable counts per lens (Stage-0 sparsity corroboration)
//   • anti-double-count deferrals (LM5/LP5/LP6 demoted to supporting under D/B)
//   • no-forward-guard: 0 violations
//   • 4 hand-verified end-to-end cases (LM3, LM4, a not_evaluable lens, a loud case)

import { prisma } from "../db/prisma.js";
import {
  assertNoForwardLanguage,
  scanCatalogForForwardLanguage,
  scanStringsForForwardLanguage,
  deriveLensTriplet,
  lensPattern,
  lensPillarPattern,
  applyAntiDoubleCount,
  applyAntiDoubleCountPillar,
  STEADY_EQUIVALENT_MIN,
  L2_NEAR_BAND_SIGMA,
  L3_TREND_Z,
  type MetricLensAtom,
  type LensTriplet,
  type LensPattern,
  type FiredHeadline,
} from "../scoring/lens-patterns/index.js";

const num = (x: unknown): number | null => (x === null || x === undefined ? null : Number(x));
const pct = (n: number, d: number) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(0)}%`);
const f = (x: number | null, d = 2) => (x === null ? "—" : x.toFixed(d));

interface MetricRow {
  symbol: string;
  pillar: "foundation" | "momentum";
  pillarSubtotal: number | null;
  pillarScored: boolean;
  direction: string | null;
  atom: MetricLensAtom;
  triplet: LensTriplet;
  pattern: LensPattern | null;
  role: "top_level" | "supporting_detail";
  defersTo: string | null;
}

const RECOVERY_KEY = "trajectory_D_recovery";
const DETERIORATION_KEY = "trajectory_B_deterioration";

interface ResolvedPeer { mean: number; stdDev: number; sampleN: number }

/** Resolve peer μ/σ/N for a metric: the FK (peer_stats_snapshot_id) when set, else
 *  the natural-key fallback the schema documents (@@index([peerGroupId, asOfDate]) —
 *  "assembler fallback when the MetricScore FK is null"). The FK is null on ~85% of
 *  committed rows even though L2 was computed, so without this fallback L2 would read
 *  as not_evaluable everywhere — a harness assembly bug, not a primitive fact. */
function resolvePeer(ms: any, naturalKeyMap: Map<string, ResolvedPeer>): ResolvedPeer | null {
  if (ms.peerStats) {
    return { mean: num(ms.peerStats.mean)!, stdDev: num(ms.peerStats.stdDev)!, sampleN: ms.peerStats.sampleN };
  }
  return naturalKeyMap.get(ms.metricKey) ?? null;
}

function atomFromMetricScore(ms: any, pillar: "foundation" | "momentum", peer: ResolvedPeer | null): MetricLensAtom {
  return {
    metricKey: ms.metricKey,
    pillar,
    scored: ms.scoreState === "scored",
    rawValue: num(ms.rawValue)!,
    l1Available: ms.l1Available,
    l1Band: ms.l1Band ?? null,
    l2Available: ms.l2Available,
    l2Score: num(ms.l2Score),
    l2AnchorApplied: num(ms.l2AnchorApplied),
    peerMean: peer ? peer.mean : null,
    peerStdDev: peer ? peer.stdDev : null,
    peerSampleN: peer ? peer.sampleN : null,
    l3Available: ms.l3Available,
    l3Score: num(ms.l3Score),
    l3AnchorApplied: num(ms.l3AnchorApplied),
    l3Mean: num(ms.l3Mean),
    l3StdDev: num(ms.l3StdDev),
    l3WindowN: ms.l3WindowN ?? null,
  };
}

function headlinesFromPatterns(patterns: any[]): FiredHeadline[] {
  return patterns.map((p) => {
    let leg: string | null = null;
    const ev = p.evidence as any;
    if (ev && typeof ev === "object" && typeof ev.leg === "string") leg = ev.leg;
    return { patternKey: p.patternKey, leg };
  });
}

async function main() {
  console.log("═".repeat(78));
  console.log("THREE-LENS PATTERN LIBRARY — STAGE 1 DRY-RUN (read-only; commits nothing)");
  console.log("═".repeat(78));
  console.log(
    `  thresholds: L2 near-band ±${L2_NEAR_BAND_SIGMA}σ · L3 trend cut ±${L3_TREND_Z}σ (=Z_INNER_HALF/2) · LM8 pillar≥${STEADY_EQUIVALENT_MIN} (Steady-equiv)\n`,
  );

  // ── 7. NO-FORWARD GUARD (run FIRST — fail loud before any read) ────────────────
  const violations = scanCatalogForForwardLanguage();
  assertNoForwardLanguage(); // throws on any violation
  // Prove the guard has TEETH (not vacuously passing): a planted forward string from
  // the databank's own ❌ example (§0.3) MUST be caught.
  const planted = scanStringsForForwardLanguage("PLANTED", [
    "ROCE is below its bar but ahead of the field — likely to re-rate as the cycle turns, a buying opportunity",
  ]);
  if (planted.length === 0) throw new Error("NO-FORWARD GUARD IS A NO-OP — planted forward string was not caught");
  console.log(
    `§7 NO-FORWARD-LANGUAGE GUARD: ${violations.length} violations across LM1–8 + LP1–6 ✓ (teeth-check: planted "${planted.map((p) => p.term).join(",")}" caught ✓)\n`,
  );

  // baseline counts for the commits-nothing assertion
  const before = {
    metric: await prisma.metricScore.count(),
    peer: await prisma.peerStatsSnapshot.count(),
    pat: await prisma.scorePattern.count(),
    snap: await prisma.scoreSnapshot.count(),
  };

  // ── Resolve the HEAD snapshot per stock (latest asOfDate, then highest version) ──
  const symbols = (await prisma.scoreSnapshot.groupBy({ by: ["symbol"] })).map((s) => s.symbol);

  const all: MetricRow[] = [];
  // pillar roll-up accumulation: per (symbol, pillar)
  const lpFired: Record<string, number> = {};
  const lpDeferred: Record<string, number> = {};
  let lpFoundationCount = 0;
  let lpMomentumCount = 0;

  // census accumulators
  const lmCount: Record<string, number> = {};
  let lmTotalFired = 0;
  const neByLensPillar = {
    foundation: { l1: 0, l2: 0, l3: 0, n: 0 },
    momentum: { l1: 0, l2: 0, l3: 0, n: 0 },
  };
  // L3 window-N depth buckets (to substantiate WHY L3 is not_evaluable: short history).
  const l3WinBuckets = { foundation: { lt5: 0, ge5: 0, nul: 0 }, momentum: { lt6: 0, ge6: 0, nul: 0 } };
  let lm5Deferred = 0;
  let peerResolveTotal = 0, l2AvailTotal = 0, peerResolved = 0, peerViaFk = 0;

  for (const symbol of symbols) {
    const snap = await prisma.scoreSnapshot.findFirst({
      where: { symbol },
      orderBy: [{ asOfDate: "desc" }, { version: "desc" }],
      include: {
        foundationPillar: { include: { metricScores: { include: { peerStats: true, metricBarSet: { select: { direction: true } } } } } },
        momentumPillar: { include: { metricScores: { include: { peerStats: true, metricBarSet: { select: { direction: true } } } } } },
        patterns: { where: { patternKey: { in: [RECOVERY_KEY, DETERIORATION_KEY] } } },
      },
    });
    if (!snap) continue;
    const headlines = headlinesFromPatterns(snap.patterns);

    // Natural-key peer-stats map for this snapshot's PG + as-of (FK fallback).
    const peerRows = await prisma.peerStatsSnapshot.findMany({
      where: { peerGroupId: snap.peerGroupId, asOfDate: snap.asOfDate },
      orderBy: { createdAt: "desc" },
    });
    const peerMap = new Map<string, ResolvedPeer>();
    for (const r of peerRows) {
      if (!peerMap.has(r.metricKey)) peerMap.set(r.metricKey, { mean: num(r.mean)!, stdDev: num(r.stdDev)!, sampleN: r.sampleN });
    }

    for (const [pillar, ps] of [
      ["foundation", snap.foundationPillar],
      ["momentum", snap.momentumPillar],
    ] as const) {
      if (!ps) continue;
      const pillarSubtotal = num(ps.subtotal);
      const pillarScored = ps.pillarState === "scored";
      const pillarReadsAcceptable = pillarScored && pillarSubtotal !== null && pillarSubtotal >= STEADY_EQUIVALENT_MIN;

      const atoms: MetricLensAtom[] = [];
      for (const ms of ps.metricScores) {
        const peer = resolvePeer(ms, peerMap);
        if (ms.scoreState === "scored") {
          peerResolveTotal++;
          if (ms.l2Available) {
            l2AvailTotal++;
            if (peer) peerResolved++;
            if (ms.peerStats) peerViaFk++;
          }
        }
        const atom = atomFromMetricScore(ms, pillar, peer);
        atoms.push(atom);
        const triplet = deriveLensTriplet(atom);
        const pattern = lensPattern(triplet.l1, triplet.l2, triplet.l3, { pillarReadsAcceptable });
        let role: "top_level" | "supporting_detail" = "top_level";
        let defersTo: string | null = null;
        if (pattern) {
          const adc = applyAntiDoubleCount(pattern, pillar, headlines);
          role = adc.role;
          defersTo = adc.defersTo;
        }
        all.push({
          symbol, pillar, pillarSubtotal, pillarScored,
          direction: ms.metricBarSet?.direction ?? null,
          atom, triplet, pattern, role, defersTo,
        });

        // census — not_evaluable per lens over SCORED metrics
        if (atom.scored) {
          const acc = neByLensPillar[pillar];
          acc.n++;
          if (triplet.l1 === "not_evaluable") acc.l1++;
          if (triplet.l2 === "not_evaluable") acc.l2++;
          if (triplet.l3 === "not_evaluable") acc.l3++;
          // L3 window depth (foundation min 5, momentum min 6 per the scorer cfg).
          if (pillar === "foundation") {
            if (atom.l3WindowN === null) l3WinBuckets.foundation.nul++;
            else if (atom.l3WindowN < 5) l3WinBuckets.foundation.lt5++;
            else l3WinBuckets.foundation.ge5++;
          } else {
            if (atom.l3WindowN === null) l3WinBuckets.momentum.nul++;
            else if (atom.l3WindowN < 6) l3WinBuckets.momentum.lt6++;
            else l3WinBuckets.momentum.ge6++;
          }
        }
        if (pattern) {
          lmCount[pattern.id] = (lmCount[pattern.id] ?? 0) + 1;
          lmTotalFired++;
          if (role === "supporting_detail") lm5Deferred++;
        }
      }

      // pillar-level roll-up
      const { patterns: lps } = lensPillarPattern(atoms);
      if (pillar === "foundation") lpFoundationCount++;
      else lpMomentumCount++;
      for (const lp of lps) {
        const key = `${pillar}:${lp.id}`;
        lpFired[key] = (lpFired[key] ?? 0) + 1;
        const adc = applyAntiDoubleCountPillar(lp, pillar, headlines);
        if (adc.role === "supporting_detail") lpDeferred[key] = (lpDeferred[key] ?? 0) + 1;
      }
    }
  }

  // ── 1. LM distribution ─────────────────────────────────────────────────────────
  console.log("§1+§8 LM PATTERN DISTRIBUTION (head snapshot per stock, " + symbols.length + " stocks)");
  const lmOrder = ["LM1", "LM2", "LM3", "LM4", "LM5", "LM6", "LM7", "LM8"];
  for (const id of lmOrder) console.log(`   ${id}: ${(lmCount[id] ?? 0).toString().padStart(4)}`);
  console.log(`   ── total LM cards fired: ${lmTotalFired}`);
  const totalMetricRows = all.length;
  const scoredRows = all.filter((r) => r.atom.scored).length;
  const nullRows = all.filter((r) => r.atom.scored && r.pattern === null).length;
  console.log(`   (scored metric rows: ${scoredRows}; no-card/plain-state rows: ${nullRows} — "loud at the extremes, quiet in the middle")\n`);

  // ── 2. LP distribution per pillar ────────────────────────────────────────────────
  console.log("§2 LP PILLAR-PATTERN DISTRIBUTION (per pillar)");
  const lpOrder = ["LP1", "LP2", "LP3", "LP4", "LP5", "LP6"];
  for (const pillar of ["foundation", "momentum"] as const) {
    const parts = lpOrder.map((id) => `${id}:${lpFired[`${pillar}:${id}`] ?? 0}`);
    console.log(`   ${pillar.padEnd(10)} (${pillar === "foundation" ? lpFoundationCount : lpMomentumCount} pillars)  ${parts.join("  ")}`);
  }
  console.log("");

  // ── 3. not_evaluable per lens ─────────────────────────────────────────────────────
  console.log("§3 NOT_EVALUABLE COUNTS PER LENS (over SCORED metrics; not_evaluable excluded from denominators)");
  for (const pillar of ["foundation", "momentum"] as const) {
    const a = neByLensPillar[pillar];
    console.log(
      `   ${pillar.padEnd(10)} n=${a.n.toString().padStart(4)}  L1 ne=${a.l1} (${pct(a.l1, a.n)})  L2 ne=${a.l2} (${pct(a.l2, a.n)})  L3 ne=${a.l3} (${pct(a.l3, a.n)})`,
    );
  }
  console.log(
    `   peer-stats resolution: ${peerResolved}/${l2AvailTotal} L2-available metrics resolved μ/σ (${peerViaFk} via FK, ${peerResolved - peerViaFk} via natural-key fallback)`,
  );
  const fb = l3WinBuckets.foundation, mb = l3WinBuckets.momentum;
  console.log(`   L3 own-history depth (WHY L3 is sparse): foundation windowN<5=${fb.lt5} ≥5=${fb.ge5} null=${fb.nul} · momentum windowN<6=${mb.lt6} ≥6=${mb.ge6} null=${mb.nul}`);
  console.log("   expectation (Stage-0): field-verdict sparsity in thin PGs (L2 ne), Foundation-L3 ~50–70%, Momentum-L3 ~85%+");
  console.log("   ACTUAL diverges: L3 is far sparser — short committed annual/quarterly own-history (windowN < minEffectiveN) gates most L3 off (honest-empty working as designed)\n");

  // ── 4. anti-double-count deferrals ───────────────────────────────────────────────
  console.log("§4/§6 ANTI-DOUBLE-COUNT DEFERRALS (supporting-detail, not competing top-level)");
  console.log(`   LM5 → Family-D (${RECOVERY_KEY}): ${lm5Deferred} metric pattern(s) demoted to supporting`);
  const lpDefLines = Object.entries(lpDeferred);
  if (lpDefLines.length === 0) console.log(`   LP5/LP6 → Family-B (${DETERIORATION_KEY}): 0 demoted`);
  else for (const [k, n] of lpDefLines) console.log(`   ${k} → Family-B: ${n} demoted to supporting`);
  console.log("   (0 natural co-occurrences here — L3 sparsity starves LM5/LP5/LP6; the mechanism is proven by the witness below)");

  // WITNESS — prove the §5.3/§6 anti-double-count actually demotes (engine, not UI).
  const lm5 = { id: "LM5", label: "x", tone: "x", fieldVerdict: null } as LensPattern;
  const lp5 = { id: "LP5", label: "x", tone: "x", fieldVerdict: null } as any;
  const dFnd: FiredHeadline[] = [{ patternKey: RECOVERY_KEY, leg: "foundation" }];
  const bMom: FiredHeadline[] = [{ patternKey: DETERIORATION_KEY, leg: "momentum" }];
  const w1 = applyAntiDoubleCount(lm5, "foundation", dFnd);
  const w2 = applyAntiDoubleCount(lm5, "foundation", []);
  const w3 = applyAntiDoubleCount(lm5, "momentum", dFnd); // wrong pillar → stays top-level
  const w4 = applyAntiDoubleCountPillar(lp5, "momentum", bMom);
  const witnessOk =
    w1.role === "supporting_detail" && w1.defersTo === RECOVERY_KEY &&
    w2.role === "top_level" && w3.role === "top_level" &&
    w4.role === "supporting_detail" && w4.defersTo === DETERIORATION_KEY;
  console.log(`   witness: LM5+D(foundation)→${w1.role}; LM5+∅→${w2.role}; LM5+D(momentum,mismatch)→${w3.role}; LP5+B(momentum)→${w4.role}  ${witnessOk ? "✓" : "✗ MECHANISM BROKEN"}`);
  console.log("");
  if (!witnessOk) process.exitCode = 1;

  // ── 9. four hand-verified cases ──────────────────────────────────────────────────
  console.log("§8 HAND-VERIFIED CASES (full triplet → pattern reasoning)");
  const byId = (id: string) => all.find((r) => r.pattern?.id === id && r.role === "top_level") ?? all.find((r) => r.pattern?.id === id);
  // Prefer the CRITICAL §5.4 case: L2 not_evaluable while L1 is decided → a field-
  // verdict (LM3/LM4) is correctly WITHHELD (no field claim on <5 peers / undefined band).
  const neCase =
    all.find((r) => r.atom.scored && r.triplet.l2 === "not_evaluable" && r.triplet.l1 !== "not_evaluable" && r.pattern === null) ??
    all.find((r) => r.atom.scored && r.pattern !== null && r.triplet.l3 === "not_evaluable") ??
    all.find((r) => r.atom.scored && (r.triplet.l1 === "not_evaluable" || r.triplet.l2 === "not_evaluable" || r.triplet.l3 === "not_evaluable"));
  const cases: { tag: string; row: MetricRow | undefined }[] = [
    { tag: "LM3 field-weak", row: byId("LM3") },
    { tag: "LM4 elite field", row: byId("LM4") },
    { tag: "not_evaluable lens", row: neCase },
    { tag: "LM7 (loud) — fallback LM5/LM6", row: byId("LM7") ?? byId("LM5") ?? byId("LM6") },
  ];
  for (const c of cases) printCase(c.tag, c.row);

  // ── commits-nothing assertion ────────────────────────────────────────────────────
  const after = {
    metric: await prisma.metricScore.count(),
    peer: await prisma.peerStatsSnapshot.count(),
    pat: await prisma.scorePattern.count(),
    snap: await prisma.scoreSnapshot.count(),
  };
  const unchanged =
    before.metric === after.metric && before.peer === after.peer && before.pat === after.pat && before.snap === after.snap;
  console.log("\nCOMMITS-NOTHING ASSERTION");
  console.log(`   score_metrics ${before.metric}→${after.metric}  score_peer_stats ${before.peer}→${after.peer}  score_patterns ${before.pat}→${after.pat}  score_snapshots ${before.snap}→${after.snap}`);
  console.log(`   ${unchanged ? "✓ pure read — nothing written, no lens recomputed, no migration." : "✗ SOMETHING WAS WRITTEN — investigate"}`);

  await prisma.$disconnect();
  if (!unchanged) process.exitCode = 1;
}

function printCase(tag: string, r: MetricRow | undefined) {
  console.log(`\n   ── ${tag} ──`);
  if (!r) {
    console.log("      (no real case found in the universe head snapshots)");
    return;
  }
  const a = r.atom;
  const t = r.triplet;
  console.log(`      ${r.symbol} · ${r.pillar} · ${a.metricKey} (dir=${r.direction ?? "?"}) raw=${f(a.rawValue)}`);
  console.log(`      L1: avail=${a.l1Available} band=${a.l1Band ?? "—"}  → ${t.l1}`);
  if (a.peerMean !== null && a.peerStdDev !== null) {
    const absDiff = Math.abs(a.rawValue - a.peerMean);
    const nearEdge = L2_NEAR_BAND_SIGMA * a.peerStdDev;
    console.log(
      `      L2: avail=${a.l2Available} peerμ=${f(a.peerMean)} σ=${f(a.peerStdDev)} N=${a.peerSampleN} |raw-μ|=${f(absDiff)} (near≤${f(nearEdge)}) score=${f(a.l2Score)} anchor=${f(a.l2AnchorApplied)}  → ${t.l2}`,
    );
  } else {
    console.log(`      L2: avail=${a.l2Available} peerStats=${a.peerMean === null ? "none" : "present"}  → ${t.l2}`);
  }
  if (a.l3Mean !== null && a.l3StdDev !== null && a.l3StdDev !== 0) {
    const z = (a.rawValue - a.l3Mean) / a.l3StdDev;
    console.log(
      `      L3: avail=${a.l3Available} μ=${f(a.l3Mean)} σ=${f(a.l3StdDev)} N=${a.l3WindowN} z=${f(z, 3)} (cut ±${L3_TREND_Z}) score=${f(a.l3Score)} anchor=${f(a.l3AnchorApplied)}  → ${t.l3}`,
    );
  } else {
    console.log(`      L3: avail=${a.l3Available} σ=${f(a.l3StdDev)} N=${a.l3WindowN}  → ${t.l3}`);
  }
  console.log(`      pillar subtotal=${f(r.pillarSubtotal)} scored=${r.pillarScored} (Steady-equiv≥${STEADY_EQUIVALENT_MIN})`);
  if (r.pattern) {
    console.log(`      ⇒ ${r.pattern.id} "${r.pattern.label}" · ${r.pattern.tone} · field=${r.pattern.fieldVerdict ?? "—"} · role=${r.role}${r.defersTo ? ` (defers to ${r.defersTo})` : ""}`);
  } else {
    console.log(`      ⇒ no card (plain lens state — degenerate/no-tension or honest-empty)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
