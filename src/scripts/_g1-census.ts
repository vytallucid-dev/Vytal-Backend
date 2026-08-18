// ═══════════════════════════════════════════════════════════════
// G1 — SIZE THE FY23Q1 GAP FROM WHAT WE HOLD. READ-ONLY, zero NSE calls.
//   npx tsx src/scripts/_g1-census.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { COHORT } from "./_t4-cohort-def.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const PILOT = COHORT.map((c) => c.symbol);
const QS = ["Q1", "Q2", "Q3", "Q4"];
const FYS = ["FY19", "FY20", "FY21", "FY22", "FY23", "FY24", "FY25"];

async function main() {
  // ── budget gate: jobs + clock ──
  const [clk] = await raw<any>(`SELECT now()::text db_now, date_part('hour', now() AT TIME ZONE 'UTC')::int h, date_part('minute', now() AT TIME ZONE 'UTC')::int m`);
  const live = await raw<any>(`SELECT count(*)::int n FROM background_jobs WHERE "status" IN ('pending','running')`);
  console.log(`\n  DB clock ${clk.db_now} · UTC ${lp(clk.h, 2)}:${String(clk.m).padStart(2, "0")} · running/pending jobs ${live[0].n}`);
  console.log(`  blackout 13:00-14:10 UTC → ${Number(clk.h) === 13 || (Number(clk.h) === 14 && Number(clk.m) <= 10) ? "INSIDE" : "outside"}`);

  // ── G1a / G1b — per-quarter census, ALL 504 ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ G1a/b — PER-QUARTER CENSUS, ALL 504 STOCKS (distinct stocks holding a row) ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const rows = await raw<any>(
    `SELECT t."fiscal_year" fy, t."quarter" q,
            count(DISTINCT t."stock_id") FILTER (WHERE t."result_type"='standalone')::int sa,
            count(DISTINCT t."stock_id") FILTER (WHERE t."result_type"='consolidated')::int co,
            count(DISTINCT t."stock_id")::int any_b,
            min(t."report_date")::text rd
       FROM (SELECT "stock_id","fiscal_year","quarter","result_type","report_date" FROM quarterly_results
             UNION ALL
             SELECT "stock_id","fiscal_year","quarter","result_type","report_date" FROM banking_quarterly_results) t
      GROUP BY 1,2 ORDER BY 1,2`);
  const key = (fy: string, q: string) => `${fy}|${q}`;
  const map = new Map(rows.map((r: any) => [key(r.fy, r.q), r]));
  console.log(`  ${pad("period", 10)}${lp("standalone", 12)}${lp("consolidated", 14)}${lp("any basis", 11)}  period-end   flag`);
  for (const fy of FYS) for (const q of QS) {
    const r: any = map.get(key(fy, q));
    if (!r) { console.log(`  ${pad(fy + q, 10)}${lp(0, 12)}${lp(0, 14)}${lp(0, 11)}  —            ⚠ NO ROWS AT ALL`); continue; }
    // flag against the same-quarter neighbours (prior and next period in sequence)
    console.log(`  ${pad(fy + q, 10)}${lp(r.sa, 12)}${lp(r.co, 14)}${lp(r.any_b, 11)}  ${String(r.rd).slice(0, 10)}`);
  }

  // neighbour comparison for the suspect quarter
  console.log(`\n  ── FY23Q1 against its immediate neighbours ──`);
  for (const [fy, q] of [["FY22", "Q3"], ["FY22", "Q4"], ["FY23", "Q1"], ["FY23", "Q2"], ["FY23", "Q3"]] as const) {
    const r: any = map.get(key(fy, q));
    console.log(`     ${pad(fy + q, 8)} standalone=${lp(r?.sa ?? 0, 4)}  consolidated=${lp(r?.co ?? 0, 4)}  any=${lp(r?.any_b ?? 0, 4)}  period-end ${String(r?.rd ?? "—").slice(0, 10)}`);
  }

  // ── G1c — pilot 27 vs the other 477 ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ G1c — IS THE GAP CONFINED TO THE PILOT 27, OR UNIVERSE-WIDE?              ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const [pop] = await raw<any>(
    `WITH t AS (SELECT "stock_id","fiscal_year","quarter","result_type" FROM quarterly_results
                UNION ALL SELECT "stock_id","fiscal_year","quarter","result_type" FROM banking_quarterly_results),
         u AS (SELECT st."id", st."symbol", (st."symbol" = ANY($1::text[])) is_pilot FROM stocks st)
     SELECT
       count(*) FILTER (WHERE u.is_pilot)::int pilot_stocks,
       count(*) FILTER (WHERE NOT u.is_pilot)::int other_stocks,
       count(*) FILTER (WHERE u.is_pilot AND EXISTS (SELECT 1 FROM t WHERE t."stock_id"=u."id" AND t."fiscal_year"='FY23' AND t."quarter"='Q1' AND t."result_type"='standalone'))::int pilot_has_sa,
       count(*) FILTER (WHERE NOT u.is_pilot AND EXISTS (SELECT 1 FROM t WHERE t."stock_id"=u."id" AND t."fiscal_year"='FY23' AND t."quarter"='Q1' AND t."result_type"='standalone'))::int other_has_sa,
       count(*) FILTER (WHERE u.is_pilot AND EXISTS (SELECT 1 FROM t WHERE t."stock_id"=u."id" AND t."fiscal_year"='FY23' AND t."quarter"='Q1'))::int pilot_has_any,
       count(*) FILTER (WHERE NOT u.is_pilot AND EXISTS (SELECT 1 FROM t WHERE t."stock_id"=u."id" AND t."fiscal_year"='FY23' AND t."quarter"='Q1'))::int other_has_any,
       count(*) FILTER (WHERE u.is_pilot AND EXISTS (SELECT 1 FROM t WHERE t."stock_id"=u."id" AND t."fiscal_year"='FY22' AND t."quarter"='Q4' AND t."result_type"='standalone'))::int pilot_has_prev,
       count(*) FILTER (WHERE NOT u.is_pilot AND EXISTS (SELECT 1 FROM t WHERE t."stock_id"=u."id" AND t."fiscal_year"='FY22' AND t."quarter"='Q4' AND t."result_type"='standalone'))::int other_has_prev
     FROM u`, PILOT);
  console.log(`  ${pad("population", 22)}${lp("stocks", 8)}${lp("FY22Q4 SA", 11)}${lp("FY23Q1 SA", 11)}${lp("FY23Q1 any", 12)}`);
  console.log(`  ${pad("pilot 27 (re-ingested)", 22)}${lp(pop.pilot_stocks, 8)}${lp(pop.pilot_has_prev, 11)}${lp(pop.pilot_has_sa, 11)}${lp(pop.pilot_has_any, 12)}`);
  console.log(`  ${pad("other 477 (untouched)", 22)}${lp(pop.other_stocks, 8)}${lp(pop.other_has_prev, 11)}${lp(pop.other_has_sa, 11)}${lp(pop.other_has_any, 12)}`);

  // Which pilot stocks lack FY23Q1 standalone, and do they hold consolidated?
  const detail = await raw<any>(
    `WITH t AS (SELECT "stock_id","fiscal_year","quarter","result_type" FROM quarterly_results
                UNION ALL SELECT "stock_id","fiscal_year","quarter","result_type" FROM banking_quarterly_results)
     SELECT st."symbol" s,
            bool_or(t."result_type"='standalone') has_sa,
            bool_or(t."result_type"='consolidated') has_co
       FROM stocks st LEFT JOIN t ON t."stock_id"=st."id" AND t."fiscal_year"='FY23' AND t."quarter"='Q1'
      WHERE st."symbol" = ANY($1::text[]) GROUP BY 1 ORDER BY 1`, PILOT);
  console.log(`\n  pilot 27 — FY23Q1 holdings:`);
  const missSa = detail.filter((d: any) => !d.has_sa);
  for (const d of detail) console.log(`     ${pad(d.s, 13)} standalone=${d.has_sa ? "yes" : "NO "}  consolidated=${d.has_co ? "yes" : "NO "}${!d.has_sa ? "   ← missing standalone" : ""}`);
  console.log(`     → ${missSa.length} of 27 pilot stocks lack an FY23Q1 standalone row`);

  // ── G1d — fetch logs / ingestion errors for the Jun-2022 quarter ──
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ G1d — RECORDED FAILURE, OR SILENT ABSENCE?                                ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const cols = await raw<any>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='result_fetch_logs' ORDER BY 1`);
  console.log(`  result_fetch_logs columns: ${cols.map((c: any) => c.column_name).join(", ")}`);
  const logs = await raw<any>(
    `SELECT "status", count(*)::int n FROM result_fetch_logs
      WHERE "fiscal_year"='FY23' AND "quarter"='Q1' GROUP BY 1 ORDER BY 2 DESC`);
  console.log(`  result_fetch_logs rows for FY23/Q1: ${logs.length ? logs.map((l: any) => `${l.status}×${l.n}`).join(" · ") : "(none)"}`);
  const logsAll = await raw<any>(
    `SELECT "fiscal_year" fy, "quarter" q, count(*)::int n FROM result_fetch_logs
      WHERE "fiscal_year" IN ('FY22','FY23') GROUP BY 1,2 ORDER BY 1,2`);
  console.log(`  result_fetch_logs FY22/FY23 by period: ${logsAll.map((l: any) => `${l.fy}${l.q}×${l.n}`).join(" · ") || "(none)"}`);
  const errs = await raw<any>(
    `SELECT "source","guard_type","severity", count(*)::int n, min("created_at")::text first, max("created_at")::text last
       FROM ingestion_errors
      WHERE "target_entity" ILIKE '%FY23%Q1%' OR "detail" ILIKE '%2022-06-30%' OR "run_ref" ILIKE '%FY23%'
      GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 10`);
  console.log(`  ingestion_errors mentioning FY23Q1 / 2022-06-30: ${errs.length ? "" : "(none)"}`);
  for (const e of errs) console.log(`     ${e.source} ${e.guard_type} ${e.severity} ×${e.n}  ${String(e.first).slice(0, 10)} → ${String(e.last).slice(0, 10)}`);

  console.log(`\n  (READ-ONLY: SELECTs only. Zero NSE calls.)\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
