// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVER #1 — SYMBOL RESOLUTION. Architecture spec §3.6: "build first, blocks everything".
//
// ── ★ WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
// There was no server-side equity search. `chat/tools/search-stocks.ts:5-7` records the reason: the
// app's own picker fetches the WHOLE UNIVERSE once and filters client-side, so the chat tool filtered
// the same whole-universe read rather than add a query. That was tolerable at 504 stocks. Measured
// 2026-08-29: 2,291 stocks, 2,290 active. It is a scaling defect now, and independently it is the
// router's precondition — every composition begins with a resolved subject.
//
// ── ★ THE ONE RULE THAT SHAPES THE RETURN: AMBIGUITY IS NOT A RANKING PROBLEM ─────────────────────
// "hdfc" matches three companies — a bank, an AMC and a life insurer. Measured, they score IDENTICALLY
// (0.90 each, symbol-prefix), because they are equally good answers to what was actually typed. A
// resolver that returns one of them has not resolved anything; it has guessed, and the reader cannot
// tell that it guessed. So `verdict` is part of the DATA, not a confidence log line, and `ambiguous`
// is a first-class outcome a composition must handle rather than an error it may ignore.
//
// ── ⚠ WHAT THIS DOES NOT DO ───────────────────────────────────────────────────────────────────────
// It does not decide. On `ambiguous` the caller asks the reader. Silently taking candidates[0] here
// would move the guess one layer down and make it invisible to the layer that could have caught it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { aliasIsinFor } from "./symbol-aliases.js";
import {
  absent, resolved, NO_DEPTH, NO_SUBJECT,
  type Coverage, type DepthProfile, type QueryCoverage, type Resolved, type Source,
  type StockCoverage,
} from "./contract.js";

/** How a candidate earned its place. Reported so a caller can explain the match rather than assert it. */
export type MatchKind =
  | "symbol_exact" | "name_exact" | "symbol_prefix" | "name_prefix" | "name_word" | "fuzzy"
  // ★ The query is a RETIRED symbol this security used to trade under (symbol-aliases.ts). Decisive,
  //   like symbol_exact, but deliberately ranked just below it — see the 0.995 branch in RANK_SQL.
  | "alias";

export interface SymbolCandidate {
  readonly stockId: string;
  readonly symbol: string;
  readonly name: string;
  readonly industryType: string;
  /** 0-1. Comparable WITHIN one query's results only - it is not a probability. */
  readonly score: number;
  readonly matchedOn: MatchKind;
  /** This candidate's own tier, asOf and depth. Per-stock, never inherited from the query. */
  /** ★ ALWAYS `StockCoverage` — resolver #1 searches the stock universe. A non-equity subject is
   *  resolved by `resolveSubject` (src/resolve/subject.ts), which owns the other two shapes. */
  readonly coverage: StockCoverage;
}

/**
 * `exact`      one candidate is decisively best - safe to proceed without asking
 * `ambiguous`  two or more are within AMBIGUITY_MARGIN of the top - the caller must disambiguate
 * `weak`       the best match is below CONFIDENCE_FLOOR - probably a misspelling; offer, do not assume
 */
export type ResolutionVerdict = "exact" | "ambiguous" | "weak";

export interface SymbolResolution {
  readonly query: string;
  readonly verdict: ResolutionVerdict;
  readonly candidates: readonly SymbolCandidate[];
}

// ── ★ THE THRESHOLDS, AND WHY THEY ARE THESE NUMBERS ──────────────────────────────────────────────
// Calibrated against the live book, not chosen. See tmp/stage1/proto-rank.ts for the run.
//   MIN_SCORE          0.25  - "relaince" (a real misspelling of RELIANCE) lands at 0.30. Below 0.25
//                              the tail is other companies sharing three letters, which is noise.
//   AMBIGUITY_MARGIN   0.05  - the three HDFC companies tie exactly; "tata motors" ties two at 0.86.
//                              A margin rather than equality, so a hairsbreadth win is not treated
//                              as a decision.
//   CONFIDENCE_FLOOR   0.55  - above this a match is a prefix or better. Below it we are in trigram
//                              territory, where the top hit is a guess worth offering, not acting on.
const MIN_SCORE = 0.25;
const AMBIGUITY_MARGIN = 0.05;
const CONFIDENCE_FLOOR = 0.55;
const DEFAULT_LIMIT = 8;

/** The five industry-specific quarterly tables, unioned. ★ NOT `quarterly_results` ALONE - that table
 *  holds non-financials only. Reading it by itself reports HDFCBANK as tier 0 while it carries 14
 *  score snapshots, which is how this was caught. */
const QUARTERLY_UNION = `
  SELECT stock_id, fiscal_year || quarter AS pk, report_date FROM quarterly_results
  UNION ALL SELECT stock_id, fiscal_year || quarter, report_date FROM banking_quarterly_results
  UNION ALL SELECT stock_id, fiscal_year || quarter, report_date FROM nbfc_quarterly_results
  UNION ALL SELECT stock_id, fiscal_year || quarter, report_date FROM life_insurance_quarterly_results
  UNION ALL SELECT stock_id, fiscal_year || quarter, report_date FROM general_insurance_quarterly_results`;

// ── THE RANK. One statement: score, then tier/depth/asOf for the survivors only. ──────────────────
//
// ⚠ THE IN-FORCE REDUCTION IS `scoring-read.service.ts#inForceByPeriod`'S RULE, NOT A NEW ONE:
// MAX(version) within each (stock, period), tie-broken by latest as_of_date. That function is
// per-stock and would be N+1 across a candidate list, so the rule is expressed here as one batched
// DISTINCT ON. If that rule ever changes, these two must change together - there is no third home.
const RANK_SQL = `
WITH inp AS (SELECT lower(btrim($1)) AS q),
cand AS (
  SELECT st.id, st.symbol, st.name, st."industryType" AS industry_type,
    GREATEST(
      CASE WHEN lower(st.symbol) = (SELECT q FROM inp) THEN 1.00 ELSE 0 END,
      -- ★ RETIRED SYMBOL. 0.995 is deliberate and sits BETWEEN symbol_exact (1.00) and name_exact
      --   (0.99): decisive enough to beat every fuzzy hit outright, but never able to outrank a
      --   symbol that is LIVE today. If a retired symbol is ever reissued to a different company,
      --   the living company wins without anyone having to notice the collision.
      CASE WHEN $3::text IS NOT NULL AND st.isin = $3::text THEN 0.995 ELSE 0 END,
      CASE WHEN lower(st.name)   = (SELECT q FROM inp) THEN 0.99 ELSE 0 END,
      CASE WHEN lower(st.symbol) LIKE (SELECT q FROM inp) || '%' THEN 0.90 ELSE 0 END,
      CASE WHEN lower(st.name)   LIKE (SELECT q FROM inp) || '%' THEN 0.86 ELSE 0 END,
      CASE WHEN lower(st.name)   LIKE '% ' || (SELECT q FROM inp) || '%' THEN 0.80 ELSE 0 END,
      similarity(lower(st.symbol), (SELECT q FROM inp)) * 0.78,
      similarity(lower(st.name),   (SELECT q FROM inp)) * 0.75
    ) AS score,
    CASE
      WHEN lower(st.symbol) = (SELECT q FROM inp) THEN 'symbol_exact'
      WHEN $3::text IS NOT NULL AND st.isin = $3::text THEN 'alias'
      WHEN lower(st.name)   = (SELECT q FROM inp) THEN 'name_exact'
      WHEN lower(st.symbol) LIKE (SELECT q FROM inp) || '%' THEN 'symbol_prefix'
      WHEN lower(st.name)   LIKE (SELECT q FROM inp) || '%' THEN 'name_prefix'
      WHEN lower(st.name)   LIKE '% ' || (SELECT q FROM inp) || '%' THEN 'name_word'
      ELSE 'fuzzy'
    END AS matched_on
  FROM stocks st
  WHERE st.is_active
),
top AS (
  SELECT * FROM cand WHERE score >= ${MIN_SCORE} ORDER BY score DESC, symbol ASC LIMIT $2
),
q AS (
  SELECT stock_id, COUNT(DISTINCT pk)::int AS quarters, MAX(report_date) AS last_report
  FROM (${QUARTERLY_UNION}) u
  WHERE stock_id IN (SELECT id FROM top)
  GROUP BY stock_id
),
inforce AS (
  SELECT DISTINCT ON (stock_id, period_key) stock_id, period_key, as_of_date
  FROM score_snapshots
  WHERE snapshot_type = 'quarterly' AND stock_id IN (SELECT id FROM top)
  ORDER BY stock_id, period_key, version DESC, as_of_date DESC
),
s AS (
  SELECT stock_id, COUNT(*)::int AS snapshots, MAX(as_of_date) AS as_of
  FROM inforce GROUP BY stock_id
)
SELECT top.id, top.symbol, top.name, top.industry_type, top.matched_on,
       top.score::float8 AS score,
       COALESCE(q.quarters, 0) AS quarters,
       s.snapshots AS snapshots,
       s.as_of AS snapshot_as_of,
       q.last_report AS last_report
FROM top
LEFT JOIN q ON q.stock_id = top.id
LEFT JOIN s ON s.stock_id = top.id
ORDER BY top.score DESC, top.symbol ASC`;

interface RankRow {
  id: string; symbol: string; name: string; industry_type: string; matched_on: MatchKind;
  score: number; quarters: number; snapshots: number | null;
  snapshot_as_of: Date | null; last_report: Date | null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Resolve user-typed text to ranked candidates.
 *
 * Never throws on no-match: an empty universe hit is `ok:false` with `not_in_universe`, which is a
 * different fact from `not_ingested` (we know the company, we hold no results for it), and both are
 * different from a low-confidence hit, which is `ok:true` with `verdict:"weak"`.
 *
 * @param depthFloor  minimum quarters a candidate must hold to be RETURNED. Declared by compositions
 *                    doing a trend or a cross-sectional comparison (§3.3). Candidates dropped by it
 *                    are counted in `coverage.dropped` and `depth.excludedForDepth` - never silently.
 */
export async function resolveSymbol(
  query: string,
  opts: { limit?: number; depthFloor?: number } = {},
): Promise<Resolved<SymbolResolution>> {
  const q = (query ?? "").trim();
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_LIMIT, 25));
  const floor = opts.depthFloor ?? null;

  const universeSearched = await prisma.stock.count({ where: { isActive: true } });
  const q0 = (excludedForDepth: number, dropped: QueryCoverage["dropped"]): QueryCoverage => ({
    universeSearched, depthFloor: floor, excludedForDepth, dropped,
  });

  // An empty query is not a miss over the universe — it is a caller defect expressed as a miss.
  if (q.length === 0) {
    return absent("not_in_universe", {
      subject: null,
      query: q0(0, [{ filter: "query", dropped: universeSearched, why: "empty query — nothing was searched for" }]),
    });
  }

  // ★ RESOLVED BEFORE THE QUERY, NOT AFTER THE MISS. Consulting the registry only when the ranking
  //   comes back empty would not have helped here: "LTIM" does not come back empty, it comes back
  //   with LARSEN & TOUBRO at 0.26. A retired symbol has to be able to WIN, not to break a tie.
  const aliasIsin = aliasIsinFor(q);
  const rows = (await prisma.$queryRawUnsafe(RANK_SQL, q, limit, aliasIsin)) as RankRow[];

  if (rows.length === 0) {
    // ★ THE HONEST MISS. This says the name is not in OUR COVERAGE. It does not say the company does
    // not exist, and no caller may upgrade it to that — see search-stocks.ts's boundary note.
    return absent("not_in_universe", { subject: null, query: q0(0, []) });
  }

  const kept: SymbolCandidate[] = [];
  let excludedForDepth = 0;
  for (const r of rows) {
    const tier: 0 | 1 | 2 = r.snapshots && r.snapshots > 0 ? 2 : r.quarters > 0 ? 1 : 0;
    if (floor !== null && r.quarters < floor) { excludedForDepth++; continue; }
    // Tier 2 reads its in-force snapshot date; tier 1 has no snapshot, so the honest as-of is the
    // latest RESULT we hold. Tier 0 has neither, and gets null rather than a fabricated date.
    const asOf = tier === 2 ? iso(r.snapshot_as_of) : tier === 1 ? iso(r.last_report) : null;
    kept.push({
      stockId: r.id, symbol: r.symbol, name: r.name, industryType: r.industry_type,
      score: Math.round(r.score * 10000) / 10000, matchedOn: r.matched_on,
      coverage: {
        kind: "stock", tier, asOf, window: null,
        // null, not 0 — "unscored" and "scored with no periods" are different facts (§3.1).
        depth: { quarters: r.quarters, snapshots: r.snapshots ?? null },
      },
    });
  }

  const dropped: QueryCoverage["dropped"] = excludedForDepth
    ? [{ filter: "depthFloor", dropped: excludedForDepth, why: `fewer than ${floor} quarters held` }]
    : [];
  const queryCov = q0(excludedForDepth, dropped);

  if (kept.length === 0) {
    return absent("insufficient_quarters", { subject: null, query: queryCov });
  }

  const top = kept[0]!;
  const runnerUp = kept[1];
  // ★ CONFIDENCE IS TESTED BEFORE AMBIGUITY, AND THE ORDER IS THE RULING. Both can be true at once:
  // "relaince" returns RELIANCE at 0.30 over RELAXO at 0.26 — a tie AND a bad match. Reporting that
  // as `ambiguous` would tell the caller "two good answers, pick one", when the honest headline is
  // that neither is trustworthy. `weak` answers "may I act on any of these?"; `ambiguous` answers
  // "which one?" — and there is no point asking the second question while the first answer is no.
  // A `weak` caller still receives every candidate and may still offer them; it may not assume one.
  const verdict: ResolutionVerdict =
    top.score < CONFIDENCE_FLOOR ? "weak"
    : runnerUp && top.score - runnerUp.score < AMBIGUITY_MARGIN ? "ambiguous"
    : "exact";

  const provenance: Source[] = ["stocks"];
  if (kept.some((c) => c.coverage.tier >= 1)) provenance.push("quarterly_results");
  if (kept.some((c) => c.coverage.tier === 2)) provenance.push("score_snapshots");

  // ★ THE ENVELOPE'S SUBJECT IS THE RESOLVED ONE, OR NOTHING. On `exact` there is a subject and the
  // envelope carries it. On `ambiguous` or `weak` there is not — the caller has candidates, not an
  // answer — so `subject` is null and no tier can be read off it. Stage 1 mirrored candidates[0] here
  // and documented the hazard; the split makes the hazard unrepresentable instead.
  const coverage: Coverage = {
    subject: verdict === "exact" ? top.coverage : null,
    query: queryCov,
  };
  return resolved({ query: q, verdict, candidates: kept }, coverage, provenance);
}
