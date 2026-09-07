// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE TREE EVALUATOR — a validated condition tree, executed as set algebra over three universes.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ EVERY LEAF RETURNS TWO SETS, NOT ONE, AND THAT IS THE WHOLE DESIGN.
//
//   matched     the companies that satisfy this condition
//   population  the companies this condition could be EVALUATED over at all
//
// One set is not enough because the three universes have different reach — scored metrics see 95,
// filed line items 2,284, findings 2,291, sectors 2,290, peer groups 148 — and because a company we
// could not check is not a company that failed. Carrying both makes the combination rules honest:
//
//   AND   matched ∩ · population ∩   — as wide as the NARROWEST condition
//   OR    matched ∪ · population ∪   — a company judged on either side has been judged
//   NOT   population \ matched       — ★ over the leaf's OWN population, never the whole book
//
// ⚠ THE `NOT` RULE IS THE ONE THAT WOULD OTHERWISE LIE. "Not pledged" over the whole market would
//   sweep in the 233 companies the pledge check has never run against and call them clean — the
//   silent third-state death this layer exists to prevent, arriving through a new door. Negating
//   within the population means a company we could not check is in neither the matched set nor its
//   complement, which is the truth.
//
// ── ★ PER-ROW CONDITION MATCHING ─────────────────────────────────────────────────────────────────
// With OR, "companies meeting every condition" is false, and a row appears for reasons a reader
// cannot reconstruct. So every leaf keeps its own matched set and each row is told which leaves it
// satisfied — the card renders that as a column.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../db/prisma.js";
import { getUniverseHealthView } from "../scoring/read/universe-view.cache.js";
import { getUniverseMetricValues } from "../scoring/read/metric-values.cache.js";
import { valueOf } from "../scoring/read/screen.service.js";
import { SCREEN_FIELDS, type ScreenFieldId } from "../scoring/read/screen.types.js";
import { BAND_LABEL } from "../scoring/read/universe-projection.types.js";
import { DERIVED_SCREEN_FIELDS } from "../scoring/read/screen-fields.generated.js";
import { chooseBasis, preferredBasisFor } from "../scoring/read/fundamentals-view.service.js";
import { FILING_REGISTRY } from "../filing/registry.js";
import { STOCK_FINDINGS } from "../catalogue/stock-findings.js";
import { PRICE_METRICS, type PriceMetric } from "../composition/screen-grammar.js";
import type { MagnitudeToken } from "../composition/screen-grammar.js";
import type { CmpNode, LeafNode, ScreenNode } from "../composition/screen-grammar.js";

export type Basis = "standalone" | "consolidated";
export type Universe = "scored" | "filed" | "findings" | "sector" | "peerGroup" | "priced" | "series";

/** One leaf, executed. `label` is what the restatement and the per-row column say. */
export interface LeafResult {
  readonly id: number;
  readonly label: string;
  readonly universe: Universe;
  /**
   * ★ WHICH END OF THIS CONDITION IS THE INTERESTING ONE — set by any leaf carrying a comparator.
   *
   * ⚠ "P/E below 15" MATCHED 482 AND SHOWED THE 60 NEAREST THE BOUND, all reading 15.0×. Sorting is
   *   not optional here — 482 rows do not fit and something has to choose which 60 travel — and
   *   descending is the WORST choice for an upper bound: it shows the marginal cases and hides every
   *   company that clears the test comfortably.
   *
   * ⚠ THIS IS NOT AN ORDERING WE CLAIM. The restatement still says nothing about a ranking unless the
   *   reader asked for one (SC-12) — this only decides which of the matches are on the first page.
   */
  readonly preferLowest?: boolean;
  /**
   * ★ THE POPULATION, IN THIS LEAF'S OWN WORDS — because "companies that have filed the figures" is
   *   not what a trend searched. It searched the ones with enough QUARTERS, and the number only makes
   *   sense beside that. The depth floor is stated as the denominator rather than as a caveat: a
   *   reader who sees "1,780 companies with five quarters on file" knows what was and was not looked
   *   at, without being told anything is wrong with the answer.
   */
  readonly populationWords?: (size: number) => string;
  /**
   * ★ THE COLUMN HEADING, where trimming the label does not produce one. A trend's label is a whole
   *   clause — "with revenue up in each of the last 4 quarters" — and the trimming rule that turns
   *   "with revenue above 100 Cr" into "revenue" has nothing to cut here, so the heading came out as
   *   the entire sentence. The column shows the LATEST reading, so the field's own name is what it is.
   */
  readonly columnLabel?: string;
  /**
   * ★ WHICH INDUSTRIES THIS FIELD IS HELD FOR — set by the filed leaf, from the derived sources.
   *
   * ⚠ "NBFCs with provision coverage ratio above 70%" RETURNED AN EMPTY LIST, and the reader's only
   *   possible conclusion was that no NBFC clears 70%. The truth is that we hold PCR for BANKS ONLY —
   *   the schema has `pcr` on the two banking tables and nowhere else. An empty set from a bound
   *   nobody cleared and an empty set from a column that does not exist for these companies look
   *   identical, and only one of them is an answer.
   */
  readonly heldFor?: readonly string[];
  /** ⚠ Excluded for DEPTH — not a failure. Reported so the two can never be added together. */
  readonly excludedForDepth?: number;
  readonly matched: ReadonlySet<string>;
  readonly population: ReadonlySet<string>;
  /** Findings only — the third state, carried so a screen cannot bury it. */
  readonly notEvaluable?: number;
  readonly neverEvaluated?: number;
  /** Filed leaves only — the value and basis per symbol, for the card's columns. */
  readonly values?: ReadonlyMap<string, { display: string; sort: number; basis: Basis; period: string; periodSort: number }>;
}

export interface EvaluatedScreen {
  readonly matched: ReadonlySet<string>;
  readonly population: ReadonlySet<string>;
  readonly leaves: readonly LeafResult[];
  /** The narrowest universe any AND-ed condition reached — what the answer states it searched. */
  readonly narrowest: {
    readonly universe: Universe;
    readonly size: number;
    /** ★ True where conditions spanned universes, so no single universe word describes the number. */
    readonly intersected: boolean;
    /** ★ The narrowest leaf's own phrasing, where it has one — see `LeafResult.populationWords`. */
    readonly words?: (size: number) => string;
  };
  readonly names: ReadonlyMap<string, string>;
}

const num = (v: unknown): number =>
  typeof v === "number" ? v
  : typeof (v as { toNumber?: () => number })?.toNumber === "function" ? (v as { toNumber: () => number }).toNumber()
  : Number(v);

const DERIVED = new Map(DERIVED_SCREEN_FIELDS.map((f) => [f.key, f]));
const SCORED = new Set<string>(Object.keys(SCREEN_FIELDS));
const RULE_NAME = (k: string): string =>
  (STOCK_FINDINGS as Record<string, { name?: string }>)[k]?.name ?? k;

/** ★ THE READER'S NUMBER ONTO THE STORED ONE — code's job, never the model's. */
function scaleBound(value: number, magnitude: MagnitudeToken, unit: string): number {
  let v = value;
  if (magnitude === "lakhCr") v *= 100_000;
  // ⚠ A `fraction` COLUMN TAKES THE READER'S PERCENT DIVIDED BY 100 — returns, ratios and the two
  //   52-week distances are all stored as fractions, and "up more than 20%" means 0.20 to them.
  if (unit === "fraction" && (magnitude === "percent" || magnitude === "none")) v /= 100;
  return v;
}

/** An upper bound reads best from the bottom up; everything else from the top down. */
const lowestFirst = (c: CmpNode["comparator"]): boolean => c === "lt" || c === "lte";

const passes = (v: number, c: CmpNode["comparator"], bound: number): boolean => {
  switch (c) {
    case "gte": return v >= bound;
    case "gt": return v > bound;
    case "lte": return v <= bound;
    case "lt": return v < bound;
    case "eq": return v === bound;
  }
};

const boundWords = (c: CmpNode["comparator"]): string =>
  c === "gte" ? "at least" : c === "gt" ? "above" : c === "lte" ? "at most" : c === "lt" ? "below" : "exactly";

/** ₹ Cr, a percent, a multiple, a per-share figure — formatted once (N-1). */
function display(v: number, unit: string): string {
  const g = (x: number, dp = 2) => x.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  switch (unit) {
    case "currency": return Math.abs(v) >= 100_000 ? `₹${g(v / 100_000)} lakh Cr` : `₹${g(Math.round(v), 0)} Cr`;
    case "percent": return `${g(v, 1)}%`;
    case "fraction": return `${g(v * 100, 1)}%`;
    case "times": return `${g(v, 1)}×`;
    case "perShare": return `₹${g(v)}`;
    case "days": return `${g(v, 0)} days`;
    default: return g(v, 1);
  }
}

interface PriceRow {
  symbol: string; name: string | null; price: unknown; market_cap: unknown; updated_at: Date;
  week_52_high: unknown; week_52_low: unknown;
  return_1m: unknown; return_3m: unknown; return_6m: unknown; return_1y: unknown;
}

const maybe = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★★ ONE READER PER PRICE METRIC, AND THE COMPILER ENFORCES THE SET IS COMPLETE.
 *
 * ⚠ `Record<PriceMetric, …>` IS THE POINT. Adding a metric to `PRICE_METRICS` without a reader here
 *   fails to compile, rather than reaching the evaluator as a name with no way to read it — the same
 *   discipline as `UNIVERSE_ORDER`, and the reason the "priced" universe was caught at every site the
 *   first time round.
 *
 * ⚠ EVERY READER RETURNS null RATHER THAN A ZERO. A company with no 1-year return has not returned
 *   0% — it has not been listed a year, and it belongs in neither the matched set nor the population.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 */
const PRICE_READ: Record<PriceMetric, (r: PriceRow, eps: number | null) => number | null> = {
  marketCap: (r) => maybe(r.market_cap),
  // ★ a loss has no P/E — see the note at the leaf
  peRatio: (r, eps) => {
    const p = maybe(r.price);
    return p === null || eps === null || eps <= 0 ? null : p / eps;
  },
  return1m: (r) => maybe(r.return_1m),
  return3m: (r) => maybe(r.return_3m),
  return6m: (r) => maybe(r.return_6m),
  return1y: (r) => maybe(r.return_1y),
  // ⚠ THE DENOMINATOR IS THE EXTREME, NOT THE PRICE. "20% off its high" is conventionally read
  //   against the high, and against the price it would be a different, larger number.
  offFrom52WeekHigh: (r) => {
    const hi = maybe(r.week_52_high), p = maybe(r.price);
    return hi === null || p === null || hi <= 0 ? null : (hi - p) / hi;
  },
  offFrom52WeekLow: (r) => {
    const lo = maybe(r.week_52_low), p = maybe(r.price);
    return lo === null || p === null || lo <= 0 ? null : (p - lo) / lo;
  },
};

const SAFE = /^[a-z0-9_]+$/;

/** "4 Sep 2026" — what a price is as of, in the column beside it. */
const asOfDay = (d: Date | string): string =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

interface FiledRow { symbol: string; name: string | null; result_type: string; v: unknown; fiscal_year: string; quarter: string | null; report_date: Date }

const FAMILY_BY_TABLE: Record<string, "non_financial" | "banking" | "nbfc" | "life_insurance" | "general_insurance"> = {
  quarterly_results: "non_financial", fundamentals: "non_financial",
  banking_quarterly_results: "banking", banking_fundamentals: "banking",
  nbfc_quarterly_results: "nbfc", nbfc_fundamentals: "nbfc",
  life_insurance_quarterly_results: "life_insurance", life_insurance_fundamentals: "life_insurance",
  general_insurance_quarterly_results: "general_insurance", general_insurance_fundamentals: "general_insurance",
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ ONE READER FOR "WHAT IS THIS FIELD, FOR EVERY COMPANY" — three sources, one shape.
//
// ⚠ THERE WERE THREE COPIES OF THIS AND A FOURTH WAS ABOUT TO BE WRITTEN. The scored branch, the
//   filed branch and the price branch each read their own values, applied their own bound and built
//   their own `values` map. `relative` needs the SAME numbers grouped by sector — and writing a
//   fourth reader is precisely how the fourth one comes to disagree with the other three about basis,
//   about units, or about which companies have a value at all.
//
// ★ SO THE READING AND THE COMPARING ARE SEPARATED. This returns every company's value; the leaves
//   decide what to do with it — `cmp` applies a constant bound, `relative` applies a per-group median.
//   A field added to any of the three vocabularies is readable by all of them at once.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
interface FieldValue { v: number; basis: Basis; period: string; periodSort: number }

interface ValueSet {
  readonly values: Map<string, FieldValue>;
  readonly universe: Universe;
  readonly unit: string;
  /** The noun that follows "with …" in the restatement. */
  readonly label: string;
  /** A short heading where the label does not make one. */
  readonly columnLabel?: string;
}

async function readField(
  key: string, requestedBasis: Basis | null, names: Map<string, string>,
): Promise<ValueSet> {
  const values = new Map<string, FieldValue>();

  // ── computed from price ────────────────────────────────────────────────────────────────────────
  if (key in PRICE_METRICS) {
    const metric = key as PriceMetric;
    const meta = PRICE_METRICS[metric] as { label: string; column?: string; unit: string };
    const rows = await prisma.$queryRawUnsafe<PriceRow[]>(`
      SELECT s.symbol, s.name, p.price, p.market_cap, p.updated_at,
             p.week_52_high, p.week_52_low, p.return_1m, p.return_3m, p.return_6m, p.return_1y
      FROM stock_prices p JOIN stocks s ON s.id = p.stock_id`);

    // ★★ THE P/E's DENOMINATOR: TRAILING TWELVE MONTHS OF NET PROFIT, basis-resolved like any filed
    //    figure. Read only when the question needs it — the other eight metrics are row-local.
    const ttm = metric === "peRatio" ? await readTtmProfit(requestedBasis) : new Map<string, TtmProfit>();

    for (const r of rows) {
      names.set(r.symbol, r.name ?? r.symbol);
      let v: number | null;
      let period = asOfDay(r.updated_at);
      let periodSort = new Date(r.updated_at).getTime();
      if (metric === "peRatio") {
        const t = ttm.get(r.symbol);
        const cap = maybe(r.market_cap);
        // ⚠ A LOSS HAS NO P/E, and a company with fewer than four quarters has none either. Both are
        //   in NEITHER set — a loss-maker ranked as the cheapest stock on the page is the defect this
        //   guard exists for.
        v = t && cap !== null && t.profit > 0 ? cap / t.profit : null;
        if (t) { period = `TTM to ${t.period}`; periodSort = t.periodSort; }
      } else {
        v = PRICE_READ[metric](r, null);
      }
      if (v === null) continue;
      values.set(r.symbol, { v, basis: "consolidated", period, periodSort });
    }
    return { values, universe: "priced", unit: meta.unit, label: meta.label, columnLabel: meta.column };
  }

  // ── a SCORED metric or pillar: the 95 we score ────────────────────────────────────────────────
  if (SCORED.has(key)) {
    const [view, metrics] = await Promise.all([getUniverseHealthView(), getUniverseMetricValues()]);
    const field = SCREEN_FIELDS[key as ScreenFieldId];
    for (const m of view.members) {
      names.set(m.symbol, m.name || m.symbol);
      const v = valueOf(m, field, metrics);
      if (v === null) continue;                        // could not be read — in neither set
      values.set(m.symbol, {
        v, basis: "consolidated", period: view.periodKey ?? "", periodSort: 0,
      });
    }
    return { values, universe: "scored", unit: field.unit === "points" ? "points" : field.unit,
      label: field.label.toLowerCase() };
  }

  // ── a FILED line item, across every industry's statements ─────────────────────────────────────
  const f = DERIVED.get(key)!;
  const hasQ = f.sources.some((x) => x.grain === "quarterly");
  const grain = hasQ ? "quarterly" : "annual";
  for (const src of f.sources.filter((x) => x.grain === grain)) {
    if (!SAFE.test(src.table) || !SAFE.test(src.column)) continue;
    const period = grain === "quarterly" ? "q.quarter" : "NULL::text";
    const rows = await prisma.$queryRawUnsafe<FiledRow[]>(`
      SELECT DISTINCT ON (q.stock_id, q.result_type)
             s.symbol, s.name, q.result_type, q.${src.column} AS v, q.fiscal_year, ${period} AS quarter, q.report_date
      FROM ${src.table} q JOIN stocks s ON s.id = q.stock_id
      WHERE q.${src.column} IS NOT NULL
      ORDER BY q.stock_id, q.result_type, q.report_date DESC`);
    const bySymbol = new Map<string, FiledRow[]>();
    for (const r of rows) {
      names.set(r.symbol, r.name ?? r.symbol);
      const cur = bySymbol.get(r.symbol); if (cur) cur.push(r); else bySymbol.set(r.symbol, [r]);
    }
    const family = FAMILY_BY_TABLE[src.table] ?? "non_financial";
    for (const [symbol, rs] of bySymbol) {
      // ★ THE STANDING RULING — see resolve/line-item-screen.ts.
      const available = [...new Set(rs.map((r) => r.result_type))] as Basis[];
      const basis = chooseBasis(requestedBasis ?? undefined, available, preferredBasisFor(family));
      const row = rs.find((r) => r.result_type === basis) ?? rs[0]!;
      values.set(symbol, {
        v: num(row.v), basis: row.result_type as Basis,
        period: row.quarter ? `${row.fiscal_year} ${row.quarter}` : row.fiscal_year,
        periodSort: new Date(row.report_date).getTime(),
      });
    }
  }
  return { values, universe: "filed", unit: f.unit, label: f.label.toLowerCase() };
}

/** Which industries a filed field exists for — drives the "we hold this for banks" empty state. */
const heldForOf = (key: string): readonly string[] | undefined => {
  const f = DERIVED.get(key);
  return f ? [...new Set(f.sources.map((x) => x.industry))] : undefined;
};

/**
 * ★ symbol → the group it is benchmarked against. Sectors reach 2,290 of 2,291; peer groups reach 148.
 *
 * ⚠ A STOCK IN SEVERAL PEER GROUPS IS BENCHMARKED AGAINST ONE, deterministically — the first by id —
 *   because a company compared against two medians at once would be in and out of the same set.
 */
async function readGroups(benchmark: "sector" | "peerGroup"): Promise<Map<string, string>> {
  const rows = benchmark === "sector"
    ? await prisma.$queryRawUnsafe<{ symbol: string; g: string }[]>(`
        SELECT s.symbol, sec.display_name AS g FROM stocks s
        JOIN sectors sec ON sec.id = s.sector_id WHERE sec.display_name IS NOT NULL`)
    : await prisma.$queryRawUnsafe<{ symbol: string; g: string }[]>(`
        SELECT DISTINCT ON (s.symbol) s.symbol, m.peer_group_id AS g
        FROM stocks s JOIN stock_peer_groups m ON m.stock_id = s.id
        ORDER BY s.symbol, m.peer_group_id`);
  return new Map(rows.map((r) => [r.symbol, r.g]));
}

interface TtmProfit { profit: number; period: string; periodSort: number }

/**
 * ★ TRAILING FOUR QUARTERS OF NET PROFIT, per company, on the basis the standing ruling picks.
 *
 * ⚠ "AVAILABLE" MEANS "HAS FOUR QUARTERS", not "has any row" — a company with four consolidated and
 *   two standalone quarters must be answered on the consolidated series rather than dropped. Same
 *   reasoning as the trend leaf: the ruling is given the bases that can actually answer.
 */
async function readTtmProfit(requestedBasis: Basis | null): Promise<Map<string, TtmProfit>> {
  const out = new Map<string, TtmProfit>();
  const field = DERIVED.get("netProfit");
  for (const src of (field?.sources ?? []).filter((x) => x.grain === "quarterly")) {
    if (!SAFE.test(src.table) || !SAFE.test(src.column)) continue;
    const rows = await prisma.$queryRawUnsafe<{
      symbol: string; result_type: string; total: unknown; n: bigint;
      fiscal_year: string; quarter: string | null; report_date: Date;
    }[]>(`
      WITH r AS (
        SELECT q.stock_id, q.result_type, q.${src.column} AS v, q.fiscal_year, q.quarter, q.report_date,
               row_number() OVER (PARTITION BY q.stock_id, q.result_type ORDER BY q.report_date DESC) rn
        FROM ${src.table} q WHERE q.${src.column} IS NOT NULL)
      SELECT s.symbol, r.result_type, sum(r.v) AS total, count(*) AS n,
             max(r.fiscal_year) FILTER (WHERE r.rn = 1) AS fiscal_year,
             max(r.quarter)     FILTER (WHERE r.rn = 1) AS quarter,
             max(r.report_date) AS report_date
      FROM r JOIN stocks s ON s.id = r.stock_id
      WHERE r.rn <= 4 GROUP BY 1, 2 HAVING count(*) = 4`);
    const bySymbol = new Map<string, typeof rows>();
    for (const r of rows) {
      const cur = bySymbol.get(r.symbol); if (cur) cur.push(r); else bySymbol.set(r.symbol, [r]);
    }
    const family = FAMILY_BY_TABLE[src.table] ?? "non_financial";
    for (const [symbol, rs] of bySymbol) {
      const available = [...new Set(rs.map((r) => r.result_type))] as Basis[];
      const basis = chooseBasis(requestedBasis ?? undefined, available, preferredBasisFor(family));
      const row = rs.find((r) => r.result_type === basis) ?? rs[0]!;
      out.set(symbol, {
        profit: num(row.total),
        period: row.quarter ? `${row.fiscal_year} ${row.quarter}` : row.fiscal_year,
        periodSort: new Date(row.report_date).getTime(),
      });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// LEAF EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
async function runLeaf(
  leaf: LeafNode, id: number, requestedBasis: Basis | null, names: Map<string, string>,
): Promise<LeafResult> {
  // ── A NUMERIC BOUND on anything we hold a value for — filed, scored, or computed from price ────
  //    ★ The reading is `readField`'s; this leaf only applies the bound. One home, three callers.
  if (leaf.op === "cmp" || leaf.op === "price") {
    const key = leaf.op === "price" ? leaf.metric : leaf.field;
    const vs = await readField(key, requestedBasis, names);
    const bound = scaleBound(leaf.value, leaf.magnitude, vs.unit);
    const matched = new Set<string>(); const population = new Set<string>();
    const values = new Map<string, { display: string; sort: number; basis: Basis; period: string; periodSort: number }>();
    for (const [symbol, fv] of vs.values) {
      population.add(symbol);
      if (!passes(fv.v, leaf.comparator, bound)) continue;
      matched.add(symbol);
      values.set(symbol, {
        display: display(fv.v, vs.unit), sort: fv.v, basis: fv.basis,
        period: fv.period, periodSort: fv.periodSort,
      });
    }
    // ⚠ EVERY LABEL IS A PHRASE THAT FOLLOWS "Companies …", because the restatement is one sentence
    //   and the first draft produced "Companies revenue above 100 Cr."
    return { id, universe: vs.universe, matched, population, values,
      preferLowest: lowestFirst(leaf.comparator), columnLabel: vs.columnLabel,
      heldFor: leaf.op === "cmp" ? heldForOf(key) : undefined,
      label: `with ${vs.label} ${boundWords(leaf.comparator)} ${display(bound, vs.unit)}` };
  }

  // ── a BAND: the 95 we score ────────────────────────────────────────────────────────────────────
  if (leaf.op === "band") {
    const view = await getUniverseHealthView();
    const label = BAND_LABEL[leaf.band as keyof typeof BAND_LABEL] ?? leaf.band;
    const matched = new Set<string>(); const population = new Set<string>();
    for (const m of view.members) {
      names.set(m.symbol, m.name || m.symbol);
      population.add(m.symbol);
      if (m.labelBand === leaf.band) matched.add(m.symbol);
    }
    return { id, universe: "scored", matched, population, label: `labelled ${label}` };
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ── a FINDING: all 2,291, and the FOUR states kept apart ───────────────────────────────────────
  //
  // ★ THREE STATES ARE RECORDED AND A FOURTH IS RECORDED BY ABSENCE:
  //     fired          the check ran and raised something
  //     not_fired      the check ran and raised nothing
  //     not_evaluable  the check ran and could not reach a verdict
  //     (no row)       the check never ran for this company at all
  //
  // ⚠ ONLY THE FIRST TWO ARE THE POPULATION. Folding "could not be checked" into "did not fire"
  //   reports that a company passed a test nobody ran on it — the defect `I-STATES-SURVIVE` exists to
  //   catch, which is why the three counts travel separately to the digest.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (leaf.op === "finding") {
    const keys = leaf.rule
      ? [leaf.rule]
      : FILING_REGISTRY.filter((e) => e.kind === leaf.kind).map((e) => e.ruleKey as string);
    const rows = await prisma.$queryRawUnsafe<{ symbol: string; name: string | null; state: string }[]>(`
      WITH latest AS (
        SELECT DISTINCT ON (f.stock_id, f.rule_key) f.stock_id, f.rule_key, f.evaluation_state
        FROM stock_findings f WHERE f.rule_key = ANY($1::text[])
        ORDER BY f.stock_id, f.rule_key, f.period_end DESC
      )
      SELECT s.symbol, s.name, l.evaluation_state AS state
      FROM latest l JOIN stocks s ON s.id = l.stock_id`, keys);

    const matched = new Set<string>(); const population = new Set<string>();
    const seen = new Set<string>(); const unreadable = new Set<string>();
    for (const r of rows) {
      names.set(r.symbol, r.name ?? r.symbol);
      seen.add(r.symbol);
      // ⚠ ACROSS A KIND, ANY RULE THAT RAN PUTS THE COMPANY IN THE POPULATION, and any rule that
      //   fired matches it — "companies with a red flag" means at least one, not all of them.
      if (r.state === "fired" || r.state === "not_fired") {
        population.add(r.symbol);
        if (r.state === "fired") matched.add(r.symbol);
      } else {
        unreadable.add(r.symbol);
      }
    }
    for (const sym of population) unreadable.delete(sym);

    const [{ n: total }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM stocks`);
    const label = leaf.rule
      ? `showing ${RULE_NAME(leaf.rule)}`
      : `showing ${leaf.kind === "pattern" ? "a pattern" : "a red flag"}`;
    return { id, universe: "findings", matched, population, label,
      notEvaluable: unreadable.size,
      // ⚠ RECORDED BY ABSENCE — a company with no row was never looked at, and is not a company that
      //   passed. It is in neither set, and the count says how many.
      neverEvaluated: Number(total) - seen.size };
  }

  // ── A PLEDGE THRESHOLD ─────────────────────────────────────────────────────────────────────────
  //
  // ★ THE RATIO IS COMPUTED FROM COUNTS. `promoter_pledged_pct` is filer-reported; the counts are what
  //   the filing states and what the R1 check itself reads.
  //
  // ⚠ THE DENOMINATOR IS `promoter_total_shares` — the filing's own basis, depository receipts
  //   included. MEASURED: populated on 353 of 2,058 latest rows, which is EXACTLY the set carrying a
  //   pledge at all, so the COALESCE can only apply where `pledged_shares` is zero and the ratio is
  //   zero either way. It is a fallback that cannot change an answer.
  //
  // ⚠ A COMPANY WITH NO PROMOTER IS NOT AT 0% — it is undefined, and is in NEITHER set.
  if (leaf.op === "pledge") {
    const rows = await prisma.$queryRawUnsafe<{ symbol: string; name: string | null; ratio: string | number | null }[]>(`
      WITH latest AS (
        SELECT DISTINCT ON (sp.stock_id) sp.stock_id, sp.pledged_shares, sp.promoter_shares, sp.promoter_total_shares
        FROM shareholding_patterns sp ORDER BY sp.stock_id, sp.as_on_date DESC
      )
      SELECT s.symbol, s.name,
             CASE WHEN COALESCE(l.promoter_total_shares, l.promoter_shares) > 0
                  THEN COALESCE(l.pledged_shares, 0)::numeric / COALESCE(l.promoter_total_shares, l.promoter_shares)
                  ELSE NULL END AS ratio
      FROM latest l JOIN stocks s ON s.id = l.stock_id`);
    const bound = leaf.value / 100;   // ★ code converts; the model never does
    const matched = new Set<string>(); const population = new Set<string>();
    const values = new Map<string, { display: string; sort: number; basis: Basis; period: string; periodSort: number }>();
    for (const r of rows) {
      names.set(r.symbol, r.name ?? r.symbol);
      if (r.ratio === null) continue;               // no promoter holding — undefined, not zero
      const v = num(r.ratio);
      population.add(r.symbol);
      if (!passes(v, leaf.comparator, bound)) continue;
      matched.add(r.symbol);
      values.set(r.symbol, {
        display: `${(v * 100).toFixed(1)}%`, sort: v, basis: "standalone",
        period: "latest filing", periodSort: 0,
      });
    }
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★ THE RATIO IS PUBLISHED — the ruling was re-measured and then lifted, in that order.
    //
    //   I-PLEDGE-SILENT ruled that no pledge magnitude reaches a reader on any path. It was written
    //   when the two pledge columns contradicted each other — 1,555 rows reported a positive percent
    //   against zero pledged shares, and of 3,205 rows where both were positive only 891 agreed.
    //
    // ★ RE-MEASURED AGAINST THE CURRENT ARCHIVE, and the contradiction is gone: ZERO rows now report a
    //   percent against zero shares, and on the latest row per stock all 2,007 comparable rows agree
    //   to within half a point, with a WORST GAP OF ZERO.
    //
    // ⚠ AND IT IS STILL COMPUTED FROM COUNTS, not from `promoter_pledged_pct`. The agreement is what
    //   makes the column trustworthy; it is not a reason to start quoting the filer's percentage.
    //
    // ⚠ THE RULING SURVIVES EVERYWHERE ELSE. A pledge figure on the company page still fires the
    //   invariant, and the harness holds a control proving it.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    return { id, universe: "findings", matched, population, values,
      preferLowest: lowestFirst(leaf.comparator), columnLabel: "pledged",
      label: `with pledging ${boundWords(leaf.comparator)} ${leaf.value}% of the promoter holding` };
  }

  // ── A TREND: the same figure, read across quarters ─────────────────────────────────────────────
  //
  // ★ DEPTH DECIDES WHICH BASIS IS AVAILABLE. A stock may hold eight consolidated quarters and three
  //   standalone; handing `chooseBasis` both and then finding the chosen one too short would exclude a
  //   company we CAN answer for. So "available" means "has the quarters this question needs", and the
  //   standing ruling picks among those.
  if (leaf.op === "trend") {
    const f = DERIVED.get(leaf.field)!;
    // ★ THE WINDOW IS `of` WHERE THE READER GAVE ONE — the window, not the threshold, sets the depth.
    const window = leaf.of ?? leaf.periods;
    const need = window + 1;
    const matched = new Set<string>(); const population = new Set<string>();
    const shallow = new Set<string>();
    const values = new Map<string, { display: string; sort: number; basis: Basis; period: string; periodSort: number }>();

    for (const src of f.sources.filter((x) => x.grain === "quarterly")) {
      if (!SAFE.test(src.table) || !SAFE.test(src.column)) continue;
      const rows = await prisma.$queryRawUnsafe<(FiledRow & { rn: number })[]>(`
        SELECT symbol, name, result_type, v, fiscal_year, quarter, report_date, rn FROM (
          SELECT s.symbol, s.name, q.result_type, q.${src.column} AS v, q.fiscal_year, q.quarter, q.report_date,
                 row_number() OVER (PARTITION BY q.stock_id, q.result_type ORDER BY q.report_date DESC) rn
          FROM ${src.table} q JOIN stocks s ON s.id = q.stock_id
          WHERE q.${src.column} IS NOT NULL
        ) t WHERE rn <= ${need}`);

      const bySymbol = new Map<string, Map<string, (FiledRow & { rn: number })[]>>();
      for (const r of rows) {
        names.set(r.symbol, r.name ?? r.symbol);
        let byBasis = bySymbol.get(r.symbol);
        if (!byBasis) { byBasis = new Map(); bySymbol.set(r.symbol, byBasis); }
        const cur = byBasis.get(r.result_type);
        if (cur) cur.push(r); else byBasis.set(r.result_type, [r]);
      }

      const family = FAMILY_BY_TABLE[src.table] ?? "non_financial";
      for (const [symbol, byBasis] of bySymbol) {
        const deep = [...byBasis.entries()].filter(([, rs]) => rs.length >= need);
        if (deep.length === 0) { shallow.add(symbol); continue; }   // ⚠ not a failure — never looked at
        const basis = chooseBasis(requestedBasis ?? undefined, deep.map(([b]) => b) as Basis[], preferredBasisFor(family));
        // ⚠ `row_number()` COMES BACK AS A BIGINT and subtracting two of them throws inside sort.
        const series = (byBasis.get(basis) ?? deep[0]![1]).slice().sort((a, b) => Number(a.rn) - Number(b.rn));
        population.add(symbol);

        // ★ COUNT THE MOVES IN THE NAMED DIRECTION. `series[0]` is the newest, so a move is each
        //   reading against the one before it going back in time.
        //
        // ⚠ WITH NO `of`, ALL OF THEM MUST QUALIFY — the strict run. With `of`, the reader asked for a
        //   count out of a window, and one flat quarter no longer disqualifies a company that is
        //   plainly growing.
        let moves = 0;
        for (let k = 0; k < series.length - 1; k++) {
          const newer = num(series[k]!.v), older = num(series[k + 1]!.v);
          if (leaf.direction === "up" ? newer > older : newer < older) moves++;
        }
        if (moves < leaf.periods) continue;
        matched.add(symbol);
        const latest = series[0]!;
        values.set(symbol, {
          display: display(num(latest.v), f.unit), sort: num(latest.v), basis: latest.result_type as Basis,
          period: latest.quarter ? `${latest.fiscal_year} ${latest.quarter}` : latest.fiscal_year,
          periodSort: new Date(latest.report_date).getTime(),
        });
      }
    }
    // ⚠ A STOCK WITH DEPTH ON ONE INDUSTRY TABLE IS NOT SHALLOW because another lacked it.
    for (const sym of population) shallow.delete(sym);
    return { id, universe: "series", matched, population, values,
      excludedForDepth: shallow.size, columnLabel: f.label,
      populationWords: (n2) => `${n2.toLocaleString("en-IN")} companies with ${need} quarters on file`,
      label: leaf.of
        ? `with ${f.label.toLowerCase()} ${leaf.direction} in ${leaf.periods} of the last ${leaf.of} quarters`
        : `with ${f.label.toLowerCase()} ${leaf.direction} in each of the last ${leaf.periods} quarters` };
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ── A BOUND THAT IS NOT A NUMBER: each company against its own group's median ──────────────────
  //
  // ⚠ A COMPANY IN A GROUP OF ONE HAS NO BENCHMARK. Its own value would BE the median, so it would
  //   compare equal to itself and land in whichever set the comparator happens to admit — a company
  //   reported as "cheaper than its sector" on the strength of being the only one in it. Those are
  //   excluded from the population, not silently passed.
  //
  // ⚠ AND A COMPANY WITH NO GROUP AT ALL is likewise in neither set — which is most of the book for
  //   peer groups: 148 stocks of 2,291 are in one.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (leaf.op === "relative") {
    const vs = await readField(leaf.field, requestedBasis, names);
    const groups = await readGroups(leaf.benchmark);
    const byGroup = new Map<string, { symbol: string; v: number }[]>();
    for (const [symbol, fv] of vs.values) {
      const g = groups.get(symbol);
      if (g === undefined) continue;                   // no group — no benchmark, neither set
      const cur = byGroup.get(g);
      if (cur) cur.push({ symbol, v: fv.v }); else byGroup.set(g, [{ symbol, v: fv.v }]);
    }
    const matched = new Set<string>(); const population = new Set<string>();
    const values = new Map<string, { display: string; sort: number; basis: Basis; period: string; periodSort: number }>();
    for (const [, members] of byGroup) {
      if (members.length < 2) continue;                // a median of one is that company itself
      const sorted = members.map((m) => m.v).sort((a, b) => a - b);
      const mid = sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]!
        : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
      for (const m of members) {
        population.add(m.symbol);
        if (!passes(m.v, leaf.comparator, mid)) continue;
        matched.add(m.symbol);
        const fv = vs.values.get(m.symbol)!;
        values.set(m.symbol, {
          display: display(m.v, vs.unit), sort: m.v, basis: fv.basis,
          period: fv.period, periodSort: fv.periodSort,
        });
      }
    }
    const where = leaf.benchmark === "sector" ? "sector" : "peer group";
    return { id, universe: vs.universe, matched, population, values,
      preferLowest: lowestFirst(leaf.comparator), columnLabel: vs.columnLabel,
      populationWords: (n2) => `${n2.toLocaleString("en-IN")} companies we can compare with their ${where}`,
      label: `with ${vs.label} ${boundWords(leaf.comparator)} their ${where} median` };
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ── HOW MUCH A FIGURE MOVED, year on year or quarter on quarter ───────────────────────────────
  //
  // ⚠ THE BASE IS THE DANGER, AND IT IS NOT RARE. Growth off a base at or below zero is not a
  //   percentage at all: −10 Cr to −5 Cr is not "+50%", and −10 to +5 is not "+150%". MEASURED on the
  //   latest year-on-year pairs, 451 of 3,406 net-profit pairs have a base ≤ 0 — one company in eight
  //   on the field readers most want this for. Every one of them is in NEITHER set.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  if (leaf.op === "growth") {
    const f = DERIVED.get(leaf.field)!;
    const back = leaf.window === "yoy" ? 5 : 2;        // rn=1 is the latest reading
    const bound = leaf.value / 100;
    const matched = new Set<string>(); const population = new Set<string>();
    const values = new Map<string, { display: string; sort: number; basis: Basis; period: string; periodSort: number }>();

    for (const src of f.sources.filter((x) => x.grain === "quarterly")) {
      if (!SAFE.test(src.table) || !SAFE.test(src.column)) continue;
      const rows = await prisma.$queryRawUnsafe<{
        symbol: string; name: string | null; result_type: string;
        now_v: unknown; base_v: unknown; fiscal_year: string; quarter: string | null; report_date: Date;
      }[]>(`
        WITH r AS (
          SELECT q.stock_id, q.result_type, q.${src.column} AS v, q.fiscal_year, q.quarter, q.report_date,
                 row_number() OVER (PARTITION BY q.stock_id, q.result_type ORDER BY q.report_date DESC) rn
          FROM ${src.table} q WHERE q.${src.column} IS NOT NULL)
        SELECT s.symbol, s.name, a.result_type, a.v AS now_v, b.v AS base_v,
               a.fiscal_year, a.quarter, a.report_date
        FROM r a JOIN r b ON b.stock_id = a.stock_id AND b.result_type = a.result_type AND b.rn = ${back}
        JOIN stocks s ON s.id = a.stock_id
        WHERE a.rn = 1`);
      const bySymbol = new Map<string, typeof rows>();
      for (const r of rows) {
        names.set(r.symbol, r.name ?? r.symbol);
        const cur = bySymbol.get(r.symbol); if (cur) cur.push(r); else bySymbol.set(r.symbol, [r]);
      }
      const family = FAMILY_BY_TABLE[src.table] ?? "non_financial";
      for (const [symbol, rs] of bySymbol) {
        const available = [...new Set(rs.map((r) => r.result_type))] as Basis[];
        const basis = chooseBasis(requestedBasis ?? undefined, available, preferredBasisFor(family));
        const row = rs.find((r) => r.result_type === basis) ?? rs[0]!;
        const base = num(row.base_v);
        if (!(base > 0)) continue;                     // ★ no percentage exists off a base ≤ 0
        const v = (num(row.now_v) - base) / base;
        population.add(symbol);
        if (!passes(v, leaf.comparator, bound)) continue;
        matched.add(symbol);
        values.set(symbol, {
          display: display(v, "fraction"), sort: v, basis: row.result_type as Basis,
          period: row.quarter ? `${row.fiscal_year} ${row.quarter}` : row.fiscal_year,
          periodSort: new Date(row.report_date).getTime(),
        });
      }
    }
    const when = leaf.window === "yoy" ? "year on year" : "quarter on quarter";
    return { id, universe: "filed", matched, population, values,
      preferLowest: lowestFirst(leaf.comparator), columnLabel: `${f.label} ${when}`,
      populationWords: (n2) => `${n2.toLocaleString("en-IN")} companies with both periods on file`,
      // ⚠ THE WORD "GROWTH" IS LOAD-BEARING. "Companies with revenue above 20% year on year" reads as
      //   a LEVEL — revenue of 20% — when the leaf selected on a CHANGE of 20%. One noun apart, and
      //   the sentence describes a screen we did not run.
      label: `with ${f.label.toLowerCase()} growth ${boundWords(leaf.comparator)} ${leaf.value}% ${when}` };
  }

  // ── EVERYTHING: a ranking with no filter ───────────────────────────────────────────────────────
  //    ⚠ ITS POPULATION IS EVERY STOCK, WHICH IS ONLY SAFE BECAUSE IT IS ALWAYS INTERSECTED with the
  //      ordering field's probe. Alone it would claim a search over the whole book; ANDed, it yields
  //      "companies that have the figure we ranked on", which is what the answer states.
  if (leaf.op === "all") {
    const rows = await prisma.$queryRawUnsafe<{ symbol: string; name: string | null }[]>(
      `SELECT symbol, name FROM stocks`);
    const everything = new Set<string>();
    for (const r of rows) { names.set(r.symbol, r.name ?? r.symbol); everything.add(r.symbol); }
    return { id, universe: "filed", matched: everything, population: everything, label: "we hold" };
  }

  // ── a SECTOR: 2,290 of 2,291 carry one ─────────────────────────────────────────────────────────
  if (leaf.op === "sector") {
    const rows = await prisma.$queryRawUnsafe<{ symbol: string; name: string | null; display_name: string | null }[]>(`
      SELECT s.symbol, s.name, sec.display_name FROM stocks s LEFT JOIN sectors sec ON sec.id = s.sector_id`);
    const matched = new Set<string>(); const population = new Set<string>();
    for (const r of rows) {
      names.set(r.symbol, r.name ?? r.symbol);
      if (!r.display_name) continue;                    // no sector on file — in neither set
      population.add(r.symbol);
      if (r.display_name === leaf.sector) matched.add(r.symbol);
    }
    return { id, universe: "sector", matched, population, label: `in ${leaf.sector}` };
  }

  // ── a PEER GROUP: only 148 stocks are in one, and that is stated ───────────────────────────────
  const rows = await prisma.$queryRawUnsafe<{ symbol: string; name: string | null; display_name: string }[]>(`
    SELECT s.symbol, s.name, pg.display_name
    FROM stock_peer_groups spg JOIN stocks s ON s.id = spg.stock_id JOIN peer_groups pg ON pg.id = spg.peer_group_id`);
  const matched = new Set<string>(); const population = new Set<string>();
  for (const r of rows) {
    names.set(r.symbol, r.name ?? r.symbol);
    population.add(r.symbol);
    if (r.display_name === (leaf as { name: string }).name) matched.add(r.symbol);
  }
  return { id, universe: "peerGroup", matched, population, label: `in ${(leaf as { name: string }).name}` };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE FOLD
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const inter = (a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> => {
  const out = new Set<string>(); for (const x of a) if (b.has(x)) out.add(x); return out;
};
const union = (a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> => {
  const out = new Set<string>(a); for (const x of b) out.add(x); return out;
};
const minus = (a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> => {
  const out = new Set<string>(); for (const x of a) if (!b.has(x)) out.add(x); return out;
};

function fold(node: ScreenNode, byId: Map<number, LeafResult>, next: { i: number }):
  { matched: Set<string>; population: Set<string> } {
  switch (node.op) {
    case "and": {
      const parts = node.nodes.map((n) => fold(n, byId, next));
      return parts.reduce((a, b) => ({ matched: inter(a.matched, b.matched), population: inter(a.population, b.population) }));
    }
    case "or": {
      const parts = node.nodes.map((n) => fold(n, byId, next));
      // ⚠ POPULATION IS THE UNION FOR `or`. A company evaluable on either side HAS been judged, so
      //   intersecting here would report a smaller search than actually happened.
      return parts.reduce((a, b) => ({ matched: union(a.matched, b.matched), population: union(a.population, b.population) }));
    }
    case "not": {
      const r = fold(node.node, byId, next);
      // ★ WITHIN THE POPULATION. See the header — negating over the whole book calls the unchecked clean.
      return { matched: minus(r.population, r.matched), population: r.population };
    }
    default: {
      const leaf = byId.get(next.i++)!;
      return { matched: new Set(leaf.matched), population: new Set(leaf.population) };
    }
  }
}

// ⚠ THE ORDER DECIDES WHICH DENOMINATOR THE ANSWER STATES when conditions span universes — the
//   NARROWEST wins, because that is the set the screen could actually look at. "priced" sits
//   between the scored 95 and the 2,284 that have filed: 2,056 carry a market cap.
const UNIVERSE_ORDER: Record<Universe, number> = { peerGroup: 0, scored: 1, series: 2, sector: 3, priced: 4, filed: 5, findings: 6 };

export async function evaluateScreen(tree: ScreenNode, requestedBasis: Basis | null): Promise<EvaluatedScreen> {
  const names = new Map<string, string>();
  const leafNodes: LeafNode[] = [];
  (function walk(n: ScreenNode): void {
    if (n.op === "and" || n.op === "or") { n.nodes.forEach(walk); return; }
    if (n.op === "not") { walk(n.node); return; }
    leafNodes.push(n);
  })(tree);

  // ⚠ SEQUENTIAL, NOT PARALLEL. Each filed leaf issues one query per industry table and the pool is
  //   capped at five; a wide OR would queue rather than speed up.
  const leaves: LeafResult[] = [];
  for (const [i, leaf] of leafNodes.entries()) leaves.push(await runLeaf(leaf, i, requestedBasis, names));

  const byId = new Map(leaves.map((l) => [l.id, l]));
  const { matched, population } = fold(tree, byId, { i: 0 });

  // ⚠ THE SIZE IS THE FOLDED POPULATION, NOT THE NARROWEST LEAF'S. "Pharma companies with revenue
  //   above 100cr" reported "searched 2,290 companies with a sector on file" — true of the sector leaf
  //   and not of the screen, which could only judge companies carrying BOTH a sector and a revenue
  //   figure. The intersection is the set that was actually searched, and the universe word only says
  //   which kind of population it was narrowest in.
  const narrowestLeaf = leaves.reduce((a, b) => (UNIVERSE_ORDER[a.universe] <= UNIVERSE_ORDER[b.universe] ? a : b));
  // ⚠ AND THE UNIVERSE WORD IS ONLY TRUE WHEN NOTHING NARROWED IT. "Banks with market cap above
  //   20,000 cr and P/E below 15" searched 1,779 — the intersection — and SAID "1,779 companies with a
  //   sector on file", which is a false statement about our data: 2,290 carry a sector. The number was
  //   right and the noun attached to it was not, which is worse than either alone, because a reader
  //   checking that figure against the sector page would find it wrong and have no idea why.
  return {
    matched, population, leaves, names,
    narrowest: {
      universe: narrowestLeaf.universe,
      size: population.size,
      intersected: population.size !== narrowestLeaf.population.size,
      words: narrowestLeaf.populationWords,
    },
  };
}
