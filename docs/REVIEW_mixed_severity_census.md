# When one finding fires at two severities

**The reported symptom.** `momentum_P13_revenue_inflection` fires **green** on one company and **red** on another. A reader who asks the assistant about that pattern hears one thing; their own stock's page shows the other. Both are correct and they are confusing together.

_Measured against the live database, 95 scored companies, latest quarterly snapshot per company._

---

## 1. How widespread is it?

**Two findings vary their severity. Only one crosses the constructive/concern line.**

| Finding | Severities live | What varies |
|---|---|---|
| `momentum_P13_revenue_inflection` | `green` × 1 (POWERINDIA) · `red` × 1 (BDL) | **Direction.** Accelerating growth is green; decelerating is red. |
| `divergence_C2_ownership_vs_fundamentals` | `high` × 13 · `medium` × 12 | **Magnitude only.** Both are the same concern; `high` when the pillar gap reaches the wide tier. |

Everything else in the registry emits exactly one severity. I checked this structurally rather than only empirically — a rule that has never fired at two severities may still be able to — by reading the `severity:` expression in all 33 rule bodies plus the two non-FireRule paths:

- **Constant severity (31 rules).** All six red flags are `critical`. P7 / P11 / P4 / P5 are `red`; P8 is `amber`; P1 / P6 / P10 / P12 and all seven Family-N twins are `green`; B and C1 are `high`; D is `recovery`; F1 / F2 / G / H / I are `low`.
- **Varies by magnitude (1 rule).** C2 — `wide ? "high" : "medium"`.
- **Varies by direction (1 rule).** P13 — `accelerated ? "green" : "red"`.
- **Latent, unreachable (1 rule).** C3 writes `wide ? "high" : "medium"` but `const wide = true` sits immediately above it, so the medium branch is dead. C3 can only emit `high`. Worth knowing before anyone "fixes" the constant and silently gives C3 a second severity.

Several rules vary `direction` (G, H, F2, I) while holding severity constant — that is the intended shape, and it is why P13 stands out: it is the **only rule in the registry where the same named pattern is a constructive finding on one company and a concern on another**.

---

## 2. What I found while measuring it, which changes the recommendation

The premise was that "the universe census correctly takes the worse severity for its row". **It did not — for exactly the finding in question.**

`universe-view.service.ts` and `peer-group-view.service.ts` each declared their own severity ordering:

```ts
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const severityRank = (s) => s == null ? 99 : SEVERITY_ORDER[s.toLowerCase()] ?? 50;
const worseSeverity = (a, b) => severityRank(a) <= severityRank(b) ? a : b;
```

The engine emits **eight** severity tokens. The four §5E pattern tones — `red`, `amber`, `green`, `recovery` — were absent from that map, so all four collapsed to the `?? 50` default. Two live consequences:

**(a) `worseSeverity` stopped being "worse".** With `a` and `b` tied at 50, `a <= b` is true and it returns `a` — whichever member the query reached first. **P13's census row was reading `green`**, while one of its two firing companies is red. So the reader-facing confusion was the *opposite* of the one reported: the census was calling a mixed pattern constructive.

**(b) The census board sorted wrong.** Everything at rank 50 sorted after `low`, then fell back to member count. Observed on the live board before the fix:

```
low       trajectory_F2_composition_shift    n=19
low       trajectory_G_convergence           n=16
...
low       composition_F1_atypical            n= 8
recovery  trajectory_D_recovery              n=18
amber     foundation_P8_receivables          n=16
green     momentum_P12_margin_recovery       n=13
red       foundation_P7_accruals             n=11     ← RED, sorted below five LOW rows
red       momentum_P11_margin_compression    n=10
green     ...
```

`foundation_P7_accruals` carries the heaviest §5E magnitude (−8) and rendered below five `low` structural cards. Below the `low` block, severity was doing nothing at all — that half of the board was ordered purely by popularity.

The correct total ordering already existed, one module away, transcribed from File 1 §5 and covering all eight tokens: `severityWeight` in `catalogue/divergence.ts` (`critical 0 · red 1 · high 2 · amber 3 · recovery 4 · green 5 · medium 6 · low 7`).

---

## 3. Recommendation

### Done — because it is cheap and clearly right

**Point both read services at the catalogue's ordering instead of redeclaring a partial copy.** Two import lines; both local `SEVERITY_ORDER` maps deleted. This is a bug fix, not a design change: it makes `worseSeverity` deterministic and actually worse-selecting, and restores File 1 §5 order on the board. Null handling is unchanged (nulls still sort last).

The board after the fix:

```
critical  ownership_R6_distribution                n= 3
...
red       foundation_P7_accruals                   n=11
red       momentum_P11_margin_compression          n=10
red       momentum_P13_revenue_inflection          n= 2   ← now reports the worse of green/red
high      trajectory_B_deterioration               n=41
...
low       composition_F1_atypical                  n= 8
```

### Recommended, not done — state the spread on the row

Of the three options, **state the mix in the census row**. Not the severity range, and not "leave it".

**Why not the range.** "Fires between green and red" invites a reader to interpolate a middle, and there isn't one — green and red here are opposite *directions*, not ends of a scale. A range reads as a magnitude spread, which is the right frame for C2 and the wrong frame for P13.

**Why not leave it.** Post-fix, the row says `red`. That is correct for a census (a census exists to surface the worst thing present) and it is now precisely the reported problem: the reader hears "severe" while POWERINDIA's page shows the same pattern green. The fix above makes the row *correct* and leaves it *misleading*, which is the worst combination to stop at.

**Why the mix.** It is the only option that is true at both altitudes at once, and it costs one sentence: *"Fires at different severities across companies — green on 1, red on 1."*

**Shape of the change.** Add a spread to the census item and let the surfaces decide how loud to be:

```ts
// peer-group-view.types.ts — PathologyCensusItem
severity: string | null;                              // unchanged: the worst, for sorting
severitySpread: { severity: string; n: number }[];    // NEW: every severity present, worst-first
```

`buildCensus` already holds the per-member severities in its accumulator (`Acc.members[].sev`), so this is a `groupBy` over data it has in hand — no extra query, no schema change. Then three consumers:

1. **Hub → Flags & Patterns board** — render the second line only when `severitySpread.length > 1`. Today that is two rows out of twenty-six, so it stays quiet by default.
2. **`get-universe-scan` chat tool** — this is the one that actually closes the reported bug, because the reported bug is a *conversation*. The tool result should carry the spread so the assistant says "this one fires green on some companies and red on others, depending on whether growth is accelerating or decelerating" rather than "severe".
3. **Peer-group census** — same field, same rule; it shares `PathologyCensusItem`.

**Scope it honestly:** one type, one builder, one board component, one tool schema. Not large, but it is a payload change across three surfaces and it deserves its own commit and its own verify — which is why it is written up here rather than smuggled into a severity-ordering fix.

### One thing to decide first

P13 is the only rule whose severity crosses the constructive/concern line, and it does so because **one rule is doing two jobs**: "revenue growth accelerated materially" and "revenue growth decelerated materially" are different findings that happen to share an arithmetic test. Splitting them into two keys (`momentum_P13a_revenue_acceleration` / `momentum_P13b_revenue_deceleration`) would remove the mixed row entirely and let each carry its own description and its own doesn't-mean — which the current single description cannot do well, since it has to cover both directions in one sentence ("a clear acceleration or deceleration").

That is a bigger change (a key-vocabulary change, so: catalogue entry, generated fallback, alerts catalog, historical rows keep the old key) and it is a product call, not an engineering one. **If it is on the table, decide it before building the spread field** — the split makes the spread field unnecessary for P13, leaving only C2, whose mix is a magnitude spread and arguably fine as-is.

---

## Related

`momentum_P13_revenue_inflection` also has a **wrong number in its shipped description** — it publishes a 3pp bar where the engine uses 5pp. See `REVIEW_finding_copy_vs_triggers.md`. If P13 is being opened anyway, both should be handled in the same pass.
