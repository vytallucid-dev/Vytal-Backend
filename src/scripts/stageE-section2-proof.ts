// STAGE-E STEP 1 — §2 risk-shape proof (read-only). Computes both lines for a spread of
// stocks (calm Quality vs volatile Commodity vs Growth; different Foundation zones), proving
// K1 + the class-group interpretation + the min-history gate. §2 is a READ-LAYER computation
// (no findings-table write).  npx tsx src/scripts/stageE-section2-proof.ts

import { prisma } from "../db/prisma.js";
import { getCleanedCloses } from "../scoring/price/load.js";
import { computeRiskShape } from "../scoring/findings/section2/risk-shape.js";
import type { SectorClass } from "../scoring/findings/types.js";

const numQ = (d: any): number | null => (d == null ? null : typeof d.toNumber === "function" ? d.toNumber() : Number(d));

async function main() {
  console.log("════ §2 RISK-SHAPE PROOF (read-layer computation — no findings write) ════\n");
  const syms = ["HINDUNILVR", "TCS", "NESTLEIND", "TATASTEEL", "VEDL", "HINDALCO", "JSWSTEEL", "DELHIVERY", "ZOMATO", "GLENMARK"];
  for (const sym of syms) {
    const st = await prisma.stock.findFirst({ where: { symbol: sym }, select: { id: true, sector: { select: { name: true, sectorClass: true } } } });
    if (!st) continue;
    const snap = await prisma.scoreSnapshot.findFirst({ where: { symbol: sym, snapshotType: "quarterly", periodKey: "FY26Q4" }, orderBy: { version: "desc" }, select: { foundationSubtotal: true, wFoundation: true } });
    const foundation = snap && numQ(snap.wFoundation)! > 0 ? numQ(snap.foundationSubtotal) : null;
    const cleaned = await getCleanedCloses(st.id, sym);
    const rs = computeRiskShape({ cleaned: cleaned.closes, foundationSubtotal: foundation, sectorClass: (st.sector?.sectorClass ?? null) as SectorClass | null, clean: cleaned.report.clean });
    console.log(`── ${sym}  [${st.sector?.name} / ${st.sector?.sectorClass ?? "—"}]  F=${foundation?.toFixed(0) ?? "—"}  (${cleaned.closes.length} cleaned closes) ──`);
    console.log(`  LINE 1: ${rs.line1.available ? rs.line1.template : `(${rs.line1.note})`}`);
    if (rs.line1.available) console.log(`          vol recent=${rs.line1.realizedVolRecent}% baseline=${rs.line1.realizedVolBaseline}% ratio=${rs.line1.rideRatio} | drawdown=${rs.line1.worstDrawdownPct}%`);
    console.log(`  LINE 2: [group ${rs.line2.classGroup ?? "—"} × ${rs.line2.foundationZone ?? "—"}] ${rs.line2.interpretation ?? "(unavailable — sector unmapped or foundation absent)"}`);
    console.log();
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
