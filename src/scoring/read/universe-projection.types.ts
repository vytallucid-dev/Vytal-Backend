// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNIVERSE PROJECTION — the shapes a conversation is allowed to see of the scored universe.
//
// ── WHY A PROJECTION EXISTS AT ALL ─────────────────────────────────────────────────────────────────
// `UniverseHealthView` is 21,656 tokens, of which members[] alone is 18,222 (94 rows × every pillar,
// every fired finding, every flow state). It was built for a page that renders a sortable table; a
// conversation renders sentences. Handing the model the view — even once — would spend a fifth of the
// context window on rows nobody asked about and carry them on every later turn of the session.
//
// So: SEVEN SLICES, each the minimum that answers ONE question honestly. Never a wrapper, never a
// "compact view" that is the same data with shorter field names. If a question is not on this list,
// the honest answer is that Vytal's chat cannot look it up — see the tool's boundary.
//
// ── ★ THE PERIOD CONTRACT — THE CORRECTNESS CORE, NOT A COSMETIC ───────────────────────────────────
// The universe MIXES FISCAL PERIODS by construction. `resolveCrossSection` keeps every live stock at
// its LATEST in-force snapshot regardless of quarter, so a rollover does not collapse the read: today
// 64 members sit at FY27Q1 and 30 at FY26Q4. `UniverseHealthView.periodKey` is the PLURALITY LABEL of
// that mixture and nothing more.
//
//     "As of FY27Q1, 21 companies are Pristine"   is FALSE. Thirty of those 94 are not at FY27Q1.
//     "each at its most recent reported quarter"  is TRUE, and it is the only true framing.
//
// ⚠ AND THE RISK JUST WENT UP, NOT DOWN. §THE PAGES taught the model to speak about Vytal with
// confidence — which makes a confident FALSE period claim more likely, not less. A prompt line asking
// for the right phrasing would be a request; this is a SHAPE. `PeriodContract` has no `periodKey`
// field to pass through, carries the spread that proves a single label would be false, and states the
// legal phrasing in the payload the model reads. The model cannot state the scope claim from this
// shape without contradicting a number sitting three words away.
//
// ── CAPS ARE STRUCTURAL, NOT EDITORIAL ─────────────────────────────────────────────────────────────
// Every list is a `Capped<T>`: `total` beside `shown`. The model must be able to say "showing 12 of
// 22" from the STRUCTURE, never by inferring truncation from a short list. A bare array of 12 reads as
// "there are 12".
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

import type { LabelBand, PillarKey } from "./health-view.types.js";

/** The seven questions. One tool, this enum — see chat/tools/get-universe-scan.ts for why seven
 *  separate tools was measured and rejected. */
export const UNIVERSE_SLICES = [
  "overview",
  "band",
  "finding",
  "census",
  "movers",
  "divergence",
  "week",
] as const;

export type UniverseSliceId = (typeof UNIVERSE_SLICES)[number];

/** The scope a slice was computed over. `universe` is public product data; the other two are the
 *  signed-in reader's own and are resolved SERVER-SIDE from ctx.userId (Stage 4) — never named by
 *  the model. */
export const UNIVERSE_SCOPES = ["universe", "portfolio", "watchlist"] as const;
export type UniverseScopeId = (typeof UNIVERSE_SCOPES)[number];

/** A bounded list. `total` is the real count; `shown` is what fits. */
export interface Capped<T> {
  total: number;
  shown: T[];
}

/**
 * ★ THE PERIOD CONTRACT. Deliberately has NO `periodKey` field — there is no shape here through
 * which a plurality label can travel as a scope claim.
 */
export interface PeriodContract {
  /** The freshest rescore date across the read (YYYY-MM-DD). A DATE, not a quarter. */
  asOfDate: string | null;
  /** How many companies this read covers. */
  companiesRead: number;
  /** ★ THE PROOF that one quarter label would be false: which reported quarters the companies in
   *  this read actually sit at, and how many at each. Sorted by count, descending. */
  spread: { period: string; count: number }[];
  /** true when `spread` has more than one entry — i.e. no single quarter describes the read. */
  mixed: boolean;
  /** Names held OUT of the read because they are no longer being rescored (delisted / gone dark),
   *  each with the last quarter Vytal has for them. Capped; `total` is the real count. */
  notRescored: Capped<{ symbol: string; lastQuarter: string }>;
}

/** A company as a conversation names one: ticker + real name. Never an id. */
export interface CompanyRef {
  symbol: string;
  name: string;
}

export interface ScoredCompany extends CompanyRef {
  score: number;
  band: string;
}

// ── OVERVIEW ───────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ `UniverseAggregate.descriptor` IS DELIBERATELY ABSENT from this slice. `describeScope` renders
 * the median member's band through its own word list (BAND_WORD in scope-aggregate.ts), on which
 * `pristine` → "strong" and `below_par` → "weak". "Strong" is a PORTFOLIO-ladder word; the context
 * layer states outright that a stock is never "Strong". Feeding the model "strong, varied" about a
 * set of STOCKS invites it to cross the two ladders in exactly the way §BANDS forbids. The band
 * distribution and the median below say the same thing in ladder-correct words.
 */
export interface OverviewSlice {
  slice: "overview";
  scope: UniverseScopeId;
  period: PeriodContract;
  companiesScored: number;
  medianScore: number;
  meanScore: number;
  /** Median move versus each company's own previous reported quarter. null at the earliest period. */
  medianQuarterMove: number | null;
  /** The middle half of the distribution. */
  p25: number;
  p75: number;
  stdDev: number;
  lowest: ScoredCompany | null;
  highest: ScoredCompany | null;
  /** Strongest band first. */
  bands: { band: string; count: number }[];
  pillarMedians: { pillar: string; median: number }[];
  redFlagCompanies: number;
}

// ── BAND ───────────────────────────────────────────────────────────────────────────────────────────

export interface BandSlice {
  slice: "band";
  scope: UniverseScopeId;
  period: PeriodContract;
  companiesScored: number;
  bands: { band: string; count: number }[];
  /** Present only when the caller named a band. `members` is score-descending. */
  focus: {
    band: string;
    count: number;
    members: Capped<ScoredCompany>;
  } | null;
  /** Set when the caller named something that is not one of the five bands — an honest miss, with
   *  the real vocabulary, never a guess at what they meant. */
  unrecognisedBand: string | null;
}

// ── FINDING (one named finding, drilled into) ──────────────────────────────────────────────────────

export interface FindingDetail {
  name: string;
  description: string;
  doesntMean: string;
  kind: "red flag" | "pattern";
  firingCount: number;
  outOf: number;
  members: Capped<CompanyRef>;
  /**
   * The constituent findings behind a composite row: the ≤2 dominant sub-types on a consolidated
   * divergence (§5C), or every red flag behind the "Red Flags" family row.
   *
   * ★ `members` EXISTS BECAUSE OF A MEASURED FABRICATION. Live, the family row handed the model four
   * flags-with-counts and a union of six companies — two adjacent lists with no mapping between them —
   * and it PAIRED THEM UP: "Interest Coverage Collapse (State Bank of India), Pledging Crisis
   * (Glenmark), Promoter Exit (Infosys)". Five of six attributions were wrong, stated with total
   * confidence, and every individual fact on the page was true. Adjacent lists are an invitation to
   * join them, and the fix is not a warning — it is supplying the join. Absent on divergence, where
   * naming 38 companies per sub-form would be noise and the row is one finding anyway.
   */
  subTypesShown?: { name: string; firingCount: number; members?: Capped<CompanyRef> }[];
  subTypesTotal?: number;
}

export interface FindingSlice {
  slice: "finding";
  scope: UniverseScopeId;
  period: PeriodContract;
  query: string;
  finding: FindingDetail | null;
  /** When `finding` is null: the names that ARE firing, so the reply is a real alternative rather
   *  than an apology. Capped. */
  available: Capped<string>;
  /**
   * Set when the caller named a REAL Vytal family this slice cannot select over — "patterns" today.
   * Distinct from a plain miss on purpose: "patterns is not a finding Vytal computes" would deny our
   * own published vocabulary, which is the §THE PAGES failure at a smaller scale. A redirect names
   * the slice that does answer it.
   */
  unselectableFamily: string | null;
}

// ── CENSUS (the whole board, named) ────────────────────────────────────────────────────────────────

export interface CensusRow {
  name: string;
  description: string;
  kind: "red flag" | "pattern";
  firingCount: number;
  outOf: number;
}

export interface CensusSlice {
  slice: "census";
  scope: UniverseScopeId;
  period: PeriodContract;
  outOf: number;
  /** Companies firing at least ONE red flag — the distinct union, not a sum of rows. */
  redFlagCompanies: Capped<CompanyRef>;
  /** Severity-worst first, then by how many companies fire it. */
  rows: Capped<CensusRow>;
}

// ── MOVERS (quarter on quarter) ────────────────────────────────────────────────────────────────────

export interface MoverRow extends CompanyRef {
  score: number;
  priorScore: number;
  delta: number;
}

export interface MoversSlice {
  slice: "movers";
  scope: UniverseScopeId;
  period: PeriodContract;
  risers: Capped<MoverRow>;
  slippers: Capped<MoverRow>;
  /** Companies with no prior quarter to compare against, or that did not move. */
  unchangedOrNoPrior: number;
}

// ── DIVERGENCE (the §5C consolidated row) ──────────────────────────────────────────────────────────

export interface DivergenceSlice {
  slice: "divergence";
  scope: UniverseScopeId;
  period: PeriodContract;
  outOf: number;
  /** null when no divergence sub-type fired anywhere in scope — an honest empty, not an error. */
  detail: FindingDetail | null;
}

// ── WEEK (the trailing 7 days) ─────────────────────────────────────────────────────────────────────

export interface WeekMove extends CompanyRef {
  score: number;
  priorScore: number;
  delta: number;
  fromBand: string;
  toBand: string;
}

export interface WeekSlice {
  slice: "week";
  scope: UniverseScopeId;
  period: PeriodContract;
  windowStart: string;
  rescored: number;
  bandCrossings: Capped<CompanyRef & { from: string; to: string; direction: "up" | "down" }>;
  /** Findings that were NOT firing at the start of the window and are firing now. Named, never keyed. */
  newFindings: Capped<CompanyRef & { finding: string }>;
  improved: Capped<WeekMove>;
  slipped: Capped<WeekMove>;
  /** The read layer's own honest note about what a 7-day window on quarterly data can and cannot show. */
  note: string;
}

// ── the union + the honest-empty ───────────────────────────────────────────────────────────────────

/** Returned instead of a slice when the scope is empty (a reader who holds nothing Vytal scores) or
 *  the universe has no in-force snapshots at all. A real state, never an error. */
export interface EmptySlice {
  slice: "empty";
  scope: UniverseScopeId;
  requested: UniverseSliceId;
  reason: "universe-unscored" | "scope-empty";
}

export type UniverseProjection =
  | OverviewSlice
  | BandSlice
  | FindingSlice
  | CensusSlice
  | MoversSlice
  | DivergenceSlice
  | WeekSlice
  | EmptySlice;

/** What a caller asks for. `band` / `finding` are the two slice-specific arguments. */
export interface UniverseProjectionRequest {
  slice: UniverseSliceId;
  scope?: UniverseScopeId;
  band?: string;
  finding?: string;
}

/**
 * The five band words, Title Case, exactly as §VOCABULARY publishes them. TOTAL over LabelBand, so a
 * sixth band would not compile.
 *
 * ⚠ NOT `LABEL_BAND_MAP` (composite/label.ts) and NOT `BAND_WORD` (scope-aggregate.ts). The first
 * labels pristine "Pristine — fully priced" (a valuation clause the band ladder does not carry); the
 * second maps pristine→"strong" and below_par→"weak", and "Strong" is a PORTFOLIO-ladder word the
 * context layer forbids applying to a stock. Both would put the wrong word in a reader's ear.
 *
 * ★ IT LIVES HERE, NOT IN A SERVICE, because getFindingsForSymbols needs the same five words and a
 * second copy is how `below_par` reaches a reader on the one surface that forgot.
 */
export const BAND_LABEL: Readonly<Record<LabelBand, string>> = {
  pristine: "Pristine",
  healthy: "Healthy",
  steady: "Steady",
  below_par: "Below Par",
  fragile: "Fragile",
};

/** Strongest first — the order a reader hears them ranked. */
export const BAND_ORDER: readonly LabelBand[] = ["pristine", "healthy", "steady", "below_par", "fragile"];

/** Pillar display names — the context layer's exact vocabulary. Total over PillarKey. */
export const PILLAR_LABEL: Readonly<Record<PillarKey, string>> = {
  foundation: "Foundation",
  momentum: "Momentum",
  market: "Market",
  ownership: "Ownership",
};
