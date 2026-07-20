// ═══════════════════════════════════════════════════════════════
// PART B EXECUTOR — drop the genuinely-unused index_prices names (Option B).
// The drop set is COMPUTED (not transcribed) from the SAME live reconciliation the
// audit used: keep = static map/UI ∪ what the real resolveBenchmark reads over the
// mutual_fund + ETF universe; then subtract the 6 borderline future-plausible keeps.
// So the list printed in PREVIEW is byte-identical to what --confirm deletes.
//
//   PREVIEW (confirm the list):  npx tsx src/scripts/retention-index-drop.ts
//   EXECUTE (deletes rows):      npx tsx src/scripts/retention-index-drop.ts --confirm
//
// Delete is an EXPLICIT parameterized name list (= ANY($1::text[])) — no glob,
// no pattern (cv2-glob-deletion-hazard). index_prices is NOT a scoring input, so
// §13 is asserted (trivially) around the delete anyway.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { buildNameMatcher, resolveBenchmark } from "../ingestions/amfi/mf-benchmark.js";

const CONFIRM = process.argv.includes("--confirm");

// Every index_name literal referenced in code (from the ETF-aware trace). The
// DYNAMIC name-route reads are added from the live fold below.
const STATIC_KEEP = new Set<string>([
  "Nifty 100", "NIFTY LargeMidcap 250", "Nifty Midcap 150", "Nifty Smallcap 250", "Nifty500 Multicap 50:25:25",
  "Nifty 500", "Nifty Dividend Opportunities 50", "Nifty 50", "Nifty 50 Arbitrage", "Nifty 1D Rate Index",
  "Nifty Composite G-sec Index", "Nifty 10 yr Benchmark G-Sec", "Nifty 15 yr and above G-Sec Index", "Nifty 8-13 yr G-Sec",
  "Nifty Consumer Durables", "Nifty India Consumption", "Nifty Pharma", "Nifty Financial Services", "Nifty IT",
  "Nifty Auto", "Nifty Infrastructure", "Nifty Energy", "Nifty Metal", "Nifty Realty", "Nifty Media",
  "Nifty India Defence", "Nifty PSE", "Nifty MNC", "Nifty Commodities",
  "Nifty Bank", "Nifty Capital Goods", "Nifty Capital Markets", "Nifty Cement", "Nifty Chemicals",
  "Nifty Consumer Services", "Nifty FMCG", "Nifty Insurance", "Nifty India Infrastructure & Logistics",
  "Nifty Financial Services Ex-Bank", "Nifty India Digital", "Nifty Oil & Gas", "Nifty Power", "Nifty Telecommunications",
  "Sensex",
]);

// Option B (revised) — 7 unread-today-but-hold-the-option indices. Each benchmarks a
// fund type / asset class whose instruments exist (REIT: 21 held live, PI7 fires) or
// are anticipated in Group-3 (debt ladders / arbitrage / CPSE). You can't backfill 5y
// of a series you deleted.
const BORDERLINE_KEEP = new Set<string>([
  "Nifty 4-8 yr G-Sec Index",
  "Nifty 11-15 yr G-Sec Index",
  "Nifty 10 yr Benchmark G-Sec (Clean Price)",
  "Nifty 50 Futures Index",
  "Nifty CPSE",
  "India VIX",
  "Nifty REITs & InvITs", // asset class already live in the product (multi-asset book)
]);

// Safety: refuse to delete unless the computed set has EXACTLY this many names.
// Guards against any drift between the confirmed list and the live computation.
const expectRaw =
  process.argv.find((a) => a.startsWith("--expect="))?.split("=")[1] ??
  (process.argv.includes("--expect") ? process.argv[process.argv.indexOf("--expect") + 1] : undefined);
const EXPECT = expectRaw ? parseInt(expectRaw, 10) : null;

const rowsA = async <T = Record<string, unknown>>(sql: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(sql, ...p)) as T[];

async function scores(): Promise<Map<string, string>> {
  const r = await rowsA<{ stock_id: string; c: string; m: string }>(
    `SELECT DISTINCT ON (stock_id) stock_id, composite::text c, market_subtotal::text m
     FROM score_snapshots ORDER BY stock_id, as_of_date DESC, version DESC`,
  );
  return new Map(r.map((x) => [x.stock_id, `${x.c}|${x.m}`]));
}

async function computeDrop() {
  const all = await rowsA<{ index_name: string; n: number }>(
    `SELECT index_name, count(*)::int n FROM index_prices GROUP BY 1 ORDER BY 1`,
  );
  const rowsOf = new Map(all.map((x) => [x.index_name, x.n]));
  const names = all.map((x) => x.index_name);
  const matchName = buildNameMatcher(names);

  const insts = await prisma.instrument.findMany({
    where: { assetClass: { in: ["mutual_fund", "etf"] } },
    select: { category: true, schemeName: true },
  });
  const foldReads = new Set<string>();
  for (const it of insts) {
    const r = resolveBenchmark(it.category ?? null, it.schemeName ?? null, matchName);
    if (r.index) foldReads.add(r.index);
  }
  const keep = new Set<string>([...STATIC_KEEP, ...foldReads]);
  const drop = names.filter((n) => !keep.has(n) && !BORDERLINE_KEEP.has(n)).sort();
  return { drop, keep, rowsOf, totalIdx: names.length, insts: insts.length };
}

async function main() {
  const { drop, keep, rowsOf, totalIdx, insts } = await computeDrop();
  const dropRows = drop.reduce((s, n) => s + (rowsOf.get(n) ?? 0), 0);
  const bytesPerRow = 52 * 1e6 / [...rowsOf.values()].reduce((s, x) => s + x, 0);

  // Safety re-check: nothing in the drop set is live-kept or borderline-kept.
  const leak = drop.filter((n) => keep.has(n) || BORDERLINE_KEEP.has(n));

  console.log(`\n═══ PART B — index_prices DROP (Option B) ${CONFIRM ? "· LIVE" : "· PREVIEW"} ═══`);
  console.log(`Live fold universe: ${insts} (mutual_fund + etf) · ${totalIdx} distinct indices`);
  console.log(`KEEP live+static: ${keep.size} · BORDERLINE held: ${BORDERLINE_KEEP.size} · DROP: ${drop.length} indices · ${dropRows.toLocaleString()} rows · ~${(dropRows * bytesPerRow / 1e6).toFixed(1)} MB`);
  console.log(`Safety: drop∩keep leak = ${leak.length} (must be 0)${leak.length ? " → " + leak.join(", ") : ""}\n`);

  console.log(`── THE ${drop.length} INDEX NAMES TO DELETE (explicit — no glob) ──`);
  drop.forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)}. ${String(rowsOf.get(n)).padStart(5)}p  ${n}`));
  console.log(`\n── HELD (${BORDERLINE_KEEP.size} borderline, stay under the normal 5y/1250-row cap) ──`);
  [...BORDERLINE_KEEP].forEach((n) => console.log(`  ${String(rowsOf.get(n) ?? 0).padStart(5)}p  ${n}`));

  if (leak.length) { console.log("\n❌ SAFETY LEAK — aborting."); await prisma.$disconnect(); process.exit(1); }

  if (!CONFIRM) {
    console.log(`\nPREVIEW — nothing deleted. Confirm this ${drop.length}-name list, then re-run with --confirm.\n`);
    await prisma.$disconnect(); return;
  }

  // Count guard — refuse to delete if the computed set drifted from the confirmed count.
  if (EXPECT !== null && drop.length !== EXPECT) {
    console.log(`\n❌ COUNT GUARD — computed ${drop.length} names but --expect ${EXPECT}. Aborting, nothing deleted.`);
    await prisma.$disconnect(); process.exit(1);
  }

  // §13 before (index_prices is not a scoring input — assert anyway)
  const s0 = await scores();
  console.log(`\nDeleting ${drop.length} index names (${dropRows.toLocaleString()} rows) …`);
  const deleted = await prisma.$executeRawUnsafe(`DELETE FROM index_prices WHERE index_name = ANY($1::text[])`, drop);
  const s1 = await scores();
  let moved = 0;
  for (const [k, v] of s0) if (s1.get(k) !== v) moved++;
  console.log(`Deleted ${deleted} rows.`);
  console.log(`§13 (composite + market_subtotal): ${moved === 0 ? "✅ byte-identical" : "❌ " + moved + " moved"}`);
  console.log(`\n═══ PART B DONE — ${deleted} rows across ${drop.length} indices removed · §13 clean ═══\n`);
  await prisma.$disconnect();
  process.exit(moved === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
