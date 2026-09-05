# Vytal AI — Family Coverage Plan v3 (LOCKED)

**196 entries, 16 families.** Verified against post-backfill data. Supersedes v1 and v2.

Read alongside `Vytal_AI_Composition_Architecture_v1.md`; this plan sequences the work that
specification describes, and cites its sections throughout.

> **Provenance of this file.** v1 and v2 existed only in conversation. v3 was locked the same way, and
> the T-0 audit found that the mechanism everything defers to — this plan — had no durable store,
> which is the miss-log's own failure shape one level up. Written to disk at **T-0b, 2026-08-31**, as
> the locked v3 body with the five amendments of 2026-08-31 already applied inline. **T-22 and T-23
> are standing instructions against this document**; until it existed on disk no future session
> inherited them.
>
> **What this file does not contain:** the 196 entries themselves. They live in *the bank* — the
> question bank referenced throughout (`DX-01`, `T-08`, `PT-02`, …), which is not a file in this
> repository. This plan carries the per-family counts, the rulings, and the sequence. See
> *Assembly notes* at the end for exactly what could and could not be reconstructed.

---

## Ruling: Jan 2023 is Vytal's epoch

The Health Score does not exist before Jan 2023. That is a **product definition**, not a data
limitation — the way a company has an incorporation date.

Fourteen in-force score periods (FY23Q4–FY27Q1, contiguous, zero stocks under 8) is therefore the
complete history, not a shortfall. **No historical rescore.** The deeper fundamentals — 94 of 95
scored stocks hold ≥24 quarters — remain available to fundamental-series answers; they are simply not
scored, and never will be for that window.

> ⚠ **BOTH FIGURES RE-MEASURED AT PHASE 2 · BATCH 1, AND THE SECOND IS WRONG AS WRITTEN.**
> The period set is confirmed exactly — 14 keys, FY23Q4→FY27Q1, contiguous, and **no stock has a hole
> inside its own run** (94 stocks at 14, MANKIND at 13). "Zero under 8" is true and understates it: the
> floor is 13.
> The depth claim does not hold in the table the obvious query reads. Against `quarterly_results`,
> **82 of 95 hold ≥24 quarters, 13 hold fewer, and 12 of those 13 hold ZERO** — and the 12 are exactly
> the 12 scored BANKS, which file into `banking_fundamentals` and never into that table. The sentence
> is true of the 83 non-financials and structurally false of the banks. Any answer quoting depth must
> read the five-table union (`DepthProfile.quarters`), which is what `resolve/trajectory.ts` does.

## How the bank is treated — three cases, not one

The bank is a **design reference for how an answer should look**, not an authority on what exists.
When it disagrees with reality, distinguish:

| Case | Action | Example |
|---|---|---|
| Bank is wrong about the world | Correct it | DX-01 says four HDFC candidates; there are three |
| Bank is right, we have not built it | **Record the gap, do not correct** | — |
| Bank asks for something outside the product's definition | Correct it **and state the definition** | T-08's 20-quarter ask · **PT-02's threshold ladder** |

The middle row is why this is three rules and not one. A correction looks like settled fact;
correcting an unbuilt capability destroys the record that it was ever wanted.

T-08's correction must say *why* — so nobody later reads "14" as a data ceiling and proposes a
backfill.

### PT-02 — CORRECTED, case three (2026-09-02, Phase 2 · Batch 1)

**The ask.** PT-02 wants the *condition ladder*: the cut each metric was scored against, shown beside
what the company actually did, so a reader can see how far a value sat from the bar that moved it.
Delivering it means widening `ServedPatternFacts` to expose `gapFloor` / `movementFloor` — todo item
**T-4**, open since stage 3 and named as blocking eight PT entries.

**The ruling is D-2 DECLINED, so this is corrected rather than recorded as a gap.** Thresholds stay
withheld. The reader's question is *what does this mean and why does it matter*, not *what number did
it clear*: a ladder of cut-points is engineering transparency, and the explanation is the thing a
reader can act on. `ServedPatternFacts` is not widened and the ladder is not built.

⚠ **THIS IS NOT "UNBUILT", AND THE DISTINCTION IS THE WHOLE POINT OF THE MIDDLE ROW ABOVE.** The
fields exist, the numbers are real, and exposing them is a small change — which is exactly why the
reason has to be written down. Somebody reading a bare "not built" against a cheap change will propose
the change. It was declined on product grounds, not deferred on cost grounds.

**What the reader gets instead, and it is not nothing.** A · Attribution shows, per measure, what it
COST the score and what it could have accounted for — `Cost-to-Income · distress · −3.5 of 5`. That is
the distance from a perfect reading, at field grain, summing to the composite. What it does not say is
which cost-to-income ratio would have cost nothing. The answer states that limit in its own words
rather than leaving a reader to derive a threshold from bar heights: *"Each measure is scored against a
band we hold for its industry and size. What is shown here is where the company landed in that band,
not the cut-off it was measured against."*

⚠ **T-4 REMAINS OPEN FOR THE OTHER SEVEN PT ENTRIES.** D-2 declines the ladder as a READER SURFACE; it
does not settle every use of the underlying facts, and the eight PT entries T-4 named have not each
been audited against this ruling. That audit belongs to T-13.

---

## Where the 196 stand

| Family | n | Authored | Reachable | Absent |
|---|---|---|---|---|
| **O** Orientation | 8 | 6 | 2 | — |
| **C** Comparison | 7 | 1 | 5 | 1 |
| **A** Attribution | 6 | 1 | 3 | 2 |
| **R** Reader | 6 | 4 | 2 | — |
| **M** Meta | 7 | 2 | 3 | 2 |
| **T** Trajectory | 12 | 0 | 3 | 9 |
| **F** Fundamentals | 16 | 0 | 12 | 4 |
| **OA** Ownership | 15 | 1 | 10 | 4 |
| **PT** Patterns | 14 | 0 | 6 | 8 |
| **PG** Peer group | 13 | 0 | 8 | 5 |
| **SC** Screens | 14 | 0 | 9 | 5 |
| **PB** Portfolio | 14 | 3 | 7 | 4 |
| **DP** Depth/prose | 20 | 4 | 14 | 2 |
| **MT** Multi-turn | 16 | 3 | 8 | 5 |
| **DX** Failure modes | 16 | 9 | 4 | 3 |
| **XT** Extended | 12 | 2 | 7 | 3 |
| **Total** | **196** | **36** | **103** | **57** |

### ★★ STANDING RULE — what "authored" means

**A family is not authored until the LIVE classifier has been shown to reach it.**

Offline coverage is a claim about the composition layer only. The router is a separate layer with its
own failure mode, and the lexical classifier that every offline gate runs against is not the one
production uses.

⚠ **THE RULE EXISTS BECAUSE META WAS CLAIMED AUTHORED AND WAS NOT REACHABLE.** Phase 2 · Batch 2
recorded M as authored on the strength of a composition that answered every offline case. On the live
path its own headline example — "what does Foundation mean" — classified `out_of_scope` **five rolls
out of five**, and the reader asking what one of our own four pillars means was told the question was
outside what Vytal covers. Every gate was green. The composition was never the problem.

So the bar has four parts and the third is the one that was missing:
1. a composition routes it,
2. a live-Gemini assertion covers it,
3. **the live classifier has been observed reaching it — not the lexical one**, and
4. it has been seen on a healthy AND a thin subject.

### The live pass — what is PROVEN, 2026-09-03

⚠ **THE COUNTS ABOVE ARE NOT UPDATED, AND THAT IS DELIBERATE.** They are per-ENTRY and the entry
roster is not in this repository (assembly note 1). Re-deriving 196 numbers from sixteen family-level
observations would be inventing them. What follows is what the live pass actually observed, at family
granularity, against §5's bar: **a composition routes it · a live-Gemini assertion covers it · it has
been seen on a healthy AND a thin subject.**

| Family | Routes live | Live assertion | Healthy | Thin | Verdict |
|---|---|---|---|---|---|
| **PT** Patterns | `patterns.stock` | R9 | TCS ✓ | MANIPALHOS ✓ | **PROVEN** |
| **MT** Multi-turn | 3 families from one word | R13 (+ no planner fallthrough) | TCS ✓ | — | routes proven, thin arm not run |
| **XT** Extended | `orientation.company` | R9 | NBFC · life · general · bank ✓ | — | figures proven for all 5 families |
| **T** Trajectory | `trajectory.arc` | R9, R12 | TCS ✓ | — | routes proven, thin arm not run |
| **A** Attribution | `attribution.score` | R9, R12 | HDFCBANK ✓ | — | routes proven; `lookup` added this pass |
| **M** Meta | `meta.define` | — | n/a (subjectless) | n/a | **WAS UNREACHABLE LIVE — fixed this pass** |
| **DP** Depth/prose | register applies | stored-register test on a real reader | TCS ✓ | — | **PROVEN end-to-end** |
| **DX** Failure modes | window shortfall ✓ | R9 | TCS ✓ | — | shortfall proven; **repetition ladder FAILS** |
| **F · OA · PG · SC · C · O · R · PB** | unchanged from Phase 1–2 | R1–R12 | ✓ | partial | unchanged |

**Nothing is promoted to "authored" in the counts above on the strength of this pass.** Only PT meets
all four columns, and PT is one family of sixteen; moving a single family's entry counts without the
roster would make the total wrong in a way nobody could later check.

**Three claims this pass CONTRADICTED, recorded because they were made in good faith and were wrong:**

1. **M · Meta was claimed authored at Phase 2 · Batch 2.** Live, "what does Foundation mean" classifies
   `out_of_scope` **five rolls out of five**, and step 1 answered it with *"that is outside what Vytal
   covers"* — about one of our own four pillars. The family was unreachable on the path production
   uses. Fixed and re-verified live; the negative control ("what is Justin Bieber's income") still
   refuses.
2. **`verify-router-live.ts` claimed "show me undervalued stocks" classifies `out_of_scope` on the live
   model, and therefore exercises the step-1 override.** Measured 5/5 as `in_scope/screen/valuation`.
   The comment is now false and the override is NOT exercised by that row.
3. **Phase 3 wrote that "how healthy is X" leaves the operation unresolved lexically and the model is
   expected to resolve it.** It does resolve it — to `lookup/health` **4 rolls in 5** — which NO
   health-lens family claimed, so four readers in five got a planner answer. Fixed this pass.

**§6.5 router agreement, re-measured (30 rolls, `ROUTER_CACHE=off`): 96.7%**, against the 80–88%
recorded at stage 5b. The cache is therefore now far more a cost saving than a determinism guarantee —
but 96.7% is not 100%, and the single disagreement in 30 was on the plainest health question in the
product, so property assertions remain the right design for this file.

> ⚠ **THIS TABLE HAS NOT MOVED SINCE IT WAS WRITTEN, THROUGH THREE BATCHES, AND THAT IS DELIBERATE.**
> Five families now have authored compositions (F, OA, PG, T, A) and their rows still read 0 or 1,
> because **the per-entry counts cannot honestly be updated from inside this repository**: the question
> bank the row numbers describe is not a file here (see the note at the top), so "12 of 12 T entries"
> is a claim nobody in this repo can check. The **status log at the foot of this document** is the
> honest record of what was built; this table is the estimate it was planned against. Do not reconcile
> them by editing the numbers — reconcile them by bringing the bank into the repo.

**Authored** = a composition file routes it, a live-Gemini assertion covers it, and it has been seen
on both a healthy and a thin subject. Anything less is **reachable** — the planner assembles something
reasonable; nobody designed it.

The bulk of the work is reachable → authored. The machinery exists; what is missing is the
specification of a good answer.

---

## Data facts that constrain specific families

Measured, not estimated. Each one binds a family below.

- **Basis contamination 68.6%** (1,490 of 2,173 non-financials), structural: 15,930 stock-periods hold
  both standalone and consolidated for the same quarter, and consolidated-only is zero. → **binds F**
- **Pledge absence is fabricated, with proof:** 1,555 rows where `pledged_shares = 0` while
  `promoter_pledged_pct > 0` — the same filing reporting a positive pledge with zero shares. 87%
  zero-rate, 0 NULL, 25,168 rows, feeding 95 live scores. → **binds OA**
- **Depth is bimodal:** 1,391 stocks at exactly 8 quarters, 411 below 8, then a second mass of 369 at
  30–34. → **binds SC, PG**
- **Three families have zero scored coverage:** all 143 NBFCs, 6 general insurers, 5 life insurers are
  tier 1. → **binds XT and every family answer that implies scoring**
- **CASA tracks the scoring roster exactly** — 12 banks with any `casa_pct` row, and they are
  precisely the 12 scored banks. Intersection 12, zero either side. `tier1_pct` has no quarterly rows
  anywhere.
- **LTIM is a resolution failure, not missing data.** The symbol drifted to LTM and is fully healthy
  under it.
- **Findings history is sound.** Of 1,329 in-force periods, 1,230 carry pattern rows, 94 are witnessed
  honest-empties ("the rules ran, nothing fired"), 5 are genuinely unknown, and **zero** claim a fired
  count they cannot produce. The 75% superseded-row figure is version churn in the two live quarters,
  not lost history. **PT is not blocked.**

### Amendments of 2026-08-31

- **Annual depth is thinner than quarterly and binds F.** Median 2 years universe-wide; 1,644 stocks
  at exactly 2, 134 at 1, 42 with none, second mass of 369 at 8–9, nothing above 9. An F entry doing a
  multi-year series has ~425 eligible stocks against ~1,868 for its quarterly sibling — so the
  depth-floor rule applies to F, not only to SC. → **binds F**
- **`fundamentals.total_liabilities` is 1% populated** — 113 of 11,144 rows, 46 stocks, column shipped
  2026-08-29. It reads as a live balance-sheet field and is effectively empty. **Binds F**, and the
  timing is the hazard: first Phase 1 item, new column, near-empty, looks like a bug.
- **The ownership cliff binds OA.** 233 stocks have no filing at all. FY27Q1 covers 2,022 stocks,
  FY26Q4 2,017, then a cliff at FY25Q1 to 475 and ~430 for anything older. **A snapshot is available
  for ~2,020 stocks; a series for ~430.** Two different products under one family. → **binds OA**
- **`market_cap_tier_snapshot` binds SC and PG.** 504 rows, 504 stocks, single `as_of_date`
  2026-07-04. Note the trap: `SESSION-REPORT-2026-08-29.md`'s "Market-cap tier | 2,290 | 100%"
  describes a different table — reading it as this one's coverage is wrong by 4.5×.

---

## Phase 0 — Before anything else

- **T-0** **Persist the miss-log.** It is `const ROWS: MissLogRow[] = []` today — in-process, dies on
  restart, zero rows ever. §6.4 claims it decides what gets built next "with evidence attached"; there
  is no evidence. Needs a table and a migration. **Highest leverage item here**, because it is what
  makes the next version of this plan better than this one.
- **T-1** Second browser acceptance pass. Findings become harness assertions, not a list.
- **T-2** LTIM/LTM symbol drift in resolver #1 — resolve on ISIN where a symbol misses.
- **T-3** `#5` zero-for-unknown (§3.6). Blocks Attribution from being fully truthful.
- **T-4** Ruling on **D-2**: widen `ServedPatternFacts` to expose `gapFloor` / `movementFloor`. Blocks
  8 PT entries. Open since stage 3.
- **T-5** `src/ai/core/` move (§8.1a), deferred at stage 8b.
- **T-6** Build-timeout guard on DB-touching gates.

## Phase 1 — Author what readers hit most

One composition file plus examples and assertions each (§5.2), against blocks that exist. Batch two or
three.

- **T-7** **F · Fundamentals** (16). **Must state basis** — 68.6% mix standalone and consolidated; an
  answer that does not say which basis it read is unsafe.
- **T-8** **OA · Ownership** (15). Closes the T08 misroute properly: `lookup + ownership` covers four
  different answers and a slot-only predicate cannot separate them. **Pledge figures stay out** until
  the re-parse.
- **T-9** **PG · Peer group** (13). `stock_peer_groups` is empty while `score_peer_stats` holds 2,289
  rows — check which the resolver reads.
- **T-10** **SC · Screens** (14). Conditions stay code-extracted (§6.5). **Depth floors mandatory.**
- **T-11** **C · Comparison** variants (7).

## Phase 2 — Families with real work behind them

- **T-12** **T · Trajectory** (12). Change-point detection over 14 periods with a minimum phase length.
  Correct the bank's 20-quarter entries per the epoch ruling, stating why.
- **T-13** **PT · Patterns** (14). Unblocked by T-4. The witness column carries the honest-empty state;
  render it rather than treating a rowless period as a hole.
- **T-14** **A · Attribution** (6). Unblocked by T-3.
- **T-15** **M · Meta** (7). Build the concept registry as the fifth vocabulary (§7.1). Exact-match
  lookups cost zero model tokens.
  > **DONE 2026-09-03.** 14 concepts in `catalogue/concepts.ts`, `concept_` prefixed, zero overlap
  > against all four other vocabularies and against both gloss sets — proved by `verify-concepts.ts`,
  > which runs inside `npm run build`. ⚠ It is **not** in `REGISTRY_IDS`, deliberately: that list is
  > what `verify-catalogue.ts` §4 reconciles against EMITTERS, and nothing fires a concept. Adding it
  > would make a gate demand an emitter that cannot exist. `EVIDENCE_FACTS` sits in exactly the same
  > position and §7.1 already records the same reasoning.
- **T-16** **PB · Portfolio** (14).

## Phase 3 — Register, conversation, tail

- **T-17** **DP** (20) — mostly `aiLevel` register work under the amended §4.3.
- **T-18** **MT** (16) — referent routing beyond stage 9's context inheritance.
- **T-19** **XT** (12) — tier-1 answers, including the three unscored families.
- **T-20** **DX** remainder (7 of 16).
- **T-21** The opening path — `composeDiscussOpening` still uses the old engine.

## Standing

- **T-22** **Re-order from the miss-log before each phase**, once T-0 makes it real. A family with rows
  beats a family with a number. This plan is a priority estimate; the log is evidence.
- **T-23** Audit bank entries as each family is authored, using the three-case rule above.
- **T-24** Every authored family carries its examples and assertions in the same file, same commit
  (§5.2).

---

## Not this build — the scoring seat

Named so they are not lost. Each affects live scores.

- **Pledge re-parse.** Proven, not suspected. *Ingest records what the filing said, including that it
  said nothing; interpretation happens at read time.*
- **Basis contamination**, 68.6% and structural.
- **CASA**: 12 of 40 banks, exactly the scored roster. `tier1_pct` has zero quarterly rows.
- **A wedged scoring run** (running since 2026-08-26) and **a failed migration** at the head of the
  table since June.
- **89 open ingestion errors.** The 3 criticals are AMFI scheme-file shape guards (mutual funds, not
  equities); 11 of the 12 highs are `QuarterlyResult.discovery` count; `QuarterlyResult.revenue` has 9,
  all medium.
- **88 NBFCs leaking into `quarterly_results`** — a family-scoped query against either table alone
  misreports them.
- **LTM's pre-FY22 history is pro-forma**, not as-reported — back-stamped combined LTI+Mindtree figures
  (`Vytal_Guardrail_Layer_Phase1_Design.md:195`). T-2 will surface 32 quarters under LTM and the early
  ones are constructed. A provenance concern, not a resolver one. *(Amendment of 2026-08-31.)*

---

## What completion looks like

Roughly 140 of 196 authored, the rest reachable. Not 196 — some entries are stale, some describe data
that does not exist, and the tail closes from the miss-log rather than from a list.

The real measure is not the count. It is **what fraction of real questions land on an authored family
versus the planner** — authored answers are deterministic; planner answers are the model's judgement.
T-0 is what makes that measurable at all.

---

## Assembly notes — what is verbatim, what is not

Recorded so a later reader can tell this file from a reconstruction.

**Verbatim from the locked v3**, unchanged in wording: the epoch ruling · the three-case bank table ·
the 196-entry family table and the definition of *authored* · the first seven data facts · all 24
todo items across four phases and Standing · the first six scoring-seat entries · *What completion
looks like*.

**Added inline, marked**: the four data-fact amendments (under their own subheading, each carrying its
`→ binds` tag in the same form as the originals) and the LTM pro-forma entry in the scoring-seat list.

**Not reconstructed, and not guessed:**

1. **The 196 individual entries.** Only per-family counts exist in v3; the entry roster lives in the
   bank, which is not in this repository (`grep -rl` across `docs/` and `src/` finds references —
   `contract.ts:101`, this plan — and no roster). The authored/reachable/absent split is therefore
   carried at family granularity exactly as v3 carried it, and **T-23's audit cannot be performed
   against this file alone.**
2. **The identity of the entries behind the shorthand.** `T-08`, `DX-01`, `D-2`, `#5`, `PT-02` and
   `T08` (the misroute in T-8, which is a *bank entry*, distinct from the todo item `T-8`) are
   referenced by v3 without definition. Reproduced as written.
3. **Status.** The body above is the plan **as locked** and deliberately still describes T-0 in the
   future tense. What has since landed is recorded below rather than edited into the body, so the
   locked text stays the locked text.

### Batch N — N-1, N-2, N-3 (2026-09-03)

**THE CEILING, FIRST.** `ai_usage_counters` is **model-scoped** (`quota.ts:284`: "the model id IS the
counter scope"), so it is **key-blind**: it records OUR SPEND, which equals the key's remaining quota
only while the key is constant. After a rotation the two diverge — the old key's 461 was being charged
against the new one. **Today's row was reset rather than the cap raised**, because
`AI_BUDGET_FLASH_LITE = 960` frees today and then permits 960 calls against a 480-call key tomorrow
when the window resets, which is the "stale counter means no ceiling" state exactly. Ceiling 480,
`AI_MODEL` verified pinned to flash-lite (the 18-vs-480 trap), key confirmed live by one metered call.

**N-1 · `peers.versus` — and the brief's premise was wrong.** `compare-route.ts` records it in its own
header: *"PG-vs-PG is a separate later engine — NOT MOUNTED HERE."* `buildComparisonView` is stock-keyed
throughout. **There was no service to reuse.**

⚠ **AND `context-layer.ts` — part of the SYSTEM PROMPT — TELLS THE MODEL COMPARISON DOES "two stocks,
OR TWO PEER GROUPS, side by side".** `tone.ts` says that page inventory is the thing that stops the
model confabulating features, so an entry with no engine behind it is a confabulation SOURCE. N-1 makes
the line true.

⚠ **THE DEFECT IT CLOSES, MEASURED LIVE:** "compare pharma and FMCG" answered about **FMCG alone**;
"pharma vs cement" about Cement alone. `resolvePeerGroupByName` hands the whole sentence to
`matchPondName`, which returns one best match, so the second pond was dropped with nothing said —
§6.2's confident-wrong-artifact, the shape the matcher's own header warns about.

★ **REUSED:** `buildPeerGroupHealthView` per side (it already carries `scoredCount`, `pillarMedians`,
`dispersion`, `range`, and `notAtCurrentPeriod` vs `rosterNotScored` kept distinct), and `matchPondName`
run **per half** so its refusal behaviour survives. **Zero new renderers** — `RELATIVE : opposed-bars`
already draws two entities' pillars with `series: 0|1`; RELATIVE stays at 4 of 6.

★ **§4.1: it is PG's, not Comparison's.** Comparison's verdict asks "can these two fairly be compared" —
same family, same peer group. For two ponds that is EMPTY: they are different sets by construction, so
the answer is always "different" and carries nothing. The pond question is whether each side has a
readable median and whether the counts are close enough that the medians mean comparable things.
**Eighth distinct answer in eight families.**

⚠ **MEASURED BEFORE DESIGNING, AND IT CHANGED THE SHAPE.** 23 ponds · 13 with ≥2 scored · **0 with
exactly 1** · 10 with none. The ponds are **cleanly bimodal** — every scored pond is 100% scored — so
the one-scored-one-not problem does not arise INSIDE a pond, only at pond level, where the side is
omitted whole and named (C's ruling for companies). Readable for **78 of 253 pairs (31%)**, and the
answer says so. Of the 13, only **4 are nameable in one word**; 7 need two, 2 need three.

**N-2 · NOTHING TO BUILD, and the premise was wrong on every count.** The PHS pattern library is
**built**: 41 patterns across **eight** families (PA PB PC PE PQ PS PV PX — the brief lists six),
firing on **all 570** persisted snapshots across 3 users, and chat's `reader.portfolio` already renders
them through `CALLOUT : findings` with `totalAvailable` and "the N that matter most of M". 23 of 41 have
ever fired; the other 18 reflect **three test books**, not missing code.
`NOT_EVALUABLE_UNDECLARED` is **empty by design** — PQ2/PQ3 graduated when `PQ_DISPERSION_SPLIT = 15`
was declared, and the list stays as the mechanism.

★ **THE VERSION RULING: there is no disagreement — the brief read two axes as one.** The SPEC CONTENT
is base **1.0** (the doc) + the **1.1 erratum** (a blockquote in the same file) + amendments **1.1** and
**1.2** in `constants.ts`'s header; the constants are at amendment 1.2, which is what line 3 means.
`CONSTANT_VERSION = "portfolio-spec 2.1"` is a **fingerprint input**, not a spec version: both bumps
past 1.2 changed **no constant at all** (2.0 churned fingerprints so the Construction-v2 Net value
would land; 2.1 so a new ledger key would). All three versions are present in persisted rows. Build to
the spec content; bump the token only for a persisted field no fingerprint input can see.

**N-3 · `patterns.finding` — and it shares more machinery than expected.** `resolveDefinition(raw,
symbol)` ALREADY searches `STOCK_FINDINGS` by name and returns `doesntMean`; `readFindingsForSymbols`
already renders each row's own verdict. The gap was narrow: `workedExample` builds from `CONCEPTS[key]`,
which holds no finding, so a finding **with a subject** returned a definition and no company evidence.
`DefinedTermExample`'s `{ symbol, lead, rows, close }` fits that evidence exactly — **zero new
renderers**, ANCHOR untouched at its six. Three parts, D-2 intact: what it MEASURED (the verdict), what
it MEANS (the description), what it does NOT claim (`doesntMean`) — never the cut it cleared.
`resolveDefinition` was NOT extended in place: Meta serves it live.

⚠⚠ **AND THE SLOTS COULD NOT BE TRUSTED TO REACH EITHER ANSWER — THREE LIVE ROLLS, THREE DIFFERENT
FAILURES.** "why was TECHM flagged for Sticky Divergence" → `explain·health` ⇒ **attribution.score**
answered with the whole shortfall walk. "why was TCS flagged for Sticky Divergence" → `explain·events`
⇒ **planned:model**, whose prose then confabulated *"the query regarding sticky divergence refers to the
corporate events and disclosures filed"*. "compare pharma and FMCG" → `compare` with **zero subjects**
⇒ **clarify_subject**, asking which company for a question about no company. Lexically all three
stopped at clarifying chips.

★ **SO BOTH ARE REACHED ON THE SENTENCE, AT ONE SITE EACH (2d, 2e), ABOVE EVERY SUBJECT-CLARIFY
BRANCH** — the carried rule that "an operation slot is grammar". The pond check needed three
interception sites before it was moved; needing three is how the wrong placement announced itself. Both
gates are OUR OWN REGISTRIES (`searchVocabularies`, `matchPondName`), so neither can widen into a guess.
**Verified live: all three now land correctly on three different slot rolls.**

**Harness:** 63 self-test controls (+3), and the refusals are the point — a three-pond sentence is
refused rather than truncated to the first two, keeping the pairwise limit.

### Block-deal pairing — the two legs of one deal (2026-09-03)

**Reported from the product**: TCS's whole "Disclosed transactions" card was two rows with the same
fund, same day, same 1,83,328 shares, same ₹2059.60, one buy and one sell — and a header reading "2".

**The data was right.** NSE publishes block deals ONE ROW PER COUNTERPARTY, and
`block_deal_unique` puts `clientName` and `transactionType` in the key with no field linking the
sides. The rendering was doing the reader's arithmetic wrongly: ₹75.5 Cr of apparent activity where
₹37.76 Cr moved between one owner's own custodian accounts.

**Measured over all 1,230 rows before building** — 42 clean 1:1 pairs, 2 many-to-many, 1,087
single-sided. Pairs are effectively unique within a symbol+date (one case of two, at distinct
qty+price), and every different-name pair sampled by hand is an obvious counterparty (Citigroup
Singapore ← Citigroup Mauritius, Goldman ← Morgan Stanley, Bayer AG ← Bayer CropScience, Adani Infra
← Ardour, PI Opportunities ← Prazim).

⚠ **THE ROW-SHARE FIGURE UNDERSTATES IT BADLY, WHICH IS WHY THIS WAS WORTH DOING.** 6.8% of rows, but
**31 of the 165 stocks with any deal have nothing else on file**, so the pair is 100% of their card —
and they are the front page of the market: HDFCBANK, ICICIBANK, INFY, BHARTIARTL, ASIANPAINT,
AXISBANK, M&M, BAJFINANCE, HINDUNILVR, TCS.

★ **HOW STRONGLY WE CLAIM DEPENDS ON THE DEAL TYPE, AND THIS IS THE ONE RULING THAT CHANGED DURING
THE WORK.** The first proposal was "X sold to Y" for every pair. Measured, the 42 split **24 block /
18 bulk** — and a bulk row is one client's whole day AGGREGATED, so an identical aggregate on both
sides is strong evidence and not proof. Block names the counterparty and asserts the sale; bulk names
both sides and states the match without claiming they faced each other.

⚠ **SAME-OWNER DETECTION HAS A HARD CEILING AND `deal-pairs.ts` STOPS AT IT.** Stripping the trailing
account code takes it from 3 pairs to 19 and is a rule anyone can check. What it cannot do is decide
that Citigroup Singapore and Citigroup Mauritius are one owner — that is entity resolution across
corporate groups, and a wrong answer there is a claim about who owns a company. Identical after
stripping ⇒ an account transfer, stated. Anything else ⇒ both names, no relationship claimed.

★ **ONE HOME, TWO CALLERS (N-3).** `resolve/deal-pairs.ts` is consumed by the authored family
(`resolve/ownership.ts`) and by the planner (`resolve/blocks-stock.ts`); a second copy of the 1:1 rule
is the copy that would drift. **Paired BEFORE capping** — slicing first strands one leg and shows a
purchase with no counterparty. `dealsTotal` now counts DEALS, not legs, so TCS reads "1" rather than
"1 of 2", which would have said we truncated the list when we merged it.

**Eight negative controls** in the harness self-test (60 total), and the ones that matter are the
declines: many-to-many left untouched, a price mismatch not paired, a date mismatch not paired, a
single-sided deal unchanged. The reader-facing risk is not a missed pair, it is a fabricated
counterparty.

**And the badge is coloured by direction** — it took one hue for the whole rail, so a sell and a buy
were identical. Now `insider sell` → `--crit`, `block/bulk sell` → `--high`, `insider buy` → `--rec`,
`block/bulk buy` → `--p-found`, reusing the ownership tool's own tokens so the same event cannot be
red on one surface and neutral on another. A PAIRED row takes neither: it is not a buy or a sell.

### The fixes batch — F-1 … F-4 (2026-09-03)

**F-1 · The advice decline no longer keys on politeness.** `isAdviceShaped` required an ASK word
(`should`/`worth`/`recommend`) AND an act verb, so the blunter the reader got the likelier we feigned
incomprehension. Rewritten as a shape test: STRONG act verbs need no frame, WEAK ones (`hold`/`enter`/
`exit`) earn a decision word, and the ACTOR test runs first — 12 negative controls including OA's
"have INFY insiders been buying or selling", which contains two act verbs and is a register question.

⚠ **AND THE LIVE RUN FOUND A SECOND HALF THE OFFLINE RUN COULD NOT.** With the detector fixed, the
ladder still scored 3/4 live: the model classified *"buy TCS or not?"* as `operation: screen`, and the
decline was gated behind `operation === "unresolved"`. The reader asking whether to buy got a PEER
RANKING — "TCS scores 65.4 and ranks 4 of 6". The ruling was *detect the act, not the grammar*, and an
operation slot IS grammar. Gate removed; 4/4 live, with that rung still rolling `screen`.

⚠⚠ **REMOVING IT ALSO REMOVED THE RECURSION'S BASE CASE.** The branch composes orientation beneath the
decline by re-entering `composeTurn`, and it terminated only because the inner call flipped
`unresolved` to `orient` and failed the guard — a termination condition that existed by accident, and
that step 2c's header had already written down as the cause of an identical `RangeError`. Replaced with
an explicit `alreadyDeclined` flag: a base case you can see.

**F-2 · The staleness guard reads all five industry families.** It read `fundamentals` and
`quarterly_results` — the non-financial tables — so `fuNewer`/`qrNewer` were permanently false for
banks, NBFCs and insurers while `scanned` reported every snapshot. **Measured after the fix: coverage
goes 83 → 95 of 95 scored companies (banking 0 → 12).**

⚠ **AND IT FIRED ON NOTHING, WHICH CONTRADICTS THE BRIEF'S EXPECTATION.** No backlog of suppressed
staleness exists: all 12 scored banks carry snapshots from 2026-09-02 while their newest filings are
2026-08-16 to 08-24, so every filing predates its snapshot. The bug hid a detector; the condition it
detects has not occurred since the last rebuild. The guard is now armed for the next ingestion that
lands after a snapshot. **Reported read-only rather than by running the sweep**, so no
`ingestion_error` rows were created as a side effect of a verification.

**F-3 · `read_failed`, and the class made visible.** Every token in `NotEvaluableReason` was a
statement about the COMPANY's record; none could say "our read did not complete", which is why the
same defect shipped three times. Added the token (the column is `text`, not a Postgres enum — no
migration) with a phrase that is about us. Fixed at five sites: attribution's HEAD query, `blocks-stock`,
`statements`, `trajectory` and `patterns`.

⚠ **THE SWEEP FOUND 22 SITES, NOT 2.** Nineteen remain. Hand-fixing them blind in one batch is how a
regression ships, so the durable answer is `verify-swallowed-absence.ts` — in `verify:copy` and
`verify:ai-copy`, with three negative controls and an ALLOWLIST that names the remaining seven files.
A new site fails immediately; a fixed one must be removed from the list, and a second assertion fails
if the list goes stale. **The debt is now counted (19) instead of invisible.**

**F-4 · CORRECTED BY THE OPERATOR — `CALLOUT : divergence` restored and wired, not deleted.**
My verification pass reported it "drawn and emitted by nothing" and proposed deletion. Two things were
wrong with that:

1. **It was reachable all along.** `families/generic.ts` passes a non-empty `missing.map(...)`; the
   compiler said so the moment the parameter became required. It was UNREACHED BY THE CORPUS, which is
   a claim about our fixtures, not about the code.
2. **It never lost a caller — it never had one.** `calloutSection`'s own header records that before
   Phase 1 · Batch 2 *every* non-empty callout rendered as `divergence`; that batch gave each OTHER
   case a specific id and left divergence holding the residual default. The evidence is in the file.

**Wired into ORIENTATION, where the slot was a false all-clear.** That answer passed a literal `[]`, so
it always rendered `nothing-found` — digest *"Nothing notable found · Checked and clear"* — under a
lead promising "everything code checks on this company". Measured: TECHM carries an ACTIVE
`divergence_S2_sticky_divergence` and four live patterns, and the most-asked answer in the product told
the reader it was clear. **Divergence only, not the full list — PT owns that (N-3);** what an overview
uniquely cannot otherwise say is the relative statement. Consumes `readFindingsForSymbols`, matches
family C from the catalogue, and excludes `S1_aligned`, which fires when there is NO divergence.
Verified: TECHM 3 · HINDUNILVR 1 · KOTAKBANK 2 · TCS and MANIPALHOS `nothing-found`.

**And the reverse check exists regardless — `C5`.** C4 checked emitted → drawn and nothing checked
drawn → emitted. C5 does, **and it raises rather than prescribes**: an unreached renderer is either a
leftover (delete) or a capability that lost its caller (wire it), no static check can tell those apart,
and this batch is the proof — the signal was read as a cleanup item and the answer was a product one.

**N-4 · `peers_unassigned`.** `band_typical_unavailable` reads as a transient computation failure
offered for a permanent, ordinary state. **Measured: 2,143 of 2,291 stocks carry no peer group — 93.5%,
including all 11 insurers and 127 of 143 NBFCs** — so the wrong token misdescribed almost the whole
universe. Column confirmed `text`, no migration. Verified live: TCS has a group; MANIPALHOS, HDFCLIFE
and GICRE return `peers_unassigned`.

### The verification pass — what §4's hunt found (2026-09-03)

**RAISED, NOT FIXED — each is real, none is trivially safe to change unilaterally.**

**V-1 · The staleness guard is blind to four of the five industry families.** `stale-snapshot-guard.ts`
reads `prisma.fundamental` and `prisma.quarterlyResult` — the NON-FINANCIAL tables — to decide whether
a score input moved after the snapshot was taken. For a bank, NBFC or insurer both lookups return
`undefined`, so `fuNewer` and `qrNewer` are permanently `false` and the stock **can never be flagged
stale on fundamentals**. There is no comment anywhere in the file about family scope, so this is the
same narrowing as `resolveCompanySnapshot`, not a decision. **Measured: 12 of 95 scored companies (all
banks) are invisible today; 143 NBFCs and 11 insurers are latent behind it the moment they are scored.**
The guard reports `scanned = <all snapshots>`, so it looks like coverage. ⚠ NOT FIXED: adding four
`groupBy` calls is mechanically trivial, but it would open `scoring_stale` ingestion errors for real
companies the moment it ships, and firing an alerting path is the Operator's call.

**V-2 · The advice decline collapses under rephrasing — the opposite of softening.** `isAdviceShaped`
requires an ASK word (`should` · `worth` · `recommend` · `advice` · `advise`) AND an ACT word. Measured
live, a four-step ladder: *"should I buy TCS?"* declines correctly; *"come on, just tell me whether to
buy it"*, *"I really need an answer — buy TCS or not?"* and *"yes or no: buy TCS"* all lose the ASK word
and fall to `clarify_operation` — **"I am not sure what you are asking about"**, to an unmistakable
request to buy. The detector keys on politeness, so the blunter the ask the likelier we pretend not to
understand. ⚠ NOT FIXED: widening advice detection changes what the product refuses, and "buy" appears
innocently ("when did TCS buy that company"). This needs a ruling, not a regex.

**V-3 · `CALLOUT : divergence` is drawn by the client and emitted by nothing.** It is
`calloutSection`'s DEFAULT parameter and every caller passes an explicit renderer instead. The dispatch
declares 30 kind:renderer pairs; the live corpus emits 29. C4 checks emitted → drawn and **nothing
checks the reverse**, which is the shape that let the preview page rot unnoticed for two phases. Worse,
the only things that construct it are two negative-control fixtures in `verify-harness-selftest.ts`, so
any invariant guarding it looks exercised while no production path can reach it.

**V-4 · The `.catch(() => …)` → coverage-claim pattern is not confined to the one place it was fixed.**
`resolve/attribution.ts` documents this class in full at `METRICS_SQL` and answers it with a
`metricsRead` flag — but the flag guards the METRICS query only, and the HEAD query one line above
still reads `.catch(() => [] as HeadRow[])`, whose empty result becomes `absent("no_prior_snapshots")`:
a confident statement about our coverage produced by an error handler, which is exactly what the
comment says "cannot happen again". Same shape at `blocks-stock.ts:102`, where a failed
`buildFundamentalsView` becomes `absent("insufficient_quarters")` — a numeric claim about the record.
`statements.ts` handles the same case deliberately and says so, which is the pattern the other two
should follow. ⚠ NOT FIXED: each needs the read/failure split `metricsRead` models, and doing that
blind across three resolvers in a verification pass is how a regression ships.

**CHECKED AND CLEAN, recorded so the next pass does not re-hunt them:**

- **D-2's threshold decline holds.** `ServedPatternFacts` is `Pick<…, "pillarPair" | "basis" |
  "displayPrecision">` — enforced at type level. Re-verified at runtime over five real answers: no
  threshold KEY in any payload, and no distinctive floor value in any sentence or digest line. Phase 2 ·
  Batch 2's claim is confirmed. ⚠ The first version of this check matched bare `2` and `5` anywhere in a
  JSON blob and reported a leak on every answer — array indices. A check too crude to be right about a
  clean answer is not evidence about a dirty one.
- **`set-table`'s digest and payload cannot disagree about what was drawn**: the digest renders five
  rows and states `"N further rows not listed here"` when there are more.
- **The five industry tables are handled correctly** in `blocks-stock.ts`, `statements.ts`,
  `peer-metrics/compute.ts` and (since Phase 3) `company-snapshot.ts`. V-1 is the fifth occurrence.

**COULD NOT BE DONE, and why:**

- **The seven remaining PT entries could not be audited.** `PT-02` is the ONLY PT entry named anywhere
  in this repository — assembly note 1 already records that the roster lives in the bank and that
  "T-23's audit cannot be performed against this file alone". Auditing seven entries whose text does not
  exist here would mean inventing them. What IS auditable is the ruling they turn on, and D-2 was
  re-verified above.

### Status log

| Item | State | Landed |
|---|---|---|
| **T-0** Persist the miss-log | **done** — `composition_misses` (migration `20260831120000`), read by `src/scripts/miss-log-report.ts` and `GET /api/v1/admin/miss-log`; retention registered `time/365d/floor 180`, `enabled=true, armed=false` | 2026-08-31 |
| **T-0b** Plan durable · §6.5 scope · `origin` column | **done** — this file; §6.5 amendment; migration `20260831140000` adds `composition_misses.origin` | 2026-08-31 |
| **T-1** Second browser acceptance pass | with the Operator | — |
| **T-2** Symbol drift | **done** — `src/resolve/symbol-aliases.ts`, a curated ISIN-keyed registry consulted inside resolver #1's single ranking statement at 0.995. ⚠ The defect was not an empty result: `resolveSymbol("LTIM")` returned **LT (Larsen & Toubro)** and `"Mindtree"` returned **MINDTECK**. No migration | 2026-09-01 |
| **T-3** `#5` zero-for-unknown | **already closed at stage 3** — nothing to fix. Re-verified end to end; both stale comment sites and §3.6 corrected to past tense | 2026-09-01 |
| **T-4** D-2 ruling | blocked on the Operator (excluded from the batch) | — |
| **T-5** `src/ai/core/` move | **not started — blocked by this batch's own constraint.** 40 files need an import edit and 3 are `src/chat/` surfaces under T-1 test. Hazards measured and recorded below | — |
| **T-6** Build-timeout guard | **done** — root cause was `connectionTimeoutMillis` unset in `src/db/prisma.ts` (pg default 0 = wait forever). One file | 2026-09-01 |
| **T-7** **F · Fundamentals** | **authored** — `composition/families/fundamentals.ts`, one composition with a code-extracted `StatementFocus` (P&L · balance sheet · cash flow · returns) over all five industry families. New resolver `resolve/statements.ts`; new renderer `SERIES : statement-table` (§4.1 amendment — takes SERIES to 6 of 6, the ceiling). **States the basis in four places.** No migration | 2026-09-02 |
| **T-8** **OA · Ownership** | **authored** — `composition/families/ownership.ts` rewritten as FOUR answers under one lens (register · flow · dealing · pledging) separated by a code-extracted focus, closing the T08 misroute its own header recorded as unfixable by a predicate. Plus `ownership.movers`, a SUBJECTLESS variant that closes the miss-log's one genuine reader row. New resolvers `resolve/ownership.ts` and `resolve/pledge.ts`. **No pledge figure leaves the system.** No migration | 2026-09-02 |
| **T-9** **PG · Peer group** | **authored** — `composition/families/peer-group.ts` (subject-relative, ONE composition, no focus parameter) plus `peer-group-pond.ts` for the subjectless "how is the pharma peer group doing", which until now returned the whole market. New resolver `resolve/peer-group.ts`. **Zero new renderers**; `set-table` gained `highlight` and `heading`, `CALLOUT : largest-movers` was implemented from the existing closed set. No migration | 2026-09-02 |
| **T-10** **SC · Screens** | **authored** — the frame decline (SC-05 / SC-12) in `families/market.ts`, `question-shape.ts#declinedFrame`, and a narrow out-of-scope override in `compose.ts` step 1. Conditions stay code-extracted. Depth floor still not declared and still correct — see the corrected note at `resolveScreen`. No migration | 2026-09-02 |
| **T-11** **C · Comparison variants** | **authored** — `IncomparableReason` splits one sentence into three facts; the health section is now OMITTED WHOLE when a side is unscored; a third named company is stated rather than dropped. Three-way comparison RAISED NOT BUILT — the renderer holds, the resolver is pairwise to its foundations. No migration | 2026-09-02 |
| **T-12** **T · Trajectory** | **authored** — `composition/families/trajectory.ts` over a new `resolve/trajectory.ts`. Change-point detection by binary segmentation, minimum phase 3 quarters, minimum step = the narrowest published band (derived from `LABEL_BAND_MAP`, not written down). **Zero new renderers** — `SERIES : phase-shaded-spine` was DECLARED and unbuilt since stage 3 and is now implemented, so the list stays at 6 of 6. Unscored subjects draw the FILED series and say so. PT-02's epoch correction recorded above. No migration | 2026-09-02 |
| **T-14** **A · Attribution** | **authored** — `composition/families/attribution.ts` over a new `resolve/attribution.ts`, and it **REPLACES `orientation.scored`**, which claimed the same predicate. The walk runs ceiling→actual at FIELD grain for Foundation and Momentum and at PILLAR grain for Market and Ownership, which have no weighted fields to read; Σ gaps = 100 − composite is carried as `reconciles` and asserted. `#5` verified before use: closed in the read layer, and **exercised by no live row** — all 11,452 in-force metric rows are `scored`. **Zero new renderers** — `waterfall` gained `basis`/`gap`/`group`/`grain`/`band`/`ceilingShare` as parameters. No migration | 2026-09-02 |
| **T-13** **PT · Patterns** | not started — but see the PT-02 correction above, which settles one of its eight blocked entries and leaves the other seven to be audited against the same ruling | — |
| **T-13** **PT · Patterns** | **authored** — `composition/families/patterns.ts` over a new `resolve/patterns.ts`, consuming `readFindingsForSymbols` rather than re-deriving it. Both channels (score + filing) rendered separately; the WITNESS census is carried and the honest-empty is a sentence. New renderer `CALLOUT : findings` (4 of 6 → 5). **D-2 held: 27 of 49 stock findings carry `facts.thresholds` and none is rendered.** No migration | 2026-09-03 |
| **T-15** **M · Meta** | **authored** — the CONCEPT REGISTRY built as §7.1's fifth vocabulary (`catalogue/concepts.ts`, 14 entries, `concept_` prefix, zero overlap proved by `verify-concepts.ts` in the build chain). `composition/families/meta.ts` answers over ALL FIVE vocabularies through one resolver, specific-before-general. New renderer `ANCHOR : defined-term` — **this takes ANCHOR to 6 of 6 and every closable list is now closed.** Zero model tokens and zero DB reads on a subjectless lookup. No migration | 2026-09-03 |
| **T-16** **PB · Portfolio** | **partly authored** — the boundary now travels (`doesntMean` was on the object and dropped one field short of the reader; all 58 PHS entries carry one and none carries a name or description), and positions-vs-instruments reconciles on screen. ⚠ THE PHS PATTERN LIBRARY ITSELF IS NOT AUTHORED — see the batch note below | 2026-09-03 |
| **T-17** **DP · Depth and prose** | **authored** — `composition/register.ts` applies the reader's stored register to a composed answer's PROSE, once, in `withLinks`. Glossing is `level: "plain"` only and draws on the concept registry's new `inProse`/`gloss` fields; `depth: "concise"` drops the per-section epilogues and **nothing else**. ⚠ TWO EARLIER DRAFTS MADE THE ANSWER THINNER RATHER THAN SHORTER and both were caught on the verify run — see the note below. A register change never touches a section: the artefact array is passed through by identity. **`ctx.tone` reached every composition from stage 6 and no family had ever read it.** No migration | 2026-09-03 |
| **T-18** **MT · Multi-turn** | **authored** — `TurnContext.lastFamily` (§6 extension) plus a `BY_FAMILY` referent map in `applyContext`, so a bare "why" routes by WHAT IS ON SCREEN rather than falling to the planner. F and OA claim `decompose`; F reorders its opening to lead with the figures, OA answers the `flow` focus. Health-lens pattern widened for "how healthy"/"its score". **`I-DISTINCT` caught both families answering a "why" identically to a plain lookup within the hour** — the fix was a real lead, not a suppression. No migration | 2026-09-03 |
| **T-19** **XT · Extended coverage** | **authored** — `resolve/company-snapshot.ts` made family-aware (`BRANCH`/`TOP`/`SECOND` maps, `QuarterLine.topLabel`). ⚠ IT READ ONLY `fv.nonFinancial`, so the broadest question in the product — "how is X doing" — was **FIGURE-LESS for all 194 banks, NBFCs and insurers** despite real filed depth. Now: total income, net premium income, premium earned, interest earned, each named as that industry names it. A complete answer that happens not to include scoring; **no band chip, no composite, no pillar bars**. No migration | 2026-09-03 |
| **T-20** **DX · Failure modes** | **partly authored** — `composition/window-shortfall.ts` is the single home for "the resolved window is stated, always", wired into T and asserted by the new `I-WINDOW-STATED` with four negative controls. The RESOLVED half was already right everywhere; **the acknowledged half was missing** — "the last 20 quarters" returned 14 with a correct label and no sentence naming the 20. 7 of DX's 16 entries; the rest are listed as unauthored below. No migration | 2026-09-03 |
| **T-21** **The control-character gate** | **done** — `src/scripts/verify-source-control-chars.ts`, in `verify:copy` and `verify:ai-copy`. Ends a class that had recurred five times (`` → literal 0x08 through tooling). **CR is deliberately excluded, with the measurement recorded: the tree is 1,256 CRLF to 220 LF and 0 mixed**, so a separate assertion forbids MIXING instead. It caught a sixth occurrence during this batch — in `register.ts`, minutes after being written | 2026-09-03 |
| **T-22** **`app/section-preview` deleted** | **done** — the route, `lib/sections/preview/`, and `components/sections/digest-panel.tsx`. Everything with a live consumer kept | 2026-09-03 |
| **T-23** **The opening path** | **kept, and the reasoning recorded at `chat/compose.ts#composeDiscussOpening`** rather than here, because that is where the next reader will ask. It is not a competing answer path: `composeTurn` answers a QUESTION and there is no question when a reader taps Discuss on a card. Both paths share `resolveTone` and the same grounding, so no concept has two homes | 2026-09-03 |
| **T-24** | not started | — |

### Phase 3 — what the measurements said, and what is NOT authored

Re-measured before designing, as every batch has been. **Two of this batch's premises were wrong, and
one of them was a note I had written myself.**

| Premise | Measured |
|---|---|
| "the source tree is LF-only, so any CR is a defect" — my own memory note | **backwards.** 1,256 CRLF files to 220 LF, 0 mixed. The gate was rewritten around the measurement: CR excluded, MIXING forbidden |
| "`resolveCompanySnapshot` covers every industry family" | it read only `fv.nonFinancial`. **194 companies** — 143 NBFCs, 40 banks, 5 life insurers, 6 general insurers — got the broadest question in the product with no figures at all |
| "`ctx.tone` is unused plumbing" | it has reached every composition since stage 6 and **no family has ever read it**. The register layer is the first consumer |
| "a `` in a regex is safe if I am careful" | **sixth occurrence this project**, written into `register.ts` minutes after the gate that catches it. Caught by the gate, not by a person |

**Two drafts of the register made the answer thinner rather than shorter**, and both were caught on the
verify run rather than by reasoning:

1. `opening.slice(0, 1)` — "how is TCS doing" opens with three sentences; keeping the first deleted
   ₹72,275 Cr, +13.9% and 49.0% on equity, leaving a beginner an identity sentence with no figures.
2. Keeping only sentences containing a digit — dropped T's epoch sentence ("we began scoring in
   January 2023, so FY23Q4 is the earliest reading that EXISTS") and OA's "institutional holding is
   unchanged". Both carry evidence and neither carries a figure; the epoch sentence exists precisely
   to stop 14 quarters being misread as all we could find.

The rule that survives is the contract's own: §4.3 marks exactly one thing optional — the per-section
epilogue — and that is the one thing `concise` removes.

**Three findings came from the BROWSER gates, after every offline gate was already green**, which is
the argument for keeping them in the batch rather than deferring them:

1. **`verify:ux` U12 — the attribution renderer was unexercised.** The first assumption was that this
   batch's `decompose` change had stolen the question; it had not. Routing "why is INDUSINDBK scored
   the way it is" through the **model** classifier returned `operation: "explain"` three times out of
   three — an operation NO health-lens family had ever claimed — so it fell to the planner, which
   produced a creditable answer carrying none of the authored shortfall copy. The lexical classifier
   says `decompose` for the same sentence. **A family must claim the SET of operations both paths
   emit**, and no deterministic probe can see the disagreement. A and T now claim `explain`.

2. **`verify:ux` U3 — a 662px grid inside a 346px panel**, at both narrow viewports. `own-history-band`
   glued a mark's caveat onto `display`, which is the `whitespace-nowrap` right-aligned NUMBER column:
   *"+0.8 pts across the window — measured across the 12 quarters of 14 in which it could be scored"*.
   Deleting the caveat would have fixed the layout by quoting a partial-window figure under a
   whole-window label — the quiet lie it was written to prevent. `RelativeMark.note` is a separate
   field instead, rendered wrapping under the row.

3. **The register offered to persist a setting that was already persisted.** `tone` arrives from
   `loadReaderProfile`, i.e. from `user_register`, so appending "say the word and I will keep answering
   this way" told every reader with a stored preference to save what they had saved, on every answer,
   forever. `registerOffer` is kept and UNWIRED; its call site is the turn-local register, which is not
   built.

**One gate failure was NOT a defect, and is recorded so the next person does not chase it.**
`verify:ux`'s thin arm asks "how is MOLBIO doing", which reaches the **planner**, not an authored
composition. Its section count measured 9, 8, 9 and then 7 across four runs; on the 7-section run the
answer rendered before the sampler's first 250ms poll and `U1 · a section loader was actually shown`
reported UNEXERCISED. It passed on re-run. The thin arm's timing is only as stable as the planner.

**NOT AUTHORED, and named rather than left to be discovered:**

- **DX · 9 of 16 entries.** Authored: the resolved-window rule and its four controls. Not authored:
  the repetition ladder, the partial-failure composite, the mid-turn timeout, and the six entries that
  need a live model round-trip to exercise at all.
- **PT · the PHS pattern library** (carried from Batch 2, unchanged).
- **T-5** `src/ai/core/` move, still blocked by the same 40-file import edit.
- **Three-way comparison**, still raised-not-built.

**Unproven pending the live pass**, because this batch was built against the lexical path and the
deterministic planner by ruling:

- `loadReaderProfile` returning a non-default tone. `UserRegister.userId` → `User.authUserId` →
  `auth.users` is an FK chain with no throwaway reader at the end of it, so there is no signed-out way
  to read a stored register. Everything DOWNSTREAM of that read is proven: `applyRegister` was run at
  both tones over four real compositions.
- Operation classification for "how healthy is X". The lexical classifier resolves the LENS (the
  widening works) but leaves the OPERATION unresolved, so it asks back instead of answering. The model
  classifier is expected to resolve it; the ask-back is a safe fallback either way.
- The third "why" route lands on `planned:model` by design — the deterministic planner answers it
  offline, and what the model does with the same plan is a live question.
- Router run-to-run agreement (§6.5, 80–88%) is unchanged and unmeasured this batch.

### Phase 2 · Batch 2 — what the measurements said, and where they differ from this plan

Re-measured before designing. **Two of the brief's figures were wrong and one of this document's own
was already corrected in §7.3 without §7.1 being updated.**

1. **⚠ 132 CATALOGUE ENTRIES DO NOT EACH CARRY A NAME AND A DESCRIPTION.** Measured: 49 stock findings
   + 14 lens faces + 58 PHS findings + 11 guardrail signatures = 132 ✓ — but **the 58 PHS entries
   carry NO name and NO description.** They carry `doesntMean`, `job` and `lifetime`, and
   `catalogue/types.ts` already documents why. So **74 of 132 carry all three**, and `doesntMean` is
   the only field all 132 share. That is not a defect; it is the reason `EntryBase` makes the boundary
   the one universal requirement, and it is why PT and PB render the boundary rather than a description.
2. **⚠ `EVIDENCE_FACTS` IS 314 KEYS / 121 READER, NOT 289 / 113.** §7.1's table still says 289 (113
   reader); **§7.3 of the same document already records the correction** ("314 classified · 121 reader
   · 193 withheld") and §7.1 was never updated to match. The brief quoted the stale half. Metric
   glosses measured at exactly **109** (66 quarter + 43 annual) — that one is right.
3. **⚠ `portfolio-spec` IS AT 2.1 IN CODE AND 1.0 IN THE DOCUMENT.** `phs/constants.ts` declares
   `CONSTANT_VERSION = "portfolio-spec 2.1"`; `Vytal_Portfolio_Health_Score_Mechanism_and_Pattern_
   Library_v1.md` is stamped 1.0 with a 1.1 erratum inline. The brief names "the v1.1 amendment" and
   **no such file exists** — the erratum is a block inside the v1 document. Any PHS work must read the
   CODE's constants as authoritative and treat the document as one-and-a-bit versions behind.
4. **★ THE FOUR QUESTIONS THIS BATCH IS FOR WERE ALL ANSWERED BADLY, MEASURED BEFORE DESIGNING.**
   Nothing in `COMPOSITIONS` claimed `operation: "explain"` at all. "What does Foundation mean" and
   "what does Sticky Divergence mean" both composed the GENERIC family with a single `nothing-found`
   card; "what has been flagged on TCS" got a P&L table, an ownership split and a waterfall from the
   deterministic planner.
5. **⚠⚠ AND THE WORST ONE: "what does Foundation mean" RESOLVED THE SUBJECT `ARIHANT`.** The router
   hands the defined TERM to resolver #1 as a company mention, and sometimes it resolves. "What does
   Sticky Divergence mean" and "what is ROCE" both produced `subject_not_covered` — telling the reader
   we have never heard of a company they never asked about. `compose.ts` step 2c now tests whether the
   MENTION IS THE TERM (`definitionKeyFor`), which separates "what is Foundation" from "what is TCS's
   revenue" exactly and with no word lists.

### Phase 2 · Batch 1 — what the measurements said, and where they differ from this plan

Re-measured before designing. Three of this document's own figures needed correcting:

1. **⚠ THE FINDINGS WITNESS IS FOUR STATES, NOT THREE.** The plan says "1,329 in-force periods, 1,230
   carry pattern rows, 94 are witnessed honest-empties, 5 are genuinely unknown". The totals
   reconcile; the CATEGORIES do not. Measured as a 2×2 of the witness column against actual rows:
   **1,125 witnessed with rows · 93 witnessed with none (the honest empty) · 106 with ROWS AND NO
   WITNESS · 5 with neither.** The fourth state is the interesting one — rows are evidence the rules
   ran, but without the stamp we cannot say they ran completely, so it is neither a clean quarter nor
   an unknown one. T renders the 93 and the 5 and claims nothing about the 106.
2. **⚠ `findings_fired_count` DISAGREES WITH THE ROWS ON 353 OF 1,218 WITNESSED PERIODS (29%).** The
   plan says "**zero** claim a fired count they cannot produce"; measured, exactly **one** does
   (FY26Q4) and 352 carry MORE rows than the count claims — `score_red_flags` was dropped 2026-08-11
   and the count predates it. The ruling: **render the ROWS, never the count.** The witness column is
   read only for the empty/unknown distinction, which is the one thing it is reliable for.
3. **⚠ THE DEPTH CLAIM IS FALSE FOR THE 12 BANKS** — see the amendment beside the epoch above.
4. **Redistribution is rarer and more concentrated than `pillar-decomposition.ts`'s note implies.**
   That header counts 304 `score_pillars` rows; at snapshot grain it is **19 in-force periods across 6
   stocks** (`missing_pillar` 15 / `market_unavailable` 4). Only **two** stocks carry one in FY27Q1 —
   VEDL (market) and JSWENERGY (momentum) — which is why `SUBJECTS.redistributed` is VEDL and not LT:
   LT's four redistributed quarters are historical, so it exercises T's event rail and NOT A's absent
   bar, and the two look identical from a tier.
5. **The change-point method, measured over all 95 before it was wired to anything.** Minimum phase 3
   and minimum step 6 give **59 stocks one phase, 25 two, 10 three, 1 four** — the floor caps the
   count at 4 over 14 points, so no separate `MAX_PHASES` constant exists to disagree with it.
6. **★ ONE SERIES THE PHASE COUNT ALONE DESCRIBES WRONGLY, AND IT IS THE MOST EVENTFUL IN THE SET.**
   LT ranges 19.3 points and segments to ONE phase — correctly, because the moves cancel: it fell 19.3
   in a single quarter and took most of it back. `largestStep` is carried on every answer for this
   reason. LT is also the strongest argument for the change-decomposition gap raised at the foot of
   `families/attribution.ts`: its FY26Q4 fall is mostly the redistribution unwinding, and a naive
   pillar-delta waterfall would attribute it to Foundation and Market.

### Phase 1 · Batch 2 — what the measurements said, and where they differ from this plan

Re-measured before designing, and **the central PG premise in T-9 is wrong**:

1. **⚠ `stock_peer_groups` IS NOT EMPTY.** 148 rows · 148 stocks · 23 groups. T-9 says it is empty and
   asks which table the resolver reads; the whole PG design would have been built on that. Measured:
   `score_peer_stats` holds **2,106** rows (the plan says 2,289) across 13 groups × 29 metrics × 41
   as-of dates. **They are not alternatives.** One is MEMBERSHIP, the other is the scoring engine's
   per-group μ/σ/N — a roster and a calibration table. A peer answer needs the roster; §4.5 rule 3
   keeps the calibration off the screen entirely.
2. **⚠ NO PEER GROUP HAS A MIX OF SCORED AND UNSCORED MEMBERS.** 13 ponds are wholly scored, 10 are
   wholly unscored, none is mixed — so the brief's "a peer group containing unscored members" is only
   satisfiable as a *wholly* unscored pond (Large-Cap NBFCs 8/0, Specialty Chemicals 7/0, …). A
   fixture picked on the assumption that a mixed pond exists would have tested the all-scored path
   twice. `checkPeerFixtures` now asserts the three peer shapes the cases depend on.
3. **`market_cap_tier_snapshot` confirmed exactly** — 504 rows, 504 stocks, ONE `as_of_date`
   (2026-07-04), and **all 148 peer-grouped stocks sit inside it**. Every pond is `Large-Cap <sector>`,
   so membership is that frozen month crossed with a sector, and every PG answer now says so.
4. **The scored universe's depth floor note has gone stale.** `resolveScreen` says "every one holding
   ≥24 quarters"; measured, the range is 14–34 with a mean of 32 and **one** member below 24. The
   ruling is unchanged (no floor would bite) and the note is corrected, because a load-bearing note
   that has quietly gone stale is how a floor gets skipped on the day it starts mattering.
5. **⚠ "what are the best stocks to buy" CLASSIFIES `out_of_scope`.** So the reader was told "that is
   outside what Vytal covers — we read Indian listed companies' financials", which is false about that
   question. A refusal that misdescribes our own coverage is worse than a frame decline.

### Phase 1 · Batch 1 — what the measurements said, and where they differ from this plan

Re-measured before designing. Confirmed exactly: the 1,555 fabricated-pledge rows · 87.2% pledge
zero-rate with 0 NULL · 233 stocks with no filing · `fundamentals.total_liabilities` at 113/11,144
(1.01%, 46 stocks) · 425 stocks at ≥5 annual years against 1,868 at ≥8 quarters. Within rounding:
15,932 stock-periods hold both bases (plan: 15,930); 87 NBFCs leak into `quarterly_results` (plan: 88).

Four things this plan should carry forward differently:

1. **The annual/quarterly depth figures are the FIVE-TABLE UNION, not `fundamentals` alone.** Against
   `fundamentals` and `quarterly_results` by themselves the same queries give 353 and 1,781. Not a
   correction — a denominator worth stating, because the next person to check will use one table.
2. **⚠ "~430 have deep [ownership] history" is the PRE-CLIFF tail, not the series universe.** 459
   stocks hold a filing older than FY25Q1. But **1,481 hold eight or more filings and 1,940 hold four
   or more** — so a stepped series is available for ~1,900 companies, not ~430. Designing the flow
   answer to 430 would have withheld a series from about fifteen hundred stocks that support one.
3. **⚠ `total_liabilities` IS NOT ONE COLUMN.** `fundamentals.total_liabilities` is 1% populated and
   the non-financial read model does not expose it at all — so it cannot be reached even deliberately.
   **`nbfc_fundamentals.total_liabilities` is 504 of 874 rows (58%) and IS exposed.** Anyone who reads
   the 1% figure and then sees a working liabilities total on an NBFC will conclude the measurement
   was wrong. It is not; they are two tables sharing a column name.
4. **★ THE PLEDGE RULING IS UNDERSTATED BY THIS PLAN, AND THE NEW MEASUREMENT IS THE ONE THAT SETTLES
   IT.** Fabricated absence was the known defect. Of the 3,205 rows where BOTH pledge columns are
   positive, only **891 (28%) agree within half a point** and **2,007 (63%) are more than five points
   apart** (worst gap 183pp; ASHOKLEY 51.37% by share count against 59.03% by the pct column). Under
   *neither* unit reading do 2,089 of the 3,205 reconcile. So there is no defensible pledge magnitude
   in either direction — not merely an unreliable zero. The scoring seat's pledge re-parse is
   correspondingly larger than "fix the zeros".

### T-5 · measured hazards, for whoever picks it up

Blocked, not skipped: 40 files import the six §8.1a files and three are `src/chat/compose.ts`,
`src/chat/engine.ts`, `src/chat/profile.ts` — the surfaces T-1 is testing. Importer counts:
`guardrail.ts` 20 · `quota.ts` 17 · `grounding.ts` 6 · `number-grounding.ts` 4 · `adapters/gemini.ts` 2
· `filing-facts.ts` 1 (`registry.ts` 3, undecided by §8.1a). 30 of the 40 are under `src/scripts/`.

Three hazards, all confirmed present:

1. `src/scripts/verify-quarter-brief-anchors.ts:36` imports `../ai/guardrail.js` and runs **inside
   `npm run build`** (`verify:copy`). The import must move in the same change or the build breaks.
2. `src/scripts/verify-grounding-names.ts:61` reads the literal path `"src/ai/grounding.ts"`, and
   `src/scripts/verify-filing-model-facing.ts:82` reads `"src/ai/grounding.ts"` from a path list. An
   import-graph analysis will not see either. **Both were repointed at stage 8b and both are still
   pointed at the old path.**
3. Good news, and it is in those files' own headers: a source scan whose path no longer exists
   **crashes rather than passing quietly**. So hazard 2 fails loudly during the move, not silently
   after it.

⚠ A re-export shim at the old paths would let the move land without touching the three chat files.
**Do not.** It leaves 40 importers pointed at a location §8.1a says must not survive, and it would
make `verify-grounding-names` read a shim with no content to check — an orphaned gate manufactured by
the workaround, which is the exact failure class this build keeps removing.

Two spec amendments were made in the same work and are recorded in
`Vytal_AI_Composition_Architecture_v1.md`, not here: **§6.4** now states that the miss-log is a table
and that §6.4's own worked example (*"How much does TCS spend on R&D?"*) does **not** reach the generic
branch it illustrates; **§6.5** now states that the classification cache's determinism guarantee holds
only within a process, and that every restart re-rolls every question.
