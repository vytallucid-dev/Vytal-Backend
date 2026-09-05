// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE FILER-MIS-SCALED ROWS — refuse-and-null, and hand each one to the fill bridge.
//
// WHAT THEY ARE. A handful of filers tagged an entire XBRL instance at the wrong scale. Every
// monetary line in the document is off by the same factor, so the row is internally coherent and
// no within-document check can see it:
//     SRF   Q4 FY23 consolidated — revenue stored ₹37.78 Cr, sitting between ₹3,469.66 Cr and
//                                  ₹3,338.38 Cr. Tagged 377,809,000 with unitRef="INR"; the true
//                                  figure is ₹3,778.09 Cr. Its PAT is ₹5.62 Cr against a real
//                                  ₹562.45 Cr — the SAME 100×, so the P&L still adds up.
//     PAYTM Q3 FY24 consolidated — the same failure at 10×.
//
// ⚠ AND THE SCALE IS NOT IN THE DOCUMENT. Every one of these declares
//   LevelOfRoundingUsedInFinancialStatements = "Lakhs" — the same declaration, against two
//   different actual factors (PAYTM ≈10, everyone else ≈100). EPS cannot arbitrate either: it is
//   PAT / shares, and both are tagged in the same wrong unit, so the error cancels exactly. There
//   is no in-document discriminator. The ONLY detector is this database's own neighbouring periods.
//
// SO THE VALUE IS NOT KNOWABLE, AND IT IS NOT GUESSED. Multiplying by a factor inferred from the
// neighbours would be a reconstruction wearing the clothes of a measurement — the exact thing
// zero-block-guard.ts refuses. These rows are NULLED, every monetary line together (the error is
// the document's, not one column's), and each is handed to the resolution UI as an `admin_fill`
// fault carrying the original stored figures. "A false null is recoverable by a hand-key with a
// citation; a false zero scores silently."
//
// THE PROOF IS CONSERVATIVE, deliberately: a row is condemned only when BOTH its immediate
// neighbours in the same series sit a near-power-of-ten above it, in the same direction, within
// 0.18 in log10. Real growth does not produce a quarter that is ~100× below the quarter before it
// AND ~100× below the quarter after it.
//
//   npx tsx src/scripts/repair-misscaled-result-rows.ts [--apply]
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { reportIngestionError } from "../ingestions/shared/ingestion-error.js";
import { RESULTS_CRON, RESULTS_SOURCE, resultsRunRef } from "../ingestions/quaterly-results/fundamentals-guards.js";

const APPLY = process.argv.includes("--apply");

/** How far off a power of ten the MEDIAN ratio may sit and still count as one. 0.30 ≈ a factor of 50–200 reading as 100. */
const LOG10_TOL = 0.30;

type Spec = {
  table: string;
  sql: string;
  quarterly: boolean;
  /** Every ₹-denominated column. The mis-scale is the DOCUMENT's, so they go together. */
  money: string[];
  /** Ratios/growth computed FROM those columns — they cannot outlive their inputs. */
  derived: string[];
};

const SPECS: Spec[] = [
  {
    table: "QuarterlyResult", sql: "quarterly_results", quarterly: true,
    money: ["revenue", "expenses", "operating_profit", "other_income", "depreciation", "interest", "profit_before_tax", "tax", "net_profit"],
    derived: ["operating_margin", "net_margin", "revenue_qoq", "revenue_yoy", "profit_qoq", "profit_yoy"],
  },
  {
    table: "Fundamental", sql: "fundamentals", quarterly: false,
    money: ["revenue", "other_income", "depreciation", "profit_before_tax", "tax", "net_profit", "ebitda", "expenses", "employee_benefit_expense", "finance_costs"],
    derived: ["net_margin", "operating_margin", "revenue_growth_yoy", "profit_growth_yoy", "eps_growth_yoy", "roe", "roce", "interest_coverage"],
  },
  {
    table: "NbfcQuarterlyResult", sql: "nbfc_quarterly_results", quarterly: true,
    money: ["revenue", "interest_income", "fee_and_commission_income", "net_gain_on_fair_value_changes",
            "other_income", "total_income", "finance_costs", "impairment_on_financial_instruments",
            "employee_benefit_expense", "depreciation", "other_expenses", "total_expenses",
            "profit_before_tax", "tax", "net_profit", "nii"],
    derived: ["net_margin", "revenue_qoq", "revenue_yoy", "pat_qoq", "pat_yoy"],
  },
  {
    table: "NbfcFundamental", sql: "nbfc_fundamentals", quarterly: false,
    money: ["revenue", "interest_income", "fee_and_commission_income", "net_gain_on_fair_value_changes",
            "other_income", "total_income", "finance_costs", "fee_and_commission_expense",
            "impairment_on_financial_instruments", "employee_benefit_expense", "depreciation",
            "other_expenses", "total_expenses", "profit_before_tax", "tax", "net_profit"],
    derived: ["nim", "cost_to_income_ratio", "credit_cost_pct", "spread", "roe",
              "revenue_growth_yoy", "pat_growth_yoy"],
  },
];

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Is THIS row a scale break against its own series?
 *
 * ⚠ IT MUST BE ASKED OF BOTH ROWS THE FLAG TOUCHES, AND ASKING ONLY ONE MISSED A REAL ONE. A
 *   continuity flag says "this period's YoY is extreme", which can mean the BASE beneath it is
 *   wrong (SRF Q4 FY23, stored 100× low) or that THIS PERIOD is (GRAPHITE FY22 standalone, stored
 *   ₹279,900 Cr and ₹57,400 Cr of profit in a series that runs ₹1,839–2,913 Cr — the same filer
 *   error at ×100, in the opposite direction). One test, asked of both rows.
 *
 * THE EVIDENCE REQUIRED, deliberately strict:
 *   · at least one period on EACH side — a row at the edge of a series proves nothing;
 *   · EVERY period in the ±2 window at least 5× away, ALL IN THE SAME DIRECTION — that is what
 *     separates one row out of line from a company that grew;
 *   · the MEDIAN ratio within 0.30 in log10 of a power of ten (a factor of 50–200 counts as 100).
 *     The median rather than agreement between neighbours, because a genuinely fast-growing series
 *     has neighbours that disagree with each other while all agreeing the row is impossible —
 *     TRENT FY22 sits against 2,593 and 12,375, and requiring those two to match let it through.
 */
function scaleBreakFactor(row: number, before: number[], after: number[]): number | null {
  if (!before.length || !after.length) return null;
  const ratios = [...before, ...after].map((v) => v / row);
  const sameDir = ratios.every((r) => r > 1) || ratios.every((r) => r < 1);
  if (!sameDir) return null;
  if (!ratios.every((r) => r >= 5 || r <= 1 / 5)) return null;
  const p = Math.log10(median(ratios));
  const k = Math.round(p);
  if (Math.abs(k) < 1 || Math.abs(p - k) > LOG10_TOL) return null;
  return 10 ** k; // >1 ⇒ the row is that many times TOO SMALL; <1 ⇒ that many times TOO BIG
}

/**
 * ★ THE ARBITER — A SECOND, INDEPENDENT DOCUMENT, AND IT MUST BE ASKED BEFORE ANYTHING IS NULLED.
 *
 * The window test says a row is out of line with its neighbours. That is suggestive, not decisive,
 * because SOME businesses genuinely book a year in one quarter. MEASURED, and it nearly cost real
 * data: EMAMIREAL Q4 FY26 stores ₹73.09 Cr against a window of ₹4.89–9.17 Cr, and the window test
 * condemned it at ×10. It is CORRECT. Its own FY26 annual filing — a different document, filed
 * separately — reports ₹93.16 Cr for the year, and 93.16 − (6.01 + 9.17 + 4.89) = 73.09 EXACTLY.
 * Its loss reconciles to the paisa too. A real-estate company completed a project; that is what a
 * lumpy quarter looks like, and nulling it would have destroyed a true number to satisfy a
 * heuristic.
 *
 * So: a quarter that reconciles against its own annual is CORROBORATED and is never condemned. A
 * year that reconciles against its own quarters likewise. GRAPHITE FY22 fails this and is condemned
 * on it — its annual says ₹279,900 Cr while its own Q1–Q3 say ₹543 + ₹654 + ₹835 Cr, so the two
 * documents contradict each other and the window says which one is impossible.
 *
 * Returns true only when the counterpart EXISTS, is complete, and AGREES. An absent counterpart
 * corroborates nothing — silence is not agreement.
 */
const RECONCILE_TOL = 0.02; // 2% — filings round, and a quarter is derived by subtraction

function reconciles(candidate: number, parts: (number | null)[], total: number | null): boolean {
  if (total == null || !parts.length || parts.some((v) => v == null)) return false;
  const implied = total - (parts as number[]).reduce((a, b) => a + b, 0);
  const scale = Math.max(Math.abs(candidate), Math.abs(implied), 1);
  return Math.abs(candidate - implied) / scale <= RECONCILE_TOL;
}

let condemned = 0, nulled = 0, raised = 0, spared = 0;
const closedErrorIds: string[] = [];
const alreadyDone = new Set<string>(); // one repair per ROW, however many flags point at it

for (const spec of SPECS) {
  const errs = await prisma.ingestionError.findMany({
    where: { status: "open", guardType: "continuity", targetTable: spec.table },
    select: { id: true, targetEntity: true },
  });

  for (const e of errs) {
    const [sid, per, rt] = String(e.targetEntity).split("@");
    if (!sid || !per || !rt) continue;
    const fy = spec.quarterly ? per.split("-")[1]! : per;
    const q = spec.quarterly ? per.split("-")[0]! : null;
    const py = "FY" + String(Number(fy.slice(2)) - 1).padStart(2, "0");

    const series = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, ${spec.quarterly ? "quarter," : ""} fiscal_year, revenue::float8 AS v, report_date,
              ${spec.money.map((c) => `${c}::float8 AS "m_${c}"`).join(", ")}
         FROM ${spec.sql} WHERE stock_id=$1 AND result_type=$2 ORDER BY report_date`, sid, rt);
    const key = (r: any) => (spec.quarterly ? `${r.quarter}-${r.fiscal_year}` : r.fiscal_year);

    // BOTH rows the flag touches: the period it fired on, and the base beneath it.
    const candidates = [
      { label: spec.quarterly ? `${q}-${fy}` : fy, which: "the flagged period" },
      { label: spec.quarterly ? `${q}-${py}` : py, which: "the base beneath it" },
    ];

    for (const cand of candidates) {
      const i = series.findIndex((r) => key(r) === cand.label);
      if (i < 0) continue;
      const row = series[i];
      if (row.v == null || row.v <= 0) continue;
      const rowKey = `${spec.sql}:${row.id}`;
      if (alreadyDone.has(rowKey)) { closedErrorIds.push(e.id); continue; }

      const before = [series[i - 2], series[i - 1]].filter(Boolean).map((r) => r.v).filter((v) => v != null && v > 0);
      const after = [series[i + 1], series[i + 2]].filter(Boolean).map((r) => r.v).filter((v) => v != null && v > 0);
      const factor = scaleBreakFactor(row.v, before, after);
      if (factor === null) continue;

      // ── THE ARBITER. Ask the OTHER document before nulling anything. ──
      const annualSql = spec.table === "NbfcQuarterlyResult" || spec.table === "NbfcFundamental"
        ? "nbfc_fundamentals" : "fundamentals";
      const quarterlySql = spec.table === "NbfcQuarterlyResult" || spec.table === "NbfcFundamental"
        ? "nbfc_quarterly_results" : "quarterly_results";
      const rowFy = spec.quarterly ? cand.label.split("-")[1]! : cand.label;
      const rowQ = spec.quarterly ? cand.label.split("-")[0]! : null;

      const quarters = await prisma.$queryRawUnsafe<{ quarter: string; v: number | null }[]>(
        `SELECT quarter, revenue::float8 AS v FROM ${quarterlySql}
          WHERE stock_id=$1 AND result_type=$2 AND fiscal_year=$3`, sid, rt, rowFy);
      const annual = await prisma.$queryRawUnsafe<{ v: number | null }[]>(
        `SELECT revenue::float8 AS v FROM ${annualSql}
          WHERE stock_id=$1 AND result_type=$2 AND fiscal_year=$3`, sid, rt, rowFy);
      const annualV = annual[0]?.v ?? null;

      const corroborated = spec.quarterly
        // a quarter, against (its year) − (the other three quarters)
        ? quarters.length === 4 &&
          reconciles(row.v, quarters.filter((x) => x.quarter !== rowQ).map((x) => x.v), annualV)
        // a year, against the sum of its own four quarters
        : quarters.length === 4 &&
          reconciles(row.v, [], quarters.reduce<number | null>((a, x) => (a == null || x.v == null ? null : a + x.v), 0));

      if (corroborated) {
        spared++;
        console.log(`  · ${sid.slice(0, 8)} ${cand.label} ${rt} — window says ×${factor}, but its own ` +
          `${spec.quarterly ? "annual filing" : "four quarters"} RECONCILE with it. Corroborated, left alone.`);
        continue;
      }

      const symbolRow = await prisma.$queryRawUnsafe<{ symbol: string }[]>(`SELECT symbol FROM stocks WHERE id=$1`, sid);
      const symbol = symbolRow[0]?.symbol ?? sid.slice(0, 8);
      const window = [...before, ...after];
      const direction = factor > 1 ? `${factor}× too SMALL` : `${1 / factor}× too BIG`;
      const held = spec.money.map((c) => `${c}=${row[`m_${c}`]}`).filter((x) => !x.endsWith("=null")).join(", ");
      const label = `${symbol} ${cand.label} ${rt}`;

      condemned++;
      alreadyDone.add(rowKey);
      console.log(`  ✗ ${label.padEnd(34)} ${direction.padEnd(16)} (${cand.which})`);
      console.log(`      stored : ${held.slice(0, 165)}`);
      console.log(`      window : ${JSON.stringify(window)}`);

      if (!APPLY) { closedErrorIds.push(e.id); continue; }

      const sets = [...spec.money, ...spec.derived].map((c) => `${c} = NULL`).join(", ");
      await prisma.$executeRawUnsafe(`UPDATE ${spec.sql} SET ${sets} WHERE id = $1`, row.id);
      nulled++;

      await reportIngestionError({
        source: RESULTS_SOURCE,
        cron: RESULTS_CRON,
        guardType: "range",
        targetTable: spec.table,
        targetField: "revenue",
        targetEntity: `${sid}@${cand.label}@${rt}`,
        severity: "medium",
        resolutionPath: "admin_fill",
        expected: `a ₹Cr figure in line with this series' own surrounding periods (${window.map((v) => v.toFixed(2)).join(", ")})`,
        observed: `the filing tagged this whole instance ~${direction}; every line was affected and all have been NULLED. Stored before the repair: ${held}`,
        detail:
          `FILER SCALE ERROR, NULLED RATHER THAN GUESSED. Every monetary line in this filing is off by ` +
          `the same factor, so the row was internally coherent and no within-document check could see ` +
          `it — EPS cancels the error exactly (PAT and share capital carry the same wrong unit), and the ` +
          `instance's own LevelOfRoundingUsedInFinancialStatements says "Lakhs" on rows whose real factor ` +
          `is 10 in one case and 100 in another, so the declaration cannot arbitrate either. The only ` +
          `evidence is this series' own surrounding periods, every one of which puts the row ${direction} ` +
          `in BOTH directions. That proves the value is WRONG; it does not tell us what it IS. So it is ` +
          `written NULL and handed to you: source the figure from the company's own published result and ` +
          `key it with a citation. Filling it re-derives every dependent ratio.`,
        runRef: resultsRunRef(spec.quarterly ? cand.label : `Y-${cand.label}`),
      });
      raised++;
      closedErrorIds.push(e.id);
    }
  }
}

console.log(`\nproven mis-scaled rows : ${condemned}`);
console.log(`spared by the arbiter  : ${spared}   (window flagged them; a second document agreed with them)`);
if (APPLY) {
  console.log(`rows NULLED            : ${nulled}`);
  console.log(`admin_fill faults      : ${raised}`);
  const { count } = await prisma.ingestionError.updateMany({
    where: { id: { in: closedErrorIds }, status: "open" },
    data: {
      status: "resolved",
      resolvedBy: "backlog-2026-08-29",
      resolvedAt: new Date(),
      resolutionNote:
        "The YoY was extreme because the BASE beneath it was wrong, not because this period was. The " +
        "prior-year row has been proven mis-scaled against its own neighbours, NULLED, and raised as " +
        "an admin_fill fault naming the exact value to source. This continuity flag pointed at the " +
        "wrong row and had no action attached to it; the replacement points at the wrong VALUE and has " +
        "a fill button.",
    },
  });
  console.log(`continuity flags closed: ${count}`);
} else {
  console.log(`(dry run — pass --apply to null them and raise the fill faults)`);
}
await prisma.$disconnect();
