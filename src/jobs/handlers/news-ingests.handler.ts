import type { JobContext } from "../context.js";
import type {
  DailyNewsIngestPayload,
  NseAnnouncementsIngestPayload,
  GoogleNewsIngestPayload,
  NewsContentExtractionPayload,
  NewsBackfillPayload,
} from "../types.js";
import {
  runDailyNseAnnouncementsIngest,
  runDailyGoogleNewsIngest,
  runContentExtractionWorker,
  runNewsBackfill,
} from "../../ingestions/news_and_announcements/ingest-news.js";

export async function handleDailyNewsIngest(
  ctx: JobContext<DailyNewsIngestPayload>,
) {
  // Phase 1: NSE announcements (1%–40%)
  await ctx.reportProgress(1, "Starting NSE announcements ingest");
  await runDailyNseAnnouncementsIngest(2, async (done, total, label) => {
    const pct = 1 + Math.round((done / total) * 38); // 1→39%
    await ctx.reportProgress(pct, `NSE: ${label}`);
    return !(await ctx.shouldCancel());
  }, ctx.signal);

  if (await ctx.shouldCancel()) return { status: "cancelled" };

  // Phase 2: Google News (40%–75%)
  await ctx.reportProgress(40, "Starting Google News ingest");
  await runDailyGoogleNewsIngest(7, async (done, total, label) => {
    const pct = 40 + Math.round((done / total) * 34); // 40→74%
    await ctx.reportProgress(pct, `Google: ${label}`);
    return !(await ctx.shouldCancel());
  }, ctx.signal);

  if (await ctx.shouldCancel()) return { status: "cancelled" };

  // Phase 3: Content extraction (75%–100%)
  await ctx.reportProgress(75, "Starting content extraction");
  await runContentExtractionWorker(50, async (done, total, label) => {
    const pct = 75 + Math.round((done / total) * 24); // 75→99%
    await ctx.reportProgress(pct, `Extraction: ${label}`);
    return !(await ctx.shouldCancel());
  }, ctx.signal);

  await ctx.reportProgress(100, "Daily news ingest complete");
  return { status: "complete" };
}

export async function handleNseAnnouncementsIngest(
  ctx: JobContext<NseAnnouncementsIngestPayload>,
) {
  const { days } = ctx.payload;
  await ctx.reportProgress(1, `Starting NSE announcements ingest (${days} days)`);
  await runDailyNseAnnouncementsIngest(days, async (done, total, label) => {
    const pct = 1 + Math.round((done / total) * 98);
    await ctx.reportProgress(pct, label);
    return !(await ctx.shouldCancel());
  }, ctx.signal);
  await ctx.reportProgress(100, "NSE announcements ingest complete");
  return { days, status: "complete" };
}

export async function handleGoogleNewsIngest(
  ctx: JobContext<GoogleNewsIngestPayload>,
) {
  const { days } = ctx.payload;
  await ctx.reportProgress(1, `Starting Google News ingest (${days} days)`);
  await runDailyGoogleNewsIngest(days, async (done, total, label) => {
    const pct = 1 + Math.round((done / total) * 98);
    await ctx.reportProgress(pct, label);
    return !(await ctx.shouldCancel());
  }, ctx.signal);
  await ctx.reportProgress(100, "Google News ingest complete");
  return { days, status: "complete" };
}

export async function handleNewsContentExtraction(
  ctx: JobContext<NewsContentExtractionPayload>,
) {
  const { batchSize } = ctx.payload;
  await ctx.reportProgress(1, `Starting content extraction (batch: ${batchSize})`);
  await runContentExtractionWorker(batchSize, async (done, total, label) => {
    const pct = 1 + Math.round((done / total) * 98);
    await ctx.reportProgress(pct, label);
    return !(await ctx.shouldCancel());
  }, ctx.signal);
  await ctx.reportProgress(100, "Content extraction complete");
  return { batchSize, status: "complete" };
}

export async function handleNewsBackfill(
  ctx: JobContext<NewsBackfillPayload>,
) {
  const { days } = ctx.payload;
  await ctx.reportProgress(1, `Starting news backfill for last ${days} days`);
  await runNewsBackfill(days, async (done, total, label) => {
    const pct = 1 + Math.round((done / total) * 98);
    await ctx.reportProgress(pct, label);
    return !(await ctx.shouldCancel());
  }, ctx.signal);
  await ctx.reportProgress(100, "News backfill complete");
  return { days, status: "complete" };
}
