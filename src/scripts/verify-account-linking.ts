// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT LINKING HARNESS (Step 2b) — the manual→linked_live transition, the STRUCTURAL
// manual-entry guard (including the ensureDefaultAccount BACK DOOR that Step 2a surfaced),
// and sync-lands-on-the-bound-account. Throwaway users; auth.users cascade cleanup.
//
//   npx tsx src/scripts/verify-account-linking.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import type { BrokerId } from "../brokers/types.js";
import { integrate, syncHoldings, BrokerLifecycleError } from "../brokers/lifecycle.js";
import { linkAccount, createAccount } from "../controllers/me/accounts-controller.js";
import { addTransaction } from "../controllers/me/transactions-controller.js";

let failures = 0;
const assert = (name: string, cond: boolean, detail: string) => {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
};

function mockRes() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}
const mockReq = (userId: string, o: { body?: any; params?: any } = {}) =>
  ({ authUser: { userId }, body: o.body ?? {}, params: o.params ?? {}, query: {} }) as any;

async function seedUser(tag: string) {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `lnk-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { authId, userId: u.id };
}
const cleanup = (a: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);

const DISC = { accepted: true, disclaimerVersion: "v1" };
// `confirm` (Step 5.5 ruling 5): linking a NON-EMPTY manual account REPLACES its hand-kept
// ledger with the broker's data, so it is refused without explicit consent.
const link = async (userId: string, accountId: string, connectionId: string, confirm?: boolean) => {
  const r = mockRes();
  await linkAccount(mockReq(userId, { params: { id: accountId }, body: { connectionId, ...(confirm !== undefined ? { confirm } : {}) } }), r);
  return r;
};
// Step 5.5: broker is REQUIRED at creation, and link CHECKS account.broker === conn.broker.
// Every connection in this harness is a MOCK one, so a book that gets linked is a `mock` book.
const mkAccount = async (userId: string, name: string, broker: BrokerId) => {
  const r = mockRes();
  await createAccount(mockReq(userId, { body: { name, broker } }), r);
  return r.body.data.id as string;
};
const addTx = async (userId: string, body: any) => {
  const r = mockRes();
  await addTransaction(mockReq(userId, { body }), r);
  return r;
};

const created: string[] = [];
try {
  const U = await seedUser("u"); created.push(U.authId);
  const V = await seedUser("v"); created.push(V.authId);

  // ═══ A — the link transition (manual → linked_live) ═══
  console.log("═══ A — Link transition (manual → linked_live) ═══");
  const conn1 = await integrate(U.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_1" } });
  const acctA = await mkAccount(U.userId, "Zerodha Main", "mock");

  const ok = await link(U.userId, acctA, conn1.id);
  assert("link → 200, state manual→linked_live, binding set",
    ok.statusCode === 200 && ok.body?.data?.state === "linked_live" && ok.body?.data?.brokerConnectionId === conn1.id,
    `status=${ok.statusCode} state=${ok.body?.data?.state} bound=${ok.body?.data?.brokerConnectionId === conn1.id}`);
  assert("linked account reports manualEntryAllowed=false", ok.body?.data?.manualEntryAllowed === false, `manualEntryAllowed=${ok.body?.data?.manualEntryAllowed}`);

  // ═══ B — link guards ═══
  console.log("\n═══ B — Link guards ═══");
  const conn2 = await integrate(U.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_2" } });
  const relink = await link(U.userId, acctA, conn2.id);
  assert("re-link an ALREADY-LINKED account → 409 already_linked", relink.statusCode === 409 && relink.body?.error === "already_linked", `status=${relink.statusCode} err=${relink.body?.error}`);

  const acctB = await mkAccount(U.userId, "Second Account", "mock");
  const dupConn = await link(U.userId, acctB, conn1.id); // conn1 already feeds acctA
  assert("bind a connection ALREADY BOUND elsewhere → 409 (clean, not a raw constraint error)",
    dupConn.statusCode === 409 && dupConn.body?.error === "connection_already_linked",
    `status=${dupConn.statusCode} err=${dupConn.body?.error}`);

  // IDOR: V cannot link U's connection, nor touch U's account
  const vAcct = await mkAccount(V.userId, "V Account", "mock");
  const idor1 = await link(V.userId, vAcct, conn2.id); // U's connection
  assert("IDOR: V linking U's CONNECTION → 404 connection_not_found", idor1.statusCode === 404 && idor1.body?.error === "connection_not_found", `status=${idor1.statusCode} err=${idor1.body?.error}`);
  const idor2 = await link(V.userId, acctB, conn2.id); // U's account
  assert("IDOR: V linking U's ACCOUNT → 404 not_found", idor2.statusCode === 404 && idor2.body?.error === "not_found", `status=${idor2.statusCode} err=${idor2.body?.error}`);
  const uAcctB = await prisma.portfolioAccount.findUniqueOrThrow({ where: { id: acctB }, select: { state: true, brokerConnectionId: true } });
  assert("...and U's account is UNCHANGED by V's attempts", uAcctB.state === "manual" && uAcctB.brokerConnectionId === null, `state=${uAcctB.state} bound=${uAcctB.brokerConnectionId}`);

  // ═══ C — THE BACK DOOR (the hole Step 2a surfaced) ═══
  console.log("\n═══ C — BACK DOOR: manual write into a LINKED default account ═══");
  const W = await seedUser("w"); created.push(W.authId);
  // Step 5.5: the account is CREATED (with its broker), then written to. The txn omits accountId
  // and still lands, because W has exactly one book — resolve-don't-create.
  await mkAccount(W.userId, "My Holdings", "mock");
  const first = await addTx(W.userId, { symbol: "RELIANCE", type: "buy", quantity: 10, price: 100, tradeDate: "2024-01-01" });
  assert("txn with no accountId resolves to the user's ONLY account (201)", first.statusCode === 201, `status=${first.statusCode}`);
  const myHoldings = await prisma.portfolioAccount.findFirstOrThrow({ where: { userId: W.userId, name: "My Holdings" }, select: { id: true } });

  // Now LINK "My Holdings" itself — the exact precondition for the back door.
  const connW = await integrate(W.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_W" } });
  const linkW = await link(W.userId, myHoldings.id, connW.id, true); // confirm: linking REPLACES its manual ledger (ruling 5)
  assert("link the DEFAULT 'My Holdings' account → linked_live", linkW.statusCode === 200 && linkW.body?.data?.state === "linked_live", `status=${linkW.statusCode} state=${linkW.body?.data?.state}`);

  const txBefore = await prisma.transaction.count({ where: { userId: W.userId } });
  // THE ATTACK: POST a transaction with NO accountId. Pre-fix this short-circuited to
  // ensureDefaultAccount, which never checked state → the write landed in a broker-managed book.
  const backdoor = await addTx(W.userId, { symbol: "TCS", type: "buy", quantity: 5, price: 200, tradeDate: "2024-02-01" });
  const txAfter = await prisma.transaction.count({ where: { userId: W.userId } });
  assert("🔒 BACK DOOR CLOSED: no-accountId write to a LINKED default → 409 account_linked",
    backdoor.statusCode === 409 && backdoor.body?.error === "account_linked",
    `status=${backdoor.statusCode} err=${backdoor.body?.error}`);
  assert("...and NOTHING was written (not landed, not rerouted to another account)", txBefore === txAfter, `txns ${txBefore} → ${txAfter}`);

  // explicit-accountId path still guarded too
  const explicitLinked = await addTx(W.userId, { symbol: "TCS", type: "buy", quantity: 5, price: 200, tradeDate: "2024-02-01", accountId: myHoldings.id });
  assert("explicit accountId → a LINKED account is also refused (409)", explicitLinked.statusCode === 409 && explicitLinked.body?.error === "account_linked", `status=${explicitLinked.statusCode}`);

  // ═══ D — manual accounts UNAFFECTED (no regression) ═══
  console.log("\n═══ D — Manual accounts still fully writable ═══");
  const manualAcct = await mkAccount(W.userId, "Still Manual", "zerodha");
  const manualWrite = await addTx(W.userId, { symbol: "INFY", type: "buy", quantity: 7, price: 300, tradeDate: "2024-03-01", accountId: manualAcct });
  assert("a MANUAL account still accepts manual writes (201) + FIFO runs", manualWrite.statusCode === 201 && Number(manualWrite.body?.data?.holding?.quantity) === 7, `status=${manualWrite.statusCode} qty=${manualWrite.body?.data?.holding?.quantity}`);

  // ═══ E — sync lands on the bound account; orphan refused ═══
  console.log("\n═══ E — Sync lands on the bound account ═══");
  const orphan = await integrate(V.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_ORPHAN" } });
  let orphanErr: BrokerLifecycleError | null = null;
  try { await syncHoldings(V.userId, orphan.id); } catch (e) { orphanErr = e as BrokerLifecycleError; }
  assert("sync an UNLINKED (orphaned) connection → 409 account_not_linked (fail-loud)", orphanErr?.code === "account_not_linked", `code=${orphanErr?.code} status=${orphanErr?.httpStatus}`);
  const orphanRows = await prisma.brokerHolding.count({ where: { brokerConnectionId: orphan.id } });
  assert("...and NO holdings were written for the orphan", orphanRows === 0, `rows=${orphanRows}`);

  const s = await syncHoldings(U.userId, conn1.id);
  assert("sync a LINKED connection → lands on its bound account (derived)", s.accountId === acctA, `accountId=${s.accountId?.slice(0, 8)}… exp=${acctA.slice(0, 8)}…`);
  const wTxns = await prisma.transaction.count({ where: { userId: U.userId } });
  const wLots = await prisma.holdingLot.count({ where: { holding: { userId: U.userId } } });
  assert("ZERO SYNTHESIS: sync fabricated no transactions and no FIFO lots", wTxns === 0 && wLots === 0, `txns=${wTxns} lots=${wLots}`);

  console.log(`\n${failures === 0 ? "✅ ALL ACCOUNT-LINKING CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
} finally {
  for (const a of created) await cleanup(a);
  await prisma.$disconnect();
}
process.exit(failures === 0 ? 0 : 1);
