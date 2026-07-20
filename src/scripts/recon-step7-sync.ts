// ─────────────────────────────────────────────────────────────────────────────
// STEP 7 GATE-0 RECON (read-only) — sync / refresh / poll + add-to-universe feasibility.
//   npx tsx src/scripts/recon-step7-sync.ts
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";

const j = (o: unknown) => JSON.stringify(o, null, 2);

// ── 5a. THE ISIN SPINE — the add-to-universe blocker ────────────────────────
console.log("═══ 5a. Can a bare stock even be CREATED? (the NOT-NULL columns) ═══");
const stockCols = await prisma.$queryRawUnsafe<any[]>(`
  SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name = 'stocks' AND is_nullable = 'NO'
  ORDER BY ordinal_position`);
console.log("  stocks — REQUIRED columns (no default ⇒ must be supplied):");
for (const c of stockCols) console.log(`    ${c.column_name.padEnd(20)} default=${c.column_default ?? "— (MUST SUPPLY)"}`);

const instCols = await prisma.$queryRawUnsafe<any[]>(`
  SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name = 'instruments' AND is_nullable = 'NO'
  ORDER BY ordinal_position`);
console.log("\n  instruments — REQUIRED columns:");
for (const c of instCols) console.log(`    ${c.column_name.padEnd(20)} default=${c.column_default ?? "— (MUST SUPPLY)"}`);

console.log("\n  ⇒ a bare stock needs: symbol, name, ISIN (unique, NOT NULL). sector_id is NULLABLE.");
console.log("  ⇒ the broker feed gives us: tradingsymbol, quantity, average_price, last_price.");
console.log("  ⇒ NO name. NO sector. NO ISIN in our StandardHolding contract (grep: 'isin' absent from src/brokers/).");

// ── 5b. IS A PG-LESS / SECTOR-LESS STOCK ALREADY A LIVING THING? ────────────
console.log("\n═══ 5b. Does the universe already tolerate a stock with NO peer group / NO sector? ═══");
const total = await prisma.stock.count();
const noPg = await prisma.stock.count({ where: { peerGroups: { none: {} } } });
const noSector = await prisma.stock.count({ where: { sectorId: null } });
const noPrice = await prisma.stock.count({ where: { stockPrices: { none: {} } } });
console.log(`  stocks total          : ${total}`);
console.log(`  with NO peer group    : ${noPg}`);
console.log(`  with NO sector        : ${noSector}`);
console.log(`  with NO price row     : ${noPrice}`);

// Do any PG-less stocks nonetheless carry a score? (If none do, PG-less ⇒ unscored is ALREADY the rule.)
const pgLess = await prisma.stock.findMany({
  where: { peerGroups: { none: {} } },
  select: { id: true, symbol: true, sectorId: true, _count: { select: { scoreSnapshots: true, stockPrices: true } } },
  take: 10,
});
if (pgLess.length) {
  console.log("\n  a sample of PG-less stocks (do they have scores?):");
  for (const s of pgLess) console.log(`    ${s.symbol.padEnd(14)} sector=${s.sectorId ? "set" : "NULL"} scoreSnapshots=${s._count.scoreSnapshots} prices=${s._count.stockPrices}`);
  const scoredPgLess = pgLess.filter((s) => s._count.scoreSnapshots > 0).length;
  console.log(`  ⇒ PG-less stocks WITH a score: ${scoredPgLess}/${pgLess.length}  (0 ⇒ "no PG ⇒ unscored" is already the live rule)`);
} else {
  console.log("  ⚠️ EVERY stock currently has a peer group — a PG-less stock would be a NEW shape in this DB.");
}

// ── 5c. what a broker holding looks like TODAY when unmapped ────────────────
console.log("\n═══ 5c. The unmapped path today (what add-to-universe would replace) ═══");
const bh = await prisma.brokerHolding.count();
const bhNull = await prisma.brokerHolding.count({ where: { stockId: null } });
console.log(`  broker_holdings rows: ${bh}  (with NULL stock_id: ${bhNull})`);
console.log("  (live rows are transient — harnesses clean up. The mock fixture's FAKESTOCK reproduces it on demand.)");

// ── 3. THE "REFRESH" PATH — what would it actually change? ──────────────────
console.log("\n═══ 3. Refresh vs Sync — what is PERSISTED that a re-price would move? ═══");
console.log("  broker_holdings columns and who owns them:");
const bhCols = await prisma.$queryRawUnsafe<any[]>(`
  SELECT column_name, is_nullable FROM information_schema.columns
  WHERE table_name='broker_holdings' ORDER BY ordinal_position`);
console.log("    " + bhCols.map((c) => c.column_name).join(", "));
console.log("    quantity/avg_cost/current_value are the BROKER's figures (§2.2 mirror — current_value is");
console.log("    the broker's ₹, NOT ours). Overwriting current_value with OUR price would corrupt the mirror.");
console.log("  The READ path (holdings-controller) already joins stock_prices LIVE for broker rows too");
console.log("  ('ALL priced rows — broker included (our price)'), so a user ALREADY sees current value.");
console.log("  ⇒ the only STORED thing a re-price moves is the PHS snapshot (portfolio_health_snapshots).");

// ── 4. THE JOB QUEUE we would reuse ────────────────────────────────────────
console.log("\n═══ 4. The existing job machinery (reuse, don't reinvent) ═══");
const jobTypes = await prisma.backgroundJob.groupBy({ by: ["type"], _count: { _all: true } });
console.log("  background_jobs by type:");
for (const t of jobTypes) console.log(`    ${t.type.padEnd(30)} ${t._count._all}`);
const recent = await prisma.backgroundJob.findMany({
  select: { type: true, status: true, triggeredBy: true, createdAt: true },
  orderBy: { createdAt: "desc" }, take: 5,
});
console.log("  most recent:");
for (const r of recent) console.log(`    ${r.type.padEnd(28)} ${r.status.padEnd(10)} by=${r.triggeredBy} ${r.createdAt.toISOString()}`);

// ── 2. session liveness ────────────────────────────────────────────────────
console.log("\n═══ 2. Session liveness (what the poll's 'while alive' condition reads) ═══");
const conns = await prisma.brokerConnection.findMany({
  select: { broker: true, enabled: true, sessionState: true, sessionExpiresAt: true, lastSyncedAt: true },
});
console.log(`  live broker_connections: ${conns.length}`);
for (const c of conns) console.log(`    ${c.broker} enabled=${c.enabled} session=${c.sessionState} expires=${c.sessionExpiresAt?.toISOString() ?? "null"} lastSync=${c.lastSyncedAt?.toISOString() ?? "never"}`);
console.log("  two ORTHOGONAL axes (§2.5): `enabled` = feed on/off (sever) · `session_state` = token live/dead.");
console.log("  A DEAD TOKEN IS ROUTINE — it must NOT flip the account to linked_stale. The poll pauses; it does not sever.");

// ── 6. BASELINE ────────────────────────────────────────────────────────────
console.log("\n═══ 6. BASELINE — the 2 real users (no broker; the poll must never touch them) ═══");
for (const email of ["arman.shaikh01082003@gmail.com", "amankamaljain@gmail.com"]) {
  const u = await prisma.user.findFirstOrThrow({ where: { email }, select: { id: true } });
  const phs = await prisma.portfolioHealthSnapshot.findFirst({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, select: { phs: true, band: true, fingerprint: true } });
  const connCount = await prisma.brokerConnection.count({ where: { userId: u.id } });
  console.log(`  ${email}: PHS=${phs?.phs} ${phs?.band} fp=${phs?.fingerprint?.slice(0, 16)}… brokerConnections=${connCount}`);
}

await prisma.$disconnect();
