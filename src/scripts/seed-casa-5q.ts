// src/scripts/seed-casa-5q.ts
//
// IDEMPOTENT SEED — 5 quarters of quarterly CASA data (Q4FY25–Q4FY26) for 12 banks.
// Source: docs/CASA_Ratios.json (58 sourced cells + 2 estimated ICICI cells at confidence=C).
//
// USAGE:
//   npx tsx src/scripts/seed-casa-5q.ts           → DRY-RUN only (prints plan, no writes)
//   npx tsx src/scripts/seed-casa-5q.ts --write   → durable writes + readback + idempotency check
//
// DESIGN: calls injectLiveCasa() directly on the Prisma client, NOT via HTTP — so NO
// rescore cascade fires. The HTTP controller layer (which calls handlePgRescore) is
// completely bypassed. Data-only write, same BankSupplementary supersede path as the endpoint.

import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { injectLiveCasa } from "../ingestions/bank-supplementary/inject-casa.js";

const DRY_RUN = !process.argv.includes("--write");

// ── STEP 0: NAME → SYMBOL MAP ────────────────────────────────────────────────
const NAME_TO_SYMBOL: Record<string, string> = {
  SBI:                   "SBIN",
  Bank_of_Baroda:        "BANKBARODA",
  Punjab_National_Bank:  "PNB",
  Canara_Bank:           "CANBK",
  Union_Bank_of_India:   "UNIONBANK",
  Indian_Bank:           "INDIANB",
  HDFC_Bank:             "HDFCBANK",
  ICICI_Bank:            "ICICIBANK",
  Axis_Bank:             "AXISBANK",
  Kotak_Mahindra_Bank:   "KOTAKBANK",
  IndusInd_Bank:         "INDUSINDBK",
  Federal_Bank:          "FEDERALBNK",
};

// ── STEP 0: QUARTER → (fiscalYear, quarter, periodEnd) MAP ──────────────────
const QUARTER_MAP: Record<string, { fiscalYear: string; quarter: string; periodEnd: string }> = {
  Q4FY25: { fiscalYear: "FY25", quarter: "Q4", periodEnd: "2025-03-31" },
  Q1FY26: { fiscalYear: "FY26", quarter: "Q1", periodEnd: "2025-06-30" },
  Q2FY26: { fiscalYear: "FY26", quarter: "Q2", periodEnd: "2025-09-30" },
  Q3FY26: { fiscalYear: "FY26", quarter: "Q3", periodEnd: "2025-12-31" },
  Q4FY26: { fiscalYear: "FY26", quarter: "Q4", periodEnd: "2026-03-31" },
};

const QUARTER_KEYS = ["Q4FY25", "Q1FY26", "Q2FY26", "Q3FY26", "Q4FY26"] as const;

// ── STEP 1 + 2: FULL SEED DATA (sourced + estimated) ────────────────────────
// Each cell: { value, confidence, sourceCitation, notes?, estimated? }
// ICICI Q2/Q3 are estimated (confidence=C, explicit estimate citation).
// PNB carries the global-basis note in every citation.
// IndusInd Q2FY26 → confidence=B (single decimal, not separately confirmed).

const PNB_BASE_CITATION = "PNB concall transcripts Q1/Q2 FY26; Q3FY26 press release; Directors' Report FY26; Groww citing Q4FY25 results";
const PNB_BASIS_NOTE    = "[BASIS EXCEPTION: Global CASA, not domestic-only — PNB does not disclose domestic-only CASA quarterly; global ≈ domestic given ~8% overseas deposits.]";

function pnbCitation(q: string): string {
  return `${PNB_BASIS_NOTE} ${PNB_BASE_CITATION}`;
}

const ICICI_EST_CITATION = (q: string, v: number) =>
  `ESTIMATE — ICICI period-end CASA ${q}, investor PDFs inaccessible; value ${v}% derived from pattern (Q1FY26 41.2% → Q4FY26 41.4% band). NOT a primary disclosure. Replace when official filing is accessible.`;

const ICICI_EST_NOTES = "estimated_cell: true; basis=pattern-derived; replace when ICICI investor PDF accessible";

interface CellDef {
  value: number;
  confidence: "A" | "B" | "C";
  sourceCitation: string;
  notes?: string;
  estimated?: true;
}

// BANK DATA: keyed by JSON bank name, then by quarter key
const SEED_DATA: Record<string, Record<string, CellDef>> = {
  SBI: {
    Q4FY25: { value: 39.97, confidence: "A", sourceCitation: "SBI official press releases + Annual Report FY25" },
    Q1FY26: { value: 39.36, confidence: "A", sourceCitation: "SBI official press releases + Annual Report FY25" },
    Q2FY26: { value: 39.63, confidence: "A", sourceCitation: "SBI official press releases + Annual Report FY25" },
    Q3FY26: { value: 39.13, confidence: "A", sourceCitation: "SBI official press releases + Annual Report FY25" },
    Q4FY26: { value: 39.46, confidence: "A", sourceCitation: "SBI official press releases + Annual Report FY25" },
  },
  Bank_of_Baroda: {
    Q4FY25: { value: 39.97, confidence: "A", sourceCitation: "BoB official press releases; Q3FY26 from Business Standard citing official filing" },
    Q1FY26: { value: 39.33, confidence: "A", sourceCitation: "BoB official press releases; Q3FY26 from Business Standard citing official filing" },
    Q2FY26: { value: 38.42, confidence: "A", sourceCitation: "BoB official press releases; Q3FY26 from Business Standard citing official filing" },
    Q3FY26: { value: 38.45, confidence: "A", sourceCitation: "BoB official press releases; Business Standard citing official filing" },
    Q4FY26: { value: 38.90, confidence: "A", sourceCitation: "BoB official press releases; Q3FY26 from Business Standard citing official filing" },
  },
  Punjab_National_Bank: {
    Q4FY25: { value: 37.95, confidence: "A", sourceCitation: pnbCitation("Q4FY25"), notes: "PNB basis exception: global CASA ratio (global ≈ domestic; ~8% overseas deposits)" },
    Q1FY26: { value: 36.99, confidence: "A", sourceCitation: pnbCitation("Q1FY26"), notes: "PNB basis exception: global CASA ratio (global ≈ domestic; ~8% overseas deposits)" },
    Q2FY26: { value: 37.29, confidence: "A", sourceCitation: pnbCitation("Q2FY26"), notes: "PNB basis exception: global CASA ratio (global ≈ domestic; ~8% overseas deposits)" },
    Q3FY26: { value: 37.10, confidence: "A", sourceCitation: pnbCitation("Q3FY26"), notes: "PNB basis exception: global CASA ratio (global ≈ domestic; ~8% overseas deposits)" },
    Q4FY26: { value: 37.00, confidence: "A", sourceCitation: pnbCitation("Q4FY26"), notes: "PNB basis exception: global CASA ratio (global ≈ domestic; ~8% overseas deposits)" },
  },
  Canara_Bank: {
    Q4FY25: { value: 31.20, confidence: "A", sourceCitation: "ICRA rating rationale reports; ICICIDirect quarterly updates" },
    Q1FY26: { value: 29.60, confidence: "A", sourceCitation: "ICRA rating rationale reports; ICICIDirect quarterly updates" },
    Q2FY26: { value: 30.69, confidence: "A", sourceCitation: "ICRA rating rationale reports; ICICIDirect quarterly updates" },
    Q3FY26: { value: 29.52, confidence: "A", sourceCitation: "ICRA rating rationale reports; ICICIDirect quarterly updates" },
    Q4FY26: { value: 31.03, confidence: "A", sourceCitation: "ICRA rating rationale reports; ICICIDirect quarterly updates" },
  },
  Union_Bank_of_India: {
    Q4FY25: { value: 32.51, confidence: "A", sourceCitation: "JM Financial Q1FY26; ICRA Q2FY26; Business Standard Q3/Q4 FY26; Union Bank press release Q4FY26" },
    Q1FY26: { value: 32.50, confidence: "A", sourceCitation: "JM Financial Q1FY26; ICRA Q2FY26; Business Standard Q3/Q4 FY26; Union Bank press release Q4FY26" },
    Q2FY26: { value: 32.56, confidence: "A", sourceCitation: "JM Financial Q1FY26; ICRA Q2FY26; Business Standard Q3/Q4 FY26; Union Bank press release Q4FY26" },
    Q3FY26: { value: 33.95, confidence: "A", sourceCitation: "Business Standard Q3/Q4 FY26; Union Bank press release Q4FY26" },
    Q4FY26: { value: 35.21, confidence: "A", sourceCitation: "Union Bank press release Q4FY26; verified: CASA ₹4,59,988cr / deposits ₹13,06,297cr = 35.21%" },
  },
  Indian_Bank: {
    Q4FY25: { value: 40.17, confidence: "A", sourceCitation: "Business Standard Q1FY26; Indian Bank official press releases Q2–Q4 FY26" },
    Q1FY26: { value: 38.97, confidence: "A", sourceCitation: "Business Standard Q1FY26; Indian Bank official press releases Q2–Q4 FY26" },
    Q2FY26: { value: 38.87, confidence: "A", sourceCitation: "Indian Bank official press releases Q2–Q4 FY26" },
    Q3FY26: { value: 39.08, confidence: "A", sourceCitation: "Indian Bank official press releases Q2–Q4 FY26" },
    Q4FY26: { value: 39.67, confidence: "A", sourceCitation: "Indian Bank official press releases Q2–Q4 FY26" },
  },
  HDFC_Bank: {
    Q4FY25: { value: 34.80, confidence: "A", sourceCitation: "HDFC Bank SEC Form 6-K filings Q1–Q4 FY26; ratios computed from disclosed balances. Q4FY25: ₹9,446bn CASA / ₹27,147bn = 34.80%" },
    Q1FY26: { value: 33.90, confidence: "A", sourceCitation: "HDFC Bank SEC Form 6-K filings Q1 FY26; ratio computed from disclosed balances" },
    Q2FY26: { value: 33.90, confidence: "A", sourceCitation: "HDFC Bank SEC Form 6-K filings Q2 FY26; ratio computed from disclosed balances" },
    Q3FY26: { value: 33.60, confidence: "A", sourceCitation: "HDFC Bank SEC Form 6-K filings Q3 FY26; ratio computed from disclosed balances" },
    Q4FY26: { value: 34.10, confidence: "A", sourceCitation: "HDFC Bank SEC Form 6-K filings Q4 FY26; ₹10,605bn CASA / ₹31,055bn = 34.15% → 34.10" },
  },
  ICICI_Bank: {
    Q4FY25: { value: 41.80, confidence: "A", sourceCitation: "Elara broker note Q4FY25 citing ICICI investor materials (41.8% period-end confirmed)" },
    Q1FY26: { value: 41.20, confidence: "B", sourceCitation: "ICRA rating report Q1FY26 (41.2% period-end CASA)" },
    Q2FY26: {
      value: 40.80, confidence: "C",
      sourceCitation: ICICI_EST_CITATION("Q2FY26 (Sep 2025)", 40.80),
      notes: ICICI_EST_NOTES,
      estimated: true,
    },
    Q3FY26: {
      value: 40.50, confidence: "C",
      sourceCitation: ICICI_EST_CITATION("Q3FY26 (Dec 2025)", 40.50),
      notes: ICICI_EST_NOTES,
      estimated: true,
    },
    Q4FY26: { value: 41.40, confidence: "A", sourceCitation: "Multibagg investor slide Q4FY26 (41.4% period-end CASA confirmed)" },
  },
  Axis_Bank: {
    Q4FY25: { value: 41, confidence: "A", sourceCitation: "Axis Bank official press release Q4FY25 (axisbank.com). MEB (month-end balance) CASA = period-end by definition; Axis reports in whole integer %." },
    Q1FY26: { value: 40, confidence: "A", sourceCitation: "Axis Bank official press release Q1FY26 (axisbank.com). MEB (month-end balance) CASA = period-end by definition." },
    Q2FY26: { value: 40, confidence: "A", sourceCitation: "Axis Bank official press release Q2FY26 (axisbank.com). MEB (month-end balance) CASA = period-end by definition." },
    Q3FY26: { value: 39, confidence: "A", sourceCitation: "Axis Bank official press release Q3FY26 (axisbank.com). MEB (month-end balance) CASA = period-end by definition." },
    Q4FY26: { value: 40, confidence: "A", sourceCitation: "Axis Bank official press release Q4FY26 (axisbank.com). MEB (month-end balance) CASA = period-end by definition." },
  },
  Kotak_Mahindra_Bank: {
    Q4FY25: { value: 43.00, confidence: "A", sourceCitation: "Kotak Mahindra Bank official press releases Q4FY25" },
    Q1FY26: { value: 40.90, confidence: "A", sourceCitation: "Kotak Mahindra Bank official press releases Q1FY26" },
    Q2FY26: { value: 42.30, confidence: "A", sourceCitation: "Kotak Mahindra Bank official press releases Q2FY26" },
    Q3FY26: { value: 41.30, confidence: "A", sourceCitation: "Kotak Mahindra Bank official press releases Q3FY26" },
    Q4FY26: { value: 43.30, confidence: "A", sourceCitation: "Kotak Mahindra Bank official press releases Q4FY26" },
  },
  IndusInd_Bank: {
    Q4FY25: { value: 32.80, confidence: "A", sourceCitation: "Business Standard Q4FY25 (32.8% confirmed); period-end CASA / period-end total deposits" },
    Q1FY26: { value: 31.48, confidence: "A", sourceCitation: "IndusInd Bank official press release Q1FY26" },
    Q2FY26: { value: 31.00, confidence: "B", sourceCitation: "IndusInd Bank Q2FY26 disclosure — stated as 31% (single decimal, not separately confirmed to sub-integer precision)", notes: "soft_cell: value stated as 31% in bank disclosures; single decimal not separately confirmed" },
    Q3FY26: { value: 30.30, confidence: "A", sourceCitation: "IndusInd Bank official press release Q3FY26" },
    Q4FY26: { value: 31.24, confidence: "A", sourceCitation: "Business Standard + IndusInd Bank Q4FY26 detailed release; verified: ₹1,24,933cr CASA / ₹3,99,931cr deposits = 31.24%" },
  },
  Federal_Bank: {
    Q4FY25: { value: 30.23, confidence: "A", sourceCitation: "Federal Bank Q4FY25 concall transcript (30.23% MD-stated)" },
    Q1FY26: { value: 30.35, confidence: "A", sourceCitation: "Federal Bank Q1FY26 press release; computed: ₹87,236cr / ₹2,87,436cr = 30.35%" },
    Q2FY26: { value: 31.01, confidence: "A", sourceCitation: "Federal Bank Q2FY26 press release (31.01%)" },
    Q3FY26: { value: 32.10, confidence: "A", sourceCitation: "Scanx/Angel One citing Federal Bank Q3FY26 results (32.10%)" },
    Q4FY26: { value: 32.94, confidence: "A", sourceCitation: "Federal Bank Q4FY26 press release (32.94%)" },
  },
};

// ── HELPERS ──────────────────────────────────────────────────────────────────
function hr(char = "─", n = 90) { return char.repeat(n); }
function pad(s: string | number, w: number) { return String(s).padEnd(w); }
function padL(s: string | number, w: number) { return String(s).padStart(w); }

async function main() {
  console.log(hr("═"));
  console.log(DRY_RUN
    ? "  SEED CASA 5Q — DRY-RUN (no writes). Run with --write to commit."
    : "  SEED CASA 5Q — DURABLE WRITE MODE");
  console.log(hr("═"));

  // ── STEP 0: RESOLVE SYMBOLS → STOCK IDs ─────────────────────────────────
  console.log("\n── STEP 0: Symbol → stockId resolution ─────────────────────────────────");
  const symbolList = Object.values(NAME_TO_SYMBOL);
  const stockRows = await prisma.stock.findMany({
    where: { symbol: { in: symbolList } },
    select: { id: true, symbol: true },
  });
  const symToId = new Map(stockRows.map((s) => [s.symbol, s.id]));

  let mapFailed = false;
  for (const [name, sym] of Object.entries(NAME_TO_SYMBOL)) {
    const id = symToId.get(sym);
    const ok = id ? "✓" : "✗ FLAG: NOT FOUND";
    console.log(`  ${pad(name, 24)} → ${pad(sym, 12)} ${ok}${id ? `(${id.slice(0, 8)}…)` : ""}`);
    if (!id) mapFailed = true;
  }
  if (mapFailed) {
    console.error("\n  ✗ One or more symbols failed to resolve. Aborting.");
    process.exit(1);
  }

  // ── STEP 0: QUARTER MAP ──────────────────────────────────────────────────
  console.log("\n── STEP 0: Quarter → (fiscalYear, quarter, periodEnd) map ──────────────");
  for (const [qk, v] of Object.entries(QUARTER_MAP)) {
    console.log(`  ${pad(qk, 8)} → fiscalYear=${v.fiscalYear}  quarter=${v.quarter}  periodEnd=${v.periodEnd}`);
  }

  // ── STEP 0: BAND VALIDATION [15, 60] ────────────────────────────────────
  console.log("\n── STEP 0: Band validation [15, 60] ────────────────────────────────────");
  let bandFailed = false;
  for (const [bankName, quarters] of Object.entries(SEED_DATA)) {
    for (const [qk, cell] of Object.entries(quarters)) {
      if (cell.value < 15 || cell.value > 60) {
        console.error(`  ✗ FLAG OUT-OF-BAND: ${bankName} ${qk} = ${cell.value}%`);
        bandFailed = true;
      }
    }
  }
  if (!bandFailed) {
    console.log("  ✓ All 60 values within [15, 60]%. No band violations.");
  } else {
    console.error("  ✗ Band violations found — fix before seeding.");
    process.exit(1);
  }

  // ── STEP 1: ESTIMATED CELLS REPORT ──────────────────────────────────────
  console.log("\n── STEP 1: Estimated cells (confidence=C) ──────────────────────────────");
  const ICICI_CELLS = SEED_DATA["ICICI_Bank"];
  const estCells = [
    { qk: "Q2FY26", cell: ICICI_CELLS["Q2FY26"] },
    { qk: "Q3FY26", cell: ICICI_CELLS["Q3FY26"] },
  ];
  for (const { qk, cell } of estCells) {
    const qm = QUARTER_MAP[qk];
    console.log(`  ⚠ ICICIBANK ${qk} (${qm.fiscalYear}/${qm.quarter}) — ESTIMATED CELL`);
    console.log(`    value      : ${cell.value}%`);
    console.log(`    confidence : ${cell.confidence} (weakest — operator must verify before trusting)`);
    console.log(`    citation   : ${cell.sourceCitation}`);
    console.log(`    notes      : ${cell.notes}`);
    console.log(`    status     : SEEDED AS "found" WITH C-confidence — drives score for this quarter but flagged`);
  }
  console.log(`\n  ICICIBANK full 5-quarter series being seeded:`);
  for (const qk of QUARTER_KEYS) {
    const c = ICICI_CELLS[qk];
    const qm = QUARTER_MAP[qk];
    const tag = c.estimated ? " ← ESTIMATED (C)" : ` (${c.confidence})`;
    console.log(`    ${qm.fiscalYear}/${qm.quarter}  ${padL(c.value, 6)}%${tag}`);
  }

  // ── STEP 2: DRY-RUN CENSUS ───────────────────────────────────────────────
  console.log("\n── STEP 2 / 3: Full seed plan (dry-run census) ─────────────────────────");
  console.log(`  ${pad("Bank (symbol)", 12)} ${pad("FY/Q", 7)} ${padL("Value", 6)}  Conf  Status    Citation (truncated)`);
  console.log("  " + hr("-", 88));

  let totalCells = 0;
  let estimatedCount = 0;
  let softCount = 0;
  const bankSummaries: { bankName: string; symbol: string; cells: number }[] = [];

  for (const [bankName, quarters] of Object.entries(SEED_DATA)) {
    const symbol = NAME_TO_SYMBOL[bankName];
    let bankCells = 0;
    for (const qk of QUARTER_KEYS) {
      const cell = quarters[qk];
      if (!cell) { console.log(`  !! MISSING: ${bankName} ${qk}`); continue; }
      const qm = QUARTER_MAP[qk];
      const tag = cell.estimated ? "EST(C) ⚠" : cell.confidence === "B" ? "soft(B)" : "sourced ";
      const citSnip = cell.sourceCitation.slice(0, 48) + (cell.sourceCitation.length > 48 ? "…" : "");
      console.log(`  ${pad(symbol, 12)} ${qm.fiscalYear}/${qm.quarter}  ${padL(cell.value, 6)}%  ${cell.confidence}     ${pad(tag, 9)} ${citSnip}`);
      totalCells++;
      bankCells++;
      if (cell.estimated) estimatedCount++;
      if (cell.confidence === "B") softCount++;
    }
    bankSummaries.push({ bankName, symbol, cells: bankCells });
  }

  console.log("\n── Census summary ───────────────────────────────────────────────────────");
  console.log(`  Total cells     : ${totalCells} (12 banks × 5 quarters)`);
  console.log(`  Estimated (C)   : ${estimatedCount} — ICICIBANK Q2FY26 (40.80%), Q3FY26 (40.50%) — pattern-derived, not primary`);
  console.log(`  Soft cells (B)  : ${softCount} — ICICIBANK Q1FY26 (ICRA secondary), IndusInd Q2FY26 (single-decimal disclosure)`);
  console.log(`  Sourced (A)     : ${totalCells - estimatedCount - softCount}`);
  console.log(`  Band violations : 0`);
  console.log(`  Symbol failures : 0`);
  console.log(`  PNB basis note  : Global CASA (not domestic) — documented in citation + notes for all 5 PNB cells`);
  console.log(`  Rescore cascade : NONE — seeding via injectLiveCasa() directly, NOT via HTTP controller; no handlePgRescore called`);

  if (DRY_RUN) {
    console.log("\n" + hr("═"));
    console.log("  DRY-RUN COMPLETE. No writes performed.");
    console.log("  ▶ Review the plan above, then run with --write to commit.");
    console.log(hr("═"));
    await prisma.$disconnect();
    return;
  }

  // ── STEP 3: DURABLE WRITE ────────────────────────────────────────────────
  console.log("\n" + hr("═"));
  console.log("  DURABLE WRITE — committing 60 rows to BankSupplementary…");
  console.log(hr("═"));

  const results = { inserted: 0, superseded: 0, unchanged: 0, failed: 0 };
  const failedCells: string[] = [];

  for (const [bankName, quarters] of Object.entries(SEED_DATA)) {
    const symbol = NAME_TO_SYMBOL[bankName];
    process.stdout.write(`  ${pad(symbol, 12)}`);
    for (const qk of QUARTER_KEYS) {
      const cell = quarters[qk];
      const qm = QUARTER_MAP[qk];
      const result = await injectLiveCasa({
        symbol,
        fiscalYear: qm.fiscalYear,
        quarter: qm.quarter,
        periodEnd: qm.periodEnd,
        value: cell.value,
        sourceCitation: cell.sourceCitation,
        confidence: cell.confidence,
        notes: cell.notes ?? null,
        enteredBy: "seed:casa-5q-backfill",
      });
      if (!result.ok) {
        process.stdout.write(" ✗");
        results.failed++;
        failedCells.push(`${symbol} ${qm.fiscalYear}/${qm.quarter}: ${result.errors.join("; ")}`);
      } else {
        const icon = result.action === "inserted" ? "✓" : result.action === "superseded" ? "↑" : "=";
        process.stdout.write(` ${icon}`);
        results[result.action!]++;
      }
    }
    console.log(); // newline after each bank's 5 cells
  }

  console.log(`\n── Write results ──────────────────────────────────────────────────────────`);
  console.log(`  inserted    : ${results.inserted}`);
  console.log(`  superseded  : ${results.superseded}`);
  console.log(`  unchanged   : ${results.unchanged}`);
  console.log(`  failed      : ${results.failed}`);
  if (failedCells.length) {
    console.error("\n  ✗ FAILURES:");
    for (const f of failedCells) console.error(`    ${f}`);
  }

  // ── READ-BACK ─────────────────────────────────────────────────────────────
  console.log("\n── Read-back verification (HDFCBANK, ICICIBANK, SBIN, PNB) ─────────────");
  const readBackSymbols = ["HDFCBANK", "ICICIBANK", "SBIN", "PNB"];
  for (const sym of readBackSymbols) {
    const rows = await prisma.bankSupplementary.findMany({
      where: { symbol: sym, metric: "casa_pct", quarter: { not: null } },
      orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }, { version: "desc" }],
      select: { fiscalYear: true, quarter: true, value: true, confidence: true, version: true, status: true, enteredBy: true },
    });
    // Latest version per cell
    const seen = new Set<string>();
    const latest = rows.filter((r) => {
      const k = `${r.fiscalYear}|${r.quarter}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    console.log(`\n  ${sym} (${latest.length} quarter-keyed cells):`);
    for (const r of latest) {
      console.log(`    ${r.fiscalYear}/${r.quarter}  ${padL(r.value?.toFixed(2) ?? "null", 6)}%  conf=${r.confidence}  v${r.version}  enteredBy=${r.enteredBy}`);
    }
  }

  // ── IDEMPOTENCY CHECK ─────────────────────────────────────────────────────
  console.log("\n── Idempotency check (re-seeding HDFCBANK, should all be unchanged) ─────");
  const hdfcQuarters = SEED_DATA["HDFC_Bank"];
  let idempotencyOk = true;
  for (const qk of QUARTER_KEYS) {
    const cell = hdfcQuarters[qk];
    const qm = QUARTER_MAP[qk];
    const result = await injectLiveCasa({
      symbol: "HDFCBANK", fiscalYear: qm.fiscalYear, quarter: qm.quarter, periodEnd: qm.periodEnd,
      value: cell.value, sourceCitation: cell.sourceCitation, confidence: cell.confidence,
      notes: cell.notes ?? null, enteredBy: "seed:casa-5q-backfill",
    });
    const ok = result.action === "unchanged";
    console.log(`  HDFCBANK ${qm.fiscalYear}/${qm.quarter} → ${result.action} ${ok ? "✓" : "✗ UNEXPECTED"}`);
    if (!ok) idempotencyOk = false;
  }
  console.log(idempotencyOk ? "\n  ✓ Idempotency confirmed — re-run produces zero new rows." : "\n  ✗ Idempotency FAILED — re-run created new rows.");

  // ── RESCORE CONFIRMATION ──────────────────────────────────────────────────
  console.log("\n── Rescore cascade confirmation ─────────────────────────────────────────");
  console.log("  ✓ Seed called injectLiveCasa() directly on Prisma client.");
  console.log("  ✓ HTTP controller layer (which calls handlePgRescore) was NOT used.");
  console.log("  ✓ No rescore was enqueued or executed. Historical rescore is a separate step.");

  console.log("\n" + hr("═"));
  console.log("  SEED COMPLETE.");
  console.log(hr("═"));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
