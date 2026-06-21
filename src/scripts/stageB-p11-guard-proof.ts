// STAGE-B P11 GUARD-REUSE PROOF (read-only). Proves the exceptional-item guard:
//   • DRREDDY, HCLTECH (Stage-A false-fires) now DO NOT fire — guarded out.
//   • ITC, TECHM, TORNTPHARM (genuine gradual compression) STILL fire, correct N + series.
//   • Universe census of guarded P11 fires + any status change vs unguarded.
//
//   npx tsx src/scripts/stageB-p11-guard-proof.ts
// Writes nothing.

import { prisma } from "../db/prisma.js";
import { computePgScores, type PgRef } from "../scoring/composite/score-pass.js";
import { loadMomentumStandalone } from "../scoring/metrics/load.js";
import { opmSeriesFromQuarters } from "../scoring/findings/context.js";
import { latestQuarterDistorted } from "../scoring/findings/guards/exceptional-opm.js";
import { ruleP11, P11_MIN_DECLINES } from "../scoring/findings/rules/p11-margin-compression.js";
import type { FiringContext, QuarterlyOpmPoint } from "../scoring/findings/types.js";

/** Unguarded P11 (Stage-A naive): trailing strict-decline run, no exceptional guard. */
function unguardedFires(series: QuarterlyOpmPoint[]): { fires: boolean; n: number; run: number[] } {
  if (series.length < P11_MIN_DECLINES + 1) return { fires: false, n: 0, run: [] };
  const run = [series[series.length - 1].opm];
  for (let i = series.length - 1; i > 0; i--) { if (series[i].opm < series[i - 1].opm) run.unshift(series[i - 1].opm); else break; }
  return { fires: run.length - 1 >= P11_MIN_DECLINES, n: run.length - 1, run };
}

async function main() {
  console.log("════ P11 GUARD-REUSE PROOF ════\n");
  console.log("── Named stocks: unguarded (naive) vs guarded ──");
  for (const sym of ["DRREDDY", "HCLTECH", "ITC", "TECHM", "TORNTPHARM"]) {
    const st = await prisma.stock.findFirst({ where: { symbol: sym }, select: { id: true } });
    if (!st) continue;
    const q = await loadMomentumStandalone(st.id);
    const series = opmSeriesFromQuarters(q);
    const un = unguardedFires(series);
    const guarded = ruleP11({ quarterlyOpm: series } as unknown as FiringContext);
    const distorted = latestQuarterDistorted(series);
    const tail = series.slice(-6).map((p) => p.opm.toFixed(1)).join("→");
    console.log(`  ${sym.padEnd(11)} OPM[..6]=${tail}`);
    console.log(`     unguarded: ${un.fires ? `FIRE (N=${un.n}, ${un.run.map((x) => x.toFixed(1)).join("→")})` : "no fire"}` +
      `   | latestDistorted=${distorted}` +
      `   | GUARDED: ${guarded ? `FIRE → "${(guarded.evidence as any).verbatim}"` : "NO FIRE"}`);
  }

  console.log("\n── Universe census: guarded P11 fires (live, all PGs) ──");
  const PGS: PgRef[] = [
    { pgId: "PG1", seedKey: "pg1_it_services", pgName: "Large-Cap IT Services" },
    { pgId: "PG2", seedKey: "pg2_fmcg", pgName: "Large-Cap FMCG" },
    { pgId: "PG3", seedKey: "pg3_pharma", pgName: "Large-Cap Pharma" },
    { pgId: "PG4", seedKey: "pg4_auto_oem", pgName: "Large-Cap Auto OEMs" },
    { pgId: "PG8", seedKey: "pg8_power", pgName: "Large-Cap Power & Utilities" },
    { pgId: "PG9", seedKey: "pg9_metals", pgName: "Large-Cap Metals & Mining" },
    { pgId: "PG10", seedKey: "pg10_oil_gas", pgName: "Large-Cap Oil & Gas" },
    { pgId: "PG11", seedKey: "pg11_capital_goods", pgName: "Large-Cap Capital Goods & Industrial" },
    { pgId: "PG12", seedKey: "pg12_cement", pgName: "Large-Cap Cement" },
    { pgId: "PG13", seedKey: "pg13_consumer_durables", pgName: "Large-Cap Consumer Durables & Electrical" },
    { pgId: "PG14", seedKey: "pg14_defense", pgName: "Large-Cap Defense" },
  ];
  const fired: string[] = [];
  for (const ref of PGS) {
    let c; try { c = await computePgScores(ref, { withFindings: true }); } catch { continue; }
    for (const m of c.members) {
      const p11 = m.findings?.find((f) => f.key === "momentum_P11_margin_compression");
      if (p11) fired.push(`${m.symbol} (N=${(p11.evidence as any).quartersOfDecline}: ${(p11.evidence as any).opmSeries.map((x: any) => x.opm.toFixed(1)).join("→")})`);
    }
  }
  console.log(`  ${fired.length} guarded P11 fires: ${fired.join("  |  ")}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
