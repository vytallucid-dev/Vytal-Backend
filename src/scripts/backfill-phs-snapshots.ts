// ─────────────────────────────────────────────────────────────────────────────
// PHS DEPLOY BACKFILL (portfolio-spec 1.2 — the decoupling cutover).
//
// Run ONCE on the 1.2 deploy. Force-recomputes + persists the PHS snapshot for EVERY
// user with open holdings, so no book keeps serving its stale pre-migration blended-1.1
// number. The normal recompute triggers (transaction write / per-member rescore) only
// touch users a change intersects — a book that hasn't moved since before the deploy is
// NEVER revisited by them, so without this backfill those users see the old blended value
// (and the old ceiling) indefinitely.
//
// Idempotent + safe to re-run: computeAndPersistPhs is fingerprint-gated, and the 1.2
// CONSTANT_VERSION bump changes every fingerprint on the FIRST pass (→ one fresh decoupled
// row per user). A SECOND run finds every fingerprint unchanged and skips all (0 written).
// Best-effort per user — a single failure is logged and skipped, never aborts the batch.
//
//   npx tsx src/scripts/backfill-phs-snapshots.ts
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { backfillAllPhs } from "../portfolio/phs/refresh.js";

async function main() {
  console.log("[phs-backfill] recomputing PHS for every user with open holdings (portfolio-spec 1.2)…");
  const out = await backfillAllPhs((done, total) => {
    if (done === total || done % 25 === 0) console.log(`  … ${done}/${total}`);
  });
  console.log(
    `[phs-backfill] done — users=${out.users} written=${out.written} skipped=${out.skipped} failed=${out.failed}`,
  );
  if (out.failed > 0) process.exitCode = 1; // surface partial failure to the deploy runner
}

main()
  .catch((e) => {
    console.error("[phs-backfill] fatal:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
