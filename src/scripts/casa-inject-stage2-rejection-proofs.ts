// STAGE 2 — PROVE the CASA-injection validation REJECTS (the correctness gate, not just
// happy-path). Runs inside a transaction that is ALWAYS ROLLED BACK — nothing durable.
//   npx tsx src/scripts/casa-inject-stage2-rejection-proofs.ts
//
// Proves: valid→ACCEPTED(found,inserted v1) · no-citation→REJECTED(CN-4) · 0.34 fraction→
// REJECTED(unit band) · missing-quarter→REJECTED · bad-symbol→REJECTED · second inject→
// SUPERSEDES(v2) · confidence-C→ACCEPTED+warn. All on quarter-keyed (FY26/Q1) cells.

import { prisma } from "../db/prisma.js";
import { injectLiveCasa } from "../ingestions/bank-supplementary/inject-casa.js";

const ROLLBACK = Symbol("rollback");
const show = (label: string, r: Awaited<ReturnType<typeof injectLiveCasa>>) => {
  const verdict = r.ok ? `ACCEPTED (${r.action} v${r.version})` : "REJECTED";
  console.log(`\n  ${label}`);
  console.log(`    → ${verdict}`);
  if (r.errors.length) for (const e of r.errors) console.log(`      ✗ ${e}`);
  if (r.warnings.length) for (const w of r.warnings) console.log(`      ⚑ ${w}`);
};

async function main() {
  console.log("═══ STAGE 2 — CASA INJECTION REJECTION PROOFS (rolled back) ═══");

  let pass = 0, fail = 0;
  const expect = (name: string, cond: boolean) => { if (cond) { pass++; } else { fail++; console.error(`  ✗✗ EXPECTATION FAILED: ${name}`); } };

  try {
    await prisma.$transaction(async (tx) => {
      // 1. VALID — ICICIBANK quarterly CASA (FY26/Q1) with a real citation. FY26/Q1 is a
      //    FRESH quarter-keyed cell (bulk rows are all quarter=null), so this INSERTS v1.
      const valid = await injectLiveCasa({
        symbol: "ICICIBANK", fiscalYear: "FY26", quarter: "Q1", periodEnd: "30-Jun-2025",
        value: 38.4, sourceCitation: "ICICI Bank Q1-FY26 results (Jul 2025) — CASA ratio 38.4% (period-end Jun-2025)",
        confidence: "A", enteredBy: "test:stage2",
      }, tx as any);
      show("1. VALID ICICIBANK FY26/Q1 casa=38.4 (cited, conf A)", valid);
      expect("valid accepted, fresh quarter cell → inserted v1", valid.ok && valid.action === "inserted" && valid.version === 1 && !valid.supersededId);

      // 2. NO CITATION — the CN-4 gate MUST fire.
      const noCite = await injectLiveCasa({
        symbol: "ICICIBANK", fiscalYear: "FY26", quarter: "Q1", periodEnd: "30-Jun-2025",
        value: 38.4, sourceCitation: "", confidence: "A", enteredBy: "test:stage2",
      }, tx as any);
      show("2. NO sourceCitation (CN-4 gate)", noCite);
      expect("no-citation REJECTED", !noCite.ok && noCite.errors.some((e) => /CN-4|sourceCitation is REQUIRED/i.test(e)));

      // 3. FRACTION 0.34 — the unit-sanity band MUST fire.
      const frac = await injectLiveCasa({
        symbol: "ICICIBANK", fiscalYear: "FY26", quarter: "Q1", periodEnd: "30-Jun-2025",
        value: 0.34, sourceCitation: "ICICI Q1-FY26 — CASA", confidence: "A", enteredBy: "test:stage2",
      }, tx as any);
      show("3. FRACTION value=0.34 (unit band [15,60])", frac);
      expect("fraction REJECTED", !frac.ok && frac.errors.some((e) => /sanity band|PERCENT/i.test(e)));

      // 3b. MISSING quarter — the quarterly-model gate MUST fire.
      const noQ = await injectLiveCasa({
        symbol: "ICICIBANK", fiscalYear: "FY26", quarter: "", periodEnd: "30-Jun-2025",
        value: 38.4, sourceCitation: "ICICI Q1-FY26 — CASA", confidence: "A", enteredBy: "test:stage2",
      }, tx as any);
      show("3b. MISSING quarter (quarterly-model gate)", noQ);
      expect("missing-quarter REJECTED", !noQ.ok && noQ.errors.some((e) => /quarter must be/i.test(e)));

      // 4. UNKNOWN / non-banking symbol.
      const badSym = await injectLiveCasa({
        symbol: "RELIANCE", fiscalYear: "FY26", quarter: "Q1", periodEnd: "30-Jun-2025",
        value: 38.4, sourceCitation: "x", confidence: "A", enteredBy: "test:stage2",
      }, tx as any);
      show("4. NON-BANKING symbol RELIANCE", badSym);
      expect("bad-symbol REJECTED", !badSym.ok && badSym.errors.some((e) => /not one of the 12/i.test(e)));

      // 4b. Tier-1 metricKey — CASA-only gate.
      const tier1 = await injectLiveCasa({
        symbol: "ICICIBANK", fiscalYear: "FY26", quarter: "Q1", periodEnd: "30-Jun-2025",
        value: 16.3, sourceCitation: "x", confidence: "A", metricKey: "tier1_pct", enteredBy: "test:stage2",
      }, tx as any);
      show("4b. metricKey=tier1_pct (CASA-only gate)", tier1);
      expect("tier1 metricKey REJECTED", !tier1.ok && tier1.errors.some((e) => /CASA-ONLY/i.test(e)));

      // 5. SUPERSEDE — inject ICICIBANK FY26/Q1 again with a NEW value → v2 supersedes v1.
      const supersede = await injectLiveCasa({
        symbol: "ICICIBANK", fiscalYear: "FY26", quarter: "Q1", periodEnd: "30-Jun-2025",
        value: 39.1, sourceCitation: "ICICI Bank Q1-FY26 — CASA ratio revised 39.1%",
        confidence: "A", enteredBy: "test:stage2",
      }, tx as any);
      show("5. SECOND inject ICICIBANK FY26/Q1 casa=39.1 (supersede)", supersede);
      // inject#1 v1 (38.4) → inject#5 v2 (39.1).
      expect("supersede → v2 with supersedesId", supersede.ok && supersede.action === "superseded" && supersede.version === 2 && !!supersede.supersededId);

      // live-read check: highest version == v2 (39.1)
      const liveRead = await tx.bankSupplementary.findFirst({ where: { symbol: "ICICIBANK", metric: "casa_pct", fiscalYear: "FY26", quarter: "Q1" }, orderBy: { version: "desc" }, select: { version: true, value: true, supersedesId: true } });
      console.log(`\n  live-read (highest version): v${liveRead?.version} value=${liveRead?.value} supersedes=${liveRead?.supersedesId?.slice(0, 8) ?? "—"}`);
      expect("live-read returns v2=39.1", liveRead?.version === 2 && Number(liveRead?.value) === 39.1);

      // 6. CONFIDENCE C — accepted with verify-warning. (Use a fresh cell: AXISBANK FY26/Q1.)
      const cflag = await injectLiveCasa({
        symbol: "AXISBANK", fiscalYear: "FY26", quarter: "Q1", periodEnd: "30-Jun-2025",
        value: 41.0, sourceCitation: "Axis Q1-FY26 brokerage note — CASA ~41% (secondary)",
        confidence: "C", enteredBy: "test:stage2",
      }, tx as any);
      show("6. CONFIDENCE C AXISBANK FY26/Q1 casa=41.0 (secondary)", cflag);
      // Fresh AXISBANK FY26/Q1 quarter cell → conf-C inject inserts v1 (+ verify-warning).
      expect("conf-C accepted + warned (inserted v1)", cflag.ok && cflag.action === "inserted" && cflag.version === 1 && cflag.warnings.some((w) => /verify/i.test(w)));

      // ALWAYS roll back — nothing durable.
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }

  // Prove nothing leaked: no test:stage2 rows persisted.
  const leaked = await prisma.bankSupplementary.count({ where: { enteredBy: "test:stage2" } });
  console.log(`\n  rollback verify: durable rows with enteredBy="test:stage2" = ${leaked} (expect 0)`);
  expect("rolled back — nothing durable", leaked === 0);

  console.log(`\n  ${fail === 0 ? `✓ ALL ${pass} REJECTION/ACCEPT PROOFS PASS` : `✗ ${fail} FAILED`}`);
  await prisma.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
