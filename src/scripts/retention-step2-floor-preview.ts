// ═══════════════════════════════════════════════════════════════
// RETENTION — STEP 2 FLOOR-MARGIN PREVIEW (READ-ONLY, deletes nothing).
// Proves the daily_prices depth trim (keep newest 1000 per stock, floor 760)
// never reduces any stock's retained set below the floor, and shows the thinnest
// stocks so the margin is SEEN, not assumed. No --confirm, no delete path.
//
//   npx tsx src/scripts/retention-step2-floor-preview.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const KEEP = 1000;
const FLOOR = 760;

type Row = { symbol: string; cnt: number; post_trim: number; trimmed: number; newest: Date };

async function main() {
  const effectiveKeep = Math.max(KEEP, FLOOR); // = 1000 (keep ≥ floor → no clamp)
  console.log(`\n═══ daily_prices FLOOR-MARGIN PREVIEW (read-only) ═══`);
  console.log(`keep=${KEEP} · floor=${FLOOR} · effectiveKeep=max(keep,floor)=${effectiveKeep} · clamp=${effectiveKeep !== KEEP}\n`);

  const rows = (await prisma.$queryRawUnsafe(
    `WITH pk AS (
       SELECT dp.stock_id, count(*)::int AS cnt, max(dp.date) AS newest
       FROM daily_prices dp GROUP BY dp.stock_id
     )
     SELECT s.symbol, pk.cnt, LEAST(pk.cnt, $1)::int AS post_trim, GREATEST(pk.cnt - $1, 0)::int AS trimmed, pk.newest
     FROM pk JOIN stocks s ON s.id = pk.stock_id
     ORDER BY pk.cnt ASC`,
    effectiveKeep,
  )) as Row[];

  const totalStocks = rows.length;
  const surplus = rows.reduce((s, r) => s + r.trimmed, 0);
  const trimmedStocks = rows.filter((r) => r.trimmed > 0);
  const untrimmed = rows.filter((r) => r.trimmed === 0);
  const minPostTrimAmongTrimmed = trimmedStocks.length ? Math.min(...trimmedStocks.map((r) => r.post_trim)) : null;
  const belowFloorTrimmed = trimmedStocks.filter((r) => r.post_trim < FLOOR); // MUST be empty
  const thinKeepAll = untrimmed.filter((r) => r.cnt < FLOOR); // thin stocks that keep everything (NOT violations)

  console.log(`Live count now (drifts ~+424/day): would delete ${surplus} rows across ${trimmedStocks.length} stocks (of ${totalStocks}).`);
  console.log(`  (GATE-0 baseline was 105,364 across 424 stocks — expect upward drift.)\n`);

  console.log(`── THINNEST 12 stocks (smallest row count) — depth-not-time keeps them WHOLE ──`);
  console.log(`  ${"symbol".padEnd(14)} ${"rows".padEnd(6)} ${"post-trim".padEnd(10)} ${"trimmed".padEnd(8)} newest`);
  for (const r of rows.slice(0, 12)) {
    console.log(`  ${r.symbol.padEnd(14)} ${String(r.cnt).padEnd(6)} ${String(r.post_trim).padEnd(10)} ${String(r.trimmed).padEnd(8)} ${new Date(r.newest).toISOString().slice(0, 10)}`);
  }

  console.log(`\n── FLOOR ASSERTIONS ───────────────────────────────────────────`);
  console.log(`  stocks with cnt > ${effectiveKeep} (TRIMMED → land at exactly ${effectiveKeep}): ${trimmedStocks.length}`);
  console.log(`  stocks with cnt ≤ ${effectiveKeep} (UNTRIMMED → keep all): ${untrimmed.length}`);
  console.log(`  of those, thin stocks with cnt < ${FLOOR} that keep everything (NOT floor violations): ${thinKeepAll.length}`);
  if (thinKeepAll.length) {
    console.log(`     e.g. ${thinKeepAll.slice(0, 6).map((r) => `${r.symbol}(${r.cnt})`).join(", ")}`);
  }
  console.log("");
  const A = minPostTrimAmongTrimmed === null || minPostTrimAmongTrimmed >= FLOOR;
  console.log(`  ${A ? "✅" : "❌"} no TRIMMED stock lands below the floor — min post-trim among trimmed = ${minPostTrimAmongTrimmed ?? "n/a"} (≥ ${FLOOR})`);
  console.log(`  ${belowFloorTrimmed.length === 0 ? "✅" : "❌"} zero stocks trimmed below ${FLOOR}: ${belowFloorTrimmed.length}`);
  const under800 = trimmedStocks.filter((r) => r.post_trim < 800);
  console.log(`  ${under800.length === 0 ? "✅" : "⚠️ "} zero TRIMMED stocks land under 800: ${under800.length}${under800.length ? " — " + under800.map((r) => r.symbol + "(" + r.post_trim + ")").join(", ") : ""}`);
  console.log(`\n  Interpretation: trimming only ever removes a stock's OLDEST rows beyond ${effectiveKeep}; every`);
  console.log(`  trimmed stock retains exactly ${effectiveKeep} (${effectiveKeep - FLOOR} above the ${FLOOR} floor). Thin stocks are never`);
  console.log(`  touched. The Market A2 lookback (756 trading days) is safe for every stock.\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
