# Retired gates

A gate that has done its job is deleted, not left running. But a deleted gate leaves a question —
*what did it prove, and is that still true?* — so it leaves this entry instead of a hole.

One entry per retired gate: what it asserted, the last verdict it returned, and what still holds the
ground it used to hold.

---

## `filing-step4-reconcile.ts` — retired 2026-08-10

**Ran:** `npx tsx src/scripts/filing-step4-reconcile.ts` (read-only, never wired into `build`)

**What it proved.** Step 4 stopped the score channel serving the 22 filing-owned rule keys, so a
finding frozen on a head snapshot *and* live in `stock_findings` renders once instead of twice. The
risk was that the suppression removed a card no other channel was showing. The gate derived a
step-3-final baseline of `health-view.service.ts` (via `scripts/lib/health-view-baseline.ts`, which
reverts the live source rather than freezing a copy), built both views for all 95 scored stocks, and
reconciled every removed row against the filing channel.

**Last run — 2026-08-10, immediately before retirement: ✅ RECONCILED.**

- 95 scored stocks. **1** lost a score-channel row (VEDL, `ownership_H_block_events`); 94 unchanged.
- Every removed finding is FIRED in the filing channel — **net zero information loss**, 0 findings
  landing in neither channel.
- 0 fired-state disagreements between the channels.
- §D: `filing/channel.ts`'s key set is derived from `FILING_REGISTRY` (22 keys), not a literal list —
  so the filter cannot drift when a rule changes passes.
- The quiet line correctly WITHDRAWN on 8 stocks whose score channel went silent while the filing
  channel fired (BAJAJ-AUTO, BLUESTARCO, LTM, M&M, MANKIND, NATIONALUM, POWERINDIA, VOLTAS).

**What holds the ground now.** §D's real assertion — that the suppression keys come from
`FILING_REGISTRY` and not from a hand-kept list — is a property of `filing/channel.ts` itself, and
that file is the only place the predicate lives. The migration it reconciled is finished and the
surfaces have been eye-tested.

---

## `verify:render-parity` → `cross-repo/verify-findings-render-parity.ts` — retired 2026-08-10

**Ran:** `npm run verify:render-parity` (cross-repo — needed both checkouts, structurally barred from
`build` by `verify-build-gate-hygiene.ts`). Its counting half lived in the frontend at
`scripts/count-rendered-findings.ts`, deleted with it.

**What it proved — and why the gate above was not enough.** `filing-step4-reconcile` proved net-zero
loss **on the wire**. The page still lost cards, because no frontend component read
`filingFindings`: the payload was complete and the browser was not. A payload-level gate cannot see
that. So this one ran the frontend's *own* `prepareStockFindings` — the function the stock page
calls — over three finding sets per stock (BEFORE = the pre-step-4 page; SCORE-ONLY = the
regression, measured; MERGED = `findings` ∪ `filingFindings.fired`) and asserted `MERGED === BEFORE`
as an **ordered key sequence**, not a count.

**Last run — 2026-08-10, immediately before retirement: ✅ RESTORED.**

- 95 scored stocks · **37** render the pre-step-4 sequence exactly · **58** render *more* · **0**
  mismatch · **0** still short.
- Duplicate cards: 0 stocks. Cross-channel key overlap: 0 stocks. Hollow cards: 0.

**What holds the ground now.** The merge is a property of the page's own composition and the
suppression it depends on lives in one file (`filing/channel.ts`). The four model-facing filing
surfaces and the render surfaces have been eye-tested since.

**Removed with it:** `generateStep4Baseline` / `STEP4_BASELINE_PATH` from
`scripts/lib/health-view-baseline.ts` — both gates' only callers. (The rest of that module, and
`filing-pass-step3-parity.ts` with it, retired one day later — see the last entry below.)

---

## `verify-red-flag-repoint.ts` — written and retired 2026-08-11 (same day)

**Ran:** `npx tsx src/scripts/verify-red-flag-repoint.ts --capture before.json` on the pre-change
tree, then `… before.json` on the post-change tree. Read-only, never wired into `build`.

**Why it was written.** The two gates above were retired the day before this migration, which moved
every red-flag reader off the dead `score_red_flags` and onto `stock_findings`. Nothing else covered
that ground, so this was built first and the change made second.

**★ The trap it was designed around, because it is the reason a naive version would have been
worthless.** "Assert every red flag served today is still served after" passes on an empty set — and
the set *was* empty: all 215 surviving rows sat on superseded or older-period snapshots, so every
head-keyed surface already served zero. A nothing-lost gate would have been satisfied by a change
that served nothing forever. So it asserted four things, and the second is the one with teeth:

1. **NOTHING LOST** — every (stock, rule, severity) served before is still served.
2. **LIVE-FED** — each repointed surface's served set *equals* the live standing set restricted to
   that surface's own population. This is what makes empty fail rather than pass.
3. **NO WIDENING** — each surface covers the same stock population as before, so the 45 unscored
   stocks with fired red flags stay out (reaching them is separate work).
4. **NO DUPLICATION** — `findings.redFlags` ∩ `filingFindings.fired` = ∅, because
   `prepareStockFindings` merges them and a key in both renders twice.

**Last run — 2026-08-11, after `DROP TABLE score_red_flags`: ✅ VERIFIED.**

- Nothing lost: 55 red flags still served on the stock page, 6 on universe rows, no pond count fell,
  screener still returns its same 6 members.
- Live-fed: `UniverseMemberView.firedFlags` **0 → 6 stocks**; pond `redFlagMemberCount` **0 → 6**
  across 5 ponds; the stock page serves all 55; the screener's `redFlags:"any"` set is exactly the
  scored stocks with a live standing red flag.
- Nothing widened: stock page 140 → 140 · universe 94 → 94 · ponds 23 → 23 · screener 6+88 → 6+88.
- No duplication across 140 stock pages.
- Quarter Brief: the false "no longer flagging" claims on DIXON, GLENMARK, INFY, NHPC and SBIN are
  gone — they were a set difference between a decayed current side and a still-frozen prior side.

**What holds the ground now.** The repointed surfaces read `filing/read.ts`'s `readStandingRedFlags`,
which is one function with one reduction (current row per (stock, rule) by `periodEnd` DESC). There
is no second source left to drift from — the table it drifted against no longer exists.

---

## `filing-pass-step3-parity.ts` + `scripts/lib/health-view-baseline.ts` — retired 2026-08-11

**What they were.** Step 3 had no pre-change tree to fingerprint against, so its baseline was
*derived*: `health-view-baseline.ts` read the live `health-view.service.ts` and applied the exact
inverse of steps 3 and 4's edits, producing the file as it stood before. The parity script wrote that
beside the original, imported both, and compared.

**Why they retire now, rather than being updated.** The generator's contract is that every revert
must match EXACTLY ONCE, so that a moved live file throws instead of comparing against something that
is not the before. It now throws — correctly. Step 4's red-flag revert
(`dropFilingFlags(dropRetiredFlags(snap.redFlags))` → `dropRetiredFlags(snap.redFlags)`) has no
target: `score_red_flags` is gone, the relation is gone, and there is no red-flag read in that file
to restore. A pre-step-3 source of `health-view.service.ts` is no longer reconstructable, so the
honest move is to retire the tool rather than teach it to fabricate one.

Steps 1 and 2's parity scripts are unaffected and stay: they fingerprint the score pass directly and
never used this generator.
