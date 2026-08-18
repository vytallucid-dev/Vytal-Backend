// ═══════════════════════════════════════════════════════════════
// S4.1c — BORROWINGS-AS-ZERO: THE BLAST RADIUS. READ-ONLY.
//   npx tsx src/scripts/_s41-blast.ts
//
// foundation.ts:75 (F1 ROCE) and :191 (F4 D/E) do `debt ?? 0`, so a row with NO
// borrowings disclosed scores as debt-free — D/E = 0.00, the TOP band — with only
// a flags string to say otherwise. crossCheck() cannot catch it: it compares the
// derived value against a STORED column computed from the same absent inputs, so
// both are wrong together (and when the stored column is null it just pushes
// "stored is null (derived only)" and returns).
//
// ⚠ MISSING vs GENUINELY ZERO — the distinction the fix depends on:
//     totalDebtFrom = sumNonNull(borrowingsCurrent, borrowingsNoncurrent)
//     sumNonNull returns null ONLY if EVERY part is null.
//   So: null  ⇒ nothing was disclosed          → ABSENCE
//       0     ⇒ at least one part was reported, and it summed to zero → MEASUREMENT
//   The column CAN distinguish them, so the fix is exact: null → unavailable,
//   0 → keep scoring (a genuinely debt-free company must still score).
//
// This measures what changes: rows affected, and per stock the LATEST standalone
// annual row (the one that drives the live score) before vs after.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";

const DIR = process.env.R1_DIR ?? ".";
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ S4.1c — BORROWINGS-AS-ZERO · BLAST RADIUS                                  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  // ── 1. the shape of the column, across ALL standalone annual rows ──
  const [shape] = await raw<any>(
    `SELECT count(*)::int n,
        count(*) FILTER (WHERE "borrowings_current" IS NULL AND "borrowings_noncurrent" IS NULL)::int both_null,
        count(*) FILTER (WHERE "borrowings_current" IS NOT NULL OR "borrowings_noncurrent" IS NOT NULL)::int some_present,
        count(*) FILTER (WHERE COALESCE("borrowings_current",0)+COALESCE("borrowings_noncurrent",0) = 0
                          AND ("borrowings_current" IS NOT NULL OR "borrowings_noncurrent" IS NOT NULL))::int measured_zero,
        count(*) FILTER (WHERE "borrowings_current" IS NULL AND "borrowings_noncurrent" IS NULL
                          AND "total_debt" IS NOT NULL)::int null_but_totaldebt
       FROM fundamentals WHERE "result_type"='standalone'`);
  console.log(`\n  standalone annual rows                                : ${lp(shape.n, 7)}`);
  console.log(`  ⚠ BOTH borrowings columns NULL (absence → reads as 0): ${lp(shape.both_null, 7)}  (${((100 * shape.both_null) / shape.n).toFixed(1)}%)`);
  console.log(`  at least one borrowings column present               : ${lp(shape.some_present, 7)}`);
  console.log(`    of which the sum is a MEASURED ZERO (real debt-free): ${lp(shape.measured_zero, 7)}`);
  console.log(`  ⚠ both null BUT stored total_debt IS populated        : ${lp(shape.null_but_totaldebt, 7)}`);
  console.log(`     ⇒ totalDebtFrom() ignores stored total_debt; those rows could be`);
  console.log(`       recovered instead of made unavailable. See the recommendation.`);

  // ── 2. per stock: the LATEST standalone annual row (drives the live score) ──
  const latest = await raw<any>(
    `SELECT DISTINCT ON (f."stock_id") st."symbol" sym, st."industryType"::text ind,
            f."fiscal_year" fy, f."report_date"::text rd,
            f."borrowings_current"::float8 bc, f."borrowings_noncurrent"::float8 bnc,
            f."total_debt"::float8 td, f."total_equity"::float8 te,
            f."equity_share_capital"::float8 esc, f."other_equity"::float8 oe,
            f."profit_before_tax"::float8 pbt, f."finance_costs"::float8 fc,
            f."debt_to_equity"::float8 stored_de, f."source" src
       FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
      WHERE f."result_type"='standalone'
      ORDER BY f."stock_id", f."report_date" DESC`);

  const nw = (r: any) => (r.te !== null ? r.te : r.esc !== null && r.oe !== null ? r.esc + r.oe : null);
  const debt = (r: any) => (r.bc === null && r.bnc === null ? null : (r.bc ?? 0) + (r.bnc ?? 0));

  interface Row { sym: string; ind: string; fy: string; rd: string; deBefore: number | null; nwv: number | null; td: number | null; roceBefore: number | null; src: string }
  const affected: Row[] = [];
  let scoreable = 0, alreadyUnavailable = 0, measuredZero = 0;
  for (const r of latest) {
    const d = debt(r), w = nw(r);
    if (w === null || w === 0) { alreadyUnavailable++; continue; }   // F4 already unavailable
    if (d === null) {
      const deBefore = 0 / w;                                        // exactly what `debt ?? 0` yields
      const ebit = r.pbt !== null && r.fc !== null ? r.pbt + r.fc : null;
      const capEmp = w + 0;
      affected.push({
        sym: r.sym, ind: r.ind, fy: r.fy, rd: String(r.rd).slice(0, 10),
        deBefore, nwv: w, td: r.td,
        roceBefore: ebit !== null && capEmp !== 0 ? (ebit / capEmp) * 100 : null,
        src: r.src,
      });
    } else { scoreable++; if (d === 0) measuredZero++; }
  }

  console.log(`\n  ── PER STOCK, on the LATEST standalone annual row ──`);
  console.log(`  stocks with a latest standalone annual row           : ${latest.length}`);
  console.log(`  F4 already unavailable (net worth null/zero)         : ${alreadyUnavailable}`);
  console.log(`  debt PRESENT → unaffected by the fix                 : ${scoreable}`);
  console.log(`     of which a MEASURED ZERO (must keep scoring)      : ${measuredZero}`);
  console.log(`  ⚠ debt ABSENT → D/E currently 0.00 (TOP band)        : ${affected.length}`);
  console.log(`     ⇒ these move to UNAVAILABLE. F1 ROCE is overstated on the same rows.`);

  console.log(`\n  ── the affected stocks: BEFORE → AFTER ──`);
  console.log(`  ${pad("symbol", 14)}${pad("ind", 15)}${pad("FY", 7)}${lp("D/E before", 12)}${lp("D/E after", 12)}${lp("ROCE before", 13)}${lp("ROCE after", 12)}  stored total_debt`);
  for (const a of affected.sort((x, y) => x.sym.localeCompare(y.sym))) {
    console.log(`  ${pad(a.sym, 14)}${pad(a.ind, 15)}${pad(a.fy, 7)}${lp(a.deBefore!.toFixed(2), 12)}${lp("UNAVAIL", 12)}${lp(a.roceBefore === null ? "—" : a.roceBefore.toFixed(2) + "%", 13)}${lp("UNAVAIL", 12)}  ${a.td === null ? "null" : a.td.toFixed(2)}`);
  }

  // how many of the affected could be RECOVERED from stored total_debt instead?
  const recoverable = affected.filter((a) => a.td !== null);
  console.log(`\n  ── recovery option ──`);
  console.log(`  affected stocks whose row DOES carry stored total_debt: ${recoverable.length}/${affected.length}`);
  if (recoverable.length) for (const r of recoverable) console.log(`     ${pad(r.sym, 14)} total_debt=${r.td}`);
  console.log(`  ⇒ if totalDebtFrom fell back to stored total_debt, those would keep scoring.`);
  console.log(`    NOT done here: total_debt is itself a DERIVED column and using it would`);
  console.log(`    re-introduce the same "derived from the same absent inputs" circularity`);
  console.log(`    that makes crossCheck blind. Reported as an option, not taken.`);

  writeFileSync(`${DIR}/_s41-blast.json`, JSON.stringify({ shape, affected, recoverable: recoverable.length }, null, 1));
  console.log(`\n  → ${DIR}/_s41-blast.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
