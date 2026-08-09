-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- stock_news.publisher_domain — the PUBLISHER'S REAL HOST.
--
-- Google News RSS carries <source url="https://www.moneycontrol.com">Moneycontrol.com</source>
-- on every item. The parser read title/link/guid/pubDate/description and dropped <source>, so the
-- only URL stored was the news.google.com redirect and `category` held a display name. Every
-- host-based rule in the relevance screen (chat/web/news-filter.ts) was therefore dead on this
-- table. Nullable because it is unknown for everything ingested before this migration.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "stock_news" ADD COLUMN IF NOT EXISTS "publisher_domain" TEXT;

-- ── PARTIAL BACKFILL — 28.2% of stored rows, and only where it is a FACT, not a guess ────────
-- Some publishers are already reported as a bare domain in `category` ("scanx.trade",
-- "livemint.com", "Moneycontrol.com"): 6,533 of 23,150 google_news rows. Those are copied over,
-- lowercased and www-stripped to match hostOf() in news-filter.ts.
--
-- The other 16,337 rows hold a display name ("The Economic Times", "Upstox", "Whalesbook") and
-- are LEFT NULL. Mapping a name to a domain would need a hand-written lookup table — that is
-- guessing, and a wrong host would silently mis-screen a real publisher. The gap is time-boxed:
-- stock_news prunes at 90 days by published_at, so every null-domain row ages out by 2026-11-07
-- and forward capture reaches 100% coverage from the next ingest onward.
--
-- WHERE publisher_domain IS NULL makes this safe to re-run.
UPDATE "stock_news"
   SET "publisher_domain" = lower(regexp_replace("category", '^www\.', ''))
 WHERE "source_type" = 'google_news'
   AND "publisher_domain" IS NULL
   AND "category" ~ '^[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+$';
