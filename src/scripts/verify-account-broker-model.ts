// ─────────────────────────────────────────────────────────────────────────────
// BROKER-PARENT ACCOUNT MODEL HARNESS (Step 5.5) — every account belongs to a broker.
//
//   A  broker REQUIRED at creation; broker-less refused; non-catalog broker refused;
//      `mock` API-creatable but ABSENT from the picker
//   B  CATALOG vs LINKABLE: an Angel One account is creatable today (create-now-link-later),
//      but cannot be connected — no adapter exists
//   C  RESOLVE-DON'T-CREATE: 0 → 400 · 1 → resolves · 2+ → 400. No account is ever BORN
//      without a broker, and no single-account user broke
//   D  BROKER-MATCH on link: a Zerodha book cannot take an Upstox/mock connection
//   E  WARN + REPLACE (the LIVE bug): linking a non-empty manual account replaces its ledger.
//      Proven at the READ surface — RELIANCE 110 → 10, the double-count is gone
//   F  RETAG: manual+unbound → allowed; linked/bound → refused
//   G  IDOR: create/link/retag/patch never cross users
//   H  TYPE-INVISIBLE: broker + accountId are both plain strings. Assert the SPECIFIC value,
//      never merely "a value" — a wrong broker is a perfectly valid string
//
//   npx tsx src/scripts/verify-account-broker-model.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import { integrate, syncHoldings } from "../brokers/lifecycle.js";
import { listUnifiedPositions } from "../brokers/union.js";
import { IMPLEMENTED_BROKERS } from "../brokers/registry.js";
import { pickableBrokers, brokerCatalog } from "../brokers/catalog.js";
import {
  createAccount, patchAccount, linkAccount, listAccounts, listBrokerCatalog,
} from "../controllers/me/accounts-controller.js";
import { addTransaction } from "../controllers/me/transactions-controller.js";

let failures = 0;
const assert = (name: string, cond: boolean, detail: string) => {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
};
const mockRes = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const mockReq = (userId: string, o: any = {}) => ({ authUser: { userId }, body: o.body ?? {}, params: o.params ?? {}, query: {} }) as any;
const call = async (fn: any, userId: string, o: any = {}) => { const r = mockRes(); await fn(mockReq(userId, o), r); return r; };

async function seedUser(tag: string) {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `bpm-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { authId, userId: u.id };
}
const cleanup = (a: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);
const DISC = { accepted: true, disclaimerVersion: "v1" };

const mk = (userId: string, body: any) => call(createAccount, userId, { body });
const patch = (userId: string, id: string, body: any) => call(patchAccount, userId, { params: { id }, body });
const link = (userId: string, id: string, body: any) => call(linkAccount, userId, { params: { id }, body });
const addTx = (userId: string, body: any) => call(addTransaction, userId, { body });
const acctRow = (id: string) => prisma.portfolioAccount.findUniqueOrThrow({ where: { id }, select: { broker: true, state: true, brokerConnectionId: true } });

const created: string[] = [];
try {
  // ═══════════════════════════════════════════════════════════════════════════
  // A — BROKER REQUIRED AT CREATION
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══ A — Broker is REQUIRED at creation ═══");
  const U = await seedUser("u"); created.push(U.authId);

  const noBroker = await mk(U.userId, { name: "Nameless Book" });
  assert("create WITHOUT a broker → 400 validation_error (no account is born broker-less)",
    noBroker.statusCode === 400 && noBroker.body?.error === "validation_error", `status=${noBroker.statusCode} err=${noBroker.body?.error}`);

  const badBroker = await mk(U.userId, { name: "Fake Broker Book", broker: "robinhood" });
  assert("create with a NON-CATALOG broker → 400 (no 'other' fallback, no silent coercion)",
    badBroker.statusCode === 400 && badBroker.body?.error === "validation_error", `status=${badBroker.statusCode} err=${badBroker.body?.error}`);
  const bornAnyway = await prisma.portfolioAccount.count({ where: { userId: U.userId } });
  assert("...and neither refusal created anything", bornAnyway === 0, `accounts=${bornAnyway}`);

  const good = await mk(U.userId, { name: "Zerodha Main", broker: "zerodha" });
  assert("create WITH a catalog broker → 201", good.statusCode === 201, `status=${good.statusCode}`);
  const zMain = good.body.data.id as string;
  // TYPE-INVISIBLE (H): assert the SPECIFIC broker, not just "a broker" — 'zerodha' and 'upstox'
  // are both valid strings, and a swapped one would look identical to a truthiness check.
  assert("H: the created account carries EXACTLY 'zerodha' (not merely 'some broker')",
    (await acctRow(zMain)).broker === "zerodha", `broker=${(await acctRow(zMain)).broker}`);
  assert("...and it is born MANUAL and UNBOUND", (await acctRow(zMain)).state === "manual" && (await acctRow(zMain)).brokerConnectionId === null, `state=${(await acctRow(zMain)).state}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // B — CATALOG vs LINKABLE (create-now-link-later)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ B — CATALOG vs LINKABLE ═══");
  const picker = (await call(listBrokerCatalog, U.userId)).body.data as { id: string; linkable: boolean; displayName: string }[];
  assert("picker excludes `mock` (API-creatable, never offered)", !picker.some((b) => b.id === "mock"), `ids=${picker.map((b) => b.id).join(",")}`);
  assert("picker offers the full catalog (16 real brokers)", picker.length === 16, `count=${picker.length}`);
  const linkables = picker.filter((b) => b.linkable).map((b) => b.id);
  assert("exactly ONE is linkable today, and it is zerodha", linkables.length === 1 && linkables[0] === "zerodha", `linkable=${linkables.join(",")}`);
  assert("catalog `linkable` is DERIVED from IMPLEMENTED_BROKERS (cannot drift)",
    brokerCatalog().filter((b) => b.linkable).map((b) => b.id).sort().join(",") === [...IMPLEMENTED_BROKERS].sort().join(","),
    `catalog=${brokerCatalog().filter((b) => b.linkable).map((b) => b.id).join(",")} registry=${IMPLEMENTED_BROKERS.join(",")}`);
  assert("Angel One IS offered, and is honestly marked NOT linkable",
    picker.some((b) => b.id === "angelone" && !b.linkable), `angelone=${JSON.stringify(picker.find((b) => b.id === "angelone"))}`);

  // create-now-link-later: the account exists and is hand-trackable TODAY.
  const angel = await mk(U.userId, { name: "Angel One Book", broker: "angelone" });
  assert("an ANGEL ONE account can be CREATED before any Angel adapter exists (201)", angel.statusCode === 201, `status=${angel.statusCode}`);
  const angelId = angel.body.data.id as string;
  const angelTx = await addTx(U.userId, { symbol: "TCS", type: "buy", quantity: 4, price: 3000, tradeDate: "2024-01-01", accountId: angelId });
  assert("...and it is fully hand-trackable (a manual txn lands + FIFO runs)",
    angelTx.statusCode === 201 && Number(angelTx.body?.data?.holding?.quantity) === 4, `status=${angelTx.statusCode} qty=${angelTx.body?.data?.holding?.quantity}`);
  // ...but it cannot be CONNECTED: no adapter → integrate refuses at the registry.
  let angelIntegrateErr: any = null;
  try { await integrate(U.userId, "angelone", DISC); } catch (e) { angelIntegrateErr = e; }
  assert("...but it CANNOT be connected — integrate(angelone) refuses (no adapter)",
    angelIntegrateErr?.code === "unsupported_broker", `code=${angelIntegrateErr?.code} status=${angelIntegrateErr?.httpStatus}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // C — RESOLVE-DON'T-CREATE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ C — Resolve-don't-create (the auto-create is dead) ═══");
  const R = await seedUser("r"); created.push(R.authId);

  const zeroAcct = await addTx(R.userId, { symbol: "RELIANCE", type: "buy", quantity: 10, price: 100, tradeDate: "2024-01-01" });
  assert("0 accounts + no accountId → 400 no_account (the broker-less auto-create is GONE)",
    zeroAcct.statusCode === 400 && zeroAcct.body?.error === "no_account", `status=${zeroAcct.statusCode} err=${zeroAcct.body?.error}`);
  assert("...and NO account was conjured behind the user's back",
    (await prisma.portfolioAccount.count({ where: { userId: R.userId } })) === 0, "accounts=0");

  const rMain = (await mk(R.userId, { name: "My Holdings", broker: "groww" })).body.data.id as string;
  const oneAcct = await addTx(R.userId, { symbol: "RELIANCE", type: "buy", quantity: 10, price: 100, tradeDate: "2024-01-01" });
  assert("1 account + no accountId → RESOLVES to it (201 — the live app keeps working)",
    oneAcct.statusCode === 201, `status=${oneAcct.statusCode}`);
  assert("...and it landed in THAT account specifically",
    (await prisma.transaction.count({ where: { accountId: rMain } })) === 1, `txns in rMain=${await prisma.transaction.count({ where: { accountId: rMain } })}`);

  await mk(R.userId, { name: "Second Book", broker: "upstox" });
  const twoAcct = await addTx(R.userId, { symbol: "TCS", type: "buy", quantity: 1, price: 3000, tradeDate: "2024-01-02" });
  assert("2+ accounts + no accountId → 400 account_required (we never GUESS the book)",
    twoAcct.statusCode === 400 && twoAcct.body?.error === "account_required", `status=${twoAcct.statusCode} err=${twoAcct.body?.error}`);
  assert("...and nothing was written", (await prisma.transaction.count({ where: { userId: R.userId } })) === 1, "txns=1");

  // ═══════════════════════════════════════════════════════════════════════════
  // D — BROKER-MATCH ON LINK (link CHECKS the broker; it no longer ASSIGNS it)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ D — Broker-match on link ═══");
  const M = await seedUser("m"); created.push(M.authId);
  const mockConn = await integrate(M.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_M" } });

  // A ZERODHA book offered a MOCK connection → refused. Both brokers are valid strings; only the
  // MATCH makes it right (H: type-invisible).
  const zBook = (await mk(M.userId, { name: "Zerodha Book", broker: "zerodha" })).body.data.id as string;
  const mismatch = await link(M.userId, zBook, { connectionId: mockConn.id });
  assert("D/H: link a ZERODHA book to a MOCK connection → 409 broker_mismatch",
    mismatch.statusCode === 409 && mismatch.body?.error === "broker_mismatch", `status=${mismatch.statusCode} err=${mismatch.body?.error}`);
  const zAfter = await acctRow(zBook);
  assert("...and the refused account is UNTOUCHED (still zerodha, still manual, still unbound)",
    zAfter.broker === "zerodha" && zAfter.state === "manual" && zAfter.brokerConnectionId === null,
    `broker=${zAfter.broker} state=${zAfter.state} bound=${zAfter.brokerConnectionId}`);

  // The MATCHING book links.
  const mBook = (await mk(M.userId, { name: "Mock Book", broker: "mock" })).body.data.id as string;
  const matched = await link(M.userId, mBook, { connectionId: mockConn.id });
  assert("link a MOCK book to a MOCK connection → 200 linked_live",
    matched.statusCode === 200 && matched.body?.data?.state === "linked_live", `status=${matched.statusCode} state=${matched.body?.data?.state}`);
  assert("...and the account's broker is UNCHANGED by the link (it was already right)",
    (await acctRow(mBook)).broker === "mock", `broker=${(await acctRow(mBook)).broker}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // E — WARN + REPLACE: the LIVE double-count bug (RELIANCE 110 → 10)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ E — Warn + replace: a linked account is BROKER-ONLY ═══");
  const B = await seedUser("b"); created.push(B.authId);
  const bBook = (await mk(B.userId, { name: "My Book", broker: "mock" })).body.data.id as string;
  // Hand-enter RELIANCE 100 — the exact shape of the live bug.
  await addTx(B.userId, { symbol: "RELIANCE", type: "buy", quantity: 100, price: 1200, tradeDate: "2025-01-15", accountId: bBook });
  const bConn = await integrate(B.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_B" } });

  const unconfirmed = await link(B.userId, bBook, { connectionId: bConn.id });
  assert("linking a NON-EMPTY manual account WITHOUT confirm → 400 confirmation_required (warn)",
    unconfirmed.statusCode === 400 && unconfirmed.body?.error === "confirmation_required", `status=${unconfirmed.statusCode} err=${unconfirmed.body?.error}`);
  assert("...the warning NAMES what it would destroy", unconfirmed.body?.willDelete?.transactions === 1 && unconfirmed.body?.willDelete?.holdings === 1,
    `willDelete=${JSON.stringify(unconfirmed.body?.willDelete)}`);
  assert("...and NOTHING was deleted or linked by the refusal",
    (await prisma.transaction.count({ where: { accountId: bBook } })) === 1 && (await acctRow(bBook)).state === "manual",
    `txns=${await prisma.transaction.count({ where: { accountId: bBook } })} state=${(await acctRow(bBook)).state}`);

  const confirmed = await link(B.userId, bBook, { connectionId: bConn.id, confirm: true });
  assert("with confirm:true → 200, and the replacement is REPORTED",
    confirmed.statusCode === 200 && confirmed.body?.replaced?.transactions === 1, `status=${confirmed.statusCode} replaced=${JSON.stringify(confirmed.body?.replaced)}`);
  const txLeft = await prisma.transaction.count({ where: { accountId: bBook } });
  const hLeft = await prisma.holding.count({ where: { accountId: bBook } });
  const lotsLeft = await prisma.holdingLot.count({ where: { holding: { accountId: bBook } } });
  assert("CLEAN DELETION: transactions, holdings AND lots all gone (no zombie 0-qty rows)",
    txLeft === 0 && hLeft === 0 && lotsLeft === 0, `txns=${txLeft} holdings=${hLeft} lots=${lotsLeft}`);

  // THE BUG, AT THE READ SURFACE. Pre-fix this account read RELIANCE 110 (manual 100 + broker 10).
  await syncHoldings(B.userId, bConn.id);
  const positions = await listUnifiedPositions(B.userId);
  const inBook = positions.filter((p) => p.accountId === bBook);
  const rel = inBook.filter((p) => p.symbol === "RELIANCE");
  assert("🐛 BUG FIXED: RELIANCE appears ONCE in the linked account (not manual+broker twice)",
    rel.length === 1, `RELIANCE lines=${rel.length}`);
  assert("🐛 ...and reads the BROKER's 10 — not the phantom 110",
    Number(rel[0]?.quantity) === 10 && rel[0]?.source === "broker", `qty=${rel[0]?.quantity} source=${rel[0]?.source}`);
  assert("a LINKED account holds NO manual positions at all (broker-only)",
    inBook.every((p) => p.source === "broker"), `sources=${[...new Set(inBook.map((p) => p.source))].join(",")}`);

  // An EMPTY manual account still links with no confirm — unchanged behaviour.
  const E2 = await seedUser("e"); created.push(E2.authId);
  const emptyBook = (await mk(E2.userId, { name: "Empty", broker: "mock" })).body.data.id as string;
  const eConn = await integrate(E2.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_E" } });
  const emptyLink = await link(E2.userId, emptyBook, { connectionId: eConn.id });
  assert("an EMPTY manual account links WITHOUT confirm (no gate where nothing is at stake)",
    emptyLink.statusCode === 200 && emptyLink.body?.replaced === null, `status=${emptyLink.statusCode} replaced=${JSON.stringify(emptyLink.body?.replaced)}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // F — RETAG
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ F — Retag (manual + unbound only) ═══");
  const T = await seedUser("t"); created.push(T.authId);
  const tBook = (await mk(T.userId, { name: "Wrong Broker", broker: "upstox" })).body.data.id as string;
  const retag = await patch(T.userId, tBook, { broker: "zerodha" });
  assert("retag a MANUAL + UNBOUND account → 200", retag.statusCode === 200, `status=${retag.statusCode}`);
  assert("H: it is now EXACTLY 'zerodha' (the specific value moved, not just 'a value')",
    (await acctRow(tBook)).broker === "zerodha", `broker=${(await acctRow(tBook)).broker}`);

  const retagBad = await patch(T.userId, tBook, { broker: "robinhood" });
  assert("retag to a NON-CATALOG broker → 400", retagBad.statusCode === 400, `status=${retagBad.statusCode}`);
  assert("...and the broker did NOT move", (await acctRow(tBook)).broker === "zerodha", `broker=${(await acctRow(tBook)).broker}`);

  // A BOUND account cannot be retagged — its broker is a fact about its connection.
  const retagLinked = await patch(M.userId, mBook, { broker: "zerodha" });
  assert("retag a LINKED/BOUND account → 409 account_linked (the mirror's broker is not a label)",
    retagLinked.statusCode === 409 && retagLinked.body?.error === "account_linked", `status=${retagLinked.statusCode} err=${retagLinked.body?.error}`);
  assert("...and the linked account still says 'mock'", (await acctRow(mBook)).broker === "mock", `broker=${(await acctRow(mBook)).broker}`);

  // Renaming a LINKED account is still fine — only the BROKER is frozen.
  const renameLinked = await patch(M.userId, mBook, { name: "Renamed Mock Book" });
  assert("rename a LINKED account → 200 (only the broker is frozen, not the name)", renameLinked.statusCode === 200, `status=${renameLinked.statusCode}`);
  // Echoing the SAME broker on a linked account is a no-op, not a violation.
  const echo = await patch(M.userId, mBook, { name: "Echoed", broker: "mock" });
  assert("...and re-sending the SAME broker is a no-op, not a refusal", echo.statusCode === 200, `status=${echo.statusCode}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // G — IDOR
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ G — IDOR ═══");
  const X = await seedUser("x"); created.push(X.authId);
  const xRetag = await patch(X.userId, zMain, { broker: "upstox" });
  assert("X cannot RETAG U's account → 404 (not 403 — no existence disclosure)", xRetag.statusCode === 404, `status=${xRetag.statusCode}`);
  assert("...and U's broker is untouched", (await acctRow(zMain)).broker === "zerodha", `broker=${(await acctRow(zMain)).broker}`);
  const xLink = await link(X.userId, zMain, { connectionId: mockConn.id, confirm: true });
  assert("X cannot LINK U's account → 404", xLink.statusCode === 404, `status=${xLink.statusCode}`);
  const xList = await call(listAccounts, X.userId);
  assert("X's account list contains none of U's", xList.body.data.length === 0, `count=${xList.body.data.length}`);
  // X owns nothing → cannot reach M's connection either (owner-scoped connection lookup).
  const xBook = (await mk(X.userId, { name: "X Book", broker: "mock" })).body.data.id as string;
  const xSteal = await link(X.userId, xBook, { connectionId: mockConn.id });
  assert("X cannot bind M's CONNECTION to X's own account → 404 connection_not_found",
    xSteal.statusCode === 404 && xSteal.body?.error === "connection_not_found", `status=${xSteal.statusCode} err=${xSteal.body?.error}`);

  console.log(`\n${failures === 0 ? "✅ ALL BROKER-PARENT ACCOUNT-MODEL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
} finally {
  for (const a of created) await cleanup(a);
  await prisma.$disconnect();
}
process.exit(failures === 0 ? 0 : 1);
