// Universe distribution of the Quarter in Brief VERDICT, per family, on each stock's latest quarter.
//
// 2d asks for this before and after any threshold adjustment, so the tuning is visible rather than
// asserted. It also reports the two things a distribution alone would hide: how many stocks get NO
// verdict (and why), and how often the headline and the health score point opposite ways.
//
//   npx tsx src/scripts/quarter-brief-distribution.ts

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { VERDICT_KEYS } from "../insight/quarter-brief/verdict.js";

const FAMILIES = ["non_financial", "banking", "nbfc", "life_insurance", "general_insurance"] as const;
const CONCURRENCY = 8;

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function main(): Promise<void> {
  const stocks = await prisma.stock.findMany({ select: { symbol: true, industryType: true } });
  console.log(`Building ${stocks.length} fact blocks…`);

  const results = await pool(stocks, CONCURRENCY, async (s) => {
    try {
      const b = await buildQuarterBriefFactBlock(s.symbol);
      return { symbol: s.symbol, family: s.industryType as string, block: b };
    } catch {
      return { symbol: s.symbol, family: s.industryType as string, block: null };
    }
  });

  // ── verdict distribution, per family ──────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(96));
  console.log("VERDICT DISTRIBUTION — latest quarter, per family");
  console.log("═".repeat(96));

  const overall = new Map<string, number>();

  for (const family of FAMILIES) {
    const rows = results.filter((r) => r.family === family);
    const withBlock = rows.filter((r) => r.block !== null);
    const counts = new Map<string, number>();
    let noVerdict = 0;

    for (const r of withBlock) {
      const v = r.block!.verdict;
      if (!v) { noVerdict++; continue; }
      counts.set(v.key, (counts.get(v.key) ?? 0) + 1);
      overall.set(v.key, (overall.get(v.key) ?? 0) + 1);
    }

    const denom = withBlock.length || 1;
    console.log(`\n── ${family} — ${withBlock.length} stocks with a block (${rows.length} in family)`);
    const ordered = [...VERDICT_KEYS].filter((k) => (counts.get(k) ?? 0) > 0);
    for (const k of ordered) {
      const c = counts.get(k)!;
      const pct = (c / denom) * 100;
      const flag = pct > 60 ? "  ← OVER 60%" : "";
      console.log(`   ${String(c).padStart(4)}  ${pct.toFixed(1).padStart(5)}%  ${k}${flag}`);
    }
    if (noVerdict > 0) {
      // Break out WHY: a stock with no comparison period is a coverage fact; a stock that lost money
      // in both periods is a real quarter our vocabulary currently has no word for. Different problems.
      let noCompare = 0;
      let lossBoth = 0;
      for (const r of withBlock) {
        if (r.block!.verdict) continue;
        const p = r.block!.headline.profit;
        const c = p.yoy ?? p.qoq;
        if (!c) noCompare++;
        else if (c.kind === "both_loss") lossBoth++;
        else noCompare++;
      }
      console.log(`   ${String(noVerdict).padStart(4)}  ${((noVerdict / denom) * 100).toFixed(1).padStart(5)}%  (no verdict) — no comparison period: ${noCompare}, loss in BOTH periods: ${lossBoth}`);
    }
  }

  const totalWith = results.filter((r) => r.block?.verdict).length;
  console.log(`\n── ALL FAMILIES — ${totalWith} stocks with a verdict`);
  for (const k of VERDICT_KEYS) {
    const c = overall.get(k) ?? 0;
    if (c === 0) continue;
    console.log(`   ${String(c).padStart(4)}  ${((c / totalWith) * 100).toFixed(1).padStart(5)}%  ${k}`);
  }
  const unusedKeys = VERDICT_KEYS.filter((k) => (overall.get(k) ?? 0) === 0);
  if (unusedKeys.length) console.log(`   unused buckets: ${unusedKeys.join(", ")}`);

  // ── headline vs health divergence ─────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(96));
  console.log("HEADLINE vs HEALTH DIVERGENCE — how often the quarter and the score disagree");
  console.log("═".repeat(96));
  const scored = results.filter((r) => r.block?.healthMovement);
  const diverged = results.filter((r) => r.block?.headlineHealthDivergence);
  console.log(`  stocks with a health section : ${scored.length}`);
  console.log(`  of those, divergence fires   : ${diverged.length} (${scored.length ? ((diverged.length / scored.length) * 100).toFixed(1) : "0"}%)`);
  for (const d of diverged.slice(0, 8)) {
    console.log(`    · ${d.symbol}: ${d.block!.headlineHealthDivergence!.display}`);
  }

  // ── margin-path honesty ───────────────────────────────────────────────────────────────────────
  const roundTripped = results.filter((r) =>
    // ⚠ TRACKS margins.ts's WORDING. The round-trip note became its own sentence when the stem was
    // unstacked (2a); this matches the phrase that now carries it.
    r.block?.margins?.series.some((s) => /did not move in a straight line/.test(s.directionDisplay)),
  ).length;
  const withMargins = results.filter((r) => r.block?.margins).length;
  console.log(`\n  stocks carrying a round-trip note: ${roundTripped} of ${withMargins} with margins`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
