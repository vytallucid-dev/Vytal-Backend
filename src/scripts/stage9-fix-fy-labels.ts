// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 9 — NORMALISE THE FISCAL-YEAR LABELS I WROTE WRONG.  ⚠ WRITES with --apply.
//
//   npx tsx src/scripts/stage9-fix-fy-labels.ts            # inspect + collision check, writes nothing
//   npx tsx src/scripts/stage9-fix-fy-labels.ts --apply
//
// ── THE DEFECT ───────────────────────────────────────────────────────────────────────────────────
// fiscal.ts is explicit about the canonical form:
//     /** "FY25" — 2-digit year of the fiscal year END */
//     const fiscalYear = `FY${String(fyEnd.getUTCFullYear()).slice(-2)}`
// Every lane in the codebase writes that. The Stage 7b runner I wrote computed `FY${year}` with a
// FOUR-digit year, so 28 insurance rows carry "FY2019" where the rest of the database says "FY19".
//
// ── WHY IT MATTERS ───────────────────────────────────────────────────────────────────────────────
// 1. DUPLICATE QUARTERS. Each result table has a unique index on (stock_id, quarter, fiscal_year,
//    result_type) — but fiscal_year is PART of that key, so "FY19" and "FY2019" are distinct keys
//    and the index cannot stop the same quarter existing twice under two spellings. Both rows would
//    then count against the retention depth_per_key cap.
// 2. IT BREAKS decrementFY, WHICH THROWS. ingester-utils.ts matches /^FY(\d{2})$/ and throws
//    `Invalid FY format` otherwise; re-derive.ts calls it to locate the year-ago quarter. Any
//    re-derive touching one of these rows would have crashed on contact.
// The second is not latent at all — it is a live failure waiting on the next re-derive.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";

const APPLY = process.argv.includes("--apply");
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const TABLES = [
  "quarterly_results", "fundamentals", "banking_quarterly_results", "banking_fundamentals",
  "nbfc_quarterly_results", "nbfc_fundamentals", "life_insurance_quarterly_results",
  "life_insurance_fundamentals", "general_insurance_quarterly_results", "general_insurance_fundamentals",
  "shareholding_patterns",
];

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(96)}`);
  console.log(`STAGE 9 — fiscal_year label normalisation  ${APPLY ? "*** LIVE ***" : "(inspect only)"}`);
  console.log("=".repeat(96));

  let totalBad = 0, totalCollide = 0;
  for (const t of TABLES) {
    const bad = await raw<{ n: number }>(`SELECT count(*)::int n FROM "${t}" WHERE fiscal_year ~ '^FY[0-9]{4}$'`);
    if (!bad[0].n) continue;
    totalBad += bad[0].n;
    const isSh = t === "shareholding_patterns";
    const isAnnual = /fundamentals$/.test(t);

    // ⚠ COLLISION CHECK FIRST. Normalising "FY2019"->"FY19" could land on a key that already exists,
    //   which would turn a cosmetic inconsistency into a genuine duplicate. Check before touching.
    const keyCols = isSh ? `stock_id, quarter` : isAnnual ? `stock_id, result_type` : `stock_id, quarter, result_type`;
    const collide = await raw<{ symbol: string; k: string; n: number }>(`
      WITH norm AS (SELECT id, stock_id, ${isSh ? "quarter" : isAnnual ? "result_type" : "quarter, result_type"},
                           'FY' || right(fiscal_year, 2) AS fy, fiscal_year AS orig
                      FROM "${t}")
      SELECT s.symbol, n.fy k, count(*)::int n
        FROM norm n JOIN stocks s ON s.id = n.stock_id
       GROUP BY s.symbol, n.fy, ${keyCols.split(", ").map((c) => `n.${c === "stock_id" ? "stock_id" : c}`).join(", ")}
      HAVING count(*) > 1`);
    totalCollide += collide.length;

    const sample = await raw<{ symbol: string; fy: string; d: string; src: string }>(`
      SELECT s.symbol, x.fiscal_year fy, x.${isSh ? "as_on_date" : "report_date"}::date::text d, COALESCE(x.source,'?') src
        FROM "${t}" x JOIN stocks s ON s.id=x.stock_id
       WHERE x.fiscal_year ~ '^FY[0-9]{4}$' ORDER BY 1,3 LIMIT 4`);

    console.log(`\n  ${t}`);
    console.log(`     4-digit labels: ${bad[0].n}   collisions after normalising: ${collide.length}`);
    for (const s of sample) console.log(`       ${s.symbol.padEnd(12)} ${s.fy} -> FY${s.fy.slice(-2)}   ${s.d}  src=${s.src}`);
    if (collide.length) {
      console.log(`     ⚠⚠ REFUSING this table — normalising would collide with an existing row:`);
      for (const c of collide.slice(0, 6)) console.log(`        ${c.symbol} ${c.k} (${c.n} rows)`);
      continue;
    }
    if (APPLY) {
      const n = await prisma.$executeRawUnsafe(
        `UPDATE "${t}" SET fiscal_year = 'FY' || right(fiscal_year, 2), updated_at = now()
          WHERE fiscal_year ~ '^FY[0-9]{4}$'`);
      console.log(`     normalised ${n} row(s)`);
    }
  }

  console.log(`\n  ── TOTAL ──`);
  console.log(`  4-digit labels found : ${totalBad}`);
  console.log(`  collisions           : ${totalCollide}`);
  if (!APPLY && totalBad) console.log(`\n  inspect only — re-run with --apply to normalise.\n`);
  else if (!totalBad) console.log(`  nothing to do — every label is already canonical.\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 2000)); await prisma.$disconnect(); process.exit(1); });
