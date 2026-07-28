# Vytal — Trajectory Tool Specification

**Trajectory only: one score's own path over time. Nine patterns.**

Two-pillar readings — price ahead of quality, ownership building against a weak Foundation, laggard catching up, and every other pillar-versus-pillar condition — belong to the **Divergence** tool and are deliberately absent here.

*Diagnostic / CN-8 read-only. Nothing here feeds back into any bar, weight, lens anchor or threshold.*

---

## Provenance

Every figure comes from the recorded outputs of the Vytal price-relationship study — 95 stocks, 13 peer groups, 2021–26 primary window, plus a 2017–21 neutral-regime check, the 2024 melt-up reversion, and a disclosure-anchored short-window test on 1,235 dated events. Sample sizes are stated on every pattern. Nothing is estimated. Where a sample size was not preserved in the retrieved output, that is marked rather than guessed.

---

## Part 1 — Mechanics

### 1.1 What trajectory measures, stated correctly

A trajectory pattern is **one score moving along its own path** — rising, falling, or crossing a zone boundary. No second pillar is involved.

**What a trajectory move actually represents.** When the composite moves 8+ points, the non-price pillars (Foundation, Momentum, Ownership) contributed **5.7 of the 10.6 points on average**, and drove more than half the move in **56% of cases**. So a recovery or deterioration is a **genuine business inflection**, not the Market pillar echoing a price the user can already see. This matters: if these moves were price transforms, the tool would be telling users what they already know.

**What the evidence does and does not support.** Recovery and deterioration events tracked price powerfully **in the same window** — 81% and 79% hit rates. Their **forward** 60-day edge was weak (~55%). The correct reading of that gap is narrow: *the price reaction is largely spent, not that the business change is over.* The inflection is real and ongoing; what we cannot do is capture the next 60 days of price from it.

**So the framing for all copy is:** *a genuine change in the business is underway, and the market has already begun repricing it.* Never "this predicts the next move," and never the opposite error of "this is merely coincident."

### 1.2 How much movement counts

| Movement | Meaning |
|---|---|
| **Composite move of ≥ 6 points** | A material trajectory event. This is the threshold at which recovery and deterioration were measured. |
| **Crossing a zone boundary** | Defined by the boundary itself, not by size — the pattern is the crossing. |
| **Below 6 points, no crossing** | Drift. Not a trajectory event. |

**Zone boundaries.** Composite bands: **<55 Fragile · 55–62 Below Par · 62–68 Steady · 68–74 Healthy · ≥74 Pristine.** Pillar zones use each pillar's own native thresholds — **Foundation 60 / 72, Momentum 54 / 75, Market 50 / 74, Ownership 60 / 72.** The composite's bands must never be borrowed for a pillar; doing so mislabels the zone and has been shown to flip a signal's sign (see T6).

### 1.3 Severity is NOT magnitude — the inversion from divergence

In the divergence tool, a bigger gap means a stronger signal. **In trajectory, that logic is inverted and must not be carried over.**

Measured reaction by size of move:

| Foundation gain | Sector-excess drift | Positive |
|---|---|---|
| 1–3 points | **+1.9%** | 64% |
| 4–10 points | −0.2% | 50% |
| 15+ points | −0.5% | 50% *(n=4)* |

| Momentum gain | Same-day | Positive |
|---|---|---|
| 4–10 points | +0.1% | 52% |
| **15+ points** | **−1.1%** | **31%** |

The **smallest** Foundation gains carried the cleanest positive drift; the largest carried none. The largest Momentum gains reacted **negatively**. Big fundamental moves are the anticipated ones — they are already in the price.

**Design consequence:** never scale a trajectory badge by the size of the move, and never imply a 20-point jump is a bigger signal than a 3-point one. If anything, the reverse.

### 1.4 Regime — same calculation, heavier role

Identical to the divergence tool. One implementation serves both.

```
index = the PG's benchmark index
        (PG8 Power, PG9 Metals, PG10 Oil & Gas have no benchmark —
         use an equal-weight average of that PG's scored peers)

trailing_6mo = index(today) / index(126 trading days ago) − 1

HOT       if trailing_6mo > +0.25
STRESSED  if trailing_6mo < −0.12
NORMAL    otherwise
```

Computed **per peer group**, on the sector — never on the individual stock, which would be circular.

**But regime carries more weight here than in divergence.** There, it changes the wording. Here, for boundary crossings, it determines whether the pattern means anything at all — and the two clearest cases point in **opposite** directions:

| Pattern | HOT | NORMAL |
|---|---|---|
| Falling out of Pristine (down through 74) | **−5.2%, 29% positive** — reads true | +2.2% — no directional read |
| Momentum breaking into weak (down through 54) | +9.6% — masked | **−1.9%, 40% positive** — reads true |

One works only when the sector is running; the other only when it is calm. **No global rule covers both — the regime mapping is a required field per pattern.**

**Handling a phase where a pattern has no read:** show the crossing regardless — it is a fact about the user's stock. But where the evidence shows no directional signal in the current phase, say so plainly rather than asserting a direction the data cannot support.

### 1.5 The low zone is where the score speaks loudest

Composite movement matched price direction:

- **79%** of the time when starting from the low zone (≤58)
- **71%** from the middle
- **61%** from the high zone

The score is most informative about a struggling business, least about an already-priced strong one. Weight the tool accordingly.

### 1.6 Silence is correct

Roughly **79% of all composite scores sit in the crowded 55–72 band**, where nothing discriminates. A stock with no trajectory pattern should read *"stable — no material change"*, not display an empty panel. The tool should be loud at the edges and quiet in the middle; that quiet is what makes the loud parts credible.

---

## Part 2 — Composite trajectory patterns

---

### T1 · Recovery from the Low Zone

```
Composite_prev ≤ 58  AND  (Composite_now − Composite_prev) ≥ +6
```

**What it means.** A struggling business is genuinely turning. This is the single strongest trajectory reading in the study, and the low zone is exactly where the score carries most information (79% price-tracking from this starting point).

**Evidence.** **+12.8% median, 81% of cases rose** in the same window (n=26). Forward 60-day edge weak (~55%) — the price has already begun reacting. Verified as fundamentally driven, not a Market artifact: on moves of this size the non-price pillars contributed the majority of the points.

**Regime.** Reads across phases; strongest signal in the study's low zone. In HOT phases treat the magnitude as flattered.

**User copy:**
> *This business is recovering from a weak position — a real improvement in the underlying fundamentals, not just a price move. The market has typically already started repricing it by the time this shows.*

---

### T2 · Deterioration from a High Base

```
Composite_prev ≥ 70  AND  (Composite_now − Composite_prev) ≤ −6
```

**What it means.** A business that was sound is measurably weakening. The mirror of T1, and the more important one for risk — this is the score doing the job a health score exists to do.

**Evidence.** **−6.1% median, 79% of cases fell** in the same window (n=28). In the 2017–21 neutral two-sided window, composite-deterioration events coincided with **−35.9% mean price, every case negative** (min −69%) — the pattern reads far more sharply when there is genuine downside in the market.

**Regime — critical.** In the 2021–26 bank bull this pattern showed a **false +15%**. It is masked in one-way rallies and reads true when risk is two-sided. Always show the phase.

**User copy:**
> *A business that was in good shape is measurably weakening. This is the kind of change worth reviewing your reasons for holding it.*

**In a HOT regime, append:**
> *The sector is in a strong run, which has historically postponed this kind of deterioration showing up in the price rather than cancelling it.*

---

### T3 · Falling Out of Pristine

```
Composite_prev ≥ 74  AND  Composite_now < 74
```

**What it means.** The top band is defined as *fully priced* — a business already recognised as excellent. Falling out of it means the one thing supporting a premium rating has started to slip.

**Evidence.** Pooled, this reads flat (+0.2%) — the phases cancel. Split: **HOT −5.2%, only 29% positive** (n=7) versus **NORMAL +2.2%**. It reads true precisely when the sector is stretched, which is when a fully-priced name has the most to lose.

**Regime — this pattern only carries a read in HOT phases.** In NORMAL, show the crossing and state that it has no directional history.

**User copy (HOT):**
> *This business has slipped out of the top health band while its sector is running hot. Historically that combination has been the least forgiving — a fully-priced business losing the thing that justified the price.*

**User copy (NORMAL / STRESSED):**
> *This business has slipped out of the top health band. In calm markets this crossing has not historically carried a directional read.*

---

### T4 · Recovering Out of Below Par

```
Composite_prev < 62  AND  Composite_now ≥ 62
```

**What it means.** The business has climbed out of soft territory into steady. The band-crossing version of T1 — narrower and cleaner to state.

**Evidence.** **+6.6%**, and notably **+22.1% in STRESSED phases** — recovery crossings out of the low bands carried most in calm and stressed markets, less uniquely in hot ones.

*Sample size was not preserved in the retrieved output for this cell. Treat as directional and re-verify before giving it prominence.*

**User copy:**
> *This business has moved out of below-par territory into steady. A recovery that has held long enough to cross a band.*

---

## Part 3 — Pillar trajectory patterns

---

### T5 · Foundation Growing Out of the Weak Zone

```
Foundation_prev < 60  AND  Foundation_now ≥ 60
```

**What it means.** Genuine balance-sheet improvement has pushed the business past its weak mark. The cleanest and most consistent of all the pillar-trajectory readings.

**Evidence.** **+3.2%, 71% positive** over 15 days from the results disclosure (n=31) — the strongest of the nine zone-stories tested. On a sector-excess basis the small-move version returned **+1.9%, 64% positive**.

**Note.** Consistent with §1.3 — the *small* Foundation gains carried this drift; gains of 15+ points did nothing.

**User copy:**
> *The latest results moved the balance-sheet reading out of weak territory. A real improvement from a low base — and historically the most reliable of the single-pillar improvements.*

---

### T6 · Momentum Breaking Into Weak

```
Momentum_prev ≥ 54  AND  Momentum_now < 54
```

**What it means.** The operating trajectory has broken into weakness. The business may still be structurally sound, but the direction has turned.

**Evidence.** **−1.4%, 41% positive** overall (n=22). Split: **NORMAL −1.9%, 40% positive** (n=15) versus **HOT +9.6%** (n=3, masked).

**Why this pattern matters methodologically.** On the borrowed composite threshold (60 instead of Momentum's native 54) this had shown a **false +3.2%**. Correctly located at Momentum's own weak mark, it is negative. This is the clearest evidence in the study for why pillar zones must use native thresholds.

**Regime — reads true in NORMAL, masked in HOT.**

**User copy:**
> *The operating trajectory has broken into weak territory. The balance sheet may still be intact, but the direction of the business has changed.*

---

### T7 · Momentum Improving While Still Weak

```
Momentum_now < 54  AND  Momentum_now > Momentum_prev
```

**What it means.** The turn is happening while the business still reads as weak — the earliest visible point of a trajectory recovery, before it has crossed back into normal territory.

**Evidence.** **+5.8%, 63% positive** at 15 days (n=19); **+3.0%, 68% positive** at 7 days. The bearish mirror — Momentum falling *into* weak — returned **−0.3%, 39% positive** (n=19).

**User copy:**
> *Still weak, but improving. The trajectory has turned up from a low base — the earliest point at which a recovery becomes visible in the numbers.*

---

### T8 · Foundation Strong and Still Improving

```
Foundation_now ≥ 72  AND  Foundation_now > Foundation_prev
```

**What it means.** A business that was already sound is getting sounder. Rare, and one of the few consistently positive readings on the strong side of the range.

**Evidence.** **+5.8%, 69% positive** at 15 days (n=17); **+4.6%, 71% positive** at 7 days; **+2.4%, 65% positive** on the day.

**User copy:**
> *An already-strong business that is still strengthening. Uncommon, and historically one of the more consistent positive readings.*

---

### T9 · Foundation Weak and Still Declining

```
Foundation_now < 60  AND  Foundation_now < Foundation_prev
```

**What it means.** Entrenched, worsening weakness. Not a dramatic break — a business that was already weak continuing to erode.

**Evidence.** **+0.6% at 15 days but only 36% positive** (n=22) — the **worst odds of any trajectory story tested**. The mean is dragged up by a few outliers while roughly two-thirds of cases fell. Same-day: −0.7%, 50%.

**Display note.** This is the case where mean and hit-rate disagree, and the **hit-rate is the honest number**. Show the percentage, not the average.

**User copy:**
> *A business that was already weak is continuing to deteriorate. Of all the patterns tested, this one had the poorest odds of the price holding up.*

---

## Part 4 — Three cross-cutting rules

These are not patterns. They are constraints on what the tool may claim.

### R1 · Reaction does not scale with the size of the move

Covered in §1.3. A 1–3 point Foundation gain drifted **+1.9% sector-excess (64% positive)**; a 15+ point gain did nothing. A 15+ point Momentum gain reacted **negatively** (−1.1% same-day, 31% positive). Momentum *deteriorations* were flat across every size bucket — even a 15+ point collapse produced no clean drop.

**Constraint:** never present a larger move as a larger signal.

### R2 · Momentum does not lead the composite

Across 39 matched pairs, a Momentum down-cross preceded the composite down-cross with a **median lead of 0 days**. Momentum crossed first only **31%** of the time; **49%** were the same snapshot. (A slight ~49-day lead appeared only at the 70-boundary.)

**Constraint:** Momentum cannot be presented as an early-warning ahead of the headline score. They move together.

### R3 · Price front-runs large Momentum improvements

Before results that produced a **15+ point Momentum gain** (n=30), the price had already run **+3.0% sector-excess in the prior 15 days, 70% positive** — and then did **nothing afterwards** (−0.1%, 48% positive). By the time the pillar moves, the move is spent.

Named cases — run-up before, reaction after:
- **PNB** (Momentum 26→60): **+12% before, −11% after** — fully anticipated, then sold the news
- **Canara** (30→68): **+11% before, +7% after**
- **Shree Cement** (54→82): **+8% before, −3% after**
- **Glenmark** (20→63): flat before, **+12% after** — a genuine surprise, the honest exception
- **Divi's Labs** (89→60): a *deterioration* that the market re-rated **+14%** upward — the counter-case, shown rather than hidden

The deterioration side showed **no symmetric front-running** — big Momentum drops were neither anticipated nor punished short-term.

**Constraint:** for large positive Momentum moves, the copy must not imply the user is early. They are late by construction.

---

## Part 5 — Explicitly excluded

Every one of these tested *positive* and every one is bull-masked. The phase split is what exposes them. **Shipping these un-split would confidently tell users the opposite of the truth.**

| Excluded | Reading | Why |
|---|---|---|
| **Composite crossing down through 68** | +11.3% (HOT +18.7%) | The composite is slow — a down-cross lands *after* the fall, into a still-rising tape. |
| **Composite crossing down through 62** | +5.4% | Same mechanism. |
| **Foundation crossing down through 60** | +8.2% | Foundation moves on annual data; the cross arrives late. |
| **Foundation crossing down through 72** | +16.9% (HOT +24.9% vs NORMAL +7.9%) | The starkest bull-masking in the set. |
| **Composite crossing up through 74** | +12.4% (HOT +22.9%) | Riding the regime, not a signal. |
| **Momentum crossing up through 54** | +2.4%, 57% | Muted. T7 is the better-formed version of the same idea. |
| **Momentum falling out of strong (below 75)** | −0.2%, 48% | Flat. *(The two-pillar version — with Foundation ≥72 — is D6 in the Divergence tool and is three times stronger.)* |
| **Foundation growing into strong (≥72)** | +6.0%, 67% | A single +59% outlier drove the mean. |

**The pattern in the cut list is worth internalising: almost everything excluded is a *downward* crossing.** The intuitive expectation is that a score falling through a boundary is bearish. In this window it read bullish, and only the regime split reveals why.

**The test for anything added later:** *does it survive the phase split, and can you say why it moves the way it does?*

---

## Part 6 — Summary

| # | Pattern | Score | Trigger | Went the predicted way | Size | n |
|---|---|---|---|---|---|---|
| T1 | Recovery from the low zone | Composite | ≤58, up ≥6 | **8/10 rose** | +12.8% median | 26 |
| T2 | Deterioration from a high base | Composite | ≥70, down ≥6 | **8/10 fell** | −6.1% median | 28 |
| T3 | Falling out of Pristine | Composite | crosses below 74 | **7/10 fell (HOT only)** | −5.2% in HOT | 7 |
| T4 | Recovering out of Below Par | Composite | crosses above 62 | — | +6.6%; +22.1% stressed | *not recorded* |
| T5 | Foundation out of the weak zone | Foundation | crosses above 60 | **7/10** | +3.2% @15d | 31 |
| T6 | Momentum breaking into weak | Momentum | crosses below 54 | **6/10 fell (NORMAL)** | −1.9% in NORMAL | 15 |
| T7 | Momentum improving while weak | Momentum | <54 and rising | **6/10** | +5.8% @15d | 19 |
| T8 | Foundation strong and improving | Foundation | ≥72 and rising | **7/10** | +5.8% @15d | 17 |
| T9 | Foundation weak and declining | Foundation | <60 and falling | **6/10 fell** | 36% positive | 22 |

*"Went the predicted way" = share of cases that moved in the direction the pattern implies — so for a bearish pattern, the share that fell. Read against a ~50% coin-flip baseline.*

**Regime requirement by pattern:** T2 and T3 must display the phase (T3 has a directional read in HOT only). T6 reads in NORMAL and is masked in HOT. T1, T4, T5, T7, T8, T9 read across phases, with magnitudes flattered in HOT.

---

*All analysis diagnostic and read-only. No bar, weight, lens anchor or threshold was changed or informed by any result. CN-8 and CN-1 hold in full.*
