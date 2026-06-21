// STAGE-D PROOF (dry-run, rolled back). Censuses the trajectory rules, validates the
// B/D→I suppression + C-family single-signal, re-proves PIT, then write→readback→rollback.
//   npx tsx src/scripts/stageD-findings-proof.ts

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import { persistFindings } from "../scoring/findings/persist.js";
import { loadTrajectorySeries, periodOrdinal } from "../scoring/findings/trajectory/load-series.js";
import type { FiredFinding } from "../scoring/findings/types.js";

const STAGE_D = new Set([
  "trajectory_B_deterioration", "trajectory_D_recovery", "trajectory_I_band_transition",
  "trajectory_G_convergence", "trajectory_F2_composition_shift",
  "divergence_C2_ownership_vs_fundamentals", "divergence_C3_floor_trajectory_split", "divergence_C_over_time_widening",
]);
const PGS: PgRef[] = [
  ["PG1", "Large-Cap IT Services"], ["PG2", "Large-Cap FMCG"], ["PG3", "Large-Cap Pharma"], ["PG4", "Large-Cap Auto OEMs"],
  ["PG5", "Large-Cap Private Banks"], ["PG6", "Large-Cap PSU Banks"], ["PG8", "Large-Cap Power & Utilities"],
  ["PG9", "Large-Cap Metals & Mining"], ["PG10", "Large-Cap Oil & Gas"], ["PG11", "Large-Cap Capital Goods & Industrial"],
  ["PG12", "Large-Cap Cement"], ["PG13", "Large-Cap Consumer Durables & Electrical"], ["PG14", "Large-Cap Defense"],
].map(([pgId, pgName]) => ({ pgId, seedKey: "", pgName }));
class Rollback extends Error {}

async function main() {
  const before = { rf: await prisma.redFlag.count(), pat: await prisma.scorePattern.count() };
  console.log("════ STAGE-D PROOF (dry-run, rolled back) ════");
  console.log("BEFORE red_flags:", before.rf, "patterns:", before.pat, "\n");

  const byKey = new Map<string, string[]>();
  const memberKeys = new Map<string, Set<string>>(); // symbol -> set of fired keys (all stages)
  const firedByStock = new Map<string, FiredFinding[]>();
  for (const ref of PGS) {
    let c; try { c = await computePgScores(ref, { withFindings: true }); } catch { continue; }
    for (const m of c.members) {
      if (!m.findings?.length) continue;
      memberKeys.set(m.symbol, new Set(m.findings.map((f) => f.key)));
      const dFinds = m.findings.filter((f) => STAGE_D.has(f.key));
      if (!dFinds.length) continue;
      firedByStock.set(m.symbol, dFinds);
      for (const f of dFinds) {
        const v = (f.evidence as any).verdict ?? "";
        if (!byKey.has(f.key)) byKey.set(f.key, []);
        byKey.get(f.key)!.push(`${m.symbol}: ${v}`);
      }
    }
  }

  console.log("── Stage-D census ──");
  for (const k of [...STAGE_D]) {
    const hits = byKey.get(k) ?? [];
    console.log(`\n  ${k}  ×${hits.length}`);
    for (const h of hits.slice(0, 6)) console.log(`     ${h}`);
    if (hits.length > 6) console.log(`     … +${hits.length - 6} more`);
  }

  // ── Single-signal: B/D suppress I (no stock fires I AND a same-direction B/D) ──
  console.log("\n── single-signal checks ──");
  let iWithBD = 0;
  for (const [sym, keys] of memberKeys) {
    if (keys.has("trajectory_I_band_transition")) {
      // I fired — confirm it's not double-covered. (Suppression is in-rule; this asserts it held.)
      if (keys.has("trajectory_B_deterioration") || keys.has("trajectory_D_recovery")) {
        // allowed only if I is the OPPOSITE direction of the B/D (different crossing) — flag for manual look
        iWithBD++; console.log(`     ⚠ ${sym} fired I + ${[...keys].filter((k) => k.includes("_B_") || k.includes("_D_")).join(",")} (verify opposite-direction)`);
      }
    }
  }
  console.log(`  I co-firing with B/D: ${iWithBD} ${iWithBD === 0 ? "✅ (B/D suppression holds)" : "(inspect above)"}`);
  // C-family disjointness: C1(point ≥wide) vs C-over-time(notable, widening) vs G(narrowing)
  let cOverlap = 0;
  for (const [sym, keys] of memberKeys) {
    if (keys.has("divergence_C1_price_ahead") && keys.has("divergence_C_over_time_widening")) { cOverlap++; console.log(`     ⚠ ${sym} fired C1 AND C-over-time (should be disjoint by gap level)`); }
  }
  console.log(`  C1 ∩ C-over-time: ${cOverlap} ${cOverlap === 0 ? "✅ (disjoint by gap level)" : ""}`);

  // ── PIT re-proof (a couple stocks at an early cutoff) ──
  console.log("\n── PIT re-proof ──");
  for (const sym of ["COLPAL", "POWERINDIA"]) {
    const st = await prisma.stock.findFirst({ where: { symbol: sym }, select: { id: true } });
    if (!st) continue;
    const early = await loadTrajectorySeries(st.id, "FY25Q1", new Date(Date.UTC(2024, 5, 30)));
    const leak = early.some((p) => periodOrdinal(p.periodKey) >= periodOrdinal("FY25Q1"));
    console.log(`  ${sym}: early series (≤FY25Q1) = [${early.map((p) => p.periodKey).join(",")}]  leak≥FY25Q1? ${leak ? "❌" : "NO ✅"}`);
  }

  // ── persist proof ──
  console.log("\n── persist proof (write → readback → rollback) ──");
  const anchors: { sym: string; snapId: string; asOfDate: Date; findings: FiredFinding[] }[] = [];
  for (const [sym, findings] of firedByStock) {
    const snap = await prisma.scoreSnapshot.findFirst({ where: { symbol: sym, snapshotType: "quarterly", periodKey: "FY26Q4" }, orderBy: { version: "desc" }, select: { id: true, asOfDate: true } });
    if (snap) anchors.push({ sym, snapId: snap.id, asOfDate: snap.asOfDate, findings });
  }
  try {
    await prisma.$transaction(async (tx) => {
      let pat = 0; const ids: string[] = [];
      for (const a of anchors) { const r = await persistFindings(tx as any, a.snapId, a.sym, a.asOfDate, a.findings); pat += r.patterns; ids.push(a.snapId); }
      console.log(`  wrote patterns=${pat} across ${ids.length} snapshots`);
      const sp = await tx.scorePattern.findMany({ where: { snapshotId: { in: ids }, patternKey: { startsWith: "trajectory_" } }, take: 4, select: { symbol: true, patternKey: true, severity: true, direction: true, displayState: true } });
      for (const p of sp) console.log(`     readback ${p.symbol.padEnd(11)} ${p.patternKey} sev=${p.severity} dir=${p.direction} state=${p.displayState}`);
      throw new Rollback("rb");
    }, { timeout: 30000, maxWait: 10000 });
  } catch (e) { if (!(e instanceof Rollback)) throw e; console.log("  ⟲ rolled back"); }

  const after = { rf: await prisma.redFlag.count(), pat: await prisma.scorePattern.count() };
  console.log(`\nAFTER red_flags ${after.rf} patterns ${after.pat} — ZERO RESIDUE: ${after.rf === before.rf && after.pat === before.pat ? "✅" : "❌"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
