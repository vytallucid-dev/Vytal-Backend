// STAGE 2 — 7 universal sub-components on CLEANED prices (read-only; commits nothing).
//   npx tsx src/scripts/stage2-subcomponents-check.ts
// Per focus PG: peer-pool medians (C1 sector 1yr return, D1 baseline vol) over the
// RECONCILED roster, then A1/A2/B1/B2/B3/C1/D1 raw values for every member, with a
// strong vs weak highlight (strong sits high on A1/A2, weak low).

import { prisma } from "../db/prisma.js";
import { PEER_GROUPS } from "./peer-groups.seed.js";
import { getCleanedCloses } from "../scoring/price/load.js";
import type { DailyClose } from "../scoring/price/range.js";
import {
  a1RangePosition52w, a2RangePosition3y, b1Vs200Dma, b2QuarterTrend, b3RecentMove,
  c1RelativeStrength, d1VolRatio, sectorOneYearReturnMedian, sectorBaselineVol,
  type PeerSeries,
} from "../scoring/market/universal-subcomponents.js";

const FOCUS = ["pg10_oil_gas", "pg11_capital_goods", "pg12_cement", "pg14_defense"];
const f = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

async function main() {
  console.log("STAGE 2 — UNIVERSAL MARKET SUB-COMPONENTS (raw values on cleaned prices)\n");

  for (const key of FOCUS) {
    const seed = PEER_GROUPS.find((p) => p.key === key)!;
    const stocks = await prisma.stock.findMany({ where: { symbol: { in: seed.stocks } }, select: { id: true, symbol: true } });
    const idBySym = new Map(stocks.map((s) => [s.symbol, s.id]));

    // Load cleaned series for each member (gated via getCleanedCloses).
    const peers: PeerSeries[] = [];
    const seriesBySym = new Map<string, DailyClose[]>();
    let lastDates: number[] = [];
    for (const sym of seed.stocks) {
      const id = idBySym.get(sym); if (!id) continue;
      const cs = await getCleanedCloses(id, sym);
      if (cs.closes.length === 0) continue;
      peers.push({ symbol: sym, series: cs.closes });
      seriesBySym.set(sym, cs.closes);
      lastDates.push(cs.closes[cs.closes.length - 1].date.getTime());
    }
    // Common as-of: the earliest member last-date (so every member has a close ≤ asOf).
    const asOf = new Date(Math.min(...lastDates));

    const secRet = sectorOneYearReturnMedian(peers, asOf);
    const secVol = sectorBaselineVol(peers, asOf);

    console.log("═".repeat(108));
    console.log(`${key}  ${seed.name}  — asOf ${asOf.toISOString().slice(0, 10)}  (pool = reconciled roster, n=${peers.length})`);
    console.log(`  PEER-POOL: sector 1yr-return MEDIAN = ${f(secRet.median)}%  (n=${secRet.n} contributors)`);
    console.log(`             ${secRet.contributors.map((c) => `${c.symbol}:${c.ret.toFixed(0)}%`).join("  ")}`);
    console.log(`  PEER-POOL: sector BASELINE 90d-vol MEDIAN = ${secVol.baseline != null ? (secVol.baseline * 100).toFixed(1) + "%" : "—"}  (peers=${secVol.nPeers}, obs=${secVol.nObs} over 3yr)${secVol.reason ? "  ⚑" + secVol.reason : ""}`);
    console.log(`  ${"stock".padEnd(11)} ${"A1".padStart(6)} ${"A2".padStart(6)} ${"B1%".padStart(8)} ${"B2".padStart(4)} ${"B3".padStart(7)} ${"C1pp".padStart(8)} ${"D1".padStart(6)}`);

    const rows: { sym: string; a1: number | null; a2: number | null }[] = [];
    for (const sym of seed.stocks) {
      const series = seriesBySym.get(sym);
      if (!series) { console.log(`  ${sym.padEnd(11)} (no price)`); continue; }
      const a1 = a1RangePosition52w(series, asOf);
      const a2 = a2RangePosition3y(series, asOf);
      const b1 = b1Vs200Dma(series, asOf);
      const b2 = b2QuarterTrend(series, asOf);
      const b3 = b3RecentMove(series, asOf);
      const c1 = c1RelativeStrength(series, asOf, secRet.median);
      const d1 = d1VolRatio(series, asOf, secVol.baseline);
      rows.push({ sym, a1: a1.value, a2: a2.value });
      console.log(`  ${sym.padEnd(11)} ${f(a1.value).padStart(6)} ${f(a2.value).padStart(6)} ${f(b1.value, 1).padStart(8)} ${(b2.available ? b2.value : "—")!.toString().padStart(4)} ${f(b3.value).padStart(7)} ${f(c1.value, 1).padStart(8)} ${f(d1.value).padStart(6)}`);
    }
    // strong vs weak by A1 (recent positioning)
    const scored = rows.filter((r) => r.a1 != null).sort((a, b) => b.a1! - a.a1!);
    if (scored.length >= 2) {
      const s = scored[0], w = scored[scored.length - 1];
      console.log(`  STRONG (high A1): ${s.sym} A1=${f(s.a1)} A2=${f(s.a2)}   WEAK (low A1): ${w.sym} A1=${f(w.a1)} A2=${f(w.a2)}`);
    }
    console.log("");
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
