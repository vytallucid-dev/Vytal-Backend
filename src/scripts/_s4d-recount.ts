// ═══════════════════════════════════════════════════════════════
// R6 — THE CLEAN RECOUNT. READ-ONLY. Run AFTER T4 completes.
//   npx tsx src/scripts/_s4d-recount.ts
//
// ⚠ INDEXED BY report_date, NOT BY LABEL. Every label-based count in this
//   programme has been wrong at least once — the September-fiscal-year defect,
//   the ENRIN permutation, the DELHIVERY half-year declaration. report_date is
//   what the filing actually covers and is the only trustworthy key.
//
// THREE DISJOINT BUCKETS over the window 2017-06-30 .. 2024-12-31:
//   A  complete-to-2018   — holds every quarter from the window start onward
//   B  complete-from-listing — holds every quarter from its FIRST observed
//                              filing onward, but that start is after the window
//                              start (it could not have earlier data)
//   C  incomplete         — a quarter inside its own span is missing
//
// C is then split by CAUSE, which decides who can fix it:
//   C1 recoverable  — every missing standalone slot HAS a consolidated row
//                     (we lost it; a re-ingest gets it back)
//   C2 2022Jun only — the sole defect is the known FY23Q1 source gap
//   C3 source gap   — a quarter with NO row of either basis; NSE has nothing
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

const WIN_START = "2018-03-31", WIN_END = "2024-12-31";
const FY23Q1 = "2022-06-30";
const qi = (d: string) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return y * 4 + Math.floor((m - 1) / 3); };
const ql = (i: number) => { const y = Math.floor(i / 4), q = i % 4; return `${y}-${String(q * 3 + 3).padStart(2, "0")}-${[31, 30, 30, 31][q]}`; };
const I_START = qi(WIN_START), I_END = qi(WIN_END);

async function main() {
  const cohort = await loadCohort();
  const syms: string[] = cohort.map((c: any) => c.symbol ?? c.sym ?? c);
  const rows = await raw(`
    SELECT s."symbol" sym, t.rd::text rd, t.rt
      FROM (SELECT "stock_id" sid,"report_date" rd,"result_type" rt FROM quarterly_results
            UNION ALL SELECT "stock_id","report_date","result_type" FROM banking_quarterly_results) t
      JOIN stocks s ON s."id"=t.sid
     WHERE t.rd BETWEEN DATE '${WIN_START}' AND DATE '${WIN_END}'`);

  const sa = new Map<string, Set<number>>(), co = new Map<string, Set<number>>();
  for (const r of rows as any[]) {
    const i = qi(String(r.rd).slice(0, 10));
    const m = r.rt === "standalone" ? sa : co;
    if (!m.has(r.sym)) m.set(r.sym, new Set());
    m.get(r.sym)!.add(i);
  }

  const A: string[] = [], B: string[] = [], C: any[] = [];
  for (const sym of syms) {
    const S = sa.get(sym) ?? new Set<number>(), Co = co.get(sym) ?? new Set<number>();
    const any = new Set<number>([...S, ...Co]);
    if (any.size === 0) { C.push({ sym, first: null, missing: [], kind: "C3", note: "no rows at all in the window" }); continue; }
    const first = Math.min(...any);
    const missing: number[] = [];
    for (let i = first; i <= I_END; i++) if (!S.has(i)) missing.push(i);
    if (missing.length === 0) { (first <= I_START ? A : B).push(sym); continue; }
    const recoverable = missing.filter((i) => Co.has(i));
    const sourceGap = missing.filter((i) => !Co.has(i));
    let kind: string;
    if (sourceGap.length === 0) kind = "C1";
    else if (sourceGap.length === missing.length && sourceGap.every((i) => i === qi(FY23Q1))) kind = "C2";
    else kind = "C3";
    C.push({ sym, first: ql(first), missing: missing.map(ql), recoverable: recoverable.length, sourceGap: sourceGap.length, kind });
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R6 — THE CLEAN RECOUNT · window ${WIN_START} .. ${WIN_END} · by report_date  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  cohort: ${syms.length}   ·   buckets are DISJOINT and sum to the cohort`);
  console.log(`\n  A  complete to ${WIN_START}         : ${lp(A.length, 4)}`);
  console.log(`  B  complete from first filing     : ${lp(B.length, 4)}`);
  console.log(`  C  incomplete                     : ${lp(C.length, 4)}`);
  console.log(`  ${"".padEnd(36)}  ────`);
  console.log(`  ${"".padEnd(36)}  ${lp(A.length + B.length + C.length, 4)}  ${A.length + B.length + C.length === syms.length ? "✓ sums to the cohort" : "⚠ DOES NOT SUM"}`);
  console.log(`\n  complete on the standalone basis (A+B) : ${A.length + B.length}  (${((A.length + B.length) / syms.length * 100).toFixed(1)}%)`);

  // ── THE OVERLAP QUESTION ──
  const lateListed = syms.filter((s) => { const a = new Set([...(sa.get(s) ?? []), ...(co.get(s) ?? [])]); return a.size > 0 && Math.min(...a) > I_START; });
  const lateComplete = lateListed.filter((s) => B.includes(s));
  console.log(`\n  ── THE OVERLAP ──`);
  console.log(`  stocks whose first filing is AFTER ${WIN_START} (late-listed) : ${lateListed.length}`);
  console.log(`  of those, already complete from their own start              : ${lateComplete.length}`);
  console.log(`  of those, still incomplete                                   : ${lateListed.length - lateComplete.length}`);
  console.log(`  ⇒ ${lateComplete.length} late-listed stocks are complete and are counted in B, not A.`);
  console.log(`    They are NOT defects: no filing exists before they listed.`);

  // ── C, split by cause ──
  const c1 = C.filter((c) => c.kind === "C1"), c2 = C.filter((c) => c.kind === "C2"), c3 = C.filter((c) => c.kind === "C3");
  console.log(`\n  ── BUCKET C SPLIT BY CAUSE (${C.length}) ──`);
  console.log(`  C1 recoverable — consolidated held, standalone lost : ${lp(c1.length, 4)}  ← a re-ingest fixes these`);
  console.log(`  C2 the 2022Jun gap ALONE                            : ${lp(c2.length, 4)}  ← would be complete if NSE had it`);
  console.log(`  C3 genuine source gap (no row either basis)         : ${lp(c3.length, 4)}  ← not fixable by us`);
  console.log(`  ${"".padEnd(52)}  ────`);
  console.log(`  ${"".padEnd(52)}  ${lp(c1.length + c2.length + c3.length, 4)}`);

  const show = (label: string, list: any[], n = 25) => {
    if (!list.length) return;
    console.log(`\n  ── ${label} ──`);
    console.log(`  ${pad("symbol", 14)}${pad("first filing", 14)}${lp("missing", 8)}${lp("recov", 7)}${lp("nosrc", 7)}`);
    for (const c of list.slice(0, n)) console.log(`  ${pad(c.sym, 14)}${pad(c.first ?? "(none)", 14)}${lp(c.missing.length, 8)}${lp(c.recoverable ?? 0, 7)}${lp(c.sourceGap ?? 0, 7)}`);
    if (list.length > n) console.log(`  … ${list.length - n} more`);
  };
  show("C1 — recoverable by re-ingest", c1);
  show("C2 — 2022Jun only", c2);
  show("C3 — genuine source gap", c3);

  writeFileSync(`${DIR}/_s4d-recount.json`, JSON.stringify({ A, B, C, c1, c2, c3, lateListed, lateComplete }, null, 1));
  console.log(`\n  → ${DIR}/_s4d-recount.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
