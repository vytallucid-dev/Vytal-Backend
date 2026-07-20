// ─────────────────────────────────────────────────────────────────────────────
// HOLDINGS-UNION HARNESS (Step 5) — GET /me/holdings now reads the UNION.
//
// The whole step is one discipline: null ≠ 0.
//   A manual row's realizedPnl "0" is a FACT we computed ("nothing was realized").
//   A broker row's realizedPnl null is the ABSENCE of a fact ("we do not know").
// Both inhabit the same TypeScript field, so tsc cannot tell them apart — only an explicit
// `=== null` assertion can. Every null check below is deliberately identity, never truthiness:
// `!x` would pass for 0, "" and null alike and would prove exactly nothing.
//
//   npx tsx src/scripts/verify-holdings-union.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import type { BrokerId } from "../brokers/types.js";
import { integrate, syncHoldings, deactivate } from "../brokers/lifecycle.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";
import { linkAccount, createAccount } from "../controllers/me/accounts-controller.js";
import { addTransaction } from "../controllers/me/transactions-controller.js";

let failures = 0;
const assert = (name: string, cond: boolean, detail: string) => {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
};
const mockRes = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const mockReq = (userId: string, o: any = {}) => ({ authUser: { userId }, body: o.body ?? {}, params: o.params ?? {}, query: o.query ?? {} }) as any;
const call = async (fn: any, userId: string, o: any = {}) => { const r = mockRes(); await fn(mockReq(userId, o), r); return r; };

async function seedUser(tag: string) {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `hld-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { authId, userId: u.id };
}
const cleanup = (a: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);
const DISC = { accepted: true, disclaimerVersion: "v1" };

const addTx = (userId: string, body: any) => call(addTransaction, userId, { body });
// Step 5.5: every account belongs to a broker, from creation. A book destined for a MOCK
// connection is tagged `mock` — link now CHECKS account.broker === connection.broker.
const mkAccount = async (userId: string, name: string, broker: BrokerId) =>
  (await call(createAccount, userId, { body: { name, broker } })).body.data.id as string;
const link = (userId: string, accountId: string, connectionId: string) => call(linkAccount, userId, { params: { id: accountId }, body: { connectionId } });
const holdings = async (userId: string, query: any = {}) => (await call(listHoldings, userId, { query })).body.data;
const priceOf = async (sym: string) => Number((await prisma.stockPrice.findFirstOrThrow({ where: { stock: { symbol: sym } }, select: { price: true } })).price);

const created: string[] = [];
try {
  // ── Setup: a genuinely MIXED book ────────────────────────────────────────────────────────
  //   manual : TCS 10 @3000 (realized 0) · INFY bought 20 @500, sold 10 @700 (realized 2000)
  //   broker : RELIANCE 10 · TCS 5 · INFY 20 · FAKESTOCK 3 (FAKESTOCK is outside our universe)
  // TCS and INFY are held on BOTH sides — so the per-account lines must NOT collapse.
  const U = await seedUser("u"); created.push(U.authId);
  const uMain = await mkAccount(U.userId, "My Holdings", "zerodha"); // created explicitly (no auto-create since 5.5)
  await addTx(U.userId, { symbol: "TCS", type: "buy", quantity: 10, price: 3000, tradeDate: "2024-01-01", accountId: uMain });
  await addTx(U.userId, { symbol: "INFY", type: "buy", quantity: 20, price: 500, tradeDate: "2024-01-02", accountId: uMain });
  await addTx(U.userId, { symbol: "INFY", type: "sell", quantity: 10, price: 700, tradeDate: "2024-03-01", accountId: uMain }); // FIFO realized 2000
  const brokerAcct = await mkAccount(U.userId, "Zerodha Demat", "mock");
  const conn = await integrate(U.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_U" } });
  await link(U.userId, brokerAcct, conn.id);
  await syncHoldings(U.userId, conn.id);

  const d = await holdings(U.userId);
  const manualTcs = d.holdings.find((h: any) => h.symbol === "TCS" && h.source === "manual");
  const brokerTcs = d.holdings.find((h: any) => h.symbol === "TCS" && h.source === "broker");
  const brokerRel = d.holdings.find((h: any) => h.symbol === "RELIANCE");
  const fake = d.holdings.find((h: any) => h.symbol === "FAKESTOCK");

  // ═══ A — broker rows finally APPEAR ═══
  console.log("═══ A — Broker positions appear on /me/holdings (they were invisible before) ═══");
  assert("the book now shows BOTH sides (2 manual + 4 broker = 6 lines)",
    d.holdings.length === 6 && d.holdings.filter((h: any) => h.source === "broker").length === 4,
    `total=${d.holdings.length} broker=${d.holdings.filter((h: any) => h.source === "broker").length}`);
  assert("broker rows are tagged source=broker + carry their account identity",
    brokerRel?.source === "broker" && brokerRel?.accountId === brokerAcct && brokerRel?.accountName === "Zerodha Demat",
    `source=${brokerRel?.source} account=${brokerRel?.accountName}`);
  assert("the SAME stock held both ways stays TWO lines (per-account, never collapsed)",
    !!manualTcs && !!brokerTcs && manualTcs.accountId !== brokerTcs.accountId,
    `manualTCS=${manualTcs?.quantity} brokerTCS=${brokerTcs?.quantity}`);
  const relPrice = await priceOf("RELIANCE");
  assert("broker row is valued with OUR price × qty (§2.4 — not the broker's number)",
    Math.abs(brokerRel.marketValue - 10 * relPrice) < 0.01, `mv=${brokerRel.marketValue.toFixed(2)} = 10 × ${relPrice}`);

  // ═══ B — HONEST NULLS (the type-invisible trap: 0 and null both type-check) ═══
  //
  // ══ WHAT STEP 17 CHANGED HERE, AND WHAT IT DELIBERATELY DID NOT ══
  // This block used to assert that a broker row had NO COST BASIS: investedValue null, and therefore
  // unrealizedPnl null. That was a claim about the FEED ("the snapshot carries no invested figure")
  // mistaken for a claim about the ARITHMETIC. quantity and avgCost are both NOT NULL on every
  // broker holding, and their product IS the invested amount — the same definition the manual side
  // uses (Σ open-lot qty × cost). So a broker row DOES have a cost basis, and now shows it.
  //
  // THE POINT OF THE CHANGE: that number needs NO PRICE OF OURS. A holding we cannot value — an OTC
  // bond with no exchange close — still tells the user what they PUT IN. That is the difference
  // between "current value unavailable" and a blank, mysterious row.
  //
  // THE HONEST NULL THAT REMAINS, and it is the one that was always load-bearing: REALIZED P&L. A
  // snapshot has no LOT REGISTER, so realized P&L is genuinely unknowable and stays null. Cost basis
  // and lot register used to be absent together; they are two different things and only one of them
  // was ever really missing.
  console.log("\n═══ B — Honest nulls: a broker row has a COST BASIS but NO LOT REGISTER ═══");
  assert("🎭 broker realizedPnl is STILL EXACTLY null (identity-checked — not 0, not \"0\", not falsy)",
    brokerRel.realizedPnl === null, `realizedPnl=${JSON.stringify(brokerRel.realizedPnl)} typeof=${typeof brokerRel.realizedPnl}`);
  assert("🎭 broker lots is null (no lot register EXISTS) — not [] (which would claim one exists, empty)",
    brokerRel.lots === null, `lots=${JSON.stringify(brokerRel.lots)}`);
  assert("🎭 broker lastComputedAt is null (never FIFO-replayed)", brokerRel.lastComputedAt === null, `lastComputedAt=${JSON.stringify(brokerRel.lastComputedAt)}`);

  // ...and what it now DOES have (Step 17):
  const relInvested = 10 * 2400.5; // the mock's quantity × avgCost
  assert("💰 broker investedValue = quantity × the broker's avgCost — needs NO price of ours",
    Math.abs(Number(brokerRel.investedValue) - relInvested) < 0.01,
    `investedValue=${brokerRel.investedValue} expected=${relInvested}`);
  assert("💰 broker unrealizedPnl = marketValue − invested (a REAL number, not marketValue − 0)",
    brokerRel.unrealizedPnl !== null &&
      Math.abs(brokerRel.unrealizedPnl - (brokerRel.marketValue - relInvested)) < 0.01,
    `unrealized=${brokerRel.unrealizedPnl} = mv ${brokerRel.marketValue.toFixed(2)} − invested ${relInvested}`);
  assert("🚨 …and it is NOT the phantom-profit bug: unrealized ≠ marketValue (which null→0 would give)",
    Math.abs(brokerRel.unrealizedPnl - brokerRel.marketValue) > 0.01,
    `unrealized=${brokerRel.unrealizedPnl} vs marketValue=${brokerRel.marketValue.toFixed(2)} — the bug would make these EQUAL`);

  // ...and the CONTRAST that gives those nulls meaning:
  assert("↔️ a MANUAL row's realized \"0\" is a REAL zero (a fact), kept DISTINCT from broker null",
    manualTcs.realizedPnl === "0" && brokerTcs.realizedPnl === null,
    `manualTCS.realized=${JSON.stringify(manualTcs.realizedPnl)} vs brokerTCS.realized=${JSON.stringify(brokerTcs.realizedPnl)}`);
  const infyManual = d.holdings.find((h: any) => h.symbol === "INFY" && h.source === "manual");
  assert("↔️ manual rows keep FIFO cost basis (INFY realized 2000, invested + lots present)",
    Number(infyManual.realizedPnl) === 2000 && infyManual.investedValue !== null && Array.isArray(infyManual.lots),
    `realized=${infyManual.realizedPnl} invested=${infyManual.investedValue} lots=${infyManual.lots?.length}`);

  // ═══ C — NULL-SAFE PARTIAL TOTALS (and what the null→0 bug would have cost) ═══
  console.log("\n═══ C — Totals: sum only what exists, and SAY so ═══");
  const t = d.totals;
  // (Step 17) EVERY row now has a cost basis — the manual pair from FIFO, the broker four from
  // quantity × avgCost. So the totals cover the WHOLE book, and that is a strictly better number
  // than the partial one they used to be: a user whose holdings are entirely with a broker used to
  // see "invested: ₹0".
  const rowInvested = d.holdings.reduce((s: number, h: any) => s + Number(h.investedValue ?? 0), 0);
  assert("investedValue sums EVERY row — manual (FIFO) AND broker (qty × avgCost)",
    Math.abs(Number(t.investedValue) - rowInvested) < 0.01, `total=${t.investedValue} rowSum=${rowInvested.toFixed(2)}`);
  assert("...and it is no longer partial (the broker side is no longer a hole in the book)",
    t.partial.investedValue === false, `partial.investedValue=${t.partial.investedValue}`);

  // THE HONEST NULL THAT SURVIVES — and the disclosure that must survive WITH it.
  assert("realizedPnlAll = the manual ledger (2000) — broker rows contribute NOTHING, not 0",
    Number(t.realizedPnlAll) === 2000, `realizedPnlAll=${t.realizedPnlAll}`);
  assert("🎭 realizedPnl is STILL disclosed as PARTIAL — broker rows have no LOT REGISTER",
    t.partial.realizedPnl === true,
    `partial.realizedPnl=${t.partial.realizedPnl} — this flag used to be keyed on \`noCostBasis\`, which is now EMPTY; ` +
    `keyed on that proxy it would have silently flipped to false and claimed realized P&L covered the whole book`);
  assert("...naming HOW MANY positions lack a lot register (the 4 broker rows)",
    t.partial.positionsWithoutLotRegister === 4, `positionsWithoutLotRegister=${t.partial.positionsWithoutLotRegister}`);

  const rowUnrealized = d.holdings.reduce((s: number, h: any) => s + (h.unrealizedPnl ?? 0), 0);
  assert("unrealizedPnl sums the PER-ROW figures (never two totals drawn from different row sets)",
    Math.abs(Number(t.unrealizedPnl) - rowUnrealized) < 0.01,
    `total=${t.unrealizedPnl} rowSum=${rowUnrealized.toFixed(2)}`);

  const brokerPricedMv = d.holdings.filter((h: any) => h.source === "broker" && h.marketValue != null)
    .reduce((s: number, h: any) => s + h.marketValue, 0);
  const allMv = d.holdings.reduce((s: number, h: any) => s + (h.marketValue ?? 0), 0);
  assert("currentValue DOES include broker rows (our price exists for every mapped share)",
    Math.abs(Number(t.currentValue) - allMv) < 0.01 && brokerPricedMv > 0,
    `currentValue=${t.currentValue} (broker share = ${brokerPricedMv.toFixed(2)})`);

  // 🚨 THE PHANTOM-PROFIT GUARD, STILL MEANINGFUL. The pre-Step-5 bug was:
  //      unrealized = marketValue(ALL rows) − Σ Number(investedValue)   ← Number(null) = 0
  // Broker rows contributed their FULL market value to "profit" and ₹0 to cost. Step 17 does NOT
  // reintroduce it — and the proof is arithmetic, not assertion: the honest total must differ from
  // the buggy one by EXACTLY the broker rows' cost basis, because that is precisely the ₹ the bug
  // used to treat as zero.
  // Only rows that HAVE a market value can fabricate profit: an unpriced row contributes nothing to
  // `allMv`, so the bug had nothing to inflate on it. The corruption is therefore exactly the cost
  // basis of the PRICED broker rows — the ₹ the null→0 formula wrongly read as zero.
  const brokerPricedInvested = d.holdings
    .filter((h: any) => h.source === "broker" && h.marketValue != null)
    .reduce((s: number, h: any) => s + Number(h.investedValue ?? 0), 0);
  const manualInvested = Number(manualTcs.investedValue) + Number(infyManual.investedValue);
  const buggyUnrealized = allMv - manualInvested; // what the null→0 code would have returned
  const corruption = buggyUnrealized - Number(t.unrealizedPnl);
  assert("🚨 the null→0 phantom profit is STILL absent — the broker cost basis is REAL, not zero",
    Math.abs(corruption - brokerPricedInvested) < 0.01 && brokerPricedInvested > 0,
    `buggy=${buggyUnrealized.toFixed(2)} honest=${t.unrealizedPnl} → the bug would still fabricate ₹${corruption.toFixed(2)}, ` +
    `which is EXACTLY the PRICED broker rows' cost basis ₹${brokerPricedInvested.toFixed(2)} it wrongly reads as 0`);

  // ═══ D — HELD-NOT-VALUED (Step 3 consistency) ═══
  console.log("\n═══ D — Held-not-valued: shown honestly, never fabricated ═══");
  assert("the unmapped symbol IS on the holdings screen (real position, not dropped)", !!fake, `present=${!!fake}`);
  assert("...flagged heldNotValued, with NO fabricated price/value/health/tier",
    fake.heldNotValued === true && fake.marketValue === null && fake.currentPrice === null && fake.health === null && fake.tier === "unknown",
    `heldNotValued=${fake.heldNotValued} mv=${JSON.stringify(fake.marketValue)} price=${JSON.stringify(fake.currentPrice)} health=${JSON.stringify(fake.health)}`);
  assert("...its real quantity IS shown (we know what we hold; we just can't price it)", fake.quantity === "3", `qty=${fake.quantity}`);
  assert("...and unpriced rows sort LAST (never ranked by a number we don't have)",
    d.holdings[d.holdings.length - 1].symbol === "FAKESTOCK", `last=${d.holdings[d.holdings.length - 1].symbol}`);
  assert("mapped rows are sorted marketValue-desc", d.holdings.every((h: any, i: number, a: any[]) => i === 0 || (a[i - 1].marketValue ?? -1) >= (h.marketValue ?? -1)), "monotonic");

  // ═══ E — STALE ROWS (Step 4 consistency, now visible on the holdings screen) ═══
  console.log("\n═══ E — Frozen (stale) rows disclosed per-row ═══");
  const freshFlags = d.holdings.map((h: any) => h.stale);
  assert("before the sever: nothing is stale", freshFlags.every((s: boolean) => s === false), `stale=[${[...new Set(freshFlags)].join(",")}]`);
  await deactivate(U.userId, conn.id); // sever → the account freezes (Step 4)
  const dStale = await holdings(U.userId);
  const staleRows = dStale.holdings.filter((h: any) => h.source === "broker");
  const staleRel = staleRows.find((h: any) => h.symbol === "RELIANCE");
  assert("after the sever: broker rows STILL SHOW (frozen, never dropped)", staleRows.length === 4, `brokerRows=${staleRows.length}`);
  assert("...each flagged stale=true, with the last-sync stamp", staleRows.every((h: any) => h.stale === true && h.lastSyncedAt != null), `stale=[${staleRows.map((h: any) => h.stale).join(",")}] synced=${staleRows[0]?.lastSyncedAt != null}`);
  assert("...manual rows stay stale=false (our ledger is never stale)", dStale.holdings.filter((h: any) => h.source === "manual").every((h: any) => h.stale === false), "manual all fresh");
  assert("...and a frozen row is STILL valued at OUR live price (quantity is stale, value is not)",
    Math.abs(staleRel.marketValue - 10 * relPrice) < 0.01, `mv=${staleRel.marketValue.toFixed(2)} = 10 × ${relPrice} (today's price)`);

  // ═══ F — includeExited still works (manual-only concept) ═══
  console.log("\n═══ F — includeExited (unchanged behaviour) ═══");
  await addTx(U.userId, { symbol: "TCS", type: "sell", quantity: 10, price: 3500, tradeDate: "2024-06-01", accountId: uMain }); // fully exit manual TCS
  const noExit = await holdings(U.userId);
  const withExit = await holdings(U.userId, { includeExited: "true" });
  assert("exited manual position is hidden by default, shown with includeExited=true",
    !noExit.holdings.some((h: any) => h.source === "manual" && h.symbol === "TCS") &&
      withExit.holdings.some((h: any) => h.source === "manual" && h.symbol === "TCS" && Number(h.quantity) === 0),
    `default=${noExit.holdings.length} rows, includeExited=${withExit.holdings.length} rows`);
  assert("...and its realized P&L still counts in realizedPnlAll (exited ≠ forgotten)",
    Number(noExit.totals.realizedPnlAll) === 7000, `realizedPnlAll=${noExit.totals.realizedPnlAll} (2000 INFY + 5000 TCS)`);

  // ═══ G — IDOR ═══
  console.log("\n═══ G — IDOR ═══");
  const V = await seedUser("v"); created.push(V.authId);
  const vMain = await mkAccount(V.userId, "My Holdings", "zerodha");
  const vd = await holdings(V.userId);
  assert("V's holdings are EMPTY — none of U's rows leak", vd.holdings.length === 0, `rows=${vd.holdings.length}`);
  assert("...and V's totals are honestly zero, not U's", Number(vd.totals.currentValue) === 0 && vd.totals.partial.positionsWithoutCostBasis === 0, `currentValue=${vd.totals.currentValue}`);
  await addTx(V.userId, { symbol: "ITC", type: "buy", quantity: 5, price: 400, tradeDate: "2024-01-01", accountId: vMain });
  const vd2 = await holdings(V.userId);
  const uAccts = new Set(dStale.holdings.map((h: any) => h.accountId));
  assert("V sees only V's own account", vd2.holdings.length === 1 && !uAccts.has(vd2.holdings[0].accountId), `rows=${vd2.holdings.length} leaked=${vd2.holdings.some((h: any) => uAccts.has(h.accountId))}`);

  console.log(`\n${failures === 0 ? "✅ ALL HOLDINGS-UNION CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
} finally {
  for (const a of created) await cleanup(a);
  await prisma.$disconnect();
}
process.exit(failures === 0 ? 0 : 1);
