// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Deepen the CONSOLIDATED series from BSE, under the fence.
//
// The BSE fallback now asks for both bases (bse-fallback.ts). This runs it over the stocks that
// need it, with the T3 fence captured BEFORE and verified AFTER — the same proof the lane has
// always carried, re-asserted because the lane now writes rows it never wrote before.
//
//   npx tsx src/scripts/run-bse-consolidated-deepen.ts [--apply] [SYMBOL ...]
//
// With no symbols it takes every stock still carrying an open continuity flag.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { runBseFallbackForStock } from "../ingestions/quaterly-results/bse-fallback.js";
import { captureBaseline, verifyFence } from "../ingestions/quaterly-results/bse/bse-fence.js";

const APPLY = process.argv.includes("--apply");
const argSyms = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const symbols = argSyms.length
  ? argSyms
  : [...new Set((await prisma.$queryRaw<{ symbol: string }[]>`
      SELECT DISTINCT s.symbol FROM ingestion_errors e
      JOIN stocks s ON s.id = split_part(e.target_entity,'@',1)
      WHERE e.status='open' AND e.guard_type='continuity' ORDER BY 1`).map((r) => r.symbol))];

const before = await prisma.$queryRaw<{ rt: string; n: bigint }[]>`
  SELECT result_type rt, count(*) n FROM quarterly_results GROUP BY 1 ORDER BY 1`;
console.log(`quarterly_results before: ${before.map((r) => `${r.rt} ${r.n}`).join(", ")}`);
console.log(`stocks to deepen: ${symbols.length}\n`);

if (!APPLY) {
  console.log("(dry run — pass --apply to fetch and write)");
  await prisma.$disconnect();
  process.exit(0);
}

// ── THE FENCE, captured before a single request goes out. ──
const runStart = new Date();
const baseline = await captureBaseline(prisma);
console.log(`fence baseline: ${Object.values(baseline.totals).reduce((a, b) => a + b, 0)} NSE rows across ${Object.keys(baseline.totals).length} tables\n`);

let attempted = 0, written = 0;
for (const symbol of symbols) {
  const s = await prisma.stock.findUnique({ where: { symbol }, select: { id: true, symbol: true, industryType: true } });
  if (!s) { console.log(`  ${symbol.padEnd(12)} not found`); continue; }
  const r = await runBseFallbackForStock(
    { id: s.id, symbol: s.symbol, industryType: String(s.industryType) },
    { windowQuarters: 12, log: (l) => console.log("   " + l) },
  );
  attempted += r.attempted; written += r.written;
  console.log(`  ${symbol.padEnd(12)} attempted=${r.attempted} written=${r.written} ${r.skippedReason ?? ""}`);
}

// ── THE PROOF. ──
const fence = await verifyFence(prisma, baseline, runStart);
const after = await prisma.$queryRaw<{ rt: string; n: bigint }[]>`
  SELECT result_type rt, count(*) n FROM quarterly_results GROUP BY 1 ORDER BY 1`;

console.log(`\n${"═".repeat(70)}`);
console.log(`periods attempted : ${attempted}`);
console.log(`rows written      : ${written}`);
console.log(`quarterly_results after: ${after.map((r) => `${r.rt} ${r.n}`).join(", ")}`);
console.log(`\n── THE FENCE ──`);
console.log(`  NSE rows updated or gone since the baseline : ${fence.violations.length}`);
console.log(`  NSE rows with updated_at after run start    : ${Object.values(fence.touchedSinceStart).reduce((a, b) => a + b, 0)}`);
if (fence.violations.length) for (const v of fence.violations.slice(0, 10)) console.log(`     ✗ ${v.table} ${v.rowId} ${v.kind}: ${v.detail}`);
console.log(fence.ok ? `  ✅ FENCE HOLDS — not one NSE row moved.` : `  ✗✗ FENCE BREACHED.`);

await prisma.$disconnect();
process.exit(fence.ok ? 0 : 1);
