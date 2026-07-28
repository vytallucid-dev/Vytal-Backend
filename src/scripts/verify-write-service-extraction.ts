// ─────────────────────────────────────────────────────────────────────────────
// WRITE-SERVICE EXTRACTION PROVER (Stage 3, Phase A).
//
// THE ONE JOB: prove that pulling each write out of its controller into a
// `service(input, userId)` function was a MOVE, NOT A REWRITE. It does that the only way
// that actually proves it — by driving the REAL routers over a REAL HTTP listener and
// recording every response byte (status + body), success AND error paths, into a JSON
// artifact. Run it BEFORE the extraction, run it AFTER, diff the two files. An identical
// diff is the proof; anything else is a behaviour change that has to be explained.
//
//   npx tsx src/scripts/verify-write-service-extraction.ts --out <path.json>
//
// WHY A FILE AND NOT ASSERTIONS: a hand-written assertion can only check what we already
// thought to check. A full response capture catches the field we forgot — a dropped
// `details` key, a 400 that quietly became a 500, a message whose wording drifted.
//
// Volatile values (uuids, timestamps) are redacted structurally so two runs against two
// throwaway users are comparable; everything else — status codes, error codes, messages,
// zod `details` shapes, numbers — is captured verbatim.
//
// Throwaway users (auth.users insert → signup trigger seeds public.users), cleaned up on
// exit (cascade). Dev only.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { randomUUID } from "crypto";
import fs from "node:fs";
import express from "express";
import type { AddressInfo } from "net";
import { prisma } from "../db/prisma.js";
import { meWatchlistRouter } from "../routes/me-watchlist-routes.js";
import { meAlertsRouter } from "../routes/me-alerts-routes.js";
import { meRemindersRouter } from "../routes/me-reminders-routes.js";
import { mePortfolioRouter } from "../routes/me-portfolio-routes.js";

const outPath = (() => {
  const i = process.argv.indexOf("--out");
  return i >= 0 ? process.argv[i + 1] : null;
})();
if (!outPath) {
  console.error("usage: verify-write-service-extraction.ts --out <path.json>");
  process.exit(1);
}

// ── throwaway users ──────────────────────────────────────────────────────────
const authIds: string[] = [];
async function newUser(tag: string): Promise<string> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `wsx-${tag}-${authId}@test.local`);
  authIds.push(authId);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error(`signup trigger did not seed public.users for ${tag}`);
  return u.id;
}
async function cleanup() {
  if (!authIds.length) return;
  await prisma.$executeRawUnsafe(
    `DELETE FROM auth.users WHERE id = ANY($1::uuid[])`,
    authIds,
  );
}

// ── HTTP: the REAL routers behind a stub auth (JWT verification is proven in the auth
//    build and unchanged here; the seeded authUser is exactly what requireAuth attaches). ──
function bootApp(userRef: { id: string }) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(
    "/api/v1/me",
    (req, _res, next) => {
      (req as express.Request).authUser = { userId: userRef.id, authUserId: "auth-" + userRef.id, email: "t@test.local", role: "user" };
      next();
    },
    meWatchlistRouter,
    meAlertsRouter,
    meRemindersRouter,
    mePortfolioRouter,
  );
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}

// ── the capture ──────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Structural redaction of the values that legitimately differ between two runs, and NOTHING
 *  else. A uuid → "<uuid>", an ISO instant → "<ts>". Date-only strings, numbers, codes and
 *  messages survive verbatim — those are the contract.
 *
 *  ⚠ A uuid is redacted ANYWHERE inside a string, not only as the whole value: OversellError's
 *  message embeds the offending transaction's id ("Oversell: transaction <uuid> sells 40 but only
 *  10 is held"). The surrounding wording IS the contract and must be compared; the id inside it is
 *  a per-run artifact. */
function redact(v: unknown): unknown {
  if (typeof v === "string") {
    if (UUID_RE.test(v)) return "<uuid>";
    if (ISO_RE.test(v)) return "<ts>";
    return v.replace(UUID_ANYWHERE, "<uuid>");
  }
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = redact((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

interface Capture {
  case: string;
  method: string;
  path: string;
  request: unknown;
  status: number;
  body: unknown;
}
const captures: Capture[] = [];

function makeCaller(base: string) {
  return async function call(name: string, method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(base + "/api/v1/me" + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { __nonJson: text.slice(0, 400) };
    }
    captures.push({
      case: name,
      method,
      // the path with any uuid segment redacted, so "/alerts/<uuid>" compares across runs
      path: path.split("/").map((seg) => (UUID_RE.test(seg) ? "<uuid>" : seg)).join("/"),
      request: redact(body ?? null),
      status: res.status,
      body: redact(json),
    });
    return json;
  };
}

async function main() {
  const userRef = { id: await newUser("a") };
  const otherUserId = await newUser("b");
  const { server, base } = bootApp(userRef);
  const call = makeCaller(base);

  const stock = await prisma.stock.findFirst({ where: { symbol: "HDFCBANK" }, select: { id: true } });
  if (!stock) throw new Error("HDFCBANK not in the universe — pick another fixture symbol");
  const STOCK_ID = stock.id;

  try {
    // ═══ WATCHLIST ══════════════════════════════════════════════════════════
    await call("wl:add missing body", "POST", "/watchlist", {});
    await call("wl:add blank stockId", "POST", "/watchlist", { stockId: "   " });
    await call("wl:add unknown stock", "POST", "/watchlist", { stockId: "not-a-stock" });
    await call("wl:add ok (create)", "POST", "/watchlist", { stockId: STOCK_ID });
    await call("wl:add ok (idempotent re-add)", "POST", "/watchlist", { stockId: STOCK_ID });
    await call("wl:remove ok", "DELETE", `/watchlist/${STOCK_ID}`);
    await call("wl:remove again → 404", "DELETE", `/watchlist/${STOCK_ID}`);
    await call("wl:remove unknown → 404", "DELETE", "/watchlist/not-a-stock");
    // re-add so the tool phase has a row and the list read is exercised
    await call("wl:add ok (create #2)", "POST", "/watchlist", { stockId: STOCK_ID });

    // ═══ ALERTS ═════════════════════════════════════════════════════════════
    await call("al:create empty body", "POST", "/alerts", {});
    await call("al:create price w/ operator fires", "POST", "/alerts", { stockId: STOCK_ID, type: "price", operator: "fires", threshold: 100 });
    await call("al:create price w/ negative threshold", "POST", "/alerts", { stockId: STOCK_ID, type: "price", operator: "above", threshold: -5 });
    await call("al:create price w/ findingKey", "POST", "/alerts", { stockId: STOCK_ID, type: "price", operator: "above", threshold: 100, findingKey: "X" });
    await call("al:create band w/ bogus band", "POST", "/alerts", { stockId: STOCK_ID, type: "health_band", operator: "below", threshold: "bogus" });
    await call("al:create finding w/ threshold", "POST", "/alerts", { stockId: STOCK_ID, type: "finding", operator: "fires", threshold: 1 });
    await call("al:create finding w/ operator above", "POST", "/alerts", { stockId: STOCK_ID, type: "finding", operator: "above" });
    await call("al:create unknown stock", "POST", "/alerts", { stockId: "not-a-stock", type: "price", operator: "above", threshold: 100 });
    const p = await call("al:create price ok", "POST", "/alerts", { stockId: STOCK_ID, type: "price", operator: "above", threshold: 1750.5 });
    await call("al:create band ok", "POST", "/alerts", { stockId: STOCK_ID, type: "health_band", operator: "below", threshold: "steady", repeatMode: "repeating" });
    await call("al:create finding-any ok", "POST", "/alerts", { stockId: STOCK_ID, type: "finding", operator: "fires" });
    await call("al:create finding-keyed ok", "POST", "/alerts", { stockId: STOCK_ID, type: "finding", operator: "fires", findingKey: "PLEDGE_RISE" });
    const alertId = p?.data?.alert?.id as string;

    // IDOR: user B tries to delete user A's alert → 404, identical to unknown.
    userRef.id = otherUserId;
    await call("al:delete foreign alert (IDOR) → 404", "DELETE", `/alerts/${alertId}`);
    userRef.id = (await prisma.user.findUniqueOrThrow({ where: { authUserId: authIds[0] }, select: { id: true } })).id;

    await call("al:delete ok", "DELETE", `/alerts/${alertId}`);
    await call("al:delete again → 404", "DELETE", `/alerts/${alertId}`);
    await call("al:delete bogus id → 404", "DELETE", "/alerts/nope");
    await call("al:list after", "GET", "/alerts");

    // ═══ REMINDERS ══════════════════════════════════════════════════════════
    await call("rm:create empty body", "POST", "/reminders", {});
    await call("rm:create bogus eventType", "POST", "/reminders", { stockId: STOCK_ID, eventType: "moon_landing" });
    await call("rm:create daysBefore 0", "POST", "/reminders", { stockId: STOCK_ID, eventType: "earnings", daysBefore: 0 });
    await call("rm:create daysBefore 31", "POST", "/reminders", { stockId: STOCK_ID, eventType: "earnings", daysBefore: 31 });
    await call("rm:create unknown stock", "POST", "/reminders", { stockId: "not-a-stock", eventType: "earnings" });
    // ⚠ INTENTIONAL CONTRACT CHANGE (Stage 3 item 4): daysBefore is now the four options the picker
    //    offers — 1, 2, 3, 7 — enforced in the SERVICE so every caller obeys one rule. `5` used to be
    //    accepted here and is now a 400; that case is kept below as a REGRESSION LOCK on the new rule.
    await call("rm:create daysBefore 5 → 400 (not one of 1,2,3,7)", "POST", "/reminders", { stockId: STOCK_ID, eventType: "earnings", daysBefore: 5 });
    await call("rm:create ok (default daysBefore)", "POST", "/reminders", { stockId: STOCK_ID, eventType: "earnings" });
    await call("rm:create ok (re-affirm, daysBefore 7)", "POST", "/reminders", { stockId: STOCK_ID, eventType: "earnings", daysBefore: 7 });
    await call("rm:list after", "GET", "/reminders");

    // ═══ TRANSACTIONS ═══════════════════════════════════════════════════════
    await call("tx:add empty body", "POST", "/transactions", {});
    await call("tx:add buy w/o qty+price", "POST", "/transactions", { symbol: "HDFCBANK", type: "buy", tradeDate: "2026-01-05" });
    await call("tx:add sell w/o price", "POST", "/transactions", { symbol: "HDFCBANK", type: "sell", tradeDate: "2026-01-05", quantity: 5 });
    await call("tx:add split w/o ratio", "POST", "/transactions", { symbol: "HDFCBANK", type: "split", tradeDate: "2026-01-05" });
    await call("tx:add split w/ bogus ratio", "POST", "/transactions", { symbol: "HDFCBANK", type: "split", tradeDate: "2026-01-05", ratio: "banana" });
    await call("tx:add bad tradeDate", "POST", "/transactions", { symbol: "HDFCBANK", type: "buy", tradeDate: "not-a-date", quantity: 1, price: 1 });
    await call("tx:add unknown symbol", "POST", "/transactions", { symbol: "ZZZNOTREAL", type: "buy", tradeDate: "2026-01-05", quantity: 1, price: 1 });
    // 0 accounts → the "create an account first" guard
    await call("tx:add w/ zero accounts → no_account", "POST", "/transactions", { symbol: "HDFCBANK", type: "buy", tradeDate: "2026-01-05", quantity: 10, price: 1500 });

    const acc1 = await call("acct:create A", "POST", "/accounts", { name: "Book A", broker: "other" });
    const accId1 = acc1?.data?.id as string;
    await call("tx:add ok (single account, implicit)", "POST", "/transactions", { symbol: "HDFCBANK", type: "buy", tradeDate: "2026-01-05", quantity: 10, price: 1500, fees: 12.5 });
    await call("tx:add oversell", "POST", "/transactions", { symbol: "HDFCBANK", type: "sell", tradeDate: "2026-02-05", quantity: 40, price: 1600, accountId: accId1 });
    await call("tx:add ok (explicit account, sell)", "POST", "/transactions", { symbol: "HDFCBANK", type: "sell", tradeDate: "2026-02-05", quantity: 4, price: 1600, accountId: accId1 });
    await call("tx:add unknown accountId → 404", "POST", "/transactions", { symbol: "HDFCBANK", type: "buy", tradeDate: "2026-01-05", quantity: 1, price: 1500, accountId: "not-an-account" });

    // a SECOND account makes the implicit resolve ambiguous
    const acc2 = await call("acct:create B", "POST", "/accounts", { name: "Book B", broker: "other" });
    const accId2 = acc2?.data?.id as string;
    await call("tx:add w/ 2 accounts, no accountId → account_required", "POST", "/transactions", { symbol: "HDFCBANK", type: "buy", tradeDate: "2026-01-05", quantity: 1, price: 1500 });

    // flip B to broker-managed → manual entry refused
    await prisma.portfolioAccount.update({ where: { id: accId2 }, data: { state: "linked_live" } });
    await call("tx:add into linked account → 409", "POST", "/transactions", { symbol: "HDFCBANK", type: "buy", tradeDate: "2026-01-05", quantity: 1, price: 1500, accountId: accId2 });

    await call("tx:add dividend ok", "POST", "/transactions", { symbol: "HDFCBANK", type: "dividend", tradeDate: "2026-03-05", price: 19, accountId: accId1 });
    await call("tx:add bonus ok", "POST", "/transactions", { symbol: "HDFCBANK", type: "bonus", tradeDate: "2026-03-06", ratio: "1:1", accountId: accId1 });
    await call("tx:list after", "GET", "/transactions");
  } finally {
    server.close();
  }

  fs.writeFileSync(outPath!, JSON.stringify(captures, null, 2), "utf8");
  console.log(`captured ${captures.length} responses → ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
