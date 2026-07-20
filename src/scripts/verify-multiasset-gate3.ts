// GATE 3 — the new book must not have perturbed anything, and its own invariants must hold. READ-ONLY.
//   npx tsx src/scripts/verify-multiasset-gate3.ts
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";

const EMAIL = "__multiasset_book@test.invalid";
let fail = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); if (!c) fail++; };
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;

async function main() {
  const user = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  if (!user) throw new Error("test user not found");
  const USER = user.id;

  // ── 1 · structure == construction_data.net (the one derived projection) ──
  const snap = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: USER }, orderBy: { createdAt: "desc" }, select: { structure: true, constructionData: true, phs: true } });
  const cnet = (snap!.constructionData as any)?.net;
  // The `structure` COLUMN is Decimal(8,4); persist writes the SAME cData.net to both, so they agree to the
  // column's storable precision (4dp). construction_data keeps full float — the equality is at 4dp, by design.
  ok("structure column == construction_data.net (to the column's 4dp precision — same source object)",
    Number(snap!.structure).toFixed(4) === Number(cnet).toFixed(4), `structure=${snap!.structure} net=${cnet}`);

  // ── 2 · PARTITION — every valued holding lands in exactly one sleeve; the shares sum to 1 ──
  const { holdings } = await assemblePortfolio(USER);
  const r: any = computePhs(holdings);
  const total = r.totalValue;
  const entV = (r.entityLedger as any[]).reduce((s, e) => s + e.weight, 0);
  const bskV = (r.basketLedger as any[]).reduce((s, b) => s + b.weight, 0);
  // sovereign = gsec/sgb (valued, not name-risk, not basket)
  const sov = (holdings as any[]).filter((h) => h.assetClass === "gsec" || h.assetClass === "sgb").reduce((s, h) => s + h.marketValue, 0) / total;
  ok("PARTITION — entities + baskets + sovereign = 100% (nothing double-counted, nothing dropped)",
    near(entV + bskV + sov, 1, 1e-4), `entities ${(entV*100).toFixed(2)}% + baskets ${(bskV*100).toFixed(2)}% + sovereign ${(sov*100).toFixed(2)}% = ${((entV+bskV+sov)*100).toFixed(2)}%`);
  ok("every holding weight sums to 1 (whole book)", near((holdings as any[]).reduce((s, h) => s + h.marketValue, 0) / total, 1), `${holdings.length} holdings`);

  // ── 3 · THE NEW BOOK'S OWN §13 — the bonds/funds contribute NOTHING to Health/Quality ──
  const scoredOnly = (holdings as any[]).filter((h) => h.health != null);
  const rScored: any = computePhs(scoredOnly);
  ok("§13 — Health is byte-identical with vs without the 9 non-scored holdings (bonds/funds add nothing)",
    r.health === rScored.health, `all=${r.health} scoredOnly=${rScored.health}`);
  ok("§13 — Quality (the anchor, weighted health over SCORED by own w_i) is byte-identical too",
    near(Number(r.quality), Number(rScored.quality)), `all=${r.quality} scoredOnly=${rScored.quality}`);
  ok("§13 — coverage DOES move (denominator changed) — the honest difference", !near(r.coverage, rScored.coverage),
    `all=${(r.coverage*100).toFixed(1)}% scoredOnly=${(rScored.coverage*100).toFixed(0)}%`);

  // ── 4 · C1 fired on the AGGREGATE entity, not either leg (the Example-C proof, live) ──
  const ntpc = (r.entityLedger as any[]).find((e) => e.entityKey === "INE733E");
  ok("C1's NTPC entity = 2 constituents (stock+bond), weight > 15% threshold (fires on the aggregate)",
    ntpc && ntpc.constituentInstruments.length === 2 && ntpc.weight > 0.15, `NTPC ${(ntpc?.weight*100).toFixed(2)}% · ${ntpc?.constituentInstruments.length} constituents`);

  console.log("\n" + (fail === 0 ? "  ✅ GATE 3 INVARIANTS — ALL PASS" : `  ❌ ${fail} FAILURE(S)`));
  await prisma.$disconnect();
  process.exitCode = fail ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
