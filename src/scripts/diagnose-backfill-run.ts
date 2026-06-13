// Read-only diagnostic: did the universe backfill actually write rows,
// or was it skipped/dedup'd? Cross-checks fetch logs, background job results,
// createdAt timestamps, and a sample of still-null rows' asOnDate.
//
// Run: npx tsx src/scripts/diagnose-backfill-run.ts

import { prisma } from "../db/prisma.js";

const WINDOW_H = 24;
const cutoff = new Date(Date.now() - WINDOW_H * 60 * 60 * 1000);

function iso(d: Date | null | undefined) {
  return d ? d.toISOString().replace("T", " ").slice(0, 19) + "Z" : "null";
}

async function main() {
  console.log("=".repeat(72));
  console.log("BACKFILL RUN DIAGNOSTIC");
  console.log(`Window: last ${WINDOW_H}h (since ${iso(cutoff)})`);
  console.log("=".repeat(72));

  // ── 1. ShareholdingFetchLog: last 24h ────────────────────────────────────

  const logs = await prisma.$queryRawUnsafe<Array<{
    stock_symbol: string;
    fetch_type: string;
    quarters_found: number;
    quarters_inserted: number;
    quarters_skipped: number;
    status: string;
    created_at: Date;
  }>>(
    `SELECT stock_symbol, fetch_type, quarters_found, quarters_inserted,
            quarters_skipped, status, created_at
     FROM shareholding_fetch_logs
     WHERE created_at >= $1
     ORDER BY created_at DESC`,
    cutoff,
  );

  const distinctStocks = new Set(logs.map((l) => l.stock_symbol)).size;
  const totalInserted = logs.reduce((s, l) => s + Number(l.quarters_inserted), 0);
  const totalSkipped  = logs.reduce((s, l) => s + Number(l.quarters_skipped), 0);
  const totalFound    = logs.reduce((s, l) => s + Number(l.quarters_found), 0);
  const byStatus: Record<string, number> = {};
  for (const l of logs) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;

  console.log(`\n── 1. FETCH LOGS (last ${WINDOW_H}h) ──────────────────────────────────────`);
  console.log(`  Log entries      : ${logs.length}`);
  console.log(`  Distinct stocks  : ${distinctStocks}`);
  console.log(`  quartersFound    : ${totalFound}`);
  console.log(`  quartersInserted : ${totalInserted}`);
  console.log(`  quartersSkipped  : ${totalSkipped}`);
  console.log(`  Status breakdown : ${JSON.stringify(byStatus)}`);

  if (logs.length > 0) {
    console.log(`\n  Most recent 10 entries:`);
    const header =
      "symbol".padEnd(14) +
      "type".padEnd(12) +
      "found".padStart(6) +
      "ins".padStart(5) +
      "skip".padStart(6) +
      "  status".padEnd(10) +
      "  createdAt";
    console.log("  " + header);
    console.log("  " + "─".repeat(header.length));
    for (const l of logs.slice(0, 10)) {
      console.log(
        "  " +
        l.stock_symbol.padEnd(14) +
        l.fetch_type.padEnd(12) +
        String(l.quarters_found).padStart(6) +
        String(l.quarters_inserted).padStart(5) +
        String(l.quarters_skipped).padStart(6) +
        ("  " + l.status).padEnd(10) +
        "  " + iso(l.created_at),
      );
    }
    if (logs.length > 10) console.log(`  ... and ${logs.length - 10} more`);
  }

  // ── 2. BackgroundJob: SHAREHOLDING_* last 24h ────────────────────────────

  const jobs = await prisma.$queryRawUnsafe<Array<{
    id: string;
    type: string;
    status: string;
    triggeredBy: string;
    created_at: Date;
    started_at: Date | null;
    finished_at: Date | null;
    progress: number;
    progressNote: string | null;
    result: unknown;
    errorMessage: string | null;
  }>>(
    `SELECT id, type, status, "triggeredBy", created_at, started_at,
            finished_at, progress, "progressNote", result, "errorMessage"
     FROM background_jobs
     WHERE type LIKE 'shareholding%'
       AND created_at >= $1
     ORDER BY created_at DESC`,
    cutoff,
  );

  console.log(`\n── 2. BACKGROUND JOBS (SHAREHOLDING_*, last ${WINDOW_H}h) ─────────────────`);
  if (jobs.length === 0) {
    console.log("  No shareholding background jobs found in last 24h.");
  } else {
    for (const j of jobs) {
      const dur = j.finished_at && j.started_at
        ? `${Math.round((j.finished_at.getTime() - j.started_at.getTime()) / 1000)}s`
        : "running";
      console.log(`\n  Job ${j.id}`);
      console.log(`    type        : ${j.type}`);
      console.log(`    status      : ${j.status}`);
      console.log(`    triggeredBy : ${j.triggeredBy}`);
      console.log(`    created     : ${iso(j.created_at)}`);
      console.log(`    started     : ${iso(j.started_at)}`);
      console.log(`    finished    : ${iso(j.finished_at)}  (${dur})`);
      console.log(`    progress    : ${j.progress}%  ${j.progressNote ?? ""}`);
      if (j.result) console.log(`    result      : ${JSON.stringify(j.result)}`);
      if (j.errorMessage) console.log(`    error       : ${j.errorMessage}`);
    }
  }

  // ── 3. ShareholdingPattern: rows with createdAt today ───────────────────
  // Note: createdAt is set on INSERT only. Upserts that hit UPDATE don't
  // change createdAt — so this counts genuinely NEW rows only.

  const newRows = await prisma.$queryRawUnsafe<Array<{
    total: bigint;
    fii_non_null: bigint;
    fii_null: bigint;
  }>>(
    `SELECT
       COUNT(*)                                            AS total,
       COUNT(*) FILTER (WHERE fii_pct IS NOT NULL)        AS fii_non_null,
       COUNT(*) FILTER (WHERE fii_pct IS NULL)            AS fii_null
     FROM shareholding_patterns
     WHERE created_at >= $1`,
    cutoff,
  );

  const nr = newRows[0];
  const newTotal       = Number(nr.total);
  const newFiiNonNull  = Number(nr.fii_non_null);
  const newFiiNull     = Number(nr.fii_null);

  // All-time totals for context
  const allTotals = await prisma.$queryRawUnsafe<Array<{
    total: bigint;
    fii_null: bigint;
  }>>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE fii_pct IS NULL) AS fii_null
     FROM shareholding_patterns`,
  );
  const allTotal   = Number(allTotals[0].total);
  const allFiiNull = Number(allTotals[0].fii_null);

  console.log(`\n── 3. SHAREHOLDING ROWS CREATED TODAY ──────────────────────────────────`);
  console.log(`  Rows with createdAt >= cutoff : ${newTotal}`);
  console.log(`    of which fiiPct non-null    : ${newFiiNonNull}`);
  console.log(`    of which fiiPct null        : ${newFiiNull}`);
  console.log(`  All-time total rows           : ${allTotal}`);
  console.log(`  All-time fiiPct null          : ${allFiiNull} (${((allFiiNull/allTotal)*100).toFixed(1)}%)`);
  console.log(`\n  NOTE: upsert UPDATE path does NOT change createdAt.`);
  console.log(`  If newTotal << universe size, most rows were UPSERTed (updated in place)`);
  console.log(`  and their fiiPct was overwritten — createdAt is invisible evidence.`);
  console.log(`  Use fetch-log quartersInserted as the real write counter.`);

  // ── 4. KEY LINES ─────────────────────────────────────────────────────────

  const universeJob = jobs.find(
    (j) => j.type === "shareholding_backfill" && j.status === "succeeded",
  );

  const universeJobStatus = jobs.length === 0
    ? "none found"
    : universeJob
      ? `ran→succeeded (result: ${JSON.stringify(universeJob.result)})`
      : jobs.map((j) => `${j.type}→${j.status}`).join(", ");

  console.log(`\n── 4. KEY LINES ─────────────────────────────────────────────────────────`);
  console.log(`  Distinct stocks re-ingested in last 24h: ${distinctStocks} (of 219).`);
  console.log(`  Rows written/updated in last 24h: ${totalInserted} quarters inserted per fetch logs.`);
  console.log(`  New rows (INSERT, createdAt today): ${newTotal}.`);
  console.log(`  Universe SHAREHOLDING job in last 24h: ${universeJobStatus}.`);

  // Inference
  let inference: string;
  if (distinctStocks === 0 || totalInserted === 0) {
    inference = "(a) backfill did NOT run — no fetch logs written, zero rows inserted.";
  } else if (distinctStocks < 50 && totalInserted < 500) {
    inference = "(a/b) backfill ran for only a small subset of stocks — likely partial/cancelled or only KAYNES was tested.";
  } else if (allFiiNull > 1000) {
    // Ran but nulls persist — check if within 12q window
    inference = "(b) or (c) — backfill ran and inserted rows, but significant nulls remain. " +
      "Need to check whether null rows fall within the 12-quarter window (→ b) or outside it (→ c). " +
      "See section 5 below.";
  } else {
    inference = "(c) backfill ran and wrote rows; remaining nulls are deep-history beyond the window.";
  }
  console.log(`\n  Best inference: ${inference}`);

  // ── 5. Sample still-null rows from 5 non-KAYNES stocks ──────────────────

  // Find 5 stocks (not KAYNES) that have null fiiPct rows
  const nullStocks = await prisma.$queryRawUnsafe<Array<{
    symbol: string;
    null_count: bigint;
  }>>(
    `SELECT sp.symbol, COUNT(*) AS null_count
     FROM shareholding_patterns sp
     WHERE sp.fii_pct IS NULL
       AND sp.symbol != 'KAYNES'
     GROUP BY sp.symbol
     ORDER BY null_count DESC
     LIMIT 5`,
  );

  console.log(`\n── 5. NULL-ROW DATES FOR 5 NON-KAYNES STOCKS ──────────────────────────`);

  // 12 quarters back from today ≈ 3 years
  const twelveQBack = new Date();
  twelveQBack.setFullYear(twelveQBack.getFullYear() - 3);
  console.log(`  12-quarter cutoff (approx): ${twelveQBack.toISOString().slice(0, 10)}`);
  console.log(`  Rows with asOnDate >= cutoff should have been fixed by a 12q backfill.`);

  for (const s of nullStocks) {
    const nullDates = await prisma.$queryRawUnsafe<Array<{
      as_on_date: Date;
      source_date: Date;
    }>>(
      `SELECT as_on_date, source_date
       FROM shareholding_patterns
       WHERE symbol = $1
         AND fii_pct IS NULL
       ORDER BY as_on_date DESC`,
      s.symbol,
    );

    const within = nullDates.filter((r) => r.as_on_date >= twelveQBack);
    const outside = nullDates.filter((r) => r.as_on_date < twelveQBack);

    console.log(`\n  ${s.symbol}  (${Number(s.null_count)} null rows)`);
    for (const r of nullDates) {
      const flag = r.as_on_date >= twelveQBack ? "WITHIN-12Q ⚠" : "outside-12q";
      console.log(
        `    asOnDate=${r.as_on_date.toISOString().slice(0, 10)}` +
        `  sourceDate=${r.source_date.toISOString().slice(0, 10)}` +
        `  ${flag}`,
      );
    }
    if (within.length > 0) {
      console.log(`    → ${within.length} null rows WITHIN 12q window — backfill should have fixed these!`);
    } else {
      console.log(`    → All null rows are outside 12q window — consistent with (c).`);
    }
  }

  console.log("\n" + "=".repeat(72));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
