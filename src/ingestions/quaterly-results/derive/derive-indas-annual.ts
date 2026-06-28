// ─────────────────────────────────────────────────────────────
// PURE derivation for Fundamental (Ind-AS annual) — the deriveFromRow bridge.
//
// This is a VERBATIM EXTRACTION of the derivation block previously inline in
// ingest-indas-annual.ts. NOTHING about the math changed (CN-8: a refactor
// never alters derivation logic). The ingester now CALLS this, so normal
// ingestion and a raw-field fill derive through the SAME code — one path.
//
// INPUTS are plain numbers (the parser already yields number|null; the fill
// path passes row.col.toNumber()). The prior-year inputs come from the prior
// STORED row — exactly as the inline block did (it read priorRow from the DB),
// so the prior contribution is identical on both paths.
//
// Caller responsibilities (kept OUT of here to preserve the inline contract):
//   • sanitise faceValue via plausibleFaceValue() and pass faceValueShareSane
//     (the inline block computed faceValueSane before deriving bvps).
//   • the prior-row fetch (I/O — this module is pure).
//
// DISCLOSED-raw ratios are NOT here (none on this table). basicEps/dilutedEps
// are RAW per-share columns the ingester writes itself (not derived) — also
// not here.
// ─────────────────────────────────────────────────────────────

import { Prisma } from "../../../generated/prisma/client.js";
import {
  safeNumber,
  decimalPct,
  decimalPerShare,
  sumNonNull,
  avgNonNull,
  pctChange,
} from "../ingester-utils.js";

// Indian equity face values are 1/2/5/10 (occasionally up to 100). A value far
// outside that range is corrupt source data (seen in integrated-filing XBRL where
// a price or other figure is mis-tagged as nominal value). Drop it so it can't
// poison its consumers: the derived bookValuePerShare, and the F3 ESC-buyback
// quantifier in scoring (which reads faceValueShare, gated on an ESC drop).
export const PLAUSIBLE_FACE_VALUE_MAX = 1000;
export function plausibleFaceValue(v: number | null): number | null {
  if (v === null) return null;
  if (v <= 0 || v > PLAUSIBLE_FACE_VALUE_MAX) return null;
  return v;
}

// A derived ratio / per-share column has limited precision; a corrupt SOURCE
// input (e.g. a mis-tagged face value in the XBRL) can push a derived value past
// the column range and reject the ENTIRE row — discarding real financials over a
// display field. A display-only ratio must never do that, so out-of-range → null
// + warn. The scoring engine recomputes its metrics from raw ₹Cr lines and does
// not read these stored ratio columns for any affected metric (CN-8: no score
// shift). maxIntDigits = (precision − scale): Decimal(8,4)→4, Decimal(10,4)→6,
// Decimal(10,2)→8.
export function boundDerived(
  v: Prisma.Decimal | null,
  maxIntDigits: number,
  field: string,
  tag: string,
): Prisma.Decimal | null {
  if (v === null) return null;
  const max = new Prisma.Decimal(10).pow(maxIntDigits);
  if (v.abs().greaterThanOrEqualTo(max)) {
    console.warn(
      `[ingest-indas-annual] ${tag}: derived ${field}=${v.toString()} out of column range ` +
        `(|v|≥${max.toString()}) → stored null (display field; scoring reads raw lines, not this column).`,
    );
    return null;
  }
  return v;
}

// Raw inputs the derivation reads from the CURRENT row.
export interface IndAsAnnualRaw {
  revenue: number | null;
  netProfit: number | null;
  financeCosts: number | null;
  depreciation: number | null;
  profitBeforeTax: number | null;
  equityShareCapital: number | null;
  otherEquity: number | null;
  totalEquity: number | null;
  equityAttributableToOwners: number | null;
  borrowingsCurrent: number | null;
  borrowingsNoncurrent: number | null;
  cashFromOperating: number | null;
  capex: number | null;
  paidUpEquityCapital: number | null;
  /** Caller-sanitised via plausibleFaceValue(). */
  faceValueShareSane: number | null;
  tradeReceivablesCurrent: number | null;
  tradeReceivablesNoncurrent: number | null;
  inventories: number | null;
  totalAssets: number | null;
  basicEps: number | null;
}

// Prior-year inputs (from the prior STORED row) — only what the inline block used.
export interface IndAsAnnualPrior {
  revenue: number | null;
  netProfit: number | null;
  basicEps: number | null;
  totalEquity: number | null;
  equityAttributableToOwners: number | null;
  equityShareCapital: number | null;
  otherEquity: number | null;
}

// The 17 derived columns, as final Prisma.Decimal | null column values.
export interface IndAsAnnualDerivedColumns {
  totalDebt: Prisma.Decimal | null;
  fcf: Prisma.Decimal | null;
  ebitda: Prisma.Decimal | null;
  netMargin: Prisma.Decimal | null;
  operatingMargin: Prisma.Decimal | null;
  netWorth: Prisma.Decimal | null;
  bookValuePerShare: Prisma.Decimal | null;
  debtToEquity: Prisma.Decimal | null;
  roe: Prisma.Decimal | null;
  roce: Prisma.Decimal | null;
  interestCoverage: Prisma.Decimal | null;
  receivablesDays: Prisma.Decimal | null;
  inventoryTurnover: Prisma.Decimal | null;
  assetTurnover: Prisma.Decimal | null;
  revenueGrowthYoy: Prisma.Decimal | null;
  profitGrowthYoy: Prisma.Decimal | null;
  epsGrowthYoy: Prisma.Decimal | null;
}

// The pre-Decimal derived NUMBERS (for guards that need the raw value, e.g.
// checkRevenueYoyAnomaly reads revenueGrowthYoy as a number).
export interface IndAsAnnualDerivedNumbers {
  revenueGrowthYoy: number | null;
  profitGrowthYoy: number | null;
  epsGrowthYoy: number | null;
  netWorth: number | null;
  totalDebt: number | null;
  ebitda: number | null;
}

export interface IndAsAnnualDerived {
  columns: IndAsAnnualDerivedColumns;
  numbers: IndAsAnnualDerivedNumbers;
}

/**
 * Reproduce every stored derived column for an Ind-AS annual row from its raw
 * inputs + the prior-year stored row. Byte-identical to the former inline block.
 */
export function deriveIndAsAnnual(
  raw: IndAsAnnualRaw,
  prior: IndAsAnnualPrior | null,
  tag: string,
): IndAsAnnualDerived {
  // ── Derived totals ──
  const totalDebt = sumNonNull(raw.borrowingsCurrent, raw.borrowingsNoncurrent);
  const fcf =
    raw.cashFromOperating !== null && raw.capex !== null
      ? raw.cashFromOperating - raw.capex
      : null;
  const ebitda =
    raw.profitBeforeTax !== null &&
    raw.financeCosts !== null &&
    raw.depreciation !== null
      ? raw.profitBeforeTax + raw.financeCosts + raw.depreciation
      : null;

  // ── Margins ──
  const netMargin =
    raw.netProfit !== null && raw.revenue !== null && raw.revenue !== 0
      ? (raw.netProfit / raw.revenue) * 100
      : null;

  const operatingMargin =
    ebitda !== null && raw.revenue !== null && raw.revenue !== 0
      ? (ebitda / raw.revenue) * 100
      : null;

  // ── Net Worth = Equity ──
  const netWorth =
    raw.equityAttributableToOwners ??
    raw.totalEquity ??
    sumNonNull(raw.equityShareCapital, raw.otherEquity);

  // ── Book Value Per Share ──
  let bookValuePerShare: number | null = null;
  if (
    netWorth !== null &&
    raw.paidUpEquityCapital !== null &&
    raw.paidUpEquityCapital > 0 &&
    raw.faceValueShareSane !== null &&
    raw.faceValueShareSane > 0
  ) {
    const sharesOutstandingCr = raw.paidUpEquityCapital / raw.faceValueShareSane;
    if (sharesOutstandingCr > 0) {
      bookValuePerShare = netWorth / sharesOutstandingCr;
    }
  }

  // ── D/E ──
  const debtToEquity =
    totalDebt !== null && netWorth !== null && netWorth !== 0
      ? totalDebt / netWorth
      : null;

  // ── ROE & ROCE — need prior-year for averaging ──
  const priorNetWorth = prior
    ? (prior.equityAttributableToOwners ??
      prior.totalEquity ??
      sumNonNull(prior.equityShareCapital, prior.otherEquity))
    : null;

  const avgEquity = avgNonNull(netWorth, priorNetWorth);
  const roe =
    raw.netProfit !== null && avgEquity !== null && avgEquity !== 0
      ? (raw.netProfit / avgEquity) * 100
      : null;

  const ebit =
    raw.profitBeforeTax !== null && raw.financeCosts !== null
      ? raw.profitBeforeTax + raw.financeCosts
      : null;
  const capitalEmployed = sumNonNull(netWorth, totalDebt);
  const roce =
    ebit !== null && capitalEmployed !== null && capitalEmployed !== 0
      ? (ebit / capitalEmployed) * 100
      : null;

  // ── Interest Coverage = EBIT / Interest ──
  const interestCoverage =
    ebit !== null && raw.financeCosts !== null && raw.financeCosts !== 0
      ? ebit / raw.financeCosts
      : null;

  // ── Receivables Days ──
  const receivables = sumNonNull(
    raw.tradeReceivablesCurrent,
    raw.tradeReceivablesNoncurrent,
  );
  const receivablesDays =
    receivables !== null && raw.revenue !== null && raw.revenue !== 0
      ? (receivables / raw.revenue) * 365
      : null;

  // ── Inventory Turnover ──
  const inventoryTurnover =
    raw.inventories !== null && raw.inventories !== 0 && raw.revenue !== null
      ? raw.revenue / raw.inventories
      : null;

  // ── Asset Turnover ──
  const assetTurnover =
    raw.totalAssets !== null && raw.totalAssets !== 0 && raw.revenue !== null
      ? raw.revenue / raw.totalAssets
      : null;

  // ── YoY Growth ──
  const revenueGrowthYoy = pctChange(raw.revenue, prior?.revenue ?? null);
  const profitGrowthYoy = pctChange(raw.netProfit, prior?.netProfit ?? null);
  const epsGrowthYoy = pctChange(raw.basicEps, prior?.basicEps ?? null);

  const columns: IndAsAnnualDerivedColumns = {
    totalDebt: safeNumber(totalDebt),
    fcf: safeNumber(fcf),
    ebitda: safeNumber(ebitda),
    netMargin: boundDerived(decimalPct(netMargin), 4, "netMargin", tag),
    operatingMargin: boundDerived(decimalPct(operatingMargin), 4, "operatingMargin", tag),
    netWorth: safeNumber(netWorth),
    bookValuePerShare: boundDerived(decimalPerShare(bookValuePerShare), 6, "bookValuePerShare", tag),
    debtToEquity: boundDerived(decimalPct(debtToEquity !== null ? debtToEquity * 100 : null), 4, "debtToEquity", tag), // store as percent
    roe: boundDerived(decimalPct(roe), 4, "roe", tag),
    roce: boundDerived(decimalPct(roce), 4, "roce", tag),
    interestCoverage: boundDerived(decimalPerShare(interestCoverage), 6, "interestCoverage", tag),
    receivablesDays: boundDerived(safeNumber(receivablesDays, 2), 8, "receivablesDays", tag),
    inventoryTurnover: boundDerived(decimalPerShare(inventoryTurnover), 6, "inventoryTurnover", tag),
    assetTurnover: boundDerived(decimalPerShare(assetTurnover), 6, "assetTurnover", tag),
    revenueGrowthYoy: boundDerived(decimalPct(revenueGrowthYoy), 4, "revenueGrowthYoy", tag),
    profitGrowthYoy: boundDerived(decimalPct(profitGrowthYoy), 4, "profitGrowthYoy", tag),
    epsGrowthYoy: boundDerived(decimalPct(epsGrowthYoy), 4, "epsGrowthYoy", tag),
  };

  return {
    columns,
    numbers: { revenueGrowthYoy, profitGrowthYoy, epsGrowthYoy, netWorth, totalDebt, ebitda },
  };
}
