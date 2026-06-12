// File: src/scripts/backfill-v3.ts (NEW)

import {
  backfillUniverse,
  backfillSymbols,
} from "../ingestions/quaterly-results/backfill.js";
import { prisma } from "../db/prisma.js";

/**
 * Usage:
 *   tsx src/scripts/backfill-v3.ts                                  # full universe
 *   tsx src/scripts/backfill-v3.ts --industries=banking,nbfc        # subset
 *   tsx src/scripts/backfill-v3.ts --symbols=HDFCBANK,TCS,RELIANCE  # specific
 *   tsx src/scripts/backfill-v3.ts --limit=100                      # cap
 *   tsx src/scripts/backfill-v3.ts --from=2025-04-01                # custom start
 */
async function main() {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};
  for (const a of args) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) opts[m[1]] = m[2];
  }

  const fromQeDate = opts.from ? new Date(opts.from) : undefined;
  const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;
  const industries = opts.industries
    ? (opts.industries.split(",") as Array<
        | "non_financial"
        | "banking"
        | "nbfc"
        | "life_insurance"
        | "general_insurance"
      >)
    : undefined;
  const symbols = opts.symbols ? opts.symbols.split(",") : undefined;

  if (symbols) {
    await backfillSymbols(symbols, { fromQeDate });
  } else {
    await backfillUniverse({ fromQeDate, industries, limit });
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
