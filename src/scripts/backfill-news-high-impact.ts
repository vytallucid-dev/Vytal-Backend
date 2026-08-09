// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RECOMPUTE stock_news.is_high_impact FOR STORED NSE FILINGS.
//
// ★ WHY A BACKFILL AND NOT FORWARD-ONLY. `is_high_impact` is DERIVED, purely and deterministically,
// from two fields already on the row — the filing-type bucket (`headline`) and NSE's own excerpt
// (`summary`). So unlike `publisher_domain`, whose history is genuinely unknowable, this backfill is
// EXACT rather than partial: it produces the same value the ingest would have written.
//
// And forward-only would leave the fix invisible. stock_news holds a rolling 90-day window, and that
// window IS the reader's entire dataset — a control fixed only for rows not yet ingested stays broken
// on screen for up to 90 days. "High impact only" is a SHIPPED control that readers trust, and it was
// near-inverted: 643 of 884 flagged filings were routine compliance while 516 filings whose own
// summary says "financial result" were not flagged at all.
//
// ⚠ THIS MUTATES A DERIVED DISPLAY FIELD, WHICH IS NOT THE APPEND-ONLY CASE. The scoring layer is
// append-only because a superseded snapshot is still true about the moment it described. A materiality
// classification is not history — a wrong one is a wrong answer sitting next to the filing it
// mis-describes. Same reasoning as QuarterBrief being mutable-in-place.
//
// SAFE TO RE-RUN: idempotent by construction (it writes the computed value, and only where it differs).
// Re-run it whenever ROUTINE_BUCKETS / MATERIAL_BUCKETS / MATERIAL_SUMMARY_RE change — that is the
// maintenance contract, and it is why this is a script rather than a migration.
//
// ⚠ google_news rows are DELIBERATELY NOT TOUCHED. See the report: on press items the flag is an
// English-keyword artefact (36.4% of Latin-script rows flagged vs 5.9% of the same stories in Hindi,
// Telugu, Tamil or Punjabi), so recomputing it would dress up a language filter as a fix. The press
// toggle is being retired instead.
//
//   npx tsx src/scripts/backfill-news-high-impact.ts [--dry]
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { detectHighImpact } from "../ingestions/news_and_announcements/nse-announcements.js";

const dry = process.argv.includes("--dry");

async function main(): Promise<void> {
  const rows = await prisma.stockNews.findMany({
    where: { sourceType: "nse_announcement" },
    select: { id: true, headline: true, summary: true, isHighImpact: true },
  });

  const promote: string[] = [];
  const demote: string[] = [];
  const byBucketPromote = new Map<string, number>();
  const byBucketDemote = new Map<string, number>();

  for (const r of rows) {
    const want = detectHighImpact(r.headline, r.summary);
    if (want === r.isHighImpact) continue;
    const bucket = r.headline.slice(0, 74);
    if (want) {
      promote.push(r.id);
      byBucketPromote.set(bucket, (byBucketPromote.get(bucket) ?? 0) + 1);
    } else {
      demote.push(r.id);
      byBucketDemote.set(bucket, (byBucketDemote.get(bucket) ?? 0) + 1);
    }
  }

  const before = rows.filter((r) => r.isHighImpact).length;
  const after = before + promote.length - demote.length;

  console.log(`── stored NSE filings: ${rows.length}`);
  console.log(`   flagged BEFORE : ${before} (${((100 * before) / rows.length).toFixed(1)}%)`);
  console.log(`   flagged AFTER  : ${after} (${((100 * after) / rows.length).toFixed(1)}%)`);
  console.log(`\n✅ CATCH SET — becoming high impact (${promote.length} rows):`);
  for (const [b, n] of [...byBucketPromote].sort((x, y) => y[1] - x[1]))
    console.log(`   +${String(n).padStart(4)}  ${b}`);
  console.log(`\n★ FALSE-POSITIVE SET — correctly losing the flag (${demote.length} rows):`);
  for (const [b, n] of [...byBucketDemote].sort((x, y) => y[1] - x[1]))
    console.log(`   -${String(n).padStart(4)}  ${b}`);

  if (dry) {
    console.log("\n(--dry: nothing written)");
    return;
  }

  // Two set-based updates rather than a row loop — the value is the same for every id in each list.
  const CHUNK = 1_000;
  for (const [ids, value] of [
    [promote, true],
    [demote, false],
  ] as const) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      await prisma.stockNews.updateMany({
        where: { id: { in: ids.slice(i, i + CHUNK) } },
        data: { isHighImpact: value },
      });
    }
  }
  console.log(`\n✅ written — ${promote.length} promoted, ${demote.length} demoted.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
