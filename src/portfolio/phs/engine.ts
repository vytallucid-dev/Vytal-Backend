// ─────────────────────────────────────────────────────────────────────────────
// PHS ENGINE (Part A) — pure. Turns a book of holdings into the Health Score +
// standalone Structure + full deduction ledgers. No DB, no findings analysis, no advice.
//
// INVIOLABLE LAWS enforced HERE (not just copied):
//  • Signals is PENALTY-ONLY (start 100, only subtract) → Health ≤ Quality always.
//    Active flags can only pull a book below its holdings' quality, never lift it.
//  • Field-verdicts (LM3/LM4/LP2/LP3, all LM1–LM8) are NOT in the Signals deduction
//    table → they can never deduct (a fact about a peer group, never a penalty).
//  • Honest-empty: no scored holdings (c=0) → NO Health (construction-read only), never
//    a fabricated number.
// All math to the A.13 constants exactly.
//
// AMENDMENT 1.2 — DECOUPLING:
//  • Change 1 — Health = Quality − 0.20×(100 − Signals). The structure term is GONE; no
//    positional penalty enters Health. "PHS" is retired → the number is the Health Score.
//  • Change 2 — Construction = standalone Structure (S1–S5, full strength). `structure`
//    is the Construction read's headline; nothing dampens it.
//  • Change 3 — the coverage ceiling / c_eff are RETIRED. Health shows TRUE, uncapped;
//    `provisional` (coverage < 40%) is the only honesty tag left on the number.
//  • Change 4 — pillarProfile: position-weighted pillar means over scored holdings.
//  • Change 5 — lensProfile: findings-CHARACTER share of fired lens patterns by nature.
// AMENDMENT 1.1 (in force): S1 relative threshold; copy-only structure/capital tiers.
// ─────────────────────────────────────────────────────────────────────────────
import * as K from "./constants.js";
import type { StructureTier, CapitalTier, LensNature } from "./constants.js";

export type McapTier = "large" | "mid" | "small" | "unknown";
export type Bucket = "scored" | "recognized_unscored" | "small_unscored";

/** The fired findings Signals consumes (already deduplicated by the findings store). */
export type FindingKind = "distress" | "critical" | "high" | "medium" | "lp5" | "lp6";

/** The four pillar subtotals of a scored holding (0..100 each) — from its ScoreSnapshot. */
export interface PillarSubtotals {
  foundation: number;
  momentum: number;
  market: number;
  ownership: number;
}
/** Book-level pillar means (0..100), position-weighted + renormalized over scored weight. */
export type PillarProfile = PillarSubtotals;
/** (1.2 Change 5) findings-CHARACTER shares by lens nature — position-weighted share of the
 *  book's fired lens findings. Shares sum to 1. null ⇔ no lens patterns fired. NEVER an
 *  attribution ("X% of your health is peer-relative") — a character read of the FINDINGS. */
export type LensProfile = { absolute: number; peer: number; trend: number } | null;

// NON-SCOPE BOUNDARY (1.1 Change 4): this is the ENGINE INPUT seam. The engine reads ONLY
// the position-and-health facts below — value, mcap tier, sector, health, fired findings,
// pillar subtotals, and lens-finding natures. Growth / behaviour / returns history (XIRR,
// TWR, holding period, buy-sell timing, P&L) belongs to the Performance surface and MUST
// NEVER be added here or read by the score (legal boundary, §A.1/B.0).
export interface PhsHolding {
  symbol: string;
  marketValue: number; // quantity × current price (any consistent unit)
  tier: McapTier;
  sector: string | null; // null ⇒ unknown-sector
  health: number | null; // scored ⇒ 0..100; unscored ⇒ null
  findings: FindingKind[]; // fired findings for this holding (empty if none/unscored)
  pillars?: PillarSubtotals | null; // (1.2 Change 4) scored ⇒ its 4 pillar subtotals; else null
  lensNatures?: LensNature[]; // (1.2 Change 5) natures of this holding's fired lens patterns
}

export interface StructureDeduction {
  rule: "S1" | "S2" | "S3" | "S4" | "S5";
  points: number; // positive magnitude subtracted
  detail: string;
  symbol?: string; // for per-holding rules (S1, S5)
}
export interface SignalsDeduction {
  symbol: string;
  weight: number;
  source: FindingKind; // the winning (largest, headline-first) finding
  points: number; // positive magnitude subtracted (= base × weight, clamped)
}

export interface PhsResult {
  evaluable: boolean; // false ⇔ c=0 (no scored holdings)
  health: number | null; // (1.2) the Health Score — published integer; null when !evaluable. UNCAPPED.
  band: string | null;
  provisional: boolean; // c < 0.40 — the only honesty tag on the number (ceiling retired)
  quality: number | null; // the anchor (weighted health over scored)
  structure: number; // (1.2 Change 2) the standalone Construction read (full strength)
  signals: number;
  coverage: number; // true scored share (c)
  totalValue: number;
  scoredValue: number;
  recognizedUnscoredValue: number;
  smallUnscoredValue: number;
  structureLedger: StructureDeduction[];
  signalsLedger: SignalsDeduction[];
  s2Evaluable: boolean; // false ⇔ unknown-sector weight > 50% (S2 omitted honestly)
  neff: number; // effective holdings (inverse Herfindahl)
  // (1.2 Change 4/5) — health-read enrichments (null when !evaluable)
  pillarProfile: PillarProfile | null; // position-weighted pillar means over scored weight
  lensProfile: LensProfile; // findings-character shares by nature; null ⇔ no lens patterns
  // (1.1 Change 2) COPY-ONLY tiers — derived from N and total value; NOTHING in the score
  // reads them (the number is byte-identical with or without them). Part B copy selector.
  structureTier: StructureTier; // Starter | Building | Established (from holding count N)
  capitalTier: CapitalTier; // Modest | Moderate | Substantial (from total book value ₹)
}

/** Bucket per A.4: scored ⇔ has health; else large/mid ⇒ recognized-unscored;
 *  small/unknown ⇒ small-unscored (unknown treated conservatively per the prompt). */
export function bucketOf(h: PhsHolding): Bucket {
  if (h.health != null) return "scored";
  if (h.tier === "large" || h.tier === "mid") return "recognized_unscored";
  return "small_unscored"; // small OR unknown
}

const HEADLINE: Partial<Record<FindingKind, number>> = {
  distress: K.SIG_DISTRESS,
  critical: K.SIG_CRIT,
  high: K.SIG_HIGH,
  medium: K.SIG_MED,
};
const BREADTH: Partial<Record<FindingKind, number>> = { lp5: K.SIG_LP5, lp6: K.SIG_LP6 };

export function computePhs(holdings: PhsHolding[]): PhsResult {
  const totalValue = holdings.reduce((s, h) => s + h.marketValue, 0);
  // Weight vector (whole book sums to 1). Guard total=0 (empty book).
  const w = holdings.map((h) => (totalValue > 0 ? h.marketValue / totalValue : 0));
  const bucket = holdings.map(bucketOf);

  const scoredValue = holdings.reduce((s, h, i) => (bucket[i] === "scored" ? s + h.marketValue : s), 0);
  const recognizedUnscoredValue = holdings.reduce((s, h, i) => (bucket[i] === "recognized_unscored" ? s + h.marketValue : s), 0);
  const smallUnscoredValue = holdings.reduce((s, h, i) => (bucket[i] === "small_unscored" ? s + h.marketValue : s), 0);
  const coverage = totalValue > 0 ? scoredValue / totalValue : 0;

  // ── Quality (A.5) — weighted health renormalized over SCORED holdings only ──
  const sumWScored = holdings.reduce((s, h, i) => (bucket[i] === "scored" ? s + w[i] : s), 0);
  const evaluable = sumWScored > 0;
  const quality = evaluable
    ? holdings.reduce((s, h, i) => (bucket[i] === "scored" ? s + w[i] * (h.health as number) : s), 0) / sumWScored
    : null;

  // ── Structure (A.6) — start 100, penalty-only ──
  const structureLedger: StructureDeduction[] = [];

  // S1 — single position (per-holding, additive, each capped). (1.1 Change 1) the
  // threshold is RELATIVE to breadth: max(15% floor, 1.5 × fair_share), fair_share=100/N.
  // On a thin book the bar rises, so S1 no longer double-charges the concentration S3/Neff
  // already prices (fixes the S1/S3 double-charge). S3 is untouched.
  const s1Threshold = K.s1ThresholdPct(holdings.length);
  let s1 = 0;
  holdings.forEach((h, i) => {
    const pct = w[i] * 100;
    if (pct > s1Threshold) {
      const ded = Math.min(K.S1_RATE * (pct - s1Threshold), K.S1_CAP);
      s1 += ded;
      structureLedger.push({ rule: "S1", symbol: h.symbol, points: ded, detail: `${pct.toFixed(1)}% > ${s1Threshold.toFixed(1)}% → −${ded.toFixed(2)}` });
    }
  });

  // S2 — sector pile-up (whole book; unknown-sector pooled; not-evaluable > 50%)
  const sectorW = new Map<string, number>();
  let unknownSectorW = 0;
  holdings.forEach((h, i) => {
    if (h.sector == null) unknownSectorW += w[i];
    else sectorW.set(h.sector, (sectorW.get(h.sector) ?? 0) + w[i]);
  });
  const s2Evaluable = unknownSectorW <= K.S2_UNKNOWN_KILL;
  let s2 = 0;
  if (s2Evaluable) {
    let maxSector = 0, maxName = "";
    for (const [name, sw] of sectorW) if (sw > maxSector) { maxSector = sw; maxName = name; }
    const pct = maxSector * 100;
    if (pct > K.S2_THRESH) {
      s2 = Math.min(K.S2_RATE * (pct - K.S2_THRESH), K.S2_CAP);
      structureLedger.push({ rule: "S2", points: s2, detail: `${maxName} ${pct.toFixed(1)}% > ${K.S2_THRESH}% → −${s2.toFixed(2)}` });
    }
  } else {
    structureLedger.push({ rule: "S2", points: 0, detail: `not evaluable — unknown-sector weight ${(unknownSectorW * 100).toFixed(1)}% > ${K.S2_UNKNOWN_KILL * 100}%` });
  }

  // S3 — thin breadth (inverse Herfindahl)
  const sumW2 = w.reduce((s, x) => s + x * x, 0);
  const neff = sumW2 > 0 ? 1 / sumW2 : 0;
  let s3 = 0;
  if (neff < K.S3_TARGET) {
    s3 = Math.min(K.S3_RATE * (K.S3_TARGET - neff), K.S3_CAP);
    structureLedger.push({ rule: "S3", points: s3, detail: `Neff ${neff.toFixed(2)} < ${K.S3_TARGET} → −${s3.toFixed(2)}` });
  }

  // S4 — over-diversification (holding count)
  let s4 = 0;
  if (holdings.length > K.S4_THRESH) {
    s4 = Math.min(K.S4_RATE * (holdings.length - K.S4_THRESH), K.S4_CAP);
    structureLedger.push({ rule: "S4", points: s4, detail: `${holdings.length} > ${K.S4_THRESH} holdings → −${s4.toFixed(2)}` });
  }

  // S5 — unverified mega-position (small-unscored ONLY; recognized-unscored exempt)
  let s5 = 0;
  holdings.forEach((h, i) => {
    if (bucket[i] === "small_unscored" && w[i] * 100 > K.S5_THRESH) {
      const before = s5;
      s5 = Math.min(s5 + K.S5_PER, K.S5_CAP);
      structureLedger.push({ rule: "S5", symbol: h.symbol, points: s5 - before, detail: `small-unscored ${(w[i] * 100).toFixed(1)}% > ${K.S5_THRESH}% → −${(s5 - before).toFixed(0)}` });
    }
  });

  const structure = Math.max(0, 100 - s1 - s2 - s3 - s4 - s5);

  // ── Signals (A.7) — start 100, penalty-only, headline-wins then single-largest ──
  const signalsLedger: SignalsDeduction[] = [];
  let signalsDed = 0;
  holdings.forEach((h, i) => {
    if (h.findings.length === 0) return;
    const hasHeadline = h.findings.some((f) => f in HEADLINE);
    // candidates (base magnitudes); if any headline fires, breadth candidates are suppressed
    const candidates: { source: FindingKind; base: number }[] = [];
    for (const f of h.findings) {
      if (f in HEADLINE) candidates.push({ source: f, base: HEADLINE[f]! });
      else if (!hasHeadline && f in BREADTH) candidates.push({ source: f, base: BREADTH[f]! });
      // field-verdicts / LM patterns are simply not in either map → never deduct
    }
    if (candidates.length === 0) return;
    // single largest (do NOT sum two lenses on one troubled name)
    const winner = candidates.reduce((a, b) => (b.base > a.base ? b : a));
    const points = Math.min(winner.base * w[i], K.SIG_HOLDING_CAP * w[i]); // clamp per-holding
    signalsDed += points;
    signalsLedger.push({ symbol: h.symbol, weight: w[i], source: winner.source, points });
  });
  const signals = Math.max(0, 100 - signalsDed);

  // (1.2 Change 4/5) health-read enrichments — computed over the SCORED holdings only.
  const pillarProfile = computePillarProfile(holdings, bucket, w);
  const lensProfile = computeLensProfile(holdings, bucket, w);

  // (1.1 Change 2) COPY-ONLY tiers — pure functions of N and total value. Computed here
  // for a single source, but NOTHING above (S-rules, pillars) reads them and NOTHING below
  // feeds them back into the number. Part B uses them to select copy tone.
  const structureTier = K.structureTierOf(holdings.length);
  const capitalTier = K.capitalTierOf(totalValue);

  // ── Combine (1.2 Change 1+3) — Health = Quality − 0.20×(100−Signals), NO structure term,
  //    NO coverage ceiling. Floored at 0, rounded, banded. The number shows TRUE. ──
  if (!evaluable) {
    // c=0 → no Health; construction-read only (Structure/Signals still computed).
    return {
      evaluable: false, health: null, band: null, provisional: false,
      quality: null, structure, signals, coverage, totalValue, scoredValue,
      recognizedUnscoredValue, smallUnscoredValue, structureLedger, signalsLedger,
      s2Evaluable, neff, pillarProfile: null, lensProfile: null, structureTier, capitalTier,
    };
  }

  const health = Math.round(Math.max(0, (quality as number) - K.W_SIGNAL * (100 - signals)));
  const provisional = coverage < K.PROVISIONAL_BELOW; // the only honesty tag on the number now

  return {
    evaluable: true, health, band: K.bandOf(health), provisional,
    quality, structure, signals, coverage, totalValue, scoredValue,
    recognizedUnscoredValue, smallUnscoredValue, structureLedger, signalsLedger, s2Evaluable, neff,
    pillarProfile, lensProfile, structureTier, capitalTier,
  };
}

// ── (1.2 Change 4) pillarProfile — position-weighted pillar means over the SCORED holdings,
//    renormalized over the scored weight that carries pillar data (== Quality's denominator,
//    since every real ScoreSnapshot has pillar subtotals). Characterizes where the quality
//    comes from; NEVER predicts. null when not evaluable / no pillar data. ─────────────────
function computePillarProfile(holdings: PhsHolding[], bucket: Bucket[], w: number[]): PillarProfile | null {
  let f = 0, m = 0, mk = 0, o = 0, wp = 0;
  holdings.forEach((h, i) => {
    if (bucket[i] !== "scored" || !h.pillars) return;
    f += w[i] * h.pillars.foundation;
    m += w[i] * h.pillars.momentum;
    mk += w[i] * h.pillars.market;
    o += w[i] * h.pillars.ownership;
    wp += w[i];
  });
  if (wp <= 0) return null;
  return { foundation: f / wp, momentum: m / wp, market: mk / wp, ownership: o / wp };
}

// ── (1.2 Change 5) lensProfile — position-weighted share of the book's fired lens FINDINGS
//    by nature (absolute / peer / trend). A findings-CHARACTER read: each fired lens pattern
//    contributes its holding's weight to its nature bucket. NEVER score attribution. null
//    when no lens patterns fired across the book. ───────────────────────────────────────────
function computeLensProfile(holdings: PhsHolding[], bucket: Bucket[], w: number[]): LensProfile {
  let a = 0, p = 0, t = 0;
  holdings.forEach((h, i) => {
    if (bucket[i] !== "scored" || !h.lensNatures) return;
    for (const nat of h.lensNatures) {
      if (nat === "absolute") a += w[i];
      else if (nat === "peer") p += w[i];
      else if (nat === "trend") t += w[i];
    }
  });
  const total = a + p + t;
  if (total <= 0) return null; // no lens patterns fired → honest null (never a fabricated split)
  return { absolute: a / total, peer: p / total, trend: t / total };
}
