// ═══════════════════════════════════════════════════════════════
// F4b (5) — DOES NSE CARRY THEM AT ALL, TODAY? READ-ONLY.
//   npx tsx src/scripts/_f4b5-probe.ts
//
// Settled so far:
//   · EQUITY_L (NSE's own listed-securities master) carries all three: series EQ,
//     ISIN identical to stocks.isin, symbol identical. NOT renamed, NOT delisted,
//     NOT moved to another series. The symbol we ask about is the right one.
//   · corporates-corporateActions?symbol=… answers 17/20/18 — the corporate layer
//     resolves the symbol.
//   · every FILINGS endpoint answers 0 (or a 2010 fossil with xbrl="-").
//
// This probe closes the last gap: walk a RESULTS-SEASON window of the integrated
// filing store END TO END and search it by COMPANY NAME, not by symbol — so a symbol
// we do not know about cannot hide the company from us. Q1 FY27 (quarter ended
// 30-Jun-2026) was filed across roughly 10 Jul – 15 Aug 2026.
//
// Also dumps the handful of announcements NSE does hold for BAYERCROP/MCX, and asks
// the shareholding endpoint the same question — our own shareholding for these three
// also stops in 2018, which would make this a whole-company absence rather than a
// results-specific one.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import https from "node:https";
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";

const DIR = process.env.R1_DIR ?? ".";
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NEEDLES: Array<{ sym: string; re: RegExp }> = [
  { sym: "ABBOTINDIA", re: /abbott/i },
  { sym: "BAYERCROP", re: /bayer/i },
  { sym: "MCX", re: /multi[- ]?commodity|^mcx\b/i },
  { sym: "RELIANCE", re: /reliance industries/i },
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
let COOKIES = "";

function httpGet(url: string, referer: string): Promise<{ status: number; body: string; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": UA, Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate, br",
        Referer: referer, Connection: "keep-alive",
        "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty",
        ...(COOKIES ? { Cookie: COOKIES } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers["content-encoding"];
        const done = (b: Buffer) => resolve({ status: res.statusCode ?? 0, body: b.toString("utf-8"), setCookie: (res.headers["set-cookie"] as string[]) ?? [] });
        if (enc === "br") zlib.brotliDecompress(buf, (e, d) => (e ? reject(e) : done(d)));
        else if (enc === "gzip") zlib.gunzip(buf, (e, d) => (e ? reject(e) : done(d)));
        else if (enc === "deflate") zlib.inflate(buf, (e, d) => (e ? reject(e) : done(d)));
        else done(buf);
      });
    });
    req.on("error", reject);
    req.setTimeout(90_000, () => req.destroy(new Error("timeout")));
  });
}
const REF = "https://www.nseindia.com/companies-listing/corporate-filings-financial-results";
async function bootstrap() {
  COOKIES = "";
  for (const u of ["https://www.nseindia.com/", REF]) {
    const r = await httpGet(u, "https://www.nseindia.com/");
    const jar = new Map(COOKIES ? COOKIES.split("; ").map((c) => [c.split("=")[0], c]) : []);
    for (const c of r.setCookie.map((x) => x.split(";")[0])) jar.set(c.split("=")[0], c);
    COOKIES = [...jar.values()].join("; ");
    await sleep(800);
  }
}
async function api(path: string, referer = REF): Promise<any> {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await httpGet(`https://www.nseindia.com${path}`, referer);
      if (r.status === 200) { try { return JSON.parse(r.body); } catch { return { __raw: r.body.slice(0, 160) }; } }
      if (a === 3) return { __status: r.status };
    } catch (e) { if (a === 3) return { __err: (e as Error).message }; }
    await sleep(3000); await bootstrap();
  }
}

const out: any = {};

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F4b(5) — a full results-season walk, searched by COMPANY NAME             ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  await bootstrap();

  // ── T1 · full walk of the Q1 FY27 filing season ─────────────────────────
  const FROM = "10-07-2026", TO = "16-08-2026";
  const seen = new Set<string>();
  const rows: any[] = [];
  let totalCount: number | null = null;
  for (let page = 1; page <= 200; page++) {
    const j = await api(`/api/integrated-filing-results?index=equities&from_date=${FROM}&to_date=${TO}&size=100&page=${page}`);
    const data: any[] = j?.data ?? [];
    if (typeof j?.totalCount === "number") totalCount = Math.max(totalCount ?? 0, j.totalCount);
    let fresh = 0;
    for (const r of data) { const k = String(r.seq_Id); if (seen.has(k)) continue; seen.add(k); rows.push(r); fresh++; }
    process.stdout.write(`\r     ${FROM}→${TO}  page ${page}: ${rows.length}/${totalCount ?? "?"}`);
    if (data.length === 0 || fresh === 0) break;
    if (totalCount !== null && rows.length >= totalCount) break;
    await sleep(700);
  }
  console.log(``);
  const fin = rows.filter((r) => r.type === "Integrated Filing- Financials");
  const syms = new Set(rows.map((r) => String(r.symbol).trim().toUpperCase()));
  const finSyms = new Set(fin.map((r) => String(r.symbol).trim().toUpperCase()));
  console.log(`     walked ${rows.length}/${totalCount} rows · ${syms.size} distinct symbols · ${fin.length} Financials across ${finSyms.size} symbols`);
  out.t1 = { from: FROM, to: TO, rows: rows.length, totalCount, symbols: syms.size, financials: fin.length, financialSymbols: finSyms.size };

  console.log(`\n  ── searched BY COMPANY NAME (so an unknown symbol cannot hide the company) ──`);
  for (const n of NEEDLES) {
    const byName = rows.filter((r) => n.re.test(String(r.smName ?? "")) || n.re.test(String(r.cmName ?? "")));
    const bySym = rows.filter((r) => String(r.symbol).trim().toUpperCase() === n.sym);
    const uniq = [...new Set(byName.map((r) => `${r.symbol}=${r.smName ?? r.cmName}`))];
    console.log(`  ${pad(n.sym, 13)} byNAME ${pad(byName.length, 4)} row(s) ${JSON.stringify(uniq.slice(0, 5))}   bySYMBOL ${bySym.length}`);
    out.t1[n.sym] = { byName: byName.length, bySymbol: bySym.length, uniq };
  }

  // ── T2 · the announcements NSE DOES hold for them ───────────────────────
  console.log(`\n  ── T2 · the announcements NSE holds under these symbols (unfiltered) ──`);
  out.t2 = {};
  for (const n of NEEDLES) {
    const j = await api(`/api/corporate-announcements?index=equities&symbol=${n.sym}`,
      "https://www.nseindia.com/companies-listing/corporate-filings-announcements");
    const d: any[] = Array.isArray(j) ? j : j?.data ?? [];
    console.log(`  ${pad(n.sym, 13)} ${d.length} row(s)`);
    for (const r of d.slice(0, 5))
      console.log(`       ${pad(String(r.an_dt ?? r.sort_date ?? "-").slice(0, 11), 13)}${pad(String(r.desc ?? r.subject ?? "-").slice(0, 44), 46)}${String(r.smIndustry ?? "-").slice(0, 22)}`);
    out.t2[n.sym] = { n: d.length, sample: d.slice(0, 6) };
    await sleep(1400);
  }

  // ── T3 · the shareholding store — same question, different filing family ─
  console.log(`\n  ── T3 · /api/corporate-share-holdings-master (is this a RESULTS gap or a WHOLE-COMPANY gap?) ──`);
  out.t3 = {};
  for (const n of NEEDLES) {
    const j = await api(`/api/corporate-share-holdings-master?index=equities&symbol=${n.sym}`,
      "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern");
    const d: any[] = Array.isArray(j) ? j : j?.data ?? [];
    const dates = d.map((r: any) => r.date ?? r.asOnDate ?? r.submissionDate).filter(Boolean);
    console.log(`  ${pad(n.sym, 13)} ${pad(d.length, 5)} row(s)   latest=${dates[0] ?? "-"}`);
    out.t3[n.sym] = { n: d.length, sample: d.slice(0, 3) };
    await sleep(1400);
  }

  // ── T4 · our own DB: what OTHER pipelines reach these stocks? ────────────
  console.log(`\n  ── T4 · our own tables — which pipelines still reach these three? ──`);
  const dbRows = (await prisma.$queryRawUnsafe(`
    SELECT s."symbol" sym,
      (SELECT count(*)::int FROM daily_prices d WHERE d."stock_id"=s."id") prices,
      (SELECT max(d."date")::text FROM daily_prices d WHERE d."stock_id"=s."id") price_hi,
      (SELECT count(*)::int FROM shareholding_patterns p WHERE p."stock_id"=s."id") shp,
      (SELECT max(p."as_on_date")::text FROM shareholding_patterns p WHERE p."stock_id"=s."id") shp_hi,
      (SELECT count(*)::int FROM corporate_events e WHERE e."stock_id"=s."id") evt,
      (SELECT max(e."event_date")::text FROM corporate_events e WHERE e."stock_id"=s."id") evt_hi,
      (SELECT count(*)::int FROM insider_trades t WHERE t."stock_id"=s."id") ins,
      (SELECT count(*)::int FROM stock_news nw WHERE nw."stock_id"=s."id") news,
      (SELECT count(*)::int FROM block_deals b WHERE b."stock_id"=s."id") blk
    FROM stocks s WHERE s."symbol" = ANY($1::text[]) ORDER BY s."symbol"`,
    NEEDLES.map((n) => n.sym))) as any[];
  console.log(`  ${pad("symbol", 13)}${pad("prices", 8)}${pad("last price", 12)}${pad("shp", 5)}${pad("last shp", 12)}${pad("evt", 5)}${pad("last evt", 12)}${pad("insider", 8)}${pad("news", 6)}blk`);
  for (const r of dbRows)
    console.log(`  ${pad(r.sym, 13)}${pad(r.prices, 8)}${pad(String(r.price_hi ?? "-").slice(0, 10), 12)}${pad(r.shp, 5)}${pad(String(r.shp_hi ?? "-").slice(0, 10), 12)}${pad(r.evt, 5)}${pad(String(r.evt_hi ?? "-").slice(0, 10), 12)}${pad(r.ins, 8)}${pad(r.news, 6)}${r.blk}`);
  out.t4 = dbRows;

  writeFileSync(`${DIR}/_f4b5-probe.json`, JSON.stringify(out, null, 1));
  console.log(`\n  → ${DIR}/_f4b5-probe.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
