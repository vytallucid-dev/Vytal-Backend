// STAGE 3 — Market scoring + assembly + §14.4 cascade (read-only; commits nothing).
//   npx tsx src/scripts/stage3-market-check.ts
// Full pillar decomposition for the focus PGs, + real exclusion cases (VEDL quarantine,
// LTIM no-price → pillar excluded) + a controlled <756d truncation (A2 excluded → Cat A renorm).

import { prisma } from "../db/prisma.js";
import { scoreMarketForPg } from "../scoring/market/orchestrate.js";
import { getCleanedCloses } from "../scoring/price/load.js";
import * as SC from "../scoring/market/universal-subcomponents.js";
import { scoreSubComponent, assembleMarketUniversal } from "../scoring/market/market-universal.js";

const f = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));
const SUBORDER = ["A1", "A2", "B1", "B2", "B3", "C1", "D1"] as const;

function printMember(m: any) {
  const byKey = new Map(m.result.subs.map((s: any) => [s.key, s]));
  const cells = SUBORDER.map((k) => {
    const s: any = byKey.get(k);
    if (!s.available) return `${k}:excl`;
    return `${k}:${f(s.score, 0)}${s.saturated ? "↑" : ""}${s.capped ? "©" : ""}`;
  }).join(" ");
  const cats = m.result.categories.map((c: any) => `${c.category}=${c.available ? f(c.score, 0) : "—"}${c.renormalized ? "*" : ""}`).join(" ");
  const tag = m.quarantined ? " ⚠QUAR" : "";
  console.log(`    ${m.symbol.padEnd(11)} ${cells.padEnd(52)} | cats ${cats} | MKT ${m.result.state === "scored" ? f(m.result.subtotal, 1) : "EXCLUDED"}${tag}`);
  for (const fl of m.result.flags) console.log(`        §14.4 ${fl}`);
  if (m.result.reason) console.log(`        → ${m.result.reason}`);
}

async function main() {
  console.log("STAGE 3 — UNIVERSAL MARKET PILLAR: scoring + assembly + §14.4 cascade\n");
  console.log("  sub cell = score (↑=saturated, ©=B2 capped@90, excl=excluded); cats = category rollup (*=within-cat renorm)\n");

  for (const pgName of ["Large-Cap Oil & Gas", "Large-Cap Capital Goods & Industrial", "Large-Cap Cement", "Large-Cap Defense"]) {
    const pgm = await scoreMarketForPg(pgName);
    if (!pgm) { console.log(`${pgName}: not found`); continue; }
    console.log("═".repeat(112));
    console.log(`${pgName}  asOf ${pgm.asOf.toISOString().slice(0, 10)}  | peer pool: sector1yr median=${f(pgm.sectorMedian1yr)}% baselineVol=${pgm.sectorBaselineVol != null ? (pgm.sectorBaselineVol * 100).toFixed(1) + "%" : "—"} (n=${pgm.poolN})`);
    const scored = pgm.members.filter((m) => m.result.state === "scored").map((m) => m.result.subtotal!);
    for (const m of pgm.members) printMember(m);
    console.log(`  → Market range ${scored.length ? `${f(Math.min(...scored))}–${f(Math.max(...scored))}` : "—"}  (${scored.length}/${pgm.members.length} scored)\n`);
  }

  // ── REAL EXCLUSION CASES ──
  console.log("═".repeat(112));
  console.log("REAL EXCLUSION CASES (§14.4 cascade):\n");
  // (c) VEDL — quarantined demerger → all windows post-break too short → Market pillar EXCLUDED
  const pg9 = await scoreMarketForPg("Large-Cap Metals & Mining");
  const vedl = pg9?.members.find((m) => m.symbol === "VEDL");
  console.log(`  VEDL (PG9, quarantined @demerger):`);
  if (vedl) printMember(vedl);
  console.log(`    → peer pool excludes VEDL automatically (truncated <252d): PG9 sector1yr median=${f(pg9!.sectorMedian1yr)}% over n=${pg9!.poolN} (VEDL not a contributor)\n`);
  // (c) LTIM — no price → all sub-components excluded → Market pillar EXCLUDED
  const pg1 = await scoreMarketForPg("Large-Cap IT Services");
  const ltim = pg1?.members.find((m) => m.symbol === "LTIM");
  console.log(`  LTIM (PG1, no price data):`);
  if (ltim) printMember(ltim);
  console.log("");

  // ── CONTROLLED (a)/(b) — truncate a focus stock to ~400d → A2 excluded → Cat A renorm to A1@25% ──
  console.log("═".repeat(112));
  console.log("CONTROLLED EXCLUSION (no roster stock naturally sits at 252–756d; all have 5yr):");
  const s = await prisma.stock.findUnique({ where: { symbol: "ULTRACEMCO" }, select: { id: true } });
  if (s) {
    const cs = await getCleanedCloses(s.id, "ULTRACEMCO");
    const trunc = cs.closes.slice(-400); // 400 trading days: ≥252 (A1/B1/C1) but <756 (A2 excluded)
    const asOf = trunc[trunc.length - 1].date;
    // peer pool from full PG12 for C1/D1 references
    const pg12 = await scoreMarketForPg("Large-Cap Cement");
    const subs = [
      scoreSubComponent("A1", SC.a1RangePosition52w(trunc, asOf)),
      scoreSubComponent("A2", SC.a2RangePosition3y(trunc, asOf)),
      scoreSubComponent("B1", SC.b1Vs200Dma(trunc, asOf)),
      scoreSubComponent("B2", SC.b2QuarterTrend(trunc, asOf)),
      scoreSubComponent("B3", SC.b3RecentMove(trunc, asOf)),
      scoreSubComponent("C1", SC.c1RelativeStrength(trunc, asOf, pg12!.sectorMedian1yr)),
      scoreSubComponent("D1", SC.d1VolRatio(trunc, asOf, pg12!.sectorBaselineVol)),
    ];
    const r = assembleMarketUniversal(subs);
    console.log(`  ULTRACEMCO truncated to ${trunc.length}d (controlled):`);
    printMember({ symbol: "ULTRACEMCO*", result: r, quarantined: false, nDays: trunc.length });
    const catA = r.categories.find((c) => c.category === "A")!;
    console.log(`    A2 excluded (need 756, have 400) → Category A = {${catA.present.join(",")}} at ${(Object.values(catA.withinWeights)[0] * 100).toFixed(0)}% within-cat; effective A1 weight=${((r.effectiveSubWeights.A1 ?? 0) * 100).toFixed(1)}% of pillar (vs 12.5% normal)`);

    // (b) whole category empty → pillar renorms over surviving 3 (simulate D1-excluded thin pool)
    const pg12b = await scoreMarketForPg("Large-Cap Cement");
    const full = cs.closes; const asOfB = full[full.length - 1].date;
    const subsB = [
      scoreSubComponent("A1", SC.a1RangePosition52w(full, asOfB)),
      scoreSubComponent("A2", SC.a2RangePosition3y(full, asOfB)),
      scoreSubComponent("B1", SC.b1Vs200Dma(full, asOfB)),
      scoreSubComponent("B2", SC.b2QuarterTrend(full, asOfB)),
      scoreSubComponent("B3", SC.b3RecentMove(full, asOfB)),
      scoreSubComponent("C1", SC.c1RelativeStrength(full, asOfB, pg12b!.sectorMedian1yr)),
      scoreSubComponent("D1", SC.d1VolRatio(full, asOfB, null)), // null baseline = thin pool → D1 excluded PG-wide
    ];
    const rb = assembleMarketUniversal(subsB);
    console.log(`\n  (b) Category-drop: ULTRACEMCO with D1 excluded PG-wide (simulated <4-peer thin pool):`);
    printMember({ symbol: "ULTRACEMCO†", result: rb, quarantined: false, nDays: full.length });
    console.log(`    Category D empty → pillar renorms over surviving {${rb.survivingCategories.join(",")}} at ${((rb.categoryWeight ?? 0) * 100).toFixed(1)}% each (still SCORED — ≥2 categories)`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
