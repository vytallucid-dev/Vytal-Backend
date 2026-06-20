// DRY-RUN PROBE for the C/D flow-feed activation. Writes NOTHING (no scoring writes;
// the committed NO_FEEDS path is untouched). Exercises the loader + the already-written
// C/D logic against real InsiderTrade/BlockDeal data for the FIRST time.
//
//   npx tsx src/scripts/probe-flow-feeds.ts
//
// Reports: (2a) data census, (2b) feed sanity for active names + flagged categories,
// (2c) cutoff-filter proof, (3) Ownership pillar + composite BEFORE (NO_FEEDS) vs
// AFTER (real feeds) for the movers + a sparse + a quiet case.

import { prisma } from "../db/prisma.js";
import { computeOwnership, type OwnershipContext } from "../scoring/ownership/ownership.js";
import { type A1PriceEval, type FlowFeeds, type PriceProbe } from "../scoring/ownership/flow.js";
import { loadFlowFeeds } from "../scoring/ownership/flow-feeds-load.js";
import { rangePositionAsOf, MIN_TRAILING_DAYS, type DailyClose } from "../scoring/price/range.js";
import type { OwnershipQuarter } from "../scoring/ownership/types.js";

const NO_FEEDS: FlowFeeds = { insiderTxns: null, blockTxns: null, marketCapInrCr: null };
const num = (d: unknown): number | null =>
  d == null ? null : typeof (d as { toNumber?: () => number }).toNumber === "function" ? (d as { toNumber: () => number }).toNumber() : Number(d);
const f2 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Same A1 price probe the committed ownership path uses (raw close, 52w-range dip). */
function makePriceProbe(series: DailyClose[]): PriceProbe {
  return (priorExcl: Date, currentIncl: Date): A1PriceEval => {
    const windowDays = series.filter((s) => s.date > priorExcl && s.date <= currentIncl);
    let assessedAny = false;
    for (const d of windowDays) {
      const rp = rangePositionAsOf(series, d.date);
      if (rp.trailingDays < MIN_TRAILING_DAYS) continue;
      assessedAny = true;
      if (rp.position === null) continue;
      if (rp.position <= 0.25)
        return { available: true, dipTouched: true, touchedOn: iso(d.date), positionAtTouch: rp.position, windowStartExclusive: iso(priorExcl), windowEndInclusive: iso(currentIncl) };
    }
    return { available: assessedAny, dipTouched: false, touchedOn: null, positionAtTouch: null, windowStartExclusive: iso(priorExcl), windowEndInclusive: iso(currentIncl) };
  };
}

async function loadOwn(stockId: string): Promise<OwnershipQuarter[]> {
  const sh = await prisma.shareholdingPattern.findMany({
    where: { stockId },
    orderBy: { asOnDate: "asc" },
    select: { asOnDate: true, quarter: true, fiscalYear: true, promoterShares: true, totalShares: true, pledgedShares: true, promoterPct: true, fiiPct: true, diiPct: true, retailPct: true },
  });
  return sh.map((r) => ({ asOnDate: r.asOnDate, quarter: r.quarter, fiscalYear: r.fiscalYear, promoterShares: r.promoterShares, totalShares: r.totalShares, pledgedShares: r.pledgedShares, promoterPct: num(r.promoterPct), fiiPct: num(r.fiiPct), diiPct: num(r.diiPct), retailPct: num(r.retailPct) }));
}

async function loadDaily(stockId: string): Promise<DailyClose[]> {
  const rows = await prisma.dailyPrice.findMany({ where: { stockId }, orderBy: { date: "asc" }, select: { date: true, close: true } });
  return rows.map((d) => ({ date: d.date, close: Number(d.close) }));
}

async function main() {
  console.log("═".repeat(78));
  console.log("DRY-RUN PROBE — C/D flow-feed activation (writes nothing)");
  console.log("═".repeat(78));

  // ── In-force FY26Q4 snapshots = the scored universe (max version per stock) ──
  const snaps = await prisma.scoreSnapshot.findMany({
    where: { snapshotType: "quarterly", periodKey: "FY26Q4" },
    orderBy: [{ version: "desc" }],
    select: { stockId: true, symbol: true, version: true, composite: true, labelBand: true, wOwnership: true, ownershipPillar: { select: { subtotal: true, pillarState: true } } },
  });
  const live = new Map<string, { symbol: string; composite: number; band: string; wOwn: number; ownSub: number | null; ownState: string | null }>();
  for (const s of snaps) {
    if (live.has(s.stockId)) continue; // first seen = highest version
    live.set(s.stockId, { symbol: s.symbol, composite: num(s.composite)!, band: String(s.labelBand), wOwn: num(s.wOwnership)!, ownSub: num(s.ownershipPillar?.subtotal ?? null), ownState: s.ownershipPillar?.pillarState ?? null });
  }
  console.log(`\nScored universe (in-force FY26Q4): ${live.size} stocks`);

  // ── STAGE 2a — DATA CENSUS ──────────────────────────────────────────────────
  console.log("\n" + "─".repeat(78));
  console.log("STAGE 2a — DATA CENSUS (insider_trades, block_deals)");
  console.log("─".repeat(78));

  const insCount = await prisma.insiderTrade.count();
  const blkCount = await prisma.blockDeal.count();
  const insBySym = await prisma.insiderTrade.groupBy({ by: ["stockId"], _count: { _all: true } });
  const blkBySym = await prisma.blockDeal.groupBy({ by: ["stockId"], _count: { _all: true } });
  const insAgg = await prisma.insiderTrade.aggregate({ _min: { tradeDate: true, intimationDate: true }, _max: { tradeDate: true, intimationDate: true } });
  const blkAgg = await prisma.blockDeal.aggregate({ _min: { dealDate: true }, _max: { dealDate: true } });

  const insStockIds = new Set(insBySym.map((r) => r.stockId));
  const blkStockIds = new Set(blkBySym.map((r) => r.stockId));
  const scoredIds = new Set(live.keys());
  const insScored = [...insStockIds].filter((id) => scoredIds.has(id)).length;
  const blkScored = [...blkStockIds].filter((id) => scoredIds.has(id)).length;

  console.log(`insider_trades : ${insCount} rows · ${insStockIds.size} distinct stockIds · tradeDate ${insAgg._min.tradeDate ? iso(insAgg._min.tradeDate) : "∅"} → ${insAgg._max.tradeDate ? iso(insAgg._max.tradeDate) : "∅"} · intimation ${insAgg._min.intimationDate ? iso(insAgg._min.intimationDate) : "∅"} → ${insAgg._max.intimationDate ? iso(insAgg._max.intimationDate) : "∅"}`);
  console.log(`               ↳ scored-universe coverage: ${insScored}/${live.size} stocks have ≥1 insider row`);
  console.log(`block_deals    : ${blkCount} rows · ${blkStockIds.size} distinct stockIds · dealDate ${blkAgg._min.dealDate ? iso(blkAgg._min.dealDate) : "∅"} → ${blkAgg._max.dealDate ? iso(blkAgg._max.dealDate) : "∅"}`);
  console.log(`               ↳ scored-universe coverage: ${blkScored}/${live.size} stocks have ≥1 block/bulk row`);

  // personCategory + transactionType distributions (what the mapping will face)
  const catDist = await prisma.insiderTrade.groupBy({ by: ["personCategory"], _count: { _all: true } });
  const txnDist = await prisma.insiderTrade.groupBy({ by: ["transactionType"], _count: { _all: true } });
  console.log(`\ninsider personCategory distribution: ${catDist.map((c) => `${c.personCategory}=${c._count._all}`).join(" · ")}`);
  console.log(`insider transactionType distribution: ${txnDist.map((c) => `${c.transactionType}=${c._count._all}`).join(" · ")}`);

  // ── Build the working set: scored stocks with ANY insider or block row ──
  const activeIds = [...scoredIds].filter((id) => insStockIds.has(id) || blkStockIds.has(id));
  console.log(`\nScored stocks with ANY insider/block row (compute before/after on these): ${activeIds.length}`);

  // ── Compute before/after for every active scored stock ──
  interface Row {
    symbol: string; stockId: string;
    ownBefore: number | null; ownAfter: number | null; dOwn: number;
    cState: string; cRule: string | null; cScore: number; cNet: number | null;
    dState: string; dRule: string | null; dScore: number; dNet: number | null;
    mcap: number | null; insKept: number; blkKept: number;
    snapComposite: number; wOwn: number; snapOwnSub: number | null; band: string;
    flagged: Record<string, number>;
  }
  const rows: Row[] = [];
  for (const stockId of activeIds) {
    const lv = live.get(stockId)!;
    const own = await loadOwn(stockId);
    if (own.length === 0) continue;
    const daily = await loadDaily(stockId);
    const current = own[own.length - 1];
    const probe = makePriceProbe(daily);

    const before = computeOwnership(lv.symbol, own, { priceProbe: probe, feeds: NO_FEEDS } as OwnershipContext);
    const loaded = await loadFlowFeeds({ stockId, asOf: current.asOnDate, daily, totalShares: current.totalShares });
    const after = computeOwnership(lv.symbol, own, { priceProbe: probe, feeds: loaded.feeds } as OwnershipContext);
    if (!before || !after) continue;

    rows.push({
      symbol: lv.symbol, stockId,
      ownBefore: before.finalOwnership, ownAfter: after.finalOwnership, dOwn: after.finalOwnership - before.finalOwnership,
      cState: after.flow.C.state, cRule: after.flow.C.firedRule, cScore: after.flow.C.cappedSubScore, cNet: after.flow.C.netFlowValue,
      dState: after.flow.D.state, dRule: after.flow.D.firedRule, dScore: after.flow.D.cappedSubScore, dNet: after.flow.D.netFlowValue,
      mcap: loaded.diag.marketCapInrCr, insKept: loaded.diag.insiderKept, blkKept: loaded.diag.blockKept,
      snapComposite: lv.composite, wOwn: lv.wOwn, snapOwnSub: lv.ownSub, band: lv.band,
      flagged: loaded.diag.flaggedCategories,
    });
  }

  // ── STAGE 2b — FEED SANITY for a few active names ──────────────────────────
  console.log("\n" + "─".repeat(78));
  console.log("STAGE 2b — FEED SANITY (mapped arrays, market cap, flagged categories)");
  console.log("─".repeat(78));

  const sample = [...rows].sort((a, b) => (b.insKept + b.blkKept) - (a.insKept + a.blkKept)).slice(0, 4);
  for (const r of sample) {
    const own = await loadOwn(r.stockId);
    const daily = await loadDaily(r.stockId);
    const current = own[own.length - 1];
    const loaded = await loadFlowFeeds({ stockId: r.stockId, asOf: current.asOnDate, daily, totalShares: current.totalShares });
    console.log(`\n▸ ${r.symbol}  (shareholding as-of ${iso(current.asOnDate)}; C/D 30d window ends here)`);
    console.log(`   market cap: ${r.mcap == null ? "NULL → D dormant_no_data" : "₹" + Math.round(r.mcap).toLocaleString("en-IN") + " Cr"}  [${loaded.diag.marketCapSource}]`);
    console.log(`   insider raw ${loaded.diag.insiderRaw} → kept ${loaded.diag.insiderKept}  (dropped: role/excluded ${loaded.diag.insiderDroppedRole}, non-buy/sell ${loaded.diag.insiderDroppedSide}, no-value ${loaded.diag.insiderDroppedValue})`);
    const insWin = loaded.feeds.insiderTxns!.filter((t) => t.date.getTime() > current.asOnDate.getTime() - 30 * 86400000 && t.date.getTime() <= current.asOnDate.getTime());
    for (const t of insWin.slice(0, 5)) console.log(`      insider · ${iso(t.date)} ${t.side.toUpperCase().padEnd(4)} ₹${f2(t.valueInrCr)}cr  role=${t.role}  [${t.insiderId.slice(0, 28)}]`);
    if (insWin.length === 0) console.log(`      (no eligible insider txns in the 30d window — C lands neutral/net-band)`);
    console.log(`   block raw ${loaded.diag.blockRaw} → kept ${loaded.diag.blockKept}  (dropped no-value ${loaded.diag.blockDroppedValue})`);
    const blkWin = loaded.feeds.blockTxns!.filter((t) => t.date.getTime() > current.asOnDate.getTime() - 30 * 86400000 && t.date.getTime() <= current.asOnDate.getTime());
    for (const t of blkWin.slice(0, 5)) console.log(`      block   · ${iso(t.date)} ${t.side.toUpperCase().padEnd(4)} ₹${f2(t.valueInrCr)}cr`);
    if (Object.keys(loaded.diag.flaggedCategories).length) console.log(`   ⚑ FLAGGED categories: ${JSON.stringify(loaded.diag.flaggedCategories)}`);
  }

  // aggregate flagged categories across the whole active set
  const allFlags: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.flagged)) allFlags[k] = (allFlags[k] ?? 0) + v;
  console.log(`\n⚑ ALL flagged (excluded+surfaced) personCategory strings across active set: ${Object.keys(allFlags).length ? JSON.stringify(allFlags) : "NONE"}`);

  // ── STAGE 2c — CUTOFF-FILTER PROOF ─────────────────────────────────────────
  console.log("\n" + "─".repeat(78));
  console.log("STAGE 2c — CUTOFF-FILTER PROOF (a post-cutoff trade is excluded)");
  console.log("─".repeat(78));
  const proofStock = rows.find((r) => r.insKept >= 2) ?? rows.find((r) => r.blkKept >= 2);
  if (proofStock) {
    const daily = await loadDaily(proofStock.stockId);
    const own = await loadOwn(proofStock.stockId);
    const current = own[own.length - 1];
    // find the max insider/block date, set a cutoff just before it
    const insDates = await prisma.insiderTrade.findMany({ where: { stockId: proofStock.stockId }, select: { tradeDate: true }, orderBy: { tradeDate: "desc" }, take: 1 });
    const blkDates = await prisma.blockDeal.findMany({ where: { stockId: proofStock.stockId }, select: { dealDate: true }, orderBy: { dealDate: "desc" }, take: 1 });
    const maxIns = insDates[0]?.tradeDate ?? null;
    const maxBlk = blkDates[0]?.dealDate ?? null;
    const anchor = [maxIns, maxBlk].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0]!;
    const cutoff = new Date(anchor.getTime() - 1 * 86400000); // 1 day before the latest deal
    const noCut = await loadFlowFeeds({ stockId: proofStock.stockId, asOf: current.asOnDate, daily, totalShares: current.totalShares });
    const withCut = await loadFlowFeeds({ stockId: proofStock.stockId, asOf: current.asOnDate, cutoff, daily, totalShares: current.totalShares });
    console.log(`\n▸ ${proofStock.symbol}: latest deal dated ${iso(anchor)}; set cutoff = ${iso(cutoff)} (1 day earlier)`);
    console.log(`   no cutoff   : insiderRaw ${noCut.diag.insiderRaw}, blockRaw ${noCut.diag.blockRaw}`);
    console.log(`   ≤ ${iso(cutoff)} : insiderRaw ${withCut.diag.insiderRaw}, blockRaw ${withCut.diag.blockRaw}   ← post-cutoff rows excluded ✓`);
  } else {
    console.log("(no stock with ≥2 eligible txns to demonstrate — skipping)");
  }

  // ── STAGE 3 — BEFORE / AFTER (Ownership pillar + composite) ─────────────────
  console.log("\n" + "─".repeat(78));
  console.log("STAGE 3 — OWNERSHIP + COMPOSITE: BEFORE (NO_FEEDS) vs AFTER (real C/D feeds)");
  console.log("─".repeat(78));

  const movers = rows.filter((r) => Math.abs(r.dOwn) > 0.001).sort((a, b) => Math.abs(b.dOwn) - Math.abs(a.dOwn));
  const reproMismatch = rows.filter((r) => r.snapOwnSub != null && Math.abs((r.ownBefore ?? 0) - r.snapOwnSub) > 0.01);

  console.log(`\nReproduction check (recomputed ownBefore vs committed snapshot ownership subtotal):`);
  console.log(`   ${rows.length - reproMismatch.length}/${rows.length} match within 0.01  ${reproMismatch.length ? "· MISMATCHES: " + reproMismatch.map((r) => `${r.symbol}(${f2(r.ownBefore)}≠${f2(r.snapOwnSub)})`).join(", ") : "✓ all reproduce the committed value"}`);

  console.log(`\nStocks whose Ownership moved once C/D went live: ${movers.length} of ${rows.length} active`);
  console.log(`\n${"SYMBOL".padEnd(13)}${"own→".padEnd(15)}${"Δown".padEnd(8)}${"C".padEnd(20)}${"D".padEnd(18)}${"comp→".padEnd(15)}band`);
  for (const r of movers.slice(0, 20)) {
    const compAfter = r.snapComposite + r.wOwn * (r.ownAfter! - r.ownBefore!);
    const cDesc = `${r.cRule ?? r.cState}(${r.cScore >= 0 ? "+" : ""}${r.cScore})`;
    const dDesc = r.dState === "scored" ? `${r.dRule}(${r.dScore >= 0 ? "+" : ""}${r.dScore})` : r.dState;
    console.log(`${r.symbol.padEnd(13)}${(f2(r.ownBefore) + "→" + f2(r.ownAfter)).padEnd(15)}${(r.dOwn >= 0 ? "+" : "") + r.dOwn.toFixed(2)}`.padEnd(36) + `${cDesc.padEnd(20)}${dDesc.padEnd(18)}${(f2(r.snapComposite) + "→" + f2(compAfter)).padEnd(15)}${r.band}`);
  }

  // ── D activation summary ──
  const dLive = rows.filter((r) => r.dState === "scored").length;
  const dNoData = rows.filter((r) => r.dState === "dormant_no_data").length;
  console.log(`\nCategory D: ${dLive} scored (market cap resolved) · ${dNoData} dormant_no_data (market cap unavailable) — of ${rows.length} active`);

  // ── Graceful sparse + quiet cases ──
  console.log("\n" + "─".repeat(78));
  console.log("GRACEFUL DEGRADATION — sparse & quiet");
  console.log("─".repeat(78));
  const sparse = rows.filter((r) => r.insKept + r.blkKept === 1).slice(0, 3);
  for (const r of sparse) console.log(`   sparse · ${r.symbol}: 1 eligible txn → C=${r.cRule ?? r.cState}(${r.cScore}) D=${r.dState}(${r.dScore}) · Δown ${(r.dOwn >= 0 ? "+" : "") + r.dOwn.toFixed(2)} (graceful, no garbage)`);
  if (!sparse.length) console.log("   (no single-txn stock in the active set)");

  // a quiet stock: scored but NO insider/block rows → C/D must be SCORED-neutral, not dormant_no_feed
  const quietId = [...scoredIds].find((id) => !insStockIds.has(id) && !blkStockIds.has(id));
  if (quietId) {
    const lv = live.get(quietId)!;
    const own = await loadOwn(quietId);
    const daily = await loadDaily(quietId);
    if (own.length) {
      const current = own[own.length - 1];
      const loaded = await loadFlowFeeds({ stockId: quietId, asOf: current.asOnDate, daily, totalShares: current.totalShares });
      const before = computeOwnership(lv.symbol, own, { priceProbe: makePriceProbe(daily), feeds: NO_FEEDS } as OwnershipContext);
      const after = computeOwnership(lv.symbol, own, { priceProbe: makePriceProbe(daily), feeds: loaded.feeds } as OwnershipContext);
      console.log(`\n   quiet · ${lv.symbol} (0 insider/block rows):`);
      console.log(`      BEFORE: C=${before?.flow.C.state} D=${before?.flow.D.state}  (the old dormant_no_feed)`);
      console.log(`      AFTER : C=${after?.flow.C.state}(${after?.flow.C.firedRule}) D=${after?.flow.D.state}  · own ${f2(before?.finalOwnership)}→${f2(after?.finalOwnership)} (Δ ${((after!.finalOwnership - before!.finalOwnership)).toFixed(2)})`);
      console.log(`      ⇒ empty-array feed lands C in a SCORED-neutral state, not dormant_no_feed ✓`);
    }
  }

  console.log("\n" + "═".repeat(78));
  console.log("PROBE COMPLETE — no writes performed.");
  console.log("═".repeat(78));
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
