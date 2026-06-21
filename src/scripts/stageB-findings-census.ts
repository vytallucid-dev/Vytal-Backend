// STAGE-B FINDINGS CENSUS — dry-run, ROLLED BACK. Runs computePgScores(withFindings)
// across all non-financial + bank PGs, censuses every fired finding by key, then proves
// the persist contract (write → readback → rollback against committed FY26Q4 snapshots).
//
//   npx tsx src/scripts/stageB-findings-census.ts            (all keys)
//   npx tsx src/scripts/stageB-findings-census.ts cleanonly  (exclude P11/R6/C1 — Stage-B clean set only)
//
// Writes nothing durable. Safe against production.

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import { persistFindings } from "../scoring/findings/persist.js";
import type { FiredFinding } from "../scoring/findings/types.js";

const CLEAN_ONLY = process.argv.includes("cleanonly");
const STAGE_A_KEYS = new Set(["ownership_R6_distribution", "momentum_P11_margin_compression", "divergence_C1_price_ahead"]);

const PGS: PgRef[] = [
  { pgId: "PG1", seedKey: "pg1_it_services", pgName: "Large-Cap IT Services" },
  { pgId: "PG2", seedKey: "pg2_fmcg", pgName: "Large-Cap FMCG" },
  { pgId: "PG3", seedKey: "pg3_pharma", pgName: "Large-Cap Pharma" },
  { pgId: "PG4", seedKey: "pg4_auto_oem", pgName: "Large-Cap Auto OEMs" },
  { pgId: "PG5", seedKey: "pg5_private_banks", pgName: "Large-Cap Private Banks" },
  { pgId: "PG6", seedKey: "pg6_psu_banks", pgName: "Large-Cap PSU Banks" },
  { pgId: "PG8", seedKey: "pg8_power", pgName: "Large-Cap Power & Utilities" },
  { pgId: "PG9", seedKey: "pg9_metals", pgName: "Large-Cap Metals & Mining" },
  { pgId: "PG10", seedKey: "pg10_oil_gas", pgName: "Large-Cap Oil & Gas" },
  { pgId: "PG11", seedKey: "pg11_capital_goods", pgName: "Large-Cap Capital Goods & Industrial" },
  { pgId: "PG12", seedKey: "pg12_cement", pgName: "Large-Cap Cement" },
  { pgId: "PG13", seedKey: "pg13_consumer_durables", pgName: "Large-Cap Consumer Durables & Electrical" },
  { pgId: "PG14", seedKey: "pg14_defense", pgName: "Large-Cap Defense" },
];

class Rollback extends Error {}

async function main() {
  const before = { rf: await prisma.redFlag.count(), pat: await prisma.scorePattern.count() };
  console.log(`════ STAGE-B CENSUS (${CLEAN_ONLY ? "clean Stage-B set only" : "all active rules"}) — dry-run, rolled back ════`);
  console.log("BEFORE  score_red_flags:", before.rf, " score_patterns:", before.pat, "\n");

  const byKey = new Map<string, { sym: string; ev: string }[]>();
  const firedByStock = new Map<string, { findings: FiredFinding[] }>();
  let pgErrors = 0;

  for (const ref of PGS) {
    let computed;
    try { computed = await computePgScores(ref, { withFindings: true }); }
    catch (e) { pgErrors++; console.log(`  ${ref.pgId} ERROR: ${(e as Error).message.slice(0, 70)}`); continue; }
    for (const m of computed.members) {
      if (!m.findings || !m.findings.length) continue;
      const keep = CLEAN_ONLY ? m.findings.filter((f) => !STAGE_A_KEYS.has(f.key)) : m.findings;
      if (!keep.length) continue;
      firedByStock.set(m.symbol, { findings: keep });
      for (const f of keep) {
        const ev = (f.evidence as any).verdict ?? (f.evidence as any).verbatim ?? "";
        if (!byKey.has(f.key)) byKey.set(f.key, []);
        byKey.get(f.key)!.push({ sym: m.symbol, ev });
      }
    }
  }

  // ── CENSUS ──
  console.log("── FIRE CENSUS (by key) ──");
  const keysSorted = [...byKey.keys()].sort();
  for (const key of keysSorted) {
    const hits = byKey.get(key)!;
    console.log(`\n  ${key}  ×${hits.length}`);
    for (const h of hits.slice(0, 5)) console.log(`     ${h.sym.padEnd(11)} ${h.ev}`);
    if (hits.length > 5) console.log(`     … +${hits.length - 5} more`);
  }
  if (!keysSorted.length) console.log("  (nothing fired)");
  console.log(`\n  PGs with errors: ${pgErrors}`);

  // ── PERSIST PROOF: write → readback → rollback against committed FY26Q4 snapshots ──
  // Resolve the snapshot anchors OUTSIDE the tx (read-only) so the interactive tx stays
  // short (only writes + readback + rollback) and never hits the 5s timeout.
  console.log("\n════ PERSIST PROOF (write → readback → rollback) ════");
  const anchors: { sym: string; snapId: string; asOfDate: Date; findings: FiredFinding[] }[] = [];
  for (const [sym, { findings }] of firedByStock) {
    const snap = await prisma.scoreSnapshot.findFirst({ where: { symbol: sym, snapshotType: "quarterly", periodKey: "FY26Q4" }, orderBy: { version: "desc" }, select: { id: true, asOfDate: true } });
    if (snap) anchors.push({ sym, snapId: snap.id, asOfDate: snap.asOfDate, findings });
  }
  try {
    await prisma.$transaction(async (tx) => {
      const snapIds: string[] = [];
      let wroteRf = 0, wrotePat = 0;
      for (const a of anchors) {
        const res = await persistFindings(tx as any, a.snapId, a.sym, a.asOfDate, a.findings);
        snapIds.push(a.snapId);
        wroteRf += res.redFlags; wrotePat += res.patterns;
      }
      const midRf = await tx.redFlag.count(), midPat = await tx.scorePattern.count();
      console.log(`  wrote: redFlags=${wroteRf} patterns=${wrotePat} across ${snapIds.length} snapshots`);
      console.log(`  in-tx counts → red_flags ${midRf} (+${midRf - before.rf}), patterns ${midPat} (+${midPat - before.pat})`);
      // sample readback: show stored shape of a couple of patterns + a red flag
      const sampleP = await tx.scorePattern.findMany({ where: { snapshotId: { in: snapIds } }, take: 3, select: { symbol: true, patternKey: true, severity: true, direction: true, displayState: true, magnitude: true } });
      for (const p of sampleP) console.log(`     readback PATTERN ${p.symbol.padEnd(11)} ${p.patternKey} sev=${p.severity} dir=${p.direction} state=${p.displayState} mag=${p.magnitude}`);
      const sampleR = await tx.redFlag.findMany({ where: { snapshotId: { in: snapIds }, flagKey: { startsWith: "ownership_R2" } }, take: 2, select: { symbol: true, flagKey: true, severity: true } });
      for (const r of sampleR) console.log(`     readback RED_FLAG ${r.symbol.padEnd(11)} ${r.flagKey} sev=${r.severity}`);
      throw new Rollback("rollback");
    }, { timeout: 30000, maxWait: 10000 });
  } catch (e) { if (!(e instanceof Rollback)) throw e; console.log("  ⟲ rolled back (intentional)"); }

  const after = { rf: await prisma.redFlag.count(), pat: await prisma.scorePattern.count() };
  console.log(`\nAFTER   red_flags ${after.rf}  patterns ${after.pat}`);
  console.log(`ZERO RESIDUE: ${after.rf === before.rf && after.pat === before.pat ? "✅ clean" : "❌ RESIDUE"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
