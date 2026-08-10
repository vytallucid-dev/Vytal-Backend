// STAGE 4 — THE DEGENERATE HUNT, BY RENDERING (4c) AND THE SAMPLE (4g).
//
// Renders the ANNUAL SECTION as a reader would meet it, for one or more Q4 cards. WRITES NOTHING and
// makes no AI call. #14-#17 of the seventeen known degenerate cases were all found by building a card
// and looking at it; this is the tool for the eighteenth.
//
//   npx tsx src/scripts/annual-section-render.ts DIXON:FY26Q4 HDFCBANK:FY26Q4

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { renderFactText } from "../insight/quarter-brief/prompt.js";

const DEFAULTS = ["DIXON:FY26Q4", "HDFCBANK:FY26Q4", "BAJFINANCE:FY26Q4", "HDFCLIFE:FY26Q4", "GICRE:FY26Q4"];

const wrap = (s: string, indent: string, width = 96): string => {
  const out: string[] = [];
  let line = "";
  for (const w of s.split(/\s+/)) {
    if (line.length + w.length + 1 > width) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out.map((l) => indent + l).join("\n");
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targets = args.length > 0 ? args : DEFAULTS;
  const showFacts = process.env.FACTS === "1";

  for (const target of targets) {
    const [symbol, period] = target.split(":");
    console.log("\n" + "═".repeat(100));
    console.log(`${symbol}${period ? ` @ ${period}` : ""}`);
    console.log("═".repeat(100));

    const block = await buildQuarterBriefFactBlock(symbol, period || undefined);
    if (!block) { console.log("  (no fact block — unknown symbol, no rows, or that period is not on file)"); continue; }

    const id = block.identity;
    console.log(`  ${id.name} · ${id.family} · ${id.basis} · ${id.quarter} of ${id.fiscalYear}`);
    console.log(`  quarter as at ${id.reportDate}, filed ${id.filingDate}`);
    console.log(`  quarter section: ${block.quarter.lines.length} lines, ${block.quarter.suppressed.length} suppressed, ${block.quarter.notReported.length} not reported`);

    const a = block.annual;
    if (!a) {
      console.log(`\n  ── ANNUAL SECTION: ABSENT ──`);
      console.log(`     (${id.quarter === "Q4" ? "Q4 with no annual row on this basis — the presence gate fired" : "not Q4 — the quarter gate fired"})`);
    } else {
      console.log(`\n  ── ANNUAL SECTION · full year ${a.fiscalYear} ─────────────────────────────────────────`);
      console.log(`     as at ${a.asOfDate} (filed ${a.filingDate})   dates agree with the quarter: ${a.datesAgree ? "YES" : "★ NO — the second clock is real here"}`);
      console.log(`     compared against: ${a.priorFiscalYear ?? "(no prior year on file)"}`);
      console.log(`     ${a.lines.length} lines, ${a.suppressed.length} suppressed, ${a.notReported.length} not reported\n`);
      for (const l of a.lines) {
        console.log(`     ${l.label}`);
        console.log(`       ${l.display}${l.movement ? `  —  ${l.movement}` : "   (nothing to compare against)"}${l.steady === true ? "   [steady]" : ""}${l.lowerIsBetter ? "   [lower is better]" : ""}`);
        if (l.plain) console.log(wrap(l.plain, "       > "));
        console.log(wrap(l.meaning, "         "));
        console.log(wrap(`Doesn't mean: ${l.doesntMean}`, "         "));
        console.log("");
      }
      if (a.suppressed.length) {
        console.log(`     WITHHELD:`);
        for (const s of a.suppressed) console.log(`       [${s.cause}] ${s.label} — ${s.reason}`);
        console.log("");
      }
      if (a.notReported.length) console.log(`     NOT FILED: ${a.notReported.join(", ")}\n`);
    }

    console.log(`  ── GAPS (all of them, as the reader sees them) ──`);
    for (const g of block.gaps) console.log(wrap(`- ${g}`, "     "));

    if (showFacts) {
      console.log(`\n  ── FACT TEXT HANDED TO THE MODEL ──`);
      console.log(renderFactText(block).split("\n").map((l) => `     ${l}`).join("\n"));
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
