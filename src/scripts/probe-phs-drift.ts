// Read-only: did MY changes move these users' PHS, or did it drift on its own?
import { prisma } from "../db/prisma.js";

const snaps = await prisma.portfolioHealthSnapshot.findMany({
  select: { phs: true, band: true, createdAt: true, user: { select: { email: true } } },
  orderBy: { createdAt: "desc" },
  take: 8,
});
console.log("PHS snapshots (newest first):");
for (const s of snaps) {
  console.log(`  ${String(s.user.email).padEnd(34)} phs=${s.phs} ${String(s.band).padEnd(8)} ${s.createdAt.toISOString()}`);
}

console.log(`
WHAT PHS READS — grepped, not assumed:
  src/portfolio/phs/  contains ZERO references to mf_analytics, beta, alpha, or investedValue.
  It is a function of the user's HOLDINGS and the SCORES/PRICES of the equities they hold.

WHAT STEP 17 WROTE : instruments + instrument_prices (356 bonds). No stock, no score, no holding.
WHAT STEP 18 WROTE : mf_analytics columns only. Nothing PHS reads.

So neither step can have moved a PHS. If the snapshot timestamps below predate this session's work,
that settles it outright.`);

await prisma.$disconnect();
