# Operator Decision Log (ODL)

Non-obvious judgment calls — the ones where **a reasonable person could have gone the other way**.
Routine implementation choices are not logged. Newest first.

---

## `cv2-fixture-input-not-output` · Stage 10b · A fixture may shape the INPUT; it must never supply an OUTPUT the production path would generate

**Decision (operator-ruled, from the pre-10b degradation review):**

> **A fixture may shape the INPUT. It must never supply an OUTPUT the production path would have to
> generate. The moment a test hand-authors a field the code writes, it stops testing the code and starts
> testing the fixture.**

**★ THE CASE THAT NAMED THE RULE.** `verify-phs-story.ts` §10 (fund-heavy) asserted that PI3 (dormant
scheme) enters movement 4 — and its fixture **hand-authored `storyClause`** on the PI3 finding. The real
`fireInstrumentFindings` wrote **no `storyClause` on any PI finding at all**, so PI could never enter
movement 4 in production, contradicting the addendum's own §8 example. The test was GREEN. It was green
because it fed the code the very output the code was supposed to produce, then checked that output was
present. **It proved the fixture had a `storyClause`, not that PI does.** The gap surfaced only when a
degradation review fired the REAL path and found the field absent.

**★ THIS IS THE SHARPEST STATEMENT OF A DISEASE THE LINEAGE HAS BEEN CIRCLING.** Four instances this
build, each asserting *something other than what it claimed*:
- `H()` asserting stock facts on a basket-natured holding (`cv2-s9-fixture-nature-gap`);
- Ex2 encoding **yesterday's** behaviour as the expected output (`cv2-s10a-fixture-scale` neighbourhood);
- the tier fixture testing **PC1 on a PC2 book** — the input triggered the wrong branch;
- and this one — a fixture supplying an output production doesn't produce.

`cv2-s9-fixture-nature-gap` and `cv2-s10a-fixture-scale` are the SHAPE half of this ("a fixture shaped
differently from production answers a different question"). This is the OUTPUT half, and it is more
insidious because it fails **silently green**: a mis-shaped input often throws or mismatches; a
hand-authored output just… agrees with itself.

**THE FIX THAT MAKES IT STAY FIXED: assert on the REAL fired findings.** §11 now fires
`fireInstrumentFindings` and checks that PI3/PI1 carry a clause the CODE wrote — so the day someone deletes
that clause, the test goes red. A fixture in a headline assertion is a standing invitation to test the
wrong thing; a real fired output cannot lie about what the code does.

---

## `cv2-glob-deletion-hazard` · Stage 10b · An over-broad glob in a repo with no version control is a live hazard — deletion needs a consumer gate

**Standing rule (operator-issued after the second irreversible near-miss):**

> **Deletion needs a gate: NAME what you are removing, PROVE nothing needs it, then remove. NEVER a glob.**

**What happened.** A cleanup `rm -f src/scripts/_probe*.ts` — meant to sweep this build's throwaway probes
— matched `_probe-cat2.ts`, a **pre-existing** script that predates this arc. The repo has **no version
control** (`git` is not initialised here), so the deletion is irreversible. It was surfaced honestly rather
than hidden, and the operator ruled **let it go** — reconstructing a probe from its filename would be
inventing a test, which reads as coverage while asserting nothing. But the *near-miss* is the lesson.

**★ THE SECOND IRREVERSIBLE-OPERATION NEAR-MISS, AND THE FIRST SET THE PRECEDENT.** The S1–S5 deletion
(`cv2-s6-delete-defer`) got a **repo-wide consumer grep** precisely because it could not be undone — and
that proof caught `r.structure`, a live consumer the prompt had asserted was gone. Deletion earned a gate
there. **A glob deletion skips exactly that gate:** it removes by *pattern* what should be removed by
*proof*. `_probe*` is a pattern; "the probes I created this session, each named and known to be dead" is a
proof. The two happened to differ by one file, and one file is enough.

**Sits beside `cv2-scheduler-hazard`** — its sibling in the "irreversible/ambient side-effect" class. That
one was a timer silently *writing* stale rows; this one is a glob silently *deleting* a live file. Both
fail without an error, both in a repo where the blast radius is unbounded, and both are prevented by the
same discipline: **before an irreversible operation, enumerate the exact targets and prove the set — never
delegate the set to a wildcard.**

---

## `cv2-s10b-select-not-suppress` · Stage 10b · Cross-axis redundancy is the STORY's problem, not the catalog's — the story picks, it does not suppress

**Decision (operator-ruled, built against `4c5ca537`): movement 4's two slots must describe DISTINCT
SUBJECTS. When two candidates trace to the same holdings, the story takes the higher-ranked and moves on
— the loser still fires, keeps its tone, and renders in the reference. Selection, NOT suppression.**

**★ THE THESIS BOOK, and it is the whole reason the rule exists.** `4c5ca537` holds one thing: TCS, 100%,
sector `it_technology`. It fires **PC2** ("dominant position", subject `TCS`) AND **PC4** ("single-sector
book", subject `it_technology`) — both Concern, both weight 1.0. The total order alone takes both, and
movement 4 reads *"TCS is 100% of your book. And IT is 100% of your book."* **One holding, described
twice.**

**★ NO EXISTING RULE CATCHES IT, AND THAT IS THE NON-OBVIOUS PART.** §11.1's anti-double-count
(`cv2-s9-suppression-model`) suppresses along ONE AXIS — PC2 kills PC1 (same position, two intensities),
PC4 kills PC3 (same sector, two intensities). Both did their job here; PC1 and PC3 are already gone. PC2
and PC4 survive because they are on **different axes** (position vs sector), and the suppression model has
no opinion about two axes that happen to resolve to the same money. **The redundancy is not in the
findings. It is in the book** — and a rule about the book's shape is a property of one paragraph, not of
the catalog.

**★ WHY SELECTION AND NOT SUPPRESSION — the distinction a reasonable person would collapse.** The obvious
move is to suppress PC4 like PC1/PC3. It is wrong: **PC4 is TRUE.** On a 12-holding all-pharma book,
"single-sector book" is the ONLY way to say what is wrong — the position axis is silent there. So PC4 must
keep firing, keep its tone, and render in the reference. What must not happen is the STORY saying it twice.
*"The story picks."* Nothing about the fired set changes; `selectMovement4` returns what the story SPENDS,
and the reference returns everything.

**★ IDENTITY, NOT OVERLAP — and this is the second place the obvious call is wrong.** The collision test is
SET EQUALITY, not intersection. A 40%-pharma book where SUNPHARMA is 20% fires PC1 (`{SUNPHARMA}`) and PC3
(`{SUNPHARMA, CIPLA, DRREDDY}`). Those OVERLAP — and they are two genuinely different facts ("one name is
heavy" / "the sector is heavy") with different remedies. Collapsing on overlap silences the sector fact on
every book where a sector has a big name in it, which is most of them. **The sets must be EQUAL.**

**And the trace goes through the LEDGER, never the label.** `it_technology` and `TCS` share no characters
and are the same holding; the entity ledger already carries `EntityLedgerEntry.sector`, so `subjectSetOf`
reads it. Comparing `bind.sector` to `bind.symbol` as strings answers "are these the same words" when the
question is "are these the same money."

**Two adjacent rulings folded in, each defensible either way:**
- **The total order's tiebreak is `id` ascending — a MEANINGLESS key, on purpose.** §5 says "higher
  capital weight first", but 5 of the 13 movement-4 findings carry NO capital weight (PC5/PB1/PB2/PB3/PB7
  bind `neff`/`holdingCount` — shapes, not shares). A missing tiebreak does not fail loudly; it lets
  `Array.sort`'s input-order stability decide, so the story is reproducible until someone reorders a
  `push` in `patterns.ts`, then silently changes. `id` is total, stable, and carries no meaning — which is
  exactly what a tiebreak should be. Asserted by SHUFFLING the fired set and requiring byte-identical output.
- **An unweighted finding's weight is `null`, not `0`.** `?? 0` typechecks and would sort the same today.
  But PC5's subject is the whole name-risk sleeve, so `0` asserts "this finding is about 0% of the book"
  when it is about all of it — a false statement waiting to rank a whole-book fact below every named
  position the day someone adds a finding whose weight is genuinely 0. `null` says "the axis does not
  apply", which is the truth.

---

## `cv2-s10b-story-zero-homes` · Stage 10b · The storyboard is composed at read and stored nowhere — a fact with zero homes cannot drift

**Decision (operator-ruled): the story is a DETERMINISTIC derivation over the fired set, `band`, `state`
and the Construction ledger — composed at the read, persisted nowhere, no fingerprint of its own. The
Gemini layer does not write it.**

**★ WHY DETERMINISTIC AND NOT GENERATED — the call a reasonable person makes the other way, because a
model writes nicer prose.** Three reasons, and the second is the load-bearing one:
1. **Identical books must produce identical stories.** The storyboard is a STATEMENT OF FACT about
   someone's money; it cannot vary by sampling. `verify-phs-story.ts` asserts byte-for-byte equality
   across runs AND under permutation of the fired set.
2. **★ Every non-negotiable — never advise, never predict, never juxtapose health against returns — is
   ENFORCEABLE IN A GRAMMAR AND UNENFORCEABLE IN A GENERATION.** The advice-verb grep can PROVE a composer
   cannot emit a sentence the guard rejects. It cannot prove that of a model, ever. The determinism is not
   a limitation accepted for reproducibility; it is the only thing that makes the guarantee a guarantee.
3. The Portfolio Doctor is the generated job — a CONVERSATION (asked, scoped, guarded). The storyboard is
   a STATEMENT (unasked), held to a higher bar precisely because nobody asked for it.

**★ WHY ZERO HOMES — and why persisting it "for a story history" is the trap.** The story stores nothing:
it derives from things that already have homes, the way `band` derives from `health`. A stored story is a
claim about someone's money frozen at a moment and re-served forever while every fact under it moves —
PD7's stale-by-construction bug (`cv2-s10a-pd-read-time`) applied to four paragraphs. So it composes in the
read controller, from `constructionData` (already persisted) + the fired set + the two scores. **Zero new
data access**, enforced by availability: `sectoredShare` is C3's `subjectShare`; `allSymbols`/`nameRiskSymbols`
come from the entity and basket ledgers, which is why Stage 7/9 persisted them.

**⚠ THE DEPLOYMENT NOTE, AND THE FALSE-ALL-CLEAR IT HID (corrected after a degradation review).**
`storyClause` rides on the persisted finding, so a snapshot fired before Stage 10b carries PC/PB findings
with NO clause. The FIRST design let it *"compose movements 1–3 only"* — and that was **wrong, and
dangerous**: on a 100%-concentrated book, movement 4 (the concentration, its whole point) would be
silently empty, and if PX6 fired, movement 3 would DANGLE (*"on that alone you'd read 51"* with no payoff).
A reader sees a setup with no point and stops reading — the one failure mode no later finding corrects
(`cv2-s9-constructive-most-conditioned`). **The fix: `composeStory` returns `null` on a pre-10b snapshot**
(`isPreStoryboardSnapshot` — a persisted PC/PB finding lacking a clause, which every fresh one carries),
degrading exactly as a pre-Stage-9 row does. **The states are distinguishable and the composer
distinguishes them:** *"candidates skipped for a missing clause"* (stale → null) ≠ *"no candidates"*
(genuine quiet → a valid short story) ≠ *"an all-clear was selected"* (PB1 with a clause → renders). The
story populates fully on the row's next recompute; the two panel reads never needed `storyClause` and are
unaffected. **A narrative missing its climax should not ship — better no story than a half-told one.**
(A second bug the review surfaced: the read-time PI family carried no `storyClause` at all, so PI could
never enter movement 4 despite the addendum's §8 example — fixed by giving the headline PI facts, PI1's
evaluable premium and PI3's dormancy, a clause; the quiet/not-evaluable PI facts stay reference texture.)

**Drift #13 and #14, both caught by building:** §3's feeder cites **PV3** (retired in spec 1.2 — the
coverage ceiling is gone), so movement 2 reads from **PV2**, the live finding. And §9.2's eligibility list
omits **PQ and PS entirely** — `MOVEMENT_HOME`'s exhaustive throw fired on the FIRST real book (`4c5ca537`
fires PS5), which is the map earning its keep: both are movement-3 pillars (PQ is Quality's shape, PS is
Signals'), and filing them anywhere else would put a pillar's own finding outside the movement that reports
the pillars.

---

## `cv2-s10a-refusal-nesting` · Stage 10a · A refusal at a shorter window contaminates every longer one — the findings layer enforces what the fold's own refusals imply

**Decision (operator-ruled): PI5's ladder inherits a refusal ACROSS NESTING. A rung is evaluable only if
it AND every shorter rung nested inside it are. No fold change.**

**★ THE INVARIANT, and it is the durable part:**

> **A longer window CONTAINS every shorter one. There is no arrangement in which the 1-year series is
> untrustworthy and the 5-year series — which includes it — is fine.**

**WHAT IT CAUGHT — a shipped falsehood, live, on 65 rows.** The 65 that carry `max_drawdown_5y` with no
`max_drawdown_3y` are not a nesting curiosity. Every one is a **segregated (side-pocketed) credit
portfolio** — UTI Medium Term Fund *(Segregated - 17022020)*, Nippon India Medium Duration Fund
*(Segregated Portfolio 1)* — frozen since Jan 2022, 154 NAV points, and **`max_drawdown_5y` is exactly 0**.

The fold **refused that same series three times**: `vol_1y`, `vol_3y` and `ret_1y` are all
`withheld_implausible`. Then it published a 0% drawdown off it. Doc 2's trigger — *"`maxDrawdown` present"*
— **would have told the holder of a defaulted-debt side pocket that their fund has never fallen.** It is
the worst sentence the PI family could produce, and the spec asks for it in three words.

**THE CAUSE IS IN THE FOLD AND IS NOT REPAIRED HERE (filed T-4).** `mf-implausible.ts:103` passes
`vol: null` for the y5 window — *"vol_5y is computed for Sharpe but never stored"* — so **the 5-year window
is never volatility-tested.** y1 and y3 tripped `VOL_MAX` and were cleared; y5 saw a drawdown of 0, found
it unremarkable, and shipped. **The guard states the principle it then fails to apply across horizons**, in
its own header: *"a window's return, its volatility, its drawdown are all folded from the SAME stretch of
NAV — so if that stretch is not describing the fund, none of them is."* It says *a* window. The bug is that
nothing says *nested* windows.

**★ WHY THE FINDINGS LAYER IS THE RIGHT HOME FOR THE INVARIANT, AND NOT A WORKAROUND.** The tempting read
is "the fold has a bug; the finding is routing around it." It is the opposite:

- The fold's refusals are **facts on the row**. The invariant is a **property those facts already imply** —
  it derives the 5y refusal from the 3y refusal the fold itself wrote. It adds no judgment; it declines to
  discard one the fold already made.
- A fix in `mf-implausible.ts` re-folds 14,041 rows and is **fold work in a findings batch** — the same
  refusal `cv2-s10a-pi2-honest-null` makes about a Direct-twin resolver (doc 2 §13.2).
- **And the invariant outlives the bug.** Repair T-4 tomorrow and this loop still holds: it is not "work
  around the y5 hole", it is "never launder a refusal through a window that contains it." The y5 hole is
  one way to violate it. It will not be the last.

**THE KEY IS THE REFUSAL, NEVER THE VALUE — and that distinction is the whole ruling.** Suppressing
`dd5 == 0` by value was available and is wrong: **730 live rows carry a zero drawdown and most are true.**
An overnight fund's NAV really does only go up. Keying on the value would invent a second, unstated rule
("zero is suspicious") that no ruling supports and that silences honest funds. Keying on the refusal
silences exactly the 65 and nothing else. **Asserted in both directions** — the side pocket goes
not-evaluable; the overnight fund still ships its 0.0%.

**Generalises past PI5.** Any laddered metric over nested windows (`ret_*`, `sharpe_*`, `tracking_error_*`,
`beta_*`) has this shape, and `mf-implausible.ts`'s WINDOWS table is already horizon-scoped *by design* —
*"withholding the whole row would destroy two sound windows to suppress one bad one"*, which is correct
**within** a horizon and silent about nesting **across** them. The guard scopes; the finding nests.
Both are right; neither is complete alone.

---

## `cv2-s10a-unclassified-is-a-class` · Stage 10a · An ambiguous code is omitted, never bucketed — and the type must permit that

**Decision (operator-ruled): `OMISSION_CLASS` becomes `Partial<Record<OmissionCodeValue, NullReasonClass>>`,
and the two unclassifiable codes are ABSENT from it — named instead in an explicit `OMISSION_UNCLASSIFIED`
map, each with a written reason.**

**★ THE TYPE WAS FORCING A FABRICATION TO SATISFY ITSELF.** A total `Record` was written under the
assumption *"every code is classifiable."* **The assumption is false** — two codes carry **two classes for
one null** — and a total type does not discover that, it **compels an answer**. The type should describe the
world, not compel it. The taxonomy's own law already had the answer: **an ambiguous code is OMITTED, never
bucketed.** No class → no sentence shape → the field is not rendered. **It is `not_sourceable` one level up:
we do not have the classification, and that gap is ours.**

**★ BUT `Partial` ALONE WOULD HAVE BEEN A REGRESSION, and this is the sharp half.** It makes a **forgotten**
code look **identical** to a **deliberately unclassified** one — which is *exactly* the confusion the four
classes exist to abolish for data, **reappearing one level up in the taxonomy itself**. So absence is never
the signal:

```ts
OMISSION_CLASS:        Partial<Record<OmissionCodeValue, NullReasonClass>>  // 21
OMISSION_UNCLASSIFIED: ReadonlyMap<OmissionCodeValue, string>               // 2, each with a written reason
```

**The gate goes tri-directional** — stronger than the bidirectional one it replaces:
- `found ⊆ (classified ∪ unclassified)` — **no code forgotten**
- `(classified ∪ unclassified) ⊆ declared` — **no phantom** (the arm that caught `no_distributions_in_window`)
- **`classified ∩ unclassified = ∅`** — a code cannot be both
- **every `UNCLASSIFIED` entry carries a written reason** — *"we decided"*, never *"someone forgot"*

**★ THE PREMISE FAILURE THAT PRODUCED THIS.** I argued the two codes were correctly single-classed:
*"the halves explain different metrics — beta-vs-Nifty, which we have a column for, and beta-vs-gold, which
we don't; you cannot have an omission reason for a column that does not exist."* **Measured, both codes
explain exactly one key — `benchmark` — across 25 and 538 rows.** Both halves answer the *same* question
(*"why does this fund have no benchmark?"*), which is precisely what makes them two codes rather than one
ambiguous one. **The distinction I drew was one the data does not make. Argued first, measured second; the
measurement won** — and it won against an argument I found convincing while making it.

**A related count, same lesson, same session:** this file's header claimed `mf-omissions.ts` declares **26**
codes. It declares **23**. I wrote it twice, from reading rather than counting, and the gate printed the
real number the first time it ran. **The gate is not there to confirm what you know; it is there for what
you are sure of.**

## `cv2-s10a-bidirectional-gate` · Stage 10a · A one-directional check cannot tell "I classified everything" from "I only looked at what I'd already classified"

**What happened.** The gate asserting the null-reason taxonomy is exhaustive scanned the ingestion guards
for reason literals and reported ***"5 literals, all known"*** — **green, and blind to a sixth**.
`no_distributions_in_window` is declared in `reit-distributions.ts` as `reason: "no_distributions_in_window"`
and only renamed onto `distributionYieldNullReason` a file away, so the literal **never shares a line with
the word the scan required**. The gate was **right by luck**, and it would have printed the same green line
had the reason been **invented**.

**★ THE GENERAL FORM — and it is the shape of every dead guard this session:**

> **A one-directional check cannot distinguish "I classified everything" from "I only looked at what I'd
> already classified." Its SCAN defines its own SUBJECT, so it can only ever confirm itself.**

Seven guards this session read as coverage and could not fire. Every one had this structure: the thing
being checked and the thing defining what to check were the same thing. **"Inert on this cohort" is this
bug with a population instead of a regex.**

**The fix — assert BOTH directions:**
- `found ⊆ known` — no literal the ingestion writes goes unclassified. *(A seventh reason fails the build.)*
- **`known ⊆ found` — ★ no reason in the map is FABRICATED.** This is the arm that catches phantom
  citations, and **it is the arm that caught this**: `no_distributions_in_window` was in my map and not in
  the scan's output, which is a contradiction the one-directional version could not represent.

**★ AND THE HOLE IS KEPT AS A TEST.** `verify-phs-pd-readtime.ts` §8 **re-runs the original narrow scan**
and asserts it finds exactly 5 of 6. **A fixed bug with no witness gets reintroduced** — the next person to
"simplify" the scan back to one direction fails a test that explains why, rather than rediscovering it.

**Same family as `cv2-s10a-nullreason-honest`'s column-name grep** (*"a column-name grep cannot see a JSON
key"*): both are searches whose **method silently bounded their subject** while reporting on the subject.

## `cv2-s10a-not-a-gap-vocabulary` · Stage 10a · Don't raise absence at all — even to deny it

**Decision (operator-ruled, verbatim):**

> **The rule for `not_a_gap` is stronger than "don't assert absence" — DON'T RAISE ABSENCE AT ALL, EVEN TO
> DENY IT, because a sentence arguing with a gap has already planted one.**

**What happened.** The first `no_distributions_in_window` sentence read *"…there is no yield to report,
**rather than one we are missing**."* The absence-vocabulary gate matched `missing` — **inside a clause
denying missingness.** That is textbook false-positive shape, and Stage 9 has a ruling that fits it exactly:
*"a gate that mislabels correct copy trains people to edit until it shuts up."* **The reflex was to loosen
the gate, citing our own precedent.**

**The reflex was wrong, and the sibling proved it.** `discount_instrument` passed on the first draft by
**just saying what the instrument does**: *"it pays no coupon at all — it is issued at a discount and
redeems at par, which is how it pays."* No negation, no gap raised, nothing argued with. **The positive form
existed the whole time.** The gate was not mislabelling correct copy — **it had found the weaker of two
sentences, and the stronger one was already sitting three lines below it.**

**★ THE META-LESSON, which is why this is logged.** Stage 9's ruling is right. It was applied to the wrong
case. **A correct precedent invoked against the wrong instance is more dangerous than no precedent** — it
arrives with authority and shuts down the check. The tell: the precedent says *"the gate is wrong"*, but the
gate's rule (never raise absence for a not-a-gap reason) is **stateable, defensible and checkable on its
own**, and one of the two sentences under it already obeyed it. **When a precedent and a passing sibling
disagree, look at the sibling.**

Rewritten: *"it has not made a distribution yet — a trust that has paid nothing has no yield, and zero
payouts is itself the answer."* The gate stays blunt **on purpose**, and the reasoning is recorded at both
the copy and the gate so the next person does not re-loosen it.

## `cv2-s10a-pd-read-time` · Stage 10a · The PD family is read-time because of its SUBJECT, not its inputs

**Decision (operator-ruled): all seven PD findings fire at READ. Not just PD4 — the whole family.** The
spec asked one question — *"is PD4 read-time like PE6, or persist-time? Answer it, don't inherit it"* —
and the answer generalised to every sibling.

**★ THE ARGUMENT, and it is the durable part:**

> **A PD FINDING DESCRIBES VYTAL, NOT THE BOOK.** The persisted row is a snapshot of the **user's
> portfolio**. A fact about **our data coverage** has a **different subject** — wrong subject, wrong
> lifetime, wrong home. **It was never eligible for the book's snapshot in the first place.**

**Doc 2 named this without noticing it had named the home.** *"Facts about OUR DATA, not about the
holding"* and *"reference only, always."* The family's own definition implies its address; nobody read it
as an address.

**This is a SECOND door into `read-time-findings.ts`, distinct from PE6's.** PE6 is read-time by
**provenance** (`cv2-s7-refuse-live-facts`: the fired set is derived from hashed inputs; `heldNotValued` is
a live fact). PD is read-time by **subject**. Same module, two different reasons — and the module's header
now says so, because a reader who knows only the PE6 rule would test PD against it and get the right answer
for the wrong reason.

**PD7 makes it unarguable.** `oldestSyncAgeDays = f(now)`, and `fingerprintOf` has **no time input** (its
inputs: weights, entities, natures, sectors, houses, health ids, finding ids, tierAsOfDate, matcher, cv).
A persisted PD7 gets **no new fingerprint, no write**, and serves *"synced 3 days ago"* forever —
**stale-by-construction, the exact bug the hash exists to make impossible.** PD1/PD2/PD3/PD5 fail the same
way more slowly: they change when **we** improve, not when the user trades, so freezing *"we have no credit
ratings"* means every stored row still says it the day after we source ratings.

**★ AND IT MADE A SEPARATE REQUIREMENT EVAPORATE.** The spec asked how PD1's *"never suppressible"* would
be enforced, and worried — correctly — that a flag the triage respects is weak: *"structural is better;
never-suppressible should not depend on a sort."* **Read-time IS the structure.** Triage and ranking
operate on the **persisted** fired set (`reshapeSnapshot` partitions `s.firedFindings`); PD is never in it.
**The sort does not decline to drop PD1 — the sort never sees it.** No flag to respect, no flag to forget.
*When a ruling makes a separate requirement disappear rather than satisfying it, the ruling is load-bearing.*

**Two consequences that fell out of the same argument, both kept:**
- **PD sits BESIDE `snapshot` on the wire (`referenceFindings`), not inside it.** Nesting a fact about us
  under a heading about them would repeat the persistence-layer mistake at the payload layer.
- **PD is served when `snapshot` is null.** *"We cannot source a credit rating for your bond"* is true
  whether or not we have ever scored the book. **A finding that needed the snapshot to be true would not
  have belonged in this family** — the subject argument, checking itself.

**⚠ The live hazard this leaves.** `reshapeSnapshot`'s health arm is a **catch-all**
(`!CONSTRUCTION_FAMILIES.has(f.family)`), so a PD finding handed to it lands in the **health read** —
silently, as though *"we can't rate your bonds"* were a judgment about the book. Asserted in
`verify-phs-pd-readtime.ts` by smuggling a PD1 in and watching it mis-route. **PD's safety is that it is
never passed to the router, not that the router knows about it.**

## `cv2-s10a-nullreason-honest` · Stage 10a · The catalog's honest-null design is richer than the spec, and invisible to schema-level search

**What the spec assumed.** Doc 2's PD section names **three** null reasons: `not_sourceable` (our gap),
`not_in_source` (the world's), `no_distributions_in_window` (nobody's — a fact). **The catalog has six**,
and they partition into those same three classes:

| reason | population | class |
|---|---|---|
| `not_sourceable` | creditRating **356/356 bonds** · yield **571/571 debt** | our gap |
| `not_in_our_universe` | issuer, **165/356 bonds** | our gap |
| `unparseable_name` | coupon, 25 bonds | our gap (a parser limit) |
| `not_in_source` | maturityDate, **515** | the world's gap |
| `no_distributions_in_window` | 1 reit + 2 invit | **not a gap — a fact** |
| `discount_instrument` | coupon, **54 gsec** | **not a gap — a fact** |

**★ THE RULE (operator-ruled): the CLASS picks the sentence SHAPE; the REASON picks the SENTENCE.** Six
reasons, three shapes, **never one bucket** — the same law as PV4/PV5/PV6.

**★ THE CATCH THE THREE-ROW TABLE WOULD HAVE CAUSED.** `discount_instrument` is `no_distributions_in_window`'s
**sibling**, and the spec did not know it had one. Ship the three-row list literally and **54 T-bills render
as "coupon unavailable"** — telling a user we are missing a number **that does not exist**. A T-bill is
issued at a discount and redeems at par; that *is* the instrument. **Inventing a gap in our own data to
apologise for is the precise disease "never collapse" exists to prevent, and the spec's own list would have
committed it.**

**The ingestion layer already knew, in its own words** (`govt-guards.ts:160`):
```ts
base.couponNullReason = "discount_instrument"; // NOT a gap — a T-bill genuinely has no coupon
```
**The distinction was recorded at write and lost on the way to the read.** That is the shape of the finding:
not that the data was poor, but that it was **better than the spec that consumed it**.

**★ WHY IT WAS INVISIBLE — a column-name grep cannot see a JSON key.** The reasons live in
`instruments.attributes` (JSONB). `attributes` had **never been selected anywhere in the portfolio path** —
`partition()` takes id/assetClass/lastPrice/lastPriceDate/currentNav/navDate/isActive/isin/category — so
every `*NullReason` the ingestion has stamped since Step 17 was **unreachable from the read**. My own first
search for PI7/PI8's inputs reported them absent for exactly this reason, and had to be self-corrected.
**A schema-level search answers "is there a column for this?" — never "is there a fact for this?"**

**Runtime rule: an unknown reason is OMITTED, never bucketed.** `classifyNullReason` returns null and every
render site skips the field. It does **not** throw (a read path that 500s the portfolio because an ingestion
added a reason is worse than what it prevents) and it does **not** fall back to *"unavailable"* (that is the
collapse, committed in the case we know least about). **Degrade by omission — honest; never by mislabel —
the disease.** The build catches the seventh reason instead: `verify-phs-pd-readtime.ts` scans the ingestion
guards **in both directions** — no unclassified literal, and **no fabricated reason**.

## `cv2-s10a-fixture-scale` · Stage 10a · A fixture's SHAPE is its meaning — the fourth instance

**Decision (operator-ruled): scale §10's four example books ×100,000. Weights unchanged.** PA2 fires on
`avgPositionValue < ₹10,000`, and the §10 fixtures were written with weights summing to **₹100** — so every
example book was a hundred-rupee portfolio and PA2 fired on all four. The three options were: scale the
fixtures (taken), accept that PA2 fires everywhere (rejected — *"a ₹100 book is not what the fixture
means"*), or move the threshold (rejected, and **named**: *"inventing a threshold to make a harness green"*).

**★ THE POINT.** The §10 books were authored to exercise **weights**, and every rule they were written for
is scale-invariant, so the value column was never meaningful — it was **notation**. PA2 is the library's
**one value-dependent finding**, and it read that notation as a fact. **The fixture was not wrong when it
was written; it became wrong when a new reader asked it a question it had never been asked.**

**Fourth instance of the fixture-shape disease** (after `cv2-s9-fixture-nature-gap` and two others): a
fixture that is *shaped* differently from production data silently answers a different question than the one
the test is asking. **A fixture is not a convenience; it is a claim about what production looks like.**

**★ THE OBLIGATION THE OPERATOR ATTACHED, and it is the real ruling: ASSERT §10's VALUES BYTE-IDENTICAL
BEFORE AND AFTER.** The edit touched drift-immune canon, so *"Construction and Health are weight-only"* was
exactly the kind of true-sounding argument that must not be argued. `verify-phs-patterns` §10.1 now **re-runs
Ex1/Ex2 unscaled** and proves it:
```
Ex1 · Health 70 · Net 91.1952 ≡ 91.1952   (₹1,00,00,000 vs ₹100)
Ex2 · Health 72 · Net 46.5000 ≡ 46.5000
★ …and the ONLY difference is PA2 — the one value-dependent finding in the library
```
ACCEPTANCE 3's *"portfolio value never enters any number"* is now **proven at the point of the change**
rather than assumed by the person making it.

## `cv2-s9-stale-prisma-client` · Stage 9 · The generated client is a THIRD home for the schema's truth, and it drifts silently

**What happened.** `structure_ledger` was made nullable by migration `20260716180000` (applied, `migrate
status` clean, `schema.prisma` reading `structureLedger Json?`). Days later, when persist **stopped
writing the column**, tsc failed: *"Property 'structureLedger' is missing… but required in type
`PortfolioHealthSnapshotUncheckedCreateInput`."* The DB said nullable. The schema said nullable. **The
generated client still said NOT NULL.** `npx prisma generate` fixed it in 1.2s.

**★ THE POINT — the client is a THIRD HOME for one fact, and it is the one nobody looks at.** The column's
nullability lives in: the **database**, `schema.prisma`, and `src/generated/prisma`. Two homes drift
(`cv2-s7-jsonb-single-source`); three drift worse, because the third is machine-written and therefore
assumed correct. And it **cannot be caught by reading** — the file is 10k lines of generated code with the
whole schema inlined as a string, which is exactly why the repo-wide consumer grep had to exclude it.

**Why it stayed hidden for days: NOTHING READ THE DIFFERENCE.** A stale client is invisible while the code
keeps doing what it always did — every insert supplied `structureLedger`, so the NOT NULL type was
satisfied and never questioned. **It surfaced only when behaviour changed** (the column stopped being
written). **A skew that only manifests on the next behaviour change is a landmine with a timer set by
someone else's edit.**

**★ THE STANDING RULE, both halves:**
1. **After ANY schema change, regenerate.** The migration is not the end of the change; the client is.
2. **When the code says X and the DB says Y, CHECK THE CLIENT BEFORE THE SCHEMA.** The instinct is to
   suspect the migration or the schema — both were right here. The client was the liar, and it is the only
   one of the three that no one thinks to read.

**Same family as `tsx-scripts-need-backend-cwd`:** an environment fact producing an error message that
points confidently at the wrong layer. There, a missing `.env` produced Prisma's *"Can't reach database
server"* — an outage that was not an outage. Here, a stale client produced a type error about a column
that had been nullable for days. **Both cost real time because the error named a plausible innocent.**

## `cv2-s9-a10-construction-historical` · Stage 9 · §A.10's Structure values are historical canon for a DELETED model — dropped, not re-derived

**Decision (operator-ruled): `verify-phs-examples` DROPS its Construction assertions and keeps
Health/Quality/Signals.** §A.10's Structure figures — *"Structure = 100 − 25 − 18.2 − 10 = 46.8"*,
*"Construction = 55 (S1 0 · S2 −25 · S3 −20)"*, *"≈ 86.1"* — are **S-RULE ARITHMETIC**. S1–S5 are deleted
(§15). Those numbers describe a model that no longer exists. **They were true when written, and they are
still true about that model.**

**★ WHY NOT RE-DERIVE UNDER C1–C6 — the measured values were 55 → 21, 80 → 51, 86.07 → 75.62.**
Recomputing produces a number that **LOOKS like a §A.10 value and is not: a NEW FACT WEARING AN OLD
CITATION.** Nobody downstream could tell whether 21 was **ruled** or **inherited**. That is the exact
disease this stage caught three times — doc 2's fabricated `engine.ts:207-223`, the phantom
`catalog.ts:31`, and Ex2's status-quo expectation. **A citation's authority comes from what it cited; put
a new number behind it and the authority is counterfeit.**

**And §A.10 never asserted Construction's correctness in the first place.** It is a **PART-A worked
example**: its job is the Quality/Structure/Signals → PHS **composition**. The Structure figure was an
**INPUT demonstrating that arithmetic**, not a claim about Structure itself. Recomputing it would not make
the example right — **it would make it a DIFFERENT EXAMPLE SITTING AT THE SAME SECTION NUMBER.**

**Nothing is left unasserted — the test that settles it.** Construction canon is **§10 A–D**, which were
**WRITTEN to assert Construction** (B is the 5-stock book; C is the NTPC aggregation at 79.4; D is the
theme overlap at 60.6) and were ruled drift-immune and EXACT at Stage 6 — they survived every stage. Plus
the stress table, the invariants (C1=0 equal-weighted at any N · C4=0 distinct-sector · monotonicity) and
the identities. **§A.10's Construction values were REDUNDANT COVERAGE OF A SUPERSEDED MODEL. Dropping
them removes nothing still true.**

**The split is clean: §A.10 owns HEALTH composition** (Quality/Signals/PHS — held EXACTLY at 80 / 71 /
71.2 through the deletion) **· §10 owns CONSTRUCTION** (A–D). **Neither needs to describe the other.**

**★ THE REASON IS PRESERVED, NOT JUST THE DELETION** — in the harness header and here. Otherwise someone
finds §A.10, sees a Structure number, sees no assertion, and **"restores" it**. In the doc-2 pass §A.10's
Structure line gets a note — *"S-era; superseded by §10 A–D under portfolio-spec 2.0"*. **Do not delete
the historical record; MARK it.**

**Two reads were NOT dropped, because they were real coverage §10 does not have — repointed instead:**
- **`verify-portfolio-union`'s union bug-fix.** It asserted *"aggregated S1 charges MORE than split lines
  would"* (S1 read POSITIONS, so one 40% holding split across two accounts read as two 20% holdings and
  escaped the threshold). **Repointed to C1 — and the property got STRONGER: split ≡ aggregated.** C1
  reads ENTITIES, and both lines carry the same ISIN, so `buildEntityLedger` merges them **before C1 ever
  sees them.** The v1 fix made the union do the aggregating; **the entity model makes the aggregation
  STRUCTURAL — a split line is not a thing C1 can be fooled by.** The assertion moves from "a bug-fix
  holds" to "the bug is unrepresentable", which is the statement that stays true.
- **§2.4 source-invariance** (manual vs mirrored ⇒ identical numbers) and the **value-invariance copy
  lock** (₹1L vs ₹50L ⇒ copy moves, no number does) — both repointed to `construction.net`.

## `cv2-s9-pq2-pq4-gap` · Stage 9 · The PQ seam has a KNOWING gap at Mixed-name-at-size — a decision, not an oversight

**The gap, stated so nobody closes it.** `BAND_MIXED = 50` and PQ4 fires on `health < 50`. A book like
`{78, 51, 70, 72, 79}` fires **nothing** in the PQ family: PQ2 is silent (σ 11.29 < 15 — the average
describes three of five, so it is not a fiction), PQ3 is silent (Quality 70 > 55), and **PQ4 is silent
because 51 is MIXED, not Weak.** Asserted in `verify-phs-patterns` as intended silence.

**★ THE TEST THAT SETTLES IT — WHAT WOULD THE SENTENCE BE?** *"You hold a name at 51 in a book averaging
70"* … and then what? **It isn't weak.** The average isn't lying. **The only sentence left is a nudge
toward a name the engine has explicitly declined to flag — ADVICE WEARING A FINDING'S CLOTHES**, which is
§1's exact prohibition. **The truth about that book is: it is a fine book with an ordinary name in it.
Nothing to say.** A library that must say something about every book will say something untrue about
most of them.

**PQ4 is bounded by `BAND_MIXED` DELIBERATELY.** It is *"Weak name at size"*, not *"name I'd rather you
didn't hold at size"*. **Mixed is the band that exists to say "ordinary, not concerning."** A finding
named WEAK firing on a name the engine calls MIXED would **contradict the band system it is built on** —
the bands would mean one thing in the score and another in the findings.

**Extending PQ4 to Mixed-and-below was considered and REJECTED — it is PB7's disease.** It would fire on
**any 10%+ position scoring under 65**, an enormous share of real books. **A guard that fires on
everything is the mirror of one that fires on nothing** (`cv2-s9-pb7-ratio`): manufacturing coverage by
making a Caution meaningless. **Closing a gap is not free — the price is every book it then misdescribes.**

**The decay that produces the gap is the rule declining to over-claim as its evidence thins.** σ falls as
mid-names are added *while the 78/51 split is still there*, because **every mid-name is evidence that the
average is HONEST.** The seam is clean where it matters: **PQ2 = the average is a fiction · PQ4 = this
name is weak AND big enough to matter · PQ3 = the average is honest, and ordinary.** `{78,51,70,72,79}`
is none of those — correctly.

**★ THE OPERATOR'S HANDOFF CLAIM WAS RIGHT ABOUT THE MECHANISM AND WRONG ABOUT THE EXAMPLE — and the
fixture now says so.** The ruling asserted *"`{78,51,70,72,79}` falls to PQ4, where it belongs — not
through a gap"* and *"PQ2 ∧ PQ4 co-fire on 78/51."* **Both measured FALSE**: doc 2's Tata Motors sits
**ONE POINT** outside PQ4's band (51 vs 50) **by coincidence**, so doc 2's own example cannot demonstrate
the co-fire it motivates. The mechanism is real **for weak names** — proven on `{78, 45}`, where PQ2 and
PQ4 co-fire (different facts that AGREE ⇒ both fire, `cv2-s9-suppression-model`). **The fixture uses 45
deliberately; the 51 case is asserted as PQ2-alone.** When an example and a mechanism disagree, fix the
example and keep the mechanism — but only after measuring which one is wrong.

**Leaving the suite RED pending this ruling was right — the second time this stage.** Asserting PQ2's
silence alone would have been the **test-asserting-the-status-quo** disease (`cv2-s9-suppression-model`):
green, and proving nothing.

## `cv2-s9-suppression-model` · Stage 9 · Suppress for REDUNDANCY or FALSITY — triage is for findings that are all TRUE

**The question neither doc asks, and both are consistent with the answer:**

> **★ SUPPRESS when siblings describe the SAME FACT at different intensities.
> DO NOT SUPPRESS when they describe DIFFERENT FACTS.**

| pair | fact | verdict |
|---|---|---|
| **PC1 / PC2** | one entity's weight, two thresholds | **suppress — REDUNDANCY** |
| **PC3 / PC4** | one sector's weight | **suppress — REDUNDANCY** |
| **PC6 / PC7** | one house's weight | **suppress — REDUNDANCY** |
| **PB1 / PB7** | **different** facts (name-breadth vs sector-survival) that **CONTRADICT** | **suppress — FALSITY** |
| **PX vs PC/PB** | different facts that **AGREE** | **both fire** (§11.1 already says so; never merge) |

**This reconciles the two docs instead of picking one.** Doc 1 §B.8 triages by tone (*"Priority order when
several fire: Concern > Caution > Neutral > Constructive"*) — which presumes siblings co-fire. Doc 2 §11.1
suppresses at fire-time. **Half in each architecture is worse than either.** The reconciliation:
**§B.8's tone-triage survives WHERE IT IS RIGHT — triage is for findings that are ALL TRUE.** Fire-time
suppression is for a finding that is **REDUNDANT** (same fact, lower intensity) or **FALSE** (contradicted
by a finding measuring the same thing better). Neither doc says this; neither doc contradicts it.

**PB1/PB7 is the library's ONLY falsity case — which is why it felt different from the others.** It is.
The other three are one fact said twice at two volumes; PB1/PB7 is two facts that cannot both be true of
one book. Same remedy, different reason — and the reason is worth keeping, because a future sibling pair
must be classified before it is suppressed. See `cv2-s9-constructive-most-conditioned`.

**PC1/PC2 was the pair nobody got to — not a design choice.** Three sibling pairs already suppressed; this
one didn't, purely because no stage had touched it. A 45% position is not both **heavy** and **dominant**:
*"dominant" IS "heavy, and more so."*

**§B.8's *"Quiet findings… present, never suppressed"* is about PLACEMENT, not firing.** Quiet = secondary
texture (detail rows, expandable sections) rather than a headline card — it is a UI-eligibility rule, in a
section titled *"how the UI consumes this (eligibility, not pixels)"*. **A finding that is not true does
not get to fire quietly.** The clauses are not in tension once you see that one is about the UI and one is
about truth.

**★ EX2'S EXPECTATION WAS NEVER CANON — and this is the sharper half of the ruling.** Removing PC1 from
`verify-phs-patterns`'s Ex2 looks like re-baselining, the thing this stage refused three times. It is not,
and the distinction is exact: **doc 1 §A.10 "Example 2" is a PART-A worked example — Quality / Structure /
Signals / PHS. It never names a PF-ID.** The `{PC1,PC2,PC5,…}` set was authored **in the harness**, and it
encoded **what the code happened to do**. **A test asserting the status quo and calling it a requirement**
is the same disease as the pins (`cv2-s9-gate-semantics`), one layer up: **it cannot fail when the code is
wrong, only when the code CHANGES.** Contrast §10's **numbers** (Health 72, the Nets), which ARE canon,
are drift-immune, and stayed EXACT through this change. **Before honouring a red assertion, ask what
authored it: canon, or a snapshot of yesterday's behaviour.**

**Doc 2's citation for this rule is FABRICATED — the fourth drift, and the worst kind.** §11.1 claims
*"Headline-wins, mirroring `engine.ts:207-223`."* Those lines are **S2's sector threshold and S3's Neff
computation** — no suppression of any kind. Doc 1's real headline-wins (§A.7 step 2) is **per-holding
Signals**, an unrelated mechanism. **A citation to specific lines that do not contain what is claimed is
worse than an uncited assertion: it invites verification and defeats it** — the checker finds the lines,
skims, assumes they misread. Running tally of doc-2 drift: **numbering · §12's live-facts · §11.3's
fired-set · this.** Doc 2 needs a **reconciliation pass, not spot-fixes** (Stage-9 close-out).

## `cv2-s9-constructive-most-conditioned` · Stage 9 · A Constructive finding is the ONE a user acts on by doing nothing — so it must be the MOST-conditioned, not the least

**★ THE PRINCIPLE, and it generalises past PB1:** *"A Constructive finding is the one a user acts on by
doing nothing, so it has to be the most-conditioned, not the least."*

**Why it is asymmetric with every other tone.** A Caution that should not have fired is **noise the user
dismisses** — the cost is an eye-roll. A Constructive that should not have fired is a **FALSE ALL-CLEAR,
and the user's response is to STOP LOOKING.** It is the **only finding whose failure mode is INACTION**,
and inaction is the one outcome no later finding can correct: the user is no longer reading. Doc 1 §B.8
is right that *"the Constructive findings matter… a healthy book should say so loudly"* — which is exactly
why they must be the hardest to earn.

**PB1 has now broken THREE TIMES for one reason — it was the least-conditioned finding in the library:**
1. It fired while **unable to see the sectors it claimed spread across** → now requires `C3.evaluable`.
2. It "correctly" dropped from books that only **LOOKED** sector-less → the fixture bug; **my ruling that
   those books were never entitled to it was WRONG** (see `cv2-s9-gate-semantics`).
3. It fired while **PB7 said the spread was ILLUSORY** → now requires `!pb7Fires`. §10's Ex1 was told, in
   the same breath, that its spread was **good** (PB1, Constructive) and **false** (PB7, Caution).

**The rule: PB7 SUPPRESSES PB1 — §11.1's headline-wins, extended past PC.** *"Your spread is false"*
outranks *"your spread is good"* when both describe the **same spread**. §11.1's chain being PC-only is
not a reason — the idiom is headline-wins, not headline-wins-if-the-family-letter-is-C. **Wide by name AND
wide by sector, or it is not a well-spread book.** Asserted mutually exclusive across every book in the
suite (verify-phs-patterns), not merely on the two that motivated it.

**Note for the reader who finds doc 1 §B.8's *"Quiet findings… present, never suppressed"*:** that is a
**UI-eligibility** rule (quiet findings stay as secondary texture rather than headline cards). It governs
PLACEMENT, not FIRING. A finding that is not true does not get to fire quietly.

## `cv2-s9-pb7-ratio` · Stage 9 · PB7 keys on the RATIO, not doc 2's difference — a guard that fires on everything is as uninformative as one that fires on nothing

**Doc 2 declares `(neffUnitSectored − neffSector) ≥ 2`. It measures the WRONG THING.** **Every real book
holds more names than sectors**, so the difference asks *"do you hold more companies than sectors"* — true
of essentially everyone. **Measured, not argued:** it fired on §10's **Ex1, the TYPICAL RETAIL book** (10
names, 6 sectors → diff **2.64**) — the book doc 1 holds up as *well-spread*.

**★ A GUARD THAT FIRES ON EVERYTHING IS AS UNINFORMATIVE AS ONE THAT FIRES ON NOTHING.** This is the mirror
of `cv2-s9-truth-not-deduction`'s dead triggers, and it is the same defect wearing the opposite costume: a
dead guard reads as coverage, an always-on guard reads as insight. **Both tell the user nothing about
THEIR book** — the only difference is which one gets noticed.

**The ratio is SCALE-FREE and asks the real question: what fraction of name-breadth SURVIVES the sector
collapse?**

| book | neffUnit | neffSector | diff (doc 2) | **ratio** | verdict |
|---|---|---|---|---|---|
| §10 Ex1 — typical retail (10 names, 6 sectors) | 7.284 | 4.645 | 2.64 → **fires** ❌ | **0.64** | ordinary structure → silent ✅ |
| the motivating book (9 names, 3 sectors) | 9.000 | 3.000 | 6.00 → fires | **0.33** | a theme wearing a diversification costume → fires ✅ |

**`0.50` is DECLARED, not derived** — *"at least half your name-breadth must survive the sector collapse"*
is a defensible sentence without a corpus, and carries the same status as every other constant here:
**calibrated post-launch via a clean version bump**, never tuned quietly to make a book pass. Compared
`<= 0.50 + EPS` because the threshold is **inclusive**: a book sitting exactly on half must fire, and float
dust must not be what decides it.

**★ THE NEAR-MISS, AGAIN — and the discipline that caught it.** The alternative was to accept Ex1's new
fired set: *"a new library entry can honestly change a fired set."* True in general — **but not when the
entry is mis-specified.** Adopting Ex1's PB7 would have **baked a bad threshold into a drift-immune
example**, and the example would then have "proved" the over-firing guard forever. **The suite was left
RED pending the ruling** — *"a failing assertion is a question, not a chore"* (`cv2-s9-gate-semantics`,
same lesson, second time in one stage). **The fixture found this; the live cohort never could.**

## `cv2-s9-basket-isin` · Stage 9 · `baskets[]` keys on ISIN, not `instrumentId` — because the row is append-only and frozen forever

**Deviation from the ruled shape, operator-accepted.** Stage 9's prompt specified
`{instrumentId, name, category, fundHouse, weight}`. Built as `{isin, name, category, fundHouse, weight}`.

**★ THE DECIDER — this row is APPEND-ONLY and frozen forever, so its keys must outlive the catalog.** A
uuid that a catalog re-seed can reissue makes the historical record **unresolvable**: a 2026 snapshot
pointing at an identifier that means something *else* in 2028 — not missing, which is recoverable, but
*wrong*, which is not. The schema settles it in its own words: isin is *"the dedup spine… immutable
security identifier; symbols drift, ISIN does not."* **The ISIN still identifies the security in ten
years. That is the whole requirement of a frozen row, and the argument that generalises: a
permanent record may only be keyed on a permanent identifier.**

**Consistent, not novel.** **Nothing in `construction_data` uses an instrument uuid** —
`EntityLedgerEntry.entityKey` is an ISIN stem, `EntityConstituent` carries a symbol. A uuid would be the
only one, and a **second identifier for a thing already identified** (`cv2-s7-jsonb-single-source`).

**`name` needed a new position fact, because the ruled field had NO SOURCE.** A fund's `symbol` **is** its
ISIN (assemble.ts:509), so nothing on `PhsHolding` could name a fund. `PhsHolding.name` now carries
`instrument.name` off the fund-house query that was **already running** (one extra column, no new query).
Display-only — nothing that scores reads it, and it stays inside §A.1 (what the instrument IS, never how
it behaved). The live cohort is the proof: PB6's bind reads *"Kotak Manufacture in India Fund - Regular
Plan IDCW Option"* where the ruled shape would have rendered `INF174KA1IE7`. **A spec field can be
un-buildable; check for the source before building the shape.**

**Baskets are NOT aggregated — and the measurement is the argument.** On a synthetic book, HDFC is a **55%
HOUSE** while Large Cap is a **60% CATEGORY**. C5 measures the house, PB6 the category. **Collapsing funds
in the ledger would pre-empt both rules with one wrong answer.** Name-risk aggregates because one
company's fate is one company's fate; baskets do not, because two funds sharing a house and a category are
**two different facts** and each rule needs its own. The ledgers partition the book —
**entities + baskets = 100.0% on every live user.**

**★ REACHABILITY IS NOT OPTIONAL FOR ANYTHING BUILT ON THIS.** Only `7985d813` holds funds: **4 baskets,
0.2% of book.** PB6/PC6/PC7 are **structurally unfirable on the live cohort** — exactly as PC5 was. **Five
guards this session read as coverage and could not fire** (`sectorVersion`, the stage-6 report-only
tables, PC5, and the four found by the Stage-9 audit). The live book cannot prove these findings; **every
new build ships with a synthetic fixture that PROVES IT FIRES.** Not "the code looks right" — a book where
it fires, asserted. Same discipline `HF()` established for the fund sleeve.

## `cv2-s9-fixture-nature-gap` · Stage 9 · The fixtures asserted stock-facts while reading as fund books — and the guard is scoped to the INCOHERENCE, not the absence

**The defect was the FIXTURE, proven not asserted.** `verify-phs-patterns` and `verify-phs-examples` built
holdings with no `isin`/`assetClass`, so `natureOf` read every one as a **basket** and
`sectorStateOf(undefined, "IT")` **discarded the declared sector**. Every §10 worked example ran **Fund-led**:
nameRisk 0%, C1/C2/C3 all not-evaluable, Net 100.00. Production is safe and always was — **exactly two**
`holdings.push` sites exist (assemble.ts:448/509), both always set the facts, and `stocks.isin` is `@unique`
NOT NULL. `natureOf`'s default-to-basket is **unreachable in production** and correct per Stage 1.

**The fixture was INTERNALLY CONTRADICTORY, not merely sparse — that is what made it a defect rather than a
gap.** assemble.ts:509 gives **every** non-stock `tier: "unknown"` and `health: null`. So
`H("HDFCBANK", 20, "large", "Financials", 74)` asserts three **stock-only** facts while its nature reads
*basket*: **a large-cap basket with health 74 cannot exist on the real path.** The fixture described a book
the system cannot produce.

**Why it survived a whole major version: a harness cannot catch a fact it never reads.** The old gates were
**nature-blind** — S3's Neff ran over the raw position vector (engine.ts:208) and never consulted a class.
`verify-phs-examples` pins only Part-A numbers, and the S-rules ignore nature, so **nothing it asserted could
move**. The repoint onto C2/C3 is the first code that ever needed nature, and it surfaced the gap instantly.
**Latent gap EXPOSED, not regression CAUSED** — the discriminator that separates the two is "did the old code
read this fact at all?"

**★ THE GUARD IS SCOPED TO THE INCOHERENCE, NOT TO THE ABSENCE — and the narrowing is load-bearing, not a
softening.** The literal ruling was *"a missing class must fail loud."* Implemented that way, it **broke
§13's contamination micro-proof** (`verify-cv2-stage3:79`), which strips `isin`/`assetClass` **on purpose** to
prove Gross MOVES while Health/Quality/Signals do not. **An isolation proof requires an impossible book:** on
the real path a stock is always a stock, so the only way to vary Construction while holding the Health inputs
fixed is to strip the facts. **Throwing on absence outlaws the technique that proves the guarantee.** The
ruling's own words name the real defect — *"a function handed a sector that silently drops it"* — and at
stage3:79 `sector` is null: **nothing is dropped.** So the guard fires on `assetClass == null && sector != null`:
the case where we are handed a fact we cannot interpret and answer `not_applicable` anyway. It still catches
**every** case that motivated it (all four §10 examples declare sectors ⇒ all four throw), and §13's proof
survives. **A guard that forbids proving the property it protects is the wrong guard.**

**The param stays OPTIONAL on purpose.** Making `assetClass` required would force callers to write
`?? "unknown"` to compile — **re-creating this exact bug at the call site, one layer out, where no guard can
see it.** The type permits the mistake so the runtime can NAME it.

**`HF()` built (rider a).** A stock-only `H()` could never exercise the fund sleeve — and multi-asset is the
thesis. §10's **Example A** is a fund-only beginner where `nameRiskShare = 0` makes C1/C2 not-evaluable and
**C5 carries the entire read**: now asserted EXACT at **Net 76** (`100 − 1.2×(60−40)`), plus the cap-vs-truth
pair on the C5 side (a single-house book charges the capped **25** while `maxHousePct` stays **100 raw** —
`cv2-s9-truth-not-deduction` under fixture) and the house-unknown kill.

**Two more pins-on-the-environment found and fixed while proving it — the 5th and 6th instances.** Ruling ②'s
list named stage3/5/6 and **missed stage4**, which pinned a `GROSS` literal map per live user (including the
very `7985d813: 70.38` the ruling had already ordered turned into a property) and 9 catalog fps through
`Number()` — *which silently loses precision above 2^53, so the pin could not even represent what it claimed
to compare.* And **stage6** regex-pinned `threshold 16.7% (N=9)` against **Aman's live book**; his entity count
moved to 12, the threshold correctly fell to the 15% floor, and the assertion went red having caught nothing
but a portfolio change. **Both replaced with identities that measure the CODE:**
- **Gross is sector-INDEPENDENT** — strip every sector, Gross must not move a bit (`62.5411 ≡ 62.5411`). Gross
  = max(0, 100 − C1 − C2) and C1/C2 are ENTITY rules that never read a sector. **True on any book, at any
  price** — where the pin was true only at one moment.
- **C1's threshold is a pure function of N** — proven on synthetic books at **both** branches: N=9 ⇒ 16.7%
  (relative wins), N=12 ⇒ 15.0% (floor wins). **The pin only ever exercised ONE branch, and only while Aman
  held exactly 9 entities.** Strictly more proof, and drift-immune.

## `cv2-s9-gate-semantics` · Stage 9 · The S→C mapping is by MEANING, not by DIGIT — and the thresholds are untested, not proven

**The trap, and it caught both of us.** S-rules and C-rules are both numbered 1..n, and the numbers **do not
line up**. The mapping is by **what the rule measures**:

| S-rule | measures | successor | why |
|---|---|---|---|
| `S1` | entity dominance | **C1** | same fact; proven **byte-identical** at Stage 5 (`C1 ≡ ΣS1`, 15.72 ≡ 15.72) |
| `S2` | **sector** concentration | **C3** | C3 is the sector-dominance rule. **Not C2.** |
| `S3` | **breadth** (Neff) | **C2** | C2 is the entity-breadth rule. **Not C3.** |

**S2 and S3 cross over.** The Stage-9 ruling literally said `s2Evaluable → C2.evaluable`; it was the numbering
trap, and it was corrected on measurement, not on argument. **Routing a sector gate through C2 would gate
sector findings on whether the NAME-RISK SLEEVE is measurable — a different question entirely.** A fund-only
book has no name-risk sleeve (C2 not evaluable) but can have perfectly resolved sectors (C3 evaluable): under
the digit-mapping, its sector findings would go silent for a reason that has nothing to do with sectors.
**When a ruling and a measurement disagree about which rule measures a fact, the measurement wins — but say so
and get it re-ruled. Both happened here.**

**PB1's pre-existing defect — the PRINCIPLE stands, and THE INSTANCE I APPLIED IT TO WAS FALSE.** PB1
("Well-spread book", **Constructive**) must not fire on books with **unresolved sectors**: that asserts
*well-spread* while **unable to see the sectors it claims spread across**. A confident claim built on an
absence — the same disease as `cv2-s8-matcher-unratified`'s "precisely wrong rather than honestly absent",
except this one is a *reassurance*, which is worse: a Constructive finding is the one a user acts on by doing
nothing. **Gating PB1 on `C3.evaluable` is correct — FOR GENUINELY SECTOR-LESS BOOKS.**

**★ THE AMENDMENT: §10's Ex1/Ex3/Ex4 are NOT sector-less books, and I ruled that they were.** I ruled
PB1's drop from them *"correct, not collateral — they were never entitled to it."* **Ex3 is twelve holdings
across twelve distinct sectors: the archetypal well-spread book.** Ex1 declares 8 sectors, Ex4 declares 10.
They only *looked* sector-less because the **fixture** omits `assetClass`, so `sectorStateOf(undefined, "IT")`
routed every holding to `not_applicable` and **silently discarded the declared sector**
([`probe-s9-fixture-nature-gap.ts`](../src/scripts/probe-s9-fixture-nature-gap.ts): with the position facts
the real path always sets, **all four examples match their documented expectations, 4/4**, Health unchanged
at 70/72/71/80). **The principle survives; the instance was false.**

**★ THE NEAR-MISS IS THE RECORD — this is how a wrong thing becomes canonical.** The instruction was to
*encode the ruled-correct behaviour into the expectations*. Had that been done dutifully, **a fixture bug
would have been permanently baked into §10's worked examples** — the artifacts Stage 6 ruled drift-immune,
*"keep them EXACT."* The examples would then have "proved" the engine forever, against a book that cannot
exist. **Nobody decides a thing like that; someone encodes an expectation they were told was correct.** It
was caught only because the red was *diagnosed to root cause before the expectation was touched* — the same
discipline as `cv2-scheduler-hazard`'s *"DO NOT just re-baseline"*, one layer up: **a failing assertion is a
question, not a chore. Re-baselining answers it without asking it.**

**★ THE THRESHOLDS ARE UNTESTED AGAINST AGGREGATION — NOT PROVEN SAFE. This is the part to carry forward.**
`r.neff` was S3's **position-level** Neff. `C2.metrics.neff` is **entity-level, sleeve-renormalised** — an
issuer held as both stock and bond counts **once**, not twice. So the new number is **strictly ≤** the old
one, and more books read as *thinner* — which is **true**: two instruments of one issuer are not two bets.
The `< 5` (PC5) / `≥ 8` (PB1) thresholds **predate aggregation and were tuned against the over-counting
number.** They were **repointed WITHOUT retuning** — a calibration ruling needs its own evidence, not a
repoint's side-effect.

**The measured diff says nothing reassuring, and the reason is the finding:**

```
108fd2a6  1.91 → 1.91  Δ 0.00      4c5ca537  1.00 → 1.00  Δ 0.00
7985d813  6.05 → 6.03  Δ -0.02     ae8c6537  1.00 → 1.00  Δ 0.00
e3c6bd3c  2.65 → 2.65  Δ 0.00
```

**Δ ≤ 0.02, no book flips a finding — BECAUSE THE COHORT HOLDS ZERO BONDS.** Aggregation had **nothing to
merge**; the −0.02 is pure sleeve renormalisation. **This is not evidence the thresholds survive aggregation
— it is evidence that aggregation never ran.** Re-derive with
[`probe-s9-neff-repoint-diff.ts`](../src/scripts/probe-s9-neff-repoint-diff.ts).

**★ THE OBLIGATION: the first bond-holding book is the first real test of `< 5` / `≥ 8`.** An NTPC
stock+bond book drops a full point of Neff versus the old number and may cross `< 5` into PC5 ("Thin effective
spread") for a structure that did not change. **When one appears, re-measure before trusting the finding.**
Recorded because a green diff on a cohort that cannot exercise the change reads, forever after, as
ratification — the same trap as `cv2-s9-truth-not-deduction`'s dead guards: **absence of a flip is not proof
of safety when the population cannot flip.**

**✅ CLOSED 2026-07-18 — the book appeared, it was measured. See `cv2-multiasset-book` below.**

## `cv2-multiasset-book` · The first real multi-asset book — three rulings (PC5 debt PAID · PC6/PC7 reachable · provisional is product)

The obligation above is discharged. `__multiasset_book@test.invalid` (a 6th, cleanly-separable user) holds
the first book that exercises what five stages proved by fixture only: NTPC stock+bond → one **19.1% entity**
across **2 instruments**, a non-resolving bond, 3 more scored stocks in distinct sectors, 2 HDFC funds + 1 SBI,
a coupon G-Sec + a T-bill, a gold ETF, a REIT. 13 positions, 12 entities, coverage 36.79%, Health 70 / Steady,
Construction 81 / Solid. Read it with `read-multiasset-book.ts`; invariants in `verify-multiasset-gate3.ts`.

**① PC5 `< 5` KEPT — debt PAID, not deferred.** Measured **entity-Neff 4.91 vs position-Neff 6.73 → Δ 1.82** —
the merge the zero-bond cohort (Δ ≤ 0.02) could not exercise. It **crosses `< 5`**: PC5 fires on entity-Neff, would
NOT on position-Neff. **Position-Neff 6.73 was the WRONG NUMBER; the threshold was never wrong, the input was** —
two instruments of one issuer are not two bets. "13 things, behaves like 4.9" is the TRUE answer, and PC8 fires
beside it naming NTPC — two angles on one truth, both distinct subjects in the story. Retuning `< 5` upward to
preserve the old firing would **encode the double-count into the threshold** — §15's fabricated constant; T-3's
*"a threshold must never do a bug's cleanup."* **`< 5` / `≥ 8` UNCHANGED.** (This book crosses `< 5`; `≥ 8` is not
reached here — both Neffs < 8 — but the same principle settles it: entity-Neff is the right input for both.)

**② PC6/PC7 — LEAVE 40, and PROVEN REACHABLE (not dead).** The book's 2 HDFC funds at 18% sit below 40 (C5 clean),
so PC6/PC7 stayed silent — they have never fired on any book, real or seeded. But 40 is **FAR, not unreachable**: a
40%+ single-house book is real (four funds of one AMC is common), just not THIS book. **`verify-pc6-pc7.ts` proves
it by fixture:** PC6 fires at 45% (binds the house + its 3 funds), PC7 fires at 85% (suppresses PC6, tone Concern),
and NEITHER fires at exactly 40% (the `>` boundary). This REFRAMES the "structurally unfirable on the live cohort"
line above (~727): unfirable on the live *cohort*, yes — but a real, reachable threshold, now proven, **not** the
dead-guard disease. Don't add two more dead guards by assumption; these aren't.

**③ PROVISIONAL IS A PRODUCT FACT, not a defect.** A fund/bond-heavy multi-asset book is provisional BY
CONSTRUCTION: Health reads only the scored stocks (this book: 4 of 13 → coverage 36.79%). That is §13's law made
visible — Health covers exactly what the stock engine can see. **A genuinely diversified Indian retail book reads
~35–40% coverage, so the headline is a partial read by design, and this is the MEDIAN case, not the exception.**
Consequence for the FE handoff: **the coverage line + PV6 are load-bearing on every real book — a 37% coverage line
must read as SCOPE, not FAILURE.** Carry it into the UI handoff.

## `cv2-s9-truth-not-deduction` · Stage 9 · Findings key off the FACT, never off the rule's FIRING — and a cap is a CHARGE ceiling, not a TRUTH ceiling

**★ THE INVARIANT, and it is stronger than the one that was proposed:** **caps apply to `points`; every
`firedSubject` carries the RAW measured value. A cap can NEVER hide a truth.** The finding says what is
**TRUE**; the rule decides what it **COSTS**. A book that is 100% pharma is 100% pharma whether C3 charges
−30 or −300.

**The architect's cap-reasoning was WRONG — twice — and being wrong is what produced the right rule.** The
claim was that C3's cap at −30 made PC5 unreachable. Both times it was **disproved by measurement**
([`probe-pc4-reachability.ts`](../src/scripts/probe-pc4-reachability.ts)): a 100% pharma book fires
`PC1,PC2,PC3,PC4,PC5,PS5,PV1,PX1` **with C3 capped**. The reason is the defect: **`patterns.ts` computed
`maxSector` ITSELF and never read C3 at all** — the cap could not gate a finding that never consulted the
rule. *"I WAS WRONG TWICE"* — and the correct invariant is stronger than the one being defended, because it
holds **regardless** of where any cap sits.

**What actually shipped is not the cap-fix — it is the DE-DUPLICATION.** The re-key kills `patterns.ts`'s
**re-derivation** of `maxSector`: a **second computation** of a fact `c3Of` had already measured. Two
computations of one fact drift the moment one is edited. **One fact, one home** — the shape that served
55.01, and the same rule as `cv2-s7-jsonb-single-source`. The findings now read `C3.metrics.maxSectorPct` /
`C5.metrics.maxHousePct`: **raw, uncapped, measured once.**

**`evaluable` ≠ `fired`, and findings key on `evaluable`.** *"We could measure it"* is not *"it charged"*.
Keying a finding on `points > 0` silently inherits every threshold and cap in the rule — the finding stops
describing the book and starts describing the *deduction*.

**Four dead triggers, found by auditing ON PURPOSE — after three were found BY ACCIDENT.** `sectorVersion`
(a hardcoded literal that could never fire), the stage-6 report-only tables, and PC5 were each stumbled
over. The Stage-9 audit went looking and found four more. **★ A guard that structurally cannot fire is worse
than an absent guard: it READS AS COVERAGE.** An absent guard is a gap someone can see; a dead guard is a gap
wearing the costume of a check. **Audit for reachability deliberately — do not wait to trip over the next
one.**

**Made legible at the point of confusion.** C3's fired detail now appends *"(capped — the CHARGE stops here;
100.0% remains the truth)"*. The next reader hits the cap and the raw value **in the same sentence**, so the
distinction cannot be re-lost.

## `cv2-s9-no-fired-set-hash` · Stage 9 · The fired set is NOT a fingerprint input — §11.3 is satisfied by hashing the INPUTS

**Decision (operator-ruled): DO NOT HASH THE FIRED SET.** §11.3 can be read as asking for it. It must not be
built.

**Why — `displayState` is PEER-DERIVED, so the fired set changes with NO change to this user's book.**
Filtering (`dampened`, `pending_data_integration`) depends on the **peer group**. Hash the fired set and
**another company's dampening invalidates this user's snapshot**: every book re-scores because a stranger's
data moved. That is a **broadcast, not a trigger** — precisely the disease `sectorVersion` had, and the
reason it was deleted this same stage.

**And it is unnecessary, which is the real argument.** The fired set is **derived from already-hashed
inputs** (weights, entities, natures, sectors, houses, health, findings, tier, matcher, cv). It **cannot
change independently for a reason that belongs to this book** — if the book changed, an input changed, and
the hash already moved. Hashing the derivation adds **no trigger the inputs don't already carry**, and adds
one that fires for reasons the book has nothing to do with. **Hashing the inputs is stricter AND narrower:
it catches everything real and nothing else.**

**Same class as `cv2-s7-refuse-live-facts` — and that is why this is logged.** A spec listing a thing is not
evidence the thing should exist. **Someone will read §11.3 and try to "complete" it.** This entry is why they
should not.

## `cv2-s8-matcher-unratified` · Stage 8 · THE FUND ARM DOES NOT SHIP — the ratification number is 11.9%, and it fails

**§14 made this a gate, not a preference:** *"Of funds whose `category` says sectoral, what share does the
matcher resolve? **Until it is known, the fund arm is unratified.**"* It is now known. It fails. **Nothing was
built.** Every fund stays `not_applicable` (Stage 4's interim ruling stands unchanged), `matcherVersion`
stays `"none"`, and there is **no re-rating, no flip, no backfill**.

**★ THE PUBLICATION LINE — carry all three, always, on every surface:**

> ### 11.9% overall — 92.7% Sectoral · 1.6% Thematic (89% of the bucket)

**Never publish the aggregate alone.** The aggregate is the misleading number; **the SPLIT is the finding**:
the matcher works on the trivially-matchable population and fails on the one people actually hold. Quote
11.9% by itself and the reply is *"so extend the regexes"* — quote the split and it is obvious why that
cannot work. (Doc 2's own PQ2 makes exactly this point about a user's numbers — *"your average of 70 hides a
split."* It applies to our own metric.) **PE5's copy carries the split, not the aggregate.**

**Reconciliation — the operator's cited figures vs the harness's.** The Stage-8 ruling cited *"21.5% overall
— 96.8% Sectoral · 6.6% Thematic (87% of the bucket)."* The harness measures **11.9% / 92.7% / 1.6% /
88.7%**. Recorded because the harness is KEPT to be re-run, and a record it contradicts on first re-run would
destroy the instrument. The differences, diagnosed:
- **87% ≈ 88.7% thematic, 96.8% ≈ 92.7% sectoral** — the same measurement; the residue is where the
  Sectoral/Thematic line is drawn, which is a judgment (hence the harness reports BOTH boundaries).
- **21.5% vs 11.9% is the substantive one, and it is this ruling applied to itself.** ~21.5% (≈311 funds) is
  roughly what you get by admitting `Energy → oil_gas_energy`, `Infrastructure → logistics_infrastructure`,
  `Defence → capital_goods` — **the very mappings this ruling rejects as "precisely wrong rather than
  honestly absent."** Once the ruling is applied, the number falls to 11.9%. **11.9% is the figure consistent
  with the verdict; 21.5% counts mappings the verdict throws out.**
- **The measured numbers are strictly MORE damning than the cited ones. The ruling stands a fortiori.**

**★ THE NUMBER — 172 / 1449 = 11.9%.** Re-derive it any time with
[`audit-fund-sector-coverage.ts`](../src/scripts/audit-fund-sector-coverage.ts) (kept deliberately: the
matcher was refused on this number, so the number must stay re-derivable when the population, the taxonomy,
or the approach changes). **Run it before ever reopening §14.**

**Why the flattering number is 50.4% and the true one is 11.9%.** 731/1449 names resolve to a **Nifty index**.
But §14 needs a resolution to **our `Sector` table**, and 559 of those 731 land on an index that is a
**multi-sector or ownership theme** with no honest single-sector counterpart:

| matched a Nifty index, no honest sector | n |   | resolves to a real sector | n |
|---|---|---|---|---|
| Nifty Financial Services (banks+nbfc+insurance+capital_markets) | 177 | | `pharma_healthcare` | 98 |
| Nifty India Consumption (fmcg+auto+retail+hospitality) | 147 | | `it_technology` | 68 |
| Nifty Infrastructure (power+cement+logistics+telecom) | 101 | | `automobile` | 6 |
| Nifty Energy (**we** split oil_gas and power; the index does not) | 44 | | | |
| Nifty MNC / Nifty PSE (ownership themes, not sectors) | 68 | | | |
| Nifty Commodities · Nifty Media · Nifty India Defence | 38 | | **total** | **172** |

**This is not a matcher failure — it is a taxonomy mismatch.** Fund themes are coarse; our sectors are
fine-grained and stock-oriented. **The allowlist's own comments already refuse these collapses**
(`mf-benchmark.ts`): *"Banking & Financial Services → NOT Nifty Bank… these hold NBFCs, insurers and AMCs,
which Bank Nifty EXCLUDES BY CONSTRUCTION"* and *"Consumption → NOT FMCG… consumption is broader (autos,
retail, hotels)."* Mapping `Financial Services → banks` would commit the error its author had already
identified and rejected.

**Consumption / Infrastructure / Energy — left out for the sharpest reason.** They *have* plausible `Sector`
rows. But a multi-sector theme mapped onto ONE sector and then fed to a rule that measures **single-sector
concentration** is **precisely wrong rather than honestly absent** — a confident wrong number instead of a
gap. Absence is recoverable; a confident wrong number is not.

**The decomposition — the headline averages two populations that behave nothing alike.** AMFI ships ONE leaf,
so "Sectoral/Thematic" hides the split. Measured under two classifier boundaries, because where the line is
drawn is itself a judgment:

| | SECTORAL-named | THEMATIC-named | thematic →sector |
|---|---|---|---|
| permissive | 777 (53.6%) → 94.1% to index | 672 (46.4%) | **0.0%** |
| strict | 164 (11.3%) → 92.7% to index | **1285 (88.7%)** | **1.6%** |

**The boundary moves the split (46% → 89%) and changes nothing that matters:** thematic funds resolve
0.0–1.6% either way, and **the ratification number is the same 172 funds under both** — it is a property of
the index→sector *mapping*, not of how the bucket is labelled. **The matcher covers the tenth people don't
hold and misses the nine-tenths they do.**

**§14's own rule is the verdict.** *"A rule that catches your pharma fund and misses your neighbour's would
be inconsistent penalty — worse than no rule."* At ~0–2% thematic coverage that is **not a risk, it is the
design**. And §14's safety argument — *"this design goes quiet honestly instead"* — depends on the §7 gate,
which only fires when unknown DOMINATES (>50%). Below that, C3/C4 fire on the resolved subset: two books each
50% one thematic fund, A holding Pharma pays −12 and B holding Manufacturing pays nothing, **for identical
structure**. Today is *consistent* (every fund `not_applicable`); shipping at 11.9% would **introduce** the
inconsistency §14 calls worse than no rule.

**And `unknown` would be a no-op with a moving part — measured, not argued.** A fund-only book of unresolved
sectoral funds: post-matcher every fund is `unknown` ⇒ sectorable = the whole book, unknown = the whole book
⇒ `unknownRatio = 1.00 > C3_UNKNOWN_KILL 0.50` ⇒ the gate kills C3/C4 ⇒ **not evaluable**. Which is exactly
where the interim ruling already lands (`sectoredShare 0.0%` ⇒ no resolved sector ⇒ **not evaluable**).
**Identical outcome, reached by a longer path through a threshold that can misfire.** The interim is the same
behaviour with fewer ways to be wrong.

**"Manufacturing" is not a sector.** Neither are Business Cycle, Special Opportunities, Innovation, Quant,
ESG, Momentum, Multi-Factor, or T.I.G.E.R. **No `Sector` row exists because no sector exists.** Inventing one
is the fabrication §15 forbids by name. The 15 regexes' author already enumerated these as deliberately
unmapped — **the ~12% ceiling is structural, and no amount of pattern-writing raises it.**

**THE BLIND SPOT IS NOW CHARACTERISED, NOT JUST NAMED: thematic funds are not sectorable FROM THEIR NAMES.
That is a DATA problem, not a regex problem.** The honest path is the one §14 / doc-2 §13.5 already names —
**fund LOOK-THROUGH**: *"the index-constituent path is the cheap, exact first slice."* You cannot infer a
thematic fund's sectors from its name; you **can** read them from a portfolio disclosure. **Phase 2.**

**PE5 already carries this honestly** (doc 2 §7): *"Your Nifty Bank ETF gives you banking exposure our sector
reading cannot currently see."* That finding now covers thematic funds too — **and it is the truth, not a
placeholder.**

**Artifact shape — recorded, moot, and deliberately NOT built.** If a matcher ever ships it is a **versioned
JSON seed, not a table**. §14's complaint was *regexes-buried-in-a-fold-job* — unreachable and unreviewable; a
JSON seed cures both (portable, diffable in review, `matcherVersion`-stamped) and matches this codebase's own
precedent (`vytal_pg_bars_REDERIVE_FINAL.json` — 188 scoring constants as versioned JSON). A DB table would
make the mapping *less* reviewable, and worse: **`matcherVersion` is a fingerprint input, so a table would put
the mapping and its version in two homes** — edit the table, forget the bump, and the hash never fires: a
silent re-rating, the exact failure Stage 7's sentinel exists to prevent. (Better still, derive the version
from a content hash of the artifact, so no human has to remember.) **But it is not built: a matcher ruled
unratified is shelfware that rots. It ships with the matcher, when there is one.**

**§10's Example D stays at its INTERIM value.** D's Net 60.6 requires the pharma fund sectored into Pharma;
it is not, and will not be by regex. **The obligation moves from Stage 8 to look-through.** Recorded here so
that nobody "fixes" the spec's example by extending the regexes — that would buy D's 60.6 at the cost of the
one property §14 says matters most.

## `cv2-s7-refuse-live-facts` · Stage 7 · §12 lists three fields that MUST NOT be persisted — the code was right first

**The refusal (operator-ruled).** §12's persistence list includes `unvaluedShare`, `unvaluedValue` and
`provisionalConstruction`. **They are not persisted, deliberately.** The persistence layer already refused
them on principle, and said why:

> [`persist.ts`](../src/portfolio/phs/persist.ts) — *"`heldNotValued` is deliberately NOT taken here… whether
> a symbol is valuable is a **LIVE fact** (the catalog can learn it tomorrow)… The READ serves it, fresh."*
> [`entity.ts`](../src/portfolio/phs/entity.ts) — *"`unvaluedShare` is NOT here: it is computed **read-time**."*

**Why it matters.** Freezing a live fact into an APPEND-ONLY row manufactures the exact staleness bug this
stage exists to kill: a row asserting "18% of this book is unvalued" long after the catalog learned the
price, with nothing to correct it. And it is **unnecessary** — when a held-not-valued position gets a price
it enters the book, the weights change, the hash changes, and the book rescores. **The event already flows
through the fingerprint.** Persisting it would add a second, worse channel that goes stale.

**The pattern.** §12 is a spec; the code had already reasoned this out and left a comment explaining it. A
spec listing a field is not evidence the field should exist — **read what the code refuses, and why, before
"completing" it.** Someone will read §12 and try to finish the job. This entry is why they should not.

## `cv2-s7-jsonb-single-source` · Stage 7 · One home per fact: the JSONB is the source, `structure` is the only projection

**Decision (operator-ruled).** §12's field list lands INSIDE `construction_data`. **Zero new columns.**
The `structure` column stays as the ONE derived projection — assigned from `cData.net`, the same in-memory
object written to the JSONB, in the same `create({data})`. Never recomputed.

**Why not columns beside the JSONB (§12's literal reading).** Every scalar would exist twice. *That is
precisely the shape that produced a served **55.01** against an engine **32.38***: two writers setting two
homes independently. Tested against all three read patterns — the FE reads the decomposition as one blob;
bands are pure ranges over `structure` and archetype is `construction_data->>'archetype'`, so no query needs
an indexed duplicate; and **the fingerprint hashes `holdings` at write time and never reads the snapshot, so
it exerts zero pull toward columns.** Columns-only was rejected too: the ledgers are arrays that need JSONB
anyway, so you end up with both — maximal duplication.

**Derived, never stored — a fact with zero homes cannot drift.** `band` (a pure function of `net`) and each
rule's tri-state `state` (a pure function of `evaluable` + `points`) are computed at READ. §12 lists `state`
as persisted; persisting it is a THIRD encoding that can disagree with the two it derives from.

**Also collapsed:** `buildSleeves` and `buildExposures` each summed `nameRisk`/`basket` with identical logic —
one fact, two homes, agreeing only by the accident that both copies were right. `Exposures` is the superset,
so it is now the single source and `Sleeves` is a projection (`sleevesOf`). The engine computes it once.

**And the gap this closed.** The Neffs were recoverable ONLY from `detail` prose when a rule was CLEAN
(`"Neff_unit 1.91 → target 1.91 ≤ Neff_sector 1.91 — clean"`) — `firedSubject` is null when nothing fires.
That is the regex trap Stage 6 killed, resurrected by accident. **A measurement is not a subject**: `metrics`
now carries what a rule MEASURED whether or not it fired, and the FE's `effectiveBreadth` reads it (a strict
improvement — a well-diversified book's Neff used to fall through to a client-side recomputation).

## `cv2-s7-sectorversion-removed` · Stage 7 · A fingerprint input that cannot fire is decoration that reads as coverage

**Decision.** `prov.sectorVersion` — the hardcoded literal `"nse-sector-v1"` — is **removed** from
`PhsProvenance` and the hash. It was a constant: it could never change, so it could never fire. §12's
trigger *"symbol-master refresh resolving a previously-unknown sector"* invalidated **nothing**.

**Replaced, not dropped.** The fingerprint now hashes the **sector-resolution OUTPUTS** (`sectorWeights`,
`sectoredShare`, `unknownRatio`, `gateOpen`) — strictly better on every axis: it hashes the **fact C3/C4
actually read** rather than a label asserting the fact is fresh, and it fires **per-book** when THAT book's
resolution changes instead of churning every book on a global bump. The one case a version string would
catch — a taxonomy redefinition leaving the resolved strings identical — is **`CONSTANT_VERSION`'s job**.

**Why removing beats wiring.** A hash input that cannot fire *reads as* "the sector dimension is covered"
when it isn't. Same shape as a report-only assertion in a verify: it looks like coverage and is decoration.
Contrast `tierAsOfDate`, which is genuinely live (max `asOfDate` over the held stocks) and stays.

## `cv2-s7-bond-trigger-stem-join` · Stage 7 · The bond trigger was structurally unreachable, not merely mis-worded

**The finding.** §12 says a *"newly-**scored** stock"* changing a bond's issuer resolution should trigger a
recompute. Two things were wrong. **(1)** Stage 4 ruled bonds inherit from any **CATALOGUED** stock, not a
scored one (`cv2-s4-bond-sector-catalogued`, 191 vs 8) — keying on scoring misses 96% of resolutions.
**(2)** Far worse: the trigger could not reach the user at all. `refreshPhsForSymbols` selects via
`instrument.stock.symbol IN (…)`, and **0 of 356 catalogued bonds carry a `stock_id`** — the bond→issuer link
is not a foreign key, it is a 7-char ISIN-stem match performed at ASSEMBLE time. A bond-only holder was
**structurally unselectable**: their sector resolution would change and their book would never recompute.

**Ruling: built now, not deferred.** "0 bonds are held today" is exactly the argument that lets a hole ship.
The first user holding a bond whose issuer gets catalogued would silently serve a number their own inputs no
longer supported — 108fd2a6 again, and undiagnosable, because nothing looks wrong.
`refreshPhsForCataloguedIsins` does the stem-join over both holding tables (broker included without an
`enabled` filter — severed ≠ gone).

**Wired to the real event.** There is **no runtime symbol-master job**: sector resolution happens in
[`apply-nifty500-pass1-sectors.ts`](../src/scripts/apply-nifty500-pass1-sectors.ts), an operator-run script.
**That script IS the event**, so the trigger fires there. §12's "symbol-master refresh" describes a job that
does not exist — the wiring follows the fact, not the wording.

## `cv2-scheduler-hazard` · Stage 6 · A dev scheduler on a timer is a silent stale-writer — quiesce it during a staged build

**The hazard.** `tsx src/server.ts` + `startScheduler` writes PHS snapshots to the live DB on a timer, running
**whatever code it loaded at start** — forever. A **no-watch** instance (pid 6820) started **15-07 12:59:30**,
a full day before the Stage-5 cutover, and kept stamping `cv 1.2` rows carrying the **pre-cutover S-composite**
in the `structure` column. It re-pointed "latest" and **silently reverted the verified cutover** on whichever
book it touched last. No error, no signal — old logic *succeeding*.

**Identification (never blind-kill).** Two cheap discriminators, both decisive:
- **Start time vs the code boundary** — the newest server-graph mtime (`persist.ts`, 16-07 09:26:13). The two
  `tsx watch` children respawned **09:28:04 > 09:26:13** ⇒ current code. The no-watch child was frozen a day
  earlier ⇒ **stale**. A `watch` child reloads; a no-watch child never does.
- **Which `CONSTANT_VERSION` it stamps** — a process loaded after the `constants.ts` bump (09:25:12) *cannot*
  stamp `1.2`. The 24h roll-up showed cv-1.2 rows still arriving (newest 14:17:14, **later** than the newest
  cv-2.0 at 14:16:44) ⇒ a stale writer was demonstrably live.

Killed the **code-runner 6820 directly** (+ cli 17788, npx 1476). **The child is the dangerous process, not the
wrapper** — and its PPID chain was already broken (17788's parent 14036 was long dead), so a `taskkill /T` on
the wrapper would have **orphaned the zombie**: precisely the Step-19 fold failure. Post-kill: no new cv-1.2 row.

**The damage that outlives the kill.** `108fd2a6`'s served latest is a zombie-written `cv 1.2 · structure 55.01`
row → it *displays* Construction 55 (Lopsided) instead of ~32 (Precarious). **`backfill-construction-data.ts`
cannot repair it**: it fills `construction_data` in place and syncs `net` to the row's own `structure`, so it
would bake `net = 55.01` — entrenching the stale value rather than correcting it. Only a **fingerprint-gated
re-persist** (`backfill-phs-snapshots.ts`) writes the fresh cv-2.0 row; because `CONSTANT_VERSION` is a
fingerprint input, it writes exactly the stale books and skips the clean ones.

**Standing procedure.** **The scheduler must not run during a staged build** — every stage's byte-identical
proof assumes the environment is held still. THIRD silent stale-write this session (fold orphan · unkillable
fold · this).

**The verify consequence (operator ruling ②).** A test that pins a value a scheduled job *legitimately* changes
**fails on a schedule, forever**; re-baselining only resets the clock until the next EOD. Pin the right KIND of
thing: **synthetic (fixed weights) → EXACT** · **live → PROPERTY or SAME-RUN-DELTA** (capture and compare within
one run; never against a literal recorded days ago). Applied across `verify-cv2-stage3/5/6`:

- **SAME-RUN-DELTA** — all 9 catalog fps + the scored fp, captured at the head of the run and compared at the
  tail of the **same** run. A delta names its own cause (a scheduler leaked into the build). Compared as TEXT:
  the sums exceed 2^53.
- **PROPERTIES** — the pins on `7985d813` (S 76.36 → Net 70.38, C1 −15.78) became **relations**, both sides of
  which move with price so the relation survives: the **identity `C1 ≡ ΣS1`**, the **direction `Net < S-composite`**,
  the **driver `C2 > S3`**. Per-user exact-Net (27.76/70.38/32.02) is **gone** — price-dependent by construction;
  Health carries §13 and the value is printed, not asserted.
- **STAYED EXACT** — every synthetic book (§10 A–D, stress-E, the C4 guarantee, invariants), plus the 95-stock
  **count** (a rescore changes scores, never cohort size). Single-stock `Net = 21` stays exact but is a
  **property**: a 100% book has no relative weights, so no price can move it.
- **The proof the rule is right.** `C1 ≡ ΣS1` now measures **15.72 ≡ 15.72** — the value drifted off the 15.78
  pin, the identity held exactly. **The pin measured the ENVIRONMENT; the identity measures the CODE.** The drift
  landed on exactly the 4 EOD-fed tables while the 5 non-EOD ones matched byte-for-byte: the nightly job was the
  only thing moving.
- **No silent gaps.** Stage 6's interim §9 (5 re-pinned literals + 4 *report-only* tables) was the worse of both:
  the same trap, slower — and four tables asserted by **nobody**. A silent gap is worse than a failing pin; a
  failing pin at least tells you something. One idiom, uniformly, or it is not covered.

**2026-07-17 (the `T-4/T-3/T-5` re-fold session) — the rule holds; its coverage was incomplete. Three more
instances, surfaced when the re-fold APPLIED the fixes and that evening's 7 PM EOD rescore moved the scored
books under pins the environment owns.**
- **`verify-t3-benchmark` §4** pinned `changed === 22` — the count of *pending* benchmark mis-maps in the live
  `via='name'` cohort. The re-fold applied the whole-match guard, so the 22 resolved to null and **left** the
  cohort (1016 → 994) → 0 pending. A pre-application delta the fold legitimately zeroes. **Fixed this session**
  to the steady-state invariant "**0 mis-maps survive**" (the matcher's code-correctness stays proven
  fold-independently in §§1-3 + the §5 negative control). The pin disease landing on a verify written to *prove*
  a fix rather than to survive its application — `changed === N` for any pre-application N is the tell.
- **`verify-cv2-stage5` §1** still asserts live-recomputed **Quality/Signals** `near(…, stored, 1e-4)` against the
  latest STORED snapshot. The ruling-② conversion above reached `construction.net` but **not this q/s equality**.
  Health (phs, integer) is stable, so "Health carries §13" holds (73·73·69·65·50 all matched); Quality/Signals are
  decimals the EOD rescore drifted, so the 3 price-dependent books (e3c6bd3c/7985d813/108fd2a6) fail on q/s while
  Health matches. **Filed, not fixed** (not in the T-4 batch): make §1 Health-only, or same-run-delta.
- **`verify-step20-multiasset`** pins GATE-0 structure counts (19 holdings / 18 lots / 21 txns) the session's own
  writes drifted to 23/15/16. Same disease, oldest instance. **Filed** (see also `T-6`, the accrued-interest twin).
- **None of this is the fold.** `MF_ANALYTICS_DAILY` is held-not-scored and never enqueues a rescore
  (`scheduler.ts`), and fold-ab called `runMfAnalytics` **directly** (enqueued nothing) — so no q/s or count drift
  here is the fold's doing. The fold's own §13 proof is the Health(phs) byte-identity, which held.

## `cv2-s6-delete-defer` · Stage 6 · §15's "delete S1–S5" defers to Stage 9 — the consumer list was asserted wrong (again)

**The correction (Gate 0, self-issued).** The Stage-6 prompt said *"S1–S5 DIE (§15) — their last consumer
is gone."* **False.** `patterns.ts` (Stage 9's exclusive domain — "do not rewrite") still reads FOUR
S-derived fields: `r.structure` (the S-composite, `patterns.ts:183`, PX1/2/4), `r.s2Evaluable` (`:107/112/122`),
`r.neff` (`:115–123`), and `r.structureTier` (`:82/85`). The prompt's own NOT-IN-SCOPE acknowledged
`s2Evaluable`/`neff` but **missed `r.structure`** — the actual blocker, since it is computed from S1–S5.

**Ruling.** Stage 6 keeps S1–S5 **computed** (feeding those four fields); §15's delete moves to **Stage 9**,
bundled with the `patterns.ts` rewrite that repoints all four. Stage 6 removes only the **FE-side** S-rule
rendering (`STRUCTURE_RULE_META → C1–C6`, `s1Info`/`s2Info`/`effectiveBreadth`'s regex) + the
`StageBadge`/`structureTier` payload. Gate 3 asserts S1–S5 are **still computed** and the relative-threshold
idiom lives in C1 (`max(15, 1.5×fairShare)`, §15 lists it ALIVE).

**The pattern.** §15's *"delete, do not port"* is about the **design**, not the **schedule**: delete when
the last consumer is gone — and **PROVE the consumer list, don't assert it**. This is the *second* time the
sequencing was asserted wrong (Stage 5 ruling ① was the first — `r.structure` in `patterns.ts` was the
missed consumer both times). The FE-render fix is COMPUTE-vs-DISPLAY; the engine deletion is Stage 9.

## `cv2-s6-archetype` · Stage 6 · Archetype exposures — the debt-ETF gap is accepted, and we never guess

**Decision.** The archetype (§9.4) reads `debtExposure = {bond, gsec} by asset_class + "Debt Scheme" MUTUAL
FUNDS by category`; `commodityExposure = commodity-nature (gold/silver ETF) + sgb`. Implemented in
[`entity.ts`](../src/portfolio/phs/entity.ts) `buildExposures`/`archetypeOf`; thresholds in `constants.ts`.

**The accepted gap (operator-ruled).** AMFI labels **every ETF** *"Other Scheme"* (298/337 live), so a debt
ETF is **indistinguishable from an equity one by category**. `debtExposure` therefore counts bonds/gsec (by
class) and debt *funds* (by category), but **not debt ETFs** — a documented, honest gap (debt ETFs are rare
in retail books). **We do NOT guess an ETF's asset class from its name** — that would fabricate a fact. The
5,190 "unmatched" MF/ETF categories are the ETF "Other Scheme" rows + non-scheme formats; they fall to their
`asset_class` reads, never a guess.

**Also (Gate 1):** the Construction decomposition is persisted to a new `construction_data` JSONB (approved
migration), because `getPortfolioSnapshot` is a PURE read — you cannot display from a pure read what was
never persisted. `CDeduction` gained `subjectShare` + structured `firedSubject` so the FE renders from
FIELDS, never by parsing `detail` (rebuilding that regex trap is what broke the old Construction read). NOT
in `fingerprintOf` (§12 stays Stage 7).

## `cv2-s5-cutover-sequencing` · Stage 5 · The number cuts over in PERSIST; S1–S5 stay ALIVE; findings/FE deferred

**Decision.** At the cutover, the displayed Construction becomes C1–C6 Net — but the change is made in
ONE place: [`persist.ts`](../src/portfolio/phs/persist.ts) writes the `structure` COLUMN from
`r.construction.net`. The engine field `r.structure` stays the **legacy S-composite** (S1–S5 still
computed), so its two remaining consumers — `patterns.ts`'s PX findings and the FE `structureLedger`
render — keep working **byte-identical** until Stage 9 (findings) and Stage 6 (display) repoint them.

**The fork (operator ruling ①).** (a) delete S1–S5 + rewrite FE + findings now; (b) cut the NUMBER
over, keep S1–S5 alive, emit a C-ledger the FE tolerates; (c) write Net + C-ledger and accept a broken
FE. **Chose (b).**
- §15's *"delete, don't port"* is a statement about the **design**, not the sequencing. The boundary
  that keeps the cutover VERIFIABLE is COMPUTE vs DISPLAY: the only behavioural delta this stage is the
  `structure` column's value. (a) would blend a C-rule bug, an FE bug and a findings bug into one
  indistinguishable failure; (c) ships a runtime crash (the FE's `STRUCTURE_RULE_META[e.rule].title` is
  undefined for a C-rule entry).
- **FINDINGS byte-identical, for free.** Because `patterns.ts` reads `r.structure` (untouched
  S-composite), the number cutover cannot move a finding — proven in Gate 3 by *invariance to
  `construction.net`* (mutating it changes no finding) rather than a stale-snapshot compare. This is the
  §13 discipline extended to Part B: nothing out of scope moves.
- **The cost** — `r.structure` (field) ≠ `structure` (column). Confined to one commented line in
  `persist.ts` (which already maps `r.health → phs`), and internally consistent for the user: in the
  transitional state the headline shows Net while ALL S-rule detail (ledger + PX) consistently reflects
  the S-composite, until Stages 6/9 repoint them together.

**Gate 1 = NONE.** No new column — `construction` rides on `PhsResult` unpersisted (same treatment as
`gross`/`sectors`, Stage 7 §12 persists + fingerprints it); the Net scalar reuses the `structure`
column. The cutover needs no migration, exactly as the spec's Gate 1 predicted.

## `cv2-s5-c5-commodity` · Stage 5 · C5's subject is FUND PRODUCTS (basket ∪ commodity), not just baskets

**Decision.** C5 (fund-house dominance) scores single-AMC concentration over **baskets ∪ commodity** —
a gold/silver ETF counts. Implemented in [`entity.ts`](../src/portfolio/phs/entity.ts) `c5Of`
(`nature === "basket" || nature === "commodity"`).

**Why this deviates from §6's literal "baskets" subject** (operator ruling ③):
- A gold ETF **is** a fund product — an AMC, a scheme, operational apparatus (live proof: a 100% gold
  ETF resolved to *"360 ONE Mutual Fund"*). The 2020 debt-scheme freezes were an OPERATIONAL event; a
  gold ETF is exactly as exposed to its house as an index ETF.
- §3's commodity ruling says gold isn't an ENTITY → it stays outside name-risk (C1/C2) AND outside
  sector (C3/C4). It says nothing about FUND-HOUSE risk, which is real. **Only C5's subject widens.**
- **The deciding evidence — §10's own stress table.** `100% gold ETF → 75 · Commodity-led` is
  UNSATISFIABLE under the literal "baskets" reading (commodity ≠ basket → C5 not-evaluable → Net 100).
  Widening makes 75 fall out as a CONSEQUENCE, not a special case. Same class as `cv2-s4`'s Example C.

**Live coverage:** 100% — all 337 ETFs + 17,567 funds resolve a house via `mf_family_members →
mf_families.fund_house` (the `instruments.fund_house` fallback adds 0), so C5's house-unknown kill
essentially never fires and the single-fund/single-AMC → Net 75 guarantee is safe.

## `cv2-s5-c1-is-s1` · Stage 5 · The cutover's value is C2-uncapped, NOT "C1 fixes the S1 defect" — my prompt's premise was false

**The correction (operator ruling ④, self-issued).** The Stage-5 spec claimed the cutover fixes
7985d813's S1 defect and *"should change for the better."* **Both halves are false, and Gate 0's
recon proved it:**
- **C1 reproduces S1 byte-for-byte** on that book: RELIANCE 25.0% → −12.43, HDFCBANK 18.9% → −3.35,
  same 16.7% threshold, Σ −15.78 either way. `C1_FLOOR`/`FAIR_MULT`/`RATE` are **identical** to S1's,
  and both use `N = positions` (ratified `cv2-s3-c1-discrete`) — so the ₹2,218-funds artifact is
  *reproduced*, not repaired. The prompt's narrative was built from Stage 3's recon and never checked.
- **The number goes DOWN** (76.36 → **70.38**), and the entire −5.98 is **C2 (entity breadth, uncapped
  7.0, −13.84) vs S3 (capped 4.0, −7.86)** — the Aman-signed tool working as designed.

**Accepted, eyes open:** the whole cohort re-rates down (76.36→70.38 · 55→21 · 55→27.76 · 55→32.02),
bands drop 1–2 notches. **55 → 21 is the thesis** (§1: "one/two/three stocks all score 80 — the bottom
third is unreachable"): these are single/near-single-stock books the old scale could not reach, and 21
is the scale finally measuring them. **§1's framing should be corrected**: the cutover's value is **C2
uncapped**, and C1 IS S1 deliberately — §15 keeps the relative-threshold idiom alive, it does not fix it.

*(Resolves `cv2-s3-version-defer`: the deferred `CONSTANT_VERSION` bump landed here — 1.2 → 2.0 — as
that entry predicted, since the C-rules now feed the displayed number. The bump is the cutover's
delivery mechanism: without it, skip-identical would serve every unchanged book its stale S-value
forever. Ruling ②.)*

## `cv2-s4-bond-sector-catalogued` · Stage 4 · A bond inherits its issuer's sector from the CATALOGUE, not the scored set

**Decision.** A bond's sector is inherited from **any catalogued stock** (all 504 carry `sector_id`)
whose 7-char stem it matches — **191 bonds** — NOT only from a **scored** stock (**8 bonds**). Resolved in
[`assemble.ts`](../src/portfolio/phs/assemble.ts); classified in [`entity.ts`](../src/portfolio/phs/entity.ts) `sectorStateOf`.

**Why this deviates from §7's literal text** (*"bonds whose issuer resolves to a stock we score"*), and
why the deviation is correct:
- **A sector is a fact about the COMPANY** — NTPC is Energy whether or not we've scored NTPC's equity.
- **Data grades (§13):** "Health needs knowledge; Construction needs only maths." Sector is maths-grade
  data (a catalogue attribute); C3/C4 are Construction. Gating sector on Health-grade *scoring*
  availability conflates the two homes.
- **§15 — never penalise our own gap.** "Scored" would let our scoring **backlog** mark 183 bonds
  `not_applicable` and shrink the resolved sector picture, for a reason unrelated to sector.
- **The deciding evidence — the spec's own Example C.** It asserts "the NTPC bond sits in Energy with the
  NTPC stock," and NTPC is one of the **14 catalogued-but-unscored** issuers: under the literal reading
  the flagship example **cannot work**. When wording contradicts its own worked example, the wording is
  loose — *"a stock we score"* = informal for *"a stock in our universe."*

**Gap:** 191 vs 8 (16 issuers vs 2). **Spec text should be tidied** to "a stock in our universe."
Verified live: `INE423A07484` (Adani) → `metals_mining`. The 165 unresolved-issuer bonds stay
`not_applicable` (never `unknown` — see the three-states invariant).

## `cv2-s3-c1-discrete` · Stage 3 · The no-cliff holds for C2, NOT for C1 — accept + document, don't smooth

**The finding.** §9.5's no-cliff argument (₹100 of a fund must not move the number much) holds for **C2**
— it is scaled by `nameRiskShare`, which a fund nudges 1.0000 → 0.9999, moving C2 by ~0.01. It does
**not** hold for **C1**: C1's threshold `max(15, 1.5×100/N)` is **discrete in N**, so any added holding
can step an entity across it. Measured on Example B (Cummins pinned at the N=5 threshold, 30% == 30%):
adding a ₹100 fund makes N=6, drops the threshold 30→25, and fires C1 — **Gross 75.68 → 68.19**.

**Ruling: ACCEPT the step, DOCUMENT it, do NOT smooth it.**
- C1's step is **different in kind** from the archetype cliff §9.5 rejects. That cliff was *arbitrary* —
  ₹100 flips a category and the category swaps the whole rule set; nothing about the book changed, only
  our classification. C1's step is a **real structural change**: `fairShare = 100/N` asks "what would
  even look like for someone holding N things?" — holding 6 instead of 5 genuinely changes that answer.
  An entity at 30% *is* more lopsided in a 6-holding book than a 5-holding one. The threshold moving is
  the rule **working**.
- The discomfort is the step's **size at the margin** — a knife-edge artifact that bites only when an
  entity sits within `C1_RATE × (threshold_N − threshold_{N+1})` of the line. Example B is pinned there
  by coincidence of its numbers; most books are not.
- A continuous threshold function would be a **fabricated constant doing the heaviest lifting** in the
  rule — exactly what §15 forbids ("exposure decomposition — never built, never build it").

**Consequence.** Gate 3's no-cliff assertion is scoped to **C2's continuity** (asserted: nameRiskShare
1.0000→0.9999, |ΔC2| < 0.05), with **C1's step asserted as INTENDED** (0 → 7.50). `N` stays *all priced
positions* (excluding baskets would tell a 5-stock + 20-fund book its fairShare is 20% — a lie about
the user's structure). Verified in [`verify-cv2-stage3.ts`](../src/scripts/verify-cv2-stage3.ts) §5.

*(Motivating context, not a defect to fix: the S1 interim — `7985d813`'s persisted Construction 86.75
becomes 76.36 on next re-persist, a −10.4 from ₹2,218 of funds. That is the same S-rule flaw C1 replaces
at Stage 5/6; it is defensible under v1's own rules, and S1 is being deleted, not patched.)*

## `cv2-s3-version-defer` · Stage 3 · `CONSTANT_VERSION` stays "1.2" until the C-rules feed the score

**The fork.** The spec's Stage-3 constant table stamps `CONSTANT_VERSION = "portfolio-spec 2.0"`. That
string is in `fingerprintOf`, so bumping it changes **every user's** fingerprint → the next compute
re-persists all snapshots.

**Chose: DEFER the bump (keep "portfolio-spec 1.2").** The C1/C2 constants are computed-not-persisted —
`gross` is not displayed (§8) and not in the fingerprint (same treatment you ruled for `entityLedger`).
Bumping now would churn every fingerprint to re-persist **byte-identical** Health/structure values, and
would stamp snapshots "2.0" while their displayed logic is still v1.2 (S-rules + decoupled Health) — a
version stamp that lies about what produced the number. The honest bump point is **Stage 5/6**, when the
C-rules feed the displayed Construction, together with the Stage-7 §12 fingerprint inclusion — bump and
fingerprint-change land together. **This deviates from the ratified table; flagged for override** — if
you want the literal 2.0 now, it is a one-line change plus a `backfill-phs-snapshots` run. Low-regret to
defer (reversible); bumping then reverting would have already churned the snapshot table.

**Decision.** A holding's nature is `commodity` when `asset_class = 'etf'` **and** its AMFI `category`
matches `/\b(gold|silver)\b/i`. Everything else that isn't name-risk or sovereign is `basket`.
Implemented in [`entity.ts`](../src/portfolio/phs/entity.ts) `natureOf`.

**The fork.** (a) an **exact category allow-list** (`"… - Gold ETF"`, `"… - Silver ETF"`); or
(b) a **substring** match on `gold|silver`, scoped to ETFs.

**Chose (b), and why.**
- **Forward-covers a future Silver leaf** without a code change — AMFI's own leaf naming is
  `… - Gold ETF` / `… - Silver ETF`, so `gold|silver` catches the Silver ETF the day it appears.
- **Non-match → `basket`** stays the conservative default: it never manufactures a name-risk charge.
- **ETF-scope guard is load-bearing.** A `"Gold Sector Fund"` is a `mutual_fund` — a basket of mining
  *businesses*, not the metal — so it must stay `basket`. Nature is a fact about *this instrument*,
  not a word in a name. Only `asset_class='etf'` can be commodity.

**The trade-off we accepted.** Substring risks over-matching a hypothetical future `"Gold Sector ETF"`
(an equity basket) as commodity; an exact allow-list risks silently mis-classifying the *first* Silver
ETF as basket. We take the former: it is rare (AMFI names bullion ETFs specifically at the leaf), and a
commodity over-match merely keeps a holding *out of* the name-risk sleeve — the safe direction —
whereas the allow-list failure is silent and under-counts name risk.

**Live at decision time:** 25 Gold ETFs, 0 Silver, 0 null-category ETFs (the basket fallback is
expressible but unexercised).

---

## `cv2-s0-signals` · Stage 0 · Signals renormalizes over scored weight (§13-adjacent bug fix)

**Decision.** Signals weights each finding's deduction by the **scored-renormalized** weight
`w_i / ΣwScored` (= `marketValue_i / scoredValue`), **symmetric with Quality** — not the whole-book
`w_i`. Implemented in [`engine.ts`](../src/portfolio/phs/engine.ts) `computePhs`.

**Why this is ODL-worthy.** It edits `engine.ts` inside **frozen Health** (§13). It is permitted ONLY
because it is a **bug fix restoring intended semantics**, not a redesign: Health's law
(`Quality − 0.20×(100−Signals)`) is unchanged; only Signals' weight *denominator* is corrected to
match its sibling's.

**The fork.** (i) renormalize Signals over scored weight; (ii) exclude `heldNotScored` from the
Signals sum entirely.

**Chose (i), and why.** Signals-not-renormalizing was a *pre-existing* inconsistency, latent only while
every book was stocks-only (where scored weight == whole-book weight). (ii) routes *around* it — the
guarantee then depends on vigilantly keeping a population out of one sum, and the next population
rediscovers the trap. (i) fixes it **by construction**: both Health inputs renormalize over scored
weight, so the weight vector provably *cannot* move Health for any future book — §13 enforced by
symmetry, not exclusion. A finding is knowledge about a business; its weight belongs among the
businesses we can see, and holding ₹90L of gilt funds does not make a flag less true.

**Proof.** Live cohort Health byte-identical (73·73·69·65·50); the findings+funds collision stays at
Health 44 (Signals 20), not lifted to 58.

---

## Open obligations (deferred — must not be missed)

- **NOW — repair `108fd2a6`'s zombie-written served row (operator-run).** Its latest snapshot is a stale
  `cv 1.2 · structure 55.01` row written by the scheduler zombie (`cv2-scheduler-hazard`), so the book
  **displays Construction 55 (Lopsided) instead of ~32 (Precarious)**. The stale writer is dead, but the row
  it left behind is not self-healing. **`backfill-construction-data.ts` cannot fix it** (it syncs `net` to that
  row's own `structure` → bakes 55.01). Requires a fingerprint-gated re-persist —
  [`backfill-phs-snapshots.ts`](../src/scripts/backfill-phs-snapshots.ts) — which writes only the stale books
  (cv-1.2 fingerprint ≠ cv-2.0) and skips the clean ones. Agent-direct execution is blocked by policy: the
  **operator runs the mass backfill**. Verify after with `recon-scheduler-hazard.ts` (expect all 5 latest rows
  `cv 2.0`, `cd=present`, Health 73·73·69·65·50).
- **Stage 6 — repoint the FE `structureLedger` render + bands/archetype to `construction`.** The FE
  ([`construction-read.tsx`](../../Vytal-Frontend/components/portfolio/health/construction-read.tsx))
  still renders the S-rule ledger (`STRUCTURE_RULE_META` keyed S1–S5, `s1Info`/`s2Info` regexes). It
  TOLERATES the cutover only because `structureLedger` stays S-rules; Stage 6 swaps the render to the
  C-ledger (persisted then) + the archetype labels (Fund-led / Blended / Commodity-led) + any band
  rename. THIS is where the number and its evidence stop disagreeing. (`cv2-s5-cutover-sequencing`.)
- **~~Stage 8 — §14 thematic-fund matcher.~~ CLOSED, REFUSED (`cv2-s8-matcher-unratified`).** The
  ratification audit returned **11.9%** (172/1449 resolve to one of our sectors; thematic funds 0–1.6%).
  §14 made the number a gate and it failed, so **the fund arm does not ship**: every fund stays
  `not_applicable`, `matcherVersion` stays `"none"`. **The obligation MOVES to fund look-through (Phase 2)
  — NOT to "extend the regexes".** Thematic funds are not sectorable from their names; that is a data
  problem, and more patterns cannot fix it. Re-derive the number with `audit-fund-sector-coverage.ts`
  before reopening.
- **Look-through (Phase 2) — the honest path to a fund's sectors, and §10 Example D's only route.**
  §14/doc-2 §13.5: *"the index-constituent path is the cheap, exact first slice."* Until then §10's
  Example D (Net 60.6) is UNSATISFIABLE — its 30% pharma fund stays `not_applicable`, so C3 sees only
  stock-Pharma 30% < 40 → C3 = 0. Gate 3 asserts the INTERIM value and flags the dependency; that is not
  a defect, and **it must not be "fixed" by extending the matcher** (`cv2-s8-matcher-unratified`).
- **Stage 9 — the "single-sector book" Concern: the reported defect is NOT real, but two adjacent traps
  ARE.** Reported at Stage 8: *"`maxSectorPct > 60` requires C3 fired; C3's cap (30) binds at 65%; §11.1
  gates PC5 behind PC4 behind C3 ⇒ the Concern can never fire."* **Tested against the shipped code —
  false.** ([`probe-pc4-reachability.ts`](../src/scripts/probe-pc4-reachability.ts): a 100%-pharma book
  fires `PC1,PC2,PC3,PC4,PC5,PS5,PV1,PX1` — the Concern fires, *with C3 capped at −30 in the same run*.)
  Three corrections, all of which Stage 9 must carry:
  - **⚠️ THE NUMBERING DIVERGES BETWEEN THE TWO LIBRARIES.** doc 1 (v1 — what `patterns.ts` actually
    implements): **PC4** = "Single-sector book" (`>60%`), **PC5** = "Thin effective spread" (`neff < 5`).
    doc 2 (v2 — Stage 9/10's target): **PC4** = "Sector concentration" (C3 fired), **PC5** =
    "Single-sector book" (`maxSectorPct > 60`). **They are swapped.** Anyone reading doc 2 and grepping
    `patterns.ts` for PC5 lands on the wrong finding — which is exactly how this was reported. Reconcile
    the numbering FIRST, or the repoint will rewire the wrong rules.
  - **§11.1 says "PC5 *suppresses* PC4", which is the REVERSE of gating.** Suppression = when both fire,
    PC5 headlines and PC4 hides. It does not make PC5 depend on PC4. And `maxSectorPct > 60` *implies* C3
    fired (threshold 40), so C3's fired subject is always present when the Concern's condition holds —
    carrying the **raw, uncapped** weight. The cap applies to `points`, never to the measured weight.
  - **THE REAL TRAP, and it is the Stage-7 residual coming due.** `maxSectorPct` has **no home** when C3 is
    clean or not-evaluable: `firedSubject` is null, `sectorWeights` is NOT persisted in
    `construction_data`, and the number survives only in `detail` prose. Stage 7 fixed exactly this class
    for the Neffs (`metrics`, present whether or not the rule fired) and flagged C1's threshold and C3's
    top-sector weight as the untreated residual. **Stage 9's repoint will hit it**: give C3 a `metrics`
    entry carrying the raw `maxSectorPct` before repointing any sector finding onto the C-ledger.
  - **KEEP THE PRINCIPLE — it is right even though the instance was not:** *the cap is a **deduction
    ceiling**, not a **truth ceiling**. A 100%-pharma book IS a single-sector book even though C3 stops
    charging at 65%. The finding says what is TRUE; the rule decides what it COSTS.* Different jobs, §0's
    three homes. A guard that structurally cannot fire is worse than an absent guard — it reads as
    coverage. (Third instance of that disease this session: dead `sectorVersion`, stage6's report-only
    tables, and this — except this one turned out to be a false alarm, found only by testing it.)
- **Stage 9 — repoint `patterns.ts` PX findings off the S-composite.** PX1/PX2/PX4 read `r.structure`
  (the legacy S-composite) — kept alive so findings stay byte-identical through the cutover. Stage 9
  repoints them to `construction.net` (and rewrites PC/PB off the C-ledger), after which S1–S5 and the
  `r.structure` field can finally be deleted. (`cv2-s5-cutover-sequencing`.)
- **✅ DONE (Stage 7) — `entityLedger` + the construction decomposition into `fingerprintOf`.** Closed. The
  hash now carries the entity-aggregated weight vector, `assetClass`+`nature` per holding, the
  sector-resolution outputs, `fund_house` per fund product, and the §14 matcher version; the dead
  `sectorVersion` is gone. See `cv2-s7-jsonb-single-source` / `cv2-s7-sectorversion-removed`. The
  obligation text below is kept for the reasoning that produced it.
- **Stage 7 — `entityLedger` + the whole `construction` decomposition into `fingerprintOf`.** The entity
  ledger, `gross`, `sectors`, and now `construction` (C3–C6 + Net) are all EXCLUDED from the PHS
  fingerprint ([`persist.ts`](../src/portfolio/phs/persist.ts) `fingerprintOf`). This was correct while
  nothing displayed consumed them — **but the cutover changed that: `construction.net` IS the displayed
  `structure` column now.** It reaches every book via the `CONSTANT_VERSION` 2.0 bump (a fingerprint
  input), which is sufficient for the cutover itself. §12 still requires the entity-aggregated weight
  vector + the C-inputs IN the fingerprint at Stage 7, so a re-aggregation or a sector/house change
  triggers a rescore directly rather than only via the version stamp. **Out now, in at Stage 7.**
