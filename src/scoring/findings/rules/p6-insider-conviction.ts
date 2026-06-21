// File: src/scoring/findings/rules/p6-insider-conviction.ts
//
// P6 — Insider Conviction (File 1 §5E · pattern · Green +5). FEED-GATED (insider feed LIVE
// since the C/D activation → displayState ACTIVE, never "pending"). Reads the SAME
// FiringContext.feeds.insiderTxns the Ownership C-flow scores.
//
// ROLE SPLIT (single-signal vs P10): P6 reads NON-PROMOTER insiders (director / KMP) buying —
// the "conviction" of the people running the business. P10 owns PROMOTER buying (defense).
// So P6 and P10 never double-count the same trade.
//
// SINGLE-SIGNAL vs the C-flow: the Ownership C-category moves the SCORE (a pillar subtotal);
// P6 is the §5 CARD that NARRATES it (which insiders, how much) — the score moves silently,
// the card explains. Different surfaces, per File 1. PIT: txns are already ≤ cutoff (loader).

import type { FireRule } from "../types.js";

export const INSIDER_WINDOW_DAYS = 90;     // the trailing quarter
export const INSIDER_ELIGIBLE_CR = 1;      // ≥₹1cr per txn (matches the C-flow eligibility)
export const P6_MIN_NET_CR = 2;            // material net buy — FLAG: provisional
export const P6_MIN_BUYERS = 1;            // ≥1 director making a MATERIAL buy ⇒ conviction (the
// insider feed is sparse; a single director's ₹2cr+ buy is the conviction signal). FLAG: provisional.

export const ruleP6: FireRule = (ctx) => {
  const txns = ctx.feeds.insiderTxns;
  if (!txns || !txns.length) return null; // no feed for this stock → simply doesn't fire (not "pending")
  const anchor = (ctx.shareholding[ctx.shareholding.length - 1]?.asOnDate ?? ctx.asOfDate).getTime();
  const from = anchor - INSIDER_WINDOW_DAYS * 86400_000;
  const win = txns.filter((t) => t.role === "director" && t.valueInrCr >= INSIDER_ELIGIBLE_CR && t.date.getTime() > from && t.date.getTime() <= anchor);
  const buys = win.filter((t) => t.side === "buy"), sells = win.filter((t) => t.side === "sell");
  const netCr = buys.reduce((s, t) => s + t.valueInrCr, 0) - sells.reduce((s, t) => s + t.valueInrCr, 0);
  const distinctBuyers = new Set(buys.map((t) => t.insiderId)).size;
  if (netCr < P6_MIN_NET_CR || distinctBuyers < P6_MIN_BUYERS) return null;

  const r0 = (x: number) => Math.round(x);
  return {
    kind: "pattern",
    key: "ownership_P6_insider_conviction",
    severity: "green", // §5E Green
    direction: "positive",
    magnitude: 5, // §5E +5
    displayState: "active", // feed LIVE
    evidence: {
      pattern: "P6", name: "Insider Conviction",
      windowDays: INSIDER_WINDOW_DAYS, netBuyCr: r0(netCr), distinctBuyers, buyTxns: buys.length, sellTxns: sells.length,
      verdict: `Insider conviction — ${distinctBuyers} directors/KMP bought a net ₹${r0(netCr)} Cr over the last quarter.`,
    },
    metricRefs: ["insiderTxns"],
  };
};
