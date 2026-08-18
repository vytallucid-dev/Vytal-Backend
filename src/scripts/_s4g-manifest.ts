// ═══════════════════════════════════════════════════════════════
// S4G · PART 2/3 — THE MANUAL-ENTRY MANIFEST. READ-ONLY. Writes CSV + MD only.
//   npx tsx src/scripts/_s4g-manifest.ts
//
// ⚠ BASIS IS STANDALONE, AND THAT IS THE WHOLE SCOPE. Every scoring loader —
//   loadFoundationStandalone / loadMomentumStandalone (metrics/load.ts:30,76) and both
//   banking loaders (banking-load.ts:18,56) — filters resultType:"standalone". A
//   consolidated cell is never read by any metric, so keying one buys nothing.
//
// ⚠ FIELD SCOPE = score-input-columns.ts `relevant`, MINUS keys, MINUS derived.
//   Keys (stockId/resultType/reportDate/fiscalYear/quarter) are the row's identity —
//   not values a human keys. Derived columns are computed by the derive layer from the
//   raw cells (derive-indas-annual.ts, derive-financial-quarterly.ts) and re-filled by
//   src/fill/re-derive.ts, so keying them is work the machine already does:
//     quarterly  operating_profit          = pbt + interest + depreciation
//     annual     total_debt                = borrowings_current + borrowings_noncurrent
//                roce roe debt_to_equity interest_coverage receivables_days
//                asset_turnover net_worth operating_margin ebitda
//     banking    nii net_interest_margin cost_to_income_ratio pcr
//   They ARE score-relevant. They are not MANUAL-ENTRY work. Both are true.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";

const OUT = process.env.S4G_OUT ?? "c:/Vytal/Vytal/outputs";
mkdirSync(OUT, { recursive: true });
const raw = async <T = any>(s: string, ...p: unknown[]): Promise<T[]> => (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

// ── window + period algebra (identical to _s4d-recount.ts) ──────────────────
const WIN_START = "2018-03-31", WIN_END = "2024-12-31";
const CUTOFF = "2022-01-31";                 // the momentum as-of
const BS_BOUNDARY = "2022-11-25", CF_BOUNDARY = "2021-11-24";
const qi = (d: string) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return y * 4 + Math.floor((m - 1) / 3); };
const ql = (i: number) => { const y = Math.floor(i / 4), q = i % 4; return `${y}-${String(q * 3 + 3).padStart(2, "0")}-${[31, 30, 30, 31][q]}`; };
const I_START = qi(WIN_START), I_END = qi(WIN_END);
const I_CUT = qi("2021-12-31");              // latest quarter-end ≤ 2022-01-31

// ── field sets ─────────────────────────────────────────────────────────────
// why_needed is per FIELD: the metric or surface that consumes it.
type F = { col: string; why: string; grp?: "BS" | "CF" };
const Q_NF: F[] = [
  { col: "revenue", why: "M1 TTM OPM · M3 revenue YoY (momentum.ts m1TtmOpm/m3RevenueYoyTtm); Quarter Brief revenue line" },
  { col: "other_income", why: "M1/M2 TTM margins — operating profit derive input (pbt+interest+dep)" },
  { col: "interest", why: "M5 TTM interest coverage (m5TtmInterestCoverage); operating_profit derive input" },
  { col: "depreciation", why: "M5 interest coverage denominator; operating_profit derive input" },
  { col: "profit_before_tax", why: "M5 TTM interest coverage numerator; operating_profit derive input" },
  { col: "net_profit", why: "M2 TTM net margin · M4 net-profit YoY (m2TtmNpm/m4NetProfitYoyTtm)" },
];
const A_NF: F[] = [
  { col: "revenue", why: "Foundation operating_margin / asset_turnover derive; F-pillar revenue base" },
  { col: "other_income", why: "Foundation ebitda + operating_margin derive input" },
  { col: "finance_costs", why: "Foundation interest_coverage derive input" },
  { col: "depreciation", why: "Foundation ebitda derive input" },
  { col: "profit_before_tax", why: "Foundation roce + interest_coverage derive input" },
  { col: "net_profit", why: "Foundation roe + net_worth path" },
  { col: "equity_share_capital", why: "Foundation net_worth / roe denominator", grp: "BS" },
  { col: "other_equity", why: "Foundation net_worth / roe denominator", grp: "BS" },
  { col: "total_equity", why: "Foundation roe · debt_to_equity denominator", grp: "BS" },
  { col: "borrowings_current", why: "Foundation total_debt + debt_to_equity", grp: "BS" },
  { col: "borrowings_noncurrent", why: "Foundation total_debt + debt_to_equity", grp: "BS" },
  { col: "total_assets", why: "Foundation asset_turnover · roce denominator", grp: "BS" },
  { col: "current_liabilities", why: "Foundation roce (capital employed = assets − current liabilities)", grp: "BS" },
  { col: "trade_receivables_current", why: "Foundation receivables_days", grp: "BS" },
  { col: "trade_receivables_noncurrent", why: "Foundation receivables_days", grp: "BS" },
  { col: "property_plant_and_equipment", why: "Foundation asset base / capex intensity read", grp: "BS" },
  { col: "capital_work_in_progress", why: "Foundation asset base / capex intensity read", grp: "BS" },
  { col: "cash_from_operating", why: "Foundation cash-conversion read (loadFoundationStandalone)", grp: "CF" },
  { col: "capex", why: "Foundation FCF / capex intensity", grp: "CF" },
  { col: "cash_from_financing", why: "Foundation financing read", grp: "CF" },
  { col: "face_value_share", why: "Foundation per-share normalisation", grp: "BS" },
];
const Q_BK: F[] = [
  { col: "interest_earned", why: "banking M1 NIM (m1NimTtm) · M3 NII YoY numerator" },
  { col: "interest_expended", why: "banking M1 NIM (nii = earned − expended) — ⚠ Aman ruling: key pre-2022" },
  { col: "other_income", why: "banking cost-to-income / PPOP cross-check" },
  { col: "operating_expenses", why: "banking M2 PPOP YoY input" },
  { col: "ppop", why: "banking M2 PPOP YoY (m2PpopYoy)" },
  { col: "net_profit", why: "banking M4 net-profit YoY (m4NpYoy)" },
  { col: "gnpa_absolute", why: "banking M5 gross-NPA TTM absolute leg" },
  { col: "nnpa_absolute", why: "banking asset-quality read" },
  { col: "gnpa_pct", why: "banking M5 GNPA TTM (m5GnpaTtm) — ⚠ Aman ruling: key pre-2022" },
  { col: "nnpa_pct", why: "banking asset-quality read" },
  { col: "cet1_ratio", why: "banking capital-adequacy foundation metric" },
  { col: "additional_tier1_ratio", why: "banking capital-adequacy foundation metric" },
  { col: "roa_quarterly", why: "banking profitability foundation metric" },
];
const A_BK: F[] = [
  { col: "interest_earned", why: "banking M3 NII YoY (annual) numerator" },
  { col: "interest_expended", why: "banking M3 NII YoY (nii = earned − expended)" },
  { col: "other_income", why: "banking cost_to_income_ratio derive input" },
  { col: "operating_expenses", why: "banking M2 PPOP YoY · cost_to_income derive" },
  { col: "ppop", why: "banking M2 PPOP YoY (annual, m2PpopYoy)" },
  { col: "profit_before_tax", why: "banking foundation profitability" },
  { col: "net_profit", why: "banking M4 net-profit YoY (annual)" },
  { col: "advances", why: "banking M1 NIM earning-assets base — ⚠ Aman ruling: key pre-2022" },
  { col: "investments", why: "banking M1 NIM earning-assets base — ⚠ Aman ruling: key pre-2022" },
  { col: "cash_and_balances_with_rbi", why: "banking M1 NIM earning-assets base — ⚠ Aman ruling: key pre-2022" },
  { col: "balances_with_banks", why: "banking M1 NIM earning-assets base — ⚠ Aman ruling: key pre-2022" },
  { col: "total_assets", why: "banking roa / balance-sheet foundation" },
  { col: "deposits", why: "banking credit_deposit_ratio · funding read" },
  { col: "gnpa_absolute", why: "banking asset-quality foundation" },
  { col: "nnpa_absolute", why: "banking asset-quality foundation" },
  { col: "gnpa_pct", why: "banking M5 GNPA · asset-quality foundation" },
  { col: "nnpa_pct", why: "banking asset-quality foundation" },
  { col: "cet1_ratio", why: "banking capital adequacy" },
  { col: "additional_tier1_ratio", why: "banking capital adequacy" },
  { col: "tier1_ratio", why: "banking capital adequacy (annual loader reads this)" },
  { col: "roa_disclosed", why: "banking disclosed ROA foundation metric" },
];

const TBL = {
  q_nf: { name: "quarterly_results", fields: Q_NF },
  a_nf: { name: "fundamentals", fields: A_NF },
  q_bk: { name: "banking_quarterly_results", fields: Q_BK },
  a_bk: { name: "banking_fundamentals", fields: A_BK },
} as const;

interface Cell {
  symbol: string; industry: string; table: string; basis: string;
  fiscalYear: string; quarter: string; reportDate: string;
  type: "A" | "B" | "C"; field: string; why: string;
  sourceHint: string; xbrlUrl: string; momentumCritical: boolean;
}

async function main() {
  const cohort = await loadCohort();
  const bySym = new Map(cohort.map((c) => [c.symbol, c]));
  const nfSyms = cohort.filter((c) => c.industryType === "non_financial").map((c) => c.symbol);
  const bkSyms = cohort.filter((c) => c.industryType === "banking").map((c) => c.symbol);
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ S4G — MANUAL-ENTRY MANIFEST · cohort ${cohort.length} (nf ${nfSyms.length} · banking ${bkSyms.length}) · READ-ONLY   ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  // ── pull every row we hold, per table, with the raw cells ────────────────
  const sel = (fs: F[]) => fs.map((f) => `t."${f.col}"`).join(",");
  const qNf = await raw(`SELECT s."symbol" sym,t."report_date"::text rd,t."result_type" rt,t."fiscal_year" fy,t."quarter" q,
      t."filing_date"::text fd,t."xbrl_url" url,${sel(Q_NF)} FROM quarterly_results t JOIN stocks s ON s."id"=t."stock_id"
     WHERE t."report_date" BETWEEN DATE '${WIN_START}' AND DATE '${WIN_END}'`);
  const aNf = await raw(`SELECT s."symbol" sym,t."report_date"::text rd,t."result_type" rt,t."fiscal_year" fy,
      t."filing_date"::text fd,t."xbrl_url" url,${sel(A_NF)} FROM fundamentals t JOIN stocks s ON s."id"=t."stock_id"
     WHERE t."report_date" BETWEEN DATE '${WIN_START}' AND DATE '${WIN_END}'`);
  const qBk = await raw(`SELECT s."symbol" sym,t."report_date"::text rd,t."result_type" rt,t."fiscal_year" fy,t."quarter" q,
      t."filing_date"::text fd,t."xbrl_url" url,${sel(Q_BK)} FROM banking_quarterly_results t JOIN stocks s ON s."id"=t."stock_id"
     WHERE t."report_date" BETWEEN DATE '${WIN_START}' AND DATE '${WIN_END}'`);
  const aBk = await raw(`SELECT s."symbol" sym,t."report_date"::text rd,t."result_type" rt,t."fiscal_year" fy,
      t."filing_date"::text fd,t."xbrl_url" url,${sel(A_BK)} FROM banking_fundamentals t JOIN stocks s ON s."id"=t."stock_id"
     WHERE t."report_date" BETWEEN DATE '${WIN_START}' AND DATE '${WIN_END}'`);
  console.log(`  rows held: quarterly_results ${qNf.length} · fundamentals ${aNf.length} · banking_quarterly ${qBk.length} · banking_fundamentals ${aBk.length}`);

  // index: sym -> basis -> ordinal/fy -> row
  type Idx = Map<string, Map<string, Map<number | string, any>>>;
  const mkIdx = (rows: any[], key: (r: any) => number | string): Idx => {
    const m: Idx = new Map();
    for (const r of rows) {
      if (!bySym.has(r.sym)) continue;
      if (!m.has(r.sym)) m.set(r.sym, new Map());
      const b = m.get(r.sym)!;
      if (!b.has(r.rt)) b.set(r.rt, new Map());
      b.get(r.rt)!.set(key(r), r);
    }
    return m;
  };
  const iQNf = mkIdx(qNf, (r) => qi(r.rd.slice(0, 10)));
  const iANf = mkIdx(aNf, (r) => r.fy);
  const iQBk = mkIdx(qBk, (r) => qi(r.rd.slice(0, 10)));
  const iABk = mkIdx(aBk, (r) => r.fy);

  const cells: Cell[] = [];
  const perStock = new Map<string, { A: number; B: number; C: number; periodsC: Set<string>; periodsB: Set<string> }>();
  const bump = (sym: string, t: "A" | "B" | "C", periodKey?: string) => {
    if (!perStock.has(sym)) perStock.set(sym, { A: 0, B: 0, C: 0, periodsC: new Set(), periodsB: new Set() });
    const s = perStock.get(sym)!; s[t]++;
    if (t === "C" && periodKey) s.periodsC.add(periodKey);
    if (t === "B" && periodKey) s.periodsB.add(periodKey);
  };

  let exclBoundary = 0, exclPreFirst = 0;

  // ── QUARTERLY sweep ──────────────────────────────────────────────────────
  for (const c of cohort) {
    const isBk = c.industryType === "banking";
    const idx = isBk ? iQBk : iQNf;
    const tbl = isBk ? TBL.q_bk : TBL.q_nf;
    const sa = idx.get(c.symbol)?.get("standalone") ?? new Map();
    const co = idx.get(c.symbol)?.get("consolidated") ?? new Map();
    const any = new Set<number>([...sa.keys(), ...co.keys()] as number[]);
    if (any.size === 0) continue;                       // no rows at all — handled in the report
    const first = Math.min(...any);
    exclPreFirst += Math.max(0, first - I_START);       // periods before listing: nothing to key

    for (let i = first; i <= I_END; i++) {
      const rd = ql(i);
      const row = sa.get(i);
      const fy = row?.fy ?? "", q = row?.q ?? "";
      const mom = i <= I_CUT;
      if (row) {
        // TYPE A — row held, specific cells null
        for (const f of tbl.fields) {
          if (row[f.col] !== null && row[f.col] !== undefined) continue;
          cells.push({
            symbol: c.symbol, industry: c.industryType, table: tbl.name, basis: "standalone",
            fiscalYear: fy, quarter: q, reportDate: rd, type: "A", field: f.col, why: f.why,
            sourceHint: "the XBRL filing we already hold (xbrl_url) — open it and read the line item",
            xbrlUrl: row.url ?? "", momentumCritical: mom,
          });
          bump(c.symbol, "A");
        }
      } else if (co.has(i)) {
        // TYPE B — standalone missing, consolidated held ⇒ RE-INGEST, not keying
        const cr = co.get(i);
        for (const f of tbl.fields) {
          cells.push({
            symbol: c.symbol, industry: c.industryType, table: tbl.name, basis: "standalone",
            fiscalYear: cr.fy ?? "", quarter: cr.q ?? "", reportDate: rd, type: "B", field: f.col, why: f.why,
            sourceHint: "RE-INGEST, NOT MANUAL ENTRY — consolidated row held for this period; NSE serves the standalone filing",
            xbrlUrl: cr.url ?? "", momentumCritical: mom,
          });
          bump(c.symbol, "B", rd);
        }
      } else {
        // TYPE C — no row either basis ⇒ source gap
        for (const f of tbl.fields) {
          cells.push({
            symbol: c.symbol, industry: c.industryType, table: tbl.name, basis: "standalone",
            fiscalYear: "", quarter: "", reportDate: rd, type: "C", field: f.col, why: f.why,
            sourceHint: rd === "2022-06-30"
              ? "company quarterly results PDF for Q1 FY23 (the known NSE FY23Q1 gap) — investor-relations site or BSE filing"
              : "company quarterly results PDF / annual report for this quarter — investor-relations site or BSE filing",
            xbrlUrl: "", momentumCritical: mom,
          });
          bump(c.symbol, "C", rd);
        }
      }
    }
  }

  // ── ANNUAL sweep ─────────────────────────────────────────────────────────
  for (const c of cohort) {
    const isBk = c.industryType === "banking";
    const idx = isBk ? iABk : iANf;
    const tbl = isBk ? TBL.a_bk : TBL.a_nf;
    const sa = idx.get(c.symbol)?.get("standalone") ?? new Map();
    const co = idx.get(c.symbol)?.get("consolidated") ?? new Map();
    // ⚠ THE GRID IS THE FULL FY RUN, NOT THE FYs WE HAPPEN TO HOLD. Walking only the
    //   existing keys makes a MISSING ANNUAL PERIOD invisible — the annual analogue of the
    //   quarterly hole, and it silently reported `fundamentals` type-C as 0. first-filed FY
    //   → FY24 (the last fiscal year that closes inside the 2024-12-31 window).
    const fyOrd = (fy: string) => { const m = /^FY(\d{2})$/.exec(fy); return m ? 2000 + +m[1] : NaN; };
    const fyLbl = (o: number) => `FY${String(o).slice(2)}`;
    const ords = [...new Set<string>([...sa.keys(), ...co.keys()] as string[])].map(fyOrd).filter(Number.isFinite);
    if (!ords.length) continue;
    const fyFirst = Math.min(...ords), FY_LAST = 2024;
    const fys: string[] = [];
    for (let o = fyFirst; o <= FY_LAST; o++) fys.push(fyLbl(o));
    for (const fy of fys) {
      const row = sa.get(fy);
      if (row) {
        const fd = (row.fd ?? "").slice(0, 10);
        for (const f of tbl.fields) {
          if (row[f.col] !== null && row[f.col] !== undefined) continue;
          // ⚠ BOUNDARY EXCLUSION — the null is explained, not a defect.
          if (f.grp === "BS" && fd && fd <= BS_BOUNDARY) { exclBoundary++; continue; }
          if (f.grp === "CF" && fd && fd <= CF_BOUNDARY) { exclBoundary++; continue; }
          cells.push({
            symbol: c.symbol, industry: c.industryType, table: tbl.name, basis: "standalone",
            fiscalYear: fy, quarter: "", reportDate: (row.rd ?? "").slice(0, 10), type: "A", field: f.col, why: f.why,
            sourceHint: "the XBRL filing we already hold (xbrl_url) — open it and read the line item",
            xbrlUrl: row.url ?? "", momentumCritical: false,
          });
          bump(c.symbol, "A");
        }
      } else if (co.has(fy)) {
        const cr = co.get(fy);
        for (const f of tbl.fields) {
          cells.push({
            symbol: c.symbol, industry: c.industryType, table: tbl.name, basis: "standalone",
            fiscalYear: fy, quarter: "", reportDate: (cr.rd ?? "").slice(0, 10), type: "B", field: f.col, why: f.why,
            sourceHint: "RE-INGEST, NOT MANUAL ENTRY — consolidated annual row held; NSE serves the standalone filing",
            xbrlUrl: cr.url ?? "", momentumCritical: false,
          });
          bump(c.symbol, "B", `FY${fy}`);
        }
      } else {
        // TYPE C — annual period absent on BOTH bases ⇒ source gap, key from the annual report.
        for (const f of tbl.fields) {
          cells.push({
            symbol: c.symbol, industry: c.industryType, table: tbl.name, basis: "standalone",
            fiscalYear: fy, quarter: "", reportDate: "", type: "C", field: f.col, why: f.why,
            sourceHint: "company ANNUAL REPORT for this fiscal year — investor-relations site (audited statements)",
            xbrlUrl: "", momentumCritical: false,
          });
          bump(c.symbol, "C", `FY${fy}`);
        }
      }
    }
  }

  console.log(`\n  manifest cells: ${cells.length}`);
  console.log(`  excluded — boundary-explained annual nulls (BS ≤ ${BS_BOUNDARY} / CF ≤ ${CF_BOUNDARY}) : ${exclBoundary}`);
  console.log(`  excluded — quarters before a stock's first filing                                : ${exclPreFirst} periods`);

  writeFileSync(`${OUT}/_s4g-cells.json`, JSON.stringify({ cells, exclBoundary, exclPreFirst }, null, 0));
  console.log(`\n  → ${OUT}/_s4g-cells.json (intermediate)`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
