// ─────────────────────────────────────────────────────────────────────────────
// WHOLE-ACCOUNT TRANSFER — SCALE + TIMING ATTRIBUTION.
//
// Proves the BATCHED transferAllManualPositions moves N positions inside ONE atomic
// transaction that finishes well within its 30s budget — and attributes the wall-clock so
// the trailing best-effort PHS refresh (NOT part of the atomic move) is not mistaken for it.
//
// Seeds the source book DIRECTLY via bulk inserts (a single buy per instrument = qty 1 @ 100,
// one lot) so setup is fast and the only thing measured is the transfer.
//
//   npx tsx src/scripts/verify-transfer-scale.ts [N=300]
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { refreshPhsForUser } from "../portfolio/phs/refresh.js";
import { createAccount, transferAllHoldings } from "../controllers/me/accounts-controller.js";

let failures = 0;
const assert = (name: string, cond: boolean, detail: string) => { console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`); if (!cond) failures++; };
const mockRes = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const mockReq = (userId: string, o: any = {}) => ({ authUser: { userId }, body: o.body ?? {}, params: o.params ?? {}, query: {} }) as any;
const call = async (fn: any, userId: string, o: any = {}) => { const r = mockRes(); await fn(mockReq(userId, o), r); return r; };
const chunk = <T>(a: T[], s: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += s) o.push(a.slice(i, i + s)); return o; };

async function seedUser(tag: string) {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `xferscale-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { authId, userId: u.id };
}
const cleanup = (a: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE email LIKE 'xferscale-%@test.local'`);
const mk = async (userId: string, name: string) => (await call(createAccount, userId, { body: { name, broker: "zerodha" } })).body.data.id as string;

/** Seed `n` distinct instruments as single qty-1@100 buys, materialized directly (no PHS, no per-add replay). */
async function seed(userId: string, accountId: string, n: number) {
  const picks = await prisma.instrument.findMany({ select: { id: true, stockId: true }, orderBy: { id: "asc" }, take: n });
  const D1 = new Prisma.Decimal(1), D100 = new Prisma.Decimal(100), D0 = new Prisma.Decimal(0), day = new Date("2024-01-01");
  const txns = picks.map((p) => ({ id: randomUUID(), userId, accountId, instrumentId: p.id, stockId: p.stockId, type: "buy" as const, quantity: D1, price: D100, fees: D0, tradeDate: day }));
  const holdings = picks.map((p) => ({ id: randomUUID(), userId, accountId, instrumentId: p.id, stockId: p.stockId, quantity: D1, avgCost: D100, investedValue: D100, realizedPnl: D0, lastComputedAt: day }));
  const lots = picks.map((p, i) => ({ holdingId: holdings[i].id, quantity: D1, costPerShare: D100, buyDate: day, sourceTxnId: txns[i].id }));
  for (const c of chunk(txns, 500)) await prisma.transaction.createMany({ data: c });
  for (const c of chunk(holdings, 500)) await prisma.holding.createMany({ data: c });
  for (const c of chunk(lots, 500)) await prisma.holdingLot.createMany({ data: c });
  return picks.length;
}

const N = Number(process.argv[2] ?? 300);
const S = await seedUser("s");
try {
  console.log(`═══ SCALE: whole-account transfer of ${N} instruments ═══`);
  const src = await mk(S.userId, "Big Book");
  const dst = await mk(S.userId, "Big Family");
  const seeded = await seed(S.userId, src, N);
  console.log(`     seeded ${seeded} instruments (holdings=${await prisma.holding.count({ where: { accountId: src } })})`);

  // BASELINE: how long a standalone whole-portfolio PHS refresh takes for this book — the cost that
  // USED to block the transfer response. Measured on the source (still `seeded` holdings) up front.
  const b0 = Date.now();
  await refreshPhsForUser(S.userId);
  const phsBaseline = Date.now() - b0;

  const t0 = Date.now();
  const res = await call(transferAllHoldings, S.userId, { params: { id: src }, body: { toAccountId: dst, deleteSource: true } });
  const totalMs = Date.now() - t0;
  // The transfer now kicks PHS off FIRE-AND-FORGET, so this response time is the atomic move ONLY.
  console.log(`     transfer response=${totalMs}ms    (a single standalone PHS refresh for this book=${phsBaseline}ms)`);

  assert(`transfer-all of ${seeded} → 200 (a 200 PROVES the transaction fit its 30s window — P2028 → 500 otherwise)`,
    res.statusCode === 200, `status=${res.statusCode} err=${res.body?.error} ${res.body?.message ?? ""}`);
  assert(`🔒 all ${seeded} positions on the destination`, (await prisma.holding.count({ where: { accountId: dst } })) === seeded, `dst=${await prisma.holding.count({ where: { accountId: dst } })}`);
  assert(`🔒 all ${seeded} lots moved`, (await prisma.holdingLot.count({ where: { holding: { accountId: dst } } })) === seeded, `lots=${await prisma.holdingLot.count({ where: { holding: { accountId: dst } } })}`);
  assert(`🔒 all ${seeded} transactions re-parented`, (await prisma.transaction.count({ where: { accountId: dst } })) === seeded, `txns=${await prisma.transaction.count({ where: { accountId: dst } })}`);
  assert("source emptied + deleted", (await prisma.portfolioAccount.count({ where: { id: src } })) === 0, "gone");
  assert(`response reports all ${seeded} deltas`, res.body?.data?.destination?.length === seeded, `deltas=${res.body?.data?.destination?.length}`);
  assert(`🔒 the atomic transfer is well inside the 30s window (${totalMs}ms ≪ 30000ms)`, totalMs < 25000, `${totalMs}ms`);
  assert(`🔒 FIRE-AND-FORGET: the response returned in ${totalMs}ms — LESS than one PHS refresh (${phsBaseline}ms) — so it did NOT wait on PHS`,
    totalMs < phsBaseline, `total=${totalMs}ms phsBaseline=${phsBaseline}ms (blocking would be ≈total+phs)`);

  // Let the fire-and-forget PHS settle before disconnecting, so its background query doesn't race the
  // pool teardown (best-effort; not asserted — the refresh swallows its own errors either way).
  await new Promise((r) => setTimeout(r, Math.min(phsBaseline + 3000, 20000)));

  console.log(`\n${failures === 0 ? "✅ SCALE + TIMING VERIFIED" : `❌ ${failures} CHECK(S) FAILED`}`);
} finally {
  await cleanup(S.authId);
  await prisma.$disconnect();
}
process.exit(failures === 0 ? 0 : 1);
