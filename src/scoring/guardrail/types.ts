// File: src/scoring/guardrail/types.ts
//
// GUARDRAIL LAYER (Layer 1) — shared types. This is the GATE that runs BEFORE the
// Layer-2 scoring engine (per docs/Vytal_Guardrail_Layer_Phase1_Design.md §0.1,
// the two-layer pipeline). It detects distortions via SIGNATURES, resolves each to
// one of the SIX OUTCOMES (§0.6), and emits suppression DIRECTIVES + AUDIT rows.
//
// SCOPE OF THIS FILE: the framework SPINE only — the contracts every one of the 10
// signatures plugs into. The actual signatures live in ./signatures/. Phase-1 wires
// exactly ONE (A-2 Missing Critical Fields); the other nine are declared in the
// registry as not-yet-built so the gate is structurally complete.
//
// THE LOAD-BEARING SEAM (§0.8, locked): when a signature resolves to O2 the gate
// writes ONE score_suppressions row carrying BOTH excludeFromOwnScore AND
// excludeFromPeerMean = true. That single row is read by the ALREADY-BUILT consumer
// (metric-scoring/wire.ts via the SuppressionDirective predicate) and forces the
// suppressed metric out of (a) the stock's own pillar AND (b) every peer's μ/σ —
// from the same row, not two mechanisms (CN-1 anti-drift). We BUILD THE PRODUCER
// here; the consumer already exists.

// ── Mirror schema enum GuardrailOutcome (prisma/schema.prisma) ──────────────────
/** The entire action space (§0.6). O1 score normally · O2 suppress affected
 *  metric(s) [dual-exclusion §0.8] · O3 annotate (no math change) · O4 suppress
 *  peer comparison only (own-score kept) · O5 hold (freeze last clean) · O6 remove
 *  (exit scoring + peer set). */
export type Outcome = "O1" | "O2" | "O3" | "O4" | "O5" | "O6";

/** Mirror schema enum GuardrailTier. auto = detection AND response both mechanical
 *  (fixed metrics-affected map) → no operator. review = structural/two-sided call
 *  routed to score_guardrail_reviews (§0.7). */
export type Tier = "auto" | "review";

/** The Phase-1 signature set (§4 signature table). Exactly ONE is built now (A-2);
 *  the rest are declared so the registry/gate are complete and later builds drop in
 *  without reshaping the framework. */
export type SignatureKey =
  // Category A — data integrity / status (auto)
  | "A-1" // stale / non-filed results            → O5 (escalate O6 at 2Q)
  | "A-2" // missing critical fields              → O2 (escalate O5 if pillar floor breaks)  ◀ BUILT
  | "A-3" // insufficient history                 → O2 (lens fallback)
  | "A-4" // inactive / suspended                 → O6 (operator-confirm)
  // Category B — accounting distortion (auto, fixed map)
  | "B-1" // exceptional gain (phantom profit)    → O2 + O3
  | "B-2" // exceptional loss (phantom loss)      → O2 + O3
  | "B-3" // tax-driven distortion                → O3 (O2 if band-flip)
  | "B-4" // other-income inflation               → O3 (O2 if band-flip)
  | "B-5" // holdco extraction                    → O3 annotate (REVIEW)
  // Category C — structural change
  | "C-1" // revenue/asset step-change            → O4 + O3 (REVIEW)
  | "C-2"; // share-count discontinuity           → O1 bonus/split | O3 rights

export type SignatureCategory = "A" | "B" | "B-Bank" | "C";

/** Which pillars a stock routes through. Banking PGs run A + B-Bank + C-1-Bank and
 *  SKIP non-financial B-1…B-4 (§2B routing rule). Carried so the gate can pick the
 *  applicable signature set per stock. */
export type IndustryPath = "non_financial" | "banking";

// ── The data a signature reads to evaluate one stock at one snapshot ─────────────
/** The latest standalone annual fundamental fields A-2 needs. `netWorth` is the
 *  DERIVED net worth (metrics/types.ts netWorthFrom: totalEquity else ESC+otherEquity)
 *  because the schema has no single net-worth column — A-2's rulebook field maps to
 *  that canonical derivation. Future Category-B signatures read more of this row. */
export interface LatestFundamentalInput {
  fiscalYear: string; // the snapshot FY scoring uses (e.g. "FY26")
  revenue: number | null;
  netProfit: number | null;
  netWorth: number | null; // derived (netWorthFrom)
  totalAssets: number | null;
  // ── Category-B fields (optional; A-2 ignores them). The below-the-line family
  //    needs the full P&L line so it can test "bottom-line moved, operating line
  //    flat" (§2). operatingMargin is the stored EBITDA-based % (metrics/types.ts). ──
  profitBeforeTax?: number | null;
  tax?: number | null;
  otherIncome?: number | null;
  financeCosts?: number | null;
  operatingMargin?: number | null; // EBITDA-based %, from stored.operatingMargin
}

/** One stock's full input to the gate. Deliberately a SUPERSET container: A-2 only
 *  reads `latestFundamental`; the optional fields are the seams the other nine
 *  signatures will read (prior-year fundamentals for B-* YoY tests, quarterlies for
 *  A-1 staleness, shareholding for B-5 promoter%, etc.). Absent ⇒ that signature
 *  can't evaluate and returns null (does not fire). */
export interface GuardrailStockInput {
  stockId: string;
  symbol: string;
  industryPath: IndustryPath;
  /** The snapshot the gate is evaluating, as a STRING KEY: periodKey ("FY26Q4")
   *  for quarterly runs, "LIVE:<runId>" for live. This is the score_suppressions
   *  `snapshotKey` — the PG-agnostic lookup the consumer reads by (NOT the
   *  ScoreSnapshot FK; see §ordering note in gate.ts). */
  snapshotKey: string;
  latestFundamental: LatestFundamentalInput | null;
  /** Prior-FY annual fundamental — the YoY base for the Category-B family (B-1…B-5
   *  all test a year-on-year move). */
  priorFundamental?: LatestFundamentalInput | null;
  /** Latest promoter holding % (ShareholdingPattern.promoterPct) — B-5 extraction
   *  signature (promoter > 50%). */
  promoterPct?: number | null;
  /** A-1 staleness facts. `daysPastExpected` = (asOfDate − expected report date)
   *  for the latest expected quarter, null if filed on time / not yet due.
   *  `consecutiveMissedQuarters` drives the 2-quarter → O6 escalation. */
  quarterlyFiling?: { daysPastExpected: number | null; consecutiveMissedQuarters: number } | null;
  /** A-3 history depth. Row counts the existing engine's L3 / Ownership minimums
   *  are tested against (§5.4 / §11.10). */
  history?: { fundamentalRows: number; shareholdingRows: number } | null;
  /** A-4 activity facts. `isActive` = Stock.isActive; `consecutiveNoPriceDays` =
   *  trading-day gap with no DailyPrice row. */
  activity?: { isActive: boolean; consecutiveNoPriceDays: number } | null;
  /** B-3 / B-4 "O2 if band-flip" escalation hint. The escalation needs to know
   *  whether the distortion flips a metric's L1 band — which requires a provisional
   *  SCORE, but the gate runs BEFORE scoring. So a two-pass orchestrator supplies
   *  this on a second pass; absent ⇒ the signature defaults to O3 annotate.
   *  FORWARD-DEPENDENCY — flagged (see b3/b4). */
  bandFlipDetected?: boolean;
  /** Category-C corporate-action facts. C-1 corroboration (a CorporateEvent near the
   *  snapshot — merger/demerger lack a clean enum) + C-2 share-count event/step.
   *  (C-1's revenue/asset STEP is derived from latest/priorFundamental.) */
  corporateAction?: {
    hasNearbyEvent?: boolean; // C-1: a CorporateEvent near the date (corroboration)
    eventTypes?: ("bonus" | "split" | "rights" | "other")[]; // C-2
    shareCountChangePct?: number | null; // C-2: |Δ shares| between periods
  } | null;
}

// ── What a signature returns when it evaluates ───────────────────────────────────
/** A metric the signature affects + WHY. The set of these IS the rulebook's fixed
 *  "metrics affected" map for that signature (§2 — the map makes the response
 *  deterministic, hence auto). Each carries the pillar so the gate can test the
 *  §14.4 pillar-floor when deciding O2-vs-O5 escalation. */
export interface AffectedMetric {
  metricKey: string; // "F1".."F10" | "M1".."M5"
  pillar: "foundation" | "momentum" | "market" | "ownership";
  reason: string; // e.g. "depends on netWorth (null)"
}

/** A fired signature's verdict, BEFORE outcome→directive resolution. `outcome` is
 *  the rulebook outcome this firing resolves to (a signature may pick O2 vs O5 per
 *  its own escalation logic — A-2 does). triggeringValues is the audit payload
 *  (the exact numbers that fired it) → score_guardrail_events.triggering_values. */
export interface SignatureResult {
  signatureKey: SignatureKey;
  category: SignatureCategory;
  tier: Tier;
  fired: boolean;
  outcome: Outcome;
  /** The fixed metrics-affected map for this firing (empty for O5-hold/O6-remove,
   *  which act at the whole-stock level, and for O1). */
  affectedMetrics: AffectedMetric[];
  triggeringValues: Record<string, unknown>;
  /** The user-facing explanation text (§ each signature). Rides with the audit row
   *  and the per-stock flag; never silent (§0.8c transparency). */
  explanation: string;
}

/** A signature: pure detection. `applies` gates by industry path / data presence;
 *  `evaluate` returns a SignatureResult (fired or not) or null when it cannot run
 *  (missing inputs ⇒ "did not evaluate", distinct from "evaluated, did not fire"). */
export interface Signature {
  key: SignatureKey;
  category: SignatureCategory;
  tier: Tier;
  /** True if this signature should run for the given stock (industry path + the
   *  inputs it needs are present). */
  applies(input: GuardrailStockInput): boolean;
  /** Mechanical detection. Returns null if it could not evaluate (treated as
   *  "no opinion"); otherwise a SignatureResult with fired true/false. */
  evaluate(input: GuardrailStockInput): SignatureResult | null;
}

// ── The rows the gate emits (exact prisma shapes; written DRY-RUN in persist.ts) ─
/** score_guardrail_events row — the audit record (§7). One per fired signature per
 *  snapshot. `localEventId` is an in-run uuid the directives reference BEFORE the
 *  DB row exists (the FK is resolved at persist time, post-snapshot — see gate.ts
 *  ordering note). snapshotId (the ScoreSnapshot FK) is filled at persist time. */
export interface GuardrailEventRow {
  localEventId: string; // in-memory correlation id (→ becomes the DB row id at write)
  stockId: string;
  snapshotId: string | null; // ScoreSnapshot FK — null until the snapshot exists (persist)
  signatureKey: SignatureKey;
  triggeringValues: Record<string, unknown>;
  outcome: Outcome;
  tier: Tier;
}

/** score_suppressions row — THE SINGLE SEAM (§0.8). Keyed (stockId, snapshotKey,
 *  metricKey). For O2 BOTH booleans are true (own-score + peer-mean). For O4 only
 *  excludeFromPeerMean is true. Read by the scorer (excludeFromOwnScore) AND the
 *  peer-stats path (excludeFromPeerMean) from THIS one row. */
export interface SuppressionDirectiveRow {
  stockId: string;
  snapshotKey: string;
  metricKey: string;
  sourceLocalEventId: string; // → resolves to source_guardrail_event_id at persist
  outcome: Outcome; // O2 | O4
  excludeFromOwnScore: boolean;
  excludeFromPeerMean: boolean;
}

/** A whole-stock action that is NOT a per-metric suppression: O5 hold (freeze last
 *  clean composite, skip this period's update) or O6 remove (exit scoring + peer
 *  set). Consumed by the RUN ORCHESTRATOR (not built here) — the gate only records
 *  it + writes the audit event. */
export interface StockLevelAction {
  kind: "hold" | "remove";
  stockId: string;
  snapshotKey: string;
  sourceLocalEventId: string;
  reason: string;
  /** O6 (remove) and O5's 2-quarter→remove escalation need operator one-tap
   *  confirm (§0.6 O6, §1 A-1/A-4); pure O5 hold does not. */
  requiresOperatorConfirm: boolean;
}

/** An O3 annotation: full score computed, a visible note attached, NO math change.
 *  Persisted as the audit event + a score_red_flags / annotation row (the flag),
 *  never a suppression directive. */
export interface Annotation {
  stockId: string;
  snapshotKey: string;
  sourceLocalEventId: string;
  affectedMetrics: AffectedMetric[];
  text: string;
}

/** A REVIEW-tier firing held pending an operator ruling (§0.7 / §7). The audit
 *  event is written immediately (tier=review, outcome=proposed), but the PROPOSED
 *  resolution does NOT apply — no suppression directive / annotation is emitted —
 *  until an operator records an `upheld` ruling (review.ts state machine). The full
 *  SignatureResult is held so the exact proposed outcome can be resolved on upheld.
 *  This is the structural auto-vs-review distinction: auto resolves in the gate;
 *  review resolves only after a ruling. */
export interface PendingReview {
  event: GuardrailEventRow; // already written to the audit trail (tier=review)
  result: SignatureResult; // the held verdict — resolved by applyRuling on `upheld`
  state: "pending";
}

/** The complete output of running the gate over ONE stock at ONE snapshot:
 *  everything Layer-2 + the persist layer need, in memory, BEFORE the snapshot
 *  exists. `directives` is the consumable seam (→ toSuppressionPredicate). */
export interface GuardrailEvalResult {
  stockId: string;
  symbol: string;
  snapshotKey: string;
  events: GuardrailEventRow[];
  directives: SuppressionDirectiveRow[];
  stockActions: StockLevelAction[];
  annotations: Annotation[];
  /** Review-tier firings held pending an operator ruling. NOT yet applied — their
   *  directives/annotations are absent from the lists above until ruled `upheld`. */
  pendingReviews: PendingReview[];
  /** Signatures that ran but did not fire (kept for the §7 audit completeness /
   *  "flag cleared = O1" record) and signatures that could not evaluate. */
  notes: string[];
}
