// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO FIFO CORRECTNESS HARNESS — proves the engine matches broker behavior.
// Part 1: PURE engine assertions (the math heart). Part 2: full DB end-to-end through
// the REAL controllers (mock req/res) — replay-on-write, back-dated reorder, IDOR —
// on throwaway seeded users, cleaned up after (cascade).
//   npx tsx src/scripts/verify-portfolio-fifo.ts
import { randomUUID } from "crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { replayFifo, OversellError, type LedgerTxn } from "../portfolio/fifo-engine.js";
import { addTransaction, listTransactions, patchTransaction, deleteTransaction } from "../controllers/me/transactions-controller.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";

let failures = 0;
function assert(name: string, cond: boolean, detail: string) {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
}
const D = (v: number | string) => new Prisma.Decimal(v);
const near = (a: unknown, b: number) => Math.abs(Number(a) - b) < 1e-6;

// ── mock req/res ──
function mockRes() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}
function mockReq(userId: string, opts: { body?: any; params?: any; query?: any } = {}) {
  return { authUser: { userId }, body: opts.body ?? {}, params: opts.params ?? {}, query: opts.query ?? {} } as any;
}
const lt = (o: Partial<LedgerTxn> & { id: string; type: LedgerTxn["type"]; tradeDate: Date }): LedgerTxn =>
  ({ quantity: null, price: null, fees: null, ratio: null, createdAt: o.tradeDate, ...o });

// Seed a throwaway user: insert an auth.users row (app conn is the postgres owner);
// the signup trigger auto-creates public.users. Cleanup deletes the auth row →
// cascades public.users → transactions/holdings/lots.
async function seedUser(): Promise<{ authId: string; userId: string }> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `fifo-${authId}@test.local`);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error("signup trigger did not create public.users");
  return { authId, userId: u.id };
}
async function cleanupUser(authId: string) {
  await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId);
}

async function main() {
  console.log("═══ PART 1 — PURE ENGINE (broker-match math) ═══");

  // Case 1: buy 100@100, buy 100@120 → 200 @ 110 (weighted)
  const c1 = replayFifo([
    lt({ id: "a", type: "buy", quantity: D(100), price: D(100), tradeDate: new Date("2024-01-01") }),
    lt({ id: "b", type: "buy", quantity: D(100), price: D(120), tradeDate: new Date("2024-02-01") }),
  ]);
  console.log("\nCase 1 — buy 100@100 + buy 100@120:");
  assert("qty", near(c1.quantity, 200), `${c1.quantity} (exp 200)`);
  assert("avg = weighted 110", near(c1.avgCost, 110), `${c1.avgCost} (exp 110)`);
  assert("invested", near(c1.investedValue, 22000), `${c1.investedValue} (exp 22000)`);

  // Case 2: then sell 100@150 → realized 5000 (FIFO oldest lot, NOT 4000 avg), remaining 100@120
  const c2 = replayFifo([
    lt({ id: "a", type: "buy", quantity: D(100), price: D(100), tradeDate: new Date("2024-01-01") }),
    lt({ id: "b", type: "buy", quantity: D(100), price: D(120), tradeDate: new Date("2024-02-01") }),
    lt({ id: "c", type: "sell", quantity: D(100), price: D(150), tradeDate: new Date("2024-03-01") }),
  ]);
  console.log("\nCase 2 — then sell 100@150 (THE broker-match assertion):");
  assert("realized = 5000 (FIFO), NOT 4000 (avg)", near(c2.realizedPnl, 5000), `${c2.realizedPnl} (exp 5000, avg-based wrong-answer=4000)`);
  assert("remaining qty", near(c2.quantity, 100), `${c2.quantity} (exp 100)`);
  assert("remaining avg = 120", near(c2.avgCost, 120), `${c2.avgCost} (exp 120)`);

  // Case 3: split 1:1 on remaining 100@120 → 200 @ 60, buy_date preserved
  const c3 = replayFifo([
    lt({ id: "a", type: "buy", quantity: D(100), price: D(100), tradeDate: new Date("2024-01-01") }),
    lt({ id: "b", type: "buy", quantity: D(100), price: D(120), tradeDate: new Date("2024-02-01") }),
    lt({ id: "c", type: "sell", quantity: D(100), price: D(150), tradeDate: new Date("2024-03-01") }),
    lt({ id: "d", type: "split", ratio: "1:1", tradeDate: new Date("2024-04-01") }),
  ]);
  console.log("\nCase 3 — split 1:1 on remaining 100@120:");
  assert("qty doubled", near(c3.quantity, 200), `${c3.quantity} (exp 200)`);
  assert("avg halved to 60", near(c3.avgCost, 60), `${c3.avgCost} (exp 60)`);
  assert("realized unchanged 5000", near(c3.realizedPnl, 5000), `${c3.realizedPnl} (exp 5000)`);
  assert("buy_date preserved (2024-02-01)", c3.lots[0].buyDate.toISOString().slice(0, 10) === "2024-02-01", c3.lots[0].buyDate.toISOString().slice(0, 10));

  // Case 4: bonus 2:1 on buy 100@90 → 300 @ 30 (factor (2+1)/1=3)
  const c4 = replayFifo([
    lt({ id: "a", type: "buy", quantity: D(100), price: D(90), tradeDate: new Date("2024-01-01") }),
    lt({ id: "b", type: "bonus", ratio: "2:1", tradeDate: new Date("2024-02-01") }),
  ]);
  console.log("\nCase 4 — bonus 2:1 on 100@90 (factor 3):");
  assert("qty tripled", near(c4.quantity, 300), `${c4.quantity} (exp 300)`);
  assert("avg = 30", near(c4.avgCost, 30), `${c4.avgCost} (exp 30)`);
  assert("invested unchanged 9000", near(c4.investedValue, 9000), `${c4.investedValue} (exp 9000)`);

  // Case 5: FEES fold into the money math — buy fee → cost basis, sell fee → out of proceeds
  const c5buy = replayFifo([
    lt({ id: "a", type: "buy", quantity: D(100), price: D(100), fees: D(50), tradeDate: new Date("2024-01-01") }),
  ]);
  console.log("\nCase 5a — buy 100@100 + ₹50 fee (fee raises cost basis):");
  assert("avg = 100.5 (fee amortised into basis)", near(c5buy.avgCost, 100.5), `${c5buy.avgCost} (exp 100.5)`);
  assert("invested = 10050", near(c5buy.investedValue, 10050), `${c5buy.investedValue} (exp 10050)`);

  const c5sell = replayFifo([
    lt({ id: "a", type: "buy", quantity: D(100), price: D(100), fees: D(50), tradeDate: new Date("2024-01-01") }),
    lt({ id: "c", type: "sell", quantity: D(100), price: D(150), fees: D(30), tradeDate: new Date("2024-03-01") }),
  ]);
  console.log("\nCase 5b — sell 100@150 + ₹30 fee (fee lowers proceeds):");
  assert("realized = 4920 (5000 − 50 basis − 30 sell)", near(c5sell.realizedPnl, 4920), `${c5sell.realizedPnl} (exp 4920; fee-less=5000)`);
  assert("fully exited", near(c5sell.quantity, 0), `${c5sell.quantity} (exp 0)`);

  // Case 5c: null fee == 0 — back-compat with the already-seeded fee-less transactions
  const c5nilBuy = replayFifo([
    lt({ id: "a", type: "buy", quantity: D(100), price: D(100), fees: null, tradeDate: new Date("2024-01-01") }),
  ]);
  const c5nil = replayFifo([
    lt({ id: "a", type: "buy", quantity: D(100), price: D(100), fees: null, tradeDate: new Date("2024-01-01") }),
    lt({ id: "c", type: "sell", quantity: D(100), price: D(150), tradeDate: new Date("2024-03-01") }),
  ]);
  console.log("\nCase 5c — null fee = 0 (seeded fee-less rows unchanged):");
  assert("null fee → invested 10000 (no charge added to basis)", near(c5nilBuy.investedValue, 10000), `${c5nilBuy.investedValue} (exp 10000)`);
  assert("null fee → realized 5000 (identical to pre-fees)", near(c5nil.realizedPnl, 5000), `${c5nil.realizedPnl} (exp 5000)`);

  // Case 6: oversell rejected (pure)
  console.log("\nCase 6 — oversell (pure):");
  let threw = false;
  try { replayFifo([lt({ id: "s", type: "sell", quantity: D(10), price: D(1), tradeDate: new Date("2024-01-01") })]); } catch (e) { threw = e instanceof OversellError; }
  assert("OversellError thrown", threw, threw ? "rejected" : "NOT rejected");

  // ═══ PART 2 — DB END-TO-END via real controllers ═══
  console.log("\n═══ PART 2 — DB END-TO-END (real controllers, seeded users) ═══");
  const stocks = await prisma.stock.findMany({ where: { symbol: { in: ["RELIANCE", "TCS", "INFY"] } }, select: { symbol: true } });
  if (stocks.length < 3) { console.log("  ⚠ need RELIANCE/TCS/INFY in universe — skipping DB tests"); return finish(); }

  const userA = await seedUser();
  const userB = await seedUser();
  try {
    // Case 1-3 E2E on RELIANCE for user A
    const post = async (userId: string, body: any) => { const r = mockRes(); await addTransaction(mockReq(userId, { body }), r); return r; };
    await post(userA.userId, { symbol: "RELIANCE", type: "buy", quantity: 100, price: 100, tradeDate: "2024-01-01" });
    await post(userA.userId, { symbol: "RELIANCE", type: "buy", quantity: 100, price: 120, tradeDate: "2024-02-01" });
    let sellRes = await post(userA.userId, { symbol: "RELIANCE", type: "sell", quantity: 100, price: 150, tradeDate: "2024-03-01" });
    console.log("\nCase 1-3 E2E (RELIANCE, via POST /me/transactions):");
    assert("sell 201 + realized 5000", sellRes.statusCode === 201 && near(sellRes.body?.data?.holding?.realizedPnl, 5000), `status=${sellRes.statusCode} realized=${sellRes.body?.data?.holding?.realizedPnl}`);
    const splitRes = await post(userA.userId, { symbol: "RELIANCE", type: "split", ratio: "1:1", tradeDate: "2024-04-01" });
    const h = splitRes.body?.data?.holding;
    assert("post-split qty 200 avg 60 realized 5000", near(h?.quantity, 200) && near(h?.avgCost, 60) && near(h?.realizedPnl, 5000), `qty=${h?.quantity} avg=${h?.avgCost} realized=${h?.realizedPnl}`);
    assert("lot buy_date preserved 2024-02-01", h?.lots?.[0]?.buyDate === "2024-02-01", h?.lots?.[0]?.buyDate);

    // Case 5 — back-dated insert reorders FIFO + recomputes realized
    console.log("\nCase 5 — back-dated insert (TCS): sell realized recomputes on reorder:");
    await post(userA.userId, { symbol: "TCS", type: "buy", quantity: 100, price: 200, tradeDate: "2024-06-01" });
    const preSell = await post(userA.userId, { symbol: "TCS", type: "sell", quantity: 50, price: 250, tradeDate: "2024-07-01" });
    assert("before back-date: realized 2500 (sold 50 of 100@200)", near(preSell.body?.data?.holding?.realizedPnl, 2500), `realized=${preSell.body?.data?.holding?.realizedPnl}`);
    const backDated = await post(userA.userId, { symbol: "TCS", type: "buy", quantity: 50, price: 100, tradeDate: "2024-05-01" });
    const hb = backDated.body?.data?.holding;
    // now FIFO sells the earlier 50@100 lot first → realized (250-100)*50 = 7500; remaining 100@200
    assert("after back-date: realized recomputes 2500 → 7500", near(hb?.realizedPnl, 7500), `realized=${hb?.realizedPnl} (exp 7500)`);
    assert("after back-date: remaining qty 100 @ 200", near(hb?.quantity, 100) && near(hb?.avgCost, 200), `qty=${hb?.quantity} avg=${hb?.avgCost}`);

    // Case 6 — oversell via controller → 400
    console.log("\nCase 6 — oversell via POST (INFY sell with nothing held):");
    const over = await post(userA.userId, { symbol: "INFY", type: "sell", quantity: 10, price: 100, tradeDate: "2024-01-01" });
    assert("400 oversell", over.statusCode === 400 && over.body?.error === "oversell", `status=${over.statusCode} error=${over.body?.error}`);

    // Case 7 — IDOR: user B cannot see or mutate user A's data
    console.log("\nCase 7 — IDOR isolation (user B vs user A):");
    const aTxns = await prisma.transaction.findFirst({ where: { userId: userA.userId }, select: { id: true } });
    const bPatch = mockRes(); await patchTransaction(mockReq(userB.userId, { params: { id: aTxns!.id }, body: { quantity: 999 } }), bPatch);
    assert("B PATCH A's txn → 404", bPatch.statusCode === 404, `status=${bPatch.statusCode}`);
    const bDel = mockRes(); await deleteTransaction(mockReq(userB.userId, { params: { id: aTxns!.id } }), bDel);
    assert("B DELETE A's txn → 404", bDel.statusCode === 404, `status=${bDel.statusCode}`);
    const bList = mockRes(); await listTransactions(mockReq(userB.userId), bList);
    assert("B GET transactions → empty (none of A's)", Array.isArray(bList.body?.data) && bList.body.data.length === 0, `count=${bList.body?.data?.length}`);
    const bHold = mockRes(); await listHoldings(mockReq(userB.userId, { query: {} }), bHold);
    assert("B GET holdings → empty", bHold.body?.data?.holdings?.length === 0, `count=${bHold.body?.data?.holdings?.length}`);
    // A's txn still intact (B's attempts changed nothing)
    const aStill = await prisma.transaction.findUnique({ where: { id: aTxns!.id }, select: { quantity: true } });
    assert("A's txn unchanged by B", aStill != null && !near(aStill.quantity, 999), `qty=${aStill?.quantity?.toString()}`);
  } finally {
    // cleanup — delete auth.users → cascade removes public.users + transactions/holdings/lots
    await cleanupUser(userA.authId);
    await cleanupUser(userB.authId);
    console.log("\n[cleanup] test users + their portfolio rows deleted (cascade)");
  }
  finish();
}

function finish() {
  console.log(`\n═══ ${failures === 0 ? "ALL PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
  return prisma.$disconnect().then(() => process.exit(failures === 0 ? 0 : 1));
}
main().catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
