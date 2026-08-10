// Stage 4 recon E — identities, scales, degenerates.
import { prisma } from "../db/prisma.js";
const q = <T = any>(sql: string, ...a: any[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a);
const pc = (a: number, b: number) => `${a}/${b} (${b ? ((a / b) * 100).toFixed(1) : "0"}%)`;

async function main() {
  console.log("-- A. non_financial debt_to_equity: stored vs total_debt/net_worth --");
  let r = await q(`select s.symbol, f.fiscal_year, f.debt_to_equity::float d2e, f.total_debt::float td, f.net_worth::float nw,
     (f.total_debt/nullif(f.net_worth,0))::float ratio from fundamentals f join stocks s on s.id=f.stock_id
     where f.result_type='consolidated' and f.fiscal_year='FY26' and f.net_worth>0 order by random() limit 8`);
  for (const x of r) console.log(`   ${x.symbol} d2e=${x.d2e} td/nw=${x.ratio?.toFixed(4)} ratio*100=${(x.ratio * 100).toFixed(2)}`);

  console.log("\n-- B. non_financial identities --");
  const NF: [string, string][] = [
    ["fcf = CFO - capex", "abs(fcf - (cash_from_operating - capex)) < 0.51"],
    ["total_debt = borrowings_current + borrowings_noncurrent", "abs(total_debt - (coalesce(borrowings_current,0)+coalesce(borrowings_noncurrent,0))) < 0.51"],
    ["net_worth = total_equity", "abs(net_worth - total_equity) < 0.51"],
    ["total_assets = current + noncurrent (1%)", "abs(total_assets - (coalesce(current_assets,0)+coalesce(noncurrent_assets,0))) <= greatest(1, abs(total_assets)*0.01)"],
    ["assets = equity + curr.liab + noncurr.liab (1%)", "abs(total_assets - (coalesce(total_equity,0)+coalesce(current_liabilities,0)+coalesce(noncurrent_liabilities,0))) <= greatest(1, abs(total_assets)*0.01)"],
    ["net_cash_flow = CFO+CFI+CFF (1%)", "abs(net_cash_flow - (coalesce(cash_from_operating,0)+coalesce(cash_from_investing,0)+coalesce(cash_from_financing,0))) <= greatest(1, abs(net_cash_flow)*0.01)"],
    ["ebitda = revenue - expenses + dep + fin (1%)", "abs(ebitda - (revenue - expenses + depreciation + finance_costs)) <= greatest(1, abs(ebitda)*0.01)"],
    ["net_profit = PBT - tax", "abs(net_profit - (profit_before_tax - tax)) < 0.51"],
    ["equity_attributable <= total_equity", "equity_attributable_to_owners <= total_equity + 0.51"],
    ["cash >= 0", "cash_and_cash_equivalents >= 0"],
  ];
  for (const [lbl, expr] of NF) {
    r = await q(`select count(*)::int n, sum(case when ${expr} then 1 else 0 end)::int ok from fundamentals where result_type='consolidated' and fiscal_year in ('FY25','FY26')`);
    console.log(`   ${lbl}: ${pc(r[0].ok, r[0].n)}`);
  }

  console.log("\n-- C. banking book_value_per_share outliers --");
  r = await q(`select s.symbol, f.fiscal_year, f.book_value_per_share::float bvps, f.net_worth::float nw, f.paid_up_equity_capital::float pu, f.face_value_share::float fv, f.basic_eps::float eps
    from banking_fundamentals f join stocks s on s.id=f.stock_id where f.result_type='standalone' and f.fiscal_year in ('FY25','FY26') order by f.book_value_per_share desc limit 6`);
  for (const x of r) console.log(`   ${x.symbol} ${x.fiscal_year} bvps=${x.bvps} nw=${x.nw} paidup=${x.pu} fv=${x.fv} eps=${x.eps}`);

  console.log("\n-- D. general_insurance total_assets vs sources/application --");
  r = await q(`select s.symbol, f.fiscal_year, f.total_assets::float ta, f.total_sources_of_funds::float src, f.total_application_of_funds::float app, f.net_worth::float nw, f.investments::float inv
    from general_insurance_fundamentals f join stocks s on s.id=f.stock_id where f.result_type='standalone' order by s.symbol, f.fiscal_year`);
  for (const x of r) console.log(`   ${x.symbol} ${x.fiscal_year} total_assets=${x.ta} sources=${x.src} application=${x.app} nw=${x.nw} investments=${x.inv}`);

  console.log("\n-- E. life_insurance total_assets vs sources --");
  r = await q(`select s.symbol, f.fiscal_year, f.total_assets::float ta, f.total_sources_of_funds::float src, f.total_application_of_funds::float app, f.net_worth::float nw, f.policyholders_funds::float pf
    from life_insurance_fundamentals f join stocks s on s.id=f.stock_id where f.result_type='standalone' order by s.symbol, f.fiscal_year`);
  for (const x of r) console.log(`   ${x.symbol} ${x.fiscal_year} total_assets=${x.ta} sources=${x.src} application=${x.app} nw=${x.nw} phFunds=${x.pf}`);

  console.log("\n-- F. nf outliers --");
  for (const c of ["interest_coverage", "inventory_turnover", "receivables_days", "debt_to_equity", "roe", "roce", "book_value_per_share", "face_value_share"]) {
    r = await q(`select s.symbol, f.fiscal_year, f."${c}"::float v from fundamentals f join stocks s on s.id=f.stock_id
      where f.result_type='consolidated' and f.fiscal_year in ('FY25','FY26') order by abs(f."${c}") desc nulls last limit 4`);
    console.log(`   ${c}: ` + r.map((x) => `${x.symbol} ${x.fiscal_year}=${x.v}`).join(" | "));
  }

  console.log("\n-- G. banking annual identities --");
  const BK: [string, string][] = [
    ["nii = interest_earned - interest_expended", "abs(nii - (interest_earned - interest_expended)) < 0.51"],
    ["total_income = interest_earned + other_income", "abs(total_income - (interest_earned + other_income)) < 0.51"],
    ["ppop = total_income - expenditure_excl_provisions", "abs(ppop - (total_income - expenditure_excl_provisions)) < 0.51"],
    ["PBT = ppop - provisions", "abs(profit_before_tax - (ppop - provisions)) < 0.51"],
    ["net_profit = PBT - tax", "abs(net_profit - (profit_before_tax - tax)) < 0.51"],
    ["capital_and_liabilities = total_assets", "abs(capital_and_liabilities - total_assets) < 0.51"],
    ["net_worth = capital + reserves", "abs(net_worth - (capital + reserves_and_surplus)) < 0.51"],
    ["deposits >= advances", "deposits >= advances"],
    ["operating_expenses = expenditure_excl_prov - interest_expended", "abs(operating_expenses - (expenditure_excl_provisions - interest_expended)) < 0.51"],
    ["gnpa_absolute >= nnpa_absolute", "gnpa_absolute >= nnpa_absolute"],
    ["gnpa_pct >= nnpa_pct", "gnpa_pct >= nnpa_pct"],
    ["profit_after_tax = net_profit", "abs(profit_after_tax - net_profit) < 0.51"],
    ["total_assets = sum of asset lines (1%)", "abs(total_assets - (coalesce(cash_and_balances_with_rbi,0)+coalesce(balances_with_banks,0)+coalesce(investments,0)+coalesce(advances,0)+coalesce(fixed_assets,0)+coalesce(other_assets,0))) <= greatest(1, abs(total_assets)*0.01)"],
  ];
  for (const [lbl, expr] of BK) {
    r = await q(`select count(*)::int n, sum(case when ${expr} then 1 else 0 end)::int ok from banking_fundamentals where result_type='standalone' and fiscal_year in ('FY25','FY26')`);
    console.log(`   ${lbl}: ${pc(r[0].ok, r[0].n)}`);
  }

  console.log("\n-- H. nbfc annual identities --");
  const NB: [string, string][] = [
    ["total_income = revenue + other_income", "abs(total_income - (revenue + other_income)) < 0.51"],
    ["PBT = total_income - total_expenses", "abs(profit_before_tax - (total_income - total_expenses)) < 0.51"],
    ["net_profit = PBT - tax", "abs(net_profit - (profit_before_tax - tax)) < 0.51"],
    ["total_assets = financial + non_financial assets", "abs(total_assets - (financial_assets + non_financial_assets)) < 0.51"],
    ["total_assets = total_liabilities + total_equity", "abs(total_assets - (total_liabilities + total_equity)) < 0.51"],
    ["net_worth = total_equity", "abs(net_worth - total_equity) < 0.51"],
    ["total_liab = financial + non_financial liab", "abs(total_liabilities - (financial_liabilities + non_financial_liabilities)) < 0.51"],
    ["debt = debt_securities + borrowings + subordinated", "abs(coalesce(debt_securities,0)+coalesce(borrowings,0)+coalesce(subordinated_liabilities,0) - (coalesce(debt_securities,0)+coalesce(borrowings,0)+coalesce(subordinated_liabilities,0))) < 0.51"],
  ];
  for (const [lbl, expr] of NB) {
    r = await q(`select count(*)::int n, sum(case when ${expr} then 1 else 0 end)::int ok from nbfc_fundamentals where result_type='consolidated' and fiscal_year in ('FY25','FY26')`);
    console.log(`   ${lbl}: ${pc(r[0].ok, r[0].n)}`);
  }

  console.log("\n-- I. life annual identities --");
  const LI: [string, string][] = [
    ["gross = fy + renewal + single", "abs(gross_premium_income - (income_first_year_premium+income_renewal_premium+income_single_premium)) < 0.51"],
    ["net = gross - reinsurance", "abs(net_premium_income - (gross_premium_income - reinsurance_ceded)) < 0.51"],
    ["net_profit = PBT - tax", "abs(net_profit - (profit_before_tax - tax)) < 0.51"],
    ["PBT = transfer + shInv + shOther - shExp (1%)", "abs(profit_before_tax - (transfer_from_policyholders + income_from_investments_shareholders + coalesce(other_income_shareholders,0) - shareholders_expenses)) <= greatest(1, abs(profit_before_tax)*0.01)"],
    ["gross >= net premium", "gross_premium_income >= net_premium_income"],
    ["total_sources = total_application", "abs(total_sources_of_funds - total_application_of_funds) < 0.51"],
    ["total_commission = fy + renewal + single comm", "abs(total_commission - (commission_first_year_premium+commission_renewal_premium+commission_single_premium)) < 0.51"],
    ["surplus >= transfer_from_policyholders", "surplus_from_revenue_account >= transfer_from_policyholders"],
    ["net_worth = share_capital + reserves", "abs(net_worth - (share_capital + reserves_and_surplus)) < 0.51"],
  ];
  for (const [lbl, expr] of LI) {
    r = await q(`select count(*)::int n, sum(case when ${expr} then 1 else 0 end)::int ok from life_insurance_fundamentals where result_type='standalone'`);
    console.log(`   ${lbl}: ${pc(r[0].ok, r[0].n)}`);
  }

  console.log("\n-- J. general insurance annual identities --");
  const GI: [string, string][] = [
    ["uw = earned - incurred - commission - opex (1% of earned)", "abs(underwriting_profit_or_loss - (premium_earned - incurred_claims - net_commission - total_operating_expenses_related_to_insurance)) <= greatest(1, abs(premium_earned)*0.01)"],
    ["total_revenue = earned + inv + other", "abs(total_revenue - (premium_earned + income_from_investments + other_income)) < 0.51"],
    ["net_profit = PBT - tax", "abs(net_profit - (profit_before_tax - tax)) < 0.51"],
    ["gpw >= npw", "gross_premiums_written >= net_premium_written"],
    ["net_uw_margin = 1 - combined", "abs(net_underwriting_margin - (1 - combined_ratio)) < 0.000001"],
    ["total_sources = total_application", "abs(total_sources_of_funds - total_application_of_funds) < 0.51"],
    ["total_assets = total_application", "abs(total_assets - total_application_of_funds) < 0.51"],
    ["net_worth = share_capital + reserves", "abs(net_worth - (share_capital + reserves_and_surplus)) < 0.51"],
    ["incurred_claims >= claims_paid", "incurred_claims >= claims_paid"],
  ];
  for (const [lbl, expr] of GI) {
    r = await q(`select count(*)::int n, sum(case when ${expr} then 1 else 0 end)::int ok from general_insurance_fundamentals where result_type='standalone'`);
    console.log(`   ${lbl}: ${pc(r[0].ok, r[0].n)}`);
  }
}
main().then(() => prisma.$disconnect());
