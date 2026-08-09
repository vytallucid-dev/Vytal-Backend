// THE CARD'S RENDERED HEIGHT AT A PHONE WIDTH, per section, from the STORED payload.
// Read-only: no AI call, no write.
//
//   npx tsx src/scripts/brief-mobile-height.ts                 (the 12-card review set + the annual set)
//   npx tsx src/scripts/brief-mobile-height.ts TMPV:FY26Q4     (one card)
//   npx tsx src/scripts/brief-mobile-height.ts --width 360
//
// ── ★ WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
// "What does this look like at 320px" has been asked of this card at every stage, and the answer has
// been an estimate each time. An estimate is fine until a change is judged against it — a bullet cap
// raised from 5 to 8 either does or does not push the takeaway past a phone screen, and that is an
// arithmetic question with one answer.
//
// ── ⚠⚠ WHAT THIS IS NOT ─────────────────────────────────────────────────────────────────────────
// It is NOT a renderer and it cannot be one: this repo has no DOM, no fonts and no browser. It is a
// TEXT-METRIC MODEL, and the two numbers it rests on are stated here rather than buried:
//
//   · AVG_ADVANCE_EM  the mean glyph advance of English prose in Inter, as a fraction of the font
//                     size. 0.508 — derived from the ordinary typographic rule that a 65-character
//                     measure is ~33em. Real text varies ±8% with digit and capital density, and this
//                     card is unusually digit-heavy, so treat every figure below as ±10%.
//   · RAGGED          the share of a line lost to word wrapping (a line breaks at a word boundary,
//                     not at the character that happens to fit). 0.94 is the usual working figure.
//
// The CSS CONSTANTS mirror QuarterBriefCard.tsx and are the second thing that can go stale. They are
// listed together below with the class each one comes from, so a diff against that file is a reading
// exercise rather than an archaeology one. ⚠ THIS IS A DUPLICATION AND IT IS DELIBERATE: the
// alternative is a cross-repo gate, and a gate that fails the build because a padding changed would
// be enforcing a measurement tool's assumptions as if they were a contract.

import { prisma } from "../db/prisma.js";
import type { BriefPayload } from "../insight/quarter-brief/schema.js";

// ── The text-metric model ──────────────────────────────────────────────────────────────────────────
const AVG_ADVANCE_EM = 0.508;
const RAGGED = 0.94;

/** How many lines `text` takes in `width` px at `fontPx`. Never fewer than one — an empty string
 *  still occupies a line box wherever it is rendered at all. */
function lines(text: string, width: number, fontPx: number): number {
  const perLine = Math.max(1, Math.floor((width / (fontPx * AVG_ADVANCE_EM)) * RAGGED));
  return Math.max(1, Math.ceil(text.length / perLine));
}

// ── The CSS constants, each named with the class it comes from ─────────────────────────────────────
const PAGE_PX = 8;            // app/(main)/results/[ticker]/page.tsx  ·  px-2 at mobile
const PANEL_PX = 12;          // components/stock-detail/health/shared.tsx  ·  Panel p-3 at mobile
const MARKER_W = 3;           // FactList  ·  w-0.75
const MARKER_GAP = 8;         // FactList  ·  gap-2
const LIST_GAP = 6;           // FactList  ·  gap-1.5
const SECTION_GAP = 20;       // QuarterBriefCard  ·  the card's own gap-5 BETWEEN sections
const HEAD_GAP = 10;          // QuarterBriefCard  ·  gap-2.5 inside a section (was gap-1 / gap-2)
const HEAD_H = 14;            // SectionHead  ·  the h-3.5 accent bar sets the row height
const RULE_PT = 17;           // border-t border-line pt-4  ·  1px rule + 16px padding
const LEADING_RELAXED = 1.625;
const ROW_PY = 14;            // Line  ·  py-[7px] top and bottom on a metric row

const SIZE = { lead: 13, sm: 12.5, xs: 11.5, meaning: 12.5, metric: 12.5, anchor: 11 } as const;

// ── The metric-section collapse (item 2), mirroring QuarterBriefCard's rank ────────────────────────
const COLLAPSED_ROWS = 5;
const CONTROL_H = 26; // the "Show all N metrics" button: py-1 + a 11.5px line
const COLLAPSED = !process.argv.includes("--expanded");
const HELD_COMPARISON = ["steady at ", "little changed", "unchanged", "nil, as in"];
/** ⚠ The DEFINING tier is not reproduced here: this tool cannot see a family either, and the five it
 *  picks are the same COUNT whichever five they are, which is all a height needs. */
const keepFive = <T extends { comparison?: string; anchor?: string }>(all: T[]): T[] =>
  all
    .map((l, i) => ({ l, i, rank: l.anchor ? 0 : l.comparison && !HELD_COMPARISON.some((t) => l.comparison!.toLowerCase().includes(t)) ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, COLLAPSED_ROWS)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.l);

const listHeight = (items: string[], width: number, fontPx: number): number => {
  if (items.length === 0) return 0;
  const textW = width - MARKER_W - MARKER_GAP;
  const n = items.reduce((sum, t) => sum + lines(t, textW, fontPx), 0);
  return n * fontPx * LEADING_RELAXED + (items.length - 1) * LIST_GAP;
};

interface SectionHeight { name: string; px: number }

function cardHeights(p: BriefPayload, viewport: number): { sections: SectionHeight[]; total: number } {
  const width = viewport - 2 * PAGE_PX - 2 * PANEL_PX;
  const out: SectionHeight[] = [];

  // THE TAKEAWAY — heading, the verdict meaning, then the bullets.
  let takeaway = HEAD_H + HEAD_GAP + listHeight(p.takeaway.bullets, width, SIZE.lead);
  if (p.takeaway.verdictMeaning) {
    takeaway += HEAD_GAP + lines(p.takeaway.verdictMeaning, width, SIZE.meaning) * SIZE.meaning * LEADING_RELAXED;
  }
  out.push({ name: `takeaway (${p.takeaway.bullets.length} bullets)`, px: takeaway });

  // ⚠ A METRIC ROW IS TWO STACKED BLOCKS AT THIS WIDTH, NOT A TABLE ROW. The card's `Line` is
  // flex-col until sm:, so label, value+comparison and the anchor each take their own line box.
  const metricBlock = (name: string, all: { label: string; value: string; comparison?: string; note?: string; anchor?: string }[]) => {
    // ★ THE COLLAPSE (item 2). Mirrors QuarterBriefCard's rank so the two numbers describe the same
    // five rows; `--expanded` measures the section with the control opened.
    const ls = COLLAPSED && all.length > COLLAPSED_ROWS ? keepFive(all) : all;
    let h = HEAD_H + HEAD_GAP + (all.length > COLLAPSED_ROWS ? CONTROL_H : 0);
    for (const l of ls) {
      h += ROW_PY;
      h += lines(l.label, width, SIZE.metric) * SIZE.metric * LEADING_RELAXED;
      h += lines(`${l.value}${l.comparison ? ` ${l.comparison}` : ""}`, width, SIZE.metric) * SIZE.metric * LEADING_RELAXED;
      if (l.note) h += lines(l.note, width, SIZE.anchor) * SIZE.anchor * LEADING_RELAXED;
      if (l.anchor) h += lines(l.anchor, width - 10, SIZE.anchor) * SIZE.anchor * LEADING_RELAXED;
    }
    out.push({ name: `${name} (${ls.length}${ls.length === all.length ? "" : ` of ${all.length}`} rows)`, px: h });
  };

  metricBlock("this quarter", p.quarter.lines);
  if (p.annual) metricBlock(`the full year ${p.annual.fiscalYear}`, p.annual.lines);

  if (p.health) {
    out.push({
      name: `health (${p.health.movements.length} movements)`,
      px: HEAD_H + HEAD_GAP + 20 + HEAD_GAP + listHeight(p.health.movements, width, SIZE.xs),
    });
  }
  out.push({
    name: `gaps (${p.gaps.length})`,
    px: RULE_PT + HEAD_H + HEAD_GAP + listHeight(p.gaps, width, SIZE.xs),
  });

  const total = out.reduce((s, x) => s + x.px, 0) + (out.length - 1) * SECTION_GAP;
  return { sections: out, total };
}

const SET: [string, string][] = [
  ["RELIANCE", "FY27Q1"], ["HDFCBANK", "FY27Q1"], ["BAJFINANCE", "FY27Q1"], ["HDFCLIFE", "FY27Q1"],
  ["ICICIGI", "FY27Q1"], ["TCS", "FY26Q4"], ["MMTC", "FY26Q1"], ["HINDUNILVR", "FY27Q1"],
  ["ITC", "FY27Q1"], ["SBILIFE", "FY26Q4"], ["MARUTI", "FY26Q4"], ["TTML", "FY27Q1"],
  ["HDFCBANK", "FY26Q4"], ["BAJFINANCE", "FY26Q4"], ["IDEA", "FY26Q4"], ["TMPV", "FY26Q4"],
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wIdx = args.indexOf("--width");
  const viewport = wIdx >= 0 ? Number(args[wIdx + 1]) : 320;
  const explicit = args.filter((a) => a.includes(":")).map((a) => a.split(":") as [string, string]);
  const set = explicit.length > 0 ? explicit : SET;

  console.log(`RENDERED HEIGHT AT ${viewport}px — content width ${viewport - 2 * PAGE_PX - 2 * PANEL_PX}px`);
  console.log(`⚠ a text-metric model, ±10%. See the header.\n`);
  console.log("  card".padEnd(24) + "takeaway".padStart(10) + "whole card".padStart(12) + "   sections");

  let worstTakeaway = { name: "", px: 0 };
  let worstCard = { name: "", px: 0 };
  for (const [symbol, period] of set) {
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true } });
    if (!stock) continue;
    const row = await prisma.quarterBrief.findFirst({
      where: { stockId: stock.id, fiscalYear: period.slice(0, 4), quarter: period.slice(4) },
      select: { content: true },
    });
    if (!row) continue;
    let p: BriefPayload;
    try { p = JSON.parse(row.content) as BriefPayload; } catch { continue; }

    const { sections, total } = cardHeights(p, viewport);
    const takeaway = sections[0];
    const label = `${symbol} ${period}`;
    console.log(
      `  ${label.padEnd(22)}${`${Math.round(takeaway.px)}px`.padStart(10)}${`${Math.round(total)}px`.padStart(12)}   ` +
      sections.map((s) => `${s.name} ${Math.round(s.px)}`).join(" · "),
    );
    if (takeaway.px > worstTakeaway.px) worstTakeaway = { name: label, px: takeaway.px };
    if (total > worstCard.px) worstCard = { name: label, px: total };
  }

  console.log(`\n  WORST takeaway: ${worstTakeaway.name} at ${Math.round(worstTakeaway.px)}px`);
  console.log(`  WORST card:     ${worstCard.name} at ${Math.round(worstCard.px)}px`);
  // 568px is the shortest viewport still in real use (iPhone SE, 320×568) and is the bar that
  // matters: above it, the reader scrolls before the first metric row appears.
  console.log(`  A 320×568 screen is ${Math.round((worstTakeaway.px / 568) * 100)}% filled by the longest takeaway alone.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
