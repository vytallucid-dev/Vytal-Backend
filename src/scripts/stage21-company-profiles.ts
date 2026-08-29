// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 21 — COMPANY DESCRIPTIONS + SECTOR, FROM YAHOO'S assetProfile.  ⚠ WRITES.
//
//   npx tsx src/scripts/stage21-company-profiles.ts --dry-run
//   npx tsx src/scripts/stage21-company-profiles.ts --slice 0/3 --ledger _s21-ledger.w0.json
//
// ── WHY NOT WEB SEARCH ───────────────────────────────────────────────────────────────────────────
// 2,290 companies need a description. Searching the web for each is thousands of round trips and
// leaves every row a paraphrase of a page nobody recorded. `quoteSummary(symbol, ["assetProfile"])`
// returns longBusinessSummary, sector, industry, website and headcount in ONE call, through the same
// library already driving the price backfill — a real source, one hop, per symbol.
//
// ── description IS WRITTEN; sector IS ONLY RECORDED ──────────────────────────────────────────────
// The description lands in `stocks.description`, NULL-only. Yahoo's sector does NOT: its 11 GICS
// buckets do not map onto our 20 India-specific ones (its "Financial Services" is our banks, nbfc,
// capital_markets AND insurance). Guessing would put wrong labels into sector rollups, where they
// read as fact. So the raw sector/industry pair is stashed in the ledger and mapped by stage 21b,
// which only accepts unambiguous pairs and leaves the rest NULL — the same gate seed-nifty500-pass1
// applied to its own ambiguous labels.
//
// ── AND industryType OUTRANKS YAHOO WHERE THEY DISAGREE ──────────────────────────────────────────
// For financial companies we already know the answer better than Yahoo does: `industryType` was
// derived from the taxonomy the company itself filed under. banking → banks, nbfc → nbfc,
// life/general_insurance → insurance. That evidence beats a third-party label and stage 21b uses it
// first.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import YahooFinance from "yahoo-finance2";
import { prisma } from "../db/prisma.js";

const argv = process.argv;
const DRY = argv.includes("--dry-run");
const RETRY_FAILED = argv.includes("--retry-failed");
const num = (f: string, d: number): number => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const arg = (f: string, d: string): string => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const LIMIT = num("--limit", 0);
const PAUSE_MS = num("--pause", 250);
const SLICE = arg("--slice", "");
const [SLICE_I, SLICE_N] = SLICE ? SLICE.split("/").map(Number) : [0, 1];
const LEDGER = arg("--ledger", SLICE ? `_s21-ledger.w${SLICE_I}.json` : "_s21-ledger.json");

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Entry { status: "ok" | "empty" | "failed"; at: string; wroteDesc: boolean; sector?: string; industry?: string; error?: string }
type Ledger = Record<string, Entry>;
const readLedger = (): Ledger => (fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) as Ledger : {});
function readAll(): Ledger {
  const m: Ledger = {};
  for (const f of fs.readdirSync(".").filter((x) => /^_s21-ledger.*\.json$/.test(x)))
    Object.assign(m, JSON.parse(fs.readFileSync(f, "utf8")) as Ledger);
  return m;
}

/** Yahoo tickers for NSE equities are SYMBOL.NS; a handful of ours carry an override upstream. */
const yahooTicker = (s: string): string => `${s}.NS`;

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 21 — company profiles  ${DRY ? "(dry-run)" : "*** LIVE ***"}   ledger ${LEDGER}`);
  console.log("=".repeat(100));

  const all = await prisma.$queryRawUnsafe<Array<{ symbol: string; has_desc: boolean }>>(
    `SELECT symbol, (description IS NOT NULL) AS has_desc FROM stocks WHERE is_active ORDER BY symbol`);
  const ledger = readLedger();
  const done = new Set(Object.entries(readAll()).filter(([, e]) => e.status !== "failed" || !RETRY_FAILED).map(([k]) => k));
  let todo = all.filter((s) => !done.has(s.symbol)).map((s) => s.symbol)
    .filter((_, i) => SLICE_N <= 1 || i % SLICE_N === SLICE_I);
  if (LIMIT > 0) todo = todo.slice(0, Math.floor(LIMIT));

  console.log(`\n  active ${all.length} · attempted ${Object.keys(readAll()).length} · this run ${todo.length}${SLICE ? `  (worker ${SLICE_I + 1}/${SLICE_N})` : ""}`);
  if (!todo.length) { console.log(`\n  nothing to do.\n`); await prisma.$disconnect(); return; }
  if (DRY) { console.log(`  first 10: ${todo.slice(0, 10).join(", ")}\n`); await prisma.$disconnect(); return; }

  const t0 = Date.now();
  let ok = 0, empty = 0, failed = 0, wrote = 0;
  for (let i = 0; i < todo.length; i++) {
    const symbol = todo[i];
    let e: Entry;
    try {
      const q = await yf.quoteSummary(yahooTicker(symbol), { modules: ["assetProfile"] }) as { assetProfile?: Record<string, unknown> };
      const p = q?.assetProfile ?? {};
      const summary = typeof p.longBusinessSummary === "string" ? p.longBusinessSummary.trim() : "";
      let wroteDesc = false;
      if (summary.length > 40) {
        // NULL-ONLY. A description already present was written by someone who knew more than a
        // third-party summary does; this never overwrites it.
        const n = await prisma.stock.updateMany({ where: { symbol, description: null }, data: { description: summary } });
        wroteDesc = n.count > 0;
        if (wroteDesc) wrote++;
      }
      e = {
        status: summary.length > 40 ? "ok" : "empty",
        at: new Date().toISOString(),
        wroteDesc,
        sector: typeof p.sector === "string" ? p.sector : undefined,
        industry: typeof p.industry === "string" ? p.industry : undefined,
      };
      if (e.status === "ok") ok++; else empty++;
    } catch (err) {
      e = { status: "failed", at: new Date().toISOString(), wroteDesc: false, error: String(err).slice(0, 160) };
      failed++;
    }
    ledger[symbol] = e;
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
    const n = i + 1, el = (Date.now() - t0) / 1000;
    process.stdout.write(`\r  ${n}/${todo.length}  ok ${ok} · empty ${empty} · failed ${failed} · wrote ${wrote}  ${(el / n).toFixed(1)}s/sym  ~${Math.round((el / n) * (todo.length - n) / 60)}min left      `);
    if (i < todo.length - 1) await sleep(PAUSE_MS);
  }
  console.log(`\n\n  ── DONE ── ok ${ok} · empty ${empty} · failed ${failed} · descriptions written ${wrote} · ${((Date.now() - t0) / 60000).toFixed(1)} min\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
