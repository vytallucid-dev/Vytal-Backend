// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// STAGE 28 — RE-DERIVE EVERY BSE ROW, UNGATED.  ⚠ WRITES with --commit.
//
//   npx tsx src/scripts/stage28-rederive-all-bse.ts            # dry
//   npx tsx src/scripts/stage28-rederive-all-bse.ts --commit
//
// ── WHY STAGE 25 MISSED THESE (a bug in stage 25, not a new defect) ──────────────────────────────
// Stage 25 selected rows by `witness IS NULL AND <needs> IS NOT NULL`, where <needs> was a
// hand-written list of the raw inputs a derivation requires. For the financial tables that list was
// WRONG: `banking_quarterly_results` was given `needs: [net_profit, total_income]` — but
// `total_income` is not a raw cell, it is one of the columns the derive layer EMITS (BANKQ_COLS in
// re-derive.ts). So the gate demanded, as a precondition for deriving, a value that only deriving
// could produce. Every BSE banking row failed it and was skipped, and the skip looked like a
// legitimate "no raw inputs" verdict in the output.
//
// MEASURED consequence: banking_quarterly_results BSE rows sat at 0% on nii, total_income,
// net_margin, cost_to_income_ratio, pcr, tier1_ratio and the four QoQ/YoY columns — all ten of them
// derivable from raw cells that were present on the row the whole time.
//
// ── THE CORRECTION: DO NOT GATE ON GUESSED INPUTS ────────────────────────────────────────────────
// The derive functions already handle absent inputs correctly — they emit null for what cannot be
// computed and a value for what can. A gate in front of them adds nothing except a second, unchecked
// copy of the input rules that can be wrong. So this offers EVERY BSE row to the derive layer and
// lets it decide. Rows that genuinely cannot produce anything come back as "no change", which costs
// one cheap call and no correctness.
//
// ⚠ Existing values are not overwritten by this: the derive path writes what it computes, and rows
//   already carrying correct ratios recompute to the same numbers from the same raw cells.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { reDeriveRow } from "../fill/re-derive.js";

const argv = process.argv;
const COMMIT = argv.includes("--commit");
const arg = (f: string, d: string): string => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const ONLY = arg("--only", "");
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];

const TABLES: Array<[string, string]> = [
  ["fundamentals", "Fundamental"],
  ["banking_quarterly_results", "BankingQuarterlyResult"],
  ["banking_fundamentals", "BankingFundamental"],
  ["nbfc_quarterly_results", "NbfcQuarterlyResult"],
  ["nbfc_fundamentals", "NbfcFundamental"],
  ["life_insurance_quarterly_results", "LifeInsuranceQuarterlyResult"],
  ["life_insurance_fundamentals", "LifeInsuranceFundamental"],
  ["general_insurance_quarterly_results", "GeneralInsuranceQuarterlyResult"],
  ["general_insurance_fundamentals", "GeneralInsuranceFundamental"],
  // quarterly_results is deliberately absent — stage 27 has just swept it.
];

async function main(): Promise<void> {
  console.log(`\n${"=".repeat(100)}`);
  console.log(`STAGE 28 — re-derive every BSE row, ungated  ${COMMIT ? "*** COMMIT ***" : "(dry)"}`);
  console.log("=".repeat(100));

  let gTotal = 0, gChanged = 0, gNoChange = 0, gFail = 0;
  const colTally = new Map<string, number>();

  for (const [table, key] of TABLES) {
    if (ONLY && table !== ONLY) continue;
    const ids = await raw<{ id: string }>(`SELECT id FROM "${table}" WHERE source = 'bse_xbrl' ORDER BY id`);
    gTotal += ids.length;
    console.log(`\n  ${table.padEnd(38)} ${String(ids.length).padStart(5)} BSE row(s)`);
    if (!COMMIT || !ids.length) continue;

    let changed = 0, noChange = 0, fail = 0;
    const errs: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      try {
        const r = await reDeriveRow(prisma, key, ids[i].id);
        const keys = Object.keys(r?.changed ?? {});
        if (keys.length) { changed++; for (const k of keys) colTally.set(`${table}.${k}`, (colTally.get(`${table}.${k}`) ?? 0) + 1); }
        else noChange++;
      } catch (e) { fail++; if (errs.length < 4) errs.push(`${ids[i].id}: ${String(e).slice(0, 110)}`); }
      if ((i + 1) % 100 === 0 || i === ids.length - 1)
        process.stdout.write(`\r     ${i + 1}/${ids.length}  changed ${changed} · no-change ${noChange} · failed ${fail}      `);
    }
    console.log("");
    for (const e of errs) console.log(`        ⚠ ${e}`);
    gChanged += changed; gNoChange += noChange; gFail += fail;
  }

  console.log(`\n  ── TOTAL ──`);
  if (!COMMIT) { console.log(`  ${gTotal} BSE row(s) would be offered to the derive layer.\n  dry — re-run with --commit.\n`); }
  else {
    console.log(`  rows changed ${gChanged} · no change ${gNoChange} · failed ${gFail}  (of ${gTotal})`);
    console.log(`\n  columns that gained values (top 30):`);
    for (const [c, n] of [...colTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30))
      console.log(`     ${String(n).padStart(5)}  ${c}`);
    console.log("");
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(String(e).slice(0, 3000)); await prisma.$disconnect(); process.exit(1); });
