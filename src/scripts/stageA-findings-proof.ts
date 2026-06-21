// STAGE-A FINDINGS PROOF — dry-run, ROLLED BACK. Proves the §2/§5 findings contract
// end-to-end on real stocks:
//   1. computePgScores(withFindings) builds each member's FiringContext + runs R6/P11/C1.
//   2. Show which fire, with the evidence JSON (the UI's verdict-sentence input).
//   3. WRITE the fired findings against the committed FY26Q4 snapshots (in a tx),
//      READ them back, then ROLL BACK — proving the persist write contract + zero residue.
//
//   npx tsx src/scripts/stageA-findings-proof.ts
//
// Writes nothing durable (the whole write/readback is inside a transaction that throws to
// roll back). Safe to run against production.

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import { persistFindings } from "../scoring/findings/persist.js";
import type { FiredFinding } from "../scoring/findings/types.js";

const PROOF_PGS: { ref: PgRef; expect: string }[] = [
  { ref: { pgId: "PG13", seedKey: "pg13_consumer_durables", pgName: "Large-Cap Consumer Durables & Electrical" }, expect: "DIXON → R6" },
  { ref: { pgId: "PG2", seedKey: "pg2_fmcg", pgName: "Large-Cap FMCG" }, expect: "ITC → P11" },
  { ref: { pgId: "PG3", seedKey: "pg3_pharma", pgName: "Large-Cap Pharma" }, expect: "GLENMARK → C1" },
  { ref: { pgId: "PG1", seedKey: "pg1_it_services", pgName: "Large-Cap IT Services" }, expect: "TCS/INFY → (control: no fire)" },
];

class Rollback extends Error {}

async function main() {
  const before = { rf: await prisma.redFlag.count(), pat: await prisma.scorePattern.count() };
  console.log("════ STAGE-A FINDINGS PROOF (dry-run, rolled back) ════");
  console.log("BEFORE  score_red_flags:", before.rf, " score_patterns:", before.pat, "\n");

  // ── 1+2. COMPUTE + show fires across the proof PGs ──
  const firedByStock: { sym: string; findings: FiredFinding[] }[] = [];
  for (const { ref, expect } of PROOF_PGS) {
    const computed = await computePgScores(ref, { withFindings: true });
    const firers = computed.members.filter((m) => m.findings && m.findings.length);
    console.log(`── ${ref.pgId} ${ref.pgName}  (expect ${expect}) — period ${computed.periodKey}, ${computed.members.length} members, ${firers.length} firing ──`);
    for (const m of firers) {
      for (const f of m.findings!) {
        const headline = (f.evidence as any).verbatim ?? (f.evidence as any).verdict ?? "";
        console.log(`   ${m.symbol.padEnd(11)} [${f.kind}] ${f.key}  sev=${f.severity}${f.magnitude != null ? ` mag=${f.magnitude}` : ""}${f.direction ? ` dir=${f.direction}` : ""}`);
        console.log(`      → "${headline}"`);
        firedByStock.push({ sym: m.symbol, findings: m.findings! });
      }
    }
    if (!firers.length) console.log("   (no member fired — control PG behaves correctly)");
    console.log();
  }

  // De-dupe per stock (a member appears once per finding above).
  const bySym = new Map<string, FiredFinding[]>();
  for (const r of firedByStock) bySym.set(r.sym, r.findings);

  // ── 3. WRITE → READBACK → ROLLBACK against the committed FY26Q4 snapshots ──
  console.log("════ PERSIST PROOF: write fired findings → read back → roll back ════");
  try {
    await prisma.$transaction(async (tx) => {
      const writtenSnapIds: string[] = [];
      for (const [sym, findings] of bySym) {
        const snap = await tx.scoreSnapshot.findFirst({
          where: { symbol: sym, snapshotType: "quarterly", periodKey: "FY26Q4" },
          orderBy: { version: "desc" }, // head
          select: { id: true, asOfDate: true, version: true },
        });
        if (!snap) { console.log(`   ${sym}: no committed FY26Q4 snapshot to anchor — skipping write`); continue; }
        const res = await persistFindings(tx as any, snap.id, sym, snap.asOfDate, findings);
        writtenSnapIds.push(snap.id);
        console.log(`   ${sym.padEnd(11)} → snapshot ${snap.id.slice(0, 8)}… (v${snap.version})  wrote redFlags=${res.redFlags} patterns=${res.patterns} skipped=${res.skippedExisting}`);
      }

      // READBACK — only the rows we just wrote (the new keys) on these snapshots.
      console.log("\n   ── readback ──");
      const rfs = await tx.redFlag.findMany({ where: { snapshotId: { in: writtenSnapIds }, flagKey: { in: ["R6_distribution"] } }, select: { symbol: true, flagKey: true, severity: true, tier: true, triggeringValues: true } });
      for (const r of rfs) console.log(`   RED_FLAG  ${r.symbol.padEnd(11)} ${r.flagKey} sev=${r.severity} tier=${r.tier}\n      evidence=${JSON.stringify(r.triggeringValues)}`);
      const pats = await tx.scorePattern.findMany({ where: { snapshotId: { in: writtenSnapIds } }, select: { symbol: true, patternKey: true, severity: true, direction: true, displayState: true, magnitude: true, evidence: true, metricRefs: true } });
      for (const p of pats) console.log(`   PATTERN   ${p.symbol.padEnd(11)} ${p.patternKey} sev=${p.severity} dir=${p.direction} state=${p.displayState} mag=${p.magnitude}\n      evidence=${JSON.stringify(p.evidence)}\n      metricRefs=${JSON.stringify(p.metricRefs)}`);

      const mid = { rf: await tx.redFlag.count(), pat: await tx.scorePattern.count() };
      console.log(`\n   in-tx counts → score_red_flags: ${mid.rf} (+${mid.rf - before.rf})  score_patterns: ${mid.pat} (+${mid.pat - before.pat})`);
      throw new Rollback("intentional rollback");
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
    console.log("   ⟲ transaction rolled back (intentional)\n");
  }

  const after = { rf: await prisma.redFlag.count(), pat: await prisma.scorePattern.count() };
  console.log("════ RESULT ════");
  console.log(`AFTER   score_red_flags: ${after.rf}  score_patterns: ${after.pat}`);
  console.log(`ZERO RESIDUE: ${after.rf === before.rf && after.pat === before.pat ? "✅ clean (counts == BEFORE)" : "❌ RESIDUE — counts changed!"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
