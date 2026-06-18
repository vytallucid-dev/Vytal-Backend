# VYTAL HEALTH SCORE — MARKET PILLAR: UNIVERSAL MECHANISM
## Complete specification — for v6.0 Master Spec §10 and the Architecture Chat (code build)
**Status: ratified design. This mechanism is UNIVERSAL and SUPERSEDES every per-PG Market section, band table, and sub-component variant in every Supplementary Spec. There are no per-PG Market cuts. There is no per-PG Market calibration done by hand. Every threshold is either a universal constant or computed at runtime by a universal formula from the peer group's own price pool.**
 
---
 
## 0. WHY THIS REPLACES THE OLD MARKET PILLAR
 
The old Market pillar was "four sub-components, per-PG hand-calibrated band cuts extracted from each spec." That produced: stale variants (PG8 substituted sub-components), generic-default cuts with no derivation (PG1, PG4), round-number cuts with post-hoc percentile annotation (PG3), and cuts that lived only in superseded documents (PG2 Rev2). It was inconsistent and unauditable.
 
This mechanism fixes the root cause: **Market measures price behaviour, which is either self-normalizing per stock (positioning, trend) or normalizable by a universal formula (relative strength, volatility). None of it requires hand-set per-PG numbers.** The pillar is built once, identically, for every stock. The only per-PG input is *which stocks are in the peer pool* — which comes from the (now-reconciled) database roster, not from any Market-specific calibration.
 
**Constitutional status:** universal method + universal thresholds where the metric is self-normalizing, + universal formula computing the sector reference at runtime where it isn't. This is *more* universal than Foundation/Momentum (which have per-PG bars) and matches the spirit of Ownership (fully central). An 80 on Market means the same thing in every PG because the entire mechanism is identical everywhere.
 
---
 
## 1. WHAT THE PILLAR MEASURES (the four questions)
 
Market is **20% of the composite** (locked, unchanged). It answers four conceptually-independent questions about a stock's price behaviour, capturing BOTH long-term positioning AND recent movement:
 
| Category | Question | Weight |
|---|---|---|
| **A — Positioning** | Where is the stock in its own price history, short and long? | 25% |
| **B — Trend & Momentum** | Which way is it moving, across medium, quarterly, and recent horizons? | 25% |
| **C — Relative Strength** | Has it out- or under-performed its sector? | 25% |
| **D — Risk** | How volatile is it relative to its sector? | 25% |
 
Equal weight across the four categories (see §6 for the weighting rationale and the override).
 
---
 
## 2. THE SEVEN SUB-COMPONENTS (categories → sub-components)
 
### CATEGORY A — PRICING POSITIONING (25%)
*Sustained strength: is the stock near its highs or its lows, recently and over years?*
 
**A1 — 52-Week Range Position** (12.5% of pillar)
- **Formula:** `position = (current_price − 52wk_low) / (52wk_high − 52wk_low)`, range [0,1]. Window: trailing 252 trading days.
- **Direction:** higher better. Self-normalizing (own range) → universal cuts.
**A2 — 3-Year Range Position** (12.5% of pillar)
- **Formula:** `position = (current_price − 3yr_low) / (3yr_high − 3yr_low)`, range [0,1]. Window: trailing 756 trading days (3 years).
- **Direction:** higher better. Self-normalizing → universal cuts.
- **Purpose (the rally-vs-weak distinction you asked for):** A2 is the long-horizon anchor. A stock that rallied hard then pulled back sits HIGH on A2 (near its multi-year high) but only MID on A1 (off its recent high) → reads as "strong, consolidating." A chronically weak stock sits LOW on both A1 and A2 → reads as "weak, not moving." The COMBINATION of A1 and A2 distinguishes these without a separate rule — that is exactly why both horizons are scored.
### CATEGORY B — TREND & MOMENTUM (25%)
*Direction across three time horizons.*
 
**B1 — Position vs 200-Day Moving Average** (8.33% of pillar)
- **Formula:** `pct = (current_price − 200DMA) / 200DMA × 100`. Window: 200 trading days.
- **Direction:** higher better. Self-normalizing (own MA) → universal cuts.
**B2 — 4-Quarter Trend Structure** (8.33% of pillar) — CATEGORICAL
- **Formula:** over the last 6 quarter-end closes, count higher-highs + higher-lows (HH/HL count, max 6). Map the count to a discrete state.
- **Direction:** categorical (no continuous cuts). Capped at 90 (see §4 saturation).
**B3 — Recent Movement** (8.33% of pillar)
- **Formula:** `standardized_move = 21d_return / (daily_vol × √21)`, where `21d_return = (price_t − price_{t−21}) / price_{t−21}` and `daily_vol` = stdev of daily log-returns over the trailing 90 days. This volatility-normalizes the recent move so a small move in a low-vol stock and a large move in a high-vol stock are scored by *significance*, not raw size.
- **Direction:** higher better. Volatility-normalized → universal cuts, sector-neutral.
### CATEGORY C — RELATIVE STRENGTH (25%)
*Out- or under-performance vs the sector.*
 
**C1 — 1-Year Relative Strength vs Sector** (25% of pillar)
- **Formula:** `RS = stock_1yr_return − sector_1yr_return` (in percentage points), where:
  - `stock_1yr_return = (price_t − price_{t−252}) / price_{t−252} × 100`
  - `sector_1yr_return = median(1yr_return of every stock in this stock's peer group)` — computed at runtime from the database roster's price pool. **Median, not mean** (robust to one peer's outlier move).
- **Direction:** higher better. Already sector-relative by construction → universal cuts.
- **Purpose:** directly answers "has it outperformed its peers." Subsumes PG8's old "1Y RS vs benchmark" as a universal sub-component.
### CATEGORY D — RISK (25%)
*Volatility relative to the sector's normal.*
 
**D1 — Volatility vs Sector** (25% of pillar)
- **Formula:** `ratio = stock_recent_vol / sector_baseline_vol`, where:
  - `stock_recent_vol` = annualized stdev of daily log-returns over the trailing 90 days.
  - `sector_baseline_vol` = **median of the 90-day annualized vols of every stock in the peer group, measured over a trailing 3-year window** (i.e. the sector's normal volatility regime). Computed at runtime from the roster's price pool.
- **Direction:** LOWER better (less volatile than sector normal = more stable = healthier positioning). Universal cuts on the ratio (the per-PG-ness is absorbed into the baseline).
- **Baseline refresh:** the `sector_baseline_vol` is recomputed **quarterly** (rolling 3-year window) so it tracks regime change (markets and sector vol regimes shift). Between refreshes it is a fixed constant. This is the "auto-resetting bar" — it lives inside the mechanism, recalculated on schedule, never hand-set.
---
 
## 3. SCORING — CUTS PER SUB-COMPONENT
 
All sub-components map to the **universal anchor scale: Distress 20 / Concerning 40 / Acceptable 60 / Good 75 / Excellent 90**, with piecewise-linear interpolation between adjacent cuts, and saturation per §4. Identical scale as the rest of the model (CN-1).
 
| Sub-comp | Metric | Distress(20) | Concerning(40) | Acceptable(60) | Good(75) | Excellent(90) | Dir |
|---|---|---|---|---|---|---|---|
| A1 | 52wk position | <0.20 | ≥0.20 | ≥0.40 | ≥0.60 | ≥0.80 | higher |
| A2 | 3yr position | <0.20 | ≥0.20 | ≥0.40 | ≥0.60 | ≥0.80 | higher |
| B1 | vs 200-DMA (%) | <−15 | ≥−15 | ≥−3 | ≥+3 | ≥+15 | higher |
| B2 | 4Q HH/HL count | ≤1 (trending down) | 2 (consol. down) | 3 (range) | 4 (consol. up) | ≥5 (trending up) | categorical |
| B3 | recent std. move | <−1.0 | ≥−1.0 | ≥−0.3 | ≥+0.3 | ≥+1.0 | higher |
| C1 | 1yr RS (pp) | <−20 | ≥−20 | ≥−5 | ≥+5 | ≥+20 | higher |
| D1 | vol ratio | >1.30 | ≤1.30 | ≤1.15 | ≤0.85 | ≤0.70 | lower |
 
**Interpolation:** between two adjacent cuts, the score interpolates linearly on the metric value (e.g. a 52wk position of 0.70 sits halfway between Good-cut 0.60→75 and Excellent-cut 0.80→90 → scores 82.5). Identical mechanic to Lens 1.
 
---
 
## 4. SATURATION (§10.5)
 
Above Excellent and below Distress, continuous sub-components saturate at **±10 points per band-width**, clamped to [0,100]. A "band-width" is the metric distance between the Excellent and Good cuts (above) or Distress and Concerning cuts (below).
 
- **Saturating sub-components (reach 100 / floor 0):** A1, A2, B1, B3, C1, D1.
- **B2 (4Q trend) is CAPPED at 90** — it is a discrete categorical state with no continuous metric to interpolate above; it cannot exceed Excellent. Documented exception (unchanged from §10.5 ruling).
Example: A1 at position 1.0 → above the 0.80 Excellent cut by one band-width (0.80→1.00) → saturates 90→100. D1 at ratio 0.55 → below the 0.70 Excellent cut → saturates toward 100.
 
---
 
## 5. PILLAR ASSEMBLY
 
```
Market pillar score =
    0.25 × [ 0.5×A1 + 0.5×A2 ]                    (Category A, equal within)
  + 0.25 × [ (1/3)×B1 + (1/3)×B2 + (1/3)×B3 ]     (Category B, equal within)
  + 0.25 × [ C1 ]                                  (Category C)
  + 0.25 × [ D1 ]                                  (Category D)
```
 
Resulting effective sub-component weights of the pillar: A1 12.5%, A2 12.5%, B1 8.33%, B2 8.33%, B3 8.33%, C1 25%, D1 25%. Pillar score is then 20% of the composite.
 
---
 
## 6. THE ONE WEIGHTING JUDGMENT (disclosed, overridable)
 
**Equal weight across the four categories (25% each) is the chosen default.** This is a *structural* choice — the four categories are conceptually independent questions, and privileging none of them is the non-judgment position at the category level. It is NOT eyeball per-metric weighting (the kind rejected for PG1); it is "no category is more important than another."
 
Consequence: C1 (relative strength) and D1 (volatility) each carry 25% of the pillar as single-metric categories, because "outperformance vs sector" and "risk" are each singular concepts, while positioning and trend each decompose into multiple facets. This deliberately gives relative strength meaningful weight (it directly answers "did it beat its peers," a signal of real importance).
 
**Override available:** if equal-across-all-seven-sub-components (≈14.3% each) is preferred, that drops C1 and D1 to 14.3% and raises the positioning/trend facets. This is the only place a weighting decision is made; everything else is mechanical. Default stands at equal-by-category unless overridden.
 
---
 
## 7. DATA REQUIREMENTS & GATES
 
### 7.1 Data
- **5–6 years of daily split/bonus-adjusted closing prices per stock** (already the data feed). 3yr minimum for full functionality; degraded gracefully below (see exclusion).
- **The peer pool comes from the database roster** (the reconciled rosters). C1's sector return and D1's sector baseline are computed from the roster's stocks. No benchmark index required — the sector reference IS the peer pool.
### 7.2 Split/bonus adjustment — MANDATORY pre-clean
Volatility (D1, B3) and positioning (A1, A2) are corrupted by unadjusted splits/bonuses — an unadjusted 1:2 split looks like a 50% one-day crash, spiking volatility and distorting range position. **The price feed MUST be split/bonus-adjusted before any Market computation.** Yahoo Finance adjustment is unreliable for recently-split Indian stocks — apply a split-correction pass and validate (flag any single-day move > 25% for split-check). This is the single highest silent-corruption risk in the pillar.
 
### 7.3 Minimum-history gates (sub-component level)
A sub-component is **excluded** (not scored on thin data) if its window can't be filled:
- A1, B1, C1: need ≥ 252 trading days.
- A2: needs ≥ 756 trading days (3yr). If a stock has 1–3yr history, A2 is excluded; A1 still scores.
- B2: needs ≥ 7 quarter-end closes.
- B3, D1: need ≥ 90 trading days.
- D1 sector baseline: needs ≥ 4 peer stocks each with ≥ 90 days; if the pool is too thin, D1 excluded for the whole PG that period.
### 7.4 Exclusion & renormalization (§14.4 mechanic, at sub-component AND pillar level)
- If a sub-component is excluded, its category renormalizes across the surviving sub-components (e.g. A1 present, A2 excluded → Category A = A1 at full 25%).
- If a whole category has no scoreable sub-component, the pillar renormalizes across the surviving categories.
- If **fewer than 2 of the 4 categories** can score (e.g. a stock with < 90 days of history), the **Market pillar is excluded entirely** and the composite renormalizes the remaining three pillars pro-rata (Foundation 0.35 / Momentum 0.25 / Ownership 0.20 → rescaled to sum to 1). This is the same mechanic that handled the FY21-22 thin-price-window exclusions. Market exclusion is a labeled, visible state — never a silent zero.
---
 
## 8. REFRESH CADENCE
 
- **A1, A2, B1, B2, B3, C1 (stock-own and relative):** recomputed live on every price update (continuous), and locked at each quarterly snapshot.
- **D1 stock_recent_vol:** recomputed live.
- **D1 sector_baseline_vol:** recomputed **quarterly** on a rolling 3-year window. This is the only "bar-like" constant in the pillar, and it auto-resets quarterly so it tracks the sector's evolving volatility regime. It is never hand-set.
- **C1 sector_1yr_return:** recomputed live from the current roster pool (it is a median of current peer returns, not a stored constant).
---
 
## 9. HOW THIS ADDRESSES YOUR REQUIREMENTS (explicit mapping)
 
- **"Long-term positioning AND recent":** A2 (3yr) + A1 (52wk) cover positioning across horizons; B1 (200-DMA medium) + B2 (quarterly) + B3 (1-month recent) cover trend across horizons. Both long and short are scored.
- **"Is the stock up from previous years, rally-then-consolidation vs weak-and-flat":** the A1/A2 combination, by design (§2 Category A purpose). High-A2/mid-A1 = rallied-and-consolidating; low-A1/low-A2 = chronically weak. Distinguished without a bespoke rule.
- **"How it performed sector-relative, outperformed peers or not":** C1, 1-year relative strength vs the peer median, weighted at a full 25% of the pillar.
- **"Recent movement":** B3, volatility-normalized 1-month move.
- **"Universal, formula-driven, override every PG's findings":** the entire mechanism is universal; the only per-PG input is the roster pool; it replaces all per-PG Market sections wholesale.
---
 
## 10. WHAT THIS SUPERSEDES (the cleanup)
 
On adoption, ALL of the following are **discarded** — no extraction, no per-PG Market work remains:
- Every PG's per-PG Market band table (§10.4 cuts in every Supplementary Spec).
- PG8's substituted sub-components (Drawdown-from-5Y-ATH, 1Y-RS) — their *concepts* are now universal (A2-style positioning, C1 relative strength); the PG8-specific bars are discarded.
- PG1 / PG4 generic-default cuts — moot.
- PG3 round-number-with-annotation cuts — moot.
- PG2 Rev2-resident cuts — moot, no longer needed.
- The "extract per-PG Market cuts" workstream — deleted entirely.
- Per-PG Market re-derivation (PG1/PG4/PG8 gating) — no longer needed; all PGs use this mechanism directly.
PG8's earlier "non-compliant substitution" is retroactively vindicated in spirit: it was measuring the right things (long-term drawdown, relative strength); it was only wrong to do so unilaterally. Those signals are now universal for every PG.
 
---
 
## 11. NON-NEGOTIABLES PRESERVED
 
- **CN-1:** identical mechanism, identical cuts (or identical formula), every PG. An 80 on Market means the same health everywhere.
- **CN-4:** every threshold is a universal constant or a formula output from data; zero analyst judgment in the scoring engine (the one weighting choice, §6, is a disclosed structural default, not per-stock tuning).
- **CN-10 (health ≠ price):** Market is explicitly a *positioning/technical* read, backward-looking by construction. It is one of four pillars at 20%; it does not turn the Health Score into a price predictor. A stock at its highs scores well on positioning — that is a true statement about current technical health, not a buy signal. (The known limitation — Market reads favourably at peaks and unfavourably at troughs — is inherent and accepted; it is why Market is only 20% and why Foundation/Momentum/Ownership carry the fundamental signal.)
- **Cyclicality:** Market reads cyclical strength (near highs, outperforming) and cyclical weakness (near lows, underperforming) honestly, both directions. It never smooths cyclicality.
---
 
## 12. OPEN ITEMS / DECISIONS FOR RATIFICATION
 
1. **§6 weighting:** confirm equal-by-category (default) vs equal-across-seven. Default stands unless overridden.
2. **A2 window:** confirmed 3 years. (5yr alternative noted — 3yr chosen for responsiveness.)
3. **D1 baseline refresh:** confirmed quarterly rolling 3-year. (Annual is the slower alternative; quarterly chosen to track regime change.)
4. **B3 window:** confirmed 21-day (1 month) volatility-normalized. 
5. These windows (252/756/200/90/21) are universal constants, not per-PG — confirm they are sensible defaults; they are the only "magic numbers" and they are identical for every stock.
---
*Universal Market Pillar Mechanism · supersedes all per-PG Market sections · for v6.0 §10 and Architecture Chat code build · Vytal Health Score*