// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 TRIPWIRE (throwaway) — the byte-identical gate for /me/holdings.
//
// Re-scoped by ruling: VALUES identical + ADDITIVE-ONLY keys for the two manual-only users.
// SEQUENCE deliberately changes (investedValue-desc → marketValue-desc). If any pre-existing
// field's VALUE moves by a rupee, that is the stop condition.
//
// Rather than trust a table I printed earlier, this runs the OLD implementation VERBATIM
// (copied from the pre-Step-5 controller) against the live DB, side by side with the new
// endpoint, and diffs them field by field.
//
//   npx tsx src/scripts/s5-tripwire.ts
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { listHoldings } from "../controllers/me/holdings-controller.js";

const USERS = ["108fd2a6-ff59-4024-ada1-c6ea7792ada4", "7985d813-e3fa-4f6f-b23d-715a9a36ee01"];
const mockRes = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const mockReq = (userId: string) => ({ authUser: { userId }, body: {}, params: {}, query: {} }) as any;
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

// ═══ THE OLD IMPLEMENTATION, VERBATIM (pre-Step-5: reads prisma.holding directly) ═══
async function listHoldingsOLD(userId: string) {
  const rows = await prisma.holding.findMany({
    where: { userId, quantity: { gt: 0 } },
    orderBy: { investedValue: "desc" },
    include: {
      instrument: {
        select: {
          symbol: true, name: true,
          stock: { select: { id: true, symbol: true, name: true, sector: { select: { name: true, displayName: true } } } },
        },
      },
      lots: { orderBy: { buyDate: "asc" }, select: { quantity: true, costPerShare: true, buyDate: true, sourceTxnId: true } },
    },
  });
  const stockIds = rows.flatMap((h) => (h.instrument.stock ? [h.instrument.stock.id] : []));
  const [prices, scores, tiers] = await Promise.all([
    prisma.stockPrice.findMany({ where: { stockId: { in: stockIds } }, select: { stockId: true, price: true, prevClose: true, dayChangePct: true, marketCap: true } }),
    prisma.scoreSnapshot.findMany({ where: { stockId: { in: stockIds } }, orderBy: [{ asOfDate: "desc" }, { version: "desc" }], select: { stockId: true, composite: true, labelBand: true, asOfDate: true, periodKey: true } }),
    prisma.marketCapTierSnapshot.findMany({ where: { stockId: { in: stockIds } }, orderBy: { asOfDate: "desc" }, select: { stockId: true, tier: true } }),
  ]);
  const priceBy = new Map(prices.map((p) => [p.stockId, p]));
  const scoreBy = new Map<string, (typeof scores)[number]>();
  for (const s of scores) if (!scoreBy.has(s.stockId)) scoreBy.set(s.stockId, s);
  const tierBy = new Map<string, string>();
  for (const t of tiers) if (!tierBy.has(t.stockId)) tierBy.set(t.stockId, t.tier);

  const enriched = rows.map((h) => {
    const stock = h.instrument.stock;
    const qty = Number(h.quantity);
    const invested = Number(h.investedValue);
    const price = stock ? priceBy.get(stock.id) : undefined;
    const score = stock ? scoreBy.get(stock.id) : undefined;
    const currentPrice = numOrNull(price?.price);
    const prevClose = numOrNull(price?.prevClose);
    const dayChangePct = numOrNull(price?.dayChangePct);
    const marketValue = currentPrice != null ? qty * currentPrice : null;
    const dayChangeValue = currentPrice != null && prevClose != null ? qty * (currentPrice - prevClose) : null;
    const unrealizedPnl = marketValue != null ? marketValue - invested : null;
    return {
      symbol: stock?.symbol ?? h.instrument.symbol,
      name: stock?.name ?? h.instrument.name,
      sector: stock?.sector?.displayName ?? stock?.sector?.name ?? null,
      quantity: h.quantity.toString(),
      avgCost: h.avgCost.toString(),
      investedValue: h.investedValue.toString(),
      realizedPnl: h.realizedPnl.toString(),
      lastComputedAt: h.lastComputedAt.toISOString(),
      currentPrice, marketValue, dayChangePct, dayChangeValue, unrealizedPnl,
      health: score ? Number(score.composite) : null,
      band: score ? score.labelBand : null,
      healthAsOf: score ? score.asOfDate.toISOString().slice(0, 10) : null,
      tier: (stock ? tierBy.get(stock.id) : undefined) ?? "unknown",
      weight: 0,
      lots: h.lots.map((l) => ({ quantity: l.quantity.toString(), costPerShare: l.costPerShare.toString(), buyDate: l.buyDate.toISOString().slice(0, 10), sourceTxnId: l.sourceTxnId })),
    };
  });
  const totalMarketValue = enriched.reduce((s, h) => s + (h.marketValue ?? 0), 0);
  for (const h of enriched) h.weight = totalMarketValue > 0 && h.marketValue != null ? h.marketValue / totalMarketValue : 0;
  const investedOfPriced = enriched.reduce((s, h) => s + (h.marketValue != null ? Number(h.investedValue) : 0), 0);
  const dayChangeValueTotal = enriched.reduce((s, h) => s + (h.dayChangeValue ?? 0), 0);
  const pricedPositions = enriched.filter((h) => h.marketValue != null).length;
  const realizedTotal = await prisma.holding.aggregate({ where: { userId }, _sum: { realizedPnl: true } });
  const prevValue = totalMarketValue - dayChangeValueTotal;
  return {
    holdings: enriched,
    totals: {
      positions: enriched.length,
      pricedPositions,
      investedValue: enriched.reduce((s, h) => s + Number(h.investedValue), 0).toFixed(2),
      realizedPnlAll: (realizedTotal._sum.realizedPnl ?? 0).toString(),
      currentValue: totalMarketValue.toFixed(2),
      unrealizedPnl: (totalMarketValue - investedOfPriced).toFixed(2),
      dayChangeValue: dayChangeValueTotal.toFixed(2),
      dayChangePct: prevValue > 0 ? ((dayChangeValueTotal / prevValue) * 100).toFixed(4) : null,
    },
  };
}

let failures = 0;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

for (const userId of USERS) {
  console.log(`\n══ ${userId.slice(0, 8)}… ══`);
  const oldData = await listHoldingsOLD(userId);
  const r = mockRes();
  await listHoldings(mockReq(userId), r);
  const newData = r.body.data;

  // ── 1. same POSITIONS (as a set — sequence is allowed to change) ──
  const oldSyms = [...oldData.holdings.map((h) => h.symbol)].sort();
  const newSyms = [...newData.holdings.map((h: any) => h.symbol)].sort();
  const sameSet = eq(oldSyms, newSyms);
  if (!sameSet) failures++;
  console.log(`  ${sameSet ? "✅" : "❌"} same positions (${oldSyms.length}) — set identical`);

  // ── 2. every PRE-EXISTING per-row field byte-identical ──
  const OLD_KEYS = Object.keys(oldData.holdings[0] ?? {});
  let rowDiffs = 0;
  for (const o of oldData.holdings) {
    const n = newData.holdings.find((x: any) => x.symbol === o.symbol);
    if (!n) { rowDiffs++; continue; }
    for (const k of OLD_KEYS) {
      if (!eq((o as any)[k], n[k])) {
        rowDiffs++;
        console.log(`     ❌ ${o.symbol}.${k}: ${JSON.stringify((o as any)[k])} → ${JSON.stringify(n[k])}`);
      }
    }
  }
  if (rowDiffs > 0) failures++;
  console.log(`  ${rowDiffs === 0 ? "✅" : "❌"} all ${OLD_KEYS.length} pre-existing per-row fields IDENTICAL — ${rowDiffs} diff(s)`);

  // ── 3. every PRE-EXISTING total byte-identical ──
  let totDiffs = 0;
  for (const k of Object.keys(oldData.totals)) {
    if (!eq((oldData.totals as any)[k], newData.totals[k])) {
      totDiffs++;
      console.log(`     ❌ totals.${k}: ${JSON.stringify((oldData.totals as any)[k])} → ${JSON.stringify(newData.totals[k])}`);
    }
  }
  if (totDiffs > 0) failures++;
  console.log(`  ${totDiffs === 0 ? "✅" : "❌"} all pre-existing TOTALS IDENTICAL — ${totDiffs} diff(s)`);
  console.log(`     ${JSON.stringify(newData.totals)}`);

  // ── 4. new keys are ADDITIVE ONLY (nothing removed) ──
  const newKeys = Object.keys(newData.holdings[0] ?? {});
  const removed = OLD_KEYS.filter((k) => !newKeys.includes(k));
  const added = newKeys.filter((k) => !OLD_KEYS.includes(k));
  if (removed.length > 0) failures++;
  console.log(`  ${removed.length === 0 ? "✅" : "❌"} additive-only — removed=[${removed.join(",")}] added=[${added.join(",")}]`);

  // ── 5. sequence: EXPECTED to change (the ruling) — reported, not failed ──
  const oldSeq = oldData.holdings.map((h) => h.symbol);
  const newSeq = newData.holdings.map((h: any) => h.symbol);
  console.log(`  ℹ️  sequence (ruled: marketValue-desc)`);
  console.log(`       was: ${oldSeq.join(" › ")}`);
  console.log(`       now: ${newSeq.join(" › ")}`);
  const sortedRight = newData.holdings.every((h: any, i: number, a: any[]) =>
    i === 0 || (a[i - 1].marketValue ?? -1) >= (h.marketValue ?? -1));
  if (!sortedRight) failures++;
  console.log(`  ${sortedRight ? "✅" : "❌"} ...and the new sequence IS marketValue-desc`);

  // ── 6. a manual-only book must report NOTHING partial ──
  const p = newData.totals.partial;
  const clean = p.investedValue === false && p.unrealizedPnl === false && p.realizedPnl === false
    && p.positionsWithoutCostBasis === 0 && p.valueWithoutCostBasis === "0.00";
  if (!clean) failures++;
  console.log(`  ${clean ? "✅" : "❌"} manual-only book ⇒ nothing partial — ${JSON.stringify(p)}`);
}

console.log(failures === 0 ? "\n✅ TRIPWIRE HELD (values identical, additive-only)" : `\n❌ TRIPWIRE BROKEN (${failures})`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
