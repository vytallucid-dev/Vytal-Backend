// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO ACCOUNTS HARNESS (Step 1) — proves the account dimension on top of the
// (byte-identical) FIFO layer: multi-account ISOLATION, account CRUD + guards, the
// linked-account manual-entry lock, and the backfill mechanism (new-user auto-create +
// idempotency + real-data invariants). Throwaway users; auth.users cascade cleanup.
//
// (The byte-identical 7-case FIFO proof is the EXISTING verify-portfolio-fifo.ts, which
//  passes UNMODIFIED through the account layer — same code, same numbers.)
//
//   npx tsx src/scripts/verify-portfolio-accounts.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import { addTransaction } from "../controllers/me/transactions-controller.js";
import { listAccounts, createAccount, patchAccount, deleteAccount } from "../controllers/me/accounts-controller.js";

let failures = 0;
function assert(name: string, cond: boolean, detail: string) {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
}
const num = (v: unknown) => Number(v);

function mockRes() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}
const mockReq = (userId: string, opts: { body?: any; params?: any } = {}) =>
  ({ authUser: { userId }, body: opts.body ?? {}, params: opts.params ?? {}, query: {} }) as any;

async function seedUser(tag: string): Promise<{ authId: string; userId: string }> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `acct-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error("signup trigger did not create public.users");
  return { authId, userId: u.id };
}
const cleanupUser = (authId: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId);

// helpers over the real controllers
async function addTx(userId: string, body: any) { const r = mockRes(); await addTransaction(mockReq(userId, { body }), r); return r; }
// Step 5.5: EVERY account belongs to a broker, from creation - `broker` is required.
async function mkAccount(userId: string, name: string, broker: string = "zerodha") { const r = mockRes(); await createAccount(mockReq(userId, { body: { name, broker } }), r); return r; }

async function main() {
  const created: string[] = [];
  try {
    const U = await seedUser("u"); created.push(U.authId);
    const stock = await prisma.stock.findUniqueOrThrow({ where: { symbol: "RELIANCE" }, select: { id: true } });

    // ═══ A — MULTI-ACCOUNT ISOLATION (two independent FIFO queues for the same stock) ═══
    console.log("═══ A — Multi-account isolation ═══");
    // Both books are created EXPLICITLY now (no auto-create), and with TWO accounts open every
    // write must name its account - an unaddressed write is refused, never guessed at (5.5).
    const a1 = (await mkAccount(U.userId, "My Holdings")).body.data.id as string;
    const a2res = await mkAccount(U.userId, "Family");
    const a2 = a2res.body.data.id;

    // A1: buy 100@100 then 100@120 -> 200 @ 110
    await addTx(U.userId, { symbol: "RELIANCE", type: "buy", quantity: 100, price: 100, tradeDate: "2024-01-01", accountId: a1 });
    await addTx(U.userId, { symbol: "RELIANCE", type: "buy", quantity: 100, price: 120, tradeDate: "2024-02-01", accountId: a1 });
    // A2 ("Family"): buy 50@200 - a SEPARATE queue
    await addTx(U.userId, { symbol: "RELIANCE", type: "buy", quantity: 50, price: 200, tradeDate: "2024-01-15", accountId: a2 });

    // A holding is keyed on (account, INSTRUMENT) since Step 1.5 - resolve the stock's catalog row.
    const inst = (await prisma.instrument.findUniqueOrThrow({ where: { stockId: stock.id }, select: { id: true } })).id;
    const holdingIn = (accountId: string) =>
      prisma.holding.findUniqueOrThrow({ where: { accountId_instrumentId: { accountId, instrumentId: inst } } });

    const h1 = await holdingIn(a1);
    const h2 = await holdingIn(a2);
    assert("A1 RELIANCE = 200 @ 110 (its own FIFO)", num(h1.quantity) === 200 && num(h1.avgCost) === 110, `qty=${h1.quantity} avg=${h1.avgCost}`);
    assert("A2 RELIANCE = 50 @ 200 (independent queue)", num(h2.quantity) === 50 && num(h2.avgCost) === 200, `qty=${h2.quantity} avg=${h2.avgCost}`);
    assert("same instrument → TWO holding rows (old unique(user,stock) would forbid this)", h1.id !== h2.id, `h1=${h1.id.slice(0, 8)} h2=${h2.id.slice(0, 8)}`);

    // Sell 100@150 in A1 (default) → realized 5000 FIFO. A2 MUST be untouched.
    await addTx(U.userId, { symbol: "RELIANCE", type: "sell", quantity: 100, price: 150, tradeDate: "2024-03-01", accountId: a1 });
    const h1b = await holdingIn(a1);
    const h2b = await holdingIn(a2);
    assert("A1 sell → realized 5000 (FIFO oldest lot), remaining 100 @ 120", num(h1b.realizedPnl) === 5000 && num(h1b.quantity) === 100 && num(h1b.avgCost) === 120, `realized=${h1b.realizedPnl} qty=${h1b.quantity} avg=${h1b.avgCost}`);
    assert("ISOLATION: A1's sell did NOT consume A2's lots (A2 still 50 @ 200, realized 0)", num(h2b.quantity) === 50 && num(h2b.avgCost) === 200 && num(h2b.realizedPnl) === 0, `qty=${h2b.quantity} avg=${h2b.avgCost} realized=${h2b.realizedPnl}`);

    // ═══ B — ACCOUNT CRUD + guards ═══
    console.log("\n═══ B — Account CRUD + guards ═══");
    const dup = await mkAccount(U.userId, "Family");
    assert("create duplicate name → 409", dup.statusCode === 409 && dup.body?.error === "duplicate_name", `status=${dup.statusCode}`);

    const ren = mockRes(); await patchAccount(mockReq(U.userId, { params: { id: a2 }, body: { name: "Family Zerodha" } }), ren);
    assert("rename → 200, new name", ren.statusCode === 200 && ren.body?.data?.name === "Family Zerodha", `name=${ren.body?.data?.name}`);

    // linked account can't be deleted here (simulate the linked state — Step 4 owns real linking)
    await prisma.portfolioAccount.update({ where: { id: a2 }, data: { state: "linked_live" } });
    const delLinked = mockRes(); await deleteAccount(mockReq(U.userId, { params: { id: a2 } }), delLinked);
    assert("delete a LINKED account → 409 (unlink first)", delLinked.statusCode === 409 && delLinked.body?.error === "account_linked", `status=${delLinked.statusCode}`);

    // manual entry DISABLED on a linked account (add + patch/delete a txn)
    const addLinked = await addTx(U.userId, { symbol: "TCS", type: "buy", quantity: 10, price: 100, tradeDate: "2024-01-01", accountId: a2 });
    assert("manual entry on a LINKED account → 409", addLinked.statusCode === 409 && addLinked.body?.error === "account_linked", `status=${addLinked.statusCode}`);
    await prisma.portfolioAccount.update({ where: { id: a2 }, data: { state: "manual" } }); // restore for the cascade-delete test

    // delete a non-empty MANUAL account WITHOUT confirm → rejected (silent-wipe guard)
    const delA2NoConfirm = mockRes(); await deleteAccount(mockReq(U.userId, { params: { id: a2 } }), delA2NoConfirm);
    assert("delete NON-EMPTY manual account w/o confirm → 400 confirmation_required", delA2NoConfirm.statusCode === 400 && delA2NoConfirm.body?.error === "confirmation_required", `status=${delA2NoConfirm.statusCode} error=${delA2NoConfirm.body?.error}`);
    const a2StillThere = await prisma.portfolioAccount.findUnique({ where: { id: a2 } });
    assert("A2 NOT deleted by the rejected attempt", a2StillThere !== null, `gone=${a2StillThere === null}`);

    // delete a non-empty MANUAL account (not the last) WITH confirm:true → cascades its ledger
    const delA2 = mockRes(); await deleteAccount(mockReq(U.userId, { params: { id: a2 }, body: { confirm: true } }), delA2);
    const a2gone = await prisma.portfolioAccount.findUnique({ where: { id: a2 } });
    const a2txns = await prisma.transaction.count({ where: { accountId: a2 } });
    const a2holds = await prisma.holding.count({ where: { accountId: a2 } });
    assert("delete manual account w/ confirm:true → cascades its txns + holdings", delA2.statusCode === 200 && a2gone === null && a2txns === 0 && a2holds === 0, `status=${delA2.statusCode} gone=${a2gone === null} txns=${a2txns} holds=${a2holds}`);
    const a1holds = await prisma.holding.count({ where: { accountId: a1 } });
    assert("the OTHER account (A1) is intact after A2 delete", a1holds > 0, `A1 holdings=${a1holds}`);

    // delete an EMPTY manual account WITHOUT confirm → succeeds (nothing to lose, no gate needed)
    const emptyRes = await mkAccount(U.userId, "Empty Scratch");
    const emptyId = emptyRes.body.data.id;
    const delEmpty = mockRes(); await deleteAccount(mockReq(U.userId, { params: { id: emptyId } }), delEmpty);
    assert("delete EMPTY manual account w/o confirm → 200 (no gate on empty accounts)", delEmpty.statusCode === 200, `status=${delEmpty.statusCode} error=${delEmpty.body?.error}`);

    // ═══ C — last-account guard + IDOR ═══
    console.log("\n═══ C — last-account guard + IDOR ═══");
    const V = await seedUser("v"); created.push(V.authId);
    await mkAccount(V.userId, "My Holdings"); // explicit since 5.5 (no auto-create)
    await addTx(V.userId, { symbol: "INFY", type: "buy", quantity: 5, price: 100, tradeDate: "2024-01-01" }); // -> V's ONE book
    const vAcc = (await prisma.portfolioAccount.findFirstOrThrow({ where: { userId: V.userId }, select: { id: true } })).id;
    const delLast = mockRes(); await deleteAccount(mockReq(V.userId, { params: { id: vAcc } }), delLast);
    assert("delete the user's LAST account → 409 (must keep ≥1)", delLast.statusCode === 409 && delLast.body?.error === "last_account", `status=${delLast.statusCode}`);

    const idorPatch = mockRes(); await patchAccount(mockReq(V.userId, { params: { id: a1 }, body: { name: "hacked" } }), idorPatch);
    assert("IDOR: V cannot rename U's account → 404", idorPatch.statusCode === 404, `status=${idorPatch.statusCode}`);
    const idorDel = mockRes(); await deleteAccount(mockReq(V.userId, { params: { id: a1 } }), idorDel);
    assert("IDOR: V cannot delete U's account → 404", idorDel.statusCode === 404, `status=${idorDel.statusCode}`);
    const vList = mockRes(); await listAccounts(mockReq(V.userId), vList);
    assert("IDOR: V's account list contains only V's account", vList.body.data.length === 1 && vList.body.data[0].id === vAcc, `count=${vList.body.data.length}`);
    // A1 name untouched by the IDOR attempt
    const a1name = (await prisma.portfolioAccount.findUniqueOrThrow({ where: { id: a1 }, select: { name: true } })).name;
    assert("U's account unchanged by V's IDOR attempt", a1name === "My Holdings", `name=${a1name}`);

    // ═══ D — RESOLVE-DON'T-CREATE (Step 5.5 replaces the old auto-create contract) ═══
    // This section used to assert "a new user's first txn AUTO-CREATES 'My Holdings'". That
    // contract cannot survive the broker-parent model: every account belongs to a broker, and
    // the txn write path has no broker to invent. So the CREATE is gone and the RESOLVE stays.
    // The three cases below ARE the new contract.
    console.log("\n═══ D — Resolve-don't-create (0 / 1 / 2+ accounts) ═══");
    const W = await seedUser("w"); created.push(W.authId);

    // 0 accounts + no accountId → REFUSED. This is the case that used to silently birth an
    // account with no broker. An account can now be born in exactly ONE place: POST /accounts,
    // where the user names its broker.
    const noAcct = await addTx(W.userId, { symbol: "RELIANCE", type: "buy", quantity: 10, price: 100, tradeDate: "2024-01-01" });
    assert("0 accounts + no accountId → 400 no_account (NOT a silent broker-less auto-create)",
      noAcct.statusCode === 400 && noAcct.body?.error === "no_account", `status=${noAcct.statusCode} err=${noAcct.body?.error}`);
    const bornAnyway = await prisma.portfolioAccount.count({ where: { userId: W.userId } });
    assert("...and NO account was created behind the user's back", bornAnyway === 0, `accounts=${bornAnyway}`);

    // 1 account + no accountId → resolves to it. Unchanged behaviour for every single-account
    // user (which is every real user today) — this is why killing the auto-create is not an outage.
    const wMain = (await mkAccount(W.userId, "My Holdings")).body.data.id as string;
    const oneA = await addTx(W.userId, { symbol: "RELIANCE", type: "buy", quantity: 10, price: 100, tradeDate: "2024-01-01" });
    const oneB = await addTx(W.userId, { symbol: "TCS", type: "buy", quantity: 5, price: 100, tradeDate: "2024-01-02" });
    assert("1 account + no accountId → resolves to it (201, unchanged)", oneA.statusCode === 201 && oneB.statusCode === 201, `a=${oneA.statusCode} b=${oneB.statusCode}`);
    const wAccts = await prisma.portfolioAccount.findMany({ where: { userId: W.userId } });
    assert("...still exactly ONE account, and it carries a broker", wAccts.length === 1 && wAccts[0].broker !== null, `accts=${wAccts.length} broker=${wAccts[0]?.broker}`);
    const wInDefault = await prisma.transaction.count({ where: { userId: W.userId, accountId: wMain } });
    const wTotal = await prisma.transaction.count({ where: { userId: W.userId } });
    assert("all of the user's txns landed in that one book", wInDefault === wTotal && wTotal === 2, `inBook=${wInDefault} total=${wTotal}`);

    // 2+ accounts + no accountId → REFUSED. We do not guess which broker's ledger a trade belongs
    // to: every account id is a valid string, so a wrong guess would be silent and invisible.
    await mkAccount(W.userId, "Second Book", "upstox");
    const ambiguous = await addTx(W.userId, { symbol: "INFY", type: "buy", quantity: 1, price: 100, tradeDate: "2024-01-03" });
    assert("2+ accounts + no accountId → 400 account_required (never a guess)",
      ambiguous.statusCode === 400 && ambiguous.body?.error === "account_required", `status=${ambiguous.statusCode} err=${ambiguous.body?.error}`);
    const wTotal2 = await prisma.transaction.count({ where: { userId: W.userId } });
    assert("...and nothing was written", wTotal2 === wTotal, `txns ${wTotal} → ${wTotal2}`);

    // Idempotency: re-running the migration's backfill INSERT creates NO second account.
    const before = await prisma.portfolioAccount.count({ where: { userId: W.userId } });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "portfolio_accounts" ("id","user_id","name","broker","state","created_at","updated_at")
       SELECT gen_random_uuid()::text, u.uid, 'My Holdings', 'zerodha', 'manual', now(), now()
       FROM (SELECT DISTINCT "user_id" AS uid FROM "transactions" WHERE "user_id" = $1) u
       WHERE NOT EXISTS (SELECT 1 FROM "portfolio_accounts" pa WHERE pa."user_id" = u.uid AND pa."name" = 'My Holdings')`,
      W.userId,
    );
    const after = await prisma.portfolioAccount.count({ where: { userId: W.userId } });
    assert("backfill INSERT is IDEMPOTENT (re-run creates 0 new accounts)", after === before, `before=${before} after=${after}`);

    // Real-data invariant (the migration already backfilled production): EVERY transaction's
    // account belongs to the same user (0 owner mismatch) — global, holds for real + test rows.
    const mism = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "transactions" t JOIN "portfolio_accounts" pa ON pa."id" = t."account_id" WHERE pa."user_id" <> t."user_id"`,
    )) as { n: number }[];
    assert("real-data backfill invariant: 0 transaction/account owner mismatch (global)", mism[0].n === 0, `mismatch=${mism[0].n}`);

    console.log(`\n${failures === 0 ? "✅ ALL PORTFOLIO-ACCOUNTS CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
  } finally {
    for (const authId of created) await cleanupUser(authId);
    await prisma.$disconnect();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS CRASH:", e); process.exit(1); });
