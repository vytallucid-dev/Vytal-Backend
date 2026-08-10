// File: src/scoring/read/result-detail.service.ts
//
// THE per-result viewer assembler — GET /api/v1/results/:symbol[?period=FY26Q4].
// ONE stock + ONE quarter, plus the spine for context and four independently
// honest-empty context blocks. Follows the /overview pattern: bundle every source
// server-side so the viewer makes one call and honest-empty lives in one place.
//
// UNITS mirror results-list: money ₹ Cr pass-through; growth + headline margins are
// already percent (the fundamentals view's passPct fields), so they pass through
// unscaled. We never read the fraction-stored ratios here. NO verdicts, NO fabricated
// expense line-items / commentary — absent data is stated by the empty/`null` shape.

// ── C26 · TOP-LINE LABELS COME FROM THE GLOSS CATALOGUE ────────────────────────────────────────
// `metricGloss(TOP_LINE_KEY[family]).label` is now the ONE source of the reader-facing name for a
// family's top line, on every surface. Two surfaces disagreeing about what to call one number is
// exactly the class src/catalogue exists to fix — and the plainer words win, because this card is
// written for someone who has never read a statement: "Premiums kept" says what "Net premium"
// only names. Banking and the two non-financial families are unchanged; life and general
// insurance move.
import { metricGloss } from "../../catalogue/quarter-metrics.js";
import { prisma } from "../../db/prisma.js";
import { toNum, round } from "./fundamentals-normalize.js";
import { buildHealthSnapshotView } from "./health-view.service.js";
import { buildFundamentalsView } from "./fundamentals-view.service.js";
import { readVerdict } from "../../insight/quarter-brief/verdict.js";
import { buildPersonalSection } from "../../insight/quarter-brief/personal.js";
import type { BriefPayload } from "../../insight/quarter-brief/schema.js";
import {
  buildGuardForStock,
  screenStoredNews,
  MAX_WINDOW_ROWS,
} from "../../ingestions/news_and_announcements/relevance.js";
import type {
  ResultDetailData,
  ViewerQuarter,
  MarketReaction,
  ViewerNews,
  ViewerAi,
  ViewerCorpEvent,
  ViewerPeer,
  PeriodRef,
  ResultHealthBlock,
  AnnualResultBlock,
  AnnualResultState,
  AnnualLine,
} from "./result-detail.types.js";

const DAY_MS = 86_400_000;
const MIN_REACTION_POINTS = 3; // fewer than this → honest-empty (never a 2-point line)
const SPINE_MAX = 12;

/** ── THE REACTION WINDOW, DEFINED ONCE ──────────────────────────────────────────
 *  Calendar days either side of the filing. The chart's "N of ~M trading days"
 *  denominator is DERIVED from REACTION_WINDOW_DAYS below and served — it used to be
 *  the literal "~12" typed into the frontend JSX twice, which was not the length of
 *  this window (20 calendar days is ~14 weekdays, not 12) and could not follow it. */
const REACTION_LEAD_DAYS = 5;
const REACTION_WINDOW_DAYS = 20;

const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const money = (x: unknown): number | null => round(toNum(x));
const pctPass = (x: unknown): number | null => round(toNum(x));

type Family = "non_financial" | "banking" | "nbfc" | "life_insurance" | "general_insurance";
const FINANCIAL_STANDALONE = new Set<Family>(["banking", "life_insurance", "general_insurance"]);
const preferredBasis = (family: Family): string =>
  FINANCIAL_STANDALONE.has(family) ? "standalone" : "consolidated";
const otherBasis = (b: string): string => (b === "standalone" ? "consolidated" : "standalone");

const stockSelect = { select: { symbol: true, name: true } } as const;

// ── Per-family full-spine fetchers (chosen basis, oldest→newest) ────────────────

async function spineNonFinancial(stockId: string, basis: string): Promise<ViewerQuarter[]> {
  const rows = await prisma.quarterlyResult.findMany({
    where: { stockId, resultType: basis },
    orderBy: { reportDate: "asc" },
    select: {
      quarter: true, fiscalYear: true, reportDate: true, filingDate: true, xbrlUrl: true, resultType: true,
      revenue: true, revenueYoy: true, revenueQoq: true,
      operatingProfit: true, profitBeforeTax: true, tax: true,
      netProfit: true, profitYoy: true, profitQoq: true,
      operatingMargin: true, netMargin: true,
    },
  });
  return rows.map((q) => ({
    periodKey: `${q.fiscalYear}${q.quarter}`, quarter: q.quarter, fiscalYear: q.fiscalYear,
    reportDate: ymd(q.reportDate), filingDate: ymd(q.filingDate), resultType: q.resultType, xbrlUrl: q.xbrlUrl,
    revenue: money(q.revenue), revenueLabel: metricGloss("revenue").label, revenueYoy: pctPass(q.revenueYoy), revenueQoq: pctPass(q.revenueQoq),
    operatingProfit: money(q.operatingProfit), profitBeforeTax: money(q.profitBeforeTax), tax: money(q.tax),
    netProfit: money(q.netProfit), profitYoy: pctPass(q.profitYoy), profitQoq: pctPass(q.profitQoq),
    operatingMargin: pctPass(q.operatingMargin), netMargin: pctPass(q.netMargin),
    margin: pctPass(q.operatingMargin), marginLabel: "Op margin",
  }));
}

async function spineBanking(stockId: string, basis: string): Promise<ViewerQuarter[]> {
  const rows = await prisma.bankingQuarterlyResult.findMany({
    where: { stockId, resultType: basis },
    orderBy: { reportDate: "asc" },
    select: {
      quarter: true, fiscalYear: true, reportDate: true, filingDate: true, xbrlUrl: true, resultType: true,
      nii: true, niiYoy: true, niiQoq: true,
      profitBeforeTax: true, tax: true,
      netProfit: true, patYoy: true, patQoq: true, netMargin: true,
    },
  });
  return rows.map((q) => ({
    periodKey: `${q.fiscalYear}${q.quarter}`, quarter: q.quarter, fiscalYear: q.fiscalYear,
    reportDate: ymd(q.reportDate), filingDate: ymd(q.filingDate), resultType: q.resultType, xbrlUrl: q.xbrlUrl,
    revenue: money(q.nii), revenueLabel: metricGloss("netInterestIncome").label, revenueYoy: pctPass(q.niiYoy), revenueQoq: pctPass(q.niiQoq),
    operatingProfit: null, profitBeforeTax: money(q.profitBeforeTax), tax: money(q.tax),
    netProfit: money(q.netProfit), profitYoy: pctPass(q.patYoy), profitQoq: pctPass(q.patQoq),
    operatingMargin: null, netMargin: pctPass(q.netMargin),
    margin: pctPass(q.netMargin), marginLabel: "Net margin",
  }));
}

async function spineNbfc(stockId: string, basis: string): Promise<ViewerQuarter[]> {
  const rows = await prisma.nbfcQuarterlyResult.findMany({
    where: { stockId, resultType: basis },
    orderBy: { reportDate: "asc" },
    select: {
      quarter: true, fiscalYear: true, reportDate: true, filingDate: true, xbrlUrl: true, resultType: true,
      revenue: true, revenueYoy: true, revenueQoq: true,
      profitBeforeTax: true, tax: true,
      netProfit: true, patYoy: true, patQoq: true, netMargin: true,
    },
  });
  return rows.map((q) => ({
    periodKey: `${q.fiscalYear}${q.quarter}`, quarter: q.quarter, fiscalYear: q.fiscalYear,
    reportDate: ymd(q.reportDate), filingDate: ymd(q.filingDate), resultType: q.resultType, xbrlUrl: q.xbrlUrl,
    revenue: money(q.revenue), revenueLabel: metricGloss("revenue").label, revenueYoy: pctPass(q.revenueYoy), revenueQoq: pctPass(q.revenueQoq),
    operatingProfit: null, profitBeforeTax: money(q.profitBeforeTax), tax: money(q.tax),
    netProfit: money(q.netProfit), profitYoy: pctPass(q.patYoy), profitQoq: pctPass(q.patQoq),
    operatingMargin: null, netMargin: pctPass(q.netMargin),
    margin: pctPass(q.netMargin), marginLabel: "Net margin",
  }));
}

async function spineLifeInsurance(stockId: string, basis: string): Promise<ViewerQuarter[]> {
  const rows = await prisma.lifeInsuranceQuarterlyResult.findMany({
    where: { stockId, resultType: basis },
    orderBy: { reportDate: "asc" },
    select: {
      quarter: true, fiscalYear: true, reportDate: true, filingDate: true, xbrlUrl: true, resultType: true,
      netPremiumIncome: true, premiumYoy: true, premiumQoq: true,
      profitBeforeTax: true, tax: true,
      netProfit: true, patYoy: true, patQoq: true, netMargin: true,
    },
  });
  return rows.map((q) => ({
    periodKey: `${q.fiscalYear}${q.quarter}`, quarter: q.quarter, fiscalYear: q.fiscalYear,
    reportDate: ymd(q.reportDate), filingDate: ymd(q.filingDate), resultType: q.resultType, xbrlUrl: q.xbrlUrl,
    revenue: money(q.netPremiumIncome), revenueLabel: metricGloss("netPremiumIncome").label, revenueYoy: pctPass(q.premiumYoy), revenueQoq: pctPass(q.premiumQoq),
    operatingProfit: null, profitBeforeTax: money(q.profitBeforeTax), tax: money(q.tax),
    netProfit: money(q.netProfit), profitYoy: pctPass(q.patYoy), profitQoq: pctPass(q.patQoq),
    operatingMargin: null, netMargin: pctPass(q.netMargin),
    margin: pctPass(q.netMargin), marginLabel: "Net margin",
  }));
}

async function spineGeneralInsurance(stockId: string, basis: string): Promise<ViewerQuarter[]> {
  const rows = await prisma.generalInsuranceQuarterlyResult.findMany({
    where: { stockId, resultType: basis },
    orderBy: { reportDate: "asc" },
    select: {
      quarter: true, fiscalYear: true, reportDate: true, filingDate: true, xbrlUrl: true, resultType: true,
      grossPremiumsWritten: true, gpwYoy: true, gpwQoq: true,
      profitBeforeTax: true, tax: true,
      netProfit: true, patYoy: true, patQoq: true, netMargin: true,
    },
  });
  return rows.map((q) => ({
    periodKey: `${q.fiscalYear}${q.quarter}`, quarter: q.quarter, fiscalYear: q.fiscalYear,
    reportDate: ymd(q.reportDate), filingDate: ymd(q.filingDate), resultType: q.resultType, xbrlUrl: q.xbrlUrl,
    revenue: money(q.grossPremiumsWritten), revenueLabel: metricGloss("grossPremiumsWritten").label, revenueYoy: pctPass(q.gpwYoy), revenueQoq: pctPass(q.gpwQoq),
    operatingProfit: null, profitBeforeTax: money(q.profitBeforeTax), tax: money(q.tax),
    netProfit: money(q.netProfit), profitYoy: pctPass(q.patYoy), profitQoq: pctPass(q.patQoq),
    operatingMargin: null, netMargin: pctPass(q.netMargin),
    margin: pctPass(q.netMargin), marginLabel: "Net margin",
  }));
}

const SPINE: Record<Family, (stockId: string, basis: string) => Promise<ViewerQuarter[]>> = {
  non_financial: spineNonFinancial,
  banking: spineBanking,
  nbfc: spineNbfc,
  life_insurance: spineLifeInsurance,
  general_insurance: spineGeneralInsurance,
};

/** Resolve the family spine on the preferred basis, falling back to the other basis
 *  when the preferred one has no rows (e.g. a standalone-only insurer). */
async function resolveSpine(
  stockId: string,
  family: Family,
): Promise<{ basis: string; spine: ViewerQuarter[] }> {
  const pref = preferredBasis(family);
  let basis = pref;
  let spine = await SPINE[family](stockId, pref);
  if (spine.length === 0) {
    basis = otherBasis(pref);
    spine = await SPINE[family](stockId, basis);
  }
  return { basis, spine };
}

/** Weekdays STRICTLY AFTER the filing through the window's close — the nominal length of
 *  the reaction window, derived from REACTION_WINDOW_DAYS rather than guessed at.
 *
 *  ⚠ APPROXIMATE BY DESIGN, and the UI must say so. Exchange holidays are not modelled
 *  anywhere in this codebase (there is no holiday table), so this counts weekdays and can
 *  read one or two high across a festival week. That is why the rendered figure is prefixed
 *  "~". What it can no longer be is a number unrelated to the window it describes. */
function expectedTradingDaysIn(filingDate: string, windowTo: string): number {
  const end = Date.parse(`${windowTo}T00:00:00Z`);
  let n = 0;
  for (let t = Date.parse(`${filingDate}T00:00:00Z`) + DAY_MS; t <= end; t += DAY_MS) {
    const dow = new Date(t).getUTCDay(); // 0=Sun..6=Sat
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

// ── Market Reaction — factual price path around the filing date (no verdict) ────
async function buildReaction(stockId: string, filingDate: string): Promise<MarketReaction> {
  const filingMs = new Date(filingDate).getTime();
  const from = new Date(filingMs - REACTION_LEAD_DAYS * DAY_MS);
  const to = new Date(filingMs + REACTION_WINDOW_DAYS * DAY_MS);

  const rows = await prisma.dailyPrice.findMany({
    where: { stockId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
    select: { date: true, close: true },
  });

  const points = rows.map((r) => {
    const d = ymd(r.date);
    return { date: d, close: Number(r.close), isFilingDay: d === filingDate };
  });

  /** ★ STRICTLY BEFORE THE FILING. `<=` was inclusive of the filing day, which made
   *  "pre-filing" mean two different things depending on the day of the week a company
   *  filed. On a weekday, a close exists that day and the baseline became the filing
   *  day's OWN close — already carrying the reaction it was supposed to be measured
   *  against (ABLBL 7 May: baseline 118.21, up 9.9% from 6 May's 107.60, so the panel
   *  reported −13.7% for a window that moved −5.2% from the last genuinely pre-filing
   *  close). On a weekend there is no such close, so the loop fell through to the prior
   *  trading day and the same field meant the honest thing. Two references, one label,
   *  chosen by the calendar — the figures were not comparable across stocks.
   *
   *  Now it is the last close BEFORE the filing, always. `null` when the stock has no
   *  close in the lead window at all (a first-ever result, or price coverage that starts
   *  on the filing date) — that is a real state and the block honest-empties on it. */
  let preClose: number | null = null;
  for (const p of points) {
    if (p.date < filingDate) preClose = p.close;
    else break;
  }

  const hasPost = points.some((p) => p.date > filingDate);
  const windowTo = ymd(to);
  const today = ymd(new Date());
  const windowComplete = today > windowTo;

  /** Three honest states:
   *  • unavailable — no pre-filing baseline at all, or no points; or a CLOSED window that
   *                  never printed a post-filing close, or is too sparse to draw.
   *  • forming     — the window is still open. A result filed today has a baseline and a
   *                  run-up but no post-filing close yet; that is a window that has not
   *                  opened, not one that is absent.
   *  • complete    — window elapsed, with a post-filing close and ≥ MIN points.
   *
   *  ⚠ `!hasPost` IS NO LONGER A REASON FOR `unavailable` WHILE THE WINDOW IS OPEN. It was,
   *  and it meant a result filed today rendered "not available for this result date" over
   *  four real closes (BLUEJET, 3 Aug: 29/30/31 Jul + 3 Aug, clean baseline). Nothing was
   *  missing except a close that cannot exist yet. It still gates `complete`, because a
   *  window that CLOSED without a post-filing print (a suspension, a delisting) is not a
   *  complete reaction and must not be labelled one. */
  let reactionState: "complete" | "forming" | "unavailable";
  if (preClose == null || points.length === 0) {
    reactionState = "unavailable";
  } else if (!windowComplete) {
    reactionState = "forming";
  } else if (hasPost && points.length >= MIN_REACTION_POINTS) {
    reactionState = "complete";
  } else {
    reactionState = "unavailable";
  }

  const available = reactionState !== "unavailable";
  const tradingDaysSinceFiling = points.filter((p) => p.date > filingDate).length;

  return {
    reactionState,
    available,
    filingDate,
    windowFrom: ymd(from),
    windowTo,
    points: available ? points : [],
    preClose: available ? preClose : null,
    tradingDaysSinceFiling: available ? tradingDaysSinceFiling : 0,
    expectedTradingDays: expectedTradingDaysIn(filingDate, windowTo),
  };
}

// ── News in the filing window ───────────────────────────────────────────────────
//
// ★ SCREENED BY THE SAME RULES AS THE DISCLOSURES TAB, AND FOR THE SAME REASON. Both surfaces read
// stock_news for one stock; only ~30% of the press rows are about the company they are filed under.
// Leaving this path unscreened would put a Sensex wrap next to a quarter's real coverage on the
// Results page while the stock's own Disclosures tab correctly hid it — the same stock, two answers.
// Filings pass through untouched (see relevance.ts). The `take` is applied AFTER screening, so the
// 15-item cap now means 15 relevant items rather than 15 rows of which four might be relevant.
async function buildNews(stockId: string, filingDate: string): Promise<ViewerNews[]> {
  const filingMs = new Date(filingDate).getTime();
  const from = new Date(filingMs - 3 * DAY_MS);
  const to = new Date(filingMs + 10 * DAY_MS);

  const stock = await prisma.stock.findUnique({
    where: { id: stockId },
    select: { symbol: true, name: true },
  });

  const windowRows = await prisma.stockNews.findMany({
    where: { stockId, publishedAt: { gte: from, lte: to } },
    orderBy: { publishedAt: "desc" },
    take: MAX_WINDOW_ROWS,
    // ⚠ `sentiment` IS DELIBERATELY NOT SELECTED — see ViewerNews in result-detail.types.ts.
    //    Nothing writes the column, and the Context tab used to render it unlabelled.
    select: {
      id: true, headline: true, summary: true, category: true, sourceType: true,
      publishedAt: true, externalUrl: true, pdfUrl: true, publisherDomain: true,
    },
  });

  const rows = stock
    ? screenStoredNews(windowRows, await buildGuardForStock(stock.symbol, stock.name)).kept.slice(0, 15)
    : windowRows.slice(0, 15);

  return rows.map((n) => ({
    id: n.id,
    sourceType: n.sourceType === "nse_announcement" ? "nse_announcement" : "google_news",
    headline: n.headline,
    summary: n.summary,
    source: n.publisherDomain ?? n.category ?? (n.sourceType === "nse_announcement" ? "NSE filing" : "Press"),
    category: n.category,
    publisherDomain: n.publisherDomain,
    publishedAt: n.publishedAt.toISOString(),
    url: n.externalUrl ?? n.pdfUrl,
    pdfUrl: n.pdfUrl,
  }));
}

// ── Quarter in Brief — the generated reading for THIS stock and THIS period ─────────────────────
// ⚠ PERIOD-KEYED, and that is the whole point of this function's shape. It previously took stockId
// alone and ordered by generatedAt desc, while the page it serves is period-addressed
// (GET /api/v1/results/:symbol?period=FY26Q4). Opening an older quarter would therefore have shown
// the NEWEST brief against that older quarter's figures. The bug never fired only because the table
// it read was empty; it is fixed here before anything writes a row.
// Only `live` rows are served: a brief whose inputs changed is HIDDEN, never shown stale.
//
// ── ★ STAGE 5 · TWO SOURCES, ONE BLOCK, AND ONLY ONE OF THEM IS STORED ─────────────────────────
// `payload` comes out of the database and is the same bytes for every reader. `personal` is computed
// HERE, per reader, and is never written anywhere. They meet on the response and nowhere earlier —
// see the note on ViewerAi.personal.
const ABSENT_AI: ViewerAi = {
  available: false, payload: null, verdictKey: null, verdictLabel: null,
  scoredAsOf: null, modelVersion: null, generatedAt: null, personal: null,
};

async function buildQuarterBrief(
  stockId: string,
  symbol: string,
  quarter: string,
  fiscalYear: string,
  resultType: string,
  userId: string | null,
): Promise<ViewerAi> {
  const row = await prisma.quarterBrief.findUnique({
    where: {
      stockId_quarter_fiscalYear_resultType: { stockId, quarter, fiscalYear, resultType },
    },
    select: {
      content: true, verdictKey: true, verdictLabel: true, scoredAsOf: true,
      model: true, generatedAt: true, status: true,
    },
  });

  if (!row || row.status !== "live") return ABSENT_AI;

  // ⚠ DEFENCE IN DEPTH, NOT THE PLAN. Rows written before Stage 5 held PROSE in `content` and do not
  // parse; the table was purged on 2026-08-09 so none remain. This catch is what happens if a row in
  // an older shape ever appears again: the card renders as ABSENT — a state the reader already
  // understands — rather than throwing a 500 on a page with nine other sections working.
  let payload: BriefPayload;
  try {
    payload = JSON.parse(row.content) as BriefPayload;
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.gaps)) throw new Error("not a payload");
  } catch {
    console.warn(`[results/brief] ${symbol} ${fiscalYear}${quarter}: stored content is not a BriefPayload — serving absent. Clear the row (scripts/purge-quarter-briefs.ts) and regenerate.`);
    return ABSENT_AI;
  }

  // ★ A BRIEF WITH NO VERDICT IS A REAL, RENDERABLE STATE — payload present, badge absent. The stored
  // sentinel becomes a true null here so the renderer branches on the contract, not on a magic string.
  const verdict = readVerdict(row.verdictKey, row.verdictLabel);

  return {
    available: true,
    payload,
    verdictKey: verdict?.key ?? null,
    verdictLabel: verdict?.label ?? null,
    scoredAsOf: row.scoredAsOf ? ymd(row.scoredAsOf) : null,
    modelVersion: row.model,
    generatedAt: row.generatedAt.toISOString(),
    // ⚠ AWAITED HERE RATHER THAN IN THE Promise.all ABOVE, DELIBERATELY. It must not run when the
    // brief is absent or unreadable: a reader looking at a card that does not exist should not be
    // costing a query to describe their position in it. Anonymous readers cost ZERO — buildPersonalSection
    // returns null on a null userId without touching the database.
    // ★ STAGE 4 — the PERIOD is now passed. It is what lets the section say how the quarter moved the
    // reader's position rather than only what the position is; without it this module can describe a
    // holding but not a change. Composed from the same two parts this function was called with, so it
    // cannot name a different quarter than the brief row above it.
    personal: await buildPersonalSection(stockId, symbol, userId, `${fiscalYear}${quarter}`),
  };
}

// ── Corporate actions around the result (factual) ───────────────────────────────
async function buildCorpEvents(stockId: string, filingDate: string): Promise<ViewerCorpEvent[]> {
  const filingMs = new Date(filingDate).getTime();
  const from = new Date(filingMs - 7 * DAY_MS);
  const to = new Date(filingMs + 45 * DAY_MS);

  const rows = await prisma.corporateEvent.findMany({
    where: {
      stockId,
      eventDate: { gte: from, lte: to },
      eventType: { in: ["dividend", "agm", "board_meeting", "earnings"] },
    },
    orderBy: { eventDate: "asc" },
    take: 8,
    select: {
      eventType: true, eventDate: true, description: true,
      dividendAmount: true, dividendType: true, exDate: true, recordDate: true,
    },
  });

  return rows.map((e) => ({
    eventType: e.eventType,
    eventDate: ymd(e.eventDate),
    description: e.description,
    dividendAmount: e.dividendAmount != null ? Number(e.dividendAmount) : null,
    dividendType: e.dividendType,
    exDate: e.exDate ? ymd(e.exDate) : null,
    recordDate: e.recordDate ? ymd(e.recordDate) : null,
  }));
}

// ── Peers — same peer-group, same family, same quarter (best-effort, optional) ──
async function buildPeers(
  stockId: string,
  family: Family,
  quarter: string,
  fiscalYear: string,
): Promise<{ peers: ViewerPeer[]; peerGroupName: string | null }> {
  const membership = await prisma.stockPeerGroup.findFirst({
    where: { stockId },
    select: {
      peerGroup: {
        select: {
          name: true,
          stocks: {
            select: { stock: { select: { id: true, symbol: true, name: true, industryType: true, isActive: true } } },
          },
        },
      },
    },
  });
  if (!membership) return { peers: [], peerGroupName: null };

  const peerGroupName = membership.peerGroup.name;
  const coMembers = membership.peerGroup.stocks
    .map((s) => s.stock)
    .filter((s) => s.id !== stockId && s.isActive && (s.industryType as Family) === family)
    .slice(0, 8);
  if (coMembers.length === 0) return { peers: [], peerGroupName };

  const peerIds = coMembers.map((c) => c.id);
  // One query for the peers' rows of this exact period (any basis); reduce to the
  // family's preferred basis where both filed.
  const spineByStock = new Map<string, ViewerQuarter>();
  const rowsPerPeer = await Promise.all(
    coMembers.map(async (c) => ({ id: c.id, rows: await SPINE[family](c.id, preferredBasis(family)) })),
  );
  // Fallback to the other basis for peers that have nothing on the preferred one.
  await Promise.all(
    rowsPerPeer.map(async (r) => {
      let rows = r.rows;
      if (rows.length === 0) rows = await SPINE[family](r.id, otherBasis(preferredBasis(family)));
      const match = rows.find((q) => q.quarter === quarter && q.fiscalYear === fiscalYear);
      if (match) spineByStock.set(r.id, match);
    }),
  );

  const peers: ViewerPeer[] = coMembers.map((c) => {
    const m = spineByStock.get(c.id);
    return {
      symbol: c.symbol,
      name: c.name,
      revenueYoy: m?.revenueYoy ?? null,
      profitYoy: m?.profitYoy ?? null,
      margin: m?.margin ?? null,
      marginLabel: m?.marginLabel ?? (family === "non_financial" ? "Op margin" : "Net margin"),
      filed: Boolean(m),
    };
  });

  void peerIds; // (peerIds kept for readability of the fan-out above)
  return { peers, peerGroupName };
}

// ── Health context — viewed-period composite/band + shift + findings (one extra read) ──
// composite/band come from the trajectory SERIES at the viewed periodKey (NOT verdict, which
// is the latest snapshot only) so an older result never shows the latest composite. The shift
// is a whole-snapshot delta vs the prior in-force period — framed by the UI, not "caused by".
function buildHealthBlock(
  health: Awaited<ReturnType<typeof buildHealthSnapshotView>>,
  viewedPeriodKey: string,
): ResultHealthBlock | null {
  if (!health) return null; // unknown symbol (defensive — stock already resolved upstream)
  const series = health.trajectory?.series ?? [];
  const idx = series.findIndex((p) => p.periodKey === viewedPeriodKey);
  const point = idx >= 0 ? series[idx] : null;
  const prior = idx > 0 ? series[idx - 1] : null;
  return {
    scored: health.scored,
    latestPeriodKey: health.identity.periodKey || null, // "" when unscored → null
    periodComposite: point ? point.composite : null,
    periodBand: point ? point.labelBand : null,
    compositeShift:
      point && prior
        ? {
            delta: Math.round((point.composite - prior.composite) * 1e4) / 1e4,
            priorPeriodKey: prior.periodKey,
          }
        : null,
    findings: health.findings,
    // ★ Resolved in buildHealthSnapshotView's FIRST layer, before its not-scored guard — so this is
    //   real on a stock that has no snapshot, which is the branch this block used to close entirely.
    filingFindings: health.filingFindings,
  };
}

// ── Annual CF + BS-headline — PER FAMILY, gated on FY-match ──
// buildFundamentalsView serves all five families (built:true), each with its own annual shape —
// the SAME per-family dispatch the Fundamentals tab uses. We surface the family-appropriate
// BS-headline + CF (banks/NBFC carry CF; insurer annuals have NO cash-flow statement → cashFlow
// null, a real absence the UI renders as "n/a for insurers"). The annual read returns the LATEST
// year, so it lines up only with the latest Q4; an older quarter (or no annual row) → not_filed
// (never a stale prior year). Per-line nulls pass through (BS ~24% null is normal — honest "—").
const crLine = (key: string, label: string, value: number | null): AnnualLine => ({ key, label, value, unit: "cr" });
const rsLine = (key: string, label: string, value: number | null): AnnualLine => ({ key, label, value, unit: "rupees" });
const cfLines = (op: number | null, inv: number | null, fin: number | null): AnnualLine[] => [
  crLine("cashFromOperating", "Operating", op),
  crLine("cashFromInvesting", "Investing", inv),
  crLine("cashFromFinancing", "Financing", fin),
];

function buildAnnualBlock(
  family: Family,
  fundamentals: Awaited<ReturnType<typeof buildFundamentalsView>>,
  current: ViewerQuarter,
): { annual: AnnualResultBlock | null; annualState: AnnualResultState } {
  const notFiled = { annual: null, annualState: "not_filed" as const };
  if (!fundamentals) return notFiled;
  // The annual is the FULL-YEAR statement, so tie it to the YEAR-END (Q4) result ONLY. Two
  // guards in one: (1) quarter === "Q4" — an interim quarter (Q1–Q3) of the SAME fiscal year
  // shares the fiscalYear string but is NOT the year-end result, so the 12-month annual would be
  // a temporal mismatch beside a 3-month interim; (2) fy === current.fiscalYear — the annual read
  // returns the NEWEST year, so an OLDER year-end (e.g. FY24Q4) won't match → not_filed (never a
  // stale prior year). FY-match alone is insufficient (every quarter of FY26 reads fiscalYear
  // "FY26"); both conditions are required to isolate the latest year-end result.
  const fyOk = (fy: string | undefined): boolean =>
    current.quarter === "Q4" && fy === current.fiscalYear;

  switch (family) {
    case "non_financial": {
      const a = fundamentals.nonFinancial?.annual;
      if (!a || !fyOk(a.fiscalYear)) return notFiled;
      return {
        annual: {
          family,
          fiscalYear: a.fiscalYear,
          balanceSheet: [
            crLine("totalAssets", "Total assets", a.totalAssets),
            crLine("totalEquity", "Total equity", a.totalEquity),
            crLine("currentAssets", "Current assets", a.currentAssets),
            crLine("currentLiabilities", "Current liabilities", a.currentLiabilities),
            crLine("inventories", "Inventories", a.inventories),
            crLine("totalDebt", "Total debt", a.totalDebt),
            crLine("cashAndCashEquivalents", "Cash & equivalents", a.cashAndCashEquivalents),
          ],
          cashFlow: cfLines(a.cashFromOperating, a.cashFromInvesting, a.cashFromFinancing),
          perShare: [
            rsLine("basicEps", "Basic EPS", a.basicEps),
            rsLine("bookValuePerShare", "Book value / share", a.bookValuePerShare),
          ],
        },
        annualState: "available",
      };
    }
    case "banking": {
      const a = fundamentals.banking?.annual;
      if (!a || !fyOk(a.fiscalYear)) return notFiled;
      return {
        annual: {
          family,
          fiscalYear: a.fiscalYear,
          balanceSheet: [
            crLine("totalAssets", "Total assets", a.totalAssets),
            crLine("netWorth", "Net worth", a.netWorth),
            crLine("deposits", "Deposits", a.deposits),
            crLine("advances", "Advances", a.advances),
            crLine("investments", "Investments", a.investments),
            crLine("borrowings", "Borrowings", a.borrowings),
          ],
          cashFlow: cfLines(a.cashFromOperating, a.cashFromInvesting, a.cashFromFinancing),
          perShare: [
            rsLine("basicEps", "Basic EPS", a.basicEps),
            rsLine("bookValuePerShare", "Book value / share", a.bookValuePerShare),
          ],
        },
        annualState: "available",
      };
    }
    case "nbfc": {
      const a = fundamentals.nbfc?.annual;
      if (!a || !fyOk(a.fiscalYear)) return notFiled;
      return {
        annual: {
          family,
          fiscalYear: a.fiscalYear,
          balanceSheet: [
            crLine("totalAssets", "Total assets", a.totalAssets),
            crLine("netWorth", "Net worth", a.netWorth),
            crLine("loans", "Loans (AUM)", a.loans),
            crLine("borrowings", "Borrowings", a.borrowings),
            crLine("investments", "Investments", a.investments),
          ],
          cashFlow: cfLines(a.cashFromOperating, a.cashFromInvesting, a.cashFromFinancing),
          perShare: [
            rsLine("basicEps", "Basic EPS", a.basicEps),
            rsLine("bookValuePerShare", "Book value / share", a.bookValuePerShare),
          ],
        },
        annualState: "available",
      };
    }
    case "life_insurance": {
      const a = fundamentals.lifeInsurance?.annual;
      if (!a || !fyOk(a.fiscalYear)) return notFiled;
      return {
        annual: {
          family,
          fiscalYear: a.fiscalYear,
          balanceSheet: [
            crLine("totalAssets", "Total assets", a.totalAssets),
            crLine("netWorth", "Net worth", a.netWorth),
            crLine("policyholdersFunds", "Policyholders' funds", a.policyholdersFunds),
            crLine("investmentsPolicyholders", "Investments (policyholders)", a.investmentsPolicyholders),
            crLine("investmentsShareholders", "Investments (shareholders)", a.investmentsShareholders),
          ],
          cashFlow: null, // insurer annuals carry no cash-flow statement (real absence — n/a)
          perShare: [
            rsLine("basicEps", "Basic EPS", a.basicEps),
            rsLine("bookValuePerShare", "Book value / share", a.bookValuePerShare),
          ],
        },
        annualState: "available",
      };
    }
    case "general_insurance": {
      const a = fundamentals.generalInsurance?.annual;
      if (!a || !fyOk(a.fiscalYear)) return notFiled;
      return {
        annual: {
          family,
          fiscalYear: a.fiscalYear,
          balanceSheet: [
            crLine("totalAssets", "Total assets", a.totalAssets),
            crLine("netWorth", "Net worth", a.netWorth),
            crLine("investments", "Investments", a.investments),
          ],
          cashFlow: null, // insurer annuals carry no cash-flow statement (real absence — n/a)
          perShare: [
            rsLine("basicEps", "Basic EPS", a.basicEps),
            rsLine("bookValuePerShare", "Book value / share", a.bookValuePerShare),
          ],
        },
        annualState: "available",
      };
    }
    default:
      return notFiled;
  }
}

// ── Entry ───────────────────────────────────────────────────────────────────────
export async function buildResultDetail(
  symbol: string,
  periodKey?: string,
  userId: string | null = null,
): Promise<ResultDetailData | null> {
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true, symbol: true, name: true, industryType: true, sector: { select: { displayName: true } } },
  });
  if (!stock) return null;

  const family = stock.industryType as Family;
  const { basis, spine: fullSpine } = await resolveSpine(stock.id, family);
  if (fullSpine.length === 0) return null; // in universe but no filed results yet → 404 (honest)

  const spine = fullSpine.slice(-SPINE_MAX);
  const periodsAvailable: PeriodRef[] = [...fullSpine]
    .reverse()
    .map((q) => ({ periodKey: q.periodKey, quarter: q.quarter, fiscalYear: q.fiscalYear }));

  const current = (periodKey && fullSpine.find((q) => q.periodKey === periodKey)) || fullSpine[fullSpine.length - 1];
  const idx = fullSpine.findIndex((q) => q.periodKey === current.periodKey);
  const prevQuarter = idx > 0 ? fullSpine[idx - 1] : null;
  const prevFy = `FY${String(Number(current.fiscalYear.slice(2)) - 1).padStart(2, "0")}`;
  const sameQuarterLastYear =
    fullSpine.find((q) => q.quarter === current.quarter && q.fiscalYear === prevFy) ?? null;

  const [marketReaction, news, ai, corporateEvents, peerBundle, health, fundamentals] =
    await Promise.all([
      buildReaction(stock.id, current.filingDate),
      buildNews(stock.id, current.filingDate),
      buildQuarterBrief(stock.id, stock.symbol, current.quarter, current.fiscalYear, current.resultType, userId),
      buildCorpEvents(stock.id, current.filingDate),
      buildPeers(stock.id, family, current.quarter, current.fiscalYear),
      buildHealthSnapshotView(stock.symbol),
      buildFundamentalsView(stock.symbol),
    ]);

  const healthBlock = buildHealthBlock(health, current.periodKey);
  const { annual, annualState } = buildAnnualBlock(family, fundamentals, current);

  return {
    symbol: stock.symbol,
    name: stock.name,
    sector: stock.sector?.displayName ?? null,
    industryType: family,
    basis,
    current,
    prevQuarter,
    sameQuarterLastYear,
    spine,
    periodsAvailable,
    marketReaction,
    news,
    ai,
    corporateEvents,
    peers: peerBundle.peers,
    peerGroupName: peerBundle.peerGroupName,
    health: healthBlock,
    annual,
    annualState,
  };
}
