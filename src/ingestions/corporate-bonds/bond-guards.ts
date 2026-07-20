// ─────────────────────────────────────────────────────────────
// CORPORATE BONDS / NCDs — guards + the name parser (pure, no I/O).
//
// ══ THE FENCE, AND WHY IT IS NOT THE ONE YOU WOULD FIRST WRITE ══
// The G-sec lane (Step 15) fences on an EXACT SERIES ALLOW-LIST (GS/TB/GB/SG). The obvious move here
// is its inverse: an include-list of the corporate-debt series (N*/Y*/Z*/P*). THAT IS WRONG, and
// recon proved it against live data, twice over:
//
//   · a SERIES-only fence ADMITS EQUITY. `BL` is a block-deal board — it carries INE462A01022 =
//     BAYERCROP, one of our 504 SCORED STOCKS. The load would have collided the equity spine.
//   · an N*/Y*/Z*/P* fence admits `P1` = INE494B04019 = TVS Motor PREFERENCE SHARES (not debt), and
//     MISSES the AN/AX series, which are real NCDs.
//
// A SERIES IS A TRADING BOARD, NOT AN INSTRUMENT TYPE. So the fence is TWO-KEY:
//
//     (1) the series is not one of our OTHER lanes' boards   — "nobody else has claimed this row"
//     (2) the ISIN says it is genuinely DEBT                 — "and it really is a bond"
//
// Key (2) is shared/isin-class.ts, the SAME module universe-admit's Pass 3 uses to decide what a
// broker's unknown ISIN is. One taxonomy, both callers — they cannot drift apart, and an equity
// collision is unreachable by construction rather than by a blocklist someone must remember.
//
// ══ WHAT THE NAME CAN AND CANNOT TELL US ══
// The udiff has no coupon, maturity, issuer or rating COLUMN. Same discipline as Step 15:
//
//     PARSE WHAT IS EXPLICITLY THERE. NULL EVERYTHING ELSE, WITH A REASON.
//
//   · "7.51 NCD 16FEB28 TR1 SR2"   → coupon 7.51, and a FULL maturity date (16 Feb 2028). Rare (~1%).
//   · "AEL 9.15% 2028 SR IV"       → coupon 9.15, maturity YEAR 2028. The DAY is not there → NULL.
//   · "UNSE RE NCD 0% SR.III"      → coupon 0. A REAL ZERO — a zero-coupon bond. NOT a null, and the
//                                    difference matters: null means "we don't know", 0 means "it pays
//                                    no coupon", and 17 of these are genuinely zero-coupon.
//   · "SEC RE NCD SR VI"           → no coupon in the name at all → NULL, reason unparseable_name.
//
// ══ THE CREDIT RATING — THE ONE THAT MATTERS, AND THE ONE WE DO NOT HAVE ══
// A bond's credit rating is its single most important signal. The udiff has no rating column, and
// recon measured the names: 0% carry a rating. So it is NOT SOURCEABLE from this feed, and it is
// honest-NULL with a reason. It is NOT inferred from the coupon (a high coupon implies risk, it does
// not measure it). It is NOT inherited from the issuer's equity. It is NOT defaulted to "AAA".
//
// A fabricated rating on a debt instrument is not a cosmetic error. It is the exact number a holder
// would act on, and inventing it would be the single most harmful lie this codebase could tell.
// ─────────────────────────────────────────────────────────────
import { classifyIsin } from "../shared/isin-class.js";
import { GOVT_SERIES_CODES } from "../govt-securities/govt-guards.js";
import { CLOSE_MIN, CLOSE_MAX } from "../prices/prices-guards.js";

export const BOND_CRON = "corporate_bonds_daily";
export const TARGET_TABLE = "Instrument";

// ── KEY (1) OF THE FENCE: the boards that belong to SOMEONE ELSE ──
// Not "the debt boards" (that list is open-ended and unknowable) but "the boards already claimed".
// A board we have never seen is NOT auto-excluded — it falls to key (2), which asks the ISIN.
const EQUITY_BOARDS = ["EQ", "BE", "BZ", "SM", "ST", "SZ", "E1", "IL", "GC"];
const TRUST_BOARDS = ["RR", "IV"]; // REIT / InvIT — Step 14
const FUND_BOARDS = ["MF"]; // closed-end fund units
export const CLAIMED_BOARDS = new Set<string>([
  ...EQUITY_BOARDS,
  ...TRUST_BOARDS,
  ...FUND_BOARDS,
  ...GOVT_SERIES_CODES, // GS/TB/GB/SG — Step 15. IMPORTED, never re-typed: two copies of one list drift.
]);

/**
 * THE FENCE. Both keys, in one place.
 *
 * `series` alone can never admit a row, and `isin` alone can never admit a row. An equity on an
 * unclaimed board still fails key (2); a bond ISIN printed on the EQ board still fails key (1)
 * (and should — if that ever happens, something is very wrong upstream and we want to see it, not
 * quietly ingest it).
 */
export function isCorporateDebt(series: string, isin: string): boolean {
  if (CLAIMED_BOARDS.has(series)) return false; // key 1 — another lane owns this row
  return classifyIsin(isin).kind === "debt"; // key 2 — and the ISIN says it is genuinely debt
}

// ── GUARD: COUNT ──
// Recon: 356 distinct ISINs across a 10-session union (a single session shows ~150 — corporate debt
// is thinly traded, so ONE day is a sample, not the universe). The union was STILL CLIMBING at
// ~9/session on session 10, so 356 is a FLOOR, not a ceiling: the band's upper bound is generous
// because the daily cron ACCUMULATES (it never deletes) and the catalogue is expected to grow.
export const MIN_BONDS = 100;
export const MAX_BONDS = 5000;

export type CountVerdict = { severity: "critical" | "high"; note: string } | null;

export function classifyCount(observed: number): CountVerdict {
  if (observed === 0)
    return {
      severity: "critical",
      note:
        "ZERO corporate-debt rows. A renamed series code, a truncated file, or an ISIN-taxonomy " +
        "regression looks exactly like this. Rejecting rather than treating a live universe as delisted.",
    };
  if (observed < MIN_BONDS)
    return { severity: "high", note: `only ${observed} bonds (expected ≥ ${MIN_BONDS}) — the file may be truncated or the fence broken` };
  if (observed > MAX_BONDS)
    return { severity: "high", note: `${observed} bonds (expected ≤ ${MAX_BONDS}) — possible duplication, or the fence is admitting something it should not` };
  return null;
}

// ── GUARD: RANGE (close) ──
// A bond quotes near FACE (₹100 / ₹1,000 / ₹100,000 are all common face values in this feed —
// recon measured a median close of ₹1,059 and a range of ₹10.4 … ₹107,016). The rupee bounds are
// the house's, imported not re-declared.
export function checkCloseRange(close: number): boolean {
  return close < CLOSE_MIN || close > CLOSE_MAX;
}
export { CLOSE_MIN, CLOSE_MAX };

// ── GUARD: NULL-RATE (the coupon parse) ──
// Recon: 92.7% of names carry a "%". An individual unreadable name is honest-empty; a COLLAPSE means
// NSE changed its naming and we want to hear about it that night, not in six months when someone
// notices every NCD has a blank coupon and nobody knows how long it has been that way.
export const MIN_COUPON_PARSE_RATE = 0.75;

// ═══════════════════════════════════════════════════════════════
// THE ATTRIBUTES
// ═══════════════════════════════════════════════════════════════

export interface BondAttributes {
  /** The NSE board the row printed on, verbatim. Provenance — NEVER used to decide what this is. */
  series: string;
  /** The ISIN's security-type code ("07"/"08"/"24"/"A7") — the thing that ACTUALLY decided it. */
  securityType: string | null;
  /** The 7-char ISIN issuer stem. The HARD key that joins this bond to its issuer's equity, if we score one. */
  issuerStem: string | null;
  /** The issuer's name — ONLY when the stem matches a company already in `stocks`. Resolved BY JOIN,
   *  never parsed out of the instrument name (an NCD's name is a description, not a company name). */
  issuer: string | null;
  issuerNullReason: "not_in_our_universe" | null;
  /** % p.a. A REAL 0 for a zero-coupon bond — never conflate that with "unknown" (null). */
  coupon: number | null;
  couponNullReason: "unparseable_name" | null;
  /** Explicit in ~33% of names. */
  maturityYear: number | null;
  /** ONLY where the name spells out a full date (~1% — "7.51 NCD 16FEB28"). NEVER invented. */
  maturityDate: string | null;
  maturityDateNullReason: "not_in_source" | "unparseable_name" | null;
  /** THE KEY SIGNAL, AND WE DO NOT HAVE IT. Always null. See the header — never inferred, never defaulted. */
  creditRating: null;
  creditRatingNullReason: "not_sourceable";
  /** YTM needs the exact maturity we refused to invent. Null, with a reason. */
  yieldToMaturity: null;
  yieldNullReason: "not_sourceable";
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/**
 * Read what the name explicitly says. Everything else is null, WITH A REASON.
 *
 * Pure: same inputs, same attributes out. `issuerName` is passed IN (resolved by the caller's join
 * on the issuer stem) rather than looked up here — this function does no I/O, so it can be unit-run
 * and so the parse can never quietly become a database query.
 */
export function parseBondName(
  series: string,
  name: string,
  isin: string,
  issuerName: string | null,
): BondAttributes {
  const cls = classifyIsin(isin);

  const a: BondAttributes = {
    series,
    securityType: cls.securityType,
    issuerStem: cls.issuerStem,
    issuer: issuerName,
    issuerNullReason: issuerName ? null : "not_in_our_universe",
    coupon: null,
    couponNullReason: null,
    maturityYear: null,
    maturityDate: null,
    maturityDateNullReason: null,
    creditRating: null,
    creditRatingNullReason: "not_sourceable",
    yieldToMaturity: null,
    yieldNullReason: "not_sourceable",
  };

  // ── COUPON ──
  // Anchored on the "%" so a stray number in a series label ("SR 4") can never be read as a rate.
  // A leading 0 is KEPT as 0: "UNSE RE NCD 0% SR.III" is a zero-coupon bond, and 0 is the truth.
  const cpn = name.match(/(\d+(?:\.\d+)?)\s*%/);
  if (cpn) a.coupon = Number(cpn[1]);
  else a.couponNullReason = "unparseable_name";

  // ── MATURITY: a FULL date, if and only if the name spells one out ──
  // "7.51 NCD 16FEB28 TR1 SR2" → 2028-02-16. This is ~1% of names, and it is the ONLY case where a
  // day is knowable. A 2-digit year is windowed to 20xx: these are live bonds, not 1928 ones.
  const full = name.match(/\b(\d{1,2})([A-Z]{3})(\d{2})\b/i);
  if (full && MONTHS[full[2]!.toUpperCase()]) {
    const dd = full[1]!.padStart(2, "0");
    const mm = MONTHS[full[2]!.toUpperCase()]!;
    const yy = 2000 + Number(full[3]);
    a.maturityDate = `${yy}-${mm}-${dd}`;
    a.maturityYear = yy;
    return a;
  }

  // ── MATURITY: the YEAR, where the name carries one ──
  // The DAY is genuinely not in the feed. Inventing one would be a lie about the date a holder gets
  // their principal back — the same refusal Step 15 makes for a G-sec.
  a.maturityDateNullReason = "not_in_source";
  const yr = name.match(/\b(20\d{2})\b/);
  if (yr) a.maturityYear = Number(yr[1]);

  return a;
}
