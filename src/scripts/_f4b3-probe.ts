// ═══════════════════════════════════════════════════════════════
// F4b (3) — THE ROWS THEMSELVES. READ-ONLY (network + DB reads; no writes).
//   npx tsx src/scripts/_f4b3-probe.ts
//
// F4b(2) turned up the discriminator: the v2 financial-results endpoint returns
//   ABBOTINDIA=1  BAYERCROP=1  MCX=0  RELIANCE=130
// WITHOUT date params, but 0 / 0 / 0 / 53 WITH fromDate+toDate. So the store is not
// uniformly empty and the question is now: what ARE those rows, and does the symbol
// filter mean what we think it means?
//
// Dump raw rows, both periods, filtered and unfiltered, for all four.
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

const ALL = ["ABBOTINDIA", "BAYERCROP", "MCX", "RELIANCE"];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
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
    req.setTimeout(45_000, () => req.destroy(new Error("timeout")));
  });
}

async function bootstrap() {
  for (const u of ["https://www.nseindia.com/", "https://www.nseindia.com/companies-listing/corporate-filings-financial-results"]) {
    const r = await httpGet(u, "https://www.nseindia.com/");
    const jar = new Map(COOKIES ? COOKIES.split("; ").map((c) => [c.split("=")[0], c]) : []);
    for (const c of r.setCookie.map((x) => x.split(";")[0])) jar.set(c.split("=")[0], c);
    COOKIES = [...jar.values()].join("; ");
    await sleep(900);
  }
}

const FR_REF = "https://www.nseindia.com/companies-listing/corporate-filings-financial-results";
async function api(path: string, referer = FR_REF): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await httpGet(`https://www.nseindia.com${path}`, referer);
      if (r.status !== 200) return { __status: r.status, __raw: r.body.slice(0, 200) };
      try { return JSON.parse(r.body); } catch { return { __status: 200, __raw: r.body.slice(0, 200) }; }
    } catch (e) {
      if (attempt === 2) return { __err: (e as Error).message };
      await sleep(2500);
      await bootstrap();
    }
  }
}

const out: any = {};

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F4b(3) — the rows NSE actually returns for these symbols                   ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  await bootstrap();

  // ── R1 · financial-results, UNFILTERED, both periods ────────────────────
  for (const period of ["Quarterly", "Annual"] as const) {
    console.log(`\n  ── R1 · /api/corporates-financial-results?index=equities&symbol=…&period=${period} (NO dates) ──`);
    out[`r1_${period}`] = {};
    for (const s of ALL) {
      const j = await api(`/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(s)}&period=${period}`);
      const rows: any[] = Array.isArray(j) ? j : [];
      console.log(`  ${pad(s, 13)} ${Array.isArray(j) ? `${rows.length} row(s)` : JSON.stringify(j).slice(0, 100)}`);
      for (const r of rows.slice(0, 6)) {
        console.log(
          `       sym=${pad(r.symbol, 12)} ${pad(r.fromDate ?? "-", 13)}${pad(r.toDate ?? "-", 13)}` +
            `${pad(r.relatingTo ?? "-", 10)}${pad(r.consolidated ?? "-", 17)}isin=${pad(r.isin ?? "-", 14)}xbrl=${r.xbrl ? String(r.xbrl).slice(-34) : "(none)"}`,
        );
      }
      if (rows.length > 6) console.log(`       … ${rows.length - 6} more`);
      out[`r1_${period}`][s] = { n: rows.length, rows: rows.slice(0, 8) };
      await sleep(1500);
    }
  }

  // ── R2 · same, WITH the date window the backfill sends ──────────────────
  console.log(`\n  ── R2 · WITH fromDate=01-04-2017 / toDate=31-01-2025 in BOTH date formats ──`);
  out.r2 = {};
  for (const s of ALL) {
    const iso = await api(`/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(s)}&period=Quarterly&fromDate=2017-04-01&toDate=2025-01-31`);
    await sleep(1400);
    const ddmm = await api(`/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(s)}&period=Quarterly&from_date=01-04-2017&to_date=31-01-2025`);
    const nIso = Array.isArray(iso) ? iso.length : JSON.stringify(iso).slice(0, 40);
    const nDd = Array.isArray(ddmm) ? ddmm.length : JSON.stringify(ddmm).slice(0, 40);
    console.log(`  ${pad(s, 13)} fromDate/toDate(ISO)=${pad(nIso, 8)}  from_date/to_date(DD-MM-YYYY)=${nDd}`);
    out.r2[s] = { iso: nIso, ddmm: nDd };
    await sleep(1400);
  }

  // ── R3 · integrated-filing, UNFILTERED by date, and with a wide window ───
  console.log(`\n  ── R3 · /api/integrated-filing-results — symbol only, and a wide date window ──`);
  out.r3 = {};
  for (const s of ALL) {
    const a = await api(`/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(s)}&size=100&page=1`);
    await sleep(1400);
    const b = await api(`/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(s)}&from_date=01-01-2024&to_date=17-08-2026&size=100&page=1`);
    console.log(`  ${pad(s, 13)} symbol-only totalCount=${pad(a?.totalCount ?? "?", 6)}  windowed totalCount=${b?.totalCount ?? "?"}`);
    out.r3[s] = { symbolOnly: a?.totalCount ?? null, windowed: b?.totalCount ?? null, sample: (a?.data ?? []).slice(0, 3) };
    await sleep(1400);
  }

  // ── R4 · the announcements store, for the SUBJECT symbols, wide window ───
  console.log(`\n  ── R4 · /api/corporate-announcements with a wide window (does NSE file ANYTHING under this symbol?) ──`);
  out.r4 = {};
  for (const s of ALL) {
    const j = await api(
      `/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(s)}&from_date=01-01-2025&to_date=17-08-2026`,
      "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
    );
    const rows: any[] = Array.isArray(j) ? j : j?.data ?? [];
    console.log(`  ${pad(s, 13)} ${rows.length} announcement(s)`);
    for (const r of rows.slice(0, 4))
      console.log(`       ${pad(String(r.an_dt ?? r.sort_date ?? "-").slice(0, 11), 13)}${pad(String(r.desc ?? r.subject ?? "-").slice(0, 46), 48)}${String(r.smIndustry ?? "").slice(0, 20)}`);
    out.r4[s] = { n: rows.length, sample: rows.slice(0, 5) };
    await sleep(1500);
  }

  writeFileSync(`${DIR}/_f4b3-probe.json`, JSON.stringify(out, null, 1));
  console.log(`\n  → ${DIR}/_f4b3-probe.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
