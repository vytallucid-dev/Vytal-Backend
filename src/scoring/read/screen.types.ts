// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE SCREEN — the shapes a conversation is allowed to see of a NUMERIC filter over the universe.
//
// Sibling of universe-projection.types.ts, and deliberately NOT a slice of it. The projection answers
// seven fixed questions; this answers one open question — "which companies clear a number the reader
// chose" — whose result shape (a list of companies WITH their values) no slice has.
//
// ── ★ THE FIELD REGISTRY IS THE WHOLE CONTRACT ─────────────────────────────────────────────────────
// Every design ruling from the recon lives in SCREEN_FIELDS below, as data rather than as discipline:
//
//   · RAW VALUES ONLY, PERMANENTLY. A field names `metricKeys`, and the reader is `raw_value`. There is
//     no field on this type through which a 0–100 metric score could travel. That is not a v1 scope
//     cut: metricScore = (L1+L2+L3)/3 embeds peer μ/σ and own-history stats published NOWHERE, so it
//     leaks strictly more than the L1 bars — and `ai/grounding.ts` already withholds that whole class
//     (per-metric weights, pillar zone marks, band cuts, the ownership formula) for the same reason.
//     Raw figures are already on the stock page and in getStockFundamentals; they disclose nothing new.
//
//   · score_metrics.raw_value, NEVER fundamentals.*. The fundamentals table carries its own roe / roce /
//     debt_to_equity / interest_coverage columns and they DISAGREE with the scored values on most of
//     the universe — measured: F2 vs `roe` differs on 78 of 82, and F4 vs `debt_to_equity` is not even
//     the same unit (WIPRO 0.10 vs 19.07, ITC 0.03 vs 3.02). Chat stating a different ROE than the
//     stock page is the defect this whole build exists to avoid.
//
//   · COVERAGE IS PARTITIONED BY PEER GROUP, NOT RANDOM. The metric SET is a property of the pond:
//     IT Services carries no M5 (those companies have no debt), Power scores M1_OPM_TTM instead of M1,
//     banks are on a different metric family entirely. So a bare list of 32 out of an implied 94 is
//     dishonest, and `Evaluable` below is the fix — every result states what it could not test and why.
//
//   · WHAT IS NOT HERE IS AS LOAD-BEARING AS WHAT IS. F10/M3/M4 (4 of 94), F1_OPM (7), F9 (median 100
//     — a threshold on it splits the universe into "almost all" or "almost none"), every banking
//     metric (v2), price, market cap, shareholding %. None of them has a `ScreenFieldId`, so the tool
//     cannot accept them and the model cannot ask for them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { Capped, CompanyRef, PeriodContract, UniverseScopeId } from "./universe-projection.types.js";

// ── THE FIELDS ─────────────────────────────────────────────────────────────────────────────────────

/** The reader-facing field names. This union IS the schema enum — they cannot drift. */
export const SCREEN_FIELDS_IDS = [
  // score-level — free, straight off the cached universe view
  "health",
  "foundation",
  "momentum",
  "market",
  "ownership",
  // metric-level — one score_metrics read, raw values only
  "returnOnCapital",
  "returnOnEquity",
  "cashConversion",
  "debtToEquity",
  "interestCoverage",
  "receivableDays",
  "assetTurnover",
  "netMargin",
  "operatingMargin",
] as const;

export type ScreenFieldId = (typeof SCREEN_FIELDS_IDS)[number];

/** How a value is said. Drives the rendered unit — never a bare number. */
export type ScreenUnit = "points" | "percent" | "ratio" | "times" | "days";

export interface ScreenField {
  id: ScreenFieldId;
  /** The words a reply uses. Never a metric code. */
  label: string;
  unit: ScreenUnit;
  /** `score` reads the cached member row; `metric` needs the score_metrics read. */
  tier: "score" | "metric";
  /**
   * Engine metric keys, first match wins. More than one ONLY where the engine itself pins them as the
   * same definition — see `operatingMargin`. INTERNAL: never rendered, never accepted as input.
   */
  metricKeys?: readonly string[];
  /** Higher is better? Used only to order a spread's narrative, never to judge a company. */
  higherBetter: boolean;
}

/**
 * ★ THE REGISTRY. Nine metric fields and five score fields — every one of them measured at ≥97.6% of
 * the population it is defined over.
 *
 * `operatingMargin` is the ONLY multi-key field. `metric-scoring/definition-guard.ts` pins
 * M1_OPM_TTM's signature as "= M1 (the SHARED EBITDA m1TtmOpm, emit-renamed)" and its `rejects` as
 * "a separate PG8-only OPM definition (there is none — M1 and M1_OPM_TTM are identical)". The union is
 * therefore a rename, not a blend of two definitions — and it is asserted at load, not assumed
 * (see assertOperatingMarginUnionStillValid in screen.service.ts).
 */
export const SCREEN_FIELDS: Readonly<Record<ScreenFieldId, ScreenField>> = {
  health: { id: "health", label: "health score", unit: "points", tier: "score", higherBetter: true },
  foundation: { id: "foundation", label: "Foundation", unit: "points", tier: "score", higherBetter: true },
  momentum: { id: "momentum", label: "Momentum", unit: "points", tier: "score", higherBetter: true },
  market: { id: "market", label: "Market", unit: "points", tier: "score", higherBetter: true },
  ownership: { id: "ownership", label: "Ownership", unit: "points", tier: "score", higherBetter: true },

  returnOnCapital: { id: "returnOnCapital", label: "return on capital employed", unit: "percent", tier: "metric", metricKeys: ["F1"], higherBetter: true },
  returnOnEquity: { id: "returnOnEquity", label: "return on equity", unit: "percent", tier: "metric", metricKeys: ["F2"], higherBetter: true },
  cashConversion: { id: "cashConversion", label: "cash conversion", unit: "ratio", tier: "metric", metricKeys: ["F3"], higherBetter: true },
  debtToEquity: { id: "debtToEquity", label: "debt to equity", unit: "ratio", tier: "metric", metricKeys: ["F4"], higherBetter: false },
  interestCoverage: { id: "interestCoverage", label: "interest coverage", unit: "times", tier: "metric", metricKeys: ["F5"], higherBetter: true },
  receivableDays: { id: "receivableDays", label: "receivable days", unit: "days", tier: "metric", metricKeys: ["F6"], higherBetter: false },
  assetTurnover: { id: "assetTurnover", label: "asset turnover", unit: "times", tier: "metric", metricKeys: ["F7"], higherBetter: true },
  netMargin: { id: "netMargin", label: "net margin", unit: "percent", tier: "metric", metricKeys: ["M2"], higherBetter: true },
  operatingMargin: { id: "operatingMargin", label: "operating margin", unit: "percent", tier: "metric", metricKeys: ["M1", "M1_OPM_TTM"], higherBetter: true },
};

// ── THE REQUEST ────────────────────────────────────────────────────────────────────────────────────

/**
 * One condition. `min`/`max` BOTH absent is legal and is not an error — it is the request for that
 * field's SPREAD. That is the shape that makes "show me good ROE" answerable without Vytal choosing a
 * number: there is nowhere in this type for a threshold the caller did not supply.
 *
 * ── ★ BOTH BOUNDS ARE INCLUSIVE, AND ON THIS DATA THAT IS NOT A DETAIL ─────────────────────────────
 * `min` keeps v ≥ min; `max` keeps v ≤ max. Measured on the live cross-section, the boundary is
 * POPULATED rather than theoretical: the Ownership pillar takes only 17 distinct values across 94
 * companies and is modal at exactly 75 (38 companies) and exactly 80 (22). So "Ownership at least 75"
 * returns 75 companies inclusive and 37 exclusive — the convention moves 38 names, not a rounding
 * edge. Two companies (AUROPHARMA, NHPC) sit at Ownership exactly 70.0000 and are the whole difference
 * between the 23 an exclusive read gives for "Ownership 70+ with Foundation under 60" and the 25 this
 * gives.
 *
 * Inclusive is chosen because it is the screener convention `min`/`max` already means everywhere, and
 * because the error it cannot make is the one a reader would notice: a company sitting exactly on the
 * bar genuinely does meet "at least". The tool description states this outright rather than leaving
 * the model to infer it from "above".
 */
export interface ScreenCondition {
  field: ScreenFieldId;
  /** Inclusive lower bound — keeps values ≥ min. */
  min?: number;
  /** Inclusive upper bound — keeps values ≤ max. */
  max?: number;
}

export type RedFlagFilter = "none" | "any";

export interface ScreenRequest {
  conditions: ScreenCondition[];
  scope?: UniverseScopeId;
  band?: string;
  sector?: string;
  redFlags?: RedFlagFilter;
  sort?: "health" | "field";
}

// ── EVALUABILITY — the denominator, on every result ────────────────────────────────────────────────

/**
 * ★ WHY THIS IS A TYPE AND NOT A SENTENCE. `Capped` exists because a bare array of 12 reads as "there
 * are 12". This exists for the mirror failure: a bare list of 32 reads as "32 of everything Vytal
 * scores". It is not. "ROE above 20%" is a question about the 82 non-financial companies; the 12 banks
 * are scored on a different metric family and are not comparable on it — a real state, not a gap.
 *
 * `reasons` is a LIST because there are genuinely two causes and they need different sentences:
 * banking-vs-non-financial, and a metric its own peer group does not score.
 */
export interface EvaluableReason {
  /** Reader-facing, whole sentence, no codes. */
  reason: string;
  count: number;
  companies: Capped<CompanyRef>;
}

export interface Evaluable {
  /** Companies that entered the screen at all (after scope + structural filters). */
  considered: number;
  /** Companies testable against EVERY numeric condition asked for. */
  evaluable: number;
  /** considered − evaluable. */
  notEvaluable: number;
  reasons: EvaluableReason[];
}

// ── THE RESULTS ────────────────────────────────────────────────────────────────────────────────────

/** One value on one company, already carrying its unit. Rows never ship bare numbers. */
export interface ScreenValue {
  field: ScreenFieldId;
  label: string;
  value: number;
  unit: ScreenUnit;
}

/**
 * ★ EVERY ROW CARRIES ITS VALUES. A list of names beside a list of thresholds is two adjacent lists,
 * and the last build measured what a model does with those: handed four flags-with-counts and a
 * separate union of six companies, it PAIRED THEM and got five of six attributions wrong, with total
 * confidence, from individually-true facts. The join is supplied here rather than left to be guessed.
 */
export interface ScreenRow extends CompanyRef {
  score: number;
  band: string;
  values: ScreenValue[];
}

/** A condition as APPLIED — echoed back with its own evaluable count, so a narrowing is attributable. */
export interface AppliedCondition {
  field: ScreenFieldId;
  label: string;
  unit: ScreenUnit;
  min: number | null;
  max: number | null;
  /** How many of `considered` carry a value for THIS field. */
  evaluable: number;
}

export interface StructuralFilters {
  band: string | null;
  sector: string | null;
  redFlags: RedFlagFilter | null;
}

export interface MatchesResult {
  kind: "matches";
  scope: UniverseScopeId;
  period: PeriodContract;
  conditions: AppliedCondition[];
  structural: StructuralFilters;
  evaluable: Evaluable;
  matches: Capped<ScreenRow>;
  /**
   * ★ EVERY MATCHING SYMBOL, UNCAPPED — for INTERSECTING with another universe, never for rendering.
   *
   * ⚠ `matches` is `Capped` at the table's transport budget, and an intersection computed from a
   *   capped list is silently wrong: "health above 70 and revenue above 100cr" would drop every
   *   scored company past the 60th and report the result as the whole overlap. A cap is a rendering
   *   decision; a set operation must see the set.
   *
   * Symbols only, and bounded by the scored universe itself (95), so this cannot become a second fat
   * payload.
   */
  matchedSymbols: string[];
  /** Reader-facing description of the ordering, e.g. "health score, highest first". */
  sortedBy: string;
}

/** One field's distribution across the evaluable set. The answer to an unspecified threshold. */
export interface FieldSpread {
  field: ScreenFieldId;
  label: string;
  unit: ScreenUnit;
  higherBetter: boolean;
  evaluable: Evaluable;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

/**
 * ★ RETURNED WHEN A CONDITION NAMED A FIELD AND NO NUMBER. Not an error, and not a guess.
 *
 * The reason this is defensible where inventing a threshold is not: p25/median/p75 are DESCRIPTIVE
 * STATISTICS OF THE LIVE CROSS-SECTION, and `slice=overview` already publishes exactly this shape for
 * the composite ("the middle half sits between 61.9 and 72.7"). The reader gets what they need in
 * order to choose; Vytal states no view about what a good number would be.
 */
export interface SpreadResult {
  kind: "spread";
  scope: UniverseScopeId;
  period: PeriodContract;
  spreads: FieldSpread[];
  structural: StructuralFilters;
}

/**
 * The caller named something that is not Vytal's vocabulary. Distinct from an empty match on purpose —
 * "no companies matched" and "that is not one of Vytal's five bands" are different answers, and
 * mapping an unknown word onto the nearest band is the guess this build refuses everywhere else.
 */
export interface UnrecognisedResult {
  kind: "unrecognised";
  scope: UniverseScopeId;
  what: "band" | "sector";
  given: string;
  /** The real vocabulary, so the reply is an alternative rather than an apology. */
  available: string[];
}

/** Scope resolved to nothing, or the universe has no in-force scores. A real state, never an error. */
export interface EmptyResult {
  kind: "empty";
  scope: UniverseScopeId;
  reason: "universe-unscored" | "scope-empty";
}

export type ScreenProjection = MatchesResult | SpreadResult | UnrecognisedResult | EmptyResult;
