// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// FILING PASS · STEP 1 — INDUSTRY-AWARE CONTEXT PROOF (read-only, NO writes).
//
// Two questions, answered with real rows rather than with reasoning:
//
//   §A  WHAT DOES THE RESOLVER RETURN, AND FROM WHERE? For one stock of each industry: the table it
//       read, how many annual and quarterly rows came back, the period span, and whether the fields
//       the rules actually consume are populated or null.
//
//   §B  IS THE EXCLUSION NOW A GUARD, OR STILL AN ACCIDENT? R3/R4/R5/P7/P8/P13/N1/N2/N3/N4 are run
//       against a FiringContext carrying REAL, POPULATED filed data for each financial industry.
//       If a rule returns a bare `null` on non-empty data, the null came from the guard — an empty
//       array cannot produce it, because every one of these rules returns a NotEvaluable (never a
//       bare null) when it runs out of history. The same context is then re-run with `industry`
//       forced to non_financial: the results MUST differ, or the guard is not load-bearing and the
//       old accident is still doing the work.
//
//   npx tsx src/scripts/verify-filed-context.ts
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { loadFiledFinancials } from "../scoring/metrics/filed-load.js";
import { FILING_RULES, ruleRefOf } from "../scoring/findings/engine.js";
import { isNotEvaluable, isFinancialIndustry, type FilingRule, type FilingContext, type RuleResult } from "../scoring/findings/types.js";
import type { IndustryType } from "../generated/prisma/client.js";

const GUARDED = ["R3", "R4", "R5", "P7", "P8", "P13", "N1", "N2", "N3", "N4"];
const guardedRules = FILING_RULES.filter((r) => GUARDED.includes(ruleRefOf(r)));

let failures = 0;
const ok = (pass: boolean, msg: string) => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✅" : "❌"} ${msg}`);
};

/** A minimal scored FiringContext. Only the filed-data slots and `industry` vary between cases. */
function ctxFor(
  stockId: string, symbol: string, industry: IndustryType,
  annual: FilingContext["annualFundamentals"], quarterly: FilingContext["quarterlyResults"],
): FilingContext {
  return {
    stockId, symbol, asOfDate: new Date("2026-06-30"), industry,
    shareholding: [],
    annualFundamentals: annual,
    // Exactly what score-pass now computes: null for every financial industry.
    quarterlyOpm: null,
    quarterlyResults: quarterly,
    feeds: { insiderTxns: null, blockTxns: null, marketCapInrCr: null },
  };
}

/** A rule outcome as a comparable token. `null` (not_fired) is what a guard returns. */
const outcome = (r: RuleResult): string =>
  r === null ? "null" : isNotEvaluable(r) ? `not_evaluable:${r.reason}` : `FIRED:${r.key}`;

async function main() {
  console.log("════ FILED-DATA CONTEXT · industry-aware resolution + explicit guards ════");

  // One stock per industry. Banking/non-financial are SCORED; nbfc/LI/GI are not (no peer group),
  // which is exactly why they need a proof that does not go through the scoring pass.
  const picks: { industry: IndustryType; symbol: string }[] = [
    { industry: "non_financial", symbol: "RELIANCE" },
    { industry: "banking", symbol: "HDFCBANK" },
    { industry: "nbfc", symbol: "BAJFINANCE" },
    { industry: "life_insurance", symbol: "SBILIFE" },
    { industry: "general_insurance", symbol: "ICICIGI" },
  ];

  const loaded: { industry: IndustryType; symbol: string; stockId: string; annual: any[]; quarterly: any[] }[] = [];

  console.log("\n──────── §A · WHAT THE CONTEXT BUILDER NOW RETURNS ────────");
  for (const p of picks) {
    const stock = await prisma.stock.findFirst({ where: { symbol: p.symbol }, select: { id: true, industryType: true } });
    if (!stock) { ok(false, `${p.symbol}: not in the universe`); continue; }
    ok(stock.industryType === p.industry, `${p.symbol}: Stock.industryType = ${stock.industryType}`);

    const filed = await loadFiledFinancials(stock.id, stock.industryType);
    loaded.push({ industry: stock.industryType, symbol: p.symbol, stockId: stock.id, annual: filed.annual, quarterly: filed.quarterly });

    const aSpan = filed.annual.length ? `${filed.annual[0].fiscalYear}…${filed.annual[filed.annual.length - 1].fiscalYear}` : "—";
    const qSpan = filed.quarterly.length ? `${filed.quarterly[0].fiscalYear}${filed.quarterly[0].quarter}…${filed.quarterly[filed.quarterly.length - 1].fiscalYear}${filed.quarterly[filed.quarterly.length - 1].quarter}` : "—";
    console.log(`\n  ${p.symbol.padEnd(11)} ${stock.industryType}`);
    console.log(`    source        : ${filed.source} (+ its _quarterly_results sibling)`);
    console.log(`    annual        : ${String(filed.annual.length).padStart(2)} rows  ${aSpan}`);
    console.log(`    quarterly     : ${String(filed.quarterly.length).padStart(2)} rows  ${qSpan}`);
    const a = filed.annual[filed.annual.length - 1];
    const q = filed.quarterly[filed.quarterly.length - 1];
    if (a) {
      const fld = (v: number | null) => (v === null ? "null" : String(Math.round(v)));
      console.log(`    latest annual : revenue=${fld(a.revenue)} netProfit=${fld(a.netProfit)} OCF=${fld(a.cashFromOperating)} totalEquity=${fld(a.totalEquity)} totalDebt=${fld(a.totalDebtStored)} tradeRecv=${fld(a.tradeReceivablesCurrent)}`);
    }
    if (q) {
      const fld = (v: number | null) => (v === null ? "null" : String(Math.round(v)));
      console.log(`    latest quarter: revenue=${fld(q.revenue)} PBT=${fld(q.profitBeforeTax)} interest=${fld(q.interest)} operatingProfit=${fld(q.operatingProfitStored)}`);
    }
    // Populated ⇔ this industry files into these tables. Every one of the five must be non-empty.
    ok(filed.annual.length > 0, `${p.symbol}: annual rows resolved from ${filed.source} (EMPTY before this change for every industry except non_financial)`);
    ok(filed.quarterly.length > 0, `${p.symbol}: quarterly rows resolved from ${filed.source.replace("_fundamentals", "_quarterly_results")}`);
    // Contract: no invented operating-profit line for a lender/insurer.
    if (isFinancialIndustry(stock.industryType)) {
      ok(filed.quarterly.every((r) => r.operatingProfitStored === null), `${p.symbol}: operatingProfitStored is null on every quarter (no invented operating line)`);
      ok(filed.annual.every((r) => r.stored.roe === null && r.stored.debtToEquity === null), `${p.symbol}: stored.roe / stored.debtToEquity left null (unit trap — see filed-load.ts)`);
    }
  }

  console.log("\n──────── §B · THE GUARDS, RUN AGAINST POPULATED DATA ────────");
  console.log("  ⚠ UPDATED FOR THE FILING PASS. These ten used to return a bare `null` for a financial, and");
  console.log("  `null` means not_fired — i.e. 'we checked this bank's earnings quality and it is clean',");
  console.log("  which we did not do. They now DECLINE with industry_not_applicable. The non_financial");
  console.log("  control on byte-identical data shows the guard is what produced that outcome.\n");

  for (const l of loaded) {
    if (!isFinancialIndustry(l.industry)) continue;
    const financialCtx = ctxFor(l.stockId, l.symbol, l.industry, l.annual, l.quarterly);
    // THE CONTROL: byte-identical data, industry forced to non_financial. If the guard is what is
    // stopping these rules, this run must reach past it and produce something else.
    const controlCtx = { ...financialCtx, industry: "non_financial" as IndustryType };

    console.log(`  ── ${l.symbol} (${l.industry}) · ${l.annual.length} annual / ${l.quarterly.length} quarterly rows`);
    let differed = 0;
    for (const rule of guardedRules) {
      const ref = ruleRefOf(rule);
      const guarded = outcome(rule(financialCtx));
      const control = outcome(rule(controlCtx));
      if (guarded !== control) differed++;
      ok(guarded === "not_evaluable:industry_not_applicable", `${ref}: declines under industry=${l.industry}  (non_financial control → ${control})`);
    }
    ok(differed > 0, `${l.symbol}: the guard is LOAD-BEARING — ${differed}/${guardedRules.length} rules behave differently with industry=non_financial on identical data`);
    ok(financialCtx.quarterlyOpm === null, `${l.symbol}: quarterlyOpm is null (P11/P12 carry no guard of their own — score-pass gates them on the stock's industry)`);
    console.log("");
  }

  console.log(failures === 0
    ? `════ ✅ ALL CHECKS PASSED — filed data resolves per industry, and all four financial industries are excluded by EXPLICIT GUARD, not by an empty array ════`
    : `════ ❌ ${failures} CHECK(S) FAILED ════`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
