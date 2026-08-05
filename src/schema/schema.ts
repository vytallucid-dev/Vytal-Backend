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

// 4 years ≈ 992 trading days at NSE's ~248/yr. The Market pillar's A2 sub-component
// gates at 756 trading days and D1's sector-vol baseline samples a trailing 3yr window
// (needing ~846); 3 calendar years is only ~744 bars and silently drops A2 for every
// stock. 4y is the smallest window that clears both with headroom.
export const PRICE_BACKFILL_MAX_DAYS = 1461; // 4 calendar years (incl. one leap day)

export const PriceBackfillSchema = z.object({
  days: z.number().int().min(1).max(PRICE_BACKFILL_MAX_DAYS).default(PRICE_BACKFILL_MAX_DAYS),
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

// ── The calendar window is TWO-DIRECTIONAL ────────────────────────────────────────────
// `days` is the original forward look-ahead and still the default every legacy caller gets
// (dashboard / portfolio "upcoming" cards send days=90 and are untouched). `from`/`to` are the
// explicit window the calendar's month grid needs to read HISTORY — corporate events are
// permanent records, not a forward-only feed, so a reader must be able to walk back to the
// oldest row we hold. Supplying either one replaces the `days` window entirely; an omitted end
// is open (from-only = everything from that date on, to-only = all history up to it).
//
// `limit`/`cursor` turn the same endpoint into a keyset-paged feed for the timeline's infinite
// scroll. Keyset, not offset: the events table is re-ingested weekly under the reader, and an
// offset page 2 resolved against a list that gained a row at the top silently repeats a card.
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const CalendarQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  from: z.string().regex(YMD, "from must be YYYY-MM-DD").optional(),
  to: z.string().regex(YMD, "to must be YYYY-MM-DD").optional(),
  types: z.string().optional(), // comma-separated: "earnings,dividend"
  sector: z.string().optional(),
  /** Page size. Present ⇒ the response is paged and carries a `cursor`. */
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /** Opaque cursor from the previous page. Omit for the first page. */
  cursor: z.string().optional(),
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