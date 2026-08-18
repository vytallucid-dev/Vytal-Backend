// ═══════════════════════════════════════════════════════════════
// R4/T4a — DERIVE the standalone-recovery cohort, then SCREEN it for the
// malformed-declared-window defect found on DELHIVERY. READ-ONLY.
//   npx tsx src/scripts/_s4d-t4cohort.ts
//
// The cohort is Stage 4's (a) bucket: a stock holds a CONSOLIDATED row for some
// (fiscal_year, quarter) but no STANDALONE row for it. A legacy re-ingest can
// recover the standalone leg because the filing exists — we simply lost it.
//
// ⚠ THE SCREEN. T3 breached the fence because a corrected legacy label collided
//   with an old wrong v3 label. Three of those stocks are now repaired; DELHIVERY
//   is halted. Before re-ingesting 41 more stocks, verify NONE of them is a C1a
//   relabel candidate — a stock whose stored labels disagree with a true
//   March/December year-end is exactly the shape that collides.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

async function main() {
  const cohort = await loadCohort();
  const syms = new Set(cohort.map((c: any) => c.symbol ?? c.sym ?? c));
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R4/T4a — the standalone-recovery cohort, screened for collision risk       ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  442-cohort size: ${syms.size}`);

  // (fiscal_year, quarter) slots where consolidated exists and standalone does not
  const rows = await raw(`
    WITH q AS (
      SELECT s."symbol" sym, s."industryType"::text ind, t."fiscal_year" fy, t."quarter" qq,
             bool_or(t."result_type"='standalone')   sa,
             bool_or(t."result_type"='consolidated') co
        FROM (SELECT "stock_id","fiscal_year","quarter","result_type" FROM quarterly_results
                WHERE "report_date" <= DATE '2025-01-31' AND "report_date" >= DATE '2017-04-01'
              UNION ALL
              SELECT "stock_id","fiscal_year","quarter","result_type" FROM banking_quarterly_results
                WHERE "report_date" <= DATE '2025-01-31' AND "report_date" >= DATE '2017-04-01') t
        JOIN stocks s ON s."id"=t."stock_id"
       GROUP BY 1,2,3,4)
    SELECT sym, ind, count(*)::int slots FROM q
     WHERE co AND NOT sa
     GROUP BY 1,2 ORDER BY 3 DESC, 1`);

  const inCohort = rows.filter((r: any) => syms.has(r.sym));
  const totalSlots = inCohort.reduce((a: number, r: any) => a + Number(r.slots), 0);
  console.log(`  stocks with >=1 recoverable standalone slot (in cohort): ${inCohort.length}`);
  console.log(`  total recoverable slots                                : ${totalSlots}`);
  console.log(`  (outside the 442 cohort, ignored)                      : ${rows.length - inCohort.length}`);

  console.log(`\n  ── the cohort ──`);
  console.log(`  ${pad("symbol", 15)}${pad("industry", 16)}${lp("slots", 6)}`);
  for (const r of inCohort) console.log(`  ${pad(r.sym, 15)}${pad(r.ind, 16)}${lp(r.slots, 6)}`);

  // ── THE SCREEN: overlap with the C1a relabel candidates ──
  console.log(`\n  ── SCREEN: overlap with the C1a relabel candidates ──`);
  let risky: string[] = [];
  if (existsSync(`${DIR}/_c1a-candidates.json`)) {
    const c1a = JSON.parse(readFileSync(`${DIR}/_c1a-candidates.json`, "utf8"));
    const cand = new Set<string>((c1a.candidates as any[]).map((c) => c.sym));
    console.log(`  C1a candidates DB-wide: ${cand.size}  [${[...cand].join(", ")}]`);
    risky = inCohort.map((r: any) => r.sym).filter((s: string) => cand.has(s));
    console.log(`  ⇒ candidates INSIDE the T4 cohort: ${risky.length === 0 ? "✓ 0 — none of the 41 can relabel" : "⚠ " + risky.join(", ")}`);
  } else console.log(`  ⚠ _c1a-candidates.json not found — cannot screen`);

  const safe = inCohort.map((r: any) => r.sym).filter((s: string) => !risky.includes(s));
  writeFileSync(`${DIR}/_s4d-t4cohort.json`,
    JSON.stringify({ all: inCohort, risky, safe, totalSlots }, null, 1));
  console.log(`\n  T4 run list (${safe.length}):`);
  console.log(`  ${safe.join(",")}`);
  console.log(`\n  → ${DIR}/_s4d-t4cohort.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
