# VYTAL HEALTH SCORE — GUARDRAIL LAYER (PHASE 1 + BANKING EXTENSION)
## Layer 1 Gatekeeper Design — Non-Financial (A/B/C) + Financial-Sector (B-Bank) Signatures
**Date:** May 2026
**Status:** Design document for code build · Phase 1 scope
**Author:** Master Chat (architecting) + Aman Jain (operator)
**Scope discipline:** Deliberately lean. Catches the embarrassing misses. Everything else is v6.0.
 
---
 
## 0. Design Principles (read first)
 
1. **Two-layer pipeline.** Every stock passes Layer 1 (this guardrail) before Layer 2 (health scoring). Layer 1 detects distortions and decides one of six outcomes. Layer 2 scores whatever Layer 1 passes through.
2. **Code executes ratified rules. Code has no intelligence.** Every threshold in this document is a fixed number written into code by the developer. The data informed the number ONCE, here, during design. The code applies the constant forever and does nothing adaptive. There is no runtime learning.
3. **Keep-and-explain is the default.** Because the platform is built on explainability (visible metric breakdowns, thresholds, lens scores, peer scores), the default response to a distortion is to KEEP the stock scored and SHOW the user what was distorted and why it was handled — not to hide or remove. Removal is the last resort, used only when nothing honest can be displayed.
4. **Universal thresholds, not per-PG.** Distortions are accounting phenomena, not sector phenomena. An exceptional item dwarfs operating profit the same way in any sector. Thresholds are set once, universally, conservatively — loose enough to avoid false alarms in the most volatile sector, which means quiet sectors are safely covered. Per-PG threshold derivation is overkill for Phase 1 and rejected.
5. **Conservative thresholds = few false alarms.** Phase 1 priority is "never embarrass us with a clear miss" and "never false-alarm on a normal quarter." Thresholds are set wide so only genuine distortions fire. We tune tighter in v6.0 with live evidence.
6. **The six possible outcomes (the entire action space):**
   - **O1 Score normally** — flag cleared, no real distortion.
   - **O2 Score, suppress affected metric(s)** — see §0.8 for the exact mechanical definition of "suppress."
   - **O3 Score, annotate** — full score computed, visible note flags the one-off. No math change.
   - **O4 Score, suppress peer comparison** — own score valid; exclude from peer cross-section (Lens 2) this period so the distortion doesn't contaminate peers. (This is one half of O2 — see §0.8.)
   - **O5 Hold** — freeze at last clean value, don't update this period.
   - **O6 Remove** — exit scoring and peer set until resolved. Last resort.
7. **Auto by default; human input only for structural-PG-membership decisions.** Once a signature's "metrics affected" map is fixed (in this document), the detection AND the response are both mechanical — no per-case judgment needed. Category A is auto. Category B is auto (the metrics-affected map makes the response deterministic; the Vi nuance of "phantom for profit-ratios, real for balance-sheet" is encoded in the map, not decided per case). Category C-2 is auto. The ONLY case needing operator input is **C-1 structural change** where the question "does this stock still belong in this peer group" is genuinely strategic, not mechanical. Every flag and outcome is logged for the audit trail regardless.
8. **THE MECHANICAL DEFINITION OF "SUPPRESS" (locked — this is the core of the whole layer).**
   "Suppress a metric" means EXCLUDE it — never reduce its weight, never substitute a fabricated/neutral value, never override the data. When a signature fires on a stock's metric for a period, two separate exclusions happen, plus transparency:
   **(a) Own-score exclusion.** The distorted metric is removed from THAT STOCK's own pillar calculation for that period. The pillar recomputes on the remaining metrics, with intra-pillar weights renormalized to sum to 100%. Example: Foundation has 10 metrics at 10% each; if ROE and Net Margin are suppressed for a stock this period, Foundation scores on the remaining 8 metrics at 12.5% each. The stock still gets a full pillar score — built only from the metrics that are clean this period. This is identical in mechanism to the existing §14.4 pillar-exclusion / §5.8 missing-lens renormalization — the guardrail extends "exclude when data is missing" to "exclude when data is distorted," with the distortion detected mechanically per the signature condition.
   **(b) Peer-set exclusion (Lens 2 protection).** The SAME distorted metric value is removed from the PEER CROSS-SECTION MEAN that every OTHER peer in the group is scored against for that period. This prevents one stock's distortion from contaminating every peer's Lens 2 score. Example: if Vi's ROE is distorted, Vi's ROE is dropped from the telecom peer-mean for that period, so Bharti and the others are scored against a clean cross-section that treats Vi's value as a this-quarter outlier. The peer count for that metric that period drops by one (N-of-K reporting documents it).
   **Both (a) and (b) fire together for one distortion.** (a) protects the stock's own score from carrying its own lie; (b) protects everyone else's score from that stock's contamination. O2 in this document always means "(a) + (b) + transparency." O4 alone (peer-set exclusion without own-score exclusion) applies only where the metric is valid for the stock itself but shouldn't influence peers (rare — mainly structural cases).
   **(c) Transparency rides alongside, always.** Suppression is never silent. A permanent flag is attached to the stock for that period, with the explanation text from the signature. The raw distorted number REMAINS VISIBLE in the detailed metric breakdown — marked "excluded from score this period — reason: [X]." We exclude it from the MATH; we never hide it from the USER. The headline health score stays clean (built on trusted data only); the flag + breakdown tells the full story so the user can do their own due diligence.
   **Why exclude rather than just flag-and-let-it-flow:** the health score's core job is to be the number a user trusts at a glance. If a distorted metric flows into the score and we rely on the flag alone to undo the impression, a user scanning a list sees the moved number and many won't read the flag. The flag is necessary but not sufficient. So the score itself must not carry the distortion (exclusion), AND the flag must explain (transparency). Both, always. This keeps the score 100% data-driven — we are not changing any number, only declining to let a mechanically-identified distorted data point enter the calculation, exactly as the model already declines to score on missing data.
---
 
## 1. CATEGORY A — DATA INTEGRITY / STATUS
**Detection: mechanical. Outcome: mechanical. → AUTO.**
 
These are data-presence facts, not judgments. Code handles them automatically.
 
### A-1: Stale / Non-Filed Results
- **Condition:** Latest expected quarter's `QuarterlyResult` row absent > 45 days after the expected report date (derived from prior-year same-quarter `reportDate` + `CorporateEvent` earnings date where available).
- **Threshold:** 45 calendar days past expected filing. *(Grounded: Indian listed cos must file within 45 days of quarter-end per SEBI LODR; beyond that is genuinely late.)*
- **Metrics affected:** All Momentum (TTM-based) metrics that need the latest quarter.
- **Solution:** **O5 Hold** — keep last clean composite, don't update on incomplete data. If non-filing persists > 2 consecutive quarters → escalate to **O6 Remove** (flag for operator).
- **User explanation:** *"Latest quarterly results not yet filed. Health Score reflects data through [last filed quarter]; will update when new results are published."*
- **Auto/Review:** AUTO (hold). The 2-quarter→remove escalation flags to operator for confirmation.
### A-2: Missing Critical Fields
- **Condition:** Any of `revenue`, `netProfit`, `netWorth`, `totalAssets` null in the latest `Fundamental` row needed for scoring.
- **Threshold:** Binary (null check).
- **Metrics affected:** Whichever pillar metrics depend on the missing field.
- **Solution:** **O2 Suppress affected metric(s)** via existing §14.4 pillar-exclusion + §5.8 missing-lens fallback. If too many fields missing to compute any pillar → **O5 Hold**.
- **User explanation:** *"Some financial data unavailable for [metric]; this metric is excluded from the current Health Score. Remaining metrics scored normally."*
- **Auto/Review:** AUTO. This is existing spec behavior (§14.4 / §5.8), just surfaced as a guardrail.
### A-3: Insufficient History
- **Condition:** Count of `Fundamental` rows < minimum needed for Lens 3 (own-history) per §5.4; or count of `ShareholdingPattern` rows < 8 for Ownership baseline per §11.10.
- **Threshold:** Per existing spec minimums (§5.4 Lens 3 window; §11.10 8-quarter Ownership).
- **Metrics affected:** Lens 3 across affected metrics; Ownership baseline.
- **Solution:** **O2** via existing §5.8 (L1+L2)/2 fallback; Ownership baseline 60 until 8 quarters per §11.10.
- **User explanation:** *"[Stock] has limited trading history; some trend-based components use available data. Score reflects this with [X] of [Y] periods."*
- **Auto/Review:** AUTO. Existing spec behavior surfaced.
### A-4: Inactive / Suspended
- **Condition:** `Stock.isActive` = false, OR no `DailyPrice` row for > 10 consecutive trading days (suspension signature).
- **Threshold:** isActive flag, or 10-trading-day price gap.
- **Metrics affected:** All (Market pillar especially).
- **Solution:** **O6 Remove** from active scoring AND peer set. Recommended-action flag to operator for confirmation (one-tap), since removal changes peer-set scores for every other stock in the PG.
- **User explanation:** *"[Stock] is currently suspended/inactive. Health Score paused until trading resumes."*
- **Auto/Review:** Detection AUTO; removal flagged for operator one-tap confirm (peer-set integrity — see §0.6 O6).
---
 
## 2. CATEGORY B — ACCOUNTING DISTORTION
**Detection: mechanical. Response: mechanical (metrics-affected map is fixed per signature). → AUTO.**
 
These were initially considered "review," but because each signature has a FIXED metrics-affected map (which metrics to suppress, which to keep), the response is deterministic, not a per-case judgment. The Vi nuance — phantom for profit-ratios but real for balance-sheet — is ENCODED IN THE MAP, not decided each time. So Category B runs auto: detect → apply the fixed suppression map (own-score exclusion + peer-set exclusion per §0.8) → attach flag + explanation. Operator input is not required. Every firing is logged for the audit trail.
 
**The unifying detection key:** the distortion lives BELOW the operating line. The operating line stays honest. So the signature is always: *bottom-line metric moved sharply while operating-line metric stayed flat.* This is pure arithmetic, CN-4 clean.
 
**For every B signature below, "Solution: O2" means the full §0.8 mechanic:** exclude the listed affected metrics from (a) the stock's own pillar score (renormalize remaining) AND (b) the peer-set mean for Lens 2 (that period), PLUS attach the flag + explanation, PLUS keep the raw number visible in the breakdown.
 
### B-1: Exceptional Gain (Phantom Profit) — THE VI CASE
- **Condition:** `profitYoy` (or `profitGrowthYoy`) > +100% in a period **AND** `operatingMargin` change within ±3 percentage points over the same period **AND** the implied below-operating-line amount (`netProfit` minus derived operating profit minus normal tax) exceeds 40% of `netProfit`.
- **Thresholds:**
  - Profit jump: **> +100% YoY** *(Grounded: normal large-cap profit growth tracks revenue growth, low-to-mid teens; Airtel's one-off case was +37.5%, so +100% is conservative — only catches large distortions, near-zero false alarms. Real operating doublings are rare and would also show operating-margin movement, failing the second condition.)*
  - Operating margin flat: **within ±3pp** *(if the business genuinely doubled profit, operating margin would move; flat OPM + doubled profit = the gain is below the line.)*
  - Below-line share: **> 40% of net profit** *(the one-off is a material chunk of reported profit, not a rounding item.)*
- **Metrics affected (the fixed map):** SUPPRESS (exclude from own-score + peer-set per §0.8) — ROE, ROCE, Net Margin (Foundation); TTM NPM, NP-YoY (Momentum). KEEP (score normally) — Operating Margin metrics, all balance-sheet metrics (D/E, Interest Coverage), Cash metrics. *(Vi's debt genuinely fell from the waiver — that real deleveraging stays in the score. This split IS the map; it makes the response deterministic.)*
- **Solution:** **O2 (full §0.8 dual-exclusion) + O3 annotate.** Auto.
- **User explanation:** *"Net profit this period includes a one-time gain of approximately ₹[X] Cr below the operating line (e.g., tax/legal/settlement). Profit-based metrics (ROE, net margin) have been excluded from the Health Score as they don't reflect operating performance this period. Operating and balance-sheet metrics are scored normally. See breakdown."*
- **Auto/Review:** AUTO. The metrics-affected map is fixed, so the dual-exclusion response is deterministic. Logged for audit.
### B-2: Exceptional Loss (Phantom Loss) — THE CROMPTON / GLENMARK CASE
- **Condition:** `netProfit` falls > 80% YoY OR turns negative **AND** `operatingMargin` holds (change within ±3pp, stays positive) **AND** the implied below-operating-line charge exceeds 40% of the absolute profit swing.
- **Thresholds:**
  - Profit drop: **> 80% YoY or sign flip to negative** *(Crompton: profit to a ₹243 Cr loss while OPM held 10.4%. Glenmark: −₹1,502 Cr loss while operating profit stayed positive ₹804 Cr.)*
  - Operating margin held: **within ±3pp, still positive** *(the operating business didn't break; a charge below the line did.)*
  - Below-line share: **> 40% of the swing.**
- **Metrics affected:** SUPPRESS — Net Margin, ROE, NP-YoY (the impairment/charge hits these). KEEP — Operating Margin, Revenue growth, balance-sheet (note: if the charge was a real equity write-down, D/E genuinely worsens — keep that).
- **Solution:** **O2 Suppress affected profit metrics + O3 annotate.**
- **User explanation:** *"Net profit this period reflects a one-time charge of approximately ₹[X] Cr (e.g., goodwill impairment, write-down) below the operating line. Profit-based metrics have been excluded as they don't reflect ongoing operating performance. Operating metrics are scored normally. See breakdown."*
- **Auto/Review:** AUTO. Fixed metrics-affected map → deterministic response. Logged for audit.
### B-3: Tax-Driven Distortion
- **Condition:** `tax` negative (tax credit) OR effective tax rate (`tax`/`profitBeforeTax`) < 5% in a period where it's normally > 20% **AND** the resulting `netProfit` swing > 50% YoY while `profitBeforeTax` (pre-tax) swing is < 25%.
- **Thresholds:**
  - Effective tax rate: **< 5%** (or negative) when normal is > 20% *(Grounded: Infosys's 90% tax dip / ITC tax reversal cases; JK Tyre +157% profit on deferred-tax reversal; Ashok Leyland's ₹172 Cr one-time deferred-tax gain.)*
  - Divergence: net-profit swing **> 50%** while pre-tax swing **< 25%** *(the swing is coming from the tax line, not the business.)*
- **Metrics affected:** SUPPRESS — Net Margin, ROE, NP-YoY (post-tax metrics). KEEP — everything pre-tax (Operating Margin, ROCE if computed on EBIT, Revenue growth).
- **Solution:** **O3 Annotate** (often the cleaner response — tax effects are usually smaller than B-1/B-2; suppress only if the distortion is large enough to flip the metric's band).
- **User explanation:** *"Net profit this period was affected by a one-time tax adjustment (deferred-tax reversal/credit). Post-tax metrics are flagged; pre-tax operating metrics are unaffected. See breakdown."*
- **Auto/Review:** AUTO. Clean, consistent tax signature; fixed map. Logged for audit.
### B-4: Other-Income Inflation
- **Condition:** `otherIncome` > 30% of `profitBeforeTax` in a period where it's normally < 10%.
- **Threshold:** **otherIncome > 30% of PBT** (vs normal < 10%) *(catches gains parked in other income — asset sale gains, investment MTM, forex gains — that inflate profit without operating cause.)*
- **Metrics affected:** SUPPRESS — profit-based metrics where other-income inflates the numerator. KEEP — Operating Margin (excludes other income by construction).
- **Solution:** **O3 Annotate** (or O2 if large enough to flip a band).
- **User explanation:** *"A significant portion of profit this period came from non-operating other income (e.g., investment/asset-sale gains). Operating metrics are unaffected; profit metrics are flagged. See breakdown."*
- **Auto/Review:** AUTO. Fixed map. Logged for audit.
### B-5: HoldCo Extraction — THE VEDANTA / HZ CASE
- **Condition:** `netWorth` (or `reserves`) falls > 25% YoY **AND** `netProfit` is positive that year (i.e., equity shrank not from losses but from extraction — special dividend / capital return to controlling parent) **AND** promoter holding > 50% (`ShareholdingPattern.promoterPct`).
- **Thresholds:**
  - Reserves/net-worth drop: **> 25% YoY** *(Grounded: HZ reserves ₹33,437 Cr → ₹12,097 Cr = −64%; conservative threshold at 25% catches it with margin.)*
  - Net profit positive (equity shrank from extraction, not losses).
  - Promoter > 50% (extraction-to-parent signature).
- **Metrics affected:** ANNOTATE — ROE, ROCE (these get arithmetically *inflated* by the shrunk equity denominator — the inflation is the distortion). This is the tricky reverse case: the metric looks *better* but for a bad reason.
- **Solution:** **O3 Annotate** (do NOT suppress — the ROE is real arithmetic per CN-4; flag that it's inflated by reserve depletion). This is the §17.3 WD-c Model_Blind_Spot case already documented in PG9.
- **User explanation:** *"Return ratios (ROE/ROCE) this period are elevated partly because shareholder equity was reduced by large special dividends to the controlling shareholder. Strong return ratios here partly reflect a smaller equity base, not only operating strength. See breakdown."*
- **Auto/Review:** REVIEW. This is genuinely subtle — keep human in loop longer.
---
 
## 2B. CATEGORY B-BANK — ACCOUNTING DISTORTION, FINANCIAL-SECTOR VARIANT (PG5/PG6/PG7)
**Why a separate set:** every Category B signature above keys off the operating line — `operatingMargin` flat while `netProfit` swings. A bank has no operating margin in that sense. A bank's "operating line" is **pre-provision operating profit (PPOP)** = net interest income + fee/other income − operating expenses, *before* loan-loss provisions and tax. A bank's profit swings most violently through **provisions** and **tax write-backs**, both of which sit below PPOP — so the non-financial B-family is structurally blind to them. These signatures are the bank-native analogues. They reuse the identical §0.8 dual-exclusion mechanic, the six outcomes, the audit trail, and the auto/review discipline — only the detection condition and metrics-affected map are bank-specific. This is a **sector-class extension** (additive, parallel to the banking metric set); it changes nothing in Categories A, B, C for non-financial PGs (CN-1 preserved).
 
**Applies to:** stocks in PG5 (Private Banks), PG6 (PSU Banks), and PG7 (NBFCs, with PPOP read as pre-provision operating profit on the NBFC P&L). When a stock is in a banking PG, the engine runs Category A + Category B-Bank + Category C-Bank (the C-1 asset-base variant, §below) and does NOT run non-financial B-1…B-4 (which reference fields banks don't report). B-5 (HoldCo extraction) still applies to NBFCs under promoter groups (e.g. Bajaj, Aditya Birla) unchanged.
 
**The unifying detection key (bank version):** the distortion lives BELOW PPOP. PPOP stays honest. So the signature is always: *bottom-line metric (net profit / ROA) moved sharply while PPOP stayed stable.* Pure arithmetic, CN-4 clean — the exact mirror of the non-financial "below the operating line" key.
 
### B-Bank-1: Provision-Driven Profit Swing — THE PSU-LOSS-YEAR / RECOVERY CASE
- **Condition:** `netProfit` falls > 50% YoY OR turns negative (loss year), OR rises > 75% YoY (recovery year) **AND** pre-provision operating profit (PPOP) change stays within ±15% over the same period **AND** the implied provision/below-PPOP charge-or-reversal exceeds 40% of the absolute profit swing.
- **Thresholds:**
  - Profit swing: **> 50% drop / sign-flip, or > 75% rise** *(Grounded: the PG6 PSU cohort posted reported annual net losses across FY18–FY20 — SBI, BoB, PNB, Canara, Union, Indian — while their deposit-and-lending franchise (NII, CASA) was intact; the swing was entirely provisions. Recovery years reverse this as provisions normalize.)*
  - PPOP flat: **within ±15%** *(if the franchise genuinely doubled or collapsed, PPOP would move; flat PPOP + violent PAT swing = the move is in provisions, below PPOP.)*
  - Below-PPOP charge/reversal > 40% of the profit swing (isolates provision-driven distortion from genuine franchise change).
- **Metrics affected (the fixed map):** SUPPRESS (own-score + peer-set per §0.8) — F5 ROA, M-series Net-Profit-YoY and PPOP-to-PAT-dependent momentum, any ROE. KEEP (score normally) — M1 NIM, F6 Cost-to-Income, F7 CASA, F1 Tier-1, PPOP-growth (these read the franchise, which is honest this period). **Asset-quality metrics (F2 GNPA, F3 NNPA, F4 PCR, M5 GNPA-TTM) are KEPT** — they are the *cause* being correctly priced, not a distortion to hide. *(A loss year driven by cleaning up bad loans should show the bad-loan ratios at full strength; the franchise metrics stay clean; only the provision-distorted return ratio is suppressed.)*
- **Solution:** **O2 dual-exclusion** (suppress the return ratio from own-score + peer-set, keep raw visible, attach flag).
- **User explanation:** *"Net profit this period was driven mainly by loan-loss provisions (a sharp charge, or a reversal as asset quality normalized) rather than the lending franchise. Return-on-assets has been excluded from the Health Score this period as it doesn't reflect operating strength; margin, deposit-franchise, and asset-quality metrics are scored normally. See breakdown."*
- **Auto/Review:** **AUTO.** Fixed metrics-affected map; the PPOP-stable-PAT-swings test is pure arithmetic. Logged.
### B-Bank-2: Tax / DTA Write-Back at Recovery
- **Condition:** effective tax rate < 5% OR negative (tax *credit*) **AND** `netProfit` rises > 50% YoY **AND** pre-tax profit (PPOP − provisions) swing < 25% **AND** the stock is exiting a multi-year loss sequence (≥2 prior loss years in the window).
- **Thresholds:** eff-tax **< 5% or negative**; NP rise **> 50%**; pre-tax swing **< 25%** *(Grounded: PSU banks emerging from PCA frequently write back deferred-tax assets accumulated during loss years, producing a tax credit that inflates the first recovery year's net profit and ROA without any operating event. The pre-tax line barely moves; the post-tax line jumps.)*
- **Metrics affected:** SUPPRESS — F5 ROA, ROE, Net-Profit-YoY (post-tax metrics inflated by the DTA credit). KEEP — everything pre-tax: NIM, PPOP-growth, Cost-to-Income, asset-quality, CASA, Tier-1.
- **Solution:** **O3 Annotate** by default (DTA effects are usually one-period and visible); escalate to **O2** if the DTA credit flips F5 ROA across a band boundary.
- **User explanation:** *"Net profit this period was lifted by a one-time deferred-tax write-back as the bank returned to profitability. Post-tax return metrics have been [annotated / excluded] as they overstate this period's operating performance; pre-tax franchise metrics are scored normally. See breakdown."*
- **Auto/Review:** **AUTO.** Clean tax signature, fixed map. Logged.
### B-Bank-3: Capital-Base Discontinuity — THE RECAPITALISATION CASE
- **Condition:** `netWorth` (or Tier-1 capital base) rises > 20% YoY **AND** the rise is not from retained earnings (`netProfit` for the year is < 25% of the equity increase, i.e. the equity jump came from an external infusion, not internal accrual) **AND** for PSU banks corroborated by a government recapitalisation event; for any bank, corroborated by a QIP/preferential-issue `CorporateEvent` or share-count step.
- **Thresholds:** equity base **+20% YoY**; internal-accrual share **< 25%** of the increase *(Grounded: the PG6 spec flags government recapitalisation infusions across all six PSU banks FY18–FY21. An infusion enlarges the equity/capital denominator, mechanically depressing ROA/ROE and lifting Tier-1, with no operating cause — the inverse of the B-5 extraction case, where extraction shrinks the denominator.)*
- **Metrics affected:** ANNOTATE (do not suppress — the capital is real and the strengthened Tier-1 is genuine) — F1 Tier-1 (legitimately stronger, but flag that it's from infusion not accrual), F5 ROA / ROE (temporarily depressed by the enlarged base). This is a two-sided annotation: capital adequacy reads *better* for a support reason; return ratios read *worse* for a denominator reason. Neither is an operating signal this period.
- **Solution:** **O3 Annotate.** The infusion is real and stabilizing — the score should reflect the genuinely stronger capital, while flagging that this period's return ratios are diluted by the larger base and the capital strength is externally supplied. *(Mirrors B-5's annotate-not-suppress logic: the arithmetic is real per CN-4; the user needs the context.)* Ownership pillar already treats recapitalisation as support, not disturbance (per PG6 spec) — this signature handles the capital/return-metric side that Ownership doesn't touch.
- **User explanation:** *"The bank's capital base changed materially this period due to a capital infusion (e.g., government recapitalisation or a QIP). Capital-adequacy metrics are genuinely stronger; return ratios are temporarily diluted by the larger equity base rather than by weaker operations. See breakdown."*
- **Auto/Review:** **REVIEW.** Like B-5, the two-sided nature is subtle and the "is this infusion a sign of distress or of support" read benefits from a human in the loop while the pattern library builds. Promotable to auto in v6.0 once rulings are consistent.
### B-Bank-4: Treasury / Investment-Gain Inflation
- **Condition:** other income (treasury/investment gains on the bond book) exceeds 30% of PPOP **AND** `netProfit` YoY rise > 40% **AND** NII growth < 15% (the profit jump came from treasury, not core lending).
- **Threshold:** treasury/other-income **> 30% of PPOP**; NP rise **> 40%**; NII growth **< 15%** *(Bank analogue of non-financial B-4. Falling-rate environments produce large mark-to-market bond gains that inflate a bank's profit without any lending-franchise improvement; rising rates do the reverse.)*
- **Metrics affected:** SUPPRESS — F5 ROA, Net-Profit-YoY where treasury gains inflate the numerator. KEEP — M1 NIM and PPOP-*ex-treasury* growth if separable; Cost-to-Income; asset quality; CASA.
- **Solution:** **O3 Annotate** (O2 if it flips an ROA band).
- **User explanation:** *"A meaningful part of this period's profit came from treasury/investment gains (bond-book mark-to-market) rather than core lending. Profit-based return metrics have been [annotated / excluded] accordingly; margin and franchise metrics are scored normally. See breakdown."*
- **Auto/Review:** **AUTO.** Fixed map. Logged.
---
 
## 3. CATEGORY C — STRUCTURAL CHANGE
**Detection: signature-based (no clean event flag for merger/demerger). Outcome: strategic judgment. → REVIEW (least auto-able).**
 
### C-1: Revenue/Asset Step-Change (Merger or Demerger Signature)
- **Condition:** `revenue` OR `totalAssets` changes > 30% YoY in a single period **AND** no corresponding organic driver (the change is discontinuous, not a growth ramp) **AND** ideally corroborated by a `CorporateEvent` near the date.
- **Threshold:** **> 30% single-period step in revenue or assets** *(organic large-cap growth rarely exceeds ~20%/year; a >30% discontinuity signals a structural change — merger adds, demerger removes.)*
- **Metrics affected:** All YoY growth metrics (Revenue YoY, NP YoY, 3y CAGR) — the base changed, so growth comparisons are invalid for this transition period.
- **Solution:** **O4 Suppress peer comparison + O3 annotate** during the transition period; growth metrics held until clean post-event periods accumulate. Operator decides per rulebook whether the stock stays in the PG (a demerger may change what the company *is*).
- **User explanation:** *"[Stock] underwent a structural change (merger/demerger/major acquisition) this period. Year-over-year growth comparisons are paused until post-event periods are comparable. Other metrics scored normally. See breakdown."*
- **Auto/Review:** REVIEW. Operator applies the merger/demerger rulebook (below).
> **C-1 banking variant (PG5/PG6/PG7):** for banks the structural-change signature reads the **asset base — advances, deposits, or total assets — not revenue.** A bank amalgamation adds the acquired loan-and-deposit book at once, producing a >30% step in advances/deposits while "revenue" (interest income) lags a quarter. **Condition for banks:** `totalAssets` OR advances OR deposits step > 30% YoY discontinuously. This is the densest C-1 cluster in the model: the PG6 PSU cohort absorbed **six amalgamations** inside the window (SBI FY18; BoB FY20; PNB, Canara, Union, Indian FY21). The PG6 spec already handles these at derivation time (merger-year YoY flagged inorganic in the EOI log; Lens 3 excludes the merger-year observation for YoY-growth metrics M2/M3/M4 while scale-invariant ratio metrics use full history). The **live guardrail must reproduce this in production** when new amalgamation data arrives: fire C-1 on the asset-base step, suppress YoY-growth comparisons for the transition period (O4+O3), and route the PG-membership question to the operator. Bonus: for PSU mergers the surviving entity and PG are unchanged (a PSU bank stays a PSU bank), so the operator's PG-membership call is usually trivial-confirm rather than a genuine reclassification.
 
### C-2: Share-Count Discontinuity (Bonus / Split / Major Issuance)
- **Condition:** `CorporateEvent.eventType` in (bonus, split, rights) OR `noOfShares`/`adjustedSharesCr` changes > 20% between periods.
- **Threshold:** Event flag (clean), or **> 20% share-count change.**
- **Metrics affected:** Per-share metrics (EPS, book value per share). Bonus/split are cosmetic (price-adjusted); rights/issuance are real dilution.
- **Solution:** **O1 Score normally** for bonus/split (already price-adjusted in `DailyPrice`); **O3 Annotate** for rights/major issuance (real dilution, flag it).
- **User explanation (rights/issuance):** *"[Stock] issued new shares this period (rights/QIP). Per-share metrics reflect the larger share count. See breakdown."*
- **Auto/Review:** AUTO for bonus/split (clean event flags + price already adjusted). REVIEW for large issuance.
### Merger / Demerger Rulebook (operator framework, for C-1 review decisions)
 
When C-1 fires and operator reviews, the decision tree:
 
1. **Does the company still belong in this peer group?**
   - Demerger removed a *minor* segment (< ~15% of revenue): stays in PG, resume scoring post-transition. *(ITC Hotels was ~3% — ITC stays in FMCG.)*
   - Demerger removed a *defining* segment, or merger fundamentally changed the business: operator decides whether to keep, move to another PG, or split into a new PG. *(Strategic call, no auto-rule.)*
2. **When does scoring resume cleanly?**
   - Growth metrics (YoY, CAGR) resume once enough post-event periods exist for valid comparison (typically 4 quarters / 1 fiscal year post-event).
   - Level metrics (margins, ratios) resume immediately on the first clean post-event statement.
3. **Pro-forma data caution:** if the data provider back-stamps combined-entity data to pre-merger periods (the LTIM case — Screener back-stamped LTI+Mindtree to FY22), flag that the pre-event data is constructed, not as-reported. Document the limitation; do not treat back-stamped growth as real.
---
 
## 4. THE COMPLETE SIGNATURE TABLE (build reference)
 
| ID | Category | Condition (schema fields) | Threshold | Metrics affected | Solution | Auto/Review |
|---|---|---|---|---|---|---|
| A-1 | Data | QuarterlyResult absent past expected date | 45 days; 2Q→remove | Momentum TTM | O5 Hold | Auto |
| A-2 | Data | Critical Fundamental field null | binary | dependent metrics | O2 Suppress | Auto |
| A-3 | Data | History rows below spec minimum | §5.4 / §11.10 mins | Lens 3 / Ownership | O2 Fallback | Auto |
| A-4 | Data | isActive false / 10-day price gap | flag / 10 days | All | O6 Remove | Auto-detect, operator-confirm |
| B-1 | Distortion | profitYoy>100% + OPM flat + below-line>40% PAT | +100% / ±3pp / 40% | SUPPRESS ROE,ROCE,NM,TTM-NPM,NP-YoY; KEEP operating+balance-sheet | O2 (dual-exclusion) +O3 | **Auto** |
| B-2 | Distortion | NP drop>80%/negative + OPM holds + charge>40% swing | 80% / ±3pp / 40% | SUPPRESS NM,ROE,NP-YoY; KEEP operating | O2 (dual-exclusion) +O3 | **Auto** |
| B-3 | Distortion | eff tax<5% + NP swing>50% + PBT swing<25% | <5% / 50% / 25% | SUPPRESS post-tax; KEEP pre-tax | O3 (O2 if band-flip) | **Auto** |
| B-4 | Distortion | otherIncome>30% of PBT | 30% | SUPPRESS profit-based; KEEP operating | O3 (O2 if band-flip) | **Auto** |
| B-5 | HoldCo | netWorth drop>25% + NP positive + promoter>50% | 25% / >50% | ANNOTATE ROE,ROCE (inflated, not suppressed) | O3 Annotate | **Review** |
| C-1 | Structural | revenue/assets step>30% + discontinuous | 30% | growth metrics | O4+O3 | **Review** |
| C-2 | Structural | bonus/split/rights event OR shares>20% | flag / 20% | per-share metrics | O1 (bonus/split) / O3 (rights) | Auto / Review |
 
**Category B-Bank (financial-sector variant — runs INSTEAD OF non-financial B-1…B-4 for PG5/PG6/PG7; B-5 still applies to promoter-group NBFCs):**
 
| ID | Category | Condition (schema fields) | Threshold | Metrics affected | Solution | Auto/Review |
|---|---|---|---|---|---|---|
| B-Bank-1 | Distortion | NP swing (drop>50%/neg or rise>75%) + PPOP flat + below-PPOP charge>40% swing | 50%/75% / ±15% / 40% | SUPPRESS ROA,ROE,NP-YoY; KEEP NIM,C/I,CASA,Tier-1,PPOP-growth,asset-quality | O2 (dual-exclusion) | **Auto** |
| B-Bank-2 | Distortion | eff-tax<5%/neg + NP rise>50% + pretax swing<25% + exiting loss-run | <5% / 50% / 25% | SUPPRESS post-tax ROA,ROE,NP-YoY; KEEP pre-tax franchise | O3 (O2 if band-flip) | **Auto** |
| B-Bank-3 | Capital | equity base>+20% + internal-accrual<25% of rise + recap/QIP event | +20% / <25% | ANNOTATE Tier-1 (stronger, infusion-sourced) + ROA/ROE (diluted by base) | O3 Annotate | **Review** |
| B-Bank-4 | Distortion | treasury/other-income>30% PPOP + NP rise>40% + NII growth<15% | 30% / 40% / 15% | SUPPRESS ROA,NP-YoY; KEEP NIM,PPOP-ex-treasury,C/I,asset-quality | O3 (O2 if band-flip) | **Auto** |
| C-1-Bank | Structural | totalAssets/advances/deposits step>30% discontinuous | 30% | YoY growth metrics (M2/M3/M4) | O4+O3 | **Review (PSU: confirm)** |
 
**Ten signatures. Eight auto, two review (B-5 HoldCo, C-1 structural). That's the Phase 1 set.** Lean by design.
 
**Why only B-5 and C-1 stay review:**
- **B-5 (HoldCo extraction)** is the one case where the distortion *inflates* a metric (ROE/ROCE look better because equity shrank). The response is annotate-not-suppress (the ROE is real arithmetic per CN-4), and whether the inflation is material enough to warrant more than annotation is genuinely subtle. Keep human in loop until live evidence shows a clean auto-rule.
- **C-1 (structural change)** carries a strategic question code cannot answer: does the stock still belong in this peer group after a merger/demerger? That's an operator call (the rulebook in §3 guides it).
All eight other signatures are auto because their metrics-affected map is fixed, making the response deterministic.
 
---
 
## 4A. WORKED EXAMPLE — THE DUAL-EXCLUSION MECHANIC (developer reference)
 
Concrete walk-through of B-1 firing on a telecom peer group, so the code path is unambiguous.
 
**Setup:** Telecom PG has 4 peers (Stock V, Stock B, Stock J, Stock O). Foundation = 10 metrics at 10% each. This period, Stock V books a large exceptional gain (AGR-waiver type): profitYoY +420%, operating margin change +0.4pp (flat), below-operating-line amount = 110% of net profit.
 
**Step 1 — Detection.** B-1 condition tests on Stock V: profitYoy 420% > 100% ✓; |OPM change| 0.4pp ≤ 3pp ✓; below-line share 110% > 40% ✓. B-1 fires on Stock V. Affected-metrics map: suppress {ROE, ROCE, Net Margin} in Foundation, {TTM NPM, NP-YoY} in Momentum; keep operating + balance-sheet.
 
**Step 2 — Own-score exclusion (Stock V only).** Stock V's Foundation now scores on 8 metrics (dropped ROE, ROCE... wait — ROCE is Foundation, Net Margin is Momentum in standard mapping; use the actual pillar map at build). For illustration: drop the 2 suppressed Foundation metrics → Foundation scores on remaining 8 metrics, weights renormalized from 10% to 12.5% each. Stock V's Momentum drops TTM NPM + NP-YoY → scores on remaining Momentum metrics renormalized. Stock V's Market and Ownership pillars: untouched. Stock V's balance-sheet Foundation metrics (D/E, Interest Coverage): KEPT — if the waiver genuinely cut debt, that improvement flows into the score correctly.
 
**Step 3 — Peer-set exclusion (protects B, J, O).** When Stock B, J, O compute their Lens 2 (peer cross-section) scores for ROE, ROCE, Net Margin, TTM NPM, NP-YoY this period, the peer mean is computed EXCLUDING Stock V's distorted values. So the telecom peer mean for ROE that period = mean(B, J, O), not mean(V, B, J, O). Stock V's outlier doesn't drag the peer benchmark. N-of-K: "peer mean for ROE this period based on 3 of 4 peers (1 excluded: one-off)."
 
**Step 4 — Transparency.** Stock V carries a permanent flag this period: the B-1 explanation text. Stock V's detailed breakdown shows the raw distorted ROE/Net Margin values, marked "excluded from score this period — reason: one-time gain below operating line (~₹X Cr)." Nothing hidden.
 
**Result:** Stock V's headline score reflects only its trustworthy metrics this period (and the real deleveraging, if any). B/J/O's scores are clean of V's contamination. Every user sees what happened and why. Zero operator input. Fully logged.
 
**Edge note for the developer:** if suppression would drop so many metrics from a pillar that too few remain to score it meaningfully (e.g., >50% of a pillar's metrics suppressed), fall back to §14.4 pillar-exclusion for that pillar that period (exclude the whole pillar, renormalize pillar weights) rather than scoring a pillar on one or two metrics. Set the "too few remain" floor at: a pillar needs ≥ 50% of its metrics present to score; below that, exclude the pillar per §14.4.
 
---
 
## 5. THRESHOLD DETERMINATION — HOW THE NUMBERS WERE SET
 
Per the principle that code applies fixed constants we set once from data:
 
- **Thresholds set HERE, in this document, from research grounding** (not deferred, not per-PG). The numbers above are conservative defaults grounded in: observed normal large-cap profit/revenue growth (low-to-mid teens), observed one-off magnitudes (Airtel +37.5%, Biocon −54%, Vi +exceptional dwarfing operating, JK Tyre +157% on tax), and SEBI filing norms (45-day LODR).
- **Optional refinement (operator's call, NOT required for Phase 1):** if you want tighter numbers, you could ask each PG chat to report, for its cohort, the observed distribution of (profit-YoY, operating-margin-change, other-income-share, etc.) so we see where genuine distortions separate from normal volatility per sector. Then merge and review here. **My recommendation: skip this for Phase 1.** The universal conservative thresholds are sufficient to catch the embarrassing misses without false alarms. Per-PG threshold derivation is a v6.0 refinement under live evidence. Doing it now is the complexity cycle you're trying to avoid.
- **Tuning happens post-launch.** Watch what fires in live operation. If a signature false-alarms, loosen it. If it misses, tighten it. Six months of live data tunes these far better than pre-launch derivation.
---
 
## 6. WHAT THIS LAYER DOES NOT DO (honest boundaries)
 
- **Cannot detect governance events** — auditor resignation, fraud allegation, investigation, qualified audit opinion. No data feed exists. These are blind spots. Documented honestly; future news/regulatory feed required (v6.0+ data-sourcing decision, not a rule we can write now).
- **Cannot detect merger/demerger as a clean event** — `CorporateEvent` enum lacks these types. Detected by revenue/asset step-change signature only. Extending the enum is an engineering note for the data pipeline.
- **Cannot catch every accounting trick** — forex MTM, associate-profit swings, capitalization games, etc. The category framework (below-operating-line distortion) is closeable; the specific signatures are a starting set that grows with live evidence. For banks, the same framework applies below PPOP (Category B-Bank) — the bank-native starting set covers provision swings, DTA write-backs, recapitalisation, and treasury gains; it does not yet cover restructured-asset reclassification games or AT1-bond write-downs (future evidence-driven additions).
- **Banking sector class (PG5/PG6/PG7) uses Category B-Bank, not non-financial B-1…B-4** — the non-financial B-family references `operatingMargin`/below-operating-line fields banks don't report; banks route to the PPOP-based B-Bank signatures and the C-1 asset-base variant. This is a sector-class extension, additive, with zero effect on non-financial PG scoring (CN-1 preserved). Insurance (future A7) is NOT covered by either set — it needs its own variant (float, claims ratio, solvency margin) when built.
- **Does not replace the scoring engine's existing mechanics** — §14.4 pillar exclusion, §5.8 missing-lens, §6.9 cohort-mismatch, §6.4.1 SSCU all still operate in Layer 2. The guardrail is the gate before; it doesn't duplicate Layer 2 logic.
---
 
## 7. AUDIT TRAIL REQUIREMENT (mandatory)
 
Every flag fired and every outcome applied is logged: stock, date, signature ID, the data values that triggered it, the outcome applied (O1-O6), and (for review cases) the operator's ruling + reason. This log is:
- The explainability record (user/operator can trace why any score was adjusted)
- The evidence base for promoting Review signatures to Auto in v6.0 (consistent ruling patterns become auto-rules)
- The CN-6 decomposability guarantee at the guardrail layer
---
 
## 8. PHASE 1 CLOSE + PHASE 2 BANKING EXTENSION — WHAT REMAINS
 
**Phase 1 (non-financial) guardrail design is done:**
- Categories: locked (A, B, C)
- Signatures: 10, defined with full four-field units (condition, threshold, metrics-affected, solution, explanation)
- Thresholds: set here, universal, conservative, grounded
- Auto/Review split: defined, with promotion path
**Phase 2 (financial-sector) banking extension added (Category B-Bank + C-1 banking variant):**
- 5 bank-native signatures: B-Bank-1 (provision-driven profit swing), B-Bank-2 (DTA write-back), B-Bank-3 (recapitalisation capital-base discontinuity), B-Bank-4 (treasury-gain inflation), C-1-Bank (asset-base merger step). Grounded in real PG5/PG6 cases (PSU FY18–FY20 loss years, six PSU amalgamations, government recap infusions FY18–FY21).
- Reuses the §0.8 dual-exclusion mechanic, six outcomes, audit trail unchanged. Only conditions and metrics-affected maps are bank-specific.
- Routing rule: banking-PG stocks run Category A + B-Bank + C-1-Bank, and do NOT run non-financial B-1…B-4 (which reference fields banks don't report). B-5 still applies to promoter-group NBFCs.
- Additive sector-class extension — zero effect on non-financial PG scoring; CN-1 preserved.
**Remaining before code:** none for guardrail design (Phase 1 or banking). Thresholds buildable as written. Insurance (future A7) needs its own variant when built. Optional per-PG threshold refinement explicitly deferred to v6.0.
 
**Auto/Review split (final, including banking):**
- **Auto (12 of 15):** A-1, A-2, A-3, A-4 (detect-auto, removal operator-confirm), B-1, B-2, B-3, B-4, C-2 bonus/split, plus B-Bank-1, B-Bank-2, B-Bank-4. Deterministic — each has a fixed metrics-affected map or is a mechanical data-presence rule.
- **Review (3 of 15):** B-5 (HoldCo extraction — the inflation case, genuinely subtle), C-1 (structural change — strategic PG-membership call), and B-Bank-3 (recapitalisation capital-base discontinuity — two-sided, distress-vs-support read benefits from a human while the pattern library builds). C-2 rights/large-issuance and C-1-Bank also route to review (C-1-Bank usually trivial-confirm for PSU mergers).
- **Operator input needed only for B-5, B-Bank-3, C-1, C-1-Bank, C-2-rights.** Everything else runs without Master Chat or operator input. The fixed metrics-affected maps make Categories B and B-Bank deterministic and therefore auto, except the three genuinely two-sided/strategic cases.
**Next stress-test phases (separate from this document):**
- Cross-PG share comparison (does an 80 in Pharma feel like an 80 in Metals against live reality)
- Per-stock breakdown vs live data
- Then: the code-build prompt (carries deferred amendments + this guardrail layer + everything learned)
---
 
*Guardrail Layer Phase 1 Design · Master Chat · May 2026*
*Lean by design. Great-not-perfect. Two-person-team appropriate. Tune with live evidence.*