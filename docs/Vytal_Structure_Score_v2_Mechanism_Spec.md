# Vytal — Structure Score v2 (Construction): Mechanism Specification

**Version stamp:** `portfolio-spec 2.0`
**Supersedes:** the Structure pillar (S1–S5) of `portfolio-spec 1.0/1.1/1.2`.
**Does NOT touch:** the Health Score. Not one line. See §13.

**Status of all numeric constants:** **DECLARED, NOT DERIVED.** The stock engine's bars come from survivor/distress distributions. There is no portfolio corpus. Every threshold, rate, cap and target below is a **design constant set by product judgment**. Calibration path is fixed: collect real portfolio distributions post-launch, then tune via a clean version bump. Never a silent edit.

---

## ▶ SECTION 0 — MESSAGE TO THE ARCHITECTURE CHAT

**What this is.** The complete build contract for **Construction** — Vytal's whole-book structural read — rebuilt for a multi-asset portfolio (stocks, mutual funds, ETFs, bonds, G-Secs, SGBs, REITs, InvITs).

**Why it exists.** Two reasons, and the first is a live defect:

1. **Non-stock holdings are currently invisible to the portfolio engine — including to the coverage line.** `assemble.ts:194` routes every non-stock position to `heldNotScored` and `continue`s. It never reaches `byStock`, never becomes a `PhsHolding`, never enters `engine.ts:120`'s `totalValue`. So coverage today = *scored stock value ÷ **stock** value*. A user with ₹10L in stocks and ₹90L in funds is told **"covers 5 of 5 holdings · 100% of value."** The one sentence we built to make a pure-Health number honest is currently the thing that is wrong. This is pre-production (18 holdings live) but it is **stage zero** of this build.

2. **S1–S5 were equity-shaped and the scale is compressed.** Under the live relative-S1, a **100% single-stock portfolio scores Construction 80 · "Solid"** — C1 cannot fire (threshold 150%) and S3 caps at −20. One stock, two stocks, and three stocks all score exactly 80. The bottom third of the scale is unreachable.

**The design law this spec obeys — read it before reading the rules:**

> **Adaptivity is evaluability, not leniency.** We do NOT switch rule sets by user type. Every rule declares a **subject**. It fires where its subject exists and is **silently absent** where it does not — not because we are being kind, but because the rule has nothing to measure. One rule library, every book, no archetype branching in the maths. The adaptivity is *emergent*.

**The three homes (do not blur them):**
- **Health** — the stock engine's read. Frozen. Nothing here reaches it.
- **Construction** — weight arithmetic over the whole book. **This document.**
- **Findings / disclosures** — everything that is neither a score input nor structural (ETF premium, Regular-vs-Direct, dormancy, fund redundancy). Unscored, but **not quiet** — a loud finding can dominate the screen above the score. **Doc 2.**

**What NOT to do:**
- **Never score asset mix.** There is no correct equity/debt ratio without knowing someone's goals. Asserting one is advice. Asset mix is **described** (archetype label), never scored, never a deduction.
- **Never let an instrument defect deduct.** A 12% ETF premium is true whether you hold 2% or 40% of it — your construction did not cause it. Instrument facts are findings.
- **Never use `mf_analytics`.** Every field in it (ret, vol, Sharpe, alpha, rank, percentile, drawdown) is returns. Returns live on Performance.
- **Never fabricate.** Where a fact is unavailable, the rule goes **not evaluable** and says so. Honest-empty over invented.
- **Do not touch Health.** See §13.

**Build order:** Stage 0 (population fix) → entity model → weight vector → C1–C6 → gross/net → bands → persistence. Verify each stage against §10 before the next.

**Prerequisite that gates part of this build:** see §14 — the fund-sector matcher audit. C3/C4's fund arm cannot be trusted until it is done. Everything else is buildable today.

---

## 1 · WHAT CHANGED, AND WHY

| | v1 (live) | v2 (this doc) |
|---|---|---|
| Population | stocks only; non-stock silently dropped | **every priced holding** |
| Concentration subject | any holding | **name-risk entities, aggregated by issuer** |
| Breadth | Neff over all holdings, capped −20 | **Neff over the name-risk sleeve, sleeve-scaled, uncapped** |
| Sector | stocks only, cap 25 | **stocks + resolved bond issuers + thematic funds; dominance AND breadth** |
| Fund house | — | **C5** |
| Staging | one flat list | **gross (entity physics) → net (named defects)** |
| Realistic range | **[55, 100]** | **[~20, 100]** |

**The diagnosis in one line:** C1 correctly never fires on a balanced book (that is what "relative threshold" *means*), which left **C2 as the only rule charging "this book is thin"** — and we capped it at −20, which binds at Neff 3. The one rule carrying the entire small-book question was gagged.

**Why raising C2's rate is not the v1 bug returning.** The v1 bug was a **double-charge** — S1 and S3 both billing smallness — and it was **inescapable**: a 5-stock book *cannot* hold positions under 20%, so it was guilty by arithmetic. Here: (a) only C2 charges thinness, once; (b) C1 provably cannot fire on a balanced book of any N; (c) the charge is **escapable** — the same money in one index fund scores 100; (d) the two-read split means a small book of good companies still shows a true Health number beside it. The v1 bug printed a single 54 on a healthy book. That book now reads **Health 71 · Construction 76**.

---

## 2 · STAGE 0 — THE POPULATION FIX (build this first)

The code already names the right set. `partition()` (`assemble.ts:144-248`) splits positions three ways:

- **`byStock`** → priced, scored → becomes a `PhsHolding`. *(today: the only population)*
- **`heldNotScored`** → **priced, no health of ours.** *"We KNOW what it is worth. It is not a gap — it is capital we deliberately do not judge."* **This is v2's new population.**
- **`heldNotValued`** → genuinely unpriceable. Cannot enter a weight vector.

**Ruling:**
1. **`heldNotScored` enters the weight vector and Construction.** It has a market value; it is capital; it has weight. It contributes **nothing** to Health (correct — no business we score).
2. **`heldNotValued` is excluded from the denominator**, its value **declared on the payload**, and past a threshold Construction goes provisional (§9.3). Same shape as the unknown-sector gate.
3. **`invested` is never substituted for `marketValue`.** Confirmed absent today (`assemble.ts`, `engine.ts`) — keep it that way. Mixing cost basis and market value in one weight vector is a quiet lie.
4. **Fix `assemble.ts:335`'s `: 0` fallback.** A confirmed-priced stock whose lookup returns empty currently becomes a **₹0-weighted holding inside the denominator**. It must route to `heldNotValued`, not to zero.

**Consequence — the coverage line becomes true.** `coverage = scoredValue / totalValue` where `totalValue` now spans the real book. The ₹10L-stocks + ₹90L-funds user correctly reads **"covers 5 of 14 holdings · 10% of value."** No engine change — the denominator was always right, the population was wrong.

---

## 3 · INSTRUMENT CLASSIFICATION — BY NATURE, NOT ASSET CLASS

This is a **fact about what the instrument is**, not an inference.

| Nature | Asset classes | Why |
|---|---|---|
| **Name-risk** | `stock`, `bond`, `reit`, `invit` | Value rides on **one entity's** fate. If it fails, the position goes with it. |
| **Basket** | `mutual_fund`, `etf` *(except commodity ETFs)* | Holds many businesses **by construction**. Not a single-name exposure. |
| **Sovereign** | `gsec`, `sgb` | One issuer, but not a diversification question. GoI is not an entity that "fails" in the name-risk sense. |
| **Commodity** | gold/silver ETFs *(by `category`)* | One thing, but **not an entity**. See below. |

**The commodity ruling (I got this wrong in an earlier draft — this is the correction):** C2 measures **name risk** — *if one entity fails, how much goes with it?* **Gold is not an entity.** A commodity ETF therefore sits **outside** the name-risk sleeve, not inside it. 100% in a gold ETF produces **Construction 100** and the archetype label *"Commodity-led book"* carries the truth. Asset mix is described, never scored — and that is not a loophole, it is the law.

**Classification source:** `instruments.asset_class` (populated for all 18,000+ rows). Commodity ETFs identified via `instruments.category`. Where category cannot resolve a commodity ETF → treat as **basket** (the conservative direction: it does not manufacture a name-risk charge).

---

## 4 · THE ENTITY MODEL

**Verified by recon.** 191 bonds stem-match a company we score (HUDCO `INE031A07840` ↔ `INE031A01017`; also RECLTD, PFC, IREDA, SAMMAANCAP). All 504 stocks are `INE`-prefixed, 12 chars. G-Secs/SGBs live in the `IN0`/`IN1`/`IN2` namespace and **structurally cannot collide**. `issuerStem` is already **stored** as a JSONB key on every bond, written by production ingest (`ingest-bonds.ts:372-382`), not a script.

```
entity_key(holding) = holding.isin.slice(0, 7)        // name-risk instruments only
```

- **Stocks:** computed from `stocks.isin`. (`instruments.attributes` is NULL for all 504 stocks — compute at read.)
- **Bonds:** `attributes.issuerStem` (stored, 20/20 populated in sample). Equals `isin.slice(0,7)` — use the stored value, assert equality in tests.
- **REIT/InvIT:** own stem — each is its own entity.
- **Baskets / sovereign / commodity:** **no entity key.** Not name-risk. Never aggregated.

**Aggregation:** C1 sums weight **by `entity_key`, not by instrument.** NTPC stock 11% + NTPC bond 8% = **one entity at 19%.**

> **This does not contradict the "don't conflate a bond with the issuer's equity" warning.** That warning is about **Health** — a bond must never inherit an equity score, because equity health and credit health diverge in a knowable direction (a utility is a mediocre equity and a superb credit). For **concentration**, one company's fate is one company's fate. Different question, different answer.

**No production code groups by entity today** (`union.ts` groups by symbol). This is new work.

**Bond with unresolved issuer** (`issuerNullReason: "not_in_our_universe"`, ~165 of 356): it is still **name-risk**, still enters C1/C2 as **its own standalone entity** (keyed by its stem). It simply never aggregates with a stock. No penalty for our gap.

---

## 5 · THE WEIGHT VECTOR

```
priced      = { holdings with a resolvable market value }          // byStock ∪ heldNotScored
totalValue  = Σ_priced marketValue
w_i         = marketValue_i / totalValue                            // over ALL priced holdings
```

**Sleeve shares** (each in [0,1], computed once, persisted):

```
nameRiskShare  = Σ w_i  over name-risk holdings
basketShare    = Σ w_i  over baskets
sectoredShare  = Σ w_i  over holdings with a resolved sector       // §7
unvaluedValue  = Σ marketValue over heldNotValued                   // NOT in totalValue
unvaluedShare  = unvaluedValue / (totalValue + unvaluedValue)       // declared, never scored
```

**Sleeve-internal weights** (used by C2/C4 — this is what makes sleeve-scaling honest):

```
w_sleeve_i = w_i / sleeveShare        // renormalized within the sleeve; Σ = 1
```

---

## 6 · THE RULE LIBRARY — C1 to C6

Every rule declares a **subject**. No subject → the rule does not fire, is not a zero, and is **reported as not-evaluable** on the ledger. Two independent questions at each level:

| Level | **Dominance** — is one thing too big? | **Spread** — is the distribution real? |
|---|---|---|
| **Entity** | **C1** | **C2** |
| **Sector** | **C3** | **C4** |
| **Fund house** | **C5** | — *(deliberately omitted: "how many AMCs" is not a risk; "one AMC holds everything" is)* |
| **Book** | — | **C6** |

---

### C1 · Entity dominance

**Subject:** name-risk entities (post-aggregation). No name-risk holdings → not evaluable.
**Denominator:** whole book.

```
N            = total priced holding count                    // positions, not entities
fairShare    = 100 / N
threshold    = max(C1_FLOOR, C1_FAIR_MULT × fairShare)       // max(15, 1.5 × fairShare)

per entity e with weightPct_e > threshold:
    ded_e    = C1_RATE × (weightPct_e − threshold)
C1           = min(Σ ded_e, C1_TOTAL_CAP)                    // TOTAL cap, not per-entity
```

**Change from v1:** the cap is now on the **total**, not per-holding. v1's per-holding −25 cap was **non-monotonic** — two 50% positions cost −50, one 100% position cost −25. Summing then capping at 30 is monotonic and still charges multiple violations harder than one.

**Why it correctly never fires on a balanced book:** a 5-holding book has fairShare 20% → threshold 30%. Even weights are 20%. Nothing fires. That is the point: C1 measures **lopsidedness relative to the user's own structure**, never smallness. Smallness is C2's job, charged **once**.

---

### C2 · Entity breadth *(the load-bearing rule)*

**Subject:** the name-risk sleeve. `nameRiskShare = 0` → not evaluable, skipped entirely.

```
Neff  = 1 / Σ (w_sleeve_i)²          over name-risk entities, sleeve-renormalized
C2    = C2_RATE × (C2_TARGET − Neff) × nameRiskShare      when Neff < C2_TARGET
      = 0                                                  otherwise
```

**No cap.** Natural maximum is `7 × 7 × 1.0 = 49` at Neff 1 with a 100% name-risk book. An artificial cap is what compressed v1's whole bottom third.

**Sleeve scaling is what makes this fair across archetypes:**

| Book | Sleeve | Neff | C2 |
|---|---|---|---|
| 100% one stock | 1.00 | 1.0 | **−49** |
| 95% funds + 5% one stock | 0.05 | 1.0 | **−2.45** |
| 50% index fund + 50% one stock | 0.50 | 1.0 | **−24.5** |
| 100% one index fund | **0.00** | — | **not evaluable** |

The fund investor is not charged for a 5% stock position. The index-fund investor is not charged at all — the rule has no subject.

---

### C3 · Sector dominance

**Subject:** sectored value (§7). **Denominator: whole book** — sector pile-up risk is *how much of my money moves with one sector*, so a 20%-equity book whose equity is all financials has 20% sector-exposed, not 100%.

```
maxSectorPct = 100 × max over sectors of ( Σ w_i for holdings in that sector )    // whole-book weights
C3           = min(C3_RATE × (maxSectorPct − C3_THRESH), C3_CAP)                  when > C3_THRESH
```

**Cap raised 25 → 30.** v1's 25 bound at 61% sector — a 60%-financials book and a 100%-financials book scored identically.

**Threshold stays 40%** (not 35) — Indian indices are financials-heavy; a normal book must not trip it.

---

### C4 · Sector breadth *(new)*

**The hole it closes:** ten stocks across three sectors at 33% each fires **nothing** today — max sector 33 < 40, Neff 10 > 8. That is false diversification and we are blind to it.

**The trap it must avoid:** a naive sector-Neff **re-charges smallness**. In a 5-stock/5-sector book, `Neff_sector ≡ Neff_entity` — charging both is the v1 double-charge reborn. The fix is a **relative target**, the same idiom as C1:

```
// A sectored UNIT = an entity (name-risk, post-aggregation by entity_key)
//                 = an instrument (thematic basket — baskets have no entity key)
Neff_unit   = 1 / Σ (w_sectored_u)²      over sectored UNITS,  renormalized within sectoredShare
Neff_sector = 1 / Σ (sectorW_s)²         over sector totals,   renormalized within sectoredShare

target      = min(C4_TARGET, Neff_unit)                                   // ← the anti-double-charge
C4          = min(C4_RATE × (target − Neff_sector), C4_CAP) × sectoredShare    when Neff_sector < target
```

**Units, not positions — this is a correctness requirement, not a detail.** If NTPC stock and an NTPC bond both sit in Energy, a position-level `Neff_pos` counts them as *two things in one sector* and charges the "collapse" from 2 → 1. They are **one thing**. Entity-aggregating first (consistent with C1/C2) is the only way the anti-double-charge guarantee holds. Baskets have no entity key and are their own unit.

**The guarantee:** if every unit sits in its own sector, `Neff_sector = Neff_unit = target` → **C4 = 0, always.** C4 can only fire when units *share* sectors — which is exactly, and only, the new information it exists to capture.

**Subject:** sectored value. `sectoredShare = 0` → not evaluable.

---

### C5 · Fund-house dominance

**Subject:** baskets with a resolved fund house. **Denominator:** whole book.

```
maxHousePct = 100 × max over fund houses of ( Σ w_i for baskets of that house )
C5          = min(C5_RATE × (maxHousePct − C5_THRESH), C5_CAP)      when > C5_THRESH
```

**Why this is structural and not a finding:** five funds from one AMC is a genuine single point of failure — one operational, governance, or key-person event touches all of it. That is a construction fact. (By contrast, **five large-cap funds being redundant is a finding, not a rule** — redundancy is an inefficiency, not a structural risk, and scoring it means judging their choice.)

**Resolution path (verified):** `instrument → mf_family_members.family_id → mf_families.fund_house`. `MfFamily.fundHouse` is **non-null and part of the unique key**, so it is guaranteed for the 14,041 funds in families. Fallback: `instruments.fund_house` (nullable, population uncounted). **Baskets with no resolvable house are excluded from C5's numerator and their weight is reported as `houseUnknownShare`.** If `houseUnknownShare > 50% of basketShare` → **C5 not evaluable.**

---

### C6 · Monitorability

**Subject:** holding count. Always evaluable.

```
C6 = min(C6_RATE × (count − C6_THRESH), C6_CAP)      when count > C6_THRESH
```

Deliberately mild. A 40-name book is an unmonitorable closet index — a lesser sin than dangerous concentration, and the penalty says so.

---

## 7 · SECTOR RESOLUTION — THREE STATES, NEVER TWO

`unknown` and `not_applicable` are **different facts** and must never be pooled.

| State | Population | Effect |
|---|---|---|
| **Resolved** | stocks (`stocks.sector_id` → `Sector.name`; **504/504 populated**); bonds whose issuer resolves to a stock we score (inherit the issuer's sector); thematic funds matched by the sector matcher (§14) | enters C3/C4 |
| **Unknown** | a fund whose `category` says **sectoral/thematic** but the matcher returns no sector; a stock with null sector (0 today) | pools into `unknownSectorValue`; drives the gate |
| **Not applicable** | broad/debt/hybrid funds, index ETFs, G-Sec, SGB, commodity ETFs, REIT, InvIT, bonds with unresolved issuer | **excluded entirely**; never pooled into unknown |

**Sectorable population:** `sectorable = resolved ∪ unknown`.

```
unknownRatio = unknownSectorValue / sectorableValue
if (unknownRatio > C3_UNKNOWN_KILL)   →  C3 and C4 both NOT EVALUABLE
```

**Note the semantic change from v1:** v1's gate measured unknown-sector as a share of the **whole book** — correct when every holding was a stock. In a multi-asset book that would make a 90%-gilt portfolio "sector not evaluable" when in truth sector simply *does not apply* to most of it. The gate now runs over the **sectorable population only**. This is a deliberate change; do not port the old semantics.

**The fund arm** (`category` says sectoral → matcher says which): the AMFI `category` is authoritative and 100% populated (62 distinct values; `Open Ended Schemes(Equity Scheme - Sectoral/ Thematic)` = 1,449 rows). The matcher is the gated prerequisite — §14.

---

## 8 · GROSS AND NET

Two stages that answer different questions. **This is staging, not new maths** — no rule is computed twice.

```
Gross = max(0, 100 − C1 − C2)                        // entity-level physics: how your money is spread
Net   = max(0, Gross − C3 − C4 − C5 − C6)            // named defects: each with a story
Construction = Net
```

**Why it earns its place** — the gap *is* the storyboard's spine:

| Book | Gross | Net | What the gap says |
|---|---|---|---|
| Fund-only beginner | **100** | **76** | Spread is fine. One AMC holds 60% of you. |
| Your 5-stock book | **76** | **76** | No defects at all. The score *is* the natural thinness of five names. |
| Pharma overlap | **89** | **61** | Spread is decent. Your theme is not. |

A flat list reports 76 / 76 / 61 and hides that the first user's problem is entirely a **defect**, the second's is entirely **spread**, and they need opposite explanations.

**Construction = Net.** Gross is never displayed as a competing score — it is a decomposition, persisted for the storyboard.

---

## 9 · BANDS, PROVISIONAL, DISPLAY

### 9.1 Bands

The v1 cutoffs were set when S1 fired on nearly every book. With the range opened from [55,100] to [~20,100], they must be recut. **Move `constructionBandOf` out of `portfolio-snapshot-controller.ts` into `constants.ts`** — a scoring constant does not belong in a presentation controller.

| Band | Range |
|---|---|
| **Well-built** | 85–100 |
| **Solid** | 70–84 |
| **Concentrated** | 55–69 |
| **Lopsided** | 40–54 |
| **Precarious** | 0–39 |

**Bottom band renamed** `Fragile` → **`Precarious`**. `Fragile` is also a **Health** band; showing "Health: Fragile · Construction: Fragile" as answers to two different questions is a genuine ambiguity. One collision removed.

### 9.2 Zero-evaluability

If **no rule has a subject**, Construction = 100 and the ledger states which rules were skipped. This is honest, not a bug — the archetype label carries the rest.

**But note what a 100% single index fund actually scores: 75 · Solid, not 100.** C1–C4 have no subject (no name risk, no sector we can see), but **C5 does have a subject** — one fund is one fund house holding **100%** of the book → `1.2 × (100−40) = 72` → capped **−25**. That is correct and deliberate: single-AMC concentration is a real, demonstrated risk in India (the 2020 debt-scheme freezes), and the assets being in a trust does not make an operational or redemption event impossible. A single index fund is a genuinely sound portfolio with exactly one real caveat, and **75 · Solid** says precisely that.

Genuine zero-evaluability is therefore rare: a single-holding basket book whose fund house cannot be resolved, or a spread of baskets across many houses with none over 40%.

### 9.3 Provisional

```
provisionalConstruction = unvaluedShare > CONSTRUCTION_PROVISIONAL_ABOVE     // 0.25
```

When true, Construction renders with a **Provisional** tag and the line *"₹X of your book could not be valued and is not reflected here."* Never a cap, never a penalty — a scope statement, exactly like Health's coverage line.

### 9.4 Display contract (binding)

- Construction and Health are **co-heroes**, always shown together. **Never summed, never averaged.**
- Construction carries its **archetype**: **"Stock-led"** · **"Fund-led"** · **"Blended"** · **"Income-led"** · **"Commodity-led"** — derived from composition shares. Purely descriptive, never good/bad, never compared to another user.
- Health carries its coverage line: **"covers 5 of 14 holdings · 10% of value."**
- The **evaluability panel is mandatory** — what we measured and what we could not. It is not a caveat; it is the differentiator, and it exists only because rules have subjects.

**RETIRED — `Starter` / `Building` / `Established` must not be rendered as a user-facing label.** Two reasons, and the second is the real one:

1. `structureTierOf()` reads **holding count alone**, so ₹50L across 3 names returns "Starter" — plainly wrong.
2. **The vocabulary labels the investor, not the book.** "Starter" claims something about the *person* from a number that only describes the *portfolio*. We do not know whether they are new, and we never will. It is also redundant: a 3-holding ₹50L book already reads **"Construction 65 · Concentrated · Stock-led"** — breadth is the band's job, composition is the archetype's job, and neither judges anyone.

`holdingCount` and `capitalTier` remain on the payload as **copy inputs only** — they legitimately shape a finding's register (*"at 3 holdings your book moves closely with each name"*; *"10 positions averaging ₹5,000 — trading costs are a near-fixed floor per trade"*). They are never badges.

### 9.5 The archetype IS the template — publish it

The "different rules for different investors" outcome is **already what this engine does** — via subjects, not switches:

| Book | Rules that fire | Rules with no subject |
|---|---|---|
| **Stock-led** | C1, C2, C3, C4, C6 | C5 (no baskets) |
| **Fund-led** | C5, C6 | C1, C2, C3, C4 (no name risk) |
| **Blended** | all six, each scaled by its sleeve | — |

**Name it on the screen.** The evaluability panel should read: *"We judged this as a **Stock-led** book. Applied: entity concentration, breadth, sector. Not applicable: fund-house concentration — you hold no funds."* That is the template, made visible.

**Why subjects and not a switch — the concrete reason, on the record.** Suppose stock-only used `C2_TARGET 8` and blended used `5`. A 5-stock book scores **76**. Buy **₹100** of any mutual fund → now "blended" → **97**. ₹100 moves the score 21 points while the book is unchanged. That is a cliff: gameable, and it makes two users' scores incomparable. Sleeve-scaling is the continuous form of the identical intent — that ₹100 moves `nameRiskShare` from 1.00 to 0.9999 and Construction from 76.10 to 76.09. **Same reading of the book, no cliff.**

**And on record: v1 was never "great for stock-only."** Live v1 scores a **100% single-stock portfolio at 80 · Solid**; one, two, and three-stock books all score exactly 80. The compression was invisible only because we only ever tested 5-stock books. C1–C6 *is* the stock template, repaired.

**The honest limit of templates:** a fund-led book fires only two rules, and that read is thin. Templates cannot fix that — **they only move the bar; they do not add information.** The fund-led read is thin because we cannot see inside a fund, not because our thresholds are wrong for fund investors. The only thing that fixes it is **look-through** (§14).

---

## 10 · WORKED EXAMPLES — ASSERT THESE

### A · Fund-only beginner — ₹1.2L
UTI Nifty 50 Index 40% · HDFC Large Cap 25% · HDFC Flexi Cap 20% · HDFC Balanced Advantage 15%

- Nature: all baskets. `nameRiskShare = 0` → **C1, C2 not evaluable.** `sectoredShare = 0` → **C3, C4 not evaluable.**
- **Gross = 100**
- C5: HDFC = 25+20+15 = **60%** → `1.2 × (60−40) = 24`
- C6: 4 < 25 → 0
- **Net = 76 → Construction 76 · Solid · Fund-led**
- Health: unavailable (no scored holdings) → construction-only read.

### B · The 5-stock book — ₹9L
Cummins 30% (84) · TCS 23% (71) · Reliance 19.1% (55) · M&M 17.6% (69) · HDFC 9% (68)

- N=5 → fairShare 20% → **threshold 30%**. Cummins at 30%, not above → **C1 = 0**
- C2: sleeve 1.00, Σw² = 0.09+0.0529+0.0365+0.031+0.0081 = 0.2185 → Neff **4.58** → `7 × (8−4.58) × 1.0 =` **−23.94**
- **Gross = 76.1**
- C3: 5 distinct sectors, max 30% < 40 → 0. C4: Neff_pos 4.58, target min(5, 4.58) = 4.58, Neff_sector 4.58 → **0** *(the anti-double-charge working)*. C5: no baskets → n/e. C6: 0
- **Net = 76.1 → Construction 76 · Solid · Stock-led**
- **Health 71 · Steady — covers 5 of 5 · 100% of value**

### C · Heavy blended — ₹52L
HDFC Bank 8 · ICICI 6 · SBI 4 · Nifty Bank ETF 12 · **NTPC stock 11 · NTPC bond 8** · Nifty 50 Index 18 · PPFCF 14 · SGB 8 · G-Sec 11

- **Entity aggregation: NTPC = 19%**, not 11%.
- Name-risk sleeve = 8+6+4+11+8 = **37%**. N = 10 → threshold `max(15, 15) = 15%`. NTPC 19% > 15 → `1.5 × 4 =` **C1 −6.0**
- C2: sleeve-internal weights (÷0.37) = .216/.162/.108/.514 *(NTPC)*; Σw² = .0467+.0263+.0117+.2642 = .3489 → Neff **2.87** → `7 × 5.13 × 0.37 =` **−13.3**
- **Gross = 80.7**
- C3: sectored = Financials 18% (8+6+4) + Energy 19% (NTPC stock + bond, via issuer) = **37% of book**; max sector 19% < 40 → **0**. *(Nifty Bank ETF is a **basket**, not sectored — see §14 note.)*
- C4: sectored **units** = HDFC .216 / ICICI .162 / SBI .108 / **NTPC .514** *(entity-aggregated)* → Neff_unit **2.87**; target min(5, 2.87) = 2.87; Neff_sector = `1/(.486²+.514²)` = **2.0** → `4 × 0.87 × 0.37 =` **−1.29**
- C5: three houses, each < 40% of book → 0. C6: 10 < 25 → 0
- **Net = 79.4 → Construction 79 · Solid · Blended**
- **Health 71 · Steady — covers 4 of 10 holdings · 29% of value**
- **The story:** they believe they hold 11% NTPC. They hold **19%**.

### D · Theme overlap — ₹8L
Pharma sectoral fund 30% · Sun Pharma 12 · Cipla 10 · Divis 8 · Nifty 50 Index 25 · Liquid fund 15

- Name-risk sleeve = **30%**. N=6 → threshold `max(15, 25) = 25%`. No name-risk entity > 25% → **C1 = 0**
- C2: sleeve-internal .40/.333/.267 → Σw² = .16+.111+.0711 = .342 → Neff **2.92** → `7 × 5.08 × 0.30 =` **−10.7**
- **Gross = 89.3**
- C3: sectored = pharma fund 30 + 12 + 10 + 8 = **60% Pharma** (whole-book denominator) → `1.2 × 20 =` **−24**
- C4: sectored-internal .50/.20/.167/.133 → Neff_pos **2.98**; target min(5, 2.98) = 2.98; Neff_sector **1.0** → `4 × 1.98 × 0.60 =` **−4.75**
- **Net = 60.6 → Construction 61 · Concentrated**
- **Health — covers 3 of 6 · 30% of value**
- Exactly the risk you described, caught with real data.

### E · Stress cases (assert)

| Book | Working | Construction |
|---|---|---|
| **100% one stock** | C1 n/f (threshold 150%); C2 `7×7×1.0 =` **−49**; **C3: 100% one sector** → `1.2×60=72` → cap **−30**; C4 target min(5,1)=1 = Neff_sector → 0 | **21 · Precarious** |
| **2 stocks 50/50, 2 sectors** | threshold 75%, n/f; C2 Neff 2 → **−42**; **C3: max sector 50%** → `1.2×10=` **−12**; C4 0 | **46 · Lopsided** |
| **3 stocks equal, 3 sectors** | threshold 50%, n/f; C2 Neff 3 → **−35**; C3 max sector 33.3% < 40 → 0; C4 target min(5,3)=3 = Neff_sector → 0 | **65 · Concentrated** |
| **8 stocks equal, 8 sectors** | Neff 8 → 0; every rule clear | **100 · Well-built** |
| **100% one index fund** | C1–C4 no subject; **C5: one house = 100%** → cap **−25** | **75 · Solid** |
| **100% gold ETF** | commodity ≠ entity → no name risk, no sector; **C5 fires** (one house 100%) → **−25** | **75 · Solid · Commodity-led** |

**Note the two rows that catch people out.** A single-stock book is *also* a single-**sector** book — **C3 fires alongside C2**, which is why it lands at **21**, not 51. And **any single-fund book carries 100% single-AMC exposure**, so C5 always fires: no one-fund portfolio can exceed **75**. Both are correct; both were missed in an earlier draft of this table.

**Invariants to assert:**
- Construction ≤ 100 always; ≥ 0 always.
- C1 = 0 for any equal-weighted book of any N.
- C4 = 0 for any book where every holding occupies a distinct sector.
- Adding a holding to a sleeve never *increases* that sleeve's Neff penalty.
- Two 50% entities cost more than one 100% entity **never** (monotonicity, post-total-cap).

---

## 11 · CONSTANTS — `portfolio-spec 2.0`

| Symbol | Meaning | Value |
|---|---|---|
| `C1_FLOOR` | entity dominance threshold floor | 15 |
| `C1_FAIR_MULT` | fair-share multiplier | 1.5 |
| `C1_RATE` | per pct-point over threshold | 1.5 |
| `C1_TOTAL_CAP` | **total** (not per-entity) | 30 |
| `C2_TARGET` | breadth target (Neff) | 8 |
| `C2_RATE` | **per unit of Neff short** | **7.0** |
| `C2_CAP` | — | **none** |
| `C3_THRESH` / `C3_RATE` / `C3_CAP` | sector dominance | 40 / 1.2 / 30 |
| `C3_UNKNOWN_KILL` | unknown ÷ sectorable → not evaluable | 0.50 |
| `C4_TARGET` / `C4_RATE` / `C4_CAP` | sector breadth | 5 / 4.0 / 15 |
| `C5_THRESH` / `C5_RATE` / `C5_CAP` | fund-house dominance | 40 / 1.2 / 25 |
| `C5_HOUSE_UNKNOWN_KILL` | unknown-house ÷ basketShare → not evaluable | 0.50 |
| `C6_THRESH` / `C6_RATE` / `C6_CAP` | monitorability | 25 / 0.5 / 8 |
| `CONSTRUCTION_PROVISIONAL_ABOVE` | unvalued share → Provisional | 0.25 |
| `BAND_WELL_BUILT` / `SOLID` / `CONCENTRATED` / `LOPSIDED` | band cutoffs | 85 / 70 / 55 / 40 |
| `CONSTANT_VERSION` | | `"portfolio-spec 2.0"` |

**`C2_RATE = 7.0` is the single most consequential constant in this model** — it decides what "thin" costs. v1's 4.0 (capped 20) made one, two, and three-stock books all score 80. 7.0 uncapped puts your 5-stock book at 76 instead of 86. Flagged explicitly for override; anything in [5, 8] is defensible.

---

## 12 · PERSISTENCE

**Extend `PortfolioHealthSnapshot`** — append-only, one per compute-event, single source for every surface.

New fields:
- `constructionGross`, `constructionNet` *(= Construction)*, `constructionBand`
- `nameRiskShare`, `basketShare`, `sectoredShare`, `unknownSectorRatio`, `houseUnknownShare`, `unvaluedShare`, `unvaluedValue`
- `neffEntity`, `neffPosSectored`, `neffSector`
- `entityLedger` — every aggregated entity: `entityKey`, `displayName`, `weight`, `constituentInstruments[]` *(this is what powers the NTPC story)*
- `constructionLedger` — per rule: `rule`, `state` (`fired` | `clear` | `not_evaluable`), `points`, `detail`, `subjectShare`
- `archetype` (published). `holdingCount` and `capitalTier` persist as COPY INPUTS ONLY — never rendered as badges (§9.4). `structureTier` is retired from the payload.
- `provisionalConstruction`

**Retire the dead v1.2 columns:** `phsRaw`, `ceilingApplied`, `ceilingValue` (written null/false since the ceiling was retired).

**Fingerprint** — add to the existing hash: the **entity-aggregated** weight vector, `asset_class` + `nature` per holding, sector-resolution outputs, `fund_house` per basket, `mcap_tier_snapshot` version, matcher version (§14), `CONSTANT_VERSION`. Unchanged fingerprint → skip the write.

**Recompute triggers** — existing set, plus: symbol-master refresh reclassifying tier or resolving a previously-unknown sector; **matcher version bump**; a newly-scored stock changing a bond's issuer resolution.

**Dry-run checkpoint** before any mass backfill.

---

## 13 · WHAT THIS DOES NOT TOUCH — THE HEALTH LAW

> **Health covers exactly what our stock engine can see. Construction is weight arithmetic, and every instrument has a weight.**

Health needs **knowledge**; Construction needs only **maths**. That is why Construction is universal *by construction*, not by concession — and why **every new instrument class enters through Construction and never touches Health.** Bonds, gold, REITs, international, crypto: the question *"how does this enter Health?"* is closed. It does not. It has no business our engine scores, so it is a weight, and weights are Construction's job.

**Unchanged, verbatim:** `Health = Quality − 0.20 × (100 − Signals)`. Quality over scored holdings, renormalized. Signals' deduction table, headline-wins, field-verdict lock. Health bands. The coverage line. No ceiling. `pillarProfile`, `lensProfile`.

**The one place contamination could sneak in:** C1 aggregates NTPC stock + NTPC bond into one 19% entity. That is **Construction arithmetic only**. Quality still weights scored holdings by their own `w_i`; the bond is not scored and contributes nothing. **Assert this in tests.**

**Out of scope, do not let it leak in:** the `severityToFinding` question (P-rules fire red/amber/green and never reach Signals; only critical/high/medium do). That touches Signals, Signals lives in Health, Health is frozen. **Separate ticket.**

---

## 14 · PREREQUISITE — THE FUND-SECTOR MATCHER

**C3/C4's fund arm is gated on this. Everything else in this spec is buildable today.**

**What exists:** `SECTOR_ALLOWLIST` — 15 hardcoded regexes in `mf-benchmark.ts:136-156`, mapping fund **name** → **Nifty index name** (e.g. `/\bpharma\b|\bhealthcare\b/i` → `"Nifty Pharma"`). Imported only by `mf-analytics.ts` and a verify script. **Grep across `src/portfolio/` returns nothing — the portfolio path cannot reach it.** And `benchmark_via = 'sector'` covers only **511 rows** against 1,449 Sectoral/Thematic funds.

**Two gaps:** it is unreachable, and it targets Nifty index names, not our `Sector` table.

**What to build:**
1. **Lift the matcher out of the ingestion job into a shared, portfolio-readable module.** It must never live inside a fold job again — that is exactly how it became unreachable.
2. **Make it a versioned data artifact, not code.** An audited table with a `matcherVersion`, not regexes buried in a source file.
3. **Add the 15-row → `Sector` map.** Target our sector names directly, not via Nifty index.
4. **Run a coverage audit over all 17,567 funds.** The universe is finite. Report: of funds whose `category` says sectoral, what share does the matcher resolve? **Publish that number.** Until it is known, the fund arm is unratified.

**Why it degrades safely regardless:** `category` (AMFI-authoritative, 100% populated) tells us a fund **is** sectoral. The matcher tells us **which**. **No match → sector `unknown` → pools into `unknownSectorValue` → the §7 gate handles it.** A rule that catches your pharma fund and misses your neighbour's would be inconsistent penalty — worse than no rule. This design goes quiet honestly instead.

**Until the audit ships:** C3/C4 run on **stocks + resolved bond issuers only**. Thematic funds contribute `not_applicable`, not `unknown` — do **not** let unshipped work create a false gate.

**Note on Example C:** a Nifty Bank ETF is a **basket** and contributes **no** sector weight. That is honest under this spec — but it is a real blind spot, and it is precisely what the matcher (extended to index ETFs) would close. Name it in the storyboard's evaluability panel; do not paper over it.

---

## 15 · DEPRECATION MAP — READ BEFORE BUILDING

**DEAD — delete, do not port:**
- **S1–S5** in their entirety → replaced by C1–C6.
- **Exposure decomposition** (declaring "a large-cap fund = 20 exposure units") — **never built, never build it.** A fabricated constant would have been the heaviest lifter in the score. Sleeve-scaled breadth (C2) reaches the same right answers with zero invented numbers.
- **The coverage ceiling** — already retired in code (`constants.ts:61-64`). Its dead columns go too (§12).
- **`stocks.market_cap_category`** — 0 populated, never used. Tier comes from `market_cap_tier_snapshot.tier` (large 100 / mid 150 / small 252 / **unknown 2**). **Unknown tier → `recognized`, never `small_unscored`.** Same principle as Tata Motors: never penalize our own gap.
- **v1's whole-book unknown-sector gate semantics** → §7.
- **`structureTier` / `structureTierOf()` and the `Starter`/`Building`/`Established` vocabulary** → retired from the payload and from every surface. Reasons in §9.4. `holdingCount` carries the copy.
- **The "44.8% stale NAV" claim** — **false**. Zero active funds have a NAV older than 30 days. The real signal is dormancy: **5,934 of 17,567 funds inactive.** Doc 2 territory.

**ALIVE — do not touch:**
- Health, in full (§13).
- The relative-threshold *idiom* (survives inside C1, and is reused by C4).
- The two-read split, `headlineSlot`, co-hero rendering, coverage line.
- `capitalTier` and `holdingCount` — **as copy inputs only**, never as user-facing badges (§9.4).
- Part B portfolio findings (`patterns.ts`, all six families) — Doc 2 **extends**, not replaces.
- `capitalTier` and `holdingCount` — but as copy inputs only, never as user-facing badges (§9.4).
- Persistence discipline: append-only, fingerprint-skip, dry-run before backfill.

---

*End of specification. Build stage 0 first — the population fix is the live defect. Everything else follows. All constants `portfolio-spec 2.0`: declared, not derived; calibrate on real portfolio distributions post-launch via a clean version bump.*
