# ADDENDUM — How the Findings Library Feeds the Storyboard

**Attaches to:** `Vytal Portfolio Storyboard & Findings Library` (`portfolio-findings 2.0`).
**Supersedes:** §2 of that document (the six-panel spine). **Scrap it.** Everything else in the library — every family, every finding, every Doesn't-mean, every anti-double-count rule — **stands unchanged.**

---

## 1 · What was wrong

The six-panel spine was **a form, not a story.** Six labeled boxes, a header on each, findings rendered as cards inside them. A form *lists*. A story *connects* — "but," "which means," "the reason." A form has fields. A story has a through-line and a point.

**And one panel was worse than merely formal.** Panel 5 was titled *"The facts nobody gives you"* and it contained *"your Nifty Bank ETF gives you banking exposure our sector reading can't see."* That is **our limitation, dressed as a gift.** Nobody else tells the user that because it is not a thing worth telling them. It is a disclosure. Presenting it as value is exactly the kind of self-flattery this platform exists not to do.

---

## 2 · The division that fixes it

**The findings catalog is exhaustive. The storyboard is selective.**

They are two different artifacts and both ship:

| | **The story** | **The reference** |
|---|---|---|
| Form | flowing prose, 4–6 sentences | structured, listed, expandable |
| Contents | the 2–4 things that matter about *this* book | every fired finding, the evaluability detail, every disclosure |
| Voice | a person explaining | a catalog |
| Built from | selected findings, stitched | all fired findings, rendered |

**The story sits on top. The reference sits below it.** A user who wants the full picture scrolls. A user who wants to understand their portfolio reads four sentences and *does*.

This means the whole library survives intact — it just stops being the display. It's the **ingredient list**, not the plate.

---

## 3 · The through-line — four movements, not six panels

These are **narrative beats, not sections.** They do not get headers. They do not get boxes. They flow into each other as continuous prose.

| Movement | The question it answers | Fed by |
|---|---|---|
| **1 · What you hold** | *What kind of book is this?* | PA1, archetype, composition shares |
| **2 · What we can judge** | *How much of it can we speak to — and why not the rest?* | coverage, PV6, **PV2** (⚠ **not PV3 — retired; drift #13**) |
| **3 · The two reads** | *What do the numbers say, and do they agree?* | Health, Construction, PX family |
| **4 · The point** | *What's the one or two things that actually matter here?* | highest-priority PC/PB/PI |

**Movement 4 is why the story exists.** Movements 1–3 set up; movement 4 pays off. If a book has nothing notable, movement 4 says so plainly and the story is three sentences long. **A short story is a valid story.** Padding it is how we'd become every other tracker.

**The order is fixed, but the emphasis is not.** A fund-led book spends most of its words in movement 2 (because scope is the story). A concentrated stock book spends them in movement 4 (because the concentration is the story). That is the dynamism — the narrative weights itself to the book.

---

## 4 · How a finding becomes a sentence

**Add one field to `PfFinding`:**

```ts
export interface PfFinding {
  // ...existing: id, family, label, tone, loud, bind, read, doesntMean
  storyClause?: string;   // NEW — a stitchable fragment, not a standalone sentence
}
```

**`read` and `storyClause` are different registers of the same fact:**

| Field | Register | Example (PC3) |
|---|---|---|
| `read` | standalone, for the reference list | *"You hold NTPC shares (11%) and an NTPC bond (8%). That is 19% of your book riding on one company — the instrument list shows 11%."* |
| `storyClause` | a fragment built to be joined | *"you hold NTPC shares at 11% and an NTPC bond at 8% — your holdings list shows two positions, your risk shows one company at 19%"* |

Not every finding needs a `storyClause` — only those eligible for movement 4 (see §5). Quiet, reference-only findings ship `read` + `doesntMean` and nothing more.

**The Doesn't-mean does not enter the story.** It lives on the reference item, one tap away. Putting a hedge in every sentence is what makes a story unreadable — and the hedge is more honest as a click than as a mumble.

---

## 5 · Selection — what earns a place in the story

Not everything that fires gets told. The story picks. Three rules:

**Rule 1 — Movement 4 takes at most two findings.** Ranked: **Concern > Caution > Neutral**, and within a tone, **higher capital weight first**. A third thing is a list, and a list is a form. The rest wait in the reference.

**Rule 2 — Constructive findings can carry movement 4 alone.** If a book is well-built and fully verified, the story says so and stops. *"Nothing here needs your attention."* is a complete and valuable movement 4.

**Rule 3 — the limitation rule.** This is the one that fixes the Nifty Bank ETF mistake:

> **A limitation enters the story only when it changes how to read a number that's already in the story. Otherwise it is reference.**

- *"We can't see inside your Nifty Bank ETF"* on a book with 12% in it → **reference.** It changes nothing about how to read anything.
- *"60% of your book is sector ETFs we can't see into, so the sector figure above reflects almost none of your money"* → **story.** It changes how to read a number the user is looking at.

Same fact. The difference is whether it's load-bearing for something the user is reading right now.

---

## 6 · Stitching

Findings do not arrive pre-connected. The composer joins them, and the connective is chosen by **the relationship between the two facts**, not by a random shuffle:

| Relationship | Connective | Example |
|---|---|---|
| agreement | *and*, *which is why* | *"...spread across eight companies, **and** nothing here concentrates."* |
| tension | *but*, *though* | *"Construction reads 79 — solid. **But** one thing is worth your attention:"* |
| explanation | *— not because…, but because…* | *"...our health score doesn't reach it — **not because** we've missed them, **but because** health reads businesses."* |
| scope | *of that*, *that slice* | *"We can read about 30% of your book. **That slice** scores 71 — steady."* |

**PX6 (the gross/net gap) is the natural tension connective** — it exists precisely to say *"your spread is fine, but one specific thing moved the number."* When PX6 fires, it should almost always be the hinge between movement 3 and movement 4.

---

## 7 · Who composes — deterministic, not the AI layer

**Ruling: the storyboard is composed deterministically from the sentence grammar above. The Gemini layer does not write it.**

Three reasons:
1. **Identical books must produce identical stories.** The storyboard is a statement of fact about someone's money. It cannot vary by sampling.
2. **Free prose over financial data is exactly where "you should trim" leaks in.** Every non-negotiable in this platform — never advise, never predict, never juxtapose health against returns — is enforceable in a grammar and unenforceable in a generation.
3. **The Portfolio Doctor is a different job.** It is a *conversation* — the user asks, it answers, scoped and guarded. The storyboard is a *statement* — unasked, and therefore held to a higher bar.

Deterministic does not mean robotic. It means the connectives are chosen by logic instead of by vibes, which is what makes the story honest.

---

## 8 · What this looks like — the three books, rewritten

### Blended — ₹52L
> **Your portfolio takes a blended approach — ten holdings across stocks, funds, a bond, gold and a G-Sec, with no single instrument type dominating.**
>
> **We can read the health of about 30% of it.** That slice scores **71 — steady**. The rest sits in funds, gold and government paper, which our health score doesn't reach — not because we've missed them, but because health reads businesses, and these aren't businesses we can see into.
>
> **Construction covers the whole book, and it reads 79 — solid.** Your money is spread sensibly across what you hold. But one thing is worth your attention: **you hold NTPC shares at 11% and an NTPC bond at 8%.** Your holdings list shows two positions. Your risk shows one company at 19%.

*Used: PA1 → PV6 + coverage → Construction + PX6 → PC3. Four findings, one paragraph, one point. The Nifty Bank ETF limitation is in the reference below, where it belongs.*

### Fund-heavy — ₹6L
> **This is a fund-led portfolio — four mutual funds and one stock, with 90% of your money in funds.**
>
> **That means our health read covers very little of it.** The one stock you hold, Infosys, scores **74 — steady**, but it's 10% of your book, so treat that number as being about a corner rather than the whole. Your funds aren't unscored because we've missed them — health reads businesses, and we can't yet see which businesses a fund holds.
>
> **Construction reads 71 — solid**, and it's the number that actually covers your book. Two things stand out: **HDFC manages 60% of your money** across two funds — one house, one set of operational arrangements. And **one of your funds is dormant** — it's no longer in AMFI's daily NAV file, so we can't mark it to a current price. Last known value is from [date].

*Movement 2 carries the weight here — scope IS the story for a fund-led book. Two findings in movement 4, both Neutral/Caution, neither touching a score.*

### Sector overlap — ₹8L
> **Six holdings — three pharma companies, a pharma fund, an index fund and a liquid fund.**
>
> **We can read about 30% of your book;** those three companies average **71 — steady**.
>
> **Construction reads 61 — concentrated.** Your money is spread reasonably across the six things you hold — on that alone you'd read 89. **What moved the number is the theme: 60% of your book is in pharma** — the sectoral fund plus the three companies. Health and risk here move substantially with one sector.

*PX6 is the hinge: "on that alone you'd read 89" is the gross/net gap doing exactly the job it was designed for. Three sentences of setup, one point, done.*

---

## 9 · What changes in the library

**Nothing is removed. Three additions, one relocation:**

1. **`PfFinding.storyClause`** — optional, on findings eligible for the story.
2. **Movement eligibility** — each family declares which movement it can serve. PA → 1. PV/PE → 2. **PX/PQ/PS → 3** (⚠ **PQ and PS were omitted here — drift #14; both are movement-3 pillars, PQ is Quality's shape and PS is Signals'**). PC/PB/PI → 4. PD → reference only, always. **Enforced, not documented:** `story.ts` `MOVEMENT_HOME` is exhaustive and an unrouted family throws — which is how the PQ/PS omission was caught, on the first real book (it fires PS5).
3. **The reference layer** — everything the story didn't use renders below it, structured and expandable. **Nothing is suppressed; things are just ranked.**
4. **§2's six panels → deleted.** Replaced by the four movements plus the reference layer.

**Explicitly unchanged:** every finding, every trigger, every Doesn't-mean, §1's inviolable rule, §11's anti-double-count and triage, §12's one test, §13's open items. The catalog was right. Its display was not.

---

*The story tells the two things that matter. The reference holds everything else. A user should be able to read four sentences and understand their portfolio — and then, if they want, read the other forty and understand it deeper.*
