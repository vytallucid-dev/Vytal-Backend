# Vytal AI Composition Architecture — Specification v1.0

**Status:** design-ratified, pre-build
**Supersedes:** the tool-calling chat layer (`src/chat/tools/`, 33 tools)
**Depends on:** GATE 0 recon (`docs/recon/GATE0_AI_ARCHITECTURE.md`) + GATE 0b fast recon
**Authority:** Master/Architecture chat. Claude Code executes; it does not amend this document.

---

## 0. The one-sentence thesis

> **The model classifies. Code composes. The model then phrases over facts it did not compute.**

This is not new doctrine. It is the Quarter Brief's *"the model phrases, never calculates"* — already shipped and already proven — generalised from one card to the whole chat surface.

### 0.1 Why the old layer produced generic answers

The diagnosis is **not** that the model was free-forming. It already had 33 tools and a closed-world guarantee. The diagnosis is that **a four-pillar decomposition delivered as sentences is worse than the same decomposition delivered as a waterfall**, and no amount of prompt work closes that gap. Structure, not authorship, was the defect.

This has a direct consequence for sequencing: **the artifact contract and the renderer set buy most of the perceived quality gain on their own**, before any composition file is written. See §9.

### 0.2 The second reason, which is larger than the first

Current chat: ~21k fixed input tokens per message, 33 tool definitions at ~11.9k, tool results compounding through the session, against a 250k input-tokens/minute budget. That is **~4 chat turns per minute for the entire product, all users combined.**

The new layer: one classification call carrying no tool definitions, a compact digest, artifact payloads that never enter the token stream, and a class of turns (Meta, concept lookups, client-side re-sorts) costing **zero model tokens**.

This is the scaling fix. Chat does not survive its first real week at 4 turns/minute.

---

## 1. Non-negotiables

These bind every downstream decision. They are not restated in each section.

| # | Rule |
|---|---|
| **N-1** | **The model never emits a number.** Every figure in every artifact is a query result. The model writes 2–4 connective sentences over a digest that already contains the figures as display strings. |
| **N-2** | **Payload and digest never meet.** One resolve produces two objects: `payload` → browser, `digest` → model. The model cannot see the payload; the browser does not read the digest. |
| **N-3** | **No parallel paths.** A new path ships and the old path dies in the same commit. *Exception:* extraction commits (§8.2). |
| **N-4** | **Absence is a state, never a zero and never a silence.** Every renderer owns a visible absent state. A component that vanishes when data is thin is a lie, not an empty state. |
| **N-5** | **One vocabulary per concept.** No registry, enum or gloss set is duplicated in the AI layer. Extend the existing home or consume it. |
| **N-6** | **Coverage is stated, never discovered by collision.** Universe searched, tier, resolved window, as-of, dropped filters, depth floor — on the artifact, not buried. |
| **N-7** | **The model may route to a surface it cannot describe.** Linking is permitted; interpreting is not. (See §7.4, technicals.) |

---

## 2. The four layers

```
  user text
      │
      ▼
┌─────────────┐   slots + scope verdict, no tool defs, no data
│   ROUTER    │   ~1 model call · small fixed prompt
└─────────────┘
      │
      ▼
┌─────────────┐   declarative: (section, resolver, params, condition)[]
│ COMPOSITION │   one file per family · carries its own examples + assertions
└─────────────┘
      │
      ▼
┌─────────────┐   8 kinds · ~28 renderers · each owns its absent state
│  SECTIONS   │   emits payload (browser) + digest (model)
└─────────────┘
      │
      ▼
┌─────────────┐   ~31 pure reads · Resolved<T> · never throws on absence
│  RESOLVERS  │   25 already exist (GATE 0 §2)
└─────────────┘
```

**Adding a family touches exactly one layer: a new composition file.** That is the extensibility requirement, and it is testable — see §6.4.

---

## 3. Contract 1 — `Resolved<T>`

```ts
type Resolved<T> =
  | { ok: true;  data: T;   coverage: Coverage; provenance: Source[] }
  | { ok: false; absent: Absent; coverage: Coverage }
```

### 3.1 Rules

> #### ★★★ THE RULE THE BULLETS BELOW ARE INSTANCES OF
>
> **A field whose presence is checked but whose meaning is not.**
>
> This build found the same defect five times wearing five costumes, and each was fixed as its own
> lesson before anyone noticed it was one defect. Stated once, it is worth more than five lessons,
> because the sixth costume has not been invented yet and the rule still covers it.
>
> | costume | what is checked | what is never established |
> |---|---|---|
> | `catch(() => [])` | the array exists | that anything was *read* |
> | `?? 0` | a number is present | that anything was *counted* |
> | a silent `JOIN` | the total is arithmetically right | that the set is *whole* |
> | `doesntMean: ""` | the field satisfies its type | that a boundary was *authored* |
> | a guard over an empty collection | every member passes | that there was a *member* |
>
> The last is the subtlest and reads as the strictest: *"every mention of the term is the term"* is
> green when there are no mentions. A test that cannot fail is not a weak test, it is an absent one.
>
> **The test, for any of them.** Write the sentence the value will produce, then ask whether it is
> still true when nothing was read, counted, joined, authored or iterated. If it is not, the check
> is confirming a shape and asserting a fact — and only one of those reaches the reader.
>
> **Corollary — an absence is either OURS or THE WORLD'S, and the sentence says which.** Every
> `NotEvaluableReason` except `read_failed` and `reader_read_failed` completes *"this needs …"* with
> something the record lacks. Reaching one of those from a caught failure hands the reader our error
> dressed as the company's silence, which they have no way to detect and no way to question.
>
> *Status: the `verify-swallowed-absence` allowlist reached **zero** (22 → 19 → 9 → 0). It stays in
> the build with an empty list, so the next site fails on the commit that introduces it.*
>
> #### Two things to check BEFORE writing the branch
>
> **1 · Check the type before writing a split.** Four of the last nine sites had a second arm that
> could never be reached: the read was typed non-nullable (`Promise<UniverseHealthView>`,
> `Promise<ScreenProjection>`), so the "record" token was only ever describing a swallowed throw.
> A split written there is unreachable code that reads as thoroughness — the guard-over-nothing
> costume above, in its most flattering disguise. If the read cannot return the empty value, do not
> write the arm that handles it; write the one reachable sentence and say in a comment why there is
> only one.
>
> **2 · "An absence outranks a count" is not always true.** It is a good instinct and it is false
> wherever the count comes from a read that *throws* rather than *defaults*. In `reader.ts` the
> holdings count is `subject.coverage.holdings`, produced by a query with no catch — so `0` is a
> successful read that found nothing, a fact we hold. Testing the absence first would answer *"we
> could not read your book"* to a reader whose empty book we had read perfectly well: a false claim
> traded for a withheld one. **Ask where the number came from.** A count from a throwing read
> outranks an unrelated absence; a count from a defaulting read never does.
>
> #### ⚠ AND THE PATTERN GATE IS NOT THE PROPERTY — `verify-dead-database.ts`
>
> `verify-swallowed-absence` reads shape, and shape has two blind spots this build walked into after
> its allowlist hit zero:
>
> - **Distance.** It scans a fixed window between the catch and the `absent()` it reaches.
>   `resolveUniverse`'s sat eleven lines away, outside a nine-line window, and was green.
> - **Destination.** It looks for a catch reaching an *absence*. `resolveRelationship`'s four catches
>   fed a `resolved()` — an `ok: true` **answer** — so a failed read became `held: false` and
>   rendered as **"You hold it: no"**, a flat claim about the reader's own position. No window of any
>   width would have found it, because there was no `absent()` to find.
>
> - **Reach.** Its largest catch was not a swallow at all. `resolveStockCoverage` is the coverage
>   envelope for the whole market side — 24 call sites, 3 guarded: seven resolvers in `blocks-stock`
>   reach it through `envelopeFor`, and seven composition families call it directly. One unguarded
>   query meant that with the database down, **18 of 18 market paths threw** and every reader got an
>   error page instead of a sentence. A source scan cannot see that, because there is nothing wrong
>   with any individual line; the defect is that one shared read had no failure arm.
>
>   Guarding it exposed the second half: a null coverage flowed on as `tier ?? 0` (routing every
>   family away as though the stock were unscored) and then into the generic fallback's close —
>   *"That is everything we hold on X today."* A completeness claim over a read that never ran.
>
> The behavioural gate states the property instead of a shape: *with the database unreachable, no
> answer may claim to have checked anything.* It runs the real resolvers against a closed port — a
> mock that returned absences rather than throwing would test the mock — and it carries the two
> guards this build learned to demand of any such mode: a **non-empty corpus** assertion (a
> dead-database run over zero answers passes trivially) and a **reintroduced swallow** proving it
> goes red.

- **Never throws on absent data.** Throwing is reserved for invariant violations (the read layer already observes this: 3 throw sites, all invariant assertions).
- **Never returns `null` to mean "no data."** `null` inside `data` means a field is genuinely null-valued; absence is the `ok: false` arm.
- **⚠ A CATCH THAT RETURNS AN EMPTY COLLECTION IS A CLAIM THAT THE COLLECTION IS EMPTY** — added
  stage 7, found by stage 6 in its own new code.

  ```ts
  const rows = await prisma.$queryRawUnsafe(...).catch(() => []);   // ← the defect
  const row  = rows[0];
  holdings: Number(row?.total ?? 0)
  ```

  That swallowed a wrong column name and rendered *"your book is empty as far as we can see"* to a
  reader holding **21 positions**. It looks like defensive coding and it is zero-for-unknown wearing
  a different shape: `?? 0` states a quantity nobody measured, and `catch(() => [])` states an
  absence nobody observed. The second is harder to see, because the empty array is one layer away
  from the number it becomes.

  **The rule.** A catch may only supply a value the caller could not tell apart from a real one *by
  meaning*, not merely by type. `[]` from a query that FAILED and `[]` from a query that found
  nothing are different facts, so a failed read either throws or returns an absent arm. The same
  applies to `?? null`, `|| {}` and `catch(() => false)`.

  **The tell:** if you cannot write the sentence the empty value will produce, and have it be true
  when the read failed, the catch is a lie.

- **A silent join is the same defect at set scope.** `JOIN stocks` on a holdings query counted 13 for
  a book of 21 — the other 8 were funds and bonds with no `stock_id`. The filter was correct and
  unstated, so a complete-looking set had quietly lost a third of itself. That is what
  `DroppedFilter` exists to name.

- **Never returns `0` for unknown.** GATE 0 §4.3 catalogued ~48 product-code violations. The rule already exists in `src/portfolio/phs` (*"`?? 0` IS NOT A NEUTRAL DEFAULT — IT IS A FALSE STATEMENT"*); this contract generalises it.

### 3.2 `Absent` — consume, do not redefine

`NotEvaluableReason` (15 tokens, persisted at `StockFinding.notEvaluableReason`, 15 authored reader phrases) is the canonical vocabulary. `MetricUnavailableReason` (5 tokens, compute-layer) duplicates two of them under different constructors.

**Ruling:** merge `MetricUnavailableReason` into `NotEvaluableReason`; the AI layer consumes the merged union and **defines no absent enum of its own** (N-5). Two additions are required:

| Token | Why |
|---|---|
| `not_ingested` | Zero hits repo-wide. Tier-0 stocks (in `stocks`, no quarterly row) have no representation today. |
| `not_run` | `FilingCoverage` already separates this from `not_evaluable` — *"the rule was never run, rather than run and declined."* Promote it into the shared union. |

`not_covered` stays as-is: `src/catalogue/not-covered.ts` is a registry of ten tested-and-not-shipped patterns, a different meaning, correctly separate.

```ts
type Absent = {
  reason: NotEvaluableReason        // the merged union, from src/scoring/findings/types
  phraseKey: CopyKey                // reader phrase from relational/coverage.ts — never free text
}
```

### 3.3 `Coverage` — extended with depth

```ts
type Coverage = {
  tier: 0 | 1 | 2                   // 0 = in stocks, not ingested · 1 = ingested · 2 = scored
  universeSearched: number          // actual count, not the nominal universe
  window: Window | null             // RESOLVED, never as-requested
  asOf: string                      // per-stock in-force, NOT per-run (§3.5)
  depth: DepthProfile               // ★ added post-GATE-0b
  dropped: DroppedFilter[]          // named, never silent
}

type DepthProfile = {
  quarters: number                  // distinct in-force quarterly periods held
  snapshots: number | null          // distinct in-force score periods, null if unscored
}
```

**Amended 2026-08-29 (stage 2). `Coverage` is two objects, not one, and `DepthProfile` was carrying
two fields belonging to the other one.** A floor is what a CALLER asked for; a count of exclusions is
a fact about a SET. Neither is a property of a stock — on a single subject `excludedForDepth` could
only ever be 0, a field carrying no information at the site it was defined for. The implemented shape:

```ts
type SubjectCoverage = { tier; asOf: string | null; window: Window | null; depth: DepthProfile }
type QueryCoverage   = { universeSearched; depthFloor: number | null; excludedForDepth; dropped }
type Coverage        = { subject: SubjectCoverage | null; query: QueryCoverage | null }
```

Both halves explicitly nullable, neither optional: a resolver must decide which it can honestly fill,
and `subject: null` is a statement where a missing key is an oversight. This retires stage 1's
documented compromise — an ambiguous symbol resolution mirrored `candidates[0]` into the envelope and
so advertised a tier for a subject nobody had chosen. **`subject: null` now makes that
unrepresentable rather than better-documented.** `asOf` is `string | null` for the same class of
reason (stage 1).

**Why `depth` is not optional.** Post-fill the universe is *variable*, not uniformly shallow: scored stocks hold 14–34 quarters; the 2,182 unscored hold 1–34, with 1,396 sitting at exactly an 8-quarter floor and 404 below 8. A Tier-1 screen silently comparing a 34-quarter stock against a 1-quarter stock is the same class of quiet lie as a silently-shortened window (DX-07). **Any composition performing a trend, a multi-period delta, or a cross-sectional comparison declares a depth floor and reports `excludedForDepth`.**

### 3.4 The zero-vs-unknown fix set owned by this build

**⚠ REWRITTEN 2026-08-29 (stage 2), on measurement. Five of this section's six rows were wrong.** The
original table was assembled by grepping `?? 0` across the read layer. Every row was a real
occurrence of the pattern; only one was a real defect.

**The one that was real — FIXED:**

| Site | Defect |
|---|---|
| `ownership-series.service.ts` + `stocks-list.service.ts` | `(numN(r.fiiPct) ?? 0) + (numN(r.diiPct) ?? 0)`. A NULL bucket means *the company did not disclose that class this filing*, not *the class holds nothing*. Measured over 25,168 filings: 1,050 FII-null, 1,384 DII-null, and **2,477 disclosure flips** (315 where FII was disclosed last quarter and absent this one, 2,162 the reverse). Each flip fabricated a trade. SAHLIBHFI rendered the ownership chip `rotation` — *"FII sold, DII bought"* — from `fiiDelta=-2.15` and `diiDelta=+1.26`, where FII disclosure had simply stopped and DII disclosure started. Nobody rotated anything. Both sites now return `null` when either side is undisclosed; the tell is `flat`. The delta fields were already `number \| null` and `ownershipTell` already accepted null on all three, so this was arithmetic that had to stop lying, not a contract change. |

**The five that were not, and why each looked like one:**

| Site | Why it is not a defect |
|---|---|
| `contrasts.ts:252,278,362,394` | Every site sits behind `pctMove(…) !== null`, and `pctMove` returns null when either side is null **or ≤ 0**. The value is provably non-null and positive before `?? 0` evaluates. The `?? 0` is type-narrowing appeasement, dead at runtime. *(The underlying data worry was sound — 1,135 of 1,513 bank-quarters carry null provisions — but the consequence is that the contrast does not fire, not that it renders ₹0.)* |
| `price-view.service.ts:97,135` | `daily_prices.close` is **NOT NULL** — 3,157,264 rows, no nullable close. Unreachable. |
| `holdings-controller.ts:210` | Feeds `entityKeyOf(…)`, a grouping-key derivation, not a rendered figure. The display path is separately guarded: `unrealizedPnl = marketValue != null && invested != null ? … : null`. |
| `stocks-list.service.ts:332,333` | A sort comparator. The rendered values are separately null; unknowns already sort last. Where unknowns rank is a product decision, not a correctness one. |
| `results-list.service.ts:186` | `.filter((r) => r.profitYoy != null)` runs immediately before the sort. Unreachable. |

**★ THE LESSON, WHICH IS WORTH MORE THAN THE TABLE. A grep of a pattern is not a finding, because the
pattern's meaning depends on the guards above it.** `?? 0` is a defect only where a null can actually
reach it and the result is actually rendered; five of six failed one of those two tests. An audit that
reports occurrences as defects costs its reader five no-op edits and buries the one real fix among
them — and, worse, teaches that the list can be worked through without reading the call site, which is
precisely how the one real defect would have been "fixed" into a different shape of wrong. Any future
zero-for-unknown sweep names, per row: **the null path that reaches the site, and the surface that
renders the result.**

Scoring-input hits (`capEmployed`, AT1/Tier-1, the four finding rules) remain out of scope — they go
to the scoring seat, not here.

**Still open, blocked on §4.4's generated types, not on judgement:** `spark: number[]` in
`stocks-list.types.ts` cannot carry a null point without a cross-repo type change, so an undisclosed
ownership quarter still renders as a dip to the disclosed remainder rather than a gap in the line.
Same defect class as the row above it; different blocker.

### 3.5 `asOf` is per-stock, not per-run — and for pillars, per *pillar*

Scoring runs are **incremental** (`scored=7`, `scored=8` per run). There is no full-universe run.
`getLatestSnapshot` resolves in-force per stock across runs. **Any composition stating an as-of or a
spec version reads it per stock.** Reading it per run yields 7 where the answer is 95.

**⚠ AMENDED 2026-08-29 (stage 3). PER-STOCK IS NOT FINE-GRAINED ENOUGH FOR `score_pillars`.**

That table is **not** one row per pillar per snapshot. Each pillar is written independently, when its
own source moves, on its own cadence. Measured on TCS:

```
market      run a683a51c  asOf 2026-08-28  source PRICE:2026-08-28   ← rewritten daily
ownership   run 8b4fae43  asOf 2026-08-25  source FY27Q1             ← quarterly
foundation  run d972fe8e  asOf 2026-08-24  source FY26               ← annual
```

**The join that caused it — and it is the obvious one:**

```sql
JOIN score_pillars sp
  ON sp.stock_id = ss.stock_id AND sp.as_of_date = ss.as_of_date AND sp.run_id = ss.run_id
```

The newest run rewrote MARKET ALONE, so that join returns one pillar and reports the other three as
unscored. It shipped a waterfall claiming **TCS and LT cannot score Foundation** — a worse lie than
the zero-height bar the section was written to prevent, and arithmetically detectable only because the
bars then failed to sum to the composite.

**The corrected rule: resolve in-force PER PILLAR, bounded at the snapshot's as-of** so the read stays
point-in-time and cannot pick up a pillar written after it:

```sql
SELECT DISTINCT ON (pillar) pillar, subtotal, pillar_state, source_period
FROM score_pillars
WHERE stock_id = $1 AND as_of_date <= (SELECT as_of_date FROM latest)
ORDER BY pillar, as_of_date DESC, created_at DESC
```

**The generalisation, which is the part worth carrying forward:** *a row's as-of belongs to the row,
not to the run that happened to write it.* Any table where different columns are refreshed on
different cadences has this shape, and joining on `run_id` silently reads one cadence as if it were
all of them. `score_pillars` is the instance found; it is unlikely to be the only one.

**★ THE VERIFICATION RULE THIS ESTABLISHES — BOTH SUBJECTS, ALWAYS.** The bug above was invisible on a
thin stock: with no pillars scored, wrong output and a correct absent state are byte-identical. It was
visible only on a HEALTHY subject, where the bars must sum. The converse is the more familiar failure
— code that works on the healthy case and lies on the thin one, which is what §3.1 exists to prevent.

**So every resolver, section and composition is verified against a healthy subject AND a thin one, and
neither substitutes for the other.** The absent path is both where things break and where breakage
hides. A verification that exercises one subject has tested half the contract and cannot say which
half.

### 3.6 Resolver work

25 of 31 exist and are PIT-correct. Porting is a wrapper, not a rewrite.

**Build first, blocks everything:**
- **#1 symbol resolution + coverage tier.** No server-side search exists — the picker fetches the whole universe and filters client-side. Every composition begins with a resolved subject, so the router has nothing to route against. Also a scaling defect independently: whole-universe fetch was tolerable at 504 stocks and is not at 2,291. Fuzzy match → ranked candidates → tier + `DepthProfile`.

**Build in-build:** #6 field coverage by sector · #13 valuation multiples · #20 news (extract from `result-detail`) · #28 watchlist seam (same query written out 5×) · A8 change-point detection · own-move vs peer-shift decomposition · event merge service.

**Fix before Attribution ships — ⚠ AMENDED 2026-08-29 (stage 2): this overstated the block.** #5 field-level scoring detail returns `0` for `nominalWeight`, `effectiveWeight` and `contribution` on an unscored metric, which is indistinguishable *on those three fields* from "scored and contributed nothing" — and `contribution` is what the Attribution waterfall draws a bar from.

**But the discriminator is already on the wire.** `scoreState` is `"scored"` only in the first case, and `metricScore` (the field beside them) is already correctly `null` in the second. **Attribution is buildable truthfully today** by testing `scoreState === "scored"` first. What is blocked is not Attribution — it is making the *wrong* reading impossible.

Measured: `score_metrics` holds 16,382 rows, **all** `score_state='scored'`, zero nulls in those three columns. The mapper's `num()` coercion therefore never fires; the code-built placeholder (`health-view.service.ts`, `nominalWeight: 0, effectiveWeight: 0, contribution: 0`) is the entire exposure.

The honest type is `number | null`, matching `metricScore` directly above it. It was not changed at stage 2 because `contribution: number` is declared **independently** by the frontend at `Vytal-Frontend/types/health.ts:303` — a hand-maintained twin, not a generated one — so narrowing the backend alone sends `null` to a consumer whose type says `number`. It lands with §4.4's generated cross-repo types, as one change across both repos.

**✅ CLOSED — verified end to end at T-3, 2026-08-31. Nothing was left to fix; this entry had gone stale.** The narrowing landed at stage 3, and the Phase-0 plan carried T-3 as a live blocker on Attribution for two stages afterwards purely because this paragraph and its twin in `health-view.types.ts` were still written in the present tense. Re-measured across the whole chain rather than at the declaration alone:

| Link | State |
|---|---|
| `health-view.service.ts:415` — the code-built placeholder, *"the entire exposure"* above | emits `nominalWeight: null, effectiveWeight: null, contribution: null` |
| `health-view.service.ts:512-514` — the mapper | the `num()` coercion sits behind `ms.scoreState === "scored" ? … : null` |
| `health-view.types.ts:518-520` | `number \| null` |
| `Vytal-Frontend/types/health.ts:305-307` — the hand-maintained twin | `number \| null`; both sides narrowed together |
| Consumers | the frontend **declares and never reads** all three (the methodology page records that they are deliberately not rendered, *"nor any product, ratio or bar width using them"*). The only reader in either repo is `composition/families/orientation.ts:142`, which filters `p.contribution !== null` before sorting on it. |

**Attribution is not blocked and has not been since stage 3.** The lesson is §3.4's, one level up: a *comment* describing a closed defect as open is as costly as the defect, because nothing contradicts it and the next reader budgets for work that does not exist. Both comment sites are now past-tense and carry the verification above.

**Publish decision (Operator):** `ServedPatternFacts` exposes 3 of 14 fields. The PT-02 condition ladder needs `gapFloor`, `movementFloor` and the tier fields to render at all. Pattern floors are arguably not on the moat list (bar calibration and guardrail thresholds are). Unresolved — ladder does not build until ruled.

---

## 4. Contract 2 — `Section`

```ts
type Section<K extends SectionKind> = {
  kind: K
  renderer: RendererId              // must be in RENDERERS[K]
  payload: PayloadFor<K>            // → browser. Fat. Never tokenised.
  digest: DigestFragment            // → model. ~50–150 tokens. Never rendered.
  coverage: Coverage
  interactions: InteractionSpec[]   // sort/toggle/drill — client-side, no round trip
}
```

### 4.1 The kinds

Derived by decomposing all 198 question-bank entries. No entry required a ninth — **because all 198
were questions.**

#### ★ `ACTION` IS THE NINTH KIND — amendment, stage 6, recorded stage 7

The bank contained no REQUESTS. Nine of the 33 chat tools were writes, and replacing
propose→confirm→execute with rendered affordances (§5.4) needs a section that carries a **control**:
an endpoint, a method, a body, a label. Nothing in the other eight does.

| Kind | Answers | Renderers |
|---|---|---|
| `ACTION` | *what the reader can change, and the control that changes it* | confirm-control · prefilled-form |

**It is not a `NEXT` variant, and that was the tempting wrong answer.** `NEXT` offers chips —
navigation, where the worst case of a tap is a page the reader did not want. An `ACTION` control
**changes the reader's data**. Filing a mutation as a fifth renderer of a navigation kind puts the
two behind one type, and the first person to write a generic `NEXT` renderer renders a write as a
link. §4.1's own rule — *"if a list grows past six, someone built a variant that should have been a
parameter"* — cuts the other way here: this is not a variant of a chip, it is a different thing, and
**that difference is exactly what a section kind is for.**

**The two renderers are a safety split, not a layout choice.** `confirm-control` is one tap and is
admitted only where the action is trivially reversible and carries **no fields the reader must
check**; `prefilled-form` is used wherever the action carries values, so a quantity or a price is
read by a human before it becomes a row. See §5.4 for the invariant that makes the kind safe: no
model output ever reaches a write.

---

| Kind | Answers | Renderers |
|---|---|---|
| `ANCHOR` | *what is the headline object* | hero-scored · hero-fundamental · hero-dual · hero-set · set-table |
| `DECOMPOSITION` | *what are its parts, and what did each contribute* | pillar-bars · waterfall · margin-walk · dupont-tree · condition-ladder |
| `RELATIVE` | *where does this sit against something* | peer-marker · distribution-strip · own-history-band · opposed-bars |
| `CALLOUT` | *the one thing code found that the reader shouldn't hunt for* | divergence · top-drags · largest-movers · nothing-found |
| `SERIES` | *what shape over time* | composite-spine · stepped-filing-line · statement-trend · phase-shaded-spine · value-line |
| `RAIL` | *what happened, dated and sourced* | event-rail · filing-rail · news-list |
| `COVERAGE` | *what was searched, over what window, with what dropped* | coverage-header (single renderer) |
| `NEXT` | *where can this go* | chips (single renderer) |

**Closed set.** If this list needs a ninth kind, that is an architecture amendment, not a build decision. If `RENDERERS[K]` grows past six, someone is building a variant that should have been a parameter.

#### ★ TWO RENDERERS ADDED — amendment, T-1b (2026-09-01). No new kind.

Both were raised under §6.4's extensibility test rather than absorbed, and both were ruled in. Neither
adds a kind: the questions they answer were already `ANCHOR`'s and `SERIES`'s, and only the
presentation was missing.

| Kind | Renderer | Answers |
|---|---|---|
| `ANCHOR` | **`set-table`** | *the same question as `hero-set` — "what is this collection" — at a resolution the reader can work with* |
| `SERIES` | **`value-line`** | *a continuous quantity over time, where the existing four all assume a bounded score or a discrete filing* |

**`ANCHOR : set-table` — and why it is not a new kind.** A screen result's headline object IS the
match set; `hero-set`'s own header already names "a screen result" as one of its cases. So this is the
same question with more resolution, not a different question. `hero-set` carries one figure per row;
`set-table` carries several comparable columns, sorted, each row navigable. Both stay: a watchlist of
six with one health score each does not want a table.

⚠ **THE NAME IS THE RULING, AND IT WAS CHOSEN AGAINST THE FAMILY THAT WILL WANT A TABLE NEXT.** Two
different table shapes are coming, and calling this one `table` would have collapsed them:

  · **rows are ENTITIES, columns are MEASURES** — a screen result, a peer-group panel, a watchlist.
    Sortable by any column; every row navigates to that entity. **This renderer.** PG reuses it with
    different columns, which is a parameter, not a variant.
  · **rows are LINE ITEMS, columns are PERIODS** — a financial statement. The row is a metric, not a
    company; nothing navigates; the column order is chronological and not sortable. **A different
    renderer** when F needs one, and forcing it through this one would be exactly the strained
    parameter §4.1 warns about. Reserved name: `statement-table`.

`set-table` says "the table form of `hero-set`", which is the true relationship and keeps the second
shape's name free.

**`SERIES : value-line` — generic, deliberately, and it is why the portfolio needed only ONE new
renderer rather than two.** Of the two components finding 6 asked for:

  · **portfolio health over time** is a 0–100 score with bands — structurally identical to a stock's
    health composite. It reuses **`composite-spine`** unchanged. No renderer was needed for it, and
    naming a `portfolio-health-spine` would have been a variant of exactly the kind this rule forbids.
  · **portfolio value over time** is money: continuous, unbounded, currency-formatted, no bands. The
    four existing SERIES renderers all assume otherwise — `composite-spine` and `phase-shaded-spine`
    fix a 0–100 axis, `stepped-filing-line` steps because filings are discrete, `statement-trend` is
    per-period statement lines. Nothing draws a continuous money series.

It is named `value-line`, not `portfolio-value-line`, because the shape is not the portfolio's: an
instrument's NAV, a fund's value and a market cap over time are the same renderer with a different
unit. The unit is a parameter on the payload.

Counts after this amendment: `ANCHOR` 5 of 6, `SERIES` 5 of 6. Both remain under the ceiling; the next
addition to either should be read as the warning §4.1 states.

### 4.2 Renderer rules

- **Every renderer takes `Resolved<T>` and owns a visible absent state** (N-4). The existing primitives are display parts to be wrapped, never the contract boundary — `Sparkline` takes a bare `number[]` and returns `null` under two points, which *looks* like honest-empty and is its opposite.
- **`CALLOUT` has a `nothing-found` renderer.** "We looked and found nothing notable" is a finding. Omitting the section is not.
- **Adopt TanStack Table v8 for the new renderer set only.** It is not installed; the bank assumed it. Sort, column visibility and export are load-bearing across the table renderers. **Do not retrofit the 28 existing hand-written tables** — they keep what they have until replaced wholesale.

### 4.3 The digest

**This is the highest-risk object in the architecture.** If the digest is thin, the prose goes generic again — the exact failure being escaped. The Quarter Brief learned this the expensive way; its rules are inherited verbatim:

- Grouped in narrative order, not schema order
- **Display strings, never raw numbers** — the model must be unable to re-derive or re-round.
  **⚠ AMENDED 2026-08-29 (stage 3): this is a MECHANISM, not a rule to remember.** `DigestFragment`'s
  leaves are all typed `string` — there is no `number` anywhere in the type, at any depth. A renderer
  that wants a figure in the digest **must format it first**, at the one point the raw number would
  otherwise survive into the model's input. N-1 stops being a discipline someone can forget at a call
  site and becomes something that does not typecheck. The generated frontend mirror carries the same
  shape, so neither repo can widen it alone
- Every field the section rendered appears in the digest, **including unchanged ones** (silence about a flat metric reads as absence)
- Absent states appear as their authored reader phrase, never as a gap

---

#### ⚠ AMENDMENT — 2026-08-30 (stage 9). **Prose carries the reasoning; sections carry the evidence.**

**Raised by the Operator against the first browser pass, and the error is the Operator's own — stated
as such in the brief.** §4.3 asked for "2–4 connective sentences". It was built as **structure
*instead of* prose**, and the browser shows exactly what that produces:

> *"Across the 84% of your book we can read, it comes out fragile."* — then a table.

Nothing says why it is fragile, what fragile means here, or which holdings drag it. The reader is
handed a verdict and a grid and left to join them up. That is not a terse answer; it is an unfinished
one, and terseness was never the goal — **the goal was that every claim be checkable against a
component, not that claims be replaced by components.**

**★ THE RULE, AS AMENDED:**

> **Prose carries the reasoning. Sections carry the evidence. They interleave.**
>
> A section is **not** a caption with a component under it. Text *before* a section frames what is
> coming and why it follows from the last. Text *after* it says what it showed and why that matters.

**What this changes in the contract.** `AnswerProse` gains `after: Record<string, string>`, keyed
exactly as `leads` is. Both are optional per section, deliberately: a component that speaks for
itself needs no epilogue, and a paragraph under every card is padding rather than reasoning. The
planner's `BlockSpec` gains the same optional field and its prompt asks for it.

**★ N-1 IS UNTOUCHED, AND THIS IS THE LINE THAT DOES NOT MOVE.** Every figure still comes from the
digest; the model still emits no number. What changed is **how much the model is asked to say about
figures it may not restate** — not whether it may restate them. Concretely: `after` prose is run
through `prosePasses` in `admitPlan` alongside `lead`, `opening` and `close`, so the new surface is
covered by the same guardrail as every existing one. A plan whose epilogue invents a figure is
rejected whole, exactly as before.

#### 4.3.1 Where the answer continues — `links` (stage 12)

An answer ended in prose and stopped. The reader was told what we found and left to go and find the
page holding the working — which they first have to know exists. Vytal ships a stock page with eight
tabs and ~40 anchored sections, a health hub, a comparison surface, peer groups, a portfolio, a
watchlist, a results calendar and a screener, and an answer about a company pointed at none of them.

**What this changes in the contract.** `AnswerProse` gains `links?: readonly ProseLink[]` —
`{ label, href, why }`, at most three, rendered after the `close` as the answer's last step. Optional
and absent on every row written before stage 12, so a replayed answer that predates it renders
exactly as it did.

**★ THE MODEL NEVER EMITS A URL, AND THIS IS THE SAME RULE AS §5.4's ENDPOINTS.** A model asked for
"a link to the health page" writes one: plausible, shaped like our routes, and wrong some fraction of
the time — and a dead link inside an otherwise correct answer is an invented figure by another name,
because the reader cannot tell the good ones from the bad ones without clicking. So the links are
built by **code**, from a **closed table** (`composition/vytal-routes.ts`), keyed on the **same slots
that chose the sections** and on **what the answer actually drew**, with the **resolved** symbol
substituted — never a ticker from the question text. `composeTurn` attaches them once, centrally, so
there is one place to keep the table honest rather than nine.

**⚠ IT IS A CROSS-REPO CONTRACT WITH NO RUNTIME OWNER.** See **D-7**. `verify-routes.ts` walks the
frontend's `app/` tree and asserts every emittable href resolves; the browser gate (`U7`) asserts they
reach the DOM app-relative and each carries its reason clause. Tab and section ids are query
parameters and degrade rather than 404, which is why they were chosen to degrade.

**How much prose, and where, is a judgement call** — the Operator's words. It is not a count. The
test is whether a reader who reads only the sentences, skipping every component, still gets a
complete and true answer, and whether every component is accounted for by a sentence near it.

**A second defect fell out of writing it, and it was latent.** `leads` was documented as being keyed
"so a family with two DECOMPOSITIONs can lead each one differently". It could not: two sections of the
same kind *and* renderer produce the same key, so the second silently overwrote the first and both
rendered under one sentence. No answer in the system had two of anything until the comparison grew a
second `RELATIVE:opposed-bars` at this stage. Keys may now carry `#i` (the section's index) and the
renderer resolves `KIND:renderer#i` → `KIND:renderer` → `KIND`.

### 4.5 The answer shape — the house style, applied by construction

**Added 2026-08-30, after the orientation family took seven rounds of design review.** Read back, only
one of those rounds was about orientation. The rest were rules about how EVERY answer should read:

> *"not compulsory that everything should be an artifact — the storytelling should be in wordings and
> only visuals used to tell the story more"* · *"if something is empty, just use wordings, do not show
> empty artifacts, it looks empty"* · *"no need to show thresholds and weightage"* · *"at last some
> conclusion of all data"* · *"deciding the suggestion questions should be proper"*

**Those are the product's voice, not a family's design.** Left as review feedback they would be
rediscovered 198 times and the answers would drift apart in between — the N-5 failure (two homes for
one concept) moved from data to copy. So the shape is a **builder** (`composition/answer.ts`), and a
family declares WHAT it answers while the builder decides HOW that reads.

**The shape, in order — not a parameter:**

| | |
|---|---|
| `COVERAGE` | what this is based on. Always, including when nothing is wrong (N-6) |
| opening | 1–3 sentences. A reader who stops here still has an answer |
| `[lead, block]` | one line of prose before each section, saying what it shows and why it follows |
| conclusion | the synthesis — the only place the whole answer is pulled together |
| `NEXT` | follow-ups chosen by what was actually **found**, never a fixed list |

**Four rules the builder enforces so a family cannot forget them:**

1. **Prose carries the argument; visuals carry the shape.** A chart that must be decoded before it says
   anything has moved the work, not removed it. Every block has a lead sentence.
2. **Empty means a sentence, not an empty card.** A `Block` with `section: null` is DROPPED. N-4 asks
   that absence be *stated*, never silent — a bordered box around a dash reads as a component that
   failed to load, which is a worse lie than the one N-4 was written against.
3. **Never render calibration.** Weights, thresholds and bars are facts about the MODEL, not the
   company — the same ruling D-5 applied to evidence pips, now applied to sections.
4. **Chips read the same data the sections did.** A generic strip is furniture; a chip naming what was
   actually found is the reader's next question already asked.

`SHAPE_ASSERTIONS` ships beside the builder and every family spreads it into its own `assertions`
(§5.2), so a family that breaks the house style **fails its own eval in the commit that adds it** —
not in a design review three weeks later.

**★ THE EXTENSIBILITY TEST, RUN.** `composition/families/ownership.ts` was written after the shape
settled, with no further design direction, and inherited coverage-first, prose-per-block, drop-when-
empty, the conclusion, the chips and the digest rules without restating any of them. It cost **one
file and one array entry** — zero edits to the router, the sections, the resolvers or the builder.
What a family still decides is only what is genuinely its own: which resolvers it reads, what its lead
sentences say, and when it applies.

### 4.4 Cross-repo types are generated, never authored twice

Zero cross-repo imports exist today, so seven concepts are hand-written on both sides and free to drift (`isWideTier`, `TOOL_FAMILIES`, `subjectLabelFor`, …). `PayloadFor<K>` and `DigestFragment` are the interface between the repos.

**Generated from the backend contract into the frontend, under the existing `verify:copy-fresh` gate.** `lib/metrics/generated/` and `lib/findings/generated/` already do this correctly and are the model. `lib/findings/classify.ts`, `verdicts.ts`, `evidence-shape.ts`, `boundary.ts` re-derive classification client-side — **DELETE, replaced by digest fields.**

---

## 5. Contract 3 — `Composition`

```ts
type Composition = {
  id: `${Family}.${Variant}`        // e.g. "orientation.scored"
  when: Predicate                   // slots + tier + depth + data existence
  sections: SectionSpec[]           // ORDERED — this is the flow
  examples: string[]                // trigger phrases: feed router AND eval
  assertions: Assertion[]           // same file, same commit
}

type SectionSpec = {
  kind: SectionKind
  renderer: RendererId
  resolver: ResolverId
  params: ResolverParams
  when?: Predicate                  // omit the section, don't render it empty
  depthFloor?: number               // §3.3
}
```

### 5.1 Compile-time guarantees

1. Every `resolver` names a real resolver.
2. The resolver's output type satisfies `PayloadFor<kind>`.
3. `renderer` ∈ `RENDERERS[kind]`.
4. Every reader-facing string is a registry key, not a literal.

**A broken composition fails the build. It does not fail in front of a user.** This mirrors the existing gloss discipline: *"A manifest metric with no gloss is a COMPILE ERROR, not a bare label at runtime."*

### 5.2 Examples and assertions live in the composition file

Not in a separate suite. One file carries the family, its routing examples, and its tests — so the router learns it and the eval covers it **in the same commit** that adds it. This is what makes §6.4 a real test rather than a claimed one.

---

### 5.3 ⚠ AMENDMENT — THE MODEL PLANS THE ANSWER. Hand-authored compositions do not scale.

**Raised by the Operator 2026-08-30, and it is correct.** §5 assumes a human authors one composition
file per question family. Two families in, the objection lands:

> *"these second family i can see is not proper… it should show a table of shareholding data and its
> change from last quarter, and focus on the ownership pillar of its health score if its scored and
> explaining each metric of that pillar and some findings or patterns related shareholding… **it's not
> a single pattern which can be used for every question. There should be a brain which takes these
> decisions of how much data we have for the question asked and how to properly present it.**"*

That is right on both counts. `ownership.register` WAS shallow — it showed a register and a revenue
table and never touched the ownership pillar, its metrics, or ownership findings. And a fixed template
per family cannot fit 198 question shapes: §4.5's shape is the right *voice* and the wrong *skeleton*.

**★ THE CORRECTION: THE MODEL BECOMES THE COMPOSER, NOT JUST THE ROUTER.** It decides which sections,
in what order, what is carried in prose versus a component, what it explains in its own words, the
tone, the examples, the follow-ups, and which product surfaces to point at.

**★ AND THE ONE LINE THAT DOES NOT MOVE: THE MODEL PLANS, CODE EXECUTES.**

| The model decides | Code decides |
|---|---|
| which sections, and their order | what the figures ARE |
| what is prose vs component | how they are formatted |
| what to explain, and how much | whether the data exists |
| tone, examples, follow-ups, links | that a renderer can draw it |

The model emits a **PLAN** — section kinds, renderers, and prose *intents* referencing data by name. It
never emits a value. N-1 is not a stylistic preference: it is the reason this rebuild exists. A model
that picks the numbers can pick a wrong one, and §0.1's whole finding was that the old layer read
generic *and* could not be trusted with figures. Moving the model from prose-writer to planner is a
promotion in judgement, not a relaxation of that boundary.

**What the planner is given** — small, and deliberately not the data:

1. the question and the router's slots
2. a **capability manifest**: for this subject, what do we HOLD? tier, depth, which resolvers have
   rows, which pillars scored, which findings fired, whether a filing is held. Facts about
   availability, never values.
3. the **section menu**: every `kind × renderer` that exists, and what each requires
4. the resolved `ToneDirective` (`ai/tone.ts` — consumed, never redefined, N-5)

**What comes back** is validated against the menu before anything runs: an unknown renderer, a section
whose data the manifest says is absent, or a plan with no coverage section is rejected and the
deterministic plan runs instead. §5.1's compile-time guarantees become **admission-time** guarantees —
a broken plan still cannot reach a user.

**A deterministic planner ships beside it** and runs when no provider is configured or a plan fails
admission, so the stack is provable without a model and degrades to something correct rather than to
nothing.

**What this retires:** §4.5's fixed skeleton stops being the *structure* and remains the *voice* — its
rules (prose leads, drop-when-empty, no calibration, chips from findings) become instructions in the
planner's prompt and assertions on the executed result, not a hardcoded order. §5's `Composition`
becomes one of two paths, not the only one: a hand-authored family is still permitted where a question
deserves a guaranteed shape, and everything else is planned.

## 6. The router

### 6.1 It emits slots and a scope verdict. Nothing else.

```ts
type RouterOutput = {
  scope: 'in_scope' | 'out_of_scope' | 'unresolved'
  subjects: SubjectRef[]            // resolved via resolver #1, NOT model-named
  operation: OperationSlot | 'unresolved'
  lens: LensSlot | null
  timeframe: TimeframeSlot | null
  confidence: 'high' | 'low'
}
```

No tool definitions. No data. Small fixed prompt. This is the entire model cost of a routed turn.

### 6.2 `operation: 'unresolved'` is first-class

The bank covers subject ambiguity thoroughly (DX-01…DX-04). It does not cover **operation** ambiguity — and that is now the dangerous one. If the model misfills `operation`, code produces a confident, beautifully rendered, completely wrong artifact. **The failure mode gets prettier.** Today a wrong answer at least reads as wrong.

`unresolved` routes to clarifying chips. It never routes to a guessed handler.

### 6.3 Three-way scope

| Verdict | Behaviour |
|---|---|
| `out_of_scope` | Stop. One line. No improvisation. (*"What is Justin Bieber's income"*) |
| `in_scope` + composition matches | Run it. Deterministic. |
| `in_scope` + **no composition matches** | **Generic composition** (§6.4) |

### 6.4 The generic composition — the extensibility mechanism

A subject resolved but no family matched still has data. The composer selects resolvers whose fields best fit the lens, renders their standard sections, and states plainly that this is assembled from what we hold rather than a purpose-built view.

*Worked:* **"How much does TCS spend on R&D?"** — no family. Subject resolves; lens maps to a cost line. Held → `SERIES` + `RELATIVE` + `COVERAGE`. Not held → name the missing line, render the cost structure we do hold, chip to the nearest real compositions. Either way the user gets a real answer.

**Every generic composition writes a miss-log row: raw question, extracted slots, sections chosen.** That log is what writes composition #199 — with evidence attached, not guesswork. The fallback is the discovery mechanism, not a patch.

**⚠ AS OF T-0 (2026-08-31) THAT LOG IS A TABLE.** It was `const ROWS: MissLogRow[] = []` for four
stages — in-process, dying on every restart, and read by nothing: `missLog()`, `missLogSummary()` and
`clearMissLog()` had zero call sites anywhere in `src/`. Every sequencing decision that cited this log
cited an empty set. It now writes to `composition_misses` (migration `20260831120000`), read by
`src/scripts/miss-log-report.ts` and `GET /api/v1/admin/miss-log`.

**⚠ AND THE WORKED EXAMPLE ABOVE DOES NOT REACH THIS PATH. Do not test it with that question.**
*"How much does TCS spend on R&D?"* resolves TCS, so `buildManifest` returns a manifest and
`compose.ts` **step 5 plans it** — the generic composition at step 6 is never reached, and no row is
written. Measured live at T-0, on the real model, where it was the first thing tried.

The generic branch needs, per `compose.ts`: `in_scope` · an operation that is **not** `unresolved`
(that is step 2, `clarify_operation`) · **no subject resolved** — all three registered families set
`requiresSubject` and step 5 is gated on `if (symbol)` · **no company mentioned either**, since step
3b intercepts "named a company, resolved nothing" · and not `screen`, nor a match for the universe
regex, both of which step 3g takes first. A question that reaches it live:
*"what has changed in promoter holdings this quarter"* → `in_scope · lookup · ownership`, no subject
→ `compositionId: "generic"`.

That the section's own illustration cannot exercise the section's own mechanism is worth stating
plainly: the example teaches the *shape* of a generic answer, and it is not a test fixture.

**The extensibility test, stated so it can be failed:** adding a family = one new file, zero edits to router, sections or resolvers. If a family needs a new section kind or a new resolver, that is a legitimate architecture change and must be raised, not absorbed silently.

---

### 6.5 The router is not deterministic, and the cache is what makes the system so

**⚠ MEASURED, NOT ASSUMED (stage 5a/5b, 2026-08-30).** The same 41 questions were classified twice,
four times over, on `gemini-3.5-flash-lite`:

| configuration | run-to-run agreement |
|---|---|
| temperature unset (provider default) | **24/41 · 59%** |
| `temperature: 0` | **36/41 · 88%** |
| `temperature: 0`, corrected prompt (§9.4 #3) | **33/41 · 80%** |

**`temperature: 0` is a large improvement and it is not a fix.** Greedy decoding is not
bit-reproducible on a served model — batching and expert routing move the arg-max on near-ties, and a
near-tie is exactly what an ambiguous question produces. The residual 12–20% is a property of the
model, not of the prompt: rewriting the prompt moved *which* questions flipped and did not reduce how
many.

**Why 80% is a worse defect than it sounds.** The same reader asking the same question twice receives
a composed artifact once and a clarifying question the next time, with nothing on screen to explain
the difference. That is §6.2's confident-wrong-artifact family in its least debuggable form: a
failure that cannot be reproduced cannot be diagnosed, and the reader experiences it as the product
being unreliable rather than as the product being wrong.

It also poisons every measurement taken through the router. The miss-log cannot tell a missing family
from a coin flip, and §6.4 makes that log the thing that decides what gets built next.

**Ruling.** `src/router/classification-cache.ts` keys a classification on the normalised question
text and serves it for 24 hours. **The roll of the dice happens once per question**; every later ask
gets the same slots, so the variance is bounded to first-ask, where a reader has nothing to compare
against. Proven: six asks across three spellings of one question → one model call, one entry, one
classification.

Two rules keep it honest, and both are enforced in code rather than by convention:

1. **Only `source: "model"` results are stored.** A lexical fallback is what we produce when we could
   not ask. Caching one would let a single 429 or quota denial pin a question to the under-confident
   answer for the whole TTL — turning a transient denial into a persistent regression.
2. **The key is the question, never the turn.** No user, no session, no history. Classification is a
   pure function of the sentence; a key carrying anything else would fragment the cache and leak turn
   state into a shared store.

`ROUTER_CACHE=off` bypasses it, for measuring the model rather than the system.

#### ⚠ AMENDMENT (T-0b, 2026-08-31) — THE SCOPE OF THE GUARANTEE, STATED HONESTLY

**Everything above is true within one process, and the text did not say so.** `classification-cache.ts`
is a 2,000-entry in-process `Map` with a 24-hour TTL. It is not shared, not persisted, and not
rebuilt: **every restart and every deploy re-rolls every question.** "The roll of the dice happens
once per question" is therefore "once per question *per process lifetime*", and the 24-hour TTL is an
upper bound the process rarely lives long enough to reach.

So the guarantee this section claims is real and narrower than written:

| | |
|---|---|
| Within one process | one question → one classification. Holds. Proven as described above. |
| Across a restart or deploy | **no guarantee at all.** Every cached question is re-classified on next ask, at the model's measured 80–88% reproducibility. |

**Why this matters more than the raw numbers suggest, and it is this section's own argument turned on
itself.** The symptom of a post-restart re-roll — a reader who got a composed artifact on Tuesday
getting a clarifying question on Wednesday, with nothing on screen to explain it — is *byte-identical*
to the model variance the cache was introduced to bound. §6.5 exists because "a failure that cannot be
reproduced cannot be diagnosed"; a re-roll triggered by a deploy is that failure with a cause nobody
would think to look for, because the mechanism that was supposed to have removed it is still present
and still described as removing it. The harness already knew: `src/harness/matrix.ts`'s header says
"the cache re-rolls on restart" and routes around it. This section did not.

**This is not a call for a persistent cache.** That is a separate decision with its own costs — a
shared store keyed on question text, an invalidation story for prompt changes, and a new way for one
bad classification to become permanent rather than merely durable. Recorded here so that decision is
made deliberately rather than assumed already made.

**It is now partially detectable, which it was not before.** The miss-log persists (T-0,
`composition_misses`, §6.4). A re-roll that flips a question from a composed answer into
`clarify_operation` writes a row carrying `source: "model"`, the `question_key` — the SAME normalised
key this cache uses, deliberately reused — and a timestamp. A question whose key appears as a
`clarify_operation` row shortly after a deploy, having previously composed, is a re-roll with
evidence. That is not a fix and does not claim to be one; it is the difference between a defect that
leaves a trace and one that does not.

---

## 3.7 `SubjectCoverage` is a union — §3.3 amendment, stage 6

Stage 2 split `Coverage` into `subject` and `query` because one shape could not serve one subject and
a set. Stage 6 hits the same wall one level down: **one shape cannot serve three KINDS of subject.**

The test is the same test — does every field mean something for every value?

| | `tier` | `window` | `depth.quarters` | `asOf` |
|---|---|---|---|---|
| a stock | yes | yes | yes | yes |
| a mutual fund / bond / G-sec | **no** | **no** | **no** | yes |
| the reader's own book | **no** | **no** | **no** | yes |

A caller reading `coverage.subject?.tier ?? 0` off a fund got `0` — which is not "unknown", it is the
specific claim *"a stock we hold no quarterly results for"*. Three subject kinds were about to start
making that claim.

```ts
type SubjectCoverage = StockCoverage | InstrumentCoverage | ReaderCoverage
```

- `StockCoverage` — unchanged, now tagged `kind: "stock"`.
- `InstrumentCoverage` — `instrumentType`, `asOf`, and `analytics: boolean`. **No tier and no depth**:
  a fund has no quarterly result and never will, so there is no ladder to be on.
- `ReaderCoverage` — `asOf`, `holdings`, `holdingsScored`. The second pair is what nothing else could
  express: **a book of 21 holdings of which 11 are scored is a different answer from one where 21
  are**, and that ratio is the bound on every sentence which follows it.

**Use `stockCoverage(c)`, never `c.subject?.tier`.** The helper returns `null` for a non-stock rather
than letting an optional chain hand back a plausible-looking zero. All 14 read sites were migrated;
the compiler found every one.

### The `Subject` union, and why `perspective` still exists beside it

```ts
type Subject = StockSubjectRef | InstrumentSubjectRef | ReaderSubjectRef
```

`RoutedTurn.subjects` is now the truth and `resolvedSymbols` a projection of it. Before this,
`composeTurn` read `resolvedSymbols[0]`: "compare TCS and Infosys" resolved both and answered about
TCS alone.

`perspective` is **orthogonal to `subjects`, not a replacement for them.** "How much TCS do I own" is
`perspective: "reader"` with a *stock* subject — a reader-relative question about a company, which is
a third thing and neither half. Folding the reader into `subjects` as a magic mention would make that
shape unrepresentable and put natural-language parsing ("me", "my book", "mera portfolio") where a
closed slot belongs.

**The reader subject is appended by `route()` from the request's identity, never matched from text.**
A turn with no authenticated reader cannot produce one; that is the entire guard.

---

## 5.4 The action path — rendered affordances, not model-mediated writes

**Stage 6.** Nine of the 33 chat tools were writes, and the whole propose→confirm→execute machinery
existed for one reason: the model was the only interface. It no longer is.

### The old shape

```
model calls a write tool → tool stores a proposal → model writes a confirmation sentence
→ reader types "yes" → model calls confirmPendingAction → code reads the proposal and writes
```

Five model-mediated steps, a stored intermediate state, a tool pair (`confirm`/`cancel`) whose only
job was parsing agreement, and a measured live failure where a write turn exhausted its tool-round
budget mid-recovery.

### The new shape, and the one invariant

> **NO MODEL OUTPUT EVER REACHES A WRITE.**

| step | who |
|---|---|
| classify `action` + subject **mentions** | the model — and this is its only step |
| resolve the mention to a real stock row | code |
| pick the endpoint from a closed map | code |
| build the request body from the **resolved row** | code |
| **tap** | the reader — and the tap **is** the confirmation |
| validate, derive the owner from the session, write | an ordinary authenticated endpoint |

**The blast radius of a misclassification is a rectangle nobody taps.** That is what makes the
`action` slot safe to add at all, and it is verified rather than argued: a read question forced to
`action: "watchlist_add"` renders a control and leaves the watchlist row count unchanged.

**No new write endpoints.** All three the controls call already ship and already serve the app's own
UI — `POST /api/v1/me/watchlist`, `DELETE /api/v1/me/watchlist/:stockId`,
`POST /api/v1/me/transactions`. None of them knows a model was involved, and none has a privileged
path. An endpoint built for this flow would be an endpoint validated once, by us, for one caller.

### Two renderers, and the split is the safety rule

- **`confirm-control`** — one tap. Only where the action is trivially reversible and carries **no
  fields the reader must check**. Watchlist add and remove is the whole set.
- **`prefilled-form`** — where the action carries values. "I bought 10 TCS at 3200 last Tuesday"
  yields a quantity, a price and a date; every one is an extraction, and a wrong one written on a
  single tap is a corrupted ledger the reader may not notice for months. The fields keep every
  keystroke the extraction saved and put a human between it and the database.

**Extraction is done in code, not by the model.** §6.5 measured the router at 80–88% run-to-run
reproducibility; a quantity that changes between two identical asks is worse than one that is
missing. Since every value lands in a field the reader reads before submitting, the safety guarantee
is identical either way — which makes the deterministic option strictly better. A pattern that does
not match leaves the field `null` and the reader types it.

### Ambiguity needs no special handling

An unresolved mention renders **one control per candidate**. "add HDFC to my watchlist" produces
three controls — HDFCAMC, HDFCBANK, HDFCLIFE — and the reader disambiguates and confirms in one
gesture. No clarifying turn, and no state carried between turns to go stale.

### What this retires

`chat/proposals.ts` (221 LOC) and the `confirmPendingAction` / `cancelPendingAction` pair are
**obsolete as capabilities, not merely unported**: they exist to parse agreement, and a tap is not
parsed. They die with the tree at stage 5 and nothing replaces them.

`chat/date-resolve.ts` **lives** — extracted to `src/resolve/date-phrase.ts` (§8.2 discipline; the
old path re-exports, so nothing is duplicated). The transaction form's date field is populated
through it, so the reader sees which Tuesday "last Tuesday" resolved to and can correct it before
anything is written. It never had a chat-layer dependency; it was filed with the writes because
`recordTransaction` was its only consumer.

---

## 7. Standing rulings

### 7.1 Vocabularies — five, all separate, none duplicated

GATE 0 tested *"one object under three names."* **Refuted.** Zero key overlap.

| Vocabulary | Keys | Keys off |
|---|---|---|
| Findings catalogue | 132 | finding/pattern keys |
| Metric glosses | 109 | filed line items |
| `PATTERN_FACTS` / `FINDING_FACTS` | 22 / 49 | sidecars on catalogue keys — not a registry |
| `EVIDENCE_FACTS` | 289 (113 reader) | **evidence-bag field names** — a genuinely separate namespace |
| **Concept registry** (new) | — | **product mechanism**: pillars, bands, peer-relativity, intensity, confidence register |

`evidence-facts.ts`'s *"REGISTRY 5 of 5"* is accurate as vocabulary while `REGISTRY_IDS` correctly stays at four — it indexes evidence keys, not findings. Its allow-list inversion (*a key classified nowhere renders nowhere*) is the discipline the section renderers adopt.

The **concept registry is the fifth vocabulary**, lives in `src/catalogue/`, under the same compile-error-plus-CI discipline. It is not a duplicate of any of the four.

### 7.2 Copy infrastructure is extended, never rebuilt

Compile-error presence, 19 verifiers on `npm run build`, a versioned failover the frontend reads when the endpoint is cold, both generated artefacts FRESH. Better than a greenfield design would specify.

⚠ **The frontend gloss fallback covers 38 of 109 glosses**, by design. Any section rendering a gloss outside those 38 has no failover — it fetches or shows an absent state. Not a defect; the renderer contract must know it.

### 7.3 Two orphaned gates — repaired and wired. CLOSED 2026-08-29.

The defect as originally stated:

- `verify-filing-model-facing.ts` — the **only** gate asserting the one-renderer rule for the model-facing filing channel — is wired into **no npm script**. An orphaned gate is worse than no gate: everyone believes it runs.
- ~~`verify-evidence-facts.ts` is in `verify:all` but not `verify:copy`, so it sits outside `npm run build`.~~
  **RETRACTED — this was never a defect.** See ruling 3. `verify:all` is exactly where that gate belongs,
  and its absence from `verify:copy` is the policy working, not an oversight.

**Amended 2026-08-29, on measurement.** Both gates were run as they stand before wiring. **Both failed**,
for unrelated reasons, and the wiring destination named here turned out to be wrong. Three rulings, all
now discharged:

1. **Gate 1 — `verify-filing-model-facing.ts`: fixture repair. DONE — see the invariant below.** Exit 1, one failure, in §5. Sections 1–4
   pass, including the full-universe checks (2,291 stocks render a state; 4,582 rendered blocks carry zero
   raw evidence keys; both negative controls fire). The failing assertion hardcodes a stock and a pattern:
   `/- Pattern "Sticky Divergence" \[divergence_S2_sticky_divergence\]:/` against BEL. BEL no longer fires
   that pattern — it fires `divergence_D6_quality_rolling_over`, `lens_lm3_M3` and
   `trajectory_F2_composition_shift`. The other half of the conjunction, `/evidence=\{/`, passes.
   **The invariant the gate exists to prove is satisfied; only the example is stale.**
2. **Gate 2 — `verify-evidence-facts.ts`: a registry content gap, not a gate defect. CLOSED by D-5** —
   the 25 keys are classified and §2 passes (314 classified · 121 reader · 193 withheld). ⚠ The gate is
   red again as of 2026-08-29 on **§4, not §2**: six rule-state changes on SPARC and TARC as live
   ingestion work moves the fundamentals under it. That is the gate doing its job on someone else's
   in-flight change; it is not this build's and not a vocabulary problem. Original finding: Exit 1, and §2 —
   the totality assertion — is its **only** failure. `EVIDENCE_FACTS` classifies **289** keys (§7.1); live
   data emits **314**. **25 keys are classified nowhere.** The reverse check passes — every classified key
   is live — so this is purely additive drift, 289 ⊂ 314. Under the allow-list inversion §7.1 endorses,
   *a key classified nowhere renders nowhere*: those 25 keys are being withheld invisibly, right now. At
   least two are already promised to readers by authored copy — `n-family-copy.ts:142`,
   `ownership_N7_pledge_release`, interpolates `ev.pledgeFromPct` and `ev.pledgeToPct`, both unclassified.
   The catalogue contradicts itself across two files.
   Everything else in the suite passes, including §4, its heaviest check: the filing pass re-derived over
   **2,290 stocks / 48,126 (stock, rule, period) rows**, with *every rule firing exactly as persisted* and
   *every evidence value identical byte-for-byte*. The data has not moved and the gate is not broken —
   **the registry has fallen behind the data, and nothing else is wrong.** That bounds the fix: classify
   25 keys, in one file, with no data or gate work behind it. **It is registry work, owned by whoever owns
   `src/catalogue/`** — not gate work, and not this build's.
3. ~~**Wire both into `verify:copy` once 1 and 2 pass.**~~ **RETRACTED 2026-08-29 — `verify:copy` was
   never the right destination, and the reason is a standing policy this section did not know about.**

   **`npm run build` must run without a live database.** That is enforced, not conventional:
   `scripts/verify-build-gate-hygiene.ts` §4 fails the build when any gate reachable from `verify:copy`
   imports `src/db/prisma.ts` or `src/config/env.ts` without a declared allowance in
   `ENV_OR_DB_ALLOWANCE`. Wiring `verify-filing-model-facing.ts` into `verify:copy` was attempted and
   produced exactly that, at script **1** of 26:

   ```
   4 · DB + ENV REACH — declared with a reason, reconciled both ways
        src/scripts/verify-filing-model-facing.ts
           ↳ imports src/db/prisma.ts
     ❌ every gate that imports the env module or the DB client is DECLARED, with a reason
   ❌ 1 FAILURE(S) — a build gate is reaching outside the checkout, or a promised gate never runs
   ```

   Both existing allowances rest on one narrow justification — *"a pg Pool is CONSTRUCTED but never
   connected, because the pool is lazy and this script issues no query."* Neither of these gates can
   claim it: Gate 1 grounds 95 stocks and reads 2,291 filing sections; Gate 2 re-derives 48,121 rows in
   954 seconds. **Adding an allowance was declined** — the allowance means "imports but never connects",
   and stretching it to cover a full-book scan would make every build require a database and hollow out
   the rule that catches this class.

   **The corrected ruling: DB-dependent gates go in `verify:all`, never `verify:copy`.** The precedent is
   named by the hygiene gate's own output — `verify-phs-pd-readtime.ts` was *"flagged the moment it was
   wired into `verify:copy`, which is how this was found. Runs in `npm run verify:live`."*

   **Done:** `verify-filing-model-facing.ts` is appended to `verify:live`, which `verify:all` runs.
   `verify-evidence-facts.ts` was already in `verify:all` and stays. `verify:copy` and `build` are
   **unchanged** — this section no longer proposes touching either.

All three files — both gates and `evidence-facts.ts` — were last touched **2026-08-11**. The gate's own
output reports filing writes through **2026-08-28**. They are ~17 days behind the data, which is exactly
the window the universe expansion, the data fill and the production deploy landed in.

**★ NEW INVARIANT — GATES ASSERT SHAPE, NEVER INSTANCES.** A gate that asserts a data fixture is a gate
that will fail on *data movement* rather than on *regression*, and the two are indistinguishable from the
build output. Gate 1 is the worked example: the property held, the example moved, the gate went red. An
assertion may name a shape (`- Pattern "…" […]:` followed by `evidence={`) or a universal quantifier over
the live book — both of which Gate 1 already does correctly in §§1–4. It may not name a company and a
pattern key and call that a proof. Fixture-shaped assertions are why a gate nobody runs is a gate nobody
can afford to start running.

**★ AND THE HALF THAT MATTERS MORE — A UNIVERSAL NEEDS A POPULATION CHECK AND A NEGATIVE CONTROL.**
Replacing a fixture with a universal trades a loud failure for a quiet one, and the trade is only safe if
two things are asserted alongside it:

- **The population is non-empty.** *Every* member of the empty set satisfies *every* predicate. A gate
  whose corpus query silently returns nothing passes all its universals and prints green — the orphaned
  gate failure arriving through the front door, with a tick beside it. So the corpus size is a check in
  its own right, never a log line. Gate 1's §5 now asserts `95 scored stocks · 363 score-channel rows`
  before asserting anything *about* them.
- **The matcher bites.** A universal over a predicate that has been broken to match everything is
  indistinguishable from a universal that holds. Each shape assertion carries a negative control that
  feeds it a row it MUST reject.

Gate 1's §5 was repaired this way rather than by re-pointing the assertion: the two BEL-fixture checks
became four universals over the whole scored book, folded into the loop §5 already ran — **so the
stronger proof costs zero additional queries.** The ordering check one line below the failing one was
the same fixture class and was universalised with it; repairing one and leaving its twin in place is not
a stopping point. §5 now names no company at all. The only surviving `Sticky Divergence` literal in the
file is the synthetic string inside a negative control, which is the correct use of a fixture: as input
to a matcher under test, never as an expectation about live data.

**⚠ SECOND-ORDER FINDING — WIRING IS WORTH LESS THAN IT LOOKS.** `verify-evidence-facts.ts` is *already*
wired, via `verify:evidence-facts` in `verify:all`. It has been failing, and nothing has acted on it —
which means `verify:all` is not being run, and therefore **every gate in that chain is effectively orphaned
regardless of its wiring**. `verify:copy` runs on `npm run build` and is the only chain with a forcing
function behind it. Moving a gate into a chain nobody runs is not fixing an orphaned gate; it is renaming
one. This is the reason ruling 3 targets `verify:copy` specifically and not `verify:all`.

### 7.4 Technicals — KEEP

`lib/indicators/` + `technical.tsx` cannot be deleted cheaply. Blast radius: `price-chart.tsx` (→ watchlist quick-look, a non-technical surface), the orphaned `usePeerComparison` and its live backend route, the tab mirrored across skeleton/palette/where-next, and — worst — the backend chat deep-link vocabulary (`links.ts:67`, `context-layer.ts:230`, `verify-pages-live-chat.ts:174`) that teaches the model to emit `{{link:stock:TICKER:technical}}`. A frontend-only deletion silently ships a model linking to a dead tab.

**Ruling:** technicals stay. The bank's *"technicals dropped permanently"* line is amended to: **the chat may link to the technical tab and must never describe or interpret what is on it** (N-7). Enforced as a routing rule.

Genuinely dead, safe to remove: frontend `core.ts` and `volatility.ts` — the latter duplicating a quantity the backend already computes and scores as D1.

### 7.5 Deferred to the scoring seat — not this build

- **Pledge ingest.** `xbrl-parser.ts:349-353` coalesces absent pledge to zero. Live: 6,178 rows, **0 NULL, 89.3% zero**. The read-layer null branch is dead; `notEvaluable("pledging_not_disclosed")` is unreachable in R1 and N7; the authored reader phrase can never be emitted. Some unknown fraction of that 89.3% is undisclosed and is currently scoring as clean — **absence rewarded, universe-wide, latent in 95 live scores.** Recoverable only by re-parsing source XBRL.
  **New invariant proposed to the scoring seat:** *ingest records what the filing said, including that it said nothing; interpretation happens at read time.*
- **Five guardrail signatures have never fired** (A-1, A-4, B-2, B-3, C-2). A-3 is 86% of 132 events. An unfired signature is indistinguishable from a broken one — the negative-control rule applied to the guardrail itself. "11 signatures live" is not true in any useful sense.
- **`#5` zero-for-unknown** (§3.6) — blocks Attribution, fix upstream.

### 7.6 The evaluative guardrail tier may now be promotable

`EVALUATIVE` is log-only because words like *robust* and *strong* are entangled with shipped copy. Under this architecture the model's only output surface is 2–4 sentences over a digest; **all shipped copy is rendered by code and never passes the scanner.** The entanglement dissolves. Confirm empirically against the false-positive set before promoting to block — but this is a real gain, not a side effect.

---

## 8. Deletion discipline

### 8.1 Scope correction — the ledger is smaller than GATE 0 implied

`src/catalogue/` and `src/scoring/guardrail/` are **not** AI-layer. The guardrail runs *inside* `score-pass.ts`; `not-covered.ts` feeds `findings/persist.ts`. **Both trees are KEEP wholesale**; this build consumes them the way scoring does.

Deletable surface = `src/ai/` (**15** files, re-measured 2026-08-29) + `src/chat/` (**48**) + the 5 surface files GATE 0 correctly added (`chat-controller.ts`, `me-chat-routes.ts`, 3 job handlers). 68 files, 16,816 LOC, 369 exports.

**Recompose the ledger at module granularity.** 199 of the 255 UNCLEAR are over-exports whose fate follows their file — a `grep` after the file is decided, not 199 decisions. The genuine open question is ~56.

**The real number is PORT 363, not DELETE 20.** This is a replacement of the composition and rendering layer with adaptation of nearly everything beneath it. The "tearing out the AI layer" framing is wrong and should not be used.

**The ledger is recomposed and closed. See `docs/LEDGER_STAGE0.md`** (2026-08-29): DELETE 49 · PORT 15 · EXTRACT 3 · KEEP 1, over 68 files. The module-granularity prediction holds and then some — 345 of 372 exports (93%) are decided by their file, and the ~56 genuine open questions collapse to **one**, since resolved below. Consumers were classified as **CI-gate** (in an npm script — a real consumer) versus **unwired recon script** (not a consumer); the distinction is load-bearing, and `me-chat-routes.ts` is the case that proves it — 1 production consumer, 32 unwired probe scripts.

#### 8.1a `src/ai/core/` — shared AI infrastructure, KEEP not PORT

**Scope correction to this section, 2026-08-29.** The ledger found `src/insight/quarter-brief/` — 24 files, out of scope — importing six in-scope files directly:

```
src/insight/quarter-brief/generate.ts:23:import { createGeminiAdapter } from "../../ai/adapters/gemini.js";
src/insight/quarter-brief/generate.ts:24:import { checkAndConsumeAiCall, recordAiTokens, type Actor } from "../../ai/quota.js";
src/insight/quarter-brief/generate.ts:25:import { scanUngroundedNumbers } from "../../ai/number-grounding.js";
src/insight/quarter-brief/generate.ts:26:import { scanExplanationText } from "../../ai/guardrail.js";
src/insight/quarter-brief/prompt.ts:65:import { CLOSED_WORLD_HEADER } from "../../ai/grounding.js";
src/insight/quarter-brief/prompt.ts:68:import { shortenCompanyName } from "../../chat/web/news-filter.js";
```

**The Quarter Brief is a second AI surface, not a consumer of the first.** It calls Gemini directly, accounts its own quota, and runs its own grounding and guardrail scans. This section previously filed it as downstream of chat. That was wrong.

**Ruling.** These five files are **shared AI infrastructure** — provider adapter, quota accounting, number-grounding scan, guardrail scan, and `CLOSED_WORLD_HEADER`:

| file | role |
|---|---|
| `src/ai/adapters/gemini.ts` | provider adapter |
| `src/ai/quota.ts` | quota accounting and token recording |
| `src/ai/number-grounding.ts` | ungrounded-number scan |
| `src/ai/guardrail.ts` | explanation-text guardrail scan |
| `src/ai/grounding.ts` | `CLOSED_WORLD_HEADER` |
| **`src/ai/filing-facts.ts`** | **the filing channel, rendered once for every model-facing surface** |

#### ★ CORRECTION (stage 5a, 2026-08-30): the list is **six**, not five

`src/ai/filing-facts.ts` was missing and cannot be left out, for two independent reasons:

1. **`ai/grounding.ts` imports it** (`grounding.ts:21`). Grounding is already in this set, so
   filing-facts travels to `src/ai/core/` whether or not it is listed — listing it makes the move
   deliberate rather than a compile error discovered during it.
2. **It has an npm-wired consumer of its own** — `verify-filing-model-facing.ts:41`
   (`verify:live`), which §9.3 previously did not name either.

Its own header states the reason it exists: three model-facing surfaces were composing the filing
block separately, in three vocabularies, with one invisible divergence between them. That is shared
AI infrastructure by the same test as the other five.

They **move to `src/ai/core/` and are KEEP, not PORT.** They serve two surfaces today and will serve three. They are not part of the composition layer and must not die with it. The ledger classified them PORT on the mechanical rule; this ruling supersedes that.

**The Quarter Brief itself stays out of scope and unchanged.** It is the working proof of the thesis. It is not touched by this build.

`src/ai/registry.ts` (the provider registry) is consumed only by `chat/engine.ts` today, but is the binding point for the adapter above; it travels with `src/ai/core/` if the new layer resolves providers through it. Not decided here.

#### 8.1b `src/jobs/handlers/quarter-brief.handler.ts` — KEEP

Reclassified from the deletable set. It is a 43-line lifecycle adapter delegating to `writeQuarterBrief` in `src/insight/quarter-brief/`, a pipeline that survives. It carries no AI-layer or chat-layer code. It was swept into the five-surface-files list when this document filed the brief as downstream of chat; per 8.1a it is not.

### 8.2 Extraction changes — the one exception to N-3

**Three** symbols sit in a doomed tree while serving production consumers outside it. All three are misfiled, not AI-layer work. Consumer lines re-measured 2026-08-29; see `docs/LEDGER_STAGE0.md` §3.3 for the full evidence.

| symbol / file | production consumers outside scope | destination |
|---|---|---|
| `probeStockRelationship` (`src/ai/insight/relationship.ts`) | **3** — `relational/reader-context.ts:21`, `relational/reader-exposure.ts:38`, `results-season/service.ts:54` | `src/relational/` |
| `src/chat/web/news-filter.ts` | **2** — `ingestions/news_and_announcements/relevance.ts:36`, `insight/quarter-brief/prompt.ts:68` | news ingest |
| `ToneLevel` + `resolveToneForUser` (`src/ai/tone.ts`) | **3** — `relational/copy.ts:15`, `relational/types.ts:15`, `relational/reader-context.ts:35` | `src/relational/` |

**Corrections to the previous text of this section:**

- **`news-filter.ts` is 2 consumers, not 4.** The earlier count included one in-scope consumer (`chat/tools/get-stock-news.ts:26`, which dies with the tree) and unwired recon scripts. The EXTRACT verdict is unaffected; the number was wrong.
- **`src/ai/tone.ts` is a third extraction candidate,** not previously listed here, and this reverses the earlier assumption that `tone.ts` travels wholesale with the chat layer. It does not. The file splits cleanly:
  - **Extract — product preference resolution, no model in the path:** `ToneLevel` (`tone.ts:36`), `resolveToneForUser` (`tone.ts:363`). A reader's tone register is a product preference the relational reader renders against.
  - **Dies with the tree — prompt text:** `NON_ADVISORY_SPINE` (`:50`), `CONVERSATIONAL_PRECISION` (`:72`), `LANGUAGE_MIRROR` (`:108`), `EXPLANATORY_DEPTH` (`:164`), `COMPANY_ANSWER_SHAPE` (`:240`). These are exactly the surface §7.6 says stops existing once all shipped copy is code-rendered.
  - Shared shape — `ToneDepth`, `ToneJargon`, `ToneDirective`, `resolveTone` (`:345`) — travels with whichever half its callers need.

`probeStockRelationship` is likewise a **partial** extraction: 1 of the file's 8 exports. `groundStockRelationship` (`relationship.ts:136`) is imported only by `chat/compose.ts:23` and `chat/tools/get-stock-relationship.ts:20` — both in scope, both die.

**Extract to the proper home first, as its own change; the tree dies when the new layer lands.** Extraction creates no parallel path because nothing is duplicated.

**⚠ WHEN. Extraction changes occur at stage 5**, in the change that removes `src/ai` and `src/chat` — **not at stage 0.** Stage 0 identifies and records them; it does not move code. Moving a symbol out of a tree that is still live, stages ahead of the tree's removal, is a parallel path in everything but name and leaves the extracted home unexercised until stage 5 anyway.

### 8.3 Baseline precondition — SATISFIED, against a recorded snapshot

This section previously read *"Freeze precondition — blocking"* and required that both repos be committed
before any DELETE executed. **That condition is now met, and the baseline it demanded exists.** There is no
frozen commit hash to name — the baseline is a **recorded measurement**, taken 2026-08-29 and reproduced
below. Later stages reference these numbers.

#### Repo snapshot

```
$ git -C Vytal-Backend  log -1 --format='%H %ci %s'
a3e51e64cb1a46fbc88a9fc314c976ec5355e1af 2026-08-29 13:59:08 +0530 Backfill done

$ git -C Vytal-Frontend log -1 --format='%H %ci %s'
d4d6d965d5f8b847026c1fe4fd7f112c8a29c9dc 2026-08-29 13:59:52 +0530 Backfill done

$ git -C Vytal-Backend  status --short | wc -l          $ git -C Vytal-Frontend status --short | wc -l
3                                                        1

$ git -C Vytal-Backend status --short                   $ git -C Vytal-Frontend status --short
 M package-lock.json                                      D cls
?? docs/Vytal_AI_Composition_Architecture_v1.md
?? tmp-q.mjs

branch, both repos: main
```

Backend HEAD was 11 days stale with 338 uncommitted paths; at the moment of the snapshot it was same-day
with **3**. The frontend had 11 modified files and an untracked component; it had **1**. None of the four
entries was source — a lockfile, this document, a stray `tmp-q.mjs`, and a deleted stray named `cls`.

**⚠ THE SNAPSHOT IS A MEASUREMENT AT A TIME, NOT A LOCK.** Within the same hour, unrelated work landed in
the backend working tree — 15 modified files under `src/ingestions/` plus new probe scripts, taking the
count from 3 to **30** (frontend 1 → 2). HEAD did not move. **Nothing in the measured scope changed:**
`src/ai/` is still 15 files / 4,650 LOC, `src/chat/` still 48 / 11,270, and no changed path touches
`src/ai/`, `src/chat/`, `src/catalogue/`, the five surface files, or `package.json`. The baseline above
stands and the ledger built on it stands.

That this could happen while the section was being written **is the finding, not an accident**: a working
tree with no lock will move under a build that assumes it is still. The mitigation is not a freeze — it is
the re-measure discipline in the ruling below. Any stage hardcoding a count re-measures it and states what
it compiled against, so a moved tree produces a mismatch rather than a silent inconsistency.

#### Deletable surface

| | prior | recorded baseline | |
|---|---|---|---|
| `src/ai/` files | 14 | **15** | moved |
| `src/chat/` files | 50 | **48** | moved |
| `src/ai/` LOC · exports | — | 4,650 · 100 | new |
| `src/chat/` LOC · exports | — | 11,270 · 257 | new |
| the 5 surface files | 5 | **5**, all present | unchanged |
| **total in scope** | — | **68 files · 16,816 LOC · 369 exports** | new |

#### Registry counts — measured by import, not by regex

```
catalogueSize() = {"stock_finding":49,"lens_face":14,"phs_finding":58,"guardrail_signature":11}
catalogueSize TOTAL = 132        REGISTRY_IDS.length = 4
PATTERN_KEYS.length = 22         PATTERN_FACTS keys = 22        FINDING_FACTS keys = 49
EVIDENCE_FACTS total = 289       reader = 113                   internal = 176
QUARTER_METRIC_GLOSSES = 66      ANNUAL_METRIC_GLOSSES = 43     GLOSS TOTAL = 109
```

**Every registry figure asserted in §7.1 holds exactly.** The three-week drift this section warned about
(catalogue 118 → 128 → 132; stock findings 35 → 45 → 49; pattern keys 18 → 22) has **stopped at the
terminal value of each series**. What moved is the file surface of `src/ai` and `src/chat`, not the
vocabularies. That is the fact that unblocks this section: the thing the freeze was protecting against is
no longer moving.

**Ruling.** DELETE may execute and a composition file may hardcode a registry count, against the recorded
baseline above. Any stage that hardcodes one re-measures it by import first and states the figure it
compiled against.

**⚠ One measured caveat, and it is not about the registries.** `EVIDENCE_FACTS` is stable at 289 but
**live data now emits 314 evidence keys — 25 are classified nowhere** (§7.3 ruling 2). The registry has not
drifted; it has fallen behind the data. A composition file that assumes evidence-key totality will be
wrong until that gap is closed.

---

## 9. Build sequence

Ordered so something ships early and each stage is independently verifiable.

| Stage | Contents | Gate |
|---|---|---|
| **0** | Record the baseline (§8.3). Recompose the ledger at module granularity (§8.1). Identify the extraction set (§8.2) — record only, do not move. **Gate wiring deferred — see exit criteria.** | **Recorded snapshot + closed ledger.** See 9.2 |
| **1** | **Resolver #1 — server-side symbol resolution.** Fuzzy match, ranked candidates, tier + `DepthProfile`. | Replaces client-side whole-universe filter. Scaling fix at 2,291 stocks. |
| **2** | `Resolved<T>`, merged `Absent` union, `Coverage` + `DepthProfile`. ~~Wrap the 25 existing resolvers.~~ **Delivered: the contract + 4 resolvers (§9.4).** | Type-level: no `?? 0`, no bare `null`, no throw-on-absence in wrapped paths |
| **3** | Section + renderer set. TanStack v8 for new tables. Generated cross-repo types under `verify:copy-fresh`. | **Perceived quality gain lands here** (§0.1) |
| **4** | Router + three-way scope + generic composition + miss-log. | `operation: unresolved` proven to reach chips, not a handler |
| **5** | **Orientation** family (O-01, O-06, XT-01). Proves the whole stack on the highest-frequency family. **`src/ai` and `src/chat` removed here; extraction changes land here (§8.2).** | Old orientation path deleted in the same change (N-3). **Two gates re-pointed — see 9.3** |
| **6** | Attribution — **after** the `#5` zero-for-unknown fix. | Waterfall cannot draw a bar for an unevaluated metric |
| **7** | Comparison · Screen · Ownership · Findings · Fundamentals | Each = one composition file + its own examples and assertions |
| **8** | **Trajectory — restored.** A8 change-point detection over 13–14 in-force periods. | Hold T-08's 20-quarter asks until depth grows |
| **9** | Meta · concept registry · zero-token paths | Zero model tokens on exact match |

### 9.2 Stage 0 — exit criteria

**Met:**

1. **Recorded baseline** (§8.3) — both repos near-clean and same-day; registry counts re-measured by
   import and matching §7.1 exactly.
2. **Ledger recomposed at module granularity and closed** — `docs/LEDGER_STAGE0.md`.
   DELETE 49 · PORT 15 · EXTRACT 3 · KEEP 1 over 68 files. The last genuine UNCLEAR is resolved by §8.1b.
3. **Extraction set identified and recorded** (§8.2) — three symbols, consumer lines pasted. **Recorded,
   not moved:** the moves happen at stage 5.
4. **Scope corrected** — §8.1a. Five files reclassified to shared AI infrastructure; the Quarter Brief
   recognised as a peer AI surface rather than a consumer.

**Deferred out of stage 0, with cause:**

5. **Gate wiring (§7.3) — BLOCKED, not skipped.** Both gates were run before wiring and **both fail**.
   Gate 1 needs a fixture repair; Gate 2 is blocked on classifying 25 evidence keys in `src/catalogue/` —
   registry work owned outside this build. Wiring happens after both pass. **Stage 0 does not close on
   this item and does not need to**; nothing downstream depends on it, and wiring a red gate into
   `npm run build` is strictly worse than leaving it unwired. Tracked as **D-5** in §10.

**Not in stage 0, by ruling:** no source file under `src/` is edited; `src/ai/core/` (§8.1a) is created at
stage 5 with the rest of the tree movement.

### 9.3 Stage 5 — the gates lose their corpus

**⚠ A dependency that is invisible until it silently passes.** Gates that are npm-wired
(`verify:live` → `verify:all`) build their test corpus **out of live chat-tool output**:

```
src/scripts/verify-number-grounding.ts:16:import { parseEventDescription, renderComponents, SUPPRESSED_TAIL_NOTE } from "../chat/tools/event-description.js";
src/scripts/verify-number-grounding.ts:21:import { getCorporateEventsTool } from "../chat/tools/get-corporate-events.js";
src/scripts/verify-number-grounding.ts:22:import { getInstrumentDetailsTool } from "../chat/tools/get-instrument-details.js";
src/scripts/verify-evaluative-tier.ts:25:import { getFindingsForSymbolsTool } from "../chat/tools/get-findings-for-symbols.js";
```

#### ★ CORRECTION (stage 5a, 2026-08-30): THERE ARE **THREE** SUCH GATES, NOT TWO — and a **fourth** dependency sits inside `npm run build`

This section said "the two gates" and named two. Re-measured by walking every script in every npm
script and grepping its imports, the true set is:

| gate | npm script | imports from the doomed trees |
|---|---|---|
| `verify-number-grounding.ts` | `verify:live` | `chat/tools/event-description`, `get-corporate-events`, `get-instrument-details`, `chat/tools/registry`, `chat/voice`, `ai/number-grounding`, `ai/tone` |
| `verify-evaluative-tier.ts` | `verify:live` | `chat/tools/get-findings-for-symbols`, `chat/tools/registry`, `chat/voice`, `ai/guardrail`, `ai/context-layer`, `ai/tone` |
| **`verify-filing-model-facing.ts`** | `verify:live` | **`ai/filing-facts`, `ai/grounding`, `chat/tools/boundary`** — **never named here before** |
| **`verify-quarter-brief-anchors.ts`** | **`verify:copy` → inside `npm run build`** | **`ai/guardrail.js:36`** |

**The fourth row is the dangerous one and it is a different failure from the other three.** The first
three lose a *corpus* and pass on nothing. `verify-quarter-brief-anchors.ts` runs inside
`npm run build`, so the `src/ai/core/` move of §8.1a **breaks the build at its import** unless that
import moves in the same change. It does not fail quietly; it fails the build, which is the better
outcome — but it is not currently written down anywhere, so it would be met as a surprise.

These files are the *only* reason any of the 33 chat tools is PORT rather than DELETE; the remaining
tool files have no consumer of any class outside `src/chat/`. **When the tools die at stage 5, the
gates lose their corpus.** A gate that iterates an empty corpus does not fail — it **passes on
nothing**, which is the orphaned-gate failure mode of §7.3 arriving by a different door and wearing a
green tick.

**Stage 5 exit criterion.** **All three** `verify:live` gates are re-pointed at the digest path — the
same 2–4-sentence surface the model now writes over — and each carries a **non-empty-corpus
assertion** that fails loudly when it has nothing to scan. None may be deleted along with the tools,
and none may be left importing a tree that no longer exists. `verify-quarter-brief-anchors.ts`'s
import is re-pointed at `src/ai/core/guardrail.js` **in the same change that creates that directory**.
This is a stage-5 deliverable, not a follow-up.

### 9.4 Stage 5a/5b corrections — what the resolver layer and the composer actually are

**⚠ Three statements elsewhere in this document described an earlier design and were still being read
as current.** Measured 2026-08-30; the fixes landed at stage 5b.

#### 1 · The resolver layer is 4 files, not 25 wrappers

§3.6 says "25 of 31 exist and are PIT-correct. Porting is a wrapper, not a rewrite," and §9's stage-2
gate says "wrap the 25 existing resolvers." Both are true about the READ SERVICES — they exist, in
`src/scoring/read/`, and they are PIT-correct. Neither is true about `src/resolve/`, which holds
**four**: `symbol`, `stock-coverage`, `pillar-decomposition`, `company-snapshot`, over `contract.ts`.

Stage 2 delivered the contract and the resolvers the first families needed. It did not wrap 25 of
anything, and reading the row as if it had is what makes the class-B gap in the stage-5a capability
map look surprising. **It is not surprising: it is the 21 unwrapped services, exactly.** The stage-2
row is struck through above rather than deleted, because the gate it states (no `?? 0`, no bare
`null`, no throw-on-absence) did hold for what shipped.

#### 2 · Hand-authored families were unreachable; the precedence was backwards

§9's stage-5 and stage-7 rows describe a build made of families. §5.3 then made the planner the
general case and demoted a family to "the exception, kept for questions that deserve a guaranteed
shape." **The code implemented neither.** `composeTurn` ran the planner at step 4 and the family loop
at step 5, and `buildManifest` returns null only for an unknown symbol — so every resolved subject
reached the planner and the family loop was unreachable. Its own comment said "there are none
registered above by default" while three were registered. The stage-5a probe measured the
consequence: **0 of 41 turns reached a family.**

**Ruling (stage 5b): the family loop runs FIRST, the planner is the fallback.** An exception that
never fires is not an exception. The three registered families are also the only answers in the
system that are deterministic end to end — no model anywhere in the path — and they cover the
highest-frequency shapes. A slot match that then fails a tier or depth floor now falls through to the
**planner** rather than to the generic path, which is strictly better: the planner reads the same
manifest and simply will not plan the blocks that subject cannot fill.

**A §5 amendment was required to make this safe, and it is raised rather than absorbed.**
`Predicate.lens` now admits `null` as a member. A turn's `lens: null` means the reader narrowed
NOTHING, and `orientation.company` is built for exactly that question — its header says so. An
omitted `lens` in a predicate reads as "any lens", so registering the family as it stood would have
had it answer "what is TCS trading at" (`orient` + `price`) with a whole-company overview: the same
lens/operation conflation that header documents fixing, arriving from the other side.

#### 3 · `lookup` was in the contract and not in the prompt

Stage 4 added `lookup` to `OperationSlot` and to `OPERATIONS`, and recorded the addition. It was
never added to `ROUTER_PROMPT`, which listed seven operations plus `unresolved`. The model therefore
could not be asked for the operation the vocabulary had gained.

It emitted `lookup` anyway on the §6.4 worked example, and `parseRouterOutput` accepted it because
the clamp validates against `OPERATIONS` rather than against the prompt — **correct behaviour
arriving by accident, from a model guessing a value it was never shown.** Fixed at stage 5b: the
prompt and the contract are generated from the same list.

---

### 9.1 What changed post-GATE-0b

**Trajectory is back in.** The data fill moved scored-stock snapshot depth from median 6 to **median 14, with zero stocks under 8** (13–14 contiguous in-force periods, FY23Q4–FY27Q1) and fundamentals to 14–34 quarters. Change-point detection with a minimum phase length is viable — thin, but real. My earlier deferral was correct on the old data and is wrong on this data.

**The shallowness did not disappear — it moved** onto the 2,182 newly-admitted unscored stocks. That is what forced `DepthProfile` into `Coverage` (§3.3).

---

## 10. Open decisions — Operator only

| # | Decision | Blocks |
|---|---|---|
| **D-1** | ~~Freeze and commit both repos~~ — **CLOSED 2026-08-29.** Recorded baseline stands in §8.3. | ~~Stage 0, all deletion~~ |
| **D-2** | `ServedPatternFacts` — widen to expose `gapFloor` / `movementFloor` / tier fields? | PT-02 condition ladder |
| **D-3** | ~~The ~56 genuine UNCLEAR files~~ — **CLOSED 2026-08-29.** File granularity reduced them to one, resolved by §8.1b. Unwired recon scripts are not consumers and die with the tree they exercise. | ~~Stage 0 ledger close~~ |
| **D-4** | Pledge ingest re-parse — scoping and priority at the scoring seat | Not this build; affects 95 live scores |
| **D-5** | **25 unclassified evidence keys** (§7.3 ruling 2) — scoping and owner at the catalogue seat. Two are already interpolated by shipped copy (`n-family-copy.ts:142`). | §7.3 gate wiring; any composition file assuming evidence-key totality |
| **D-6** | **★ TWO PILLAR HUES ARE ONE COLOUR TO A PROTANOPE — design-system seat.** Measured at stage 11 with the dataviz validator against this app's real dark surface (`#1a1a19`): `--p-mom` `#a085d8` (Momentum) ↔ `--p-found` `#5d92d8` (Foundation) separate by **ΔE 1.2 under protanopia** and **ΔE 9.0 in normal vision, against a floor of 15** — a hard fail on both. `--p-own` `#4fb6a4` also sits under the chroma floor and three of the four fall outside the lightness band for this surface.<br><br>**This is not a charting defect and was deliberately not fixed at stage 11.** These four tokens paint the health page, the dashboard, the waterfall and every pillar surface in the product; re-stepping them from a stage about charts would change surfaces nobody asked to have changed, and a palette is a design-system decision rather than one for whoever last built a component. **The affected reader cannot tell Foundation from Momentum anywhere in the product, not only in charts.**<br><br>**Relief shipped in the meantime, not a fix:** every multi-series chart carries a legend *and* direct labels, every tooltip names its series in words, and the waterfall labels each segment — so identity is never colour-alone on the surfaces stage 11 touched. Surfaces it did not touch still encode pillar identity by hue. Re-step the four hues off the same ramps and re-run `dataviz/scripts/validate_palette.js --mode dark`. | Any surface encoding pillar identity by colour; WCAG/CVD conformance for the product as a whole |<br><br>**AMENDED at stage 12.** Section cards now carry a per-KIND accent hue (`KIND_ACCENT` in `chart-kit.tsx`) drawn from these same four tokens — ANCHOR blue, SERIES gold, DECOMPOSITION violet, RELATIVE teal — so this finding now reaches one more surface than it did. It stays legal only because the accent is never the sole cue: every card carries its heading in words, so a reader who cannot separate blue from violet loses decoration and no information. It does mean the eventual re-step has one more consumer. Measured separately at stage 12 and now shipped: the price chart's benchmark series moved off `--ink3` grey onto `--p-mkt` gold, the strongest pair this palette can produce (**ΔE 22.7 protan / 23.4 tritan** against `--p-found`, PASS on every check that is not the lightness-band one).
| **D-7** | **★ THE ROUTE TABLE IS A CROSS-REPO CONTRACT WITH NO RUNTIME OWNER — stage 12.** `composition/vytal-routes.ts` names ~15 frontend pages, 8 stock-page tabs and ~40 section anchors so an answer can end by sending the reader to the surface holding the working. Nothing at runtime can tell us one of those paths is wrong: the server builds an href, the browser renders an `<a>`, and the failure appears only when a reader clicks it. `verify-routes.ts` walks the frontend's `app/` tree and asserts every emittable href resolves (11,502 hrefs across the slot space, plus negative controls) — but it can only check PATHS. A `?tab=`/`?section=` id the page no longer knows degrades silently to the top of the tab, by design. **Decision needed:** whether the section-anchor ids should become a generated artefact (like `section-types.generated.ts`) so a renamed anchor fails a build instead of quietly landing the reader in the wrong place. | Deep-link precision; anyone renaming a stock-page section id |
| **D-8** | **★ THE ACTION CONTROL READS LIVE STATE FOR TWO ACTIONS AND NOT THE OTHER SIX — stage 12.** `watchlist_add` / `watchlist_remove` now query the reader's watchlist and render "Already on your watchlist", disabled, so a replayed transcript cannot offer a change that has already happened. The other six (`transaction_record`, `alert_create`, `reminder_create`, `memory_add`, `memory_forget`, `alert_delete`) keep click-scoped state, because they are APPEND actions where "you already did this" would be a guess about intent — recording the same trade twice is legitimate. **That is a defensible line and it is not obviously the right one:** an alert on the same stock at the same threshold IS a duplicate, and the endpoint treats a reminder as idempotent on `(stockId, eventType)`. **Decision needed:** whether alert/reminder controls should read their own live state too, which means a per-action state query and a rule for what "already" means for each. | Duplicate alerts/reminders created from chat; the shape of `READS_LIVE_STATE` |

---

## 11. What this document does not decide

Renderer visual design (typography, palette, motion), the concept registry's key list, per-family section ordering beyond the worked examples in the bank, and prompt text for the router. All downstream of ratification, all Manager-scoped.
