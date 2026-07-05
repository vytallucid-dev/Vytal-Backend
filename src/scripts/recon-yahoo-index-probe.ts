// READ-ONLY probe: which Yahoo index tickers return usable 5yr history, mapped to
// the exact index_prices.indexName the benchmark overlay (price-view.service.ts) reads.
// Also confirms the 281 new stocks have no price rows yet.
//   npx tsx src/scripts/recon-yahoo-index-probe.ts
import YahooFinance from "yahoo-finance2";
import { prisma } from "../db/prisma.js";

const yf = new (YahooFinance as any)({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

// Candidate Yahoo ticker → the exact index_prices indexName it should extend.
// Broad benchmarks + the SECTOR_INDEX_MAP targets (best-known Yahoo tickers).
const CANDIDATES: { yahoo: string; indexName: string }[] = [
  { yahoo: "^NSEI", indexName: "Nifty 50" },
  { yahoo: "^BSESN", indexName: "Sensex" },
  { yahoo: "^NSEBANK", indexName: "Nifty Bank" },
  { yahoo: "^CNXIT", indexName: "Nifty IT" },
  { yahoo: "^CNXAUTO", indexName: "Nifty Auto" },
  { yahoo: "^CNXFMCG", indexName: "Nifty FMCG" },
  { yahoo: "^CNXPHARMA", indexName: "Nifty Pharma" },
  { yahoo: "^CNXMETAL", indexName: "Nifty Metal" },
  { yahoo: "^CNXREALTY", indexName: "Nifty Realty" },
  { yahoo: "^CNXENERGY", indexName: "Nifty Energy" },
  { yahoo: "^CNXINFRA", indexName: "Nifty Infrastructure" },
  { yahoo: "^CNXPSUBANK", indexName: "Nifty PSU Bank" },
  { yahoo: "^CNXMEDIA", indexName: "Nifty Media" },
  { yahoo: "NIFTY_FIN_SERVICE.NS", indexName: "Nifty Financial Services" },
  { yahoo: "^CNXPSE", indexName: "Nifty PSE" },
  { yahoo: "^CNX100", indexName: "Nifty 100" },
];

async function main() {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const from = new Date(today); from.setUTCFullYear(from.getUTCFullYear() - 5);

  console.log("=== Yahoo index ticker probe (5yr) ===");
  for (const c of CANDIDATES) {
    try {
      const rows = await yf.chart(c.yahoo, { period1: from, period2: today, interval: "1d" });
      const quotes = rows?.quotes ?? [];
      const valid = quotes.filter((q: any) => q.close != null);
      const first = valid[0]?.date, last = valid[valid.length - 1]?.date;
      console.log(`  ${c.yahoo.padEnd(22)} → "${c.indexName.padEnd(34)}" rows=${String(valid.length).padStart(5)} ${first ? new Date(first).toISOString().slice(0,10) : "-"}..${last ? new Date(last).toISOString().slice(0,10) : "-"}`);
    } catch (e) {
      console.log(`  ${c.yahoo.padEnd(22)} → "${c.indexName.padEnd(34)}" FAILED: ${String((e as Error).message).slice(0, 80)}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // Confirm 281 new have no price rows.
  const fs = await import("fs");
  const original = new Set(fs.readFileSync("docs/original224_symbols.txt", "utf8").trim().split(",").map((s) => s.trim()));
  const all = await prisma.stock.findMany({ select: { symbol: true } });
  const newSyms = all.map((s) => s.symbol).filter((s) => !original.has(s));
  const withDaily = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(DISTINCT stock_id)::int n FROM daily_prices dp JOIN stocks s ON s.id=dp.stock_id WHERE s.symbol = ANY($1::text[])`, newSyms);
  const withSnap = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*)::int n FROM stock_prices sp JOIN stocks s ON s.id=sp.stock_id WHERE s.symbol = ANY($1::text[])`, newSyms);
  console.log(`\n=== new-stock price state ===`);
  console.log(`new stocks: ${newSyms.length} | with daily_prices: ${withDaily[0].n} | with stock_prices snapshot: ${withSnap[0].n}`);

  // Current index_prices names + their date span (do the overlay's sector indices exist / how deep?).
  const idxRange = await prisma.$queryRawUnsafe<any[]>(
    `SELECT index_name, MIN(date)::date mn, MAX(date)::date mx, COUNT(*)::int n FROM index_prices GROUP BY index_name ORDER BY index_name`);
  console.log(`\n=== current index_prices: ${idxRange.length} indices (showing benchmark + overlay-relevant) ===`);
  const overlayNames = new Set(["Nifty 50","Sensex","Nifty Auto","Nifty Bank","Nifty Capital Goods","Nifty Capital Markets","Nifty Cement","Nifty Chemicals","Nifty Consumer Durables","Nifty FMCG","Nifty Consumer Services","Nifty Insurance","Nifty IT","Nifty India Infrastructure & Logistics","Nifty Metal","Nifty Financial Services Ex-Bank","Nifty India Digital","Nifty Oil & Gas","Nifty Pharma","Nifty Power","Nifty Realty","Nifty Telecommunications"]);
  for (const r of idxRange) if (overlayNames.has(r.index_name)) console.log(`  ${r.index_name.padEnd(40)} ${r.mn?.toISOString?.().slice(0,10) ?? r.mn}..${r.mx?.toISOString?.().slice(0,10) ?? r.mx}  n=${r.n}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
