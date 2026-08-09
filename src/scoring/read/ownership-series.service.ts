// File: src/scoring/read/ownership-series.service.ts
//
// THE ownership-over-time assembler. ScoreSnapshot only carries the ownership
// SCALAR per period — the lanes (flow categories, holding split, pledging) need the
// pillar graph + ShareholdingPattern. This resolves the in-force snapshots for the
// window (reusing the supersede-aware resolver), loads each one's OwnershipScore →
// flow categories, and joins the POINT-IN-TIME holding split (latest shareholding
// with asOnDate ≤ the period's asOfDate — no lookahead).

import { prisma } from "../../db/prisma.js";
// `Prisma.join` builds the parameterised IN-list for the stage-3 join below — the ids are still
// bound, never interpolated, so the raw statement is no more injectable than the query builder was.
import { Prisma } from "../../generated/prisma/client.js";
import { getInForceSeriesRefs } from "./scoring-read.service.js";
import { ownershipTellOrNull } from "./ownership-tell.js";
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

/** One row of the stage-3 join — the OwnershipScore's columns repeated across its flow lanes.
 *  Every numeric arrives as the driver gives it (string for `numeric`); `num`/`numN` already accept
 *  that, which is why the fold hands these straight through rather than converting here. */
type OwnershipJoinRow = {
  snapshot_id: string;
  baseline: unknown;
  baseline_reason: unknown;
  pledging_adjustment: unknown;
  penalty_r2: unknown;
  penalty_r6: unknown;
  penalty_prolonged_fii: unknown;
  primary_subtotal: unknown;
  flow_adjustment_raw: unknown;
  flow_adjustment_clamped: unknown;
  final_ownership: unknown;
  r1_fired: unknown;
  r1_triggering_values: unknown;
  category: string | null;
  category_state: unknown;
  raw_sub_score: unknown;
  cap_applied: unknown;
  capped_sub_score: unknown;
  band_landed: string | null;
  net_flow_value: unknown;
  trend_state: string | null;
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

  // ── ★ THREE STAGES, NOT SIX ROUND-TRIPS IN A LINE ─────────────────────────────────────────────
  //
  // MEASURED BEFORE: 6 SQL round-trips, all 6 sequential, ~650 ms median warm. Only ONE of the six
  // waits on data — the ownership-pillar join needs the snapshot ids the in-force resolver returns.
  // The shareholding scan, the insider feed and the block feed each need nothing but `stock.id`, and
  // sat in the queue behind a resolver they have no relationship with. That is the same defect the
  // health endpoint carried (3.21 s → 0.92 s), and the same fix applies.
  //
  //   stage 1   stock.findUnique                                   (everything needs the id)
  //   stage 2   refs ‖ shareholding ‖ insider ‖ block              (no dependency between them)
  //   stage 3   the ownership-pillar join                          (needs refs)
  //
  // ⚠ THE ORDER OF THE THREE FEED READS IS NOT A DEPENDENCY, and the event window they use is
  //   computed here rather than inside the awaits so all four see one `today`. Two calls to
  //   `new Date()` a few hundred ms apart could otherwise put an event on one side of the cutoff for
  //   insiders and the other for blocks.
  const today = new Date();
  const windowStart = new Date(today.getTime() - windowQuarters * 91 * 24 * 60 * 60 * 1000);

  const [refs, shpRaw, insiderRows, blockRows] = await Promise.all([
    getInForceSeriesRefs(stock.id, windowQuarters),
    // all shareholding observations for the stock, ascending (point-in-time scan).
    prisma.shareholdingPattern.findMany({
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
    }),
    prisma.insiderTrade.findMany({
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
    }),
    prisma.blockDeal.findMany({
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
    }),
  ]);

  // The ledger (holding split, pledging, insider, block) is RAW data and must surface
  // whenever its rows exist — independent of whether a scored period exists. Only the
  // score-derived overlay (flow-lane sub-scores, baseline/penalties, R1 verdict) needs a
  // scored period. `hasScoredPeriod` lets the UI gate the score-only sections without
  // blanking the whole tab.
  const hasScoredPeriod = refs.length > 0;
  const shp = shpRaw as ShpRow[];

  // ── ★ STAGE 3 — ONE ROUND-TRIP, NOT FOUR. MEASURED. ─────────────────────────────────────────────
  //
  // This was `scoreSnapshot.findMany` with a nested `ownershipPillar → ownershipScore →
  // flowCategories` select, described in this file as "1 query". It is not one query: Prisma
  // resolves a nested relation select by walking the graph one LEVEL at a time, issuing a separate
  // statement per level and awaiting each before it can build the next level's id list. Timed at the
  // pg driver, this stage was FOUR statements in strict sequence — score_snapshots → score_pillars →
  // score_ownership → score_ownership_flows — and on a remote database the cost of a statement is
  // almost entirely its round trip:
  //
  //     stage 3, before   157→723 ms of a 725 ms read · 4 waves · 4 round-trips
  //     round-trip floor  ~65–70 ms (SELECT 1, warm pool, same link)
  //
  // Three of those four round-trips buy nothing but the next level's foreign keys, which SQL can
  // follow in the server. `$queryRaw` with three LEFT JOINs is one round-trip for the same rows.
  //
  // ⚠ LEFT JOINS, NOT INNER, BECAUSE ABSENCE IS A STATE HERE. A snapshot whose ownership pillar
  //   carries no OwnershipScore is normal (an out-of-scope pillar), and the nested select returned
  //   `null` for it rather than dropping the snapshot. An INNER JOIN would silently shorten the
  //   series instead — the same row would vanish from the chart with nothing to indicate it had.
  //
  // ⚠ AND THE ROW→OBJECT FOLD REPRODUCES THE NESTED SHAPE EXACTLY. A join multiplies the score row
  //   by its flow lanes, so the fold groups back on snapshot id and collects the lanes; a snapshot
  //   with a score but no lanes yields `flowCategories: []`, which is what the relation load gave.
  //   Proven equal, field by field, against the previous implementation across all 95 scored stocks.
  const ids = refs.map((r) => r.id);
  const joined = ids.length
    ? await prisma.$queryRaw<OwnershipJoinRow[]>`
        SELECT ss.id                     AS snapshot_id,
               os.baseline               AS baseline,
               os.baseline_reason        AS baseline_reason,
               os.pledging_adjustment    AS pledging_adjustment,
               os.penalty_r2             AS penalty_r2,
               os.penalty_r6             AS penalty_r6,
               os.penalty_prolonged_fii  AS penalty_prolonged_fii,
               os.primary_subtotal       AS primary_subtotal,
               os.flow_adjustment_raw    AS flow_adjustment_raw,
               os.flow_adjustment_clamped AS flow_adjustment_clamped,
               os.final_ownership        AS final_ownership,
               os.r1_fired               AS r1_fired,
               os.r1_triggering_values   AS r1_triggering_values,
               fc.category::text         AS category,
               fc.category_state::text   AS category_state,
               fc.raw_sub_score          AS raw_sub_score,
               fc.cap_applied            AS cap_applied,
               fc.capped_sub_score       AS capped_sub_score,
               fc.band_landed            AS band_landed,
               fc.net_flow_value         AS net_flow_value,
               fc.trend_state::text      AS trend_state
          FROM score_snapshots ss
          LEFT JOIN score_pillars sp          ON sp.id = ss.ownership_pillar_id
          LEFT JOIN score_ownership os        ON os.pillar_score_id = sp.id
          LEFT JOIN score_ownership_flows fc  ON fc.ownership_score_id = os.id
         WHERE ss.id IN (${Prisma.join(ids)})`
    : [];

  const osById = new Map<string, OwnershipScoreRel | null>();
  for (const r of joined) {
    if (r.baseline === null) {
      // the snapshot resolved, its ownership score did not — exactly the nested select's `null`.
      if (!osById.has(r.snapshot_id)) osById.set(r.snapshot_id, null);
      continue;
    }
    let os = osById.get(r.snapshot_id) ?? null;
    if (!os) {
      os = {
        baseline: r.baseline,
        baselineReason: r.baseline_reason as string,
        pledgingAdjustment: r.pledging_adjustment,
        penaltyR2: r.penalty_r2,
        penaltyR6: r.penalty_r6,
        penaltyProlongedFii: r.penalty_prolonged_fii,
        primarySubtotal: r.primary_subtotal,
        flowAdjustmentRaw: r.flow_adjustment_raw,
        flowAdjustmentClamped: r.flow_adjustment_clamped,
        finalOwnership: r.final_ownership,
        r1Fired: r.r1_fired as boolean,
        r1TriggeringValues: r.r1_triggering_values,
        flowCategories: [],
      };
      osById.set(r.snapshot_id, os);
    }
    if (r.category !== null) {
      os.flowCategories.push({
        category: r.category,
        categoryState: r.category_state as string,
        rawSubScore: r.raw_sub_score,
        capApplied: r.cap_applied,
        cappedSubScore: r.capped_sub_score,
        bandLanded: r.band_landed,
        netFlowValue: r.net_flow_value,
        trendState: r.trend_state,
      });
    }
  }

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
  // Both were fetched in stage 2 above, alongside the shareholding scan they never depended on.
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

  // ── THE TELL — the same classifier the landing scan ranks by, on the same inputs ────────────
  // The scan reads the two NEWEST shareholding rows for the stock plus the latest snapshot's
  // r1Fired; `shp` here is the same table, ascending, so its last two rows are those same two rows
  // and `current.r1Fired` is that same flag. Identical inputs, one function — see ownership-tell.ts.
  //
  // ⚠ Deltas are LATEST-vs-PRIOR FILING, deliberately NOT the window deltas the page's hero reads.
  //   They are two different questions ("what did the register just do" vs "what did it do across
  //   the window"), and the tell has always been the first one.
  const tellCur = shp.length ? shp[shp.length - 1] : null;
  const tellPrev = shp.length >= 2 ? shp[shp.length - 2] : null;
  const instOf = (r: ShpRow): number => (numN(r.fiiPct) ?? 0) + (numN(r.diiPct) ?? 0);
  const tell = tellCur
    ? ownershipTellOrNull(
        current?.r1Fired ?? false,
        pledgeRatios(tellCur.pledgedShares, tellCur.promoterShares, tellCur.totalShares)
          .pledgedPctOfPromoter,
        tellPrev != null,
        tellPrev ? round2(instOf(tellCur) - instOf(tellPrev)) : null,
        tellPrev ? round2((numN(tellCur.fiiPct) ?? 0) - (numN(tellPrev.fiiPct) ?? 0)) : null,
        tellPrev ? round2((numN(tellCur.diiPct) ?? 0) - (numN(tellPrev.diiPct) ?? 0)) : null,
      )
    : null;

  return {
    symbol: stock.symbol,
    name: stock.name,
    windowQuarters,
    tell,
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
