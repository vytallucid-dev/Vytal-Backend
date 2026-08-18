// ═══════════════════════════════════════════════════════════════
// T4e1 (re-sampled ACROSS fiscal years) + T4e4 scale-anomaly deep dive.
// READ-ONLY — fetches source documents, writes nothing.
//   npx tsx src/scripts/_t4-fn2.ts
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { prisma } from "../db/prisma.js";
import { fetchXbrlFile } from "../ingestions/quaterly-results/legacy/discovery-legacy.js";

const CUT = process.env.T4_CUT ?? "2026-08-16 09:30:03";
const RUPEES_PER_CRORE = 1e7;
const A_PNL = "FourD", Q_PNL = "OneD", BS = "OneI";
const ANNUAL_MAP: Record<string, { tag: string; ctx: string; alt?: string }> = {
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
  cash_from_operating: { tag: "CashFlowsFromUsedInOperatingActivities", ctx: A_PNL },
  capex: { tag: "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", ctx: A_PNL },
  cash_from_financing: { tag: "CashFlowsFromUsedInFinancingActivities", ctx: A_PNL },
  face_value_share: { tag: "FaceValueOfEquityShareCapital", ctx: BS },
};
const QUARTERLY_MAP: Record<string, { tag: string; ctx: string; alt?: string }> = {
  revenue: { tag: "RevenueFromOperations", ctx: Q_PNL },
  other_income: { tag: "OtherIncome", ctx: Q_PNL },
  interest: { tag: "FinanceCosts", ctx: Q_PNL },
  depreciation: { tag: "DepreciationDepletionAndAmortisationExpense", ctx: Q_PNL },
  profit_before_tax: { tag: "ProfitBeforeTax", ctx: Q_PNL },
  net_profit: { tag: "ProfitLossForPeriod", ctx: Q_PNL, alt: "ProfitOrLossAttributableToOwnersOfParent" },
};
const BS_BOUNDARY = "2022-11-25", CF_BOUNDARY = "2021-11-24";
const BS_FIELDS = new Set(Object.entries(ANNUAL_MAP).filter(([, v]) => v.ctx === BS).map(([k]) => k));
const CF_FIELDS = new Set(["cash_from_operating", "cash_from_financing", "capex"]);

const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
/** Every occurrence of one tag: context, unitRef, decimals, raw value. */
function occurrences(xml: string, tag: string) {
  const out: { ctx: string; unit: string; decimals: string; rawValue: string }[] = [];
  const re = new RegExp(`<in-bse-fin:${tag}\\b([^>]*)>([^<]*)</in-bse-fin:${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const at = m[1];
    out.push({
      ctx: /contextRef="([^"]+)"/.exec(at)?.[1] ?? "-",
      unit: /unitRef="([^"]+)"/.exec(at)?.[1] ?? "-",
      decimals: /decimals="([^"]+)"/.exec(at)?.[1] ?? "-",
      rawValue: m[2].trim(),
    });
  }
  return out;
}

async function main() {
  // ═══ T4e1 — ONE row per fiscal year, both tables ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4e1 (RE-SAMPLED) — one newly-written row per FISCAL YEAR                  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const sample = await raw<any>(
    `(SELECT DISTINCT ON (f."fiscal_year") 'fundamentals' AS tbl, f."id", st."symbol", f."fiscal_year",
             NULL::text AS quarter, f."result_type", f."xbrl_url", f."filing_date"::text AS filing_date
        FROM fundamentals f JOIN stocks st ON st."id"=f."stock_id"
       WHERE f."updated_at" > TIMESTAMP '${CUT}' ORDER BY f."fiscal_year", f."id")
     UNION ALL
     (SELECT DISTINCT ON (q."fiscal_year") 'quarterly_results', q."id", st."symbol", q."fiscal_year",
             q."quarter", q."result_type", q."xbrl_url", q."filing_date"::text
        FROM quarterly_results q JOIN stocks st ON st."id"=q."stock_id"
       WHERE q."updated_at" > TIMESTAMP '${CUT}' ORDER BY q."fiscal_year", q."id")`);
  console.log(`  ${sample.length} rows · fiscal years: ${[...new Set(sample.map((s: any) => s.fiscal_year))].sort().join(", ")}\n`);

  let genuine = 0, falseWrongCtx = 0, falseParserBug = 0, populated = 0, totalFields = 0;
  const falseNulls: string[] = [];
  for (const row of sample) {
    const map = row.tbl === "fundamentals" ? ANNUAL_MAP : QUARTERLY_MAP;
    const cols = Object.keys(map);
    const dbRow = (await raw<any>(`SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM ${row.tbl} WHERE "id"=$1`, row.id))[0];
    let xml: string;
    try { xml = await fetchXbrlFile(row.xbrl_url); } catch (e) {
      console.log(`  ${row.symbol} ${row.fiscal_year} — XBRL unreachable (${(e as Error).message})`); continue;
    }
    const inv = inventory(xml);
    const nulls = cols.filter((c) => dbRow[c] === null);
    totalFields += cols.length; populated += cols.length - nulls.length;
    console.log(`  ── ${pad(`${row.symbol} ${row.fiscal_year}${row.quarter ? " " + row.quarter : ""} ${row.result_type}`, 40)} ${pad(row.tbl, 18)} bcast ${String(row.filing_date).slice(0, 10)} · ${inv.size} elements · ${cols.length - nulls.length}/${cols.length} filled`);
    for (const c of nulls) {
      const { tag, ctx, alt } = map[c];
      const tags = [tag, ...(alt ? [alt] : [])];
      const present = tags.filter((t) => inv.has(t));
      const right = tags.filter((t) => inv.get(t)?.has(ctx));
      if (present.length === 0) {
        genuine++;
        const bnd = BS_FIELDS.has(c) && String(row.filing_date) < BS_BOUNDARY ? " [known BS boundary]"
                  : CF_FIELDS.has(c) && String(row.filing_date) < CF_BOUNDARY ? " [known CF boundary]" : "";
        console.log(`       ${pad(c, 30)} GENUINE — absent${bnd}`);
      } else if (right.length === 0) {
        falseWrongCtx++;
        const v = `✗ FALSE NULL (wrong ctx) — ${present[0]} present in {${[...(inv.get(present[0]) ?? [])].join(",")}}, wanted "${ctx}"`;
        console.log(`       ${pad(c, 30)} ${v}`); falseNulls.push(`${row.symbol} ${row.fiscal_year} ${c}: ${v}`);
      } else {
        falseParserBug++;
        const v = `✗ FALSE NULL (parser) — present in "${ctx}" yet read null`;
        console.log(`       ${pad(c, 30)} ${v}`); falseNulls.push(`${row.symbol} ${row.fiscal_year} ${c}: ${v}`);
      }
    }
    await sleep(350);
  }
  console.log(`\n  fields ${populated}/${totalFields} populated · GENUINE nulls ${genuine}`);
  console.log(`  FALSE NULLS: wrong-context ${falseWrongCtx} · parser-bug ${falseParserBug}  ${falseWrongCtx + falseParserBug === 0 ? "✓ NONE" : "✗"}`);

  // ═══ T4e4 — deep dive on the flagged small-magnitude rows ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ T4e4 DEEP DIVE — is a suspiciously SMALL value in the document or ours?    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const susp = await raw<any>(
    `SELECT st."symbol", q."quarter", q."fiscal_year", q."result_type", q."revenue"::float8 AS revenue,
            q."net_profit"::float8 AS net_profit, q."xbrl_url", q."report_date"::text AS report_date
       FROM quarterly_results q JOIN stocks st ON st."id"=q."stock_id"
      WHERE q."updated_at" > TIMESTAMP '${CUT}' AND q."revenue" IS NOT NULL AND q."revenue" < 100
      ORDER BY q."revenue" LIMIT 6`);
  console.log(`  newly-written quarterly rows with revenue < ₹100 Cr: ${susp.length} (inspecting the smallest)\n`);
  for (const s of susp) {
    console.log(`  ── ${s.symbol} ${s.fiscal_year} ${s.quarter} ${s.result_type} (${String(s.report_date).slice(0, 10)})`);
    console.log(`     DB: revenue=${s.revenue} Cr · net_profit=${s.net_profit} Cr`);
    let xml: string;
    try { xml = await fetchXbrlFile(s.xbrl_url); } catch (e) { console.log(`     doc unreachable: ${(e as Error).message}`); continue; }
    for (const tag of ["RevenueFromOperations", "ProfitLossForPeriod"]) {
      const occ = occurrences(xml, tag);
      console.log(`     <${tag}> occurrences in the document (${occ.length}):`);
      for (const o of occ.slice(0, 6)) {
        const asCr = o.unit === "INR" ? (parseFloat(o.rawValue) / RUPEES_PER_CRORE).toFixed(2) : `${o.rawValue} (unit ${o.unit}, NOT divided)`;
        console.log(`       ctx=${pad(o.ctx, 10)} unit=${pad(o.unit, 8)} decimals=${pad(o.decimals, 5)} raw=${pad(o.rawValue, 18)} → ${asCr} Cr`);
      }
    }
    const [nb] = await raw<any>(
      `SELECT count(*)::int n, avg("revenue")::float8 avg_rev FROM quarterly_results q
         JOIN stocks st ON st."id"=q."stock_id"
        WHERE st."symbol"=$1 AND q."result_type"=$2 AND q."revenue" IS NOT NULL AND q."revenue" >= 100`, s.symbol, s.result_type);
    console.log(`     neighbours (same symbol+basis, revenue >= 100 Cr): n=${nb.n}, mean ${Number(nb.avg_rev).toFixed(0)} Cr`);
    console.log(`     ${s.xbrl_url}`);
    await sleep(350);
  }

  console.log(`\n═══ ${falseNulls.length === 0 ? "✓ NO FALSE NULLS ACROSS THE FISCAL-YEAR SPREAD" : `✗ ${falseNulls.length} FALSE NULL(S)`} ═══\n`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
