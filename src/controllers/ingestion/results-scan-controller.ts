// ─────────────────────────────────────────────────────────────
// RESULTS SCAN — ADMIN CONTROLLER
//
// Handlers for manually triggering and monitoring the v3 XBRL
// ingestion pipeline.
//
// Job list / cancel / status endpoints are NOT duplicated here —
// they already exist at /api/v1/admin/jobs (see src/routes/job-routes.ts
// and src/controllers/jobs-controller.ts).
// ─────────────────────────────────────────────────────────────

import type { Request, Response } from "express";
import { z } from "zod";
import { enqueueJob } from "../../jobs/enqueue.js";
import { JobTypes } from "../../jobs/types.js";
import { prisma } from "../../db/prisma.js";
import {
  refreshFiscalYearEnds,
  refreshIndustryTypes,
} from "../../seed/industry-types.js";

// ── Shared constants ─────────────────────────────────────────

const INDUSTRIES = [
  "non_financial",
  "banking",
  "nbfc",
  "life_insurance",
  "general_insurance",
] as const;

// ── POST /api/v1/admin/results-scan/universe ─────────────────
//
// Body: { mode: "universe" | "backfill", fromQeDate?: string,
//         industries?: string[], limit?: number }
// Returns: { jobId }

const UniverseScanBodySchema = z.object({
  mode: z.enum(["universe", "backfill"]),
  fromQeDate: z.string().datetime({ offset: true }).optional(),
  industries: z.array(z.enum(INDUSTRIES)).optional(),
  limit: z.number().int().positive().optional(),
});

export const enqueueUniverseScan = async (req: Request, res: Response) => {
  const parsed = UniverseScanBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid request body",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { mode, fromQeDate, industries, limit } = parsed.data;

  const job = await enqueueJob({
    type: JobTypes.RESULTS_SCAN,
    payload: { mode, fromQeDate, industries, limit },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: `results_scan (${mode}) enqueued. Poll statusUrl for progress.`,
      mode,
      fromQeDate,
      industries: industries ?? "all",
      limit: limit ?? "none",
    },
  });
};

// ── POST /api/v1/admin/results-scan/symbol ───────────────────
//
// Body: { symbol: string }
// Returns: { jobId }

const SymbolScanBodySchema = z.object({
  symbol: z.string().min(1).max(20).toUpperCase(),
});

export const enqueueSymbolScan = async (req: Request, res: Response) => {
  const parsed = SymbolScanBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid request body",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { symbol } = parsed.data;

  const job = await enqueueJob({
    type: JobTypes.RESULTS_SCAN,
    payload: { mode: "symbol", symbol },
    triggeredBy: "user:admin",
  });

  return res.status(202).json({
    success: true,
    data: {
      jobId: job.id,
      statusUrl: `/api/v1/admin/jobs/${job.id}`,
      message: `results_scan (symbol=${symbol}) enqueued. Poll statusUrl for progress.`,
      symbol,
    },
  });
};

// ── POST /api/v1/admin/results-scan/refresh-industry-types ───
//
// Body: { dryRun?: boolean }   (optional)
// Runs synchronously — fast DB-only operation.
// Returns the full result object from refreshIndustryTypes().

const RefreshIndustryTypesBodySchema = z.object({
  dryRun: z.boolean().optional().default(false),
});

export const runRefreshIndustryTypes = async (req: Request, res: Response) => {
  const parsed = RefreshIndustryTypesBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid request body",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await refreshIndustryTypes({ dryRun: parsed.data.dryRun });
    const fyResult = await refreshFiscalYearEnds();
    return res.json({
      success: true,
      data: result,
      fiscalYearEndResult: fyResult,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: (err as Error).message });
  }
};

// ── GET /api/v1/admin/results-scan/logs ──────────────────────
//
// Query: ?symbol=X&status=failed&source=nse&page=1&limit=10&hoursBack=24
// Returns: { logs: [...], pagination: { total, page, limit, pages } }

const LogsQuerySchema = z.object({
  symbol: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  hoursBack: z.coerce.number().int().min(1).default(48),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const getResultFetchLogs = async (req: Request, res: Response) => {
  const parsed = LogsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid query parameters",
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { symbol, status, source, hoursBack, page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

  const where = {
    ...(symbol ? { symbol: symbol.toUpperCase() } : {}),
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    fetchedAt: { gte: since },
  };

  try {
    const [logs, total] = await prisma.$transaction([
      prisma.resultFetchLog.findMany({
        where,
        orderBy: { fetchedAt: "desc" },
        take: limit,
        skip,
      }),
      prisma.resultFetchLog.count({ where }),
    ]);

    return res.json({
      success: true,
      data: {
        logs,
        pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    console.error("[results-scan/logs] error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch result fetch logs" });
  }
};

// ── GET /api/v1/admin/results-scan/stocks/:symbol/coverage ───
//
// For one stock, return row counts in the industry-appropriate
// fundamentals + quarterly tables based on Stock.industryType.

export const getStockCoverage = async (req: Request, res: Response) => {
  const symbol = (req.params.symbol as string).toUpperCase();

  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true, symbol: true, industryType: true },
  });

  if (!stock) {
    return res
      .status(404)
      .json({ success: false, error: `Stock not found: ${symbol}` });
  }

  try {
    let fundamentalsCount: number;
    let quartersCount: number;

    switch (stock.industryType) {
      case "banking":
        [fundamentalsCount, quartersCount] = await Promise.all([
          prisma.bankingFundamental.count({ where: { stockId: stock.id } }),
          prisma.bankingQuarterlyResult.count({ where: { stockId: stock.id } }),
        ]);
        break;

      case "nbfc":
        [fundamentalsCount, quartersCount] = await Promise.all([
          prisma.nbfcFundamental.count({ where: { stockId: stock.id } }),
          prisma.nbfcQuarterlyResult.count({ where: { stockId: stock.id } }),
        ]);
        break;

      case "life_insurance":
        [fundamentalsCount, quartersCount] = await Promise.all([
          prisma.lifeInsuranceFundamental.count({
            where: { stockId: stock.id },
          }),
          prisma.lifeInsuranceQuarterlyResult.count({
            where: { stockId: stock.id },
          }),
        ]);
        break;

      case "general_insurance":
        [fundamentalsCount, quartersCount] = await Promise.all([
          prisma.generalInsuranceFundamental.count({
            where: { stockId: stock.id },
          }),
          prisma.generalInsuranceQuarterlyResult.count({
            where: { stockId: stock.id },
          }),
        ]);
        break;

      default: // "non_financial"
        [fundamentalsCount, quartersCount] = await Promise.all([
          prisma.fundamental.count({ where: { stockId: stock.id } }),
          prisma.quarterlyResult.count({ where: { stockId: stock.id } }),
        ]);
        break;
    }

    const resultFetchLogCount = await prisma.resultFetchLog.count({
      where: { stockId: stock.id },
    });

    return res.json({
      success: true,
      data: {
        symbol: stock.symbol,
        industryType: stock.industryType,
        fundamentalsCount,
        quartersCount,
        resultFetchLogCount,
      },
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, error: (err as Error).message });
  }
};
