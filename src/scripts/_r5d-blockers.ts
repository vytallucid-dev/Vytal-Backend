// ═══════════════════════════════════════════════════════════════
// R5-D — MOMENTUM BLOCKERS → THE MANUAL-ENTRY LIST. READ-ONLY.
//   npx tsx src/scripts/_r5d-blockers.ts
//
// D1 BANKING M1 (NIM) / M5 (GNPA ttm) — the exact cell count to make all 26
//    banks scoreable at a Jan-2022 date, and whether M1 is reachable AT ALL
//    once the earning-assets denominator is checked.
// D2 ALL 442 — any other field blocking a Momentum metric at that date, per
//    metric and per stock count. Uses the REAL momentum functions, so a "blocked"
//    verdict is the engine's own, not a reconstruction.
// D3 per blocker: is there a source, or is it unkeyable (a scope decision)?
//
// WINDOW: 13 quarters counting back from 2022-01-31 — M3/M4 need 8 consecutive,
// and L3 re-dispatches over row prefixes with l3MinN=6, so 8 + 6 − 1 = 13.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";
import { consecutiveTail, m1TtmOpm, m2TtmNpm, m3RevenueYoyTtm, m4NetProfitYoyTtm, m5TtmInterestCoverage } from "../scoring/metrics/momentum.js";
import type { MomentumQuarter } from "../scoring/metrics/types.js";

const DIR = process.env.R1_DIR ?? ".";
const PIT = process.env.R5_PIT ?? "2022-01-31";
const QUARTERS_NEEDED = 13;
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n2: number) => String(s).padEnd(n2);
const lp = (s: unknown, n2: number) => String(s).padStart(n2);
const qOrd = (fy: string, q: string) => parseInt(fy.slice(2), 10) * 4 + (Number(q.slice(1)) - 1);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function main() {
  const cohort = await loadCohort();
  const banks = cohort.filter((c) => c.industryType === "banking");
  const nonfin = cohort.filter((c) => c.industryType === "non_financial");
  const out: any = {};

  // ═══ D1 — BANKING ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ D1 — BANKING M1 (NIM) + M5 (GNPA ttm): THE MANUAL-ENTRY BILL               ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  window: the ${QUARTERS_NEEDED} quarters ending on/before ${PIT}`);
  console.log(`  (M3/M4 need 8 consecutive; L3 re-dispatches with l3MinN=6 → 8 + 6 − 1 = ${QUARTERS_NEEDED})\n`);

  let rowsPresent = 0, rowsAbsent = 0, cellIntExp = 0, cellGnpa = 0;
  const eaMissing: string[] = [], eaPresent: string[] = [];
  const perBank: any[] = [];
  for (const b of banks) {
    const qs = await raw<any>(
      `SELECT "report_date"::text rd, "interest_expended" IS NULL ie_null, "gnpa_pct" IS NULL gp_null
         FROM banking_quarterly_results
        WHERE "stock_id"=$1 AND "result_type"='standalone' AND "report_date" <= DATE '${PIT}'
        ORDER BY "report_date" DESC LIMIT ${QUARTERS_NEEDED}`, b.id);
    const present = qs.length, absent = QUARTERS_NEEDED - present;
    const ieNull = qs.filter((x: any) => x.ie_null).length + absent;   // an absent row needs the field too
    const gpNull = qs.filter((x: any) => x.gp_null).length + absent;
    rowsPresent += present; rowsAbsent += absent; cellIntExp += ieNull; cellGnpa += gpNull;

    // M1's DENOMINATOR: earning assets, from the latest annual standalone at/below PIT
    const [ann] = await raw<any>(
      `SELECT ("advances" IS NOT NULL AND "investments" IS NOT NULL
               AND "cash_and_balances_with_rbi" IS NOT NULL AND "balances_with_banks" IS NOT NULL) ea
         FROM banking_fundamentals WHERE "stock_id"=$1 AND "result_type"='standalone' AND "report_date" <= DATE '${PIT}'
        ORDER BY "report_date" DESC LIMIT 1`, b.id);
    const hasEA = !!ann?.ea;
    (hasEA ? eaPresent : eaMissing).push(b.symbol);
    perBank.push({ symbol: b.symbol, quartersHeld: present, quartersAbsent: absent, ieNull, gpNull, hasEA });
  }
  console.log(`  ${pad("bank", 14)}${lp("qtrs held", 11)}${lp("qtrs absent", 13)}${lp("intExp cells", 14)}${lp("gnpaPct cells", 15)}  earning assets`);
  for (const p of perBank) {
    console.log(`  ${pad(p.symbol, 14)}${lp(p.quartersHeld, 11)}${lp(p.quartersAbsent, 13)}${lp(p.ieNull, 14)}${lp(p.gpNull, 15)}  ${p.hasEA ? "✓ present" : "⚠ ABSENT"}`);
  }
  console.log(`\n  ── D1 CELL COUNT ──`);
  console.log(`  banks                                   : ${banks.length}`);
  console.log(`  quarter-slots in scope (${banks.length} × ${QUARTERS_NEEDED})        : ${banks.length * QUARTERS_NEEDED}`);
  console.log(`    of which a row is HELD                : ${rowsPresent}`);
  console.log(`    of which NO row exists                : ${rowsAbsent}`);
  console.log(`  cells to key — interestExpended         : ${lp(cellIntExp, 6)}`);
  console.log(`  cells to key — gnpaPct                  : ${lp(cellGnpa, 6)}`);
  console.log(`  ──────────────────────────────────────────────────`);
  console.log(`  D1 SUBTOTAL (the two blocking fields)   : ${lp(cellIntExp + cellGnpa, 6)} cells`);

  console.log(`\n  ── ⚠ IS M1 REACHABLE EVEN WITH interestExpended KEYED? ──`);
  console.log(`  M1 NIM = TTM_NII / avg EARNING ASSETS. The denominator comes from the ANNUAL`);
  console.log(`  balance sheet: advances + investments + cashAndBalancesWithRbi + balancesWithBanks.`);
  console.log(`  banks whose latest annual row at ${PIT} HAS all four : ${eaPresent.length}/${banks.length}`);
  console.log(`  banks MISSING the denominator                             : ${eaMissing.length}/${banks.length}`);
  if (eaMissing.length) for (let i = 0; i < eaMissing.length; i += 6) console.log(`    ${eaMissing.slice(i, i + 6).map((s) => pad(s, 14)).join("")}`);
  const eaCells = eaMissing.length * 4;
  console.log(`  ⇒ keying interestExpended ALONE does not produce a NIM for those ${eaMissing.length} banks.`);
  console.log(`    FULL requirement adds ${eaCells} annual BS cells (${eaMissing.length} banks × 4 fields, latest FY).`);
  console.log(`\n  D1 TOTAL to make M1 + M5 computable      : ${lp(cellIntExp + cellGnpa + eaCells, 6)} cells`);
  out.d1 = { banks: banks.length, quartersNeeded: QUARTERS_NEEDED, rowsPresent, rowsAbsent, cellIntExp, cellGnpa, eaMissing, eaCells, total: cellIntExp + cellGnpa + eaCells, perBank };

  // ═══ D2 — ALL 442, per metric ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ D2 — EVERY STOCK: which Momentum metric is blocked at ${PIT}, and why ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  running the REAL momentum functions over each stock's standalone series at the PIT date\n`);

  const reasons: Record<string, Map<string, number>> = {
    "M1 TTM OPM": new Map(), "M2 TTM NPM": new Map(), "M3 Rev YoY TTM": new Map(),
    "M4 NP YoY TTM": new Map(), "M5 TTM IntCov": new Map(),
  };
  let scored = 0, noRows = 0;
  const tailDist = new Map<number, number>();
  const fieldNulls = new Map<string, number>();
  for (const c of nonfin) {
    const rows = await raw<any>(
      `SELECT "fiscal_year" fy,"quarter" q,"revenue"::float8 rev,"other_income"::float8 oi,"interest"::float8 intr,
              "depreciation"::float8 dep,"profit_before_tax"::float8 pbt,"net_profit"::float8 np,"operating_profit"::float8 op
         FROM quarterly_results WHERE "stock_id"=$1 AND "result_type"='standalone' AND "report_date" <= DATE '${PIT}'`, c.id);
    if (!rows.length) { noRows++; continue; }
    for (const r of rows) for (const [k, v] of Object.entries({ revenue: r.rev, otherIncome: r.oi, interest: r.intr, depreciation: r.dep, profitBeforeTax: r.pbt, netProfit: r.np, operatingProfit: r.op })) {
      if (v === null) fieldNulls.set(k, (fieldNulls.get(k) ?? 0) + 1);
    }
    const qs: MomentumQuarter[] = rows.map((r: any) => ({
      fiscalYear: r.fy, quarter: r.q, qOrdinal: qOrd(r.fy, r.q),
      revenue: nn(r.rev), otherIncome: nn(r.oi), interest: nn(r.intr), depreciation: nn(r.dep),
      profitBeforeTax: nn(r.pbt), netProfit: nn(r.np), operatingProfitStored: nn(r.op),
    }));
    const tail = consecutiveTail(qs);
    tailDist.set(tail.length, (tailDist.get(tail.length) ?? 0) + 1);
    const ms: [string, any][] = [["M1 TTM OPM", m1TtmOpm(tail)], ["M2 TTM NPM", m2TtmNpm(tail)],
      ["M3 Rev YoY TTM", m3RevenueYoyTtm(tail)], ["M4 NP YoY TTM", m4NetProfitYoyTtm(tail)],
      ["M5 TTM IntCov", m5TtmInterestCoverage(tail)]];
    let anyOk = false;
    for (const [nm, v] of ms) {
      if (v?.value !== null && v?.value !== undefined) { anyOk = true; continue; }
      const why = String(v?.reason ?? "null");
      reasons[nm].set(why, (reasons[nm].get(why) ?? 0) + 1);
    }
    if (anyOk) scored++;
  }
  console.log(`  non-financial stocks in scope           : ${nonfin.length}`);
  console.log(`  holding NO standalone quarter at the PIT: ${noRows}`);
  console.log(`  with >=1 computable Momentum metric     : ${scored}`);
  console.log(`\n  ── blocked metrics, by REASON (the engine's own reason string) ──`);
  for (const [m, rs] of Object.entries(reasons)) {
    const tot = [...rs.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${pad(m, 18)} blocked for ${lp(tot, 4)} stock(s): ${[...rs.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(" · ") || "—"}`);
  }
  console.log(`\n  ── consecutiveTail length distribution at the PIT date ──`);
  console.log(`  ${[...tailDist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}q→${v}`).join(" · ")}`);
  console.log(`\n  ── FIELD-LEVEL blockers on the non-financial path (null scorer cells) ──`);
  if (!fieldNulls.size) {
    console.log(`  ✓ NONE — every one of the 7 scorer-read quarterly columns is populated on every`);
    console.log(`    standalone row at the PIT date. The non-financial path has NO field-level`);
    console.log(`    blocker; what blocks Momentum there is ROW ABSENCE and label ordering, not nulls.`);
  } else {
    for (const [k, v] of [...fieldNulls.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ⚠ ${pad(k, 22)}${lp(v, 6)} null cell(s)`);
  }
  out.d2 = { nonfin: nonfin.length, noRows, scored, reasons: Object.fromEntries(Object.entries(reasons).map(([k, v]) => [k, Object.fromEntries(v)])), fieldNulls: Object.fromEntries(fieldNulls) };

  writeFileSync(`${DIR}/_r5d-blockers.json`, JSON.stringify(out, null, 1));
  console.log(`\n  → ${DIR}/_r5d-blockers.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
