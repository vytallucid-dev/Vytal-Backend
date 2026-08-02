// File: src/scoring/regime/regime.ts
//
// SECTOR REGIME — the trailing-6-month phase of a peer group's sector. PURE (no DB/IO).
// One implementation serves BOTH the Divergence tool (§1.3) and the Trajectory tool (§1.4);
// Trajectory §1.4 is explicit: "Identical to the divergence tool. One implementation serves both."
//
//   trailing_6mo = index(today) / index(126 trading days ago) − 1
//   HOT       if trailing_6mo >  +0.25
//   STRESSED  if trailing_6mo <  −0.12
//   NORMAL    otherwise
//
// ── ★ RULE 1: COMPUTED ON THE SECTOR, NEVER THE STOCK ──────────────────────────────────────────────
// The regime uses a trailing PRICE return. Computing it on the stock itself would be CIRCULAR: a
// stock whose price ran hard *is* the price-ahead-of-fundamentals pattern, so you would be using the
// same price move both to fire the signal and to explain it away. The sector is an independent
// instrument — it can say "the whole pond rose" without reference to whether this fish rose.
// ⚠ A per-stock variant is NOT a design option. Do not add one, and do not add an overload that
// accepts a stockId and computes from that stock's own closes. Resolution BY stock (stock → its peer
// group → that PG's sector regime) is fine and is what the tool landings do; computation ON a stock
// is the thing that is forbidden.
//
// ── ★ RULE 2: REGIME NEVER GATES DISPLAY, AND NEVER TOUCHES A SCORE ────────────────────────────────
// Divergence §1.3: "Regime never gates whether a pattern is shown. It changes the wording only. Same
// pattern, same severity, different sentence beneath it."
// Trajectory §1.4 is heavier — for boundary crossings the phase decides whether the pattern carries a
// directional read at all — but still never hides the crossing: "show the crossing regardless — it is
// a fact about the user's stock. But where the evidence shows no directional signal in the current
// phase, say so plainly rather than asserting a direction the data cannot support."
// Both specs are diagnostic / CN-8 read-only. Nothing here may change a score, bar, weight, lens
// anchor, threshold or severity. See RegimeRead below for how "no read in this phase" is expressed as
// a first-class output rather than an error or an empty state.
//
// ── VALIDATION (from the price-relationship study, worth keeping next to the cut points) ───────────
// The three phases were checked against independent price behaviour and separate cleanly:
//   HOT       +46% mean 6-month sector return at 25% volatility
//   NORMAL     +7% at 19%  (the genuinely calmest state)
//   STRESSED  −18% at 28%
//
// ── ★ NOT pond-heat. DIFFERENT INSTRUMENT. DO NOT MERGE ────────────────────────────────────────────
// findings/section2/pond-heat.ts is adjacent and must stay separate (it has live consumers —
// MASK_NOTE, isPriceLinked). The disqualifying difference is SIGN:
//                pond-heat                              regime
//   window       21 trading days                        126
//   basis        PG median of member closes             sector index (or pooled scored members)
//   sign         category on |median| — a −18% crash    SIGNED — HOT and STRESSED are opposite
//                and a +18% melt-up both read "hot"     ends of one axis
//   states       hot / warm / calm                      HOT / NORMAL / STRESSED
//   thresholds   6% / 12%                               +0.25 / −0.12
// D3 (ownership building against a weak Foundation) was 100% positive in STRESSED. An instrument that
// cannot separate a crash from a rally cannot express the condition under which the study's strongest
// positive performed best. That is why regime is built new rather than derived from pond-heat.
// Whether the two should eventually converge is noted for later and deliberately not acted on here.

/** The three phases. `null` is NOT a fourth phase — it means "not computable", carried separately. */
export type Regime = "HOT" | "NORMAL" | "STRESSED";

/** Which instrument produced the number. "index" = the sector's benchmark index. "pg_pool" = an
 *  equal-weight pool of the peer group's own scored members, computed WHENEVER no sector index has
 *  sufficient history — this is the DEFINED method for that case (Divergence §1.3 / Trajectory
 *  §1.4's carve-out), not a degraded fallback of last resort. The two are still named separately so
 *  a consumer can tell which basis produced a number — distinguishing the basis is correct, but
 *  disclaiming pg_pool as weaker is not: it is on every output because it is a different fact about
 *  the reading, not an apology for it. */
export type RegimeSource = "index" | "pg_pool";

// ── CUT POINTS (spec-locked — Divergence §1.3 / Trajectory §1.4, identical in both) ────────────────
/** Trading-day lookback. ⚠ ROWS, not calendar days — see trailingReturnFromSeries. */
export const REGIME_LOOKBACK_ROWS = 126;
/** trailing_6mo strictly ABOVE this ⇒ HOT. */
export const REGIME_HOT_ABOVE = 0.25;
/** trailing_6mo strictly BELOW this ⇒ STRESSED. */
export const REGIME_STRESSED_BELOW = -0.12;

// ── WINDOW-INTEGRITY GUARDS (not spec-locked; chosen here, reasons stated) ─────────────────────────
/** Max calendar days the 126-row window may span before we refuse to call it a 6-month return.
 *  126 trading days ≈ 176 weekday-days + ~10 market holidays ≈ 189 (the live measured span for every
 *  qualifying index is exactly 189). A window that spans materially longer means the series has
 *  INGEST GAPS — "126 rows back" then reaches into a different quarter and the number is no longer a
 *  6-month return. Returning it anyway would be a silently mislabelled quantity, so we return null
 *  with a reason instead. FLAG: provisional — widen if a real holiday cluster ever trips it. */
export const REGIME_MAX_WINDOW_SPAN_DAYS = 210;
/** Max calendar days the freshest usable row may lag the reference date. Guards the failure where
 *  index ingest STOPS and the regime silently freezes at whatever phase prevailed that day — a frozen
 *  HOT would keep asserting a directional read the data no longer supports. FLAG: provisional. */
export const REGIME_MAX_STALE_DAYS = 21;
/** Quorum for the pg_pool method. Below three, an "equal-weight pool" is really one or two stocks —
 *  which reintroduces exactly the circularity Rule 1 exists to prevent (a single stock's own price
 *  move driving the regime that is then used to interpret that stock's pattern). Matches the
 *  pond-heat quorum precedent. FLAG: provisional. */
export const REGIME_POOL_MIN_MEMBERS = 3;

/** The evidence key a fired finding stamps its regime under. Named once here so steps 2–4 cannot
 *  drift. See the fire-time decision in regime.service.ts's header. */
export const REGIME_EVIDENCE_KEY = "regimeAtEvent";

/** One resolved regime reading. `regime: null` ⇒ not computable; `reason` then says why, and
 *  `source` is null because no instrument produced a number (claiming one would be false). */
export interface RegimeView {
  regime: Regime | null;
  /** Signed fraction, e.g. 0.2215 = +22.15%. null whenever regime is null. */
  trailing6mo: number | null;
  /** null only when regime is null — see above. */
  source: RegimeSource | null;
  /** The index used, or null when the reading came from a pg_pool / nothing. */
  indexName: string | null;
  /** Trading date the reading is AS OF (the latest row used), YYYY-MM-DD. null when not computable. */
  asOf: string | null;
  /** Present whenever regime is null (why), and on pg_pool readings (which members, why no index). */
  reason?: string;
}

/** The subset stamped into a finding's evidence at fire time. Deliberately the display-relevant
 *  fields only — a stamp is a record of what prevailed, not a re-derivable computation. */
export interface RegimeStamp {
  regime: Regime | null;
  trailing6mo: number | null;
  source: RegimeSource | null;
  indexName: string | null;
  asOf: string | null;
}

/** A measured 126-row window, before it is classified. */
export interface TrailingWindow {
  trailing6mo: number;
  /** The close 126 rows back — the denominator. */
  anchorDate: Date;
  /** The most recent close — the numerator. */
  latestDate: Date;
  /** Calendar days between the two. Compared against REGIME_MAX_WINDOW_SPAN_DAYS. */
  spanDays: number;
  /** Rows available in the series (≥ lookback+1 when non-null). */
  rowsAvailable: number;
}

/** Why a window could not be turned into a regime. Machine-readable; the human sentence is built
 *  by the service, which knows the index name and the member counts. */
export type RegimeFailure =
  | "insufficient_rows"
  | "window_non_contiguous"
  | "stale"
  | "no_sector_mapping"
  | "peer_quorum_not_met";

const DAY_MS = 86_400_000;
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** Classify a trailing return into a phase. The ONLY place the two cut points are applied. */
export function classifyRegime(trailing6mo: number): Regime {
  if (trailing6mo > REGIME_HOT_ABOVE) return "HOT";
  if (trailing6mo < REGIME_STRESSED_BELOW) return "STRESSED";
  return "NORMAL";
}

/**
 * Measure the trailing window over an ASCENDING series of positive closes.
 *
 * ⚠ THE WINDOW IS COUNTED IN ROWS, NOT DATE-SUBTRACTED. `126 trading days ago` means "126 rows
 * earlier in this series", which is what a trading-day lookback actually is. Date-subtracting
 * ~182 calendar days and taking the nearest close would silently vary the true lookback with
 * holidays, market closures and ingest gaps — a different window per sector, per call.
 *
 * NON-CONTIGUITY is the cost of counting rows: if the series is missing trading days (ingest gaps,
 * not holidays — a holiday is legitimately absent and is not a gap), then 126 rows reaches FURTHER
 * back than 126 trading days. We detect that by measuring the calendar span of the window and let
 * the caller reject it against REGIME_MAX_WINDOW_SPAN_DAYS, rather than returning a number that
 * says "6-month return" while measuring something else.
 *
 * The caller must pass a series already filtered to close > 0, ascending, one row per date.
 */
export function trailingReturnFromSeries(
  series: readonly { date: Date; close: number }[],
  lookbackRows: number = REGIME_LOOKBACK_ROWS,
): TrailingWindow | null {
  const n = series.length;
  if (n < lookbackRows + 1) return null;
  const latest = series[n - 1];
  const anchor = series[n - 1 - lookbackRows];
  if (!(anchor.close > 0) || !(latest.close > 0)) return null;
  return {
    trailing6mo: latest.close / anchor.close - 1,
    anchorDate: anchor.date,
    latestDate: latest.date,
    spanDays: Math.round((latest.date.getTime() - anchor.date.getTime()) / DAY_MS),
    rowsAvailable: n,
  };
}

/**
 * Equal-weight the members of a peer group.
 *
 * ⚠ EQUAL-WEIGHT MEANS AVERAGING RETURNS, NOT CLOSES. Averaging raw closes would be PRICE-weighted —
 * a ₹3,000 stock would dominate a ₹50 one and the "index" would track whichever member happens to
 * have the largest sticker price. Averaging each member's own 126-row return gives every member the
 * same weight, and is identical to rebasing each member to 100 at the window start and averaging the
 * series, evaluated at the endpoints (which is all trailing_6mo needs).
 */
export function equalWeightMean(memberReturns: readonly number[]): number | null {
  if (memberReturns.length === 0) return null;
  return memberReturns.reduce((a, b) => a + b, 0) / memberReturns.length;
}

/** Is this window fresh and contiguous enough to classify? Returns the failure, or null when OK. */
export function windowIntegrity(w: TrailingWindow, reference: Date): RegimeFailure | null {
  if (w.spanDays > REGIME_MAX_WINDOW_SPAN_DAYS) return "window_non_contiguous";
  const lagDays = Math.round((reference.getTime() - w.latestDate.getTime()) / DAY_MS);
  if (lagDays > REGIME_MAX_STALE_DAYS) return "stale";
  return null;
}

/** Build a non-computable view. Never defaults to NORMAL — see the header of regime.service.ts. */
export function unknownRegime(reason: string): RegimeView {
  return { regime: null, trailing6mo: null, source: null, indexName: null, asOf: null, reason };
}

/** Build a computed view from a measured window. */
export function viewFromWindow(
  w: TrailingWindow,
  source: RegimeSource,
  indexName: string | null,
  reason?: string,
): RegimeView {
  return {
    regime: classifyRegime(w.trailing6mo),
    trailing6mo: w.trailing6mo,
    source,
    indexName,
    asOf: ymd(w.latestDate),
    ...(reason ? { reason } : {}),
  };
}

/** Narrow a view to the stamp shape. */
export function toStamp(v: RegimeView): RegimeStamp {
  return {
    regime: v.regime,
    trailing6mo: v.trailing6mo,
    source: v.source,
    indexName: v.indexName,
    asOf: v.asOf,
  };
}

// ── THE THREE-STATE DISTINCTION (Trajectory §1.4) ──────────────────────────────────────────────────
// A consumer must be able to tell apart three things, and they are NOT the same:
//   1. has a read           — this pattern has measured evidence in this phase
//   2. no read in this phase — the pattern fired, the crossing is a fact, but the study found no
//                              directional signal in this phase. FIRST-CLASS OUTPUT, not an error
//                              and not an empty state. T3 in NORMAL is exactly this.
//   3. regime unknown        — we could not establish the phase at all
// Collapsing 2 and 3 would tell a reader "no directional history" when the truth is "we don't know
// the phase"; collapsing 2 into a silent absence would hide a crossing the user's stock actually made.

export type RegimeRead<T> =
  | { kind: "read"; regime: Regime; value: T }
  | { kind: "no_read_in_phase"; regime: Regime }
  | { kind: "regime_unknown"; reason: string };

/**
 * Resolve a pattern's per-phase mapping against a regime reading.
 *
 * Trajectory §1.4: "No global rule covers both — the regime mapping is a required field per pattern."
 * So the TABLE belongs to the pattern (steps 2–4 supply it); this only resolves it. A phase absent
 * from the table means "no directional read in this phase" — which is why the table is Partial and
 * why omission is meaningful rather than an oversight.
 *
 *   T3 · falling out of Pristine → { HOT: <copy> }            // NORMAL/STRESSED ⇒ no_read_in_phase
 *   T6 · momentum breaking weak  → { NORMAL: <copy> }         // HOT is masked ⇒ no_read_in_phase
 */
export function resolveRegimeRead<T>(
  view: Pick<RegimeView, "regime" | "reason">,
  perPhase: Partial<Record<Regime, T>>,
): RegimeRead<T> {
  if (view.regime === null) {
    return { kind: "regime_unknown", reason: view.reason ?? "regime not established" };
  }
  const value = perPhase[view.regime];
  if (value === undefined) return { kind: "no_read_in_phase", regime: view.regime };
  return { kind: "read", regime: view.regime, value };
}
