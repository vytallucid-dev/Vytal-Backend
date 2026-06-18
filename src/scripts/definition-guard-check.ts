// DEFINITION-MATCH GUARD — verification harness (PURE, no DB, commits nothing).
//
//   npx tsx src/scripts/definition-guard-check.ts
//
// Pins each of the 5 audited metrics (+ F3/F10) to its CANONICAL definition by
// feeding KNOWN synthetic inputs to the ENGINE compute function and to an
// INDEPENDENT recompute (definition-guard.ts), asserting they agree — AND that the
// WRONG definition does NOT. A regression to a non-canonical formula (EBIT-OPM,
// EBITDA-coverage, direct-capex F8, fixed-asset turnover) fails here loudly.
//
// The DELIBERATE asymmetry is asserted explicitly: OPM is PRE-depreciation (EBITDA);
// ROCE / Interest Coverage are POST-depreciation (EBIT).

import { f1Roce, f5InterestCoverage, f7AssetTurnover, f8FcfPatAvg, f3CashConversion, f10Revenue3yCagr } from "../scoring/metrics/foundation.js";
import { m1TtmOpm, m5TtmInterestCoverage, consecutiveTail } from "../scoring/metrics/momentum.js";
import { dispatchLiveValues } from "../scoring/metric-scoring/live-dispatch.js";
import type { FoundationAnnual, MomentumQuarter } from "../scoring/metrics/types.js";
import {
  METRIC_DEFINITIONS,
  canonicalOpmTtmEbitda, legacyOpmTtmEbit, canonicalRoce, canonicalInterestCoverage,
  canonicalAssetTurnover, canonicalFcfPat, canonicalCashConversion, canonicalRev3yCagr,
} from "../scoring/metric-scoring/definition-guard.js";

const TOL = 1e-9;
interface Row { name: string; expected: string; actual: string; pass: boolean }
const rows: Row[] = [];
const num = (name: string, expected: number, actual: number) => rows.push({ name, expected: expected.toFixed(6), actual: actual.toFixed(6), pass: Math.abs(expected - actual) <= 1e-6 });
const ne = (name: string, a: number, b: number) => rows.push({ name, expected: `≠ ${b.toFixed(4)}`, actual: a.toFixed(4), pass: Math.abs(a - b) > 1e-4 });
const ok = (name: string, pass: boolean, detail = "") => rows.push({ name, expected: "true", actual: String(pass) + (detail ? ` (${detail})` : ""), pass });

// ── synthetic builders (all-null defaults; fill only what a metric needs) ─────────
const FA = (p: Partial<FoundationAnnual> & { fyOrdinal: number }): FoundationAnnual => ({
  fiscalYear: "FY" + p.fyOrdinal, // fyOrdinal comes from ...p (avoid duplicate-key overwrite)
  revenue: null, otherIncome: null, financeCosts: null, depreciation: null, profitBeforeTax: null, netProfit: null,
  equityShareCapital: null, otherEquity: null, totalEquity: null, borrowingsCurrent: null, borrowingsNoncurrent: null, totalDebtStored: null,
  totalAssets: null, currentLiabilities: null, tradeReceivablesCurrent: null, tradeReceivablesNoncurrent: null,
  propertyPlantAndEquipment: null, capitalWorkInProgress: null,
  cashFromOperating: null, capex: null, cashFromFinancing: null, faceValueShare: null,
  stored: { roce: null, roe: null, debtToEquity: null, interestCoverage: null, receivablesDays: null, assetTurnover: null, netWorth: null, operatingMargin: null, ebitda: null },
  ...p,
});
const MQ = (fyOrd: number, qi: number, p: Partial<MomentumQuarter>): MomentumQuarter => ({
  fiscalYear: "FY" + fyOrd, quarter: "Q" + (qi + 1), qOrdinal: fyOrd * 4 + qi,
  revenue: null, otherIncome: null, interest: null, depreciation: null, profitBeforeTax: null, netProfit: null, operatingProfitStored: null,
  ...p,
});

console.log("DEFINITION-MATCH GUARD — engine compute fn ≡ canonical bar-derivation definition (pure)\n");
for (const d of Object.values(METRIC_DEFINITIONS)) console.log(`  [${d.key}] ${d.signature}`);
console.log("");

// ════ 1. OPM (M1 / M1_OPM_TTM) — EBITDA, PRE-depreciation, shared ════
{
  // 4 quarters; depreciation > 0 so EBITDA ≠ EBIT; otherIncome > 0 too.
  const qs = [0, 1, 2, 3].map((i) => MQ(26, i, { profitBeforeTax: 1000 + i * 10, interest: 200, depreciation: 300, otherIncome: 50, revenue: 5000, operatingProfitStored: (1000 + i * 10) + 200 - 50 }));
  const run = consecutiveTail(qs);
  const live = m1TtmOpm(run).value!;
  const canon = canonicalOpmTtmEbitda(qs.map((q) => ({ pbt: q.profitBeforeTax, interest: q.interest, dep: q.depreciation, rev: q.revenue })))!;
  const legacy = legacyOpmTtmEbit(qs.map((q) => ({ pbt: q.profitBeforeTax, interest: q.interest, otherIncome: q.otherIncome, rev: q.revenue })))!;
  num("OPM (M1) live == canonical EBITDA OPM", canon, live);
  ne("OPM (M1) live ≠ legacy EBIT OPM (depreciation add-back is real)", live, legacy);
  // dispatch: M1 and M1_OPM_TTM are the SAME shared fn (emit-renamed)
  const dM1 = dispatchLiveValues({ industryType: "non_financial", foundationKeys: [], momentumKeys: ["M1"], foundationRows: [], momentumQuarters: qs });
  const dOPM = dispatchLiveValues({ industryType: "non_financial", foundationKeys: [], momentumKeys: ["M1_OPM_TTM"], foundationRows: [], momentumQuarters: qs });
  const v1 = dM1.status === "computed" ? dM1.momentum[0].value! : NaN;
  const vO = dOPM.status === "computed" ? dOPM.momentum[0].value! : NaN;
  num("dispatch M1 == dispatch M1_OPM_TTM (one shared EBITDA fn)", v1, vO);
  ok("dispatch M1_OPM_TTM emits key 'M1_OPM_TTM'", dOPM.status === "computed" && dOPM.momentum[0].key === "M1_OPM_TTM", dOPM.status === "computed" ? dOPM.momentum[0].key : dOPM.status);
}

// ════ 2. ROCE (F1) — EBIT, POST-depreciation, point-in-time ════
{
  const r = FA({ fyOrdinal: 26, profitBeforeTax: 2000, financeCosts: 500, totalEquity: 10000, borrowingsCurrent: 1000, borrowingsNoncurrent: 4000, depreciation: 800 });
  const live = f1Roce(r).value!;
  const canon = canonicalRoce(2000, 500, 10000, 5000);
  num("ROCE (F1) live == canonical (PBT+int)/(NW+debt)×100", canon, live);
  // negative: adding depreciation back (EBITDA) would be WRONG for ROCE
  const wrongEbitda = ((2000 + 500 + 800) / 15000) * 100;
  ne("ROCE (F1) live ≠ EBITDA variant (ROCE is EBIT, post-dep)", live, wrongEbitda);
}

// ════ 3. Interest Coverage (F5, M5) — EBIT, POST-depreciation ════
{
  const r = FA({ fyOrdinal: 26, profitBeforeTax: 2000, financeCosts: 500, depreciation: 800 });
  const live = f5InterestCoverage(r).value!;
  num("IC (F5) live == canonical (PBT+int)/int", canonicalInterestCoverage(2000, 500), live);
  ne("IC (F5) live ≠ EBITDA/int (coverage is EBIT, post-dep)", live, (2000 + 500 + 800) / 500);
  // M5 TTM = Σ(pbt+int)/Σint
  const qs = [0, 1, 2, 3].map((i) => MQ(26, i, { profitBeforeTax: 500, interest: 100, depreciation: 200, revenue: 3000 }));
  const m5 = m5TtmInterestCoverage(consecutiveTail(qs)).value!;
  num("IC (M5) live == Σ(pbt+int)/Σint", canonicalInterestCoverage(2000, 400), m5);
}

// ════ 4. Asset Turnover (F7) — Sales / Total Assets ════
{
  const r = FA({ fyOrdinal: 26, revenue: 5000, totalAssets: 20000, propertyPlantAndEquipment: 8000, capitalWorkInProgress: 2000 });
  const live = f7AssetTurnover(r).value!;
  num("Asset Turnover (F7) live == revenue/totalAssets", canonicalAssetTurnover(5000, 20000), live);
  ne("Asset Turnover (F7) live ≠ revenue/(netBlock+CWIP) (NOT fixed-asset turnover)", live, 5000 / (8000 + 2000));
}

// ════ 5. FCF/PAT (F8) — capex-proxy ΔNetBlock+Dep+ΔCWIP, mean-of-ratios ════
{
  // FY24/FY25/FY26 present; snapshot FY26. Window [26,25,24,23]. FY23 absent →
  // FY24 has no prior → skipped. Usable: FY26 (prior FY25), FY25 (prior FY24).
  const rows4 = [
    FA({ fyOrdinal: 24, cashFromOperating: 900, propertyPlantAndEquipment: 5000, capitalWorkInProgress: 500, depreciation: 300, netProfit: 600 }),
    FA({ fyOrdinal: 25, cashFromOperating: 1100, propertyPlantAndEquipment: 5400, capitalWorkInProgress: 700, depreciation: 320, netProfit: 700 }),
    FA({ fyOrdinal: 26, cashFromOperating: 1300, propertyPlantAndEquipment: 5900, capitalWorkInProgress: 600, depreciation: 350, netProfit: 800 }),
  ];
  const live = f8FcfPatAvg(rows4, 26).value!;
  const canon = canonicalFcfPat([
    { ocf: 1100, ppe: 5400, ppePrior: 5000, dep: 320, cwip: 700, cwipPrior: 500, np: 700 }, // FY25
    { ocf: 1300, ppe: 5900, ppePrior: 5400, dep: 350, cwip: 600, cwipPrior: 700, np: 800 }, // FY26
  ]);
  num("FCF/PAT (F8) live == canonical capex-proxy mean-of-ratios", canon, live);
  // negative: the pre-fix direct-CF-capex definition on the same data
  const directMean = ((1100 - 0) / 700 + (1300 - 0) / 800) / 2; // capex field is null here → would differ
  ok("FCF/PAT (F8) usable years = 2 (FY25,FY26); FY24 skipped (no FY23 prior)", String(f8FcfPatAvg(rows4, 26).inputs.nUsed) === "2", `nUsed=${f8FcfPatAvg(rows4, 26).inputs.nUsed}`);
  ok("FCF/PAT (F8) inputs.capexBasis = proxy:dNetBlock+Dep+dCWIP", f8FcfPatAvg(rows4, 26).inputs.capexBasis === "proxy:dNetBlock+Dep+dCWIP", String(f8FcfPatAvg(rows4, 26).inputs.capexBasis));
}

// ════ 6. F3 Cash Conversion — (OCF+buyback)/PAT, buyback=0 (ESC stable) ════
{
  const curr = FA({ fyOrdinal: 26, cashFromOperating: 1200, netProfit: 1000, equityShareCapital: 500, faceValueShare: 1 });
  const prior = FA({ fyOrdinal: 25, equityShareCapital: 500 }); // ESC stable → buyback 0
  const live = f3CashConversion(curr, prior, null).value!;
  num("F3 Cash Conversion live == (OCF+0)/PAT", canonicalCashConversion(1200, 0, 1000), live);
}

// ════ 7. F10 Revenue 3y CAGR — cube-root ════
{
  const rows4 = [FA({ fyOrdinal: 23, revenue: 1000 }), FA({ fyOrdinal: 26, revenue: 1728 })];
  const live = f10Revenue3yCagr(rows4, 26).value!;
  num("F10 Rev 3y CAGR live == (rev_t/rev_{t-3})^(1/3)−1×100", canonicalRev3yCagr(1728, 1000), live);
  num("F10 sanity: 1000→1728 over 3y == 20.00%", 20, live);
}

// ── result ──
console.log("─".repeat(96));
const w = Math.max(...rows.map((r) => r.name.length));
let pass = 0, fail = 0;
for (const r of rows) { r.pass ? pass++ : fail++; console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(w)}  expected=${r.expected}  actual=${r.actual}`); }
console.log(`\n  TOTAL: ${rows.length}   PASS: ${pass}   FAIL: ${fail}`);
console.log(fail === 0 ? "  ✓ DEFINITION-MATCH GUARD GREEN — every compute fn matches its canonical bar-derivation definition.\n" : "  ✗ A DEFINITION MISMATCH — a compute fn diverged from canonical.\n");
if (fail > 0) process.exitCode = 1;
