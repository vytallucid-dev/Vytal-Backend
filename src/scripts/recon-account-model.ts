// ─────────────────────────────────────────────────────────────────────────────
// STEP 5.5 GATE-0 — account-model recon (read-only).
//   npx tsx src/scripts/recon-account-model.ts
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { IMPLEMENTED_BROKERS, getAdapter, isBrokerId } from "../brokers/registry.js";

const j = (o: unknown) => JSON.stringify(o, null, 2);

// ── 1. portfolio_accounts: the real column shape ────────────────────────────
console.log("═══ portfolio_accounts — column shape ═══");
const cols = await prisma.$queryRawUnsafe<any[]>(`
  SELECT column_name, data_type, udt_name, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name = 'portfolio_accounts' ORDER BY ordinal_position`);
console.table(cols);

// ── 2. The BrokerId enum as it exists in the DB ─────────────────────────────
console.log("\n═══ BrokerId enum (DB) ═══");
const enums = await prisma.$queryRawUnsafe<any[]>(`
  SELECT e.enumlabel, e.enumsortorder
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'BrokerId' ORDER BY e.enumsortorder`);
console.log("  DB enum values:", enums.map((e) => e.enumlabel).join(", "));
console.log("  IMPLEMENTED_BROKERS (linkable today):", IMPLEMENTED_BROKERS.join(", "));
for (const b of enums.map((e) => e.enumlabel)) {
  let adapter = "—";
  try { adapter = isBrokerId(b) ? getAdapter(b).meta.displayName : "not a BrokerId"; }
  catch (e) { adapter = `NO ADAPTER (${(e as Error).name})`; }
  console.log(`    ${b.padEnd(10)} → ${adapter}${IMPLEMENTED_BROKERS.includes(b) ? "  [LINKABLE]" : "  [not linkable]"}`);
}

// ── 3. EVERY account in the DB: does it have a broker? ──────────────────────
console.log("\n═══ EVERY portfolio_account (the real data) ═══");
const accts = await prisma.portfolioAccount.findMany({
  select: {
    id: true, name: true, broker: true, brokerConnectionId: true, state: true, createdAt: true,
    user: { select: { email: true } },
    _count: { select: { transactions: true, holdings: true } },
  },
  orderBy: { createdAt: "asc" },
});
console.table(accts.map((a) => ({
  email: a.user.email.slice(0, 34),
  name: a.name,
  broker: a.broker ?? "**NULL**",
  state: a.state,
  bound: a.brokerConnectionId ? "yes" : "no",
  txns: a._count.transactions,
  holdings: a._count.holdings,
})));
const brokerless = accts.filter((a) => a.broker === null);
console.log(`  → ${brokerless.length}/${accts.length} accounts have broker = NULL (every one of them would need a backfill value)`);

// ── 4. The two production account CREATORS — what do they write? ────────────
console.log("\n═══ account creation paths (grep-confirmed) ═══");
console.log(`  A. accounts-controller.createAccount   → { userId, name, state:'manual' }          — NO broker`);
console.log(`  B. transactions-controller.ensureDefaultAccount (upsert "My Holdings")             — NO broker`);
console.log(`     ⚠️  B fires AUTOMATICALLY on a user's FIRST manual transaction (no accountId given).`);
console.log(`         It has NO broker to supply. A NOT-NULL broker column BREAKS this path unless`);
console.log(`         the model gives it a legitimate value to write.`);

// ── 5. Baseline: holdings + PHS that must not move ─────────────────────────
console.log("\n═══ BASELINE (must not move) ═══");
const users = await prisma.user.findMany({
  where: { transactions: { some: {} } },
  select: { id: true, email: true },
});
for (const u of users) {
  const h = await prisma.holding.findMany({
    where: { userId: u.id },
    select: { quantity: true, avgCost: true, realizedPnl: true, instrument: { select: { symbol: true } } },
    orderBy: { instrumentId: "asc" },
  });
  const phs = await prisma.portfolioHealthSnapshot.findFirst({
    where: { userId: u.id }, orderBy: { createdAt: "desc" },
    select: { phs: true, band: true, coverage: true, fingerprint: true },
  });
  console.log(`\n  ${u.email}`);
  console.log(`    holdings: ${h.map((x) => `${x.instrument.symbol}:${x.quantity}@${x.avgCost}/r${x.realizedPnl}`).join("  ")}`);
  console.log(`    PHS=${phs?.phs} band=${phs?.band} coverage=${phs?.coverage} fp=${phs?.fingerprint?.slice(0, 16)}…`);
}

await prisma.$disconnect();
