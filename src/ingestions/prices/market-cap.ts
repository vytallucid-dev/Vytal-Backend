// ─────────────────────────────────────────────────────────────
// SPOT MARKET CAP (₹Cr) with the SPLIT GATE.
//
// marketCap = close × latest-filing total_shares ÷ 1e7  (→ ₹Cr).
//   • close       — daily bhavcopy (already ingested), UNADJUSTED/raw.
//   • total_shares— the BigInt count on the MOST RECENT shareholding_patterns
//                   row (the same authoritative count the ownership/pledge path
//                   reads; the Decimal pct columns are deliberately not used).
//
// UNIT: ₹Cr — matches the Fundamentals Yields consumers, which divide fcf /
// dividendsPaid (both stored ₹Cr) by marketCap (fundamentals-view.service.ts).
//
// THE SPLIT GATE (the one real correctness risk): total_shares updates only
// quarterly; close is daily/raw. If a split/bonus (or reverse split) ex-dates
// AFTER the latest filing's asOnDate but ON/BEFORE the priceDate, the close is
// post-action while total_shares is pre-action → close × stale-shares is wrong
// BY THE ACTION RATIO. We DETECT it as a >THRESHOLD single-day price
// discontinuity inside the stale window (asOnDate, priceDate] and GATE the value
// to NULL (honest-empty) rather than stamp a ratio-wrong number. We do NOT
// split-adjust the share count. It SELF-CLEARS: when the next filing lands, its
// asOnDate moves past the action, the discontinuity leaves the window, and the
// next run stamps close × new(post-action) total_shares correctly.
//
// Conservative-asymmetric: a false-positive (gating a genuine news crash) costs
// a temporary null; a false-negative (stamping a 5×-wrong cap) is bad — so we
// gate when unsure.
// ─────────────────────────────────────────────────────────────

import { prisma } from "../../db/prisma.js";

/**
 * Single-day |move| beyond this in the stale window is treated as a probable
 * split/bonus/reverse-split → gate. Provisional/tunable. Real share-count actions
 * are almost always ≥50% single-day moves (1:1 bonus −50%, 2:1 split −50%,
 * 5:1 −80%, 10:1 −90%); 0.35 sits below all of them while NOT gating most genuine
 * one-day news crashes. One-line knob.
 */
export const SPLIT_DISCONTINUITY_THRESHOLD = 0.35;

export type MarketCapReason =
  | "stamped"
  | "gated_split"
  | "no_total_shares"
  | "no_price";

export interface MarketCapResult {
  /** ₹Cr, or null (honest-empty) when gated / no shares / no price. */
  marketCapCr: number | null;
  /** The filing asOnDate whose total_shares fed marketCap. Null ⇔ marketCapCr null. */
  sharesAsOfDate: Date | null;
  reason: MarketCapReason;
  /** Human-readable audit string for logs / the fill census. */
  detail: string;
}

/**
 * Compute spot market cap (₹Cr) for one stock from a given close + priceDate,
 * applying the split gate. Pure read + arithmetic — idempotent (re-running yields
 * the same value). Reused by the bhavcopy cron (forward-fill) and the one-time fill.
 */
export async function computeMarketCap(
  stockId: string,
  close: number | null,
  priceDate: Date,
): Promise<MarketCapResult> {
  if (close == null || close <= 0) {
    return {
      marketCapCr: null,
      sharesAsOfDate: null,
      reason: "no_price",
      detail: "no usable close",
    };
  }

  // Latest shareholding filing (most recent as-of date) — the same accessor the
  // ownership/pledge path uses: findFirst(orderBy asOnDate desc).total_shares.
  const latest = await prisma.shareholdingPattern.findFirst({
    where: { stockId },
    orderBy: { asOnDate: "desc" },
    select: { asOnDate: true, totalShares: true, quarter: true, fiscalYear: true },
  });

  if (!latest || latest.totalShares == null || latest.totalShares <= 0n) {
    return {
      marketCapCr: null,
      sharesAsOfDate: null,
      reason: "no_total_shares",
      detail: latest
        ? `latest filing ${latest.quarter} ${latest.fiscalYear} has null/zero total_shares`
        : "no shareholding filing",
    };
  }

  const asOnDate = latest.asOnDate;
  const shares = latest.totalShares;

  // ── SPLIT GATE: any >THRESHOLD single-day move in (asOnDate, priceDate] ──
  // Walk consecutive daily closes from the last close ≤ asOnDate (the baseline)
  // through priceDate. A split is a single-DAY discontinuity, not a cumulative
  // move — a stock legitimately doubling over a quarter is fine.
  const [baseline, windowCloses] = await Promise.all([
    prisma.dailyPrice.findFirst({
      where: { stockId, date: { lte: asOnDate } },
      orderBy: { date: "desc" },
      select: { close: true },
    }),
    prisma.dailyPrice.findMany({
      where: { stockId, date: { gt: asOnDate, lte: priceDate } },
      orderBy: { date: "asc" },
      select: { close: true },
    }),
  ]);

  const series: number[] = [];
  if (baseline?.close != null) series.push(Number(baseline.close));
  for (const d of windowCloses) if (d.close != null) series.push(Number(d.close));

  let maxMove = 0;
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    if (prev > 0) {
      const move = Math.abs((series[i] - prev) / prev);
      if (move > maxMove) maxMove = move;
    }
  }

  if (maxMove > SPLIT_DISCONTINUITY_THRESHOLD) {
    return {
      marketCapCr: null,
      sharesAsOfDate: null,
      reason: "gated_split",
      detail:
        `split-gate: ${(maxMove * 100).toFixed(1)}% single-day move in ` +
        `(${asOnDate.toISOString().slice(0, 10)}, ${priceDate.toISOString().slice(0, 10)}] ` +
        `> ${(SPLIT_DISCONTINUITY_THRESHOLD * 100).toFixed(0)}% — total_shares (${shares.toString()}) ` +
        `predates a probable corporate action; gated until next filing reconciles`,
    };
  }

  const marketCapCr = (close * Number(shares)) / 1e7; // ₹ → ₹Cr
  return {
    marketCapCr,
    sharesAsOfDate: asOnDate,
    reason: "stamped",
    detail:
      `₹${Math.round(marketCapCr).toLocaleString("en-IN")} Cr = ${close} × ${shares.toString()} sh / 1e7 ` +
      `(shares as-of ${asOnDate.toISOString().slice(0, 10)})`,
  };
}
