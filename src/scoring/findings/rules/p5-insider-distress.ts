// File: src/scoring/findings/rules/p5-insider-distress.ts
//
// P5 — Insider-Confirmed Distress (File 1 §5E · pattern · Red −8). FEED-GATED (LIVE → ACTIVE).
// Insider SELLING that CONFIRMS an already-weak/deteriorating name — the "confirmed" qualifier
// means the selling lands on a stock whose composite is genuinely weak (not a routine trim on
// a healthy name). Reads feeds.insiderTxns (promoter or director, side="sell").
//
// SINGLE-SIGNAL: opposite direction to P6/P10 (selling vs buying). vs the C-flow: the C-category
// moves the SCORE; P5 is the §5 CARD narrating the distress. The composite-weak gate is what
// makes it "confirmed distress" rather than a bare sell-flow restatement.

import type { FireRule } from "../types.js";
import { INSIDER_WINDOW_DAYS, INSIDER_ELIGIBLE_CR } from "./p6-insider-conviction.js";

export const P5_MIN_NET_SELL_CR = 2;   // material net sell — FLAG: provisional
export const P5_MIN_SELLERS = 1;       // ≥1 insider making a MATERIAL sell on an already-weak name
// (a single insider dumping a distressed stock IS the confirmation; the composite-weak gate
// already qualifies it as "distress"). FLAG: provisional.
export const P5_DISTRESS_COMPOSITE = 62; // composite < Below-par top ⇒ genuinely distressed

export const ruleP5: FireRule = (ctx) => {
  const txns = ctx.feeds.insiderTxns;
  if (!txns || !txns.length) return null;
  // "Confirmed DISTRESS": the name must already be weak (composite below the Steady floor).
  if (ctx.current.composite >= P5_DISTRESS_COMPOSITE) return null;

  const anchor = (ctx.shareholding[ctx.shareholding.length - 1]?.asOnDate ?? ctx.asOfDate).getTime();
  const from = anchor - INSIDER_WINDOW_DAYS * 86400_000;
  const win = txns.filter((t) => (t.role === "promoter" || t.role === "director") && t.valueInrCr >= INSIDER_ELIGIBLE_CR && t.date.getTime() > from && t.date.getTime() <= anchor);
  const sells = win.filter((t) => t.side === "sell"), buys = win.filter((t) => t.side === "buy");
  const netSellCr = sells.reduce((s, t) => s + t.valueInrCr, 0) - buys.reduce((s, t) => s + t.valueInrCr, 0);
  const distinctSellers = new Set(sells.map((t) => t.insiderId)).size;
  if (netSellCr < P5_MIN_NET_SELL_CR || distinctSellers < P5_MIN_SELLERS) return null;

  const r0 = (x: number) => Math.round(x);
  return {
    kind: "pattern",
    key: "ownership_P5_insider_distress",
    severity: "red", // §5E Red
    direction: "negative",
    magnitude: -8, // §5E −8
    displayState: "active",
    evidence: {
      pattern: "P5", name: "Insider-Confirmed Distress",
      windowDays: INSIDER_WINDOW_DAYS, netSellCr: r0(netSellCr), distinctSellers, composite: Math.round(ctx.current.composite),
      verdict: `Insider-confirmed distress — ${distinctSellers} insider${distinctSellers > 1 ? "s" : ""} sold a net ₹${r0(netSellCr)} Cr on an already-weak name (composite ${Math.round(ctx.current.composite)}).`,
    },
    metricRefs: ["insiderTxns"],
  };
};
