// ─────────────────────────────────────────────────────────────────────────────
// VERIFY — PART A (score history) + PART B (score-compute error tab).
//
// Leads with PART B's TWO HONESTY CONTROLS (only-throws, self-clearing), because those
// are what keep the surface trustworthy. Then PART A, then §13 (byte-identical).
//
// Real books on real users (auth.users insert → handle_new_user trigger seeds users),
// live prices/scores. A synthetic (non-existent) user id is used to force a GENUINE throw
// (computeAndPersistPhs's snapshot create FK-fails for an unknown user). Throwaway — every
// user + every error row this script creates is cleaned up at the end.
//   npx tsx src/scripts/verify-phs-history-and-error-tab.ts
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { computeAndPersistPhs } from "../portfolio/phs/persist.js";
import { computeAndPersistPhsTracked } from "../portfolio/phs/refresh.js";
import { recordScoreHistory, istDateOnly } from "../portfolio/phs/score-history.js";
import {
  surfacePhsComputeFailure,
  resolveHealedPhsComputeErrors,
  PHS_COMPUTE_GUARD,
  PHS_COMPUTE_CRON,
} from "../scoring/errors/phs-compute-guard.js";
import { recomputeIngestionError, listIngestionErrors } from "../controllers/ingestion/ingestion-errors-controller.js";
import { getScoreHistory } from "../controllers/me/score-history-controller.js";
import { runRetention } from "../retention/engine.js";

let failures = 0;
const ok = (name: string, cond: boolean, detail: string) => {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
};
const section = (t: string) => console.log(`\n═══ ${t} ═══`);

// ── fake express req/res so we can drive the real controllers end-to-end ──
function capture() {
  const out: { status: number; body: any } = { status: 200, body: null };
  const res = {
    status(c: number) { out.status = c; return res; },
    json(b: any) { out.body = b; return res; },
  } as unknown as Response;
  return { res, out };
}

// ── create a real user (auth.users → trigger seeds users) + return its id ──
async function createUser(tag: string): Promise<{ userId: string; authId: string }> {
  const authId = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, authId, `phs-hist-${tag}-${authId}@test.local`);
  const user = await prisma.user.findUniqueOrThrow({ where: { authUserId: authId }, select: { id: true } });
  return { userId: user.id, authId };
}

async function main() {
  // Live stocks: scored (health present) + unscored-but-priced (in the book, not scored).
  const scored = await prisma.stock.findMany({ where: { symbol: { in: ["RELIANCE", "TCS", "HDFCBANK"] }, scoreSnapshots: { some: {} } }, select: { id: true, symbol: true } });
  const unscored = await prisma.stock.findMany({ where: { symbol: { in: ["LENSKART", "SWIGGY"] } }, select: { id: true, symbol: true } });
  if (scored.length < 2 || unscored.length < 2) { console.log("  ⚠ need scored RELIANCE/TCS/HDFCBANK + unscored LENSKART/SWIGGY — skipping"); return finish([]); }

  const authIds: string[] = [];
  const errorTargetIds: string[] = []; // ingestion_errors.target_entity is a plain string (no FK) → clean explicitly

  const mkHolding = async (userId: string, accountId: string, stockId: string, qty: number) => {
    const instrument = await prisma.instrument.findUniqueOrThrow({ where: { stockId }, select: { id: true } });
    await prisma.holding.create({ data: {
      userId, accountId, instrumentId: instrument.id, stockId,
      quantity: new Prisma.Decimal(qty), avgCost: new Prisma.Decimal(100),
      investedValue: new Prisma.Decimal(qty * 100), realizedPnl: new Prisma.Decimal(0), lastComputedAt: new Date(),
    }});
  };
  const mkAccount = (userId: string) => prisma.portfolioAccount.create({ data: { userId, name: "My Holdings", broker: "zerodha", state: "manual" }, select: { id: true } });

  const openRows = (targetEntity: string) => prisma.ingestionError.count({ where: { guardType: PHS_COMPUTE_GUARD, status: "open", targetEntity } });
  const anyRows = (targetEntity: string) => prisma.ingestionError.count({ where: { guardType: PHS_COMPUTE_GUARD, targetEntity } });
  const historyRows = (userId: string) => prisma.portfolioScoreHistory.count({ where: { userId } });

  try {
    // ── build the three real books ──
    const uHealthy = await createUser("healthy"); authIds.push(uHealthy.authId); errorTargetIds.push(uHealthy.userId);
    const uNull = await createUser("null"); authIds.push(uNull.authId); errorTargetIds.push(uNull.userId);
    const uLow = await createUser("lowcov"); authIds.push(uLow.authId); errorTargetIds.push(uLow.userId);

    const aH = await mkAccount(uHealthy.userId);
    for (const s of scored) await mkHolding(uHealthy.userId, aH.id, s.id, 20); // fully scored book

    const aN = await mkAccount(uNull.userId);
    for (const s of unscored) await mkHolding(uNull.userId, aN.id, s.id, 30); // NO scored holdings → correct-null

    const aL = await mkAccount(uLow.userId);
    await mkHolding(uLow.userId, aL.id, scored[0].id, 1); // a sliver of scored value
    for (const s of unscored) await mkHolding(uLow.userId, aL.id, s.id, 1000); // dominated by unscored → low coverage

    // synthetic ids: a THROW target (not a real user) + an UNTOUCHED one (never computed).
    const tThrow = `phs-verify-throw-${randomUUID()}`; errorTargetIds.push(tThrow);
    const tUntouched = `phs-verify-untouched-${randomUUID()}`; errorTargetIds.push(tUntouched);

    // ══════════════════════════════════════════════════════════════════════════════════════
    // PART B — THE TWO HONESTY CONTROLS (the deliverable). Lead here.
    // ══════════════════════════════════════════════════════════════════════════════════════
    section("PART B · HONESTY CONTROL 1 — ONLY GENUINE THROWS LAND ON THE TAB");

    // (1a) A THROWN compute → exactly ONE self-clearing row.
    let threw = false;
    try { await computeAndPersistPhsTracked(tThrow); } catch { threw = true; }
    ok("a genuine compute THREW (unknown user → snapshot create FK-fails)", threw, `computeAndPersistPhsTracked("${tThrow.slice(0, 18)}…") threw`);
    ok("→ exactly ONE open scoring_phs_failed row for that user", (await openRows(tThrow)) === 1, `open=${await openRows(tThrow)}`);
    const throwRow = await prisma.ingestionError.findFirst({ where: { guardType: PHS_COMPUTE_GUARD, targetEntity: tThrow } });
    ok("row shape: source=scoring · target=portfolio_health · severity=high · path=rescore · failureType=phs_compute",
      throwRow?.source === "scoring" && throwRow?.targetTable === "portfolio_health" && throwRow?.severity === "high" && throwRow?.resolutionPath === "rescore" && throwRow?.failureType === "phs_compute",
      `source=${throwRow?.source} target=${throwRow?.targetTable} sev=${throwRow?.severity} path=${throwRow?.resolutionPath} ft=${throwRow?.failureType}`);
    ok("row evidence: expected='a computed PHS' · observed carries the caught exception", throwRow?.expected === "a computed PHS" && (throwRow?.observed ?? "").startsWith("computeAndPersistPhs threw:"), `obs="${throwRow?.observed?.slice(0, 60)}…"`);
    ok("a THROW writes NO history row (nothing to chart)", (await prisma.portfolioScoreHistory.count({ where: { userId: tThrow } })) === 0, "history=0");

    // (1b) A CORRECT-NULL book (no scored holdings) → ZERO rows. It RETURNS, never throws.
    const nullOut = await computeAndPersistPhsTracked(uNull.userId);
    ok("correct-null book RETURNS cleanly (phs=null, no throw)", nullOut.phs === null, `phs=${nullOut.phs} skipped=${nullOut.skipped}`);
    ok("→ ZERO scoring_phs_failed rows for the all-unscored book", (await anyRows(uNull.userId)) === 0, `rows=${await anyRows(uNull.userId)}`);
    ok("→ ZERO history rows (a null score has nothing to chart)", (await historyRows(uNull.userId)) === 0, `history=${await historyRows(uNull.userId)}`);

    // (1c) A LOW-COVERAGE book → ZERO rows. Valid score, just low coverage.
    const lowOut = await computeAndPersistPhsTracked(uLow.userId);
    const lowSnap = await prisma.portfolioHealthSnapshot.findUnique({ where: { id: lowOut.snapshotId }, select: { coverage: true, provisional: true } });
    ok("low-coverage book RETURNS a valid score (phs present)", lowOut.phs != null, `phs=${lowOut.phs} coverage=${Number(lowSnap?.coverage).toFixed(4)} provisional=${lowSnap?.provisional}`);
    ok("→ ZERO scoring_phs_failed rows for the low-coverage book", (await anyRows(uLow.userId)) === 0, `rows=${await anyRows(uLow.userId)}`);

    // (1d) HOLIDAY / NO-ATTEMPT → ZERO rows (the compute was simply never called).
    ok("→ ZERO rows for a user that was never computed (no-attempt is the absence of a call)", (await anyRows(tUntouched)) === 0, `rows=${await anyRows(tUntouched)}`);

    // The tab count is honest: Faults EXCLUDES score-compute; Score Compute has its own count.
    const faultsCap = capture(); await listIngestionErrors({ query: { feed: "faults" } } as unknown as Request, faultsCap.res);
    const scCap = capture(); await listIngestionErrors({ query: { feed: "score_compute" } } as unknown as Request, scCap.res);
    const faultRowsHaveNoPhs = (faultsCap.out.body?.data ?? []).every((r: any) => r.guardType !== PHS_COMPUTE_GUARD);
    ok("Faults feed EXCLUDES score-compute rows (clean partition)", faultRowsHaveNoPhs, `faults rows with phs-guard=${(faultsCap.out.body?.data ?? []).filter((r: any) => r.guardType === PHS_COMPUTE_GUARD).length}`);
    ok("counts: openFaults excludes score-compute; scoreCompute ≥ 1 (our throw row)",
      typeof faultsCap.out.body?.counts?.scoreCompute === "number" && faultsCap.out.body.counts.scoreCompute >= 1 && (scCap.out.body?.data ?? []).some((r: any) => r.targetEntity === tThrow),
      `counts=${JSON.stringify(faultsCap.out.body?.counts)}`);

    section("PART B · HONESTY CONTROL 2 — SELF-CLEARING VIA THE ONE HEAL PATH");

    // Simulate a prior throw on a REAL user (exactly what the wrapper's catch does), then let the
    // NEXT successful compute heal it — no manual step.
    await surfacePhsComputeFailure(uHealthy.userId, new Error("simulated prior compute crash"));
    ok("a prior failure left ONE open row for the healthy user", (await openRows(uHealthy.userId)) === 1, `open=${await openRows(uHealthy.userId)}`);
    const healOut = await computeAndPersistPhsTracked(uHealthy.userId); // succeeds → heal fires inside the wrapper
    ok("the next compute SUCCEEDS (phs present)", healOut.phs != null, `phs=${healOut.phs}`);
    const healed = await prisma.ingestionError.findFirst({ where: { guardType: PHS_COMPUTE_GUARD, targetEntity: uHealthy.userId } });
    ok("→ the row AUTO-RESOLVED, no manual step (resolvedBy=auto:phs-heal)", healed?.status === "resolved" && healed?.resolvedBy === "auto:phs-heal", `status=${healed?.status} by=${healed?.resolvedBy}`);
    ok("→ ZERO open rows remain for the healed user", (await openRows(uHealthy.userId)) === 0, `open=${await openRows(uHealthy.userId)}`);

    section("PART B · THE RECOMPUTE ACTION — TRIGGERS ONLY; THE HEAL PATH RESOLVES");

    // Success path: a fresh open row, then the Recompute endpoint. The endpoint does NOT mark the
    // row resolved — the heal path does (resolvedBy=auto:phs-heal, never a button marker).
    await surfacePhsComputeFailure(uHealthy.userId, new Error("crash again"));
    const rowH = await prisma.ingestionError.findFirstOrThrow({ where: { guardType: PHS_COMPUTE_GUARD, status: "open", targetEntity: uHealthy.userId }, select: { id: true } });
    const recCap = capture(); await recomputeIngestionError({ params: { id: rowH.id } } as unknown as Request, recCap.res);
    ok("Recompute endpoint returns recomputed=true on success", recCap.out.body?.success === true && recCap.out.body?.data?.recomputed === true, `body=${JSON.stringify(recCap.out.body?.data)}`);
    const afterRec = await prisma.ingestionError.findUnique({ where: { id: rowH.id }, select: { status: true, resolvedBy: true } });
    ok("→ the row resolved via the HEAL path (resolvedBy=auto:phs-heal), NOT by the endpoint", afterRec?.status === "resolved" && afterRec?.resolvedBy === "auto:phs-heal", `status=${afterRec?.status} by=${afterRec?.resolvedBy}`);

    // Fail-again path: Recompute on a user whose compute still throws → row STAYS OPEN.
    await surfacePhsComputeFailure(tThrow, new Error("still broken")); // ensure open (dedup-bumps the (1a) row)
    const rowT = await prisma.ingestionError.findFirstOrThrow({ where: { guardType: PHS_COMPUTE_GUARD, status: "open", targetEntity: tThrow }, select: { id: true, occurrences: true } });
    const recCap2 = capture(); await recomputeIngestionError({ params: { id: rowT.id } } as unknown as Request, recCap2.res);
    ok("Recompute on a still-broken user returns recomputed=false (row stays open)", recCap2.out.body?.data?.recomputed === false, `body=${JSON.stringify(recCap2.out.body?.data)}`);
    const afterT = await prisma.ingestionError.findUnique({ where: { id: rowT.id }, select: { status: true } });
    ok("→ the row is STILL OPEN for retry (a recompute that throws again never self-resolves)", afterT?.status === "open", `status=${afterT?.status}`);

    // ══════════════════════════════════════════════════════════════════════════════════════
    // PART A — THE HISTORY TABLE
    // ══════════════════════════════════════════════════════════════════════════════════════
    section("PART A · UPSERT (user, date) — SAME DAY = 1 ROW; NEXT DAY = 2 ROWS");

    // uHealthy has computed several times TODAY already → still exactly one history row.
    ok("two+ computes SAME DAY collapse to ONE history row (latest value wins)", (await historyRows(uHealthy.userId)) === 1, `history=${await historyRows(uHealthy.userId)}`);
    const todayRow = await prisma.portfolioScoreHistory.findFirstOrThrow({ where: { userId: uHealthy.userId } });
    const liveSnap = await prisma.portfolioHealthSnapshot.findFirstOrThrow({ where: { userId: uHealthy.userId }, orderBy: { createdAt: "desc" }, select: { phs: true } });
    ok("the day's row carries the CURRENT snapshot phs", todayRow.phs === liveSnap.phs, `history.phs=${todayRow.phs} snapshot.phs=${liveSnap.phs}`);
    // A different day inserts a second row (proves the (user,date) unique key inserts, not overwrites).
    const yesterday = new Date(istDateOnly().getTime() - 24 * 3600 * 1000);
    await prisma.portfolioScoreHistory.create({ data: { userId: uHealthy.userId, date: yesterday, phs: 42, quality: 40, signals: 5, coverage: 0.9 } });
    ok("a NEW day inserts a SECOND row (2 distinct dates)", (await historyRows(uHealthy.userId)) === 2, `history=${await historyRows(uHealthy.userId)}`);

    section("PART A · A HISTORY-WRITE FAILURE DOES NOT FAIL THE SCORE (log-only, no error-tab row)");

    // Inject a history upsert failure at the exact wrapper seam, for one compute of the healthy user.
    const rowsBeforeInject = await anyRows(uHealthy.userId);
    const origUpsert = (prisma.portfolioScoreHistory as any).upsert;
    (prisma.portfolioScoreHistory as any).upsert = async () => { throw new Error("injected history-write failure"); };
    let scoreStillSucceeded = false; let wrapperThrew = false;
    try {
      const injOut = await computeAndPersistPhsTracked(uHealthy.userId);
      scoreStillSucceeded = injOut.phs != null; // the SCORE returned fine despite the history failure
    } catch { wrapperThrew = true; }
    (prisma.portfolioScoreHistory as any).upsert = origUpsert; // restore
    ok("the wrapper did NOT throw when the history write failed", !wrapperThrew, `wrapperThrew=${wrapperThrew}`);
    ok("the PHS compute STILL SUCCEEDED (the score is load-bearing; the graph rides along)", scoreStillSucceeded, `scoreSucceeded=${scoreStillSucceeded}`);
    ok("→ a history-write failure opens NO NEW error-tab row (history failure ≠ score failure)", (await anyRows(uHealthy.userId)) === rowsBeforeInject && (await openRows(uHealthy.userId)) === 0, `rows ${rowsBeforeInject}→${await anyRows(uHealthy.userId)} · open=${await openRows(uHealthy.userId)}`);

    section("PART A · MANAGED RETENTION ROW (depth, key user_id, keep 1825, floor 30, armed)");

    const pol = await prisma.retentionPolicy.findUnique({ where: { table: "portfolio_score_history" } });
    ok("retention_policy row exists: depth_per_key · key=[user_id] · order=date · keep=1825 · floor=30 · armed · enabled",
      pol?.mode === "depth_per_key" && JSON.stringify(pol?.keyCols) === JSON.stringify(["user_id"]) && pol?.orderCol === "date" && pol?.keep === 1825 && pol?.floor === 30 && pol?.armed === true && pol?.enabled === true,
      `mode=${pol?.mode} keys=${JSON.stringify(pol?.keyCols)} order=${pol?.orderCol} keep=${pol?.keep} floor=${pol?.floor} armed=${pol?.armed} enabled=${pol?.enabled}`);
    // Prove the nightly engine PROCESSES it — DRY-RUN only (zero deletes; nothing arms/changes live).
    const dry = await runRetention({ dryRun: true, only: ["portfolio_score_history"] });
    const r0 = dry.results.find((r) => r.table === "portfolio_score_history");
    ok("the retention engine processes the table under a dry-run (status ok, depth_per_key, 0 deleted)", r0?.status === "ok" && r0?.mode === "depth_per_key" && r0?.deleted === 0, `status=${r0?.status} mode=${r0?.mode} matched=${r0?.matched} deleted=${r0?.deleted}`);

    section("PART A · READ ENDPOINT — date-ascending stored rows, recomputes nothing");

    const histCountBefore = await historyRows(uHealthy.userId);
    const snapCountBefore = await prisma.portfolioHealthSnapshot.count({ where: { userId: uHealthy.userId } });
    const readCap = capture(); await getScoreHistory({ authUser: { userId: uHealthy.userId } } as unknown as Request, readCap.res);
    const series = readCap.out.body?.data?.series ?? [];
    ok("read returns the stored series", readCap.out.body?.success === true && series.length === 2, `len=${series.length}`);
    ok("series is DATE-ASCENDING", series.length === 2 && series[0].date < series[1].date, `${series.map((s: any) => s.date).join(" → ")}`);
    ok("the read RECOMPUTES NOTHING (history + snapshot counts unchanged)", (await historyRows(uHealthy.userId)) === histCountBefore && (await prisma.portfolioHealthSnapshot.count({ where: { userId: uHealthy.userId } })) === snapCountBefore, `history ${histCountBefore}→${await historyRows(uHealthy.userId)} · snapshots ${snapCountBefore}→${await prisma.portfolioHealthSnapshot.count({ where: { userId: uHealthy.userId } })}`);

    // ══════════════════════════════════════════════════════════════════════════════════════
    // §13 — THE TRACKED WRAPPER'S SNAPSHOT IS BYTE-IDENTICAL TO THE RAW FUNCTION'S
    // ══════════════════════════════════════════════════════════════════════════════════════
    section("§13 · THE WRAPPER ONLY ADDS SIDE-WRITES — THE SNAPSHOT IS UNCHANGED");

    // A fresh user computed via the TRACKED wrapper, then via the RAW function: the raw call must
    // SKIP (identical fingerprint) — i.e. the wrapper wrote exactly the snapshot raw would, and no
    // extra snapshot row. This is what makes the 6 baseline books + multi-asset book byte-identical:
    // the wrapper cannot alter a snapshot, it only wraps the write.
    const uBase = await createUser("base13"); authIds.push(uBase.authId); errorTargetIds.push(uBase.userId);
    const aB = await mkAccount(uBase.userId);
    for (const s of scored) await mkHolding(uBase.userId, aB.id, s.id, 15);
    const tracked = await computeAndPersistPhsTracked(uBase.userId);
    ok("tracked compute wrote a snapshot", !tracked.skipped && tracked.phs != null, `phs=${tracked.phs} skipped=${tracked.skipped}`);
    const raw = await computeAndPersistPhs(uBase.userId);
    ok("a RAW re-compute SKIPS (identical fingerprint → byte-identical snapshot)", raw.skipped === true && raw.snapshotId === tracked.snapshotId && raw.phs === tracked.phs, `skipped=${raw.skipped} sameId=${raw.snapshotId === tracked.snapshotId} phs=${raw.phs}`);
    ok("exactly ONE snapshot row (the wrapper added no extra snapshot; only side-writes)", (await prisma.portfolioHealthSnapshot.count({ where: { userId: uBase.userId } })) === 1, `count=${await prisma.portfolioHealthSnapshot.count({ where: { userId: uBase.userId } })}`);

    // ── direct-unit check: recordScoreHistory is best-effort on a bad user id (FK fail) ──
    section("PART A · recordScoreHistory swallows a bad write (defence in depth)");
    const badUser = `phs-verify-baduser-${randomUUID()}`;
    let recThrew = false;
    try { await recordScoreHistory(badUser, { skipped: false, snapshotId: tracked.snapshotId, phs: 50, band: "Mixed", fingerprint: "x" }); } catch { recThrew = true; }
    ok("recordScoreHistory never throws even when the upsert FK-fails", !recThrew, `threw=${recThrew}`);
    ok("→ and it opened NO error-tab row", (await prisma.ingestionError.count({ where: { guardType: PHS_COMPUTE_GUARD, targetEntity: badUser } })) === 0, "0 rows");
  } finally {
    // Clean up: real users cascade (holdings/snapshots/history); score-compute rows target a plain
    // string (no FK) so delete them explicitly. resolveHealed / etc. only ever touched our ids.
    if (errorTargetIds.length) await prisma.ingestionError.deleteMany({ where: { guardType: PHS_COMPUTE_GUARD, cron: PHS_COMPUTE_CRON, targetEntity: { in: errorTargetIds } } });
    for (const authId of authIds) {
      await prisma.$executeRawUnsafe(`DELETE FROM auth.users WHERE id = $1::uuid`, authId).catch(() => {});
    }
    console.log("  [cleanup] test users (cascade) + score-compute error rows deleted");
  }
  finish([]);
}

function finish(_x: unknown[]) {
  console.log(`\n═══ ${failures === 0 ? "PHS HISTORY + ERROR-TAB VERIFY PASS ✅" : failures + " FAILURE(S) ❌"} ═══`);
  return prisma.$disconnect().then(() => process.exit(failures === 0 ? 0 : 1));
}
main().catch((e) => { console.error(e); prisma.$disconnect().then(() => process.exit(1)); });
