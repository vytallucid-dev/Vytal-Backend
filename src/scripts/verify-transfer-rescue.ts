// ─────────────────────────────────────────────────────────────────────────────
// TRANSFER + RESCUE-ON-DELETE HARNESS (Step 6) — how a position MOVES.
//
//   A  manual→manual, SAME broker: full position moves; FIFO economics BYTE-IDENTICAL
//   B  manual→manual, CROSS broker (rule 1): Zerodha book → Upstox book SUCCEEDS
//   C  MERGE + CA DEDUPE (R1): the 300-not-600 proof — shares CONSERVED across a shared bonus
//   D  MERGE REALIZED DISCLOSURE (R2): the tax number MOVES, and the response SAYS SO
//   E  RESCUE (rule 2): linked → same-broker manual; synthetic buys at broker cost, tagged;
//      account + connection DELETED; ZERO positions dropped; rescued position SELLABLE
//   F  rule-2 guard: linked → WRONG-broker manual → refused, naming the need
//   G  R4 guard: an UNMAPPED broker holding → refused + NAMED, nothing dropped or deleted
//   H  rule 3: transfer INTO a linked account → refused, mirror intact
//   I  no cherry-pick / no partial: a symbol from a broker source, and any quantity → refused
//   J  IDOR: neither source nor destination may be someone else's
//   K  TYPE-INVISIBLE: accountId + broker + symbol are all plain strings. Assert the SPECIFIC
//      values — a transfer to the wrong account is a perfectly valid string
//
//   npx tsx src/scripts/verify-transfer-rescue.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import { integrate, syncHoldings } from "../brokers/lifecycle.js";
import { listUnifiedPositions } from "../brokers/union.js";
import { createAccount, linkAccount, transferHolding, deleteAccount } from "../controllers/me/accounts-controller.js";
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
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `xfer-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { authId, userId: u.id };
}
const cleanup = (a: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);
const DISC = { accepted: true, disclaimerVersion: "v1" };

const mk = async (userId: string, name: string, broker: string) => (await call(createAccount, userId, { body: { name, broker } })).body.data.id as string;
const addTx = (userId: string, body: any) => call(addTransaction, userId, { body });
const xfer = (userId: string, from: string, body: any) => call(transferHolding, userId, { params: { id: from }, body });
const del = (userId: string, id: string, body: any = {}) => call(deleteAccount, userId, { params: { id }, body });
const link = (userId: string, id: string, connectionId: string) => call(linkAccount, userId, { params: { id }, body: { connectionId } });

/** The materialized truth for (account, symbol) — what the FIFO replay actually produced. */
async function pos(accountId: string, symbol: string) {
  const h = await prisma.holding.findFirst({
    where: { accountId, instrument: { symbol } },
    select: { quantity: true, avgCost: true, investedValue: true, realizedPnl: true, lots: { select: { quantity: true, costPerShare: true, buyDate: true }, orderBy: { buyDate: "asc" } } },
  });
  if (!h) return null;
  return {
    qty: h.quantity.toString(), avg: h.avgCost.toString(), invested: h.investedValue.toString(), realized: h.realizedPnl.toString(),
    lots: h.lots.map((l) => `${l.quantity}@${l.costPerShare}/${l.buyDate.toISOString().slice(0, 10)}`),
  };
}
const fingerprint = (p: any) => (p ? `${p.qty}|${p.avg}|${p.invested}|${p.realized}|${p.lots.join(",")}` : "ABSENT");

const created: string[] = [];
try {
  // ═══════════════════════════════════════════════════════════════════════════
  // A — MANUAL → MANUAL: the position moves, the economics do NOT change
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══ A — Manual→manual: FIFO economics byte-identical after the move ═══");
  const U = await seedUser("u"); created.push(U.authId);
  const src = await mk(U.userId, "Zerodha Main", "zerodha");
  const dst = await mk(U.userId, "Zerodha Family", "zerodha");

  // A position with real FIFO history: two lots and a sell (so realized ≠ 0 and avg ≠ price).
  await addTx(U.userId, { symbol: "RELIANCE", type: "buy", quantity: 100, price: 1000, tradeDate: "2024-01-01", accountId: src });
  await addTx(U.userId, { symbol: "RELIANCE", type: "buy", quantity: 50, price: 1200, tradeDate: "2024-03-01", accountId: src });
  await addTx(U.userId, { symbol: "RELIANCE", type: "sell", quantity: 30, price: 1500, tradeDate: "2024-06-01", accountId: src });
  const beforeFp = fingerprint(await pos(src, "RELIANCE"));
  console.log(`     source before: ${beforeFp}`);

  const moved = await xfer(U.userId, src, { toAccountId: dst, symbol: "RELIANCE" });
  assert("transfer → 200", moved.statusCode === 200, `status=${moved.statusCode} ${JSON.stringify(moved.body?.error ?? "")}`);
  const afterFp = fingerprint(await pos(dst, "RELIANCE"));
  console.log(`     dest after:    ${afterFp}`);
  assert("🔒 BYTE-IDENTICAL: qty/avg/invested/realized AND the whole lot register are unchanged",
    afterFp === beforeFp, afterFp === beforeFp ? "identical" : `${beforeFp}  ≠  ${afterFp}`);
  assert("the SOURCE lost the position entirely (no 0-qty husk left asserting realized 0)",
    (await pos(src, "RELIANCE")) === null, `source=${JSON.stringify(await pos(src, "RELIANCE"))}`);
  assert("...and its transactions were RE-PARENTED, not copied (source ledger empty, dest has all 3)",
    (await prisma.transaction.count({ where: { accountId: src } })) === 0 && (await prisma.transaction.count({ where: { accountId: dst } })) === 3,
    `src=${await prisma.transaction.count({ where: { accountId: src } })} dst=${await prisma.transaction.count({ where: { accountId: dst } })}`);
  assert("K/type-invisible: the position landed in EXACTLY the destination account (not 'an account')",
    (await prisma.holding.count({ where: { accountId: dst, instrument: { symbol: "RELIANCE" } } })) === 1, `dst holdings=1`);
  assert("merged=false — the destination held nothing, so no queues were combined",
    moved.body?.data?.merged === false, `merged=${moved.body?.data?.merged}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // B — CROSS-BROKER manual→manual (rule 1: no same-broker restriction)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ B — Manual→manual across DIFFERENT brokers (rule 1) ═══");
  const upstoxBook = await mk(U.userId, "Upstox Book", "upstox");
  const cross = await xfer(U.userId, dst, { toAccountId: upstoxBook, symbol: "RELIANCE" });
  assert("a ZERODHA book's position moves to an UPSTOX book → 200 (a manual ledger is the USER's)",
    cross.statusCode === 200, `status=${cross.statusCode} err=${cross.body?.error}`);
  assert("...and the economics STILL did not move", fingerprint(await pos(upstoxBook, "RELIANCE")) === beforeFp,
    fingerprint(await pos(upstoxBook, "RELIANCE")));
  // Put it back so later sections read cleanly.
  await xfer(U.userId, upstoxBook, { toAccountId: dst, symbol: "RELIANCE" });

  // ═══════════════════════════════════════════════════════════════════════════
  // C — THE MERGE + CORPORATE-ACTION DEDUPE (R1): 300, not 600
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ C — Merge across a SHARED corporate action (R1) ═══");
  const C = await seedUser("c"); created.push(C.authId);
  const cA = await mk(C.userId, "Book A", "zerodha");
  const cB = await mk(C.userId, "Book B", "zerodha");
  // ONE market event (a 1:1 bonus on 2024-05-01), correctly recorded in BOTH books — because each
  // account's FIFO queue only scales its OWN lots, so the user must enter it in each.
  await addTx(C.userId, { symbol: "TCS", type: "buy", quantity: 100, price: 100, tradeDate: "2024-01-01", accountId: cA });
  await addTx(C.userId, { symbol: "TCS", type: "bonus", ratio: "1:1", tradeDate: "2024-05-01", accountId: cA });
  await addTx(C.userId, { symbol: "TCS", type: "buy", quantity: 50, price: 100, tradeDate: "2024-01-01", accountId: cB });
  await addTx(C.userId, { symbol: "TCS", type: "bonus", ratio: "1:1", tradeDate: "2024-05-01", accountId: cB });

  const qA = Number((await pos(cA, "TCS"))!.qty); // 200
  const qB = Number((await pos(cB, "TCS"))!.qty); // 100
  console.log(`     Book A=${qA}  Book B=${qB}  → TRUTH = ${qA + qB}`);

  const mergeRes = await xfer(C.userId, cA, { toAccountId: cB, symbol: "TCS" });
  assert("merge transfer → 200", mergeRes.statusCode === 200, `status=${mergeRes.statusCode} err=${mergeRes.body?.error}`);
  const mergedPos = await pos(cB, "TCS");
  assert("🐛 R1: SHARES CONSERVED — 300, not the 600 a naive ledger-concat would invent",
    Number(mergedPos!.qty) === qA + qB, `merged qty=${mergedPos!.qty} truth=${qA + qB}`);
  assert("...the duplicate corporate action was DEDUPED and the response SAYS which",
    mergeRes.body?.data?.dedupedCorporateActions?.length === 1 &&
    mergeRes.body.data.dedupedCorporateActions[0].type === "bonus" &&
    mergeRes.body.data.dedupedCorporateActions[0].tradeDate === "2024-05-01",
    JSON.stringify(mergeRes.body?.data?.dedupedCorporateActions));
  assert("...ONE merged position, not a duplicate row (the unique key would have rejected it anyway)",
    (await prisma.holding.count({ where: { accountId: cB, instrument: { symbol: "TCS" } } })) === 1, "1 row");
  assert("...and exactly ONE bonus row survives in the merged ledger (one market event, one row)",
    (await prisma.transaction.count({ where: { accountId: cB, type: "bonus" } })) === 1,
    `bonus rows=${await prisma.transaction.count({ where: { accountId: cB, type: "bonus" } })}`);
  assert("merged=true is reported", mergeRes.body?.data?.merged === true, `merged=${mergeRes.body?.data?.merged}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // D — MERGE MOVES REALIZED P&L, AND WE SAY SO (R2)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ D — Merge re-matches a past sell → realized MOVES, and is DISCLOSED (R2) ═══");
  const D = await seedUser("d"); created.push(D.authId);
  const dA = await mk(D.userId, "Old Cheap Lot", "zerodha");
  const dB = await mk(D.userId, "Bought High, Sold", "zerodha");
  // Source: an OLD, CHEAP lot. Destination: bought high, then sold — realized 10,000 today.
  await addTx(D.userId, { symbol: "INFY", type: "buy", quantity: 100, price: 50, tradeDate: "2023-01-01", accountId: dA });
  await addTx(D.userId, { symbol: "INFY", type: "buy", quantity: 100, price: 200, tradeDate: "2024-01-01", accountId: dB });
  await addTx(D.userId, { symbol: "INFY", type: "sell", quantity: 100, price: 300, tradeDate: "2024-06-01", accountId: dB });
  const realizedBefore = (await pos(dB, "INFY"))!.realized;
  console.log(`     destination realized BEFORE = ${realizedBefore}`);

  const r2 = await xfer(D.userId, dA, { toAccountId: dB, symbol: "INFY" });
  const delta = r2.body?.data?.destination?.[0];
  const realizedAfter = (await pos(dB, "INFY"))!.realized;
  console.log(`     destination realized AFTER  = ${realizedAfter}   (the 2024 sell now eats the 2023 @50 lot)`);
  assert("R2: the merge MOVED realized P&L (10000 → 25000) — FIFO re-matched the sell",
    Number(realizedBefore) === 10000 && Number(realizedAfter) === 25000, `${realizedBefore} → ${realizedAfter}`);
  assert("R2 DISCLOSURE: the response reports realizedBefore → realizedAfter (not silently changed)",
    delta?.realizedPnlBefore === "10000" && delta?.realizedPnlAfter === "25000",
    `before=${delta?.realizedPnlBefore} after=${delta?.realizedPnlAfter}`);
  assert("...and quantityBefore → quantityAfter too (0 → 100: the surviving lot is the @200 one)",
    delta?.quantityBefore === "0" && delta?.quantityAfter === "100", `qty ${delta?.quantityBefore} → ${delta?.quantityAfter}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // E — RESCUE (rule 2): linked → same-broker manual, account+connection destroyed
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ E — RESCUE: a linked account transfers out, and is deleted ═══");
  const E = await seedUser("e"); created.push(E.authId);
  const eLinked = await mk(E.userId, "Mock Demat", "mock");
  const eManual = await mk(E.userId, "Mock Manual", "mock"); // SAME broker → the legal destination
  // The mock fixture ships FAKESTOCK (outside our universe) — exclude it here so E tests the happy
  // path; section G proves the guard that FAKESTOCK triggers.
  const eConn = await integrate(E.userId, "mock", { ...DISC, params: {
    mockAccountRef: "DEMAT_E",
    mockHoldings: [
      { tradingsymbol: "RELIANCE", quantity: 10, average_price: 2400.5, last_price: 2950, product: "CNC" },
      { tradingsymbol: "TCS", quantity: 5, average_price: 3200, last_price: 3850, product: "CNC" },
    ],
  } });
  await link(E.userId, eLinked, eConn.id);
  await syncHoldings(E.userId, eConn.id);

  const brokerPositionsBefore = (await listUnifiedPositions(E.userId)).filter((p) => p.source === "broker").length;
  assert("setup: the linked account holds 2 BROKER positions", brokerPositionsBefore === 2, `broker positions=${brokerPositionsBefore}`);

  const unconfirmed = await xfer(E.userId, eLinked, { toAccountId: eManual });
  assert("rescue WITHOUT confirm → 400 confirmation_required (it destroys an account + a token)",
    unconfirmed.statusCode === 400 && unconfirmed.body?.error === "confirmation_required", `status=${unconfirmed.statusCode} err=${unconfirmed.body?.error}`);
  assert("...and it NAMES what it would rescue and destroy",
    unconfirmed.body?.willRescue?.length === 2 && unconfirmed.body?.willDeleteAccount === "Mock Demat", JSON.stringify(unconfirmed.body?.willRescue));
  assert("...nothing happened (the account is still there, still linked)",
    (await prisma.portfolioAccount.count({ where: { id: eLinked } })) === 1, "account intact");

  const rescue = await xfer(E.userId, eLinked, { toAccountId: eManual, confirm: true });
  assert("rescue WITH confirm → 200", rescue.statusCode === 200, `status=${rescue.statusCode} err=${rescue.body?.error} ${rescue.body?.message ?? ""}`);

  // ZERO POSITIONS DROPPED — the whole point.
  const afterPositions = await listUnifiedPositions(E.userId);
  const manualAfter = afterPositions.filter((p) => p.accountId === eManual);
  assert("🔒 ZERO POSITIONS DROPPED: 2 broker positions → 2 MANUAL positions (count before = after)",
    manualAfter.length === 2 && afterPositions.length === 2, `manual=${manualAfter.length} total=${afterPositions.length}`);
  assert("...and NONE of them is a broker position any more (the mirror is gone, the book is ours)",
    afterPositions.every((p) => p.source === "manual"), `sources=${[...new Set(afterPositions.map((p) => p.source))].join(",")}`);

  // R3: the synthetic buy — broker's qty at the broker's cost, dated syncedAt, TAGGED.
  const rel = await pos(eManual, "RELIANCE");
  assert("R3: the rescued position replays to ONE lot at the BROKER's cost (10 @ 2400.5)",
    rel!.qty === "10" && rel!.avg === "2400.5" && rel!.lots.length === 1, `qty=${rel!.qty} avg=${rel!.avg} lots=${JSON.stringify(rel!.lots)}`);
  assert("R3: realized starts at 0 — we do not invent a P&L the broker never gave us",
    rel!.realized === "0", `realized=${rel!.realized}`);
  const synth = await prisma.transaction.findFirstOrThrow({ where: { accountId: eManual, stock: { symbol: "RELIANCE" } }, select: { type: true, notes: true, tradeDate: true, price: true } });
  assert("R3: the synthetic row is TAGGED [rescue:mock:DEMAT_E] — never mistakable for a real trade",
    (synth.notes ?? "").includes("[rescue:mock:DEMAT_E]"), `notes=${synth.notes}`);
  assert("R3: ...and dated the snapshot's syncedAt (the fabricated date, disclosed in the response)",
    rescue.body?.data?.rescued?.[0]?.tradeDate === synth.tradeDate.toISOString().slice(0, 10),
    `tradeDate=${synth.tradeDate.toISOString().slice(0, 10)} reported=${rescue.body?.data?.rescued?.[0]?.tradeDate}`);

  // THE ACCOUNT AND ITS CONNECTION ARE GONE (and the token with them).
  assert("the linked account is DELETED", (await prisma.portfolioAccount.count({ where: { id: eLinked } })) === 0, "gone");
  assert("the CONNECTION is deleted too (else its broker_holdings orphan — invisible but present)",
    (await prisma.brokerConnection.count({ where: { id: eConn.id } })) === 0, "connection gone (token forgotten)");
  assert("...and its broker_holdings cascaded away (no orphan rows left behind)",
    (await prisma.brokerHolding.count({ where: { userId: E.userId } })) === 0, "0 broker_holdings");

  // THE REAL TEST OF R3: is the rescued position actually USABLE? A ledger-less holding would
  // OversellError here (available 0) — this is the proof that the synthetic buy was necessary.
  const sell = await addTx(E.userId, { symbol: "RELIANCE", type: "sell", quantity: 10, price: 2900, tradeDate: "2026-07-13", accountId: eManual });
  assert("🔒 THE RESCUED POSITION IS SELLABLE (a ledger-less holding would have OVERSOLD at 0)",
    sell.statusCode === 201, `status=${sell.statusCode} err=${sell.body?.error} ${sell.body?.message ?? ""}`);
  const sold = await pos(eManual, "RELIANCE");
  assert("...and FIFO computed off the broker cost basis: realized = 10 × (2900 − 2400.5) = 4995",
    sold!.qty === "0" && Number(sold!.realized) === 4995, `qty=${sold!.qty} realized=${sold!.realized}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // F — rule-2 guard: WRONG-broker destination
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ F — Rescue into the WRONG broker's book (rule 2 guard) ═══");
  const F = await seedUser("f"); created.push(F.authId);
  const fLinked = await mk(F.userId, "Mock Demat", "mock");
  const fWrong = await mk(F.userId, "Upstox Manual", "upstox"); // a DIFFERENT broker
  const fConn = await integrate(F.userId, "mock", { ...DISC, params: {
    mockAccountRef: "DEMAT_F",
    mockHoldings: [{ tradingsymbol: "INFY", quantity: 7, average_price: 1400, last_price: 1600, product: "CNC" }],
  } });
  await link(F.userId, fLinked, fConn.id);
  await syncHoldings(F.userId, fConn.id);

  const wrongBroker = await xfer(F.userId, fLinked, { toAccountId: fWrong, confirm: true });
  assert("F/K: a MOCK linked account → an UPSTOX manual account → 400 broker_mismatch",
    wrongBroker.statusCode === 400 && wrongBroker.body?.error === "broker_mismatch", `status=${wrongBroker.statusCode} err=${wrongBroker.body?.error}`);
  assert("...and the message NAMES the need (create a same-broker manual account first)",
    /mock/i.test(wrongBroker.body?.message ?? "") && /upstox/i.test(wrongBroker.body?.message ?? ""), `msg="${wrongBroker.body?.message}"`);
  assert("K/type-invisible: it reports the SPECIFIC brokers, not merely 'a mismatch'",
    wrongBroker.body?.sourceBroker === "mock" && wrongBroker.body?.destinationBroker === "upstox",
    `source=${wrongBroker.body?.sourceBroker} dest=${wrongBroker.body?.destinationBroker}`);
  assert("...NOTHING moved and the linked account is INTACT (still bound, still holding its mirror)",
    (await prisma.portfolioAccount.count({ where: { id: fLinked, brokerConnectionId: fConn.id } })) === 1 &&
    (await prisma.brokerHolding.count({ where: { brokerConnectionId: fConn.id } })) === 1 &&
    (await prisma.transaction.count({ where: { accountId: fWrong } })) === 0,
    "account bound, 1 broker holding, 0 txns written to the wrong book");

  // ═══════════════════════════════════════════════════════════════════════════
  // G — R4: an UNMAPPED broker holding blocks the rescue, BY NAME
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ G — R4: an unmapped (null stock_id) holding → refuse + NAME it ═══");
  const G = await seedUser("g"); created.push(G.authId);
  const gLinked = await mk(G.userId, "Mock Demat", "mock");
  const gManual = await mk(G.userId, "Mock Manual", "mock");
  const gConn = await integrate(G.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_G" } }); // default fixture → includes FAKESTOCK
  await link(G.userId, gLinked, gConn.id);
  const sync = await syncHoldings(G.userId, gConn.id);
  assert("setup: the snapshot contains an UNMAPPED symbol (outside our universe)",
    sync.unmapped.includes("FAKESTOCK"), `unmapped=${JSON.stringify(sync.unmapped)}`);

  const blocked = await xfer(G.userId, gLinked, { toAccountId: gManual, confirm: true });
  assert("R4: rescue → 409 unrescuable_holdings (NOT a partial rescue that drops it)",
    blocked.statusCode === 409 && blocked.body?.error === "unrescuable_holdings", `status=${blocked.statusCode} err=${blocked.body?.error}`);
  assert("R4: it NAMES the symbol it cannot express (FAKESTOCK)",
    Array.isArray(blocked.body?.symbols) && blocked.body.symbols.includes("FAKESTOCK"), `symbols=${JSON.stringify(blocked.body?.symbols)}`);
  assert("🔒 R4: NOTHING was dropped — account, connection, all 4 broker holdings intact; 0 written",
    (await prisma.portfolioAccount.count({ where: { id: gLinked } })) === 1 &&
    (await prisma.brokerConnection.count({ where: { id: gConn.id } })) === 1 &&
    (await prisma.brokerHolding.count({ where: { brokerConnectionId: gConn.id } })) === 4 &&
    (await prisma.transaction.count({ where: { accountId: gManual } })) === 0,
    "account + connection + 4 holdings intact, 0 synthetic buys written");

  // ═══════════════════════════════════════════════════════════════════════════
  // H — rule 3: nothing is EVER written into a linked account
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ H — Transfer INTO a linked account (rule 3: the mirror wall) ═══");
  const intoLinked = await xfer(G.userId, gManual, { toAccountId: gLinked, symbol: "RELIANCE" });
  assert("transfer INTO a linked account → 409 destination_linked (same wall as manual entry)",
    intoLinked.statusCode === 409 && intoLinked.body?.error === "destination_linked", `status=${intoLinked.statusCode} err=${intoLinked.body?.error}`);
  assert("🔒 MIRROR INTACT: the linked account still has ZERO manual transactions/holdings",
    (await prisma.transaction.count({ where: { accountId: gLinked } })) === 0 &&
    (await prisma.holding.count({ where: { accountId: gLinked } })) === 0, "0 manual rows");

  // ═══════════════════════════════════════════════════════════════════════════
  // I — no cherry-pick, no partial
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ I — No cherry-pick out of a broker book; no partial transfers ═══");
  const cherry = await xfer(G.userId, gLinked, { toAccountId: gManual, symbol: "RELIANCE", confirm: true });
  assert("naming a SYMBOL on a broker source → 400 no_cherry_pick (the account is destroyed — all or nothing)",
    cherry.statusCode === 400 && cherry.body?.error === "no_cherry_pick", `status=${cherry.statusCode} err=${cherry.body?.error}`);
  const partial = await xfer(U.userId, dst, { toAccountId: src, symbol: "RELIANCE", quantity: 50 });
  assert("a QUANTITY on a manual transfer → 400 partial_transfer_unsupported (refused BY NAME, not ignored)",
    partial.statusCode === 400 && partial.body?.error === "partial_transfer_unsupported", `status=${partial.statusCode} err=${partial.body?.error}`);
  assert("...and the partial attempt moved NOTHING (the position is still whole, in its account)",
    fingerprint(await pos(dst, "RELIANCE")) === beforeFp, fingerprint(await pos(dst, "RELIANCE")));
  const noSymbol = await xfer(U.userId, dst, { toAccountId: src });
  assert("a MANUAL source with no symbol → 400 symbol_required (we never move a whole manual book by guess)",
    noSymbol.statusCode === 400 && noSymbol.body?.error === "symbol_required", `status=${noSymbol.statusCode} err=${noSymbol.body?.error}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // J — IDOR: BOTH accounts must be the token user's
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ J — IDOR: both source AND destination are owner-scoped ═══");
  const V = await seedUser("v"); created.push(V.authId);
  const vBook = await mk(V.userId, "V Book", "zerodha");

  const steal = await xfer(V.userId, dst, { toAccountId: vBook, symbol: "RELIANCE" }); // V pulls FROM U
  assert("V cannot transfer OUT of U's account → 404 source_not_found (no existence disclosure)",
    steal.statusCode === 404 && steal.body?.error === "source_not_found", `status=${steal.statusCode} err=${steal.body?.error}`);
  const push = await xfer(U.userId, dst, { toAccountId: vBook, symbol: "RELIANCE" }); // U pushes INTO V
  assert("U cannot transfer INTO V's account → 404 destination_not_found",
    push.statusCode === 404 && push.body?.error === "destination_not_found", `status=${push.statusCode} err=${push.body?.error}`);
  assert("🔒 NO CROSS-USER MOVE: U's position is untouched, V's book is still empty",
    fingerprint(await pos(dst, "RELIANCE")) === beforeFp && (await prisma.transaction.count({ where: { accountId: vBook } })) === 0,
    `U intact=${fingerprint(await pos(dst, "RELIANCE")) === beforeFp} V txns=${await prisma.transaction.count({ where: { accountId: vBook } })}`);
  const idorDel = await del(V.userId, gLinked, { rescueToAccountId: vBook, confirm: true });
  assert("V cannot rescue-delete G's linked account → 404", idorDel.statusCode === 404, `status=${idorDel.statusCode}`);
  const sameAcct = await xfer(U.userId, dst, { toAccountId: dst, symbol: "RELIANCE" });
  assert("transferring an account into ITSELF → 400 same_account (a no-op that would still replay)",
    sameAcct.statusCode === 400 && sameAcct.body?.error === "same_account", `status=${sameAcct.statusCode}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // K — the SECOND door: DELETE with rescueToAccountId (same core)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ K — rescue-on-DELETE: the same core, through the delete verb ═══");
  const H = await seedUser("h"); created.push(H.authId);
  const hLinked = await mk(H.userId, "Mock Demat", "mock");
  const hManual = await mk(H.userId, "Mock Manual", "mock");
  const hConn = await integrate(H.userId, "mock", { ...DISC, params: {
    mockAccountRef: "DEMAT_H",
    mockHoldings: [{ tradingsymbol: "ITC", quantity: 40, average_price: 400, last_price: 450, product: "CNC" }],
  } });
  await link(H.userId, hLinked, hConn.id);
  await syncHoldings(H.userId, hConn.id);

  const plainDel = await del(H.userId, hLinked, { confirm: true });
  assert("DELETE a bound account with NO destination → still 409 (deleting it would destroy positions)",
    plainDel.statusCode === 409 && plainDel.body?.error === "account_linked", `status=${plainDel.statusCode} err=${plainDel.body?.error}`);
  assert("...and the refusal now NAMES the way out (rescueToAccountId)",
    /rescueToAccountId/.test(plainDel.body?.message ?? ""), `msg="${plainDel.body?.message}"`);

  const rescueDel = await del(H.userId, hLinked, { rescueToAccountId: hManual, confirm: true });
  assert("DELETE with rescueToAccountId → 200, positions preserved as manual", rescueDel.statusCode === 200, `status=${rescueDel.statusCode} err=${rescueDel.body?.error}`);
  const itc = await pos(hManual, "ITC");
  assert("...the ITC position survived the delete, at the broker's cost (40 @ 400)",
    itc?.qty === "40" && itc?.avg === "400", `qty=${itc?.qty} avg=${itc?.avg}`);
  assert("...and the account + connection are gone",
    (await prisma.portfolioAccount.count({ where: { id: hLinked } })) === 0 &&
    (await prisma.brokerConnection.count({ where: { id: hConn.id } })) === 0, "both gone");

  console.log(`\n${failures === 0 ? "✅ ALL TRANSFER + RESCUE CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
} finally {
  for (const a of created) await cleanup(a);
  await prisma.$disconnect();
}
process.exit(failures === 0 ? 0 : 1);
