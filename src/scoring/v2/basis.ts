// File: src/scoring/v2/basis.ts
//
// CHANGE 2.8 — PER-COMPANY ACCOUNTING BASIS.
//
// v1 reads standalone accounts exclusively (metrics/load.ts:5, "It NEVER reads
// consolidated"). For nine named companies that means scoring a holding structure rather
// than a business: 51 of 113 companies differ by more than 25% between standalone and
// consolidated revenue and 27 differ by more than 100%. DIXON's standalone revenue fell
// 47% while consolidated rose 17x, and its standalone operating cash was -Rs104cr against
// consolidated +Rs1,782cr.
//
// A BLANKET SWITCH FAILS (-0.0326 on the reserve arm). The trigger is the divergence
// itself, decided per company and recorded here rather than inferred at runtime — an
// automatic rule would flip a company's basis the first quarter a subsidiary was sold.
//
// EVIDENCE: this change measures EXACTLY NOTHING (-0.02pp, band [-0.42, 0.44]). It is
// carried because it is the difference between scoring a company and scoring its holding
// structure — a correctness argument, not a tracking one.
//
// ⚠ ONE OPEN CONCERN, CARRIED NOT HIDDEN. M&M's Foundation level drops roughly 17-25
//   points on consolidated, because Mahindra Finance consolidates in and buries the auto
//   business. Its DIRECTION improves — the score now rises as the verdicts improve, where
//   the live score fell — but the level change deserves scrutiny and may be the wrong call
//   for that one name.
//
// ★ THE SWITCH APPLIES TO BOTH SIDES OF FOUNDATION, WHICH IS A DELIBERATE DEPARTURE FROM
//   THE CALIBRATION. u6.cjs switches only the ANNUAL cohort (srcIndex reads cfg.basis) and
//   leaves the quarterly rows on standalone (momentumGrid / momHist read L.Qs with no basis).
//   That was coherent while Foundation was wholly annual. It stopped being coherent the
//   moment change 2.1 gave six Foundation metrics a QUARTERLY numerator: the result is a
//   standalone numerator over a consolidated denominator, which is not a ratio of anything.
//
//   MEASURED (tmp/v2/basis-probe.ts) — ROCE as standalone/standalone, consolidated/standalone
//   (the calibration's arrangement), consolidated/consolidated:
//       RELIANCE   7.26 /  3.97 /  9.93
//       TATAPOWER  7.66 /  2.68 /  8.20
//       M&M       28.15 /  8.88 / 14.65
//   The mixed arm is the outlier LOW in every one of the nine, and those nine dominate the
//   largest score falls in the whole v1->v2 diff. The spec's own open concern — "M&M's
//   Foundation level drops roughly 17-25 points on consolidated, because Mahindra Finance
//   consolidates in and buries the auto business" — is very likely this artefact rather than
//   a property of consolidated M&M, since a coherent consolidated read puts its ROCE at
//   14.65, not 8.88.
//
//   Change 2.8 is carried on a CORRECTNESS argument and measures exactly nothing (-0.02pp,
//   band [-0.42, 0.44]). An implementation that produces an incoherent ratio fails that
//   argument on its own terms, so both sides move together. The cost is that Foundation for
//   these nine no longer reconciles to the reference panel, which embeds the mixed read.
//
// ⚠ MOMENTUM IS UNCHANGED and stays standalone. Its metric definitions are untouched by v2
//   (the panel runs ), and 2.8 is an argument about which accounts describe the
//   business, which the calibration applies to the Foundation cohort alone.

/** The nine companies scored on CONSOLIDATED annual accounts under v2 (spec §2.8). */
export const CONSOLIDATED_BASIS = new Set<string>([
  "TATAPOWER", "M&M", "VOLTAS", "WIPRO", "VEDL", "LUPIN", "ONGC", "RELIANCE", "TATASTEEL",
]);

export type AccountingBasis = "standalone" | "consolidated";

/** The accounting basis for a symbol. Applies to BOTH sides of Foundation's rolling ratios;
 *  Momentum is always standalone. */
export function basisFor(symbol: string): AccountingBasis {
  return CONSOLIDATED_BASIS.has(symbol) ? "consolidated" : "standalone";
}
