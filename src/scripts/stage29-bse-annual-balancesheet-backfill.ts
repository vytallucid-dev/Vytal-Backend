// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 29 — BACKFILL THE BALANCE SHEET AND CASH FLOW ONTO EXISTING BSE ANNUAL ROWS. ⚠ --commit.
//
//   npx tsx src/scripts/stage29-bse-annual-balancesheet-backfill.ts --limit 5     # dry, 5 documents
//   npx tsx src/scripts/stage29-bse-annual-balancesheet-backfill.ts --commit
//
// The extractor now reads 41 more cells per annual filing, but only for documents fetched from here
// on. The 742 rows already in the table were built by the old 24-cell extractor and stay empty until
// their document is read again. This re-reads them.
//
// ── IT RE-READS THE ORIGINAL DOCUMENT, IT DOES NOT INVENT ────────────────────────────────────────
// Each row stores the `xbrl_url` it was built from. That exact instance is fetched again and run
// through `extractFundamentalCells`, so a backfilled row is byte-for-byte what the lane would write
// if it saw the filing today. Nothing is inferred from other rows.
//
// ── NULL-ONLY, THROUGH THE EXISTING FILLER ───────────────────────────────────────────────────────
// Writes go through `fillNullColumns` — the same null-only, FOR UPDATE-guarded, audited path the BSE
// lane already uses. So a cell that already holds a value is never touched, whoever wrote it: the
// hand-keyed workbook rows and any NSE-sourced value are safe by construction rather than by care.
//
// ⚠ PACED, AND IT STOPS RATHER THAN PUSHES. 742 documents is a long run against BSE, so it uses the
//   lane's own BsePacer and honours ThrottleStopError by stopping — retrying through a throttle is
//   what deepens it. Re-running resumes: rows already filled simply report nothing to fill.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { BsePacer, ThrottleStopError } from "../ingestions/quaterly-results/bse/bse-http.js";
import { fetchInstance } from "../ingestions/quaterly-results/bse/bse-discovery.js";
import { extractFundamentalCells } from "../ingestions/quaterly-results/bse/bse-extract.js";
import { cellsToColumns, fillNullColumns, type TxClient } from "../ingestions/quaterly-results/bse/bse-column-fill.js";
import { BSE_FILL_EDITOR } from "../ingestions/quaterly-results/bse/backfill-bse.js";
import { deriveAfterBseWrite } from "../ingestions/quaterly-results/bse/bse-derive-after-write.js";

const argv = process.argv;
const COMMIT = argv.includes("--commit");
const numArg = (f: string, d: number): number => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const arg = (f: string, d: string): string => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const LIMIT = numArg("--limit", 0);
// ⚠ SPACING AND CHUNK SIZE ARE THE WHOLE STRATEGY HERE, not tuning knobs.
//   MEASURED 2026-08-28: at 1,100 ms spacing an unbounded run was throttled by BSE after 87
//   documents and stopped itself. BSE does not object to the request rate so much as to the RUN
//   LENGTH — the same behaviour AMFI shows on long walks. So the fix is not "go slower forever", it
//   is "go a bit slower AND stop before they make you": run a bounded chunk, let the connection go
//   quiet, come back. Resuming is free because the query only ever selects rows still unfilled.
const SPACING = numArg("--spacing", 2600);
const MAX = numArg("--max", 0);
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

// ── THE DEAD-URL LEDGER ─────────────────────────────────────────────────────────────────────────
// Some stored xbrl_urls are simply GONE from BSE: verified by hand, the NBFCUploadDocument paths
// return a real HTTP 404 under both casings, so this is BSE having removed the file, not a URL we
// build wrongly.
//
// ⚠ WITHOUT THIS LEDGER THE CHUNKED DRIVER STARVES. The queue is ordered by fiscal year and symbol,
//   so dead rows sort to the FRONT and are re-fetched on every chunk while successful rows drain out
//   behind them. MEASURED on chunk 1: 20 of 90 requests spent on the same dead documents. Left
//   alone, the dead set becomes the whole chunk and the run stops making progress while still
//   looking busy.
//
// So a row whose document 404s is recorded here and skipped from then on. It is NOT marked
// unfillable in the database — the row is fine and its document may be re-discoverable through the
// BSE announcements API later. This ledger is about not wasting a limited request budget.
const DEAD_FILE = arg("--dead", "docs/stage29-dead-urls.txt");
const loadDead = (): Set<string> => {
  try {
    return new Set(
      fs.readFileSync(DEAD_FILE, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    );
  } catch {
    return new Set();
  }
};
const recordDead = (id: string): void => {
  try {
    fs.appendFileSync(DEAD_FILE, `${id}\n`);
  } catch {
    /* the ledger is an optimisation, never fatal - a failed append costs one wasted retry */
  }
};

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 29 — BSE annual balance sheet + cash flow  ${COMMIT ? "*** COMMIT ***" : "(dry)"}`);
  console.log("=".repeat(100));

  const dead = loadDead();
  const all = await raw<{ id: string; symbol: string; fy: string; rt: string; url: string }>(`
    SELECT f.id, s.symbol, f.fiscal_year fy, f.result_type rt, f.xbrl_url url
      FROM fundamentals f JOIN stocks s ON s.id = f.stock_id
     WHERE f.source = 'bse_xbrl' AND f.xbrl_url IS NOT NULL
       -- ⚠ THE WITNESS IS A FLAG, NOT A DEFINITION. It marks "this row has not been re-read by the
       --    CURRENT extractor". When the extractor gains a column the witness must move with it, or
       --    the resume query reports zero work while the new column stays empty everywhere.
       --    interest_paid was added after the main pass, so it is the witness now.
       AND f.interest_paid IS NULL
     ORDER BY f.fiscal_year DESC, s.symbol`);
  // Filter in JS rather than SQL: the ledger is a file, and a NOT IN list of ids would grow into the
  // query text on every run.
  const live = all.filter((r) => !dead.has(r.id));
  const cap = LIMIT > 0 ? LIMIT : MAX > 0 ? MAX : 0;
  const rows = cap > 0 ? live.slice(0, Math.floor(cap)) : live;

  // Report the REAL queue, not the chunk size. Printing rows.length here said "90" on every chunk
  // regardless of how much work was left, which reads as no progress being made.
  console.log(
    `\n  BSE annual rows with no balance sheet yet: ${live.length}` +
      `${dead.size ? ` · ${dead.size} skipped (document 404s at BSE)` : ""}` +
      `${cap > 0 && live.length > cap ? ` · this chunk: ${rows.length}` : ""}\n`,
  );
  if (!rows.length) { await prisma.$disconnect(); return; }

  const pacer = new BsePacer({ minSpacingMs: SPACING });
  console.log(`  spacing ${SPACING} ms${MAX > 0 ? ` · chunk capped at ${MAX}` : ""}
`);
  const landedTally = new Map<string, number>();
  let read = 0, fetchFail = 0, filled = 0, nothing = 0, derived = 0, writeFail = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let xml: string;
    try {
      xml = await fetchInstance(pacer, r.url);
    } catch (e) {
      if (e instanceof ThrottleStopError) {
        // ⚠ STOP, do not back off and retry. Retrying is what turns a throttle into a ban, and the
        //   run resumes cleanly on a later invocation because the query only picks unfilled rows.
        console.log(`\n  ⚠ BSE throttled at ${i}/${rows.length} — stopping. Re-run later to resume.`);
        break;
      }
      fetchFail++;
      // "instance unavailable" means every candidate URL 404'd — the document is gone, not slow.
      // Record it so the next chunk does not spend a request rediscovering the same absence.
      if (/instance unavailable/i.test(String(e))) recordDead(r.id);
      if (fetchFail <= 5) console.log(`     ⚠ ${r.symbol} ${r.fy}: ${String(e).slice(0, 90)}`);
      continue;
    }
    read++;

    const cells = extractFundamentalCells(xml).cells as unknown as Record<string, number | null | undefined>;
    const cols = cellsToColumns("fundamentals", cells);
    const present = Object.entries(cols).filter(([, v]) => v !== null && v !== undefined).map(([k]) => k);

    if (!COMMIT) {
      console.log(`     ${r.symbol.padEnd(12)} ${r.fy} ${r.rt.padEnd(12)} → ${present.length} non-null cell(s) in the document`);
      if (i === 0) console.log(`        e.g. ${present.slice(0, 14).join(", ")}`);
      continue;
    }

    // ⚠ ONE ROW'S DATABASE ERROR MUST NOT KILL THE CHUNK. Originally only the FETCH was guarded, and
    //   chunks 8 and 9 both ended without reaching the summary below — the giveaway that the process
    //   was dying rather than finishing, because even the throttle path falls through to the summary.
    //   The likely thrower is a Prisma connection-pool timeout, which becomes probable exactly when a
    //   chunk runs long and slow (chunk 8: 27 minutes). Everything already committed survived, but the
    //   chunk lost its tally AND its error text — the driver overwrites the per-chunk log on the next
    //   chunk, so the evidence was destroyed twice before this was caught.
    //
    //   Now a row that throws is counted and skipped. The loop continues, the summary always prints,
    //   and a re-run picks the row up again because it is still unfilled.
    let fill: { landed: string[]; heldNotNull: string[] };
    try {
      // Prisma's interactive-transaction default is 5s, and the very first run of this script died on
      // ROW 1 with "a query cannot be executed on an expired transaction" after 5,599 ms. The BSE
      // lane's own use of fillNullColumns writes ~10 columns; this writes up to 41, each taking a FOR
      // UPDATE and an audit row, so the same call is several times the work.
      fill = await prisma.$transaction(
        async (tx) =>
          fillNullColumns(tx as unknown as TxClient, "fundamentals", r.id, cols, r.url, BSE_FILL_EDITOR,
            `${r.fy} ${r.rt} · stage 29 balance-sheet backfill`),
        { timeout: 120_000, maxWait: 20_000 },
      );
    } catch (e) {
      writeFail++;
      if (writeFail <= 5) console.log(`     ⚠ ${r.symbol} ${r.fy} write failed: ${String(e).slice(0, 140)}`);
      continue;
    }

    if (fill.landed.length) {
      filled++;
      for (const c of fill.landed) landedTally.set(c, (landedTally.get(c) ?? 0) + 1);
      // Ratios depend on the cells just landed (book value per share, inventory turnover, EPS growth).
      // deriveAfterBseWrite is best-effort by contract and never throws, so it needs no guard here.
      const d = await deriveAfterBseWrite(prisma, "fundamentals", r.id);
      if (d.changed.length) derived++;
    } else nothing++;

    if ((i + 1) % 25 === 0 || i === rows.length - 1)
      process.stdout.write(`\r  ${i + 1}/${rows.length}  read ${read} · filled ${filled} · nothing-to-fill ${nothing} · fetch-failed ${fetchFail}      `);
  }

  console.log(`\n\n  ── RESULT ──`);
  if (!COMMIT) { console.log(`  dry — re-run with --commit.\n`); await prisma.$disconnect(); return; }
  console.log(`  documents read ${read} · rows filled ${filled} · nothing to fill ${nothing} · fetch failed ${fetchFail} · write failed ${writeFail}`);
  console.log(`  rows whose ratios were re-derived afterwards: ${derived}`);
  console.log(`\n  cells landed, by column (top 25):`);
  for (const [c, n] of [...landedTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`     ${String(n).padStart(5)}  ${c}`);
  console.log("");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
