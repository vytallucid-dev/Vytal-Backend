// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUARTER IN BRIEF — THE SINGLE RENDERING OF EVERY FIGURE.
//
// ★ THIS FILE IS THE ONE PLACE A NUMBER BECOMES A STRING for Quarter in Brief. Nothing in the feature
//   formats money, a percentage or a ratio anywhere else. One figure, one rendering.
//
// ── WHY THIS IS NOT `relational/copy.ts`'s formatINR ────────────────────────────────────────────────
// The backend already has a formatINR. It takes RUPEES and renders lakh/crore for portfolio-scale
// amounts (₹2.4 lakh · ₹18,000) — a different input unit and a different call site. Pointed at a
// ₹ crore figure it renders 15547.66 as "₹15547.7 crore": ungrouped, one decimal. The Results card
// six pixels away renders the same figure "₹15,548 Cr". A reader who cannot read a statement has no
// way to tell which of those is the real number, so the card wins and this module matches it.
//
// ── ⚠ THE CROSS-REPO OBLIGATION ─────────────────────────────────────────────────────────────────────
// The card's rule lives in the FRONTEND (Vytal-Frontend/components/stock-detail/overview/shared.tsx,
// `fmtMarketCap`). Two repos cannot share a function without a shared package, and adding one is a new
// dependency. So this is one RULE with two implementations, and the second is held to the first by
// src/scripts/cross-repo/verify-quarter-brief-money.ts, which fails if the frontend rule moves.
// That gate is the only thing standing between "one rendering" and "a third rendering" — if you change
// the function below, change it there too, and let the gate prove it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

/** THE money rendering. Mirrors the frontend's `fmtMarketCap` exactly in magnitude and grouping —
 *  Indian digit groups, whole crore, lakh-crore above 1,00,000 Cr — and differs ONLY in spelling
 *  "crore" out, because "Cr" reads in a stat tile and not in a sentence.
 *
 *  Input is ₹ CRORE (the unit every quarterly/annual table stores). Sign is carried by the caller's
 *  phrasing, never by the glyph: "a loss of ₹12 crore" reads; "₹-12 crore" does not. */
export function money(cr: number): string {
  const v = Math.abs(cr);
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(2)} lakh crore`;
  // Below a crore, whole-crore rounding would print "₹0 crore" for a real figure.
  if (v > 0 && v < 1) return `₹${Math.round(v * 100)} lakh`;
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })} crore`;
}

/** THE frontend rule this module mirrors, as data — read by the cross-repo gate so the two cannot
 *  drift silently. Kept beside the function it describes, not in the gate, so an edit here is
 *  impossible to make without seeing it. */
export const MONEY_RULE = {
  lakhCroreThresholdCr: 100_000,
  locale: "en-IN",
  maximumFractionDigits: 0,
} as const;

/** A margin or ratio ALREADY IN PERCENT, to one decimal — the precision these are stored at. */
export const marginPct = (p: number): string => `${p.toFixed(1)}%`;

// ── ⚠ UNIT SEAM ─────────────────────────────────────────────────────────────────────────────────────
// On the general-insurance quarterly table, `net_margin` is ALREADY PERCENT (-2.2853 → −2.29%) while
// `combined_ratio` is a FRACTION (1.2144 → 121.44%). Same table, same row, two conventions — the same
// seam fundamentals-view.service.ts documents for banking. Passing a combined ratio through marginPct
// renders 1.2144 as "1.2%", which is not a rounding error but a different number by two orders of
// magnitude, in the direction that makes a loss-making insurer look immaculate. Always convert first.
export const fractionToPct = (fraction: number): number => fraction * 100;

/** A combined ratio in PLAIN WORDS. "Combined ratio 121.4%" means nothing to a reader who has never
 *  seen one; what it means is that the insurer paid out more than it took in. Above 100 the
 *  underwriting book lost money — state that arithmetically, without calling it good or bad. */
export function combinedRatioPlain(pctValue: number): string {
  const perHundred = (pctValue).toFixed(2);
  if (pctValue > 100) {
    const short = (pctValue - 100).toFixed(2);
    return `For every ₹100 of premium, ₹${perHundred} went out in claims and costs — ₹${short} more than came in.`;
  }
  const left = (100 - pctValue).toFixed(2);
  return `For every ₹100 of premium, ₹${perHundred} went out in claims and costs, leaving ₹${left}.`;
}
