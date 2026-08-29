# Unit Conventions — the narrow `Decimal` columns on the ten result tables

**Read this before using any ratio column.** The unit is *not* inferable from the
column name, the `Decimal` width, or the helper that writes it.

Four shipped defects trace to guessing it:

| defect | shape |
|---|---|
| ROA ÷1e7 | a ratio scaled as if it were money |
| persistency 100× low | a percentage read as a fraction |
| AUM growth misread | a percentage read as a ratio |
| solvency band-test in three places | the same heuristic re-implemented, silently |

Every narrow column now carries an explicit `UNIT:` marker in
[`prisma/schema.prisma`](../prisma/schema.prisma). This file is the census behind
those markers.

## The convention

- **FRACTION** — 52 columns
- **PERCENT** — 46 columns
- **RUPEES/share** — 20 columns
- **MULTIPLE** — 5 columns
- **TIMES** — 3 columns
- **FRACTION** — a part of a whole. `0.8907` = 89.07%. `Decimal(8,6)`, ceiling 100.
  Persistency, combined / incurred-claim / expenses-of-management / net-retention,
  `gnpa_pct`, `nnpa_pct`, `pcr`, `cet1`/`tier1`, `roa`, `cost_to_income`, `nim`,
  `spread`, `capital_to_assets`, `credit_cost`.
  ⚠ A combined ratio **above 100% is ordinary** and stores fine: `1.586` = 158.6%,
  using 1.6% of the column. The column is not too narrow for underwriting losses.
- **PERCENT** — a rate of change or a margin. `15.3` = 15.3%. `Decimal(8,4)`,
  ceiling 10,000. Every `*_qoq`, `*_yoy`, `*_growth_yoy`, `net_margin`,
  `operating_margin`. `pctChange()` applies the ×100 exactly once, in one place,
  for all ten tables.
- **MULTIPLE** — a times-cover figure. `2.05` = 2.05×. `solvency_ratio`,
  `borrowings_to_equity`.
- **RUPEES/share** — per-share money. `basic_eps`, `diluted_eps`,
  `book_value_per_share`, `face_value_share`.
- **TIMES** — turnover and coverage, × per year.

## ⚠ The one column name that carries two units

| table | `roe` unit | live max |
|---|---|---|
| `fundamentals` | **PERCENT** | 384.5788 |
| `banking_fundamentals` | **FRACTION** | 0.227911 |
| `nbfc_fundamentals` | **FRACTION** | 0.790728 |
| `life_insurance_fundamentals` | **FRACTION** | 0.381584 |
| `general_insurance_fundamentals` | **FRACTION** | 0.174168 |

They are 100× apart under the same name. `fundamentals` computes
`(netProfit / avgEquity) * 100` and stores the percent; the four financial-family
tables compute the same thing and divide by 100 before storing
(`derive-banking-annual.ts`: `decimalRatio(roe / 100) // store as ratio`).
**Do not write a reader that treats them alike.**

Near-miss of the same shape: `fundamentals.debt_to_equity` is a **PERCENT**
(`debtToEquity * 100`, live max 4056.24) while
`nbfc_fundamentals.borrowings_to_equity` is a **MULTIPLE** (no ×100, live max
7.8251). The same debt÷equity concept, under two names, in two units.

## Where the scaling happens

| site | scaling | applies to |
|---|---|---|
| `xbrl/extract.ts:58` | `/1e7` when `unitRef="INR"` | money only — `pure` is returned as-is, so **ratios arrive from the filing as fractions** |
| `ingester-utils.ts:81` `pctChange()` | `×100` | every growth/margin column, once |
| `parser-li.ts:164`, `parser-gi.ts:129` | `raw < 0.5 ? ×100 : raw` | solvency only |
| `fundamentals-view.service.ts:2037` `normalizeSolvency()` | `n < 0.5 ? n*100 : n` | the same heuristic again, at read time |

⚠ The solvency band-test exists in **three** places. It is idempotent on its own
output, so it is not double-applied today — but a genuine solvency **below 0.5×**
(an insurer in breach, exactly when the number matters) would be silently
multiplied to 40×.

⚠ `combined_ratio` is the only extracted ratio that also feeds a derive
(`netUnderwritingMargin = 1 − combinedRatio`). It has **no** band-test, unlike the
solvency two lines above it in the same function. A percent-filed combined ratio
would corrupt two columns rather than one.

## The census

Generated from the live database and the derive/ingester sources, 2026-08-22.
`rows` is non-null cells; `max abs` is the largest stored magnitude.

### `fundamentals`

| column | type | ceiling | unit | rows | max abs |
|---|---|---|---|---|---|
| `basic_eps` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 5704 | 5720.3900 |
| `diluted_eps` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 5704 | 5720.3900 |
| `face_value_share` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 5688 | 20.0000 |
| `net_margin` | Decimal(8,4) | 10,000 | **PERCENT** | 5692 | 6219.0616 |
| `operating_margin` | Decimal(8,4) | 10,000 | **PERCENT** | 5692 | 4759.5092 |
| `book_value_per_share` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 2900 | 49468.3019 |
| `debt_to_equity` | Decimal(8,4) | 10,000 | **PERCENT** | 2937 | 4056.2401 |
| `roe` | Decimal(8,4) | 10,000 | **PERCENT** | 2938 | 384.5788 |
| `roce` | Decimal(8,4) | 10,000 | **PERCENT** | 2939 | 319.3975 |
| `interest_coverage` | Decimal(10,4) | 10,00,000 | **TIMES** | 5665 | 70241.7923 |
| `inventory_turnover` | Decimal(10,4) | 10,00,000 | **TIMES** | 2622 | 431573.0000 |
| `asset_turnover` | Decimal(10,4) | 10,00,000 | **TIMES** | 2939 | 5.7384 |
| `revenue_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 2192 | 8735.5884 |
| `profit_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 2098 | 8228.2192 |
| `eps_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 2193 | 6883.7310 |

### `quarterly_results`

| column | type | ceiling | unit | rows | max abs |
|---|---|---|---|---|---|
| `operating_margin` | Decimal(8,4) | 10,000 | **PERCENT** | 20989 | 9939.1767 |
| `net_margin` | Decimal(8,4) | 10,000 | **PERCENT** | 20990 | 8105.5911 |
| `revenue_qoq` | Decimal(8,4) | 10,000 | **PERCENT** | 9918 | 9351.2216 |
| `revenue_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 7130 | 9348.7560 |
| `profit_qoq` | Decimal(8,4) | 10,000 | **PERCENT** | 9537 | 9819.0184 |
| `profit_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 6754 | 6779.4292 |

### `banking_fundamentals`

| column | type | ceiling | unit | rows | max abs |
|---|---|---|---|---|---|
| `gnpa_pct` | Decimal(8,6) | 100 | **FRACTION** | 302 | 0.275300 |
| `nnpa_pct` | Decimal(8,6) | 100 | **FRACTION** | 302 | 0.108100 |
| `pcr` | Decimal(8,6) | 100 | **FRACTION** | 286 | 0.949614 |
| `cet1_ratio` | Decimal(8,6) | 100 | **FRACTION** | 219 | 0.278800 |
| `additional_tier1_ratio` | Decimal(8,6) | 100 | **FRACTION** | 202 | 0.148300 |
| `tier1_ratio` | Decimal(8,6) | 100 | **FRACTION** | 200 | 0.292800 |
| `roa_disclosed` | Decimal(8,6) | 100 | **FRACTION** | 296 | 0.046800 |
| `basic_eps` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 337 | 115.5400 |
| `diluted_eps` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 337 | 115.3300 |
| `face_value_share` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 336 | 994.1100 |
| `net_interest_margin` | Decimal(8,6) | 100 | **FRACTION** | 246 | 0.447931 |
| `cost_to_income_ratio` | Decimal(8,6) | 100 | **FRACTION** | 337 | 0.930902 |
| `credit_cost_pct` | Decimal(8,6) | 100 | **FRACTION** | 239 | 0.183113 |
| `roe` | Decimal(8,6) | 100 | **FRACTION** | 146 | 0.227911 |
| `credit_deposit_ratio` | Decimal(8,6) | 100 | **FRACTION** | 239 | 1.627153 |
| `book_value_per_share` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 142 | 843.7785 |
| `nii_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 235 | 116.4420 |
| `pat_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 250 | 1644.6856 |
| `deposit_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 159 | 104.9856 |
| `advance_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 159 | 87.5842 |
| `asset_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 166 | 94.6138 |

### `banking_quarterly_results`

| column | type | ceiling | unit | rows | max abs |
|---|---|---|---|---|---|
| `gnpa_pct` | Decimal(8,6) | 100 | **FRACTION** | 1208 | 0.307800 |
| `nnpa_pct` | Decimal(8,6) | 100 | **FRACTION** | 1202 | 0.187600 |
| `pcr` | Decimal(8,6) | 100 | **FRACTION** | 1123 | 0.958872 |
| `cet1_ratio` | Decimal(8,6) | 100 | **FRACTION** | 841 | 0.321800 |
| `additional_tier1_ratio` | Decimal(8,6) | 100 | **FRACTION** | 756 | 0.209700 |
| `tier1_ratio` | Decimal(8,6) | 100 | **FRACTION** | 747 | 0.427000 |
| `roa_quarterly` | Decimal(8,6) | 100 | **FRACTION** | 1131 | 0.233000 |
| `cost_to_income_ratio` | Decimal(8,6) | 100 | **FRACTION** | 1311 | 1.043277 |
| `net_margin` | Decimal(8,4) | 10,000 | **PERCENT** | 1311 | 296.0885 |
| `nii_qoq` | Decimal(8,4) | 10,000 | **PERCENT** | 1097 | 122.7302 |
| `nii_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 868 | 154.2775 |
| `pat_qoq` | Decimal(8,4) | 10,000 | **PERCENT** | 1115 | 4292.0896 |
| `pat_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 912 | 1952.6037 |

### `nbfc_fundamentals`

| column | type | ceiling | unit | rows | max abs |
|---|---|---|---|---|---|
| `basic_eps` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 245 | 865.9000 |
| `diluted_eps` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 246 | 865.9000 |
| `face_value_share` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 243 | 10.0000 |
| `nim` | Decimal(8,6) | 100 | **FRACTION** | 140 | 0.233021 |
| `cost_to_income_ratio` | Decimal(8,6) | 100 | **FRACTION** | 174 | 1.559725 |
| `credit_cost_pct` | Decimal(8,6) | 100 | **FRACTION** | 152 | 0.222741 |
| `spread` | Decimal(8,6) | 100 | **FRACTION** | 136 | 0.285978 |
| `capital_to_assets_ratio` | Decimal(8,6) | 100 | **FRACTION** | 213 | 0.997742 |
| `borrowings_to_equity` | Decimal(8,4) | 10,000 | **MULTIPLE** | 174 | 7.8251 |
| `book_value_per_share` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 207 | 7405.7418 |
| `roe` | Decimal(8,6) | 100 | **FRACTION** | 213 | 0.790728 |
| `aum_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 70 | 8019.1960 |
| `revenue_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 150 | 106.9462 |
| `pat_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 143 | 905.9351 |

### `nbfc_quarterly_results`

| column | type | ceiling | unit | rows | max abs |
|---|---|---|---|---|---|
| `net_margin` | Decimal(8,4) | 10,000 | **PERCENT** | 806 | 3388.5076 |
| `revenue_qoq` | Decimal(8,4) | 10,000 | **PERCENT** | 710 | 3181.8318 |
| `revenue_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 475 | 360.8876 |
| `pat_qoq` | Decimal(8,4) | 10,000 | **PERCENT** | 671 | 6880.6371 |
| `pat_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 431 | 2979.4136 |

### `life_insurance_fundamentals`

| column | type | ceiling | unit | rows | max abs |
|---|---|---|---|---|---|
| `solvency_ratio` | Decimal(8,4) | 10,000 | **MULTIPLE** | 15 | 2.3500 |
| `persistency_ratio_13_month` | Decimal(8,6) | 100 | **FRACTION** | 15 | 0.890700 |
| `persistency_ratio_25_month` | Decimal(8,6) | 100 | **FRACTION** | 15 | 0.825700 |
| `persistency_ratio_37_month` | Decimal(8,6) | 100 | **FRACTION** | 15 | 0.763500 |
| `persistency_ratio_49_month` | Decimal(8,6) | 100 | **FRACTION** | 15 | 0.718000 |
| `persistency_ratio_61_month` | Decimal(8,6) | 100 | **FRACTION** | 15 | 0.644000 |
| `basic_eps` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 15 | 90.8400 |
| `diluted_eps` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 15 | 90.8400 |
| `face_value_share` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 0 | — |
| `book_value_per_share` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 15 | 279.6563 |
| `roe` | Decimal(8,6) | 100 | **FRACTION** | 15 | 0.381584 |
| `new_business_premium_pct` | Decimal(8,6) | 100 | **FRACTION** | 15 | 0.257307 |
| `expense_ratio_policyholders` | Decimal(8,6) | 100 | **FRACTION** | 15 | 0.124786 |
| `premium_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 7 | 19.1817 |
| `pat_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 7 | 35.6274 |

### `life_insurance_quarterly_results`

| column | type | ceiling | unit | rows | max abs |
|---|---|---|---|---|---|
| `solvency_ratio` | Decimal(8,4) | 10,000 | **MULTIPLE** | 45 | 2.4200 |
| `persistency_ratio_13_month` | Decimal(8,6) | 100 | **FRACTION** | 45 | 0.847300 |
| `persistency_ratio_25_month` | Decimal(8,6) | 100 | **FRACTION** | 45 | 0.825000 |
| `persistency_ratio_37_month` | Decimal(8,6) | 100 | **FRACTION** | 45 | 0.766000 |
| `persistency_ratio_49_month` | Decimal(8,6) | 100 | **FRACTION** | 45 | 0.708000 |
| `persistency_ratio_61_month` | Decimal(8,6) | 100 | **FRACTION** | 45 | 0.654800 |
| `new_business_premium_pct` | Decimal(8,6) | 100 | **FRACTION** | 45 | 0.324655 |
| `expense_ratio_policyholders` | Decimal(8,6) | 100 | **FRACTION** | 45 | 0.152717 |
| `net_margin` | Decimal(8,4) | 10,000 | **PERCENT** | 45 | 16.4944 |
| `premium_qoq` | Decimal(8,4) | 10,000 | **PERCENT** | 37 | 60.7027 |
| `premium_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 13 | 19.5115 |
| `pat_qoq` | Decimal(8,4) | 10,000 | **PERCENT** | 37 | 81.4879 |
| `pat_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 13 | 61.9410 |

### `general_insurance_fundamentals`

| column | type | ceiling | unit | rows | max abs |
|---|---|---|---|---|---|
| `combined_ratio` | Decimal(8,6) | 100 | **FRACTION** | 16 | 1.225500 |
| `incurred_claim_ratio` | Decimal(8,6) | 100 | **FRACTION** | 16 | 0.986500 |
| `expenses_of_management_ratio` | Decimal(8,6) | 100 | **FRACTION** | 16 | 0.405000 |
| `net_retention_ratio` | Decimal(8,6) | 100 | **FRACTION** | 16 | 0.948600 |
| `solvency_ratio` | Decimal(8,4) | 10,000 | **MULTIPLE** | 16 | 4.2100 |
| `basic_eps` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 16 | 55.7400 |
| `diluted_eps` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 16 | 55.7400 |
| `face_value_share` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 0 | — |
| `book_value_per_share` | Decimal(10,4) | 10,00,000 | **RUPEES/share** | 16 | 1049.2990 |
| `roe` | Decimal(8,6) | 100 | **FRACTION** | 16 | 0.174168 |
| `net_underwriting_margin` | Decimal(8,6) | 100 | **FRACTION** | 16 | 0.225500 |
| `gpw_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 8 | 26.9688 |
| `pat_growth_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 8 | 40.0296 |

### `general_insurance_quarterly_results`

| column | type | ceiling | unit | rows | max abs |
|---|---|---|---|---|---|
| `combined_ratio` | Decimal(8,6) | 100 | **FRACTION** | 44 | 1.397700 |
| `incurred_claim_ratio` | Decimal(8,6) | 100 | **FRACTION** | 44 | 1.086600 |
| `expenses_of_management_ratio` | Decimal(8,6) | 100 | **FRACTION** | 44 | 0.434000 |
| `net_retention_ratio` | Decimal(8,6) | 100 | **FRACTION** | 44 | 0.958400 |
| `solvency_ratio` | Decimal(8,4) | 10,000 | **MULTIPLE** | 44 | 4.3200 |
| `net_underwriting_margin` | Decimal(8,6) | 100 | **FRACTION** | 44 | 0.397700 |
| `net_margin` | Decimal(8,4) | 10,000 | **PERCENT** | 44 | 24.2393 |
| `gpw_qoq` | Decimal(8,4) | 10,000 | **PERCENT** | 35 | 29.0601 |
| `gpw_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 13 | 38.5361 |
| `pat_qoq` | Decimal(8,4) | 10,000 | **PERCENT** | 35 | 1775.1741 |
| `pat_yoy` | Decimal(8,4) | 10,000 | **PERCENT** | 13 | 165.6684 |
