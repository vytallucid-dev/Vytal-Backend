// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// STEP 14 â€” GATE 0 RECON (READ-ONLY). REIT / InvIT identity.
//
// Writes NOTHING (no DB writes, no IngestionError rows). Two halves:
//
//   A. THE LIVE SOURCE PROBE â€” where does REIT/InvIT identity actually come from?
//      Â· NSE sec_bhavdata_full (the feed ingest-prices ALREADY fetches): does it carry
//        series RR (REIT) / IV (InvIT)? Does it carry ISIN? (REQUIRED_BHAV_COLUMNS says no.)
//      Â· NSE EQUITY_L.csv â€” the master security list. SYMBOLâ†’ISIN for every series?
//        If it carries RR/IV, it is the ISIN seam (the eq_etfseclist analogue) and the
//        BSE join the prior recon assumed is UNNECESSARY.
//      Â· BSE bhavcopy â€” the fallback ISIN source the prior recon proposed joining on.
//
//   B. THE DB BASELINE â€” the byte-identical fingerprints Gate 3 re-measures, the live
//      AssetClass enum (does 'reit'/'invit' exist?), the overlap probes, and the
//      PRICING question (does the price path reach an instrument with stock_id NULL?).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import https from "https";
import AdmZip from "adm-zip";
import { prisma } from "../db/prisma.js";

const q = (s: string) => prisma.$queryRawUnsafe<any[]>(s);
const show = (label: string, rows: any[]) =>
  console.log(label, JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
const rule = (s: string) => console.log("\n" + "â•".repeat(78) + "\n" + s + "\n" + "â•".repeat(78));

// â”€â”€ tiny fetch + csv helpers (probe-local; nothing here is production code) â”€â”€
function get(url: string, binary = false, hop = 0): Promise<{ status: number; body: any; bytes: number }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/csv,application/octet-stream,*/*",
          Referer: "https://www.bseindia.com/",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const loc = res.headers.location;
        if (status >= 300 && status < 400 && loc && hop < 3) {
          res.resume();
          get(new URL(loc, url).toString(), binary, hop + 1).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({ status, body: binary ? buf : buf.toString("utf8"), bytes: buf.length });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(45_000, () => req.destroy(new Error("timeout: " + url)));
  });
}

function csv(text: string): { head: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = (lines[0] ?? "").split(",").map((s) => s.trim());
  const rows = lines.slice(1).map((l) => {
    const c = l.split(",").map((s) => s.trim());
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = c[i] ?? ""));
    return o;
  });
  return { head, rows };
}

function recentWeekdays(n = 8): Date[] {
  const out: Date[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(d));
  }
  return out;
}
const p2 = (n: number) => String(n).padStart(2, "0");
const dd = (d: Date) => p2(d.getUTCDate());
const mm = (d: Date) => p2(d.getUTCMonth() + 1);
const yyyy = (d: Date) => String(d.getUTCFullYear());

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("A1 Â· NSE sec_bhavdata_full â€” the feed ingest-prices ALREADY fetches");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let nseDate: Date | null = null;
let nseRows: Record<string, string>[] = [];
let nseHead: string[] = [];
for (const d of recentWeekdays()) {
  const url = `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${dd(d)}${mm(d)}${yyyy(d)}.csv`;
  const r = await get(url);
  if (r.status === 200 && String(r.body).includes("SERIES")) {
    nseDate = d;
    const p = csv(r.body);
    nseHead = p.head;
    nseRows = p.rows;
    console.log(`âœ“ ${url}  (${r.bytes} bytes, ${p.rows.length} rows)`);
    break;
  }
  console.log(`  ${r.status} â€” ${url}`);
}

const nseBySymbol = new Map<string, Record<string, string>>();
if (nseRows.length) {
  console.log("\nHEADER:", JSON.stringify(nseHead));
  console.log("CARRIES ISIN COLUMN? â†’", nseHead.includes("ISIN") ? "YES" : "*** NO ***");
  const hist: Record<string, number> = {};
  for (const r of nseRows) {
    const s = (r.SERIES ?? "").trim();
    hist[s] = (hist[s] ?? 0) + 1;
  }
  console.log("SERIES HISTOGRAM:", JSON.stringify(hist));

  for (const series of ["RR", "IV"]) {
    const hits = nseRows.filter((r) => (r.SERIES ?? "").trim() === series);
    console.log(`\nâ”€â”€ SERIES ${series} (${series === "RR" ? "REIT" : "InvIT"}) â€” ${hits.length} rows â”€â”€`);
    for (const h of hits) {
      nseBySymbol.set((h.SYMBOL ?? "").trim(), h);
      console.log(
        `   ${(h.SYMBOL ?? "").padEnd(14)} close=${(h.CLOSE_PRICE ?? "").padStart(10)}  prev=${(h.PREV_CLOSE ?? "").padStart(10)}  vol=${(h.TTL_TRD_QNTY ?? "").padStart(12)}`,
      );
    }
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("A2 Â· NSE EQUITY_L.csv â€” master security list. THE candidate ISIN seam.");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const eqlByIsin = new Map<string, { symbol: string; name: string; series: string; isin: string }>();
{
  const r = await get("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv");
  console.log(`status=${r.status} bytes=${r.bytes}`);
  if (r.status === 200) {
    const p = csv(r.body);
    console.log("HEADER:", JSON.stringify(p.head));
    const symCol = p.head[0];
    const nameCol = p.head.find((h) => /NAME/i.test(h)) ?? p.head[1];
    const serCol = p.head.find((h) => /SERIES/i.test(h)) ?? "";
    const isinCol = p.head.find((h) => /ISIN/i.test(h)) ?? "";
    console.log(`cols â†’ symbol=${symCol} name=${nameCol} series=${serCol} isin=${isinCol}`);
    const hist: Record<string, number> = {};
    for (const row of p.rows) {
      const s = (row[serCol] ?? "").trim();
      hist[s] = (hist[s] ?? 0) + 1;
    }
    console.log("SERIES HISTOGRAM:", JSON.stringify(hist));
    for (const series of ["RR", "IV"]) {
      const hits = p.rows.filter((row) => (row[serCol] ?? "").trim() === series);
      console.log(`\nâ”€â”€ EQUITY_L SERIES ${series} â€” ${hits.length} rows â”€â”€`);
      for (const h of hits) {
        const rec = {
          symbol: (h[symCol] ?? "").trim(),
          name: (h[nameCol] ?? "").trim(),
          series,
          isin: (h[isinCol] ?? "").trim(),
        };
        eqlByIsin.set(rec.symbol, rec as any);
        console.log(`   ${rec.symbol.padEnd(14)} isin=${rec.isin.padEnd(14)} ${rec.name}`);
      }
    }
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("A3 Â· THE JOIN â€” every NSE RR/IV symbol â†’ does EQUITY_L give it an ISIN?");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
{
  let resolved = 0;
  const gaps: string[] = [];
  for (const [sym, row] of nseBySymbol) {
    const hit = eqlByIsin.get(sym) as any;
    const series = (row.SERIES ?? "").trim();
    if (hit?.isin) {
      resolved++;
      console.log(
        `   âœ“ ${sym.padEnd(14)} ${series}  isin=${hit.isin.padEnd(14)} close=${(row.CLOSE_PRICE ?? "").padStart(9)}  ${hit.name}`,
      );
    } else {
      gaps.push(sym);
      console.log(`   âœ— ${sym.padEnd(14)} ${series}  isin=(NONE â€” honest gap)`);
    }
  }
  console.log(`\n   RESOLVED ${resolved} / ${nseBySymbol.size}   Â·   NO-ISIN GAPS: ${gaps.length ? gaps.join(", ") : "(none)"}`);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("A4 Â· BSE bhavcopy â€” the ISIN source the PRIOR recon assumed we'd need");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
{
  const yy = (d: Date) => yyyy(d).slice(-2);
  for (const d of recentWeekdays(5)) {
    const url = `https://www.bseindia.com/download/BhavCopy/Equity/EQ${dd(d)}${mm(d)}${yy(d)}_CSV.ZIP`;
    try {
      const r = await get(url, true);
      if (r.status !== 200) {
        console.log(`  ${r.status} â€” ${url}`);
        continue;
      }
      const zip = new AdmZip(r.body as Buffer);
      const e = zip.getEntries().find((x) => /\.csv$/i.test(x.name));
      if (!e) {
        console.log("  no csv in zip");
        continue;
      }
      const p = csv(e.getData().toString("utf8"));
      console.log(`âœ“ ${url}`);
      console.log("HEADER:", JSON.stringify(p.head));
      const isinCol = p.head.find((h) => /ISIN/i.test(h)) ?? "";
      const nameCol = p.head.find((h) => /NAME/i.test(h)) ?? "";
      // Which of OUR NSE RR/IV ISINs (from EQUITY_L) are also on BSE?
      const bseIsins = new Set(p.rows.map((row) => (row[isinCol] ?? "").trim()).filter(Boolean));
      console.log(`BSE rows=${p.rows.length}  distinct ISINs=${bseIsins.size}`);
      let both = 0;
      for (const [sym] of nseBySymbol) {
        const hit = eqlByIsin.get(sym) as any;
        if (hit?.isin && bseIsins.has(hit.isin)) both++;
      }
      console.log(`Of the NSE RR/IV instruments with an EQUITY_L ISIN, ${both} are ALSO in the BSE bhavcopy.`);
      console.log("(Informational only â€” if EQUITY_L resolves the ISINs, the BSE join is not needed.)");
      break;
    } catch (err) {
      console.log(`  err ${url}: ${(err as Error).message}`);
    }
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("B1 Â· DB BASELINE â€” the byte-identical spine Gate 3 re-measures");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
show("stocks:              ", await q(`SELECT count(*)::int n FROM stocks`));
show("users:               ", await q(`SELECT count(*)::int n FROM users`));
show("instruments by class:", await q(`SELECT asset_class::text ac, count(*)::int n FROM instruments GROUP BY 1 ORDER BY 1`));
show("mf_analytics rows:   ", await q(`SELECT count(*)::int n FROM mf_analytics`));

console.log("\nâ”€â”€ FINGERPRINT A Â· the 504 stocks â”€â”€");
show("   ", await q(`SELECT count(*)::int n, md5(string_agg(id || '|' || symbol || '|' || isin || '|' || name, ',' ORDER BY id)) AS fp FROM stocks`));

console.log("\nâ”€â”€ FINGERPRINT B Â· the 17,567 MF instrument rows â”€â”€");
show("   ", await q(`
  SELECT count(*)::int n, md5(string_agg(
    isin || '|' || coalesce(symbol,'~') || '|' || name || '|' || coalesce(amfi_scheme_code,'~') || '|' ||
    coalesce(scheme_name,'~') || '|' || coalesce(fund_house,'~') || '|' || coalesce(category,'~') || '|' ||
    coalesce(plan_type,'~') || '|' || coalesce(current_nav::text,'~') || '|' ||
    coalesce(nav_date::text,'~') || '|' || is_active::text,
    ',' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class = 'mutual_fund'`));

console.log("\nâ”€â”€ FINGERPRINT B2 Â· the 337 ETF instrument rows (Step 13) â”€â”€");
show("   ", await q(`
  SELECT count(*)::int n, md5(string_agg(
    isin || '|' || coalesce(symbol,'~') || '|' || name || '|' || coalesce(amfi_scheme_code,'~') || '|' ||
    coalesce(scheme_name,'~') || '|' || coalesce(fund_house,'~') || '|' || coalesce(category,'~') || '|' ||
    coalesce(plan_type,'~') || '|' || coalesce(current_nav::text,'~') || '|' ||
    coalesce(nav_date::text,'~') || '|' || is_active::text,
    ',' ORDER BY isin)) AS fp
  FROM instruments WHERE asset_class = 'etf'`));

console.log("\nâ”€â”€ FINGERPRINT C Â· every mf_analytics row (the un-waivable one) â”€â”€");
show("   ", await q(`
  SELECT count(*)::int n, md5(string_agg(
    scheme_code || '|' || as_of_date::text || '|' || nav_points::text || '|' ||
    coalesce(window_from::text,'~') || coalesce(window_to::text,'~') || '|' ||
    coalesce(ret_1m::text,'~') || coalesce(ret_3m::text,'~') || coalesce(ret_6m::text,'~') ||
    coalesce(ret_1y::text,'~') || coalesce(ret_3y_cagr::text,'~') || coalesce(ret_5y_cagr::text,'~') ||
    coalesce(vol_1y::text,'~') || coalesce(vol_3y::text,'~') || '|' ||
    coalesce(sharpe_1y::text,'~') || coalesce(sharpe_3y::text,'~') || coalesce(sharpe_5y::text,'~') ||
    coalesce(sortino_1y::text,'~') || coalesce(sortino_3y::text,'~') || '|' ||
    coalesce(max_drawdown_1y::text,'~') || coalesce(max_drawdown_3y::text,'~') || coalesce(max_drawdown_5y::text,'~') || '|' ||
    coalesce(roll_1y_n::text,'~') || coalesce(roll_1y_min::text,'~') || coalesce(roll_1y_max::text,'~') ||
    coalesce(roll_1y_avg::text,'~') || coalesce(roll_1y_pct_positive::text,'~') || '|' ||
    coalesce(rank_bucket,'~') || coalesce(rank_bucket_size::text,'~') || '|' ||
    coalesce(rank_1y::text,'~') || coalesce(rank_3y::text,'~') || coalesce(rank_5y::text,'~') ||
    coalesce(pct_1y::text,'~') || coalesce(pct_3y::text,'~') || coalesce(pct_5y::text,'~') || '|' ||
    coalesce(omissions::text,'~'),
    ',' ORDER BY scheme_code)) AS fp
  FROM mf_analytics`));

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("B2 Â· THE ENUM â€” does AssetClass already carry 'reit' / 'invit'?");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
show("AssetClass labels:", await q(`
  SELECT e.enumlabel AS label, e.enumsortorder AS ord
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'AssetClass' ORDER BY e.enumsortorder`));

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("B3 Â· THE PRICING QUESTION â€” does the price path reach a stock_id-NULL instrument?");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
console.log("daily_prices.stock_id is NOT NULL and FKs to stocks; stock_prices is keyed @unique(stock_id).");
console.log("ingest-prices.loadUniverse() reads `stocks` (isActive) â†’ Map<symbol, stockId>, and");
console.log("insertDailyPrices SKIPS any bhavcopy row whose symbol is not in that map.");
console.log("So: a catalogue row with stock_id NULL can NOT receive a price today. Proving it:\n");

show("daily_prices FK/nullability:", await q(`
  SELECT column_name, is_nullable, data_type
  FROM information_schema.columns
  WHERE table_name = 'daily_prices' AND column_name IN ('stock_id','isin')
  ORDER BY column_name`));

show("stock_prices FK/nullability:", await q(`
  SELECT column_name, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'stock_prices' AND column_name = 'stock_id'`));

show("Does ANY price table carry an instrument_id?:", await q(`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE column_name = 'instrument_id'
  ORDER BY table_name`));

console.log("\n-- Are the 337 ETFs priced today? (they are stock_id NULL â€” if they have NO daily_prices,");
console.log("   that PROVES Step 13 did NOT make the price path reach instrument rows.)");
show("ETF rows with a NAV (AMFI):", await q(`
  SELECT count(*)::int total,
         count(current_nav)::int with_nav,
         count(*) FILTER (WHERE current_nav IS NULL)::int null_nav
  FROM instruments WHERE asset_class = 'etf'`));
show("ETF ISINs that appear in daily_prices at all:", await q(`
  SELECT count(DISTINCT dp.isin)::int n
  FROM daily_prices dp
  WHERE dp.isin IN (SELECT isin FROM instruments WHERE asset_class = 'etf')`));

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("B4 Â· OVERLAP â€” is any REIT/InvIT ISIN already in the catalogue or the 504?");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
{
  const isins = [...nseBySymbol.keys()]
    .map((s) => (eqlByIsin.get(s) as any)?.isin)
    .filter(Boolean) as string[];
  if (isins.length === 0) {
    console.log("(no ISINs resolved â€” skipping overlap probe)");
  } else {
    const lit = isins.map((i) => `'${i}'`).join(",");
    show("already in instruments:", await q(`SELECT isin, symbol, asset_class::text ac, stock_id FROM instruments WHERE isin IN (${lit})`));
    show("already a bare STOCK:  ", await q(`SELECT id, symbol, isin, name FROM stocks WHERE isin IN (${lit})`));
    show("ISIN prefixes:         ", await q(`SELECT DISTINCT left(x, 3) AS prefix FROM unnest(ARRAY[${lit}]) AS x ORDER BY 1`));
    // Would these trip the Step-9 'INF%' trespass guard?
    show("would trip INF% trespass guard:", await q(`SELECT x AS isin FROM unnest(ARRAY[${lit}]) AS x WHERE x LIKE 'INF%'`));
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
rule("B5 Â· HELD-NOT-SCORED â€” can a stock_id-NULL instrument even be HELD today?");
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
show("holdings.stock_id nullable?:    ", await q(`
  SELECT column_name, is_nullable FROM information_schema.columns
  WHERE table_name = 'holdings' AND column_name IN ('stock_id','instrument_id') ORDER BY column_name`));
show("transactions.stock_id nullable?:", await q(`
  SELECT column_name, is_nullable FROM information_schema.columns
  WHERE table_name = 'transactions' AND column_name IN ('stock_id','instrument_id') ORDER BY column_name`));
show("broker_holdings nullable?:      ", await q(`
  SELECT column_name, is_nullable FROM information_schema.columns
  WHERE table_name = 'broker_holdings' AND column_name IN ('stock_id','instrument_id') ORDER BY column_name`));

await prisma.$disconnect();
console.log("\nâ•â•â• GATE 0 RECON COMPLETE â€” nothing was written. â•â•â•");
