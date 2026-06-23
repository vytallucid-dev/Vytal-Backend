// File: src/scoring/read/ownership-series.service.ts
//
// THE ownership-over-time assembler. ScoreSnapshot only carries the ownership
// SCALAR per period — the lanes (flow categories, holding split, pledging) need the
// pillar graph + ShareholdingPattern. This resolves the in-force snapshots for the
// window (reusing the supersede-aware resolver), loads each one's OwnershipScore →
// flow categories, and joins the POINT-IN-TIME holding split (latest shareholding
// with asOnDate ≤ the period's asOfDate — no lookahead).

import { prisma } from "../../db/prisma.js";
import { getInForceSeriesRefs } from "./scoring-read.service.js";
import type { FlowCategoryView } from "./health-view.types.js";
import type {
  OwnershipSeriesView,
  OwnershipSeriesPoint,
  OwnershipHolding,
  OwnershipAnatomy,
  PledgingPoint,
  InsiderEvent,
  BlockEvent,
} from "./ownership-series.types.js";

const num = (d: unknown): number =>
  d == null
    ? 0
    : typeof (d as { toNumber?: () => number }).toNumber === "function"
      ? (d as { toNumber: () => number }).toNumber()
      : Number(d);
const numN = (d: unknown): number | null =>
  d == null
    ? null
    : typeof (d as { toNumber?: () => number }).toNumber === "function"
      ? (d as { toNumber: () => number }).toNumber()
      : Number(d);
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Pledge ratios from the BigInt SHARE COUNTS (the reliable source). The Decimal
 *  promoter_pledged_pct column has a unit inconsistency and is NOT used. A genuine
 *  zero-pledge (pledged = 0) reads as 0, not null. */
function pledgeRatios(
  pledged: bigint | null,
  promoter: bigint | null,
  total: bigint | null,
): { pledgedPctOfPromoter: number | null; pledgedPctOfTotal: number | null } {
  const pl = pledged != null ? Number(pledged) : null;
  const prom = promoter != null ? Number(promoter) : null;
  const tot = total != null ? Number(total) : null;
  return {
    pledgedPctOfPromoter:
      pl == null ? null : pl === 0 ? 0 : prom && prom > 0 ? round2((pl / prom) * 100) : null,
    pledgedPctOfTotal:
      pl == null ? null : pl === 0 ? 0 : tot && tot > 0 ? round2((pl / tot) * 100) : null,
  };
}

// Ownership flow categories include shape — the OwnershipScore + its 4 flow lanes.
type OwnershipScoreRel = {
  baseline: unknown;
  baselineReason: string;
  pledgingAdjustment: unknown;
  penaltyR2: unknown;
  penaltyR6: unknown;
  penaltyProlongedFii: unknown;
  primarySubtotal: unknown;
  flowAdjustmentRaw: unknown;
  flowAdjustmentClamped: unknown;
  finalOwnership: unknown;
  r1Fired: boolean;
  r1TriggeringValues: unknown;
  flowCategories: {
    category: string;
    categoryState: string;
    rawSubScore: unknown;
    capApplied: unknown;
    cappedSubScore: unknown;
    bandLanded: string | null;
    netFlowValue: unknown;
    trendState: string | null;
  }[];
};

/** Map the OwnershipScore's flow lanes → FlowCategoryView[], sorted A→B→C→D so the
 *  4 lanes are stable; dormant lanes (C_insider/D_block) are CARRIED with their
 *  categoryState, never dropped or zeroed-away. (Same mapping as health-view.) */
function mapFlows(os: OwnershipScoreRel): FlowCategoryView[] {
  return [...os.flowCategories]
    .sort((a, b) => a.category.localeCompare(b.category))
    .map(
      (fc): FlowCategoryView => ({
        category: fc.category as FlowCategoryView["category"],
        categoryState: fc.categoryState as FlowCategoryView["categoryState"],
        rawSubScore: num(fc.rawSubScore),
        capApplied: num(fc.capApplied),
        cappedSubScore: num(fc.cappedSubScore),
        bandLanded: fc.bandLanded,
        netFlowValue: numN(fc.netFlowValue),
        trendState: (fc.trendState as FlowCategoryView["trendState"]) ?? null,
      }),
    );
}

type ShpRow = {
  asOnDate: Date;
  sourceDate: Date;
  fiscalYear: string;
  quarter: string;
  promoterPct: unknown;
  fiiPct: unknown;
  diiPct: unknown;
  retailPct: unknown;
  othersPct: unknown;
  pledgedShares: bigint | null;
  promoterShares: bigint | null;
  totalShares: bigint | null;
};

/**
 * The ownership-over-time view for one stock. Returns null only when the symbol is
 * unknown; an existing-but-unscored stock returns scored:false with empty series.
 */
export async function buildOwnershipView(
  symbol: string,
  windowQuarters: number,
): Promise<OwnershipSeriesView | null> {
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true, symbol: true, name: true },
  });
  if (!stock) return null;

  const refs = await getInForceSeriesRefs(stock.id, windowQuarters);
  // The ledger (holding split, pledging, insider, block) is RAW data and must surface
  // whenever its rows exist — independent of whether a scored period exists. Only the
  // score-derived overlay (flow-lane sub-scores, baseline/penalties, R1 verdict) needs a
  // scored period. `hasScoredPeriod` lets the UI gate the score-only sections without
  // blanking the whole tab.
  const hasScoredPeriod = refs.length > 0;

  // 1 query: the in-force snapshots in the window, each with its ownership pillar →
  // OwnershipScore → flow categories.
  const ids = refs.map((r) => r.id);
  const snaps = ids.length
    ? await prisma.scoreSnapshot.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          ownershipPillar: {
            select: { ownershipScore: { include: { flowCategories: true } } },
          },
        },
      })
    : [];
  const osById = new Map<string, OwnershipScoreRel | null>(
    snaps.map((s) => [s.id, (s.ownershipPillar?.ownershipScore as OwnershipScoreRel | null) ?? null]),
  );

  // 1 query: all shareholding observations for the stock, ascending (point-in-time scan).
  const shp = (await prisma.shareholdingPattern.findMany({
    where: { stockId: stock.id },
    orderBy: { asOnDate: "asc" },
    select: {
      asOnDate: true,
      sourceDate: true,
      fiscalYear: true,
      quarter: true,
      promoterPct: true,
      fiiPct: true,
      diiPct: true,
      retailPct: true,
      othersPct: true,
      pledgedShares: true,
      promoterShares: true,
      totalShares: true,
    },
  })) as ShpRow[];

  // one ShareholdingPattern row → the canonical holding split (pure raw data).
  const rowHolding = (r: ShpRow): OwnershipHolding => {
    const ratios = pledgeRatios(r.pledgedShares, r.promoterShares, r.totalShares);
    return {
      asOnDate: ymd(r.asOnDate),
      promoterPct: numN(r.promoterPct),
      fiiPct: numN(r.fiiPct),
      diiPct: numN(r.diiPct),
      retailPct: numN(r.retailPct),
      othersPct: numN(r.othersPct),
      ...ratios,
    };
  };

  // point-in-time: latest observation with asOnDate ≤ the period's asOfDate.
  const holdingAsOf = (d: Date): OwnershipHolding | null => {
    let pick: ShpRow | null = null;
    for (const r of shp) {
      if (r.asOnDate.getTime() <= d.getTime()) pick = r;
      else break; // shp is ascending — no later row can qualify
    }
    return pick ? rowHolding(pick) : null;
  };

  // Normalize a ShareholdingPattern's fy/quarter into the canonical "FY26Q4" periodKey.
  const periodKeyOf = (fy: string, q: string): string =>
    `${fy.startsWith("FY") ? fy : `FY${fy}`}${q.startsWith("Q") ? q : `Q${q}`}`;

  // The holding/flow series. When scored, map the in-force snapshots (existing behaviour
  // unchanged — flow lanes + point-in-time holding). When UNSCORED, build the series from
  // the raw ShareholdingPattern rows directly so the holding split, trends and pledge
  // stats still surface; score fields are zeroed and flowCategories empty (the UI reads
  // only `holding` + `periodKey` off series points, and quiet-empties the score sections).
  const series: OwnershipSeriesPoint[] = hasScoredPeriod
    ? refs.map((ref) => {
        const os = osById.get(ref.id) ?? null;
        return {
          periodKey: ref.periodKey,
          asOfDate: ymd(ref.asOfDate),
          baseline: os ? num(os.baseline) : 0,
          pledgingAdjustment: os ? num(os.pledgingAdjustment) : 0,
          primarySubtotal: os ? num(os.primarySubtotal) : 0,
          flowAdjustmentClamped: os ? num(os.flowAdjustmentClamped) : 0,
          finalOwnership: os ? num(os.finalOwnership) : 0,
          r1Fired: os?.r1Fired ?? false,
          flowCategories: os ? mapFlows(os) : [],
          holding: holdingAsOf(ref.asOfDate),
        };
      })
    : shp.slice(-Math.max(windowQuarters, 1)).map((r) => ({
        periodKey: periodKeyOf(r.fiscalYear, r.quarter),
        asOfDate: ymd(r.asOnDate),
        baseline: 0,
        pledgingAdjustment: 0,
        primarySubtotal: 0,
        flowAdjustmentClamped: 0,
        finalOwnership: 0,
        r1Fired: false,
        flowCategories: [],
        holding: rowHolding(r),
      }));

  // ── raw insider + block events (window-aware, newest-first, capped at 25) ──────────
  const today = new Date();
  const windowStart = new Date(today.getTime() - windowQuarters * 91 * 24 * 60 * 60 * 1000);

  const insiderRows = await prisma.insiderTrade.findMany({
    where: { stockId: stock.id, tradeDate: { gte: windowStart, lte: today } },
    select: {
      tradeDate: true,
      personName: true,
      personCategory: true,
      transactionType: true,
      securitiesTraded: true,
      holdingPctDelta: true,
      tradeValueCr: true,
      acquisitionMode: true,
      regulation: true,
    },
    orderBy: { tradeDate: "desc" },
    take: 25,
  });

  const blockRows = await prisma.blockDeal.findMany({
    where: { stockId: stock.id, dealDate: { gte: windowStart, lte: today } },
    select: {
      dealDate: true,
      dealType: true,
      clientName: true,
      transactionType: true,
      quantity: true,
      price: true,
      valueCr: true,
    },
    orderBy: { dealDate: "desc" },
    take: 25,
  });

  const insider: InsiderEvent[] = insiderRows.map((r) => ({
    tradeDate: r.tradeDate ? ymd(r.tradeDate) : null,
    personName: r.personName,
    personCategory: r.personCategory,
    transactionType: r.transactionType,
    securitiesTraded: r.securitiesTraded != null ? r.securitiesTraded.toString() : null,
    holdingPctDelta: numN(r.holdingPctDelta),
    tradeValueCr: numN(r.tradeValueCr),
    acquisitionMode: r.acquisitionMode,
    regulation: r.regulation,
  }));

  const block: BlockEvent[] = blockRows.map((r) => ({
    dealDate: ymd(r.dealDate),
    dealType: r.dealType,
    clientName: r.clientName,
    transactionType: r.transactionType,
    quantity: r.quantity.toString(),
    price: num(r.price),
    valueCr: numN(r.valueCr),
  }));

  // pledging series — the raw observations within the window (asOnDate ≤ latest period).
  const latestAsOf = refs.length ? refs[refs.length - 1].asOfDate : null;
  const pledging: PledgingPoint[] = (latestAsOf
    ? shp.filter((r) => r.asOnDate.getTime() <= latestAsOf.getTime())
    : shp
  )
    .slice(-Math.max(windowQuarters, 1))
    .map((r) => ({
      asOnDate: ymd(r.asOnDate),
      sourceDate: ymd(r.sourceDate),
      fiscalYear: r.fiscalYear,
      quarter: r.quarter,
      ...pledgeRatios(r.pledgedShares, r.promoterShares, r.totalShares),
      pledgedShares: r.pledgedShares != null ? r.pledgedShares.toString() : null,
      promoterShares: r.promoterShares != null ? r.promoterShares.toString() : null,
      totalShares: r.totalShares != null ? r.totalShares.toString() : null,
    }));

  // current anatomy — the latest in-force period's full ownership detail. When scored,
  // it's the scored snapshot (unchanged). When UNSCORED but shareholding exists, it's
  // synthesized from the latest raw ShareholdingPattern: real `holding` (so the donut,
  // pledge stats and R1 inputs render), score fields zeroed and flowCategories empty.
  // It stays null only when there is no shareholding at all.
  const latestRef = refs.length ? refs[refs.length - 1] : null;
  const cos = latestRef ? osById.get(latestRef.id) ?? null : null;
  const latestShp = shp.length ? shp[shp.length - 1] : null;
  const current: OwnershipAnatomy | null =
    latestRef && cos
      ? {
          periodKey: latestRef.periodKey,
          asOfDate: ymd(latestRef.asOfDate),
          baseline: num(cos.baseline),
          baselineReason: cos.baselineReason,
          pledgingAdjustment: num(cos.pledgingAdjustment),
          penalties: {
            r2: num(cos.penaltyR2),
            r6: num(cos.penaltyR6),
            prolongedFii: num(cos.penaltyProlongedFii),
          },
          primarySubtotal: num(cos.primarySubtotal),
          flowAdjustmentRaw: num(cos.flowAdjustmentRaw),
          flowAdjustmentClamped: num(cos.flowAdjustmentClamped),
          finalOwnership: num(cos.finalOwnership),
          r1Fired: cos.r1Fired,
          r1TriggeringValues: cos.r1TriggeringValues ?? null,
          flowCategories: mapFlows(cos),
          holding: holdingAsOf(latestRef.asOfDate),
        }
      : latestShp
        ? {
            periodKey: periodKeyOf(latestShp.fiscalYear, latestShp.quarter),
            asOfDate: ymd(latestShp.asOnDate),
            baseline: 0,
            baselineReason: "",
            pledgingAdjustment: 0,
            penalties: { r2: 0, r6: 0, prolongedFii: 0 },
            primarySubtotal: 0,
            flowAdjustmentRaw: 0,
            flowAdjustmentClamped: 0,
            finalOwnership: 0,
            r1Fired: false,
            r1TriggeringValues: null,
            flowCategories: [],
            holding: rowHolding(latestShp),
          }
        : null;

  return {
    symbol: stock.symbol,
    name: stock.name,
    windowQuarters,
    // `scored` keeps its original meaning — a scored period exists (was series-presence
    // back when series was built only from scored refs). `hasScoredPeriod` is the explicit
    // alias the UI gates the score-only sections on, decoupled from ledger-data presence.
    scored: hasScoredPeriod,
    hasScoredPeriod,
    series,
    pledging,
    current,
    events: { insider, block },
  };
}
