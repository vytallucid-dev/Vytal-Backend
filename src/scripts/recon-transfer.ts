// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 GATE-0 RECON (read-only) — transfer + rescue-on-delete grounding.
//   npx tsx src/scripts/recon-transfer.ts
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";

const j = (o: unknown) => JSON.stringify(o, null, 2);

// ── 1. BASELINE: the real users' books (must not move) ──────────────────────
const users = await prisma.user.findMany({
  select: {
    id: true,
    email: true,
    _count: { select: { transactions: true, holdings: true, portfolioAccounts: true, brokerConnections: true, brokerHoldings: true } },
  },
  orderBy: { createdAt: "asc" },
});
console.log("═══ USERS ═══");
console.log(j(users));

for (const u of users) {
  const holdings = await prisma.holding.findMany({
    where: { userId: u.id },
    select: {
      accountId: true, instrumentId: true, quantity: true, avgCost: true, investedValue: true, realizedPnl: true,
      account: { select: { name: true, state: true } },
      instrument: { select: { symbol: true } },
      _count: { select: { lots: true } },
    },
  });
  const phs = await prisma.portfolioHealthSnapshot.findFirst({
    where: { userId: u.id }, orderBy: { createdAt: "desc" },
    // (Stage 7 §12) phsRaw dropped — the coverage ceiling was retired in 1.2, so there is no pre-ceiling value.
    select: { phs: true, band: true, coverage: true, fingerprint: true, createdAt: true },
  });
  console.log(`\n─ ${u.email} (${u.id}) ─`);
  console.log("  holdings:", j(holdings.map((h) => ({
    account: h.account.name, state: h.account.state, symbol: h.instrument.symbol,
    qty: h.quantity.toString(), avg: h.avgCost.toString(), inv: h.investedValue.toString(),
    realized: h.realizedPnl.toString(), lots: h._count.lots,
  }))));
  console.log("  phs:", j(phs));
}

// ── 2. THE FK CHAIN: what is account-keyed? ─────────────────────────────────
console.log("\n═══ FK CHAIN (columns referencing portfolio_accounts) ═══");
const fks = await prisma.$queryRawUnsafe<any[]>(`
  SELECT tc.table_name, kcu.column_name, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'portfolio_accounts'
  ORDER BY tc.table_name`);
console.log(j(fks));

console.log("\n═══ FK CHAIN (what cascades from holdings / broker_connections) ═══");
const fks2 = await prisma.$queryRawUnsafe<any[]>(`
  SELECT tc.table_name, kcu.column_name, ccu.table_name AS refs, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name IN ('holdings','broker_connections')
  ORDER BY tc.table_name`);
console.log(j(fks2));

// ── 3. NULLABILITY: can a Holding/Transaction express an unmapped broker symbol? ──
console.log("\n═══ NULLABILITY (holdings / transactions / broker_holdings) ═══");
const cols = await prisma.$queryRawUnsafe<any[]>(`
  SELECT table_name, column_name, is_nullable
  FROM information_schema.columns
  WHERE table_name IN ('holdings','transactions','broker_holdings','holding_lots')
    AND column_name IN ('stock_id','instrument_id','account_id','user_id','holding_id','source_txn_id')
  ORDER BY table_name, column_name`);
console.log(j(cols));

// ── 4. UNIQUE keys that a MERGE would collide with ──────────────────────────
console.log("\n═══ UNIQUE constraints on holdings ═══");
const uq = await prisma.$queryRawUnsafe<any[]>(`
  SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename IN ('holdings','portfolio_accounts') ORDER BY indexname`);
console.log(j(uq));

// ── 5. CORPORATE-ACTION COLLISION probe: do any two accounts of one user hold the
//      SAME stock with corporate-action rows? (the merge-duplication hazard) ──────
console.log("\n═══ CORPORATE-ACTION rows in the live ledger (split/bonus) ═══");
const ca = await prisma.transaction.groupBy({
  by: ["userId", "stockId", "type"],
  where: { type: { in: ["split", "bonus"] } },
  _count: { _all: true },
});
console.log(j(ca));

// ── 6. BROKER HOLDINGS: how many are UNMAPPED (stock_id null → cannot become manual)? ──
console.log("\n═══ BROKER HOLDINGS (mapped vs unmapped) ═══");
const bh = await prisma.brokerHolding.findMany({
  select: { userId: true, symbol: true, stockId: true, instrumentId: true, quantity: true, avgCost: true, currentValue: true, syncedAt: true },
});
console.log(j(bh.map((b) => ({ ...b, quantity: b.quantity.toString(), avgCost: b.avgCost.toString(), currentValue: b.currentValue?.toString() ?? null }))));

// ── 7. ACCOUNTS by state ────────────────────────────────────────────────────
console.log("\n═══ ACCOUNTS ═══");
const accts = await prisma.portfolioAccount.findMany({
  select: { id: true, userId: true, name: true, state: true, brokerConnectionId: true, _count: { select: { transactions: true, holdings: true } } },
});
console.log(j(accts));

await prisma.$disconnect();
