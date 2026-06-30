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

import { prisma } from "../../db/prisma.js";
import { toNum, round } from "./fundamentals-normalize.js";
import { buildHealthSnapshotView } from "./health-view.service.js";
import { buildFundamentalsView } from "./fundamentals-view.service.js";
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
    revenue: money(q.revenue), revenueLabel: "Revenue", revenueYoy: pctPass(q.revenueYoy), revenueQoq: pctPass(q.revenueQoq),
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
    revenue: money(q.nii), revenueLabel: "Net interest income", revenueYoy: pctPass(q.niiYoy), revenueQoq: pctPass(q.niiQoq),
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
    revenue: money(q.revenue), revenueLabel: "Revenue", revenueYoy: pctPass(q.revenueYoy), revenueQoq: pctPass(q.revenueQoq),
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
    revenue: money(q.netPremiumIncome), revenueLabel: "Net premium", revenueYoy: pctPass(q.premiumYoy), revenueQoq: pctPass(q.premiumQoq),
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
    revenue: money(q.grossPremiumsWritten), revenueLabel: "Gross premium", revenueYoy: pctPass(q.gpwYoy), revenueQoq: pctPass(q.gpwQoq),
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

// ── Market Reaction — factual price path around the filing date (no verdict) ────
async function buildReaction(stockId: string, filingDate: string): Promise<MarketReaction> {
  const filingMs = new Date(filingDate).getTime();
  const from = new Date(filingMs - 5 * DAY_MS);
  const to = new Date(filingMs + 20 * DAY_MS);

  const rows = await prisma.dailyPrice.findMany({
    where: { stockId, date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
    select: { date: true, close: true },
  });

  const points = rows.map((r) => {
    const d = ymd(r.date);
    return { date: d, close: Number(r.close), isFilingDay: d === filingDate };
  });

  let preClose: number | null = null;
  for (const p of points) {
    if (p.date <= filingDate) preClose = p.close;
    else break;
  }

  const hasPost = points.some((p) => p.date > filingDate);
  const windowTo = ymd(to);
  const today = ymd(new Date());
  const windowComplete = today > windowTo;

  // Three honest states:
  // • unavailable — no pre-filing base, or no post-filing days (nothing to compare against)
  // • complete    — full window elapsed, ≥ MIN points with a pre-filing base
  // • forming     — window still open (filing < ~20 cal days ago), pre-base + ≥1 post day
  let reactionState: "complete" | "forming" | "unavailable";
  if (preClose == null || !hasPost) {
    reactionState = "unavailable";
  } else if (windowComplete && points.length >= MIN_REACTION_POINTS) {
    reactionState = "complete";
  } else if (!windowComplete) {
    // Window is still forming — partial line is real and honest
    reactionState = "forming";
  } else {
    // Sparse stock: window closed but below MIN points threshold
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
  };
}

// ── News in the filing window ───────────────────────────────────────────────────
async function buildNews(stockId: string, filingDate: string): Promise<ViewerNews[]> {
  const filingMs = new Date(filingDate).getTime();
  const from = new Date(filingMs - 3 * DAY_MS);
  const to = new Date(filingMs + 10 * DAY_MS);

  const rows = await prisma.stockNews.findMany({
    where: { stockId, publishedAt: { gte: from, lte: to } },
    orderBy: { publishedAt: "desc" },
    take: 15,
    select: {
      id: true, headline: true, summary: true, category: true, sourceType: true,
      publishedAt: true, externalUrl: true, pdfUrl: true, sentiment: true,
    },
  });

  return rows.map((n) => ({
    id: n.id,
    headline: n.headline,
    summary: n.summary,
    source: n.category ?? (n.sourceType === "nse_announcement" ? "NSE Announcement" : "News"),
    category: n.category,
    publishedAt: n.publishedAt.toISOString(),
    url: n.externalUrl ?? n.pdfUrl,
    pdfUrl: n.pdfUrl,
    sentiment: n.sentiment,
  }));
}

// ── AI earnings analysis (real where present; 0 rows today → always stub) ────────
async function buildAi(stockId: string): Promise<ViewerAi> {
  const row = await prisma.aiSummary.findFirst({
    where: { stockId, summaryType: "earnings_analysis" },
    orderBy: { generatedAt: "desc" },
    select: { headline: true, content: true, keyPoints: true, modelVersion: true, generatedAt: true },
  });

  if (!row) {
    return { available: false, headline: null, content: null, keyPoints: null, modelVersion: null, generatedAt: null };
  }

  // keyPoints is a flat bullet array (per schema). Accept only string entries; ignore
  // any other shape rather than guessing — never fabricate structure.
  const keyPoints = Array.isArray(row.keyPoints)
    ? (row.keyPoints.filter((p): p is string => typeof p === "string"))
    : null;

  return {
    available: true,
    headline: row.headline,
    content: row.content,
    keyPoints: keyPoints && keyPoints.length ? keyPoints : null,
    modelVersion: row.modelVersion,
    generatedAt: row.generatedAt.toISOString(),
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
      buildAi(stock.id),
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
