// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RETIRED (Construction v2 Stage 7). THIS SCRIPT NO LONGER RUNS — it refuses, deliberately.
//
// WHAT IT WAS: a Stage-6 device to fill the then-new `construction_data` JSONB in place on each user's
// latest snapshot, without churning fingerprints (§12 inclusion was still Stage 7). To keep the headline
// and the ledger agreeing it did:
//
//     const data = { ...constructionDataOf(r.construction), net: Number(latest.structure) };
//                                                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// WHY IT IS A HAZARD NOW: that line writes the EVIDENCE from the HEADLINE. Stage 7 ruled the single-source
// direction is the exact opposite — `construction_data` is the source and the `structure` column is the one
// derived projection, assigned FROM `cData.net` inside the same write (persist.ts). This script inverts
// that: it makes the decomposition conform to a column that may already be wrong, silently.
//
// It is not hypothetical. Run against `108fd2a6`'s zombie-written row (cv 1.2 · structure 55.01), it
// faithfully baked `net: 55.01` into the JSONB while the engine said 32.38 — manufacturing agreement
// between a stale headline and a fabricated ledger. Agreement is not correctness. See ODL
// `cv2-scheduler-hazard`.
//
// WHAT REPLACES IT: nothing needs to. The §12 fingerprint additions change every book's hash exactly once,
// so the ordinary `computeAndPersistPhs` path re-persists each book with a complete, self-consistent
// `construction_data` — headline and evidence built from one object, in one write. Use
// `backfill-phs-snapshots.ts` (fingerprint-gated, idempotent) if a book needs reaching.
//
// KEPT, NOT DELETED: this repo is not under version control, so a deletion is unrecoverable. The file
// stays as its own tombstone — the reasoning above is the point, and a future reader looking for "the
// script that fills construction_data" should find why it must not exist rather than a blank.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

console.error(
  [
    "",
    "  ✋ backfill-construction-data.ts is RETIRED (Construction v2 Stage 7) and will not run.",
    "",
    "     It wrote construction_data.net FROM the `structure` column. Stage 7 inverted that direction:",
    "     construction_data is the single source, and `structure` is derived FROM it at write time.",
    "     Running this would make the ledger conform to the headline — which is how 108fd2a6 ended up",
    "     serving a fabricated agreement at 55.01 while its engine said 32.38.",
    "",
    "     You almost certainly want:  npx tsx src/scripts/backfill-phs-snapshots.ts",
    "     (fingerprint-gated, idempotent — writes only the books whose inputs actually moved).",
    "",
  ].join("\n"),
);
process.exitCode = 1;
