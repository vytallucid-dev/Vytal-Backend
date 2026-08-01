# Finding copy vs. what the rule actually fires on

**Review complete, and the 18 findings it turned up have been corrected.** This document is now both the audit and the record of what changed: for every finding, the copy as it ships today, the trigger read out of the rule body, and — where they disagreed — what was wrong and how it was resolved.

★ **One rule governed every correction: the DESCRIPTION moved, never the RULE.** A copy change describes the engine differently; a rule change makes the engine behave differently, and would silently move live scores and re-fire findings across the universe. All 18 were adjudicated first, and all 18 were description errors. Three rules are flagged below as worth a look — none was touched.

_Generated from the shipped catalogue and the live database. Scored universe at time of writing: **95 companies**. Re-run `src/scripts/_content-review-doc.ts` to refresh._

---

## Why this document exists

Every gate built around this copy proves **presence** (a key with no description is a compile error), **register** (no advice words, no prediction) and **consistency** (the frontend fallback is byte-identical to the backend catalogue, enforced in CI). Not one of them checks whether a description is **true of the rule it describes**.

So all 35 stock-finding descriptions are enforced-present and unverified-correct. This document puts the shipped sentence next to the trigger read out of the rule body, for all 35, and names the ones where they disagree.

**Method.** The name, description and doesn't-mean columns are pulled from `STOCK_FINDINGS` at generation time — not retyped — so they are exactly what ships. The firing column is a live query against the latest quarterly snapshot per company. The trigger column is hand-read from each rule **body**, never its header comment.

That last point is not pedantry, and the review found the case that proves it: `rules/p7-accruals.ts` described its trigger as "operating cash backs **< 70%** of profit" while the constant six lines below read `P7_CASH_BACK_MAX = 0.50`. A reviewer working from headers would have confirmed P7's copy against a threshold the engine had abandoned, and signed it off. That comment is now fixed — see below.

### Verdicts at a glance

| | Count | Meaning |
|---|---:|---|
| ✅ matches | 29 | The description describes what the rule fires on. |
| ⚠ imprecise | 0 | Directionally right; a word or a magnitude would mislead a careful reader. |
| ❌ mismatch | 0 | The description asserts something the rule does not do. |
| 📝 matches · open question | 6 | The copy is now right. Something *around* it still needs a decision — a rule that may be incomplete, or a threshold the copy is pinned to that may move. |

All 35 entries now describe what their rule fires on. The 18 corrections are recorded inline: each carries the defect that was found and the ruling that resolved it.

### The three rules worth a look — reported, deliberately not changed

1. **H · Ownership Events** — the strongest case for the *rule* being incomplete rather than the copy. Its old description promised "or a material change in pledged shares"; `ruleH` reads the block-deal feed and has no pledging input at all. Pledging is currently reachable only through R1 (crisis level) and N7 (release), so a mid-sized pledge move surfaces nowhere. The copy now describes the one input that exists.
2. **P5 · Insider-Confirmed Distress** — the rule gates on the overall composite being weak, but the finding is named for ownership, bucketed under ownership, and was described as corroborating the shareholding data. Either the name and bucket, or the gate, is the odd one out.
3. **P11 / P13 · provisional constants** — both rules declare their own thresholds provisional (P11's header intends to raise 2 → 3 once deeper margin history lands). Their descriptions now name the current bars, so a future constant change has to move the copy and the `BAR_NAMING` gate row with it.

### One stale header comment, and why it mattered

A sweep of all 33 rule files found exactly one header comment disagreeing with its own constant: `rules/p7-accruals.ts` described the trigger as "operating cash backs **< 70%** of profit" while `P7_CASH_BACK_MAX` six lines below read `0.50`. The bar had been lowered (0.70 fired on 15 names, mostly routine working-capital timing) and the comment was never updated. It is corrected, with a note pairing it to the catalogue description.

That single line is the reason this whole review was worth running: a reviewer working from headers would have confirmed P7's copy against a bar the engine had abandoned, and signed it off.

### The gate was pinning six of the wrong bars

`verify-catalogue.ts §7` asserts that nine descriptions still NAME their trigger bar — the protection against someone quietly "harmonising" the finding bars down to the guardrail registry's no-digits rule. It works, and it never once proved the bars were **correct**: each regex was transcribed from the very description it checks, so copy and assertion drifted from the engine together and the gate stayed green throughout.

Six of the nine rows were pinning wrong text — R3, R4, R5, P11, P12 and P13. All six are repointed at the corrected wording, and the section now carries a warning that the rule body, not the row, is the authority.

---

## Scope of this pass — and what still needs its own

The catalogue has **four registries**. This pass covers one of them in full.

| Registry | Entries | In this pass? | Why |
|---|---:|---|---|
| `stock_finding` | 35 | **Yes — all 35** | One rule body per key, each a threshold test over a company's own data. The method (read the body, state the trigger) applies cleanly. |
| `lens_face` | 14 | **No — needs its own pass** | LM1–LM8 / LP1–LP6 do not have FireRule bodies. A face fires on a *combination of three lens STATES* (above/below bar × above/near/below peers × improving/flat/declining), and the LP faces on pass-share fractions across a whole pillar. The reviewer's question is different — "does this sentence describe that state combination?" — and the source is `scoring/lens-patterns/` plus `docs/Vytal_Three_Lens_Pattern_Library_v1.md`. **Priority: the four that escalate into findings** (LM3, LM7, LP2, LP5) — those render on the Hub census board, so a wrong description there reaches the same surface as a stock finding. Live now: LM3 across 12 metric keys (45 firings), LM7 across 1 (2), LP2 across 2 (3), LP5 across 1 (2). The other ten faces never escalate — they render as per-stock pillar-breakdown pills only. |
| `phs_finding` | 58 | **No — needs its own pass** | Portfolio findings are a separate engine (`portfolio/phs/`) over a book, not a company: different evidence shapes, a different band ladder (Weak/Fragile/Mixed/Steady/Strong) and a different vocabulary. Reviewing them alongside stock findings would invite exactly the ladder confusion the product works hard to keep apart. Largest of the four — budget accordingly. |
| `guardrail_signature` | 11 | **No — and the question is a different one** | By deliberate policy **not one of these strings contains a digit**, because guardrail thresholds ARE gameable (they detect manipulated reporting) whereas finding bars read filed disclosures that cannot be restructured to duck them. Both sides are asserted in `verify-catalogue.ts §7`. So "does the description name the right number?" is inapplicable by design; the reviewable question is "does the qualitative sentence describe the right *shape* of detection?" That needs the guardrail design doc open alongside. |

---

## The 35 stock findings

### Family A · Critical red flags

#### Pledging Crisis <sub>✅ matches</sub>

`ownership_R1_pledge` · concern **ownership** · status **live**

**Description, as it ships**
> Promoters have pledged more than half their stake as loan collateral, or sharply increased what's pledged in a single quarter. Pledged shares can be sold by the lender if the loan sours, so heavy pledging is a financing-stress signal about the promoters.

**Doesn't-mean, as it ships**
> …a hard risk/quality warning to investigate — not a prediction the stock will fall.

**What the rule actually fires on** — `scoring/ownership/pledging.ts (not a FireRule — written by the ownership persist path)`
> In the latest shareholding quarter, EITHER the pledge ratio (pledged promoter shares ÷ promoter shares) is above 50%, OR that ratio rose by 10pp or more versus the prior quarter. Either alone is enough. A company with no promoter holding has no ratio and cannot fire.

**Firing now**

`critical` × 1 — ASHOKLEY

---

#### Promoter Exit <sub>✅ matches</sub>

`ownership_R2_promoter_exit` · concern **ownership** · status **live**

**Description, as it ships**
> Promoter holding fell by more than 5 percentage points between one shareholding filing and the next — and not because of a fundraise that diluted everyone. The people who run the company reduced their own ownership materially and quickly.

**Doesn't-mean, as it ships**
> …a hard risk/quality warning to investigate — not a prediction the stock will fall.

**What the rule actually fires on** — `rules/r2-promoter-exit.ts → ownership/disturbances.ts computeR2`
> Promoter holding % fell by strictly more than 5pp between the latest two shareholding rows, AND a structural dilution check does not explain it (promoter share COUNT stable while total shares rose ⇒ QIP / rights / preferential ⇒ suppressed). Fires on verdict genuine_reduction or indeterminate.

**Firing now**

`critical` × 1 — NHPC

**What was wrong** — "in a single quarter" is not guaranteed. The rule compares the latest two AVAILABLE shareholding rows; when a filing is missing that span covers more than one quarter. The rule itself records this as `spansQuarterGap` — the description does not.

**Resolved** — Now reads "between one shareholding filing and the next". DESCRIPTION was wrong; the rule is right — comparing the latest two available rows is the only thing it can do, and it already records `spansQuarterGap` when they are not adjacent.

---

#### Earnings Quality Breakdown <sub>✅ matches</sub>

`foundation_R3_earnings_quality` · concern **fundamentals** · status **live**

**Description, as it ships**
> Reported net profit has exceeded operating cash flow for four or more consecutive years. Profit is being booked that the business isn't converting into cash, and the gap has persisted long enough to be structural rather than timing.

**Doesn't-mean, as it ships**
> …a hard risk/quality warning to investigate — not a prediction the stock will fall.

**What the rule actually fires on** — `rules/r3-earnings-quality.ts`
> Net profit exceeded operating cash flow in 4 or more consecutive ANNUAL periods ending at the latest year. Banking is out of scope. With fewer than 4 annual rows the rule records "could not check", not "false".

**Firing now**

_Not firing on any company today._

**What was wrong** — "four or more consecutive periods" reads as quarters to most readers. The rule is annual-only — there is no quarterly operating-cash-flow column, so TTM is not derivable. Four consecutive YEARS is a far stronger and rarer claim than four quarters; the word doing the work is missing.

**Resolved** — "periods" became "years". DESCRIPTION was wrong; the rule is right. It is annual-only because there is no quarterly operating-cash-flow column to build a TTM from — a narrower implementation than File 1 intended, documented in the rule, not drift.

---

#### Debt Explosion <sub>✅ matches</sub>

`foundation_R4_debt_explosion` · concern **fundamentals** · status **live**

**Description, as it ships**
> Debt-to-equity has crossed 3× for the first time in the company's recent annual accounts — no earlier year on file breached it. The balance sheet has taken on leverage well beyond anything in that history.

**Doesn't-mean, as it ships**
> …a hard risk/quality warning to investigate — not a prediction the stock will fall.

**What the rule actually fires on** — `rules/r4-debt-explosion.ts`
> Latest annual debt-to-equity ((current + non-current borrowings) ÷ net worth) is above 3.0, AND no year in the preceding window breached 3.0 — the FIRST breach only. Banking out of scope; needs at least one known prior year.

**Firing now**

_Not firing on any company today._

**What was wrong** — "for the first time in five years" describes the last FIVE ANNUAL ROWS THE COMPANY HAS, not five calendar years. The rule fires with as few as two rows. On the current ingested history (~2–3 years for most names) the sentence claims a lookback the data cannot support.

**Resolved** — Now reads "for the first time in the company's recent annual accounts — no earlier year on file breached it". DESCRIPTION was wrong; the rule is right. It cannot check years it does not hold, and the new wording is true at any history depth.

---

#### Interest Coverage Collapse <sub>✅ matches</sub>

`foundation_R5_interest_coverage` · concern **fundamentals** · status **live**

**Description, as it ships**
> Earnings before interest and tax have covered interest costs less than 1.5 times, measured over the trailing twelve months, for two consecutive quarters. The company is earning barely more than it owes its lenders.

**Doesn't-mean, as it ships**
> …a hard risk/quality warning to investigate — not a prediction the stock will fall.

**What the rule actually fires on** — `rules/r5-interest-coverage.ts`
> Trailing-twelve-month interest coverage — (Σ profit-before-tax + Σ interest) ÷ Σ interest over 4 contiguous quarters — below 1.5× for 2 consecutive TTM windows. Banking out of scope. A debt-free company (Σ interest ≤ 0) is a genuine non-fire, not a data gap.

**Firing now**

`critical` × 1 — GLENMARK

**What was wrong** — Two small things. (1) "Operating profit" is not what the numerator is: it is EBIT derived as PBT + finance costs, which INCLUDES other income. (2) "two or more consecutive quarters" is two overlapping TTM windows, i.e. five quarters of data — not two quarters of trading.

**Resolved** — "Operating profit" became "Earnings before interest and tax", and the trailing-twelve-month basis is now stated. DESCRIPTION was wrong; the rule is right — its numerator deliberately matches the engine's own F5 interest-coverage metric rather than inventing a second definition.

---

#### Distribution Pattern <sub>✅ matches</sub>

`ownership_R6_distribution` · concern **ownership** · status **live**

**Description, as it ships**
> In the same quarter, promoters reduced, foreign institutions reduced, and retail holding rose. The better-informed owners sold and smaller shareholders absorbed the shares.

**Doesn't-mean, as it ships**
> …a hard risk/quality warning to investigate — not a prediction the stock will fall.

**What the rule actually fires on** — `rules/r6-distribution.ts → ownership/disturbances.ts computeR6`
> Between the latest two shareholding rows: promoter % fell, FII % fell, and retail % rose — each move at least a 0.05pp noise floor. All three conditions in the same comparison.

**Firing now**

`critical` × 3 — DIXON, INFY, SBIN

---

### Family E · Patterns

#### Clean Institutional Rotation <sub>✅ matches</sub>

`ownership_P1_clean_rotation` · concern **ownership** · status **dormant**

**Description, as it ships**
> Domestic institutions bought meaningfully while foreign institutions trimmed only slightly, with promoter holding essentially unchanged. Ownership changed hands between professional investors rather than being distributed outward.

**Doesn't-mean, as it ships**
> …a condition to look at — not a trade signal.

**What the rule actually fires on** — `rules/p1-clean-rotation.ts → ownership/flow.ts computeCategoryB, rule B1`
> DII rose by 1.0pp or more, FII fell by an amount INSIDE the band 0.05pp–0.5pp, and |promoter change| ≤ 0.5pp.

**Firing now**

_Not firing on any company today._

**What was wrong** — "foreign institutions sold" inverts the actual condition at the top end. The FII decline must be SMALL — a fall of more than 0.5pp DISQUALIFIES the pattern. A reader told "DII bought while FII sold" will assume a large FII exit is the strongest case for this pattern; it is the one case that cannot fire it.

**Resolved** — "foreign institutions sold" became "trimmed only slightly". DESCRIPTION was wrong; the rule is right — the upper bound on the FII decline is what makes the rotation "clean". A large FII exit is a different phenomenon and belongs to P4 / R6.

---

#### Dual Institutional Exit <sub>✅ matches</sub>

`ownership_P4_dual_exit` · concern **ownership** · status **dormant**

**Description, as it ships**
> Both foreign and domestic institutions reduced their holdings in the same period. Two independent sets of professional investors stepped back at the same time.

**Doesn't-mean, as it ships**
> …a condition to look at — not a trade signal.

**What the rule actually fires on** — `rules/p4-dual-exit.ts → ownership/flow.ts computeCategoryB, rule B4`
> FII fell by 0.5pp or more AND DII fell by 0.5pp or more, in the same quarter.

**Firing now**

_Not firing on any company today._

---

#### Insider-Confirmed Distress <sub>📝 matches · open question</sub>

`ownership_P5_insider_distress` · concern **ownership** · status **dormant**

**Description, as it ships**
> The people closest to the company have been selling their own holdings, at a company whose overall health already reads weak. Insider selling into existing weakness reads differently from a routine trim on a sound business.

**Doesn't-mean, as it ships**
> …a condition to look at — not a trade signal.

**What the rule actually fires on** — `rules/p5-insider-distress.ts`
> The stock's COMPOSITE is below 62, AND over the trailing 90 days promoter- or director-role sell transactions of ≥₹1cr each net to ≥₹2cr sold by at least one distinct insider.

**Firing now**

_Not firing on any company today._

**What was wrong** — The description says the selling confirms "the ownership stress already visible in the shareholding data". It does not. The confirming gate is the OVERALL COMPOSITE being below the Steady floor — which can be driven entirely by Foundation, Momentum or Market with the shareholding data completely clean. The description names the wrong thing as the corroboration.

**Resolved** — Now reads "at a company whose overall health already reads weak". DESCRIPTION was wrong; the rule matches its OWN stated intent (its header calls the composite gate "what makes it confirmed distress").

📝 **Still worth a look, and left alone deliberately.** The finding is named "Insider-Confirmed Distress", sits in the *ownership* concern bucket, and its old description claimed the shareholding data corroborates. That is the reading its name invites — and it is not what the rule does. Either the name and bucket, or the gate, is the odd one out. A rule change moves scores, so this build corrected the copy and stopped there.

---

#### Insider Conviction <sub>✅ matches</sub>

`ownership_P6_insider_conviction` · concern **ownership** · status **live**

**Description, as it ships**
> Directors and key management have been buying their own stock. The people running the business day to day added to their own positions.

**Doesn't-mean, as it ships**
> …a condition to look at — not a trade signal.

**What the rule actually fires on** — `rules/p6-insider-conviction.ts`
> Over the trailing 90 days, DIRECTOR-role transactions of ≥₹1cr each net to ≥₹2cr bought, by at least one distinct director.

**Firing now**

`green` × 2 — TATACONSUM, WIPRO

**What was wrong** — "Company insiders" over-claims. Promoters are deliberately excluded — they belong to P10, so the two never double-count the same trade. The rule reads directors/KMP only. The per-stock verdict sentence says "directors/KMP" correctly; this static description, which is what shows on the Hub census board, does not.

**Resolved** — "Company insiders" became "Directors and key management". DESCRIPTION was wrong; the rule is right — promoters are excluded on purpose so P6 and P10 never count the same trade twice.

---

#### Accruals Divergence <sub>✅ matches</sub>

`foundation_P7_accruals` · concern **fundamentals** · status **live**

**Description, as it ships**
> Operating cash flow covered less than half of reported profit in the latest financial year. Earnings are being recognised well ahead of the cash behind them actually arriving.

**Doesn't-mean, as it ships**
> …a condition to look at — not a trade signal.

**What the rule actually fires on** — `rules/p7-accruals.ts`
> In the latest ANNUAL period: net profit > 0 and operating cash flow is below 50% of net profit — and the annual exceptional-item guard finds the year's profit is not one-off-distorted. Banking out of scope.

**Firing now**

`red` × 11 — ACC, BEL, BLUESTARCO, COCHINSHIP, DALBHARAT, DIXON, GRSE, MAZDOCK, SIEMENS, TATAPOWER, VOLTAS

**What was wrong** — "Reported profit is running ahead of cash generation" is directionally right but carries no magnitude, and the magnitude IS the rule — the bar is half. A company converting 60% of profit to cash reads as "running ahead" in plain English and does not fire. (Related: R3 is the persistence twin; P7 is the magnitude one. Neither description says so, and a reader seeing both will not know why.)

**Resolved** — Now names the bar: "covered less than half of reported profit in the latest financial year". DESCRIPTION was wrong; the rule is right. ⚠ Its HEADER COMMENT was also wrong — it read 70% above a 0.50 constant — and has been corrected in the same build.

---

#### Capital Tied in Receivables <sub>✅ matches</sub>

`foundation_P8_receivables` · concern **fundamentals** · status **live**

**Description, as it ships**
> Money owed by customers grew far faster than revenue over the latest financial year. A growing share of the company's capital is sitting in receivables rather than working in the business.

**Doesn't-mean, as it ships**
> …a condition to look at — not a trade signal.

**What the rule actually fires on** — `rules/p8-receivables.ts`
> Year on year, in the latest annual period: receivables grew 10% or more, receivables are at least 5% of revenue, AND receivables growth exceeded revenue growth by 15pp or more.

**Firing now**

`amber` × 16 — ACC, BEL, COCHINSHIP, CROMPTON, DALBHARAT, GLENMARK, GRSE, JSWSTEEL, LTM, MANKIND, MAZDOCK, OIL, ONGC, POWERGRID, SHREECEM, VOLTAS

**What was wrong** — "Receivable days are climbing faster than revenue" — the rule never computes receivable days. It compares the growth RATE of the receivables BALANCE against the growth RATE of revenue. "Days climbing faster than revenue" is also not a coherent comparison (a ratio's growth against a level's growth). The second sentence — capital sitting in money customers owe — is accurate; the first is not.

**Resolved** — "Receivable days" became "Money owed by customers", and the annual grain is stated. DESCRIPTION was wrong; the rule is right — comparing balance growth against revenue growth is the more robust measure, and "days" was never computed.

---

#### Promoter Defense Buying <sub>✅ matches</sub>

`ownership_P10_promoter_defense` · concern **ownership** · status **live**

**Description, as it ships**
> Promoters bought their own stock at a time when its share price was not reading strongly. The people who control the company added to their stake while the market was unenthusiastic about it.

**Doesn't-mean, as it ships**
> …a condition to look at — not a trade signal.

**What the rule actually fires on** — `rules/p10-promoter-defense.ts`
> The Market pillar is below 72 (or unavailable), AND over the trailing 90 days promoter-role transactions of ≥₹1cr each net to ≥₹2cr bought, with at least one buy.

**Firing now**

`green` × 1 — HCLTECH

**What was wrong** — BOTH factual claims in the description are wrong. (1) "through block deals" — the rule reads the INSIDER-TRANSACTION feed, not the block/bulk-deal feed. Block deals are finding H, and the score-side equivalent is Ownership Flow category D; the rule file separates them explicitly so they never double-count. (2) "while the price sat near a multi-quarter low" — no price low is tested. The gate is the Market PILLAR SCORE being under its strong mark, and that score blends range position, trend, relative strength versus sector and volatility. A stock well off its lows can score Market < 72 and fire this.

**Resolved** — Both false claims removed: no block deals, no price low. Now "at a time when its share price was not reading strongly". DESCRIPTION was wrong on both counts; the rule is right, and its header already documented the feed split from H and the Market-pillar gate.

---

#### Quarterly Margin Compression <sub>📝 matches · open question</sub>

`momentum_P11_margin_compression` · concern **momentum** · status **live**

**Description, as it ships**
> Operating margin has fallen for two or more consecutive quarters. Profitability is eroding across successive quarters rather than dipping in a single soft one.

**Doesn't-mean, as it ships**
> …a condition to look at — not a trade signal.

**What the rule actually fires on** — `rules/p11-margin-compression.ts (series built by findings/context.ts opmSeriesFromQuarters)`
> Single-quarter operating margin (operating profit ÷ revenue) fell in 2 or more consecutive quarter-on-quarter steps ending at the latest quarter — i.e. three or more margin points — and the latest quarter is not flagged as an exceptional-item distortion.

**Firing now**

`red` × 10 — ACC, BEL, EICHERMOT, GAIL, ITC, JSWENERGY, M&M, ONGC, TATACONSUM, TORNTPHARM

**What was wrong** — Two errors in one sentence. (1) The threshold is TWO consecutive declines, not "three or more". (2) The series is SINGLE-QUARTER operating margin, not "trailing-twelve-month windows" — opmSeriesFromQuarters divides one quarter's operating profit by the same quarter's revenue. The description's reassurance, "a sustained trend, not a single soft quarter", is therefore weaker than it reads: the minimum firing case is two consecutive quarterly dips.

**Resolved** — Both errors fixed: "three or more" became "two or more", and "trailing-twelve-month windows" became "quarters". DESCRIPTION was wrong; the rule is right.

📝 **Coupling to watch.** The rule declares itself provisional — its header says "raise to 3 once deeper OPM history is ingested". If P11_MIN_DECLINES moves, this description, P12's mirror, and the BAR_NAMING row in verify-catalogue.ts must all move with it. Three places, one constant.

---

#### Quarterly Margin Recovery <sub>✅ matches</sub>

`momentum_P12_margin_recovery` · concern **momentum** · status **live**

**Description, as it ships**
> Operating margin has risen for two or more consecutive quarters from a recent trough. Profitability has turned up off a low.

**Doesn't-mean, as it ships**
> …a condition to look at — not a trade signal.

**What the rule actually fires on** — `rules/p12-margin-recovery.ts`
> Single-quarter operating margin rose in 2 or more consecutive steps ending at the latest quarter; the trough is not negative and not a flagged exceptional-charge quarter; and the latest annual period does not fire an exceptional-GAIN guard.

**Firing now**

`green` × 13 — CIPLA, COCHINSHIP, GODREJCP, HAL, HINDZINC, INFY, JSWSTEEL, LTM, NATIONALUM, PETRONET, POLYCAB, SAIL, TATAPOWER

**What was wrong** — The count ("two or more") is right. The grain is not: "trailing-twelve-month windows" should be quarters — same error as P11, and the two need fixing together since they are written as mirrors.

**Resolved** — "trailing-twelve-month windows" became "quarters". DESCRIPTION was wrong; the rule is right. Paired with P11 — they are written as mirrors and now share the corrected grain.

---

#### TTM Revenue Inflection <sub>📝 matches · open question</sub>

`momentum_P13_revenue_inflection` · concern **momentum** · status **live**

**Description, as it ships**
> The trailing-twelve-month revenue growth rate changed by at least 5 percentage points against the prior quarter's — a clear acceleration or deceleration in the pace of growth.

**Doesn't-mean, as it ships**
> …a condition to look at — not a trade signal.

**What the rule actually fires on** — `rules/p13-revenue-inflection.ts`
> The latest TTM year-on-year revenue growth RATE differs from the prior quarter's TTM growth rate by 5pp or more in absolute terms. Accelerating ⇒ green/positive; decelerating ⇒ red/negative. Needs 9 contiguous quarters of revenue. Banking out of scope.

**Firing now**

`green` × 1 — POWERINDIA<br>`red` × 1 — BDL

**What was wrong** — The description states "at least 3 percentage points". The engine constant is P13_INFLECTION_PP = 5. This is the sharpest mismatch in the registry, because it is a NUMBER: the catalogue deliberately permits nine descriptions to name their trigger bar (those bars read filed public disclosures and cannot be gamed), so a reader is invited to trust it, and it is 40% below the real one. See also Part 4 — this is the only finding whose severity crosses the constructive/concern line.

**Resolved** — "at least 3 percentage points" became "at least 5", matching P13_INFLECTION_PP. DESCRIPTION was wrong; the rule is right.

📝 **Coupling to watch.** The constant is marked provisional in the rule, and this is one of the nine descriptions permitted to name its bar — so the copy is now pinned to a number that may deliberately move. If it does, change the description and the BAR_NAMING row together. P13 is also the split candidate — see REVIEW_p13_split.md.

---

### Family B · Deterioration

#### Deterioration from a High Base <sub>✅ matches</sub>

`trajectory_B_deterioration` · concern **trajectory** · status **live**

**Description, as it ships**
> The composite, or one pillar, has crossed down out of strong territory and stayed there across at least two snapshots. A company that was solid is sliding — a change in risk profile that usually shows up before price reacts.

**Doesn't-mean, as it ships**
> …review your thesis, not sell — an early risk read, not a price call.

**What the rule actually fires on** — `rules/b-deterioration.ts`
> The composite crossed DOWN through 68 (out of Healthy); or sits in 68–74 having crossed DOWN through 74 (out of Pristine); or any pillar crossed down through its own strong mark. The cross must have held for at least 2 snapshots and be recent.

**Firing now**

`high` × 42 — ABB, ACC, AMBUJACEM, AXISBANK, BDL, BLUESTARCO, BPCL, BRITANNIA, DALBHARAT, DIXON, GODREJCP, HDFCBANK, HINDALCO, HINDPETRO, HINDUNILVR, HINDZINC, INFY, IOC, ITC, JINDALSTEL, JKCEMENT, JSWSTEEL, KOTAKBANK, M&M, MAZDOCK, NESTLEIND, NHPC, NTPC, PETRONET, RAMCOCEM, RELIANCE, SAIL, SHREECEM, TATACONSUM, TATAPOWER, TATASTEEL, TECHM, TORNTPOWER, ULTRACEMCO, VEDL, VOLTAS, WIPRO

---

### Family C · Divergence

#### Price Ahead of Fundamentals <sub>✅ matches</sub>

`divergence_C1_price_ahead` · concern **trajectory** · status **live**

**Description, as it ships**
> The Market read sits well above what Foundation and Momentum support. Price has run ahead of the business underneath it.

**Doesn't-mean, as it ships**
> …you read the state, you can't time the resolution — divergences are sticky; the bill is due, never that it's due today.

**What the rule actually fires on** — `rules/c1-divergence.ts`
> Market − mean(Foundation, Momentum) ≥ 25. All three pillars must be genuinely scored (a pillar that was removed from the blend stores a subtotal of 0 and is excluded here, or the gap would be fabricated).

**Firing now**

`high` × 8 — BHEL, GLENMARK, HINDALCO, INDUSINDBK, JSWSTEEL, SAIL, TORNTPHARM, VOLTAS

---

#### Ownership Against Fundamentals <sub>✅ matches</sub>

`divergence_C2_ownership_vs_fundamentals` · concern **trajectory** · status **live**

**Description, as it ships**
> Ownership behaviour contradicts the fundamentals — either owners are stepping back from a business that looks sound, or building into one that looks weak. Both are worth understanding; the second is the classic smart-money tell.

**Doesn't-mean, as it ships**
> …you read the state, you can't time the resolution — divergences are sticky; the bill is due, never that it's due today.

**What the rule actually fires on** — `rules/c2-ownership-divergence.ts`
> Either (Foundation ≥ 60 AND Foundation − Ownership ≥ 15) — owners stepping back from a sound business; or (Foundation < 60 AND Ownership − Foundation ≥ 15) — owners building under a weak one. Severity high when the gap reaches 25, medium otherwise.

**Firing now**

`high` × 13 — BHEL, BLUESTARCO, COCHINSHIP, CROMPTON, DALBHARAT, GLENMARK, INDUSINDBK, OIL, RELIANCE, TATACONSUM, TATAPOWER, VOLTAS, ZYDUSLIFE<br>`medium` × 12 — ACC, AMBUJACEM, GAIL, GODREJCP, LT, NHPC, ONGC, RAMCOCEM, SIEMENS, SUNPHARMA, TORNTPHARM, WIPRO

---

#### Floor–Trajectory Split <sub>📝 matches · open question</sub>

`divergence_C3_floor_trajectory_split` · concern **trajectory** · status **live**

**Description, as it ships**
> Foundation and Momentum are far apart — a sound balance sheet with deteriorating trends, or improving trends built on a weak base. What the company is and where it's heading disagree.

**Doesn't-mean, as it ships**
> …you read the state, you can't time the resolution — divergences are sticky; the bill is due, never that it's due today.

**What the rule actually fires on** — `rules/c3-floor-trajectory-split.ts`
> |Foundation − Momentum| ≥ 25. Both pillars must be genuinely scored.

**Firing now**

`high` × 16 — BPCL, DALBHARAT, DIXON, DRREDDY, HINDPETRO, IOC, ITC, JINDALSTEL, NHPC, OIL, POWERGRID, SAIL, TECHM, UNIONBANK, WIPRO, ZYDUSLIFE

**What was wrong** — Description is accurate. Code note, not copy: the severity expression is `wide ? "high" : "medium"` with `const wide = true` immediately above it, so the medium branch is unreachable and C3 can only ever emit high. Harmless today; it is a latent second severity that would surprise whoever relies on the ternary.

---

#### Divergence Widening <sub>✅ matches</sub>

`divergence_C_over_time_widening` · concern **trajectory** · status **live**

**Description, as it ships**
> The gap between how this company's share price reads and what the business underneath supports was already notable, and has widened further over recent snapshots. Price and fundamentals are drifting further apart rather than converging.

**Doesn't-mean, as it ships**
> …you read the state, you can't time the resolution — divergences are sticky; the bill is due, never that it's due today.

**What the rule actually fires on** — `rules/c-over-time.ts`
> The PRICE-VS-FUNDAMENTALS gap specifically (Market − mean(Foundation, Momentum) — C1's metric) is currently in the 15–25 band AND has risen by 8pp or more from its lowest value in the last 4 snapshots.

**Firing now**

`medium` × 2 — GAIL, TECHM

**What was wrong** — "A pillar gap that was already notable" reads as any pillar pair, and that is wrong: this rule watches ONE gap, price versus fundamentals. A widening Foundation-versus-Ownership gap does not fire it. The C family's own comment names the disjoint split (C1 owns wide-now, this owns developing, G owns narrowing) — the description does not carry it.

**Resolved** — "A pillar gap" became the price-versus-fundamentals gap specifically. DESCRIPTION was wrong; the rule is right — the narrow scope is what keeps C1 (wide now), C-over-time (developing) and G (narrowing) disjoint.

---

#### Divergence <sub>✅ matches</sub>

`divergence_consolidated` · concern **trajectory** · status **synthesised**

**Description, as it ships**
> Two or more pillar reads of this company disagree materially. The parts of the score are telling different stories about the same business.

**Doesn't-mean, as it ships**
> …you read the state, you can't time the resolution — divergences are sticky; the bill is due, never that it's due today.

**What the rule actually fires on** — `catalogue/divergence.ts consolidateDivergence (read-layer synthesis, never emitted by a rule)`
> Not a rule. When any of C1 / C2 / C3 / C-over-time fired for a stock, they collapse into this single row, showing at most two sub-type sentences and counting the rest. §5C exists so four cards all saying "two reads disagree" do not overstate how much is wrong.

**Firing now**

_Not firing on any company today._

---

### Family D · Recovery

#### Recovery from Weakness <sub>📝 matches · open question</sub>

`trajectory_D_recovery` · concern **trajectory** · status **live**

**Description, as it ships**
> The composite, or one pillar, has turned up out of weak territory and held the improvement. In this program's testing, recovery from weakness has been the most durable signal observed — stated descriptively, not as a forecast.

**Doesn't-mean, as it ships**
> …a coincident health inflection worth investigating — not a buy, not a guaranteed continuation; strongest read against a calm pond.

**What the rule actually fires on** — `rules/d-recovery.ts`
> The composite crossed UP through 62 (out of Below-par / Fragile), or any pillar crossed up out of its own weak mark, sustained at least 2 snapshots.

**Firing now**

`recovery` × 18 — AUROPHARMA, BAJAJ-AUTO, BHEL, DABUR, DIXON, HEROMOTOCO, HINDZINC, IOC, JSWENERGY, JSWSTEEL, NTPC, OIL, SAIL, SIEMENS, SUNPHARMA, THERMAX, ULTRACEMCO, ZYDUSLIFE

**What was wrong** — The trigger half is accurate. The second sentence is not a trigger claim at all: "In this program's testing, recovery from weakness has been the most durable signal observed" is a RESEARCH claim shipped as product copy. Nothing in the rule, the evidence payload or the catalogue records what testing, over what period, against what benchmark — and no reader can check it. It is hedged ("stated descriptively, not as a forecast") but it is still the only sentence in the registry that asserts predictive durability. Worth an explicit decision on whether it ships.

---

### Family F · Composition

#### Atypical Composition <sub>✅ matches</sub>

`composition_F1_atypical` · concern **trajectory** · status **live**

**Description, as it ships**
> The four pillars are distributed unusually for a company at this score. The same composite can be built from very different mixes, and this one isn't the typical shape for its band.

**Doesn't-mean, as it ships**
> …a place to investigate, not a re-rate signal.

**What the rule actually fires on** — `rules/f1-composition.ts`
> Some pillar sits 25pp or more away from the median value of that pillar across companies in the SAME COMPOSITE BAND. At least 3 pillars must be scored, or the shape cannot be judged.

**Firing now**

`low` × 8 — ACC, DALBHARAT, HCLTECH, HDFCBANK, INFY, ITC, TCS, WIPRO

**What was wrong** — Accurate. One caveat the rule file raises itself and the copy does not: band-typical profiles pool all sectors, so a sector-characteristic shape (IT's habitually low Market read) can register as "atypical" when it is simply typical for that industry.

---

#### Composition Shift <sub>✅ matches</sub>

`trajectory_F2_composition_shift` · concern **trajectory** · status **live**

**Description, as it ships**
> The overall score held steady since the last snapshot, but the mix beneath it moved — either one pillar shifted markedly, or a different pillar is now the strongest of the four. What's driving the number has changed, even though the number hasn't.

**Doesn't-mean, as it ships**
> …a place to investigate, not a re-rate signal.

**What the rule actually fires on** — `rules/f2-composition-shift.ts`
> |Δ composite versus the prior snapshot| < 3 (the score "held") AND either some pillar moved 8pp or more, OR the highest-scoring pillar changed.

**Firing now**

`low` × 20 — AMBUJACEM, AXISBANK, BAJAJ-AUTO, GAIL, HAVELLS, HDFCBANK, HEROMOTOCO, ICICIBANK, INFY, KOTAKBANK, NESTLEIND, ONGC, PETRONET, SUNPHARMA, TECHM, THERMAX, TVSMOTOR, VEDL, VOLTAS, WIPRO

**What was wrong** — "changed materially" covers the 8pp branch well. It covers the other branch loosely: a leader change alone fires with no size requirement, so two pillars a point apart swapping places is a "material" mix shift by this rule. Arguably right (which pillar leads IS the story) but it is not what "materially" signals.

**Resolved** — Now names both branches — one pillar moving markedly, OR the strongest pillar changing. DESCRIPTION was imprecise; the rule is right, and which pillar leads genuinely is the story.

---

### Family G · Convergence

#### Convergence <sub>✅ matches</sub>

`trajectory_G_convergence` · concern **trajectory** · status **live**

**Description, as it ships**
> A pillar gap that was previously notable has narrowed. Which way it closed matters: the laggard rising is a different story from the leader falling.

**Doesn't-mean, as it ships**
> …the move isn't over, and which way it resolved depends on which pillar moved — not buy/sell.

**What the rule actually fires on** — `rules/g-convergence.ts`
> The current widest-minus-narrowest pillar spread is BELOW 25; the largest spread among prior snapshots was 15 or more; and the spread has narrowed by 8pp or more from that peak.

**Firing now**

`low` × 17 — ABB, ADANIPOWER, BAJAJ-AUTO, CANBK, FEDERALBNK, HINDZINC, HONAUT, JSWENERGY, NATIONALUM, NESTLEIND, POLYCAB, POWERINDIA, RAMCOCEM, SIEMENS, THERMAX, ULTRACEMCO, VEDL

**What was wrong** — "A pillar gap that was previously WIDE has narrowed." The prior gap only has to have been NOTABLE (15). "Wide" is the ≥25 tier — a specific, stricter thing with its own meaning elsewhere in this vocabulary (C1/C3 both use it). And the rule deliberately refuses to fire while the CURRENT spread is still wide, because the C family owns a still-open divergence. So "previously wide" both overstates the entry condition and muddles the handoff between G and C.

**Resolved** — "previously wide" became "previously notable". DESCRIPTION was wrong; the rule is right — requiring only a notable prior gap, and refusing to fire while the current gap is still wide, is what hands the still-open case to the C family.

---

### Family H · Ownership events

#### Ownership Events <sub>📝 matches · open question</sub>

`ownership_H_block_events` · concern **ownership** · status **live**

**Description, as it ships**
> A significant block or bulk deal was recorded in the last quarter. An ownership event worth noting as flow and risk context.

**Doesn't-mean, as it ships**
> …risk/flow context, not a verdict.

**What the rule actually fires on** — `rules/h-ownership-events.ts`
> At least one block or bulk deal worth ₹1cr or more in the trailing 90 days. That is the whole rule.

**Firing now**

`low` × 13 — AXISBANK, BEL, HDFCBANK, HINDUNILVR, ICICIBANK, INFY, LT, M&M, POWERGRID, RELIANCE, SUNPHARMA, TCS, VEDL

**What was wrong** — "or a material change in pledged shares" is NOT IMPLEMENTED. ruleH reads feeds.blockTxns and has no pledging input at all. Pledging belongs to R1 (crisis) and N7 (release). As written the description promises a second trigger the rule does not have — so a reader who sees no H card concludes pledging did not move, when pledging was never checked here.

**Resolved** — The pledge clause is gone: now "A significant block or bulk deal was recorded in the last quarter." DESCRIPTION was wrong; the rule does exactly what its own header says.

📝 **The strongest candidate in the set for the RULE being incomplete rather than the copy.** The finding is called "Ownership Events" and a material change in pledged shares plainly is one — the description may have been written against an intended two-input rule that only ever got one input built. Pledging is currently reachable only through R1 (crisis level) and N7 (release), so a mid-sized pledge move surfaces nowhere at all. Copy corrected to today's engine; the gap reported, not closed.

---

### Family I · Band transition

#### Band Transition <sub>✅ matches</sub>

`trajectory_I_band_transition` · concern **trajectory** · status **live**

**Description, as it ships**
> The composite crossed into Healthy on the way up, or into Below-par on the way down — the two boundaries either side of the middle of the scale.

**Doesn't-mean, as it ships**
> …a band change to note — not a buy/sell call.

**What the rule actually fires on** — `rules/i-band-transition.ts`
> The composite crossed UP through 68 (into Healthy) or DOWN through 62 (into Below-par), sustained at least 2 snapshots — and is not already covered by D (for the up cross) or B (for the down cross), so the same move never renders twice.

**Firing now**

`low` × 9 — COLPAL, CROMPTON, DABUR, GAIL, GLENMARK, HONAUT, LUPIN, NHPC, ONGC

**What was wrong** — "crossed a band boundary" — there are four boundaries (55 / 62 / 68 / 74) and this rule watches two. A drop from Below-par into Fragile, or a rise from Healthy into Pristine, does not fire I. The description's own second half names the two correctly, so this over-promises in its first clause rather than actively misleading.

**Resolved** — Now names the two boundaries it actually watches. DESCRIPTION over-promised; the rule is right — B and D own the other crossings, and I is deliberately subordinate to them.

---

### Family N · Notable (constructive twins)

#### Cash-backed earnings <sub>✅ matches</sub>

`foundation_N1_cash_backed_earnings` · concern **fundamentals** · status **live**

**Description, as it ships**
> Operating cash flow has covered reported profit across consecutive years — earnings converting to cash rather than accumulating as accruals.

**Doesn't-mean, as it ships**
> …cash conversion describes accounting quality, not growth, not valuation, and not a floor under the price.

**What the rule actually fires on** — `rules/n1-cash-backed-earnings.ts`
> Operating cash flow was at least equal to net profit for 3 or more consecutive annual periods, with net profit positive in each, and the latest year clear of the exceptional-item guard. Banking out of scope.

**Firing now**

`green` × 1 — POWERINDIA

---

#### Working-capital discipline <sub>✅ matches</sub>

`foundation_N2_working_capital` · concern **fundamentals** · status **live**

**Description, as it ships**
> Revenue has grown faster than receivables across consecutive years — sales converting to collections rather than to outstanding balances.

**Doesn't-mean, as it ships**
> …collection discipline is a working-capital fact. It says nothing about demand, margins, or whether growth continues.

**What the rule actually fires on** — `rules/n2-working-capital.ts`
> Revenue growth exceeded receivables growth by 15pp or more for 2 or more consecutive annual periods, with receivables at least 5% of revenue in the base year. Banking out of scope.

**Firing now**

_Not firing on any company today._

**What was wrong** — The 15pp bar is not stated, and that is deliberate — Family N's §4.0 rule forbids naming threshold constants in a description. Flagged only so the operator sees the omission is a policy, not an oversight, and can compare it with P8 (the negative twin), whose description DOES try to describe its bar and gets it wrong.

---

#### Sustained deleveraging <sub>✅ matches</sub>

`foundation_N3_deleveraging` · concern **fundamentals** · status **live**

**Description, as it ships**
> Borrowings relative to net worth have fallen across consecutive years — a decline wide enough to reflect repayment or equity accumulation rather than measurement drift.

**Doesn't-mean, as it ships**
> …a falling ratio can come from repayment or from equity growth, and the two are different. Lower leverage is less fragility, not more return.

**What the rule actually fires on** — `rules/n3-deleveraging.ts`
> Debt-to-equity fell in 3 or more consecutive annual steps AND the total fall is at least 0.5× in absolute terms or at least 25% in relative terms. Negative net worth in the window makes it unevaluable rather than false. Banking out of scope.

**Firing now**

_Not firing on any company today._

---

#### Coverage strengthening <sub>✅ matches</sub>

`foundation_N4_coverage_strengthening` · concern **fundamentals** · status **live**

**Description, as it ships**
> Trailing interest coverage has improved across consecutive quarters from a thin starting level — debt-service capacity rebuilding, not a comfortable ratio drifting higher.

**Doesn't-mean, as it ships**
> …improving coverage describes debt-service capacity recovering. It is not a statement about earnings quality or about the level being comfortable now.

**What the rule actually fires on** — `rules/n4-coverage-strengthening.ts`
> TTM interest coverage rose in 2 or more consecutive steps AND the trough of that run was below 3.0×. A debt-free company is unevaluable, not a non-fire. Banking out of scope.

**Firing now**

`green` × 3 — BHEL, JSWSTEEL, SAIL

---

#### Dual institutional build <sub>✅ matches</sub>

`ownership_N5_dual_institutional_build` · concern **ownership** · status **live**

**Description, as it ships**
> Foreign and domestic institutional holdings both increased in the same quarter — two owner classes adding at once, rather than one rotating into the other.

**Doesn't-mean, as it ships**
> …institutional flow is what owners did last quarter, not what the stock will do. It is not agreement, not conviction, and not a signal to follow.

**What the rule actually fires on** — `rules/n5-dual-institutional-build.ts`
> FII and DII each rose by 0.5pp or more in the same quarter, AND Flow rule B1 (clean rotation) did not fire.

**Firing now**

`green` × 4 — ICICIBANK, INDUSINDBK, NHPC, TORNTPHARM

---

#### Promoter accumulation <sub>✅ matches</sub>

`ownership_N6_promoter_accumulation` · concern **ownership** · status **live**

**Description, as it ships**
> Promoters' absolute shareholding has risen across consecutive quarters — shares actually acquired, not a percentage lifted by a shrinking share count.

**Doesn't-mean, as it ships**
> …promoters buying is a disclosure fact. Insiders are not always right, and their reasons are not visible.

**What the rule actually fires on** — `rules/n6-promoter-accumulation.ts`
> Promoter share COUNT rose for 2 or more consecutive quarters AND the cumulative promoter-% rise is at least 1.0pp. Counting shares rather than percent is what stops a buyback (percent up, count flat) from firing it.

**Firing now**

_Not firing on any company today._

---

#### Pledge release <sub>✅ matches</sub>

`ownership_N7_pledge_release` · concern **ownership** · status **live**

**Description, as it ships**
> Pledged promoter shares have fallen as a proportion of promoter holding — financing encumbrance being unwound at the promoter level, which is separate from the operating business.

**Doesn't-mean, as it ships**
> …a falling pledge is reduced financing stress at the promoter level. It says nothing about the operating business.

**What the rule actually fires on** — `rules/n7-pledge-release.ts`
> The pledge ratio fell by 10pp or more quarter on quarter, OR crossed below 50% from above. Suppressed when R1 is still standing.

**Firing now**

_Not firing on any company today._

---

## Three things that are not copy problems, noted while reading

**Retired and unbuilt keys are absent by design, and cannot acquire copy.** P2 (distribution-retail) was consolidated into R6 and P3 (promoter stress) into R1; their rule files survive but are not registered in `ALL_RULES`, so they cannot fire. P9 (capex) was never built. Copy for a key that can never arrive is copy that can never be checked, so the registry refuses it. Worth knowing before anyone asks why the P-series has gaps.

**Two findings can fire at more than one severity.** `momentum_P13_revenue_inflection` fires green or red depending on direction — the only rule in the registry whose severity crosses the constructive/concern line. `divergence_C2_ownership_vs_fundamentals` fires high or medium by gap size, within one direction. (`divergence_C3` looks like a third but its medium branch is unreachable — see its note.) Written up separately in `REVIEW_mixed_severity_census.md`; the case for splitting P13 into two keys is in `REVIEW_p13_split.md`.

**One doesn't-mean line is doing double duty.** P13's boundary — "a condition to look at — not a trade signal" — is its family's generic line, and it has to cover both an acceleration and a deceleration. It is not wrong for either, and it is not pointed at either. That is a consequence of one key carrying two directions, so it is part of the split decision rather than a copy fix; correcting it in place would mean writing a sentence that is honest about acceleration and deceleration at once, which is the thing that cannot be done well.
