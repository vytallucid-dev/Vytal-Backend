// ─────────────────────────────────────────────────────────────────────────────
// PHS ENGINE (Part A) — pure. Turns a book of holdings into the Portfolio Health
// Score + pillars + full deduction ledgers. No DB, no findings analysis, no advice.
//
// INVIOLABLE LAWS enforced HERE (not just copied):
//  • Structure & Signals are PENALTY-ONLY (start 100, only subtract) → PHS ≤ Quality
//    always. Construction can never inflate a book above its holdings' quality.
//  • Field-verdicts (LM3/LM4/LP2/LP3, all LM1–LM8) are NOT in the Signals deduction
//    table → they can never deduct (a fact about a peer group, never a penalty).
//  • Honest-empty: no scored holdings (c=0) → NO PHS (construction-read only), never
//    a fabricated number.
// All math to the A.13 constants exactly.
// ─────────────────────────────────────────────────────────────────────────────
import * as K from "./constants.js";

export type McapTier = "large" | "mid" | "small" | "unknown";
export type Bucket = "scored" | "recognized_unscored" | "small_unscored";

/** The fired findings Signals consumes (already deduplicated by the findings store). */
export type FindingKind = "distress" | "critical" | "high" | "medium" | "lp5" | "lp6";

export interface PhsHolding {
  symbol: string;
  marketValue: number; // quantity × current price (any consistent unit)
  tier: McapTier;
  sector: string | null; // null ⇒ unknown-sector
  health: number | null; // scored ⇒ 0..100; unscored ⇒ null
  findings: FindingKind[]; // fired findings for this holding (empty if none/unscored)
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
  phs: number | null; // published integer; null when !evaluable
  phsRaw: number | null; // pre-ceiling (full precision)
  band: string | null;
  provisional: boolean; // c < 0.40
  ceilingApplied: boolean; // ceiling < phsRaw
  ceilingValue: number | null; // ceiling in force (null when none / not evaluable)
  quality: number | null;
  structure: number;
  signals: number;
  coverage: number;
  totalValue: number;
  scoredValue: number;
  recognizedUnscoredValue: number;
  smallUnscoredValue: number;
  structureLedger: StructureDeduction[];
  signalsLedger: SignalsDeduction[];
  s2Evaluable: boolean; // false ⇔ unknown-sector weight > 50% (S2 omitted honestly)
  neff: number; // effective holdings (inverse Herfindahl)
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

  // S1 — single position (per-holding, additive, each capped)
  let s1 = 0;
  holdings.forEach((h, i) => {
    const pct = w[i] * 100;
    if (pct > K.S1_THRESH) {
      const ded = Math.min(K.S1_RATE * (pct - K.S1_THRESH), K.S1_CAP);
      s1 += ded;
      structureLedger.push({ rule: "S1", symbol: h.symbol, points: ded, detail: `${pct.toFixed(1)}% > ${K.S1_THRESH}% → −${ded.toFixed(2)}` });
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

  // ── Combine + coverage ceiling (A.8) ──
  if (!evaluable) {
    // c=0 → no PHS; construction-read only (Structure/Signals still computed).
    return {
      evaluable: false, phs: null, phsRaw: null, band: null, provisional: false,
      ceilingApplied: false, ceilingValue: null, quality: null, structure, signals,
      coverage, totalValue, scoredValue, recognizedUnscoredValue, smallUnscoredValue,
      structureLedger, signalsLedger, s2Evaluable, neff,
    };
  }

  const phsRaw = Math.max(0, (quality as number) - K.W_STRUCT * (100 - structure) - K.W_SIGNAL * (100 - signals));
  const ceiling = K.ceilingFor(coverage);
  const capped = Math.min(phsRaw, ceiling);
  const phs = Math.round(capped);
  const ceilingApplied = ceiling < phsRaw;
  const provisional = coverage < K.PROVISIONAL_BELOW;

  return {
    evaluable: true, phs, phsRaw, band: K.bandOf(phs), provisional,
    ceilingApplied, ceilingValue: Number.isFinite(ceiling) ? ceiling : null,
    quality, structure, signals, coverage, totalValue, scoredValue,
    recognizedUnscoredValue, smallUnscoredValue, structureLedger, signalsLedger, s2Evaluable, neff,
  };
}
