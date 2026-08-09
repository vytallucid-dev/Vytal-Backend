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
import type { BriefPayload } from "../../insight/quarter-brief/schema.js";
import type { PersonalSection } from "../../insight/quarter-brief/personal.js";

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
 *  - 'complete'   — window elapsed, with a post-filing close and ≥ MIN points.
 *  - 'forming'    — window still open. INCLUDES a result filed today, which has a baseline
 *                   and a run-up but no post-filing close yet: not-yet-opened, not absent.
 *  - 'unavailable'— no pre-filing baseline or no points at all; or a CLOSED window that
 *                   never printed a post-filing close, or is too sparse to draw. */
export type ReactionState = "complete" | "forming" | "unavailable";

export interface MarketReaction {
  reactionState: ReactionState;
  /** true ⇔ complete or forming (baseline + ≥1 point → render the line). */
  available: boolean;
  filingDate: string;
  windowFrom: string;
  windowTo: string;
  points: ReactionPoint[]; // ascending; empty when unavailable
  /** ★ Last close STRICTLY BEFORE filingDate — never the filing day's own close, which
   *  already carries the reaction. Null when the stock has no close in the lead window
   *  (first-ever result, or coverage starting on the filing date), and when unavailable. */
  preClose: number | null;
  /** Closes STRICTLY AFTER filingDate. 0 for a result filed today — a forming window that
   *  has not opened yet, which the viewer states as such rather than as "0 of ~N". */
  tradingDaysSinceFiling: number;
  /** The window's nominal length in trading days, DERIVED from the served window (weekdays
   *  after the filing through windowTo). Approximate — holidays are not modelled — so the
   *  viewer renders it prefixed "~". Served so the denominator cannot drift from the window. */
  expectedTradingDays: number;
}

/**
 * ⚠ NO `sentiment` FIELD, AND IT IS NOT AN OMISSION (removed 2026-08-09).
 *
 * This read-model used to carry `stock_news.sentiment` straight through, and the Context tab
 * rendered it — unlabelled, next to the source and date, guarded only by `sentiment &&`. Nothing
 * has ever written the column (0 of 30,083 rows), so it never appeared; the day anything wrote one
 * it would have shipped a verdict onto a reader's screen with no announcement and no review.
 *
 * The decision is "no sentiment", not "sentiment later" — see the header of
 * Vytal-Frontend/components/stock-detail/news.tsx for the full reasoning. The short form: a chip is
 * not text, so the guardrail's evaluative tier cannot see it, and that tier's `attributed` flag is
 * the only thing that makes a verdict acceptable. A field bypasses the scanner rather than being
 * exempted from it.
 *
 * The COLUMN survives (a licensed source with real article text could justify revisiting the
 * question); the PATH to a renderer does not. Do not re-add the field here.
 */
export interface ViewerNews {
  id: string;
  /**
   * ★ SERVED SO THE VIEWER CAN BRANCH ON THE STREAM RATHER THAN GUESS FROM A LABEL.
   * The two streams are not symmetric — on a filing, `headline` is a type bucket and `summary` is the
   * real content; on a press item, `headline` is the article title and `summary` is that same headline
   * with the publisher appended (zero information). A renderer MUST switch on this field. Sniffing
   * `source === "NSE Announcement"` would be a string coincidence, and comparing `summary` to
   * `headline` is the value test that already shipped the duplicate once.
   */
  sourceType: "nse_announcement" | "google_news";
  headline: string;
  /** Filing: the real excerpt (hero). Press: "{headline} {publisher}" — never render it. */
  summary: string | null;
  source: string;
  category: string | null;
  /** Press only: the publisher's real host from the RSS `<source url>`. Null on older rows. */
  publisherDomain: string | null;
  publishedAt: string; // ISO
  url: string | null;
  pdfUrl: string | null;
}

/** The stored Quarter in Brief for the VIEWED period. `available:false` covers three states that are
 *  all one thing to a reader: never generated, generation refused, or marked stale by a correction.
 *  A brief is whole or absent — there is no partial. */
export interface ViewerAi {
  available: boolean;
  /**
   * ★ STAGE 5 — THE STRUCTURED PAYLOAD, NOT PROSE. `null` whenever `available` is false, and also on
   * a stored row that predates the schema and does not parse (defence in depth: the migration marks
   * those stale so this path should never see one).
   *
   * The frontend renders FROM THIS. There is no second formatting layer and no per-card variance —
   * one renderer over one shape, which is the point of the stage.
   */
  payload: BriefPayload | null;
  /** The COMPUTED verdict. Rendered as a badge; never written by the model. */
  verdictKey: string | null;
  verdictLabel: string | null;
  /** As-of date of the pinned health snapshot, or null when the stock was unscored at generation. */
  scoredAsOf: string | null;
  modelVersion: string | null;
  generatedAt: string | null;
  /**
   * ⚠⚠ SECTION 3 — COMPUTED AT READ TIME, PER READER, AND NEVER STORED.
   *
   * It is NOT part of BriefPayload and never will be: personal.ts's header explains that a field on
   * the stored shape is exactly how a reader's position accidentally reaches a model. It is merged
   * onto the RESPONSE, after the payload has been read from the database, and it is null for every
   * anonymous reader and for every reader who neither holds nor watches this stock.
   */
  personal: PersonalSection | null;
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
