# Universe expansion — autonomous run log

Started 2026-08-27 01:30 IST. Bugs found, fixes applied, and decisions taken without checking in.

---

## Bugs found and fixed

### B1 — `scan.ts heldResultReach`: `text = uuid` type error (PRE-EXISTING, production)

`heldResultReach()` cast `${stockId}::uuid`, but `stock_id` is a **`text`** column on all five
quarterly tables. Postgres raised `42883 operator does not exist: text = uuid` and the whole
`scanSymbol` call died.

Reachable **only** from the empty-discovery branch — the path taken when NSE returns no filings for a
symbol. Across a universe of established filers that path is effectively never taken, which is why it
sat unnoticed. In a cohort of 1,787 mostly small and recently-listed companies it is a *common* case.

MEASURED: it killed the first newly-listed stock the backfill touched (3BBLACKBIO, listed 2026-04-20).
Had it not been fixed, every silent filer in the cohort — potentially hundreds — would have failed.

**Fix:** dropped the `::uuid` casts. Verified: 3BBLACKBIO now succeeds with 10 rows via the BSE
fallback. Zero failures across all 1,787 symbols afterwards.

### B2 — stage-17 ledger reported `rows: 0` while rows were landing (MINE)

The ledger recorded `scanSymbol`'s returned `ingested` counter, which came back **0** for all 7
symbols in the first live slice — while 14 quarterly + 4 annual rows had genuinely landed for
20MICRONS, 63MOONS, A2ZINFRA and the rest. The counter does not see writes arriving through the BSE
fallback lane, and its `skipped` field is inconsistent alongside it.

A progress ledger that under-reports to zero is worse than no ledger: across a 15-hour campaign it
reads as achieving nothing, and the obvious response to that is to stop it.

**Fix:** the ledger now counts rows from the database, per symbol, across all ten result tables.

### B3 — parallel workers would have raced on one ledger file (MINE, caught before damage)

All workers wrote `_s17-ledger.json`; concurrent read-modify-write is last-writer-wins, so entries
would vanish and the lost symbols would look un-attempted forever. The DB writes themselves were
never at risk (idempotent upserts, `ON CONFLICT DO NOTHING`, disjoint symbols).

**Fix:** one ledger file per worker, never written by another; the done-set is the **union** of every
`_s17-ledger*.json`. This also made re-partitioning free — worker counts can change between runs and
nothing is refetched, because "done" was never tied to who did it.

### B4 — mismatched slice moduli caused overlapping work (MINE, caught in ~90 seconds)

Launched a third worker as `--slice 2/3` while two others were running `0/2` and `1/2`. Different
moduli over different remaining-sets meant worker 2's symbols overlapped with what the others still
had queued — duplicate NSE fetches, exactly the wasted load to avoid while probing rate limits. Not
dangerous (idempotent writes, per-worker ledgers) but wasteful.

**Fix:** stopped all three and relaunched as a consistent `0/3, 1/3, 2/3`. Cost: one duplicate symbol.

### B5 — progress query hit the Postgres statement timeout (MINE)

The price-backfill progress query ran `count(*)` over `daily_prices` while the table was past 2.3M
rows and under heavy insert load. Postgres cancelled it (`57014`).

**Fix:** rewrote it index-assisted — `NOT EXISTS` on the stock join, plus the planner's `n_live_tup`
estimate for row counts and `pg_database_size` for size. Returns instantly and no longer competes
with the backfill it is measuring.

### B6 — background jobs died with the session (MINE)

Launched the 20-hour campaign as a session-scoped background job. It was killed at ~04:30 when the
session tore down and sat idle ~8 hours before anyone noticed.

**Fix:** relaunched detached via `cmd.exe` + `Start-Process -WindowStyle Hidden`, which survives
session teardown. The ledger meant zero work was lost — it resumed at exactly symbol 363.

### B7 — a `tail` pipe swallowed the entire background log (MINE)

Piped a long background run through `tail -40`, which buffers until the process exits. The log file
sat at 0 bytes for the whole run, so progress was unreadable from it.

**Fix:** dropped the pipe; long runs now redirect straight to a file. (The database was the better
progress signal anyway and is what the reporting uses.)

---

## Decisions taken without asking

- **3 parallel workers, escalated 1 → 2 → 3 with measurement at each step.** Zero failures at each
  level before adding the next. Effective rate went ~48 s/symbol → ~19 s/symbol (**2.4×**, not 3× —
  per-worker cost rose from 48 s to ~57 s under contention).
- **Session-reset cadence 3 → 12** after an A/B: 40 s → 31.5 s per symbol, 23/23 ok, zero failures.
- **Mid-flight rebalance at the tail.** When workers finish unevenly the last one grinds alone; at
  97% one worker held 31 symbols while the others were nearly idle. Stopped and re-partitioned the
  remainder 18/17/17. Free, because of the union done-set.
- **GAJA deleted rather than kept.** Yahoo serves no price history for it, so it can never have a
  price series. Verified 0 dependent rows across all 40 tables with an FK to `stocks` before
  deleting, and added an ISIN-keyed exclusion to the seeder so the next run cannot recreate it.
- **BSE-first was evaluated and rejected.** Benchmarked BSE-only over a full window: 9–10 of 10
  periods served at ~58 s/symbol, versus 58–96 s for the current NSE-first + BSE-fallback. The ~15%
  upside only materialises when BSE serves 100% (otherwise both lanes are paid in full), the sample
  was 3 stocks, and the lane was running clean. Time of day proved the bigger lever: 37–44 s/symbol
  overnight versus 58–96 s during market hours.

### B8 — timezone confusion produced a phantom "residual mismatch" finding (MINE)

After the industryType correction I queried `result_fetch_logs WHERE fetched_at > '2026-08-27 01:32'`
intending "since the fix" in IST, and reported 90 stocks apparently still mismatching. They were not.

**The database stores UTC** (`now()` returns `+00`), while the machine's wall clock is IST. So the
filter meant 07:02 IST and swept up most of the *original* campaign's logs. All 87 of those symbols
were verified to already carry their corrected `industryType`.

This is the second timezone error in the session — the first was forcing `TZ=Asia/Kolkata` on a shell
whose clock was already IST, which double-converted it 5h30m the wrong way and made every reported
time wrong.

**Fix:** compare stored timestamps in UTC; read the wall clock with a plain `date`. Recorded in the
`deployed-daily-rescore-writes-db` memory note, which also had to be corrected — the "13:30 IST"
rescore is really **13:30 UTC / 19:00 IST**, and it is the price-driven cascade fired by
`daily-eod-prices`, not an independent schedule.

---

## Stage 18 — industryType derived from the filings (done)

All 1,787 seeded stocks start `non_financial` because guessing a bank from its name is a coin flip.
It never needed guessing: `scan.ts` detects the taxonomy from the filing, refuses to ingest on a
mismatch, and logs the right answer.

Harvested **305 mismatch logs across 106 stocks — 92 nbfc, 14 banking**. No conflicts (a stock whose
logs disagreed with themselves would have been skipped, not guessed). Corrected, then **purged those
106 from every ledger** so stage 17 would revisit them — without that step the correction is inert,
because the filings had been skipped and the ledger already called those symbols done.

Result: 13/14 banks and 90/92 NBFCs now hold data in their proper tables; the stragglers filed
nothing. **Not one had a bank's numbers written into the Ind-AS tables** — the gate refused rather
than mis-parsed, which is the whole point of leaving industryType at its default.

---

## Broker auto-add removed (done)

`universe-admit.ts` no longer adopts unknown equities. The premise changed: admission existed because
the universe was 504 stocks, so anything outside the Nifty-500 could not be represented. With the NSE
EQ segment seeded (2,291), an equity that is *still* unknown is BE/BZ (surveillance / trade-to-trade),
SME-platform, BSE-only, or newer than the last seed — precisely what should not become a bare row.

- Behaviour is a named constant, `ADMIT_UNKNOWN_EQUITIES = false`, not deleted code. "Why did this
  stop happening" is a question someone will ask, and a constant answers it where a deletion cannot.
- New `notCovered: { symbol, isin, reason }[]` on both the resolution and the sync outcome — **this is
  the banner feed.** The holding is still held and shown with quantity and cost; only tracking is
  absent.
- **The bond / catalogue-instrument path is untouched.** Bonds the bhavcopy has never shown us are
  still admitted as instruments — that is a different case with a different justification, and
  collapsing the two would have been the easy mistake.
- `verify-step13-etf.ts` asserted the old behaviour (+1 stock on an unknown equity). Inverted, with
  the reason recorded inline. The assertion it actually exists to guard — an ETF must never be
  fabricated as a stock — is unchanged.

---

## B9 — `operating_profit` was misfiled as a derived column, so the BSE lane never wrote it

**Symptom (user-visible).** On ABBOTINDIA's Fundamentals tab the OPM% column was blank for most
quarters, and on the Margin Trend chart the operating-margin line began at Q4'25 while the net-margin
line spanned the full history.

**Diagnosis.** `operating_profit` is a **raw cell** — the NSE parsers read it off the filing, and
nothing in the derive layer computes it. `deriveIndAsQuarterly` takes `operatingProfit` as an *input*
and returns `operatingMargin` from it. `bse-writer.ts`'s INSERT never named the column, and its own
header comment listed it among the columns "computed by the derive layer", so the gap was invisible
to anyone reading the file.

MEASURED: **5,180 of 5,222** BSE quarterly rows had no operating profit. The 42 that did were rows a
hand-keyed workbook happened to fill — which is why ABBOTINDIA's chart began exactly where my earlier
workbook load began. Both NSE lanes were 100% populated, so this only ever showed on BSE-sourced
stocks.

The two symptoms are one cause seen from two ends: net margin needs only `net_profit / revenue`, both
of which BSE writes, so that line drew fully; operating margin depends on `operating_profit`, so it
had no points to draw.

**Fix.**
1. `bse-writer.ts` writes `operating_profit` as the raw cell it always was, via a new exported
   `bseOperatingProfit()`. Header comment corrected so it does not mislead the next reader.
2. The value is `revenue − expenses`, **guarded per row**: only where the row itself proves `expenses`
   is the all-in figure, via `pbt = revenue + other_income − expenses`. That identity holds on 4,959
   of 5,222 rows; the rest get NULL rather than a number computed on a definition their filing does
   not support.
3. Why that formula and not `pbt + interest − other_income` (what `parser-indas.ts` uses)? The
   universe already disagrees with itself — 16,330 legacy NSE rows are EBITDA-style, current NSE rows
   are mostly `rev − exp` (5,474 vs 1,058) — and `rev − exp` is what the CURRENT lane, the hand-keyed
   workbook and every existing BSE row with this column use. Matching the going-forward standard beat
   introducing a third convention.
4. `bse-column-fill.ts` got the matching entry, because `verify-bse-writer-parity.ts` asserts the two
   lists are identical on every build. That gate is what forced the second edit to happen at all.
5. Backfill `stage27-bse-operating-profit.ts` — calls the SAME `bseOperatingProfit`, so a backfilled
   row and a freshly-written one are computed identically. NULL-only: the 42 pre-filled rows untouched.

## B10 — the BSE lane never ran the derive layer at all (the forward fix for B9's whole class)

**Diagnosis.** The NSE ingesters spread `...derived.columns` into their write. `bse-writer.ts` is an
explicit-column INSERT and `bse-column-fill.ts` is a null-only UPDATE — neither has any notion of
derivation. So every row the BSE lane has ever produced carried raw numbers and no ratios: all 5,222
BSE quarterly rows without `net_margin`, 741 of 742 BSE annual rows without ROE.

Stage 25 swept 7,517 accumulated rows. **That was the sweep, not the fix** — without a forward change
the next BSE write starts the pile again. The lane's own convention already said what to do ("Key the
inputs; run src/fill/re-derive.ts"); it was never wired in.

**Fix.** New `bse-derive-after-write.ts` maps each of the ten physical tables to its `RE_DERIVE` key
and runs the derive layer over the row just written. Wired into `backfill-bse.ts` at **both** exits —
the create path and the null-only fill path (a filled raw cell changes what the ratios should be),
the latter only when something actually landed.

**Best-effort by design.** A derivation that throws must not fail an ingest: the raw cells are the
ingest's product and are already committed and correct. A missing ratio is a dash on a page,
recoverable by re-running stage 25; a thrown ingest loses the filing. The error text is returned to
the caller for the note, and nothing else happens.

**Made a build gate, not a promise.** `verify-bse-writer-parity.ts` now parses `DERIVE_KEY` from
source (like everything else it checks — counted, not intended) and asserts it covers every table in
`BSE_COLUMNS`. NEGATIVE-TESTED: removing `nbfc_fundamentals` from the map turns the check red with
`not derivable: nbfc_fundamentals`; restoring it turns it green. A new table added to the lane and not
to the map now fails a build instead of a screenshot.

## B11 — stage 25's `needs` gate demanded a DERIVED column as a raw input, so it skipped every BSE financial row

**Found by asking "was operating_profit the only one?" and measuring instead of answering.**

Stage 25 selected rows with `witness IS NULL AND <needs> IS NOT NULL`, where `<needs>` was a
hand-written list of the raw inputs a derivation requires. For `banking_quarterly_results` that list
was `[net_profit, total_income]` — but **`total_income` is not a raw cell**; it is one of the columns
the derive layer EMITS (`BANKQ_COLS` in re-derive.ts). The gate therefore demanded, as a precondition
for deriving, a value only deriving could produce. Every BSE banking row failed it and was skipped —
and the skip printed as a legitimate "no raw inputs present" verdict, which is why it went unnoticed.

MEASURED consequence: all 88 BSE banking quarterly rows sat at 0% on `nii`, `total_income`,
`net_margin`, `pcr`, `tier1_ratio` and the four QoQ/YoY columns — every one of them computable from
raw cells that had been on the row all along.

**Fix — `stage28-rederive-all-bse.ts`: do not gate on guessed inputs.** The derive functions already
handle absent inputs correctly (null in, null out). A gate in front of them is a second, unchecked
copy of the input rules that can be — and was — wrong. Stage 28 offers EVERY BSE row to the derive
layer and lets it decide; a row that can produce nothing costs one cheap call and returns "no change".

RESULT: 1,026 BSE rows offered, **165 changed, 0 failed**. banking_quarterly_results gained nii,
total_income, net_margin, pcr and pat_qoq on all 88 rows; banking_fundamentals gained nii,
total_income, pcr, NIM and credit-deposit ratio on 20–21 of 21; general_insurance_quarterly_results
gained net_margin on all 42.

## B12 — OPEN, NOT FIXED: the BSE annual lane reads ~24 columns of a document that carries ~270

**Not a regression — the lane has always been this way. Recording it because it is now measured.**

Audit method (`audit-bse-column-gaps.ts` → `audit-bse-gap-cause.ts` → `probe-bse-instance-facts.ts`):
compare each column's fill rate on BSE rows against NSE rows for the same table; split the gaps by
whether the writer NAMES the column at all; then fetch the real filing each row was built from and
list the element names it actually contains.

After B9–B11, **122 columns remain structurally unfillable** — the writer never names them:

| table | BSE rows | unfillable |
|---|---:|---:|
| fundamentals | 742 | 45 |
| nbfc_fundamentals | 29 | 36 |
| banking_fundamentals | 21 | 31 |
| nbfc_quarterly_results | 94 | 6 |
| banking_quarterly_results | 88 | 4 |
| quarterly_results | 5,222 | **0** |
| general_insurance_quarterly_results | 42 | **0** |

**The document probe settles that these are real and not source limitations.** ANSALBU's BSE annual
instance is 402 KB with 273 distinct element names and demonstrably contains `Inventories`,
`TradePayablesCurrent`, `Goodwill`, `CashFlowsFromUsedInInvestingActivities` and
`PaidUpValueOfEquityShareCapital` — all of which the lane leaves null. The balance sheet and cash-flow
statement are in the file; the extractor reads the P&L and stops.

⚠ NOT everything flagged is real. The same probe found `nii`, `interest_income` and
`fee_and_commission_income` genuinely ABSENT from the NBFC instances (BSE routes NBFC filings through
the Ind-AS results form, which has no interest-income breakdown), and `basic_eps` absent from
ANSALBU's annual. Those are source limitations with nothing to fix. Each remaining column needs the
same per-document check before any work is done on it — the audit produces candidates and evidence,
not a verdict.

**Impact, measured:** 310 stocks have BSE-only annual data and 727 of the 742 BSE annual rows are the
sole source for their stock-year, so there is no NSE row to fall back on. Those stocks show dashes
across the balance-sheet and cash-flow sections.

**STATUS: FIXED 2026-08-28** (user approved: "first apply the fix"). See B12b below.

## B12b — the fix: the BSE annual lane now reads the balance sheet and cash-flow statement

**41 raw columns added** to `extractFundamentalCells`, the writer's INSERT and the filler's column
map, in one coordinated change (the parity gate forces all three to move together).

Every tag name is **copied from `parser-indas.ts`**, which reads the SAME taxonomy for the NSE lane —
copied rather than re-derived, because a tag that is right in one lane and subtly wrong in the other
is invisible until someone compares two stocks and finds one inexplicably empty.

Three derived columns (`book_value_per_share`, `inventory_turnover`, `eps_growth_yoy`) needed no work:
they compute from cells that now exist, and the B10 derive-after-write hook fills them.

**⚠ tsc caught a real one.** `extractCommonPerShare` also returns `faceValueShare`, so spreading it
would have silently overridden the lane's existing mapping — a column that already worked and was
never part of this gap (TS2783). The three new fields are picked explicitly instead.

**Backfill — `stage29-bse-annual-balancesheet-backfill.ts`.** Re-reads each row's stored `xbrl_url`
and runs it through the new extractor, so a backfilled row is what the lane would write if it saw the
filing today. Writes go through the existing null-only, FOR UPDATE-guarded, audited `fillNullColumns`,
so hand-keyed and NSE values are safe by construction. Yield: 38-63 non-null cells per document
against the old 24.

### Three operational defects found while running it — each cost a run

1. **Prisma transaction timeout.** Died on ROW 1: "a query cannot be executed on an expired
   transaction", 5,599 ms against a 5,000 ms default. The lane's own use of `fillNullColumns` writes
   ~10 columns; this writes up to 41, each a FOR UPDATE plus an audit row. Raised to 120 s.

2. **BSE throttles by RUN LENGTH, not request rate.** An unbounded pass at 1,100 ms spacing was
   throttled after 87 documents. Going slower forever does not fix it; running a BOUNDED CHUNK and
   letting the connection go quiet does. Now 90-document chunks at 2,600 ms with a 6-minute cooldown
   after any throttle. (Same lesson AMFI taught on long walks — see the ETF inception-walk note.)

3. **⚠ THE CHUNK QUEUE WAS STARVING ITSELF — the subtle one.** Some stored URLs are genuinely gone
   (verified by hand: `NBFCUploadDocument` paths return a real HTTP 404 under both casings). The
   queue is ordered by fiscal year and symbol, so DEAD ROWS SORT TO THE FRONT and were re-fetched on
   every chunk while successful rows drained out behind them. MEASURED: chunk 1 spent 20 of 90
   requests, chunk 3 spent 29, buying nothing. Left alone the dead set becomes the whole chunk and the
   run stops progressing WHILE STILL LOOKING BUSY.

   Fixed with a dead-URL ledger (`docs/stage29-dead-urls.txt`): a document that 404s is recorded and
   skipped thereafter. The row is NOT marked unfillable — it is fine, and its document may be
   re-discoverable through the BSE announcements API later. This is about not wasting a limited
   request budget.

   **The effect was immediate and larger than expected:** chunk 3 (no ledger) filled 61 of 90 with 29
   failures; chunk 4 (ledger) filled 87 of 90 with 3 failures and did not throttle. The wasted
   requests had been contributing to the throttling, not merely sitting alongside it.

⚠ A fourth, smaller slip: the log line printed the CHUNK SIZE rather than the real queue, so every
chunk reported "90" regardless of progress — it read as a stalled run. The functional filtering was
correct throughout; only the message was wrong. It had no assertion on its replacement while the
functional edits did, which is exactly why it failed silently.

## B13 — ownership split showed Retail and Others as separate slices, summing past 100%

**Reported from the UI: the ownership tab showed identical Retail and Others values and a total over
100%.** Both symptoms, one cause.

`retail_pct` and `others_pct` are ONE QUANTITY IN TWO COLUMNS. The backend derives a single residual
`public - FII - DII` and writes it to both (`ingestions/shareholdings/shareholding-derive.ts` says so
outright: "retailPct is the same value as othersPct"). MEASURED: identical on ALL 25,168 shareholding
rows, zero exceptions. ABBOTINDIA rendered 74.99 + 0.38 + 8.78 + 15.85 + 15.85 = 115.85% — exactly
100 plus the residual counted twice.

**Not a data defect — a display one.** Fixed in the two components that stacked five slices:
`stock-detail/activity.tsx` and `stock-detail/overview/section-ownership.tsx`. Four lanes now, summing
to `promoter + public`.

**The rest of the app already had this right** — `research/tools/ownership/ownership-data.ts` stacks
four and carries a comment warning that stacking `othersPct` would double-count;
`peer-group/ownership/lib.ts` notes "others duplicates it in the source"; the comparison bars use
Promoter/FII/DII/Public. So this was a local slip, not a systemic misunderstanding.

**Label corrected too:** "Retail & others", not "Retail". The residual is every public holder that is
not an FII or a DII — retail plus bodies corporate, trusts and the rest. Fixing only the arithmetic
would have left the number mislabelled.

**Recurrence guard:** the warning now sits on the `othersPct` field in `types/research-tools.ts` —
what an author autocompletes against, which is the moment the mistake gets made. `othersPct` is now
referenced nowhere in the app outside its own type definition.

## B12c — `interest_paid` was dropped by the very mechanism that added the other 41

Found by RE-RUNNING the gap audit after the backfill finished, not by reading the diff. `fundamentals`
went from 45 unfillable columns to 2, and one of the survivors was `interest_paid`.

**Cause:** the 41 columns were generated from a table of `(field, column, tag, context)` — one tag per
column. `interest_paid` needs a TWO-TAG FALLBACK (`InterestPaidClassifiedAsFinancingActivities` ??
`...AsOperatingActivities`, exactly as parser-indas.ts does it), so it did not fit the row shape and
fell out of the generation silently. A generator that cannot express a case will drop it without
complaining; the audit is what noticed.

**⚠ The parity gate then caught a SECOND error inside the fix:** the value went into VALUES but the
matching name never reached the column list — "INSERT names 76 columns and supplies 76 values ·
column list has 76, VALUES has 77". That is precisely the class of mistake the gate exists to catch,
on a hand-edit made in a hurry.

**⚠ The witness had to move with the extractor.** stage 29's resume query keyed on
`inventories IS NULL AND current_assets IS NULL`. That witness means "this row has not been re-read by
the CURRENT extractor" — so when the extractor gains a column, the witness must move too, or the
resume query reports zero work while the new column stays empty everywhere. Witness is now
`interest_paid IS NULL`, which correctly reports all 694 rows as needing a re-read.

**NOT BACKFILLED — deliberately.** Filling it means re-fetching all 694 documents for one cash-flow
line: ~1.5 hours against a BSE that threw transport faults all evening, for a column NSE carries on
85% of rows. The extractor is fixed so every future BSE annual read includes it; only the history is
outstanding. Flagged for a decision rather than spent unilaterally.

**Also done:** re-ran the derive over all 742 BSE annual rows now that basic_eps and its priors exist
— 253 rows gained `eps_growth_yoy`, 1 gained `inventory_turnover`, 0 failed. Rows filled before their
prior year's row existed had computed null the first time; a second pass was always going to be needed
and costs nothing (no network).

## B12d — interest_paid backfilled; and the resume witness starved on rows whose filing lacks the tag

**Result: 663 of 742 BSE annual rows now carry interest_paid.** Eight chunks of 90 at 3.2 s spacing,
seven of them 90/90 with ZERO fetch or write failures — a markedly cleaner run than the afternoon's,
helped by the dead-URL ledger meaning no request is spent on documents that do not exist.

The remainder reconciles exactly, which is the point: **52** rows whose filing carries no
InterestPaid tag under either classification (correctly null) **+ 27** dead-URL rows still skipped
**= 79**, and 742 − 663 = 79. Nothing unexplained.

**⚠ THE WITNESS STARVED — the same shape as the dead-URL trap, a different cause.** The resume query
keys on `interest_paid IS NULL`, so a row whose DOCUMENT SIMPLY HAS NO SUCH TAG can never leave the
queue. Chunk 8 read 64 and filled 12; chunk 9 restarted on the same 52 and chunks 10–30 would have
re-fetched them forever — progress-looking work that discovers nothing. Driver killed at chunk 9.

  A witness column answers "has this row been re-read by the current extractor?" only while the
  column is one the extractor RELIABLY produces. `inventories` was a good witness (~95% of filings);
  `interest_paid` is a bad one (81% of the tail lacks it). The general fix is to record ATTEMPTS, not
  to infer them from an outcome — the dead-URL ledger is exactly that, and this case wanted the same
  treatment.

**⚠ pkill -f could not stop the driver** — it does not see Windows process command lines under Git
Bash, the same limitation that made an earlier monitor report a live run as dead. Killed by PID, and
confirmed stopped by watching the chunk log go stale rather than by trusting the kill.

## B14 — 21 of the 48 dead BSE documents recovered by re-asking the listing

`stage30-bse-rediscover-dead-docs.ts`. A stored `xbrl_url` is one filename BSE served once; the
RESULTS LISTING is what BSE serves for that scrip today. Scrip code parsed straight out of the dead
URL (all 48 embed it), quarter code from `quarterCodeFor(report_date, "annual")`, then the lane's own
`fetchResultsListing` + `findStandaloneDocument`. No new discovery logic.

**⚠ THE ALTERNATES WERE THE RECOVERY.** A first pass skipped every row whose primary filename matched
the known-dead URL — 29 of 48 — and never looked at the `alternates` the same listing offers. Trying
them took recovery from **6 to 21**, and 15 of the 21 came from an alternate rather than a new
primary. BSE lists a period under multiple filenames far more often than assumed.

Each candidate is FETCHED AND PARSED before `xbrl_url` is rewritten — replacing a dead URL with a
different dead URL would convert a known problem into a silent one. Writes go through the audited
null-only filler, so a rediscovered document can only add.

**⚠ THE LEDGER MUST SHRINK ON RECOVERY.** A recovered row has a working URL, but the running backfill
reloads the ledger every chunk — leaving those 21 in it would have made every future pass skip them
forever, silently missing interest_paid and anything added later. Pruned 48 → 27.

**⚠ `.catch(() => null)` DESTROYED THE DIAGNOSIS.** All 27 remaining rows reported
`listing_unavailable`, which could not distinguish "this scrip genuinely has no listing" (permanent)
from "the request failed under load" (transient) — opposite responses. It also swallowed
ThrottleStopError, so the run kept pushing into a throttle instead of stopping. Both fixed; the error
text is now carried verbatim into the report.

**Evidence the 27 are transient:** with BSE freed after the backfill, a retry was throttled at row
0/27 immediately — the listings were failing under load, exactly as suspected, not absent. A patient
retry (25-minute waits, 5 s spacing, 3 attempts) is scheduled rather than retrying harder.

**⚠ LESSON: DO NOT RUN TWO JOBS AT ONE HOST.** Running the rediscovery beside the backfill is what
squeezed the listing endpoint and produced those 27 in the first place. The parallelism bought
nothing and cost the smaller job its results.

## B15 — completed revenue-model workbook loaded; 4 new sectors created

**Loaded from `RevenueModelWorkbookCompleted/` (2,066 rows).** Split across TWO loaders on purpose:
`stage24b` writes PROSE a person authored (revenue model, tags); the new `stage24c` writes TAXONOMY
that other things join on (sector drives peer groups, health-score weightages, comparison surfaces).
A bad sentence is visible on one page; a bad sector silently reshapes a peer group. Keeping them
apart also left 24b — already tested — completely unchanged.

RESULT: revenue_model + business_tags on 2,064 · sector on 169 · industry on 21 · 0 refused.

Universe now: **2,290 active · sector 2,289 · industry 2,290 · revenue model 2,288 · tags 2,288.**
The two stragglers (STCINDIA, SIGMAADV) are the two rows left blank in the workbook itself.

**⚠ NULL-ONLY IS LOAD-BEARING HERE, NOT A HABIT.** The workbook shipped each row's CURRENT sector and
industry as CONTEXT for the author. A plain upsert would have rewritten 1,896 rows with what they
already said and buried the ~170 that actually changed — indistinguishable in the output, and
impossible to review.

**Four new sectors created:** business_services (32), media_entertainment (50), paper_products (20),
education (14).

  ⚠ DISPLAY NAMES ARE HAND-WRITTEN. The existing convention turns an underscore into "&" for
    compound concepts (capital_goods_engineering → "Capital Goods & Engineering"). Any rule general
    enough to do that renders paper_products as "Paper & Products". Four names are cheaper than a
    rule that is wrong once.

  ⚠ sector_class LEFT NULL, DELIBERATELY. Quality / Defensive / Commodity / Cyclical / Growth / PSU
    is an editorial judgement that feeds grounding and relational logic. Inventing one would put a
    fabricated judgement where it reads as a decision someone made. OPEN — needs a human.

**⚠ FOUND WHILE LOADING: `sectors.stock_count` was stale** — it totalled ~200 against a 2,290-stock
universe, so it had not been maintained since the expansion. Recomputed from the join rather than
incremented, because an increment on top of a wrong number stays wrong. 24 sectors corrected.

## B16 — the requested frontend change was already in place

Asked to collapse the company-overview panel to one column when a stock has a description but no
"How it earns". `section-identity.tsx:104` already does exactly that
(`coreBusiness && revenueModel ? "lg:grid-cols-2" : "grid-cols-1"`), with each half rendering
conditionally — built earlier in this session during the company-overview work. No change made, and
said so rather than editing something to look busy.

After tonight's load the case is nearly extinct anyway: 2,288 of 2,290 stocks now have both halves.

## B14b — dead-document recovery closed: 44 of 48

| pass | recovered | ended |
|---|---:|---|
| first (alternates fix) | 21 | clean |
| retry attempt 1 | 22 | throttled at 22/27 |
| retry attempt 2 | 1 | throttled at 1/5 |
| retry attempt 3 | 0 | throttled at 1/5 |

**BSE annual coverage: 738 of 742 rows carry a balance sheet (99.5%); interest_paid on 686.**

⚠ Attempt 3's "re-listed 1 · filled 0" is not a failure — the ledger had not been pruned after
attempt 2, so row 0 was STARTECK, already recovered, correctly landing nothing. **The ledger must be
pruned after EVERY pass, not just the big one**; an unpruned ledger spends the first request of each
retry re-confirming work already done, and with a throttle waiting at row 1 that is the whole budget.

**STOPPED, not failed.** Three consecutive throttles at row 1 means BSE has had enough for tonight;
retrying harder is what deepens a throttle. The four left — TVSHLTD FY25/FY26, UGROCAP FY26,
WILLAMAGOR FY26 — have INTACT P&L (revenue and net profit both present) and are missing only
balance-sheet detail. Nothing is broken while they wait; a single re-run of stage 30 on a quiet
connection should finish them.

## B17 — instrument catalogue synced to the expanded universe (504 → 2,291)

Found while auditing logo sources: `stocks` held 2,290 active companies and `instruments` held **504**
rows with asset_class='stock'. The universe expansion never propagated to the instrument spine, so
anything enumerating instruments — chat's instrument lookup, the asset-class surfaces, the logo work
that found it — had been quietly seeing the old universe.

`stage31-instrument-catalogue-sync.ts`: 1,787 rows added · 2,291 catalogued · 0 unlinked · 0 stocks
left without a row.

**⚠ THE RISK WAS BROKER SYNC, AND IT WAS CHECKED BEFORE WRITING, NOT AFTER.** `universe-admit.ts`
asks the CATALOGUE before it asks `stocks` (Pass 0 exists so an ETF is never re-identified by a
ticker), so widening the catalogue could in principle re-route equity holdings. It cannot: that pass
filters `stockId: null` — non-equity rows only — and its own comment says why ("An instrument WITH a
stockId is an equity's catalogue row, and those belong to Pass 1/2"). Every row written carries a
stock id, so all 1,787 are invisible to it.

Also measured before writing, because `instruments.isin` is UNIQUE and a collision would abort
mid-run leaving a half-synced catalogue: 0 ISIN collisions · 0 duplicate ISINs · 0 blank ISINs. The
gate is kept IN the script rather than done once by hand, so a later re-run cannot half-sync either.

**Rows are deliberately minimal** — isin, symbol, name, asset_class, stock_id, is_active — because
that is exactly what the existing 504 carry (attributes/last_price/nav are NULL on every one). An
equity prices off `stocks`/`daily_prices`; writing a price onto its catalogue row would create a
second source of truth for a number that already has one.

## B18 — findings backfilled across the expanded universe (no new code needed)

**The mechanism already existed and already covered 2,290.** `filingUniverse()` selects every active
stock; the handler comment saying "all 504 stocks" was stale text from before the expansion. 897 of
2,290 stocks had findings; 1,393 had never been evaluated. Ran the existing
`src/scripts/filing-backfill.ts`.

**⚠ THE COMPLETENESS QUESTION WAS ASKED AND ANSWERED BY MEASUREMENT, not by trusting "22 of 22".**
Reconciliation: 104 score-pattern keys · 22 filing keys · 13 shared · 91 score-only. All 91 genuinely
need a score — lens (50, peer-relative), trajectory (15), divergence (12), notcovered (11),
composition (1).

Two keys looked like filed-data ownership rules wrongly excluded, and were read to check:
  · **P5 insider-confirmed distress** reads insider SELLS but fires only when composite < Below-par
    top — "the composite-weak gate is what makes it 'confirmed distress' rather than a bare sell-flow
    restatement".
  · **P10 promoter defense** reads promoter BUYS but gates on the Market pillar < 72 — "buying when
    the tape is strong isn't defense".
Both need a score. Neither can fire for an unscored stock, and this cannot drift: filing rules are
typed against a context with NO score fields, so a rule reaching for one fails to compile.
`filing/registry.ts` also throws at module load if a rule in FILING_RULES has no registry entry.

**HISTORY — the answer is BOTH, and the distinction matters.** stock_findings STORES history (14
periods, 2018→2026, 1–6 per stock), but `filing/read.ts` resolves "what is standing now" as the
greatest period_end per (stock, rule) — so the UI shows LATEST ONLY. And the pass writes only at the
periods the current context resolves to ("PRIOR PERIODS ARE NEVER TOUCHED"), so this run is NOT a
historical rebuild; history accrues forward as filings land.

**VERIFIED END TO END, not assumed from row counts.** GUJENERGY — unscored, no findings this morning
— now carries R2 promoter exit (critical red flag), P8 receivables (amber), P12 margin recovery
(green) and N5 dual institutional build (green), each at its own period grain (A:FY26 / Q:FY27Q1 /
S:FY27Q1). All four `newly_standing`, correctly: a first observation is not a transition, so they
will not fire "new finding" alerts as though something changed at the company.

## B19 — logo sourcing: automated routes measured and REJECTED

⚠ **Wikidata is not merely insufficient for AMCs — it is actively wrong.** All 52 fund houses probed:
2 returned a logo and BOTH were the wrong company. "SBI" matched an entity whose official site is
`s7.ru` — **S7 Airlines**. "HSBC" matched the global bank, not HSBC Mutual Fund India. The other 50
rate-limited out. An automated pipeline would have put an airline's mark on SBI Mutual Fund with
nothing to flag it. AMFI has no machine-readable AMC directory (obvious paths 404).

Conclusion: AMC logos are sourced BY HAND from each AMC's own site. `stage32-amc-logo-worklist.ts`
emits the 52 ordered by catalogue coverage with the exact filename each must carry (top 12 = 68.4%).

`stage33-logo-validate-upload.ts` validates before uploading — header-parse only (PNG IHDR, JPEG
SOFn, WebP VP8 variants, SVG viewBox), no `sharp` native dependency for a one-off. JPEG is rejected
at ANY size: no alpha means a white box on dark rows. Low bytes-per-pixel is FLAGGED as suspected
upscaling, never asserted as a sharpness measurement. Magic bytes are checked against the extension —
the failure that catches is a saved HTML error page, MEASURED earlier today when a logo CDN returned
413 KB of HTML with a 200 status.

BLOCKED ON: `SUPABASE_SERVICE_ROLE_KEY` (only SUPABASE_URL is set; storage needs the service role)
and a `logos` bucket.

## B20 — equity logos: four sources measured, all rejected. Annual-report harvesting works but yields 33%.

**Q: where do 2,290 equity logos come from?** Four routes measured, none viable:

| route | result |
|---|---|
| logo.dev / Brandfetch | Real logos, but the free tier FORBIDS STORING — a CDN dependency, which is what Clearbit's death argues against |
| Wikidata by NAME | Rate-limited after ~17 requests AND produces CONFIDENT WRONG ANSWERS ("SBI" -> an entity whose site is s7.ru, S7 AIRLINES) |
| Wikidata by ISIN (SPARQL, batched) | Exact, free, unlimited — but only 4/36 Indian equities carry an ISIN there, 2 with a logo |
| Site favicons | SUNPHARMA 32x32, RELIANCE 16x16. Browser-tab assets, not logos |
| NSE / BSE endpoints | NO logo field on any of 4 BSE APIs; BSE pages are an SPA shell; NSE APIs 403 from here. Structural, not an oversight: exchanges have no licence to redistribute company trademarks |

**⚠ I ALMOST REPORTED A MEASUREMENT OF MY OWN THROTTLING AS A PROPERTY OF THE DATA.** The first
domain probe returned "3% end-to-end" — it resolved 5 stocks then failed on all 25 remaining, the
signature of a rate limit. Verified by hand: HDFC Bank and ICICI Bank resolve fine when queried
slowly, and Wikidata returned "You are making too many requests". A hard cutoff after N successes is
a throttle until proven otherwise.

### Annual-report harvesting (stage35) — works, but not well enough to be the answer

BSE `AnnualReport_New/w?scripcode=X` serves the PDFs; page 1 often carries the logo as its only
raster. PROVEN on Reliance: 169x128 PNG with alpha, no heuristics needed.

**⚠ THE HEADLINE YIELD WAS WRONG AND THE SCRIPT'S OWN WARNING CAUGHT IT.** "67% yielded an image" is
not "67% yielded a logo" — MFML's page 1 is a SCANNED COVER LETTER (one 1205x1718 raster with the
logo baked in), LEMONTREE's cover produced 472 photos. Looking at the images cut the real rate to
**3 clean of 9 (33%)**, or 4 (44%) counting COCHINSHIP, whose logo is correct but WHITE ON
TRANSPARENT — invisible on a light background, and invisible to any check that counts rather than
looks.

**Transport is the other blocker.** ~11.5 MB per PDF measured over 9 companies. Partial fetch does
NOT work: the files are linearized and BSE honours HTTP Range (206), but the cross-reference STREAM
defeats both truncation past /E and head+tail splicing. 2,290 x 11.5 MB is ~26 GB through a host that
throttles this project after ~90 small XML files.

**Verdict: hand-curate the top 250 (large + mid cap = 4.4% + 6.6% of the universe), monogram for the
2,040 small caps.** Same shape as the AMC phase — 52 images covered 84.6% of the catalogue — applied
to a universe that is 89.1% small cap. ⚠ The premise that usage skews to large caps is INFERRED, not
measured; one 13-holding test book is not evidence.
