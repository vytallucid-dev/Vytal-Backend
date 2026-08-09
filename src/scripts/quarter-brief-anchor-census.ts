// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ANCHOR CENSUS — how the Stage-1 magnitude anchors and the Stage-2 peer set actually land across
// the live universe. Read-only: builds every fact block, makes no AI call and writes nothing.
//
// This is the instrument the anchor budget (MAX_ANCHORS_PER_CARD) and the depth floors are calibrated
// against. Re-run it after changing any floor, ANCHOR_ALWAYS, PEER_METRICS or a manifest steady band —
// the numbers in anchors.ts's header came from here and a change that moves them should move them too.
//
//   npx tsx src/scripts/quarter-brief-anchor-census.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { renderFactText } from "../insight/quarter-brief/prompt.js";
import { buildStory } from "../insight/quarter-brief/story.js";

async function main(): Promise<void> {
  const stocks = await prisma.stock.findMany({
    where: { isActive: true }, select: { symbol: true }, orderBy: { symbol: "asc" },
  });

  const perCard: number[] = [];
  const bySource = new Map<string, number>();
  const byMetric = new Map<string, number>();
  const byFamily = new Map<string, { cards: number; anchors: number; none: number }>();
  const groupCounts = new Map<string, number>();
  let driverDominant = 0, driverOffset = 0, driverNone = 0;
  let peerCards = 0, peerComparisons = 0, built = 0;
  const factChars: number[] = [];

  for (const s of stocks) {
    let block;
    try { block = await buildQuarterBriefFactBlock(s.symbol); } catch { continue; }
    if (!block) continue;
    built++;
    const fam = block.identity.family;
    const fb = byFamily.get(fam) ?? { cards: 0, anchors: 0, none: 0 };
    byFamily.set(fam, fb);
    fb.cards++;

    const anchored = block.quarter.lines.filter((l) => l.anchor);
    perCard.push(anchored.length);
    fb.anchors += anchored.length;
    if (anchored.length === 0) fb.none++;
    for (const l of anchored) {
      bySource.set(l.anchorSource ?? "?", (bySource.get(l.anchorSource ?? "?") ?? 0) + 1);
      byMetric.set(`${fam}.${l.key}`, (byMetric.get(`${fam}.${l.key}`) ?? 0) + 1);
    }

    if (block.peers) { peerCards++; peerComparisons += block.peers.comparisons.length; }
    if (!block.driver) driverNone++;
    else if (block.driver.form === "dominant") driverDominant++;
    else driverOffset++;

    for (const g of buildStory(block)) groupCounts.set(g.key, (groupCounts.get(g.key) ?? 0) + 1);
    factChars.push(renderFactText(block).length);
    if (built % 100 === 0) process.stderr.write(`  …${built}\n`);
  }

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const pctl = (xs: number[], p: number) => { const t = [...xs].sort((a, b) => a - b); return t[Math.min(t.length - 1, Math.floor((p / 100) * t.length))]; };

  console.log("\n" + "═".repeat(96));
  console.log(`ANCHOR CENSUS — ${built} cards built (latest quarter of each active stock)`);
  console.log("═".repeat(96));
  console.log(`  anchors per card: mean ${(sum(perCard) / perCard.length).toFixed(2)}  p50 ${pctl(perCard, 50)}  p90 ${pctl(perCard, 90)}  max ${Math.max(...perCard)}`);
  for (let n = 0; n <= Math.max(...perCard); n++) {
    const c = perCard.filter((x) => x === n).length;
    console.log(`    ${n} anchor${n === 1 ? "" : "s"}: ${c} cards (${((c / built) * 100).toFixed(1)}%)`);
  }
  console.log(`\n  BY SOURCE:`);
  for (const [k, v] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(16)} ${v}`);
  console.log(`\n  BY FAMILY:`);
  for (const [k, v] of byFamily) {
    console.log(`    ${k.padEnd(20)} ${v.cards} cards, ${v.anchors} anchors, ${v.none} with none (${((v.none / v.cards) * 100).toFixed(0)}%)`);
  }
  console.log(`\n  TOP ANCHORED METRICS:`);
  for (const [k, v] of [...byMetric.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${k.padEnd(44)} ${v} (${((v / built) * 100).toFixed(1)}% of cards)`);
  }
  console.log(`\n  PEERS: ${peerCards} cards (${((peerCards / built) * 100).toFixed(1)}%), ${peerComparisons} comparisons, ${(peerComparisons / Math.max(1, peerCards)).toFixed(2)} per card that has any`);
  console.log(`  DRIVER: dominant ${driverDominant}, offset ${driverOffset}, none ${driverNone}`);
  console.log(`  STORY GROUPS present: ${[...groupCounts.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`  FACT TEXT chars: p50 ${pctl(factChars, 50)}  p90 ${pctl(factChars, 90)}  max ${Math.max(...factChars)}`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
