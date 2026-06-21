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
import type { PondHeat } from "../findings/section2/pond-heat.js";
import type { MarketUniversalResult } from "../market/market-universal.js";
import { toMarketPillarScoreRow, marketSubScoreRows, marketInputsFingerprint } from "../market/persist.js";
import { computeOwnership, type OwnershipContext, type OwnershipResult } from "../ownership/ownership.js";
import { loadFlowFeeds } from "../ownership/flow-feeds-load.js";
import type { OwnershipQuarter } from "../ownership/types.js";
import { rangePositionAsOf, MIN_TRAILING_DAYS, type DailyClose } from "../price/range.js";
import type { A1PriceEval, FlowFeeds, PriceProbe } from "../ownership/flow.js";
import { FLOW_BAND_VERSION } from "../ownership/flow-bands.js";
import { fullInputsFingerprint, buildOwnershipScoreData, buildFlowCategoryRows, FLOW_BAND_CUTS } from "../ownership/persist.js";
import { assembleComposite } from "./composite.js";
import { bandMappingJson, BAND_MAPPING_VERSION } from "./label.js";
import { COMPOSITE_SPEC_VERSION, snapshotInputsFingerprint, toScoreSnapshotRow, toR1RedFlagRow } from "./persist.js";
import type { CompositeResult, Pillar, PillarInput } from "./types.js";
// §2/§5 findings engine — the fire-and-persist contract. Hook runs AFTER composite
// assembly (reads the assembled pillars/composite/trajectory), emitting fired findings.
import { runFindings } from "../findings/engine.js";
import { opmSeriesFromQuarters, pillarMapOf } from "../findings/context.js";
import { persistFindings } from "../findings/persist.js";
import { loadTrajectorySeries } from "../findings/trajectory/load-series.js";
import { loadBandTypicalProfiles } from "../findings/composition/band-typical.js";
import { applyPgDampening, type DampenReport } from "../findings/dampen.js";
import type { FiredFinding, FiringContext } from "../findings/types.js";

type Db = Prisma.TransactionClient;

const F_CFG: WiringConfig = { peerMinN: 5, l3MinN: 5, l3Window: 10 };
const M_CFG: WiringConfig = { peerMinN: 5, l3MinN: 6, l3Window: 12 };
// Fallback only: a member with no shareholding has no ownership at all (own=null), so
// its feeds are never read. The LIVE C/D feeds come from loadFlowFeeds (see below).
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
  /** §2/§5 fired findings — present only when computePgScores ran with withFindings.
   *  undefined ⇒ the findings hook did not run (legacy/committed callers). */
  findings?: FiredFinding[];
  /** PG-level pond heat (File 1 §5 mask) — same value for every member of the PG (inherited).
   *  Stamped onto the member's snapshot by persistMember. undefined for legacy callers. */
  pondHeat?: PondHeat;
}
/** PG-level peer cross-section μ/σ/N for ONE F/M metric — captured from the same
 *  scoreMetricCrossSection output that produces each member's L2 (so the persisted
 *  μ/σ is exactly the distribution behind the committed l2Score; never recomputed).
 *  The suppression seam is honored upstream: xs.peerStats is computed over the common
 *  cross-section (peer-excluded values already removed in wire.ts). */
export interface PeerStatsCapture {
  pillar: "foundation" | "momentum";
  metricKey: string;
  barPath: string;
  mean: number;
  stdDev: number;
  sampleN: number;
  anchorLiftFired: boolean; // §5.3.1 collective lift decision
}
export interface PgComputed { ref: PgRef; peerGroupId: string; asOf: Date; periodKey: string; industry: IndustryType; members: MemberComputed[]; peerStats: PeerStatsCapture[]; dampenReport?: DampenReport }

export interface ComputeOpts {
  /** Non-destructive roster OVERRIDE (symbols) — score this exact member set instead
   *  of the DB roster, WITHOUT touching peer_group_stocks. Used for the banking dry
   *  run to score the bar-derivation cohort (PG5 incl FEDERALBNK) before the roster is
   *  reconciled. Members are resolved by symbol; order is preserved. */
  rosterOverride?: string[];
  /** POINT-IN-TIME BACKFILL context. When set, score a HISTORICAL period as if
   *  standing at its quarter-end: every raw input (F/M annual+quarterly, banking,
   *  shareholding, daily prices, Market windows) is restricted to reportDate/date ≤
   *  `quarterEnd`, so no future-period data can leak backward. The snapshot/pillar
   *  asOfDate is stamped at `quarterEnd`. BARS are the current committed calibration
   *  (resolved at "now") — per the task, the model/bars are not changed; only the
   *  raw inputs are point-in-time. `expectPeriodKey` asserts the period that emerges
   *  from the filtered momentum data matches the requested one. */
  pointInTime?: { quarterEnd: Date; expectPeriodKey: string };
  /** §2/§5 FINDINGS HOOK. When true, after composite assembly each member's FiringContext
   *  is built and the rule set is run; the fired findings are attached to MemberComputed
   *  .findings (PURE — no writes here). Default false so existing committed callers are
   *  byte-identical until the full rule set is validated + the live path opts in. The
   *  PERSIST of findings is separately gated (persistMember opts.writeFindings). */
  withFindings?: boolean;
}

export async function computePgScores(ref: PgRef, opts: ComputeOpts = {}): Promise<PgComputed> {
  const pgRow = await prisma.peerGroup.findFirst({ where: { name: ref.pgName }, include: { stocks: { include: { stock: { select: { id: true, symbol: true } } } } } });
  if (!pgRow) throw new Error(`computePgScores: PG '${ref.pgName}' not found`);

  // POINT-IN-TIME cutoff (backfill) — restricts every raw input to ≤ quarterEnd.
  const pit = opts.pointInTime ?? null;
  const cutoff: Date | undefined = pit?.quarterEnd;

  // Universal Market for the whole PG (peer pool from the reconciled roster). In a
  // point-in-time pass the Market windows end at the historical quarter-end (asOf
  // override); each sub-component already windows ≤ asOf, so no future price leaks.
  const pgMkt = await scoreMarketForPg(ref.pgName, cutoff);
  const mktBySym = new Map<string, MemberMarket>((pgMkt?.members ?? []).map((m) => [m.symbol, m]));
  const marketAsOf = pgMkt?.asOf ?? cutoff ?? new Date();
  const marketSourcePeriod = `PRICE:${marketAsOf.toISOString().slice(0, 10)}`;
  // BAR-RESOLUTION as-of = NOW: loadBarSet resolves the in-force committed bars
  // (inForceFrom ≤ barAsOf — bars went in-force at commit ~2026-06-18). Bars are the
  // model calibration and are NOT made point-in-time (task: do not change bars).
  const barAsOf = new Date();
  // STAMP as-of = the historical quarter-end in a backfill, else NOW. This is what the
  // snapshot/pillar asOfDate carries, so the trajectory orders correctly by period.
  const asOf = cutoff ?? new Date();

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
    /** Standalone quarterly rows (non-financial) — retained for the §5 findings hook
     *  (P11/P12 read the OPM series). Empty for banks (OPM is not a banking metric). */
    qRows: MomentumQuarter[];
    /** Standalone annual rows (non-financial) — §5 findings hook (R4 D/E history, P8
     *  receivables). Empty for banks (these annual rules are non-financial). */
    fRows: FoundationAnnual[];
  }
  const raws: Raw[] = [];
  for (const ms of memberStocks) {
    const id = ms.id, symbol = ms.symbol;
    const daily = (await prisma.dailyPrice.findMany({ where: { stockId: id, ...(cutoff ? { date: { lte: cutoff } } : {}) }, orderBy: { date: "asc" }, select: { date: true, close: true } })).map((d) => ({ date: d.date, close: Number(d.close) }));
    const sh = await prisma.shareholdingPattern.findMany({ where: { stockId: id, ...(cutoff ? { asOnDate: { lte: cutoff } } : {}) }, orderBy: { asOnDate: "asc" }, select: { asOnDate: true, quarter: true, fiscalYear: true, promoterShares: true, totalShares: true, pledgedShares: true, promoterPct: true, fiiPct: true, diiPct: true, retailPct: true } });
    const own: OwnershipQuarter[] = sh.map((r) => ({ asOnDate: r.asOnDate, quarter: r.quarter, fiscalYear: r.fiscalYear, promoterShares: r.promoterShares, totalShares: r.totalShares, pledgedShares: r.pledgedShares, promoterPct: num(r.promoterPct), fiiPct: num(r.fiiPct), diiPct: num(r.diiPct), retailPct: num(r.retailPct) }));

    let foundation: MetricValue[], momentum: MetricValue[], snapshotFy: string | null, snapshotQuarter: string | null;
    let seriesFor: (key: string, pillar: "foundation" | "momentum") => number[];
    let qRowsForFindings: MomentumQuarter[] = []; // non-fin standalone quarters (P11/P12 OPM); [] for banks
    let fRowsForFindings: FoundationAnnual[] = []; // non-fin standalone annuals (R4/P8); [] for banks
    if (industry === "banking") {
      const ctx: BankingCtx = await loadBankingCtx(symbol, id, cutoff);
      const d = dispatchLiveValues({ industryType: "banking", foundationKeys: fKeys, momentumKeys: mKeys, foundationRows: [], momentumQuarters: [], bankingCtx: ctx });
      foundation = d.status === "computed" ? d.foundation : [];
      momentum = d.status === "computed" ? d.momentum : [];
      snapshotFy = d.status === "computed" ? d.snapshotFy : null;
      snapshotQuarter = d.status === "computed" ? d.snapshotQuarter : null;
      seriesFor = (key) => bankingSeriesForKey(ctx, key);
    } else {
      const fRows = await loadFoundationStandalone(id, cutoff);
      const qRows = await loadMomentumStandalone(id, cutoff);
      qRowsForFindings = qRows;
      fRowsForFindings = fRows;
      const d = dispatchLiveValues({ industryType: "non_financial", foundationKeys: fKeys, momentumKeys: mKeys, foundationRows: fRows, momentumQuarters: qRows });
      foundation = d.status === "computed" ? d.foundation : [];
      momentum = d.status === "computed" ? d.momentum : [];
      snapshotFy = d.status === "computed" ? d.snapshotFy : null;
      snapshotQuarter = d.status === "computed" ? d.snapshotQuarter : null;
      seriesFor = (key, pillar) => seriesForKey(fRows, qRows, key, pillar);
    }
    raws.push({ stockId: id, symbol, daily, own, foundation, momentum, snapshotFy, snapshotQuarter, seriesFor, qRows: qRowsForFindings, fRows: fRowsForFindings });
  }

  const fSnap = raws[0]?.snapshotFy ?? "FY";
  const mSnap = raws[0]?.snapshotQuarter ?? "FYQ";

  // Cross-section score F/M per key.
  const fMetrics = new Map<string, ScoredMetric[]>(); const mMetrics = new Map<string, ScoredMetric[]>();
  const fBarSetIds = new Map<string, string | null>(); const mBarSetIds = new Map<string, string | null>();
  for (const r of raws) { fMetrics.set(r.symbol, []); mMetrics.set(r.symbol, []); }
  // PG-level peer μ/σ/N per metric — captured here and persisted by the write path so
  // the peer-relative lens (L2) distribution is reconstructable + displayable. We keep
  // the exact CrossSectionResult.peerStats (the cross-section OTHERS are scored against),
  // never re-derive it — so it can't drift from the committed l2Scores.
  const peerStatsCaps: PeerStatsCapture[] = [];
  const scorePillarKeys = async (keys: string[], pillar: "foundation" | "momentum", bucket: Map<string, ScoredMetric[]>, ids: Map<string, string | null>, cfg: WiringConfig, snap: string) => {
    for (const key of keys) {
      const bs = await loadBarSet(ref.pgId, key, barAsOf);
      if (!bs) continue;
      ids.set(key, bs.metricBarSetId ?? null);
      const xsMembers: CrossSectionMember[] = raws.map((r) => {
        const arr = pillar === "foundation" ? r.foundation : r.momentum;
        const mv = arr.find((x) => x.key === key); const avail = !!mv && mv.available && mv.value !== null;
        return { stockId: r.stockId, symbol: r.symbol, rawValue: avail ? mv!.value : null, available: avail, unavailableReason: avail ? null : (mv?.reason ?? "no value"), ownHistoryValues: r.seriesFor(key, pillar) };
      });
      const xs = scoreMetricCrossSection({ pillar, metricKey: key, label: key, snapshot: snap, direction: bs.direction, bars: bs.bars, barNote: bs.note, sscu: bs.sscu ? { bars: bs.sscu.bars, scope: bs.sscu.scope } : null, members: xsMembers, suppression: NO_SUPPRESSION, config: cfg });
      for (const s of xs.scored) bucket.get(s.symbol)!.push(s);
      peerStatsCaps.push({ pillar, metricKey: key, barPath, mean: xs.peerStats.mean, stdDev: xs.peerStats.stdDev, sampleN: xs.peerStats.sampleN, anchorLiftFired: xs.lift531.fired });
    }
  };
  await scorePillarKeys(fKeys, "foundation", fMetrics, fBarSetIds, F_CFG, fSnap);
  await scorePillarKeys(mKeys, "momentum", mMetrics, mBarSetIds, M_CFG, mSnap);

  // PERIOD KEY. In a normal (live) run this is the period that emerges from the data
  // (all members share the latest quarter). In a POINT-IN-TIME backfill it is the
  // REQUESTED period (the cutoff defines it) — members legitimately differ in depth at
  // a historical cutoff, so we must NOT derive it from raws[0]. Each member still uses
  // its own ≤cutoff latest data for its pillars (point-in-time per member).
  const periodKey = pit ? pit.expectPeriodKey : (mSnap || fSnap || "FY26Q4");

  // ── C/D FLOW FEEDS (insider + block) — replaces the NO_FEEDS stub ──────────────
  // Load each member's insider/block feeds + end-of-window market cap, CUTOFF-CORRECT
  // (the same pit.quarterEnd every raw read uses → no post-period leak). Async, so it
  // runs as a pass BEFORE the (synchronous) member assembly below. A member with no
  // shareholding gets no ownership at all (own=null), so its feed is skipped; the
  // loader returns ARRAYS (never null) for everyone else, so C/D land in their proper
  // SCORED state (neutral when there's no activity) — `dormant_no_feed` now means only
  // "this loader did not run", never a wired-but-quiet stock.
  const feedsByStock = new Map<string, FlowFeeds>();
  for (const r of raws) {
    if (!r.own.length) continue;
    const current = r.own[r.own.length - 1];
    const loaded = await loadFlowFeeds({ stockId: r.stockId, asOf: current.asOnDate, cutoff, daily: r.daily, totalShares: current.totalShares });
    feedsByStock.set(r.stockId, loaded.feeds);
  }

  const members: MemberComputed[] = raws.map((r) => {
    const fPillar = assemblePillar({ pillar: "foundation", stockId: r.stockId, symbol: r.symbol, snapshot: fSnap, metrics: fMetrics.get(r.symbol)! });
    const mPillar = assemblePillar({ pillar: "momentum", stockId: r.stockId, symbol: r.symbol, snapshot: mSnap, metrics: mMetrics.get(r.symbol)! });
    const market = mktBySym.get(r.symbol)?.result ?? null;
    const mktSub = market && market.state === "scored" ? market.subtotal : null;
    const ctx: OwnershipContext = { priceProbe: makePriceProbe(r.daily), feeds: feedsByStock.get(r.stockId) ?? NO_FEEDS };
    const own = r.own.length ? computeOwnership(r.symbol, r.own, ctx) : null;
    const latest = r.own[r.own.length - 1];
    const pillars: PillarInput[] = [
      { pillar: "foundation", subtotal: fPillar.subtotal, state: fPillar.pillarState, sourcePeriod: fSnap },
      { pillar: "momentum", subtotal: mPillar.subtotal, state: mPillar.pillarState, sourcePeriod: mSnap },
      { pillar: "market", subtotal: mktSub, state: mktSub != null ? "scored" : "unavailable_redistributed", sourcePeriod: mktSub != null ? marketSourcePeriod : "MARKET_EXCLUDED" },
      { pillar: "ownership", subtotal: own ? own.finalOwnership : null, state: own ? "scored" : "unavailable_redistributed", sourcePeriod: own?.snapshot.periodKey ?? "—" },
    ];
    const composite = assembleComposite(r.stockId, r.symbol, pillars, { snapshotType: "quarterly", periodKey, asOfDate: asOf });
    // Pond heat is a PG-level property inherited by every member (File 2 §7) — the same
    // pgMkt.pondHeat for all. undefined only when the Market pass returned no pond (no roster).
    return { stockId: r.stockId, symbol: r.symbol, fPillar, fMetrics: fMetrics.get(r.symbol)!, fBarSetIds, mPillar, mMetrics: mMetrics.get(r.symbol)!, mBarSetIds, market, marketSourcePeriod, own, composite, pondHeat: pgMkt?.pondHeat };
  });

  let dampenReport: DampenReport | undefined;
  // ── §2/§5 FINDINGS HOOK (opt-in; PURE — no writes) ───────────────────────────────
  // The seam File 1's engine hooks: AFTER composite assembly. For each SCORED member,
  // assemble the FiringContext from its just-built composite + raw series and run the
  // rule set; attach the fired set to m.findings. raws and members are index-aligned
  // (members = raws.map), so raws[i] is members[i]'s raw inputs. Persisting the findings
  // is separately gated (persistMember opts.writeFindings) — nothing is written here.
  if (opts.withFindings) {
    // Each member's sector class (gates §2 Line 2 + F1). The Sector.sectorClass column is
    // seeded from the ratified map; null only for an unmapped sector (none in the DB today).
    const stockSectors = await prisma.stock.findMany({ where: { id: { in: members.map((m) => m.stockId) } }, select: { id: true, sector: { select: { sectorClass: true } } } });
    const sectorClassByStock = new Map<string, FiringContext["sectorClass"]>(stockSectors.map((s) => [s.id, (s.sector?.sectorClass ?? null) as FiringContext["sectorClass"]]));
    // Band-typical 4-pillar medians (F1) — once per pass, ≤ cutoff (PIT). Same for all members.
    const bandTypicalProfiles = await loadBandTypicalProfiles(cutoff ?? null);
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const r = raws[i];
      if (m.composite.state !== "scored" || m.composite.composite === null || m.composite.labelBand === null) { m.findings = []; continue; }
      // Stage-D substrate: the ordered prior-snapshot series, point-in-time (strictly before
      // this period, ≤ cutoff, head-of-chain). Empty for a stock with no backfilled history.
      const priorSnapshots = await loadTrajectorySeries(m.stockId, periodKey, cutoff ?? null);
      const fctx: FiringContext = {
        stockId: m.stockId, symbol: m.symbol, periodKey, asOfDate: asOf, industry, cutoff: cutoff ?? null,
        current: { composite: m.composite.composite, labelBand: m.composite.labelBand, pillars: pillarMapOf(m.composite) },
        priorSnapshots,
        shareholding: r.own,
        annualFundamentals: r.fRows,
        quarterlyOpm: industry === "banking" ? null : (r.qRows.length ? opmSeriesFromQuarters(r.qRows) : null),
        quarterlyResults: r.qRows,
        daily: r.daily,
        feeds: feedsByStock.get(m.stockId) ?? NO_FEEDS,
        sectorClass: sectorClassByStock.get(m.stockId) ?? null, // seeded sector→class (§2 Line 2 / F1)
        bandTypicalProfiles,
      };
      m.findings = runFindings(fctx);
    }
    // ── PG-WIDE DAMPENING (post-fire, pre-persist) ─────────────────────────────────
    // A pattern firing on >80% of the PG's SCORED members is a sector-wide condition →
    // halve magnitude + mark "dampened". Mutates the fired sets in place (patterns only;
    // red flags never dampen). The denominator is the scored members.
    const scoredSets = members.filter((m) => m.composite.state === "scored" && m.findings).map((m) => m.findings!);
    dampenReport = applyPgDampening(scoredSets);
  }

  return { ref, peerGroupId: pgRow.id, asOf, periodKey, industry, members, peerStats: peerStatsCaps, dampenReport };
}

// ── SCAFFOLD (get-or-create spec / run / band-mapping, once per pass) ────────────────
export interface Scaffold { specVersionId: string; runId: string; bandMappingVersionId: string }
/** Provenance for a scoring pass. The ScoringSpecVersion + BandMappingVersion are
 *  get-or-created by VERSION STRING (reused — a rescore NEVER spawns a new spec/mapping
 *  version, so the committed snapshots' methodology lineage stays coherent). A fresh
 *  ScoringRun is created per pass (the per-execution audit record). `triggerType`
 *  distinguishes the original commits (manual_api) from auto-rescores (post_ingest). */
export interface ScaffoldOpts {
  runType?: "quarterly" | "live";
  triggerType?: "scheduled" | "post_ingest" | "manual_api";
}
export async function ensureScaffold(db: Db, asOf: Date, opts: ScaffoldOpts = {}): Promise<Scaffold> {
  const spec = (await db.scoringSpecVersion.findFirst({ where: { version: COMPOSITE_SPEC_VERSION }, select: { id: true } }))
    ?? (await db.scoringSpecVersion.create({ data: { version: COMPOSITE_SPEC_VERSION, effectiveFrom: asOf, notes: "4-pillar Health Score scoring pass (Foundation+Momentum+universal Market+Ownership)." }, select: { id: true } }));
  const mapping = (await db.bandMappingVersion.findFirst({ where: { version: BAND_MAPPING_VERSION }, select: { id: true } }))
    ?? (await db.bandMappingVersion.create({ data: { version: BAND_MAPPING_VERSION, mapping: bandMappingJson(), effectiveFrom: asOf }, select: { id: true } }));
  const run = await db.scoringRun.create({ data: { runType: opts.runType ?? "quarterly", triggerType: opts.triggerType ?? "manual_api", specVersionId: spec.id, asOfDate: asOf, status: "running", startedAt: asOf }, select: { id: true } });
  return { specVersionId: spec.id, runId: run.id, bandMappingVersionId: mapping.id };
}

export async function finalizeRun(db: Db, runId: string, stocksScored: number, finishedAt: Date): Promise<void> {
  await db.scoringRun.update({ where: { id: runId }, data: { status: "success", finishedAt, stocksScored } });
}

// ── PERSIST one member (4 pillars + children + snapshot + R1) on the passed db ──────
export interface MemberWriteResult {
  symbol: string;
  action: "created" | "skipped_identical" | "unavailable_no_snapshot";
  /** Snapshot version written/found. A brand-new score is version 1; a genuine change
   *  over an existing v1 supersedes to version 2 (`superseded` true). 0 ⇒ no snapshot. */
  version: number;
  /** True when this write SUPERSEDED a prior snapshot (action "created", existing v1
   *  with a different fingerprint). Distinguishes a supersede from a first-time create
   *  for callers reporting per-member outcomes; `action` stays "created" for both so
   *  existing count-by-action callers are unaffected. */
  superseded: boolean;
  snapshotId: string | null;
  composite: number | null;
  band: string | null;
  marketState: "scored" | "unavailable_redistributed" | "none";
  r1Written: boolean;
  pillarIds: Partial<Record<Pillar, string>>;
}

/** Get-or-create per-(PG,metric,run,asOf) score_peer_stats rows from the captured peer
 *  μ/σ/N, returning metricKey → id. Idempotent on the @@unique([peerGroupId, metricKey,
 *  runId, asOfDate]) identity (re-running a pass never double-writes). Append-only: never
 *  updates an existing row. Runs inside the caller's transaction (sequential members in a
 *  PG see each other's creates, so the first member writes and the rest find — cheap). */
async function ensurePeerStats(db: Db, caps: PeerStatsCapture[], ctx: { peerGroupId: string; runId: string; asOfDate: Date }): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const c of caps) {
    const existing = await db.peerStatsSnapshot.findFirst({
      where: { peerGroupId: ctx.peerGroupId, metricKey: c.metricKey, runId: ctx.runId, asOfDate: ctx.asOfDate },
      select: { id: true },
    });
    if (existing) { map.set(c.metricKey, existing.id); continue; }
    const created = await db.peerStatsSnapshot.create({
      data: {
        peerGroupId: ctx.peerGroupId, barPath: c.barPath, metricKey: c.metricKey, runId: ctx.runId, asOfDate: ctx.asOfDate,
        mean: c.mean, stdDev: c.stdDev, sampleN: c.sampleN,
        anchorLiftFired: c.anchorLiftFired, anchorLiftRule: c.anchorLiftFired ? "rule_5_3_1" : null,
      },
      select: { id: true },
    });
    map.set(c.metricKey, created.id);
  }
  return map;
}

/** Get-or-create a Foundation/Momentum PillarScore (+ MetricScore children via nested create). */
async function writeFmPillar(db: Db, r: PillarScoreResult, metrics: ScoredMetric[], barSetIds: Map<string, string | null>, ctx: { runId: string; specVersionId: string; asOfDate: Date; sourcePeriod: string }, peerStatsIdByKey: Map<string, string>): Promise<string> {
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
      const full = completeMetricScoreRow(toMetricScoreRow(s, { pillarScoreId: "", peerStatsSnapshotId: peerStatsIdByKey.get(s.metricKey) ?? null, metricBarSetId: barSetIds.get(s.metricKey) ?? null }), weights);
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

export async function persistMember(db: Db, m: MemberComputed, sc: Scaffold, asOf: Date, peerGroupId: string, barPath: string, industryPath: IndustryType = "non_financial", peerStats: PeerStatsCapture[] = [], opts: { writeFindings?: boolean } = {}): Promise<MemberWriteResult> {
  // Unavailable composite → no snapshot (recorded, never fabricated). For these
  // rosters this is not expected (Market may drop, but composite still 3-pillar-scores).
  if (m.composite.state !== "scored" || m.composite.composite === null) {
    return { symbol: m.symbol, action: "unavailable_no_snapshot", version: 0, superseded: false, snapshotId: null, composite: null, band: null, marketState: m.market ? m.market.state : "none", r1Written: false, pillarIds: {} };
  }

  // Skip-identical at the snapshot level (ruling 3), compared against the LIVE snapshot.
  // The LIVE row is the highest version for this (stock, snapshotType, periodKey): the
  // supersede chain strictly increments version (1→2→3…), so max(version) is current.
  // (Was a findUnique hardcoded to version:1 — that only ever chained the FIRST
  // supersede; a second genuine change recomputed version 1+1=2 and collided on
  // @@unique([stockId,snapshotType,periodKey,version]) / @@unique([supersedesId]).
  // Daily price-driven Market re-scoring produces many supersedes per period, so the
  // lookup MUST follow the chain to its head.)
  const fp = snapshotInputsFingerprint(m.composite);
  const liveSnap = await db.scoreSnapshot.findFirst({ where: { stockId: m.stockId, snapshotType: m.composite.snapshotType, periodKey: m.composite.periodKey }, orderBy: { version: "desc" }, select: { id: true, inputsFingerprint: true, version: true } });
  if (liveSnap && liveSnap.inputsFingerprint === fp) {
    return { symbol: m.symbol, action: "skipped_identical", version: liveSnap.version, superseded: false, snapshotId: liveSnap.id, composite: m.composite.composite, band: m.composite.labelBand, marketState: m.market ? m.market.state : "none", r1Written: false, pillarIds: {} };
  }

  // PG-level peer μ/σ rows (score_peer_stats) — get-or-created once per (PG, metric, run,
  // asOf); each scored MetricScore links to its row via peerStatsSnapshotId (was hardcoded
  // null). Idempotent + append-only. Empty caps (legacy callers) → null FK, unchanged.
  const peerStatsIdByKey = peerStats.length
    ? await ensurePeerStats(db, peerStats, { peerGroupId, runId: sc.runId, asOfDate: asOf })
    : new Map<string, string>();

  // Write the 4 pillars (get-or-create), resolving the FKs the snapshot needs.
  const pillarCtxFm = (sourcePeriod: string) => ({ runId: sc.runId, specVersionId: sc.specVersionId, asOfDate: asOf, sourcePeriod });
  const foundationId = await writeFmPillar(db, m.fPillar, m.fMetrics, m.fBarSetIds, pillarCtxFm(m.fPillar.snapshot), peerStatsIdByKey);
  const momentumId = await writeFmPillar(db, m.mPillar, m.mMetrics, m.mBarSetIds, pillarCtxFm(m.mPillar.snapshot), peerStatsIdByKey);
  // Market: a Market-excluded stock still gets a (state unavailable_redistributed) pillar + 7 sub rows.
  if (!m.market) throw new Error(`persistMember: ${m.symbol} has no Market result — orchestrate.scoreMarketForPg must return every roster member`);
  const marketId = await writeMarketPillar(db, m.market, m.stockId, m.symbol, { runId: sc.runId, specVersionId: sc.specVersionId, asOfDate: asOf, sourcePeriod: m.market.state === "scored" ? m.marketSourcePeriod : "MARKET_EXCLUDED" });
  if (!m.own) throw new Error(`persistMember: ${m.symbol} has no Ownership result (no shareholding rows)`);
  const ownership = await writeOwnershipPillar(db, m.own, m.stockId, m.symbol, { runId: sc.runId, specVersionId: sc.specVersionId, asOfDate: asOf });

  const pillarScoreIds: Record<Pillar, string> = { foundation: foundationId, momentum: momentumId, market: marketId, ownership: ownership.id };
  const snapRow = toScoreSnapshotRow(m.composite, { runId: sc.runId, specVersionId: sc.specVersionId, bandMappingVersionId: sc.bandMappingVersionId, peerGroupId, barPath, industryPath, pillarScoreIds, maskHeat: m.pondHeat?.heat ?? null, pgTrailingMovePct: m.pondHeat?.trailingMovePct ?? null });
  if (liveSnap) { snapRow.version = liveSnap.version + 1; snapRow.supersedesId = liveSnap.id; } // append-only supersede: chain from the live (highest) version → v1→v2→v3…

  const snap = await db.scoreSnapshot.create({ data: snapRow, select: { id: true } });
  let r1Written = false;
  if (ownership.r1Fired) {
    await db.redFlag.create({ data: toR1RedFlagRow(snap.id, m.composite, ownership.r1Triggering) });
    r1Written = true;
  }

  // §2/§5 FINDINGS PERSIST — gated (default OFF; nothing durable until the catalog is
  // validated + a rescore stage opts in). Writes only the NEW rules' findings (R6/P11/C1
  // …); R1 keeps its dedicated write above. Findings FK this fresh snapshot — they version
  // with it. Runs only when the findings hook attached a set (computePgScores withFindings).
  if (opts.writeFindings && m.findings && m.findings.length) {
    await persistFindings(db, snap.id, m.symbol, asOf, m.findings);
  }

  return { symbol: m.symbol, action: "created", version: snapRow.version, superseded: !!liveSnap, snapshotId: snap.id, composite: m.composite.composite, band: m.composite.labelBand, marketState: m.market.state, r1Written, pillarIds: pillarScoreIds };
}
