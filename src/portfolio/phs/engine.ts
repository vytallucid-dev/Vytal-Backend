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
import { buildEntityLedger, buildBasketLedger, sleevesOf, c1Of, c2Of, grossOf, buildSectorResolution, c3Of, c4Of, c5Of, c6Of, netOf, buildExposures, archetypeOf, type AssetClass, type EntityLedgerEntry, type BasketEntry, type Sleeves, type GrossResult, type SectorResolution, type ConstructionResult } from "./entity.js";

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
  // (Construction v2 Stage 1) POSITION FACTS for the entity model — nature + entity key are derived
  // from these (see entity.ts). Optional so legacy/synthetic holdings need not carry them; the REAL
  // path (assemblePortfolio) always sets all three. Inside the §A.1 engine-input boundary: they are
  // position facts (what the instrument IS), never returns/behaviour.
  isin?: string | null;
  assetClass?: AssetClass;
  category?: string | null; // AMFI category leaf — only used to split commodity from basket ETFs
  fundHouse?: string | null; // (Stage 5) resolved AMC of a fund product — C5 reads it; null otherwise
  /** (Stage 9) the instrument's catalog name — DISPLAY ONLY; nothing that scores reads it. A fund's
   *  `symbol` IS its isin (assemble.ts:509), so PB6's bind would otherwise name a fund "INF204K01234".
   *  A stock never needs it. Still a §A.1 position fact: what the instrument IS, never how it behaved. */
  name?: string | null;
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
  signals: number;
  coverage: number; // true scored share (c)
  totalValue: number;
  scoredValue: number;
  recognizedUnscoredValue: number;
  smallUnscoredValue: number;
  signalsLedger: SignalsDeduction[];
  // (1.2 Change 4/5) — health-read enrichments (null when !evaluable)
  pillarProfile: PillarProfile | null; // position-weighted pillar means over scored weight
  lensProfile: LensProfile; // findings-character shares by nature; null ⇔ no lens patterns
  // (1.1 Change 2) COPY-ONLY tiers — derived from N and total value; NOTHING in the score
  // reads them (the number is byte-identical with or without them). Part B copy selector.
  capitalTier: CapitalTier; // Modest | Moderate | Substantial (from total book value ₹)
  // (Construction v2 Stage 1) the entity ledger — name-risk holdings aggregated by 7-char issuer
  // stem (NTPC stock + NTPC bond = ONE entity at their combined weight). Computed once here alongside
  // the score; read by NO deduction this stage. NOT in fingerprintOf (nothing consumes it yet — §12
  // brings the aggregated weight vector into the fingerprint at Stage 7, when C1/C2/C4 read it).
  entityLedger: EntityLedgerEntry[];
  // (Stage 9) the basket ledger — every fund/ETF held, UNaggregated. The mirror of entityLedger: name-risk
  // aggregates by issuer and lands there, baskets land here. Read by NO deduction (C5 does its own loop
  // over the same set and owns `houseUnknown`); PB6/PC6/PC7 read it, and Stage 7 persists it as
  // `construction_data.baskets`.
  basketLedger: BasketEntry[];
  // (Construction v2 Stage 2) sleeve shares — the book split by nature (name-risk / basket).
  sleeves: Sleeves;
  // (Construction v2 Stage 3) C1 + C2 → Gross. The FIRST CV2 deductions. Computed once, read by no
  // display (§8: Gross is never a competing score) and by none of the live S-rules. NOT in fingerprintOf.
  gross: GrossResult;
  // (Construction v2 Stage 4) sector resolution — three states (resolved/unknown/not_applicable), the
  // sectorable-denominator gate, and per-sector resolved weights for C3/C4 (Stage 5).
  sectors: SectorResolution;
  // (Construction v2 Stage 5 — THE CUTOVER) the full Construction decomposition: Gross (C1+C2) − C3 −
  // C4 − C5 − C6 → net. `construction.net` is THE DISPLAYED Construction — persist writes it into the
  // `structure` COLUMN (the read/FE render `structure`, now = Net). The engine field `structure` below
  // stays the LEGACY S-composite: S1–S5 are not deleted this stage (§15 is a DESIGN statement, not a
  // sequencing one — ruling ①), they simply no longer feed the displayed number. Their last consumers
  // (patterns.ts's PX findings; the FE structureLedger render) stay alive on `structure`/`structureLedger`
  // until Stage 6 (display) and Stage 9 (findings) repoint them to `construction`. NOT in fingerprintOf
  // (Stage 7, §12) — the CONSTANT_VERSION bump is what re-persists every book onto the Net number.
  construction: ConstructionResult;
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

  // ── Structure — DELETED (§15). S1–S5 are gone; Construction (C1–C6, entity.ts) is the structural
  //    read, and `construction.net` is the number persisted into the `structure` COLUMN and displayed.
  //
  //    S1 relative-threshold · S2 sector · S3 Neff · S4 count · S5 unverified-mega-position ran from
  //    v1 to Construction v2 Stage 9. They were the whole structural model; C1–C6 replaced them fact by
  //    fact (S1≡C1 proven byte-identical at Stage 5; S2→C3 sector; S3→C2 breadth — the mapping is by
  //    MEANING, not digit: ODL cv2-s9-gate-semantics).
  //
  //    ★ THE IDIOM SURVIVES THE RULES (§15 lists it ALIVE). S1's relative threshold —
  //    `max(15, 1.5 × fairShare)` — was v1's best idea: on a thin book the bar RISES, so a
  //    concentration rule stops double-charging the thinness a breadth rule already prices. It lives on
  //    in C1 (`c1Of`, same shape) and is reused by C4's `target = min(C4_TARGET, Neff_unit)`.
  //    DELETE THE RULES, NOT THE IDEA.
  //
  //    The HISTORY survives too: `structure_ledger` is nullable and still holds 31 rows of real S-ledgers
  //    — the only record of how every book was read before the cutover. persist stops WRITING it; nothing
  //    drops it. You cannot un-drop history (ODL, Stage 7).

  // ── Signals (A.7) — start 100, penalty-only, headline-wins then single-largest ──
  //
  // (Construction v2 Stage 0 — Ruling i) A finding's deduction is weighted by the holding's
  // SCORED-renormalized weight w_i/ΣwScored (== marketValue_i / scoredValue), NOT the whole-book
  // w_i. This makes Signals SYMMETRIC with Quality: both Health inputs share ONE denominator — the
  // capital we can actually see (the scored book). A red flag is KNOWLEDGE about a business (§13);
  // its weight belongs among the businesses we know, and holding ₹90L of gilt funds does not make
  // the flag less true. Diluting it by the gilt would make the arithmetic say something the model
  // does not mean.
  //
  // Pre-CV2 this used raw w_i, which was identical ONLY while every book was stocks-only-and-scored
  // (scoredValue == totalValue → ΣwScored == 1). The moment unscored capital (a fund, an unpriced
  // stock) enters the weight vector, raw w_i would silently shrink a flagged name's deduction and
  // LIFT Signals — hence Health — for no reason the model means. So this is a §13-adjacent BUG FIX
  // restoring intended semantics, NOT a redesign: Health's LAW (Quality − 0.20×(100−Signals)) is
  // untouched; only Signals' weight DENOMINATOR is corrected to match its sibling's. By
  // construction the weight vector can now never move Health — Quality renormalizes, Signals
  // renormalizes — so §13's contamination guard is enforced by SYMMETRY, not by exclusion.
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
    // scored-renormalized weight (see the block header). Findings fire ONLY on scored holdings, so
    // this holding is always inside ΣwScored and wSig is well-defined (never a divide-by-zero).
    const wSig = sumWScored > 0 ? w[i] / sumWScored : 0;
    const points = Math.min(winner.base * wSig, K.SIG_HOLDING_CAP * wSig); // clamp per-holding
    signalsDed += points;
    signalsLedger.push({ symbol: h.symbol, weight: wSig, source: winner.source, points });
  });
  const signals = Math.max(0, 100 - signalsDed);

  // (1.2 Change 4/5) health-read enrichments — computed over the SCORED holdings only.
  const pillarProfile = computePillarProfile(holdings, bucket, w);
  const lensProfile = computeLensProfile(holdings, bucket, w);

  // (1.1 Change 2) COPY-ONLY tiers — pure functions of N and total value. Computed here
  // for a single source, but NOTHING above (S-rules, pillars) reads them and NOTHING below
  // feeds them back into the number. Part B uses them to select copy tone.
  const capitalTier = K.capitalTierOf(totalValue);

  // (Construction v2 Stage 1) the entity ledger — name-risk holdings aggregated by issuer stem. Pure,
  // computed once. It is Construction arithmetic over the weight vector; it touches neither Quality
  // nor Signals.
  const entityLedger = buildEntityLedger(holdings, totalValue);
  // (Stage 9) the basket ledger — the other half of the book. Same properties: pure, computed once,
  // Construction-only, touches neither Quality nor Signals.
  const basketLedger = buildBasketLedger(holdings, totalValue);
  // (Construction v2 Stage 2 + 3) sleeve shares, then C1/C2 → Gross. Computed once here. NONE of this
  // reaches Health (Quality/Signals above are already fixed) or the S-rules — it is a parallel read.
  // (Stage 7 §12) `exposures` is computed ONCE, here, and `sleeves` is PROJECTED from it. Both used to
  // sum nameRisk/basket independently — one fact with two homes. Exposures is the superset, so it leads.
  const exposures = buildExposures(holdings, totalValue);
  const sleeves = sleevesOf(exposures);
  const c1 = c1Of(entityLedger, holdings.length, sleeves.nameRisk); // N = POSITIONS (the weight vector length)
  const c2 = c2Of(entityLedger, sleeves.nameRisk);
  const gross: GrossResult = { value: grossOf(c1, c2), c1, c2 };
  // (Construction v2 Stage 4) sector resolution — three states + the sectorable-denominator gate.
  const sectors = buildSectorResolution(holdings, totalValue);
  // (Construction v2 Stage 5 — THE CUTOVER) C3–C6 → Net. This is the DISPLAYED Construction (persist
  // writes construction.net into the `structure` column). It reads ONLY the Construction-side facts
  // (entity ledger, sleeves, sector resolution, fund houses) — never Quality or Signals, which are
  // already fixed above — so §13 holds by construction: Health cannot see any of this.
  const c3 = c3Of(sectors);
  const c4 = c4Of(entityLedger, sectors);
  const c5 = c5Of(holdings, totalValue);
  const c6 = c6Of(holdings.length); // N = positions
  // (Stage 6) the descriptive composition read — archetype over the exposures computed above. Purely
  // descriptive, never scored.
  const archetype = archetypeOf(exposures);
  const construction: ConstructionResult = { gross, c3, c4, c5, c6, net: netOf(gross.value, c3, c4, c5, c6), archetype, exposures };

  // ── Combine (1.2 Change 1+3) — Health = Quality − 0.20×(100−Signals), NO structure term,
  //    NO coverage ceiling. Floored at 0, rounded, banded. The number shows TRUE. ──
  if (!evaluable) {
    // c=0 → no Health; construction-read only (Construction/Signals still computed).
    return {
      evaluable: false, health: null, band: null, provisional: false,
      quality: null, signals, coverage, totalValue, scoredValue,
      recognizedUnscoredValue, smallUnscoredValue, signalsLedger,
      pillarProfile: null, lensProfile: null, capitalTier,
      entityLedger, basketLedger, sleeves, gross, sectors, construction,
    };
  }

  const health = Math.round(Math.max(0, (quality as number) - K.W_SIGNAL * (100 - signals)));
  const provisional = coverage < K.PROVISIONAL_BELOW; // the only honesty tag on the number now

  return {
    evaluable: true, health, band: K.bandOf(health), provisional,
    quality, signals, coverage, totalValue, scoredValue,
    recognizedUnscoredValue, smallUnscoredValue, signalsLedger,
    pillarProfile, lensProfile, capitalTier, entityLedger, basketLedger, sleeves, gross, sectors, construction,
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
