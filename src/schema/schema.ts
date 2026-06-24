import { z } from "zod";

// ── Request body schema ───────────────────────────────────────
export const UploadBodySchema = z.object({
  symbol: z
    .string()
    .min(1, "NSE symbol is required")
    .max(20)
    .regex(/^[A-Za-z0-9&-]+$/, "Invalid symbol format"),
  sectorId: z.string().uuid().optional(),
});

export const DealsQuerySchema = z.object({
  type: z.enum(["bulk", "block", "all"]).default("all"),
  side: z.enum(["buy", "sell", "all"]).default("all"),
  days: z.coerce.number().int().min(1).max(365).default(90),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const BackfillSchema = z.object({
  days: z.number().int().min(1).max(90).default(90),
});

export const FetchLogsQuerySchema = z.object({
  status: z.enum(["success", "failed", "partial", "all"]).default("all"),
  fetchType: z.enum(["daily", "backfill", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const PriceLogsQuerySchema = z.object({
  status: z
    .enum(["success", "failed", "partial", "market_closed", "all"])
    .default("all"),
  provider: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const DailyPricesQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(365).default(90),
});

export const PriceBackfillSchema = z.object({
  days: z.number().int().min(1).max(365).default(365),
});

// ── Indices (display-only — mirror of the price schemas) ──────

export const IndexLogsQuerySchema = z.object({
  status: z
    .enum(["success", "failed", "partial", "market_closed", "all"])
    .default("all"),
  source: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const IndexBackfillSchema = z.object({
  days: z.number().int().min(1).max(365).default(365),
});

export const CalendarQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  types: z.string().optional(), // comma-separated: "earnings,dividend"
  sector: z.string().optional(),
});

export const InsiderTradesQuerySchema = z.object({
  category: z
    .enum([
      "promoter",
      "promoter_group",
      "director",
      "kmp",
      "designated_employee",
      "immediate_relative",
      "other",
      "all",
    ])
    .default("all"),
  type: z
    .enum([
      "buy",
      "sell",
      "pledge",
      "revoke_pledge",
      "inter_se_transfer",
      "esos",
      "other",
      "all",
    ])
    .default("all"),
  days: z.coerce.number().int().min(1).max(365).default(90),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const InsiderTradeLogsQuerySchema = z.object({
  status: z
    .enum(["success", "failed", "partial", "no_data", "all"])
    .default("all"),
  fetchType: z.enum(["daily", "backfill", "manual", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const InsiderBackfillSchema = z.object({
  months: z.number().int().min(1).max(24).default(12),
});


export const NewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  type: z.enum(['all', 'nse_announcement', 'google_news']).default('all'),
  highImpact: z.string().optional().transform((v) => v === 'true' ? true : v === 'false' ? false : undefined),
  days: z.coerce.number().int().min(1).max(365).default(90),
  withContent: z.string().optional().transform((v) => v === 'true'),
})

export const ComputeBodySchema = z.object({
  scope: z.enum(['all', 'sector', 'single']).default('all'),
  sectorId: z.string().uuid().optional(),
  peerGroupId: z.string().uuid().optional(),
})

export const PeerMetricsLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['success', 'partial', 'failed', 'all']).default('all'),
  runType: z.enum(['full', 'single', 'sector', 'all']).default('all'),
  triggerType: z.enum(['scheduled', 'post_upload', 'manual_api', 'manual_seed', 'all']).default('all'),
})