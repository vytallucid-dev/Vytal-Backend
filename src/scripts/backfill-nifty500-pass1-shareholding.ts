// ─────────────────────────────────────────────────────────────────────────────
// PASS 1 · Stage 1a — targeted shareholding backfill for the newly-created
// Nifty-500 display-only stocks. Targets EXACTLY the CSV symbols that currently
// have zero shareholding_patterns rows (= the 281 new ones on first run; on a
// re-run, only those still missing → safe retry). Serves both the Pass-2 tier
// ranking (lands total_shares) and the display page (filing history).
//
// Uses the exported per-stock atom ingestShareholdingForStock(), which reports
// every guard trip to the IngestionError table (→ /settings/ingestion-errors).
// Mirrors the production runInBatches rhythm (batch=3, 8s between batches, NSE
// session reset every 3 batches). Deliberately SKIPS the universe-level
// runCoverageGuards (they compare against the full universe and would misfire on
// a subset). Per-stock SHAPE/range/null guards still fire + report.
//
//   npx tsx src/scripts/backfill-nifty500-pass1-shareholding.ts <csv-path> [--quarters N]
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../db/prisma.js";
import { nseClient } from "../lib/client.js";
import { ingestShareholdingForStock, type IngestShareholdingResult } from "../ingestions/shareholdings/ingest-shareholding.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import { SHAREHOLDING_CRON } from "../ingestions/shareholdings/shareholding-guards.js";
import fs from "fs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A per-stock TOTAL failure (hard error, timeout, or empty index) is otherwise
// invisible in the error UI: hard errors throw before any guard runs, and the
// zero-filing coverage guard is universe-scoped (skipped for a subset). Surface
// each explicitly so "failures visible in /settings/ingestion-errors" holds.
// dedups per (cron, guardType, targetEntity=symbol) — a re-run that succeeds
// leaves the open row for manual close, or you resolve it on success.
async function reportStockShareholdingFailure(symbol: string, kind: "hard_error" | "zero_filings", detail: string) {
  await reportIngestionError({
    source: "nse_shareholding_xbrl",
    cron: SHAREHOLDING_CRON,
    guardType: "count",
    targetTable: "ShareholdingPattern",
    targetEntity: symbol,
    severity: "high",
    resolutionPath: "source_code",
    expected: "≥1 shareholding filing ingested for this stock",
    observed: kind === "zero_filings" ? "0 filings (empty NSE index)" : "ingest failed before any filing landed",
    detail: `Pass-1 backfill: ${detail.slice(0, 300)}`,
    runRef: `${SHAREHOLDING_CRON}:pass1-backfill`,
  });
}

async function main() {
  const csvPath = process.argv[2];
  const qIdx = process.argv.indexOf("--quarters");
  const quartersBack = qIdx >= 0 ? parseInt(process.argv[qIdx + 1], 10) : 12;
  // --warm-once: init the NSE session ONCE up front and never force-reset mid-run.
  // Avoids the thundering-herd where a forced reset makes a whole parallel batch
  // call initSession() concurrently (NSE rate-blocks the burst → whole batches
  // fail). Safe for SHORT runs (retries) that finish well inside the 8-min TTL.
  const warmOnce = process.argv.includes("--warm-once");
  if (!csvPath) { console.error("usage: backfill-nifty500-pass1-shareholding.ts <csv-path> [--quarters N] [--warm-once]"); process.exit(1); }

  const lines = fs.readFileSync(csvPath, "utf8").trim().split(/\r?\n/).slice(1);
  const csvSymbols = lines.map((l) => { const p = l.split(","); return p[p.length - 3].trim(); });

  // Target = CSV symbols in DB with ZERO shareholding rows (the new set; retry-safe).
  const target = await prisma.stock.findMany({
    where: { symbol: { in: csvSymbols }, shareholdingPatterns: { none: {} } },
    select: { symbol: true },
    orderBy: { symbol: "asc" },
  });
  const symbols = target.map((s) => s.symbol);
  console.log(`[SHP-backfill] targeting ${symbols.length} symbols (CSV ∩ DB ∩ zero-shareholding), quartersBack=${quartersBack}, warmOnce=${warmOnce}`);
  if (symbols.length === 0) { console.log("nothing to do."); await prisma.$disconnect(); return; }

  // Warm the session ONCE up front so the first parallel batch reuses it rather
  // than racing to create it (the batch-boundary reset race that bit the main run).
  if (warmOnce) { console.log("[SHP-backfill] warming NSE session once up front…"); await nseClient.initSession(); }

  const BATCH = 3, DELAY = 8_000, TIMEOUT = 300_000;
  const totalBatches = Math.ceil(symbols.length / BATCH);
  let ok = 0, withErrors = 0, zeroFilings = 0, totalInserted = 0;
  const errored: Array<{ symbol: string; error: string }> = [];
  const zeros: string[] = [];

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    console.log(`[SHP-backfill] batch ${batchNum}/${totalBatches}: ${batch.join(", ")}`);

    const settled = await Promise.allSettled(
      batch.map((symbol) =>
        Promise.race<IngestShareholdingResult>([
          ingestShareholdingForStock(symbol, quartersBack),
          new Promise<IngestShareholdingResult>((_, rej) => setTimeout(() => rej(new Error(`Timed out after ${TIMEOUT / 1000}s`)), TIMEOUT)),
        ]),
      ),
    );
    for (let j = 0; j < settled.length; j++) {
      const symbol = batch[j], o = settled[j];
      if (o.status === "fulfilled") {
        const r = o.value;
        totalInserted += r.quartersInserted;
        if (r.zeroFilings) { zeroFilings++; zeros.push(symbol); await reportStockShareholdingFailure(symbol, "zero_filings", "NSE returned an empty filing index"); }
        // A stock that landed >=1 quarter but also had per-filing errors is a
        // partial success (already reported by the in-atom guards) — not a total
        // failure. Report a TOTAL failure only when nothing landed.
        if (r.errors.length > 0) {
          withErrors++; errored.push({ symbol, error: r.errors.join("; ").slice(0, 200) });
          if (r.quartersInserted === 0 && !r.zeroFilings) await reportStockShareholdingFailure(symbol, "hard_error", r.errors.join("; "));
        } else if (!r.zeroFilings) ok++;
      } else {
        withErrors++;
        const msg = (o.reason as Error)?.message ?? String(o.reason);
        errored.push({ symbol, error: msg.slice(0, 200) });
        await reportStockShareholdingFailure(symbol, "hard_error", msg);
      }
    }

    if (i + BATCH < symbols.length) {
      // warm-once: never force-reset (avoids the thundering-herd re-init). Otherwise
      // mirror production: reset every 3 batches to dodge NSE's silent session drop.
      if (!warmOnce && batchNum % 3 === 0) { console.log(`[SHP-backfill] resetting NSE session after batch ${batchNum}…`); nseClient.resetSession(); await sleep(3_000); }
      else await sleep(DELAY);
    }
  }

  console.log(`\n=== SHP-backfill done ===`);
  console.log(`targeted        : ${symbols.length}`);
  console.log(`clean success   : ${ok}`);
  console.log(`with errors     : ${withErrors} (each reported to IngestionError → /settings/ingestion-errors)`);
  console.log(`zero-filings    : ${zeroFilings}`);
  console.log(`quarters written: ${totalInserted}`);
  if (zeros.length) console.log(`zero-filing symbols: ${zeros.join(", ")}`);
  if (errored.length) { console.log(`errored symbols:`); for (const e of errored) console.log(`  ${e.symbol}: ${e.error}`); }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
