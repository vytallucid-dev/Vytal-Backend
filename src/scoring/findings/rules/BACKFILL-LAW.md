# THE BACKFILL LAW

**Any change to a filing rule's logic or its constants requires a full backfill of all 504 stocks.**

Not "should". Not "when convenient". The rows are wrong until you run it, and nothing in the system
will tell you they are.

```bash
npx tsx src/scripts/filing-backfill.ts --reason "P8 receivables threshold 1.25 -> 1.40"
```

---

## Why this file exists in the rule directory

You are reading it because you are about to edit a rule in this folder. That is the only moment the
law matters, and a README two directories up is not where anyone is standing when they change a
threshold from 1.25 to 1.40.

## Why the law exists

Since step 6 the filing pass is **filing-keyed**: a stock's rows are recomputed when the feed a rule
depends on lands, and not otherwise. That is correct — a receivables verdict cannot change without new
accounts — and it has one consequence that makes this law necessary:

**A row computes once and then freezes until the next filing.**

| grain | recomputes when | worst-case staleness |
|---|---|---|
| A — annual accounts | the annual filing lands | **~11 months** |
| Q — quarterly results | the quarterly filing lands | ~3 months |
| S — shareholding | the shareholding pattern lands | ~3 months |
| W — rolling window (P6, H) | daily sweep | ~1 day |

So the day after you change an annual rule's constant, the universe is split: the handful of stocks
that happened to file since carry rows computed under the new constant, and the other ~490 carry rows
computed under the old one. **Nothing on the row records which.** `stock_findings` stores the verdict,
not the constant that produced it. A census, a base rate, a portfolio signal and an alert will all
read that mixture as one population.

Phase 2 is entirely threshold work. This will happen more than once.

## What counts as "a change"

Everything that can move a rule's output:

- a threshold constant (`P8_RECEIVABLE_RATIO`, `R1_PLEDGE_RATIO_PCT`, `H_MIN_DEAL_CR`, …)
- a window length (`BLOCK_WINDOW_DAYS`, `INSIDER_WINDOW_DAYS`)
- a comparison, a guard, an ordering, an early return
- the `notEvaluable` reason a rule returns, or the condition under which it returns one
- anything in `filing/context.ts` or `scoring/metrics/filed-load.ts` that changes what a rule is
  handed — an industry dispatch, a series' ordering, a null becoming a zero
- adding a rule to `FILING_REGISTRY`, or moving one between feeds or grains

What does **not** require it: copy, comments, the catalogue name/description, and anything that only
touches how a row is rendered. If the row's stored fields cannot move, the backfill cannot change
anything.

When in doubt, run it. It is one command and it is idempotent.

## What the backfill does

`runFilingBackfill()` (`src/filing/pass.ts`) runs all 22 rules over every active stock and upserts on
`(stock_id, rule_key, period_key)`. It is safe to re-run: the same inputs produce the same rows, and
the prior-period comparison that drives `standingState` reads rows **strictly earlier** than the
period being written, so a re-run cannot read its own last write and manufacture a transition.

Available three ways, all the same function:

- `npx tsx src/scripts/filing-backfill.ts` — the operator path
- `JobTypes.FILING_BACKFILL` — enqueued, progress-reported, survives a restart
- `runFilingBackfill({ symbols, feeds })` — the programmatic path; the narrowing arguments exist for
  a targeted re-run and **do not discharge the law**

## The one thing to think about before running it

A rule-logic change can move a row from `not_fired` to `fired`. The backfill computes
`standingState` against the prior period's row, so that stock becomes **`newly_standing`** — and
`newly_standing` is what the alert evaluator fires on and what the read surfaces render as "new".

If the finding was true all along and only your fix made it visible, that is a **false transition**:
the reader is told something changed at the company when what changed was our arithmetic. Step 6 hit
this exactly — H's window was ending at the shareholding date instead of the evaluation date, so 39
stocks' block deals were invisible, and simply fixing the window would have announced 39 new findings
on the day of the deploy.

The fix is to make the corrected rows have no prior to compare against, so the conservative
"first observation is not a transition" rule applies:

```bash
npx tsx src/scripts/filing-backfill.ts --reset-rule H --reason "window anchor corrected"
```

`--reset-rule` deletes that rule's existing rows before recomputing. Use it **only** when the old rows
were produced by logic you now know to be wrong — they are not a prior state of the same measurement,
they are a different measurement. For an ordinary threshold tightening, do **not** use it: a stock
that crosses a threshold you moved genuinely is newly standing under the rule as it now exists.

## Related

- `src/filing/pass.ts` — `runFilingBackfill`, and the standing-state derivation
- `src/filing/registry.ts` — the 22 rules, their grain, and the feed that triggers each
- `src/filing/triggers.ts` — which ingestion recomputes which rules
- `src/scripts/filing-backfill.ts` — the operator entry point
