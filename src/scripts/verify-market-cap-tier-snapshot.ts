// READ-ONLY verify of the frozen tier snapshot (latest as_of_date).
//   - 505 tiered; tier counts; unknown set by reason
//   - the 93 scored stocks (have a ScoreSnapshot) skew large/mid; spot-checks
//   - single freeze date (append-only intact)
//   npx tsx src/scripts/verify-market-cap-tier-snapshot.ts
import { prisma } from "../db/prisma.js";

async function main() {
  // Latest freeze date
  const latest = await prisma.marketCapTierSnapshot.findFirst({ orderBy: { asOfDate: "desc" }, select: { asOfDate: true } });
  if (!latest) { console.log("no snapshot rows"); await prisma.$disconnect(); return; }
  const asOf = latest.asOfDate;
  console.log(`=== latest freeze: ${asOf.toISOString().slice(0, 10)} ===`);

  const all = await prisma.marketCapTierSnapshot.findMany({
    where: { asOfDate: asOf },
    select: { tier: true, rank: true, marketCap: true, unknownReason: true, stock: { select: { symbol: true, scoreSnapshots: { select: { id: true }, take: 1 } } } },
  });
  console.log(`rows in latest freeze: ${all.length}`);

  const count = (t: string) => all.filter((r) => r.tier === t).length;
  console.log(`\n[tier counts] large=${count("large")} mid=${count("mid")} small=${count("small")} unknown=${count("unknown")} · total=${all.length}`);

  // unknown by reason (from the stored column)
  const unknown = all.filter((r) => r.tier === "unknown");
  const byReason = new Map<string, string[]>();
  for (const r of unknown) { const k = r.unknownReason ?? "(null!)"; if (!byReason.has(k)) byReason.set(k, []); byReason.get(k)!.push(r.stock.symbol); }
  console.log(`\n[unknown by reason]`);
  for (const [reason, syms] of byReason) {
    const heal = reason === "gated_split" ? "  ← SELF-HEALING (next freeze once the action reconciles)" : reason === "no_total_shares" ? "  ← persists until a filing lands" : "";
    console.log(`  ${reason.padEnd(16)} (${syms.length}): ${syms.sort().join(", ")}${heal}`);
  }

  // integrity: unknownReason must be null iff tier≠unknown; rank null iff unknown
  const badReason = all.filter((r) => (r.tier === "unknown") !== (r.unknownReason != null)).length;
  const badRank = all.filter((r) => (r.tier === "unknown") !== (r.rank == null)).length;
  console.log(`\n[integrity] unknownReason set ⇔ unknown: ${badReason === 0 ? "✅" : "❌ " + badReason} · rank null ⇔ unknown: ${badRank === 0 ? "✅" : "❌ " + badRank}`);

  // scored stocks (have a ScoreSnapshot) should skew large/mid
  const scored = all.filter((r) => r.stock.scoreSnapshots.length > 0);
  const sCount = (t: string) => scored.filter((r) => r.tier === t).length;
  console.log(`\n[scored stocks — expect large/mid skew] n=${scored.length}`);
  console.log(`  large=${sCount("large")} mid=${sCount("mid")} small=${sCount("small")} unknown=${sCount("unknown")}`);
  console.log(`  large+mid = ${sCount("large") + sCount("mid")}/${scored.length} (${Math.round((sCount("large") + sCount("mid")) / scored.length * 100)}%)`);
  console.log(`  spot-checks:`);
  for (const sym of ["RELIANCE", "HDFCBANK", "TCS", "INFY", "SUNPHARMA", "TITAN"]) {
    const r = all.find((x) => x.stock.symbol === sym);
    if (r) console.log(`    ${sym.padEnd(12)} tier=${r.tier.padEnd(6)} rank=${r.rank ?? "-"}  ₹${r.marketCap ? Math.round(Number(r.marketCap)).toLocaleString("en-IN") + " Cr" : "-"}`);
  }
  // a few smallest scored (sanity: any scored stock that's small?)
  const smallScored = scored.filter((r) => r.tier === "small").sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  if (smallScored.length) console.log(`  scored-but-small (${smallScored.length}): ${smallScored.map((r) => `${r.stock.symbol}#${r.rank}`).join(", ")}`);

  // append-only intact: how many distinct freeze dates exist
  const dates = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(DISTINCT as_of_date)::int n FROM market_cap_tier_snapshot`);
  console.log(`\n[append-only] distinct freeze dates in table: ${dates[0].n}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
