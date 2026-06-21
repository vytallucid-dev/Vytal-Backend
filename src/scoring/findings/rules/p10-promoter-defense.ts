// File: src/scoring/findings/rules/p10-promoter-defense.ts
//
// P10 — Promoter Defense Buying (File 1 §5E · pattern · Green +5). FEED-GATED (LIVE → ACTIVE).
// The HCLTECH / Vama-Sundari shape: the PROMOTER accumulating into price weakness. Reads
// feeds.insiderTxns role="promoter", side="buy".
//
// "INTO WEAKNESS" (the "defense"): gated on the Market pillar NOT being strong (< 72) — buying
// when the tape is strong isn't defense. A SINGLE promoter buying repeatedly is the signal
// (one entity, many trades) — unlike P6, no ≥2-distinct requirement.
//
// SINGLE-SIGNAL: role-split from P6 (promoter vs director). Distinct from the Ownership Flow A1
// (count-based promoter accumulation + 52w-dip): A1 moves the SCORE off the SHAREHOLDING count;
// P10 is the §5 CARD off the INSIDER TXN feed — different inputs, different surfaces.

import type { FireRule } from "../types.js";
import { INSIDER_WINDOW_DAYS, INSIDER_ELIGIBLE_CR } from "./p6-insider-conviction.js";

export const P10_MIN_NET_CR = 2;       // material promoter net buy — FLAG: provisional
export const P10_MARKET_NOT_STRONG = 72; // Market < strong mark ⇒ "into weakness"

export const ruleP10: FireRule = (ctx) => {
  const txns = ctx.feeds.insiderTxns;
  if (!txns || !txns.length) return null;
  const mkt = ctx.current.pillars.market;
  // "into weakness" — only fire when the tape isn't strong. (If Market is unavailable, treat
  // as eligible — the promoter buy still stands; the weakness gate just can't strengthen it.)
  if (mkt.state === "scored" && mkt.subtotal !== null && mkt.subtotal >= P10_MARKET_NOT_STRONG) return null;

  const anchor = (ctx.shareholding[ctx.shareholding.length - 1]?.asOnDate ?? ctx.asOfDate).getTime();
  const from = anchor - INSIDER_WINDOW_DAYS * 86400_000;
  const win = txns.filter((t) => t.role === "promoter" && t.valueInrCr >= INSIDER_ELIGIBLE_CR && t.date.getTime() > from && t.date.getTime() <= anchor);
  const buys = win.filter((t) => t.side === "buy"), sells = win.filter((t) => t.side === "sell");
  const netCr = buys.reduce((s, t) => s + t.valueInrCr, 0) - sells.reduce((s, t) => s + t.valueInrCr, 0);
  if (netCr < P10_MIN_NET_CR || buys.length === 0) return null; // promoter must be a NET buyer

  const r0 = (x: number) => Math.round(x);
  return {
    kind: "pattern",
    key: "ownership_P10_promoter_defense",
    severity: "green", // §5E Green
    direction: "positive",
    magnitude: 5, // §5E +5
    displayState: "active",
    evidence: {
      pattern: "P10", name: "Promoter Defense Buying",
      windowDays: INSIDER_WINDOW_DAYS, promoterNetBuyCr: r0(netCr), buyTxns: buys.length, sellTxns: sells.length,
      marketPillar: mkt.subtotal === null ? null : Math.round(mkt.subtotal),
      verdict: `Promoter defense buying — the promoter bought a net ₹${r0(netCr)} Cr (${buys.length} trades) into price weakness${mkt.subtotal !== null ? ` (Market ${Math.round(mkt.subtotal)})` : ""}.`,
    },
    metricRefs: ["insiderTxns"],
  };
};
