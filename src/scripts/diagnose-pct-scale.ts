// Read-only diagnostic: classify existing ShareholdingPattern rows as
// fraction-scale vs percent-scale (using promoterPct + publicPct sum),
// cross-tab against XBRL taxonomy vintage, and report blast radius for
// the re-ingestion needed to make fii/dii/retail uniformly percent.
//
// Run: npx tsx src/scripts/diagnose-pct-scale.ts

import { prisma } from "../db/prisma.js";

type Row = {
  id: string;
  symbol: string;
  fiscalYear: string;
  asOnDate: Date;
  promoterPct: number;
  publicPct: number;
  fiiPct: number | null;
  diiPct: number | null;
  xbrlUrl: string | null;
  sourceDate: Date;
};

type ScaleClass = "fraction" | "percent" | "ambiguous";

function classifyScale(promoter: number, pub: number): ScaleClass {
  const sum = promoter + pub;
  if (sum < 1.5)   return "fraction";
  if (sum >= 80 && sum <= 120) return "percent";
  return "ambiguous";
}

// NSE xbrl_url paths are opaque (SHP_<id>_<timestamp>_WEB.xml) — the taxonomy
// version is only visible inside the XML, not in the URL. We use source_date
// (filing submission date) as a proxy: 2025-10-31 taxonomy was deployed ~late
// 2025, so filings submitted ≥ 2025-11-01 are likely that vintage.
function proxyVintageFromDate(sourceDate: Date): string {
  const d = sourceDate;
  // Q3-FY26 filings (Oct-Dec 2025) are the first batch that used 2025-10-31 taxonomy
  if (d >= new Date("2025-11-01")) return "≥2025-11 (likely 2025-10-31)";
  if (d >= new Date("2025-06-01")) return "2025-06–10 (likely 2025-05-31)";
  return "<2025-06 (likely 2022-09-30)";
}

function pct(n: number, d: number, dec = 1): string {
  if (d === 0) return "n/a";
  return ((n / d) * 100).toFixed(dec) + "%";
}

async function main() {
  console.log("=".repeat(72));
  console.log("SHAREHOLDING PATTERN — PERCENTAGE SCALE DIAGNOSTIC");
  console.log("=".repeat(72));

  const total = await prisma.shareholdingPattern.count();
  console.log(`\nTotal ShareholdingPattern rows: ${total}\n`);

  if (total === 0) {
    console.log("Table is empty — nothing to diagnose.");
    await prisma.$disconnect();
    process.exit(0);
  }

  // Fetch all rows (promoterPct, publicPct are non-null per schema)
  const raw = await prisma.$queryRaw<
    Array<{
      id: string;
      symbol: string;
      fiscal_year: string;
      as_on_date: Date;
      promoter_pct: string; // Decimal comes back as string from queryRaw
      public_pct: string;
      fii_pct: string | null;
      dii_pct: string | null;
      xbrl_url: string | null;
      source_date: Date;
    }>
  >`
    SELECT
      id,
      symbol,
      fiscal_year,
      as_on_date,
      promoter_pct::text,
      public_pct::text,
      fii_pct::text,
      dii_pct::text,
      xbrl_url,
      source_date
    FROM shareholding_patterns
    ORDER BY source_date DESC
  `;

  const rows: Row[] = raw.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    fiscalYear: r.fiscal_year,
    asOnDate: r.as_on_date,
    promoterPct: parseFloat(r.promoter_pct),
    publicPct: parseFloat(r.public_pct),
    fiiPct: r.fii_pct != null ? parseFloat(r.fii_pct) : null,
    diiPct: r.dii_pct != null ? parseFloat(r.dii_pct) : null,
    xbrlUrl: r.xbrl_url,
    sourceDate: r.source_date,
  }));

  // ── 1. Classify each row ─────────────────────────────────────────────────

  // Note: NSE xbrl_url paths are opaque — vintage is inferred from source_date.
  type Entry = Row & { scale: ScaleClass; vintage: string };
  const entries: Entry[] = rows.map((r) => ({
    ...r,
    scale: classifyScale(r.promoterPct, r.publicPct),
    vintage: proxyVintageFromDate(r.sourceDate),
  }));

  const fractionRows  = entries.filter((e) => e.scale === "fraction");
  const percentRows   = entries.filter ((e) => e.scale === "percent");
  const ambiguousRows = entries.filter((e) => e.scale === "ambiguous");

  // ── 2. Cross-tab: vintage × scale class ─────────────────────────────────

  const vintages = [...new Set(entries.map((e) => e.vintage))].sort();
  const scaleClasses: ScaleClass[] = ["fraction", "percent", "ambiguous"];

  // Build counts
  const tab: Record<string, Record<ScaleClass, number>> = {};
  for (const v of vintages) {
    tab[v] = { fraction: 0, percent: 0, ambiguous: 0 };
  }
  for (const e of entries) {
    tab[e.vintage][e.scale]++;
  }

  console.log("CROSS-TAB: taxonomy vintage × scale class");
  console.log("─".repeat(72));
  const col = (s: string, w: number) => s.padStart(w);
  const header =
    "vintage".padEnd(18) +
    col("fraction", 10) +
    col("percent", 10) +
    col("ambiguous", 10) +
    col("total", 8);
  console.log(header);
  console.log("─".repeat(72));
  for (const v of vintages) {
    const t = tab[v];
    const rowTotal = t.fraction + t.percent + t.ambiguous;
    console.log(
      v.padEnd(18) +
      col(String(t.fraction), 10) +
      col(String(t.percent), 10) +
      col(String(t.ambiguous), 10) +
      col(String(rowTotal), 8)
    );
  }
  console.log("─".repeat(72));
  console.log(
    "TOTAL".padEnd(18) +
    col(String(fractionRows.length), 10) +
    col(String(percentRows.length), 10) +
    col(String(ambiguousRows.length), 10) +
    col(String(total), 8)
  );
  console.log();

  // ── 3. KEY lines ─────────────────────────────────────────────────────────

  console.log("KEY FINDINGS");
  console.log("─".repeat(72));

  const LIKELY_2025_10_31 = "≥2025-11 (likely 2025-10-31)";
  const fractionIn2025_10 = fractionRows.filter(
    (e) => e.vintage === LIKELY_2025_10_31
  ).length;
  const fractionPctOf2025_10 =
    fractionRows.length > 0
      ? ((fractionIn2025_10 / fractionRows.length) * 100).toFixed(1)
      : "n/a";

  console.log(
    `Fraction-scale rows: ${fractionRows.length} total. ` +
    `Of these, ${fractionPctOf2025_10}% are 2025-10-31 vintage.`
  );

  if (fractionRows.length > 0 && fractionIn2025_10 < fractionRows.length) {
    const leakers = fractionRows.filter((e) => e.vintage !== "2025-10-31");
    console.log(
      `  ⚠  UNEXPECTED: ${leakers.length} fraction-scale rows are NOT 2025-10-31:`
    );
    leakers.slice(0, 5).forEach((e) => {
      console.log(
        `     ${e.symbol.padEnd(12)} ${e.fiscalYear.padEnd(6)} ` +
        `promoter=${e.promoterPct} public=${e.publicPct} ` +
        `vintage=${e.vintage} url=${e.xbrlUrl ?? "null"}`
      );
    });
    if (leakers.length > 5) {
      console.log(`     ... and ${leakers.length - 5} more.`);
    }
  }

  console.log(`Rows needing re-ingestion to become percent-uniform: ${fractionRows.length}.`);

  // ── 4. Ambiguous rows ────────────────────────────────────────────────────

  if (ambiguousRows.length === 0) {
    console.log(`Ambiguous rows (promoter+public neither ~1 nor ~100): none.`);
  } else {
    console.log(
      `Ambiguous rows (promoter+public neither ~1 nor ~100): ${ambiguousRows.length}`
    );
    ambiguousRows.slice(0, 10).forEach((e) => {
      const sum = (e.promoterPct + e.publicPct).toFixed(4);
      console.log(
        `  ${e.symbol.padEnd(12)} ${e.fiscalYear.padEnd(6)} ` +
        `promoter=${e.promoterPct} public=${e.publicPct} sum=${sum} ` +
        `vintage=${e.vintage}`
      );
    });
    if (ambiguousRows.length > 10) {
      console.log(`  ... and ${ambiguousRows.length - 10} more.`);
    }
  }

  // ── 5. FII/DII null baseline ─────────────────────────────────────────────

  console.log();
  console.log("FII/DII NULL BASELINE (before re-ingestion)");
  console.log("─".repeat(72));

  const fiiNulls = entries.filter((e) => e.fiiPct == null).length;
  const diiNulls = entries.filter((e) => e.diiPct == null).length;

  console.log(
    `fiiPct  null: ${fiiNulls} / ${total}  (${pct(fiiNulls, total)})`
  );
  console.log(
    `diiPct  null: ${diiNulls} / ${total}  (${pct(diiNulls, total)})`
  );

  // Break down fii nulls by scale class (fraction rows should all be null for fii still)
  const fiiNullByScale: Record<ScaleClass, number> = {
    fraction: 0,
    percent: 0,
    ambiguous: 0,
  };
  for (const e of entries) {
    if (e.fiiPct == null) fiiNullByScale[e.scale]++;
  }
  console.log(
    `  fiiPct null breakdown: fraction-scale=${fiiNullByScale.fraction} ` +
    `percent-scale=${fiiNullByScale.percent} ambiguous=${fiiNullByScale.ambiguous}`
  );

  // ── 6. Summary ───────────────────────────────────────────────────────────

  console.log();
  console.log("=".repeat(72));
  if (fractionRows.length === 0) {
    console.log("VERDICT: No fraction-scale rows — DB is already percent-uniform.");
  } else if (ambiguousRows.length === 0 && fractionIn2025_10 === fractionRows.length) {
    console.log(
      `VERDICT: ${fractionRows.length} fraction-scale rows, all confined to ` +
      `≥2025-11 (likely 2025-10-31) vintage. Re-ingest those rows to make DB percent-uniform.`
    );
  } else {
    console.log(
      `VERDICT: ${fractionRows.length} fraction-scale rows (${fractionPctOf2025_10}% ` +
      `≥2025-11), ${ambiguousRows.length} ambiguous rows. ` +
      `Investigate before re-ingestion.`
    );
  }
  console.log("=".repeat(72));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
