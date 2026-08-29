// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 25 — FILL THE STORED DERIVED COLUMNS THAT WERE NEVER COMPUTED.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage25-rederive-backfill.ts            # dry
//   npx tsx src/scripts/stage25-rederive-backfill.ts --commit
//   npx tsx src/scripts/stage25-rederive-backfill.ts --commit --only QuarterlyResult
//
// ── THE DEFECT ───────────────────────────────────────────────────────────────────────────────────
// The Fundamentals tab shows a dash for ROE, net margin, debt/equity, interest coverage, book value
// per share, the growth rates and more — on 696 stocks for the annual figures alone. The raw inputs
// are all present; what is missing is the STORED derived column.
//
// Two classes of number share that page and only one of them was broken, which is what made it look
// arbitrary: ROA, asset turnover and equity multiplier are computed at RENDER time from raw columns,
// so they show; ROE, net margin and the rest read a stored column, so they dash. Same row, same
// inputs, different answer.
//
// ── WHY THE ROWS ARE MISSING IT — MEASURED, NOT ASSUMED ──────────────────────────────────────────
//   bse_xbrl quarterly            5,222 of 5,222 rows have no net_margin
//   bse_xbrl annual                 741 of   742 have no roe
//   nse_xbrl_annual_legacy        2,758 have no roe
//   manual_workbook                  50 (mine — the stage-8 loader wrote raw cells and never derived)
//   nse_xbrl_annual                   4 — this lane calls deriveIndAsAnnual and is fine
// The NSE ingesters spread `...derived.columns` into their write. The BSE writer is INSERT … ON
// CONFLICT DO NOTHING over an explicit column list, and the BSE column-filler is a null-only UPDATE:
// neither has any notion of derivation. So every row BSE created or filled carries raw numbers and
// no ratios, and has since the lane was built.
//
// ── THIS INVENTS NOTHING ─────────────────────────────────────────────────────────────────────────
// It calls the SAME `reDerive*` functions the fill bridge already uses, which call the SAME
// `derive*` functions the ingesters call. "ingestion ≡ fill" is the existing design rule; this
// simply applies it to rows that were written by a path which never honoured it. Nothing is fetched
// and nothing is re-parsed — the arithmetic runs over columns already on the row.
//
// ⚠ A ROW WITH NO RAW INPUTS IS SKIPPED, NOT ZEROED. If net_profit or total_equity is absent, ROE is
//   unknowable and the dash is correct. Only rows that CAN produce a number are touched.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { reDeriveRow } from "../fill/re-derive.js";

const argv = process.argv;
const COMMIT = argv.includes("--commit");
const num = (f: string, d: number): number => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const arg = (f: string, d: string): string => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const ONLY = arg("--only", "");
const LIMIT = num("--limit", 0);
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

/**
 * Per table: the physical name, the RE_DERIVE key, the stored derived column that proves the row was
 * derived, and the raw inputs without which that column is genuinely unknowable.
 * The witness is chosen to be one the derivation ALWAYS produces when its inputs exist, so "witness
 * is null" means "never derived" rather than "derived to null".
 */
const TARGETS: Array<{ table: string; key: string; witness: string; needs: string[] }> = [
  { table: "fundamentals", key: "Fundamental", witness: "roe", needs: ["net_profit", "total_equity"] },
  { table: "quarterly_results", key: "QuarterlyResult", witness: "net_margin", needs: ["net_profit", "revenue"] },
  // ⚠ The financial-sector tables do NOT carry `total_equity` — they carry `net_worth`, which is the
  //   same idea under the name their own filings use. Assuming a shared column name silently skipped
  //   all three of these tables on the first run.
  { table: "banking_fundamentals", key: "BankingFundamental", witness: "roe", needs: ["net_profit", "net_worth"] },
  { table: "banking_quarterly_results", key: "BankingQuarterlyResult", witness: "net_margin", needs: ["net_profit", "total_income"] },
  { table: "nbfc_fundamentals", key: "NbfcFundamental", witness: "roe", needs: ["net_profit", "total_equity"] },
  { table: "nbfc_quarterly_results", key: "NbfcQuarterlyResult", witness: "net_margin", needs: ["net_profit", "total_income"] },
  { table: "life_insurance_fundamentals", key: "LifeInsuranceFundamental", witness: "roe", needs: ["net_profit", "net_worth"] },
  { table: "general_insurance_fundamentals", key: "GeneralInsuranceFundamental", witness: "roe", needs: ["net_profit", "net_worth"] },
  { table: "life_insurance_quarterly_results", key: "LifeInsuranceQuarterlyResult", witness: "pat_growth_yoy", needs: ["net_profit"] },
  { table: "general_insurance_quarterly_results", key: "GeneralInsuranceQuarterlyResult", witness: "pat_growth_yoy", needs: ["net_profit"] },
];

async function columnsOf(table: string): Promise<Set<string>> {
  return new Set((await raw<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, table)).map((c) => c.column_name));
}

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 25 — re-derive stored ratios  ${COMMIT ? "*** COMMIT ***" : "(dry)"}`);
  console.log("=".repeat(100));

  let grandTotal = 0, grandDone = 0, grandFail = 0, grandNoChange = 0;

  for (const t of TARGETS) {
    if (ONLY && t.key !== ONLY) continue;
    const cols = await columnsOf(t.table);
    // A table that lacks the witness or an input simply is not shaped the way this expects; say so
    // and move on rather than building SQL against a column that is not there.
    const missing = [t.witness, ...t.needs].filter((c) => !cols.has(c));
    if (missing.length) { console.log(`\n  ${t.table.padEnd(38)} skipped — no column ${missing.join(", ")}`); continue; }

    const where = `"${t.witness}" IS NULL AND ${t.needs.map((c) => `"${c}" IS NOT NULL`).join(" AND ")}`;
    const ids = await raw<{ id: string }>(
      `SELECT id FROM "${t.table}" WHERE ${where} ORDER BY id ${LIMIT > 0 ? `LIMIT ${Math.floor(LIMIT)}` : ""}`);
    const totalNull = (await raw<{ n: number }>(`SELECT count(*)::int n FROM "${t.table}" WHERE "${t.witness}" IS NULL`))[0].n;
    grandTotal += ids.length;

    console.log(`\n  ${t.table}`);
    console.log(`     rows with no ${t.witness}: ${totalNull} · of those DERIVABLE (raw inputs present): ${ids.length}`);
    if (!COMMIT || !ids.length) continue;

    let done = 0, fail = 0, noChange = 0;
    const errs: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      try {
        const r = await reDeriveRow(prisma, t.key, ids[i].id);
        if (r && Object.keys(r.changed ?? {}).length) done++; else noChange++;
      } catch (e) {
        fail++;
        if (errs.length < 5) errs.push(`${ids[i].id}: ${String(e).slice(0, 110)}`);
      }
      if ((i + 1) % 200 === 0 || i === ids.length - 1)
        process.stdout.write(`\r     re-derived ${i + 1}/${ids.length}  changed ${done} · no-change ${noChange} · failed ${fail}      `);
    }
    console.log("");
    if (errs.length) { console.log(`     first failures:`); for (const e of errs) console.log(`        ${e}`); }
    grandDone += done; grandFail += fail; grandNoChange += noChange;
  }

  console.log(`\n  ── TOTAL ──`);
  if (!COMMIT) {
    console.log(`  ${grandTotal} row(s) would be re-derived.\n  dry — re-run with --commit.\n`);
  } else {
    console.log(`  re-derived ${grandDone} · no change ${grandNoChange} · failed ${grandFail}`);
    const left = await raw<{ n: number }>(
      `SELECT count(*)::int n FROM fundamentals WHERE roe IS NULL AND net_profit IS NOT NULL AND total_equity IS NOT NULL`);
    console.log(`  annual rows still derivable-but-underived: ${left[0].n}\n`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
