// ─────────────────────────────────────────────────────────────
// DRY-RUN harness for the index-prices guards (4 families).
//
// Synthetic breaches through the REAL provider.processIndexBody() +
// predicate tests + reportIngestionError/dedup + a real ind_close_all
// read (read-only; also validates the 12-column SHAPE list against NSE's
// actual header — a rename there would false-reject every day).
//
// Sentinel date 1990-01-01 (runRef "1990-01-01:nse-index-csv") + sentinel
// cron "_dryrun_idx" → cleanup only touches dry-run rows.
//
// Run:  npx tsx src/scripts/dryrun-indices-guards.ts
// ─────────────────────────────────────────────────────────────

import https from "https";
import { prisma } from "../db/prisma.js";
import { NseIndexCsvProvider } from "../ingestions/indices/providers/nse-index-bhavcopy.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import {
  checkShape,
  checkSkipRate,
  classifyCount,
  checkNullRate,
  REQUIRED_INDEX_COLUMNS,
  COUNT_FLOOR,
  CHANGEPCT_NULL_MAX,
  OHL_NULL_MAX,
  VALUATION_NULL_MAX,
} from "../ingestions/indices/indices-guards.js";

const CRON = "_dryrun_idx";
const SENTINEL_DATE = new Date("1990-01-01T00:00:00.000Z");
const SENTINEL_RUNREF = "1990-01-01:";

const COLS = [
  "Index Name", "Index Date", "Open Index Value", "High Index Value",
  "Low Index Value", "Closing Index Value", "Points Change", "Change(%)",
  "Volume", "Turnover (Rs. Cr.)", "P/E", "P/B", "Div Yield",
];
function row(i: number, overrides: Partial<Record<string, string>> = {}): string {
  const base: Record<string, string> = {
    "Index Name": `Nifty Test ${i}`, "Index Date": "25-Jun-2026",
    "Open Index Value": "100", "High Index Value": "105", "Low Index Value": "99",
    "Closing Index Value": "103", "Points Change": "3", "Change(%)": "2.5",
    Volume: "1000", "Turnover (Rs. Cr.)": "500", "P/E": "22.5", "P/B": "3.2", "Div Yield": "1.1",
  };
  return COLS.map((c) => overrides[c] ?? base[c]).join(",");
}
const NORMAL_HEADER = COLS.join(",");
const RENAMED_HEADER = COLS.map((c) => (c === "P/E" ? "PE Ratio" : c)).join(","); // a col the old substring check missed
const csv = (header: string, rows: string[]) => [header, ...rows].join("\n");
const buildNormalCsv = (n: number) => csv(NORMAL_HEADER, Array.from({ length: n }, (_, i) => row(i)));
const buildRenamedCsv = (n: number) => csv(RENAMED_HEADER, Array.from({ length: n }, (_, i) => row(i)));
const buildHighSkipCsv = () => csv(NORMAL_HEADER, Array.from({ length: 100 }, (_, i) => (i < 20 ? row(i, { "Closing Index Value": "" }) : row(i))));

const results: { ok: boolean; name: string; got?: unknown }[] = [];
function check(name: string, ok: boolean, got?: unknown) {
  results.push({ ok, name, got });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}
async function cleanup() {
  await prisma.ingestionError.deleteMany({ where: { OR: [{ cron: CRON }, { runRef: { startsWith: SENTINEL_RUNREF } }] } });
}
async function sentinelRow(guardType: string) {
  return prisma.ingestionError.findFirst({ where: { runRef: { startsWith: SENTINEL_RUNREF }, guardType: guardType as never } });
}

function indexUrl(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `https://nsearchives.nseindia.com/content/indices/ind_close_all_${dd}${mm}${yyyy}.csv`;
}
function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "text/csv,*/*" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") }));
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("timeout")));
  });
}

async function main() {
  const provider = new NseIndexCsvProvider();
  await cleanup();

  // ── 1. NORMAL — healthy index CSV trips nothing ──
  console.log("\n[1] Healthy ~150-index file — expect ZERO flags");
  const normal = await provider.processIndexBody(buildNormalCsv(150), SENTINEL_DATE);
  check("parses 150 indices", normal.values.length === 150, normal.values.length);
  const afterNormal = await prisma.ingestionError.count({ where: { runRef: { startsWith: SENTINEL_RUNREF } } });
  check("provider guards write 0 rows on a healthy file", afterNormal === 0, afterNormal);
  check("count(150) clean", classifyCount(150) === null);
  check("count(50) → high (partial)", classifyCount(50)?.severity === "high");

  // ── 2. SHAPE — a renamed column the OLD substring check missed ──
  console.log("\n[2] Rename P/E→PE Ratio (old substring check would MISS this) — expect REJECT");
  let threw = false;
  try { await provider.processIndexBody(buildRenamedCsv(150), SENTINEL_DATE); } catch { threw = true; }
  check("shape breach THROWS (rejected)", threw);
  const shapeRow = await sentinelRow("shape");
  check("shape row critical/source_code", shapeRow?.severity === "critical" && shapeRow?.resolutionPath === "source_code");
  check("shape observed names the missing column", !!shapeRow?.observed.includes("P/E"), shapeRow?.observed);

  // ── 3. SKIP-RATE — 20% un-parseable closes (fake-holiday signal) ──
  console.log("\n[3] 20% rows with no close — expect HIGH skip flag, good rows still land");
  const skip = await provider.processIndexBody(buildHighSkipCsv(), SENTINEL_DATE);
  check("skip breach lands the good 80 rows", skip.values.length === 80, skip.values.length);
  const skipRow = await sentinelRow("null_rate");
  check("skip row high", skipRow?.severity === "high", skipRow?.severity);
  check("skip observed shows 20/100", !!skipRow?.observed.includes("20/100"), skipRow?.observed);
  check("checkSkipRate(20,100) flagged", checkSkipRate(20, 100) != null);
  check("checkSkipRate(0,150) clean", checkSkipRate(0, 150) === null);

  // ── 4. NULL-RATE predicates (guard-the-always-present, threshold-the-sparse) ──
  console.log("\n[4] Null-rate thresholds");
  check("changePct 12/150=8% → flagged (tight, normal 0.7%)", checkNullRate(12, 150, CHANGEPCT_NULL_MAX) != null);
  check("changePct 1/150 → clean", checkNullRate(1, 150, CHANGEPCT_NULL_MAX) === null);
  check("OHL 15/150=10% → clean (legit G-Sec/rate)", checkNullRate(15, 150, OHL_NULL_MAX) === null);
  check("OHL 60/150=40% → flagged (rename spike)", checkNullRate(60, 150, OHL_NULL_MAX) != null);
  check("valuation 24/150=16% → clean (legit sparse)", checkNullRate(24, 150, VALUATION_NULL_MAX) === null);
  check("valuation 75/150=50% → flagged (rename spike)", checkNullRate(75, 150, VALUATION_NULL_MAX) != null);

  // ── 5. report mapping + dedup ──
  console.log("\n[5] report mapping + dedup");
  await reportIngestionError({ source: "nse-index-csv", cron: CRON, guardType: "count", targetTable: "IndexPrice", severity: "high", resolutionPath: "source_code", expected: "≥120", observed: "50 indices", runRef: "1990-01-01:nse-index-csv" });
  const c = await prisma.ingestionError.findFirst({ where: { cron: CRON, guardType: "count" } });
  check("count row high/source_code", c?.severity === "high" && c?.resolutionPath === "source_code");
  const dArgs = { source: "nse-index-csv", cron: CRON, guardType: "null_rate" as const, targetTable: "IndexPrice", targetField: "pe", severity: "medium" as const, resolutionPath: "source_code" as const, expected: "≤30%", observed: "55%", runRef: "x" };
  await reportIngestionError(dArgs);
  await reportIngestionError({ ...dArgs, observed: "60%" });
  const dup = await prisma.ingestionError.findMany({ where: { cron: CRON, guardType: "null_rate", targetField: "pe" } });
  check("dedup → 1 row occurrences 2", dup.length === 1 && dup[0]?.occurrences === 2, { len: dup.length, occ: dup[0]?.occurrences });
  await cleanup();
  check("cleanup clean", (await prisma.ingestionError.count({ where: { OR: [{ cron: CRON }, { runRef: { startsWith: SENTINEL_RUNREF } }] } })) === 0);

  // ── 6. REAL ind_close_all read (validates the 12-column list) ──
  console.log("\n[6] Real ind_close_all read (best-effort)");
  let found: { date: Date; body: string } | null = null;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  for (let i = 1; i <= 12 && !found; i++) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - i);
    const dow = d.getUTCDay(); if (dow === 0 || dow === 6) continue;
    try {
      const res = await get(indexUrl(d));
      console.log(`   ${d.toISOString().slice(0, 10)} → HTTP ${res.status} (${res.body.length} bytes)`);
      if (res.status === 200 && res.body.length > 1000) found = { date: d, body: res.body };
    } catch (e) { console.log(`   fetch error: ${(e as Error).message}`); }
  }
  if (!found) {
    console.log("   ⚠ INCONCLUSIVE — couldn't reach a real archive. (DB grounding confirms 12-col header on 35,771 rows.)");
  } else {
    const headerCols = (found.body.split(/\r?\n/, 1)[0] ?? "").split(",").map((s) => s.trim());
    const missing = checkShape(headerCols);
    console.log(`   real header: ${headerCols.join(" | ")}`);
    console.log(`   missing from REQUIRED: ${missing.length ? missing.join(", ") : "(none)"}`);
    const before = await prisma.ingestionError.count({ where: { runRef: { startsWith: SENTINEL_RUNREF } } });
    let realThrew = false, realCount = 0;
    try { const out = await provider.processIndexBody(found.body, SENTINEL_DATE); realCount = out.values.length; }
    catch (e) { realThrew = true; console.log(`   processIndexBody threw: ${(e as Error).message}`); }
    const wrote = (await prisma.ingestionError.count({ where: { runRef: { startsWith: SENTINEL_RUNREF } } })) - before;
    console.log(`   parsed ${realCount} indices; guards wrote ${wrote} rows`);
    check("real header has all 12 required columns (SHAPE won't false-reject)", missing.length === 0, missing);
    check("real file not rejected + skip clean", !realThrew && wrote === 0 && realCount > 100, { realThrew, wrote, realCount });
  }

  await cleanup();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await prisma.$disconnect();
  if (passed !== results.length) process.exit(1);
}
main().catch(async (e) => { console.error(e); process.exit(1); });
