// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// BACKFILL stock_news.dedupe_key AND COLLAPSE THE PRE-EXISTING PRESS DUPLICATES.
//
// Step 2 of 3 — see prisma/migrations/20260809200000_add_stock_news_dedupe_key for the required order.
// The unique index cannot be created until this has run.
//
// ⚠ THIS DELETES ROWS. 678 of 23,150 press rows (2.93%) are redundant copies of an article already
// stored under a different Google GUID. Measured before writing anything, and nothing material is lost:
//   · isHighImpact differs in 0 of 628 groups;
//   · externalUrl differs in all 628 — by construction, because the Google redirect ENCODES the GUID.
//     All variants point at the same article, and that redirect no longer resolves to it anyway;
//   · the publisher differs in 83 groups (one wire story carried by two outlets in the same second).
//     Those 83 do lose one outlet name, and that is the only real loss in this operation. A reader
//     gains nothing from the same story listed twice under two mastheads, so it is accepted — and the
//     survivor rule below prefers the row that HAS a resolved publisher domain.
//
// SURVIVOR RULE, in order: longest headline (the un-truncated variant is the more complete record) →
// has a publisher_domain → lowest id (deterministic, so a re-run cannot pick differently).
//
// It uses `pressDedupeKey` from the shared module — the SAME function the ingest calls. That is
// deliberate: two implementations of one key would drift, and a backfill that disagrees with the ingest
// is how a table ends up with duplicates the constraint claims are impossible.
//
//   npx tsx src/scripts/backfill-news-dedupe-key.ts [--dry]
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { pressDedupeKey } from "../ingestions/news_and_announcements/dedupe-key.js";

const dry = process.argv.includes("--dry");

interface Row {
  id: string;
  stockId: string;
  symbol: string;
  headline: string;
  publisherDomain: string | null;
  publishedAt: Date;
}

async function main(): Promise<void> {
  const rows: Row[] = await prisma.stockNews.findMany({
    where: { sourceType: "google_news" },
    select: { id: true, stockId: true, symbol: true, headline: true, publisherDomain: true, publishedAt: true },
  });

  const groups = new Map<string, Row[]>();
  let unkeyable = 0;
  for (const r of rows) {
    const key = pressDedupeKey(r.headline, r.publishedAt);
    if (!key) {
      unkeyable++;
      continue;
    }
    const k = `${r.stockId}|${key}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }

  const doomed: string[] = [];
  let dupGroups = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    dupGroups++;
    const [, ...rest] = [...g].sort(
      (a, b) =>
        b.headline.length - a.headline.length ||
        Number(Boolean(b.publisherDomain)) - Number(Boolean(a.publisherDomain)) ||
        a.id.localeCompare(b.id),
    );
    doomed.push(...rest.map((r) => r.id));
  }

  console.log(`── press rows: ${rows.length}`);
  console.log(`   unkeyable (empty headline, left NULL, exempt from the constraint): ${unkeyable}`);
  console.log(`   duplicate groups: ${dupGroups}`);
  console.log(`   redundant rows to DELETE: ${doomed.length} (${((100 * doomed.length) / rows.length).toFixed(2)}%)`);
  console.log(`   rows remaining: ${rows.length - doomed.length}`);

  if (dry) {
    console.log("\n(--dry: nothing written)");
    return;
  }

  // Delete first, then key the survivors — the reverse order would leave the table momentarily holding
  // duplicate keys, which is exactly what the pending unique index forbids.
  const CHUNK = 1_000;
  let deleted = 0;
  for (let i = 0; i < doomed.length; i += CHUNK) {
    const res = await prisma.stockNews.deleteMany({ where: { id: { in: doomed.slice(i, i + CHUNK) } } });
    deleted += res.count;
  }
  console.log(`\n✅ deleted ${deleted} redundant rows`);

  // ⚠ SET-BASED, NOT A ROW LOOP. The first cut issued one UPDATE per row and took over ten minutes on
  // 22,472 rows — every key is unique, so `updateMany` cannot batch them. A single UPDATE … FROM
  // (VALUES …) per chunk does the same work in seconds. The key is still computed HERE, in TypeScript,
  // by the shared function: re-implementing the normalisation in SQL would create the second
  // implementation this module exists to prevent, and it would drift on the first regex tweak.
  const doomedSet = new Set(doomed);
  const survivors = rows.filter((r) => !doomedSet.has(r.id));
  const pairs: [string, string][] = [];
  for (const r of survivors) {
    const key = pressDedupeKey(r.headline, r.publishedAt);
    if (key) pairs.push([r.id, key]);
  }

  let keyed = 0;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const batch = pairs.slice(i, i + CHUNK);
    // Placeholders are numbered; ids and keys travel as bound parameters, never interpolated.
    // ⚠ `stock_news.id` is TEXT, not uuid — Prisma's `String @id @default(uuid())` maps to text. Casting
    // the placeholder to ::uuid produces `operator does not exist: text = uuid` at runtime.
    const values = batch
      .map((_, j) => `($${j * 2 + 1}::text, $${j * 2 + 2}::text)`)
      .join(", ");
    keyed += await prisma.$executeRawUnsafe(
      `UPDATE "stock_news" AS s SET "dedupe_key" = v.k
         FROM (VALUES ${values}) AS v(id, k)
        WHERE s."id" = v.id AND ("s"."dedupe_key" IS DISTINCT FROM v.k)`,
      ...batch.flat(),
    );
  }
  console.log(`✅ keyed ${keyed} surviving press rows`);

  const remaining = await prisma.stockNews.count({ where: { sourceType: "google_news" } });
  const withKey = await prisma.stockNews.count({
    where: { sourceType: "google_news", dedupeKey: { not: null } },
  });
  console.log(`\n   press rows now: ${remaining} · with a key: ${withKey}`);
  console.log("   → safe to apply 20260809200100_add_stock_news_dedupe_unique");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
