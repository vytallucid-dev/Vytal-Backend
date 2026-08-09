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

import type { FilingRule } from "../types.js";

export const BLOCK_WINDOW_DAYS = 90;
export const H_MIN_DEAL_CR = 1; // ≥₹1cr to be a material event — FLAG: provisional

// ★ THE WINDOW ENDS AT THE EVALUATION DATE (step 6) — IT USED TO END AT THE SHAREHOLDING FILING.
//
// The old anchor was `ctx.shareholding[last].asOnDate ?? ctx.asOfDate`. That is a QUARTERLY date, and
// the block-deal feed is DAILY, so the 90-day window closed wherever the shareholding calendar had
// last stopped — 30 June for most stocks — and every deal since was invisible. Measured on the cohort
// step 2 flagged: 38 display-only stocks hold block deals, H fired on 2, and all 38 fire once the
// window ends at the evaluation date. Across the active universe: 63 stocks hold deals, H fired on 20,
// 59 fire under the corrected anchor. MCX and BAYERCROP carry a shareholding anchor of 2018-12-31 and
// were excluding eight years of deals through it.
//
// ⚠ THIS IS WHY H IS GRAIN W, NOT GRAIN S. A window that ends today does not belong to a filing, and
// keying its row on the shareholding quarter would label an August observation as a June one. See
// filing/period.ts.
//
// ⚠ P5 AND P10 STILL CARRY THE OLD ANCHOR, DELIBERATELY. They read the same insider feed but live in
// the SCORING pass, where a window change moves findings on the 95 scored stocks. Named in the step-6
// report; not changed here.
export const ruleH: FilingRule = (ctx) => {
  const blocks = ctx.feeds.blockTxns;
  if (!blocks || !blocks.length) return null; // no block feed for this stock → silent
  const anchor = ctx.asOfDate.getTime();
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
