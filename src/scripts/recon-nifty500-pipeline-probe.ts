// READ-ONLY recon probe: does each of the 8 ingestion pipelines return data for a
// representative sample of NEW (not-yet-in-DB) Nifty-500 stocks?
// NO DB WRITES from this script directly. Calls fetch-only layer functions
// (discovery / index / calendar fetchers) that stop BEFORE any prisma.create/upsert.
// Two library functions we call (fetchDailyDeals/fetchHistoricalDeals) may
// internally call reportIngestionError() on a NSE response-SHAPE anomaly (rare,
// by design — that's the guard mechanism working, not a data write by us).
//
// Run: npx tsx src/scripts/recon-nifty500-pipeline-probe.ts

import { fetchFilingsList } from "../ingestions/quaterly-results/results/discovery.js";
import { fetchCorporateActionsForSymbol } from "../ingestions/corporate-events/events.js";
import { fetchFilingIndexForRange } from "../ingestions/insider-trades/nse-pit-fetcher.js";
import { fetchHistoricalDeals } from "../ingestions/block-deals/deals.js";
import { fetchNseAnnouncements } from "../ingestions/news_and_announcements/nse-announcements.js";
import { fetchShareholdingIndex, fetchXbrlXml } from "../ingestions/shareholdings/shareholding-fetch.js";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new (YahooFinance as any)({ suppressNotices: ["yahooSurvey"] });

const SAMPLE: { symbol: string; tier: string }[] = [
  { symbol: "ADANIENT", tier: "large" },
  { symbol: "HYUNDAI", tier: "large" },
  { symbol: "HDBFS", tier: "large" },
  { symbol: "LTTS", tier: "large" },
  { symbol: "TATACAP", tier: "large" },
  { symbol: "CDSL", tier: "mid" },
  { symbol: "CAMS", tier: "mid" },
  { symbol: "IEX", tier: "mid" },
  { symbol: "PVRINOX", tier: "mid" },
  { symbol: "CRISIL", tier: "mid" },
  { symbol: "IRB", tier: "mid" },
  { symbol: "ZEEL", tier: "mid" },
  { symbol: "LENSKART", tier: "small/recent-ipo" },
  { symbol: "GROWW", tier: "small/recent-ipo" },
  { symbol: "MEESHO", tier: "small/recent-ipo" },
  { symbol: "PINELABS", tier: "small/recent-ipo" },
  { symbol: "OLAELEC", tier: "small/recent-ipo" },
  { symbol: "GODIGIT", tier: "small/recent-ipo" },
  { symbol: "NIVABUPA", tier: "small/recent-ipo" },
  { symbol: "SAGILITY", tier: "small/recent-ipo" },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const results: Record<string, any[]> = {
  fundamentals: [],
  events: [],
  news: [],
  shareholding: [],
  yahooPrices: [],
};

async function probeFundamentals() {
  console.log("\n=== 1. FUNDAMENTALS (backfill discovery: fetchFilingsList) ===");
  for (const { symbol, tier } of SAMPLE) {
    try {
      const filings = await fetchFilingsList(symbol, "march");
      const dates = filings.map((f: any) => f.qeDate).sort();
      results.fundamentals.push({
        symbol, tier, ok: true, count: filings.length,
        earliest: dates[0] ?? null, latest: dates[dates.length - 1] ?? null,
      });
      console.log(`  ${symbol.padEnd(12)} [${tier.padEnd(16)}] filings=${filings.length}  range=${dates[0] ?? "-"}..${dates[dates.length - 1] ?? "-"}`);
    } catch (err) {
      results.fundamentals.push({ symbol, tier, ok: false, error: String(err) });
      console.log(`  ${symbol.padEnd(12)} [${tier.padEnd(16)}] FAILED: ${String(err).slice(0, 150)}`);
    }
    await sleep(1800);
  }
}

async function probeEvents() {
  console.log("\n=== 2. CORPORATE EVENTS (fetchCorporateActionsForSymbol) ===");
  for (const { symbol, tier } of SAMPLE) {
    try {
      const events = await fetchCorporateActionsForSymbol(symbol);
      results.events.push({ symbol, tier, ok: true, count: events.length });
      console.log(`  ${symbol.padEnd(12)} [${tier.padEnd(16)}] events=${events.length}`);
    } catch (err) {
      results.events.push({ symbol, tier, ok: false, error: String(err) });
      console.log(`  ${symbol.padEnd(12)} [${tier.padEnd(16)}] FAILED: ${String(err).slice(0, 150)}`);
    }
    await sleep(1800);
  }
}

async function probeInsiderAndDeals() {
  console.log("\n=== 3. INSIDER TRADES (fetchFilingIndexForRange, universe-wide, filtered) ===");
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 24 * 3600 * 1000);
  try {
    const { filings, malformed } = await fetchFilingIndexForRange(from, to);
    console.log(`  total filings in window (all NSE stocks): ${filings.length}, malformed=${malformed}`);
    const sampleSet = new Set(SAMPLE.map((s) => s.symbol));
    const matched = filings.filter((f: any) => sampleSet.has((f.symbol ?? "").toUpperCase()));
    const bySymbol = new Map<string, number>();
    for (const f of matched) bySymbol.set(f.symbol, (bySymbol.get(f.symbol) ?? 0) + 1);
    for (const { symbol, tier } of SAMPLE) {
      console.log(`  ${symbol.padEnd(12)} [${tier.padEnd(16)}] filings-in-90d=${bySymbol.get(symbol) ?? 0}`);
    }
    (results as any).insider = { totalWindowFilings: filings.length, malformed, perSymbol: Object.fromEntries(bySymbol) };
  } catch (err) {
    console.log(`  FAILED: ${String(err).slice(0, 300)}`);
    (results as any).insider = { ok: false, error: String(err) };
  }

  console.log("\n=== 4. BLOCK DEALS (fetchHistoricalDeals, universe-wide, filtered, 180d) ===");
  try {
    const to2 = new Date();
    const from2 = new Date(to2.getTime() - 180 * 24 * 3600 * 1000);
    const bulk = await fetchHistoricalDeals(from2, to2, "bulk");
    const block = await fetchHistoricalDeals(from2, to2, "block");
    const all = [...bulk, ...block];
    console.log(`  total deals in window (all NSE stocks): bulk=${bulk.length} block=${block.length}`);
    const sampleSet = new Set(SAMPLE.map((s) => s.symbol));
    const matched = all.filter((d: any) => sampleSet.has((d.symbol ?? "").toUpperCase()));
    const bySymbol = new Map<string, number>();
    for (const d of matched) bySymbol.set(d.symbol, (bySymbol.get(d.symbol) ?? 0) + 1);
    for (const { symbol, tier } of SAMPLE) {
      console.log(`  ${symbol.padEnd(12)} [${tier.padEnd(16)}] deals-in-180d=${bySymbol.get(symbol) ?? 0}`);
    }
    (results as any).deals = { totalBulk: bulk.length, totalBlock: block.length, perSymbol: Object.fromEntries(bySymbol) };
  } catch (err) {
    console.log(`  FAILED: ${String(err).slice(0, 300)}`);
    (results as any).deals = { ok: false, error: String(err) };
  }
}

async function probeNews() {
  console.log("\n=== 5. NEWS & ANNOUNCEMENTS (fetchNseAnnouncements) ===");
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 24 * 3600 * 1000);
  for (const { symbol, tier } of SAMPLE) {
    try {
      const r = await fetchNseAnnouncements(symbol, from, to);
      results.news.push({ symbol, tier, ok: true, count: r.announcements.length, rawRows: r.rawRows, nonArray: r.nonArray });
      console.log(`  ${symbol.padEnd(12)} [${tier.padEnd(16)}] announcements=${r.announcements.length} rawRows=${r.rawRows} nonArray=${r.nonArray}`);
    } catch (err) {
      results.news.push({ symbol, tier, ok: false, error: String(err) });
      console.log(`  ${symbol.padEnd(12)} [${tier.padEnd(16)}] FAILED: ${String(err).slice(0, 150)}`);
    }
    await sleep(1800);
  }
}

async function probeShareholding() {
  console.log("\n=== 6. SHAREHOLDING PATTERNS (fetchShareholdingIndex + 1 XBRL vintage check each) ===");
  const KNOWN_VINTAGE_MARKERS = [
    { name: "2025-10-31-fraction", re: /_ContextI/ },
    { name: "2022-09-30-Isuffix", re: /(?<!_Context)I"/ },
  ];
  for (const { symbol, tier } of SAMPLE) {
    try {
      const rows = await fetchShareholdingIndex(symbol);
      const dates = rows.map((r) => r.asOnDate).sort();
      let vintageNote = "n/a";
      if (rows.length > 0) {
        const latestUrl = rows[rows.length - 1].xbrlUrl;
        try {
          const xml = await fetchXbrlXml(latestUrl);
          const hasUnderscoreCtx = /_ContextI/.test(xml);
          const hasPlainISuffix = /[A-Za-z]I"/.test(xml) && !hasUnderscoreCtx;
          vintageNote = hasUnderscoreCtx ? "2025-style(_ContextI)" : hasPlainISuffix ? "2022-style(Isuffix, no 4th pattern seen)" : "UNRECOGNIZED-CONTEXT-PATTERN(possible 4th vintage)";
        } catch (xerr) {
          vintageNote = `xbrl-fetch-failed: ${String(xerr).slice(0, 100)}`;
        }
      }
      results.shareholding.push({ symbol, tier, ok: true, count: rows.length, earliest: dates[0] ?? null, latest: dates[dates.length - 1] ?? null, vintageNote });
      console.log(`  ${symbol.padEnd(12)} [${tier.padEnd(16)}] filings=${rows.length} range=${dates[0] ?? "-"}..${dates[dates.length - 1] ?? "-"} vintage=${vintageNote}`);
    } catch (err) {
      results.shareholding.push({ symbol, tier, ok: false, error: String(err) });
      console.log(`  ${symbol.padEnd(12)} [${tier.padEnd(16)}] FAILED: ${String(err).slice(0, 150)}`);
    }
    await sleep(1800);
  }
}

const YAHOO_SYMBOL_OVERRIDES: Record<string, string> = {
  ETERNAL: "ETERNAL.NS", TMCV: "TMCV.NS", TMPV: "TMPV.NS",
  ADANIENSOL: "ADANIENSOL.NS", "GVT&D": "GVT%26D.NS",
};
function toYahooTicker(nseSymbol: string): string {
  return YAHOO_SYMBOL_OVERRIDES[nseSymbol] ?? `${nseSymbol}.NS`;
}

async function probeYahooPrices() {
  console.log("\n=== 7. STOCK PRICES — Yahoo 5yr backfill coverage ===");
  const today = new Date();
  const from5y = new Date(today);
  from5y.setUTCFullYear(from5y.getUTCFullYear() - 5);
  for (const { symbol, tier } of SAMPLE) {
    const ticker = toYahooTicker(symbol);
    try {
      const rows = await yahooFinance.historical(ticker, { period1: from5y, period2: today, interval: "1d" }, { validateResult: false });
      const n = Array.isArray(rows) ? rows.length : 0;
      const first = n > 0 ? rows[0].date : null;
      results.yahooPrices.push({ symbol, tier, ticker, ok: true, count: n, firstDate: first });
      console.log(`  ${symbol.padEnd(12)} [${tier.padEnd(16)}] ticker=${ticker.padEnd(14)} rows=${n} firstDate=${first ?? "-"}`);
    } catch (err) {
      results.yahooPrices.push({ symbol, tier, ticker, ok: false, error: String(err) });
      console.log(`  ${symbol.padEnd(12)} [${tier.padEnd(16)}] ticker=${ticker.padEnd(14)} FAILED: ${String(err).slice(0, 150)}`);
    }
    await sleep(500);
  }
}

async function main() {
  const which = process.argv[2] ?? "all";
  if (which === "all" || which === "fundamentals") await probeFundamentals();
  if (which === "all" || which === "events") await probeEvents();
  if (which === "all" || which === "insiderdeals") await probeInsiderAndDeals();
  if (which === "all" || which === "news") await probeNews();
  if (which === "all" || which === "shareholding") await probeShareholding();
  if (which === "all" || which === "yahoo") await probeYahooPrices();

  console.log("\n\n=== RAW JSON (for aggregation) ===");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
