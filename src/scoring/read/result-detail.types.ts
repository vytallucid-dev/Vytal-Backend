// File: src/scoring/read/result-detail.types.ts
//
// Read-model for the per-result VIEWER — GET /api/v1/results/:symbol[?period=FY26Q4].
// ONE stock + ONE result quarter, with the 8-quarter spine for context and four
// independently-honest-empty context blocks (market reaction, news, AI, peers).
//
// UNITS: money ₹ Crore; growth/margins PERCENT (already canonical in source). Every
// block carries a `null`/empty + key-present so a partial quarter never blanks the
// viewer. NO beat/miss, NO reaction verdict, NO fabricated expense line-items or
// commentary — absent data is stated, never invented.

import type { FindingsSection, LabelBand } from "./health-view.types.js";

/** One quarter, unified across families (topline is family-appropriate). */
export interface ViewerQuarter {
  periodKey: string; // "FY26Q4"
  quarter: string; // "Q4"
  fiscalYear: string; // "FY26"
  reportDate: string; // YYYY-MM-DD (period end)
  filingDate: string; // YYYY-MM-DD (filed with NSE)
  resultType: string; // "consolidated" | "standalone"
  xbrlUrl: string;

  revenue: number | null; // ₹ Cr (family topline)
  revenueLabel: string; // "Revenue" | "Net interest income" | "Net premium" | …
  revenueYoy: number | null; // %
  revenueQoq: number | null; // %

  operatingProfit: number | null; // ₹ Cr — non-financial only (else null)
  profitBeforeTax: number | null; // ₹ Cr
  tax: number | null; // ₹ Cr
  netProfit: number | null; // ₹ Cr
  profitYoy: number | null; // %
  profitQoq: number | null; // %

  operatingMargin: number | null; // % — non-financial only
  netMargin: number | null; // %
  margin: number | null; // headline margin (op for non-fin, net for fin)
  marginLabel: string; // "Op margin" | "Net margin"
}

/** A single daily close around the filing date. No verdict — the user reads the path. */
export interface ReactionPoint {
  date: string; // YYYY-MM-DD
  close: number;
  isFilingDay: boolean;
}

/** Three honest states:
 *  - 'complete'   — full T+12 window elapsed, ≥ MIN points, pre-filing base present.
 *  - 'forming'    — window still open (filing < ~20 cal days ago), pre-base + ≥1 post day.
 *  - 'unavailable'— no pre-filing base, or no post-filing days, or sparse & window closed. */
export type ReactionState = "complete" | "forming" | "unavailable";

export interface MarketReaction {
  reactionState: ReactionState;
  /** true ⇔ complete or forming (pre-base + ≥1 post day → render the line). */
  available: boolean;
  filingDate: string;
  windowFrom: string;
  windowTo: string;
  points: ReactionPoint[]; // ascending; empty when unavailable
  preClose: number | null; // last close on/before filingDate; null when unavailable
  tradingDaysSinceFiling: number; // 0 when unavailable
}

export interface ViewerNews {
  id: string;
  headline: string;
  summary: string | null;
  source: string;
  category: string | null;
  publishedAt: string; // ISO
  url: string | null;
  pdfUrl: string | null;
  sentiment: string | null;
}

export interface ViewerAi {
  /** false ⇔ no real earnings_analysis row → Context shows a marked Phase-2 stub. */
  available: boolean;
  // Only the columns AiSummary actually stores — content, headline, keyPoints (a flat
  // bullet array). The legacy mock invented qoqAnalysis/bottomLine; those are NOT real
  // columns and are deliberately absent here (no fabrication).
  headline: string | null;
  content: string | null;
  keyPoints: string[] | null;
  modelVersion: string | null;
  generatedAt: string | null;
}

export interface ViewerCorpEvent {
  eventType: string;
  eventDate: string;
  description: string | null;
  dividendAmount: number | null;
  dividendType: string | null;
  exDate: string | null;
  recordDate: string | null;
}

export interface ViewerPeer {
  symbol: string;
  name: string;
  revenueYoy: number | null;
  profitYoy: number | null;
  margin: number | null;
  marginLabel: string;
  filed: boolean; // false ⇔ peer hasn't filed this quarter yet
}

export interface PeriodRef {
  periodKey: string;
  quarter: string;
  fiscalYear: string;
}

/** SCORING CONTEXT for the viewed result — surfaced via ONE extra read
 *  (buildHealthSnapshotView). composite/band are FOR THE VIEWED RESULT PERIOD (read from the
 *  trajectory series by periodKey), NOT the latest snapshot. compositeShift is a whole-snapshot
 *  move (fundamentals + price + ownership + flags) from the prior in-force period — it is NOT
 *  "this result caused X" (the frontend frames it as "composite moved ±X from {priorPeriodKey}").
 *  findings are the engine's CURRENT fired set (latest snapshot); they describe the viewed result
 *  only when `latestPeriodKey` equals the viewed period. Everything honest-empties (null) when the
 *  stock/period isn't scored — never fabricated. */
export interface ResultHealthBlock {
  /** false when the stock has no in-force snapshot at all (covered / off-platform). */
  scored: boolean;
  /** The latest in-force period the `findings` below describe; null when unscored. */
  latestPeriodKey: string | null;
  /** Composite FOR THE VIEWED period (trajectory series @ periodKey). null when the viewed
   *  period is not a scored in-force period (unscored, or scoring lags this filing). */
  periodComposite: number | null;
  /** Band FOR THE VIEWED period (trajectory series @ periodKey). null when not scored. */
  periodBand: LabelBand | null;
  /** Whole-snapshot composite move from the prior in-force period to the viewed one.
   *  null when no prior in-force period precedes the viewed period. */
  compositeShift: { delta: number; priorPeriodKey: string } | null;
  /** Fired red flags + patterns (latest snapshot). null when unscored. */
  findings: FindingsSection | null;
}

/** Family tag for the annual block — which family's annual shape this is. */
export type ResultFamily =
  | "non_financial"
  | "banking"
  | "nbfc"
  | "life_insurance"
  | "general_insurance";

/** One labeled annual line. `value` is ₹ Cr for money lines, ₹ for per-share (see `unit`).
 *  null when the line is undisclosed in the filing — an honest "—", not a fabricated zero. */
export interface AnnualLine {
  key: string;
  label: string;
  value: number | null;
  unit: "cr" | "rupees";
}

/** ANNUAL (full-year) cash-flow + balance-sheet HEADLINE for the viewed result — the
 *  family-appropriate AnnualSnapshot subset from buildFundamentalsView (the SAME per-family
 *  dispatch the Fundamentals tab uses — no new shapes). Present ONLY when the family's latest
 *  annual `fiscalYear` matches the viewed result (the annual read returns the NEWEST year, so it
 *  lines up with the latest Q4 only — older quarters get `not_filed`, never a stale prior year).
 *  Each line is null when undisclosed (BS lines ~24% null is normal) — the block is still shown
 *  and per-line "—" is honest, distinct from "annual not filed". */
export interface AnnualResultBlock {
  /** Which family's annual shape this carries (drives the UI's section labels). */
  family: ResultFamily;
  fiscalYear: string;
  /** Balance-sheet headline lines, family-appropriate, ordered for display (₹ Cr). */
  balanceSheet: AnnualLine[];
  /** Cash-flow lines (operating / investing / financing, ₹ Cr). null ⇒ the family's annual
   *  carries NO cash-flow statement (insurers) — a REAL absence; the UI renders "not applicable
   *  for insurers", never an empty-data bug. */
  cashFlow: AnnualLine[] | null;
  /** Per-share lines — basic EPS, book value / share (₹). */
  perShare: AnnualLine[];
}

/** Why the annual block is / isn't present:
 *  - available — block present (the family's annual FY matches this result).
 *  - not_filed — no annual row matches this result's FY yet (older quarter, or the year-end
 *    annual not yet on file / family payload absent). Every family now has a real annual shape,
 *    so there is no "unsupported family" state. */
export type AnnualResultState = "available" | "not_filed";

export interface ResultDetailData {
  symbol: string;
  name: string;
  sector: string | null;
  industryType: string;
  basis: string; // chosen result basis (consolidated | standalone)

  current: ViewerQuarter;
  prevQuarter: ViewerQuarter | null; // QoQ base
  sameQuarterLastYear: ViewerQuarter | null; // YoY base
  spine: ViewerQuarter[]; // oldest → newest (≤ 12)
  periodsAvailable: PeriodRef[]; // newest → oldest, for the quarter navigator

  marketReaction: MarketReaction;
  news: ViewerNews[];
  ai: ViewerAi;
  corporateEvents: ViewerCorpEvent[];
  peers: ViewerPeer[];
  peerGroupName: string | null;

  /** Scoring context (findings + viewed-period composite/band + composite-shift). null only
   *  when the symbol is unknown to scoring (defensive — the viewer's stock already resolved). */
  health: ResultHealthBlock | null;
  /** Annual CF + BS-headline — present only when `annualState === "available"`. */
  annual: AnnualResultBlock | null;
  annualState: AnnualResultState;
}
