# Session report — 28–29 August 2026

Everything below is measured against the live database at the end of the session, not carried
forward from earlier notes. Where something is inferred rather than measured, it says so.

**Nothing in this session has been deployed.** All backend and frontend changes are local.

---

## 1. Where the universe stands now

### Coverage

| | count | of 2,290 active |
|---|---:|---:|
| Active stocks | 2,290 | — |
| Instrument catalogue rows (all classes) | 21,312 | — |
| — of which equities | 2,291 | 100% |
| Market-cap tier | 2,290 | 100% |
| Industry | 2,290 | 100% |
| Company description | 2,290 | 100% |
| Sector | 2,289 | 99.96% |
| Revenue model ("how it earns") | 2,288 | 99.9% |
| Business tags | 2,288 | 99.9% |
| Daily prices | 2,291 stocks · 3,157,264 rows | 100% |
| Quarterly results | 2,171 | 94.8% |
| Annual fundamentals | 2,141 | 93.5% |
| Shareholding patterns | 2,058 | 89.9% |
| **Notable findings** | **2,291** | **100%** |

The two profile stragglers are `STCINDIA` (no sector, no revenue model) and `SIGMAADV` (no revenue
model) — both left blank in the workbook itself, not load failures.

### Notable findings — the headline change

Findings went from **897 stocks to every stock in the universe.**

| | before | after |
|---|---:|---:|
| Stocks with findings | 897 | **2,291** |
| Stocks with at least one *fired* finding | 386 | **1,655** |
| Total rows | 12,574 | 48,851 |

What actually fired:

| kind | severity | findings | stocks |
|---|---|---:|---:|
| pattern | green | 966 | 780 |
| pattern | red | 874 | 777 |
| pattern | amber | 468 | 468 |
| red flag | critical | 449 | 414 |
| pattern | low | 121 | 121 |

**Unscored stocks get all 22 filed-data rules and none of the 91 score-dependent ones.** That split
is enforced by the type system, not by convention: filing rules are typed against a context with no
score fields, so a rule reaching for a composite fails to compile.

### BSE data quality

| | rows | covered |
|---|---:|---:|
| BSE annual — balance sheet | 742 | **742 (100%)** |
| BSE annual — interest paid | 742 | 690 |
| BSE annual — cash from investing | 742 | 689 |
| BSE annual — basic EPS | 742 | 669 |
| BSE annual — book value per share | 742 | 647 |
| BSE quarterly — operating profit | 5,222 | 4,967 |
| BSE quarterly — operating margin | 5,222 | 4,949 |

The shortfalls are honest absences, not gaps: 255 quarterly rows whose filings don't define
`expenses` as all-in, and annual rows whose filings carry no cash-flow statement or per-share
figures. The extractor writes what the document contains and leaves the rest null.

### Logos

| | |
|---|---|
| AMC logos in Supabase storage | **52 / 52 (100% of the fund catalogue)** |
| Format split | 41 SVG · 11 PNG |
| Instruments covered | 18,040 of 21,312 (84.6%) |
| Hosting | Self-hosted; no third-party CDN in the path |

---

## 2. What was fixed

### The Abbott India question that started it

*Why is OPM empty in some quarters, and why does the operating-margin line start at Q4'25?* One
cause, two symptoms.

`operating_profit` is a **raw cell** — the NSE parsers read it off the filing and nothing in the
derive layer computes it. The BSE writer's INSERT never named the column, and its own header comment
listed it among the "derived" fields, so nobody looked. Net margin needs only `net_profit / revenue`,
which BSE does write — hence one line spanning the chart and the other starting where a hand-keyed
workbook happened to fill it.

**Fixed:** the writer now writes it as `revenue − expenses`, guarded per row by the identity
`pbt = revenue + other_income − expenses` (holds on 4,959 of 5,222). Rows failing the identity get
null rather than a number computed on a definition their filing doesn't support.

### The BSE lane never ran the derive layer at all

The NSE ingesters spread `...derived.columns` into their write. The BSE writer is an explicit-column
INSERT and the filler is a null-only UPDATE — neither had any notion of derivation. Every row the
lane ever produced carried raw numbers and no ratios.

**Fixed** with `bse-derive-after-write.ts`, wired into both exits of the orchestrator, and made a
**build gate**: `verify-bse-writer-parity.ts` now asserts every table in `BSE_COLUMNS` is wired into
the derive map. Negative-tested — removing one turns it red.

### The BSE annual lane read 24 columns of a ~270-element document

The annual instance carries a full balance sheet and cash-flow statement; the extractor read the P&L
and stopped. 310 stocks have BSE-only annual data, so those pages showed dashes with no NSE row to
fall back on.

**Fixed:** 41 columns added, every tag copied from `parser-indas.ts` (which reads the same taxonomy
for NSE) so the lanes can't drift on what a field is called. 742 rows re-read from their original
filings.

### Ownership split summing past 100%

`retail_pct` and `others_pct` are **one quantity in two columns** — the backend derives a single
residual `public − FII − DII` and writes it to both. Identical on all 25,168 rows. Two components
rendered both, so ABBOTINDIA showed 74.99 + 0.38 + 8.78 + 15.85 + 15.85 = **115.85%**.

**Fixed:** four lanes, labelled "Retail & others" (the residual is every public holder that isn't an
FII or DII — calling it "Retail" would fix the arithmetic while still misdescribing the number). The
warning now sits on the type definition, which is what an author autocompletes against.

### Dead BSE documents recovered — 48 of 48

Stored `xbrl_url`s that BSE no longer serves (verified as genuine 404s). Re-asked BSE's live listing
using the lane's own discovery functions.

**The alternates were the recovery.** A first pass skipped every row whose primary filename matched
the known-dead URL — 29 of 48 — without looking at the alternates the same listing offers. Trying
them took recovery from 6 to 21, and 15 of those 21 came from an alternate. The rest followed across
patient retries. **All 48 now recovered.**

### Other fixes

- **Instrument catalogue synced** 504 → 2,291. The universe expansion never propagated to it.
- **Completed workbook loaded** — 2,064 revenue models and tag sets, 169 sectors, 21 industries.
- **Four new sectors created** — business_services, media_entertainment, paper_products, education.
- **`sectors.stock_count` was stale** (~200 against a 2,290 universe) — recomputed, 24 corrected.
- **Company overview panel** is now one column with two properly-marked section headings.

---

## 3. Mistakes made and caught

Recorded because the pattern matters more than the individual errors.

**I nearly reported my own rate limiting as a property of the data.** A domain-resolution probe
returned "3% end-to-end" — it resolved 5 stocks then failed on all 25 remaining. That's the signature
of a throttle, not of absence. Verified by hand: the "missing" companies resolve fine when queried
slowly. *A hard cutoff after N successes is a throttle until proven otherwise.*

**I reported a 67% yield that was really 33%.** Counting extracted images is not counting logos —
one company's "page 1 image" was a scanned cover letter, another's cover produced 472 photographs.
Only looking at them revealed it. *A count is not a verdict.*

**A queue that re-tried its own failures forever.** Dead URLs sorted to the front of the backfill
queue and were re-fetched every chunk while successful rows drained out behind them — 20–29 of every
90 requests buying nothing, converging on doing no work while still looking busy. Fixed with a
ledger; the effect was immediate (61/90 with 29 failures → 87/90 with 3).

**Running two jobs against one host.** The rediscovery ran beside the backfill and that contention
squeezed BSE's listing endpoint, producing 27 failures I initially mis-diagnosed as "listing doesn't
exist". Sequential would have been faster in wall-clock terms as well as cleaner.

**Unasserted string replacements that silently no-opped.** Twice — a log line and a column header —
because I asserted on functional edits but not cosmetic ones. One of them made a running backfill
report "90" every chunk regardless of progress, which reads as a stalled run.

**A default 5-second Prisma transaction timeout bit three times** — once killing a run on row 1,
once mid-run, once causing 8 failures in the findings backfill. `filing/pass.ts` still carries the
default.

---

## 4. Open items

### Needs a decision from you

| item | why it's yours |
|---|---|
| **`sector_class` for the 4 new sectors** | Quality / Defensive / Commodity / Cyclical / Growth / PSU is an editorial judgement feeding grounding and relational logic. Left NULL rather than invented. |
| **Equity logos** | Five sourcing routes measured, all rejected. Recommendation: hand-curate the top 250, monogram the other 2,040. ⚠ The premise that usage skews to large caps is **inferred, not measured**. |
| **Deployment** | Nothing this session is live — including the ownership fix your users would see. |

### Known-good, waiting

- **Post-deploy verification** — when you say "deployed": `verify-ingester-write-semantics`,
  `verify-provenance-fence`, `verify-leaf-aware-skip --pgs 4`, `verify-bse-writer-parity`, `tsc`,
  and a `last_evaluated_at` drift check.
- **Cron re-spacing** (`daily-nse-news` 09:00, `daily-google-news` 09:30,
  `daily-shareholding-refresh` 09:30) — parked behind deployment.
- **`filing/pass.ts` transaction timeout** — one line; will recur on the next slow patch.
- **77 BSE columns still unfillable**, concentrated in `banking_fundamentals` (31 cols / 21 rows) and
  `nbfc_fundamentals` (36 / 29). Low value by volume, and several are genuine source limitations —
  BSE routes NBFC filings through a generic Ind-AS form with no interest-income breakdown.

---

## 5. Scripts added

| script | purpose |
|---|---|
| `stage24c-sector-industry-load.ts` | Sector + industry from the workbook; creates new sectors |
| `stage27-bse-operating-profit.ts` | Operating profit backfill + re-derive |
| `stage28-rederive-all-bse.ts` | Ungated re-derive across every BSE row |
| `stage29-bse-annual-balancesheet-backfill.ts` | Balance sheet + cash flow onto existing BSE rows |
| `stage30-bse-rediscover-dead-docs.ts` | Re-discover documents whose stored URL is dead |
| `stage31-instrument-catalogue-sync.ts` | Every active stock gets a catalogue row |
| `stage32-amc-logo-worklist.ts` | The 52 fund houses, ordered by coverage |
| `stage33-logo-validate-upload.ts` | Logo quality gate + Supabase upload |
| `stage34-domain-probe.ts` | Domain-resolution hit-rate probe |
| `stage35-annual-report-logo-probe.ts` | Annual-report logo yield probe |
| `audit-bse-column-gaps.ts` · `audit-bse-gap-cause.ts` · `probe-bse-instance-facts.ts` | The audit chain that found the BSE gaps |

Full defect log with reasoning: `_AUTONOMOUS_RUN_LOG.md` (entries B9–B20).
