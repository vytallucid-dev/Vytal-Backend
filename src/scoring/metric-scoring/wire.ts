// File: src/scoring/metric-scoring/wire.ts
//
// The lens-WIRING orchestrator. For one metric across a peer group at a snapshot:
//   1. partition members into valid / suppressed / missing (the 3 not-scored modes)
//   2. compute peer μ/σ over VALID values only (N-of-K)
//   3. L1 every valid member, then the §5.3.1 collective lift decision (count L1≥75)
//   4. per valid member: L1 (done) → L2 (gated on peer N≥min) → L3 (own-history,
//      gated on in-window N≥min, with its own §5.4.1 lift) → composite (§5.8 fallback)
//   5. assemble each ScoredMetric (the score_metrics contract)
//
// It CALLS the verified lens math (computeLens1/2/3, combineLenses) — never
// reimplements it. Weighting/renormalization is the NEXT piece and is not done here.

import { computeLens1, scoreL1, type Lens1Result, type AbsoluteBars, type StockOverride } from "../lenses/lens-bars.js";
import { computeLens2, computeLens3, type ZLensResult } from "../lenses/lens-zscore.js";
import { combineLenses } from "../lenses/composite.js";
import { assertUnitMatch, type LiveUnit } from "./unit-guard.js";
import type { BarDirection } from "../lenses/types.js";
import { computePeerStats, decideLift531, decideLift541 } from "./peer-stats.js";
import { normalizeSuppression } from "./types.js";
import type {
  Pillar,
  PeerStats,
  AnchorLiftDecision,
  ScoredMetric,
  CrossSectionResult,
  WiringConfig,
  SuppressionInput,
} from "./types.js";

/** One PG member's input for a single metric at the snapshot. */
export interface CrossSectionMember {
  stockId: string;
  symbol: string;
  rawValue: number | null; // the snapshot raw value (null ⇒ UNAVAILABLE/missing)
  available: boolean; // raw value present & valid
  unavailableReason: string | null; // why missing (standalone_absent, insufficient_history, …)
  /** Full VALID own-history series of this metric (oldest→newest, current last),
   *  nulls already removed. wire applies the l3Window cap. */
  ownHistoryValues: number[];
}

export interface CrossSectionInput {
  pillar: Pillar;
  metricKey: string;
  label: string;
  snapshot: string; // e.g. "FY26" or "FY26Q4"
  direction: BarDirection;
  bars: AbsoluteBars;
  barNote: string; // THROWAWAY label in verification
  /** The unit the live raw values are computed in. When supplied together with
   *  barUnit, the §8 unit-match guard runs once before scoring and THROWS on a
   *  mismatch (never scores). Optional ⇒ existing callers are unchanged. */
  liveUnit?: LiveUnit;
  /** The unit the bar-set is expressed in (defaults to the engine registry unit
   *  for metricKey inside assertUnitMatch when omitted). */
  barUnit?: "%" | "ratio" | "x" | "days" | "years";
  /** OPTIONAL per-stock 3-anchor SSCU override (handoff §7). When supplied, any
   *  member whose symbol is in `sscu.scope` is L1-scored against the 3-anchor
   *  override instead of the standard 5 bars (others unchanged). Omitted ⇒ every
   *  member uses the standard bars (existing callers are byte-identical). */
  sscu?: StockOverride | null;
  members: CrossSectionMember[];
  /** Single predicate (legacy = O2 both-effects) OR two predicates (O2/O4
   *  independent — own-score and peer-mean honored separately). */
  suppression: SuppressionInput;
  config: WiringConfig;
}

export function scoreMetricCrossSection(input: CrossSectionInput): CrossSectionResult {
  const { members, config, bars, direction, metricKey } = input;

  // §8 UNIT-MATCH GUARD — once per metric, BEFORE any value meets the bars. A live
  // value in a different scale than the bars (e.g. a ratio value against percent
  // bars) silently corrupts L1; this THROWS instead of scoring. Runs only when the
  // caller supplies the live unit (additive — existing callers are unaffected).
  if (input.liveUnit !== undefined) assertUnitMatch(metricKey, input.liveUnit, input.barUnit);

  const sup = normalizeSuppression(input.suppression); // two independent predicates

  // 1. partition. The two booleans drive two INDEPENDENT effects from the one row:
  //    own-score exclusion → metric dropped from THIS stock (scoreState=suppressed);
  //    peer-mean exclusion → value dropped from the cross-section OTHERS see.
  //    O2 = both. O4 = peer-only (own kept → still scored).
  const ownExcluded = new Set(members.filter((m) => sup.excludeFromOwnScore(m.stockId, metricKey)).map((m) => m.stockId));
  const peerExcluded = new Set(members.filter((m) => sup.excludeFromPeerMean(m.stockId, metricKey)).map((m) => m.stockId));

  // Stocks that GET a score (own not excluded). O4 stocks are here; O2 are not.
  const scoredSet = members.filter((m) => m.available && m.rawValue !== null && !ownExcluded.has(m.stockId));
  // The peer cross-section OTHERS are scored against — excludes peer-excluded values.
  const peerSetCommon = scoredSet.filter((m) => !peerExcluded.has(m.stockId));

  // 2. peer μ/σ over the common cross-section (the headline cross-section).
  const commonStats = computePeerStats(peerSetCommon.map((m) => m.rawValue as number));
  const l2AvailableCommon = commonStats.sampleN >= config.peerMinN;

  // 3. L1 for every scored member (L1 needs only the own value); §5.3.1 lift over
  //    the common cross-section (the peer-excluded values are not counted). SSCU
  //    (handoff §7): scoreL1 applies the per-stock 3-anchor override when the
  //    member's symbol is in scope; with no override it is exactly computeLens1
  //    (the verified 5-bar path) — so non-SSCU callers are byte-identical.
  const override = input.sscu ?? null;
  const l1Map = new Map<string, Lens1Result>();
  for (const m of scoredSet) l1Map.set(m.stockId, scoreL1(m.rawValue as number, bars, direction, { stock: m.symbol, override }));
  const lift531 = decideLift531(peerSetCommon.map((m) => l1Map.get(m.stockId)!.score));

  // 4 + 5. per member
  const scored: ScoredMetric[] = members.map((m) => {
    if (ownExcluded.has(m.stockId)) return buildNotScored(input, m, "suppressed", "suppressed by guardrail directive (own-score excluded)");
    if (!m.available || m.rawValue === null)
      return buildNotScored(input, m, "missing_renorm", m.unavailableReason ?? "raw value unavailable");

    // O4 (peer-excluded but own-kept): score the stock's OWN metric against the
    // cross-section INCLUDING its own value (peerSetCommon ∪ {self}) — so its own
    // score is UNCHANGED; only OTHERS lose its value. Normal stock: commonStats.
    const peerExcl = peerExcluded.has(m.stockId);
    let stats = commonStats;
    let l2Avail = l2AvailableCommon;
    const extraNote: string[] = [];
    if (peerExcl) {
      stats = computePeerStats([...peerSetCommon.map((x) => x.rawValue as number), m.rawValue as number]);
      l2Avail = stats.sampleN >= config.peerMinN;
      extraNote.push("O4: peer-only exclusion — own score kept (scored vs the full cross-section incl. self); value removed from the peer μ/σ others see");
    }
    return buildScored(input, m, l1Map.get(m.stockId)!, stats, l2Avail, lift531, !peerExcl, extraNote);
  });

  return {
    pillar: input.pillar,
    metricKey,
    label: input.label,
    snapshot: input.snapshot,
    peerStats: commonStats, // the cross-section OTHERS see (O4/O2 values excluded)
    l2Available: l2AvailableCommon,
    lift531,
    scored,
  };
}

function buildScored(
  input: CrossSectionInput,
  m: CrossSectionMember,
  l1: Lens1Result,
  peerStats: PeerStats,
  l2Available: boolean,
  lift531: AnchorLiftDecision,
  includedInPeerStats: boolean,
  extraNotes: string[] = [],
): ScoredMetric {
  const { direction, bars, config } = input;
  const value = m.rawValue as number;
  const notes: string[] = [...extraNotes];

  // ── Lens 2 (peer) — gated on peer N ≥ min ──
  let l2: ZLensResult | null = null;
  if (l2Available) {
    l2 = computeLens2({ value, peerMean: peerStats.mean, peerStdDev: peerStats.stdDev, direction, anchorLifted: lift531.fired });
    if (l2.guard === "std_dev_zero") notes.push("L2 peer σ=0 → anchor returned");
  } else {
    notes.push(`L2 unavailable: peer N=${peerStats.sampleN} < min ${config.peerMinN} → §5.8 fallback`);
  }

  // ── Lens 3 (own-history) — gated on in-window N ≥ min, own §5.4.1 lift ──
  const window = m.ownHistoryValues.slice(-config.l3Window);
  const ownStats = computePeerStats(window); // population μ/σ; sampleN = effective in-window N
  const lift541 = decideLift541(window, bars, direction);
  const l3 = computeLens3({
    value,
    ownHistMean: ownStats.mean,
    ownHistStdDev: ownStats.stdDev,
    windowN: ownStats.sampleN,
    minEffectiveN: config.l3MinN,
    direction,
    anchorLifted: lift541.fired,
  });
  if (!l3.available) notes.push(`L3 unavailable: own-history N=${ownStats.sampleN} < min ${config.l3MinN} → §5.8 fallback`);
  else if (l3.guard === "std_dev_zero") notes.push("L3 own σ=0 → anchor returned");
  if (lift541.fired && l3.available) notes.push(`§5.4.1 own lift fired (${lift541.clearedCount}/${lift541.n} cleared L1≥75)`);

  // ── Composite (§CN-3 equal weight; §5.8 fallback when a lens dropped) ──
  const comp = combineLenses(l1, l2, l3);

  return {
    pillar: input.pillar,
    metricKey: input.metricKey,
    label: input.label,
    stockId: m.stockId,
    symbol: m.symbol,
    rawValue: value,
    scoreState: "scored",
    includedInPeerStats, // false for an O4 stock (kept in own-score, out of the peer μ/σ)
    unavailableReason: null,
    l1Available: true,
    l1Score: l1.score,
    l1Band: l1.band,
    l1Saturated: l1.saturated,
    l1BarSetUsed: l1.barSetUsed,
    barDirection: direction,
    barNote: input.barNote,
    l2Available: l2?.available ?? false,
    l2Score: l2?.score ?? null,
    l2Z: l2?.z ?? null,
    l2AnchorApplied: l2?.anchorApplied ?? null,
    l2AnchorFired: l2?.anchorLiftFired ?? false,
    peerStats,
    l3Available: l3.available,
    l3Score: l3.score,
    l3Z: l3.z,
    l3AnchorApplied: l3.anchorApplied,
    l3AnchorFired: l3.anchorLiftFired,
    l3Mean: ownStats.sampleN > 0 ? ownStats.mean : null,
    l3StdDev: ownStats.sampleN > 0 ? ownStats.stdDev : null,
    l3WindowN: ownStats.sampleN,
    metricScore: comp.metricScore,
    lensFallbackApplied: comp.lensFallbackApplied,
    notes,
  };
}

/** SUPPRESSED or MISSING-RENORM: not scored, excluded from peer-stats. (NEUTRAL-
 *  HOLD is built by `buildNeutralHold` for banking; non-financial never uses it.) */
function buildNotScored(
  input: CrossSectionInput,
  m: CrossSectionMember,
  state: "suppressed" | "missing_renorm",
  reason: string,
): ScoredMetric {
  return {
    pillar: input.pillar,
    metricKey: input.metricKey,
    label: input.label,
    stockId: m.stockId,
    symbol: m.symbol,
    rawValue: m.rawValue,
    scoreState: state,
    includedInPeerStats: false, // suppress=false, missing=excluded
    unavailableReason: reason,
    l1Available: false, l1Score: null, l1Band: null, l1Saturated: false, l1BarSetUsed: null,
    barDirection: input.direction, barNote: input.barNote,
    l2Available: false, l2Score: null, l2Z: null, l2AnchorApplied: null, l2AnchorFired: false,
    peerStats: null,
    l3Available: false, l3Score: null, l3Z: null, l3AnchorApplied: null, l3AnchorFired: false,
    l3Mean: null, l3StdDev: null, l3WindowN: null,
    metricScore: null, lensFallbackApplied: "none",
    notes: [`not scored: ${state}`],
  };
}

/** NEUTRAL-HOLD (banking only): score 60, FULL weight, STAYS in peer-stats
 *  (includedInPeerStats=true) — the opposite of suppress. Non-financial metrics
 *  never neutral-hold; this exists so the banking build plugs in without rework.
 *  Exported but unused by the non-financial wiring. */
export function buildNeutralHold(input: CrossSectionInput, m: CrossSectionMember): ScoredMetric {
  return {
    pillar: input.pillar,
    metricKey: input.metricKey,
    label: input.label,
    stockId: m.stockId,
    symbol: m.symbol,
    rawValue: m.rawValue,
    scoreState: "neutral_hold",
    includedInPeerStats: true, // stays in peer μ/σ — the opposite of suppress
    unavailableReason: "neutral_hold (banking supplementary absent)",
    l1Available: false, l1Score: null, l1Band: null, l1Saturated: false, l1BarSetUsed: null,
    barDirection: input.direction, barNote: input.barNote,
    l2Available: false, l2Score: null, l2Z: null, l2AnchorApplied: null, l2AnchorFired: false,
    peerStats: null,
    l3Available: false, l3Score: null, l3Z: null, l3AnchorApplied: null, l3AnchorFired: false,
    l3Mean: null, l3StdDev: null, l3WindowN: null,
    metricScore: 60, lensFallbackApplied: "none",
    notes: ["neutral_hold: score 60, full weight, stays in peer-stats (banking mode)"],
  };
}
