// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RE-MARK stock_news ROWS THAT CLAIM WORK WHICH WILL NEVER HAPPEN.
//
// `extraction_status = "pending"` means "queued for content extraction". The extraction worker was
// removed from lib/scheduler.ts on 2026-07-26, so on this database it means nothing is coming.
//
// ⚠ THIS IS THE SECOND TIME. The scheduler comment records that the 6,544 rows pending at switch-off
// were re-marked "skipped" PRECISELY so nothing would infer future work — and two weeks of ingest put
// 15,805 rows back, because the INGEST never stopped writing "pending". Running this script alone would
// repeat that a third time. The cause is closed in the same change:
//     content-extractor.ts → CONTENT_EXTRACTION_ENABLED = false
// which forces shouldExtractPdf / shouldScrapeArticle to false, so both insert paths in ingest-news.ts
// now write EXTRACTION_DECLINED instead of "pending". Verify that flag is still false before deciding
// this script is idempotent in practice — if extraction is ever re-enabled, "pending" becomes truthful
// again and this script must NOT be run.
//
// ── WHY "skipped" AND NOT "not_applicable" ────────────────────────────────────────────────────────
// "skipped" is the value the worker itself writes when it declines an item, and it is what the
// 2026-07-26 re-marking used. One value, one meaning — a second synonym for the same decision would
// make the column harder to read, not more precise.
//
// ⚠ ROWS ARE NOT LOST. Nothing is deleted and no content is touched: `summary`, `pdf_url` and
// `external_url` are untouched, and a re-enabled worker can be pointed at these rows deliberately.
// What changes is that the column stops asserting a queue that does not exist.
//
//   npx tsx src/scripts/backfill-news-extraction-status.ts [--dry]
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import {
  CONTENT_EXTRACTION_ENABLED,
  EXTRACTION_DECLINED,
} from "../ingestions/news_and_announcements/content-extractor.js";

const dry = process.argv.includes("--dry");

async function main(): Promise<void> {
  if (CONTENT_EXTRACTION_ENABLED) {
    console.error(
      "❌ REFUSING TO RUN. CONTENT_EXTRACTION_ENABLED is true, so \"pending\" is a truthful queue and\n" +
        "   re-marking it would delete real work. Turn extraction off first, or do not run this.",
    );
    process.exit(1);
  }

  const before = await prisma.stockNews.groupBy({
    by: ["sourceType", "extractionStatus"],
    _count: { _all: true },
    orderBy: [{ sourceType: "asc" }, { extractionStatus: "asc" }],
  });
  console.log("── extraction_status BEFORE");
  for (const r of before)
    console.log(`   ${r.sourceType.padEnd(18)} ${r.extractionStatus.padEnd(16)} ${r._count._all}`);

  const pending = await prisma.stockNews.count({ where: { extractionStatus: "pending" } });
  console.log(`\n   rows claiming a queue that does not exist: ${pending}`);

  // ⚠ Also clear the labelled-copy rows: contentText that is byte-identical to summary is a headline
  // wearing the name "content" (see the note in ingest-news.ts). Left in place it keeps the row looking
  // like it holds an extracted body.
  const fakeContent = await prisma.$queryRaw<
    { n: bigint }[]
  >`SELECT count(*) AS n FROM stock_news WHERE content_source = 'rss_snippet' AND btrim(content_text) = btrim(summary)`;
  const fakeCount = Number(fakeContent[0]?.n ?? 0);
  console.log(`   rows whose "extracted content" is byte-identical to summary: ${fakeCount}`);

  if (dry) {
    console.log("\n(--dry: nothing written)");
    return;
  }

  const remarked = await prisma.stockNews.updateMany({
    where: { extractionStatus: "pending" },
    data: { extractionStatus: EXTRACTION_DECLINED },
  });

  // Null out the labelled copies. contentSource/contentTokens go with it — a token estimate of a
  // headline is not a measurement of anything.
  const cleared = await prisma.$executeRaw`
    UPDATE stock_news
       SET content_text = NULL, content_source = NULL, content_tokens = NULL
     WHERE content_source = 'rss_snippet'
       AND btrim(content_text) = btrim(summary)`;

  // ⚠ AND THE STATUS HAS TO FOLLOW THE CONTENT. Clearing the copies above leaves rows asserting
  // extraction_status = "extracted" with no content_text — the same category of lie, pointing the other
  // way. "extracted" must mean a body is present; where none is, the honest value is the declined one.
  // Ordered AFTER the clear so it catches exactly the rows that just lost their fake content.
  const destatused = await prisma.stockNews.updateMany({
    where: { extractionStatus: "extracted", contentText: null },
    data: { extractionStatus: EXTRACTION_DECLINED },
  });

  // `content_source = "pending"` is the same assertion as the status, in a second column. Leaving it
  // behind means a row reads "declined" and "queued" at once, and the next person has to work out which
  // column is authoritative. The status is; this one is a duplicate that drifted.
  const desourced = await prisma.stockNews.updateMany({
    where: { contentSource: "pending", NOT: { extractionStatus: "pending" } },
    data: { contentSource: null },
  });

  console.log(`\n✅ re-marked ${remarked.count} rows "pending" → "${EXTRACTION_DECLINED}"`);
  console.log(`✅ cleared ${cleared} rows of headline-as-content`);
  console.log(`✅ re-marked ${destatused.count} rows "extracted" (with no content) → "${EXTRACTION_DECLINED}"`);
  console.log(`✅ cleared content_source "pending" on ${desourced.count} rows whose status is not pending`);

  const after = await prisma.stockNews.groupBy({
    by: ["sourceType", "extractionStatus"],
    _count: { _all: true },
    orderBy: [{ sourceType: "asc" }, { extractionStatus: "asc" }],
  });
  console.log("\n── extraction_status AFTER");
  for (const r of after)
    console.log(`   ${r.sourceType.padEnd(18)} ${r.extractionStatus.padEnd(16)} ${r._count._all}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
