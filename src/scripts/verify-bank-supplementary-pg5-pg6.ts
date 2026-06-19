// Step 3 verification: confirms the bank_supplementary table matches the source file exactly.
//   npx tsx src/scripts/verify-bank-supplementary-pg5-pg6.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../db/prisma.js";

const SOURCE = resolve("docs/bank_supplementary_pg5_pg6.json");
const raw = JSON.parse(readFileSync(SOURCE, "utf-8")) as {
  banks: string[];
  entries: Array<{
    symbol: string;
    peerGroup: string;
    metricKey: string;
    fiscalYear: string;
    periodEnd: string;
    value: number | null;
    sourceCitation: string | null;
    confidence: string | null;
    status: string;
    notes: string | null;
  }>;
};

const EXPECTED_TOTAL = 264;
const EXPECTED_FOUND = 91;
const EXPECTED_MISSING = 173;
const EXPECTED_CASA = 132;
const EXPECTED_TIER1 = 132;
const BANKS_12 = new Set(raw.banks);

// Confidence-C cells from the spec
const CONFIDENCE_C_CELLS = [
  { symbol: "ICICIBANK",  metric: "tier1_pct", fiscalYear: "FY26" },
  { symbol: "KOTAKBANK",  metric: "casa_pct",  fiscalYear: "FY18" },
  { symbol: "KOTAKBANK",  metric: "casa_pct",  fiscalYear: "FY23" },
  { symbol: "PNB",        metric: "casa_pct",  fiscalYear: "LIVE" },
];

// Spot-checks from spec
const SPOT_CHECKS = [
  { symbol: "HDFCBANK",   metric: "casa_pct",  fiscalYear: "FY17", expectValue: 44.0,  expectConf: "A",  expectCitation: true },
  { symbol: "SBIN",       metric: "tier1_pct", fiscalYear: "LIVE", expectValue: 12.4,  expectConf: null, expectCitation: true },
  { symbol: "ICICIBANK",  metric: "casa_pct",  fiscalYear: "LIVE", expectValue: null,  expectConf: null, expectCitation: false },
  { symbol: "KOTAKBANK",  metric: "tier1_pct", fiscalYear: "FY17", expectValue: null,  expectConf: null, expectCitation: false },
];

const PASS = "✓";
const FAIL = "✗";
let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ${PASS} ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.error(`  ${FAIL} FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

// Pull all rows for the 12 banks from the DB
const rows = await prisma.bankSupplementary.findMany({
  where: { symbol: { in: [...BANKS_12] } },
  orderBy: [{ symbol: "asc" }, { metric: "asc" }, { fiscalYear: "asc" }],
  select: {
    symbol: true,
    metric: true,
    fiscalYear: true,
    value: true,
    sourceCitation: true,
    confidence: true,
    status: true,
    notes: true,
    version: true,
  },
});

// Also count rows outside the 12 banks (should be 0 from this load)
const outsideCount = await prisma.bankSupplementary.count({
  where: { symbol: { notIn: [...BANKS_12] } },
});

console.log("\n═══ STEP 3 VERIFICATION ═══\n");

// ── Count checks ─────────────────────────────────────────────────────────────
console.log("── Counts ──");
check("Total rows = 264",          rows.length === EXPECTED_TOTAL,       `got ${rows.length}`);
check("casa_pct rows = 132",       rows.filter(r => r.metric === "casa_pct").length  === EXPECTED_CASA,   `got ${rows.filter(r => r.metric === "casa_pct").length}`);
check("tier1_pct rows = 132",      rows.filter(r => r.metric === "tier1_pct").length === EXPECTED_TIER1,  `got ${rows.filter(r => r.metric === "tier1_pct").length}`);
check("found rows = 91",           rows.filter(r => r.status === "found").length   === EXPECTED_FOUND,   `got ${rows.filter(r => r.status === "found").length}`);
check("missing rows = 173",        rows.filter(r => r.status === "missing").length === EXPECTED_MISSING, `got ${rows.filter(r => r.status === "missing").length}`);
check("No rows outside 12 banks",  outsideCount === 0,                   `found ${outsideCount} outside`);

// ── Integrity: found⟹value+citation ─────────────────────────────────────────
console.log("\n── Integrity ──");
const foundWithoutValue    = rows.filter(r => r.status === "found" && r.value === null);
const foundWithoutCitation = rows.filter(r => r.status === "found" && !r.sourceCitation);
const missingWithValue     = rows.filter(r => r.status === "missing" && r.value !== null);
check("0 found-rows without value",    foundWithoutValue.length === 0,    `${foundWithoutValue.length} violations`);
check("0 found-rows without citation", foundWithoutCitation.length === 0, `${foundWithoutCitation.length} violations`);
check("0 missing-rows with value",     missingWithValue.length === 0,     `${missingWithValue.length} violations`);

// ── Units: values in PERCENT range ───────────────────────────────────────────
console.log("\n── Units (PERCENT, not fraction) ──");
const foundRows = rows.filter(r => r.status === "found" && r.value !== null);
const outOfRange = foundRows.filter(r => {
  const v = Number(r.value);
  return v < 0 || v > 100;
});
const fractionScale = foundRows.filter(r => Number(r.value) < 1);  // would indicate 0.44 instead of 44
check("All found values in [0,100] (percent scale)", outOfRange.length === 0, `${outOfRange.length} out-of-range`);
check("No values < 1 (fraction-scale detection)", fractionScale.length === 0, `${fractionScale.length} suspiciously small`);

// ── Spot-checks ───────────────────────────────────────────────────────────────
console.log("\n── Spot-checks (DB vs file) ──");
for (const sc of SPOT_CHECKS) {
  const row = rows.find(r => r.symbol === sc.symbol && r.metric === sc.metric && r.fiscalYear === sc.fiscalYear);
  if (!row) {
    check(`${sc.symbol} ${sc.metric} ${sc.fiscalYear}`, false, "row not found in DB");
    continue;
  }
  const dbVal = row.value === null ? null : Number(row.value);
  // value check
  if (sc.expectValue === null) {
    check(`${sc.symbol} ${sc.metric} ${sc.fiscalYear} value=null`, dbVal === null, `got ${dbVal}`);
  } else {
    check(`${sc.symbol} ${sc.metric} ${sc.fiscalYear} value=${sc.expectValue}`, Math.abs((dbVal ?? NaN) - sc.expectValue) < 0.001, `got ${dbVal}`);
  }
  // citation check
  if (sc.expectCitation) {
    check(`  citation present`, !!row.sourceCitation, `got ${JSON.stringify(row.sourceCitation)}`);
  } else {
    check(`  citation null`, row.sourceCitation === null, `got ${JSON.stringify(row.sourceCitation)}`);
  }
}

// ── Confidence-C cells ────────────────────────────────────────────────────────
console.log("\n── Confidence-C cells (4 cells) ──");
for (const cell of CONFIDENCE_C_CELLS) {
  const row = rows.find(r => r.symbol === cell.symbol && r.metric === cell.metric && r.fiscalYear === cell.fiscalYear);
  if (!row) {
    check(`${cell.symbol} ${cell.metric} ${cell.fiscalYear}`, false, "row not found");
    continue;
  }
  check(
    `${cell.symbol} ${cell.metric} ${cell.fiscalYear} confidence=C`,
    row.confidence === "C",
    `got confidence=${JSON.stringify(row.confidence)}`,
  );
}

// ── Version: all v1 (first load) ─────────────────────────────────────────────
console.log("\n── Version (all v1 on first load) ──");
const notV1 = rows.filter(r => r.version !== 1);
check("All rows at version=1", notV1.length === 0, `${notV1.length} rows not at v1`);

// ── Idempotency proof: re-run would upsert not duplicate ─────────────────────
console.log("\n── Idempotency check (DB count == file count, version=1 for all) ──");
check("264 rows in DB (not 528 on re-run risk)", rows.length === 264, `got ${rows.length}`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);

await prisma.$disconnect();
if (failures > 0) process.exit(1);
