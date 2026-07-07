# Vytal — Portfolio Health Score (PHS): Mechanism Specification & Portfolio Pattern Library
 
**Version:** portfolio-spec 1.0
**Status of all numeric constants:** **DECLARED, NOT DERIVED.** The stock engine's bars come from survivor/distress distributions. We have no portfolio corpus yet, so every threshold, coefficient, and cap in this document is a **design constant set by product judgment**, not fitted to data. Calibration path is fixed: collect real user-portfolio distributions post-launch, then tune. Same anti-curve-fitting discipline as the stock engine, honestly stated. Version-stamp everything so a recalibration is a clean version bump, never a silent edit.
**Companion artifacts this inherits from:** Health Score Source of Truth (philosophy), Findings Map v1 (the Label/Signal/Read/Tool/Doesn't-mean vocabulary), Three-Lens Pattern Library v1 (the fired stock-level patterns Signals consumes), Sections 2 & 5 Rules Spec (the R/P finding engine), Portfolio Section Build Spec (where PHS surfaces).
 
---
 
## ▶ SECTION 0 — MESSAGE TO THE ARCHITECTURE CHAT (READ FIRST)
 
**What this document is.** The complete, build-ready contract for Vytal's **Portfolio Health Score (PHS)** — the position-aware health read for a user's whole book — plus the **Portfolio Pattern Library** that turns the engine's own outputs into the findings and explanations the user sees.
 
**It has two parts. They are not the same kind of thing.**
 
- **PART A — The PHS Mechanism.** This is the engine spec: buckets, the three pillars (Quality / Structure / Signals), every rule, every constant, the coverage ceiling, evaluability, edge cases, and the persistence contract. **Build the engine to this contract, exactly, the first time.** The weighted-aggregate engine is 100% net-new work — there is no existing portfolio-health code to extend. Getting the contract right before it is wired into Overview and the Health tab is the whole point of this document.
- **PART B — The Portfolio Pattern Library.** This is the **cherry on top**, and it is *downstream of Part A*. The PHS number collapses three pillars into one figure. Part B is the closed catalog of **findings the collapse hides** — concentration, sector pile-up, distress exposure, quality dispersion, coverage state, and the cross-pillar tensions ("sound companies, fragile construction"). Each finding is a **pure function of values the engine already computed in Part A** — it fabricates nothing and re-derives nothing.
**How the two parts relate to the compute-once law.** Part A computes the snapshot (number + pillars + every sub-deduction + coverage). Part B reads that snapshot and fires findings from it. **Both are computed once, at snapshot time, and stored on the snapshot.** Every surface — Overview, the Health tab, Dashboard — is a *read-only consumer* of that stored snapshot. No surface re-runs the engine. This is the same compute-once/read-everywhere law the stock engine already lives by; honor it from the start.
 
**How Part B combines with the existing stock-level Three-Lens library.** They stack, they do not merge:
- The **stock-level** three-lens patterns (LM/LP) already fire *per holding*. On a portfolio surface, they are the **per-holding texture** ("this holding leads a weak field").
- The **portfolio-level** patterns (PF, defined in Part B) fire *about the book as a whole* ("42% of your capital sits in eroding-breadth holdings").
- The architecture chat generates the portfolio UI's dynamic findings from **PF patterns as the headlines**, and may drill into the **per-holding LM/LP patterns as supporting evidence** when a user expands a holding. Anti-double-count rules for this are in §B.7.
**The three hard prerequisites** (Part A cannot be built without these — they belong in the data-layer contract):
1. **Holdings + Transactions tables** (net-new; the transaction ledger is source of truth, holdings derived, per the Portfolio Section Build Spec).
2. **A symbol master for EVERY holding**, in-universe or not — carrying **market price**, **market-cap tier** (large/mid/small from the published AMFI–SEBI classification, refreshed semi-annually), and **sector**. The NAV replay already forces a price row per holding; tier and sector ride the same pipe. Without this, buckets and Structure cannot be computed.
3. **Read access to the fired-findings store** (the persisted, already-deduplicated R/P and LM/LP findings per holding). Signals consumes these; it does not recompute them.
**What NOT to do** (the same locks as the rest of the platform, restated because PHS is where they are most tempting to break):
- **No advice.** No "trim," "rebalance," "diversify," "reduce," "add." PHS and its findings describe *what is*, never *what to do*. This is spelled out and enforced in §B.0 — treat it as inviolable.
- **No prediction.** Nothing says a book "will underperform" or a holding "will fall."
- **No juxtaposing health against returns.** The Performance tab stays health-free (legal boundary). PHS never appears next to XIRR/returns as if one explains the other.
- **Field-verdicts never penalize.** A stock being "best of a weak field" (LM3/LP2) is a fact about a peer group. It must **never** deduct from Signals and must **never** become a negative portfolio finding. It may appear only as explicitly-neutral environmental context (§B.6).
- **Honest-empty over fabricated.** A pillar or finding that cannot be computed renders as that honest state — never as a pass, a fail, or an invented value.
**Build order suggested:** symbol master + buckets → Quality → Structure (S1–S5) → Signals (consume findings) → combine + ceiling + band → persistence/fingerprint → then Part B findings on top → then hand the stored snapshot to the UI chat. Verify each stage against the worked examples in §A.9 before moving on.
 
Everything below is the contract.
 
---
 
# PART A — THE PHS MECHANISM
 
## A.1 · The idea, in one line
 
> **Your holdings' quality is the score. Bad construction and active red flags can only pull it down. How much of your book we have actually verified caps how confident the score is allowed to be.**
 
Quality is the **anchor**. Structure and Signals are **penalty-only** — they start at a perfect 100 and can only lose points, so they subtract from Quality but can never inflate it. This is deliberate and load-bearing: construction cannot make companies better, so the engine is built so it *mathematically cannot* add points on top of quality. (This is the fix for the bug where a well-built one-stock book scored above its own stock.)
 
## A.2 · The master formula
 
```
PHS_raw = Quality
          − 0.30 × (100 − Structure)
          − 0.20 × (100 − Signals)
 
PHS_raw = max(0, PHS_raw)                      // floor
 
PHS     = min(PHS_raw, ceiling(coverage))      // coverage ceiling
 
band    = band_of(PHS)
```
 
Sanity of the coefficients: if Structure = 100 and Signals = 100, PHS_raw = Quality (perfect construction passes quality through untouched). Worst case Structure = 0 costs 30; worst case Signals = 0 costs 20; **maximum total drag = 50 points off Quality.** A book of genuinely strong stocks (Quality 80) with catastrophic construction and flags floors at 30 — never negative, never zero-from-quality-alone.
 
## A.3 · Stage 0 — Ledger & symbol master (data-layer prerequisite)
 
Before any scoring, resolve the portfolio from the transaction ledger into current holdings, and attach to **every** holding (scored or not):
 
- `market_value_i` — quantity × current price (from symbol master).
- `mcap_tier_i` ∈ { large, mid, small } — from the published AMFI–SEBI classification list (top 100 = large, 101–250 = mid, rest = small), refreshed semi-annually. **This is an external, published line — never our judgment.**
- `sector_i` — NSE sector, or `unknown` if the holding is outside all coverage and no sector is resolvable.
- `health_i` — the stock's current health snapshot **if it is one of our scored stocks**; otherwise null.
- `findings_i` — the set of fired R/P and LM/LP findings for the holding from the findings store (empty if unscored — we fire no findings on stocks we do not score).
**Weights** (whole book, always sum to 1 across *all* holdings):
```
w_i = market_value_i / Σ_all market_value
```
 
## A.4 · Stage 1 — Bucket classification
 
Every holding lands in exactly one bucket:
 
| Bucket | Definition | Has health? | Effect on the score |
|---|---|---|---|
| **Scored** | One of our ~93 scored stocks | Yes | Drives Quality; can be hit in Signals |
| **Recognized-unscored** | large- or mid-cap, NSE main board, not yet covered (e.g. Tata Motors today) | No | Excluded from Quality; counts against coverage; **no deductions anywhere** |
| **Small-unscored** | small / micro / SME, not covered | No | Excluded from Quality; counts against coverage; **S5-eligible only** |
 
**This split is the answer to the "don't penalize me for holding Tata Motors" problem.** A recognized-unscored holding is a substantial name we simply haven't reached — it is treated gently (it only lowers coverage, which caps *our* claim, not the user's score). A small-unscored holding carries genuine unverifiable-volatility risk, so it is the *one* place an unscored holding can deduct (S5). When we later score a recognized-unscored name, that user's coverage rises and their ceiling lifts automatically — correct product pressure, on us.
 
## A.5 · Stage 2 — Quality pillar (the anchor)
 
Position-weighted average of health, **renormalized over the scored holdings only**:
 
```
Let S = { scored holdings }
Quality = Σ_{i∈S} (w_i × health_i) / Σ_{i∈S} w_i
```
 
- Unscored holdings are simply **absent** from this average. We never assign them a number — assigning "unknown = 40" would conflate a coverage gap with a quality verdict, which is banned.
- If `Σ_{i∈S} w_i = 0` (no scored holdings at all) → **Quality is not evaluable → PHS is not produced.** Instead, surface a Structure-only "construction read" (§A.8, zero-coverage row), clearly labeled as construction-only, no health number.
## A.6 · Stage 3 — Structure pillar (starts at 100, penalty-only, whole book)
 
Weights are known even for unscored holdings, so Structure reads the **entire** book. Start at 100, apply all applicable deductions, floor at 0.
 
| ID | Name | Trigger | Deduction | Per-item cap |
|---|---|---|---|---|
| **S1** | Single-position size | any holding weight > **15%** | −1.5 per percentage-point over 15 | −25 per holding |
| **S2** | Sector pile-up | largest sector weight > **40%** | −1.2 per percentage-point over 40 | −25 total |
| **S3** | Thin breadth | effective holdings `Neff = 1 / Σ_all w_i²` below **8** | −4.0 per whole unit of Neff below 8 | −20 total |
| **S4** | Over-diversification | holding count > **25** | −0.5 per holding over 25 | −8 total |
| **S5** | Unverified mega-position | a **small-unscored** holding with weight > **20%** | −10 per such holding | −20 total |
 
Notes that matter for the build:
- **S1** is per-holding and additive across holdings (two 22% positions each incur their own deduction, each capped at −25).
- **S2** uses summed sector weights across the whole book. Pool all `unknown`-sector value into a single `unknown` bucket. **If `unknown_sector_weight > 0.50`, S2 is NOT EVALUABLE** — do not fire it (a sector-pile-up claim on a book that's majority unknown-sector would be fabricated). When S2 is not evaluable, note it honestly in the Structure detail; the pillar simply carries no S2 deduction.
- **S3** `Neff` is the inverse Herfindahl (see §B.9 lineage). It rewards genuine spread, not raw count — eight 12.5% positions give Neff = 8; a book with one 40% position and many tiny ones gives a low Neff even with a high count.
- **S4** is intentionally mild — an unmonitorable 40-name closet index is a lesser sin than dangerous concentration, and the penalty reflects that.
- **S5** is the **only** rule where an unscored holding ever deducts, and only for **small-unscored**. Recognized-unscored (Tata Motors) is **exempt by construction** — verify the bucket before applying S5.
```
Structure = max(0, 100 − S1total − S2 − S3 − S4 − S5total)
```
 
## A.7 · Stage 4 — Signals pillar (starts at 100, penalty-only, consumes fired findings)
 
Signals **does not analyze anything.** It reads the already-fired, already-deduplicated findings per holding from the findings store and weights them by capital share. Start at 100, floor at 0.
 
**Deduction table** (each already multiplied by the holding's weight `w_i`):
 
| Source (on a holding) | Class | Deduction |
|---|---|---|
| Health in **Distress** band | headline | −120 × w_i |
| **Critical** red flag | headline | −150 × w_i |
| **High** red flag / High-severity finding | headline | −80 × w_i |
| **Medium** red flag / Medium finding | headline | −30 × w_i |
| **LP5** — eroding breadth (pillar) | breadth | −50 × w_i |
| **LP6** — hollow pillar (strong but fading) | breadth | −30 × w_i |
 
**Per-holding resolution algorithm** (run per holding, then sum across holdings):
1. Collect all candidate deductions for the holding.
2. **Headline-wins:** if **any** headline candidate fires, **suppress all breadth candidates** for that holding (they would double-count the same deterioration the headline already describes).
3. Among the surviving candidates, take the **single largest** deduction (do **not** sum a Distress band with a Critical flag on the same holding — they are two lenses on one troubled name; summing double-counts).
4. Clamp the holding's contribution to a maximum of **−200 × w_i** (a guard; rarely binds after step 3).
```
Signals = max(0, 100 − Σ_holdings (per-holding resolved deduction))
```
 
**The eligibility lock (inviolable):** the deduction table above is the **complete** set. In particular:
- **Field-verdict patterns LM3, LM4, LP2, LP3 NEVER deduct.** They are facts about a peer group, locked as neutral context. A portfolio penalty on them would silently convert "the field is weak" into "your stock is bad."
- **Metric-level LM patterns (LM1–LM8) never deduct** — they are per-holding display texture only.
- **No reward side.** Absence of penalty is the reward, consistent with the findings philosophy. Signals never rises above 100.
Everything the library fires that is *not* in the deduction table still has a job — it becomes a **portfolio finding** in Part B (texture under the number), never a hit to the number.
 
## A.8 · Stage 5 & 6 — Combine and coverage ceiling
 
**Combine** (from §A.2):
```
PHS_raw = max(0, Quality − 0.30×(100−Structure) − 0.20×(100−Signals))
```
 
**Coverage** and the **ceiling**:
```
coverage c = ( Σ_{i∈scored} market_value_i ) / ( Σ_all market_value_i )
```
 
| Coverage `c` | Ceiling on PHS | Label |
|---|---|---|
| `c ≥ 0.80` | none | — |
| `0.60 ≤ c < 0.80` | **84** | — |
| `0.40 ≤ c < 0.60` | **69** | — |
| `0.20 ≤ c < 0.40` | **54** | **Provisional** |
| `0 < c < 0.20` | **44** | **Provisional** |
| `c = 0` (no scored holdings) | **no PHS** | Construction-read only |
 
```
PHS = min(PHS_raw, ceiling(c))
```
 
**The ceiling is a confidence cap on OUR claim, not a penalty on the user.** We will not call a book "Strong" when we've verified 40% of it. It applies after the floor and after the pillar math. When it binds (i.e. `ceiling < PHS_raw`), record that fact on the snapshot — Part B fires a specific "confidence-limited read" finding (PF-V3) so the user is told *why* the number is where it is.
 
## A.9 · Stage 7 — Bands & display contract
 
**Bands** (confirm cutoffs at lock — these are the proposal):
 
| Band | Range |
|---|---|
| **Strong** | 80–100 |
| **Steady** | 65–79 |
| **Mixed** | 50–64 |
| **Fragile** | 35–49 |
| **Weak** | 0–34 |
 
**Display contract (binding, mirrors the stock engine's "never float the number alone"):** the coverage line is welded to the PHS on **every** render. The user never sees a naked number. Canonical form:
 
> **`PHS 69 · Steady — reflects 62% of value · 3 holdings unscored`**
 
with the unscored names one tap away, split into recognized vs small-unscored. Below 40% coverage the label carries **Provisional**. This is not a UI suggestion — it is part of the contract, because the number is only honest when its coverage travels with it.
 
## A.10 · Worked examples (verify the build against these)
 
### Example 1 — Typical retail book (the common case)
 
| # | Holding | Bucket | Health | Weight | Sector |
|---|---|---|---|---|---|
| 1 | HDFC Bank | scored | 74 | 20% | Financials |
| 2 | TCS | scored | 71 | 13% | IT |
| 3 | BEL | scored | 78 | 11% | Defense |
| 4 | SBIN | scored | 66 | 10% | Financials |
| 5 | Reliance | scored | 70 | 8% | Energy |
| 6 | Tata Motors | recognized-unscored | — | 12% | Auto |
| 7 | Zomato | recognized-unscored | — | 8% | Consumer |
| 8 | Smallcap IT-X | small-unscored | — | 10% | IT |
| 9 | Smallcap Y | small-unscored | — | 5% | unknown |
| 10 | Microcap Z | small-unscored | — | 3% | unknown |
 
Assume SBIN carries one **Medium** finding; Reliance carries one **LP5**.
 
- **Buckets/coverage:** scored 62% · recognized-unscored 20% · small-unscored 18% → **c = 0.62**
- **Quality** = (20·74 + 13·71 + 11·78 + 10·66 + 8·70) / 62 = 4481 / 62 = **72.3**
- **Structure:** S1 HDFC 20% → 5 over → −7.5. All others ≤13%. S2: max sector Financials 30% < 40% → 0 (unknown 8% < 50%, evaluable). S3: Σw² = 0.04+0.0169+0.0121+0.01+0.0064+0.0144+0.01+0.0025+0.0009 = 0.1132 → Neff = 8.83 > 8 → 0. S4: 10 < 25 → 0. S5: largest small-unscored 10% < 20% → 0. → **Structure = 92.5**
- **Signals:** SBIN Medium −30×0.10 = −3.0 (no headline conflict); Reliance LP5 −50×0.08 = −4.0 (no headline on Reliance, so breadth applies). → **Signals = 93.0**
- **Combine:** 72.3 − 0.30×7.5 − 0.20×7.0 = 72.3 − 2.25 − 1.40 = **68.65**
- **Ceiling:** c = 0.62 → cap 84 → does not bind.
- **Result: `PHS 69 · Steady — reflects 62% of value · 3 holdings unscored`.**
Note the behavior: a decent ~72-quality book lands at **69**, not higher — one oversized bank position and two findings shaved it, and Structure could never push it *above* its holdings. The anchor is working.
 
### Example 2 — Multibagger believer (concentration + blindness)
 
Holdings: Smallcap-X **45%** (small-unscored), another 15% (small-unscored), RIL 15% (70), TCS 15% (71), BEL 10% (78). → scored 40%, **c = 0.40**.
 
- **Quality** = (15·70 + 15·71 + 10·78) / 40 = (1050+1065+780)/40 = 2895/40 = **72.4**
- **Structure:** S1 on 45% → 30 over → −45 → capped **−25**. S3: Σw² = 0.2025+0.0225+0.0225+0.0225+0.01 = 0.29 → Neff = 3.45 → 4.55 units below 8 → −18.2 → capped at −20? (−4×4.55 = −18.2, under the −20 cap) → −18.2. S5: 45% small-unscored > 20% → −10. S2: unknown-sector share (X 45% + other 15% = 60%) > 50% → **not evaluable**, no S2. → Structure = 100 − 25 − 18.2 − 10 = **46.8**
- **Signals:** clean → **100**
- **Combine:** 72.4 − 0.30×53.2 − 0 = 72.4 − 15.96 = **56.4**
- **Ceiling:** c = 0.40 → cap 69 → does not bind.
- **Result: `PHS 56 · Mixed — reflects 40% of value · 2 holdings unscored`.** Concentration and blindness are priced in; the number still stands honestly instead of going dark.
### Example 3 — Clean, fully-covered book
 
12 scored holdings ~8% each, avg health 72; one 8% holding carries a **High** deterioration finding **and** LP5. → **c = 1.00**.
 
- **Quality** ≈ **72** · **Structure** = 100 (nothing trips) · **Signals:** the High is a headline → LP5 suppressed on that holding → −80×0.08 = −6.4 → **93.6**
- **Combine:** 72 − 0 − 0.20×6.4 = 72 − 1.28 = **70.7** → **`PHS 71 · Steady`**, no cap, no caveat.
### Example 4 — The stress case: 1 of 10 scored
 
One scored stock at 80 (10% weight), nine unscored, structure otherwise clean. → **c = 0.10**.
 
- **Quality** = 80 (over the scored 10% only). Structure/Signals ≈ 100. PHS_raw ≈ **80** (minus small structure hits from the tiny weights).
- **Ceiling:** c = 0.10 → **cap 44 · Provisional.**
- **Result: `PHS 44 · Provisional — reflects 10% of value · 9 holdings unscored`.** The number exists, is honest, and **cannot flatter**. This is the case that killed every naive "just average the scored ones" approach.

> **⚠ portfolio-spec 1.1 ERRATUM (Change 3 — c_eff ceiling).** Under 1.1 the ceiling is
> looked up on **effective** coverage `c_eff = c + 0.40 × recognized-unscored weight`, not
> raw `c`. This example's nine unscored names are large-cap (**recognized-unscored**), so
> `c_eff = 0.10 + 0.40×0.90 = 0.46` → ceiling **69**, and the result becomes
> **`PHS 69 · Steady`** (displayed coverage still 10%, still **Provisional**). Example 4 is
> the intended beneficiary of Change 3, so it MOVES under 1.1. The amendment's verification
> note *"the other 4 worked examples still hold"* was scoped to Change 1 only and is an
> erratum with respect to Change 3 — Ex4 correctly moves 44 → 69. (Proof the loosening is
> earned, not blanket: the same book with **small-unscored** names keeps `c_eff = 0.10` →
> ceiling **44**, since small-unscored contributes 0 to `c_eff`. Both asserted in
> `verify-phs-examples.ts`.) Ex1/Ex3 are unchanged; Ex2 shifts on Change 1 (S1 −25 → −22.5)
> but its published PHS stays **57**.
**Sanity invariants the build must satisfy** (assert these in tests):
- A single-stock book of a health-70 stock resolves to ~56 (S3 thin-breadth drag), **below** the stock's own 70 — a portfolio is never *safer* than its lone holding.
- A perfectly-built book of health-72 stocks resolves to ~72, **not** inflated upward.
- PHS can **never** exceed `Quality` (penalty-only guarantees it) and can never exceed the coverage ceiling.
## A.11 · Evaluability & honest degradation (consolidated)
 
| Situation | Behavior |
|---|---|
| No scored holdings (`c = 0`) | No PHS. Construction-read only (Structure detail, no health number, clearly labeled). |
| `unknown_sector_weight > 0.50` | S2 not evaluable — omitted, noted honestly. Structure still computes from S1/S3/S4/S5. |
| A holding has no fired findings (all unscored, or scored-and-clean) | Contributes nothing to Signals. Not an error. |
| Coverage ceiling binds | PHS held at ceiling; snapshot flags it; PF-V3 fires to explain. |
| Fewer than the peer-minimum holdings exist in a sector for a stock's own LM/LP evaluation | That is the **stock** engine's concern (honest-empty there). PHS reads whatever fired; it never forces a field-verdict. |
 
**Governing principle:** every "can't compute" is an **honest state**, surfaced as itself — never a zero, never a fabricated fill. Identical to the stock engine's honest-empty law.
 
## A.12 · Persistence contract (compute-once, append-only)
 
**One snapshot per (portfolio, compute-event), append-only.** The snapshot is the single source every surface reads.
 
**Snapshot payload:**
- `phs`, `band`, `phs_raw`, `ceiling_applied` (bool + value)
- `quality`, `structure`, `signals`
- `coverage` (+ scored/recognized-unscored/small-unscored value splits)
- **Full deduction ledger:** every fired S-rule with its points; every per-holding resolved Signals deduction with the winning source
- `fired_portfolio_findings`: list of PF IDs (Part B) with their bound values
- `constant_version` (= `portfolio-spec 1.0`), `timestamp`, `fingerprint`
**Fingerprint** = hash of: { holdings-and-weights vector, the set of constituent **health-snapshot IDs**, the set of fired-**finding IDs** per holding, symbol-master tier/sector versions, `constant_version` }. **If the fingerprint is unchanged from the latest snapshot, skip the write** (no duplicate snapshots).
 
**Recompute triggers** (any one → recompute; skip-write if fingerprint unchanged):
1. A new transaction changes holdings or weights.
2. Any constituent stock is **rescored** (health snapshot ID changes) — PHS *reads* the new score, does not recompute it.
3. The findings engine re-fires for any held stock (finding-ID set changes).
4. Symbol-master refresh reclassifies a holding's **mcap tier** or resolves a previously-**unknown sector** (semi-annual AMFI cycle, or a newly-covered name).
5. `constant_version` bump (a calibration release).
**Dry-run checkpoint** before the first mass backfill of historical portfolio snapshots, per standing practice.
 
## A.13 · Constants table (single source of truth — stamp `portfolio-spec 1.0`)
 
| Symbol | Meaning | Value |
|---|---|---|
| `W_STRUCT` | Structure penalty weight | 0.30 |
| `W_SIGNAL` | Signals penalty weight | 0.20 |
| `S1_THRESH` / `S1_RATE` / `S1_CAP` | Single-position: threshold / per-pt / per-holding cap | 15% / 1.5 / 25 |
| `S2_THRESH` / `S2_RATE` / `S2_CAP` | Sector pile-up: threshold / per-pt / cap | 40% / 1.2 / 25 |
| `S2_UNKNOWN_KILL` | S2 not-evaluable if unknown-sector weight exceeds | 50% |
| `S3_TARGET` / `S3_RATE` / `S3_CAP` | Breadth: Neff target / per-unit / cap | 8 / 4.0 / 20 |
| `S4_THRESH` / `S4_RATE` / `S4_CAP` | Over-diversification: count / per-holding / cap | 25 / 0.5 / 8 |
| `S5_THRESH` / `S5_PER` / `S5_CAP` | Unverified mega: small-unscored weight / per-holding / cap | 20% / 10 / 20 |
| `SIG_DISTRESS/CRIT/HIGH/MED` | Signals base deductions (×weight) | 120 / 150 / 80 / 30 |
| `SIG_LP5 / SIG_LP6` | Breadth-pattern base deductions (×weight) | 50 / 30 |
| `SIG_HOLDING_CAP` | Per-holding Signals clamp (×weight) | 200 |
| `CEIL_80/60/40/20` | Coverage ceilings by band | none / 84 / 69 / 54 / 44 |
| `PROVISIONAL_BELOW` | Provisional label below coverage | 40% |
| `BANDS` | Strong/Steady/Mixed/Fragile/Weak | 80 / 65 / 50 / 35 |
 
---
 
# PART B — THE PORTFOLIO PATTERN LIBRARY
 
## B.0 · What this is, and the one rule that governs it
 
The PHS is one number standing on three pillars and a coverage figure. **That collapse hides true facts** — a 67 built on great companies badly weighted is a different animal from a 67 built on mediocre companies safely spread. This library is the **closed catalog of the facts the collapse hides**, expressed as findings the user reads.
 
Every finding here is a **pure function of values Part A already computed** (`Quality`, `Structure`, each S-rule, `Signals`, per-holding deductions, `coverage`, bucket splits, and the fired stock-level patterns). **It fabricates nothing and re-derives nothing** — same compute-once law as everything else.
 
Faces (identical vocabulary to Findings Map v1): each finding carries **Label · Signal · Read · Doesn't-mean · Tone**, plus a **Loud/Quiet** triage (does it escalate to a top finding card, or stay as texture) and a **Bind** (which engine values it reads).
 
**THE INVIOLABLE RULE — this is the three-lens library's §0.3, applied to portfolios:**
 
> **A portfolio finding describes what the book IS. It never says what to DO, and never says what will happen NEXT.**
 
The instant a finding says "so trim," "consider rebalancing," "reduce exposure," "this will hurt returns," it has become advice or prediction, broken the platform's spine, and does not belong here.
 
- ✅ "38% of your capital sits in a single holding — the health read leans heavily on that one name."
- ❌ "38% is too concentrated — consider trimming to reduce risk."
The Read states the structural fact and, at most, **how to read the health number in light of it** — never an instruction. Enforce this in the copy the architecture chat generates.
 
**Naming:** `PF` = Portfolio Finding, grouped into six families. Tones are the platform's descriptive set — **Constructive / Neutral / Caution / Concern** — never Buy/Sell, never green-as-good.
 
## B.1 · Family PC — Concentration (structural bet-size)
 
*Reads the whole book's weight distribution. These findings are the **headline** for the S-rule deductions already in the number — see anti-double-count §B.7.*
 
| ID | Trigger (Bind) | Label | Tone | Loud? |
|---|---|---|---|---|
| **PC1** | any single holding weight > 25% (S1 fired hard) | **Heavy single position** | Caution | Loud |
| **PC2** | any single holding weight > 40% | **Dominant single position** | Concern | Loud |
| **PC3** | largest sector weight > 40% (S2 fired) | **Sector concentration** | Caution | Loud |
| **PC4** | largest sector weight > 60% | **Single-sector book** | Concern | Loud |
| **PC5** | Neff < 5 (S3 fired hard) | **Thin effective spread** | Caution | Loud |
 
**PC1 · Heavy single position.**
- **Signal:** a holding crosses 25% of book value this snapshot.
- **Read:** "Your largest holding is `X%` of the book. Its health contributes `X%` of the aggregate, so the portfolio read leans heavily on this one name." State the name and its own health band.
- **Doesn't-mean:** ≠ the position is a mistake, ≠ it will fall, ≠ you should trim. Concentration is a structural fact about how much the score depends on one name — not a judgment on the name or a call to act.
**PC3 · Sector concentration.**
- **Signal:** a sector crosses 40% of book value.
- **Read:** "`Sector` makes up `X%` of your book. Health and risk in this book move substantially with that one sector's fortunes." (Indian-market aware: 40% is the trigger precisely because financials-heavy books are normal — this fires only past that.)
- **Doesn't-mean:** ≠ over-exposed in a bad way, ≠ the sector will underperform. It is a statement about how sector-dependent the read is, nothing more.
**PC5 · Thin effective spread.**
- **Bind:** `Neff`. **Read** must explain Neff plainly: "Although you hold `N` stocks, weight is concentrated enough that your book behaves like roughly `Neff` equally-sized positions." **Doesn't-mean:** ≠ you don't own enough stocks — it's about weight distribution, not count.
## B.2 · Family PB — Breadth & diversification quality
 
| ID | Trigger (Bind) | Label | Tone | Loud? |
|---|---|---|---|---|
| **PB1** | Neff ≥ 8 and no sector > 40% | **Well-spread book** | Constructive | Quiet |
| **PB2** | holding count > 25 (S4 fired) | **Very broad book** | Neutral | Quiet |
| **PB3** | holding count > 40 | **Closet-index breadth** | Caution | Quiet |
 
**PB3 · Closet-index breadth.**
- **Read:** "With `N` holdings, your book approaches an index in breadth — individual position moves have little effect on the whole, and it is a lot to monitor by hand." **Doesn't-mean:** ≠ too many stocks is wrong, ≠ you should consolidate. Descriptive only. (Mirror of PC — over-spread and over-concentrated are both just *states*.)
## B.3 · Family PQ — Quality composition (what the average hides)
 
*This family is the direct portfolio analogue of the three-lens library's core insight: **the average hides the split.** Two books with the same Quality can be uniform-mediocre or a barbell of strong and weak.*
 
| ID | Trigger (Bind: scored-holding health distribution) | Label | Tone | Loud? |
|---|---|---|---|---|
| **PQ1** | Quality ≥ 75 and health dispersion low (all scored holdings ≥ 65) | **Uniformly sound holdings** | Constructive | Quiet |
| **PQ2** | health std-dev across scored holdings above tolerance (e.g. a Strong name and a Weak name both material weights) | **Split quality (barbell)** | Neutral | Loud |
| **PQ3** | Quality ≤ 55 with low dispersion (most scored holdings clustered mid/low) | **Uniformly ordinary holdings** | Caution | Quiet |
| **PQ4** | a single holding in the **Weak/Fragile** health band at weight ≥ 10% | **Weak name at size** | Caution | Loud |
 
**PQ2 · Split quality (barbell).**
- **Signal:** dispersion crosses tolerance this snapshot.
- **Read:** "Your average health of `Quality` hides a split — you hold both strong names (`…`) and weak ones (`…`) at meaningful weight. The single number sits in the middle of two different stories." Name the top and bottom scored holdings.
- **Doesn't-mean:** ≠ the weak names are mistakes, ≠ sell the low ones and keep the high ones. It names a *distribution the average compressed* — the exact job of this library, never an instruction.
**PQ4 · Weak name at size.**
- **Bind:** a scored holding in Weak/Fragile at ≥10% weight. **Read:** names it, states its band and weight, notes it as a material drag on Quality. **Doesn't-mean:** ≠ it will fall, ≠ exit it. A health band is not a price call.
## B.4 · Family PS — Signal exposure (capital-weighted red flags)
 
*Aggregates the fired stock-level findings that Signals deducted on, expressed as capital exposure. This is the portfolio face of the flags layer.*
 
| ID | Trigger (Bind: per-holding fired findings × weight) | Label | Tone | Loud? |
|---|---|---|---|---|
| **PS1** | Σ weight of holdings carrying any **Critical/High** flag ≥ 10% | **Capital under active red flags** | Concern | Loud |
| **PS2** | any holding in **Distress** band at weight ≥ 5% | **Distress exposure** | Concern | Loud |
| **PS3** | Σ weight of holdings with **LP5 (eroding breadth)** ≥ 25% (and not already headlined) | **Broad-erosion exposure** | Caution | Loud |
| **PS4** | Σ weight of holdings with **LP6 (hollow pillar)** ≥ 25% | **Fading-strength exposure** | Caution | Quiet |
| **PS5** | no holding carries any deducting finding | **No active red flags** | Constructive | Quiet |
 
**PS1 · Capital under active red flags.**
- **Signal:** the flagged-capital share crosses 10% this snapshot.
- **Read:** "`X%` of your book by value sits in holdings with active `Critical/High` red flags (`names`). These are the holdings the model is currently warning on." Link each to its stock-view flag Read.
- **Doesn't-mean:** ≠ these will fall, ≠ sell them. A red flag is "go look hard," never a trade signal (inherited verbatim from Findings Map #13).
**PS2 · Distress exposure.**
- **Bind:** a Distress-band holding at ≥5%. **Read:** names it, states the weight, links to its health page. **Doesn't-mean:** ≠ bankruptcy call, ≠ exit instruction.
## B.5 · Family PV — Visibility & coverage (honesty made visible)
 
*The portfolio face of the platform-wide coverage gap. These findings are how the ceiling and the bucket split are explained to the user.*
 
| ID | Trigger (Bind: coverage, bucket splits, ceiling) | Label | Tone | Loud? |
|---|---|---|---|---|
| **PV1** | `c ≥ 0.90` | **Fully verified book** | Constructive | Quiet |
| **PV2** | `c < 0.60` | **Partly verified book** | Neutral | Loud |
| **PV3** | coverage ceiling **binds** (`ceiling < PHS_raw`) | **Confidence-limited read** | Neutral | Loud |
| **PV4** | recognized-unscored weight ≥ 15% | **Awaiting-coverage names** | Neutral | Quiet |
| **PV5** | small-unscored weight ≥ 25% | **Untracked small-caps in book** | Caution | Quiet |
 
**PV3 · Confidence-limited read (the meta-finding — the most on-brand item in this library).**
- **Signal:** the ceiling begins binding this snapshot.
- **Read:** "Your verified holdings read healthy, but we've confirmed only `X%` of your book by value, so the score is held at `ceiling` rather than the `PHS_raw` the verified portion alone would suggest. The read rises as more of your holdings are covered." This tells the user the number is capped by **our** coverage, not their quality.
- **Doesn't-mean:** ≠ your book is unhealthy, ≠ the unscored names are bad. It is a statement about the *limits of what we can currently verify*.
**PV4 vs PV5 — the Tata Motors distinction, surfaced.** PV4 (recognized-unscored) is framed neutrally — substantial names we'll cover. PV5 (small-unscored) is framed as genuine untracked-volatility context. Copy must keep them distinct; never lump "unscored" into one scolding bucket.
 
## B.6 · Family PX — Cross-pillar tension (the cherry on the cherry)
 
*The richest family, and the clearest expression of the governing idea: **the information is in the disagreement between pillars.** When Quality, Structure, Signals, and coverage point different ways, the single PHS has hidden a real structural fact. These findings name it.*
 
| ID | Trigger (Bind: pillar values) | Label | Tone | Loud? |
|---|---|---|---|---|
| **PX1** | Quality ≥ 70 **and** Structure ≤ 60 | **Sound companies, fragile construction** | Caution | Loud |
| **PX2** | Structure ≥ 85 **and** Quality ≤ 55 | **Well-built, ordinary components** | Neutral | Loud |
| **PX3** | Quality ≥ 65 **and** Signals ≤ 60 | **Sound holdings, active deterioration** | Caution | Loud |
| **PX4** | Quality ≥ 70 **and** Structure ≥ 80 **and** Signals ≥ 85 **and** `c ≥ 0.80` | **Broad strength** | Constructive | Loud |
| **PX5** | environmental: Σ weight of holdings whose fired pattern is a **field-weak verdict** (LM3/LP2) ≥ 30% | **Weak-field environment** | Neutral | Quiet |
 
**PX1 · Sound companies, fragile construction.** The classic "great stocks, but 60% in two names."
- **Read:** "The businesses you hold are individually healthy (Quality `Q`), but the way they're weighted concentrates the book (Structure `S`). Your holdings' quality and your book's construction are telling different stories." Point to the specific S-rule(s) that fired.
- **Doesn't-mean:** ≠ rebalance, ≠ the concentration will backfire. It names the *tension the single number blended away*.
**PX3 · Sound holdings, active deterioration.**
- **Read:** "Your holdings are fundamentally decent (Quality `Q`), but several carry active red flags right now (Signals `S`). Long-run quality and current warnings diverge in this book." Link to the PS-family detail.
- **Doesn't-mean:** ≠ the deterioration will continue (no prediction), ≠ act.
**PX5 · Weak-field environment — the field-verdict, surfaced without ever penalizing.** This is how the library honors the three-lens field-verdict richness while obeying the lock.
- **Read:** "A notable share of your book is in holdings our engine reads as leading **weak fields** — the peer groups themselves are soft on key metrics right now. This is context about the *environment* your holdings sit in, not a judgment on the holdings." **Explicitly neutral tone. It NEVER deducts (that lock lives in Part A §A.7) and NEVER carries Caution/Concern.**
- **Doesn't-mean:** ≠ your stocks are weak (they may lead their field), ≠ these sectors will underperform. A fact about ponds, not fish.
## B.7 · Anti-double-counting (binding — headlines vs the number)
 
The S-rules and Signals deductions are **already in the PHS**. The PF findings are the **explanation** of that same math — they must not present a single fact as two separate problems.
 
- **PC-family is the headline for S1/S2/S3.** When PC1 fires, the S1 deduction is *why the number is where it is* — present PC1 as the explanation, not as an additional penalty. The number already carries the hit once.
- **PS-family is the headline for the Signals deductions.** Same rule.
- **Within a holding, headline-wins already applied in Part A** — so PS3/PS4 (breadth-pattern exposure) only fire for holdings that did **not** already trigger a PS1/PS2 headline (mirrors §A.7 step 2).
- **PX-family reads pillar *relationships*** and is orthogonal to the single-pillar PC/PS findings — both may fire, they describe different things (a PC concentration finding says "one position is large"; PX1 says "your quality and structure disagree"). Never merge them.
- **Stock-level LM/LP patterns are per-holding evidence *under* a PF finding**, never competing top-level cards on the portfolio surface. When a user expands a flagged holding, its own LM/LP Reads appear — as the texture beneath the portfolio headline. (This is the §5.3 rule of the three-lens library, applied across the stack.)
## B.8 · Loud/Quiet triage & how the UI consumes this (eligibility, not pixels)
 
*Placement and visual treatment are the UI chat's decision. This library states only eligibility and priority.*
 
- **Loud findings** are eligible to escalate to top-level portfolio finding cards (the "why is my score here" layer, analogous to the stock page's §5 Notable Findings). Priority order when several fire: Concern > Caution > Neutral > Constructive; within a tone, higher capital-weight first.
- **Quiet findings** stay as secondary texture (detail rows, expandable sections) — present, never suppressed, but not headlined.
- **The Constructive findings matter.** PX4, PB1, PQ1, PS5, PV1 exist so the surface is not a scold — a healthy, well-built, fully-verified book should *say so* loudly. Balance is a platform value.
- **Every PF finding stored on the snapshot carries its Bind values**, so the UI renders exact numbers ("38%", "Neff 3.4", "42% of value") without recomputing anything.
## B.9 · Lineage — the established ideas each part echoes (quotable to users)
 
Not a replica of any one framework — each pillar independently lands on a concept the industry already trusts, which is exactly what makes it honestly quotable:
 
- **Quality (weighted-average holding quality)** — the standard constituent-roll-up used in fund analytics (Morningstar-style aggregate quality). We use our health score as the per-holding input.
- **S3 Breadth / Neff** — this is literally the **inverse Herfindahl–Hirschman Index (HHI)**, the concentration measure economists and regulators use, expressed as "effective number of holdings." Fully standard, fully citable.
- **S1 / S2 position & sector limits** — echo **Modern Portfolio Theory's** diversification principle (Markowitz) and the spirit of regulated fund concentration caps such as the European **UCITS 5/10/40 rule** — no single position dominates, no single sector runs away.
- **Penalty-only construction** — reflects the core risk-management view that diversification *reduces* damage but does not *manufacture* quality. Structure can protect a book, never upgrade it.
- **Coverage ceiling** — mirrors how serious index and data providers **discount for incomplete data** rather than overclaim on partial coverage. "Confidence scales with completeness" is a respected data-integrity stance.
**Suggested user-facing line:** *"Vytal's Portfolio Health is built on established portfolio-construction principles — effective diversification (an HHI-based breadth measure), concentration discipline, and holding-quality aggregation — expressed through Vytal's own health engine."* True, names real concepts, claims to clone nothing.
 
## B.10 · The one test (mirrors the platform's one test)
 
A candidate portfolio finding qualifies for this library only if:
 
> **It names a true structural fact the PHS collapse hid, is a pure function of values the engine already computed, makes the user a sharper reader of their own number, shows the reasoning, and says nothing about what to do or what happens next.**
 
If it advises, predicts, penalizes a field-verdict, or fabricates — it is not a portfolio finding, and it does not belong here.
 
---
 
*End of specification. Part A is the engine contract; build to it exactly. Part B is the findings layer that reads the engine's stored snapshot and, together with the existing per-holding three-lens patterns, produces the portfolio surface's dynamic explanations. All constants are `portfolio-spec 1.0` — declared, not derived; calibrate on real portfolio distributions post-launch via a clean version bump.*