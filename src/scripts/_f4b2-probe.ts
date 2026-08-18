// ═══════════════════════════════════════════════════════════════
// F4b (2) — NARROW IT DOWN. READ-ONLY (network + DB reads; no writes).
//   npx tsx src/scripts/_f4b2-probe.ts
//
// F4b(1) established: BOTH filing endpoints (v3 integrated + v2 legacy) return
// totalCount=0 for all three, while RELIANCE returns 19 / 53 on the same session.
// So it is not the Financials filter, not the session, not the endpoint.
//
// Remaining candidates:
//   (a) NSE does not know the SYMBOL (rename / delisting)      → quote-equity, master
//   (b) NSE knows the symbol but not on index=equities          → try other indexes
//   (c) NSE's CORPORATE layer knows it (actions/announcements)  → then only the
//       FILINGS store is empty, and the cause is upstream of the symbol
//
// ⚠ quote-equity 403s behind the generic Referer the shared client sends. NSE keys
//   several endpoints to the page that would have made the call, so this probe runs
//   its own session with a per-endpoint Referer. Self-contained on purpose — it must
//   not mutate the shared client's session for the rest of the programme.
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

const SUBJECTS = ["ABBOTINDIA", "BAYERCROP", "MCX"];
const CONTROL = "RELIANCE";
const ALL = [...SUBJECTS, CONTROL];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
let COOKIES = "";

function httpGet(url: string, referer: string): Promise<{ status: number; body: string; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          Referer: referer,
          Connection: "keep-alive",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
          ...(COOKIES ? { Cookie: COOKIES } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const enc = res.headers["content-encoding"];
          const done = (b: Buffer) =>
            resolve({
              status: res.statusCode ?? 0,
              body: b.toString("utf-8"),
              setCookie: (res.headers["set-cookie"] as string[]) ?? [],
            });
          if (enc === "br") zlib.brotliDecompress(buf, (e, d) => (e ? reject(e) : done(d)));
          else if (enc === "gzip") zlib.gunzip(buf, (e, d) => (e ? reject(e) : done(d)));
          else if (enc === "deflate") zlib.inflate(buf, (e, d) => (e ? reject(e) : done(d)));
          else done(buf);
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(45_000, () => req.destroy(new Error("timeout")));
  });
}

async function bootstrap() {
  for (const u of ["https://www.nseindia.com/", "https://www.nseindia.com/market-data/live-equity-market"]) {
    const r = await httpGet(u, "https://www.nseindia.com/");
    const add = r.setCookie.map((c) => c.split(";")[0]);
    const jar = new Map(COOKIES ? COOKIES.split("; ").map((c) => [c.split("=")[0], c]) : []);
    for (const c of add) jar.set(c.split("=")[0], c);
    COOKIES = [...jar.values()].join("; ");
    await sleep(900);
  }
  console.log(`  session cookies: ${COOKIES.split("; ").map((c) => c.split("=")[0]).join(", ")}`);
}

async function api(path: string, referer: string): Promise<{ status: number; json: any; raw: string }> {
  const r = await httpGet(`https://www.nseindia.com${path}`, referer);
  let json: any = null;
  try { json = JSON.parse(r.body); } catch { /* leave null */ }
  return { status: r.status, json, raw: r.body.slice(0, 300) };
}

const out: any = {};

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F4b(2) — is it the SYMBOL, the INDEX, or the FILING STORE?                 ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  await bootstrap();

  const meta = new Map<string, any>();
  for (const s of ALL) {
    const [r] = await raw(`SELECT "isin","name" FROM stocks WHERE "symbol"=$1`, s);
    meta.set(s, r);
  }

  // ── Q1 · quote-equity with the RIGHT referer — does NSE know the symbol? ──
  console.log(`\n  ── Q1 · /api/quote-equity (referer = the get-quotes page) ──`);
  out.q1 = {};
  for (const s of ALL) {
    const r = await api(
      `/api/quote-equity?symbol=${encodeURIComponent(s)}`,
      `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(s)}`,
    );
    if (r.status !== 200 || !r.json) {
      console.log(`  ${pad(s, 13)} HTTP ${r.status}  ${r.raw.slice(0, 80)}`);
      out.q1[s] = { status: r.status, raw: r.raw };
    } else {
      const i = r.json.info ?? {}, m = r.json.metadata ?? {}, si = r.json.securityInfo ?? {};
      console.log(
        `  ${pad(s, 13)} isin=${pad(i.isin ?? "-", 14)} series=${pad(JSON.stringify(i.activeSeries ?? m.series ?? "-"), 10)} ` +
          `listed=${pad(m.listingDate ?? "-", 12)} status=${pad(m.status ?? "-", 8)} trading=${si.tradingStatus ?? "-"}`,
      );
      console.log(`  ${pad("", 13)} db.isin=${pad(meta.get(s)?.isin ?? "-", 14)} ${i.isin === meta.get(s)?.isin ? "✓ MATCH" : "⚠ DIFFERS"}  nse.name=${i.companyName ?? "-"}`);
      out.q1[s] = { isin: i.isin, dbIsin: meta.get(s)?.isin, company: i.companyName, series: i.activeSeries ?? m.series, listingDate: m.listingDate, status: m.status, tradingStatus: si.tradingStatus, industry: m.industry };
    }
    await sleep(1400);
  }

  // ── Q2 · does the CORPORATE layer know the symbol? corporate actions + announcements ──
  console.log(`\n  ── Q2 · /api/corporates-corporateActions + /api/corporate-announcements (index=equities&symbol=) ──`);
  out.q2 = {};
  for (const s of ALL) {
    const ca = await api(
      `/api/corporates-corporateActions?index=equities&symbol=${encodeURIComponent(s)}`,
      `https://www.nseindia.com/companies-listing/corporate-filings-actions`,
    );
    await sleep(1300);
    const an = await api(
      `/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(s)}`,
      `https://www.nseindia.com/companies-listing/corporate-filings-announcements`,
    );
    const nCa = Array.isArray(ca.json) ? ca.json.length : ca.json?.data?.length ?? -1;
    const nAn = Array.isArray(an.json) ? an.json.length : an.json?.data?.length ?? -1;
    console.log(`  ${pad(s, 13)} corporateActions=${pad(nCa, 6)}(HTTP ${ca.status})   announcements=${pad(nAn, 6)}(HTTP ${an.status})`);
    out.q2[s] = { corporateActions: nCa, caStatus: ca.status, announcements: nAn, anStatus: an.status,
      caSample: (Array.isArray(ca.json) ? ca.json : []).slice(0, 2), anSample: (Array.isArray(an.json) ? an.json : an.json?.data ?? []).slice(0, 2) };
    await sleep(1300);
  }

  // ── Q3 · the FILING endpoints across every `index` value NSE accepts ──
  console.log(`\n  ── Q3 · financial-results / integrated-filing across index values ──`);
  out.q3 = {};
  const INDEXES = ["equities", "debt", "sme", "sme_debt", "municipalBond", "invitsreits"];
  for (const s of ALL) {
    const row: any = {};
    for (const ix of INDEXES) {
      const r = await api(
        `/api/corporates-financial-results?index=${ix}&symbol=${encodeURIComponent(s)}&period=Quarterly`,
        `https://www.nseindia.com/companies-listing/corporate-filings-financial-results`,
      );
      row[ix] = Array.isArray(r.json) ? r.json.length : r.json?.data?.length ?? `HTTP${r.status}`;
      await sleep(1200);
    }
    console.log(`  ${pad(s, 13)} ${INDEXES.map((ix) => `${ix}=${row[ix]}`).join("  ")}`);
    out.q3[s] = row;
  }

  // ── Q4 · the ALL-FILINGS listing, no symbol filter, searched for our three ──
  console.log(`\n  ── Q4 · the equity master list — is the symbol present in NSE's own universe file? ──`);
  const master = await api(`/api/master-quote`, `https://www.nseindia.com/`);
  if (Array.isArray(master.json)) {
    console.log(`     master-quote: ${master.json.length} symbols`);
    for (const s of ALL) console.log(`     ${pad(s, 13)} present: ${master.json.includes(s) ? "YES" : "NO"}`);
    out.q4 = { n: master.json.length, present: Object.fromEntries(ALL.map((s) => [s, master.json.includes(s)])) };
  } else {
    console.log(`     master-quote HTTP ${master.status}: ${master.raw.slice(0, 120)}`);
    out.q4 = { status: master.status, raw: master.raw };
  }
  await sleep(1300);

  // ── Q5 · results filings by ISIN rather than symbol (does the store key on ISIN?) ──
  console.log(`\n  ── Q5 · financial-results by ISIN ──`);
  out.q5 = {};
  for (const s of ALL) {
    const isin = meta.get(s)?.isin;
    const r = await api(
      `/api/corporates-financial-results?index=equities&issuer=${encodeURIComponent(isin)}&period=Quarterly`,
      `https://www.nseindia.com/companies-listing/corporate-filings-financial-results`,
    );
    const n = Array.isArray(r.json) ? r.json.length : r.json?.data?.length ?? `HTTP${r.status}`;
    console.log(`  ${pad(s, 13)} isin=${pad(isin, 14)} → ${n}`);
    out.q5[s] = { isin, n };
    await sleep(1300);
  }

  writeFileSync(`${DIR}/_f4b2-probe.json`, JSON.stringify(out, null, 1));
  console.log(`\n  → ${DIR}/_f4b2-probe.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
