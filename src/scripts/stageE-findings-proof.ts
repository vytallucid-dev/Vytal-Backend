// STAGE-E + FULL-CATALOG PROOF (dry-run, rolled back). Full census of EVERY active rule,
// Stage-E specifics (P5/P6/P10/H/F1 + displayState=active for feed patterns), single-signal
// across the catalog, then write→readback→rollback.
//   npx tsx src/scripts/stageE-findings-proof.ts

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import { persistFindings } from "../scoring/findings/persist.js";
import type { FiredFinding } from "../scoring/findings/types.js";

const FEED_KEYS = new Set(["ownership_P5_insider_distress", "ownership_P6_insider_conviction", "ownership_P10_promoter_defense", "ownership_H_block_events"]);
const PGS: PgRef[] = [
  ["PG1", "Large-Cap IT Services"], ["PG2", "Large-Cap FMCG"], ["PG3", "Large-Cap Pharma"], ["PG4", "Large-Cap Auto OEMs"],
  ["PG5", "Large-Cap Private Banks"], ["PG6", "Large-Cap PSU Banks"], ["PG8", "Large-Cap Power & Utilities"],
  ["PG9", "Large-Cap Metals & Mining"], ["PG10", "Large-Cap Oil & Gas"], ["PG11", "Large-Cap Capital Goods & Industrial"],
  ["PG12", "Large-Cap Cement"], ["PG13", "Large-Cap Consumer Durables & Electrical"], ["PG14", "Large-Cap Defense"],
].map(([pgId, pgName]) => ({ pgId, seedKey: "", pgName }));
class Rollback extends Error {}

async function main() {
  const before = { rf: await prisma.redFlag.count(), pat: await prisma.scorePattern.count() };
  console.log("════ STAGE-E + FULL-CATALOG PROOF (dry-run, rolled back) ════");
  console.log("BEFORE red_flags:", before.rf, "patterns:", before.pat, "\n");

  const counts = new Map<string, number>();
  const memberKeys = new Map<string, Set<string>>();
  const firedByStock = new Map<string, FiredFinding[]>();
  const feedStates = new Map<string, string>(); // feed key → displayState seen
  const stageE: string[] = [];
  for (const ref of PGS) {
    let c; try { c = await computePgScores(ref, { withFindings: true }); } catch { continue; }
    for (const m of c.members) {
      if (!m.findings?.length) continue;
      memberKeys.set(m.symbol, new Set(m.findings.map((f) => f.key)));
      firedByStock.set(m.symbol, m.findings);
      for (const f of m.findings) {
        counts.set(f.key, (counts.get(f.key) ?? 0) + 1);
        if (FEED_KEYS.has(f.key)) { feedStates.set(f.key, f.displayState ?? "?"); stageE.push(`${m.symbol} ${f.key}: ${(f.evidence as any).verdict}`); }
        if (f.key === "composition_F1_atypical" && stageE.filter((x) => x.includes("F1")).length < 4) stageE.push(`${m.symbol} F1: ${(f.evidence as any).verdict}`);
      }
    }
  }

  console.log("── FULL CATALOG CENSUS (every active key) ──");
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  for (const k of [...counts.keys()].sort()) console.log(`  ${k.padEnd(42)} ×${counts.get(k)}`);
  console.log(`  ── ${counts.size} distinct keys, ${total} total fires ──`);

  console.log("\n── Stage-E samples (feed patterns + F1) ──");
  for (const s of stageE.slice(0, 12)) console.log(`  ${s}`);
  console.log(`\n  feed-pattern displayState (must be 'active'): ${[...feedStates].map(([k, v]) => `${k.split("_")[1]}=${v}`).join(", ") || "(none fired)"}`);

  // ── single-signal across catalog ──
  console.log("\n── single-signal across catalog ──");
  let p6p10same = 0, p5withbuy = 0, f1f2 = 0;
  for (const [sym, keys] of memberKeys) {
    // P6 (director buy) + P10 (promoter buy) can co-fire (different actors) — that's allowed; just count.
    if (keys.has("ownership_P6_insider_conviction") && keys.has("ownership_P10_promoter_defense")) p6p10same++;
    // P5 (sell) must NOT co-fire with a buy pattern on the same stock (opposite direction) — flag if so.
    if (keys.has("ownership_P5_insider_distress") && (keys.has("ownership_P6_insider_conviction") || keys.has("ownership_P10_promoter_defense"))) { p5withbuy++; console.log(`     ⚠ ${sym}: P5 (sell) + a buy pattern — inspect`); }
    if (keys.has("composition_F1_atypical") && keys.has("trajectory_F2_composition_shift")) f1f2++;
  }
  console.log(`  P6∩P10 (director+promoter both bought — allowed, distinct actors): ${p6p10same}`);
  console.log(`  P5∩(P6|P10) (sell+buy contradiction): ${p5withbuy} ${p5withbuy === 0 ? "✅" : ""}`);
  console.log(`  F1∩F2 (atypical-for-band AND shifted-vs-last — distinct readings, can co-fire): ${f1f2}`);

  // ── persist proof ──
  console.log("\n── persist proof (write → readback → rollback) ──");
  const anchors: { sym: string; snapId: string; asOfDate: Date; findings: FiredFinding[] }[] = [];
  for (const [sym, findings] of firedByStock) {
    const snap = await prisma.scoreSnapshot.findFirst({ where: { symbol: sym, snapshotType: "quarterly", periodKey: "FY26Q4" }, orderBy: { version: "desc" }, select: { id: true, asOfDate: true } });
    if (snap) anchors.push({ sym, snapId: snap.id, asOfDate: snap.asOfDate, findings });
  }
  try {
    await prisma.$transaction(async (tx) => {
      let rf = 0, pat = 0; const ids: string[] = [];
      for (const a of anchors) { const r = await persistFindings(tx as any, a.snapId, a.sym, a.asOfDate, a.findings); rf += r.redFlags; pat += r.patterns; ids.push(a.snapId); }
      console.log(`  wrote redFlags=${rf} patterns=${pat} across ${ids.length} snapshots`);
      const sp = await tx.scorePattern.findMany({ where: { snapshotId: { in: ids }, patternKey: { in: ["ownership_P10_promoter_defense", "composition_F1_atypical", "ownership_H_block_events"] } }, take: 3, select: { symbol: true, patternKey: true, severity: true, displayState: true, magnitude: true } });
      for (const p of sp) console.log(`     readback ${p.symbol.padEnd(11)} ${p.patternKey} sev=${p.severity} state=${p.displayState} mag=${p.magnitude}`);
      throw new Rollback("rb");
    }, { timeout: 30000, maxWait: 10000 });
  } catch (e) { if (!(e instanceof Rollback)) throw e; console.log("  ⟲ rolled back"); }

  const after = { rf: await prisma.redFlag.count(), pat: await prisma.scorePattern.count() };
  console.log(`\nAFTER red_flags ${after.rf} patterns ${after.pat} — ZERO RESIDUE: ${after.rf === before.rf && after.pat === before.pat ? "✅" : "❌"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
