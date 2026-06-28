// ─────────────────────────────────────────────────────────────
// DRY-RUN harness for the prices ingestion guards (Part 3).
//
// Exercises the REAL guard code — the pure predicates + the provider's
// processBhavcopyBody() + the real reportIngestionError()/dedup seam —
// against synthetic scenarios, WITHOUT touching the network or inserting
// real prices.
//
// Isolation + safe cleanup:
//   • provider-path rows (shape/skip) carry a SENTINEL DATE (1990-01-01)
//     → runRef "1990-01-01:…", which no real run can produce.
//   • direct seam/dedup tests carry a SENTINEL CRON ("_dryrun").
//   Cleanup deletes ONLY those two sentinel namespaces.
//
// Run:  npx tsx src/scripts/dryrun-ingestion-guards.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { NseBhavcopyCsvProvider } from "../ingestions/prices/providers/nse-bhavcopy.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import {
  classifyCount,
  checkNullRate,
  checkCloseRange,
  checkContinuity,
  PREV_CLOSE_NULL_MAX,
  TRADED_VALUE_NULL_MAX,
  CLOSE_MIN,
  CLOSE_MAX,
} from "../ingestions/prices/prices-guards.js";

const SENTINEL_DATE = new Date("1990-01-01T00:00:00.000Z");
const SENTINEL_RUNREF_PREFIX = "1990-01-01:";
const SENTINEL_CRON = "_dryrun";

// ── Synthetic bhavcopy builders ──────────────────────────────
const COLS = [
  "SYMBOL", "SERIES", "DATE1", "PREV_CLOSE", "OPEN_PRICE", "HIGH_PRICE",
  "LOW_PRICE", "LAST_PRICE", "CLOSE_PRICE", "AVG_PRICE", "TTL_TRD_QNTY",
  "TURNOVER_LACS", "NO_OF_TRADES", "DELIV_QTY", "DELIV_PER", "ISIN",
];

function row(i: number, overrides: Partial<Record<string, string>> = {}): string {
  const base: Record<string, string> = {
    SYMBOL: `TEST${String(i).padStart(4, "0")}`,
    SERIES: "EQ",
    DATE1: "01-Jan-1990",
    PREV_CLOSE: "100",
    OPEN_PRICE: "101",
    HIGH_PRICE: "105",
    LOW_PRICE: "99",
    LAST_PRICE: "103",
    CLOSE_PRICE: "103",
    AVG_PRICE: "102",
    TTL_TRD_QNTY: "10000",
    TURNOVER_LACS: "1030",
    NO_OF_TRADES: "500",
    DELIV_QTY: "5000",
    DELIV_PER: "50",
    ISIN: "INE000A01001",
  };
  return COLS.map((c) => overrides[c] ?? base[c]).join(",");
}

function csv(header: string, rows: string[]): string {
  return [header, ...rows].join("\n");
}

const NORMAL_HEADER = COLS.join(",");
// GUARD 1 trigger: CLOSE_PRICE renamed → the parser's column vanishes.
const RENAMED_HEADER = COLS.map((c) =>
  c === "CLOSE_PRICE" ? "CLOSING_PRICE" : c,
).join(",");

function buildNormalCsv(n: number): string {
  return csv(NORMAL_HEADER, Array.from({ length: n }, (_, i) => row(i)));
}
function buildRenamedCsv(n: number): string {
  return csv(RENAMED_HEADER, Array.from({ length: n }, (_, i) => row(i)));
}
// GUARD 2 trigger: 20 of 100 EQ rows have an empty CLOSE_PRICE → NaN → skipped.
function buildHighSkipCsv(): string {
  const rows = Array.from({ length: 100 }, (_, i) =>
    i < 20 ? row(i, { CLOSE_PRICE: "" }) : row(i),
  );
  return csv(NORMAL_HEADER, rows);
}

// ── Tiny assertion harness ───────────────────────────────────
const results: { ok: boolean; name: string; got?: unknown }[] = [];
function check(name: string, ok: boolean, got?: unknown) {
  results.push({ ok, name, got });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}

async function sentinelDateRow(guardType: string) {
  return prisma.ingestionError.findFirst({
    where: { runRef: { startsWith: SENTINEL_RUNREF_PREFIX }, guardType: guardType as never },
  });
}

async function cleanup() {
  await prisma.ingestionError.deleteMany({
    where: {
      OR: [
        { cron: SENTINEL_CRON },
        { runRef: { startsWith: SENTINEL_RUNREF_PREFIX } },
      ],
    },
  });
}

async function main() {
  const provider = new NseBhavcopyCsvProvider();
  await cleanup(); // idempotent re-runs

  // ── 1. NORMAL DAY — ZERO false positives ──
  console.log("\n[1] Normal ~202-row day — expect ZERO flags");
  const normalPrices = await provider.processBhavcopyBody(buildNormalCsv(202), SENTINEL_DATE);
  const afterNormal = await prisma.ingestionError.count({
    where: { runRef: { startsWith: SENTINEL_RUNREF_PREFIX } },
  });
  check("provider parses 202 healthy rows", normalPrices.length === 202, normalPrices.length);
  check("provider guards write 0 rows on a healthy day", afterNormal === 0, afterNormal);
  // cron-guard detection on a healthy batch (predicates = the real logic):
  check("count(202) clean", classifyCount(202) === null);
  check("prevClose null-rate ~2% clean", checkNullRate(4, 202, PREV_CLOSE_NULL_MAX) === null);
  check("tradedValue null-rate ~4% clean", checkNullRate(8, 202, TRADED_VALUE_NULL_MAX) === null);
  check("close 103 in range", checkCloseRange(103) === false);
  check("day move +3% clean", checkContinuity(0.03) === false);

  // ── 2. SHAPE breach — REJECT (throw) + flag, blocks data ──
  console.log("\n[2] Renamed column (CLOSE_PRICE→CLOSING_PRICE) — expect REJECT + critical flag");
  let threw = false;
  try {
    await provider.processBhavcopyBody(buildRenamedCsv(202), SENTINEL_DATE);
  } catch {
    threw = true;
  }
  check("shape breach THROWS (data rejected, never inserted)", threw);
  const shapeRow = await sentinelDateRow("shape");
  check("shape row written", !!shapeRow);
  check("shape severity=critical", shapeRow?.severity === "critical", shapeRow?.severity);
  check("shape resolutionPath=source_code", shapeRow?.resolutionPath === "source_code", shapeRow?.resolutionPath);
  check("shape observed names the missing column", !!shapeRow?.observed.includes("CLOSE_PRICE"), shapeRow?.observed);

  // ── 3. SKIP-RATE breach — flag (no throw, partial data lands) ──
  console.log("\n[3] 20% of EQ rows un-parseable — expect HIGH skip flag, data still lands");
  const skipPrices = await provider.processBhavcopyBody(buildHighSkipCsv(), SENTINEL_DATE);
  check("skip breach does NOT throw (lands the good 80 rows)", skipPrices.length === 80, skipPrices.length);
  const skipRow = await sentinelDateRow("null_rate");
  check("skip row written", !!skipRow);
  check("skip severity=high", skipRow?.severity === "high", skipRow?.severity);
  check("skip observed shows 20/100", !!skipRow?.observed.includes("20/100"), skipRow?.observed);

  // ── 4. COUNT — truncated/duplicated bands (detection + mapping) ──
  console.log("\n[4] Count bands — truncated 12-row, low 170, dup 300");
  check("count(12) → high (truncated)", classifyCount(12)?.severity === "high", classifyCount(12));
  check("count(170) → medium (investigate)", classifyCount(170)?.severity === "medium", classifyCount(170));
  check("count(300) → high (duplication)", classifyCount(300)?.severity === "high", classifyCount(300));
  await reportIngestionError({
    source: "nse-bhavcopy-csv", cron: SENTINEL_CRON, guardType: "count",
    targetTable: "DailyPrice", severity: "high", resolutionPath: "source_code",
    expected: "150–250 rows inserted (≈202 universe)", observed: "12 rows inserted",
    detail: "below floor", runRef: "1990-01-01:nse-bhavcopy-csv",
  });
  const countRow = await prisma.ingestionError.findFirst({ where: { cron: SENTINEL_CRON, guardType: "count" } });
  check("count row maps high/source_code", countRow?.severity === "high" && countRow?.resolutionPath === "source_code");

  // ── 5. RANGE — injected out-of-bounds close (detection + admin_fill) ──
  console.log("\n[5] Out-of-range close — expect MEDIUM, admin_fill (fill-button path)");
  check(`close ${CLOSE_MIN / 10} below floor`, checkCloseRange(CLOSE_MIN / 10) === true);
  check(`close ${CLOSE_MAX * 1.25} above ceiling`, checkCloseRange(CLOSE_MAX * 1.25) === true);
  check("close 2500 in range", checkCloseRange(2500) === false);
  await reportIngestionError({
    source: "nse-bhavcopy-csv", cron: SENTINEL_CRON, guardType: "range",
    targetTable: "DailyPrice", targetField: "close", targetEntity: "TESTRANGE",
    severity: "medium", resolutionPath: "admin_fill",
    expected: `close in [${CLOSE_MIN}, ${CLOSE_MAX}]`, observed: "close=0.0003",
    runRef: "1990-01-01:nse-bhavcopy-csv",
  });
  const rangeRow = await prisma.ingestionError.findFirst({ where: { cron: SENTINEL_CRON, guardType: "range" } });
  check("range row maps medium/admin_fill", rangeRow?.severity === "medium" && rangeRow?.resolutionPath === "admin_fill");

  // ── 6. CONTINUITY — >20% mover, but NOT the split-gate (>50%) ──
  console.log("\n[6] Suspicious mover — expect LOW flag at 25%, silent at 55% (split-gate's job)");
  check("move 25% flagged", checkContinuity(0.25) === true);
  check("move -30% flagged", checkContinuity(-0.3) === true);
  check("move 15% silent (below band)", checkContinuity(0.15) === false);
  check("move 55% silent (split-gate handles)", checkContinuity(0.55) === false);
  await reportIngestionError({
    source: "nse-bhavcopy-csv", cron: SENTINEL_CRON, guardType: "continuity",
    targetTable: "DailyPrice", targetField: "close", targetEntity: "TESTMOVE",
    severity: "low", resolutionPath: "source_code",
    expected: "|day move| < 20% (or a known split > 50%)", observed: "25.0% (100→125)",
    runRef: "1990-01-01:nse-bhavcopy-csv",
  });
  const contRow = await prisma.ingestionError.findFirst({ where: { cron: SENTINEL_CRON, guardType: "continuity" } });
  check("continuity row maps low/source_code", contRow?.severity === "low" && contRow?.resolutionPath === "source_code");

  // ── 7. DEDUP — same breach twice = 1 row (occurrences++), distinct entity = new row ──
  console.log("\n[7] Dedup — same violation twice collapses; distinct entity opens a new row");
  await cleanup(); // clear the sentinel-cron rows from 4–6 first
  const dedupArgs = {
    source: "nse-bhavcopy-csv", cron: SENTINEL_CRON, guardType: "range" as const,
    targetTable: "DailyPrice", targetField: "close", targetEntity: "DUP1",
    severity: "medium" as const, resolutionPath: "admin_fill" as const,
    expected: "close in [0.01, 200000]", observed: "close=0.001", runRef: "1990-01-01:x",
  };
  await reportIngestionError(dedupArgs);
  await reportIngestionError({ ...dedupArgs, observed: "close=0.002" });
  const dup1 = await prisma.ingestionError.findMany({ where: { cron: SENTINEL_CRON, targetEntity: "DUP1" } });
  check("two identical reports → 1 row", dup1.length === 1, dup1.length);
  check("occurrences incremented to 2", dup1[0]?.occurrences === 2, dup1[0]?.occurrences);
  check("observed refreshed to latest", dup1[0]?.observed === "close=0.002", dup1[0]?.observed);
  await reportIngestionError({ ...dedupArgs, targetEntity: "DUP2" });
  const allDup = await prisma.ingestionError.findMany({ where: { cron: SENTINEL_CRON, guardType: "range" } });
  check("distinct entity → separate row (2 total)", allDup.length === 2, allDup.length);

  // ── Clean up all sentinel artifacts ──
  await cleanup();
  const leftover = await prisma.ingestionError.count({
    where: { OR: [{ cron: SENTINEL_CRON }, { runRef: { startsWith: SENTINEL_RUNREF_PREFIX } }] },
  });
  check("cleanup removed all sentinel rows", leftover === 0, leftover);

  // ── Summary ──
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await prisma.$disconnect();
  if (passed !== results.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
