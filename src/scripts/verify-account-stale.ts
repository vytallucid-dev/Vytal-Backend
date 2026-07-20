// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT-STALE HARNESS (Step 4) — closes the account state machine.
//   manual ──link──▶ linked_live ──deactivate/unlink──▶ linked_stale ──reconnect──▶ linked_live
//
// Proves:
//   A  SEVER → linked_stale; holdings FROZEN (kept, still read, still SCORED — BUG A dead)
//   B  §2.5 token death ≠ sever: a dead token leaves the account linked_live. The two paths
//      are proven DISTINCT on the SAME connection.
//   C  Loud disclosure: /me/accounts (isStale/ageDays) + /me/portfolio (staleAccounts,
//      heldNotValued) — a frozen book is NEVER shown as fresh, and never silently dropped.
//   D  clear-data → stale + EMPTY + RECOVERABLE (the linked_live+null-binding ZOMBIE is dead)
//   E  Re-link by broker_account_ref — same demat recovers the SAME account; a WRONG ref
//      cannot hijack it (the type-invisible trap: both refs are valid strings).
//   F  The account-addressed unlink verb — same transition, same core, cannot drift.
//   G  IDOR: sever/re-link/delete/read never cross users.
//
//   npx tsx src/scripts/verify-account-stale.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import type { BrokerId } from "../brokers/types.js";
import { integrate, syncHoldings, deactivate, activate, clearData, BrokerLifecycleError } from "../brokers/lifecycle.js";
import { listUnifiedPositions } from "../brokers/union.js";
import { assemblePortfolio, listPortfolioDisclosure } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";
import { linkAccount, unlinkAccount, deleteAccount, listAccounts, createAccount } from "../controllers/me/accounts-controller.js";
import { addTransaction } from "../controllers/me/transactions-controller.js";
import { getPortfolioSnapshot } from "../controllers/me/portfolio-snapshot-controller.js";

let failures = 0;
const assert = (name: string, cond: boolean, detail: string) => {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
};
const mockRes = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const mockReq = (userId: string, o: any = {}) => ({ authUser: { userId }, body: o.body ?? {}, params: o.params ?? {}, query: {} }) as any;

async function seedUser(tag: string) {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `stl-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { authId, userId: u.id };
}
const cleanup = (a: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);
const DISC = { accepted: true, disclaimerVersion: "v1" };

const call = async (fn: any, userId: string, o: any = {}) => { const r = mockRes(); await fn(mockReq(userId, o), r); return r; };
const addTx = (userId: string, body: any) => call(addTransaction, userId, { body });
// Step 5.5: broker required at creation; link CHECKS the match. Every connection here is MOCK,
// so a book that gets linked is a `mock` book.
const mkAccount = async (userId: string, name: string, broker: BrokerId) =>
  (await call(createAccount, userId, { body: { name, broker } })).body.data.id as string;
const link = (userId: string, accountId: string, connectionId: string) => call(linkAccount, userId, { params: { id: accountId }, body: { connectionId } });
const unlink = (userId: string, accountId: string) => call(unlinkAccount, userId, { params: { id: accountId } });
const del = (userId: string, accountId: string, confirm = true) => call(deleteAccount, userId, { params: { id: accountId }, body: { confirm } });

const acctRow = (id: string) => prisma.portfolioAccount.findUniqueOrThrow({ where: { id }, select: { state: true, brokerConnectionId: true } });
const bhCount = (userId: string) => prisma.brokerHolding.count({ where: { userId } });

const created: string[] = [];
try {
  // ═══════════════════════════════════════════════════════════════════════════
  // A — SEVER: deactivate → linked_stale. Holdings FROZEN, still READ, still SCORED.
  //     This is the BUG-A fix: until Step 4 the union filtered on connection.enabled, so
  //     deactivating SILENTLY DELETED these positions from the user's score.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══ A — Sever → linked_stale: holdings FROZEN, still scored (BUG A dead) ═══");
  const U = await seedUser("u"); created.push(U.authId);
  // A manual holding (so the book is a real union) + a broker account on the default fixture
  // (RELIANCE 10 · TCS 5 · INFY 20 · FAKESTOCK 3 — FAKESTOCK is outside our universe).
  await mkAccount(U.userId, "My Holdings", "zerodha"); // created explicitly (no auto-create since 5.5)
  await addTx(U.userId, { symbol: "TCS", type: "buy", quantity: 10, price: 3000, tradeDate: "2024-01-01" }); // → the one book
  const uBrokerAcct = await mkAccount(U.userId, "Zerodha Demat", "mock");
  const uConn = await integrate(U.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_U" } });
  await link(U.userId, uBrokerAcct, uConn.id);
  const sync1 = await syncHoldings(U.userId, uConn.id);
  assert("setup: linked + synced (4 broker rows land on the bound account)", sync1.synced === 4 && sync1.accountId === uBrokerAcct, `synced=${sync1.synced} acct=${sync1.accountId === uBrokerAcct}`);

  const asmBefore = await assemblePortfolio(U.userId);
  const phsBefore = computePhs(asmBefore.holdings);
  const bhBefore = await bhCount(U.userId);

  await deactivate(U.userId, uConn.id);

  const uAcctAfter = await acctRow(uBrokerAcct);
  assert("deactivate → account state linked_live → linked_stale", uAcctAfter.state === "linked_stale", `state=${uAcctAfter.state}`);
  // THE ANCHOR: nulling this pointer would orphan every frozen row (the union reaches a broker
  // holding's account via holding → connection → accounts[0]). Sever freezes the FEED, not the link.
  assert("🔗 binding is NOT nulled (the anchor the frozen snapshot hangs off)", uAcctAfter.brokerConnectionId === uConn.id, `bound=${uAcctAfter.brokerConnectionId === uConn.id}`);
  const connAfter = await prisma.brokerConnection.findUniqueOrThrow({ where: { id: uConn.id }, select: { enabled: true } });
  assert("connection is severed (enabled=false), row still present", connAfter.enabled === false, `enabled=${connAfter.enabled}`);

  const bhAfter = await bhCount(U.userId);
  assert("🧊 FROZEN, NOT PURGED: broker_holdings untouched by the sever (§2.3 no-drop)", bhAfter === bhBefore && bhAfter === 4, `rows ${bhBefore} → ${bhAfter}`);

  const uniAfter = await listUnifiedPositions(U.userId);
  const frozen = uniAfter.filter((p) => p.source === "broker");
  assert("🐛 BUG A DEAD: severed holdings are STILL IN THE UNION (was: silently filtered out)", frozen.length === 4, `brokerPositions=${frozen.length}`);
  assert("...and every one is FLAGGED stale (never presented as fresh)", frozen.every((p) => p.stale === true), `stale=[${frozen.map((p) => p.stale).join(",")}]`);
  assert("...manual positions are NOT stale (our own ledger is the source of truth)", uniAfter.filter((p) => p.source === "manual").every((p) => p.stale === false), `manualStale=[${uniAfter.filter((p) => p.source === "manual").map((p) => p.stale).join(",")}]`);

  const asmAfter = await assemblePortfolio(U.userId);
  const phsAfter = computePhs(asmAfter.holdings);
  assert("🎯 SEVERING DOES NOT MOVE THE SCORE — identical PHS before/after (same shares, same price)",
    phsAfter.health === phsBefore.health && phsAfter.construction.net === phsBefore.construction.net && phsAfter.signals === phsBefore.signals,
    `before=${phsBefore.health}/Net ${phsBefore.construction.net.toFixed(2)} after=${phsAfter.health}/Net ${phsAfter.construction.net.toFixed(2)}`);

  // RULING 2: the frozen quantity is scored at OUR LIVE price — staleness caveats the quantity,
  // never the value. A frozen position is marked to today's market, not to a rotting ₹ figure.
  const relPrice = await prisma.stockPrice.findFirstOrThrow({ where: { stock: { symbol: "RELIANCE" } }, select: { price: true } });
  const relPhs = asmAfter.holdings.find((h) => h.symbol === "RELIANCE")!;
  assert("R2: frozen RELIANCE scored at OUR live price × last-known qty (10)",
    !!relPhs && Math.abs(relPhs.marketValue - 10 * Number(relPrice.price)) < 0.01,
    `mv=${relPhs?.marketValue.toFixed(2)} = 10 × ${Number(relPrice.price)}`);
  // TCS is held BOTH manually (10) and by the frozen broker (5) → aggregate-by-symbol still holds.
  const tcsPrice = await prisma.stockPrice.findFirstOrThrow({ where: { stock: { symbol: "TCS" } }, select: { price: true } });
  const tcsPhs = asmAfter.holdings.find((h) => h.symbol === "TCS")!;
  assert("frozen + manual of the SAME stock still aggregate to one exposure (10 manual + 5 frozen = 15)",
    Math.abs(tcsPhs.marketValue - 15 * Number(tcsPrice.price)) < 0.01, `mv=${tcsPhs.marketValue.toFixed(2)} = 15 × ${Number(tcsPrice.price)}`);

  // The counterfactual: what the OLD (pre-Step-4) filter would have produced — the frozen-only
  // names dropped from the book entirely. If the score moves, those positions were carrying real
  // weight, and dropping them was silently rewriting the user's health.
  const frozenOnly = new Set(["RELIANCE", "INFY"]); // held ONLY in the severed account
  const oldBehaviour = computePhs(asmAfter.holdings.filter((h) => !frozenOnly.has(h.symbol)));
  assert("🐛 ...and the OLD behaviour would have MOVED the score (proof the drop was not harmless)",
    oldBehaviour.health !== phsAfter.health,
    `dropped-frozen=${oldBehaviour.health} vs frozen-kept=${phsAfter.health}`);

  // A severed account is STILL a broker's book — manual entry stays refused (§2.3).
  const manualIntoStale = await addTx(U.userId, { symbol: "INFY", type: "buy", quantity: 1, price: 100, tradeDate: "2024-05-01", accountId: uBrokerAcct });
  assert("manual entry into a STALE account is still REFUSED (409 account_linked — not reverted to manual)",
    manualIntoStale.statusCode === 409 && manualIntoStale.body?.error === "account_linked", `status=${manualIntoStale.statusCode} err=${manualIntoStale.body?.error}`);

  // activate → back to live
  await activate(U.userId, uConn.id);
  assert("activate → linked_stale back to linked_live (recoverable)", (await acctRow(uBrokerAcct)).state === "linked_live", `state=${(await acctRow(uBrokerAcct)).state}`);
  await deactivate(U.userId, uConn.id); // re-sever for the disclosure section

  // ═══════════════════════════════════════════════════════════════════════════
  // B — §2.5: A DEAD TOKEN IS NOT A SEVER. Broker tokens die daily; that is ROUTINE.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ B — §2.5: token death ≠ sever (the trap) ═══");
  const W = await seedUser("w"); created.push(W.authId);
  const wAcct = await mkAccount(W.userId, "Kite", "mock");
  const wConn = await integrate(W.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_W" } });
  await link(W.userId, wAcct, wConn.id);
  await syncHoldings(W.userId, wConn.id);

  // Kill the TOKEN (not the binding): re-auth the SAME demat with an already-expired session.
  // Same ref ⇒ same connection row ⇒ holdings and binding survive; only the session is dead.
  await integrate(W.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_W", mockExpired: true } });
  let sessionErr: BrokerLifecycleError | null = null;
  try { await syncHoldings(W.userId, wConn.id); } catch (e) { sessionErr = e as BrokerLifecycleError; }
  assert("sync with a dead token → 409 session_dead (reconnect, the routine case)", sessionErr?.code === "session_dead", `code=${sessionErr?.code}`);

  const wConnRow = await prisma.brokerConnection.findUniqueOrThrow({ where: { id: wConn.id }, select: { enabled: true, sessionState: true } });
  const wAcctRow = await acctRow(wAcct);
  assert("🚨 §2.5: the DEAD TOKEN did NOT flip the account — still linked_live", wAcctRow.state === "linked_live", `state=${wAcctRow.state}`);
  assert("...connection is still ENABLED (dead session ≠ severed feed)", wConnRow.enabled === true && wConnRow.sessionState === "dead", `enabled=${wConnRow.enabled} session=${wConnRow.sessionState}`);
  assert("...binding intact, holdings intact", wAcctRow.brokerConnectionId === wConn.id && (await bhCount(W.userId)) === 4, `bound=${wAcctRow.brokerConnectionId === wConn.id} rows=${await bhCount(W.userId)}`);
  const wUni = await listUnifiedPositions(W.userId);
  assert("...and its positions are NOT marked stale (fresh data, just unrefreshable)", wUni.every((p) => p.stale === false), `stale=[${[...new Set(wUni.map((p) => p.stale))].join(",")}]`);

  // THE PATHS ARE DISTINCT — same connection, same dead token, now actually SEVERED.
  await deactivate(W.userId, wConn.id);
  assert("🚨 ...but a SEVER on that SAME connection DOES flip it → linked_stale (paths distinct)",
    (await acctRow(wAcct)).state === "linked_stale", `state=${(await acctRow(wAcct)).state}`);
  const wUni2 = await listUnifiedPositions(W.userId);
  assert("...and NOW its positions read stale (the flag tracks the BINDING, not the token)", wUni2.every((p) => p.stale === true), `stale=[${[...new Set(wUni2.map((p) => p.stale))].join(",")}]`);

  // ═══════════════════════════════════════════════════════════════════════════
  // C — LOUD DISCLOSURE: never fresh-looking, never silently dropped.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ C — Disclosure: /me/accounts + /me/portfolio ═══");
  // Backdate the last sync so ageDays is a REAL derived number, not a trivial 0.
  // (broker_connections.id is TEXT — Prisma's uuid() default, not a pg `uuid` column. No cast.)
  await prisma.$executeRawUnsafe(
    `UPDATE broker_connections SET last_synced_at = now() - interval '12 days' WHERE id = $1`, uConn.id);

  const accts = (await call(listAccounts, U.userId)).body.data as any[];
  const staleAcct = accts.find((a) => a.id === uBrokerAcct);
  const manualAcct = accts.find((a) => a.state === "manual");
  assert("/me/accounts: the severed account reports isStale=true", staleAcct?.staleness?.isStale === true, `isStale=${staleAcct?.staleness?.isStale}`);
  assert("/me/accounts: ...with a DERIVED ageDays (12) + the last-sync stamp — not a stored value",
    staleAcct?.staleness?.ageDays === 12 && staleAcct?.staleness?.lastSyncedAt != null, `ageDays=${staleAcct?.staleness?.ageDays} lastSyncedAt=${staleAcct?.staleness?.lastSyncedAt}`);
  assert("/me/accounts: ...and manual entry is still reported as disallowed", staleAcct?.manualEntryAllowed === false, `manualEntryAllowed=${staleAcct?.manualEntryAllowed}`);
  assert("/me/accounts: a MANUAL account has no staleness (our ledger is never stale)", manualAcct?.staleness === null, `staleness=${JSON.stringify(manualAcct?.staleness)}`);

  const snapRes = await call(getPortfolioSnapshot, U.userId);
  const disc = snapRes.body?.data?.disclosure;
  assert("/me/portfolio: disclosure channel is SERVED (it was computed and dropped on the floor before Step 4)", !!disc, `disclosure=${!!disc}`);
  assert("/me/portfolio: 1 stale account, oldest data 12 days", disc?.staleAccountCount === 1 && disc?.oldestSyncAgeDays === 12, `count=${disc?.staleAccountCount} oldest=${disc?.oldestSyncAgeDays}`);
  assert("/me/portfolio: ...naming the account + how many frozen positions it still contributes",
    disc?.staleAccounts?.[0]?.accountId === uBrokerAcct && disc?.staleAccounts?.[0]?.positions === 4,
    `acct=${disc?.staleAccounts?.[0]?.accountId === uBrokerAcct} positions=${disc?.staleAccounts?.[0]?.positions}`);
  // heldNotValued — GATE 3 #7. FAKESTOCK is outside our universe: zero PHS weight, but LOUD.
  const hnv = disc?.heldNotValued?.find((h: any) => h.symbol === "FAKESTOCK");
  assert("/me/portfolio: heldNotValued SERVED — the unmapped symbol is disclosed, not swept away",
    !!hnv && Number(hnv.quantity) === 3 && hnv.brokerCurrentValue != null, `hnv=${JSON.stringify(hnv ?? null)}`);
  assert("/me/portfolio: ...and it is disclosed as stale too", hnv?.stale === true, `stale=${hnv?.stale}`);
  assert("...while carrying ZERO score weight (absent from the scored holdings)",
    !asmAfter.holdings.some((h) => h.symbol === "FAKESTOCK"), `inPhs=${asmAfter.holdings.some((h) => h.symbol === "FAKESTOCK")}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // D — clear-data → stale + EMPTY + RECOVERABLE. The ZOMBIE is dead.
  //     Pre-Step-4 this left linked_live + null binding: could not sync, could not accept
  //     manual entry, could not be deleted, could not be re-linked. Permanently bricked.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ D — clear-data → stale + empty + RECOVERABLE (zombie dead) ═══");
  const X = await seedUser("x"); created.push(X.authId);
  await mkAccount(X.userId, "My Holdings", "zerodha"); // keeps ≥1 account (explicit since 5.5)
  await addTx(X.userId, { symbol: "TCS", type: "buy", quantity: 1, price: 3000, tradeDate: "2024-01-01" });
  const xAcct = await mkAccount(X.userId, "To Be Cleared", "mock");
  const xConn = await integrate(X.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_X" } });
  await link(X.userId, xAcct, xConn.id);
  await syncHoldings(X.userId, xConn.id);
  await deactivate(X.userId, xConn.id);
  const cleared = await clearData(X.userId, xConn.id, { confirm: true });

  const xAfter = await acctRow(xAcct);
  assert("clear wipes the connection + its holdings (the ONE explicit forget-path)",
    cleared.cleared && cleared.wipedHoldings === 4 && (await bhCount(X.userId)) === 0, `wiped=${cleared.wipedHoldings} rows=${await bhCount(X.userId)}`);
  assert("🧟 ZOMBIE DEAD: the account is linked_stale + null binding (was: linked_live + null = bricked)",
    xAfter.state === "linked_stale" && xAfter.brokerConnectionId === null, `state=${xAfter.state} binding=${xAfter.brokerConnectionId}`);

  // RECOVERY #1 — re-linkable (a fresh connection can adopt the empty shell)
  const xConn2 = await integrate(X.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_X2" } });
  const relinked = await link(X.userId, xAcct, xConn2.id);
  assert("🧟 RECOVERABLE #1: the cleared account is RE-LINKABLE → linked_live",
    relinked.statusCode === 200 && relinked.body?.data?.state === "linked_live", `status=${relinked.statusCode} state=${relinked.body?.data?.state}`);

  // RECOVERY #2 — deletable (a different cleared account, so we test both exits)
  const Y = await seedUser("y"); created.push(Y.authId);
  await mkAccount(Y.userId, "My Holdings", "zerodha");
  await addTx(Y.userId, { symbol: "TCS", type: "buy", quantity: 1, price: 3000, tradeDate: "2024-01-01" });
  const yAcct = await mkAccount(Y.userId, "To Be Deleted", "mock");
  const yConn = await integrate(Y.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_Y" } });
  await link(Y.userId, yAcct, yConn.id);
  await syncHoldings(Y.userId, yConn.id);
  const stillBound = await del(Y.userId, yAcct);
  assert("a STILL-BOUND account refuses DELETE (409) — deleting it would orphan its broker_holdings",
    stillBound.statusCode === 409 && stillBound.body?.error === "account_linked", `status=${stillBound.statusCode} err=${stillBound.body?.error}`);
  await deactivate(Y.userId, yConn.id);
  await clearData(Y.userId, yConn.id, { confirm: true });
  const deleted = await del(Y.userId, yAcct);
  assert("🧟 RECOVERABLE #2: the cleared (stale + empty) account is DELETABLE",
    deleted.statusCode === 200 && deleted.body?.data?.deleted === true, `status=${deleted.statusCode}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // E — RE-LINK BY REF (the type-invisible trap). broker_account_ref is a plain string:
  //     "DEMAT_Z" and "DEMAT_WRONG" are both valid `string`s, so tsc is blind to a mismatch.
  //     Only a live run can prove the wrong demat cannot adopt a stale account's frozen book.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ E — Re-link by broker_account_ref (type-invisible: both refs are valid strings) ═══");
  const Z = await seedUser("z"); created.push(Z.authId);
  const zAcct = await mkAccount(Z.userId, "Demat Z", "mock");
  const zConn = await integrate(Z.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_Z" } });
  await link(Z.userId, zAcct, zConn.id);
  await syncHoldings(Z.userId, zConn.id);
  await deactivate(Z.userId, zConn.id);
  const zAcctsBefore = await prisma.portfolioAccount.count({ where: { userId: Z.userId } });

  // WRONG demat reconnects → a DIFFERENT connection row. It must NOT touch the stale account.
  const wrongConn = await integrate(Z.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_WRONG" } });
  const zAfterWrong = await acctRow(zAcct);
  assert("🎭 WRONG ref → a SEPARATE connection (different id, no bound account)",
    wrongConn.id !== zConn.id && wrongConn.linkedAccountId === null, `sameId=${wrongConn.id === zConn.id} linked=${wrongConn.linkedAccountId}`);
  assert("🎭 ...and the stale account is UNTOUCHED — the wrong demat cannot hijack its frozen book",
    zAfterWrong.state === "linked_stale" && zAfterWrong.brokerConnectionId === zConn.id, `state=${zAfterWrong.state} boundTo=${zAfterWrong.brokerConnectionId === zConn.id ? "original" : "HIJACKED"}`);

  // RIGHT demat reconnects → the SAME connection row (the upsert key IS the ref) → re-link.
  const back = await integrate(Z.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_Z" } });
  const zAfterRight = await acctRow(zAcct);
  assert("✅ SAME ref → the SAME connection row (upsert on user+broker+ref, never a duplicate)",
    back.id === zConn.id, `connId same=${back.id === zConn.id}`);
  assert("✅ RE-LINK: the stale account is recovered → linked_live (same account, not a parallel)",
    zAfterRight.state === "linked_live" && zAfterRight.brokerConnectionId === zConn.id, `state=${zAfterRight.state}`);
  assert("✅ ...no parallel account was created", (await prisma.portfolioAccount.count({ where: { userId: Z.userId } })) === zAcctsBefore, `accounts ${zAcctsBefore} → ${await prisma.portfolioAccount.count({ where: { userId: Z.userId } })}`);
  const resync = await syncHoldings(Z.userId, zConn.id);
  assert("✅ ...and sync RESUMES onto the same bound account", resync.accountId === zAcct && resync.synced === 4, `acct=${resync.accountId === zAcct} synced=${resync.synced}`);
  const zUni = await listUnifiedPositions(Z.userId);
  assert("✅ ...positions read FRESH again (stale flag cleared)", zUni.every((p) => p.stale === false), `stale=[${[...new Set(zUni.map((p) => p.stale))].join(",")}]`);

  // ═══════════════════════════════════════════════════════════════════════════
  // F — the account-addressed UNLINK verb: same transition, same core.
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ F — POST /accounts/:id/unlink (account-addressed sever) ═══");
  const zBhBefore = await bhCount(Z.userId);
  const unl = await unlink(Z.userId, zAcct);
  assert("unlink → 200, linked_live → linked_stale", unl.statusCode === 200 && unl.body?.data?.state === "linked_stale", `status=${unl.statusCode} state=${unl.body?.data?.state}`);
  assert("unlink FREEZES, never purges: broker_holdings untouched (§2.3 no-drop)", (await bhCount(Z.userId)) === zBhBefore && zBhBefore === 4, `rows ${zBhBefore} → ${await bhCount(Z.userId)}`);
  assert("unlink does NOT null the binding (the anchor stays)", (await acctRow(zAcct)).brokerConnectionId === zConn.id, `bound=${(await acctRow(zAcct)).brokerConnectionId === zConn.id}`);
  assert("unlink discloses staleness immediately", unl.body?.data?.staleness?.isStale === true, `isStale=${unl.body?.data?.staleness?.isStale}`);
  const zManual = await mkAccount(Z.userId, "Z Manual", "zerodha");
  const unlinkManual = await unlink(Z.userId, zManual);
  assert("unlink a MANUAL account → 409 not_linked", unlinkManual.statusCode === 409 && unlinkManual.body?.error === "not_linked", `status=${unlinkManual.statusCode} err=${unlinkManual.body?.error}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // G — IDOR
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ G — IDOR: sever / re-link / delete / read never cross users ═══");
  const V = await seedUser("v"); created.push(V.authId);
  const vUnlink = await unlink(V.userId, uBrokerAcct); // U's account
  assert("V unlinking U's account → 404 (no existence disclosure)", vUnlink.statusCode === 404 && vUnlink.body?.error === "not_found", `status=${vUnlink.statusCode} err=${vUnlink.body?.error}`);
  const vLink = await link(V.userId, uBrokerAcct, uConn.id); // U's account + U's connection
  assert("V linking U's account → 404", vLink.statusCode === 404, `status=${vLink.statusCode}`);
  const vDel = await del(V.userId, uBrokerAcct);
  assert("V deleting U's account → 404", vDel.statusCode === 404, `status=${vDel.statusCode}`);
  const uUnchanged = await acctRow(uBrokerAcct);
  assert("...and U's account is UNCHANGED by every one of V's attempts",
    uUnchanged.state === "linked_stale" && uUnchanged.brokerConnectionId === uConn.id, `state=${uUnchanged.state} bound=${uUnchanged.brokerConnectionId === uConn.id}`);
  const vDisc = await listPortfolioDisclosure(V.userId);
  assert("V's disclosure contains ZERO of U's stale accounts", vDisc.staleAccountCount === 0 && vDisc.heldNotValued.length === 0, `stale=${vDisc.staleAccountCount} hnv=${vDisc.heldNotValued.length}`);

  console.log(`\n${failures === 0 ? "✅ ALL ACCOUNT-STALE CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
} finally {
  for (const a of created) await cleanup(a);
  await prisma.$disconnect();
}
process.exit(failures === 0 ? 0 : 1);
