// (Stage 9) READ-ONLY PROBE — baskets[] in construction_data. Proves it on the LIVE cohort (the two
// fund-holding books) and on a synthetic PB6 book. No writes.
//   npx tsx src/scripts/probe-s9-baskets.ts
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { constructionDataOf } from "../portfolio/phs/entity.js";

async function main() {
  const users = (await prisma.$queryRawUnsafe<{ user_id: string }[]>(`SELECT DISTINCT user_id FROM transactions`)).map((u) => u.user_id).sort();
  console.log("═══ baskets[] on the LIVE cohort ═══\n");
  for (const uid of users) {
    const { holdings } = await assemblePortfolio(uid);
    const r = computePhs(holdings);
    const cd = constructionDataOf(r.construction, r.entityLedger, r.basketLedger, r.sectors, holdings.length, holdings.filter((h) => h.health != null).length);
    if (cd.baskets.length === 0) { console.log(`  ${uid.slice(0, 8)} · no baskets (stock-only book) · entities ${cd.entities.length}`); continue; }
    console.log(`  ${uid.slice(0, 8)} · ${cd.baskets.length} basket(s) · entities ${cd.entities.length}`);
    for (const b of cd.baskets) {
      console.log(`      ${b.isin}  ${(b.weight * 100).toFixed(1).padStart(5)}%  house=${b.fundHouse ?? "«unresolved»"}`);
      console.log(`        name: ${b.name}`);
      console.log(`        cat : ${b.category ?? "«null»"}`);
    }
  }

  // THE COVERAGE IDENTITY: entities ∪ baskets should account for the whole book, minus sovereign
  // (gsec/sgb are neither name-risk-aggregated nor a fund product — they belong to NEITHER ledger).
  console.log("\n═══ ledger coverage — entities + baskets vs the book ═══");
  for (const uid of users) {
    const { holdings } = await assemblePortfolio(uid);
    const r = computePhs(holdings);
    const eW = r.entityLedger.reduce((s, e) => s + e.weight, 0);
    const bW = r.basketLedger.reduce((s, b) => s + b.weight, 0);
    console.log(`  ${uid.slice(0, 8)} · entities ${(eW * 100).toFixed(1)}% + baskets ${(bW * 100).toFixed(1)}% = ${((eW + bW) * 100).toFixed(1)}%`
      + ` · nameRisk ${(r.construction.exposures.nameRisk * 100).toFixed(1)}% basket ${(r.construction.exposures.basket * 100).toFixed(1)}%`);
  }

  // SYNTHETIC — the PB6 book: five Large Cap Funds, together 60%. Proves the ledger carries what PB6's
  // bind needs (category · constituent funds · combined weight) and that it does NOT aggregate.
  console.log("\n═══ synthetic PB6 book — 5 Large Cap Funds @ 60%, two houses ═══");
  const LC = "Open Ended Schemes(Equity Scheme - Large Cap Fund)";
  const f = (isin: string, name: string, mv: number, house: string, cat: string): PhsHolding =>
    ({ symbol: isin, marketValue: mv, tier: "unknown", sector: null, health: null, findings: [], isin, assetClass: "mutual_fund", category: cat, fundHouse: house, name });
  const book = [
    f("INF001A01011", "HDFC Large Cap Fund - Growth", 15, "HDFC AMC", LC),
    f("INF002A01012", "ICICI Pru Bluechip Fund - Growth", 15, "ICICI Prudential AMC", LC),
    f("INF003A01013", "SBI Large Cap Fund - Growth", 10, "SBI Funds Management", LC),
    f("INF004A01014", "Axis Bluechip Fund - Growth", 10, "Axis AMC", LC),
    f("INF005A01015", "Nippon Large Cap Fund - Growth", 10, "Nippon India AMC", LC),
    f("INF006A01016", "HDFC Mid-Cap Opportunities - Growth", 40, "HDFC AMC", "Open Ended Schemes(Equity Scheme - Mid Cap Fund)"),
  ];
  const rb = computePhs(book);
  const byCat = new Map<string, { n: number; w: number; names: string[] }>();
  for (const b of rb.basketLedger) {
    const k = b.category ?? "«null»";
    const e = byCat.get(k) ?? { n: 0, w: 0, names: [] };
    e.n++; e.w += b.weight; e.names.push(b.name);
    byCat.set(k, e);
  }
  for (const [cat, e] of byCat) {
    const fires = e.n >= 2 && e.w >= 0.20;
    console.log(`  ${fires ? "PB6 FIRES" : "silent   "} · ${e.n} fund(s) · ${(e.w * 100).toFixed(0)}% · ${cat.replace(/^Open Ended Schemes\(Equity Scheme - /, "").replace(/\)$/, "")}`);
    if (fires) console.log(`      constituents: ${e.names.join(" · ")}`);
  }
  console.log(`\n  NOT aggregated (the ledger keeps funds distinct): ${rb.basketLedger.length} rows for ${new Set(rb.basketLedger.map((b) => b.fundHouse)).size} houses`);
  console.log(`  HDFC AMC holds 2 funds across 2 CATEGORIES — C5 sees one 55% house, PB6 sees one 60% category.`);
  console.log(`  Two different pile-ups, two different rules, one un-aggregated ledger. Collapsing here would hide both.`);
  console.log(`  C5 maxHousePct = ${rb.construction.c5.metrics?.maxHousePct?.toFixed(1)}% (${rb.construction.c5.metrics?.maxHouseName})`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
