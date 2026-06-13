// Discriminating live-pipeline test for the 2022-vintage XBRL parser fix.
// Re-ingests a single 2022-vintage stock through the full production path
// (fetch → parse → upsert) and verifies FII/DII now populate.
//
// Run: npx tsx src/scripts/test-reingest-one-2022-stock.ts [SYMBOL]
// Defaults to KAYNES (the fixture source for the parser fix).

import { prisma } from "../db/prisma.js";
import { ingestShareholdingForStock } from "../ingestions/shareholdings/ingest-shareholding.js";

const SYMBOL = process.argv[2]?.toUpperCase() ?? "KAYNES";
const QUARTERS_BACK = 12; // covers ~3 years, enough for 2022-vintage rows

function fmt(v: unknown): string {
  if (v == null) return "NULL";
  return String(v);
}

function proxyVintage(sourceDate: Date): string {
  if (sourceDate >= new Date("2025-11-01")) return "≥2025-11 (2025-10-31)";
  if (sourceDate >= new Date("2025-06-01")) return "2025-06–10 (2025-05-31)";
  return "<2025-06 (2022-09-30)";
}

type PatternRow = {
  id: string;
  asOnDate: Date;
  sourceDate: Date;
  promoterPct: string;
  publicPct: string;
  fiiPct: string | null;
  diiPct: string | null;
  retailPct: string | null;
  mutualFundPct: string | null;
  promoterShares: bigint | null;
  totalShares: bigint | null;
  xbrlUrl: string | null;
};

async function fetchRows(): Promise<PatternRow[]> {
  const stock = await prisma.stock.findUnique({
    where: { symbol: SYMBOL },
    select: { id: true },
  });
  if (!stock) return [];

  return prisma.$queryRawUnsafe<PatternRow[]>(
    `SELECT
       sp.id,
       sp.as_on_date       AS "asOnDate",
       sp.source_date      AS "sourceDate",
       sp.promoter_pct::text  AS "promoterPct",
       sp.public_pct::text    AS "publicPct",
       sp.fii_pct::text       AS "fiiPct",
       sp.dii_pct::text       AS "diiPct",
       sp.retail_pct::text    AS "retailPct",
       sp.mutual_fund_pct::text AS "mutualFundPct",
       sp.promoter_shares     AS "promoterShares",
       sp.total_shares        AS "totalShares",
       sp.xbrl_url            AS "xbrlUrl"
     FROM shareholding_patterns sp
     WHERE sp.stock_id = $1
     ORDER BY sp.as_on_date DESC`,
    stock.id,
  );
}

function printTable(rows: PatternRow[], label: string) {
  console.log(`\n${label} (${rows.length} rows)`);
  if (rows.length === 0) {
    console.log("  (no rows)");
    return;
  }
  const h =
    "asOnDate".padEnd(12) +
    "vintage".padEnd(26) +
    "promoter".padStart(9) +
    "public".padStart(8) +
    "fii".padStart(8) +
    "dii".padStart(8) +
    "retail".padStart(8) +
    "mf".padStart(8) +
    "  promShares/totalShares";
  console.log("  " + h);
  console.log("  " + "─".repeat(h.length + 20));
  for (const r of rows) {
    const date = r.asOnDate.toISOString().slice(0, 10);
    const vintage = proxyVintage(r.sourceDate);
    const line =
      date.padEnd(12) +
      vintage.padEnd(26) +
      fmt(r.promoterPct).padStart(9) +
      fmt(r.publicPct).padStart(8) +
      fmt(r.fiiPct).padStart(8) +
      fmt(r.diiPct).padStart(8) +
      fmt(r.retailPct).padStart(8) +
      fmt(r.mutualFundPct).padStart(8) +
      `  ${fmt(r.promoterShares)}/${fmt(r.totalShares)}`;
    console.log("  " + line);
  }
}

async function main() {
  console.log("=".repeat(72));
  console.log(`LIVE REINGEST TEST — ${SYMBOL}  (quartersBack=${QUARTERS_BACK})`);
  console.log("=".repeat(72));

  // ── 1. Pre-state ───────────────────────────────────────────────────────────

  const pre = await fetchRows();
  const preNullFii = pre.filter((r) => r.fiiPct == null).length;
  const preNullDii = pre.filter((r) => r.diiPct == null).length;
  const pre2022 = pre.filter((r) => proxyVintage(r.sourceDate).startsWith("<2025-06"));

  console.log(`\nPRE-STATE`);
  console.log(`  Total rows       : ${pre.length}`);
  console.log(`  fiiPct null      : ${preNullFii} / ${pre.length}`);
  console.log(`  diiPct null      : ${preNullDii} / ${pre.length}`);
  console.log(`  2022-vintage rows: ${pre2022.length}`);
  const pre2022NullFii = pre2022.filter((r) => r.fiiPct == null).length;
  console.log(`  2022-vintage fii null: ${pre2022NullFii} / ${pre2022.length}`);
  printTable(pre, "Pre-ingestion rows");

  // ── 2. Re-ingest via live pipeline ─────────────────────────────────────────

  console.log(`\nRUNNING ingestShareholdingForStock("${SYMBOL}", ${QUARTERS_BACK})…`);
  console.log("(This fetches live XBRL from NSE — expect ~10–30s for 12 quarters)\n");

  const result = await ingestShareholdingForStock(SYMBOL, QUARTERS_BACK);

  console.log(`\nIngest result:`);
  console.log(`  success          : ${result.success}`);
  console.log(`  quartersProcessed: ${result.quartersProcessed}`);
  console.log(`  quartersInserted : ${result.quartersInserted}`);
  if (result.errors.length > 0) {
    console.log(`  errors           :`);
    result.errors.forEach((e) => console.log(`    - ${e}`));
  }

  // ── 3. Post-state ──────────────────────────────────────────────────────────

  const post = await fetchRows();
  const postNullFii = post.filter((r) => r.fiiPct == null).length;
  const postNullDii = post.filter((r) => r.diiPct == null).length;
  const post2022 = post.filter((r) => proxyVintage(r.sourceDate).startsWith("<2025-06"));
  const post2022NullFii = post2022.filter((r) => r.fiiPct == null).length;

  printTable(post, "Post-ingestion rows");

  console.log(`\nPOST-STATE`);
  console.log(`  Total rows       : ${post.length}`);
  console.log(`  fiiPct null      : ${postNullFii} / ${post.length}`);
  console.log(`  diiPct null      : ${postNullDii} / ${post.length}`);
  console.log(`  2022-vintage rows: ${post2022.length}`);
  console.log(`  2022-vintage fii null: ${post2022NullFii} / ${post2022.length}`);

  // ── 4. Sanity checks on 2022-vintage rows ──────────────────────────────────

  let saneCount = 0;
  let insaneCount = 0;
  for (const r of post2022) {
    if (r.fiiPct == null) continue;
    const promoter = parseFloat(r.promoterPct);
    const pub = parseFloat(r.publicPct);
    const fii = parseFloat(r.fiiPct);
    const dii = r.diiPct != null ? parseFloat(r.diiPct) : null;
    const sumOk = Math.abs(promoter + pub - 100) <= 1.0;
    const fiiOk = fii >= 0 && fii <= pub;
    const diiOk = dii == null || (dii >= 0 && dii <= pub);
    if (sumOk && fiiOk && diiOk) saneCount++;
    else insaneCount++;
  }

  // ── 5. VERDICT ─────────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(72));

  if (!result.success) {
    console.log(`VERDICT: FAIL-LIVE — ingestion failed: ${result.errors[0] ?? "unknown error"}`);
  } else if (post2022.length === 0) {
    console.log(`VERDICT: INCONCLUSIVE — no 2022-vintage rows present (all filings are newer)`);
  } else if (post2022NullFii === 0 && saneCount > 0 && insaneCount === 0) {
    console.log(
      `VERDICT: PASS-LIVE — all ${post2022.length} 2022-vintage rows now have ` +
      `non-null fii/dii/retail, all ${saneCount} sanity checks pass ` +
      `(promoter+public≈100, fii/dii≤public).`
    );
  } else if (post2022NullFii > 0) {
    const stillNull = post2022.find((r) => r.fiiPct == null);
    console.log(
      `VERDICT: FAIL-LIVE — ${post2022NullFii}/${post2022.length} 2022-vintage rows ` +
      `still have null fiiPct after re-ingestion.`
    );
    if (stillNull) {
      console.log(`  Example still-null xbrlUrl: ${stillNull.xbrlUrl ?? "null (no XBRL URL)"}`);
      console.log(`  asOnDate: ${stillNull.asOnDate.toISOString().slice(0, 10)}`);
    }
  } else {
    console.log(
      `VERDICT: FAIL-LIVE — fii populated but sanity failed: ` +
      `${insaneCount} rows with invalid ratios. Check post-state table above.`
    );
  }

  console.log("=".repeat(72));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
