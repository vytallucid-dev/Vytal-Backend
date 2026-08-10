// Snapshot: row counts (financial tables) for the 13 flagged stocks AND the
// control group (all stocks currently industryType != non_financial, i.e.
// the "74 known financial stocks"), plus scoring/finding state for the 13.
// Run before AND after the fix, diff by eye.

import { prisma } from "../db/prisma.js";

const THIRTEEN = [
  "360ONE", "ANGELONE", "BAJAJHLDNG", "CANHLIFE", "ABSLAMC", "GODIGIT",
  "ICICIAMC", "JMFINANCIL", "NAM-INDIA", "NIVABUPA", "NUVAMA", "TATAINVEST",
  "UTIAMC",
];

async function tableCounts(stockIds: string[]) {
  const [fund, qr, bankF, bankQ, nbfcF, nbfcQ, liF, liQ, giF, giQ] = await Promise.all([
    prisma.fundamental.count({ where: { stockId: { in: stockIds } } }),
    prisma.quarterlyResult.count({ where: { stockId: { in: stockIds } } }),
    prisma.bankingFundamental.count({ where: { stockId: { in: stockIds } } }),
    prisma.bankingQuarterlyResult.count({ where: { stockId: { in: stockIds } } }),
    prisma.nbfcFundamental.count({ where: { stockId: { in: stockIds } } }),
    prisma.nbfcQuarterlyResult.count({ where: { stockId: { in: stockIds } } }),
    prisma.lifeInsuranceFundamental.count({ where: { stockId: { in: stockIds } } }),
    prisma.lifeInsuranceQuarterlyResult.count({ where: { stockId: { in: stockIds } } }),
    prisma.generalInsuranceFundamental.count({ where: { stockId: { in: stockIds } } }),
    prisma.generalInsuranceQuarterlyResult.count({ where: { stockId: { in: stockIds } } }),
  ]);
  return { fund, qr, bankF, bankQ, nbfcF, nbfcQ, liF, liQ, giF, giQ };
}

async function main() {
  const thirteen = await prisma.stock.findMany({
    where: { symbol: { in: THIRTEEN } },
    select: { id: true, symbol: true, industryType: true },
  });
  const thirteenIds = thirteen.map((s) => s.id);

  console.log("── THE 13 — per-table row counts ──");
  console.log(await tableCounts(thirteenIds));

  console.log("\n── THE 13 — per-stock table presence ──");
  for (const s of thirteen) {
    const c = await tableCounts([s.id]);
    const nonzero = Object.entries(c).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(", ");
    console.log(`  ${s.symbol.padEnd(12)} industryType=${s.industryType.padEnd(16)} ${nonzero || "(no rows anywhere)"}`);
  }

  const control = await prisma.stock.findMany({
    where: { industryType: { not: "non_financial" } },
    select: { id: true, symbol: true, industryType: true },
  });
  console.log(`\n── CONTROL GROUP (industryType != non_financial): ${control.length} stocks ──`);
  const byType: Record<string, number> = {};
  for (const s of control) byType[s.industryType] = (byType[s.industryType] ?? 0) + 1;
  console.log(byType);
  const controlIds = control.map((s) => s.id);
  console.log("control-group table counts:", await tableCounts(controlIds));

  console.log("\n── SCORING STATE for the 13 ──");
  for (const s of thirteen) {
    const [snap, findings, pg] = await Promise.all([
      prisma.scoreSnapshot.count({ where: { stockId: s.id } }),
      prisma.stockFinding.findMany({ where: { stockId: s.id }, select: { ruleKey: true, evaluationState: true, periodKey: true } }),
      prisma.stockPeerGroup.count({ where: { stockId: s.id } }),
    ]);
    const fired = findings.filter((f) => f.evaluationState === "fired");
    console.log(
      `  ${s.symbol.padEnd(12)} scoreSnapshots=${snap} peerGroupRows=${pg} stockFindings=${findings.length} (fired=${fired.length}: ${fired.map((f) => f.ruleKey).join(",")})`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
