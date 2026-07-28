# Vytal — Divergence Tool Specification

**Divergence only: two pillars disagreeing. Seven patterns, two states.**

Single-pillar readings (Foundation growing out of the weak zone, Momentum improving while weak, and every other one-pillar path) belong to the **Trajectory** tool and are deliberately absent here.

*Diagnostic / CN-8 read-only. Nothing here feeds back into any bar, weight, lens anchor or threshold.*

---

## Provenance

Every figure comes from the recorded outputs of the Vytal price-relationship study — 95 stocks, 13 peer groups, 2021–26 primary window, plus a 2017–21 neutral-regime check and the 2024 melt-up reversion. Sample sizes are stated on every pattern. Nothing is estimated. Where a pattern inherits its evidence from a broader tested configuration rather than having its own, that is stated explicitly.

---

## Part 1 — Mechanics

### 1.1 What counts as a divergence

A divergence is **two pillars disagreeing**. Three point thresholds govern everything, and all three are derived from tested results.

| Gap between the two pillars | Meaning |
|---|---|
| **≤ 7 points** | **Aligned.** No divergence. Proven neutral across 226 cases (−0.1% return, 49% positive) — there is genuinely nothing to read below this line. |
| **8 – 11 points** | **Minor.** A gap exists but carries no demonstrated meaning. Do not surface. |
| **≥ 12 points** | **Material divergence.** This is the level at which the gap was shown to be *sticky* — pillars 12+ apart do not reliably converge at the next reading (median movement ≈ 0). Real, persistent tension. |
| **≥ 16 points (Market vs a fundamental pillar)** | **Stretched.** The specific condition behind the price-ahead patterns: Market at 74+ while the fundamental pillar sits below 58. |

**Ownership patterns use movement, not a standing gap:** Ownership has risen or fallen **8+ points** from its prior reading.

### 1.2 Severity

Severity is the size of the gap, not a separate calculation.

```
severity = |pillar_A − pillar_B|
```

12–15 = material · 16–24 = stretched · 25+ = extreme.

For reference on what extreme looks like in practice: Glenmark ran a Market-minus-Foundation gap of **42, then 57**.

### 1.3 Regime context

Regime is **per peer group**, not per stock, and not part of the divergence calculation.

```
index = the PG's benchmark index
        (for PG8 Power, PG9 Metals, PG10 Oil & Gas — no benchmark exists,
         so use an equal-weight average of that PG's scored peers)

trailing_6mo = index(today) / index(126 trading days ago) − 1

HOT       if trailing_6mo > +0.25
STRESSED  if trailing_6mo < −0.12
NORMAL    otherwise
```

Verified against independent price behaviour: HOT phases realised +46% mean 6-month sector return at 25% volatility; NORMAL +7% at 19% (the genuinely calmest state); STRESSED −18% at 28%.

**Two rules:**

1. **It must be computed on the sector, never the stock.** The regime uses a trailing price return — computing it on the stock itself would be circular, since a stock whose price ran hard *is* the price-ahead-of-fundamentals pattern. You would be using the same price move both to fire the signal and to explain it away.
2. **Regime never gates whether a pattern is shown.** It changes the wording only. Same pattern, same severity, different sentence beneath it.

### 1.4 Resolution — and why *how* it resolved is the real content

A divergence stands until the gap closes back to **≤ 7 points**. But the two ways it can close mean opposite things, and both must be recorded:

- **CONVERGED** — the lagging pillar rose to meet the leading one. The business grew into it. *Glenmark:* price ran far ahead of a falling Foundation (55→48), then Momentum climbed 32→20→63→75 and the tension dissolved with no crash.
- **COLLAPSED** — the leading pillar fell back to the lagging one. *BHEL:* Market 78 against Foundation 53 and Momentum 48; the fundamentals never caught up and the price fell **−32%**.

Logging which outcome occurred builds a per-stock resolution history, and it is the most honest way to teach users what a divergence means — it demonstrates both outcomes rather than implying divergence always ends badly.

### 1.5 Reading rules that apply to every pattern

- A divergence is an **unresolved tension, not a prediction.** The regime sets the timing of the resolution; it does not cancel the fact of it.
- **You can read the state; you cannot time the resolution.** Proven directly — 12+ gaps do not reliably converge.
- **A divergence lives inside one stock.** It is a stock departing from its own expectation. Never subtract two stocks' divergence scores.
- **Effect sizes are modest.** A few percent of sector-excess return, hit-rates in the 40s–60s. Direction is the robust part; magnitude is not.
- **Sector-excess is the honest measure.** The study window was a rising market and absolute returns flatter everything. Where both are shown, sector-excess is the real one.

---

## Part 2 — The seven divergence patterns

---

### D1 · Price Ahead of Quality
**Market vs Foundation — the re-rating story**

```
Market ≥ 74  AND  Foundation < 58
```

**What it means.** The market is paying far more than the underlying quality of the business justifies. Foundation is a slow-moving read on how fundamentally sound a company is, so when price runs away from it, the market is changing what it is *willing to pay* for a given level of quality. This is a re-rating story — structural, slower-moving, and the more durable of the two price-ahead patterns.

**Evidence.** Inherits from the tested price-ahead-of-fundamentals configuration (n=79), which measured Market against the combined fundamental average: **−2.9% sector-excess, 42% positive**. Split by regime: **HOT +9.6%** (masked, still paying) versus **NORMAL +0.2%, 40% positive**. Caught at a turn, far stronger — at the June-2024 melt-up peak this configuration returned **−10.3% over the following 180 days, 22% positive**, and the broader stretched set (Market ≥ 72) returned **−11.4%, only 27% positive**.

*Honest note: the split into quality-versus-trajectory is not separately measured. Both halves inherit the direction from the combined test.*

**Named cases.** BHEL — Market 78 against Foundation 53 → **−32%**. ABB **−36%**, Siemens **−33%**, Thermax **−36%**, Honeywell **−39%**, Cummins **−24%**. And the opposite resolution: **Glenmark**, where Foundation fell 55→48 while Market held 74–77 (gap 42, then 57) — and the fundamentals eventually caught up rather than the price collapsing.

**User copy:**
> *The market is paying well above what the quality of this business currently supports. That gap closes one of two ways — the business improves into the price, or the price comes back to the business. It does not stay open forever, and this reading cannot tell you which way or when.*

**In a HOT regime, append:**
> *The sector is in a strong run that is currently carrying this stock. Historically that postpones the resolution rather than cancelling it.*

---

### D2 · Price Ahead of Trajectory
**Market vs Momentum — the expectations story**

```
Market ≥ 74  AND  Momentum < 58
```

**What it means.** The market is pricing a turn the results have not delivered. Momentum reads how the business is trending *right now*, so a gap here is about **earnings expectations** rather than quality — the market expects an improvement the numbers haven't shown yet. Faster-moving and noisier than D1, and more likely to resolve quickly in either direction, because a single set of results can close it.

**Evidence.** Same source as D1 (n=79 combined configuration): **−2.9% sector-excess, 42% positive**; **−10.3%, 22% positive** when caught at a turn. Inherits direction; not separately measured.

**Named case.** BHEL again — Momentum 48 against Market 78, the trajectory as weak as the quality.

**User copy:**
> *The price is running ahead of the company's current trajectory — the market is pricing an improvement the results have not yet shown. Either the next few quarters deliver it, or the price adjusts back.*

---

### D3 · Ownership Building Against a Weak Foundation
**The strongest positive pattern in the study**

```
ΔOwnership ≥ +8  AND  Foundation < 60
```

**What it means.** Institutions are *increasing* their stake in a business whose published fundamentals look weak. That is a deliberate, costly decision taken against the visible evidence — which is exactly what makes it informative. Someone with a better view is putting real money behind a thesis the numbers do not yet reflect.

**Evidence.** **+1.9% sector-excess, 58% positive** (n=26). In absolute terms **+10.3%, 88% positive** — roughly 9 in 10 cases rose. A native-threshold rerun produced comparable results (~+12% absolute, 88% positive). Most notably, in **STRESSED phases it was 100% positive** (n=7) — the only pattern in the entire study that held up through stress.

**Caveat to display.** n=26, and the Ownership pillar is heavily compressed (its 25th, 40th, 50th and 60th percentiles are all exactly 60.0), which structurally limits sample size on every Ownership pattern. Directionally the strongest positive found; not a large-sample law.

**User copy:**
> *Institutional ownership is rising while the fundamentals still read as weak. Informed money is buying against the visible evidence — historically one of the more meaningful things this model detects.*

---

### D4 · Ownership Exiting a Healthy Business

```
ΔOwnership ≤ −8  AND  Foundation ≥ 72
```

**What it means.** The mirror of D3. Smart money is leaving a business that still *looks* sound on the published numbers. The exit tends to precede the deterioration showing up in the financials.

**Evidence.** **−3.4% sector-excess, 36% positive** (n=11). A separate disclosure-anchored check returned **−2.7% on the day, 0% positive** (n=3). *(The original test used a slightly lower Foundation bar; the native strong-zone threshold of 72 is specified here.)*

**Named case.** **Tata Steel** — Foundation still read 71 while Ownership had already slipped 60→52. Momentum then collapsed to ~36, Market fell 79→34, the price faded, and only *afterwards* did Foundation follow 71→63. Ownership moved first.

**Caveat.** n=11, and n=3 on the short-window check. Sample-starved. Present as a reason to investigate, never as a verdict.

**User copy:**
> *Institutions have cut their position while the business still reads as healthy. When ownership moves before the fundamentals do, it is worth understanding what they are seeing.*

---

### D5 · Laggard Catching Up
**Momentum converging toward a strong Foundation**

```
(Foundation − Momentum) ≥ 8  AND  ΔMomentum ≥ +5
```

**What it means.** A fundamentally sound business whose trajectory had fallen behind is now turning up. The weak pillar is converging *toward* the strong one — and the direction of convergence is the whole point. The identical Momentum rise against a *weak* Foundation (the pillars widening apart instead) performed markedly worse: **−3.8%, 27% positive in normal phases** (n=11). Same trigger, opposite outcome, decided by which pillar it is moving toward.

**Evidence.** **+17.7% mean, 80% positive** same-window (n=5). A regime-split rerun returned **+13.5% overall and +17.7% in NORMAL phase** — one of very few patterns that works in calm markets rather than only in a rally. A disclosure-anchored check found **+5.2% sector-excess, 100% positive** (n=6).

**Caveat — display prominently.** n=5–6 on the core cells. This has now appeared in **four separate tests**, which is why it survives scrutiny, but it remains a directional hypothesis rather than a proven edge.

**User copy:**
> *The balance sheet was already strong; the trajectory is now turning up to match it. The weaker pillar is converging toward the stronger one — historically the more constructive version of improving momentum.*

---

### D6 · Quality Rolling Over
**Foundation strong, Momentum cooling — the Siemens pattern**

```
Foundation ≥ 72  AND  Momentum falls below 75 (from ≥ 75)
```

**What it means.** A high-quality business that the market has already priced as high-quality. Its only *fresh* input — the trajectory — has turned down. There is no upside surprise left to deliver, and the one thing that could still move the story is now moving the wrong way.

**Evidence.** **−3.4% forward, 45% positive** (n=11). In **HOT phases −7.3%, 33% positive** — worse precisely when the sector is running and the name is most fully priced.

**Named case.** **Siemens** — Foundation rock-stable at 68–73 throughout, yet Market fell 91→46 as the price de-rated ₹4,600→₹3,000 and Momentum cooled 80→67. Stability is not immunity from falling.

**User copy:**
> *This is a strong business the market already recognises as strong. Its trajectory has now turned down. When quality is fully priced in, a cooling trajectory is the thing that tends to matter.*

---

### D7 · Trajectory Breaking While the Base Holds

```
Momentum falls below 54 (from ≥ 54)  AND  Foundation ≥ 60
```

**What it means.** An early warning. The balance sheet is still intact but the operating trajectory has broken into weakness. Worth noting: the intact Foundation does **not** cushion this — the version with fundamentals holding is *more* negative than the bare Momentum break alone (**−1.4%, 41% positive**, n=22), which is the opposite of the intuitive expectation.

**Evidence.** **−2.9% forward, 40% positive** (n=10). In **NORMAL phases −4.9%, 38% positive** — reads more clearly in calm markets, consistent with every directional pattern in the model.

**User copy:**
> *The balance sheet is still sound, but the operating trajectory has broken into weak territory. This is early — the base has not deteriorated yet, but the direction has changed.*

---

## Part 3 — The two states

Real, interpretable conditions with no return claim attached. Their value is telling the user what kind of situation they are looking at.

---

### S1 · Aligned — No Tension

```
max(all four pillars) − min(all four pillars) ≤ 7
```

**Evidence.** **−0.1%, 49% positive** (n=226) — verifiably, deliberately neutral. This is the control that proves the other patterns are not artefacts of the method.

**What it means.** The market's view and the business's condition agree. Nothing is unresolved. This is a genuinely useful reading, not an empty one — most of a screening tool's value is telling you where you do *not* need to look.

**User copy:**
> *The pillars agree. What the market is paying and what the business shows are in line — no unresolved tension to read here.*

---

### S2 · Sticky Divergence — Unresolved and Not Converging

```
|Foundation − Momentum| ≥ 12,  sustained across more than one reading
```

**Evidence.** When Foundation and Momentum sit 12+ points apart, neither reliably converges at the next reading — median movement ≈ 0. An observed structural property, not a return claim.

**What it means.** The tension is real and it is *not* resolving. This is the reading that most directly teaches users the model's honest limit: the state is readable, the timing is not.

**User copy:**
> *These pillars have disagreed for more than one period and are not converging. The tension is unresolved — the model can show you that it exists, but not when it will close.*

---

## Part 4 — Explicitly excluded

Recorded so these are not re-introduced by mistake.

| Excluded | Why |
|---|---|
| **Generic widening spread** (any pillars fanning apart) | −1.1%, 44% positive (n=365) and **inverted in banks** (+5.6%, 74% positive). Fatally, it does not say which way the tension resolves — Foundation strengthening while Momentum rolls over, and Momentum recovering while Foundation erodes, produce the identical number. Opposite situations, one output; they cancel. |
| **Narrowing spread** | +0.2%, 51% positive (n=239). Indistinguishable from nothing. |
| **Fundamentals ahead of price** (Foundation ≥72, Market ≤50) | Evidence **conflicts**: one run −0.6% / 47% (did not work), another +13.7% / 80% but measured on absolute returns in a rising market. We cannot say what it means, so it does not ship. |
| **Loose high-Foundation / cooling-Momentum** (F ≥68, ΔM ≤ −5) | −0.6%, 46% (n=28). Marginal, and superseded by D6, which is three times stronger. |

**The test for anything added later:** *if you cannot say which way the tension resolves and why, it does not belong in the tool.*

---

## Part 5 — Summary

| # | Pattern | Pillars | Trigger | Went the predicted way | Size | n |
|---|---|---|---|---|---|---|
| D1 | Price ahead of quality | Market vs Foundation | Mkt ≥74, F <58 | ~6/10 · 8/10 at a turn | −2.9% xs; −10.3% at turn | 79* |
| D2 | Price ahead of trajectory | Market vs Momentum | Mkt ≥74, M <58 | ~6/10 · 8/10 at a turn | −2.9% xs; −10.3% at turn | 79* |
| D3 | Ownership building, weak Foundation | Ownership vs Foundation | ΔOwn ≥+8, F <60 | ~6/10 xs · **9/10 absolute** | +1.9% xs; +10.3% abs | 26 |
| D4 | Ownership exiting, healthy Foundation | Ownership vs Foundation | ΔOwn ≤−8, F ≥72 | ~6/10 | −3.4% xs | 11 |
| D5 | Laggard catching up | Foundation vs Momentum | F−M ≥8, ΔM ≥+5 | **8/10** | +17.7% | 5 |
| D6 | Quality rolling over | Foundation vs Momentum | F ≥72, M below 75 | ~6/10 | −3.4% | 11 |
| D7 | Trajectory breaking, base holds | Foundation vs Momentum | M below 54, F ≥60 | **6/10** | −2.9% | 10 |
| S1 | Aligned — no tension | All four | spread ≤7 | *neutral by design* | −0.1% | 226 |
| S2 | Sticky divergence | Foundation vs Momentum | \|F−M\| ≥12 sustained | *no return claim* | — | — |

*\* D1 and D2 share the n=79 combined configuration; the split into quality-versus-trajectory inherits its direction and is not separately measured.*

*"Went the predicted way" = share of cases that moved in the direction the pattern implies — so for a bearish pattern, the share that fell. Read against a ~50% coin-flip baseline.*

---

*All analysis diagnostic and read-only. No bar, weight, lens anchor or threshold was changed or informed by any result. CN-8 and CN-1 hold in full.*
