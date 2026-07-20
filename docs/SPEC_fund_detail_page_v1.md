# Vytal — Fund / ETF Detail Page
## Specification v1 · design intent, structure, states

---

## 1. Why this page exists

Groww's fund page is unbuildable here, and that turned out to be the best news in this chapter.

Every hero field on it — AUM, expense ratio, minimum SIP, exit load, launch date, riskometer,
holdings, star rating — is a column we do not hold. Chasing that page means shipping six empty boxes
and a worse version of a product that already exists, made by a company with better data and a
distribution business to fund it.

What we hold instead is what nobody shows a retail investor:

> rolling 1-year windows with a positive rate · max drawdown at 1/3/5 years · Sharpe · Sortino ·
> volatility · rank within a real category bucket · benchmark-relative alpha, beta, tracking error ·
> and, for every one of these, **a stated reason when we won't publish it**

Groww says **+28.15%, 3Y**. We can say:

> **+28.15% a year over three years. You'd have sat through a 34% fall to get it. Positive in 71% of
> rolling one-year windows.**

Same fund. Same data. A completely different claim about what matters. That is the fund-page
equivalent of what the health score does for stocks: not a verdict — the truth the headline number
hides.

**This page never scores a fund.** We don't score funds, we won't, and we don't imply it. No rating,
no stars, no grade, no aggregate. The page's job is to make the fund's own record legible and to be
honest about what it can't say.

---

## 2. The four rules this page is built on

**2.1 Risk leads.** The return is never alone and never first-among-equals. Drawdown and rolling
consistency sit beside it at the same weight. A number that says "+28%" without saying "and it fell
34% on the way" is a half-truth, and half-truths are what tip culture is made of.

**2.2 Nulls are content, not gaps.** `ret1y` is 58% populated. `ret3y` 46%. `ret5y` 33%. Benchmark
31.7%. **13,630 of 14,041 funds carry a non-empty omissions ledger.** A page with nulls in it is not
the exception here — it is the median. So the reason component is not error handling; it is the
page's most-used element, and it must read as rigour. A dash is a shrug. A `0` is a claim. Neither is
allowed.

**2.3 One fund, one page.** The page is a **family** (3,489 funds + 334 ETFs), not a scheme (13,704).
Direct/Regular × Growth/IDCW of the same fund is one product with four billing arrangements. Plan is
selected within the page.

**2.4 The page never contradicts itself.** The chart is now correct by construction — it draws
`series_scheme_code`, the same series the metrics were measured on, split-adjusted by the same shared
rule. Do not recompute anything client-side. Do not draw a series the metrics didn't come from.

---

## 3. Structure

One scroll. No tabs.

### 3.1 Identity

- **Family name** — `canonicalName`.
- **Fund house** — `fundHouse` (51 distinct, display-ready).
- **Category** — `instruments.category`. AMFI free-text; the leaf from `normaliseCategory` is the
  display form. Never the raw wrapper string.
- **Plan selector** — the family's members, by `planOption`. See §5.
- **Current NAV** + `navDate`. ⚠️ **The date is not optional.** 44.8% of schemes carry a stale NAV
  (matured funds still listed) — the schema says so in a doc comment. NAV without its date is a
  claim about today that may be years old.
- **Dormant** (`isActive: false`) — say so here, plainly, at the top. 33.8% of funds. A dormant fund
  is not an error; it is a fund that stopped. The user must know before reading anything below.

**Not present, do not design slots for:** AUM, expense ratio, minimum investment, exit load, launch
date, SEBI riskometer, holdings, ratings.

### 3.2 The hero — risk-led

Three figures, **equal visual weight**, in this order:

1. **Return** — the longest available of `ret3yCagr` → `ret1y` → `ret6m`, labelled with its actual
   horizon. Never imply a horizon we didn't measure.
2. **Worst drawdown** — `maxDrawdown3y` (or the matching horizon). Phrased as lived experience, not a
   statistic: *"fell 34% at its worst."*
3. **Consistency** — `roll1yPctPositive`, **always with `roll1yN`**. See §4.3 — this one has a trap.

Below them, one honest sentence that ties them together in the fund's own numbers. Not a template
with holes; a sentence that reads differently for a fund that never fell than for one that halved.

If any of the three is declined, **its reason takes its slot at the same size.** The slot does not
collapse and the remaining figures do not expand to fill it. A missing measurement is information.

### 3.3 Chart

`GET /mf/:schemeCode/chart`. The response now carries `seriesSchemeCode`, `via`, `splitAdjusted`.

- **`via: "growth_twin"` must be rendered**, plainly: *"showing the Growth plan's total-return series
  — this plan pays its gains out, so its own NAV understates what the fund earned."* A chart that is
  silently the twin's series is a lie of a better-behaved kind. The user is looking at the same fund's
  real return; say so.
- **`declined: true`** (200, `idcw_nav_not_total_return`) → the chart's space carries the reason, at
  chart size. Not a small grey note under an empty box.
- **503** → *"we couldn't reach the source"*. **Never rendered the same as a decline.** One is a
  refusal, one is an outage; conflating them is the single easiest way to undo this whole
  architecture.
- **`stored: false`** — this is a live fetch on every view. Expect latency; show a real loading state,
  not a skeleton that implies instant data.
- **ETFs** carry both a NAV and a market price. The chart is NAV. Say which.
- Range: whatever the endpoint's `days` supports. **No "All"** unless the series genuinely is all.

### 3.4 Returns

`ret1m` · `ret3m` · `ret6m` · `ret1y` · `ret3yCagr` · `ret5yCagr`.

Annualised horizons must be **labelled annualised**. `ret3yCagr` is not "3-year return" — it is a
rate. Retail investors read the first as a total and it is not.

Declined horizons show their reason inline, in the row where the number would be.

### 3.5 Risk — a peer of returns, not an appendix

`vol1y` · `vol3y` · `maxDrawdown1y/3y/5y` · `sharpe1y/3y/5y` · `sortino1y/3y`.

Each needs a one-line plain-English gloss available on demand — Sharpe and Sortino are not retail
vocabulary and we do not pretend otherwise. Never a verdict ("good Sharpe"); the number and what it
measures, nothing more.

### 3.6 Rank — with an honest denominator

`rank1y/3y/5y` · **`pool1y/3y/5y`** · `bucketSize` · `rankBucket` · `pct1y/3y/5y`.

**The trap, now fixed and never to be re-broken:** `rank1y` is computed over the funds we could
measure; `bucketSize` counts every fund in the bucket. **5,831 rows have `rankPool1y != rankBucketSize`,
largest gap 107.** Rendering *"397 of 627"* when the truth is *"397 of 520"* mixes two populations and
turns a coverage artifact into a ranking.

**The rule: `rank` is always shown against `pool`, never against `bucketSize`.**

`bucketSize` is a separate, true, useful fact and gets its own phrasing — *"520 of the 627 funds in
this category could be measured over this window."* Both numbers, both real, different questions.

The bucket is `(normalised leaf category, planType)`, open-ended and active only, minimum size 5.
Say what the rank is *within* — a rank with an unstated population is a boast.

`not_ranked_*` reasons render in the rank's place: close-ended, dormant, plan unknown, bucket too
small, no category.

### 3.7 Benchmark

`benchmarkIndex` · `benchmarkVia` · `beta1y/3y/5y` · `alpha1y/3y/5y` · `trackingError1y/3y/5y`.

**31.7% populated. This section is more often absent than present**, and its reasons are the best
writing in the whole dataset — `credit_benchmark_unavailable` (3,855 schemes),
`fund_of_funds_no_direct_benchmark`, `overseas_index_not_available`, `thematic_no_clean_index`,
`commodity_no_equity_benchmark`, `no_defensible_benchmark`.

These are not failures. Each is a small argument about why comparing this fund to an index would be
misleading. **No competitor says any of this.** The declined benchmark section should be one of the
most persuasive things on the platform — it is the product's thesis, stated in the fund's own case.

Name the index when present. An alpha without its benchmark is a number without a question.

### 3.8 Return calculator

**Ruled in by Aman. Built as a record of the past, never as a projection.**

*"₹6,000 would've become ₹10,503"* is a true statement about history, and history is exactly what we
are willing to state. It becomes fantasy only when it is read as a forecast. So the whole design hangs
on one line: **past tense, always; forward projection, never.**

- **Modes:** monthly SIP · one-time. Amount input.
- **Horizons:** only those the series actually covers. A fund with two years of history shows two
  years. Never pad, never extrapolate, never annualise a short window into a long claim.
- **Columns:** what you put in · what it became · the return. All past tense.
- **The column that makes it ours: the worst it ever got.** *"Your ₹3,600 was worth ₹2,900 in March
  2025."* Same series, same math, one more true fact. Groww shows the ending and stops. This is the
  calculator's version of the risk-led hero — and it is the whole reason we're allowed to build this
  at all.

**Forbidden, absolutely:**
- No forward projection, no expected return, no "at this rate", no future-dated slider.
- No target-amount solving ("invest ₹X to reach ₹Y").
- No comparison against another fund inside the calculator. That would be declaring a winner.
- No language implying repetition or continuation.

**Technical constraints — non-negotiable:**
- **Computes from `/mf/:schemeCode/chart`**, the same series the page's chart drew — carrying
  `series_scheme_code`, split-adjusted, twin-resolved. **Never a raw mfapi fetch.** A calculator on a
  raw series would sawtooth on IDCW plans and cliff on split ETFs, and contradict the chart directly
  above it on the same page.
- **`declined: true` → no calculator.** 3,371 schemes have no series; a calculator there would have to
  invent one. Same reason, same words as the chart's decline.
- **`via: "growth_twin"` → the calculator is computing the Growth twin's series.** It must say so, in
  the same words §3.3 uses. The figure is the same fund's real return; do not let it read as this
  plan's payout-adjusted outcome.
- In-browser math over the served series. No backend call, no parallel derivation.

---

## 4. The three traps

**4.1 `pctPositive` publishes at n = 1.** `hasRoll = rollN > 0`. Live minimum is 1; median 1,002. So
a fund with a single qualifying window publishes *"positive in 100% of rolling one-year windows"* —
the exact sentence I wanted to lead with, built on one observation. **Never render `pctPositive`
without `n`. Do not lead with it below a real threshold** (propose one against the live
distribution; 1,002 is the median, 1 is the floor). `n` is in the payload.

**4.2 IDCW inheritance must be stated, not hidden.** An IDCW plan's metrics *are* its tier-matched
Growth twin's. That is correct — same fund, same portfolio, same tier — and it must be said, once,
where the numbers are. Tier-matching is load-bearing: Direct↔Direct, Regular↔Regular. Never imply a
Regular plan earned a Direct plan's return.

**4.3 The chart and the metrics come from one series.** Enforced by `series_scheme_code` now, not by
frontend discipline. Do not add a second path that could diverge.

---

## 5. Plan selection

Members carry `planOption` — normalised tokens like *"direct plan + growth option"*.

- **Default: Direct + Growth.** Cheapest, most common reference, and the true total-return series.
  Fall back to Regular + Growth, then whatever exists.
- **Direct and Regular are different returns.** Different expense ratios, different numbers. Switching
  plan re-reads analytics and chart for that scheme code. Never show one plan's figures under
  another's label.
- **An IDCW plan shows its twin's figures.** Say so where they're shown (§4.2).
- **A Bonus plan behaves as IDCW** — bonus issues step the NAV down like a split, so it inherits or
  declines. Same treatment, same words.

---

## 6. The three page states

**6.1 Full** — metrics present, chart draws. The minority (411 funds have a fully empty omissions
ledger).

**6.2 Partial — the median.** Some sections declined, some not. 13,630 of 14,041. The page must not
look damaged. Reasons sit where numbers would, at the same weight, and read as deliberate.

**6.3 Declined — 3,371 schemes, 24% of the catalogue.** All 30 `NAV_DERIVED_COLS` nulled, and now the
chart too. What remains: name, fund house, category, NAV, plan.

This is a **primary state**, not an edge case. It is a page that is almost entirely one sentence
explaining why it is almost entirely one sentence — and it is the most Vytal thing we will ship if we
get it right:

> *This plan pays its gains out as they're earned, so its NAV falls every time it pays. A return
> measured from that series would understate the fund by exactly what it handed back to you — and
> nobody publishes what it paid. So we won't show you one.*

**And then the way out:** the family often has a Growth member that works. A twinless IDCW *scheme* is
a dead page; the *family* usually isn't. **Route to the plan that can be measured.** That is the
difference between *"we have nothing"* and *"this plan can't be measured — here's the same fund on the
plan that can."*

A genuinely twinless **family** (708 of them) has no way out, and says so.

---

## 7. Explicitly out of scope

- **Fund holdings / constituents.** No table, no source, no ingestion. The single best differentiator
  available to us — *"here's what this fund owns, and here's what our engine knows about those
  businesses"* — is dead until a monthly portfolio-disclosure feed is wired. **Phase 2. Do not design
  a slot for it.**
- **Any score, rating, grade, or aggregate.** Ever.
- **Discovery.** Separate surface, separate spec. Filterable catalogue — category, fund house, plan.
  No "Popular," no "High return," no returns-sorted default. Sorting 17,567 funds by a 58%-populated
  column ranks our coverage, not the funds.

---

## 8. Open

- **Threshold for leading with `pctPositive`** — propose against the live `roll1yN` distribution.
- **The listed-ETF per-unit split cliff** — logged backend follow-up; its trigger is this page.
  Funds/NAV are corrected; a listed ETF's per-unit detail series may still step at a split.
- **Chart latency** — live mfapi fetch per view. Acceptable, but the loading state must be honest.
