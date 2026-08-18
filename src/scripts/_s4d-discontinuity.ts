// ═══════════════════════════════════════════════════════════════
// R8 — HOW MANY STOCKS HAVE MOMENTUM TRUNCATED BY LABEL DISCONTINUITY
// RATHER THAN BY MISSING DATA? READ-ONLY.
//   npx tsx src/scripts/_s4d-discontinuity.ts
//
// SIEMENS and GILLETTE both hold 13 consecutive quarter-ends by report_date and
// still score a consecutiveTail of 4 and 7. The cause is not absence — it is that
// each company genuinely CHANGED its fiscal year, so the (fiscalYear, quarter)
// labels jump even though no quarter is missing. consecutiveTail walks label
// space, so it stops at the jump.
//
// This measures the population-level cost of that: stocks whose standalone series
// is CONTIGUOUS BY DATE but DISCONTINUOUS BY LABEL. For them, no backfill and no
// relabel can lengthen the run — the discontinuity is a true fact about the
// company, and the metric is defined on the wrong axis.
//
//   qOrdinal = fyYear*4 + (Qn-1)   — consecutive quarters differ by exactly 1
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const qOrd = (fy: string, q: string) => (2000 + parseInt(String(fy).slice(2), 10)) * 4 + (parseInt(String(q).slice(1), 10) - 1);
const dOrd = (rd: string) => { const y = +rd.slice(0, 4), m = +rd.slice(5, 7); return y * 4 + Math.floor((m - 1) / 3); };

async function main() {
  const cohort = await loadCohort();
  const syms = new Set<string>(cohort.map((c: any) => c.symbol ?? c.sym ?? c));
  const rows = await raw(`
    SELECT s."symbol" sym, t.rd::text rd, t.fy, t.q
      FROM (SELECT "stock_id" sid,"report_date" rd,"fiscal_year" fy,"quarter" q FROM quarterly_results WHERE "result_type"='standalone'
            UNION ALL SELECT "stock_id","report_date","fiscal_year","quarter" FROM banking_quarterly_results WHERE "result_type"='standalone') t
      JOIN stocks s ON s."id"=t.sid ORDER BY 1, 2`);

  const per = new Map<string, any[]>();
  for (const r of rows as any[]) { if (!syms.has(r.sym)) continue; if (!per.has(r.sym)) per.set(r.sym, []); per.get(r.sym)!.push(r); }

  const flagged: any[] = [];
  for (const [sym, rs] of per) {
    rs.sort((a, b) => String(a.rd).localeCompare(String(b.rd)));
    const breaks: string[] = [];
    for (let i = 1; i < rs.length; i++) {
      const dGap = dOrd(String(rs[i].rd).slice(0, 10)) - dOrd(String(rs[i - 1].rd).slice(0, 10));
      const lGap = qOrd(rs[i].fy, rs[i].q) - qOrd(rs[i - 1].fy, rs[i - 1].q);
      // contiguous in time but not in label space
      if (dGap === 1 && lGap !== 1) {
        breaks.push(`${String(rs[i - 1].rd).slice(0, 10)} ${rs[i - 1].fy}${rs[i - 1].q} → ${String(rs[i].rd).slice(0, 10)} ${rs[i].fy}${rs[i].q} (label jump ${lGap})`);
      }
    }
    if (breaks.length) {
      // how long is the tail AFTER the last break — that caps consecutiveTail
      const lastIdx = rs.findIndex((_, i) => i > 0 &&
        dOrd(String(rs[i].rd).slice(0, 10)) - dOrd(String(rs[i - 1].rd).slice(0, 10)) === 1 &&
        qOrd(rs[i].fy, rs[i].q) - qOrd(rs[i - 1].fy, rs[i - 1].q) !== 1);
      let last = 0;
      for (let i = 1; i < rs.length; i++) {
        const dG = dOrd(String(rs[i].rd).slice(0, 10)) - dOrd(String(rs[i - 1].rd).slice(0, 10));
        const lG = qOrd(rs[i].fy, rs[i].q) - qOrd(rs[i - 1].fy, rs[i - 1].q);
        if (dG === 1 && lG !== 1) last = i;
      }
      flagged.push({ sym, rows: rs.length, breaks, tailAfterLastBreak: rs.length - last, capsM1toM4: rs.length - last < 4, capsM5: rs.length - last < 8 });
    }
  }

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R8 — momentum truncated by LABEL discontinuity, not by missing data        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  cohort stocks holding standalone rows      : ${per.size}`);
  console.log(`  ⚠ contiguous by DATE, discontinuous by LABEL: ${flagged.length}`);
  console.log(`     of those, tail < 4 → M1..M4 BLOCKED     : ${flagged.filter((f) => f.capsM1toM4).length}`);
  console.log(`     of those, tail < 8 → M5 BLOCKED         : ${flagged.filter((f) => f.capsM5).length}`);
  console.log(`\n  ⇒ For these stocks the data is COMPLETE. No backfill lengthens the run;`);
  console.log(`    the company genuinely changed its fiscal year and the metric is defined`);
  console.log(`    on fiscal labels rather than on report_date.`);

  console.log(`\n  ${pad("symbol", 14)}${lp("rows", 6)}${lp("tail", 6)}  break(s)`);
  for (const f of flagged.sort((a, b) => a.tailAfterLastBreak - b.tailAfterLastBreak)) {
    console.log(`  ${pad(f.sym, 14)}${lp(f.rows, 6)}${lp(f.tailAfterLastBreak, 6)}  ${f.breaks[0]}${f.capsM5 ? "   ⚠ M5 blocked" : ""}`);
    for (const b of f.breaks.slice(1, 3)) console.log(`  ${pad("", 26)}  ${b}`);
    if (f.breaks.length > 3) console.log(`  ${pad("", 26)}  … ${f.breaks.length - 3} more`);
  }
  writeFileSync(`${DIR}/_s4d-discontinuity.json`, JSON.stringify(flagged, null, 1));
  console.log(`\n  → ${DIR}/_s4d-discontinuity.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
