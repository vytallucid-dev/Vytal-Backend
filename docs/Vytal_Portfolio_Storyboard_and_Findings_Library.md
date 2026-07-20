# Vytal — Portfolio Storyboard & Findings Library

**Version stamp:** `portfolio-findings 2.0` · **reconciled through Stage 10b** (the doc-2 reconciliation pass).
**Binds to:** `portfolio-spec 2.0` (Structure Score v2 Mechanism Spec). Every value referenced here is computed and persisted by that spec. **This document computes nothing new.**
**Audience:** the architecture chat builds §§3–11. The UI chat builds the **storyboard** (§2 — four movements + a reference layer) from the stored snapshot.

> ## ⚠ THE RULE THIS DOCUMENT IS HELD TO — read it before trusting any citation below.
>
> **A citation to specific lines that do not contain what is claimed is WORSE than an uncited assertion —
> it invites verification and defeats it.** The checker finds the lines, skims, assumes they misread, and
> moves on. Across the reconciliation passes **fourteen premises did not survive a grep or a measurement**:
> a fabricated `engine.ts:207-223`, a phantom `phs/catalog.ts`, a phantom `phs/dampen.ts`, a `LENS_NATURE`
> cited 277 lines from where it lives, `PB3`'s difference that fired on everyone, `PI2`'s 5,051 that was
> 3,955, `PI1`'s gate that selected for stale prices, a `PD1` Read promising three facts we hold one of.
>
> So this pass **cites symbols, not line numbers.** A line number in a living file is a drift generator —
> it was right the day it was written and wrong by the next commit, and its wrongness reads as authority.
> A symbol (`PfFinding`, `LENS_NATURE`, `resolveTwins`) survives every edit that does not delete it. **Every
> citation here has been checked against the code, or removed. A doc that cites nothing is honest; a doc
> that cites wrongly is not.**

---

## ▶ SECTION 0 — MESSAGE TO BOTH CHATS

**What this is.** The Construction score is one number standing on six rules. The Health score is one number over the slice we can see. **Both collapses hide true facts.** This is the closed catalog of the facts they hide, plus the narrative order in which a user meets them.

**The relationship to doc 1.** Doc 1 computes the snapshot. Doc 2 reads it and fires findings from it. **Both are computed once, at snapshot time, and stored on the snapshot.** Every surface — Overview, Health tab, Dashboard — is a read-only consumer. No surface re-runs anything. Same compute-once law the stock engine already lives by.

**The three homes, restated because this is where they blur:**
- **Construction** — weight arithmetic. Deducts.
- **Health** — the stock engine's read. Deducts.
- **Findings & disclosures** — everything else. **Never deducts from anything.**

**Unscored ≠ quiet.** A finding contributes zero to any number and can still be the loudest thing on the screen. An ETF at a 15% premium dominates the page while touching no score. Prominence is the finding engine's lever; arithmetic is the rule engine's. **We deliberately do not fuse them.**

**Why instrument facts never deduct — the reason that decides it.** Our stock red flags deduct because the engine has a baseline to weigh them against: thresholds derived from survivor/distress distributions. **Fund flags have no baseline.** A 42% drawdown is normal for a small-cap fund and catastrophic for a liquid fund. Severity is uncallable. The only baseline funds have is *category rank* — which is a returns ranking. Deduct on that and we have built a star rating. That is the thing we exist not to be.

The asymmetry is honest and sayable: **"We deduct for a stock's red flag because we score the business. We don't score funds, so we tell you what's true about them and let you read it."**

**One boundary that looks like a contradiction and isn't.** Doc 1 §0 says *never use `mf_analytics`*. That ban is on the **score**. Findings **may** use price, NAV, drawdown, volatility, tracking error. *"This fund fell 42% peak-to-trough over three years"* is a true, non-predictive fact with a Read and a Doesn't-mean. The moment it enters a number we are claiming a verdict; as a finding we are stating a fact. **Findings may use returns. Scores may not.**

---

## ▶ SECTION 1 — THE INVIOLABLE RULE

> **A finding describes what the book IS. It never says what to DO, and never says what will happen NEXT.**

The instant a finding says *"so trim,"* *"consider rebalancing,"* *"reduce exposure,"* *"switch to Direct,"* *"this will hurt returns"* — it has become advice or prediction, broken the platform's spine, and does not belong here.

- ✅ *"38% of your capital sits in a single company — the read leans heavily on that one name."*
- ❌ *"38% is too concentrated — consider trimming."*
- ✅ *"This is the Regular plan. The Direct plan of this same fund exists; Direct plans carry lower expense ratios."*
- ❌ *"Switch to Direct to save on fees."*

The Read states the structural fact and, at most, **how to read the number in light of it** — never an instruction.

**Three sub-locks:**

1. **Field-verdicts never penalize and never become negative findings.** LM3/LM4/LP2/LP3 ("the *field* is weak/elite") are facts about a peer group. They may appear **only** as explicitly-neutral environmental context (PX5). Never Caution, never Concern.
2. **Asset mix is described, never judged.** There is no correct equity/debt ratio without knowing someone's goals. PA1 states the mix. Nothing evaluates it.
3. **Never juxtapose health against returns.** The Performance tab stays health-free. No finding places a Health value beside an XIRR.

**The one test.** A candidate finding qualifies only if:

> It names a true fact the collapse hid, is a **pure function of values the engine already computed**, makes the user a sharper reader of their own book, shows its reasoning, and says nothing about what to do or what happens next.

---

## ▶ SECTION 2 — THE STORYBOARD (UI chat)

> **⚠ §2 WAS SIX PANELS. IT IS NOW FOUR MOVEMENTS PLUS A REFERENCE LAYER** — the addendum
> (`ADDENDUM_storyboard_narrative_composition.md`) supersedes the panel spine, and the composer that
> builds it shipped at Stage 10b (`src/portfolio/phs/story.ts`; ODL `cv2-s10b-story-zero-homes`,
> `cv2-s10b-select-not-suppress`). **The old six-panel table is deleted, not archived** — a form *lists*;
> a story *connects*. One panel was worse than merely formal: *"The facts nobody gives you"* presented
> **our own data limitation as a gift** (*"your Nifty Bank ETF gives you exposure our sector reading can't
> see"*), which is the self-flattery this platform exists not to do. The catalog below survives intact; it
> stopped being the display and became the **ingredient list**.

**The story and the reference are two artifacts, and both ship.**

| | **The story** | **The reference** |
|---|---|---|
| Form | flowing prose, 4–6 sentences | structured, listed, expandable |
| Contents | the 2–4 things that matter about *this* book | every fired finding + every disclosure, ranked |
| Built from | selected findings, stitched | **all** fired findings — nothing suppressed |

### The four movements — beats, not sections. No headers, no boxes.

| # | The question it answers | Fed by |
|---|---|---|
| **1 · What you hold** | *What kind of book is this?* | PA1, archetype, shares |
| **2 · What we can judge** | *How much can we speak to — and why not the rest?* | coverage, PV6, **PV2** |
| **3 · The two reads** | *What do the numbers say, and do they agree?* | Health, Construction, PQ, PS, **PX (PX6 is the hinge)** |
| **4 · The point** | *What are the one or two things that actually matter?* | highest-priority PC · PB · PI |

**Movement 4 is why the story exists;** 1–3 set up, 4 pays off. **A short story is a valid story** — a book
with nothing notable gets a three-sentence story that stops. Padding it is how we'd become every other
tracker. **The order is fixed; the emphasis is not** — a fund-led book spends its words in movement 2
(scope IS the story), a concentrated stock book in movement 4.

**Movement eligibility is DECLARED and EXHAUSTIVE** (`story.ts` `MOVEMENT_HOME`), and an unrouted family
**throws** — no default, because an unreviewed sentence in a story is worse than a mis-filed card in a
panel. `PA → 1 · PV/PE → 2 · PX/PQ/PS → 3 · PC/PB/PI → 4 · PD → reference only, always.` (⚠ The addendum's
§9.2 list omitted **PQ and PS** — drift #14; the throw caught it on the first real book, which fires PS5.
Both are movement-3 pillars: PQ is Quality's shape, PS is Signals'.)

### The three rules the composer enforces in a GRAMMAR, not a generation

1. **Movement 4 takes AT MOST TWO, and the two must describe DISTINCT SUBJECTS** — traced through the
   ledger to a set of holdings, compared by set EQUALITY (`story.ts` `subjectSetOf` / `sameSubject`; ODL
   `cv2-s10b-select-not-suppress`). The thesis book `4c5ca537` is one holding — TCS at 100% — so PC2
   ("dominant position", subject TCS) and PC4 ("single-sector book", subject `it_technology`) are **one
   holding described twice**, and no §11.1 suppression catches it because they sit on different axes. The
   story takes the higher-ranked and moves on. **This is SELECTION, not suppression:** PC4 still fires,
   keeps its Concern tone, and renders in the reference. *The story picks; the catalog keeps.*
2. **The limitation rule** (`story.ts` `sectorLimitationApplies`): a limitation enters the story ONLY when
   it changes how to read a number already in the story — else it is reference. The predicate is
   `sectors.sectoredShare`, an existing measurement: baskets 12% → sectoredShare ~88% → reference; baskets
   60% → sectoredShare ~40% → story. This is the Nifty Bank ETF fix, in arithmetic.
3. **The Doesn't-mean does NOT enter the story.** It lives on the reference item, one tap away. The hedge
   is more honest as a click than as a mumble.

**Determinism is the whole point** (§7 of the addendum; ODL `cv2-s10b-story-zero-homes`): identical books
produce identical stories **byte-for-byte** — asserted across runs AND under permutation of the fired set.
Every non-negotiable — never advise, never predict, never juxtapose health against returns — is
**enforceable in a grammar and unenforceable in a generation.** The Gemini layer does not write the story;
the advice-verb grep can *prove* a composer cannot emit a sentence the guard rejects, and can prove no such
thing of a model.

**Movement 1 was the differentiator and it survives as PE1's evaluability read** — *"We judged this as a
**Stock-led** book. Applied: company concentration, breadth, sector spread. Not applicable: fund-house
concentration — you hold no funds."* No tracker tells a user what it could and couldn't see about them;
that sentence *is* the brand, and it exists only because rules have subjects.

---

## ▶ SECTION 3 — THE FINDING FACE

Extends the implemented `PfFinding` (`patterns.ts`, the `PfFinding` interface). **The changes below are
BUILT:**

```ts
export type Tone = "Constructive" | "Neutral" | "Caution" | "Concern";

export interface PfFinding {
  id: string;
  family: string;
  label: string;
  tone: Tone;
  loud: boolean;
  bind: Record<string, unknown>;   // exact engine values — UI renders numbers, never recomputes
  read?: string;                   // required in practice for every emitting family
  doesntMean: string;              // (Stage 9) REQUIRED — from copy.ts, never authored inline
  storyClause?: string;            // (Stage 10b) a stitchable fragment; its ABSENCE gates a finding out of the story
  notEvaluable?: { reason: string; cls: NullReasonClass };  // (Stage 10a batch 3) PI only — see §9
}
```

**`doesntMean` is not decoration.** `CatalogFace` (`scoring/lens-patterns/catalog.ts`) already carries it
for stock patterns; `PfFinding` did not. That asymmetry is how a portfolio finding drifts into advice — the
Doesn't-mean is the sentence that stops it. **Every finding in this document ships with one. A finding
without a Doesn't-mean does not ship.**

**`storyClause` (Stage 10b) and `notEvaluable` (Stage 10a batch 3) are additions doc 2 never knew about.**
`storyClause` is a stitchable fragment for the story; its ABSENCE is a structural gate — a finding without
one is ineligible for the story by construction, which is the second, structural lock that keeps PD out of
it (§2, §10). `notEvaluable` is set only by the PI family and carries a machine reason + its taxonomy class
(§9, §10).

**Copy home — one ruling. ✅ BUILT: `src/portfolio/phs/copy.ts`.** All portfolio finding copy lives in
exactly one content module, imported by the engine. Not duplicated into comments, not inlined per rule, not
in the DB. **That is how copy rots.**

> **⚠ THE `catalog.ts` REFERENCE ABOVE WAS A PHANTOM — corrected.** *"`catalog.ts` comments"* meant
> **`src/scoring/lens-patterns/catalog.ts`** — the **LM/LP stock library, a different library entirely**.
> **`phs/catalog.ts` NEVER EXISTED**, so the Stage-9 instruction to delete its prose was itself citing a
> phantom. And the *"Findings Map"* string appears in **zero `.ts` files** — only in docs. The correction
> matters because the original text reads as a defect report against code that does not exist; someone
> would eventually go looking for it. **Same class as §11.1's fabricated `engine.ts:207-223`.**

**`doesntMean` is required and CLASSIFIED** — `job: ("advice-block" | "misread-block" |
"misattribution-block")[]` (`copy.ts`). A comment cannot be asserted; **a required field makes the COMPILER
prove classification before the verify runs.** Every emitting finding carries one — the Stage-9 set (24
original + PC6/PC7/PC8/PB6/PB7 + PQ2/PQ3), **plus the Stage-10a families PI1–PI8 and PD1–PD8** (read-time,
in `copy.ts` `READ_TIME_COPY`; PD8 is the ingestion-schedules disclosure PI1's re-gate created — §9, §10).
PV3 stays retired with the coverage ceiling.

**Both gates are ENFORCED IN CI, not review** (`verify-phs-copy.ts`) — *"a finding without a Doesn't-mean
does not ship"* means **the build fails**:
1. every emitted finding has a non-empty, classified `doesntMean`;
2. the **advice-verb grep at ZERO** across every assertive string, with **negative controls** proving the
   gate bites (*"38% is too concentrated — consider trimming"* → caught on `trim`, `consider`,
   `too-adjective`).

**The guard EXTENDS `no-forward-guard.ts`** rather than duplicating it — **one home for the RULE, two for
the VOCABULARY** (`"reduced margins"` is descriptive in a stock Read and would false-positive on a shared
`reduce`). **And it scopes rather than allowlists:** a `doesntMean` **negates advice by construction**
(*"≠ trim it"*, *"≠ it will fall"*), so it is **out of scope** — scanning only what ASSERTS. The 31
Doesn't-means carry **9 would-be hits**; scope is exact where an allowlist is a guess needing a new entry
for every future negation.

**⚠ THE FIVE CONSTRUCTIVE ONES (PQ1 · PB1 · PS5 · PV1 · PX4) STATE THEIR SCOPE, NOT A DISCLAIMER.** Their
failure mode is **inaction**, so their Doesn't-mean is the only one whose job is to **stop the user
relaxing**. *"≠ this is a recommendation"* is a **non-sentence** — nobody was about to act on good news. The
real question is **what does this finding NOT cover?** PV1 does not mean the holdings are good; it means we
could **READ** them. PX4 does not mean nothing can go wrong; it means nothing is **currently firing**.

**Tones** are the platform's descriptive set — Constructive / Neutral / Caution / Concern. Never Buy/Sell. Never green-as-good.

---

## ▶ SECTION 4 — FAMILY PA · ARCHETYPE & COMPOSITION

*Panel 1. What this book is, before any judgment.*

### 4.1 Archetype derivation (doc 1 references it; this defines it)

**Exposure shares** — from `asset_class` + AMFI `category` (which literally says *"Debt Scheme"*, *"Equity Scheme"*, *"Hybrid Scheme"*, *"Other Scheme - Index Funds"*, so it is parseable, not inferred):

```
equityExposure    = stocks + equity baskets + equity ETFs + REIT/InvIT
debtExposure      = bonds + gsec + debt baskets + debt ETFs
commodityExposure = gold/silver ETFs + SGB
unknownExposure   = category unresolvable
```

**Archetype, evaluated in this order** (declared constants, `portfolio-findings 2.0`):

| Order | Archetype | Condition |
|---|---|---|
| 1 | **Income-led** | `debtExposure ≥ 0.50` |
| 2 | **Commodity-led** | `commodityExposure ≥ 0.50` |
| 3 | **Stock-led** | `nameRiskShare ≥ 0.60` |
| 4 | **Fund-led** | `basketShare ≥ 0.60` |
| 5 | **Blended** | otherwise |

Order matters: 1–2 ask *what you own economically*; 3–4 ask *how you hold it*. A 100% bond book is both name-risk and income — **Income-led wins**, because that is the truer sentence about it.

### 4.2 Findings

| ID | Trigger | Label | Tone | Loud |
|---|---|---|---|---|
| **PA1** | always | **Composition** | Neutral | Loud |
| **PA2** | `avgPositionValue < PA_SMALL_POSITION` (₹10,000) | **Position scale** | Neutral | Quiet |
| **PA3** | `entityCount < nameRiskInstrumentCount` | **Instruments vs companies** | Neutral | Quiet |

**PA1 · Composition.** *Bind:* archetype, holdingCount, entityCount, exposure shares.
**Read:** *"8 holdings · 6 companies · 62% equity, 30% debt, 8% gold. We read this as a **Blended** book."*
**Doesn't-mean:** ≠ this mix is right or wrong for you. We describe what you hold. There is no correct equity/debt ratio without knowing your goals, and we don't know them.

**PA2 · Position scale.** *Bind:* `holdingCount`, `avgPositionValue`, `capitalTier`.
**Read:** *"10 positions averaging ₹5,000. Brokerage and charges are a near-fixed floor per trade, so they are a larger share of a smaller position."*
**Doesn't-mean:** ≠ you hold too many things, ≠ consolidate. A fact about arithmetic, not a verdict on your choices.
*(This is where portfolio size lives. It never enters a score — doc 1 §13. It shapes copy.)*

**PA3 · Instruments vs companies.** *Bind:* `entityLedger`.
**Read:** *"You hold 10 instruments across 8 companies — two of your positions are different instruments of the same company."*
**Doesn't-mean:** ≠ duplication is a mistake. It's how much rides on one company, which the instrument count hides.

---

## ▶ SECTION 5 — FAMILY PC · CONCENTRATION (dominance)

*Binds the dominance rules: C1, C3, C5. These findings **are the headline** for deductions already in the number — see §12.*

> **⚠ RENUMBERED TO DOC-1'S IDs (`portfolio-findings 2.0`).** This table previously used its own
> numbering, which **collided with doc 1's for different findings** — doc-2's `PC4` was doc-1's `PC3`,
> doc-2's `PC5` was doc-1's `PC4`, and **doc-2's `PB1` was doc-1's `PC5`**. Doc 1 is the code and it wins.
> **A doc-2-following repoint would have moved a PC into a PB.** The IDs below are the ones `patterns.ts`
> emits. Old doc-2 IDs are shown only in the crosswalk at §5.1 — never used again.

| ID | Trigger (bind) | Label | Tone | Loud |
|---|---|---|---|---|
| **PC1** | `maxWeight > 0.25 + EPS` — **suppressed by PC2** | **Heavy single position** | Caution | Loud |
| **PC2** | `maxWeight > 0.40 + EPS` | **Dominant single position** | Concern | Loud |
| **PC3** | `C3.metrics.maxSectorPct > 40 + EPS` (RAW, uncapped) — **suppressed by PC4** | **Sector concentration** | Caution | Loud |
| **PC4** | `C3.metrics.maxSectorPct > 60 + EPS` (RAW) | **Single-sector book** | Concern | Loud |
| **PC5** | `C2.metrics.neff < 5` **and** C2 evaluable | **Thin effective spread** | Caution | Loud |
| **PC6** | `C5.metrics.maxHousePct > 40 + EPS` (RAW) — **suppressed by PC7** | **Fund-house concentration** | Caution | Loud |
| **PC7** | `C5.metrics.maxHousePct > 80 + EPS` (RAW) | **Single-house book** | Concern | Loud |
| **PC8** | any entity with ≥2 constituent instruments **and** weight ≥ 0.10 | **One company, two instruments** | Caution | **Loud** |

**Every trigger keys on a RULE'S OWN MEASUREMENT (`metrics`), never on the rule FIRING, and never on a
re-derivation** (ODL `cv2-s9-truth-not-deduction`). `~~C3 fired~~` / `~~C5 fired~~` above were wrong twice
over: they gate a finding on a **deduction**, and `patterns.ts` never actually read C3 — it **re-derived
`maxSector` itself**, a second computation of a fact `c3Of` had already measured.

- **`evaluable`, never `points > 0`.** *"We could measure it"* ≠ *"it charged"*.
- **The metric is RAW — the cap is a CHARGE ceiling, not a TRUTH ceiling.** C3 stops charging at 65% and
  C5 at 60.8%; a 100%-pharma book is still 100% pharma. **A cap can never hide a truth.**
- **`+ EPS` (1e-9) is load-bearing.** Every metric is a **sum of fractions**: `40/100 + 20/100 =
  0.6000000000000001` → `maxHousePct 60.00000000000001`. A bare `> 60` hands a threshold-exact book to
  float dust — and threshold-exact books are a real shape here (§10 Example B holds Cummins at **exactly
  30%**), not a curiosity.

### 5.1 Crosswalk — old doc-2 ID → doc-1 ID (for anyone holding a pre-2.0 copy)

| old doc-2 | doc-1 (canonical) | finding |
|---|---|---|
| PC1 · PC2 | **PC1 · PC2** | unchanged |
| **PC3** | **PC8** | One company, two instruments |
| **PC4** | **PC3** | Sector concentration |
| **PC5** | **PC4** | Single-sector book |
| PC6 · PC7 | **PC6 · PC7** | unchanged |
| **PB1** | **PC5** | Thin effective spread — **a PB that was a PC** |
| **PB2** | **PB1** | Well-spread book |
| **PB3** | **PB7** | False sector spread |
| **PB4** | **PB2** | Very broad book |
| **PB5** | **PB3** | Closet-index breadth |
| PB6 | **PB6** | unchanged |

**PC1 · Heavy single company.** *Bind:* entityKey, displayName, weight, that stock's own band.
**Read:** *"NTPC is 28% of your book. Its health contributes 28% of the aggregate — the read leans heavily on this one company."*
**Doesn't-mean:** ≠ the position is a mistake, ≠ it will fall, ≠ trim it. Concentration is a fact about how much the score depends on one name, not a judgment on the name.

**PC3 · One company, two instruments — the flagship finding.** *Bind:* `entityLedger` entry with constituents.
**Read:** *"You hold NTPC shares (11%) and an NTPC bond (8%). That is **19% of your book riding on one company** — the instrument list shows 11%."*
**Doesn't-mean:** ≠ the bond and the equity carry identical risk (they don't — a bondholder is ahead of a shareholder), ≠ either is a mistake. But one company's fate is one company's fate, and that's what concentration measures.
*Verified: 191 bonds stem-match a company we score — HUDCO, REC, PFC, IREDA, SAMMAANCAP.*

**PC4 · Sector concentration.** *Bind:* sector name, maxSectorPct, constituents.
**Read:** *"Pharma is 60% of your book — a sectoral fund at 30% plus three pharma companies at 30%. Health and risk here move substantially with one sector."*
**Doesn't-mean:** ≠ over-exposed in a bad way, ≠ the sector will underperform. It states how sector-dependent the book is.
*(40% is the trigger precisely because financials-heavy books are normal in India. This fires only past that.)*

**PC6 · Fund-house concentration.** *Bind:* fundHouse, maxHousePct, constituents.
**Read:** *"HDFC manages 60% of your book across three funds. One fund house, one set of operational and governance arrangements."*
**Doesn't-mean:** ≠ this AMC is unsound, ≠ move your money. Fund assets sit in a trust — but the 2020 debt-scheme freezes are why single-house exposure is a structural fact rather than a theoretical one.

---

## ▶ SECTION 6 — FAMILY PB · BREADTH (spread)

*Binds C2, C4, C6.*

> **⚠ RENUMBERED TO DOC-1'S IDs.** Old doc-2 `PB1` ("Thin effective spread") is **doc-1's PC5 — a PB that
> was a PC**; PB2→PB1, PB3→PB7, PB4→PB2, PB5→PB3. See the §5.1 crosswalk. **"Thin effective spread" is a
> PC finding and lives in §5.**

| ID | Trigger (bind) | Label | Tone | Loud |
|---|---|---|---|---|
| **PB1** | `C2.metrics.neff ≥ 8` · C2 **and** C3 evaluable · `maxSectorPct ≤ 40` · **and NOT PB7** | **Well-spread book** | Constructive | Quiet |
| **PB2** | `holdingCount > 25` | **Very broad book** | Neutral | Quiet |
| **PB3** | `holdingCount > 40` | **Closet-index breadth** | Caution | Quiet |
| **PB6** | ≥2 baskets share a `category` **and** their combined weight ≥ 0.20 − EPS | **Funds occupying one exposure** | Neutral | **Loud** |
| **PB7** | C4 evaluable **and** `neffSector / neffUnitSectored ≤ 0.50 + EPS` | **False sector spread** | Caution | **Loud** |

**★ PB7 keys on the RATIO, not `~~(neffUnitSectored − neffSector) ≥ 2~~`** (ODL `cv2-s9-pb7-ratio`). The
difference **measures the wrong thing**: EVERY real book holds more names than sectors, so it asks *"do you
hold more companies than sectors"* — true of essentially everyone. **Measured: it fired on §10's Ex1, the
TYPICAL RETAIL book** (10 names, 6 sectors → diff 2.64) — the book doc 1 calls *well-spread*. **A guard
that fires on everything is as uninformative as one that fires on nothing.**

The ratio is **scale-free** and asks the real question — *what fraction of name-breadth SURVIVES the sector
collapse?* Ex1 keeps **64%** (ordinary structure → silent); the motivating book keeps **33%** (9 names, 3
sectors — a theme wearing a diversification costume → fires). **`0.50` is DECLARED, not derived:** *"at
least half your name-breadth must survive the sector collapse."* Calibrate post-launch via a clean version
bump.

**★ PB1 requires ¬PB7 — and it is the library's ONLY falsity suppression** (ODL
`cv2-s9-constructive-most-conditioned`). Ex1 was told, in the same breath, that its spread was **good**
(PB1) and **false** (PB7). **A Constructive finding is the one a user acts on by DOING NOTHING, so it must
be the MOST-conditioned, not the least:** a Caution that misfires is noise the user dismisses; a
Constructive that misfires is a **FALSE ALL-CLEAR**, and the user's response is to **stop looking**. It is
the only finding whose failure mode is **inaction**. **Wide by name AND wide by sector, or it is not a
well-spread book.** (PB1 has broken three times for exactly this reason — see the ODL.)

**`~~and no PC fired~~` is replaced by `C3.evaluable && C2.evaluable`.** Gating a Constructive on other
findings' FIRING inherits every threshold and cap they carry; gating on **evaluability** asks the right
question — *could we see the thing we are about to praise?* PB1 previously fired on books **whose sectors
never resolved**: a confident claim built on an absence.

**PB1 · Thin effective spread.** *Bind:* `neffEntity`, `nameRiskShare`.
**Read:** *"Although you hold 5 companies, weight is distributed such that your book behaves like roughly 4.6 equally-sized positions."*
**Doesn't-mean:** ≠ you don't own enough stocks. It's about weight distribution, not count.

**PB3 · False sector spread — the new one.** *Bind:* `neffUnitSectored`, `neffSector`, sector map.
**Read:** *"You hold 10 companies, but they occupy 3 sectors. Your book reads 10-wide by name and about 3-wide by sector."*
**Doesn't-mean:** ≠ 3 sectors is wrong. It names a collapse the holding count hides.
*This is the hole doc 1 §6 closes: ten stocks across three sectors at 33% each fires nothing under v1 — max sector 33 < 40, Neff 10 > 8.*

**PB6 · Funds occupying one exposure.** *Bind:* category, constituent funds, combined weight.
**Read:** *"Five of your funds are Large Cap Funds, together 60% of your book. For breadth, they read closer to one exposure than five."*
**Doesn't-mean:** ≠ these funds are identical, ≠ redundancy is a mistake, ≠ sell four. Different managers make different calls — but they fish in the same pond.
**Why this is a finding and not a rule:** redundancy is an *inefficiency*, not a structural risk. Scoring it means judging their choice. Fund-**house** pile-up (PC6) *is* structural — one point of failure. That distinction is deliberate.

---

## ▶ SECTION 7 — FAMILY PE · EVALUABILITY

*Panel 3. This family exists only because rules have subjects. It is the most on-brand thing we ship.*

| ID | Trigger | Label | Tone | Loud |
|---|---|---|---|---|
| **PE1** | always | **What we measured** | Neutral | Loud |
| **PE2** | `unknownSectorRatio > 0.50` | **Sector not readable** | Neutral | Quiet |
| **PE3** | `houseUnknownShare > C5_HOUSE_UNKNOWN_KILL × fundShare` (**not a flat 0.50** — drift #7) | **Fund house not readable** | Neutral | Quiet |
| **PE4** | `nameRiskShare == 0` | **No direct company risk** | Neutral | Quiet |
| **PE5** | any basket with unresolved sector exposure | **Fund contents not visible** | Neutral | **Loud** |
| **PE6** | `unvaluedShare > 0` — **READ-TIME, never persisted** | **Capital we couldn't value** | Caution | Loud |

**PE1 · What we measured.** *Bind:* `constructionLedger` (every rule with `fired` / `clear` / `not_evaluable` + `subjectShare`), archetype.
**Read:** *"We judged this as a **Stock-led** book. **Applied:** company concentration, breadth, sector spread, sector concentration. **Not applicable:** fund-house concentration — you hold no funds."*
**Doesn't-mean:** ≠ the not-applicable rules were passed. They had nothing to measure in your book.

> **⚠ PE3 KEYS OFF C5's OWN KILL, NOT A FLAT `houseUnknownShare > 0.50` (drift #7 — `patterns.ts`, the
> PE3 block).** C5 ("fund-house concentration") is not-evaluable when the house-unknown share exceeds
> `C5_HOUSE_UNKNOWN_KILL × fundShare` — i.e. relative to the fund sleeve, not the whole book. Doc 2's flat
> `> 0.50` stays SILENT on a book that is 10% funds all house-unknown (houseUnknown 0.10): C5 is genuinely
> not-evaluable there, and the flat rule would leave the panel with no reason C5 is missing. **PE3 must
> mirror the rule it explains, or it fails to explain exactly the case that needs explaining.** Keyed on
> the metric, never on C5 having fired.

**PE5 · Fund contents not visible — name the blind spot, don't paper over it.** *Bind:* basket list, `basketShare`.
**Read:** *"Your Nifty Bank ETF gives you banking exposure that our sector reading cannot currently see — we don't have look-through into fund holdings. Sector figures above reflect your direct companies only."*
**Doesn't-mean:** ≠ the fund is risky, ≠ we're hiding something. It's a limit of what we can currently verify, and it's ours to close.
*Doc 1 §14 flags exactly this for Example C.*

**PE6 · Capital we couldn't value.** *Bind:* `unvaluedValue`, `unvaluedShare`, per-holding `unpricedReason`.
**Read:** *"₹X of your book (2 holdings) has no price we can source — they are not reflected in Construction. Reason: not exchange-traded."*
**Doesn't-mean:** ≠ worthless, ≠ ₹0. We don't know what it's worth and we won't pretend.

---

## ▶ SECTION 8 — HEALTH-SIDE FAMILIES · PQ · PS · PV · PX

*All four exist in `patterns.ts` today. This section **revises** them. Do not rebuild from scratch.*

### 8.1 PQ · Quality composition — *the average hides the split*

| ID | Trigger | Label | Tone | Loud |
|---|---|---|---|---|
| **PQ1** | Quality ≥ 75, all scored holdings ≥ 65 | **Uniformly sound holdings** | Constructive | Quiet |
| **PQ2** | `scoredCount ≥ 2` **and** sample σ(health) ≥ **15** | **Split quality (barbell)** | Neutral | Loud |
| **PQ3** | `Quality ≤ 55` **and** `scoredCount ≥ 2` **and** sample σ(health) < **15** | **Uniformly ordinary holdings** | Caution | Quiet |
| **PQ4** | a scored holding in `fragile`/`below_par` at weight ≥ 0.10 | **Weak name at size** | Caution | Loud |
| **PQ5** | `pillarProfile != null` | **Where the health comes from** | Neutral | Quiet |
| **PQ6** | `lensProfile != null` | **What the evidence rests on** | Neutral | Quiet |

> **★ BUILT (`portfolio-findings 2.0`) — the threshold is now DECLARED.** PQ2/PQ3 were honest-empty through
> 1.1/1.2 because doc 1 declared them only in words (*"above tolerance"*, *"low dispersion"*) and never a
> number. **`PQ_DISPERSION_SPLIT = 15` — ONE constant, BOTH rules**, so they are **mutually exclusive by
> construction**: σ ≥ 15 ⇒ *the average hides a split*; σ < 15 ⇒ *the average is honest*. **Two cutoffs
> would open a gap or an overlap**, and a book could be told both that its average lies and that its
> average is trustworthy. **Why 15: it is ONE FULL HEALTH BAND** (~15 wide), so holdings routinely sit a
> band apart — precisely when the average stops describing any of them.
>
> **★ SAMPLE σ (n−1), NOT POPULATION σ — and the reason is not the example.** **Population σ of one holding
> is 0**: the statistic tells the exact lie the `n ≥ 2` guard exists to catch ("no split!" when the truth is
> **"no distribution"**). **Sample σ of one holding is 0/0 — UNDEFINED: the statistic refuses to answer.**
> That is honest-empty expressed in arithmetic rather than bolted on beside it. (`PQ_MIN_SCORED_FOR_DISPERSION
> = 2` stays explicit anyway: NaN must never reach a comparison, and "undefined by construction" is a
> property to ASSERT, not a behaviour to rely on.) The example is the TEST, and it passes: **BEL 78 / Tata
> 51 → sample σ 19.09**; the 3-name book averaging exactly 70 → **16.52**. *(Population σ would be **13.50**
> and MISS doc 2's own motivating case.)* An honest book — {68, 70, 72} → **2.00**, silent.
>
> **⚠ σ DECAYS AS MID-NAMES ARE ADDED — INTENDED, AND THE SEAM IS CLEAN.** {78,51,75,76} → 12.73 and
> {78,51,70,72,79} → 11.29 both go **silent** while the 78/51 split is still there. **That is the rule
> declining to over-claim as its evidence thins:** every mid-name is evidence the average is HONEST. PQ2's
> claim is that the average describes **NOBODY** — true at 78/51, false at 78/51/70/72/79 (it describes
> three of five). That book is not hiding a **split**, it is hiding **one name**.
>
> **★ AND THAT LEAVES A KNOWING GAP — a decision, not an oversight** (ODL `cv2-s9-pq2-pq4-gap`).
> `BAND_MIXED = 50` and **PQ4 fires on `health < 50`, so Tata at 51 is MIXED, not Weak — by ONE POINT.**
> `{78,51,70,72,79}` therefore fires **nothing** in the PQ family, and that is right. **The test: what
> would the SENTENCE be?** *"You hold a name at 51 in a book averaging 70"* … and then what? It isn't weak.
> The average isn't lying. **The only sentence left is a nudge toward a name the engine has explicitly
> declined to flag — advice wearing a finding's clothes.** §1's exact prohibition. **Do not close it by
> extending PQ4 to Mixed-and-below:** that fires on any 10%+ position under 65 — an enormous share of real
> books — which is PB7's disease. **Closing a gap is not free; the price is every book it then misdescribes.**
>
> *(Doc 2's own motivating example sits one point outside PQ4 by coincidence, so it cannot demonstrate the
> PQ2 ∧ PQ4 co-fire it implies. The mechanism is real for genuinely weak names and is proven on {78, 45}.)*

**PQ2 · Split quality.** **Read:** *"Your average health of 70 hides a split — you hold strong names (BEL 78) and weak ones (Tata Motors 51) at meaningful weight. The single number sits between two different stories."*
**Doesn't-mean:** ≠ the weak names are mistakes, ≠ sell the low ones. It names a distribution the average compressed.

**PQ5 · Where the health comes from.** *Bind:* `pillarProfile` (already computed; `foundationSubtotal` etc. come off `ScoreSnapshot` with no join).
**Read:** *"Weighted across your scored holdings: Foundation 74, Momentum 61, Market 68, Ownership 79. Your book's health rests most on balance-sheet quality and ownership, least on growth momentum."*
**Doesn't-mean:** ≠ a low pillar is a problem to fix, ≠ predictive. A characterization of evidence, not a forecast.
**Note for copy:** the **Market pillar is price-derived** (52-week range, 200DMA, higher-high/higher-low, relative strength, volatility ratio — `MarketSubComponent` A1/A2/B1/B2/B3/C1/D1). Copy must not imply Market is a business-fundamentals read. It is the market's verdict, carried at 20% weight alongside 80% business evidence.

**PQ6 · What the evidence rests on — the gated one.** *Bind:* `lensProfile {absolute, peer, trend}`.
**Read:** *"Of the lens-tagged patterns firing across your holdings, most are peer-relative — your book's signals come mainly from how holdings compare to their peer groups rather than absolute thresholds."*
**Doesn't-mean:** ≠ **this is not a share of your health score.** Lenses are interpretive overlays, not additive components that sum to the score. This counts *fired patterns*, nothing more.
**Binding constraint:** `lensProfile` is derived from `LENS_NATURE` (`constants.ts`, the `LENS_NATURE`
map) over fired patterns — a **findings-character** read, not a score-attribution read. **Copy must never
say "X% of your health is peer-relative."** If that sentence ever appears, the finding has become a
fabrication.

### 8.2 PS · Signal exposure

| ID | Trigger | Label | Tone | Loud |
|---|---|---|---|---|
| **PS1** | Σ weight of holdings with any critical/high flag ≥ 0.10 | **Capital under active red flags** | Concern | Loud |
| **PS2** | any holding in `fragile` band at weight ≥ 0.05 | **Distress exposure** | Concern | Loud |
| **PS3** | Σ weight with LP5 ≥ 0.25, not already headlined | **Broad-erosion exposure** | Caution | Loud |
| **PS4** | Σ weight with LP6 ≥ 0.25 | **Fading-strength exposure** | Caution | Quiet |
| **PS5** | no holding carries any deducting finding | **No active red flags** | Constructive | Quiet |

**PS1.** **Read:** *"18% of your book by value sits in holdings with active red flags (NAME, NAME). These are the holdings the model is currently warning on."* Link each to its stock-view flag Read.
**Doesn't-mean:** ≠ these will fall, ≠ sell them. A red flag is *"go look hard,"* never a trade signal.

**Known scope limit — state it in PS1's copy, don't hide it.** `severityToFinding` maps only `critical` / `high` / `medium` into Signals. The P-rules fire `red` / `amber` / `green` and therefore **never reach the portfolio number**. Whether that is correct is an open ticket (doc 1 §13 — it touches Health, which is frozen). Until resolved, PS1's population is R-rules and B/C-family patterns. **Do not silently imply full red-flag coverage.**

### 8.3 PV · Coverage — *rewritten; the ceiling is dead*

| ID | Trigger | Label | Tone | Loud |
|---|---|---|---|---|
| **PV1** | `coverage ≥ 0.90` | **Fully verified book** | Constructive | Quiet |
| **PV2** | `coverage < 0.60` | **Partly verified book** | Neutral | Loud |
| **PV4** | recognized-unscored weight ≥ 0.15 | **Awaiting-coverage names** | Neutral | Quiet |
| **PV5** | small-unscored weight ≥ 0.25 | **Untracked small-caps** | Caution | Quiet |
| **PV6** | non-stock weight > 0 | **Held by design, not scored** | Neutral | **Loud** |

> **⚠ THERE IS NO PV3 — NEITHER v1 NOR A REPLACEMENT (drift #10 / #13).** `patterns.ts` emits PV1, PV2,
> PV4, PV5, PV6 and **no PV3 at all.** The old v1 PV3 "Confidence-limited read" described the coverage
> ceiling, which is RETIRED (`constants.ts`, Change 3 — Health shows TRUE, uncapped). An earlier draft of
> this section replaced it with a *"Provisional read"* PV3 — **that finding does not exist in code either.**
> A phantom replacing a corpse is still a phantom. The Provisional STATE survives as a tag on the snapshot
> (`provisional`), not as a finding. **Movement 2 reads PV2 and PV6** — and the addendum §3, which cites
> "PV2/PV3", is wrong for the same reason (drift #13; corrected in that file).

**PV6 · Held by design, not scored — the finding that makes multi-asset honest.** *Bind:* non-stock value, per-class breakdown.
**Read:** *"₹90L of your book — mutual funds, a gold ETF, and a G-Sec — sits outside the Health read. **That is by design, not a gap.** Our health score reads businesses. A fund owns businesses we can't see inside; gold isn't a business at all."*
**Doesn't-mean:** ≠ these holdings are unhealthy, ≠ we failed to cover them, ≠ they're worse than your stocks. Health has nothing to say about them, and saying nothing is the honest answer.

**PV4 vs PV5 vs PV6 — three different facts, never one bucket.** PV4 = *we haven't reached it yet* (Tata Motors). PV5 = *genuinely unverifiable volatility*. PV6 = *the question doesn't apply*. Copy must keep them distinct. Lumping them into one scolding "unscored" bucket is the single easiest way to break this family.

### 8.4 PX · Cross-read tension — *the information is in the disagreement*

| ID | Trigger | Label | Tone | Loud |
|---|---|---|---|---|
| **PX1** | Health ≥ 70 **and** Construction ≤ 60 | **Sound companies, fragile construction** | Caution | Loud |
| **PX2** | Construction ≥ 85 **and** Quality ≤ 55 | **Well-built, ordinary components** | Neutral | Loud |
| **PX3** | Quality ≥ 65 **and** Signals ≤ 60 | **Sound holdings, active deterioration** | Caution | Loud |
| **PX4** | Quality ≥ 70, Construction ≥ 85, Signals ≥ 85, coverage ≥ 0.80 | **Broad strength** | Constructive | Loud |
| **PX5** | Σ weight of field-weak holdings (LM3/LP2) ≥ 0.30 | **Weak-field environment** | **Neutral** | Quiet |
| **PX6** | `(constructionGross − constructionNet) ≥ 10` | **A specific defect moved the number** | Neutral | Loud |

**PX1.** **Read:** *"The companies you hold are individually healthy (Health 76), but the way they're weighted concentrates the book (Construction 51). Your holdings' quality and your book's construction tell different stories."* Point to the specific C-rules that fired.
**Doesn't-mean:** ≠ rebalance, ≠ the concentration will backfire. It names the tension a single number would have blended away.
*This is the case that justifies the split: **Health 80 · Construction 21** — a genuinely great company held in a genuinely fragile way.*

**PX5 · Weak-field environment — how the field-verdict surfaces without ever penalizing.** *Bind:* `fieldWeakSymbols`, weight.
**Read:** *"A notable share of your book is in holdings our engine reads as leading **weak fields** — the peer groups themselves are soft on key metrics right now. This is context about the environment your holdings sit in, not a judgment on the holdings."*
**Doesn't-mean:** ≠ your stocks are weak (they may lead their field), ≠ these sectors will underperform. A fact about ponds, not fish.
**Lock:** Neutral tone, always. Never Caution. Never Concern. Never deducts (doc 1 §13 · Health frozen).

**PX6 · The gross/net gap — the storyboard's spine.** *Bind:* `constructionGross`, `constructionNet`, fired defect rules.
**Read:** *"Your money is spread reasonably across what you hold (89). One specific thing moved the number: 60% of your book is in Pharma (61)."*
**Doesn't-mean:** ≠ the defect is fatal, ≠ fix it. It separates *how you're spread* from *what specifically fired* — two different explanations that a flat score merges.

---

## ▶ SECTION 9 — FAMILY PI · INSTRUMENT FACTS

*Movement 4 (addendum §9.2) + the reference. **None of these deduct from anything** (§0). All may use price
and returns data (§0 boundary). Every one carries a Doesn't-mean. **BUILT (Stage 10a batch 3):
`read-time-findings.ts` `fireInstrumentFindings`; the live proof is `7985d813`'s Kotak Manufacture in India
Fund — dd5 = −22.8% evaluable, benchmark honestly refused. ODL `cv2-s10a-refusal-nesting`.***

| ID | Trigger (bind) | Label | Tone | Loud |
|---|---|---|---|---|
| **PI1** | ETF premium/discount `> PI_PREMIUM_NOTABLE` (2%) **on a SAME-TRADING-DAY pair** — re-gated, drift #12 | **Trading away from NAV** | Caution | **Loud** |
| **PI2** | `planType == 'regular'` **and** a Direct twin resolves — **honest-null: does not fire** | **Regular plan held** | Neutral | **Loud** |
| **PI3** | `isActive == false` | **Dormant scheme** | Caution | **Loud** |
| **PI4** | `benchmark_via == 'name'` fund with `trackingError1y > PI_TE_NOTABLE` (2%) | **Tracking gap** | Neutral | Quiet |
| **PI5** | `maxDrawdown` present **and evaluable** (ladder 5y→3y→1y; a refusal never walks) | **Deepest fall on record** | Neutral | Quiet |
| **PI6** | `categoryRank` present — **⚠️ DEFAULT OFF, cannot emit** (`PI6_CATEGORY_RANK_ENABLED = false`) | **Category standing** | Neutral | Quiet |
| **PI7** | REIT/InvIT `distributionYield` present | **Distribution yield** | Neutral | Quiet |
| **PI8** | bond/gsec/sgb `maturityYear` present (book-level spread) | **Maturity profile** | Neutral | Quiet |

> **★ THE PI FAMILY MAY FIRE NOT-EVALUABLE, WITH A REASON — a state no earlier family has** (`PfFinding.notEvaluable`,
> §3). PI is the first family whose subject is an instrument fact the user can see elsewhere: "is my ETF
> trading away from NAV?" is a question they have, and PI1 going SILENT reads as *"no premium"* — a claim
> we did not verify. So when we cannot answer, the finding is PRESENT and says what we could not tell them
> and why. `notEvaluable.cls` carries the taxonomy class (§10); `refused` is the load-bearing one — a
> number exists and we declined to publish it, which must never render as absence.

**PI1 · Trading away from NAV — the killer nobody surfaces.** *Bind:* lastPrice, currentNav, premium %, both dates.
**Read (evaluable):** *"This ETF last traded at ₹62.40 against a NAV of ₹55.70 **on the same day** — a **12% premium**. At that price you pay ₹1.12 for ₹1.00 of the underlying assets."*
**Doesn't-mean:** ≠ the fund is bad, ≠ don't buy, ≠ sell. Premiums arise when creation of new units is constrained; they can persist or close. This is what the market last paid versus what the assets are worth on the same day.

> **★ RE-GATED (drift #12; ODL — PI1 in `read-time-findings.ts`).** Doc 2's gate was `lastPriceDate ==
> navDate`. Measured, that gate **selects for stale prices**: of 328 ETFs carrying both, exactly **2 pass**,
> and they pass because the **price** stopped updating (both dated Jul 10 while 326 are at Jul 13). Both
> dates are OUR ingestion freshness, not the instrument's. So PI1 has **three states, never silent**:
> - **same-trading-day pair over the cut → fires** (Caution, Loud);
> - **a lagged pair → NOT-EVALUABLE WITH A REASON**, never silent — the ~20% premium it *would* have
>   shipped (international ETFs priced 3 days after their NAV) is not computed, because a real 15–20% cap
>   premium and the lag artifact are indistinguishable at this data shape;
> - **no same-day pair obtainable anywhere in the book → PD8**, a disclosure about OUR schedules
>   (*"we fetch prices and NAVs on different schedules"*), not silence.

**PI2 · Regular plan held — HONEST-NULL, does not fire.** *Bind:* planType; `directTwin: null` (asserted).
**Read (not-evaluable):** *"You hold the Regular plan of this fund. Regular plans carry a distributor commission inside the expense ratio and Direct plans don't. We can't tell you whether this fund's Direct twin exists — we don't hold a mapping between the two plans."*
**Doesn't-mean:** ≠ switch, ≠ you were mis-sold, ≠ we know your cost difference. We don't have expense ratios.
**Build note (drift #11):** **Direct-twin resolution does not exist and this batch did not build it** — a
findings batch does not grow a resolver (doc 2 §13.2). The only twin code (`mf-distributions.ts`
`resolveTwins`) resolves IDCW→Growth **within** a plan tier and never crosses Regular↔Direct. `plan_type`
is NULL on **3,955** funds — **not doc 2's 5,051** (measured; drift #11) — where Step 9 refused to guess a
plan, so we refuse to guess a twin. PI2 fires not-evaluable and **fabricates no twin** (asserted).

**PI3 · Dormant scheme.** *Bind:* isActive, navDate, lastPrice.
**Read:** *"This scheme is no longer active in AMFI's daily NAV file. Your last known NAV is from DATE. We cannot mark this position to a current price."*
**Doesn't-mean:** ≠ your money is gone, ≠ the AMC failed. Schemes close, merge, and mature routinely. It means we can't price it today.
*Real scale: **5,934 of 17,567 mutual funds are inactive** (34%). ETFs: 2 of 337.*

**PI4 · Tracking gap.** **Read:** *"This fund tracks Nifty PSU Bank. Its tracking error over the last year is 5.8% — it has not moved exactly with the index it follows."*
**Doesn't-mean:** ≠ underperformance, ≠ a bad fund. Tracking error measures *fidelity to the mandate* — deviation in either direction — not whether you made money.
*Only for funds that CLAIM to track: `benchmark_via == 'name'` (the fund's own name states its index). A
Large Cap fund benchmarked `via='category'` never promised to track Nifty 100, so its "tracking error" is
active management, not infidelity — PI4 stays silent there. `PI_TE_NOTABLE = 2%` is the **measured p88**
of the 942 via='name' funds (p50 = 0.30%, p90 = 2.21%). **⚠ The benchmark is NAMED in the Read because 13
"Sensex Next 30/50" funds are mis-mapped to `Sensex` by a substring match — filed T-3; the cut is NOT
moved to hide them, a threshold must never do a bug's cleanup.***

**PI5 · Deepest fall.** **Read:** *"Over the **4 years and 4 months** of NAV history we hold for this fund (March 2022 – July 2026), its deepest peak-to-trough fall was 22.8%."*
**Doesn't-mean:** ≠ it will fall again, ≠ it's riskier than your other holdings. A record of what has happened, over the window we have. Not a forecast, and **not comparable across categories.**

> **★ THE LADDER IS FOR ABSENCE, NOT FOR REFUSAL (ODL `cv2-s10a-refusal-nesting`).** The rungs are
> 5y→3y→1y. A young fund WALKS them (genuine short history → the 1y number is a true thing to say). But a
> **refusal never walks**: an IDCW plan's NAV falls on every payout, so a drawdown on it is a lie at
> **every** horizon — falling back to 1y launders the refusal through a shorter window. The fold already
> ruled this (`omissions` class `refused`); PI5 inherits it rather than routing around it. **And the
> refusal nests:** a longer window CONTAINS every shorter one, so a refusal at 3y contaminates 5y by
> construction. This caught a **shipped falsehood** — 65 side-pocketed defaulted-debt rows carry
> `max_drawdown_5y = 0` because the 5y window is never volatility-tested (fold defect, filed T-4); doc 2's
> *"maxDrawdown present"* trigger would have told those holders their fund never fell. **The Read names the
> ACTUAL span, never "on record"** — 5,070 rows carrying dd5 have under 5 years of history, so the column
> name promises a horizon the data lacks.

**PI6 · Category standing — ⚠️ DEFAULT OFF, `PI6_CATEGORY_RANK_ENABLED = false`.**
*Proposed Read:* *"Over 3 years, this fund ranks 412 of 430 funds we could measure in its AMFI category."*
*Proposed Doesn't-mean:* ≠ sell it, ≠ it will keep lagging, ≠ rank predicts anything.
**Why it is gated:** rank is the single most useful thing we could tell a fund holder, and it is one inch
from *"sell this."* **The flag is a `const false`, not an env var** — ratifying it should cost a diff and a
review, not a deploy-time accident. `verify-phs-pi-readtime.ts` asserts both that it defaults off AND that
a book built to fire PI6 emits nothing (the gate is proven to be a gate). **Head-chat decision required.**

**PI7 · Distribution yield.** REIT/InvIT. The two ledgers agree: the 1 REIT + 2 InvITs with no yield are
exactly batch 2's `no_distributions_in_window` rows — rendered as **zero occurrences, not a missing
number** (reusing `describeNull`'s `not_a_gap` sentence, which the absence-vocabulary gate protects).

**PI8 · Maturity profile.** *Bind:* maturityYear per bond/gsec/sgb, book-level spread + the count it excluded.
**Read:** *"Your debt holdings mature in 2027, 2029 and 2034 — a spread of 7 years."*
**Doesn't-mean:** ≠ a ladder is good or bad. Longer maturities move more with interest rates; that's arithmetic, not advice.
*Maturity is TWO facts at different resolutions (PD1's lesson): `maturityYear` parsed off the name vs the
published `maturityDate`. Measured — bond **year 124/356, date 2/356**; gsec 170/170 & 54/170; sgb 45/45 &
0/45. PI8 fires off the YEAR alone, and **names how many holdings it could not place** rather than speaking
for the whole book off a subset.*

**RETIRED — do not build:**
- **~~Stale NAV~~** — the "44.8% carry stale NAV" claim is **false**. Recon: **zero** active funds have a NAV older than 30 days; zero have a null NAV. The real signal is dormancy (PI3).

---

## ▶ SECTION 10 — FAMILY PD · DISCLOSURES

*Panel 6. Facts about **our data**, not about the holding. Never a Caution about the user's book.*

*Reference-only, ALWAYS — served BESIDE the snapshot, never routed into a movement (ODL
`cv2-s10a-pd-read-time`). A PD finding describes VYTAL, not the book. Enforced twice: `MOVEMENT_HOME`
declares PD → reference, and no PD finding carries a `storyClause`, so none is story-eligible by
construction. **BUILT (Stage 10a batch 2 + PD8 in batch 3): `read-time-findings.ts`
`fireDisclosureFindings`.***

| ID | Trigger | Label | Tone |
|---|---|---|---|
| **PD1** | any bond held | **No credit ratings** — **MANDATORY** | Neutral |
| **PD2** | any bond/gsec/sgb held | **No yield-to-maturity** | Neutral |
| **PD3** | any coupon-bearing holding (excludes discount instruments) | **Coupon income not tracked** | Neutral |
| **PD4** | any `heldNotValued` | **Unpriceable holding** | Neutral |
| **PD5** | any basket held (by `nature`, not `assetClass`) | **No fund look-through** | Neutral |
| **PD6** | `mf_analytics` window < `PD_THIN_HISTORY_POINTS` (250) | **Thin history** | Neutral |
| **PD7** | stale account sync | **Account not synced** | Neutral |
| **PD8** | held ETFs but **no same-trading-day price/NAV pair** | **Prices and NAVs on different clocks** | Neutral |

**PD1 · No credit ratings — mandatory, never suppressible.** Its non-suppressibility is the MODULE, not a
flag: PD never enters the persisted set, so triage never sees it (ODL `cv2-s10a-pd-read-time`).
**Read:** *"We do not have a credit rating for 1 corporate bond in your book — [reason]. This is the single most decision-relevant fact about a bond, and the gap is ours. What we do carry: the issuer on it, the coupon on it, the maturity year on it."*
**Doesn't-mean:** ≠ your bonds are unrated (they almost certainly are rated), ≠ they're risky. **We** don't have the rating. The gap is ours.

> **⚠ PD1's READ WAS FALSE, AND IS REBUILT (drift #8; `read-time-findings.ts` `carriedReport`).** Doc 2
> promised *"the issuer, the coupon, and the maturity where published"* as things we can tell you. Measured
> across the catalog: issuer null **46%**, maturity date null **99.4%** (we have it 2 times in 356). A
> sentence asserting three facts we mostly lack is a second gap wearing the first's apology. **PD1 now
> BINDS WHAT WE HOLD, COUNTED PER HOLDING** — *"the issuer on 1 of 2"*, never an unconditional promise. And
> **maturity is TWO facts at different resolutions** (drift #8 tail): `maturityYear` parsed off the name
> (124/356) vs the published `maturityDate` (2/356). PD1 says we carry the year AND, separately, that the
> exact date is the world's gap — never collapsed into one "maturity". `creditRating` = 0 of 356, honestly
> stamped `not_sourceable`.

**PD8 · Prices and NAVs on different clocks — the disclosure PI1's re-gate created.**
**Read:** *"We fetch exchange prices and AMFI NAVs on different schedules, so for 1 ETF you hold we do not have a price and a NAV from the same trading day — they land 3 days apart. We cannot tell you whether it trades away from NAV, because the two numbers we would compare are not from the same day. That gap is ours."*
**Doesn't-mean:** ≠ your ETF is trading away from its NAV, and ≠ it isn't — we don't know. ≠ the price or the NAV we show is wrong; each is correct for its own day.
*Gated on the BOOK (`heldEtfs > 0 && sameDayPairs == 0`): a user with one same-day pair gets a real PI1 answer and needs no apology. This is the *"no-pair-at-all"* branch of PI1's re-gate — a fact about OUR ingestion, not silence.*

**PD5 · No fund look-through.**
**Read:** *"We can't see inside your funds. We know what each fund is (its category, its house, its plan) — not what it holds. Sector and company figures on this page reflect your direct holdings only."*
**Doesn't-mean:** ≠ funds are opaque by nature — AMCs publish portfolios monthly. It's a source we haven't built yet.
*This is the honest framing of the roadmap item that would make fund-led books legible (doc 1 §9.5).*

**PD3 · Coupon income not tracked.**
**Read:** *"The value we show for your debt holdings is price only — the interest it pays out is not counted in it."*
**Doesn't-mean:** ≠ you didn't receive it — it was paid to your bank on schedule. ≠ the gain shown is wrong; it is a PRICE return, correct as one.
*Excludes discount instruments (T-bills): firing PD3 on a T-bill invents a gap in our data to apologise for — see the taxonomy below.*

### 10.1 The honest-null taxonomy — SIX reasons, FOUR classes (drift #9)

Doc 2 named a **three-reason** null table and **omitted `discount_instrument`** — under which **54 T-bills
would render *"coupon unavailable"* for a coupon that DOES NOT EXIST.** The shipped taxonomy
(`null-reasons.ts`) is richer, and the class picks the SHAPE of the sentence while the reason picks the
sentence:

| class | meaning | the sentence it produces |
|---|---|---|
| **`our_gap`** | WE cannot get it | an admission — *"we don't have X; the gap is ours"* (`not_sourceable`, `not_in_our_universe`, `unparseable_name`) |
| **`world_gap`** | the source does not publish it | an attribution — *"X is not published by the source we read"* (`not_in_source`) |
| **`not_a_gap`** | **there is nothing to get** | a statement of fact about the instrument — *"a T-bill pays no coupon; it is issued at a discount and redeems at par"* (`discount_instrument`, `no_distributions_in_window`) |
| **`refused`** (Stage 10a batch 3) | we COMPUTED it and declined to publish | *"the quality gate fired and caught something"* (`withheld_implausible`, `idcw_nav_not_total_return`, `thematic_no_clean_index`, …) |

**`not_a_gap` must NOT raise absence AT ALL — not even to deny it** (ODL `cv2-s10a-not-a-gap-vocabulary`):
a sentence that says *"…rather than one we are missing"* has already put the gap in the reader's head.
**`refused` is the most Vytal class** — collapse it into *"unavailable"* and the user learns we are missing
data, when what happened is we caught something and protected them from it. It is the class PI5's IDCW
refusal and PI4's `thematic_no_clean_index` silence both live in. The `mf_analytics.omissions` codes are
classified in the SAME taxonomy by importing `OmissionCode`, never by mirroring it (ODL
`cv2-s10a-unclassified-is-a-class` — two ambiguous codes are DELIBERATELY unclassified, named with reasons,
filed T-2).

---

## ▶ SECTION 11 — TRIGGERS, TRIAGE, ANTI-DOUBLE-COUNT

### 11.1 Anti-double-counting (binding)

The C-rules are **already in Construction**. PC/PB are the **explanation** of that same arithmetic — never an additional problem.

- **PC is the headline for C1/C3/C5. PB is the headline for C2/C4/C6.** When PC1 fires, the C1 deduction is *why the number is where it is*. The number carries the hit **once**.
**★ THE SUPPRESSION MODEL (ODL `cv2-s9-suppression-model`) — the question this section never asked:**

> **Suppress when siblings describe the SAME FACT at different intensities.
> Do NOT suppress when they describe DIFFERENT FACTS.**

| pair (doc-1 IDs) | fact | verdict |
|---|---|---|
| **PC1 / PC2** | one entity's weight, two thresholds | **suppress — REDUNDANCY.** A 45% position is not both *heavy* and *dominant*: "dominant" IS "heavy, and more so". |
| **PC3 / PC4** | one sector's weight | **suppress — REDUNDANCY** |
| **PC6 / PC7** | one house's weight | **suppress — REDUNDANCY** |
| **PB1 / PB7** | **different** facts (name-breadth vs sector-survival) that **CONTRADICT** | **suppress — FALSITY.** The library's only such case. |
| **PX vs PC/PB** | different facts that **AGREE** | **both fire** — never merge |
| **PQ2 / PQ4** | different facts that **AGREE** (*the average lies* · *this name is weak AND big*) | **both fire** |

**In each redundant pair the HIGHER-intensity sibling fires and the lower stands down** (PC2→PC1,
PC4→PC3, PC7→PC6). **PB7 suppresses PB1** because *"your spread is false"* outranks *"your spread is
good"* when both describe the same spread — §11.2's tone-triage cannot help there, because triage is for
findings that are **all true**, and these two cannot both be.

**~~mirroring `engine.ts:207-223`~~ — THIS CITATION WAS FABRICATED, and is removed.** Those lines are
**S2's sector threshold and S3's Neff computation**; they contain **no suppression of any kind**. (Doc 1's
real headline-wins, §A.7 step 2, is *per-holding Signals* — an unrelated mechanism, and the one the PS3/PS4
bullet below correctly cites.) **A citation to specific lines that do not contain what is claimed is worse
than an uncited assertion: it invites verification and defeats it** — the checker finds the lines, skims,
and assumes they misread. Verified Stage 9; S1–S5 no longer exist at all (§15).
- **PS3/PS4 fire only for holdings that did not already trigger PS1/PS2** — mirrors the per-holding headline-wins (`patterns.ts`, the PS3/PS4 anti-double-count block).
- **PX is orthogonal to PC/PB.** PC1 says *"one company is large."* PX1 says *"your quality and structure disagree."* Both may fire. Never merge them.
- **PI and PD never interact with any score** and are exempt from suppression against PC/PB. (PI outranks by USEFULNESS — §11.2. PD is reference-only and structurally outside triage.)
- **Stock-level LM/LP patterns are per-holding evidence *beneath* a portfolio finding** — never competing top-level cards. On expand, a flagged holding's own LM/LP Reads appear as texture under the portfolio headline.
- **Respect `displayState`.** Patterns marked `dampened` (fired on >80% of a ≥5-member peer group — `scoring/findings/dampen.ts`, `DAMPEN_THRESHOLD`) and `pending_data_integration` are already filtered at read (`assemble.ts`, the health-view query that excludes `pending_data_integration`). Do not re-surface them at full strength.

### 11.2 Loud / quiet triage

*Placement and visual treatment are the UI chat's call. This library states eligibility and priority only.*

- **Loud** findings are eligible for top-level cards. Priority when several fire: **Concern > Caution > Neutral > Constructive**; within a tone, **higher capital weight first**.
- **Quiet** findings stay as secondary texture — present, never suppressed, not headlined. **This governs PLACEMENT, not FIRING** (ODL `cv2-s9-constructive-most-conditioned`): it means a quiet finding is not hidden from the UI, not that an untrue finding gets to fire quietly. §11.1 decides WHETHER a finding fires; this decides WHERE. **A finding that is not true does not get to fire quietly.**
- **Constructive findings matter.** PX4, PB2, PQ1, PS5, PV1 exist so the surface isn't a scold. A healthy, well-built, fully-verified book should say so **loudly**. Balance is a platform value.
- **PI outranks by usefulness, not by tone.** A 12% ETF premium is the most actionable *fact* on the page and deducts nothing. It should be able to sit above a Caution-tone PC finding. That is the point of separating prominence from arithmetic.

### 11.3 Persistence

Every fired finding is stored on the snapshot with its **bind values resolved**, so the UI renders exact numbers ("19%", "Neff 2.87", "12% premium") without recomputing anything.

**★ ~~Findings are part of the snapshot's fingerprint~~ — THEY ARE NOT, AND MUST NOT BE** (ODL `cv2-s9-no-fired-set-hash`). The fingerprint hashes the **INPUTS** (weights, entities, natures, sectors, houses, health, findings-per-holding, tier, matcher, cv).

- **The fired set is DERIVED from already-hashed inputs.** It cannot change for a reason that belongs to this book without an input changing first — and then the hash has already moved. Hashing the derivation adds **no trigger the inputs don't already carry**.
- **And it would add one that is actively wrong.** `displayState` filtering (`dampened`, `pending_data_integration`) is **peer-group-derived**: it changes with **no change to this user's book**. Hash the fired set and **another company's dampening invalidates this user's snapshot** — a **broadcast, not a trigger**. That is the disease `sectorVersion` had, and why it was deleted (Stage 7).
- **Hashing the inputs is stricter AND narrower: it catches everything real and nothing else.**

**READ-TIME FINDINGS ARE NOT PERSISTED AT ALL.** **PE6** ("Capital we couldn't value") is fired by the READ, from `constructionValuation()`, and joined to the persisted set at render — it is **absent from `fired_findings` on every row, deliberately** (`read-time-findings.ts`; ODL `cv2-s7-refuse-live-facts`).

> **The rule that generalises: the fired set ← HASHED INPUTS → persistable. PE6 ← a LIVE FACT → not. Different provenance, different home.**

`unvaluedShare` / `unvaluedValue` / `provisionalConstruction` are **LIVE FACTS** — the catalog can learn a price tomorrow. Freezing them into an append-only row manufactures the staleness the snapshot exists to avoid: a row asserting *"₹270 of your book has no price"* long after we could price it, with nothing to correct it. **Any spec text listing them as persisted fields is superseded; the read serves them fresh.**

---

## ▶ SECTION 12 — THE ONE TEST

A candidate finding qualifies for this library only if:

> **It names a true fact the collapse hid, is a pure function of values the engine already computed, makes the user a sharper reader of their own book, shows its reasoning, and says nothing about what to do or what happens next.**

If it advises, predicts, penalizes a field-verdict, scores an asset mix, implies a lens attribution that doesn't exist, or fabricates — it is not a finding, and it does not belong here.

---

## ▶ SECTION 12.5 — RECONCILIATION NOTES (`portfolio-findings 2.0`)

*What changed in the code that this document must not contradict. Each line has an ODL entry.*

**PE6 is READ-TIME, and its absence from `fired_findings` is a GUARD, not an omission.** It is fired by the
controller from the live `constructionValuation()` and joined to the persisted set at render
(`read-time-findings.ts`). `firePortfolioFindings` runs **inside `persist`**, which deliberately does not
take `heldNotValued` — *"whether a symbol is valuable is a LIVE fact (the catalog can learn it tomorrow).
The READ serves it, fresh."* Computing PE6 there would **freeze the same staleness one layer up**.
> **The fired set ← HASHED INPUTS → persistable. PE6 ← a LIVE FACT → not. Different provenance, different
> home.** (Live: `e3c6bd3c`'s FAKESTOCK, ₹270 / 0.40% — fires, and correctly does not trip provisional at
> 25%. **The honest sentence does not wait for a threshold.**)

**§A.10's Structure line (doc 1) is S-ERA — superseded by §10 A–D under `portfolio-spec 2.0`.**
*"Structure = 100 − 25 − 18.2 − 10 = 46.8"* is **S-rule arithmetic**, and S1–S5 are deleted (§15). The
example was **true when written**; it is marked, **not deleted**. It was **not re-derived** under C1–C6
(55→21, 80→51, 86.07→75.62) because that produces **a new fact wearing an old citation** — nobody could
later tell whether 21 was *ruled* or *inherited*. **§A.10 owns HEALTH composition; §10 A–D owns
CONSTRUCTION. Neither needs to describe the other.** (ODL `cv2-s9-a10-construction-historical`.)

**§14's matcher — the fund arm DOES NOT SHIP, and the number is the finding.** **Publish the SPLIT, never
the aggregate: 21.5% overall — 96.8% Sectoral · 6.6% Thematic (87% of the bucket).** Quote the aggregate
alone and the reply is *"so extend the regexes"*; quote the split and it is obvious why that cannot work —
**the matcher covers the fraction people don't hold and misses the bulk they do.** This is a **taxonomy
mismatch, not a matcher failure**: thematic funds are not sectorable **from their names**, which is a
**DATA problem**. **The honest path is fund LOOK-THROUGH, not more regexes.** Every fund stays
`not_applicable`; `matcherVersion` stays `"none"`. **§10's Example D stays at its INTERIM value — the 60.6
obligation moves to look-through.** (ODL `cv2-s8-matcher-unratified` — which reconciles these operator
figures with the harness's stricter Sectoral/Thematic boundary of 11.9% / 92.7% / 1.6% / 89%; **same
measurement, different boundary, identical conclusion — the fund arm does not ship either way.**)

**§8's sector-overlap storyboard is UNREACHABLE BY CONSTRUCTION** (Stage 10b). It needs a pharma fund
sectored into Pharma — Example D again — and a `BasketEntry` carries **no sector field at all**. So a
sector finding's subject can never include a fund's weight; PC3 on a pharma-fund book reports the direct
companies' share, not the theme's. **Declared unreachable, not approximated** — it moves to look-through,
never to a regex (`verify-phs-story.ts` asserts the cause).

---

## ▶ SECTION 12.6 — THE STAGE 10a/10b RECONCILIATION (this pass)

*The numbering stopped moving when S1–S5 died and 10a/10b built the catalog, so this reconciliation is last
on purpose. Eight drifts remained after the Stage-9 pass; all are fixed above, each pointing at its ODL
entry or ticket.*

- **Drift #7** — §7 PE3 keyed a flat `> 0.50`; it keys off C5's own kill (relative to fund share).
- **Drift #8** — §10 PD1's Read promised three facts we hold one of; rebuilt to bind-what-we-hold,
  per-holding, with maturity as two resolutions.
- **Drift #9** — §10's three-reason null table omitted `discount_instrument`; the taxonomy is six reasons /
  four classes, `refused` the fourth (ODL `cv2-s10a-not-a-gap-vocabulary`, `cv2-s10a-unclassified-is-a-class`).
- **Drift #10 / #13** — PV3 does not exist; movement 2 reads PV2. The addendum's "PV2/PV3" is corrected in
  that file.
- **Drift #11** — PI2 `plan_type` NULL is **3,955**, not 5,051.
- **Drift #12** — PI1's `lastPriceDate == navDate` gate selected for stale prices; re-gated to
  same-trading-day / not-evaluable / PD8 (ODL `cv2-s10a-refusal-nesting` neighbourhood; PD8 built).
- **Drift #14** — the addendum §9.2 movement-eligibility list omitted PQ and PS; both are movement-3
  pillars, caught by `MOVEMENT_HOME`'s exhaustive throw.

**Three fold defects surfaced by this pass and FILED, not fixed** (scope-blur ruling — Stage 5, batch 2):
**T-3** (`benchmark_via='name'` substring mis-map — 13 Sensex-Next funds), **T-4** (the y5 window is never
volatility-tested — the 65 side-pocket rows), **T-5** (`rank_y5` — an omissions key naming a column that
does not exist). All three are in `TICKETS.md`.

---

## ▶ SECTION 13 — OPEN ITEMS (raised, not buried)

1. **PI6 category rank** — pending head-chat ratification. **BUILT and default OFF** (`PI6_CATEGORY_RANK_ENABLED = false`, a `const`); the finding cannot emit until ratified.
2. **PI2 Direct-twin resolution** — new code required; **still does not exist.** PI2 ships as an honest-null (fires not-evaluable, fabricates no twin). A findings batch does not grow a resolver.
3. **The `severityToFinding` scope** — P-rules (red/amber/green) never reach Signals. Open ticket, out of scope for both docs (touches frozen Health). PS1's copy must not imply full coverage until resolved.
4. ~~**`PfFinding.doesntMean`**~~ — **✅ CLOSED (Stage 9).** Required, classified by `job`, enforced in CI (`verify-phs-copy.ts`) with negative controls; **extended through the Stage-10a PI/PD families and PD8** (`copy.ts` `READ_TIME_COPY`). `copy.ts` is the one home.
5. **Fund look-through** — the roadmap item that makes PD5 obsolete and fund-led books legible. Index-constituent path is the cheap, exact first slice. **§14's matcher was REFUSED on this (11.9% ratification), so this is now the ONLY path to a sectorable fund arm — and it carries §10 Example D's 60.6 obligation.**

### Open calibration obligations (recorded, NOT actioned — each needs its own evidence)

6. **PX1's `Construction ≤ 60` — the threshold did not move; its MEANING did.** Under the S-composite the range floored at ~55 (S1 fired on nearly every book), so `≤ 60` selected the **bottom ~11%**. Under C1–C6 the range floors at ~20, so it now selects the **bottom ~50%.** PX1's Construction gate is therefore nearly always satisfied, and PX1 fires on **any** book with Quality ≥ 70. **That may be RIGHT** — §1's own example is *"Health 80 · Construction 21 — a genuinely great company held in a genuinely fragile way"*, and **the re-rating is the thesis**. But it is a calibration ruling, not a repoint's side-effect. Same question for PX2/PX4's `≥ 85` / `≥ 80`.
7. **PC5's `neff < 5` and PB1's `≥ 8` were tuned against an OVER-COUNTING number.** `r.neff` was S3's *position-level* Neff; `C2.metrics.neff` is *entity-level, sleeve-renormalised* — **strictly ≤** the old value (NTPC stock+bond counts **once**, not twice). Repointed **without** retuning. **Measured diff: Δ ≤ 0.02, no book flipped — BECAUSE THE COHORT HOLDS ZERO BONDS.** Aggregation had nothing to merge. **That is not evidence the thresholds survive aggregation; it is evidence that aggregation never ran.** **The first bond-holding book is their first real test.**
8. **PB2/PB3 (`> 25` / `> 40` holdings) vs C6's cap at 41.** Noted at Stage 8, deferred: a different disease. Note, don't tune.

> **★ THE PATTERN IN 6 AND 7 IS THE SAME, AND IT IS THE ONE TO CARRY FORWARD: a green diff on a population that cannot exercise the change is NOT ratification.** Both repoints measured "no moves". Neither is safe — one was inert because Quality gated it, the other because no book holds a bond. **Absence of a flip is not proof of safety when the population cannot flip.**

---

*End of library. Doc 1 computes; doc 2 reads and narrates. All constants `portfolio-findings 2.0` — declared, not derived. Copy lives in one content module. Every finding ships with a Doesn't-mean or it does not ship.*

---

## ▶ RECONCILIATION LOG — the full pass (Stage 9 → Stage 10b)

**Doc 1 is the code; doc 2 is the map. This is the whole pass — fourteen drifts across ten stages, each
with an ODL entry or a ticket.** Drifts 1–6 were fixed at Stage 9; 7–14 at this reconciliation, once the
numbering stopped moving and 10a/10b had built the catalog.

| # | Where | Drift | Resolution |
|---|---|---|---|
| 1 | §5/§6 | doc-2's `PB1` ≡ doc-1's `PC5`; PC4/PC5 swapped; PB4/PB5 ≡ doc-1's PB2/PB3 | Renumbered to doc-1's IDs + §5.1 crosswalk. **A doc-2-following repoint would have moved a PC into a PB.** |
| 2 | §11.3/§12 | `unvaluedShare` · `unvaluedValue` · `provisionalConstruction` listed as persisted | **Live facts.** Read-time. `cv2-s7-refuse-live-facts` |
| 3 | §11.3 | *"findings are part of the fingerprint"* | **Not hashed.** Hashing lets a peer-group event invalidate a stranger's snapshot. `cv2-s9-no-fired-set-hash` |
| 4 | §11.1 | *"mirroring `engine.ts:207-223`"* | **Fabricated.** Those lines are S2's threshold + S3's Neff — no suppression. Replaced with the model. |
| 5 | §3 | phantom `phs/catalog.ts` | Means `lens-patterns/catalog.ts`. `phs/catalog.ts` never existed. |
| 6 | §6 | PB7 keys `(neffUnitSectored − neffSector) ≥ 2` | **Fires on everyone.** Now the **ratio** `≤ 0.50 + EPS`. `cv2-s9-pb7-ratio` |
| 7 | §7 | PE3 keys a flat `houseUnknownShare > 0.50` | Keys off C5's own kill (× fundShare) — else the panel omits the reason C5 is missing. |
| 8 | §10 | PD1 promises *"issuer, coupon, maturity where published"* | **False** (issuer null 46%, date null 99.4%). Binds what we hold, per holding; maturity is two resolutions. |
| 9 | §10 | three-reason null table, omits `discount_instrument` | **Six reasons, four classes.** 54 T-bills would render *"coupon unavailable"* for a coupon that doesn't exist. Fourth class `refused`. `cv2-s10a-not-a-gap-vocabulary` |
| 10 | §8.3 | PV3 (and a phantom "Provisional read" replacement) | **No PV3 exists.** Movement 2 reads PV2. |
| 11 | §9 | PI2 `plan_type` NULL = 5,051 | **3,955** (measured). |
| 12 | §9 | PI1 gates `lastPriceDate == navDate` | **Selects for stale prices** — both dates are OUR freshness. Re-gated: same-day / not-evaluable / **PD8**. |
| 13 | addendum §3 | movement 2 cites PV3 | Dead. **PV2.** (Fixed in the addendum.) |
| 14 | addendum §9.2 | omits PQ and PS | Both movement-3 pillars. `MOVEMENT_HOME`'s throw caught it on the first real book. |

**Plus the structural rewrites:** §2's six panels → four movements + reference layer (Stage 10b); §11.1's
redundancy/falsity suppression model (`cv2-s9-suppression-model`); §11.2's *"quiet never suppressed governs
placement, not firing"*; §8.1's PQ2/PQ3 (`PQ_DISPERSION_SPLIT = 15`, sample σ, the knowing PQ2/PQ4 gap —
`cv2-s9-pq2-pq4-gap`); §10.1's four-class taxonomy; §12.5's §A.10 S-era mark and §14 ratification failure;
and the Stage-10b additions doc 2 never knew about — **PD8, `storyClause`, `notEvaluable`, and the
cross-axis distinct-subjects rule** (`cv2-s10b-select-not-suppress`, `cv2-s10b-story-zero-homes`).

**★ 4, 5, 8, 10, 11, 12 ARE THE SAME DISEASE, AND IT IS THE ONE THIS DOCUMENT MUST NOT REPEAT: a citation
to specific lines — or a specific count — that does not contain what is claimed is WORSE than an uncited
assertion.** The checker finds the lines, skims, and assumes they misread. **Fourteen premises across the
two passes did not survive a grep or a measurement.** This pass cites SYMBOLS, not line numbers, and every
one has been checked. Cite what you have read, or do not cite.

**No code changed in this pass.** Three fold defects it surfaced (T-3 the benchmark mis-map, T-4 the y5
volatility hole, T-5 the `rank_y5` phantom key) are filed in `TICKETS.md`, not fixed — the scope-blur
ruling that held at Stage 5 and batch 2.
