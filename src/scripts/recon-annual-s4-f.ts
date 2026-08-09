// Stage 4 recon F — follow-ups: tolerances, definitions, degenerate counts.
import { prisma } from "../db/prisma.js";
const q = <T = any>(sql: string, ...a: any[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a);
const pc = (a: number, b: number) => `${a}/${b} (${b ? ((a / b) * 100).toFixed(1) : "0"}%)`;

async function chk(table: string, where: string, rows: [string, string][]) {
  for (const [lbl, expr] of rows) {
    const r = await q(`select count(*)::int n, sum(case when ${expr} then 1 else 0 end)::int ok from ${table} where ${where}`);
    console.log(`   ${lbl}: ${pc(r[0].ok, r[0].n)}`);
  }
}

async function main() {
  const NFW = "result_type='consolidated' and fiscal_year in ('FY25','FY26')";
  console.log("-- non_financial, 1% tolerance --");
  await chk("fundamentals", NFW, [
    ["net_profit = PBT - tax (1%)", "abs(net_profit - (profit_before_tax - tax)) <= greatest(1, abs(net_profit)*0.01)"],
    ["net_worth = total_equity (1%)", "abs(net_worth - total_equity) <= greatest(1, abs(net_worth)*0.01)"],
    ["net_worth = equity_attributable_to_owners (1%)", "abs(net_worth - equity_attributable_to_owners) <= greatest(1, abs(net_worth)*0.01)"],
    ["net_worth = eq_share_cap + other_equity (1%)", "abs(net_worth - (equity_share_capital + other_equity)) <= greatest(1, abs(net_worth)*0.01)"],
    ["net_cash_flow = CFO+CFI+CFF (5%)", "abs(net_cash_flow - (coalesce(cash_from_operating,0)+coalesce(cash_from_investing,0)+coalesce(cash_from_financing,0))) <= greatest(1, abs(net_cash_flow)*0.05)"],
    ["net_cash_flow = 0", "abs(net_cash_flow) < 0.005"],
    ["ebitda = PBT + dep + fin - other_income (1%)", "abs(ebitda - (profit_before_tax + depreciation + finance_costs - other_income)) <= greatest(1, abs(ebitda)*0.01)"],
    ["ebitda = revenue - expenses + dep + fin + other_inc (1%)", "abs(ebitda - (revenue - expenses + depreciation + finance_costs + other_income)) <= greatest(1, abs(ebitda)*0.01)"],
    ["ebitda = revenue - (expenses - dep - fin) (1%)", "abs(ebitda - (revenue - (expenses - depreciation - finance_costs))) <= greatest(1, abs(ebitda)*0.01)"],
    ["PBT = rev + other_inc - expenses (1%)", "abs(profit_before_tax - (revenue + other_income - expenses)) <= greatest(1, abs(profit_before_tax)*0.01)"],
    ["operating_margin = ebitda/revenue*100 (0.1pp)", "abs(operating_margin - (ebitda/nullif(revenue,0)*100)) <= 0.1"],
    ["net_margin = net_profit/revenue*100 (0.1pp)", "abs(net_margin - (net_profit/nullif(revenue,0)*100)) <= 0.1"],
    ["roe = net_profit/net_worth*100 (0.5pp)", "abs(roe - (net_profit/nullif(net_worth,0)*100)) <= 0.5"],
    ["debt_to_equity = total_debt/net_worth*100 (0.1)", "abs(debt_to_equity - (total_debt/nullif(net_worth,0)*100)) <= 0.1"],
    ["bvps = net_worth/(paidup/facevalue)*? -- bvps=net_worth exactly", "abs(book_value_per_share - net_worth) < 0.005"],
    ["face_value_share > 100", "face_value_share > 100"],
    ["total_assets <= 0", "total_assets <= 0"],
    ["revenue <= 0", "revenue <= 0"],
    ["interest_coverage > 1000", "interest_coverage > 1000"],
    ["inventory_turnover > 1000", "inventory_turnover > 1000"],
    ["receivables_days > 365", "receivables_days > 365"],
    ["capex < 0", "capex < 0"],
    ["dividends_paid < 0", "dividends_paid < 0"],
    ["dividends_paid = 0", "dividends_paid = 0"],
  ]);

  console.log("\n-- nbfc, 1% tolerance --");
  await chk("nbfc_fundamentals", "result_type='consolidated' and fiscal_year in ('FY25','FY26')", [
    ["PBT = total_income - total_expenses (1%)", "abs(profit_before_tax - (total_income - total_expenses)) <= greatest(1, abs(profit_before_tax)*0.01)"],
    ["net_profit = PBT - tax (1%)", "abs(net_profit - (profit_before_tax - tax)) <= greatest(1, abs(net_profit)*0.01)"],
    ["roe = net_profit/net_worth (0.5pp on fraction*100)", "abs(roe*100 - (net_profit/nullif(net_worth,0)*100)) <= 0.5"],
    ["loans = 0", "loans = 0"],
    ["deposits_liabilities = 0", "deposits_liabilities = 0"],
    ["bvps = net_worth exactly", "abs(book_value_per_share - net_worth) < 0.005"],
    ["face_value_share > 100", "face_value_share > 100"],
  ]);

  console.log("\n-- banking --");
  await chk("banking_fundamentals", "result_type='standalone' and fiscal_year in ('FY25','FY26')", [
    ["bvps = net_worth exactly", "abs(book_value_per_share - net_worth) < 0.005"],
    ["face_value_share > 100", "face_value_share > 100"],
    ["face_value_share = paid_up_equity_capital", "abs(face_value_share - paid_up_equity_capital) < 0.005"],
    ["cet1_ratio < 0.05", "cet1_ratio < 0.05"],
    ["credit_cost_pct < 0", "credit_cost_pct < 0"],
    ["net_interest_margin > 0.10", "net_interest_margin > 0.10"],
    ["roa_disclosed = 0", "roa_disclosed = 0"],
    ["reserve_excl_revaluation is null", "reserve_excl_revaluation is null"],
    ["revenue_on_investments is null", "revenue_on_investments is null"],
  ]);

  console.log("\n-- life: what IS net_worth / PBT residual --");
  let r = await q(`select s.symbol, f.fiscal_year, f.net_worth::float nw, f.share_capital::float sc, f.reserves_and_surplus::float rs,
      f.fair_value_change_account::float fvc, f.debit_balance_profit_and_loss::float dbpl,
      f.profit_before_tax::float pbt, f.tax::float tax, f.net_profit::float np,
      f.transfer_from_policyholders::float tfp, f.income_from_investments_shareholders::float shinv,
      f.other_income_shareholders::float shoth, f.shareholders_expenses::float shexp
    from life_insurance_fundamentals f join stocks s on s.id=f.stock_id where f.result_type='standalone' order by s.symbol, f.fiscal_year`);
  for (const x of r) {
    console.log(`   ${x.symbol} ${x.fiscal_year} nw=${x.nw} sc+rs=${(x.sc + x.rs).toFixed(2)} +fvc=${(x.sc + x.rs + x.fvc).toFixed(2)} -dbpl=${(x.sc + x.rs - x.dbpl).toFixed(2)}`);
    console.log(`      pbt=${x.pbt} tax=${x.tax} np=${x.np} | pbt-tax=${(x.pbt - x.tax).toFixed(2)} | tfp+shinv+shoth-shexp=${(x.tfp + x.shinv + (x.shoth ?? 0) - x.shexp).toFixed(2)}`);
  }

  console.log("\n-- general insurance: net_worth definition --");
  r = await q(`select s.symbol, f.fiscal_year, f.net_worth::float nw, f.share_capital::float sc, f.reserves_and_surplus::float rs, f.fair_value_change_account::float fvc, f.borrowings::float bor, f.total_sources_of_funds::float src
    from general_insurance_fundamentals f join stocks s on s.id=f.stock_id where f.result_type='standalone' order by s.symbol, f.fiscal_year`);
  for (const x of r) console.log(`   ${x.symbol} ${x.fiscal_year} nw=${x.nw} sc=${x.sc} rs=${x.rs} fvc=${x.fvc} bor=${x.bor} src=${x.src} sc+rs=${(x.sc + x.rs).toFixed(2)}`);
}
main().then(() => prisma.$disconnect());
