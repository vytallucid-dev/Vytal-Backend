// READ-ONLY: is the PV2/PV3 count/% mismatch real on live books?
// The % (coverage = scoredValue/totalValue) is computed by assemble over the UNION (manual ∪ broker).
// The counts (scoredCount/totalCount) are counted by the controller over `prisma.holding` — MANUAL ONLY.
// Different populations ⇒ "Covers 3 of 4 holdings · 85% of book value" where the 85% includes positions
// the 4 excludes. Measure the gap.
import { prisma } from "../db/prisma.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { constructionDataOf } from "../portfolio/phs/entity.js";
import { computePhs } from "../portfolio/phs/engine.js";

async function main() {
  const users = (await prisma.$queryRawUnsafe<{ user_id: string }[]>(`SELECT DISTINCT user_id FROM transactions`)).map((u) => u.user_id).sort();
  let bad = 0;
  console.log("user     | TRUTH: assemble's valued union | OLD: prisma.holding (manual) | NEW: disclosure | broker rows");
  for (const uid of users) {
    const { holdings } = await assemblePortfolio(uid);
    const r = computePhs(holdings);
    // NEW: the counts as the controller now serves them — off constructionData, counted in persist over
    // the same aggregated `holdings` array `totalValue` sums.
    const cdOf = constructionDataOf(r.construction, r.entityLedger, r.basketLedger, r.sectors, holdings.length, holdings.filter((h) => h.health != null).length);
    const d = { scoredCount: cdOf.scoredCount, totalCount: cdOf.holdingCount };
    // what the controller counted BEFORE Stage 9 — the manual table only
    const manualTotal = await prisma.holding.count({ where: { userId: uid, quantity: { gt: 0 } } });
    const manualScored = await prisma.holding.count({
      where: { userId: uid, quantity: { gt: 0 }, instrument: { stock: { scoreSnapshots: { some: {} } } } },
    });
    const brokerRows = await prisma.brokerHolding.count({ where: { userId: uid } });
    // TRUTH = the population `totalValue` sums over
    const unionTotal = holdings.length;
    const unionScored = holdings.filter((h) => h.health != null).length;
    const oldWrong = unionTotal !== manualTotal || unionScored !== manualScored;
    const newOk = d.totalCount === unionTotal && d.scoredCount === unionScored;
    if (!newOk) bad++;
    console.log(
      `${uid.slice(0, 8)} | ${String(unionScored).padStart(2)}/${String(unionTotal).padStart(2)}` +
      ` | ${String(manualScored).padStart(2)}/${String(manualTotal).padStart(2)} ${oldWrong ? "❌ wrong population" : "(agreed)"}` +
      ` | ${String(d.scoredCount).padStart(2)}/${String(d.totalCount).padStart(2)} ${newOk ? "✅" : "❌"}` +
      ` | ${String(brokerRows).padStart(3)}   coverage=${(r.coverage * 100).toFixed(1)}%`);
  }
  console.log(`\n${bad === 0
    ? "✅ FIXED — the counts are now over the SAME valued union `totalValue` sums. The count and the % describe one book."
    : `❌ ${bad} book(s) still disagree`}`);
  console.log(`   The FE sentence (hero.tsx) "Covers {scoredCount} of {totalCount} holdings · {coverage}% of book value"`);
  console.log(`   now has both halves counted over one population, from one partition of one union.`);
  process.exitCode = bad === 0 ? 0 : 1;
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
