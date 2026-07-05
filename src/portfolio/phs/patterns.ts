// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO PATTERN LIBRARY (PHS Part B) — pure, definitional. Reads the Part A
// snapshot's already-computed values (pillars, coverage, bucket splits, ledgers) +
// the underlying holdings, and NAMES the findings the single number hid. It fires
// findings; it NEVER recomputes the score (that is Part A's, immutable here).
//
// INVIOLABLE LAWS enforced here:
//  • Definitional, not predictive/advisory: every Read states what the book IS.
//  • Field-verdicts (LM3/LP2) NEVER become a penalty or a negative finding — they
//    feed ONLY PX5, explicitly-neutral (they are NOT in `findings`, never deducted).
//  • Honest-empty: a pattern whose threshold is not declared in portfolio-spec 1.0
//    (PQ2 std-dev tolerance, PQ3 low-dispersion cutoff) does NOT fire — not-evaluable,
//    never fabricated.
//
// Copy is the spec's VERBATIM Read where the spec provides one, with bound values
// interpolated; patterns without a spec Read carry label + bind (UI composes copy).
// ─────────────────────────────────────────────────────────────────────────────
import type { PhsHolding, PhsResult } from "./engine.js";
import { bandOf, BAND_MIXED } from "./constants.js";

export type Tone = "Constructive" | "Neutral" | "Caution" | "Concern";

export interface PfFinding {
  id: string; // "PC1"
  family: string; // "PC" | "PB" | "PQ" | "PS" | "PV" | "PX"
  label: string; // spec-verbatim
  tone: Tone;
  loud: boolean;
  bind: Record<string, unknown>; // exact values the UI renders without recomputing
  read?: string; // spec-verbatim Read (values filled) where the spec provides one
}

/** Field-weak verdicts (LM3/LP2) per holding — for PX5 ONLY. Never a deduction. */
export interface PfContext {
  fieldWeakSymbols: Set<string>;
}

const pct = (w: number) => `${(w * 100).toFixed(1)}%`;

export function firePortfolioFindings(holdings: PhsHolding[], r: PhsResult, ctx: PfContext = { fieldWeakSymbols: new Set() }): PfFinding[] {
  const out: PfFinding[] = [];
  const total = holdings.reduce((s, h) => s + h.marketValue, 0);
  if (total <= 0) return out;
  const W = holdings.map((h) => h.marketValue / total);
  const n = holdings.length;

  const isHeadline = (h: PhsHolding) => h.findings.some((f) => f === "distress" || f === "critical" || f === "high" || f === "medium");

  // ── PC — Concentration (headline for S1/S2/S3; explanation, not extra penalty) ──
  let maxW = 0, maxWi = -1;
  W.forEach((w, i) => { if (w > maxW) { maxW = w; maxWi = i; } });
  if (maxW > 0.25) {
    const h = holdings[maxWi];
    const hb = h.health != null ? bandOf(h.health) : "unscored";
    out.push({ id: "PC1", family: "PC", label: "Heavy single position", tone: "Caution", loud: true,
      bind: { symbol: h.symbol, weight: maxW, healthBand: hb },
      read: `Your largest holding is ${pct(maxW)} of the book. Its health contributes ${pct(maxW)} of the aggregate, so the portfolio read leans heavily on this one name (${h.symbol}, ${hb}).` });
  }
  if (maxW > 0.40) {
    const h = holdings[maxWi];
    out.push({ id: "PC2", family: "PC", label: "Dominant single position", tone: "Concern", loud: true, bind: { symbol: h.symbol, weight: maxW } });
  }

  // sector weights (whole book; unknown pooled) — PC3/PC4/PB1 need known sectors
  const sectorW = new Map<string, number>();
  holdings.forEach((h, i) => { if (h.sector != null) sectorW.set(h.sector, (sectorW.get(h.sector) ?? 0) + W[i]); });
  let maxSector = 0, maxSectorName = "";
  for (const [name, sw] of sectorW) if (sw > maxSector) { maxSector = sw; maxSectorName = name; }
  if (r.s2Evaluable && maxSector > 0.40) {
    out.push({ id: "PC3", family: "PC", label: "Sector concentration", tone: "Caution", loud: true,
      bind: { sector: maxSectorName, weight: maxSector },
      read: `${maxSectorName} makes up ${pct(maxSector)} of your book. Health and risk in this book move substantially with that one sector's fortunes.` });
  }
  if (r.s2Evaluable && maxSector > 0.60) {
    out.push({ id: "PC4", family: "PC", label: "Single-sector book", tone: "Concern", loud: true, bind: { sector: maxSectorName, weight: maxSector } });
  }
  if (r.neff < 5) {
    out.push({ id: "PC5", family: "PC", label: "Thin effective spread", tone: "Caution", loud: true,
      bind: { neff: r.neff, holdingCount: n },
      read: `Although you hold ${n} stocks, weight is concentrated enough that your book behaves like roughly ${r.neff.toFixed(1)} equally-sized positions.` });
  }

  // ── PB — Breadth & diversification quality ──
  if (r.s2Evaluable && r.neff >= 8 && maxSector <= 0.40) {
    out.push({ id: "PB1", family: "PB", label: "Well-spread book", tone: "Constructive", loud: false, bind: { neff: r.neff, maxSectorWeight: maxSector } });
  }
  if (n > 25) out.push({ id: "PB2", family: "PB", label: "Very broad book", tone: "Neutral", loud: false, bind: { holdingCount: n } });
  if (n > 40) {
    out.push({ id: "PB3", family: "PB", label: "Closet-index breadth", tone: "Caution", loud: false, bind: { holdingCount: n },
      read: `With ${n} holdings, your book approaches an index in breadth — individual position moves have little effect on the whole, and it is a lot to monitor by hand.` });
  }

  // ── PQ — Quality composition (scored-holding health distribution) ──
  const scored = holdings.filter((h) => h.health != null);
  const scoredHealth = scored.map((h) => h.health as number);
  if (r.quality != null && r.quality >= 75 && scoredHealth.length > 0 && Math.min(...scoredHealth) >= 65) {
    out.push({ id: "PQ1", family: "PQ", label: "Uniformly sound holdings", tone: "Constructive", loud: false, bind: { quality: r.quality, minScoredHealth: Math.min(...scoredHealth) } });
  }
  // PQ2 (barbell / std-dev "above tolerance") + PQ3 (Quality≤55 "low dispersion"): the
  // std-dev tolerance / low-dispersion cutoff are NOT declared in portfolio-spec 1.0 →
  // HONEST-EMPTY (do not invent a threshold). Reported by the harness.
  holdings.forEach((h, i) => {
    if (h.health != null && h.health < BAND_MIXED && W[i] >= 0.10) {
      out.push({ id: "PQ4", family: "PQ", label: "Weak name at size", tone: "Caution", loud: true,
        bind: { symbol: h.symbol, health: h.health, band: bandOf(h.health), weight: W[i] },
        read: `${h.symbol} sits in the ${bandOf(h.health)} health band at ${pct(W[i])} weight — a material drag on Quality.` });
    }
  });

  // ── PS — Signal exposure (capital-weighted fired findings) ──
  const critHighW = holdings.reduce((s, h, i) => (h.findings.some((f) => f === "critical" || f === "high") ? s + W[i] : s), 0);
  if (critHighW >= 0.10) {
    const names = holdings.filter((h) => h.findings.some((f) => f === "critical" || f === "high")).map((h) => h.symbol);
    out.push({ id: "PS1", family: "PS", label: "Capital under active red flags", tone: "Concern", loud: true,
      bind: { weight: critHighW, symbols: names },
      read: `${pct(critHighW)} of your book by value sits in holdings with active Critical/High red flags (${names.join(", ")}). These are the holdings the model is currently warning on.` });
  }
  holdings.forEach((h, i) => {
    if (h.findings.includes("distress") && W[i] >= 0.05) {
      out.push({ id: "PS2", family: "PS", label: "Distress exposure", tone: "Concern", loud: true, bind: { symbol: h.symbol, weight: W[i] },
        read: `${h.symbol} is in the Distress band at ${pct(W[i])} of the book.` });
    }
  });
  // PS3 — LP5 exposure, EXCLUDING holdings already headlined (B.7 anti-double-count)
  const lp5W = holdings.reduce((s, h, i) => (h.findings.includes("lp5") && !isHeadline(h) ? s + W[i] : s), 0);
  if (lp5W >= 0.25) out.push({ id: "PS3", family: "PS", label: "Broad-erosion exposure", tone: "Caution", loud: true, bind: { weight: lp5W } });
  const lp6W = holdings.reduce((s, h, i) => (h.findings.includes("lp6") ? s + W[i] : s), 0);
  if (lp6W >= 0.25) out.push({ id: "PS4", family: "PS", label: "Fading-strength exposure", tone: "Caution", loud: false, bind: { weight: lp6W } });
  const anyDeducting = holdings.some((h) => h.findings.length > 0);
  if (!anyDeducting) out.push({ id: "PS5", family: "PS", label: "No active red flags", tone: "Constructive", loud: false, bind: {} });

  // ── PV — Visibility & coverage ──
  const c = r.coverage;
  const recogW = r.totalValue > 0 ? r.recognizedUnscoredValue / r.totalValue : 0;
  const smallW = r.totalValue > 0 ? r.smallUnscoredValue / r.totalValue : 0;
  if (c >= 0.90) out.push({ id: "PV1", family: "PV", label: "Fully verified book", tone: "Constructive", loud: false, bind: { coverage: c } });
  if (c < 0.60) out.push({ id: "PV2", family: "PV", label: "Partly verified book", tone: "Neutral", loud: true, bind: { coverage: c } });
  if (r.ceilingApplied) {
    out.push({ id: "PV3", family: "PV", label: "Confidence-limited read", tone: "Neutral", loud: true,
      bind: { coverage: c, ceiling: r.ceilingValue, phsRaw: r.phsRaw },
      read: `Your verified holdings read healthy, but we've confirmed only ${pct(c)} of your book by value, so the score is held at ${r.ceilingValue} rather than the ${r.phsRaw?.toFixed(0)} the verified portion alone would suggest. The read rises as more of your holdings are covered.` });
  }
  if (recogW >= 0.15) out.push({ id: "PV4", family: "PV", label: "Awaiting-coverage names", tone: "Neutral", loud: false, bind: { weight: recogW } });
  if (smallW >= 0.25) out.push({ id: "PV5", family: "PV", label: "Untracked small-caps in book", tone: "Caution", loud: false, bind: { weight: smallW } });

  // ── PX — Cross-pillar tension (reads pillar relationships; orthogonal to PC/PS) ──
  const Q = r.quality, S = r.structure, Sig = r.signals;
  if (Q != null && Q >= 70 && S <= 60) {
    out.push({ id: "PX1", family: "PX", label: "Sound companies, fragile construction", tone: "Caution", loud: true,
      bind: { quality: Q, structure: S },
      read: `The businesses you hold are individually healthy (Quality ${Q.toFixed(0)}), but the way they're weighted concentrates the book (Structure ${S.toFixed(0)}). Your holdings' quality and your book's construction are telling different stories.` });
  }
  if (Q != null && S >= 85 && Q <= 55) out.push({ id: "PX2", family: "PX", label: "Well-built, ordinary components", tone: "Neutral", loud: true, bind: { quality: Q, structure: S } });
  if (Q != null && Q >= 65 && Sig <= 60) {
    out.push({ id: "PX3", family: "PX", label: "Sound holdings, active deterioration", tone: "Caution", loud: true,
      bind: { quality: Q, signals: Sig },
      read: `Your holdings are fundamentally decent (Quality ${Q.toFixed(0)}), but several carry active red flags right now (Signals ${Sig.toFixed(0)}). Long-run quality and current warnings diverge in this book.` });
  }
  if (Q != null && Q >= 70 && S >= 80 && Sig >= 85 && c >= 0.80) out.push({ id: "PX4", family: "PX", label: "Broad strength", tone: "Constructive", loud: true, bind: { quality: Q, structure: S, signals: Sig, coverage: c } });
  const fieldWeakW = holdings.reduce((s, h, i) => (ctx.fieldWeakSymbols.has(h.symbol) ? s + W[i] : s), 0);
  if (fieldWeakW >= 0.30) {
    out.push({ id: "PX5", family: "PX", label: "Weak-field environment", tone: "Neutral", loud: false, // NEVER Caution/Concern; NEVER deducts
      bind: { weight: fieldWeakW },
      read: `A notable share of your book (${pct(fieldWeakW)}) is in holdings our engine reads as leading weak fields — the peer groups themselves are soft on key metrics right now. This is context about the environment your holdings sit in, not a judgment on the holdings.` });
  }

  return out;
}

/** Which patterns are honest-empty because portfolio-spec 1.0 declares no threshold. */
export const NOT_EVALUABLE_UNDECLARED = ["PQ2", "PQ3"] as const;
