// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 11 — REPAIR NESTLEIND'S ANNUAL SERIES.  ⚠ DELETES one row with --commit.
//
//   npx tsx src/scripts/stage11-fix-nestleind.ts            # inspect + prove, writes nothing
//   npx tsx src/scripts/stage11-fix-nestleind.ts --commit
//
// ── THE DEFECT ───────────────────────────────────────────────────────────────────────────────────
// NESTLEIND has been unscoreable since FY26Q3: its composite is `unavailable` because FOUNDATION
// cannot compute, while momentum, market and ownership all score normally.
//
// Nestlé India moved its fiscal year from December to March, and the transition left two marks:
//   · FY25 (2025-03-31) was MISSING          — genuine gap, filled from BSE
//   · a row at 2025-12-31 labelled FY26 standalone — a NINE-MONTH YTD filed as an ANNUAL
//
// ── WHY THE 2025-12-31 ROW IS PROVABLY WRONG ─────────────────────────────────────────────────────
// Not inferred — arithmetic. Its revenue equals the sum of that year's first three quarters exactly:
//     FY26 Q1 2025-06-30   5,096.16
//     FY26 Q2 2025-09-30   5,643.61
//     FY26 Q3 2025-12-31   5,667.04
//                        ──────────
//                         16,406.81   ← the disputed "annual" row, to the paisa
// Three further tells, each independently sufficient:
//   · 2025-12-31 is a QUARTER end in the March-fiscal-year era, not a year end. NO other stock in
//     any peer group has an annual row on a non-fiscal-year-end date.
//   · it duplicates fiscal_year FY26, which is correctly held at 2026-03-31
//   · total_assets is NULL, where every other annual row for this stock carries one
// It is a Q3 filing that the annual ingester mis-classified.
//
// ⚠ DELETING, NOT RELABELLING. There is no period this row belongs to: the real FY26 annual already
//   exists, and a 9-month YTD is not a fiscal period this schema stores. Relabelling it would put a
//   partial-year figure into a slot that means full-year — the silent-wrong-number class this whole
//   effort exists to prevent. The full row is printed before deletion so it is recoverable.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const COMMIT = process.argv.includes("--commit");
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(96)}`);
  console.log(`STAGE 11 — NESTLEIND annual repair  ${COMMIT ? "*** COMMIT ***" : "(inspect only)"}`);
  console.log("=".repeat(96));

  const bad = await raw<Record<string, unknown>>(`
    SELECT f.* FROM fundamentals f JOIN stocks s ON s.id = f.stock_id
     WHERE s.symbol = 'NESTLEIND' AND f.report_date::date = '2025-12-31' AND f.result_type::text = 'standalone'`);
  if (!bad.length) {
    console.log(`\n  the 2025-12-31 standalone annual row is already gone — nothing to do.\n`);
    await prisma.$disconnect();
    return;
  }

  // ── prove it, every time, before touching anything ──────────────────────────────────────────
  const q = await raw<{ d: string; revenue: string }>(`
    SELECT q.report_date::date::text d, q.revenue FROM quarterly_results q JOIN stocks s ON s.id = q.stock_id
     WHERE s.symbol='NESTLEIND' AND q.result_type='standalone'
       AND q.report_date::date IN ('2025-06-30','2025-09-30','2025-12-31') ORDER BY q.report_date`);
  const sum = q.reduce((n, r) => n + Number(r.revenue), 0);
  const claimed = Number(bad[0].revenue);
  console.log(`\n  quarterly Apr-Dec 2025: ${q.map((r) => `${r.d}=${r.revenue}`).join("  ")}`);
  console.log(`  sum                   : ${sum.toFixed(2)}`);
  console.log(`  the "annual" row says : ${claimed.toFixed(2)}`);
  const proven = Math.abs(sum - claimed) < Math.max(1, sum * 0.005);
  console.log(`  -> ${proven ? "PROVEN a 9-month YTD" : "DOES NOT match a 9M YTD"}`);
  if (!proven) {
    console.log(`\n  ⚠ REFUSING — the arithmetic that justifies deleting this row does not hold.`);
    console.log(`    Something has changed; re-diagnose before removing anything.\n`);
    await prisma.$disconnect();
    return;
  }

  const real = await raw<{ d: string; rt: string; revenue: string }>(`
    SELECT f.report_date::date::text d, f.result_type::text rt, f.revenue
      FROM fundamentals f JOIN stocks s ON s.id=f.stock_id
     WHERE s.symbol='NESTLEIND' AND f.fiscal_year='FY26' AND f.report_date::date <> '2025-12-31'`);
  console.log(`\n  the REAL FY26 annual that survives: ${real.map((r) => `${r.d} ${r.rt} rev ${r.revenue}`).join(" | ") || "(none!)"}`);
  if (!real.length) {
    console.log(`\n  ⚠ REFUSING — deleting this would leave FY26 with NO annual row at all.\n`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\n  ── the row about to be deleted, in full (recoverable from this log) ──`);
  const row = bad[0];
  console.log("  " + JSON.stringify(Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null))));

  if (!COMMIT) {
    console.log(`\n  inspect only — re-run with --commit to delete.\n`);
    await prisma.$disconnect();
    return;
  }
  const n = await prisma.$executeRawUnsafe(`DELETE FROM fundamentals WHERE id = $1`, row.id);
  console.log(`\n  deleted ${n} row.`);
  console.log(`  next: run the BSE fallback for NESTLEIND — with the bogus row gone, FY26 standalone`);
  console.log(`  reads as unserved and can be filled properly.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
