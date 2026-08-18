// ═══════════════════════════════════════════════════════════════
// F4b (4) — THE DECISIVE TEST. READ-ONLY (network + DB reads; no writes).
//   npx tsx src/scripts/_f4b4-probe.ts
//
// F4b(3) found the shape:
//   · financial-results?symbol=ABBOTINDIA → ONE row, period 01-Dec-2009..28-Feb-2010,
//     xbrl = the "-" placeholder. BAYERCROP the same (a 2010 quarterly + a 2010 annual).
//     MCX → nothing at all.
//   · integrated-filing?symbol=… → totalCount 0 for all three (RELIANCE 19).
//   · corporate-announcements?symbol=… → 0 for all three (RELIANCE 266/3338).
//   · BUT corporates-corporateActions?symbol=… → 17 / 20 / 18 (RELIANCE 20).
//
// So the SYMBOL is right enough for NSE's corporate-ACTIONS store to answer, and the
// FILINGS store answers with a 2010 fossil or nothing. Two readings remain, and they
// have opposite remedies:
//   (a) RENAME — the company files under a DIFFERENT symbol now, and we are asking
//       about a retired one. Then the ISIN appears in the market-wide list under
//       some other symbol.
//   (b) GENUINELY ABSENT — NSE's filings store has nothing for this ISIN under ANY
//       symbol. Then no symbol fix can recover it and the data must come from
//       elsewhere (or not at all).
//
// The test that separates them: pull the market-wide filings list (no symbol filter)
// and search it by ISIN and by company name. An ISIN is immutable; a symbol is not.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import https from "node:https";
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SUBJECTS = [
  { sym: "ABBOTINDIA", isin: "INE358A01014", needle: /abbott/i },
  { sym: "BAYERCROP", isin: "INE462A01022", needle: /bayer/i },
  { sym: "MCX", isin: "INE745G01043", needle: /multi commodity|^mcx\b/i },
];
const CONTROL = { sym: "RELIANCE", isin: "INE002A01018", needle: /reliance industries/i };

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

const FR_REF = "https://www.nseindia.com/companies-listing/corporate-filings-financial-results";
async function bootstrap() {
  COOKIES = "";
  for (const u of ["https://www.nseindia.com/", FR_REF]) {
    const r = await httpGet(u, "https://www.nseindia.com/");
    const jar = new Map(COOKIES ? COOKIES.split("; ").map((c) => [c.split("=")[0], c]) : []);
    for (const c of r.setCookie.map((x) => x.split(";")[0])) jar.set(c.split("=")[0], c);
    COOKIES = [...jar.values()].join("; ");
    await sleep(900);
  }
}
async function api(path: string, referer = FR_REF): Promise<any> {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await httpGet(`https://www.nseindia.com${path}`, referer);
      if (r.status === 200) { try { return JSON.parse(r.body); } catch { return { __raw: r.body.slice(0, 200) }; } }
      if (a === 3) return { __status: r.status };
    } catch (e) { if (a === 3) return { __err: (e as Error).message }; }
    await sleep(3000); await bootstrap();
  }
}

const out: any = {};

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F4b(4) — RENAME, or GENUINELY ABSENT? Search the market-wide list by ISIN  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  await bootstrap();

  // ── S1 · the market-wide financial-results list, both periods ────────────
  const universe: any[] = [];
  for (const period of ["Quarterly", "Annual"] as const) {
    const j = await api(`/api/corporates-financial-results?index=equities&period=${period}`);
    const rows: any[] = Array.isArray(j) ? j : [];
    console.log(`\n  market-wide financial-results (${period}): ${rows.length} row(s)`);
    universe.push(...rows.map((r) => ({ ...r, __period: period })));
    await sleep(1800);
  }
  const bySym = new Map<string, number>();
  for (const r of universe) bySym.set(r.symbol, (bySym.get(r.symbol) ?? 0) + 1);
  console.log(`  distinct symbols in that list: ${bySym.size}`);
  const dates = universe.map((r) => r.filingDate).filter(Boolean).sort();
  console.log(`  filingDate span in that list  : ${String(dates[0]).slice(0, 11)} .. ${String(dates[dates.length - 1]).slice(0, 11)}`);

  console.log(`\n  ── S1 · search that list by ISIN and by company name ──`);
  out.s1 = {};
  for (const t of [...SUBJECTS, CONTROL]) {
    const byIsin = universe.filter((r) => r.isin === t.isin);
    const byName = universe.filter((r) => t.needle.test(String(r.companyName ?? "")));
    const symsIsin = [...new Set(byIsin.map((r) => r.symbol))];
    const symsName = [...new Set(byName.map((r) => `${r.symbol}=${r.companyName}`))];
    console.log(`  ${pad(t.sym, 13)} byISIN ${pad(byIsin.length, 5)} row(s) under symbol(s) ${JSON.stringify(symsIsin)}`);
    console.log(`  ${pad("", 13)} byNAME ${pad(byName.length, 5)} row(s) ${JSON.stringify(symsName.slice(0, 4))}`);
    out.s1[t.sym] = { isin: t.isin, byIsin: byIsin.length, symsIsin, byName: byName.length, symsName };
  }

  // ── S2 · the same question on the INTEGRATED filing store (the modern regime) ──
  console.log(`\n  ── S2 · integrated-filing-results, market-wide window 01-04-2025..17-08-2026, searched ──`);
  const seen = new Set<string>();
  const intRows: any[] = [];
  let totalCount: number | null = null;
  for (let page = 1; page <= 60; page++) {
    const j = await api(`/api/integrated-filing-results?index=equities&from_date=01-04-2025&to_date=17-08-2026&size=100&page=${page}`);
    const rows: any[] = j?.data ?? [];
    if (typeof j?.totalCount === "number") totalCount = Math.max(totalCount ?? 0, j.totalCount);
    let fresh = 0;
    for (const r of rows) { const k = String(r.seq_Id); if (seen.has(k)) continue; seen.add(k); intRows.push(r); fresh++; }
    process.stdout.write(`\r     page ${page}: ${intRows.length}/${totalCount ?? "?"} rows`);
    if (rows.length === 0 || fresh === 0) break;
    if (totalCount !== null && intRows.length >= totalCount) break;
    await sleep(900);
  }
  console.log(``);
  const intSyms = new Set(intRows.map((r) => r.symbol));
  console.log(`     walked ${intRows.length} row(s), ${intSyms.size} distinct symbols`);
  out.s2 = { rows: intRows.length, symbols: intSyms.size, totalCount };
  for (const t of [...SUBJECTS, CONTROL]) {
    const hits = intRows.filter((r) => t.needle.test(String(r.smName ?? r.cmName ?? "")) || r.symbol === t.sym);
    const syms = [...new Set(hits.map((r) => `${r.symbol}=${r.smName ?? r.cmName}`))];
    console.log(`  ${pad(t.sym, 13)} ${pad(hits.length, 5)} row(s) ${JSON.stringify(syms.slice(0, 4))}`);
    out.s2[t.sym] = { hits: hits.length, syms };
  }

  // ── S3 · is our symbol even in NSE's own equity list? ────────────────────
  console.log(`\n  ── S3 · NSE's EQUITY_L master (the definitive listed-securities file) ──`);
  const csv = await httpGet("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv", "https://www.nseindia.com/");
  if (csv.status === 200) {
    const lines = csv.body.split(/\r?\n/).filter(Boolean);
    const hdr = lines[0].split(",").map((h) => h.trim());
    const iSym = hdr.indexOf("SYMBOL"), iName = hdr.findIndex((h) => /NAME OF COMPANY/i.test(h));
    const iSeries = hdr.findIndex((h) => /SERIES/i.test(h)), iIsin = hdr.findIndex((h) => /ISIN/i.test(h));
    const iListed = hdr.findIndex((h) => /DATE OF LISTING/i.test(h));
    console.log(`     EQUITY_L: ${lines.length - 1} securities · columns ${JSON.stringify(hdr)}`);
    const recs = lines.slice(1).map((l) => l.split(","));
    out.s3 = { n: lines.length - 1 };
    for (const t of [...SUBJECTS, CONTROL]) {
      const bySym = recs.find((r) => r[iSym]?.trim() === t.sym);
      const byIsin = recs.filter((r) => r[iIsin]?.trim() === t.isin);
      console.log(
        `  ${pad(t.sym, 13)} bySYMBOL ${bySym ? `FOUND series=${bySym[iSeries]?.trim()} listed=${bySym[iListed]?.trim()} isin=${bySym[iIsin]?.trim()}` : "NOT FOUND"}`,
      );
      console.log(`  ${pad("", 13)} byISIN   ${byIsin.length} row(s) ${JSON.stringify(byIsin.map((r) => r[iSym]?.trim()))}`);
      out.s3[t.sym] = { bySymbol: bySym ? { series: bySym[iSeries]?.trim(), listed: bySym[iListed]?.trim(), isin: bySym[iIsin]?.trim(), name: bySym[iName]?.trim() } : null, byIsin: byIsin.map((r) => r[iSym]?.trim()) };
    }
  } else {
    console.log(`     EQUITY_L HTTP ${csv.status}`);
    out.s3 = { status: csv.status };
  }

  writeFileSync(`${DIR}/_f4b4-probe.json`, JSON.stringify(out, null, 1));
  console.log(`\n  → ${DIR}/_f4b4-probe.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
