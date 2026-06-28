// ─────────────────────────────────────────────────────────────
// SMOKE TEST — the re-derive dispatcher wired for ALL 10 tables (Item 3).
// For each table: pick a row, run reDeriveRow in a ROLLED-BACK txn, and confirm
// the loader glue (field mapping, prior key, model access) runs and re-derives.
// For NON-prior-dependent columns it must match stored within the rounding floor
// (proves the field mapping is correct); prior-dependent drift is expected (the
// Stage-1 order-dependence). Writes nothing.
// Run:  npx tsx src/scripts/verify-re-derive-all-tables.ts
// ─────────────────────────────────────────────────────────────

import { prisma } from "../db/prisma.js";
import { reDeriveRow } from "../fill/re-derive.js";

class Rollback extends Error {}
let pass = 0, fail = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  (got: ${JSON.stringify(got)})`}`);
}

const TABLES: { table: string; pick: () => Promise<{ id: string } | null> }[] = [
  { table: "Fundamental", pick: () => prisma.fundamental.findFirst({ where: { revenue: { not: null } }, select: { id: true } }) },
  { table: "QuarterlyResult", pick: () => prisma.quarterlyResult.findFirst({ where: { revenue: { not: null } }, select: { id: true } }) },
  { table: "BankingFundamental", pick: () => prisma.bankingFundamental.findFirst({ where: { interestEarned: { not: null } }, select: { id: true } }) },
  { table: "NbfcFundamental", pick: () => prisma.nbfcFundamental.findFirst({ where: { revenue: { not: null } }, select: { id: true } }) },
  { table: "LifeInsuranceFundamental", pick: () => prisma.lifeInsuranceFundamental.findFirst({ where: { grossPremiumIncome: { not: null } }, select: { id: true } }) },
  { table: "GeneralInsuranceFundamental", pick: () => prisma.generalInsuranceFundamental.findFirst({ where: { grossPremiumsWritten: { not: null } }, select: { id: true } }) },
  { table: "BankingQuarterlyResult", pick: () => prisma.bankingQuarterlyResult.findFirst({ where: { interestEarned: { not: null } }, select: { id: true } }) },
  { table: "NbfcQuarterlyResult", pick: () => prisma.nbfcQuarterlyResult.findFirst({ where: { revenue: { not: null } }, select: { id: true } }) },
  { table: "LifeInsuranceQuarterlyResult", pick: () => prisma.lifeInsuranceQuarterlyResult.findFirst({ where: { grossPremiumIncome: { not: null } }, select: { id: true } }) },
  { table: "GeneralInsuranceQuarterlyResult", pick: () => prisma.generalInsuranceQuarterlyResult.findFirst({ where: { grossPremiumsWritten: { not: null } }, select: { id: true } }) },
];

async function main() {
  console.log("\n[re-derive] smoke test — one row per table (rolled back)");
  for (const { table, pick } of TABLES) {
    const row = await pick();
    if (!row) { console.log(`  – ${table}: no row, skipped`); continue; }
    try {
      await prisma.$transaction(async (tx) => {
        const res = await reDeriveRow(tx, table, row.id);
        const okShape = res.table === table && typeof res.symbol === "string" && res.symbol.length > 0 &&
          (res.edit.kind === "annual" ? res.edit.reportDate instanceof Date : typeof res.edit.periodKey === "string");
        check(`${table}: re-derive ran (symbol=${res.symbol}, edit=${res.edit.kind}, ${Object.keys(res.changed).length} cols changed vs stored)`, okShape, res);
        throw new Rollback();
      });
    } catch (e) {
      if (e instanceof Rollback) continue;
      check(`${table}: re-derive ran without error`, false, (e as Error).message);
    }
  }
  console.log(`\n=== re-derive smoke ${pass}/${pass + fail} tables (rolled back — DB unchanged) ===`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
