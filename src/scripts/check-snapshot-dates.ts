// Quick check of asOfDate distribution in FY26Q4 snapshots
import { prisma } from "../db/prisma.js";

const rows = await prisma.scoreSnapshot.findMany({
  where: { periodKey: "FY26Q4", snapshotType: "quarterly" },
  select: { symbol: true, version: true, asOfDate: true },
  orderBy: [{ symbol: "asc" }, { version: "asc" }],
});

const byDate = new Map<string, number>();
for (const r of rows) {
  const d = r.asOfDate.toISOString().slice(0, 10);
  byDate.set(d, (byDate.get(d) ?? 0) + 1);
}
console.log("asOfDate distribution (FY26Q4):");
for (const [d, n] of [...byDate.entries()].sort()) console.log(`  ${d}  n=${n}`);

const byStock = new Map<string, { v: number; d: string }[]>();
for (const r of rows) {
  const arr = byStock.get(r.symbol) ?? [];
  arr.push({ v: r.version, d: r.asOfDate.toISOString().slice(0, 10) });
  byStock.set(r.symbol, arr);
}
const multi = [...byStock.entries()].filter(([, v]) => v.length > 1);
console.log(`\nMulti-version stocks: ${multi.length}`);
for (const [sym, vs] of multi.slice(0, 10))
  console.log(`  ${sym}: ${vs.map((x) => `v${x.v}@${x.d}`).join(", ")}`);

await prisma.$disconnect();
