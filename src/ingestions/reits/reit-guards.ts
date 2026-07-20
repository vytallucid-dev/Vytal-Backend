// ─────────────────────────────────────────────────────────────
// REIT / InvIT detection-guard predicates (pure, no I/O).
//
// Same shape as prices-guards.ts: thresholds + predicates live here so the source, the ingest
// and any dry-run harness call the SAME code and cannot drift. Each predicate returns a
// violation descriptor (or null when clean); the CALLER decides whether to reportIngestionError.
//
// The CLOSE bounds are IMPORTED from prices-guards, not re-declared: a rupee close is a rupee
// close whether it belongs to a stock or a trust, and two copies of one number is how they
// silently diverge.
// ─────────────────────────────────────────────────────────────

import { CLOSE_MIN, CLOSE_MAX } from "../prices/prices-guards.js";

export const REITS_CRON = "reit_daily";
export const REITS_SOURCE = "nse_udiff_bhavcopy";
export const REIT_DISTRIB_SOURCE = "nse_corporate_actions";
export const TARGET_TABLE = "Instrument";

/** NSE security series → our asset class. THE class comes from the SOURCE, never from the name. */
export const SERIES_TO_CLASS = {
  RR: "reit",
  IV: "invit",
} as const;

export type TrustSeries = keyof typeof SERIES_TO_CLASS;
export type TrustClass = (typeof SERIES_TO_CLASS)[TrustSeries];

export const TRUST_SERIES = Object.keys(SERIES_TO_CLASS) as TrustSeries[];

/** SQL-injection fence for the interpolated class literal (mirrors ingest-amfi's assertFundClass). */
export function assertTrustClass(c: string): asserts c is TrustClass {
  if (c !== "reit" && c !== "invit") {
    throw new Error(`assertTrustClass: refusing to interpolate unknown asset class "${c}"`);
  }
}

// ── GUARD 1: SHAPE ──
// Owned by the SHARED udiff reader since 14.5 (the same file is now read by the ETF price lane
// too, and two copies of one column list is how they silently diverge). Re-exported here so the
// trust lane's guard surface stays in one place.
export {
  UDIFF_REQUIRED_COLUMNS,
  checkUdiffShape as checkShape,
} from "../shared/udiff-bhavcopy.js";

// ── GUARD 2: COUNT ──
// The live universe is 17 (6 REITs + 11 InvITs). This is a SMALL, SLOW-GROWING universe — SEBI
// has approved a couple of new trusts a year — so unlike the 504-stock band there is nothing to
// derive it from; it is a hardcoded sanity band, deliberately wide enough to absorb years of
// listings and tight enough that a truncated or mis-parsed file cannot pass as a real one.
export const MIN_TRUSTS = 8;
export const MAX_TRUSTS = 60;

export type CountVerdict = { severity: "critical" | "high"; note: string } | null;

/**
 * GUARD 2 — classify the RR+IV row count. A count of ZERO is the dangerous one: it is exactly
 * what a renamed series code, a truncated file, or a holiday-shaped error page looks like, and
 * if we let it through the dormancy sweep would mark all 17 trusts inactive in one night. So
 * zero is CRITICAL and aborts the run — never "we found no REITs today, must be none left".
 */
export function classifyCount(observed: number): CountVerdict {
  if (observed === 0)
    return {
      severity: "critical",
      note: "ZERO RR/IV rows — a renamed series code or a truncated file looks exactly like this. Rejecting rather than treating a live universe as delisted.",
    };
  if (observed < MIN_TRUSTS)
    return {
      severity: "high",
      note: `only ${observed} trust rows (expected ≥ ${MIN_TRUSTS}) — the file may be truncated`,
    };
  if (observed > MAX_TRUSTS)
    return {
      severity: "high",
      note: `${observed} trust rows (expected ≤ ${MAX_TRUSTS}) — possible duplication or a mis-parse`,
    };
  return null;
}

// ── GUARD 3: VALIDITY (ISIN) ──
// Every REIT/InvIT ISIN observed live is INE-prefixed (the equity namespace). That is not an
// accident — a trust's units are equity-namespace securities. INF is the FUND namespace, and an
// INF-prefixed row arriving here would ALSO trip the AMFI trespass guard
// (ingest-amfi.ts: asset_class NOT IN ('mutual_fund','etf') AND isin LIKE 'INF%'), opening a
// CRITICAL every night. Rejecting it here means that can never happen.
export const TRUST_ISIN = /^INE[A-Z0-9]{9}$/;

// ── GUARD 4: RANGE (close) ──
/** True if a close is outside plausible bounds. Bounds shared with the equity price path. */
export function checkCloseRange(close: number): boolean {
  return close < CLOSE_MIN || close > CLOSE_MAX;
}
export { CLOSE_MIN, CLOSE_MAX };

// ── GUARD 5: RANGE (distribution yield) ──
// A REIT/InvIT trailing-12m distribution yield lives around 5–12%. A number outside this band is
// not a high-yielding trust, it is a PARSE ERROR — a component amount mistaken for a total, a
// stale price, a missing quarter. We refuse to store it: the yield goes honestly NULL and a
// fault is raised. A wrong yield is worse than no yield, because a user would act on it.
export const YIELD_MIN = 0.0;
export const YIELD_MAX = 0.3; // 30% — far above any real trust; a hard "this is a bug" line.

export function checkYieldRange(y: number): boolean {
  return !(y > YIELD_MIN && y <= YIELD_MAX);
}

/** Soft run-log ref, shared with the price path's identity convention. */
export const runRef = (d: Date, source: string) =>
  `${d.toISOString().slice(0, 10)}:${source}`;
