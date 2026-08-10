// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// COMPARISON-BASE CENSUS — HOW MANY BASES DOES ONE CARD ACTUALLY USE, AND WHERE DO THEY DISAGREE?
//
// The card's PROSE has one base: `comparison = yearAgo ?? prevQ` (fact-block.ts:770). Every metric
// line, every contrast and the driver are measured against it, and every movement string names it
// ("against the same quarter last year").
//
// The VERDICT's four axes do not all share it:
//
//   toplineDirection  revenue.yoy ?? revenue.qoq     — same preference as the prose
//   profitDirection   profit.yoy  ?? profit.qoq      — same preference as the prose
//   marginDirection   margins window ENDPOINTS       — oldest→newest over MARGIN_WINDOW=4 quarters
//   gnpaRising        prevQ ONLY                     — QoQ, even when the prose is YoY
//
// This script measures the disagreements rather than arguing about them. Three questions:
//
//   A · MARGIN. The window's oldest quarter is normally the one THREE BACK, not the year-ago one. Does
//       the window direction agree with a straight year-on-year margin move, and — the sharper
//       question — does the VERDICT COPY claim a base it did not use? ("kept more of each rupee of
//       sales than it did A YEAR AGO" is a year-ago claim on a window-derived direction.)
//   B · GNPA. Banking only. Does gnpaRising differ between the prevQ base it uses and the `comparison`
//       base the rest of the card uses, and does the VERDICT KEY change when it does?
//   C · SPLIT FALLBACK. A year-ago ROW can exist while its VALUE is null, so the prose stays YoY while
//       the verdict silently falls back to QoQ for that line. How often?
//
// Plus the shape question that has nothing to do with bases: how thin does a card actually get —
// how many carry one metric line, one margin series, one bullet.
//
// READS ONLY. No AI call, no write.
//   npx tsx src/scripts/brief-comparison-base-census.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { fetchFamilyQuarters, resolveFamilyBasis } from "../insight/quarter-brief/family-rows.js";
import { valueOf } from "../insight/quarter-brief/manifest.js";
import { MARGIN_FLOOR_PP, MARGIN_WINDOW } from "../insight/quarter-brief/margins.js";
import { GNPA_MATERIAL_PP } from "../insight/quarter-brief/verdict.js";
import { fractionToPct } from "../insight/quarter-brief/format.js";
import type { Family } from "../insight/quarter-brief/types.js";

const priorFy = (fy: string): string => `FY${String(Number(fy.slice(2)) - 1).padStart(2, "0")}`;

type Dir = "rising" | "falling" | "little changed";
const dirOf = (delta: number | null): Dir | null =>
  delta === null ? null : Math.abs(delta) < MARGIN_FLOOR_PP ? "little changed" : delta > 0 ? "rising" : "falling";

interface Finding {
  symbol: string; family: string; period: string; verdict: string | null;
  marginWindowDir: Dir | null; marginYoyDir: Dir | null; marginBaseOldest: string | null;
  windowIsYearAgo: boolean;
  gnpaPrevQ: boolean | null; gnpaComparison: boolean | null;
  splitTopline: boolean; splitProfit: boolean;
  lines: number; series: number;
}

async function main(): Promise<void> {
  const stocks = await prisma.stock.findMany({ select: { id: true, symbol: true, industryType: true }, orderBy: { symbol: "asc" } });
  const out: Finding[] = [];
  let n = 0;

  for (const s of stocks) {
    const family = s.industryType as Family;
    const basis = await resolveFamilyBasis(family, s.id);
    if (!basis) { n++; continue; }
    const rows = await fetchFamilyQuarters(family, s.id, basis);
    if (rows.length === 0) { n++; continue; }
    const block = await buildQuarterBriefFactBlock(s.symbol);
    if (!block) { n++; continue; }

    const idx = rows.length - 1;
    const current = rows[idx];
    const prevQ = idx > 0 ? rows[idx - 1] : null;
    const yearAgo = rows.find((r) => r.quarter === current.quarter && r.fiscalYear === priorFy(current.fiscalYear)) ?? null;
    const comparison = yearAgo ?? prevQ;

    // ── A · MARGIN BASE ─────────────────────────────────────────────────────────────────────────────
    const key = family === "non_financial" ? "operatingMargin" : "netMargin";
    const wantedLabel = family === "non_financial" ? "Operating margin" : "Net margin";
    const windowRows = rows.slice(Math.max(0, idx - (MARGIN_WINDOW - 1)), idx + 1);
    const marginWindowDir = (block.margins?.series.find((x) => x.label === wantedLabel)?.direction ?? null) as Dir | null;
    const curM = valueOf(current, key);
    const yaM = yearAgo ? valueOf(yearAgo, key) : null;
    // The stored margins are fractions on some families; the series renders percent. Compare in the
    // SAME unit the series uses by running both through fractionToPct only when |v| <= 1.
    const asPct = (v: number | null): number | null => (v === null ? null : Math.abs(v) <= 1 ? fractionToPct(v) : v);
    const marginYoyDir = dirOf(asPct(curM) !== null && asPct(yaM) !== null ? asPct(curM)! - asPct(yaM)! : null);
    const oldest = windowRows[0]?.periodKey ?? null;
    const windowIsYearAgo = yearAgo !== null && oldest === yearAgo.periodKey;

    // ── B · GNPA BASE ───────────────────────────────────────────────────────────────────────────────
    const gnpaAt = (r: typeof current | null): boolean | null => {
      if (family !== "banking" || !r) return null;
      const c = valueOf(current, "grossNpaRatio");
      const p = valueOf(r, "grossNpaRatio");
      if (c === null || p === null) return null;
      return fractionToPct(c) - fractionToPct(p) >= GNPA_MATERIAL_PP;
    };

    // ── C · SPLIT FALLBACK ──────────────────────────────────────────────────────────────────────────
    // A year-ago ROW exists (so the prose is YoY) but the yoy CHANGE is null (so the verdict uses qoq).
    const splitTopline = yearAgo !== null && block.headline.revenue.yoy === null && block.headline.revenue.qoq !== null;
    const splitProfit = yearAgo !== null && block.headline.profit.yoy === null && block.headline.profit.qoq !== null;

    out.push({
      symbol: s.symbol, family, period: current.periodKey,
      verdict: block.verdict?.key ?? null,
      marginWindowDir, marginYoyDir, marginBaseOldest: oldest, windowIsYearAgo,
      gnpaPrevQ: gnpaAt(prevQ), gnpaComparison: gnpaAt(comparison),
      splitTopline, splitProfit,
      lines: block.quarter.lines.length,
      series: block.margins?.series.length ?? 0,
    });

    if (++n % 100 === 0) process.stderr.write(`    …${n}/${stocks.length}\n`);
  }

  const rule = (s: string) => console.log("\n" + "═".repeat(104) + "\n" + s + "\n" + "═".repeat(104));

  // ── A ───────────────────────────────────────────────────────────────────────────────────────────
  rule("A · MARGIN — the verdict's margin axis vs a straight year-on-year margin move");
  const withBoth = out.filter((r) => r.marginWindowDir !== null && r.marginYoyDir !== null);
  const disagree = withBoth.filter((r) => r.marginWindowDir !== r.marginYoyDir);
  console.log(`  cards with a margin direction AND a year-ago margin : ${withBoth.length}`);
  console.log(`  window oldest quarter IS the year-ago quarter       : ${withBoth.filter((r) => r.windowIsYearAgo).length}`);
  console.log(`  ⇒ window oldest is some OTHER quarter              : ${withBoth.filter((r) => !r.windowIsYearAgo).length}`);
  console.log(`  ★ DISAGREE (window direction ≠ year-on-year)        : ${disagree.length}`);
  const badgeClaimsYear = disagree.filter((r) => r.verdict === "grew_margins_wider" || r.verdict === "grew_margins_thinner");
  console.log(`  …of those, the BADGE is a margin badge whose copy`);
  console.log(`     says "than it did a year ago"                    : ${badgeClaimsYear.length}`);
  for (const r of disagree.slice(0, 25)) {
    console.log(
      `      ${r.symbol.padEnd(13)} ${r.period}  ${(r.verdict ?? "(none)").padEnd(22)} ` +
        `window(${r.marginBaseOldest}→${r.period})=${r.marginWindowDir!.padEnd(15)} yoy=${r.marginYoyDir}`,
    );
  }
  if (disagree.length > 25) console.log(`      …(+${disagree.length - 25} more)`);

  // ── B ───────────────────────────────────────────────────────────────────────────────────────────
  rule("B · GNPA — the verdict's bad-loan axis uses prevQ; the rest of the card uses `comparison`");
  const banks = out.filter((r) => r.family === "banking");
  const gnpaBoth = banks.filter((r) => r.gnpaPrevQ !== null && r.gnpaComparison !== null);
  const gnpaDiff = gnpaBoth.filter((r) => r.gnpaPrevQ !== r.gnpaComparison);
  console.log(`  banking cards                                       : ${banks.length}`);
  console.log(`  with a computable bad-loan direction on BOTH bases  : ${gnpaBoth.length}`);
  console.log(`  ★ DISAGREE (prevQ base ≠ comparison base)           : ${gnpaDiff.length}`);
  for (const r of gnpaDiff) {
    console.log(`      ${r.symbol.padEnd(13)} ${r.period}  ${(r.verdict ?? "(none)").padEnd(22)} prevQ=${r.gnpaPrevQ} comparison=${r.gnpaComparison}`);
  }

  // ── C ───────────────────────────────────────────────────────────────────────────────────────────
  rule("C · SPLIT FALLBACK — year-ago ROW present (prose is YoY) but the yoy CHANGE is null");
  const split = out.filter((r) => r.splitTopline || r.splitProfit);
  console.log(`  ★ cards where the verdict silently falls to QoQ     : ${split.length}`);
  for (const r of split.slice(0, 20)) {
    console.log(`      ${r.symbol.padEnd(13)} ${r.period}  topline=${r.splitTopline} profit=${r.splitProfit}  verdict=${r.verdict ?? "(none)"}`);
  }

  // ── D · THE THIN SHAPES ─────────────────────────────────────────────────────────────────────────
  rule("D · HOW THIN DOES A CARD GET — metric lines and margin series");
  const lineDist = new Map<number, number>();
  for (const r of out) lineDist.set(r.lines, (lineDist.get(r.lines) ?? 0) + 1);
  const lineKeys = [...lineDist.keys()].sort((a, b) => a - b);
  console.log(`  metric lines per card: min=${lineKeys[0]} max=${lineKeys[lineKeys.length - 1]}`);
  for (const k of lineKeys.slice(0, 10)) console.log(`      ${String(k).padStart(3)} line(s): ${lineDist.get(k)}  ${out.filter((r) => r.lines === k).slice(0, 8).map((r) => r.symbol).join(", ")}`);
  console.log(`  cards with EXACTLY ONE metric line                  : ${out.filter((r) => r.lines === 1).length}`);
  const seriesDist = new Map<number, number>();
  for (const r of out) seriesDist.set(r.series, (seriesDist.get(r.series) ?? 0) + 1);
  console.log(`  margin series per card:`);
  for (const k of [...seriesDist.keys()].sort((a, b) => a - b)) {
    console.log(`      ${k} series: ${seriesDist.get(k)}   ${k === 1 ? `e.g. ${out.filter((r) => r.series === 1).slice(0, 6).map((r) => r.symbol).join(", ")}` : ""}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
