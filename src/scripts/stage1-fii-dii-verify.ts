// ═══════════════════════════════════════════════════════════════
// STAGE 1 VERIFY — the before/after record for the FII/DII backfill.
//
//   BASELINE (run BEFORE the --apply write):
//     npx tsx src/scripts/stage1-fii-dii-verify.ts --baseline
//   COMPARE (run AFTER):
//     npx tsx src/scripts/stage1-fii-dii-verify.ts
//
// Read-only in both modes. --baseline writes only the local snapshot file.
//
// Reports the SCORING BLAST RADIUS deliberately: fiiPct / diiPct / retailPct are
// scoring inputs, so this backfill changes the Ownership pillar for every stock
// it touches. It does NOT rescore — that stays a separate, deliberate decision.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { prisma } from "../db/prisma.js";

const BASELINE = process.argv.includes("--baseline");
const SNAP = "_s1-verify-baseline.json";

interface Snapshot {
  takenAt: string;
  totals: Record<string, number>;
  /** symbol -> count of rows with non-null fii */
  perStockFilled: Record<string, number>;
  /** symbol -> longest run of CONSECUTIVE calendar quarters with non-null fii */
  perStockRun: Record<string, number>;
}

const n = (v: unknown): number => Number(v ?? 0);

/** Quarter index from a quarter-end date: 2022-06-30 -> 2022*4 + 1. */
function qIndex(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return y * 4 + Math.floor((m - 1) / 3);
}

async function snapshot(): Promise<Snapshot> {
  const [t] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT count(*) rows_total,
            count(*) FILTER (WHERE fii_pct IS NULL) fii_null,
            count(*) FILTER (WHERE dii_pct IS NULL) dii_null,
            count(*) FILTER (WHERE banks_fis_pct IS NULL) banks_null,
            count(DISTINCT stock_id) stocks,
            count(DISTINCT stock_id) FILTER (WHERE fii_pct IS NULL) stocks_with_a_null
     FROM shareholding_patterns`,
  );
  const totals: Record<string, number> = {};
  for (const [k, v] of Object.entries(t)) totals[k] = n(v);

  // Only true quarter-end rows count toward a "consecutive quarters" run — the
  // table also holds interim/event-driven filings on arbitrary dates, which are
  // not part of the quarterly series the Ownership pillar walks.
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT symbol, as_on_date::text q FROM shareholding_patterns
     WHERE fii_pct IS NOT NULL
       AND (extract(month from as_on_date), extract(day from as_on_date)) IN ((3,31),(6,30),(9,30),(12,31))
     ORDER BY symbol, as_on_date`,
  );
  const perStockFilled: Record<string, number> = {};
  const bySym = new Map<string, number[]>();
  for (const r of rows) {
    const s = String(r.symbol);
    perStockFilled[s] = (perStockFilled[s] ?? 0) + 1;
    (bySym.get(s) ?? bySym.set(s, []).get(s)!).push(qIndex(String(r.q)));
  }
  const perStockRun: Record<string, number> = {};
  for (const [s, idxRaw] of bySym) {
    const idx = [...new Set(idxRaw)].sort((a, b) => a - b);
    let best = 1, cur = 1;
    for (let i = 1; i < idx.length; i++) {
      cur = idx[i] === idx[i - 1] + 1 ? cur + 1 : 1;
      best = Math.max(best, cur);
    }
    perStockRun[s] = idx.length ? best : 0;
  }
  return { takenAt: new Date().toISOString(), totals, perStockFilled, perStockRun };
}

function hist(runs: Record<string, number>): string {
  const buckets = [0, 1, 2, 4, 8, 12, 20];
  const counts = buckets.map((b, i) => {
    const hi = buckets[i + 1] ?? Infinity;
    return Object.values(runs).filter((v) => v >= b && v < hi).length;
  });
  return buckets
    .map((b, i) => `${b}${buckets[i + 1] ? `-${buckets[i + 1] - 1}` : "+"}:${counts[i]}`)
    .join("  ");
}

async function main(): Promise<void> {
  const snap = await snapshot();

  if (BASELINE) {
    writeFileSync(SNAP, JSON.stringify(snap, null, 2));
    console.log(`\n=== STAGE 1 BASELINE captured -> ${SNAP} ===`);
    console.log(`  ${JSON.stringify(snap.totals)}`);
    console.log(`  stocks with >=8 consecutive quarters of FII/DII: ` +
      `${Object.values(snap.perStockRun).filter((v) => v >= 8).length}`);
    console.log(`  consecutive-run histogram: ${hist(snap.perStockRun)}\n`);
    await prisma.$disconnect();
    return;
  }

  if (!existsSync(SNAP)) {
    console.error(`\nNo baseline at ${SNAP} — re-run with --baseline BEFORE applying.\n`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(SNAP, "utf8")) as Snapshot;

  console.log(`\n=== STAGE 1 VERIFY — baseline ${base.takenAt} vs now ===\n`);
  console.log(`  ${"metric".padEnd(22)} ${"before".padStart(9)} ${"after".padStart(9)} ${"delta".padStart(9)}`);
  for (const k of Object.keys(base.totals)) {
    const b = base.totals[k], a = snap.totals[k];
    console.log(`  ${k.padEnd(22)} ${String(b).padStart(9)} ${String(a).padStart(9)} ${String(a - b).padStart(9)}`);
  }

  const touched = Object.keys(snap.perStockFilled).filter(
    (s) => (snap.perStockFilled[s] ?? 0) > (base.perStockFilled[s] ?? 0),
  );
  console.log(`\n  stocks that gained FII/DII quarters: ${touched.length}`);
  const gains = touched
    .map((s) => ({ s, g: (snap.perStockFilled[s] ?? 0) - (base.perStockFilled[s] ?? 0) }))
    .sort((a, b) => b.g - a.g);
  console.log(`  biggest gains: ${gains.slice(0, 10).map((x) => `${x.s}+${x.g}`).join("  ")}`);

  const before8 = Object.values(base.perStockRun).filter((v) => v >= 8).length;
  const after8 = Object.values(snap.perStockRun).filter((v) => v >= 8).length;
  console.log(`\n  -- CONSECUTIVE-QUARTER COVERAGE (quarter-end rows only) --`);
  console.log(`  stocks with >=4 consecutive: ${Object.values(base.perStockRun).filter((v) => v >= 4).length} -> ${Object.values(snap.perStockRun).filter((v) => v >= 4).length}`);
  console.log(`  stocks with >=8 consecutive: ${before8} -> ${after8}  (delta ${after8 - before8})`);
  console.log(`  before histogram: ${hist(base.perStockRun)}`);
  console.log(`  after  histogram: ${hist(snap.perStockRun)}`);

  // ── invariants over the whole table ──
  const [inv] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT count(*) FILTER (WHERE fii_pct < 0 OR fii_pct > 100) fii_oob,
            count(*) FILTER (WHERE dii_pct < 0 OR dii_pct > 100) dii_oob,
            count(*) FILTER (WHERE fii_pct IS NOT NULL AND dii_pct IS NULL) fii_without_dii,
            count(*) FILTER (WHERE dii_pct IS NOT NULL AND fii_pct IS NULL) dii_without_fii,
            count(*) FILTER (WHERE retail_pct < 0) retail_negative
     FROM shareholding_patterns`,
  );
  console.log(`\n  -- INVARIANTS (all must be 0) --`);
  for (const [k, v] of Object.entries(inv)) console.log(`  ${k.padEnd(22)} ${n(v)}`);

  console.log(
    `\n  NOTE fiiPct/diiPct/retailPct are SCORING INPUTS. ${touched.length} stocks now have\n` +
      `  changed Ownership inputs. No rescore was triggered by this backfill (option a).\n`,
  );
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error("ERR", e);
  await prisma.$disconnect();
  process.exit(1);
});
