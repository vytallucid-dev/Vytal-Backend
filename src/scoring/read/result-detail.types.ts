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
}
