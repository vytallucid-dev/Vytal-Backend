// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// S6.2e — BSE LANE DRY RUN. Proof before any write.
//
// ⚠ THIS SCRIPT WRITES NOTHING THAT SURVIVES. It reads the database, and its one write test runs
//   inside a transaction that is ALWAYS rolled back — so the T3 guarantee is demonstrated against
//   the real table and the real constraint, without a single row persisting. That is deliberately
//   stronger than asserting the guarantee in a comment, and strictly safer than writing for real.
//
// ⚠ NOT A BUILD GATE. It reads cached BSE documents from disk and queries the database, so it must
//   never be added to `verify:copy` — see verify-build-gate-hygiene.ts.
//
//   npx tsx src/scripts/dryrun-bse-lane.ts [fixtureDir]
//
// SEVEN PROOFS:
//   1. cross-source     — 55/55 BSE cells equal what we already hold, after ÷1e7
//   2. ratio gate       — fires on AU Bank FY19 (CET1 0.0019, GNPA 0.0002, ROA exactly 0),
//                         and 2b: a CORRECT ratio is still accepted, so the gate is not just "refuse all"
//   3. tier1_ratio      — reported ABSENT, never derived from CET1 + AT1, never defaulted
//   4. period trap      — the March filing's two grains are told apart, and a swap FAILS
//   5. T3 negative test — the writer inserts nothing where NSE already holds the period
//   6. money scale      — absolute INR across three different declared roundings
//   7. the fence        — baseline diff + source-count run clean against the real tables
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma.js";
import {
  extractQuarterlyCells,
  extractFundamentalCells,
  extractBankingQuarterlyCells,
  extractBankingFundamentalCells,
} from "../ingestions/quaterly-results/bse/bse-extract.js";
import { assertPeriodAndBasis } from "../ingestions/quaterly-results/bse/bse-period-guard.js";
import {
  insertQuarterlyIfAbsent,
  type RowIdentity,
} from "../ingestions/quaterly-results/bse/bse-writer.js";
import { captureBaseline, verifyFence } from "../ingestions/quaterly-results/bse/bse-fence.js";

const FIXTURES =
  process.argv[2] ??
  "C:/Users/Punctuations/AppData/Local/Temp/claude/c--Users-Punctuations-Desktop-Vytal/5f2365f2-6a2f-42f6-a2ed-4feee93f9306/scratchpad";

const read = (rel: string): string => fs.readFileSync(path.join(FIXTURES, rel), "utf8");
const d = (s: string) => new Date(s + "T00:00:00.000Z");
const n2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(ok: boolean, label: string, detail = ""): void {
  if (ok) pass++;
  else {
    fail++;
    failures.push(`${label} ${detail}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROOF 1 — CROSS-SOURCE, 55 field checks
// ─────────────────────────────────────────────────────────────────────────────
async function proofCrossSource(): Promise<void> {
  console.log("\n── PROOF 1 · cross-source: BSE cells vs what we already hold ──────────────");

  const QUARTERLY: Array<[string, string]> = [
    ["ASIANPAINT", "N_ASIANPAINT_2022-03-31_std.xml"],
    ["BPCL", "N_BPCL_2022-03-31_std.xml"],
    ["SUNPHARMA", "N_SUNPHARMA_2022-03-31_std.xml"],
    ["JINDALSTEL", "N_JINDALSTEL_2022-03-31_std.xml"],
    ["IDEA", "N_IDEA_2022-03-31_std.xml"],
  ];
  const QMAP: Array<[keyof ReturnType<typeof extractQuarterlyCells>["cells"], string]> = [
    ["revenue", "revenue"],
    ["otherIncome", "otherIncome"],
    ["depreciation", "depreciation"],
    ["interest", "interest"],
    ["profitBeforeTax", "profitBeforeTax"],
    ["netProfit", "netProfit"],
  ];

  for (const [symbol, file] of QUARTERLY) {
    const { cells } = extractQuarterlyCells(read(path.join("xbrl", file)));
    const stock = await prisma.stock.findFirst({ where: { symbol }, select: { id: true } });
    const row = (await prisma.quarterlyResult.findFirst({
      where: { stockId: stock!.id, reportDate: d("2022-03-31"), resultType: "standalone" },
    })) as unknown as Record<string, unknown> | null;
    for (const [cellKey, dbKey] of QMAP) {
      const bse = n2(cells[cellKey]);
      const ours = row?.[dbKey] === null || row?.[dbKey] === undefined ? null : Number(row[dbKey]);
      check(bse === ours, `q:${symbol}.${String(cellKey)}`, `bse=${bse} ours=${ours}`);
    }
  }

  // ACC FY23 annual — 19 comparable cells
  const acc = extractFundamentalCells(read("xbrl/R10_ACC_2023-03-31_std.xml")).cells;
  const accStock = await prisma.stock.findFirst({ where: { symbol: "ACC" }, select: { id: true } });
  const accRow = (await prisma.fundamental.findFirst({
    where: { stockId: accStock!.id, reportDate: d("2023-03-31"), resultType: "standalone" },
  })) as unknown as Record<string, unknown> | null;
  const FMAP: Array<[keyof typeof acc, string]> = [
    ["revenue", "revenue"], ["otherIncome", "otherIncome"], ["depreciation", "depreciation"],
    ["financeCosts", "financeCosts"], ["profitBeforeTax", "profitBeforeTax"], ["netProfit", "netProfit"],
    ["totalAssets", "totalAssets"], ["propertyPlantAndEquipment", "propertyPlantAndEquipment"],
    ["capitalWorkInProgress", "capitalWorkInProgress"], ["tradeReceivablesCurrent", "tradeReceivablesCurrent"],
    ["borrowingsCurrent", "borrowingsCurrent"], ["borrowingsNoncurrent", "borrowingsNoncurrent"],
    ["currentLiabilities", "currentLiabilities"], ["equityShareCapital", "equityShareCapital"],
    ["otherEquity", "otherEquity"], ["totalEquity", "totalEquity"],
    ["cashFromOperating", "cashFromOperating"], ["cashFromFinancing", "cashFromFinancing"], ["capex", "capex"],
  ];
  for (const [cellKey, dbKey] of FMAP) {
    const bse = n2(acc[cellKey]);
    const ours = accRow?.[dbKey] === null || accRow?.[dbKey] === undefined ? null : Number(accRow[dbKey]);
    check(bse === ours, `a:ACC.${String(cellKey)}`, `bse=${bse} ours=${ours}`);
  }

  // AU Bank Q1FY19 — 6 comparable cells (the other 9 are null in our DB, which is why they are wanted)
  const au = extractBankingQuarterlyCells(read("xbrl/R12_AUBANK_2018-06-30_std.xml")).cells;
  const auStock = await prisma.stock.findFirst({ where: { symbol: "AUBANK" }, select: { id: true } });
  const auRow = (await prisma.bankingQuarterlyResult.findFirst({
    where: { stockId: auStock!.id, reportDate: d("2018-06-30"), resultType: "standalone" },
  })) as unknown as Record<string, unknown> | null;
  const BMAP: Array<[keyof typeof au, string]> = [
    ["interestEarned", "interestEarned"], ["otherIncome", "otherIncome"], ["netProfit", "netProfit"],
    ["ppop", "ppop"], ["profitBeforeTax", "profitBeforeTax"], ["tax", "tax"],
  ];
  for (const [cellKey, dbKey] of BMAP) {
    const bse = n2(au[cellKey] as number | null);
    const ours = auRow?.[dbKey] === null || auRow?.[dbKey] === undefined ? null : Number(auRow[dbKey]);
    check(bse === ours, `b:AUBANK.${String(cellKey)}`, `bse=${bse} ours=${ours}`);
  }
  console.log(`   ${pass} checks passed, ${fail} failed  (expected 55/55)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROOFS 2 & 3 — the ratio gate, and tier1_ratio absence
// ─────────────────────────────────────────────────────────────────────────────
function proofRatioGate(): void {
  console.log("\n── PROOF 2 · ratio gate on AU Bank FY19 annual ────────────────────────────");
  const r = extractBankingFundamentalCells(read("xbrl/BANKANN_AUBANK_2019-03-31_std.xml"));
  for (const v of r.ratioVerdicts) {
    console.log(`   ${v.accepted ? "ACCEPT" : "REFUSE"}  ${v.field.padEnd(24)}${v.note}`);
  }
  const by = new Map(r.ratioVerdicts.map((v) => [v.field, v]));

  const gnpa = by.get("gnpa_pct")!;
  check(!gnpa.accepted && gnpa.reason === "failed_cross_check", "gate:gnpa_pct refused");
  check(gnpa.factor !== null && gnpa.factor > 50, "gate:gnpa_pct factor>50x", `factor=${gnpa.factor?.toFixed(1)}`);
  check(r.cells.gnpaPct === null, "gate:gnpa_pct nulled in cells", `got ${r.cells.gnpaPct}`);

  const roa = by.get("roa_disclosed")!;
  check(!roa.accepted, "gate:roa refused");
  check(r.cells.roaDisclosed === null, "gate:roa nulled in cells", `got ${r.cells.roaDisclosed}`);

  const cet1 = by.get("cet1_ratio")!;
  check(!cet1.accepted && cet1.reason === "no_checkable_sibling", "gate:cet1 refused as uncheckable");
  check(cet1.documentValue === 0.0019, "gate:cet1 document value recorded", `got ${cet1.documentValue}`);
  check(r.cells.cet1Ratio === null, "gate:cet1 nulled in cells", `got ${r.cells.cet1Ratio}`);

  console.log("\n── PROOF 3 · tier1_ratio is ABSENT, not derived and not defaulted ─────────");
  const t1 = by.get("tier1_ratio")!;
  check(t1.reason === "tag_absent_from_document", "gate:tier1 absent", `reason=${t1.reason}`);
  check(t1.documentValue === null, "gate:tier1 no value invented", `got ${t1.documentValue}`);
  check(r.cells.tier1Ratio === null, "gate:tier1 null in cells", `got ${r.cells.tier1Ratio}`);
  // CET1 + AT1 would be 0.0019; prove we did NOT do that.
  check(r.cells.tier1Ratio !== 0.0019, "gate:tier1 not synthesised from CET1+AT1");
  console.log(`   tier1_ratio → ${t1.note}`);

  // Proof that a CORRECT ratio still passes: AU Bank's quarterly ROA is right, and checkable.
  console.log("\n── PROOF 2b · a correct ratio is still accepted (AU Bank Q1FY19 ROA) ──────");
  const q = extractBankingQuarterlyCells(read("xbrl/R12_AUBANK_2018-06-30_std.xml"));
  const qroa = q.ratioVerdicts.find((v) => v.field === "roa_quarterly")!;
  console.log(`   ${qroa.accepted ? "ACCEPT" : "REFUSE"}  ${qroa.note}`);
  check(qroa.accepted, "gate:quarterly roa accepted", qroa.note);
  check(q.cells.roaQuarterly !== null, "gate:quarterly roa kept", `got ${q.cells.roaQuarterly}`);
  // ⚠ Since the S6.3a carve-out, a quarterly NPA ratio with NO cross-document reference reports
  //   `sibling_absent_in_document` (the reference was unavailable) rather than `no_checkable_sibling`
  //   (nothing could ever check it). The distinction is the whole point of the carve-out: one is a
  //   missing input, the other is a structural impossibility. PROOF 9 covers the reference case.
  const qgnpa = q.ratioVerdicts.find((v) => v.field === "gnpa_pct")!;
  check(qgnpa.reason === "sibling_absent_in_document", "gate:quarterly gnpa refused without a reference", `reason=${qgnpa.reason}`);
  check(q.cells.gnpaPct === null, "gate:quarterly gnpa nulled without a reference", `${q.cells.gnpaPct}`);
  console.log(`   ${qgnpa.note}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROOF 4 — the period trap
// ─────────────────────────────────────────────────────────────────────────────
function proofPeriodTrap(): void {
  console.log("\n── PROOF 4 · period trap on a March filing of a March-FY company ──────────");
  const xml = read("xbrl/N_ASIANPAINT_2022-03-31_std.xml");

  const q = assertPeriodAndBasis(xml, "quarterly", d("2022-03-31"), "standalone");
  console.log(`   quarterly → ctx=${q.contextId} ${q.start}..${q.end} ${q.days}d ok=${q.ok}`);
  check(q.ok, "period:quarterly grain accepted", q.failures.join("; "));
  check(q.contextId === "OneD" && q.days === 89, "period:quarterly is the 89d Q4 context", `${q.contextId} ${q.days}d`);

  const a = assertPeriodAndBasis(xml, "annual", d("2022-03-31"), "standalone");
  console.log(`   annual    → ctx=${a.contextId} ${a.start}..${a.end} ${a.days}d ok=${a.ok}`);
  check(a.ok, "period:annual grain accepted", a.failures.join("; "));
  check(a.contextId === "FourD" && a.days === 364, "period:annual is the 364d full-year context", `${a.contextId} ${a.days}d`);

  // ⚠ THE TRAP ITSELF: both contexts declare the SAME end date. Prove the end date alone is useless.
  check(q.end === a.end, "period:both grains share the same end date (this is the trap)", `${q.end} vs ${a.end}`);

  // A quarterly-only document must FAIL an annual assertion — there is no FourD to read.
  const jq = read("xbrl/R01_ASIANPAINT_2022-06-30_std.xml");
  const bad = assertPeriodAndBasis(jq, "annual", d("2022-06-30"), "standalone");
  check(!bad.ok, "period:Q1 document rejected as annual", bad.failures.join("; "));
  console.log(`   Q1 doc read as annual → ok=${bad.ok} :: ${bad.failures[0] ?? ""}`);

  // Basis assertion: the document declares its own basis and it must match the URL field we used.
  const wrongBasis = assertPeriodAndBasis(xml, "quarterly", d("2022-03-31"), "consolidated");
  check(!wrongBasis.ok, "period:basis mismatch rejected", wrongBasis.failures.join("; "));
  console.log(`   standalone doc claimed as consolidated → ok=${wrongBasis.ok}`);
}

/**
 * Pick a (quarter, fiscalYear, reportDate) this stock holds NO row for, and prove it is absent
 * before handing it to the positive control. Candidates sit BELOW the corpus floor (the universe's
 * earliest report_date is 2018-03-31) so no ingestion, NSE or BSE, can ever fill one — the control
 * cannot expire the way the pinned 2022-06-30 did.
 */
async function pickGap(stockId: string): Promise<{
  quarter: string; fiscalYear: string; reportDate: Date; filingDate: Date; label: string;
}> {
  const candidates = [
    { quarter: "Q1", fiscalYear: "FY16", reportDate: d("2015-06-30"), filingDate: d("2015-07-25") },
    { quarter: "Q2", fiscalYear: "FY16", reportDate: d("2015-09-30"), filingDate: d("2015-10-25") },
    { quarter: "Q3", fiscalYear: "FY16", reportDate: d("2015-12-31"), filingDate: d("2016-01-25") },
  ];
  for (const c of candidates) {
    const existing = await prisma.quarterlyResult.findFirst({
      where: { stockId, reportDate: c.reportDate, resultType: "standalone" },
      select: { id: true },
    });
    if (!existing) return { ...c, label: `${c.quarter} ${c.fiscalYear} (${c.reportDate.toISOString().slice(0, 10)})` };
  }
  throw new Error(
    "every positive-control candidate period is occupied — the control cannot prove an insert lands; " +
      "widen `candidates` rather than deleting a row to make room",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROOF 5 — T3 NEGATIVE TEST, inside a transaction that is always rolled back
// ─────────────────────────────────────────────────────────────────────────────
async function proofNegativeWrite(): Promise<void> {
  console.log("\n── PROOF 5 · T3 negative test (transaction, always rolled back) ───────────");
  const bseBefore = await prisma.quarterlyResult.count({ where: { source: "bse_xbrl" } });
  const stock = await prisma.stock.findFirst({ where: { symbol: "ASIANPAINT" }, select: { id: true } });
  const held = await prisma.quarterlyResult.findFirst({
    where: { stockId: stock!.id, reportDate: d("2022-03-31"), resultType: "standalone" },
    select: { id: true, source: true, quarter: true, fiscalYear: true, revenue: true, updatedAt: true },
  });
  console.log(`   NSE holds ASIANPAINT ${held!.quarter} ${held!.fiscalYear} standalone — source=${held!.source} revenue=${held!.revenue}`);

  const cellsHeld = extractQuarterlyCells(read("xbrl/N_ASIANPAINT_2022-03-31_std.xml")).cells;
  const cellsGap = extractQuarterlyCells(read("xbrl/R01_ASIANPAINT_2022-06-30_std.xml")).cells;

  // Find a period this stock genuinely holds nothing for — see the note at the insert below.
  // Candidates run backwards from the corpus floor (universe min report_date is 2018-03-31), so a
  // successful cohort run can never consume them, and each is verified absent before it is used.
  const gapPeriod = await pickGap(stock!.id);
  console.log(`   positive-control period: ${gapPeriod.label}`);

  const ROLLBACK = "ROLLBACK_SENTINEL";
  try {
    await prisma.$transaction(async (tx) => {
      const idHeld: RowIdentity = {
        stockId: stock!.id, quarter: held!.quarter, fiscalYear: held!.fiscalYear,
        reportDate: d("2022-03-31"), filingDate: d("2022-05-11"),
        resultType: "standalone", xbrlUrl: "https://www.bseindia.com/XBRLFILES/dryrun-held",
      };
      const a = await insertQuarterlyIfAbsent(tx, idHeld, cellsHeld);
      console.log(`   → period NSE HOLDS      : written=${a.written} ${"reason" in a ? a.reason : ""}`);
      check(!a.written, "T3:no write where NSE holds", JSON.stringify(a));

      const after = await tx.quarterlyResult.findFirst({
        where: { stockId: stock!.id, reportDate: d("2022-03-31"), resultType: "standalone" },
        select: { id: true, source: true, updatedAt: true },
      });
      check(after!.id === held!.id, "T3:row id unchanged", `${after!.id} vs ${held!.id}`);
      check(after!.source === held!.source, "T3:source still NSE", `${after!.source}`);
      check(after!.updatedAt.getTime() === held!.updatedAt.getTime(), "T3:updated_at unmoved");

      // Positive control — the SAME statement DOES insert where nothing exists. Without this, a 0
      // above would be indistinguishable from a broken statement.
      //
      // ⚠ THE PERIOD IS CHOSEN, NOT PINNED, AND THAT IS THE POINT. This control used to hardcode
      //   ASIANPAINT 2022-06-30 — and then the PILOT WROTE THAT ROW (b8b5da03…, source=bse_xbrl), so
      //   the "genuine gap" stopped being a gap and the control failed for the one reason that should
      //   never fail a control: the thing it guards started working. A positive control that names a
      //   date is a control with an expiry date. `pickGap` asserts the PROPERTY — nothing holds this
      //   period — and re-derives it every run.
      console.log(`   → chose empty period    : ${gapPeriod.label} (asserted absent before the run)`);
      const idGap: RowIdentity = {
        stockId: stock!.id, quarter: gapPeriod.quarter, fiscalYear: gapPeriod.fiscalYear,
        reportDate: gapPeriod.reportDate, filingDate: gapPeriod.filingDate,
        resultType: "standalone", xbrlUrl: "https://www.bseindia.com/XBRLFILES/dryrun-gap",
      };
      const b = await insertQuarterlyIfAbsent(tx, idGap, cellsGap);
      console.log(`   → period NOBODY holds   : written=${b.written} (positive control)`);
      check(b.written, "T3:writes into a genuine gap", JSON.stringify(b));

      const gapRow = await tx.quarterlyResult.findFirst({
        where: { stockId: stock!.id, reportDate: gapPeriod.reportDate, resultType: "standalone" },
        select: { source: true, revenue: true, netProfit: true, xbrlTaxonomy: true },
      });
      console.log(`     inserted: source=${gapRow?.source} taxonomy=${gapRow?.xbrlTaxonomy} revenue=${gapRow?.revenue} netProfit=${gapRow?.netProfit}`);
      check(gapRow?.source === "bse_xbrl", "T3:new row carries bse_xbrl provenance", `${gapRow?.source}`);

      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
  }

  // Must read the SAME period the control inserted into — pinning 2022-06-30 here meant this check
  // silently switched from "the rollback worked" to "does ASIANPAINT have a Q1 FY23 row", and once
  // the pilot wrote one it reported a leak that never happened.
  const post = await prisma.quarterlyResult.findFirst({
    where: { stockId: stock!.id, reportDate: gapPeriod.reportDate, resultType: "standalone" },
  });
  check(post === null, "T3:rollback left nothing behind", `found ${post?.id}`);
  // ⚠ SCOPED TO THIS TRANSACTION, NOT AN ABSOLUTE ZERO. Once the pilot has run for real there ARE
  //   bse_xbrl rows in the table, and asserting "zero anywhere" would fail on the lane working
  //   correctly. What this proves is that THIS test persisted nothing: the count is unchanged.
  const bseAfter = await prisma.quarterlyResult.count({ where: { source: "bse_xbrl" } });
  check(bseAfter === bseBefore, "T3:bse_xbrl row count unchanged by the test", `${bseBefore} → ${bseAfter}`);
  console.log(`   rolled back — bse_xbrl rows in quarterly_results: ${bseBefore} before, ${bseAfter} after`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROOF 6 — money is absolute INR regardless of the declared rounding
// ─────────────────────────────────────────────────────────────────────────────
function proofMoneyScale(): void {
  console.log("\n── PROOF 6 · money needs no gate: absolute INR whatever the filing declares ──");
  const dir = path.join(FIXTURES, "xbrl");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".xml"));
  const roundings = new Set<string>();
  let checked = 0;

  for (const f of files) {
    const xml = fs.readFileSync(path.join(dir, f), "utf8");
    const rd = xml.match(
      /<in-bse-fin:LevelOfRoundingUsedInFinancialStatements\b[^>]*?>([^<]+)</i,
    );
    const declared = rd ? rd[1].trim() : "(none)";
    roundings.add(declared);

    // Headline money line, whichever taxonomy this is. extractNumber already divides INR by 1e7.
    const head =
      extractQuarterlyCells(xml).cells.revenue ??
      extractBankingQuarterlyCells(xml).cells.interestEarned ??
      extractFundamentalCells(xml).cells.revenue ??
      extractBankingFundamentalCells(xml).cells.interestEarned;
    if (head === null) continue;
    checked++;

    // If the declared rounding actually governed the value, a "Crores" filing would need ANOTHER
    // ÷1e7 and a "Lakhs" one ÷1e5. Assert the single ÷1e7 already lands in a real ₹ Crore band.
    const plausible = Math.abs(head) >= 1 && Math.abs(head) <= 2_000_000;
    check(plausible, `money:${f} in Cr band after single /1e7`, `declared=${declared} value=${head}`);
  }
  console.log(`   ${checked} documents checked; declared roundings seen: ${[...roundings].join(", ")}`);
  console.log(`   → the declared rounding does NOT predict the value scale; every instance is absolute INR.`);
  check(roundings.size > 1, "money:sample spans more than one declared rounding", `${[...roundings].join(",")}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROOF 7 — the fence itself works (layers 2 and 3), against the real tables
// ─────────────────────────────────────────────────────────────────────────────
async function proofFence(): Promise<void> {
  console.log("\n── PROOF 7 · the fence: baseline diff + source-count, on the real tables ──");
  const runStart = new Date();
  const baseline = await captureBaseline(prisma);
  console.log(`   baseline captured: ${JSON.stringify(baseline.totals)}`);
  const total = Object.values(baseline.totals).reduce((a, b) => a + b, 0);
  check(total > 20000, "fence:baseline covers the NSE corpus", `total=${total}`);

  const report = await verifyFence(prisma, baseline, runStart);
  console.log(`   verify → ok=${report.ok} violations=${report.violations.length} touchedSinceStart=${JSON.stringify(report.touchedSinceStart)}`);
  check(report.ok, "fence:clean when nothing ran", JSON.stringify(report.violations.slice(0, 3)));
  check(report.violations.length === 0, "fence:no violations");
  check(
    Object.values(report.touchedSinceStart).every((n) => n === 0),
    "fence:no NSE row updated since run start",
    JSON.stringify(report.touchedSinceStart),
  );
  // The LIKE escape must select NSE rows only — if 'nse\_%' were mis-escaped it would match nothing
  // (or everything), and the fence would silently pass while guarding nothing.
  const bse = await prisma.quarterlyResult.count({ where: { source: "bse_xbrl" } });
  const nse = await prisma.quarterlyResult.count({ where: { source: { startsWith: "nse_" } } });
  check(baseline.totals["quarterly_results"] === nse, "fence:LIKE escape selects exactly the NSE rows", `fence=${baseline.totals["quarterly_results"]} prisma=${nse}`);
  console.log(`   quarterly_results: ${nse} NSE rows fenced, ${bse} bse_xbrl rows present`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROOF 8 — SOURCE HYGIENE: no raw control bytes in the lane's own source
// ─────────────────────────────────────────────────────────────────────────────
function proofSourceHygiene(): void {
  console.log("\n── PROOF 8 · source hygiene: no raw control bytes in the lane ─────────────");
  // ⚠ THIS EXISTS BECAUSE IT HAPPENED TWICE. Writing these files through a shell heredoc collapsed
  //   `\\b` into a RAW BACKSPACE BYTE (0x08). In a template literal that is a valid string escape;
  //   in a regex literal it is a literal backspace. Either way `tsc` passes clean and the regex
  //   silently matches nothing — which reads downstream as "the tag is absent", i.e. missing data.
  //   A byte scan is the only thing that sees it.
  const dirs = [
    path.resolve("src/ingestions/quaterly-results/bse"),
    path.resolve("src/scripts"),
  ];
  const offenders: string[] = [];
  let scanned = 0;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      if (dir.endsWith("scripts") && !f.startsWith("bse-") && !f.startsWith("dryrun-bse-")) continue;
      scanned++;
      const buf = fs.readFileSync(path.join(dir, f));
      for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (b < 32 && b !== 9 && b !== 10 && b !== 13) {
          offenders.push(`${f} @${i} 0x${b.toString(16)}`);
          break;
        }
      }
    }
  }
  console.log(`   scanned ${scanned} lane source files; offenders: ${offenders.length ? offenders.join(", ") : "none"}`);
  check(offenders.length === 0, "hygiene:no raw control bytes in lane source", offenders.join(", "));
}

// ─────────────────────────────────────────────────────────────────────────────
// PROOF 9 — the S6.3a cross-document carve-out
// ─────────────────────────────────────────────────────────────────────────────
function proofCarveOut(): void {
  console.log("\n── PROOF 9 · cross-document carve-out for quarterly NPA ratios ────────────");
  const xml = read("xbrl/R12_AUBANK_2018-06-30_std.xml");
  // AU Bank's own FY19 annual Advances — the reference the runner resolves at run time.
  const ref = { advances: 228_187_308_000, asOf: "2019-03-31", sourceUrl: "FY19 annual" };

  // (a) WITHOUT a reference, the ratios are refused — the pre-carve-out behaviour.
  const without = extractBankingQuarterlyCells(xml);
  const wG = without.ratioVerdicts.find((v) => v.field === "gnpa_pct")!;
  check(!wG.accepted, "carve:refused with no reference", wG.note);
  check(without.cells.gnpaPct === null, "carve:null with no reference");

  // (b) WITH the reference, a CORRECT quarterly ratio is accepted.
  const withRef = extractBankingQuarterlyCells(xml, ref);
  const g = withRef.ratioVerdicts.find((v) => v.field === "gnpa_pct")!;
  const n = withRef.ratioVerdicts.find((v) => v.field === "nnpa_pct")!;
  console.log(`   ${g.accepted ? "ACCEPT" : "REFUSE"}  ${g.note}`);
  console.log(`   ${n.accepted ? "ACCEPT" : "REFUSE"}  ${n.note}`);
  check(g.accepted, "carve:correct gnpa accepted", g.note);
  check(n.accepted, "carve:correct nnpa accepted", n.note);
  check(withRef.cells.gnpaPct === 0.022, "carve:gnpa value kept as filed", `${withRef.cells.gnpaPct}`);
  check(g.factor !== null && g.factor > 0.5 && g.factor < 1.0, "carve:correct-quarter factor near 1", `${g.factor?.toFixed(2)}`);

  // (c) THE CORRUPT CASE. AU Bank's Dec-18 quarter really does report 0.0002 (MEASURED: factor
  //     92.19 against this same reference). Constructed here from the Jun-18 document so the proof
  //     is deterministic and needs no second fetch — the value substituted is the real one.
  const corrupt = xml.replace(
    /(<in-bse-fin:PercentageOfGrossNpa\b[^>]*?>)\s*[\d.]+\s*(<\/in-bse-fin:PercentageOfGrossNpa>)/i,
    "$10.0002$2",
  );
  check(corrupt !== xml, "carve:corrupt fixture constructed");
  const bad = extractBankingQuarterlyCells(corrupt, ref);
  const bg = bad.ratioVerdicts.find((v) => v.field === "gnpa_pct")!;
  console.log(`   ${bg.accepted ? "ACCEPT" : "REFUSE"}  ${bg.note}`);
  check(!bg.accepted && bg.reason === "failed_cross_check", "carve:100x class REFUSED", bg.note);
  check(bg.factor !== null && bg.factor > 30, "carve:corrupt factor is orders of magnitude", `${bg.factor?.toFixed(1)}`);
  check(bad.cells.gnpaPct === null, "carve:corrupt value nulled", `${bad.cells.gnpaPct}`);

  // (d) The band is not doing the work by being loose: the corrupt factor is far outside it, and the
  //     correct one far inside. Separation, not fitting.
  console.log(`   separation → correct factor ${g.factor!.toFixed(2)}x vs corrupt ${bg.factor!.toFixed(1)}x (band [0.33, 3.0])`);
  check(bg.factor! / g.factor! > 30, "carve:separation exceeds 30x", `${(bg.factor! / g.factor!).toFixed(0)}`);
}

async function main(): Promise<void> {
  console.log("BSE LANE DRY RUN — no persisted writes");
  console.log(`fixtures: ${FIXTURES}`);
  proofSourceHygiene();
  proofCarveOut();
  await proofCrossSource();
  proofRatioGate();
  proofPeriodTrap();
  proofMoneyScale();
  await proofNegativeWrite();
  await proofFence();

  console.log("\n══════════════════════════════════════════════════════════════════════════");
  console.log(`TOTAL: ${pass} passed, ${fail} failed`);
  if (fail) {
    for (const f of failures) console.log("  FAIL " + f);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

await main();
