// ═══════════════════════════════════════════════════════════════
// R4d — FALSE-NULL SWEEP + R4c ELEMENT-INVENTORY TRACING. READ-ONLY.
//   npx tsx src/scripts/_r4d-falsenull.ts [--per-cell N]
//
// ⚠ SAMPLING (the pilot's first attempt collapsed onto FY18 via ORDER BY and
//   proved nothing). Here the sample is DISTINCT ON (fiscal_year, result_type)
//   per table — ONE row per (fiscal year × basis) cell, so the spread across
//   years AND across standalone/consolidated is structural, not hoped for.
//   All four tables are sampled; the pilot never touched the banking two.
//
// For every NULL in a sampled row the verdict is one of:
//   GENUINE      — the tag is absent from the document's element inventory
//   STRUCTURAL   — the legacy path cannot carry it (v2 taxonomy / adapter nulls)
//   ⚠ FALSE NULL — the tag IS in the document but we read null. Two sub-cases:
//                  wrong-context (tag present under other contextRefs) and
//                  parser-bug (tag present under the RIGHT context, still null).
//
// ⚠ The inventory is DUMPED from the document (every in-bse-fin element and the
//   contexts it appears under) — never grepped for the names we expect. A field
//   whose tag we never look for cannot be found by looking for it.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";

const DIR = process.env.R1_DIR ?? ".";
const CUT = process.env.R2_CUT ?? "2026-08-16 11:38:00";
const A_PNL = "FourD", Q_PNL = "OneD", BS = "OneI";
const BS_BOUNDARY = "2022-11-25", CF_BOUNDARY = "2021-11-24";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

type Spec = { tag: string; ctx: string; alt?: string; altCtx?: string; structural?: boolean; derived?: boolean };
const M: Record<string, Record<string, Spec>> = {
  fundamentals: {
    revenue: { tag: "RevenueFromOperations", ctx: A_PNL },
    other_income: { tag: "OtherIncome", ctx: A_PNL },
    finance_costs: { tag: "FinanceCosts", ctx: A_PNL },
    depreciation: { tag: "DepreciationDepletionAndAmortisationExpense", ctx: A_PNL },
    profit_before_tax: { tag: "ProfitBeforeTax", ctx: A_PNL },
    net_profit: { tag: "ProfitLossForPeriod", ctx: A_PNL, alt: "ProfitOrLossAttributableToOwnersOfParent" },
    equity_share_capital: { tag: "EquityShareCapital", ctx: BS },
    other_equity: { tag: "OtherEquity", ctx: BS },
    total_equity: { tag: "Equity", ctx: BS },
    borrowings_current: { tag: "BorrowingsCurrent", ctx: BS },
    borrowings_noncurrent: { tag: "BorrowingsNoncurrent", ctx: BS },
    current_liabilities: { tag: "CurrentLiabilities", ctx: BS },
    trade_receivables_current: { tag: "TradeReceivablesCurrent", ctx: BS },
    trade_receivables_noncurrent: { tag: "TradeReceivablesNoncurrent", ctx: BS },
    property_plant_and_equipment: { tag: "PropertyPlantAndEquipment", ctx: BS },
    capital_work_in_progress: { tag: "CapitalWorkInProgress", ctx: BS },
    total_assets: { tag: "Assets", ctx: BS },
    face_value_share: { tag: "FaceValueOfEquityShareCapital", ctx: BS, altCtx: A_PNL },
    cash_from_operating: { tag: "CashFlowsFromUsedInOperatingActivities", ctx: A_PNL },
    capex: { tag: "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", ctx: A_PNL },
    cash_from_financing: { tag: "CashFlowsFromUsedInFinancingActivities", ctx: A_PNL },
    total_debt: { tag: "-", ctx: "-", derived: true }, roce: { tag: "-", ctx: "-", derived: true },
    roe: { tag: "-", ctx: "-", derived: true }, debt_to_equity: { tag: "-", ctx: "-", derived: true },
    interest_coverage: { tag: "-", ctx: "-", derived: true }, receivables_days: { tag: "-", ctx: "-", derived: true },
    asset_turnover: { tag: "-", ctx: "-", derived: true }, net_worth: { tag: "-", ctx: "-", derived: true },
    operating_margin: { tag: "-", ctx: "-", derived: true }, ebitda: { tag: "-", ctx: "-", derived: true },
  },
  quarterly_results: {
    revenue: { tag: "RevenueFromOperations", ctx: Q_PNL },
    other_income: { tag: "OtherIncome", ctx: Q_PNL },
    interest: { tag: "FinanceCosts", ctx: Q_PNL },
    depreciation: { tag: "DepreciationDepletionAndAmortisationExpense", ctx: Q_PNL },
    profit_before_tax: { tag: "ProfitBeforeTax", ctx: Q_PNL },
    net_profit: { tag: "ProfitLossForPeriod", ctx: Q_PNL, alt: "ProfitOrLossAttributableToOwnersOfParent" },
    operating_profit: { tag: "-", ctx: "-", derived: true },
  },
  banking_fundamentals: {
    interest_earned: { tag: "InterestEarned", ctx: A_PNL },
    interest_expended: { tag: "InterestExpended", ctx: A_PNL },
    other_income: { tag: "OtherIncome", ctx: A_PNL },
    operating_expenses: { tag: "OperatingExpenses", ctx: A_PNL },
    ppop: { tag: "OperatingProfitBeforeProvisionAndContingencies", ctx: A_PNL },
    profit_before_tax: { tag: "ProfitLossFromOrdinaryActivitiesBeforeTax", ctx: A_PNL },
    net_profit: { tag: "ProfitLossForThePeriod", ctx: A_PNL, alt: "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates" },
    advances: { tag: "Advances", ctx: BS }, investments: { tag: "Investments", ctx: BS },
    cash_and_balances_with_rbi: { tag: "CashAndBalancesWithReserveBankOfIndia", ctx: BS },
    balances_with_banks: { tag: "BalancesWithBanksAndMoneyAtCallAndShortNotice", ctx: BS },
    total_assets: { tag: "Assets", ctx: BS }, deposits: { tag: "Deposits", ctx: BS },
    gnpa_absolute: { tag: "GrossNonPerformingAssets", ctx: A_PNL },
    nnpa_absolute: { tag: "NonPerformingAssets", ctx: A_PNL },
    roa_disclosed: { tag: "ReturnOnAssets", ctx: A_PNL },
    gnpa_pct: { tag: "-", ctx: "-", structural: true }, nnpa_pct: { tag: "-", ctx: "-", structural: true },
    cet1_ratio: { tag: "-", ctx: "-", structural: true }, additional_tier1_ratio: { tag: "-", ctx: "-", structural: true },
    tier1_ratio: { tag: "-", ctx: "-", structural: true },
    pcr: { tag: "-", ctx: "-", derived: true }, cost_to_income_ratio: { tag: "-", ctx: "-", derived: true },
    net_interest_margin: { tag: "-", ctx: "-", derived: true }, nii: { tag: "-", ctx: "-", derived: true },
  },
  banking_quarterly_results: {
    interest_earned: { tag: "InterestEarned", ctx: Q_PNL },
    other_income: { tag: "OtherIncome", ctx: Q_PNL },
    ppop: { tag: "OperatingProfitBeforeProvisionAndContingencies", ctx: Q_PNL },
    net_profit: { tag: "ProfitLossForThePeriod", ctx: Q_PNL, alt: "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates" },
    interest_expended: { tag: "-", ctx: "-", structural: true },
    operating_expenses: { tag: "-", ctx: "-", structural: true },
    gnpa_absolute: { tag: "-", ctx: "-", structural: true }, nnpa_absolute: { tag: "-", ctx: "-", structural: true },
    gnpa_pct: { tag: "-", ctx: "-", structural: true }, nnpa_pct: { tag: "-", ctx: "-", structural: true },
    cet1_ratio: { tag: "-", ctx: "-", structural: true }, additional_tier1_ratio: { tag: "-", ctx: "-", structural: true },
    roa_quarterly: { tag: "-", ctx: "-", structural: true },
  },
};
const BS_FIELDS = new Set(Object.entries(M.fundamentals).filter(([, v]) => v.ctx === BS).map(([k]) => k));
const CF_FIELDS = new Set(["cash_from_operating", "capex", "cash_from_financing"]);

/** DUMP the document's element inventory: every in-bse-fin tag → the contexts it appears under. */
function inventory(xml: string): Map<string, Set<string>> {
  const inv = new Map<string, Set<string>>();
  const re = /<in-bse-fin:([A-Za-z0-9_.]+)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[1];
    const ctx = /contextRef="([^"]+)"/.exec(m[2])?.[1] ?? "(no-context)";
    if (!inv.has(tag)) inv.set(tag, new Set());
    inv.get(tag)!.add(ctx);
  }
  return inv;
}

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R4d — FALSE-NULL SWEEP · one row per (FISCAL YEAR × BASIS), all 4 tables   ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  newly-written = updated_at > ${CUT}`);

  const parts: string[] = [];
  for (const [tbl, hasQ] of [["fundamentals", false], ["quarterly_results", true],
                             ["banking_fundamentals", false], ["banking_quarterly_results", true]] as [string, boolean][]) {
    parts.push(
      `(SELECT DISTINCT ON (x."fiscal_year", x."result_type") '${tbl}' AS tbl, x."id", st."symbol" sym,
               x."fiscal_year" fy, ${hasQ ? `x."quarter"` : `NULL::text`} AS q, x."result_type" rt,
               x."xbrl_url" u, x."filing_date"::text fd, x."source" src
          FROM "${tbl}" x JOIN stocks st ON st."id"=x."stock_id"
         WHERE x."updated_at" > TIMESTAMP '${CUT}'
         ORDER BY x."fiscal_year", x."result_type", x."id")`);
  }
  const sample = await raw<any>(parts.join(" UNION ALL "));
  const fys = [...new Set(sample.map((s: any) => s.fy))].sort();
  const bases = [...new Set(sample.map((s: any) => s.rt))].sort();
  console.log(`  sample: ${sample.length} rows · fiscal years [${fys.join(", ")}] · bases [${bases.join(", ")}]`);
  console.log(`  per table: ${["fundamentals", "quarterly_results", "banking_fundamentals", "banking_quarterly_results"]
    .map((t) => `${t}=${sample.filter((s: any) => s.tbl === t).length}`).join(" · ")}\n`);
  if (sample.length < 15) console.log(`  ⚠ fewer than 15 rows sampled — reporting what exists.`);

  let genuine = 0, structural = 0, derived = 0, falseCtx = 0, falseParser = 0, populated = 0, totalFields = 0;
  const falseNulls: any[] = [];
  const unreachable: string[] = [];

  for (const row of sample) {
    const map = M[row.tbl];
    const cols = Object.keys(map);
    const dbRow = (await raw<any>(
      `SELECT ${cols.map((c) => `"${c}"::text AS "${c}"`).join(", ")} FROM "${row.tbl}" WHERE "id"=$1`, row.id))[0];
    const nulls = cols.filter((c) => dbRow[c] === null);
    totalFields += cols.length; populated += cols.length - nulls.length;

    const label = `${row.sym} ${row.fy}${row.q ?? ""} ${row.rt}`;
    // fields needing the document
    const needDoc = nulls.filter((c) => !map[c].structural && !map[c].derived);
    let inv: Map<string, Set<string>> | null = null;
    if (needDoc.length) {
      try { inv = inventory(await fetchXbrlFile(row.u)); }
      catch (e) { unreachable.push(`${label} — ${(e as Error).message.slice(0, 60)}`); }
    }
    console.log(`  ── ${pad(label, 42)}${pad(row.tbl, 27)} bcast ${String(row.fd).slice(0, 10)} · ${inv ? inv.size + " elements" : "doc not needed"} · ${cols.length - nulls.length}/${cols.length} filled`);

    for (const c of nulls) {
      const spec = map[c];
      if (spec.structural) { structural++; console.log(`       ${pad(c, 32)} STRUCTURAL — v2/adapter cannot carry it`); continue; }
      if (spec.derived) { derived++; console.log(`       ${pad(c, 32)} DERIVED — follows its inputs`); continue; }
      if (!inv) { console.log(`       ${pad(c, 32)} (document unreachable — unclassified)`); continue; }
      const tags = [spec.tag, ...(spec.alt ? [spec.alt] : [])];
      const ctxs = [spec.ctx, ...(spec.altCtx ? [spec.altCtx] : [])];
      const present = tags.filter((t) => inv!.has(t));
      const right = tags.filter((t) => ctxs.some((cx) => inv!.get(t)?.has(cx)));
      if (present.length === 0) {
        genuine++;
        const bnd = BS_FIELDS.has(c) && String(row.fd).slice(0, 10) <= BS_BOUNDARY ? " [known BS boundary]"
                  : CF_FIELDS.has(c) && String(row.fd).slice(0, 10) <= CF_BOUNDARY ? " [known CF boundary]" : "";
        console.log(`       ${pad(c, 32)} GENUINE — tag absent from the document${bnd}`);
      } else if (right.length === 0) {
        falseCtx++;
        const msg = `⚠ FALSE NULL (wrong ctx) — <${present[0]}> present under {${[...(inv.get(present[0]) ?? [])].slice(0, 6).join(",")}}, we read "${spec.ctx}"`;
        console.log(`       ${pad(c, 32)} ${msg}`);
        falseNulls.push({ ...row, col: c, kind: "wrong-context", detail: msg });
      } else {
        falseParser++;
        const msg = `⚠ FALSE NULL (parser) — <${right[0]}> present under the RIGHT context "${spec.ctx}" yet read null`;
        console.log(`       ${pad(c, 32)} ${msg}`);
        falseNulls.push({ ...row, col: c, kind: "parser-bug", detail: msg });
      }
    }
    if (needDoc.length) await sleep(300);
  }

  console.log(`\n  ── VERDICT ──`);
  console.log(`  fields populated            ${lp(populated, 6)}/${totalFields}`);
  console.log(`  GENUINE (tag absent)        ${lp(genuine, 6)}`);
  console.log(`  STRUCTURAL (v2/adapter)     ${lp(structural, 6)}`);
  console.log(`  DERIVED (follows inputs)    ${lp(derived, 6)}`);
  console.log(`  ⚠ FALSE NULL wrong-context  ${lp(falseCtx, 6)}`);
  console.log(`  ⚠ FALSE NULL parser-bug     ${lp(falseParser, 6)}`);
  console.log(`  documents unreachable       ${lp(unreachable.length, 6)}`);
  for (const u of unreachable) console.log(`      ${u}`);
  console.log(`\n  ${falseCtx + falseParser === 0 ? "✓✓ NO FALSE NULLS across the fiscal-year × basis spread" : `✗✗ ${falseCtx + falseParser} FALSE NULL(S) — every one is a defect`}`);
  writeFileSync(`${DIR}/_r4d-falsenulls.json`, JSON.stringify({ sample: sample.length, fys, bases, falseNulls, unreachable }, null, 1));
  console.log(`  → ${DIR}/_r4d-falsenulls.json\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
