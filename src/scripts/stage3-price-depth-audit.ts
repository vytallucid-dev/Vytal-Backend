// ═══════════════════════════════════════════════════════════════
// STAGE 3 AUDIT — how deep does daily_prices actually go, per stock, against the
// 2019-01-01 target? Read-only.
//
//   npx tsx src/scripts/stage3-price-depth-audit.ts
//
// The plan says "only 6 stocks have a price gap at 2019". That claim predates the
// Stage 0 retention change and needs re-measuring before any fetch: the nightly
// depth prune (keep=2000, floor=760) trims the OLDEST bars per stock, so the
// observed floor is a function of the policy as much as of what was fetched.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";

const TARGET = "2019-01-01";
const OUT = "_s3-price-depth.json";

async function main(): Promise<void> {
  const [pol] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT keep, floor, enabled, armed FROM retention_policy WHERE table_name = 'daily_prices'`,
  );
  console.log(`\n=== STAGE 3 AUDIT — daily_prices depth vs ${TARGET} ===`);
  console.log(`  retention policy: keep=${pol?.keep} floor=${pol?.floor} enabled=${pol?.enabled} armed=${pol?.armed}\n`);

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT s.symbol, s.is_active,
            count(d.*)::int bars,
            min(d.date)::text mn, max(d.date)::text mx
     FROM stocks s LEFT JOIN daily_prices d ON d.stock_id = s.id
     WHERE s.is_active = true
     GROUP BY s.symbol, s.is_active
     ORDER BY s.symbol`,
  );

  const withPrices = rows.filter((r) => Number(r.bars) > 0);
  const noPrices = rows.filter((r) => Number(r.bars) === 0);
  const reach2019 = withPrices.filter((r) => String(r.mn) <= TARGET);
  const short = withPrices.filter((r) => String(r.mn) > TARGET);

  console.log(`  active stocks                 ${rows.length}`);
  console.log(`  with any price bars           ${withPrices.length}`);
  console.log(`  with NO price bars            ${noPrices.length}${noPrices.length ? `  (${noPrices.map((r) => r.symbol).join(", ")})` : ""}`);
  console.log(`  reaching ${TARGET}         ${reach2019.length}`);
  console.log(`  SHORT of ${TARGET}         ${short.length}`);

  // Distribution of the earliest bar — is there a common floor (a policy artifact)
  // or a spread (genuine per-stock listing dates)?
  const byMonth = new Map<string, number>();
  for (const r of withPrices) {
    const m = String(r.mn).slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
  }
  const top = [...byMonth].sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(`\n  -- earliest bar, most common months --`);
  for (const [m, n] of top) console.log(`     ${m}  ${String(n).padStart(4)} stocks${n > 50 ? "   <- a FLOOR, not a listing date" : ""}`);

  const bars = withPrices.map((r) => Number(r.bars)).sort((a, b) => a - b);
  console.log(`\n  -- bar counts --`);
  console.log(`     min=${bars[0]}  p10=${bars[Math.floor(bars.length * 0.1)]}  median=${bars[Math.floor(bars.length / 2)]}  max=${bars[bars.length - 1]}`);
  console.log(`     stocks at/above keep=${pol?.keep}: ${bars.filter((b) => b >= Number(pol?.keep ?? 0)).length}`);

  // How many bars would a full 2019-01-01 history be, and does keep allow it?
  const sessions = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT count(DISTINCT date)::int n FROM daily_prices WHERE date >= $1::date`, TARGET,
  );
  console.log(`\n  distinct sessions already stored since ${TARGET}: ${Number(sessions[0].n)}`);
  console.log(`  (a stock listed before 2019 should end up near this number)`);

  console.log(`\n  -- deepest 10 stocks --`);
  for (const r of [...withPrices].sort((a, b) => Number(b.bars) - Number(a.bars)).slice(0, 10))
    console.log(`     ${String(r.symbol).padEnd(13)} ${String(r.bars).padStart(5)} bars  ${r.mn} .. ${r.mx}`);

  console.log(`\n  -- shallowest 15 stocks --`);
  for (const r of [...withPrices].sort((a, b) => Number(a.bars) - Number(b.bars)).slice(0, 15))
    console.log(`     ${String(r.symbol).padEnd(13)} ${String(r.bars).padStart(5)} bars  ${r.mn} .. ${r.mx}`);

  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(), target: TARGET, policy: pol,
    stocks: rows.map((r) => ({ symbol: r.symbol, bars: Number(r.bars), earliest: r.mn, latest: r.mx })),
  }, null, 2));
  console.log(`\n  detail -> ${OUT}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
