// ═══════════════════════════════════════════════════════════════
// S4.4 PROOF — with the S4.3 labels, does ENRIN's Momentum come back?
// READ-ONLY, in memory. Uses the ENGINE's own functions, not a reconstruction.
//   npx tsx src/scripts/_s44-proof.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { consecutiveTail, m1TtmOpm, m2TtmNpm, m3RevenueYoyTtm, m4NetProfitYoyTtm, m5TtmInterestCoverage } from "../scoring/metrics/momentum.js";
import type { MomentumQuarter } from "../scoring/metrics/types.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const qOrd = (fy: string, q: string) => parseInt(fy.slice(2), 10) * 4 + (Number(q.slice(1)) - 1);
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// the labels the S4.3 deriver produces for ENRIN's Oct–Sep window (measured in _s44-enrin.ts)
const CORRECTED: Record<string, [string, string]> = {
  "2025-03-31": ["FY25", "Q2"], "2025-06-30": ["FY25", "Q3"], "2025-09-30": ["FY25", "Q4"],
  "2025-12-31": ["FY26", "Q1"], "2026-03-31": ["FY26", "Q2"], "2026-06-30": ["FY26", "Q3"],
};

async function main() {
  const rows = await raw<any>(
    `SELECT q."fiscal_year" fy,q."quarter" qq,q."report_date"::text rd,q."revenue"::float8 rev,
            q."other_income"::float8 oi,q."interest"::float8 intr,q."depreciation"::float8 dep,
            q."profit_before_tax"::float8 pbt,q."net_profit"::float8 np,q."operating_profit"::float8 op
       FROM quarterly_results q JOIN stocks st ON st."id"=q."stock_id"
      WHERE st."symbol"='ENRIN' AND q."result_type"='standalone' ORDER BY q."report_date"`);

  const mk = (r: any, fy: string, q: string): MomentumQuarter => ({
    fiscalYear: fy, quarter: q, qOrdinal: qOrd(fy, q),
    revenue: n(r.rev), otherIncome: n(r.oi), interest: n(r.intr), depreciation: n(r.dep),
    profitBeforeTax: n(r.pbt), netProfit: n(r.np), operatingProfitStored: n(r.op),
  });

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ S4.4 PROOF — ENRIN Momentum, stored labels vs S4.3-corrected labels        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("report_date", 13)}${pad("stored", 9)}${pad("S4.3", 9)}${pad("stored ord", 12)}S4.3 ord`);
  for (const r of rows) {
    const rd = String(r.rd).slice(0, 10);
    const c = CORRECTED[rd];
    console.log(`  ${pad(rd, 13)}${pad(r.fy + r.qq, 9)}${pad(c ? c[0] + c[1] : "?", 9)}${pad(qOrd(r.fy, r.qq), 12)}${c ? qOrd(c[0], c[1]) : "?"}`);
  }

  const run = (qs: MomentumQuarter[], label: string) => {
    const tail = consecutiveTail(qs);
    const snap = tail.at(-1);
    console.log(`\n  ── ${label} ──`);
    console.log(`     consecutiveTail : ${tail.length} quarter(s)`);
    console.log(`     snapshot quarter: ${snap ? snap.fiscalYear + snap.quarter : "—"}`);
    const ms: [string, any][] = [["M1 TTM OPM", m1TtmOpm(tail)], ["M2 TTM NPM", m2TtmNpm(tail)],
      ["M3 Rev YoY TTM", m3RevenueYoyTtm(tail)], ["M4 NP YoY TTM", m4NetProfitYoyTtm(tail)],
      ["M5 TTM IntCov", m5TtmInterestCoverage(tail)]];
    let avail = 0;
    for (const [nm, v] of ms) {
      const ok = v?.value !== null && v?.value !== undefined;
      if (ok) avail++;
      console.log(`     ${pad(nm, 18)} ${ok ? Number(v.value).toFixed(2) : "null  (" + (v?.reason ?? "—") + ")"}`);
    }
    return { tail: tail.length, snap: snap ? snap.fiscalYear + snap.quarter : null, avail };
  };

  const a = run(rows.map((r: any) => mk(r, r.fy, r.qq)), "AS STORED — what the engine reads TODAY");
  const b = run(rows.map((r: any) => { const c = CORRECTED[String(r.rd).slice(0, 10)]; return mk(r, c[0], c[1]); }), "WITH S4.3 LABELS");

  const newestRd = rows.at(-1) ? String(rows.at(-1).rd).slice(0, 10) : "—";
  const newestCorrect = CORRECTED[newestRd];
  console.log(`\n  ══ VERDICT ══`);
  console.log(`  chronologically newest row : ${newestRd} = ${newestCorrect ? newestCorrect[0] + newestCorrect[1] : "?"} under S4.3`);
  console.log(`  snapshot BEFORE : ${a.snap}   (tail ${a.tail}, ${a.avail}/5 metrics)`);
  console.log(`  snapshot AFTER  : ${b.snap}   (tail ${b.tail}, ${b.avail}/5 metrics)`);
  console.log(`  ⇒ ${b.snap === (newestCorrect ? newestCorrect[0] + newestCorrect[1] : null)
      ? "✓ the engine now anchors on the NEWEST row, and the tail spans the whole series"
      : "⚠ still not anchored on the newest row"}`);
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
