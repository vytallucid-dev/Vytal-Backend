// src/lib/news/ingest-news.ts
// ─────────────────────────────────────────────────────────────
// Full news ingestion pipeline:
//   Phase 1 — Fetch & insert (fast, runs daily)
//   Phase 2 — Extract content (slower, runs after insert)
//
// Phase 1: Insert all news items immediately with extractionStatus
//   = "pending" for items that need content extraction.
//
// Phase 2: Extraction worker picks up "pending" items and:
//   - NSE PDFs: fetch PDF → extract text via pdf-parse
//   - Free articles: fetch URL → scrape body via cheerio
//   - Paywalled: use RSS snippet (already stored as summary)
//
// The two-phase approach means daily fetch is fast (~2-4 min for
// 100 stocks) and extraction runs asynchronously after insert.
// ─────────────────────────────────────────────────────────────

import {
  fetchNseAnnouncements,
  type NseAnnouncement,
} from "./nse-announcements.js";
import { fetchGoogleNews, type GoogleNewsItem } from "./google-news.js";
import { extractPdfText, extractArticleText } from "./content-extractor.js";
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
        summary: ann.summary, // attchmntText excerpt (always stored)
        contentText: null, // filled by extraction worker
        contentSource: ann.shouldExtract ? "pending" : null,
        contentTokens: null,
        category: ann.category,
        subcategory: ann.subcategory,
        pdfUrl: ann.pdfUrl, // always stored
        externalUrl: null,
        isHighImpact: ann.isHighImpact,
        publishedAt: ann.publishedAt,
        extractionStatus: ann.shouldExtract ? "pending" : "not_applicable",
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
    // For paywalled sources: use RSS snippet as contentText immediately
    // (no extraction needed — snippet is the best we'll ever get)
    const isPaywalled = !item.shouldScrape;
    const contentText = isPaywalled ? item.summary : null;
    const contentSource = isPaywalled
      ? item.summary
        ? "rss_snippet"
        : null
      : item.shouldScrape
        ? "pending"
        : null;
    const extractionStatus = isPaywalled
      ? "skipped"
      : item.shouldScrape
        ? "pending"
        : "not_applicable";

    await prisma.stockNews.create({
      data: {
        stockId,
        symbol,
        sourceType: "google_news",
        sourceId: item.sourceId,
        headline: item.headline,
        summary: item.summary, // RSS snippet (always stored)
        contentText, // filled immediately for paywalled
        contentSource,
        contentTokens: contentText ? Math.round(contentText.length / 4) : null,
        category: item.sourceName, // publication name
        subcategory: null,
        pdfUrl: null,
        externalUrl: item.externalUrl, // always stored
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
          );
          responsesReceived++;
          if (malformed) nonRssBodies++;
          const recent = items.filter((n) => n.publishedAt >= cutoff);
          itemsParsed += recent.length;

          for (const item of recent) {
            const result = await insertGoogleNewsItem(
              stock.id,
              stock.symbol,
              item,
            );
            if (result === "inserted") {
              inserted++;
              if (item.shouldScrape) pendingExtraction++;
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
      `[GoogleNews] Done — inserted: ${inserted}, pending scraping: ${pendingExtraction}`,
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

      if (item.sourceType === "nse_announcement" && item.pdfUrl) {
        // Extract PDF text
        result = await extractPdfText(item.pdfUrl, signal);
      } else if (item.sourceType === "google_news" && item.externalUrl) {
        // Scrape article or use RSS snippet
        result = await extractArticleText(item.externalUrl, item.summary, signal);
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
            extractionStatus: result.source === "failed" ? "failed" : "skipped",
            extractionAttempts: { increment: 1 },
            extractionError: result.error ?? null,
            // Even if extraction failed, store RSS snippet if available
            contentText: item.summary ?? null,
            contentSource: item.summary ? "rss_snippet" : null,
            contentTokens: item.summary
              ? Math.round(item.summary.length / 4)
              : null,
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
