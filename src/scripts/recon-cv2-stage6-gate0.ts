// CONSTRUCTION v2 — STAGE 6 — GATE 0 RECON (read-only). Bands · archetype · display · S1–S5 deletion.
// Prototypes the archetype derivation over the cohort, and PROVES the persistence gap: the C-ledger +
// archetype the FE must display are NOT on the persisted snapshot. Builds nothing.
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs, type PhsHolding } from "../portfolio/phs/engine.js";
import { natureOf } from "../portfolio/phs/entity.js";

const q = <T = any>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
const DEBT_CAT = /\bDebt Scheme\b/i;

// archetype exposure shares (doc 2 §4.1). debt = bond/gsec by class + "Debt Scheme" baskets. commodity =
// commodity-nature (gold/silver ETF) + sgb. nameRisk/basket from sleeves.
function exposures(holdings: PhsHolding[], totalValue: number) {
  let debt = 0, commodity = 0;
  for (const h of holdings) {
    const w = totalValue > 0 ? h.marketValue / totalValue : 0;
    const ac = h.assetClass ?? "unknown";
    const nat = natureOf(ac, h.category ?? null);
    if (ac === "bond" || ac === "gsec" || ((ac === "mutual_fund" || ac === "etf") && DEBT_CAT.test(h.category ?? ""))) debt += w;
    if (nat === "commodity" || ac === "sgb") commodity += w;
  }
  return { debt, commodity };
}
function archetypeOf(nameRisk: number, basket: number, debt: number, commodity: number): string {
  if (debt >= 0.5) return "Income-led";          // 1 · what you own economically
  if (commodity >= 0.5) return "Commodity-led";  // 2
  if (nameRisk >= 0.6) return "Stock-led";       // 3 · how you hold it
  if (basket >= 0.6) return "Fund-led";          // 4
  return "Blended";                              // 5
}

async function main() {
  const users = await q<{ user_id: string }>(`SELECT DISTINCT user_id FROM transactions`);

  console.log("═══ 4 · ARCHETYPE derivation over the cohort (order: Income → Commodity → Stock → Fund → Blended) ═══");
  for (const u of users) {
    const { holdings } = await assemblePortfolio(u.user_id);
    const r = computePhs(holdings);
    const { debt, commodity } = exposures(holdings, r.totalValue);
    const a = archetypeOf(r.sleeves.nameRisk, r.sleeves.basket, debt, commodity);
    console.log(`  ${u.user_id.slice(0, 8)} | nameRisk ${(r.sleeves.nameRisk * 100).toFixed(1)}% basket ${(r.sleeves.basket * 100).toFixed(1)}% debt ${(debt * 100).toFixed(1)}% commodity ${(commodity * 100).toFixed(1)}% → ${a}`);
  }
  // order proof: a 100% bond book is BOTH name-risk and income → Income-led wins.
  const bondBook: PhsHolding[] = [{ symbol: "B", marketValue: 1e6, tier: "unknown", sector: null, health: null, findings: [], isin: "INE111A07011", assetClass: "bond" }];
  const rb = computePhs(bondBook); const eb = exposures(bondBook, rb.totalValue);
  console.log(`  [synthetic] 100% bond: nameRisk ${(rb.sleeves.nameRisk * 100).toFixed(0)}% debt ${(eb.debt * 100).toFixed(0)}% → ${archetypeOf(rb.sleeves.nameRisk, rb.sleeves.basket, eb.debt, eb.commodity)} (Income beats Stock — the truer sentence)`);
  const goldBook: PhsHolding[] = [{ symbol: "G", marketValue: 1e6, tier: "unknown", sector: null, health: null, findings: [], isin: "INF111G01011", assetClass: "etf", category: "Other Scheme - Gold ETF" }];
  const rg = computePhs(goldBook); const eg = exposures(goldBook, rg.totalValue);
  console.log(`  [synthetic] 100% gold ETF: commodity ${(eg.commodity * 100).toFixed(0)}% → ${archetypeOf(rg.sleeves.nameRisk, rg.sleeves.basket, eg.debt, eg.commodity)}`);

  console.log("\n═══ 6 · THE PERSISTENCE GAP — what the FE must display vs what the snapshot carries ═══");
  const arman = users.find((u) => u.user_id.startsWith("7985d813"))!;
  const snap = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: arman.user_id }, orderBy: { createdAt: "desc" } });
  const cols = snap ? Object.keys(snap) : [];
  const need = ["construction (C1–C6 ledger)", "archetype", "sleeves/exposure shares", "subjectShare per rule"];
  console.log(`  persisted snapshot columns: ${cols.join(", ")}`);
  console.log(`  structureLedger persisted = S-RULES:`, JSON.stringify((snap?.structureLedger as any[])?.map((e) => e.rule)));
  console.log(`  → the FE render needs: ${need.join(" · ")}`);
  console.log(`  → NONE of these are on the snapshot. The read path is pure (no recompute). ⇒ Gate 1 migration REQUIRED.`);

  console.log("\n═══ 1 · CDeduction shape — does it carry subjectShare? ═══");
  const r = computePhs((await assemblePortfolio(arman.user_id)).holdings);
  console.log(`  CDeduction keys: ${JSON.stringify(Object.keys(r.construction.c3))} — subjectShare ${"subjectShare" in r.construction.c3 ? "PRESENT" : "ABSENT (must add for the evaluability panel)"}`);

  console.log("\n═══ 8 · BASELINES (post-prune: 1 served row per user) ═══");
  for (const u of users) {
    const r = computePhs((await assemblePortfolio(u.user_id)).holdings);
    console.log(`  ${u.user_id.slice(0, 8)} | health ${r.health} · construction.net ${r.construction.net.toFixed(2)}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error("RECON ERROR:", e?.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
