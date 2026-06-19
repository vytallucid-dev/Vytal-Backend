// File: src/scoring/composite/score-pass.ts
//
// THE 4-PILLAR SCORING-PASS ORCHESTRATOR — computes and (optionally) PERSISTS the
// complete Health Score for a peer group: Foundation + Momentum (committed bars,
// 3-lens) + universal Market (cleaned prices) + Ownership (Primary + Flow + clamp),
// blended into the composite, labelled, and stamped as a ScoreSnapshot.
//
// WRITE ORDER (FK-safe): ScoringSpecVersion + ScoringRun + BandMappingVersion
//   → PillarScore ×4 (+ MetricScore / MarketSubScore / OwnershipScore children)
//   → ScoreSnapshot (refs the 4 pillar FKs) → R1 RedFlag (refs the snapshot).
//
// IDEMPOTENT (ruling 2/3): each PillarScore is get-or-created on its
// (stockId, pillar, inputsFingerprint) identity; the ScoreSnapshot is skipped when
// an identical-fingerprint row already exists, and version-bumped (supersede chain)
// when inputs genuinely changed. Re-running scoring never duplicates.
//
// §14.4 (CN-6): a Market-EXCLUDED stock (VEDL quarantine / LTIM no-price) still gets
// a Market PillarScore (state unavailable_redistributed, inert-0 subtotal) + all 7
// MarketSubScore rows recording each exclusion, and an honest 3-pillar snapshot
// (wMarket=0, reason market_unavailable). Never a silent zero / fabricated Market.
//
// TX-INJECTABLE: all reads+writes run on a passed Prisma.TransactionClient, so the
// caller owns the transaction (Stage-3 proof writes then ROLLS BACK; Stage-4 commits
// per-PG). PURE row shapes come from the layer mappers — no reshaping here.

import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../db/prisma.js";
import { loadFoundationStandalone, loadMomentumStandalone } from "../metrics/load.js";
import { loadBankingCtx } from "../metrics/banking-load.js";
import { bankingSeriesForKey } from "../metrics/banking.js";
import type { BankingCtx } from "../metrics/banking-types.js";
import { dispatchLiveValues } from "../metric-scoring/live-dispatch.js";
import { loadBarSet, resolveBarPath } from "../metric-scoring/bars.js";
import { canonicalMetric, type IndustryType } from "../bars-loader/label-map.js";
import { scoreMetricCrossSection, type CrossSectionMember } from "../metric-scoring/wire.js";
import { NO_SUPPRESSION, type WiringConfig, type ScoredMetric } from "../metric-scoring/types.js";
import { assemblePillar } from "../pillars/assemble.js";
import type { PillarScoreResult } from "../pillars/types.js";
import { toPillarScoreRow } from "../pillars/persist.js";
import { toMetricScoreRow } from "../metric-scoring/persist.js";
import { metricWeightColumnsByKey, completeMetricScoreRow } from "../pillars/persist.js";
import type { FoundationAnnual, MomentumQuarter, MetricValue } from "../metrics/types.js";
import { scoreMarketForPg, type MemberMarket } from "../market/orchestrate.js";
import type { MarketUniversalResult } from "../market/market-universal.js";
import { toMarketPillarScoreRow, marketSubScoreRows, marketInputsFingerprint } from "../market/persist.js";
import { computeOwnership, type OwnershipContext, type OwnershipResult } from "../ownership/ownership.js";
import type { OwnershipQuarter } from "../ownership/types.js";
import { rangePositionAsOf, MIN_TRAILING_DAYS, type DailyClose } from "../price/range.js";
import type { A1PriceEval, FlowFeeds, PriceProbe } from "../ownership/flow.js";
import { FLOW_BAND_VERSION } from "../ownership/flow-bands.js";
import { fullInputsFingerprint, buildOwnershipScoreData, buildFlowCategoryRows, FLOW_BAND_CUTS } from "../ownership/persist.js";
import { assembleComposite } from "./composite.js";
import { bandMappingJson, BAND_MAPPING_VERSION } from "./label.js";
import { COMPOSITE_SPEC_VERSION, snapshotInputsFingerprint, toScoreSnapshotRow, toR1RedFlagRow } from "./persist.js";
import type { CompositeResult, Pillar, PillarInput } from "./types.js";

type Db = Prisma.TransactionClient;

const F_CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const M_CFG: WiringConfig = { peerMinN: 5, l3MinN: 6, l3Window: 12 };
const NO_FEEDS: FlowFeeds = { insiderTxns: null, blockTxns: null, marketCapInrCr: null };
const num = (d: any): number | null => (d == null ? null : typeof d.toNumber === "function" ? d.toNumber() : Number(d));

export interface PgRef { pgId: string; seedKey: string; pgName: string }

/** Build the Ownership price probe (52w-range dip detector) from RAW daily closes —
 *  the same probe the proven ownership path uses (A1 reads raw close, not cleaned). */
function makePriceProbe(series: DailyClose[]): PriceProbe {
  return (priorExcl: Date, currentIncl: Date): A1PriceEval => {
    const windowDays = series.filter((s) => s.date > priorExcl && s.date <= currentIncl);
    let assessedAny = false;
    for (const d of windowDays) {
      const rp = rangePositionAsOf(series, d.date);
      if (rp.trailingDays < MIN_TRAILING_DAYS) continue;
      assessedAny = true;
      if (rp.position === null) continue;
      if (rp.position <= 0.25) return { available: true, dipTouched: true, touchedOn: d.date.toISOString().slice(0, 10), positionAtTouch: rp.position, windowStartExclusive: priorExcl.toISOString().slice(0, 10), windowEndInclusive: currentIncl.toISOString().slice(0, 10) };
    }
    return { available: assessedAny, dipTouched: false, touchedOn: null, positionAtTouch: null, windowStartExclusive: priorExcl.toISOString().slice(0, 10), windowEndInclusive: currentIncl.toISOString().slice(0, 10) };
  };
}

/** Own-history series for L3 — re-dispatch the metric over each prefix of the rows. */
function seriesForKey(fRows: FoundationAnnual[], qRows: MomentumQuarter[], key: string, pillar: "foundation" | "momentum"): number[] {
  const out: number[] = [];
  const rows = pillar === "foundation" ? [...fRows].sort((a, b) => a.fyOrdinal - b.fyOrdinal) : [...qRows].sort((a, b) => a.qOrdinal - b.qOrdinal);
  for (let i = 0; i < rows.length; i++) {
    const slice = rows.slice(0, i + 1);
    const d = dispatchLiveValues({ industryType: "non_financial", foundationKeys: pillar === "foundation" ? [key] : [], momentumKeys: pillar === "momentum" ? [key] : [], foundationRows: pillar === "foundation" ? (slice as FoundationAnnual[]) : [], momentumQuarters: pillar === "momentum" ? (slice as MomentumQuarter[]) : [] });
    const arr = d.status === "computed" ? (pillar === "foundation" ? d.foundation : d.momentum) : [];
    if (arr[0]?.available && arr[0].value !== null) out.push(arr[0].value);
  }
  return out;
}

// ── COMPUTE (pure-ish: reads DB inputs, computes results; no score writes) ──────────
export interface MemberComputed {
  stockId: string; symbol: string;
  fPillar: PillarScoreResult; fMetrics: ScoredMetric[]; fBarSetIds: Map<string, string | null>;
  mPillar: PillarScoreResult; mMetrics: ScoredMetric[]; mBarSetIds: Map<string, string | null>;
  market: MarketUniversalResult | null; marketSourcePeriod: string;
  own: OwnershipResult | null;
  composite: CompositeResult;
}
export interface PgComputed { ref: PgRef; peerGroupId: string; asOf: Date; periodKey: string; industry: IndustryType; members: MemberComputed[] }

export interface ComputeOpts {
  /** Non-destructive roster OVERRIDE (symbols) — score this exact member set instead
   *  of the DB roster, WITHOUT touching peer_group_stocks. Used for the banking dry
   *  run to score the bar-derivation cohort (PG5 incl FEDERALBNK) before the roster is
   *  reconciled. Members are resolved by symbol; order is preserved. */
  rosterOverride?: string[];
}

export async function computePgScores(ref: PgRef, opts: ComputeOpts = {}): Promise<PgComputed> {
  const pgRow = await prisma.peerGroup.findFirst({ where: { name: ref.pgName }, include: { stocks: { include: { stock: { select: { id: true, symbol: true } } } } } });
  if (!pgRow) throw new Error(`computePgScores: PG '${ref.pgName}' not found`);

  // Universal Market for the whole PG (peer pool from the reconciled roster).
  const pgMkt = await scoreMarketForPg(ref.pgName);
  const mktBySym = new Map<string, MemberMarket>((pgMkt?.members ?? []).map((m) => [m.symbol, m]));
  const marketAsOf = pgMkt?.asOf ?? new Date();
  const marketSourcePeriod = `PRICE:${marketAsOf.toISOString().slice(0, 10)}`;
  // Scoring as-of = NOW: loadBarSet resolves the in-force committed bars (inForceFrom ≤
  // asOf — the bars went in-force at commit, ~2026-06-18, AFTER the latest price date),
  // and it stamps the snapshot/pillar asOfDate. The Market price reference date is kept
  // separately as the Market pillar's sourcePeriod (PRICE:<date>).
  const asOf = new Date();

  // Which metric keys this PG actually has committed bars for. resolveBarPath follows
  // PG6→PG5 inheritance so an inheriting bank PG finds the parent's keys.
  const barPath = resolveBarPath(ref.pgId);
  const keyRows = await prisma.metricBarSet.findMany({ where: { barPath }, select: { metricKey: true }, distinct: ["metricKey"] });
  const allKeys = keyRows.map((r) => r.metricKey);
  // Industry-aware pillar classification via the engine registry (NOT an F/M prefix —
  // banking keys are Tier1/GNPA/…/NIM, classified by canonicalMetric.pillar).
  const fKeys = allKeys.filter((k) => canonicalMetric(k)?.pillar === "foundation").sort();
  const mKeys = allKeys.filter((k) => canonicalMetric(k)?.pillar === "momentum").sort();
  const industry: IndustryType = canonicalMetric(fKeys[0] ?? mKeys[0] ?? "")?.industry ?? "non_financial";

  // Member set: DB roster, or a non-destructive symbol override (resolved directly).
  let memberStocks: { id: string; symbol: string }[];
  if (opts.rosterOverride && opts.rosterOverride.length) {
    const found = await prisma.stock.findMany({ where: { symbol: { in: opts.rosterOverride } }, select: { id: true, symbol: true } });
    const bySym = new Map(found.map((s) => [s.symbol, s]));
    memberStocks = opts.rosterOverride.map((sym) => bySym.get(sym)).filter((s): s is { id: string; symbol: string } => !!s);
  } else {
    memberStocks = pgRow.stocks.map((sp) => ({ id: sp.stock.id, symbol: sp.stock.symbol }));
  }

  // Per-member: raw daily/ownership (universal) + the live metric values + an L3
  // own-history accessor. The live path branches on industry; everything downstream
  // (cross-section, pillars, market, ownership, composite) is industry-agnostic.
  interface Raw {
    stockId: string; symbol: string; daily: DailyClose[]; own: OwnershipQuarter[];
    foundation: MetricValue[]; momentum: MetricValue[]; snapshotFy: string | null; snapshotQuarter: string | null;
    seriesFor: (key: string, pillar: "foundation" | "momentum") => number[];
  }
  const raws: Raw[] = [];
  for (const ms of memberStocks) {
    const id = ms.id, symbol = ms.symbol;
    const daily = (await prisma.dailyPrice.findMany({ where: { stockId: id }, orderBy: { date: "asc" }, select: { date: true, close: true } })).map((d) => ({ date: d.date, close: Number(d.close) }));
    const sh = await prisma.shareholdingPattern.findMany({ where: { stockId: id }, orderBy: { asOnDate: "asc" }, select: { asOnDate: true, quarter: true, fiscalYear: true, promoterShares: true, totalShares: true, pledgedShares: true, promoterPct: true, fiiPct: true, diiPct: true, retailPct: true } });
    const own: OwnershipQuarter[] = sh.map((r) => ({ asOnDate: r.asOnDate, quarter: r.quarter, fiscalYear: r.fiscalYear, promoterShares: r.promoterShares, totalShares: r.totalShares, pledgedShares: r.pledgedShares, promoterPct: num(r.promoterPct), fiiPct: num(r.fiiPct), diiPct: num(r.diiPct), retailPct: num(r.retailPct) }));

    let foundation: MetricValue[], momentum: MetricValue[], snapshotFy: string | null, snapshotQuarter: string | null;
    let seriesFor: (key: string, pillar: "foundation" | "momentum") => number[];
    if (industry === "banking") {
      const ctx: BankingCtx = await loadBankingCtx(symbol, id);
      const d = dispatchLiveValues({ industryType: "banking", foundationKeys: fKeys, momentumKeys: mKeys, foundationRows: [], momentumQuarters: [], bankingCtx: ctx });
      foundation = d.status === "computed" ? d.foundation : [];
      momentum = d.status === "computed" ? d.momentum : [];
      snapshotFy = d.status === "computed" ? d.snapshotFy : null;
      snapshotQuarter = d.status === "computed" ? d.snapshotQuarter : null;
      seriesFor = (key) => bankingSeriesForKey(ctx, key);
    } else {
      const fRows = await loadFoundationStandalone(id);
      const qRows = await loadMomentumStandalone(id);
      const d = dispatchLiveValues({ industryType: "non_financial", foundationKeys: fKeys, momentumKeys: mKeys, foundationRows: fRows, momentumQuarters: qRows });
      foundation = d.status === "computed" ? d.foundation : [];
      momentum = d.status === "computed" ? d.momentum : [];
      snapshotFy = d.status === "computed" ? d.snapshotFy : null;
      snapshotQuarter = d.status === "computed" ? d.snapshotQuarter : null;
      seriesFor = (key, pillar) => seriesForKey(fRows, qRows, key, pillar);
    }
    raws.push({ stockId: id, symbol, daily, own, foundation, momentum, snapshotFy, snapshotQuarter, seriesFor });
  }

  const fSnap = raws[0]?.snapshotFy ?? "FY";
  const mSnap = raws[0]?.snapshotQuarter ?? "FYQ";

  // Cross-section score F/M per key.
  const fMetrics = new Map<string, ScoredMetric[]>(); const mMetrics = new Map<string, ScoredMetric[]>();
  const fBarSetIds = new Map<string, string | null>(); const mBarSetIds = new Map<string, string | null>();
  for (const r of raws) { fMetrics.set(r.symbol, []); mMetrics.set(r.symbol, []); }
  const scorePillarKeys = async (keys: string[], pillar: "foundation" | "momentum", bucket: Map<string, ScoredMetric[]>, ids: Map<string, string | null>, cfg: WiringConfig, snap: string) => {
    for (const key of keys) {
      const bs = await loadBarSet(ref.pgId, key, asOf);
      if (!bs) continue;
      ids.set(key, bs.metricBarSetId ?? null);
      const xsMembers: CrossSectionMember[] = raws.map((r) => {
        const arr = pillar === "foundation" ? r.foundation : r.momentum;
        const mv = arr.find((x) => x.key === key); const avail = !!mv && mv.available && mv.value !== null;
        return { stockId: r.stockId, symbol: r.symbol, rawValue: avail ? mv!.value : null, available: avail, unavailableReason: avail ? null : (mv?.reason ?? "no value"), ownHistoryValues: r.seriesFor(key, pillar) };
      });
      const xs = scoreMetricCrossSection({ pillar, metricKey: key, label: key, snapshot: snap, direction: bs.direction, bars: bs.bars, barNote: bs.note, sscu: bs.sscu ? { bars: bs.sscu.bars, scope: bs.sscu.scope } : null, members: xsMembers, suppression: NO_SUPPRESSION, config: cfg });
      for (const s of xs.scored) bucket.get(s.symbol)!.push(s);
    }
  };
  await scorePillarKeys(fKeys, "foundation", fMetrics, fBarSetIds, F_CFG, fSnap);
  await scorePillarKeys(mKeys, "momentum", mMetrics, mBarSetIds, M_CFG, mSnap);

  const periodKey = mSnap || fSnap || "FY26Q4";
  const members: MemberComputed[] = raws.map((r) => {
    const fPillar = assemblePillar({ pillar: "foundation", stockId: r.stockId, symbol: r.symbol, snapshot: fSnap, metrics: fMetrics.get(r.symbol)! });
    const mPillar = assemblePillar({ pillar: "momentum", stockId: r.stockId, symbol: r.symbol, snapshot: mSnap, metrics: mMetrics.get(r.symbol)! });
    const market = mktBySym.get(r.symbol)?.result ?? null;
    const mktSub = market && market.state === "scored" ? market.subtotal : null;
    const ctx: OwnershipContext = { priceProbe: makePriceProbe(r.daily), feeds: NO_FEEDS };
    const own = r.own.length ? computeOwnership(r.symbol, r.own, ctx) : null;
    const latest = r.own[r.own.length - 1];
    const pillars: PillarInput[] = [
      { pillar: "foundation", subtotal: fPillar.subtotal, state: fPillar.pillarState, sourcePeriod: fSnap },
      { pillar: "momentum", subtotal: mPillar.subtotal, state: mPillar.pillarState, sourcePeriod: mSnap },
      { pillar: "market", subtotal: mktSub, state: mktSub != null ? "scored" : "unavailable_redistributed", sourcePeriod: mktSub != null ? marketSourcePeriod : "MARKET_EXCLUDED" },
      { pillar: "ownership", subtotal: own ? own.finalOwnership : null, state: own ? "scored" : "unavailable_redistributed", sourcePeriod: own?.snapshot.periodKey ?? "—" },
    ];
    const composite = assembleComposite(r.stockId, r.symbol, pillars, { snapshotType: "quarterly", periodKey, asOfDate: asOf });
    return { stockId: r.stockId, symbol: r.symbol, fPillar, fMetrics: fMetrics.get(r.symbol)!, fBarSetIds, mPillar, mMetrics: mMetrics.get(r.symbol)!, mBarSetIds, market, marketSourcePeriod, own, composite };
  });

  return { ref, peerGroupId: pgRow.id, asOf, periodKey, industry, members };
}

// ── SCAFFOLD (get-or-create spec / run / band-mapping, once per pass) ────────────────
export interface Scaffold { specVersionId: string; runId: string; bandMappingVersionId: string }
export async function ensureScaffold(db: Db, asOf: Date): Promise<Scaffold> {
  const spec = (await db.scoringSpecVersion.findFirst({ where: { version: COMPOSITE_SPEC_VERSION }, select: { id: true } }))
    ?? (await db.scoringSpecVersion.create({ data: { version: COMPOSITE_SPEC_VERSION, effectiveFrom: asOf, notes: "4-pillar Health Score scoring pass (Foundation+Momentum+universal Market+Ownership)." }, select: { id: true } }));
  const mapping = (await db.bandMappingVersion.findFirst({ where: { version: BAND_MAPPING_VERSION }, select: { id: true } }))
    ?? (await db.bandMappingVersion.create({ data: { version: BAND_MAPPING_VERSION, mapping: bandMappingJson(), effectiveFrom: asOf }, select: { id: true } }));
  const run = await db.scoringRun.create({ data: { runType: "quarterly", triggerType: "manual_api", specVersionId: spec.id, asOfDate: asOf, status: "running", startedAt: asOf }, select: { id: true } });
  return { specVersionId: spec.id, runId: run.id, bandMappingVersionId: mapping.id };
}

export async function finalizeRun(db: Db, runId: string, stocksScored: number, finishedAt: Date): Promise<void> {
  await db.scoringRun.update({ where: { id: runId }, data: { status: "success", finishedAt, stocksScored } });
}

// ── PERSIST one member (4 pillars + children + snapshot + R1) on the passed db ──────
export interface MemberWriteResult {
  symbol: string;
  action: "created" | "skipped_identical" | "unavailable_no_snapshot";
  snapshotId: string | null;
  composite: number | null;
  band: string | null;
  marketState: "scored" | "unavailable_redistributed" | "none";
  r1Written: boolean;
  pillarIds: Partial<Record<Pillar, string>>;
}

/** Get-or-create a Foundation/Momentum PillarScore (+ MetricScore children via nested create). */
async function writeFmPillar(db: Db, r: PillarScoreResult, metrics: ScoredMetric[], barSetIds: Map<string, string | null>, ctx: { runId: string; specVersionId: string; asOfDate: Date; sourcePeriod: string }): Promise<string> {
  const row = toPillarScoreRow(r, ctx);
  const existing = await db.pillarScore.findUnique({ where: { score_pillar_input_identity: { stockId: r.stockId, pillar: r.pillar, inputsFingerprint: row.inputsFingerprint } }, select: { id: true } });
  if (existing) return existing.id;
  const weights = metricWeightColumnsByKey(r);
  // A MetricScore row requires a non-null rawValue + metricScore (NOT NULL columns).
  // A dropped/missing/suppressed metric (scoreState ≠ scored) has no rawValue → it is
  // row-ABSENCE, the documented convention (its 0 effective-weight is reconstructable
  // from the pillar's subtotal + present rows). Only scored metrics get rows.
  const children = metrics
    .filter((s) => s.scoreState === "scored")
    .map((s) => {
      const full = completeMetricScoreRow(toMetricScoreRow(s, { pillarScoreId: "", peerStatsSnapshotId: null, metricBarSetId: barSetIds.get(s.metricKey) ?? null }), weights);
      const { pillarScoreId: _omit, ...child } = full;
      return child;
    }) as Prisma.MetricScoreCreateWithoutPillarScoreInput[];
  const created = await db.pillarScore.create({ data: { ...row, metricScores: { create: children } }, select: { id: true } });
  return created.id;
}

/** Get-or-create the Market PillarScore (+ all 7 MarketSubScore children, CN-6). */
async function writeMarketPillar(db: Db, market: MarketUniversalResult, stockId: string, symbol: string, ctx: { runId: string; specVersionId: string; asOfDate: Date; sourcePeriod: string }): Promise<string> {
  const row = toMarketPillarScoreRow(market, { stockId, symbol, runId: ctx.runId, specVersionId: ctx.specVersionId, asOfDate: ctx.asOfDate, sourcePeriod: ctx.sourcePeriod });
  const existing = await db.pillarScore.findUnique({ where: { score_pillar_input_identity: { stockId, pillar: "market", inputsFingerprint: row.inputsFingerprint } }, select: { id: true } });
  if (existing) return existing.id;
  const subs = marketSubScoreRows(market);
  const created = await db.pillarScore.create({ data: { ...row, marketSubScores: { create: subs } }, select: { id: true } });
  return created.id;
}

/** Get-or-create the Ownership PillarScore (+ OwnershipScore + 4 flow categories). */
async function writeOwnershipPillar(db: Db, own: OwnershipResult, stockId: string, symbol: string, ctx: { runId: string; specVersionId: string; asOfDate: Date }): Promise<{ id: string; r1Fired: boolean; r1Triggering: Record<string, unknown> | null }> {
  const fp = fullInputsFingerprint(own);
  const { ownershipScore, r1Fired, r1TriggeringValues } = buildOwnershipScoreData(own);
  const existing = await db.pillarScore.findUnique({ where: { score_pillar_input_identity: { stockId, pillar: "ownership", inputsFingerprint: fp } }, select: { id: true } });
  if (existing) return { id: existing.id, r1Fired, r1Triggering: r1TriggeringValues };

  // get-or-create the 3 universal flow band sets
  const bandSetIds: Record<string, string> = {};
  for (const bt of ["c_net_insider", "d_net_block", "trend_bonus"] as const) {
    const ex = await db.ownershipFlowBandSet.findUnique({ where: { bandType_version: { bandType: bt, version: FLOW_BAND_VERSION } }, select: { id: true } });
    bandSetIds[bt] = ex?.id ?? (await db.ownershipFlowBandSet.create({ data: { bandType: bt, version: FLOW_BAND_VERSION, cuts: FLOW_BAND_CUTS[bt] as object, inForceFrom: ctx.asOfDate, specVersionId: ctx.specVersionId }, select: { id: true } })).id;
  }
  const flowRows = buildFlowCategoryRows(own);
  const created = await db.pillarScore.create({
    data: {
      stockId, symbol, pillar: "ownership", subtotal: own.finalOwnership, pillarState: "scored", sourcePeriod: own.snapshot.periodKey, asOfDate: ctx.asOfDate, runId: ctx.runId, specVersionId: ctx.specVersionId, inputsFingerprint: fp,
      ownershipScore: {
        create: {
          ...ownershipScore,
          r1TriggeringValues: (r1TriggeringValues ?? undefined) as object | undefined,
          flowCategories: { create: flowRows.map((c) => ({ category: c.category, rawSubScore: c.rawSubScore, capApplied: c.capApplied, cappedSubScore: c.cappedSubScore, categoryState: c.categoryState, bandLanded: c.bandLanded, netFlowValue: c.netFlowValue, trendState: c.trendState, flowBandSetId: c.bandType ? bandSetIds[c.bandType] : null })) },
        },
      },
    },
    select: { id: true },
  });
  return { id: created.id, r1Fired, r1Triggering: r1TriggeringValues };
}

export async function persistMember(db: Db, m: MemberComputed, sc: Scaffold, asOf: Date, peerGroupId: string, barPath: string, industryPath: IndustryType = "non_financial"): Promise<MemberWriteResult> {
  // Unavailable composite → no snapshot (recorded, never fabricated). For these
  // rosters this is not expected (Market may drop, but composite still 3-pillar-scores).
  if (m.composite.state !== "scored" || m.composite.composite === null) {
    return { symbol: m.symbol, action: "unavailable_no_snapshot", snapshotId: null, composite: null, band: null, marketState: m.market ? m.market.state : "none", r1Written: false, pillarIds: {} };
  }

  // Skip-identical at the snapshot level (ruling 3).
  const fp = snapshotInputsFingerprint(m.composite);
  const existingSnap = await db.scoreSnapshot.findUnique({ where: { stockId_snapshotType_periodKey_version: { stockId: m.stockId, snapshotType: m.composite.snapshotType, periodKey: m.composite.periodKey, version: 1 } }, select: { id: true, inputsFingerprint: true, version: true } });
  if (existingSnap && existingSnap.inputsFingerprint === fp) {
    return { symbol: m.symbol, action: "skipped_identical", snapshotId: existingSnap.id, composite: m.composite.composite, band: m.composite.labelBand, marketState: m.market ? m.market.state : "none", r1Written: false, pillarIds: {} };
  }

  // Write the 4 pillars (get-or-create), resolving the FKs the snapshot needs.
  const pillarCtxFm = (sourcePeriod: string) => ({ runId: sc.runId, specVersionId: sc.specVersionId, asOfDate: asOf, sourcePeriod });
  const foundationId = await writeFmPillar(db, m.fPillar, m.fMetrics, m.fBarSetIds, pillarCtxFm(m.fPillar.snapshot));
  const momentumId = await writeFmPillar(db, m.mPillar, m.mMetrics, m.mBarSetIds, pillarCtxFm(m.mPillar.snapshot));
  // Market: a Market-excluded stock still gets a (state unavailable_redistributed) pillar + 7 sub rows.
  if (!m.market) throw new Error(`persistMember: ${m.symbol} has no Market result — orchestrate.scoreMarketForPg must return every roster member`);
  const marketId = await writeMarketPillar(db, m.market, m.stockId, m.symbol, { runId: sc.runId, specVersionId: sc.specVersionId, asOfDate: asOf, sourcePeriod: m.market.state === "scored" ? m.marketSourcePeriod : "MARKET_EXCLUDED" });
  if (!m.own) throw new Error(`persistMember: ${m.symbol} has no Ownership result (no shareholding rows)`);
  const ownership = await writeOwnershipPillar(db, m.own, m.stockId, m.symbol, { runId: sc.runId, specVersionId: sc.specVersionId, asOfDate: asOf });

  const pillarScoreIds: Record<Pillar, string> = { foundation: foundationId, momentum: momentumId, market: marketId, ownership: ownership.id };
  const snapRow = toScoreSnapshotRow(m.composite, { runId: sc.runId, specVersionId: sc.specVersionId, bandMappingVersionId: sc.bandMappingVersionId, peerGroupId, barPath, industryPath, pillarScoreIds });
  if (existingSnap) { snapRow.version = existingSnap.version + 1; snapRow.supersedesId = existingSnap.id; } // append-only supersede on genuine change

  const snap = await db.scoreSnapshot.create({ data: snapRow, select: { id: true } });
  let r1Written = false;
  if (ownership.r1Fired) {
    await db.redFlag.create({ data: toR1RedFlagRow(snap.id, m.composite, ownership.r1Triggering) });
    r1Written = true;
  }

  return { symbol: m.symbol, action: "created", snapshotId: snap.id, composite: m.composite.composite, band: m.composite.labelBand, marketState: m.market.state, r1Written, pillarIds: pillarScoreIds };
}
