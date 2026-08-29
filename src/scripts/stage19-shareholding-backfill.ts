// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 19 — SHAREHOLDING BACKFILL FOR THE NEWLY-SEEDED UNIVERSE.  ⚠ WRITES.
//
//   npx tsx src/scripts/stage19-shareholding-backfill.ts --dry-run
//   npx tsx src/scripts/stage19-shareholding-backfill.ts --slice 0/3 --ledger _s19-ledger.w0.json
//
// Same shape as stage 17, and deliberately so — that driver survived 1,787 symbols, three
// re-partitions and a mid-flight rebalance with zero failures, so the parts that made it survivable
// are reproduced rather than reinvented:
//
//   · PER-WORKER LEDGERS, UNION DONE-SET. Workers never write each other's file; "done" is the union
//     of every _s19-ledger*.json. That is what makes re-partitioning free — change the worker count
//     between runs and nothing is refetched, because done was never tied to who did it.
//   · ROUND-ROBIN SLICES (idx % n), not alphabetical ranges. Filing-heavy names cluster by letter, so
//     ranges finish unevenly and leave one worker grinding alone at the tail.
//   · WRITTEN AFTER EVERY SYMBOL. A kill costs at most the one in flight.
//   · ROWS COUNTED FROM THE DATABASE, never from the ingester's own return value. Stage 17 taught
//     this the hard way: its counter reported 0 while rows were genuinely landing, because writes
//     arriving through the fallback lane were invisible to it. A ledger that under-reports to zero
//     reads as a campaign achieving nothing.
//
// ── DEPTH ────────────────────────────────────────────────────────────────────────────────────────
// 8 quarters = the agreed two years. ingestShareholdingForStock is idempotent per (stock, as_on_date),
// so a re-run costs requests but never duplicates rows.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";
import { ingestShareholdingForStock } from "../ingestions/shareholdings/ingest-shareholding.js";

const argv = process.argv;
const DRY = argv.includes("--dry-run");
const RETRY_FAILED = argv.includes("--retry-failed");
const num = (f: string, d: number): number => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const arg = (f: string, d: string): string => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const QUARTERS = num("--quarters", 8);
const LIMIT = num("--limit", 0);
const PAUSE_MS = num("--pause", 300);
const SLICE = arg("--slice", "");
const [SLICE_I, SLICE_N] = SLICE ? SLICE.split("/").map(Number) : [0, 1];
const LEDGER = arg("--ledger", SLICE ? `_s19-ledger.w${SLICE_I}.json` : "_s19-ledger.json");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Entry { status: "ok" | "empty" | "failed"; at: string; rows: number; error?: string }
type Ledger = Record<string, Entry>;
const readLedger = (): Ledger => (fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) as Ledger : {});
function readAllLedgers(): Ledger {
  const m: Ledger = {};
  for (const f of fs.readdirSync(".").filter((x) => /^_s19-ledger.*\.json$/.test(x)))
    Object.assign(m, JSON.parse(fs.readFileSync(f, "utf8")) as Ledger);
  return m;
}

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 19 — shareholding backfill  ${DRY ? "(dry-run)" : "*** LIVE ***"}   ${QUARTERS} quarters   ledger ${LEDGER}`);
  console.log("=".repeat(100));

  const cohort = await prisma.$queryRawUnsafe<Array<{ symbol: string }>>(
    `SELECT s.symbol FROM stocks s WHERE s.is_active = true AND s.created_at::date >= '2026-08-26' ORDER BY s.symbol`);

  const ledger = readLedger();
  const done = new Set(Object.entries(readAllLedgers())
    .filter(([, e]) => e.status !== "failed" || !RETRY_FAILED).map(([k]) => k));
  let todo = cohort.map((c) => c.symbol).filter((s) => !done.has(s))
    .filter((_, i) => SLICE_N <= 1 || i % SLICE_N === SLICE_I);
  if (LIMIT > 0) todo = todo.slice(0, Math.floor(LIMIT));

  console.log(`\n  cohort ${cohort.length} · already attempted ${Object.keys(readAllLedgers()).length} · this run ${todo.length}${SLICE ? `  (worker ${SLICE_I + 1}/${SLICE_N})` : ""}`);
  if (!todo.length) { console.log(`\n  nothing to do.\n`); await prisma.$disconnect(); return; }
  if (DRY) { console.log(`  first 10: ${todo.slice(0, 10).join(", ")}\n`); await prisma.$disconnect(); return; }

  const rowsFor = async (symbol: string): Promise<number> => Number((await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int n FROM shareholding_patterns p JOIN stocks s ON s.id = p.stock_id WHERE s.symbol = $1`, symbol))[0]?.n ?? 0);

  const t0 = Date.now();
  let ok = 0, empty = 0, failed = 0, total = 0;
  for (let i = 0; i < todo.length; i++) {
    const symbol = todo[i];
    let e: Entry;
    try {
      await ingestShareholdingForStock(symbol, QUARTERS);
      const rows = await rowsFor(symbol);
      e = { status: rows > 0 ? "ok" : "empty", at: new Date().toISOString(), rows };
      if (rows > 0) ok++; else empty++;
      total += rows;
    } catch (err) {
      e = { status: "failed", at: new Date().toISOString(), rows: 0, error: String(err).slice(0, 200) };
      failed++;
    }
    ledger[symbol] = e;
    fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
    const n = i + 1, el = (Date.now() - t0) / 1000;
    process.stdout.write(`\r  ${n}/${todo.length}  ok ${ok} · empty ${empty} · failed ${failed} · rows ${total}  ${(el / n).toFixed(1)}s/sym  ~${Math.round((el / n) * (todo.length - n) / 60)}min left      `);
    if (i < todo.length - 1) await sleep(PAUSE_MS);
  }
  console.log(`\n\n  ── DONE ── ok ${ok} · empty ${empty} · failed ${failed} · elapsed ${((Date.now() - t0) / 60000).toFixed(1)} min\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
