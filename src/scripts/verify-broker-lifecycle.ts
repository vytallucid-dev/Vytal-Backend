// ─────────────────────────────────────────────────────────────────────────────
// BROKER INTEGRATION HARNESS (Phase 1) — proves the broker-agnostic core end-to-end
// against the MockAdapter, on throwaway seeded users (cleaned up via auth.users cascade).
//
// Proves: fail-closed encryption (missing key → 503, never a crash) · crypto round-trip +
// tamper-reject · full lifecycle integrate→active→sync→deactivate→clear · encryption AT
// REST (the token is ciphertext in the DB) · disclaimer version stored · snapshot-mirror
// OVERWRITE (re-sync replaces, never appends) · clear BLOCKED while active + confirm-gated
// · session-dead path · IDOR (a user cannot see/touch another's connection or holdings) ·
// unsupported-broker + disclaimer guards · the union read (built, not yet wired).
//
//   npx tsx src/scripts/verify-broker-lifecycle.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID, randomBytes } from "crypto";
import { prisma } from "../db/prisma.js";
import {
  integrate,
  syncHoldings,
  deactivate,
  activate,
  clearData,
  status,
  BrokerLifecycleError,
  type BrokerErrorCode,
} from "../brokers/lifecycle.js";
import {
  integrateBroker,
  syncBroker,
} from "../controllers/me/brokers-controller.js";
import { decryptSecret, encryptSecret, decryptJson, BrokerEncryptionUnavailableError } from "../brokers/crypto.js";
import { MOCK_TOKEN_MARKER } from "../brokers/adapters/mock.js";
import { listUnifiedPositions } from "../brokers/union.js";
import type { BrokerSession } from "../brokers/types.js";

let failures = 0;
function assert(name: string, cond: boolean, detail: string) {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
}

/** Assert a thunk throws a BrokerLifecycleError with the given code. */
async function assertLifecycleError(name: string, code: BrokerErrorCode, fn: () => Promise<unknown>) {
  try {
    await fn();
    assert(name, false, `expected ${code}, but it resolved`);
  } catch (e) {
    if (e instanceof BrokerLifecycleError) {
      assert(name, e.code === code, `threw ${e.code} (exp ${code}, http ${e.httpStatus})`);
    } else {
      assert(name, false, `threw ${(e as Error).name}: ${(e as Error).message} (exp ${code})`);
    }
  }
}

// ── mock req/res (mirrors verify-portfolio-fifo) ──
function mockRes() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}
function mockReq(userId: string, opts: { body?: any; params?: any; query?: any } = {}) {
  return { authUser: { userId }, body: opts.body ?? {}, params: opts.params ?? {}, query: opts.query ?? {} } as any;
}

/** Step 2b: a connection must be BOUND to an account before it can sync (§2.3 — the user
 *  chooses; we never silent-pick). Create a fresh account and bind this connection to it. */
async function linkFresh(userId: string, connectionId: string, name: string): Promise<string> {
  // Step 5.5: an account belongs to a broker from creation, and link CHECKS the match — these
  // books are bound to MOCK connections, so they are `mock` books.
  const acct = await prisma.portfolioAccount.create({ data: { userId, name, broker: "mock", state: "manual" }, select: { id: true } });
  await prisma.portfolioAccount.update({
    where: { id: acct.id },
    data: { brokerConnectionId: connectionId, state: "linked_live" },
  });
  return acct.id;
}

async function seedUser(tag: string): Promise<{ authId: string; userId: string }> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `broker-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error("signup trigger did not create public.users");
  return { authId, userId: u.id };
}
const cleanupUser = (authId: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId);

const DISC = "broker-disclaimer-v1.0";

async function main() {
  const created: string[] = [];
  try {
    // ═══ A — FAIL-CLOSED ENCRYPTION (missing key degrades the feature, never crashes) ═══
    console.log("═══ A — Fail-closed encryption (missing key) ═══");
    const savedKey = process.env.BROKER_TOKEN_ENC_KEY;
    delete process.env.BROKER_TOKEN_ENC_KEY; // simulate an un-provisioned key (crypto not yet cached)

    await assertThrows("service: integrate throws BrokerEncryptionUnavailableError (no key)", BrokerEncryptionUnavailableError, () =>
      integrate("no-such-user", "mock", { accepted: true, disclaimerVersion: DISC }),
    );

    const resNoKey = mockRes();
    await integrateBroker(mockReq("no-such-user", { body: { accepted: true, disclaimerVersion: DISC }, params: { broker: "mock" } }), resNoKey);
    assert("controller: missing key → 503 feature_unavailable (NOT 500)", resNoKey.statusCode === 503 && resNoKey.body?.error === "feature_unavailable", `status ${resNoKey.statusCode}, error ${resNoKey.body?.error}`);

    // Provision a valid key for the remainder (first successful use caches it).
    process.env.BROKER_TOKEN_ENC_KEY = randomBytes(32).toString("base64");

    // ── crypto round-trip + tamper-reject ──
    const blob = encryptSecret("super-secret-token");
    assert("crypto: round-trips", decryptSecret(blob) === "super-secret-token", "encrypt→decrypt == original");
    assert("crypto: blob is versioned ciphertext (not plaintext)", blob.startsWith("v1:") && !blob.includes("super-secret-token"), blob.slice(0, 12) + "…");
    const tampered = blob.slice(0, -4) + (blob.endsWith("AAAA") ? "BBBB" : "AAAA");
    await assertThrows("crypto: tampered blob is rejected (GCM auth)", Error, async () => decryptSecret(tampered));
    void savedKey;

    // ═══ B — FULL LIFECYCLE + encryption at rest + snapshot overwrite ═══
    console.log("\n═══ B — Full lifecycle (integrate→active→sync→deactivate→clear) ═══");
    const A = await seedUser("a"); created.push(A.authId);

    // integrate → active
    const v1 = await integrate(A.userId, "mock", { accepted: true, disclaimerVersion: DISC });
    assert("integrate → active + live + disclaimer stored", v1.state === "active" && v1.enabled && v1.sessionState === "live" && v1.disclaimerVersion === DISC, `state=${v1.state} session=${v1.sessionState} disc=${v1.disclaimerVersion}`);
    assert("integrate returns the connection id (the address for every op)", !!v1.id, `id=${v1.id?.slice(0, 8)}…`);
    assert("...and it is integrated-but-UNLINKED (no account chosen yet)", v1.linkedAccountId === null, `linkedAccountId=${v1.linkedAccountId}`);

    // Step 2b: a connection cannot sync until the user CHOOSES an account for it (§2.3).
    await assertLifecycleError("sync BEFORE linking → account_not_linked (409)", "account_not_linked", () => syncHoldings(A.userId, v1.id));
    const acctA = await linkFresh(A.userId, v1.id, "Zerodha Main");

    // encryption AT REST — the stored blob is ciphertext, the token is not readable in the DB
    const row = await prisma.brokerConnection.findFirst({ where: { userId: A.userId, broker: "mock" } });
    assert("token encrypted at rest — blob is v1-ciphertext, marker ABSENT from DB", !!row && row.sessionBlob.startsWith("v1:") && !row.sessionBlob.includes(MOCK_TOKEN_MARKER), row ? `blob=${row.sessionBlob.slice(0, 10)}… containsMarker=${row.sessionBlob.includes(MOCK_TOKEN_MARKER)}` : "no row");
    assert("disclaimer_accepted_at recorded", !!row?.disclaimerAcceptedAt, String(row?.disclaimerAcceptedAt));
    const decoded = decryptJson<BrokerSession>(row!.sessionBlob);
    assert("decrypt round-trip recovers the bound session token", decoded.accessToken.includes(MOCK_TOKEN_MARKER) && decoded.accessToken.includes(A.userId), decoded.accessToken.slice(0, 30) + "…");

    // sync → snapshot mirrored
    const fixtureSymbols = ["RELIANCE", "TCS", "INFY", "FAKESTOCK"];
    const present = await prisma.stock.findMany({ where: { symbol: { in: fixtureSymbols } }, select: { symbol: true } });
    const presentSet = new Set(present.map((s) => s.symbol));
    const s1 = await syncHoldings(A.userId, v1.id);
    assert("sync writes the full snapshot (4 fixture rows)", s1.synced === 4, `synced=${s1.synced}`);
    assert("sync maps only universe symbols; FAKESTOCK unmapped", s1.mapped === presentSet.size && s1.unmapped.includes("FAKESTOCK"), `mapped=${s1.mapped} present=${presentSet.size} unmapped=[${s1.unmapped}]`);
    assert("sync LANDS ON the bound account (derived from the connection)", s1.accountId === acctA, `accountId=${s1.accountId?.slice(0, 8)}… exp=${acctA.slice(0, 8)}…`);
    const bh = await prisma.brokerHolding.findMany({ where: { userId: A.userId }, select: { symbol: true, stockId: true, instrumentId: true, quantity: true } });
    const fake = bh.find((h) => h.symbol === "FAKESTOCK");
    assert("FAKESTOCK stored verbatim, NULL stock_id AND NULL instrument_id (held-not-scored)", !!fake && fake.stockId === null && fake.instrumentId === null, `stockId=${fake?.stockId} instrumentId=${fake?.instrumentId}`);
    const mappedRow = bh.find((h) => h.symbol === "RELIANCE");
    assert("a mapped symbol resolves to an INSTRUMENT (Step 1.5 catalog)", !!mappedRow?.instrumentId, `RELIANCE instrumentId=${mappedRow?.instrumentId ? "set" : "null"}`);
    const connAfterSync = await prisma.brokerConnection.findFirstOrThrow({ where: { id: v1.id } });
    assert("last_synced_at stamped", !!connAfterSync.lastSyncedAt, String(connAfterSync.lastSyncedAt));

    // ZERO-SYNTHESIS (§2.2 mirror-not-recompute): a broker sync must NEVER fabricate a manual
    // transaction or a FIFO lot. The mirror is stored beside the manual book, never inside it.
    const synthTxns = await prisma.transaction.count({ where: { userId: A.userId } });
    const synthLots = await prisma.holdingLot.count({ where: { holding: { userId: A.userId } } });
    const synthHold = await prisma.holding.count({ where: { userId: A.userId } });
    assert("ZERO SYNTHESIS: sync fabricated no transactions, no FIFO lots, no manual holdings", synthTxns === 0 && synthLots === 0 && synthHold === 0, `txns=${synthTxns} lots=${synthLots} holdings=${synthHold}`);

    // OVERWRITE-on-sync: reconnect with a DIFFERENT fixture, re-sync → replaces, not appends
    await integrate(A.userId, "mock", {
      accepted: true, disclaimerVersion: DISC,
      params: { mockHoldings: [{ tradingsymbol: "RELIANCE", quantity: 99, average_price: 100, last_price: 200, product: "CNC" }] },
    });
    const s2 = await syncHoldings(A.userId, v1.id);
    const bh2 = await prisma.brokerHolding.findMany({ where: { userId: A.userId } });
    assert("snapshot-mirror OVERWRITES (re-sync replaces, never appends)", s2.synced === 1 && bh2.length === 1 && bh2[0].symbol === "RELIANCE" && Number(bh2[0].quantity) === 99, `rows=${bh2.length} sym=${bh2[0]?.symbol} qty=${bh2[0]?.quantity}`);

    // clear BLOCKED while active (structural rule)
    await assertLifecycleError("clear BLOCKED while active (invalid_state 409)", "invalid_state", () => clearData(A.userId, v1.id, { confirm: true }));

    // deactivate → inactive, data RETAINED
    const dv = await deactivate(A.userId, v1.id);
    const bhAfterDeact = await prisma.brokerHolding.count({ where: { userId: A.userId } });
    assert("deactivate → inactive, holdings RETAINED", dv.state === "inactive" && !dv.enabled && bhAfterDeact === 1, `state=${dv.state} heldRows=${bhAfterDeact}`);

    // activate (resume) → active, then deactivate again so clear is reachable
    const av = await activate(A.userId, v1.id);
    assert("activate (resume) → inactive→active", av.state === "active" && av.enabled, `state=${av.state}`);
    await deactivate(A.userId, v1.id);

    // clear requires confirmation
    await assertLifecycleError("clear requires confirmation (400)", "confirmation_required", () => clearData(A.userId, v1.id, { confirm: false }));

    // clear (inactive + confirmed) → row gone, holdings cascade-wiped, token forgotten
    const cl = await clearData(A.userId, v1.id, { confirm: true });
    const connGone = await prisma.brokerConnection.findFirst({ where: { id: v1.id } });
    const bhGone = await prisma.brokerHolding.count({ where: { userId: A.userId } });
    assert("clear wipes connection + holdings (token forgotten)", cl.cleared && cl.wipedHoldings === 1 && connGone === null && bhGone === 0, `wiped=${cl.wipedHoldings} connGone=${connGone === null} heldRows=${bhGone}`);

    // ═══ C — SESSION-DEAD path ═══
    console.log("\n═══ C — Session-dead path ═══");
    const vDead = await integrate(A.userId, "mock", { accepted: true, disclaimerVersion: DISC, params: { mockExpired: true } });
    assert("integrate with expired token → session_state dead", vDead.sessionState === "dead", `sessionState=${vDead.sessionState}`);
    const acctDead = await linkFresh(A.userId, vDead.id, "Dead Session Acct");
    void acctDead;
    await assertLifecycleError("sync on a dead session → session_dead (409)", "session_dead", () => syncHoldings(A.userId, vDead.id));
    const connDead = await prisma.brokerConnection.findFirstOrThrow({ where: { id: vDead.id } });
    assert("connection marked dead after failed sync", connDead.sessionState === "dead", connDead.sessionState);
    // tidy A's connection so IDOR section starts clean
    await deactivate(A.userId, vDead.id);
    await clearData(A.userId, vDead.id, { confirm: true });

    // ═══ D — IDOR (owner isolation) ═══
    console.log("\n═══ D — IDOR (cross-user isolation) ═══");
    const B = await seedUser("b"); created.push(B.authId);
    const vA = await integrate(A.userId, "mock", { accepted: true, disclaimerVersion: DISC });
    await linkFresh(A.userId, vA.id, "IDOR Acct A");
    await syncHoldings(A.userId, vA.id);
    const aHoldings = await prisma.brokerHolding.count({ where: { userId: A.userId } });

    // B addresses A's REAL connection id — the strongest IDOR probe (the id is valid, just not B's).
    await assertLifecycleError("B sync A's connection id → not_found", "not_found", () => syncHoldings(B.userId, vA.id));
    await assertLifecycleError("B deactivate A's connection id → not_found", "not_found", () => deactivate(B.userId, vA.id));
    await assertLifecycleError("B activate A's connection id → not_found", "not_found", () => activate(B.userId, vA.id));
    await assertLifecycleError("B clear A's connection id → not_found", "not_found", () => clearData(B.userId, vA.id, { confirm: true }));
    const bStatus = await status(B.userId);
    assert("B status shows ZERO connections (cannot see A's)", bStatus.connections.length === 0, `B connections=${bStatus.connections.length}`);

    // controller-level IDOR: B's request cannot touch A's connection, even with the real id
    const resB = mockRes();
    await syncBroker(mockReq(B.userId, { params: { connectionId: vA.id } }), resB);
    assert("controller: B sync A's connection id → 404 not_found", resB.statusCode === 404 && resB.body?.error === "not_found", `status ${resB.statusCode} error ${resB.body?.error}`);

    const aStillThere = await prisma.brokerHolding.count({ where: { userId: A.userId } });
    assert("A's connection + holdings intact after B's attempts", aStillThere === aHoldings && aHoldings > 0, `A holdings before=${aHoldings} after=${aStillThere}`);

    // union read: A sees broker positions; B sees none (built, NOT yet wired to PHS/holdings)
    const aUnion = await listUnifiedPositions(A.userId);
    const bUnion = await listUnifiedPositions(B.userId);
    assert("union: A includes broker positions; B has none", aUnion.some((p) => p.source === "broker") && bUnion.length === 0, `A union=${aUnion.length}(${aUnion.filter((p) => p.source === "broker").length} broker) B union=${bUnion.length}`);

    // ═══ E — guards: unsupported broker + disclaimer ═══
    console.log("\n═══ E — Guards (unsupported broker / disclaimer) ═══");
    // (upstox is still unimplemented; zerodha is now a real interactive adapter — Phase 2a —
    //  so integrate('zerodha') correctly returns not_interactive, tested in verify-zerodha-adapter.)
    await assertLifecycleError("integrate 'upstox' (not implemented) → unsupported_broker", "unsupported_broker", () => integrate(A.userId, "upstox", { accepted: true, disclaimerVersion: DISC }));
    await assertLifecycleError("integrate 'garbage' → unsupported_broker", "unsupported_broker", () => integrate(A.userId, "garbage", { accepted: true, disclaimerVersion: DISC }));
    await assertLifecycleError("integrate without accepting disclaimer → disclaimer_required", "disclaimer_required", () => integrate(A.userId, "mock", { accepted: false, disclaimerVersion: DISC }));
    await assertLifecycleError("integrate without a disclaimer version → disclaimer_required", "disclaimer_required", () => integrate(A.userId, "mock", { accepted: true }));

    console.log(`\n${failures === 0 ? "✅ ALL BROKER LIFECYCLE CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
  } finally {
    for (const authId of created) await cleanupUser(authId);
    await prisma.$disconnect();
  }
  process.exit(failures === 0 ? 0 : 1);
}

/** Assert a thunk throws an instance of the given error class. */
async function assertThrows(name: string, cls: new (...a: any[]) => Error, fn: () => Promise<unknown>) {
  try {
    await fn();
    assert(name, false, "expected a throw, but it resolved");
  } catch (e) {
    assert(name, e instanceof cls, `threw ${(e as Error).name}`);
  }
}

main().catch((e) => {
  console.error("HARNESS CRASH:", e);
  process.exit(1);
});
