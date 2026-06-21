// File: src/scripts/pond-heat-validate.ts
//
// READ-ONLY validation of the PG-level pond-heat signal (no writes, no migration). Loads every
// peer group's members, computes each member's cleaned ~21d trailing return (getCleanedCloses —
// the price chokepoint), aggregates to the PG-level median, and prints the heat across all PGs so
// the hot/warm/calm cuts can be calibrated from the real distribution. Run:
//   npx tsx src/scripts/pond-heat-validate.ts

import { prisma } from "../db/prisma.js";
import { getCleanedCloses } from "../scoring/price/load.js";
import {
  computePondHeat,
  memberTrailingReturnPct,
  heatOf,
  POND_HEAT_WINDOW_DAYS,
  POND_HEAT_WARM_PCT,
  POND_HEAT_HOT_PCT,
  type MaskHeat,
} from "../scoring/findings/section2/pond-heat.js";

type MemberRow = { symbol: string; ret: number | null; quarantined: boolean; closes: number };

async function main() {
  const pgs = await prisma.peerGroup.findMany({
    include: { stocks: { include: { stock: { select: { id: true, symbol: true } } } } },
    orderBy: { name: "asc" },
  });

  const rows: { pg: string; heat: MaskHeat | null; move: number | null; n: number; members: MemberRow[] }[] = [];

  for (const pg of pgs) {
    const members: MemberRow[] = [];
    for (const sp of pg.stocks) {
      const { id, symbol } = sp.stock;
      try {
        const { closes, report } = await getCleanedCloses(id, symbol); // no cutoff → current ("right now")
        const closeVals = closes.map((c) => c.close);
        // Drop a member whose series is quarantined (structural break in view) — don't poison the pond.
        const ret = report.quarantined ? null : memberTrailingReturnPct(closeVals);
        members.push({ symbol, ret, quarantined: report.quarantined, closes: closeVals.length });
      } catch {
        members.push({ symbol, ret: null, quarantined: false, closes: 0 });
      }
    }
    const heat = computePondHeat(members.map((m) => m.ret));
    rows.push({ pg: pg.name, heat: heat.heat, move: heat.trailingMovePct, n: heat.memberCount, members });
  }

  // Only PGs with an established pond (a member quorum) are the "scored" ones.
  const established = rows.filter((r) => r.heat !== null);
  established.sort((a, b) => Math.abs(b.move ?? 0) - Math.abs(a.move ?? 0));

  console.log(`\n══════════ POND HEAT · ${POND_HEAT_WINDOW_DAYS}d trailing move · ${established.length} established PGs ══════════`);
  console.log(`cuts (provisional): calm < ${POND_HEAT_WARM_PCT}%  ·  warm ${POND_HEAT_WARM_PCT}–${POND_HEAT_HOT_PCT}%  ·  hot ≥ ${POND_HEAT_HOT_PCT}%   (on |pond median move|)\n`);
  for (const r of established) {
    const tag = (r.heat ?? "—").toUpperCase().padEnd(5);
    const mv = (r.move ?? 0) >= 0 ? `+${r.move!.toFixed(1)}` : r.move!.toFixed(1);
    const contrib = r.members.filter((m) => m.ret !== null).map((m) => `${m.symbol} ${m.ret! >= 0 ? "+" : ""}${m.ret!.toFixed(1)}%`).join(", ");
    const dropped = r.members.filter((m) => m.ret === null).map((m) => `${m.symbol}${m.quarantined ? "⚠quar" : ""}`);
    console.log(`  ${tag} | ${mv.padStart(6)}%  (n=${r.n})  ${r.pg}`);
    console.log(`        ${contrib}`);
    if (dropped.length) console.log(`        dropped: ${dropped.join(", ")}`);
  }

  const notEstablished = rows.filter((r) => r.heat === null);
  if (notEstablished.length) {
    console.log(`\n  not established (no member quorum): ${notEstablished.map((r) => `${r.pg}(n=${r.n})`).join(", ")}`);
  }

  // Distribution to calibrate the cuts.
  const moves = established.map((r) => Math.abs(r.move ?? 0)).sort((a, b) => a - b);
  const pctl = (p: number) => moves[Math.min(moves.length - 1, Math.floor(p * moves.length))];
  console.log(`\n  |move| distribution across ${moves.length} PGs:  min ${moves[0]?.toFixed(1)}  p25 ${pctl(0.25)?.toFixed(1)}  median ${pctl(0.5)?.toFixed(1)}  p75 ${pctl(0.75)?.toFixed(1)}  max ${moves[moves.length - 1]?.toFixed(1)}`);
  const counts = { calm: 0, warm: 0, hot: 0 };
  for (const m of moves) counts[heatOf(m)]++;
  console.log(`  at provisional cuts → calm ${counts.calm} · warm ${counts.warm} · hot ${counts.hot}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
