// File: src/scripts/pond-mask-before-after.ts
//
// STEP 3 validation — proves the proxy→real-signal swap for the §5 hot-pond mask. READ-ONLY.
// For every scored stock it computes BOTH pondHot booleans:
//   OLD (stock-level proxy) = the stock's OWN divergence is WIDE (≥25) AND Market is the high
//                             pillar (price ahead of fundamentals) — what the UI used before.
//   NEW (real PG signal)    = the stock's POND heat === "hot" (the production pond-heat module,
//                             inherited by every member) — what the UI uses now.
// and flags where they differ — the correction. Run:
//   npx tsx src/scripts/pond-mask-before-after.ts

import { prisma } from "../db/prisma.js";
import { getCleanedCloses } from "../scoring/price/load.js";
import { computePondHeat, memberTrailingReturnPct } from "../scoring/findings/section2/pond-heat.js";

const WIDE = 25; // K2 wide spread — the proxy's "price ahead of fundamentals" cutoff

type Sub = { foundation: number; momentum: number; market: number; ownership: number };
const scoredVals = (s: Sub) => Object.entries(s).filter(([, v]) => v !== 0) as [keyof Sub, number][];

/** OLD proxy: wide divergence with Market as the high pillar (stock individually price-ahead). */
function proxyHot(s: Sub): boolean {
  const vs = scoredVals(s);
  if (vs.length < 2) return false;
  const sorted = [...vs].sort((a, b) => b[1] - a[1]);
  const gap = sorted[0][1] - sorted[sorted.length - 1][1];
  return gap >= WIDE && sorted[0][0] === "market";
}

async function main() {
  const pgs = await prisma.peerGroup.findMany({
    include: { stocks: { include: { stock: { select: { id: true, symbol: true } } } } },
    orderBy: { name: "asc" },
  });

  const flips: string[] = [];
  let scoredStocks = 0;

  for (const pg of pgs) {
    // NEW signal: the production pond-heat computation over the PG's cleaned closes.
    const rets: (number | null)[] = [];
    for (const sp of pg.stocks) {
      const { id, symbol } = sp.stock;
      try {
        const { closes, report } = await getCleanedCloses(id, symbol);
        rets.push(report.quarantined ? null : memberTrailingReturnPct(closes.map((c) => c.close)));
      } catch { rets.push(null); }
    }
    const pond = computePondHeat(rets);
    const newHot = pond.heat === "hot";
    if (pond.heat === null) continue; // pond not established — not a scored pond

    for (const sp of pg.stocks) {
      const { id, symbol } = sp.stock;
      const snap = await prisma.scoreSnapshot.findFirst({
        where: { stockId: id, snapshotType: "quarterly" },
        orderBy: [{ asOfDate: "desc" }, { version: "desc" }],
        select: { foundationSubtotal: true, momentumSubtotal: true, marketSubtotal: true, ownershipSubtotal: true },
      });
      if (!snap) continue; // not scored
      scoredStocks++;
      const sub: Sub = {
        foundation: Number(snap.foundationSubtotal), momentum: Number(snap.momentumSubtotal),
        market: Number(snap.marketSubtotal), ownership: Number(snap.ownershipSubtotal),
      };
      const oldHot = proxyHot(sub);
      if (oldHot !== newHot) {
        const dir = !oldHot && newHot ? "→ NOW MASKED  (hot pond, modest own gap)" : "→ NOW UNMASKED (own gap wide, but pond not hot)";
        flips.push(
          `  ${symbol.padEnd(12)} ${dir}\n        pond ${pg.name} = ${pond.heat!.toUpperCase()} (${pond.trailingMovePct! >= 0 ? "+" : ""}${pond.trailingMovePct}%)  ·  own pillars F${sub.foundation.toFixed(0)}/M${sub.momentum.toFixed(0)}/Mkt${sub.market.toFixed(0)}/Own${sub.ownership.toFixed(0)} → proxy ${oldHot ? "WIDE price-ahead" : "not wide"}`,
        );
      }
    }
  }

  console.log(`\n══════════ POND-MASK BEFORE/AFTER · ${scoredStocks} scored stocks · ${flips.length} flips ══════════`);
  console.log(`OLD = stock's own wide price-ahead divergence (proxy)   NEW = stock's pond heat === hot (real)\n`);
  for (const f of flips) console.log(f);
  if (!flips.length) console.log("  (no flips — proxy and real signal agree on every scored stock this snapshot)");

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
