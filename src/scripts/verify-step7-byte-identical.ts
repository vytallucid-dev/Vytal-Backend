// ─────────────────────────────────────────────────────────────────────────────
// STEP 7 BYTE-IDENTICAL GATE — the un-waivable one.
//
// Step 7 touched phs/assemble.ts (the heldNotValued partition now keys on "can we value it"
// rather than "does it have a stock_id"). Re-reading the STORED snapshot proves nothing about
// that change — the snapshot predates it. So this RECOMPUTES both real users' PHS through the
// modified assemble path, in memory, and compares against what is stored.
//
// If the partition change moved a score, this is where it shows. Read-only: it computes, it does
// not persist.
//   npx tsx src/scripts/verify-step7-byte-identical.ts
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { assemblePortfolio, listPortfolioDisclosure } from "../portfolio/phs/assemble.js";
import { computePhs } from "../portfolio/phs/engine.js";

// phs/band here are INFORMATIONAL only — the assertions compare a live recompute to the STORED
// snapshot (drift-safe: both move with the market together), never to these pinned numbers.
const EXPECTED = [
  { email: "arman.shaikh01082003@gmail.com", phs: 65, band: "Steady" },
  { email: "amankamaljain@gmail.com", phs: 50, band: "Mixed" },
];

let failures = 0;
const assert = (name: string, cond: boolean, detail: string) => {
  console.log(`  ${cond ? "✅" : "❌"} ${name} — ${detail}`);
  if (!cond) failures++;
};

console.log("═══ RECOMPUTE both real users through the MODIFIED assemble path ═══");
for (const exp of EXPECTED) {
  const u = await prisma.user.findFirstOrThrow({ where: { email: exp.email }, select: { id: true } });
  const stored = await prisma.portfolioHealthSnapshot.findFirst({
    where: { userId: u.id }, orderBy: { createdAt: "desc" },
    select: { phs: true, band: true, coverage: true, quality: true, structure: true, signals: true },
  });

  // The live recompute — through the partition that Step 7 changed.
  const asm = await assemblePortfolio(u.id);
  const fresh = computePhs(asm.holdings);
  const disc = await listPortfolioDisclosure(u.id);

  console.log(`\n  ${exp.email}`);
  console.log(`    stored : PHS=${stored?.phs} band=${stored?.band} coverage=${stored?.coverage} quality=${stored?.quality}`);
  // The engine's published integer score is `health` (computePhs's field); the SNAPSHOT column is
  // `phs`. Same number, two names — the snapshot is the persisted projection of the engine result.
  const recomputed = fresh.health;
  console.log(`    RECOMPUTED: PHS=${recomputed} band=${fresh.band} coverage=${fresh.coverage} quality=${fresh.quality}`);

  assert("RECOMPUTED PHS matches the stored score (HEALTH is byte-identical — the un-waivable)",
    recomputed === stored?.phs, `${recomputed} vs ${stored?.phs}`);
  assert("RECOMPUTED band matches", fresh.band === stored?.band, `${fresh.band} vs ${stored?.band}`);
  // (CV2 Stage 0) Coverage is NO LONGER byte-identical to the pre-CV2 fossil snapshot for a fund
  // holder: priced non-stocks now ENTER the denominator, so the scored SHARE legitimately drops
  // while HEALTH stays put (asserted above). A stocks-only book is still byte-identical.
  const funds = disc.heldNotScored.length;
  if (funds > 0) {
    assert("coverage DROPPED as heldNotScored capital entered the denominator (Health unmoved above)",
      Number(fresh.coverage) < Number(stored?.coverage),
      `${Number(fresh.coverage).toFixed(4)} < fossil ${Number(stored?.coverage).toFixed(4)} · ${funds} priced non-stock(s) now weighed`);
  } else {
    assert("RECOMPUTED coverage matches (no heldNotScored — denominator unchanged)",
      Number(fresh.coverage).toFixed(4) === Number(stored?.coverage).toFixed(4),
      `${Number(fresh.coverage).toFixed(4)} vs ${Number(stored?.coverage).toFixed(4)}`);
  }
  assert("no holding fell into heldNotValued (every position is priceable)",
    disc.heldNotValued.length === 0 && asm.holdings.length > 0,
    `holdings=${asm.holdings.length} heldNotValued=${disc.heldNotValued.length}`);
}

console.log(`\n${failures === 0 ? "✅ BYTE-IDENTICAL — a live recompute through the changed partition lands on the SAME score" : `❌ ${failures} FAILURE(S) — the assemble change MOVED a real user's score`}`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
