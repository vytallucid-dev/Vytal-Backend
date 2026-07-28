# Runbook — migration + findings backfill

Run by hand. Nothing here has been executed.

---

## ⚠ STOP — the plan in the continuation brief is wrong

The brief (§1) says the migration + rescore is **"ONE operation"** and that the rescore delivers both
the Family N findings **and** `not_evaluable`. That is incorrect. Verified in code:

**`persistMember` returns early on skip-identical**, before the snapshot is created:

```
src/scoring/composite/score-pass.ts:569-571
  if (liveSnap && liveSnap.inputsFingerprint === fp) {
    return { ... action: "skipped_identical" ... };   ← returns HERE
  }
```

Everything that writes `not_evaluable` and findings is **below** that return
(`score-pass.ts:593` writes `notEvaluable`; `:607` writes findings).

**The fingerprint does not cover findings or `not_evaluable`** — only `stockId`, `periodKey`,
`snapshotType`, spec version, band-mapping version, `composite`, `redistributionReason`, and pillars
(`src/scoring/composite/persist.ts`, `snapshotInputsFingerprint`).

Family N is `magnitude: null` and moves no score. **So every fingerprint matches, every member skips,
and a rescore writes nothing at all.** `pg-rescore.handler.ts` goes further — its pre-check does not
even open a ScoringRun when nothing changed.

`commit-findings.ts` already says this in its own header:

> *WHY NOT persistMember: the snapshots already exist; persistMember would skip-identical (scores
> unchanged) and write nothing.*

There is **no force/bypass flag** — `persistMember` opts is `{ writeFindings?: boolean }` only, and
`PgRescorePayload` has no such field.

### Consequence

| Goal | Path | Status |
|---|---|---|
| Add the `not_evaluable` column | `prisma migrate deploy` | ✅ Part 1 |
| Persist the 5 Family N findings | `commit-findings.ts --commit` | ✅ Part 2 |
| **Populate `not_evaluable` values** | — | ❌ **No path exists. See Part 3.** |

**Do not run a rescore for this.** It will report success, write nothing, and leave `not_evaluable`
NULL. Parts 1 and 2 are safe and worth running today. Part 3 is a decision for you, not a step.

---

## Part 0 · Before

All commands run from `c:\AKJ\AKJ\vytal\vytal\Vytal-Backend`.

**0.1** Confirm the working directory and that the migration is present:

```powershell
cd c:\AKJ\AKJ\vytal\vytal\Vytal-Backend
type prisma\migrations\20260728140000_add_snapshot_not_evaluable\migration.sql
```

The only executable statement in that file is:

```sql
ALTER TABLE "score_snapshots" ADD COLUMN "not_evaluable" JSONB;
```

Nullable, no default, no backfill, no index. It cannot fail on existing data and takes no table
rewrite (Postgres adds a nullable column as a catalog-only change).

**0.2** Confirm which database you are pointed at. Prisma migrations use `DIRECT_URL`, not
`DATABASE_URL` — set in `prisma.config.ts`:

```powershell
node -e "require('dotenv').config();const u=new URL(process.env.DIRECT_URL);console.log('HOST:',u.hostname);console.log('DB  :',u.pathname);console.log('USER:',u.username)"
```

Read the host aloud before continuing. Password is not printed.

**0.3** Confirm exactly one migration is pending:

```powershell
npx prisma migrate status
```

Expect `20260728140000_add_snapshot_not_evaluable` listed as not-yet-applied, and nothing else.
**If more than one is pending, stop** — this runbook only covers that one.

**0.4** Backup. The migration is additive and reversible by hand (Part 5.1), but take one anyway:

```powershell
node -e "require('dotenv').config();console.log(process.env.DIRECT_URL)"
```

Feed that URL to:

```powershell
pg_dump "<DIRECT_URL>" -t score_snapshots -Fc -f score_snapshots_pre_notevaluable.dump
```

If `pg_dump` is not installed, the Supabase dashboard's PITR / daily backup is sufficient given the
migration is additive.

**0.5** Capture the score-integrity baseline. **This is the check that matters most** — run it now,
and again after Part 2, and compare the two digests.

```sql
SELECT count(*) AS snapshot_rows,
       md5(string_agg(id::text || ':' || composite::text || ':' || label_band::text || ':' || version::text,
                      '|' ORDER BY id)) AS score_digest
FROM score_snapshots;
```

And the row counts nothing in Part 2 should touch:

```sql
SELECT
  (SELECT count(*) FROM score_snapshots) AS snapshots,
  (SELECT count(*) FROM score_pillars)   AS pillars,
  (SELECT count(*) FROM score_metrics)   AS metrics,
  (SELECT count(*) FROM score_peer_stats) AS peer_stats,
  (SELECT count(*) FROM score_patterns)  AS patterns,
  (SELECT count(*) FROM score_red_flags) AS red_flags;
```

Write all seven numbers and the digest down on paper. Patterns and red_flags are the only two
expected to move.

**0.6** Confirm the build is clean before changing anything:

```powershell
npx tsc --noEmit
```

---

## Part 1 · Apply the migration

**1.1**

```powershell
npx prisma migrate deploy
```

**1.2** Expected output — the success signature is the words `1 migration` and `applied`:

```
Applying migration `20260728140000_add_snapshot_not_evaluable`

The following migration have been applied:

migrations/
  └─ 20260728140000_add_snapshot_not_evaluable/
    └─ migration.sql

All migrations have been successfully applied.
```

**1.3** Verify the column exists, is nullable, and is `jsonb`:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'score_snapshots' AND column_name = 'not_evaluable';
```

Expect exactly one row: `not_evaluable | jsonb | YES | NULL`.

**1.4** Confirm every existing row is NULL (not `[]`) — the distinction is load-bearing:

```sql
SELECT count(*) FILTER (WHERE not_evaluable IS NULL) AS is_null,
       count(*) FILTER (WHERE not_evaluable IS NOT NULL) AS is_set
FROM score_snapshots;
```

Expect `is_set = 0`. This is the correct post-migration state: NULL means *"we don't know what
declined"*, which is true. It must not be normalised to `[]`.

**1.5** Regenerate the client so `notEvaluable` is typed:

```powershell
npx prisma generate
npx tsc --noEmit
```

**1.6** What changes on the card after Part 1: **nothing.** `object-state.ts` reads the column, gets
NULL, and coverage reports `scored_unknown_depth` — the same as before. UG9 stays silent, correctly.
The column being present is a prerequisite, not an activation.

---

## Part 2 · Backfill the Family N findings

This is `commit-findings.ts`, **not** a rescore. It attaches findings to the existing head snapshots
via `persistFindings`. It creates no snapshot, mutates no snapshot, and touches no score.

**2.1 Dry run first. It writes nothing without `--commit`.**

```powershell
npx tsx src/scripts/commit-findings.ts
```

**2.2** Read the dry output before continuing. You are looking for the five known findings:

- `ownership_N5_dual_institutional_build` on **ICICIBANK, INDUSINDBK, TORNTPHARM, NHPC**
- `foundation_N1_cash_backed_earnings` on **POWERINDIA**

**Scope, exactly:** 13 peer groups hardcoded in the script (`PG1`–`PG6`, `PG8`–`PG14`; **PG7 is
absent from the list**), `snapshot_type = 'quarterly'` only, every `FY__Q_` period that has
snapshots. Live/`LIVE:` snapshots are not covered.

**Duration: measured on the live database — ~6 minutes** for the dry run and a comparable span for
the commit (92 (PG,period) passes across all 13 PGs, every historical quarter with snapshots). Its
transaction timeout is set to 240 s per period (`timeout: 240000`), which is the only hard bound in
the code; no period approached it.

**2.3** Commit:

```powershell
npx tsx src/scripts/commit-findings.ts --commit
```

**2.4 Interruptibility and idempotency.**

- **Safe to interrupt.** Each period commits in its own transaction. Ctrl-C between periods loses
  nothing already committed; Ctrl-C mid-period rolls that period back whole.
- **Safe to re-run.** `persistFindings` skips an existing `(snapshotId, key)` pair. A second full run
  writes 0 and reports them as `skippedExisting`.
- **Re-running is the recovery procedure.** There is no separate resume flag; just run it again.
- The R1 `high` → `critical` correction is also idempotent — after the first run no `high` rows
  remain, so a re-run corrects 0.

**2.5** Verify the findings landed:

```sql
SELECT p.pattern_key, s.symbol, COUNT(*) AS rows
FROM score_patterns p
JOIN score_snapshots ss ON ss.id = p.snapshot_id
JOIN stocks s ON s.id = ss.stock_id
WHERE p.pattern_key ~ '_N[1-7]_'
GROUP BY 1, 2 ORDER BY 1, 2;
```

⚠ Not `LIKE '%\_N%\_%'` — that also matches `lens_lm3_NII`/`NIM`/`NPyoy` (metric-lens findings, not
Family N). Use the `~ '_N[1-7]_'` regex.

Expect at minimum `ownership_N5_dual_institutional_build` for the four banks/pharma/power names and
`foundation_N1_cash_backed_earnings` for POWERINDIA. **Measured on the live database, this backfill
covers all historical quarters, not just the in-force snapshot** — actual result was broader: N1
(POWERINDIA), N4 (BHEL, JSWSTEEL, SAIL), N5 (BDL, CANBK, ICICIBANK, INDUSINDBK, NHPC, TORNTPHARM), N6
(JINDALSTEL). See §7 Execution Record for the full table.

**2.6 ⚠ The check that matters most — re-run 0.5 and compare.**

```sql
SELECT count(*) AS snapshot_rows,
       md5(string_agg(id::text || ':' || composite::text || ':' || label_band::text || ':' || version::text,
                      '|' ORDER BY id)) AS score_digest
FROM score_snapshots;
```

**`score_digest` and `snapshot_rows` must be byte-identical to the values you wrote down in 0.5.**
If the digest changed, a score, band, or version moved — stop and go to Part 5.3.

Then the row counts:

```sql
SELECT
  (SELECT count(*) FROM score_snapshots) AS snapshots,
  (SELECT count(*) FROM score_pillars)   AS pillars,
  (SELECT count(*) FROM score_metrics)   AS metrics,
  (SELECT count(*) FROM score_peer_stats) AS peer_stats,
  (SELECT count(*) FROM score_patterns)  AS patterns,
  (SELECT count(*) FROM score_red_flags) AS red_flags;
```

`snapshots`, `pillars`, `metrics`, `peer_stats` must be **unchanged**. Only `patterns` and
`red_flags` may rise. This is guaranteed by construction — `commit-findings.ts` calls only
`persistFindings` — but verify it rather than trust it.

**2.7** Independent confirmation that Family N moves no score (read-only, no writes):

```powershell
npx tsx src/scripts/familyN-no-score-moved.ts
```

This runs an in-process A/B with and without Family N on byte-identical data and asserts composite,
band, and all four pillar subtotals are identical. Expect **83 passed, 0 failed**.

---

## Part 3 · `not_evaluable` — blocked, no path exists

**Do not attempt this with a rescore.** Nothing in the codebase writes `not_evaluable` onto an
existing snapshot. The only writer is `toScoreSnapshotRow` (`persist.ts:117`), reached only when a
**new** snapshot row is created — which skip-identical prevents.

The three ways forward, in the order I'd weigh them:

1. **Leave it NULL. Ship Parts 1–2 and stop.** Coverage stays `scored_unknown_depth`, UG9 stays
   silent, and every claim on the card remains true. `scored_unknown_depth` is an *honest* state —
   it says "we don't know how deep the scoring went", which is exactly the case. Nothing is broken
   and no falsehood is rendered. This is the lowest-risk option and the column still pays off going
   forward: **every snapshot written from now on populates it automatically**, since new snapshots
   don't skip.

2. **Write a backfill script** that computes per member and issues
   `UPDATE score_snapshots SET not_evaluable = $1 WHERE id = $2` against head snapshots. Mechanically
   straightforward — `m.notEvaluable` is already populated at `score-pass.ts:390` under
   `withFindings: true`, and `commit-findings.ts` is a working template for the iteration.
   **But it mutates existing snapshot rows**, which the append-only chain has so far never done —
   `commit-findings.ts` deliberately avoided it ("snapshots are NOT mutated (chain-roots intact)").
   The counter-argument is that filling a column which did not exist when the row was written is a
   backfill, not a rewrite of history: it changes no score, band, or pillar. **That is a data-model
   call and it is yours, not mine.**

3. **Add a force flag** to `persistMember` that bypasses skip-identical, and rescore. This is the
   worst option — it creates a full v2 supersede chain for every stock purely to carry one new
   column, doubling `score_snapshots` and every pillar/metric row beneath it, and it *would* change
   the digest in 2.6.

My recommendation is **(1) now, (2) later if UG9 proves worth it** — and (2) only after you rule on
whether backfilling a new column onto an existing snapshot row is permitted.

---

## Part 4 · Verify after

**4.1** Build still clean:

```powershell
npx tsc --noEmit
```

**4.2** Synthetic matrix — must be unaffected by anything above:

```powershell
npx tsx src/scripts/verify-relational-matrix.ts
```

Expect **64 passed, 0 failed**.

**4.3** Resolver assertions:

```powershell
npx tsx src/scripts/verify-relational.ts
```

Expect **51 passed, 0 failed**.

**4.4** Family N fixture proof:

```powershell
npx tsx src/scripts/familyN-findings-proof.ts
```

Expect **83 passed, 0 failed**.

**4.5** Live census — the only check that can catch a card-level regression:

```powershell
npx tsx src/scripts/verify-relational-live-census.ts
```

⚠ **Not `dump-relational-payloads.ts`.** That script is a two-fixture payload dumper with no
violation counter and no live-data resolution — it does not do what earlier drafts of this runbook
claimed. `verify-relational-live-census.ts` is the real live census: it resolves the actual card
(`resolveRelationalState`) for every real `(reader, held stock)` pair in the database, plus an
anonymous resolve for each distinct stock, and counts register-guard violations from the warnings
`composeRelationalState` emits at runtime. Expect **`REGISTER_GUARD_VIOLATIONS=0`** (exit code 0).

Family N findings becoming persisted means UO6 has real material for the first time — check that the
orientation line reads correctly on POWERINDIA and ICICIBANK specifically (§6 below has one rendered).

**4.6** Coverage state — **expected to be unchanged** if you took Part 3 option (1):

```sql
SELECT count(*) FILTER (WHERE not_evaluable IS NULL) AS unknown_depth,
       count(*) FILTER (WHERE not_evaluable IS NOT NULL) AS known_depth
FROM score_snapshots;
```

With option (1), `known_depth = 0` and coverage correctly stays `scored_unknown_depth`. **UG9 will
not fire, and that is the correct outcome** — not a failure of this runbook. The brief's claim that
the rescore "activates UG9" is part of what was wrong; UG9 activates only under Part 3 option (2).

---

## Part 5 · If it goes wrong

**5.1 · `migrate deploy` fails partway (Part 1).**
The migration is a single `ALTER TABLE`. Postgres runs DDL transactionally — it either applied or it
did not; there is no partial state. Check:

```sql
SELECT migration_name, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
ORDER BY started_at DESC LIMIT 3;
```

- `finished_at` set, `rolled_back_at` NULL → applied. Continue.
- `rolled_back_at` set or `finished_at` NULL → not applied. Fix the cause (usually connectivity or
  privileges on `DIRECT_URL`), then re-run `npx prisma migrate deploy`.
- To undo entirely: `ALTER TABLE "score_snapshots" DROP COLUMN "not_evaluable";` then delete that
  row from `_prisma_migrations`. Safe — nothing reads the column except a degradation path that
  already handles its absence.

**5.2 · `commit-findings.ts --commit` dies partway (Part 2).**
Periods commit independently, so you have a partial but *consistent* backfill — some periods have
findings, others don't. No cleanup is needed. **Re-run the same command.** Already-written findings
are skipped by `(snapshotId, key)`; only the missing ones are written. Repeat until it completes.

If it dies with a transaction timeout, one period exceeded 240 s. Re-running will retry that period
from scratch; if it fails repeatedly, that PG/period is the thing to investigate, and the rest of the
backfill is unaffected and already durable.

**5.3 · The score digest changed in 2.6.**
This should be impossible via `commit-findings.ts`. Find what moved:

```sql
SELECT s.symbol, ss.period_key, ss.version, ss.composite, ss.label_band, ss.created_at
FROM score_snapshots ss JOIN stocks s ON s.id = ss.stock_id
WHERE ss.created_at > '<timestamp you started Part 2>'
ORDER BY ss.created_at DESC;
```

Any rows returned means new snapshots were created — something ran a real rescore, not this script.
Do not delete them by hand; the supersede chain has FK'd pillars, metrics, and findings beneath each.
Restore `score_snapshots` from the 0.4 dump, or stop and diagnose before writing anything further.

**5.4 · Findings appear on the wrong periods.**
`commit-findings.ts` scores historical quarters point-in-time and FY26Q4 live. If a finding shows up
on a quarter whose data postdates it, that is a PIT leak in the rule, not in this runbook — the
findings are removable without touching scores:

```sql
DELETE FROM score_patterns WHERE pattern_key ~ '_N[1-7]_';
```

⚠ Not `LIKE '%\_N%\_%'` — that also matches `lens_lm3_NII`/`NIM`/`NPyoy` (metric-lens findings whose
keys happen to contain a literal `N`), which are not Family N and must not be deleted.

Findings are leaf rows with nothing FK'd beneath them, so this is safe and fully re-runnable via 2.3.

**5.5 · Rollback of the whole exercise.**
Part 2 is undone by 5.4's `DELETE`. Part 1 is undone by 5.1's `DROP COLUMN`. In that order. Neither
touches a score, a band, a pillar, or a snapshot row.

---

## What is still not done after this runbook

- **`not_evaluable` values** — Part 3, **ruled out permanently** (see §7 below). Left NULL by design.
- **`base_rates_warm` cron** — registered, not scheduled. Safe to skip; cold start computes on demand
  (measured 981 ms cold, 0 ms warm).
- **Long business leads** — decide by eye on the rendered card, not in the abstract.
- **Nothing is committed to git.** Working tree only, per standing constraint.

---

## §7 · Execution record

Parts 0–2 and 4 were executed against the live database on this date. Part 3 was not executed — ruled
out permanently, see below.

**Target:** host `aws-1-ap-southeast-1.pooler.supabase.com`, database `postgres`, user
`postgres.kdfjmrtadctecyprwipo` (via `DIRECT_URL`).

**0.3** — exactly one migration pending (`20260728140000_add_snapshot_not_evaluable`). Confirmed
before proceeding.

**0.4 backup** — `pg_dump` is not installed on this machine. Fallback taken instead: a full raw-SQL
row dump of `score_snapshots` (3304 rows, JSON, all columns) via a throwaway script
(`src/scripts/_backup_score_snapshots.ts`, deleted after use per convention). Restore path if ever
needed: re-insert from the JSON dump: same columns, same PK.

**0.5 baseline:**

| snapshot_rows | score_digest | snapshots | pillars | metrics | peer_stats | patterns | red_flags |
|---|---|---|---|---|---|---|---|
| 3304 | `c54d471ffe04e1d208811f2176ebecdf` | 3304 | 4761 | 3836 | 6685 | 7694 | 151 |

**Part 1** — `prisma migrate deploy` applied cleanly. 1.3/1.4 verified:
`not_evaluable | jsonb | YES | NULL`; `is_null=3304, is_set=0`. `prisma generate` + `tsc --noEmit`
clean.

**Part 2 dry run** — 92 (PG,period) passes, 0 errors. Planned (dry-run counter, does not apply the
idempotency skip): `redFlags=16 patterns=1054` across ~427 snapshots.

**Part 2 commit** — `commit-findings.ts --commit`. Actual write (idempotency-skip applied,
`skip-existing=881`): **`redFlags=1 patterns=188`** across ~138 snapshots, 92 passes, 0 errors. The
dry-run plan and the actual write are not directly comparable — the dry counter does not exclude
already-existing `(snapshotId, key)` pairs, the commit does.

**2.6 gate — PASS.**

| Metric | 0.5 baseline | 2.6 post-commit | Δ |
|---|---|---|---|
| snapshot_rows | 3304 | 3304 | 0 |
| score_digest | `c54d471ffe04e1d208811f2176ebecdf` | `c54d471ffe04e1d208811f2176ebecdf` | **identical** |
| score_snapshots | 3304 | 3304 | 0 |
| score_pillars | 4761 | 4761 | 0 |
| score_metrics | 3836 | 3836 | 0 |
| score_peer_stats | 6685 | 6685 | 0 |
| score_patterns | 7694 | 7882 | +188 |
| score_red_flags | 151 | 152 | +1 |

No score, band, version, pillar, or metric row moved. Only patterns and red flags grew.

**Family N findings landed** (broader than the 5 originally cited — this covers all historical
quarters with snapshots, not just in-force):

| Rule | Symbols |
|---|---|
| N1 cash-backed earnings | POWERINDIA |
| N4 coverage strengthening | BHEL, JSWSTEEL, SAIL |
| N5 dual institutional build | BDL, CANBK, ICICIBANK, INDUSINDBK, NHPC, TORNTPHARM |
| N6 promoter accumulation | JINDALSTEL |

N2, N3, N7 did not fire on any symbol in this pass.

**Part 3 — ruled, permanently: option 1 (leave NULL).** `not_evaluable` on a snapshot asserts what
could not be checked AT THE TIME that snapshot was computed. A backfill script would compute it
against today's data — if history has grown since, the backfilled value understates what actually
declined. NULL is the true answer for those pre-migration rows; a computed value would be a
fabricated historical claim. **No backfill script exists and none is to be built, now or later.** New
snapshots populate the column correctly going forward (`score-pass.ts:390,593`), and UG9 activates
progressively as stocks refresh naturally — not from this runbook.

**Part 4 — all five checks:**

| Check | Result |
|---|---|
| 4.1 `tsc --noEmit` | clean |
| 4.2 `verify-relational-matrix.ts` | 64 passed, 0 failed |
| 4.3 `verify-relational.ts` | 51 passed, 0 failed |
| 4.4 `familyN-findings-proof.ts` | 83 passed, 0 failed |
| 4.5 live census | **initially 7 register-guard violations — see below** |

**4.5 finding, fixed in this pass:** the register guard's base `FORWARD_DENY_LIST` (bare `\bsell\b`,
`\bdiversif(y…)\b`) false-positived on operational business-lead copy — "NTPC… **selling** electricity",
"ITC… **diversified** conglomerate" — pre-existing catalog strings untouched by Parts 1–2. Ruled: the
guard was over-broad, the copy was correct. Fix applied: `src/relational/copy.ts` now carries a
narrower `BUSINESS_LEAD_DENY_LIST` (second-person instruction / explicit recommendation constructions
only — `you should`, `worth buying`, `attractive`, `undervalued`, `overvalued`, `recommend`,
`target price`, `time to buy/sell`, `consider buying/selling`) scoped to the UO1 entry only (the sole
carrier of business-lead prose); every other entry (findings, other UO/UH/UN/UD/UE/UG entries,
boundary lines) keeps the full deny-list. `scanAssembled()` (`copy.ts`) takes a new third parameter,
`businessLeadStrings`, scanned against the narrow list; `service.ts` splits UO1's claim into that
bucket; both `verify-relational-matrix.ts` and `verify-relational.ts` updated to match. Re-run after
the fix: **`REGISTER_GUARD_VIOLATIONS=0`**, 33 resolves (18 real reader/stock pairs + 15 distinct
anonymous), matrix still 64/64, verify still 51/51.

**The 40-cell live census script was a scratchpad throwaway from the original build session, deleted
at session end** — the only check that catches card-level regressions, and the one that caught this.
**Promoted** to `src/scripts/verify-relational-live-census.ts`, a permanent script alongside
`verify-relational-matrix.ts`. Resolves the real card for every real `(reader, held stock)` pair plus
an anonymous resolve per distinct stock, and exits non-zero on any register-guard violation. This
replaces `dump-relational-payloads.ts` in Part 4.5 above — that script is a two-fixture payload
dumper with no violation counter and never did what earlier drafts of this runbook claimed.

**Coverage state (4.6), as expected under Part 3 option 1:** `not_evaluable` remains NULL on all
3304+ rows; coverage stays `scored_unknown_depth`; UG9 does not fire. This is the correct, honest
outcome, not a gap.

**No git operation of any kind was performed.**
