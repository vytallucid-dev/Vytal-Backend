# Vytal — The Three-Lens Pattern Library · Data Bank
 
**Version:** 1.0 — source of truth for lens-state patterns (metric-level and pillar-level)
**Status:** Definitional, not empirical. These patterns require **no test program** (see §0.3). They describe structural facts that are true by construction the moment the three lenses are read.
**Companion artifacts:** the **Health Score Source of Truth** (the philosophy these patterns inherit), the **Findings Map** (the Label/Signal/Read/Tool/Doesn't-mean vocabulary used here), the **Sections 2 & 5 Rules Spec** (the existing R1–R6 / P1–P13 firing engine these sit *alongside*), and the **Health Score Master Spec v5.5.1** (where the three lenses are defined and the metric bars/PG means/trajectories are computed).
 
**What this document is.** The complete, closed catalog of every pattern that arises from the *relationship between the three lenses* on a single metric, and the rules for rolling those up to a pillar-level read. It is the brief the engine holds to fire these patterns, and the brief every consuming surface holds to display them. It defines the patterns, their meaning, their boundary, and their reuse — it does **not** dictate UI (that is the downstream decision this document deliberately stops short of).
 
---
 
## 0 · The foundations — read first, they govern everything
 
### 0.1 · What the three lenses are
 
Every scored metric in the Foundation and Momentum pillars is read three ways. This is already built; the score already uses all three. This library exposes the *relationship* between them, which the composite score collapses and discards.
 
| Lens | Question it answers | Reference point | What it is |
|---|---|---|---|
| **L1 — Absolute** | Is this metric good in plain, universal terms? | The data-derived **bar** (threshold) | The floor. Identical in every sector (CN-1). "Is ROCE ≥ the bar." |
| **L2 — Peer-relative** | Is it good *relative to the only fair comparison set*? | The **peer-group mean / distribution** | The competitive read. "Is ROCE above what this field typically does." |
| **L3 — Trend** | Is it good *relative to where this stock has been*? | The stock's **own history** | The self-read. "Is ROCE improving, flat, or declining for this name." |
 
These three are the **same spine as the whole product, one level down.** The Source of Truth says: *health compares across stocks* (that is L2), *signals live inside each stock* (that is L3), and *the bands are absolute and cross-sector-constant* (that is L1). The three-lens layer is the metric-level expression of the exact philosophy the pillar-level model already runs on.
 
### 0.2 · The governing idea — disagreement is the information
 
A metric where all three lenses agree tells you nothing you didn't already know from the score. **The information is in the disagreement.** When the three lenses point different ways, the composite — which blends them into one number — has *hidden* a true structural fact. This library's entire purpose is to name those facts.
 
Crucially, and this is the deepest thing in the document:
 
> **A lens-disagreement can be a statement about the *peer group* or the *stock's own arc*, not about the stock's standalone quality.**
 
The clearest case: a metric **below its absolute bar but above the peer mean**. The stock's quality on that metric is mediocre in absolute terms — yet it is the *best of a weak field*. That is not primarily a fact about the stock. **It is a fact about the pond: the whole peer group is struggling on this metric right now.** The mirror — **above the bar but below the peer mean** — is the opposite: the stock is absolutely fine, but its *peers are exceptional*. In both, the stock's own absolute quality is similar; what flips is the verdict on the *field*. Nothing else in Vytal surfaces this. The composite cannot — it is one number, and "the field is weak" and "the stock is weak" produce nearly the same composite while meaning opposite things.
 
### 0.3 · Why these patterns need no testing — the discipline that keeps it true
 
The health-score patterns (P1–P13) required a test program because each made an **implicit empirical claim** — "margin compression *tends to precede* something." That is a hypothesis about the world; it must be proven against data.
 
**Lens patterns make no claim about the future.** They are **definitional**. "Below bar, above peer mean" *is* "tallest in a sunken field" — the moment the two lens values are read, the pattern is true. There is nothing to predict, therefore nothing to test. It is arithmetic plus a name plus a meaning.
 
This is only safe under one **inviolable rule**:
 
> **A lens pattern describes what the disagreement IS. It never states what happens NEXT.**
 
The instant a pattern says "…and therefore it will revert," "…a buying opportunity," "…momentum will return," it has smuggled in a forward claim, ceased to be definitional, and now needs proof we do not have. So:
 
- ✅ "ROCE is below its bar but ahead of the peer field — the field is weak on this metric."
- ❌ "ROCE is below its bar but ahead of the field — likely to re-rate as the cycle turns."
This is the **no-advice spine of the whole product, applied one layer down.** It is what lets the entire library skip the test program honestly. Every entry below obeys it; any future entry must.
 
### 0.4 · Inheritance from the platform's commitments
 
These patterns inherit, without exception:
- **No advice / no prediction** (§0.3). Descriptive only.
- **Honest-empty over fabricated.** A lens that cannot be computed (no bar set, insufficient peers, < 2 snapshots) renders as *that honest state* — never as a pass, a fail, or a fabricated value. A pattern that depends on a missing lens **does not fire** (it is not "false," it is *not evaluable*).
- **Comparability with integrity.** L2 is always within the peer group, never cross-sector.
- **States over numbers.** A pattern is a *named state*, and the absolute value remains the hero of any display (per the UI principle this document hands off to).
---
 
## 1 · The lens-state space — the complete map
 
### 1.1 · The three readings, formalized
 
Each metric, per snapshot, yields:
 
- **L1 ∈ { above_bar, below_bar }** — sign of `(raw_value − bar)`, direction-aware (for "lower is healthier" metrics like D/E, the comparison inverts; "above_bar" always means *healthier than the threshold*).
- **L2 ∈ { above_peer, near_peer, below_peer }** — position vs PG mean, with a **near band** (within ±0.5σ of the PG mean, or a metric-specific tolerance) so "essentially at the field average" is its own state and we don't fire a disagreement on noise.
- **L3 ∈ { improving, flat, declining }** — direction of the stock's own trajectory over the available in-force snapshots, with a **flat band** (change within a noise tolerance). Requires ≥ 2 snapshots; otherwise **not_evaluable**.
This yields a 2 × 3 × 3 grid = 18 raw cells, but the meaningful, *named* patterns collapse to the catalog in §2 (many cells are minor variants that share a meaning; some are degenerate).
 
### 1.2 · The two axes of meaning
 
Reading the grid, two independent things are being said at once:
 
1. **The stock's standing** — primarily L1 (absolute quality) crossed with L3 (its own direction).
2. **The field's condition** — primarily the *relationship* between L1 and L2 (is the stock's absolute standing in tension with its peer standing, and which way).
A complete metric read therefore always carries **both** a stock-verdict and, when L1 and L2 disagree, a **field-verdict**. This duality is the structural reason the library is richer than "good/bad metric."
 
---
 
## 2 · The metric-level pattern catalog (closed)
 
Naming convention: **`LM*`** = Lens, Metric-level. Each pattern is universal across every metric, financial and non-financial. The metric only supplies the noun ("ROCE", "D/E", "promoter holding", "capacity utilization"); the pattern supplies the meaning.
 
Each entry carries the standard faces (**Label · Signal · Read · Doesn't-mean**) and a **severity tone** consistent with the platform (descriptive tones only — Constructive / Neutral / Caution / Concern — *never* Buy/Sell, never green-as-buy).
 
---
 
### LM1 · Compounding Strength
**State:** L1 above_bar · L2 above_peer · L3 improving
**Plain meaning:** Strong in absolute terms, ahead of its field, and *still improving*. The clean, unambiguous good case for this metric. No tension — all three lenses agree upward.
**Field-verdict:** none (no L1/L2 tension).
- **Label:** "Strong & still climbing" · Constructive tone.
- **Signal:** fires when a metric *enters* this cell (was not LM1 last snapshot, is now).
- **Read:** "This metric clears its bar, leads the peer field, and is improving against its own history — strength on all three lenses."
- **Doesn't mean:** "a sound, improving metric — not a forecast that it continues, and not a buy signal. Already-strong metrics are already priced."
---
 
### LM2 · Plateau at the Top
**State:** L1 above_bar · L2 above_peer · L3 flat or declining
**Plain meaning:** Best-in-class — clears the bar, leads the field — **but no longer improving against itself.** The leader who has stopped pulling away, or begun to ease. *(This is your example 2.)* The stock is excellent; the news is that its *own* arc has flattened or turned, even while it still tops the field.
**Field-verdict:** none (the field read is "leads"); the information is the **self-deceleration**.
- **Label:** "Best-in-class, but flattening" (flat) / "Best-in-class, easing off its peak" (declining) · Neutral → Caution tone.
- **Signal:** fires on the L3 turn from improving → flat/declining *while* L1+L2 remain strong.
- **Read:** "Still clears its bar and leads the peer field — but it has stopped improving against its own history. A peak-and-hold (or a peak-and-ease), not a deterioration."
- **Doesn't mean:** "the leader is faltering or that decline is coming — only that this metric is no longer *outpacing itself*. A flattening at the top is not a fall."
---
 
### LM3 · Tallest in a Sunken Field
**State:** L1 below_bar · L2 above_peer · (L3 any)
**Plain meaning:** **Below the absolute bar, yet ahead of the peer mean.** The metric is sub-par in universal terms — but it is *the best of a weak field*. **The headline is the field, not the stock:** the whole peer group is underwater on this metric right now. *(This is your example 1 — the pond signal.)*
**Field-verdict:** **the peer group is structurally weak on this metric.** This is the load-bearing case in §0.2 — a metric pattern that is primarily a *sector-condition statement*.
- **Label:** "Below bar — but leads a weak field" · Caution tone, **field-flag** styling (the caution is about the *pond*, not the stock).
- **Signal:** fires when a below-bar metric is simultaneously above_peer.
- **Read:** "This metric sits below its absolute bar — sub-par in universal terms — yet it is *above* the peer-group average. The read is about the field: this peer group is weak on this metric right now, and the stock is simply the strongest of a struggling set."
- **Doesn't mean:** "the stock is fine on this metric — it is below the universal bar. And being best-of-a-weak-field is not a forecast that the field recovers. It is a statement about *where the weakness lives* — in the field, not uniquely in this name."
- **L3 sub-variant:** if L3 = improving, append (descriptively only) "and it is improving against its own history" — but **never** "and therefore recovering." The improvement is a third true fact, not a prediction.
---
 
### LM4 · Exceptional Field
**State:** L1 above_bar · L2 below_peer · (L3 any)
**Plain meaning:** **Clears the absolute bar, yet trails the peer mean.** The mirror of LM3. The metric is genuinely good in universal terms — the stock lags only because **its peers are exceptional.** *(This is your "peers are exceptional" case.)* The headline, again, is the field: this is an elite peer group.
**Field-verdict:** **the peer group is structurally strong on this metric.**
- **Label:** "Clears the bar — in an elite field" · Neutral tone, **field-flag** styling.
- **Signal:** fires when an above-bar metric is simultaneously below_peer.
- **Read:** "This metric clears its absolute bar — sound in universal terms — but sits *below* the peer-group average. The read is about the field: this is an exceptional peer group, and the stock lags not because it is weak, but because the company it keeps is elite."
- **Doesn't mean:** "the stock is weak on this metric — it clears the universal bar. Trailing an elite field is not a flaw; it is context. Do not read 'below peer mean' as 'bad' here."
---
 
### LM5 · Recovering off the Floor
**State:** L1 below_bar · L2 below_peer · L3 improving
**Plain meaning:** Weak in absolute terms *and* behind the field — **but improving against its own history.** The only constructive reading among the genuinely-weak cells. All three lenses are low/negative except the stock's own direction, which has turned up.
**Field-verdict:** none of note (both L1 and L2 are weak; no tension to flag — the field and the stock are both low).
- **Label:** "Weak & behind — but turning up" · Constructive-within-Caution tone.
- **Signal:** fires on L3 improving while L1 below_bar and L2 below_peer.
- **Read:** "Below its bar and below the peer field — weak on both absolute and competitive lenses — but it is *improving against its own history*. A low-base turn, visible only because the trend lens is read separately."
- **Doesn't mean:** "a recovery that will complete, or a buy. Improvement off a weak base is a real, observed change in *this metric's own arc* — not a prediction it reaches the bar or the field. The Source of Truth's recovery findings live at the pillar level and carry their own evidence; this is the metric-level echo, descriptive only."
- **Note:** this is the metric-level cousin of the pillar-level **Recovery (Family D)** finding. Where D fires on the composite/pillar turn, LM5 fires on a single metric's turn. They should *reinforce*, not double-count (see §5.3).
---
 
### LM6 · Eroding Lead
**State:** L1 above_bar · L2 near_peer · L3 declining
**Plain meaning:** Still clears the bar, but has **converged down to the field average and is sliding** — the gap to the pack has closed from above. A leader reverting toward the mean. Distinct from LM2 (which still *leads* the field); here the peer lead is essentially *gone* (near_peer) and the direction is down.
**Field-verdict:** none; the information is the **loss of competitive separation**.
- **Label:** "Lead eroding — converging to the field" · Caution tone.
- **Signal:** fires on transition from above_peer → near_peer with L3 declining.
- **Read:** "Still above its absolute bar, but its edge over the peer field has narrowed to roughly the field average, and it is declining against its own history. The competitive separation is eroding."
- **Doesn't mean:** "the stock is now weak — it still clears the bar. Converging to the field average is a loss of *relative* lead, not a fall into weakness."
---
 
### LM7 · Triple Fail
**State:** L1 below_bar · L2 below_peer · L3 declining
**Plain meaning:** Below the bar, behind the field, and **still sliding.** The honest worst case — all three lenses negative, no offsetting fact. No ambiguity, no field-excuse, no self-turn.
**Field-verdict:** none of note (both weak; the stock is genuinely the weak one, not a field artifact).
- **Label:** "Weak on every lens" · Concern tone.
- **Signal:** fires on entry to the all-negative cell.
- **Read:** "Below its absolute bar, below the peer field, and declining against its own history. Weak on all three lenses simultaneously — no offsetting read."
- **Doesn't mean:** "a prediction the stock falls — it is a hard quality/risk read on *this metric*, not a price call. Weak-on-all-three is a reason to investigate the metric, not a sell."
---
 
### LM8 · Field-Masked (the silent-agreement caution)
**State:** L1 below_bar · L2 below_peer · L3 flat — *but the composite/pillar reads acceptable*
**Plain meaning:** A quiet structural weakness that the *pillar aggregate may be hiding* because other metrics in the pillar are carrying it. The metric is weak on absolute and peer lenses and not improving — yet because it is one of several, the pillar score does not scream. Surfaced so a genuinely weak metric is never buried by aggregation.
**Field-verdict:** none; this is an **anti-masking** surfacing rule (consistent with the platform's "honest-empty / never hide a real weakness" stance).
- **Label:** "Quiet weak spot" · Caution tone.
- **Signal:** fires when a metric is below_bar + below_peer + flat *and* its pillar's state is ≥ Steady-equivalent (i.e., the metric is the laggard the pillar is masking).
- **Read:** "This metric is below its bar and below the peer field and not improving — but its pillar reads acceptable because other metrics carry it. Flagged so the weak spot is visible, not buried in the average."
- **Doesn't mean:** "the pillar's score is wrong — the aggregate is honest. This simply surfaces *which* component is the soft one inside an otherwise-acceptable pillar."
---
 
### Degenerate / non-firing cells (named for completeness — these do NOT produce cards)
 
| Cell | Why no pattern |
|---|---|
| L1 above_bar · L2 near_peer · L3 improving/flat | This *is* the expected healthy-metric state — no disagreement, no information. Folds into LM1's "no-tension" baseline; renders as a clean pass, not a finding. |
| L1 below_bar · L2 near_peer · L3 flat | Uniformly soft, no tension, no turn — renders as a plain "below bar" state, not a named pattern. |
| Any cell with a **not_evaluable** lens | Cannot fire (honest-empty, §0.4). Renders the missing-lens state, never a pattern. |
 
**The rule:** a card fires **only** when there is genuine cross-lens tension (LM2, LM3, LM4, LM6, LM8) or unambiguous all-lens agreement worth stating (LM1 strong, LM5 constructive-turn, LM7 weak). Pure no-tension expected states render as the metric's plain lens display, *not* as a finding. This keeps the library "loud at the extremes, quiet in the middle" at the metric level too.
 
---
 
## 3 · The pillar-level roll-up
 
Per your direction: a pillar-level lens read *in addition to* the metric-level patterns. Naming: **`LP*`** = Lens, Pillar-level.
 
### 3.1 · The roll-up rule (the "70% on a lens" idea, formalized)
 
For a pillar with *N* scored metrics, compute the **share of metrics passing each lens**:
 
- `L1_pass_share` = (# metrics above_bar) / N
- `L2_pass_share` = (# metrics above_peer) / N
- `L3_improving_share` = (# metrics improving) / N
A lens is called **strong** for the pillar at **≥ 0.70 share**, **mixed** at 0.40–0.70, **weak** at < 0.40. (0.70 is the default "dominant majority" cut; it is a display threshold, tunable, not a model bar — it changes no score.)
 
> **Only scored, evaluable metrics count toward N.** Not-evaluable metrics (no bar, insufficient peers, < 2 snapshots) are excluded from the denominator and surfaced separately, never counted as a fail. (Honest-empty, §0.4.)
 
### 3.2 · The pillar-level patterns
 
| ID | State | Meaning | Tone |
|---|---|---|---|
| **LP1 · Broad Strength** | L1 strong · L2 strong | The pillar is strong on most metrics, absolutely *and* vs the field. Genuine breadth. | Constructive |
| **LP2 · Field-Lifted** | L1 weak/mixed · L2 strong | Most metrics trail their bars but beat the field — **the pillar's relative strength is a weak-field artifact** (the LM3 story, aggregated). The pillar leads the pond, but the pond is low. | Caution (field-flag) |
| **LP3 · Field-Suppressed** | L1 strong · L2 weak/mixed | Most metrics clear their bars but trail the field — **an elite peer group** (the LM4 story, aggregated). The pillar is sound; the field is exceptional. | Neutral (field-flag) |
| **LP4 · Improving Breadth** | L3 improving strong (≥0.70 metrics improving) | A *majority* of the pillar's metrics are improving against their own history — broad self-improvement, regardless of absolute/peer level. | Constructive |
| **LP5 · Eroding Breadth** | L3 declining strong (≥0.70 metrics declining) | A majority of the pillar's metrics are sliding against their own history — broad self-deterioration. The early, breadth-based read of a pillar losing altitude. | Caution → Concern |
| **LP6 · Hollow Pillar** | L1 strong · L3 declining strong | Most metrics still clear their bars, but most are *declining* — the pillar's absolute standing is intact but its momentum-within-itself is broadly negative. A strong-but-fading pillar. | Caution |
 
**LP2 and LP3 are the pillar-level expression of the deepest idea in §0.2** — they make the "is this the stock or the field?" verdict legible at the pillar level, not just per metric. A user who sees Foundation flagged **Field-Lifted** instantly understands: *this company's balance-sheet metrics look relatively strong only because its peers are weak right now.* The composite could never say that.
 
### 3.3 · Relationship to the existing pillar-divergence findings
 
The existing **C-family (Divergence)** findings fire on *gaps between pillars* (Foundation vs Momentum, price-ahead, etc.). The **LP patterns fire on the lens-breadth *within* a single pillar.** They are orthogonal: C says "Foundation and Momentum disagree"; LP says "*within* Foundation, the absolute and peer lenses disagree." Both can fire; they describe different things and must not be merged.
 
---
 
## 4 · The full faces table (engine-ready summary)
 
| ID | Lens state (L1 · L2 · L3) | Label | Tone | Field-verdict? | Fires a Signal? |
|---|---|---|---|---|---|
| LM1 | above · above · improving | Strong & still climbing | Constructive | — | on entry |
| LM2 | above · above · flat/declining | Best-in-class, but flattening | Neutral→Caution | — | on L3 turn |
| LM3 | below · above · any | Below bar — leads a weak field | Caution (field) | **PG weak** | on entry |
| LM4 | above · below · any | Clears bar — in an elite field | Neutral (field) | **PG strong** | on entry |
| LM5 | below · below · improving | Weak & behind — but turning up | Constructive/Caution | — | on L3 turn |
| LM6 | above · near · declining | Lead eroding — converging to field | Caution | — | on convergence |
| LM7 | below · below · declining | Weak on every lens | Concern | — | on entry |
| LM8 | below · below · flat (pillar masks) | Quiet weak spot | Caution | — (anti-mask) | on entry |
| LP1 | pillar: L1 strong · L2 strong | Broad strength | Constructive | — | on entry |
| LP2 | pillar: L1 weak · L2 strong | Field-lifted | Caution (field) | **PG weak** | on entry |
| LP3 | pillar: L1 strong · L2 weak | Field-suppressed (elite field) | Neutral (field) | **PG strong** | on entry |
| LP4 | pillar: L3 improving ≥70% | Improving breadth | Constructive | — | on entry |
| LP5 | pillar: L3 declining ≥70% | Eroding breadth | Caution→Concern | — | on entry |
| LP6 | pillar: L1 strong · L3 declining ≥70% | Hollow pillar (strong but fading) | Caution | — | on entry |
 
---
 
## 5 · Integration rules — how this library coexists with the rest of the system
 
*(This section governs behavior, not pixels. The UI decision is downstream and deliberately out of scope.)*
 
### 5.1 · Compute-once, display-everywhere
 
A lens-pattern is a **pure function of the three lens values already on the metric atom**: `lensPattern(L1, L2, L3) → { id, label, tone, fieldVerdict }`. It is computed once, at the metric level, on the same snapshot the score reads — **it stores nothing new and recomputes nothing.** Every surface that displays a metric can therefore display its lens-pattern by reading this function's output. This is the platform's compute-once/display-twice law applied to the new concept; honor it from the start so the pattern is never re-derived per surface.
 
### 5.2 · Where each pattern is *eligible* to surface (placement is downstream)
 
The same metric-level pattern is reusable across surfaces. This document only states *eligibility* — the actual placement and visual treatment is the UI decision we will take next, per surface:
 
- **Stock Health page · Anatomy** — per-metric patterns inside each pillar card; pillar-level (LP) read as the pillar's summary line.
- **Stock Health page · Raw-floor** — the natural home of the three explicit lens values per metric; the pattern is the *interpretation* of the row.
- **Stock Health page · Notable findings (§5)** — only the **loud** lens-patterns (LM3, LM7, LP2, LP5 — the field-weak and broad-deterioration cases) are eligible to escalate into a finding card; the quiet ones stay in Anatomy/Raw-floor. *(Whether they escalate at all is a UI decision; this only marks eligibility.)*
- **Peer Group · Fundamentals tab** — **LM3/LM4 and LP2/LP3 are the native PG story** ("the field is weak/elite on this metric"); this is arguably their *most* natural home, read across the whole field at once.
- **Comparison** — two stocks' lens-patterns on the same metric, contrasted (never crowned).
- **Health Hub** — lens-patterns as a filterable/aggregatable signal across a scope (e.g. "show holdings with a Field-Lifted Foundation").
### 5.3 · Anti-double-counting with existing findings
 
- **LM5 (metric recovery)** must not double-count the pillar-level **Recovery (Family D)**. Rule: if Family D fires for the pillar, the constituent LM5 metrics are shown as *supporting detail under D*, not as separate top-level findings.
- **LP5/LP6 (eroding breadth / hollow pillar)** must not double-count **Deterioration (Family B)**. Rule: B is the headline; LP5/LP6 are the *breadth evidence* beneath it.
- **LM3/LM4 field-verdicts** are new and have no existing-finding overlap — they surface freely.
- **General rule:** existing R/P findings are the *headline*; lens-patterns are the *metric-level texture* underneath. When both speak to the same thing, the existing finding leads and the lens-pattern becomes its evidence — never a competing card.
### 5.4 · Honest-empty behavior (restated, binding)
 
- Missing bar → L1 not_evaluable → no L1-dependent pattern fires; metric shows "no bar set."
- Insufficient peers (N below the peer-Z minimum) → L2 not_evaluable → no L2-dependent pattern, **including all field-verdicts (LM3/LM4/LP2/LP3)** — a field-verdict on too few peers would be a fabricated claim about the field.
- < 2 in-force snapshots → L3 not_evaluable → no L3-dependent pattern; metric shows "building history."
- A metric with any not_evaluable lens **can still fire patterns that depend only on its evaluable lenses** (e.g. L1+L2 present, L3 missing → LM3/LM4 can fire, LM2/LM5/LM6/LM7 cannot).
---
 
## 6 · The boundary — what this whole library does NOT do (binding)
 
A consolidated restatement, because this is the load-bearing constraint:
 
- It does **not predict.** No pattern says what happens next (§0.3). Descriptive only.
- It does **not advise.** No buy/sell, no "opportunity," no "avoid." A field-weak metric is a *fact about the field*, not a recommendation.
- It does **not rank stocks by desirability.** It names states; it never orders names by "better."
- It does **not cross sectors.** L2 is always within the fair peer set.
- It does **not fabricate.** A missing lens is an honest state, never a pass/fail/number.
- It does **not override the score.** The composite remains the score; this library *explains the texture the composite compressed* — it adds reading, it changes no number.
- It does **not turn a flattening into a fall.** LM2/LM6 describe loss of *improvement* or *lead*; they never assert deterioration that the data doesn't show.
---
 
## 7 · The one test (mirrors the product's one test)
 
For any lens-pattern — existing or future — it qualifies for this library only if:
 
> **It names a true structural relationship between the three lenses (or the breadth of them), makes the user a sharper reader of what the score compressed, shows the reasoning, and says nothing about what the stock will do next.**
 
If it predicts, advises, ranks, crosses sectors, or fabricates — it is not a lens-pattern, and it does not belong here.
 
---
 
*This is the closed catalog and its governing rules. The patterns are definitional and untested-because-true. The next step is deliberately downstream and out of this document's scope: given this library as built, how the per-stock Anatomy cards, the raw-floor table, and the findings layer should be re-imagined to surface it — the UI decision.*