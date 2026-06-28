// ─────────────────────────────────────────────────────────────
// DRY-RUN harness for the news & announcements guards (cron 9 — two
// independent sources). Predicate tests (quiet-day + populated = clean;
// each breach = flagged) + reportIngestionError/dedup with SOURCE-LABELLED
// sentinel crons (_dryrun_news_nse / _dryrun_news_google) + best-effort LIVE
// single-symbol fetches confirming the REAL responses are healthy (NSE body
// is an array, Google body is RSS → zero-FP) + a real fetch-log zero-FP pass.
//
// Run:  npx tsx src/scripts/dryrun-news-guards.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import { fetchNseAnnouncements } from "../ingestions/news_and_announcements/nse-announcements.js";
import { fetchGoogleNews } from "../ingestions/news_and_announcements/google-news.js";
import {
  looksLikeRss,
  nseShapeBreach,
  nseFieldPresenceBreach,
  googleSourceDeadBreach,
  googleAggregateZeroBreach,
  type NseRunStats,
  type GoogleRunStats,
} from "../ingestions/news_and_announcements/news-guards.js";

const NSE_CRON = "_dryrun_news_nse";
const GOOGLE_CRON = "_dryrun_news_google";
const results: { ok: boolean; name: string; got?: unknown }[] = [];
function check(name: string, ok: boolean, got?: unknown) {
  results.push({ ok, name, got });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}
async function cleanup() {
  await prisma.ingestionError.deleteMany({ where: { cron: { in: [NSE_CRON, GOOGLE_CRON] } } });
}

const nse = (o: Partial<NseRunStats>): NseRunStats => ({
  responsesReceived: 0, nonArrayResponses: 0, rawRowsSeen: 0, passedFilter: 0, ...o,
});
const goog = (o: Partial<GoogleRunStats>): GoogleRunStats => ({
  stocksAttempted: 0, responsesReceived: 0, nonRssBodies: 0, itemsParsed: 0, ...o,
});

async function main() {
  await cleanup();

  // ── 1. NSE predicates ──
  console.log("\n[1] NSE filings predicates");
  check("quiet day (224 resp, 0 rows) → clean",
    !nseShapeBreach(nse({ responsesReceived: 224 })) &&
    !nseFieldPresenceBreach(nse({ responsesReceived: 224 })));
  check("populated healthy (500 raw, 498 passed) → clean",
    !nseShapeBreach(nse({ responsesReceived: 224, rawRowsSeen: 500, passedFilter: 498 })) &&
    !nseFieldPresenceBreach(nse({ responsesReceived: 224, rawRowsSeen: 500, passedFilter: 498 })));
  check("envelope trap (every resp non-array) → SHAPE flagged",
    nseShapeBreach(nse({ responsesReceived: 224, nonArrayResponses: 224 })));
  check("partial non-array (10/224) → NOT flagged (transient, zero-FP)",
    !nseShapeBreach(nse({ responsesReceived: 224, nonArrayResponses: 10 })));
  check("field rename (500 raw, 0 passed) → FIELD-PRESENCE flagged",
    nseFieldPresenceBreach(nse({ responsesReceived: 224, rawRowsSeen: 500, passedFilter: 0 })) &&
    !nseShapeBreach(nse({ responsesReceived: 224, rawRowsSeen: 500, passedFilter: 0 })));

  // ── 2. Google predicates ──
  console.log("\n[2] Google RSS predicates");
  check("populated healthy (300 items) → clean",
    !googleSourceDeadBreach(goog({ stocksAttempted: 224, responsesReceived: 224, itemsParsed: 300 })) &&
    !googleAggregateZeroBreach(goog({ stocksAttempted: 224, responsesReceived: 224, itemsParsed: 300 })));
  check("floor day (22 items) → clean",
    !googleAggregateZeroBreach(goog({ stocksAttempted: 224, responsesReceived: 224, itemsParsed: 22 })));
  check("all threw / block (0 responses) → SOURCE-DEAD flagged",
    googleSourceDeadBreach(goog({ stocksAttempted: 224, responsesReceived: 0 })) &&
    !googleAggregateZeroBreach(goog({ stocksAttempted: 224, responsesReceived: 0 })));
  check("all non-RSS (224/224 bodies) → SOURCE-DEAD flagged, not aggregate",
    googleSourceDeadBreach(goog({ stocksAttempted: 224, responsesReceived: 224, nonRssBodies: 224 })) &&
    !googleAggregateZeroBreach(goog({ stocksAttempted: 224, responsesReceived: 224, nonRssBodies: 224 })));
  check("valid RSS but universe-wide 0 items → AGGREGATE-ZERO flagged, not source-dead",
    googleAggregateZeroBreach(goog({ stocksAttempted: 224, responsesReceived: 224, nonRssBodies: 0, itemsParsed: 0 })) &&
    !googleSourceDeadBreach(goog({ stocksAttempted: 224, responsesReceived: 224, nonRssBodies: 0, itemsParsed: 0 })));
  check("partial non-RSS (5/224) + items → NOT flagged (transient, zero-FP)",
    !googleSourceDeadBreach(goog({ stocksAttempted: 224, responsesReceived: 224, nonRssBodies: 5, itemsParsed: 300 })) &&
    !googleAggregateZeroBreach(goog({ stocksAttempted: 224, responsesReceived: 224, nonRssBodies: 5, itemsParsed: 300 })));

  // ── 3. looksLikeRss helper ──
  console.log("\n[3] looksLikeRss (source-shape discriminator)");
  check("real RSS body → true", looksLikeRss('<?xml version="1.0"?><rss version="2.0"><channel><item></item></channel></rss>') === true);
  check("Atom feed → true", looksLikeRss('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>') === true);
  check("HTML consent/captcha page → false", looksLikeRss("<!doctype html><html><body>Before you continue to Google</body></html>") === false);

  // ── 4. report mapping + dedup (source-labelled) ──
  console.log("\n[4] report mapping + dedup (source labels distinguish WHICH broke)");
  await reportIngestionError({ source: "nse", cron: NSE_CRON, guardType: "shape", targetTable: "StockNews", severity: "critical", resolutionPath: "source_code", expected: "array", observed: "every response non-array", runRef: "2026-06-27:nse_daily" });
  const nseRow = await prisma.ingestionError.findFirst({ where: { cron: NSE_CRON, guardType: "shape", targetField: null } });
  check("NSE shape → critical/source_code/source=nse", nseRow?.severity === "critical" && nseRow?.resolutionPath === "source_code" && nseRow?.source === "nse");
  await reportIngestionError({ source: "google_rss", cron: GOOGLE_CRON, guardType: "count", targetTable: "StockNews", severity: "high", resolutionPath: "source_code", expected: "≥1 item", observed: "0 items", runRef: "2026-06-27:google_news_daily" });
  const gRow = await prisma.ingestionError.findFirst({ where: { cron: GOOGLE_CRON, guardType: "count" } });
  check("Google count → high/source_code/source=google_rss", gRow?.severity === "high" && gRow?.resolutionPath === "source_code" && gRow?.source === "google_rss");

  const fp = { source: "nse", cron: NSE_CRON, guardType: "shape" as const, targetTable: "StockNews", targetField: "seq_id/desc/an_dt", severity: "high" as const, resolutionPath: "source_code" as const, expected: "fields present", observed: "500 raw, 0 passed", runRef: "x" };
  await reportIngestionError(fp);
  await reportIngestionError({ ...fp, observed: "480 raw, 0 passed" });
  const dup = await prisma.ingestionError.findMany({ where: { cron: NSE_CRON, guardType: "shape", targetField: "seq_id/desc/an_dt" } });
  check("field-presence dedup → 1 row occurrences 2", dup.length === 1 && dup[0]?.occurrences === 2, { len: dup.length, occ: dup[0]?.occurrences });
  await cleanup();
  check("cleanup clean", (await prisma.ingestionError.count({ where: { cron: { in: [NSE_CRON, GOOGLE_CRON] } } })) === 0);

  // ── 5. Real fetch-log zero-FP: last real runs had inserted>0 ──
  console.log("\n[5] Real fetch-log pass — last live runs would NOT trip the guards");
  for (const ft of ["nse_daily", "google_news_daily"]) {
    const last = await prisma.newsFetchLog.findFirst({ where: { fetchType: ft, status: "success" }, orderBy: { createdAt: "desc" } });
    if (!last) { console.log(`   ${ft}: no runs`); continue; }
    console.log(`   ${ft}: ${last.createdAt.toISOString().slice(0, 10)} inserted=${last.itemsInserted} stocks=${last.stocksProcessed}`);
    // inserted>0 ⇒ items reached the table ⇒ neither source's breach predicate fires
    check(`${ft} last run inserted>0 (aggregate/shape would not fire)`, last.itemsInserted > 0, last.itemsInserted);
  }

  // ── 6. Best-effort LIVE single-symbol fetches (authoritative on real shape) ──
  console.log("\n[6] Live single-symbol fetch (best-effort — confirms real responses are healthy)");
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86400_000);
    const r = await fetchNseAnnouncements("RELIANCE", from, to);
    console.log(`   NSE RELIANCE: nonArray=${r.nonArray} rawRows=${r.rawRows} passed=${r.passed} announcements=${r.announcements.length}`);
    const stat = nse({ responsesReceived: 1, nonArrayResponses: r.nonArray ? 1 : 0, rawRowsSeen: r.rawRows, passedFilter: r.passed });
    check("real NSE response is an array (SHAPE won't false-flag)", r.nonArray === false);
    check("real NSE single-symbol → no shape/field breach", !nseShapeBreach(stat) && !nseFieldPresenceBreach(stat));
  } catch (e) {
    console.log(`   ⚠ NSE INCONCLUSIVE — ${(e as Error).message} (session-gated). Predicate tests + envelope assertion stand.`);
  }
  try {
    const r = await fetchGoogleNews("RELIANCE", "Reliance Industries");
    console.log(`   Google Reliance: malformed=${r.malformed} items=${r.items.length}`);
    check("real Google body is RSS-shaped (SOURCE-DEAD won't false-flag)", r.malformed === false);
  } catch (e) {
    console.log(`   ⚠ Google INCONCLUSIVE — ${(e as Error).message}. Predicate tests stand.`);
  }

  await cleanup();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await prisma.$disconnect();
  if (passed !== results.length) process.exit(1);
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
