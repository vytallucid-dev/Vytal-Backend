// READ-ONLY: the Stage-8 re-rating's LIVE blast radius on 7985d813, who holds "Kotak Manufacture in
// India Fund" (category = Sectoral/Thematic, matcher = NO MATCH — Manufacturing is deliberately unmapped).
// Post-matcher that fund flips not_applicable → unknown → it pools into unknownSectorValue and enters the
// §7 gate's denominator. Does unknownRatio trip C3_UNKNOWN_KILL (0.50) and silence C3/C4 on a live book?
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";
import * as K from "../portfolio/phs/constants.js";

async function main() {
  const uid = (await prisma.$queryRawUnsafe<{ user_id: string }[]>(
    `SELECT DISTINCT user_id FROM transactions WHERE user_id::text LIKE '7985d813%'`))[0].user_id;
  const { holdings } = await assemblePortfolio(uid);
  const r = computePhs(holdings);
  const total = r.totalValue;

  console.log(`7985d813 — ${holdings.length} positions · total ₹${total.toLocaleString("en-IN")}\n`);
  for (const h of holdings) {
    const w = h.marketValue / total;
    console.log(`  ${(w * 100).toFixed(2).padStart(6)}%  ${h.symbol.padEnd(14)} ${String(h.assetClass).padEnd(12)} sector=${h.sector ?? "—"}`);
  }

  console.log(`\nTODAY (all funds not_applicable — Stage 4 interim):`);
  console.log(`  sectoredShare ${(r.sectors.sectoredShare * 100).toFixed(2)}% · unknownRatio ${(r.sectors.unknownRatio * 100).toFixed(2)}% · gateOpen ${r.sectors.gateOpen}`);
  console.log(`  counts: resolved ${r.sectors.counts.resolved} · unknown ${r.sectors.counts.unknown} · not_applicable ${r.sectors.counts.notApplicable}`);
  console.log(`  C3 ${r.construction.c3.evaluable ? `−${r.construction.c3.points.toFixed(2)}` : "n/e"} · C4 ${r.construction.c4.evaluable ? `−${r.construction.c4.points.toFixed(2)}` : "n/e"} · Net ${r.construction.net.toFixed(2)}`);

  // POST-MATCHER SIMULATION: the sectoral+unmatched fund becomes `unknown` (a sectorable thing whose
  // sector we could not name) instead of `not_applicable` (a thing with no sector question at all).
  // Simulated by giving it the marker assemble would produce: sectorable, sector null.
  const kotak = holdings.find((h) => /manufactur/i.test(h.symbol) || h.assetClass === "mutual_fund");
  const fundVal = holdings.filter((h) => h.assetClass === "mutual_fund" || h.assetClass === "etf").reduce((s, h) => s + h.marketValue, 0);
  const sectoralFundVal = kotak ? kotak.marketValue : 0;
  const stockVal = holdings.filter((h) => h.assetClass === "stock").reduce((s, h) => s + h.marketValue, 0);
  const resolvedStockVal = holdings.filter((h) => h.assetClass === "stock" && h.sector != null).reduce((s, h) => s + h.marketValue, 0);

  console.log(`\nPOST-MATCHER (the sectoral+UNMATCHED fund joins the sectorable population as `+"`unknown`"+`):`);
  console.log(`  stock value ₹${stockVal.toLocaleString("en-IN")} (resolved ₹${resolvedStockVal.toLocaleString("en-IN")}) · fund value ₹${fundVal.toLocaleString("en-IN")}`);
  const newSectorable = resolvedStockVal + sectoralFundVal;
  const newUnknownRatio = newSectorable > 0 ? sectoralFundVal / newSectorable : 0;
  console.log(`  sectorable becomes ₹${newSectorable.toLocaleString("en-IN")} · unknown = the fund ₹${sectoralFundVal.toLocaleString("en-IN")}`);
  console.log(`  unknownRatio → ${(newUnknownRatio * 100).toFixed(2)}%  vs  C3_UNKNOWN_KILL ${(K.C3_UNKNOWN_KILL * 100).toFixed(0)}%`);
  console.log(`  ⇒ gate ${newUnknownRatio > K.C3_UNKNOWN_KILL ? "KILLED → C3/C4 go not_evaluable (the whole sector arm goes silent on this book)" : "STAYS OPEN → C3/C4 evaluate over the resolved subset; the fund contributes NO sector weight"}`);
  console.log(`  ⇒ sectoredShare would fall ${(r.sectors.sectoredShare * 100).toFixed(2)}% → ${((resolvedStockVal / total) * 100).toFixed(2)}%  (C3/C4 are scaled by it)`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
