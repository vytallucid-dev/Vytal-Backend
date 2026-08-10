// ─────────────────────────────────────────────────────────────
// FILING PASS HANDLERS — the three ways stock_findings gets written.
//
//   FILING_RECOMPUTE     filing-keyed. The rules ONE ingestion moved, for the stocks in THAT batch.
//                        Enqueued by the worker hook off a succeeded ingestion; never by a cron.
//   FILING_ROLLING_DAILY clock-keyed, and the ONLY one. P6 and H read a trailing 90-day window, so
//                        they can stop being true with no new data at all.
//   FILING_BACKFILL      all 22 rules, all 504 stocks. THE STANDING LAW — see
//                        src/scoring/findings/rules/BACKFILL-LAW.md.
//
// All three are idempotent: the pass upserts on (stock_id, rule_key, period_key) and reads its
// prior-period comparison from rows STRICTLY EARLIER than the period it is writing, so re-running one
// cannot read its own last write and flip a standing state.
// ─────────────────────────────────────────────────────────────
import type { JobContext } from "../context.js";
import type { FilingRecomputePayload, FilingRollingDailyPayload, FilingBackfillPayload } from "../types.js";
import { prisma } from "../../db/prisma.js";
import { runFilingPass, runFilingBackfill, filingSubject, filingUniverse } from "../../filing/pass.js";
import { ROLLING_WINDOW_FEEDS, type FilingFeed } from "../../filing/registry.js";

/** Feed strings arrive off a JSON payload, so they are validated rather than trusted. */
const FEEDS = new Set<FilingFeed>(["shareholding", "annual", "quarterly", "insider", "blocks"]);
const asFeeds = (raw: readonly string[] | undefined): FilingFeed[] =>
  (raw ?? []).filter((f): f is FilingFeed => FEEDS.has(f as FilingFeed));

export async function handleFilingRecompute(ctx: JobContext<FilingRecomputePayload>) {
  const feeds = asFeeds(ctx.payload.feeds);
  const symbols = [...new Set(ctx.payload.symbols ?? [])];
  if (!feeds.length || !symbols.length) {
    // Refused rather than widened. An empty scope here would mean "recompute everything", which is a
    // backfill wearing a trigger's name — and the backfill is the thing the law wants deliberate.
    await ctx.reportProgress(100, `Nothing to do — feeds=${feeds.length} symbols=${symbols.length}`);
    return { stocks: 0, written: 0, feeds, skipped: "empty-scope" };
  }

  await ctx.reportProgress(2, `Recomputing ${feeds.join(", ")} rules for ${symbols.length} stock(s)`);
  const asOf = new Date();
  let written = 0, done = 0;
  const failed: { symbol: string; error: string }[] = [];
  for (const symbol of symbols) {
    const subject = await filingSubject(symbol);
    if (!subject) { failed.push({ symbol, error: "unknown symbol" }); continue; }
    try {
      const r = await runFilingPass(subject, asOf, undefined, feeds);
      written += r.written;
    } catch (err) {
      // One stock never fails the batch — the others' filings are still worth recomputing.
      failed.push({ symbol, error: String(err) });
    }
    done++;
    if (done % 25 === 0) await ctx.reportProgress(Math.min(95, 2 + Math.round((done / symbols.length) * 93)), `${done}/${symbols.length}`);
  }
  await ctx.reportProgress(100, `Done — ${written} row(s) upserted across ${done} stock(s), ${failed.length} failed`);
  return { stocks: done, written, feeds, failed };
}

/**
 * ★ THE ONE CLOCK-KEYED PASS, AND ITS WORKLIST IS STILL NOT THE UNIVERSE.
 *
 * A rolling window only moves under a stock that HAS feed rows — a stock with no insider trade and no
 * block deal has an empty window today, an empty window tomorrow, and a rule that returns null either
 * way. Running the universe would write 1,008 identical rows a day to say nothing changed.
 */
export async function handleFilingRollingDaily(_ctx: JobContext<FilingRollingDailyPayload>) {
  const ctx = _ctx;
  await ctx.reportProgress(2, "Resolving the stocks whose rolling window can move");
  const [insider, blocks] = await Promise.all([
    prisma.insiderTrade.findMany({ select: { stockId: true }, distinct: ["stockId"] }),
    prisma.blockDeal.findMany({ select: { stockId: true }, distinct: ["stockId"] }),
  ]);
  const ids = new Set<string>([...insider.map((r) => r.stockId), ...blocks.map((r) => r.stockId)]);
  const universe = await filingUniverse();
  const subjects = universe.filter((s) => ids.has(s.stockId));

  await ctx.reportProgress(5, `${subjects.length} stock(s) carry a feed row — recomputing P6 + H`);
  const asOf = new Date();
  let written = 0, done = 0;
  const failed: { symbol: string; error: string }[] = [];
  for (const s of subjects) {
    try {
      const r = await runFilingPass(s, asOf, undefined, ROLLING_WINDOW_FEEDS);
      written += r.written;
    } catch (err) {
      failed.push({ symbol: s.symbol, error: String(err) });
    }
    done++;
    if (done % 50 === 0) await ctx.reportProgress(Math.min(95, 5 + Math.round((done / subjects.length) * 90)), `${done}/${subjects.length}`);
  }
  await ctx.reportProgress(100, `Done — ${written} row(s) across ${done} stock(s), ${failed.length} failed`);
  return { stocks: done, written, feeds: ROLLING_WINDOW_FEEDS, failed };
}

export async function handleFilingBackfill(ctx: JobContext<FilingBackfillPayload>) {
  const feeds = asFeeds(ctx.payload.feeds);
  const scope = feeds.length ? feeds.join(", ") : "all 22 rules";
  const symbols = ctx.payload.symbols?.length ? ctx.payload.symbols : undefined;
  await ctx.reportProgress(2, `Backfilling ${scope} over ${symbols ? `${symbols.length} stock(s)` : "the active universe"}`);

  const r = await runFilingBackfill({
    symbols,
    feeds: feeds.length ? feeds : undefined,
    onProgress: async (done, total) => {
      if (done % 25 === 0 || done === total) {
        await ctx.reportProgress(Math.min(98, 2 + Math.round((done / total) * 96)), `${done}/${total}`);
      }
    },
  });
  await ctx.reportProgress(
    100,
    `Backfill complete — ${r.written} row(s) across ${r.stocks} stock(s), ${r.failed.length} failed, ` +
      `${r.skippedNoPeriod} rule-runs had no filing period to key on`,
  );
  return {
    stocks: r.stocks,
    written: r.written,
    failed: r.failed,
    skippedNoPeriod: r.skippedNoPeriod,
    reason: ctx.payload.reason ?? null,
    durationMs: r.finishedAt.getTime() - r.startedAt.getTime(),
  };
}
