// ─────────────────────────────────────────────────────────────────────────────
// ALERTS VERIFY HARNESS — the full contract for user-created alerts (backend only, no
// email). Proves: pure crossing/re-arm state machine · CRUD round-trips through the real
// controllers · IDOR isolation · universe-gating · type/operator coherence 400s · the
// crossing/re-arm SEQUENCE through the real eval + write path · one_shot one-and-done ·
// each type writes a correct alert_event · unscored stocks skip band/finding honestly
// while price still works.
//
// Controllers are exercised with a mock (req,res) carrying req.authUser (the owner the
// real requireAuth would attach) — so the owner-scoping / IDOR logic runs for real. The
// eval SEQUENCE is driven via runAlertsEvalPass's readingOverrides seam so the band /
// finding sequence is deterministic; the transition + event-write + flag-flips all run
// for real. Throwaway users (auth.users insert → signup trigger seeds public.users),
// cleaned up on exit (cascade).
//   npx tsx src/scripts/verify-alerts.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import {
  createAlert,
  listAlerts,
  updateAlert,
  deleteAlert,
  listAlertEvents,
} from "../controllers/me/alerts-controller.js";
import {
  runAlertsEvalPass,
  type StockReading,
} from "../alerts/eval-pass.js";
import {
  transition,
  priceConditionTrue,
  bandConditionTrue,
  findingConditionTrue,
} from "../alerts/evaluate.js";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};
const section = (t: string) => console.log(`\n── ${t} ──`);

const BAND_BY_RANK = ["fragile", "below_par", "steady", "healthy", "pristine"] as const;

// ── mock (req,res) so the real controllers run without a server ──
function mkReq(userId: string, opts: { body?: unknown; params?: Record<string, string>; query?: Record<string, unknown> } = {}): Request {
  return {
    authUser: { userId, authUserId: "auth-" + userId, email: "t@test.local", role: "user" },
    body: opts.body ?? {},
    params: opts.params ?? {},
    query: opts.query ?? {},
    headers: {},
  } as unknown as Request;
}
interface CapRes { _status: number; _json: any; }
function mkRes(): Response & CapRes {
  const r: any = { _status: 200, _json: null };
  r.status = (c: number) => { r._status = c; return r; };
  r.json = (b: unknown) => { r._json = b; return r; };
  return r as Response & CapRes;
}
async function call(handler: (req: Request, res: Response) => Promise<unknown> | unknown, req: Request): Promise<CapRes> {
  const res = mkRes();
  await handler(req, res);
  return res;
}

// ── throwaway users ──
const authIds: string[] = [];
async function newUser(tag: string): Promise<string> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`,
    authId,
    `alert-${tag}-${authId}@test.local`,
  );
  authIds.push(authId);
  const u = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!u) throw new Error(`signup trigger did not seed public.users for ${tag}`);
  return u.id;
}

const reading = (o: Partial<StockReading>): StockReading => ({
  close: o.close ?? 0,
  band: o.band ?? null,
  scored: o.scored ?? false,
  newFindingKeys: o.newFindingKeys ?? new Set<string>(),
});

async function main() {
  // ═══════════════════════════════════════════════════════════════
  // 1. PURE state machine + condition helpers (no DB)
  // ═══════════════════════════════════════════════════════════════
  section("Pure crossing/re-arm state machine");
  {
    // repeating: fire → hold(still true) → rearm(false) → fire again
    let s = { repeatMode: "repeating" as const, active: true, armed: true };
    let t = transition(s, true);
    ok("repeating fires when armed & true", t.fire && t.nextActive && !t.nextArmed);
    s = { ...s, active: t.nextActive, armed: t.nextArmed };
    t = transition(s, true);
    ok("repeating HELD while still true (no re-fire)", !t.fire && !t.changed && !s.armed);
    s = { ...s, active: t.nextActive, armed: t.nextArmed };
    t = transition(s, false);
    ok("repeating RE-ARMS when condition goes false", !t.fire && t.changed && t.nextArmed);
    s = { ...s, active: t.nextActive, armed: t.nextArmed };
    t = transition(s, true);
    ok("repeating RE-FIRES after re-arm + true", t.fire && t.nextActive);

    // one_shot: fire once → inactive
    const os = transition({ repeatMode: "one_shot", active: true, armed: true }, true);
    ok("one_shot fires then goes INACTIVE", os.fire && os.nextActive === false && os.nextArmed === false);
    ok("one_shot armed & false → no fire, no change", (() => { const x = transition({ repeatMode: "one_shot", active: true, armed: true }, false); return !x.fire && !x.changed; })());
  }
  section("Pure condition helpers");
  {
    ok("price above: 101 > 100", priceConditionTrue("above", 101, 100) && !priceConditionTrue("above", 100, 100));
    ok("price below: 99 < 100", priceConditionTrue("below", 99, 100) && !priceConditionTrue("below", 100, 100));
    ok("band below steady: below_par fires, steady does NOT (strict)", bandConditionTrue("below", "below_par", "steady") && !bandConditionTrue("below", "steady", "steady"));
    ok("band above steady: healthy fires", bandConditionTrue("above", "healthy", "steady") && !bandConditionTrue("above", "below_par", "steady"));
    ok("finding any: fires when a new key exists", findingConditionTrue(null, new Set(["X"])) && !findingConditionTrue(null, new Set()));
    ok("finding specific: only the named key fires", findingConditionTrue("K", new Set(["K"])) && !findingConditionTrue("K", new Set(["OTHER"])));
  }

  // Resolve the real test stocks (scored + unscored).
  const scored = await prisma.stock.findFirst({
    where: { symbol: { in: ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK"] }, scoreSnapshots: { some: {} }, stockPrices: { some: {} } },
    select: { id: true, symbol: true },
  });
  const unscored = await prisma.stock.findFirst({
    where: { scoreSnapshots: { none: {} }, stockPrices: { some: {} } },
    select: { id: true, symbol: true },
  });
  if (!scored) { console.log("  ⚠ no scored+priced stock found — cannot run DB tests"); return finish(); }
  const snap = await prisma.scoreSnapshot.findFirst({ where: { stockId: scored.id }, orderBy: [{ asOfDate: "desc" }, { version: "desc" }], select: { labelBand: true } });
  const priceRow = await prisma.stockPrice.findUnique({ where: { stockId: scored.id }, select: { price: true } });
  const realBand = snap!.labelBand;
  const realClose = Number(priceRow!.price);
  console.log(`\n  [fixtures] scored=${scored.symbol} band=${realBand} close=${realClose} · unscored=${unscored?.symbol ?? "(none)"}`);

  // ═══════════════════════════════════════════════════════════════
  // 2. CRUD round-trips + validation + universe gate (real controllers)
  // ═══════════════════════════════════════════════════════════════
  section("CRUD round-trips (real controllers, mock auth)");
  const userA = await newUser("A");
  {
    // create price
    let res = await call(createAlert, mkReq(userA, { body: { stockId: scored.id, type: "price", operator: "above", threshold: 1000, repeatMode: "repeating" } }));
    ok("POST price → 201", res._status === 201, `status=${res._status}`);
    const priceAlert = res._json?.data?.alert;
    ok("created price alert shape", priceAlert?.type === "price" && priceAlert?.thresholdPrice === 1000 && priceAlert?.operator === "above" && priceAlert?.active === true && priceAlert?.armed === true);

    // create health_band
    res = await call(createAlert, mkReq(userA, { body: { stockId: scored.id, type: "health_band", operator: "below", threshold: "steady" } }));
    ok("POST health_band → 201", res._status === 201);
    const bandAlert = res._json?.data?.alert;
    ok("created band alert shape (one_shot default)", bandAlert?.type === "health_band" && bandAlert?.thresholdBand === "steady" && bandAlert?.repeatMode === "one_shot");

    // create finding (any)
    res = await call(createAlert, mkReq(userA, { body: { stockId: scored.id, type: "finding", operator: "fires" } }));
    ok("POST finding (any) → 201", res._status === 201);
    const findAlert = res._json?.data?.alert;
    ok("created finding alert shape (findingKey null = any)", findAlert?.type === "finding" && findAlert?.operator === "fires" && findAlert?.findingKey === null);

    // list
    res = await call(listAlerts, mkReq(userA));
    ok("GET list → 3 alerts, newest first", res._json?.data?.count === 3 && res._json?.data?.alerts?.length === 3);

    // PATCH: change threshold (re-arms) + toggle active
    res = await call(updateAlert, mkReq(userA, { params: { id: priceAlert.id }, body: { threshold: 1234.5 } }));
    ok("PATCH price threshold → 200, updated + re-armed", res._status === 200 && res._json?.data?.alert?.thresholdPrice === 1234.5 && res._json?.data?.alert?.armed === true);
    res = await call(updateAlert, mkReq(userA, { params: { id: priceAlert.id }, body: { active: false } }));
    ok("PATCH active:false → 200, active=false", res._status === 200 && res._json?.data?.alert?.active === false);

    // PATCH type-mismatch target → 400 (can't set band on a price alert)
    res = await call(updateAlert, mkReq(userA, { params: { id: priceAlert.id }, body: { findingKey: "X" } }));
    ok("PATCH findingKey on a price alert → 400", res._status === 400);

    // DELETE
    res = await call(deleteAlert, mkReq(userA, { params: { id: bandAlert.id } }));
    ok("DELETE band alert → 200 removed", res._status === 200 && res._json?.data?.removed === true);
    res = await call(listAlerts, mkReq(userA));
    ok("GET list after delete → 2", res._json?.data?.count === 2);
  }

  section("Validation coherence → 400 (never a raw 500)");
  {
    const bad = [
      { label: "price with operator 'fires'", body: { stockId: scored.id, type: "price", operator: "fires", threshold: 100 } },
      { label: "finding with operator 'above'", body: { stockId: scored.id, type: "finding", operator: "above" } },
      { label: "health_band with a bogus band", body: { stockId: scored.id, type: "health_band", operator: "below", threshold: "excellent" } },
      { label: "price with negative threshold", body: { stockId: scored.id, type: "price", operator: "above", threshold: -5 } },
      { label: "finding carrying a threshold", body: { stockId: scored.id, type: "finding", operator: "fires", threshold: 100 } },
    ];
    for (const b of bad) {
      const res = await call(createAlert, mkReq(userA, { body: b.body }));
      ok(`reject ${b.label}`, res._status === 400, `status=${res._status}`);
    }
  }

  section("Universe gate");
  {
    const res = await call(createAlert, mkReq(userA, { body: { stockId: "not-a-real-stock-id", type: "price", operator: "above", threshold: 100 } }));
    ok("POST with bogus stockId → 400 stock_not_found", res._status === 400 && res._json?.error === "stock_not_found");
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. IDOR isolation
  // ═══════════════════════════════════════════════════════════════
  section("IDOR isolation (owner scoping)");
  const userB = await newUser("B");
  {
    // userA owns an alert; userB must not see/patch/delete it, nor its events.
    const created = await call(createAlert, mkReq(userA, { body: { stockId: scored.id, type: "price", operator: "below", threshold: 999999 } }));
    const aId = created._json.data.alert.id;

    const bList = await call(listAlerts, mkReq(userB));
    ok("userB's list excludes userA's alert", (bList._json?.data?.alerts ?? []).every((x: any) => x.id !== aId));

    const bPatch = await call(updateAlert, mkReq(userB, { params: { id: aId }, body: { active: false } }));
    ok("userB PATCH of userA's alert → 404", bPatch._status === 404);

    const bDelete = await call(deleteAlert, mkReq(userB, { params: { id: aId } }));
    ok("userB DELETE of userA's alert → 404", bDelete._status === 404);

    // still there for userA
    const aStill = await call(listAlerts, mkReq(userA));
    ok("userA's alert survives userB's attempts", (aStill._json?.data?.alerts ?? []).some((x: any) => x.id === aId));

    // events isolation: fire an event for userA, confirm userB can't read it.
    await runAlertsEvalPass({ onlyUserIds: [userA], readingOverrides: new Map([[scored.id, reading({ close: 1, scored: true })]]) });
    const aEvents = await call(listAlertEvents, mkReq(userA));
    const bEvents = await call(listAlertEvents, mkReq(userB));
    ok("userA sees ≥1 fired event", (aEvents._json?.data?.count ?? 0) >= 1);
    ok("userB's events log is empty (scoped)", (bEvents._json?.data?.count ?? 0) === 0);
    // cross-user alertId filter can't leak
    const bFilter = await call(listAlertEvents, mkReq(userB, { query: { alertId: aId } }));
    ok("userB events?alertId=<userA's> → empty (can't leak)", (bFilter._json?.data?.count ?? 0) === 0);
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. CROSSING / RE-ARM proven end-to-end (through the real write path)
  // ═══════════════════════════════════════════════════════════════
  section("Crossing/re-arm PROVEN (repeating 'below steady', driven via readings)");
  const userX = await newUser("X");
  {
    const c = await call(createAlert, mkReq(userX, { body: { stockId: scored.id, type: "health_band", operator: "below", threshold: "steady", repeatMode: "repeating" } }));
    const alertId = c._json.data.alert.id;
    const evCount = async () => prisma.alertEvent.count({ where: { alertId } });
    const armed = async () => (await prisma.alert.findUnique({ where: { id: alertId }, select: { armed: true } }))!.armed;
    const runBand = (band: (typeof BAND_BY_RANK)[number]) =>
      runAlertsEvalPass({ onlyUserIds: [userX], readingOverrides: new Map([[scored.id, reading({ band, scored: true })]]) });

    let r = await runBand("below_par"); // enter below steady
    ok("pass1 (below_par): FIRES on entry", r.fired === 1 && (await evCount()) === 1 && (await armed()) === false);

    r = await runBand("fragile"); // still below steady
    ok("pass2 (fragile, still below): QUIET — no re-fire", r.fired === 0 && r.held === 1 && (await evCount()) === 1);

    r = await runBand("healthy"); // recover above steady
    ok("pass3 (healthy, recovered): RE-ARMS, still no new event", r.fired === 0 && r.rearmed === 1 && (await armed()) === true && (await evCount()) === 1);

    r = await runBand("below_par"); // drop back below
    ok("pass4 (below_par, dropped again): RE-FIRES", r.fired === 1 && (await evCount()) === 2 && (await armed()) === false);

    // event snapshots record the triggering band
    const snaps = await prisma.alertEvent.findMany({ where: { alertId }, orderBy: { firedAt: "asc" }, select: { snapshot: true } });
    ok("both event snapshots record the band", snaps.length === 2 && snaps.every((s) => BAND_BY_RANK.includes(s.snapshot as any)));
  }

  section("one_shot fires once then goes inactive");
  const userO = await newUser("O");
  {
    const c = await call(createAlert, mkReq(userO, { body: { stockId: scored.id, type: "health_band", operator: "below", threshold: "steady", repeatMode: "one_shot" } }));
    const alertId = c._json.data.alert.id;
    const runBand = (band: (typeof BAND_BY_RANK)[number]) =>
      runAlertsEvalPass({ onlyUserIds: [userO], readingOverrides: new Map([[scored.id, reading({ band, scored: true })]]) });

    let r = await runBand("fragile");
    let a = await prisma.alert.findUnique({ where: { id: alertId }, select: { active: true } });
    ok("one_shot pass1: FIRES + active→false", r.fired === 1 && a!.active === false && (await prisma.alertEvent.count({ where: { alertId } })) === 1);

    r = await runBand("fragile");
    ok("one_shot pass2: inactive → NOT scanned, no 2nd event", r.scanned === 0 && r.fired === 0 && (await prisma.alertEvent.count({ where: { alertId } })) === 1);
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. Each type writes a correct alert_event (price + band on REAL reads; finding via seam)
  // ═══════════════════════════════════════════════════════════════
  section("Per-type event writes");
  // price cross on REAL close
  const userP = await newUser("P");
  {
    const c = await call(createAlert, mkReq(userP, { body: { stockId: scored.id, type: "price", operator: "above", threshold: realClose - 1, repeatMode: "repeating" } }));
    const alertId = c._json.data.alert.id;
    let r = await runAlertsEvalPass({ onlyUserIds: [userP] }); // real reading
    const ev = await prisma.alertEvent.findFirst({ where: { alertId }, select: { snapshot: true } });
    ok("price cross on REAL close → fires, snapshot ≈ close", r.fired === 1 && ev != null && Math.abs(Number(ev!.snapshot) - realClose) < 0.01, `snapshot=${ev?.snapshot}`);
    r = await runAlertsEvalPass({ onlyUserIds: [userP] }); // still true, disarmed
    ok("price second pass: QUIET (disarmed, still true)", r.fired === 0 && r.held === 1);
  }
  // band cross on REAL band
  const userBand = await newUser("Bd");
  {
    const rank = BAND_BY_RANK.indexOf(realBand as any);
    // choose a threshold that makes the REAL band strictly satisfy the operator
    const op = rank > 0 ? "above" : "below";
    const thr = rank > 0 ? BAND_BY_RANK[rank - 1] : BAND_BY_RANK[rank + 1];
    const c = await call(createAlert, mkReq(userBand, { body: { stockId: scored.id, type: "health_band", operator: op, threshold: thr } }));
    const alertId = c._json.data.alert.id;
    const r = await runAlertsEvalPass({ onlyUserIds: [userBand] }); // real reading
    const ev = await prisma.alertEvent.findFirst({ where: { alertId }, select: { snapshot: true } });
    ok(`band cross on REAL band (${op} ${thr} vs ${realBand}) → fires, snapshot=band`, r.fired === 1 && ev?.snapshot === realBand);
  }
  // finding fires via the reading seam (deterministic) + records the key
  const userF = await newUser("F");
  {
    const c = await call(createAlert, mkReq(userF, { body: { stockId: scored.id, type: "finding", operator: "fires", findingKey: "PF-TEST-KEY", repeatMode: "repeating" } }));
    const alertId = c._json.data.alert.id;
    const runKeys = (keys: string[]) =>
      runAlertsEvalPass({ onlyUserIds: [userF], readingOverrides: new Map([[scored.id, reading({ scored: true, newFindingKeys: new Set(keys) })]]) });

    let r = await runKeys(["PF-TEST-KEY", "OTHER"]);
    let ev = await prisma.alertEvent.findFirst({ where: { alertId }, select: { snapshot: true } });
    ok("finding fires on the named new key, snapshot = key", r.fired === 1 && ev?.snapshot === "PF-TEST-KEY");
    r = await runKeys(["OTHER"]); // key no longer newly-appeared → re-arm
    ok("finding re-arms when its key stops being new", r.fired === 0 && r.rearmed === 1);
    r = await runKeys(["PF-TEST-KEY"]); // reappears → re-fires
    ok("finding re-fires when the key reappears", r.fired === 1 && (await prisma.alertEvent.count({ where: { alertId } })) === 2);
  }
  // finding on REAL data (stable corpus) — must not error; typically quiet.
  const userFq = await newUser("Fq");
  {
    await call(createAlert, mkReq(userFq, { body: { stockId: scored.id, type: "finding", operator: "fires" } }));
    const r = await runAlertsEvalPass({ onlyUserIds: [userFq] });
    ok("finding on REAL scored stock evaluates without error (held or fired)", r.scanned === 1 && r.skipped === 0, `status=${r.outcomes[0]?.status}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. Unscored stock: band/finding skip honestly, price works
  // ═══════════════════════════════════════════════════════════════
  section("Unscored stock (honest skip on band/finding; price still works)");
  if (!unscored) {
    console.log("  ⚠ no unscored+priced stock found — skipping unscored sub-tests");
  } else {
    const uClose = Number((await prisma.stockPrice.findUnique({ where: { stockId: unscored.id }, select: { price: true } }))!.price);
    const userU = await newUser("U");
    const band = await call(createAlert, mkReq(userU, { body: { stockId: unscored.id, type: "health_band", operator: "below", threshold: "steady" } }));
    const find = await call(createAlert, mkReq(userU, { body: { stockId: unscored.id, type: "finding", operator: "fires" } }));
    const price = await call(createAlert, mkReq(userU, { body: { stockId: unscored.id, type: "price", operator: "below", threshold: uClose + 1_000_000, repeatMode: "repeating" } }));

    const r = await runAlertsEvalPass({ onlyUserIds: [userU] }); // real reading of the unscored stock
    const statusOf = (id: string) => r.outcomes.find((o) => o.alertId === id)?.status;
    ok("unscored health_band → skipped_unscored (no fire, no error)", statusOf(band._json.data.alert.id) === "skipped_unscored");
    ok("unscored finding → skipped_unscored", statusOf(find._json.data.alert.id) === "skipped_unscored");
    ok("unscored PRICE → fires (price works without a score)", statusOf(price._json.data.alert.id) === "fired" && (await prisma.alertEvent.count({ where: { alertId: price._json.data.alert.id } })) === 1);
  }

  finish();
}

async function finish() {
  // cleanup all throwaway users (cascade removes their alerts + events)
  for (const authId of authIds) {
    await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId).catch(() => {});
  }
  console.log(`\n  [cleanup] ${authIds.length} test user(s) + their alerts/events deleted (cascade)`);
  console.log(`\n═══ ${failures === 0 ? "ALERTS VERIFY PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await finish().catch(() => {});
  process.exit(1);
});
