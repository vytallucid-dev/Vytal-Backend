// STEP 21 — GATE 3 VERIFY. Exercises the weekly-series feature end-to-end and asserts.
import { prisma } from "../db/prisma.js";
import { rescaleForSplits, sampleWeekly, isoWeekOf, type SeriesPoint } from "../portfolio/history/weekly-sample.js";
import { runBackfill, loadTargets } from "../portfolio/history/backfill.js";
import { computeLedgerBookValue } from "../portfolio/history/live-value.js";
import { computePortfolioNav } from "../portfolio/nav/assemble.js";

let fails = 0;
const ok = (m: string) => console.log("  ✅ " + m);
const bad = (m: string) => { console.log("  ❌ " + m); fails++; };
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

// Baseline fingerprints captured pre-build (recon-step21-baseline.ts). Must NOT move.
const BASELINE: Record<string, number> = {
  mf_analytics: 30250295949328, daily_prices: 1216470182676443, stock_prices: 1067199306256,
  score_snapshots: 5156217484191, market_cap_tier_snapshot: 1083745276939, instruments: 40849366767338,
  instrument_corporate_events: 134636592678, index_prices: 311088550838147,
};

async function fp(t: string): Promise<number> {
  const r = await prisma.$queryRawUnsafe<{ f: bigint }[]>(
    `SELECT COALESCE(SUM(('x'||substr(md5(t::text),1,8))::bit(32)::bigint),0)::bigint AS f FROM ${t} t`);
  return Number(r[0].f);
}

async function main() {
  // ── 1. BYTE-IDENTICAL (un-waivable): the build touched none of these tables. ──
  console.log("\n[1] BYTE-IDENTICAL fingerprints");
  for (const [t, expected] of Object.entries(BASELINE)) {
    const got = await fp(t);
    got === expected ? ok(`${t} unchanged (${got})`) : bad(`${t} MOVED: ${got} ≠ ${expected}`);
  }

  // ── 2. RESCALE removes the 1:10 cliff (the NIFTYBEES/NAV correction, Ruling B origin). ──
  console.log("\n[2] SPLIT-RESCALE removes the cliff");
  const raw: SeriesPoint[] = [];
  for (let i = 0; i < 20; i++) raw.push({ date: `2023-01-${String(i + 1).padStart(2, "0")}`, value: 2500 }); // pre-split ~2500
  for (let i = 0; i < 20; i++) raw.push({ date: `2023-02-${String(i + 1).padStart(2, "0")}`, value: 250 });  // post-split ~250
  const splitDay = Math.floor(Date.parse("2023-02-01T00:00:00Z") / 86_400_000);
  const corrected = rescaleForSplits(raw, [{ appliedDay: splitDay, factor: 10 }]);
  const cliff = Math.max(...corrected.map((p) => p.value)) / Math.min(...corrected.map((p) => p.value));
  cliff < 1.05 ? ok(`no cliff after rescale (max/min = ${cliff.toFixed(3)}, was 10.0 raw)`) : bad(`cliff survived: ${cliff.toFixed(2)}x`);

  // ── 3. WEEKLY sampler: ≤ ~209 pts over 4y, one per ISO week, ascending, in-window. ──
  console.log("\n[3] WEEKLY sampler bounds + one-per-week");
  const daily: SeriesPoint[] = [];
  const start = new Date("2021-07-15T00:00:00Z"); // 5y of daily → must clip to last 4y
  for (let i = 0; i < 5 * 365; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    daily.push({ date: d.toISOString().slice(0, 10), value: 100 + i * 0.01 });
  }
  const weekly = sampleWeekly(daily, "2026-07-15", 4);
  weekly.length <= 210 && weekly.length >= 200 ? ok(`${weekly.length} weekly points (≤ ⌈4y/7⌉)`) : bad(`unexpected count ${weekly.length}`);
  const weeks = new Set(weekly.map((p) => isoWeekOf(p.date)));
  weeks.size === weekly.length ? ok("exactly one point per ISO week") : bad("duplicate weeks in sample");
  const asc = weekly.every((p, i) => i === 0 || p.date > weekly[i - 1].date);
  asc && weekly[0].date >= "2022-07-15" ? ok("ascending + within the 4y window (oldest ≥ 2022-07-15)") : bad("ordering/window wrong");

  // ── 4. FUND BACKFILL (one mfapi call) — corrected, sampled, persisted, progress reported. ──
  console.log("\n[4] FUND backfill on a held mutual fund");
  const heldFund = await prisma.$queryRawUnsafe<{ instrument_id: string; user_id: string }[]>(`
    WITH pos AS (SELECT t.user_id, t.instrument_id,
                        SUM(CASE WHEN t.type='buy' THEN COALESCE(t.quantity,0)
                                 WHEN t.type='sell' THEN -COALESCE(t.quantity,0) ELSE 0 END) AS q
                 FROM transactions t GROUP BY t.user_id, t.instrument_id)
    SELECT pos.instrument_id, pos.user_id FROM pos
    JOIN instruments i ON i.id=pos.instrument_id
    WHERE pos.q > 0 AND i.asset_class='mutual_fund' LIMIT 1`);
  if (heldFund.length === 0) { bad("no held mutual fund to exercise — skipping 4-7"); }
  else {
    const { instrument_id: fundId, user_id: fundUser } = heldFund[0];
    const targets = await loadTargets([fundId]);
    let progressTicks = 0, lastNote = "";
    const rep1 = await runBackfill(targets, { report: async (_p, note) => { progressTicks++; lastNote = note; } });
    const out = rep1.outcomes[0];
    out.reason === null && out.source === "nav_corrected" && out.pointsStored > 0
      ? ok(`charted: ${out.pointsStored} pts, source=${out.source}, via=${out.via}`)
      : bad(`fund backfill failed: ${JSON.stringify(out)}`);
    progressTicks > 0 ? ok(`progress reported (${progressTicks} ticks, last: "${lastNote}")`) : bad("no progress ticks");

    // ── 5. ROLLING BOUND: ≤ ~209 rows for this instrument (sampler + DB trigger). ──
    const cnt = await prisma.instrumentPriceHistory.count({ where: { instrumentId: fundId } });
    cnt <= 210 ? ok(`rolling bound holds: ${cnt} rows ≤ ~209`) : bad(`too many rows: ${cnt}`);

    // ── 6. IDEMPOTENT: re-run stores 0 new. ──
    const rep2 = await runBackfill(targets, {});
    rep2.pointsStored === 0 ? ok("idempotent re-run stored 0 new rows") : bad(`re-run stored ${rep2.pointsStored} (expected 0)`);

    // ── 7. SYNC ASSERTION: the chart's final point EQUALS the ledgered book's live value. ──
    console.log("\n[7] SYNC assertion (chart endpoint == overview/ledger value)");
    const live = await computeLedgerBookValue(fundUser);
    const nav = await computePortfolioNav(fundUser);
    const finalPt = nav.series[nav.series.length - 1];
    finalPt && live.value != null && near(finalPt.value, Math.round(live.value * 100) / 100)
      ? ok(`chart final ₹${finalPt.value} == ledger live ₹${(Math.round(live.value * 100) / 100)}`)
      : bad(`SYNC MISMATCH: chart ${finalPt?.value} ≠ ledger ${live.value}`);
    // The fund is now CHARTED → no longer in excludedFromSeries (honest-empty narrowed).
    const stillExcluded = nav.excludedFromSeries.some((e) => e.assetClass === "mutual_fund");
    !stillExcluded ? ok("held fund is now CHARTED (removed from excludedFromSeries)") : bad("fund still excluded after backfill");
    nav.blended === true ? ok("blended=true → 4Y cap engaged for this book") : bad("blended flag not set on a fund-holding book");
  }

  console.log(fails === 0 ? "\n✅ ALL GATE-3 CHECKS PASSED" : `\n❌ ${fails} CHECK(S) FAILED`);
  process.exitCode = fails === 0 ? 0 : 1;
}
main().catch((e) => { console.error("VERIFY ERROR:", e); process.exit(1); }).finally(() => prisma.$disconnect());
