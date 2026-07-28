// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PHASE 1 PROOF — behaviour tracking backend. Exercises every guarantee against the dev DB.
//   3. retention rows present, mode=time, days=60/730, armed=false
//   4. relationship emit fires (event + rollup) AND never throws (a bad emit is swallowed)
//   5. ingest bulk-inserts + folds ONCE PER STOCK; clamps reject bad batches
//   6. clear removes all three tables for the user and NOTHING for another user
//   7. reconcile recomputes the distributional JSON
//
//   npx tsx src/scripts/verify-behaviour-tracking.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import type { Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import { emitRelationshipEvent, foldAttentionBatch } from "../tracking/tracking.js";
import { postActivity, clearMyActivity } from "../controllers/me/activity-controller.js";
import { handleBehaviorRollupReconcile } from "../jobs/handlers/behavior-rollup-reconcile.handler.js";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  ok ? pass++ : fail++;
}
function hdr(s: string) { console.log(`\n${"═".repeat(90)}\n${s}\n${"═".repeat(90)}`); }

// Minimal Express req/res doubles to drive the controllers directly.
function fakeReq(userId: string, body: unknown): Request { return { authUser: { userId }, body } as unknown as Request; }
function fakeRes(): Response & { statusCode: number; body: any } {
  const r: any = { statusCode: 200 };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}
const fakeCtx = { jobId: "proof", payload: {}, signal: new AbortController().signal, reportProgress: async () => {}, shouldCancel: async () => false };

async function cleanup(userIds: string[]) {
  await prisma.$transaction([
    prisma.attentionEvent.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.relationshipEvent.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.behaviorRollup.deleteMany({ where: { userId: { in: userIds } } }),
  ]);
}

async function main() {
  const users = await prisma.user.findMany({ take: 2, select: { id: true }, orderBy: { createdAt: "asc" } });
  const stocks = await prisma.stock.findMany({ take: 2, select: { id: true, symbol: true }, orderBy: { symbol: "asc" } });
  if (users.length < 2 || stocks.length < 2) { console.log("Need ≥2 users and ≥2 stocks in the DB."); return; }
  const [A, B] = users.map((u) => u.id);
  const [S1, S2] = stocks;
  console.log(`userA=${A.slice(0, 8)}  userB=${B.slice(0, 8)}  stock1=${S1.symbol}  stock2=${S2.symbol}`);
  await cleanup([A, B]);

  // ── 3. RETENTION ROWS ──
  hdr("3. RETENTION POLICY ROWS (as they appear in /admin/retention)");
  const pols = await prisma.retentionPolicy.findMany({
    where: { table: { in: ["attention_events", "relationship_events"] } },
    orderBy: { table: "asc" },
  });
  for (const p of pols) {
    console.log(`  ${p.table}: mode=${p.mode} days=${p.days} floor=${p.floor} tsColumn=${p.tsColumn} enabled=${p.enabled} armed=${p.armed}`);
  }
  const att = pols.find((p) => p.table === "attention_events");
  const rel = pols.find((p) => p.table === "relationship_events");
  check("attention_events: time / 60d / armed=false / enabled=true", !!att && att.mode === "time" && att.days === 60 && att.armed === false && att.enabled === true);
  check("relationship_events: time / 730d / armed=false / enabled=true", !!rel && rel.mode === "time" && rel.days === 730 && rel.armed === false && rel.enabled === true);
  check("behavior_rollup has NO policy row (kept indefinitely)", (await prisma.retentionPolicy.count({ where: { table: "behavior_rollup" } })) === 0);

  // ── 4. RELATIONSHIP EMIT: fires (event + rollup) AND never throws ──
  hdr("4. RELATIONSHIP EMIT — fires, and a failing emit is swallowed");
  await emitRelationshipEvent(A, S1.id, "watchlist_added");
  await emitRelationshipEvent(A, S1.id, "alert_set");
  await emitRelationshipEvent(A, S1.id, "alert_set");
  await emitRelationshipEvent(A, S1.id, "alert_removed"); // clamp path
  const relRows = await prisma.relationshipEvent.count({ where: { userId: A, stockId: S1.id } });
  const roll1 = await prisma.behaviorRollup.findUnique({ where: { userId_stockId: { userId: A, stockId: S1.id } } });
  check("4 relationship_events rows written", relRows === 4, `count=${relRows}`);
  check("rollup.watchlistAddedAt stamped", !!roll1?.watchlistAddedAt);
  check("rollup.alertCount = 1 (set+set-remove, clamped)", roll1?.alertCount === 1, `alertCount=${roll1?.alertCount}`);

  // ★ The guarantee: a failing emit NEVER throws (so the mutation it rides never 500s). Force a failure
  //   with a non-existent stockId (FK violation inside the emit transaction) and assert it resolves.
  let threw = false;
  try {
    await emitRelationshipEvent(A, "00000000-0000-0000-0000-000000000000", "watchlist_added");
  } catch { threw = true; }
  check("emit with a bad stockId did NOT throw (swallowed — the watchlist add would still succeed)", threw === false);
  check("no phantom rollup row created by the failed emit", (await prisma.behaviorRollup.count({ where: { userId: A, stockId: "00000000-0000-0000-0000-000000000000" } })) === 0);

  // ── 5. INGEST — bulk insert + SINGLE fold per stock; clamps ──
  hdr("5. INGEST — bulk insert + one rollup fold per stock; clamps reject bad batches");
  await cleanup([A]);
  // 5 view events + 2 tab events, ALL for stock1 → 7 raw rows, ONE rollup row, viewCount=5.
  const batch = [
    ...Array.from({ length: 5 }, () => ({ stockId: S1.id, eventType: "view" as const })),
    { stockId: S1.id, eventType: "tab" as const, detail: "health" },
    { stockId: S1.id, eventType: "tab" as const, detail: "ownership" },
  ];
  const foldRes = await foldAttentionBatch(A, batch);
  const rawCount = await prisma.attentionEvent.count({ where: { userId: A, stockId: S1.id } });
  const rollCount = await prisma.behaviorRollup.count({ where: { userId: A, stockId: S1.id } });
  const roll2 = await prisma.behaviorRollup.findUnique({ where: { userId_stockId: { userId: A, stockId: S1.id } } });
  check("7 raw attention_events inserted", rawCount === 7, `count=${rawCount}`);
  check("exactly ONE rollup row folded (not one per event)", rollCount === 1 && foldRes.stocksFolded === 1, `rollupRows=${rollCount} stocksFolded=${foldRes.stocksFolded}`);
  check("rollup.viewCount = 5 (only 'view' events counted)", roll2?.viewCount === 5, `viewCount=${roll2?.viewCount}`);

  // Clamp: unknown stockId → 400 unknown_stock
  const r1 = fakeRes();
  await postActivity(fakeReq(A, [{ stockId: "not-a-real-stock", eventType: "view" }]), r1);
  check("unknown stockId batch → 400 unknown_stock", r1.statusCode === 400 && r1.body?.error === "unknown_stock", `status=${r1.statusCode} error=${r1.body?.error}`);

  // Clamp: bad eventType → 400 validation_error
  const r2 = fakeRes();
  await postActivity(fakeReq(A, [{ stockId: S1.id, eventType: "hovered" }]), r2);
  check("bad eventType → 400 validation_error", r2.statusCode === 400 && r2.body?.error === "validation_error", `status=${r2.statusCode} error=${r2.body?.error}`);

  // Clamp: oversized batch (>100) → 400 batch_too_large
  const big = Array.from({ length: 101 }, () => ({ stockId: S1.id, eventType: "view" as const }));
  const r3 = fakeRes();
  await postActivity(fakeReq(A, big), r3);
  check("oversized batch (101) → 400 batch_too_large", r3.statusCode === 400 && r3.body?.error === "batch_too_large", `status=${r3.statusCode} error=${r3.body?.error}`);

  // Happy path through the controller (a real beacon)
  const r4 = fakeRes();
  await postActivity(fakeReq(A, [{ stockId: S2.id, eventType: "view" }, { stockId: S2.id, eventType: "section_expand", detail: "raw_floor" }]), r4);
  check("valid batch → 200 accepted", r4.statusCode === 200 && r4.body?.data?.accepted === 2, `accepted=${r4.body?.data?.accepted}`);

  // ── 6. CLEAR — removes all three tables for the user, nothing for another ──
  hdr("6. CLEAR — owner-scoped across all three tables; another user untouched");
  await cleanup([A, B]);
  // Seed BOTH users.
  await emitRelationshipEvent(A, S1.id, "watchlist_added");
  await foldAttentionBatch(A, [{ stockId: S1.id, eventType: "view" }, { stockId: S2.id, eventType: "view" }]);
  await emitRelationshipEvent(B, S1.id, "watchlist_added");
  await foldAttentionBatch(B, [{ stockId: S1.id, eventType: "view" }]);
  const beforeB = {
    a: await prisma.attentionEvent.count({ where: { userId: B } }),
    r: await prisma.relationshipEvent.count({ where: { userId: B } }),
    roll: await prisma.behaviorRollup.count({ where: { userId: B } }),
  };
  const rc = fakeRes();
  await clearMyActivity(fakeReq(A, {}), rc);
  const afterA = {
    a: await prisma.attentionEvent.count({ where: { userId: A } }),
    r: await prisma.relationshipEvent.count({ where: { userId: A } }),
    roll: await prisma.behaviorRollup.count({ where: { userId: A } }),
  };
  const afterB = {
    a: await prisma.attentionEvent.count({ where: { userId: B } }),
    r: await prisma.relationshipEvent.count({ where: { userId: B } }),
    roll: await prisma.behaviorRollup.count({ where: { userId: B } }),
  };
  console.log(`  clear response: ${JSON.stringify(rc.body?.data)}`);
  check("userA: all three tables now empty", afterA.a === 0 && afterA.r === 0 && afterA.roll === 0, JSON.stringify(afterA));
  check("userB: UNTOUCHED (same counts as before)", afterB.a === beforeB.a && afterB.r === beforeB.r && afterB.roll === beforeB.roll, `before=${JSON.stringify(beforeB)} after=${JSON.stringify(afterB)}`);

  // ── 7. RECONCILE — recomputes distributional JSON ──
  hdr("7. RECONCILE — recomputes tabCounts / sectionExpandCounts from raw events");
  await cleanup([A]);
  await foldAttentionBatch(A, [
    { stockId: S1.id, eventType: "view" },
    { stockId: S1.id, eventType: "tab", detail: "health" },
    { stockId: S1.id, eventType: "tab", detail: "health" },
    { stockId: S1.id, eventType: "tab", detail: "ownership" },
    { stockId: S1.id, eventType: "section_expand", detail: "raw_floor" },
  ]);
  const before = await prisma.behaviorRollup.findUnique({ where: { userId_stockId: { userId: A, stockId: S1.id } } });
  check("before reconcile: tabCounts is null (fold does not compute distributions)", before?.tabCounts == null);
  const result = await handleBehaviorRollupReconcile(fakeCtx as any);
  const after = await prisma.behaviorRollup.findUnique({ where: { userId_stockId: { userId: A, stockId: S1.id } } });
  console.log(`  reconcile result: ${JSON.stringify(result)}`);
  console.log(`  after.tabCounts           = ${JSON.stringify(after?.tabCounts)}`);
  console.log(`  after.sectionExpandCounts = ${JSON.stringify(after?.sectionExpandCounts)}`);
  const tc = after?.tabCounts as Record<string, number> | null;
  const sc = after?.sectionExpandCounts as Record<string, number> | null;
  check("tabCounts recomputed: { health: 2, ownership: 1 }", !!tc && tc.health === 2 && tc.ownership === 1);
  check("sectionExpandCounts recomputed: { raw_floor: 1 }", !!sc && sc.raw_floor === 1);
  check("viewCount preserved (on-write authoritative, not overwritten)", after?.viewCount === 1, `viewCount=${after?.viewCount}`);

  await cleanup([A, B]);
  hdr(`RESULT: ${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
