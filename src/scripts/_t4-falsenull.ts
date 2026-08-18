// ═══════════════════════════════════════════════════════════════
// T4e — FALSE-NULL DETECTION. READ-ONLY (fetches source documents, writes nothing).
//   npx tsx src/scripts/_t4-falsenull.ts
//
// ⚠ T4e1 does NOT grep for expected tag names. It dumps the document's COMPLETE
//   element inventory — every <in-bse-fin:TAG contextRef="CTX"> occurrence — and
//   compares field-by-field. A tag-presence regex has already lied to us once.
//
// The parser keys on (tag, contextRef) — extractNumber() at
// parser-legacy-common.ts:27-53. So a field can be null for THREE reasons:
//   (a) tag absent from the document entirely            → GENUINE
//   (b) tag present but ONLY under a different context   → FALSE NULL (wrong context)
//   (c) tag present under the right context, still null  → FALSE NULL (parser bug)
// Only (a) is acceptable.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";

const CUT = process.env.T4_CUT ?? "2026-08-16 09:30:03";
const ANNUAL_PNL = "FourD", QUARTERLY_PNL = "OneD", BS = "OneI";

/** scorer-read column → the (tag, context) the parser actually asks for. */
const ANNUAL_MAP: Record<string, { tag: string; ctx: string; alt?: string }> = {
  revenue: { tag: "RevenueFromOperations", ctx: ANNUAL_PNL },
  other_income: { tag: "OtherIncome", ctx: ANNUAL_PNL },
  finance_costs: { tag: "FinanceCosts", ctx: ANNUAL_PNL },
  depreciation: { tag: "DepreciationDepletionAndAmortisationExpense", ctx: ANNUAL_PNL },
  profit_before_tax: { tag: "ProfitBeforeTax", ctx: ANNUAL_PNL },
  net_profit: { tag: "ProfitLossForPeriod", ctx: ANNUAL_PNL, alt: "ProfitOrLossAttributableToOwnersOfParent" },
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
  cash_from_operating: { tag: "CashFlowsFromUsedInOperatingActivities", ctx: ANNUAL_PNL },
  capex: { tag: "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", ctx: ANNUAL_PNL },
  cash_from_financing: { tag: "CashFlowsFromUsedInFinancingActivities", ctx: ANNUAL_PNL },
  face_value_share: { tag: "FaceValueOfEquityShareCapital", ctx: BS },
};
const QUARTERLY_MAP: Record<string, { tag: string; ctx: string; alt?: string }> = {
  revenue: { tag: "RevenueFromOperations", ctx: QUARTERLY_PNL },
  other_income: { tag: "OtherIncome", ctx: QUARTERLY_PNL },
  interest: { tag: "FinanceCosts", ctx: QUARTERLY_PNL },
  depreciation: { tag: "DepreciationDepletionAndAmortisationExpense", ctx: QUARTERLY_PNL },
  profit_before_tax: { tag: "ProfitBeforeTax", ctx: QUARTERLY_PNL },
  net_profit: { tag: "ProfitLossForPeriod", ctx: QUARTERLY_PNL, alt: "ProfitOrLossAttributableToOwnersOfParent" },
};
// Not extracted — computed downstream. Excluded from tag comparison, reported separately.
const DERIVED_ANNUAL = ["total_debt","roce","roe","debt_to_equity","interest_coverage","receivables_days","asset_turnover","net_worth","operating_margin","ebitda"];
const DERIVED_QUARTERLY = ["operating_profit"]; // pbt + interest + depreciation

// ── T4e3: the KNOWN source boundaries, so a genuine absence is not a defect ──
const BS_BOUNDARY = "2022-11-25";  // balance sheet only in filings broadcast after this
const CF_BOUNDARY = "2021-11-24";  // cash flow only after this
const BS_FIELDS = new Set(Object.entries(ANNUAL_MAP).filter(([, v]) => v.ctx === BS).map(([k]) => k));
const CF_FIELDS = new Set(["cash_from_operating", "cash_from_financing", "capex"]);

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** COMPLETE element inventory: every in-bse-fin element with a contextRef. */
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
  let fail = 0;

  // ═══ T4e1 — element-inventory comparison on a spread of new rows ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4e1 — FIELD-BY-FIELD vs the SOURCE DOCUMENT'S COMPLETE ELEMENT INVENTORY ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const sample = await raw<any>(
    `(SELECT 'fundamentals' AS tbl, f."id", st."symbol", f."fiscal_year", NULL::text AS quarter, f."result_type",
             f."xbrl_url", f."filing_date"::text AS filing_date, f."report_date"::text AS report_date
        FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
       WHERE f."updated_at" > TIMESTAMP '${CUT}'
       ORDER BY f."fiscal_year", random() LIMIT 8)
     UNION ALL
     (SELECT 'quarterly_results', q."id", st."symbol", q."fiscal_year", q."quarter", q."result_type",
             q."xbrl_url", q."filing_date"::text, q."report_date"::text
        FROM quarterly_results q JOIN stocks st ON st."id"=q."stock_id"
       WHERE q."updated_at" > TIMESTAMP '${CUT}'
       ORDER BY q."fiscal_year", random() LIMIT 5)`);

  console.log(`  sampled ${sample.length} newly-written rows across fiscal years ${[...new Set(sample.map((s: any) => s.fiscal_year))].sort().join(", ")}\n`);

  let genuine = 0, falseWrongCtx = 0, falseParserBug = 0, populated = 0;
  const falseNulls: string[] = [];

  for (const row of sample) {
    const isAnnual = row.tbl === "fundamentals";
    const map = isAnnual ? ANNUAL_MAP : QUARTERLY_MAP;
    const cols = Object.keys(map);
    const dbRow = (await raw<any>(
      `SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM ${row.tbl} WHERE "id" = $1`, row.id))[0];

    let xml: string;
    try { xml = await fetchXbrlFile(row.xbrl_url); } catch (e) {
      console.log(`  ${row.symbol} ${row.fiscal_year} — XBRL unreachable: ${(e as Error).message}`); continue;
    }
    const inv = inventory(xml);
    const label = `${row.symbol} ${row.fiscal_year}${row.quarter ? " " + row.quarter : ""} ${row.result_type} (${row.tbl})`;
    const nullCols = cols.filter((c) => dbRow[c] === null);
    populated += cols.length - nullCols.length;
    console.log(`  ── ${pad(label, 52)} broadcast ${String(row.filing_date).slice(0, 10)} · doc has ${inv.size} distinct elements`);
    console.log(`     ${cols.length - nullCols.length}/${cols.length} scorer fields populated`);

    for (const c of nullCols) {
      const { tag, ctx, alt } = map[c];
      const tags = [tag, ...(alt ? [alt] : [])];
      const present = tags.filter((t) => inv.has(t));
      const rightCtx = tags.filter((t) => inv.get(t)?.has(ctx));
      let verdict: string;
      if (present.length === 0) {
        genuine++;
        const bnd = BS_FIELDS.has(c) && String(row.filing_date) < BS_BOUNDARY ? " [within the known BS boundary]"
                  : CF_FIELDS.has(c) && String(row.filing_date) < CF_BOUNDARY ? " [within the known CF boundary]" : "";
        verdict = `GENUINE — ${tags.join("/")} absent from the document${bnd}`;
      } else if (rightCtx.length === 0) {
        falseWrongCtx++; fail++;
        verdict = `✗ FALSE NULL — ${present.join("/")} IS present, but only in context(s) {${[...(inv.get(present[0]) ?? [])].join(",")}}, parser asked for "${ctx}"`;
        falseNulls.push(`${label} · ${c} · ${verdict}`);
      } else {
        falseParserBug++; fail++;
        verdict = `✗ FALSE NULL — ${rightCtx.join("/")} present in the RIGHT context "${ctx}" and still read null (parser bug)`;
        falseNulls.push(`${label} · ${c} · ${verdict}`);
      }
      console.log(`       ${pad(c, 30)} ${verdict}`);
    }
    if (nullCols.length === 0) console.log(`       (no nulls)`);
    await sleep(400);
  }
  console.log(`\n  fields populated: ${populated} · nulls GENUINE (tag absent): ${genuine}`);
  console.log(`  FALSE NULLS — wrong context: ${falseWrongCtx} · parser bug: ${falseParserBug}   ${falseWrongCtx + falseParserBug === 0 ? "✓ NONE" : "✗"}`);

  // ═══ T4e2 — per-field fill rate by fiscal year ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4e2 — PER-FIELD FILL RATE BY FISCAL YEAR (all rows written by the pilot)  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  for (const [tbl, map, derived] of [["fundamentals", ANNUAL_MAP, DERIVED_ANNUAL], ["quarterly_results", QUARTERLY_MAP, DERIVED_QUARTERLY]] as const) {
    const cols = [...Object.keys(map), ...derived];
    const sel = cols.map((c) => `round(100.0*count("${c}")/count(*))::int AS "${c}"`).join(", ");
    const rows = await raw<any>(
      `SELECT "fiscal_year", count(*)::int AS n, ${sel} FROM ${tbl}
        WHERE "updated_at" > TIMESTAMP '${CUT}' GROUP BY 1 ORDER BY 1`);
    if (!rows.length) continue;
    console.log(`\n  ${tbl} — fill %, by fiscal year:`);
    console.log(`    ${pad("field", 32)}${rows.map((r: any) => lp(r.fiscal_year, 6)).join("")}   trend`);
    console.log(`    ${pad("(rows)", 32)}${rows.map((r: any) => lp(r.n, 6)).join("")}`);
    for (const c of cols) {
      const series = rows.map((r: any) => Number(r[c]));
      const oldest = series[0], newest = series[series.length - 1];
      const drop = newest - oldest;
      const flag = drop >= 40 ? "  ⚠ DROPS GOING BACK" : drop >= 20 ? "  · declines" : "";
      const isDerived = derived.includes(c as never);
      console.log(`    ${pad(c + (isDerived ? " (derived)" : ""), 32)}${series.map((v) => lp(v, 6)).join("")}${flag}`);
    }
  }
  console.log(`\n  ⚠ T4e3 known boundaries — balance sheet only after ${BS_BOUNDARY}, cash flow only after ${CF_BOUNDARY}.`);
  console.log(`     A BS/CF field reading 0% in the older years is EXPECTED. A P&L field dropping is NOT.`);

  // ═══ T4e4 — scale anomalies ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4e4 — SCALE ANOMALIES between adjacent periods (>10x jump)                ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  for (const [tbl, keyCols] of [["fundamentals", `"fiscal_year"`], ["quarterly_results", `"fiscal_year","quarter"`]] as const) {
    for (const col of ["revenue", "net_profit"]) {
      const anom = await raw<any>(
        `WITH s AS (SELECT st."symbol", t."result_type", t."report_date", t."${col}"::float8 v, t."xbrl_url",
                           lag(t."${col}"::float8) OVER (PARTITION BY t."stock_id", t."result_type" ORDER BY t."report_date") prev
                      FROM ${tbl} t JOIN stocks st ON st."id"=t."stock_id"
                     WHERE t."updated_at" > TIMESTAMP '${CUT}')
         SELECT * FROM s WHERE prev IS NOT NULL AND v IS NOT NULL AND abs(prev) > 1
           AND (abs(v)/abs(prev) > 10 OR abs(prev)/NULLIF(abs(v),0) > 10)
         ORDER BY abs(v)/NULLIF(abs(prev),0) DESC LIMIT 8`);
      console.log(`  ${tbl}.${col}: ${anom.length} adjacent-period jumps >10x`);
      for (const a of anom) {
        fail++;
        console.log(`    ⚠ ${pad(a.symbol, 12)} ${a.result_type} ${String(a.report_date).slice(0, 10)}  ${a.prev} → ${a.v}  (${(Math.abs(a.v) / Math.abs(a.prev)).toFixed(1)}x)`);
        console.log(`       ${a.xbrl_url}`);
      }
    }
  }

  // ═══ T4e5 — standalone null where consolidated has a value ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4e5 — STANDALONE null where the SAME period's CONSOLIDATED has a value    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  for (const [tbl, map, grp] of [["fundamentals", ANNUAL_MAP, `"stock_id","fiscal_year"`], ["quarterly_results", QUARTERLY_MAP, `"stock_id","quarter","fiscal_year"`]] as const) {
    const cols = Object.keys(map);
    console.log(`  ${tbl}:`);
    let any = false;
    for (const c of cols) {
      const [r] = await raw<any>(
        // ⚠ Pair over ALL rows of the period, not only pilot-touched ones: a newly
        // written standalone whose consolidated sibling predates the pilot is exactly
        // the case this check exists for, and filtering both sides on updated_at
        // would silently drop it. Require only that the period was touched at all.
        `WITH p AS (SELECT ${grp},
                      max("${c}") FILTER (WHERE "result_type"='standalone')   AS sa,
                      max("${c}") FILTER (WHERE "result_type"='consolidated') AS co,
                      bool_or("result_type"='standalone') hs, bool_or("result_type"='consolidated') hc,
                      bool_or("updated_at" > TIMESTAMP '${CUT}') touched
                    FROM ${tbl} GROUP BY ${grp})
         SELECT count(*) FILTER (WHERE touched AND hs AND hc AND sa IS NULL AND co IS NOT NULL)::int AS n,
                count(*) FILTER (WHERE touched AND hs AND hc)::int AS pairs FROM p`);
      if (Number(r.n) > 0) { any = true; console.log(`    ⚠ ${pad(c, 30)} ${r.n} of ${r.pairs} dual-basis periods: standalone NULL, consolidated populated`); }
    }
    if (!any) console.log(`    ✓ none — no field is null on standalone while populated on consolidated`);
  }

  console.log(`\n═══ T4e: ${falseNulls.length === 0 ? "✓ NO FALSE NULLS DETECTED" : `✗ ${falseNulls.length} FALSE NULL(S)`} ═══`);
  for (const f of falseNulls.slice(0, 20)) console.log(`  ✗ ${f}`);
  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
