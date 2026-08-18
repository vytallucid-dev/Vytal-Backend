// ═══════════════════════════════════════════════════════════════
// R1k — SIZE THE MIS-KEYED-QUARTER POPULATION. READ-ONLY.
//   npx tsx src/scripts/_r1k-keyorder.ts
//
// SIEMENS's dump showed (FY,Q) labels that do NOT advance with report_date:
//   2018-03-31→FY18Q4 · 2018-06-30→FY18Q1 · 2018-09-30→FY18Q2 · 2018-12-31→FY19Q3
// The FY label tracks a September year-end while the quarter index is computed
// off an April start — so the labels are rotated relative to real fiscal quarters.
// This is PRE-EXISTING (the pilot wrote those rows) and is NOT a fence risk — the
// pilot's v3 rows were byte-identical. But loadMomentumStandalone ORDERS BY
// (fiscalYear, quarter), so a rotated series reaches the engine out of order, and
// R4g's continuity numbers will be dominated by it if it is widespread.
//
// This counts, across the whole 442, how many stocks have a quarterly series whose
// key order disagrees with report_date order — the entire population, not just the
// stocks that straddle the v3 boundary.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

async function main() {
  const cohort = await loadCohort();
  const byId = new Map(cohort.map((c) => [c.id, c]));
  const ids = cohort.map((c) => c.id);

  const rows = await raw<any>(
    `SELECT "stock_id" sid,"fiscal_year" fy,"quarter" q,"result_type" rt,"report_date"::text rd,"source" src
       FROM quarterly_results WHERE "stock_id"=ANY($1::text[])
      UNION ALL
     SELECT "stock_id","fiscal_year","quarter","result_type","report_date"::text,"source"
       FROM banking_quarterly_results WHERE "stock_id"=ANY($1::text[])
      ORDER BY 1,5`, ids);

  const g = new Map<string, any[]>();
  for (const r of rows) { if (!g.has(r.sid)) g.set(r.sid, []); g.get(r.sid)!.push(r); }
  const ord = (fy: string, q: string) => parseInt(fy.slice(2), 10) * 10 + Number(q.slice(1));

  const bad: Array<{ sym: string; n: number; viol: number; sample: string; srcs: string }> = [];
  let clean = 0;
  for (const [sid, rs] of g) {
    // one representative row per period-end (basis does not affect the key's FY/Q)
    const byRd = new Map<string, any>();
    for (const r of rs) if (!byRd.has(r.rd)) byRd.set(r.rd, r);
    const seq = [...byRd.values()].sort((a, b) => a.rd.localeCompare(b.rd));
    let viol = 0; const ex: string[] = [];
    for (let i = 1; i < seq.length; i++) {
      if (ord(seq[i].fy, seq[i].q) < ord(seq[i - 1].fy, seq[i - 1].q)) {
        viol++;
        if (ex.length < 3) ex.push(`${seq[i - 1].rd.slice(0, 10)}→${seq[i - 1].fy}${seq[i - 1].q} then ${seq[i].rd.slice(0, 10)}→${seq[i].fy}${seq[i].q}`);
      }
    }
    if (viol) {
      const srcs = [...new Set(seq.map((s) => s.src))].join("+");
      bad.push({ sym: byId.get(sid)!.symbol, n: seq.length, viol, sample: ex[0] ?? "", srcs });
    } else clean++;
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R1k — QUARTERLY KEY ORDER vs TIME ORDER, across all 442                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  stocks holding quarterly rows      : ${g.size}`);
  console.log(`  keys advance with report_date      : ${clean}  ✓`);
  console.log(`  keys go BACKWARDS at least once    : ${bad.length}  ${bad.length ? "⚠" : "✓"}`);
  bad.sort((a, b) => b.viol - a.viol);
  console.log(`\n  ${pad("symbol", 14)}${lp("qtrs", 5)}${lp("violations", 12)}  first violation`);
  for (const b of bad) console.log(`  ${pad(b.sym, 14)}${lp(b.n, 5)}${lp(b.viol, 12)}  ${b.sample}`);

  // Does the violation live in the LEGACY rows, the v3 rows, or the seam?
  console.log(`\n  ── where the violations sit, by source ──`);
  for (const b of bad) {
    const rs = g.get([...byId.entries()].find(([, v]) => v.symbol === b.sym)![0])!;
    const byRd = new Map<string, any>(); for (const r of rs) if (!byRd.has(r.rd)) byRd.set(r.rd, r);
    const seq = [...byRd.values()].sort((a, b2) => a.rd.localeCompare(b2.rd));
    const pairs: string[] = [];
    for (let i = 1; i < seq.length; i++) {
      if (ord(seq[i].fy, seq[i].q) < ord(seq[i - 1].fy, seq[i - 1].q)) {
        pairs.push(`${seq[i - 1].src.includes("legacy") ? "L" : "V"}→${seq[i].src.includes("legacy") ? "L" : "V"}`);
      }
    }
    const cnt = new Map<string, number>(); for (const p of pairs) cnt.set(p, (cnt.get(p) ?? 0) + 1);
    console.log(`  ${pad(b.sym, 14)} ${[...cnt.entries()].map(([k, v]) => `${k}×${v}`).join(" ")}   (L=legacy source, V=v3 source)`);
  }

  console.log(`\n  ⚠ NOTE: these are the stocks that ALREADY hold quarterly rows. The run will`);
  console.log(`     add ~25 more quarters to most of the 442, so the same labelling behaviour`);
  console.log(`     will apply to every non-March filer it touches. R4g must separate`);
  console.log(`     "gap" from "mis-ordered label" or it will report the second as the first.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
