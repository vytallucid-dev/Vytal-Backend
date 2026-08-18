// ═══════════════════════════════════════════════════════════════
// R4b / R4c / R4e — FILL RATE, NULL CLASSIFICATION, CROSS-BASIS. READ-ONLY.
//   npx tsx src/scripts/_r4b-fill.ts
//
// R4b  per-column fill rate BY FISCAL PERIOD, all FOUR tables (the pilot covered
//      only two). Flags every column whose rate degrades going back.
// R4c  EVERY null classified GENUINE or UNEXPLAINED against the known boundaries:
//        · balance sheet   — only in filings broadcast after 2022-11-25
//        · cash flow       — only after 2021-11-24 (OneD fallback recovers FY21)
//        · PPE / CWIP / receivables / borrowings genuinely absent pre-boundary
//      A null on a row broadcast AFTER its boundary is UNEXPLAINED and is written
//      out for R4c-trace to dump the source document's element inventory.
// R4e  CROSS-BASIS ASYMMETRY — field null on standalone, populated on consolidated
//      for the SAME (stock, period). The cheapest false-null signal there is: the
//      two documents are filed together, so a field one carries and the other does
//      not is either a real disclosure difference or a read failure.
// ═══════════════════════════════════════════════════════════════
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { loadCohort } from "./_r1-cohort-def.js";
import { buildColMaps } from "./_r1-colmap.js";

const DIR = process.env.R1_DIR ?? ".";
const CUT = process.env.R2_CUT ?? "2026-08-16 11:38:00";
const BS_BOUNDARY = "2022-11-25", CF_BOUNDARY = "2021-11-24";
const raw = async <T = Record<string, unknown>>(s: string, ...p: unknown[]): Promise<T[]> =>
  (await prisma.$queryRawUnsafe(s, ...p)) as T[];
const pad = (s: unknown, n: number) => String(s).padEnd(n);
const lp = (s: unknown, n: number) => String(s).padStart(n);

// ── field groups, per table. A group decides WHICH boundary explains a null. ──
type Grp = "PNL" | "BS" | "CF" | "AQ" | "DERIVED";
const GROUPS: Record<string, Record<string, Grp>> = {
  fundamentals: {
    revenue: "PNL", otherIncome: "PNL", financeCosts: "PNL", depreciation: "PNL",
    profitBeforeTax: "PNL", netProfit: "PNL",
    equityShareCapital: "BS", otherEquity: "BS", totalEquity: "BS", borrowingsCurrent: "BS",
    borrowingsNoncurrent: "BS", totalAssets: "BS", currentLiabilities: "BS",
    tradeReceivablesCurrent: "BS", tradeReceivablesNoncurrent: "BS",
    propertyPlantAndEquipment: "BS", capitalWorkInProgress: "BS", faceValueShare: "BS",
    cashFromOperating: "CF", capex: "CF", cashFromFinancing: "CF",
    totalDebt: "DERIVED", roce: "DERIVED", roe: "DERIVED", debtToEquity: "DERIVED",
    interestCoverage: "DERIVED", receivablesDays: "DERIVED", assetTurnover: "DERIVED",
    netWorth: "DERIVED", operatingMargin: "DERIVED", ebitda: "DERIVED",
  },
  quarterly_results: {
    revenue: "PNL", otherIncome: "PNL", interest: "PNL", depreciation: "PNL",
    profitBeforeTax: "PNL", netProfit: "PNL", operatingProfit: "DERIVED",
  },
  banking_fundamentals: {
    interestEarned: "PNL", interestExpended: "PNL", otherIncome: "PNL", operatingExpenses: "PNL",
    ppop: "PNL", profitBeforeTax: "PNL", netProfit: "PNL",
    advances: "BS", investments: "BS", cashAndBalancesWithRbi: "BS", balancesWithBanks: "BS",
    totalAssets: "BS", deposits: "BS",
    gnpaAbsolute: "AQ", nnpaAbsolute: "AQ", gnpaPct: "AQ", nnpaPct: "AQ",
    cet1Ratio: "AQ", additionalTier1Ratio: "AQ", tier1Ratio: "AQ", roaDisclosed: "AQ",
    pcr: "DERIVED", costToIncomeRatio: "DERIVED", netInterestMargin: "DERIVED", nii: "DERIVED",
  },
  banking_quarterly_results: {
    interestEarned: "PNL", interestExpended: "PNL", otherIncome: "PNL", operatingExpenses: "PNL",
    ppop: "PNL", netProfit: "PNL",
    gnpaAbsolute: "AQ", nnpaAbsolute: "AQ", gnpaPct: "AQ", nnpaPct: "AQ",
    cet1Ratio: "AQ", additionalTier1Ratio: "AQ", roaQuarterly: "AQ",
  },
};

// ── ⚠ STRUCTURAL NULLS: fields the LEGACY path CANNOT fill, by construction. ──
// Read off the legacy parser/adapter, not guessed:
//   · parser-legacy-common.ts:621-624 hardcodes gnpaPct / nnpaPct / cet1Ratio /
//     additionalTier1Ratio to null on the banking ANNUAL leg — "not in v2".
//   · adapter.ts:84-102 (adaptToBankingQuarterly) passes null for interestExpended,
//     operatingExpenses and EVERY asset-quality / capital field on the banking
//     QUARTERLY leg — v2 only ever extracted P&L for banks.
// A null in one of these on a *_legacy row is GENUINE (the v2 taxonomy does not
// carry the fact); the SAME null on an nse_xbrl_* v3 row would be a real defect.
// So the classification is conditioned on the row's source, not on the column alone.
const V2_STRUCTURAL: Record<string, Set<string>> = {
  fundamentals: new Set(),
  quarterly_results: new Set(),
  // tier1Ratio is added on MEASURED evidence, not on reading the parser: on
  // nse_xbrl_annual_legacy rows tier1_ratio / cet1_ratio / gnpa_pct are 0/82,
  // while on nse_xbrl_annual rows they are 94/94. No legacy code path writes them.
  banking_fundamentals: new Set(["gnpaPct", "nnpaPct", "cet1Ratio", "additionalTier1Ratio", "tier1Ratio"]),
  banking_quarterly_results: new Set([
    "interestExpended", "operatingExpenses",
    "gnpaAbsolute", "nnpaAbsolute", "gnpaPct", "nnpaPct",
    "cet1Ratio", "additionalTier1Ratio", "roaQuarterly",
  ]),
};

async function main() {
  const cohort = await loadCohort();
  const ids = cohort.map((c) => c.id);
  const maps = await buildColMaps();
  const unexplained: Array<Record<string, unknown>> = [];

  // ═══ R4b — fill rate by fiscal year, per table ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R4b — PER-COLUMN FILL RATE BY FISCAL YEAR · ALL FOUR TABLES                ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);

  for (const m of maps) {
    const grp = GROUPS[m.table] ?? {};
    const sel = m.valueCols.map((v) => `count("${v.col}")::int AS "${v.field}"`).join(", ");
    if (!sel) continue;
    const fill = await raw<any>(
      `SELECT "fiscal_year" fy, count(*)::int n,
              count(*) FILTER (WHERE "filing_date" > TIMESTAMP '${BS_BOUNDARY}')::int post_bs,
              count(*) FILTER (WHERE "filing_date" > TIMESTAMP '${CF_BOUNDARY}')::int post_cf,
              ${sel}
         FROM "${m.table}" WHERE "stock_id" = ANY($1::text[]) GROUP BY 1 ORDER BY 1`, ids);
    if (!fill.length) continue;

    console.log(`\n  ══ ${m.table} ══`);
    console.log(`    ${pad("field [grp]", 36)}${fill.map((r: any) => lp(r.fy, 6)).join("")}`);
    console.log(`    ${pad("rows", 36)}${fill.map((r: any) => lp(r.n, 6)).join("")}`);
    console.log(`    ${pad("  of which bcast > BS bound", 36)}${fill.map((r: any) => lp(r.post_bs, 6)).join("")}`);
    console.log(`    ${pad("  of which bcast > CF bound", 36)}${fill.map((r: any) => lp(r.post_cf, 6)).join("")}`);

    const degrading: string[] = [];
    for (const v of m.valueCols) {
      const g = grp[v.field] ?? "PNL";
      const cells = fill.map((r: any) => {
        const pct = Math.round((100 * Number(r[v.field])) / Math.max(1, Number(r.n)));
        return lp(pct + "%", 6);
      });
      // degradation: newest FY fill vs oldest FY fill
      const first = Number(fill[0][v.field]) / Math.max(1, Number(fill[0].n));
      const last = Number(fill[fill.length - 1][v.field]) / Math.max(1, Number(fill[fill.length - 1].n));
      const deg = last - first > 0.15;
      if (deg) degrading.push(`${v.field} [${g}] ${(first * 100).toFixed(0)}% at ${fill[0].fy} → ${(last * 100).toFixed(0)}% at ${fill[fill.length - 1].fy}`);
      console.log(`    ${pad(`${v.field} [${g}]`, 36)}${cells.join("")}${deg ? "  ⚠ degrades going back" : ""}`);
    }
    console.log(`\n    columns whose fill DEGRADES going back: ${degrading.length}`);
    for (const d of degrading) console.log(`      ⚠ ${d}`);
  }

  // ═══ R4c — every null classified ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R4c — EVERY NULL CLASSIFIED: GENUINE (known boundary) or UNEXPLAINED       ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  console.log(`  boundaries: BS after ${BS_BOUNDARY} · CF after ${CF_BOUNDARY}`);
  console.log(`  a null on a row broadcast AFTER its group's boundary has no boundary excuse.\n`);

  let totGenuine = 0, totUnex = 0, totCells = 0;
  for (const m of maps) {
    const grp = GROUPS[m.table] ?? {};
    const hasQ = m.keyCols.includes("quarter");
    const cols = m.valueCols.map((v) => `"${v.col}"::text AS "${v.field}"`).join(", ");
    if (!cols) continue;
    const rows = await raw<any>(
      `SELECT x."id", st."symbol" s, x."fiscal_year" fy${hasQ ? `, x."quarter" q` : `, ''::text q`},
              x."result_type" rt, x."filing_date"::text fd, x."report_date"::text rd, x."source" src,
              x."xbrl_url" u, ${cols}
         FROM "${m.table}" x JOIN stocks st ON st."id"=x."stock_id"
        WHERE x."stock_id" = ANY($1::text[])`, ids);

    let gen = 0, unex = 0, cells = 0;
    const structural = V2_STRUCTURAL[m.table] ?? new Set<string>();
    const genByReason = new Map<string, number>();
    const unexByCol = new Map<string, number>();
    for (const r of rows) {
      const fd = String(r.fd ?? "").slice(0, 10);
      const isLegacy = String(r.src ?? "").includes("_legacy");
      for (const v of m.valueCols) {
        cells++;
        if (r[v.field] !== null) continue;
        const g = grp[v.field] ?? "PNL";
        let genuineReason = "";
        // ⚠ structural FIRST — and only on a legacy-sourced row
        if (isLegacy && structural.has(v.field)) genuineReason = `v2 taxonomy does not carry it (legacy row)`;
        else if ((g === "BS") && fd && fd <= BS_BOUNDARY) genuineReason = `BS boundary (broadcast ${fd} <= ${BS_BOUNDARY})`;
        else if (g === "CF" && fd && fd <= CF_BOUNDARY) genuineReason = `CF boundary (broadcast ${fd} <= ${CF_BOUNDARY})`;
        else if (g === "DERIVED") genuineReason = `derived — follows its inputs`;
        if (genuineReason) { gen++; genByReason.set(genuineReason.replace(/\(.*\)/, "").trim(), (genByReason.get(genuineReason.replace(/\(.*\)/, "").trim()) ?? 0) + 1); continue; }
        unex++;
        unexByCol.set(v.field, (unexByCol.get(v.field) ?? 0) + 1);
        if (unexplained.length < 4000) {
          unexplained.push({ table: m.table, id: r.id, sym: r.s, fy: r.fy, q: r.q, rt: r.rt, col: v.field, grp: g, fd, rd: r.rd, src: r.src, url: r.u });
        }
      }
    }
    totGenuine += gen; totUnex += unex; totCells += cells;
    console.log(`  ${pad(m.table, 28)} cells ${lp(cells, 7)} · nulls ${lp(gen + unex, 7)} = GENUINE ${lp(gen, 7)} + ⚠ UNEXPLAINED ${lp(unex, 6)}`);
    for (const [r2, n] of [...genByReason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      genuine: ${pad(r2, 44)}${lp(n, 7)}`);
    }
    if (unexByCol.size) {
      for (const [c, n] of [...unexByCol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
        console.log(`      ⚠ ${pad(c, 32)}${lp(n, 6)} unexplained null(s)  [${grp[c] ?? "PNL"}]`);
      }
      if (unexByCol.size > 14) console.log(`      … ${unexByCol.size - 14} more columns`);
    }
  }
  console.log(`\n  TOTAL cells ${totCells} · GENUINE nulls ${totGenuine} · ⚠ UNEXPLAINED ${totUnex}`);
  console.log(`  ⇒ every UNEXPLAINED null is written out for element-inventory tracing (R4c-trace).`);
  writeFileSync(`${DIR}/_r4c-unexplained.json`, JSON.stringify(unexplained, null, 1));
  console.log(`  → ${DIR}/_r4c-unexplained.json  (${unexplained.length} record(s))`);

  // ═══ R4e — CROSS-BASIS ASYMMETRY ═══
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║ R4e — CROSS-BASIS ASYMMETRY (null on standalone, populated on consolidated)║`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════╝`);
  const asym: Array<Record<string, unknown>> = [];
  for (const m of maps) {
    const grp = GROUPS[m.table] ?? {};
    const hasQ = m.keyCols.includes("quarter");
    const keyCols = hasQ ? `"fiscal_year","quarter"` : `"fiscal_year"`;
    for (const v of m.valueCols) {
      const rows = await raw<any>(
        `SELECT st."symbol" s, a."fiscal_year" fy${hasQ ? `, a."quarter" q` : `, ''::text q`},
                a."filing_date"::text fd, a."xbrl_url" u, a."id"
           FROM "${m.table}" a
           JOIN "${m.table}" b ON b."stock_id"=a."stock_id" AND b."fiscal_year"=a."fiscal_year"
                ${hasQ ? `AND b."quarter"=a."quarter"` : ``} AND b."result_type"='consolidated'
           JOIN stocks st ON st."id"=a."stock_id"
          WHERE a."stock_id" = ANY($1::text[]) AND a."result_type"='standalone'
            AND a."${v.col}" IS NULL AND b."${v.col}" IS NOT NULL`, ids);
      for (const r of rows) asym.push({ table: m.table, col: v.field, grp: grp[v.field] ?? "PNL", sym: r.s, fy: r.fy, q: r.q, fd: String(r.fd ?? "").slice(0, 10), url: r.u, id: r.id });
      void keyCols;
    }
  }
  console.log(`  asymmetric (field, stock, period) instances: ${asym.length === 0 ? "✓ 0" : "⚠ " + asym.length}`);
  const byCol = new Map<string, number>();
  for (const a of asym) byCol.set(`${a.table}.${a.col}`, (byCol.get(`${a.table}.${a.col}`) ?? 0) + 1);
  for (const [k, n] of [...byCol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`    ⚠ ${pad(k, 50)}${lp(n, 6)}`);
  }
  // Are they concentrated in one era? That distinguishes a boundary from a read failure.
  const byEra = new Map<string, number>();
  for (const a of asym) { const e = String(a.fd) > BS_BOUNDARY ? `post-BS-boundary` : `pre-BS-boundary`; byEra.set(e, (byEra.get(e) ?? 0) + 1); }
  console.log(`  by era: ${[...byEra.entries()].map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log(`  ⇒ post-boundary asymmetry is the suspicious kind — a document filed after the`);
  console.log(`    boundary that carries the field on one basis but not the other.`);
  writeFileSync(`${DIR}/_r4e-asymmetry.json`, JSON.stringify(asym, null, 1));
  console.log(`  → ${DIR}/_r4e-asymmetry.json`);

  console.log();
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error("FATAL", e); await prisma.$disconnect(); process.exit(1); });
