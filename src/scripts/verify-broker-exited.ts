// ─────────────────────────────────────────────────────────────────────────────
// BROKER MIRROR — EXITED (QTY-0) POSITIONS ARE NOT HOLDINGS
//
//   A  SOLD-OUT ACCOUNT → ZERO HOLDINGS. The core assertion. A demat that sold everything and
//      re-synced mirrors to EMPTY — no rows stored, none displayed, none counted, none scored.
//   B  PARTIAL SELL (2 of 3) → the mirror shows exactly the 1 remaining; the 2 sold are GONE,
//      not zeroed.
//   C  THE READ FILTER STANDS ALONE. Ghost rows already sitting in broker_holdings (the live
//      account's real state) are not emitted by the union — proven by inserting them DIRECTLY,
//      bypassing the store-side filter entirely. `includeExited` still surfaces them, on the
//      same terms as the manual side.
//   D  §13 HALF 1 — the 5 baseline books are BYTE-IDENTICAL (73·73·69·65·50). They are manual,
//      structurally incapable of holding a ghost, so the filter must not touch them.
//   E  §13 HALF 2 — A GHOST BOOK GETS THE HONEST SCORE. A book carrying qty-0 ghosts scores
//      EXACTLY what the same book without them scores: N drops by the ghost count, and C1's
//      threshold max(15, 1.5×100/N) lands where it always should have. The fix makes a WRONG
//      score RIGHT — this is the actual deliverable.
//   F  ATOMICITY INTACT — the write path is untouched; a mid-sync failure leaves the prior
//      snapshot whole (never a half-mirror).
//   G  READ-ONLY INTACT — no write method to the broker exists on any adapter.
//
//   npx tsx src/scripts/verify-broker-exited.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import { integrate, syncHoldings, BrokerLifecycleError } from "../brokers/lifecycle.js";
import { listUnifiedPositions } from "../brokers/union.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";
import { createAccount, linkAccount } from "../controllers/me/accounts-controller.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";
import { getAdapter } from "../brokers/registry.js";

let failures = 0;
const assert = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};
const mockRes = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const mockReq = (userId: string, o: any = {}) => ({ authUser: { userId }, body: o.body ?? {}, params: o.params ?? {}, query: o.query ?? {} }) as any;
const call = async (fn: any, userId: string, o: any = {}) => { const r = mockRes(); await fn(mockReq(userId, o), r); return r; };

async function seedUser(tag: string) {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `exited-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { authId, userId: u.id };
}
const cleanup = (a: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);
const DISC = { accepted: true, disclaimerVersion: "v1" };
const mk = async (userId: string, name: string, broker: string) => (await call(createAccount, userId, { body: { name, broker } })).body.data.id as string;
const link = (userId: string, id: string, connectionId: string) => call(linkAccount, userId, { params: { id }, body: { connectionId } });

/** A Kite-shaped row. `quantity: 0` is EXACTLY what Zerodha returns for an instrument sold today —
 *  observed on the live sold-out demat, with the sale recorded in `used_quantity`, not
 *  `realised_quantity`. The mock's normalize reads `quantity`, so this reproduces the wire state. */
const ROW = (tradingsymbol: string, isin: string, quantity: number, avg: number, last: number) =>
  ({ tradingsymbol, isin, exchange: "NSE", quantity, average_price: avg, last_price: last, product: "CNC" });

const R = ROW("RELIANCE", "INE002A01018", 10, 2400.5, 2950);
const T = ROW("TCS", "INE467B01029", 5, 3200, 3850.25);
const I = ROW("INFY", "INE009A01021", 20, 1400.75, 1620);

const created: string[] = [];
try {
  // ═══════════════════════════════════════════════════════════════════════════
  // A — SOLD-OUT ACCOUNT → ZERO HOLDINGS (the core assertion)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══ A — A demat that sold everything mirrors to EMPTY ═══");
  const A = await seedUser("a"); created.push(A.authId);
  const aAcct = await mk(A.userId, "Sold Out Demat", "mock");
  const REF_A = `DEMAT_SOLD_${randomUUID().slice(0, 6)}`;

  const aConn = await integrate(A.userId, "mock", { ...DISC, params: { mockAccountRef: REF_A, mockHoldings: [R, T, I] } });
  await link(A.userId, aAcct, aConn.id);
  const before = await syncHoldings(A.userId, aConn.id);
  assert("PRECONDITION: the account holds 3 instruments", before.synced === 3, `synced=${before.synced}`);
  const posBefore = (await listUnifiedPositions(A.userId)).filter((p) => p.source === "broker");
  assert("PRECONDITION: 3 positions displayed", posBefore.length === 3, `${posBefore.length} positions`);

  // ── SELL EVERYTHING, then reconnect. Same demat ⇒ same broker_account_ref ⇒ the SAME connection
  //    row (the upsert key IS the demat's identity), which is exactly the reconnect the bug report
  //    describes. Kite hands back all 3 instruments at qty 0.
  const aConn2 = await integrate(A.userId, "mock", {
    ...DISC,
    params: { mockAccountRef: REF_A, mockHoldings: [{ ...R, quantity: 0 }, { ...T, quantity: 0 }, { ...I, quantity: 0 }] },
  });
  assert("the reconnect reused the SAME connection (same demat ⇒ same ref ⇒ upsert, not a second row)",
    aConn2.id === aConn.id, `conn ${aConn.id.slice(0, 8)} === ${aConn2.id.slice(0, 8)}`);

  const after = await syncHoldings(A.userId, aConn.id);
  assert("★ the sync reports ZERO synced (3 qty-0 rows came back; none is a holding)", after.synced === 0, `synced=${after.synced}`);

  const storedA = await prisma.brokerHolding.count({ where: { brokerConnectionId: aConn.id } });
  assert("★ broker_holdings is EMPTY for the account — not 3 rows at qty 0", storedA === 0, `${storedA} rows stored`);

  const posAfter = (await listUnifiedPositions(A.userId)).filter((p) => p.source === "broker");
  assert("★ ZERO holdings displayed (the symptom, gone)", posAfter.length === 0, `${posAfter.length} positions`);

  const holdA = await call(listHoldings, A.userId);
  const holdBodyA = JSON.stringify(holdA.body);
  assert("GET /holdings: 200, and none of the 3 sold symbols appears",
    holdA.statusCode === 200 && !holdBodyA.includes("RELIANCE") && !holdBodyA.includes("TCS") && !holdBodyA.includes("INFY"),
    `status=${holdA.statusCode}`);

  const asmA = await assemblePortfolio(A.userId);
  assert("★ PHS sees an EMPTY book — a sold-out account is not scored on ghosts",
    asmA.holdings.length === 0 && asmA.heldNotValued.length === 0,
    `holdings=${asmA.holdings.length} heldNotValued=${asmA.heldNotValued.length}`);

  // The universe must not have grown on the strength of a position nobody owns.
  assert("the sold-out sync ADMITTED nothing to the universe (the filter runs BEFORE the resolver)",
    after.admitted.length === 0, `admitted=${after.admitted.length}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // B — PARTIAL SELL: 2 of 3 sold → 1 remains, 2 GONE (not zeroed)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ B — Partial sell: the mirror shows exactly what is still held ═══");
  const B = await seedUser("b"); created.push(B.authId);
  const bAcct = await mk(B.userId, "Partial Demat", "mock");
  const REF_B = `DEMAT_PART_${randomUUID().slice(0, 6)}`;

  const bConn = await integrate(B.userId, "mock", { ...DISC, params: { mockAccountRef: REF_B, mockHoldings: [R, T, I] } });
  await link(B.userId, bAcct, bConn.id);
  await syncHoldings(B.userId, bConn.id);

  // Sold RELIANCE and INFY; kept TCS.
  await integrate(B.userId, "mock", {
    ...DISC,
    params: { mockAccountRef: REF_B, mockHoldings: [{ ...R, quantity: 0 }, T, { ...I, quantity: 0 }] },
  });
  const bOut = await syncHoldings(B.userId, bConn.id);
  assert("the sync reports exactly 1 synced", bOut.synced === 1, `synced=${bOut.synced}`);

  const bRows = await prisma.brokerHolding.findMany({
    where: { brokerConnectionId: bConn.id },
    select: { symbol: true, quantity: true },
  });
  assert("★ exactly ONE row survives, and it is TCS at its real quantity",
    bRows.length === 1 && bRows[0].symbol === "TCS" && Number(bRows[0].quantity) === 5,
    bRows.map((r) => `${r.symbol}=${r.quantity}`).join(" "));
  assert("★ the 2 sold instruments are GONE from the mirror — not present at qty 0",
    !bRows.some((r) => r.symbol === "RELIANCE" || r.symbol === "INFY"), "no RELIANCE, no INFY");

  const bPos = (await listUnifiedPositions(B.userId)).filter((p) => p.source === "broker");
  assert("the union agrees: 1 position, TCS", bPos.length === 1 && bPos[0].symbol === "TCS", `${bPos.length} position(s)`);

  // ═══════════════════════════════════════════════════════════════════════════
  // C — THE READ FILTER, STANDING ALONE (ghosts already in the table)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ C — Ghost rows ALREADY in broker_holdings are not emitted (the live account's state) ═══");
  // The store-side filter stops NEW ghosts. It does nothing for the rows already written by every
  // sync that ran before this fix — which is the state the live demat is in right now. So insert
  // them DIRECTLY, bypassing sync entirely, and prove the READ is what saves us.
  const C = await seedUser("c"); created.push(C.authId);
  const cAcct = await mk(C.userId, "Ghost Demat", "mock");
  const cConn = await integrate(C.userId, "mock", { ...DISC, params: { mockAccountRef: `DEMAT_GHOST_${randomUUID().slice(0, 6)}`, mockHoldings: [R, T] } });
  await link(C.userId, cAcct, cConn.id);
  await syncHoldings(C.userId, cConn.id);

  const infy = await prisma.instrument.findFirst({ where: { isin: "INE009A01021" }, select: { id: true, stockId: true } });
  await prisma.brokerHolding.create({
    data: {
      userId: C.userId, brokerConnectionId: cConn.id, symbol: "INFY",
      stockId: infy?.stockId ?? null, instrumentId: infy?.id ?? null,
      quantity: 0, avgCost: 1400.75, currentValue: 0, source: "broker", syncedAt: new Date(),
    },
  });
  const cStored = await prisma.brokerHolding.count({ where: { brokerConnectionId: cConn.id } });
  assert("PRECONDITION: 3 rows in the table, one of them a qty-0 ghost", cStored === 3, `${cStored} rows`);

  const cPos = (await listUnifiedPositions(C.userId)).filter((p) => p.source === "broker");
  assert("★ the union emits only the 2 REAL positions — the stored ghost is filtered at the read",
    cPos.length === 2 && !cPos.some((p) => p.symbol === "INFY"), `${cPos.length}: ${cPos.map((p) => p.symbol).join(",")}`);

  const cPosExited = (await listUnifiedPositions(C.userId, { includeExited: true })).filter((p) => p.source === "broker");
  assert("…and `includeExited` surfaces it, on the SAME terms the manual branch has always offered",
    cPosExited.length === 3 && cPosExited.some((p) => p.symbol === "INFY"), `${cPosExited.length} with includeExited`);

  // ═══════════════════════════════════════════════════════════════════════════
  // D — §13 HALF 1: THE BASELINE BOOKS ARE BYTE-IDENTICAL
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ D — §13 half 1: books with no ghosts are BYTE-IDENTICAL ═══");
  // ⚠️ THIS SECTION WAS SPECIFIED WRONG THE FIRST TIME, AND THE FAILURE WAS THE USEFUL PART.
  // It began by re-asserting the historical baseline 73·73·69·65·50. Three of the five books failed
  // — correctly. Those numbers are a 2026-07-16/18 snapshot that has since moved through ordinary
  // EOD rescoring (108fd2a6 50→51, e3c6bd3c 69→70), and the premise that all five are stock-only
  // manual books is simply false: e3c6bd3c carries 4 mock broker rows, and 7985d813 IS the live
  // Zerodha demat this whole fix is about — its 65 predates the sell. Pinning those constants would
  // have been `cv2-s10a-fixture-scale` again: encoding yesterday's output as today's expectation.
  //
  // THE PROPERTY THAT ACTUALLY HOLDS IS FILTER-INVARIANCE. The one line this fix changed on the read
  // lives inside the brokerHolding query. For a book with no qty-0 broker rows that query returns
  // the same rows with the filter on or off — so the change is a PROVABLE no-op on that book, not an
  // observed one. Asserted directly, by running the read both ways and comparing.
  const runStart = new Date(Date.now() - 60_000);
  const baselineUsers = (await prisma.$queryRawUnsafe<{ user_id: string }[]>(`SELECT DISTINCT user_id FROM transactions`))
    .map((u) => u.user_id).sort();

  const ghostBooks: string[] = [];
  for (const uid of baselineUsers) {
    const tag = uid.slice(0, 8);
    const ghosts = await prisma.brokerHolding.count({ where: { userId: uid, quantity: { lte: 0 } } });
    const brokerRows = await prisma.brokerHolding.count({ where: { userId: uid } });
    if (ghosts > 0) { ghostBooks.push(uid); }

    // The broker slice, read BOTH ways. `includeExited: true` restores the pre-fix behaviour of
    // this branch exactly (no quantity predicate at all), so the two reads ARE old-vs-new.
    const slice = (ps: Awaited<ReturnType<typeof listUnifiedPositions>>) =>
      JSON.stringify(ps.filter((p) => p.source === "broker").map((p) => [p.symbol, p.quantity, p.investedValue]).sort());
    const now = slice(await listUnifiedPositions(uid));
    const pre = slice(await listUnifiedPositions(uid, { includeExited: true }));

    if (ghosts === 0) {
      assert(`${tag} · no ghosts (${brokerRows} broker rows) ⇒ broker slice BYTE-IDENTICAL, filter on vs off`,
        now === pre, now === pre ? "unchanged by the filter" : "SLICE MOVED");
    } else {
      assert(`${tag} · ${ghosts} ghost(s) ⇒ the filter removes exactly those, and nothing else`,
        now !== pre &&
          JSON.parse(pre).length - JSON.parse(now).length === ghosts,
        `${JSON.parse(pre).length} → ${JSON.parse(now).length} broker positions`);
    }

    // And prove this run rewrote no persisted score: the drift above is history, not this change.
    const freshWrites = await prisma.portfolioHealthSnapshot.count({ where: { userId: uid, createdAt: { gt: runStart } } });
    assert(`${tag} · no persisted snapshot was rewritten by this change`, freshWrites === 0, `${freshWrites} new rows`);
  }
  assert("the live sold-out demat is among the books carrying ghosts (the reported account)",
    ghostBooks.length >= 1, `${ghostBooks.length} book(s) with ghost rows: ${ghostBooks.map((u) => u.slice(0, 8)).join(", ")}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // E — §13 HALF 2: A GHOST BOOK GETS THE HONEST SCORE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ E — §13 half 2: the ghost book scores what it would have scored without ghosts ═══");
  // TWO books, identical in every REAL holding. One carries qty-0 ghosts, the other never had them.
  // If the filter works, they are the same book — and the ghost book's Construction is no longer
  // flattered by the ghosts inflating N and lowering C1's threshold max(15, 1.5 × 100/N).
  const G = await seedUser("g"); created.push(G.authId); // ghost book
  const H = await seedUser("h"); created.push(H.authId); // clean book
  const gAcct = await mk(G.userId, "Ghost Book", "mock");
  const hAcct = await mk(H.userId, "Clean Book", "mock");
  const gConn = await integrate(G.userId, "mock", { ...DISC, params: { mockAccountRef: `G_${randomUUID().slice(0, 6)}`, mockHoldings: [R, T, I] } });
  const hConn = await integrate(H.userId, "mock", { ...DISC, params: { mockAccountRef: `H_${randomUUID().slice(0, 6)}`, mockHoldings: [R, T, I] } });
  await link(G.userId, gAcct, gConn.id);
  await link(H.userId, hAcct, hConn.id);
  await syncHoldings(G.userId, gConn.id);
  await syncHoldings(H.userId, hConn.id);

  // The ghosts: real, PRICED, catalogued instruments at qty 0 — so that pre-fix they would have
  // entered the assembled book as genuine positions (marketValue 0, weight 0) and inflated N.
  const ghostable = await prisma.instrument.findMany({
    where: { stockId: { not: null }, isin: { notIn: ["INE002A01018", "INE467B01029", "INE009A01021"] },
             stock: { stockPrices: { some: {} } } },
    select: { id: true, stockId: true, symbol: true }, take: 2,
  });
  assert("PRECONDITION: found 2 priced, catalogued instruments to use as ghosts", ghostable.length === 2,
    ghostable.map((g) => g.symbol).join(","));
  for (const g of ghostable) {
    await prisma.brokerHolding.create({
      data: { userId: G.userId, brokerConnectionId: gConn.id, symbol: g.symbol ?? "GHOST",
              stockId: g.stockId, instrumentId: g.id, quantity: 0, avgCost: 500, currentValue: 0,
              source: "broker", syncedAt: new Date() },
    });
  }
  const gStored = await prisma.brokerHolding.count({ where: { brokerConnectionId: gConn.id } });
  assert("PRECONDITION: the ghost book has 5 stored rows (3 real + 2 ghosts)", gStored === 5, `${gStored} rows`);

  const gAsm = await assemblePortfolio(G.userId);
  const hAsm = await assemblePortfolio(H.userId);
  const gPhs = computePhs(gAsm.holdings);
  const hPhs = computePhs(hAsm.holdings);

  assert("★ N drops by the ghost count — the ghost book has the SAME position count as the clean one",
    gAsm.holdings.length === hAsm.holdings.length,
    `ghost N=${gAsm.holdings.length} · clean N=${hAsm.holdings.length}`);
  assert("★ C1's threshold is identical — max(15, 1.5×100/N) lands where it always should have",
    gPhs.construction.gross.c1.detail === hPhs.construction.gross.c1.detail,
    `${gPhs.construction.gross.c1.detail}`);
  assert("★ THE DELIVERABLE: the ghost book's Construction === the score it would have had with no ghosts",
    Math.abs(gPhs.construction.net - hPhs.construction.net) < 1e-9,
    `ghost ${gPhs.construction.net.toFixed(4)} · clean ${hPhs.construction.net.toFixed(4)}`);
  assert("…and C6 (holding count) agrees too — ghosts no longer read as breadth",
    gPhs.construction.c6.points === hPhs.construction.c6.points,
    `C6 ghost ${gPhs.construction.c6.points} · clean ${hPhs.construction.c6.points}`);

  // ── THE PRE-FIX NUMBER, REPRODUCED — so this witnesses a WRONG score becoming RIGHT ──────────
  // Asserting the two post-fix books agree proves the filter is consistent; it does NOT prove it
  // changed anything. So feed the engine exactly what the OLD read handed it: the real book plus
  // the ghosts as zero-value positions (our price × qty 0 = ₹0 — what assemble produced for them).
  // Same engine, same book, the only difference being the ghosts the read used to emit.
  const asGhost = (g: { id: string; stockId: string | null; symbol: string | null }) => ({
    ...hAsm.holdings[0], symbol: g.symbol ?? "GHOST", marketValue: 0,
    isin: null as string | null, health: null as number | null, findings: [], pillars: null,
  });
  const preFixBook = [...hAsm.holdings, ...ghostable.map(asGhost)];
  const preFix = computePhs(preFixBook);

  assert("PRE-FIX REPRODUCTION: the old read gave the engine N=5 on a 3-position book",
    preFixBook.length === 5 && hAsm.holdings.length === 3, `pre-fix N=${preFixBook.length} · real N=${hAsm.holdings.length}`);
  assert("★ …and it scored DIFFERENTLY — the ghosts were moving the number, not sitting inert",
    Math.abs(preFix.construction.net - hPhs.construction.net) > 1e-9,
    `pre-fix ${preFix.construction.net.toFixed(4)} · post-fix ${hPhs.construction.net.toFixed(4)}`);
  assert("★ THE DIRECTION: ghosts UNDERSTATE Construction (they lower C1's bar ⇒ larger deduction)",
    preFix.construction.net < hPhs.construction.net,
    `pre-fix ${preFix.construction.net.toFixed(4)} < post-fix ${hPhs.construction.net.toFixed(4)} — the fix RAISES it`);
  assert("★ …and C1's threshold is the whole mechanism: 150/N moved with the ghost count",
    preFix.construction.gross.c1.detail !== hPhs.construction.gross.c1.detail,
    `pre-fix "${preFix.construction.gross.c1.detail}" vs post-fix "${hPhs.construction.gross.c1.detail}"`);

  // ═══════════════════════════════════════════════════════════════════════════
  // F — ATOMICITY INTACT (the write path was not touched)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ F — A failed sync leaves the PRIOR snapshot whole (never a half-mirror) ═══");
  const F = await seedUser("f"); created.push(F.authId);
  const fAcct = await mk(F.userId, "Atomic Demat", "mock");
  const REF_F = `DEMAT_ATOM_${randomUUID().slice(0, 6)}`;
  const fConn = await integrate(F.userId, "mock", { ...DISC, params: { mockAccountRef: REF_F, mockHoldings: [R, T, I] } });
  await link(F.userId, fAcct, fConn.id);
  await syncHoldings(F.userId, fConn.id);
  const fBefore = await prisma.brokerHolding.findMany({
    where: { brokerConnectionId: fConn.id }, orderBy: { symbol: "asc" },
    select: { symbol: true, quantity: true, avgCost: true },
  });

  // A dead session fails at fetchHoldings — BEFORE the transaction opens. The prior snapshot must
  // survive untouched: not emptied by the delete, not half-replaced.
  await integrate(F.userId, "mock", { ...DISC, params: { mockAccountRef: REF_F, mockExpired: true, mockHoldings: [R] } });
  let fErr: BrokerLifecycleError | null = null;
  try { await syncHoldings(F.userId, fConn.id); } catch (e) { fErr = e as BrokerLifecycleError; }
  assert("the sync FAILED LOUD on the dead session", fErr?.code === "session_dead", `code=${fErr?.code}`);

  const fAfter = await prisma.brokerHolding.findMany({
    where: { brokerConnectionId: fConn.id }, orderBy: { symbol: "asc" },
    select: { symbol: true, quantity: true, avgCost: true },
  });
  assert("★ the prior snapshot is BYTE-IDENTICAL after the failure — no half-mirror, no empty table",
    JSON.stringify(fBefore) === JSON.stringify(fAfter),
    `${fBefore.length} rows before · ${fAfter.length} after`);

  // ═══════════════════════════════════════════════════════════════════════════
  // G — READ-ONLY INTACT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ G — The integration is still a READ-ONLY mirror ═══");
  const WRITE_VERBS = /^(place|create|modify|cancel|sell|buy|order|exit|square|withdraw|transfer|convert)/i;
  for (const id of ["mock", "zerodha"] as const) {
    const adapter: any = getAdapter(id);
    const methods = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)),
      ...Object.keys(adapter),
    ].filter((m) => m !== "constructor");
    const writers = methods.filter((m) => WRITE_VERBS.test(m));
    assert(`${id}: no write method to the broker exists`, writers.length === 0,
      writers.length ? `FOUND: ${writers.join(", ")}` : `methods: ${methods.join(", ")}`);
  }
} finally {
  for (const a of created) await cleanup(a);
  console.log(`\n${failures === 0 ? "✅ ALL ASSERTIONS PASSED" : `❌ ${failures} ASSERTION(S) FAILED`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
