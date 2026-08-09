// Dump the STORED payload of the 12-card review set, verbatim — the card as the reader meets it.
// Read-only: no AI call, no write. Used to compare a rendering before and after a change.
//
//   npx tsx src/scripts/brief-review-dump.ts

import { prisma } from "../db/prisma.js";
import type { BriefPayload } from "../insight/quarter-brief/schema.js";

const SET: [string, string][] = [
  ["RELIANCE", "FY27Q1"], ["HDFCBANK", "FY27Q1"], ["BAJFINANCE", "FY27Q1"], ["HDFCLIFE", "FY27Q1"],
  ["ICICIGI", "FY27Q1"], ["TCS", "FY26Q4"], ["MMTC", "FY26Q1"], ["HINDUNILVR", "FY27Q1"],
  ["ITC", "FY27Q1"], ["SBILIFE", "FY26Q4"], ["MARUTI", "FY26Q4"], ["TTML", "FY27Q1"],
];

async function main(): Promise<void> {
  let prompt = 0, output = 0, cards = 0;
  for (const [symbol, period] of SET) {
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true } });
    if (!stock) { console.log(`### ${symbol} ${period} — NO STOCK`); continue; }
    const row = await prisma.quarterBrief.findFirst({
      where: { stockId: stock.id, fiscalYear: period.slice(0, 4), quarter: period.slice(4) },
      select: { content: true, verdictLabel: true, status: true, promptTokens: true, outputTokens: true, model: true, generatedAt: true },
    });
    console.log("\n" + "═".repeat(100));
    console.log(`### ${symbol} ${period}`);
    console.log("═".repeat(100));
    if (!row) { console.log("(no stored row)"); continue; }
    console.log(`status=${row.status} badge="${row.verdictLabel}" model=${row.model} tokens=${row.promptTokens}/${row.outputTokens} generated=${row.generatedAt.toISOString()}`);
    prompt += row.promptTokens ?? 0; output += row.outputTokens ?? 0; cards++;
    let p: BriefPayload;
    try { p = JSON.parse(row.content) as BriefPayload; } catch { console.log("PROSE ROW (not a payload):\n" + row.content); continue; }
    console.log(`\n-- TAKEAWAY --`);
    if (p.takeaway.verdictMeaning) console.log(`  meaning: ${p.takeaway.verdictMeaning}`);
    for (const b of p.takeaway.bullets) console.log(`  • ${b}`);
    console.log(`\n-- QUARTER (${p.quarter.lines.length} lines) --`);
    for (const l of p.quarter.lines) {
      console.log(`  ${l.label}: ${l.value}${l.comparison ? ` — ${l.comparison}` : ""}${l.note ? `\n      note: ${l.note}` : ""}`);
    }
    if (p.annual) {
      console.log(`\n-- ANNUAL ${p.annual.fiscalYear} (${p.annual.lines.length} lines, asOf ${p.annual.asOfDate}, datesAgree=${p.annual.datesAgree}) --`);
      for (const l of p.annual.lines) console.log(`  ${l.label}: ${l.value}${l.comparison ? ` — ${l.comparison}` : ""}`);
    }
    if (p.health) {
      console.log(`\n-- HEALTH (as scored ${p.health.scoredAsOf}) ${p.health.composite}/100 ${p.health.bandLabel} --`);
      for (const m of p.health.movements) console.log(`  ${m}`);
    }
    console.log(`\n-- GAPS (${p.gaps.length}) --`);
    for (const g of p.gaps) console.log(`  - ${g}`);
  }
  console.log("\n" + "═".repeat(100));
  console.log(`TOKENS over ${cards} stored cards: prompt ${prompt} (mean ${Math.round(prompt / cards)}), output ${output} (mean ${Math.round(output / cards)})`);

  // ── THE PER-CARD CENSUS — which card should show what, so an operator opening one knows. ────────
  //
  // ⚠ NO INSURER CAN EVER CARRY PEER CONTEXT. All 23 peer groups are non-financial, banking or NBFC;
  // zero life or general insurers are in one. So an absent peer line on HDFCLIFE, SBILIFE or ICICIGI
  // is structural, not a gap in coverage — and the card says so in its own gaps list rather than
  // leaving a reader to wonder.
  console.log("\n" + "═".repeat(100));
  console.log("PER-CARD CENSUS — anchors are the clauses under a figure; peers reach the reader via the takeaway");
  console.log("═".repeat(100));
  console.log("  card".padEnd(24) + "family".padEnd(20) + "anchors".padEnd(10) + "peer-anchored".padEnd(16) + "annual  health");
  for (const [symbol, period] of SET) {
    const stock = await prisma.stock.findUnique({ where: { symbol }, select: { id: true, industryType: true } });
    if (!stock) continue;
    const row = await prisma.quarterBrief.findFirst({
      where: { stockId: stock.id, fiscalYear: period.slice(0, 4), quarter: period.slice(4) },
      select: { content: true },
    });
    if (!row) continue;
    let p: BriefPayload;
    try { p = JSON.parse(row.content) as BriefPayload; } catch { continue; }
    const anchored = p.quarter.lines.filter((l) => l.anchor);
    const peerish = anchored.filter((l) => /peer group/.test(l.anchor ?? ""));
    console.log(
      `  ${`${symbol} ${period}`.padEnd(22)}${String(stock.industryType).padEnd(20)}` +
      `${String(anchored.length).padEnd(10)}${String(peerish.length).padEnd(16)}` +
      `${(p.annual ? String(p.annual.lines.length) : "-").padEnd(8)}${p.health ? p.health.composite + " " + p.health.bandLabel : "-"}`,
    );
    for (const l of anchored) console.log(`      ${l.label}: ${l.anchor}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
