import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import { NewsQuerySchema } from "../../schema/schema.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";
import {
  buildGuardForStock,
  screenStoredNews,
  MAX_WINDOW_ROWS,
} from "../../ingestions/news_and_announcements/relevance.js";

export const getNewsFetchLogs = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) ?? "1"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt((req.query.limit as string) ?? "20")),
    );
    const skip = (page - 1) * limit;

    const [logs, total] = await prisma.$transaction([
      prisma.newsFetchLog.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
      }),
      prisma.newsFetchLog.count(),
    ]);

    return res.json({
      success: true,
      data: logs,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[news/fetch-logs]", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch logs" });
  }
};

export const getNewsBySymbol = async (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const q = NewsQuerySchema.safeParse(req.query);
    if (!q.success) {
      return res.status(400).json({ success: false, error: "Invalid query" });
    }

    const { page, limit, type, highImpact, days, withContent } = q.data;
    const skip = (page - 1) * limit;

    const stock = await prisma.stock.findUnique({
      where: { symbol },
      select: { id: true, symbol: true, name: true },
    });
    if (!stock) {
      return res
        .status(404)
        .json({ success: false, error: `${symbol} not in universe` });
    }

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);

    const where: NonNullable<
      Parameters<typeof prisma.stockNews.findMany>[0]
    >["where"] = {
      stockId: stock.id,
      publishedAt: { gte: since },
      ...(type !== "all" ? { sourceType: type } : {}),
      ...(highImpact != null ? { isHighImpact: highImpact } : {}),
    };

    // ── ★ THE WINDOW IS READ WHOLE, THEN SCREENED, THEN PAGED — IN THAT ORDER. ──────────────────
    // Screening after a LIMIT would be incoherent: `total` would count unscreened rows while the page
    // showed screened ones, so "Showing 13 of 84" would be two different populations (the frontend
    // already had a milder version of this bug, de-duplicating client-side AFTER paging). Reading the
    // window whole makes `total` the post-screen count and the page a slice of it.
    //
    // COST: one scan of the existing @@index([stockId, publishedAt(sort: Desc)]). Retention prunes at
    // 90 days and the busiest covered stock holds 146 rows across that window, so this is a
    // ~150-row read — smaller than the two-query take+count it replaces, which paid for a COUNT over
    // the same range. No new index, no cache. MAX_WINDOW_ROWS is a ceiling, not an expectation.
    const windowRows = await prisma.stockNews.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take: MAX_WINDOW_ROWS,
      select: {
        id: true,
        sourceType: true,
        headline: true,
        summary: true,
        // Only return full content if explicitly requested
        // (reduces payload size for list views)
        contentText: withContent ? true : false,
        contentSource: true,
        contentTokens: true,
        category: true,
        subcategory: true,
        pdfUrl: true,
        externalUrl: true,
        publisherDomain: true,
        isHighImpact: true,
        extractionStatus: true,
        publishedAt: true,
      },
    });

    // The guard is only needed when press rows are in scope. A Filings-only request skips the read.
    const needsGuard = windowRows.some((n) => n.sourceType === "google_news");
    const screened = needsGuard
      ? screenStoredNews(windowRows, await buildGuardForStock(stock.symbol, stock.name))
      : {
          kept: windowRows,
          considered: 0,
          hidden: 0,
          // A Filings-only view is all subjects by definition — the exchange bound each row to this
          // company. See isSubject in relevance.ts.
          subjects: windowRows.length,
          mentions: 0,
          byReason: {},
        };

    const total = screened.kept.length;
    const news = screened.kept.slice(skip, skip + limit);

    return res.json({
      success: true,
      data: {
        symbol: stock.symbol,
        name: stock.name,
        news: news.map((n) => ({
          ...n,
          publishedAt: n.publishedAt.toISOString(),
        })),
        /**
         * ★ `total` IS THE POST-SCREEN COUNT. It is what the reader can actually reach, so the count
         * line cannot contradict the list. `screened` carries the arithmetic behind it so the UI can
         * say what happened instead of silently showing a smaller number:
         *   considered — press rows examined (0 on a Filings-only view; filings are never screened)
         *   hidden     — press rows removed as not about this company
         *   subjects   — kept rows where the company leads the headline (filings always count here)
         *   mentions   — kept rows that name it but are about something else. NOT hidden: they are
         *                ranked below the subjects, and `news` arrives in that order.
         */
        screened: {
          considered: screened.considered,
          hidden: screened.hidden,
          subjects: screened.subjects,
          mentions: screened.mentions,
        },
        pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
      },
    });
  } catch (err) {
    console.error("[news/symbol]", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch news" });
  }
};

/**
 * ⚠⚠ THIS FEED IS NOT RELEVANCE-SCREENED, AND THAT IS A KNOWN GAP — NOT AN OVERSIGHT.
 *
 * `getNewsBySymbol` and `buildNews` (Results Context) both screen their press rows through
 * ingestions/news_and_announcements/relevance.ts, because only ~30% of stored google_news rows are
 * about the company they are filed under. This feed does not, so the dashboard's Market News card can
 * still show a Sensex wrap or another company's quote page attributed to a stock.
 *
 * ★ IT IS A DIFFERENT SHAPE, NOT A SMALLER VERSION OF THE SAME ONE. The screen is per-company: it
 * needs that company's aliases and its universe-derived sibling markers. This feed returns 50 rows
 * spanning up to 50 DIFFERENT companies, so screening it needs a guard per company — 50 sibling reads
 * per request, or a batched build that does not exist yet. Bolting the single-stock helper onto a
 * cross-stock read would either be 50× the cost or silently screen every row against the wrong guard.
 *
 * Whoever picks this up: build a `buildGuardsForStocks(symbols[])` that resolves all sibling
 * candidates in ONE indexed read and returns a Map, then screen grouped by stockId. The pure core
 * (screenNewsItems) needs no change.
 */
export const getTodayNewsFeed = async (req: Request, res: Response) => {
  try {
    // Window is parametrized (default 7d, clamped) so the feed isn't hostage to a bare 24h.
    const daysRaw = parseInt(String(req.query.days ?? "7"), 10);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 30) : 7;
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);

    // Fallback ladder in ONE ordered read: high-impact rows first, then recent normal news
    // (each block newest-first). So the feed leads with high-impact when it exists, but stays
    // populated on quiet days instead of reading empty — never a fabricated headline.
    //
    // ⚠⚠ `isHighImpact: "desc"` IS A LANGUAGE-BIASED SORT KEY FOR PRESS ROWS. MEASURED, NOT SUSPECTED.
    // On google_news the flag comes from an ENGLISH keyword list (HIGH_IMPACT_KW in google-news.ts)
    // scanned against `headline` — and `summary` on a press row is that same headline, so there is no
    // second field to save it. Of post-screen press rows, 36.4% of LATIN-script headlines are flagged
    // versus 5.9% of non-Latin ones: a 6.2× gap on identical events ("HUDCO Profit Jumps 35%" flagged,
    // "HUDCO का मुनाफा 35% उछला" not). Non-Latin is 14.4% of the press set. So this ordering
    // systematically pushes Hindi/Marathi/Telugu/Tamil/Punjabi coverage down the dashboard.
    // It also fires on quote pages and how-tos ("Tata Capital IPO allotment link active").
    //
    // The "High impact only" toggle was retired on the press stream for exactly this reason (it is
    // Filings-only now). This ordering is the remaining consumer of the press flag.
    // ★ RECOMMENDED FIX, deliberately not taken here because it changes dashboard behaviour beyond the
    // brief: order by `publishedAt` alone for press rows, or set is_high_impact = false on all
    // google_news rows and let the filings flag do the leading. Filings ordering is sound — see
    // detectHighImpact in nse-announcements.ts.
    const news = await prisma.stockNews.findMany({
      where: {
        publishedAt: { gte: since },
        stock: { isActive: true },
      },
      orderBy: [{ isHighImpact: "desc" }, { publishedAt: "desc" }],
      take: 50,
      include: {
        stock: {
          select: {
            symbol: true,
            name: true,
            sector: { select: { displayName: true } },
          },
        },
      },
    });

    return res.json({
      success: true,
      data: news.map((n) => ({
        id: n.id,
        symbol: n.stock.symbol,
        companyName: n.stock.name,
        sector: n.stock.sector?.displayName ?? null,
        sourceType: n.sourceType,
        headline: n.headline,
        summary: n.summary,
        category: n.category,
        pdfUrl: n.pdfUrl,
        externalUrl: n.externalUrl,
        isHighImpact: n.isHighImpact,
        hasFullContent: n.extractionStatus === "extracted",
        publishedAt: n.publishedAt.toISOString(),
      })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Failed" });
  }
};

// ── ⚠ getNewsBySymbolAndId REMOVED (2026-08-09) ───────────────────────────────────────────
// The single-item handler for GET /api/v1/news/:symbol/:newsId. It `include`d an `aiSummaries`
// relation that ceased to exist when ai_summaries was dropped, so every call threw
// PrismaClientValidationError → 500. No caller existed in either repo. It was also the only
// response that spread the whole row (`...news`), which made it the last path leaking both
// `sentiment` (retired) and `contentText` by default. See news-route.ts for why tsc passed.
// ──────────────────────────────────────────────────────────────────────────────────────────

export const triggerDailyNewsIngest = async (_req: Request, res: Response) => {
  const job = await enqueueJob({
    type: JobTypes.DAILY_NEWS_INGEST,
    payload: {},
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: "Daily news ingest enqueued. Poll the status URL for progress.",
    },
  });
};

export const triggerDailyNseAnnouncementsIngest = async (
  req: Request,
  res: Response,
) => {
  const days = parseInt(req.body?.days ?? "2");

  const job = await enqueueJob({
    type: JobTypes.NSE_ANNOUNCEMENTS_INGEST,
    payload: { days },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: `NSE announcements ingest (${days} days) enqueued. Poll the status URL for progress.`,
    },
  });
};

export const triggerDailyGoogleNewsIngest = async (
  req: Request,
  res: Response,
) => {
  const days = parseInt(req.body?.days ?? "7");

  const job = await enqueueJob({
    type: JobTypes.GOOGLE_NEWS_INGEST,
    payload: { days },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: `Google News ingest (${days} days) enqueued. Poll the status URL for progress.`,
    },
  });
};

export const triggerContentExtractionWorker = async (
  req: Request,
  res: Response,
) => {
  const batchSize = parseInt(req.body?.batchSize ?? "20");

  const job = await enqueueJob({
    type: JobTypes.NEWS_CONTENT_EXTRACTION,
    payload: { batchSize },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: `Content extraction (batch: ${batchSize}) enqueued. Poll the status URL for progress.`,
    },
  });
};

export const triggerNewsBackfill = async (req: Request, res: Response) => {
  const days = Math.min(parseInt(req.body?.days ?? "365"), 365);

  const job = await enqueueJob({
    type: JobTypes.NEWS_BACKFILL,
    payload: { days },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: `News backfill (${days} days) enqueued. Poll the status URL for progress.`,
    },
  });
};
