// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 22 — market_cap_category, COMPUTED FROM DATA WE ALREADY HOLD.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage22-market-cap-category.ts            # dry
//   npx tsx src/scripts/stage22-market-cap-category.ts --commit
//
// No external source. Market cap = latest close × shares outstanding, and both are already here:
// `daily_prices` (2,290 stocks) and `shareholding_patterns.total_shares` (2,057). SEBI's rule is
// RANK-based, not threshold-based — top 100 by full market cap are large, 101–250 mid, 251+ small —
// so the whole classification falls out of one ordering.
//
// ── TWO HONEST DEPARTURES FROM THE OFFICIAL LIST, BOTH DELIBERATE ────────────────────────────────
//  1. SEBI/AMFI rank on the **6-month average** full market cap and publish twice a year. This uses
//     the LATEST close. Near a boundary (ranks ~95-105, ~245-255) a stock can therefore sit one
//     bucket away from the published list. That is acceptable for a display label and is not
//     acceptable for anything that must match AMFI exactly — if that day comes, ingest their list
//     rather than deriving it.
//  2. The ranking universe is OUR 2,290 NSE EQ stocks, not all listed India. Since we hold
//     essentially the whole EQ segment, the top 250 is very close to the real top 250 — but a
//     BSE-only large cap would be invisible to it, and none of ours are.
//
// ── A STOCK WITH NO SHARE COUNT GETS NULL, NOT A GUESS ───────────────────────────────────────────
// 233 stocks have prices but no shareholding row (mostly 2024+ listings that have filed nothing).
// Market cap is unknowable for them. NULL says that; small_cap would be an assumption wearing the
// costume of a fact, and it would be wrong for any recently-listed large company.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const COMMIT = process.argv.includes("--commit");
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

const LARGE_RANK = 100;
const MID_RANK = 250;

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 22 — market_cap_category  ${COMMIT ? "*** COMMIT ***" : "(dry)"}`);
  console.log("=".repeat(100));

  // Latest close × latest known share count, per stock. DISTINCT ON gives the most recent of each
  // without a correlated subquery per row.
  const rows = await raw<{ symbol: string; mcap: string; close: string; shares: string; as_on: string }>(`
    WITH px AS (
      SELECT DISTINCT ON (stock_id) stock_id, close, date FROM daily_prices ORDER BY stock_id, date DESC
    ), sh AS (
      SELECT DISTINCT ON (stock_id) stock_id, total_shares, as_on_date
        FROM shareholding_patterns WHERE total_shares IS NOT NULL AND total_shares > 0
       ORDER BY stock_id, as_on_date DESC
    )
    SELECT s.symbol,
           (px.close * sh.total_shares)::numeric AS mcap,
           px.close::text AS close,
           sh.total_shares::text AS shares,
           sh.as_on_date::text AS as_on
      FROM stocks s
      JOIN px ON px.stock_id = s.id
      JOIN sh ON sh.stock_id = s.id
     WHERE s.is_active
     ORDER BY (px.close * sh.total_shares) DESC`);

  const total = (await raw<{ n: number }>(`SELECT count(*)::int n FROM stocks WHERE is_active`))[0].n;
  console.log(`\n  active stocks ${total} · classifiable ${rows.length} · no share count (stay NULL) ${total - rows.length}`);

  const bucket = (i: number): string => (i < LARGE_RANK ? "large_cap" : i < MID_RANK ? "mid_cap" : "small_cap");
  const counts: Record<string, number> = {};
  rows.forEach((_, i) => { const b = bucket(i); counts[b] = (counts[b] ?? 0) + 1; });
  console.log(`  ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);

  const cr = (n: string): string => `₹${(Number(n) / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr`;
  console.log(`\n  boundaries (a sanity check — these should be recognisable names):`);
  for (const i of [0, 1, 2, LARGE_RANK - 1, LARGE_RANK, MID_RANK - 1, MID_RANK, rows.length - 1]) {
    if (i >= rows.length) continue;
    console.log(`     #${String(i + 1).padStart(4)}  ${rows[i].symbol.padEnd(14)} ${cr(rows[i].mcap).padStart(16)}  ${bucket(i)}`);
  }

  if (!COMMIT) { console.log(`\n  dry — re-run with --commit.\n`); await prisma.$disconnect(); return; }

  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    // Grouped by bucket so this is 3 statements per chunk, not 500.
    for (const b of ["large_cap", "mid_cap", "small_cap"]) {
      const syms = chunk.filter((_, k) => bucket(i + k) === b).map((r) => r.symbol);
      if (!syms.length) continue;
      n += await prisma.$executeRawUnsafe(
        `UPDATE stocks SET market_cap_category = $1, updated_at = now() WHERE symbol = ANY($2::text[])`, b, syms);
    }
  }
  console.log(`\n  classified ${n} stock(s)`);
  console.log(`  still NULL: ${(await raw<{ n: number }>(`SELECT count(*)::int n FROM stocks WHERE is_active AND market_cap_category IS NULL`))[0].n} (no share count)\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
