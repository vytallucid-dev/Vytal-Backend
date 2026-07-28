// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// PATTERN-LIBRARY SEED · STOCK — deterministic readings assembled from scored data, ZERO AI.
//
// These two composers were rescued from the removed AI card surfaces (insight/stock-insight.ts and
// explain/stock-health.ts). They author a real reading of a stock's health from the SAME scored view
// the page renders — no model, no network, no clock, no derived number — which is structurally what
// the deterministic pattern library will do. They are kept here, out of src/ai/, as proven seed
// material for that build.
//
// ★ PROVEN GUARDRAIL-CLEAN. `composeDeterministicFallback` (and, since the rescue, the structured
// reading below) are scanned across the live universe by scripts/verify-ai-portfolio-fallback.ts
// against BOTH the shared forward-language vocabulary and the runtime AI guardrail.
//
// ★ THE CARD ENVELOPE IS SHED. The structured composer used to return the AI card's wire type
// (`StockInsight`: surface/subject/status/generatedBy). That envelope belonged to the deleted surface;
// here it returns a neutral `DeterministicStockReading`. The pattern library will define its own shape.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { HealthSnapshotView } from "../../scoring/read/health-view.types.js";

/** A short figure a sentence rests on — copied verbatim from a fact line, never computed. */
export interface ReadingCitation {
  label: string;
  value: string;
}

/** One sentence plus the citations it rests on. */
export interface ReadingPoint {
  text: string;
  cites: ReadingCitation[];
}

/** The neutral structured reading — the card envelope (surface/status/generatedBy) deliberately shed.
 *  `scored: false` is the honest-empty state: no headline, no drivers. */
export interface DeterministicStockReading {
  symbol: string;
  scored: boolean;
  headline: ReadingPoint | null;
  drivers: ReadingPoint[];
  tension: ReadingPoint | null;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE STRUCTURED READING — assembled entirely from `view`; no model, no recompute, no derived number.
// Scores are rounded with the SAME Math.round the fact block and the UI use, so it and the page cannot
// disagree — and every citation points at a real block label whose value it carries. Guardrail-clean by
// construction (fixed templates over enumerated facts).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export function composeDeterministicStockInsight(view: HealthSnapshotView): DeterministicStockReading {
  const id = view.identity;

  // Not scored → the honest-empty reading. The page's own "not scored" panel owns this state.
  if (!view.scored || !view.verdict) {
    return { symbol: id.symbol, scored: false, headline: null, drivers: [], tension: null };
  }

  const vd = view.verdict;
  const composite = Math.round(vd.composite);
  const headline: ReadingPoint = {
    text: `${id.name} (${id.symbol}) scores ${composite} — ${vd.label.label}.`,
    cites: [{ label: "Composite health score", value: String(composite) }],
  };

  // Drivers: the top pillars by subtotal, one fixed-template sentence each (2–3).
  const drivers: ReadingPoint[] = [...view.pillars]
    .filter((p) => Number.isFinite(p.subtotal))
    .sort((a, b) => b.subtotal - a.subtotal)
    .slice(0, 3)
    .map((p) => {
      const n = Math.round(p.subtotal);
      return { text: `${cap(p.pillar)} scores ${n}.`, cites: [{ label: p.pillar.toUpperCase(), value: String(n) }] };
    });

  // Tension: the divergence line when the facts flag a high/low pair.
  let tension: ReadingPoint | null = null;
  if (vd.divergence.high && vd.divergence.low) {
    const hi = vd.divergence.high;
    const lo = vd.divergence.low;
    const spread = vd.divergence.flag === "wide" ? ", a wide spread" : "";
    tension = {
      text: `Its strongest pillar is ${cap(hi.pillar)} at ${Math.round(hi.subtotal)} and its weakest is ${cap(lo.pillar)} at ${Math.round(lo.subtotal)}${spread}.`,
      cites: [
        { label: "Divergence highest pillar", value: String(Math.round(hi.subtotal)) },
        { label: "Divergence lowest pillar", value: String(Math.round(lo.subtotal)) },
      ],
    };
  }

  return { symbol: id.symbol, scored: true, headline, drivers, tension };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE PROSE READING — the richest of the seed composers.
//
// Its bulk is the fired lens-pattern `verdict` sentences (composed in scoring/lens-patterns/
// standing-context.ts), replayed verbatim. Everything is read off `view`; nothing is recomputed and no
// number is derived. Scores are rounded with the same Math.round the fact block and the UI use.
//
// ★ PROVEN by verify-ai-portfolio-fallback.ts §4, which scans this function's output across the live
// universe AND enumerates the standing-context verdict corpus exhaustively, through the runtime AI
// guardrail — the SAME gate whose failure used to summon this fallback in the first place.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export function composeDeterministicFallback(view: HealthSnapshotView): string {
  const id = view.identity;
  const vd = view.verdict;
  if (!view.scored || !vd) {
    return `${id.name} (${id.symbol}) is not currently scored, so no health reading exists for it.`;
  }

  const parts: string[] = [`${id.name} (${id.symbol}) scores ${Math.round(vd.composite)} — ${vd.label.label}.`];

  if (vd.trajectoryMarker) parts.push(`The trajectory is ${vd.trajectoryMarker}.`);

  if (vd.divergence.high && vd.divergence.low) {
    const spread = vd.divergence.flag === "wide" ? ", a wide spread between the two" : "";
    parts.push(
      `Its strongest pillar is ${cap(vd.divergence.high.pillar)} at ${Math.round(vd.divergence.high.subtotal)} ` +
        `and its weakest is ${cap(vd.divergence.low.pillar)} at ${Math.round(vd.divergence.low.subtotal)}${spread}.`,
    );
  }

  // The fired lens sentences — verbatim, catalog-derived, already proven non-advisory.
  for (const p of view.pillars) {
    for (const lp of p.lensPillarPatterns ?? []) if (lp.verdict) parts.push(lp.verdict);
    for (const m of p.metrics ?? []) if (m.lensPattern?.verdict) parts.push(m.lensPattern.verdict);
  }

  return parts.join(" ");
}
