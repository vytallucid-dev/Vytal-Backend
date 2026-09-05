// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// CONTRACT 1 — `Resolved<T>`. Architecture spec §3.
//
// ── ★ WHAT THIS IS FOR ────────────────────────────────────────────────────────────────────────────
// Every composition begins with a resolved subject, and the three ways a resolver can lie about one
// are all cheap to write and invisible to a reader:
//
//   throw on absence      the caller catches, renders a generic error, and the reader learns nothing
//   `null` for absence    indistinguishable from "the field is genuinely null-valued"
//   `0` for unknown       "the bank set aside ₹0 for bad loans" (§3.4 catalogues ~48 of these)
//
// So absence is a BRANCH OF THE RETURN TYPE, carrying a machine-readable reason and the reader phrase
// that reason maps to. A caller cannot render an absent result without saying why it is absent,
// because there is no other arm to read.
//
// ── ⚠ SCOPE. THIS IS SIZED FOR RESOLVER #1 AND NOTHING ELSE ───────────────────────────────────────
// §3.6 has 24 more resolvers to wrap at stage 2. The types here cover exactly what symbol resolution
// needed and were not speculated past it: `Window` has one shape because one is used; `Source` is a
// string union because provenance is currently three table families. Extending at stage 2 is expected
// and is a union widening, never a reshape.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { NotEvaluableReason } from "../scoring/findings/types.js";

/**
 * WHY a thing is absent. Consumes the canonical vocabulary (§3.2, N-5) — this module defines no
 * absent enum of its own, and `reason` is the token the scoring layer already persists.
 *
 * `phraseKey` is the SAME token, named separately because the two are different jobs: `reason` is
 * branched on, `phraseKey` is rendered through `relational/coverage.ts#reasonPhrase`. They are equal
 * today; a caller must not assume they stay equal, because a reason may later carry more than one
 * phrase (per surface, per tier). Never free text — the phrase registry is the one home.
 */
export interface Absent {
  readonly reason: NotEvaluableReason;
  readonly phraseKey: NotEvaluableReason;
}

/** Where a fact came from. Coarse by design: a table FAMILY, not a table — the five industry-specific
 *  quarterly tables are one provenance to a reader, and naming which one leaks schema. */
// ★ `portfolio_ledger` ADDED AT T-1b. The three above are MARKET provenance — what we hold about
//   companies. A reader's own book is a fourth thing: it is derived from their ledger and their
//   accounts, and an answer about it that cited "stocks" would be naming the wrong source for the
//   figure on screen. Finding 6's two series (value, health) both carry it.
export type Source = "stocks" | "quarterly_results" | "score_snapshots" | "portfolio_ledger";

/** A resolved period range. RESOLVED, never as-requested (§3.3) — a caller that asked for 20 quarters
 *  and got 8 must be able to see that it got 8. */
export interface Window {
  readonly fromPeriod: string;
  readonly toPeriod: string;
  readonly periods: number;
}

/** Something the resolver removed from consideration, NAMED. A silent filter is the defect this
 *  exists to prevent: a set that quietly lost members reads as a complete set. */
export interface DroppedFilter {
  readonly filter: string;
  readonly dropped: number;
  readonly why: string;
}

/**
 * How much history actually backs ONE SUBJECT.
 *
 * ⚠ THE DEFECT THIS PREVENTS IS A COMPARISON, NOT A MISSING FIELD. Measured 2026-08-29 across the
 * five quarterly tables: 411 stocks hold 1-7 quarters, 1,391 hold exactly 8, 437 hold 14-34. A screen
 * that ranks a 34-quarter stock against a 1-quarter stock without saying so is the same class of
 * quiet lie as a silently-shortened window.
 *
 * ⚠ §3.3 PUTS `floorApplied` AND `excludedForDepth` HERE. They have moved to `QueryCoverage`, and the
 * reason is the whole point of the split below: a floor is something a CALLER asked for and a count of
 * exclusions is a fact about a SET. Neither is a property of the stock. On a single subject
 * `excludedForDepth` could only ever be 0, which is a field that carries no information at the site it
 * is defined for.
 */
export interface DepthProfile {
  /** Distinct in-force quarterly periods held, across every industry's results table. */
  readonly quarters: number;
  /** Distinct in-force score periods. `null` - NOT 0 - when the stock is unscored: zero snapshots and
   *  "we do not score this stock" are different facts and 0 conflates them. */
  readonly snapshots: number | null;
}

/**
 * ★ HALF ONE — WHAT BACKS ONE SUBJECT.
 *
 * ⚠ `asOf` IS `string | null`, AND §3.3 SPECIFIES NON-NULL. Deliberate, reported at stage 1: a tier-0
 * stock (in `stocks`, no quarterly row in any of the five tables - 12 live, all active recent
 * listings) has no data as of ANY date. A non-null `asOf` would be fabricated from `created_at`, which
 * is when we learned the ticker exists, not when a fact about the company was true. That is the
 * zero-for-unknown defect wearing a date.
 *
 * ⚠ `asOf` IS PER-STOCK, NOT PER-RUN (§3.5). Runs are incremental; reading the run yields 7 where the
 * answer is 95.
 */
export interface StockCoverage {
  readonly kind: "stock";
  /** 0 = in `stocks`, no quarterly row - 1 = quarterly rows held - 2 = scored. */
  readonly tier: 0 | 1 | 2;
  readonly asOf: string | null;
  /** RESOLVED for this subject, never as-requested: a caller who asked 20 and got 8 must see 8. */
  readonly window: Window | null;
  readonly depth: DepthProfile;
}

/**
 * ★ HALF ONE, SECOND SHAPE — A NON-EQUITY INSTRUMENT (stage 6).
 *
 * ⚠ IT HAS NO TIER AND NO `DepthProfile`, AND THAT IS THE FINDING, NOT AN OMISSION. `tier` is
 * defined by the five quarterly-results tables and `depth.quarters` counts rows in them. A mutual
 * fund, an ETF, a G-sec or an SGB has no quarterly result and never will: a tier read off one would
 * be `0` — "in `stocks`, no quarterly row" — which is a false statement about a thing that is not a
 * stock at all. That is the zero-for-unknown defect (§3.1) wearing a coverage field.
 */
export interface InstrumentCoverage {
  readonly kind: "instrument";
  /** "mutual_fund" | "etf" | "bond" | "gsec" | "sgb" | "reit" | "invit" — the registry's own word. */
  readonly instrumentType: string;
  readonly asOf: string | null;
  /** Whether computed analytics (returns, volatility, drawdown) are held. The nearest honest analogue
   *  of "scored", and deliberately a boolean rather than a tier, because there is no ladder here. */
  readonly analytics: boolean;
}

/**
 * ★ HALF ONE, THIRD SHAPE — THE READER THEMSELVES (stage 6).
 *
 * A portfolio has an as-of and it has a size; it has no tier, no window and no quarters. What it does
 * have, and what nothing else in this contract could express, is HOW MUCH OF ITSELF WE CAN SPEAK TO:
 * a book of 20 holdings of which 6 are scored is a different answer from one where 20 are, and the
 * old flat shape had nowhere to put that difference.
 */
export interface ReaderCoverage {
  readonly kind: "reader";
  readonly asOf: string | null;
  /** Positions held. 0 is a real state — an empty book — and is not absence. */
  readonly holdings: number;
  /** Of those, how many Vytal scores. The honest bound on any claim about "your portfolio". */
  readonly holdingsScored: number;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★ SUBJECT COVERAGE IS A UNION, NOT A SHAPE — §3.3 AMENDMENT, RAISED AT STAGE 6.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The one-shape version was STOCK coverage under a general name. Stage 2 split `Coverage` into
 * subject and query because one shape could not serve one subject and a set; stage 6 hits the same
 * wall one level down — one shape cannot serve three KINDS of subject.
 *
 * The test is the same test: does every field mean something for every value? For a fund, `tier` and
 * `depth.quarters` do not. For the reader, none of `tier`, `window` or `depth` do. A caller reading
 * `?? 0` off those got `0`, which is not "unknown" — it is the specific claim "a stock we hold no
 * quarterly results for". Three subjects that are not stocks were about to start making that claim.
 *
 * ⚠ USE `stockCoverage()` BELOW RATHER THAN `coverage.subject?.tier`. The helper returns `null` for a
 * non-stock instead of letting the optional chain hand back a plausible-looking zero.
 */
export type SubjectCoverage = StockCoverage | InstrumentCoverage | ReaderCoverage;

/**
 * ★ HALF TWO — WHAT THE SEARCH COVERED.
 *
 * Facts about the QUERY, not about any stock it returned. A miss over 2,290 stocks and a miss over 12
 * are different answers, and neither is a property of a subject.
 */
export interface QueryCoverage {
  /** The count actually searched - not the nominal universe size. */
  readonly universeSearched: number;
  /** The minimum depth the CALLER required. `null` when no floor was declared. */
  readonly depthFloor: number | null;
  /** How many subjects the floor removed. 0 is meaningful: the floor ran and dropped none. */
  readonly excludedForDepth: number;
  /** Everything else removed, NAMED. A silent filter makes a shortened set read as a complete one. */
  readonly dropped: readonly DroppedFilter[];
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ★ COVERAGE — TWO HALVES, EACH PRESENT ONLY WHEN IT MEANS SOMETHING.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §3.3 gives Coverage ONE flat shape carrying tier, asOf, depth, universeSearched, window and dropped
 * together. That shape assumes every resolver has exactly one subject, and three kinds do not:
 *
 *   one subject      a stock's health, its price series, its ownership   → subject, no query
 *   a set            a screen, a peer group, a search                    → query, no single subject
 *   several + query  a comparison                                        → query, subjects on members
 *
 * Stage 1 hit this on the first resolver and shipped a documented compromise: the envelope mirrored
 * `candidates[0]`, so on an AMBIGUOUS result the envelope described a subject nobody had chosen. That
 * is a field that reads as an answer and is not one - the exact defect this contract exists to stop,
 * reproduced inside the contract itself.
 *
 * ★ THE FIX IS STRUCTURAL, NOT DOCUMENTARY. `subject: null` now SAYS "no subject was resolved", and a
 * caller cannot read a tier off an ambiguous result because there is no tier there to read. The
 * compromise is not documented better; it is gone.
 *
 * Both fields are explicitly nullable rather than optional: a resolver must decide which halves it can
 * honestly fill, and `subject: null` is a statement, where a missing key is an oversight.
 */
export interface Coverage {
  readonly subject: SubjectCoverage | null;
  readonly query: QueryCoverage | null;
}

/**
 * ★ THE CONTRACT. Absence is an arm of the return, never an exception and never a null.
 *
 * Both arms carry `coverage`, because "what we searched and how deep it went" is exactly as important
 * on a miss as on a hit — a miss over 2,290 stocks and a miss over 12 are different answers.
 */
export type Resolved<T> =
  | { readonly ok: true; readonly data: T; readonly coverage: Coverage; readonly provenance: readonly Source[] }
  | { readonly ok: false; readonly absent: Absent; readonly coverage: Coverage };

/** Constructors — so a caller cannot assemble a half-built arm. */
export const resolved = <T>(data: T, coverage: Coverage, provenance: readonly Source[]): Resolved<T> => ({
  ok: true, data, coverage, provenance,
});

/**
 * Did the COVERAGE read itself fail? One home for a test that would otherwise be spelled out at a
 * dozen call sites (N-3/N-5), and spelled slightly differently at one of them.
 *
 * ⚠ IT IS NOT `!r.ok`. `not_in_universe` and `not_ingested` are absences a caller may legitimately
 *   carry on from — the envelope is real and says we hold nothing. `read_failed` is the one where the
 *   envelope means nothing at all, and continuing with it turns our outage into a claim about the
 *   company. Every caller of `resolveStockCoverage` needs this distinction; none of them had it.
 */
export const coverageReadFailed = (r: Resolved<unknown>): boolean =>
  !r.ok && r.absent.reason === "read_failed";

export const absent = <T>(reason: NotEvaluableReason, coverage: Coverage): Resolved<T> => ({
  ok: false, absent: { reason, phraseKey: reason }, coverage,
});

/** The empty depth profile — a stock with nothing behind it. Named rather than written inline at each
 *  site, so "no depth" is one object and not four subtly different ones. */
export const NO_DEPTH: DepthProfile = { quarters: 0, snapshots: null };

/** Subject coverage for a stock we hold nothing for. Tier 0 by construction. */
export const NO_SUBJECT: StockCoverage = { kind: "stock", tier: 0, asOf: null, window: null, depth: NO_DEPTH };

/**
 * Narrow a `Coverage` to its STOCK half, or `null`.
 *
 * ★ THE POINT IS THE `null`. `coverage.subject?.tier ?? 0` reads 0 for a fund and for the reader —
 * a real tier value asserting "a stock with no quarterly rows". Every stock-shaped call site in the
 * composer goes through here instead, so a non-stock subject arriving somewhere that assumes a stock
 * produces a visible absence rather than a quiet, wrong number.
 */
export const stockCoverage = (c: Coverage): StockCoverage | null =>
  c.subject !== null && c.subject.kind === "stock" ? c.subject : null;

/** Neither half known — the shape an absent arm carries when nothing was searched and nothing resolved. */
export const NO_COVERAGE: Coverage = { subject: null, query: null };
