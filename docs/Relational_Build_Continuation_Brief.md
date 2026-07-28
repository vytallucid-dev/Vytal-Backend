# Relational Overview — Build Complete (Phases 0–10)

**All ten phases are complete and verified.** This document is the final state of the build.

| Gate | Status |
|---|---|
| `tsc --noEmit` | **clean** |
| `src/scripts/verify-relational-matrix.ts` | **64 passed, 0 failed** (new — the fixture matrix) |
| `src/scripts/verify-relational.ts` | **51 passed, 0 failed** |
| `src/scripts/familyN-findings-proof.ts` | **83 passed, 0 failed** |
| Live 40-cell census | **0 assertion violations, 0 register-guard violations** |
| Git | **nothing staged, nothing committed** — working tree only |
| Migration | **written, NOT applied** — see §4 |

---

## 1 · What remains for a human

### ⚠ The migration + backfill rescore — ONE operation. DESTRUCTIVE. Not run.

```
prisma/migrations/20260728140000_add_snapshot_not_evaluable/migration.sql
ALTER TABLE "score_snapshots" ADD COLUMN "not_evaluable" JSONB;
```

Nullable, no default, no backfill. **`NULL` ≠ `[]` and the distinction must never be normalised**
(null = "we don't know what declined"; `[]` = "everything was evaluable").

**The sequence, to be run as one operation:**

1. **Apply the migration.** Until then `object-state.ts` degrades the column read to `null` and coverage
   reports `scored_unknown_depth`. Nothing breaks; UG9 stays silent, correctly.
2. **Rescore all persisted books.** This single operation delivers two outcomes:
   - **Five Family N findings** that satisfy their triggers today and are not persisted, because the
     in-force snapshots predate the rules' deployment:
     `ownership_N5_dual_institutional_build` on **ICICIBANK, INDUSINDBK, TORNTPHARM, NHPC**, and
     `foundation_N1_cash_backed_earnings` on **POWERINDIA**.
   - **`not_evaluable` populated** for every snapshot, moving coverage from `scored_unknown_depth` to
     `scored_full`/`scored_partial`, and **activating UG9** — the most visible thing the rescore turns
     on. UO3's qualified variants become reachable at the same time.

**Verification after the rescore:** run `verify-relational-matrix.ts` (should stay 64/64 — it is
synthetic and unaffected), then re-run a live census and confirm UG9 fires and UD1 becomes exercisable
against real stale generations.

### The nightly job needs scheduling

`base_rates_warm` is registered (`jobs/types.ts`, `jobs/dispatcher.ts`) but is not on a cron. It is
**safe to skip** — a cold start computes on demand — so this is an optimisation, not a blocker.

### One deferred decision, by eye test

**Business leads are long.** The complete first sentence is used, never truncated (a 220-char budget
silently rejected 40 of 224 hand-authored rows, including RELIANCE, HDFCBANK and TCS). If they read
heavy on the live card, the fix is a **nullable short-lead column on `stock_overviews`**, authored
lazily, falling back to the full sentence — the same second-field pattern as `plainClaim`. **Do not
author 224 short leads.** Decide by looking at the rendered card, not in the abstract.

---

## 2 · What was built

**Ten families/namespaces now resolve:** UO (orientation) · UH (holding) · **UW (watchlist — new
namespace)** · UN (neighbourhood) · UD (delta) · UE (echo) · UG (gap) · ELEVATED · plus the derived
coverage and base-rate substrates.

**Modes: 3 → 10 render.** M1, M2, M3, M4, M5–M8, M9, M10, M11, M12 all resolve as themselves. Only the
watchlist-delta cells share a shape. Every fold that crossed a position axis has been removed — that
class of fold was the source of two live falsehoods.

### Census: first measurement → final

| Metric | Baseline | Final |
|---|---|---|
| **Positive** reader facts | 0 | **34 (18.0% of lines)** |
| **Null** reader facts (UO4/UN8/UE5) | 28 | **5 (2.6%)** |
| Modes rendered | 3 | **7 of 12 live** (10 implemented) |
| Distinct rendered lines | 51 | **63** |
| Distinct templates in use | 44 | **57** |
| Assertion violations | 2 falsehoods | **0** |
| Spec assertions ever run | **0** | **64** |

**Resolved vs delivered** (the honest pair — an entry that always overflows is not delivered):

```
ELEVATED  100 → 28    UO1  40 → 33    UO2  32 → 25    UO3  32 →  7
UG5        20 →  7    UO4  14 →  5    UE5  14 →  0    UN1  12 → 11
UO6         8 →  2    UG1   8 →  8    UN8   7 →  0    UH1   7 →  7
UH3         6 →  6    UN2   4 →  1    UN6   4 →  0    UE1   3 →  0
UE6         3 →  0    UN3   3 →  1    UN7   2 →  2    UH4   2 →  0
UW1         5 →  5    UD3   1 →  1
```

UE1/UE6 show `→ 0` **by design after the annotation correction**: echo no longer competes for a slot,
it merges into its host entry, so its delivery is counted in the host's line. UN8/UE5 are null facts
that correctly yield.

**Byte-identical across readers** (*if two readers see the same card, it is not an overview*):
GLENMARK 2 distinct of 4 · ASHOKLEY 3 of 4 · **HDFCBANK 4 of 4**.

---

## 3 · Files

**Backend — new (8)**
```
prisma/migrations/20260728140000_add_snapshot_not_evaluable/migration.sql   ← NOT APPLIED
src/relational/coverage.ts               derived coverage, capability map, reason phrases
src/relational/base-rates.ts             in-memory universe base rates (no table)
src/relational/plain-claims.ts           the card's register for elevated findings
src/scoring/read/holdings-in-peer-group.ts
src/jobs/handlers/base-rates-warm.handler.ts
src/scripts/verify-relational-matrix.ts  the fixture matrix — 64 spec-derived assertions
docs/Vytal_Family_N_Amendment_v1.md      ⚠ cited 16+ times, previously absent from the repo
```

**Backend — modified (30)**
```
prisma/schema.prisma
src/relational/{arbitration,constants,copy,entries,mode,object-state,reader-context,service,types}.ts
src/scoring/composite/{persist,score-pass}.ts
src/scoring/findings/{engine,types}.ts
src/scoring/findings/rules/{b-deterioration,d-recovery,f1-composition,p11-margin-compression,
  p12-margin-recovery,p7-accruals,p8-receivables,r3-earnings-quality,r4-debt-explosion,
  r5-interest-coverage}.ts
src/scoring/ownership/primary.ts
src/jobs/{types,dispatcher}.ts
src/scripts/{dump-relational-payloads,verify-relational}.ts
docs/Vytal_Relational_Overview_Pattern_Library_v1.md   (+291 lines: Part XIV amendments)
```

**Frontend — modified (2). This is the complete frontend surface touched by this build.**
```
types/relational.ts                                     added "UW" to RelationalFamily
components/stock-detail/overview/section-relational.tsx isReaderFact → UH || UW || UO4
```
Without the second, UW1 renders with the wrong (object-fact) marker. **A frontend prompt can be written
against exactly this state.**

### For the frontend prompt — what changed in the payload

- `family` gains `"UW"`. Reader-side like UH; a separate family because UH's boundary language is
  exposure-based and watchlisting is not exposure.
- `mode` can now be any of M1–M12, not just M1/M3/M9.
- `arithmetic` on echo-annotated entries gains `firedInBook`, `scoredHoldingsCount`, `firedInUniverse`,
  `universeCount`, `expectedShare`, `lift`, `asOfDate`.
- `arithmetic` carries two internal keys prefixed `__` (`__echoKey`, `__arithmeticOnlyClaim`,
  `__hostKey`). **These are merge plumbing and must never be rendered.**
- `isNewSinceLastLook` is now genuinely set by UD1 — the "New" pill becomes reachable.
- `standingSince` may be `null` on UO6 (an undated positive finding still renders).

---

## 4 · Degradations currently declared

⚠ **A degradation that no longer applies is itself a false statement about coverage.** Retire each as
its blocker clears.

| Prerequisite | Status |
|---|---|
| `standing_since` | Survives — UO6 uses the rule's own evidence run length instead |
| `evaluability_backfill` | **Clears with the rescore** (§1) |
| `polarity` | Survives — published on Family N only |
| `unified_events_and_staleness` | Survives — UD5/UD6 out of scope |
| `fund_look_through` | Survives — UH5 impossible; **UG5 now states the limit on the card** |
| `position_delta` | Survives, **narrowed** — UH7/UH8 need the *transaction*-delta path; snapshot-delta (UD1/UD3) is built |
| `pg_native_findings` | Survives — no PG-level findings exist (UN4) |
| `pond_mask` | Survives — UN5 is a computation, not a read |
| `provisional_coverage_flag` · `price_freshness` · `unresolved_holdings_detail` · `refresh_cadence` | Survive — UG2/UG3/UG4/UG10, each a named missing input |
| `universe_base_rates` | **Runtime only** — raised solely when the aggregate fails for a reader with a book |

**Retired during the build:** `evaluability` (Phase 2) · `watchlist_modes` (Phase 1.2) ·
`delta_family` (Phase 7) · `per_holding_fired_sets` (Phase 6).

---

## 5 · The spec corrections

**All 24 are written into the library as Part XIV** (`Vytal_Relational_Overview_Pattern_Library_v1.md`,
lines 1408–1698), grouped: falsehoods · arbitration · echo · one-claim-one-owner · data model · copy ·
unbuilt entries · verification. The original text is left intact above them so both readings stay
auditable.

**The three that matter most, if only three are read:**

1. **The floor is a rank statement, not an inclusion mechanic** (B1). Rung was written as one global
   ordering; relevance is reader-dependent. Orientation is rung 14 for a reader with context and the
   *most* relevant thing for a stranger — one ladder cannot say both.
2. **Echo excludes CLOCK_EVENTs and never fires positive** (C1, C3). The first is the horoscope failure
   mode wearing a low base rate; the second is a selection verdict that neither half commits alone.
3. **An assertion written against observed behaviour defends bugs** (H). Two in the original harness
   actively protected the M1 falsehood for as long as it existed.

---

## 6 · Working method that held up

- **Every falsehood in this build was found by rendering real cards, never by a passing test.** The
  test suite was green throughout the period it was defending a lie.
- **A silent fallback is a silent defect.** Any threshold that can reject real data must be measured
  against the actual distribution before it ships — a 220-char budget chosen by intuition discarded 40
  of 224 hand-authored rows.
- **Check the blast radius, not the reported symptom.** The zero-quantity bug had two children; only
  one was reported.
- **When a fix reveals a second contradiction, fix it in the same pass.**
- **Throwaway diagnostics live in `src/scripts/_*.ts`, are SELECT-only, and are deleted in the same
  session.** (Scratchpad scripts cannot resolve the backend module graph.)
- **Read every session, in full:** this brief · library §0 (Foundations) · library Part IX (Boundary).
  Then only the phase's own sections. §0 and Part IX govern every family and are short; they are the
  sections whose absence lets a boundary violation ship.
