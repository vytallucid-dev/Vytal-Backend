// ═══════════════════════════════════════════════════════════════
// MF ANALYTICS (Step 10+11, Option B) — the nightly COMPUTE-AND-DISCARD job.
//
//   stream the universe's 5-year NAV history  →  fold into per-scheme accumulators
//   →  compute Group-1 analytics  →  rank within category  →  upsert ~13,704 small rows
//   →  DISCARD every raw NAV.
//
// RAW NAV NEVER PERSISTS. That is the entire point: a persistent NAV-history table would be
// ~26 M rows / ~2.5 GB (measured), against a 500 MB ceiling with 114 MB of headroom.
//
// THE WRITE BARRIER — and why it is where it is:
//   NOTHING is written until EVERY window has streamed AND passed its shape guard. A failed
//   or empty fetch therefore cannot half-overwrite a good analytics table with empties. This
//   is the Step-9 incident (an empty file that must never be mistaken for "AMFI published
//   nothing") encoded structurally rather than promised in a comment.
//
// HONEST-EMPTY IS A FIRST-CLASS OUTPUT, NOT AN ERROR:
//   A fund without 5 years of history gets ret_5y_cagr = NULL and a REASON in `omissions`.
//   It is never 0, never fabricated, never an IngestionError. A fetch failure IS an error.
//   That line — missing-because-young vs missing-because-broken — is the one Step 9 drew and
//   this job keeps.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { reportIngestionError } from "../shared/ingestion-error.js";
import { streamHistoryWindow, historyWindowUrl } from "./amfi-history-source.js";
import {
  AMFI_HISTORY_HEADER, AMFI_HISTORY_SOURCE, AMFI_HISTORY_CRON,
  HCOL, parseHistDate, parseHistNav, dayToIso, dayToDate,
} from "./amfi-history-parse.js";
import { SchemeAcc, H, type Horizon } from "./mf-accumulator.js";
import { loadRiskFree, type RiskFree } from "./risk-free.js";
import { rankBucketFor, MIN_BUCKET_SIZE, type UnrankedReason } from "./mf-category.js";
import { OmissionCode } from "./mf-omissions.js";
import { applyDistributionHandling, loadPlanMap, loadMfSchemeCodes } from "./mf-distributions.js";
import { splitDivisor } from "./mf-split-adjust.js";
import { applyImplausibilityGuard } from "./mf-implausible.js";
import {
  resolveBenchmark, buildNameMatcher, loadBenchmarkSeries,
  type BenchmarkChoice, type BenchmarkSeries,
} from "./mf-benchmark.js";

const TARGET_TABLE = "MfAnalytics";

/** Window size for one AMFI pull. 90 days ≈ 59 MB ≈ 35 s — the endpoint's comfortable stride. */
const WINDOW_DAYS = 90;
/** How far back the nightly fold reaches: 5 years + slack so the 5Y anchor has its tolerance. */
const LOOKBACK_DAYS = H.y5 + 30;
/** COUNT GUARD floor: schemes reporting per day has never been below ~2,500 since 2009.
 *  500/day is a floor an empty or truncated file cannot possibly clear. */
const MIN_ROWS_PER_DAY = 500;

export interface MfAnalyticsResult {
  ok: boolean;
  asOfDate: string | null;
  windows: number;
  bytes: number;
  rowsFolded: number;
  schemesFolded: number;
  analyticsWritten: number;
  ranked: number;
  faults: number;
  malformedNavs: number;
  outOfOrderRows: number;
  /** Metrics honest-emptied because the computed value could not fit its column (absurd source data). */
  outOfRange: number;
  riskFreeIndex: string | null;
  riskFreeCovers: string[];
  // ── GROUP-3 (Step 18) ──
  /** Distinct benchmark index series actually loaded from index_prices (READ-ONLY). */
  benchmarkIndices: number;
  /** Schemes that resolved to a benchmark we hold. The rest are honest-null, with a reason. */
  benchmarked: number;
  /** Schemes with a real 1Y beta. The two-history gate means this is ≤ benchmarked. */
  betaComputed: number;
  /** Fund returns that could NOT be paired with a benchmark move — surfaced, never hidden. */
  unpairedReturns: number;
  // ── STEP 19: raw AMFI NAV is neither split-adjusted nor total-return. ──
  /** Schemes whose NAV series was rescaled by a REAL, dated NSE split before any metric was folded. */
  splitAdjusted: number;
  /** Individual NAV points divided by a cumulative split factor. */
  navsRescaled: number;
  /** IDCW plans that took their figures from a tier-matched Growth sibling (same fund, same tier). */
  idcwInherited: number;
  /** IDCW plans with NO tier-matched Growth sibling → honest-NULL (idcw_nav_not_total_return). */
  idcwHonestNull: number;
  /** (family, tier) slots where two or more LIVE Growth plans disagreed. We cannot tell which is the
   *  true twin, so we WITHHELD rather than coin-flip. */
  ambiguousTwins: number;
  /** Growth plans passed over as twins because they hold NO NAV in the window — a dormant duplicate
   *  scheme code is not a total-return source. This is the bug that blanked 17 live plans. */
  deadTwinsSkipped: number;
  /** (scheme × window) metric blocks WITHHELD as physically impossible. Never corrected — withheld. */
  withheldImplausible: number;
  /** Distinct schemes with at least one window withheld. */
  withheldImplausibleSchemes: number;
  /** Windows re-fetched after a TRANSPORT failure (ECONNRESET is routine on AMFI's history endpoint,
   *  and far more so on a throttled socket). A retry is safe because a window is folded ATOMICALLY:
   *  a failed attempt has touched no accumulator. */
  windowRetries: number;
  durationMs: number;
  abortReason?: string;
}

/** One catalogue scheme, preloaded. The fold only tracks codes we actually catalogue. */
interface CatRow {
  schemeCode: string;
  asOfDay: number;
  isActive: boolean;
  category: string | null;
  planType: string | null;
  /** Step 18 — read ONLY to resolve a benchmark (an index fund names its index; its category cannot). */
  schemeName: string | null;
  /** Step 18 — the resolved benchmark, or null with the reason it has none. */
  bench: BenchmarkChoice;
}

export interface MfAnalyticsOptions {
  /**
   * WHICH FUND CLASSES TO FOLD. Defaults to BOTH — that is the production behaviour, and Step 13's
   * whole point (an ETF's rich data is NAV-derived, so it comes out of this engine unchanged).
   *
   * The option exists so the byte-identical claim can be PROVEN rather than argued. Step 13
   * promises that admitting `etf` does not perturb a single existing MF row. The only honest test
   * of that is an A/B against IDENTICAL inputs: fold with ['mutual_fund','etf'], fold with
   * ['mutual_fund'], and compare the MF rows' fingerprints. Anything less (comparing against a
   * hash captured hours earlier) cannot distinguish "my change perturbed the MFs" from "AMFI
   * revised a NAV in the meantime" — and those demand opposite responses.
   *
   * See verify-step13-fold-ab.ts.
   */
  assetClasses?: readonly ("mutual_fund" | "etf")[];

  /**
   * HOW MANY DAYS OF HISTORY TO PULL PER REQUEST. Defaults to 90 — production, unchanged.
   *
   * It changes NOTHING about the result: the windows merely partition the same 5-year range, and the
   * fold sees the same rows in the same order either way. It exists for ONE reason — AMFI throttles.
   *
   * A 90-day window is ~59 MB. At a healthy ~1.7 MB/s that is ~35 s, comfortably inside the 600 s
   * per-window cap in amfi-history-source.ts. But AMFI has clamped us to 0.09 MB/s, and at THAT rate
   * the same window needs ~655 s — it blows the cap, the fetch is abandoned, and the fold aborts
   * before writing anything. The data is reachable; the REQUEST is simply too big for the pipe.
   *
   * So a throttled run can pass a smaller window (e.g. 30 days ≈ 20 MB ≈ 220 s at 0.09 MB/s) and
   * complete. It pulls the SAME total bytes — it just stops asking for more than one request can
   * carry. Raising the cap instead would be the wrong lever: the cap exists to catch a starved
   * socket, and a dribbling 90-day window IS a starved socket.
   */
  windowDays?: number;

  /**
   * PER-WINDOW PROGRESS. Called as each window is attempted, finishes, or is retried.
   *
   * The fold is a long, silent, all-or-nothing job — ~21 windows on a healthy endpoint, but ~62 when
   * AMFI throttles us into smaller requests, and then it runs for HOURS. Without this it is a black
   * box: you cannot tell a run that is 80% done from one that has been dead for an hour, and the only
   * honest thing to say to whoever is waiting is "no idea". That is not good enough for a job that
   * can burn four hours and then abort.
   */
  onWindow?: (p: {
    index: number;
    total: number;
    from: string;
    to: string;
    phase: "start" | "done" | "retry";
    bytes?: number;
    ms?: number;
    attempt?: number;
    error?: string;
  }) => void;

  /**
   * GROUP-3 ON/OFF (Step 18). Defaults to TRUE — production always computes it.
   *
   * This exists for EXACTLY the same reason `assetClasses` does, and for the same reason it is not
   * a test-only hack: Step 18 promises that adding beta/alpha/tracking-error does not move a single
   * existing return, volatility, Sharpe or rank. The ONLY honest proof of that is an A/B against
   * IDENTICAL INPUTS — fold with Group-3, fold without, compare the prior columns.
   *
   * Comparing against a fingerprint captured earlier CANNOT prove it, and the codebase already
   * knows why (see the note on assetClasses): a moved hash is indistinguishable between "my change
   * perturbed the fold" and "AMFI revised a NAV / the as-of date advanced since I looked". Those
   * demand opposite responses, and the first run of Step 18 hit exactly that ambiguity.
   *
   * See verify-step18-ab.ts.
   */
  benchmarks?: boolean;
}

export async function runMfAnalytics(opts: MfAnalyticsOptions = {}): Promise<MfAnalyticsResult> {
  const t0 = Date.now();
  const assetClasses = opts.assetClasses ?? (["mutual_fund", "etf"] as const);
  // Interpolated into SQL below — re-check the closed set so a future `as any` cannot open a seam.
  for (const c of assetClasses) {
    if (c !== "mutual_fund" && c !== "etf") throw new Error(`mf-analytics: refusing unknown fund class "${c}"`);
  }
  const classList = assetClasses.map((c) => `'${c}'`).join(", ");
  const res: MfAnalyticsResult = {
    ok: false, asOfDate: null, windows: 0, bytes: 0, rowsFolded: 0, schemesFolded: 0,
    analyticsWritten: 0, ranked: 0, faults: 0,
    malformedNavs: 0, outOfOrderRows: 0, outOfRange: 0,
    riskFreeIndex: null, riskFreeCovers: [], durationMs: 0,
    benchmarkIndices: 0, benchmarked: 0, betaComputed: 0, unpairedReturns: 0,
    splitAdjusted: 0, navsRescaled: 0, idcwInherited: 0, idcwHonestNull: 0,
    ambiguousTwins: 0, deadTwinsSkipped: 0,
    withheldImplausible: 0, withheldImplausibleSchemes: 0, windowRetries: 0,
  };
  const runRef = new Date().toISOString().slice(0, 10) + ":mf_analytics";

  // ── 1. PRELOAD THE CATALOGUE ────────────────────────────────
  // Each scheme's anchors hang off ITS OWN latest NAV date, not off "today". A fund that
  // stopped pricing in 2023 gets its returns measured to 2023 and LABELLED 2023 — rather
  // than to a date it never traded on. That is why asOfDay is per-scheme and preloaded.
  //
  // ── STEP 13: ETFs JOIN THE FOLD. This WHERE clause is the entire wiring. ──
  // An ETF is an AMFI-registered fund with an amfi_scheme_code and a NAV history, so the rich
  // suite this job already computes — returns, vol, Sharpe, Sortino, drawdown, rolling, ranks —
  // is native to it. Admitting the class here means ETFs get all of it by REUSING the engine,
  // not by growing a second one.
  //
  // WHY THIS CANNOT PERTURB A SINGLE EXISTING MF ROW — four independent locks, all measured
  // against the live file (recon-step13-gate0), not assumed:
  //
  //   1. SCHEME CODES ARE DISJOINT. The 337 ETF codes and the 13,879 MF codes overlap in ZERO
  //      places (AMFI gives each scheme one code, and each scheme sits in exactly one section).
  //      mf_analytics is keyed on scheme_code, so every ETF is a pure INSERT. An ETF cannot
  //      collide with, let alone overwrite, an MF's row.
  //
  //   2. RANK LEAVES ARE DISJOINT. The ETF leaves ("Gold ETF", "Other  ETFs", …) collide with
  //      none of the 80 buckets in use, so no ETF can join an MF's ranking pool and shift its
  //      percentile.
  //
  //   3. EVERY ETF IS UNRANKED ANYWAY. All 337 carry plan_type = NULL (an ETF's name never says
  //      "Direct"/"Regular" — there is only one class of unit), so rankBucketFor returns
  //      {bucket: null, reason: plan_type_unknown} for every one of them and they never enter
  //      applyRanks' bucket map at all. A strictly stronger lock than (2).
  //
  //   4. newestDay DOES NOT MOVE. It is a max over the WHOLE catalogue, so adding rows could in
  //      principle only ever push it LATER — which would shift startDay, narrow the streamed
  //      window, and change every MF's nav_points. It does not: ETFs and MFs come from the same
  //      nightly file and price on the same date (both 2026-07-12 at recon). This is the one lock
  //      that is a property of the DATA rather than of the SCHEMA, so Gate 3 ASSERTS it rather
  //      than trusting it — see verify-step13-etf.ts.
  // scheme_name is read for STEP 18 only: an index fund / ETF states the index it tracks in its own
  // name, and AMFI's category cannot ("Index Funds" is one leaf covering all of them). It is used to
  // RESOLVE a benchmark and for nothing else — no metric is derived from a name.
  const cat = await prisma.$queryRawUnsafe<any[]>(`
    SELECT DISTINCT ON (amfi_scheme_code)
           amfi_scheme_code AS code, nav_date, is_active, category, plan_type, scheme_name
    FROM instruments
    WHERE asset_class IN (${classList})
      AND amfi_scheme_code IS NOT NULL AND nav_date IS NOT NULL
    ORDER BY amfi_scheme_code, nav_date DESC`);

  if (cat.length === 0) {
    res.abortReason = "catalogue empty — Step 9 (amfi_nav_daily) has not loaded";
    res.durationMs = Date.now() - t0;
    return res;
  }

  // ── 1b. THE BENCHMARK MAP (Step 18) ─────────────────────────
  // Load the index NAMES first (not their series) so the name-matcher can be built against exactly
  // what we HAVE. A fund whose name states an index we do not hold resolves to null with a reason —
  // it is never matched onto a "close enough" index.
  const withBenchmarks = opts.benchmarks ?? true;
  const idxNames = withBenchmarks
    ? (await prisma.$queryRawUnsafe<any[]>(`SELECT DISTINCT index_name FROM index_prices`)).map((r) => String(r.index_name))
    : [];
  const matchName = buildNameMatcher(idxNames);

  const catalogue = new Map<string, CatRow>();
  let newestDay = -Infinity;
  for (const r of cat) {
    const day = Math.floor(new Date(r.nav_date).getTime() / 86_400_000);
    const schemeName = r.scheme_name ?? null;
    catalogue.set(String(r.code), {
      schemeCode: String(r.code),
      asOfDay: day,
      isActive: Boolean(r.is_active),
      category: r.category ?? null,
      planType: r.plan_type ?? null,
      schemeName,
      bench: withBenchmarks
        ? resolveBenchmark(r.category ?? null, schemeName, matchName)
        : { index: null, via: null, reason: "group3_disabled_for_ab" },
    });
    if (day > newestDay) newestDay = day;
  }
  res.asOfDate = dayToIso(newestDay);

  // ── 2. THE RISK-FREE LEG (gate (ii) of two) ─────────────────
  const rf = await loadRiskFree(newestDay);
  res.riskFreeIndex = rf.indexName;
  res.riskFreeCovers = (["y1", "y3", "y5"] as const).filter((h) => rf.rate[h] !== null);

  // ── 2c. THE BENCHMARK SERIES (Step 18) — READ-ONLY on index_prices. ─────────
  // Load ONLY the indices the map actually resolved to. This is the keep-list the index backfill
  // never had: nothing is fetched, nothing is written, and index_prices is untouched. The series are
  // held in memory (~270 KB), folded, and DISCARDED with the run — the same compute-and-discard
  // contract the raw NAVs and the risk-free series already live under.
  const wantedIdx = [...new Set([...catalogue.values()].map((c) => (c.bench.index)).filter((s): s is string => !!s))];
  const benchSeries = await loadBenchmarkSeries(wantedIdx);
  res.benchmarkIndices = benchSeries.size;
  for (const c of catalogue.values()) {
    if (c.bench.index !== null) {
      if (benchSeries.has(c.bench.index)) res.benchmarked++;
      // Mapped to an index we do not actually hold a usable series for. Downgraded to honest-null
      // HERE rather than left dangling — a benchmark_index we cannot compute against would be a
      // name on the row with no numbers behind it, which reads as "we measured this" and is worse
      // than an explicit null.
      else c.bench = { index: null, via: null, reason: OmissionCode.BENCHMARK_TOO_SHORT };
    }
  }

  // ── 2e. THE REAL SPLIT EVENTS (Step 19) — READ-ONLY on instrument_corporate_events. ─────────
  //
  // AMFI's NAV history is RAW. An ETF that sub-divides its units 1:10 has its published NAV step
  // down 90% overnight, and EVERY metric folded from that series believes the fund lost 90% in a
  // day — not just the return. Measured before this existed: max_drawdown_3y -90.7% (that IS the
  // split day), vol_3y 134%, alpha_3y -60%, while the 1Y figures were clean because the split fell
  // outside that window.
  //
  // ⚠️  THAT IS WHY THE FIX GOES HERE, IN THE SERIES, AND NOT IN THE RETURN'S ANCHOR.
  //     Adjusting the anchor per horizon repairs the return's NUMERATOR and nothing else: vol,
  //     Sortino, drawdown, rolling, beta, alpha and tracking error are all folded from the DAILY
  //     RETURN CHAIN, which would still carry the -90% step. Rescale the series BEFORE it reaches
  //     the accumulator and every one of them comes out right, with no per-horizon arithmetic at all.
  //
  // REAL EVENTS ONLY. Nothing here looks at the shape of the NAV series — a step-detector cannot
  // tell a 1:10 sub-division from a credit fund writing off a defaulted bond, and would erase the
  // second. A fund with no real event is NOT adjusted; it is declined, with a reason.
  // ⚠️  THE BOUNDARY IS `applied_date`, NOT `ex_date` — AND THAT DISTINCTION IS LOAD-BEARING.
  //     NSE's ex-date is when the UNIT changed basis on the exchange. AMFI's NAV is struck by the AMC,
  //     which does not always apply the split that day. Measured across all 63 real splits, in PUBLISHED
  //     NAVs after the ex-date: 11 land on offset 0, 24 on offset 1, 23 on offset 2 (NIFTYBEES), 5 on
  //     offset 3, none beyond. Rescaling on the wrong side of that boundary leaves a NAV on the old
  //     basis between two adjusted ones — turning one honest step into a +900% spike and a -90% crash.
  //     `applied_date` is the RECONCILED day (see instrument-splits.ts).
  //
  //     `applied_date IS NULL` means NO candidate reconciled. Such a split is NOT LOADED AT ALL: the
  //     scheme is absent from this map, no rescale runs, and its impossible windows are withheld by the
  //     guard. An unreconciled event is not a licence to guess — it is a reason to decline.
  const splitsByCode = new Map<string, { appliedDay: number; factor: number }[]>();
  const splitRows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT i.amfi_scheme_code AS code, e.applied_date, e.split_factor
    FROM instrument_corporate_events e
    JOIN instruments i ON i.id = e.instrument_id
    WHERE e.event_type = 'split'
      AND e.split_factor IS NOT NULL AND e.split_factor > 0
      AND e.applied_date IS NOT NULL
      AND i.amfi_scheme_code IS NOT NULL
    ORDER BY i.amfi_scheme_code, e.applied_date`);
  for (const r of splitRows) {
    const code = String(r.code);
    const list = splitsByCode.get(code) ?? [];
    list.push({
      appliedDay: Math.floor(new Date(r.applied_date).getTime() / 86_400_000),
      factor: Number(r.split_factor),
    });
    splitsByCode.set(code, list);
  }
  res.splitAdjusted = splitsByCode.size;

  // ── 3. STREAM THE WINDOWS, OLDEST → NEWEST ──────────────────
  // Chronological order is REQUIRED, not cosmetic: the fold's nested 1Y/3Y/5Y windows and its
  // daily log-return chain both depend on rows arriving in time order.
  const accs = new Map<string, SchemeAcc>();
  const startDay = newestDay - LOOKBACK_DAYS;
  // Same range, same rows, same order — only the REQUEST SIZE changes. See MfAnalyticsOptions.windowDays.
  const windowDays = opts.windowDays ?? WINDOW_DAYS;
  const windows: [number, number][] = [];
  for (let d = startDay; d <= newestDay; d += windowDays) {
    windows.push([d, Math.min(d + windowDays - 1, newestDay)]);
  }

  const malformed: { code: string; raw: string; day: string }[] = [];

  let windowIndex = 0;
  for (const [from, to] of windows) {
    let stream;
    windowIndex++;
    const wt0 = Date.now();
    opts.onWindow?.({
      index: windowIndex, total: windows.length,
      from: dayToIso(from), to: dayToIso(to), phase: "start",
    });

    // ── A WINDOW IS ATOMIC: it is folded only once it has streamed COMPLETELY. ──
    //
    // WHY THIS BUFFER EXISTS (and why it is not a betrayal of compute-and-discard):
    //
    //   Rows used to be pushed into the accumulators AS THEY ARRIVED. That is fine until a window
    //   dies half-way — and AMFI's history endpoint resets connections routinely (see the ECONNRESET
    //   note in amfi-history-source.ts; a throttled 4-minute socket resets far more often than a
    //   healthy 35-second one). The half-streamed rows were already folded, so the window could not
    //   simply be RETRIED: replaying it would re-offer days the accumulator had already seen. push()
    //   would correctly REFUSE them (day <= lastDay) — but it would also count each one as an
    //   OUT-OF-ORDER row, and the fold treats that as a CRITICAL fault meaning "AMFI shipped a
    //   scheme's history in the wrong order". "We retried" and "the source is corrupt" would become
    //   indistinguishable, and they demand opposite responses.
    //
    //   So the only safe move was to ABORT the entire run on the first reset. On a healthy endpoint
    //   (21 windows, ~35 s each) that is a fine trade. On a throttled one (62 windows, ~4 minutes
    //   each) a single routine reset throws away FOUR HOURS of transfer — which is exactly what it
    //   did, twice, before this buffer existed.
    //
    //   Buffering makes the window all-or-nothing: stream it whole, THEN fold it. A failed attempt
    //   leaves the accumulators untouched, so a retry is trivially safe and the order guard keeps
    //   its real meaning.
    //
    //   THE COST IS BOUNDED AND SMALL: one window's catalogued rows (~150 k measured), ~10 MB, freed
    //   the moment the window is folded. It is O(rows-per-window), not O(rows) — the 26 M-row / 2.5 GB
    //   figure that killed a persistent NAV table was about the WHOLE history, not one slice of it.
    //   Peak memory is unchanged in any way that matters, and the raw NAV is still discarded.
    let pending: { code: string; day: number; nav: number }[] = [];

    const MAX_ATTEMPTS = 4;
    try {
      for (let attempt = 1; ; attempt++) {
        // Discard everything from a failed attempt — including its fault tallies, or a retry would
        // count the same malformed cell twice.
        pending = [];
        const malformedNavsAtStart = res.malformedNavs;
        const malformedLenAtStart = malformed.length;

        try {
          stream = await streamHistoryWindow(from, to, (parts) => {
            const code = parts[HCOL.schemeCode]!.trim();
            const c = catalogue.get(code);
            if (!c) return; // not a fund we catalogue (delisted schemes) — ignore, don't allocate

            const nav = parseHistNav(parts[HCOL.nav]!);
            if (nav.kind === "absent") return; // NOT a data point. Never 0. (2016 shipped 4,431 of these.)
            if (nav.kind === "malformed") {
              if (malformed.length < 50) malformed.push({ code, raw: nav.raw, day: parts[HCOL.date]!.trim() });
              res.malformedNavs++;
              return;
            }
            const day = parseHistDate(parts[HCOL.date]!);
            if (Number.isNaN(day)) {
              if (malformed.length < 50) malformed.push({ code, raw: parts[HCOL.date]!.trim(), day: "(unparseable date)" });
              res.malformedNavs++;
              return;
            }
            pending.push({ code, day, nav: nav.nav });
          });
          break; // the window streamed WHOLE — it is now safe to fold.
        } catch (err) {
          res.malformedNavs = malformedNavsAtStart;
          malformed.length = malformedLenAtStart;

          if (attempt < MAX_ATTEMPTS) {
            // A TRANSPORT failure is not evidence ABOUT THE DATA — it is evidence about the socket.
            // The accumulators have not been touched, so re-asking cannot double-count. Back off:
            // an endpoint that just cut us off is not helped by an instant re-ask.
            res.windowRetries++;
            opts.onWindow?.({
              index: windowIndex, total: windows.length,
              from: dayToIso(from), to: dayToIso(to), phase: "retry",
              attempt, error: (err as Error).message,
            });
            await new Promise((r) => setTimeout(r, 20_000 * attempt));
            continue;
          }
          throw err; // exhausted — NOW it is a fault, and an abort.
        }
      }
    } catch (err) {
      // ── FETCH FAILURE = A FAULT, AND AN ABORT. ──
      // Not "AMFI published nothing". Nothing is written; yesterday's analytics stand.
      res.faults++;
      await reportIngestionError({
        source: AMFI_HISTORY_SOURCE, cron: AMFI_HISTORY_CRON, guardType: "shape",
        targetTable: TARGET_TABLE, severity: "critical", resolutionPath: "source_code",
        expected: `a streamable NAV-history window from ${historyWindowUrl(from, to)}`,
        observed: `fetch threw: ${(err as Error).message} (after ${MAX_ATTEMPTS} attempts)`,
        detail:
          "AMFI NAV-history window unreachable after every retry. The run was ABORTED BEFORE ANY " +
          "WRITE — the existing mf_analytics rows are untouched. A failed fetch is a fault, never " +
          "evidence that a fund has no history.",
        runRef,
      });
      res.abortReason = `fetch failed for window ${dayToIso(from)}→${dayToIso(to)}`;
      res.durationMs = Date.now() - t0;
      return res;
    }

    res.windows++;
    res.bytes += stream.bytes;

    // ── SHAPE GUARD — the column header. ──
    // The history endpoint's layout differs from NAVAll.txt's. If AMFI renames a column our
    // indices silently point at the wrong field and we would fold a SCHEME NAME as a NAV.
    if (stream.headerLine !== AMFI_HISTORY_HEADER) {
      res.faults++;
      await reportIngestionError({
        source: AMFI_HISTORY_SOURCE, cron: AMFI_HISTORY_CRON, guardType: "shape",
        targetTable: TARGET_TABLE, severity: "critical", resolutionPath: "source_code",
        expected: AMFI_HISTORY_HEADER,
        observed: stream.headerLine ?? "(no column header in the response)",
        detail:
          "AMFI NAV-history column header changed. Column indices would be wrong → the run was " +
          "ABORTED BEFORE ANY WRITE rather than fold mis-mapped fields into every fund's analytics.",
        runRef,
      });
      res.abortReason = "shape guard (history header)";
      res.durationMs = Date.now() - t0;
      return res;
    }

    // ── COUNT GUARD — an empty / truncated / redirected body. ──
    const spanDays = to - from + 1;
    const minRows = spanDays * MIN_ROWS_PER_DAY;
    if (stream.status !== 200 || stream.dataRows < minRows) {
      res.faults++;
      await reportIngestionError({
        source: AMFI_HISTORY_SOURCE, cron: AMFI_HISTORY_CRON, guardType: "count",
        targetTable: TARGET_TABLE, severity: "critical", resolutionPath: "source_code",
        expected: `HTTP 200 and ≥ ${minRows.toLocaleString()} rows for ${dayToIso(from)}→${dayToIso(to)}`,
        observed: `HTTP ${stream.status}, ${stream.dataRows.toLocaleString()} rows, ${stream.bytes} bytes`,
        detail:
          "AMFI NAV-history window came back empty or truncated. The run was ABORTED BEFORE ANY " +
          "WRITE — an empty fetch must NEVER overwrite good analytics with honest-empties. " +
          "(The Step-9 lesson, enforced structurally: the write barrier sits after every window.)",
        runRef,
      });
      res.abortReason = `count guard (window ${dayToIso(from)}→${dayToIso(to)}: ${stream.dataRows} rows)`;
      res.durationMs = Date.now() - t0;
      return res;
    }

    // ── THE WINDOW STREAMED WHOLE AND PASSED EVERY GUARD. Only NOW is it folded. ──
    //
    // This is the point of the buffer. Nothing above this line has touched an accumulator, so a
    // window that reset mid-stream, arrived truncated, or carried a renamed column has left NO
    // trace — it can be retried, or the run can abort, without a half-folded scheme anywhere.
    for (const row of pending) {
      const c = catalogue.get(row.code)!;
      let a = accs.get(row.code);
      if (!a) {
        // The benchmark series is handed to the accumulator at construction, so the paired fold
        // happens INSIDE push() — one pass, no second traversal, no retained NAV series.
        const bench = c.bench.index !== null ? benchSeries.get(c.bench.index) : undefined;
        a = new SchemeAcc({ asOfDay: c.asOfDay, bench });
        accs.set(row.code, a);
      }

      // ── SPLIT-ADJUST, ON THE WAY IN (Step 19). ──
      // Back-adjust this NAV onto TODAY'S unit basis via the ONE shared rule (mf-split-adjust.ts):
      // divide by the cumulative factor of every real split APPLIED after this NAV was struck
      // (`appliedDay > day`, strictly). BYTE-IDENTICAL BY CONSTRUCTION: a scheme with no reconciled
      // split has an empty divisor (f === 1) and is folded from the identical number as before.
      const splits = splitsByCode.get(row.code);
      let value = row.nav;
      if (splits) {
        const f = splitDivisor(row.day, splits);
        if (f !== 1) {
          value = row.nav / f;
          res.navsRescaled++;
        }
      }

      a.push(row.day, value);
      res.rowsFolded++;
    }
    pending = []; // the raw NAV does not survive the window that carried it. Compute-and-discard holds.

    opts.onWindow?.({
      index: windowIndex, total: windows.length,
      from: dayToIso(from), to: dayToIso(to), phase: "done",
      bytes: stream.bytes, ms: Date.now() - wt0,
    });
  }

  res.schemesFolded = accs.size;

  // ── ORDER GUARD (ruling ①) ──────────────────────────────────
  // Recon saw 0 violations in 535,680 live rows. If AMFI ever reorders, every volatility
  // number would be quietly wrong while looking perfectly healthy — so it is a FAULT, loudly.
  let oo = 0;
  for (const a of accs.values()) oo += a.outOfOrder;
  res.outOfOrderRows = oo;
  if (oo > 0) {
    res.faults++;
    await reportIngestionError({
      source: AMFI_HISTORY_SOURCE, cron: AMFI_HISTORY_CRON, guardType: "continuity",
      targetTable: TARGET_TABLE, severity: "critical", resolutionPath: "source_code",
      expected: "each scheme's NAV rows to arrive strictly ascending by date",
      observed: `${oo} row(s) arrived out of order`,
      detail:
        "AMFI shipped a scheme's history out of date order. Daily log returns (and therefore " +
        "every volatility / Sharpe / Sortino / drawdown number) are only meaningful on an " +
        "ordered series. The offending rows were REFUSED by the fold rather than folded into a lie.",
      runRef,
    });
  }

  // ── MALFORMED NAVs — present but unparseable. A real fault (≠ absent). ──
  if (malformed.length) {
    res.faults++;
    await reportIngestionError({
      source: AMFI_HISTORY_SOURCE, cron: AMFI_HISTORY_CRON, guardType: "validity",
      targetTable: TARGET_TABLE, targetField: "nav", severity: "medium", resolutionPath: "source_code",
      expected: "a numeric NAV in the history feed",
      observed: `${res.malformedNavs} unparseable NAV/date cell(s), e.g. ` +
        malformed.slice(0, 3).map((m) => `scheme ${m.code}: "${m.raw}" (${m.day})`).join("; "),
      detail:
        "AMFI's history feed carried a NAV that is present but not a number. Those rows were " +
        "SKIPPED (not zeroed — a 0 would invent a −100% day and destroy the fund's volatility). " +
        "A blank/'N.A.' NAV is NOT counted here: that is an honest absence, not a fault.",
      runRef,
      recurring: true, // AMFI reships the same junk nightly — don't reopen a fresh row each time
    });
  }

  // ── 4. COMPUTE (in memory; the raw NAV is already gone) ──────
  const computed = computeAll(catalogue, accs, rf, benchSeries);

  // ── 4b. DISTRIBUTIONS (Step 19) — an IDCW plan's NAV is a PRICE series, not a total return. ──
  //
  // Its NAV drops by the payout every time one is made, so a return folded from it understates the
  // fund by exactly what it handed back. Measured against each plan's OWN Growth twin (same fund,
  // same portfolio, same window — so the gap IS the distribution): 2,146 IDCW plans understate
  // ret_3y by >1pp, mean 3.9pp, max 19.3pp.
  //
  // ORDERING IS LOAD-BEARING — this sits AFTER computeAll and BEFORE applyRanks. Rank an IDCW plan
  // on its price return and you have ranked the fund by how much it paid out.
  const distRes = applyDistributionHandling(computed, await loadPlanMap(), await loadMfSchemeCodes());
  res.idcwInherited = distRes.inherited;
  res.idcwHonestNull = distRes.honestNull;
  res.ambiguousTwins = distRes.ambiguousTwins;
  res.deadTwinsSkipped = distRes.deadTwinsSkipped;

  // ── 4c. THE IMPLAUSIBILITY GUARD (Step 19) — it WITHHOLDS; it never corrects. ──
  //
  // Every CORRECTION in Step 19 comes from a real, dated NSE corporate action. But some funds can
  // never have one: an unlisted fund does not trade, so no exchange publishes its splits, and AMFI
  // does not adjust. Their series still steps, and we still must not SHIP the result.
  //
  // So this reads the COMPUTED VALUE and asks one question — "is this physically possible for this
  // kind of fund?" A LIQUID fund showing a -99% drawdown, or a 230% volatility, is not a bad year;
  // it is a broken series, and we can see that WITHOUT claiming to know why. It withholds. It never
  // derives a ratio, never adjusts, never manufactures a corrected number. (mf-implausible.ts.)
  //
  // AFTER the distribution pass, because an IDCW plan that inherited a contaminated Growth twin
  // inherited its impossibility too. BEFORE applyRanks, because a fund must never be RANKED on a
  // number we are about to withhold.
  const classOf = new Map<string, { category: string | null; schemeName: string | null }>();
  for (const c of catalogue.values()) {
    classOf.set(c.schemeCode, { category: c.category, schemeName: c.schemeName });
  }
  const impl = applyImplausibilityGuard(computed, classOf);
  res.withheldImplausible = impl.windows;
  res.withheldImplausibleSchemes = impl.schemes;

  res.outOfRange = computed.reduce(
    (n, c) => n + Object.values(c.omissions).filter((v) => v === OmissionCode.OUT_OF_RANGE).length,
    0,
  );
  // Group-3 tallies — the coverage number the operator asked to see on every run.
  res.betaComputed = computed.filter((c) => c.beta1y !== null).length;
  for (const a of accs.values()) res.unpairedReturns += a.unpaired;

  // ── 5. RANK WITHIN (leaf category, plan_type) ────────────────
  res.ranked = applyRanks(computed);

  // ── 6. WRITE — the barrier is behind us; every window landed. ──
  res.analyticsWritten = await upsertAnalytics(computed);
  res.ok = true;
  res.durationMs = Date.now() - t0;
  return res;
}

// ─────────────────────────────────────────────────────────────
// The computed row, pre-rank.
// ─────────────────────────────────────────────────────────────
export interface Computed {
  schemeCode: string;
  /** The scheme code whose NAV series these metrics were ACTUALLY measured on — the one fact /chart
   *  reads so the picture matches the number. Self for a Growth plan / ETF; the tier-matched Growth
   *  twin's code for an inherited IDCW/Bonus plan; NULL for a distribution decline (no series we
   *  stand behind). Set once, in the fold, exactly where the metric is inherited or declined. */
  seriesSchemeCode: string | null;
  asOfDay: number;
  navPoints: number;
  windowFrom: number | null;
  windowTo: number | null;
  ret: Partial<Record<Horizon, number | null>>;
  vol1y: number | null;
  vol3y: number | null;
  /** ★ (T-4) TRANSIENT — computed for the implausibility guard, NEVER a stored column. `vol_5y` is not
   *  in `mf_analytics` (only Sharpe consumed it), so it was never a field — and the guard was handed a
   *  hardcoded `null` for it, leaving the 5-year window's volatility UNTESTED (`mf-implausible.ts`). That
   *  is how 65 side-pocketed defaulted-debt rows shipped `max_drawdown_5y = 0`: y1/y3 tripped VOL_MAX and
   *  were cleared, y5 saw a drawdown of 0 and, never volatility-tested, shipped it. A value computed but
   *  not stored is still a fact; this field carries it to the guard. The DB write is explicit-positional
   *  (it lists columns and never spreads Computed), so this field does not reach a column. */
  vol5y: number | null;
  sharpe1y: number | null;
  sharpe3y: number | null;
  sharpe5y: number | null;
  sortino1y: number | null;
  sortino3y: number | null;
  maxDD1y: number | null;
  maxDD3y: number | null;
  maxDD5y: number | null;
  roll1yN: number | null;
  roll1yMin: number | null;
  roll1yMax: number | null;
  roll1yAvg: number | null;
  roll1yPctPositive: number | null;
  // ── Group-3 (Step 18) ──
  benchmarkIndex: string | null;
  benchmarkVia: string | null;
  beta1y: number | null;
  beta3y: number | null;
  beta5y: number | null;
  alpha1y: number | null;
  alpha3y: number | null;
  alpha5y: number | null;
  te1y: number | null;
  te3y: number | null;
  te5y: number | null;
  bucket: string | null;
  bucketReason: UnrankedReason | null;
  rankBucketSize: number | null;
  rank1y: number | null;
  rank3y: number | null;
  rank5y: number | null;
  /** The pool size a rank was measured against (funds with a non-null return that horizon). Paired
   *  1:1 with the rank — null ⇔ that rank is null. NOT rankBucketSize (the whole category). */
  rankPool1y: number | null;
  rankPool3y: number | null;
  rankPool5y: number | null;
  pct1y: number | null;
  pct3y: number | null;
  pct5y: number | null;
  omissions: Record<string, string>;
}

const HORIZON_COL: Record<Horizon, string> = {
  m1: "ret_1m", m3: "ret_3m", m6: "ret_6m", y1: "ret_1y", y3: "ret_3y_cagr", y5: "ret_5y_cagr",
};

function computeAll(
  catalogue: Map<string, CatRow>,
  accs: Map<string, SchemeAcc>,
  rf: RiskFree,
  benchmarks: Map<string, BenchmarkSeries>,
): Computed[] {
  const out: Computed[] = [];

  for (const c of catalogue.values()) {
    const a = accs.get(c.schemeCode);
    const om: Record<string, string> = {};

    // A fund with NO NAV in the 5-year window: dead long before it. Every metric is
    // honest-empty, and the row still exists so the absence is EXPLAINED rather than absent.
    if (!a || a.points === 0) {
      const b = rankBucketFor(c);
      out.push({
        schemeCode: c.schemeCode, seriesSchemeCode: c.schemeCode, asOfDay: c.asOfDay, navPoints: 0,
        windowFrom: null, windowTo: null,
        ret: {}, vol1y: null, vol3y: null, vol5y: null,
        sharpe1y: null, sharpe3y: null, sharpe5y: null,
        sortino1y: null, sortino3y: null,
        maxDD1y: null, maxDD3y: null, maxDD5y: null,
        roll1yN: null, roll1yMin: null, roll1yMax: null, roll1yAvg: null, roll1yPctPositive: null,
        // Group-3 too: a fund with no NAV in the window has nothing to correlate with anything.
        // The benchmark it WOULD have used is still recorded — the absence is explained, not blank.
        benchmarkIndex: c.bench.index,
        benchmarkVia: c.bench.via,
        beta1y: null, beta3y: null, beta5y: null,
        alpha1y: null, alpha3y: null, alpha5y: null,
        te1y: null, te3y: null, te5y: null,
        bucket: "bucket" in b ? b.bucket : null,
        bucketReason: "reason" in b ? b.reason : null,
        rankBucketSize: null, rank1y: null, rank3y: null, rank5y: null,
        rankPool1y: null, rankPool3y: null, rankPool5y: null,
        pct1y: null, pct3y: null, pct5y: null,
        // One code covers the whole row. The date it refers to is as_of_date, already a column.
        omissions: { _all: OmissionCode.NO_NAV_IN_WINDOW },
      });
      continue;
    }

    // ── RETURNS ──
    const ret: Partial<Record<Horizon, number | null>> = {};
    for (const h of ["m1", "m3", "m6", "y1"] as Horizon[]) {
      ret[h] = a.simpleReturn(h);
      if (ret[h] === null) om[HORIZON_COL[h]] = insufficient(a, h);
    }
    for (const h of ["y3", "y5"] as Horizon[]) {
      ret[h] = a.cagr(h);
      if (ret[h] === null) om[HORIZON_COL[h]] = insufficient(a, h);
    }

    // ── RISK ──
    const vol1y = a.vol("y1");
    const vol3y = a.vol("y3");
    const vol5y = a.vol("y5"); // computed for sharpe_5y; not a stored column
    if (vol1y === null) om.vol_1y = insufficientVol(a, "y1");
    if (vol3y === null) om.vol_3y = insufficientVol(a, "y3");

    const dd1 = a.downsideDev("y1");
    const dd3 = a.downsideDev("y3");

    // ── SHARPE / SORTINO — TWO INDEPENDENT GATES ──
    // (i) the fund's own NAV depth  AND  (ii) the risk-free series covering that horizon.
    // The two failures are recorded DISTINCTLY, so "this fund is too young" is never confused
    // with "we don't have a risk-free rate that far back".
    const sharpe1y = ratio(a.annualisedReturn("y1"), rf.rate.y1, vol1y, om, "sharpe_1y", rf, "y1");
    const sharpe3y = ratio(a.annualisedReturn("y3"), rf.rate.y3, vol3y, om, "sharpe_3y", rf, "y3");
    const sharpe5y = ratio(a.annualisedReturn("y5"), rf.rate.y5, vol5y, om, "sharpe_5y", rf, "y5");
    const sortino1y = ratio(a.annualisedReturn("y1"), rf.rate.y1, dd1, om, "sortino_1y", rf, "y1");
    const sortino3y = ratio(a.annualisedReturn("y3"), rf.rate.y3, dd3, om, "sortino_3y", rf, "y3");

    // ── DRAWDOWN ──
    const maxDD1y = a.maxDrawdown("y1");
    const maxDD3y = a.maxDrawdown("y3");
    const maxDD5y = a.maxDrawdown("y5");
    if (maxDD1y === null) om.max_drawdown_1y = insufficient(a, "y1");
    if (maxDD3y === null) om.max_drawdown_3y = insufficient(a, "y3");
    if (maxDD5y === null) om.max_drawdown_5y = insufficient(a, "y5");

    // ── ROLLING 1Y ──
    const rollN = a.rollN;
    const hasRoll = rollN > 0;
    if (!hasRoll) om.roll_1y = OmissionCode.INSUFFICIENT_HISTORY;

    // ══ GROUP-3: BETA / ALPHA / TRACKING ERROR (Step 18) ═══════════════════════════════════
    //
    // TWO INDEPENDENT GATES, exactly as Sharpe has: (i) the fund's own depth, (ii) the BENCHMARK's.
    // A fund with 5 years of NAV whose benchmark series only reaches 3 gets a 3Y beta and an
    // honest-null 5Y beta — and the ledger records WHICH leg was short, so "this fund is too young"
    // is never confused with "our index history is too shallow". They demand opposite fixes.
    const G3_COLS = {
      y1: { beta: "beta_1y", alpha: "alpha_1y", te: "tracking_error_1y" },
      y3: { beta: "beta_3y", alpha: "alpha_3y", te: "tracking_error_3y" },
      y5: { beta: "beta_5y", alpha: "alpha_5y", te: "tracking_error_5y" },
    } as const;

    const benchIndex = c.bench.index;
    const benchVia = c.bench.via;
    const series = benchIndex ? benchmarks.get(benchIndex) : undefined;

    const beta: Record<"y1" | "y3" | "y5", number | null> = { y1: null, y3: null, y5: null };
    const alpha: Record<"y1" | "y3" | "y5", number | null> = { y1: null, y3: null, y5: null };
    const te: Record<"y1" | "y3" | "y5", number | null> = { y1: null, y3: null, y5: null };

    if (!benchIndex || !series) {
      // NO BENCHMARK AT ALL. One reason covers all nine metrics — it is a property of the FUND's
      // category, not of any horizon. (The dominant case: ~2,500 credit-bearing debt funds whose
      // real benchmark is a CRISIL index NSE does not publish. See mf-benchmark.ts.)
      const reason = c.bench.reason ?? OmissionCode.NO_BENCHMARK_FOR_CATEGORY;
      om.benchmark = reason;
    } else {
      for (const w of ["y1", "y3", "y5"] as const) {
        const cols = G3_COLS[w];

        // ── GATE (0): IS THIS INDEX A MARKET-RISK PROXY AT ALL? ──
        // A property of the INDEX, decided once from its own series (BenchmarkSeries.isCashLike) —
        // NOT re-derived per fund, which is how a sparse annual-IDCW overnight fund slipped a beta
        // of −4.07 past the first version of this guard. An overnight-rate index carries no market
        // risk; beta = cov/var(≈0) is a division artefact, and the Nifty 1D Rate Index IS literally
        // the risk-free series. Beta to the risk-free asset is undefined by construction.
        //
        // TRACKING ERROR SURVIVES THIS GATE, deliberately. "How closely does this fund follow the
        // overnight rate?" is a real, answerable question; "how sensitive is it to an asset with no
        // risk?" is not.
        if (series.isCashLike) {
          om[cols.beta] = OmissionCode.BENCHMARK_NO_MARKET_RISK;
          om[cols.alpha] = OmissionCode.BENCHMARK_NO_MARKET_RISK;
          te[w] = a.trackingError(w);
          if (te[w] === null) om[cols.te] = OmissionCode.INSUFFICIENT_PAIRED_HISTORY;
          continue;
        }

        // GATE (ii): does OUR series for this benchmark reach back far enough?
        if (!series.coversHorizon(a.asOfDay, w)) {
          om[cols.beta] = OmissionCode.BENCHMARK_TOO_SHORT;
          om[cols.alpha] = OmissionCode.BENCHMARK_TOO_SHORT;
          om[cols.te] = OmissionCode.BENCHMARK_TOO_SHORT;
          continue;
        }

        // GATE (i): the fund's own paired depth. Too few surviving pairs ⇒ nothing to measure.
        const b3 = a.beta(w);
        const t3 = a.trackingError(w);
        if (b3 === null && t3 === null) {
          const code = a.pairPoints(w) > 0 ? OmissionCode.INSUFFICIENT_PAIRED_HISTORY : OmissionCode.INSUFFICIENT_HISTORY;
          om[cols.beta] = code;
          om[cols.alpha] = code;
          om[cols.te] = code;
          continue;
        }

        beta[w] = b3;
        te[w] = t3;
        // A null beta HERE (with pairs present and the benchmark long enough) means the benchmark
        // itself carries no market risk — a cash/overnight-rate index. cov/≈0 is a division
        // artefact, not a measurement. TRACKING ERROR still stands: "how closely does this fund
        // follow the overnight rate" IS a real question, even though "how sensitive is it to an
        // asset with no risk" is not.
        if (b3 === null) om[cols.beta] = OmissionCode.BENCHMARK_NO_MARKET_RISK;
        if (t3 === null) om[cols.te] = OmissionCode.INSUFFICIENT_PAIRED_HISTORY;

        // ── ALPHA (Jensen) = fundRet − (rf + β × (benchRet − rf)) ──
        //
        // The benchmark leg is measured over THE FUND'S OWN WINDOW — its actual anchor day to its
        // actual last NAV day — not over a nominal 365/1095/1826 days. A fund whose anchor lands 12
        // days late (a holiday cluster) has a return over 353 days; comparing that against 365 days
        // of index movement would push the whole difference into "alpha", which is precisely the
        // manager skill we would then be inventing.
        const anchorDay = a.anchorDayOf(w);
        const fundRet = a.annualisedReturn(w);
        const rfRate = rf.rate[w];
        const benchRet = anchorDay !== null ? series.annualisedReturnBetween(anchorDay, a.lastDay, w) : null;

        if (b3 === null) {
          // Alpha is fundRet − (rf + β×(benchRet − rf)). No β ⇒ no α, and the reason must be the
          // REAL one (a cash benchmark), not a misleading "not enough history".
          om[cols.alpha] = OmissionCode.BENCHMARK_NO_MARKET_RISK;
        } else if (fundRet === null || benchRet === null) {
          om[cols.alpha] = OmissionCode.INSUFFICIENT_PAIRED_HISTORY;
        } else if (rfRate === null) {
          // Alpha needs the RISK-FREE leg too — a third gate, and it fails independently of the
          // other two. Reuses the Sharpe machinery's reason so the two stay consistent.
          om[cols.alpha] = rf.indexName ? OmissionCode.RISK_FREE_TOO_SHORT : OmissionCode.RISK_FREE_ABSENT;
        } else {
          alpha[w] = fundRet - (rfRate + b3 * (benchRet - rfRate));
        }
      }
    }

    // ── BUCKET ──
    const b = rankBucketFor(c);
    const bucket = "bucket" in b ? b.bucket : null;
    const bucketReason = "reason" in b ? b.reason : null;
    if (bucketReason) om.rank = unrankedText(bucketReason);

    // ── RANGE GUARD, applied to every stored number. ──
    // Decimal(12,6) → |v| < 1e6 ; Decimal(10,6) → |v| < 1e4.
    const D12 = 1e6;
    const D10 = 1e4;
    for (const h of ["m1", "m3", "m6", "y1", "y3", "y5"] as Horizon[]) {
      ret[h] = fit(ret[h] ?? null, D12, om, HORIZON_COL[h]);
    }

    out.push({
      schemeCode: c.schemeCode,
      seriesSchemeCode: c.schemeCode, // default: a scheme's series is its own — overridden on inherit/decline
      asOfDay: c.asOfDay,
      navPoints: a.points,
      windowFrom: a.firstDay,
      windowTo: a.lastDay,
      ret,
      vol1y: fit(vol1y, D10, om, "vol_1y"),
      vol3y: fit(vol3y, D10, om, "vol_3y"),
      // ★ (T-4) The y5 volatility, carried to the guard. NOT `fit`ted (fit stamps an omission on a NAMED
      // column, and vol_5y is not one) and NOT stored — a plain transient. The guard compares magnitude.
      vol5y,
      sharpe1y: fit(sharpe1y, D10, om, "sharpe_1y"),
      sharpe3y: fit(sharpe3y, D10, om, "sharpe_3y"),
      sharpe5y: fit(sharpe5y, D10, om, "sharpe_5y"),
      sortino1y: fit(sortino1y, D10, om, "sortino_1y"),
      sortino3y: fit(sortino3y, D10, om, "sortino_3y"),
      maxDD1y: fit(maxDD1y, D10, om, "max_drawdown_1y"),
      maxDD3y: fit(maxDD3y, D10, om, "max_drawdown_3y"),
      maxDD5y: fit(maxDD5y, D10, om, "max_drawdown_5y"),
      roll1yN: hasRoll ? rollN : null,
      roll1yMin: hasRoll ? fit(a.rollMin, D12, om, "roll_1y_min") : null,
      roll1yMax: hasRoll ? fit(a.rollMax, D12, om, "roll_1y_max") : null,
      roll1yAvg: hasRoll ? fit(a.rollSum / rollN, D12, om, "roll_1y_avg") : null,
      roll1yPctPositive: hasRoll ? (a.rollPos / rollN) * 100 : null,
      // ── Group-3 (Step 18). The SAME range guard as everything else: a value that cannot fit its
      //    column is WITHHELD with a reason, never rounded into a plausible-looking one. Beta is
      //    (10,6) — a real beta lives around 1, so anything hitting 1e4 is not a beta, it is a bug
      //    in the source data, and we say so rather than storing 9999.999999.
      benchmarkIndex: benchIndex,
      benchmarkVia: benchVia,
      beta1y: fit(beta.y1, D10, om, "beta_1y"),
      beta3y: fit(beta.y3, D10, om, "beta_3y"),
      beta5y: fit(beta.y5, D10, om, "beta_5y"),
      alpha1y: fit(alpha.y1, D12, om, "alpha_1y"), // an alpha is a RETURN → the (12,6) of ret_*
      alpha3y: fit(alpha.y3, D12, om, "alpha_3y"),
      alpha5y: fit(alpha.y5, D12, om, "alpha_5y"),
      te1y: fit(te.y1, D10, om, "tracking_error_1y"),
      te3y: fit(te.y3, D10, om, "tracking_error_3y"),
      te5y: fit(te.y5, D10, om, "tracking_error_5y"),
      bucket, bucketReason,
      rankBucketSize: null, rank1y: null, rank3y: null, rank5y: null,
      rankPool1y: null, rankPool3y: null, rankPool5y: null,
      pct1y: null, pct3y: null, pct5y: null,
      omissions: om,
    });
  }

  return out;
}

/**
 * The smallest annualised dispersion for which a risk-ADJUSTED return means anything.
 *
 * 1e-6 = 0.0001% annualised volatility. Below that a fund's returns are, to floating point,
 * perfectly constant — and Sharpe = excess / 0 is not "infinity", it is UNDEFINED. Overnight
 * and Liquid funds (≈700 schemes) genuinely sit here: they have no return dispersion at all.
 *
 * This guard exists because the Welford fix made it necessary. Before it, a constant series
 * produced a spuriously-null volatility (catastrophic cancellation) which happened to mask the
 * division. With volatility now correctly ≈0, Sharpe exploded to ~1e15 and overflowed
 * Decimal(10,6) — the very first full run failed on it. The honest output is not a clamped
 * number, and certainly not a fabricated one: it is "undefined, and here is why".
 */
const MIN_DISPERSION = 1e-6;

/** Sharpe/Sortino = (annualised return − risk-free) / dispersion. Null if ANY leg is missing,
 *  and the ledger says WHICH leg. */
function ratio(
  annRet: number | null,
  rfRate: number | null,
  dispersion: number | null,
  om: Record<string, string>,
  key: string,
  rf: RiskFree,
  h: "y1" | "y3" | "y5",
): number | null {
  // GATE (ii): the risk-free series must cover this horizon.
  if (rfRate === null) {
    om[key] = rf.indexName ? OmissionCode.RISK_FREE_TOO_SHORT : OmissionCode.RISK_FREE_ABSENT;
    return null;
  }
  // GATE (i): the fund's own NAV depth.
  if (annRet === null || dispersion === null) {
    om[key] = OmissionCode.INSUFFICIENT_HISTORY;
    return null;
  }
  // GATE (iii): dispersion must be non-degenerate, or the ratio is undefined (not infinite).
  if (dispersion < MIN_DISPERSION) {
    om[key] = OmissionCode.ZERO_DISPERSION;
    return null;
  }
  return (annRet - rfRate) / dispersion;
}

/**
 * RANGE GUARD — refuse to write a number the column cannot hold.
 *
 * Decimal(12,6) holds |v| < 1e6; Decimal(10,6) holds |v| < 1e4. A value outside that is not a
 * value we should be rounding to fit — it means the source data produced something absurd (a
 * near-zero anchor NAV, say). Clamping it would publish a fabricated number; letting it through
 * overflows the INSERT and takes the whole run down. So it is honest-emptied, with the reason,
 * and counted as a fault so it surfaces rather than vanishing.
 */
function fit(
  v: number | null,
  limit: number,
  om: Record<string, string>,
  key: string,
): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  if (Math.abs(v) >= limit) {
    om[key] = OmissionCode.OUT_OF_RANGE;
    return null;
  }
  return v;
}

/** The reason a horizon is empty. The NUMBERS a human wants (nav_points, window_from) are
 *  already columns on the row — mf-omissions.ts composes the sentence from them at read time. */
function insufficient(_a: SchemeAcc, _h: Horizon): string {
  return OmissionCode.INSUFFICIENT_HISTORY;
}

function insufficientVol(_a: SchemeAcc, _w: "y1" | "y3"): string {
  return OmissionCode.INSUFFICIENT_HISTORY;
}

const UNRANKED_CODE: Record<UnrankedReason, string> = {
  close_ended_or_interval: OmissionCode.NOT_RANKED_CLOSE_ENDED,
  dormant: OmissionCode.NOT_RANKED_DORMANT,
  plan_type_unknown: OmissionCode.NOT_RANKED_PLAN_UNKNOWN,
  no_category: OmissionCode.NOT_RANKED_NO_CATEGORY,
  bucket_too_small: OmissionCode.NOT_RANKED_BUCKET_TOO_SMALL,
};

function unrankedText(r: UnrankedReason): string {
  return UNRANKED_CODE[r];
}

// ─────────────────────────────────────────────────────────────
// RANKING — within (leaf category, plan_type). 1 = best; percentile 100 = best.
//
// Each horizon ranks against the funds that HAVE that horizon. A 5-year-old fund is not
// penalised for a 2-year-old peer's missing 5Y number, and the 2-year-old is not handed a
// fabricated one.
// ─────────────────────────────────────────────────────────────
function applyRanks(rows: Computed[]): number {
  const buckets = new Map<string, Computed[]>();
  for (const r of rows) {
    if (!r.bucket) continue;
    const list = buckets.get(r.bucket);
    if (list) list.push(r);
    else buckets.set(r.bucket, [r]);
  }

  let ranked = 0;
  for (const [bucket, members] of buckets) {
    if (members.length < MIN_BUCKET_SIZE) {
      // Too small to rank in. Honest-empty, with the reason — never a fabricated 50th percentile.
      for (const m of members) {
        m.bucket = null;
        m.bucketReason = "bucket_too_small";
        m.rankBucketSize = members.length; // kept, so the read layer can say "only N comparable funds"
        m.omissions.rank = OmissionCode.NOT_RANKED_BUCKET_TOO_SMALL;
      }
      continue;
    }

    for (const m of members) m.rankBucketSize = members.length;

    for (const [h, rankKey, pctKey, poolKey, retKey, omitKey] of [
      ["y1", "rank1y", "pct1y", "rankPool1y", "y1", "rank_1y"],
      ["y3", "rank3y", "pct3y", "rankPool3y", "y3", "rank_3y"],
      ["y5", "rank5y", "pct5y", "rankPool5y", "y5", "rank_5y"],
    ] as const) {
      const pool = members.filter((m) => m.ret[retKey] != null);
      if (pool.length < MIN_BUCKET_SIZE) {
        // ★ (T-5) `omitKey` is the COLUMN name (`rank_5y`), NOT the internal horizon token. This wrote
        // `rank_${h}` → `rank_y5`, a key matching NO column, so `omissionFor(row, "rank_5y")` fell through
        // and 20 funds carried a null rank_5y with no reachable reason. The key-side gate
        // (`verify-t5-omission-keys.ts`) now fails the build on any omission key that is not a column.
        for (const m of members) m.omissions[omitKey] = OmissionCode.NOT_RANKED_BUCKET_TOO_SMALL;
        continue;
      }
      pool.sort((x, y) => (y.ret[retKey] as number) - (x.ret[retKey] as number)); // best first
      // rankPool = the denominator the rank is measured against — the SAME pool.length, the SAME
      // moment. Set only on pool members, so it is null exactly where the rank is null.
      pool.forEach((m, i) => {
        (m as any)[rankKey] = i + 1;
        (m as any)[poolKey] = pool.length;
        (m as any)[pctKey] = pool.length > 1 ? ((pool.length - 1 - i) / (pool.length - 1)) * 100 : 100;
      });
      ranked += pool.length;
    }
  }
  return ranked;
}

// ─────────────────────────────────────────────────────────────
// WRITE — bulk upsert, chunked. Every column except the PK is refreshed every night.
//
// (This block used to carry a long warning about NOT writing earliest_nav / earliest_nav_date —
// anchors the one-time inception walk established, which a nightly write would have NULLed. Those
// columns are gone: they existed only to feed ret_since_earliest_cagr, and that metric was removed
// because AMFI's raw NAV cannot support it. Splits and IDCW payouts corrupt a since-earliest span
// far worse than a 5-year one — the older the anchor, the more corporate actions sit between it and
// today — and unlike the 1Y/3Y/5Y windows there is no bounded history we can honestly reconstruct.)
// ─────────────────────────────────────────────────────────────
const COLS = [
  "scheme_code", "series_scheme_code", "as_of_date", "nav_points", "window_from", "window_to",
  "ret_1m", "ret_3m", "ret_6m", "ret_1y", "ret_3y_cagr", "ret_5y_cagr",
  "vol_1y", "vol_3y",
  "sharpe_1y", "sharpe_3y", "sharpe_5y",
  "sortino_1y", "sortino_3y",
  "max_drawdown_1y", "max_drawdown_3y", "max_drawdown_5y",
  "roll_1y_n", "roll_1y_min", "roll_1y_max", "roll_1y_avg", "roll_1y_pct_positive",
  "rank_bucket", "rank_bucket_size",
  "rank_1y", "rank_3y", "rank_5y",
  "rank_pool_1y", "rank_pool_3y", "rank_pool_5y",
  "pct_1y", "pct_3y", "pct_5y",
  // ── Group-3 (Step 18) ──
  "benchmark_index", "benchmark_via",
  "beta_1y", "beta_3y", "beta_5y",
  "alpha_1y", "alpha_3y", "alpha_5y",
  "tracking_error_1y", "tracking_error_3y", "tracking_error_5y",
  "omissions",
] as const;

/** Per-column cast, so Postgres never has to guess a type from a bound string. */
const CASTS: Record<string, string> = {
  as_of_date: "::date", window_from: "::date", window_to: "::date",
  nav_points: "::int", roll_1y_n: "::int", rank_bucket_size: "::int",
  rank_1y: "::int", rank_3y: "::int", rank_5y: "::int",
  rank_pool_1y: "::int", rank_pool_3y: "::int", rank_pool_5y: "::int",
  omissions: "::jsonb",
};
const DECIMALS = new Set([
  "ret_1m", "ret_3m", "ret_6m", "ret_1y", "ret_3y_cagr", "ret_5y_cagr",
  "vol_1y", "vol_3y", "sharpe_1y", "sharpe_3y", "sharpe_5y", "sortino_1y", "sortino_3y",
  "max_drawdown_1y", "max_drawdown_3y", "max_drawdown_5y",
  "roll_1y_min", "roll_1y_max", "roll_1y_avg", "roll_1y_pct_positive",
  // Group-3 (Step 18). benchmark_index / benchmark_via are TEXT and deliberately absent here.
  "beta_1y", "beta_3y", "beta_5y",
  "alpha_1y", "alpha_3y", "alpha_5y",
  "tracking_error_1y", "tracking_error_3y", "tracking_error_5y",
]);

async function upsertAnalytics(rows: Computed[]): Promise<number> {
  // 46 params/row → 250 rows = 11,500 params, still comfortably under Postgres' 65,535 limit.
  const N = COLS.length;
  const CHUNK = 250;
  let written = 0;

  // Every column EXCEPT the PK is refreshed.
  const setList = COLS.filter((c) => c !== "scheme_code")
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples: string[] = [];

    chunk.forEach((r, n) => {
      const b = n * N;
      tuples.push(
        "(" +
          COLS.map((c, k) => `$${b + k + 1}${CASTS[c] ?? (DECIMALS.has(c) ? "::decimal" : "")}`).join(",") +
          ")",
      );
      values.push(
        r.schemeCode,
        r.seriesSchemeCode,
        dayToDate(r.asOfDay),
        r.navPoints,
        r.windowFrom != null ? dayToDate(r.windowFrom) : null,
        r.windowTo != null ? dayToDate(r.windowTo) : null,
        num(r.ret.m1), num(r.ret.m3), num(r.ret.m6),
        num(r.ret.y1), num(r.ret.y3), num(r.ret.y5),
        num(r.vol1y), num(r.vol3y),
        num(r.sharpe1y), num(r.sharpe3y), num(r.sharpe5y),
        num(r.sortino1y), num(r.sortino3y),
        num(r.maxDD1y), num(r.maxDD3y), num(r.maxDD5y),
        r.roll1yN,
        num(r.roll1yMin), num(r.roll1yMax), num(r.roll1yAvg), num(r.roll1yPctPositive),
        r.bucket,
        r.rankBucketSize,
        r.rank1y, r.rank3y, r.rank5y,
        r.rankPool1y, r.rankPool3y, r.rankPool5y,
        num(r.pct1y), num(r.pct3y), num(r.pct5y),
        // ── Group-3 (Step 18). ORDER MUST MATCH COLS EXACTLY — these are positional. ──
        r.benchmarkIndex, r.benchmarkVia,
        num(r.beta1y), num(r.beta3y), num(r.beta5y),
        num(r.alpha1y), num(r.alpha3y), num(r.alpha5y),
        num(r.te1y), num(r.te3y), num(r.te5y),
        JSON.stringify(r.omissions),
      );
    });

    const sql = `
      INSERT INTO mf_analytics (${COLS.join(",")}, computed_at)
      VALUES ${tuples.map((t) => t.slice(0, -1) + ",now())").join(",")}
      ON CONFLICT (scheme_code) DO UPDATE SET ${setList}, computed_at = now()
      RETURNING 1 AS ok`;

    const out = await prisma.$queryRawUnsafe<{ ok: number }[]>(sql, ...values);
    written += out.length;
  }

  return written;
}

/** Decimal columns take a string (never a float) so no binary drift reaches Postgres. */
function num(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return v.toFixed(6);
}
