// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE EIGHT NON-SINGLE-STOCK BLOCK BUILDERS — portfolio · watchlist · relationship · instrument ·
// fund · comparison · universe · screen. Stage 7.
//
// ── ★ WHY THESE ARE NOT IN `BLOCK_MENU` ──────────────────────────────────────────────────────────
// The menu is what the PLANNER may choose from, and the planner plans over a `CapabilityManifest`,
// which is a manifest OF A STOCK. There is no honest way to offer "your portfolio" on a menu whose
// availability flags describe a company — the model would be choosing a block whose data it was
// never told about.
//
// So these are assembled by deterministic compositions keyed on the SUBJECT KIND (§5.3's
// guaranteed-shape exception), and the planner keeps the tail it is actually equipped for. That is
// not a workaround: a reader asking about their own book is asking a question with one right shape,
// and the shape does not benefit from being planned.
//
// ── ★ THE COVERAGE HALF IS THE PART TO GET RIGHT AT THIS VOLUME ──────────────────────────────────
// Reader blocks carry `ReaderCoverage`; instrument blocks carry `InstrumentCoverage`; screen and
// universe carry `QueryCoverage` with `subject: null`. Every one of those is a shape `stockCoverage()`
// returns `null` for — by design (§3.7) — so a block that assumed a stock would compile and lie.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import {
  resolvePortfolio, resolveWatchlist, resolveRelationship, resolveAlerts, resolveReminders,
} from "../resolve/blocks-reader.js";
import {
  resolveInstrumentDetail, resolveFund, resolveComparison, resolveUniverse, resolveScreen,
  type ScreenCondition,
} from "../resolve/blocks-market.js";
import { blockCopy } from "../catalogue/block-copy.js";
import {
  resolvePortfolioValueSeries, resolvePortfolioHealthSeries,
} from "../resolve/blocks-portfolio-series.js";
import {
  setTableSection, type SetTableColumn, type SetTableRow, type SetTableCell,
} from "../section/kinds/set-table.js";
import { heroSetSection, heroDualSection, type SetMember } from "../section/kinds/hero.js";
import { relativeSection, type RelativeMark } from "../section/kinds/relative.js";
import { steppedFilingSection, spineSection, valueLineSection } from "../section/kinds/series.js";
import { FORMATTERS } from "./blocks.js";
import type { AnySection } from "../composition/contract.js";
import type { Coverage } from "../resolve/contract.js";
import type { ReaderProfile } from "../reader/profile.js";

const { cr, money, pct, plain } = FORMATTERS;
const score = (v: number | null): string | null => (v === null ? null : v.toFixed(1));

export interface BuiltBlock { readonly section: AnySection; readonly coverage: Coverage }

// ═══ 8 · PORTFOLIO ═════════════════════════════════════════════════════════════════════════════════
export async function portfolioBlock(userId: string): Promise<BuiltBlock | null> {
  const r = await resolvePortfolio(userId);
  if (!r.ok) return null;
  const d = r.data;

  const members: SetMember[] = d.lines.map((h) => ({
    key: h.symbol,
    symbol: h.symbol, // every holding is a stock the reader can open
    title: h.name,
    subtitle: h.symbol,
    // ⚠ `money`, NOT `cr`. `cr` rounds to whole crore and every retail position is under 0.05 Cr,
    //   so this rendered "₹0 Cr" on EVERY row of a real book. See the formatter's own note.
    figure: money(h.valueCr),
    figureLabel: "Value",
    // ⚠ THREE DIFFERENT SENTENCES, AND ONLY ONE OF THEM IS "not scored". A share we hold and do not
    //   score is a gap in OUR coverage. A bond or a fund is not on that ladder at all — the score
    //   reads quarterly results and neither files any — so labelling it "we do not score this
    //   holding" reports a fact about the instrument as a shortfall of ours. Eight of this reader's
    //   twenty-one positions are the second kind.
    tag: h.band ?? (h.nonEquity ? "not a share — outside the health read" : blockCopy("portfolio_unscored")),
    sortValue: h.valueCr,
  }));

  return {
    section: heroSetSection({
      heading: "Your book",
      members,
      totals: [
        { label: "Positions", value: String(d.holdings) },
        { label: "Of those, scored", value: String(d.holdingsScored) },
        { label: "Health score", value: score(d.score) },
        { label: "Band", value: d.band },
        // ★ THE WEIGHT SHARE, NOT THE COUNT SHARE, IS THE HONEST BOUND ON THE SCORE. 11 of 21 by
        //   count and 91% by value are very different claims, and the score is computed on value.
        { label: "Share of book the score covers", value: d.scoredWeight === null ? null : `${(d.scoredWeight * 100).toFixed(0)}%` },
        // Same defect one line up from the rows: a ₹36 lakh book totalled to "₹0 Cr".
        { label: "Book value", value: d.totalValue === null ? null : money(d.totalValue / 1e7) },
      ],
      totalAvailable: d.holdings,
      emptyPhrase: blockCopy("portfolio_empty"),
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}

// ═══ 9 · WATCHLIST ═════════════════════════════════════════════════════════════════════════════════
export async function watchlistBlock(userId: string): Promise<BuiltBlock | null> {
  const r = await resolveWatchlist(userId);
  if (!r.ok) return null;
  const d = r.data;
  const members: SetMember[] = d.lines.map((w) => ({
    key: w.symbol,
    symbol: w.symbol,
    title: w.name || w.symbol,
    subtitle: w.symbol,
    figure: score(w.score),
    figureLabel: "Health score",
    tag: w.favorite ? `${w.band ?? "unscored"} · starred` : w.band,
    sortValue: w.score,
  }));
  return {
    section: heroSetSection({
      heading: "What you are watching",
      members,
      totals: [{ label: "Pinned", value: String(d.total) }],
      totalAvailable: d.total,
      emptyPhrase: blockCopy("watchlist_empty"),
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}

// ═══ 10 · RELATIONSHIP ═════════════════════════════════════════════════════════════════════════════
export async function relationshipBlock(userId: string, symbol: string): Promise<BuiltBlock | null> {
  const r = await resolveRelationship(userId, symbol);
  if (!r.ok) return null;
  const d = r.data;
  return {
    section: heroDualSection({
      heading: "Where you stand to it",
      left: {
        title: d.name,
        subtitle: d.symbol,
        stats: [
          { label: "You hold it", value: d.held ? "yes" : "no", absentPhrase: blockCopy("relationship_not_held") },
          { label: "On your watchlist", value: d.watchlisted ? (d.favorite ? "yes, starred" : "yes") : "no", absentPhrase: "not pinned" },
        ],
      },
      right: {
        title: "Your position",
        subtitle: null,
        stats: [
          { label: "Quantity", value: d.quantity === null ? null : d.quantity.toLocaleString("en-IN"), absentPhrase: blockCopy("relationship_not_held") },
          { label: "Value", value: money(d.valueCr), absentPhrase: blockCopy("relationship_not_held") },
          { label: "Share of your book", value: pct(d.weightPct), absentPhrase: blockCopy("relationship_no_book") },
          { label: "Your exposure to its sector", value: pct(d.sectorExposurePct), absentPhrase: blockCopy("relationship_no_book") },
        ],
      },
      basis: `your ${d.bookHoldings} open position${d.bookHoldings === 1 ? "" : "s"} at cost`,
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}

// ═══ 11 · INSTRUMENT ═══════════════════════════════════════════════════════════════════════════════
export async function instrumentBlock(identifier: string): Promise<BuiltBlock | null> {
  const r = await resolveInstrumentDetail(identifier);
  if (!r.ok) return null;
  const d = r.data;
  return {
    section: heroDualSection({
      heading: "What this instrument is",
      left: {
        title: d.name,
        subtitle: d.assetClass.replace(/_/g, " "),
        stats: [
          { label: "ISIN", value: d.isin, absentPhrase: "no ISIN on file" },
          { label: "Scheme code", value: d.schemeCode, absentPhrase: "not an AMFI scheme" },
        ],
      },
      right: {
        title: "Latest value",
        subtitle: null,
        stats: [
          { label: "NAV", value: d.nav === null ? null : plain(d.nav, 4), absentPhrase: blockCopy("instrument_no_nav") },
          { label: "As of", value: d.navDate, absentPhrase: blockCopy("instrument_no_nav") },
          // ⚠ THE STALENESS FLAG IS A LINE, NOT A FOOTNOTE. 44.8% of schemes carry a stale NAV
          //   (matured funds still listed) — the schema says never render one without this.
          { label: "Freshness", value: d.navDate ? (d.navStale ? "stale — this scheme may be matured or closed" : "current") : null, absentPhrase: blockCopy("instrument_no_nav") },
          ...d.attributes.map((a) => ({ label: a.label, value: a.value, absentPhrase: blockCopy("instrument_no_analytics") })),
        ],
      },
      basis: "the instrument catalogue — this is not a share we score",
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}

// ═══ 12 · FUND ANALYTICS ═══════════════════════════════════════════════════════════════════════════
export async function fundBlock(schemeCode: string): Promise<BuiltBlock | null> {
  const r = await resolveFund(schemeCode);
  if (!r.ok) return null;
  const d = r.data;
  return {
    section: steppedFilingSection({
      heading: "How this scheme has performed",
      columns: ["Measure", "Value"],
      rows: [
        { period: "Trailing returns", cells: d.returns.map((x) => ({ label: x.label, value: pct(x.value), absentPhrase: blockCopy("fund_window_short") })) },
        { period: "Risk", cells: d.risk.map((x) => ({ label: x.label, value: x.label === "Max drawdown" ? pct(x.value) : plain(x.value), absentPhrase: blockCopy("instrument_no_analytics") })) },
      ],
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}

// ═══ 13 · COMPARISON ═══════════════════════════════════════════════════════════════════════════════
export async function comparisonBlock(a: string, b: string): Promise<BuiltBlock | null> {
  const r = await resolveComparison(a, b);
  if (!r.ok) return null;
  const d = r.data;

  // ★ THE VERDICT SUPPRESSES THE BARS. Two companies in different peer groups render as an absent
  //   comparison with the reason, not as two bars with a caption. The figures are real and the
  //   COMPARISON is not, and a chart is a claim that they line up.
  //
  // ── ★ WHAT STAGE 9 ADDED, AND WHY TWO BARS WAS NOT A COMPARISON ─────────────────────────────────
  // This built exactly two marks: one composite per company. That answers "which scores higher" and
  // nothing else — and "which is higher" is the one thing a reader can already see from two numbers
  // in a sentence. The question a comparison is actually asked is WHERE they differ, and every
  // figure needed to answer it was already computed by `buildComparisonView` and thrown away.
  //
  // ⚠ THE AXIS IS SHARED, WHICH IS WHY THE PILLARS CAN JOIN THE COMPOSITE AND THE PERCENTAGES CANNOT.
  //   Composite and pillars are all 0–100 readings of the same kind, so one chart holds them
  //   honestly. A margin and a score on one axis would be two units sharing a scale, which is the
  //   dual-axis lie in a different costume — so the percentage metrics get their own section.
  const shortA = d.left.symbol;
  const shortB = d.right.symbol;
  const scoreMarks: RelativeMark[] = [];
  if (d.comparable) {
    // ★ `series` IS WHAT MAKES THIS A COMPARISON RATHER THAN TEN BARS. See RelativeMark.series —
    //   left is slot 0 throughout, right is slot 1 throughout, so one colour means one company down
    //   the whole chart rather than "this row is the one you asked about".
    scoreMarks.push(
      { label: `${shortA} · overall`, value: d.left.score, display: `${score(d.left.score) ?? "not scored"}${d.left.band ? ` · ${d.left.band}` : ""}`, role: "subject", series: 0 },
      { label: `${shortB} · overall`, value: d.right.score, display: `${score(d.right.score) ?? "not scored"}${d.right.band ? ` · ${d.right.band}` : ""}`, role: "subject", series: 1 },
    );
    const PILLARS = ["foundation", "momentum", "market", "ownership"] as const;
    for (const k of PILLARS) {
      const va = d.left.pillars[k];
      const vb = d.right.pillars[k];
      // ⚠ A PILLAR NEITHER SIDE IS SCORED ON IS OMITTED, NOT DRAWN AT ZERO. §3.1.
      if (va === null && vb === null) continue;
      const nice = k.charAt(0).toUpperCase() + k.slice(1);
      scoreMarks.push(
        { label: `${shortA} · ${nice}`, value: va, display: score(va) ?? "not scored", role: "member", series: 0 },
        { label: `${shortB} · ${nice}`, value: vb, display: score(vb) ?? "not scored", role: "member", series: 1 },
      );
    }
  }

  return {
    section: relativeSection({
      renderer: "opposed-bars",
      heading: "Side by side",
      unit: "score",
      marks: scoreMarks,
      referenceLabel: d.peerGroup ?? "different peer groups",
      referenceCount: null,
      unavailablePhrase: d.comparable ? null : blockCopy("compare_not_comparable"),
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}

/**
 * The paired PERCENTAGE metrics — its own section because its own axis (see the note above).
 *
 * Returns `null` when the view gave us nothing to pair, so the answer degrades to the score chart it
 * had before rather than rendering an empty frame.
 */
export async function comparisonMetricsBlock(a: string, b: string): Promise<BuiltBlock | null> {
  const r = await resolveComparison(a, b);
  if (!r.ok) return null;
  const d = r.data;
  const pct = d.metrics.filter((m) => m.unit === "pct" && (typeof m.a === "number" || typeof m.b === "number"));
  if (pct.length === 0) return null;

  const marks: RelativeMark[] = [];
  for (const m of pct.slice(0, 6)) {
    const va = typeof m.a === "number" ? m.a : null;
    const vb = typeof m.b === "number" ? m.b : null;
    // ⚠ THE ROLES HERE WERE `subject` AND `member` FOR THE TWO SIDES OF ONE PAIR, which is not what
    //   those words mean — both companies are the subject of a comparison. The colour now comes from
    //   `series` and the roles say the true thing.
    marks.push(
      { label: `${d.left.symbol} · ${m.label}`, value: va, display: va === null ? blockCopy("compare_missing_side") : `${va.toFixed(1)}%`, role: "subject", series: 0 },
      { label: `${d.right.symbol} · ${m.label}`, value: vb, display: vb === null ? blockCopy("compare_missing_side") : `${vb.toFixed(1)}%`, role: "subject", series: 1 },
    );
  }
  return {
    section: relativeSection({
      renderer: "opposed-bars",
      heading: "The same measures, both companies",
      unit: "pct",
      marks,
      // ⚠ THE FAMILY IS THE REFERENCE HERE, NOT THE PEER GROUP. A bank and a manufacturer do not
      //   share a margin definition, and `buildComparisonView` is what knows that — this states which
      //   families are being lined up so the reader can judge the pairing themselves.
      referenceLabel: d.familyLabel.a === d.familyLabel.b
        ? `${d.familyLabel.a || "the same"} reporting shape, so these lines mean the same thing on both sides`
        : `${d.familyLabel.a || "one shape"} against ${d.familyLabel.b || "another"} — read each against its own family`,
      referenceCount: null,
      unavailablePhrase: null,
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}

// ═══ 14 · UNIVERSE SCAN ════════════════════════════════════════════════════════════════════════════
export async function universeBlock(): Promise<BuiltBlock | null> {
  const r = await resolveUniverse();
  if (!r.ok) return null;
  const d = r.data;
  return {
    section: relativeSection({
      renderer: "distribution-strip",
      heading: "The market as we score it",
      unit: "count",
      marks: [
        { label: "Median health score", value: d.median, display: score(d.median) ?? "", role: "reference" },
        { label: "Move on the prior period", value: d.medianDrift, display: d.medianDrift === null ? "" : `${d.medianDrift > 0 ? "+" : ""}${d.medianDrift.toFixed(2)} points`, role: "reference" },
      ],
      bands: d.bands,
      referenceLabel: "every stock we score, each at its own latest reported quarter",
      referenceCount: d.scoredCount,
      windowLabel: d.periodKey,
      unavailablePhrase: blockCopy("universe_empty"),
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}

// ═══ 15 · SCREEN ═══════════════════════════════════════════════════════════════════════════════════
export async function screenBlock(
  conditions: readonly ScreenCondition[],
  /**
   * ★ A RANKING IS NOT A FILTER, AND THE TOTALS MUST NOT SAY IT IS — added Phase 1 · Batch 2.
   *
   * ⚠ THE FRAME-DECLINED ANSWER RUNS THIS WITH ZERO CONDITIONS, and the table then reported
   *   **"Matched 95 · Out of 95"**. Every word of that is arithmetically true and the whole line is
   *   misleading: nothing was matched, because nothing was filtered. A reader who has just been told
   *   their criterion was dropped, and then sees a total headed "Matched", reasonably concludes some
   *   other filter ran in its place.
   *
   * ★ THE PROSE ALREADY SAID IT ("nothing has been filtered out") AND THAT WAS NOT ENOUGH. §4.3's
   *   whole amendment is that prose and component must agree; a component contradicting the sentence
   *   above it is worse than one that says nothing, because the figure looks like the harder evidence.
   */
  mode: "filter" | "ranking" = "filter",
): Promise<BuiltBlock | null> {
  const r = await resolveScreen(conditions);
  if (!r.ok) return null;
  const d = r.data;

  // ★ T-1b · REBUILT ON `set-table` (§4.1 amendment). It was `hero-set`, which carries ONE figure per
  //   row — so a screen on return-on-equity showed a HEALTH score beside each match and put the metric
  //   the reader actually filtered on into a subtitle string. The columns are the answer here.
  //
  //   The condition columns come FIRST and health follows: a reader who asked for ROE above 20 wants
  //   to see ROE. `d.conditions` is the applied set in the order the reader stated them.
  const conditionCols: SetTableColumn[] = d.conditions.map((c, i) => ({
    key: `c${i}`, label: c.label, align: "number", primary: i === 0,
  }));
  const columns: SetTableColumn[] = [
    ...conditionCols,
    { key: "health", label: "Health score", align: "number", primary: conditionCols.length === 0 },
  ];

  const rows: SetTableRow[] = d.matches.map((m) => {
    const cells: Record<string, SetTableCell> = {};
    d.conditions.forEach((c, i) => {
      // The matched row's own value for that condition's field, by label — `values` is built from the
      // same applied-condition list, so the labels line up by construction.
      const v = m.values.find((x) => x.label === c.label);
      cells[`c${i}`] = {
        display: v?.display ?? "not held",
        // ⚠ null, NEVER 0, for a figure we do not hold — see SetTableCell. A screen that ranked
        //   "unknown" above a real low value would be lying in the one column the reader sorted by.
        sort: v && v.display !== "not held" ? Number(String(v.display).replace(/[^0-9.-]/g, "")) || null : null,
      };
    });
    cells.health = { display: score(m.score) ?? "not scored", sort: m.score };
    return { key: m.symbol, title: m.name || m.symbol, symbol: m.symbol, tag: m.band, cells };
  });

  return {
    section: setTableSection({
      heading: mode === "ranking" ? "The whole set, ranked" : "What matched",
      columns,
      rows,
      totalAvailable: d.matched,
      totals: mode === "ranking"
        ? [
            // ⚠ NO "Matched" ANYWHERE ON A RANKING. See the `mode` note above.
            { label: "Ranked", value: `${d.matched} companies, highest health score first` },
            { label: "Shown", value: `the top ${rows.length}` },
            { label: "Filtered out", value: "nothing — no condition was applied" },
          ]
        : [
            { label: "Matched", value: String(d.matched) },
            // ⚠ THE DENOMINATOR IS PART OF THE ANSWER. "12 matched" over 94 evaluable and over 2,290
            // are different findings, and only the first pair is a screen result.
            { label: "Out of", value: `${d.considered} with a comparable figure` },
            ...d.conditions.map((c) => ({ label: c.label, value: `${c.bound} · ${c.evaluable} evaluable` })),
          ],
      // ★ THE HONEST EMPTY, PRESERVED FROM T-1. A screen matching zero is a RESULT — the filter ran
      //   and the universe holds no such company — and must read as deliberate, not as a failure.
      emptyPhrase: blockCopy("screen_no_match"),
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}


// ═══ 15b · THE BOOK OVER TIME (T-1b, finding 6) ════════════════════════════════════════════════════
//
// ★ TWO BLOCKS, ONE NEW RENDERER. Value is money and needed `value-line` (§4.1 amendment); health is
//   a 0–100 score over time, which IS `composite-spine` — reused unchanged rather than given a
//   `portfolio-health-spine` variant.
//
// ⚠ BOTH RETURN null ON ABSENT, AND THAT IS THE PATH THAT MATTERS. A brand-new account has no value
//   history and no score rows. A chart drawn over nothing is where a reused component most easily
//   lies — the Operator's own note — so the block declines and the answer simply does not carry it,
//   rather than rendering an axis over an empty set.

export async function portfolioValueBlock(userId: string): Promise<BuiltBlock | null> {
  const r = await resolvePortfolioValueSeries(userId);
  if (!r.ok) return null;
  const d = r.data;
  const firstV = d.points[0]?.value ?? null;
  const lastV = d.points[d.points.length - 1]?.value ?? null;
  return {
    section: valueLineSection({
      heading: "What your book has been worth",
      label: "Book value",
      unit: "inr",
      points: d.points,
      windowLabel: d.firstDate && d.lastDate ? `${d.firstDate} to ${d.lastDate}` : null,
      facts: [
        { label: "Latest", value: lastV === null ? null : money(lastV), absentPhrase: "no valuation held" },
        { label: "First point", value: firstV === null ? null : money(firstV), absentPhrase: "no valuation held" },
        // ⚠ NOT A RETURN. This is the change in what the book is WORTH, which includes money the
        //   reader paid in — calling it a return would be the commonest lie a value chart tells.
        //   TWR is a separate, cash-flow-neutral computation and is not what this line draws.
        { label: "Change in value across the window", value: firstV && lastV ? money(lastV - firstV) : null,
          absentPhrase: "too few points to compare" },
        { label: "Priced through", value: d.symbolsNoPrice.length === 0 ? "every holding" : `all but ${d.symbolsNoPrice.length}`,
          absentPhrase: "not known" },
        { label: "Window", value: d.blended ? "capped at 4 years — the book holds funds" : "from the first buy",
          absentPhrase: "not known" },
      ],
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}

export async function portfolioHealthBlock(userId: string): Promise<BuiltBlock | null> {
  const r = await resolvePortfolioHealthSeries(userId);
  if (!r.ok) return null;
  const d = r.data;
  return {
    section: spineSection({
      heading: "Your book's health over time",
      label: "Portfolio health",
      // ⚠ `pct` BECAUSE THE SPINE FIXES A 0–100 AXIS, WHICH IS RIGHT FOR A SCORE AND WRONG FOR MONEY.
      //   That difference is exactly why value needed its own renderer — see §4.1's amendment.
      unit: "pct",
      points: d.points,
      windowLabel: d.points.length ? `${d.points[0]!.at} to ${d.points[d.points.length - 1]!.at}` : null,
      facts: [
        { label: "Latest", value: d.latest === null ? null : score(d.latest), absentPhrase: "not scored yet" },
        { label: "Days recorded", value: String(d.points.length), absentPhrase: "none" },
        { label: "Change since the first reading",
          value: d.latest !== null && d.first !== null ? (d.latest - d.first).toFixed(1) : null,
          absentPhrase: "only one reading held" },
      ],
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}

// ═══ 16 · WHAT WE REMEMBER (the READ half of the memory capability) ════════════════════════════════
/**
 * ★ THIS IS A READ, AND FILING IT WITH THE WRITES IS WHAT HID IT FOR A STAGE. "What do you remember
 * about me?" is answerable from `ChatReaderProfile` with no mutation anywhere — the tools that
 * POPULATE it are writes, and that is a different capability.
 *
 * ⚠ STATED AND INFERRED ARE LABELLED SEPARATELY, and the schema's own comment says why: a reader can
 * tell an inference from something they actually typed, and conflating the two makes every guess look
 * like a quote. `statedName` and `statedMemories` are the reader's words; the register and the depth
 * nudge are ours about them.
 */
export async function memoryBlock(profile: ReaderProfile, coverage: Coverage): Promise<BuiltBlock | null> {
  const members: SetMember[] = [];
  if (profile.statedName) {
    members.push({ key: "name", title: `You asked to be called ${profile.statedName}`, subtitle: null,
      // null throughout this block — a remembered fact is not a company and has nowhere to link to.
      symbol: null, figure: "stated", figureLabel: "Source", tag: null, sortValue: null });
  }
  for (const [i, m] of profile.statedMemories.entries()) {
    members.push({ key: `m${i}`, title: m, subtitle: null, symbol: null, figure: "stated", figureLabel: "Source", tag: null, sortValue: null });
  }
  for (const g of profile.glossaryGaps) {
    members.push({ key: `g${g}`, title: `We gloss "${g.replace(/_/g, " ")}" for you`, subtitle: null,
      symbol: null, figure: "inferred", figureLabel: "Source", tag: null, sortValue: null });
  }
  members.push({ key: "tone", title: `We explain at "${profile.tone.level}" depth, jargon ${profile.tone.jargon}`,
    subtitle: null, symbol: null, figure: "from your settings", figureLabel: "Source", tag: null, sortValue: null });

  return {
    section: heroSetSection({
      heading: "What we remember about you",
      members,
      totals: [{ label: "Remembered", value: String(profile.statedMemories.length) }],
      totalAvailable: null,
      emptyPhrase: "You have not asked us to remember anything yet.",
    }, coverage) as AnySection,
    coverage,
  };
}


// ═══ 17 · ALERTS ═══════════════════════════════════════════════════════════════════════════════════
export async function alertsBlock(userId: string): Promise<BuiltBlock | null> {
  const r = await resolveAlerts(userId);
  if (!r.ok) return null;
  const d = r.data;
  const members: SetMember[] = d.alerts.map((a) => ({
    key: a.id,
    symbol: a.symbol,
    title: a.description,
    subtitle: a.symbol,
    // ⚠ THE FIGURE COLUMN IS THE STATE, NOT A NUMBER. An alert has no measurement — inventing one
    //   (a count, a days-since) would put a figure on a row that has none.
    figure: a.active ? "active" : "paused",
    figureLabel: "State",
    tag: null,
    sortValue: null,
  }));
  return {
    section: heroSetSection({
      heading: "Your alerts",
      members,
      totals: [{ label: "Set", value: String(d.total) }],
      totalAvailable: d.total,
      emptyPhrase: "You have not set any alerts yet.",
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}


// ═══ 18 · EVENT REMINDERS ══════════════════════════════════════════════════════════════════════════
/**
 * ★ THE DATE-TRIGGERED SIBLING OF ALERTS, AND IT RENDERS BESIDE THEM RATHER THAN INSTEAD OF THEM.
 *
 * See `resolveReminders` for why answering "what alerts do I have" from the alerts table alone was
 * a confident wrong "nothing". Two sections, not one merged list: a condition rule and a date rule
 * are different things, they are edited in different places, and flattening them into one grid would
 * make "State" mean two things in one column.
 */
export async function remindersBlock(userId: string): Promise<BuiltBlock | null> {
  const r = await resolveReminders(userId);
  if (!r.ok) return null;
  const d = r.data;
  const members: SetMember[] = d.reminders.map((x) => ({
    key: x.id,
    symbol: x.symbol,
    title: x.description,
    subtitle: x.symbol,
    // ⚠ THE FIGURE IS THE DATE WHERE WE HOLD ONE, AND THE STATE WHERE WE DO NOT. A reminder whose
    //   event is not on the calendar has no date to show, and showing today's would be a fabrication.
    figure: x.nextEventDate ?? (x.active ? "no date filed" : "paused"),
    figureLabel: x.nextEventDate ? "Event date" : "State",
    tag: null,
    sortValue: null,
  }));
  return {
    section: heroSetSection({
      heading: "Your event reminders",
      members,
      totals: [{ label: "Set", value: String(d.total) }],
      totalAvailable: d.total,
      emptyPhrase: "You have not set any event reminders yet.",
    }, r.coverage) as AnySection,
    coverage: r.coverage,
  };
}
