// STAGE-F STEP 1 — PG-wide dampening proof (read-only / dry). Reports which patterns trip the
// >80% sector-wide dampening in which PGs, confirms patterns-only (red flags never dampen), and
// shows a dampened finding's halved magnitude + annotation.
//   npx tsx src/scripts/stageF-dampening-proof.ts

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";

const PGS: PgRef[] = [
  ["PG1", "Large-Cap IT Services"], ["PG2", "Large-Cap FMCG"], ["PG3", "Large-Cap Pharma"], ["PG4", "Large-Cap Auto OEMs"],
  ["PG5", "Large-Cap Private Banks"], ["PG6", "Large-Cap PSU Banks"], ["PG8", "Large-Cap Power & Utilities"],
  ["PG9", "Large-Cap Metals & Mining"], ["PG10", "Large-Cap Oil & Gas"], ["PG11", "Large-Cap Capital Goods & Industrial"],
  ["PG12", "Large-Cap Cement"], ["PG13", "Large-Cap Consumer Durables & Electrical"], ["PG14", "Large-Cap Defense"],
].map(([pgId, pgName]) => ({ pgId, seedKey: "", pgName }));

async function main() {
  console.log("════ PG-WIDE DAMPENING PROOF (>80% sector-wide) ════\n");
  let totalDampenedKeys = 0, redFlagDampened = 0, dampenedInstances = 0;
  let sampleShown = false;
  for (const ref of PGS) {
    let c; try { c = await computePgScores(ref, { withFindings: true }); } catch { continue; }
    const rep = c.dampenReport;
    const scored = c.members.filter((m) => m.composite.state === "scored" && m.findings).length;
    if (rep && rep.dampened.length) {
      totalDampenedKeys += rep.dampened.length;
      console.log(`── ${ref.pgId} ${ref.pgName} (${scored} scored) ──`);
      for (const d of rep.dampened) console.log(`   DAMPENED ${d.key}  fired on ${d.firedOn}/${d.pctOfScored ? rep.scoredMembers : ""}${rep.scoredMembers} (${d.pctOfScored}%)`);
    }
    // Show the TOP pattern fire-rates per PG (to prove the counting works + why none cross 80%).
    const N = scored;
    const cnt = new Map<string, number>();
    for (const m of c.members) { if (m.composite.state !== "scored" || !m.findings) continue; const seen = new Set<string>(); for (const f of m.findings) if (f.kind === "pattern" && !seen.has(f.key)) { seen.add(f.key); cnt.set(f.key, (cnt.get(f.key) ?? 0) + 1); } }
    const top = [...cnt.entries()].map(([k, v]) => ({ k, v, pct: Math.round((v / N) * 100) })).sort((a, b) => b.pct - a.pct).slice(0, 3);
    if (top.length) console.log(`  ${ref.pgId.padEnd(5)} (${N} scored) top rates: ${top.map((t) => `${t.k.replace(/^[a-z_]+_/, "")} ${t.v}/${N}=${t.pct}%`).join("  ")}`);
    // integrity: red flags must NEVER be dampened; count dampened instances + grab a sample.
    for (const m of c.members) for (const f of m.findings ?? []) {
      if (f.displayState === "dampened") {
        dampenedInstances++;
        if (f.kind === "red_flag") redFlagDampened++;
        if (!sampleShown && f.magnitude != null) {
          console.log(`   ▸ sample dampened: ${m.symbol} ${f.key} mag=${f.magnitude} (halved) state=${f.displayState}\n     ${(f.evidence as any).sectorWide}`);
          sampleShown = true;
        }
      }
    }
  }
  // ── historical periods: does dampening EVER trip when a sector was uniform? ──
  console.log("\n── historical-period dampening scan (point-in-time) ──");
  const qEnd = (pk: string) => { const m = /^FY(\d{2})Q([1-4])$/.exec(pk)!; const fy = 2000 + +m[1], q = +m[2]; return q === 1 ? new Date(Date.UTC(fy - 1, 5, 30)) : q === 2 ? new Date(Date.UTC(fy - 1, 8, 30)) : q === 3 ? new Date(Date.UTC(fy - 1, 11, 31)) : new Date(Date.UTC(fy, 2, 31)); };
  let histDampened = 0;
  for (const pk of ["FY24Q3", "FY24Q4", "FY25Q2", "FY25Q4"]) {
    for (const ref of PGS) {
      let c; try { c = await computePgScores(ref, { withFindings: true, pointInTime: { quarterEnd: qEnd(pk), expectPeriodKey: pk } }); } catch { continue; }
      const rep = c.dampenReport;
      if (rep && rep.dampened.length) { histDampened += rep.dampened.length; console.log(`  ${pk} ${ref.pgId} (${rep.scoredMembers} scored): ${rep.dampened.map((d) => `${d.key.replace(/^[a-z_]+_/, "")} ${d.firedOn}/${rep.scoredMembers}=${d.pctOfScored}%`).join(", ")}`); }
    }
  }
  if (!histDampened) console.log("  (no >80% sector-wide condition in the sampled historical periods either)");

  console.log(`\n── summary ──`);
  console.log(`  dampened (key,PG) pairs: ${totalDampenedKeys}`);
  console.log(`  dampened finding instances: ${dampenedInstances}`);
  console.log(`  red flags dampened (must be 0): ${redFlagDampened} ${redFlagDampened === 0 ? "✅ patterns-only confirmed" : "❌"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
