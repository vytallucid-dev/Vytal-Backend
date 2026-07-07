// ─────────────────────────────────────────────────────────────────────────────
// PHS PERSISTENCE SMOKE — the A.12 compute+persist contract end-to-end on a seeded
// user with REAL holdings (live prices/tiers/sectors/scores). Proves: assemble →
// computePhs → write ONE snapshot; re-run identical inputs → fingerprint match → skip.
// Throwaway user, cleaned up (cascade).
//   npx tsx src/scripts/verify-phs-persist.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { computeAndPersistPhs } from "../portfolio/phs/persist.js";

let failures = 0;
const ok = (n: string, c: boolean, d: string) => { console.log(`  ${c ? "✅" : "❌"} ${n} — ${d}`); if (!c) failures++; };

async function main() {
  // Pick scored + unscored live stocks (all carry price+tier+sector from prior passes).
  const scored = await prisma.stock.findMany({ where: { symbol: { in: ["RELIANCE", "TCS", "HDFCBANK"] }, scoreSnapshots: { some: {} } }, select: { id: true, symbol: true } });
  const unscored = await prisma.stock.findMany({ where: { symbol: { in: ["LENSKART", "SWIGGY"] } }, select: { id: true, symbol: true } });
  if (scored.length < 2) { console.log("  ⚠ need scored RELIANCE/TCS/HDFCBANK — skipping"); return finish(); }

  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `phs-${authId}@test.local`);
  const user = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  const userId = user!.id;

  try {
    // Real holdings (direct create — PHS reads holdings regardless of how they were built).
    const mk = (stockId: string, qty: number) => prisma.holding.create({ data: {
      userId, stockId, quantity: new Prisma.Decimal(qty), avgCost: new Prisma.Decimal(100),
      investedValue: new Prisma.Decimal(qty * 100), realizedPnl: new Prisma.Decimal(0), lastComputedAt: new Date(),
    }});
    for (const s of scored) await mk(s.id, 20);
    for (const s of unscored) await mk(s.id, 30);

    // First compute → writes a snapshot.
    const first = await computeAndPersistPhs(userId);
    ok("first compute writes a snapshot", !first.skipped && !!first.snapshotId, `skipped=${first.skipped} phs=${first.phs} band=${first.band}`);

    const snap = await prisma.portfolioHealthSnapshot.findUnique({ where: { id: first.snapshotId } });
    console.log(`     pillars: quality=${snap?.quality} structure=${snap?.structure} signals=${snap?.signals} · coverage=${snap?.coverage} · phs=${snap?.phs} ${snap?.band} · provisional=${snap?.provisional} · ceilingApplied=${snap?.ceilingApplied}`);
    console.log(`     value splits: total=${snap?.totalValue} scored=${snap?.scoredValue} recognized=${snap?.recognizedUnscoredValue} small=${snap?.smallUnscoredValue}`);
    ok("evaluable + phs present (has scored holdings)", snap?.evaluable === true && snap?.phs != null, `evaluable=${snap?.evaluable}`);
    ok("coverage = scored/total in (0,1)", Number(snap?.coverage) > 0 && Number(snap?.coverage) < 1, `c=${snap?.coverage}`);
    ok("structure ≤ 100 and signals ≤ 100 (penalty-only)", Number(snap?.structure) <= 100 && Number(snap?.signals) <= 100, `str=${snap?.structure} sig=${snap?.signals}`);
    ok("PHS ≤ Quality (penalty-only guarantee)", snap?.phs == null || snap?.quality == null || snap!.phs <= Math.ceil(Number(snap!.quality)), `phs=${snap?.phs} q=${snap?.quality}`);
    ok("structureLedger + signalsLedger are arrays", Array.isArray(snap?.structureLedger) && Array.isArray(snap?.signalsLedger), "json");
    ok("constant_version stamped (1.2)", snap?.constantVersion === "portfolio-spec 1.2", `${snap?.constantVersion}`);
    // (1.1 Change 2) copy-only tiers persisted on the snapshot.
    ok("structure_tier persisted (valid label)", ["Starter", "Building", "Established"].includes(snap?.structureTier ?? ""), `${snap?.structureTier}`);
    ok("capital_tier persisted (valid label)", ["Modest", "Moderate", "Substantial"].includes(snap?.capitalTier ?? ""), `${snap?.capitalTier}`);
    // (1.2 Change 3/4/5) ceiling retired → shows TRUE; pillarProfile persisted (scored book).
    ok("ceiling retired (ceilingApplied false, no cap)", snap?.ceilingApplied === false, `ceilingApplied=${snap?.ceilingApplied}`);
    const pp = snap?.pillarProfile as { foundation: number } | null | undefined;
    ok("pillar_profile persisted (4 pillars, scored book)", !!pp && typeof pp.foundation === "number", `${JSON.stringify(pp)}`);
    console.log(`     pillarProfile=${JSON.stringify(snap?.pillarProfile)} · lensProfile=${JSON.stringify(snap?.lensProfile)}`);

    // Re-run identical inputs → fingerprint match → skip (no duplicate snapshot).
    const second = await computeAndPersistPhs(userId);
    ok("re-run skips (fingerprint idempotency)", second.skipped && second.snapshotId === first.snapshotId, `skipped=${second.skipped}`);
    const count = await prisma.portfolioHealthSnapshot.count({ where: { userId } });
    ok("exactly ONE snapshot row (append-only, no dup)", count === 1, `count=${count}`);
  } finally {
    await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId);
    console.log("  [cleanup] test user + snapshot deleted (cascade)");
  }
  finish();
}
function finish() {
  console.log(`\n═══ ${failures === 0 ? "PERSIST SMOKE PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
  return prisma.$disconnect().then(() => process.exit(failures === 0 ? 0 : 1));
}
main().catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
