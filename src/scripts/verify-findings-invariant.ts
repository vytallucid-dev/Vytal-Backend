// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// VERIFY — THE SNAPSHOT-HAS-FINDINGS INVARIANT, AGAINST THE LIVE DATABASE.
//
//   INVARIANT: no ScoreSnapshot version exists without its findings and not-covered rows evaluated
//              against THAT version.
//
// Three guards enforce it in code (types → runtime assertion → CHECK constraint); this asserts the
// state they produce, which is the only thing a user ever sees. It is DB-dependent, so it is
// deliberately NOT wired into `npm run build` — the build gate must pass without a database.
//
//   npx tsx src/scripts/verify-findings-invariant.ts
//
// ── WHAT "EVALUATED" MEANS HERE ───────────────────────────────────────────────────────────────────
// score_snapshots.findings_evaluated_at is a POSITIVE witness written in the same INSERT as the
// snapshot. It is the only thing that separates the two populations a blank card conflates:
//   · evaluated, findings_fired_count = 0 → the rules ran and nothing fired. An honest empty.
//   · never evaluated (NULL)              → the rules never ran against this version. A blank card
//                                            that silently claims the first. This is the defect.
// Rows written before 2026-08-06 predate the column and are reported SEPARATELY as legacy, never
// counted as violations — they are grandfathered by the NOT VALID constraint and age out naturally
// as each stock's head supersedes.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";

const q = <T = unknown>(sql: string, ...a: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a);

/** The cut-over: the migration that added the witness. Anything older is legacy, not a violation. */
const WITNESS_FROM = "2026-08-06";

interface Check { name: string; ok: boolean; detail: string }
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

/** Newest-period head-of-chain per stock — exactly the row every card reads. */
const HEADS = `
  WITH per_period AS (
    SELECT DISTINCT ON (stock_id, period_key)
           id, stock_id, symbol, period_key, version, created_at,
           findings_evaluated_at, findings_fired_count, not_covered_count
    FROM score_snapshots WHERE snapshot_type = 'quarterly'
    ORDER BY stock_id, period_key, version DESC)
  SELECT DISTINCT ON (stock_id) * FROM per_period ORDER BY stock_id, period_key DESC`;

async function main() {
  console.log("════ VERIFY — SNAPSHOT-HAS-FINDINGS INVARIANT ════\n");

  // ── (1) THE STRUCTURAL GUARD IS INSTALLED ───────────────────────────────────────────────────────
  const ck = await q<{ conname: string; convalidated: boolean }>(
    `SELECT conname, convalidated FROM pg_constraint
     WHERE conrelid = 'score_snapshots'::regclass AND conname = 'score_snapshots_findings_evaluated_ck'`);
  add("(1) CHECK constraint present (the storage-layer guard of last resort)",
    ck.length === 1,
    ck.length === 1
      ? `${ck[0].conname} — convalidated=${ck[0].convalidated} (false is CORRECT: NOT VALID grandfathers pre-witness rows)`
      : "score_snapshots_findings_evaluated_ck NOT FOUND — run the migration");

  // ── (2) NO POST-CUT-OVER SNAPSHOT IS UNEVALUATED ────────────────────────────────────────────────
  // The invariant proper. Every version written since the witness exists must carry one — heads and
  // superseded rows alike, because a superseded row was a head on the day it was written.
  const post = (await q<{ total: number; unevaluated: number }>(
    `SELECT count(*)::int total, count(*) FILTER (WHERE findings_evaluated_at IS NULL)::int unevaluated
     FROM score_snapshots WHERE snapshot_type='quarterly' AND created_at >= $1::date`, WITNESS_FROM))[0];
  add("(2) every snapshot written since the witness carries an evaluation",
    post.unevaluated === 0,
    `${post.total - post.unevaluated}/${post.total} evaluated; ${post.unevaluated} unevaluated`);

  // ── (3) IN-FORCE HEADS — WHAT USERS ACTUALLY READ ───────────────────────────────────────────────
  const heads = (await q<{ heads: number; evaluated: number; legacy: number }>(
    `WITH h AS (${HEADS})
     SELECT count(*)::int heads,
            count(*) FILTER (WHERE findings_evaluated_at IS NOT NULL)::int evaluated,
            count(*) FILTER (WHERE findings_evaluated_at IS NULL AND created_at < $1::date)::int legacy
     FROM h`, WITNESS_FROM))[0];
  const headViolations = heads.heads - heads.evaluated - heads.legacy;
  add("(3) no in-force head was written unevaluated after the cut-over",
    headViolations === 0,
    `${heads.heads} heads: ${heads.evaluated} evaluated, ${heads.legacy} legacy (pre-witness, grandfathered), ${headViolations} violation(s)`);

  // ── (4) ZERO-FINDINGS vs NEVER-EVALUATED IS DECIDABLE ───────────────────────────────────────────
  // The whole point of the column. Every head with no pattern rows must fall cleanly into one of the
  // two named populations — never into "cannot tell", which is what a blank card used to mean.
  const blanks = await q<{ symbol: string; period_key: string; version: number; state: string }>(
    `WITH h AS (${HEADS})
     SELECT h.symbol, h.period_key, h.version,
            CASE WHEN h.findings_evaluated_at IS NOT NULL THEN 'evaluated_zero_findings'
                 WHEN h.created_at < $1::date THEN 'legacy_unknown'
                 ELSE 'NEVER_EVALUATED' END AS state
     FROM h WHERE NOT EXISTS (SELECT 1 FROM score_patterns p WHERE p.snapshot_id = h.id)
     ORDER BY 4, 1`, WITNESS_FROM);
  const undecidable = blanks.filter((b) => b.state === "NEVER_EVALUATED");
  add("(4) every pattern-less head is decidable (evaluated-zero, or legacy — never ambiguous)",
    undecidable.length === 0,
    blanks.length
      ? blanks.map((b) => `${b.symbol}/${b.period_key}v${b.version}=${b.state}`).join("  ")
      : "no pattern-less heads");

  // ── (5) THE WITNESS AGREES WITH THE ROWS IT CLAIMS ──────────────────────────────────────────────
  // A stamp that says 5 fired while 2 rows exist would mean the findings write partially failed —
  // impossible inside persistMember's transaction, which is exactly why it is worth asserting.
  // not_covered rows live in score_patterns under the `notcovered_` prefix; red flags live in their
  // own table, so findings_fired_count is compared against patterns + red flags together.
  const drift = await q<{ symbol: string; period_key: string; claimed: number; actual: number }>(
    `WITH h AS (${HEADS})
     SELECT h.symbol, h.period_key, h.findings_fired_count::int claimed,
            ((SELECT count(*) FROM score_patterns p WHERE p.snapshot_id = h.id AND p.pattern_key NOT LIKE 'notcovered_%')
             + (SELECT count(*) FROM score_red_flags r WHERE r.snapshot_id = h.id AND r.flag_key <> 'ownership_R1_pledge'))::int actual
     FROM h WHERE h.findings_evaluated_at IS NOT NULL`);
  const mismatched = drift.filter((d) => d.claimed !== d.actual);
  add("(5) findings_fired_count matches the rows on the head (patterns + non-R1 red flags)",
    mismatched.length === 0,
    mismatched.length
      ? mismatched.slice(0, 8).map((d) => `${d.symbol}/${d.period_key} claims ${d.claimed} has ${d.actual}`).join("  ")
      : `${drift.length} evaluated head(s), all consistent`);

  const ncDrift = await q<{ symbol: string; claimed: number; actual: number }>(
    `WITH h AS (${HEADS})
     SELECT h.symbol, h.not_covered_count::int claimed,
            (SELECT count(*) FROM score_patterns p WHERE p.snapshot_id = h.id AND p.pattern_key LIKE 'notcovered_%')::int actual
     FROM h WHERE h.findings_evaluated_at IS NOT NULL`);
  const ncBad = ncDrift.filter((d) => d.claimed !== d.actual);
  add("(5b) not_covered_count matches the notcovered_ rows on the head",
    ncBad.length === 0,
    ncBad.length ? ncBad.slice(0, 8).map((d) => `${d.symbol} claims ${d.claimed} has ${d.actual}`).join("  ")
                 : `${ncDrift.length} evaluated head(s), all consistent`);

  // ── CONTEXT (not a check — the shape of the backlog) ────────────────────────────────────────────
  const legacy = (await q<{ total: number; unevaluated: number }>(
    `SELECT count(*)::int total, count(*) FILTER (WHERE findings_evaluated_at IS NULL)::int unevaluated
     FROM score_snapshots WHERE snapshot_type='quarterly'`))[0];
  console.log(`  score_snapshots (quarterly): ${legacy.total} rows, ${legacy.unevaluated} without a witness`);
  console.log(`  → pre-${WITNESS_FROM} rows are grandfathered; each ages out when its stock next supersedes.\n`);

  for (const c of checks) console.log(`  ${c.ok ? "✓ PASS" : "✗ FAIL"}  ${c.name}\n           ${c.detail}`);
  const allPass = checks.every((c) => c.ok);
  console.log(`\n  ${allPass ? "✓ INVARIANT HOLDS." : "✗ INVARIANT VIOLATED — a head is serving an unknown findings state."}`);

  await prisma.$disconnect();
  if (!allPass) process.exitCode = 1;
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
