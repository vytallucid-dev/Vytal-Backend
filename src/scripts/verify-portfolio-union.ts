// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO UNION HARNESS (Step 3) — manual (FIFO) ⊎ broker (snapshot) across accounts,
// and PHS over that union. Proves the rulings:
//   R1  every share valued with OUR price × qty; broker currentValue NEVER enters the score
//   R2  an unmapped broker holding contributes ZERO to PHS weights, but is LOUD in display
//   R3  broker realized reads null, never 0
//   §2.4 source is a display label only — flipping it cannot move the score
//   + aggregate-by-symbol (the S1 concentration bug-fix), two engines uncontaminated, IDOR
//
//   npx tsx src/scripts/verify-portfolio-union.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import type { BrokerId } from "../brokers/types.js";
import { listUnifiedPositions } from "../brokers/union.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";
import { addTransaction } from "../controllers/me/transactions-controller.js";
import { integrate, syncHoldings } from "../brokers/lifecycle.js";

let failures = 0;
const assert = (name: string, cond: boolean, detail: string) => {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
};
const mockRes = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const mockReq = (userId: string, o: any = {}) => ({ authUser: { userId }, body: o.body ?? {}, params: o.params ?? {}, query: {} }) as any;

async function seedUser(tag: string) {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `uni-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { authId, userId: u.id };
}
const cleanup = (a: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);
const DISC = { accepted: true, disclaimerVersion: "v1" };

const addTx = async (userId: string, body: any) => { const r = mockRes(); await addTransaction(mockReq(userId, { body }), r); return r; };
// Step 5.5: every account belongs to a broker, from creation. A book that will be LINKED to a
// mock connection is tagged `mock` — link now CHECKS account.broker === connection.broker.
const mkAccount = (userId: string, name: string, broker: BrokerId) =>
  prisma.portfolioAccount.create({ data: { userId, name, broker, state: "manual" }, select: { id: true } });
async function linkConn(userId: string, accountId: string, connectionId: string) {
  await prisma.portfolioAccount.update({ where: { id: accountId }, data: { brokerConnectionId: connectionId, state: "linked_live" } });
}

const created: string[] = [];
try {
  // ═══ A — AGGREGATE BY SYMBOL (the S1 concentration bug-fix) ═══
  console.log("═══ A — Aggregate-by-symbol: same stock in TWO accounts ═══");
  const U = await seedUser("u"); created.push(U.authId);
  // Two MANUAL accounts, each holding 100 RELIANCE. Plus one other stock so weights are meaningful.
  // Step 5.5: accounts are CREATED explicitly (the auto-create is gone), and once a user has TWO,
  // every write must name the account it lands in — we no longer guess.
  const acct1 = await mkAccount(U.userId, "My Holdings", "zerodha");
  await addTx(U.userId, { symbol: "RELIANCE", type: "buy", quantity: 100, price: 1000, tradeDate: "2024-01-01", accountId: acct1.id });
  const acct2 = await mkAccount(U.userId, "Family", "zerodha");
  await addTx(U.userId, { symbol: "RELIANCE", type: "buy", quantity: 100, price: 1000, tradeDate: "2024-01-02", accountId: acct2.id });
  await addTx(U.userId, { symbol: "TCS", type: "buy", quantity: 10, price: 3000, tradeDate: "2024-01-03", accountId: acct1.id });

  const uniU = await listUnifiedPositions(U.userId);
  const relLines = uniU.filter((p) => p.symbol === "RELIANCE");
  assert("union keeps PER-ACCOUNT lines (RELIANCE appears twice, not collapsed)", relLines.length === 2, `lines=${relLines.length}`);
  assert("...in two DIFFERENT accounts", new Set(relLines.map((p) => p.accountId)).size === 2, `accounts=${new Set(relLines.map((p) => p.accountId)).size}`);

  const asmU = await assemblePortfolio(U.userId);
  const relPhs = asmU.holdings.filter((h) => h.symbol === "RELIANCE");
  assert("PHS AGGREGATES by symbol → ONE RELIANCE line (not two)", relPhs.length === 1, `phsLines=${relPhs.length}`);

  // The bug-fix proof: S1 must charge ONE combined position, not two half-sized ones.
  const relPrice = await prisma.stockPrice.findFirst({ where: { stock: { symbol: "RELIANCE" } }, select: { price: true } });
  const expectedMv = 200 * Number(relPrice!.price); // 100 + 100 shares, OUR price
  assert("aggregated marketValue = COMBINED qty (200) × our price", Math.abs(relPhs[0].marketValue - expectedMv) < 0.01, `mv=${relPhs[0].marketValue.toFixed(2)} exp=${expectedMv.toFixed(2)}`);

  // Prove S1 sees the combined weight: compare vs the (wrong) split-lines shape.
  const phsAgg = computePhs(asmU.holdings);
  const splitLines = [
    { ...relPhs[0], marketValue: relPhs[0].marketValue / 2 },
    { ...relPhs[0], marketValue: relPhs[0].marketValue / 2 },
    ...asmU.holdings.filter((h) => h.symbol !== "RELIANCE"),
  ];
  const phsSplit = computePhs(splitLines);
  // (Stage 9 §15) REPOINTED S1 → C1, and the property STRENGTHENED — this is REAL coverage §10 does not
  // have, so it keeps its home rather than being dropped with the S-rules.
  //
  // The original claim: aggregating one stock held in two accounts charges MORE than two split lines
  // would, because split lines UNDERSTATE concentration (S1 read POSITIONS, so one 40% holding split
  // across two accounts read as two 20% holdings and escaped the threshold).
  //
  // ★ UNDER C1 THE BUG CANNOT HAPPEN AT ALL. C1 reads ENTITIES, and both lines carry the same ISIN, so
  // `buildEntityLedger` merges them BEFORE C1 ever sees them: split and aggregated produce the SAME
  // charge. The v1 fix made the union do the aggregating; the entity model makes the aggregation
  // STRUCTURAL — a split line is not a thing C1 can be fooled by. So the assertion moves from
  // "aggregated charges MORE" (a bug-fix holding) to "split ≡ aggregated" (the bug is unrepresentable),
  // which is the stronger statement and the one that stays true.
  const c1Agg = phsAgg.construction.gross.c1.points;
  const c1Split = phsSplit.construction.gross.c1.points;
  assert("🐛 BUG-FIX (now STRUCTURAL): C1 reads ENTITIES, so splitting one holding across accounts changes NOTHING",
    Math.abs(c1Agg - c1Split) < 1e-9, `C1 aggregated=${c1Agg.toFixed(4)} ≡ split=${c1Split.toFixed(4)} (same ISIN ⇒ one entity, before C1 sees it)`);

  // ═══ B — TWO ENGINES UNCONTAMINATED + R1 + R3 ═══
  console.log("\n═══ B — Two value engines: manual FIFO vs broker snapshot ═══");
  const V = await seedUser("v"); created.push(V.authId);
  const vMain = await mkAccount(V.userId, "My Holdings", "zerodha");
  await addTx(V.userId, { symbol: "RELIANCE", type: "buy", quantity: 100, price: 1000, tradeDate: "2024-01-01", accountId: vMain.id });
  await addTx(V.userId, { symbol: "RELIANCE", type: "buy", quantity: 100, price: 1200, tradeDate: "2024-02-01", accountId: vMain.id });
  await addTx(V.userId, { symbol: "RELIANCE", type: "sell", quantity: 100, price: 1500, tradeDate: "2024-03-01", accountId: vMain.id }); // FIFO realized 50000

  const connV = await integrate(V.userId, "mock", { ...DISC, params: {
    mockAccountRef: "DEMAT_V",
    // broker avg 777.77 — a value our FIFO would NEVER produce. If it survives, no FIFO ran on it.
    mockHoldings: [
      { tradingsymbol: "INFY", quantity: 50, average_price: 777.77, last_price: 9999, product: "CNC" },
      { tradingsymbol: "ZZUNMAPPEDXYZ", quantity: 7, average_price: 11.11, last_price: 22.22, product: "CNC" },
    ],
  } });
  const bAcct = await mkAccount(V.userId, "Broker Acct", "mock"); // will be linked to a MOCK connection
  await linkConn(V.userId, bAcct.id, connV.id);
  await syncHoldings(V.userId, connV.id);

  const uniV = await listUnifiedPositions(V.userId);
  const mRel = uniV.find((p) => p.source === "manual" && p.symbol === "RELIANCE")!;
  const bInfy = uniV.find((p) => p.source === "broker" && p.symbol === "INFY")!;

  assert("MANUAL side keeps FIFO output (avg 1200 of the remaining lot, realized 50000)",
    Number(mRel.avgCost) === 1200 && Number(mRel.realizedPnl) === 50000,
    `avg=${mRel.avgCost} realized=${mRel.realizedPnl}`);
  assert("BROKER side keeps the broker's avg AS-GIVEN (777.77 — never FIFO-replayed)",
    Number(bInfy.avgCost) === 777.77, `avg=${bInfy.avgCost}`);
  // R3 — THE HONEST NULL, and it is REALIZED P&L, not the cost basis.
  //
  // (Step 17) This block used to assert BOTH were null, on the reasoning that "the snapshot carries
  // none". That is true of REALIZED P&L — it needs a LOT REGISTER, and a snapshot has none, so it
  // stays honestly null forever. It was NOT true of the cost basis: quantity and avgCost are both
  // present on every broker holding, and their product IS the invested amount. The two absences
  // travelled together and were mistaken for one. They are separated now.
  assert("R3: broker realizedPnl is NULL (honestly absent — no LOT REGISTER), never 0",
    bInfy.realizedPnl === null, `realizedPnl=${JSON.stringify(bInfy.realizedPnl)}`);
  assert("R3: broker investedValue IS present = quantity × the broker's avgCost (needs no price of ours)",
    bInfy.investedValue !== null &&
      Math.abs(Number(bInfy.investedValue) - Number(bInfy.quantity) * Number(bInfy.avgCost)) < 0.01,
    `invested=${bInfy.investedValue} = ${bInfy.quantity} × ${bInfy.avgCost}`);
  assert("R3: …and the broker's avgCost is STILL as-given, never FIFO-replayed (the engines stay uncontaminated)",
    Number(bInfy.avgCost) === 777.77, `avg=${bInfy.avgCost}`);
  assert("manual realizedPnl is a real number (FIFO owns it)", mRel.realizedPnl !== null, `realized=${mRel.realizedPnl}`);

  // R1 — broker currentValue must NOT be what PHS scores on
  const asmV = await assemblePortfolio(V.userId);
  const infyPhs = asmV.holdings.find((h) => h.symbol === "INFY")!;
  const infyPrice = await prisma.stockPrice.findFirst({ where: { stock: { symbol: "INFY" } }, select: { price: true } });
  const ourInfyMv = 50 * Number(infyPrice!.price);
  const brokerInfyMv = 50 * 9999; // what the broker's last_price implies
  assert("R1: PHS values the broker holding with OUR price × qty (NOT the broker's currentValue)",
    Math.abs(infyPhs.marketValue - ourInfyMv) < 0.01 && Math.abs(infyPhs.marketValue - brokerInfyMv) > 1,
    `phsMv=${infyPhs.marketValue.toFixed(2)} ourMv=${ourInfyMv.toFixed(2)} brokerMv=${brokerInfyMv.toFixed(2)}`);

  // ═══ C — R2: held-not-valued (both halves) ═══
  console.log("\n═══ C — R2: unmapped broker holding — excluded from score, LOUD in display ═══");
  const unmappedInPhs = asmV.holdings.some((h) => h.symbol === "ZZUNMAPPEDXYZ");
  assert("R2a: unmapped symbol contributes ZERO to PHS weights (absent from scored holdings)", !unmappedInPhs, `present=${unmappedInPhs}`);
  const hnv = asmV.heldNotValued.find((h) => h.symbol === "ZZUNMAPPEDXYZ");
  assert("R2b: ...but it IS surfaced in heldNotValued (not silently dropped)", !!hnv, `heldNotValued=[${asmV.heldNotValued.map((h) => h.symbol).join(",")}]`);
  assert("R2b: ...with its qty + the broker's ₹ value visible", Number(hnv?.quantity) === 7 && hnv?.brokerCurrentValue != null, `qty=${hnv?.quantity} brokerValue=${hnv?.brokerCurrentValue}`);
  assert("R2b: ...and tagged to its account + source", hnv?.accountId === bAcct.id && hnv?.source === "broker", `acct=${hnv?.accountId === bAcct.id} source=${hnv?.source}`);
  const phsWithUnscorable = computePhs(asmV.holdings);
  assert("PHS computed WITHOUT crashing on the unscorable position", Number.isFinite(phsWithUnscorable.health ?? 0) && phsWithUnscorable.evaluable, `health=${phsWithUnscorable.health} evaluable=${phsWithUnscorable.evaluable}`);

  // ═══ D — §2.4 SOURCE IS DISPLAY-ONLY ═══
  console.log("\n═══ D — §2.4: source cannot move the score ═══");
  // Same stock, same qty, same price — one held manually, one mirrored from a broker.
  const M = await seedUser("m"); created.push(M.authId);
  const mMain = await mkAccount(M.userId, "My Holdings", "zerodha"); // explicit since 5.5 (no auto-create)
  await addTx(M.userId, { symbol: "INFY", type: "buy", quantity: 50, price: 500, tradeDate: "2024-01-01", accountId: mMain.id });
  const asmM = await assemblePortfolio(M.userId);
  const phsManual = computePhs(asmM.holdings);

  const B2 = await seedUser("b2"); created.push(B2.authId);
  const connB2 = await integrate(B2.userId, "mock", { ...DISC, params: {
    mockAccountRef: "DEMAT_B2",
    mockHoldings: [{ tradingsymbol: "INFY", quantity: 50, average_price: 500, last_price: 4242, product: "CNC" }],
  } });
  const b2Acct = await mkAccount(B2.userId, "Broker Only", "mock");
  await linkConn(B2.userId, b2Acct.id, connB2.id);
  await syncHoldings(B2.userId, connB2.id);
  const asmB2 = await assemblePortfolio(B2.userId);
  const phsBroker = computePhs(asmB2.holdings);

  // Compare the REAL fields (health/quality/structure/signals). Guard against a vacuous pass:
  // if the score were undefined on both sides, `undefined === undefined` would "pass" while
  // proving nothing — so require an actual number first.
  assert("§2.4 sanity: both sides produced a real, evaluable score (not a vacuous undefined)",
    typeof phsManual.health === "number" && typeof phsBroker.health === "number" && phsManual.evaluable && phsBroker.evaluable,
    `manualHealth=${phsManual.health} brokerHealth=${phsBroker.health}`);
  assert("§2.4: 50 INFY held MANUALLY vs 50 INFY MIRRORED → identical PHS (health/band/Q/S/Sig)",
    phsManual.health === phsBroker.health && phsManual.band === phsBroker.band &&
      phsManual.quality === phsBroker.quality && phsManual.construction.net === phsBroker.construction.net && phsManual.signals === phsBroker.signals,
    `manual=${phsManual.health}/${phsManual.band}/Q${phsManual.quality}/Net${phsManual.construction.net.toFixed(2)}/Sig${phsManual.signals} | broker=${phsBroker.health}/${phsBroker.band}/Q${phsBroker.quality}/Net${phsBroker.construction.net.toFixed(2)}/Sig${phsBroker.signals}`);
  assert("§2.4: ...and identical marketValue (broker's last_price 4242 ignored)",
    Math.abs((asmM.holdings[0]?.marketValue ?? 0) - (asmB2.holdings[0]?.marketValue ?? -1)) < 0.01,
    `manualMv=${asmM.holdings[0]?.marketValue.toFixed(2)} brokerMv=${asmB2.holdings[0]?.marketValue.toFixed(2)}`);

  // ═══ E — IDOR ═══
  console.log("\n═══ E — IDOR: V's union never contains U's accounts ═══");
  const uAccts = new Set((await prisma.portfolioAccount.findMany({ where: { userId: U.userId }, select: { id: true } })).map((a) => a.id));
  const vUnion = await listUnifiedPositions(V.userId);
  const leak = vUnion.filter((p) => uAccts.has(p.accountId));
  assert("V's union contains ZERO of U's accounts", leak.length === 0, `leaked=${leak.length}`);
  assert("V's union is entirely V's own accounts", vUnion.every((p) => !!p.accountId), `positions=${vUnion.length}`);
  const uUnion = await listUnifiedPositions(U.userId);
  assert("U's union contains no broker rows (U has no connection)", uUnion.every((p) => p.source === "manual"), `sources=[${[...new Set(uUnion.map((p) => p.source))].join(",")}]`);

  console.log(`\n${failures === 0 ? "✅ ALL UNION CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
} finally {
  for (const a of created) await cleanup(a);
  await prisma.$disconnect();
}
process.exit(failures === 0 ? 0 : 1);
