// ─────────────────────────────────────────────────────────────────────────────
// PASS 2 — build the monthly FROZEN market-cap tier snapshot.
//
// Ranks the whole universe by DERIVED market cap (latest total_shares × latest
// daily close), via the EXISTING computeMarketCap (no reinvention). Cuts: rank ≤100
// large · 101–250 mid · rest small. Unrankable (null market cap) → tier=unknown,
// rank=null, with unknown_reason ∈ {no_total_shares, no_price, gated_split} so the
// different lifecycles are queryable (gated_split self-heals; no_total_shares
// persists). Freezes under today's as_of_date — append-only, prior freezes untouched.
//
// IDEMPOTENT per as_of_date: a second run same day is a no-op (skip); --force deletes
// ONLY today's rows and re-freezes. Prices used = latest DAILY close (EOD, not intraday).
//
// Would be scheduled monthly (1st) via the jobs/scheduler layer — not built here.
//   npx tsx src/scripts/build-market-cap-tier-snapshot.ts [--force] [--dry-run]
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { computeMarketCap } from "../ingestions/prices/market-cap.js";

const LARGE_MAX = 100;
const MID_MAX = 250;

interface Computed { stockId: string; symbol: string; marketCapCr: number | null; reason: string; }

function todayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const dryRun = argv.includes("--dry-run");
  const asOfDate = todayUtc();
  const asOfStr = asOfDate.toISOString().slice(0, 10);

  // ── Idempotency guard ──
  const existing = await prisma.marketCapTierSnapshot.count({ where: { asOfDate } });
  if (existing > 0 && !force) {
    console.log(`[tier-freeze] as_of_date ${asOfStr} already frozen (${existing} rows). Re-run is a no-op. Use --force to re-freeze today.`);
    await prisma.$disconnect();
    return;
  }

  // ── Latest DAILY close per stock (EOD, not intraday) ──
  const closes = await prisma.$queryRawUnsafe<{ stock_id: string; close: number; date: Date }[]>(`
    SELECT DISTINCT ON (dp.stock_id) dp.stock_id, dp.close::float AS close, dp.date AS date
    FROM daily_prices dp ORDER BY dp.stock_id, dp.date DESC`);
  const closeByStock = new Map(closes.map((r) => [r.stock_id, { close: r.close, date: new Date(r.date) }]));

  const stocks = await prisma.stock.findMany({ select: { id: true, symbol: true }, orderBy: { symbol: "asc" } });
  console.log(`[tier-freeze] as_of_date ${asOfStr} · universe ${stocks.length} · computing derived market cap via computeMarketCap…`);

  // ── Compute derived market cap for all (batched to spare the pool) ──
  const computed: Computed[] = [];
  const BATCH = 10;
  for (let i = 0; i < stocks.length; i += BATCH) {
    const batch = stocks.slice(i, i + BATCH);
    const res = await Promise.all(batch.map(async (s) => {
      const cd = closeByStock.get(s.id);
      const mc = await computeMarketCap(s.id, cd?.close ?? null, cd?.date ?? asOfDate);
      return { stockId: s.id, symbol: s.symbol, marketCapCr: mc.marketCapCr, reason: mc.reason } as Computed;
    }));
    computed.push(...res);
  }

  // ── Partition + rank ──
  const rankable = computed.filter((c) => c.marketCapCr != null)
    .sort((a, b) => (b.marketCapCr! - a.marketCapCr!) || a.symbol.localeCompare(b.symbol));
  const unrankable = computed.filter((c) => c.marketCapCr == null);

  const rows: Prisma.MarketCapTierSnapshotCreateManyInput[] = [];
  rankable.forEach((c, i) => {
    const rank = i + 1;
    const tier = rank <= LARGE_MAX ? "large" : rank <= MID_MAX ? "mid" : "small";
    rows.push({ stockId: c.stockId, tier, rank, marketCap: new Prisma.Decimal(c.marketCapCr!), unknownReason: null, asOfDate });
  });
  for (const c of unrankable) {
    // reason is one of no_total_shares | no_price | gated_split (computeMarketCap never
    // returns "stamped" with a null market cap).
    rows.push({ stockId: c.stockId, tier: "unknown", rank: null, marketCap: null, unknownReason: c.reason, asOfDate });
  }

  // ── Report (counts + unknown-by-reason + boundary gaps) ──
  const tierCount = (t: string) => rows.filter((r) => r.tier === t).length;
  console.log(`\n=== FREEZE ${asOfStr} — tier counts ===`);
  console.log(`  large   : ${tierCount("large")}`);
  console.log(`  mid     : ${tierCount("mid")}`);
  console.log(`  small   : ${tierCount("small")}`);
  console.log(`  unknown : ${tierCount("unknown")}`);

  const byReason = new Map<string, string[]>();
  for (const c of unrankable) { if (!byReason.has(c.reason)) byReason.set(c.reason, []); byReason.get(c.reason)!.push(c.symbol); }
  console.log(`\n=== unknown by reason ===`);
  for (const [reason, syms] of byReason) console.log(`  ${reason.padEnd(16)} (${syms.length}): ${syms.sort().join(", ")}`);

  const gapAt = (arr: Computed[], lo: number, hi: number) => {
    console.log(`\n  ranks ${lo}–${hi} (gap = % drop vs prev rank):`);
    for (let r = lo; r <= hi && r <= arr.length; r++) {
      const cur = arr[r - 1], prev = arr[r - 2];
      const gap = prev ? ((prev.marketCapCr! - cur.marketCapCr!) / prev.marketCapCr! * 100) : null;
      console.log(`    #${String(r).padStart(3)}  ${cur.symbol.padEnd(13)} ₹${Math.round(cur.marketCapCr!).toLocaleString("en-IN")} Cr  gap=${gap == null ? "-" : gap.toFixed(2) + "%"}`);
    }
  };
  console.log(`\n=== BOUNDARY VALIDATION (deferred rank-250 check) ===`);
  gapAt(rankable, 95, 105);
  gapAt(rankable, 245, 255);

  // ── Persist ──
  if (dryRun) { console.log(`\n(dry-run — no writes. ${rows.length} rows would be frozen.)`); await prisma.$disconnect(); return; }
  if (force && existing > 0) {
    const del = await prisma.marketCapTierSnapshot.deleteMany({ where: { asOfDate } });
    console.log(`\n[--force] deleted ${del.count} existing rows for ${asOfStr}`);
  }
  const ins = await prisma.marketCapTierSnapshot.createMany({ data: rows, skipDuplicates: true });
  console.log(`\n[tier-freeze] inserted ${ins.count} rows for ${asOfStr} (rankable ${rankable.length} + unknown ${unrankable.length}).`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
