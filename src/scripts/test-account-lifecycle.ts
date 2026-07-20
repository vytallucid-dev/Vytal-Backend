/**
 * ISOLATED INTEGRATION TESTS for the destructive account-lifecycle paths that `tsc` + Zod cannot
 * verify: the RESCUE round-trip (fabricates data, deletes an account, forgets a connection),
 * TRANSFER-ALL (both deleteSource modes), and the DISCARD orchestration (deactivate → clear →
 * delete), including the enabled=true + linked_stale drift seen on "Demat Z".
 *
 * ISOLATION: everything runs under a THROWAWAY user, created via a real auth.users insert (the
 * `handle_new_user` trigger mints public.users) and torn down with a single `DELETE FROM auth.users`
 * (the users_auth_user_id_fkey is ON DELETE CASCADE, and every portfolio/broker FK to users is
 * Cascade). It NEVER touches Sample, the mock account, or the live Kite connection — those belong to
 * other users and are only READ as a witness to prove no collateral damage.
 *
 * Run from the backend cwd (loads .env): `npx tsx src/scripts/test-account-lifecycle.ts`
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { rescueLinkedAccount, transferAllManualPositions, TransferError } from "../portfolio/transfer.js";
import { deactivate, clearData, BrokerLifecycleError } from "../brokers/lifecycle.js";
import { replayAndMaterialize } from "../portfolio/replay.js";

// ── tiny assertion harness ───────────────────────────────────────────────────
const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "✓" : "✗ FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
function eqNum(a: unknown, b: unknown): boolean {
  return Math.abs(Number(a) - Number(b)) < 1e-6;
}
async function expectError(fn: () => Promise<unknown>): Promise<{ code?: string; status?: number } | null> {
  try {
    await fn();
    return null; // no throw
  } catch (e) {
    if (e instanceof TransferError) return { code: e.code, status: e.httpStatus };
    if (e instanceof BrokerLifecycleError) return { code: e.code, status: e.httpStatus };
    throw e; // an UNEXPECTED error type — let it surface
  }
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ── fixture builders (all scoped to the throwaway user) ──────────────────────
let USER = "";
type Instr = { id: string; stockId: string | null; symbol: string | null };

function mkConn(broker: string, ref: string, opts: { enabled: boolean; lastSyncedAt: Date | null; sessionState?: "live" | "dead" }) {
  return prisma.brokerConnection.create({
    data: {
      userId: USER,
      broker: broker as never,
      brokerAccountRef: ref,
      enabled: opts.enabled,
      sessionState: (opts.sessionState ?? "live") as never,
      sessionBlob: "v1:test:not-a-real-session", // never decrypted by the paths under test
      sessionExpiresAt: null,
      disclaimerVersion: "v1",
      disclaimerAcceptedAt: new Date(),
      lastSyncedAt: opts.lastSyncedAt,
    },
  });
}
function mkAccount(name: string, broker: string, state: "manual" | "linked_live" | "linked_stale", connectionId: string | null) {
  return prisma.portfolioAccount.create({
    data: { userId: USER, name, broker: broker as never, state: state as never, brokerConnectionId: connectionId },
  });
}
function mkBrokerHolding(connId: string, instr: Instr, symbol: string, quantity: string, avgCost: string, syncedAt: Date) {
  return prisma.brokerHolding.create({
    data: {
      userId: USER,
      brokerConnectionId: connId,
      symbol,
      instrumentId: instr.id,
      stockId: instr.stockId,
      quantity: new Prisma.Decimal(quantity),
      avgCost: new Prisma.Decimal(avgCost),
      currentValue: null,
      source: "broker",
      syncedAt,
    },
  });
}
function mkTxn(accountId: string, instr: Instr, type: "buy" | "sell", quantity: string, price: string, tradeDate: string) {
  return prisma.transaction.create({
    data: {
      userId: USER,
      accountId,
      instrumentId: instr.id,
      stockId: instr.stockId,
      type: type as never,
      quantity: new Prisma.Decimal(quantity),
      price: new Prisma.Decimal(price),
      fees: null,
      tradeDate: new Date(tradeDate),
    },
  });
}
async function materialize(accountId: string, instrumentIds: string[]) {
  await prisma.$transaction(async (tx) => {
    for (const id of instrumentIds) await replayAndMaterialize(tx, USER, accountId, id);
  });
}

// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  const RELIANCE = await prisma.instrument.findFirst({ where: { symbol: "RELIANCE", assetClass: "stock" }, select: { id: true, stockId: true, symbol: true } });
  const SJVN = await prisma.instrument.findFirst({ where: { symbol: "SJVN", assetClass: "stock" }, select: { id: true, stockId: true, symbol: true } });
  if (!RELIANCE || !SJVN) throw new Error("fixture instruments (RELIANCE/SJVN) not found — cannot run");

  // Collateral-damage witnesses, captured BEFORE the throwaway user exists:
  //   • a real OTHER user (owner of the oldest existing account) — its row counts must not move.
  //   • the id set of every pre-existing account + connection — each must still exist after teardown.
  const anyAcct = await prisma.portfolioAccount.findFirst({ orderBy: { createdAt: "asc" }, select: { userId: true } });
  const witnessId = anyAcct?.userId ?? null;
  const witnessBefore = witnessId ? await witnessCounts(witnessId) : null;
  const preAccountIds = (await prisma.portfolioAccount.findMany({ select: { id: true } })).map((a) => a.id);
  const preConnIds = (await prisma.brokerConnection.findMany({ select: { id: true } })).map((c) => c.id);

  // ── create the throwaway user via a real auth.users insert (trigger mints public.users) ──
  const authId = randomUUID();
  const email = `__ia_lifecycle_${Date.now()}@test.invalid`;
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, email);
  const user = await prisma.user.findUnique({ where: { authUserId: authId }, select: { id: true } });
  if (!user) throw new Error("handle_new_user did not mint public.users — aborting (no throwaway rows created)");
  USER = user.id;
  console.log(`\nThrowaway user: ${USER} (auth ${authId})`);
  if (witnessId) check("witness ≠ throwaway (sanity)", witnessId !== USER, `witness=${witnessId.slice(0, 8)}…`);

  const SYNC = new Date("2025-03-14T09:30:00Z"); // fabricated rescue date will be 2025-03-14
  const rescueReport: unknown[] = [];

  try {
    // ══ TEST A — RESCUE round-trip: preview promise == ledger record, row for row, date for date ══
    console.log("\n[A] RESCUE round-trip");
    {
      const conn = await mkConn("zerodha", "REF-RESCUE-A", { enabled: true, lastSyncedAt: SYNC });
      const src = await mkAccount("__ia_rescue_src", "zerodha", "linked_live", conn.id);
      await mkBrokerHolding(conn.id, RELIANCE, "RELIANCE", "10", "2500.5", SYNC);
      await mkBrokerHolding(conn.id, SJVN, "SJVN", "100", "95.25", SYNC);
      const dst = await mkAccount("__ia_rescue_dst", "zerodha", "manual", null);

      // PREVIEW (confirm:false) — the promise
      const previewErr = await expectError(() => rescueLinkedAccount(USER, src.id, dst.id, false));
      check("A.preview → confirmation_required (400)", previewErr?.code === "confirmation_required" && previewErr?.status === 400, `${previewErr?.code}/${previewErr?.status}`);
      let willRescue: { symbol: string; quantity: string; costPerShare: string; tradeDate: string }[] = [];
      try {
        await rescueLinkedAccount(USER, src.id, dst.id, false);
      } catch (e) {
        willRescue = ((e as TransferError).details?.willRescue as typeof willRescue) ?? [];
      }
      check("A.preview carries tradeDate per row", willRescue.length === 2 && willRescue.every((r) => r.tradeDate === "2025-03-14"), JSON.stringify(willRescue));

      // COMMIT (confirm:true) — the record
      const result = await rescueLinkedAccount(USER, src.id, dst.id, true);
      rescueReport.push({ rescued: result.rescued, deletedAccount: result.deletedAccount });
      check("A.result.kind === rescue", result.kind === "rescue");
      check("A.rescued has 2 rows", (result.rescued?.length ?? 0) === 2);

      // row for row, date for date: preview.tradeDate == rescued.tradeDate == the actual ledger row
      const txns = await prisma.transaction.findMany({ where: { accountId: dst.id }, orderBy: { instrumentId: "asc" } });
      const bySym = (arr: { symbol: string }[]) => new Map(arr.map((x) => [x.symbol, x]));
      const pv = bySym(willRescue);
      const rv = bySym((result.rescued ?? []) as { symbol: string }[]);
      const txnBySym = new Map(txns.map((t) => [t.instrumentId === RELIANCE.id ? "RELIANCE" : "SJVN", t]));
      let allMatch = txns.length === 2;
      for (const sym of ["RELIANCE", "SJVN"]) {
        const p = pv.get(sym) as { tradeDate: string; quantity: string; costPerShare: string } | undefined;
        const r = rv.get(sym) as { tradeDate: string; quantity: string; costPerShare: string } | undefined;
        const t = txnBySym.get(sym);
        const ledgerDate = t ? iso(t.tradeDate) : "MISSING";
        const rowMatch = !!p && !!r && !!t && p.tradeDate === r.tradeDate && r.tradeDate === ledgerDate && p.tradeDate === "2025-03-14";
        allMatch = allMatch && rowMatch;
        check(`A.${sym}: preview→rescued→ledger date agree`, rowMatch, `preview=${p?.tradeDate} rescued=${r?.tradeDate} ledger=${ledgerDate}`);
        if (t) check(`A.${sym}: qty & cost match broker figures`, eqNum(t.quantity, p?.quantity) && eqNum(t.price, p?.costPerShare), `qty=${t.quantity} price=${t.price}`);
        if (t) check(`A.${sym}: ledger row is a rescue-tagged buy`, t.type === "buy" && (t.notes ?? "").includes("[rescue:zerodha:REF-RESCUE-A]"));
      }

      const holdings = await prisma.holding.findMany({ where: { accountId: dst.id } });
      check("A.destination holdings materialized (Stated), 2 rows", holdings.length === 2);
      check("A.source account deleted", (await prisma.portfolioAccount.findUnique({ where: { id: src.id } })) === null);
      check("A.connection forgotten", (await prisma.brokerConnection.findUnique({ where: { id: conn.id } })) === null);
      check("A.broker holdings gone (cascade)", (await prisma.brokerHolding.count({ where: { brokerConnectionId: conn.id } })) === 0);
      check("A.result.deletedAccount.connectionForgotten", result.deletedAccount?.connectionForgotten === true);
    }

    // ══ TEST B — BROKER MISMATCH on rescue → 400 broker_mismatch (backend-enforced) ══
    console.log("\n[B] RESCUE broker mismatch");
    {
      const conn = await mkConn("zerodha", "REF-MISMATCH-B", { enabled: true, lastSyncedAt: SYNC });
      const src = await mkAccount("__ia_mismatch_src", "zerodha", "linked_live", conn.id);
      await mkBrokerHolding(conn.id, RELIANCE, "RELIANCE", "5", "2500", SYNC);
      const dstUpstox = await mkAccount("__ia_mismatch_dst", "upstox", "manual", null);
      const err = await expectError(() => rescueLinkedAccount(USER, src.id, dstUpstox.id, true));
      check("B.rescue zerodha→upstox → broker_mismatch (400)", err?.code === "broker_mismatch" && err?.status === 400, `${err?.code}/${err?.status}`);
      check("B.nothing changed (source + connection intact)", !!(await prisma.portfolioAccount.findUnique({ where: { id: src.id } })) && !!(await prisma.brokerConnection.findUnique({ where: { id: conn.id } })));
    }

    // ══ TEST C — TRANSFER-ALL, deleteSource both ways: positions land, avg cost + realised P&L unchanged ══
    console.log("\n[C] TRANSFER-ALL");
    for (const deleteSource of [false, true]) {
      const tag = deleteSource ? "delete" : "keep";
      const src = await mkAccount(`__ia_ta_src_${tag}`, "zerodha", "manual", null);
      const dst = await mkAccount(`__ia_ta_dst_${tag}`, "zerodha", "manual", null);
      // RELIANCE: buy 10@100 + buy 10@120 → 20 @ 110, realized 0.  SJVN: buy 50@200, sell 20@250 → 30 @ 200, realized +1000.
      await mkTxn(src.id, RELIANCE, "buy", "10", "100", "2025-01-10");
      await mkTxn(src.id, RELIANCE, "buy", "10", "120", "2025-02-10");
      await mkTxn(src.id, SJVN, "buy", "50", "200", "2025-01-15");
      await mkTxn(src.id, SJVN, "sell", "20", "250", "2025-03-01");
      await materialize(src.id, [RELIANCE.id, SJVN.id]);
      const before = new Map((await prisma.holding.findMany({ where: { accountId: src.id } })).map((h) => [h.instrumentId, h]));

      const result = await transferAllManualPositions(USER, src.id, dst.id, deleteSource);
      const after = new Map((await prisma.holding.findMany({ where: { accountId: dst.id } })).map((h) => [h.instrumentId, h]));

      let econOk = before.size === 2 && after.size === 2;
      for (const id of [RELIANCE.id, SJVN.id]) {
        const b = before.get(id)!, a = after.get(id);
        const ok = !!a && eqNum(a.quantity, b.quantity) && eqNum(a.avgCost, b.avgCost) && eqNum(a.realizedPnl, b.realizedPnl);
        econOk = econOk && ok;
      }
      const rel = after.get(RELIANCE.id), sjvn = after.get(SJVN.id);
      check(`C.${tag}: positions landed, avg cost + realised P&L unchanged`, econOk, `RELIANCE ${rel?.quantity}@${rel?.avgCost} rP&L ${rel?.realizedPnl}; SJVN ${sjvn?.quantity}@${sjvn?.avgCost} rP&L ${sjvn?.realizedPnl}`);
      check(`C.${tag}: SJVN realised P&L preserved (= 1000)`, eqNum(sjvn?.realizedPnl, 1000), `${sjvn?.realizedPnl}`);
      const srcAfter = await prisma.portfolioAccount.findUnique({ where: { id: src.id } });
      if (deleteSource) {
        check("C.delete: source gone", srcAfter === null && result.deletedAccount != null && result.sourceKept !== true);
        check("C.delete: nothing orphaned (source txns/holdings gone)", (await prisma.transaction.count({ where: { accountId: src.id } })) === 0 && (await prisma.holding.count({ where: { accountId: src.id } })) === 0);
      } else {
        check("C.keep: source survives, now empty", srcAfter !== null && result.sourceKept === true && (await prisma.holding.count({ where: { accountId: src.id } })) === 0);
      }
    }

    // ══ TEST D — DISCARD orchestration (deactivate → clear → delete), incl. the linked_stale+enabled drift ══
    console.log("\n[D] DISCARD orchestration");
    {
      // D1 — normal linked_live
      const conn = await mkConn("zerodha", "REF-DISCARD-D1", { enabled: true, lastSyncedAt: SYNC });
      const acc = await mkAccount("__ia_discard_live", "zerodha", "linked_live", conn.id);
      await mkBrokerHolding(conn.id, RELIANCE, "RELIANCE", "7", "2400", SYNC);
      await deactivate(USER, conn.id);
      await clearData(USER, conn.id, { confirm: true });
      await prisma.portfolioAccount.delete({ where: { id: acc.id } }); // controller deletes the now-unbound shell
      check("D1.live: connection + holdings + account all gone", (await prisma.brokerConnection.findUnique({ where: { id: conn.id } })) === null && (await prisma.brokerHolding.count({ where: { brokerConnectionId: conn.id } })) === 0 && (await prisma.portfolioAccount.findUnique({ where: { id: acc.id } })) === null);
    }
    {
      // D2 — the DRIFT: linked_stale account bound to an ENABLED connection (the "Demat Z" state)
      const conn = await mkConn("zerodha", "REF-DISCARD-D2", { enabled: true, lastSyncedAt: SYNC });
      const acc = await mkAccount("__ia_discard_drift", "zerodha", "linked_stale", conn.id); // ← drift
      await mkBrokerHolding(conn.id, SJVN, "SJVN", "12", "90", SYNC);
      // WHY the orchestration deactivates first: clear on an ENABLED connection is refused.
      const noDeact = await expectError(() => clearData(USER, conn.id, { confirm: true }));
      check("D2.drift: clear WITHOUT deactivate → invalid_state (409)", noDeact?.code === "invalid_state" && noDeact?.status === 409, `${noDeact?.code}/${noDeact?.status}`);
      // The real orchestration (always deactivate first) handles the drift.
      await deactivate(USER, conn.id);
      await clearData(USER, conn.id, { confirm: true });
      await prisma.portfolioAccount.delete({ where: { id: acc.id } });
      check("D2.drift: orchestration succeeds — connection + holdings + account gone", (await prisma.brokerConnection.findUnique({ where: { id: conn.id } })) === null && (await prisma.brokerHolding.count({ where: { brokerConnectionId: conn.id } })) === 0 && (await prisma.portfolioAccount.findUnique({ where: { id: acc.id } })) === null);
    }
  } finally {
    // ── let any fire-and-forget PHS refresh settle, then TEARDOWN (single cascade delete) ──
    await new Promise((r) => setTimeout(r, 2500));
    console.log("\n[teardown]");
    const ownedBefore = await throwawayCounts(USER);
    await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId);

    // Teardown proves itself.
    const userGone = (await prisma.user.findUnique({ where: { id: USER } })) === null;
    const ownedAfter = await throwawayCounts(USER);
    const nothingLeft = Object.values(ownedAfter).every((n) => n === 0);
    check("teardown: throwaway user deleted", userGone);
    check("teardown: every throwaway-owned row gone", nothingLeft, `owned before=${JSON.stringify(ownedBefore)} after=${JSON.stringify(ownedAfter)}`);

    // No collateral damage: every pre-existing account/connection still exists, and a witness
    // user's counts are byte-identical.
    const accSurvivors = await prisma.portfolioAccount.count({ where: { id: { in: preAccountIds } } });
    const connSurvivors = await prisma.brokerConnection.count({ where: { id: { in: preConnIds } } });
    check("teardown: all pre-existing accounts survived", accSurvivors === preAccountIds.length, `${accSurvivors}/${preAccountIds.length} survived`);
    check("teardown: all pre-existing broker connections survived", connSurvivors === preConnIds.length, `${connSurvivors}/${preConnIds.length} survived`);
    if (witnessId && witnessBefore) {
      const witnessAfter = await witnessCounts(witnessId);
      const unchanged = JSON.stringify(witnessBefore) === JSON.stringify(witnessAfter);
      check("teardown: witness user's rows unchanged", unchanged, `before=${JSON.stringify(witnessBefore)} after=${JSON.stringify(witnessAfter)}`);
    } else {
      check("teardown: a witness user was available", false, "no pre-existing account found to witness");
    }
  }

  // ── report ──
  console.log("\n════ RESCUE round-trip wrote ════");
  console.log(JSON.stringify(rescueReport, null, 2));
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n════ ${passed}/${results.length} checks passed ════`);
  if (failed.length) {
    console.log("FAILURES:");
    for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log("ALL GREEN.");
  }
}

function throwawayCounts(userId: string) {
  return countsFor(userId);
}
function witnessCounts(userId: string) {
  return countsFor(userId);
}
async function countsFor(userId: string) {
  const [accounts, transactions, holdings, brokerConnections, brokerHoldings] = await Promise.all([
    prisma.portfolioAccount.count({ where: { userId } }),
    prisma.transaction.count({ where: { userId } }),
    prisma.holding.count({ where: { userId } }),
    prisma.brokerConnection.count({ where: { userId } }),
    prisma.brokerHolding.count({ where: { userId } }),
  ]);
  return { accounts, transactions, holdings, brokerConnections, brokerHoldings };
}

main()
  .catch((e) => {
    console.error("\nUNEXPECTED ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().then(() => process.exit()));
