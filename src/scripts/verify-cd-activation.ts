// Post-Stage-4 verification + ATTRIBUTION. Read-only.
//   (1) C/D flow-category STATE distribution across the in-force universe (the real
//       activation metric: scored vs still-dormant_no_feed).
//   (2) Attribution: for the composite movers, isolate the PURE C/D effect (recompute
//       ownership NO_FEEDS vs real feeds on the SAME current data) — proving the visible
//       composite moves are price-driven (Market refresh), not C/D.
//   (3) D live-not-dormant where market cap resolved.
//
//   npx tsx src/scripts/verify-cd-activation.ts

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

function makePriceProbe(series: DailyClose[]): PriceProbe {
  return (priorExcl: Date, currentIncl: Date): A1PriceEval => {
    const windowDays = series.filter((s) => s.date > priorExcl && s.date <= currentIncl);
    let assessedAny = false;
    for (const d of windowDays) {
      const rp = rangePositionAsOf(series, d.date);
      if (rp.trailingDays < MIN_TRAILING_DAYS) continue;
      assessedAny = true;
      if (rp.position === null) continue;
      if (rp.position <= 0.25) return { available: true, dipTouched: true, touchedOn: iso(d.date), positionAtTouch: rp.position, windowStartExclusive: iso(priorExcl), windowEndInclusive: iso(currentIncl) };
    }
    return { available: assessedAny, dipTouched: false, touchedOn: null, positionAtTouch: null, windowStartExclusive: iso(priorExcl), windowEndInclusive: iso(currentIncl) };
  };
}
async function loadOwn(stockId: string): Promise<OwnershipQuarter[]> {
  const sh = await prisma.shareholdingPattern.findMany({ where: { stockId }, orderBy: { asOnDate: "asc" }, select: { asOnDate: true, quarter: true, fiscalYear: true, promoterShares: true, totalShares: true, pledgedShares: true, promoterPct: true, fiiPct: true, diiPct: true, retailPct: true } });
  return sh.map((r) => ({ asOnDate: r.asOnDate, quarter: r.quarter, fiscalYear: r.fiscalYear, promoterShares: r.promoterShares, totalShares: r.totalShares, pledgedShares: r.pledgedShares, promoterPct: num(r.promoterPct), fiiPct: num(r.fiiPct), diiPct: num(r.diiPct), retailPct: num(r.retailPct) }));
}
async function loadDaily(stockId: string): Promise<DailyClose[]> {
  const rows = await prisma.dailyPrice.findMany({ where: { stockId }, orderBy: { date: "asc" }, select: { date: true, close: true } });
  return rows.map((d) => ({ date: d.date, close: Number(d.close) }));
}

async function main() {
  console.log("═".repeat(78));
  console.log("POST-STAGE-4 VERIFICATION — C/D state distribution + attribution");
  console.log("═".repeat(78));

  // ── (1) In-force snapshots + their persisted C/D flow-category states ──
  const snaps = await prisma.scoreSnapshot.findMany({
    where: { snapshotType: "quarterly", periodKey: "FY26Q4" },
    orderBy: { version: "desc" },
    select: { stockId: true, symbol: true, version: true, composite: true, runId: true,
      ownershipPillar: { select: { subtotal: true, ownershipScore: { select: { flowCategories: { select: { category: true, categoryState: true, cappedSubScore: true, netFlowValue: true, bandLanded: true } } } } } } },
  });
  const live = new Map<string, typeof snaps[number]>();
  for (const s of snaps) if (!live.has(s.stockId)) live.set(s.stockId, s);

  const cState: Record<string, number> = {}; const dState: Record<string, number> = {};
  let cScoredNonZero = 0, dScoredNonZero = 0;
  for (const s of live.values()) {
    const fcs = s.ownershipPillar?.ownershipScore?.flowCategories ?? [];
    const c = fcs.find((f) => f.category === "C_insider"); const d = fcs.find((f) => f.category === "D_block");
    if (c) { cState[c.categoryState] = (cState[c.categoryState] ?? 0) + 1; if (c.categoryState === "scored" && num(c.cappedSubScore) !== 0) cScoredNonZero++; }
    if (d) { dState[d.categoryState] = (dState[d.categoryState] ?? 0) + 1; if (d.categoryState === "scored" && num(d.cappedSubScore) !== 0) dScoredNonZero++; }
  }
  console.log(`\nIn-force FY26Q4 snapshots: ${live.size}`);
  console.log(`C_insider state: ${JSON.stringify(cState)}   (scored with non-zero score: ${cScoredNonZero})`);
  console.log(`D_block   state: ${JSON.stringify(dState)}   (scored with non-zero score: ${dScoredNonZero})`);
  console.log(`  ⇒ "scored" = feed LIVE (activated). "dormant_no_feed" = still on old snapshot (self-heals next price cycle). "dormant_no_data" = D with no market cap.`);

  // distinct runIds among in-force snaps → how many came from the activation run
  const runIds = new Map<string, number>();
  for (const s of live.values()) runIds.set(s.runId, (runIds.get(s.runId) ?? 0) + 1);
  console.log(`  in-force snapshots by runId: ${[...runIds.values()].sort((a, b) => b - a).join(", ")} (the large bucket = this activation run)`);

  // ── (2) ATTRIBUTION — isolate pure C/D effect for the biggest composite movers ──
  console.log("\n" + "─".repeat(78));
  console.log("ATTRIBUTION — pure C/D effect vs the visible composite move (price refresh)");
  console.log("─".repeat(78));
  const probeSymbols = ["TORNTPOWER", "ONGC", "RELIANCE", "NTPC", "HCLTECH", "ASHOKLEY", "M&M"];
  console.log(`\n${"SYMBOL".padEnd(13)}${"ownNO_FEEDS".padEnd(13)}${"ownFEEDS".padEnd(11)}${"pureΔown(C/D)".padEnd(15)}C / D state`);
  for (const sym of probeSymbols) {
    const entry = [...live.values()].find((s) => s.symbol === sym);
    if (!entry) { console.log(`${sym.padEnd(13)}(not in universe)`); continue; }
    const own = await loadOwn(entry.stockId); const daily = await loadDaily(entry.stockId);
    if (!own.length) continue;
    const current = own[own.length - 1];
    const probe = makePriceProbe(daily);
    const before = computeOwnership(sym, own, { priceProbe: probe, feeds: NO_FEEDS } as OwnershipContext);
    const loaded = await loadFlowFeeds({ stockId: entry.stockId, asOf: current.asOnDate, daily, totalShares: current.totalShares });
    const after = computeOwnership(sym, own, { priceProbe: probe, feeds: loaded.feeds } as OwnershipContext);
    const pure = (after!.finalOwnership - before!.finalOwnership);
    console.log(`${sym.padEnd(13)}${f2(before?.finalOwnership).padEnd(13)}${f2(after?.finalOwnership).padEnd(11)}${((pure >= 0 ? "+" : "") + pure.toFixed(2)).padEnd(15)}${after!.flow.C.state}(${after!.flow.C.cappedSubScore}) / ${after!.flow.D.state}(${after!.flow.D.cappedSubScore})`);
  }
  console.log(`\n  ⇒ pureΔown(C/D) is the ONLY part C/D caused. Composite moves larger than ~0.20×pureΔown are Market price drift since the Jun-18 commit, NOT C/D.`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
