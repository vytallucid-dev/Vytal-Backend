# Known Defects — filed, not fixed

Real defects found while building something else, where fixing them **in that batch** would have been
scope-blur. Each says what is wrong, what it costs, and what the fix is. Newest first.

**This file exists because the alternative is worse.** A defect noticed and not written down is a defect
rediscovered at the cost of finding it twice; a defect fixed inside an unrelated batch is a change nobody
reviewed for the reasons it was actually made.

---

## `T-6` · `entryIncludesAccruedInterest` tells the entry form a T-bill's price includes accrued interest — it has none

**Found:** the `T-4 · T-3 · T-1 · T-5` batch, verifying T-1's fix. **Sibling of `T-1` — same root cause, a
separate call site. Correctly left out of that batch; filed, not fixed.**

**The defect.** `entryIncludesAccruedInterest(assetClass)` (`disclosures.ts:127`) returns
`COUPON_BEARING.has(assetClass)` — true for `bond | gsec | sgb`, keyed on the **asset class alone**. A
**T-bill is a `gsec` and has no coupon**, so nothing accrues — it is issued at a discount and redeems at
par. Yet the flag comes back `true`, and the entry form (`transactions-controller.ts:227`,
`POST /me/transactions`) then instructs the user to *"enter the total you paid, including any accrued
interest"* for an instrument where that quantity does not exist. The same honest-null failure as T-1, one
flag over.

**Why it is T-1's twin, not T-1.** T-1 fixed `disclosuresFor` by giving it `attributes` and returning
`DISCOUNT_INSTRUMENT_PAYS_AT_PAR` for `couponNullReason = "discount_instrument"`. Look at the call site:
line 226 (`disclosuresFor`) now receives `instrument.attributes`; line 227 (`entryIncludesAccruedInterest`)
still receives **only `instrument.assetClass`** — the same blind spot, untouched, because T-1's scope was
`disclosuresFor` + PD3, and growing a fix to a sibling function is how a scoped batch becomes an unscoped
one (the batch's own scope-discipline ruling).

**The fix.** The seam is already open — the transactions path selects `attributes` (T-1 needs it). Give
`entryIncludesAccruedInterest` the same `attributes` (or a resolved "does this actually pay a coupon" fact)
and return `false` for a discount instrument.

**⚠ Do not** widen/narrow `COUPON_BEARING` or special-case a name pattern. The no-coupon fact is recorded by
the ingestion at the moment it was decided (`govt-guards.ts` — *"NOT a gap — a T-bill genuinely has no
coupon"*); read it, never re-derive it. Exactly T-1's guard-rail: a second home for the fact is the thing
`disclosuresFor`'s original design was right to refuse.

**Blast radius.** The 54 discount-instrument G-Secs (T-bills, zero-coupon paper) T-1 named. Cosmetic-but-
wrong: no number is corrupted (`NO ACCRUED-INTEREST MATH` exists anywhere — `disclosures.ts:28`), but the
instruction the form gives is false.

---

## `T-5` · The omissions ledger explains a null in `rank_y5` — a column that does not exist

**Found:** Construction v2 Stage 10a batch 3 (census of `mf_analytics.omissions` keys, building PI6).
**Operator-ruled: file it with T-3/T-4.** *"A ledger entry explaining a null in a column that doesn't
exist is the omissions-layer version of a phantom citation."*

**The defect.** Measured across the ledger's keys:

| key | rows | matches a column? |
|---|---|---|
| `rank_y5` | **20** | ❌ **no** — the columns are `rank_5y` / `rank_pool_5y` / `pct_5y` |
| `rank` | 3,387 | ❌ no — but deliberate: a **group** key covering all three horizons at once |

Both carry `not_ranked_bucket_too_small` among their values. `rank_y5` is the fold's internal window key
(`y5` — see `mf-implausible.ts`'s `WINDOWS` table) **leaking into a ledger whose keys are column names**.
Someone wrote `rank_y5` where every neighbour reads `rank_5y`.

**What it costs — nothing today, and that is exactly why it needs filing.** `omissionFor(omissions,
"rank_5y")` looks up `rank_5y`, finds nothing, falls through to `_all`, and returns null. So **20 funds
have a `rank_5y` that is null with no reachable explanation** — an unexplained gap in a design whose entire
claim is that *"a NULL metric with no entry here would be an unexplained gap"* (the column's own docstring).
The ledger says it explained something. Nothing can read the explanation.

**★ IT IS INVISIBLE FROM BOTH SIDES, WHICH IS THE INTERESTING PART.** A writer's-side test asserts the key
was stamped — it was. A reader's-side test asserts the null is explained — and for 20 rows it silently
isn't, because a missing key and a misspelled key are **the same observation** through `omissionFor`. The
honest-null design's own gate cannot see this: it validates the *values* against `OmissionCode` (and
`not_ranked_bucket_too_small` is a real code), never the **keys** against the columns they claim to explain.

**PI6 is default-OFF, so nothing renders it today.** It is filed now because the day PI6 is ratified is the
day 20 funds get a silently unexplained rank — and whoever ships that ratification will be reading a
distribution, not a key census.

**The fix.** Rename the key at the write site in `mf-analytics.ts` (`rank_y5` → `rank_5y`), and — **the
part that matters more** — add the arm the taxonomy is missing: **every key in `omissions` must be either a
real `mf_analytics` column or a declared group key** (`_all`, `rank`, `roll_1y`). That is the key-side twin
of `verify-phs-pd-readtime.ts` §8's value-side gate, and it would have caught this on the day it was
written. **Scope:** `mf-analytics.ts` + a 20-row backfill (or leave history and fix forward — the rows are
already unreadable) + the new gate.

---

## `T-4` · The 5-year window is never volatility-tested — the implausibility guard ships what it refused

**Found:** Construction v2 Stage 10a batch 3 (building PI5's ladder; 65 live rows).
**Operator-ruled: file it; the findings layer inherits the refusal instead** (`cv2-s10a-refusal-nesting`).
**⚠ This is the one with a shipped falsehood behind it.**

**The defect.** [`mf-implausible.ts:103`](../src/ingestions/amfi/mf-implausible.ts#L103) — the y5 window's
`get()` passes **`vol: null`**:

```ts
{ key: "y5", get: (c) => ({ ret: c.ret.y5 ?? null, vol: null, dd: c.maxDD5y, annualised: true }) }
//                                                  ^^^^^^^^^ "vol_5y is computed for Sharpe but never stored"
```

`vol_5y` isn't a column, so it isn't in `cols` — and the author passed `null` for the **test** as well as
the storage. The guard's `impossible` check is `(vol !== null && vol > VOL_MAX) || …`, so **the 5-year
window's volatility is never examined.**

**What it costs — 65 rows, and the worst sentence in the library.** All 65 are segregated (side-pocketed)
credit portfolios frozen since Jan 2022 (UTI Medium Term Fund *(Segregated - 17022020)*, Nippon India
Medium Duration Fund *(Segregated Portfolio 1)*), 154 NAV points each. On that series the fold set
`vol_1y`, `vol_3y` and `ret_1y` to `withheld_implausible` — **three refusals** — cleared y1 and y3, then
let y5 through because a drawdown of **0** is not `< -0.85`. Result: **`max_drawdown_5y = 0` exactly, with
no omission**, on a defaulted-debt side pocket. Doc 2's PI5 trigger (*"`maxDrawdown` present"*) would render
that as ***"deepest fall on record: 0.0%"***.

**★ THE GUARD ALREADY STATES THE PRINCIPLE IT VIOLATES**, in its own header:

> *"A window's return, its volatility, its Sharpe, its drawdown and its beta are all folded from the SAME
> stretch of NAV — so if that stretch is not describing the fund, none of them is."*

It says *a* window. Nothing says **nested** windows — and y5's stretch **contains** y1's. Horizon-scoping is
right and deliberate (*"withholding the whole row would destroy two sound windows to suppress one bad one"*
— BANKIETF's 1Y/3Y are genuinely fine). The gap is that scoping was implemented **without** the nesting
implication.

**Interim state (shipped, batch 3).** PI5 inherits a refusal across nesting: a rung is evaluable only if it
and every shorter rung are. The 65 go **not-evaluable**; the **730 true zeros still ship** (an overnight
fund really never falls — the rule keys on the *refusal*, never the value). **The invariant is not a
workaround and survives this fix** — see `cv2-s10a-refusal-nesting`.

**The fix.** Two candidates, and **the ticket carries the question, not the answer** — deciding it from the
read side would be inventing a fact about the fold:

1. **Test y5's volatility — the number already exists and is thrown away.**
   [`mf-analytics.ts:794`](../src/ingestions/amfi/mf-analytics.ts#L794) already computes it:
   ```ts
   const vol5y = a.vol("y5"); // computed for sharpe_5y; not a stored column
   ```
   It feeds `sharpe_5y` on the next line and is then discarded, because `Computed` only carries what gets
   stored — **and that is the whole bug in one word.** `vol_5y` is not a *column*, so it was treated as not
   a *fact*, and the guard was handed `null` for a value sitting in a local variable three functions away.
   Fix: carry `vol5y` on `Computed` and pass it to the y5 `get()`. Smallest diff; does not address nesting.

2. **Propagate the withhold across nesting** in `applyImplausibilityGuard`: if window *w* is cleared, clear
   every window containing it. Addresses the class. **Wider blast radius — measure it before shipping:** it
   would clear y5 wherever y1 or y3 was cleared, which is 102 rows on drawdown alone and more across
   `ret_*` / `beta_*` / `tracking_error_*`.

**⚠ (1) AND (2) ARE NOT ALTERNATIVES, AND THE 65 ARE WHY.** (1) closes the hole that let *these* 65 through;
(2) closes the reason a hole like it ships undetected. Doing (1) alone leaves the next
computed-but-unstored value one refactor away from the same outcome.

**Scope:** `mf-implausible.ts` + a **re-fold of 14,041 rows**. **Operator-run backfill.** Note the guard's
own ordering constraints still bind (*after* `applyDistributionHandling`, *before* `applyRanks`).

---

## `T-3` · `benchmark_via = 'name'` is a substring match, and the schema calls it "Near-certain"

**Found:** Construction v2 Stage 10a batch 3 (measuring `PI_TE_NOTABLE`'s distribution).
**Operator-ruled: file it; do NOT move PI4's threshold to hide it.** *"A threshold must never do a bug's
cleanup — the symptom disappears and the bug never gets found."*

**The defect.** 13 funds whose names say **"BSE Sensex Next 30"** / **"BSE Sensex Next 50"** carry
`benchmark_index = 'Sensex'` at `benchmark_via = 'name'`. The name matcher matched the substring
**"Sensex"** and handed a Sensex-Next fund **the parent index** — a different index, of different
companies. (Sensex Next 50 is the 50 companies *after* the Sensex 30; they do not overlap.)

The schema claims this resolution is trustworthy:

> `name` — *the fund's own name states the index it tracks (an index fund / ETF). **Near-certain.***

Measured, it is not. A substring match is near-certain **only when no index name is a prefix of another**,
and `Sensex` / `Sensex Next 30` / `Sensex Next 50` is exactly that case. The confidence claim is what makes
this worth a ticket rather than a shrug: `benchmark_via` exists **to let a reader trust or discount the
alpha**, and one of its three values overstates itself.

**What it costs.** Their ~**7.6%** "tracking error" is **the distance between two different indices**, not a
fund failing to track its own. They are the **entire p99** of the tracking-error distribution
(p50 = 0.30%, p90 = 2.21%, p99 = 7.54%). PI4 fires on them and says *"This fund tracks Sensex"* about a fund
called *"Sensex Next 50"*. Their `beta_*` and `alpha_*` are measured against the wrong index too — **PI4 is
where it is visible, not where it ends.**

**Interim state (shipped, batch 3).** PI4 keeps `PI_TE_NOTABLE = 2%` (the measured p88) and **names the
benchmark in its Read** — *"This fund tracks Sensex"* on a fund named *"Sensex Next 50"* is a sentence whose
wrongness the reader can see. That is **not offered as a fix**; it is the least dishonest rendering of a
number we did not compute. **Moving the cut to 8% was available and refused**: it would silence 125
correctly-mapped funds to hide 13 wrong ones, and encode a fold bug as a product threshold where the next
reader could not see it. **The 13 fire loudly until this is fixed.**

**The fix.** Anchor the name match to the **longest** index name that matches, not the first (or any);
require a word-boundary/whole-name match rather than a substring. Then re-derive `benchmark_index` and
every downstream `beta_*` / `alpha_*` / `tracking_error_*` for affected schemes. **Audit the whole
`via='name'` cohort (1,016 rows) while there** — Sensex/Sensex-Next is the case that surfaced; `Nifty 50` vs
`Nifty 500` vs `Nifty 50 Value 20`, and `Nifty Next 50` vs `Nifty 50`, have the same shape and were not
individually checked. **Scope:** the benchmark matcher + a re-fold of the affected rows.
**Operator-run backfill.**

---

## `T-2` · Two omission codes carry two classes for one null — the split is the fold's, not a finding's

**Found:** Construction v2 Stage 10a batch 3 (classifying `mf_analytics.omissions`).
**Operator-ruled: file it; do not split from a findings batch.** Same shape as T-1, bigger blast radius.

**The defect.** Two codes in `ingestions/amfi/mf-omissions.ts` make **two arguments in one sentence**, and
those arguments fall in **different classes** of the honest-null taxonomy. Measured, each explains exactly
one omission key — **`benchmark`** — so both halves answer the *same* question (*"why does this fund have no
benchmark?"*). That is what makes each **two codes**, not one ambiguous one.

| code | rows | half A | half B |
|---|---|---|---|
| `commodity_no_equity_benchmark` | **25** | *"No equity index is a meaningful benchmark for it"* → **not_a_gap** (a gold fund's beta-vs-Nifty is not missing; the question has no answer) | *"we do not hold a commodity price series"* → **our_gap** (its beta-vs-gold **is** missing, and that one is ours) |
| `fund_of_funds_no_direct_benchmark` | **538** | *"a FoF's benchmark is whatever its UNDERLYING funds are benchmarked to"* — no index expresses that → **not_a_gap** | *"We hold no such mapping"* — the look-through is buildable and we have not built it → **our_gap** |

**Interim state (shipped).** Both are in `OMISSION_UNCLASSIFIED` with their reasons. They render **nothing**
rather than half a truth — the taxonomy's own law (*omitted, never bucketed*), applied to itself. The
tri-directional gate keeps them from being mistaken for oversights.

**⚠ THE TICKET CARRIES A QUESTION, NOT A PRESUMED ANSWER.** Do **not** read the table above as a
specification. The writer in `mf-analytics.ts` would have to decide **which code to stamp per row**, and for
a commodity fund the honest answer may be **both, always** — no equity index is meaningful *and* we lack the
gold series, on every single one of the 25. **If both halves are always true together, then the right fix is
ONE code with a TWO-PART sentence, not two codes** — and the taxonomy would then need a way to say "this null
has two classes", which it currently cannot.

**That is a ruling for whoever does the split, with the fold's data in front of them.** Deciding it here,
from the read side, would be inventing a fact about the write side — which is the failure this whole
taxonomy exists to prevent.

**Scope when it is done:** `mf-omissions.ts` (declare) + `mf-analytics.ts` (stamp) + a **backfill of 563
rows** + `null-reasons.ts` (classify, and remove from `OMISSION_UNCLASSIFIED`). **Operator-run backfill.**

---

## `T-1` · `/me/holdings` stamps `coupon_income_not_tracked` on 54 T-bills that have no coupon to track

**Found:** Construction v2 Stage 10a batch 2 (building PD3). **Operator-ruled: report, don't fix.**

**The defect.** `disclosuresFor(assetClass)` returns `coupon_income_not_tracked` for `bond | gsec | sgb`.
**A T-bill is a `gsec` and pays no coupon** — it is issued at a discount and redeems at par; that *is* the
instrument. So `/me/holdings` tells a user we are not tracking income **that does not exist**, on **54 of
our 170 G-Secs**.

**Why it is not `disclosuresFor`'s fault.** It was designed to derive from the asset class **alone** —
deliberately, and the reasoning is sound and still holds (`disclosures.ts`): *"`instruments.asset_class`
already holds the fact, and a second copy of a fact is a second thing to keep in step."* The information
that separates a T-bill from a coupon-paying G-Sec lives in `instruments.attributes.couponNullReason =
"discount_instrument"`, and **`disclosuresFor` has never had access to `attributes`**. It is not wrong about
what it can see; it cannot see the thing that matters.

**The blast radius today: two surfaces disagree, deliberately.** PD3 (`read-time-findings.ts`) *does* have
`attributes`, excludes discount instruments, and binds the exclusion. So for the same T-bill:
- `/me/holdings` → "coupon income is not tracked for this holding"
- the PD panel → silent (correctly — there is no untracked coupon income)

**PD3 reuses the disclosure and does not inherit its blind spot.** That is the intended state until this is
fixed, not an oversight.

**The fix.** Give `disclosuresFor` access to `attributes` (or to a resolved "does this actually pay a
coupon" fact) and return `[]` for a discount instrument. **The data is already there** — the same gap
Stage 10a opened for PD: `attributes` had never been selected anywhere in the portfolio path
(ODL `cv2-s10a-nullreason-honest`). `read-time-catalog.ts` now loads it; a fix can follow that seam.

**⚠ Do not fix it by widening `COUPON_BEARING` or by special-casing a name pattern.** The reason a T-bill
has no coupon is recorded, by the ingestion, at the moment it was decided (`govt-guards.ts:160` — *"NOT a
gap — a T-bill genuinely has no coupon"*). Any fix that re-derives that fact instead of reading it is a
second home for it, which is the thing `disclosuresFor`'s original design was right to refuse.
