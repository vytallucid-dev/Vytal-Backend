// STAGE 4 — ACTIVATE C/D: universe rescore (all 13 scored PGs) now that score-pass
// passes the real insider/block feeds (loadFlowFeeds) instead of NO_FEEDS. Drives the
// canonical PG_RESCORE handler IN-PROCESS (no queue → no two-worker hazard), append-only
// + idempotent (skip-identical inside, supersede on genuine change). Option-A propagation:
// only score-MOVING stocks re-persist now; the score-neutral dormant→scored relabels ride
// the next EOD price cycle.
//
//   npx tsx src/scripts/activate-cd-rescore.ts          (DRY — reports plan, writes nothing)
//   npx tsx src/scripts/activate-cd-rescore.ts --commit (runs the rescore)

import { prisma } from "../db/prisma.js";
import { SCORED_PGS } from "../scoring/composite/pg-registry.js";
import { handlePgRescore } from "../jobs/handlers/pg-rescore.handler.js";
import type { JobContext } from "../jobs/context.js";
import type { PgRescorePayload } from "../jobs/types.js";

const COMMIT = process.argv.includes("--commit");
const num = (d: unknown): number | null =>
  d == null ? null : typeof (d as { toNumber?: () => number }).toNumber === "function" ? (d as { toNumber: () => number }).toNumber() : Number(d);

/** Minimal in-process JobContext — no backgroundJob row, progress is a no-op. */
function fakeCtx(payload: PgRescorePayload): JobContext<PgRescorePayload> {
  return {
    jobId: "stage4-activate-cd",
    payload,
    signal: new AbortController().signal,
    async reportProgress() {},
    async shouldCancel() { return false; },
  };
}

async function bandDist(): Promise<Record<string, number>> {
  const snaps = await prisma.scoreSnapshot.findMany({ where: { snapshotType: "quarterly", periodKey: "FY26Q4" }, orderBy: { version: "desc" }, select: { stockId: true, labelBand: true } });
  const seen = new Set<string>(); const dist: Record<string, number> = {};
  for (const s of snaps) { if (seen.has(s.stockId)) continue; seen.add(s.stockId); const b = String(s.labelBand); dist[b] = (dist[b] ?? 0) + 1; }
  return dist;
}

/** In-force (max-version) FY26Q4 composite per stock — to diff before/after. */
async function liveComposites(): Promise<Map<string, { symbol: string; composite: number; band: string; version: number }>> {
  const snaps = await prisma.scoreSnapshot.findMany({ where: { snapshotType: "quarterly", periodKey: "FY26Q4" }, orderBy: { version: "desc" }, select: { stockId: true, symbol: true, composite: true, labelBand: true, version: true } });
  const m = new Map<string, { symbol: string; composite: number; band: string; version: number }>();
  for (const s of snaps) { if (m.has(s.stockId)) continue; m.set(s.stockId, { symbol: s.symbol, composite: num(s.composite)!, band: String(s.labelBand), version: s.version }); }
  return m;
}

/** Count v1 chain-roots (append-only invariant: every period keeps its v1). */
async function v1RootCount(): Promise<number> {
  return prisma.scoreSnapshot.count({ where: { snapshotType: "quarterly", periodKey: "FY26Q4", version: 1 } });
}

async function main() {
  console.log("═".repeat(78));
  console.log(`STAGE 4 — C/D ACTIVATION RESCORE (all 13 PGs) ${COMMIT ? "· COMMIT" : "· DRY (use --commit to write)"}`);
  console.log("═".repeat(78));

  const before = await liveComposites();
  const bandBefore = await bandDist();
  const v1Before = await v1RootCount();
  console.log(`\nBefore: ${before.size} in-force FY26Q4 snapshots · ${v1Before} v1 chain-roots · bands ${JSON.stringify(bandBefore)}`);

  if (!COMMIT) {
    console.log("\nDRY RUN — would rescore: " + SCORED_PGS.map((p) => p.pgId).join(", "));
    console.log("Re-run with --commit to activate C/D and persist movers.");
    await prisma.$disconnect();
    return;
  }

  // ── Drive the canonical handler per PG, sequentially (no concurrency, no queue) ──
  let totCreated = 0, totSuperseded = 0, totSkipped = 0, totNoSnap = 0;
  const movers: { symbol: string; from: number; to: number; d: number; fromBand: string; toBand: string }[] = [];
  for (const ref of SCORED_PGS) {
    const ctx = fakeCtx({ pgId: ref.pgId, pgName: ref.pgName, seedKey: ref.seedKey, triggeredBy: "manual:stage4-activate-cd", reason: "C/D flow-feed activation" });
    const res = await handlePgRescore(ctx);
    totCreated += res.created; totSuperseded += res.superseded; totSkipped += res.skippedIdentical; totNoSnap += res.noSnapshot;
    const tag = res.outcome === "no_op_all_identical" ? "no-op" : `${res.created} new · ${res.superseded} superseded · ${res.skippedIdentical} skip`;
    console.log(`   ${ref.pgId.padEnd(5)} ${ref.pgName.padEnd(40)} ${tag}`);
    // resolve movers by symbol against the before-map
    for (const m of res.perMember.filter((x) => x.action === "superseded")) {
      const prev = [...before.values()].find((v) => v.symbol === m.symbol);
      if (prev && m.composite != null) movers.push({ symbol: m.symbol, from: prev.composite, to: m.composite, d: m.composite - prev.composite, fromBand: prev.band, toBand: m.band ?? prev.band });
    }
  }

  const v1After = await v1RootCount();
  const bandAfter = await bandDist();

  console.log("\n" + "─".repeat(78));
  console.log(`TOTAL: ${totCreated} created · ${totSuperseded} superseded · ${totSkipped} skip-identical · ${totNoSnap} no-snapshot`);
  console.log(`v1 chain-roots: ${v1Before} → ${v1After}  ${v1Before === v1After ? "✓ intact (append-only — no v1 mutated/deleted)" : "✗ CHANGED — investigate"}`);
  console.log(`bands: ${JSON.stringify(bandBefore)} → ${JSON.stringify(bandAfter)}`);

  console.log("\nMOVERS (composite changed once C/D went live):");
  if (!movers.length) console.log("   (none — no stock's composite moved this pass)");
  for (const m of movers.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)))
    console.log(`   ${m.symbol.padEnd(13)} ${m.from.toFixed(2)} → ${m.to.toFixed(2)}  (${m.d >= 0 ? "+" : ""}${m.d.toFixed(2)})  ${m.fromBand}${m.fromBand !== m.toBand ? " → " + m.toBand : ""}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
