// ─────────────────────────────────────────────────────────────────────────────
// PHS DEPLOY BACKFILL — run ONCE per CONSTANT_VERSION bump (the version-cutover deploy step).
//
// Force-recomputes + persists the PHS snapshot for EVERY user with open holdings, so no book keeps
// serving a value produced under the OLD constants. The normal recompute triggers (transaction write /
// per-member rescore) only touch users a change intersects — a book that hasn't moved since before the
// deploy is NEVER revisited by them, so without this backfill those users see the stale value forever.
//
// Idempotent + safe to re-run: computeAndPersistPhs is fingerprint-gated, and CONSTANT_VERSION is a
// fingerprint input, so the bump changes every fingerprint on the FIRST pass (→ one fresh row per user).
// A SECOND run finds every fingerprint unchanged and skips all (0 written). Best-effort per user — a
// single failure is logged and skipped, never aborts the batch.
//
// (History: shipped for the 1.2 decoupling cutover; re-run for the 2.0 Construction-v2 cutover — the
// stage where the displayed `structure` became C1–C6 Net. The banner below reads CONSTANT_VERSION so it
// can NEVER again print a version other than the one actually being stamped into the rows.)
//
//   npx tsx src/scripts/backfill-phs-snapshots.ts
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { backfillAllPhs } from "../portfolio/phs/refresh.js";
import { CONSTANT_VERSION } from "../portfolio/phs/constants.js";

async function main() {
  console.log(`[phs-backfill] recomputing PHS for every user with open holdings (${CONSTANT_VERSION})…`);
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
