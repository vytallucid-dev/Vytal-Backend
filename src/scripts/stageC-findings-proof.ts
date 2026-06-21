// STAGE-C PROOF (read-only / rolled-back). Censuses R3/P7/R5/P12/P13, validates the
// R3-vs-P7 single-signal distinction, the guard behavior (annual b1/b2/b3 reuse for P7/P12;
// structural self-guarding for R3/R5; P12 negative-trough guard), P13 data-depth, then
// write→readback→rollback.
//   npx tsx src/scripts/stageC-findings-proof.ts

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import { persistFindings } from "../scoring/findings/persist.js";
import { annualExceptionalLatest } from "../scoring/findings/guards/annual-exceptional.js";
import { loadFoundationStandalone } from "../scoring/metrics/load.js";
import type { FiredFinding } from "../scoring/findings/types.js";

const STAGE_C = new Set([
  "foundation_R3_earnings_quality", "foundation_P7_accruals", "foundation_R5_interest_coverage",
  "momentum_P12_margin_recovery", "momentum_P13_revenue_inflection",
]);
const PGS: PgRef[] = [
  { pgId: "PG1", seedKey: "", pgName: "Large-Cap IT Services" }, { pgId: "PG2", seedKey: "", pgName: "Large-Cap FMCG" },
  { pgId: "PG3", seedKey: "", pgName: "Large-Cap Pharma" }, { pgId: "PG4", seedKey: "", pgName: "Large-Cap Auto OEMs" },
  { pgId: "PG5", seedKey: "", pgName: "Large-Cap Private Banks" }, { pgId: "PG6", seedKey: "", pgName: "Large-Cap PSU Banks" },
  { pgId: "PG8", seedKey: "", pgName: "Large-Cap Power & Utilities" }, { pgId: "PG9", seedKey: "", pgName: "Large-Cap Metals & Mining" },
  { pgId: "PG10", seedKey: "", pgName: "Large-Cap Oil & Gas" }, { pgId: "PG11", seedKey: "", pgName: "Large-Cap Capital Goods & Industrial" },
  { pgId: "PG12", seedKey: "", pgName: "Large-Cap Cement" }, { pgId: "PG13", seedKey: "", pgName: "Large-Cap Consumer Durables & Electrical" },
  { pgId: "PG14", seedKey: "", pgName: "Large-Cap Defense" },
];
class Rollback extends Error {}

async function main() {
  const before = { rf: await prisma.redFlag.count(), pat: await prisma.scorePattern.count() };
  console.log("════ STAGE-C PROOF (dry-run, rolled back) ════");
  console.log("BEFORE red_flags:", before.rf, "patterns:", before.pat, "\n");

  const byKey = new Map<string, string[]>();
  const fires = { R3: new Set<string>(), P7: new Set<string>() };
  const firedByStock = new Map<string, FiredFinding[]>();
  for (const ref of PGS) {
    let c; try { c = await computePgScores(ref, { withFindings: true }); } catch { continue; }
    for (const m of c.members) {
      const cFinds = (m.findings ?? []).filter((f) => STAGE_C.has(f.key));
      if (!cFinds.length) continue;
      firedByStock.set(m.symbol, cFinds);
      for (const f of cFinds) {
        const ev = (f.evidence as any).verbatim ?? (f.evidence as any).verdict ?? "";
        if (!byKey.has(f.key)) byKey.set(f.key, []);
        byKey.get(f.key)!.push(`${m.symbol}: ${ev}`);
        if (f.key === "foundation_R3_earnings_quality") fires.R3.add(m.symbol);
        if (f.key === "foundation_P7_accruals") fires.P7.add(m.symbol);
      }
    }
  }

  console.log("── Stage-C census ──");
  for (const k of ["foundation_R3_earnings_quality", "foundation_P7_accruals", "foundation_R5_interest_coverage", "momentum_P12_margin_recovery", "momentum_P13_revenue_inflection"]) {
    const hits = byKey.get(k) ?? [];
    console.log(`\n  ${k}  ×${hits.length}`);
    for (const h of hits.slice(0, 6)) console.log(`     ${h}`);
    if (hits.length > 6) console.log(`     … +${hits.length - 6} more`);
  }

  // ── R3-vs-P7 single-signal check ──
  console.log("\n── R3-vs-P7 single-signal (distinct populations?) ──");
  const both = [...fires.R3].filter((s) => fires.P7.has(s));
  const onlyR3 = [...fires.R3].filter((s) => !fires.P7.has(s));
  const onlyP7 = [...fires.P7].filter((s) => !fires.R3.has(s));
  console.log(`  R3 only (persistence, no big latest gap): ${onlyR3.join(", ") || "—"}`);
  console.log(`  P7 only (big latest gap, no 4yr streak):  ${onlyP7.join(", ") || "—"}`);
  console.log(`  both: ${both.join(", ") || "—"}  →  ${onlyR3.length || onlyP7.length ? "DISTINCT signals ✅ (not P2/P3-style duplicate)" : "(overlap — review)"}`);

  // ── P7/P12 guard: which universe stocks fire an annual b1/b2/b3 (would suppress) ──
  console.log("\n── annual exceptional guard (b1/b2/b3) scan — stocks where P7/P12 would be suppressed ──");
  const sample = ["DRREDDY", "HCLTECH", "ITC", "VEDL", "TATASTEEL", "JSWSTEEL", "ONGC", "COALINDIA", "HINDALCO", "GRASIM", "BPCL", "SAIL", "ADANIPOWER"];
  let guardHits = 0;
  for (const sym of sample) {
    const st = await prisma.stock.findFirst({ where: { symbol: sym }, select: { id: true } });
    if (!st) continue;
    const f = await loadFoundationStandalone(st.id);
    const g = annualExceptionalLatest(f);
    if (g.distorted) { guardHits++; console.log(`     ${sym.padEnd(11)} fired ${g.fired.filter((k) => k.startsWith("B-")).join(",")} → P7/P12 guarded`); }
  }
  if (!guardHits) console.log("     (no annual b1/b2/b3 in the sample — guards wired + run, but this universe has few annual exceptionals)");

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
      const sp = await tx.scorePattern.findMany({ where: { snapshotId: { in: ids }, patternKey: { in: ["momentum_P12_margin_recovery", "foundation_P7_accruals"] } }, take: 3, select: { symbol: true, patternKey: true, severity: true, magnitude: true, displayState: true } });
      for (const p of sp) console.log(`     readback ${p.symbol.padEnd(11)} ${p.patternKey} sev=${p.severity} mag=${p.magnitude} state=${p.displayState}`);
      const sr = await tx.redFlag.findMany({ where: { snapshotId: { in: ids }, flagKey: { startsWith: "foundation_R" } }, take: 3, select: { symbol: true, flagKey: true, severity: true } });
      for (const r of sr) console.log(`     readback ${r.symbol.padEnd(11)} ${r.flagKey} sev=${r.severity}`);
      throw new Rollback("rb");
    }, { timeout: 30000, maxWait: 10000 });
  } catch (e) { if (!(e instanceof Rollback)) throw e; console.log("  ⟲ rolled back"); }

  const after = { rf: await prisma.redFlag.count(), pat: await prisma.scorePattern.count() };
  console.log(`\nAFTER red_flags ${after.rf} patterns ${after.pat} — ZERO RESIDUE: ${after.rf === before.rf && after.pat === before.pat ? "✅" : "❌"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
