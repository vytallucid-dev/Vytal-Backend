// ═══════════════════════════════════════════════════════════════
// THE BENCHMARK LEG (Step 18) — which index is this fund measured against, and its return series.
//
// Group-3 (beta / alpha / tracking-error) needs ONE new input: the benchmark's return series,
// paired day-for-day with the fund's. Everything else it needs already exists — the risk-free leg
// (from the Sharpe work) and the streaming fold itself.
//
// ══ THE MAP IS AN AUDITED ALLOW-LIST, NOT A FUZZY MATCHER ══
// Three resolution routes, in strict precedence, each with DIFFERENT confidence — and the route is
// STORED on the row (benchmark_via) so a reader can trust or discount the alpha accordingly:
//
//   1. CATEGORY — the AMFI leaf maps to a standard benchmark (Large Cap Fund → Nifty 100). A fact
//      from the source. Highest confidence.
//   2. NAME     — the fund's own name states the index it tracks ("HDFC Nifty 100 Index Fund").
//      Near-certain: a passive fund that names its index IS benchmarked to it.
//   3. SECTOR   — an audited allow-list over THEMATIC funds only. A defensible editorial call
//      ("Pharma and Healthcare Fund" → Nifty Pharma), never a fuzzy match. Unmapped sectors stay NULL.
//
// ══ WHAT IS DELIBERATELY NOT MAPPED, AND WHY IT MATTERS MORE THAN WHAT IS ══
//
// CREDIT-BEARING DEBT (~2,500 active funds) gets NO BENCHMARK. Its real benchmark is a CRISIL credit
// index (CRISIL Corporate Bond, CRISIL Short Duration Debt, …). NSE does not publish those; they are
// not in index_prices and are not obtainable from our source. The benchmark we DO have is the G-Sec
// curve — and using it would be actively misleading: a corporate-bond fund's excess return over a
// G-Sec index is mostly its CREDIT SPREAD, i.e. compensation for taking default risk. Reporting that
// as ALPHA would dress a risk premium up as manager skill. It is the single most harmful number this
// step could produce, and it would look completely plausible.
//
// So the G-Sec indices are used ONLY where the fund genuinely holds government paper (Gilt,
// Overnight, Long Duration). Everywhere else: NULL, with a reason. A null beats a confident lie.
//
// This refusal is enforced STRUCTURALLY, not by convention: a category in NO_BENCHMARK returns
// immediately and never reaches the name or sector matchers. Without that early return, "Axis
// Banking & PSU Debt Fund" would hit the sector allow-list's /bank/ rule and get benchmarked to the
// NIFTY BANK INDEX — a debt fund measured against bank equities. The gate is not defensive
// paranoia; it is the difference between a null and a catastrophe.
// ═══════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";
import { normaliseCategory } from "./mf-category.js";
import { H, ANCHOR_TOLERANCE_DAYS, type Horizon } from "./mf-accumulator.js";

// ─────────────────────────────────────────────────────────────
// 1. THE CATEGORY MAP
// ─────────────────────────────────────────────────────────────
/** AMFI leaf category → the benchmark index an AMC factsheet actually uses. All present in index_prices. */
export const CATEGORY_BENCHMARK: Record<string, string> = {
  // ── EQUITY — the SEBI/AMC standard. Every one of these indices is in index_prices at 5.0y. ──
  "Large Cap Fund": "Nifty 100",
  "Large & Mid Cap Fund": "NIFTY LargeMidcap 250",
  "Mid Cap Fund": "Nifty Midcap 150",
  "Small Cap Fund": "Nifty Smallcap 250",
  "Multi Cap Fund": "Nifty500 Multicap 50:25:25",
  "Flexi Cap Fund": "Nifty 500",
  ELSS: "Nifty 500",
  "Focused Fund": "Nifty 500",
  "Value Fund": "Nifty 500",
  "Contra Fund": "Nifty 500",
  "Dividend Yield Fund": "Nifty Dividend Opportunities 50",

  // ── HYBRID — the equity leg drives the beta; Nifty 50 is the honest broad proxy. ──
  // (A hybrid's TRUE benchmark is a blended CRISIL index we do not have. Nifty 50 is not that —
  //  but unlike the debt case it is not MISLEADING either: an aggressive-hybrid's beta to the Nifty
  //  is a real, interpretable number (~0.7), not a credit spread wearing a skill label.)
  "Aggressive Hybrid Fund": "Nifty 50",
  "Dynamic Asset Allocation or Balanced Advantage": "Nifty 50",
  "Balanced Hybrid Fund": "Nifty 50",
  "Equity Savings": "Nifty 50",
  "Multi Asset Allocation": "Nifty 50",
  "Arbitrage Fund": "Nifty 50 Arbitrage",

  // ── DEBT — ONLY where the fund genuinely holds GOVERNMENT paper. See the header. ──
  "Overnight Fund": "Nifty 1D Rate Index",
  "Gilt Fund": "Nifty Composite G-sec Index",
  "Gilt Fund with 10 year constant duration": "Nifty 10 yr Benchmark G-Sec",
  "Long Duration Fund": "Nifty 15 yr and above G-Sec Index",
  "Medium to Long Duration Fund": "Nifty 8-13 yr G-Sec",
};

/**
 * Categories that get NO BENCHMARK, EVER — checked BEFORE the name and sector matchers, and that
 * ordering is the whole safety property (see the header: without it a "Banking & PSU Debt Fund"
 * matches /bank/ and gets measured against bank EQUITIES).
 *
 * The value is the reason code that lands in the omissions ledger.
 */
export const NO_BENCHMARK: Record<string, string> = {
  // Credit-bearing debt. Real benchmark = a CRISIL credit index, not published by NSE.
  "Liquid Fund": "credit_benchmark_unavailable",
  "Money Market Fund": "credit_benchmark_unavailable",
  "Ultra Short Duration Fund": "credit_benchmark_unavailable",
  "Low Duration Fund": "credit_benchmark_unavailable",
  "Short Duration Fund": "credit_benchmark_unavailable",
  "Medium Duration Fund": "credit_benchmark_unavailable",
  "Corporate Bond Fund": "credit_benchmark_unavailable",
  "Credit Risk Fund": "credit_benchmark_unavailable",
  "Banking and PSU Fund": "credit_benchmark_unavailable",
  "Dynamic Bond": "credit_benchmark_unavailable",
  "Floater Fund": "credit_benchmark_unavailable",
  "Short Term Fund": "credit_benchmark_unavailable",
  "Ultra Short Term Fund": "credit_benchmark_unavailable",
  Income: "credit_benchmark_unavailable",
  Gilt: "credit_benchmark_unavailable", // the legacy "Gilt" leaf — ambiguous duration, unlike "Gilt Fund"
  // A fund-of-funds' benchmark is its UNDERLYING's. We do not hold that mapping, and a FoF's beta
  // to a broad index would describe the underlying fund, not this one.
  "FoF Domestic": "fund_of_funds_no_direct_benchmark",
  "FoF Overseas": "overseas_index_not_available",
  "Fund of Funds Scheme (Domestic": "fund_of_funds_no_direct_benchmark",
  "Overseas Fund of Funds - Fund of Funds investing overseas": "overseas_index_not_available",
  // Goal-based products with bespoke, AMC-specific blended benchmarks.
  "Retirement Fund": "no_defensible_benchmark",
  "Children’s Fund": "no_defensible_benchmark",
  // Commodity. Benchmarked to the domestic GOLD/SILVER price, not to any equity index we hold.
  "Gold ETF": "commodity_no_equity_benchmark",
};

// ─────────────────────────────────────────────────────────────
// 2. THE SECTOR ALLOW-LIST (thematic funds ONLY)
// ─────────────────────────────────────────────────────────────
/**
 * AMFI ships ONE leaf — "Sectoral/ Thematic" — covering banking, pharma, IT, infra, defence and
 * everything else. So the category cannot resolve these 1,449 funds and the NAME must.
 *
 * EVERY ROW HERE IS A DELIBERATE, VERIFIED JUDGEMENT that the fund genuinely holds that index's
 * constituents — not a fuzzy keyword hit. Two entries were WRONG in the recon's own first draft and
 * are corrected here, because both were plausible and both would have produced a silently-wrong beta:
 *
 *   · "Consumption Fund" → NOT Nifty FMCG. FMCG is a SUBSET of consumption; a consumption fund holds
 *     autos, retail, durables and hotels that Nifty FMCG excludes entirely. → Nifty India Consumption.
 *   · "Banking & Financial Services Fund" → NOT Nifty Bank. These funds hold NBFCs, insurers and
 *     AMCs, which BANK NIFTY EXCLUDES BY CONSTRUCTION. → Nifty Financial Services.
 *
 * Anything not named here stays NULL. An ambiguous theme ("Business Cycle Fund", "Quant Fund",
 * "Conglomerate Fund") has no clean index and gets no benchmark — forcing one would be the same
 * error class as the credit-spread-as-alpha problem: a number that looks right and is not.
 */
export const SECTOR_ALLOWLIST: { pattern: RegExp; index: string; note: string }[] = [
  // Order matters: the FIRST match wins, so the more specific pattern must precede the broader one.
  { pattern: /\bconsumer\s+durable/i, index: "Nifty Consumer Durables", note: "durables specifically, not broad consumption" },
  { pattern: /\bconsumption\b|\bconsumer\b/i, index: "Nifty India Consumption", note: "CORRECTED: not FMCG — consumption is broader (autos, retail, hotels)" },
  { pattern: /\bpharma\b|\bhealthcare\b/i, index: "Nifty Pharma", note: "" },
  { pattern: /\bbank(ing)?\b|\bfinancial\s+services\b/i, index: "Nifty Financial Services", note: "CORRECTED: not Nifty Bank — these hold NBFCs/insurers Bank Nifty excludes" },
  { pattern: /\btechnolog\w*|\binfotech\b|\bdigital\b/i, index: "Nifty IT", note: "" },
  { pattern: /\bautomotive\b|\bauto\b/i, index: "Nifty Auto", note: "" },
  { pattern: /\binfrastructure\b/i, index: "Nifty Infrastructure", note: "" },
  { pattern: /\benergy\b|\bpower\b/i, index: "Nifty Energy", note: "" },
  { pattern: /\bmetal\b/i, index: "Nifty Metal", note: "" },
  { pattern: /\breal\s*(ty|estate)\b/i, index: "Nifty Realty", note: "" },
  { pattern: /\bmedia\b/i, index: "Nifty Media", note: "" },
  { pattern: /\bdefence\b/i, index: "Nifty India Defence", note: "" },
  { pattern: /\bPSU\b|\bPSE\b/i, index: "Nifty PSE", note: "" },
  { pattern: /\bMNC\b/i, index: "Nifty MNC", note: "" },
  { pattern: /\bcommodit\w*/i, index: "Nifty Commodities", note: "" },
  // NOT MAPPED, deliberately: Business Cycle · Quant · Conglomerate · Special Situations ·
  // Manufacturing · Innovation · Transportation · ESG · Exports & Services. No clean index, or an
  // index we do not hold. They stay honest-null.
];

// ─────────────────────────────────────────────────────────────
// 3. THE NAME→INDEX MATCHER
// ─────────────────────────────────────────────────────────────
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * ★ (T-3) AN INDEX-EXTENDING QUALIFIER — a token that, appearing IMMEDIATELY AFTER a matched index name
 * in the fund's own name, means the fund tracks a DIFFERENT, LONGER index than the one that matched.
 *
 * `Sensex` is a substring of `Sensex Next 50`; `LargeMidcap 250` of `LargeMidcap 250 Plus 8-13yr G-Sec`.
 * Longest-match-first (below) fixes this ONLY when the longer index is ALSO in `index_prices` — and it is
 * not for `Sensex Next 30/50` or the `Plus G-Sec` blends, so 13 Sensex-Next funds mapped to bare Sensex
 * and 5 hybrids to bare LargeMidcap 250. Their beta/alpha/tracking-error were computed against the wrong
 * index, and PI4 read the gap between two DIFFERENT indices as a fund's tracking failure — its loudest
 * cases were its wrong ones. So a name match is rejected when what follows it is one of these:
 */
const INDEX_EXTENDING_QUALIFIER =
  /^(NEXT|PLUS|MIDCAP|SMALLCAP|MIDSMALL|LARGEMID|VALUE|MOMENTUM|QUALITY|ALPHA|LOWVOL|EQUAL|TOP|\d)/;

/**
 * LONGEST-MATCH-FIRST, plus a WHOLE-MATCH GUARD (T-3). Neither is an optimisation.
 *
 * norm("Nifty 50") = "NIFTY50", a SUBSTRING of norm("Nifty 500") = "NIFTY500". Matching shortest-first
 * would tag every Nifty 500 fund as tracking the NIFTY 50 — every beta/alpha/tracking-error computed
 * against the wrong index while looking entirely reasonable. Longest-first fixes that WHEN BOTH INDICES
 * ARE HELD. When only the shorter is held (Sensex, but not Sensex Next 50), longest-first cannot help —
 * so a match is also rejected if the fund's name CONTINUES with an index-extending qualifier
 * (`INDEX_EXTENDING_QUALIFIER`). ★ A substring match is trustworthy only when it is a WHOLE match: the
 * schema calls `via='name'` "near-certain", and a substring is near-certain only when no index name is a
 * prefix of another — which Sensex / Sensex-Next and Nifty-50 / Nifty-500 both violate.
 *
 * The honest outcome for a rejected match is NULL (no name benchmark): the fund tracks an index we do not
 * hold, so we say nothing rather than benchmark it against the wrong one. It ships a benchmark the day we
 * load that index's prices — never before.
 */
export function buildNameMatcher(indexNames: string[]): (schemeName: string) => string | null {
  const byLen = indexNames
    .map((name) => ({ name, key: norm(name) }))
    .filter((x) => x.key.length >= 6) // "NIFTY50" is the shortest thing worth matching on
    .sort((a, b) => b.key.length - a.key.length);

  return (schemeName: string) => {
    const k = norm(schemeName);
    for (const { name, key } of byLen) {
      const at = k.indexOf(key);
      if (at < 0) continue;
      // ★ WHOLE-MATCH GUARD: reject if the fund's name extends the matched index into a longer one we did
      //   not match (and, being longest-first, do not hold). The fund names a variant we cannot benchmark.
      const after = k.slice(at + key.length);
      if (INDEX_EXTENDING_QUALIFIER.test(after)) continue;
      return name;
    }
    return null;
  };
}

// ─────────────────────────────────────────────────────────────
// 4. RESOLUTION
// ─────────────────────────────────────────────────────────────
export type BenchmarkVia = "category" | "name" | "sector";

/**
 * `via` and `reason` are BOTH present on both arms (one of them null) so the union narrows cleanly
 * on `index !== null`. A shape where `via` existed only on the success arm would not narrow, and
 * every read site would need a cast — which is how a `via` eventually gets read off a fund that has
 * no benchmark.
 */
export type BenchmarkChoice =
  | { index: string; via: BenchmarkVia; reason: null }
  | { index: null; via: null; reason: string };

/**
 * Which index is this fund measured against? Precedence: category → name → sector → null.
 *
 * THE NO_BENCHMARK GATE COMES FIRST, and everything depends on that. See the header.
 */
export function resolveBenchmark(
  category: string | null,
  schemeName: string | null,
  matchName: (s: string) => string | null,
): BenchmarkChoice {
  const leaf = normaliseCategory(category);
  if (!leaf) return { index: null, via: null, reason: "no_category" };

  // ── THE GATE. A credit-debt / FoF / commodity fund NEVER reaches the matchers below. ──
  const refused = NO_BENCHMARK[leaf];
  if (refused) return { index: null, via: null, reason: refused };

  // 1. CATEGORY — a fact from the source.
  const byCat = CATEGORY_BENCHMARK[leaf];
  if (byCat) return { index: byCat, via: "category", reason: null };

  // 2. NAME — the fund states the index it tracks. Beats the sector guess where both would fire.
  if (schemeName) {
    const byName = matchName(schemeName);
    if (byName) return { index: byName, via: "name", reason: null };
  }

  // 3. SECTOR — thematic funds ONLY. Never applied to a category outside this leaf.
  if (/sector|thematic/i.test(leaf) && schemeName) {
    const hit = SECTOR_ALLOWLIST.find((s) => s.pattern.test(schemeName));
    if (hit) return { index: hit.index, via: "sector", reason: null };
    return { index: null, via: null, reason: "thematic_no_clean_index" };
  }

  return { index: null, via: null, reason: "no_benchmark_for_category" };
}

// ─────────────────────────────────────────────────────────────
// 5. THE SERIES
// ─────────────────────────────────────────────────────────────
/**
 * How stale a benchmark close may be and still be paired with a fund's NAV date.
 *
 * A fund's log return spans (prevDay → day). The benchmark's return MUST span the SAME days. If the
 * benchmark did not print on `day`, we take its last close on or before it — but only if that close
 * is RECENT. Reaching 30 days back for a "close" and calling the result a return over that span
 * would pair a 1-day fund move against a month of index movement. 7 days absorbs a holiday cluster
 * and nothing more.
 */
const MAX_ALIGN_STALENESS_DAYS = 7;

/**
 * The least annualised volatility at which an index is a MARKET-RISK PROXY at all (Step 18).
 *
 * Below this it is CASH. The Nifty 1D Rate Index measures 0.22% annualised — and it is not merely
 * "quiet", it IS the risk-free rate: risk-free.ts uses that exact series as rf. Beta to the
 * risk-free asset is undefined in CAPM by construction, because rf has zero variance by definition.
 *
 * 0.5% is measured, not chosen — it sits an order of magnitude above the 1D-Rate index and an order
 * of magnitude below the quietest REAL market benchmark we use (Nifty 50 Arbitrage, 1.15%, whose
 * betas span a perfectly sane 0.36–0.85).
 */
export const MIN_BENCHMARK_VOL = 0.005;

export class BenchmarkSeries {
  readonly name: string;
  private readonly days: Int32Array;
  private readonly closes: Float64Array;
  /** Pairs REFUSED because the benchmark could not be aligned. Reported, never silently dropped. */
  unpairable = 0;

  /**
   * The index's OWN annualised volatility, over its OWN daily returns. A PROPERTY OF THE INDEX.
   *
   * ══ WHY THIS IS COMPUTED HERE AND NOT IN THE PAIRED FOLD ══
   * The first cut of the cash-benchmark guard measured this inside PairSet — i.e. over the days the
   * FUND happened to report. That is SAMPLING-DEPENDENT, and it leaked: an "ITI Overnight Fund -
   * ANNUAL IDCW" reports so sparsely that the benchmark's multi-day spans between its NAVs looked
   * volatile enough to clear the floor, and it shipped a beta of −4.07 against the overnight rate.
   *
   * But "is this index a market-risk proxy?" is a question about THE INDEX. It cannot have a
   * different answer depending on who is looking at it. So it is answered ONCE, from the index's own
   * series, and every fund measured against it inherits that one answer.
   */
  readonly annualisedVol: number | null;
  /** True ⇒ this index carries no market risk. Beta against it is undefined; tracking error is not. */
  readonly isCashLike: boolean;

  constructor(name: string, points: { day: number; close: number }[]) {
    this.name = name;
    const sorted = [...points].sort((a, b) => a.day - b.day);
    this.days = new Int32Array(sorted.length);
    this.closes = new Float64Array(sorted.length);
    sorted.forEach((p, i) => {
      this.days[i] = p.day;
      this.closes[i] = p.close;
    });

    // Welford over the index's own consecutive log returns — the same numerically-stable form the
    // fund side uses, for the same reason (a near-constant series is exactly where the naive
    // Σr² − nμ² formula cancels catastrophically, and a cash index is as near-constant as it gets).
    let n = 0, mean = 0, m2 = 0;
    for (let i = 1; i < sorted.length; i++) {
      const a = this.closes[i - 1]!;
      const b = this.closes[i]!;
      if (a <= 0 || b <= 0) continue;
      const r = Math.log(b / a);
      n++;
      const d = r - mean;
      mean += d / n;
      m2 += d * (r - mean);
    }
    if (n < 2) {
      this.annualisedVol = null;
      this.isCashLike = true; // no evidence it moves at all → refuse a beta against it
    } else {
      const spanYears = (this.days[this.days.length - 1]! - this.days[0]!) / 365.25;
      const ppy = spanYears > 0 ? n / spanYears : 0; // observations per year, DERIVED — never a hard-coded 252
      this.annualisedVol = ppy > 0 ? Math.sqrt(Math.max(0, m2 / (n - 1))) * Math.sqrt(ppy) : null;
      this.isCashLike = this.annualisedVol === null || this.annualisedVol < MIN_BENCHMARK_VOL;
    }
  }

  get points(): number {
    return this.days.length;
  }
  get firstDay(): number {
    return this.days.length ? this.days[0]! : 0;
  }
  get lastDay(): number {
    return this.days.length ? this.days[this.days.length - 1]! : 0;
  }

  /** Index of the last point on or before `day`, or -1. */
  private idxOnOrBefore(day: number): number {
    let lo = 0, hi = this.days.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.days[mid]! <= day) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /**
   * The benchmark's LOG RETURN over exactly the span the fund's own return covers.
   *
   * ══ THIS IS THE FUNCTION THAT WOULD SILENTLY CORRUPT EVERY BETA IF IT WERE WRONG ══
   * A fund's NAV does not print every day the index does. Its return spans (prevDay → day) — which
   * may be one day, or five across a long weekend, or more for a monthly-reporting fund. Pairing
   * that multi-day fund move against the benchmark's SINGLE-DAY return would compute a covariance
   * between two different things. The beta would come out plausible, stable, and wrong.
   *
   * So: both endpoints are resolved by last-close-on-or-before, and the return is measured across
   * exactly them. Any pair that cannot be honestly aligned is REFUSED and COUNTED — never
   * interpolated, never zero-filled (a zero benchmark return against a real fund move would drag
   * every beta toward zero).
   */
  logReturnBetween(prevDay: number, day: number): number | null {
    if (day <= prevDay) return null;

    const i = this.idxOnOrBefore(prevDay);
    const j = this.idxOnOrBefore(day);

    // The series does not reach back to the start of the fund's span.
    if (i < 0 || j < 0) { this.unpairable++; return null; }
    // The benchmark did not move between the two dates — there is no return to pair. Folding a 0
    // here would bias beta toward 0.
    if (j <= i) { this.unpairable++; return null; }
    // Either endpoint is a STALE close reaching too far back. See MAX_ALIGN_STALENESS_DAYS.
    if (prevDay - this.days[i]! > MAX_ALIGN_STALENESS_DAYS || day - this.days[j]! > MAX_ALIGN_STALENESS_DAYS) {
      this.unpairable++;
      return null;
    }

    const a = this.closes[i]!;
    const b = this.closes[j]!;
    if (a <= 0 || b <= 0) { this.unpairable++; return null; }
    return Math.log(b / a);
  }

  /**
   * The benchmark's ANNUALISED return over exactly the fund's own window (its anchor day → its last
   * NAV day). Alpha's benchmark leg.
   *
   * Measured over the FUND's actual days, not over a nominal horizon — so both legs of the alpha
   * describe the same period. `y1` is a simple return (matching the fold's annualisedReturn), y3/y5
   * are CAGRs, exactly as the fund's own side is computed.
   */
  annualisedReturnBetween(anchorDay: number, lastDay: number, w: "y1" | "y3" | "y5"): number | null {
    const i = this.idxOnOrBefore(anchorDay);
    const j = this.idxOnOrBefore(lastDay);
    if (i < 0 || j < 0 || j <= i) return null;
    if (anchorDay - this.days[i]! > ANCHOR_TOLERANCE_DAYS || lastDay - this.days[j]! > ANCHOR_TOLERANCE_DAYS) return null;

    const a = this.closes[i]!;
    const b = this.closes[j]!;
    if (a <= 0 || b <= 0) return null;

    if (w === "y1") return b / a - 1;
    const years = (this.days[j]! - this.days[i]!) / 365.25;
    if (years <= 0.5) return null;
    return Math.pow(b / a, 1 / years) - 1;
  }

  /**
   * Does this series reach back far enough to cover a horizon, as of `asOfDay`?
   *
   * GATE (ii) OF TWO. Exactly the rule the risk-free leg uses: the series' OLDEST point must be no
   * more than ANCHOR_TOLERANCE_DAYS later than the anchor. A fund with 5 years of NAV and a
   * benchmark with 3 gets a 3Y beta and an honest-null 5Y beta — and the ledger says which leg was
   * missing, so "this fund is too young" is never confused with "this benchmark is too short".
   */
  coversHorizon(asOfDay: number, h: Horizon): boolean {
    if (this.points < 2) return false;
    const target = asOfDay - H[h];
    return this.firstDay - target <= ANCHOR_TOLERANCE_DAYS;
  }

  /** Years of history, for the omission sentence. */
  spanYears(): number {
    return (this.lastDay - this.firstDay) / 365.25;
  }
}

/**
 * Load ONLY the named benchmark series into memory. READ-ONLY on index_prices.
 *
 * COMPUTE-AND-DISCARD HOLDS. These series are pulled in alongside the fund window, folded, and
 * dropped when the run ends — exactly as the risk-free series already is. Nothing is persisted, and
 * index_prices is never written to. ~14 indices × ~1,230 points ≈ 270 KB.
 */
export async function loadBenchmarkSeries(names: string[]): Promise<Map<string, BenchmarkSeries>> {
  const out = new Map<string, BenchmarkSeries>();
  if (names.length === 0) return out;

  const rows = await prisma.indexPrice.findMany({
    where: { indexName: { in: names } },
    orderBy: [{ indexName: "asc" }, { date: "asc" }],
    select: { indexName: true, date: true, close: true },
  });

  const grouped = new Map<string, { day: number; close: number }[]>();
  for (const r of rows) {
    const close = Number(r.close);
    if (!Number.isFinite(close) || close <= 0) continue; // a non-positive index close is not a price
    if (!grouped.has(r.indexName)) grouped.set(r.indexName, []);
    grouped.get(r.indexName)!.push({ day: Math.floor(r.date.getTime() / 86_400_000), close });
  }
  for (const [name, pts] of grouped) {
    if (pts.length >= 2) out.set(name, new BenchmarkSeries(name, pts));
  }
  return out;
}

// (removed) requiredBenchmarkIndices() — a static keep-list from CATEGORY_BENCHMARK +
// SECTOR_ALLOWLIST. It was defined-never-imported: the live fold does NOT use a static
// list; it builds `wantedIdx` from the ACTUAL per-fund resolutions (mf-analytics.ts:302,
// resolveBenchmark over the mutual_fund+etf universe, name route matching the whole
// index_prices table). A keep-list that omits the name route would have mis-guarded the
// index-prices retention prune — exactly the ETF-blind trap the reconcile caught. If a
// keep-list is ever needed again, derive it the way the retention reconcile does.
