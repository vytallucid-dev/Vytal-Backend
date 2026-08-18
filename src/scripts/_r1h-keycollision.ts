// ═══════════════════════════════════════════════════════════════
// R1h — CAN A LEGACY FILING COLLIDE WITH A v3 ROW ON THE UPSERT KEY?
// READ-ONLY. Zero NSE calls.
//
// WHY THIS EXISTS. The upsert key is (stockId, fiscalYear, quarter, resultType).
// report_date is NOT in it. So "toDate=2025-01-31 protects v3 rows" is only true
// if no filing with period-end <= 2025-01-31 can DERIVE a fiscal key that a v3
// row already occupies.
//
// deriveFiscalPeriod (xbrl/parser-common.ts — the SAME function both the legacy
// and the v3 parser import) reads the fiscal-year window OUT OF THE DOCUMENT,
// and labels fiscalYear by the year the fiscal year ENDS. For a filer whose
// calendar never moved, period-end and key are monotone together, so the two
// eras are disjoint by construction and no collision is possible.
//
// A filer that CHANGED its year-end breaks that monotonicity: an old period-end
// and a new one can land on the same (FY, quarter) label. That is the only way
// the fence can fail, so this script finds every such stock by testing the
// monotonicity directly on the rows we already hold.
//
// KEY ORDER: fiscalYear is the year the FY ends; within it Q1<Q2<Q3<Q4. Annual
// rows are ordered as a fifth slot after Q4 of the same label.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const QI: Record<string, number> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4, "": 5, Y: 5 };
const keyOrd = (fy: string, q: string | null) => parseInt(fy.slice(2), 10) * 10 + (QI[q ?? ""] ?? 5);

// The legacy path can only reach period-ends <= this (nothing is a quarter-end
// between 2025-01-01 and 2025-01-31, so 2024-12-31 is the true ceiling).
const LEGACY_CEIL = "2024-12-31";
const V3_FLOOR = "2025-03-31";

async function main() {
  const cohort = await loadCohort();
  const byId = new Map(cohort.map((c) => [c.id, c]));
  const ids = cohort.map((c) => c.id);

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R1h — KEY-COLLISION RISK: does any stock's fiscal calendar move?           ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  legacy path can write period-ends <= ${LEGACY_CEIL} · v3 rows live at >= ${V3_FLOOR}`);

  const rows = await raw<any>(
    `SELECT "stock_id" sid, 'quarterly' kind, "fiscal_year" fy, "quarter" q, "result_type" rt, "report_date"::text rd, "source" src
       FROM quarterly_results WHERE "stock_id"=ANY($1::text[])
     UNION ALL
     SELECT "stock_id", 'quarterly', "fiscal_year", "quarter", "result_type", "report_date"::text, "source"
       FROM banking_quarterly_results WHERE "stock_id"=ANY($1::text[])
     UNION ALL
     SELECT "stock_id", 'annual', "fiscal_year", NULL, "result_type", "report_date"::text, "source"
       FROM fundamentals WHERE "stock_id"=ANY($1::text[])
     UNION ALL
     SELECT "stock_id", 'annual', "fiscal_year", NULL, "result_type", "report_date"::text, "source"
       FROM banking_fundamentals WHERE "stock_id"=ANY($1::text[])`, ids);

  // group per (stock, kind): compare the key-range of the OLD era against the v3 era
  const g = new Map<string, any[]>();
  for (const r of rows) { const k = `${r.sid}|${r.kind}`; if (!g.has(k)) g.set(k, []); g.get(k)!.push(r); }

  interface Risk { sym: string; kind: string; oldMaxKey: string; oldMaxOrd: number; v3MinKey: string; v3MinOrd: number; v3rd: string }
  const risks: Risk[] = [];
  const shifted: Array<{ sym: string; kind: string; note: string }> = [];

  for (const [k, rs] of g) {
    const [sid, kind] = k.split("|");
    const sym = byId.get(sid)!.symbol;
    const old = rs.filter((r) => r.rd.slice(0, 10) <= LEGACY_CEIL);
    const v3 = rs.filter((r) => r.rd.slice(0, 10) >= V3_FLOOR);
    if (!old.length || !v3.length) continue;

    // 1. MONOTONICITY within this stock+kind: does report_date order agree with key order?
    const sorted = [...rs].sort((a, b) => a.rd.localeCompare(b.rd));
    let mono = true;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].rd === sorted[i - 1].rd) continue;
      if (keyOrd(sorted[i].fy, sorted[i].q) < keyOrd(sorted[i - 1].fy, sorted[i - 1].q)) { mono = false; break; }
    }
    if (!mono) shifted.push({ sym, kind, note: "key order disagrees with report_date order — calendar moved" });

    // 2. THE ACTUAL COLLISION TEST: does the highest key reachable by a legacy-era
    //    period-end reach or pass the lowest key a v3 row occupies?
    const oldMax = old.reduce((a, b) => (keyOrd(a.fy, a.q) >= keyOrd(b.fy, b.q) ? a : b));
    const v3Min = v3.reduce((a, b) => (keyOrd(a.fy, a.q) <= keyOrd(b.fy, b.q) ? a : b));
    if (keyOrd(oldMax.fy, oldMax.q) >= keyOrd(v3Min.fy, v3Min.q)) {
      risks.push({
        sym, kind,
        oldMaxKey: `${oldMax.fy}${oldMax.q ?? ""}`, oldMaxOrd: keyOrd(oldMax.fy, oldMax.q),
        v3MinKey: `${v3Min.fy}${v3Min.q ?? ""}`, v3MinOrd: keyOrd(v3Min.fy, v3Min.q), v3rd: v3Min.rd.slice(0, 10),
      });
    }
  }

  console.log(`\n  ── A. stocks whose KEY ORDER disagrees with report_date order (calendar moved) ──`);
  console.log(`     ${shifted.length === 0 ? "✓ none — every cohort stock's fiscal keys advance with time" : "⚠ " + shifted.length}`);
  for (const s of shifted) console.log(`     ⚠ ${pad(s.sym, 14)} ${pad(s.kind, 10)} ${s.note}`);

  console.log(`\n  ── B. COLLISION TEST — highest legacy-era key vs lowest v3-era key, per stock ──`);
  console.log(`     (a legacy write can only reach keys <= its own era's highest; if that is BELOW`);
  console.log(`      the lowest v3 key, no legacy filing can address a v3 row at all)`);
  if (!risks.length) {
    console.log(`     ✓ ZERO stocks at risk — for every cohort stock, every legacy-era key sorts`);
    console.log(`       strictly BELOW every v3-era key. The two eras cannot share an upsert key.`);
  }
  for (const r of risks) {
    console.log(`     ⚠ ${pad(r.sym, 14)} ${pad(r.kind, 10)} legacy-era max key ${pad(r.oldMaxKey, 8)} >= v3 min key ${pad(r.v3MinKey, 8)} (rd ${r.v3rd})`);
  }

  // ── C. the margin, stated as a number ──
  console.log(`\n  ── C. THE MARGIN, per stock (how many key slots separate the eras) ──`);
  let minMargin = Infinity, minSym = "";
  const margins: Array<{ sym: string; kind: string; m: number; oldK: string; v3K: string }> = [];
  for (const [k, rs] of g) {
    const [sid, kind] = k.split("|");
    const old = rs.filter((r: any) => r.rd.slice(0, 10) <= LEGACY_CEIL);
    const v3 = rs.filter((r: any) => r.rd.slice(0, 10) >= V3_FLOOR);
    if (!old.length || !v3.length) continue;
    const oldMax = old.reduce((a: any, b: any) => (keyOrd(a.fy, a.q) >= keyOrd(b.fy, b.q) ? a : b));
    const v3Min = v3.reduce((a: any, b: any) => (keyOrd(a.fy, a.q) <= keyOrd(b.fy, b.q) ? a : b));
    const m = keyOrd(v3Min.fy, v3Min.q) - keyOrd(oldMax.fy, oldMax.q);
    margins.push({ sym: byId.get(sid)!.symbol, kind, m, oldK: `${oldMax.fy}${oldMax.q ?? ""}`, v3K: `${v3Min.fy}${v3Min.q ?? ""}` });
    if (m < minMargin) { minMargin = m; minSym = `${byId.get(sid)!.symbol} ${kind}`; }
  }
  const dist = new Map<number, number>();
  for (const m of margins) dist.set(m.m, (dist.get(m.m) ?? 0) + 1);
  console.log(`     margin distribution: ${[...dist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}→${v}`).join(" · ")}`);
  console.log(`     TIGHTEST margin: ${minMargin} key slot(s), at ${minSym}`);
  for (const m of margins.filter((x) => x.m <= 1).slice(0, 25)) {
    console.log(`       ⚠ ${pad(m.sym, 14)} ${pad(m.kind, 10)} legacy max ${pad(m.oldK, 8)} → v3 min ${pad(m.v3K, 8)}  margin ${m.m}`);
  }

  // ── D. the calendar-shift suspects named explicitly ──
  console.log(`\n  ── D. the non-March filers and transition-period filers, listed by name ──`);
  const odd = await raw<any>(
    `WITH t AS (SELECT "stock_id" sid,"fiscal_year" fy,"quarter" q,"report_date"::text rd FROM quarterly_results
                UNION ALL SELECT "stock_id","fiscal_year","quarter","report_date"::text FROM banking_quarterly_results)
     SELECT st."symbol" s, st."fiscalYearEnd"::text fye,
            min(t.rd) FILTER (WHERE t.q='Q1')::text q1_min, max(t.rd) FILTER (WHERE t.q='Q1')::text q1_max,
            count(*)::int n
       FROM stocks st JOIN t ON t.sid=st."id" WHERE st."id"=ANY($1::text[])
      GROUP BY 1,2
     HAVING to_char(min(t.rd) FILTER (WHERE t.q='Q1')::date,'MM') <> to_char(max(t.rd) FILTER (WHERE t.q='Q1')::date,'MM')
      ORDER BY 1`, ids);
  console.log(`     ${odd.length} stock(s) whose Q1 period-end MONTH is not constant across history:`);
  for (const o of odd) console.log(`       ⚠ ${pad(o.s, 14)} fye=${pad(o.fye, 9)} Q1 ends ${o.q1_min.slice(0, 10)} … ${o.q1_max.slice(0, 10)}  (${o.n} qtr rows)`);

  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
