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
/**
 * Optional 2nd param — the RELATIONAL check, added 2026-08-11 alongside the fix that
 * closed PB-3 on the last of five *_fundamentals tables. A face value that exactly
 * equals the company's OWN paidUpEquityCapital (in ₹Cr) implies ~1 crore total shares
 * outstanding — essentially never true for a listed company of any real size, and the
 * exact fingerprint the source-filing corruption leaves (the filer supplies the same
 * wrong number under both the FaceValueOfEquityShareCapital and
 * PaidUpValueOfEquityShareCapital tags). The MAGNITUDE check above (v > 1000) does not
 * catch this: ITCHOTELS (208.12) and JKTYRE (57.66) both sit comfortably under
 * PLAUSIBLE_FACE_VALUE_MAX. Nor does meaningfulBookValue's ₹1,00,000 OUTPUT ceiling —
 * that only works when the resulting bookValuePerShare is itself extreme in absolute
 * rupees (KOTAKBANK's ₹994.11cr paid-up capital produced a ₹1.17-lakh bvps; ITCHOTELS'
 * ₹208cr and JKTYRE's ₹54-58cr produce a merely-wrong-not-extreme ₹5,283–10,692, which
 * clears no magnitude bound). This relational check is what actually catches both.
 * Callers may omit it and get the existing magnitude-only behaviour unchanged.
 */
export function plausibleFaceValue(
  v: number | null,
  paidUpEquityCapital?: number | null,
): number | null {
  if (v === null) return null;
  if (v <= 0 || v > PLAUSIBLE_FACE_VALUE_MAX) return null;
  if (paidUpEquityCapital !== undefined && paidUpEquityCapital !== null && v === paidUpEquityCapital) {
    return null;
  }
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
  return boundToColumn(v, maxIntDigits, field, tag, "derived");
}

// ── S8.1c — THE DISCLOSED SIBLING ───────────────────────────────────────────
// The 22 ratios the LI/GI ingesters write come from the DOCUMENT, not from our
// arithmetic, so the failure has a different cause — and the same cure.
//
//   SAME: the column is the constraint either way. A value that cannot be
//   represented cannot be stored, and an overflow throws the WHOLE upsert,
//   discarding the raw absolute lines with it. Widening the column is not the
//   answer — a persistency ratio of 301,900% is meaningless in any column type,
//   and a wider column would store the nonsense instead of flagging it.
//
//   DIFFERENT — and this is why it logs separately: a DERIVED overflow means our
//   maths hit a near-zero denominator; the inputs survive in the row, so a later
//   re-derive recovers the true value once the input is fixed. A DISCLOSED
//   overflow means the filer tagged a number outside any plausible range; no
//   re-derive can recover it, because there is nothing to recompute from. It
//   needs the filing re-read or a manual key. A reader chasing a null must be
//   able to tell those two apart from the log line alone.
export function boundDisclosed(
  v: Prisma.Decimal | null,
  maxIntDigits: number,
  field: string,
  tag: string,
): Prisma.Decimal | null {
  return boundToColumn(v, maxIntDigits, field, tag, "disclosed");
}

function boundToColumn(
  v: Prisma.Decimal | null,
  maxIntDigits: number,
  field: string,
  tag: string,
  kind: "derived" | "disclosed",
): Prisma.Decimal | null {
  if (v === null) return null;
  const max = new Prisma.Decimal(10).pow(maxIntDigits);
  if (v.abs().greaterThanOrEqualTo(max)) {
    // ⚠ prefix was hardcoded `[ingest-indas-annual]`, which mislabelled every other
    //   caller — S4.2 added banking-annual, banking-quarterly and indas-quarterly,
    //   so a quarterly overflow was logging as an annual one. `tag` already carries
    //   the real caller.
    console.warn(
      `[${kind === "derived" ? "boundDerived" : "boundDisclosed"}] ${tag}: ${kind} ${field}=${v.toString()} out of column range ` +
        (kind === "derived"
          ? `(|v|≥${max.toString()}) → stored null (display field; scoring reads raw lines, not this column).`
          : `(|v|≥${max.toString()}) → stored null (as filed; no sibling to recompute from — re-read the filing or key it by hand).`),
    );
    return null;
  }
  return v;
}

// ── SHARED ACROSS EVERY *_fundamentals TABLE THAT DERIVES bookValuePerShare ─────────────────────────
// plausibleFaceValue() catches a corrupt faceValueShare, but `sharesCr = paidUpEquityCapital /
// faceValueShareSane` collapses the SAME way when paidUpEquityCapital is the corrupt figure and
// faceValueShare reads as ordinary — first proven on NbfcFundamental's CANFINHOME FY25 standalone
// (face value ₹2, paidUpEquityCapital 0.02cr, implied ~100,000 shares, stored bvps=506749.37), then
// confirmed on BankingFundamental's KOTAKBANK FY25 standalone from the OTHER side: faceValueShare
// (994.11) is itself the corrupt figure, but it sits UNDER PLAUSIBLE_FACE_VALUE_MAX — the filed XBRL
// carries `PaidUpValueOfEquityShareCapital`=9,941,100,000 (₹994.11cr) and, separately,
// `FaceValueOfEquityShareCapital`=994.11 (unitRef="INRPerShare") as TWO DISTINCT facts that happen to
// share a numeral — the filer's error, not a parse fault (verified against the raw XBRL for both).
// boundDerived() alone does not catch either: both stored values (₹5.07 lakh, ₹1.17 lakh per share)
// sit well inside a Decimal(10,4) column's storage range. A bound on the INPUT can't cover every raw
// field that feeds one division, so this bounds the OUTPUT instead.
//
// ₹1,00,000/share is not picked blind: the single highest LEGITIMATE bookValuePerShare across every
// *_fundamentals table is MRF (non-financial — THIS table) at ~₹49,468, itself an illiquid-float
// outlier; nothing else clears ₹7,500. The ceiling sits ~2× above the genuine maximum, wide enough to
// admit any real company's figure and tight enough to catch a share count that has collapsed to a
// handful of digits.
//
// ★ APPLIED HERE TOO — 2026-08-11, closing PB-3. This table DEFINED meaningfulBookValue but was the
// one of five *_fundamentals tables that never called it on its OWN bookValuePerShare below — only
// boundDerived (column-storage-range, not meaning) wrapped it. ITCHOTELS FY25 consolidated (faceValue
// 208.12, byte-equal to paidUpEquityCapital — the KOTAKBANK-shape corruption) and JKTYRE FY26 both
// bases (faceValue 57.66, same byte-equal signature) were live and uncontained as a result — both
// UNDER PLAUSIBLE_FACE_VALUE_MAX, so plausibleFaceValue alone would not have caught either; see
// parser-backlog.ts PB-3 (now closed) for the full writeup and the two stocks' actual numbers.
export const MEANINGFUL_BOOK_VALUE_MAX_ABS = 100_000;
export function meaningfulBookValue(v: number | null): number | null {
  return v !== null && Math.abs(v) <= MEANINGFUL_BOOK_VALUE_MAX_ABS ? v : null;
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
    bookValuePerShare: boundDerived(decimalPerShare(meaningfulBookValue(bookValuePerShare)), 6, "bookValuePerShare", tag),
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
