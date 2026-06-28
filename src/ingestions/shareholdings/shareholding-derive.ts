// ─────────────────────────────────────────────────────────────
// PURE derivation for ShareholdingPattern — deriveFromRow bridge (Stage 1h).
//
// STRUCTURAL NOTE (CN-8 FLAG — the task's premise corrected): the shareholding
// PERCENTAGES are NOT derived from the share COUNTS. promoterPct/publicPct/
// fiiPct/diiPct/mutualFundPct/insurancePct/employeeTrustPct are extracted
// DIRECTLY from the XBRL percentage facts (byCtxV(PCT, …)) and only scale-
// normalised (×100 vs ×1, decided by the promoter+public partition); the counts
// (totalShares/promoterShares/pledgedShares) are an INDEPENDENT XBRL extraction.
// promoterPledgedPct/promoterPledgedSharesPct are parsed-direct from XBRL pledge
// facts (NOT pledgedShares/promoterShares). So there is NO count→percentage
// derivation to extract, and no count-based pledge ratio.
//
// The ONLY column derived from other STORED columns is the residual
// others/retail % = max(0, publicPct − fiiPct − diiPct). banksFisPct (= banks +
// FIs) sums two parser intermediates that are NOT stored columns, so it cannot
// be re-derived from the row → treated as disclosed/fill-as-is, not here.
//
// Consequence for the fill feature: shareholding's fillable surface is almost
// entirely DISCLOSED-RAW (fill the XBRL-disclosed % or count directly, GREEN);
// only othersPct/retailPct recompute, via this one function.
// ─────────────────────────────────────────────────────────────

export const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/**
 * Residual others/retail % = max(0, public − fii − dii). Returns null when
 * fii/dii are absent — the parser then falls back to the non-institutional
 * XBRL context (not a stored column → not re-derivable from the row). retailPct
 * is the same value as othersPct.
 */
export function deriveOthersPct(
  publicPct: number,
  fiiPct: number | null,
  diiPct: number | null,
): number | null {
  if (fiiPct == null || diiPct == null) return null;
  return Math.max(0, round4(publicPct - fiiPct - diiPct));
}
