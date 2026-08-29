// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STANDING GUARD — an inactive stock must receive no new data, from any lane.
//
//   npx tsx src/scripts/verify-inactive-no-writes.ts [--days 7]
//
// ── WHY A GUARD RATHER THAN A ONE-OFF AUDIT ──────────────────────────────────────────────────────
// "Add the isActive check to every pipeline" is only true on the day it is done. The next lane
// someone writes will not have it, and the failure is SILENT: rows appear for a stock nothing else
// maintains, so the data ages while continuing to look current. MEASURED: ABBOTINDIA, BAYERCROP and
// MCX were deactivated 2026-08-17 and still received four daily_prices rows each, written 2026-08-23.
//
// So this asserts the INVARIANT instead of the implementation — it does not care which lane wrote the
// row, only that no inactive stock got one. A new pipeline that forgets the gate fails this the next
// time it runs, by name, with the table and the count.
//
// ⚠ THE WINDOW MATTERS. Rows written BEFORE a stock was deactivated are legitimate history and must
//   not be flagged; the test is therefore "written after the deactivation timestamp", per stock,
//   not "exists at all".
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

/** table → the column that records when the row was written. */
const WATCHED: Array<{ table: string; writtenAt: string }> = [
  { table: "daily_prices", writtenAt: "created_at" },
  { table: "quarterly_results", writtenAt: "updated_at" },
  { table: "fundamentals", writtenAt: "updated_at" },
  { table: "banking_quarterly_results", writtenAt: "updated_at" },
  { table: "banking_fundamentals", writtenAt: "updated_at" },
  { table: "nbfc_quarterly_results", writtenAt: "updated_at" },
  { table: "nbfc_fundamentals", writtenAt: "updated_at" },
  { table: "life_insurance_quarterly_results", writtenAt: "updated_at" },
  { table: "life_insurance_fundamentals", writtenAt: "updated_at" },
  { table: "general_insurance_quarterly_results", writtenAt: "updated_at" },
  { table: "general_insurance_fundamentals", writtenAt: "updated_at" },
  { table: "shareholding_patterns", writtenAt: "created_at" },
];

async function main(): Promise<void> {
  const i = process.argv.indexOf("--days");
  const graceDays = i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 1;

  console.log(`\n=== inactive stocks must receive no new data ===\n`);
  const inactive = await raw<{ id: string; symbol: string; deactivated: string }>(
    `SELECT id, symbol, updated_at::text deactivated FROM stocks WHERE is_active = false ORDER BY symbol`);
  console.log(`  inactive stocks: ${inactive.length}${inactive.length ? ` (${inactive.map((s) => s.symbol).join(", ")})` : ""}`);
  if (inactive.length === 0) {
    console.log(`\n  nothing to check — every stock in the universe is active.\n`);
    console.log(`=== GATE PASSED ===\n`);
    await prisma.$disconnect();
    return;
  }
  console.log(`  grace: rows written up to ${graceDays} day(s) after deactivation are tolerated`);
  console.log(`         (a run already in flight when the flag flipped)\n`);

  let violations = 0;
  for (const s of inactive) {
    const hits: string[] = [];
    for (const w of WATCHED) {
      const has = await raw<{ n: number }>(
        `SELECT count(*)::int n FROM information_schema.columns
          WHERE table_name = $1 AND column_name = $2`, w.table, w.writtenAt);
      if (!has[0].n) continue;
      const r = await raw<{ n: number; latest: string | null }>(
        `SELECT count(*)::int n, max("${w.writtenAt}")::text latest
           FROM "${w.table}"
          WHERE stock_id = $1
            AND "${w.writtenAt}" > $2::timestamp + ($3 || ' days')::interval`,
        s.id, s.deactivated, String(graceDays));
      if (r[0].n > 0) hits.push(`${w.table} +${r[0].n} (latest ${String(r[0].latest).slice(0, 19)})`);
    }
    if (hits.length) {
      violations++;
      console.log(`  ⚠ ${s.symbol.padEnd(13)} deactivated ${s.deactivated.slice(0, 19)} — STILL RECEIVING DATA`);
      for (const h of hits) console.log(`       ${h}`);
    } else {
      console.log(`  OK  ${s.symbol.padEnd(13)} deactivated ${s.deactivated.slice(0, 19)} — no writes since`);
    }
  }

  console.log(`\n=== ${violations === 0 ? "GATE PASSED" : `GATE FAILED — ${violations} stock(s) still being written to`} ===\n`);
  if (violations) {
    console.log(`  A lane is writing to a stock the rest of the system considers dormant. Find it by the`);
    console.log(`  table named above and add the isActive filter to its universe query.\n`);
  }
  await prisma.$disconnect();
  process.exit(violations ? 1 : 0);
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
