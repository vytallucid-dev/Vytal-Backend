// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 32 — THE 52 FUND HOUSES THAT COVER 84.6% OF THE CATALOGUE. Read-only; emits a worklist.
//
//   npx tsx src/scripts/stage32-amc-logo-worklist.ts [--out docs/amc-logo-worklist.csv]
//
// Phase 1 of the logo plan needs no API, no domain resolution and no matching logic: fund houses are
// branded once, not per scheme, so 52 images cover 18,040 of 21,312 instruments. This emits the list
// to source them against, ordered by how many instruments each one actually carries — so the work is
// done in the order that makes the most of the catalogue visible first.
//
// ⚠ EMITS A FILENAME SLUG, NOT A URL. Where each logo comes from is a sourcing decision (the AMC's
//   own press kit, in almost every case); what this fixes is the NAME each file must have, so the
//   loader can match a directory of images back to fund houses without anyone re-typing 52 strings.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../db/prisma.js";

const argv = process.argv;
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "docs/amc-logo-worklist.csv";

/** "Aditya Birla Sun Life Mutual Fund" → "aditya-birla-sun-life". The trailing "Mutual Fund" carries
 *  no identity — every row has it — so it is dropped rather than repeated in 52 filenames. */
const slug = (s: string): string =>
  s.replace(/\s+mutual\s+fund$/i, "").trim().toLowerCase()
   .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main(): Promise<void> {
  const rows = (await prisma.$queryRawUnsafe(`
    SELECT fund_house, count(*)::int schemes,
           count(*) FILTER (WHERE asset_class = 'etf')::int etfs,
           count(*) FILTER (WHERE asset_class = 'mutual_fund')::int funds
      FROM instruments WHERE fund_house IS NOT NULL
     GROUP BY fund_house ORDER BY count(*) DESC`)) as Array<{ fund_house: string; schemes: number; etfs: number; funds: number }>;

  const total = rows.reduce((a, r) => a + r.schemes, 0);
  let cum = 0;
  const lines = ["rank,fund_house,expected_filename,instruments,mutual_funds,etfs,cumulative_pct_of_fund_rows"];
  rows.forEach((r, i) => {
    cum += r.schemes;
    lines.push(`${i + 1},"${r.fund_house}",${slug(r.fund_house)}.png,${r.schemes},${r.funds},${r.etfs},${((cum / total) * 100).toFixed(1)}`);
  });
  fs.writeFileSync(OUT, lines.join("\n") + "\n");

  console.log(`\n  ${rows.length} fund houses · ${total} instruments\n`);
  console.log(`  rank  fund house                              instruments   cumulative`);
  let c = 0;
  rows.forEach((r, i) => {
    c += r.schemes;
    if (i < 12 || i === rows.length - 1)
      console.log(`  ${String(i + 1).padStart(4)}  ${r.fund_house.slice(0, 38).padEnd(38)} ${String(r.schemes).padStart(6)}      ${((c / total) * 100).toFixed(1)}%`);
    if (i === 12) console.log(`        …`);
  });
  console.log(`\n  worklist → ${OUT}\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
