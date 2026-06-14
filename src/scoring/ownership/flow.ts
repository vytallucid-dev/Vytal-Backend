// File: src/scoring/ownership/flow.ts
//
// OWNERSHIP — the FLOW LAYER. Ownership = Primary Subtotal (built) + Flow
// Adjustment (here) → clamp(Primary + Flow, 40, 100). UNIVERSAL core-engine,
// identical for every PG, zero per-PG content.
//
// Four categories, each individually capped, summed, then the total Flow
// Adjustment clamped to [−12, +12]:
//   A Promoter     cap [−4, +6]   LIVE (quarterly shareholding + price)
//   B Institutional cap [−6, +6]  LIVE (FII + DII, now clean)
//   C Insider      cap [−8, +5]   DORMANT (NSE PIT not wired) — full logic built
//   D Block        cap [−6, +6]   DORMANT (bhavcopy block not wired) — full logic built
// Each category stores its own sub-score + state (dormant ≠ silent 0).
//
// ── THE FIREWALL (load-bearing — each signal scored in EXACTLY ONE place) ──────
// PRIMARY already owns: pledging, R2 promoter-exit (>5pp), R6 quarterly-
// distribution, prolonged-FII-exit (4-quarter). FLOW MUST NOT re-score any of
// those. FLOW owns: promoter CONVICTION (price-conditioned buy), institutional
// ACCUMULATION / clean-rotation, insider net-flow, block net-flow.
//   • Retired/migrated: P2 → R6 (distribution, Primary); P3 → pledging (Primary);
//     P4 → B4 (dual exit, Flow); P10 → A1 (conviction buy, Flow).
//   • A keys on ABSOLUTE promoterShares (never %), with C-3 Half-A dilution
//     suppression applied to the share-count read FIRST (a count-stable %-drop is
//     issuance, not a promoter action → no A signal).
//   • A3 (creep-down) fires ONLY when R2 did NOT fire (drop < 5pp) — so a >5pp
//     exit is scored once, by Primary's R2, never also by Flow.
//   • Flow has NO distribution rule and NO single/4-quarter institutional-exit
//     rule that duplicates Primary. B4 (single-quarter DUAL exit) is a DISTINCT
//     pattern from Primary's prolonged-FII (4-quarter, FII-only); both may apply
//     in the same completing quarter (operator-accepted −12 institutional read) —
//     that is two patterns, not one delta counted twice.

import {
  classifyDilution,
  isPriorQuarterGap,
  TOL_FRACTION,
} from "./dilution.js";
import {
  classifyTrend,
  landBlockNetBand,
  landInsiderNetBand,
  trendBonus,
  type BandLanding,
  type TrendState,
} from "./flow-bands.js";
import type { OwnershipQuarter } from "./types.js";

// Per-category caps.
export const CAP_A: [number, number] = [-4, 6];
export const CAP_B: [number, number] = [-6, 6];
export const CAP_C: [number, number] = [-8, 5];
export const CAP_D: [number, number] = [-6, 6];
export const FLOW_CLAMP: [number, number] = [-12, 12];

// Institutional directional ROUNDING/NOISE floor for the B "↑/↓" reads — same
// CN-8 spirit as R6_MIN_MOVE_PP: stops a rounding wiggle being read as a real
// move. B1/B4 use explicit spec thresholds (≥1.0 / ≤0.5) well above this.
export const B_MIN_MOVE_PP = 0.05;

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export type FlowCategoryKey = "A_promoter" | "B_institutional" | "C_insider" | "D_block";
export type FlowCategoryState = "scored" | "dormant_no_feed" | "dormant_no_data";

export interface FlowCategoryResult {
  category: FlowCategoryKey;
  state: FlowCategoryState;
  firedRule: string | null; // "A1" | "B4" | "C3" | ...
  rawSubScore: number; // pre-cap (incl. trend for C/D)
  cap: [number, number];
  cappedSubScore: number; // post-cap → summed into flowAdjustmentRaw
  bandLanded: string | null; // C3 / D band key
  netFlowValue: number | null; // signed ₹cr (C) or % m-cap (D)
  trendState: TrendState | null; // C / D only
  reason: string;
  evidence: Record<string, unknown>;
}

// ── A1 price condition ────────────────────────────────────────────────────────
/** Result of probing whether the daily CLOSE touched the bottom-25% of its
 * 52-week range on ANY day in the inter-filing window. Injected by the caller so
 * the engine stays DB-free. */
export interface A1PriceEval {
  available: boolean; // false = price history insufficient to assess
  dipTouched: boolean;
  touchedOn: string | null; // YYYY-MM-DD of the qualifying day
  positionAtTouch: number | null; // (close−lo)/(hi−lo) at the touch, ≤0.25
  windowStartExclusive: string;
  windowEndInclusive: string;
}
export type PriceProbe = (
  priorAsOnExclusive: Date,
  currentAsOnInclusive: Date,
) => A1PriceEval;

// ── C / D feeds (full logic built; null = feed not wired → dormant_no_feed) ────
export interface InsiderTxn {
  date: Date;
  insiderId: string;
  side: "buy" | "sell";
  valueInrCr: number;
  role: "promoter" | "director";
}
export interface BlockTxn {
  date: Date;
  side: "buy" | "sell";
  valueInrCr: number;
}
export interface FlowFeeds {
  insiderTxns: InsiderTxn[] | null; // null = NSE PIT not wired
  blockTxns: BlockTxn[] | null; // null = bhavcopy block not wired
  marketCapInrCr: number | null; // for Category D banding (end-of-window m-cap)
}

export interface FlowResult {
  A: FlowCategoryResult;
  B: FlowCategoryResult;
  C: FlowCategoryResult;
  D: FlowCategoryResult;
  flowAdjustmentRaw: number; // A+B+C+D (each already capped)
  flowAdjustmentClamped: number; // clamp(raw, −12, +12)
}

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY A — Promoter Flow. Keys on ABSOLUTE promoterShares (never %).
// ════════════════════════════════════════════════════════════════════════════
export function computeCategoryA(
  current: OwnershipQuarter,
  prior: OwnershipQuarter | null,
  r2Fired: boolean,
  price: A1PriceEval | null,
): FlowCategoryResult {
  const base = {
    category: "A_promoter" as const,
    cap: CAP_A,
    bandLanded: null,
    netFlowValue: null,
    trendState: null,
  };
  const done = (
    state: FlowCategoryState,
    firedRule: string | null,
    raw: number,
    reason: string,
    evidence: Record<string, unknown>,
  ): FlowCategoryResult => ({
    ...base,
    state,
    firedRule,
    rawSubScore: raw,
    cappedSubScore: clamp(raw, CAP_A[0], CAP_A[1]),
    reason,
    evidence,
  });

  if (!prior) return done("scored", null, 0, "A neutral: no prior quarter to compare promoter count", {});
  if (current.promoterShares === null || prior.promoterShares === null) {
    return done("dormant_no_data", null, 0, "A dormant_no_data: promoter share count missing", {});
  }

  // C-3 Half-A read FIRST: a count-stable %-drop (dilution) leaves Δ within tol →
  // no A signal. We reuse Half-A's exact rounding band (TOL_FRACTION).
  const dil = classifyDilution(current, prior);
  const delta = Number(current.promoterShares) - Number(prior.promoterShares); // == dil.promoterShareChange
  const tol = TOL_FRACTION * Number(prior.promoterShares);
  const evidence = {
    promoterSharesQ: current.promoterShares.toString(),
    promoterSharesQ1: prior.promoterShares.toString(),
    deltaShares: delta,
    tol: Math.round(tol),
    dilutionVerdict: dil.verdict,
    pctDrop: dil.pctDrop,
    priceDipTouched: price?.dipTouched ?? null,
  };

  // Accumulation: promoter COUNT rose beyond the rounding band.
  if (delta > tol) {
    if (price && price.available && price.dipTouched) {
      return done(
        "scored",
        "A1",
        +6,
        `A1 promoter conviction buy (+6): promoterShares ↑ ${delta} (>tol ${Math.round(tol)}) ` +
          `AND close touched bottom-25% of 52w range on ${price.touchedOn} (pos ${price.positionAtTouch?.toFixed(2)})`,
        evidence,
      );
    }
    const priceNote = !price || !price.available ? " [price unavailable → treated as not-met]" : "";
    return done(
      "scored",
      "A2",
      +3,
      `A2 promoter accumulation (+3): promoterShares ↑ ${delta} (>tol ${Math.round(tol)}), price condition not met${priceNote}`,
      evidence,
    );
  }

  // Count fell beyond the band.
  if (delta < -tol) {
    if (r2Fired) {
      return done(
        "scored",
        null,
        0,
        `A neutral: promoterShares ↓ ${delta} but R2 (>5pp exit) already owns it in Primary — firewall, no A3`,
        evidence,
      );
    }
    return done(
      "scored",
      "A3",
      -4,
      `A3 promoter creep-down (−4): promoterShares ↓ ${delta} (<−tol ${Math.round(tol)}) with %drop < 5pp (R2 did not fire)`,
      evidence,
    );
  }

  // Within tol → no material count move (also the dilution case).
  return done(
    "scored",
    null,
    0,
    `A neutral: |Δ promoterShares| ${delta} ≤ tol ${Math.round(tol)} (no material move${dil.verdict === "dilution" ? "; dilution — issuance, not a promoter action" : ""})`,
    evidence,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY B — Institutional Flow (FII + DII). NO distribution / exit rule that
// duplicates Primary's R6 / prolonged-FII.
// ════════════════════════════════════════════════════════════════════════════
export function computeCategoryB(
  rows: OwnershipQuarter[],
  snapshotIdx: number,
): FlowCategoryResult {
  const base = {
    category: "B_institutional" as const,
    cap: CAP_B,
    bandLanded: null,
    netFlowValue: null,
    trendState: null,
  };
  const done = (
    state: FlowCategoryState,
    firedRule: string | null,
    raw: number,
    reason: string,
    evidence: Record<string, unknown>,
  ): FlowCategoryResult => ({
    ...base,
    state,
    firedRule,
    rawSubScore: raw,
    cappedSubScore: clamp(raw, CAP_B[0], CAP_B[1]),
    reason,
    evidence,
  });

  const current = rows[snapshotIdx];
  const prior = snapshotIdx >= 1 ? rows[snapshotIdx - 1] : null;
  if (!prior) return done("scored", null, 0, "B neutral: no prior quarter", {});

  const f = current.fiiPct, f1 = prior.fiiPct;
  const d = current.diiPct, d1 = prior.diiPct;
  const p = current.promoterPct, p1 = prior.promoterPct;
  if (f === null || f1 === null || d === null || d1 === null) {
    return done("dormant_no_data", null, 0, "B dormant_no_data: FII/DII % missing in Q or Q-1", {});
  }

  const fΔ = f - f1;
  const dΔ = d - d1;
  const combinedΔ = fΔ + dΔ;
  const pΔ = p !== null && p1 !== null ? p - p1 : null;
  const evidence = { fiiDelta: fΔ, diiDelta: dΔ, combinedDelta: combinedΔ, promoterDelta: pΔ };

  // ── B4 dual institutional exit (checked first; excludes all positives) ──
  if (fΔ <= -0.5 && dΔ <= -0.5) {
    return done(
      "scored",
      "B4",
      -8,
      `B4 dual institutional exit (−8 → cap −6): FII ↓${(-fΔ).toFixed(2)}pp AND DII ↓${(-dΔ).toFixed(2)}pp same quarter`,
      evidence,
    );
  }

  // ── B1 clean rotation: DII ↑≥1.0 AND FII ↓ (≤0.5pp) AND |promoterΔ| ≤0.5 ──
  const b1 =
    dΔ >= 1.0 &&
    fΔ <= -B_MIN_MOVE_PP &&
    fΔ >= -0.5 &&
    pΔ !== null &&
    Math.abs(pΔ) <= 0.5;
  const b1Value = b1 ? 5 : 0;

  // ── Accumulation track: combined (FII+DII) ↑ this quarter, 2+ consecutive → B2 ──
  const accThisQ = combinedΔ >= B_MIN_MOVE_PP;
  let accPrevQ = false;
  if (accThisQ && snapshotIdx >= 2) {
    const pp = rows[snapshotIdx - 2];
    const consecutive = !isPriorQuarterGap(prior.asOnDate, pp.asOnDate);
    if (consecutive && prior.fiiPct !== null && prior.diiPct !== null && pp.fiiPct !== null && pp.diiPct !== null) {
      const prevCombinedΔ = prior.fiiPct - pp.fiiPct + (prior.diiPct - pp.diiPct);
      accPrevQ = prevCombinedΔ >= B_MIN_MOVE_PP;
    }
  }
  const accRule = accThisQ ? (accPrevQ ? "B2" : "B3") : null;
  const accValue = accThisQ ? (accPrevQ ? 5 : 3) : 0;

  // ── Combine positives. B1 and the accumulation track are NEVER summed: B1
  // mandates FII↓, so any concurrent combined-↑ accumulation is DII-driven — the
  // SAME actor. With only aggregate FII/DII deltas we cannot attribute to distinct
  // actors, so we conservatively take the higher single value (never double-count
  // one DII inflow). B2 supersedes B3 (handled by accValue above). ──
  const positive = Math.max(b1Value, accValue);
  if (positive === 0) {
    return done(
      "scored",
      null,
      0,
      `B neutral: no rotation/accumulation (fiiΔ=${fΔ.toFixed(2)} diiΔ=${dΔ.toFixed(2)} combinedΔ=${combinedΔ.toFixed(2)})`,
      evidence,
    );
  }
  const ruleParts: string[] = [];
  if (b1Value === positive && b1) ruleParts.push("B1");
  if (accValue === positive && accRule) ruleParts.push(accRule);
  const firedRule = ruleParts.join("=");
  const why =
    b1 && accRule
      ? `${ruleParts.join(" & ")} both present, same DII inflow → take max (no sum)`
      : b1
        ? "B1 clean rotation (DII↑≥1.0, FII↓≤0.5, promoter flat)"
        : accRule === "B2"
          ? "B2 sustained accumulation (combined FII+DII ↑ 2+ consecutive quarters)"
          : "B3 single-quarter accumulation (combined FII+DII ↑)";
  return done("scored", firedRule, positive, `${firedRule} (+${positive}): ${why}`, evidence);
}

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY C — Insider Flow (NSE PIT). DORMANT (feed not wired) — FULL logic built.
// ════════════════════════════════════════════════════════════════════════════
const DAY_MS = 24 * 60 * 60 * 1000;
const ELIGIBLE_INR_CR = 1; // ≥₹1cr per transaction (universal rule)

export function computeCategoryC(
  feeds: FlowFeeds,
  asOf: Date,
): FlowCategoryResult {
  const base = {
    category: "C_insider" as const,
    cap: CAP_C,
    netFlowValue: null as number | null,
    bandLanded: null as string | null,
    trendState: null as TrendState | null,
  };
  // DORMANT: feed not wired → contribute 0, RECORD the state (never a silent 0).
  if (feeds.insiderTxns === null) {
    return {
      ...base,
      state: "dormant_no_feed",
      firedRule: null,
      rawSubScore: 0,
      cappedSubScore: 0,
      reason: "C dormant_no_feed: NSE PIT not wired — contributes 0, full logic ready",
      evidence: { feed: "insiderTxns=null" },
    };
  }

  // ── FULL LOGIC (runs when PIT wires; zero further decisions) ──
  const inWindow = (from: Date, to: Date) =>
    feeds.insiderTxns!.filter(
      (t) =>
        t.valueInrCr >= ELIGIBLE_INR_CR &&
        (t.role === "promoter" || t.role === "director") &&
        t.date.getTime() > from.getTime() &&
        t.date.getTime() <= to.getTime(),
    );

  const w0from = new Date(asOf.getTime() - 30 * DAY_MS);
  const win = inWindow(w0from, asOf);
  const buys = win.filter((t) => t.side === "buy");
  const sells = win.filter((t) => t.side === "sell");
  const buyers = new Set(buys.map((t) => t.insiderId)).size;
  const sellers = new Set(sells.map((t) => t.insiderId)).size;
  const netInrCr = buys.reduce((s, t) => s + t.valueInrCr, 0) - sells.reduce((s, t) => s + t.valueInrCr, 0);

  let firedRule: string;
  let rulePoints: number;
  let band: BandLanding | null = null;
  if (sellers >= 3 && buys.length === 0) {
    firedRule = "C2";
    rulePoints = -8; // cluster sell
  } else if (buyers >= 3 && sells.length === 0) {
    firedRule = "C1";
    rulePoints = +5; // cluster buy
  } else {
    firedRule = "C3";
    band = landInsiderNetBand(netInrCr); // cluster did not fire → net sub-cluster band
    rulePoints = band.points;
  }

  // 90-day trend bonus from the three consecutive 30-day windows' net-flow signs.
  const signs = [0, 1, 2].map((k) => {
    const to = new Date(asOf.getTime() - k * 30 * DAY_MS);
    const from = new Date(to.getTime() - 30 * DAY_MS);
    const w = inWindow(from, to);
    const net = w.filter((t) => t.side === "buy").reduce((s, t) => s + t.valueInrCr, 0) -
      w.filter((t) => t.side === "sell").reduce((s, t) => s + t.valueInrCr, 0);
    return Math.sign(landInsiderNetBand(net).points);
  });
  const trendState = classifyTrend(signs);
  const raw = rulePoints + trendBonus(trendState); // trend applied BEFORE the cap

  return {
    ...base,
    state: "scored",
    firedRule,
    rawSubScore: raw,
    cappedSubScore: clamp(raw, CAP_C[0], CAP_C[1]),
    bandLanded: band?.key ?? null,
    netFlowValue: netInrCr,
    trendState,
    reason: `${firedRule} (${rulePoints >= 0 ? "+" : ""}${rulePoints}) + trend ${trendState} (${trendBonus(trendState) >= 0 ? "+" : ""}${trendBonus(trendState)}) → raw ${raw}`,
    evidence: { netInrCr, buyers, sellers, trendSigns: signs },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CATEGORY D — Block-Deal Flow (NSE bhavcopy). DORMANT — FULL logic built.
// Counterparty identity is UI-only, NEVER scored.
// ════════════════════════════════════════════════════════════════════════════
export function computeCategoryD(
  feeds: FlowFeeds,
  asOf: Date,
): FlowCategoryResult {
  const base = {
    category: "D_block" as const,
    cap: CAP_D,
    netFlowValue: null as number | null,
    bandLanded: null as string | null,
    trendState: null as TrendState | null,
  };
  if (feeds.blockTxns === null) {
    return {
      ...base,
      state: "dormant_no_feed",
      firedRule: null,
      rawSubScore: 0,
      cappedSubScore: 0,
      reason: "D dormant_no_feed: bhavcopy block feed not wired — contributes 0, full logic ready",
      evidence: { feed: "blockTxns=null" },
    };
  }
  if (feeds.marketCapInrCr === null || feeds.marketCapInrCr <= 0) {
    return {
      ...base,
      state: "dormant_no_data",
      firedRule: null,
      rawSubScore: 0,
      cappedSubScore: 0,
      reason: "D dormant_no_data: market cap unavailable for %-of-mcap banding",
      evidence: {},
    };
  }

  const eligible = (from: Date, to: Date) =>
    feeds.blockTxns!.filter(
      (t) => t.valueInrCr >= ELIGIBLE_INR_CR && t.date.getTime() > from.getTime() && t.date.getTime() <= to.getTime(),
    );
  const netInrCr30 = (from: Date, to: Date) => {
    const w = eligible(from, to);
    return w.filter((t) => t.side === "buy").reduce((s, t) => s + t.valueInrCr, 0) -
      w.filter((t) => t.side === "sell").reduce((s, t) => s + t.valueInrCr, 0);
  };

  const net30 = netInrCr30(new Date(asOf.getTime() - 30 * DAY_MS), asOf);
  const netPct = (net30 / feeds.marketCapInrCr) * 100; // % of m-cap (held at end-of-window)
  const band = landBlockNetBand(netPct);

  const signs = [0, 1, 2].map((k) => {
    const to = new Date(asOf.getTime() - k * 30 * DAY_MS);
    const from = new Date(to.getTime() - 30 * DAY_MS);
    return Math.sign(landBlockNetBand((netInrCr30(from, to) / feeds.marketCapInrCr!) * 100).points);
  });
  const trendState = classifyTrend(signs);
  const raw = band.points + trendBonus(trendState);

  return {
    ...base,
    state: "scored",
    firedRule: "D",
    rawSubScore: raw,
    cappedSubScore: clamp(raw, CAP_D[0], CAP_D[1]),
    bandLanded: band.key,
    netFlowValue: netPct,
    trendState,
    reason: `D net ${netPct.toFixed(3)}% m-cap → ${band.key} (${band.points >= 0 ? "+" : ""}${band.points}) + trend ${trendState} (${trendBonus(trendState) >= 0 ? "+" : ""}${trendBonus(trendState)}) → raw ${raw}`,
    evidence: { net30InrCr: net30, netPctOfMcap: netPct, trendSigns: signs },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// FLOW ORCHESTRATOR — per-category caps, sum, then clamp [−12, +12].
// ════════════════════════════════════════════════════════════════════════════
export function computeFlow(
  rows: OwnershipQuarter[],
  snapshotIdx: number,
  r2Fired: boolean,
  ctx: { priceProbe: PriceProbe | null; feeds: FlowFeeds },
): FlowResult {
  const current = rows[snapshotIdx];
  const prior = snapshotIdx >= 1 ? rows[snapshotIdx - 1] : null;

  // A1 price probe over the inter-filing window (day after prior as-on → current).
  let price: A1PriceEval | null = null;
  if (prior && ctx.priceProbe) price = ctx.priceProbe(prior.asOnDate, current.asOnDate);

  const A = computeCategoryA(current, prior, r2Fired, price);
  const B = computeCategoryB(rows, snapshotIdx);
  const C = computeCategoryC(ctx.feeds, current.asOnDate);
  const D = computeCategoryD(ctx.feeds, current.asOnDate);

  const flowAdjustmentRaw = A.cappedSubScore + B.cappedSubScore + C.cappedSubScore + D.cappedSubScore;
  const flowAdjustmentClamped = clamp(flowAdjustmentRaw, FLOW_CLAMP[0], FLOW_CLAMP[1]);
  return { A, B, C, D, flowAdjustmentRaw, flowAdjustmentClamped };
}
