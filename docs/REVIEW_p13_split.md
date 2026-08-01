# Splitting P13 into two keys — what it would take

**Report only. Nothing in this document has been built.** The recommendation is at the bottom.

---

## The problem, stated precisely

`momentum_P13_revenue_inflection` is one key covering two opposite phenomena:

```ts
severity: accelerated ? "green" : "red",
direction: accelerated ? "positive" : "negative",
magnitude: accelerated ? 5 : -5,
```

It is the **only rule in the 35-key registry whose severity crosses the constructive/concern line.** Everything else that varies (C2) varies in magnitude within one direction.

Three consequences, in increasing order of how hard they are to write around:

1. **The census row picks one.** Live today: green on POWERINDIA, red on BDL. The row reports the worse — `red` — which is right for a census and misleading for POWERINDIA's reader.
2. **One description covers both.** It now reads "…changed by at least 5 percentage points against the prior quarter's — a clear acceleration **or** deceleration in the pace of growth." Accurate, and it describes a measurement rather than a finding. A reader learns what was measured, not what was found.
3. **★ One doesn't-mean cannot cover both, and this is the real argument.** P13 currently inherits Family E's generic line: *"a condition to look at — not a trade signal."* The two directions need opposite guards. Decelerating growth invites "so it is turning down" — the guard needed is *growth slowing from a high base is still growth; a rate change is not a level change*. Accelerating growth invites "so it is turning up" — the guard needed is *one quarter's acceleration is not a trend, and a low base flatters it*. **Those two sentences contradict each other.** No single line does both jobs, which is why the generic family line is standing in — and a boundary that fits by being vague is the one part of the card that exists to be specific.

---

## What splitting involves

Nine things. Two are cheap, five are mechanical, two are the reason this is a decision.

### 1 · The rule — cheap, but it is a rule change

`p13-revenue-inflection.ts` returns one of two keys instead of branching severity on one:

```ts
key: accelerated
  ? "momentum_P13a_revenue_acceleration"
  : "momentum_P13b_revenue_deceleration",
severity: accelerated ? "green" : "red",   // unchanged
```

Everything above it — the nine-quarter depth gate, the TTM arithmetic, the 5pp bar, the banking exclusion — is untouched. **No firing decision changes and no score moves**: the same companies fire, at the same severities, with the same ±5 magnitudes. Only the label changes.

⚠ `RULE_REFS` in `engine.ts` maps rule *functions* to refs, and this stays one function. Either accept that both keys report `ruleRef: "P13"`, or split the function in two. One function is simpler and the ref is a diagnostic, not an identity.

### 2 · Key vocabulary — mechanical, and it is the gate that makes the rest safe

`STOCK_FINDING_KEYS` loses `momentum_P13_revenue_inflection` and gains two. Because `StockFindingKey` is derived from that array and `STOCK_FINDINGS` is total over it, **a key added without its copy does not compile** — which is exactly the property that makes this migration low-risk. `verify-catalogue.ts §4` closes the other direction (an emitter with no catalogue key).

### 3 · Two catalogue entries — the actual work, and the actual payoff

```ts
momentum_P13a_revenue_acceleration: {
  name: "Revenue Growth Accelerating",
  description:
    "Trailing-twelve-month revenue growth was at least 5 percentage points faster than in the prior quarter. The pace of growth picked up.",
  family: "E", concern: "momentum", status: "live",
  doesntMean:
    "faster growth is a change in pace, not in size — and one quarter of acceleration is not a trend; a weak prior year flatters the comparison.",
},
momentum_P13b_revenue_deceleration: {
  name: "Revenue Growth Decelerating",
  description:
    "Trailing-twelve-month revenue growth was at least 5 percentage points slower than in the prior quarter. The pace of growth eased.",
  family: "E", concern: "momentum", status: "live",
  doesntMean:
    "slower growth is still growth — a falling rate is not a falling business, and it says nothing about the level of revenue or about margins.",
},
```

Illustrative, not final — copy is the operator's. But this is the point of the exercise: two boundaries that each say something, replacing one that says something general because it has to.

⚠ Both would need to be added to §7's `BAR_NAMING` list (they name the 5pp bar), and both fall under §5's calibration scan.

### 4 · Historical rows keep the old key — the one genuinely awkward part

`score_patterns` rows already persisted carry `pattern_key = 'momentum_P13_revenue_inflection'`, and they are **append-only history stamped with the spec version that produced them**. Three options:

| | What happens | Cost |
|---|---|---|
| **Keep a retired entry** *(recommended)* | Old key stays in the catalogue with `status: "retired"`; two new keys go live. Historical rows still resolve to copy. | One extra registry entry, permanently. Matches how P2 and P3 were handled — except those were *deregistered* and their copy removed, because they can never fire again *and* their rows were re-attributed. Here the rows persist under the old key. |
| **Backfill the rows** | `UPDATE score_patterns SET pattern_key = … WHERE pattern_key = 'momentum_P13_…'`, keyed on `evidence->>'deltaPp'` sign. | Rewrites history. The codebase's own rule is that a snapshot reproduces from its stored inputs; this breaks that for two rows today and more later. Not recommended. |
| **Leave them unresolvable** | Old rows render title-only. | The exact defect the whole catalogue migration existed to remove. No. |

The recommended path is cheap **today** — 2 rows — and gets more expensive the longer the decision waits. That is the strongest argument for deciding soon rather than deciding carefully.

### 5 · Everything else — mechanical

- **`alerts/finding-catalog.ts`** — a user can hold an alert bound to `momentum_P13_revenue_inflection`. Existing bindings must keep resolving, or a reader's alert silently stops firing. Cheapest correct handling: recognise the old key and map it to *both* new ones.
- **`copy.generated.ts`** — `npm run gen:copy`, then the freshness gate. Automatic.
- **Chat** — `get-universe-scan` matches findings by NAME as Vytal writes it. Two names replace one; a reader asking about "TTM Revenue Inflection" should still land somewhere. Worth one alias.
- **Verify scripts** — `verify-catalogue.ts` (key reconciliation, §7 bars), `verify-verdicts.ts` (renderer coverage), and `_content-review-doc.ts`'s `R` map.
- **The Hub census board and peer-group census** — no change. They render whatever keys arrive.

---

## 3b · Is `severitySpread` still needed?

**For P13, no — the split removes the need entirely.** Two keys, each with one severity, is a strictly better fix than annotating one key that has two: it fixes the description and the doesn't-mean at the same time, which the spread field cannot touch.

**For the census generally, it is no longer worth building.** With P13 split, exactly one finding fires at mixed severities — `divergence_C2_ownership_vs_fundamentals`, at `high` (13 companies) and `medium` (12). That mix is a **magnitude** spread inside one direction: both readings are the same concern, one wider than the other. The census row reports `high`, which is the worse, which is correct and not misleading — a reader told "this is a high-severity divergence" and then seeing a medium one on their stock has learned that gaps come in sizes, not that the product contradicted itself.

So the honest sequencing is:

> **Split P13 → `severitySpread` is not needed.**
> **Don't split P13 → `severitySpread` is needed**, because the green/red row is genuinely misleading and nothing else fixes it.

They are alternatives, not a sequence. Building the spread field first would be building the weaker fix for the one case that the stronger fix eliminates.

---

## 3c · Recommendation

**Split it.** Reasoning, shortest first:

1. **The doesn't-mean argument is decisive on its own.** Every finding in this product is contracted to carry an interpretive boundary; P13 is the one that cannot, and it has been quietly borrowing its family's generic line to cover the gap. That is not a copy problem to be written around — it is one key holding two findings.
2. **No score moves.** The same companies fire at the same severities with the same magnitudes. This is a labelling change with a rule edit attached, which is the cheapest class of change that touches a rule at all.
3. **It is cheapest now and never cheaper.** Two historical rows. Every quarter of delay adds rows under a key that is going to be retired.
4. **It removes a whole feature from the backlog.** `severitySpread` — a type, a builder, a board component and a tool schema, across three surfaces — stops being necessary.
5. **The compiler carries the migration.** `STOCK_FINDINGS` is total over `StockFindingKey`, so the half-done state does not build. That is why this is a two-hour change and not a risky one.

**Against, honestly:** it is still a rule change in a build whose rule was "no rule bodies change", and it costs one permanently-retired catalogue entry. Both are real; neither outweighs a finding that cannot state its own boundary.

**If you split it, do these two together:** the P13 copy is currently pinned to `P13_INFLECTION_PP = 5`, which the rule marks provisional. Splitting is the moment to decide whether that constant is settled — because the two new descriptions will name it, and the `BAR_NAMING` gate will pin it in a third place.

**If you don't split it,** build `severitySpread` as specified in `REVIEW_mixed_severity_census.md`, and accept that P13's boundary line stays generic.
