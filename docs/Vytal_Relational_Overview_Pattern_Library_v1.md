# Vytal — The Relational Overview Pattern Library · Data Bank

**Version:** 1.0 — source of truth for reader-relative patterns (the fourth lens)
**Status:** Definitional and structural. Like the Three-Lens library, these patterns require **no test program** — they describe facts that are true by construction the moment the reader's context and the object's state are read together. Nothing here predicts.
**Companion artifacts:** the **Three-Lens Pattern Library** (the sibling this sits beside, same register), the **Findings Map** (the Label/Signal/Read/Tool/Doesn't-mean vocabulary), the **Sections 2 & 5 Rules Spec** (the R/P/B–I firing engine this *consumes*), the **Portfolio Health Score Mechanism Spec** (the PHS/PF families this consumes), the **Health Hub Data Bank** (the scope/delta engine whose primitives this reuses), and the **Product Soul document** (the platform laws this inherits without exception).

**What this document is.** The complete catalog of every pattern that arises from the *relationship between a reader and an object*, plus the rules that decide which of them speaks. It is the brief the engine holds to resolve these patterns, the brief the Overview card holds to render them, and the brief the AI layer holds to read them. It defines the families, the reader model, the mode grid, the arbitration ladder, the storage, the boundary, and the extension contract.

**What it deliberately is not.** It is not a UI specification. Slot *shapes* are defined because they are structural (they determine arbitration); pixels, tokens, and layout are downstream.

---

# PART I — THE FOUNDATIONS

*Read first. These govern everything below and resolve most questions the catalog raises.*

---

## 0.1 · What this is: the fourth lens

Vytal already reads every scored metric three ways:

| Lens | Reference point |
|---|---|
| **L1 — Absolute** | the data-derived bar |
| **L2 — Peer** | the peer-group distribution |
| **L3 — Trend** | the stock's own history |

This library adds one:

| Lens | Reference point |
|---|---|
| **L4 — Reader** | **this user's own book, watchlist, peer-group exposure, and prior attention** |

That framing is load-bearing, not decorative. It means this family is **the existing spine extended by one reference point**, not a new kind of object bolted onto the page. It therefore inherits every lens law already written: descriptive only, definitional not predictive, honest-empty over fabricated, states over numbers, no advice.

`L4` is the only lens whose reference point is not a property of the market. Everything that follows is downstream of that single difference.

## 0.2 · The philosophy: summary vs overview

**A summary compresses the object. An overview orients the reader.**

Compression is reader-independent — every user should get the same summary, and correctly so. Orientation cannot be reader-independent. From which follows the test this entire library exists to pass:

> **If two different users see the same overview, it is not an overview.**

By that test, no product in this market ships an overview, including Vytal today. What is universally called "overview" is a digest of other sections under a different word: some numbers from fundamentals, a health band, a headline. Useful, and not an overview.

The overview this library produces answers a question the rest of the platform cannot ask: **given everything true about this object, what does *this reader* need to know about it first?**

## 0.3 · The two jobs (they are structurally different)

The library does exactly two things. Keeping them distinct prevents most failure modes.

**Job 1 — Author join facts.** Your weight in this name. Your peer-group exposure. Your echo arithmetic. Your dual-route holding. These exist **nowhere else in the platform**; only a reader-relative layer can produce them. This is genuinely new content, and because it exists nowhere else, it cannot contradict anything.

**Job 2 — Elevate existing truths by relevance.** No new content whatsoever. The platform already knows everything true about the object. This job is the *decision* that this fired flag matters more to this reader, right now, than the three other true things competing for the slot.

Job 2 is the larger half and the half that generalizes to every other page.

## 0.4 · Guaranteed-resolve, not conditional-fire

Every other family in Vytal is **conditional-fire**: rules evaluate, some fire, density is itself the triage signal, and an empty set is a legitimate and informative outcome.

This family is **guaranteed-resolve**. The card is always present. The engine must always terminate on something true and worth saying.

Three consequences, all binding:

1. **Every mode must have a floor** — an entry that is intrinsically valuable, not a consolation prize. A floor that reads as filler destroys the card, because it occupies the most valuable real estate on the page on every visit.
2. **The floor differs by mode.** Orientation is the right floor for a stranger and an insult to a holder. Position is the right floor for a holder and unavailable to a stranger. There is no single universal floor.
3. **Absence of *findings* is never absence of *card*.** "Nothing is flagged on this stock" and "nothing has changed since Tuesday" are both true, useful sentences. They are **header states over a full body**, never empty states.

## 0.5 · Conditions vs events — the primitive that replaces "seen"

**A fired finding is not news. It is a condition.** Conditions are not consumed by being read; they stand until the underlying fact changes.

Any mechanism that marks a finding "seen" and then drops it makes the card **lie about the object's state**, and it lies worst to the user who checks most often. Slate-cleaning is therefore prohibited outright.

What replaces it: every catalog entry and every consumed finding is classified by **temporal class**, and the class is a property of the *fact*, not of our guess about whether anyone looked.

| Temporal class | Behaviour | Gets duration? | Ages out? |
|---|---|---|---|
| **CONDITION** | Stands while the underlying fact holds | **Yes** — `standing_since` | No |
| **TRANSITION** | A change between two snapshots | No | Yes — at the next snapshot |
| **CLOCK-EVENT** | Happened at a point in time | No | Yes — at a declared day horizon |

And therefore:

> **Novelty is an annotation, never a gate.**

Every resolved item carries `standing_since`, `is_new_since_last_look`, and `temporal_class`. `last_viewed_at` exists **only** to compute the novelty marker. It **never removes anything from the card.**

**Explicitly killed:** the per-user "surfaced ledger" (a record of which findings a user has been shown). It is unnecessary under this model, it would require tracking we do not do, and it is the mechanism by which the card would start lying. Do not build it.

**Corollary — duration is free and currently discarded.** `score_patterns` is append-only, foreign-keyed to snapshots, with a `supersedesId` chain. First-fire date and unbroken-run length are therefore derivable from history the platform already holds. Nothing in Vytal today states *how long* a thing has been true. "Pledging above 50%" and "pledging above 50% for four straight quarters" are different reads and the second is strictly more honest. Duration is also the safest available way to convey weight without ever tipping into a call.

## 0.6 · Attention is a router, never content

Behavioural signals — visit counts, tabs opened, AI-chat topics — determine **which mode resolves and which entries are eligible**. They are **never rendered as facts about the user.**

- ✅ "One thing you haven't looked at: ownership — that's where the movement is."
- ❌ "You've opened this page 9 times in the last 6 weeks."

The second is behaviour-mirroring. It is what every engagement-optimised product does, it shames or nudges, and it is the manipulative form of personalisation. The honest use of attention data is to change *which card wins*, never to *be* the card's content.

This is enforced structurally: **UA (Attention) is a router namespace and emits no cards.** There is no code path from an attention signal to rendered copy about the user's behaviour. The one permitted expression of a depth signal is a *pointer to unread content*, where the rendered content is the finding at the destination, not the reading history.

## 0.7 · Consume as data; never re-derive; never enumerate

Three rules that together decide whether this library survives its own growth.

**Consume as data, not as sentences.** The layer reads `patternKey`, `family`, `severity`, `direction`, `evidence` (structured), `standing_since`, `temporal_class`. It **never parses a rendered verdict string.** The moment it does, the frontend-duplicate problem has been rebuilt one layer deeper.

**Never re-derive.** Compute-once/read-everywhere is a platform law and this layer is its largest test. The relational library computes exactly two classes of new fact: join facts (§0.3 Job 1) and the selection decision. Everything else it reads from the existing engines. It never recomputes a score, a band, a pillar, a finding, a PHS construction rule, or a lens state.

**Never enumerate pattern IDs.** This is the extension contract and it is absolute. If this library contains a list of consumed IDs — "R1, R2, C1, P11…" — then every new pattern requires editing this library, and it rots the day someone ships the next one. The layer operates on **properties**: severity class, family, temporal class, direction, polarity, base rate. A new pattern arriving with those attributes flows through arbitration, echo, and duration with **zero changes to relational code**.

The single exception, tightly bounded: §3.6 `UG9` may reference the *not-evaluable* set, because evaluability is a property the engine publishes per rule. It reads the property, not a hardcoded list.

### 0.7.1 · Magnitude is never a relevance input

The engine's namespaces carry a hard invariant: **`P` and `R` may affect the health score; every other family is display-only** (`magnitude: null`). Sixteen of the twenty-seven stock-level entries already carry null magnitude, and all escalated lens findings do.

The relational layer must **never read `magnitude`, and never let it influence rung, order, or relational weight.**

The reason is not stylistic. A pattern's magnitude answers *"how much should this move the score,"* which is a question about the model. Relevance answers *"how much does this reader need to know this,"* which is a question about the reader. A display-only finding — a divergence, a band transition, a field verdict, a recovery — can be the most important thing on a reader's card while moving the score by nothing at all. Weighting by magnitude would silently rank the model's concerns above the reader's.

Relevance is built from **severity, position, exposure, novelty, and duration**. Not magnitude.

## 0.8 · The advice boundary under maximum pressure

Every existing pattern family describes an object. This family describes a reader's *position* and then shows them the object. That is implicitly a recommendation even when every individual word is descriptive. The boundary must therefore be tighter here than anywhere else in the platform, and the breach point is arithmetic, not adjectives.

**The rule:**

> **A relational pattern may state the reader's existing exposure and the object's existing properties. It may never model a transaction the reader has not made.**

| Verdict | Sentence |
|---|---|
| ✅ Legal | "Cement is roughly 31% of your book — three companies." *(fact about the book)* |
| ❌ Illegal | "Adding this would take you to 41%." *(models an unmade trade)* |
| ❌ Illegal | "You may want to reduce here." *(advice)* |
| ❌ Illegal | "Your exposure is too high." *(verdict on the reader's decisions)* |
| ✅ Legal | "Above the 25% level at which we mark a single pond as concentrated." *(states our own declared threshold)* |

The illegal ones will feel like the most useful sentences on the card. They are the ones that reclassify Vytal as an advisor.

**Additional binding prohibitions specific to this family:**

- **No P&L adjacency.** The card may state position *value* and *weight*. It may **never** state gain, loss, return, or cost basis — and in particular must never place any return figure adjacent to a health score, band, or finding. Never juxtapose health against price or returns is an existing platform law; this card is the single most likely place to break it, because position value and health both belong here naturally and returns feel like they do too. They do not.
- **No reader ranking or comparison.** Never compare this reader to other readers, to averages of other readers, or to any cohort. No "most investors hold…", no percentiles of users.
- **No engagement mechanics.** No streaks, no "you haven't checked in a while, take a look," no urgency framing, no counts of unread items as a badge.
- **No inference of intent.** Repeated visits are not "considering buying." Watchlist membership is not intent to purchase. Opening a page is not evaluating a trade. The engine may serve *picture-completion* without ever naming a purpose.

## 0.9 · Inheritance from platform law (restated, binding)

Without exception, this library inherits:

- **No buy/sell signals, no price targets, no predictions.**
- **Honest-empty beats fabricated.** Null is acceptable; wrong never is. A missing input produces an honest state, never a pass, a fail, or an invented value.
- **Never juxtapose health scores against price or returns.** (See §0.8.)
- **Compute-once/read-everywhere.** No parallel derivation of any fact the platform already computes.
- **Never render raw enums, IDs, UUIDs, or ISINs** to users. This includes `patternKey`, `familyOf` values, account UUIDs, and instrument IDs. Account names are user-authored and may be shown; account *identifiers* may not.
- **Never declare a comparison winner.** Peers held are listed, never ranked as better or worse than the object.
- **Available data does not mean it should be added.**
- **Legally a data platform, not an advisor.**
- **Two-hero rule** where Health and Construction both appear: never summed, never averaged, never one as a fallback for the other.

## 0.10 · Voice: one page, one thesis

An always-present hero card becomes the page's thesis statement. If it authors its own verdicts about the object, the page has two voices and no mechanism to reconcile them.

> **The relational layer contributes join facts and elevates existing findings. It authors no object verdicts.**

"This fired, and you hold ₹2.4 lakh of it" — the *sentence* is about the ownership; what the flag *means* remains owned by the flag's own card further down the page. When elevating, the card uses the finding's own claim line; it does not re-interpret it, soften it, sharpen it, or add consequence.

Join facts are the sole exception and legitimately so: they exist nowhere else on the page, so they cannot contradict anything.

## 0.11 · Register and precision

**Register.** The card's claims are **tone-invariant**: they are facts with numbers, and a fact with a number reads correctly to a beginner and does not patronise an expert. "Operating margin has been falling for three quarters" needs no register variant.

What *is* tone-dependent is **the gloss** — the short definition attached to an unavoidable term. "Receivables — money billed but not yet collected."

> **The claim is tone-invariant. The gloss is tone-dependent.**

| `aiLevel` | Gloss behaviour |
|---|---|
| `plain` | Gloss shown for any term outside everyday language |
| `balanced` | Gloss shown for less-common terms only |
| `technical` | Gloss suppressed entirely |

Key variants on `aiLevel` (three), **not** on the resolved `(level, depth, jargon)` triple (seven). `depth` and `jargon` are generation directives for the AI layer; deterministic card copy does not need that resolution and authoring seven near-identical strings to express three registers is waste. Glosses live in one term→gloss map, authored once per term, not per pattern.

**Plain is the highest-risk register for advice drift.** Compression toward plain language pulls "Below bar — leads a weak field" toward "everyone else is worse, so it's fine," which is a verdict. `scanStringsForForwardLanguage` requires a plain-specific deny-list, and it must run over the **assembled output**, not the slot fragments — drift appears in composition, not in the pieces.

**Precision rules (inherited, non-negotiable):**

- Scores are whole numbers. "about 71", never "70.82".
- Percentages are approximations. "roughly 8%". A nonzero value rounding to zero renders `<1%`, never `0%`.
- Money uses Indian convention via `formatINR`: `₹2.4 lakh`, `₹18,000`, `₹40 crore`.
- Never introduce precision that was not in the source.
- Durations round to the underlying cadence: quarters for fundamentals ("for three quarters"), months or named months for longer spans ("since last October"), days only for clock-events ("in June").
- Counts of the reader's own holdings are exact. "3 of your 7 holdings" — never "roughly a third of your holdings."

---

# PART II — THE READER MODEL

---

## 1.1 · The primitive that generalises

What carries across pages is not the card. It is the **reader model** — the resolved understanding of one reader's relationship to whatever object is in front of them.

```
ReaderContext × Object → RelationalState
```

`ReaderContext` is constant across surfaces. `Object` varies: stock, peer group, fund, screener row, comparison pair. Build the resolution once; let each surface decide its own presentation. This dissolves the "must every page share a structure" question: **shared model, per-surface rendering.**

**v1 scope: `Object = stock`.** The model is defined generically; only the stock resolver is built. §7.4 defines what a new object type owes.

## 1.2 · ReaderContext — the resolved input object

Resolved server-side, once per request, cached per §5.4.

```
ReaderContext {
  identity: {
    userId: string | null            // null = anonymous
    isAuthenticated: boolean
    aiLevel: "plain" | "balanced" | "technical"   // never null; default balanced
  }

  book: {                            // null if no portfolio connected
    exists: boolean
    accountCount: int
    scoredHoldingsCount: int         // holdings with an in-force health snapshot
    totalHoldingsCount: int
    unscoredHoldingsCount: int
    unresolvedHoldingsCount: int     // broker rows not matched to an instrument
    totalValue: Money
    typicalPositionValue: Money      // median position value; basis for UH4
    holdings: [{
      instrumentId, entityStem,      // entityStem = ISIN stem (entity aggregation law)
      displayLabel,                  // via displayLabel(holding) — never raw ISIN
      value, weightPct,
      accountLabels: string[],        // user-authored names, never IDs
      isScored, peerGroupId, sectorId,
      route: "direct" | "fund_lookthrough" | "both"
    }]
    pgExposure: [{ peerGroupId, weightPct, memberCount, heldNames: string[] }]
    sectorExposure: [{ sectorId, weightPct }]
    lookThroughAvailable: boolean    // false ⇒ UH5 cannot fire, UG5 fires instead
    firedFindingsByHolding: Map<instrumentId, FiredFinding[]>   // persisted only
    latestPhsSnapshot: PhsSnapshot | null
  }

  watchlist: {
    exists: boolean
    count: int
    members: [{ instrumentId, addedAt, peerGroupId, sectorId }]
  }

  attention: {                       // ROUTER ONLY — never rendered (§0.6)
    hasHistory: boolean              // false on first-ever session
    firstViewedAt: datetime | null
    lastViewedAt: datetime | null
    viewCount: int
    viewCountTrailing30d: int
    surfacesSeen: Map<surfaceKey, { count, lastAt }>
    lastViewedSnapshotGeneration: string | null   // what snapshot was in force then
  }

  discussion: {                      // ROUTER ONLY — never quoted (§0.6)
    hasDiscussed: boolean
    topicTags: string[]              // derived tags, e.g. ["ownership","margins"]
    lastDiscussedAt: datetime | null
  }
}
```

## 1.3 · The object side

```
ObjectState {
  kind: "stock"
  instrumentId, entityStem, displayLabel
  isScored: boolean
  coverage: { state, provisional: boolean, reason: NullReasonClass | null }
  snapshot: {
    generation, asOfDate, composite, band,
    pillars: { foundation, momentum, market, ownership } with native zones,
    trajectoryMarker
  } | null
  peerGroup: { id, label, memberCount, health, trajectory, dispersion, maskHeat,
               firedFindings: FiredFinding[] } | null   // PG-native patterns
  sector: { id, label, sectorClass } | null
  firedFindings: FiredFinding[]      // persisted; with standing_since + temporal_class + polarity
  notEvaluable: [{ ruleRef, reason }]  // rules that declined, distinct from rules that returned false
  readTimeLensFaces: LensFace[]      // quiet LM/LP — this object only (§5.6)
  events: { blockDeals[], insiderTxns[], corporateEvents[], news[] }  // with dates
  priceFreshness: { lastPriceAt, isStale }
}
```

## 1.4 · The output object

```
RelationalState {
  mode: ModeId
  header: { entryId, claim, gloss? }
  slots: [ResolvedEntry]              // ordered, capped per mode
  overflow: [ResolvedEntry]           // full standing set, available on expand
  negatives: [NegativeFact]           // for the AI layer (§6.2)
  meta: { resolvedAt, snapshotGeneration, lastLookLabel, degradations: [] }
}

ResolvedEntry {
  entryId                             // e.g. "UH1", "UE1", or "ELEVATED:<opaque ref>"
  family                              // UO | UH | UN | UD | UE | UG | ELEVATED
  claim: string                       // the rendered sentence
  gloss: string | null                // per aiLevel
  temporalClass: CONDITION | TRANSITION | CLOCK_EVENT
  standingSince: { label, snapshotCount } | null
  isNewSinceLastLook: boolean
  weight: { ladderRung: int, relationalWeight: float }   // self-describing (§6.3)
  arithmetic: object | null            // structured numbers behind the claim
  doesntMean: string
  sourceRef: opaque                    // stable reference for the AI/telemetry; never rendered
}
```

**`sourceRef` is opaque.** It permits telemetry and AI cross-reference without exposing `patternKey` to any renderer, satisfying §0.9.

---

# PART III — THE MODE GRID

---

## 2.1 · The two axes

**Position axis** — the reader's relationship to *this exact object*:

| Value | Resolution rule |
|---|---|
| `HELD` | ≥1 holding resolving to this `entityStem`, by any route, value > 0 |
| `WATCHED` | in watchlist, not held |
| `NEITHER` | neither |

Resolution order: **HELD dominates.** If held *and* watchlisted, position is `HELD` and watchlist membership becomes a minor note, never a mode driver. Peer holdings do **not** affect the position axis — that is Neighbourhood (§3.3).

Edge: a position that existed historically and is now zero resolves to `NEITHER` with `UH8` eligible (exited since last look) — an exited position is not a position.

**Attention axis** — the reader's prior contact with this object:

| Value | Resolution rule |
|---|---|
| `FIRST` | `viewCount == 0` (this is the first view) or `!attention.hasHistory` |
| `RETURNING` | `viewCount ≥ 1`, `viewCountTrailing30d < RECURRING_MIN_VIEWS_30D`, gap < `DORMANT_GAP_DAYS` |
| `RECURRING` | `viewCountTrailing30d ≥ RECURRING_MIN_VIEWS_30D` |
| `DORMANT` | `now − lastViewedAt ≥ DORMANT_GAP_DAYS` |

`DORMANT` outranks `RECURRING` outranks `RETURNING`. `FIRST` is exclusive.

## 2.2 · The twelve modes

| | `FIRST` | `RETURNING` | `RECURRING` | `DORMANT` |
|---|---|---|---|---|
| **HELD** | **M1** Unexamined holding | **M2** Holding delta | **M3** Holding watch | **M4** Holding dormant-return |
| **WATCHED** | **M5** Untouched watch | **M6** Watch delta | **M7** Active tracking | **M8** Watch dormant-return |
| **NEITHER** | **M9** Stranger | **M10** Light delta | **M11** Picture completion | **M12** Cold return |

**M1 is the most valuable cell in the system.** Broker sync means readers hold names they have never opened. Nothing else in the product can say "you own ₹2.4 lakh of this, you have never read it, and here is the one thing standing." It is first-class by being its own mode, and it is common the moment a book is synced rather than hand-entered.

**M11** serves picture-completion without inferring intent (§0.8). Repeated visits with no position mean the reader is assembling a picture; the engine surfaces the consequential thing they have not reached. It never names a purpose.

## 2.3 · Per-mode shape, floor, and cap

Density is **a property of the mode**, not a global dial. Some modes are naturally listy; some are two sentences.

| Mode | Header state | Floor (always resolves) | Shape | Cap |
|---|---|---|---|---|
| **M1** | "You own this — first time you're reading it" | `UH1` position | position → top standing item (with duration), else `UO6` strength if nothing negative stands → one of {UN, UE, UG, "nothing else flagged"} | 3 |
| **M2** | "New since {lastLookLabel}" | `UD7` if no delta → falls to M3 shape | the new item(s) → position → already-standing list (≤2, with duration) | 4 |
| **M3** | "Nothing new since {lastLookLabel}" | `UH1` + standing list, **where the standing list includes `UO6`** | standing list (≤3, with duration, positive and negative together) → position | 4 (listy) |
| **M4** | "You haven't looked at this since {date}" | aggregated delta across the gap; `UH1` if none | gap-aggregated delta → position → standing list | 4 |
| **M5** | "On your watchlist since {addedLabel} — first time you're looking" | what has happened since `addedAt` | since-added delta → top standing item → explicit not-held note | 3 |
| **M6** | "New since {lastLookLabel}" | `UD7` → falls to M7 shape | the new item(s) → standing list | 3 |
| **M7** | "Since you last looked" | standing list | standing list (≤2) → depth pointer if available | 3 |
| **M8** | "You haven't looked at this since {date}" | gap-aggregated delta | as M4 without position | 3 |
| **M9** | "New to you" | `UO1` + `UO2` + `UO4` | what it is → health plainly → flags state → connection-to-your-book state | 4 |
| **M10** | "Since you last looked" | `UD7` → falls to M9 shape | delta → compressed orientation | 3 |
| **M11** | "One thing you haven't looked at" | depth pointer; `UO2` if unavailable | unread-surface pointer (rendering the *finding there*) → top standing item | 2 |
| **M12** | "You haven't looked at this since {date}" | gap-aggregated delta; `UO2` if none | gap delta → compressed orientation | 3 |

**Header fallback chain.** When a mode's header state cannot resolve (e.g. M2 with no delta), the mode **falls to its no-delta sibling's shape** and header. It never renders an empty header. Fallbacks: M2→M3, M6→M7, M10→M9, M4→M3, M8→M7, M12→M9.

**The stability rule (binding).** Within a mode, slot *order* is determined by the ladder (§4) and must be **stable across visits when the underlying state is unchanged**. A card that reshuffles between visits cannot be trusted, and familiarity with a name is built precisely by a stable shape with new things marked. Novelty markers and duration labels change; ordering does not, unless the state did.

---

# PART IV — THE FAMILIES

*Namespace `U`. All single letters and `LM`/`LP`/`P*`/`R*`/`C*`/`P[A-X]*` are taken by existing catalogs.*

*Each entry: **State** (fire condition) · **Inputs** · **Temporal class** · **Copy skeleton** · **Doesn't mean** · **Honest-empty**. Copy skeletons are templates, not final strings; `{}` are substitutions. Claim lines are tone-invariant per §0.11.*

---

## 3.1 · UO — Orientation
*What this object is, to a reader who does not know it. The floor for the unpositioned.*

### UO1 · What this is
- **State:** always resolvable when `sector` and `peerGroup` are present. Eligible in M9–M12.
- **Inputs:** `sector.label`, `sectorClass`, `peerGroup.label`, `peerGroup.memberCount`.
- **Temporal:** CONDITION (no duration rendered — identity, not a state).
- **Copy:** `{business description}. Sits in a peer group of {memberCount} {peerGroup.label}.`
- **Doesn't mean:** identity and grouping only; the peer group is the fair comparison set, not a quality tier.
- **Honest-empty:** no PG assigned → state the sector alone and add "not yet placed in a peer group."

### UO2 · Health, plainly
- **State:** `isScored` and `snapshot` present.
- **Inputs:** `composite`, `band`.
- **Temporal:** CONDITION. Duration eligible (band standing since).
- **Copy:** `Health is about {composite} — {band descriptor}.`
- **Doesn't mean:** higher is not a better investment, not more upside, not a prediction. Higher means sounder and calmer, and already priced.
- **Honest-empty:** not scored → suppress; `UG1` carries it.

### UO3 · Flags state
- **State:** always, when scored.
- **Inputs:** count of fired findings by severity and polarity; the `notEvaluable` set.
- **Temporal:** CONDITION.
- **Copy (nothing fired, full evaluation):** `Nothing flagged.`
- **Copy (nothing fired, rules declined for depth):** `Nothing flagged — though {n} check{s} {needs/need} more history than this stock has yet.`
- **Copy (fired):** `{N} thing{s} standing.` — counted by **concern**, not by polarity. A positive finding is not "a thing standing."
- **Doesn't mean:** nothing flagged is not an endorsement; a flag is a place to look, not a verdict.
- **Why the second variant exists:** "nothing flagged" on six quarters of history is a weaker claim than the same words on five years, and the card must not present them identically. Requires the engine's `not_evaluable` / `not_fired` distinction (§5.2). Without it, only the first variant is available and the entry must not imply completeness.

### UO4 · Connection to your book — the honest null
- **State:** `NEITHER` position AND no PG overlap AND no sector overlap AND no echo.
- **Inputs:** `book`, `watchlist`, `pgExposure`.
- **Temporal:** CONDITION.
- **Copy:** `Nothing in your portfolio or watchlist connects to this name or this peer group.`
- **Doesn't mean:** absence of connection is not a reason to acquire one. It is a statement about the reader's current book, nothing more.
- **Why it exists:** it is the honest floor of the stranger mode and it is genuinely useful — it tells the reader the card has nothing reader-specific to offer, rather than manufacturing a connection.
- **Honest-empty:** no book connected → `UG7` replaces it.

### UO5 · Coverage note
- **State:** `coverage.provisional` or `isScored == false`.
- **Delegates to:** `UG1` / `UG2`. Present here only as an eligibility marker in orientation modes.

### UO6 · Standing strength
- **State:** the object carries **positive-polarity standing state with duration** — a sustained-soundness finding, a positive pillar-level lens read, or all-metrics-clearing-bars held over ≥`UO_STRENGTH_MIN_SNAPSHOTS`. Requires `standing_since` (§5.2).
- **Inputs:** positive-polarity fired findings, pillar-level lens faces, `standing_since`.
- **Temporal:** CONDITION.
- **Copy:** `{strength claim} — {duration}.` e.g. `Clears every bar it's measured against — has for six quarters.` / `Broad strength across its balance-sheet metrics, held for five quarters.`
- **Doesn't mean:** **already-strong is already priced.** Sound, and sound for a while, is not upside, not a forecast of continuation, and not a buy. Inherited verbatim from the Findings Map's composite boundary — this entry does not soften it.
- **Honest-empty:** no positive-polarity finding, or `standing_since` unavailable → does not fire. **Never manufacture strength from an absence of flags** — "nothing flagged" is `UO3`, a different and weaker claim, and conflating them is fabrication.
- **Why duration is the carrier:** duration is a fact about persistence, not a projection. "Sound for six quarters" cannot be misread as a target the way a score can, and it is the only expression of strength that adds information the composite has not already given.
- **Duration source precedence:** where a finding carries its **own** run length in `evidence` — measured from the underlying data by the rule itself — that measure **wins over `standing_since`**, permanently and not as a fallback. "Profit has converted to cash for four straight years" is a fact about the company; "we have been showing this for two quarters" is a fact about our pipeline. `standing_since` is the correct source only for findings whose triggers are point-in-time and therefore cannot self-date (a divergence gap, a band position, a zone crossing). **Consequence:** `UO6` resolves on any self-dating finding without waiting on the `standing_since` derivation.
- **Eligible in every mode, not just orientation.** A holder with nothing wrong deserves to be told what is right — that is the floor case for M3 and the second slot for M1. This is the entry that stops an always-present card from becoming permanently scolding.
- **Register discipline:** stated, dated, never celebrated. No "excellent", "quality", "well-positioned", "strong candidate", "impressive". The same restraint the risk entries carry, applied in the other direction.
- **Anti-double-count:** if the engine's own sustained-soundness finding fires, **it is the headline** and `UO6` becomes its duration detail, never a separate discovery (§4.5).

---

## 3.2 · UH — Holding
*The reader's position. The floor for holders. Join facts — authored here, available nowhere else.*

### UH1 · Your position — the floor
- **State:** position `HELD`. Always resolves.
- **Inputs:** aggregated value across accounts and routes for this `entityStem`; `weightPct`; `accountLabels`.
- **Temporal:** CONDITION.
- **Copy:** `{value} across {n} account{s}. About {weightPct}% of your book.` · single account: `{value} in {accountLabel}. About {weightPct}% of your book.`
- **Doesn't mean:** a statement of exposure, not of whether the exposure is right. No implication about adding, trimming, or holding.
- **Prohibited adjacency:** no return, gain, loss, or cost basis on this entry or anywhere on the card (§0.8).
- **Honest-empty:** value unavailable (unpriceable holding) → state units held and `UG3`/`UG5` as applicable; never fabricate a value.

### UH2 · Held across multiple accounts
- **State:** `accountLabels.length ≥ 2`.
- **Copy:** folded into `UH1` when ≤ 2 accounts; separate entry at ≥ 3: `Held in {n} accounts: {labels}.`
- **Doesn't mean:** account spread is bookkeeping, not diversification.

### UH3 · Position scale in your book
- **State:** `weightPct ≥ UH_LARGE_POSITION_PCT`, or the position is among the reader's top `UH_TOP_N` by value.
- **Copy:** `Your {ordinal}-largest position.` or `About {weightPct}% of your book — above the {UH_LARGE_POSITION_PCT}% level at which we mark a single name as heavy.`
- **Doesn't mean:** naming a threshold we declared is not a judgement on the reader's allocation and not a suggestion to change it.
- **Note:** thresholds must be attributed to Vytal ("the level at which we mark…"), never phrased as an external norm.

### UH4 · Position scale vs your typical position
- **State:** `book.scoredHoldingsCount ≥ UH_TYPICAL_MIN_HOLDINGS` and `value ≥ UH_TYPICAL_MULT × typicalPositionValue` (or ≤ its inverse).
- **Copy:** `Larger than your typical position ({typicalValue}).` / `Smaller than your typical position.`
- **Doesn't mean:** typical is descriptive, not a target.

### UH5 · Held two ways (direct + fund look-through)
- **State:** `route == "both"` AND `book.lookThroughAvailable`.
- **Inputs:** direct value; look-through value via `entityStem`; combined weight.
- **Temporal:** CONDITION.
- **Copy:** `Directly: {directValue}. Through your {fundLabel} holding: roughly another {ltValue}. Together, about {combinedPct}% of your book — higher than the {directPct}% your direct holding alone suggests.`
- **Doesn't mean:** holding by two routes is a measurement fact about total exposure, not a duplication error and not a reason to change either holding.
- **Honest-empty:** `lookThroughAvailable == false` → **do not fire**; `UG5` fires instead. Never imply single-route exposure is the whole picture when look-through is unavailable.
- **Entity basis:** aggregation via ISIN stem, per the entity-aggregation law. `Neff`-style counts elsewhere use entity-aggregated units; this entry must use the same basis.

### UH6 · First read of a held name
- **State:** position `HELD` AND attention `FIRST`. **This is M1's header, not a body entry.**
- **Copy:** header — `You own this — first time you're reading it.`
- **Doesn't mean:** nothing about the reader's diligence. It is a statement about what this card is about to do.
- **Note:** the only permitted expression of an attention signal that references the reader's contact with the object, and it is permitted because it is *framing what follows*, not reporting behaviour. It states a binary (first time), never a count.

### UH7 · Position changed since last look — added
- **State:** transactions resolving to this `entityStem` dated after `lastViewedAt`, net positive.
- **Temporal:** CLOCK-EVENT, horizon `UH_TXN_HORIZON_DAYS`.
- **Copy:** `You added to this position in {monthLabel}.`
- **Doesn't mean:** a record of what the reader did, with no view on whether it was right.

### UH8 · Position changed since last look — reduced or exited
- **State:** as UH7, net negative; or position now zero with prior non-zero.
- **Copy:** `You reduced this position in {monthLabel}.` / `You exited this position in {monthLabel}.`
- **Doesn't mean:** as UH7. Never followed by any statement about what has happened since, framed as consequence.
- **Prohibition:** must never be paired with a subsequent performance statement. "You exited in June" followed by anything about price or health movement since would be an implicit verdict on the reader's decision. Structurally forbidden: `UH8` suppresses all price-linked entries in the same card.

### UH9 · Sliver position
- **State:** `weightPct < UH_SLIVER_PCT` AND `value < UH_SLIVER_VALUE`.
- **Copy:** folded into `UH1` as `{value}, under 1% of your book.`
- **Effect on arbitration:** reduces `relationalWeight` (§4.3) — a loud finding on a sliver should not outrank a mild one on a large holding by relational weight alone.
- **Doesn't mean:** small is not unimportant; it is small.

### UH10 · Held but not scored
- **State:** position `HELD` AND `isScored == false`.
- **Delegates to:** `UG1` for the reason. `UH1` still fires (position is knowable without a score).
- **Copy pairing:** `{position}. We don't score this stock yet: {reason}.`
- **Doesn't mean:** unscored is not a judgement on the stock; it is a statement about our coverage. Honest-empty over fabricated.

---

## 3.3 · UN — Neighbourhood
*Peer-group and sector proximity. "Is this pond already crowded in my book?"*

### UN1 · Your weight in this pond
- **State:** `pgExposure` for this object's PG > 0.
- **Inputs:** PG weight %, held names in PG, PG member count.
- **Temporal:** CONDITION.
- **Copy:** `{peerGroup.label} is roughly {pct}% of your book — {n} compan{y/ies}: {names}.`
- **Doesn't mean:** exposure is a measurement, not a verdict on concentration and not a suggestion to change it. Names are listed, never ranked (§0.9).
- **Honest-empty:** PG unassigned → suppress; sector exposure may fire instead (`UN7`).

### UN2 · Pond concentration threshold
- **State:** PG weight ≥ `UN_PG_NOTABLE_PCT` (notable) or ≥ `UN_PG_HEAVY_PCT` (heavy).
- **Copy:** `Above the {threshold}% level at which we mark a single peer group as {notable/heavy} in a book.`
- **Doesn't mean:** our declared threshold, not an external norm and not advice. **This is the entry that most invites the illegal sentence** — never state what the weight would become if this stock were added (§0.8).
- **Anti-double-count:** if the reader's PHS already fires a concentration finding (PC-family sector/entity concentration), **defer** — the PHS finding is the headline, `UN2` becomes its stock-page echo and must not restate it as a separate discovery. See §4.5.

### UN3 · Peers in your watchlist
- **State:** ≥1 watchlist member shares this PG, and not already covered by `UN1`.
- **Copy:** `{n} name{s} in this peer group {is/are} on your watchlist: {names}.`
- **Doesn't mean:** watchlist membership is not intent (§0.8).

### UN4 · This pond's own condition
- **State:** the peer group carries a fired PG-native finding **or** a `PGState` health/trajectory state, AND the reader has exposure to this PG (via holdings or watchlist).
- **Inputs:** `peerGroup.firedFindings` (preferred), else PG health band + trajectory; `standing_since`.
- **Temporal:** inherits the PG finding's class; CONDITION when derived from `PGState`.
- **Copy:** the PG finding's own claim, or `This peer group as a whole has been {under pressure / firming} since {label}.`
- **Doesn't mean:** a pond read is prospecting context, never a rotation call and never a statement that its members will move together in price.
- **Gating:** fires only with reader exposure. Without exposure it is stock-page context, not relational content, and belongs to the PG surface.
- **Precedence:** a fired PG finding **always** leads over a `PGState`-derived sentence — the finding is authored, dated, and carries its own boundary; the derived sentence is our paraphrase of two fields. Where PG-native patterns exist, the derived form is a fallback only.
- **Field-verdict note:** PG-level field-wide-weakness and elite-field findings are the aggregated form of the field-verdict lens story. When one fires **and** the reader is heavily exposed to that PG, this is the strongest legitimate statement the card can make about a reader's structural position — and it must still stop at description.

### UN5 · Pond weather (mask)
- **State:** `peerGroup.maskHeat` is hot or stressed.
- **Temporal:** CONDITION.
- **Copy:** appended as a caveat to price-linked entries only — `The pond is hot — price-linked reads may be deferred; look for the catalyst.`
- **Doesn't mean:** a hot pond is not a top, not a sell, not a regime forecast. A humility flag.
- **Note:** not a slot-consuming entry. It is a **modifier** on price-linked entries, exactly as in the Rules Spec. Non-price entries are unaffected.

### UN6 · Shared pattern within the pond you hold
- **State:** ≥`UN_POND_SHARED_MIN` of the reader's held names in this PG fire the same `patternKey` as this object.
- **Temporal:** CONDITION.
- **Copy:** `{n} of {them} {is/are} showing the same thing this one is: {finding claim}.`
- **Doesn't mean:** shared conditions within a peer group are common by construction — peers face the same field. Not a prediction that they move together.
- **Relationship to UE:** `UN6` is *within-pond* and therefore expected; the `UE` family is *whole-book* and carries its arithmetic. `UN6` requires neither share nor lift qualification because same-pond co-occurrence is definitionally likely — but it must **never** be phrased as significant. It states a count and stops.

### UN7 · Sector exposure (distinct from pond)
- **State:** sector weight ≥ `UN_SECTOR_NOTABLE_PCT` AND sector ≠ PG (a sector may span several PGs).
- **Copy:** `{sector.label} more broadly is roughly {pct}% of your book.`
- **Doesn't mean:** sector and peer group are different cuts; sector spread is not the same as fair-comparison spread. **Never present the two numbers as if one corrects the other.**
- **Note:** PHS already distinguishes sector dominance from breadth (C3/C4 and PB7 "false sector spread"). If PHS fires `PB7` for this reader, defer to it.

### UN8 · No pond connection
- **State:** PG exposure zero AND no watchlist peers.
- **Delegates to:** `UO4` in orientation modes. In `HELD`/`WATCHED` modes it renders as `No other holdings in this peer group.`
- **Doesn't mean:** as `UO4`.

---

## 3.4 · UD — Delta
*What changed since the reader last looked. Annotation-driven; never removes anything (§0.5).*

### UD1 · Newly standing finding
- **State:** a fired finding whose `standing_since` is after `lastViewedAt`.
- **Inputs:** finding claim, severity, `standing_since`, `temporal_class`.
- **Temporal:** inherits the finding's class.
- **Copy:** the finding's own claim line, marked new. `{finding claim}` + new-marker.
- **Doesn't mean:** inherits the finding's own `doesnt_mean` verbatim. The relational layer adds none (§0.10).

### UD2 · Finding no longer standing
- **State:** a finding present at `lastViewedSnapshotGeneration` and absent now.
- **Temporal:** TRANSITION.
- **Copy:** `{finding claim} — no longer showing as of {snapshot label}.`
- **Doesn't mean:** a condition ending is not a resolution, an improvement verdict, or a signal. It ended; why it ended is the finding's own business.
- **Why it exists:** without it the card only ever accumulates negatives, which is dishonest in the opposite direction.
- **Anti-double-count:** where the engine emits its own **flag-cleared** finding for the same item, that finding is the headline and `UD2` defers — the engine's version is authored, dated, and available to readers whose last look predates the clearance. `UD2` remains the only path for items the engine does not track as cleared.

### UD3 · Band crossed
- **State:** composite band differs from the band in force at `lastViewedAt`.
- **Temporal:** TRANSITION.
- **Copy:** `Health has {moved up / slipped} {a band / out of {band}} — {first time in {span} / since {label}}.`
- **Doesn't mean:** a band crossing is a health-state change, not a price event and not a call. Inherits the band's own boundary language.

### UD4 · Pillar zone crossed
- **State:** any pillar crossed its native weak/strong mark since `lastViewedAt`.
- **Temporal:** TRANSITION.
- **Copy:** `{Pillar} has {crossed into / fallen below} its {strong/weak} zone.`
- **Anti-double-count:** suppressed when `UD3` fires for the same direction and the pillar is the cause — the band crossing is the headline.

### UD5 · Event since last look
- **State:** block deal / insider transaction / corporate event dated after `lastViewedAt` and within its horizon.
- **Temporal:** CLOCK-EVENT.
- **Copy:** `{event description} in {monthLabel}.` — e.g. `Promoters bought about ₹40 crore of their own stock in June.`
- **Doesn't mean:** flow and event context, never a verdict and never a signal to follow.
- **Gating:** fires only where the feed is live. Where dormant → `UG9`.

### UD6 · News since last look
- **State:** news items dated after `lastViewedAt`, within `UD_NEWS_HORIZON_DAYS`, above a materiality classification.
- **Temporal:** CLOCK-EVENT.
- **Copy:** headline count and topic only: `{n} significant development{s} since — {topic labels}.`
- **Doesn't mean:** we surface that something was reported, not what it implies. **No summarisation, no sentiment, no interpretation** in this layer. The news surface owns the content.
- **Deferred to v2 if news materiality classification is not available.** Do not fabricate materiality.

### UD7 · Nothing new — the honest header
- **State:** no `UD1`–`UD6` resolves.
- **Temporal:** n/a (header state).
- **Copy:** `Nothing new since {lastLookLabel}.` optionally + `— expected at this cadence` when the gap is shorter than the fundamental refresh cadence.
- **Doesn't mean:** no change is not stability, not a verdict, and not an absence of things standing. The body carries what is standing.
- **The cadence clause matters.** Fundamentals step quarterly; price moves daily. A reader who checked yesterday had nothing fundamental change, and a delta card that finds something anyway is manufacturing motion. `UD_MIN_GAP_FOR_FUNDAMENTAL_DELTA` gates fundamental deltas; below it, `UD7` fires with the cadence clause and this is correct behaviour, not a failure.

### UD8 · First view — no delta possible
- **State:** attention `FIRST`.
- **Effect:** the entire UD family is **not evaluable**. Modes M1, M5, M9 therefore have no delta slot by construction. Never render "nothing new" to a first-time reader — there is no "last time."

### UD9 · New snapshot since last look
- **State:** `snapshot.generation != lastViewedSnapshotGeneration`.
- **Temporal:** TRANSITION.
- **Copy:** used as context on other deltas — `as of the {period} snapshot` — not a standalone slot except in M4/M8/M12 where it frames the aggregation.

### UD10 · Severity escalated
- **State:** a finding standing at `lastViewedAt` whose severity is now higher.
- **Temporal:** TRANSITION.
- **Copy:** `{finding claim} — now {severity descriptor}.`
- **Anti-double-count:** outranks `UD1` for the same finding; never both.

### UD11 · Pond changed since last look
- **State:** PG health band or trajectory changed since `lastViewedAt`, and reader has exposure.
- **Temporal:** TRANSITION.
- **Copy:** `This peer group has {moved} since you last looked.`

### UD12 · Gap-aggregated delta (dormant modes)
- **State:** attention `DORMANT`. Replaces individual `UD1`–`UD11` with an aggregation across the gap.
- **Copy:** `{n} things have changed since {date}: {compressed list, ≤3, severity-ordered}.`
- **Rule:** aggregation, not truncation — the count is of everything that changed, the list is capped. Overflow goes to `RelationalState.overflow`.

---

## 3.5 · UE — Echo
*Pattern co-occurrence between this object and the reader's book. Two independent axes — concentration and distinctiveness — and base rate selects which claim is true, never whether one is.*

### 3.5.1 · The two-axis law

Two different things were historically collapsed into one number, and collapsing them breaks the family:

| Axis | Question | Measure |
|---|---|---|
| **Concentration** | How much of *my book* is in this? | `observedShare` |
| **Distinctiveness** | Is my book unusual *versus the market*? | `lift` |

**Concentration stands entirely on its own.** "Six of your eight holdings are deteriorating" is the most important fact about that book regardless of what the market is doing. Lift can be 1.2 and it is still the headline.

```
observedShare = firedInBook / scoredHoldingsCount
expectedShare = firedInUniverse / scoredUniverseCount    // computed nightly, never authored
lift          = observedShare / expectedShare
```

**Two independent sufficient triggers.** Either fires `UE1`; both may hold.

| Trigger | Gates | Rationale |
|---|---|---|
| **Share path** | `observedShare ≥ UE_HIGH_BOOK_SHARE` (0.50) AND `firedInBook ≥ UE_SHARE_MIN_COUNT` (3) | half the book is inside this condition — material regardless of market |
| **Lift path** | `lift ≥ UE_MIN_LIFT` (2.0) AND `firedInBook ≥ UE_MIN_COUNT` (2) | markedly more common here than in the market |

**Universal gate (both paths):** `scoredHoldingsCount ≥ UE_MIN_BOOK` (4). Below this, neither share nor lift can be stated honestly.

`UE_SHARE_MIN_COUNT` is deliberately higher than `UE_MIN_COUNT` — a share of 2-of-4 is noise; 3-of-5 is a book trait.

### 3.5.2 · Base rate is a framing switch, not a kill switch

`expectedShare` **never gates the presence of an echo.** It selects which of two true sentences is rendered:

| Condition | Entry | The claim being made |
|---|---|---|
| `expectedShare < UE_ENVIRONMENTAL_BASE_RATE` | **`UE1`** | *distinctive concentration* — this is a trait of your book |
| `expectedShare ≥ UE_ENVIRONMENTAL_BASE_RATE` | **`UE6`** | *environmental exposure* — this is a market-wide condition and here is how much of your book sits inside it |

The 2×2 the two axes produce:

| | **Low lift** | **High lift** |
|---|---|---|
| **Low book share** | nothing, or `UE5` "in line with the market" | `UE1` weak distinctive — low rung |
| **High book share** | **`UE6` environmental exposure** | **`UE1` distinctive concentration** |

**The bottom-left cell is first-class, not a consolation prize.** *"This is a market-wide condition and roughly three-quarters of your book is inside it"* is among the most useful sentences the card can produce. It is the field-lifted idea (`LP2`) one level up: the fact is about the environment, and the reader's exposure to that environment is real, material, and stated nowhere else in the product.

**Base rate also never touches the finding itself.** If a pattern fires on this object it is true, its severity is unchanged, and it competes at rung 7 as an elevated finding independent of any echo. Only the *echo sentence* changes shape.

> **Not `dampen.ts`.** Dampening exists to avoid double-*penalising* a score for a sector-wide condition. Echo is not scoring. Borrowing the suppression logic wholesale was the error this section corrects. Echo changes no magnitude and no score, and therefore has no reason to suppress.

### 3.5.3 · The invariants that let the gates be generous

**The arithmetic is always rendered.** Both numbers appear in the copy, on every echo entry, always. This is what makes the family honest by construction rather than by our judgement — the reader sees the comparison and can dismiss it themselves. It is the safety net that permits generous gates instead of paranoid ones.

**Never state significance.** State the numbers and stop. No "notably", "unusually", "concerning", "you're exposed to", "worth noting". The permitted comparatives are plain and arithmetic: "more common in your book than in the market" · "most of your book is inside this".

**Base rates are computed, never authored** (§7.2). A pattern added later that fires on 60% of the universe is absorbed automatically — it routes to `UE6` framing rather than being silently dropped. Hardcoded rates corrupt on every extension.

### 3.5.4 · Echo is polarity-blind in mechanics, polarity-aware in boundary

Echo applies to **positive** findings on exactly the same gates. "Margin recovery is showing in 3 of your 7 holdings; 14 of the 95 we score show it" is as true, as computable, and as useful as any negative echo. Suppressing positive echo would reintroduce the polarity skew the foundation work removed.

**But the boundary is tighter, and this is the trap.** A negative echo describes a condition the reader's holdings share. A positive echo, phrased carelessly, becomes a **verdict on the reader's stock-picking** — which is a judgement on their decisions and therefore prohibited (§0.8).

| Verdict | Sentence |
|---|---|
| ✅ Legal | "Margin recovery is showing in 3 of your 7 holdings — 14 of the 95 we score show it too." |
| ❌ Illegal | "Your holdings are showing more recoveries than the market — you've picked well." |
| ❌ Illegal | "Your book is stronger than average on this." |
| ❌ Illegal | "This confirms your approach." |

**The rule:** positive echo states the counts and stops, exactly as negative echo does. It never evaluates the *selection* that produced them, never uses comparative-quality language about the book, and never implies skill, validation, or a repeatable edge. `doesnt_mean` for any positive echo carries this explicitly, plus the inherited already-priced line.

**No polarity mixing.** An echo entry covers one `patternKey` or one family, and a family with mixed-polarity members is never echoed as a single entry. "Four of your holdings are showing ownership-family conditions" where two are accumulation and two are exits is a meaningless sentence built from a true count.

### UE1 · Pattern echo across your book
- **State:** either trigger path in §3.5.1 satisfied, `expectedShare < UE_ENVIRONMENTAL_BASE_RATE`, for a `patternKey` firing on this object.
- **Inputs:** `firedFindingsByHolding`, universe base rate for that key, this object's fired set.
- **Temporal:** CONDITION.
- **Copy (lift path):** `{finding claim, plain}. It's showing in {firedInBook} of your {scoredHoldingsCount} holdings. Across the {universeCount} stocks we score, it shows in {firedInUniverse}. So it's more common in your book than in the market.`
- **Copy (share path, low lift):** `{finding claim, plain}. It's showing in {firedInBook} of your {scoredHoldingsCount} holdings — {firedInUniverse} of the {universeCount} stocks we score show it too.`
- **Doesn't mean:** shared conditions across holdings are a description of the book, not a prediction that they resolve together and not a statement that any of them is wrong to hold. Co-occurrence is not causation and not contagion.
- **Honest-empty:** the universal book-size gate unmet → not evaluable, does not fire. Trigger gates unmet with a sufficient book → `UE5`. Base rate at or above the environmental threshold → `UE6`, **never** a silent drop.

### UE2 · Red-flag echo
- **State:** as `UE1` but the shared item is a red flag (severity critical).
- **Gates:** `UE_MIN_COUNT` relaxed to 1 — a critical flag standing on two of your holdings needs no lift argument. Lift and share paths both waived.
- **Framing:** red-flag base rates are structurally low (census: R-flags fire on 6 of 95), so the environmental framing is effectively unreachable and `UE1`-style copy applies.
- **Copy:** `{flag claim}. Also standing on {n} other holding{s} of yours.`
- **Doesn't mean:** red flags are investigate-hard signals, not sell signals, and their recurrence in a book is a description of the book.
- **Note:** the only echo entry that may fire on a single co-occurrence, justified by severity. Count is the honest measure here; lift is near-meaningless at these base rates.

### UE3 · Family-level echo
- **State:** ≥`UE_FAMILY_MIN_COUNT` holdings fire *different* patterns within the same **family** (e.g. three different ownership-family patterns), and either family-level trigger path in §3.5.1 is satisfied (family share or family lift).
- **Framing:** the same base-rate switch applies at family level — a family firing broadly across the universe routes to `UE6` framing.
- **Copy:** `{n} of your {m} holdings are showing {family descriptor} conditions — this one included.`
- **Doesn't mean:** a family cluster describes where the book's soft spots sit, not that they share a cause.
- **Note:** family is read from the finding's published `family` property, never re-derived by regex (the frontend `classify.ts` mistake, §0.7).

### UE4 · Lens-level echo
- **State:** the object and the reader's holdings share a lens face (e.g. Field-Lifted Foundation), with either trigger path in §3.5.1 satisfied.
- **Availability:** **gated by persistence.** Only the escalated lens faces (currently the loud subset) are persisted and therefore censusable. Quiet faces are read-time-only and cannot be resolved across a whole book without recomputation.
- **v1 rule:** `UE4` fires only over persisted lens findings. If the quiet faces are later persisted, `UE4` widens with no change to this library (property-driven, §0.7).
- **Doesn't mean:** a shared lens state is often a statement about the *field*, not the stocks — a field-weak echo may mean the reader is concentrated in weak ponds, which `UN` covers, not that the names share a flaw.
- **Note:** field-verdict lens faces (`LM3`/`LM4`/`LP2`/`LP3`) reaching a high book share are the natural `UE6` case, and the strongest instance of it — a book broadly inside a weak-field condition.

### UE5 · In line with the market
- **State:** book exists, `scoredHoldingsCount ≥ UE_MIN_BOOK`, a co-occurrence exists but neither trigger path is satisfied — **or** no co-occurrence exists at all.
- **Copy (co-occurrence, unremarkable):** `Also showing in {firedInBook} of your {scoredHoldingsCount} holdings — about what the market average would suggest.`
- **Copy (no co-occurrence):** `Nothing standing on this stock repeats elsewhere in your book.`
- **Doesn't mean:** in-line is not a clean bill of health for either the stock or the book, and a repeat's absence is not reassurance.
- **Why it exists:** "your book is ordinary on this" is a legitimate resolution, not an absence. Renaming this from "no echo" is deliberate — the old framing treated the common case as a failure to find something.
- **Eligibility:** low ladder rung; fires only when a slot remains and nothing better competes.

### UE6 · Environmental exposure — market-wide condition, and your share of it
- **State:** a co-occurring pattern with `expectedShare ≥ UE_ENVIRONMENTAL_BASE_RATE`, and either trigger path in §3.5.1 satisfied (in practice, usually the share path — high lift is near-impossible at high base rates).
- **Temporal:** CONDITION.
- **Copy:** `{finding claim, plain}. This is showing across much of the market right now — {firedInUniverse} of the {universeCount} stocks we score. {firedInBook} of your {scoredHoldingsCount} holdings are inside it.`
- **Doesn't mean:** a market-wide condition is an environmental fact, not a book trait, not a defect in any name that has it, and not a signal. Your share of it is a measurement of exposure, not a verdict on the exposure.
- **Why it is first-class:** the reader's exposure to a broad market condition is material and appears nowhere else in the platform. Suppressing it — the original error — left the reader to assume the condition was specific to this name and left the exposure invisible.
- **Ladder:** own rung, above plain echo (§4.1).
- **Relationship to `dampen.ts`:** none. See §3.5.2. Dampening is a scoring correction; this is a reader-relative statement of exposure and changes no magnitude and no score.

---

## 3.6 · UG — Gap
*The honesty family. Honest-empty as a first-class citizen with its own catalog, not an edge case handled per entry.*

### UG1 · Not scored
- **State:** `isScored == false`.
- **Inputs:** `coverage.reason` (`NullReasonClass`).
- **Copy:** `We don't score this stock yet: {plain reason}.` + `What we do have: {available data list}.`
- **Doesn't mean:** unscored is a statement about our coverage, never about the stock's quality.
- **Rule:** must name what *is* available. An honest gap includes what remains.

### UG2 · Provisional coverage
- **State:** `coverage.provisional == true`.
- **Copy:** `Coverage here is thin — marked provisional.` + the coverage line.
- **Note:** the mandatory coverage line applies, per the coverage law. Coverage renders uncapped.

### UG3 · Stale prices
- **State:** `priceFreshness.isStale`.
- **Copy:** `Prices here are {n} days old.`
- **Doesn't mean:** staleness is our gap, not a market fact.

### UG4 · Unresolved holdings in your book
- **State:** `book.unresolvedHoldingsCount > 0` AND an unresolved row plausibly matches this object.
- **Copy:** `You may hold more of this than we can see — {n} row{s} from {broker/account} {is/are} not yet matched to a company.`
- **Doesn't mean:** an unmatched row is our matching gap; it is not a claim that the reader holds this.
- **Care required:** must be phrased as our uncertainty, never as an assertion about the reader's position.

### UG5 · Fund look-through unavailable
- **State:** reader holds funds AND `lookThroughAvailable == false`.
- **Copy:** `You may hold this indirectly through your funds — we can't see inside them yet.`
- **Doesn't mean:** as `UG4`. Never estimate the indirect exposure.
- **Pairing:** blocks `UH5` (§3.2).

### UG6 · No attention history
- **State:** `attention.hasHistory == false` and this is not genuinely the reader's first view (e.g. tracking introduced after the account existed).
- **Effect:** attention resolves to `FIRST`; no card content. Recorded in `meta.degradations`.
- **Rule:** never claim "first time you're reading it" when the truth is "we started tracking recently." `UH6`'s header is suppressed in this case; the mode falls back to the `RETURNING` sibling's header without a delta.

### UG7 · No portfolio connected
- **State:** `book.exists == false`, authenticated.
- **Copy:** `You haven't connected a portfolio, so this card can only tell you about the stock itself.`
- **Doesn't mean:** not a prompt, not a nudge, not an upsell. A statement of what the card can and cannot do. **One sentence, no call to action** — the moment it acquires one, this becomes a growth surface rather than an honesty surface.

### UG8 · Anonymous reader
- **State:** `isAuthenticated == false`.
- **Effect:** mode forces to **M9 Stranger**. `UO` family only. No `UG7` (there is no account to have a portfolio). No attention. No error.
- **Copy:** orientation only. No mention of what a signed-in reader would see.

### UG9 · Check not yet evaluable
- **State:** a rule **declined** on this object — returned not-evaluable rather than false — because the required history depth, feed, or column is unavailable, and its concern is relevant to the object.
- **Inputs:** `ObjectState.notEvaluable` — `{ ruleRef, reason }` per declining rule.
- **Copy:** `{capability descriptor} can't be checked here yet — {plain reason}.` e.g. `We can't yet check earnings quality on this stock — it needs four years of accounts and we have two.`
- **Doesn't mean:** not-evaluable is not "no signal" and not a clean result. The check has not run. The capability is visible; no coverage is implied.
- **Property-driven:** reads the engine's evaluability output, never a hardcoded ID list (§0.7).
- **⚠ Engine dependency — this entry is unreachable without it.** The findings engine currently cannot distinguish *declined for depth* from *evaluated and false*: both return null. `displayState: "pending_data_integration"` has **zero producers** in code, so keying on it would make `UG9` dead. The lens layer already models this correctly with `{evaluable, reason}`; the findings engine must adopt the same contract (§5.2). Until it does, `UG9` does not fire and `UO3` must use its weaker copy variant.
- **Why it matters most for depth, not feeds:** the dormant-feed case has largely resolved — the insider and block-deal feeds are live. The live gap is **history depth**: rules needing four consecutive annual periods or nine contiguous quarters decline on stocks whose history is shorter. That is the honest gap this entry exists to state, and silence about it is the misleading outcome.

### UG10 · Data older than cadence
- **State:** the in-force snapshot is older than the expected refresh cadence.
- **Copy:** `Latest data here is from {period} — the next update is due.`

---

## 3.7 · UA — Attention (router namespace, emits no cards)

**UA produces no rendered entries.** It resolves the attention axis and computes eligibility. There is no code path from UA to user-facing copy about behaviour (§0.6).

| Signal | Source | Used for |
|---|---|---|
| `UA1` first / returning / recurring / dormant | `viewCount`, `viewCountTrailing30d`, gap | mode selection (§2.1) |
| `UA2` depth — surfaces seen | `surfacesSeen` map | `UD`/`M11` depth-pointer eligibility |
| `UA3` depth — surfaces unseen | complement of above | the `M11` pointer target |
| `UA4` discussion topics | `discussion.topicTags` | pointer target refinement; slot eligibility |
| `UA5` last-viewed snapshot generation | `lastViewedSnapshotGeneration` | `UD9`, delta basis |

**The depth pointer — the one permitted expression.** In M11 (and eligible in M7), the engine may identify a surface the reader has not opened and render **the finding at that destination**, not the reading history.

- ✅ `One thing you haven't looked at: foreign investors have been reducing for two straight quarters while domestic funds have been adding.`
- ❌ `You've read fundamentals and health but never opened ownership.`

The permitted form names the surface only as a location (`— that's on the ownership tab`), and the substance is the finding. If no unseen surface carries a finding worth stating, the pointer does not resolve and the mode falls to its floor.

**Discussion topics are a routing signal only.** Never quoted, never summarised, never referenced. If a reader has been discussing margins with the AI, the engine may weight a margin finding higher. It may never say "you've been asking about margins."

---

# PART V — ARBITRATION

---

## 4.1 · The ladder (fixed precedence, not a score)

Relevance is a **ranking**, not a weighted score. A fixed ladder is auditable, cannot surprise in production, and does not create a coefficient surface to argue about for months. Relational weight is a **tiebreak only** (§4.3).

| Rung | Class | Rationale |
|---|---|---|
| **1** | Critical severity on a **held** object | risk, and it is the reader's money |
| **2** | Delta since last look on a **held** object | what changed on something they own |
| **3** | Critical severity on a **watched or unpositioned** object | risk before all else |
| **4** | Delta since last look, any position | change before state |
| **5** | Position facts (`UH1`, `UH5`) | the join fact that exists nowhere else |
| **6** | Pond exposure and concentration (`UN1`, `UN2`) | the reader's structural exposure |
| **7** | **High** severity standing findings | the object's state, elevated |
| **8** | **Recovery and notable strength** (`UO6`, elevated recovery findings) | the constructive read, ranked where the product already ranks it |
| **9** | **Medium** severity standing findings | the object's state, elevated |
| **10** | Environmental exposure (`UE6`) | the reader's share of a market-wide condition — an exposure fact, ranked with exposure |
| **11** | Echo (`UE1`–`UE4`) | book-level texture |
| **12** | Pond condition (`UN4`, `UN6`) | field context |
| **13** | Gaps (`UG*`) | honesty, unless a gap blocks a higher rung — then it rides with it |
| **14** | Orientation (`UO1`–`UO5`) | the unpositioned floor |
| **15** | Low severity, context, `UE5`, `UN8` | fills remaining slots |

**Reading:** *risk before opportunity · self before other · delta before state · fact before interpretation.* This mirrors the existing severity spine in the Rules Spec and the Health Hub, deliberately — a reader should not encounter two different orderings in one product.

**Why recovery and strength sit at rung 8, between high and medium severity.** This is not a compromise; it is the Rules Spec's own §5 ordering reproduced exactly. That ordering runs: red flags → deterioration (high) → wide divergence (high) → **recovery** → notable divergence (medium) → patterns. Recovery already outranks medium-severity risk in the product, on the grounds that it is the most durable signal the test program found. Splitting rung 7 into high and medium was required to reproduce that faithfully — the previous single "high/medium" rung had no place to put recovery at all, so it fell through to context by default. That was a bug, and this is its fix.

`UO6` shares the rung because it is the same class of statement: a constructive read the composite has already priced, surfaced for orientation rather than for action.

**Why `UE6` outranks `UE1`.** It is an exposure statement, and exposure ranks above texture (the same reason `UN1`/`UN2` sit at rung 6). A book three-quarters inside a market-wide condition is a larger fact about that reader than a distinctive but small co-occurrence. When both resolve for the same `patternKey` they cannot co-fire — the base-rate switch (§3.5.2) makes them mutually exclusive by construction.

**Polarity never sets a rung.** Severity does. A positive finding at high severity — a broad, dated, structural strength — sits at rung 8; a mild negative sits at 9 or 15. The ladder is ordered by *how much the reader needs to know*, not by whether the news is good. Sorting positives to the bottom as a class is how a card becomes permanently scolding.

## 4.2 · Slot allocation

1. Resolve the mode (§2.1–2.2).
2. Fill the mode's **floor** first — it is reserved, not competed for. A floor entry always occupies a slot.
3. Fill remaining slots by ladder rung, highest first.
4. Within a rung, order by relational weight (§4.3), then by severity, then by `standing_since` (older first — a long-standing condition before a fresh one at equal rank, because duration is the more informative fact).
5. Stop at the mode's cap. Everything unfilled goes to `overflow`, in the same order.
6. Apply modifiers: pond-mask caveat on price-linked entries (`UN5`), novelty markers, duration labels.
7. Run the assembled output through the forward-language guard (§0.11), not the fragments.

**Caps are hard.** More competition producing better winners is the correct behaviour as the libraries grow (§7.3). A cap that flexes under pressure reproduces the section-digest the card exists to escape.

## 4.3 · Relational weight (tiebreak only)

A float, used **only** to order within a rung. It never moves an entry between rungs.

| Factor | Effect |
|---|---|
| Position weight % of book | higher weight → higher relational weight |
| Sliver position (`UH9`) | strong reduction |
| PG exposure % | higher → higher |
| Held vs watched vs neither | held > watched > neither |
| Discussion topic match (`UA4`) | mild increase |
| Echo book share (`observedShare`) | higher share → higher |
| Echo lift | higher lift → higher |

**Within the echo rungs, share dominates lift as a tiebreak.** Concentration is the more material fact about a reader's book (§3.5.1); distinctiveness is the more interesting one. Material outranks interesting.

Deliberately excluded: view count (routing only, §0.6), returns or P&L (§0.8), **pattern magnitude** (§0.7.1 — it answers a question about the model, not about the reader), **polarity** (§4.1), any measure of reader engagement.

## 4.4 · Novelty and duration are display axes, never orderings

`is_new_since_last_look` and `standing_since` **annotate**; they do not reorder. This is the direct consequence of §0.5 — if novelty reordered, the card would drift back toward a feed, and long-standing conditions would sink out of view precisely because the reader has seen them before.

The one permitted interaction: within a rung, at equal relational weight, **older standing sorts first** (§4.2 step 4).

## 4.5 · Anti-double-counting with existing catalogs

The general rule mirrors the Three-Lens library's: **the existing finding is the headline; the relational entry is the join fact underneath.** When both speak to the same thing, the existing finding leads and the relational entry becomes its context — never a competing card.

| Overlap | Rule |
|---|---|
| `UN2` pond concentration vs PHS PC-family concentration | PHS is the headline. `UN2` renders as this-stock context, never as a fresh discovery. If the reader's portfolio page already says "cement is 31% of your book," the stock card does not announce it as news. |
| `UN7` sector exposure vs PHS `PB7` false-sector-spread | PHS leads; `UN7` suppressed if PHS fires. |
| `UE1` echo vs PHS `PS`-family (capital under red flags) | PHS leads for the *book-level* statement; `UE1` may still fire because it is anchored to *this pattern on this stock*. Distinct claims, both permitted. |
| `UE6` environmental exposure vs engine `dampened` state | Different claims, both permitted. Dampening is a PG-scoped scoring correction; `UE6` is a universe-scoped statement of the reader's exposure. `UE6` must not restate the dampening annotation, and dampening must not suppress `UE6` (§3.5.2). |
| `UE1` vs `UE6` for the same `patternKey` | Mutually exclusive by construction — the base-rate switch routes to exactly one (§3.5.2). If both ever resolve, it is a bug. |
| `UD3` band crossing vs the object's own `I`/`B`/`D` findings | The object's finding is the headline. `UD3` fires only when it adds the reader-relative fact (crossed *since you last looked*), which the object's finding cannot state. |
| `UD4` pillar zone vs `UD3` band | `UD3` leads when same-direction and causally linked. |
| `UN6` within-pond shared vs `UE1`/`UE6` whole-book echo | If both resolve for the same `patternKey`, the whole-book entry leads (wider claim, carries its arithmetic); `UN6` moves to overflow. |
| `UO6` standing strength vs the engine's sustained-soundness finding | The engine's finding is the headline; `UO6` becomes its duration detail. If the engine does not emit one, `UO6` is the only path and fires freely. |
| `UD2` finding-no-longer-standing vs the engine's flag-cleared finding | The engine's finding leads (authored, dated). `UD2` covers only items the engine does not track as cleared. |
| `UN4` pond condition vs PG-native findings | A fired PG finding always leads over the `PGState`-derived sentence. The derived form is a fallback, never a duplicate. |
| `UN6` within-pond shared vs PG-native field-wide findings | A PG finding covering the whole field leads; `UN6`'s within-book count becomes its detail. |
| Any relational entry vs the object's own finding card lower on the page | The relational card **elevates by reference** using the finding's own claim; it never re-authors the interpretation (§0.10). |

## 4.6 · Suppression rules (hard)

| Trigger | Suppresses |
|---|---|
| `UH8` (reader exited or reduced) | **all price-linked entries** on the card — no implicit verdict on the reader's decision (§3.2) |
| `attention == FIRST` | the entire `UD` family (`UD8`) |
| `lookThroughAvailable == false` | `UH5`; `UG5` fires instead |
| `isAuthenticated == false` | everything except `UO`; forces M9 |
| `book.exists == false` | `UH*`, `UE*`, `UN1`/`UN2`/`UN7`; `UG7` fires |
| PHS concentration finding active | `UN2` demoted to context |
| Object's own finding covers it | relational restatement demoted to reference |
| Feed dormant | the dependent `UD5`; `UG9` fires |

---

# PART VI — STORAGE, COMPUTATION, AND DEGRADATION

---

## 5.1 · What is new (deliberately minimal)

**One table.**

```
user_object_views {
  userId, objectType, objectId,        // objectType: "stock" | "peer_group" | "fund"
  firstViewedAt, lastViewedAt,
  viewCount,
  viewCountTrailing30d,                // maintained or derived; see 5.3
  surfacesSeen: Json,                  // { surfaceKey: { count, lastAt } }
  lastViewedSnapshotGeneration,
  updatedAt
  @@unique([userId, objectType, objectId])
}
```

That is the entire new write surface for v1.

**Explicitly not built:**
- **No surfaced-findings ledger.** Killed in §0.5. It is the mechanism by which the card would start lying.
- **No per-view event log** in v1. Aggregate counters only. An append-only event log is a larger privacy surface and buys nothing the counters do not.
- **No relational findings table.** Relational state is per-(reader, object, instant) and read-time by nature (§5.5).

## 5.2 · What is read (existing, plus three engine prerequisites)

### 5.2.1 · The three prerequisites — gate this library, are not part of it

Two are contract changes in the findings engine; one is a new derivation. **None is a pattern, and none belongs to this library** — they are named here because sections above assume them and will silently degrade without them.

| Prerequisite | What it is | What breaks without it |
|---|---|---|
| **`standing_since`** | earliest snapshot of the current unbroken run per `(object, patternKey)`. Derivable today from the append-only chain + `supersedesId`; computed nowhere. | duration labels on **point-in-time** findings · the tiebreak in §4.2 step 4 · `UO6` **only** where it rests on point-in-time findings |
| **Evaluability** | `not_evaluable {reason}` distinct from `not_fired`. The lens layer already models this; the findings engine returns null for both. | `UG9` is unreachable · `UO3` must use its weaker copy variant · "nothing flagged" cannot be qualified by history depth |
| **Polarity** | each rule publishes `positive` / `negative` / `neutral` (§7.1) | `UO6` cannot select strength findings · `UE` cannot enforce the no-polarity-mixing rule (§3.5.4) · `UO3` cannot count by concern |

**Degradation is defined, not undefined.** Build order can proceed without all three: absent `standing_since`, duration labels are suppressed and `UO6` does not fire; absent evaluability, `UG9` does not fire; absent polarity, `UO6` does not fire and echo covers negatives only. In every case the card still resolves and the degradation is recorded in `meta.degradations`. **The card never fabricates the missing input.**

### 5.2.2 · Sources

| Need | Source |
|---|---|
| Holdings, values, weights, accounts, routes | portfolio tables (existing) |
| Entity aggregation | ISIN stem (existing law) |
| Fund look-through | existing look-through data; `PE5` marks unavailability |
| Watchlist + `addedAt` | watchlist tables (existing) |
| Fired findings + severity + family + evidence | `score_patterns`, `score_red_flags` (existing) |
| `standing_since` / run length | snapshot chain + `supersedesId` (§5.2.1) |
| Rule evaluability | engine contract change (§5.2.1) |
| Finding polarity | published per rule (§5.2.1, §7.1) |
| PG-native findings | PG findings store, where PG patterns exist; else `PGState` fallback (§3.3 `UN4`) |
| Universe base rates per key | nightly aggregate over `score_patterns` on in-force head snapshots |
| PG membership, health, trajectory, mask heat | PG tables + `PGState` (existing) |
| PHS snapshot + fired PF findings | `portfolio_health_snapshot` (existing) |
| Coverage / null reasons | `NullReasonClass` taxonomy (existing) |
| Events (block, insider, corporate, news) | existing feeds, with liveness check |
| `aiLevel` | `UserRegister` via `resolveToneForUser` (existing) |
| AI discussion topics | existing conversation store, tagged |

## 5.3 · New derived aggregates

| Aggregate | Cadence | Notes |
|---|---|---|
| `universeBaseRates[patternKey]` | nightly | over in-force head snapshots. **Computed, never authored** (§3.5.1). Must include the universe count used, for rendering. |
| `standingSince[instrumentId][patternKey]` | per snapshot generation | earliest snapshot of the current unbroken run; a gap restarts the run |
| `viewCountTrailing30d` | on write, or derived at read from a bounded window | if derived, the counters alone are insufficient and a bounded recent-view record is needed — decide at build; prefer maintained counter to avoid a second table |
| `typicalPositionValue` | with PHS compute or at read | median position value across scored holdings |

## 5.4 · Caching

Relational state is a function of `(readerContext, objectState)`. Cache key:

```
userId · objectId · snapshotGeneration · bookVersion · watchlistVersion · lastViewedAt-bucket · aiLevel
```

**Invalidations:** new snapshot generation for the object or any holding · portfolio change (transaction, sync, resolution) · watchlist change · `aiLevel` change · a view (which advances `lastViewedAt`).

**Ordering rule (important):** the card resolves **before** `lastViewedAt` is advanced for this view. Otherwise every delta self-destructs on render. Write the view record *after* the response is composed.

## 5.5 · Ephemerality and the verification consequence

Relational state is true of an **instant**, per reader. It is not persisted and therefore **cannot be censused** the way Part G of the recon censused everything else. There is no equivalent of "this entry fires on N stocks."

Verification is therefore **synthetic fixtures or nothing** (§8).

## 5.6 · The read-time lens ceiling

Ten of the fourteen lens faces are recomputed per request and stored nowhere. Consequences, stated plainly so they are not discovered late:

- `UE4` covers **persisted** lens findings only in v1.
- Quiet lens faces are available for **this object** (they are in its health payload) but not across a whole book without recomputation.
- If the quiet faces are later persisted, `UE4` widens with **no change to this library** — it is property-driven, not ID-driven.

This is a ceiling, not a blocker.

## 5.7 · Performance budget

The card resolves on every stock-page load. The fan-out risk is echo, which needs the fired set for every holding.

- Echo reads **persisted findings only**, one indexed query over `firedFindingsByHolding`, cached per `(userId, snapshotGeneration, bookVersion)`.
- Base rates come from the nightly aggregate — never computed per request.
- `standing_since` is precomputed per snapshot generation — never walked per request.
- Target: no additional round-trip beyond the reader context, which the portfolio layer already loads.
- Degrade rather than block: if echo cannot resolve within budget, drop the `UE` family, record it in `meta.degradations`, and render the card without it. **Never render a partial echo, and never render an echo without both of its numbers** (§3.5.3).

## 5.8 · Authentication

The card is the first element on the stock page that cannot be cached stock-side, which drags read-gating onto the critical path.

| Reader | Behaviour |
|---|---|
| Anonymous | M9 Stranger, `UO` only, no error, no mention of signed-in capability (`UG8`) |
| Authenticated, no portfolio | full attention and watchlist behaviour; `UG7` states the limit once |
| Authenticated, portfolio present | full resolution |

Not a blocker for v1, but the dependency is real and should be named in the build plan rather than discovered.

## 5.9 · Behavioural data discipline

- Aggregate counters and a surfaces map. No per-view event log in v1.
- Used for routing only (§0.6). Never rendered, never exported to the reader as a history, never used for cohort comparison (§0.8).
- Deletable with the account; a reader clearing history resolves to `FIRST` with `UG6` handling the honesty (never "first time" when the truth is "we forgot").

---

# PART VII — THE AI CONTRACT

---

## 6.1 · The division of labour

The library resolves for `(object, reader)` and emits a finished `RelationalState`. The AI layer reads that object **under instruction**. It never reads rules, never sees fire conditions, never derives its own verdict.

## 6.2 · The AI payload includes the negatives

The card renders one mode's slots. The AI needs the **complete** relational state, including everything that did *not* resolve — because absence is as useful in a conversation as presence.

```
negatives: [
  { fact: "not_held", detail: null },
  { fact: "no_pg_exposure", detail: { peerGroupLabel } },
  { fact: "first_visit", detail: null },
  { fact: "echo_in_line_with_market", detail: { observedShare, expectedShare, lift } },
  { fact: "echo_not_evaluable", detail: { reason: "book_too_small" | "no_cooccurrence" } },
  { fact: "lookthrough_unavailable" },
  ...
]
```

Building the relational context as a **standalone service** with the card as one consumer is not optional. Building it inside the card renderer guarantees a rewrite when the AI consumes it.

## 6.3 · Self-describing weight — the anti-editorialising rule

A language model handed "this pattern also fires in 3 of your holdings" will editorialise it into significance, because that is what language models do with co-occurrence.

**Every echo and exposure entry must ship its own arithmetic and its own verdict on whether the arithmetic is meaningful:**

```
arithmetic: {
  observedCount: 3, observedBase: 8, observedShare: 0.375,
  expectedCount: 17, expectedBase: 95, expectedShare: 0.179,
  lift: 2.09,
  triggerPath: "lift" | "share" | "both" | "none",
  framing: "distinctive" | "environmental" | "in_line",
  interpretationCeiling: "more common in this book than in the market; no causal or predictive claim available"
}
```

**`framing` is not cosmetic and the AI must respect it.** An `environmental` entry means the condition belongs to the market and the reader's share of it is the exposure fact. The AI may not restate an environmental condition as a trait of the reader's selection, nor a distinctive one as a market condition. `interpretationCeiling` is authored per framing:

| `framing` | `interpretationCeiling` |
|---|---|
| `distinctive` | more common in this book than in the market; no causal or predictive claim available |
| `environmental` | a market-wide condition; this is the share of the book inside it; not a trait of the reader's selection and not a defect in any holding |
| `in_line` | present in the book at roughly market frequency; no book-level claim available |

`interpretationCeiling` is a hard instruction boundary carried in the data. The AI may not exceed it.

## 6.4 · Instruction boundary for the AI layer

- May restate, compress, and reorder for conversational flow.
- May answer questions using the negatives.
- May apply `depth` and `jargon` from the resolved tone triple (this is where the seven-way resolution belongs, §0.11).
- **May not** exceed `interpretationCeiling`, introduce causation, predict, advise, model an unmade transaction (§0.8), quote attention or discussion history (§0.6), or introduce precision absent from the payload (§0.11).
- **May not** re-derive anything. If a fact is not in the payload, it is not available.

---

# PART VIII — EXTENSION

---

## 7.1 · What a new pattern owes this library

Three fields. Nothing else. No integration work in relational code.

| Field | Why |
|---|---|
| **Temporal class** — CONDITION / TRANSITION / CLOCK-EVENT (+ horizon if clock) | decides duration vs ageing (§0.5) |
| **Severity class** | decides ladder rung (§4.1) |
| **Polarity** — positive / negative / neutral | decides strength eligibility (`UO6`), echo polarity handling (§3.5.4), and concern counting (`UO3`). **Not** rung — severity sets rung (§4.1) |
| **A plain claim line** | the one thing that must be hand-written |

Family, direction, magnitude, and base rate come from the engine and the nightly aggregate. A new pattern flows through arbitration, echo, and duration automatically.

**Magnitude is explicitly not owed to this library** — it is never read (§0.7.1). A new display-only pattern with `magnitude: null` is a first-class citizen here and may outrank a score-affecting one.

## 7.2 · What must never happen

- **No ID enumeration in relational code** (§0.7). Property-driven only.
- **No authored base rates** (§3.5.1). Computed nightly, always.
- **No new relational family without a floor** — if it cannot resolve honestly in a mode, it does not belong.
- **No parsing of rendered verdicts** (§0.7).

## 7.3 · Growth improves this feature

Caps are fixed; competition rises; winners get better. Extension strengthens the card rather than straining it. That is the signal the architecture is right — and it inverts the usual relationship, where more patterns means more noise.

## 7.4 · A new object type

To extend `Object` beyond stock (peer group, fund, screener row, comparison), a new object owes:

1. An `ObjectState` resolver.
2. A position-axis definition (what does HELD mean for a peer group? — plausibly "holds ≥1 member").
3. A mode grid, or an explicit reuse of the stock grid.
4. Per-mode floors.
5. Nothing else. `ReaderContext`, the ladder, echo normalisation, temporal classes, and the boundary are all shared.

---

# PART IX — BOUNDARY (consolidated, binding)

*A single restatement, because these are the load-bearing constraints and they will be tested by every future entry.*

The relational library does **not**:

1. **Predict.** No entry states what happens next.
2. **Advise.** No buy/sell/hold/trim/add, no "you should," no "consider."
3. **Model an unmade transaction.** Never state what the reader's exposure *would become* (§0.8).
4. **Show returns, P&L, or cost basis** — and never places any price-derived figure adjacent to a health score, band, or finding (§0.8).
5. **Render behaviour as content.** Attention and discussion are routers only (§0.6).
6. **Infer intent.** Repeated visits are not consideration; watchlisting is not intent.
7. **Compare readers.** No cohorts, no percentiles of users, no "most investors."
8. **Author object verdicts.** It elevates existing findings using their own claims (§0.10).
9. **Manufacture significance.** Every echo entry renders both numbers and states no significance beyond the permitted arithmetic comparatives (§3.5.3). Equally: it does not **suppress** a real exposure because the condition is common — base rate switches the framing, never the presence (§3.5.2).
10. **Clean the slate.** No finding is removed because we believe it was seen (§0.5).
11. **Fabricate.** A missing input is an honest state, never a value, a pass, or a fail.
12. **Employ engagement mechanics.** No streaks, no nudges, no urgency, no unread badges.
13. **Rank stocks or peers as better.** Names are listed; nothing is crowned (§0.9).
14. **Render raw identifiers.** No `patternKey`, no enum, no UUID, no ISIN (§0.9).
15. **Recompute anything.** Join facts and selection only (§0.7).
16. **Nudge on gaps.** `UG7` states a limit in one sentence and carries no call to action (§3.6).
17. **Celebrate.** Strength is stated and dated, never celebrated. No "excellent", "quality", "well-positioned", "impressive". Already-strong is already priced, and the boundary is inherited verbatim (§3.1 `UO6`).
18. **Judge the reader's selection.** A positive echo states counts and stops. It never says the reader picked well, never uses comparative-quality language about the book, never implies skill or a repeatable edge (§3.5.4).
19. **Manufacture strength from silence.** An absence of flags is `UO3` and is a weaker claim than `UO6`. Conflating them is fabrication in the constructive direction.
20. **Rank by magnitude.** Score effect is never a relevance input (§0.7.1).

---

# PART X — DEGENERATE CASES (all must be handled)

| Case | Behaviour |
|---|---|
| Anonymous reader | M9, `UO` only, no error (`UG8`) |
| Authenticated, no portfolio, no watchlist | attention modes still apply; `UG7`; orientation floor |
| Portfolio connected, zero scored holdings | `UH*` fires on position facts; `UE*` not evaluable (`UE_MIN_BOOK`); `UG1`-style coverage note on the book |
| Object not scored | `UG1`; `UH1` still fires if held; no `UO2` |
| Object scored, no PG assigned | `UN*` suppressed; `UO1` states sector only |
| PG below the peer minimum | lens faces not evaluable; `UN4` suppressed; stated as a gap, never as a pass |
| First-ever session (no tracking history) | `FIRST`, but `UG6` suppresses the "first time" header if tracking post-dates the account |
| Held via fund only, no direct | position `HELD`, route `fund_lookthrough`; `UH1` states the indirect value and route explicitly |
| Held via fund only, look-through unavailable | position `NEITHER`; `UG5` fires. **Never claim a position we cannot see.** |
| Position exited between visits | position `NEITHER`; `UH8` eligible; **all price-linked entries suppressed** (§4.6) |
| Multiple accounts, one dead session | value from live accounts; `UG3`/`UG10` if the dead account's data is stale; state the account is unsynced |
| Object is a fund or ETF, not a stock | out of v1 scope; resolve to a minimal orientation card, record in `meta.degradations` |
| `lastViewedAt` in the future (clock skew) | clamp to now; treat as `RETURNING` with no delta; record degradation |
| Snapshot unchanged since last view | `UD7` with the cadence clause; body carries standing state |
| Portfolio deleted between visits | `book.exists == false`; `UG7`; no stale position claim |
| Object delisted or inactive | orientation with an explicit inactive state; no health claims |
| Reader holds the object across accounts at different bases | value aggregates; **no basis, no return** (§0.8) |
| All feeds for a family dormant | `UG9`; the family renders as capability-visible, not as no-signal |
| Echo query exceeds budget | drop `UE`, record degradation, render the rest (§5.7) |
| Every family resolves nothing (theoretically impossible) | the mode floor is reserved and always resolves. If this state is ever reached it is a **bug**, not an empty state — log it. |

---

# PART XI — VERIFICATION

Because relational state cannot be censused (§5.5), verification is a **synthetic fixture matrix** walked against real objects.

**Fixture axes (minimum):**

- Position: none · direct small · direct large · multi-account · direct+fund · fund-only · exited · unresolved-row · unscored-holding
- Book size: 0 · 1 · 4 · 8 · 20 scored holdings
- PG exposure: 0% · below notable · notable · heavy
- Attention: first · returning-with-delta · returning-without-delta · recurring · dormant
- Look-through: available · unavailable
- Auth: anonymous · authenticated-no-book · authenticated-with-book
- Object: scored clean · scored with one critical flag · scored with many findings · provisional coverage · unscored · no PG · stale prices · dormant-feed-relevant

**Required assertions:**

1. **Every cell resolves a card.** No empty card, ever. A fixture producing none is a build failure.
2. **Every mode's floor is present** in every one of its cells.
3. **No fixture renders a return, gain, loss, or basis figure** anywhere on the card.
4. **No fixture renders a modeled transaction** — grep the assembled output for would-be/if-you/after-adding constructions.
5. **No fixture renders a view count, visit count, or reading history** as a fact.
6. **`UH8` fixtures contain zero price-linked entries.**
7. **Every echo entry contains both numbers** — book count/base and universe count/base — at every register.
7a. **A high-base-rate co-occurrence at high book share resolves `UE6`, never nothing.** Fixture: a pattern firing on ≥35% of the universe and ≥50% of the book must produce an environmental-exposure entry. Silent suppression is a build failure.
7b. **`UE1` and `UE6` never co-fire** for the same `patternKey`.
7c. **A high-share, low-lift co-occurrence fires** (share path), and a low-share, high-lift one fires (lift path) — neither path may be reachable only via the other.
8. **The forward-language guard passes on assembled output** at all three registers, with the plain-specific deny-list active.
9. **Stability:** the same fixture resolved twice with unchanged state produces identical slot ordering.
10. **Novelty never reorders:** a fixture differing only in `lastViewedAt` produces the same order with different markers.
11. **Nothing is removed by a view:** resolving, advancing `lastViewedAt`, and resolving again drops no standing entry.
12. **No raw identifier** appears in any assembled output.
13. **Anonymous fixtures never error and never reference signed-in capability.**
14. **AI payload negatives are populated** for every not-resolved family.
15. **No fixture output contains celebration language** — grep the assembled output at all three registers for excellent/quality/impressive/well-positioned/strong-candidate.
16. **No positive-echo fixture evaluates the reader's selection** — grep for picked/chose/your-approach/better-than-average constructions.
17. **`UO6` never fires on an absence of flags.** Fixture: a clean stock with no positive-polarity finding and no `standing_since` must resolve `UO3`, not `UO6`.
18. **Relevance is magnitude-blind.** Fixture: a `magnitude: null` high-severity finding must outrank a `magnitude: -8` medium-severity one. If it does not, magnitude has leaked into ordering.
19. **A held clean stock with sustained strength resolves `UO6` in M3**, not a bare "nothing new" — the anti-scolding assertion.
20. **Degradation is graceful for each prerequisite.** Three fixtures, each with one of `standing_since` / evaluability / polarity absent: card resolves, affected entries suppressed, `meta.degradations` populated, nothing fabricated.

---

# PART XII — CONSTANTS (declared, not derived — provisional)

*Following the PHS convention: these are declared display/eligibility thresholds. **None of them changes any score.** All are tunable without model implications.*

| Constant | Value | Governs |
|---|---|---|
| `RECURRING_MIN_VIEWS_30D` | 4 | attention `RECURRING` |
| `DORMANT_GAP_DAYS` | 90 | attention `DORMANT` |
| `UH_LARGE_POSITION_PCT` | 10 | `UH3` heavy single name |
| `UH_TOP_N` | 3 | `UH3` ordinal naming |
| `UH_SLIVER_PCT` | 1 | `UH9` |
| `UH_SLIVER_VALUE` | ₹25,000 | `UH9` |
| `UH_TYPICAL_MULT` | 2.0 | `UH4` |
| `UH_TYPICAL_MIN_HOLDINGS` | 5 | `UH4` eligibility |
| `UH_TXN_HORIZON_DAYS` | 90 | `UH7`/`UH8` |
| `UN_PG_NOTABLE_PCT` | 25 | `UN2` notable |
| `UN_PG_HEAVY_PCT` | 40 | `UN2` heavy |
| `UN_SECTOR_NOTABLE_PCT` | 30 | `UN7` |
| `UN_POND_SHARED_MIN` | 2 | `UN6` |
| `UE_MIN_BOOK` | 4 | universal echo book-size gate (both paths) |
| `UE_MIN_LIFT` | 2.0 | lift path threshold |
| `UE_MIN_COUNT` | 2 | lift path count floor |
| `UE_HIGH_BOOK_SHARE` | 0.50 | share path threshold |
| `UE_SHARE_MIN_COUNT` | 3 | share path count floor (higher than lift path — 2-of-4 share is noise) |
| `UE_ENVIRONMENTAL_BASE_RATE` | 0.30 | **framing switch**, not a kill switch: at or above → `UE6`, below → `UE1` (§3.5.2) |
| `UE_FAMILY_MIN_COUNT` | 3 | `UE3` |
| `UD_NEWS_HORIZON_DAYS` | 14 | `UD6` |
| `UD_MIN_GAP_FOR_FUNDAMENTAL_DELTA` | 1 snapshot generation | `UD7` cadence clause |
| `UD_EVENT_HORIZON_DAYS` | 90 | `UD5` (aligns with existing block/insider windows) |
| `UO_STRENGTH_MIN_SNAPSHOTS` | 4 | `UO6` — minimum unbroken run before strength may be stated with duration |
| `STALE_PRICE_DAYS` | 5 | `UG3` |
| `CARD_CAP_DEFAULT` | 3 | fallback slot cap |
| `OVERFLOW_ENABLED` | true | expand-to-full-standing-set |

**Optional tightening, deliberately deferred:** an exact-binomial gate on the lift path instead of a fixed threshold. It is descriptive, not predictive, so it would not breach the boundary — but it adds machinery and a second thing to explain, and it does nothing for the share path, which carries no statistical claim at all. The rendered arithmetic (§3.5.3) already lets the reader dismiss a weak echo. Revisit only if lift proves noisy on small books.

**`UE_ENVIRONMENTAL_BASE_RATE` lowered from the original 0.35 to 0.30.** With the census as it stands, the most-fired condition (`trajectory_B_deterioration`, 37 of 95 ≈ 0.39) routes to environmental framing, which is correct — a condition on two-fifths of the market is an environment. Tune this by asking one question only: *at this base rate, is the honest sentence "your book is unusual" or "the market is like this and here is your share"?*

---

# PART XIII — THE ONE TEST

Mirroring the Three-Lens library's:

> **A relational pattern qualifies only if it names a true fact about the relationship between this reader and this object, makes the reader a sharper reader of what they are already looking at, shows its own arithmetic, and says nothing about what they should do or what will happen next.**

If it predicts, advises, models an unmade trade, mirrors behaviour, manufactures significance, ranks readers, or fabricates — it is not a relational pattern and it does not belong here.

---

## Status and handoff

**Complete at the spec level.** Six families (`UO`, `UH`, `UN`, `UD`, `UE`, `UG`) with 48 entries, one router namespace (`UA`), twelve modes with declared floors and caps, a fifteen-rung arbitration ladder, the conditions/events temporal model, the two-axis echo model with computed base rates, the AI contract, the extension contract, twenty boundary rules, twenty-two degenerate cases, twenty verification assertions, and twenty-nine declared constants.

**v1.0 → v1.1 amendment (§3.5, §4.1, §4.3, §4.5, §6.2, §6.3, Part IX·9, Part XI·7, Part XII):** echo split into two independent axes — concentration (`observedShare`) and distinctiveness (`lift`) — either sufficient to fire. Base rate reclassified from a suppression gate to a framing switch. `UE6` promoted from "echo suppressed" to **environmental exposure**, first-class with its own ladder rung above plain echo. `UE5` redefined as "in line with the market," a legitimate resolution rather than an absence. Rationale: a lift-only gate made the system's most-fired conditions structurally unable to echo — `trajectory_B_deterioration` at 37 of 95 would have required seven of nine holdings before the card spoke, then been suppressed anyway. Concentration is material independent of the market; only the sentence's framing depends on base rate.

**v1.1 → v1.2 amendment** (§0.7 + new §0.7.1, §1.3, §3.1 `UO3`/`UO6`, §3.3 `UN4`, §3.4 `UD2`, new §3.5.4, §3.6 `UG9`, §4.1, §4.3, §4.5, §5.2 + new §5.2.1, §7.1, Part IX·17–20, Part XI·15–20, Part XII) — the foundation-extension pass:

- **`UO6` Standing strength added.** The library previously had no way to state that something is right, only that nothing is wrong. Duration is the carrier; already-priced is the inherited boundary; register discipline is stated-and-dated, never celebrated. Eligible in every mode, which is what stops an always-present card becoming permanently scolding.
- **Ladder rebuilt to fifteen rungs.** Rung 7 was a single "high/medium severity" band with **no place for recovery**, so the product's most durable signal fell through to context by default — a bug. Split into high (7) and medium (9) with recovery and notable strength at 8, reproducing the Rules Spec's own §5 ordering exactly. Added the explicit rule that **polarity never sets a rung; severity does.**
- **§0.7.1 magnitude invariant.** The engine's namespaces now mean something: `P`/`R` may affect the score, everything else is display-only. The relational layer must never read `magnitude` — it answers a question about the model, not about the reader, and a display-only finding can be the most important thing on a card.
- **§3.5.4 echo polarity.** Echo applies to positive findings on identical gates, with a tighter boundary: it states counts and never evaluates the reader's *selection*. Plus a no-polarity-mixing rule for family-level echo.
- **`UG9` rekeyed from `displayState` to evaluability.** As written it was unreachable — `pending_data_integration` has zero producers in code. The live gap is history *depth*, not missing feeds; the insider and block-deal feeds are live.
- **`UO3` gains an evaluability variant.** "Nothing flagged" on six quarters is a weaker claim than on five years, and the card must not present them identically.
- **`UN4` rekeyed to consume PG-native findings** where they exist, with the `PGState`-derived sentence demoted to fallback.
- **§5.2.1 names the three prerequisites** — `standing_since`, evaluability, polarity — with **defined degradation for each.** None belongs to this library; all three gate parts of it, and the card must degrade honestly rather than fabricate.

**Build order (recommended, sequenced so each stage is verifiable before the next):**

0. **Prerequisites (§5.2.1), owned by the engine, not this library:** `standing_since` derivation · `not_evaluable` vs `not_fired` · published polarity. Steps 2 and 5 degrade without them; nothing else blocks.
1. `ReaderContext` resolver + `user_object_views` + nightly base rates.
2. The `UH` + `UO` families and modes M1, M9 — the two clearest cells, one held and one stranger. Verifies floors, the position join, and `UO6`.
3. `UN` + `UD` + modes M2, M3, M5 — verifies temporal classes and the novelty-as-annotation law.
4. `UE` with both trigger paths + `UE6` + polarity handling — verifies the anti-horoscope gate and the anti-flattery gate together.
5. `UG` across all modes — verifies honest-empty as a first-class family.
6. Remaining modes, arbitration hardening, the fixture matrix.
7. The AI payload as a standalone service (or from step 1 if the AI layer is near).

**Named dependency:** read-gating on public stock reads. This card cannot be cached stock-side and is the first element that must know who is asking.

---

# PART XIV — AMENDMENTS (v1.1, from the build)

*Every item below OVERRIDES the section it names. Each was found by rendering real cards against live
data, not by review — the original text is left intact above so the correction and what it corrects are
both auditable. Where a live sentence forced the change, that sentence is quoted.*

**The one-line summary: eleven of these corrections exist because a card said something untrue, and
every one of those was found by looking at output rather than by reading code.**

---

## A · The falsehoods (a claim the data could not support)

### A1 · §3.2 UH6 — no novelty assertion in a header

`M1` is selected by the **absence** of a `BehaviorRollup` row, and the attention beacon is lossy by
design: it discards its entire buffer when no auth token is present, and its failures are unobservable
server-side. A holder who has read a stock ten times could therefore be told:

> ~~"You own this — first time you're reading it."~~

**The library's exception for UH6 — "framing what follows, not reporting behaviour" — was wrong.**
Novelty may be *annotated* per entry where `lastViewedAt` is genuinely known. It may never be *asserted*
from a missing row. M1 keeps its routing role and loses the claim:

> "You own this — here's what's standing on it."

### A2 · §2.3 — WATCHED and NEITHER modes must not fold to M9

Folding M5–M8 into M9 made a watchlisted stock render "New to you." while `negatives` simultaneously
carried `watchlisted_not_held` — the system holding the contradicting fact while asserting the opposite.
Folding M10–M12 did the same to a reader who had opened a stock nine times.

**M9 means STRANGER-AND-FIRST-VISIT and cannot represent any other reader state.** M5–M8 and M10–M12
now resolve as themselves. M2 and M4 are likewise unfolded so a delta header can render at all.

### A3 · §2.1 — the position axis tests QUANTITY, not value

The library defines HELD as "≥1 holding … value > 0", which conflates two different states:

- **quantity 0** → the reader **EXITED**. Not a position. Resolves `NEITHER`.
- **quantity > 0, value null** → **HELD but unpriceable**. UH1's honest-empty branch is exactly right.

Testing *value* wrongly drops the second. Live, five fully-exited legacy rows rendered "You own this."

### A4 · §3.4 UD7 — "nothing new" requires a comparison BASIS, not a timestamp

A `lastViewedAt` without a stamped `lastViewedSnapshotGeneration` cannot support a claim about change:
we do not know **which** snapshot the reader saw. Live, this rendered "Nothing new since July 2026." on
a stock whose delta had never been computable. UD7 now requires the stamped generation.

### A5 · §3.5 — a percentage must not contradict a named holding

A zero-quantity holding appears in a roster intersection but carries no weight, producing:

> ~~"Large-Cap Oil & Gas is about 0% of your book — 1 company: Reliance Industries Ltd."~~

Where the weight rounds away, state the **membership** (true) and drop the **number** (not).

---

## B · Arbitration

### B1 · §4.2 — the floor is a RANK statement, not an inclusion mechanic

Two readings were tried and both were wrong:

1. *"Reserved, not competed for"* (the library's text) placed the floor first unconditionally — so UO4,
   a **null** orientation statement, outranked a rung-7 divergence finding.
2. *"Guarantees inclusion, not position"* let a missing floor entry displace the lowest-ranked
   non-floor entry — so UO1@14 and UO2@14 displaced ELEVATED@9 and UE1@11.

**The defective premise was that rung is ONE GLOBAL ORDERING.** Relevance is reader-dependent:
orientation sits at rung 14 because for a reader *with context* identity is the least useful thing on
the card — and for a **stranger**, which is exactly what M9 is, identity is the *most* useful thing.
Both are true; one global ladder cannot say both.

**A mode's floor entries take THAT MODE'S floor rank, in declared order. Everything else fills by
global rung.** No displacement mechanic. §0.4 is satisfied, the ladder is never inverted, and the card
reads in the order a stranger needs: what it is → how sound → then what matters.

### B2 · §2.3 — UO4 is not floor

A null reader fact ("nothing connects to this name") guaranteed a slot is backwards: its entire purpose
is to fill space when nothing better exists. Its low rung already produces that behaviour. **M9's floor
is UO1 + UO2.** Live effect: UO4 fell from 14 slots to 5.

### B3 · §4.1 — every delta entry sets its rung from POSITION

Rung 2 is delta on a **held** object; rung 4 is delta on anything else — *self before other*. UD3
hardcoded rung 4, so a held delta would have lost to a critical finding on an unpositioned stock at
rung 3.

---

## C · Echo (§3.5) — three corrections

### C1 · Echo applies to CONDITION and TRANSITION only; **CLOCK_EVENT is excluded**

The library defines the echo gates without ever referencing temporal class, which §0.5 establishes.
Live:

> ~~"Ownership event — 2 block/bulk deals (₹157 Cr, two-sided) this window. It's showing in 5 of your 10
> scored holdings — 13 of the 95 stocks we score show it too."~~

Every number true, base rate genuinely low, every gate passed — **and the sentence means nothing**,
because a 90-day window catches whatever the market did.

- A **CONDITION** co-occurring describes the reader's **book composition**.
- A **TRANSITION** co-occurring describes a **synchronised move** — real, worth saying.
- A **CLOCK_EVENT** co-occurring describes a **time window** — not about the book at all.

**No base-rate gate can detect this; only the class can.** This is the horoscope failure mode wearing a
low base rate.

### C2 · Echo is an ANNOTATION, not a slot

UE can only fire when its own competition is guaranteed present: UE1 requires a pattern firing on *this*
object that *also* fires across the book — so whenever echo is eligible, an ELEVATED entry for the same
key is eligible too, at a higher rung. **Echo is structurally dominated by its own precondition.**
Measured: 25 resolved, 1 slot won.

When the echoing key is rendered by a host entry, the echo's arithmetic **attaches** to it:

> "Sliding from a high base — composite crossed down out of Pristine (74.1 → 63.6). It's showing in 8 of
> your 10 scored holdings — 38 of the 95 we score as of July 2026."

One slot, two facts, no duplication, no competition. When the key is not on the card, the echo does not
render — the finding lost its slot, and its echo is strictly less important. **Host precedence:
UD1 → UO6 → ELEVATED.** (Not a new concept: UN5 is already specified as a modifier rather than a
slot-consuming entry.)

### C3 · ⚠ POSITIVE ECHO DOES NOT FIRE — a BOUNDARY correction

The library permits positive echo on identical gates, and each half is individually legal. **The merge
is not:**

> "Clears every bar it's measured against — has for six quarters. It's showing in 5 of your 10 scored
> holdings — 14 of the 95 we score show it too."

That reads as *your book is full of good ones* — a verdict on the reader's **selection**, prohibited by
**Part IX·18** and named in §3.5.4 as this family's specific trap. A bare-counts variant does not
survive either: the adjacency alone carries the implication, and the register guard cannot detect a
verdict that lives in juxtaposition rather than vocabulary.

Negative and neutral echo are unaffected — exposure is legal to state. Only the constructive direction
implies a compliment.

---

## D · One claim, one owner

### D1 · §4.5 — UE defers to ELEVATED for the same key

### D2 · §3.4 — UD1 SUPERSEDES ELEVATED for the same key

A newly-standing finding renders **once**: in its UD1 form, with the novelty marker, at UD's rung. The
ELEVATED candidate for that key is suppressed entirely.

### D3 · §4.5 — UN6 defers to UE for the same key

### D4 · UH10 suppresses UG1; UO1 drops its peer-group clause when UG1 owns that fact

Live, UG1's "it isn't placed in a peer group…" and UO1's "Not yet placed in a peer group." put one fact
on the card twice in different words.

---

## E · Data-model corrections

### E1 · §1.3 — `coverage` is DERIVED; `StockScoringState` is dead

`resolveCoverage` reads a table with **zero rows and no writer anywhere in the codebase**, returning
`null` identically for a fully-scored stock and a never-scored one — the one distinction a coverage
state exists to make. Replaced by a five-state derivation over the in-force snapshot ref, the declined
set, and peer-group membership: `scored_full` · `scored_partial` · `scored_unknown_depth` ·
`covered_unscored` · `display_only`.

### E2 · §3.6 UG9 keys on EVALUABILITY, not `displayState`

`displayState: "pending_data_integration"` has **zero producers**; keying on it makes UG9 dead. It keys
on the persisted declined set, and renders a **capability** ("earnings quality"), never a rule ref — a
rule with no capability mapping is **dropped**, never rendered by ref (§0.9).

### E3 · §5.1 — `BehaviorRollup` is the store; `user_object_views` was never built

The library's "no per-view event log in v1" was **not honoured**: `AttentionEvent` is exactly such a log
and is retained under a 60-day prune. `BehaviorRollup` has no `surfacesSeen` field; it carries
`tabCounts` / `sectionExpandCounts`.

### E4 · §3.4 — the depth window is 60 days

Depth-derived copy says **"recently"**, never "never". Claiming a reader has never opened a tab, on
60-day evidence, is A1's failure mode in a different entry.

### E5 · §5.3 — base rates are an in-memory cache, not a table

Every number is derived and recoverable by one indexed aggregate, so durable storage is a **performance
optimisation, not a correctness requirement**. A nightly job warms the cache; a cold start computes on
demand. Deterministic across instances. Bounded staleness is acceptable **for a denominator rendered
beside its own as-of date** — it would not be for a score.

### E6 · §3.5 — every echo claim carries its own as-of date

Both counts alone are not self-describing: the universe changes on every rescore.

---

## F · Copy and register

### F1 · A seventh namespace — `UW` (Watchlist)

The position axis has three values but only HELD had body entries, so watchlist membership had no home
and the watched modes had nothing true to stand on. `UW1` = "On your watchlist since {monthYear}.",
rung 5, floor of M5–M8. **It is not UH** — UH's boundary language is exposure-based, and watchlisting is
not exposure. Its boundary names every inference §0.8 forbids:

> *"a watchlist is a record of what you asked us to keep an eye on — not a position, not an intention to
> buy, not evidence you are considering one, and not a judgement about the stock."*

### F2 · §3.1 UO6 fires on a positive finding WITHOUT a self-dated run

Duration remains the preferred carrier and a dated run always wins selection — but an undated positive
finding is still the object's strength, and still the correct **host** for an annotation. It renders
without a duration clause rather than not at all.

### F3 · §0.11 — a second copy field, `plainClaim`

The findings that win card slots carry text written for the **health tab**, in analyst register: "peer
μ 37.16, N=6", "sustained 2 snapshots", "the regime-robust tell". The card prefers a hand-authored
`plainClaim` carrying the **same facts and the same figures** in plainer words, and falls back to the
analyst verdict when none is authored. **No transformation at render time** — that would re-author the
finding's meaning (§0.10). The health tab is untouched.

### F4 · §3.1 UO3 — "every check we run" over-claims on a scope exclusion

R3/R5/P7/P8 are scope-excluded for banking and return `null` (a genuine not-fired), so they never enter
the declined set and the sentence implied they had run. Now: *"Nothing flagged — and every check that
applies to this company was able to run."*

### F5 · §3.6 UG7 names no action

*"You haven't **connected** a portfolio…"* described the state accurately but still named the action,
one edit from a prompt. Now: *"We don't have a portfolio for you, so this card can only tell you about
the stock itself."*

### F6 · §0.11 — plain register is where advice vocabulary leaks

A plain claim used *"both **reduced** their stake"*, which trips the shared advice deny-list
(`\breduc(e|es|ed|ing)\b`). Descriptive in context, but the guard scans vocabulary rather than intent —
and plain is precisely the register where "reduce" drifts toward instruction. Now "sold down".

---

## G · Entries NOT built, each with a named missing input

*Recorded rather than stubbed: a stub that never fires is indistinguishable from a built entry that
never fires, which is how dead catalog entries accumulate.*

| Entry | Missing input |
|---|---|
| UG2 | no populated `provisional` column (`StockScoringState` is empty) |
| UG3 | `ObjectState` carries no `priceFreshness` |
| UG4 | `ReaderBook` carries no unresolved-broker-row detail |
| UG10 | no published refresh-cadence definition per snapshot type |
| UN4 | no PG-native findings exist; the PGState fallback would be a re-derivation §0.7 forbids |
| UN5 | mask heat is a pure computation over cleaned price closes, not a read |
| UH5 | fund look-through does not exist as a capability |
| UH7/UH8 | need the **transaction**-delta path, distinct from the snapshot-delta UD1/UD3 use |

---

## H · Verification

The library declares twenty verification assertions and **not one had ever run.** That is precisely how
A1's false header shipped while the card looked perfect — and two assertions in the original harness
were written against **observed behaviour** and therefore actively **defended** the falsehood.

> **⚠ An assertion written against what the code does will always pass and is worthless.** Treat every
> existing assertion as suspect until re-derived from spec text. "It currently passes" is evidence of
> nothing.

`src/scripts/verify-relational-matrix.ts` — **64 assertions**, each naming the section it enforces.
Two entries are verifiable **only** synthetically and are among the most important in the build:

- **UD1** — no live reader has a stale stamped generation.
- **UG9** — the evaluability column is unmigrated, so `notEvaluable` is null everywhere and Standing
  Rule 7 requires silence.
