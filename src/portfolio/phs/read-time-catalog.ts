// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE READ-TIME CATALOG LOADER (Construction v2 Stage 10a batch 2) — the PD family's inputs.
//
// ── WHY THIS IS A SEPARATE FILE FROM `read-time-findings.ts` ─────────────────────────────────────
//
// `read-time-findings.ts` says "PURE. No DB, no I/O" and that purity is LOAD-BEARING: it is what lets
// every PD finding be proven by a synthetic fixture, which matters more here than anywhere else in the
// library because the live cohort holds ZERO bonds, gsecs, sgbs, reits and stale accounts — six of the
// seven PD findings CANNOT FIRE against real data. A fire function that needed a database could only be
// tested by a database that cannot exercise it.
//
// So the split follows the same shape PE6 already uses: THE CONTROLLER GATHERS THE LIVE FACTS, THE PURE
// FUNCTION NAMES THEM. This file is the gathering half. It knows how to read; it decides nothing.
//
// ── WHY NOT `assemble.ts` ────────────────────────────────────────────────────────────────────────
//
// `assemble` feeds `persist`. PD must never reach persist (ODL cv2-s10a-pd-read-time): a PD finding
// describes VYTAL, not the book, and the persisted row is a snapshot of the BOOK. Putting the loader in
// assemble would put PD's inputs one import away from the fired set and make the mistake easy. It is not
// in assemble because it must not be reachable from there.
//
// ── ⚠ `instruments.attributes` HAS NEVER BEEN SELECTED IN THE PORTFOLIO PATH ─────────────────────
//
// Every `*NullReason` the ingestion has been faithfully stamping since Step 17 was, until this file,
// unreachable from the read. `partition()` selects id/assetClass/lastPrice/lastPriceDate/currentNav/
// navDate/isActive/isin/category — the whole honest-null design sat in a JSON column nothing looked at.
// A column-name grep cannot see a JSON key, which is why doc 2's table has three reasons and the catalog
// has six (ODL cv2-s10a-nullreason-honest).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { prisma } from "../../db/prisma.js";

/** One held instrument's catalog facts — `attributes` verbatim, unparsed. This file does not interpret;
 *  `null-reasons.ts` classifies and `read-time-findings.ts` composes. One fact, one home, three jobs. */
export interface HeldInstrumentFacts {
  isin: string;
  name: string | null;
  assetClass: string;
  /** The AMFI category leaf. PD5 needs it because `nature` — not `assetClass` — decides whether a
   *  look-through question even exists: a gold ETF holds gold, so there is nothing to see inside. */
  category: string | null;
  /** `instruments.attributes` as stored. The `*NullReason` keys live here and nowhere else. */
  attributes: Record<string, unknown>;

  // ── (Stage 10a batch 3) THE PI FAMILY'S COLUMNS. Selected on the SAME ROW as the fields above,
  //    because they ARE the same row: a second `instrument.findMany` for the same ISINs would be a
  //    second home for one read and a second thing to keep in step. PD reads the top half, PI reads
  //    the bottom half, one query serves both. ────────────────────────────────────────────────────
  /** PI3's subject. AMFI stopped publishing a daily NAV for this scheme. 5,934 of 17,567 funds. */
  isActive: boolean;
  /** PI2's subject. `'regular' | 'direct' | null` — NULL on 3,955 funds, where Step 9 REFUSED to guess. */
  planType: string | null;
  /** PI1's four fields. All nullable, and the DATES matter as much as the values — see PI1. */
  lastPrice: string | null;
  lastPriceDate: string | null;
  currentNav: string | null;
  navDate: string | null;
  /** The join key to `mf_analytics`. Null ⇒ not an AMFI scheme (a stock, a bond, a REIT). */
  amfiSchemeCode: string | null;
}

/**
 * One held fund's folded analytics — PD6's history extent AND the PI family's metrics, on ONE row.
 *
 * ⚠ THIS WAS `HeldFundHistory` AND IT CARRIED THREE FIELDS. It is widened rather than joined by a second
 * loader for the reason batch 2 gave for putting it here at all: `mf_analytics` is ONE ROW PER SCHEME, and
 * PD6's `navPoints` and PI5's `maxDrawdown5y` are two columns of it. Two loaders would issue two queries
 * against the same primary key and give one fact two homes — and the second one drifts.
 *
 * ★ AND PD6 AND PI5 ARE NOT INDEPENDENT READERS OF IT: PI5's Read names the window PD6 measures, and the
 * co-fire assert (`verify-phs-pi-readtime.ts` §7) compares them. Loading them separately would let the
 * two findings disagree about the same fund's history, which is the exact class of bug the co-fire
 * exists to catch.
 */
export interface HeldFundAnalytics {
  isin: string;
  schemeCode: string;
  // ── PD6's subject: the EVIDENCE behind every honest-empty the fold made (nav_points' own docstring) ──
  navPoints: number;
  windowFrom: string | null;
  windowTo: string | null;
  /** The newest NAV date folded. PI5 needs it to compute the ACTUAL span a rung covers: a 5y rung on a
   *  series starting 4.4 years ago covers 4.4 years, not 5 — see PI5. */
  asOfDate: string | null;
  /** The scheme whose NAV series these metrics were MEASURED ON. Self for a Growth plan/ETF; the Growth
   *  twin for an INHERITED IDCW plan; NULL when the fold declined (`idcw_nav_not_total_return`). */
  seriesSchemeCode: string | null;

  // ── PI5's ladder. NEGATIVE fractions (−0.4231 = a 42.31% peak-to-trough fall). ──
  maxDrawdown1y: number | null;
  maxDrawdown3y: number | null;
  maxDrawdown5y: number | null;
  // ── PI4's subject, and the benchmark it is an error TO. "1.18" says nothing without it. ──
  trackingError1y: number | null;
  benchmarkIndex: string | null;
  benchmarkVia: string | null;
  // ── PI6's subject (default OFF — K.PI6_CATEGORY_RANK_ENABLED). `rankPool*` is the TRUE denominator. ──
  rank1y: number | null;
  rank3y: number | null;
  rank5y: number | null;
  rankPool1y: number | null;
  rankPool3y: number | null;
  rankPool5y: number | null;
  rankBucket: string | null;
  rankBucketSize: number | null;

  /** ★ THE HONEST-EMPTY LEDGER, VERBATIM AND UNPARSED — WHY each null above is null. This file does not
   *  interpret it; `omissionFor()` (null-reasons.ts) applies the two-level `_all` rule and classifies,
   *  and PI5 reads the CLASS to decide whether a null is an ABSENCE it may walk past or a REFUSAL it must
   *  inherit. Passing the raw JSON through is what keeps that decision in one place. */
  omissions: unknown;
}

/** The catalog facts for the instruments a user actually holds. Read-only; `[]` for an empty book. */
export async function loadHeldInstrumentFacts(isins: string[]): Promise<HeldInstrumentFacts[]> {
  if (!isins.length) return [];
  const rows = await prisma.instrument.findMany({
    where: { isin: { in: isins } },
    select: {
      isin: true, name: true, assetClass: true, category: true, attributes: true,
      // (batch 3) PI's columns — same row, same query. See `HeldInstrumentFacts`.
      isActive: true, planType: true, amfiSchemeCode: true,
      lastPrice: true, lastPriceDate: true, currentNav: true, navDate: true,
    },
  });
  return rows.map((r) => ({
    isin: r.isin,
    name: r.name,
    assetClass: String(r.assetClass),
    category: r.category,
    // `attributes` is Json? — null, a scalar, or an array are all shapes Prisma's type permits and the
    // ingestion never writes. Anything that is not an object becomes {}, so a malformed row reads as
    // "no reasons stamped" (every field simply omitted) rather than throwing inside a portfolio read.
    attributes:
      r.attributes && typeof r.attributes === "object" && !Array.isArray(r.attributes)
        ? (r.attributes as Record<string, unknown>)
        : {},
    isActive: r.isActive,
    planType: r.planType ? String(r.planType) : null,
    amfiSchemeCode: r.amfiSchemeCode,
    // ★ Decimal → string, never → number. These are money, and PI1 divides them: `Number()` on a
    // Decimal here would be a silent precision decision made in a loader. The finding does the
    // arithmetic, in one place, where the rounding is visible.
    lastPrice: r.lastPrice != null ? r.lastPrice.toString() : null,
    currentNav: r.currentNav != null ? r.currentNav.toString() : null,
    lastPriceDate: iso(r.lastPriceDate),
    navDate: iso(r.navDate),
  }));
}

/** A DATE column → 'YYYY-MM-DD'. PI1 compares these for EQUALITY, so the comparison must never see a
 *  time component: two `Date`s on the same trading day with different clock times are not equal, and the
 *  gate would silently fail closed on every pair — reading as "no same-day pair exists" forever. */
const iso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * The NAV-history extent for the funds a user holds. Joins instruments → mf_analytics on
 * `amfiSchemeCode` (soft: that column is non-unique by design, so no FK exists).
 *
 * A held fund with NO mf_analytics row is OMITTED, not returned as zero: "the nightly job has not
 * computed this scheme" and "this scheme has zero NAV points" are different facts, and only one of them
 * is about the fund. mf-controllers.ts:46 makes the same refusal in its own words — "This is not an error
 * state for a newly-listed fund."
 */
export async function loadHeldFundAnalytics(isins: string[]): Promise<HeldFundAnalytics[]> {
  if (!isins.length) return [];
  const instrs = await prisma.instrument.findMany({
    where: { isin: { in: isins }, amfiSchemeCode: { not: null } },
    select: { isin: true, amfiSchemeCode: true },
  });
  const codes = [...new Set(instrs.map((i) => i.amfiSchemeCode!).filter(Boolean))];
  if (!codes.length) return [];
  const rows = await prisma.mfAnalytics.findMany({
    where: { schemeCode: { in: codes } },
    select: {
      schemeCode: true, navPoints: true, windowFrom: true, windowTo: true,
      asOfDate: true, seriesSchemeCode: true,
      maxDrawdown1y: true, maxDrawdown3y: true, maxDrawdown5y: true,
      trackingError1y: true, benchmarkIndex: true, benchmarkVia: true,
      rank1y: true, rank3y: true, rank5y: true,
      rankPool1y: true, rankPool3y: true, rankPool5y: true,
      rankBucket: true, rankBucketSize: true,
      omissions: true,
    },
  });
  const byCode = new Map(rows.map((r) => [r.schemeCode, r]));
  const out: HeldFundAnalytics[] = [];
  for (const i of instrs) {
    const a = byCode.get(i.amfiSchemeCode!);
    if (!a) continue; // no row ⇒ not computed ⇒ we say nothing, rather than say "zero"
    out.push({
      isin: i.isin,
      schemeCode: a.schemeCode,
      navPoints: a.navPoints,
      windowFrom: iso(a.windowFrom),
      windowTo: iso(a.windowTo),
      asOfDate: iso(a.asOfDate),
      seriesSchemeCode: a.seriesSchemeCode,
      // ★ Decimal → number HERE, and only here. These are FRACTIONS, not money: a drawdown of −0.22752
      // is a ratio the finding formats as a percentage, and no rounding decision survives the conversion.
      // (Contrast `lastPrice` above, which stays a string precisely because PI1 divides it.)
      maxDrawdown1y: dec(a.maxDrawdown1y),
      maxDrawdown3y: dec(a.maxDrawdown3y),
      maxDrawdown5y: dec(a.maxDrawdown5y),
      trackingError1y: dec(a.trackingError1y),
      benchmarkIndex: a.benchmarkIndex,
      benchmarkVia: a.benchmarkVia,
      rank1y: a.rank1y, rank3y: a.rank3y, rank5y: a.rank5y,
      rankPool1y: a.rankPool1y, rankPool3y: a.rankPool3y, rankPool5y: a.rankPool5y,
      rankBucket: a.rankBucket, rankBucketSize: a.rankBucketSize,
      omissions: a.omissions,
    });
  }
  return out;
}

/** A Decimal? fraction → number|null. Never `Number(x) || null` — that maps a TRUE 0 to null, and 0 is a
 *  value 730 rows of `max_drawdown_5y` actually hold. (An overnight fund's deepest fall really is 0.00%.
 *  Whether we may SAY so is PI5's question, and it cannot ask it about a null we manufactured here.) */
const dec = (d: { toString(): string } | null): number | null => (d == null ? null : Number(d.toString()));
