// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PURGE quarter_briefs — DELETE EVERY STORED BRIEF.
//
// ── ★ WHY DELETE AND NOT MARK STALE ─────────────────────────────────────────────────────────────
// `stale` exists for briefs that are coming BACK: a correction moved a figure, the row is hidden, and
// a regeneration job is queued to restore it. Every part of that assumes the content is worth keeping
// until it is replaced.
//
// None of that holds here, on three counts, and each one alone would be enough:
//
//   1 · THE PROSE ROWS CANNOT BE READ AT ALL. `content` now holds a serialised BriefPayload and the
//       read path JSON.parses it. Pre-Stage-5 rows are prose; 0 of them parse. They are not stale
//       content, they are unreadable content.
//   2 · THE SAMPLE ROWS ARE STALE TOO. `factsFingerprint` moved for every card in the last change, so
//       even the twelve Stage-5 payloads no longer describe the facts they claim to.
//   3 · NOBODY IS ASKING FOR ANY OF IT. Generation is off (BRIEF_ENQUEUE_ON_INGEST=false, until
//       billing), so nothing will restore a stale row — ever.
//
// A table of rows marked stale that nothing will ever restore is not caution, it is a second copy of
// the problem: every future reader has to work out whether those rows are waiting for something. They
// are not. Deleting says so in one operation.
//
// ⚠ THE BRIEF IS DERIVED DATA AND THIS LOSES NOTHING THAT CANNOT BE REBUILT. Every input — the
// quarterly rows, the annual rows, the score snapshots, the guardrail events — is untouched, and
// writeQuarterBrief reconstructs any brief from them for one AI call. What is lost is the generated
// prose, which no longer parses, and twelve sample payloads that have already been read.
//
//   npx tsx src/scripts/purge-quarter-briefs.ts            # dry run, the default
//   npx tsx src/scripts/purge-quarter-briefs.ts --commit    # delete
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";

/** Does this row hold a Stage-5 payload? Used only to REPORT the split, never to decide: both kinds
 *  are deleted, and the count is printed so the operator sees what went. */
function isSchemaPayload(content: string): boolean {
  try {
    const p = JSON.parse(content) as Record<string, unknown>;
    return Boolean(p && typeof p === "object" && p.takeaway && p.quarter && Array.isArray(p.gaps));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");

  const rows = await prisma.quarterBrief.findMany({ select: { content: true, status: true } });
  const payloads = rows.filter((r) => isSchemaPayload(r.content)).length;
  const prose = rows.length - payloads;
  const byStatus = new Map<string, number>();
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

  console.log(`quarter_briefs: ${rows.length} rows`);
  console.log(`  pre-Stage-5 prose (unreadable by the current read path): ${prose}`);
  console.log(`  Stage-5 payloads (fingerprint since moved):              ${payloads}`);
  console.log(`  by status: ${[...byStatus].map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`);

  if (rows.length === 0) {
    console.log("\nAlready empty — nothing to do.");
    await prisma.$disconnect();
    return;
  }
  if (!commit) {
    console.log(`\nDRY RUN. Would DELETE all ${rows.length} rows. Re-run with --commit.`);
    await prisma.$disconnect();
    return;
  }

  const deleted = await prisma.quarterBrief.deleteMany({});
  const remaining = await prisma.quarterBrief.count();
  console.log(`\ndeleted: ${deleted.count}`);
  console.log(`remaining rows in quarter_briefs: ${remaining}${remaining === 0 ? "  ✓ empty" : "  ✗ NOT EMPTY"}`);
  await prisma.$disconnect();
  process.exit(remaining === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
