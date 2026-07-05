import type { Request, Response } from "express";
import { prisma } from "../../db/prisma.js";
import { NewsQuerySchema } from "../../schema/schema.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";

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

    const [news, total] = await prisma.$transaction([
      prisma.stockNews.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        take: limit,
        skip,
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
          isHighImpact: true,
          extractionStatus: true,
          publishedAt: true,
        },
      }),
      prisma.stockNews.count({ where }),
    ]);

    return res.json({
      success: true,
      data: {
        symbol: stock.symbol,
        name: stock.name,
        news: news.map((n) => ({
          ...n,
          publishedAt: n.publishedAt.toISOString(),
        })),
        pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    console.error("[news/symbol]", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch news" });
  }
};

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

export const getNewsBySymbolAndId = async (req: Request, res: Response) => {
  try {
    const news = await prisma.stockNews.findUnique({
      where: { id: req.params.newsId as string },
      include: {
        stock: { select: { symbol: true, name: true } },
        aiSummaries: {
          orderBy: { generatedAt: "desc" },
          take: 1,
          select: {
            id: true,
            content: true,
            headline: true,
            keyPoints: true,
            summaryType: true,
            modelVersion: true,
            generatedAt: true,
          },
        },
      },
    });

    if (!news) {
      return res
        .status(404)
        .json({ success: false, error: "News item not found" });
    }

    return res.json({
      success: true,
      data: {
        ...news,
        publishedAt: news.publishedAt.toISOString(),
        fetchedAt: news.fetchedAt.toISOString(),
        extractedAt: news.extractedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Failed" });
  }
};

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
