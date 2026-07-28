// RELATIONAL LIVE CENSUS — the standing card-level regression check.
//
// Resolves the REAL card (resolveRelationalState) for every real (reader, held stock) pair in the
// database, plus an anonymous resolve for every distinct stock those readers hold. This is the one
// check the synthetic fixture matrix (verify-relational-matrix.ts) cannot do: fixtures assert the
// LOGIC is correct against constructed inputs, but every falsehood found during the Relational
// Overview build was found by rendering a REAL card, never by a passing synthetic test — the register
// guard's own false-positive against "selling electricity" / "diversified conglomerate" (business-lead
// copy on NTPC/ITC/HUL) surfaced only here, on live data, not in any fixture.
//
// composeRelationalState() already runs scanAssembled + scanStrength internally and console.warn's on
// any hit (service.ts) — this script captures those warnings across the resolved population, since
// that is the only violation signal the code emits at runtime (it logs rather than blanks the card).
//
//   npx tsx src/scripts/verify-relational-live-census.ts

import { prisma } from "../db/prisma.js";
import { resolveRelationalState } from "../relational/service.js";

async function main() {
  const holdings = await prisma.$queryRaw<{ user_id: string; stock_id: string }[]>`
    SELECT DISTINCT user_id, stock_id FROM holdings WHERE quantity > 0 AND stock_id IS NOT NULL`;

  let violations = 0;
  const captured: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => { violations++; captured.push(args.map(String).join(" ")); };

  let resolved = 0;
  for (const h of holdings) {
    await resolveRelationalState(h.user_id, h.stock_id);
    resolved++;
  }
  const stockIds = [...new Set(holdings.map((h) => h.stock_id))];
  for (const stockId of stockIds) {
    await resolveRelationalState(null, stockId);
    resolved++;
  }

  console.warn = origWarn;
  console.log(`RESOLVED=${resolved}`);
  console.log(`READER_STOCK_PAIRS=${holdings.length}`);
  console.log(`DISTINCT_STOCKS=${stockIds.length}`);
  console.log(`REGISTER_GUARD_VIOLATIONS=${violations}`);
  if (violations > 0) console.log("DETAIL:\n" + captured.join("\n"));
  console.log(`\n${"═".repeat(60)}\nLIVE CENSUS — ${violations === 0 ? "0 violations, clean" : `${violations} violation(s)`}\n${"═".repeat(60)}`);
  await prisma.$disconnect();
  process.exit(violations === 0 ? 0 : 1);
}
main();
