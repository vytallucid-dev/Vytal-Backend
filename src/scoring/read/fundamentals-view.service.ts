// File: src/scoring/read/fundamentals-view.service.ts
//
// THE fundamentals assembler for GET /api/stocks/:symbol/fundamentals — ONE endpoint
// that DISPATCHES on Stock.industryType and returns a shared envelope + exactly one
// per-family payload. non_financial is fully implemented here; the other four families
// return the envelope with built:false and a null payload (honest "coming" state),
// each to be built in its own later pass.
//
// Everything the UI receives is CANONICAL (percent as percent, money ₹ Cr, ratios
// as-is) — every figure runs through makeNormalizer(family). Derivations (roa,
// current/quick ratio, equity multiplier, payout, dupont legs, yields) are guarded
// read-layer ARITHMETIC over stored columns — divide-by-zero/null → null (honest-empty).
// This is a read layer, not scoring: there is no grade here, only display math.

import { prisma } from "../../db/prisma.js";
import { makeNormalizer, divOrNull, pctOf, round, zeroToNull, toNum } from "./fundamentals-normalize.js";
import { buildCasaDisplay } from "../../ingestions/bank-supplementary/casa-status.js";
import type {
  FundamentalsView,
  IndustryFamily,
  Basis,
  NonFinancialPayload,
  QuarterPoint,
  AnnualSnapshot,
  YieldsBlock,
  CashConversionPoint,
  NfRatioHistoryPoint,
  BankingPayload,
  BankingQuarter,
  BankingAnnual,
  BkRatioHistoryPoint,
  NbfcPayload,
  NbfcQuarter,
  NbfcAnnual,
  LifeInsurancePayload,
  LifeInsuranceQuarter,
  LifeInsuranceAnnual,
  LiRatioHistoryPoint,
  GeneralInsurancePayload,
  GeneralInsuranceQuarter,
  GeneralInsuranceAnnual,
} from "./fundamentals-view.types.js";

const ALL_BASES: Basis[] = ["consolidated", "standalone"];
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

export interface FundamentalsViewOpts {
  /** Optional basis override from the tab's toggle. Falls back to consolidated → the
   *  only-available basis when the requested one has no data for this stock. */
  basis?: Basis;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY — look up the stock, resolve basis, dispatch on family.
// Returns null ONLY when the symbol is unknown (controller → 404).
// ─────────────────────────────────────────────────────────────────────────────
export async function buildFundamentalsView(
  symbol: string,
  opts: FundamentalsViewOpts = {},
): Promise<FundamentalsView | null> {
  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true, symbol: true, name: true, industryType: true },
  });
  if (!stock) return null;

  const family = stock.industryType as IndustryFamily;

  // Which bases actually have rows (union across quarterly + annual). Drives both the
  // tab's basis toggle and the default-with-fallback choice below.
  //
  // Basis DEFAULT is family-aware: banks default to STANDALONE — standalone Q4 rows are
  // always complete, while consolidated Q4 carries audit_pending=true (null NPA/capital)
  // for some banks. Insurers default to STANDALONE too — the regulated entity files
  // standalone, several insurers are standalone-only (SBILIFE, ICICIGI), and the
  // insurance-specific disclosures (persistency, combined ratio, solvency) live there.
  // Non-financials default to consolidated.
  const basisAvailable = await resolveBasisAvailable(stock.id, family);
  const preferredDefault: Basis =
    family === "banking" || family === "life_insurance" || family === "general_insurance"
      ? "standalone"
      : "consolidated";
  const basis = chooseBasis(opts.basis, basisAvailable, preferredDefault);

  // Shared envelope — present for EVERY family, built or not.
  const base: Omit<
    FundamentalsView,
    "nonFinancial" | "banking" | "nbfc" | "lifeInsurance" | "generalInsurance" | "built" | "historyDepth" | "notes"
  > = {
    symbol: stock.symbol,
    name: stock.name,
    industryType: family,
    family,
    basis,
    basisAvailable,
  };

  const nullPayloads = {
    nonFinancial: null,
    banking: null,
    nbfc: null,
    lifeInsurance: null,
    generalInsurance: null,
  } as const;

  // ── DISPATCH ────────────────────────────────────────────────────────────────
  if (family === "non_financial") {
    const { payload, historyDepth, notes } = await buildNonFinancial(stock.id, basis, basisAvailable);
    return {
      ...base,
      built: true,
      historyDepth,
      notes,
      ...nullPayloads,
      nonFinancial: payload,
    };
  }

  if (family === "banking") {
    const { payload, historyDepth, notes } = await buildBanking(stock.symbol, stock.id, basis, basisAvailable);
    return {
      ...base,
      built: true,
      historyDepth,
      notes,
      ...nullPayloads,
      banking: payload,
    };
  }

  if (family === "nbfc") {
    const { payload, historyDepth, notes } = await buildNbfc(stock.id, basis, basisAvailable);
    return {
      ...base,
      built: true,
      historyDepth,
      notes,
      ...nullPayloads,
      nbfc: payload,
    };
  }

  if (family === "life_insurance") {
    const { payload, historyDepth, notes } = await buildLifeInsurance(stock.id, basis, basisAvailable);
    return {
      ...base,
      built: true,
      historyDepth,
      notes,
      ...nullPayloads,
      lifeInsurance: payload,
    };
  }

  if (family === "general_insurance") {
    const { payload, historyDepth, notes } = await buildGeneralInsurance(stock.id, basis, basisAvailable);
    return {
      ...base,
      built: true,
      historyDepth,
      notes,
      ...nullPayloads,
      generalInsurance: payload,
    };
  }

  // No remaining families — every IndustryFamily is now built. Defensive fallback.
  return {
    ...base,
    built: false,
    historyDepth: { quarters: 0, years: 0 },
    notes: [`Detailed financials for ${familyLabel(family)} companies are being built.`],
    ...nullPayloads,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// non_financial family
// ─────────────────────────────────────────────────────────────────────────────
type QuarterRow = {
  quarter: string;
  fiscalYear: string;
  reportDate: Date;
  filingDate: Date;
  xbrlUrl: string;
  revenue: unknown;
  netProfit: unknown;
  operatingProfit: unknown;
  operatingMargin: unknown;
  netMargin: unknown;
  revenueYoy: unknown;
  profitYoy: unknown;
  revenueQoq: unknown;
  profitQoq: unknown;
};

type AnnualRow = {
  fiscalYear: string;
  roe: unknown;
  roce: unknown;
  netMargin: unknown;
  operatingMargin: unknown;
  netProfit: unknown;
  revenue: unknown;
  revenueGrowthYoy: unknown;
  profitGrowthYoy: unknown;
  epsGrowthYoy: unknown;
  debtToEquity: unknown;
  interestCoverage: unknown;
  assetTurnover: unknown;
  fcf: unknown;
  capex: unknown;
  cashFromOperating: unknown;
  cashFromInvesting: unknown;
  cashFromFinancing: unknown;
  dividendsPaid: unknown;
  basicEps: unknown;
  bookValuePerShare: unknown;
  totalAssets: unknown;
  totalEquity: unknown;
  currentAssets: unknown;
  currentLiabilities: unknown;
  inventories: unknown;
  totalDebt: unknown;
  cashAndCashEquivalents: unknown;
};

async function buildNonFinancial(
  stockId: string,
  basis: Basis,
  basisAvailable: Basis[],
): Promise<{ payload: NonFinancialPayload; historyDepth: { quarters: number; years: number }; notes: string[] }> {
  const norm = makeNormalizer("non_financial");

  // Two reads on the chosen basis + the live price snapshot, in parallel.
  const [quarterRows, annualRows, price] = await Promise.all([
    prisma.quarterlyResult.findMany({
      where: { stockId, resultType: basis },
      orderBy: { reportDate: "asc" }, // oldest → newest (the spine)
      select: {
        quarter: true,
        fiscalYear: true,
        reportDate: true,
        filingDate: true,
        xbrlUrl: true,
        revenue: true,
        netProfit: true,
        operatingProfit: true,
        operatingMargin: true,
        netMargin: true,
        revenueYoy: true,
        profitYoy: true,
        revenueQoq: true,
        profitQoq: true,
      },
    }) as Promise<QuarterRow[]>,
    prisma.fundamental.findMany({
      where: { stockId, resultType: basis },
      orderBy: { reportDate: "desc" }, // newest first — [0] is the latest year
      select: {
        fiscalYear: true,
        roe: true,
        roce: true,
        netMargin: true,
        operatingMargin: true,
        netProfit: true,
        revenue: true,
        revenueGrowthYoy: true,
        profitGrowthYoy: true,
        epsGrowthYoy: true,
        debtToEquity: true,
        interestCoverage: true,
        assetTurnover: true,
        fcf: true,
        capex: true,
        cashFromOperating: true,
        cashFromInvesting: true,
        cashFromFinancing: true,
        dividendsPaid: true,
        basicEps: true,
        bookValuePerShare: true,
        totalAssets: true,
        totalEquity: true,
        currentAssets: true,
        currentLiabilities: true,
        inventories: true,
        totalDebt: true,
        cashAndCashEquivalents: true,
      },
    }) as Promise<AnnualRow[]>,
    prisma.stockPrice.findUnique({
      where: { stockId },
      select: { marketCap: true },
    }),
  ]);

  // ── QUARTERLY SPINE ──────────────────────────────────────────────────────────
  // P&L LEVEL fields run through zeroToNull: a consolidated quarter that didn't file a
  // separate net-profit line stores 0, and a ₹0 / 0.00% P&L line in a real operating
  // quarter is an artifact → honest dash, not a fabricated zero. Growth (YoY/QoQ) is
  // passed through faithfully — a genuine 0% change is a real value.
  const quarters: QuarterPoint[] = quarterRows.map((q) => ({
    periodKey: `${q.fiscalYear}${q.quarter}`, // "FY26" + "Q4" → "FY26Q4"
    reportDate: ymd(q.reportDate),
    filingDate: ymd(q.filingDate),
    xbrlUrl: q.xbrlUrl,
    revenue: zeroToNull(norm.money(q.revenue)),
    netProfit: zeroToNull(norm.money(q.netProfit)),
    operatingProfit: zeroToNull(norm.money(q.operatingProfit)),
    operatingMargin: zeroToNull(norm.pct(q.operatingMargin)),
    netMargin: zeroToNull(norm.pct(q.netMargin)),
    revenueYoy: norm.pct(q.revenueYoy),
    profitYoy: norm.pct(q.profitYoy),
    revenueQoq: norm.pct(q.revenueQoq),
    profitQoq: norm.pct(q.profitQoq),
  }));

  // ── ANNUAL CONTEXT (latest year) + derivations ───────────────────────────────
  const a = annualRows[0] ?? null;
  const annual: AnnualSnapshot | null = a ? buildAnnual(a, norm) : null;

  // ── CASH CONVERSION (multi-year) — operating cash flow vs net profit per fiscal year.
  // Built from EVERY annual year on the basis (oldest→newest), kept only where CFO is on
  // file — the divergence is meaningless without it (honest-empty when no CFO anywhere).
  const annualOldestFirst = [...annualRows].reverse();
  const cashConversion: CashConversionPoint[] = annualOldestFirst
    .map((r) => ({
      fiscalYear: r.fiscalYear,
      cashFromOperating: norm.money(r.cashFromOperating),
      netProfit: norm.money(r.netProfit),
    }))
    .filter((p) => p.cashFromOperating != null);

  // ── RATIO HISTORY — headline annual ratios per year (oldest→newest) for the sparklines.
  // Unfiltered: each ratio may be null in a given year; the UI gates each sparkline on
  // having ≥ 3 real points, so a thinly-covered stock simply shows no spark.
  const ratioHistory: NfRatioHistoryPoint[] = annualOldestFirst.map((r) => ({
    fiscalYear: r.fiscalYear,
    roe: norm.pct(r.roe),
    roce: norm.pct(r.roce),
    netMargin: norm.pct(r.netMargin),
    operatingMargin: norm.pct(r.operatingMargin),
  }));

  // ── PRICE-RELATIVE YIELDS — trailing-year figures over LIVE market cap ─────────
  const marketCap = norm.money(price?.marketCap ?? null);
  const yields: YieldsBlock | null = a
    ? {
        marketCap,
        fcfYield: pctOf(norm.money(a.fcf), marketCap),
        // |dividends| — sign is a cash-flow convention; the yield is a positive fact.
        dividendYield: pctOf(absOrNull(norm.money(a.dividendsPaid)), marketCap),
        asOfBasis: "Trailing-year figures over current market cap",
      }
    : null;

  const payload: NonFinancialPayload = { quarters, annual, yields, cashConversion, ratioHistory };

  // ── honest data-state notes ───────────────────────────────────────────────────
  const years = annualRows.length;
  const notes: string[] = [];
  if (quarters.length === 0 && years === 0) {
    notes.push("No fundamentals have been reported for this company yet.");
  } else {
    if (quarters.length > 0 && quarters.length < 4) {
      notes.push("Limited quarterly history — trend charts fill in as quarters accrue.");
    }
    if (years > 0 && years < 2) {
      notes.push(`Annual figures cover a single year on a ${basis} basis — year-over-year growth needs a prior year.`);
    }
  }
  if (basisAvailable.length === 2) {
    notes.push("Both consolidated and standalone results are available — toggle to switch basis.");
  }
  if (a && marketCap == null) {
    notes.push("Live market cap is not currently populated, so cash-flow and dividend yields are unavailable.");
  }

  return { payload, historyDepth: { quarters: quarters.length, years }, notes };
}

/** Latest-year annual snapshot: stored canonical fields + guarded read-layer derivations. */
function buildAnnual(a: AnnualRow, norm: ReturnType<typeof makeNormalizer>): AnnualSnapshot {
  const netProfit = norm.money(a.netProfit);
  const revenue = norm.money(a.revenue);
  const totalAssets = norm.money(a.totalAssets);
  const totalEquity = norm.money(a.totalEquity);
  const currentAssets = norm.money(a.currentAssets);
  const currentLiabilities = norm.money(a.currentLiabilities);
  const inventories = norm.money(a.inventories);
  const dividendsPaid = norm.money(a.dividendsPaid);

  // DERIVATIONS (guarded → null on missing/zero denom). assetTurnover prefers the
  // stored column, else derives revenue/totalAssets so the DuPont identity still closes.
  const roa = pctOf(netProfit, totalAssets);
  const currentRatio = round(divOrNull(currentAssets, currentLiabilities), 2);
  const quickRatio = round(
    divOrNull(currentAssets != null && inventories != null ? currentAssets - inventories : null, currentLiabilities),
    2,
  );
  const equityMultiplier = round(divOrNull(totalAssets, totalEquity), 2);
  const dividendPayout =
    netProfit != null && netProfit > 0 ? pctOf(absOrNull(dividendsPaid), netProfit) : null;
  const assetTurnover = norm.ratio(a.assetTurnover) ?? round(divOrNull(revenue, totalAssets), 4);
  const netMargin = norm.pct(a.netMargin);

  return {
    fiscalYear: a.fiscalYear,

    roe: norm.pct(a.roe),
    roce: norm.pct(a.roce),
    netMargin,
    operatingMargin: norm.pct(a.operatingMargin),
    roa,

    revenueGrowthYoy: norm.pct(a.revenueGrowthYoy),
    profitGrowthYoy: norm.pct(a.profitGrowthYoy),
    epsGrowthYoy: norm.pct(a.epsGrowthYoy),

    debtToEquity: norm.ratio(a.debtToEquity),
    interestCoverage: norm.ratio(a.interestCoverage),
    currentRatio,
    quickRatio,
    equityMultiplier,

    netProfit,
    fcf: norm.money(a.fcf),
    capex: norm.money(a.capex),
    cashFromOperating: norm.money(a.cashFromOperating),
    cashFromInvesting: norm.money(a.cashFromInvesting),
    cashFromFinancing: norm.money(a.cashFromFinancing),
    dividendPayout,

    basicEps: norm.ratio(a.basicEps),
    bookValuePerShare: norm.ratio(a.bookValuePerShare),

    totalAssets,
    totalEquity,
    currentAssets,
    currentLiabilities,
    inventories,
    totalDebt: norm.money(a.totalDebt),
    cashAndCashEquivalents: norm.money(a.cashAndCashEquivalents),

    dupont:
      netMargin == null && assetTurnover == null && equityMultiplier == null
        ? null
        : { netMargin, assetTurnover, equityMultiplier },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// banking family
//
// THE normalizer seam lives HERE, explicit and auditable — NOT in the normalizer.
// Banking stores ratio-like %s as FRACTIONS, so `makeNormalizer("banking").pct()`
// multiplies by 100. But a handful of stored fields are ALREADY percent (net_margin
// and every *_yoy / *_qoq growth field) — blanket-applying ×100 would render
// net_margin 21.40 as 2140%. Those pass through `round(toNum(raw), 2)` (passPct),
// never `norm.pct()`. The two field lists below are the contract; keep them honest.
// ─────────────────────────────────────────────────────────────────────────────
type BankingQuarterRow = {
  quarter: string;
  fiscalYear: string;
  reportDate: Date;
  auditPending: boolean;
  // P&L level (₹ Cr)
  interestEarned: unknown;
  interestExpended: unknown;
  nii: unknown;
  otherIncome: unknown;
  totalIncome: unknown;
  ppop: unknown;
  provisions: unknown;
  netProfit: unknown;
  netMargin: unknown; // ALREADY percent
  // asset quality (fraction)
  gnpaPct: unknown;
  nnpaPct: unknown;
  gnpaAbsolute: unknown;
  nnpaAbsolute: unknown;
  pcr: unknown;
  // capital (fraction)
  cet1Ratio: unknown;
  tier1Ratio: unknown;
  additionalTier1Ratio: unknown;
  // efficiency / returns (fraction)
  costToIncomeRatio: unknown;
  roaQuarterly: unknown;
  // growth (ALREADY percent)
  niiQoq: unknown;
  niiYoy: unknown;
  patQoq: unknown;
  patYoy: unknown;
};

type BankingAnnualRow = {
  fiscalYear: string;
  // profitability & efficiency (fraction)
  roe: unknown;
  roaDisclosed: unknown;
  netInterestMargin: unknown;
  costToIncomeRatio: unknown;
  creditCostPct: unknown;
  // earnings mix (₹ Cr)
  interestEarned: unknown;
  interestOnAdvances: unknown;
  revenueOnInvestments: unknown;
  // franchise (₹ Cr) + ratio (fraction)
  deposits: unknown;
  advances: unknown;
  investments: unknown;
  borrowings: unknown;
  creditDepositRatio: unknown;
  // franchise growth (ALREADY percent)
  depositGrowthYoy: unknown;
  advanceGrowthYoy: unknown;
  niiGrowthYoy: unknown;
  patGrowthYoy: unknown;
  assetGrowthYoy: unknown;
  // asset quality & capital (fraction)
  gnpaPct: unknown;
  nnpaPct: unknown;
  pcr: unknown;
  gnpaAbsolute: unknown;
  nnpaAbsolute: unknown;
  cet1Ratio: unknown;
  tier1Ratio: unknown;
  // balance sheet (₹ Cr)
  capital: unknown;
  reservesAndSurplus: unknown;
  netWorth: unknown;
  totalAssets: unknown;
  cashAndBalancesWithRbi: unknown;
  // per-share (₹)
  basicEps: unknown;
  bookValuePerShare: unknown;
  // cash flow (₹ Cr)
  cashFromOperating: unknown;
  cashFromInvesting: unknown;
  cashFromFinancing: unknown;
};

async function buildBanking(
  symbol: string,
  stockId: string,
  basis: Basis,
  basisAvailable: Basis[],
): Promise<{ payload: BankingPayload; historyDepth: { quarters: number; years: number }; notes: string[] }> {
  const norm = makeNormalizer("banking");

  // ── THE SEAM ────────────────────────────────────────────────────────────────
  // pct()    → fraction → percent (×100 via the family flag). Use for ratio fields.
  // passPct  → ALREADY percent → round only, NO ×100. Use for net_margin + growth.
  const pct = (raw: unknown) => norm.pct(raw); // gnpa, nnpa, pcr, cet1, tier1, roa, c/i, nim, …
  const passPct = (raw: unknown) => round(toNum(raw), 2); // net_margin, *_yoy, *_qoq (already %)

  const [quarterRows, annualRows, casa] = await Promise.all([
    prisma.bankingQuarterlyResult.findMany({
      where: { stockId, resultType: basis },
      orderBy: { reportDate: "asc" }, // oldest → newest (the spine)
      select: {
        quarter: true,
        fiscalYear: true,
        reportDate: true,
        auditPending: true,
        interestEarned: true,
        interestExpended: true,
        nii: true,
        otherIncome: true,
        totalIncome: true,
        ppop: true,
        provisions: true,
        netProfit: true,
        netMargin: true,
        gnpaPct: true,
        nnpaPct: true,
        gnpaAbsolute: true,
        nnpaAbsolute: true,
        pcr: true,
        cet1Ratio: true,
        tier1Ratio: true,
        additionalTier1Ratio: true,
        costToIncomeRatio: true,
        roaQuarterly: true,
        niiQoq: true,
        niiYoy: true,
        patQoq: true,
        patYoy: true,
      },
    }) as Promise<BankingQuarterRow[]>,
    prisma.bankingFundamental.findMany({
      where: { stockId, resultType: basis },
      orderBy: { reportDate: "desc" }, // newest first — [0] is the latest year
      select: {
        fiscalYear: true,
        roe: true,
        roaDisclosed: true,
        netInterestMargin: true,
        costToIncomeRatio: true,
        creditCostPct: true,
        interestEarned: true,
        interestOnAdvances: true,
        revenueOnInvestments: true,
        deposits: true,
        advances: true,
        investments: true,
        borrowings: true,
        creditDepositRatio: true,
        depositGrowthYoy: true,
        advanceGrowthYoy: true,
        niiGrowthYoy: true,
        patGrowthYoy: true,
        assetGrowthYoy: true,
        gnpaPct: true,
        nnpaPct: true,
        pcr: true,
        gnpaAbsolute: true,
        nnpaAbsolute: true,
        cet1Ratio: true,
        tier1Ratio: true,
        capital: true,
        reservesAndSurplus: true,
        netWorth: true,
        totalAssets: true,
        cashAndBalancesWithRbi: true,
        basicEps: true,
        bookValuePerShare: true,
        cashFromOperating: true,
        cashFromInvesting: true,
        cashFromFinancing: true,
      },
    }) as Promise<BankingAnnualRow[]>,
    // CASA (entered supplementary) — current tiered value + full quarter series, for display.
    // Symbol-keyed and basis-independent (CASA is standalone-only), so it rides the same
    // parallel fetch. Honest-empty for banks with no entered CASA.
    buildCasaDisplay(symbol),
  ]);

  // ── QUARTERLY EARNINGS SPINE ──────────────────────────────────────────────────
  // P&L-level fields run through zeroToNull (a ₹0 / 0.00% line in a real operating
  // quarter is a non-filing artifact → honest dash). Asset-quality & capital are an
  // honest NULL when auditPending — not yet final, NOT missing — never zeroToNull'd.
  const quarters: BankingQuarter[] = quarterRows.map((q) => {
    const aq = q.auditPending; // true → asset-quality + capital are not yet finalised → null
    return {
      periodKey: `${q.fiscalYear}${q.quarter}`, // "FY26" + "Q4" → "FY26Q4"
      reportDate: ymd(q.reportDate),
      auditPending: aq,

      // P&L spine (₹ Cr) — zeroToNull-guarded
      interestEarned: zeroToNull(norm.money(q.interestEarned)),
      interestExpended: zeroToNull(norm.money(q.interestExpended)),
      nii: zeroToNull(norm.money(q.nii)),
      otherIncome: zeroToNull(norm.money(q.otherIncome)),
      totalIncome: zeroToNull(norm.money(q.totalIncome)),
      ppop: zeroToNull(norm.money(q.ppop)),
      provisions: zeroToNull(norm.money(q.provisions)),
      netProfit: zeroToNull(norm.money(q.netProfit)),
      netMargin: zeroToNull(passPct(q.netMargin)), // ALREADY percent → NO ×100

      // asset quality (fraction→%); honest-null when audit-pending
      gnpaPct: aq ? null : pct(q.gnpaPct),
      nnpaPct: aq ? null : pct(q.nnpaPct),
      gnpaAbsolute: aq ? null : norm.money(q.gnpaAbsolute),
      nnpaAbsolute: aq ? null : norm.money(q.nnpaAbsolute),
      pcr: aq ? null : pct(q.pcr),

      // capital (fraction→%); honest-null when audit-pending
      cet1: aq ? null : pct(q.cet1Ratio),
      tier1: aq ? null : pct(q.tier1Ratio),
      additionalTier1: aq ? null : pct(q.additionalTier1Ratio),

      // efficiency / returns (fraction→%) — already null in DB when audit-pending
      costToIncome: pct(q.costToIncomeRatio),
      roaQuarterly: pct(q.roaQuarterly),

      // growth (ALREADY percent) — a genuine 0% is a real value, so NO zeroToNull
      niiQoq: passPct(q.niiQoq),
      niiYoy: passPct(q.niiYoy),
      patQoq: passPct(q.patQoq),
      patYoy: passPct(q.patYoy),
    };
  });

  // ── ANNUAL CONTEXT (latest year) ──────────────────────────────────────────────
  const a = annualRows[0] ?? null;
  const annual: BankingAnnual | null = a
    ? {
        fiscalYear: a.fiscalYear,

        // profitability & efficiency (fraction→%)
        roe: pct(a.roe),
        roaDisclosed: pct(a.roaDisclosed),
        nim: pct(a.netInterestMargin),
        costToIncome: pct(a.costToIncomeRatio),
        creditCostPct: pct(a.creditCostPct),

        // earnings mix (₹ Cr) — revenueOnInvestments is honest-null when not disclosed separately
        interestEarned: norm.money(a.interestEarned),
        interestOnAdvances: norm.money(a.interestOnAdvances),
        revenueOnInvestments: norm.money(a.revenueOnInvestments),

        // franchise (₹ Cr) + credit-deposit ratio (fraction→%)
        deposits: norm.money(a.deposits),
        advances: norm.money(a.advances),
        investments: norm.money(a.investments),
        borrowings: norm.money(a.borrowings),
        creditDepositRatio: pct(a.creditDepositRatio),

        // franchise growth (ALREADY percent → NO ×100)
        depositGrowthYoy: passPct(a.depositGrowthYoy),
        advanceGrowthYoy: passPct(a.advanceGrowthYoy),
        niiGrowthYoy: passPct(a.niiGrowthYoy),
        patGrowthYoy: passPct(a.patGrowthYoy),
        assetGrowthYoy: passPct(a.assetGrowthYoy),

        // asset quality & capital (fraction→%)
        gnpaPct: pct(a.gnpaPct),
        nnpaPct: pct(a.nnpaPct),
        pcr: pct(a.pcr),
        gnpaAbsolute: norm.money(a.gnpaAbsolute),
        nnpaAbsolute: norm.money(a.nnpaAbsolute),
        cet1: pct(a.cet1Ratio),
        tier1: pct(a.tier1Ratio),

        // balance-sheet snapshot (₹ Cr)
        capital: norm.money(a.capital),
        reservesAndSurplus: norm.money(a.reservesAndSurplus),
        netWorth: norm.money(a.netWorth),
        totalAssets: norm.money(a.totalAssets),
        cashAndBalancesWithRbi: norm.money(a.cashAndBalancesWithRbi),

        // per-share (₹)
        basicEps: norm.ratio(a.basicEps),
        bookValuePerShare: norm.ratio(a.bookValuePerShare),

        // cash flow (₹ Cr) — NO fcf/capex for banks
        cashFromOperating: norm.money(a.cashFromOperating),
        cashFromInvesting: norm.money(a.cashFromInvesting),
        cashFromFinancing: norm.money(a.cashFromFinancing),
      }
    : null;

  // ── RATIO HISTORY — headline annual ratios per year (oldest→newest) for the sparklines.
  // Per-stock gated downstream (≥ 3 real points). Audit-gated/thin banks simply show no spark.
  const bkAnnualOldestFirst = [...annualRows].reverse();
  const ratioHistory: BkRatioHistoryPoint[] = bkAnnualOldestFirst.map((r) => ({
    fiscalYear: r.fiscalYear,
    roe: pct(r.roe),
    nim: pct(r.netInterestMargin),
    costToIncome: pct(r.costToIncomeRatio),
    creditCostPct: pct(r.creditCostPct),
  }));

  const payload: BankingPayload = { quarters, annual, ratioHistory, casa };

  // ── honest data-state notes ───────────────────────────────────────────────────
  const years = annualRows.length;
  const notes: string[] = [];
  if (quarters.length === 0 && years === 0) {
    notes.push("No banking fundamentals have been reported for this bank yet.");
  } else {
    if (quarters.length > 0 && quarters.length < 4) {
      notes.push("Limited quarterly history — trend charts fill in as quarters accrue.");
    }
    if (years > 0 && years < 2) {
      notes.push(`Annual figures cover a single year on a ${basis} basis — year-over-year growth needs a prior year.`);
    }
  }
  // Audit-pending is an honest STATE on consolidated Q4 for some banks — surface it.
  if (basis === "consolidated" && quarters.some((q) => q.auditPending)) {
    notes.push(
      basisAvailable.includes("standalone")
        ? "Consolidated quarterly results are pending audit for some periods — asset-quality and capital ratios populate once finalised. Switch to standalone for fully reported figures."
        : "Consolidated quarterly results are pending audit for some periods — asset-quality and capital ratios populate once finalised.",
    );
  }
  if (basisAvailable.length === 2) {
    notes.push("Both standalone and consolidated results are available — toggle to switch basis.");
  }

  return { payload, historyDepth: { quarters: quarters.length, years }, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// NBFC family
//
// Same seam discipline as banking: the ×100 lives in the normalizer; WHICH fields
// skip it (already-percent) and WHICH are MULTIPLES (not percents at all) live here,
// explicit and commented. The NBFC twist vs banking: `borrowingsToEquity` is a leverage
// MULTIPLE (3.13×), NOT a percentage — it must NOT go through norm.pct() (that would
// render "313%", which is semantically wrong; leverage is read as a multiple, and it is
// the headline NBFC risk metric). NBFC quarterlies are P&L-only — no balance sheet, no
// audit-pending concept; the balance sheet is annual-only context.
// ─────────────────────────────────────────────────────────────────────────────
type NbfcQuarterRow = {
  quarter: string;
  fiscalYear: string;
  reportDate: Date;
  // P&L level (₹ Cr)
  revenue: unknown;
  interestIncome: unknown;
  feeAndCommissionIncome: unknown;
  financeCosts: unknown;
  impairmentOnFinancialInstruments: unknown;
  nii: unknown;
  netProfit: unknown;
  netMargin: unknown; // ALREADY percent
  // growth (ALREADY percent)
  revenueYoy: unknown;
  patYoy: unknown;
  revenueQoq: unknown;
  patQoq: unknown;
};

type NbfcAnnualRow = {
  fiscalYear: string;
  // profitability & spread (fraction)
  roe: unknown;
  nim: unknown;
  spread: unknown;
  costToIncomeRatio: unknown;
  creditCostPct: unknown;
  // leverage & capital
  borrowingsToEquity: unknown; // MULTIPLE — not a percent
  capitalToAssetsRatio: unknown; // fraction
  // franchise / funding (₹ Cr)
  loans: unknown;
  debtSecurities: unknown;
  borrowings: unknown;
  depositsLiabilities: unknown;
  // growth (ALREADY percent)
  aumGrowthYoy: unknown;
  revenueGrowthYoy: unknown;
  patGrowthYoy: unknown;
  // balance sheet (₹ Cr)
  totalAssets: unknown;
  totalEquity: unknown;
  netWorth: unknown;
  investments: unknown;
  cashAndCashEquivalents: unknown;
  // per-share (₹)
  basicEps: unknown;
  bookValuePerShare: unknown;
  // cash flow (₹ Cr)
  cashFromOperating: unknown;
  cashFromInvesting: unknown;
  cashFromFinancing: unknown;
};

async function buildNbfc(
  stockId: string,
  basis: Basis,
  basisAvailable: Basis[],
): Promise<{ payload: NbfcPayload; historyDepth: { quarters: number; years: number }; notes: string[] }> {
  const norm = makeNormalizer("nbfc");

  // ── THE SEAM ────────────────────────────────────────────────────────────────
  // pct()    → fraction → percent (×100). Use for: nim, spread, creditCostPct,
  //            costToIncomeRatio, capitalToAssetsRatio, roe.
  // passPct  → ALREADY percent → round only, NO ×100. Use for: netMargin + every
  //            *_yoy / *_qoq growth field (incl. aumGrowthYoy).
  // borrowingsToEquity is NEITHER — it's a MULTIPLE (3.13×); route it through
  // norm.ratio() like a per-share/ratio field. NEVER norm.pct() (that = "313%").
  const pct = (raw: unknown) => norm.pct(raw);
  const passPct = (raw: unknown) => round(toNum(raw), 2);

  const [quarterRows, annualRows] = await Promise.all([
    prisma.nbfcQuarterlyResult.findMany({
      where: { stockId, resultType: basis },
      orderBy: { reportDate: "asc" }, // oldest → newest (the spine)
      select: {
        quarter: true,
        fiscalYear: true,
        reportDate: true,
        revenue: true,
        interestIncome: true,
        feeAndCommissionIncome: true,
        financeCosts: true,
        impairmentOnFinancialInstruments: true,
        nii: true,
        netProfit: true,
        netMargin: true,
        revenueYoy: true,
        patYoy: true,
        revenueQoq: true,
        patQoq: true,
      },
    }) as Promise<NbfcQuarterRow[]>,
    prisma.nbfcFundamental.findMany({
      where: { stockId, resultType: basis },
      orderBy: { reportDate: "desc" }, // newest first — [0] is the latest year
      select: {
        fiscalYear: true,
        roe: true,
        nim: true,
        spread: true,
        costToIncomeRatio: true,
        creditCostPct: true,
        borrowingsToEquity: true,
        capitalToAssetsRatio: true,
        loans: true,
        debtSecurities: true,
        borrowings: true,
        depositsLiabilities: true,
        aumGrowthYoy: true,
        revenueGrowthYoy: true,
        patGrowthYoy: true,
        totalAssets: true,
        totalEquity: true,
        netWorth: true,
        investments: true,
        cashAndCashEquivalents: true,
        basicEps: true,
        bookValuePerShare: true,
        cashFromOperating: true,
        cashFromInvesting: true,
        cashFromFinancing: true,
      },
    }) as Promise<NbfcAnnualRow[]>,
  ]);

  // ── QUARTERLY EARNINGS SPINE (P&L only — no BS) ───────────────────────────────
  // P&L-level fields run through zeroToNull (a ₹0 / 0.00% line in a real operating
  // quarter is a non-filing artifact → honest dash). Growth is passed faithfully.
  const quarters: NbfcQuarter[] = quarterRows.map((q) => ({
    periodKey: `${q.fiscalYear}${q.quarter}`, // "FY26" + "Q4" → "FY26Q4"
    reportDate: ymd(q.reportDate),

    revenue: zeroToNull(norm.money(q.revenue)),
    interestIncome: zeroToNull(norm.money(q.interestIncome)),
    feeAndCommissionIncome: zeroToNull(norm.money(q.feeAndCommissionIncome)),
    financeCosts: zeroToNull(norm.money(q.financeCosts)),
    impairmentOnFinancialInstruments: zeroToNull(norm.money(q.impairmentOnFinancialInstruments)),
    nii: zeroToNull(norm.money(q.nii)),
    netProfit: zeroToNull(norm.money(q.netProfit)),
    netMargin: zeroToNull(passPct(q.netMargin)), // ALREADY percent → NO ×100

    // growth (ALREADY percent) — a genuine 0% is a real value, so NO zeroToNull
    revenueYoy: passPct(q.revenueYoy),
    patYoy: passPct(q.patYoy),
    revenueQoq: passPct(q.revenueQoq),
    patQoq: passPct(q.patQoq),
  }));

  // ── ANNUAL CONTEXT (latest year) — the balance sheet lives here ───────────────
  const a = annualRows[0] ?? null;
  const annual: NbfcAnnual | null = a
    ? {
        fiscalYear: a.fiscalYear,

        // profitability & spread (fraction→%)
        roe: pct(a.roe),
        nim: pct(a.nim),
        spread: pct(a.spread),
        costToIncomeRatio: pct(a.costToIncomeRatio),
        creditCostPct: pct(a.creditCostPct),

        // leverage & capital — borrowingsToEquity is a MULTIPLE (×), capitalToAssets a %
        borrowingsToEquity: norm.ratio(a.borrowingsToEquity, 2),
        capitalToAssetsRatio: pct(a.capitalToAssetsRatio),

        // franchise / funding (₹ Cr). A 0 (or null) deposit balance means a NON-deposit
        // -taking NBFC — honest-empty it (zeroToNull) so it never reads as a real "₹0 Cr
        // deposit franchise". This is the one BS field where 0 == absence, not a value.
        loans: norm.money(a.loans),
        debtSecurities: norm.money(a.debtSecurities),
        borrowings: norm.money(a.borrowings),
        depositsLiabilities: zeroToNull(norm.money(a.depositsLiabilities)),

        // growth (ALREADY percent → NO ×100)
        aumGrowthYoy: passPct(a.aumGrowthYoy),
        revenueGrowthYoy: passPct(a.revenueGrowthYoy),
        patGrowthYoy: passPct(a.patGrowthYoy),

        // balance-sheet snapshot (₹ Cr)
        totalAssets: norm.money(a.totalAssets),
        totalEquity: norm.money(a.totalEquity),
        netWorth: norm.money(a.netWorth),
        investments: norm.money(a.investments),
        cashAndCashEquivalents: norm.money(a.cashAndCashEquivalents),

        // per-share (₹)
        basicEps: norm.ratio(a.basicEps),
        bookValuePerShare: norm.ratio(a.bookValuePerShare),

        // cash flow (₹ Cr) — NO fcf/capex for NBFCs
        cashFromOperating: norm.money(a.cashFromOperating),
        cashFromInvesting: norm.money(a.cashFromInvesting),
        cashFromFinancing: norm.money(a.cashFromFinancing),
      }
    : null;

  const payload: NbfcPayload = { quarters, annual };

  // ── honest data-state notes ───────────────────────────────────────────────────
  const years = annualRows.length;
  const notes: string[] = [];
  if (quarters.length === 0 && years === 0) {
    notes.push("No NBFC fundamentals have been reported for this company yet.");
  } else {
    if (quarters.length > 0 && quarters.length < 4) {
      notes.push("Limited quarterly history — trend charts fill in as quarters accrue.");
    }
    if (years > 0 && years < 2) {
      notes.push(`Annual figures cover a single year on a ${basis} basis — year-over-year growth needs a prior year.`);
    }
  }
  if (a && annual && annual.depositsLiabilities == null) {
    notes.push("This is a non-deposit-taking NBFC — it funds its book through borrowings and debt securities, not customer deposits.");
  }
  if (basisAvailable.length === 2) {
    notes.push("Both consolidated and standalone results are available — toggle to switch basis.");
  }

  return { payload, historyDepth: { quarters: quarters.length, years }, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// LIFE INSURANCE family
//
// Same seam discipline as banking/nbfc: the ×100 lives in the normalizer; WHICH
// fields skip it (already-percent) and WHICH are MULTIPLES (not percents at all) live
// here, explicit and commented. Two life-specific twists:
//   • solvencyRatio is a MULTIPLE (1.90×) read against the IRDAI 150% (=1.5×) floor, NOT
//     a percent. Insurers file it on two scales (some store 1.77 directly, others store
//     0.019 = multiple÷100), so it goes through normalizeSolvency() — a band test, not
//     norm.pct() — and DISPLAYS with ×.
//   • PERSISTENCY GUARD: persistency is fraction-form (×100→%), correct for HDFCLIFE/
//     ICICIPRULI/LICI (0.59–0.89 → 59–89%). SBILIFE has a confirmed source-XBRL
//     discrepancy — values stored ~100× too small (0.0088 → would render 0.88%). Any
//     raw persistency < 0.05 is suspect → return null (honest "—"), and push a note.
//     We do NOT apply a corrective multiplier — the filing value is wrong at source.
// incomeFromInvestments / changeInValuationOfLiabilities can be legitimately NEGATIVE
// (policyholder-fund mark-to-market) — passed through as-is, never zero-stripped.
// ─────────────────────────────────────────────────────────────────────────────
type LiQuarterRow = {
  quarter: string;
  fiscalYear: string;
  reportDate: Date;
  // P&L level (₹ Cr)
  netPremiumIncome: unknown;
  grossPremiumIncome: unknown;
  incomeFirstYearPremium: unknown;
  incomeRenewalPremium: unknown;
  incomeSinglePremium: unknown;
  incomeFromInvestments: unknown; // CAN BE NEGATIVE
  benefitsPaidNet: unknown;
  changeInValuationOfLiabilities: unknown; // can be negative
  netProfit: unknown;
  netMargin: unknown; // ALREADY percent
  // disclosed ratios
  solvencyRatio: unknown; // MULTIPLE (fraction→number, display ×)
  persistencyRatio13Month: unknown; // fraction→% (guarded)
  // growth (ALREADY percent)
  premiumQoq: unknown;
  premiumYoy: unknown;
  patQoq: unknown;
  patYoy: unknown;
};

type LiAnnualRow = {
  fiscalYear: string;
  // profitability & disclosed ratios
  roe: unknown; // fraction
  solvencyRatio: unknown; // MULTIPLE
  newBusinessPremiumPct: unknown; // fraction
  expenseRatioPolicyholders: unknown; // fraction
  persistencyRatio13Month: unknown; // fraction (guarded)
  persistencyRatio25Month: unknown;
  persistencyRatio37Month: unknown;
  persistencyRatio49Month: unknown;
  persistencyRatio61Month: unknown;
  // premium mix (₹ Cr)
  incomeFirstYearPremium: unknown;
  incomeRenewalPremium: unknown;
  incomeSinglePremium: unknown;
  // growth (ALREADY percent)
  premiumGrowthYoy: unknown;
  patGrowthYoy: unknown;
  // balance sheet (₹ Cr)
  policyholdersFunds: unknown;
  assetsHeldToCoverLinkedLiabilities: unknown;
  investmentsShareholders: unknown;
  investmentsPolicyholders: unknown;
  shareCapital: unknown;
  reservesAndSurplus: unknown;
  netWorth: unknown;
  totalAssets: unknown;
  // per-share (₹)
  basicEps: unknown;
  bookValuePerShare: unknown;
};

/** Persistency is fraction-form → %, but the SBILIFE source filing stores values ~100×
 *  too small. raw < 0.05 (i.e. would render < 5%, implausible for any persistency cohort
 *  — industry floor is ~55%) is treated as a source discrepancy → null. NEVER a
 *  corrective multiplier; the truth is "unavailable" until a re-ingest fixes the filing. */
const PERSISTENCY_SUSPECT_FLOOR = 0.05;

async function buildLifeInsurance(
  stockId: string,
  basis: Basis,
  basisAvailable: Basis[],
): Promise<{ payload: LifeInsurancePayload; historyDepth: { quarters: number; years: number }; notes: string[] }> {
  const norm = makeNormalizer("life_insurance");

  // ── THE SEAM ────────────────────────────────────────────────────────────────
  // pct()     → fraction → percent (×100). Use for: roe, newBusinessPremiumPct,
  //             expenseRatioPolicyholders.
  // passPct   → ALREADY percent → round only, NO ×100. Use for: netMargin + every
  //             *_yoy / *_qoq / *GrowthYoy field.
  // solvencyRatio is a MULTIPLE (1.90×): normalizeSolvency() band-tests the two filing
  //             scales (0.019→1.9 vs 1.77→1.77) and is DISPLAYED with ×, not %.
  // persistency() applies the suspect-value guard BEFORE the ×100.
  const pct = (raw: unknown) => norm.pct(raw);
  const passPct = (raw: unknown) => round(toNum(raw), 2);
  let persistencySuspect = false;
  const persistency = (raw: unknown): number | null => {
    const n = toNum(raw);
    if (n == null) return null;
    if (n < PERSISTENCY_SUSPECT_FLOOR) {
      persistencySuspect = true; // source-filing discrepancy — surface in notes
      return null;
    }
    return pct(raw);
  };

  const [quarterRows, annualRows] = await Promise.all([
    prisma.lifeInsuranceQuarterlyResult.findMany({
      where: { stockId, resultType: basis },
      orderBy: { reportDate: "asc" }, // oldest → newest (the spine)
      select: {
        quarter: true,
        fiscalYear: true,
        reportDate: true,
        netPremiumIncome: true,
        grossPremiumIncome: true,
        incomeFirstYearPremium: true,
        incomeRenewalPremium: true,
        incomeSinglePremium: true,
        incomeFromInvestments: true,
        benefitsPaidNet: true,
        changeInValuationOfLiabilities: true,
        netProfit: true,
        netMargin: true,
        solvencyRatio: true,
        persistencyRatio13Month: true,
        premiumQoq: true,
        premiumYoy: true,
        patQoq: true,
        patYoy: true,
      },
    }) as Promise<LiQuarterRow[]>,
    prisma.lifeInsuranceFundamental.findMany({
      where: { stockId, resultType: basis },
      orderBy: { reportDate: "desc" }, // newest first — [0] is the latest year
      select: {
        fiscalYear: true,
        roe: true,
        solvencyRatio: true,
        newBusinessPremiumPct: true,
        expenseRatioPolicyholders: true,
        persistencyRatio13Month: true,
        persistencyRatio25Month: true,
        persistencyRatio37Month: true,
        persistencyRatio49Month: true,
        persistencyRatio61Month: true,
        incomeFirstYearPremium: true,
        incomeRenewalPremium: true,
        incomeSinglePremium: true,
        premiumGrowthYoy: true,
        patGrowthYoy: true,
        policyholdersFunds: true,
        assetsHeldToCoverLinkedLiabilities: true,
        investmentsShareholders: true,
        investmentsPolicyholders: true,
        shareCapital: true,
        reservesAndSurplus: true,
        netWorth: true,
        totalAssets: true,
        basicEps: true,
        bookValuePerShare: true,
      },
    }) as Promise<LiAnnualRow[]>,
  ]);

  // ── QUARTERLY EARNINGS SPINE ──────────────────────────────────────────────────
  // P&L-level fields run through zeroToNull (a ₹0 / 0.00% line in a real operating
  // quarter is a non-filing artifact → honest dash). incomeFromInvestments and
  // changeInValuationOfLiabilities are NOT zero-stripped — they swing negative on
  // mark-to-market and a near-zero reading there is legitimate. Growth passed faithfully.
  const quarters: LifeInsuranceQuarter[] = quarterRows.map((q) => ({
    periodKey: `${q.fiscalYear}${q.quarter}`, // "FY26" + "Q4" → "FY26Q4"
    reportDate: ymd(q.reportDate),

    netPremiumIncome: zeroToNull(norm.money(q.netPremiumIncome)),
    grossPremiumIncome: zeroToNull(norm.money(q.grossPremiumIncome)),
    // premium mix — a genuine ₹0 in a sub-line (e.g. an insurer with no single-premium book)
    // is a real component, so these are NOT zeroToNull'd; they sum back to gross premium.
    incomeFirstYearPremium: norm.money(q.incomeFirstYearPremium),
    incomeRenewalPremium: norm.money(q.incomeRenewalPremium),
    incomeSinglePremium: norm.money(q.incomeSinglePremium),
    incomeFromInvestments: norm.money(q.incomeFromInvestments), // can be negative — preserve
    benefitsPaidNet: zeroToNull(norm.money(q.benefitsPaidNet)),
    changeInValuationOfLiabilities: norm.money(q.changeInValuationOfLiabilities), // can be negative
    netProfit: zeroToNull(norm.money(q.netProfit)),
    netMargin: zeroToNull(passPct(q.netMargin)), // ALREADY percent → NO ×100

    solvencyRatio: normalizeSolvency(q.solvencyRatio), // MULTIPLE — display ×, NOT %
    persistency13M: persistency(q.persistencyRatio13Month), // guarded

    // growth (ALREADY percent) — a genuine 0% is a real value, so NO zeroToNull
    premiumQoq: passPct(q.premiumQoq),
    premiumYoy: passPct(q.premiumYoy),
    patQoq: passPct(q.patQoq),
    patYoy: passPct(q.patYoy),
  }));

  // ── ANNUAL CONTEXT (latest year) ──────────────────────────────────────────────
  const a = annualRows[0] ?? null;
  const annual: LifeInsuranceAnnual | null = a
    ? {
        fiscalYear: a.fiscalYear,

        // profitability & disclosed ratios
        roe: pct(a.roe),
        solvencyRatio: normalizeSolvency(a.solvencyRatio), // MULTIPLE — display ×
        newBusinessPremiumPct: pct(a.newBusinessPremiumPct),
        expenseRatioPolicyholders: pct(a.expenseRatioPolicyholders),
        persistency: {
          m13: persistency(a.persistencyRatio13Month),
          m25: persistency(a.persistencyRatio25Month),
          m37: persistency(a.persistencyRatio37Month),
          m49: persistency(a.persistencyRatio49Month),
          m61: persistency(a.persistencyRatio61Month),
        },

        // premium mix (₹ Cr) — the three lines sum to gross premium
        incomeFirstYearPremium: norm.money(a.incomeFirstYearPremium),
        incomeRenewalPremium: norm.money(a.incomeRenewalPremium),
        incomeSinglePremium: norm.money(a.incomeSinglePremium),

        // growth (ALREADY percent → NO ×100)
        premiumGrowthYoy: passPct(a.premiumGrowthYoy),
        patGrowthYoy: passPct(a.patGrowthYoy),

        // balance sheet (₹ Cr) — policyholders' fund dominates
        policyholdersFunds: norm.money(a.policyholdersFunds),
        assetsHeldToCoverLinkedLiabilities: norm.money(a.assetsHeldToCoverLinkedLiabilities),
        investmentsShareholders: norm.money(a.investmentsShareholders),
        investmentsPolicyholders: norm.money(a.investmentsPolicyholders),
        shareCapital: norm.money(a.shareCapital),
        reservesAndSurplus: norm.money(a.reservesAndSurplus),
        netWorth: norm.money(a.netWorth),
        totalAssets: norm.money(a.totalAssets),

        // per-share (₹)
        basicEps: norm.ratio(a.basicEps),
        bookValuePerShare: norm.ratio(a.bookValuePerShare),
      }
    : null;

  // ── RATIO HISTORY — solvency (×) + 13-month persistency (guarded %) per year, oldest→
  // newest, for the sparklines. Reuses the same guard/band-test as the headline cards.
  const liAnnualOldestFirst = [...annualRows].reverse();
  const ratioHistory: LiRatioHistoryPoint[] = liAnnualOldestFirst.map((r) => ({
    fiscalYear: r.fiscalYear,
    solvencyRatio: normalizeSolvency(r.solvencyRatio),
    persistency13M: persistency(r.persistencyRatio13Month),
  }));

  const payload: LifeInsurancePayload = { quarters, annual, ratioHistory };

  // ── honest data-state notes ───────────────────────────────────────────────────
  const years = annualRows.length;
  const notes: string[] = [];
  if (quarters.length === 0 && years === 0) {
    notes.push("No life-insurance fundamentals have been reported for this company yet.");
  } else {
    // These families are structurally thin (5 quarters / 2 years) — say so plainly so the
    // tab suppresses trend visuals rather than drawing a misleading 2–5 point line.
    notes.push(`Limited history — ${quarters.length} quarter${quarters.length === 1 ? "" : "s"} available; trend charts are suppressed until more periods accrue.`);
    if (years > 0 && years < 2) {
      notes.push(`Annual figures cover a single year on a ${basis} basis — year-over-year growth needs a prior year.`);
    }
  }
  if (persistencySuspect) {
    notes.push("Persistency data unavailable — a discrepancy in the source filing makes the reported persistency ratios unreliable, so they are shown as unavailable rather than misstated.");
  }
  if (basisAvailable.length === 2) {
    notes.push("Both standalone and consolidated results are available — toggle to switch basis.");
  }

  return { payload, historyDepth: { quarters: quarters.length, years }, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERAL INSURANCE family
//
// Combined-ratio / underwriting accounting — a different statement from life. Same seam
// discipline. The GI-specific points:
//   • combinedRatio is a PERCENT that CAN EXCEED 100 (claims + expenses ÷ premium; above
//     100 = an underwriting loss before investment income). Route through pct() like any
//     fraction-stored ratio; it is a fact, not a verdict.
//   • netUnderwritingMargin and underwritingProfitOrLoss can be NEGATIVE — preserved.
//   • solvencyRatio is a MULTIPLE (2.67×) via normalizeSolvency() (ICICIGI files 0.0267 =
//     multiple÷100), displayed with ×.
//   • The BS `investments` line is its OWN figure — NOT reconciled against totalAssets (a
//     GI accounting convention; do not cross-derive). Many XBRL columns are honestly null.
// ─────────────────────────────────────────────────────────────────────────────
type GiQuarterRow = {
  quarter: string;
  fiscalYear: string;
  reportDate: Date;
  // P&L level (₹ Cr)
  grossPremiumsWritten: unknown;
  netPremium: unknown;
  premiumEarned: unknown;
  incurredClaims: unknown;
  netCommission: unknown;
  underwritingProfitOrLoss: unknown; // CAN BE NEGATIVE
  netProfit: unknown;
  netMargin: unknown; // ALREADY percent
  // underwriting ratios (fraction)
  combinedRatio: unknown; // can exceed 100 after ×100
  incurredClaimRatio: unknown;
  expensesOfManagementRatio: unknown;
  netRetentionRatio: unknown;
  netUnderwritingMargin: unknown; // can be negative
  solvencyRatio: unknown; // MULTIPLE
  // growth (ALREADY percent)
  gpwQoq: unknown;
  gpwYoy: unknown;
  patQoq: unknown;
  patYoy: unknown;
};

type GiAnnualRow = {
  fiscalYear: string;
  // profitability & disclosed ratios
  roe: unknown; // fraction
  solvencyRatio: unknown; // MULTIPLE
  combinedRatio: unknown;
  incurredClaimRatio: unknown;
  expensesOfManagementRatio: unknown;
  netRetentionRatio: unknown;
  netUnderwritingMargin: unknown; // can be negative
  // growth (ALREADY percent)
  gpwGrowthYoy: unknown;
  patGrowthYoy: unknown;
  // reserve adequacy (₹ Cr)
  premiumDeficiency: unknown;
  // balance sheet (₹ Cr)
  investments: unknown;
  totalAssets: unknown;
  shareCapital: unknown;
  reservesAndSurplus: unknown;
  netWorth: unknown;
  // per-share (₹)
  basicEps: unknown;
  bookValuePerShare: unknown;
};

async function buildGeneralInsurance(
  stockId: string,
  basis: Basis,
  basisAvailable: Basis[],
): Promise<{ payload: GeneralInsurancePayload; historyDepth: { quarters: number; years: number }; notes: string[] }> {
  const norm = makeNormalizer("general_insurance");

  // ── THE SEAM ────────────────────────────────────────────────────────────────
  // pct()    → fraction → percent (×100). Use for: combinedRatio (can exceed 100),
  //            incurredClaimRatio, expensesOfManagementRatio, netRetentionRatio,
  //            netUnderwritingMargin (can be negative), roe.
  // passPct  → ALREADY percent → round only, NO ×100. Use for: netMargin + every
  //            *_yoy / *_qoq / *GrowthYoy field.
  // solvencyRatio is a MULTIPLE (2.67×) via normalizeSolvency() (band test); displayed ×.
  const pct = (raw: unknown) => norm.pct(raw);
  const passPct = (raw: unknown) => round(toNum(raw), 2);

  const [quarterRows, annualRows] = await Promise.all([
    prisma.generalInsuranceQuarterlyResult.findMany({
      where: { stockId, resultType: basis },
      orderBy: { reportDate: "asc" }, // oldest → newest (the spine)
      select: {
        quarter: true,
        fiscalYear: true,
        reportDate: true,
        grossPremiumsWritten: true,
        netPremium: true,
        premiumEarned: true,
        incurredClaims: true,
        netCommission: true,
        underwritingProfitOrLoss: true,
        netProfit: true,
        netMargin: true,
        combinedRatio: true,
        incurredClaimRatio: true,
        expensesOfManagementRatio: true,
        netRetentionRatio: true,
        netUnderwritingMargin: true,
        solvencyRatio: true,
        gpwQoq: true,
        gpwYoy: true,
        patQoq: true,
        patYoy: true,
      },
    }) as Promise<GiQuarterRow[]>,
    prisma.generalInsuranceFundamental.findMany({
      where: { stockId, resultType: basis },
      orderBy: { reportDate: "desc" }, // newest first — [0] is the latest year
      select: {
        fiscalYear: true,
        roe: true,
        solvencyRatio: true,
        combinedRatio: true,
        incurredClaimRatio: true,
        expensesOfManagementRatio: true,
        netRetentionRatio: true,
        netUnderwritingMargin: true,
        gpwGrowthYoy: true,
        patGrowthYoy: true,
        premiumDeficiency: true,
        investments: true,
        totalAssets: true,
        shareCapital: true,
        reservesAndSurplus: true,
        netWorth: true,
        basicEps: true,
        bookValuePerShare: true,
      },
    }) as Promise<GiAnnualRow[]>,
  ]);

  // ── QUARTERLY EARNINGS SPINE ──────────────────────────────────────────────────
  // P&L-level fields run through zeroToNull. underwritingProfitOrLoss is NOT
  // zero-stripped — it runs negative when claims+expenses outrun earned premium, the
  // norm for a GI book that earns on investment income. Ratios pass through pct()
  // (combinedRatio can exceed 100, netUnderwritingMargin can be negative — both real).
  const quarters: GeneralInsuranceQuarter[] = quarterRows.map((q) => ({
    periodKey: `${q.fiscalYear}${q.quarter}`, // "FY26" + "Q4" → "FY26Q4"
    reportDate: ymd(q.reportDate),

    grossPremiumsWritten: zeroToNull(norm.money(q.grossPremiumsWritten)),
    netPremium: zeroToNull(norm.money(q.netPremium)),
    premiumEarned: zeroToNull(norm.money(q.premiumEarned)),
    incurredClaims: zeroToNull(norm.money(q.incurredClaims)),
    netCommission: zeroToNull(norm.money(q.netCommission)),
    underwritingProfitOrLoss: norm.money(q.underwritingProfitOrLoss), // can be negative — preserve
    netProfit: zeroToNull(norm.money(q.netProfit)),
    netMargin: zeroToNull(passPct(q.netMargin)), // ALREADY percent → NO ×100

    combinedRatio: pct(q.combinedRatio), // % — CAN EXCEED 100
    incurredClaimRatio: pct(q.incurredClaimRatio),
    expensesOfManagementRatio: pct(q.expensesOfManagementRatio),
    netRetentionRatio: pct(q.netRetentionRatio),
    netUnderwritingMargin: pct(q.netUnderwritingMargin), // can be negative
    solvencyRatio: normalizeSolvency(q.solvencyRatio), // MULTIPLE — display ×

    // growth (ALREADY percent) — a genuine 0% is a real value, so NO zeroToNull
    gpwQoq: passPct(q.gpwQoq),
    gpwYoy: passPct(q.gpwYoy),
    patQoq: passPct(q.patQoq),
    patYoy: passPct(q.patYoy),
  }));

  // ── ANNUAL CONTEXT (latest year) ──────────────────────────────────────────────
  const a = annualRows[0] ?? null;
  const annual: GeneralInsuranceAnnual | null = a
    ? {
        fiscalYear: a.fiscalYear,

        // profitability & disclosed underwriting ratios
        roe: pct(a.roe),
        solvencyRatio: normalizeSolvency(a.solvencyRatio), // MULTIPLE — display ×
        combinedRatio: pct(a.combinedRatio), // % — can exceed 100
        incurredClaimRatio: pct(a.incurredClaimRatio),
        expensesOfManagementRatio: pct(a.expensesOfManagementRatio),
        netRetentionRatio: pct(a.netRetentionRatio),
        netUnderwritingMargin: pct(a.netUnderwritingMargin), // can be negative

        // growth (ALREADY percent → NO ×100)
        gpwGrowthYoy: passPct(a.gpwGrowthYoy),
        patGrowthYoy: passPct(a.patGrowthYoy),

        // reserve adequacy (₹ Cr) — 0 is a real value (no deficiency reserve required), NOT
        // zeroToNull'd; a positive figure flags pricing that doesn't cover expected claims.
        premiumDeficiency: norm.money(a.premiumDeficiency),

        // balance sheet (₹ Cr) — investments is its OWN line; do NOT reconcile to totalAssets
        investments: norm.money(a.investments),
        totalAssets: norm.money(a.totalAssets),
        shareCapital: norm.money(a.shareCapital),
        reservesAndSurplus: norm.money(a.reservesAndSurplus),
        netWorth: norm.money(a.netWorth),

        // per-share (₹)
        basicEps: norm.ratio(a.basicEps),
        bookValuePerShare: norm.ratio(a.bookValuePerShare),
      }
    : null;

  const payload: GeneralInsurancePayload = { quarters, annual };

  // ── honest data-state notes ───────────────────────────────────────────────────
  const years = annualRows.length;
  const notes: string[] = [];
  if (quarters.length === 0 && years === 0) {
    notes.push("No general-insurance fundamentals have been reported for this company yet.");
  } else {
    notes.push(`Limited history — ${quarters.length} quarter${quarters.length === 1 ? "" : "s"} available; trend charts are suppressed until more periods accrue.`);
    if (years > 0 && years < 2) {
      notes.push(`Annual figures cover a single year on a ${basis} basis — year-over-year growth needs a prior year.`);
    }
  }
  if (basisAvailable.length === 2) {
    notes.push("Both standalone and consolidated results are available — toggle to switch basis.");
  }

  return { payload, historyDepth: { quarters: quarters.length, years }, notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────
const absOrNull = (x: number | null): number | null => (x == null ? null : Math.abs(x));

/** Solvency ratio is a regulatory MULTIPLE (IRDAI floor 1.5×). Insurers file it on TWO
 *  scales: some store the multiple directly (HDFCLIFE 1.77, ICICIPRULI 2.27), others
 *  store multiple÷100 (SBILIFE 0.019, LICI 0.0235, ICICIGI 0.0267). The two bands sit
 *  ~2 orders of magnitude apart (≤0.05 vs ≥1.5) and BOTH invert to the same
 *  regulation-valid 1.5–2.7× range, so a band test cleanly canonicalizes to the
 *  multiple. The 0.5 threshold is safe with huge margin: the IRDAI 1.5× floor means no
 *  real multiple is anywhere near 0.5, and no fraction-form value exceeds ~0.05. Display
 *  the result with ×, never %.
 *
 *  (This is RESOLVABLE where persistency was not: SBILIFE's persistency can't be
 *  recovered by the ×100 that works for the other insurers — it would need a different,
 *  guessed multiplier — so persistency stays null. Solvency's two bands each invert by a
 *  fixed, regulation-anchored rule to matching public figures, so it canonicalizes.) */
function normalizeSolvency(raw: unknown): number | null {
  const n = toNum(raw);
  if (n == null) return null;
  return round(n < 0.5 ? n * 100 : n, 2);
}

/** The bases that have at least one row (quarterly OR annual), ordered consolidated→
 *  standalone. Family-aware: a bank's rows live in the banking tables, not the
 *  non_financial ones, so the basis toggle reads from the right source per family. */
async function resolveBasisAvailable(stockId: string, family: IndustryFamily): Promise<Basis[]> {
  const [qb, ab] =
    family === "banking"
      ? await Promise.all([
          prisma.bankingQuarterlyResult.findMany({ where: { stockId }, distinct: ["resultType"], select: { resultType: true } }),
          prisma.bankingFundamental.findMany({ where: { stockId }, distinct: ["resultType"], select: { resultType: true } }),
        ])
      : family === "nbfc"
        ? await Promise.all([
            prisma.nbfcQuarterlyResult.findMany({ where: { stockId }, distinct: ["resultType"], select: { resultType: true } }),
            prisma.nbfcFundamental.findMany({ where: { stockId }, distinct: ["resultType"], select: { resultType: true } }),
          ])
        : family === "life_insurance"
          ? await Promise.all([
              prisma.lifeInsuranceQuarterlyResult.findMany({ where: { stockId }, distinct: ["resultType"], select: { resultType: true } }),
              prisma.lifeInsuranceFundamental.findMany({ where: { stockId }, distinct: ["resultType"], select: { resultType: true } }),
            ])
          : family === "general_insurance"
            ? await Promise.all([
                prisma.generalInsuranceQuarterlyResult.findMany({ where: { stockId }, distinct: ["resultType"], select: { resultType: true } }),
                prisma.generalInsuranceFundamental.findMany({ where: { stockId }, distinct: ["resultType"], select: { resultType: true } }),
              ])
            : await Promise.all([
                prisma.quarterlyResult.findMany({ where: { stockId }, distinct: ["resultType"], select: { resultType: true } }),
                prisma.fundamental.findMany({ where: { stockId }, distinct: ["resultType"], select: { resultType: true } }),
              ]);
  const present = new Set<string>([...qb, ...ab].map((r) => r.resultType));
  return ALL_BASES.filter((b) => present.has(b));
}

/** Requested basis if it has data; else the family's preferred default if available;
 *  else the only available basis; else the preferred default (stable even with no rows). */
function chooseBasis(requested: Basis | undefined, available: Basis[], preferred: Basis = "consolidated"): Basis {
  if (requested && available.includes(requested)) return requested;
  if (available.includes(preferred)) return preferred;
  return available[0] ?? preferred;
}

function familyLabel(family: IndustryFamily): string {
  switch (family) {
    case "banking":
      return "banking";
    case "nbfc":
      return "NBFC";
    case "life_insurance":
      return "life-insurance";
    case "general_insurance":
      return "general-insurance";
    default:
      return "non-financial";
  }
}
