// Dump the Quarter in Brief FACT BLOCK for one or more symbols, verbatim.
//
// This is the Stage-1 inspection tool: it prints exactly what the model will be handed, and nothing
// else. No prose is generated here and no AI call is made.
//
//   npx tsx src/scripts/dump-quarter-brief-facts.ts DIXON HDFCBANK BAJFINANCE
//   npx tsx src/scripts/dump-quarter-brief-facts.ts DIXON:FY27Q1
//
// A trailing ":PERIOD" pins a specific quarter; otherwise the newest quarter on file is used.

import { prisma } from "../db/prisma.js";
import { buildQuarterBriefFactBlock } from "../insight/quarter-brief/fact-block.js";

const DEFAULTS = ["DIXON", "HDFCBANK", "BAJFINANCE"];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targets = args.length > 0 ? args : DEFAULTS;

  for (const target of targets) {
    const [symbol, period] = target.split(":");
    const block = await buildQuarterBriefFactBlock(symbol, period || undefined);

    console.log("\n" + "═".repeat(100));
    console.log(`FACT BLOCK — ${symbol}${period ? ` @ ${period}` : " (newest quarter on file)"}`);
    console.log("═".repeat(100));

    if (!block) {
      console.log("null — unknown symbol, no quarterly rows, or that period is not on file.");
      continue;
    }
    console.log(JSON.stringify(block, null, 2));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await prisma.$disconnect();
  process.exit(1);
});
