// File: src/filing/context.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FILING CONTEXT LOADER — everything the 22 rules read, for ONE stock, with no peer group and no
// snapshot anywhere in the resolution.
//
// This is the same shape score-pass.ts assembles for its findings hook, minus every score-derived
// field, and reached by a completely different route: score-pass gets here via a peer group, a bar
// set, a cross-section, four pillars and a composite. This gets here from a stock id.
//
// ── WHAT IT READS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────────────────────────
//   shareholding_patterns   → the shareholding series (R1/R2/R6/P1/P4/N5–N7, and the window anchor
//                             for P6/H)
//   the stock's own filed accounts, via metrics/filed-load.ts (step 1's industry dispatch)
//   insider_trades + block_deals, via the existing loadFlowFeeds
//
// NOT read: score_snapshots, score_pillars, peer_group_stocks, metric_bar_sets, daily_prices. The
// first four because the filing pass is not about the score; `daily_prices` because no filing rule
// reads a price — see the note on `marketCapInrCr` below.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { loadFiledFinancials, type FiledSource } from "../scoring/metrics/filed-load.js";
import { loadFlowFeeds } from "../scoring/ownership/flow-feeds-load.js";
import { opmSeriesFromQuarters } from "../scoring/findings/context.js";
import { isFinancialIndustry, type FilingContext } from "../scoring/findings/types.js";
import type { OwnershipQuarter } from "../scoring/ownership/types.js";
import { collapseToOneRowPerQuarter } from "../scoring/ownership/collapse-quarters.js";
import type { IndustryType } from "../generated/prisma/client.js";
import { makePeriod, rollingWindowPeriod, type FilingPeriods } from "./period.js";

const num = (d: unknown): number | null =>
  d == null ? null : typeof (d as { toNumber?: () => number }).toNumber === "function" ? (d as { toNumber: () => number }).toNumber() : Number(d);

export interface FilingSubject {
  stockId: string;
  symbol: string;
  industry: IndustryType;
}

export interface LoadedFilingContext {
  subject: FilingSubject;
  ctx: FilingContext;
  /** The period each grain resolves to — null where the stock has filed nothing at that grain. */
  periods: FilingPeriods;
  /** Which table pair served the accounts (provenance for the report). */
  source: FiledSource;
  counts: { shareholding: number; annual: number; quarterly: number; insiderTxns: number; blockTxns: number };
}

/**
 * Assemble one stock's filing context.
 *
 * `asOf` stamps the context's clock and is the fallback window anchor for P6/H when a stock has no
 * shareholding filing at all (both rules prefer the latest as-on date and fall back to `asOfDate` —
 * their existing behaviour, unchanged).
 */
export async function loadFilingContext(subject: FilingSubject, asOf: Date, cutoff?: Date): Promise<LoadedFilingContext> {
  const { stockId, symbol, industry } = subject;

  const shRows = await prisma.shareholdingPattern.findMany({
    where: { stockId, ...(cutoff ? { asOnDate: { lte: cutoff } } : {}) },
    orderBy: { asOnDate: "asc" },
    select: {
      asOnDate: true, quarter: true, fiscalYear: true,
      // ⚠ `promoterTotalShares` IS NOT OPTIONAL HERE. This is the filing pass's OWN read path —
      //   separate from score-pass.ts's — and it is the one that writes R1 to stock_findings. Threading
      //   the pledge denominator through score-pass alone left THIS pass still dividing by the
      //   fully-paid-up count, so a full run finished with ASHOKLEY still at 51.4% and still flagged.
      promoterShares: true, promoterTotalShares: true, totalShares: true, pledgedShares: true,
      promoterPct: true, fiiPct: true, diiPct: true, retailPct: true,
    },
  });
  // Same mapping score-pass.ts uses at its own DB boundary — counts stay BigInt, percentages become
  // plain numbers. The engine never sees a Decimal.
  // ⚠ ONE ROW PER QUARTER — see ownership/collapse-quarters.ts. These rows are per-FILING, and the
  //   rules (r2-promoter-exit, primary.ts) treat adjacent elements as consecutive quarters.
  const shareholding: OwnershipQuarter[] = collapseToOneRowPerQuarter(shRows).map((r) => ({
    asOnDate: r.asOnDate, quarter: r.quarter, fiscalYear: r.fiscalYear,
    promoterShares: r.promoterShares, promoterTotalShares: r.promoterTotalShares, totalShares: r.totalShares, pledgedShares: r.pledgedShares,
    promoterPct: num(r.promoterPct), fiiPct: num(r.fiiPct), diiPct: num(r.diiPct), retailPct: num(r.retailPct),
  }));

  const filed = await loadFiledFinancials(stockId, industry, cutoff);

  // ── FEEDS (P6 conviction · H block events) ────────────────────────────────────────────────────
  // ⚠ `daily: []` AND `totalShares: null` ARE DELIBERATE, NOT AN OMISSION. Those two arguments exist
  // solely to derive `marketCapInrCr`, which is read by the Ownership Category-D SCORING path and by
  // nothing else. Of the 22 filing rules only P6 and H touch `feeds`, and neither reads market cap —
  // both read `insiderTxns` / `blockTxns` and a date window. Passing them would mean loading a full
  // daily price series for 504 stocks to compute a number no filing rule consumes.
  //
  // If a future filing rule DOES need market cap, this is the line to change, and it must change
  // deliberately — `marketCapInrCr: null` degrades Category D to `dormant_no_data`, which is the
  // correct graceful state and NOT a silent zero.
  const latestSh = shareholding.length ? shareholding[shareholding.length - 1] : null;
  const { feeds } = await loadFlowFeeds({
    stockId,
    asOf: latestSh?.asOnDate ?? asOf,
    cutoff,
    daily: [],
    totalShares: null,
  });

  const ctx: FilingContext = {
    stockId,
    symbol,
    asOfDate: asOf,
    industry,
    shareholding,
    annualFundamentals: filed.annual,
    // Identical gate to the scoring pass's: null for every financial industry. filed-load returns
    // `operatingProfitStored: null` for all four anyway (an operating line that adds back a lender's
    // interest is not an operating line), so this states the intent rather than relying on that.
    quarterlyOpm: isFinancialIndustry(industry) ? null : (filed.quarterly.length ? opmSeriesFromQuarters(filed.quarterly) : null),
    quarterlyResults: filed.quarterly,
    feeds,
  };

  // ── THE THREE PERIODS ─────────────────────────────────────────────────────────────────────────
  // Each grain keys on the LATEST filing of its own kind — the period the rule evaluated "as of".
  // A grain with no filing resolves to null, and its rules write no row: see period.ts.
  const latestAnnual = filed.annual.length ? filed.annual[filed.annual.length - 1] : null;
  const latestQuarter = filed.quarterly.length ? filed.quarterly[filed.quarterly.length - 1] : null;
  const qLabel = latestQuarter ? `${latestQuarter.fiscalYear}${latestQuarter.quarter}` : null;

  const aEnd = latestAnnual ? filed.annualPeriodEnd.get(latestAnnual.fiscalYear) ?? null : null;
  const qEnd = qLabel ? filed.quarterlyPeriodEnd.get(qLabel) ?? null : null;

  const periods: FilingPeriods = {
    A: latestAnnual && aEnd ? makePeriod("A", latestAnnual.fiscalYear, aEnd) : null,
    Q: latestQuarter && qLabel && qEnd ? makePeriod("Q", qLabel, qEnd) : null,
    S: latestSh ? makePeriod("S", `${latestSh.fiscalYear}${latestSh.quarter}`, latestSh.asOnDate) : null,
    // ★ W ALWAYS RESOLVES, unlike the three filing grains. A trailing window is not a document the
    //   company may or may not have filed — it is the span we just looked at, and we always looked.
    //   Its end is `asOf`, which is also what P6 and H anchor on (step 6).
    W: rollingWindowPeriod(asOf),
  };

  return {
    subject,
    ctx,
    periods,
    source: filed.source,
    counts: {
      shareholding: shareholding.length,
      annual: filed.annual.length,
      quarterly: filed.quarterly.length,
      insiderTxns: feeds.insiderTxns?.length ?? 0,
      blockTxns: feeds.blockTxns?.length ?? 0,
    },
  };
}
