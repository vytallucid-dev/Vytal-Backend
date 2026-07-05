// ─────────────────────────────────────────────────────────────────────────────
// PASS 3 · Part B — 5yr INDEX backfill via YAHOO (the NSE index pipeline caps at
// 365 days). Extends the exact index_prices.indexName series the benchmark overlay
// (price-view.service.ts: BENCHMARK_INDEX + SECTOR_INDEX_MAP) reads, so the r3y
// window resolves. Only indices with a CLEAN Yahoo ticker whose name maps EXACTLY
// to an overlay index are backfilled — verified by recon-yahoo-index-probe.ts.
//
// Idempotent: daily rows via createMany skipDuplicates on (indexName, date) — the
// authoritative NSE rows (provider "nse-index-csv") are NEVER overwritten; Yahoo
// only fills the older gap (provider "yahoo-finance"). Failures → reportIngestionError.
//
//   npx tsx src/scripts/backfill-index-yahoo.ts [--years 5] [--dry-run]
// ─────────────────────────────────────────────────────────────────────────────
import YahooFinance from "yahoo-finance2";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";

const yf = new (YahooFinance as any)({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const INDEX_CRON = "yahoo_index_backfill";
const PROVIDER = "yahoo-finance";

// Yahoo ticker → the EXACT index_prices.indexName it extends. Broad benchmarks
// (Nifty 50 = the overlay's BENCHMARK_INDEX; Sensex additive per the pass spec) +
// the 7 SECTOR_INDEX_MAP names with a clean, name-exact Yahoo 5yr series. Indices
// whose Yahoo ticker is a DIFFERENT index (e.g. ^CNXENERGY "Nifty Energy" ≠ "Nifty
// Oil & Gas", ^CNXINFRA ≠ "…Infrastructure & Logistics") are deliberately EXCLUDED.
const INDEX_MAP: { yahoo: string; indexName: string }[] = [
  { yahoo: "^NSEI", indexName: "Nifty 50" },      // broad benchmark (overlay BENCHMARK_INDEX)
  { yahoo: "^BSESN", indexName: "Sensex" },        // additive broad benchmark (pass spec)
  { yahoo: "^CNXAUTO", indexName: "Nifty Auto" },
  { yahoo: "^NSEBANK", indexName: "Nifty Bank" },
  { yahoo: "^CNXFMCG", indexName: "Nifty FMCG" },
  { yahoo: "^CNXIT", indexName: "Nifty IT" },
  { yahoo: "^CNXMETAL", indexName: "Nifty Metal" },
  { yahoo: "^CNXPHARMA", indexName: "Nifty Pharma" },
  { yahoo: "^CNXREALTY", indexName: "Nifty Realty" },
];

function normDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function reportIndexFailure(indexName: string, yahoo: string, observed: string) {
  await reportIngestionError({
    source: "yahoo_finance", cron: INDEX_CRON, guardType: "count",
    targetTable: "IndexPrice", targetEntity: indexName, severity: "high", resolutionPath: "source_code",
    expected: "≥1 index_prices row from Yahoo (5yr history)",
    observed: observed.slice(0, 250),
    detail: `Pass-3 index backfill: Yahoo ticker ${yahoo} yielded no usable history for "${indexName}".`,
    runRef: `${INDEX_CRON}:pass3`,
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const years = argv.includes("--years") ? parseInt(argv[argv.indexOf("--years") + 1], 10) : 5;
  const dryRun = argv.includes("--dry-run");

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const from = new Date(today); from.setUTCFullYear(from.getUTCFullYear() - years);

  console.log(`[Pass3-index] backfilling ${INDEX_MAP.length} indices via Yahoo, years=${years}, dryRun=${dryRun}`);
  const report: any[] = [];

  for (const { yahoo, indexName } of INDEX_MAP) {
    try {
      const res = await yf.chart(yahoo, { period1: from, period2: today, interval: "1d" });
      const quotes: any[] = (res?.quotes ?? []).filter((q: any) => q.date && q.close != null && q.close > 0);
      if (quotes.length === 0) {
        console.log(`  ✗ ${indexName.padEnd(34)} (${yahoo}) 0 rows`);
        if (!dryRun) await reportIndexFailure(indexName, yahoo, "Yahoo returned 0 usable rows");
        report.push({ indexName, yahoo, inserted: 0, status: "no_data" });
        continue;
      }
      const data: Prisma.IndexPriceCreateManyInput[] = quotes.map((q) => ({
        indexName,
        date: normDate(new Date(q.date)),
        open: q.open != null ? new Prisma.Decimal(q.open) : null,
        high: q.high != null ? new Prisma.Decimal(q.high) : null,
        low: q.low != null ? new Prisma.Decimal(q.low) : null,
        close: new Prisma.Decimal(q.close),
        volume: q.volume != null ? BigInt(Math.round(q.volume)) : null,
        provider: PROVIDER,
      }));

      let inserted = 0;
      if (!dryRun) {
        // skipDuplicates: never overwrite the authoritative NSE rows; only fill the older gap.
        const r = await prisma.indexPrice.createMany({ data, skipDuplicates: true });
        inserted = r.count;
      }
      const first = new Date(data[0].date), last = new Date(data[data.length - 1].date);
      console.log(`  ✓ ${indexName.padEnd(34)} (${yahoo}) fetched=${data.length} inserted=${inserted} ${first.toISOString().slice(0,10)}..${last.toISOString().slice(0,10)}`);
      report.push({ indexName, yahoo, fetched: data.length, inserted, status: "ok" });
    } catch (e) {
      console.log(`  ✗ ${indexName.padEnd(34)} (${yahoo}) FAILED: ${String((e as Error).message).slice(0, 80)}`);
      if (!dryRun) await reportIndexFailure(indexName, yahoo, (e as Error).message);
      report.push({ indexName, yahoo, inserted: 0, status: "failed", error: (e as Error).message });
    }
    await sleep(500);
  }

  console.log(`\n=== Pass3-index done ===`);
  console.log(`indices attempted : ${INDEX_MAP.length}`);
  console.log(`ok                : ${report.filter((r) => r.status === "ok").length}`);
  console.log(`failed (→ UI)     : ${report.filter((r) => r.status !== "ok").length}`);
  console.log(`rows inserted     : ${report.reduce((s, r) => s + (r.inserted ?? 0), 0).toLocaleString()}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
