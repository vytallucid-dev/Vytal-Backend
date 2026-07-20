// ─────────────────────────────────────────────────────────────
// GOVERNMENT SECURITIES — guards + the name parsers (pure, no I/O).
//
// The house split: predicates and thresholds live here so the ingest and any harness call the SAME
// code and cannot drift. The CLOSE bounds are imported from prices-guards, not re-declared — a
// rupee close is a rupee close, and two copies of one number is how they silently diverge.
//
// ══ THE NAME IS THE ONLY PLACE THE STORY LIVES ══
// The udiff BhavCopy has no coupon column and no maturity column. Recon checked `XpryDt` hoping for
// a free maturity date: it is EMPTY for all 197 government rows (they are cash-market, tp=STK). So
// coupon and maturity are read out of `FinInstrmNm`, and this file is where that happens — under a
// rule that does not bend:
//
//   PARSE WHAT IS EXPLICITLY THERE. NULL EVERYTHING ELSE.
//
// Concretely, and this is the whole discipline of Step 15:
//   · "GOI LOAN 6.64% 2027"      → coupon 6.64, maturity YEAR 2027. The DAY and MONTH are NOT in
//                                  the name, so maturityDate is NULL. We do not invent one.
//   · "GOI TBILL 364D-08/07/27"  → a FULL date is right there. Parse it. Coupon is NULL — and that
//                                  null is CORRECT, not missing: a T-bill is a discount instrument
//                                  and has no coupon at all.
//   · "2.5%GOLDBONDS2028SR-III"  → coupon 2.5, year 2028, tranche SR-III. The symbol (SGBJUN28)
//                                  LOOKS like it carries a month — but the symbols are truncated
//                                  and genuinely ambiguous (SGBJU29III: JUN or JUL? SGBN28VIII:
//                                  NOV?). Guessing is a coin flip on the date a citizen gets their
//                                  money back. maturityDate stays NULL.
//   · "SDL AP 7.25% 2037"        → state AP, coupon 7.25, year 2037. Date NULL.
//
// YIELD is NOT sourceable and NOT honestly computable: YTM needs the exact maturity we just refused
// to invent. It is null, with a reason. A fabricated yield on a government bond is not a rounding
// error; it is investment advice we made up.
// ─────────────────────────────────────────────────────────────
import { CLOSE_MIN, CLOSE_MAX } from "../prices/prices-guards.js";

export const GOVT_CRON = "govt_securities_daily";
export const TARGET_TABLE = "Instrument";

/** THE ALLOW-LIST. An EXACT set of NSE series codes — never a "looks like debt" heuristic.
 *
 *  This is the fence that keeps Step 15 out of the corporate-bond step. The same file carries ~40
 *  other debt series (N*, Y*, Z*, P1 …) which are CORPORATE paper; an allow-list excludes every one
 *  of them by construction, so this load cannot swallow the bond universe even by accident. */
export const GOVT_SERIES = {
  /** Central government dated securities — "GOI LOAN 6.64% 2027". */
  GS: { assetClass: "gsec", govtType: "dated" },
  /** Treasury bills — short-dated government paper. A T-bill IS a G-sec, just a zero-coupon one. */
  TB: { assetClass: "gsec", govtType: "tbill" },
  /** State Development Loans — "SDL AP 7.25% 2037". Government paper; the difference from a central
   *  G-sec is the ISSUER, not the instrument type, so it classes as `gsec` and the issuer is kept
   *  in attributes. Splitting the enum would have described a difference that is not one. */
  SG: { assetClass: "gsec", govtType: "sdl" },
  /** Sovereign Gold Bonds. The one that genuinely IS a different animal — gold-linked, not a rupee
   *  coupon bond — which is exactly why `sgb` exists as its own class (Step 8 created it). */
  GB: { assetClass: "sgb", govtType: "sgb" },
} as const;

export type GovtSeries = keyof typeof GOVT_SERIES;
export type GovtClass = (typeof GOVT_SERIES)[GovtSeries]["assetClass"];
export const GOVT_SERIES_CODES = Object.keys(GOVT_SERIES) as GovtSeries[];
export const isGovtSeries = (s: string): s is GovtSeries => s in GOVT_SERIES;

// ── GUARD: VALIDITY (ISIN) ──
// Government paper lives in a NUMERIC namespace: IN0 (central), IN1/IN2/IN4… (state-coded SDLs).
// The third character is a DIGIT, where equity is INE and a fund is INF. So this pattern accepts
// every government ISIN and STRUCTURALLY CANNOT accept an equity or a fund one — which also means
// a row that lands here can never trip the AMFI `INF%` trespass guard.
export const GOVT_ISIN = /^IN[0-9][0-9A-Z]{9}$/;

// ── GUARD: COUNT ──
// Recon: 197 distinct instruments across 8 sessions (a single session shows ~115 — government paper
// is thinly traded, so ONE day is a sample, not the universe). The band is wide enough for a
// growing universe (new issues land constantly) and tight enough that a truncated file or a broken
// series filter cannot pass as a real one.
export const MIN_GOVT = 60;
export const MAX_GOVT = 800;

export type CountVerdict = { severity: "critical" | "high"; note: string } | null;

export function classifyCount(observed: number): CountVerdict {
  if (observed === 0)
    return {
      severity: "critical",
      note: "ZERO government rows — a renamed series code or a truncated file looks exactly like this. Rejecting rather than treating a live universe as delisted.",
    };
  if (observed < MIN_GOVT)
    return { severity: "high", note: `only ${observed} government instruments (expected ≥ ${MIN_GOVT}) — the file may be truncated or the series filter broken` };
  if (observed > MAX_GOVT)
    return { severity: "high", note: `${observed} government instruments (expected ≤ ${MAX_GOVT}) — possible duplication or a mis-parse` };
  return null;
}

// ── GUARD: RANGE (close) ──
export function checkCloseRange(close: number): boolean {
  return close < CLOSE_MIN || close > CLOSE_MAX;
}
export { CLOSE_MIN, CLOSE_MAX };

// ── GUARD: NULL-RATE (the name parse) ──
// An individual unreadable name is honest-empty (null attributes; identity and price still land —
// they come from COLUMNS, not from the name). But if the parse rate COLLAPSES, NSE changed its
// naming and we want to know that night, not in six months when someone notices every G-sec has a
// blank coupon. Recon: coupon parses 100% on GS/SG/GB today.
export const MIN_COUPON_PARSE_RATE = 0.8; // of the rows that SHOULD have a coupon (i.e. not T-bills)

// ═══════════════════════════════════════════════════════════════
// THE NAME PARSERS
// ═══════════════════════════════════════════════════════════════

export interface GovtAttributes {
  /** The source's own series code, kept verbatim. Never re-derived from the name. */
  series: GovtSeries;
  /** dated | tbill | sdl | sgb — the sub-kind within its asset class. */
  govtType: string;
  /** % p.a. NULL for a T-bill — and that null is CORRECT (a discount instrument HAS no coupon). */
  coupon: number | null;
  /** Why coupon is null, when it legitimately is. */
  couponNullReason: "discount_instrument" | "unparseable_name" | null;
  /** Explicit in every name we can read. */
  maturityYear: number | null;
  /** ONLY T-bills carry a full date in the feed. NULL for GS/SDL/SGB — never invented. */
  maturityDate: string | null;
  maturityDateNullReason: "not_in_source" | "unparseable_name" | null;
  /** T-bills: 91 / 182 / 364. */
  tenorDays: number | null;
  /** SDLs: the issuing state ("AP", "GJ", …). */
  issuerState: string | null;
  /** SGBs: the tranche ("SR-III"). */
  tranche: string | null;
  /** YTM. NOT sourceable, and NOT computable without the exact maturity we refused to invent. */
  yieldToMaturity: null;
  yieldNullReason: "not_sourceable";
}

const YEAR = /(20\d{2})/;

/**
 * Read what the name explicitly says. Everything else is null, with a reason.
 * Pure: same name in, same attributes out. No I/O, no clock, no guessing.
 */
export function parseGovtName(series: GovtSeries, name: string): GovtAttributes {
  const spec = GOVT_SERIES[series];
  const base: GovtAttributes = {
    series,
    govtType: spec.govtType,
    coupon: null,
    couponNullReason: null,
    maturityYear: null,
    maturityDate: null,
    maturityDateNullReason: null,
    tenorDays: null,
    issuerState: null,
    tranche: null,
    yieldToMaturity: null,
    yieldNullReason: "not_sourceable",
  };

  // ── T-BILL — "GOI TBILL 364D-08/07/27" ──────────────────────────────────
  // The ONE government instrument whose exact maturity IS in the feed. It has no coupon, ever.
  if (series === "TB") {
    base.couponNullReason = "discount_instrument"; // NOT a gap — a T-bill genuinely has no coupon
    const tenor = name.match(/(\d{2,3})\s*D\b/i);
    if (tenor) base.tenorDays = Number(tenor[1]);
    const d = name.match(/(\d{2})\/(\d{2})\/(\d{2})/); // DD/MM/YY
    if (d) {
      const [, dd, mm, yy] = d;
      base.maturityDate = `20${yy}-${mm}-${dd}`;
      base.maturityYear = 2000 + Number(yy);
    } else {
      base.maturityDateNullReason = "unparseable_name";
    }
    return base;
  }

  // ── Everything else carries a coupon in the name, and a YEAR but never a DAY. ────────────
  base.maturityDateNullReason = "not_in_source"; // the honest reason: NSE does not publish it here

  const cpn = name.match(/([\d]+(?:\.\d+)?)\s*%/);
  if (cpn) base.coupon = Number(cpn[1]);
  else base.couponNullReason = "unparseable_name";

  if (series === "GB") {
    // "2.5%GOLDBONDS2028SR-III" — the year is GLUED to the text, so it needs a targeted anchor;
    // a naive \b(20\d{2})\b misses every one of them (recon proved it: 0/45).
    const y = name.match(/GOLD\s*BONDS?\s*(20\d{2})/i);
    if (y) base.maturityYear = Number(y[1]);
    const t = name.match(/SR[-\s]?([IVXL]+)/i);
    if (t) base.tranche = `SR-${t[1]!.toUpperCase()}`;
    return base;
  }

  if (series === "SG") {
    // "SDL AP 7.25% 2037"
    const st = name.match(/^\s*SDL\s+([A-Z]{2})\b/i);
    if (st) base.issuerState = st[1]!.toUpperCase();
  }

  const y = name.match(YEAR);
  if (y) base.maturityYear = Number(y[1]);
  return base;
}
