// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// THE ROUTE REGISTRY — where an answer can send the reader inside Vytal.
//
// ── ★ THE PROBLEM THIS CLOSES ─────────────────────────────────────────────────────────────────────
// Every answer this system composes ends in prose and stops. The reader is told what we found and
// left to go and find the page that holds the working — which they have to know exists, and then
// navigate to by hand. The product ships a stock page with eight tabs and forty-odd sections, a
// health hub, a comparison surface, peer groups, a portfolio, a watchlist, a results calendar and a
// screener, and an answer about a company never once pointed at any of them.
//
// ── ★ WHY THE MODEL NEVER EMITS A URL, AND THIS FILE EXISTS INSTEAD ───────────────────────────────
// A model asked for "a link to the health page" will write one. It will be plausible, it will be
// shaped like our routes, and some fraction of the time it will 404 — and a dead link inside an
// otherwise correct answer is the same class of failure as an invented figure: the reader cannot
// tell the good ones from the bad ones without clicking. So the model is never asked. Code picks
// from the closed table below, using the SAME slots that chose the sections, and substitutes the
// RESOLVED symbol — never a ticker from the question text.
//
// This is the §5.4 rule for endpoints, applied to navigation: the destination is ours, the reader's
// tap is the only thing that goes there, and a misclassification's worst case is a link nobody
// follows.
//
// ── ★ TABS AND SECTIONS, NOT JUST PAGES ──────────────────────────────────────────────────────────
// The stock page reads `?tab=` and `?section=` off the URL (its own command palette is built from
// the same map), so a link can land on "Financial Stability" inside the Health tab rather than at
// the top of the page. That is the difference between a reference and a signpost: an answer about a
// pillar should arrive at that pillar.
//
// ⚠ EVERY PATH HERE IS MIRRORED FROM THE FRONTEND'S OWN app/ TREE, AND NOTHING AT RUNTIME CAN CHECK
//   THAT — it is a different repository. `verify-routes.ts` in the harness walks the frontend's route
//   tree and fails when one of these no longer resolves. That check is the only thing standing
//   between this table and the invented-URL failure it exists to prevent.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import type { LensSlot, OperationSlot } from "../router/contract.js";

/** One destination, as it reaches the reader. `href` is app-relative and always starts with "/". */
export interface ProseLink {
  /** What the link says. A place in the product, in the product's own words. */
  readonly label: string;
  readonly href: string;
  /** Why THIS answer is pointing there — one clause, so the link is a reason and not a button. */
  readonly why: string;
}

/** The stock page's tabs, mirrored from components/stock-detail/navigation-command-palette.tsx. */
export type StockTab =
  | "overview" | "health" | "fundamentals" | "valuation" | "technical" | "activity" | "events" | "news";

/**
 * ★ THE SECTION ANCHORS WORTH LINKING TO, per tab. Not every section in the product — the ones an
 *   answer has a reason to point at. An id the page does not know is ignored by it (the reader lands
 *   at the top of the tab), so a stale entry degrades rather than breaks.
 */
const STOCK_SECTIONS: Record<StockTab, readonly string[]> = {
  overview: ["company-identity", "health-score", "price-performance", "key-metrics", "peer-comparison", "strengths-concerns"],
  health: ["health-deep-dive", "profitability", "growth-momentum", "financial-stability", "efficiency", "valuation-health"],
  fundamentals: ["financial-performance", "balance-sheet", "cash-flow", "profitability-metrics"],
  valuation: ["valuation-snapshot", "valuation-story", "historical-context", "peer-valuation", "peg-analysis", "intrinsic-value"],
  technical: ["technical-snapshot", "price-chart", "trend-analysis", "momentum-indicators", "support-resistance", "volume-analysis"],
  activity: ["activity-overview"],
  events: ["calendar-view"],
  news: ["latest-news"],
};

/**
 * The stock page, at a tab and optionally a section.
 *
 * ⚠ THE SECTION IS DROPPED IF THE TAB DOES NOT OWN IT. A `?section=` the page cannot find scrolls
 *   nowhere and leaves the reader at the top of a tab wondering what they were sent to look at;
 *   silently narrowing to the tab is the honest degradation.
 */
export function stockHref(symbol: string, tab: StockTab = "overview", section?: string): string {
  const base = `/research/stock-screener/${encodeURIComponent(symbol.toUpperCase())}?tab=${tab}`;
  const owns = section !== undefined && STOCK_SECTIONS[tab].includes(section);
  return owns ? `${base}&section=${section}` : base;
}

/** The standalone surfaces. One entry per page the product actually ships. */
export const SURFACE = {
  dashboard:    { label: "Dashboard",          href: "/dashboard" },
  portfolio:    { label: "Portfolio",          href: "/portfolio" },
  watchlist:    { label: "Watchlist",          href: "/watchlist" },
  healthScore:  { label: "Health Score",       href: "/health-score" },
  methodology:  { label: "How we score",       href: "/health-score/methodology" },
  comparison:   { label: "Comparison",         href: "/comparison" },
  peerGroups:   { label: "Peer groups",        href: "/research/peer-groups" },
  screener:     { label: "Stock screener",     href: "/research/stock-screener" },
  ownership:    { label: "Ownership research", href: "/research/ownership" },
  divergence:   { label: "Divergence",         href: "/research/divergence" },
  trajectory:   { label: "Trajectory",         href: "/research/trajectory" },
  funds:        { label: "Funds",              href: "/research/funds" },
  results:      { label: "Results season",     href: "/results" },
  calendar:     { label: "Calendar",           href: "/calendar" },
  settings:     { label: "Settings",           href: "/settings" },
} as const;

export type SurfaceKey = keyof typeof SURFACE;

/** A surface link with the reason this answer is pointing at it. */
export const surfaceLink = (key: SurfaceKey, why: string): ProseLink => ({ ...SURFACE[key], why });

const TAB_LABEL: Record<StockTab, string> = {
  overview: "Overview", health: "Health", fundamentals: "Fundamentals", valuation: "Valuation",
  technical: "Technical", activity: "Activity", events: "Events", news: "News",
};

/**
 * ★ WHICH TAB ANSWERS WHICH LENS. The lens is the facet the reader narrowed to and the stock page is
 *   organised by exactly that, so the mapping is a table rather than a heuristic.
 */
const TAB_FOR_LENS: Record<LensSlot, { tab: StockTab; section?: string }> = {
  health:       { tab: "health",       section: "health-deep-dive" },
  fundamentals: { tab: "fundamentals", section: "financial-performance" },
  valuation:    { tab: "valuation",    section: "valuation-snapshot" },
  price:        { tab: "technical",    section: "price-chart" },
  ownership:    { tab: "activity",     section: "activity-overview" },
  filings:      { tab: "activity",     section: "activity-overview" },
  events:       { tab: "events",       section: "calendar-view" },
};

const LENS_WHY: Record<LensSlot, string> = {
  health: "the score broken all the way down to the metrics under each pillar",
  fundamentals: "every filed line — the statements, the balance sheet and the cash flow",
  valuation: "the multiples, their own history, and the peer set beside them",
  price: "the interactive chart, with trend, momentum and volume under it",
  ownership: "the register in full, with every disclosed insider trade and block deal",
  filings: "everything filed, in the order it was filed",
  events: "the calendar, scheduled and on record",
};

/** Which pillar's evidence lives where, for an answer that broke a score into its parts. */
export const PILLAR_SECTION: Record<string, { tab: StockTab; section: string }> = {
  foundation: { tab: "health", section: "financial-stability" },
  momentum:   { tab: "health", section: "growth-momentum" },
  market:     { tab: "technical", section: "trend-analysis" },
  ownership:  { tab: "activity", section: "activity-overview" },
};

export interface LinkContext {
  /** The RESOLVED symbol, or null. Never a mention from the question text. */
  readonly symbol: string | null;
  readonly name: string | null;
  readonly lens: LensSlot | null;
  readonly operation: OperationSlot | "unresolved";
  readonly perspective: "market" | "reader";
  /** The section kinds this answer actually rendered — a link follows evidence that is on screen. */
  readonly kinds: readonly string[];
  /**
   * ★ THE RENDERERS TOO, AND THE KIND ALONE WAS NOT ENOUGH.
   *
   * ⚠ CAUGHT LIVE: an ownership answer about an UNSCORED company (MANIPALHOS, tier 1) offered
   *   "Health deep-dive — every input to the four pillars". There are no pillars: the link fired on
   *   `kinds.includes("DECOMPOSITION")`, and a shareholding register IS a DECOMPOSITION. So the rule
   *   "a link follows evidence that is actually on screen" was being satisfied by the wrong evidence
   *   — and a signpost to a page with nothing on it is the dead-link failure this table exists to
   *   prevent, arriving through a live route rather than an invented one.
   */
  readonly renderers?: readonly string[];
  /** True when a second company was resolved, i.e. the answer is a comparison. */
  readonly comparison?: boolean;
  /** A reader-scoped answer's shape, where one was chosen — see families/reader.ts. */
  readonly readerShape?: "portfolio" | "watchlist" | "relationship" | "memory" | "alerts" | null;
  /**
   * ★ WHICH STATEMENT AN F ANSWER READ — Phase 1 · Batch 1.
   *
   * ⚠ WITHOUT IT EVERY FUNDAMENTALS ANSWER LANDED ON `financial-performance`, WHICH IS THE P&L. A
   *   reader who asked about the balance sheet and is sent to the P&L tab has been given a reference
   *   rather than a signpost — this file's own header draws exactly that distinction ("an answer about
   *   a pillar should arrive at that pillar"), and the Fundamentals tab already ships `balance-sheet`,
   *   `cash-flow` and `profitability-metrics` anchors for the other three.
   */
  readonly statementFocus?: "pnl" | "balance_sheet" | "cash_flow" | "returns" | null;
}

/** Which Fundamentals-tab anchor answers which statement. A table, not a heuristic — same as TAB_FOR_LENS. */
const SECTION_FOR_STATEMENT: Record<"pnl" | "balance_sheet" | "cash_flow" | "returns", { section: string; why: string }> = {
  pnl: { section: "financial-performance", why: "every filed quarter and year of the profit and loss, not only the columns above" },
  balance_sheet: { section: "balance-sheet", why: "the balance sheet in full, with the sub-lines this answer summarised" },
  cash_flow: { section: "cash-flow", why: "the cash-flow statement in full, against the profit it is measured beside" },
  returns: { section: "profitability-metrics", why: "the return and efficiency ratios with their own history under each one" },
};

/**
 * ★ THE LINKS FOR ONE ANSWER — at most three, chosen by the same slots that chose the sections.
 *
 * ⚠ THREE IS A CEILING, NOT A TARGET, AND THAT IS THE WHOLE DESIGN. A list of every place the reader
 *   could go is a sitemap, and a sitemap under an answer is noise that teaches them to skip the
 *   region entirely. The first link is where THIS answer continues; the rest are the nearest
 *   surfaces holding more of the same evidence.
 *
 * ⚠ AND A LINK FOLLOWS EVIDENCE THAT IS ACTUALLY ON SCREEN — `kinds` is read for exactly that
 *   reason. Pointing at "the peer comparison in full" under an answer that drew no comparison
 *   promises a continuation of something that never started.
 */
export function linksFor(ctx: LinkContext): ProseLink[] {
  const out: ProseLink[] = [];
  const seen = new Set<string>();
  const push = (l: ProseLink | null) => {
    if (!l || seen.has(l.href) || out.length >= 3) return;
    seen.add(l.href);
    out.push(l);
  };
  const who = ctx.name ?? ctx.symbol ?? "this company";

  // ── THE READER'S OWN SURFACES ────────────────────────────────────────────────────────────────
  if (ctx.perspective === "reader") {
    const shape = ctx.readerShape ?? null;
    if (shape === "watchlist") push(surfaceLink("watchlist", "the same pins with their full read — score, band, findings and the pin-time baseline"));
    else if (shape === "alerts") push(surfaceLink("settings", "where alerts and reminders are edited, paused and deleted"));
    else if (shape === "memory") push(surfaceLink("settings", "everything we remember about you, and the switch to drop any of it"));
    else if (shape === "relationship" && ctx.symbol) {
      push({ label: `${who} · Overview`, href: stockHref(ctx.symbol, "overview"), why: "the company itself, separately from your position in it" });
      push(surfaceLink("portfolio", "the position, its cost basis, and the ledger behind it"));
    } else push(surfaceLink("portfolio", "your positions, weights and the ledger behind every one of them"));
    push(surfaceLink("portfolio", "the whole book — allocation, returns and the health of what you hold"));
    push(surfaceLink("healthScore", "the same scoring across the whole universe, rather than your book"));
    return out;
  }

  // ── A COMPARISON GOES TO THE COMPARISON SURFACE ──────────────────────────────────────────────
  if (ctx.comparison || ctx.operation === "compare") {
    push(surfaceLink("comparison", "the full side-by-side, on every measure rather than the few above"));
    if (ctx.symbol) {
      push({
        label: `${who} · Peers`,
        href: stockHref(ctx.symbol, "overview", "peer-comparison"),
        why: "where it sits inside its own peer group",
      });
    }
    push(surfaceLink("peerGroups", "how the group itself is built, and who else is in it"));
    return out;
  }

  // ── NO SUBJECT: A SCREEN, OR A MARKET-WIDE QUESTION ──────────────────────────────────────────
  if (!ctx.symbol) {
    if (ctx.operation === "screen") push(surfaceLink("screener", "the same filter with every condition we hold, and the matches as a table"));
    push(surfaceLink("healthScore", "the whole scored universe, ranked and filterable"));
    push(surfaceLink("results", "what is reporting this season, and what has already landed"));
    return out;
  }

  // ── A COMPANY: THE TAB THAT ANSWERS THE LENS COMES FIRST ─────────────────────────────────────
  //
  // ★ AND, FOR A FUNDAMENTALS ANSWER, THE ANCHOR THAT ANSWERS THE STATEMENT. See `statementFocus`.
  const t = ctx.lens ? TAB_FOR_LENS[ctx.lens] : null;
  if (t && ctx.lens === "fundamentals" && ctx.statementFocus) {
    const sf = SECTION_FOR_STATEMENT[ctx.statementFocus];
    push({ label: `${who} · Fundamentals`, href: stockHref(ctx.symbol, "fundamentals", sf.section), why: sf.why });
  } else if (t) {
    push({ label: `${who} · ${TAB_LABEL[t.tab]}`, href: stockHref(ctx.symbol, t.tab, t.section), why: LENS_WHY[ctx.lens!] });
  } else {
    push({
      label: `${who} · Overview`,
      href: stockHref(ctx.symbol, "overview"),
      why: "the whole company page — every tab, and every figure behind the ones above",
    });
  }

  // ── THEN WHAT THE ANSWER ACTUALLY DREW ───────────────────────────────────────────────────────
  // ★ ONLY A SCORE DECOMPOSITION EARNS THE HEALTH LINK. `waterfall` is the four pillars and
  //   `pillar-bars` is one of them opened up; `ownership-split` is a register and says nothing about
  //   a score. Falling back to the KIND when no renderer list was passed keeps every existing caller
  //   working — the narrowing applies where the information is available.
  const SCORE_DECOMPOSITIONS = ["waterfall", "pillar-bars", "dupont-tree", "bridge"];
  const scoreShown = ctx.renderers
    ? ctx.renderers.some((r) => SCORE_DECOMPOSITIONS.includes(r))
    : ctx.kinds.includes("DECOMPOSITION");
  if (scoreShown) {
    push({
      label: `${who} · Health deep-dive`,
      href: stockHref(ctx.symbol, "health", "health-deep-dive"),
      why: "every input to the four pillars, one metric at a time",
    });
  }
  if (ctx.kinds.includes("RELATIVE")) {
    push({
      label: `${who} · Peers`,
      href: stockHref(ctx.symbol, "overview", "peer-comparison"),
      why: "the comparison above against the whole group, rather than a single marker",
    });
  }
  if (ctx.kinds.includes("RAIL")) {
    push({
      label: `${who} · Events & filings`,
      href: stockHref(ctx.symbol, "events", "calendar-view"),
      why: "the full calendar, and everything filed around it",
    });
  }
  if (ctx.operation === "history") {
    push({
      label: `${who} · Fundamentals`,
      href: stockHref(ctx.symbol, "fundamentals", "financial-performance"),
      why: "every filed period we hold, not only the window above",
    });
  }

  // ★ AN OWNERSHIP ANSWER REACHES THE OWNERSHIP TOOL, which is where the register, the pledging
  //   history and every disclosed trade live in full. Added at Phase 1 · Batch 1: the surface has
  //   shipped since before this table existed and no answer had ever pointed at it.
  if (ctx.lens === "ownership") {
    push(surfaceLink("ownership", "the register across every filing we hold, with each disclosed trade beside it"));
  }

  // ── AND ONE PRODUCT SURFACE, SO THE READER LEARNS WHERE THINGS LIVE ──────────────────────────
  push(surfaceLink("methodology", "what the score is actually computed from, if the reading matters to you"));
  return out;
}
