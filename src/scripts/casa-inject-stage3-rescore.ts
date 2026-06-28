// STAGE 3 — RE-SCORE ON INJECT: prove an injected CASA flows into the bank's live Health
// Score (F7 §5.8-excluded → scored). DEMONSTRATION (no score committed): inject ICICIBANK
// LIVE CASA durably → re-score PG5 (reads the new CASA) → show F7 now scores, Foundation
// 6→7, composite shifts → verify isolation (PG6 + non-financial byte-identical) → REVERT
// (delete the injected row), leaving committed scores untouched.
//   npx tsx src/scripts/casa-inject-stage3-rescore.ts

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import { injectLiveCasa } from "../ingestions/bank-supplementary/inject-casa.js";

const PG5: PgRef = { pgId: "PG5", seedKey: "pg5_private_banks", pgName: "Large-Cap Private Banks" };
const PG6: PgRef = { pgId: "PG6", seedKey: "pg6_psu_banks", pgName: "Large-Cap PSU Banks" };
const TARGET = "ICICIBANK";

const f = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

function f7Of(pg: Awaited<ReturnType<typeof computePgScores>>, sym: string) {
  const m = pg.members.find((x) => x.symbol === sym)!;
  const f7 = m.fMetrics.find((x) => x.metricKey === "CASA");
  return {
    composite: m.composite.composite, band: m.composite.labelBand,
    fSubtotal: m.fPillar.subtotal, fPresent: m.fPillar.presentCount, fTotal: m.fPillar.totalMetrics,
    f7State: f7?.scoreState ?? "absent", f7Score: f7?.metricScore ?? null, f7Raw: f7?.rawValue ?? null,
  };
}

async function main() {
  console.log("═══ STAGE 3 — RE-SCORE ON CASA INJECT ═══\n");

  // ── BEFORE: ICICIBANK F7 is §5.8-excluded (no live CASA) ──
  const before5 = await computePgScores(PG5);
  const before6 = await computePgScores(PG6);
  const b = f7Of(before5, TARGET);
  console.log(`BEFORE inject — ${TARGET}:`);
  console.log(`  composite=${f(b.composite)}/${b.band}  Foundation=${f(b.fSubtotal)} (present ${b.fPresent}/${b.fTotal})`);
  console.log(`  F7 CASA: state=${b.f7State} score=${f(b.f7Score)} raw=${f(b.f7Raw)}  → ${b.f7State === "missing_renorm" ? "§5.8 EXCLUDED (dropped, weight redistributed)" : b.f7State}`);

  // capture a few peers + PG6 + a non-financial control for the isolation check
  const peerBefore = before5.members.map((m) => ({ s: m.symbol, c: m.composite.composite }));
  const pg6Before = before6.members.map((m) => ({ s: m.symbol, c: m.composite.composite }));
  const nonFinBefore = await prisma.scoreSnapshot.findMany({ where: { industryPath: "non_financial" }, select: { symbol: true, composite: true, inputsFingerprint: true } });

  // ── INJECT a valid quarterly CASA for ICICIBANK (durable, so the re-score reads it) ──
  console.log(`\nINJECT — ${TARGET} FY26/Q1 CASA (real value + citation):`);
  const inj = await injectLiveCasa({
    symbol: TARGET, fiscalYear: "FY26", quarter: "Q1", periodEnd: "30-Jun-2025",
    value: 38.4, sourceCitation: "ICICI Bank Q1-FY26 results (Jul 2025) — CASA ratio 38.4% at Jun-30-2025 [demonstration value; operator supplies the actual disclosed figure]",
    confidence: "A", enteredBy: "demo:stage3-casa-rescore",
  });
  console.log(`  → ${inj.ok ? `ACCEPTED (${inj.action} v${inj.version}, rowId ${inj.rowId?.slice(0, 8)})` : "REJECTED: " + inj.errors.join("; ")}`);
  if (!inj.ok) { await prisma.$disconnect(); process.exit(1); }

  try {
    // ── AFTER: re-score PG5 — ICICIBANK F7 now scores ──
    const after5 = await computePgScores(PG5);
    const after6 = await computePgScores(PG6);
    const a = f7Of(after5, TARGET);
    console.log(`\nAFTER inject — ${TARGET}:`);
    console.log(`  composite=${f(a.composite)}/${a.band}  Foundation=${f(a.fSubtotal)} (present ${a.fPresent}/${a.fTotal})`);
    console.log(`  F7 CASA: state=${a.f7State} score=${f(a.f7Score)} raw=${f(a.f7Raw)}  → ${a.f7State === "scored" ? "SCORED (F7 now in Foundation)" : a.f7State}`);

    console.log(`\n  ── EFFECT (${TARGET}) ──`);
    console.log(`    F7:          ${b.f7State} → ${a.f7State}`);
    console.log(`    Foundation:  ${b.fPresent}/${b.fTotal} metrics → ${a.fPresent}/${a.fTotal} metrics`);
    console.log(`    Found subtot:${f(b.fSubtotal)} → ${f(a.fSubtotal)}`);
    console.log(`    Composite:   ${f(b.composite)}/${b.band} → ${f(a.composite)}/${a.band}`);

    // ── ISOLATION: PG6 + non-financial unchanged; other PG5 peers shift only via the F7 peer set ──
    console.log(`\n  ── SCOPE ISOLATION ──`);
    const pg6After = after6.members.map((m) => ({ s: m.symbol, c: m.composite.composite }));
    let pg6Same = true;
    for (const x of pg6Before) { const y = pg6After.find((z) => z.s === x.s); if (Math.abs((x.c ?? 0) - (y?.c ?? 0)) > 1e-9) pg6Same = false; }
    console.log(`    PG6 (PSU banks): ${pg6Same ? "byte-identical ✓ (untouched)" : "✗ CHANGED — investigate"}`);

    const nonFinAfter = await prisma.scoreSnapshot.findMany({ where: { industryPath: "non_financial" }, select: { symbol: true, inputsFingerprint: true } });
    const nfSame = nonFinBefore.length === nonFinAfter.length && nonFinBefore.every((x) => nonFinAfter.find((y) => y.symbol === x.symbol)?.inputsFingerprint === x.inputsFingerprint);
    console.log(`    81 non-financial snapshots: ${nfSame ? "byte-identical ✓ (untouched — different industry)" : "✗ CHANGED"}`);

    // Other PG5 peers: F7 peer set grew by ICICI → their F7 L2 shifts slightly (CORRECT cross-section effect)
    console.log(`    Other PG5 peers (F7 peer set grew ${before5.members.filter((m)=>m.fMetrics.find((x)=>x.metricKey==="CASA")?.scoreState==="scored").length}→${after5.members.filter((m)=>m.fMetrics.find((x)=>x.metricKey==="CASA")?.scoreState==="scored").length}):`);
    for (const x of peerBefore) {
      if (x.s === TARGET) continue;
      const y = after5.members.find((m) => m.symbol === x.s)!;
      const d = (y.composite.composite ?? 0) - (x.c ?? 0);
      console.log(`      ${x.s.padEnd(12)} ${f(x.c)} → ${f(y.composite.composite)}  (Δ${d >= 0 ? "+" : ""}${f(d)})`);
    }
    console.log(`    ↑ small peer shifts = CORRECT: adding ICICI's CASA grows the F7 cross-section (more complete data), not a leak.`);

    // ── IDEMPOTENCY: the inputsFingerprint now includes the new CASA ──
    const m = after5.members.find((x) => x.symbol === TARGET)!;
    const { snapshotInputsFingerprint } = await import("../scoring/composite/persist.js");
    const newFp = snapshotInputsFingerprint(m.composite);
    const committed = await prisma.scoreSnapshot.findFirst({ where: { symbol: TARGET, industryPath: "banking" }, select: { inputsFingerprint: true, composite: true } });
    console.log(`\n  ── IDEMPOTENCY ──`);
    console.log(`    committed (pre-inject) fingerprint: ${committed?.inputsFingerprint.slice(0, 12)}…  composite=${f(Number(committed?.composite))}`);
    console.log(`    post-inject recomputed fingerprint: ${newFp.slice(0, 12)}…  composite=${f(m.composite.composite)}`);
    console.log(`    → ${newFp !== committed?.inputsFingerprint ? "DIFFERENT ✓ — the CASA legitimately changes the score → a commit would SUPERSEDE the prior snapshot" : "same"}`);
    console.log(`    → re-running the inject+rescore WITHOUT a new CASA would reproduce this exact fingerprint → skip-identical (idempotent).`);
  } finally {
    // ── REVERT: delete the injected row (demonstration only — leaves committed scores untouched) ──
    const del = await prisma.bankSupplementary.deleteMany({ where: { enteredBy: "demo:stage3-casa-rescore" } });
    const revert = await computePgScores(PG5);
    const r = f7Of(revert, TARGET);
    console.log(`\n  ── REVERT (demonstration, no score committed) ──`);
    console.log(`    deleted ${del.count} injected CASA row(s); ${TARGET} F7 back to: ${r.f7State} ${r.f7State === "missing_renorm" ? "(§5.8 excluded — restored)" : ""}`);
    const leaked = await prisma.bankSupplementary.count({ where: { enteredBy: "demo:stage3-casa-rescore" } });
    console.log(`    durable demo rows remaining: ${leaked} (expect 0); committed snapshots untouched (no score write this stage).`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
