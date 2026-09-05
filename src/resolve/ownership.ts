// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// RESOLVER — OWNERSHIP. Four different answers under one lens, and the universe cross-section.
//
// ── ★★ WHY THIS FILE EXISTS: THE T08 MISROUTE, CLOSED WHERE IT ACTUALLY LIVES ─────────────────────
// `families/ownership.ts` recorded the finding and could not fix it: `lens: "ownership"` covers FOUR
// distinct answers — the REGISTER, the FLOW, the DEALING, and PLEDGING — and the slot vocabulary has
// one word for all four. Stage 6's response was to narrow the predicate to `orient` and hand every
// `lookup + ownership` question to the planner, losing a guaranteed shape on the commonest phrasings
// rather than answering the wrong question on some of them. That was the right trade at the time and
// it is not a fix.
//
// ★ THE FIX IS A CODE-EXTRACTED FOCUS, WHICH IS AN ESTABLISHED MECHANISM AND NOT A NEW ONE. The
//   router emits slots; a predicate reads slots (never data, §5); and the raw sentence is neither —
//   `families/reader.ts#readerShape` reads it to pick between five reader answers, and
//   `screen-conditions.ts#extractConditions` reads it to pull screen conditions, which §6.5 blesses
//   explicitly. `ownershipFocus` below is the third instance of the same pattern.
//
// ── ★★ AND WHY THE FOUR ARE FOUR ANSWERS RATHER THAN ONE WITH A PARAMETER ─────────────────────────
// This is the test §4.1 asks and F answers the other way. F's four statements read the SAME filing
// and produce the SAME section sequence with different rows — a parameter. These four read four
// different TABLES (`shareholding_patterns` current, that table over time, `insider_trades` plus
// `block_deals`, and the pledge columns) and produce four different SECTION SEQUENCES. A register is
// a DECOMPOSITION of one whole; a flow is a SERIES; dealing is a RAIL; pledging is a sentence with no
// component at all. Nothing about them is one shape parameterised.
//
// ── ★★ SNAPSHOT AND SERIES ARE DIFFERENT PRODUCTS, MEASURED ───────────────────────────────────────
// Re-measured this batch, and one of the brief's figures needs correcting in the safe direction:
//
//   2,058 stocks hold ANY filing        · 233 hold none at all
//   2,024 hold two or more              → a one-step move is readable
//   1,940 hold four or more             → a real series
//   1,481 hold eight or more            → two years of steps
//     459 hold a filing older than FY25Q1 (average 28 filings) → the deep tail
//
// The brief's "~430 have deep history" is the last row, not the series universe. An 8-filing series
// is available for **1,481** stocks, not ~430 — so the depth floor for a series answer is a real
// floor and not a near-total exclusion. Stated here because designing to ~430 would have thrown away
// a series answer for a thousand stocks that can support one. The cliff itself is confirmed exactly:
// FY27Q1 covers 2,022 stocks and FY25Q1 covers 475.
//
// ── ★ PLEDGING GOES THROUGH `resolve/pledge.ts` AND NOWHERE ELSE ──────────────────────────────────
// This file reads the raw pledge columns and hands them straight to `readPledge`. It never divides
// them, never compares them, and never returns a number for them. See that file for the measurement.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { pairDeals } from "./deal-pairs.js";
import { prisma } from "../db/prisma.js";
import { buildOwnershipView } from "../scoring/read/ownership-series.service.js";
import { resolveStockCoverage } from "./stock-coverage.js";
import { readPledge, type PledgeReading } from "./pledge.js";
import { absent, coverageReadFailed, resolved, type Coverage, type Resolved, type Source } from "./contract.js";

/**
 * ★ THE FOUR ANSWERS. See the header for why these are four and F's are one.
 */
export type OwnershipFocus = "register" | "flow" | "dealing" | "pledging";

/** One holding class, as filed. Percentages of total equity. */
export interface HoldingPart {
  readonly key: string;
  readonly label: string;
  readonly pct: number;
}

export interface OwnershipSnapshot {
  readonly periodKey: string;
  readonly asOnDate: string;
  readonly parts: readonly HoldingPart[];
  readonly promoterPct: number | null;
  readonly promoterDeltaPp: number | null;
  readonly instPct: number | null;
  readonly instDeltaPp: number | null;
  /** Classes the filing did not break out. NAMED, never zeroed (§3.4 in its rendering form). */
  readonly undisclosed: readonly string[];
  /** Whether a prior filing exists to compare against at all. */
  readonly hasPrior: boolean;
}

/** One class's path across the filings. Points are per filing — they STEP, they do not flow. */
export interface OwnershipClassSeries {
  readonly key: string;
  readonly label: string;
  readonly points: readonly { readonly at: string; readonly value: number }[];
}

export interface DealingItem {
  readonly at: string | null;
  readonly who: string;
  readonly what: string;
  readonly detail: string;
  readonly channel: "insider" | "deal";
}

export interface OwnershipRead {
  readonly symbol: string;
  readonly focus: OwnershipFocus;
  /** The latest filing. `null` only when we hold none — and then `ok` is false, so it is non-null here. */
  readonly snapshot: OwnershipSnapshot;
  /** How many filings we hold. THE bound on any series claim. */
  readonly filingsHeld: number;
  /** Oldest → newest, one per filing. Empty when only one filing is held. */
  readonly periods: readonly string[];
  readonly series: readonly OwnershipClassSeries[];
  readonly insider: readonly DealingItem[];
  readonly deals: readonly DealingItem[];
  readonly insiderTotal: number;
  readonly dealsTotal: number;
  /** ★ NEVER A NUMBER. See `resolve/pledge.ts`. */
  readonly pledge: PledgeReading;
  /** The ownership tool's own categorical reading. `null` under two filings — a real answer. */
  readonly tell: string | null;
  /** Whether Vytal scores this stock's ownership pillar. */
  readonly scored: boolean;
}

const CLASS_LABEL: Record<string, string> = {
  promoter: "Promoter", fii: "Foreign institutions", dii: "Domestic institutions",
  retail: "Retail and public", others: "Others",
};

/**
 * ★ THE REGISTER'S PARTS, WITH `others` AS THE REMAINDER — AND THAT IS A FIX, NOT A CHOICE.
 *
 * ⚠ MEASURED LIVE ON EVERY SUBJECT: `retailPct` AND `othersPct` ARE THE SAME NUMBER. TCS retail 5.70
 *   / others 5.70; INFY 15.92 / 15.92; HDFCBANK 16.25 / 16.25. Reading both produces a register that
 *   sums to 105.7% and a donut with a duplicated slice. `company-snapshot.ts` found and fixed this;
 *   the same rule is applied here rather than a second opinion being invented (N-3).
 *
 *   The remainder is the only honest value for this bucket: it is the one that makes the parts sum to
 *   the whole, which is the single claim a parts-of-a-whole component makes.
 */
function partsOf(h: {
  promoterPct: number | null; fiiPct: number | null; diiPct: number | null; retailPct: number | null;
}): { parts: HoldingPart[]; undisclosed: string[] } {
  const undisclosed: string[] = [];
  const parts: HoldingPart[] = [];
  const take = (key: string, v: number | null) => {
    // ⚠ `null` IS UNDISCLOSED; `0` IS A REAL HOLDING OF NOTHING. HDFCBANK files promoter 0 because it
    //   has no promoter, and pushing that into `undisclosed` would report a disclosed fact as a gap.
    if (v === null) { undisclosed.push(CLASS_LABEL[key] ?? key); return; }
    parts.push({ key, label: CLASS_LABEL[key]!, pct: v });
  };
  take("promoter", h.promoterPct);
  take("fii", h.fiiPct);
  take("dii", h.diiPct);
  take("retail", h.retailPct);
  const named = parts.reduce((a, b) => a + b.pct, 0);
  const rest = Math.round((100 - named) * 100) / 100;
  if (rest > 0.05) parts.push({ key: "others", label: CLASS_LABEL.others!, pct: rest });
  return { parts, undisclosed };
}

const pp = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : Math.round((a - b) * 100) / 100;

const SHOW = 12;

/**
 * ★ HOW MANY FILINGS THE SERIES ASKS FOR. Twelve is three years of quarters — past the FY25Q1 cliff
 *   for the deep tail and short enough that a thin stock's honest answer is visibly short rather than
 *   padded. The RESOLVED count comes back in `filingsHeld` (§3.3: a caller who asked 12 and got 1
 *   must be able to see 1).
 */
const SERIES_ASK = 12;

export async function resolveOwnership(
  symbol: string,
  focus: OwnershipFocus,
): Promise<Resolved<OwnershipRead>> {
  const sym = (symbol ?? "").trim().toUpperCase();
  const cov = await resolveStockCoverage(sym);
  if (coverageReadFailed(cov)) return absent<OwnershipRead>("read_failed", { subject: null, query: null });
  const coverage: Coverage = cov.coverage;
  if (!sym) return absent<OwnershipRead>("not_in_universe", coverage);

  // ⚠ C-1. A view we could not BUILD is our failure; a view that built and holds nothing is the
  //   company's silence. The branch below reads the second meaning off the first's result.
  let viewRead = true;
  const v = await buildOwnershipView(sym, SERIES_ASK).catch(() => { viewRead = false; return null; });
  if (!viewRead) return absent<OwnershipRead>("read_failed", coverage);
  // ⚠ NO VIEW AT ALL IS A DIFFERENT ABSENCE FROM NO FILINGS. The first is the stock not being ours;
  //   the second is 233 real stocks in our universe that have never filed a pattern with us.
  if (!v) return absent<OwnershipRead>("not_in_universe", coverage);
  if (!v.current?.holding && v.series.length === 0) {
    return absent<OwnershipRead>("insufficient_shareholding_history", coverage);
  }

  // ── THE RAW PLEDGE COLUMNS. Read here, ruled on in ONE place — see resolve/pledge.ts. ───────────
  //
  // ⚠ THE READ MODEL'S DERIVED `pledgedPctOfPromoter` IS NOT ENOUGH TO RULE ON, because the ruling
  //   needs both columns to cross-check and the derived field collapses them into one. So the two raw
  //   columns are fetched directly for the latest filing.
  let pledgeRead = true;
  const rawPledge = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT p.pledged_shares, p.promoter_shares
       FROM shareholding_patterns p
       JOIN stocks s ON s.id = p.stock_id
      WHERE s.symbol = $1
      ORDER BY p.as_on_date DESC
      LIMIT 1`,
    sym,
  ).catch(() => { pledgeRead = false; return [] as Array<Record<string, unknown>>; });
  // ⚠ A FAILED PLEDGE READ IS DELIBERATELY `not_established`, AND THAT IS HONEST RATHER THAN LAZY.
  //   `not_established`'s phrase is already OURS by construction — pledge.ts:83 states it outright:
  //   "the filing may well have said nothing, and it may have said something our parse flattened to a
  //   zero, and we cannot tell which." A failed query is a third way of not being able to tell, and
  //   it lands on a sentence that already claims nothing about what the company disclosed.
  //
  // ⚠ THE FLAG EXISTS SO THE CHOICE IS STATED, NOT INFERRED. A widened swallowed-absence window
  //   flagged this site next to an `absent()` eleven lines below that is gated on a DIFFERENT read —
  //   a coincidence of proximity, not a defect. Writing the intent down is what distinguishes them.
  if (!pledgeRead) { /* fall through: readPledge's null inputs yield `not_established`, which is ours */ }
  const rp = rawPledge[0];
  const asNum = (x: unknown): number | null =>
    x === null || x === undefined ? null : Number.isFinite(Number(x)) ? Number(x) : null;
  const pledge = readPledge({
    pledgedShares: asNum(rp?.pledged_shares),
    promoterShares: asNum(rp?.promoter_shares),
  });

  // ── THE SNAPSHOT ────────────────────────────────────────────────────────────────────────────────
  const cur = v.current?.holding ?? v.series[v.series.length - 1]?.holding ?? null;
  if (!cur) return absent<OwnershipRead>("insufficient_shareholding_history", coverage);
  const prevPoint = v.series.length >= 2 ? v.series[v.series.length - 2] : undefined;
  const prev = prevPoint?.holding ?? null;

  const { parts, undisclosed } = partsOf(cur);
  const instCur = cur.fiiPct !== null && cur.diiPct !== null ? cur.fiiPct + cur.diiPct : null;
  const instPrev = prev && prev.fiiPct !== null && prev.diiPct !== null ? prev.fiiPct + prev.diiPct : null;

  const snapshot: OwnershipSnapshot = {
    periodKey: String(v.current?.periodKey ?? v.series[v.series.length - 1]?.periodKey ?? cur.asOnDate),
    asOnDate: cur.asOnDate,
    parts,
    promoterPct: cur.promoterPct,
    promoterDeltaPp: prev ? pp(cur.promoterPct, prev.promoterPct) : null,
    instPct: instCur,
    instDeltaPp: pp(instCur, instPrev),
    undisclosed,
    hasPrior: prev !== null,
  };

  // ── THE SERIES. One point per FILING — the step is the honesty rule, see the family file. ───────
  const withHolding = v.series.filter((p) => p.holding !== null);
  const periods = withHolding.map((p) => String(p.periodKey ?? p.holding!.asOnDate));
  const series: OwnershipClassSeries[] = (["promoter", "fii", "dii", "retail"] as const)
    .map((k) => ({
      key: k,
      label: CLASS_LABEL[k]!,
      points: withHolding
        .map((p, i) => {
          const val = (p.holding as unknown as Record<string, number | null>)[`${k}Pct`];
          return typeof val === "number" ? { at: periods[i]!, value: val } : null;
        })
        .filter((x): x is { at: string; value: number } => x !== null),
    }))
    // ⚠ A CLASS WITH NO POINTS IS DROPPED, NOT PLOTTED FLAT AT ZERO. HDFCBANK has no promoter; a
    //   promoter line at 0% across twelve filings is a claim that a promoter holding shrank to
    //   nothing rather than never existing.
    .filter((l) => l.points.length > 0);

  const cr = (x: number | null) => (x == null ? null : `₹${x.toFixed(2)} Cr`);
  const insider: DealingItem[] = v.events.insider.slice(0, SHOW).map((e) => ({
    at: e.tradeDate,
    who: `${e.personName} (${e.personCategory.replace(/_/g, " ")})`,
    what: e.transactionType.replace(/_/g, " "),
    detail: [
      e.securitiesTraded ? `${Number(e.securitiesTraded).toLocaleString("en-IN")} shares` : null,
      cr(e.tradeValueCr),
      e.holdingPctDelta != null ? `${e.holdingPctDelta > 0 ? "+" : ""}${e.holdingPctDelta.toFixed(2)}pp of their own holding` : null,
      `disclosed under regulation ${e.regulation}`,
    ].filter(Boolean).join(" · "),
    channel: "insider" as const,
  }));
  // ★ ONE HOME FOR THE PAIRING (N-3). The planner's `resolveOwnershipEvents` renders the same rail
  //   from the same events; a second copy of the 1:1 rule here is the copy that would drift.
  // ⚠ PAIRED BEFORE CAPPING — slicing first strands one leg of a pair and shows a purchase with no
  //   counterparty, which reads as one-way activity that never happened.
  const deals: DealingItem[] = pairDeals(v.events.block).slice(0, SHOW).map((e) => ({
    at: e.at, who: e.who, what: e.what, detail: e.detail, channel: "deal" as const,
  }));

  return resolved<OwnershipRead>(
    {
      symbol: sym,
      focus,
      snapshot,
      filingsHeld: v.series.length,
      periods,
      series,
      insider,
      deals,
      insiderTotal: v.events.insider.length,
      // ⚠ DEALS, NOT LEGS — the count is what the rail's "n of m" is built from. `v.events.block.length`
      //   counts DISCLOSURE ROWS, and after pairing a two-legged deal is one row: TCS would have read
      //   "1 of 2", which says we truncated the list when we merged it.
      dealsTotal: pairDeals(v.events.block).length,
      pledge,
      tell: v.tell ? String(v.tell) : null,
      scored: v.scored,
    },
    coverage,
    ["stocks"] satisfies Source[],
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ★★ THE MISS-LOG ROW. "what has changed in promoter holdings this quarter"
//
// §6.4's own worked example of a question that reaches the generic branch live, and the one genuine
// reader row in the log: `in_scope · lookup · ownership`, **no subject**, classified missing-FAMILY
// rather than missing-DATA. We held everything it needed — 2,022 stocks at FY27Q1 against 2,017 at
// FY26Q4 — and had no view that answered it.
//
// ★ IT IS A UNIVERSE CROSS-SECTION, NOT A COMPANY ANSWER, and that is why no existing path caught it.
//   Step 3g takes subjectless turns only for `screen` and for a market-wide regex; neither matches.
//   So it fell past every family (all three `requiresSubject`) and past the planner (gated on a
//   symbol) into the generic branch.
//
// ⚠ THE MOVE IS BETWEEN A STOCK'S OWN TWO MOST RECENT FILINGS, NOT BETWEEN TWO FIXED PERIODS. Filings
//   do not land together: measured, FY27Q2 has 75 stocks while FY27Q1 has 2,022. Pinning the
//   comparison to "the latest period in the table" would compare 75 stocks' new filing against 2,022
//   stocks' old one and report the other 1,947 as unchanged. Each stock is compared with itself.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

export interface PromoterMover {
  readonly symbol: string;
  readonly name: string;
  readonly period: string;
  readonly priorPeriod: string;
  readonly promoterPct: number;
  readonly deltaPp: number;
}

export interface PromoterMoversRead {
  readonly increased: readonly PromoterMover[];
  readonly decreased: readonly PromoterMover[];
  /** Stocks whose two most recent filings BOTH disclose a promoter figure — the honest denominator. */
  readonly comparable: number;
  /** Of those, how many did not move. A real answer, and the majority one. */
  readonly unchanged: number;
  /** Stocks holding a filing at all. The wider bound. */
  readonly withFiling: number;
  /** The most recent period any stock has filed, and the one most have. Stated because they differ. */
  readonly latestPeriod: string | null;
  readonly modalPeriod: string | null;
  readonly shown: number;
}

/** How many movers each direction carries. A cross-section, not a ranking of the whole universe. */
const MOVERS_SHOWN = 8;

/** A move smaller than this is filing noise rather than a change in who owns the company. */
const MOVE_FLOOR_PP = 0.5;

export async function resolvePromoterMovers(): Promise<Resolved<PromoterMoversRead>> {
  // ★ C-1, AND THE LAST OF THE NINE. This was allowlisted as "genuinely ambiguous", and the ambiguity
  //   was real but came from reading the two queries as one thing. Separated, they are not ambiguous:
  //
  //     · the MOVERS query — throws, or returns rows. Empty after a clean read is a true statement
  //       about the record: no stock in the universe has promoter holding disclosed in both of its
  //       two most recent filings. `insufficient_shareholding_history` is honest for exactly that.
  //     · the BOUNDS query — supplies `with_filing`, and with it `universeSearched`,
  //       `excludedForDepth` and the first `dropped` count. It is the CENSUS HALF: what makes this a
  //       census rather than a list of eight names.
  //
  // ⚠ A FAILED BOUNDS READ USED TO PRODUCE A COMPLETE-LOOKING CENSUS OVER A UNIVERSE OF ZERO. The
  //   `?? 0` turned the failure into `universeSearched: 0`, `excludedForDepth: 0`, `dropped: 0` — a
  //   coverage statement asserting we searched nothing and dropped nothing, printed underneath real
  //   movers. The comment below it says a set that quietly lost members reads as a complete set; that
  //   was true of the FILTER and not of the FAILURE, one line above.
  //
  // ⚠ AND `universeSearched` IS `number`, NOT `number | null` — the contract cannot say "unknown".
  //   Widening it would ripple through every renderer that formats coverage, which is a contract
  //   change and not a cleanup, so the honest close is to decline the census rather than invent its
  //   denominator. Named here rather than silently chosen.
  let moversRead = true;
  let boundsRead = true;
  // ⚠ ONE STATEMENT, AND THE WINDOW FUNCTION IS WHAT MAKES IT PER-STOCK. `LAG` over each stock's own
  //   `as_on_date` ordering gives every stock its own previous filing, which is the correction in the
  //   header. A GROUP BY over two named periods would have been simpler and wrong.
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `WITH ranked AS (
       SELECT p.stock_id, s.symbol, s.name,
              p.fiscal_year || p.quarter                                              AS period,
              p.as_on_date,
              p.promoter_pct,
              LAG(p.promoter_pct)          OVER (PARTITION BY p.stock_id ORDER BY p.as_on_date) AS prior_pct,
              LAG(p.fiscal_year||p.quarter) OVER (PARTITION BY p.stock_id ORDER BY p.as_on_date) AS prior_period,
              ROW_NUMBER()                 OVER (PARTITION BY p.stock_id ORDER BY p.as_on_date DESC) AS rn
         FROM shareholding_patterns p
         JOIN stocks s ON s.id = p.stock_id
     )
     SELECT symbol, name, period, prior_period,
            promoter_pct::float8 AS promoter_pct,
            (promoter_pct - prior_pct)::float8 AS delta_pp
       FROM ranked
      WHERE rn = 1 AND promoter_pct IS NOT NULL AND prior_pct IS NOT NULL
      ORDER BY ABS(promoter_pct - prior_pct) DESC`,
  ).catch(() => { moversRead = false; return [] as Array<Record<string, unknown>>; });

  const [bounds] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `WITH latest AS (
       SELECT DISTINCT ON (stock_id) stock_id, fiscal_year || quarter AS period
         FROM shareholding_patterns ORDER BY stock_id, as_on_date DESC
     )
     SELECT (SELECT COUNT(*) FROM latest)::int                                  AS with_filing,
            (SELECT MAX(period) FROM latest)                                    AS latest_period,
            (SELECT period FROM latest GROUP BY period ORDER BY COUNT(*) DESC LIMIT 1) AS modal_period`,
  ).catch(() => { boundsRead = false; return [] as Array<Record<string, unknown>>; });

  // Our failure first, and it outranks the record's silence: an empty `rows` after a FAILED read is
  // not evidence about shareholding filings at all.
  if (!moversRead || !boundsRead || !bounds) {
    return absent<PromoterMoversRead>("read_failed", { subject: null, query: null });
  }
  // ⚠ AND THE DENOMINATOR IS CHECKED, NOT COERCED. `COUNT(*)::int` cannot be null, so a value that is
  //   not a finite number means the row is not the row this code thinks it is — `?? 0` would turn
  //   that into the same fabricated census the guard above exists to prevent.
  const withFilingRaw = Number(bounds.with_filing);
  if (!Number.isFinite(withFilingRaw)) {
    return absent<PromoterMoversRead>("read_failed", { subject: null, query: null });
  }
  if (rows.length === 0) {
    return absent<PromoterMoversRead>("insufficient_shareholding_history", { subject: null, query: null });
  }

  const all: PromoterMover[] = rows.map((r) => ({
    symbol: String(r.symbol),
    name: String(r.name ?? r.symbol),
    period: String(r.period),
    priorPeriod: String(r.prior_period ?? ""),
    promoterPct: Number(r.promoter_pct),
    deltaPp: Math.round(Number(r.delta_pp) * 100) / 100,
  }));

  const moved = all.filter((m) => Math.abs(m.deltaPp) >= MOVE_FLOOR_PP);
  const increased = moved.filter((m) => m.deltaPp > 0).slice(0, MOVERS_SHOWN);
  const decreased = moved.filter((m) => m.deltaPp < 0).slice(0, MOVERS_SHOWN);

  // ★ THE COVERAGE HALF IS THE QUERY'S, NOT A SUBJECT'S. This answer has no subject at all, so
  //   `subject: null` is a statement rather than an oversight (§3.3), and the dropped filter is
  //   NAMED: a set that quietly lost members reads as a complete set.
  const withFiling = withFilingRaw;   // proven finite above; never coerced from a failed read
  const coverage: Coverage = {
    subject: null,
    query: {
      universeSearched: withFiling,
      depthFloor: 2,
      excludedForDepth: Math.max(0, withFiling - all.length),
      dropped: [
        {
          filter: `promoter holding disclosed in both of a stock's two most recent filings`,
          dropped: Math.max(0, withFiling - all.length),
          why: "a stock with one filing, or one that did not break out the promoter class, has no move to read",
        },
        {
          filter: `move of at least ${MOVE_FLOOR_PP}pp`,
          dropped: all.length - moved.length,
          why: "a smaller move is filing noise rather than a change in who owns the company",
        },
      ],
    },
  };

  return resolved<PromoterMoversRead>(
    {
      increased, decreased,
      comparable: all.length,
      unchanged: all.length - moved.length,
      withFiling,
      latestPeriod: bounds?.latest_period ? String(bounds.latest_period) : null,
      modalPeriod: bounds?.modal_period ? String(bounds.modal_period) : null,
      shown: increased.length + decreased.length,
    },
    coverage,
    ["stocks"] satisfies Source[],
  );
}

/**
 * ★ WHICH OF THE FOUR OWNERSHIP ANSWERS THE QUESTION IS ABOUT — see the header for why this is not a
 *   predicate.
 *
 * ⚠ ORDER IS THE RULING. Pledging is tested FIRST because a pledge question is the one whose wrong
 *   answer is worst: "how much of the promoter stake is pledged" answered with a register is a
 *   confident, well-rendered answer to a question about a figure we have declined to state. Dealing
 *   comes before flow because "have insiders been buying" contains a movement word and is not a
 *   register question — it is exactly the phrasing the T08 misroute got wrong.
 *
 * ⚠ WORD LISTS, NOT REGEX. Same inherited scar as `readerShape` and `statementFocus`.
 */
export function ownershipFocus(raw: string): OwnershipFocus {
  const words = new Set(raw.toLowerCase().replace(/[^a-z ]+/g, " ").split(/ +/).filter(Boolean));
  const any = (...xs: string[]) => xs.some((x) => words.has(x));

  if (any("pledge", "pledged", "pledging", "encumbered", "encumbrance", "collateral")) return "pledging";
  if (any("insider", "insiders", "bought", "buying", "sold", "selling", "sell", "buy",
          "deal", "deals", "block", "bulk", "transaction", "transactions", "trades", "trading",
          "disclosed", "disclosure", "disclosures")) return "dealing";
  if (any("changed", "change", "changes", "moved", "move", "moving", "trend", "trends",
          "history", "historical", "over", "since", "trimmed", "added", "rotation", "flow",
          "flows", "increased", "decreased", "reduced", "raised")) return "flow";
  // ★ THE REGISTER IS THE DEFAULT AND IT IS THE RIGHT ONE. "Who owns X" is the commonest ownership
  //   question a reader types and the register is its literal answer.
  return "register";
}
