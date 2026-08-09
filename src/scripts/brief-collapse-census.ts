// WHICH FIVE METRICS SURVIVE THE COLLAPSE, per stored card — the frontend's rank, evaluated here.
// Read-only: no AI call, no write.
//
//   npx tsx src/scripts/brief-collapse-census.ts
//
// ── ★ WHY THIS RUNS IN THE BACKEND ──────────────────────────────────────────────────────────────
// The rank lives in `QuarterBriefCard.tsx` and is built from the four fields `BriefLine` carries — it
// cannot see a metric key or a family. THIS repo can: it knows `TOP_LINE_KEY` and the gloss labels.
// So the question "does the rank ever bury the top line or net profit" is answerable here and
// nowhere else, and it is the question 2a's third tier exists to answer.
//
// ⚠ IT MIRRORS THE FRONTEND RULE AND DOES NOT IMPORT IT — two repos, no shared package. The mirror
// is three lines and is stated here so a diff against the card is a reading exercise. If the two ever
// disagree, this census is the one that is wrong: the card is what a reader meets.

import { prisma } from "../db/prisma.js";
import { metricGloss } from "../catalogue/quarter-metrics.js";
import { TOP_LINE_KEY, type Family } from "../insight/quarter-brief/manifest.js";
import type { BriefPayload } from "../insight/quarter-brief/schema.js";

/** ── THE MIRROR of QuarterBriefCard.tsx's rank. Keep in step. ── */
const HELD_COMPARISON = ["steady at ", "little changed", "unchanged", "nil, as in"];
const hasMoved = (l: { comparison?: string }): boolean =>
  Boolean(l.comparison) && !HELD_COMPARISON.some((t) => l.comparison!.toLowerCase().includes(t));
// ★ THE DEFINING TIER IS FIRST. Built here from TOP_LINE_KEY + the gloss catalogue, which is exactly
// what the generator emits to the frontend as ALWAYS_SHOWN_LABELS — same join, same two sources.
const ALWAYS = new Set<string>([
  metricGloss("netProfit").label,
  ...(["non_financial", "banking", "nbfc", "life_insurance", "general_insurance"] as Family[]).map(
    (f) => metricGloss(TOP_LINE_KEY[f]).label,
  ),
]);
const rankOf = (l: { label: string; comparison?: string; anchor?: string }): number =>
  ALWAYS.has(l.label) ? 0 : l.anchor ? 1 : hasMoved(l) ? 2 : 3;
const COLLAPSED_ROWS = 5;

const TIER = ["defining", "anchored", "moved   ", "held    "];

const firstFive = (lines: BriefPayload["quarter"]["lines"]) =>
  lines
    .map((l, i) => ({ l, i, rank: rankOf(l) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, COLLAPSED_ROWS)
    .sort((a, b) => a.i - b.i);

async function main(): Promise<void> {
  const rows = await prisma.quarterBrief.findMany({
    select: {
      content: true, fiscalYear: true, quarter: true,
      stock: { select: { symbol: true, industryType: true } },
    },
  });

  let cards = 0;
  let topLineBuried = 0;
  let netProfitBuried = 0;

  for (const r of rows) {
    let p: BriefPayload;
    try { p = JSON.parse(r.content) as BriefPayload; } catch { continue; }
    if (!p.quarter?.lines?.length) continue;
    cards++;

    const family = r.stock.industryType as Family;
    const topLabel = metricGloss(TOP_LINE_KEY[family]).label;
    const kept = firstFive(p.quarter.lines);
    const keptLabels = new Set(kept.map((k) => k.l.label));
    const topShown = keptLabels.has(topLabel);
    const npShown = keptLabels.has("Net profit");
    if (!topShown) topLineBuried++;
    if (!npShown) netProfitBuried++;

    console.log(`\n${r.stock.symbol} ${r.fiscalYear}${r.quarter} — ${p.quarter.lines.length} quarter metrics, showing ${kept.length}`);
    for (const k of kept) {
      const tier = TIER[k.rank];
      const star = k.l.label === topLabel ? " ★top line" : k.l.label === "Net profit" ? " ★net profit" : "";
      console.log(`   ${String(k.i + 1).padStart(2)}. [${tier}] ${k.l.label}${star}`);
    }
    if (!topShown) console.log(`   ⚠ TOP LINE "${topLabel}" IS BEHIND THE COLLAPSE`);
    if (!npShown) console.log(`   ⚠ NET PROFIT IS BEHIND THE COLLAPSE`);

    if (p.annual?.lines?.length) {
      const a = firstFive(p.annual.lines);
      console.log(`   full year — ${p.annual.lines.length} metrics, showing ${a.length}:`);
      for (const k of a) {
        const tier = TIER[k.rank];
        console.log(`      ${String(k.i + 1).padStart(2)}. [${tier}] ${k.l.label}`);
      }
    }
  }

  console.log("\n" + "═".repeat(100));
  console.log(`${cards} cards · top line behind the collapse on ${topLineBuried} · net profit behind it on ${netProfitBuried}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
