// File: src/filing/triggers.ts
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★ FILING-KEYED RECOMPUTE — which ingestion moving recomputes which rules, for which stocks.
//
// The filing pass has run correctly since step 2 and only ever when someone invoked it. This is the
// wiring that makes it recompute when a filing lands.
//
// ── ★ IT IS WIRING, NOT NEW MACHINERY, AND THAT IS WORTH SAYING PRECISELY ────────────────────────
// The ingestion pipeline is a CRON that fires blind — nothing in it knows a filing arrived. But the
// JOB LAYER around it is not blind: jobs/worker.ts calls `maybeEnqueueRescoresForJob(job.type, result)`
// after every job that genuinely SUCCEEDS, and the ingestion results already carry `changedSymbols` —
// "the symbols that actually had data written", computed by comparing the stored values before and
// after the write against a per-table manifest (score-relevant-diff.ts). That is an arrival event in
// everything but name, and the scoring pass has consumed it since Stage 3.
//
// So this module is the filing pass's arm of the same hook. What it adds is the SECOND axis the
// scoring trigger never needed: scoring rescores a whole peer group whatever moved, while a filing
// recompute has to know WHICH RULES the moving feed drives.
//
// ── ★ TWO SCOPES, BOTH NARROW, AND BOTH ARE THE POINT ───────────────────────────────────────────
//   WHICH STOCKS  — only the symbols in that ingestion batch. Not the universe.
//   WHICH RULES   — only the rules that feed drives (filing/registry.ts `feed`). A shareholding
//                   upload recomputes the eight shareholding rules and touches nothing else. It must
//                   not rewrite a receivables verdict: the row would be identical in content but its
//                   `standingState` would have been re-derived against a period in which nothing
//                   moved, and the read layer would then serve a transition that never happened.
//
// ── WHICH JOB TYPES ARE NOT HERE, AND WHY ────────────────────────────────────────────────────────
// Prices, indices, news, corporate events, and the entire fund pipeline are absent. No filing rule
// reads a price or an announcement — filing/context.ts does not even load `daily_prices`. Adding a
// job type here would not make a rule see anything new; it would only rewrite rows at a period
// nothing filed.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import { prisma } from "../db/prisma.js";
import { JobTypes } from "../jobs/types.js";
import type { FilingFeed } from "./registry.js";

/**
 * ★ THE MAP. One ingestion job type → the feeds it moved.
 *
 * ⚠ RESULTS_SCAN MOVES BOTH ACCOUNTS FEEDS, AND CANNOT SAY WHICH. The scanner ingests annual AND
 * quarterly filings in one pass (ingest-*-annual.ts / ingest-*-quarterly.ts) and its result carries a
 * single flat `changedSymbols` with no basis attached — `scoreRelevantChanged` is one boolean per
 * symbol across both. Splitting it would mean changing the scanner's result shape, which is the
 * ingestion layer's contract with the scoring trigger as well. So it declares both, and the honest
 * cost is that an annual-only filing also recomputes the five quarterly rules for that symbol: 12
 * rules instead of 7, on the symbols that filed. Named here rather than hidden.
 */
export const FEEDS_BY_JOB_TYPE: Readonly<Record<string, readonly FilingFeed[]>> = {
  [JobTypes.SHAREHOLDING_QUARTERLY]: ["shareholding"],
  [JobTypes.SHAREHOLDING_SMART_REFRESH]: ["shareholding"],
  [JobTypes.SHAREHOLDING_BACKFILL]: ["shareholding"],
  [JobTypes.RESULTS_SCAN]: ["annual", "quarterly"],
  [JobTypes.INSIDER_TRADES_DAILY]: ["insider"],
  [JobTypes.INSIDER_TRADES_BACKFILL]: ["insider"],
  [JobTypes.DEALS_DAILY_INGEST]: ["blocks"],
  [JobTypes.DEALS_BACKFILL]: ["blocks"],
};

/** `changedSymbols` as emitted by the shareholding + results ingestion results. */
function changedSymbolsOf(result: unknown): string[] {
  const cs = (result as { changedSymbols?: unknown } | null)?.changedSymbols;
  return Array.isArray(cs) ? cs.filter((x): x is string => typeof x === "string") : [];
}

/**
 * ★ THE SYMBOLS AN INSIDER / DEALS RUN TOUCHED — DERIVED, BECAUSE THOSE HANDLERS DO NOT SAY.
 *
 * `handleInsiderTradesDaily` returns `{ status: "complete" }` and the deals handler returns row
 * counts; neither carries symbols. Rather than reshape two ingestion contracts, the batch is read
 * back off the rows themselves: the stocks whose feed rows were CREATED in this job's run window.
 *
 * `createdAt` is the right column and `tradeDate` / `dealDate` is not. A backfill inserting six
 * months of history has an event date far in the past and an insert time of now; keying on the event
 * date would miss every one of those stocks. Keying on insert time asks the question we actually
 * mean — "what did this run write?".
 */
export async function symbolsFromFeedWrites(
  feeds: readonly FilingFeed[],
  since: Date,
): Promise<string[]> {
  const ids = new Set<string>();
  if (feeds.includes("insider")) {
    const rows = await prisma.insiderTrade.findMany({
      where: { createdAt: { gte: since } },
      select: { stockId: true },
      distinct: ["stockId"],
    });
    for (const r of rows) ids.add(r.stockId);
  }
  if (feeds.includes("blocks")) {
    const rows = await prisma.blockDeal.findMany({
      where: { createdAt: { gte: since } },
      select: { stockId: true },
      distinct: ["stockId"],
    });
    for (const r of rows) ids.add(r.stockId);
  }
  if (!ids.size) return [];
  const stocks = await prisma.stock.findMany({
    where: { id: { in: [...ids] }, isActive: true },
    select: { symbol: true },
  });
  return stocks.map((s) => s.symbol);
}

export interface FilingTriggerPlan {
  jobType: string;
  feeds: readonly FilingFeed[];
  symbols: string[];
  /** How the symbol set was obtained — reported so a run's scope is auditable. */
  source: "changedSymbols" | "feed-writes" | "none";
}

/**
 * Resolve WHAT to recompute for a just-succeeded ingestion job. Pure resolution — enqueues nothing,
 * so a caller (the worker hook, an admin route, a verification script) decides what to do with it.
 *
 * Returns null when the job type is not a filing trigger source at all.
 */
export async function planFilingRecompute(
  jobType: string,
  result: unknown,
  /** When the job started — the window for the derived feed-write lookup. */
  startedAt: Date,
): Promise<FilingTriggerPlan | null> {
  const feeds = FEEDS_BY_JOB_TYPE[jobType];
  if (!feeds) return null;

  const declared = changedSymbolsOf(result);
  if (declared.length) {
    return { jobType, feeds, symbols: [...new Set(declared)], source: "changedSymbols" };
  }
  // The two daily feeds do not declare their batch — derive it. A shareholding/results job that
  // declared an EMPTY changedSymbols genuinely wrote nothing score-relevant, and must not fall
  // through to a feed-write scan that would return the wrong table's stocks.
  const derivable = feeds.every((f) => f === "insider" || f === "blocks");
  if (!derivable) return { jobType, feeds, symbols: [], source: "none" };
  const symbols = await symbolsFromFeedWrites(feeds, startedAt);
  return { jobType, feeds, symbols, source: symbols.length ? "feed-writes" : "none" };
}
