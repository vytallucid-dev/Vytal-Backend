/*
  Warnings:

  - You are about to drop the column `adjusted_shares_cr` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `borrowings` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `capital_wip` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `cash_and_bank` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `dividend_amount` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `dividend_payout` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `dividend_yield` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `employee_cost` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `eps` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `ev_ebitda` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `financing_cash_flow` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `interest` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `inventory` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `investing_cash_flow` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `investments` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `market_cap` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `net_block` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `no_of_shares` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `operating_cash_flow` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `other_assets` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `other_expenses` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `other_liabilities` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `other_mfr_exp` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `pb_ratio` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `pe_ratio` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `price_eoy` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `receivables` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `reserves` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to drop the column `selling_admin` on the `fundamentals` table. All the data in the column will be lost.
  - You are about to alter the column `revenue` on the `quarterly_results` table. The data in that column could be lost. The data in that column will be cast from `Decimal(20,2)` to `Decimal(18,2)`.
  - You are about to alter the column `expenses` on the `quarterly_results` table. The data in that column could be lost. The data in that column will be cast from `Decimal(20,2)` to `Decimal(18,2)`.
  - You are about to alter the column `operating_profit` on the `quarterly_results` table. The data in that column could be lost. The data in that column will be cast from `Decimal(20,2)` to `Decimal(18,2)`.
  - You are about to alter the column `other_income` on the `quarterly_results` table. The data in that column could be lost. The data in that column will be cast from `Decimal(20,2)` to `Decimal(18,2)`.
  - You are about to alter the column `depreciation` on the `quarterly_results` table. The data in that column could be lost. The data in that column will be cast from `Decimal(20,2)` to `Decimal(18,2)`.
  - You are about to alter the column `interest` on the `quarterly_results` table. The data in that column could be lost. The data in that column will be cast from `Decimal(20,2)` to `Decimal(18,2)`.
  - You are about to alter the column `profit_before_tax` on the `quarterly_results` table. The data in that column could be lost. The data in that column will be cast from `Decimal(20,2)` to `Decimal(18,2)`.
  - You are about to alter the column `tax` on the `quarterly_results` table. The data in that column could be lost. The data in that column will be cast from `Decimal(20,2)` to `Decimal(18,2)`.
  - You are about to alter the column `net_profit` on the `quarterly_results` table. The data in that column could be lost. The data in that column will be cast from `Decimal(20,2)` to `Decimal(18,2)`.
  - Added the required column `filing_date` to the `fundamentals` table without a default value. This is not possible if the table is not empty.
  - Added the required column `result_type` to the `fundamentals` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `fundamentals` table without a default value. This is not possible if the table is not empty.
  - Added the required column `xbrl_url` to the `fundamentals` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `quarterly_results` table without a default value. This is not possible if the table is not empty.
  - Made the column `filing_date` on table `quarterly_results` required. This step will fail if there are existing NULL values in that column.
  - Made the column `xbrl_url` on table `quarterly_results` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "IndustryType" AS ENUM ('non_financial', 'banking', 'nbfc', 'life_insurance', 'general_insurance');

-- DropIndex
DROP INDEX "fundamentals_fiscal_year_idx";

-- DropIndex
DROP INDEX "fundamentals_stock_id_idx";

-- DropIndex
DROP INDEX "quarterly_results_stock_id_idx";

-- AlterTable
ALTER TABLE "fundamentals" DROP COLUMN "adjusted_shares_cr",
DROP COLUMN "borrowings",
DROP COLUMN "capital_wip",
DROP COLUMN "cash_and_bank",
DROP COLUMN "dividend_amount",
DROP COLUMN "dividend_payout",
DROP COLUMN "dividend_yield",
DROP COLUMN "employee_cost",
DROP COLUMN "eps",
DROP COLUMN "ev_ebitda",
DROP COLUMN "financing_cash_flow",
DROP COLUMN "interest",
DROP COLUMN "inventory",
DROP COLUMN "investing_cash_flow",
DROP COLUMN "investments",
DROP COLUMN "market_cap",
DROP COLUMN "net_block",
DROP COLUMN "no_of_shares",
DROP COLUMN "operating_cash_flow",
DROP COLUMN "other_assets",
DROP COLUMN "other_expenses",
DROP COLUMN "other_liabilities",
DROP COLUMN "other_mfr_exp",
DROP COLUMN "pb_ratio",
DROP COLUMN "pe_ratio",
DROP COLUMN "price_eoy",
DROP COLUMN "receivables",
DROP COLUMN "reserves",
DROP COLUMN "selling_admin",
ADD COLUMN     "bank_balance_other" DECIMAL(18,2),
ADD COLUMN     "basic_eps" DECIMAL(10,4),
ADD COLUMN     "borrowings_current" DECIMAL(18,2),
ADD COLUMN     "borrowings_noncurrent" DECIMAL(18,2),
ADD COLUMN     "capex" DECIMAL(18,2),
ADD COLUMN     "capital_work_in_progress" DECIMAL(18,2),
ADD COLUMN     "cash_and_cash_equivalents" DECIMAL(18,2),
ADD COLUMN     "cash_from_financing" DECIMAL(18,2),
ADD COLUMN     "cash_from_investing" DECIMAL(18,2),
ADD COLUMN     "cash_from_operating" DECIMAL(18,2),
ADD COLUMN     "current_assets" DECIMAL(18,2),
ADD COLUMN     "current_investments" DECIMAL(18,2),
ADD COLUMN     "current_liabilities" DECIMAL(18,2),
ADD COLUMN     "current_tax_assets" DECIMAL(18,2),
ADD COLUMN     "current_tax_liabilities" DECIMAL(18,2),
ADD COLUMN     "deferred_tax_assets_net" DECIMAL(18,2),
ADD COLUMN     "deferred_tax_liabilities_net" DECIMAL(18,2),
ADD COLUMN     "diluted_eps" DECIMAL(10,4),
ADD COLUMN     "dividends_paid" DECIMAL(18,2),
ADD COLUMN     "employee_benefit_expense" DECIMAL(18,2),
ADD COLUMN     "equity_attributable_to_owners" DECIMAL(18,2),
ADD COLUMN     "expenses" DECIMAL(18,2),
ADD COLUMN     "extra_metrics" JSONB,
ADD COLUMN     "face_value_share" DECIMAL(10,4),
ADD COLUMN     "filing_date" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "finance_costs" DECIMAL(18,2),
ADD COLUMN     "goodwill" DECIMAL(18,2),
ADD COLUMN     "intangible_assets_under_development" DECIMAL(18,2),
ADD COLUMN     "interest_paid" DECIMAL(18,2),
ADD COLUMN     "inventories" DECIMAL(18,2),
ADD COLUMN     "investment_property" DECIMAL(18,2),
ADD COLUMN     "investments_equity_method" DECIMAL(18,2),
ADD COLUMN     "loans_current" DECIMAL(18,2),
ADD COLUMN     "loans_noncurrent" DECIMAL(18,2),
ADD COLUMN     "noncurrent_assets" DECIMAL(18,2),
ADD COLUMN     "noncurrent_assets_held_for_sale" DECIMAL(18,2),
ADD COLUMN     "noncurrent_investments" DECIMAL(18,2),
ADD COLUMN     "noncurrent_liabilities" DECIMAL(18,2),
ADD COLUMN     "other_current_assets" DECIMAL(18,2),
ADD COLUMN     "other_current_financial_assets" DECIMAL(18,2),
ADD COLUMN     "other_current_financial_liabilities" DECIMAL(18,2),
ADD COLUMN     "other_current_liabilities" DECIMAL(18,2),
ADD COLUMN     "other_equity" DECIMAL(18,2),
ADD COLUMN     "other_intangible_assets" DECIMAL(18,2),
ADD COLUMN     "other_noncurrent_assets" DECIMAL(18,2),
ADD COLUMN     "other_noncurrent_financial_assets" DECIMAL(18,2),
ADD COLUMN     "other_noncurrent_financial_liabilities" DECIMAL(18,2),
ADD COLUMN     "other_noncurrent_liabilities" DECIMAL(18,2),
ADD COLUMN     "paid_up_equity_capital" DECIMAL(18,2),
ADD COLUMN     "proceeds_from_borrowings" DECIMAL(18,2),
ADD COLUMN     "property_plant_and_equipment" DECIMAL(18,2),
ADD COLUMN     "provisions_current" DECIMAL(18,2),
ADD COLUMN     "provisions_noncurrent" DECIMAL(18,2),
ADD COLUMN     "repayments_of_borrowings" DECIMAL(18,2),
ADD COLUMN     "result_type" TEXT NOT NULL,
ADD COLUMN     "total_equity" DECIMAL(18,2),
ADD COLUMN     "trade_payables_current" DECIMAL(18,2),
ADD COLUMN     "trade_payables_noncurrent" DECIMAL(18,2),
ADD COLUMN     "trade_receivables_current" DECIMAL(18,2),
ADD COLUMN     "trade_receivables_noncurrent" DECIMAL(18,2),
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "xbrl_taxonomy" TEXT NOT NULL DEFAULT 'in_capmkt',
ADD COLUMN     "xbrl_url" TEXT NOT NULL,
ALTER COLUMN "receivables_days" SET DATA TYPE DECIMAL(10,2),
ALTER COLUMN "inventory_turnover" SET DATA TYPE DECIMAL(10,4),
ALTER COLUMN "asset_turnover" SET DATA TYPE DECIMAL(10,4),
ALTER COLUMN "interest_coverage" SET DATA TYPE DECIMAL(10,4),
ALTER COLUMN "source" DROP DEFAULT;

-- AlterTable
ALTER TABLE "quarterly_results" ADD COLUMN     "extra_metrics" JSONB,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "xbrl_taxonomy" TEXT NOT NULL DEFAULT 'in_capmkt',
ALTER COLUMN "revenue" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "expenses" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "operating_profit" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "other_income" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "depreciation" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "interest" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "profit_before_tax" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "tax" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "net_profit" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "source" DROP DEFAULT,
ALTER COLUMN "filing_date" SET NOT NULL,
ALTER COLUMN "result_type" DROP DEFAULT,
ALTER COLUMN "xbrl_url" SET NOT NULL;

-- AlterTable
ALTER TABLE "stocks" ADD COLUMN     "industryType" "IndustryType" NOT NULL DEFAULT 'non_financial';

-- CreateTable
CREATE TABLE "banking_fundamentals" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "filing_date" TIMESTAMP(3) NOT NULL,
    "xbrl_url" TEXT NOT NULL,
    "result_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "xbrl_taxonomy" TEXT NOT NULL DEFAULT 'in_capmkt',
    "interest_earned" DECIMAL(18,2),
    "interest_expended" DECIMAL(18,2),
    "interest_on_advances" DECIMAL(18,2),
    "revenue_on_investments" DECIMAL(18,2),
    "interest_on_rbi_balances" DECIMAL(18,2),
    "other_interest" DECIMAL(18,2),
    "other_income" DECIMAL(18,2),
    "employees_cost" DECIMAL(18,2),
    "operating_expenses" DECIMAL(18,2),
    "other_operating_expenses" DECIMAL(18,2),
    "expenditure_excl_provisions" DECIMAL(18,2),
    "ppop" DECIMAL(18,2),
    "provisions" DECIMAL(18,2),
    "exceptional_items" DECIMAL(18,2),
    "extraordinary_items" DECIMAL(18,2),
    "profit_before_tax" DECIMAL(18,2),
    "tax" DECIMAL(18,2),
    "profit_after_tax" DECIMAL(18,2),
    "net_profit" DECIMAL(18,2),
    "capital" DECIMAL(18,2),
    "reserves_and_surplus" DECIMAL(18,2),
    "reserve_excl_revaluation" DECIMAL(18,2),
    "deposits" DECIMAL(18,2),
    "borrowings" DECIMAL(18,2),
    "other_liabilities" DECIMAL(18,2),
    "capital_and_liabilities" DECIMAL(18,2),
    "cash_and_balances_with_rbi" DECIMAL(18,2),
    "balances_with_banks" DECIMAL(18,2),
    "investments" DECIMAL(18,2),
    "advances" DECIMAL(18,2),
    "fixed_assets" DECIMAL(18,2),
    "other_assets" DECIMAL(18,2),
    "total_assets" DECIMAL(18,2),
    "cash_from_operating" DECIMAL(18,2),
    "cash_from_investing" DECIMAL(18,2),
    "cash_from_financing" DECIMAL(18,2),
    "net_cash_flow" DECIMAL(18,2),
    "gnpa_absolute" DECIMAL(18,2),
    "nnpa_absolute" DECIMAL(18,2),
    "gnpa_pct" DECIMAL(8,6),
    "nnpa_pct" DECIMAL(8,6),
    "pcr" DECIMAL(8,6),
    "cet1_ratio" DECIMAL(8,6),
    "additional_tier1_ratio" DECIMAL(8,6),
    "tier1_ratio" DECIMAL(8,6),
    "roa_disclosed" DECIMAL(8,6),
    "basic_eps" DECIMAL(10,4),
    "diluted_eps" DECIMAL(10,4),
    "face_value_share" DECIMAL(10,4),
    "paid_up_equity_capital" DECIMAL(18,2),
    "nii" DECIMAL(18,2),
    "total_income" DECIMAL(18,2),
    "net_interest_margin" DECIMAL(8,6),
    "cost_to_income_ratio" DECIMAL(8,6),
    "credit_cost_pct" DECIMAL(8,6),
    "roe" DECIMAL(8,6),
    "credit_deposit_ratio" DECIMAL(8,6),
    "net_worth" DECIMAL(18,2),
    "book_value_per_share" DECIMAL(10,4),
    "nii_growth_yoy" DECIMAL(8,4),
    "pat_growth_yoy" DECIMAL(8,4),
    "deposit_growth_yoy" DECIMAL(8,4),
    "advance_growth_yoy" DECIMAL(8,4),
    "asset_growth_yoy" DECIMAL(8,4),
    "extra_metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banking_fundamentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banking_quarterly_results" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "filing_date" TIMESTAMP(3) NOT NULL,
    "xbrl_url" TEXT NOT NULL,
    "result_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "xbrl_taxonomy" TEXT NOT NULL DEFAULT 'in_capmkt',
    "interest_earned" DECIMAL(18,2),
    "interest_expended" DECIMAL(18,2),
    "other_income" DECIMAL(18,2),
    "employees_cost" DECIMAL(18,2),
    "operating_expenses" DECIMAL(18,2),
    "expenditure_excl_provisions" DECIMAL(18,2),
    "ppop" DECIMAL(18,2),
    "provisions" DECIMAL(18,2),
    "exceptional_items" DECIMAL(18,2),
    "profit_before_tax" DECIMAL(18,2),
    "tax" DECIMAL(18,2),
    "profit_after_tax" DECIMAL(18,2),
    "net_profit" DECIMAL(18,2),
    "gnpa_absolute" DECIMAL(18,2),
    "nnpa_absolute" DECIMAL(18,2),
    "gnpa_pct" DECIMAL(8,6),
    "nnpa_pct" DECIMAL(8,6),
    "pcr" DECIMAL(8,6),
    "cet1_ratio" DECIMAL(8,6),
    "additional_tier1_ratio" DECIMAL(8,6),
    "tier1_ratio" DECIMAL(8,6),
    "roa_quarterly" DECIMAL(8,6),
    "audit_pending" BOOLEAN NOT NULL DEFAULT false,
    "nii" DECIMAL(18,2),
    "total_income" DECIMAL(18,2),
    "cost_to_income_ratio" DECIMAL(8,6),
    "net_margin" DECIMAL(8,4),
    "nii_qoq" DECIMAL(8,4),
    "nii_yoy" DECIMAL(8,4),
    "pat_qoq" DECIMAL(8,4),
    "pat_yoy" DECIMAL(8,4),
    "extra_metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banking_quarterly_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nbfc_fundamentals" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "filing_date" TIMESTAMP(3) NOT NULL,
    "xbrl_url" TEXT NOT NULL,
    "result_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "xbrl_taxonomy" TEXT NOT NULL DEFAULT 'in_capmkt',
    "revenue" DECIMAL(18,2),
    "interest_income" DECIMAL(18,2),
    "fee_and_commission_income" DECIMAL(18,2),
    "net_gain_on_fair_value_changes" DECIMAL(18,2),
    "other_income" DECIMAL(18,2),
    "total_income" DECIMAL(18,2),
    "finance_costs" DECIMAL(18,2),
    "fee_and_commission_expense" DECIMAL(18,2),
    "impairment_on_financial_instruments" DECIMAL(18,2),
    "employee_benefit_expense" DECIMAL(18,2),
    "depreciation" DECIMAL(18,2),
    "other_expenses" DECIMAL(18,2),
    "total_expenses" DECIMAL(18,2),
    "profit_before_tax" DECIMAL(18,2),
    "tax" DECIMAL(18,2),
    "net_profit" DECIMAL(18,2),
    "equity_share_capital" DECIMAL(18,2),
    "other_equity" DECIMAL(18,2),
    "total_equity" DECIMAL(18,2),
    "cash_and_cash_equivalents" DECIMAL(18,2),
    "bank_balance_other" DECIMAL(18,2),
    "loans" DECIMAL(18,2),
    "investments" DECIMAL(18,2),
    "derivative_financial_assets" DECIMAL(18,2),
    "receivables_trade" DECIMAL(18,2),
    "other_financial_assets" DECIMAL(18,2),
    "financial_assets" DECIMAL(18,2),
    "current_tax_assets_net" DECIMAL(18,2),
    "deferred_tax_assets_net" DECIMAL(18,2),
    "property_plant_and_equipment" DECIMAL(18,2),
    "capital_work_in_progress" DECIMAL(18,2),
    "intangible_assets_under_development" DECIMAL(18,2),
    "goodwill" DECIMAL(18,2),
    "other_intangible_assets" DECIMAL(18,2),
    "other_non_financial_assets" DECIMAL(18,2),
    "non_financial_assets" DECIMAL(18,2),
    "total_assets" DECIMAL(18,2),
    "derivative_financial_liabilities" DECIMAL(18,2),
    "payables" DECIMAL(18,2),
    "debt_securities" DECIMAL(18,2),
    "borrowings" DECIMAL(18,2),
    "deposits_liabilities" DECIMAL(18,2),
    "subordinated_liabilities" DECIMAL(18,2),
    "other_financial_liabilities" DECIMAL(18,2),
    "financial_liabilities" DECIMAL(18,2),
    "current_tax_liabilities_net" DECIMAL(18,2),
    "provisions" DECIMAL(18,2),
    "deferred_tax_liabilities_net" DECIMAL(18,2),
    "other_non_financial_liabilities" DECIMAL(18,2),
    "non_financial_liabilities" DECIMAL(18,2),
    "total_liabilities" DECIMAL(18,2),
    "cash_from_operating" DECIMAL(18,2),
    "cash_from_investing" DECIMAL(18,2),
    "cash_from_financing" DECIMAL(18,2),
    "net_cash_flow" DECIMAL(18,2),
    "basic_eps" DECIMAL(10,4),
    "diluted_eps" DECIMAL(10,4),
    "face_value_share" DECIMAL(10,4),
    "paid_up_equity_capital" DECIMAL(18,2),
    "nim" DECIMAL(8,6),
    "cost_to_income_ratio" DECIMAL(8,6),
    "credit_cost_pct" DECIMAL(8,6),
    "spread" DECIMAL(8,6),
    "capital_to_assets_ratio" DECIMAL(8,6),
    "borrowings_to_equity" DECIMAL(8,4),
    "net_worth" DECIMAL(18,2),
    "book_value_per_share" DECIMAL(10,4),
    "roe" DECIMAL(8,6),
    "aum_growth_yoy" DECIMAL(8,4),
    "revenue_growth_yoy" DECIMAL(8,4),
    "pat_growth_yoy" DECIMAL(8,4),
    "extra_metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nbfc_fundamentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nbfc_quarterly_results" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "filing_date" TIMESTAMP(3) NOT NULL,
    "xbrl_url" TEXT NOT NULL,
    "result_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "xbrl_taxonomy" TEXT NOT NULL DEFAULT 'in_capmkt',
    "revenue" DECIMAL(18,2),
    "interest_income" DECIMAL(18,2),
    "fee_and_commission_income" DECIMAL(18,2),
    "net_gain_on_fair_value_changes" DECIMAL(18,2),
    "other_income" DECIMAL(18,2),
    "total_income" DECIMAL(18,2),
    "finance_costs" DECIMAL(18,2),
    "impairment_on_financial_instruments" DECIMAL(18,2),
    "employee_benefit_expense" DECIMAL(18,2),
    "depreciation" DECIMAL(18,2),
    "other_expenses" DECIMAL(18,2),
    "total_expenses" DECIMAL(18,2),
    "profit_before_tax" DECIMAL(18,2),
    "tax" DECIMAL(18,2),
    "net_profit" DECIMAL(18,2),
    "nii" DECIMAL(18,2),
    "net_margin" DECIMAL(8,4),
    "revenue_qoq" DECIMAL(8,4),
    "revenue_yoy" DECIMAL(8,4),
    "pat_qoq" DECIMAL(8,4),
    "pat_yoy" DECIMAL(8,4),
    "extra_metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nbfc_quarterly_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "life_insurance_fundamentals" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "filing_date" TIMESTAMP(3) NOT NULL,
    "xbrl_url" TEXT NOT NULL,
    "result_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "xbrl_taxonomy" TEXT NOT NULL DEFAULT 'in_capmkt',
    "gross_premium_income" DECIMAL(18,2),
    "net_premium_income" DECIMAL(18,2),
    "income_first_year_premium" DECIMAL(18,2),
    "income_renewal_premium" DECIMAL(18,2),
    "income_single_premium" DECIMAL(18,2),
    "reinsurance_ceded" DECIMAL(18,2),
    "income_from_investments" DECIMAL(18,2),
    "other_income_policyholders" DECIMAL(18,2),
    "total_revenue_policyholders" DECIMAL(18,2),
    "commission_first_year_premium" DECIMAL(18,2),
    "commission_renewal_premium" DECIMAL(18,2),
    "commission_single_premium" DECIMAL(18,2),
    "total_commission" DECIMAL(18,2),
    "employees_remuneration" DECIMAL(18,2),
    "administration_expenses" DECIMAL(18,2),
    "advertisement_and_publicity" DECIMAL(18,2),
    "total_operating_expenses" DECIMAL(18,2),
    "benefits_paid_net" DECIMAL(18,2),
    "change_in_valuation_of_liabilities" DECIMAL(18,2),
    "allocation_of_bonus_to_policyholders" DECIMAL(18,2),
    "surplus_from_revenue_account" DECIMAL(18,2),
    "transfer_from_policyholders" DECIMAL(18,2),
    "income_from_investments_shareholders" DECIMAL(18,2),
    "other_income_shareholders" DECIMAL(18,2),
    "shareholders_expenses" DECIMAL(18,2),
    "profit_before_tax" DECIMAL(18,2),
    "tax" DECIMAL(18,2),
    "net_profit" DECIMAL(18,2),
    "share_capital" DECIMAL(18,2),
    "reserves_and_surplus" DECIMAL(18,2),
    "fair_value_change_account" DECIMAL(18,2),
    "borrowings" DECIMAL(18,2),
    "policyholders_funds" DECIMAL(18,2),
    "funds_for_future_appropriations" DECIMAL(18,2),
    "total_sources_of_funds" DECIMAL(18,2),
    "investments_shareholders" DECIMAL(18,2),
    "investments_policyholders" DECIMAL(18,2),
    "assets_held_to_cover_linked_liabilities" DECIMAL(18,2),
    "loans_application_of_funds" DECIMAL(18,2),
    "fixed_assets" DECIMAL(18,2),
    "cash_and_bank_balances" DECIMAL(18,2),
    "advances_and_other_assets" DECIMAL(18,2),
    "current_liabilities" DECIMAL(18,2),
    "provisions" DECIMAL(18,2),
    "miscellaneous_expenditure" DECIMAL(18,2),
    "debit_balance_profit_and_loss" DECIMAL(18,2),
    "total_application_of_funds" DECIMAL(18,2),
    "total_assets" DECIMAL(18,2),
    "solvency_ratio" DECIMAL(8,4),
    "persistency_ratio_13_month" DECIMAL(8,6),
    "persistency_ratio_25_month" DECIMAL(8,6),
    "persistency_ratio_37_month" DECIMAL(8,6),
    "persistency_ratio_49_month" DECIMAL(8,6),
    "persistency_ratio_61_month" DECIMAL(8,6),
    "basic_eps" DECIMAL(10,4),
    "diluted_eps" DECIMAL(10,4),
    "face_value_share" DECIMAL(10,4),
    "net_worth" DECIMAL(18,2),
    "book_value_per_share" DECIMAL(10,4),
    "roe" DECIMAL(8,6),
    "new_business_premium_pct" DECIMAL(8,6),
    "expense_ratio_policyholders" DECIMAL(8,6),
    "premium_growth_yoy" DECIMAL(8,4),
    "pat_growth_yoy" DECIMAL(8,4),
    "extra_metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "life_insurance_fundamentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "life_insurance_quarterly_results" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "filing_date" TIMESTAMP(3) NOT NULL,
    "xbrl_url" TEXT NOT NULL,
    "result_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "xbrl_taxonomy" TEXT NOT NULL DEFAULT 'in_capmkt',
    "gross_premium_income" DECIMAL(18,2),
    "net_premium_income" DECIMAL(18,2),
    "income_first_year_premium" DECIMAL(18,2),
    "income_renewal_premium" DECIMAL(18,2),
    "income_single_premium" DECIMAL(18,2),
    "reinsurance_ceded" DECIMAL(18,2),
    "income_from_investments" DECIMAL(18,2),
    "total_revenue_policyholders" DECIMAL(18,2),
    "total_commission" DECIMAL(18,2),
    "total_operating_expenses" DECIMAL(18,2),
    "benefits_paid_net" DECIMAL(18,2),
    "change_in_valuation_of_liabilities" DECIMAL(18,2),
    "profit_before_tax" DECIMAL(18,2),
    "tax" DECIMAL(18,2),
    "net_profit" DECIMAL(18,2),
    "solvency_ratio" DECIMAL(8,4),
    "persistency_ratio_13_month" DECIMAL(8,6),
    "persistency_ratio_25_month" DECIMAL(8,6),
    "persistency_ratio_37_month" DECIMAL(8,6),
    "persistency_ratio_49_month" DECIMAL(8,6),
    "persistency_ratio_61_month" DECIMAL(8,6),
    "new_business_premium_pct" DECIMAL(8,6),
    "expense_ratio_policyholders" DECIMAL(8,6),
    "net_margin" DECIMAL(8,4),
    "premium_qoq" DECIMAL(8,4),
    "premium_yoy" DECIMAL(8,4),
    "pat_qoq" DECIMAL(8,4),
    "pat_yoy" DECIMAL(8,4),
    "extra_metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "life_insurance_quarterly_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general_insurance_fundamentals" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "filing_date" TIMESTAMP(3) NOT NULL,
    "xbrl_url" TEXT NOT NULL,
    "result_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "xbrl_taxonomy" TEXT NOT NULL DEFAULT 'in_capmkt',
    "gross_premiums_written" DECIMAL(18,2),
    "net_premium_written" DECIMAL(18,2),
    "net_premium" DECIMAL(18,2),
    "premium_earned" DECIMAL(18,2),
    "reinsurance_ceded" DECIMAL(18,2),
    "reinsurance_accepted" DECIMAL(18,2),
    "change_in_unexpired_risk_reserve" DECIMAL(18,2),
    "income_from_investments" DECIMAL(18,2),
    "other_income" DECIMAL(18,2),
    "total_revenue" DECIMAL(18,2),
    "claims_paid" DECIMAL(18,2),
    "change_in_outstanding_claims" DECIMAL(18,2),
    "incurred_claims" DECIMAL(18,2),
    "reinsurance_recoveries_on_claims" DECIMAL(18,2),
    "commission_paid" DECIMAL(18,2),
    "commission_received_from_reinsurance" DECIMAL(18,2),
    "net_commission" DECIMAL(18,2),
    "employees_remuneration" DECIMAL(18,2),
    "rent_rates_and_taxes" DECIMAL(18,2),
    "legal_and_professional_charges" DECIMAL(18,2),
    "advertisement_and_publicity" DECIMAL(18,2),
    "total_operating_expenses_related_to_insurance" DECIMAL(18,2),
    "premium_deficiency" DECIMAL(18,2),
    "underwriting_profit_or_loss" DECIMAL(18,2),
    "profit_before_tax" DECIMAL(18,2),
    "tax" DECIMAL(18,2),
    "net_profit" DECIMAL(18,2),
    "share_capital" DECIMAL(18,2),
    "reserves_and_surplus" DECIMAL(18,2),
    "fair_value_change_account" DECIMAL(18,2),
    "borrowings" DECIMAL(18,2),
    "total_sources_of_funds" DECIMAL(18,2),
    "investments" DECIMAL(18,2),
    "loans_application_of_funds" DECIMAL(18,2),
    "fixed_assets" DECIMAL(18,2),
    "cash_and_bank_balances" DECIMAL(18,2),
    "advances_and_other_assets" DECIMAL(18,2),
    "current_liabilities" DECIMAL(18,2),
    "provisions" DECIMAL(18,2),
    "total_application_of_funds" DECIMAL(18,2),
    "total_assets" DECIMAL(18,2),
    "combined_ratio" DECIMAL(8,6),
    "incurred_claim_ratio" DECIMAL(8,6),
    "expenses_of_management_ratio" DECIMAL(8,6),
    "net_retention_ratio" DECIMAL(8,6),
    "solvency_ratio" DECIMAL(8,4),
    "basic_eps" DECIMAL(10,4),
    "diluted_eps" DECIMAL(10,4),
    "face_value_share" DECIMAL(10,4),
    "net_worth" DECIMAL(18,2),
    "book_value_per_share" DECIMAL(10,4),
    "roe" DECIMAL(8,6),
    "net_underwriting_margin" DECIMAL(8,6),
    "gpw_growth_yoy" DECIMAL(8,4),
    "pat_growth_yoy" DECIMAL(8,4),
    "extra_metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "general_insurance_fundamentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "general_insurance_quarterly_results" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "filing_date" TIMESTAMP(3) NOT NULL,
    "xbrl_url" TEXT NOT NULL,
    "result_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "xbrl_taxonomy" TEXT NOT NULL DEFAULT 'in_capmkt',
    "gross_premiums_written" DECIMAL(18,2),
    "net_premium_written" DECIMAL(18,2),
    "net_premium" DECIMAL(18,2),
    "premium_earned" DECIMAL(18,2),
    "income_from_investments" DECIMAL(18,2),
    "other_income" DECIMAL(18,2),
    "total_revenue" DECIMAL(18,2),
    "claims_paid" DECIMAL(18,2),
    "incurred_claims" DECIMAL(18,2),
    "net_commission" DECIMAL(18,2),
    "total_operating_expenses_related_to_insurance" DECIMAL(18,2),
    "underwriting_profit_or_loss" DECIMAL(18,2),
    "profit_before_tax" DECIMAL(18,2),
    "tax" DECIMAL(18,2),
    "net_profit" DECIMAL(18,2),
    "combined_ratio" DECIMAL(8,6),
    "incurred_claim_ratio" DECIMAL(8,6),
    "expenses_of_management_ratio" DECIMAL(8,6),
    "net_retention_ratio" DECIMAL(8,6),
    "solvency_ratio" DECIMAL(8,4),
    "net_underwriting_margin" DECIMAL(8,6),
    "net_margin" DECIMAL(8,4),
    "gpw_qoq" DECIMAL(8,4),
    "gpw_yoy" DECIMAL(8,4),
    "pat_qoq" DECIMAL(8,4),
    "pat_yoy" DECIMAL(8,4),
    "extra_metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "general_insurance_quarterly_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banking_fundamentals_stock_id_fiscal_year_idx" ON "banking_fundamentals"("stock_id", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "banking_fundamentals_stock_id_fiscal_year_key" ON "banking_fundamentals"("stock_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "banking_quarterly_results_stock_id_fiscal_year_idx" ON "banking_quarterly_results"("stock_id", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "banking_quarterly_results_stock_id_quarter_fiscal_year_key" ON "banking_quarterly_results"("stock_id", "quarter", "fiscal_year");

-- CreateIndex
CREATE INDEX "nbfc_fundamentals_stock_id_fiscal_year_idx" ON "nbfc_fundamentals"("stock_id", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "nbfc_fundamentals_stock_id_fiscal_year_key" ON "nbfc_fundamentals"("stock_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "nbfc_quarterly_results_stock_id_fiscal_year_idx" ON "nbfc_quarterly_results"("stock_id", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "nbfc_quarterly_results_stock_id_quarter_fiscal_year_key" ON "nbfc_quarterly_results"("stock_id", "quarter", "fiscal_year");

-- CreateIndex
CREATE INDEX "life_insurance_fundamentals_stock_id_fiscal_year_idx" ON "life_insurance_fundamentals"("stock_id", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "life_insurance_fundamentals_stock_id_fiscal_year_key" ON "life_insurance_fundamentals"("stock_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "life_insurance_quarterly_results_stock_id_fiscal_year_idx" ON "life_insurance_quarterly_results"("stock_id", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "life_insurance_quarterly_results_stock_id_quarter_fiscal_ye_key" ON "life_insurance_quarterly_results"("stock_id", "quarter", "fiscal_year");

-- CreateIndex
CREATE INDEX "general_insurance_fundamentals_stock_id_fiscal_year_idx" ON "general_insurance_fundamentals"("stock_id", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "general_insurance_fundamentals_stock_id_fiscal_year_key" ON "general_insurance_fundamentals"("stock_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "general_insurance_quarterly_results_stock_id_fiscal_year_idx" ON "general_insurance_quarterly_results"("stock_id", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "general_insurance_quarterly_results_stock_id_quarter_fiscal_key" ON "general_insurance_quarterly_results"("stock_id", "quarter", "fiscal_year");

-- CreateIndex
CREATE INDEX "fundamentals_stock_id_fiscal_year_idx" ON "fundamentals"("stock_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "quarterly_results_stock_id_fiscal_year_idx" ON "quarterly_results"("stock_id", "fiscal_year");

-- CreateIndex
CREATE INDEX "stocks_industryType_idx" ON "stocks"("industryType");

-- AddForeignKey
ALTER TABLE "banking_fundamentals" ADD CONSTRAINT "banking_fundamentals_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banking_quarterly_results" ADD CONSTRAINT "banking_quarterly_results_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nbfc_fundamentals" ADD CONSTRAINT "nbfc_fundamentals_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nbfc_quarterly_results" ADD CONSTRAINT "nbfc_quarterly_results_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "life_insurance_fundamentals" ADD CONSTRAINT "life_insurance_fundamentals_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "life_insurance_quarterly_results" ADD CONSTRAINT "life_insurance_quarterly_results_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general_insurance_fundamentals" ADD CONSTRAINT "general_insurance_fundamentals_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "general_insurance_quarterly_results" ADD CONSTRAINT "general_insurance_quarterly_results_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
