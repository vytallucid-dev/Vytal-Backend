// File: src/scoring/findings/rules/h-ownership-events.ts
//
// H — Ownership Events (File 1 §5H · severity Low / event). FEED-GATED on the block/bulk-deal
// feed (LIVE but SPARSE — ~5 stocks: DELHIVERY, JIOFIN, BHEL, POLYCAB, MAXHEALTH). Fires on a
// material block/bulk deal in the trailing window; degrades SILENT where there's no block data
// (the pattern simply doesn't fire — never a false "no events"). PIT: dealDate ≤ cutoff (loader).
//
// SINGLE-SIGNAL: H is an EVENT card (a block deal happened) — distinct from the C/D flow's
// Category-D block SCORING (which moves the Ownership subtotal). H narrates the event; D moves
// the score. Different surfaces.

import type { FireRule } from "../types.js";

export const BLOCK_WINDOW_DAYS = 90;
export const H_MIN_DEAL_CR = 1; // ≥₹1cr to be a material event — FLAG: provisional

export const ruleH: FireRule = (ctx) => {
  const blocks = ctx.feeds.blockTxns;
  if (!blocks || !blocks.length) return null; // no block feed for this stock → silent
  const anchor = (ctx.shareholding[ctx.shareholding.length - 1]?.asOnDate ?? ctx.asOfDate).getTime();
  const from = anchor - BLOCK_WINDOW_DAYS * 86400_000;
  const win = blocks.filter((t) => t.valueInrCr >= H_MIN_DEAL_CR && t.date.getTime() > from && t.date.getTime() <= anchor);
  if (!win.length) return null;

  const buyCr = win.filter((t) => t.side === "buy").reduce((s, t) => s + t.valueInrCr, 0);
  const sellCr = win.filter((t) => t.side === "sell").reduce((s, t) => s + t.valueInrCr, 0);
  const netCr = buyCr - sellCr, grossCr = buyCr + sellCr;
  const r0 = (x: number) => Math.round(x);
  const lean = netCr > 0 ? "net buying" : netCr < 0 ? "net selling" : "two-sided";
  return {
    kind: "pattern",
    key: "ownership_H_block_events",
    severity: "low", // §5H event
    direction: netCr > 0 ? "positive" : netCr < 0 ? "negative" : null,
    magnitude: null, // event card, no §5E magnitude
    displayState: "active",
    evidence: {
      card: "H", name: "Ownership Events",
      windowDays: BLOCK_WINDOW_DAYS, deals: win.length, grossCr: r0(grossCr), netCr: r0(netCr), buyCr: r0(buyCr), sellCr: r0(sellCr),
      verdict: `Ownership event — ${win.length} block/bulk deal${win.length > 1 ? "s" : ""} (₹${r0(grossCr)} Cr, ${lean}) this window.`,
    },
    metricRefs: ["blockTxns"],
  };
};
