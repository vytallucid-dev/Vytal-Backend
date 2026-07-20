// ─────────────────────────────────────────────────────────────────────────────
// WHOLE-ACCOUNT TRANSFER HARNESS (Stage 2 / transfer-all) — the BATCHED rewrite.
//
// Proves transferAllManualPositions moves EVERY position atomically and byte-identically,
// after it was rewritten from a per-instrument loop (~10 round-trips × N) to a SET-BASED
// path (a fixed handful of statements + an in-memory replayFifo per instrument). The
// economic claims are the same as the single-position path; only the round-trip count changed.
//
//   A  MULTI-INSTRUMENT MOVE (deleteSource=true): every position — including a fully-EXITED
//      (qty 0) one — moves byte-identically; source deleted; all txns re-parented, none stranded
//   B  deleteSource=false: the emptied source is KEPT (0 txns, 0 holdings); sourceKept=true
//   C  MERGE + CA DEDUPE (R1) across the whole account: shares CONSERVED (300 not 600), and a
//      FRESH instrument in the same move is unaffected
//   D  MERGE REALIZED DISCLOSURE (R2): the per-instrument delta reports realizedBefore→After
//   E  empty source → 400 nothing_to_transfer (no silent no-op)
//   F  guards: source linked → 409 source_linked; destination linked → 409 destination_linked
//   G  SCALE — "any number of holdings": N distinct instruments move in ONE transaction, all
//      correct, well inside the window. This is the whole point of the rewrite.
//
//   npx tsx src/scripts/verify-transfer-all.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { integrate, syncHoldings } from "../brokers/lifecycle.js";
import { createAccount, linkAccount, transferAllHoldings } from "../controllers/me/accounts-controller.js";
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
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `xferall-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { authId, userId: u.id };
}
const cleanup = (a: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);
const DISC = { accepted: true, disclaimerVersion: "v1" };

const mk = async (userId: string, name: string, broker: string) => (await call(createAccount, userId, { body: { name, broker } })).body.data.id as string;
const addTx = (userId: string, body: any) => call(addTransaction, userId, { body });
const xferAll = (userId: string, from: string, body: any) => call(transferAllHoldings, userId, { params: { id: from }, body });
const link = (userId: string, id: string, connectionId: string) => call(linkAccount, userId, { params: { id }, body: { connectionId } });

/** The materialized truth for (account, symbol). */
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
  // A — MULTI-INSTRUMENT WHOLE-ACCOUNT MOVE, deleteSource=true
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══ A — Whole account (3 instruments incl. an exited one) moves byte-identically ═══");
  const A = await seedUser("a"); created.push(A.authId);
  const src = await mk(A.userId, "Zerodha Main", "zerodha");
  const dst = await mk(A.userId, "Zerodha Family", "zerodha");

  // RELIANCE: two lots + a sell (realized ≠ 0, avg ≠ price). TCS: simple. INFY: fully EXITED (qty 0,
  // realized only) — its history must move too, or the source can't be deleted with nothing stranded.
  await addTx(A.userId, { symbol: "RELIANCE", type: "buy", quantity: 100, price: 1000, tradeDate: "2024-01-01", accountId: src });
  await addTx(A.userId, { symbol: "RELIANCE", type: "buy", quantity: 50, price: 1200, tradeDate: "2024-03-01", accountId: src });
  await addTx(A.userId, { symbol: "RELIANCE", type: "sell", quantity: 30, price: 1500, tradeDate: "2024-06-01", accountId: src });
  await addTx(A.userId, { symbol: "TCS", type: "buy", quantity: 10, price: 3000, tradeDate: "2024-02-01", accountId: src });
  await addTx(A.userId, { symbol: "INFY", type: "buy", quantity: 20, price: 100, tradeDate: "2024-01-01", accountId: src });
  await addTx(A.userId, { symbol: "INFY", type: "sell", quantity: 20, price: 150, tradeDate: "2024-05-01", accountId: src });

  const fpRel = fingerprint(await pos(src, "RELIANCE"));
  const fpTcs = fingerprint(await pos(src, "TCS"));
  const fpInfy = fingerprint(await pos(src, "INFY")); // qty 0, realized 1000
  const srcTxnCount = await prisma.transaction.count({ where: { accountId: src } }); // 6

  const res = await xferAll(A.userId, src, { toAccountId: dst, deleteSource: true });
  assert("transfer-all → 200", res.statusCode === 200, `status=${res.statusCode} ${JSON.stringify(res.body?.error ?? "")}`);
  assert("🔒 RELIANCE byte-identical on the destination", fingerprint(await pos(dst, "RELIANCE")) === fpRel, `${fpRel} vs ${fingerprint(await pos(dst, "RELIANCE"))}`);
  assert("🔒 TCS byte-identical on the destination", fingerprint(await pos(dst, "TCS")) === fpTcs, `${fpTcs} vs ${fingerprint(await pos(dst, "TCS"))}`);
  assert("🔒 the EXITED INFY position moved too (qty 0, realized 1000 preserved — not stranded)",
    fingerprint(await pos(dst, "INFY")) === fpInfy && Number((await pos(dst, "INFY"))!.realized) === 1000, `${fpInfy} vs ${fingerprint(await pos(dst, "INFY"))}`);
  assert("all transactions RE-PARENTED (source ledger empty, dest has all of them)",
    (await prisma.transaction.count({ where: { accountId: dst } })) === srcTxnCount, `dst txns=${await prisma.transaction.count({ where: { accountId: dst } })} expected=${srcTxnCount}`);
  assert("the SOURCE account was DELETED (deleteSource=true)", (await prisma.portfolioAccount.count({ where: { id: src } })) === 0, "gone");
  assert("response: 3 destination deltas, merged=false, deletedAccount named, sourceKept=false",
    res.body?.data?.destination?.length === 3 && res.body?.data?.merged === false && res.body?.data?.deletedAccount?.id === src && res.body?.data?.sourceKept === false,
    `deltas=${res.body?.data?.destination?.length} merged=${res.body?.data?.merged} sourceKept=${res.body?.data?.sourceKept}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // B — deleteSource=false: the emptied source is KEPT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ B — deleteSource=false keeps the emptied source account ═══");
  const B = await seedUser("b"); created.push(B.authId);
  const bSrc = await mk(B.userId, "Src", "zerodha");
  const bDst = await mk(B.userId, "Dst", "zerodha");
  await addTx(B.userId, { symbol: "RELIANCE", type: "buy", quantity: 5, price: 1000, tradeDate: "2024-01-01", accountId: bSrc });
  await addTx(B.userId, { symbol: "TCS", type: "buy", quantity: 5, price: 3000, tradeDate: "2024-01-01", accountId: bSrc });
  const bRes = await xferAll(B.userId, bSrc, { toAccountId: bDst, deleteSource: false });
  assert("transfer-all (keep source) → 200", bRes.statusCode === 200, `status=${bRes.statusCode} err=${bRes.body?.error}`);
  assert("the source account STILL EXISTS but is empty (0 txns, 0 holdings)",
    (await prisma.portfolioAccount.count({ where: { id: bSrc } })) === 1 &&
    (await prisma.transaction.count({ where: { accountId: bSrc } })) === 0 &&
    (await prisma.holding.count({ where: { accountId: bSrc } })) === 0, "kept + emptied");
  assert("sourceKept=true, no deletedAccount", bRes.body?.data?.sourceKept === true && !bRes.body?.data?.deletedAccount, `sourceKept=${bRes.body?.data?.sourceKept}`);
  assert("both positions landed on the destination", (await prisma.holding.count({ where: { accountId: bDst } })) === 2, `dst holdings=${await prisma.holding.count({ where: { accountId: bDst } })}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // C — MERGE + CORPORATE-ACTION DEDUPE (R1) across the whole account
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ C — Whole-account merge over a SHARED corporate action (R1): 300, not 600 ═══");
  const C = await seedUser("c"); created.push(C.authId);
  const cA = await mk(C.userId, "Book A", "zerodha");
  const cB = await mk(C.userId, "Book B", "zerodha");
  // TCS is held in BOTH books with the SAME 1:1 bonus (one market event, recorded per account).
  await addTx(C.userId, { symbol: "TCS", type: "buy", quantity: 100, price: 100, tradeDate: "2024-01-01", accountId: cA });
  await addTx(C.userId, { symbol: "TCS", type: "bonus", ratio: "1:1", tradeDate: "2024-05-01", accountId: cA });
  await addTx(C.userId, { symbol: "TCS", type: "buy", quantity: 50, price: 100, tradeDate: "2024-01-01", accountId: cB });
  await addTx(C.userId, { symbol: "TCS", type: "bonus", ratio: "1:1", tradeDate: "2024-05-01", accountId: cB });
  // RELIANCE is ONLY in A (a fresh instrument, no merge) — proves the two cases coexist in one move.
  await addTx(C.userId, { symbol: "RELIANCE", type: "buy", quantity: 7, price: 1000, tradeDate: "2024-02-01", accountId: cA });

  const qA = Number((await pos(cA, "TCS"))!.qty); // 200
  const qB = Number((await pos(cB, "TCS"))!.qty); // 100
  const mres = await xferAll(C.userId, cA, { toAccountId: cB, deleteSource: true });
  assert("merge transfer-all → 200", mres.statusCode === 200, `status=${mres.statusCode} err=${mres.body?.error}`);
  assert("🐛 R1: TCS shares CONSERVED — 300, not the 600 a naive concat invents",
    Number((await pos(cB, "TCS"))!.qty) === qA + qB, `merged=${(await pos(cB, "TCS"))!.qty} truth=${qA + qB}`);
  assert("...exactly ONE bonus row survives (one market event, one row)",
    (await prisma.transaction.count({ where: { accountId: cB, type: "bonus" } })) === 1, `bonus rows=${await prisma.transaction.count({ where: { accountId: cB, type: "bonus" } })}`);
  assert("...the dedupe is REPORTED (TCS bonus 2024-05-01)",
    mres.body?.data?.dedupedCorporateActions?.some((d: any) => d.type === "bonus" && d.tradeDate === "2024-05-01"), JSON.stringify(mres.body?.data?.dedupedCorporateActions));
  assert("...the FRESH instrument (RELIANCE, only in A) moved untouched", (await pos(cB, "RELIANCE"))!.qty === "7", `reliance=${(await pos(cB, "RELIANCE"))!.qty}`);
  assert("merged=true reported", mres.body?.data?.merged === true, `merged=${mres.body?.data?.merged}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // D — MERGE MOVES REALIZED P&L, AND THE DELTA SAYS SO (R2)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ D — Whole-account merge re-matches a past sell → realized MOVES, disclosed (R2) ═══");
  const D = await seedUser("d"); created.push(D.authId);
  const dA = await mk(D.userId, "Old Cheap Lot", "zerodha");
  const dB = await mk(D.userId, "Bought High, Sold", "zerodha");
  await addTx(D.userId, { symbol: "INFY", type: "buy", quantity: 100, price: 50, tradeDate: "2023-01-01", accountId: dA });
  await addTx(D.userId, { symbol: "INFY", type: "buy", quantity: 100, price: 200, tradeDate: "2024-01-01", accountId: dB });
  await addTx(D.userId, { symbol: "INFY", type: "sell", quantity: 100, price: 300, tradeDate: "2024-06-01", accountId: dB });
  const dres = await xferAll(D.userId, dA, { toAccountId: dB, deleteSource: true });
  const infyDelta = dres.body?.data?.destination?.find((x: any) => x.realizedPnlBefore !== undefined);
  assert("R2: destination realized MOVED 10000 → 25000 (FIFO re-matched the 2024 sell onto the 2023 @50 lot)",
    Number((await pos(dB, "INFY"))!.realized) === 25000, `realized=${(await pos(dB, "INFY"))!.realized}`);
  assert("R2 DISCLOSURE: the delta reports realizedBefore=10000 → realizedAfter=25000, qty 0 → 100",
    infyDelta?.realizedPnlBefore === "10000" && infyDelta?.realizedPnlAfter === "25000" && infyDelta?.quantityBefore === "0" && infyDelta?.quantityAfter === "100",
    `before=${infyDelta?.realizedPnlBefore} after=${infyDelta?.realizedPnlAfter} qty ${infyDelta?.quantityBefore}→${infyDelta?.quantityAfter}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // E — empty source
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ E — An empty source has nothing to move ═══");
  const E = await seedUser("e"); created.push(E.authId);
  const eSrc = await mk(E.userId, "Empty", "zerodha");
  const eDst = await mk(E.userId, "Dst", "zerodha");
  const eres = await xferAll(E.userId, eSrc, { toAccountId: eDst, deleteSource: true });
  assert("empty source → 400 nothing_to_transfer (not a silent no-op)", eres.statusCode === 400 && eres.body?.error === "nothing_to_transfer", `status=${eres.statusCode} err=${eres.body?.error}`);
  assert("...and the empty source was NOT deleted (refused, nothing happened)", (await prisma.portfolioAccount.count({ where: { id: eSrc } })) === 1, "intact");

  // ═══════════════════════════════════════════════════════════════════════════
  // F — guards: a linked account cannot be source OR destination of a manual→manual move
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ F — Linked accounts are refused (source_linked / destination_linked) ═══");
  const F = await seedUser("f"); created.push(F.authId);
  const fLinked = await mk(F.userId, "Mock Demat", "mock");
  const fManual = await mk(F.userId, "Mock Manual", "mock");
  const fConn = await integrate(F.userId, "mock", { ...DISC, params: {
    mockAccountRef: "DEMAT_F",
    mockHoldings: [{ tradingsymbol: "RELIANCE", quantity: 3, average_price: 1000, last_price: 1100, product: "CNC" }],
  } });
  await link(F.userId, fLinked, fConn.id);
  await syncHoldings(F.userId, fConn.id);
  await addTx(F.userId, { symbol: "TCS", type: "buy", quantity: 2, price: 3000, tradeDate: "2024-01-01", accountId: fManual });

  const srcLinked = await xferAll(F.userId, fLinked, { toAccountId: fManual, deleteSource: false });
  assert("a LINKED source → 409 source_linked (its exit is rescue, a different door)",
    srcLinked.statusCode === 409 && srcLinked.body?.error === "source_linked", `status=${srcLinked.statusCode} err=${srcLinked.body?.error}`);
  const dstLinked = await xferAll(F.userId, fManual, { toAccountId: fLinked, deleteSource: false });
  assert("a LINKED destination → 409 destination_linked (the mirror wall)",
    dstLinked.statusCode === 409 && dstLinked.body?.error === "destination_linked", `status=${dstLinked.statusCode} err=${dstLinked.body?.error}`);
  assert("🔒 nothing moved: the linked account still holds only its broker mirror, no manual rows",
    (await prisma.transaction.count({ where: { accountId: fLinked } })) === 0, "0 manual txns on the linked account");

  // ═══════════════════════════════════════════════════════════════════════════
  // G — SCALE: "any number of holdings" — N instruments in ONE atomic transaction
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ G — SCALE: many instruments move in ONE transaction, correct + fast ═══");
  const G = await seedUser("g"); created.push(G.authId);
  const gSrc = await mk(G.userId, "Big Book", "zerodha");
  const gDst = await mk(G.userId, "Big Family", "zerodha");
  // Seed the source book DIRECTLY (bulk inserts of single qty-1@100 buys), bypassing the per-add PHS
  // refresh addTransaction runs — that refresh is O(portfolio), so an N-add setup would be O(N²) of
  // HARNESS time. This section proves CORRECTNESS at scale; timing/attribution is verify-transfer-scale.ts.
  const TARGET = 100;
  const picks = await prisma.instrument.findMany({
    where: { assetClass: "stock", symbol: { not: null } },
    select: { id: true, stockId: true }, orderBy: { id: "asc" }, take: TARGET,
  });
  const D1 = new Prisma.Decimal(1), D100 = new Prisma.Decimal(100), D0 = new Prisma.Decimal(0), day = new Date("2024-01-01");
  const gTxns = picks.map((p) => ({ id: randomUUID(), userId: G.userId, accountId: gSrc, instrumentId: p.id, stockId: p.stockId, type: "buy" as const, quantity: D1, price: D100, fees: D0, tradeDate: day }));
  const gHold = picks.map((p) => ({ id: randomUUID(), userId: G.userId, accountId: gSrc, instrumentId: p.id, stockId: p.stockId, quantity: D1, avgCost: D100, investedValue: D100, realizedPnl: D0, lastComputedAt: day }));
  const gLots = picks.map((p, i) => ({ holdingId: gHold[i].id, quantity: D1, costPerShare: D100, buyDate: day, sourceTxnId: gTxns[i].id }));
  await prisma.transaction.createMany({ data: gTxns });
  await prisma.holding.createMany({ data: gHold });
  await prisma.holdingLot.createMany({ data: gLots });
  const used = picks; // every seeded instrument is distinct — only .length is used below
  console.log(`     seeded ${used.length} distinct instruments on the source (holdings=${await prisma.holding.count({ where: { accountId: gSrc } })})`);

  const gres = await xferAll(G.userId, gSrc, { toAccountId: gDst, deleteSource: true });
  assert(`transfer-all of ${used.length} instruments → 200 (atomic; a 200 proves it fit the 30s window)`, gres.statusCode === 200, `status=${gres.statusCode} err=${gres.body?.error} ${gres.body?.message ?? ""}`);
  assert(`🔒 ALL ${used.length} positions landed on the destination`,
    (await prisma.holding.count({ where: { accountId: gDst } })) === used.length, `dst holdings=${await prisma.holding.count({ where: { accountId: gDst } })} expected=${used.length}`);
  assert("...every lot moved too (one lot per instrument here)",
    (await prisma.holdingLot.count({ where: { holding: { accountId: gDst } } })) === used.length, `dst lots=${await prisma.holdingLot.count({ where: { holding: { accountId: gDst } } })}`);
  assert("...the source is empty and deleted", (await prisma.portfolioAccount.count({ where: { id: gSrc } })) === 0, "gone");
  assert(`response reports all ${used.length} deltas`, gres.body?.data?.destination?.length === used.length, `deltas=${gres.body?.data?.destination?.length}`);

  console.log(`\n${failures === 0 ? "✅ ALL WHOLE-ACCOUNT TRANSFER CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
} finally {
  for (const a of created) await cleanup(a);
  await prisma.$disconnect();
}
process.exit(failures === 0 ? 0 : 1);
