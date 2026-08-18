// ═══════════════════════════════════════════════════════════════
// R5a — THE FORWARD CHECK. READ-ONLY.
//   npx tsx src/scripts/_s4d-forward.ts
//
// Everything else in this programme looks BACKWARD — did the backfill recover
// history. This asks the opposite and more urgent question: is the LIVE pipeline
// still delivering? A stock that stopped receiving data is a defect happening
// now, not a gap inherited from 2018.
//
// Three questions:
//   1. ABBOTINDIA / BAYERCROP / MCX — the three named stocks, newest row per table.
//   2. Every cohort stock — is its newest quarterly row recent enough to be alive?
//   3. The stocks missing 2022Jun (FY23Q1) — are they complete AFTER 2025, i.e. is
//      that gap a historical scar or the leading edge of an ongoing failure?
//
// "Recent enough": as of Aug 2026 the newest filed quarter is 2026-06-30 (filed
// through mid-Aug). A stock whose newest quarterly row predates 2026-03-31 has
// missed at least one full cycle and is treated as SUSPECT; predating 2025-12-31
// is STALE — two or more cycles missed.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const NAMED = ["ABBOTINDIA", "BAYERCROP", "MCX"];
const SUSPECT_BEFORE = "2026-03-31";
const STALE_BEFORE = "2025-12-31";

async function main() {
  const cohort = await loadCohort();
  const syms: string[] = cohort.map((c: any) => c.symbol ?? c.sym ?? c);
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R5a — THE FORWARD CHECK · is the live pipeline still delivering?           ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  cohort ${syms.length} · suspect if newest quarter < ${SUSPECT_BEFORE} · stale if < ${STALE_BEFORE}`);

  // ── 1. the three named stocks, newest row per table ──
  console.log(`\n  ── 1. THE THREE NAMED STOCKS — newest row in each table ──`);
  console.log(`  ${pad("symbol", 13)}${pad("table", 28)}${pad("newest report_date", 20)}${pad("label", 9)}source`);
  for (const sym of NAMED) {
    for (const t of ["quarterly_results", "fundamentals", "banking_quarterly_results", "banking_fundamentals"]) {
      const isQ = t.includes("quarterly");
      const rows = await raw(
        `SELECT x."report_date"::text rd, x."fiscal_year" fy, ${isQ ? `x."quarter" q` : `''::text q`}, x."source" src, x."result_type" rt
           FROM "${t}" x JOIN stocks s ON s."id"=x."stock_id" WHERE s."symbol"=$1
          ORDER BY x."report_date" DESC LIMIT 1`, sym);
      if (!rows.length) continue;
      const r = rows[0];
      console.log(`  ${pad(sym, 13)}${pad(t, 28)}${pad(String(r.rd).slice(0, 10), 20)}${pad(r.fy + r.q, 9)}${r.src}`);
    }
  }

  // ── 2. cohort-wide forward liveness ──
  const newest = await raw(`
    SELECT s."symbol" sym, max(t.rd)::text newest, count(*)::int n
      FROM (SELECT "stock_id" sid, "report_date" rd FROM quarterly_results
            UNION ALL SELECT "stock_id", "report_date" FROM banking_quarterly_results) t
      JOIN stocks s ON s."id"=t.sid GROUP BY 1`);
  const byS = new Map(newest.map((r: any) => [r.sym, r]));

  const stale: any[] = [], suspect: any[] = [], alive: any[] = [], nothing: string[] = [];
  for (const sym of syms) {
    const r: any = byS.get(sym);
    if (!r) { nothing.push(sym); continue; }
    const d = String(r.newest).slice(0, 10);
    if (d < STALE_BEFORE) stale.push({ sym, newest: d, n: r.n });
    else if (d < SUSPECT_BEFORE) suspect.push({ sym, newest: d, n: r.n });
    else alive.push({ sym, newest: d, n: r.n });
  }
  console.log(`\n  ── 2. COHORT-WIDE FORWARD LIVENESS ──`);
  console.log(`  ✓ alive   (newest >= ${SUSPECT_BEFORE}) : ${lp(alive.length, 4)}`);
  console.log(`  ⚠ suspect (one cycle missed)         : ${lp(suspect.length, 4)}`);
  console.log(`  ⚠⚠ STALE  (two or more missed)       : ${lp(stale.length, 4)}`);
  console.log(`  ⚠⚠ NO QUARTERLY ROWS AT ALL          : ${lp(nothing.length, 4)}`);

  if (stale.length) {
    console.log(`\n  ── ⚠⚠ STALE — these are LIVE DEFECTS ──`);
    console.log(`  ${pad("symbol", 15)}${pad("newest quarter", 17)}rows`);
    for (const s of stale.sort((a, b) => a.newest.localeCompare(b.newest))) console.log(`  ${pad(s.sym, 15)}${pad(s.newest, 17)}${lp(s.n, 5)}`);
  }
  if (suspect.length) {
    console.log(`\n  ── ⚠ SUSPECT — one cycle missed ──`);
    console.log(`  ${pad("symbol", 15)}${pad("newest quarter", 17)}rows`);
    for (const s of suspect.sort((a, b) => a.newest.localeCompare(b.newest))) console.log(`  ${pad(s.sym, 15)}${pad(s.newest, 17)}${lp(s.n, 5)}`);
  }
  if (nothing.length) console.log(`\n  ── ⚠⚠ NO QUARTERLY ROWS ──\n  ${nothing.join(", ")}`);

  // ── 3. the 2022Jun (FY23Q1) cohort — historical scar or ongoing? ──
  const missing2022 = await raw(`
    SELECT s."symbol" sym FROM stocks s
     WHERE NOT EXISTS (
       SELECT 1 FROM quarterly_results q WHERE q."stock_id"=s."id" AND q."report_date"=DATE '2022-06-30')
       AND NOT EXISTS (
       SELECT 1 FROM banking_quarterly_results b WHERE b."stock_id"=s."id" AND b."report_date"=DATE '2022-06-30')
       AND EXISTS (
       SELECT 1 FROM (SELECT "stock_id" sid FROM quarterly_results UNION ALL SELECT "stock_id" FROM banking_quarterly_results) t
        WHERE t.sid=s."id")`);
  const m22 = missing2022.map((r: any) => r.sym).filter((s: string) => syms.includes(s));
  console.log(`\n  ── 3. THE 2022Jun (FY23Q1) GAP — scar or ongoing failure? ──`);
  console.log(`  cohort stocks with NO row at 2022-06-30 : ${m22.length}`);
  let m22alive = 0, m22bad: any[] = [];
  for (const sym of m22) {
    const r: any = byS.get(sym);
    const d = r ? String(r.newest).slice(0, 10) : "(none)";
    if (r && d >= SUSPECT_BEFORE) m22alive++; else m22bad.push({ sym, newest: d });
  }
  console.log(`  of those, receiving current data (>= ${SUSPECT_BEFORE}) : ${m22alive}`);
  console.log(`  of those, ALSO broken forward                        : ${m22bad.length}`);
  for (const b of m22bad) console.log(`      ⚠ ${pad(b.sym, 15)} newest ${b.newest}`);
  console.log(`  ⇒ ${m22bad.length === 0
    ? "the 2022Jun gap is a HISTORICAL SCAR — every affected stock is live today."
    : `${m22bad.length} stock(s) are broken forward as well — not merely a scar.`}`);

  writeFileSync(`${DIR}/_s4d-forward.json`, JSON.stringify({ alive: alive.length, suspect, stale, nothing, m22: { total: m22.length, alive: m22alive, broken: m22bad } }, null, 1));
  console.log(`\n  → ${DIR}/_s4d-forward.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
