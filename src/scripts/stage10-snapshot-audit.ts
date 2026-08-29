// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 10c — SCORE SNAPSHOT AUDIT. Read-only. What is accumulating, and what is safe to remove.
//
//   npx tsx src/scripts/stage10-snapshot-audit.ts
//
// ── WHAT THIS IS LOOKING FOR ─────────────────────────────────────────────────────────────────────
// score_snapshots is versioned: a rescore SUPERSEDES the live row rather than updating it, so the
// table grows one row per (stock, period) per input change. That is correct — it is the audit trail
// — but it means the table accumulates, and FY26Q4 alone holds 2,777 rows for 93 stocks.
//
// ⚠ SUPERSEDED IS NOT THE SAME AS GARBAGE. A superseded row is the score as it stood, and something
//   may legitimately point at it: alerts fire against a snapshot id, findings FK the version, and
//   trajectory reads across periods. So this REPORTS candidates and their referents; it deletes
//   nothing and recommends nothing that still has a referent.
//
// The distinctions that matter, and which are easy to blur:
//   HEAD          the highest version for (stock, snapshotType, periodKey) — never a candidate
//   SUPERSEDED    an older version of a period that still has a head — the growth
//   ORPHANED FK   a superseded row nothing references — the only genuinely safe class
//   REFERENCED    superseded but pointed at by pillars / findings / alerts — must stay
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 10c — SCORE SNAPSHOT AUDIT (read-only)`);
  console.log("=".repeat(100));

  const tot = await raw<{ n: number; stocks: number; lo: string; hi: string }>(
    `SELECT count(*)::int n, count(DISTINCT stock_id)::int stocks,
            min(as_of_date)::text lo, max(as_of_date)::text hi FROM score_snapshots`);
  console.log(`\n  total ${tot[0].n} rows · ${tot[0].stocks} stocks · ${tot[0].lo} .. ${tot[0].hi}`);

  // ── heads vs superseded ──────────────────────────────────────────────────────────────────────
  const split = await raw<{ heads: number; older: number }>(`
    WITH ranked AS (
      SELECT id, row_number() OVER (PARTITION BY stock_id, snapshot_type, period_key
                                    ORDER BY version DESC, created_at DESC) rn
        FROM score_snapshots)
    SELECT count(*) FILTER (WHERE rn = 1)::int heads, count(*) FILTER (WHERE rn > 1)::int older FROM ranked`);
  console.log(`  heads (live) ${split[0].heads} · superseded ${split[0].older}  →  ${((split[0].older / tot[0].n) * 100).toFixed(1)}% of the table is history`);

  console.log(`\n  ── growth by period ──`);
  console.log(`  ${"period".padEnd(9)} ${"stocks".padStart(6)} ${"rows".padStart(6)} ${"heads".padStart(6)} ${"superseded".padStart(11)}  ${"versions/stock".padStart(14)}`);
  for (const r of await raw<any>(`
    WITH ranked AS (
      SELECT period_key, stock_id, row_number() OVER (PARTITION BY stock_id, snapshot_type, period_key
                                                      ORDER BY version DESC, created_at DESC) rn
        FROM score_snapshots)
    SELECT period_key, count(DISTINCT stock_id)::int stocks, count(*)::int rows,
           count(*) FILTER (WHERE rn = 1)::int heads, count(*) FILTER (WHERE rn > 1)::int older,
           round(count(*)::numeric / NULLIF(count(DISTINCT stock_id), 0), 1) per_stock
      FROM ranked GROUP BY 1 ORDER BY 1`))
    console.log(`  ${String(r.period_key).padEnd(9)} ${String(r.stocks).padStart(6)} ${String(r.rows).padStart(6)} ${String(r.heads).padStart(6)} ${String(r.older).padStart(11)}  ${String(r.per_stock).padStart(14)}`);

  // ── what references a snapshot? ──────────────────────────────────────────────────────────────
  console.log(`\n  ── who points at a snapshot ──`);
  const refs = await raw<{ table_name: string; column_name: string }>(`
    SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'score_snapshots'`);
  if (!refs.length) console.log(`     (no declared foreign keys reference score_snapshots)`);
  for (const r of refs) {
    const n = await raw<{ n: number }>(`SELECT count(*)::int n FROM "${r.table_name}" WHERE "${r.column_name}" IS NOT NULL`);
    console.log(`     ${r.table_name}.${r.column_name}  ${n[0].n} non-null reference(s)`);
  }

  // ── the only genuinely safe class: superseded AND unreferenced ───────────────────────────────
  console.log(`\n  ── deletion candidates ──`);
  const refClauses = refs.map((r) => `NOT EXISTS (SELECT 1 FROM "${r.table_name}" x WHERE x."${r.column_name}" = s.id)`);
  const whereUnref = refClauses.length ? refClauses.join(" AND ") : "TRUE";
  const cand = await raw<{ n: number; oldest: string | null; newest: string | null }>(`
    WITH ranked AS (
      SELECT id, as_of_date, row_number() OVER (PARTITION BY stock_id, snapshot_type, period_key
                                                ORDER BY version DESC, created_at DESC) rn
        FROM score_snapshots)
    SELECT count(*)::int n, min(r.as_of_date)::text oldest, max(r.as_of_date)::text newest
      FROM ranked r JOIN score_snapshots s ON s.id = r.id
     WHERE r.rn > 1 AND ${whereUnref}`);
  console.log(`     superseded AND unreferenced : ${cand[0].n} row(s)  ${cand[0].oldest ?? "-"} .. ${cand[0].newest ?? "-"}`);
  const referenced = split[0].older - cand[0].n;
  console.log(`     superseded but REFERENCED   : ${referenced} row(s)  ← must stay, something points at them`);

  // ── how much of it is same-day churn? ────────────────────────────────────────────────────────
  console.log(`\n  ── same-day churn (several versions of one period on one date) ──`);
  for (const r of await raw<any>(`
    SELECT as_of_date::text d, count(*)::int rows, count(DISTINCT stock_id)::int stocks
      FROM score_snapshots GROUP BY 1 HAVING count(*) > count(DISTINCT stock_id) ORDER BY count(*) - count(DISTINCT stock_id) DESC LIMIT 8`))
    console.log(`     ${r.d}  ${String(r.rows).padStart(4)} rows for ${String(r.stocks).padStart(3)} stocks  (+${r.rows - r.stocks} extra versions that day)`);

  // ── retention policy, if one is armed for this table ─────────────────────────────────────────
  const pol = await raw<any>(`SELECT * FROM retention_policy WHERE table_name = 'score_snapshots'`);
  console.log(`\n  ── retention ──`);
  if (!pol.length) console.log(`     ⚠ NO retention policy row for score_snapshots — nothing prunes it, ever.`);
  else console.log(`     ${JSON.stringify(pol[0])}`);

  console.log(`\n  This audit deletes nothing. See stage10-snapshot-prune.ts for the guarded delete.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
