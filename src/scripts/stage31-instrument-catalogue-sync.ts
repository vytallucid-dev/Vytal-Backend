// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 31 — GIVE EVERY ACTIVE STOCK ITS INSTRUMENT CATALOGUE ROW.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage31-instrument-catalogue-sync.ts            # dry
//   npx tsx src/scripts/stage31-instrument-catalogue-sync.ts --commit
//
// ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
// `stocks` holds 2,290 active companies; `instruments` holds 504 rows with asset_class='stock'. The
// universe expansion never propagated to the catalogue, so 1,787 companies exist as stocks and are
// absent from the instrument spine. Anything that enumerates instruments — the logo work that found
// this, chat's instrument lookup, the asset-class surfaces — has been quietly seeing the old universe.
//
// ── WHY THIS IS SAFE, CHECKED RATHER THAN ASSUMED ────────────────────────────────────────────────
// The obvious fear is broker sync: `universe-admit.ts` resolves a holding against the catalogue
// before it resolves against `stocks`, so widening the catalogue could in principle re-route
// equities. It cannot. That pass filters `stockId: null` — non-equity rows ONLY — and its own comment
// says why: "An instrument WITH a stockId is an equity's catalogue row, and those belong to Pass
// 1/2." Every row this script writes carries a stockId, so every one of them is invisible to that
// pass. The equity path reads `stocks` and is untouched.
//
// MEASURED before writing: 1,787 stocks missing a row · 0 ISIN collisions against existing
// instruments · 0 duplicate ISINs among them · 0 blank ISINs. The ISIN check is the one that matters,
// because `instruments.isin` is UNIQUE — a collision would abort mid-run.
//
// ── THE ROW IS DELIBERATELY MINIMAL ──────────────────────────────────────────────────────────────
// isin · symbol · name · asset_class='stock' · stock_id · is_active. Nothing else, because that is
// exactly what the existing 504 carry: `attributes`, `last_price` and `nav` are all NULL on every
// one of them. An equity prices off `stocks`/`daily_prices`, not off its catalogue row, and writing a
// price here would create a second source of truth for a number that already has one.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";

const COMMIT = process.argv.includes("--commit");
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 31 — instrument catalogue sync  ${COMMIT ? "*** COMMIT ***" : "(dry)"}`);
  console.log("=".repeat(100));

  const before = await raw<{ stocks: number; insts: number }>(
    `SELECT (SELECT count(*)::int FROM stocks WHERE is_active) stocks,
            (SELECT count(*)::int FROM instruments WHERE asset_class = 'stock') insts`);
  console.log(`\n  active stocks ${before[0].stocks} · instruments(asset_class=stock) ${before[0].insts}`);

  // ⚠ THE COLLISION GATE RUNS EVERY TIME, not just the once it was measured. instruments.isin is
  //   UNIQUE; a stock whose ISIN is already catalogued under another asset class would abort the run
  //   part-way and leave the catalogue half-synced.
  const collisions = await raw<{ symbol: string; isin: string; asset_class: string }>(`
    SELECT s.symbol, s.isin, i.asset_class FROM stocks s
      JOIN instruments i ON i.isin = s.isin AND i.stock_id IS DISTINCT FROM s.id
     WHERE s.is_active`);
  if (collisions.length) {
    console.log(`\n  ⛔ ${collisions.length} ISIN collision(s) — refusing to write:`);
    for (const c of collisions.slice(0, 10)) console.log(`     ${c.symbol} ${c.isin} already catalogued as ${c.asset_class}`);
    await prisma.$disconnect();
    return;
  }
  console.log(`  ISIN collisions: none`);

  const missing = await raw<{ id: string; symbol: string; name: string; isin: string }>(`
    SELECT s.id, s.symbol, s.name, s.isin FROM stocks s
     WHERE s.is_active AND NOT EXISTS (SELECT 1 FROM instruments i WHERE i.stock_id = s.id)
     ORDER BY s.symbol`);
  console.log(`  stocks with no catalogue row: ${missing.length}`);

  if (!COMMIT) {
    console.log(`\n  sample: ${missing.slice(0, 5).map((m) => m.symbol).join(", ")}`);
    console.log(`\n  dry — re-run with --commit.\n`);
    await prisma.$disconnect();
    return;
  }

  let wrote = 0;
  for (let i = 0; i < missing.length; i += 200) {
    for (const m of missing.slice(i, i + 200)) {
      // ON CONFLICT DO NOTHING on the ISIN spine: a concurrent broker admit could create the same
      // row between the read above and this write, and losing that race should be a no-op, not a throw.
      wrote += await prisma.$executeRawUnsafe(
        `INSERT INTO instruments (id, isin, symbol, name, asset_class, stock_id, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'stock', $5, true, now(), now())
         ON CONFLICT (isin) DO NOTHING`,
        randomUUID(), m.isin, m.symbol, m.name, m.id);
    }
    process.stdout.write(`\r  writing… ${Math.min(i + 200, missing.length)}/${missing.length}`);
  }

  const after = await raw<{ insts: number; linked: number; orphan: number }>(`
    SELECT count(*)::int insts,
           count(stock_id)::int linked,
           count(*) FILTER (WHERE stock_id IS NULL)::int orphan
      FROM instruments WHERE asset_class = 'stock'`);
  console.log(`\n\n  wrote ${wrote} row(s)`);
  console.log(`  instruments(asset_class=stock): ${after[0].insts} · linked to a stock ${after[0].linked} · unlinked ${after[0].orphan}`);

  const left = await raw<{ n: number }>(`
    SELECT count(*)::int n FROM stocks s
     WHERE s.is_active AND NOT EXISTS (SELECT 1 FROM instruments i WHERE i.stock_id = s.id)`);
  console.log(`  active stocks still without a catalogue row: ${left[0].n}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
