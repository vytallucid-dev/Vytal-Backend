// Print `renderFactText` VERBATIM for one or more (symbol[:period]) — exactly what the model is
// handed, and nothing else. No AI call, no write.
//
//   npx tsx src/scripts/brief-fact-text.ts TCS:FY26Q4 HDFCBANK:FY27Q1
//
// Use this before changing the prompt or the story groups: the question "why did the takeaway not
// mention X" is almost always answered by X not being in this text.

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";
import { renderFactText } from "../insight/quarter-brief/prompt.js";
import { buildStory } from "../insight/quarter-brief/story.js";

async function main(): Promise<void> {
  for (const target of process.argv.slice(2)) {
    const [symbol, period] = target.split(":");
    const block = await buildQuarterBriefFactBlock(symbol, period || undefined);
    console.log("\n" + "═".repeat(100));
    console.log(`FACT TEXT — ${target}`);
    console.log("═".repeat(100));
    if (!block) { console.log("null — unknown symbol, no quarterly rows, or that period is not on file."); continue; }

    const story = buildStory(block);
    console.log(
      `SHAPE: quarter=${block.quarter.lines.length} annual=${block.annual ? block.annual.lines.length : "-"} ` +
      `anchors=${block.quarter.lines.filter((l) => l.anchor).length} peers=${block.peers?.comparisons.length ?? 0} ` +
      `contrasts=${block.contrasts.length} driver=${block.driver ? block.driver.form : "-"} ` +
      `health=${block.healthMovement ? "yes" : "no"} gaps=${block.gaps.length}`,
    );
    console.log(`STORY GROUPS: ${story.map((g) => `${g.key}=${g.facts.length}`).join("  ")}  · total facts ${story.reduce((n, g) => n + g.facts.length, 0)}`);
    console.log("─".repeat(100));
    console.log(renderFactText(block));
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
