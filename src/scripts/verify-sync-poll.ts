// ─────────────────────────────────────────────────────────────────────────────
// SYNC / REFRESH / POLL + ADD-TO-UNIVERSE HARNESS (Step 7)
//
//   A  ADD-TO-UNIVERSE: unknown symbol WITH an ISIN → bare stock (name=symbol, sector NULL, no
//      PG) + instrument row → the holding resolves → held, NOT scored. Idempotent on the ISIN.
//   B  NULL-SECTOR TOLERANCE: the new shape (0 of 504 stocks have a null sector today) flows
//      through every read — holdings, union, PHS, portfolio snapshot — without crashing. PROVEN,
//      not assumed.
//   C  ISIN-LESS FALLBACK: unknown symbol with NO isin → null-stock held-not-scored, unchanged.
//      ONE bad row does NOT fail the sync — the rest still mirrors. The Step-6 guard still fires.
//   D  SYMBOL DRIFT: an unknown TICKER whose ISIN we already hold resolves to the EXISTING stock
//      (LTIM→LTM) — no duplicate row. This is what the ISIN spine is FOR.
//   E  REFRESH: works while the session is DEAD, makes NO broker call, and leaves the mirror
//      (quantity / avg_cost / current_value) byte-for-byte untouched.
//   F  SYNC on a dead session → reconnect error; account STAYS linked_live (§2.5, NOT the sever).
//   G  ZERO-SYNTHESIS: a resync with changed quantities fabricates no lots and no transactions.
//   H  POLL SWEEP: due connections are synced; a just-synced one is skipped (dedup); a DEAD-session
//      one is not polled and is NEVER severed; a severed one is not resurrected.
//   I  IDOR: sync/refresh never cross connection owners.
//
//   npx tsx src/scripts/verify-sync-poll.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { prisma } from "../db/prisma.js";
import { integrate, syncHoldings, refreshHoldings, deactivate, BrokerLifecycleError } from "../brokers/lifecycle.js";
import { listUnifiedPositions } from "../brokers/union.js";
import { assemblePortfolio } from "../portfolio/phs/assemble.js";
import { handleBrokerPollSync } from "../jobs/handlers/broker-poll-sync.handler.js";
import { getHandler } from "../jobs/dispatcher.js";
import { JobTypes } from "../jobs/types.js";
import { createAccount, linkAccount } from "../controllers/me/accounts-controller.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";
import { getPortfolioSnapshot } from "../controllers/me/portfolio-snapshot-controller.js";

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
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `sync-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { authId, userId: u.id };
}
const cleanup = (a: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, a);
const DISC = { accepted: true, disclaimerVersion: "v1" };
const mk = async (userId: string, name: string, broker: string) => (await call(createAccount, userId, { body: { name, broker } })).body.data.id as string;
const link = (userId: string, id: string, connectionId: string) => call(linkAccount, userId, { params: { id }, body: { connectionId } });

/** A fake job context — the harness drives the handler directly (the worker is not under test). */
const jobCtx = (payload: any = {}) => ({
  payload,
  reportProgress: async () => {},
  shouldCancel: async () => false,
  signal: new AbortController().signal,
} as any);

// Unique per run so repeated runs never collide on the ISIN spine.
const RUN = randomUUID().slice(0, 8).toUpperCase();
const NEWSYM = `ZZNEW${RUN.slice(0, 4)}`;
// A REAL-GRAMMAR equity ISIN: IN | E | <4-char issuer> | 01 | <3-char serial>  = 12 chars.
// (Was `INE${RUN}Z01` — 14 chars, "01" in the wrong place. See verify-step13-etf for the autopsy:
// the old Pass 3 validated nothing, so a malformed ISIN could reach `stocks.isin`. It cannot now.)
const NEWISIN = `INE${RUN.slice(0, 4)}01${RUN.slice(4, 7)}`;

const created: string[] = [];
const createdStockIds: string[] = [];
try {
  // ═══════════════════════════════════════════════════════════════════════════
  // A — ADD-TO-UNIVERSE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("═══ A — Add-to-universe: an unknown symbol WITH an ISIN joins the universe ═══");
  const U = await seedUser("u"); created.push(U.authId);
  const acct = await mk(U.userId, "Mock Demat", "mock");
  const stocksBefore = await prisma.stock.count();

  const conn = await integrate(U.userId, "mock", { ...DISC, params: {
    mockAccountRef: "DEMAT_U",
    mockHoldings: [
      { tradingsymbol: "RELIANCE", isin: "INE002A01018", exchange: "NSE", quantity: 10, average_price: 2400.5, last_price: 2950, product: "CNC" },
      // The stranger, WITH an identity → admissible.
      { tradingsymbol: NEWSYM, isin: NEWISIN, exchange: "NSE", quantity: 25, average_price: 150, last_price: 175, product: "CNC" },
      // The stranger with NO identity → must fall back, and must NOT fail the sync.
      { tradingsymbol: "FAKESTOCK", quantity: 3, average_price: 100, last_price: 90, product: "CNC" },
    ],
  } });
  await link(U.userId, acct, conn.id);
  const out = await syncHoldings(U.userId, conn.id);

  const stocksAfter = await prisma.stock.count();
  assert("the sync SUCCEEDED despite one unidentifiable row (a mirror with a gap beats no mirror)",
    out.synced === 3, `synced=${out.synced}`);
  assert("exactly ONE stock was admitted to the universe (+1)", stocksAfter === stocksBefore + 1, `${stocksBefore} → ${stocksAfter}`);
  assert("...and the sync REPORTS the admission (growing the universe is never silent)",
    out.admitted.length === 1 && out.admitted[0].symbol === NEWSYM && out.admitted[0].isin === NEWISIN,
    JSON.stringify(out.admitted));

  const bare = await prisma.stock.findUniqueOrThrow({
    where: { isin: NEWISIN },
    select: { id: true, symbol: true, name: true, isin: true, exchange: true, sectorId: true, isActive: true, _count: { select: { peerGroups: true, scoreSnapshots: true } } },
  });
  createdStockIds.push(bare.id);
  assert("R2: symbol = the broker tradingsymbol", bare.symbol === NEWSYM, `symbol=${bare.symbol}`);
  assert("R2: name = the SYMBOL (the broker sends no company name — the ticker is all we know)",
    bare.name === NEWSYM, `name=${bare.name}`);
  assert("R2: isin = the broker's ISIN (the spine)", bare.isin === NEWISIN, `isin=${bare.isin}`);
  assert("R2: exchange carried from the broker", bare.exchange === "NSE", `exchange=${bare.exchange}`);
  assert("R2: sector is NULL — we do not know it, and did NOT fabricate an 'Unclassified' bucket",
    bare.sectorId === null, `sectorId=${bare.sectorId}`);
  assert("R2: NO peer group ⇒ HELD-NOT-SCORED (no fabricated score)",
    bare._count.peerGroups === 0 && bare._count.scoreSnapshots === 0,
    `peerGroups=${bare._count.peerGroups} scores=${bare._count.scoreSnapshots}`);

  const inst = await prisma.instrument.findUniqueOrThrow({ where: { stockId: bare.id }, select: { isin: true, symbol: true, assetClass: true } });
  assert("the instrument catalog row was created too (the portfolio holds INSTRUMENTS)",
    inst.isin === NEWISIN && inst.assetClass === "stock", `isin=${inst.isin} class=${inst.assetClass}`);

  const bh = await prisma.brokerHolding.findFirstOrThrow({ where: { brokerConnectionId: conn.id, symbol: NEWSYM }, select: { stockId: true, instrumentId: true, quantity: true } });
  assert("the HOLDING now resolves to the new stock (stock_id + instrument_id BOTH set)",
    bh.stockId === bare.id && bh.instrumentId !== null, `stockId=${bh.stockId === bare.id} instrumentId=${bh.instrumentId !== null}`);

  // IDEMPOTENT: a second sync must find it, not fork it.
  const out2 = await syncHoldings(U.userId, conn.id);
  const stocksAfter2 = await prisma.stock.count();
  assert("IDEMPOTENT: a 2nd sync creates NO duplicate (the ISIN spine dedups)",
    stocksAfter2 === stocksAfter && out2.admitted.length === 0, `stocks=${stocksAfter2} admitted=${out2.admitted.length}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // B — NULL-SECTOR TOLERANCE (the new shape — PROVE it, don't assume it)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ B — A null-sector, PG-less stock flows through EVERY read ═══");
  const positions = await listUnifiedPositions(U.userId);
  const newPos = positions.find((p) => p.symbol === NEWSYM);
  assert("union: the bare stock appears as a real position", !!newPos && Number(newPos.quantity) === 25, `qty=${newPos?.quantity}`);
  assert("union: it carries a stockId + instrumentId (no longer held-not-VALUED)",
    !!newPos?.stockId && !!newPos?.instrumentId, `stockId=${!!newPos?.stockId} instrumentId=${!!newPos?.instrumentId}`);

  const asm = await assemblePortfolio(U.userId);
  assert("PHS assemble: did NOT crash on a null-sector, PG-less, price-less stock", !!asm, "assembled");
  const inScored = asm.holdings.some((h) => h.symbol === NEWSYM);
  const inHeldNotValued = asm.heldNotValued.some((h) => h.symbol === NEWSYM);
  assert("PHS: the bare stock is HELD-NOT-VALUED (we have no price for it — honest, not zero)",
    inHeldNotValued && !inScored, `scored=${inScored} heldNotValued=${inHeldNotValued}`);

  const hold = await call(listHoldings, U.userId);
  assert("GET /holdings: 200, and the bare stock is listed (held, displayed)",
    hold.statusCode === 200 && JSON.stringify(hold.body).includes(NEWSYM), `status=${hold.statusCode}`);
  const snap = await call(getPortfolioSnapshot, U.userId);
  assert("GET /portfolio (PHS snapshot): 200 — the null-sector stock did not break the score path",
    snap.statusCode === 200, `status=${snap.statusCode} err=${snap.body?.error}`);
  assert("...and NO score was fabricated for it (it has no peer group)",
    (await prisma.scoreSnapshot.count({ where: { stockId: bare.id } })) === 0, "0 score snapshots");

  // ═══════════════════════════════════════════════════════════════════════════
  // C — ISIN-LESS FALLBACK (the honest gap)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ C — No ISIN ⇒ no stock. The honest gap, not a fabricated spine ═══");
  assert("FAKESTOCK (no ISIN) is reported as unidentifiable, BY NAME",
    out.unmapped.includes("FAKESTOCK"), `unmapped=${JSON.stringify(out.unmapped)}`);
  const fake = await prisma.brokerHolding.findFirstOrThrow({ where: { brokerConnectionId: conn.id, symbol: "FAKESTOCK" }, select: { stockId: true, instrumentId: true, quantity: true } });
  assert("...its holding is STORED with stock_id NULL (held-not-scored — never dropped)",
    fake.stockId === null && fake.instrumentId === null && Number(fake.quantity) === 3, `stockId=${fake.stockId} qty=${fake.quantity}`);
  assert("...and NO stock was invented for it (no synthetic ISIN poisoned the spine)",
    (await prisma.stock.count({ where: { symbol: "FAKESTOCK" } })) === 0, "0 FAKESTOCK stocks");

  // ═══════════════════════════════════════════════════════════════════════════
  // D — SYMBOL DRIFT: an unknown TICKER with a KNOWN ISIN is a rename, not a new company
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ D — Symbol drift: unknown ticker + known ISIN → the EXISTING stock ═══");
  const D = await seedUser("d"); created.push(D.authId);
  const dAcct = await mk(D.userId, "Mock Demat", "mock");
  // Same ISIN as the stock we just admitted, but a DIFFERENT ticker — the LTIM→LTM case.
  const RENAMED = `ZZREN${RUN.slice(0, 4)}`;
  const dConn = await integrate(D.userId, "mock", { ...DISC, params: {
    mockAccountRef: "DEMAT_D",
    mockHoldings: [{ tradingsymbol: RENAMED, isin: NEWISIN, exchange: "NSE", quantity: 9, average_price: 160, last_price: 175, product: "CNC" }],
  } });
  await link(D.userId, dAcct, dConn.id);
  const stocksBeforeDrift = await prisma.stock.count();
  const dOut = await syncHoldings(D.userId, dConn.id);
  const stocksAfterDrift = await prisma.stock.count();

  assert("a renamed ticker did NOT create a second stock (the ISIN spine caught it)",
    stocksAfterDrift === stocksBeforeDrift && dOut.admitted.length === 0, `stocks ${stocksBeforeDrift} → ${stocksAfterDrift}, admitted=${dOut.admitted.length}`);
  assert("...it is reported as matchedByIsin (a rename, disclosed)",
    dOut.matchedByIsin.includes(RENAMED), `matchedByIsin=${JSON.stringify(dOut.matchedByIsin)}`);
  const drifted = await prisma.brokerHolding.findFirstOrThrow({ where: { brokerConnectionId: dConn.id, symbol: RENAMED }, select: { stockId: true } });
  assert("...and the holding resolved to the EXISTING stock — one company, one row",
    drifted.stockId === bare.id, `resolved to the same stockId=${drifted.stockId === bare.id}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // E + F + G — REFRESH (offline) · SYNC on a dead session · ZERO-SYNTHESIS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ E/F/G — Refresh offline · dead-session sync · zero-synthesis ═══");
  // G first: a resync with CHANGED quantities must mirror, never synthesize.
  const lotsBefore = await prisma.holdingLot.count({ where: { holding: { userId: U.userId } } });
  const txnsBefore = await prisma.transaction.count({ where: { userId: U.userId } });
  // Re-integrate the SAME demat with different quantities (upsert → same connection row).
  await integrate(U.userId, "mock", { ...DISC, params: {
    mockAccountRef: "DEMAT_U",
    mockHoldings: [{ tradingsymbol: "RELIANCE", isin: "INE002A01018", exchange: "NSE", quantity: 99, average_price: 2400.5, last_price: 2950, product: "CNC" }],
  } });
  const reOut = await syncHoldings(U.userId, conn.id);
  const relRow = await prisma.brokerHolding.findFirstOrThrow({ where: { brokerConnectionId: conn.id, symbol: "RELIANCE" }, select: { quantity: true } });
  assert("G: a changed broker qty is MIRRORED (10 → 99), overwrite-not-append",
    Number(relRow.quantity) === 99 && reOut.synced === 1, `qty=${relRow.quantity} rows=${reOut.synced}`);
  assert("G: ZERO SYNTHESIS — no lots, no transactions were fabricated by any sync",
    (await prisma.holdingLot.count({ where: { holding: { userId: U.userId } } })) === lotsBefore &&
    (await prisma.transaction.count({ where: { userId: U.userId } })) === txnsBefore,
    `lots=${lotsBefore} txns=${txnsBefore} (unchanged)`);

  // Now KILL the session (expired token) — the §2.5 case.
  const E = await seedUser("e"); created.push(E.authId);
  const eAcct = await mk(E.userId, "Mock Demat", "mock");
  const eConn = await integrate(E.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_E" } });
  await link(E.userId, eAcct, eConn.id);
  await syncHoldings(E.userId, eConn.id);
  const mirrorBefore = await prisma.brokerHolding.findMany({
    where: { brokerConnectionId: eConn.id }, orderBy: { symbol: "asc" },
    select: { symbol: true, quantity: true, avgCost: true, currentValue: true, syncedAt: true },
  });
  // Expire the token (the mock derives liveness from expiresAt) — re-auth with mockExpired.
  await integrate(E.userId, "mock", { ...DISC, params: { mockAccountRef: "DEMAT_E", mockExpired: true } });

  // F — SYNC on a dead session
  let deadErr: BrokerLifecycleError | null = null;
  try { await syncHoldings(E.userId, eConn.id); } catch (err) { deadErr = err as BrokerLifecycleError; }
  assert("F: sync on a DEAD session → session_dead ('reconnect to refresh')",
    deadErr?.code === "session_dead" && deadErr?.httpStatus === 409, `code=${deadErr?.code} status=${deadErr?.httpStatus}`);
  const eAcctRow = await prisma.portfolioAccount.findUniqueOrThrow({ where: { id: eAcct }, select: { state: true, brokerConnectionId: true } });
  assert("F/§2.5: TOKEN DEATH ≠ SEVER — the account STAYS linked_live (NOT linked_stale)",
    eAcctRow.state === "linked_live" && eAcctRow.brokerConnectionId !== null, `state=${eAcctRow.state}`);
  assert("F: ...and NO holdings were dropped by the dead session",
    (await prisma.brokerHolding.count({ where: { brokerConnectionId: eConn.id } })) === mirrorBefore.length, `holdings=${mirrorBefore.length}`);

  // E — REFRESH works while DEAD, and does not touch the mirror
  const ref = await refreshHoldings(E.userId, eConn.id);
  assert("E: REFRESH SUCCEEDS on a DEAD session (the offline path — no broker call)",
    ref.brokerContacted === false && ref.sessionState === "dead" && ref.holdings === mirrorBefore.length,
    `brokerContacted=${ref.brokerContacted} session=${ref.sessionState} holdings=${ref.holdings}`);
  const mirrorAfter = await prisma.brokerHolding.findMany({
    where: { brokerConnectionId: eConn.id }, orderBy: { symbol: "asc" },
    select: { symbol: true, quantity: true, avgCost: true, currentValue: true, syncedAt: true },
  });
  assert("E/§2.2: THE MIRROR IS UNTOUCHED — qty, avg_cost, current_value, syncedAt all byte-identical",
    JSON.stringify(mirrorBefore) === JSON.stringify(mirrorAfter),
    JSON.stringify(mirrorBefore) === JSON.stringify(mirrorAfter) ? "our price did NOT overwrite the broker's figure" : "⚠️ MIRROR MUTATED");
  assert("E: ...and the data's age is still disclosed (lastSyncedAt carried through)",
    ref.lastSyncedAt !== null, `lastSyncedAt=${ref.lastSyncedAt}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // H — THE POLL SWEEP
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ H — The poll sweep: due / deduped / dead / severed ═══");
  assert("the job type is registered in the dispatcher (reuses the existing job chain)",
    getHandler(JobTypes.BROKER_POLL_SYNC) !== null, `handler=${getHandler(JobTypes.BROKER_POLL_SYNC) !== null}`);

  // U's connection is LIVE and was just synced → NOT due (dedup on lastSyncedAt).
  const sweepNow = await handleBrokerPollSync(jobCtx({}));
  const uDue = sweepNow.details.some((d) => d.connectionId === conn.id);
  assert("DEDUP: a connection synced moments ago is NOT selected by the 2h filter",
    !uDue, `U's connection in worklist=${uDue}`);

  // Force it stale → now it IS due.
  const sweepStale = await handleBrokerPollSync(jobCtx({ staleAfterMinutes: 0 }));
  const uSynced = sweepStale.details.find((d) => d.connectionId === conn.id);
  assert("DUE: with the cadence elapsed, the live connection IS swept and synced",
    !!uSynced && sweepStale.synced >= 1, `outcome=${uSynced?.outcome}`);

  // E's connection has a DEAD session → must NOT be polled, and must NOT be severed.
  const eInSweep = sweepStale.details.some((d) => d.connectionId === eConn.id);
  assert("DEAD SESSION: not polled (it is filtered out, not failed)", !eInSweep, `dead connection in worklist=${eInSweep}`);
  const eAfterSweep = await prisma.portfolioAccount.findUniqueOrThrow({ where: { id: eAcct }, select: { state: true } });
  assert("DEAD SESSION: the sweep NEVER severs it — account still linked_live (§2.5)",
    eAfterSweep.state === "linked_live", `state=${eAfterSweep.state}`);

  // A SEVERED connection must not be resurrected by the poll.
  await deactivate(D.userId, dConn.id);
  const sweepSevered = await handleBrokerPollSync(jobCtx({ staleAfterMinutes: 0 }));
  assert("SEVERED: a deactivated connection is NOT resurrected by the poll (it is frozen on purpose)",
    !sweepSevered.details.some((d) => d.connectionId === dConn.id), "severed connection not swept");

  // ═══════════════════════════════════════════════════════════════════════════
  // I — IDOR
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══ I — IDOR ═══");
  let idorSync: BrokerLifecycleError | null = null;
  try { await syncHoldings(D.userId, conn.id); } catch (err) { idorSync = err as BrokerLifecycleError; }
  assert("D cannot sync U's connection → 404 not_found (no existence disclosure)",
    idorSync?.code === "not_found" && idorSync?.httpStatus === 404, `code=${idorSync?.code}`);
  let idorRefresh: BrokerLifecycleError | null = null;
  try { await refreshHoldings(D.userId, conn.id); } catch (err) { idorRefresh = err as BrokerLifecycleError; }
  assert("D cannot refresh U's connection → 404", idorRefresh?.code === "not_found", `code=${idorRefresh?.code}`);
  assert("the poll sweep takes NO user id at all — it reads the owner off each connection row",
    handleBrokerPollSync.length === 1, "single ctx arg; userId is never an input");

  console.log(`\n${failures === 0 ? "✅ ALL SYNC/POLL + ADD-TO-UNIVERSE CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
} finally {
  // Clean up the stocks this run admitted (they are real universe rows).
  for (const id of createdStockIds) {
    await prisma.instrument.deleteMany({ where: { stockId: id } });
    await prisma.stock.deleteMany({ where: { id } });
  }
  for (const a of created) await cleanup(a);
  await prisma.$disconnect();
}
process.exit(failures === 0 ? 0 : 1);
