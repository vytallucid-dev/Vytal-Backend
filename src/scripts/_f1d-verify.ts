// ═══════════════════════════════════════════════════════════════
// F1d — DID THE RE-INGEST ACTUALLY RECOVER THE ROWS? READ-ONLY.
//   npx tsx src/scripts/_f1d-verify.ts
//
// ⚠ "GAINED ROWS" AND "BECAME COMPLETE" ARE DIFFERENT QUESTIONS, and reporting
//   only the first is how a partial fix reads as a whole one. A stock can gain
//   four of its five missing quarters and still be incomplete.
//
// The plan (_f1ab-cohort.json) names, per stock, the exact standalone quarters
// that were missing. This re-checks each one individually.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";

const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

async function main() {
  const plan = JSON.parse(readFileSync("_f1ab-cohort.json", "utf8"));
  const clean: any[] = plan.clean;

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ F1d — what the 49-stock re-ingest actually recovered                       ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  // every standalone row now held, across both quarterly tables, per symbol
  const rows = await raw(`
    SELECT s."symbol" sym, t.rd::text rd FROM (
      SELECT "stock_id" sid,"report_date" rd FROM quarterly_results WHERE "result_type"='standalone'
      UNION ALL SELECT "stock_id","report_date" FROM banking_quarterly_results WHERE "result_type"='standalone'
    ) t JOIN stocks s ON s."id"=t.sid`);
  const held = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = r.sym;
    if (!held.has(k)) held.set(k, new Set());
    held.get(k)!.add(String(r.rd).slice(0, 10));
  }

  let gained = 0, complete = 0, stillShort = 0, recovered = 0, wanted = 0;
  const detail: any[] = [];
  for (const c of clean) {
    const have = held.get(c.sym) ?? new Set<string>();
    const got = c.missing.filter((m: string) => have.has(m));
    const still = c.missing.filter((m: string) => !have.has(m));
    wanted += c.missing.length;
    recovered += got.length;
    if (got.length > 0) gained++;
    if (still.length === 0) complete++; else stillShort++;
    detail.push({ sym: c.sym, wanted: c.missing.length, got: got.length, still });
  }

  console.log(`  stocks in the F1 cohort                    : ${clean.length}`);
  console.log(`  standalone quarters they were missing      : ${wanted}`);
  console.log(`  ── the two different questions ──`);
  console.log(`  stocks that GAINED at least one row        : ${gained}  (${((gained / clean.length) * 100).toFixed(1)}%)`);
  console.log(`  stocks whose gap is now FULLY closed       : ${complete}  (${((complete / clean.length) * 100).toFixed(1)}%)  ← the one that matters`);
  console.log(`  stocks that gained rows but are STILL short: ${gained - complete}`);
  console.log(`  stocks that gained NOTHING                 : ${clean.length - gained}`);
  console.log(`  quarters recovered / quarters wanted       : ${recovered}/${wanted}  (${((recovered / wanted) * 100).toFixed(1)}%)`);

  const short = detail.filter((d) => d.still.length);
  console.log(`\n  ── the ${short.length} stock(s) still missing a quarter ──`);
  if (!short.length) console.log(`  (none — every targeted quarter was recovered)`);
  console.log(`  ${pad("symbol", 14)}${lp("wanted", 8)}${lp("got", 6)}   still missing`);
  for (const d of short.sort((a, b) => b.still.length - a.still.length))
    console.log(`  ${pad(d.sym, 14)}${lp(d.wanted, 8)}${lp(d.got, 6)}   ${d.still.join(" ")}`);

  // is the 2022-06-30 source gap the whole residue?
  const FY23Q1 = "2022-06-30";
  const onlyFy23q1 = short.filter((d) => d.still.every((s: string) => s === FY23Q1));
  console.log(`\n  of those, still-missing is ONLY the known 2022-06-30 source gap : ${onlyFy23q1.length}`);
  console.log(`  still-missing includes something else                            : ${short.length - onlyFy23q1.length}`);

  writeFileSync("_f1d-verify.json", JSON.stringify({ cohort: clean.length, wanted, recovered, gained, complete, detail }, null, 1));
  console.log(`\n  → ./_f1d-verify.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
