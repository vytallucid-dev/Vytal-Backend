// ═══════════════════════════════════════════════════════════════════════════════
// STAGE 7c — EXACT DEMAND for the five XHR-gated insurers. Read-only.
//   npx tsx src/scripts/stage7c-demand.ts
// Prints the precise (grain, basis, period) list each symbol still needs, bounded
// by listing date, so effort per site can be judged before any of it is spent.
// ═══════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";

const TARGET = "2019-03-31";
const HORIZON = "2026-06-30";
const SYMS = ["SBILIFE", "LICI", "NIACL", "GICRE", "STARHEALTH"];
const raw = async <T = any>(s: string): Promise<T[]> => (await prisma.$queryRawUnsafe(s)) as T[];

function quarterEnds(from: string, to: string): string[] {
  const out: string[] = [];
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)) + 1; y++)
    for (const e of ["-03-31", "-06-30", "-09-30", "-12-31"]) {
      const d = `${y}${e}`;
      if (d >= from && d <= to) out.push(d);
    }
  return out.sort();
}

async function main(): Promise<void> {
  const meta = await raw(`
    SELECT s.symbol, s.id, s."industryType"::text ind,
           (SELECT min(date)::date::text FROM daily_prices p WHERE p.stock_id=s.id) firstpx
      FROM stocks s WHERE s.symbol IN (${SYMS.map((x) => `'${x}'`).join(",")})`);

  const held = new Set<string>();
  for (const [tbl, grain] of [
    ["life_insurance_quarterly_results", "quarterly"],
    ["life_insurance_fundamentals", "annual"],
    ["general_insurance_quarterly_results", "quarterly"],
    ["general_insurance_fundamentals", "annual"],
  ] as const)
    for (const r of await raw(
      `SELECT s.symbol, t.result_type::text rt, t.report_date::date::text d
         FROM "${tbl}" t JOIN stocks s ON s.id=t.stock_id`))
      held.add(`${r.symbol}|${grain}|${r.rt}|${r.d}`);

  const out: Record<string, any> = {};
  let grand = 0;
  for (const m of meta.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)))) {
    const fam = m.ind === "life_insurance" ? "life" : "general";
    const floor = m.firstpx && m.firstpx > TARGET ? quarterEnds(m.firstpx, HORIZON)[0] : TARGET;
    const wantQ = quarterEnds(floor, HORIZON);
    const wantA = wantQ.filter((d) => d.endsWith("-03-31"));
    // ⚠ standalone only. Consolidated is a separate result_type and these five publish it rarely;
    //   demanding it would invent gaps. It is added per-site only where the site actually serves it.
    const missQ = wantQ.filter((d) => !held.has(`${m.symbol}|quarterly|standalone|${d}`));
    const missA = wantA.filter((d) => !held.has(`${m.symbol}|annual|standalone|${d}`));
    grand += missQ.length + missA.length;
    out[m.symbol] = { fam, listing: m.firstpx, floor, missQ, missA };
    console.log(`\n  ${m.symbol}  (${fam}, listed ${m.firstpx}, floor ${floor})`);
    console.log(`     quarterly missing ${String(missQ.length).padStart(2)} / ${wantQ.length}`);
    if (missQ.length) console.log(`        ${missQ.join("  ")}`);
    console.log(`     annual    missing ${String(missA.length).padStart(2)} / ${wantA.length}`);
    if (missA.length) console.log(`        ${missA.join("  ")}`);
  }
  console.log(`\n  TOTAL unserved units across the five: ${grand}`);
  fs.writeFileSync("_s7c-demand.json", JSON.stringify(out, null, 2));
  console.log(`  demand -> _s7c-demand.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
