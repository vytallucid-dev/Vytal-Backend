// ─────────────────────────────────────────────────────────────────────────────
// ZERODHA (KITE CONNECT) ADAPTER HARNESS (Phase 2a) — proves the first REAL adapter
// slots behind the interface AND every one of the 7 security requirements, with the Kite
// HTTP layer MOCKED (Zerodha has no sandbox). Throwaway users; auth.users cascade cleanup.
//
// The mock Kite HTTP verifies the checksum the adapter computes (proving api_secret is used
// SERVER-SIDE), and canned holdings drive the mapped/unmapped normalize + snapshot path.
//
//   npx tsx src/scripts/verify-zerodha-adapter.ts
// ─────────────────────────────────────────────────────────────────────────────
import crypto, { randomUUID, randomBytes } from "crypto";
import { prisma } from "../db/prisma.js";
import {
  beginIntegration,
  completeIntegration,
  syncHoldings,
  status,
  deactivate,
  clearData,
  BrokerLifecycleError,
  type BrokerErrorCode,
} from "../brokers/lifecycle.js";
import { initiateBrokerAuth } from "../controllers/me/brokers-controller.js";
import { __setAdapterOverrideForTests, __clearAdapterOverridesForTests } from "../brokers/registry.js";
import { ZerodhaAdapter } from "../brokers/adapters/zerodha.js";
import { KiteTokenError, type KiteHttpClient, type KiteHoldingsResponse, type KiteSessionResponse } from "../brokers/adapters/kite-http.js";
import { BrokerConfigError } from "../brokers/types.js";
import { decryptJson } from "../brokers/crypto.js";
import { consumeRateLimit, rateLimit, __resetRateLimitsForTests } from "../brokers/security/rate-limit.js";
import type { BrokerSession } from "../brokers/types.js";

// ── recognizable test secrets (the SEC-5 scrub assertions grep for these) ──
const API_KEY = "kite_api_key_TESTPUB";
const API_SECRET = "KITE_API_SECRET_SENSITIVE_zzz"; // must never appear in URL/response/logs
const REDIRECT = "https://app.vytal.in/broker/zerodha/callback";
const REQUEST_TOKEN = "REQTOKEN_SENSITIVE_abc123"; // must never be stored/logged
const ACCESS_TOKEN = "ACCESSTOKEN_SENSITIVE_xyz789"; // must be encrypted at rest, never logged
const DISC = "zerodha-disclaimer-v1.0";

let failures = 0;
function assert(name: string, cond: boolean, detail: string) {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
}
async function assertLifecycleError(name: string, code: BrokerErrorCode, fn: () => Promise<unknown>) {
  try {
    await fn();
    assert(name, false, `expected ${code}, resolved instead`);
  } catch (e) {
    if (e instanceof BrokerLifecycleError) assert(name, e.code === code, `threw ${e.code} (exp ${code}, http ${e.httpStatus})`);
    else assert(name, false, `threw ${(e as Error).name}: ${(e as Error).message}`);
  }
}

// ── Mock Kite HTTP: verifies the server-side checksum; returns canned session + holdings ──
class MockKiteHttp implements KiteHttpClient {
  createSessionCalls: Array<{ apiKey: string; requestToken: string; checksum: string }> = [];
  getHoldingsCalls: Array<{ apiKey: string; accessToken: string }> = [];
  lastChecksumValid = false;

  async createSession(input: { apiKey: string; requestToken: string; checksum: string }): Promise<KiteSessionResponse> {
    this.createSessionCalls.push(input);
    if (input.requestToken === "BAD_TOKEN") throw new KiteTokenError();
    // Recompute what the checksum MUST be — proves the adapter hashed api_key+request_token+
    // api_secret server-side. The mock receives the checksum, never the raw secret.
    const expected = crypto.createHash("sha256").update(input.apiKey + input.requestToken + API_SECRET).digest("hex");
    this.lastChecksumValid = input.checksum === expected;
    return { access_token: ACCESS_TOKEN, user_id: "ZY1234" };
  }
  async getHoldings(input: { apiKey: string; accessToken: string }): Promise<KiteHoldingsResponse> {
    this.getHoldingsCalls.push(input);
    if (input.accessToken === "EXPIRED") throw new KiteTokenError();
    return {
      data: [
        { tradingsymbol: "RELIANCE", quantity: 10, average_price: 2400.5, last_price: 2950 },
        { tradingsymbol: "INFY", quantity: 5, average_price: 1400, last_price: 1600 },
        { tradingsymbol: "ZZUNMAPPEDXYZ", quantity: 3, average_price: 50, last_price: 45 }, // not in the 505
      ],
    };
  }
}

// Capture ALL console output produced while running fn (SEC-5: prove no secret leaks to logs).
async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  const buf: string[] = [];
  const cap = (...a: unknown[]) => { buf.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  console.log = cap; console.error = cap; console.warn = cap; console.info = cap;
  try {
    const result = await fn();
    return { result, output: buf.join("\n") };
  } finally {
    Object.assign(console, orig);
  }
}

function stateFromAuthUrl(authUrl: string): string {
  const u = new URL(authUrl);
  const rp = u.searchParams.get("redirect_params") ?? "";
  return new URLSearchParams(rp).get("state") ?? "";
}
function mockRes() {
  const r: any = { statusCode: 200, body: null, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}
const mockReq = (userId: string, opts: { body?: any; params?: any } = {}) =>
  ({ authUser: { userId }, body: opts.body ?? {}, params: opts.params ?? {}, query: {} }) as any;

async function seedUser(tag: string): Promise<{ authId: string; userId: string }> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `zeroda-${tag}-${authId}@test.local`);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error("signup trigger did not create public.users");
  return { authId, userId: u.id };
}
const cleanupUser = (authId: string) => prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId);

async function main() {
  // Provision test config + encryption key; inject the MOCK Kite HTTP behind the real adapter.
  process.env.KITE_API_KEY = API_KEY;
  process.env.KITE_API_SECRET = API_SECRET;
  process.env.KITE_REDIRECT_URI = REDIRECT;
  process.env.BROKER_TOKEN_ENC_KEY = randomBytes(32).toString("base64");
  const kite = new MockKiteHttp();
  __setAdapterOverrideForTests("zerodha", () => new ZerodhaAdapter({ http: kite }));
  __resetRateLimitsForTests();

  const created: string[] = [];
  const flowLogs: string[] = []; // accumulate captured output for the SEC-5 scrub assertion

  try {
    const A = await seedUser("a"); created.push(A.authId);
    const present = await prisma.stock.findMany({ where: { symbol: { in: ["RELIANCE", "INFY", "ZZUNMAPPEDXYZ"] } }, select: { symbol: true } });
    const presentSet = new Set(present.map((s) => s.symbol));

    // ═══ 1 — FULL FLOW on mocked Kite: initiate → complete → encrypted store → sync ═══
    console.log("═══ 1 — Full OAuth flow (mocked Kite HTTP) ═══");
    const init = await captureConsole(() => beginIntegration(A.userId, "zerodha", { accepted: true, disclaimerVersion: DISC }));
    flowLogs.push(init.output);
    const authUrl = init.result.authUrl;
    const state1 = stateFromAuthUrl(authUrl);
    assert("initiate returns a Kite login URL carrying api_key + state", authUrl.startsWith("https://kite.zerodha.com/connect/login") && authUrl.includes(API_KEY) && state1.length > 20, authUrl.slice(0, 60) + "…");
    const stateRow = await prisma.brokerAuthState.findUnique({ where: { state: state1 } });
    assert("state persisted server-side, bound to the user, unconsumed", !!stateRow && stateRow.userId === A.userId && stateRow.consumedAt === null, `user=${stateRow?.userId === A.userId} consumed=${stateRow?.consumedAt}`);

    const comp = await captureConsole(() => completeIntegration(A.userId, "zerodha", { state: state1, params: { request_token: REQUEST_TOKEN } }));
    flowLogs.push(comp.output);
    assert("complete → active connection (session live)", comp.result.state === "active" && comp.result.sessionState === "live", `state=${comp.result.state} session=${comp.result.sessionState}`);
    assert("SEC-2: checksum computed server-side w/ api_secret (mock verified it)", kite.createSessionCalls.length === 1 && kite.lastChecksumValid, `calls=${kite.createSessionCalls.length} checksumValid=${kite.lastChecksumValid}`);

    // SEC-3: token encrypted at rest
    const conn = await prisma.brokerConnection.findFirstOrThrow({ where: { userId: A.userId, broker: "zerodha" } });
    assert("SEC-3: access_token encrypted at rest (blob is v1-ciphertext, token ABSENT)", conn.sessionBlob.startsWith("v1:") && !conn.sessionBlob.includes(ACCESS_TOKEN), `blob=${conn.sessionBlob.slice(0, 10)}…`);
    const sess = decryptJson<BrokerSession>(conn.sessionBlob);
    assert("decrypt round-trip recovers the Kite access_token", sess.accessToken === ACCESS_TOKEN, sess.accessToken.slice(0, 12) + "…");

    // Step 2b: the connection must be BOUND to an account before it can sync (§2.3).
    const zAcct = await prisma.portfolioAccount.create({ data: { userId: A.userId, name: "Zerodha Demat", broker: "zerodha", state: "manual" }, select: { id: true } });
    await prisma.portfolioAccount.update({ where: { id: zAcct.id }, data: { brokerConnectionId: comp.result.id, state: "linked_live" } });
    assert("Kite's user_id landed as the connection's brokerAccountRef", !!comp.result.brokerAccountRef, `ref=${comp.result.brokerAccountRef}`);

    // full flow → sync writes the snapshot (mapped + unmapped)
    const sync = await captureConsole(() => syncHoldings(A.userId, comp.result.id));
    flowLogs.push(sync.output);
    assert("sync fetched holdings with the stored access_token", kite.getHoldingsCalls.length === 1 && kite.getHoldingsCalls[0].accessToken === ACCESS_TOKEN, `calls=${kite.getHoldingsCalls.length}`);
    const bh = await prisma.brokerHolding.findMany({ where: { userId: A.userId }, select: { symbol: true, stockId: true, avgCost: true } });
    const reliance = bh.find((h) => h.symbol === "RELIANCE");
    const unmapped = bh.find((h) => h.symbol === "ZZUNMAPPEDXYZ");
    assert("full flow: snapshot written (3 rows)", bh.length === 3, `rows=${bh.length}`);
    assert("normalize+map: RELIANCE mapped to a universe stock_id; avg_cost = broker truth", !!reliance && (presentSet.has("RELIANCE") ? reliance.stockId !== null : true) && Number(reliance?.avgCost) === 2400.5, `stockId=${reliance?.stockId} avg=${reliance?.avgCost}`);
    assert("normalize+map: ZZUNMAPPEDXYZ stored verbatim, stock_id NULL (unmapped)", !!unmapped && unmapped.stockId === null, `stockId=${unmapped?.stockId}`);

    // ═══ 2 — SEC-1 CSRF state (mismatch / missing / replay / expired) ═══
    console.log("\n═══ 2 — SEC-1 CSRF state protection ═══");
    await assertLifecycleError("state MISMATCH rejected", "state_invalid", () => completeIntegration(A.userId, "zerodha", { state: "WRONG-STATE-VALUE", params: { request_token: REQUEST_TOKEN } }));
    await assertLifecycleError("state MISSING rejected", "state_invalid", () => completeIntegration(A.userId, "zerodha", { state: "", params: { request_token: REQUEST_TOKEN } }));

    const initR = await beginIntegration(A.userId, "zerodha", { accepted: true, disclaimerVersion: DISC });
    const stateR = stateFromAuthUrl(initR.authUrl);
    await completeIntegration(A.userId, "zerodha", { state: stateR, params: { request_token: REQUEST_TOKEN } }); // consumes stateR
    await assertLifecycleError("state REPLAY rejected (single-use)", "state_invalid", () => completeIntegration(A.userId, "zerodha", { state: stateR, params: { request_token: REQUEST_TOKEN } }));

    const initE = await beginIntegration(A.userId, "zerodha", { accepted: true, disclaimerVersion: DISC });
    const stateE = stateFromAuthUrl(initE.authUrl);
    await prisma.brokerAuthState.update({ where: { state: stateE }, data: { expiresAt: new Date(Date.now() - 1000) } }); // force-expire
    await assertLifecycleError("state EXPIRED rejected (TTL)", "state_invalid", () => completeIntegration(A.userId, "zerodha", { state: stateE, params: { request_token: REQUEST_TOKEN } }));

    // ═══ 3 — SEC-4 callback binds to the issuing user + SEC-7 IDOR ═══
    console.log("\n═══ 3 — SEC-4 issuing-user binding + SEC-7 IDOR ═══");
    const B = await seedUser("b"); created.push(B.authId);
    const initA = await beginIntegration(A.userId, "zerodha", { accepted: true, disclaimerVersion: DISC });
    const stateForA = stateFromAuthUrl(initA.authUrl);
    // B tries to complete A's state → rejected (state bound to A). B's attempt must NOT burn A's state.
    await assertLifecycleError("SEC-4: user B cannot complete a state issued for A", "state_invalid", () => completeIntegration(B.userId, "zerodha", { state: stateForA, params: { request_token: REQUEST_TOKEN } }));
    const bConn = await prisma.brokerConnection.findFirst({ where: { userId: B.userId, broker: "zerodha" } });
    assert("SEC-4: B got NO connection from A's state", bConn === null, `bConn=${bConn}`);
    const aRelink = await completeIntegration(A.userId, "zerodha", { state: stateForA, params: { request_token: REQUEST_TOKEN } });
    assert("SEC-4: A's state was NOT consumed by B — A still completes", aRelink.state === "active", `A state=${aRelink.state}`);
    // SEC-7 IDOR: B sees nothing, cannot sync A's broker
    const bStatus = await status(B.userId);
    assert("SEC-7: B status shows no zerodha connection", !bStatus.connections.some((c) => c.broker === "zerodha"), `B conns=${bStatus.connections.length}`);
    await assertLifecycleError("SEC-7: B sync A's connection id → not_found", "not_found", () => syncHoldings(B.userId, comp.result.id));

    // ═══ 4 — SEC-2 secret only server-side + SEC-5 no secrets in URLs/responses/logs ═══
    console.log("\n═══ 4 — SEC-2 secret server-side + SEC-5 scrub ═══");
    assert("SEC-2/5: login URL contains NO api_secret / request_token / access_token", !authUrl.includes(API_SECRET) && !authUrl.includes(REQUEST_TOKEN) && !authUrl.includes(ACCESS_TOKEN), "clean");
    const viewJson = JSON.stringify(comp.result);
    assert("SEC-5: connection response carries NO secret/token", !viewJson.includes(API_SECRET) && !viewJson.includes(ACCESS_TOKEN) && !viewJson.includes(REQUEST_TOKEN), "clean");
    const connRowJson = JSON.stringify({ ...conn, sessionBlob: "<redacted>" });
    assert("SEC-5: stored connection row (minus ciphertext) has no plaintext token", !connRowJson.includes(ACCESS_TOKEN) && !connRowJson.includes(REQUEST_TOKEN) && !connRowJson.includes(API_SECRET), "clean");
    assert("SEC-2: mock HTTP received only the CHECKSUM, never the raw api_secret", kite.createSessionCalls.every((c) => !c.checksum.includes(API_SECRET) && JSON.stringify(c) !== undefined && !JSON.stringify(c).includes(API_SECRET)), "secret never transmitted");

    // SEC-5 error path: a bad request_token must fail cleanly (400) and leak nothing to logs.
    const initBad = await beginIntegration(A.userId, "zerodha", { accepted: true, disclaimerVersion: DISC });
    const stateBad = stateFromAuthUrl(initBad.authUrl);
    let badErrMsg = "";
    const badRun = await captureConsole(async () => {
      try { await completeIntegration(A.userId, "zerodha", { state: stateBad, params: { request_token: "BAD_TOKEN" } }); }
      catch (e) { badErrMsg = (e as Error).message; if (!(e instanceof BrokerLifecycleError) || e.code !== "exchange_failed") throw e; }
    });
    flowLogs.push(badRun.output);
    assert("SEC-5: rejected exchange → clean error, no secret in the message", !badErrMsg.includes(API_SECRET) && !badErrMsg.includes(REQUEST_TOKEN) && !badErrMsg.includes(ACCESS_TOKEN), `msg="${badErrMsg}"`);

    const allLogs = flowLogs.join("\n");
    assert("SEC-5: NO secret appears anywhere in captured flow logs", !allLogs.includes(API_SECRET) && !allLogs.includes(REQUEST_TOKEN) && !allLogs.includes(ACCESS_TOKEN), `capturedChars=${allLogs.length}`);

    // ═══ 5 — SEC-6 rate limit ═══
    console.log("\n═══ 5 — SEC-6 rate limit ═══");
    __resetRateLimitsForTests();
    const results = [1, 2, 3, 4].map(() => consumeRateLimit("unit:userX", 3, 60_000).allowed);
    assert("SEC-6: limiter allows first N then blocks", results[0] && results[1] && results[2] && !results[3], `allowed=[${results}]`);
    // middleware fires a 429 after the limit (the body is synchronous — no await needed; on a
    // block it responds and does NOT call next()).
    const mw = rateLimit("test_action", 2, 60_000);
    let last = mockRes();
    let nextedOnLast = false;
    for (let i = 0; i < 3; i++) { last = mockRes(); nextedOnLast = false; mw(mockReq(A.userId) as any, last as any, () => { nextedOnLast = true; }); }
    assert("SEC-6: middleware returns 429 + Retry-After after the limit (next NOT called)", last.statusCode === 429 && last.body?.error === "rate_limited" && !!last.headers["Retry-After"] && !nextedOnLast, `status=${last.statusCode} retry=${last.headers["Retry-After"]} nexted=${nextedOnLast}`);

    // ═══ 6 — config fail-closed (feature degrades to 503, never crashes) ═══
    console.log("\n═══ 6 — Config fail-closed (503, not crash) ═══");
    const savedKey = process.env.KITE_API_KEY, savedSecret = process.env.KITE_API_SECRET, savedRedirect = process.env.KITE_REDIRECT_URI;
    delete process.env.KITE_API_KEY; delete process.env.KITE_API_SECRET; delete process.env.KITE_REDIRECT_URI;
    try {
      const cfgAdapter = new ZerodhaAdapter({ http: kite }); // no config override → reads (now-empty) env
      let threw = false;
      try { await cfgAdapter.beginAuth({ userId: A.userId, state: "x" }); } catch (e) { threw = e instanceof BrokerConfigError; }
      assert("adapter beginAuth throws BrokerConfigError when unconfigured", threw, "BrokerConfigError");
      const res503 = mockRes();
      await initiateBrokerAuth(mockReq(A.userId, { body: { accepted: true, disclaimerVersion: DISC }, params: { broker: "zerodha" } }), res503 as any);
      assert("controller maps unconfigured broker → 503 feature_unavailable (NOT 500)", res503.statusCode === 503 && res503.body?.error === "feature_unavailable", `status=${res503.statusCode} error=${res503.body?.error}`);
    } finally {
      process.env.KITE_API_KEY = savedKey; process.env.KITE_API_SECRET = savedSecret; process.env.KITE_REDIRECT_URI = savedRedirect;
    }

    // ═══ 7 — normalize (unit): mapped + unmapped shapes ═══
    console.log("\n═══ 7 — normalize (unit) ═══");
    const adapter = new ZerodhaAdapter({ http: kite });
    const std = adapter.normalize({ data: [
      { tradingsymbol: "reliance", quantity: 10, average_price: 2400.5, last_price: 2950 },
      { tradingsymbol: "ZZUNMAPPEDXYZ", quantity: 3, average_price: 50 }, // no last_price
    ] } as any);
    assert("normalize maps a mapped holding (upper symbol, avg as-is, value = qty×last)", std[0].symbol === "RELIANCE" && std[0].avgCost === 2400.5 && std[0].currentValue === 29500, JSON.stringify(std[0]));
    assert("normalize maps an unmapped holding (verbatim symbol, currentValue null w/o last_price)", std[1].symbol === "ZZUNMAPPEDXYZ" && std[1].currentValue === null, JSON.stringify(std[1]));

    // tidy A's connection (cleanup also cascades)
    await deactivate(A.userId, aRelink.id);
    await clearData(A.userId, aRelink.id, { confirm: true });

    console.log(`\n${failures === 0 ? "✅ ALL ZERODHA ADAPTER + SECURITY CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
  } finally {
    __clearAdapterOverridesForTests();
    for (const authId of created) await cleanupUser(authId);
    await prisma.$disconnect();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS CRASH:", e); process.exit(1); });
