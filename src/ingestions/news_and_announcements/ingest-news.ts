// src/lib/news/ingest-news.ts
// ─────────────────────────────────────────────────────────────
// Full news ingestion pipeline:
//   Phase 1 — Fetch & insert (fast, runs daily)
//   Phase 2 — Extract content (PDF only, and currently switched off)
//
// Phase 1: Insert all news items immediately. `extractionStatus` is
//   EXTRACTION_DECLINED for press rows always, and for filings unless
//   CONTENT_EXTRACTION_ENABLED is on — nothing writes "pending" while
//   there is no worker scheduled to drain it.
//
// Phase 2: The extraction worker handles NSE PDFs via pdf-parse. There is
//   no article path: the scraper and its cheerio dependency were deleted on
//   2026-08-09 (0 successes in 23,150 attempts; the stored URL resolves to
//   Google's JS shell; three target publishers ban Anthropic's crawler by
//   name). See the header of content-extractor.ts before adding one back.
//
// The two-phase approach means daily fetch is fast (~2-4 min for
// 100 stocks) and extraction runs asynchronously after insert.
// ─────────────────────────────────────────────────────────────

import {
  fetchNseAnnouncements,
  type NseAnnouncement,
} from "./nse-announcements.js";
import { fetchGoogleNews, type GoogleNewsItem } from "./google-news.js";
import { extractPdfText, EXTRACTION_DECLINED } from "./content-extractor.js";
import { pressDedupeKey } from "./dedupe-key.js";
import { prisma } from "../../db/prisma.js";
import { nseClient } from "../../lib/client.js";
import { reportIngestionError } from "../shared/ingestion-error.js";
import {
  NEWS_NSE_CRON,
  NEWS_NSE_SOURCE,
  NEWS_GOOGLE_CRON,
  NEWS_GOOGLE_SOURCE,
  nseRunRef,
  googleRunRef,
  nseShapeBreach,
  nseFieldPresenceBreach,
  googleSourceDeadBreach,
  googleAggregateZeroBreach,
  type NseRunStats,
  type GoogleRunStats,
} from "./news-guards.js";

// ── Types ─────────────────────────────────────────────────────

/**
 * Called after each batch of stocks (or each extraction item) completes.
 * Return false to abort the remaining batches.
 */
export type BatchProgressFn = (
  done: number,
  total: number,
  label: string,
) => Promise<boolean>;

export interface NewsIngestResult {
  success: boolean;
  nseInserted: number;
  googleInserted: number;
  skipped: number;
  pendingExtraction: number;
  stocksProcessed: number;
  durationMs: number;
  error?: string;
}

// ── Universe ──────────────────────────────────────────────────

async function loadUniverse() {
  return prisma.stock.findMany({
    where: { isActive: true },
    select: { id: true, symbol: true, name: true },
    orderBy: { symbol: "asc" },
  });
}

// ── Phase 1: Insert NSE announcements ─────────────────────────

async function insertNseAnnouncement(
  stockId: string,
  symbol: string,
  ann: NseAnnouncement,
): Promise<"inserted" | "skipped"> {
  try {
    await prisma.stockNews.create({
      data: {
        stockId,
        symbol,
        sourceType: "nse_announcement",
        sourceId: ann.sourceId,
        headline: ann.headline,
        summary: ann.summary, // attchmntText excerpt — REAL content, the best field in this table
        contentText: null, // filled by extraction worker
        contentSource: ann.shouldExtract ? "pending" : null,
        contentTokens: null,
        category: ann.category,
        subcategory: ann.subcategory,
        pdfUrl: ann.pdfUrl, // always stored
        externalUrl: null,
        isHighImpact: ann.isHighImpact,
        publishedAt: ann.publishedAt,
        // ★ "pending" ONLY when a worker actually exists to drain it. `shouldExtract` is false whenever
        //   CONTENT_EXTRACTION_ENABLED is false, so this resolves to EXTRACTION_DECLINED and the queue
        //   cannot refill — see the master switch in content-extractor.ts.
        extractionStatus: ann.shouldExtract ? "pending" : EXTRACTION_DECLINED,
        extractionAttempts: 0,
      },
    });
    return "inserted";
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return "skipped";
    throw e;
  }
}

// ── Phase 1: Insert Google News items ─────────────────────────

async function insertGoogleNewsItem(
  stockId: string,
  symbol: string,
  item: GoogleNewsItem,
): Promise<"inserted" | "skipped"> {
  try {
    // ── ★ THERE IS NO EXTRACTION BRANCH LEFT FOR PRESS ROWS, AND THAT IS THE POINT ─────────────────
    //
    // These three values used to be conditional on `item.shouldScrape`. Both the field and the article
    // scraper behind it were DELETED on 2026-08-09 (0 successes in 23,150 attempts; the stored URL
    // resolves to Google's JS shell; three target publishers ban Anthropic's crawler by name — see the
    // header of content-extractor.ts). So a press row is now unconditionally "we are not extracting
    // this", and there is no path that can write "pending" again.
    //
    // ⚠ AND `contentText` IS ALWAYS NULL HERE, WHICH FIXES A SEPARATE DEFECT. The old paywall branch
    // copied `summary` into `contentText` and labelled it "rss_snippet" — but on a press row `summary`
    // IS "{headline} {publisher}", so that wrote a HEADLINE into the field named content and presented
    // it as an extracted body: 1,281 rows, every one byte-identical to `summary`, and the source of the
    // "Full text available" badge that promised an article body for a headline. Those rows are cleared.
    // An honest null beats a labelled copy.
    const contentText = null;
    const contentSource = null;
    const extractionStatus = EXTRACTION_DECLINED;

    await prisma.stockNews.create({
      data: {
        stockId,
        symbol,
        sourceType: "google_news",
        sourceId: item.sourceId,
        // ★ THE REAL DEDUPE. sourceId is Google's GUID and it DRIFTS — the same article returns with a
        //   new one, so (stockId, sourceId) never collides and the duplicate is stored. This key is
        //   (published_at, normalised headline prefix); a P2002 on it is caught below and reported as
        //   "skipped", exactly like a sourceId collision. See dedupe-key.ts for the calibration.
        dedupeKey: pressDedupeKey(item.headline, item.publishedAt),
        headline: item.headline,
        summary: item.summary, // RSS snippet (always stored)
        contentText, // always null at insert — only a real extraction may fill it
        contentSource,
        contentTokens: null, // a token estimate of nothing is not 0, it is unknown
        category: item.sourceName, // publication DISPLAY name ("The Economic Times") — not a domain
        subcategory: null,
        pdfUrl: null,
        externalUrl: item.externalUrl, // the Google redirect, always stored (never resolves to the article)
        publisherDomain: item.publisherDomain, // the publisher's real host, for the host screen
        isHighImpact: item.isHighImpact,
        publishedAt: item.publishedAt,
        extractionStatus,
        extractionAttempts: 0,
      },
    });
    return "inserted";
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return "skipped";
    throw e;
  }
}

// ── Daily NSE announcements job ───────────────────────────────

export async function runDailyNseAnnouncementsIngest(
  daysBack: number = 2,
  onBatchComplete?: BatchProgressFn,
  signal?: AbortSignal,
): Promise<NewsIngestResult> {
  const start = Date.now();
  let inserted = 0;
  let skipped = 0;
  let pendingExtraction = 0;
  let stocksProcessed = 0;

  // ── run-level guard counters (NSE filings) ──
  let responsesReceived = 0;
  let nonArrayResponses = 0;
  let rawRowsSeen = 0;
  let passedFilter = 0;

  try {
    const stocks = await loadUniverse();
    const to = new Date();
    const from = new Date(to.getTime() - daysBack * 86400_000);

    const BATCH_SIZE = 5;
    const SESSION_RESET_EVERY_N_BATCHES = 3;

    const batches: typeof stocks[] = [];
    for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
      batches.push(stocks.slice(i, i + BATCH_SIZE));
    }

    console.log(
      `[NseNews] Fetching for ${stocks.length} stocks (last ${daysBack} days) across ${batches.length} batches of ${BATCH_SIZE}…`,
    );

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const batchNum = batchIdx + 1;

      if (batchIdx > 0 && batchIdx % SESSION_RESET_EVERY_N_BATCHES === 0) {
        console.log(
          `[NseNews] Batch ${batchNum}/${batches.length} — resetting NSE client session after ${SESSION_RESET_EVERY_N_BATCHES} batches…`,
        );
        nseClient.resetSession();
      }

      console.log(
        `[NseNews] Batch ${batchNum}/${batches.length} — processing: [${batch.map((s) => s.symbol).join(", ")}]`,
      );

      for (const stock of batch) {
        try {
          const { announcements, nonArray, rawRows, passed } =
            await fetchNseAnnouncements(stock.symbol, from, to, signal);
          responsesReceived++;
          if (nonArray) nonArrayResponses++;
          rawRowsSeen += rawRows;
          passedFilter += passed;

          for (const ann of announcements) {
            const result = await insertNseAnnouncement(
              stock.id,
              stock.symbol,
              ann,
            );
            if (result === "inserted") {
              inserted++;
              if (ann.shouldExtract) pendingExtraction++;
            } else {
              skipped++;
            }
          }

          stocksProcessed++;
        } catch (e) {
          console.warn(`[NseNews] ${stock.symbol}:`, (e as Error).message);
        }

        await new Promise((r) => setTimeout(r, 600));
      }

      console.log(
        `[NseNews] Batch ${batchNum}/${batches.length} complete — inserted=${inserted} skipped=${skipped} so far`,
      );

      if (onBatchComplete) {
        const shouldContinue = await onBatchComplete(
          batchNum,
          batches.length,
          `NSE batch ${batchNum}/${batches.length} — ${batch.map((s) => s.symbol).join(", ")}`,
        );
        if (!shouldContinue) break;
      }

      // Inter-batch delay: give NSE a breather between groups
      if (batchIdx + 1 < batches.length) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    const durationMs = Date.now() - start;

    // ── Run-level SHAPE guards (NSE) — per-stock errors are swallowed in
    // the loop, so evaluate the accumulated counters once here, before the
    // fetch log is written (which would otherwise log success on a dead feed). ──
    const nseStats: NseRunStats = {
      responsesReceived,
      nonArrayResponses,
      rawRowsSeen,
      passedFilter,
    };
    const runRef = nseRunRef(new Date());
    if (nseShapeBreach(nseStats)) {
      await reportIngestionError({
        source: NEWS_NSE_SOURCE,
        cron: NEWS_NSE_CRON,
        guardType: "shape",
        targetTable: "StockNews",
        severity: "critical",
        resolutionPath: "source_code",
        expected: "corporate-announcements returns an array per symbol",
        observed: `every response non-array (${nonArrayResponses}/${responsesReceived} symbols)`,
        detail:
          "object-where-array envelope trap (nse-announcements.ts) — a renamed/changed envelope yields silent 0 announcements logged as success",
        runRef,
      });
    }
    if (nseFieldPresenceBreach(nseStats)) {
      await reportIngestionError({
        source: NEWS_NSE_SOURCE,
        cron: NEWS_NSE_CRON,
        guardType: "shape",
        targetTable: "StockNews",
        targetField: "seq_id/desc/an_dt",
        severity: "high",
        resolutionPath: "source_code",
        expected: "raw filings carry seq_id + desc + an_dt",
        observed: `${rawRowsSeen} raw rows, 0 passed the required-field filter`,
        detail:
          "field rename → .filter(r => r.seq_id && r.desc && r.an_dt) drops every row → silent 0",
        runRef,
      });
    }

    await prisma.newsFetchLog.create({
      data: {
        fetchType: "nse_daily",
        status: "success",
        stocksProcessed,
        itemsInserted: inserted,
        itemsSkipped: skipped,
        durationMs,
      },
    });

    console.log(
      `[NseNews] Done — inserted: ${inserted}, pending extraction: ${pendingExtraction}`,
    );

    return {
      success: true,
      nseInserted: inserted,
      googleInserted: 0,
      skipped,
      pendingExtraction,
      stocksProcessed,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const msg = (error as Error).message;
    await prisma.newsFetchLog.create({
      data: {
        fetchType: "nse_daily",
        status: "failed",
        stocksProcessed,
        itemsInserted: inserted,
        itemsSkipped: skipped,
        error: msg,
        durationMs,
      },
    });
    return {
      success: false,
      nseInserted: inserted,
      googleInserted: 0,
      skipped,
      pendingExtraction,
      stocksProcessed,
      durationMs,
      error: msg,
    };
  }
}

// ── Daily Google News job ──────────────────────────────────────

export async function runDailyGoogleNewsIngest(
  daysBack: number = 7,
  onBatchComplete?: BatchProgressFn,
  signal?: AbortSignal,
): Promise<NewsIngestResult> {
  const start = Date.now();
  let inserted = 0;
  let skipped = 0;
  let pendingExtraction = 0;
  let stocksProcessed = 0;

  // ── run-level guard counters (Google RSS) ──
  let stocksAttempted = 0;
  let responsesReceived = 0;
  let nonRssBodies = 0;
  let itemsParsed = 0;
  /** Items the cutoff filter still had to drop. Expected 0 now that the query carries `when:`;
   *  a non-zero total means the query window and the cutoff have diverged — see the call site. */
  let outOfWindowDropped = 0;

  try {
    const stocks = await loadUniverse();
    const cutoff = new Date(Date.now() - daysBack * 86400_000);

    const BATCH_SIZE = 5;
    const batches: typeof stocks[] = [];
    for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
      batches.push(stocks.slice(i, i + BATCH_SIZE));
    }

    console.log(`[GoogleNews] Fetching for ${stocks.length} stocks (last ${daysBack} days) across ${batches.length} batches of ${BATCH_SIZE}…`);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const batchNum = batchIdx + 1;

      console.log(
        `[GoogleNews] Batch ${batchNum}/${batches.length} — processing: [${batch.map((s) => s.symbol).join(", ")}]`,
      );

      for (const stock of batch) {
        stocksAttempted++;
        try {
          const { items, malformed } = await fetchGoogleNews(
            stock.symbol,
            stock.name,
            20,
            signal,
            // ★ SAME `daysBack` DRIVES THE QUERY AND THE CUTOFF BELOW, so the two cannot disagree.
            //   Without it the feed is relevance-ranked across years and the filter throws away
            //   nearly everything fetched (measured: 6 usable of 120). See whenClause().
            daysBack,
          );
          responsesReceived++;
          if (malformed) nonRssBodies++;
          const recent = items.filter((n) => n.publishedAt >= cutoff);
          // ⚠ BELT-AND-BRACES: with the `when:` operator this filter should now drop NOTHING.
          //    A non-zero drop means the query window and this cutoff have diverged (or Google
          //    ignored the operator) — worth seeing rather than silently absorbing.
          if (recent.length !== items.length) {
            outOfWindowDropped += items.length - recent.length;
            console.warn(
              `[GoogleNews] ${stock.symbol}: ${items.length - recent.length}/${items.length} items fell OUTSIDE the ${daysBack}d window despite when:${daysBack}d`,
            );
          }
          itemsParsed += recent.length;

          for (const item of recent) {
            const result = await insertGoogleNewsItem(
              stock.id,
              stock.symbol,
              item,
            );
            if (result === "inserted") {
              inserted++;
              // No `pendingExtraction++` — press rows are never queued for extraction. The article
              // scraper is deleted, so the counter stays 0 and runDailyNewsIngest does not invoke the
              // worker for press. Filings still increment their own counter, gated by the flag.
            } else {
              skipped++;
            }
          }

          stocksProcessed++;
        } catch (e) {
          console.warn(`[GoogleNews] ${stock.symbol}:`, (e as Error).message);
        }

        await new Promise((r) => setTimeout(r, 1200));
      }

      console.log(
        `[GoogleNews] Batch ${batchNum}/${batches.length} complete — inserted=${inserted} skipped=${skipped} so far`,
      );

      if (onBatchComplete) {
        const shouldContinue = await onBatchComplete(
          batchNum,
          batches.length,
          `Google batch ${batchNum}/${batches.length} — ${batch.map((s) => s.symbol).join(", ")}`,
        );
        if (!shouldContinue) break;
      }

      // Inter-batch delay: avoid hitting Google RSS rate limits
      if (batchIdx + 1 < batches.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    const durationMs = Date.now() - start;

    // ── Run-level guards (Google RSS) — evaluate accumulated counters once
    // before the fetch log is written (per-stock errors are swallowed above). ──
    const gStats: GoogleRunStats = {
      stocksAttempted,
      responsesReceived,
      nonRssBodies,
      itemsParsed,
    };
    const runRef = googleRunRef(new Date());
    if (googleSourceDeadBreach(gStats)) {
      await reportIngestionError({
        source: NEWS_GOOGLE_SOURCE,
        cron: NEWS_GOOGLE_CRON,
        guardType: "shape",
        targetTable: "StockNews",
        severity: "high",
        resolutionPath: "source_code",
        expected: "news.google.com/rss returns parseable RSS",
        observed:
          responsesReceived === 0
            ? `all ${stocksAttempted} fetches failed (HTTP error / block)`
            : `every 200 body was non-RSS (${nonRssBodies}/${responsesReceived}) — consent/captcha page`,
        detail:
          "Google blocked or moved the RSS endpoint — feed dead, not a quiet day (RSS is not market-gated)",
        runRef,
      });
    }
    if (googleAggregateZeroBreach(gStats)) {
      await reportIngestionError({
        source: NEWS_GOOGLE_SOURCE,
        cron: NEWS_GOOGLE_CRON,
        guardType: "count",
        targetTable: "StockNews",
        severity: "high",
        resolutionPath: "source_code",
        expected: "≥1 item across the universe (baseline floor ~22/run)",
        observed: `0 items parsed across ${responsesReceived} valid RSS responses`,
        detail:
          "valid-but-empty RSS for every stock → search-query semantics changed (per-stock 0 is normal; universe-wide 0 is not)",
        runRef,
      });
    }

    await prisma.newsFetchLog.create({
      data: {
        fetchType: "google_news_daily",
        status: "success",
        stocksProcessed,
        itemsInserted: inserted,
        itemsSkipped: skipped,
        durationMs,
      },
    });

    console.log(
      `[GoogleNews] Done — inserted: ${inserted}, pending scraping: ${pendingExtraction}, ` +
        `items in window: ${itemsParsed}, dropped as out-of-window: ${outOfWindowDropped} (expected 0 with when:${daysBack}d)`,
    );

    return {
      success: true,
      nseInserted: 0,
      googleInserted: inserted,
      skipped,
      pendingExtraction,
      stocksProcessed,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const msg = (error as Error).message;
    await prisma.newsFetchLog.create({
      data: {
        fetchType: "google_news_daily",
        status: "failed",
        stocksProcessed,
        itemsInserted: inserted,
        itemsSkipped: skipped,
        error: msg,
        durationMs,
      },
    });
    return {
      success: false,
      nseInserted: 0,
      googleInserted: 0,
      skipped,
      pendingExtraction,
      stocksProcessed,
      durationMs,
      error: msg,
    };
  }
}

// ── Phase 2: Content extraction worker ───────────────────────
// Picks up all "pending" items and extracts their content.
// Can be called after daily fetch jobs complete, or as a
// separate scheduled job (e.g. 30 min after daily fetch).

export async function runContentExtractionWorker(
  batchSize: number = 20,
  onItemComplete?: BatchProgressFn,
  signal?: AbortSignal,
): Promise<{ extracted: number; failed: number; durationMs: number }> {
  const start = Date.now();
  let extracted = 0;
  let failed = 0;

  // Fetch pending items (oldest first, max batchSize)
  const pending = await prisma.stockNews.findMany({
    where: {
      extractionStatus: "pending",
      extractionAttempts: { lt: 3 }, // don't retry more than 3 times
    },
    orderBy: { publishedAt: "asc" },
    take: batchSize,
    select: {
      id: true,
      sourceType: true,
      pdfUrl: true,
      externalUrl: true,
      summary: true,
      category: true,
      isHighImpact: true,
    },
  });

  console.log(`[ExtractionWorker] Processing ${pending.length} pending items…`);

  for (let idx = 0; idx < pending.length; idx++) {
    const item = pending[idx];
    try {
      let result;

      // ★ PDF ONLY. The `google_news` branch that called extractArticleText is DELETED along with the
      // scraper (see content-extractor.ts's header). A press row reaching this worker — which it cannot,
      // since nothing writes "pending" for press any more — now falls to the "nothing to extract" arm
      // below and is marked declined, rather than being handed a scraper that returns Google's chrome.
      if (item.sourceType === "nse_announcement" && item.pdfUrl) {
        // Extract PDF text
        result = await extractPdfText(item.pdfUrl, signal);
      } else {
        // Nothing to extract
        await prisma.stockNews.update({
          where: { id: item.id },
          data: { extractionStatus: "skipped" },
        });

        if (onItemComplete) {
          const shouldContinue = await onItemComplete(idx + 1, pending.length, `item ${idx + 1}/${pending.length}`);
          if (!shouldContinue) break;
        }
        continue;
      }

      if (result.text && result.source !== "failed") {
        await prisma.stockNews.update({
          where: { id: item.id },
          data: {
            contentText: result.text,
            contentSource: result.source,
            contentTokens: result.tokenEstimate,
            extractionStatus: "extracted",
            extractedAt: new Date(),
            extractionError: null,
          },
        });
        extracted++;
      } else {
        await prisma.stockNews.update({
          where: { id: item.id },
          data: {
            extractionStatus: result.source === "failed" ? "failed" : EXTRACTION_DECLINED,
            extractionAttempts: { increment: 1 },
            extractionError: result.error ?? null,
            // ⚠ NO "STORE THE RSS SNIPPET AS A FALLBACK". There is no RSS snippet: on a google_news row
            // `summary` is "{headline} {publisher}". This branch used to copy it into `contentText` and
            // label it "rss_snippet", which is how 1,281 rows came to hold a headline in a field named
            // content. A failed extraction leaves contentText NULL — the honest record of "we have no
            // body for this item". `summary` is still on the row for anyone who wants it.
            contentText: null,
            contentSource: null,
            contentTokens: null,
          },
        });
        failed++;
      }
    } catch (e) {
      await prisma.stockNews.update({
        where: { id: item.id },
        data: {
          extractionStatus: "failed",
          extractionAttempts: { increment: 1 },
          extractionError: (e as Error).message,
        },
      });
      failed++;
    }

    // Polite delay between extractions
    await new Promise((r) => setTimeout(r, 500));

    if (onItemComplete) {
      const shouldContinue = await onItemComplete(idx + 1, pending.length, `item ${idx + 1}/${pending.length}`);
      if (!shouldContinue) break;
    }
  }

  const durationMs = Date.now() - start;
  console.log(
    `[ExtractionWorker] Done — extracted: ${extracted}, failed: ${failed}`,
  );

  await prisma.newsFetchLog.create({
    data: {
      fetchType: "extraction_worker",
      status: failed > extracted ? "partial" : "success",
      stocksProcessed: 0,
      itemsInserted: 0,
      itemsSkipped: failed,
      itemsExtracted: extracted,
      extractionFailed: failed,
      durationMs,
    },
  });

  return { extracted, failed, durationMs };
}

// ── Combined daily job ─────────────────────────────────────────

export async function runDailyNewsIngest(): Promise<void> {
  console.log("[News] Starting daily news ingest…");

  const nse = await runDailyNseAnnouncementsIngest(2);
  const google = await runDailyGoogleNewsIngest();

  console.log(
    `[News] Fetch complete — NSE: ${nse.nseInserted}, ` +
      `Google: ${google.googleInserted}, ` +
      `pending extraction: ${nse.pendingExtraction + google.pendingExtraction}`,
  );

  // Run extraction worker immediately after insert
  if (nse.pendingExtraction + google.pendingExtraction > 0) {
    console.log("[News] Starting extraction worker…");
    await runContentExtractionWorker(50);
  }
}

// ── Backfill ───────────────────────────────────────────────────

export async function runNewsBackfill(daysBack: number = 90, onBatchComplete?: BatchProgressFn, signal?: AbortSignal): Promise<void> {
  const stocks = await loadUniverse();
  const to = new Date();
  const from = new Date(to.getTime() - daysBack * 86400_000);

  const BATCH_SIZE = 5;
  const batches: typeof stocks[] = [];
  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    batches.push(stocks.slice(i, i + BATCH_SIZE));
  }

  console.log(`[NewsBackfill] ${stocks.length} stocks, ${daysBack} days back, ${batches.length} batches…`);

  let totalInserted = 0;
  let totalPending = 0;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const batchNum = batchIdx + 1;

    for (const stock of batch) {
      try {
        const { announcements: anns } = await fetchNseAnnouncements(
          stock.symbol,
          from,
          to,
          signal,
        );
        for (const ann of anns) {
          const result = await insertNseAnnouncement(stock.id, stock.symbol, ann);
          if (result === "inserted") {
            totalInserted++;
            if (ann.shouldExtract) totalPending++;
          }
        }
      } catch (e) {
        console.warn(`[NewsBackfill] ${stock.symbol}:`, (e as Error).message);
      }
      await new Promise((r) => setTimeout(r, 600));
    }

    console.log(
      `[NewsBackfill] Batch ${batchNum}/${batches.length} complete — inserted=${totalInserted} queued=${totalPending} so far`,
    );

    if (onBatchComplete) {
      const shouldContinue = await onBatchComplete(
        batchNum,
        batches.length,
        `backfill batch ${batchNum}/${batches.length} — ${batch.map((s) => s.symbol).join(", ")}`,
      );
      if (!shouldContinue) break;
    }

    // Inter-batch delay
    if (batchIdx + 1 < batches.length) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(
    `[NewsBackfill] Inserted: ${totalInserted}, queued for extraction: ${totalPending}`,
  );

  // Run extraction worker in batches
  let remaining = totalPending;
  while (remaining > 0) {
    const { extracted } = await runContentExtractionWorker(30);
    if (extracted === 0) break; // nothing left to process
    remaining -= extracted;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
