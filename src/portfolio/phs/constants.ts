// ─────────────────────────────────────────────────────────────────────────────
// PHS CONSTANTS — the A.13 single-source-of-truth table, VERBATIM.
// Status: DECLARED, NOT DERIVED (portfolio-spec 1.2). No portfolio corpus exists yet;
// every value is product judgment, not fitted. Recalibration = a clean version bump
// (CONSTANT_VERSION), never a silent edit. Do not infer, round, or substitute.
//
// AMENDMENT 1.2 — DECOUPLING (amends 1.1; base spec + 1.1 otherwise stands):
//  • Change 1 — Health loses the structure term. Health = Quality − 0.20×(100 − Signals).
//    No positional penalty of any kind enters the Health number. W_STRUCT is RETIRED.
//  • Change 2 — Construction = standalone Structure at FULL strength (S1–S5, raw). The
//    0.30× dampening that lived in the old blended composite is gone with the term.
//  • Change 3 — the coverage ceiling is RETIRED. Health shows TRUE, uncapped. The
//    mandatory coverage line + a "Provisional" tag below 40% do the honesty work.
//    CEIL_*, ceilingFor(), and C_EFF_RECOG_FACTOR are removed.
//  • Change 4/5 — pillarProfile + lensProfile (findings-character) read shapes. The lens
//    primary-nature classifier lives here (LENS_NATURE). Both characterize, never predict.
//
// AMENDMENT 1.1 (still in force):
//  • S1 single-position threshold is RELATIVE: max(15%, 1.5 × 100/N) (S1_FAIR_MULT).
//  • structure_tier (from N) + capital_tier (from total value) — COPY/STORAGE ONLY.
// ─────────────────────────────────────────────────────────────────────────────

// (Construction v2 Stage 5 — the CUTOVER) BUMPED 1.2 → 2.0. This is load-bearing, not cosmetic:
// CONSTANT_VERSION is in `fingerprintOf`, and the displayed Construction now = Net (C1–C6), which is
// NOT byte-identical to the old S-rule structure. Without the bump, every unchanged book would
// skip-identical and serve its STALE S-value forever (structure is not itself in the fingerprint) —
// the cutover would compute Net but never show it. The bump churns every fingerprint → the next
// compute (or the deploy backfill) re-persists one fresh Net row per user. `cv2-s3-version-defer`
// parked exactly this for "Stage 5/6"; the condition (C-rules feed the displayed score) is now met.
export const CONSTANT_VERSION = "portfolio-spec 2.0";

// (Construction v2 Stage 7 — §12) THE §14 MATCHER'S VERSION — a fingerprint input that ships BEFORE the
// thing it versions. The fund-sector matcher does not exist yet (Stage 8), so this is a sentinel; the
// FIELD must exist now because a matcher landing WITHOUT a fingerprint input is a silent re-rating —
// every affected book would keep serving its pre-matcher Construction until something unrelated happened
// to touch it. Stage 8 bumps this to "v1" and every affected snapshot invalidates on its next compute.
//
// It lives HERE, beside CONSTANT_VERSION, rather than in persist.ts: assemble.ts must read it, and
// assemble.ts only TYPE-imports from persist.ts — a value import would close a runtime cycle
// (persist → assemble → persist). constants.ts is already imported by both, and this is a constant.
//
// NON-NULL is deliberate. `undefined` would be DROPPED from the canonical JSON by JSON.stringify — an
// input that is silently NOT HASHED, a fingerprint hole wearing the shape of a value. "none" is explicit,
// always present, and reads as "no matcher" rather than "unknown".
export const MATCHER_VERSION_NONE = "none";

// Master combine weight (A.2). (1.2 Change 1) ONLY Signals now enters the Health number;
// the Structure weight W_STRUCT is RETIRED — structure is a standalone read (Construction).
export const W_SIGNAL = 0.2; // Signals penalty weight in Health = Quality − W_SIGNAL×(100−Signals)

// Structure rules (A.6 / A.13) — thresholds are in PERCENT points; weights are fractions.
export const S1_THRESH = 15; // single-position: % FLOOR of the relative threshold (1.1)
export const S1_FAIR_MULT = 1.5; // (1.1 Change 1) × fair_share (=100/N); threshold = max(S1_THRESH, this × 100/N)
export const S1_RATE = 1.5; //   per percentage-point over the (relative) threshold
export const S1_CAP = 25; //   per-holding cap

export const S2_THRESH = 40; // sector pile-up: % threshold
export const S2_RATE = 1.2; //   per percentage-point over
export const S2_CAP = 25; //   total cap
export const S2_UNKNOWN_KILL = 0.5; //   S2 not-evaluable if unknown-sector weight exceeds

export const S3_TARGET = 8; // breadth: Neff target
export const S3_RATE = 4.0; //   per unit of Neff below target
export const S3_CAP = 20; //   total cap

export const S4_THRESH = 25; // over-diversification: holding-count threshold
export const S4_RATE = 0.5; //   per holding over
export const S4_CAP = 8; //   total cap

export const S5_THRESH = 20; // unverified mega: small-unscored % threshold
export const S5_PER = 10; //   per such holding
export const S5_CAP = 20; //   total cap

// Signals base deductions (A.7 / A.13) — each multiplied by the holding's weight w_i.
export const SIG_DISTRESS = 120; // Health in Distress band (headline)
export const SIG_CRIT = 150; // Critical red flag (headline)
export const SIG_HIGH = 80; // High red flag / High-severity finding (headline)
export const SIG_MED = 30; // Medium red flag / Medium finding (headline)
export const SIG_LP5 = 50; // LP5 eroding breadth (breadth)
export const SIG_LP6 = 30; // LP6 hollow pillar (breadth)
export const SIG_HOLDING_CAP = 200; // per-holding Signals clamp (× weight)

// (1.2 Change 3) The coverage ceiling is RETIRED — Health shows TRUE, uncapped. The
// honesty is carried by the mandatory coverage line + a "Provisional" tag below 40%
// coverage. CEIL_* / ceilingFor() / C_EFF_RECOG_FACTOR are removed; only the tag cut remains.
export const PROVISIONAL_BELOW = 0.4; // "Provisional" tag below this TRUE coverage (c)

// (Construction v2 Stage 0 — Ruling 2) CONSTRUCTION provisional threshold — DISTINCT from the
// Health PROVISIONAL_BELOW above (which is about scored COVERAGE, c < 0.40). This one is about
// VALUATION COMPLETENESS: when we cannot VALUE more than this share of the whole book
// (Σ heldNotValued ÷ (valuedBook + Σ heldNotValued)), the Construction read is provisional — too
// much of the structure is invisible for its SHAPE to be trusted. Read-time only (heldNotValued is
// a LIVE fact — see listPortfolioDisclosure; never frozen into a snapshot), so it is NOT in the
// fingerprint and does NOT bump CONSTANT_VERSION. The band/display is Stage 6 — this is just the flag.
export const CONSTRUCTION_PROVISIONAL_ABOVE = 0.25;

// ── (Construction v2 Stage 3 — §11) C1 ENTITY DOMINANCE + C2 ENTITY BREADTH ──────────────────────
// The FIRST CV2 rules that DEDUCT. Declared, not derived. C2 is UNCAPPED by design (Aman sign-off):
// v1's cap compressed the bottom third — 1/2/3-stock books all scored 80; 7.0 uncapped separates them
// (21/46/65). These feed `gross` (computed, NOT displayed §8, NOT in fingerprintOf) — they touch
// neither Health nor the live S-rules. CONSTANT_VERSION intentionally STAYS "portfolio-spec 1.2" here:
// bumping to 2.0 now would churn every user's fingerprint and re-persist byte-identical values for
// constants nothing persisted consumes yet. It bumps when the C-rules feed the DISPLAYED score
// (Stage 5/6), together with the Stage-7 §12 fingerprint inclusion. See ODL cv2-s3-version-defer.
export const C1_FLOOR = 15;       // % — the floor of C1's N-relative single-entity threshold
export const C1_FAIR_MULT = 1.5;  // × fair_share (100/N): threshold = max(C1_FLOOR, this × 100/N)
export const C1_RATE = 1.5;       // deduction per percentage-point a name-risk entity is over threshold
export const C1_TOTAL_CAP = 30;   // cap on the SUM of per-entity deductions (monotonic — NOT per-entity)
export const C2_TARGET = 8;       // C2 entity-breadth Neff target
export const C2_RATE = 7.0;       // per unit of Neff below target, scaled by nameRiskShare. NO CAP.

// (Construction v2 Stage 4 — §7) SECTOR evaluability gate. When unknown-sector value exceeds this
// share of the SECTORABLE population (resolved ∪ unknown — NOT the whole book), C3 AND C4 are both
// not-evaluable. DELIBERATELY SEPARATE from the old S2_UNKNOWN_KILL above: that one measures unknown
// over the WHOLE book for the dying S2 rule; this one measures over `sectorable` (§7's semantics). Same
// value today, different denominators — aliasing them would couple a live CV2 rule to a corpse (S2
// dies at Stage 5/6, and its constant with it).
export const C3_UNKNOWN_KILL = 0.5;

// ── (Construction v2 Stage 5 — §11) C3–C6 → NET. The rules that complete the Construction library and
// FEED THE DISPLAYED NUMBER (persist writes `structure` column = construction.net). Declared, not
// derived. Net = max(0, Gross − C3 − C4 − C5 − C6); Construction = Net. Gross is NEVER a competing
// score (§8) — it persists as decomposition only.
//
// C3 · SECTOR DOMINANCE — whole-book denominator (a 20%-equity book all in financials is 20% exposed,
// not 100%). Cap RAISED 25 → 30 (v1's 25 bound at 61% — a 60%- and a 100%-financials book scored the
// same). Threshold STAYS 40, not 35 — Indian indices are financials-heavy; a normal book must not trip.
export const C3_THRESH = 40;  // % — max resolved-sector share (whole book) before C3 fires
export const C3_RATE = 1.2;   // deduction per percentage-point over threshold
export const C3_CAP = 30;     // total cap

// C4 · SECTOR BREADTH — the false-diversification hole (10 stocks / 3 sectors fires nothing today: max
// sector 33 < 40, Neff 10 > 8). UNITS are ENTITIES (name-risk, post-aggregation) or thematic baskets,
// NEVER positions — NTPC stock + NTPC bond are ONE unit. target = min(C4_TARGET, Neff_unit) is the
// ANTI-DOUBLE-CHARGE: if every unit sits in its own sector, Neff_sector = Neff_unit = target → C4 = 0
// always. Scaled by sectoredShare.
export const C4_TARGET = 5;   // sector-breadth Neff target
export const C4_RATE = 4.0;   // per unit of Neff_sector below target, × sectoredShare
export const C4_CAP = 15;     // cap on the pre-scale magnitude

// C5 · FUND-HOUSE DOMINANCE — subject: FUND PRODUCTS with a resolved house = baskets ∪ COMMODITY
// (ODL cv2-s5-c5-commodity: a gold ETF is an AMC product with real single-house operational risk;
// §10's "100% gold ETF → 75" is unsatisfiable otherwise). Denominator: whole book. Five funds from one
// AMC is a genuine single point of failure (one governance/key-person event touches all) — structural,
// not the redundancy FINDING (five large-caps being alike is inefficiency, and scoring it judges the
// choice). Resolution: instrument → mf_family_members → mf_families.fund_house (100% live coverage).
export const C5_THRESH = 40;  // % — max single-house share (whole book) before C5 fires
export const C5_RATE = 1.2;   // deduction per percentage-point over threshold
export const C5_CAP = 25;     // total cap (→ any single-fund/single-AMC book caps at Net 75)
export const C5_HOUSE_UNKNOWN_KILL = 0.5; // C5 not-evaluable if house-unknown share > this × fundShare

// ── (portfolio-findings 2.0) PQ2 / PQ3 — THE DISPERSION AXIS. Declared, not derived. ────────────────
/** σ (SAMPLE, n−1) of health across scored holdings that splits "the average hides a split" from "the
 *  average is honest". ONE constant, BOTH rules — PQ2 fires at ≥, PQ3 at <, so they are MUTUALLY
 *  EXCLUSIVE BY CONSTRUCTION. Two cutoffs would open a gap or an overlap, and a book could be told both
 *  that its average lies and that its average is trustworthy — the PB1/PB7 contradiction waiting to
 *  happen again (ODL cv2-s9-suppression-model).
 *
 *  WHY 15: it is ONE FULL HEALTH BAND. The bands are ~15 wide, so σ ≥ 15 means holdings routinely sit a
 *  BAND APART — precisely when the average stops describing any of them. Measured against doc 2's own
 *  motivating example: BEL 78 / Tata Motors 51 → sample σ 19.09; the 3-name book averaging exactly 70
 *  ({78,51,81}) → 16.52. Both clear. An honest book ({68,70,72}) → 2.00, silent.
 *
 *  ⚠ σ DECAYS AS MID-NAMES ARE ADDED, AND THAT IS INTENDED, NOT A GAP. {78,51,75,76} → 12.73 and
 *  {78,51,70,72,79} → 11.29 both go silent WHILE THE 78/51 SPLIT IS STILL THERE. That is the rule
 *  DECLINING TO OVER-CLAIM AS ITS EVIDENCE THINS: every mid-name is evidence that the average is HONEST.
 *  PQ2's claim is that the average describes NOBODY — true at 78/51 (nothing sits near 70), false at
 *  78/51/70/72/79 (the average describes three of five). That book is not hiding a SPLIT, it is hiding
 *  ONE NAME — a different fact, and PQ4's ("weak name at size"). The seam is clean, not leaky:
 *    PQ2 = the average is a fiction · PQ4 = one name is weak at size · PQ3 = the average is honest, and ordinary.
 *  DECLARED-NOT-DERIVED: calibrate post-launch via a clean version bump, never tuned quietly to pass a book. */
/** (Stage 10a) PA2's small-position cut — ₹10,000 average position value. DECLARED, not derived, and
 *  **COPY INPUT ONLY** (§9.4): it selects a sentence, never a badge and never a score input. The fact it
 *  names is arithmetic, not a verdict — brokerage and charges are a near-fixed floor per trade, so they
 *  are a larger share of a smaller position. Calibrate post-launch via a clean version bump. */
export const PA_SMALL_POSITION = 10_000;

/**
 * (Stage 10a) PD6's thin-history cut — NAV observations, not days. ~250 sessions ≈ one trading year.
 *
 * ★ WHY THIS NUMBER AND NOT ANOTHER: it is the BOTTOM RUNG OF PI's declared window ladder (5y → 3y → 1y),
 * which the operator ruled in Stage 10a's build order. Below the bottom rung, no PI window is supportable
 * at all — "thin" then means something absolute rather than something relative to whichever rung we
 * happened to land on. That is a cut the ladder already defines; it is not one invented here to make a
 * finding fire, and inventing a threshold to make a harness green is a named failure of this project.
 *
 * ── ★ BATCH 3's ANSWER: THE CUT STAYS ABSOLUTE, AND THE MEASUREMENT IS WHY ───────────────────────
 *
 * Batch 3 was asked whether this cut should be expressed against the RUNG ACTUALLY USED rather than as an
 * absolute. Measured, the answer is no, and it is not close:
 *
 *     5,070 of the 9,626 rows carrying `max_drawdown_5y` have a window SHORTER THAN 5 YEARS.
 *
 * A rung-relative PD6 fires on every one of them — 53% of every fund we hold a drawdown for. "Our NAV
 * history for this fund is thin" is FALSE for a fund with 4.4 years of history, and PD6 would be saying it
 * about the majority of the catalog. The finding would stop meaning anything, which is the failure mode of
 * a disclosure that fires everywhere: it trains the reader to skip the panel that carries PD1.
 *
 * ★ THE REAL FIX IS NOT IN PD6, AND FINDING THAT OUT IS WHAT THE SECOND LOOK WAS FOR. The sentence "we'd
 * have told you more if we had more" is not a fact about our COVERAGE (PD's subject) — it is a fact about
 * WHICH WINDOW THIS NUMBER COVERS, which belongs to the number. So it lives inside PI5's own Read, which
 * names the ACTUAL span it measured ("over the 4 years and 4 months we hold") rather than the rung's
 * nominal horizon. One finding, one subject, and the disclosure lands on the sentence it qualifies.
 *
 * PD6 keeps the absolute cut and keeps its own sentence: "under a year of history AT ALL". The two co-fire
 * where both are true, and `verify-phs-pi-readtime.ts` §7 asserts BOTH directions — the co-fire on a short
 * rung, and the SILENCE on a refusal (an IDCW fund has 1,073 NAV points; its window is not short, its
 * metric is refused — a different sentence, a different finding).
 *
 * Measured on the live catalog: nav_points ranges 0–1,857 (avg 655 ≈ 2.6 years), so at 250 this fires on
 * genuinely-new funds only, which is what the sentence claims.
 */
export const PD_THIN_HISTORY_POINTS = 250;

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// (Stage 10a batch 3) THE PI FAMILY'S THRESHOLDS — INSTRUMENT FACTS. None of these deduct from
// anything: no PI value enters C1–C6 or Health. They gate what we SAY, never what we SCORE.
//
// ⚠ EVERY NUMBER BELOW IS MEASURED ON THE LIVE CATALOG AND THE MEASUREMENT IS WRITTEN DOWN. This file's
// header says "DECLARED, NOT DERIVED — no portfolio corpus exists yet". That is true of the SCORING
// constants: they gate a judgment about a book, and no book corpus exists. It is NOT true here. A PI
// threshold gates a statement about an INSTRUMENT, and the instrument corpus is 14,041 mf_analytics rows
// and 17,904 catalogued funds. Declaring a PI cut by product judgment when the distribution is sitting in
// the database would be inventing a threshold with the answer in reach — a named failure of this project.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * PI1's premium/discount cut — |price − NAV| / NAV on a SAME-TRADING-DAY pair. Doc 2 §9's own number.
 *
 * ⚠ THE THRESHOLD IS NOT THE HARD PART, AND PRETENDING IT IS WOULD BURY THE REAL FINDING. Measured on
 * the 328 ETFs carrying both a price and a NAV:
 *
 *     18 of 328 exceed this cut — and the top six are Motilal Oswal Nasdaq 100 (19.7%), Mirae Hang Seng
 *     TECH (19.9%), Nasdaq Q50 (21.6%), NYSE FANG+ (19.7%), S&P 500 Top 50 (19.4%). Every one is an
 *     INTERNATIONAL ETF whose price is dated Jul 13 and whose NAV is dated Jul 10.
 *
 * Those numbers are not premiums. They are a three-day gap between two of OUR ingestion schedules, and a
 * real ~15–20% premium (which these funds genuinely ran when SEBI capped overseas creation) is
 * INDISTINGUISHABLE from the artifact using data this shape. That is why PI1's gate is a same-day pair
 * and why the no-pair case is a PD finding about US rather than silence — see `read-time-findings.ts`.
 */
export const PI_PREMIUM_NOTABLE = 0.02;

/**
 * PI4's tracking-error cut — annualised stdev(fundRet − benchRet) over 1 year, on funds that CLAIM to
 * track an index (`benchmark_via = 'name'`; the fund's own name states its index).
 *
 * ★ MEASURED over the 942 such funds carrying a 1-year tracking error:
 *
 *     p10 = 0.15%   p25 = 0.20%   p50 = 0.30%   p75 = 0.77%   p90 = 2.21%   p95 = 3.14%   p99 = 7.54%
 *
 * The cut is 2%: just above the doc's own illustrative 1.8%, and at the 88th percentile — "this fund is
 * among the worst ~12% of trackers we hold" is a sentence the distribution supports. 138 of 942 fire.
 *
 * ⚠ AND THE TOP OF THAT DISTRIBUTION IS CONTAMINATED — PI4 INHERITS A FOLD DEFECT IT CANNOT FIX. Filed
 * as T-3; reported rather than worked around, and NOT a reason to move the cut:
 *
 *     13 funds named "BSE Sensex Next 30" / "BSE Sensex Next 50" carry `benchmark_index = 'Sensex'` at
 *     `benchmark_via = 'name'` — the name matcher matched the substring "Sensex" and handed a Sensex-Next
 *     fund the parent index. Their ~7.6% "tracking error" is the distance between TWO DIFFERENT INDICES,
 *     not a fund failing to track its own. They are the entire p99 of this distribution.
 *
 * The schema calls `via = 'name'` "Near-certain". Measured, it is not: a substring match is near-certain
 * only when no index is a prefix of another, and Sensex/Sensex Next 30/Sensex Next 50 is that case.
 * Repairing the matcher is the FOLD's job (it writes 1,016 rows and a findings batch must not re-resolve
 * a benchmark any more than it may resolve a Direct twin — doc 2 §13.2). Moving PI4's cut to 8% to dodge
 * them would be worse than shipping them: it would silence 125 correctly-mapped funds to hide 13 wrong
 * ones, and it would encode a fold bug as a product threshold where the next reader could not see it.
 */
export const PI_TE_NOTABLE = 0.02;

/**
 * ★ PI6's FLAG — DEFAULT OFF, AND THE DEFAULT IS THE RULING (doc 2 §9, "PENDING RATIFICATION").
 *
 * "Rank is the single most useful thing we could tell a fund holder, and it is one inch from 'sell this.'"
 * Head-chat ratification is pending, so PI6 SHIPS DISABLED: `fireInstrumentFindings` cannot emit PI6 while
 * this is false, and `verify-phs-pi-readtime.ts` §8 asserts both that it defaults off AND that the finding
 * cannot emit with it off — the flag is proven to be a gate, not a comment.
 *
 * ⚠ IT IS A `const false`, NOT AN ENV VAR, AND THAT IS DELIBERATE. An env var would let PI6 ship to
 * production by a config change nobody reviewed — which is precisely what "pending ratification" forbids.
 * Ratifying it is a code change, a diff, and a review. Turning it on should cost exactly what the ruling
 * costs. (`verify` asserts the literal, so flipping it here without the ratification fails CI loudly.)
 */
export const PI6_CATEGORY_RANK_ENABLED = false;

export const PQ_DISPERSION_SPLIT = 15;
/** SAMPLE σ needs n ≥ 2 — and the reason is the whole point, not a division-by-zero detail.
 *  POPULATION σ of one holding is **0**: the statistic tells the exact lie this guard exists to catch
 *  ("no split!" when the truth is "no distribution"). SAMPLE σ of one holding is 0/0 — UNDEFINED: the
 *  statistic REFUSES TO ANSWER. That is honest-empty expressed in arithmetic rather than bolted on
 *  beside it, and it is why the sample form was chosen over the population form.
 *  The guard stays EXPLICIT anyway: NaN must never reach a comparison, and "undefined by construction"
 *  is a property to ASSERT, not a behaviour to rely on. (Same disease as `pctPositive` publishing at
 *  n=1 — a statistic asserting a property of a distribution from one observation.) */
export const PQ_MIN_SCORED_FOR_DISPERSION = 2;

/** SAMPLE standard deviation (Bessel's n−1). Returns null — never 0 — below n=2: see
 *  PQ_MIN_SCORED_FOR_DISPERSION. Pure. */
export function sampleStdDev(xs: number[]): number | null {
  if (xs.length < PQ_MIN_SCORED_FOR_DISPERSION) return null; // undefined, NOT zero
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const ss = xs.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(ss / (xs.length - 1));
}

// C6 · MONITORABILITY — holding count. Always evaluable. Deliberately MILD: a 40-name book is an
// unmonitorable closet index — a lesser sin than dangerous concentration, and the penalty says so.
export const C6_THRESH = 25;  // holdings before C6 fires
export const C6_RATE = 0.5;   // per holding over
export const C6_CAP = 8;      // total cap

// ── (Construction v2 Stage 6 — §9.1) CONSTRUCTION BANDS — recut for the range C1–C6 actually produces,
// [~20,100]. The v1 cutoffs (90/75/60/40) were set when S1 fired on nearly every book and the range was
// [55,100]; a cohort at 21/27/32 is below the floor those bands ever expected. A scoring constant — so it
// lives HERE, not in the presentation controller (§9.1 moved it). Bottom band `Fragile` → **`Precarious`**:
// `Fragile` is ALSO a Health band (see bandOf below), and "Health: Fragile · Construction: Fragile"
// answered two different questions with one word — one collision removed. ──
export type ConstructionBand = "Well-built" | "Solid" | "Concentrated" | "Lopsided" | "Precarious";
export const CBAND_WELLBUILT = 85; //   85–100 Well-built
export const CBAND_SOLID = 70; //       70–84  Solid
export const CBAND_CONCENTRATED = 55; // 55–69  Concentrated
export const CBAND_LOPSIDED = 40; //    40–54  Lopsided · 0–39 Precarious

/** Construction band from the DISPLAYED Net (§9.1). Lower bounds inclusive: 70 → Solid, 85 → Well-built,
 *  39 → Precarious. A presentation mapping over the already-computed number, never a recompute. */
export function constructionBandOf(net: number): ConstructionBand {
  if (net >= CBAND_WELLBUILT) return "Well-built";
  if (net >= CBAND_SOLID) return "Solid";
  if (net >= CBAND_CONCENTRATED) return "Concentrated";
  if (net >= CBAND_LOPSIDED) return "Lopsided";
  return "Precarious";
}

// (Construction v2 Stage 6 — §9.4) ARCHETYPE thresholds. Evaluated in ORDER (Income → Commodity → Stock
// → Fund → Blended): 1–2 ask WHAT you own economically, 3–4 ask HOW you hold it. Descriptive only —
// never good/bad, never scored, never compared to another user (§3: asset mix is described, never scored).
export const ARCHETYPE_DEBT_MIN = 0.5;      // debtExposure ≥ this → Income-led
export const ARCHETYPE_COMMODITY_MIN = 0.5; // commodityExposure ≥ this → Commodity-led
export const ARCHETYPE_NAMERISK_MIN = 0.6;  // nameRiskShare ≥ this → Stock-led
export const ARCHETYPE_BASKET_MIN = 0.6;    // basketShare ≥ this → Fund-led

// (1.2 Change 5) Lens primary-nature classifier — maps each three-lens pattern (LM1–LM8,
// LP1–LP6) to the ONE lens its information lives on, per the Three-Lens Library §2–§4:
//   • PEER  — field-verdicts / peer-convergence (the L1↔L2 tension is the headline)
//   • TREND — the L3 direction (self-improvement / deterioration) is the headline
//   • ABSOLUTE — the L1 standalone standing is the headline (all-agree or genuine weak)
// Used ONLY for the lensProfile findings-CHARACTER read — never score attribution.
export type LensNature = "absolute" | "peer" | "trend";
export const LENS_NATURE: Record<string, LensNature> = {
  // absolute — L1 standing is the story
  LM1: "absolute", // Compounding strength (all agree up)
  LM7: "absolute", // Triple fail (genuinely weak, not a field artifact)
  LM8: "absolute", // Field-masked quiet weak spot (anti-mask on absolute weakness)
  LP1: "absolute", // Broad strength
  // peer — the field-relative verdict is the story
  LM3: "peer", // Tallest in a sunken field (PG weak)
  LM4: "peer", // Exceptional field (PG strong)
  LM6: "peer", // Eroding lead — converging to field
  LP2: "peer", // Field-lifted (PG weak)
  LP3: "peer", // Field-suppressed (PG strong)
  // trend — the own-history direction is the story
  LM2: "trend", // Plateau at the top (self-deceleration)
  LM5: "trend", // Recovering off the floor
  LP4: "trend", // Improving breadth
  LP5: "trend", // Eroding breadth
  LP6: "trend", // Hollow pillar (strong but fading)
};

// (1.1 Change 2) Tier boundaries — STORAGE + Part B copy SELECTOR ONLY. HARD LOCK: no
// S-rule, pillar, ceiling, or formula may read these. They are pure functions of N and
// total value that nothing in the score touches, so the PHS is byte-identical with or
// without them. structure_tier from holding count N; capital_tier from total book value ₹.
export const STRUCT_TIER_BUILDING_MIN = 5; //   1–4 Starter · 5–7 Building · 8+ Established
export const STRUCT_TIER_ESTABLISHED_MIN = 8;
export const CAPITAL_TIER_MODEST_MAX = 200_000; //     < ₹2L Modest
export const CAPITAL_TIER_SUBSTANTIAL_MIN = 1_500_000; // > ₹15L Substantial; [₹2L, ₹15L] Moderate

// Bands (A.9) — lower bounds.
export const BAND_STRONG = 80;
export const BAND_STEADY = 65;
export const BAND_MIXED = 50;
export const BAND_FRAGILE = 35;
// below BAND_FRAGILE → Weak

/** (1.1 Change 1) Relative S1 threshold in PERCENT points for a book of N holdings:
 *  max(15% floor, 1.5 × fair_share), fair_share = 100/N. A thin book gets a higher bar
 *  before S1 bites, so thin breadth stays owned by S3/Neff (no S1/S3 double-charge). */
export function s1ThresholdPct(holdingCount: number): number {
  const fairShare = holdingCount > 0 ? 100 / holdingCount : 0;
  return Math.max(S1_THRESH, S1_FAIR_MULT * fairShare);
}

// (1.1 Change 2) Copy-only tier labels. Never read by the score — see the HARD LOCK note.
export type StructureTier = "Starter" | "Building" | "Established";
export type CapitalTier = "Modest" | "Moderate" | "Substantial";

/** Book-maturity tier from holding count N (COPY SELECTOR ONLY). */
// (Stage 9 §15) `structureTierOf()` is DELETED with S1–S5. THE VOCABULARY LABELS THE INVESTOR, NOT THE
// BOOK — "Starter / Building / Established" is a register for a SENTENCE, never a badge, and it does not
// come back as copy. patterns.ts derives its copy register from `holdingCount` now (`copyRegisterOf`),
// reading STRUCT_TIER_BUILDING_MIN / STRUCT_TIER_ESTABLISHED_MIN below rather than restating the cuts.
// The CONSTANTS survive (the cuts are still the cuts); only the function that made them a TIER died.

/** Capital tier from total book value in ₹ (COPY SELECTOR ONLY). Boundaries inclusive of
 *  Moderate: [₹2L, ₹15L] → Moderate; < ₹2L → Modest; > ₹15L → Substantial. */
export function capitalTierOf(totalValue: number): CapitalTier {
  if (totalValue > CAPITAL_TIER_SUBSTANTIAL_MIN) return "Substantial";
  if (totalValue >= CAPITAL_TIER_MODEST_MAX) return "Moderate";
  return "Modest";
}

/** Health Score (published integer) → band (A.9). Bands unchanged in 1.2. */
export function bandOf(health: number): "Strong" | "Steady" | "Mixed" | "Fragile" | "Weak" {
  if (health >= BAND_STRONG) return "Strong";
  if (health >= BAND_STEADY) return "Steady";
  if (health >= BAND_MIXED) return "Mixed";
  if (health >= BAND_FRAGILE) return "Fragile";
  return "Weak";
}
