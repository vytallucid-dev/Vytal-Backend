# Vytal — Family N Amendment (Notable) · v1.0

**Status:** Definitional. Amends the Sections 2 & 5 Rules Spec and the Findings Map.
**Companion artifacts:** the Rules Spec (the R/P/B–I firing engine this extends), the Findings Map (the
Label/Signal/Read/Tool/Doesn't-mean vocabulary), the Relational Overview Pattern Library (the largest
consumer of `polarity` and `temporalClass`).

> **⚠ WHY THIS FILE EXISTS.** This amendment is cited by name in **sixteen or more code locations** —
> `scoring/findings/engine.ts`, `scoring/findings/types.ts`, all seven `rules/n*.ts` files,
> `relational/constants.ts`, and two proof scripts — and **did not exist in the repository.** Every
> builder to date has worked from a pasted copy. This is that document, reconstructed from the
> implementation it governs and verified against it (`familyN-findings-proof.ts`, 83 assertions).

---

## §1 · What Family N is, and the evaluability contract

**Family N (Notable) is the set of CONSTRUCTIVE TWINS** — seven rules, each the positive mirror of an
existing negative rule:

| N | Name | Mirrors |
|---|---|---|
| N1 | Cash-Backed Earnings | P7 Accruals Divergence |
| N2 | Working Capital Discipline | P8 Capital Tied in Receivables |
| N3 | Deleveraging | R4 Debt Explosion |
| N4 | Coverage Strengthening | R5 Interest Coverage Collapse |
| N5 | Dual Institutional Build | P4 Dual Institutional Exit |
| N6 | Promoter Accumulation | R2 Promoter Exit |
| N7 | Pledge Release | R1 Pledging Crisis |

**Display-only, without exception.** Every N rule carries `severity: "green"`, `direction: "positive"`,
`polarity: "positive"`, `temporalClass: "CONDITION"`, and **`magnitude: null` set EXPLICITLY**. Family N
moves no score. The locked invariant it respects: *P and R may affect the health score; every other
family is display-only.*

### §1.1 · Polarity is a RULE property, published at fire time

A rule has a polarity **even when it does not fire**, and a rule may fire with a `null` direction yet
still be `neutral` polarity (F2's mix-shift is the standing example). `polarity` is therefore distinct
from a fired instance's `direction`, and Family N sets it explicitly.

**It is not persisted.** `ScorePattern` has no polarity column and needs none: the `_N\d+_` key
namespace carries the fact, so any consumer can derive polarity from the key without a migration.

### §1.2 · The evaluability contract — three outcomes, not two

**This is the amendment's most load-bearing change.** A fire-rule speaks three distinct facts:

| Return | Meaning |
|---|---|
| a `FiredFinding` | **FIRED** — we checked and the pattern is TRUE |
| `null` | **NOT_FIRED** — we checked and the pattern is FALSE |
| a `NotEvaluable` | **NOT_EVALUABLE** — we COULD NOT check (missing history, feed, or disclosure) |

> **`not_fired` and `not_evaluable` are different facts.** A rule must never return a bare `null` where
> the honest answer is "we could not evaluate this" — that collapses *false* into *unknown*, and every
> downstream honest-empty claim depends on keeping them apart.

**Why the shape is `{status, reason}` and not a boolean:** `not_fired` carries no payload, so a bare
`null` expresses it losslessly and forever. Only the not-evaluable arm needed a richer shape. The
eventual engine-wide migration therefore reshapes nothing — it only points more rules' unevaluable
branches at `notEvaluable(reason)` and extends the reason union.

**Reason tokens are STABLE MACHINE TOKENS, never free strings** — a closed union, so downstream can
switch exhaustively. Family N uses eight: `insufficient_annual_history` · `insufficient_quarters` ·
`insufficient_shareholding_history` · `negative_equity` · `no_debt` · `class_not_disclosed` ·
`share_count_unavailable` · `pledging_not_disclosed`.

**A scope exclusion is NOT a decline.** A rule that does not apply to an industry (R3/R5/N1–N4 on a
bank) returns `null` — "does not apply" is a genuine not-fired. Only a data gap declines.

---

## §2 · Temporal class

### §2.4 · CONDITION vs EVENT

| Class | Meaning |
|---|---|
| `CONDITION` | A standing fact about the COMPANY that does not age out on a clock. **All of Family N.** |
| `EVENT` | A dated occurrence, meaningful only inside a declared window. |

This is a **semantic marker only**. It implies no dependency on `standing_since` (§4): a CONDITION rule
still counts its own run length from the underlying data at fire time.

> **⚠ Cited as "Amendment §2.4" at `relational/constants.ts:28`.** That citation refers to this section
> — specifically to the duration-source precedence in §4, which is why a self-dating Family N finding
> clears its own minimum without waiting on a `standing_since` derivation.

---

## §3 · Required evidence keys

Every N rule writes the keys its copy needs, so the verdict sentence is reconstructable from evidence
alone and no consumer re-derives a number:

| Rule | Required keys |
|---|---|
| N1 | `years`, `fromPeriod`, `toPeriod`, `series[]` |
| N2 | `revenueGrowthPct`, `receivablesGrowthPct`, `gapPp` |
| N3 | `years`, `deFrom`, `deTo` |
| N4 | `quarters`, `troughCoverage`, `latestCoverage` |
| N5 | `fiiDeltaPp`, `diiDeltaPp`, `period` |
| N6 | `quarters`, `cumulativePp` |
| N7 | `pledgeFromPct`, `pledgeToPct` |

All carry `family: "N"`, `pattern`, `name`, and an authored `verdict`.

---

## §4 · Duration-source precedence

> **A finding's OWN run length, measured from the underlying data by the rule itself, WINS over
> `standing_since` — permanently, and not as a fallback.**

"Profit has converted to cash for four straight years" is a fact about the **company**. "We have been
showing this for two quarters" is a fact about our **pipeline**. `standing_since` is the correct source
only for findings whose triggers are point-in-time and therefore cannot self-date — a divergence gap, a
band position, a zone crossing.

**Consequence:** any self-dating finding resolves its duration without the `standing_since` derivation
existing at all. This is why the Relational Overview's `UO6` is reachable today.

---

## §5 · The seven triggers

**N1 · Cash-Backed Earnings.** OCF / netProfit ≥ 1.0 for ≥3 consecutive annual periods, netProfit > 0
in each. Banking excluded. <3 annual rows ⇒ `not_evaluable{insufficient_annual_history}`. The annual
exceptional guard (shared with P7) suppresses on a distorted latest period — a distorted period is
`not_fired`, not unevaluable: the data is present and we CAN compute it; the guard rules the positive
claim unsafe.

**N2 · Working Capital Discipline.** Revenue growth exceeds receivables growth by ≥15pp — symmetric
with P8's threshold.

**N3 · Deleveraging.** D/E = (borrowingsCurrent + borrowingsNoncurrent) / netWorth, falling for ≥3
consecutive years. Net worth ≤ 0 ⇒ `not_evaluable{negative_equity}`, **never a pass**. R4 co-existence
is permitted: R4 is fire-once on first breach and never clears, so both may stand.

**N4 · Coverage Strengthening.** TTM coverage rising for ≥2 consecutive TTM windows **from a thin base**
(`trough < 3.0×`). Σinterest ≤ 0 ⇒ `not_evaluable{no_debt}`.

> **The low-base gate is load-bearing.** Without `trough < 3.0×`, a comfortable 40×→45× drift would
> fire as "strengthening", which is noise dressed as news.

**N5 · Dual Institutional Build.** Same quarter, FIIΔ ≥ +0.5pp AND DIIΔ ≥ +0.5pp. A null FII or DII
bucket ⇒ `not_evaluable{class_not_disclosed}`, never a pass — an undisclosed class is *unknown*, not
"did not build". **Anti-double-count:** if P1 (the more specific rotation read) fires on the same
quarter, P1 leads and N5 defers. With current thresholds these are mutually exclusive (P1's B1 requires
FII **down**), so the deferral never triggers today; it is implemented anyway so precedence stays
correct if either threshold changes.

**N6 · Promoter Accumulation.** Promoter **ABSOLUTE SHARE COUNT** rising for ≥2 consecutive quarters.

> **⚠ THE BUYBACK FIREWALL, MANDATORY.** Promoter *percentage* can rise purely because the company
> bought back shares — no promoter bought anything. N6 therefore reads the absolute count and never the
> percentage. A missing count ⇒ `not_evaluable{share_count_unavailable}`.

**N7 · Pledge Release.** Pledge ratio falling ≥10pp QoQ, **or** crossing below 50% from above. Pledge
column absent ⇒ `not_evaluable{pledging_not_disclosed}`. **Anti-double-count:** N7 fires only where R1
was NOT standing in the prior quarter — a fall that merely clears a standing R1 is R1's story ending,
not a new positive one.

---

## §6 · Registration

> **REGISTRATION IS MANDATORY — an unregistered rule never fires.** (The P2/P3 lesson: two rules were
> retired by consolidation, their files kept, and their absence from the registry is what makes them
> inert. A rule file that exists but is not registered is indistinguishable from a rule that does not
> exist.)

All seven live in `FAMILY_N_RULES` and are spread into `ALL_RULES` (`scoring/findings/engine.ts`).

**Every registered rule also carries a stable `ruleRef`** in `RULE_REFS` — the identity a declined check
is recorded against. An array index is not an identity: registry order changes.

---

## §7 · Verification

`src/scripts/familyN-findings-proof.ts` — pure fixture tests, no DB, **83 assertions**:

- every N entry returns `not_evaluable{reason}` (never a bare `null`) on short history
- each reason token is reachable and correct
- **N6 does not fire on a buyback** (% rose, count flat) — the firewall
- **N7 does not fire where a standing R1 cleared** — the Family-J known gap
- **N4 does not fire on a 40×→45× drift** — the low-base gate
- **N3 returns `not_evaluable{negative_equity}`** on negative net worth, never a pass
- **N5 defers to P1** when P1 leads the institutional read
- every N rule writes its §3 evidence keys and resolves `{n}` from its own evidence, with
  `standing_since` **absent** from the FiringContext
- all seven registered in `ALL_RULES`, all carrying `magnitude: null` + `polarity: positive` +
  `temporalClass: CONDITION` explicitly
- **N is purely additive** — every non-N finding is byte-identical with and without Family N

---

## §8 · Deployment note

A model change requires a **deploy-time backfill rescore of all persisted books.** Family N rules that
exist in source but were not in the running build when a snapshot was computed produce nothing for that
snapshot, and the absence is indistinguishable from "the pattern is not there".

**Measured at the time of writing:** five findings across the live universe satisfy their triggers and
are not persisted, because the in-force snapshots predate the rules' deployment —
`ownership_N5_dual_institutional_build` on ICICIBANK, INDUSINDBK, TORNTPHARM and NHPC, and
`foundation_N1_cash_backed_earnings` on POWERINDIA.
