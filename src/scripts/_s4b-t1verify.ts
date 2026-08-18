// ═══════════════════════════════════════════════════════════════
// T1 VERIFY — did the 9 overflow-lost filings land, and did the display ratio
// store NULL rather than a clamped number? READ-ONLY.
//   npx tsx src/scripts/_s4b-t1verify.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const WINDOW_END = "2022-01-31";
const CEIL = 10000;

// the 9 ABSENT filings from the Stage 3b R5a-lost analysis
const TARGETS: Array<{ sym: string; rd: string; basis: string }> = [
  { sym: "ADANIENSOL", rd: "2019-06-30", basis: "standalone" },
  { sym: "ADANIENSOL", rd: "2019-09-30", basis: "standalone" },
  { sym: "ADANIENSOL", rd: "2020-06-30", basis: "standalone" },
  { sym: "ADANIENSOL", rd: "2020-09-30", basis: "standalone" },
  { sym: "ADANIENSOL", rd: "2022-09-30", basis: "standalone" },
  { sym: "ADANIENSOL", rd: "2023-06-30", basis: "standalone" },
  { sym: "KAYNES", rd: "2023-03-31", basis: "consolidated" },
  { sym: "MMTC", rd: "2024-03-31", basis: "consolidated" },
  { sym: "RPOWER", rd: "2023-03-31", basis: "standalone" },
];

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T1 VERIFY — the 9 previously-lost filings                                  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  ${pad("symbol", 13)}${pad("period end", 12)}${pad("basis", 14)}${pad("present?", 10)}${pad("key", 8)}${lp("revenue", 10)}${lp("netProfit", 11)}  opMargin / netMargin`);
  let present = 0, inWindowPresent = 0, clamped = 0, nulled = 0;
  for (const t of TARGETS) {
    const rows = await raw<any>(
      `SELECT q."fiscal_year" fy,q."quarter" qq,q."revenue"::float8 rev,q."net_profit"::float8 np,
              q."operating_margin"::float8 om,q."net_margin"::float8 nm,q."source" src,
              q."profit_before_tax"::float8 pbt,q."depreciation"::float8 dep,q."interest"::float8 intr,
              q."other_income"::float8 oi,q."operating_profit"::float8 op
         FROM quarterly_results q JOIN stocks st ON st."id"=q."stock_id"
        WHERE st."symbol"=$1 AND q."report_date"=DATE '${t.rd}' AND q."result_type"=$2`, t.sym, t.basis);
    const inWin = t.rd <= WINDOW_END;
    if (!rows.length) {
      console.log(`  ${pad(t.sym, 13)}${pad(t.rd, 12)}${pad(t.basis, 14)}${pad("✗ ABSENT", 10)}${inWin ? "  ⚠ IN-WINDOW" : ""}`);
      continue;
    }
    present++; if (inWin) inWindowPresent++;
    const r = rows[0];
    // ⚠ the display ratios must be NULL, not clamped to the ceiling
    const omBad = r.om !== null && Math.abs(r.om) >= CEIL - 1;
    const nmBad = r.nm !== null && Math.abs(r.nm) >= CEIL - 1;
    if (omBad || nmBad) clamped++;
    if (r.om === null) nulled++;
    console.log(`  ${pad(t.sym, 13)}${pad(t.rd, 12)}${pad(t.basis, 14)}${pad("✓ PRESENT", 10)}${pad(r.fy + r.qq, 8)}${lp(r.rev, 10)}${lp(r.np, 11)}  ${r.om === null ? "null" : r.om} / ${r.nm === null ? "null" : r.nm}${inWin ? "   ⚠ IN-WINDOW" : ""}`);
    // the score-relevant columns must all be there
    const sr = { revenue: r.rev, otherIncome: r.oi, interest: r.intr, depreciation: r.dep, profitBeforeTax: r.pbt, netProfit: r.np, operatingProfit: r.op };
    const miss = Object.entries(sr).filter(([, v]) => v === null).map(([k]) => k);
    console.log(`     ${pad("", 37)}score-relevant 7/7: ${miss.length === 0 ? "✓ complete" : "⚠ missing " + miss.join(",")}   src=${r.src}`);
  }
  console.log(`\n  ── VERDICT ──`);
  console.log(`  filings now present            : ${present}/9`);
  console.log(`  of which INSIDE the Jan-2022 window : ${inWindowPresent}/4  ${inWindowPresent === 4 ? "✓ all four recovered" : "⚠"}`);
  console.log(`  display ratio stored as NULL   : ${nulled}  (never clamped)`);
  console.log(`  ⚠ any value clamped to the ceiling instead of nulled: ${clamped === 0 ? "✓ 0" : "⚠ " + clamped}`);
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
