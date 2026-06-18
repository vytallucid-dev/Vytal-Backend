// STAGE 5 (DRY-RUN ONLY) — first REAL Foundation+Momentum scores for the 7 ready PGs,
// computed on the COMMITTED bars (score_metric_bar_sets, via the production loadBarSet)
// and the corrected rosters. Produces real PillarScore + MetricScore ROW SHAPES via the
// dry-run mappers (ready-to-persist), but WRITES NOTHING — all committed score rows are
// deferred to the Market-pillar + 4-pillar-composite milestone (operator decision).
//
//   npx tsx src/scripts/score-fm-dryrun.ts
//
// These are FOUNDATION + MOMENTUM pillar scores — NOT the full 4-pillar Health Score
// (Market band cuts + composite are a separate later milestone).

import { prisma } from "../db/prisma.js";
import { loadFoundationStandalone, loadMomentumStandalone } from "../scoring/metrics/load.js";
import { dispatchLiveValues } from "../scoring/metric-scoring/live-dispatch.js";
import { loadBarSet } from "../scoring/metric-scoring/bars.js";
import { scoreMetricCrossSection, type CrossSectionMember } from "../scoring/metric-scoring/wire.js";
import { NO_SUPPRESSION, type WiringConfig, type ScoredMetric } from "../scoring/metric-scoring/types.js";
import { assemblePillar } from "../scoring/pillars/assemble.js";
import { toPillarScoreRow } from "../scoring/pillars/persist.js";
import { toMetricScoreRow } from "../scoring/metric-scoring/persist.js";
import type { FoundationAnnual, MomentumQuarter } from "../scoring/metrics/types.js";

const READY: { key: string; pgId: string; name: string }[] = [
  { key: "pg1_it_services", pgId: "PG1", name: "Large-Cap IT Services" },
  { key: "pg2_fmcg", pgId: "PG2", name: "Large-Cap FMCG" },
  { key: "pg3_pharma", pgId: "PG3", name: "Large-Cap Pharma" },
  { key: "pg4_auto_oem", pgId: "PG4", name: "Large-Cap Auto OEMs" },
  { key: "pg8_power", pgId: "PG8", name: "Large-Cap Power & Utilities" },
  { key: "pg9_metals", pgId: "PG9", name: "Large-Cap Metals & Mining" },
  { key: "pg13_consumer_durables", pgId: "PG13", name: "Large-Cap Consumer Durables & Electrical" },
];
const GATED = ["PG10", "PG11", "PG12", "PG14"];
const BANKING = ["PG5", "PG6"];
const FOUNDATION_CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const MOMENTUM_CFG: WiringConfig = { peerMinN: 5, l3MinN: 6, l3Window: 12 };
const f2 = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : x.toFixed(d));
const bandOf = (s: number | null): string => s === null ? "—" : s >= 90 ? "excellent" : s >= 75 ? "good" : s >= 60 ? "acceptable" : s >= 40 ? "concerning" : "distress";

interface Member { stockId: string; symbol: string; fRows: FoundationAnnual[]; qRows: MomentumQuarter[] }

function seriesForKey(m: Member, key: string, pillar: "foundation" | "momentum"): number[] {
  const out: number[] = [];
  if (pillar === "foundation") {
    const sorted = [...m.fRows].sort((a, b) => a.fyOrdinal - b.fyOrdinal);
    for (let i = 0; i < sorted.length; i++) { const d = dispatchLiveValues({ industryType: "non_financial", foundationKeys: [key], momentumKeys: [], foundationRows: sorted.slice(0, i + 1), momentumQuarters: [] }); if (d.status === "computed" && d.foundation[0]?.available && d.foundation[0].value !== null) out.push(d.foundation[0].value); }
  } else {
    const sorted = [...m.qRows].sort((a, b) => a.qOrdinal - b.qOrdinal);
    for (let i = 0; i < sorted.length; i++) { const d = dispatchLiveValues({ industryType: "non_financial", foundationKeys: [], momentumKeys: [key], foundationRows: [], momentumQuarters: sorted.slice(0, i + 1) }); if (d.status === "computed" && d.momentum[0]?.available && d.momentum[0].value !== null) out.push(d.momentum[0].value); }
  }
  return out;
}

async function main() {
  const asOf = new Date(); // pick the latest in-force committed bars
  // baseline counts for the "wrote nothing" assertion
  const before = {
    pillar: await prisma.pillarScore.count(), metric: await prisma.metricScore.count(),
    snap: await prisma.scoreSnapshot.count(), peerStats: await prisma.peerStatsSnapshot.count(), run: await prisma.scoringRun.count(),
  };

  console.log("STAGE 5 — FOUNDATION + MOMENTUM SCORES (DRY-RUN; commits nothing)");
  console.log(`  bars: committed score_metric_bar_sets via loadBarSet @ asOf ${asOf.toISOString().slice(0, 10)}   rosters: corrected (7 ready PGs)`);
  console.log(`  ⚠ these are F+M pillar scores — NOT the full 4-pillar Health Score (Market + composite = later milestone)\n`);
  console.log(`  ${"PG".padEnd(5)} ${"stock".padEnd(11)} ${"Foundation".padEnd(22)} ${"Momentum".padEnd(22)}`);
  console.log(`  ${"─".repeat(5)} ${"─".repeat(11)} ${"─".repeat(22)} ${"─".repeat(22)}`);

  let sampleMapperShown = false;
  const summary: { pgId: string; n: number; fScored: number; mScored: number; fRange: string; mRange: string }[] = [];

  for (const pg of READY) {
    // keys actually committed for this PG (split by prefix)
    const keyRows = await prisma.metricBarSet.findMany({ where: { barPath: pg.pgId }, select: { metricKey: true }, distinct: ["metricKey"] });
    const fKeys = keyRows.map((r) => r.metricKey).filter((k) => k.startsWith("F")).sort();
    const mKeys = keyRows.map((r) => r.metricKey).filter((k) => k.startsWith("M")).sort();

    // roster (DB membership == corrected seed)
    const pgRow = await prisma.peerGroup.findFirst({ where: { name: pg.name }, include: { stocks: { include: { stock: true } } } });
    const members: Member[] = [];
    for (const sp of pgRow!.stocks) members.push({ stockId: sp.stock.id, symbol: sp.stock.symbol, fRows: await loadFoundationStandalone(sp.stock.id), qRows: await loadMomentumStandalone(sp.stock.id) });

    const live = new Map(members.map((m) => [m.symbol, dispatchLiveValues({ industryType: "non_financial", foundationKeys: fKeys, momentumKeys: mKeys, foundationRows: m.fRows, momentumQuarters: m.qRows })]));
    const fMetrics = new Map<string, ScoredMetric[]>(); const mMetrics = new Map<string, ScoredMetric[]>();
    const barSetIdByKey = new Map<string, string | null>();
    for (const m of members) { fMetrics.set(m.symbol, []); mMetrics.set(m.symbol, []); }
    const snapFy = (live.get(members[0].symbol) as any)?.snapshotFy ?? "FY";
    const snapQ = (live.get(members[0].symbol) as any)?.snapshotQuarter ?? "FYQ";

    const runPillar = async (keys: string[], pillar: "foundation" | "momentum", bucket: Map<string, ScoredMetric[]>, cfg: WiringConfig, snap: string) => {
      for (const key of keys) {
        const bs = await loadBarSet(pg.pgId, key, asOf);
        if (!bs) continue;
        barSetIdByKey.set(key, bs.metricBarSetId ?? null);
        const xsMembers: CrossSectionMember[] = members.map((m) => {
          const d = live.get(m.symbol)!; const arr = d.status === "computed" ? (pillar === "foundation" ? d.foundation : d.momentum) : [];
          const mv = arr.find((x) => x.key === key); const avail = !!mv && mv.available && mv.value !== null;
          return { stockId: m.stockId, symbol: m.symbol, rawValue: avail ? mv!.value : null, available: avail, unavailableReason: avail ? null : (mv?.reason ?? "no value"), ownHistoryValues: seriesForKey(m, key, pillar) };
        });
        const xs = scoreMetricCrossSection({ pillar, metricKey: key, label: key, snapshot: snap, direction: bs.direction, bars: bs.bars, barNote: bs.note, sscu: bs.sscu ? { bars: bs.sscu.bars, scope: bs.sscu.scope } : null, members: xsMembers, suppression: NO_SUPPRESSION, config: cfg });
        for (const s of xs.scored) bucket.get(s.symbol)!.push(s);
      }
    };
    await runPillar(fKeys, "foundation", fMetrics, FOUNDATION_CFG, snapFy);
    await runPillar(mKeys, "momentum", mMetrics, MOMENTUM_CFG, snapQ);

    let fScored = 0, mScored = 0; const fSubs: number[] = [], mSubs: number[] = [];
    for (const m of members) {
      const fp = assemblePillar({ pillar: "foundation", stockId: m.stockId, symbol: m.symbol, snapshot: snapFy, metrics: fMetrics.get(m.symbol)! });
      const mp = assemblePillar({ pillar: "momentum", stockId: m.stockId, symbol: m.symbol, snapshot: snapQ, metrics: mMetrics.get(m.symbol)! });
      if (fp.subtotal !== null) { fScored++; fSubs.push(fp.subtotal); }
      if (mp.subtotal !== null) { mScored++; mSubs.push(mp.subtotal); }
      const fStr = fp.subtotal !== null ? `${f2(fp.subtotal)} ${bandOf(fp.subtotal)} (${fp.scoredCount}/${fp.totalMetrics})` : `n/a (${fp.unavailableReason ?? "floor"})`;
      const mStr = mp.subtotal !== null ? `${f2(mp.subtotal)} ${bandOf(mp.subtotal)} (${mp.scoredCount}/${mp.totalMetrics})` : `n/a (${mp.unavailableReason ?? "floor"})`;
      console.log(`  ${pg.pgId.padEnd(5)} ${m.symbol.padEnd(11)} ${fStr.padEnd(22)} ${mStr.padEnd(22)}`);

      // show ONE ready-to-persist mapper sample (the first scored stock of PG3)
      if (!sampleMapperShown && pg.pgId === "PG3" && fp.subtotal !== null && fMetrics.get(m.symbol)!.some((s) => s.scoreState === "scored")) {
        sampleMapperShown = true;
        const ctx = { runId: "(dry-run: would get-or-create ScoringRun)", specVersionId: "(would get-or-create spec)", asOfDate: asOf, sourcePeriod: snapFy };
        const pillarRow = toPillarScoreRow(fp, ctx);
        const sm = fMetrics.get(m.symbol)!.find((s) => s.scoreState === "scored")!;
        const metricRow = toMetricScoreRow(sm, { pillarScoreId: "(foundation PillarScore fk)", peerStatsSnapshotId: null, metricBarSetId: barSetIdByKey.get(sm.metricKey) ?? null });
        console.log(`\n  ── READY-TO-PERSIST ROW SHAPES (mappers; NOT written) — ${m.symbol} Foundation ──`);
        console.log(`     score_pillars  : ${JSON.stringify({ ...pillarRow, inputsFingerprint: pillarRow.inputsFingerprint.slice(0, 16) + "…" })}`);
        console.log(`     score_metrics  : ${JSON.stringify({ pillarScoreId: metricRow.pillarScoreId, metricKey: metricRow.metricKey, rawValue: metricRow.rawValue, l1Score: metricRow.l1Score, l2Score: metricRow.l2Score, l3Score: metricRow.l3Score, metricScore: metricRow.metricScore, l1Band: metricRow.l1Band, metricBarSetId: metricRow.metricBarSetId })}`);
        console.log(`     (note: metricBarSetId is the REAL committed bar-row id → ${metricRow.metricBarSetId})`);
        // decomposition for this stock's foundation
        console.log(`  ── DECOMPOSITION — ${m.symbol} Foundation (L1/L2/L3 → metric → contribution) ──`);
        for (const s of fMetrics.get(m.symbol)!.slice(0, 4)) console.log(`     ${s.metricKey.padEnd(7)} raw=${f2(s.rawValue).padStart(9)} L1=${f2(s.l1Score).padStart(6)}/${(s.l1Band ?? "—").padEnd(10)} L2=${f2(s.l2Score).padStart(6)} L3=${f2(s.l3Score).padStart(6)} → metric=${f2(s.metricScore).padStart(6)}`);
        console.log("");
      }
    }
    summary.push({ pgId: pg.pgId, n: members.length, fScored, mScored, fRange: fSubs.length ? `${f2(Math.min(...fSubs))}–${f2(Math.max(...fSubs))}` : "—", mRange: mSubs.length ? `${f2(Math.min(...mSubs))}–${f2(Math.max(...mSubs))}` : "—" });
  }

  console.log(`\n  ── PER-PG SUMMARY (Foundation / Momentum pillar subtotals) ──`);
  for (const s of summary) console.log(`  ${s.pgId.padEnd(5)} n=${s.n}  Foundation: ${s.fScored}/${s.n} scored, range ${s.fRange}   Momentum: ${s.mScored}/${s.n} scored, range ${s.mRange}`);

  // gated / banking stay unscored
  console.log(`\n  ── GATED / BANKING (NOT scored) ──`);
  console.log(`  roster-gated (pending_stock_data_ingestion): ${GATED.join(", ")} — skipped (not scored)`);
  console.log(`  banking (scoring_pending_bank_data_pipeline): ${BANKING.join(", ")} — bars load, scoring gated (not scored)`);

  // "wrote nothing" assertion
  const after = {
    pillar: await prisma.pillarScore.count(), metric: await prisma.metricScore.count(),
    snap: await prisma.scoreSnapshot.count(), peerStats: await prisma.peerStatsSnapshot.count(), run: await prisma.scoringRun.count(),
  };
  const unchanged = before.pillar === after.pillar && before.metric === after.metric && before.snap === after.snap && before.peerStats === after.peerStats && before.run === after.run;
  console.log(`\n  ── COMMITS-NOTHING ASSERTION ──`);
  console.log(`  score_pillars ${before.pillar}→${after.pillar}  score_metrics ${before.metric}→${after.metric}  score_snapshots ${before.snap}→${after.snap}  score_peer_stats ${before.peerStats}→${after.peerStats}  score_runs ${before.run}→${after.run}`);
  console.log(`  ${unchanged ? "✓ DRY-RUN: no score rows written (all deferred to the Market + composite milestone)." : "✗ SOMETHING WAS WRITTEN — investigate"}`);

  await prisma.$disconnect();
  if (!unchanged) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
